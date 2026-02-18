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

function ProductCard({ product, showPrice, productPrefix }: { product: Product; showPrice: boolean; productPrefix: string }) {
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
        <a href={`${productPrefix}/${product.slug}`} className="group block">
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
    const { categoryId, categoryName, categorySlug, limit, columns, showPrice, ctaText } = attrs;
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);

    // Determine URL prefixes from document (set as data attrs on body or read from config)
    const productPrefix = typeof document !== "undefined"
        ? (document.querySelector('meta[name="x-product-prefix"]') as HTMLMetaElement)?.content || "/product"
        : "/product";
    const categoryPrefix = typeof document !== "undefined"
        ? (document.querySelector('meta[name="x-category-prefix"]') as HTMLMetaElement)?.content || "/category"
        : "/category";

    useEffect(() => {
        if (!categoryId || !tenantId) { setLoading(false); return; }

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
        fetch(`${apiUrl}/public/categories/${categoryId}`, {
            headers: { "x-tenant-id": tenantId },
        })
            .then(r => r.json())
            .then(data => {
                const items = (data.products || []).slice(0, limit);
                setProducts(items);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [categoryId, tenantId, limit]);

    if (!categoryId) return null;

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
                        />
                    ))}
                </div>
            ) : (
                <p className="text-center text-muted-foreground py-8">No products found in this category.</p>
            )}

            {ctaText && categorySlug && (
                <div className="text-center mt-8">
                    <a
                        href={`${categoryPrefix}/${categorySlug}`}
                        className="inline-block border-2 border-primary text-primary px-8 py-3 rounded-full text-sm font-semibold uppercase tracking-wider hover:bg-primary hover:text-primary-foreground transition-colors"
                    >
                        {ctaText}
                    </a>
                </div>
            )}
        </section>
    );
}
