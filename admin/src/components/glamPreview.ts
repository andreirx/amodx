import {
    URL_PREFIX_DEFAULTS, buildFacetListing, catalogListing, catalogListingPath, type FacetListing,
} from "@amodx/shared";

/**
 * CAT-IMPORT-PROFILE-1C — the import preview, assembled from a glam dry run (design docs/slices/cat-import-profile-1.md
 * § 5, ruling CIP1-PREVIEW = A). PURE: no I/O, no React, no clock (`today` is an input). The components in
 * `GlamProfileEditor.tsx` only lay out what these functions return.
 *
 * Rule (§ 5.2): every input equals the public renderer's input, and the rules are the renderer's own functions from
 * `@amodx/shared` — `catalogListing` (which products a page lists), `catalogListingPath` (the page's public path) and
 * `buildFacetListing` (the filter panel). Nothing here restates a membership, path, facet or URL-budget rule.
 *   - items: the dry run's `siteProducts` (every product of the site except the set this import replaces) and its
 *     `drafts` (the items the execution would write, built by the backend's `productItem`);
 *   - base set: `catalogListing(siteProducts ∪ drafts, scope, today)`; scope = the shop, the producer's category or one
 *     collection category, by the ids the drafts carry (`<found id>`, `new:<slug>`, `occupied:<slug>`);
 *   - path: `catalogListingPath(prefixes, slug)` with `prefixes = urlPrefixes || URL_PREFIX_DEFAULTS` (the renderer's
 *     expression) and `basePath = ""` (the tenant's public domain);
 *   - selection: the raw `f` string. A click follows the href the panel built (`selectionOfHref`), the same link the
 *     site's `<a>` carries.
 */

/** A product item of the dry run (`drafts[]` or `siteProducts[]`): raw, as the API sent it. */
export type PreviewItem = Record<string, unknown>;

/** The site facts the dry run does not carry: the tenant's URL prefixes (`GET /settings`) and its categories (`GET /categories`). */
export interface SiteContext {
    prefixes: { shop?: string; category?: string };
    /** id → slug of every existing category (the dry run names a found category by id only). */
    categories: { id: string; slug: string; name: string }[];
}

/** `GET /settings` and `GET /categories` answers → the context. `urlPrefixes || URL_PREFIX_DEFAULTS`, as `SitePage.tsx`. */
export function siteContextOf(settings: { urlPrefixes?: { shop?: string; category?: string } }, categories: { id?: unknown; slug?: unknown; name?: unknown }[]): SiteContext {
    return {
        prefixes: settings.urlPrefixes || URL_PREFIX_DEFAULTS,
        categories: categories
            .filter((c) => typeof c.id === "string" && typeof c.slug === "string")
            .map((c) => ({ id: c.id as string, slug: c.slug as string, name: typeof c.name === "string" ? c.name : (c.slug as string) })),
    };
}

// ── Cards and the product page (§ 5.1 items 1, 2) ─────────────────────────────────────────────────────────────────

export const CARD_LIMIT = 24;

export interface PreviewCard {
    slug: string;
    title: string;
    imageLink: string | null;
}

/** § 5.1 item 1: the first 24 drafts in file order (the plan's order) and the count of all of them. */
export function previewCards(drafts: readonly PreviewItem[]): { count: number; cards: PreviewCard[] } {
    return {
        count: drafts.length,
        cards: drafts.slice(0, CARD_LIMIT).map((d) => ({
            slug: String(d.slug ?? ""),
            title: String(d.title ?? ""),
            imageLink: typeof d.imageLink === "string" ? d.imageLink : null,
        })),
    };
}

type VariantOption = { value: string; imageLink?: string };
const optionsOf = (d: PreviewItem): VariantOption[] => {
    const group = Array.isArray(d.variants) ? (d.variants[0] as { options?: unknown } | undefined) : undefined;
    return Array.isArray(group?.options) ? (group.options as VariantOption[]) : [];
};

/** § 5.1 item 2 default: the draft with the most options; ties → the first in file order. `null` when there is none. */
export function defaultProductSlug(drafts: readonly PreviewItem[]): string | null {
    let best: PreviewItem | null = null;
    for (const d of drafts) if (best === null || optionsOf(d).length > optionsOf(best).length) best = d;
    return best === null ? null : String(best.slug ?? "");
}

/**
 * The product page's attribute list as the site shows it (`renderer/src/components/SitePage.tsx` `ProductAttributes`,
 * slice 1b): entries with an empty key or value are skipped; a repeated key is ONE row at the place of its first
 * entry, its values in stored order joined by ", ". (A restatement of a renderer display rule — it is not in
 * `packages/shared`; recorded as debt in docs/slices/cat-import-profile-1c.md.)
 */
export function attributeRows(attributes: unknown): { key: string; value: string }[] {
    const rows = new Map<string, string[]>();
    for (const a of Array.isArray(attributes) ? (attributes as { key?: unknown; value?: unknown }[]) : []) {
        if (typeof a.key !== "string" || typeof a.value !== "string" || !a.key || !a.value) continue;
        const values = rows.get(a.key);
        if (values) values.push(a.value);
        else rows.set(a.key, [a.value]);
    }
    return [...rows].map(([key, values]) => ({ key, value: values.join(", ") }));
}

export interface PreviewProductPage {
    title: string;
    brand: string;
    /** `imageLink` then `additionalImageLinks`: the options' distinct images in option order (the importer's rule). */
    gallery: string[];
    variantName: string;
    options: VariantOption[];
    attributes: { key: string; value: string }[];
    /** The prose exactly as the import writes it (`longDescription`, ruling CIP1-PROSE = A); `null` when absent. */
    longDescription: string | null;
}

export function previewProductPage(draft: PreviewItem): PreviewProductPage {
    const group = Array.isArray(draft.variants) ? (draft.variants[0] as { name?: unknown } | undefined) : undefined;
    return {
        title: String(draft.title ?? ""),
        brand: String(draft.brand ?? ""),
        gallery: [
            ...(typeof draft.imageLink === "string" ? [draft.imageLink] : []),
            ...(Array.isArray(draft.additionalImageLinks) ? draft.additionalImageLinks.filter((u): u is string => typeof u === "string") : []),
        ],
        variantName: typeof group?.name === "string" ? group.name : "",
        options: optionsOf(draft),
        attributes: attributeRows(draft.attributes),
        longDescription: typeof draft.longDescription === "string" ? draft.longDescription : null,
    };
}

// ── The three base sets and their filter panels (§ 5.1 item 3, § 5.2) ────────────────────────────────────────────

/** A category id as a draft carries it (backend `previewDrafts`): found on the site, to be created, or blocked. */
export type DraftCategoryRef =
    | { kind: "found"; id: string }
    | { kind: "new"; slug: string }
    | { kind: "occupied"; slug: string };

export function draftCategoryRef(id: string): DraftCategoryRef {
    if (id.startsWith("new:")) return { kind: "new", slug: id.slice("new:".length) };
    if (id.startsWith("occupied:")) return { kind: "occupied", slug: id.slice("occupied:".length) };
    return { kind: "found", id };
}

const categoryIdsOf = (d: PreviewItem): string[] =>
    Array.isArray(d.categoryIds) ? d.categoryIds.filter((c): c is string => typeof c === "string") : [];

/**
 * The producer's parent category: the FIRST id of every draft (the importer writes `[producer, collection]` or
 * `[producer]`, backend `map.ts` `planGlamImport`). `null` when the plan has no product.
 */
export function producerCategoryId(drafts: readonly PreviewItem[]): string | null {
    return drafts.length > 0 ? categoryIdsOf(drafts[0])[0] ?? null : null;
}

/** The collection categories: every other id the drafts carry, distinct, in file order. */
export function collectionCategoryIds(drafts: readonly PreviewItem[]): string[] {
    const producer = producerCategoryId(drafts);
    const out: string[] = [];
    for (const d of drafts) for (const id of categoryIdsOf(d)) if (id !== producer && !out.includes(id)) out.push(id);
    return out;
}

/** What a panel shows a category as: its stored name when it exists, else its slug (a new category has no name yet). */
export function categoryLabel(id: string, context: SiteContext | null): string {
    const ref = draftCategoryRef(id);
    switch (ref.kind) {
        case "found": return context?.categories.find((c) => c.id === ref.id)?.name ?? ref.id;
        case "new": return `${ref.slug} (nouă)`;
        case "occupied": return `${ref.slug} (adresă ocupată)`;
        default: return assertNever(ref);
    }
}

export type PreviewScope = { kind: "shop" } | { kind: "category"; id: string };

export type PreviewPanel =
    | { kind: "panel"; path: string; baseCount: number; listing: FacetListing<PreviewItem> }
    | { kind: "unavailable"; reason: string };

/**
 * One filter panel: the base set of `scope` over `siteProducts ∪ drafts`, then the site's facet function on the
 * page's public path. A panel cannot be built (and says why) when the site context could not be read, when a found
 * category is not in the category list, or when the category address is occupied (the import is refused then).
 */
export function previewPanel(
    report: { drafts: readonly PreviewItem[]; siteProducts: readonly PreviewItem[] },
    context: SiteContext | null,
    scope: PreviewScope,
    f: string,
    today: string,
): PreviewPanel {
    if (context === null) return { kind: "unavailable", reason: "Setările sau categoriile site-ului nu au putut fi citite." };
    let categoryId: string | undefined;
    let slug: string | undefined;
    switch (scope.kind) {
        case "shop":
            break;
        case "category": {
            const ref = draftCategoryRef(scope.id);
            switch (ref.kind) {
                case "found": {
                    const found = context.categories.find((c) => c.id === ref.id);
                    if (!found) return { kind: "unavailable", reason: `Categoria ${ref.id} nu este în lista de categorii a site-ului.` };
                    slug = found.slug;
                    break;
                }
                case "new":
                    slug = ref.slug;
                    break;
                case "occupied":
                    return { kind: "unavailable", reason: `Adresa categoriei „${ref.slug}” este ocupată de altă categorie; importul nu poate rula.` };
                default:
                    return assertNever(ref);
            }
            categoryId = scope.id;
            break;
        }
        default:
            return assertNever(scope);
    }
    const path = catalogListingPath(context.prefixes, slug);
    const base = catalogListing([...report.siteProducts, ...report.drafts], categoryId, today);
    return { kind: "panel", path, baseCount: base.length, listing: buildFacetListing(base, f, path) };
}

/**
 * The selection a panel link leads to: the `f` of its href (the canonical `formatSelection` form the site's links
 * carry), `""` for a link without one (the bare path: "Șterge filtrele", or the last value removed).
 */
export function selectionOfHref(href: string): string {
    return new URL(href, "https://preview.invalid").searchParams.get("f") ?? "";
}

/** § 5.3 / CIP1-PREVIEW: the stated fidelity limit, shown on the preview (the ruled copy). */
export const FIDELITY_NOTICE = "aspect aproximativ — datele și filtrele sunt exacte pentru adresa publică a site-ului";

/**
 * § 5.3, every stated limit, shown under the notice. Each sentence states only what the mechanism above guarantees:
 * the same functions on the same inputs, for the snapshot of the dry run and the public-domain path.
 */
export const FIDELITY_LIMITS: readonly string[] = [
    "Aspectul nu este al site-ului: tema, fonturile și așezarea paginilor nu sunt aplicate aici. Valorile, numerele, ordinea și vizibilitatea filtrelor sunt cele pe care site-ul le calculează pentru aceleași date, pe adresa publică.",
    "Datele sunt cele de la momentul verificării. Produsele schimbate între timp de alți utilizatori sau de alt import și prefixele de adresă schimbate după verificare nu apar aici; importul citește din nou produsele, categoriile și profilul salvat.",
    "Data de disponibilitate se compară cu ziua UTC, ca pe site. O perioadă care începe sau se termină între verificare și vizita pe site nu este reflectată aici.",
    "Limita de lungime a adresei este exactă pentru adresa publică a site-ului. Pe adresele de previzualizare (/_site/<id>/…) adresele sunt mai lungi, așa că o valoare aproape de limită poate fi activă aici și inactivă acolo.",
    "Imaginile sunt adresele producătorului: copierea lor pe site vine după import, iar unele pot apărea aici rupte.",
];

/**
 * The preview's own choices (which product page, which collection panel), checked against the report they are shown
 * with: a wanted value the report no longer holds — e.g. `new:<slug>` after another import created that category, so
 * the next dry run names it by its stored id — falls back to the report's default. So no panel or page is built from a
 * reference of an older report.
 */
export function effectivePreviewChoice(
    drafts: readonly PreviewItem[],
    wanted: { productSlug: string | null; collectionId: string | null },
): { productSlug: string | null; collectionId: string | null } {
    const collections = collectionCategoryIds(drafts);
    return {
        productSlug: wanted.productSlug !== null && drafts.some((d) => d.slug === wanted.productSlug) ? wanted.productSlug : defaultProductSlug(drafts),
        collectionId: wanted.collectionId !== null && collections.includes(wanted.collectionId) ? wanted.collectionId : collections[0] ?? null,
    };
}

/**
 * The prose as text paragraphs. The importer writes `longDescription` as `<p>…</p>` per non-empty line, each line
 * HTML-escaped (`&`, `<`, `>`, `"`, `'` → `&amp;` `&lt;` `&gt;` `&quot;` `&#39;`; backend `glam/map.ts`
 * `htmlParagraphs` / `escapeHtml`). For exactly that form this returns each line's original text (a line that held
 * `<b>` gives the text `<b>`). Any other form is returned whole, undecoded, as one paragraph. The component renders the
 * result as React text — never as HTML.
 */
export function proseParagraphs(longDescription: string): string[] {
    if (!/^(?:<p>[^<]*<\/p>)+$/.test(longDescription)) return [longDescription];
    return [...longDescription.matchAll(/<p>([^<]*)<\/p>/g)].map((m) =>
        m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
}

function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
