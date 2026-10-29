// Shared render body for the legacy by-ID product route `/products/<productId>`.
//
// cache-1: same two-route split as SitePage.tsx — one cacheable route and one
// force-dynamic twin call this with plain props. Nothing here may invoke a Next.js
// dynamic API; `preview` arrives as a prop (always false on the cacheable route).
//
// Note: the slug-based commerce product page (`config.urlPrefixes.product`) is handled by
// SitePage.tsx. This route is the older by-ID URL and is kept working unchanged.
import { getTenantConfig, getProductById } from "@/lib/dynamo";
import { notFoundOrHandoff } from "@/lib/not-found-handoff";
import Script from "next/script";
import { Metadata } from "next";
import { isCatalogMode } from "@amodx/shared";

export type ProductByIdInput = {
    siteId: string;
    productId: string;
    /** Show non-active products. Always false on the cacheable route. */
    preview: boolean;
    /** True on the ISR route. See `lib/not-found-handoff.ts`. */
    cacheable: boolean;
};

export async function buildProductByIdMetadata({ siteId, productId }: Pick<ProductByIdInput, "siteId" | "productId">): Promise<Metadata> {
    const config = await getTenantConfig(siteId);
    if (!config) return {};

    const product = await getProductById(config.id, productId);
    if (!product) return {};

    return {
        title: product.title,
        description: product.description.substring(0, 160),
        openGraph: {
            title: product.title,
            description: product.description.substring(0, 160),
            // CM-D7: an absent image (catalog product) gives no og:image.
            images: product.imageLink !== undefined ? [product.imageLink] : []
        }
    };
}

export async function ProductByIdPage({ siteId, productId, preview, cacheable }: ProductByIdInput) {
    // The visitor's path for this route is always `/products/<id>` — the `/<siteId>`
    // prefix is the internal rewrite target and must not leak into a Location header.
    const notFoundHere = () => notFoundOrHandoff(cacheable, `/products/${productId}`);

    const config = await getTenantConfig(siteId);
    if (!config) return notFoundHere();

    // 1. Real Fetch
    const product = await getProductById(config.id, productId);

    if (!product) return notFoundHere();

    // 2. STATUS CHECK
    // If not Active, only allow if Preview Mode
    if (product.status !== 'active' && !preview) {
        return notFoundHere();
    }

    // CATALOG-MODE-1: a catalog site shows no price, no availability and no buy control (spec § 3.2.1).
    const catalog = isCatalogMode(config);
    // CM-D7: an absent main image (the key is absent; a catalog product may have none) is left out of every reader.
    const images = product.imageLink !== undefined
        ? [product.imageLink, ...(product.additionalImageLinks || [])]
        : (product.additionalImageLinks || []);

    // 3. SCHEMA.ORG JSON-LD
    const jsonLd = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": product.title,
        ...(images.length > 0 ? { "image": images } : {}),
        "description": product.description,
        "sku": product.id,
        "brand": {
            "@type": "Brand",
            "name": product.brand || config.name
        },
        ...(catalog ? {} : {
            "offers": {
                "@type": "Offer",
                "url": `https://${config.domain}/products/${product.id}`,
                "priceCurrency": product.currency,
                "price": product.price,
                "availability": product.availability === 'in_stock' ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                "itemCondition": product.condition === 'new' ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition"
            }
        })
    };

    return (
        <div className="max-w-4xl mx-auto py-12 px-6">
            <Script
                id="product-schema"
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />

            {product.status === 'draft' && (
                <div className="bg-yellow-100 text-yellow-800 text-center py-2 mb-4 font-bold rounded">
                    DRAFT PREVIEW
                </div>
            )}

            <div className="grid md:grid-cols-2 gap-12">
                <div className="space-y-4">
                    {product.imageLink !== undefined && <img src={product.imageLink} alt={product.title} className="rounded-xl shadow-lg w-full" />}
                    <div className="grid grid-cols-4 gap-2">
                        {product.additionalImageLinks?.map((img: string, i: number) => (
                            <img key={i} src={img} className="rounded-lg shadow-sm border" />
                        ))}
                    </div>
                </div>

                <div>
                    <h1 className="text-4xl font-bold mb-4">{product.title}</h1>
                    {!catalog && <div className="text-2xl font-medium text-primary mb-6 flex items-center gap-3">
                        {product.salePrice ? (
                            <>
                                <span className="line-through text-muted-foreground text-lg">{product.price}</span>
                                <span className="text-red-600">{product.salePrice} {product.currency}</span>
                            </>
                        ) : (
                            <span>{product.price} {product.currency}</span>
                        )}
                    </div>}

                    <div className="prose prose-zinc dark:prose-invert mb-8">
                        <p className="whitespace-pre-wrap">{product.description}</p>
                    </div>

                    {!catalog && (product.availability === 'in_stock' ? (
                        product.paymentLinkId && (
                            <a
                                href="#"
                                className="paddle_button block w-full text-center bg-primary text-primary-foreground px-8 py-4 rounded-lg font-bold hover:opacity-90 transition-opacity"
                                data-product={product.paymentLinkId}
                            >
                                Buy Now
                            </a>
                        )
                    ) : (
                        <button disabled className="w-full bg-muted text-muted-foreground px-8 py-4 rounded-lg font-bold cursor-not-allowed">
                            {product.availability === 'preorder' ? "Pre-order" : "Out of Stock"}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
