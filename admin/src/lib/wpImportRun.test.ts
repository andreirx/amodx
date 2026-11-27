import { describe, it, expect } from "vitest";
import { runPagesBatches, checkAuthorisesImport, PagesImportFlow, type ApiCall } from "./wpImportRun";

/**
 * IMPORT-PATHS-1 (review F-IP1-FAILURE-REPORT) — the check / import wiring of the WP Migration page through a scripted
 * API: the batch loop, the default carried to later batches, and the gate that keeps the import off after an
 * incomplete check. Rows are of the shape backend/src/import/wordpress.ts answers.
 */
const okRow = (title: string) => ({ item: "page", title, oldAddress: { kind: "path", path: `/${title}`, raw: `/${title}` }, page: { kind: "kept", address: `/${title}`, write: "create" }, redirect: { kind: "none" }, featuredImage: { kind: "none" } });
const failedRow = (title: string) => ({ ...okRow(title), page: { kind: "failed", address: `/${title}`, error: "the site could not be read" } });

function scripted(answers: any[]): { api: ApiCall; calls: { path: string; body: any }[] } {
    const calls: { path: string; body: any }[] = [];
    const api: ApiCall = async (path, init) => {
        calls.push({ path, body: JSON.parse(init.body) });
        const next = answers.shift();
        if (next instanceof Error) throw next;
        return next;
    };
    return { api, calls };
}

describe("IP1-ADMIN-WIRING — the check and the import over batches", () => {
    it("IP1-ADMIN-BATCHES: every batch is called; the default answered by the first is sent with the next; the rows are joined", async () => {
        const { api, calls } = scripted([
            { dryRun: true, keepOldAddresses: true, complete: false, nextBatchStart: 1, rows: [okRow("a")] },
            { dryRun: true, keepOldAddresses: true, complete: true, rows: [okRow("b")] },
        ]);
        const run = await runPagesBatches(api, "t1/migration/x.xml", true, undefined);
        expect(calls).toEqual([
            { path: "/import/wordpress?dryRun=1", body: { s3Key: "t1/migration/x.xml", batchStart: 0 } },
            { path: "/import/wordpress?dryRun=1", body: { s3Key: "t1/migration/x.xml", batchStart: 1, keepOldAddresses: true } },
        ]);
        expect(run.keep).toBe(true);
        expect(run.rows.map((r) => r.title)).toEqual(["a", "b"]);
        expect(checkAuthorisesImport(run)).toBe(true);
    });

    it("IP1-ADMIN-GATE-FAILED-ROW: a check with a failed row does not authorise the import", async () => {
        const { api } = scripted([{ dryRun: true, keepOldAddresses: true, complete: true, rows: [okRow("a"), failedRow("b")], errors: ['Failed to process "b": the site could not be read'] }]);
        const run = await runPagesBatches(api, "k", true, undefined);
        expect(run.rows).toHaveLength(2);
        expect(checkAuthorisesImport(run)).toBe(false);
    });

    it.each([
        ["an error without a failed row", { dryRun: true, complete: true, rows: [okRow("a")], errors: ["Redirect /x → /y not written"] }],
        ["a failed redirect", { dryRun: true, complete: true, rows: [{ ...okRow("a"), redirect: { kind: "failed", from: "/A", to: "/a", error: "e" } }] }],
        ["a failed product lookup", { dryRun: true, complete: true, rows: [{ item: "product", title: "p", oldAddress: { kind: "none" }, product: { kind: "failed", error: "e" }, redirect: { kind: "none" } }] }],
        ["not a dry run (an import's answer)", { complete: true, rows: [okRow("a")] }],
    ])("IP1-ADMIN-GATE: %s → the import stays off", async (_what, answer) => {
        const { api } = scripted([answer]);
        expect(checkAuthorisesImport(await runPagesBatches(api, "k", true, true))).toBe(false);
    });

    it("IP1-ADMIN-GATE-NO-CHECK: no check → the import stays off", () => {
        expect(checkAuthorisesImport(null)).toBe(false);
    });

    it("IP1-ADMIN-CALL-FAILS: a failed call stops the run (the page shows the message; no check is stored, so the import stays off)", async () => {
        const { api, calls } = scripted([{ dryRun: true, complete: false, nextBatchStart: 1, rows: [okRow("a")] }, new Error("Network error")]);
        await expect(runPagesBatches(api, "k", true, true)).rejects.toThrow("Network error");
        expect(calls).toHaveLength(2);
    });

    it("IP1-ADMIN-IMPORT-SENDS-OPTION: the import sends the option on every batch, without dryRun", async () => {
        const { api, calls } = scripted([{ complete: false, nextBatchStart: 100, rows: [] }, { complete: true, rows: [] }]);
        await runPagesBatches(api, "k", false, false);
        expect(calls).toEqual([
            { path: "/import/wordpress", body: { s3Key: "k", batchStart: 0, keepOldAddresses: false } },
            { path: "/import/wordpress", body: { s3Key: "k", batchStart: 100, keepOldAddresses: false } },
        ]);
    });
});

describe("IP1-R1-ADMIN-FLOW — a check authorises ONE import attempt (review-1 3c; the state Migration.tsx renders from)", () => {
    const check = { dryRun: true, keepOldAddresses: true, complete: true, rows: [okRow("a")] };

    it("IP1-R1-ADMIN-FLOW-FAILED-IMPORT: an import call that fails consumes the check — the import button is off until a new check", async () => {
        const { api } = scripted([check, new Error("Network error")]);
        const flow = new PagesImportFlow(api);
        await flow.runCheck("k", undefined);
        expect(flow.canImport()).toBe(true);
        await expect(flow.runImport("k", true)).rejects.toThrow("Network error");
        expect(flow.canImport()).toBe(false);
        await expect(flow.runImport("k", true)).rejects.toThrow("Check the addresses first");
    });

    it("IP1-R1-ADMIN-FLOW-PARTIAL-IMPORT: an import that stops after its first batch consumes the check too", async () => {
        const { api, calls } = scripted([check, { complete: false, nextBatchStart: 100, rows: [okRow("a")] }, new Error("Gateway timeout")]);
        const flow = new PagesImportFlow(api);
        await flow.runCheck("k", undefined);
        await expect(flow.runImport("k", true)).rejects.toThrow("Gateway timeout");
        expect(calls.map((c) => c.path)).toEqual(["/import/wordpress?dryRun=1", "/import/wordpress", "/import/wordpress"]);
        expect(flow.canImport()).toBe(false);
    });

    it("IP1-R1-ADMIN-FLOW-SUCCESS: a finished import consumes the check; a new complete check authorises the next import", async () => {
        const { api } = scripted([check, { complete: true, rows: [okRow("a")] }, check]);
        const flow = new PagesImportFlow(api);
        await flow.runCheck("k", undefined);
        await flow.runImport("k", true);
        expect(flow.canImport()).toBe(false);
        await flow.runCheck("k", true);
        expect(flow.canImport()).toBe(true);
    });

    it("IP1-R1-ADMIN-FLOW-RESET: another file or a changed option drops the check; a failed check leaves none", async () => {
        const { api } = scripted([check, new Error("Network error")]);
        const flow = new PagesImportFlow(api);
        await flow.runCheck("k", undefined);
        flow.reset();
        expect(flow.canImport()).toBe(false);
        await expect(flow.runCheck("k", true)).rejects.toThrow("Network error");
        expect(flow.canImport()).toBe(false);
    });
});
