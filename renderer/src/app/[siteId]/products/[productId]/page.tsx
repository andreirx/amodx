import { getTenantConfig, getProductById } from "@/lib/dynamo"; // Real import
import { notFound } from "next/navigation";
import Script from "next/script";
import { Metadata } from "next";

type Props = {
    params: Promise<{ siteId: string; productId: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId, productId } = await params;
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
            images: [product.imageLink]
        }
    };
}

export default async function ProductPage({ params, searchParams }: Props) {
    const { siteId, productId } = await params;
    const { preview } = await searchParams;

    const config = await getTenantConfig(siteId);
    if (!config) return notFound();

    // 1. Real Fetch
    const product = await getProductById(config.id, productId);

    if (!product) return notFound();

    // 2. STATUS CHECK
    // If not Active, only allow if Preview Mode
    if (product.status !== 'active' && !preview) {
        return notFound();
    }

    // 3. SCHEMA.ORG JSON-LD
    const jsonLd = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": product.title,
        "image": [product.imageLink, ...(product.additionalImageLinks || [])],
        "description": product.description,
        "sku": product.id,
        "brand": {
            "@type": "Brand",
            "name": product.brand || config.name
        },
        "offers": {
            "@type": "Offer",
            "url": `https://${config.domain}/products/${product.id}`,
            "priceCurrency": product.currency,
            "price": product.price,
            "availability": product.availability === 'in_stock' ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            "itemCondition": product.condition === 'new' ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition"
        }
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
                    <img src={product.imageLink} alt={product.title} className="rounded-xl shadow-lg w-full" />
                    <div className="grid grid-cols-4 gap-2">
                        {product.additionalImageLinks?.map((img: string, i: number) => (
                            <img key={i} src={img} className="rounded-lg shadow-sm border" />
                        ))}
                    </div>
                </div>

                <div>
                    <h1 className="text-4xl font-bold mb-4">{product.title}</h1>
                    <div className="text-2xl font-medium text-primary mb-6 flex items-center gap-3">
                        {product.salePrice ? (
                            <>
                                <span className="line-through text-muted-foreground text-lg">{product.price}</span>
                                <span className="text-red-600">{product.salePrice} {product.currency}</span>
                            </>
                        ) : (
                            <span>{product.price} {product.currency}</span>
                        )}
                    </div>

                    <div className="prose prose-zinc dark:prose-invert mb-8">
                        <p className="whitespace-pre-wrap">{product.description}</p>
                    </div>

                    {product.availability === 'in_stock' ? (
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
                    )}
                </div>
            </div>
        </div>
    );
}
