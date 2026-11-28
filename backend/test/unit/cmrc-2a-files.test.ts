import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { filesOn, type FileSystem } from "../../../scripts/commerce-private-table/files.js";
import { orderRef } from "../../src/lib/commerce-db.js";
import { SOURCE, TABLE_ARGS, harness } from "./cmrc-2a-raw-tables.js";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md § "Safety table", rows S5 and S16; review-0 F01, F02) — the file side of the tool,
 * `scripts/commerce-private-table/files.ts`: the WHOLE line is on disk before `appendLine` returns, and a file is never
 * created inside the repository (links resolved) or over an existing file.
 *
 * Two kinds of test: a file-system double (short writes and failures cannot be made on demand on a real disk), and
 * the real `node:fs` in a temporary directory `CMRC-2A-files-*` (links; exclusive creation), removed at the end.
 */

/** A file system in memory. `accept` is how many bytes one `writeSync` takes at most; `links` maps a directory to its real path. */
class FakeFs implements FileSystem {
    files = new Map<string, Buffer>();
    directories = new Set<string>(["/out", "/repo", "/repo/docs"]);
    links = new Map<string, string>();
    accept = Infinity;
    failWrite: (call: number) => boolean = () => false;
    failFsync = false;
    calls: string[] = [];
    private open = new Map<number, string>();
    private next = 3;
    private writes = 0;

    existsSync = (file: string): boolean => this.files.has(file) || this.directories.has(file);
    readFileSync = (file: string): string => {
        const content = this.files.get(file);
        if (content === undefined) throw Object.assign(new Error("no such file"), { code: "ENOENT" });
        return content.toString("utf8");
    };
    realpathSync = (file: string): string => {
        const real = this.links.get(file) ?? file;
        if (!this.directories.has(real)) throw Object.assign(new Error("no such directory"), { code: "ENOENT" });
        return real;
    };
    openSync = (file: string): number => {
        this.calls.push(`open ${file}`);
        if (this.files.has(file)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
        this.files.set(file, Buffer.alloc(0));
        this.open.set(this.next, file);
        return this.next++;
    };
    writeSync = (descriptor: number, buffer: Uint8Array, offset: number, length: number): number => {
        this.writes += 1;
        if (this.failWrite(this.writes)) throw Object.assign(new Error("VALUE-synthetic in a write error"), { code: "ENOSPC" });
        const accepted = Math.min(length, this.accept);
        const file = this.open.get(descriptor)!;
        this.files.set(file, Buffer.concat([this.files.get(file)!, Buffer.from(buffer.subarray(offset, offset + accepted))]));
        this.calls.push(`write ${accepted}`);
        return accepted;
    };
    fsyncSync = (): void => {
        if (this.failFsync) throw Object.assign(new Error("flush failed"), { code: "EIO" });
        this.calls.push("fsync");
    };
    closeSync = (descriptor: number): void => {
        this.calls.push("close");
        this.open.delete(descriptor);
    };
}

// Synthetic text with characters of two, three and four UTF-8 bytes: a short write can end inside one of them.
const LINE = '{"sk":"KIND#1","note":"ăîșț € 𝄞 synthetic"}';

describe("appendLine: the whole line is on disk before it returns (F01)", () => {
    it("a short write is repeated until every byte is accepted, then the file is flushed", () => {
        for (const accept of [1, 2, 3, 5, 7, Infinity]) {
            const fs = new FakeFs();
            fs.accept = accept;
            const file = filesOn(fs, "/repo").openNewForAppend("/out/export.ndjson");
            file.appendLine(LINE);
            file.appendLine("second");
            expect(fs.readFileSync("/out/export.ndjson"), `accept ${accept}`).toBe(`${LINE}\nsecond\n`);
            // The flush comes after the last byte of each line, never between two parts of one line.
            const afterOpen = fs.calls.slice(1);
            const firstFlush = afterOpen.indexOf("fsync");
            expect(afterOpen.slice(0, firstFlush).every((call) => call.startsWith("write "))).toBe(true);
            expect(afterOpen.slice(0, firstFlush).reduce((sum, call) => sum + Number(call.slice(6)), 0)).toBe(Buffer.byteLength(`${LINE}\n`));
            expect(afterOpen.filter((call) => call === "fsync")).toHaveLength(2);
        }
    });

    it("a write that accepts no byte stops with an error: the line is not reported as written, and nothing is flushed", () => {
        const fs = new FakeFs();
        fs.accept = 0;
        const file = filesOn(fs, "/repo").openNewForAppend("/out/export.ndjson");
        expect(() => file.appendLine(LINE)).toThrowError(expect.objectContaining({ name: "IncompleteWrite" }));
        expect(fs.calls).not.toContain("fsync");
    });

    it("a write error in the middle of a line, and a flush error, both reach the caller", () => {
        const midLine = new FakeFs();
        midLine.accept = 4;
        midLine.failWrite = (call) => call === 3;
        const file = filesOn(midLine, "/repo").openNewForAppend("/out/export.ndjson");
        expect(() => file.appendLine(LINE)).toThrowError(expect.objectContaining({ code: "ENOSPC" }));
        expect(midLine.calls).not.toContain("fsync");

        const noFlush = new FakeFs();
        noFlush.failFsync = true;
        expect(() => filesOn(noFlush, "/repo").openNewForAppend("/out/export.ndjson").appendLine(LINE)).toThrowError(expect.objectContaining({ code: "EIO" }));
    });

    it("createNew writes the whole text with short writes too, flushes and closes; it closes also when the write fails", () => {
        const fs = new FakeFs();
        fs.accept = 3;
        filesOn(fs, "/repo").createNew("/out/manifest.json", `${LINE}\n`);
        expect(fs.readFileSync("/out/manifest.json")).toBe(`${LINE}\n`);
        expect(fs.calls.slice(-2)).toEqual(["fsync", "close"]);

        const failing = new FakeFs();
        failing.failWrite = () => true;
        expect(() => filesOn(failing, "/repo").createNew("/out/manifest.json", "text")).toThrow();
        expect(failing.calls[failing.calls.length - 1]).toBe("close");
    });
});

describe("a file is never created inside the repository or over a file (F02)", () => {
    const refusalOf = (fs: FakeFs, file: string) => filesOn(fs, "/repo").outputRefusal(file);

    it("refuses a path under the repository, also under a child whose name starts with two dots", () => {
        const fs = new FakeFs();
        fs.directories.add("/repo/..private");
        expect(refusalOf(fs, "/repo/docs/inventory.json")).toMatch(/inside the repository/);
        expect(refusalOf(fs, "/repo/..private/items.ndjson")).toMatch(/inside the repository/);
        expect(refusalOf(fs, "/repo/manifest.json")).toMatch(/inside the repository/);
        expect(refusalOf(fs, "/out/manifest.json")).toBeUndefined();
    });

    it("refuses a directory OUTSIDE the repository that is a link into it, and a repository reached through a link", () => {
        const fs = new FakeFs();
        fs.links.set("/out/link-into-repo", "/repo/docs");
        expect(refusalOf(fs, "/out/link-into-repo/export.ndjson")).toMatch(/inside the repository .*its real directory is \/repo\/docs/);
        // The tool was started through a link to the repository: the real root is what counts.
        fs.links.set("/work/checkout", "/repo");
        expect(filesOn(fs, "/work/checkout").outputRefusal("/repo/docs/export.ndjson")).toMatch(/inside the repository/);
    });

    it("refuses a directory that does not exist, an existing file, and a repository root that cannot be resolved", () => {
        const fs = new FakeFs();
        expect(refusalOf(fs, "/missing/export.ndjson")).toMatch(/its directory does not exist/);
        fs.files.set("/out/export.ndjson", Buffer.from("an earlier export\n"));
        expect(refusalOf(fs, "/out/export.ndjson")).toMatch(/the file exists already/);
        expect(filesOn(fs, "/no-such-root").outputRefusal("/out/new.json")).toMatch(/the repository root cannot be resolved/);
    });

    it("the same rule holds at the moment of creation, for all three kinds of output: nothing is opened", () => {
        const fs = new FakeFs();
        fs.links.set("/out/link-into-repo", "/repo/docs");
        const files = filesOn(fs, "/repo");
        expect(() => files.createNew("/out/link-into-repo/inventory.json", "x")).toThrowError(expect.objectContaining({ name: "OutputRefused" }));
        expect(() => files.createNew("/repo/..private/manifest.json", "x")).toThrowError(expect.objectContaining({ name: "OutputRefused" }));
        expect(() => files.openNewForAppend("/out/link-into-repo/export.ndjson")).toThrowError(expect.objectContaining({ name: "OutputRefused" }));
        expect(fs.calls).toEqual([]);
        expect(fs.files.size).toBe(0);
    });
});

describe("on the real file system (a temporary directory)", () => {
    const root = nodeFs.mkdtempSync(path.join(os.tmpdir(), "CMRC-2A-files-"));
    const repository = path.join(root, "repository");
    const outside = path.join(root, "outside");
    nodeFs.mkdirSync(path.join(repository, "docs"), { recursive: true });
    nodeFs.mkdirSync(path.join(repository, "..private"));
    nodeFs.mkdirSync(outside);
    nodeFs.symlinkSync(path.join(repository, "docs"), path.join(outside, "link-into-repository"));
    afterAll(() => nodeFs.rmSync(root, { recursive: true, force: true }));
    const files = filesOn(nodeFs, repository);

    it("`node:fs` is a FileSystem; a line appended is in the file; a second creation at the same path fails", () => {
        const exportPath = path.join(outside, "export.ndjson");
        const file = files.openNewForAppend(exportPath);
        file.appendLine(LINE);
        file.close();
        expect(nodeFs.readFileSync(exportPath, "utf8")).toBe(`${LINE}\n`);
        expect(files.outputRefusal(exportPath)).toMatch(/the file exists already/);
        expect(() => files.openNewForAppend(exportPath)).toThrowError(expect.objectContaining({ name: "OutputRefused" }));
        expect(() => files.createNew(exportPath, "replaced")).toThrow();
        expect(nodeFs.readFileSync(exportPath, "utf8")).toBe(`${LINE}\n`);
    });

    it("a link from outside into the repository, and a `..private` child, are refused; the real outside directory is accepted", () => {
        expect(files.outputRefusal(path.join(outside, "link-into-repository", "export.ndjson"))).toMatch(/inside the repository/);
        expect(files.outputRefusal(path.join(repository, "..private", "items.json"))).toMatch(/inside the repository/);
        expect(files.outputRefusal(path.join(outside, "manifest.json"))).toBeUndefined();
        expect(nodeFs.readdirSync(path.join(repository, "docs"))).toEqual([]);
    });

    it("the tool refuses such a path before it reads a table, for the inventory, the manifest and the export", async () => {
        const h = harness({ files, repositoryRoot: repository });
        h.tables.put(SOURCE, { PK: { S: "TENANT#t1" }, SK: { S: orderRef("t1", "o1").Key.SK }, status: { S: "placed" } });
        const linked = (name: string) => path.join(outside, "link-into-repository", name);
        const requests = [
            ["--mode", "plan", ...TABLE_ARGS, "--tenants", "t1", "--inventory-out", linked("inventory.json")],
            ["--mode", "verify", "--strict", ...TABLE_ARGS, "--tenants", "t1", "--manifest-out", linked("manifest.json")],
            ["--mode", "discard", ...TABLE_ARGS, "--tenants", "t1", "--authorization", path.join(outside, "none.json"), "--backup-ref", "arn:synthetic", "--export-path", linked("export.ndjson"), "--execute"],
        ];
        for (const request of requests) {
            expect(await h.run(request)).toBe(1);
            const lines = h.report();
            expect(lines.join("\n")).toMatch(/REFUSED REQUEST: the file of --(inventory-out|manifest-out|export-path) \(.*\) cannot be created: it is inside the repository/);
            expect(lines[lines.length - 1]).toBe("RESULT: NOT GREEN — the request was refused; no table was read, nothing was written or deleted; exit status 1");
        }
        expect(h.tables.sent).toEqual([]);
        expect(nodeFs.readdirSync(path.join(repository, "docs"))).toEqual([]);
    });
});
