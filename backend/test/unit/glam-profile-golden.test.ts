import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";
import { MemoryTable } from "./memory-table.js";
import { GOLDEN_TIME, RO_SITE, captureCase, goldenInputs, mask, planOf, splitAddedMembers, type GoldenInput } from "./cat-import-profile-1-golden.js";

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
 *
 * CDL-1 (docs/slices/catalog-data-labels-1.md § 4.10, slice record docs/slices/cdl-1.md) — the capture is kept, never
 * re-captured. Only these named deltas, each with its own assertion; no field is stripped by a general rule:
 *   D1 the comparing run's tenant item has `locale: "ro-RO"` (an input: the site labels are the captured words);
 *   D2 every PRODUCT# Put payload gains `importLabels` (`withoutProductImportLabels`);
 *   D3 every `plan.styles[].draft` gains `importLabels` (`withoutPlanDeltas`);
 *   D4 the plan gains `variantName`; `plan.upload.variantName` is absent when the input sent no name (`withoutPlanDeltas`);
 *   D5 the responses gain `labels` and `otherLabels` (`ADDED_MEMBERS`; values asserted in `assertLabelMembers`);
 *   D6 the `planGlamImport` calls pass the Romanian site labels (`planOf`, the call below, `RO_SITE`).
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

/**
 * ADMIN-ENGLISH-1 (docs/slices/admin-english-1.md): the one intended change since the capture — the audit target title
 * of an import is English ("Pricelist <producer> / <sheet>"; captured: "Listă de prețuri <producer> / <sheet>"). The
 * golden file stays the base capture; this maps exactly that member of every captured audit call and throws when a
 * captured title is not in the old form, so no other byte of the golden is relaxed.
 */
const CAPTURED_TITLE_PREFIX = "Listă de prețuri ";
function withEnglishAuditTitles(goldenCase: any): any {
    const steps = Object.fromEntries(Object.entries(goldenCase.steps).map(([key, step]: [string, any]) => [key, {
        ...step,
        audit: step.audit.map((call: any) => {
            const title: string = call.target.title;
            if (!title.startsWith(CAPTURED_TITLE_PREFIX)) throw new Error(`golden audit title not in the captured form: ${title}`);
            return { ...call, target: { ...call.target, title: `Pricelist ${title.slice(CAPTURED_TITLE_PREFIX.length)}` } };
        }),
    }]));
    return { ...goldenCase, steps };
}

/** D2, D3: the literal every removed `importLabels` must equal (the four words the capture holds as attribute keys). */
const RO_LABELS = { "collection": "colecție", "unit": "unitate", "packaging": "împachetare", "minimumOrder": "comandă minimă" };

/** D5: the header cells of each golden input's label columns, as literals. */
const FILE_LABELS: Record<string, Record<string, string>> = {
    "synthetic-mixed": { collection: "colectie", unit: "unitate", packaging: "impachetare", minimumOrder: "comanda minima" },
    "synthetic-no-product": { collection: "colectie", unit: "unitate", packaging: "impachetare", minimumOrder: "comanda minima" },
    "boen-PL": { collection: "colectie", unit: "unitate de masura", packaging: "unitate de impachetare", minimumOrder: "comanda minima" },
};

const isProductPut = (w: { command: string; input: any }) => w.command === "PutCommand" && String(w.input?.Item?.SK ?? "").startsWith("PRODUCT#");

/**
 * D2 — `captured` with `importLabels` removed from every PRODUCT# Put payload of every step, after asserting that each
 * holds it with the literal value. Throws when a payload of the golden capture already holds the member (the capture
 * is pre-cdl-1), or when a payload of this run that is not a PRODUCT# Put holds it.
 */
function withoutProductImportLabels(captured: any, goldenCase: any): any {
    for (const step of Object.values(goldenCase.steps) as any[]) {
        for (const w of step.writes) if (JSON.stringify(w).includes("importLabels")) throw new Error("D2: a captured payload already holds importLabels");
    }
    const steps = Object.fromEntries(Object.entries(captured.steps).map(([key, step]: [string, any]) => [key, {
        ...step,
        writes: step.writes.map((w: any) => {
            if (!isProductPut(w)) {
                if (JSON.stringify(w).includes("importLabels")) throw new Error(`D2: a non-PRODUCT payload holds importLabels (${w.command})`);
                return w;
            }
            const { importLabels, ...item } = w.input.Item;
            expect(importLabels, `D2 ${key} ${item.SK}`).toEqual(RO_LABELS);
            return { ...w, input: { ...w.input, Item: item } };
        }),
    }]));
    return { ...captured, steps };
}

/**
 * D3 + D4 — the plan without its cdl-1 members, after asserting them: every draft's `importLabels` equals the literal
 * (D3); `plan.variantName` equals the captured `plan.upload.variantName` (D4), and for an input that sent no name the
 * new `upload` has no `variantName` — the captured one is compared with `plan.variantName` instead, then left out of
 * the captured upload for the comparison. Throws when a captured draft already holds `importLabels`. No other member is
 * touched. Returns the plan to compare and the golden plan to compare it with.
 */
function withoutPlanDeltas(plan: any, goldenPlan: any, input: GoldenInput): { plan: any; golden: any } {
    for (const style of goldenPlan.styles) if ("importLabels" in style.draft) throw new Error("D3: a captured draft already holds importLabels");
    const { variantName, ...rest } = plan;
    expect(variantName, `D4 ${input.name}`).toBe(goldenPlan.upload.variantName);
    const styles = rest.styles.map((style: any) => {
        const { importLabels, ...draft } = style.draft;
        expect(importLabels, `D3 ${input.name} ${draft.slug}`).toEqual(RO_LABELS);
        return { ...style, draft };
    });
    if (input.variantName !== undefined) return { plan: { ...rest, styles }, golden: goldenPlan };
    expect(rest.upload, `D4 ${input.name}`).not.toHaveProperty("variantName");
    const { variantName: capturedName, ...goldenUpload } = goldenPlan.upload;
    expect(capturedName, `D4 ${input.name}`).toBe(variantName);
    return { plan: { ...rest, styles }, golden: { ...goldenPlan, upload: goldenUpload } };
}

/** D5 — `labels` and `otherLabels` in the answers: in every dry-run answer both; values wherever present. */
function assertLabelMembers(input: GoldenInput, added: Record<string, Record<string, unknown>>) {
    const dry = Object.entries(added).filter(([key]) => key.startsWith("dry-"));
    expect(dry.length, "D5 one dry run").toBe(1);
    for (const [, extra] of dry) {
        expect(extra, `D5 ${input.name} dry run`).toHaveProperty("labels");
        expect(extra, `D5 ${input.name} dry run`).toHaveProperty("otherLabels");
    }
    for (const [key, extra] of Object.entries(added)) {
        if ("labels" in extra) {
            expect(extra.labels, `D5 ${input.name} ${key}`).toEqual({
                site: { collection: "colecție", unit: "unitate", packaging: "împachetare", minimumOrder: "comandă minimă" },
                file: FILE_LABELS[input.name],
                used: "site",
            });
        }
        if ("otherLabels" in extra) expect(extra.otherLabels, `D5 ${input.name} ${key}`).toEqual([]);
    }
}

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
                // D1: the tenant is a Romanian site, so its site labels are the words the capture holds.
                table.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Glam", catalogMode: true, locale: "ro-RO" });
                const added: Record<string, Record<string, unknown>> = {};
                const call = async (body: Record<string, unknown>, dryRun: boolean) => {
                    const res = (await handler(event(profileChoice ? { ...body, profileChoice } : body, dryRun), {} as any, () => {})) as any;
                    // The members added after the base commit (`ADDED_MEMBERS`) are compared separately below.
                    const { kept, extra } = splitAddedMembers(JSON.parse(res.body));
                    added[`${dryRun ? "dry" : "exec"}-${Object.keys(added).length}`] = extra;
                    return { status: res.statusCode as number, body: kept };
                };
                const captured = await captureCase(input, table, call, mockAudit);
                const goldenCase = withEnglishAuditTitles(golden.cases[input.name]);
                const compared = withoutPlanDeltas(captured.plan, goldenCase.plan, input);
                expect(mask({ ...withoutProductImportLabels(captured, goldenCase), plan: compared.plan })).toEqual({ ...goldenCase, plan: compared.golden });
                assertLabelMembers(input, added);

                // the plan of the handler's own resolution for this request is today's plan
                const parsed = parseGlamCsv(input.csvContent);
                const upload = checkUpload(input);
                if (parsed.kind !== "parsed" || upload.kind !== "accepted") throw new Error("golden input must parse");
                const resolution = resolveProfile(profileChoice ?? null, { kind: "none" }, "execution");
                expect(resolution.kind).toBe("unprofiled");
                const direct = withoutPlanDeltas(planGlamImport(parsed.rows, upload.upload, RO_SITE.siteLabels, RO_SITE.variantName, undefined), golden.cases[input.name].plan, input);
                expect(mask(direct.plan)).toEqual(direct.golden);
                const viaHelper = withoutPlanDeltas(planOf(input), golden.cases[input.name].plan, input);
                expect(mask(viaHelper.plan)).toEqual(viaHelper.golden);

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
