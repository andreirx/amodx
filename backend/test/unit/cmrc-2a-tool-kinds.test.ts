import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../../scripts/commerce-private-table/canonical-item.js";
import { DESTINATION, SOURCE, TABLE_ARGS, harness } from "./cmrc-2a-raw-tables.js";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md § "Safety table", row S15) — the tool takes its kinds from
 * `COMMERCE_PRIVATE_PREFIXES` of `backend/src/lib/commerce-db.ts` and has no list of its own.
 *
 * This file replaces that ONE export with the real list plus a fifth prefix (as `cmrc-4` will add one for the
 * coupon-use counters) and runs the unchanged tool. It is its own file because the replacement holds for a whole file.
 */

const FIFTH = "FIFTHKIND#";

vi.mock("../../src/lib/commerce-db.js", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../src/lib/commerce-db.js")>();
    return { ...real, COMMERCE_PRIVATE_PREFIXES: [...real.COMMERCE_PRIVATE_PREFIXES, "FIFTHKIND#"] };
});

const TOOL_FILES = [
    "../../../scripts/migrate-commerce-private-table.ts",
    ...readdirSync(fileURLToPath(new URL("../../../scripts/commerce-private-table/", import.meta.url)))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => `../../../scripts/commerce-private-table/${name}`),
];

describe("the kinds of the tool", () => {
    it("a fifth prefix in commerce-db.ts is copied and verified with no edit of the tool", async () => {
        const { COMMERCE_PRIVATE_PREFIXES, orderRef } = await import("../../src/lib/commerce-db.js");
        expect(COMMERCE_PRIVATE_PREFIXES).toHaveLength(5);
        const h = harness();
        const fifthSk = `${FIFTH}coupon-1#${"ab".repeat(32)}`;
        h.tables.put(SOURCE, { PK: { S: "TENANT#t1" }, SK: { S: fifthSk }, count: { N: "1" } });
        h.tables.put(SOURCE, { PK: { S: "TENANT#t1" }, SK: { S: orderRef("t1", "o1").Key.SK }, status: { S: "placed" } });
        h.tables.put(SOURCE, { PK: { S: "TENANT#t1" }, SK: { S: "PRODUCT#p1" }, title: { S: "not a commerce-private item" } });

        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, "--tenants", "t1", "--execute"])).toBe(0);
        expect(h.report()).toContain(`  COPIED PK=TENANT#t1 SK=${fifthSk}`);
        expect(h.tables.sortKeys(DESTINATION, "TENANT#t1")).toEqual([fifthSk, orderRef("t1", "o1").Key.SK].sort());

        expect(await h.run(["--mode", "verify", "--strict", ...TABLE_ARGS, "--tenants", "t1", "--manifest-out", "/out/manifest.json"])).toBe(0);
        const manifest = JSON.parse(h.files.read("/out/manifest.json"));
        expect(manifest.prefixes).toEqual([...COMMERCE_PRIVATE_PREFIXES]);
        expect(manifest.entries.map((entry: { sk: string }) => entry.sk)).toContain(fifthSk);

        // A manifest written for the five kinds is the one a purge of the five kinds accepts; the product stays.
        const purge = ["--mode", "purge", ...TABLE_ARGS, "--tenants", "t1", "--manifest", "/out/manifest.json", "--manifest-sha256", sha256Hex(h.files.read("/out/manifest.json")),
            "--backup-ref", "arn:synthetic", "--export-path", "/out/export.ndjson", "--execute"];
        expect(await h.run(purge)).toBe(0);
        expect(h.tables.sortKeys(SOURCE, "TENANT#t1")).toEqual(["PRODUCT#p1"]);
        // Every Query named one prefix of the shared list.
        const queried = new Set(h.tables.sent.filter((sent) => sent.name === "Query").map((sent) => sent.sk));
        expect(queried).toEqual(new Set(COMMERCE_PRIVATE_PREFIXES));
    });

    it("no file of the tool contains a commerce-private prefix as text", async () => {
        const real = await vi.importActual<typeof import("../../src/lib/commerce-db.js")>("../../src/lib/commerce-db.js");
        expect(real.COMMERCE_PRIVATE_PREFIXES.length).toBeGreaterThanOrEqual(4);
        expect(TOOL_FILES.map((file) => path.basename(file)).sort()).toEqual(["canonical-item.ts", "decisions.ts", "files.ts", "migrate-commerce-private-table.ts", "run.ts"]);
        for (const file of TOOL_FILES) {
            const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
            for (const prefix of real.COMMERCE_PRIVATE_PREFIXES) expect(text.includes(prefix), `${path.basename(file)} contains ${prefix}`).toBe(false);
        }
    });
});
