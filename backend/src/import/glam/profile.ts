import { z } from "zod";
import {
    GlamImportProfileSchema,
    type FacetModes, type GlamImportProfile,
} from "@amodx/shared";
import { wholeTokenPattern, type GlamRow } from "./parse.js";
import { foldTokens, norm } from "./group.js";

/**
 * CAT-IMPORT-PROFILE-1A — the per-producer import profile, pure (docs/slices/cat-import-profile-1.md § 2–§ 4, rulings
 * § 11). Text and values in, values out; no I/O. It reads only `GlamRow` fields (the parser's closed set) and the
 * file's code cells as an opaque set (`parseGlamCsv(...).codeCells`); it never sees a raw CSV record.
 *
 * - `checkProfile`, `parseProfileChoice`, `readStoredProfile`, `resolveProfile` — which profile an import uses and
 *   whether it must be saved first (§ 3.2, § 3.3, § 3.5).
 * - `applyProfileToRows` — grouping (§ 2.1) and the collection source (§ 2.3), BEFORE the unchanged `groupStyles`.
 * - `extractAttributes` — spec lines → attributes, the union over the style's rows (§ 2.4, § 2.5).
 * - `guardSpecLine` — the value guard on every spec line a profile selects (§ 4.3; ruling B1 with T3).
 * - `analyseSpecKeys` — the dry run's per-key facts (§ 3.5 `specKeys`).
 * The prose (`description`, `longDescription`) is not touched here: ruling CIP1-PROSE = A.
 */

/**
 * The column attribute keys (catalog-mode-1 § 3.4 column table), in the order `map.ts` writes them. A profile cannot
 * rename them or reuse them as a label (§ 2.4): `colecție` is read by name by the interest list (interest/public.ts).
 */
export const COLUMN_ATTRIBUTE = {
    collection: "colecție",
    unit: "unitate",
    packaging: "împachetare",
    minimumOrder: "comandă minimă",
} as const;

/** § 2.8: today's behaviour. With it `applyProfileToRows` returns the rows unchanged and `extractAttributes` nothing. */
export const DEFAULT_PROFILE: GlamImportProfile = {
    version: 1,
    grouping: { kind: "as-is" },
    collection: { kind: "column" },
    specKeys: [],
    facetModes: { attributes: [] },
};

function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

// ── Validation (§ 3.2) ──────────────────────────────────────────────────────────────────────────────────────────────

export type ProfileCheck = { readonly kind: "accepted" } | { readonly kind: "refused"; readonly error: string };

const refusedCheck = (error: string): ProfileCheck => ({ kind: "refused", error });
const untrimmed = (text: string) => text !== text.trim() || text.trim() === "";

/**
 * The rules beyond the shape: every key and label is non-empty and has no leading or trailing space (a key is matched
 * exactly, as the file spells it); spec keys are unique; a label is not a column key (compared with `norm`); the
 * collection spec key is not also in `specKeys`; each `facetModes.attributes` key is set once (so never both
 * `always` and `never`).
 */
export function checkProfile(profile: GlamImportProfile): ProfileCheck {
    const columnKeys = new Set(Object.values(COLUMN_ATTRIBUTE).map(norm));
    const keys = new Set<string>();
    for (const rule of profile.specKeys) {
        if (untrimmed(rule.key)) return refusedCheck(`The spec key "${rule.key}" is empty or has leading or trailing spaces.`);
        if (keys.has(rule.key)) return refusedCheck(`The spec key "${rule.key}" is listed twice.`);
        keys.add(rule.key);
        switch (rule.action) {
            case "attribute":
                if (untrimmed(rule.label)) return refusedCheck(`The label of "${rule.key}" is empty or has leading or trailing spaces.`);
                if (columnKeys.has(norm(rule.label))) {
                    return refusedCheck(`The label "${rule.label}" of "${rule.key}" is the name of a column attribute; choose another label.`);
                }
                break;
            case "prose-only":
                break;
            default:
                return assertNever(rule);
        }
    }
    switch (profile.collection.kind) {
        case "column":
            break;
        case "spec":
            if (untrimmed(profile.collection.key)) return refusedCheck("The collection spec key is empty or has leading or trailing spaces.");
            if (keys.has(profile.collection.key)) {
                return refusedCheck(`The spec key "${profile.collection.key}" is the collection source; it cannot also be in the key list.`);
            }
            break;
        default:
            return assertNever(profile.collection);
    }
    const modes = new Set<string>();
    for (const mode of profile.facetModes.attributes) {
        if (untrimmed(mode.key)) return refusedCheck(`The filter-mode key "${mode.key}" is empty or has leading or trailing spaces.`);
        if (modes.has(mode.key)) return refusedCheck(`The filter mode of "${mode.key}" is set twice.`);
        modes.add(mode.key);
    }
    return { kind: "accepted" };
}

/** JSON with object keys sorted at every level: two equal profiles give one text (B-4, § 3.5 "stored equals sent"). */
function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

const sameProfile = (a: GlamImportProfile, b: GlamImportProfile) => canonicalJson(a) === canonicalJson(b);

function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
    return issues.map((i) => `${i.path.length ? i.path.join(".") : "(profile)"}: ${i.message}`).join("; ");
}

// ── The stored item and the request's choice (§ 3.1, § 3.3, § 3.5) ───────────────────────────────────────────────

/** The sort key of a producer's profile item, under `TENANT#<tenantId>` (§ 3.1). */
export const profileSortKey = (producer: string) => `IMPORTPROFILE#glam#${norm(producer)}`;

export type StoredProfile =
    | { readonly kind: "none" }
    | { readonly kind: "supported"; readonly revision: number; readonly profile: GlamImportProfile }
    /** § 3.3 item 4: it does not parse (strictly) or breaks `checkProfile` — never applied in part. */
    | { readonly kind: "unsupported"; readonly revision: number; readonly reason: string };

/**
 * The stored item → its state. A missing or non-positive-integer `revision` means the item was not written by this
 * importer's rule: an internal fault, thrown (the handler answers 500 naming the step).
 */
export function readStoredProfile(item: Record<string, unknown> | undefined): StoredProfile {
    if (!item) return { kind: "none" };
    const revision = item.revision;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
        throw new Error(`Internal: the stored import profile has no valid revision (${JSON.stringify(revision)}).`);
    }
    const parsed = GlamImportProfileSchema.safeParse(item.profile);
    if (!parsed.success) return { kind: "unsupported", revision, reason: describeIssues(parsed.error.issues) };
    const check = checkProfile(parsed.data);
    switch (check.kind) {
        case "accepted": return { kind: "supported", revision, profile: parsed.data };
        case "refused": return { kind: "unsupported", revision, reason: check.error };
        default: return assertNever(check);
    }
}

/** `profileChoice` of the request (§ 3.5): the profile to use and the stored revision the admin loaded (`null` = none). */
export interface ProfileChoice {
    readonly profile: GlamImportProfile;
    readonly baseRevision: number | null;
}

const ProfileChoiceSchema = z.strictObject({
    profile: GlamImportProfileSchema,
    baseRevision: z.number().int().positive().nullable(),
});

export type ProfileChoiceParse =
    | { readonly kind: "absent" }
    | { readonly kind: "accepted"; readonly choice: ProfileChoice }
    | { readonly kind: "refused"; readonly error: string };

/** Absent member → `absent`; otherwise the strict shape and `checkProfile`, or a refusal (the handler answers 400). */
export function parseProfileChoice(raw: unknown): ProfileChoiceParse {
    if (raw === undefined) return { kind: "absent" };
    const parsed = ProfileChoiceSchema.safeParse(raw);
    if (!parsed.success) return { kind: "refused", error: `profileChoice is not valid: ${describeIssues(parsed.error.issues)}` };
    const check = checkProfile(parsed.data.profile);
    switch (check.kind) {
        case "accepted": return { kind: "accepted", choice: parsed.data };
        case "refused": return { kind: "refused", error: `The import profile is not valid: ${check.error}` };
        default: return assertNever(check);
    }
}

/** Which profile an import uses, and whether the profile item must be written first. */
export type ProfileResolution =
    /** No profile item exists and none is written: today's import, item for item (§ 2.8). No stamps. */
    | { readonly kind: "unprofiled"; readonly source: "default" | "explicit"; readonly profile: GlamImportProfile }
    /** Profiled with the stored profile; nothing to write (the sent profile, if any, equals it). */
    | { readonly kind: "stored"; readonly source: "stored" | "explicit"; readonly revision: number; readonly profile: GlamImportProfile }
    /** Profiled with the sent profile, written first as `revision`, conditioned on `observedRevision` (`null` = none stored). */
    | { readonly kind: "save"; readonly revision: number; readonly observedRevision: number | null; readonly profile: GlamImportProfile }
    /** The stored profile is unsupported and no choice replaces it: a dry run reports it; an execution answers 409. */
    | { readonly kind: "unsupported"; readonly revision: number; readonly reason: string }
    /** Execution only: the choice was made against another stored revision and its content differs (409). */
    | { readonly kind: "changed"; readonly storedRevision: number | null; readonly baseRevision: number | null };

/**
 * § 2.8 and § 3.5. Without a choice: the stored profile, else the default (unprofiled). With a choice: equal to the
 * stored profile → use it (no write); else, in an execution, accepted only when `baseRevision` is the stored revision
 * (`null` = none stored) → saved as the next revision. A choice equal to `DEFAULT_PROFILE` while none is stored stays
 * unprofiled. A dry run applies the choice without the acceptance rule (it writes nothing; the execution decides).
 */
export function resolveProfile(choice: ProfileChoice | null, stored: StoredProfile, mode: "dry-run" | "execution"): ProfileResolution {
    if (choice === null) {
        switch (stored.kind) {
            case "none": return { kind: "unprofiled", source: "default", profile: DEFAULT_PROFILE };
            case "supported": return { kind: "stored", source: "stored", revision: stored.revision, profile: stored.profile };
            case "unsupported": return { kind: "unsupported", revision: stored.revision, reason: stored.reason };
            default: return assertNever(stored);
        }
    }
    /** The acceptance rule of § 3.5 applies to an execution only; a dry run writes nothing. */
    const accepts = (storedRevision: number | null): boolean => {
        switch (mode) {
            case "dry-run": return true;
            case "execution": return choice.baseRevision === storedRevision;
            default: return assertNever(mode);
        }
    };
    switch (stored.kind) {
        case "none":
            if (sameProfile(choice.profile, DEFAULT_PROFILE)) return { kind: "unprofiled", source: "explicit", profile: choice.profile };
            if (!accepts(null)) return { kind: "changed", storedRevision: null, baseRevision: choice.baseRevision };
            return { kind: "save", revision: 1, observedRevision: null, profile: choice.profile };
        case "supported":
            if (sameProfile(choice.profile, stored.profile)) {
                return { kind: "stored", source: "explicit", revision: stored.revision, profile: stored.profile };
            }
            if (!accepts(stored.revision)) return { kind: "changed", storedRevision: stored.revision, baseRevision: choice.baseRevision };
            return { kind: "save", revision: stored.revision + 1, observedRevision: stored.revision, profile: choice.profile };
        case "unsupported":
            // § 3.3 item 5: only the first clause can apply (an unsupported profile cannot equal a sent one).
            if (!accepts(stored.revision)) return { kind: "changed", storedRevision: stored.revision, baseRevision: choice.baseRevision };
            return { kind: "save", revision: stored.revision + 1, observedRevision: stored.revision, profile: choice.profile };
        default:
            return assertNever(stored);
    }
}

/** The stored item as the response states it next to an explicit choice (never the stored value itself). */
export type StoredState =
    | { readonly kind: "none" }
    | { readonly kind: "supported"; readonly revision: number }
    | { readonly kind: "unsupported"; readonly revision: number; readonly reason: string };

function storedState(stored: StoredProfile): StoredState {
    switch (stored.kind) {
        case "none": return { kind: "none" };
        case "supported": return { kind: "supported", revision: stored.revision };
        case "unsupported": return { kind: "unsupported", revision: stored.revision, reason: stored.reason };
        default: return assertNever(stored);
    }
}

/** The response member `profile` (§ 3.5): a sum on `source`. `revision` = the stamp the products get (`null` = none). */
export type ProfileReport =
    | { readonly source: "default"; readonly revision: null; readonly value: GlamImportProfile }
    | { readonly source: "stored"; readonly revision: number; readonly value: GlamImportProfile }
    | { readonly source: "explicit"; readonly revision: number | null; readonly value: GlamImportProfile; readonly stored: StoredState }
    | { readonly source: "unsupported"; readonly revision: number; readonly reason: string };

export function profileReport(resolution: Exclude<ProfileResolution, { kind: "changed" }>, stored: StoredProfile): ProfileReport {
    switch (resolution.kind) {
        case "unprofiled":
            switch (resolution.source) {
                case "default": return { source: "default", revision: null, value: resolution.profile };
                case "explicit": return { source: "explicit", revision: null, value: resolution.profile, stored: storedState(stored) };
                default: return assertNever(resolution);
            }
        case "stored":
            switch (resolution.source) {
                case "stored": return { source: "stored", revision: resolution.revision, value: resolution.profile };
                case "explicit": return { source: "explicit", revision: resolution.revision, value: resolution.profile, stored: storedState(stored) };
                default: return assertNever(resolution);
            }
        case "save":
            return { source: "explicit", revision: resolution.revision, value: resolution.profile, stored: storedState(stored) };
        case "unsupported":
            return { source: "unsupported", revision: resolution.revision, reason: resolution.reason };
        default:
            return assertNever(resolution);
    }
}

/** The copy of the modes written on every product of a profiled import — only when the modes are not empty (§ 3.4). */
export function facetModesOf(profile: GlamImportProfile): FacetModes | undefined {
    const modes = profile.facetModes;
    return modes.variant !== undefined || modes.attributes.length > 0 ? modes : undefined;
}

// ── Spec lines (§ 2.4 line grammar) ─────────────────────────────────────────────────────────────────────────────────

export type Split = "none" | "comma";

/** One spec line that gives a value: key = text before the FIRST `:`, trimmed; value = the rest, trimmed; both non-empty. */
export interface SpecLine {
    readonly line: string;
    readonly key: string;
    readonly value: string;
}

function parseSpecLine(line: string): SpecLine | null {
    const colon = line.indexOf(":");
    if (colon < 0) return null;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    return key === "" || value === "" ? null : { line, key, value };
}

/** The lines of a row's cleaned specs that give a value, in order. */
export function specLinesOf(specs: string): SpecLine[] {
    return specs.split(/\r\n|\r|\n/).flatMap((line) => {
        const parsed = parseSpecLine(line);
        return parsed ? [parsed] : [];
    });
}

/** `split: "comma"`: split on `,`, trim each part, drop empty parts. */
export function splitParts(value: string, split: Split): string[] {
    switch (split) {
        case "none": return [value];
        case "comma": return value.split(",").map((part) => part.trim()).filter((part) => part !== "");
        default: return assertNever(split);
    }
}

// ── The value guard (§ 4.3; ruling CIP1-VALUE-GUARD = B1 with T3, § 11) ─────────────────────────────────────────────

export type GuardReason = "code" | "money";
export type GuardResult = { readonly kind: "kept" } | { readonly kind: "refused"; readonly reason: GuardReason };

/** One refused spec line: which key, which row, why. The line itself is never echoed. */
export interface SpecLineRefusal {
    readonly key: string;
    readonly rowIndex: number;
    readonly reason: GuardReason;
}

/** § 4.3 check 2: currency signs anywhere; currency codes and price words as whole tokens. */
const CURRENCY_SIGN = /[€$£]/u;
export const MONEY_WORDS = ["eur", "ron", "usd", "gbp", "lei", "price", "prices", "preț", "prețuri", "pret", "cost"] as const;
const MONEY_WORD = new RegExp(`(?<![\\p{L}\\p{N}])(?:${MONEY_WORDS.join("|")})(?![\\p{L}\\p{N}])`, "u");
/** The money words folded (T3). Each folds to one token (`preț` → `pret`, `prețuri` → `preturi`). */
const MONEY_FOLDS: ReadonlySet<string> = new Set(MONEY_WORDS.flatMap(foldTokens));

/** The file's code cells, prepared once per file for `guardSpecLine`. */
export interface SpecLineGuard {
    /** B1: each NFC code cell with its whole-token pattern (case-sensitive), as the same-row removal matches it. */
    readonly codes: readonly { readonly code: string; readonly pattern: RegExp }[];
    /** T3: the folded codes of one token, and `-`-wrapped folded codes of several tokens. Empty folds are dropped. */
    readonly foldedSingle: ReadonlySet<string>;
    readonly foldedMulti: readonly string[];
}

export function buildGuard(codeCells: ReadonlySet<string>): SpecLineGuard {
    const codes = [...codeCells].map((cell) => cell.normalize("NFC"));
    const folds = codes.map(foldTokens).filter((tokens) => tokens.length > 0);
    return {
        codes: codes.map((code) => ({ code, pattern: wholeTokenPattern(code) })),
        foldedSingle: new Set(folds.filter((t) => t.length === 1).map((t) => t[0])),
        foldedMulti: folds.filter((t) => t.length > 1).map((t) => `-${t.join("-")}-`),
    };
}

/**
 * A line's GUARDED FRAGMENTS (operator ruling on review-0, item 1): its key, its value and — with `split: "comma"` —
 * the value's list parts; none for a line that gives no value. Folding deletes punctuation (`slugify`), so it joins the
 * characters on both sides of a `:` or `,`: the whole line `Collection:Oak` folds to the one token `collectionoak`,
 * but the value `Oak` that an identifier is computed from folds to `oak`. Obligation (2) as ruled: every token of every
 * identifier derived from a checked spec line is a token of one of these fragments, folded.
 */
export function guardedFragments(line: string, split: Split): string[] {
    const parsed = parseSpecLine(line);
    if (!parsed) return [];
    switch (split) {
        case "none": return [parsed.key, parsed.value];
        case "comma": return [parsed.key, parsed.value, ...splitParts(parsed.value, "comma")];
        default: return assertNever(split);
    }
}

/**
 * The value guard on ONE spec line a profile selects, before it feeds any destination. Refused when:
 *  - code (B1): the NFC line holds a code cell of ANY row of the file as a whole token (case-sensitive);
 *  - code (T3): the folded line or a folded `guardedFragments` fragment holds a folded code cell as whole tokens;
 *  - money (B1): the NFC, lower-cased line holds a currency sign, or a currency code / price word as a whole token;
 *  - money (T3): a folded fragment holds a folded money word as a token.
 * `split` is the cut the destination applies to the value ("none" for the collection).
 */
export function guardSpecLine(line: string, split: Split, guard: SpecLineGuard): GuardResult {
    const nfc = line.normalize("NFC");
    for (const { code, pattern } of guard.codes) {
        if (nfc.includes(code) && pattern.test(nfc)) return { kind: "refused", reason: "code" };
    }
    // The whole line is folded too — stricter than the ruling's fragments (it can only add refusals).
    const folds = [nfc, ...guardedFragments(nfc, split)].map(foldTokens);
    for (const tokens of folds) {
        if (tokens.some((token) => guard.foldedSingle.has(token))) return { kind: "refused", reason: "code" };
        const joined = `-${tokens.join("-")}-`;
        if (guard.foldedMulti.some((code) => joined.includes(code))) return { kind: "refused", reason: "code" };
    }
    const lower = nfc.toLowerCase();
    if (CURRENCY_SIGN.test(lower) || MONEY_WORD.test(lower)) return { kind: "refused", reason: "money" };
    if (folds.some((tokens) => tokens.some((token) => MONEY_FOLDS.has(token)))) return { kind: "refused", reason: "money" };
    return { kind: "kept" };
}

// ── Grouping and collection: rows → rows (§ 2.1, § 2.3) ─────────────────────────────────────────────────────────────

/**
 * The profile's row rules, before `groupStyles`. Each returned row is the input row with, possibly, another `name`
 * (grouping `trailing-number`: the last all-digit token removed), `format` (label `removed-token`: that token) and
 * `collection` (collection `spec`: the guarded value of the row's FIRST line with that key; else the sheet name).
 */
export function applyProfileToRows(
    rows: readonly GlamRow[],
    profile: GlamImportProfile,
    sheet: string,
    guard: SpecLineGuard,
): { rows: GlamRow[]; refused: SpecLineRefusal[] } {
    const refused: SpecLineRefusal[] = [];
    const out = rows.map((row) => {
        let { name, format, collection } = row;
        switch (profile.grouping.kind) {
            case "as-is":
                break;
            case "trailing-number": {
                const tokens = row.name.trim().split(/\s+/);
                const last = tokens[tokens.length - 1];
                if (tokens.length >= 2 && /^\d+$/.test(last)) {
                    name = tokens.slice(0, -1).join(" ");
                    switch (profile.grouping.label) {
                        case "removed-token": format = last; break;
                        case "format-column": break;
                        default: assertNever(profile.grouping.label);
                    }
                }
                break;
            }
            default:
                assertNever(profile.grouping);
        }
        switch (profile.collection.kind) {
            case "column":
                break;
            case "spec": {
                const key = profile.collection.key;
                const line = specLinesOf(row.specs).find((l) => l.key === key);
                collection = sheet;
                if (line) {
                    const verdict = guardSpecLine(line.line, "none", guard);
                    switch (verdict.kind) {
                        case "kept": collection = line.value; break;
                        case "refused": refused.push({ key, rowIndex: row.index, reason: verdict.reason }); break;
                        default: assertNever(verdict);
                    }
                }
                break;
            }
            default:
                assertNever(profile.collection);
        }
        return { ...row, name, format, collection };
    });
    return { rows: out, refused };
}

// ── Extraction (§ 2.4, § 2.5) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The attributes of one product from its rows' spec lines: for each line whose key has an `attribute` rule and that
 * the guard keeps, `{ key: label, value }` per part, in file order, each value once per label (compared with `norm`).
 * Labels appear in the order of their first value. Refused lines give nothing and are reported.
 */
export function extractAttributes(
    rows: readonly GlamRow[],
    profile: GlamImportProfile,
    guard: SpecLineGuard,
): { attributes: { key: string; value: string }[]; refused: SpecLineRefusal[] } {
    const rules = new Map<string, { label: string; split: Split }>();
    for (const rule of profile.specKeys) {
        switch (rule.action) {
            case "attribute": rules.set(rule.key, { label: rule.label, split: rule.split }); break;
            case "prose-only": break; // reviewed, not an attribute: its lines stay prose only
            default: assertNever(rule);
        }
    }
    const refused: SpecLineRefusal[] = [];
    const byLabel = new Map<string, { values: string[]; seen: Set<string> }>();
    for (const row of rows) {
        for (const line of specLinesOf(row.specs)) {
            const rule = rules.get(line.key);
            if (!rule) continue;
            const verdict = guardSpecLine(line.line, rule.split, guard);
            switch (verdict.kind) {
                case "kept": break;
                case "refused":
                    refused.push({ key: line.key, rowIndex: row.index, reason: verdict.reason });
                    continue; // the next line: a refused line gives no attribute
                default: assertNever(verdict);
            }
            let bucket = byLabel.get(rule.label);
            if (!bucket) byLabel.set(rule.label, (bucket = { values: [], seen: new Set() }));
            for (const part of splitParts(line.value, rule.split)) {
                if (bucket.seen.has(norm(part))) continue;
                bucket.seen.add(norm(part));
                bucket.values.push(part);
            }
        }
    }
    const attributes = [...byLabel].flatMap(([key, bucket]) => bucket.values.map((value) => ({ key, value })));
    return { attributes, refused };
}

// ── Dry-run analysis (§ 3.5 `specKeys`) ─────────────────────────────────────────────────────────────────────────────

/**
 * The renderer's repeat rule (renderer/src/lib/facets.ts `MIN_HOLDERS`, `MAX_ATTRIBUTE_VALUES`), restated for the
 * analysis only: ≥ 2 holders, the most frequent value held by ≥ 2, ≤ 40 distinct values. Follow-up: import it from
 * `packages/shared` once `cat-import-profile-1b` moves the facet module there.
 */
const MIN_HOLDERS = 2;
const MAX_ATTRIBUTE_VALUES = 40;
const SAMPLE_COUNT = 5;

export type SpecKeyRuleReport =
    | { readonly action: "attribute"; readonly label: string; readonly split: Split }
    | { readonly action: "prose-only" }
    | { readonly action: "collection" }
    | { readonly action: "not-reviewed" };

export interface SpecKeyAnalysis {
    readonly key: string;
    /** Rows with at least one line of this key that gives a value. */
    readonly rows: number;
    /** Products (under the profile's grouping) holding at least one guard-kept value. */
    readonly products: number;
    /** Distinct values (by `norm`) over the products, cut as the profile's rule cuts them. */
    readonly distinctValues: number;
    /** The number of products holding the most frequent value. */
    readonly maxValueHolders: number;
    readonly repeatRule: "offered" | "not-offered";
    /** Rows whose value of this key contains a ",". */
    readonly commaRows: number;
    /** Products whose rows hold more than one distinct whole value of this key. */
    readonly variantLevelProducts: number;
    /** Rows whose value equals column 11 (format) / column 0 (collection) after `norm` and removing spaces and "mm". */
    readonly equalToFormat: number;
    readonly equalToCollection: number;
    /** Up to 5 distinct guard-kept values, in file order. */
    readonly samples: readonly string[];
    readonly refused: readonly { readonly rowIndex: number; readonly reason: GuardReason }[];
    readonly rule: SpecKeyRuleReport;
}

const compact = (text: string) => norm(text).replace(/\s+/g, "").replace(/mm/g, "");

/**
 * Per spec key of the file (keys in order of first appearance): the facts of § 3.5. `rawRows` = the parsed rows (the
 * column comparisons use the file's own columns 0 and 11); `products` = each planned product's row indexes.
 */
export function analyseSpecKeys(
    rawRows: readonly GlamRow[],
    products: readonly (readonly number[])[],
    profile: GlamImportProfile,
    guard: SpecLineGuard,
): SpecKeyAnalysis[] {
    const ruleOf = (key: string): SpecKeyRuleReport => {
        switch (profile.collection.kind) {
            case "column": break;
            case "spec": if (profile.collection.key === key) return { action: "collection" }; break;
            default: return assertNever(profile.collection);
        }
        const rule = profile.specKeys.find((r) => r.key === key);
        if (!rule) return { action: "not-reviewed" };
        switch (rule.action) {
            case "attribute": return { action: "attribute", label: rule.label, split: rule.split };
            case "prose-only": return { action: "prose-only" };
            default: return assertNever(rule);
        }
    };
    const splitOf = (rule: SpecKeyRuleReport): Split => {
        switch (rule.action) {
            case "attribute": return rule.split;
            case "prose-only":
            case "collection":
            case "not-reviewed":
                return "none";
            default: return assertNever(rule);
        }
    };

    const linesByRow = new Map(rawRows.map((r) => [r.index, specLinesOf(r.specs)]));
    const keys: string[] = [];
    for (const lines of linesByRow.values()) for (const l of lines) if (!keys.includes(l.key)) keys.push(l.key);

    return keys.map((key) => {
        const rule = ruleOf(key);
        const split = splitOf(rule);
        let rows = 0, commaRows = 0, equalToFormat = 0, equalToCollection = 0;
        const refused: { rowIndex: number; reason: GuardReason }[] = [];
        const kept = new Map<number, string[]>(); // row index → kept values of this key (cut by `split`)
        const whole = new Map<number, string[]>(); // row index → whole values (guard-independent)
        for (const row of rawRows) {
            const lines = linesByRow.get(row.index)!.filter((l) => l.key === key);
            if (lines.length === 0) continue;
            rows++;
            if (lines.some((l) => l.value.includes(","))) commaRows++;
            if (lines.some((l) => compact(l.value) === compact(row.format))) equalToFormat++;
            if (lines.some((l) => compact(l.value) === compact(row.collection))) equalToCollection++;
            whole.set(row.index, lines.map((l) => l.value));
            const values: string[] = [];
            for (const l of lines) {
                const verdict = guardSpecLine(l.line, split, guard);
                switch (verdict.kind) {
                    case "kept": values.push(...splitParts(l.value, split)); break;
                    case "refused": refused.push({ rowIndex: row.index, reason: verdict.reason }); break;
                    default: assertNever(verdict);
                }
            }
            kept.set(row.index, values);
        }
        const valueHolders = new Map<string, number>();
        const samples: string[] = [];
        let holders = 0, variantLevelProducts = 0;
        for (const indexes of products) {
            const values = new Set<string>();
            const wholeValues = new Set<string>();
            for (const index of indexes) {
                for (const v of kept.get(index) ?? []) {
                    values.add(norm(v));
                    if (samples.length < SAMPLE_COUNT && !samples.some((s) => norm(s) === norm(v))) samples.push(v);
                }
                for (const v of whole.get(index) ?? []) wholeValues.add(norm(v));
            }
            if (wholeValues.size > 1) variantLevelProducts++;
            if (values.size === 0) continue;
            holders++;
            for (const v of values) valueHolders.set(v, (valueHolders.get(v) ?? 0) + 1);
        }
        const maxValueHolders = valueHolders.size ? Math.max(...valueHolders.values()) : 0;
        const offered = holders >= MIN_HOLDERS && maxValueHolders >= MIN_HOLDERS && valueHolders.size <= MAX_ATTRIBUTE_VALUES;
        return {
            key, rows, products: holders, distinctValues: valueHolders.size, maxValueHolders,
            repeatRule: offered ? "offered" : "not-offered",
            commaRows, variantLevelProducts, equalToFormat, equalToCollection, samples, refused, rule,
        };
    });
}
