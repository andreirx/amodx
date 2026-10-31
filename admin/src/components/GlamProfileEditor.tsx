import { useState } from "react";
import type { FacetModes, GlamImportProfile, SpecKeyRule, FacetValueView } from "@amodx/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    FIDELITY_LIMITS, FIDELITY_NOTICE, PENDING_COPY_LABEL, PENDING_COPY_TITLE, PUBLICATION_NOTICE, categoryLabel, collectionCategoryIds, draftPublication,
    effectivePreviewChoice, hiddenDrafts, previewCards, proseParagraphs, previewPanel, previewProductPage, publishedDrafts,
    producerCategoryId, selectionOfHref, type PreviewItem, type PreviewPanel, type PreviewScope, type SiteContext,
} from "./glamPreview";

/**
 * CAT-IMPORT-PROFILE-1C — the import-profile part of the glam pricelist dialog (design
 * docs/slices/cat-import-profile-1.md § 5.1, § 6.1–6.3, § 6.6, § 3.3; rulings § 11). It holds:
 *   - the dry run's profile members as the API sends them (DTO types, from backend `glam/profile.ts` `ProfileReport`,
 *     `SpecKeyAnalysis` and `glam-pricelist.ts` `SheetReport`);
 *   - the editor's state (`ProfileEditor`) and its pure transitions, which `glamFormReducer` (GlamPricelistImport.tsx)
 *     calls — the state lives in that reducer, so every edit bumps its `revision` and withdraws the shown report;
 *   - `proposeProfile` (§ 6.1 step 3: a proposal, not the default) and the hints from the measured facts;
 *   - the layout: the editor (grouping, collection, key table, filter modes, sheet states) and the preview (cards,
 *     one product page, three filter panels — assembled in `glamPreview.ts`).
 * The backend is the authority for every rule (`checkProfile` answers 400 for a profile it refuses); this file
 * collects the choices and shows facts. Copy is Romanian.
 */

// ── The dry run's profile members (DTOs) ───────────────────────────────────────────────────────────────────────────

/** What the request's `profileChoice` carries (§ 3.5): the profile, and the stored revision the admin loaded. */
export interface ProfileChoice {
    profile: GlamImportProfile;
    baseRevision: number | null;
}

export type StoredStateDTO =
    | { kind: "none" }
    | { kind: "supported"; revision: number }
    | { kind: "unsupported"; revision: number; reason: string };

/** `profile` (§ 3.5): `revision` = the stamp the products get (`null` = none). */
export type ProfileReportDTO =
    | { source: "default"; revision: null; value: GlamImportProfile }
    | { source: "stored"; revision: number; value: GlamImportProfile }
    | { source: "explicit"; revision: number | null; value: GlamImportProfile; stored: StoredStateDTO }
    | { source: "unsupported"; revision: number; reason: string };

/** `sheets[]` (§ 3.4): `importSource` is the normalised id (operator-approved deviation, 1a record § 8 D-5). */
export interface SheetReportDTO {
    importSource: string;
    products: number;
    state: "no-profile" | "current" | "stale" | "mixed";
    revisions: number[];
    unstamped: number;
}

export type SpecKeyRuleReportDTO =
    | { action: "attribute"; label: string; split: "none" | "comma" }
    | { action: "prose-only" }
    | { action: "collection" }
    | { action: "not-reviewed" };

/** One `specKeys[]` entry: the measured facts of one spec key of the file (§ 3.5), under the profile the dry run used. */
export interface SpecKeyFact {
    key: string;
    rows: number;
    products: number;
    distinctValues: number;
    maxValueHolders: number;
    repeatRule: "offered" | "not-offered";
    commaRows: number;
    variantLevelProducts: number;
    equalToFormat: number;
    equalToCollection: number;
    samples: string[];
    refused: { rowIndex: number; reason: "code" | "money" }[];
    rule: SpecKeyRuleReportDTO;
}

/** The members of a glam dry-run answer this file and `glamPreview.ts` read. */
export interface GlamDryRun {
    producer: string;
    importSource: string;
    products: { slug: string; title: string }[];
    profile: ProfileReportDTO;
    sheets: SheetReportDTO[];
    specKeys: SpecKeyFact[];
    drafts: PreviewItem[];
    siteProducts: PreviewItem[];
}

// ── The editor's state (lives in glamFormReducer's state) ──────────────────────────────────────────────────────────

/** The stored profile the editor's `baseRevision` refers to, as the latest dry run WITHOUT a choice reported it. */
export type StoredBase =
    | { kind: "none" }
    | { kind: "stored"; revision: number; value: GlamImportProfile }
    | { kind: "unsupported"; revision: number; reason: string };

/**
 * - `not-loaded`: no dry run answered for this file and producer yet;
 * - `unsupported`: the stored profile does not parse (§ 3.3 item 4); it cannot be loaded into the editor, so nothing is
 *   chosen until the user takes the proposal (§ 3.3 item 5: the proposal is the starting point);
 * - `editing`: `working` is the profile a preview sends, with `baseRevision = baseRevisionOf(base)`. `facts` = the
 *   latest answered dry run for this file (kept while edits withdraw the shown report). `otherImport` = the 409 of an
 *   import refused because another import changed the stored profile (§ 6.6), until the next successful import.
 */
export type ProfileEditor =
    | { kind: "not-loaded" }
    | { kind: "unsupported"; revision: number; reason: string; facts: GlamDryRun }
    | { kind: "editing"; base: StoredBase; working: GlamImportProfile; facts: GlamDryRun; otherImport: { storedRevision: number | null } | null };

export const NOT_LOADED: ProfileEditor = { kind: "not-loaded" };

export function baseRevisionOf(base: StoredBase): number | null {
    switch (base.kind) {
        case "none": return null;
        case "stored":
        case "unsupported":
            return base.revision;
        default: return assertNever(base);
    }
}

/**
 * An answer to a dry run WITHOUT a choice. First load (§ 6.1 step 2, § 6.2): the stored profile (or the default) is the
 * working profile. Reload of a loaded editor (§ 6.6, after a 409): the base becomes the stored profile now reported and
 * the user's working profile is KEPT — the user then chooses and previews again.
 */
export function loadEditor(editor: ProfileEditor, report: GlamDryRun): ProfileEditor {
    let base: StoredBase;
    let fresh: ProfileEditor;
    switch (report.profile.source) {
        case "default":
            base = { kind: "none" };
            fresh = { kind: "editing", base, working: report.profile.value, facts: report, otherImport: null };
            break;
        case "stored":
            base = { kind: "stored", revision: report.profile.revision, value: report.profile.value };
            fresh = { kind: "editing", base, working: report.profile.value, facts: report, otherImport: null };
            break;
        case "unsupported":
            base = { kind: "unsupported", revision: report.profile.revision, reason: report.profile.reason };
            fresh = { kind: "unsupported", revision: report.profile.revision, reason: report.profile.reason, facts: report };
            break;
        case "explicit":
            throw new Error("Internal: a dry run without a profile choice answered profile.source = explicit.");
        default:
            return assertNever(report.profile);
    }
    switch (editor.kind) {
        case "editing": return { ...editor, base, facts: report };
        case "not-loaded":
        case "unsupported":
            return fresh;
        default: return assertNever(editor);
    }
}

/**
 * What "Importă" may send for the report of a dry run WITHOUT a choice: the profile that report was planned with, and
 * its stored revision (§ 6.2 "the execution is sent with the stored profile as profileChoice and baseRevision = its
 * revision"; the default with `null`). `null` when the stored profile is unsupported: that report is not importable.
 */
export function confirmChoiceOf(profile: ProfileReportDTO): ProfileChoice | null {
    switch (profile.source) {
        case "default": return { profile: profile.value, baseRevision: null };
        case "stored": return { profile: profile.value, baseRevision: profile.revision };
        case "unsupported": return null;
        case "explicit": return null;
        default: return assertNever(profile);
    }
}

/** An answer to a preview (a dry run WITH a choice, sent only from `editing`): its facts replace the editor's. */
export function previewedEditor(editor: ProfileEditor, report: GlamDryRun): ProfileEditor {
    switch (editor.kind) {
        case "editing": return { ...editor, facts: report };
        case "not-loaded":
        case "unsupported":
            return editor;
        default: return assertNever(editor);
    }
}

/** The members of an execution answer (200, or the 503 "incomplete" — written, profile saved) that report the stored state. */
export interface ExecutionProfileReport {
    profile: ProfileReportDTO;
    /** The producer's sheets AFTER this import (backend `sheetStates` over the products as written). */
    sheets: SheetReportDTO[];
}

/**
 * After an import whose answer reports the stored state (rule: every answer that reports the stored profile and the
 * sheet states refreshes the editor): the profile it used is now the base (`revision === null` = none was stored),
 * and the sheet states are the answer's — so a profile change shows the other sheets that became `stale` at once.
 */
export function editorAfterImport(editor: ProfileEditor, answer: ExecutionProfileReport): ProfileEditor {
    const used = answer.profile;
    switch (editor.kind) {
        case "editing": {
            let base: StoredBase;
            switch (used.source) {
                case "default": base = { kind: "none" }; break;
                case "stored": base = { kind: "stored", revision: used.revision, value: used.value }; break;
                case "explicit": base = used.revision === null ? { kind: "none" } : { kind: "stored", revision: used.revision, value: used.value }; break;
                case "unsupported": base = { kind: "unsupported", revision: used.revision, reason: used.reason }; break;
                default: return assertNever(used);
            }
            return { ...editor, base, facts: { ...editor.facts, sheets: answer.sheets }, otherImport: null };
        }
        case "not-loaded":
        case "unsupported":
            return editor;
        default: return assertNever(editor);
    }
}

/** § 6.6: an import refused with 409 because another import changed the stored profile (the reload follows). */
export function editorAfterConflict(editor: ProfileEditor, storedRevision: number | null): ProfileEditor {
    switch (editor.kind) {
        case "editing": return { ...editor, otherImport: { storedRevision } };
        case "not-loaded":
        case "unsupported":
            return editor;
        default: return assertNever(editor);
    }
}

/** A user edit. `unsupported` accepts only `replace` (taking the proposal), which starts editing. */
export function editedEditor(editor: ProfileEditor, edit: ProfileEdit): ProfileEditor {
    switch (editor.kind) {
        case "editing":
            return { ...editor, working: applyProfileEdit(editor.working, edit) };
        case "unsupported":
            switch (edit.kind) {
                case "replace":
                    return { kind: "editing", base: { kind: "unsupported", revision: editor.revision, reason: editor.reason }, working: edit.profile, facts: editor.facts, otherImport: null };
                case "grouping":
                case "collection":
                case "key-action":
                case "key-label":
                case "key-split":
                case "attribute-mode":
                case "variant-mode":
                case "publish-without-images":
                    return editor; // nothing is loaded to edit (§ 3.3 item 5)
                default: return assertNever(edit);
            }
        case "not-loaded":
            return editor;
        default: return assertNever(editor);
    }
}

/** For a preview answer: the stored revision when it is no longer the editor's base (another import saved since). */
export function storedMoved(editor: ProfileEditor, report: GlamDryRun): { storedRevision: number | null } | null {
    switch (editor.kind) {
        case "editing": break;
        case "not-loaded":
        case "unsupported":
            return null;
        default: return assertNever(editor);
    }
    switch (report.profile.source) {
        case "explicit": {
            const stored = report.profile.stored;
            let storedRevision: number | null;
            switch (stored.kind) {
                case "none": storedRevision = null; break;
                case "supported":
                case "unsupported":
                    storedRevision = stored.revision; break;
                default: return assertNever(stored);
            }
            return storedRevision === baseRevisionOf(editor.base) ? null : { storedRevision };
        }
        case "default":
        case "stored":
        case "unsupported":
            return null;
        default: return assertNever(report.profile);
    }
}

// ── Copy whose wording restates another module's rule (pinned by the units, each next to a counterexample) ──────────
//
// Rule (review-1 R4): a sentence that restates a rule owned elsewhere is scoped to the part of the rule it restates
// (which facet kind; the OFFER or the VISIBILITY step) and names every exception of that part. A rule the admin
// cannot execute (the backend's acceptance rule) is not restated: the sentence is bounded ("poate") instead.

/**
 * A moved stored revision. Whether the import is accepted is the backend's acceptance rule (§ 3.5: same revision, or
 * content equal to the stored one; and an explicit default while nothing is stored is unprofiled) — covered by the
 * backend units (`glam-profile.test.ts`, `glam-import-handler.test.ts`), not restated here.
 */
export function movedNotice(storedRevision: number | null): string {
    return `Profilul salvat s-a schimbat de când l-ați încărcat (acum: ${storedRevision === null ? "niciun profil" : `revizia ${storedRevision}`}). `
        + "Importul poate fi refuzat; dacă este refuzat, nu se schimbă nimic și profilul salvat se reîncarcă pentru a alege între cele două.";
}

/**
 * When an accepted import stores the profile (§ 2.8, § 3.1, B-4): only a profiled import writes it; the default sent
 * while nothing is stored is unprofiled (nothing saved, no stamp); a profile equal to the stored one keeps its revision.
 */
export const SAVE_RULE = "Profilul se salvează doar printr-un import: un import acceptat salvează profilul previzualizat dacă diferă de cel salvat "
    + "(revizia crește cu 1); dacă este identic, revizia rămâne. Cât timp nu este salvat niciun profil, profilul implicit nu se salvează: "
    + "importul rămâne fără profil. Celelalte liste ale producătorului se schimbă doar când sunt importate din nou.";

/**
 * Attribute facets, the OFFER step (§ 2.6, ruling S-A with N2; `packages/shared/src/facets.ts` `facetDefs`): the
 * repeat rule over the non-silent holders; `always` on a holder overrides it; `never` makes a holder silent.
 */
export const FILTER_MODE_HELP = "Filtrele de atribute — automat: filtrul este oferit pe o pagină când, fără produsele marcate „niciodată”, cel puțin "
    + "2 produse ale paginii au cheia, cea mai frecventă valoare este la cel puțin 2 dintre ele și sunt cel mult 40 de valori; mereu: este oferit "
    + "pe orice pagină unde un produs importat cu acest profil are cheia, chiar dacă aceste condiții nu sunt îndeplinite; niciodată: produsele "
    + "importate cu acest profil nu contribuie la oferirea filtrului și valorile lor nu sunt propuse, dar ele rămân găsite și numărate când o "
    + "valoare este aleasă.";

/** The variant facet, the OFFER step: always offered (no repeat rule); `variant: never` makes a holder silent. */
export const VARIANT_MODE_HELP = "Filtrul variantelor — automat: este oferit pe orice pagină, fără regula repetării; niciodată: variantele produselor "
    + "importate cu acest profil nu sunt propuse, dar aceste produse rămân găsite și numărate când o variantă este aleasă.";

/** The VISIBILITY step, every facet (`buildFacetListing`): a selection, or some proposed value not held by every product. */
/** CAT-IMAGE-GATE-1 § 3 item 6: what the checkbox does (saved with the profile by an accepted import, like every setting). */
export const PUBLISH_WITHOUT_IMAGES_HELP = "Oprit (implicit): fiecare produs importat rămâne ascuns până când una dintre imaginile lui se copiază pe site; produsele fără nicio imagine copiată rămân ascunse și apar în raportul imaginilor. Pornit: toate produsele sunt publicate la import, cu sau fără imagine.";

export const FACET_VISIBILITY_HELP = "Pe pagină, un filtru este afișat dacă are deja o valoare aleasă, sau dacă este oferit și cel puțin una dintre "
    + "valorile propuse nu este la toate produsele paginii.";

// ── Editing a profile (pure) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The four column attribute keys (backend `glam/profile.ts` `COLUMN_ATTRIBUTE`). A profile cannot rename them or use
 * them as a label; it can set their filter mode (§ 2.4, § 2.6). Restated here: they are not in `packages/shared`.
 */
export const COLUMN_ATTRIBUTE_KEYS = ["colecție", "unitate", "împachetare", "comandă minimă"] as const;
/** The collection column's attribute key — read by name by the interest list (design § 1.1 item 6). */
const COLLECTION_ATTRIBUTE = COLUMN_ATTRIBUTE_KEYS[0];

export type FilterMode = "auto" | "always" | "never";
export type KeyAction = "attribute" | "prose-only" | "not-reviewed";

export type ProfileEdit =
    | { kind: "replace"; profile: GlamImportProfile }
    | { kind: "grouping"; grouping: GlamImportProfile["grouping"] }
    | { kind: "collection"; collection: GlamImportProfile["collection"] }
    | { kind: "key-action"; key: string; action: KeyAction }
    | { kind: "key-label"; key: string; label: string }
    | { kind: "key-split"; key: string; split: "none" | "comma" }
    | { kind: "attribute-mode"; attributeKey: string; mode: FilterMode }
    | { kind: "variant-mode"; mode: "auto" | "never" }
    /** CAT-IMAGE-GATE-1: the checkbox "Publică și produsele fără imagine". */
    | { kind: "publish-without-images"; value: boolean };

/** § 6.1 step 3: every key → `attribute`, label = the key as written, `split: "none"`, no mode; grouping and collection at the default. */
export function proposeProfile(keys: readonly SpecKeyFact[]): GlamImportProfile {
    return {
        version: 1,
        grouping: { kind: "as-is" },
        collection: { kind: "column" },
        specKeys: keys.map((k) => ({ key: k.key, action: "attribute", label: k.key, split: "none" })),
        facetModes: { attributes: [] },
    };
}

/** The stored attribute key a rule writes (its label), or `null` for a rule that writes none. */
function labelOf(rule: SpecKeyRule): string | null {
    switch (rule.action) {
        case "attribute": return rule.label;
        case "prose-only": return null;
        default: return assertNever(rule);
    }
}

export function keyActionOf(profile: GlamImportProfile, key: string): KeyAction | "collection" {
    switch (profile.collection.kind) {
        case "spec": if (profile.collection.key === key) return "collection"; break;
        case "column": break;
        default: return assertNever(profile.collection);
    }
    const rule = profile.specKeys.find((r) => r.key === key);
    if (!rule) return "not-reviewed";
    switch (rule.action) {
        case "attribute": return "attribute";
        case "prose-only": return "prose-only";
        default: return assertNever(rule);
    }
}

/** The `attribute` rule of `key`, or `null` when the key has another rule or none. */
export function attributeRuleOf(profile: GlamImportProfile, key: string): Extract<SpecKeyRule, { action: "attribute" }> | null {
    const rule = profile.specKeys.find((r) => r.key === key);
    if (!rule) return null;
    switch (rule.action) {
        case "attribute": return rule;
        case "prose-only": return null;
        default: return assertNever(rule);
    }
}

export function attributeModeOf(profile: GlamImportProfile, attributeKey: string): FilterMode {
    return profile.facetModes.attributes.find((m) => m.key === attributeKey)?.mode ?? "auto";
}

/** Replace the rule of `key` in place (the list order is kept, so an unchanged profile stays equal), append it when new, remove it for `null`. */
function withRule(rules: readonly SpecKeyRule[], key: string, rule: SpecKeyRule | null): SpecKeyRule[] {
    const out = rules.flatMap((r) => (r.key === key ? (rule ? [rule] : []) : [r]));
    return rule && !rules.some((r) => r.key === key) ? [...out, rule] : out;
}

function withMode(modes: FacetModes, attributeKey: string, mode: FilterMode): FacetModes {
    const others = modes.attributes.filter((m) => m.key !== attributeKey);
    let attributes: FacetModes["attributes"];
    switch (mode) {
        case "auto": attributes = others; break;
        case "always":
        case "never": {
            const at = modes.attributes.findIndex((m) => m.key === attributeKey);
            const entry = { key: attributeKey, mode };
            attributes = at < 0 ? [...others, entry] : [...others.slice(0, at), entry, ...others.slice(at)];
            break;
        }
        default: return assertNever(mode);
    }
    return { ...modes, attributes };
}

/**
 * Modes are kept only for keys a product of this producer can hold: a column key, or the label of an attribute rule.
 * So a mode never outlives the rule it was set on (the stored profile states only what the editor shows).
 */
function pruneModes(profile: GlamImportProfile): GlamImportProfile {
    const keys = new Set<string>([...COLUMN_ATTRIBUTE_KEYS, ...profile.specKeys.flatMap((r) => labelOf(r) ?? [])]);
    return { ...profile, facetModes: { ...profile.facetModes, attributes: profile.facetModes.attributes.filter((m) => keys.has(m.key)) } };
}

/**
 * One edit, applied. Rules: the collection spec key is consumed — it leaves `specKeys` (the backend refuses it in
 * both); a label change carries the old label's filter mode to the new label when no other rule keeps the old label
 * and the new label has no mode yet; modes of keys no rule writes any more are dropped (`pruneModes`).
 */
export function applyProfileEdit(profile: GlamImportProfile, edit: ProfileEdit): GlamImportProfile {
    switch (edit.kind) {
        case "replace":
            return edit.profile;
        case "grouping":
            return { ...profile, grouping: edit.grouping };
        case "collection":
            switch (edit.collection.kind) {
                case "column": return { ...profile, collection: edit.collection };
                case "spec": return pruneModes({ ...profile, collection: edit.collection, specKeys: withRule(profile.specKeys, edit.collection.key, null) });
                default: return assertNever(edit.collection);
            }
        case "key-action": {
            const existing = profile.specKeys.find((r) => r.key === edit.key);
            let rule: SpecKeyRule | null;
            switch (edit.action) {
                case "attribute":
                    rule = existing && labelOf(existing) !== null ? existing : { key: edit.key, action: "attribute", label: edit.key, split: "none" };
                    break;
                case "prose-only": rule = { key: edit.key, action: "prose-only" }; break;
                case "not-reviewed": rule = null; break;
                default: return assertNever(edit.action);
            }
            return pruneModes({ ...profile, specKeys: withRule(profile.specKeys, edit.key, rule) });
        }
        case "key-label": {
            const existing = profile.specKeys.find((r) => r.key === edit.key);
            if (!existing) return profile;
            switch (existing.action) {
                case "attribute": {
                    const specKeys = withRule(profile.specKeys, edit.key, { ...existing, label: edit.label });
                    const oldMode = attributeModeOf(profile, existing.label);
                    const oldKept = specKeys.some((r) => labelOf(r) === existing.label);
                    let facetModes = profile.facetModes;
                    if (oldMode !== "auto" && !oldKept && attributeModeOf(profile, edit.label) === "auto") {
                        facetModes = withMode(withMode(facetModes, existing.label, "auto"), edit.label, oldMode);
                    }
                    return pruneModes({ ...profile, specKeys, facetModes });
                }
                case "prose-only": return profile;
                default: return assertNever(existing);
            }
        }
        case "key-split": {
            const existing = profile.specKeys.find((r) => r.key === edit.key);
            if (!existing) return profile;
            switch (existing.action) {
                case "attribute": return { ...profile, specKeys: withRule(profile.specKeys, edit.key, { ...existing, split: edit.split }) };
                case "prose-only": return profile;
                default: return assertNever(existing);
            }
        }
        case "attribute-mode":
            return { ...profile, facetModes: withMode(profile.facetModes, edit.attributeKey, edit.mode) };
        case "variant-mode": {
            // Enabled-only serialisation (§ 3.3 item 2): `variant` is present only when it is "never".
            const attributes = profile.facetModes.attributes;
            const mode = edit.mode;
            switch (mode) {
                case "auto": return { ...profile, facetModes: { attributes } };
                case "never": return { ...profile, facetModes: { variant: "never", attributes } };
                default: return assertNever(mode);
            }
        }
        case "publish-without-images": {
            // Enabled-only serialisation, as `variant`: the member is present only when true, so an unchecked box gives
            // the default profile (and a stored profile without the member) exactly — nothing to save, no new revision.
            const { publishWithoutImages: _off, ...rest } = profile;
            return edit.value ? { ...rest, publishWithoutImages: true } : rest;
        }
        default:
            return assertNever(edit);
    }
}

// ── Hints from the measured facts (§ 6.1 step 3) ───────────────────────────────────────────────────────────────────

/** The hints shown next to one key: only the facts that call for a decision. */
export function keyHints(k: SpecKeyFact): string[] {
    const hints: string[] = [];
    if (k.commaRows > 0) hints.push(`listă cu virgule în ${k.commaRows} rânduri`);
    if (k.variantLevelProducts > 0) hints.push(`diferă între opțiuni în ${k.variantLevelProducts} produse`);
    if (k.equalToFormat > 0) hints.push(`egal cu eticheta variantei (fără spații și „mm”) în ${k.equalToFormat}/${k.rows} rânduri`);
    if (k.equalToCollection > 0) hints.push(`egal cu colecția din coloana 0 (fără spații și „mm”) în ${k.equalToCollection}/${k.rows} rânduri`);
    if (k.distinctValues === 1) hints.push("o singură valoare");
    if (k.repeatRule === "not-offered") hints.push(`regula repetării nu l-ar oferi ca filtru pentru produsele acestui fișier (${k.distinctValues} valori)`);
    if (k.refused.length > 0) hints.push(`${k.refused.length} linii refuzate de filtrul de valori (cod sau preț)`);
    return hints;
}

/** The grouping and collection the dry run planned with (an unsupported stored profile is never applied: the default). */
function plannedOf(profile: ProfileReportDTO): Pick<GlamImportProfile, "grouping" | "collection"> {
    switch (profile.source) {
        case "default":
        case "stored":
        case "explicit":
            return profile.value;
        case "unsupported":
            return { grouping: { kind: "as-is" }, collection: { kind: "column" } };
        default: return assertNever(profile);
    }
}

/**
 * Grouping hint: with the `as-is` grouping a product's title is the file's name, so this counts the products whose
 * name ends in an all-digit token after another token (the `trailing-number` condition, § 2.1). `null` when the dry
 * run grouped otherwise (the titles are then no longer the names).
 */
export function nameNumberHint(report: GlamDryRun): { endsInNumber: number; products: number } | null {
    const grouping = plannedOf(report.profile).grouping;
    switch (grouping.kind) {
        case "as-is": {
            const endsInNumber = report.products.filter((p) => {
                const tokens = p.title.trim().split(/\s+/);
                return tokens.length >= 2 && /^\d+$/.test(tokens[tokens.length - 1]);
            }).length;
            return { endsInNumber, products: report.products.length };
        }
        case "trailing-number": return null;
        default: return assertNever(grouping);
    }
}

/** Collection hint: with the `column` source, the distinct `colecție` values of the drafts. `null` otherwise. */
export function collectionHint(report: GlamDryRun): { values: number } | null {
    const collection = plannedOf(report.profile).collection;
    switch (collection.kind) {
        case "column": {
            const values = new Set<string>();
            for (const d of report.drafts) {
                for (const a of Array.isArray(d.attributes) ? (d.attributes as { key?: unknown; value?: unknown }[]) : []) {
                    if (a.key === COLLECTION_ATTRIBUTE && typeof a.value === "string") values.add(a.value);
                }
            }
            return { values: values.size };
        }
        case "spec": return null;
        default: return assertNever(collection);
    }
}

/** The sheet part of an `importSource` (`glam:<producer>/<sheet>`; a producer cannot hold "/", backend map.ts). */
export function sheetId(importSource: string): string {
    return importSource.slice(importSource.indexOf("/") + 1);
}

export function sheetStateText(s: SheetReportDTO): string {
    switch (s.state) {
        case "no-profile": return "importată fără profil";
        case "current": return `importată cu profilul salvat (revizia ${s.revisions.join(", ")})`;
        case "stale": return `importată cu un profil mai vechi (revizia ${s.revisions.join(", ")})`;
        case "mixed": return `amestecată (revizii: ${s.revisions.join(", ") || "—"}; ${s.unstamped} produse fără profil)`;
        default: return assertNever(s.state);
    }
}

/** § 6.3: the producer's OTHER sheets whose products do not carry the stored revision (listed only when a profile is stored). */
export function sheetsToReimport(editor: ProfileEditor): SheetReportDTO[] {
    switch (editor.kind) {
        case "editing": break;
        case "not-loaded":
        case "unsupported":
            return [];
        default: return assertNever(editor);
    }
    switch (editor.base.kind) {
        case "none": return [];
        case "stored":
        case "unsupported":
            return editor.facts.sheets.filter((s) => s.importSource !== editor.facts.importSource && s.state !== "current");
        default: return assertNever(editor.base);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

// ── Layout: the editor ─────────────────────────────────────────────────────────────────────────────────────────────

const SELECT = "border rounded-md px-2 py-1 text-xs bg-background";
const NOTICE = "text-xs p-2 rounded-md bg-destructive/10 text-destructive";

const GROUPINGS: { id: string; text: string; value: GlamImportProfile["grouping"] }[] = [
    { id: "as-is", text: "Fiecare nume din fișier este un produs", value: { kind: "as-is" } },
    { id: "trailing-number/removed-token", text: "Numărul de la sfârșitul numelui, când există, devine eticheta variantei", value: { kind: "trailing-number", label: "removed-token" } },
    { id: "trailing-number/format-column", text: "Numele fără numărul final; varianta din coloana format", value: { kind: "trailing-number", label: "format-column" } },
];

function groupingId(g: GlamImportProfile["grouping"]): string {
    switch (g.kind) {
        case "as-is": return "as-is";
        case "trailing-number": return `trailing-number/${g.label}`;
        default: return assertNever(g);
    }
}

function collectionId(c: GlamImportProfile["collection"]): string {
    switch (c.kind) {
        case "column": return "";
        case "spec": return c.key;
        default: return assertNever(c);
    }
}

function ModeSelect({ value, onChange, disabled, allowAlways = true }: { value: FilterMode; onChange: (m: FilterMode) => void; disabled: boolean; allowAlways?: boolean }) {
    return (
        <select className={SELECT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as FilterMode)}>
            <option value="auto">automat</option>
            {allowAlways && <option value="always">mereu</option>}
            <option value="never">niciodată</option>
        </select>
    );
}

export function ProfileEditorPanel({ editor, onEdit, disabled }: { editor: ProfileEditor; onEdit: (edit: ProfileEdit) => void; disabled: boolean }) {
    switch (editor.kind) {
        case "not-loaded":
            return null;
        case "unsupported":
            return (
                <div className="text-sm p-3 rounded-md border space-y-2">
                    <div className="font-medium">Profilul de import al producătorului {editor.facts.producer}</div>
                    <div className={NOTICE}>
                        Profilul salvat (revizia {editor.revision}) folosește setări pe care acest importator nu le poate aplica: {editor.reason}.
                        Nu poate fi deschis aici. Porniți de la propunere; un import cu profilul ales aici îl înlocuiește, dacă între timp alt import nu a salvat alt profil.
                    </div>
                    <Button size="sm" variant="outline" disabled={disabled} onClick={() => onEdit({ kind: "replace", profile: proposeProfile(editor.facts.specKeys) })}>
                        Folosește propunerea
                    </Button>
                </div>
            );
        case "editing":
            return <EditingPanel editor={editor} onEdit={onEdit} disabled={disabled} />;
        default:
            return assertNever(editor);
    }
}

function EditingPanel({ editor, onEdit, disabled }: { editor: Extract<ProfileEditor, { kind: "editing" }>; onEdit: (edit: ProfileEdit) => void; disabled: boolean }) {
    const { base, working, facts } = editor;
    const names = nameNumberHint(facts);
    const collections = collectionHint(facts);
    const reimport = sheetsToReimport(editor);
    const keysByName = new Map(facts.specKeys.map((k) => [k.key, k]));
    const collectionKey = collectionId(working.collection);
    const stored = storedProfileOf(base);
    return (
        <div className="text-sm p-3 rounded-md border space-y-3">
            <div className="space-y-1">
                <div className="font-medium">Profilul de import al producătorului {facts.producer}</div>
                <div className="text-xs text-muted-foreground">
                    <BaseLine base={base} /> {SAVE_RULE}
                </div>
                {editor.otherImport && (
                    <div className={NOTICE}>
                        Profilul a fost schimbat de alt import (revizia {editor.otherImport.storedRevision ?? "—"}). Mai jos este profilul dvs.;
                        alegeți profilul salvat sau păstrați-l pe al dvs., apoi apăsați „Previzualizează” din nou.
                    </div>
                )}
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={disabled} onClick={() => onEdit({ kind: "replace", profile: proposeProfile(facts.specKeys) })}
                        title="Fiecare cheie devine atribut, cu eticheta egală cu cheia; gruparea și colecția rămân implicite">
                        Folosește propunerea
                    </Button>
                    {stored && (
                        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onEdit({ kind: "replace", profile: stored.value })}>
                            Folosește profilul salvat (revizia {stored.revision})
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs">
                    <span className="font-medium">Ce este un produs</span>
                    <select className={`${SELECT} w-full`} disabled={disabled} value={groupingId(working.grouping)}
                        onChange={(e) => onEdit({ kind: "grouping", grouping: GROUPINGS.find((g) => g.id === e.target.value)!.value })}>
                        {GROUPINGS.map((g) => <option key={g.id} value={g.id}>{g.text}</option>)}
                    </select>
                    {names && <span className="block text-muted-foreground">{names.endsInNumber} din {names.products} produse au numele terminat într-un număr.</span>}
                </label>
                <label className="space-y-1 text-xs">
                    <span className="font-medium">De unde vine colecția</span>
                    <select className={`${SELECT} w-full`} disabled={disabled} value={collectionKey}
                        onChange={(e) => onEdit({ kind: "collection", collection: e.target.value === "" ? { kind: "column" } : { kind: "spec", key: e.target.value } })}>
                        <option value="">Coloana colecției din fișier</option>
                        {facts.specKeys.map((k) => <option key={k.key} value={k.key}>Cheia „{k.key}” ({k.distinctValues} valori, {k.rows} rânduri)</option>)}
                        {collectionKey !== "" && !keysByName.has(collectionKey) && <option value={collectionKey}>Cheia „{collectionKey}”</option>}
                    </select>
                    {collections && <span className="block text-muted-foreground">Coloana colecției are {collections.values} valori.</span>}
                    {collectionKey !== "" && <span className="block text-muted-foreground">Un rând fără această cheie, sau cu o valoare refuzată de filtrul de valori, primește ca colecție numele listei.</span>}
                </label>
            </div>

            <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5" checked={working.publishWithoutImages === true} disabled={disabled}
                    onChange={(e) => onEdit({ kind: "publish-without-images", value: e.target.checked })} />
                <span>
                    <span className="font-medium">Publică și produsele fără imagine</span>
                    <span className="block text-muted-foreground">{PUBLISH_WITHOUT_IMAGES_HELP}</span>
                </span>
            </label>

            <KeyTable facts={facts.specKeys} working={working} onEdit={onEdit} disabled={disabled} />

            <div className="space-y-1">
                <div className="text-xs font-medium">Filtrele coloanelor</div>
                <div className="flex flex-wrap gap-3 text-xs">
                    {COLUMN_ATTRIBUTE_KEYS.map((key) => (
                        <label key={key} className="flex items-center gap-1">
                            {key}
                            <ModeSelect value={attributeModeOf(working, key)} disabled={disabled} onChange={(mode) => onEdit({ kind: "attribute-mode", attributeKey: key, mode })} />
                        </label>
                    ))}
                    <label className="flex items-center gap-1">
                        variantele
                        <ModeSelect value={working.facetModes.variant === "never" ? "never" : "auto"} disabled={disabled} allowAlways={false}
                            onChange={(mode) => onEdit({ kind: "variant-mode", mode: mode === "never" ? "never" : "auto" })} />
                    </label>
                </div>
                <div className="text-xs text-muted-foreground">
                    <div>{FILTER_MODE_HELP}</div>
                    <div>{VARIANT_MODE_HELP}</div>
                    <div>{FACET_VISIBILITY_HELP}</div>
                </div>
            </div>

            {facts.sheets.length > 0 && (
                <div className="space-y-1 text-xs">
                    <div className="font-medium">Listele producătorului pe site</div>
                    <ul className="space-y-0.5">
                        {facts.sheets.map((s) => (
                            <li key={s.importSource} title={s.importSource}>
                                {sheetId(s.importSource)}{s.importSource === facts.importSource ? " (această listă)" : ""} — {s.products} produse, {sheetStateText(s)}
                            </li>
                        ))}
                    </ul>
                    {reimport.length > 0 && (
                        <div className="text-muted-foreground">
                            Aceste liste au fost importate cu un profil mai vechi sau fără profil: {reimport.map((s) => sheetId(s.importSource)).join(", ")} — importați-le din nou.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/** The stored profile the user can go back to: only a supported stored profile has a value. */
function storedProfileOf(base: StoredBase): { revision: number; value: GlamImportProfile } | null {
    switch (base.kind) {
        case "stored": return base;
        case "none":
        case "unsupported":
            return null;
        default: return assertNever(base);
    }
}

function BaseLine({ base }: { base: StoredBase }) {
    switch (base.kind) {
        case "none": return <>Niciun profil salvat pentru acest producător.</>;
        case "stored": return <>Profil salvat: revizia {base.revision}.</>;
        case "unsupported":
            return <>Profilul salvat (revizia {base.revision}) folosește setări pe care acest importator nu le poate aplica: {base.reason}; un import cu profilul de mai jos îl înlocuiește, dacă între timp alt import nu a salvat alt profil.</>;
        default: return assertNever(base);
    }
}

function KeyTable({ facts, working, onEdit, disabled }: { facts: SpecKeyFact[]; working: GlamImportProfile; onEdit: (edit: ProfileEdit) => void; disabled: boolean }) {
    // The file's keys (facts of the latest answered dry run), then any key the profile lists that this file does not have.
    const listed = working.specKeys.map((r) => r.key).filter((key) => !facts.some((k) => k.key === key));
    if (facts.length === 0 && listed.length === 0) return <div className="text-xs text-muted-foreground">Fișierul nu are linii de specificații de forma „cheie: valoare”.</div>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="text-left text-muted-foreground">
                        <th className="py-1 pr-2">Cheia din fișier</th>
                        <th className="py-1 pr-2">Fapte măsurate (ultima verificare)</th>
                        <th className="py-1 pr-2">Devine</th>
                        <th className="py-1 pr-2">Eticheta pe site</th>
                        <th className="py-1 pr-2">Împărțire</th>
                        <th className="py-1">Filtru</th>
                    </tr>
                </thead>
                <tbody>
                    {facts.map((k) => <KeyRow key={k.key} keyName={k.key} fact={k} working={working} onEdit={onEdit} disabled={disabled} />)}
                    {listed.map((key) => <KeyRow key={key} keyName={key} fact={null} working={working} onEdit={onEdit} disabled={disabled} />)}
                </tbody>
            </table>
        </div>
    );
}

function KeyRow({ keyName, fact, working, onEdit, disabled }: { keyName: string; fact: SpecKeyFact | null; working: GlamImportProfile; onEdit: (edit: ProfileEdit) => void; disabled: boolean }) {
    const action = keyActionOf(working, keyName);
    const attribute = attributeRuleOf(working, keyName);
    return (
        <tr className="border-t align-top">
            <td className="py-1 pr-2 font-medium">{keyName}</td>
            <td className="py-1 pr-2">
                {fact ? (
                    <>
                        <div>{fact.rows} rânduri, {fact.products} produse, {fact.distinctValues} valori (cea mai des: {fact.maxValueHolders} produse)</div>
                        <div className="text-muted-foreground">ex.: {fact.samples.join(" · ")}</div>
                        {keyHints(fact).map((h) => <div key={h} className="text-muted-foreground">• {h}</div>)}
                    </>
                ) : <span className="text-muted-foreground">nu apare în acest fișier</span>}
            </td>
            <td className="py-1 pr-2">
                {action === "collection" ? <span className="text-muted-foreground">sursa colecției</span> : (
                    <select className={SELECT} value={action} disabled={disabled} onChange={(e) => onEdit({ kind: "key-action", key: keyName, action: e.target.value as KeyAction })}>
                        <option value="attribute">atribut</option>
                        <option value="prose-only">doar în text</option>
                        <option value="not-reviewed">nerevizuit</option>
                    </select>
                )}
            </td>
            <td className="py-1 pr-2">
                {attribute && <Input className="h-7 text-xs" value={attribute.label} disabled={disabled} onChange={(e) => onEdit({ kind: "key-label", key: keyName, label: e.target.value })} />}
            </td>
            <td className="py-1 pr-2">
                {attribute && (
                    <select className={SELECT} value={attribute.split} disabled={disabled} onChange={(e) => onEdit({ kind: "key-split", key: keyName, split: e.target.value as "none" | "comma" })}>
                        <option value="none">valoare întreagă</option>
                        <option value="comma">împarte la virgulă</option>
                    </select>
                )}
            </td>
            <td className="py-1">
                {attribute && <ModeSelect value={attributeModeOf(working, attribute.label)} disabled={disabled} onChange={(mode) => onEdit({ kind: "attribute-mode", attributeKey: attribute.label, mode })} />}
            </td>
        </tr>
    );
}

// ── Layout: the preview (§ 5.1 items 1–3) ──────────────────────────────────────────────────────────────────────────

/**
 * Cards, one product page and the three filter panels of one answered dry run. The filter selection of each panel and
 * the WANTED product and collection are local UI state. The parent keys this component by the form revision, so an
 * edited input starts from the defaults; a new report of the same revision keeps the wanted values, and what is shown is
 * `effectivePreviewChoice(shown, wanted)` — a wanted value the report still holds is kept, one it no longer
 * holds is replaced by the report's default.
 * CAT-IMAGE-GATE-1: cards, the product page choice and the panels show only the products the site would publish
 * (`publishedDrafts`: a product waiting for its image copy is marked "imagine de copiat"); the products without any
 * image address are listed apart as hidden (`hiddenDrafts`). The categories are the import's either way.
 */
export function ImportPreview({ report, context, today }: { report: GlamDryRun; context: SiteContext | null; today: string }) {
    const producerId = producerCategoryId(report.drafts);
    const collectionIds = collectionCategoryIds(report.drafts);
    const [wanted, setWanted] = useState<{ productSlug: string | null; collectionId: string | null }>({ productSlug: null, collectionId: null });
    const shown = publishedDrafts(report.drafts);
    const hidden = hiddenDrafts(report.drafts);
    const startsHidden = report.drafts.some((d) => draftPublication(d) !== "published");
    const { productSlug, collectionId } = effectivePreviewChoice(shown, wanted);
    const setProductSlug = (slug: string) => setWanted({ ...wanted, productSlug: slug });
    const setCollectionId = (id: string) => setWanted({ ...wanted, collectionId: id });
    const [selections, setSelections] = useState<Record<string, string>>({});
    const { count, cards } = previewCards(report.drafts);
    const draft = shown.find((d) => d.slug === productSlug) ?? null;

    const panel = (id: string, title: string, scope: PreviewScope) => (
        <FilterPanelPreview key={id} title={title} panel={previewPanel(report, context, scope, selections[id] ?? "", today)}
            onSelect={(f) => setSelections({ ...selections, [id]: f })} />
    );

    return (
        <div className="text-sm p-3 rounded-md border space-y-4">
            <div className="space-y-0.5">
                <div className="font-medium">Previzualizare — nimic nu a fost scris încă</div>
                <div className="text-xs text-muted-foreground">
                    <div>{FIDELITY_NOTICE}.</div>
                    <ul className="list-disc pl-4">{FIDELITY_LIMITS.map((t) => <li key={t}>{t}</li>)}</ul>
                </div>
                {startsHidden && <div className="text-xs">{PUBLICATION_NOTICE}</div>}
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium">{count} produse{count > cards.length ? ` — primele ${cards.length}` : ""}</div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {cards.map((c) => (
                        <button key={c.slug} type="button" onClick={() => setProductSlug(c.slug)} className="text-left space-y-1">
                            <div className="aspect-square rounded-md bg-muted overflow-hidden">
                                {c.imageLink && <img src={c.imageLink} alt={c.title} loading="lazy" className="w-full h-full object-cover" />}
                            </div>
                            <div className="text-xs leading-tight">{c.title}</div>
                            {c.pendingCopy && <div className="text-[10px] text-muted-foreground" title={PENDING_COPY_TITLE}>{PENDING_COPY_LABEL}</div>}
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <label className="text-xs font-medium flex items-center gap-2">
                    Pagina produsului
                    <select className={SELECT} value={productSlug ?? ""} onChange={(e) => setProductSlug(e.target.value)}>
                        {shown.map((d) => <option key={String(d.slug)} value={String(d.slug)}>{String(d.title)}</option>)}
                    </select>
                </label>
                {draft && <ProductPagePreview draft={draft} />}
            </div>

            {hidden.length > 0 && (
                <details className="text-xs">
                    <summary className="cursor-pointer font-medium">
                        Rămân ascunse — fără adresă de imagine în fișier ({hidden.length}); se publică doar dacă adăugați imagini în fișier
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                        {hidden.map((d) => <li key={String(d.slug)}>{String(d.title)} <span className="text-muted-foreground">({String(d.slug)})</span></li>)}
                    </ul>
                </details>
            )}

            <div className="space-y-2">
                <div className="text-xs font-medium">Filtrele, după import</div>
                <div className="grid gap-3 lg:grid-cols-3">
                    {producerId
                        ? panel("producer", `Categoria producătorului: ${categoryLabel(producerId, context)}`, { kind: "category", id: producerId })
                        : <div className="text-xs text-muted-foreground">Fișierul nu are niciun produs.</div>}
                    <div className="space-y-1">
                        {collectionIds.length > 0 ? (
                            <>
                                <select className={`${SELECT} w-full`} value={collectionId ?? ""} onChange={(e) => setCollectionId(e.target.value)}>
                                    {collectionIds.map((id) => <option key={id} value={id}>{categoryLabel(id, context)}</option>)}
                                </select>
                                {collectionId && panel(`collection:${collectionId}`, `Colecția: ${categoryLabel(collectionId, context)}`, { kind: "category", id: collectionId })}
                            </>
                        ) : <div className="text-xs text-muted-foreground">Nicio colecție separată de categoria producătorului.</div>}
                    </div>
                    {panel("shop", "Magazinul", { kind: "shop" })}
                </div>
            </div>
        </div>
    );
}

function ProductPagePreview({ draft }: { draft: PreviewItem }) {
    const page = previewProductPage(draft);
    return (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] rounded-md bg-muted/40 p-3">
            <div className="grid grid-cols-3 gap-1">
                {page.gallery.length === 0 && <div className="col-span-3 text-xs text-muted-foreground">Fără imagini.</div>}
                {page.gallery.map((src) => <img key={src} src={src} alt="" loading="lazy" className="aspect-square w-full object-cover rounded" />)}
            </div>
            <div className="space-y-2">
                <div>
                    <div className="font-semibold">{page.title}</div>
                    <div className="text-xs text-muted-foreground">{page.brand}</div>
                </div>
                <div className="text-xs">
                    <span className="font-medium">{page.variantName}:</span> {page.options.map((o) => o.value).join(", ")}
                </div>
                {page.attributes.length > 0 && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                        {page.attributes.map((a) => (
                            <div key={a.key} className="contents">
                                <dt className="text-muted-foreground">{a.key}</dt>
                                <dd className="font-medium">{a.value}</dd>
                            </div>
                        ))}
                    </dl>
                )}
                {page.longDescription !== null && <ProseText html={page.longDescription} />}
            </div>
        </div>
    );
}

/** The prose as text paragraphs (`proseParagraphs`, pure); rendered as React text, never injected as HTML. */
function ProseText({ html }: { html: string }) {
    return (
        <div className="text-xs space-y-1 border-t pt-2">
            <div className="font-medium">Descriere (textul publicat)</div>
            {proseParagraphs(html).map((p, i) => <p key={i}>{p}</p>)}
        </div>
    );
}

const FACET_HINT = "Prea multe filtre selectate — eliminați unul";

function FilterPanelPreview({ title, panel, onSelect }: { title: string; panel: PreviewPanel; onSelect: (f: string) => void }) {
    switch (panel.kind) {
        case "unavailable":
            return (
                <div className="space-y-1 text-xs">
                    <div className="font-medium">{title}</div>
                    <div className="text-muted-foreground">{panel.reason}</div>
                </div>
            );
        case "panel": {
            const { listing } = panel;
            const follow = (href: string | null) => (href === null ? undefined : () => onSelect(selectionOfHref(href)));
            return (
                <div className="space-y-2 text-xs">
                    <div>
                        <div className="font-medium">{title}</div>
                        <div className="text-muted-foreground break-all">{panel.path} — {listing.items.length} din {panel.baseCount} produse</div>
                    </div>
                    {listing.tooLong && <div className="text-muted-foreground">Filtrele din adresă sunt prea lungi și nu au fost aplicate.</div>}
                    {listing.chips.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {listing.chips.map((c) => (
                                <button key={`${c.facetLabel}\u0000${c.value}`} type="button" disabled={c.href === null} onClick={follow(c.href)}
                                    className="rounded-full border px-2 py-0.5 hover:bg-muted">
                                    {c.facetLabel}: {c.value} ×
                                </button>
                            ))}
                            {listing.clearHref && <button type="button" className="underline" onClick={follow(listing.clearHref)}>Șterge filtrele</button>}
                        </div>
                    )}
                    {listing.budgetHint && <div className="text-muted-foreground">{FACET_HINT}</div>}
                    {listing.facets.length === 0 && <div className="text-muted-foreground">Niciun filtru nu este afișat pe această pagină.</div>}
                    {listing.facets.map((facet) => (
                        <details key={facet.id} open={facet.values.length <= 10}>
                            <summary className="cursor-pointer font-medium">{facet.label}</summary>
                            <ul className="pl-2 space-y-0.5">
                                {facet.values.map((v) => <li key={v.value}><FacetValueButton v={v} follow={follow} /></li>)}
                            </ul>
                        </details>
                    ))}
                </div>
            );
        }
        default:
            return assertNever(panel);
    }
}

function FacetValueButton({ v, follow }: { v: FacetValueView; follow: (href: string | null) => (() => void) | undefined }) {
    switch (v.state) {
        case "link":
            return <button type="button" className="hover:text-primary text-left" onClick={follow(v.href)}>{v.value} ({v.count})</button>;
        case "selected":
            return <button type="button" className="font-semibold text-primary text-left" disabled={v.href === null} onClick={follow(v.href)}>✓ {v.value} ({v.count})</button>;
        case "zero":
            return <span className="text-muted-foreground opacity-60">{v.value} (0)</span>;
        case "too-long":
            return <span className="text-muted-foreground opacity-60" title={FACET_HINT}>{v.value} ({v.count})</span>;
        default:
            return assertNever(v);
    }
}
