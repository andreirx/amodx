// Type-only: erased at compile time, so this pure core loads no module that holds the DynamoDB or S3 client.
import type { CopyResult, ImageFailure } from "../../lib/image-upload.js";

/**
 * CAT-IMAGES-1 — the image ingest core: which producer image URLs (sources) an imported product set still holds, the
 * decision per source, and the per-product rewrite. No I/O: copying goes through the `copy` port, the `MEDIAMAP#`
 * entries arrive as a map, and the derivation rule arrives as `derive` (production: `deriveGallery` of @amodx/shared —
 * the one implementation, CAT-IMPORT-GALLERY-1).
 * Spec: docs/slices/catalog-mode-1.md § 4 CM-D2, CM-D7, § 3.4 "Derived"; slice docs/slices/cat-images-1.md § 2
 * items 4–7 and § 7 (CIM-A1-1, CIM-A1-3). CAT-IMAGE-GATE-1 (end of file): which write publishes a hidden product, and
 * which products stay hidden for lack of an image.
 *
 * CAT-IMPORT-GALLERY-1 (docs/slices/cat-import-gallery-1.md § 3 item 3): an option's `additionalImageLinks` (its
 * "extras") are sources too, each held as `{ …, extra: true }`; a copied extra becomes its CDN URL, a refused or failed
 * one is removed from the option. The option's `imageLink` is its MAIN image. Publication is unchanged: only a copied
 * main image publishes a product (`holdsCopiedImage`); an extra never does.
 */

/** A variant option as stored on an imported product. Other keys, if any, are kept by the rewrite. */
export interface IngestOption {
    readonly value: string;
    readonly imageLink?: string;
    /** CAT-IMPORT-GALLERY-1: the option's extras; absent when it has none (never stored empty). */
    readonly additionalImageLinks?: readonly string[];
    readonly [key: string]: unknown;
}

/** One product of the set (`importSource` matched), reduced to what the ingest reads. */
export interface IngestProduct {
    readonly id: string;
    readonly slug: string;
    /** The options of the product's one variant group (§ 3.4: an imported product has exactly one). */
    readonly options: readonly IngestOption[];
}

/** One holding of a source: an option's main image (`extra` absent) or one of its extras (`extra: true`). */
export interface SourceHolder {
    readonly productId: string;
    readonly slug: string;
    readonly option: string;
    readonly extra?: true;
}

/** One distinct producer URL and every option that holds it. */
export interface ImageSource {
    readonly url: string;
    readonly holders: readonly SourceHolder[];
}

/** The decision for one source (slice § 2.7, CIM-A1-3). */
export type SourceResult =
    | { readonly kind: "ingested"; readonly url: string; readonly cdnUrl: string }
    /** Copied before (a `MEDIAMAP#` entry): no fetch. */
    | { readonly kind: "cached"; readonly url: string; readonly cdnUrl: string }
    | { readonly kind: "refused"; readonly url: string; readonly rule: string }
    | { readonly kind: "failed"; readonly url: string; readonly failure: ImageFailure };

/** An option image is a producer URL unless it is already under the tenant media CDN (`<cdnUrl>/…`). */
export function isProducerUrl(imageLink: string, cdnUrl: string): boolean {
    return !imageLink.startsWith(`${cdnUrl}/`);
}

/**
 * The distinct producer URLs of the set, in product order, then option order, then (per option) the main image before
 * the extras in their order, each with its holders.
 */
export function collectSources(products: readonly IngestProduct[], cdnUrl: string): ImageSource[] {
    const byUrl = new Map<string, SourceHolder[]>();
    const hold = (url: string, holder: SourceHolder) => {
        if (!isProducerUrl(url, cdnUrl)) return;
        const holders = byUrl.get(url) ?? [];
        holders.push(holder);
        byUrl.set(url, holders);
    };
    for (const product of products) {
        for (const option of product.options) {
            const holder = { productId: product.id, slug: product.slug, option: option.value };
            if (option.imageLink !== undefined) hold(option.imageLink, holder);
            for (const url of option.additionalImageLinks ?? []) hold(url, { ...holder, extra: true });
        }
    }
    return [...byUrl].map(([url, holders]) => ({ url, holders }));
}

/** The decision for one source: a `MEDIAMAP#` hit is `cached` (no copy); otherwise the copy's outcome. */
export function decideSource(url: string, cachedCdnUrl: string | undefined, copy?: CopyResult): SourceResult {
    if (cachedCdnUrl !== undefined) return { kind: "cached", url, cdnUrl: cachedCdnUrl };
    if (copy === undefined) throw new Error(`Internal: source ${url} has neither a MEDIAMAP# entry nor a copy result`);
    switch (copy.kind) {
        case "copied":
            return { kind: "ingested", url, cdnUrl: copy.cdnUrl };
        case "refused":
            return { kind: "refused", url, rule: copy.rule };
        case "failed":
            return { kind: "failed", url, failure: copy.failure };
    }
}

/**
 * Resolve the sources of one request. Every `MEDIAMAP#` hit is resolved at once (`cached`). The other sources are
 * copied by `concurrency` workers in source order; a worker starts a new copy only while `mayStartCopy()` is true
 * (the request's time budget). Sources not started stay unresolved (absent from the result) for the next request.
 */
export async function resolveSources(
    sources: readonly ImageSource[],
    mediaMap: ReadonlyMap<string, string>,
    copy: (url: string) => Promise<CopyResult>,
    mayStartCopy: () => boolean,
    concurrency: number,
): Promise<Map<string, SourceResult>> {
    const results = new Map<string, SourceResult>();
    const toCopy: string[] = [];
    for (const { url } of sources) {
        const cached = mediaMap.get(url);
        if (cached !== undefined) results.set(url, decideSource(url, cached));
        else toCopy.push(url);
    }
    let next = 0;
    const worker = async () => {
        while (next < toCopy.length && mayStartCopy()) {
            const url = toCopy[next++];
            results.set(url, decideSource(url, undefined, await copy(url)));
        }
    };
    // allSettled: a copy that throws (S3 / DynamoDB, not a source outcome) stops only its worker; the request answers
    // after every worker has stopped (each stops at the budget), then the first such error is raised.
    const settled = await Promise.allSettled(Array.from({ length: Math.max(1, concurrency) }, worker));
    const thrown = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    if (thrown) throw thrown.reason;
    return results;
}

/**
 * The derivation rule (`deriveGallery` of @amodx/shared): each option's `imageLink` then its `additionalImageLinks`,
 * in option order, each once; the first is `imageLink` (absent when none), the rest `additionalImageLinks`.
 */
export type DeriveGallery = (options: IngestOption[]) => { imageLink?: string; additionalImageLinks: string[] };

/** What one product's write must store, or that it needs none. */
export type ProductRewrite =
    | { readonly kind: "unchanged" }
    | {
        readonly kind: "rewritten";
        readonly options: readonly IngestOption[];
        /** Absent = the product has no image: the stored key is REMOVED (CM-D7), never written as "" or null. */
        readonly imageLink?: string;
        readonly additionalImageLinks: readonly string[];
    };

/**
 * The per-product rewrite (slice § 2.4–2.5, C8-4): a resolved source that succeeded (`ingested`/`cached`) becomes its
 * CDN URL; one that did not (`refused`/`failed`) is removed from the option (the option keeps its label). Then
 * `imageLink` / `additionalImageLinks` are derived again by the one rule (`derive`).
 * CAT-IMPORT-GALLERY-1: the same for each extra (`rewriteExtras`): copied → its CDN URL, refused/failed → removed (the
 * key is removed when no extra is left), with the same `read` rebase as the main image (see there).
 *
 * `read` (CAT-IMAGE-GATE-1 CIG-R1): the options of the read the source results belong to, when `product` is a LATER
 * read of the same product (the rebase after a cancelled write). An option's source is its own image when it has one,
 * else the image it had in `read` (matched by option value — unique within an imported product). So a success is
 * applied even when another request has meanwhile removed that image after a failure, and a failure never removes
 * what another request has meanwhile stored (a CDN URL is not a source: it has no result). Default: `product.options`
 * — the rule of CAT-IMAGES-1, unchanged. `stored` (CAT-IMPORT-GALLERY-1): source → its `MEDIAMAP#` CDN URL read after
 * `product`, used only to match an extra already copied by another request to its holding (`rewriteExtras`); empty by
 * default (then `product` IS the read and needs no matching).
 */
export function rewriteProduct(
    product: IngestProduct,
    results: ReadonlyMap<string, SourceResult>,
    derive: DeriveGallery,
    read: readonly IngestOption[] = product.options,
    stored: ReadonlyMap<string, string> = new Map(),
): ProductRewrite {
    let changed = false;
    const options = product.options.map((option): IngestOption => {
        let next = option;
        const source = option.imageLink ?? read.find((r) => r.value === option.value)?.imageLink;
        const result = source === undefined ? undefined : results.get(source);
        if (result !== undefined) {
            switch (result.kind) {
                case "ingested":
                case "cached":
                    changed = true;
                    next = { ...option, imageLink: result.cdnUrl };
                    break;
                case "refused":
                case "failed": {
                    if (option.imageLink === undefined) break; // nothing to remove
                    changed = true;
                    const { imageLink: _removed, ...rest } = option;
                    next = rest as IngestOption;
                    break;
                }
                default: {
                    const unhandled: never = result;
                    throw new Error(`Unhandled source result ${JSON.stringify(unhandled)}`);
                }
            }
        }
        const extras = rewriteExtras(option.additionalImageLinks, read.find((r) => r.value === option.value)?.additionalImageLinks, results, next.imageLink, stored);
        if (extras === undefined) return next;
        changed = true;
        if (extras.length > 0) return { ...next, additionalImageLinks: extras };
        const { additionalImageLinks: _none, ...rest } = next;
        return rest as IngestOption;
    });
    if (!changed) return { kind: "unchanged" };
    const derived = derive(options);
    return {
        kind: "rewritten",
        options,
        ...(derived.imageLink !== undefined ? { imageLink: derived.imageLink } : {}),
        additionalImageLinks: derived.additionalImageLinks,
    };
}

/**
 * CAT-IMPORT-GALLERY-1 (R-CIG-REBASE, round 3: merge by the ORIGINAL holding) — an option's extras after the results.
 * `read` = its extras in the read the results belong to: ONE holding per address, and the read's order is the order;
 * `current` = its extras now (the same list when `current` IS that read). Every copy write keeps the order of the list
 * it rewrites (an address is replaced in place by its CDN URL, or removed), so `current` is `read` with some holdings
 * copied and some removed. Each current address is matched to its holding, keeping the order: by identity — the source
 * itself, this request's copy of it, or `stored` (the source's `MEDIAMAP#` entry, read after `current`); an address
 * without identity takes the next free holding in order whose source HAS a `MEDIAMAP#` entry, else it is kept after the
 * holdings. Then, per holding in read order:
 *   - current holds the source itself → this request's result: copied → its CDN URL; refused/failed → removed; none → kept;
 *   - current holds another image for it (a copy stored by any request) → KEPT, and this request's copy of that
 *     holding is not added; a failure never removes a stored copy;
 *   - current holds nothing for it (another request removed it after a failure) → this request's copy if it has one.
 * A current address matched to no holding is kept, after them. Each address once, never `imageLink`. `undefined` =
 * unchanged.
 *
 * GUARANTEE SCOPE. When EVERY current address is identified, the result is one stored image per holding, in read order:
 * no second copy of a source (production copies are `randomUUID()`-named, so two copies differ by URL) and no copy
 * lost. When an address has NO identity (its source's `MEDIAMAP#` entry was overwritten by a later copy — two
 * overlapping requests suffice), the fallback can match it to the WRONG holding, and then: (1) misorder the gallery,
 * (2) SUPPRESS this request's successful copy of that holding, (3) store a second copy of the address's own source. A
 * stored image is never removed. Residual frozen for CAT-IMAGES-OVERLAP-1 (docs/slices/cat-import-gallery-1-impl.md § 6
 * F-CIG-6); characterization rows `RESIDUAL CAT-IMAGES-OVERLAP-1` in glam-images-core / glam-images-handler tests.
 */
function rewriteExtras(
    current: readonly string[] | undefined,
    read: readonly string[] | undefined,
    results: ReadonlyMap<string, SourceResult>,
    imageLink: string | undefined,
    stored: ReadonlyMap<string, string>,
): string[] | undefined {
    const now = current ?? [];
    const holdings = read ?? [];
    const copyOf = (url: string): string | undefined => {
        const result = results.get(url);
        if (result === undefined) return undefined;
        switch (result.kind) {
            case "ingested":
            case "cached":
                return result.cdnUrl;
            case "refused":
            case "failed":
                return undefined;
            default: {
                const unhandled: never = result;
                throw new Error(`Unhandled source result ${JSON.stringify(unhandled)}`);
            }
        }
    };
    const isFor = (address: string, source: string) => address === source || address === copyOf(source) || address === stored.get(source);

    // Match the current addresses to holdings, order kept: anchors by identity, the others to the next free holding.
    const at: (string | undefined)[] = holdings.map(() => undefined);
    const unmatched: string[] = [];
    const place = (addresses: readonly string[], from: number, to: number) => {
        let k = from;
        for (const address of addresses) {
            while (k < to && (at[k] !== undefined || !stored.has(holdings[k]))) k++;
            if (k < to) at[k++] = address;
            else unmatched.push(address);
        }
    };
    let next = 0;
    let pending: string[] = [];
    for (const address of now) {
        let i = -1;
        for (let j = next; j < holdings.length; j++) if (isFor(address, holdings[j])) { i = j; break; }
        if (i < 0) { pending.push(address); continue; }
        place(pending, next, i);
        pending = [];
        at[i] = address;
        next = i + 1;
    }
    place(pending, next, holdings.length);

    const out: string[] = [];
    const keep = (url: string | undefined) => { if (url !== undefined && url !== imageLink && !out.includes(url)) out.push(url); };
    holdings.forEach((source, i) => {
        const held = at[i];
        if (held === undefined) keep(copyOf(source));
        else if (held === source) keep(results.has(source) ? copyOf(source) : source);
        else keep(held);
    });
    for (const address of unmatched) keep(address);
    return out.length === now.length && out.every((url, i) => url === now[i]) ? undefined : out;
}

/**
 * The work the set still holds once the given rewrites are stored. `options` = the (product, option) holdings whose
 * main image is still a producer URL; `extras` = the (product, option, extra) holdings still on a producer URL
 * (CAT-IMPORT-GALLERY-1). `options + extras` is the TERMINATION MEASURE: every stored rewrite turns ≥ 1 holding into
 * a CDN URL or removes it, so a request that stores ≥ 1 rewrite lowers it by ≥ 1. `sources` = the distinct producer
 * URLs among them (informational: a URL shared by two products stays counted until its last holder is rewritten).
 */
export function remainingWork(
    products: readonly IngestProduct[],
    stored: ReadonlyMap<string, readonly IngestOption[]>,
    cdnUrl: string,
): { options: number; extras: number; sources: number } {
    let options = 0;
    let extras = 0;
    const urls = new Set<string>();
    for (const product of products) {
        for (const option of stored.get(product.id) ?? product.options) {
            if (option.imageLink !== undefined && isProducerUrl(option.imageLink, cdnUrl)) {
                options++;
                urls.add(option.imageLink);
            }
            for (const url of option.additionalImageLinks ?? []) {
                if (!isProducerUrl(url, cdnUrl)) continue;
                extras++;
                urls.add(url);
            }
        }
    }
    return { options, extras, sources: urls.size };
}

// ── CAT-IMAGE-GATE-1: publication follows the copy (docs/slices/cat-image-gate-1.md § 1 ruling, § 3 item 3) ──────────

/**
 * A product holds a copied image when one of its option images, or its main image, is under the tenant media CDN.
 * CAT-IMPORT-GALLERY-1: an extra never counts — the product `imageLink` counts only when it is not an option's extra
 * (it is derived, so it is an extra when the first option with an image has only extras).
 */
export function holdsCopiedImage(options: readonly IngestOption[], imageLink: string | undefined, cdnUrl: string): boolean {
    const extras = new Set(options.flatMap((o) => o.additionalImageLinks ?? []));
    const main = imageLink !== undefined && !extras.has(imageLink) ? imageLink : undefined;
    return [...options.map((o) => o.imageLink), main].some((url) => url !== undefined && !isProducerUrl(url, cdnUrl));
}

/** One product as the copy last read it: its options, main image and status. */
export interface ProductState {
    readonly options: readonly IngestOption[];
    readonly imageLink?: string;
    readonly status?: unknown;
}

/** What one product's write must do: its images (or none), and whether it publishes. */
export type ProductWrite =
    | { readonly kind: "none" }
    | { readonly kind: "write"; readonly images: Extract<ProductRewrite, { kind: "rewritten" }> | null; readonly publish: boolean };

/**
 * The one decision of a product's write. Images: `rewriteProduct` over `current`, with `read` the read the results
 * belong to (see there). Publish (`status` → `active`, in the SAME conditional write): exactly when `current` is
 * `draft` and the product holds a copied image after the write — also when the write changes no image (CIG-R2: an
 * image already under the tenant CDN, imported as such or copied earlier, publishes a hidden product; no fetch).
 * Any other status is never changed: an import with `publishWithoutImages: true` writes `active`, so the copy never
 * changes its products' status, and no profile read is needed (the profile is per producer and may since have been
 * changed by another sheet's import).
 */
export function planProductWrite(
    current: ProductState,
    read: readonly IngestOption[],
    results: ReadonlyMap<string, SourceResult>,
    derive: DeriveGallery,
    cdnUrl: string,
    stored: ReadonlyMap<string, string> = new Map(),
): ProductWrite {
    const rewrite = rewriteProduct({ id: "", slug: "", options: current.options }, results, derive, read, stored);
    const images = rewrite.kind === "rewritten" ? rewrite : null;
    const publish = current.status === "draft"
        && (images ? holdsCopiedImage(images.options, images.imageLink, cdnUrl) : holdsCopiedImage(current.options, current.imageLink, cdnUrl));
    return images !== null || publish ? { kind: "write", images, publish } : { kind: "none" };
}

/**
 * Hidden for lack of an image (the report list of § 3 item 4): `draft`, no copied MAIN image, and no main-image
 * producer URL left to try — every main source failed or was refused, or the product never had one. CAT-IMPORT-GALLERY-1:
 * extras are not counted either way (an extras-only product is listed: its extras, copied or not, never publish it). A `draft` product that still holds a
 * producer URL is not decided yet (a later request copies it); a `draft` product WITH a copied image is hidden for
 * another reason (set by hand) and is not listed.
 */
export function hiddenWithoutImage(status: unknown, options: readonly IngestOption[], imageLink: string | undefined, cdnUrl: string): boolean {
    return status === "draft"
        && !holdsCopiedImage(options, imageLink, cdnUrl)
        && !options.some((o) => o.imageLink !== undefined && isProducerUrl(o.imageLink, cdnUrl));
}
