import { useEffect, useReducer, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload } from "lucide-react";

/**
 * CAT-IMPORT-1 — Products → Import → "Listă de prețuri (glam)" (catalog sites only; mounted by `pages/Products.tsx`).
 * One enriched pricelist CSV per upload. The user always sees a dry run first (`?dryRun=1`: what would be replaced and
 * created, nothing written), then confirms. The backend (`POST /import/glam-pricelist`) is the authority for every
 * rule; this form collects the fields, shows the report, and guarantees that the confirmed import is EXACTLY the
 * input the shown report was made for (`glamFormReducer`).
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
    /** The accepted dry run, bound to the exact input it was sent with. */
    preview: { revision: number; input: GlamInput; report: any } | null;
    pending: "check" | "import" | null;
    result: any;
    error: string | null;
}

export type GlamFormEvent =
    | { type: "file-chosen"; fileName: string; fileToken: number }
    | { type: "file-read"; fileToken: number; content: string }
    | { type: "field"; field: "producer" | "sheet" | "variantName"; value: string }
    | { type: "check-sent" }
    | { type: "check-done"; revision: number; input: GlamInput; report: any }
    | { type: "check-failed"; revision: number; message: string }
    | { type: "import-sent" }
    | { type: "import-done"; result: any }
    | { type: "import-failed"; message: string };

export const INITIAL_GLAM_FORM: GlamFormState = {
    revision: 0, fileToken: 0, reading: false,
    input: { csvContent: "", fileName: "", producer: "", sheet: "", variantName: "Variantă" },
    preview: null, pending: null, result: null, error: null,
};

/**
 * Every input change clears the shown report. Completions that belong to an older revision (a dry run sent before an
 * edit) or an older file choice (a slow read of a file the user replaced) are ignored. Choosing a file drops the old
 * content at once, so it cannot be checked or imported while the new file is read.
 */
export function glamFormReducer(state: GlamFormState, event: GlamFormEvent): GlamFormState {
    const changed = (input: GlamInput, extra: Partial<GlamFormState> = {}): GlamFormState =>
        ({ ...state, ...extra, input, revision: state.revision + 1, preview: null, result: null, error: null });
    switch (event.type) {
        case "file-chosen":
            return changed(
                { ...state.input, csvContent: "", fileName: event.fileName, sheet: event.fileName.replace(/\.csv$/i, "") },
                { fileToken: event.fileToken, reading: true },
            );
        case "file-read":
            if (event.fileToken !== state.fileToken) return state;
            return changed({ ...state.input, csvContent: event.content }, { reading: false });
        case "field":
            return changed({ ...state.input, [event.field]: event.value });
        case "check-sent":
            return { ...state, pending: "check", error: null };
        case "check-done":
            if (event.revision !== state.revision) return { ...state, pending: null };
            return { ...state, pending: null, preview: { revision: event.revision, input: event.input, report: event.report } };
        case "check-failed":
            if (event.revision !== state.revision) return { ...state, pending: null };
            return { ...state, pending: null, error: event.message };
        case "import-sent":
            return { ...state, pending: "import", error: null };
        case "import-done":
            return { ...state, pending: null, preview: null, result: event.result };
        case "import-failed":
            return { ...state, pending: null, error: event.message };
    }
}

/** A dry run may be sent: no file read pending, no request pending, and the three required fields present. */
export function canCheck(state: GlamFormState): boolean {
    const { csvContent, producer, sheet } = state.input;
    return !state.reading && state.pending === null && csvContent !== "" && producer.trim() !== "" && sheet.trim() !== "";
}

/** The input a confirmation sends: the checked snapshot, and only while it is still the current revision. */
export function confirmInput(state: GlamFormState): GlamInput | null {
    return state.preview && state.preview.revision === state.revision && state.pending === null ? state.preview.input : null;
}

/** Producer suggestions: the distinct non-empty `brand` values, sorted. */
export function brandsOf(items: { brand?: string }[]): string[] {
    return [...new Set(items.map((p) => (p.brand ?? "").trim()).filter(Boolean))].sort();
}

const requestBody = (input: GlamInput) =>
    JSON.stringify({ csvContent: input.csvContent, producer: input.producer, sheet: input.sheet, variantName: input.variantName });

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

    async function check() {
        const snapshot = { revision: state.revision, input: state.input };
        dispatch({ type: "check-sent" });
        try {
            const report = await apiRequest("/import/glam-pricelist?dryRun=1", { method: "POST", body: requestBody(snapshot.input) });
            dispatch({ type: "check-done", ...snapshot, report });
        } catch (err) {
            dispatch({ type: "check-failed", revision: snapshot.revision, message: explain(err) });
        }
    }

    async function confirm() {
        const input = confirmInput(state);
        if (!input) return;
        dispatch({ type: "import-sent" });
        try {
            const result = await apiRequest("/import/glam-pricelist", { method: "POST", body: requestBody(input) });
            dispatch({ type: "import-done", result });
            onImported();
            loadBrands();
        } catch (err) {
            dispatch({ type: "import-failed", message: explain(err) });
        }
    }

    const busy = state.pending !== null;
    const { input, preview, result, error } = state;
    const conflicts = preview?.report.categoryConflicts ?? [];

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
                <Button variant="outline" onClick={check} disabled={!canCheck(state)}>
                    {state.pending === "check" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Check the file
                </Button>
                {preview && conflicts.length === 0 && (
                    <Button onClick={confirm} disabled={confirmInput(state) === null}>
                        {state.pending === "import" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirm the import
                    </Button>
                )}
            </div>

            {error && <div className="text-sm p-3 rounded-md bg-destructive/10 text-destructive">{error}</div>}
            {preview && <ImportReport report={preview.report} />}
            {result && (
                <div className="text-sm p-3 rounded-md bg-muted space-y-1">
                    <div className="font-medium">
                        Imported: {result.counts.products} products ({result.counts.options} variants), {result.counts.deleted} previous products
                        replaced, {result.categoriesCreated} new categories.
                    </div>
                </div>
            )}
        </div>
    );
}

/** The dry-run report in business language (spec § 3.4 "Report shape"). */
function ImportReport({ report }: { report: any }) {
    const skipped = report.rows.filter((r: any) => r.status === "skipped");
    const imageless = report.products.filter((p: any) => !p.options.some((o: any) => o.imageLink));
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
                <li>Products without any image: <b>{imageless.length}</b></li>
                <li>Variants given a label by the import (no label or a repeated label in the file): <b>{report.relabelled.length}</b></li>
                <li>New categories: <b>{report.categoriesCreated}</b></li>
                <li>Rows skipped: <b>{report.counts.skipped}</b> of {report.totalRows}</li>
            </ul>
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
