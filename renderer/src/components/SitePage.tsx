// Shared site-page render body.
//
// cache-1: this module is the ONE implementation of the public page render. It is
// called by two route files that differ only in rendering mode:
//
//   app/[siteId]/[[...slug]]/page.tsx        — cacheable (ISR / full-route cache)
//   app/[siteId]/%5Fdyn/[[...slug]]/page.tsx — force-dynamic twin
//
// HARD CONSTRAINT: nothing reachable from this module may call a Next.js dynamic API
// (`cookies()`, `headers()`, `await searchParams`, `connection()`). On a route in ISR
// mode Next 16.2.9 turns such a call into an HTTP 500 for that request — it does NOT
// degrade the render to dynamic. Every per-request input arrives as a plain prop on
// `SitePageInput`; the cacheable route passes the inert values (`preview: false`,
// `basePath: ""`, `sessionToken: null`, `query: {}`), the dynamic twin passes the real
// ones. See docs/caching-architecture.md § "Serving contract".
//
// Phase 3.3: getCustomerOrders / getCustomerProfile are deliberately NOT imported here.
// Customer-private data is fetched via session-validating API routes, not SSR.
import { getTenantConfig, getContentBySlug, getProductBySlug, getCategoryBySlug, getProductsByCategory, getAllCategories, getActiveProducts, getCatalogListing, searchProducts, getDeliveryConfig, getProductReviews } from "@/lib/dynamo";
import { getOrderForCustomer } from "@/lib/customer-api";
import { RenderBlocks } from "@/components/RenderBlocks";
import { permanentRedirect } from "next/navigation";
import { notFoundOrHandoff } from "@/lib/not-found-handoff";
import { localeInputFor } from "@/lib/site-segment";
import { ContentItem, Product, Category, URL_PREFIX_DEFAULTS, getCountryPack, isCatalogMode, catalogListingPath, resolveLocaleStrings, pageLanguageOf, fillTemplate, blockStrings } from "@amodx/shared";
import Link from "next/link";
import { CommentsSection } from "@/components/CommentsSection";
import { ThemeInjector } from "@/components/ThemeInjector";
import { SocialShare } from "@/components/SocialShare";
import Script from "next/script";
import { CartPageView } from "@/components/CartPageView";
import { CheckoutPageView } from "@/components/CheckoutPageView";
import { AccountPageView } from "@/components/AccountPageView";
import { InterestListPage } from "@/components/InterestShortlist";
import { buildFacetListing, listingHref } from "@amodx/shared";

// NEW: Auth Imports — signature verification only, no cookie access from this module.
import { decode } from "next-auth/jwt";

import type { SiteQuery, SitePageInput } from "@/components/site-page/input";
import { cartPageStrings, checkoutPageStrings, accountPageStrings, formatLocaleProp, facetLabelsOf, interestListStrings } from "@/components/site-page/locale-strings";
import { matchCommercePrefix, interestPrefix, normalizePageAddressOrKeepRaw } from "@/components/site-page/addresses";
import { prepareBlocks } from "@/components/site-page/prepare-blocks";
import { isEditorial, cardCategoriesOf } from "@/components/site-page/commerce-parts";
import { ConfirmationPageView, OrderTrackingView } from "@/components/site-page/order-views";
import { CategoryPageView, ShopPageView, SearchPageView } from "@/components/site-page/listing-views";
import { ProductPageView } from "@/components/site-page/product-page";

export type { SiteQuery, SitePageInput } from "@/components/site-page/input";

/** Normalizes Next's searchParams into the plain `SiteQuery` DTO. */
export function toSiteQuery(sp: Record<string, string | string[] | undefined>): SiteQuery {
    const out: SiteQuery = {};
    for (const [k, v] of Object.entries(sp)) out[k] = Array.isArray(v) ? v[0] : v;
    return out;
}

export { buildSitePageMetadata } from "@/components/site-page/metadata";

export async function SitePage({ siteId, slug, preview, basePath, sessionToken, query, cacheable }: SitePageInput) {
    const slugPath = slug ? "/" + slug.join("/") : "/";

    // On the cacheable route the visitor's path IS the slug path (middleware rewrites
    // `/<path>` → `/<siteId>/<path>` and `basePath` is empty there), so this is what a
    // not-found handoff may put in a `Location` header.
    const notFoundHere = () => notFoundOrHandoff(cacheable, slugPath);

    const config = await getTenantConfig(siteId);
    if (!config) return notFoundHere();

    // --- COMMERCE ROUTING ---
    const commerceEnabled = config.commerceEnabled ?? false;
    // CATALOG-MODE-1: a catalog site shows products with no price, availability or ordering surface (spec § 3.2).
    // Byte identity (spec § 3.6): every catalog-only change below leaves a non-catalog render's elements, client
    // props and RSC payload exactly as they were — catalog-only content takes an existing JSX slot, and a client prop
    // is added only when catalog.
    const catalog = isCatalogMode(config);
    // CAT-INTEREST-1: a catalog site's interest list (a client page; the list lives in the visitor's browser). Only
    // under catalog — on any other site the path stays an ordinary content slug.
    if (catalog && slugPath === interestPrefix(config)) {
        const prefixes = config.urlPrefixes || URL_PREFIX_DEFAULTS;
        return (
            <InterestListPage
                tenantId={config.id}
                apiUrl={process.env.NEXT_PUBLIC_API_URL || ""}
                productPrefix={prefixes.product || URL_PREFIX_DEFAULTS.product}
                shopPrefix={prefixes.shop || URL_PREFIX_DEFAULTS.shop}
                contentMaxWidth={config.header?.contentMaxWidth || "max-w-4xl"}
                strings={interestListStrings(resolveLocaleStrings(config).strings.catalog)}
            />
        );
    }
    const commerce = matchCommercePrefix(slugPath, config.urlPrefixes);
    if (commerce) {
        const prefixes = config.urlPrefixes || URL_PREFIX_DEFAULTS;

        // Product, category, and shop pages work regardless of commerceEnabled
        if (commerce.type === 'product' && commerce.itemSlug) {
            const product = await getProductBySlug(config.id, commerce.itemSlug);
            if (!product) return notFoundHere();
            // A non-active product is not found. CAT-IMAGE-GATE-1 (docs/slices/cat-image-gate-1.md § 3 item 5): on a
            // catalog site also with `?preview=` — that flag is not authenticated, and an imported product hidden until
            // its image copies must not be reachable by link. Other sites keep the preview exception (byte identity).
            if ((product as any).status !== 'active' && (catalog || !preview)) return notFoundHere();
            const [reviews, allCategories] = await Promise.all([
                getProductReviews(config.id, (product as any).id),
                getAllCategories(config.id)
            ]);
            // Filter to only categories this product belongs to
            // Build lookup maps for both id and slug
            const productCategoryIds: string[] = (product as any).categoryIds || [];
            const categoryById = new Map(allCategories.map((c: any) => [c.id, c]));
            const categoryBySlug = new Map(allCategories.map((c: any) => [c.slug, c]));

            // Match categories - check by id first, then by slug
            const productCategories: any[] = [];
            for (const cid of productCategoryIds) {
                const cat = categoryById.get(cid) || categoryBySlug.get(cid);
                if (cat && !productCategories.find((c: any) => c.id === cat.id)) {
                    productCategories.push(cat);
                }
            }

            // Build full category paths (including parents)
            const categoryPaths: { category: any; parents: any[] }[] = [];
            for (const cat of productCategories) {
                const parents: any[] = [];
                let current = cat;
                while (current.parentId && categoryById.has(current.parentId)) {
                    const parent = categoryById.get(current.parentId);
                    parents.unshift(parent);
                    current = parent;
                }
                categoryPaths.push({ category: cat, parents });
            }

            // LOCALE-1B (§ 9 item 2): the product page reads the resolver (ProductPageView), no longer the English-defaults helper (removed by LOCALE-1D).
            return <ProductPageView product={product as any} config={config} prefixes={prefixes} reviews={reviews} commerceEnabled={commerceEnabled} catalog={catalog} basePath={basePath} categories={productCategories} categoryPaths={categoryPaths} rawCategoryIds={productCategoryIds} />;
        }

        if (commerce.type === 'category' && commerce.itemSlug) {
            const category = await getCategoryBySlug(config.id, commerce.itemSlug);
            if (!category) return notFoundHere();
            // CATEGORY-CONTENT-1: the category's own blocks get the content page's preparation pass (no read without blocks).
            await prepareBlocks(category.blocks, config);
            const page = parseInt(query.page || "1");
            // CAT-FACETS-1: a catalog site lists the category from its `PRODUCT#` items and filters it (`?f=`).
            if (catalog) {
                const path = catalogListingPath(prefixes, category.slug);
                const listing = buildFacetListing(await getCatalogListing(config.id, category.id), query.f, `${basePath}${path}`, facetLabelsOf(resolveLocaleStrings(config).strings.catalog));
                const start = (page - 1) * 24;
                return <CategoryPageView category={category} products={listing.items.slice(start, start + 24)} total={listing.items.length} page={page} config={config} prefixes={prefixes} basePath={basePath} catalog={catalog} facets={{ listing, pagerBase: listingHref(path, listing.selection) }} cardCategories={await cardCategoriesOf(config)} />;
            }
            const { items: products, total } = await getProductsByCategory(config.id, category.id, page, 24);
            return <CategoryPageView category={category} products={products} total={total} page={page} config={config} prefixes={prefixes} basePath={basePath} catalog={catalog} cardCategories={await cardCategoriesOf(config)} />;
        }

        if (commerce.type === 'shop') {
            const page = parseInt(query.page || "1");
            // CAT-FACETS-1: a catalog site's shop is filtered (`?f=`); same `PRODUCT#` read, plus the facet fields.
            if (catalog) {
                const shopUrl = catalogListingPath(prefixes, undefined);
                const [base, categories] = await Promise.all([getCatalogListing(config.id), getAllCategories(config.id)]);
                const listing = buildFacetListing(base, query.f, `${basePath}${shopUrl}`, facetLabelsOf(resolveLocaleStrings(config).strings.catalog));
                const start = (page - 1) * 24;
                return <ShopPageView products={listing.items.slice(start, start + 24)} categories={categories} total={listing.items.length} page={page} config={config} prefixes={prefixes} basePath={basePath} catalog={catalog} facets={{ listing, pagerBase: listingHref(shopUrl, listing.selection) }} />;
            }
            // Catalog: no availability filter exists, so a `?availability=` query is ignored (§ 3.2.1 SitePage:265).
            const availability = catalog ? undefined : (query.availability || undefined);
            const [{ items: products, total }, categories] = await Promise.all([
                getActiveProducts(config.id, page, 24, availability),
                getAllCategories(config.id)
            ]);
            return <ShopPageView products={products} categories={categories} total={total} page={page} config={config} prefixes={prefixes} basePath={basePath} availability={availability} catalog={catalog} />;
        }

        if (commerce.type === 'search') {
            const q = (query.q || '').trim();
            const pg = parseInt(query.page || "1");
            let products: any[] = [];
            let total = 0;
            if (q) {
                const result = await searchProducts(config.id, q, pg, 24);
                products = result.items;
                total = result.total;
            }
            return <SearchPageView query={q} products={products} total={total} page={pg} config={config} prefixes={prefixes} basePath={basePath} catalog={catalog} cardCategories={await cardCategoriesOf(config)} />;
        }

        // Account, cart, checkout, confirmation, tracking require commerceEnabled
        if (!commerceEnabled) return notFoundHere();

        if (commerce.type === 'account') {
            // Phase 3.2: Account page now fetches sensitive data client-side
            // via secure API routes (/api/account/orders, /api/profile)
            // This removes direct DynamoDB access to customer/order data from SSR
            const resolved = resolveLocaleStrings(config);
            return (
                <AccountPageView
                    currency={config.currency || "USD"}
                    checkoutPrefix={prefixes.checkout || "/checkout"}
                    shopPrefix={prefixes.shop || "/shop"}
                    contentMaxWidth={config.header?.contentPageMaxWidth || "max-w-4xl"}
                    askBirthday={config.askBirthdayOnAccount ?? true}
                    strings={accountPageStrings(resolved)}
                    {...formatLocaleProp(resolved.locale)}
                />
            );
        }

        if (commerce.type === 'cart') {
            const deliveryConfig = await getDeliveryConfig(config.id);
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
            return (
                <CartPageView
                    checkoutPrefix={prefixes.checkout || URL_PREFIX_DEFAULTS.checkout}
                    shopPrefix={prefixes.shop || URL_PREFIX_DEFAULTS.shop}
                    freeDeliveryThreshold={deliveryConfig?.freeDeliveryThreshold || 0}
                    flatShippingCost={deliveryConfig?.flatShippingCost || 0}
                    minimumOrderAmount={deliveryConfig?.minimumOrderAmount || 0}
                    currency={config.currency || "USD"}
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    contentMaxWidth={config.header?.contentMaxWidth || "max-w-6xl"}
                    strings={cartPageStrings(resolveLocaleStrings(config))}
                />
            );
        }

        if (commerce.type === 'checkout') {
            const deliveryConfig = await getDeliveryConfig(config.id);
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
            const resolved = resolveLocaleStrings(config);
            return (
                <CheckoutPageView
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    confirmPrefix={`${prefixes.checkout || URL_PREFIX_DEFAULTS.checkout}${prefixes.checkoutConfirmation || URL_PREFIX_DEFAULTS.checkoutConfirmation}`}
                    cartPrefix={prefixes.cart || URL_PREFIX_DEFAULTS.cart}
                    freeDeliveryThreshold={deliveryConfig?.freeDeliveryThreshold || 0}
                    flatShippingCost={deliveryConfig?.flatShippingCost || 0}
                    currency={config.currency || "USD"}
                    bankTransfer={config.integrations?.bankTransfer}
                    enabledPaymentMethods={config.enabledPaymentMethods}
                    contentMaxWidth={config.header?.contentMaxWidth || "max-w-6xl"}
                    strings={checkoutPageStrings(resolved)}
                    defaultCountry={deliveryConfig?.defaultCountry || ""}
                    availableCountries={deliveryConfig?.availableCountries || []}
                    availableCounties={deliveryConfig?.availableCounties || []}
                    askBirthday={config.askBirthdayOnCheckout ?? true}
                    defaultRegions={getCountryPack(config.countryCode || "EN").address.regions.map(r => r.name)}
                    locale={config.locale || "en-US"}
                    {...formatLocaleProp(resolved.locale)}
                />
            );
        }

        if (commerce.type === 'checkout-confirm') {
            const orderId = query.id;
            const email = query.email;
            let order = null;
            if (orderId && email) {
                order = await getOrderForCustomer(config.id, orderId, email);
            }
            return <ConfirmationPageView order={order} config={config} prefixes={prefixes} basePath={basePath} />;
        }

        if (commerce.type === 'checkout-track') {
            const email = query.email;
            let order = null;
            if (commerce.itemSlug && email) {
                order = await getOrderForCustomer(config.id, commerce.itemSlug, email);
            }
            return <OrderTrackingView order={order} config={config} prefixes={prefixes} basePath={basePath} />;
        }
    }

    // Use homePageSlug for root if configured
    const contentSlug = (slugPath === "/" && config.homePageSlug) ? config.homePageSlug : slugPath;
    const result = await getContentBySlug(config.id, contentSlug);
    if (!result) return notFoundHere();

    // 1. Handle Redirects
    if ('redirect' in result) {
        permanentRedirect(result.redirect);
    }

    const content = result as ContentItem;

    // Status Check
    if (content.status !== 'Published' && !preview) {
        return notFoundHere();
    }

    // --- ACCESS GATEKEEPER ---
    // cache-1: the session arrives as a prop. The cacheable route always passes null,
    // so a cached render of a non-Public page is the "Restricted Access" shell and can
    // never contain another visitor's content. A request that carries a session cookie
    // is routed to the dynamic twin by middleware.ts and gets the real render.
    const policy = content.accessPolicy || { type: 'Public' };
    const isPublic = policy.type === 'Public';

    let isAuthenticated = false;

    if (!isPublic && sessionToken && process.env.NEXTAUTH_SECRET) {
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

    const hasAccess = isPublic || isAuthenticated;

    // --- SCHEMA GENERATOR ---
    const globalSchemaType = config.schemaType || "Organization";
    const pageSchemaType = content.schemaType;

    // 1. Determine the Entity Type
    // If it's the homepage ('/'), we use the Global Type (e.g. SoftwareApplication)
    // If it's an internal page, we default to WebPage unless overridden (e.g. Article)
    const isHome = slugPath === '/';
    const effectiveType = pageSchemaType || (isHome ? globalSchemaType : 'WebPage');
    const canonicalUrl = normalizePageAddressOrKeepRaw(config.domain, slugPath);

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

    // LOCALE-1A: the tenant's locale table for this page's chrome (docs/slices/locale-1.md § 5.3). LANG-1B (lang-1.md § 8.2):
    // the page's language derived from its own address and the tenant's list (§ 5) — an extra language uses its pack.
    const resolved = resolveLocaleStrings(localeInputFor(config, pageLanguageOf(slugPath, config.languages ?? [])));
    const { locale, strings: { site } } = resolved;

    // --- RENDER: ACCESS DENIED ---
    if (!hasAccess) {
        return (
            <>
                <ThemeInjector theme={config.theme} tenantId={config.id} />
                <main className={`${config.header?.contentPageMaxWidth || "max-w-4xl"} mx-auto py-20 px-6 text-center space-y-6`}>
                    <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                        <span className="text-2xl">🔒</span>
                    </div>

                    <h1 className="text-4xl font-bold tracking-tight">{site.restrictedTitle}</h1>

                    <p className="text-xl text-muted-foreground max-w-lg mx-auto">
                        {policy.type === 'LoginRequired' && site.restrictedLoginRequired}
                        {policy.type === 'Purchase' && fillTemplate(site.restrictedSubscription, { currency: String(policy.currency), price: String(policy.price) })}
                    </p>

                    <div className="flex gap-4 justify-center pt-4">
                        <Link
                            href={`/api/auth/signin?callbackUrl=${encodeURIComponent(slugPath)}`}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-10 px-8 hover:opacity-90 transition-opacity"
                        >
                            {site.restrictedLogIn}
                        </Link>

                        {policy.type === 'Purchase' && (
                            <button className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-10 px-8">
                                {site.restrictedPurchase}
                            </button>
                        )}
                    </div>
                </main>
            </>
        );
    }

    // --- SERVER PRE-FETCH FOR PLUGIN BLOCKS --- (CATEGORY-CONTENT-1: the pass is `prepareBlocks`, shared with the category page)
    await prepareBlocks(content.blocks, config, resolved);

    // --- RENDER: CONTENT ---
    const mergedTheme = {
        ...config.theme,
        ...(content.themeOverride || {})
    };

    const hasThemeOverride = content.themeOverride && Object.keys(content.themeOverride).length > 0;

    const cw = config.header?.contentPageMaxWidth || "max-w-4xl";
    const sw = config.header?.contentMaxWidth || "max-w-7xl";

    return (
        <main className={isEditorial(config) ? "py-[var(--section-gap)] relative" : "py-12 relative"}>
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

            {/* LANDING-1: target only the layout's chrome roots, never nav/footer elements inside blocks. */}
            {(content.hideNav || content.hideFooter) && (
                <style dangerouslySetInnerHTML={{
                    __html: `
                        ${content.hideNav ? '.site-top-bar, .site-commerce-bar, .site-navbar { display: none !important; }' : ''}
                        ${content.hideFooter ? '.site-footer { display: none !important; }' : ''}
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

            {!content.hideSharing && !config.hideSocialSharing && (
                <div className={`${cw} mx-auto px-6`}>
                    <SocialShare title={content.title} url={canonicalUrl} strings={{ shareLabel: site.shareLabel, shareOnX: site.shareOnX, shareOnLinkedIn: site.shareOnLinkedIn, shareOnFacebook: site.shareOnFacebook, shareByEmail: site.shareByEmail, shareCopyLink: site.shareCopyLink }} />
                </div>
            )}

            {/* LOCALE-1C: the block texts (§ 5.3) — on a catalog site without the stock text (CATALOG-MODE-1 § 3.2.6). */}
            <RenderBlocks blocks={content.blocks} tenantId={config.id} contentMaxWidth={cw} siteMaxWidth={sw} basePath={basePath}
                strings={blockStrings(resolved, { catalogMode: isCatalogMode(config) })} />

            {/* LOCALE-1A: `dateLocale` only for a non-en-US tenant — an en-US tenant keeps the runtime default (§ 16.2
                item 4). A spread, not `dateLocale={undefined}`: an undefined prop would still be serialised into the
                RSC payload ("$undefined") and change an en-US page's bytes. */}
            <CommentsSection pageId={content.nodeId} mode={content.commentsMode} contentMaxWidth={cw}
                strings={{ commentsPostFailed: site.commentsPostFailed, commentsHeading: site.commentsHeading, commentsEmpty: site.commentsEmpty, commentsClosed: site.commentsClosed, commentsPlaceholder: site.commentsPlaceholder, commentsPost: site.commentsPost, commentsJoin: site.commentsJoin, commentsSignIn: site.commentsSignIn }}
                {...(locale !== "en-US" ? { dateLocale: locale } : {})} />
        </main>
    );
}
