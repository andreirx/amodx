// Type-only: erased at compile time, so this pure core loads no module that holds the DynamoDB or S3 client.
import type { CopyResult, ImageFailure } from "../../lib/image-upload.js";

/**
 * CAT-IMAGES-1 — the image ingest core: which producer image URLs (sources) an imported product set still holds, the
 * decision per source, and the per-product rewrite. No I/O: copying goes through the `copy` port, the `MEDIAMAP#`
 * entries arrive as a map, and the § 3.4 derivation rule arrives as `derive` (production: `withDerivedGallery` of
 * lib/catalog-product.ts — the one implementation; importing it here would load lib/db.ts into this pure core).
 * Spec: docs/slices/catalog-mode-1.md § 4 CM-D2, CM-D7, § 3.4 "Derived"; slice docs/slices/cat-images-1.md § 2
 * items 4–7 and § 7 (CIM-A1-1, CIM-A1-3). CAT-IMAGE-GATE-1 (end of file): which write publishes a hidden product, and
 * which products stay hidden for lack of an image.
 */

/** A variant option as stored on an imported product. Other keys, if any, are kept by the rewrite. */
export interface IngestOption {
    readonly value: string;
    readonly imageLink?: string;
    readonly [key: string]: unknown;
}

/** One product of the set (`importSource` matched), reduced to what the ingest reads. */
export interface IngestProduct {
    readonly id: string;
    readonly slug: string;
    /** The options of the product's one variant group (§ 3.4: an imported product has exactly one). */
    readonly options: readonly IngestOption[];
}

export interface SourceHolder {
    readonly productId: string;
    readonly slug: string;
    readonly option: string;
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

/** The distinct producer URLs of the set, in product order then option order, each with its holders. */
export function collectSources(products: readonly IngestProduct[], cdnUrl: string): ImageSource[] {
    const byUrl = new Map<string, SourceHolder[]>();
    for (const product of products) {
        for (const option of product.options) {
            if (option.imageLink === undefined || !isProducerUrl(option.imageLink, cdnUrl)) continue;
            const holders = byUrl.get(option.imageLink) ?? [];
            holders.push({ productId: product.id, slug: product.slug, option: option.value });
            byUrl.set(option.imageLink, holders);
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

/** The § 3.4 rule: `imageLink` = the first option image (absent when none), `additionalImageLinks` = the other distinct ones. */
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
 * `imageLink` / `additionalImageLinks` are derived again by the one § 3.4 rule (`derive`).
 *
 * `read` (CAT-IMAGE-GATE-1 CIG-R1): the options of the read the source results belong to, when `product` is a LATER
 * read of the same product (the rebase after a cancelled write). An option's source is its own image when it has one,
 * else the image it had in `read` (matched by option value — unique within an imported product). So a success is
 * applied even when another request has meanwhile removed that image after a failure, and a failure never removes
 * what another request has meanwhile stored (a CDN URL is not a source: it has no result). Default: `product.options`
 * — the rule of CAT-IMAGES-1, unchanged.
 */
export function rewriteProduct(
    product: IngestProduct,
    results: ReadonlyMap<string, SourceResult>,
    derive: DeriveGallery,
    read: readonly IngestOption[] = product.options,
): ProductRewrite {
    let changed = false;
    const options = product.options.map((option): IngestOption => {
        const source = option.imageLink ?? read.find((r) => r.value === option.value)?.imageLink;
        const result = source === undefined ? undefined : results.get(source);
        if (result === undefined) return option;
        switch (result.kind) {
            case "ingested":
            case "cached":
                changed = true;
                return { ...option, imageLink: result.cdnUrl };
            case "refused":
            case "failed": {
                if (option.imageLink === undefined) return option; // nothing to remove
                changed = true;
                const { imageLink: _removed, ...rest } = option;
                return rest as IngestOption;
            }
        }
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
 * The work the set still holds once the given rewrites are stored. `options` = the (product, option) holdings that
 * still carry a producer URL — the TERMINATION MEASURE: every stored rewrite turns ≥ 1 holding into a CDN URL or
 * removes it, so a request that stores ≥ 1 rewrite lowers it by ≥ 1. `sources` = the distinct producer URLs among
 * them (informational: a URL shared by two products stays counted until its last holder is rewritten).
 */
export function remainingWork(
    products: readonly IngestProduct[],
    stored: ReadonlyMap<string, readonly IngestOption[]>,
    cdnUrl: string,
): { options: number; sources: number } {
    let options = 0;
    const urls = new Set<string>();
    for (const product of products) {
        for (const option of stored.get(product.id) ?? product.options) {
            if (option.imageLink !== undefined && isProducerUrl(option.imageLink, cdnUrl)) {
                options++;
                urls.add(option.imageLink);
            }
        }
    }
    return { options, sources: urls.size };
}

// ── CAT-IMAGE-GATE-1: publication follows the copy (docs/slices/cat-image-gate-1.md § 1 ruling, § 3 item 3) ──────────

/** A product holds a copied image when one of its option images, or its main image, is under the tenant media CDN. */
export function holdsCopiedImage(options: readonly IngestOption[], imageLink: string | undefined, cdnUrl: string): boolean {
    return [...options.map((o) => o.imageLink), imageLink].some((url) => url !== undefined && !isProducerUrl(url, cdnUrl));
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
): ProductWrite {
    const rewrite = rewriteProduct({ id: "", slug: "", options: current.options }, results, derive, read);
    const images = rewrite.kind === "rewritten" ? rewrite : null;
    const publish = current.status === "draft"
        && (images ? holdsCopiedImage(images.options, images.imageLink, cdnUrl) : holdsCopiedImage(current.options, current.imageLink, cdnUrl));
    return images !== null || publish ? { kind: "write", images, publish } : { kind: "none" };
}

/**
 * Hidden for lack of an image (the report list of § 3 item 4): `draft`, no copied image, and no producer URL left to
 * try — every source failed or was refused, or the product never had one. A `draft` product that still holds a
 * producer URL is not decided yet (a later request copies it); a `draft` product WITH a copied image is hidden for
 * another reason (set by hand) and is not listed.
 */
export function hiddenWithoutImage(status: unknown, options: readonly IngestOption[], imageLink: string | undefined, cdnUrl: string): boolean {
    return status === "draft"
        && !holdsCopiedImage(options, imageLink, cdnUrl)
        && !options.some((o) => o.imageLink !== undefined && isProducerUrl(o.imageLink, cdnUrl));
}
