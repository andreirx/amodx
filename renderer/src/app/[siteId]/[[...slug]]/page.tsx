import { getTenantConfig, getContentBySlug, getPosts, getProductBySlug, getCategoryBySlug, getProductsByCategory, getAllCategories, getActiveProducts, getDeliveryConfig, getOrderForCustomer, getProductReviews, getCustomerOrders, getCustomerProfile } from "@/lib/dynamo";
import { RenderBlocks } from "@/components/RenderBlocks";
import { notFound, permanentRedirect } from "next/navigation";
import { Metadata } from "next";
import { ContentItem, Product, Category, URL_PREFIX_DEFAULTS } from "@amodx/shared";
import Link from "next/link";
import { CommentsSection } from "@/components/CommentsSection";
import { ThemeInjector } from "@/components/ThemeInjector";
import { SocialShare } from "@/components/SocialShare";
import Script from "next/script";
import { CartPageView } from "@/components/CartPageView";
import { CheckoutPageView } from "@/components/CheckoutPageView";
import { AddToCartButton } from "@/components/AddToCartButton";
import { FBPurchaseEvent } from "@/components/FBPurchaseEvent";
import { ProductImageGallery } from "@/components/ProductImageGallery";
import { AccountPageView } from "@/components/AccountPageView";

// NEW: Auth Imports
import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";

export const revalidate = 3600; // Default to ISR

type Props = {
    params: Promise<{ siteId: string; slug?: string[] }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// Commerce prefix matching helper
type CommerceMatch = { type: 'product' | 'category' | 'shop' | 'cart' | 'checkout' | 'checkout-confirm' | 'checkout-track' | 'account'; itemSlug?: string };

function matchCommercePrefix(slugPath: string, urlPrefixes: any): CommerceMatch | null {
    const prefixes = urlPrefixes || URL_PREFIX_DEFAULTS;

    if (slugPath === prefixes.cart) return { type: 'cart' };
    if (slugPath === prefixes.checkout) return { type: 'checkout' };
    if (slugPath === prefixes.checkout + "/confirmare") return { type: 'checkout-confirm' };
    if (slugPath.startsWith(prefixes.checkout + "/")) {
        const segment = slugPath.slice(prefixes.checkout.length + 1);
        if (segment && segment !== "confirmare") return { type: 'checkout-track', itemSlug: segment };
    }
    if (slugPath === prefixes.shop) return { type: 'shop' };
    if (slugPath.startsWith(prefixes.product + "/")) {
        return { type: 'product', itemSlug: slugPath.slice(prefixes.product.length + 1) };
    }
    if (slugPath.startsWith(prefixes.category + "/")) {
        return { type: 'category', itemSlug: slugPath.slice(prefixes.category.length + 1) };
    }
    if (slugPath === (prefixes.account || "/account")) return { type: 'account' };
    return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId, slug } = await params;
    const config = await getTenantConfig(siteId);
    if (!config) return {};

    const slugPath = slug ? "/" + slug.join("/") : "/";
    const canonicalUrl = `https://${config.domain}${slugPath === '/' ? '' : slugPath}`;

    // Check commerce routes first
    const commerce = matchCommercePrefix(slugPath, config.urlPrefixes);
    if (commerce) {
        if (commerce.type === 'product' && commerce.itemSlug) {
            const product = await getProductBySlug(config.id, commerce.itemSlug);
            if (product) return {
                title: (product as any).seoTitle || product.title,
                description: (product as any).seoDescription || product.description?.substring(0, 160),
                metadataBase: new URL(`https://${config.domain}`),
                openGraph: { title: product.title, description: product.description?.substring(0, 160), images: product.imageLink ? [{ url: product.imageLink }] : [], url: canonicalUrl, siteName: config.name },
                alternates: { canonical: canonicalUrl }
            };
        }
        if (commerce.type === 'category' && commerce.itemSlug) {
            const category = await getCategoryBySlug(config.id, commerce.itemSlug);
            if (category) return {
                title: category.seoTitle || category.name,
                description: category.seoDescription || `Browse ${category.name} products`,
                metadataBase: new URL(`https://${config.domain}`),
                openGraph: { title: category.name, description: category.seoDescription, images: category.imageLink ? [{ url: category.imageLink }] : [], url: canonicalUrl, siteName: config.name },
                alternates: { canonical: canonicalUrl }
            };
        }
        if (commerce.type === 'shop') return {
            title: `Shop - ${config.name}`,
            metadataBase: new URL(`https://${config.domain}`),
            alternates: { canonical: canonicalUrl }
        };
        if (commerce.type === 'cart') return { title: `Cart - ${config.name}`, metadataBase: new URL(`https://${config.domain}`) };
        if (commerce.type === 'checkout') return { title: `Checkout - ${config.name}`, metadataBase: new URL(`https://${config.domain}`) };
        if (commerce.type === 'checkout-confirm') return { title: `Order Confirmation - ${config.name}`, metadataBase: new URL(`https://${config.domain}`) };
        if (commerce.type === 'checkout-track') return { title: `Order Tracking - ${config.name}`, metadataBase: new URL(`https://${config.domain}`) };
    }

    // Content page metadata
    const result = await getContentBySlug(config.id, slugPath);
    if (!result || 'redirect' in result) return { title: config.name };

    const content = result as ContentItem;
    return {
        title: content.seoTitle || content.title || config.name,
        description: content.seoDescription,
        metadataBase: new URL(`https://${config.domain}`),
        openGraph: {
            title: content.seoTitle || content.title,
            description: content.seoDescription,
            url: canonicalUrl,
            type: 'website',
            images: content.featuredImage
                ? [{ url: content.featuredImage }]
                : (config.logo ? [{ url: config.logo }] : []),
            siteName: config.name,
        },
        alternates: { canonical: canonicalUrl }
    };
}

export default async function Page({ params, searchParams }: Props) {
    const { siteId, slug } = await params;
    const { preview } = await searchParams;
    const slugPath = slug ? "/" + slug.join("/") : "/";

    const config = await getTenantConfig(siteId);
    if (!config) return notFound();

    // --- COMMERCE ROUTING ---
    const commerceEnabled = config.commerceEnabled ?? false;
    const commerce = matchCommercePrefix(slugPath, config.urlPrefixes);
    if (commerce) {
        const prefixes = config.urlPrefixes || URL_PREFIX_DEFAULTS;

        // Product, category, and shop pages work regardless of commerceEnabled
        if (commerce.type === 'product' && commerce.itemSlug) {
            const product = await getProductBySlug(config.id, commerce.itemSlug);
            if (!product) return notFound();
            if ((product as any).status !== 'active' && !preview) return notFound();
            const reviews = await getProductReviews(config.id, (product as any).id);
            return <ProductPageView product={product as any} config={config} prefixes={prefixes} reviews={reviews} commerceEnabled={commerceEnabled} />;
        }

        if (commerce.type === 'category' && commerce.itemSlug) {
            const category = await getCategoryBySlug(config.id, commerce.itemSlug);
            if (!category) return notFound();
            const page = parseInt((await searchParams).page as string || "1");
            const { items: products, total } = await getProductsByCategory(config.id, category.id, page, 24);
            return <CategoryPageView category={category} products={products} total={total} page={page} config={config} prefixes={prefixes} />;
        }

        if (commerce.type === 'shop') {
            const page = parseInt((await searchParams).page as string || "1");
            const [{ items: products, total }, categories] = await Promise.all([
                getActiveProducts(config.id, page, 24),
                getAllCategories(config.id)
            ]);
            return <ShopPageView products={products} categories={categories} total={total} page={page} config={config} prefixes={prefixes} />;
        }

        // Account, cart, checkout, confirmation, tracking require commerceEnabled
        if (!commerceEnabled) return notFound();

        if (commerce.type === 'account') {
            // Decode session from JWT cookie server-side
            let userEmail: string | null = null;
            try {
                const cookieStore = await cookies();
                const token = cookieStore.get("next-auth.session-token")?.value;
                if (token && process.env.NEXTAUTH_SECRET) {
                    const decoded = await decode({ token, secret: process.env.NEXTAUTH_SECRET });
                    userEmail = decoded?.email as string || null;
                }
            } catch {}

            let orders: any[] = [];
            let customer: any = null;
            if (userEmail) {
                [orders, customer] = await Promise.all([
                    getCustomerOrders(config.id, userEmail),
                    getCustomerProfile(config.id, userEmail),
                ]);
            }
            return (
                <AccountPageView
                    orders={orders}
                    customer={customer}
                    currency={config.currency || "RON"}
                    checkoutPrefix={prefixes.checkout || "/checkout"}
                    shopPrefix={prefixes.shop || "/shop"}
                    contentMaxWidth={config.header?.contentPageMaxWidth || "max-w-4xl"}
                />
            );
        }

        if (commerce.type === 'cart') {
            const deliveryConfig = await getDeliveryConfig(config.id);
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
            return (
                <CartPageView
                    checkoutPrefix={prefixes.checkout || "/comanda"}
                    shopPrefix={prefixes.shop || "/magazin"}
                    freeDeliveryThreshold={deliveryConfig?.freeDeliveryThreshold || 0}
                    flatShippingCost={deliveryConfig?.flatShippingCost || 0}
                    minimumOrderAmount={deliveryConfig?.minimumOrderAmount || 0}
                    currency={config.currency || "RON"}
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    contentMaxWidth={config.header?.contentMaxWidth || "max-w-6xl"}
                />
            );
        }

        if (commerce.type === 'checkout') {
            const deliveryConfig = await getDeliveryConfig(config.id);
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
            return (
                <CheckoutPageView
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    confirmPrefix={`${prefixes.checkout || "/comanda"}/confirmare`}
                    cartPrefix={prefixes.cart || "/cos"}
                    freeDeliveryThreshold={deliveryConfig?.freeDeliveryThreshold || 0}
                    flatShippingCost={deliveryConfig?.flatShippingCost || 0}
                    currency={config.currency || "RON"}
                    bankTransfer={config.integrations?.bankTransfer}
                    enabledPaymentMethods={config.enabledPaymentMethods}
                    contentMaxWidth={config.header?.contentMaxWidth || "max-w-6xl"}
                />
            );
        }

        if (commerce.type === 'checkout-confirm') {
            const sp = await searchParams;
            const orderId = sp.id as string;
            const email = sp.email as string;
            let order = null;
            if (orderId && email) {
                order = await getOrderForCustomer(config.id, orderId, email);
            }
            return <ConfirmationPageView order={order} config={config} prefixes={prefixes} />;
        }

        if (commerce.type === 'checkout-track') {
            const sp = await searchParams;
            const email = sp.email as string;
            let order = null;
            if (commerce.itemSlug && email) {
                order = await getOrderForCustomer(config.id, commerce.itemSlug, email);
            }
            return <OrderTrackingView order={order} config={config} prefixes={prefixes} />;
        }
    }

    const result = await getContentBySlug(config.id, slugPath);
    if (!result) return notFound();

    // 1. Handle Redirects
    if ('redirect' in result) {
        permanentRedirect(result.redirect);
    }

    const content = result as ContentItem;

    // Status Check
    if (content.status !== 'Published' && !preview) {
        return notFound();
    }

    // --- ACCESS GATEKEEPER ---
    const policy = content.accessPolicy || { type: 'Public' };
    const isPublic = policy.type === 'Public';

    let isAuthenticated = false;

    // Only check auth if necessary (Preserves ISR for public pages)
    if (!isPublic) {
        const cookieStore = await cookies();
        const sessionToken = cookieStore.get("next-auth.session-token")?.value ||
            cookieStore.get("__Secure-next-auth.session-token")?.value;

        if (sessionToken && process.env.NEXTAUTH_SECRET) {
            try {
                // Verify the JWT signature to prevent cookie spoofing
                const decoded = await decode({
                    token: sessionToken,
                    secret: process.env.NEXTAUTH_SECRET
                });
                if (decoded) isAuthenticated = true;
            } catch (e) {
                console.warn("Invalid session token", e);
            }
        }
    }

    const hasAccess = isPublic || isAuthenticated;

    // --- SCHEMA GENERATOR ---
    const globalSchemaType = config.schemaType || "Organization";
    const pageSchemaType = content.schemaType;

    // 1. Determine the Entity Type
    // If it's the homepage ('/'), we use the Global Type (e.g. SoftwareApplication)
    // If it's an internal page, we default to WebPage unless overridden (e.g. Article)
    const isHome = slugPath === '/';
    const effectiveType = pageSchemaType || (isHome ? globalSchemaType : 'WebPage');
    const canonicalUrl = `https://${config.domain}${slugPath === '/' ? '' : slugPath}`;

    let jsonLd: any = {
        "@context": "https://schema.org",
        "@type": effectiveType,
        "name": content.seoTitle || content.title || config.name,
        "description": content.seoDescription || config.description,
        "url": canonicalUrl,
    };

    if (effectiveType === 'SoftwareApplication') {
        jsonLd = {
            ...jsonLd,
            "applicationCategory": "BusinessApplication",
            "operatingSystem": "Cloud/Web",
            "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
        };
    } else if (effectiveType === 'Article') {
        jsonLd = {
            ...jsonLd,
            "headline": content.title,
            "image": content.featuredImage ? [content.featuredImage] : [],
            "datePublished": content.createdAt,
            "dateModified": content.updatedAt || content.createdAt,
            "author": { "@type": "Person", "name": content.author || config.name }
        };
    } else if (effectiveType === 'Organization' || effectiveType === 'LocalBusiness') {
        jsonLd = {
            ...jsonLd,
            "logo": config.logo,
            "contactPoint": config.integrations?.contactEmail ? {
                "@type": "ContactPoint",
                "email": config.integrations.contactEmail,
                "contactType": "customer service"
            } : undefined
        };
    }

    // --- RENDER: ACCESS DENIED ---
    if (!hasAccess) {
        return (
            <>
                <ThemeInjector theme={config.theme} tenantId={config.id} />
                <main className={`${config.header?.contentPageMaxWidth || "max-w-4xl"} mx-auto py-20 px-6 text-center space-y-6`}>
                    <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                        <span className="text-2xl">🔒</span>
                    </div>

                    <h1 className="text-4xl font-bold tracking-tight">Restricted Access</h1>

                    <p className="text-xl text-muted-foreground max-w-lg mx-auto">
                        {policy.type === 'LoginRequired' && "You must be logged in to view this page."}
                        {policy.type === 'Purchase' && `This content requires a subscription (${policy.currency} ${policy.price}).`}
                    </p>

                    <div className="flex gap-4 justify-center pt-4">
                        <Link
                            href={`/api/auth/signin?callbackUrl=${encodeURIComponent(slugPath)}`}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-10 px-8 hover:opacity-90 transition-opacity"
                        >
                            Log In with Google
                        </Link>

                        {policy.type === 'Purchase' && (
                            <button className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-10 px-8">
                                Purchase Access
                            </button>
                        )}
                    </div>
                </main>
            </>
        );
    }

    // --- SEO FIX: PRE-FETCH POST GRID DATA ---
    // We modify the blocks in memory before passing them to the renderer
    if (content.blocks && Array.isArray(content.blocks)) {
        await Promise.all(content.blocks.map(async (block: any) => {
            if (block.type === 'postGrid') {
                const tag = block.attrs.filterTag;
                // Parse limit safely (handle "0" string or number)
                let limit = 6;
                if (block.attrs.limit !== undefined && block.attrs.limit !== null && block.attrs.limit !== "") {
                    limit = parseInt(block.attrs.limit);
                }

                // Fetch data SERVER SIDE
                const posts = await getPosts(config.id, tag, limit);

                // Inject into attributes
                block.attrs.prefetchedPosts = posts;
                // Pass domain for breadcrumbs (fixes "window is undefined")
                block.attrs.serverDomain = config.domain;
            }
        }));
    }
    // -----------------------------------------

    // --- RENDER: CONTENT ---
    const mergedTheme = {
        ...config.theme,
        ...(content.themeOverride || {})
    };

    const hasThemeOverride = content.themeOverride && Object.keys(content.themeOverride).length > 0;

    const cw = config.header?.contentPageMaxWidth || "max-w-4xl";

    return (
        <main className="py-12 relative">
            {/* SCHEMA INJECTION */}
            <Script
                id="json-ld-schema"
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />

            {/* A. Apply Color Overrides (if any) */}
            {hasThemeOverride && (
                <ThemeInjector theme={mergedTheme} tenantId={config.id} />
            )}

            {/* B. Apply Hide Nav/Footer Logic */}
            {(content.hideNav || content.hideFooter) && (
                <style dangerouslySetInnerHTML={{
                    __html: `
                        ${content.hideNav ? 'nav, .site-navbar { display: none !important; }' : ''}
                        ${content.hideFooter ? 'footer, .site-footer { display: none !important; }' : ''}
                    `
                }} />
            )}

            {/* DRAFT WATERMARK */}
            {content.status === 'Draft' && (
                <div className="absolute top-0 left-0 w-full bg-yellow-100 border-b border-yellow-200 text-yellow-800 text-xs font-bold text-center py-2 uppercase tracking-widest z-50">
                    Draft Preview Mode
                </div>
            )}

            {/* Title (Hide on Home) */}
            {content.title && slugPath !== "/" && (
                <div className={`${cw} mx-auto px-6`}>
                    <h1 className="text-4xl font-bold mb-8 text-foreground tracking-tight">
                        {content.title}
                    </h1>
                </div>
            )}

            {!content.hideSharing && (
                <div className={`${cw} mx-auto px-6`}>
                    <SocialShare title={content.title} />
                </div>
            )}

            <RenderBlocks blocks={content.blocks} tenantId={config.id} contentMaxWidth={cw} />

            <CommentsSection pageId={content.nodeId} mode={content.commentsMode} contentMaxWidth={cw} />
        </main>
    );
}

// --- COMMERCE PAGE COMPONENTS ---

function ProductCard({ product, productPrefix }: { product: any; productPrefix: string }) {
    return (
        <Link href={`${productPrefix}/${product.slug}`} className="group block">
            <div className="aspect-square bg-muted rounded-lg overflow-hidden mb-3">
                {product.imageLink ? (
                    <img src={product.imageLink} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-4xl">🛍</div>
                )}
            </div>
            <h3 className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">{product.title}</h3>
            <div className="mt-1">
                {product.salePrice ? (
                    <div className="flex items-center gap-2">
                        <span className="text-red-600 font-bold">{product.salePrice} {product.currency}</span>
                        <span className="line-through text-muted-foreground text-sm">{product.price}</span>
                    </div>
                ) : (
                    <span className="font-semibold">{product.price} {product.currency}</span>
                )}
            </div>
            {product.availability !== 'in_stock' && (
                <span className="text-xs text-amber-600 mt-1 block capitalize">{(product.availability || '').replace('_', ' ')}</span>
            )}
        </Link>
    );
}

function Pagination({ page, total, limit, baseUrl }: { page: number; total: number; limit: number; baseUrl: string }) {
    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) return null;

    return (
        <div className="flex items-center justify-center gap-2 mt-12">
            {page > 1 && (
                <Link href={`${baseUrl}?page=${page - 1}`} className="px-4 py-2 border rounded-md text-sm hover:bg-muted">Previous</Link>
            )}
            <span className="text-sm text-muted-foreground px-4">Page {page} of {totalPages}</span>
            {page < totalPages && (
                <Link href={`${baseUrl}?page=${page + 1}`} className="px-4 py-2 border rounded-md text-sm hover:bg-muted">Next</Link>
            )}
        </div>
    );
}

function ProductPageView({ product, config, prefixes, reviews, commerceEnabled = false }: { product: any; config: any; prefixes: any; reviews?: { items: any[]; averageRating: number; totalReviews: number }; commerceEnabled?: boolean }) {
    const siteWidth = config.header?.contentMaxWidth || "max-w-6xl";
    const jsonLd: any = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": product.title,
        "description": product.description,
        "image": product.imageLink,
        "offers": {
            "@type": "Offer",
            "price": product.salePrice || product.price,
            "priceCurrency": product.currency || "RON",
            "availability": product.availability === 'in_stock' ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
        }
    };
    if (reviews && reviews.totalReviews > 0) {
        jsonLd.aggregateRating = {
            "@type": "AggregateRating",
            "ratingValue": reviews.averageRating,
            "reviewCount": reviews.totalReviews,
        };
    }

    return (
        <main className={`${siteWidth} mx-auto py-12 px-6`}>
            <Script id="product-schema" type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

            {/* Breadcrumbs */}
            <nav className="text-sm text-muted-foreground mb-8">
                <Link href="/" className="hover:text-primary">Home</Link>
                <span className="mx-2">/</span>
                <Link href={prefixes.shop || "/magazin"} className="hover:text-primary">Shop</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{product.title}</span>
            </nav>

            <div className="grid md:grid-cols-2 gap-12">
                {/* Images */}
                <ProductImageGallery
                    mainImage={product.imageLink}
                    additionalImages={product.additionalImageLinks || []}
                    title={product.title}
                />

                {/* Product Info */}
                <div className="space-y-6">
                    <h1 className="text-3xl font-bold tracking-tight">{product.title}</h1>

                    {/* Price */}
                    <div className="text-2xl">
                        {product.salePrice ? (
                            <div className="flex items-center gap-3">
                                <span className="font-bold text-red-600">{product.salePrice} {product.currency}</span>
                                <span className="line-through text-muted-foreground text-lg">{product.price} {product.currency}</span>
                            </div>
                        ) : (
                            <span className="font-bold">{product.price} {product.currency}</span>
                        )}
                    </div>

                    {/* Volume Pricing */}
                    {product.volumePricing?.length > 0 && (
                        <div className="border rounded-lg p-4">
                            <p className="text-sm font-medium mb-2">Volume Pricing</p>
                            <div className="space-y-1">
                                {product.volumePricing.map((tier: any, i: number) => (
                                    <div key={i} className="flex justify-between text-sm">
                                        <span>{tier.minQuantity}+ units</span>
                                        <span className="font-medium">{tier.price} {product.currency} each</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Availability */}
                    <div>
                        {product.availability === 'in_stock' ? (
                            <span className="inline-flex items-center gap-1.5 text-green-600 text-sm font-medium">
                                <span className="w-2 h-2 bg-green-500 rounded-full" /> In Stock
                            </span>
                        ) : product.availability === 'preorder' ? (
                            <span className="text-amber-600 text-sm font-medium">Pre-order</span>
                        ) : (
                            <span className="text-red-600 text-sm font-medium">Out of Stock</span>
                        )}
                    </div>

                    {/* Short Description */}
                    {product.description && (
                        <p className="text-muted-foreground whitespace-pre-wrap">{product.description}</p>
                    )}

                    {/* Add to Cart — only shown when commerce is enabled */}
                    {commerceEnabled && (
                        <AddToCartButton
                            productId={product.id}
                            title={product.title}
                            slug={product.slug || ""}
                            imageLink={product.imageLink || ""}
                            price={product.price}
                            salePrice={product.salePrice}
                            currency={product.currency || "RON"}
                            availability={product.availability || "in_stock"}
                            variants={product.variants || []}
                            personalizations={product.personalizations || []}
                            volumePricing={product.volumePricing || []}
                        />
                    )}

                    {/* Tags */}
                    {product.tags?.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {product.tags.map((tag: string) => (
                                <span key={tag} className="bg-muted px-2 py-1 rounded text-xs">{tag}</span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Tabs: Long Description / Ingredients / Nutritional Values */}
            {(product.longDescription || product.ingredients || product.nutritionalValues?.length > 0) && (
                <div className="mt-16 border-t pt-12">
                    {product.longDescription && (
                        <div className="prose max-w-none mb-12">
                            <h2 className="text-xl font-bold mb-4">Description</h2>
                            <div dangerouslySetInnerHTML={{ __html: product.longDescription }} />
                        </div>
                    )}
                    {product.ingredients && (
                        <div className="mb-12">
                            <h2 className="text-xl font-bold mb-4">Ingredients</h2>
                            <p className="text-muted-foreground whitespace-pre-wrap">{product.ingredients}</p>
                        </div>
                    )}
                    {product.nutritionalValues?.length > 0 && (
                        <div>
                            <h2 className="text-xl font-bold mb-4">Nutritional Values</h2>
                            <div className="border rounded-lg overflow-hidden">
                                {product.nutritionalValues.map((nv: any, i: number) => (
                                    <div key={i} className={`flex justify-between px-4 py-2.5 text-sm ${i % 2 === 0 ? 'bg-muted/50' : ''}`}>
                                        <span>{nv.label}</span>
                                        <div className="flex gap-4">
                                            <span className="font-medium">{nv.value}</span>
                                            {nv.dailyPercent && <span className="text-muted-foreground">{nv.dailyPercent}</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Reviews */}
            {reviews && reviews.totalReviews > 0 && (
                <div className="mt-16 border-t pt-12">
                    <div className="flex items-center gap-3 mb-8">
                        <h2 className="text-xl font-bold">Reviews</h2>
                        <div className="flex items-center gap-1.5">
                            <span className="text-amber-500 text-lg">{"★".repeat(Math.round(reviews.averageRating))}</span>
                            <span className="text-sm text-muted-foreground">{reviews.averageRating}/5 ({reviews.totalReviews} review{reviews.totalReviews !== 1 ? "s" : ""})</span>
                        </div>
                    </div>
                    <div className="space-y-6">
                        {reviews.items.map((review: any) => (
                            <div key={review.id} className="border rounded-lg p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{review.authorName}</span>
                                        {review.source === "google" && <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">Google</span>}
                                    </div>
                                    <span className="text-xs text-muted-foreground">{new Date(review.createdAt).toLocaleDateString("ro-RO")}</span>
                                </div>
                                <div className="text-amber-500 text-sm mb-2">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
                                {review.content && <p className="text-sm text-muted-foreground">{review.content}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </main>
    );
}

function CategoryPageView({ category, products, total, page, config, prefixes }: { category: any; products: any[]; total: number; page: number; config: any; prefixes: any }) {
    return (
        <main className={`${config.header?.contentMaxWidth || "max-w-6xl"} mx-auto py-12 px-6`}>
            {/* Breadcrumbs */}
            <nav className="text-sm text-muted-foreground mb-8">
                <Link href="/" className="hover:text-primary">Home</Link>
                <span className="mx-2">/</span>
                <Link href={prefixes.shop || "/magazin"} className="hover:text-primary">Shop</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{category.name}</span>
            </nav>

            <div className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
                {category.description && (
                    <p className="text-muted-foreground mt-2">{category.description}</p>
                )}
                <p className="text-sm text-muted-foreground mt-1">{total} product{total !== 1 ? 's' : ''}</p>
            </div>

            {products.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center">No products in this category yet.</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {products.map((product: any) => (
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || "/produs"} />
                    ))}
                </div>
            )}

            <Pagination page={page} total={total} limit={24} baseUrl={`${prefixes.category}/${category.slug}`} />
        </main>
    );
}

function ShopPageView({ products, categories, total, page, config, prefixes }: { products: any[]; categories: any[]; total: number; page: number; config: any; prefixes: any }) {
    return (
        <main className={`${config.header?.contentMaxWidth || "max-w-6xl"} mx-auto py-12 px-6`}>
            <h1 className="text-3xl font-bold tracking-tight mb-8">Shop</h1>

            {/* Category Navigation */}
            {categories.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-8">
                    <Link href={prefixes.shop || "/magazin"} className="px-4 py-2 rounded-full border text-sm font-medium bg-primary text-primary-foreground">
                        All
                    </Link>
                    {categories.map((cat: any) => (
                        <Link key={cat.id} href={`${prefixes.category}/${cat.slug}`} className="px-4 py-2 rounded-full border text-sm font-medium hover:bg-muted transition-colors">
                            {cat.name} {cat.productCount > 0 && <span className="text-muted-foreground ml-1">({cat.productCount})</span>}
                        </Link>
                    ))}
                </div>
            )}

            {products.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center">No products available yet.</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {products.map((product: any) => (
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || "/produs"} />
                    ))}
                </div>
            )}

            <Pagination page={page} total={total} limit={24} baseUrl={prefixes.shop || "/magazin"} />
        </main>
    );
}

function ConfirmationPageView({ order, config, prefixes }: { order: any; config: any; prefixes: any }) {
    const bankTransfer = config.integrations?.bankTransfer;
    const pageWidth = config.header?.contentPageMaxWidth || "max-w-4xl";

    if (!order) {
        return (
            <main className={`${pageWidth} mx-auto py-20 px-6 text-center`}>
                <div className="text-6xl mb-6">✅</div>
                <h1 className="text-3xl font-bold mb-4">Thank you for your order!</h1>
                <p className="text-muted-foreground mb-8">Your order has been placed successfully. You will receive a confirmation email shortly.</p>
                <Link href={prefixes.shop || "/magazin"} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
                    Continue Shopping
                </Link>
            </main>
        );
    }

    return (
        <main className={`${pageWidth} mx-auto py-12 px-6`}>
            <FBPurchaseEvent
                orderId={order.id}
                value={parseFloat(order.total) || 0}
                currency={order.currency || "RON"}
                items={(order.items || []).map((i: any) => ({ id: i.productId, quantity: i.quantity }))}
            />
            <div className="text-center mb-12">
                <div className="text-6xl mb-4">✅</div>
                <h1 className="text-3xl font-bold mb-2">Order Confirmed!</h1>
                <p className="text-lg text-muted-foreground">
                    Order <span className="font-mono font-bold text-foreground">{order.orderNumber}</span>
                </p>
            </div>

            {/* Bank Transfer Details */}
            {order.paymentMethod === "bank_transfer" && bankTransfer && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-3">Bank Transfer Details</h2>
                    <p className="text-sm text-muted-foreground mb-4">Please transfer the total amount to the following account:</p>
                    <div className="grid sm:grid-cols-2 gap-3 text-sm">
                        <div><span className="text-muted-foreground">Bank:</span> <strong>{bankTransfer.bankName}</strong></div>
                        <div><span className="text-muted-foreground">Account Holder:</span> <strong>{bankTransfer.accountHolder}</strong></div>
                        <div className="sm:col-span-2"><span className="text-muted-foreground">IBAN:</span> <strong className="font-mono">{bankTransfer.iban}</strong></div>
                        {bankTransfer.swift && <div><span className="text-muted-foreground">SWIFT:</span> <strong className="font-mono">{bankTransfer.swift}</strong></div>}
                        <div><span className="text-muted-foreground">Reference:</span> <strong>{order.orderNumber}</strong></div>
                        <div><span className="text-muted-foreground">Amount:</span> <strong>{order.total} {order.currency}</strong></div>
                    </div>
                </div>
            )}

            {/* Cash on Delivery */}
            {order.paymentMethod === "cash_on_delivery" && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-2">Cash on Delivery</h2>
                    <p className="text-sm text-muted-foreground">You will pay <strong>{order.total} {order.currency}</strong> when you receive your order.</p>
                    {order.estimatedDeliveryDate && <p className="text-sm mt-2">Estimated delivery: <strong>{order.estimatedDeliveryDate}</strong></p>}
                </div>
            )}

            {/* Order Items */}
            <div className="border rounded-lg p-6 mb-8">
                <h2 className="font-bold text-lg mb-4">Order Details</h2>
                <div className="space-y-3">
                    {(order.items || []).map((item: any, i: number) => (
                        <div key={i} className="flex justify-between text-sm py-2 border-b last:border-0">
                            <div>
                                <p className="font-medium">{item.productTitle}</p>
                                <p className="text-muted-foreground">Qty: {item.quantity}</p>
                                {item.personalizations?.length > 0 && (
                                    <p className="text-xs text-muted-foreground">{item.personalizations.map((p: any) => `${p.label}: ${p.value}`).join(", ")}</p>
                                )}
                            </div>
                            <span className="font-medium">{item.totalPrice} {order.currency}</span>
                        </div>
                    ))}
                </div>

                <div className="border-t mt-4 pt-4 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{order.subtotal} {order.currency}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>{order.shippingCost === "0" ? "Free" : `${order.shippingCost} ${order.currency}`}</span></div>
                    {parseFloat(order.discount || "0") > 0 && (
                        <div className="flex justify-between text-green-600"><span>Discount</span><span>-{order.discount} {order.currency}</span></div>
                    )}
                    <div className="flex justify-between font-bold text-base border-t pt-2"><span>Total</span><span>{order.total} {order.currency}</span></div>
                </div>
            </div>

            {/* Shipping Address */}
            {order.shippingAddress && (
                <div className="border rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-3">Shipping Address</h2>
                    <p className="text-sm">{order.customerName}</p>
                    <p className="text-sm text-muted-foreground">{order.shippingAddress.street}</p>
                    <p className="text-sm text-muted-foreground">{order.shippingAddress.city}, {order.shippingAddress.county} {order.shippingAddress.postalCode}</p>
                    {order.customerPhone && <p className="text-sm text-muted-foreground mt-2">Phone: {order.customerPhone}</p>}
                </div>
            )}

            <div className="text-center">
                <Link href={prefixes.shop || "/magazin"} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
                    Continue Shopping
                </Link>
            </div>
        </main>
    );
}

function OrderTrackingView({ order, config, prefixes }: { order: any; config: any; prefixes: any }) {
    const pageWidth = config.header?.contentPageMaxWidth || "max-w-4xl";

    if (!order) {
        return (
            <main className={`${pageWidth} mx-auto py-20 px-6 text-center`}>
                <h1 className="text-3xl font-bold mb-4">Order Not Found</h1>
                <p className="text-muted-foreground mb-8">Please check the order ID and email address.</p>
                <Link href={prefixes.shop || "/magazin"} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
                    Continue Shopping
                </Link>
            </main>
        );
    }

    const statusSteps = ["pending", "confirmed", "processing", "shipped", "delivered", "completed"];
    const currentStepIndex = statusSteps.indexOf(order.status);

    return (
        <main className={`${pageWidth} mx-auto py-12 px-6`}>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Order {order.orderNumber}</h1>
            <p className="text-muted-foreground mb-8">Placed on {new Date(order.createdAt).toLocaleDateString("ro-RO")}</p>

            {/* Status Timeline */}
            <div className="mb-12">
                <div className="flex items-center justify-between">
                    {statusSteps.map((step, i) => (
                        <div key={step} className="flex flex-col items-center flex-1">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                                i <= currentStepIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                            }`}>
                                {i <= currentStepIndex ? "✓" : i + 1}
                            </div>
                            <span className={`text-xs mt-1 capitalize ${i <= currentStepIndex ? "text-primary font-medium" : "text-muted-foreground"}`}>
                                {step}
                            </span>
                        </div>
                    ))}
                </div>
                <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((currentStepIndex + 1) / statusSteps.length) * 100}%` }} />
                </div>
            </div>

            {/* Status History */}
            {order.statusHistory?.length > 0 && (
                <div className="border rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-4">Status History</h2>
                    <div className="space-y-3">
                        {order.statusHistory.map((entry: any, i: number) => (
                            <div key={i} className="flex gap-3 text-sm">
                                <span className="text-muted-foreground whitespace-nowrap">{new Date(entry.timestamp).toLocaleString("ro-RO")}</span>
                                <span className="capitalize font-medium">{entry.status}</span>
                                {entry.note && <span className="text-muted-foreground">- {entry.note}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Tracking Number */}
            {order.trackingNumber && (
                <div className="border rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-2">Tracking</h2>
                    <p className="text-sm">Tracking Number: <span className="font-mono font-bold">{order.trackingNumber}</span></p>
                </div>
            )}

            {/* Order Items Summary */}
            <div className="border rounded-lg p-6">
                <h2 className="font-bold text-lg mb-4">Items</h2>
                {(order.items || []).map((item: any, i: number) => (
                    <div key={i} className="flex justify-between text-sm py-2 border-b last:border-0">
                        <span>{item.productTitle} x{item.quantity}</span>
                        <span className="font-medium">{item.totalPrice} {order.currency}</span>
                    </div>
                ))}
                <div className="border-t mt-3 pt-3 flex justify-between font-bold">
                    <span>Total</span>
                    <span>{order.total} {order.currency}</span>
                </div>
            </div>
        </main>
    );
}
