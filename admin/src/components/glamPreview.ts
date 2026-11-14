import {
    URL_PREFIX_DEFAULTS, buildFacetListing, catalogListing, catalogListingPath, resolveLocaleStrings, type FacetLabels,
    type FacetListing, type LocaleStringsInput,
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
 *
 * CAT-IMAGE-GATE-1 (docs/slices/cat-image-gate-1.md § 3 item 6): the one deliberate departure from "the renderer's
 * input". An import without `publishWithoutImages` writes every product `draft`, and the image copy — which runs AFTER
 * the import — publishes each one whose image copies. The preview cannot know which image links will work, so it shows
 * the state after a copy in which every link works: a `draft` product with a MAIN-image address (an option `imageLink`,
 * column 9) is shown as published and marked "image to copy" (`draftPublication` = `after-copy`); a `draft` product
 * without one stays hidden and is listed apart (`hidden`) — also when it has extra images (column 13, CAT-IMPORT-GALLERY-1),
 * which never publish a product. `previewCards` and `previewPanel` read the drafts through this rule.
 */

/** A product item of the dry run (`drafts[]` or `siteProducts[]`): raw, as the API sent it. */
export type PreviewItem = Record<string, unknown>;

/** The site facts the dry run does not carry: the tenant's URL prefixes (`GET /settings`) and its categories (`GET /categories`). */
export interface SiteContext {
    prefixes: { shop?: string; category?: string };
    /** id → slug of every existing category (the dry run names a found category by id only). */
    categories: { id: string; slug: string; name: string }[];
    /**
     * LOCALE-1B (docs/slices/locale-1.md § 6.3): the two fixed facet headings the public site shows this tenant's
     * visitors — its catalog texts `facetProducer` / `facetVariantDefault`, resolved from the same `GET /settings` answer
     * with the site's own resolver. The admin controls around the preview stay as they are; only the previewed visitor
     * panel shows visitor texts, exactly as the site will.
     */
    facetLabels: FacetLabels;
}

/**
 * `GET /settings` and `GET /categories` answers → the context. `urlPrefixes || URL_PREFIX_DEFAULTS`, as `SitePage.tsx`;
 * the facet headings as `SitePage.tsx` passes them: `resolveLocaleStrings(settings).strings.catalog`.
 */
export function siteContextOf(settings: { urlPrefixes?: { shop?: string; category?: string } } & LocaleStringsInput, categories: { id?: unknown; slug?: unknown; name?: unknown }[]): SiteContext {
    const catalog = resolveLocaleStrings(settings).strings.catalog;
    return {
        prefixes: settings.urlPrefixes || URL_PREFIX_DEFAULTS,
        facetLabels: { producer: catalog.facetProducer, variantDefault: catalog.facetVariantDefault },
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
    /** CAT-IMAGE-GATE-1: published only once one of its images is copied ("image to copy"). */
    pendingCopy: boolean;
}

/** § 5.1 item 1: the first 24 drafts the site would show, in file order (the plan's order), and the count of all of them. */
export function previewCards(drafts: readonly PreviewItem[]): { count: number; cards: PreviewCard[] } {
    const shown = drafts.filter((d) => draftPublication(d) !== "hidden");
    return {
        count: shown.length,
        cards: shown.slice(0, CARD_LIMIT).map((d) => ({
            slug: String(d.slug ?? ""),
            title: String(d.title ?? ""),
            imageLink: typeof d.imageLink === "string" ? d.imageLink : null,
            pendingCopy: draftPublication(d) === "after-copy",
        })),
    };
}

type VariantOption = { value: string; imageLink?: string };
const optionsOf = (d: PreviewItem): VariantOption[] => {
    const group = Array.isArray(d.variants) ? (d.variants[0] as { options?: unknown } | undefined) : undefined;
    return Array.isArray(group?.options) ? (group.options as VariantOption[]) : [];
};

// ── Publication (CAT-IMAGE-GATE-1 § 3 item 6) ─────────────────────────────────────────────────────────────────────

/**
 * What the site does with one draft (backend `productItem` writes `status` by `importStatus`):
 *   - `published`: `active` — the profile publishes products without images;
 *   - `after-copy`: `draft` with at least one option MAIN-image address (`imageLink`) — published when the copy copies
 *     one of them;
 *   - `hidden`: anything else — `draft` without a main-image address stays hidden after the copy (extra images,
 *     `additionalImageLinks`, never publish).
 */
export type DraftPublication = "published" | "after-copy" | "hidden";

export function draftPublication(d: PreviewItem): DraftPublication {
    if (d.status === "active") return "published";
    if (d.status === "draft" && optionsOf(d).some((o) => typeof o.imageLink === "string")) return "after-copy";
    return "hidden";
}

/** The drafts the site would list after a copy in which every image link works: `after-copy` ones as `active`, `hidden` left out. */
export function publishedDrafts(drafts: readonly PreviewItem[]): PreviewItem[] {
    return drafts.flatMap((d) => {
        const publication = draftPublication(d);
        switch (publication) {
            case "published": return [d];
            case "after-copy": return [{ ...d, status: "active" }];
            case "hidden": return [];
            default: return assertNever(publication);
        }
    });
}

/** The drafts that stay hidden whatever the copy does (no main-image address in the file; extras do not publish). */
export function hiddenDrafts(drafts: readonly PreviewItem[]): PreviewItem[] {
    return drafts.filter((d) => draftPublication(d) === "hidden");
}

/** Shown on the preview when some product starts hidden (the ruled copy of § 3 item 6). */
export const PUBLICATION_NOTICE = "The option “Also publish products without an image” is off: each imported product is hidden until the images are copied, and becomes public when one of its main images is copied to the site. The preview cannot know which image addresses will work: it shows all products that have a main image in the file, marked “image to copy”. A product whose main images cannot be copied stays hidden (extra images do not publish a product).";
export const PENDING_COPY_LABEL = "image to copy";
export const PENDING_COPY_TITLE = "hidden until the images are copied";

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
        case "new": return `${ref.slug} (new)`;
        case "occupied": return `${ref.slug} (address taken)`;
        default: return assertNever(ref);
    }
}

export type PreviewScope = { kind: "shop" } | { kind: "category"; id: string };

export type PreviewPanel =
    | { kind: "panel"; path: string; baseCount: number; listing: FacetListing<PreviewItem> }
    | { kind: "unavailable"; reason: string };

/**
 * One filter panel: the base set of `scope` over `siteProducts ∪ publishedDrafts(drafts)`, then the site's facet function on the
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
    if (context === null) return { kind: "unavailable", reason: "The site's settings or categories could not be read." };
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
                    if (!found) return { kind: "unavailable", reason: `Category ${ref.id} is not in the site's category list.` };
                    slug = found.slug;
                    break;
                }
                case "new":
                    slug = ref.slug;
                    break;
                case "occupied":
                    return { kind: "unavailable", reason: `The category address “${ref.slug}” is taken by another category; the import cannot run.` };
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
    // CAT-IMAGE-GATE-1: the drafts as published after a copy in which every link works (see the header).
    const base = catalogListing([...report.siteProducts, ...publishedDrafts(report.drafts)], categoryId, today);
    return { kind: "panel", path, baseCount: base.length, listing: buildFacetListing(base, f, path, context.facetLabels) };
}

/**
 * The selection a panel link leads to: the `f` of its href (the canonical `formatSelection` form the site's links
 * carry), `""` for a link without one (the bare path: "Clear filters", or the last value removed).
 */
export function selectionOfHref(href: string): string {
    return new URL(href, "https://preview.invalid").searchParams.get("f") ?? "";
}

/** § 5.3 / CIP1-PREVIEW: the stated fidelity limit, shown on the preview (the ruled copy). */
export const FIDELITY_NOTICE = "approximate look — the data and the filters are exact for the site's public address";

/**
 * § 5.3, every stated limit, shown under the notice. Each sentence states only what the mechanism above guarantees:
 * the same functions on the same inputs, for the snapshot of the dry run and the public-domain path.
 */
export const FIDELITY_LIMITS: readonly string[] = [
    "The look is not the site's: the theme, the fonts and the page layout are not applied here. The values, the counts, the order and the visibility of the filters are those the site calculates for the same data, at the public address.",
    "The data is from the time of the check. Products changed since then by other users or by another import, and address prefixes changed after the check, do not show here; the import reads the products, the categories and the saved profile again.",
    "The availability date is compared with the UTC day, as on the site. A period that starts or ends between the check and the visit to the site is not shown here.",
    "The address length limit is exact for the site's public address. On the preview addresses (/_site/<id>/…) the addresses are longer, so a value near the limit can be active here and inactive there.",
    "The images are the producer's addresses: they are copied to the site after the import, and some can show as broken here.",
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
