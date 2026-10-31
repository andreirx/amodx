import type { GlamRow } from "./parse.js";

/**
 * CAT-IMPORT-1 — rows → styles (storefront products) → options (variants). Pure. Spec: docs/slices/catalog-mode-1.md
 * § 3.4 "Product key" and "Variants" (CM-D3 / CM-D4 AMENDED).
 *
 * - The style key: producer + colecție + produs, each normalised by `norm`, joined with U+001F.
 * - One option per row of a style; rows with an equal normalised label AND an equal (trimmed) image cell are ONE
 *   option (§ 2.4; cat-import-1 § 9 withdrew the builder's usable-image variant). The option's image is then the
 *   cell when it is a usable URL, else none.
 * - Labels are then allocated collision-aware: `#<n>` for an empty label, `<label> (<n>)` for a repeated label,
 *   never a label already present in the style.
 * - Slugs: slugify of the three normalised components joined with a space; a repeated slug gets `-2`, `-3`… in file
 *   order, never a slug already present in the file.
 * - CAT-SLUG-UNIQUE-1 (docs/slices/cat-slug-unique-1.md § 1): with `crossSheet` (the slugs held by the tenant's products
 *   this import does not replace), a slug from the step above that another product holds is replaced by the held
 *   slug followed by the sheet's slug and/or a number, never a slug held or planned (exact rule: `avoidTakenSlugs`).
 */

/** The key separator. It may not occur inside a key component (refused per row, or per upload field). */
export const KEY_SEPARATOR = "\u001f";

/**
 * The § 3.4 key normalisation, in this order: trim → collapse every whitespace run to one space → locale-independent
 * lower-case → Unicode NFC LAST. Diacritics are kept; canonically equivalent input gives one form. U+001F is not
 * whitespace for `trim` or `\s`, so it survives (the separator rule depends on that).
 */
export function norm(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase().normalize("NFC");
}

/**
 * The slugify of `backend/src/import/woocommerce.ts:25-33`, copied verbatim: that function is not exported and the
 * WooCommerce importer is outside this slice (spec § 3.4 "Slug" and "Categories": the same slugify for products and
 * categories). Diacritics folded, punctuation dropped, no leading `/`.
 */
export function slugify(str: string): string {
    return str
        .toLowerCase()
        .trim()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")  // strip diacritics
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * CAT-IMPORT-PROFILE-1 ruling CIP1-VALUE-GUARD = B1 with T3 — the ONE folding of the value guard: `text` as the
 * address rule folds it (`slugify ∘ norm`, exactly what the category and product slugs compute from a component),
 * cut into its tokens (the slug's `-`-separated parts). Derived from `slugify`, so the two cannot drift; a corpus test
 * (`glam-profile.test.ts`) pins that the tokens join back to `slugify(text)`.
 */
export function foldTokens(text: string): string[] {
    return slugify(norm(text)).split("-").filter((token) => token !== "");
}

/** A usable option image: an absolute http(s) URL. Anything else is no image (CM-D7 (a)). */
export function usableImage(sourceUrl: string): string | undefined {
    if (!/^https?:\/\//i.test(sourceUrl)) return undefined;
    try {
        const url = new URL(sourceUrl);
        return url.protocol === "http:" || url.protocol === "https:" ? sourceUrl : undefined;
    } catch {
        return undefined;
    }
}

export type ImageDisposition = "used" | "absent" | "invalid";

/** The idx-9 cell of one row as read (trimmed; "" when empty) and what the import did with it. */
export interface RowImage {
    readonly sourceUrl: string;
    readonly disposition: ImageDisposition;
}

export type GlamSkipReason = "no-name" | "no-collection" | "separator-in-key";

/** One row of the report. Every data row of the file appears exactly once. */
export type GlamRowResult =
    | { readonly status: "created"; readonly index: number; readonly slug: string; readonly optionValue: string; readonly image: RowImage }
    | { readonly status: "option"; readonly index: number; readonly slug: string; readonly optionValue: string; readonly image: RowImage }
    | { readonly status: "deduped"; readonly index: number; readonly slug: string; readonly optionValue: string }
    | { readonly status: "skipped"; readonly index: number; readonly reason: GlamSkipReason; readonly column?: "colecție" | "produs" };

/** How an option's label was obtained. */
export type LabelOrigin = "read" | "empty-numbered" | "duplicate-suffixed";

export interface GlamOptionPlan {
    /** The final label (unique in normalised form within the style). */
    readonly value: string;
    readonly imageLink?: string;
    readonly rowIndexes: readonly number[];
    readonly labelOrigin: LabelOrigin;
}

export interface GlamStylePlan {
    /** The style key (three normalised components joined with U+001F). */
    readonly key: string;
    readonly slug: string;
    /** True when the slug carries a `-<n>` suffix because an earlier style had the same slug. */
    readonly slugSuffixed: boolean;
    /**
     * CAT-SLUG-UNIQUE-1: present only when another product of the tenant held the within-file slug (`previousSlug`),
     * so `slug` is `previousSlug` followed by the sheet's slug and/or a number (`avoidTakenSlugs`). `heldBy`: that
     * product's `importSource`, `null` for a product without one.
     */
    readonly crossSheet?: { readonly previousSlug: string; readonly heldBy: string | null };
    /** The rows of the style, in file order (deduped rows included). */
    readonly rows: readonly GlamRow[];
    readonly options: readonly GlamOptionPlan[];
}

export interface GroupResult {
    readonly styles: readonly GlamStylePlan[];
    readonly rows: readonly GlamRowResult[];
}

/** One option while rows are collected: the label as read, its normalised form, the image cell, its usable image, the rows. */
interface OptionDraft {
    readonly labelRead: string;
    readonly labelNorm: string;
    readonly imageCell: string;
    readonly imageLink?: string;
    readonly rows: GlamRow[];
}

interface StyleDraft {
    readonly key: string;
    readonly slugBase: string;
    readonly rows: GlamRow[];
    readonly options: OptionDraft[];
}

function imageOf(row: GlamRow): RowImage {
    if (row.imageUrl === "") return { sourceUrl: "", disposition: "absent" };
    return { sourceUrl: row.imageUrl, disposition: usableImage(row.imageUrl) ? "used" : "invalid" };
}

/**
 * CAT-SLUG-UNIQUE-1 — the product slugs the import may not take: slug → the holder's `importSource` (`null` for a
 * product without one). Only products this import does not replace are in it (`takenSlugsOf`, ./map.ts).
 */
export type TakenSlugs = ReadonlyMap<string, string | null>;

/** CAT-SLUG-UNIQUE-1 — the input of the cross-sheet pass: the taken slugs and the suffix `slugify(norm(sheet))`. */
export interface CrossSheetCheck {
    readonly taken: TakenSlugs;
    readonly sheetSlug: string;
}

/**
 * Group the rows of one file into styles. `producer` is the upload field (already checked by the identifier rule).
 * Pure; the output depends only on the input, its order and `crossSheet`. Without it the slugs are only unique
 * within the file (the output is exactly what it was before CAT-SLUG-UNIQUE-1); with it the output differs only where
 * a within-file slug is in `crossSheet.taken` (that style's `slug` and `crossSheet`, and its rows' `slug`).
 */
export function groupStyles(rows: readonly GlamRow[], producer: string, crossSheet?: CrossSheetCheck): GroupResult {
    const producerKey = norm(producer);
    const styles = new Map<string, StyleDraft>();
    const skipped = new Map<number, GlamRowResult>();

    for (const row of rows) {
        const nameKey = norm(row.name);
        const collectionKey = norm(row.collection);
        if (nameKey === "") { skipped.set(row.index, { status: "skipped", index: row.index, reason: "no-name" }); continue; }
        if (collectionKey === "") { skipped.set(row.index, { status: "skipped", index: row.index, reason: "no-collection" }); continue; }
        if (collectionKey.includes(KEY_SEPARATOR)) {
            skipped.set(row.index, { status: "skipped", index: row.index, reason: "separator-in-key", column: "colecție" });
            continue;
        }
        if (nameKey.includes(KEY_SEPARATOR)) {
            skipped.set(row.index, { status: "skipped", index: row.index, reason: "separator-in-key", column: "produs" });
            continue;
        }

        const key = [producerKey, collectionKey, nameKey].join(KEY_SEPARATOR);
        let style = styles.get(key);
        if (!style) {
            style = { key, slugBase: slugify([producerKey, collectionKey, nameKey].join(" ")), rows: [], options: [] };
            styles.set(key, style);
        }
        style.rows.push(row);

        const labelNorm = norm(row.format);
        const same = style.options.find((o) => o.labelNorm === labelNorm && o.imageCell === row.imageUrl);
        if (same) same.rows.push(row);
        else style.options.push({ labelRead: row.format, labelNorm, imageCell: row.imageUrl, imageLink: usableImage(row.imageUrl), rows: [row] });
    }

    const inFile = allocateSlugs([...styles.values()].map((s) => s.slugBase));
    const slugs = crossSheet ? avoidTakenSlugs(inFile, crossSheet) : inFile;
    const planned: GlamStylePlan[] = [...styles.values()].map((style, i) => ({
        key: style.key,
        slug: slugs[i].slug,
        slugSuffixed: slugs[i].suffixed,
        ...(slugs[i].crossSheet ? { crossSheet: slugs[i].crossSheet } : {}),
        rows: style.rows,
        options: allocateLabels(style.options),
    }));

    // One result per data row, in file order.
    const byRow = new Map<number, GlamRowResult>(skipped);
    for (const style of planned) {
        style.options.forEach((option, optionIndex) => {
            option.rowIndexes.forEach((index, n) => {
                const row = style.rows.find((r) => r.index === index)!;
                if (n > 0) {
                    byRow.set(index, { status: "deduped", index, slug: style.slug, optionValue: option.value });
                } else {
                    const status = optionIndex === 0 ? "created" : "option";
                    byRow.set(index, { status, index, slug: style.slug, optionValue: option.value, image: imageOf(row) });
                }
            });
        });
    }
    return { styles: planned, rows: rows.map((r) => byRow.get(r.index)!) };
}

/**
 * The collision-aware label rule (spec § 3.4, C10-2). `L` starts with every non-empty label of the style (normalised);
 * options are visited in order; an empty label receives the first `#1`, `#2`… not in `L`; a label equal to an earlier
 * option's final label receives the first `<label> (2)`, `<label> (3)`… not in `L`; each allocated label joins `L`.
 */
function allocateLabels(options: readonly OptionDraft[]): GlamOptionPlan[] {
    const present = new Set(options.filter((o) => o.labelNorm !== "").map((o) => o.labelNorm));
    const earlier = new Set<string>();
    return options.map((option) => {
        let value = option.labelRead;
        let labelOrigin: LabelOrigin = "read";
        if (option.labelNorm === "") {
            value = firstFree((n) => `#${n}`, present, 1);
            labelOrigin = "empty-numbered";
        } else if (earlier.has(option.labelNorm)) {
            value = firstFree((n) => `${option.labelRead} (${n})`, present, 2);
            labelOrigin = "duplicate-suffixed";
        }
        present.add(norm(value));
        earlier.add(norm(value));
        return {
            value,
            ...(option.imageLink !== undefined ? { imageLink: option.imageLink } : {}),
            rowIndexes: option.rows.map((r) => r.index),
            labelOrigin,
        };
    });
}

function firstFree(candidate: (n: number) => string, taken: ReadonlySet<string>, start: number): string {
    for (let n = start; ; n++) {
        const value = candidate(n);
        if (!taken.has(norm(value))) return value;
    }
}

/**
 * Slugs in file order: the first style with a slug keeps it; a later style with the same slug gets the first
 * `<slug>-2`, `<slug>-3`… not already used by any style of the file.
 */
function allocateSlugs(bases: readonly string[]): AllocatedSlug[] {
    const taken = new Set(bases);
    const used = new Set<string>();
    return bases.map((base) => {
        if (!used.has(base)) { used.add(base); return { slug: base, suffixed: false }; }
        let n = 2;
        while (taken.has(`${base}-${n}`)) n++;
        const slug = `${base}-${n}`;
        taken.add(slug);
        used.add(slug);
        return { slug, suffixed: true };
    });
}

interface AllocatedSlug {
    readonly slug: string;
    readonly suffixed: boolean;
    readonly crossSheet?: { readonly previousSlug: string; readonly heldBy: string | null };
}

/**
 * CAT-SLUG-UNIQUE-1 — the cross-sheet pass, in file order, over the within-file slugs. A slug not in `taken` is kept.
 * A slug in `taken` gets the candidate `<slug>-<sheetSlug>` (just `<slug>` when the sheet gives an empty slug, which
 * is taken); when the candidate is reserved — taken, or another slug of this file — it becomes the first
 * `<candidate>-2`, `<candidate>-3`… not reserved. So the new slug is always the held slug followed by the sheet's slug
 * and/or a number: `<slug>-<sheetSlug>`, `<slug>-<sheetSlug>-<n>`, or `<slug>-<n>` (empty sheet slug). Each new slug
 * is reserved at once, so the file's slugs stay unique.
 */
function avoidTakenSlugs(inFile: readonly AllocatedSlug[], check: CrossSheetCheck): AllocatedSlug[] {
    const reserved = new Set<string>([...check.taken.keys(), ...inFile.map((s) => s.slug)]);
    return inFile.map((allocated) => {
        if (!check.taken.has(allocated.slug)) return allocated;
        const heldBy = check.taken.get(allocated.slug) ?? null;
        const base = check.sheetSlug === "" ? allocated.slug : `${allocated.slug}-${check.sheetSlug}`;
        let slug = base;
        for (let n = 2; reserved.has(slug); n++) slug = `${base}-${n}`;
        reserved.add(slug);
        return { ...allocated, slug, crossSheet: { previousSlug: allocated.slug, heldBy } };
    });
}
