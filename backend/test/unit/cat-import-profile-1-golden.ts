import { BatchWriteCommand, DeleteCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { readFileSync } from "fs";
import * as path from "path";
import type { MemoryTable } from "./memory-table.js";
import { parseGlamCsv } from "../../src/import/glam/parse.js";
import { checkUpload, planGlamImport } from "../../src/import/glam/map.js";

/**
 * CAT-IMPORT-PROFILE-1A — the inputs, the masking and the capture steps of the 1a golden
 * (docs/slices/cat-import-profile-1.md § 7.3). Test helper, not a test file. Two users:
 *  - `cat-import-profile-1-golden.capture.test.ts` runs it on the BASE commit and writes
 *    `fixtures/glam/cat-import-profile-1-baseline.json` (re-capture command in that file's header);
 *  - `glam-profile-golden.test.ts` runs it on the current code and compares with that file.
 * The plan is computed with `planGlamImport(rows, upload)` — the call form the base commit has.
 */

type Item = Record<string, any>;

/**
 * The response members added after the golden's base commit b0a3055: CAT-IMPORT-PROFILE-1 § 3.5 (`profile` …
 * `specLineRefusals`) and CAT-IMAGE-GATE-1 § 3 item 4 (`publication`). The golden holds the base commit's response
 * shape: the capture leaves these out of every response (a no-op on a commit that does not send them) and the
 * comparison removes them before comparing (`glam-profile-golden.test.ts`). Every other member must equal the golden.
 */
export const ADDED_MEMBERS = ["profile", "sheets", "specKeys", "drafts", "siteProducts", "specLineRefusals", "publication"] as const;

/** `body` without the `ADDED_MEMBERS` (`kept`) and those members alone (`extra`). */
export function splitAddedMembers(body: Record<string, unknown>): { kept: Record<string, unknown>; extra: Record<string, unknown> } {
    const kept: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) ((ADDED_MEMBERS as readonly string[]).includes(k) ? extra : kept)[k] = v;
    return { kept, extra };
}

/** The fixed clock of a capture: every `Date` (ISO stamps, `Date.now()`) is this instant. */
export const GOLDEN_TIME = "2026-10-31T12:00:00.000Z";

const HEADER = "colectie,produs,cod vechi,pret achizitie,pret lista,cod nou,unitate,impachetare,comanda minima,imagine,specificatii,format";
const q = (c: string) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
interface Row { c: string; p: string; old?: string; neu?: string; unit?: string; pack?: string; min?: string; img?: string; specs?: string; f?: string }
/** Columns 3–4 always carry prices; columns 2/5 carry the row's codes. Neither may reach a written item. */
const csv = (...rows: Row[]) => [HEADER, ...rows.map((r) =>
    [r.c, r.p, r.old ?? "", "111.11", "222.22", r.neu ?? "", r.unit ?? "mp", r.pack ?? "", r.min ?? "", r.img ?? "", r.specs ?? "", r.f ?? ""]
        .map(q).join(","))].join("\n") + "\n";
const img = (n: number) => `https://img.test/${n}.jpg`;

export interface GoldenInput {
    readonly name: string;
    readonly csvContent: string;
    readonly producer: string;
    readonly sheet: string;
    readonly variantName?: string;
    /** Items stored before the case runs (besides the tenant record). */
    readonly seed: readonly Item[];
}

const boen = () => readFileSync(path.resolve(__dirname, "fixtures/glam/boen-PL.csv"), "utf8");

/**
 * The § 7.3 inputs: the BOEN fixture, and synthetic files covering duplicates, empty labels, a quoted comma, a
 * same-row code line, a cross-row code line, a `Price:` line — plus skipped rows, a slug collision, two collections,
 * a file with no product row, and a tenant with another sheet's and a hand-made product.
 */
export function goldenInputs(): GoldenInput[] {
    return [
        {
            name: "synthetic-mixed",
            producer: "Prod X",
            sheet: "Sheet 1",
            variantName: "Format",
            seed: [
                { PK: "TENANT#t1", SK: "PRODUCT#hand", id: "hand", title: "Hand made", status: "active", categoryIds: ["prod-x"] },
                { PK: "TENANT#t1", SK: "PRODUCT#other", id: "other", title: "Other sheet", importSource: "glam:prod x/sheet 2", categoryIds: [] },
            ],
            csvContent: csv(
                // a quoted comma in the name; the same-row code line is removed; a Price: line is kept (today)
                { c: "Herringbone", p: "Oak Vivo, matt", old: "C-1", neu: "N-1", f: "120", img: img(1),
                  specs: "Wood: Oak\nArticle no.: C-1\nPrice: 25 EUR\nSurface: brushed, lacquered" },
                // duplicate: equal label and equal image → deduped
                { c: "Herringbone", p: "Oak Vivo, matt", old: "C-2", f: "120", img: img(1), specs: "Wood: Oak" },
                // empty labels with distinct images → #1, #2
                { c: "Herringbone", p: "Oak Vivo, matt", old: "C-3", f: "", img: img(2) },
                { c: "Herringbone", p: "Oak Vivo, matt", old: "C-4", f: "", img: img(3), specs: "Wood: Ash" },
                // repeated label with distinct images → x, x (2); a cross-row code line (C-1 is row 2's code) is kept
                { c: "Herringbone", p: "Ash", neu: "N-5", f: "x", img: img(4), specs: "Alternate article: C-1\nPart: N-5" },
                { c: "Herringbone", p: "Ash", f: "x", img: img(5) },
                // a quoted comma in the format; a second collection
                { c: "Chevron", p: "Oak Vivo, matt", f: "90, 2 mm", specs: "Format: 90x600\nCost class: A" },
                // slug collision with the next row: "oak-vivo" twice in one collection
                { c: "Chevron", p: "Oak-Vivo", f: "1" },
                { c: "Chevron", p: "Oak Vivo", f: "2", img: "not a url" },
                // skipped rows: no collection, no name
                { c: "", p: "Orphan", f: "1" },
                { c: "Chevron", p: "", f: "1" },
                // a value with ':' inside and an empty-value line
                { c: "Chevron", p: "Larch", unit: "buc", pack: "cutie", min: "10", specs: "Note: a: b\nAppearance:\nStyle: Classic, Nordic" },
            ),
        },
        {
            name: "synthetic-no-product",
            producer: "Prod X",
            sheet: "Sheet 3",
            seed: [],
            csvContent: csv({ c: "", p: "Oak" }, { c: "Coll", p: "" }),
        },
        {
            name: "boen-PL",
            producer: "BOEN",
            sheet: "PL",
            variantName: "Format",
            seed: [],
            csvContent: boen(),
        },
    ];
}

/** The plan today's core makes for one input (the dry run and the execution make the same). */
export function planOf(input: GoldenInput) {
    const parsed = parseGlamCsv(input.csvContent);
    if (parsed.kind !== "parsed") return { refused: parsed.error };
    const upload = checkUpload(input);
    if (upload.kind !== "accepted") return { refused: upload.error };
    return planGlamImport(parsed.rows, upload.upload);
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

/**
 * Masking (§ 7.3): every UUID (product ids, variant-group ids, the lock owner) → `<uuid-n>` and every ISO timestamp →
 * `<ts-n>`, numbered in order of first appearance in the JSON text of `value`.
 */
export function mask(value: unknown): unknown {
    const ids = new Map<string, string>();
    const stamps = new Map<string, string>();
    const text = JSON.stringify(value)
        .replace(UUID, (m) => { if (!ids.has(m)) ids.set(m, `<uuid-${ids.size + 1}>`); return ids.get(m)!; })
        .replace(ISO, (m) => { if (!stamps.has(m)) stamps.set(m, `<ts-${stamps.size + 1}>`); return stamps.get(m)!; });
    return JSON.parse(text);
}

/** Every write command the handler sent (Put / Delete / Update / BatchWrite), in order, as `{ command, input }`. */
export function writeHistory(table: MemoryTable): { command: string; input: unknown }[] {
    return table.commands
        .filter((c) => c instanceof PutCommand || c instanceof DeleteCommand || c instanceof UpdateCommand || c instanceof BatchWriteCommand)
        .map((c) => ({ command: c.constructor.name, input: JSON.parse(JSON.stringify(c.input)) }));
}

export interface GoldenStep {
    readonly status: number;
    readonly body: Item;
    readonly writes: { command: string; input: unknown }[];
    readonly audit: unknown[];
}

/**
 * One case: on a table holding the tenant record and `input.seed`, a dry run, an execution, and a second execution
 * of the same file (the replace path). `call` sends one request to the handler; `audit` lists the audit calls.
 */
export async function captureCase(
    input: GoldenInput,
    table: MemoryTable,
    call: (body: Item, dryRun: boolean) => Promise<{ status: number; body: Item }>,
    audit: { mock: { calls: unknown[][] }; mockClear: () => void },
): Promise<{ plan: unknown; steps: Record<"dryRun" | "execution" | "reExecution", GoldenStep> }> {
    for (const item of input.seed) table.put(item);
    const body = { csvContent: input.csvContent, producer: input.producer, sheet: input.sheet, ...(input.variantName ? { variantName: input.variantName } : {}) };
    const step = async (dryRun: boolean): Promise<GoldenStep> => {
        table.commands = [];
        audit.mockClear();
        const res = await call(body, dryRun);
        return { status: res.status, body: res.body, writes: writeHistory(table), audit: audit.mock.calls.map((c) => c[0]) };
    };
    const dryRun = await step(true);
    const execution = await step(false);
    const reExecution = await step(false);
    return { plan: planOf(input), steps: { dryRun, execution, reExecution } };
}
