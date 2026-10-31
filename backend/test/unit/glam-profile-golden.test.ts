import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";
import { MemoryTable } from "./memory-table.js";
import { GOLDEN_TIME, captureCase, goldenInputs, mask, planOf } from "./cat-import-profile-1-golden.js";

/**
 * CAT-IMPORT-PROFILE-1A — preservation against the golden captured from the BASE commit b0a3055
 * (docs/slices/cat-import-profile-1.md § 7.3; § 2.8 "the byte-identity promise"). The golden file was written by
 * `cat-import-profile-1-golden.capture.test.ts` running on the unchanged code; this file runs the SAME steps
 * (`captureCase`) on the current code and compares — never two new code paths with each other.
 *
 * (a) no `profileChoice`, no stored profile; (b) `profileChoice = DEFAULT_PROFILE` (baseRevision null), no stored
 * profile. Each must give the golden plan, the golden write history (every write command's payload, in order), the
 * golden audit calls and the golden response — after removing ONLY the response members this slice adds (§ 3.5,
 * additive) — and write no `IMPORTPROFILE#` item.
 */

const { holder, mockAudit, nextUuid } = vi.hoisted(() => {
    let n = 0;
    return {
        holder: { table: null as any },
        mockAudit: vi.fn(),
        nextUuid: () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`,
    };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => holder.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
// As in the capture: the reconciliation's write order follows the sort order of product ids.
vi.mock("crypto", async (original) => ({ ...(await original<typeof import("crypto")>()), randomUUID: nextUuid }));

import { handler } from "../../src/import/glam-pricelist.js";
import { checkUpload, planGlamImport } from "../../src/import/glam/map.js";
import { parseGlamCsv } from "../../src/import/glam/parse.js";
import { DEFAULT_PROFILE, resolveProfile } from "../../src/import/glam/profile.js";

const GOLDEN_FILE = path.resolve(__dirname, "fixtures/glam/cat-import-profile-1-baseline.json");
const golden = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as { goldenTime: string; cases: Record<string, any> };

/** The response members CAT-IMPORT-PROFILE-1 adds (§ 3.5). Everything else must equal the golden. */
const ADDED_MEMBERS = ["profile", "sheets", "specKeys", "drafts", "siteProducts", "specLineRefusals"] as const;

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const event = (body: unknown, dryRun: boolean) => ({
    headers: { "x-tenant-id": "t1" },
    queryStringParameters: dryRun ? { dryRun: "1" } : undefined,
    routeKey: "POST /import/glam-pricelist",
    requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
}) as any;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(GOLDEN_TIME));
    vi.spyOn(Math, "random").mockReturnValue(0);
    mockAudit.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const VARIANTS = [
    ["(a) no profileChoice", undefined],
    ["(b) profileChoice = DEFAULT_PROFILE, baseRevision null", { profile: DEFAULT_PROFILE, baseRevision: null }],
] as const;

describe("CAT-IMPORT-PROFILE-1A golden — no stored profile: every import is the base commit's", () => {
    it("the golden file is the one recorded in the slice report (base b0a3055)", () => {
        expect(golden.goldenTime).toBe(GOLDEN_TIME);
        expect(Object.keys(golden.cases)).toEqual(goldenInputs().map((i) => i.name));
    });

    for (const input of goldenInputs()) {
        for (const [name, profileChoice] of VARIANTS) {
            it(`${input.name}: ${name} → plan, write history, audit and response equal the golden; no profile item`, async () => {
                const table = new MemoryTable();
                holder.table = table;
                table.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Glam", catalogMode: true });
                const added: Record<string, Record<string, unknown>> = {};
                const call = async (body: Record<string, unknown>, dryRun: boolean) => {
                    const res = (await handler(event(profileChoice ? { ...body, profileChoice } : body, dryRun), {} as any, () => {})) as any;
                    const parsed = JSON.parse(res.body);
                    const kept: Record<string, unknown> = {};
                    const extra: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(parsed)) ((ADDED_MEMBERS as readonly string[]).includes(k) ? extra : kept)[k] = v;
                    added[`${dryRun ? "dry" : "exec"}-${Object.keys(added).length}`] = extra;
                    return { status: res.statusCode as number, body: kept };
                };
                const captured = await captureCase(input, table, call, mockAudit);
                expect(mask(captured)).toEqual(golden.cases[input.name]);

                // the plan of the handler's own resolution for this request is today's plan
                const parsed = parseGlamCsv(input.csvContent);
                const upload = checkUpload(input);
                if (parsed.kind !== "parsed" || upload.kind !== "accepted") throw new Error("golden input must parse");
                const resolution = resolveProfile(profileChoice ?? null, { kind: "none" }, "execution");
                expect(resolution.kind).toBe("unprofiled");
                expect(mask(planGlamImport(parsed.rows, upload.upload, undefined))).toEqual(golden.cases[input.name].plan);
                expect(mask(planOf(input))).toEqual(golden.cases[input.name].plan);

                // inert: no profile item, no stamp, no refusal list; the added members say "default"/"explicit", revision null
                expect(table.all("IMPORTPROFILE#")).toEqual([]);
                for (const product of table.all("PRODUCT#")) {
                    expect("importProfileRevision" in product || "facetModes" in product).toBe(false);
                }
                for (const extra of Object.values(added)) {
                    expect("specLineRefusals" in extra).toBe(false);
                    if (extra.profile) expect(extra.profile).toMatchObject({ source: profileChoice ? "explicit" : "default", revision: null });
                }
            }, 60_000);
        }
    }
});
