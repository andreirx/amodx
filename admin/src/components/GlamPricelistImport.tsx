import { useEffect, useReducer, useRef, useState } from "react";
import { utcDay } from "@amodx/shared";
import { ApiError, apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload } from "lucide-react";
import {
    ImportPreview, NOT_LOADED, ProfileEditorPanel, baseRevisionOf, confirmChoiceOf, editedEditor, editorAfterConflict,
    editorAfterImport, loadEditor, movedNotice, previewedEditor, storedMoved, type ExecutionProfileReport, type GlamDryRun,
    type ProfileChoice, type ProfileEdit, type ProfileEditor,
} from "./GlamProfileEditor";
import { siteContextOf, type SiteContext } from "./glamPreview";

/**
 * CAT-IMPORT-1 — Products → Import → "Listă de prețuri (glam)" (catalog sites only; mounted by `pages/Products.tsx`).
 * One enriched pricelist CSV per upload. The user always sees a dry run first (`?dryRun=1`: what would be replaced and
 * created, nothing written), then confirms. The backend (`POST /import/glam-pricelist`) is the authority for every
 * rule; this form collects the fields, shows the report, and guarantees that the confirmed import is EXACTLY the
 * input the shown report was made for (`glamFormReducer`).
 *
 * CAT-IMAGES-1 — after a successful import the form copies the sheet's producer images into the site's media by
 * itself: `POST /import/glam-pricelist/images` `{ producer, sheet }`, one bounded batch per request, called again
 * until `complete` (`imageCopyReducer`). "Copiază imaginile" starts the same copy for a producer/sheet without an
 * import in this session. The image section lists every refused or failed source with the rows that hold it
 * (`imageProblems`).
 *
 * CAT-IMAGE-GATE-1 (docs/slices/cat-image-gate-1.md § 3 items 4, 6) — an import without "Publică și produsele fără
 * imagine" writes every product hidden; the copy publishes each product whose image copies. The check and the import
 * report state how many start hidden and which rows have no image address (`publication`); the image section counts
 * the products published and lists those that stay hidden for lack of an image (`hiddenProducts`).
 *
 * CAT-IMPORT-PROFILE-1C — the producer's import profile (docs/slices/cat-import-profile-1.md § 5, § 6): the first
 * "Check the file" loads the stored profile (or the default) into the editor (`ProfileEditor`, a member of this
 * form's state); "Previzualizează" sends a dry run with `profileChoice` = { the edited profile, the loaded stored
 * revision }; "Confirm the import" sends the snapshot the shown preview was made for. A 409 "changed by another
 * import" reloads the stored profile and asks for a new preview (§ 6.6). Editor and preview: GlamProfileEditor.tsx,
 * glamPreview.ts.
 */

interface Props {
    /** Called after a successful import, to reload the product list. */
    onImported: () => void;
}

const SKIP_REASONS: Record<string, string> = {
    "no-name": "no product name",
    "no-collection": "no collection",
    "separator-in-key": "an invisible separator character in the name or collection",
};

// ── The form state (pure; tested in GlamPricelistImport.test.ts) ────────────────────────────────────────────────────

export interface GlamInput {
    csvContent: string;
    fileName: string;
    producer: string;
    sheet: string;
    variantName: string;
}

export interface GlamFormState {
    /** Bumped by every change of the input (file chosen, file read, field edited). A report is valid for one revision. */
    revision: number;
    /** The token of the latest file choice; a file read completes only for that choice. */
    fileToken: number;
    /** A file read is pending: checking is not possible. */
    reading: boolean;
    input: GlamInput;
    /**
     * The accepted dry run, bound to the exact input it was sent with. `choice` = what "Confirm the import" sends as
     * `profileChoice`: the choice a preview was sent with, or — for the first check, sent without one — the profile
     * that check was planned with (`confirmChoiceOf`); `null` = this report cannot be imported (unsupported stored
     * profile, § 3.3). `context` = the site's URL prefixes and categories for the preview panels (`null`: not read).
     */
    preview: { revision: number; input: GlamInput; choice: ProfileChoice | null; report: any; context: SiteContext | null } | null;
    /** The producer's import-profile editor. Reset when the file or the producer changes (a profile is per producer). */
    profile: ProfileEditor;
    pending: "check" | "import" | null;
    result: any;
    error: string | null;
}

export type GlamFormEvent =
    | { type: "file-chosen"; fileName: string; fileToken: number }
    | { type: "file-read"; fileToken: number; content: string }
    | { type: "field"; field: "producer" | "sheet" | "variantName"; value: string }
    | { type: "check-sent" }
    /** `choice` = the `profileChoice` the dry run was SENT with (`null`: none — the stored profile is loaded). */
    | { type: "check-done"; revision: number; input: GlamInput; choice: ProfileChoice | null; report: any; context: SiteContext | null }
    | { type: "check-failed"; revision: number; message: string }
    | { type: "import-sent" }
    | { type: "import-done"; result: any }
    | { type: "import-failed"; message: string }
    /** 503 "incomplete": the products were written and the profile saved; the answer reports the stored state. */
    | { type: "import-incomplete"; message: string; reported: ExecutionProfileReport }
    /** 409: another import changed the stored profile since it was loaded (§ 6.6); a reload dry run follows. */
    | { type: "import-profile-changed"; message: string; storedRevision: number | null }
    | { type: "profile-edit"; edit: ProfileEdit };

export const INITIAL_GLAM_FORM: GlamFormState = {
    revision: 0, fileToken: 0, reading: false,
    input: { csvContent: "", fileName: "", producer: "", sheet: "", variantName: "Variantă" },
    preview: null, profile: NOT_LOADED, pending: null, result: null, error: null,
};

/**
 * Every input change clears the shown report. Completions that belong to an older revision (a dry run sent before an
 * edit) or an older file choice (a slow read of a file the user replaced) are ignored. Choosing a file drops the old
 * content at once, so it cannot be checked or imported while the new file is read.
 *
 * Profile (1c): a profile edit is an input change too (revision bumped, report withdrawn). A check answered WITHOUT a
 * choice loads the editor — or, when it is already loaded (the reload after a 409), only refreshes its stored base and
 * facts and shows no importable report: the user must preview again (§ 6.6).
 */
export function glamFormReducer(state: GlamFormState, event: GlamFormEvent): GlamFormState {
    const changed = (input: GlamInput, extra: Partial<GlamFormState> = {}): GlamFormState =>
        ({ ...state, ...extra, input, revision: state.revision + 1, preview: null, result: null, error: null });
    switch (event.type) {
        case "file-chosen":
            return changed(
                { ...state.input, csvContent: "", fileName: event.fileName, sheet: event.fileName.replace(/\.csv$/i, "") },
                { fileToken: event.fileToken, reading: true, profile: NOT_LOADED },
            );
        case "file-read":
            if (event.fileToken !== state.fileToken) return state;
            return changed({ ...state.input, csvContent: event.content }, { reading: false });
        case "field":
            return changed({ ...state.input, [event.field]: event.value }, event.field === "producer" ? { profile: NOT_LOADED } : {});
        case "profile-edit":
            return changed(state.input, { profile: editedEditor(state.profile, event.edit) });
        case "check-sent":
            return { ...state, pending: "check", error: null };
        case "check-done": {
            if (event.revision !== state.revision) return { ...state, pending: null };
            const report = event.report as GlamDryRun;
            const shown = (choice: ProfileChoice | null) => ({ revision: event.revision, input: event.input, choice, report: event.report, context: event.context });
            if (event.choice !== null) return { ...state, pending: null, profile: previewedEditor(state.profile, report), preview: shown(event.choice) };
            switch (state.profile.kind) {
                case "editing":
                    return { ...state, pending: null, profile: loadEditor(state.profile, report) };
                case "not-loaded":
                case "unsupported":
                    return { ...state, pending: null, profile: loadEditor(state.profile, report), preview: shown(confirmChoiceOf(report.profile)) };
                default: {
                    const unhandled: never = state.profile;
                    throw new Error(`Unhandled profile editor ${JSON.stringify(unhandled)}`);
                }
            }
        }
        case "check-failed":
            if (event.revision !== state.revision) return { ...state, pending: null };
            return { ...state, pending: null, error: event.message };
        case "import-sent":
            return { ...state, pending: "import", error: null };
        case "import-done":
            return { ...state, pending: null, preview: null, result: event.result, profile: editorAfterImport(state.profile, event.result) };
        case "import-failed":
            return { ...state, pending: null, error: event.message };
        case "import-incomplete":
            return { ...state, pending: null, error: event.message, profile: editorAfterImport(state.profile, event.reported) };
        case "import-profile-changed":
            return { ...state, pending: null, preview: null, error: event.message, profile: editorAfterConflict(state.profile, event.storedRevision) };
    }
}

/** A dry run may be sent: no file read pending, no request pending, and the three required fields present. */
export function canCheck(state: GlamFormState): boolean {
    const { csvContent, producer, sheet } = state.input;
    return !state.reading && state.pending === null && csvContent !== "" && producer.trim() !== "" && sheet.trim() !== "";
}

/**
 * The request a check sends now: none loaded yet → no choice (the stored profile is loaded); editing → the working
 * profile with the loaded stored revision as `baseRevision`; an unsupported stored profile with nothing chosen → none
 * possible (take the proposal first).
 */
export function checkRequest(state: GlamFormState): { input: GlamInput; choice: ProfileChoice | null } | null {
    if (!canCheck(state)) return null;
    switch (state.profile.kind) {
        case "not-loaded": return { input: state.input, choice: null };
        case "editing": return { input: state.input, choice: { profile: state.profile.working, baseRevision: baseRevisionOf(state.profile.base) } };
        case "unsupported": return null;
        default: {
            const unhandled: never = state.profile;
            throw new Error(`Unhandled profile editor ${JSON.stringify(unhandled)}`);
        }
    }
}

/**
 * What a confirmation sends: the checked snapshot — the input AND the profile choice the shown report was made for —
 * and only while it is still the current revision and the report is importable.
 */
export function confirmRequest(state: GlamFormState): { input: GlamInput; choice: ProfileChoice | null } | null {
    const p = state.preview;
    if (!p || p.revision !== state.revision || state.pending !== null || p.choice === null) return null;
    return { input: p.input, choice: p.choice };
}

/** A 503 whose body reports the stored state (`profile` + `sheets`): the import wrote, but category lists are incomplete. */
export function incompleteImportReport(err: unknown): ExecutionProfileReport | null {
    if (!(err instanceof ApiError) || err.status !== 503 || typeof err.body !== "object" || err.body === null) return null;
    const body = err.body as Record<string, unknown>;
    if (typeof body.profile !== "object" || body.profile === null || !Array.isArray(body.sheets)) return null;
    return { profile: body.profile as ExecutionProfileReport["profile"], sheets: body.sheets as ExecutionProfileReport["sheets"] };
}

/** § 6.6: a 409 whose body names the stored and the loaded revision is "changed by another import" (backend `profileRefusal`). */
export function profileChangedRefusal(err: unknown): { storedRevision: number | null } | null {
    if (!(err instanceof ApiError) || err.status !== 409 || typeof err.body !== "object" || err.body === null) return null;
    const body = err.body as Record<string, unknown>;
    if (!("storedRevision" in body) || !("baseRevision" in body)) return null;
    return { storedRevision: typeof body.storedRevision === "number" ? body.storedRevision : null };
}

/** Producer suggestions: the distinct non-empty `brand` values, sorted. */
export function brandsOf(items: { brand?: string }[]): string[] {
    return [...new Set(items.map((p) => (p.brand ?? "").trim()).filter(Boolean))].sort();
}

// ── The image copy (CAT-IMAGES-1; pure parts tested in GlamPricelistImport.test.ts) ─────────────────────────────────

export interface ImageCopyTarget {
    producer: string;
    sheet: string;
}

/** The outcome of one source in one request (the images route's per-source result, without URL and holders). */
export type SourceResultKind = "ingested" | "cached" | "refused" | "failed";
export interface SourceResult {
    kind: SourceResultKind;
    cdnUrl?: string;
    rule?: string;
    failure?: { kind: "http"; reason: string; status: number; contentType: string | null; bytes: number } | { kind: "error"; code: string };
}

/** One product the images route reports as hidden for lack of an image (`hiddenWithoutImage`). */
export interface HiddenProductDTO {
    productId: string;
    slug: string;
    title: string;
}

/** One (product, option) holding of a source, as the latest request that rewrote it reported it (`mergeSources`). */
export interface HolderOutcome {
    productId: string;
    slug: string;
    option: string;
    batch: number;
    result: SourceResult;
}

/** Everything reported for one producer URL across the batches of a copy, merged by URL. */
export interface SourceRecord {
    url: string;
    holders: HolderOutcome[];
}

export interface ImageCopyTotals {
    /** By producer URL: the batches are merged by source identity, never added up (review-0 CIM-F2). */
    sources: Record<string, SourceRecord>;
    /**
     * Copy provenance, separate from committed holdings (review-1 CIM-F2): every URL a batch of THIS copy fetched and
     * stored (the route's `copied`), even when none of its products was written in that batch.
     */
    copiedThisSession: Record<string, true>;
    productsUpdated: number;
    productsReplaced: number;
    /** CAT-IMAGE-GATE-1: products this copy published (their first image copied), summed over batches. */
    productsPublished: number;
    /**
     * CAT-IMAGE-GATE-1: after the last batch, the products of the sheet that stay hidden for lack of an image (the
     * route's `hiddenWithoutImage`, computed over the whole sheet each batch, so the latest answer replaces the earlier
     * one). `null` until a batch answered.
     */
    hidden: HiddenProductDTO[] | null;
    /** After the last batch: (product, option) holdings still on a producer URL — the measure that must fall. */
    remainingOptions: number | null;
    /** After the last batch: distinct producer URLs among them. */
    remainingSources: number | null;
    batches: number;
    /** The `importSource` the server answered for (to join with an import report of the same sheet). */
    importSource: string | null;
}

/** The copy as a sum type: each state carries only what is valid in it. */
export type ImageCopyState =
    | { kind: "idle" }
    | { kind: "running"; target: ImageCopyTarget; totals: ImageCopyTotals }
    | { kind: "done"; target: ImageCopyTarget; totals: ImageCopyTotals }
    | { kind: "stopped"; target: ImageCopyTarget; totals: ImageCopyTotals; error: string };

export type ImageCopyEvent =
    /**
     * `resume` (CIG-R3): keep the outcomes recorded so far ("Copiază imaginile" again on the same sheet). `false`: start
     * from nothing — the copy that follows an import (its products are new). Either way, a batch answered for another
     * `importSource` than the recorded one discards the recorded outcomes first (`imageCopyReducer`).
     */
    | { type: "start"; target: ImageCopyTarget; resume: boolean }
    | { type: "batch"; response: any }
    | { type: "failed"; message: string };

export const IDLE_IMAGE_COPY: ImageCopyState = { kind: "idle" };

const NO_TOTALS: ImageCopyTotals = {
    sources: {}, copiedThisSession: {}, productsUpdated: 0, productsReplaced: 0, productsPublished: 0, hidden: null,
    remainingOptions: null, remainingSources: null, batches: 0, importSource: null,
};

const holderKey = (h: { productId: string; option: string }) => `${h.productId}\u0000${h.option}`;

/**
 * Merge one batch's sources into the records, by URL (review-2 CIM-F2-OVERLAP). Rule: a holding's recorded outcome is
 * its LATEST committed outcome. A batch reports a holding only when it wrote that option, so a holding reported again
 * (an overlapping stale write restored its producer URL, § 9, and this batch rewrote it) supersedes its earlier outcome
 * wherever that was recorded — under the same URL or another one. Counts and problems read current outcomes only.
 */
function mergeSources(records: Record<string, SourceRecord>, reported: any[], batch: number): Record<string, SourceRecord> {
    const incoming = new Set<string>();
    for (const source of reported) for (const h of source.holders) incoming.add(holderKey(h));
    const next: Record<string, SourceRecord> = {};
    for (const [url, record] of Object.entries(records)) {
        next[url] = { url, holders: record.holders.filter((h) => !incoming.has(holderKey(h))) };
    }
    for (const source of reported) {
        const { url, holders, ...result } = source;
        const record = next[url] ?? { url, holders: [] };
        const added = (holders as { productId: string; slug: string; option: string }[])
            .map((h) => ({ productId: h.productId, slug: h.slug, option: h.option, batch, result: result as SourceResult }));
        next[url] = { url, holders: [...record.holders, ...added] };
    }
    return next;
}

/**
 * The batch loop's transitions. A batch answer is merged by source URL (`mergeSources`); `complete` ends the copy; a
 * batch that wrote no product (none updated, none found replaced) while work remains stops it — every batch that
 * writes lowers `remainingOptions`, so repeating a batch that wrote nothing could loop. Events that do not apply to
 * the current state leave it unchanged.
 */
export function imageCopyReducer(state: ImageCopyState, event: ImageCopyEvent): ImageCopyState {
    switch (event.type) {
        case "start":
            if (state.kind === "running") return state;
            return { kind: "running", target: event.target, totals: event.resume && state.kind !== "idle" ? state.totals : NO_TOTALS };
        case "batch": {
            if (state.kind !== "running") return state;
            const r = event.response;
            // Outcomes recorded for another product set are never merged into this one.
            const t = state.totals.importSource !== null && state.totals.importSource !== r.importSource ? NO_TOTALS : state.totals;
            const totals: ImageCopyTotals = {
                sources: mergeSources(t.sources, r.sources, t.batches + 1),
                copiedThisSession: { ...t.copiedThisSession, ...Object.fromEntries((r.copied ?? []).map((c: { url: string }) => [c.url, true])) },
                productsUpdated: t.productsUpdated + r.products.updated,
                productsReplaced: t.productsReplaced + r.products.replaced.length,
                productsPublished: t.productsPublished + (r.products.published?.length ?? 0),
                hidden: r.hiddenWithoutImage ?? t.hidden,
                remainingOptions: r.progress.remainingOptions,
                remainingSources: r.progress.remainingSources,
                batches: t.batches + 1,
                importSource: r.importSource,
            };
            if (r.complete) return { kind: "done", target: state.target, totals };
            if (r.products.updated === 0 && r.products.replaced.length === 0) {
                return {
                    kind: "stopped", target: state.target, totals,
                    error: `The site changed no product in the last request and ${r.progress.remainingSources} image(s) are left. Try "Copiază imaginile" again later.`,
                };
            }
            return { kind: "running", target: state.target, totals };
        }
        case "failed":
            return state.kind === "running" ? { kind: "stopped", target: state.target, totals: state.totals, error: event.message } : state;
    }
}

const isLoss = (kind: SourceResultKind) => kind === "refused" || kind === "failed";

/**
 * The one kind of a source across batches (precedence): a PROBLEM when any of its holdings lost its image — then the
 * latest such outcome gives refused/failed and the reason; otherwise `ingested` when a batch of this copy fetched it
 * (`copiedThisSession`, whether its holdings were written in that batch or later from `MEDIAMAP#`); otherwise
 * `cached` (copied before this session). A failure then a success (a transient error) is therefore still a problem,
 * for the holdings that lost the image only.
 */
export function summarizeSource(record: SourceRecord, copiedThisSession: boolean): { kind: SourceResultKind; result: SourceResult; lost: HolderOutcome[] } {
    const lost = record.holders.filter((h) => isLoss(h.result.kind));
    if (lost.length > 0) {
        const latest = lost.reduce((a, b) => (b.batch >= a.batch ? b : a));
        return { kind: latest.result.kind, result: latest.result, lost };
    }
    const copied = copiedThisSession || record.holders.some((h) => h.result.kind === "ingested");
    return { kind: copied ? "ingested" : "cached", result: record.holders[0].result, lost };
}

/**
 * Counts per kind over DISTINCT producer URLs that some product now uses or lost (≥ 1 committed holding), each counted
 * once by `summarizeSource`. A URL copied but whose products were never written (the copy stopped first, or they were
 * replaced) is not counted: no product shows it.
 */
export function imageCounts(totals: ImageCopyTotals): Record<SourceResultKind, number> {
    const counts: Record<SourceResultKind, number> = { ingested: 0, cached: 0, refused: 0, failed: 0 };
    for (const record of Object.values(totals.sources)) {
        if (record.holders.length > 0) counts[summarizeSource(record, totals.copiedThisSession[record.url] === true).kind]++;
    }
    return counts;
}

/** Why a source is not on the site, in plain words. */
export function problemReason(result: SourceResult): string {
    if (result.kind === "refused") return `refused: ${result.rule ?? "destination not allowed"}`;
    const f = result.failure;
    if (!f) return "failed";
    if (f.kind === "error") return `no answer (${f.code})`;
    const what = f.reason === "not-image" ? "not an image" : f.reason === "too-large" ? "too large" : "error status";
    return `HTTP ${f.status}, ${f.contentType ?? "no content type"}, ${f.bytes} bytes — ${what}`;
}

/**
 * The failure list: one entry per problem URL, with the holdings that LOST the image. With the import report of the
 * same sheet in memory, a holding is shown as its file rows (product slug + option value → the report's
 * `rowIndexes`); otherwise — a copy started without an import in this session, or a holding the report does not
 * name — as the product address and the variant label.
 */
export function imageProblems(totals: ImageCopyTotals, importReport: any | null) {
    const report = importReport && totals.importSource !== null && importReport.importSource === totals.importSource ? importReport : null;
    const out: { url: string; reason: string; places: string[] }[] = [];
    for (const record of Object.values(totals.sources)) {
        if (record.holders.length === 0) continue;
        const summary = summarizeSource(record, totals.copiedThisSession[record.url] === true);
        if (!isLoss(summary.kind)) continue;
        const rows = new Set<number>();
        const labels: string[] = [];
        for (const h of summary.lost) {
            const option = report?.products.find((p: any) => p.slug === h.slug)?.options.find((o: any) => o.value === h.option);
            if (option) for (const r of option.rowIndexes) rows.add(r);
            else labels.push(`${h.slug} — ${h.option}`);
        }
        const places = [...[...rows].sort((a, b) => a - b).map((r) => `row ${r}`), ...labels];
        out.push({ url: record.url, reason: problemReason(summary.result), places });
    }
    return out;
}

/**
 * Why a product stays hidden, as far as this page knows (CIG-R3: missing evidence is never an absence claim):
 *   - `failed`: the sources it lost, with the reasons, recorded by this copy (or the resumed one before it);
 *   - `no-image-address`: the import report of the same sheet, in memory, shows no image address for it;
 *   - `unknown`: neither — e.g. a copy started without an import in this session whose failures were recorded earlier.
 */
export type HiddenCause =
    | { kind: "failed"; sources: { url: string; reason: string }[] }
    | { kind: "no-image-address" }
    | { kind: "unknown" };

/**
 * CAT-IMAGE-GATE-1 § 3 item 4 — the products that stay hidden for lack of an image, after the latest batch: title,
 * address, the file rows (from the import report of the same sheet, when in memory) and the cause (`HiddenCause`).
 */
export function hiddenProducts(totals: ImageCopyTotals, importReport: any | null): { slug: string; title: string; rows: number[]; cause: HiddenCause }[] {
    const report = importReport && totals.importSource !== null && importReport.importSource === totals.importSource ? importReport : null;
    return (totals.hidden ?? []).map((h) => {
        const failed: { url: string; reason: string }[] = [];
        for (const record of Object.values(totals.sources)) {
            const lost = record.holders.filter((x) => x.productId === h.productId && isLoss(x.result.kind));
            if (lost.length > 0) failed.push({ url: record.url, reason: problemReason(lost.reduce((a, b) => (b.batch >= a.batch ? b : a)).result) });
        }
        const planned = report?.products.find((p: any) => p.slug === h.slug);
        const cause: HiddenCause = failed.length > 0 ? { kind: "failed", sources: failed }
            : planned && !planned.options.some((o: any) => o.imageLink) ? { kind: "no-image-address" }
            : { kind: "unknown" };
        const rows: number[] = planned?.rowIndexes ?? [];
        return { slug: h.slug, title: h.title, rows: [...rows].sort((a, b) => a - b), cause };
    });
}

/** The cause in words (Romanian, § 3 item 4). */
export function hiddenCauseText(cause: HiddenCause): string[] {
    switch (cause.kind) {
        case "failed": return cause.sources.map((f) => `${f.url} — ${f.reason}`);
        case "no-image-address": return ["Fără adresă de imagine în fișier."];
        case "unknown": return [HIDDEN_CAUSE_UNKNOWN];
        default: {
            const unhandled: never = cause;
            throw new Error(`Unhandled hidden cause ${JSON.stringify(unhandled)}`);
        }
    }
}

export const HIDDEN_CAUSE_UNKNOWN = "Cauza nu este cunoscută în această sesiune: fie rândul nu are adresă de imagine, fie imaginile lui au eșuat la o copiere anterioară. Importați lista din nou și copiați imaginile ca să vedeți adresele care eșuează.";

/** The request body; `profileChoice` only when a choice is sent (without it the backend applies the stored profile). */
export const requestBody = (input: GlamInput, choice: ProfileChoice | null) =>
    JSON.stringify({
        csvContent: input.csvContent, producer: input.producer, sheet: input.sheet, variantName: input.variantName,
        ...(choice ? { profileChoice: choice } : {}),
    });

const explain = (err: any) => {
    const message: string = err?.message || "The import failed.";
    return message.includes("(503)")
        ? `${message} — If the site took too long to answer, the import may still be finishing: wait a minute and reload the product list. Importing the same file again is always safe: it replaces the sheet's products in full.`
        : message;
};

export function GlamPricelistImport({ onImported }: Props) {
    const [state, dispatch] = useReducer(glamFormReducer, INITIAL_GLAM_FORM);
    const [brands, setBrands] = useState<string[]>([]);
    const fileTokens = useRef(0); // one fresh token per file choice
    const [images, setImages] = useState<ImageCopyState>(IDLE_IMAGE_COPY);
    const copyRunning = useRef(false); // one copy loop at a time

    // Producer suggestions, independent of the page's status/category filters: one unfiltered GET /products. That
    // route reads ONE DynamoDB page (≤ 1 MB of product items, backend products/list.ts — no LastEvaluatedKey loop), so
    // on a very large site the list can miss brands; any producer name can still be typed.
    async function loadBrands() {
        try {
            const res = await apiRequest("/products");
            setBrands(brandsOf(res.items || []));
        } catch {
            setBrands([]);
        }
    }
    useEffect(() => { loadBrands(); }, []);

    async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        const fileToken = ++fileTokens.current;
        dispatch({ type: "file-chosen", fileName: file.name, fileToken });
        dispatch({ type: "file-read", fileToken, content: await file.text() });
    }

    /** The preview panels need the site's URL prefixes and categories; without them the panels say so. */
    async function loadSiteContext(): Promise<SiteContext | null> {
        try {
            const [settings, categories] = await Promise.all([apiRequest("/settings"), apiRequest("/categories")]);
            return siteContextOf(settings ?? {}, categories?.items ?? []);
        } catch {
            return null;
        }
    }

    async function sendCheck(revision: number, input: GlamInput, choice: ProfileChoice | null) {
        dispatch({ type: "check-sent" });
        try {
            const [report, context] = await Promise.all([
                apiRequest("/import/glam-pricelist?dryRun=1", { method: "POST", body: requestBody(input, choice) }),
                loadSiteContext(),
            ]);
            dispatch({ type: "check-done", revision, input, choice, report, context });
        } catch (err) {
            dispatch({ type: "check-failed", revision, message: explain(err) });
        }
    }

    async function check() {
        const request = checkRequest(state);
        if (request) await sendCheck(state.revision, request.input, request.choice);
    }

    async function confirm() {
        const request = confirmRequest(state);
        if (!request) return;
        dispatch({ type: "import-sent" });
        let result: any;
        try {
            result = await apiRequest("/import/glam-pricelist", { method: "POST", body: requestBody(request.input, request.choice) });
            dispatch({ type: "import-done", result });
            onImported();
            loadBrands();
        } catch (err) {
            const changed = profileChangedRefusal(err);
            if (changed) {
                // § 6.6: nothing was written; reload the stored profile (a dry run without a choice), then the user previews again.
                dispatch({
                    type: "import-profile-changed", storedRevision: changed.storedRevision,
                    message: `Profilul producătorului a fost schimbat de alt import (revizia ${changed.storedRevision ?? "—"}) după ce l-ați încărcat. Nimic nu a fost schimbat. Profilul salvat se reîncarcă; alegeți profilul și previzualizați din nou.`,
                });
                await sendCheck(state.revision, request.input, null);
                return;
            }
            const incomplete = incompleteImportReport(err);
            if (incomplete) {
                dispatch({ type: "import-incomplete", message: explain(err), reported: incomplete });
                return;
            }
            dispatch({ type: "import-failed", message: explain(err) });
            return;
        }
        await copyImages({ producer: result.producer, sheet: result.sheet }, false);
    }

    /** The batch loop: one request per batch until the reducer leaves `running`. */
    /** `resume`: keep the outcomes recorded so far (the button); `false` after an import (new products). */
    async function copyImages(target: ImageCopyTarget, resume: boolean) {
        if (copyRunning.current) return;
        copyRunning.current = true;
        let s = imageCopyReducer(images, { type: "start", target, resume });
        setImages(s);
        while (s.kind === "running") {
            try {
                const response = await apiRequest("/import/glam-pricelist/images", { method: "POST", body: JSON.stringify(target) });
                s = imageCopyReducer(s, { type: "batch", response });
            } catch (err: any) {
                s = imageCopyReducer(s, { type: "failed", message: `${err?.message || "The image copy failed."} — Copying again is safe: images already copied are not fetched again.` });
            }
            setImages(s);
        }
        copyRunning.current = false;
        if (s.kind !== "idle" && s.totals.productsUpdated > 0) onImported(); // reload the list: images changed
    }

    const busy = state.pending !== null || images.kind === "running";
    const { input, preview, result, error } = state;
    const conflicts = preview?.report.categoryConflicts ?? [];
    const loaded = state.profile.kind !== "not-loaded";
    const moved = preview ? storedMoved(state.profile, preview.report) : null;
    const checkButton = (
        <Button variant="outline" onClick={check} disabled={checkRequest(state) === null}>
            {state.pending === "check" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} {loaded ? "Previzualizează" : "Check the file"}
        </Button>
    );

    return (
        <div className="space-y-3">
            <div>
                <h3 className="font-medium text-sm">Listă de prețuri (glam)</h3>
                <p className="text-xs text-muted-foreground">
                    Upload one enriched pricelist sheet (.csv). Each product of the sheet becomes one product on the site, its
                    sizes or colours become its variants. Prices are never read; lines of the specifications that name the
                    row's producer code are removed. Importing a sheet again replaces the products of that sheet.
                </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                    <Label>File</Label>
                    <Label htmlFor="glam-csv" className="cursor-pointer">
                        <div className="flex items-center gap-2 border rounded-md px-4 py-2 text-sm hover:bg-muted transition-colors">
                            {state.reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            {input.fileName || "Choose CSV file"}
                        </div>
                    </Label>
                    <Input id="glam-csv" type="file" accept=".csv" onChange={onFile} disabled={busy} className="hidden" />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="glam-producer">Producer</Label>
                    <Input id="glam-producer" list="glam-brands" value={input.producer} placeholder="e.g. BOEN"
                        onChange={(e) => dispatch({ type: "field", field: "producer", value: e.target.value })} disabled={busy} />
                    <datalist id="glam-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="glam-sheet">Sheet</Label>
                    <Input id="glam-sheet" value={input.sheet} placeholder="the file name"
                        onChange={(e) => dispatch({ type: "field", field: "sheet", value: e.target.value })} disabled={busy} />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="glam-variant">What the variants are</Label>
                    <Input id="glam-variant" value={input.variantName} placeholder="Variantă, Culoare, Format…"
                        onChange={(e) => dispatch({ type: "field", field: "variantName", value: e.target.value })} disabled={busy} />
                </div>
            </div>

            <div className="flex gap-2">
                {checkButton}
                {preview && conflicts.length === 0 && (
                    <Button onClick={confirm} disabled={confirmRequest(state) === null || images.kind === "running"}>
                        {state.pending === "import" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirm the import
                    </Button>
                )}
                <Button variant="outline" onClick={() => copyImages({ producer: input.producer, sheet: input.sheet }, true)}
                    disabled={busy || input.producer.trim() === "" || input.sheet.trim() === ""}
                    title="Copy the producer images of this producer and sheet into the site's media">
                    {images.kind === "running" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Copiază imaginile
                </Button>
            </div>

            {error && <div className="text-sm p-3 rounded-md bg-destructive/10 text-destructive">{error}</div>}
            {preview && <ImportReport report={preview.report} />}
            {preview && preview.choice === null && (
                <div className="text-sm p-3 rounded-md bg-destructive/10 text-destructive">
                    Acest raport nu poate fi importat: profilul salvat nu poate fi aplicat. Folosiți propunerea de mai jos și previzualizați.
                </div>
            )}
            {moved && (
                <div className="text-sm p-3 rounded-md bg-destructive/10 text-destructive">
                    {movedNotice(moved.storedRevision)}
                </div>
            )}
            <ProfileEditorPanel editor={state.profile} onEdit={(edit) => dispatch({ type: "profile-edit", edit })} disabled={busy} />
            {loaded && <div className="flex gap-2">{checkButton}</div>}
            {preview && <ImportPreview key={preview.revision} report={preview.report} context={preview.context} today={utcDay(new Date())} />}
            {result && (
                <div className="text-sm p-3 rounded-md bg-muted space-y-1">
                    <div className="font-medium">
                        Imported: {result.counts.products} products ({result.counts.options} variants), {result.counts.deleted} previous products
                        replaced, {result.categoriesCreated} new categories.
                    </div>
                    {result.publication && <PublicationLines publication={result.publication} dryRun={false} />}
                </div>
            )}
            {images.kind !== "idle" && <ImageCopyReport state={images} importReport={result} />}
        </div>
    );
}

/** Progress, then the image section: counts per kind and every source that is not on the site, with where it is used. */
function ImageCopyReport({ state, importReport }: { state: Exclude<ImageCopyState, { kind: "idle" }>; importReport: any }) {
    const { remainingOptions, remainingSources, batches, productsReplaced } = state.totals;
    const counts = imageCounts(state.totals);
    const problems = imageProblems(state.totals, importReport);
    const hidden = hiddenProducts(state.totals, importReport);
    return (
        <div className="text-sm p-3 rounded-md bg-muted space-y-2">
            <div className="font-medium flex items-center gap-2">
                {state.kind === "running" && <Loader2 className="h-4 w-4 animate-spin" />}
                Images of “{state.target.sheet}” by {state.target.producer}
                {state.kind === "running" && <> — copying (request {batches + 1}{remainingSources !== null ? `, ${remainingSources} image(s) on ${remainingOptions} variant(s) left` : ""})</>}
                {state.kind === "done" && <> — done</>}
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
                <li>Copied to the site now: <b>{counts.ingested}</b></li>
                <li>Already on the site from an earlier copy: <b>{counts.cached}</b></li>
                <li>Refused (address not allowed): <b>{counts.refused}</b></li>
                <li>Failed (no image at that address): <b>{counts.failed}</b></li>
                {productsReplaced > 0 && <li>Products replaced by another import during the copy: <b>{productsReplaced}</b></li>}
                <li>Produse publicate acum (o imagine a lor s-a copiat): <b>{state.totals.productsPublished}</b></li>
                {state.totals.hidden !== null && <li>Produse care rămân ascunse — nicio imagine copiată: <b>{state.totals.hidden.length}</b></li>}
            </ul>
            {state.kind === "stopped" && <div className="text-sm p-2 rounded-md bg-destructive/10 text-destructive">{state.error}</div>}
            {hidden.length > 0 && (
                <div className="space-y-1">
                    <div className="text-xs">
                        Aceste produse rămân ascunse pe site: niciuna dintre imaginile lor nu s-a copiat. Adăugați în fișier adrese de imagine care
                        funcționează și importați-l din nou. O imagine adăugată în editorul produsului se pierde la următorul import al listei.
                    </div>
                    <ul className="text-xs space-y-1">
                        {hidden.map((h) => (
                            <li key={h.slug}>
                                <b>{h.title}</b> <span className="text-muted-foreground">({h.slug}{h.rows.length > 0 ? `, rândurile ${h.rows.join(", ")}` : ""})</span>
                                {hiddenCauseText(h.cause).map((line) => <div key={line} className="text-muted-foreground break-all">{line}</div>)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {problems.length > 0 && (
                <div className="space-y-1">
                    <div className="text-xs">
                        These variants have no image now. Find a picture for each and add it in the product editor:
                    </div>
                    <ul className="text-xs space-y-1">
                        {problems.map((p) => (
                            <li key={p.url}>
                                <span className="break-all">{p.url}</span> — {p.reason}
                                <div className="text-muted-foreground">Used by: {p.places.join(", ")}</div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

/** The dry-run report in business language (spec § 3.4 "Report shape"). */
function ImportReport({ report }: { report: any }) {
    const skipped = report.rows.filter((r: any) => r.status === "skipped");
    return (
        <div className="text-sm p-3 rounded-md bg-muted space-y-2">
            <div className="font-medium">Check of “{report.sheet}” by {report.producer} — nothing has been changed yet</div>
            <ul className="list-disc pl-5 space-y-0.5">
                <li>
                    Products of this sheet now on the site, to be replaced: <b>{report.previousSet.count}</b>
                    {report.previousSet.count > 0 && <> (e.g. {report.previousSet.firstTitles.join(", ")})</>}
                </li>
                <li>Products to create: <b>{report.counts.products}</b>, with <b>{report.counts.options}</b> variants in total ({report.variantName})</li>
                <li>Rows merged into an existing variant (same label and image): <b>{report.counts.deduped}</b></li>
                <li>Variants given a label by the import (no label or a repeated label in the file): <b>{report.relabelled.length}</b></li>
                <li>New categories: <b>{report.categoriesCreated}</b></li>
                <li>Rows skipped: <b>{report.counts.skipped}</b> of {report.totalRows}</li>
            </ul>
            {report.publication && <PublicationLines publication={report.publication} dryRun={true} />}
            {report.categoryConflicts?.length > 0 && (
                <div className="text-sm p-2 rounded-md bg-destructive/10 text-destructive">
                    The import cannot run: {report.categoryConflicts.map((c: any) => `the category address “${c.slug}” belongs to a category that was renamed to “${c.storedSlug}”`).join("; ")}.
                    Rename it back, or use another producer or collection name.
                </div>
            )}
            {report.suffixedSlugs.length > 0 && (
                <div className="text-xs text-muted-foreground">
                    {report.suffixedSlugs.length} product address(es) got a number at the end because two products had the same address:
                    {" "}{report.suffixedSlugs.map((s: any) => `${s.slug} (row ${s.rowIndex})`).join(", ")}
                </div>
            )}
            {skipped.length > 0 && (
                <details>
                    <summary className="cursor-pointer text-xs">Skipped rows ({skipped.length})</summary>
                    <ul className="text-xs mt-1 space-y-0.5">
                        {skipped.map((r: any) => <li key={r.index}>Row {r.index}: {SKIP_REASONS[r.reason] ?? r.reason}</li>)}
                    </ul>
                </details>
            )}
            <details>
                <summary className="cursor-pointer text-xs">Products to create ({report.products.length})</summary>
                <ul className="text-xs mt-1 space-y-0.5">
                    {report.products.map((p: any) => (
                        <li key={p.slug}>{p.title} — {p.options.map((o: any) => o.value).join(", ")}{p.options.some((o: any) => o.imageLink) ? "" : " (no image)"}</li>
                    ))}
                </ul>
            </details>
        </div>
    );
}

/**
 * CAT-IMAGE-GATE-1 § 3 items 2, 4: the backend's `publication` member in words — how many products start hidden, and
 * the products whose rows have no image address (with `draft` they stay hidden after the copy; with `active` they are
 * published without an image).
 */
function PublicationLines({ publication, dryRun }: { publication: { status: "active" | "draft"; startHidden: number; withoutImageAddress: { slug: string; title: string; rowIndexes: number[] }[] }; dryRun: boolean }) {
    const none = publication.withoutImageAddress;
    const list = none.length > 0 && (
        <details>
            <summary className="cursor-pointer text-xs">
                {publication.status === "draft"
                    ? `Fără adresă de imagine în fișier — rămân ascunse dacă nu adăugați imagini în fișier (${none.length})`
                    : `Fără adresă de imagine în fișier — publicate fără imagine (${none.length})`}
            </summary>
            <ul className="text-xs mt-1 space-y-0.5">
                {none.map((p) => <li key={p.slug}>{p.title} ({p.slug}) — rândurile {p.rowIndexes.join(", ")}</li>)}
            </ul>
        </details>
    );
    switch (publication.status) {
        case "draft":
            return (
                <div className="text-xs space-y-1">
                    <div>
                        {dryRun ? "Ar porni ascunse" : "Pornesc ascunse"}: <b>{publication.startHidden}</b> produse — fiecare devine public când una dintre imaginile
                        lui se copiază pe site. Dacă copierea se oprește, apăsați din nou „Copiază imaginile”.
                    </div>
                    {list}
                </div>
            );
        case "active":
            return (
                <div className="text-xs space-y-1">
                    <div>Profilul publică și produsele fără imagine: toate produsele sunt publicate la import.</div>
                    {list}
                </div>
            );
        default: {
            const unhandled: never = publication.status;
            throw new Error(`Unhandled publication status ${String(unhandled)}`);
        }
    }
}
