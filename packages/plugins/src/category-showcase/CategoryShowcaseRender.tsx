"use client";

import React, { useEffect, useState } from "react";
import type { BlockStrings } from "@amodx/shared";

interface Product {
    id: string;
    title: string;
    slug: string;
    price: string;               // absent on a catalog site's products — the card never reads it there (catalogMode)
    salePrice?: string;
    currency: string;
    imageLink?: string;
    availability: string;
    volumePricing?: { minQuantity: number; price: string }[];
    /**
     * PRICE-LOCALE-1 (ruling PL1-SHOWCASE = C, narrowed): the card's price range, computed by the renderer's server pass
     * with the shared parser. Present ONLY for a tenant whose locale writes a decimal comma and a product whose `price` or
     * a tier price contains a comma (`12,50`); absent otherwise, and then the range is read below exactly as before.
     */
    _priceRange?: { min: number; max: number };
    tags?: string[];             // in the CATPROD# card item; read only for a badge (SHOP-LOOK-1D, § 7.4)
    // SHOP-LOOK-1D (§ 6.3 rule 3): each key below is added by the renderer's server pass ONLY when its block option is
    // on and the data exists; absent otherwise (and always absent on a catalog site, and on the browser fallback fetch).
    _categoryName?: string;      // `showCategoryLabel`: the name of the product's first category (SL-D7)
    _descriptionText?: string;   // `showDescription`: the product's short text as plain text (§ 7.2)
    _rating?: { average: number; count: number; text: string };  // `showRating`: approved reviews; `text` = `reviewsSummary`, filled (§ 7.3)
}

/**
 * SHOP-LOOK-1D (docs/slices/shop-look-1.md § 7): the four card options of the block, as the card reads them. On a catalog
 * site every option is off (SL-D10), whatever is stored.
 */
interface CardOptions {
    badgeTags: string[];
    showCategoryLabel: boolean;
    showDescription: boolean;
    showRating: boolean;
}

/** A non-blank string, trimmed; anything else → null (blank = absent, design § 4). */
function textOf(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * The badge of one card (§ 7.4, § 16 R6): AT MOST ONE — the first entry of the block's `badgeTags`, in the block's order,
 * that the product's `tags` holds. Letter case does not count, spaces do (BADGE-CASE-1): the two strings match when they
 * are equal after `toLowerCase()` on both sides, so "top pick" matches "TOP PICK" and "TOP PICK " does not. A product
 * tag that is not a string never matches. The order of the product's own tags never changes the result. The text is the
 * block's entry as stored (uppercase is CSS), so every card of one block shows one spelling. No match, no list, or
 * `tags` not a list → no badge.
 */
function badgeOf(badgeTags: string[], tags: unknown): string | null {
    if (!Array.isArray(tags)) return null;
    const own = tags.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase());
    return badgeTags.find((tag) => own.includes(tag.toLowerCase())) ?? null;
}

/**
 * `catalogMode` (CATALOG-MODE-1, spec § 3.2.6): a catalog site shows no price line, no currency and no stock overlay,
 * whatever the product data holds and wherever it came from (server prefetch, stale authored attrs, or the browser
 * fallback fetch below) — not emitted, not hidden by CSS. It overrides the block's own `showPrice`.
 */
function ProductCard({ product, showPrice, catalogMode, productPrefix, getUrl, strings, options }: { product: Product; showPrice: boolean; catalogMode: boolean; productPrefix: string; getUrl: (s: string) => string; strings: BlockStrings; options: CardOptions }) {
    const outOfStock = !catalogMode && product.availability === "out_of_stock";
    const hasSale = product.salePrice && product.salePrice !== product.price;
    const hasVolume = product.volumePricing && product.volumePricing.length > 0;

    let priceDisplay = `${product.price} ${product.currency}`;
    if (hasSale) {
        priceDisplay = `${product.salePrice} ${product.currency}`;
    }
    if (hasVolume) {
        let min: number;
        let max: number;
        if (product._priceRange) {
            ({ min, max } = product._priceRange);
        } else {
            // Debt (PRICE-LOCALE-1 record § 8 F-PL1-9): parseFloat on a price text, kept for products without a comma
            // text. Kept by `shop-look-1d` too (operator decision 2026-11-16): removing it changes every commerce
            // tenant's page bytes for a gain only on malformed data.
            const prices = product.volumePricing!.map(v => parseFloat(v.price));
            min = Math.min(parseFloat(product.price), ...prices);
            max = Math.max(parseFloat(product.price), ...prices);
        }
        if (min !== max) priceDisplay = `${min} – ${max} ${product.currency}`;
    }

    // SHOP-LOOK-1D: each extra is null unless its option is on AND its data is there; null adds nothing to the HTML.
    const badge = badgeOf(options.badgeTags, product.tags);
    const categoryLabel = options.showCategoryLabel ? textOf(product._categoryName) : null;
    const shortText = options.showDescription ? textOf(product._descriptionText) : null;
    const rating = options.showRating && typeof product._rating?.text === "string" && Number.isFinite(product._rating.average) ? product._rating : null;

    return (
        <a href={getUrl(`${productPrefix}/${product.slug}`)} className="group block">
            <div className="aspect-square bg-muted rounded-lg overflow-hidden relative mb-3">
                {product.imageLink ? (
                    <img
                        src={product.imageLink}
                        alt={product.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">{strings.noImage}</div>
                )}
                {outOfStock && (
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                        <span className="bg-background border border-border px-4 py-2 text-sm font-semibold uppercase tracking-wide">{strings.outOfStock}</span>
                    </div>
                )}
                {/* Readability (§ 7.4): an opaque pill in the theme's button pair — the photo never shows through it. After
                    the out-of-stock overlay, so it is painted above it. */}
                {badge !== null && (
                    <span className="absolute top-2 left-2 max-w-[90%] truncate rounded-full bg-primary px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-foreground">{badge}</span>
                )}
            </div>
            {categoryLabel !== null && <p className="text-xs uppercase tracking-wide text-center text-muted-foreground mb-1">{categoryLabel}</p>}
            <h3 className="text-sm font-medium text-center leading-tight mb-1 group-hover:text-primary transition-colors">{product.title}</h3>
            {shortText !== null && <p className="text-sm text-center text-muted-foreground line-clamp-2 mb-1">{shortText}</p>}
            {/* The stars are decoration (hidden from screen readers); the text says the same, in the tenant's language. */}
            {rating !== null && (
                <p className="text-sm text-center text-muted-foreground mb-1">
                    <span aria-hidden="true" className="text-primary mr-1">{"★".repeat(Math.min(5, Math.max(0, Math.round(rating.average))))}</span>
                    {rating.text}
                </p>
            )}
            {showPrice && !catalogMode && (
                <p className="text-sm text-center text-primary font-medium">
                    {hasSale && <span className="line-through text-muted-foreground mr-2">{product.price} {product.currency}</span>}
                    {priceDisplay}
                </p>
            )}
        </a>
    );
}

/**
 * LOCALE-1C (§ 6.2): the fixed texts come from `strings` (the tenant's locale table; RenderBlocks always
 * gives it) — `noImage`, the commerce texts `outOfStock` (absent on a catalog site, where the overlay never shows) and
 * `showcaseEmpty`. SHOP-LOOK-1D (§ 5): the rating text is the tenant's `reviewsSummary`, filled by the server pass and
 * given only to the products of a block with `showRating` on — not a `strings` key, so no other block's payload changes.
 * Every other new text is owner content (eyebrow, badge tags) or data (category name, product description).
 */
export function CategoryShowcaseRender({ attrs, tenantId, strings }: { attrs: any; tenantId?: string; strings: BlockStrings }) {
    const { categoryId, categoryName, categorySlug, limit, columns, showPrice, ctaText, prefetchedProducts, _getUrl, _productPrefix, _categoryPrefix, _catalogMode } = attrs;
    // Injected by the renderer (`SitePage.tsx`) only for a catalog tenant, on every block of this type; absent otherwise.
    const catalogMode = _catalogMode === true;

    // SHOP-LOOK-1D (§ 4.2, § 7): the block's own options. Each is off unless stored exactly as `true` / a list with a
    // non-blank entry; the card options are off on a catalog site (SL-D10). The eyebrow is a block option: every site.
    const eyebrow = textOf(attrs.eyebrow);
    const options: CardOptions = catalogMode
        ? { badgeTags: [], showCategoryLabel: false, showDescription: false, showRating: false }
        : {
            badgeTags: Array.isArray(attrs.badgeTags) ? attrs.badgeTags.filter((t: unknown): t is string => typeof t === "string" && t.trim() !== "") : [],
            showCategoryLabel: attrs.showCategoryLabel === true,
            showDescription: attrs.showDescription === true,
            showRating: attrs.showRating === true,
        };

    // Client-fetch state — only used when server prefetch is absent (editor preview).
    // When prefetchedProducts exists, these are ignored in favor of the prop directly.
    const [fetchedProducts, setFetchedProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(!prefetchedProducts);

    // Derive render data: prop wins, state is fallback only.
    const products: Product[] = prefetchedProducts || fetchedProducts;

    // URL helper injected by RenderBlocks — handles /_site/ prefix on both server and client.
    // Falls back to identity function when not provided (e.g. editor preview).
    const getUrl: (slug: string) => string = _getUrl || ((s: string) => s);

    // Both first renders use injected prefixes or defaults. Read editor-preview meta tags only after mount.
    const [metaPrefixes, setMetaPrefixes] = useState({ product: "/product", category: "/category" });
    useEffect(() => {
        setMetaPrefixes({
            product: (document.querySelector('meta[name="x-product-prefix"]') as HTMLMetaElement)?.content || "/product",
            category: (document.querySelector('meta[name="x-category-prefix"]') as HTMLMetaElement)?.content || "/category",
        });
    }, []);
    const productPrefix = _productPrefix
        || metaPrefixes.product;
    const categoryPrefix = _categoryPrefix
        || metaPrefixes.category;

    // Client-side fallback fetch — only runs when server prefetch is absent
    useEffect(() => {
        if (prefetchedProducts || !categorySlug || !tenantId) {
            setLoading(false);
            return;
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
        fetch(`${apiUrl}/public/categories/${categorySlug}`, {
            headers: { "x-tenant-id": tenantId },
        })
            .then(r => {
                if (!r.ok) throw new Error(`API ${r.status}`);
                return r.json();
            })
            .then(data => {
                const items = (data.products || []).slice(0, limit);
                setFetchedProducts(items);
            })
            .catch((e) => console.error("[CategoryShowcase] Fetch failed:", e))
            .finally(() => setLoading(false));
    }, [categorySlug, tenantId, limit, prefetchedProducts]);

    if (!categorySlug) return null;

    const colClass = columns === "2" ? "grid-cols-2" : columns === "3" ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4";

    return (
        <section className="my-12">
            {eyebrow !== null && (
                <p className="mx-auto w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">{eyebrow}</p>
            )}
            {categoryName && (
                <h2 className="text-2xl md:text-3xl font-bold text-center mb-8">{categoryName}</h2>
            )}

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
            ) : products.length > 0 ? (
                <div className={`grid ${colClass} gap-6`}>
                    {products.map(product => (
                        <ProductCard
                            key={product.id}
                            product={product}
                            showPrice={showPrice}
                            catalogMode={catalogMode}
                            productPrefix={productPrefix}
                            getUrl={getUrl}
                            strings={strings}
                            options={options}
                        />
                    ))}
                </div>
            ) : (
                <p className="text-center text-muted-foreground py-8">{strings.showcaseEmpty}</p>
            )}

            {ctaText && categorySlug && (
                <div className="text-center mt-8">
                    <a
                        href={getUrl(`${categoryPrefix}/${categorySlug}`)}
                        className="inline-block border-2 border-primary text-primary px-8 py-3 rounded-full text-sm font-semibold uppercase tracking-wider hover:bg-primary hover:text-primary-foreground transition-colors"
                    >
                        {ctaText}
                    </a>
                </div>
            )}
        </section>
    );
}
