import type { GlamRow } from "./parse.js";
import {
    groupStyles, norm, slugify, KEY_SEPARATOR,
    type GlamOptionPlan, type GlamRowResult, type GlamStylePlan,
} from "./group.js";

/**
 * CAT-IMPORT-1 — the upload fields, and each style → one `GlamStyleDraft` (the storefront product as a raw DTO, never a
 * DynamoDB item). Pure. Spec: docs/slices/catalog-mode-1.md § 3.4 "Upload fields", "Variants", "Report shape",
 * "NO-CODES / NO-PRICES as a type guarantee".
 */

/** The upload fields after the identifier rule. `producer` / `sheet` are trimmed with whitespace collapsed (display form). */
export interface GlamUpload {
    readonly producer: string;
    readonly sheet: string;
    readonly variantName: string;
    /** `"glam:" + norm(producer) + "/" + norm(sheet)` — the file's product set is the products carrying it. */
    readonly importSource: string;
}

export type GlamUploadCheck =
    | { readonly kind: "accepted"; readonly upload: GlamUpload }
    | { readonly kind: "refused"; readonly error: string };

export const DEFAULT_VARIANT_NAME = "Variantă";

/**
 * The identifier rule (spec § 3.4, C8-2): a separator of an identifier may not occur inside any of its components —
 * so producer and sheet may contain neither `/` (the `importSource` separator) nor U+001F (the key separator).
 * Both are required. The producer must also give a non-empty slug (cat-import-1 § 9, B-4 ratified): it is the
 * parent category's slug and the first word of every product slug. Refused → the caller answers 400 before any mutation.
 */
export function checkUpload(fields: { producer?: unknown; sheet?: unknown; variantName?: unknown }): GlamUploadCheck {
    const producer = displayForm(fields.producer);
    const sheet = displayForm(fields.sheet);
    if (producer === "") return refused("The producer name is required.");
    if (sheet === "") return refused("The sheet name is required.");
    for (const [label, value] of [["producer", producer], ["sheet", sheet]] as const) {
        if (value.includes("/")) return refused(`The ${label} name may not contain "/".`);
        if (value.includes(KEY_SEPARATOR)) return refused(`The ${label} name may not contain the character U+001F.`);
    }
    if (slugify(norm(producer)) === "") {
        return refused("The producer name must give a non-empty slug: after accents are removed it needs at least one letter a–z or digit 0–9.");
    }
    const variantName = displayForm(fields.variantName) || DEFAULT_VARIANT_NAME;
    return {
        kind: "accepted",
        upload: { producer, sheet, variantName, importSource: `glam:${norm(producer)}/${norm(sheet)}` },
    };
}

function displayForm(value: unknown): string {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function refused(error: string): GlamUploadCheck {
    return { kind: "refused", error };
}

/** A variant option as stored: only a label and an optional image — never `priceOverride` or `availability`. */
export interface GlamOptionDraft {
    readonly value: string;
    readonly imageLink?: string;
}

/** The one variant group of an imported product, without its id (the id is generated where the item is written). */
export interface GlamVariantGroupDraft {
    readonly name: string;
    readonly options: readonly GlamOptionDraft[];
}

/**
 * One storefront product (a style). Its members are exactly the spec's list; it has NO `price`, `salePrice`,
 * `volumePricing`, `sku`, `producerCode` or `personalizations` member — the source row has no field to fill them
 * from (`GlamRow`), and the unit test asserts the exact key set.
 */
export interface GlamStyleDraft {
    readonly title: string;
    readonly description: string;
    readonly longDescription?: string;
    readonly attributes: readonly { readonly key: string; readonly value: string }[];
    readonly imageLink?: string;
    readonly additionalImageLinks: readonly string[];
    readonly variants: readonly [GlamVariantGroupDraft];
    readonly brand: string;
    /**
     * The category slugs of the product: the producer's parent category, then the collection's child category — or
     * only the parent when the collection gives no slug of its own (a collection made only of punctuation).
     */
    readonly categoryKeys: readonly string[];
    readonly slug: string;
    readonly importSource: string;
    readonly rowIndexes: readonly number[];
}

/** A category the import needs: created when absent, matched by slug when present, never deleted. */
export interface GlamCategoryDraft {
    readonly slug: string;
    readonly name: string;
    readonly parentSlug: string | null;
}

export interface GlamStyleOutcome {
    readonly draft: GlamStyleDraft;
    readonly options: readonly GlamOptionPlan[];
    /** Fields among idx 6–8 and 10 whose value differs between rows of the style (reported, nothing else done). */
    readonly differing: readonly string[];
}

export interface GlamImportPlan {
    readonly upload: GlamUpload;
    readonly totalRows: number;
    readonly categories: readonly GlamCategoryDraft[];
    readonly styles: readonly GlamStyleOutcome[];
    readonly rows: readonly GlamRowResult[];
    readonly relabelled: readonly { readonly slug: string; readonly value: string }[];
    readonly suffixedSlugs: readonly { readonly slug: string; readonly rowIndex: number }[];
    readonly counts: {
        readonly products: number;
        readonly options: number;
        readonly deduped: number;
        readonly skipped: number;
    };
}

/** The attribute names (spec § 3.4 column table), in the order they are written. */
const ATTRIBUTE = {
    collection: "colecție",
    unit: "unitate",
    packaging: "împachetare",
    minimumOrder: "comandă minimă",
} as const;
const SPECS_FIELD = "specificații tehnice";

/** The plain description: the specs text with whitespace collapsed, at most this many characters. */
const DESCRIPTION_LIMIT = 300;

/** Plan the import of one parsed file. Pure. */
export function planGlamImport(rows: readonly GlamRow[], upload: GlamUpload): GlamImportPlan {
    const grouped = groupStyles(rows, upload.producer);
    const producerSlug = slugify(norm(upload.producer));

    const categories = new Map<string, GlamCategoryDraft>();
    const styles = grouped.styles.map((style) => {
        const first = style.rows[0];
        const childSlug = slugify(`${norm(upload.producer)} ${norm(first.collection)}`);
        if (!categories.has(producerSlug)) categories.set(producerSlug, { slug: producerSlug, name: upload.producer, parentSlug: null });
        if (childSlug === producerSlug) return mapStyle(style, upload, [producerSlug]);
        if (!categories.has(childSlug)) categories.set(childSlug, { slug: childSlug, name: first.collection, parentSlug: producerSlug });
        return mapStyle(style, upload, [producerSlug, childSlug]);
    });

    const relabelled: { slug: string; value: string }[] = [];
    for (const style of grouped.styles) {
        for (const option of style.options) {
            if (option.labelOrigin !== "read") relabelled.push({ slug: style.slug, value: option.value });
        }
    }

    return {
        upload,
        totalRows: rows.length,
        categories: [...categories.values()],
        styles,
        rows: grouped.rows,
        relabelled,
        suffixedSlugs: grouped.styles
            .filter((s) => s.slugSuffixed)
            .map((s) => ({ slug: s.slug, rowIndex: s.rows[0].index })),
        counts: {
            products: grouped.styles.length,
            options: grouped.styles.reduce((n, s) => n + s.options.length, 0),
            deduped: grouped.rows.filter((r) => r.status === "deduped").length,
            skipped: grouped.rows.filter((r) => r.status === "skipped").length,
        },
    };
}

function mapStyle(style: GlamStylePlan, upload: GlamUpload, categoryKeys: string[]): GlamStyleOutcome {
    const first = style.rows[0];
    const specsRow = style.rows.find((r) => r.specs !== "");

    const attributes: { key: string; value: string }[] = [];
    const attribute = (key: string, value: string) => { if (value !== "") attributes.push({ key, value }); };
    attribute(ATTRIBUTE.collection, first.collection);
    attribute(ATTRIBUTE.unit, first.unit);
    attribute(ATTRIBUTE.packaging, first.packaging);
    attribute(ATTRIBUTE.minimumOrder, first.minimumOrder);

    // The § 3.4 derivation: the first option image, then the other distinct option images in option order.
    const images: string[] = [];
    for (const option of style.options) {
        if (option.imageLink !== undefined && !images.includes(option.imageLink)) images.push(option.imageLink);
    }

    // One rule for idx 6–8 and 10: a field differs when any row's value (empty included) is not the first row's value.
    // The specs compared are the cleaned specs (code lines removed by the parser).
    const differing: string[] = [];
    if (style.rows.some((r) => r.unit !== first.unit)) differing.push(ATTRIBUTE.unit);
    if (style.rows.some((r) => r.packaging !== first.packaging)) differing.push(ATTRIBUTE.packaging);
    if (style.rows.some((r) => r.minimumOrder !== first.minimumOrder)) differing.push(ATTRIBUTE.minimumOrder);
    if (style.rows.some((r) => r.specs !== first.specs)) differing.push(SPECS_FIELD);

    const draft: GlamStyleDraft = {
        title: first.name,
        description: specsRow ? plainDescription(specsRow.specs) : "",
        ...(specsRow ? { longDescription: htmlParagraphs(specsRow.specs) } : {}),
        attributes,
        ...(images.length > 0 ? { imageLink: images[0] } : {}),
        additionalImageLinks: images.slice(1),
        variants: [{
            name: upload.variantName,
            options: style.options.map((o) => (o.imageLink !== undefined ? { value: o.value, imageLink: o.imageLink } : { value: o.value })),
        }],
        brand: upload.producer,
        categoryKeys,
        slug: style.slug,
        importSource: upload.importSource,
        rowIndexes: style.rows.map((r) => r.index),
    };
    return { draft, options: style.options, differing };
}

/** Whitespace collapsed; cut at the last word boundary within the limit, with "…" when cut. */
function plainDescription(specs: string): string {
    const text = specs.replace(/\s+/g, " ").trim();
    if (text.length <= DESCRIPTION_LIMIT) return text;
    const cut = text.slice(0, DESCRIPTION_LIMIT - 1);
    const space = cut.lastIndexOf(" ");
    return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** One `<p>` per non-empty line, HTML-escaped. */
function htmlParagraphs(specs: string): string {
    return specs
        .split(/\r\n|\r|\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("");
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
