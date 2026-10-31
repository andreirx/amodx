import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";
import { MemoryTable } from "./memory-table.js";
import { GOLDEN_TIME, captureCase, goldenInputs, mask, planOf, splitAddedMembers } from "./cat-import-profile-1-golden.js";

/**
 * CAT-IMPORT-PROFILE-1A — preservation against the golden captured from a BASE commit
 * (docs/slices/cat-import-profile-1.md § 7.3; § 2.8 "the byte-identity promise"). The golden file was written by
 * `cat-import-profile-1-golden.capture.test.ts` running on base code; this file runs the SAME steps
 * (`captureCase`) on the current code and compares — never two new code paths with each other.
 * First capture: b0a3055 (unchanged). Re-capture (CAT-IMAGE-GATE-1, docs/slices/cat-image-gate-1.md § 5 and § 7):
 * b5ef8fb with only `productItem`'s `status` changed to `"draft"` — the one intended change of an import without a
 * profile; the re-captured file differs from the b0a3055 one only in `status` values (diff in the slice record).
 *
 * (a) no `profileChoice`, no stored profile; (b) `profileChoice = DEFAULT_PROFILE` (baseRevision null), no stored
 * profile. Each must give the golden plan, the golden write history (every write command's payload, in order), the
 * golden audit calls and the golden response — after removing ONLY the response members added after b0a3055
 * (`ADDED_MEMBERS`, additive) — and write no `IMPORTPROFILE#` item. CAT-SLUG-UNIQUE-1 added `crossSheetSuffixed`
 * to `ADDED_MEMBERS` with no re-capture: it must be `[]` here (asserted below), so every write is unchanged.
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

describe("CAT-IMPORT-PROFILE-1A golden — no stored profile: every import equals the base capture (b5ef8fb, products written draft)", () => {
    it("the golden file has the capture clock and one case per golden input (re-captured from b5ef8fb + the status change)", () => {
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
                    // The members added after the base commit (`ADDED_MEMBERS`) are compared separately below.
                    const { kept, extra } = splitAddedMembers(JSON.parse(res.body));
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
                    // CAT-SLUG-UNIQUE-1: no golden input has a slug held outside its own sheet → nothing suffixed
                    if ("crossSheetSuffixed" in extra) expect(extra.crossSheetSuffixed).toEqual([]);
                    if (extra.profile) expect(extra.profile).toMatchObject({ source: profileChoice ? "explicit" : "default", revision: null });
                }
            }, 60_000);
        }
    }
});
