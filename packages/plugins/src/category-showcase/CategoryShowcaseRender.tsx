"use client";

import React, { useEffect, useState } from "react";

interface Product {
    id: string;
    title: string;
    slug: string;
    price: string;
    salePrice?: string;
    currency: string;
    imageLink?: string;
    availability: string;
    volumePricing?: { minQuantity: number; price: string }[];
}

function ProductCard({ product, showPrice, productPrefix, getUrl }: { product: Product; showPrice: boolean; productPrefix: string; getUrl: (s: string) => string }) {
    const outOfStock = product.availability === "out_of_stock";
    const hasSale = product.salePrice && product.salePrice !== product.price;
    const hasVolume = product.volumePricing && product.volumePricing.length > 0;

    let priceDisplay = `${product.price} ${product.currency}`;
    if (hasSale) {
        priceDisplay = `${product.salePrice} ${product.currency}`;
    }
    if (hasVolume) {
        const prices = product.volumePricing!.map(v => parseFloat(v.price));
        const min = Math.min(parseFloat(product.price), ...prices);
        const max = Math.max(parseFloat(product.price), ...prices);
        if (min !== max) priceDisplay = `${min} – ${max} ${product.currency}`;
    }

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
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No image</div>
                )}
                {outOfStock && (
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                        <span className="bg-background border border-border px-4 py-2 text-sm font-semibold uppercase tracking-wide">Out of Stock</span>
                    </div>
                )}
            </div>
            <h3 className="text-sm font-medium text-center leading-tight mb-1 group-hover:text-primary transition-colors">{product.title}</h3>
            {showPrice && (
                <p className="text-sm text-center text-primary font-medium">
                    {hasSale && <span className="line-through text-muted-foreground mr-2">{product.price} {product.currency}</span>}
                    {priceDisplay}
                </p>
            )}
        </a>
    );
}

export function CategoryShowcaseRender({ attrs, tenantId }: { attrs: any; tenantId?: string }) {
    const { categoryId, categoryName, categorySlug, limit, columns, showPrice, ctaText, prefetchedProducts, _getUrl, _productPrefix, _categoryPrefix } = attrs;

    // Client-fetch state — only used when server prefetch is absent (editor preview).
    // When prefetchedProducts exists, these are ignored in favor of the prop directly.
    const [fetchedProducts, setFetchedProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(!prefetchedProducts);

    // Derive render data: prop wins, state is fallback only.
    const products: Product[] = prefetchedProducts || fetchedProducts;

    // URL helper injected by RenderBlocks — handles /_site/ prefix on both server and client.
    // Falls back to identity function when not provided (e.g. editor preview).
    const getUrl: (slug: string) => string = _getUrl || ((s: string) => s);

    // URL prefixes: prefer server-injected values (SSR-correct), fall back to
    // document meta tags (client-only contexts like editor preview), then defaults.
    const productPrefix = _productPrefix
        || (typeof document !== "undefined" ? (document.querySelector('meta[name="x-product-prefix"]') as HTMLMetaElement)?.content : null)
        || "/product";
    const categoryPrefix = _categoryPrefix
        || (typeof document !== "undefined" ? (document.querySelector('meta[name="x-category-prefix"]') as HTMLMetaElement)?.content : null)
        || "/category";

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
                            productPrefix={productPrefix}
                            getUrl={getUrl}
                        />
                    ))}
                </div>
            ) : (
                <p className="text-center text-muted-foreground py-8">No products found in this category.</p>
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
