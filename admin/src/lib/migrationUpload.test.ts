import { describe, it, expect } from "vitest";
import { uploadMigrationFile, type PutFile } from "./migrationUpload";
import type { ApiCall } from "./wpImportRun";

/**
 * MIGRATION-UPLOAD-1 — the Migration page's upload: the link request, the PUT to the private bucket, and the
 * refusals the page shows. Scripted API and PUT (the admin tests have no DOM).
 */
const KEY = "migration/t1/0f8fad5b-d9cb-469f-a165-70867728950e-export.xml";

function scripted(answer: any | Error, putStatus = 200) {
    const calls: { path: string; body: any }[] = [];
    const puts: { url: string; contentType: string; file: Blob }[] = [];
    const api: ApiCall = async (path, init) => {
        calls.push({ path, body: JSON.parse(init.body) });
        if (answer instanceof Error) throw answer;
        return answer;
    };
    const put: PutFile = async (url, file, contentType) => {
        puts.push({ url, file, contentType });
        return { ok: putStatus >= 200 && putStatus < 300, status: putStatus };
    };
    return { api, put, calls, puts };
}

const xml = (type: string) => new File(["<rss/>"], "export.xml", { type });

describe("MU1-ADMIN-UPLOAD — the Migration page's upload", () => {
    it("MU1-ADMIN-UPLOAD-OK: asks POST /import/upload-url with name, type and size; PUTs the file to the link with that type; answers the key", async () => {
        const s = scripted({ uploadUrl: "https://private.test/put", s3Key: KEY });
        const file = xml("text/xml");
        await expect(uploadMigrationFile(s.api, s.put, file)).resolves.toBe(KEY);
        expect(s.calls).toEqual([{ path: "/import/upload-url", body: { filename: "export.xml", contentType: "text/xml", size: 6 } }]);
        expect(s.puts).toEqual([{ url: "https://private.test/put", file, contentType: "text/xml" }]);
    });

    it("MU1-ADMIN-UPLOAD-NOTYPE: a file the browser gives no type → sent as application/xml (link and PUT agree)", async () => {
        const s = scripted({ uploadUrl: "https://private.test/put", s3Key: KEY });
        await uploadMigrationFile(s.api, s.put, xml(""));
        expect(s.calls[0].body.contentType).toBe("application/xml");
        expect(s.puts[0].contentType).toBe("application/xml");
    });

    it("MU1-ADMIN-UPLOAD-REFUSED: a refused link → the server's message is thrown, nothing is PUT", async () => {
        const s = scripted(new Error("API Error (400): The file is 50000000 bytes; the limit for a migration file is 41943040 bytes (40 MB). Split the export: WordPress Tools → Export can export one content type or a date range."));
        await expect(uploadMigrationFile(s.api, s.put, xml("text/xml"))).rejects.toThrow("the limit for a migration file is 41943040 bytes (40 MB). Split the export");
        expect(s.puts).toEqual([]);
    });

    it("MU1-ADMIN-UPLOAD-PUT-FAILED: the storage refuses the PUT → a message with its status; no key", async () => {
        const s = scripted({ uploadUrl: "https://private.test/put", s3Key: KEY }, 403);
        await expect(uploadMigrationFile(s.api, s.put, xml("text/xml"))).rejects.toThrow('The upload of "export.xml" failed: the storage answered HTTP 403. Try again.');
    });
});
