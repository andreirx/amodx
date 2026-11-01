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
import { getTenantConfig, getContentBySlug, getPosts, getProductBySlug, getCategoryBySlug, getProductsByCategory, getAllCategories, getActiveProducts, getCatalogListing, searchProducts, getDeliveryConfig, getOrderForCustomer, getProductReviews, getSiteReviews } from "@/lib/dynamo";
import { reviewAssetCdnBase, toPublicReviewPhotos, toCarouselReviewItems } from "@/lib/review-images";
import { RenderBlocks } from "@/components/RenderBlocks";
import { permanentRedirect } from "next/navigation";
import { notFoundOrHandoff } from "@/lib/not-found-handoff";
import { Metadata } from "next";
import { ContentItem, Product, Category, URL_PREFIX_DEFAULTS, getCountryPack, isCatalogMode, catalogListingPath, resolveLocaleStrings, fillTemplate, selectPluralText, type LocaleStrings, type ResolvedLocaleStrings, type FacetLabels } from "@amodx/shared";
import Link from "next/link";
import { CommentsSection } from "@/components/CommentsSection";
import { ThemeInjector } from "@/components/ThemeInjector";
import { SocialShare } from "@/components/SocialShare";
import Script from "next/script";
import { CartPageView, type CartPageStrings } from "@/components/CartPageView";
import { CheckoutPageView, type CheckoutPageStrings } from "@/components/CheckoutPageView";
import { AddToCartButton, type AddToCartStrings } from "@/components/AddToCartButton";
import { FBPurchaseEvent } from "@/components/FBPurchaseEvent";
import { ProductImageGallery } from "@/components/ProductImageGallery";
import { AccountPageView, type AccountPageStrings } from "@/components/AccountPageView";
import { SearchBar, type SearchBarLabels } from "@/components/SearchBar";
import { sanitizeHtml } from "@/lib/sanitize";
import { CelebrationWrapper } from "@/components/CelebrationWrapper";
import { InterestToggle, InterestListPage, type InterestListStrings, type InterestToggleStrings } from "@/components/InterestShortlist";
import { buildFacetListing, listingHref, utf8Bytes, HREF_BUDGET, type FacetListing, type FacetValueView } from "@amodx/shared";
import { createElement, Fragment, type ReactNode } from "react";

// NEW: Auth Imports — signature verification only, no cookie access from this module.
import { decode } from "next-auth/jwt";

/** Flattened query string. Multi-value params collapse to their first value. */
export type SiteQuery = Record<string, string | undefined>;

/**
 * Everything the page render needs that varies per request.
 * Plain data only — no framework objects cross this boundary.
 */
export type SitePageInput = {
    siteId: string;
    slug?: string[];
    /** Show Draft / non-active items. Always false on the cacheable route. */
    preview: boolean;
    /** URL prefix for generated links, e.g. "/_site/<tenantId>". "" on the cacheable route. */
    basePath: string;
    /** Raw NextAuth JWT from the request cookie. Always null on the cacheable route. */
    sessionToken: string | null;
    /** Resolved query string. Always {} on the cacheable route. */
    query: SiteQuery;
    /**
     * True on the ISR route, false on the dynamic twin. Only affects how a not-found
     * outcome is delivered — see `lib/not-found-handoff.ts`. Not derivable from the
     * other props: a twin request can legitimately arrive with an empty query (session
     * cookie, `/_site/` preview).
     */
    cacheable: boolean;
};

/** Normalizes Next's searchParams into the plain `SiteQuery` DTO. */
export function toSiteQuery(sp: Record<string, string | string[] | undefined>): SiteQuery {
    const out: SiteQuery = {};
    for (const [k, v] of Object.entries(sp)) out[k] = Array.isArray(v) ? v[0] : v;
    return out;
}

// ── LOCALE-1D (docs/slices/locale-1.md § 5.2, § 5.3): the texts of the commerce-only views, from the tenant's locale
// table (the resolver), each view getting only the keys it renders. Pattern F keys (§ 5.2: a stored "" falls back to the
// language default, as the English literals did before) are resolved here, so the views render what they receive.

/** `override || language default` — the F rule of § 5.2, for the listed keys of one part. */
function withFallback<T extends Record<string, unknown>, K extends keyof T>(strings: T, defaults: T, keys: readonly K[]): Pick<T, K> {
    const out = {} as Pick<T, K>;
    for (const k of keys) out[k] = (strings[k] || defaults[k]) as T[K];
    return out;
}

/** Copies the listed keys (pattern D: a stored "" renders empty). */
function pick<T extends Record<string, unknown>, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
    const out = {} as Pick<T, K>;
    for (const k of keys) out[k] = source[k];
    return out;
}

function cartPageStrings({ strings }: ResolvedLocaleStrings): CartPageStrings {
    return pick(strings.commerce, ["emptyCart", "emptyCartMessage", "continueShopping", "shoppingCart", "orderSummary", "remove", "couponCode",
        "apply", "subtotal", "discount", "shipping", "freeShipping", "total", "freeDeliveryFrom", "addMoreForFreeDelivery", "minimumOrder",
        "proceedToCheckout", "invalidCoupon", "couponValidateFailed"]);
}

function checkoutPageStrings({ strings, defaults }: ResolvedLocaleStrings): CheckoutPageStrings {
    return {
        ...pick(strings.commerce, ["checkout", "email", "phone", "phonePlaceholder", "birthdayHint", "shippingAddress", "country", "selectCountry",
            "streetAddress", "city", "county", "selectCounty", "postalCode", "deliveryNotes", "deliveryNotesPlaceholder", "preferredDeliveryDate",
            "paymentMethod", "cashOnDelivery", "cashOnDeliveryDesc", "bankTransfer", "bankTransferTo", "orderSummary", "subtotal", "discount",
            "shipping", "freeShipping", "total", "placingOrder", "placeOrder", "termsAgreement", "emptyCart", "checkoutEmptyMessage", "orderFailed",
            "orderFailedStatus", "deliveryDateSelected", "deliveryDatesLoading", "calendarMo", "calendarTu", "calendarWe", "calendarTh",
            "calendarFr", "calendarSa", "calendarSu"]),
        // The 14 F sites of CheckoutPageView (§ 5.2).
        ...withFallback(strings.commerce, defaults.commerce, ["billingDetails", "firstName", "lastName", "birthday", "orderAsCompany", "companyName",
            "taxId", "taxIdPlaceholder", "registrationNumber", "registrationNumberPlaceholder", "vatNumber", "vatNumberPlaceholder",
            "useSameAsShipping", "billingAddress"]),
        errorTryAgain: strings.site.errorTryAgain,
    };
}

function accountPageStrings({ strings, defaults }: ResolvedLocaleStrings): AccountPageStrings {
    return {
        ...pick(strings.commerce, ["myAccount", "accountSignInPrompt", "signInWithGoogle", "signOut", "profileHeading", "edit", "accountName", "email",
            "birthdayHint", "save", "saving", "cancel", "loyaltyPoints", "defaultAddress", "orderHistory", "noOrdersYet", "startShopping",
            "orderStatusPlaced", "orderStatusConfirmed", "orderStatusPrepared", "orderStatusShipped", "orderStatusDelivered",
            "orderStatusCancelled", "orderStatusAnnulled"]),
        // The F sites of AccountPageView (§ 5.2).
        ...withFallback(strings.commerce, defaults.commerce, ["phone", "phonePlaceholder", "birthday"]),
    };
}

/** The add-to-cart control's texts: the five button texts are F sites (§ 5.2); the two errors and the select placeholder D. */
function addToCartStrings({ strings, defaults }: ResolvedLocaleStrings): AddToCartStrings {
    return {
        ...withFallback(strings.commerce, defaults.commerce, ["addToCart", "addedToCart", "viewCart", "outOfStock", "variantUnavailable"]),
        ...pick(strings.commerce, ["personalizationRequired", "variantRequired"]),
        formSelectPlaceholder: strings.site.formSelectPlaceholder,
    };
}

/** The tenant's normalised locale as `formatLocale` — ONLY when it is not en-US (§ 16.2 item 4: an en-US tenant keeps
 *  the formatter defaults it had). A spread, so an en-US page's props stay byte-identical (no "$undefined"). */
function formatLocaleProp(locale: string): { formatLocale?: string } {
    return locale !== "en-US" ? { formatLocale: locale } : {};
}

/**
 * LOCALE-1D (§ 5.1, "interpolate"): a table template split at its `{placeholders}` into React children — each text
 * segment, and each value (a text, a number or an element) as its own child; empty segments are dropped; an unknown
 * placeholder stays as written. Used where a sentence wraps a value in markup ("You will pay <strong>…</strong> …") or
 * where today's JSX renders the value as its own text node ("Order {number}"): the children equal the JSX they replace,
 * so an en-US page's HTML and payload stay byte-identical. Returned as a fragment with its children as arguments (static
 * children: no list keys needed). Rejected: `fillTemplate` (merges the value into the text, changing the bytes, and
 * cannot hold markup).
 */
function interpolateNodes(template: string, values: Record<string, ReactNode>): ReactNode {
    const parts = template.split(/\{([A-Za-z0-9_]+)\}/)
        .map((piece, i) => (i % 2 === 0 ? piece : Object.prototype.hasOwnProperty.call(values, piece) ? values[piece] : `{${piece}}`))
        .filter((part) => part !== "");
    return createElement(Fragment, null, ...parts);
}

/**
 * LOCALE-1B (docs/slices/locale-1.md § 5.2 row F): the SearchBar's four texts — the tenant override when it is a
 * non-empty text, else the language default (a stored "" falls back, as the English literals did before).
 * Key order = the order these four had before LOCALE-1B (the RSC payload carries the object).
 */
function searchBarLabels({ strings, defaults }: ResolvedLocaleStrings): SearchBarLabels {
    const s = strings.commerce, d = defaults.commerce;
    return {
        searchButton: s.searchButton || d.searchButton,
        searchNoResults: s.searchNoResults || d.searchNoResults,
        searchSearching: s.searchSearching || d.searchSearching,
        viewAllResults: s.viewAllResults || d.viewAllResults,
    };
}

/** LOCALE-1B (§ 6.3): the headings of the two fixed facets, from the tenant's catalog texts. */
function facetLabelsOf(catalog: LocaleStrings["catalog"]): FacetLabels {
    return { producer: catalog.facetProducer, variantDefault: catalog.facetVariantDefault };
}

/** LOCALE-1B: a fresh object per toggle (the RSC encoder outlines an object it meets twice; one per element keeps each
 *  toggle's props inline, as before). */
function interestToggleStrings(catalog: LocaleStrings["catalog"]): InterestToggleStrings {
    return { interestAdd: catalog.interestAdd, interestAdded: catalog.interestAdded, interestListFull: catalog.interestListFull };
}

/** LOCALE-1B: the list page's texts (only the keys it uses, § 5.3). */
function interestListStrings(c: LocaleStrings["catalog"]): InterestListStrings {
    return {
        interestListTitle: c.interestListTitle, interestBrowse: c.interestBrowse, interestSentTitle: c.interestSentTitle,
        interestSentBody: c.interestSentBody, interestExcludedIntro: c.interestExcludedIntro, interestEmpty: c.interestEmpty,
        interestAdd: c.interestAdd, interestErrorNoneAvailable: c.interestErrorNoneAvailable, interestErrorInvalid: c.interestErrorInvalid,
        interestErrorCheck: c.interestErrorCheck, interestErrorAllGone: c.interestErrorAllGone, interestErrorSend: c.interestErrorSend,
        interestErrorNetwork: c.interestErrorNetwork, interestPreviouslySent: c.interestPreviouslySent,
        interestContactHeading: c.interestContactHeading, interestName: c.interestName, interestEmail: c.interestEmail,
        interestPhone: c.interestPhone, interestMessage: c.interestMessage, interestSubmit: c.interestSubmit,
        interestRowExpired: c.interestRowExpired, interestRowUnavailable: c.interestRowUnavailable,
        interestRowOptionGone: c.interestRowOptionGone, interestCollection: c.interestCollection, interestRemove: c.interestRemove,
    };
}

// Commerce prefix matching helper
type CommerceMatch = { type: 'product' | 'category' | 'shop' | 'cart' | 'checkout' | 'checkout-confirm' | 'checkout-track' | 'account' | 'search'; itemSlug?: string };

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
    if (slugPath === (prefixes.search || "/search")) return { type: 'search' };
    return null;
}

/** CAT-INTEREST-1: the interest-list path of a tenant (`urlPrefixes.interest`, default "/lista-mea"). Catalog sites only. */
function interestPrefix(config: any): string {
    return config.urlPrefixes?.interest || URL_PREFIX_DEFAULTS.interest;
}

export async function buildSitePageMetadata({ siteId, slug, query }: Pick<SitePageInput, "siteId" | "slug" | "query">): Promise<Metadata> {
    const config = await getTenantConfig(siteId);
    if (!config) return {};

    const slugPath = slug ? "/" + slug.join("/") : "/";
    const canonicalUrl = `https://${config.domain}${slugPath === '/' ? '' : slugPath}`;

    // LOCALE-1B: the tenant's locale table for the titles below (docs/slices/locale-1.md § 6.2, § 6.3).
    const { commerce: texts, catalog: catalogTexts } = resolveLocaleStrings(config).strings;

    // CAT-INTEREST-1: the interest-list page of a catalog site (personal, client-rendered: not indexed).
    if (isCatalogMode(config) && slugPath === interestPrefix(config)) {
        return { title: catalogTexts.interestListTitle, robots: { index: false } };
    }

    // Check commerce routes first
    const commerce = matchCommercePrefix(slugPath, config.urlPrefixes);
    if (commerce) {
        if (commerce.type === 'product' && commerce.itemSlug) {
            const product = await getProductBySlug(config.id, commerce.itemSlug);
            // CAT-IMAGE-GATE-1: a catalog site's hidden product takes the missing-product path here too (no title leak).
            if (product && !(isCatalogMode(config) && (product as any).status !== 'active')) return {
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
                description: category.seoDescription || fillTemplate(texts.metaCategoryDescription, { category: category.name }),
                metadataBase: new URL(`https://${config.domain}`),
                openGraph: { title: category.name, description: category.seoDescription, images: category.imageLink ? [{ url: category.imageLink }] : [], url: canonicalUrl, siteName: config.name },
                alternates: { canonical: canonicalUrl }
            };
        }
        if (commerce.type === 'shop') return {
            title: fillTemplate(texts.metaShopTitle, { site: config.name }),
            metadataBase: new URL(`https://${config.domain}`),
            alternates: { canonical: canonicalUrl }
        };
        if (commerce.type === 'search') {
            // `q` is empty on the cacheable route (query is always {}); real searches
            // carry a query string and are served by the dynamic twin.
            const q = query.q || '';
            return {
                title: q ? fillTemplate(texts.metaSearchQueryTitle, { query: q, site: config.name }) : fillTemplate(texts.metaSearchTitle, { site: config.name }),
                metadataBase: new URL(`https://${config.domain}`),
                robots: { index: false },
            };
        }
        // LOCALE-1D: the four commerce-only titles (§ 6.2).
        if (commerce.type === 'cart') return { title: fillTemplate(texts.metaCartTitle, { site: config.name }), metadataBase: new URL(`https://${config.domain}`) };
        if (commerce.type === 'checkout') return { title: fillTemplate(texts.metaCheckoutTitle, { site: config.name }), metadataBase: new URL(`https://${config.domain}`) };
        if (commerce.type === 'checkout-confirm') return { title: fillTemplate(texts.metaOrderConfirmationTitle, { site: config.name }), metadataBase: new URL(`https://${config.domain}`) };
        if (commerce.type === 'checkout-track') return { title: fillTemplate(texts.metaOrderTrackingTitle, { site: config.name }), metadataBase: new URL(`https://${config.domain}`) };
    }

    // Content page metadata - use homePageSlug for root if configured
    const contentSlug = (slugPath === "/" && config.homePageSlug) ? config.homePageSlug : slugPath;
    const result = await getContentBySlug(config.id, contentSlug);
    if (!result || 'redirect' in result) return { title: config.name };

    const content = result as ContentItem;
    return {
        title: content.seoTitle || content.title || config.name,
        description: content.seoDescription,
        metadataBase: new URL(`https://${config.domain}`),
        openGraph: {
            title: content.seoTitle || content.title,
            // BACKEND-CONTRACT-1: a cleared description is stored as `null`; Next's openGraph type is
            // `string | undefined`, so `null` means "omit the tag".
            description: content.seoDescription ?? undefined,
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
            const page = parseInt(query.page || "1");
            // CAT-FACETS-1: a catalog site lists the category from its `PRODUCT#` items and filters it (`?f=`).
            if (catalog) {
                const path = catalogListingPath(prefixes, category.slug);
                const listing = buildFacetListing(await getCatalogListing(config.id, category.id), query.f, `${basePath}${path}`, facetLabelsOf(resolveLocaleStrings(config).strings.catalog));
                const start = (page - 1) * 24;
                return <CategoryPageView category={category} products={listing.items.slice(start, start + 24)} total={listing.items.length} page={page} config={config} prefixes={prefixes} basePath={basePath} catalog={catalog} facets={{ listing, pagerBase: listingHref(path, listing.selection) }} />;
            }
            const { items: products, total } = await getProductsByCategory(config.id, category.id, page, 24);
            return <CategoryPageView category={category} products={products} total={total} page={page} config={config} prefixes={prefixes} basePath={basePath} catalog={catalog} />;
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
            return <SearchPageView query={q} products={products} total={total} page={pg} config={config} prefixes={prefixes} basePath={basePath} catalog={catalog} />;
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
                    checkoutPrefix={prefixes.checkout || "/comanda"}
                    shopPrefix={prefixes.shop || "/magazin"}
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
                    confirmPrefix={`${prefixes.checkout || "/comanda"}/confirmare`}
                    cartPrefix={prefixes.cart || "/cos"}
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

    // LOCALE-1A: the tenant's locale table for this page's chrome (docs/slices/locale-1.md § 5.3).
    const { locale, strings: { site } } = resolveLocaleStrings(config);

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

    // --- SERVER PRE-FETCH FOR PLUGIN BLOCKS ---
    // Inject server-fetched data into block attrs before rendering.
    // Eliminates client-side browser→API Gateway fetches which are fragile
    // (CORS, missing env vars, silent failures). Same pattern for all plugins.
    if (content.blocks && Array.isArray(content.blocks)) {
        await Promise.all(content.blocks.map(async (block: any) => {
            if (block.type === 'postGrid') {
                const tag = block.attrs.filterTag;
                let limit = 6;
                if (block.attrs.limit !== undefined && block.attrs.limit !== null && block.attrs.limit !== "") {
                    limit = parseInt(block.attrs.limit);
                }
                const posts = await getPosts(config.id, tag, limit);
                block.attrs.prefetchedPosts = posts;
                block.attrs.serverDomain = config.domain;
            }

            if (block.type === 'categoryShowcase') {
                const slug = block.attrs.categorySlug;
                if (slug) {
                    const category = await getCategoryBySlug(config.id, slug);
                    if (category) {
                        const limit = block.attrs.limit || 4;
                        const { items } = await getProductsByCategory(config.id, category.id, 1, limit);
                        block.attrs.prefetchedProducts = items;
                    }
                }
                // CATALOG-MODE-1 (§ 3.2.6): on EVERY showcase block of a catalog tenant — whether or not the lookup
                // above succeeded. `_catalogMode` is the mechanism: the plugin emits no price, currency or stock overlay
                // for any product source (this prefetch, stale authored attrs, its browser fallback fetch). Defence in
                // depth: the block is a client component, so its attrs travel in the RSC payload — whatever their
                // source, catalog `prefetchedProducts` keep display fields only (no currency, availability, tiers).
                // Neither key changes for a non-catalog tenant, so their attrs and RSC payloads do not change.
                if (isCatalogMode(config)) {
                    block.attrs._catalogMode = true;
                    if (Array.isArray(block.attrs.prefetchedProducts)) block.attrs.prefetchedProducts = block.attrs.prefetchedProducts.map((p: any) => ({ id: p.id, title: p.title, slug: p.slug, ...(p.imageLink !== undefined ? { imageLink: p.imageLink } : {}) }));
                }
                // Inject tenant-resolved URL prefixes so the component doesn't
                // need to read from document meta tags (unavailable during SSR).
                const resolvedPrefixes = config.urlPrefixes || URL_PREFIX_DEFAULTS;
                block.attrs._productPrefix = resolvedPrefixes.product || "/product";
                block.attrs._categoryPrefix = resolvedPrefixes.category || "/category";
            }

            // rev-4: a reviews carousel in a DB-backed scope is fed approved System-A reviews here
            // (server-side), REPLACING any authored `items`. Photo assetKeys are resolved to raw
            // asset URLs on the SERVER: the `UPLOADS_CDN_URL` env var and the key→URL resolution stay
            // server-side, while the RESOLVED public URL (base included) ships to the client in the
            // raw `<img src>`, exactly as product `imageLink`s reach the client already-resolved.
            // Both are plain cacheable-route DB reads (getSiteReviews / getProductReviews), NOT
            // dynamic APIs.
            //   • site-reviews          — the tenant's approved SITE-scope (SITEREVIEW#) reviews.
            //   • product-reviews-by-id — a specific product's approved reviews, by `productId` attr.
            if (block.type === 'reviewsCarousel' && block.attrs.scope === 'site-reviews') {
                const { items } = await getSiteReviews(config.id);
                block.attrs.items = toCarouselReviewItems(items, reviewAssetCdnBase());
            }
            if (block.type === 'reviewsCarousel' && block.attrs.scope === 'product-reviews-by-id') {
                const productId = block.attrs.productId;
                const { items } = productId
                    ? await getProductReviews(config.id, productId)
                    : { items: [] as any[] };
                block.attrs.items = toCarouselReviewItems(items, reviewAssetCdnBase());
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
    const sw = config.header?.contentMaxWidth || "max-w-7xl";

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

            {!content.hideSharing && !config.hideSocialSharing && (
                <div className={`${cw} mx-auto px-6`}>
                    <SocialShare title={content.title} strings={{ shareLabel: site.shareLabel, shareOnX: site.shareOnX, shareOnLinkedIn: site.shareOnLinkedIn, shareOnFacebook: site.shareOnFacebook, shareByEmail: site.shareByEmail, shareCopyLink: site.shareCopyLink }} />
                </div>
            )}

            <RenderBlocks blocks={content.blocks} tenantId={config.id} contentMaxWidth={cw} siteMaxWidth={sw} basePath={basePath} />

            {/* LOCALE-1A: `dateLocale` only for a non-en-US tenant — an en-US tenant keeps the runtime default (§ 16.2
                item 4). A spread, not `dateLocale={undefined}`: an undefined prop would still be serialised into the
                RSC payload ("$undefined") and change an en-US page's bytes. */}
            <CommentsSection pageId={content.nodeId} mode={content.commentsMode} contentMaxWidth={cw}
                strings={{ commentsPostFailed: site.commentsPostFailed, commentsHeading: site.commentsHeading, commentsEmpty: site.commentsEmpty, commentsClosed: site.commentsClosed, commentsPlaceholder: site.commentsPlaceholder, commentsPost: site.commentsPost, commentsJoin: site.commentsJoin, commentsSignIn: site.commentsSignIn }}
                {...(locale !== "en-US" ? { dateLocale: locale } : {})} />
        </main>
    );
}

// --- COMMERCE PAGE COMPONENTS ---

/**
 * `catalog` (CATALOG-MODE-1): no price line and no availability badge — not emitted, not hidden by CSS.
 * CAT-INTEREST-1: on a catalog site the card is followed by the "Mă interesează" toggle (a button may not sit inside
 * the card's link); any other site renders the link alone, exactly as before. LOCALE-1B: `catalogStrings` = the
 * tenant's catalog texts (the toggle's three texts are taken from it per card).
 */
function ProductCard({ product, productPrefix, basePath = "", catalog = false, tenantId, catalogStrings }: { product: any; productPrefix: string; basePath?: string; catalog?: boolean; tenantId: string; catalogStrings: LocaleStrings["catalog"] }) {
    const card = (
        <Link href={`${basePath}${productPrefix}/${product.slug}`} className="group block">
            <div className="aspect-square bg-muted rounded-lg overflow-hidden mb-3">
                {product.imageLink ? (
                    <img src={product.imageLink} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-4xl">🛍</div>
                )}
            </div>
            <h3 className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">{product.title}</h3>
            {!catalog && <div className="mt-1">
                {product.salePrice ? (
                    <div className="flex items-center gap-2">
                        <span className="text-red-600 font-bold">{product.salePrice} {product.currency}</span>
                        <span className="line-through text-muted-foreground text-sm">{product.price}</span>
                    </div>
                ) : (
                    <span className="font-semibold">{product.price} {product.currency}</span>
                )}
            </div>}
            {!catalog && product.availability !== 'in_stock' && (
                <span className="text-xs text-amber-600 mt-1 block capitalize">{(product.availability || '').replace('_', ' ')}</span>
            )}
        </Link>
    );
    if (!catalog) return card;
    return (
        <div>
            {card}
            <InterestToggle tenantId={tenantId} productId={product.id} title={product.title} slug={product.slug} {...(product.imageLink ? { imageLink: product.imageLink } : {})} strings={interestToggleStrings(catalogStrings)} />
        </div>
    );
}

/**
 * `maxHrefBytes` (CAT-FACETS-1, catalog listings only): a pager link longer than this many UTF-8 bytes is not
 * emitted (spec § 5.1 invariant, measured on the final string). Absent → every link is emitted, as before.
 */
function Pagination({ page, total, limit, baseUrl, basePath = "", maxHrefBytes, strings }: { page: number; total: number; limit: number; baseUrl: string; basePath?: string; maxHrefBytes?: number; strings: Pick<LocaleStrings["site"], "paginationPrevious" | "paginationPageOf" | "paginationNext"> }) {
    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) return null;
    const sep = baseUrl.includes('?') ? '&' : '?';
    const fullBaseUrl = `${basePath}${baseUrl}`;
    const fits = (href: string) => maxHrefBytes === undefined || utf8Bytes(href) <= maxHrefBytes;

    return (
        <div className="flex items-center justify-center gap-2 mt-12">
            {page > 1 && fits(`${fullBaseUrl}${sep}page=${page - 1}`) && (
                <Link href={`${fullBaseUrl}${sep}page=${page - 1}`} className="px-4 py-2 border rounded-md text-sm hover:bg-muted">{strings.paginationPrevious}</Link>
            )}
            <span className="text-sm text-muted-foreground px-4">{fillTemplate(strings.paginationPageOf, { page, total: totalPages })}</span>
            {page < totalPages && fits(`${fullBaseUrl}${sep}page=${page + 1}`) && (
                <Link href={`${fullBaseUrl}${sep}page=${page + 1}`} className="px-4 py-2 border rounded-md text-sm hover:bg-muted">{strings.paginationNext}</Link>
            )}
        </div>
    );
}

/**
 * CATALOG-MODE-1 (CM-D4 amended) — the catalog variant presenter: each variant group as a read-only set of options
 * (label + image), with no price and no availability. Rendered only on a catalog site, where it is the only
 * reader of `variants` (`AddToCartButton` is commerce-only). An imported product has exactly one group.
 *
 * Server-rendered, no JavaScript: each option is a native radio input, so the visitor's choice lives in the
 * form state. That is how the selected option is exposed to the interest control (`cat-interest-1`): the checked
 * input of the group named `catalog-option-<group id>`, whose value is the option label.
 */
function CatalogVariantPresenter({ variants }: { variants: { id: string; name: string; options?: { value: string; imageLink?: string }[] }[] }) {
    const groups = variants.filter((group) => (group.options || []).length > 0);
    if (groups.length === 0) return null;
    return (
        <div className="space-y-6">
            {groups.map((group, gi) => (
                <fieldset key={group.id || gi} className="space-y-3" data-catalog-variants={group.id}>
                    <legend className="text-sm font-medium mb-2">{group.name}</legend>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {(group.options || []).map((option, oi) => (
                            <label key={oi} className="cursor-pointer">
                                <input type="radio" name={`catalog-option-${group.id || gi}`} value={option.value} className="peer sr-only" />
                                <span className="block rounded-lg border-2 border-border overflow-hidden peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                                    {option.imageLink ? (
                                        <img src={option.imageLink} alt={option.value} loading="lazy" className="aspect-square w-full object-cover" />
                                    ) : (
                                        <span className="aspect-square w-full flex items-center justify-center bg-muted text-muted-foreground text-xs">—</span>
                                    )}
                                    <span className="block px-2 py-1 text-xs text-center">{option.value}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            ))}
        </div>
    );
}

/**
 * CAT-INTEREST-1: the product-page toggle's props. The option comes from the presenter's FIRST group with options
 * (an imported product has exactly one group) — the radio group named as `CatalogVariantPresenter` names it.
 */
function interestToggleProps(tenantId: string, product: any) {
    const groups = (product.variants || []).filter((group: any) => (group.options || []).length > 0);
    const group = groups[0];
    return {
        tenantId, productId: product.id, title: product.title, slug: product.slug || "",
        ...(product.imageLink ? { imageLink: product.imageLink } : {}),
        ...(group ? {
            optionGroupName: `catalog-option-${group.id || 0}`,
            options: (group.options || []).map((o: any) => (o.imageLink ? { value: o.value, imageLink: o.imageLink } : { value: o.value })),
        } : {}),
    };
}

/**
 * CATALOG-MODE-1 (F-1): the product's `attributes` (e.g. unit, packaging, minimum order) as a key/value list.
 * CAT-IMPORT-PROFILE-1B (design § 2.5): a key may be stored more than once (a value per option, or a split list);
 * such a key is ONE row, at the place of its first entry, with its values in stored order joined by ", ". A product
 * whose keys are all distinct renders exactly the rows it rendered before.
 */
function ProductAttributes({ attributes }: { attributes: { key: string; value: string }[] }) {
    const rows = new Map<string, string[]>();
    for (const a of attributes) {
        if (!a.key || !a.value) continue;
        const values = rows.get(a.key);
        if (values) values.push(a.value);
        else rows.set(a.key, [a.value]);
    }
    if (rows.size === 0) return null;
    return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm border-t pt-4">
            {[...rows].map(([key, values], i) => (
                <div key={i} className="contents">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="font-medium">{values.join(", ")}</dd>
                </div>
            ))}
        </dl>
    );
}

function ProductPageView({ product, config, prefixes, reviews, commerceEnabled = false, catalog = false, basePath = "", categories = [], categoryPaths = [], rawCategoryIds = [] }: { product: any; config: any; prefixes: any; reviews?: { items: any[]; averageRating: number; totalReviews: number }; commerceEnabled?: boolean; catalog?: boolean; basePath?: string; categories?: any[]; categoryPaths?: { category: any; parents: any[] }[]; rawCategoryIds?: string[] }) {
    // LOCALE-1A: site chrome; LOCALE-1B: the commerce texts of the product page and the catalog texts; LOCALE-1D: the add-to-cart texts.
    const resolved = resolveLocaleStrings(config);
    const { site, commerce: strings, catalog: catalogStrings } = resolved.strings;
    const siteWidth = config.header?.contentMaxWidth || "max-w-6xl";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const jsonLd: any = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": product.title,
        "description": product.description,
        "image": product.imageLink,
        // CATALOG-MODE-1: a catalog product is a `Product` with no `offers` key (no price, no availability).
        ...(catalog ? {} : {
            "offers": {
                "@type": "Offer",
                "price": product.salePrice || product.price,
                "priceCurrency": product.currency || "USD",
                "availability": product.availability === 'in_stock' ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
            }
        })
    };
    if (reviews && reviews.totalReviews > 0) {
        jsonLd.aggregateRating = {
            "@type": "AggregateRating",
            "ratingValue": reviews.averageRating,
            "reviewCount": reviews.totalReviews,
        };
    }

    return (
        <>
            {config.searchBar?.enabled && (
                <SearchBar
                    placeholder={config.searchBar?.placeholder || strings.searchPlaceholder}
                    searchPrefix={prefixes.search || "/search"}
                    productPrefix={prefixes.product || "/product"}
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    contentMaxWidth={siteWidth}
                    labels={searchBarLabels(resolved)}
                    {...(catalog ? { showPrices: false } : {})}
                />
            )}
            <main className={`${siteWidth} mx-auto py-12 px-6`}>
                <Script id="product-schema" type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

            {/* Breadcrumbs */}
            <nav className="text-sm text-muted-foreground mb-8">
                <Link href={`${basePath}/`} className="hover:text-primary">{site.breadcrumbHome}</Link>
                <span className="mx-2">/</span>
                <Link href={`${basePath}${prefixes.shop || "/magazin"}`} className="hover:text-primary">{strings.shopTitle}</Link>
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
                    {!catalog && <div className="text-2xl">
                        {product.salePrice ? (
                            <div className="flex items-center gap-3">
                                <span className="font-bold text-red-600">{product.salePrice} {product.currency}</span>
                                <span className="line-through text-muted-foreground text-lg">{product.price} {product.currency}</span>
                            </div>
                        ) : (
                            <span className="font-bold">{product.price} {product.currency}</span>
                        )}
                    </div>}

                    {/* Volume Pricing */}
                    {!catalog && product.volumePricing?.length > 0 && (
                        <div className="border rounded-lg p-4">
                            <p className="text-sm font-medium mb-2">{strings.volumePricing}</p>
                            <div className="space-y-1">
                                {product.volumePricing.map((tier: any, i: number) => (
                                    <div key={i} className="flex justify-between text-sm">
                                        <span>{tier.minQuantity}+ {strings.units}</span>
                                        <span className="font-medium">{tier.price} {product.currency}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Availability */}
                    {!catalog && <div>
                        {product.availability === 'in_stock' ? (
                            <span className="inline-flex items-center gap-1.5 text-green-600 text-sm font-medium">
                                <span className="w-2 h-2 bg-green-500 rounded-full" /> {strings.inStock}
                            </span>
                        ) : product.availability === 'preorder' ? (
                            <span className="text-amber-600 text-sm font-medium">{strings.preOrder}</span>
                        ) : (
                            <span className="text-red-600 text-sm font-medium">{strings.outOfStock}</span>
                        )}
                    </div>}

                    {/* Categories as clickable badges */}
                    {categories.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                            {categories.map((cat: any) => (
                                <Link
                                    key={cat.id}
                                    href={`${basePath}${prefixes.category || "/category"}/${cat.slug}`}
                                    className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                >
                                    {cat.name}
                                </Link>
                            ))}
                        </div>
                    ) : rawCategoryIds.length > 0 ? (
                        /* Fallback: show raw category IDs as links (assuming slug = id) */
                        <div className="flex flex-wrap items-center gap-2">
                            {rawCategoryIds.map((cid: string) => (
                                <Link
                                    key={cid}
                                    href={`${basePath}${prefixes.category || "/category"}/${cid}`}
                                    className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                                >
                                    {cid.replace(/-/g, ' ')}
                                </Link>
                            ))}
                        </div>
                    ) : null}

                    {/* Short Description */}
                    {product.description && (
                        <div
                            className="text-muted-foreground prose prose-sm max-w-none"
                            dangerouslySetInnerHTML={{
                                __html: sanitizeHtml(
                                    product.description
                                        .replace(/\\n/g, '<br>')
                                        .replace(/&nbsp;/g, ' ')
                                )
                            }}
                        />
                    )}

                    {/* Digital product: Paddle button — always, regardless of commerceEnabled */}
                    {!catalog && product.paymentLinkId && (
                        <a
                            href="#"
                            className="paddle_button inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-11 px-8 hover:opacity-90 transition-opacity"
                            data-product={product.paymentLinkId}
                        >
                            {strings.buyNow}
                        </a>
                    )}

                    {/* Physical product: Add to Cart — only when commerceEnabled AND not a digital product.
                        Catalog site (never commerceEnabled): this slot holds the variant presenter and the attributes. */}
                    {catalog ? (
                        <>
                            {/* CAT-INTEREST-1 (review-0 F4): keyed by product, so a client navigation to another product
                                mounts fresh radio inputs and a fresh toggle — no choice carries over between products. */}
                            <CatalogVariantPresenter key={`presenter-${product.id}`} variants={product.variants || []} />
                            <InterestToggle key={`interest-${product.id}`} variant="page" {...interestToggleProps(config.id, product)} strings={interestToggleStrings(catalogStrings)} />
                            <ProductAttributes attributes={product.attributes || []} />
                        </>
                    ) : commerceEnabled && !product.paymentLinkId && (
                        <AddToCartButton
                            productId={product.id}
                            title={product.title}
                            slug={product.slug || ""}
                            imageLink={product.imageLink || ""}
                            price={product.price}
                            salePrice={product.salePrice}
                            currency={product.currency || "USD"}
                            availability={product.availability || "in_stock"}
                            variants={product.variants || []}
                            personalizations={product.personalizations || []}
                            volumePricing={product.volumePricing || []}
                            strings={addToCartStrings(resolved)}
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
                            <h2 className="text-xl font-bold mb-4">{strings.description}</h2>
                            <div dangerouslySetInnerHTML={{
                                __html: sanitizeHtml(
                                    product.longDescription
                                        .replace(/\\n/g, '')
                                        .replace(/&nbsp;/g, ' ')
                                )
                            }} />
                        </div>
                    )}
                    {product.ingredients && (
                        <div className="mb-12">
                            <h2 className="text-xl font-bold mb-4">{strings.ingredients}</h2>
                            <p className="text-muted-foreground whitespace-pre-wrap">{product.ingredients}</p>
                        </div>
                    )}
                    {product.nutritionalValues?.length > 0 && (
                        <div>
                            <h2 className="text-xl font-bold mb-4">{strings.nutritionalValues}</h2>
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
                        <h2 className="text-xl font-bold">{strings.reviewsHeading}</h2>
                        <div className="flex items-center gap-1.5">
                            <span className="text-amber-500 text-lg">{"★".repeat(Math.round(reviews.averageRating))}</span>
                            <span className="text-sm text-muted-foreground">{fillTemplate(selectPluralText(strings.reviewsSummary, reviews.totalReviews), { rating: reviews.averageRating, n: reviews.totalReviews })}</span>
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
                                    <span className="text-xs text-muted-foreground">{new Date(review.createdAt).toLocaleDateString(config.locale || "en-US")}</span>
                                </div>
                                <div className="text-amber-500 text-sm mb-2">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
                                {review.content && <p className="text-sm text-muted-foreground">{review.content}</p>}
                                {/* rev-4: approved review photos. assetKey → raw asset URL resolved
                                    server-side; bounded thumbnails, lazy, alt from schema; plain <a>
                                    to the full image (lightbox-free, phase 1). NEVER next/image. */}
                                {(() => {
                                    const photos = toPublicReviewPhotos(review.images, reviewAssetCdnBase());
                                    if (photos.length === 0) return null;
                                    return (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {photos.map((photo, i) => (
                                                <a key={i} href={photo.url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-lg overflow-hidden border border-border">
                                                    <img src={photo.url} alt={photo.alt || ""} loading="lazy" className="w-full h-full object-cover" />
                                                </a>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            </main>
        </>
    );
}

// --- CAT-FACETS-1: the filter panel of a catalog site's shop and category pages (spec §§ 4, 5.1, 6) ---
//
// Server-rendered, no JavaScript. Every value is a plain `<a>` to the URL with that value added or removed: no form,
// no client state, no prefetch (a plain anchor is never prefetched — load reduction, § 5.3), `rel="nofollow"` (§ 5.4).
// The model — which facets, which values, every href already measured against the URL budget — comes from
// `@amodx/shared` (`facets.ts`); these components only lay it out. LOCALE-1B: the copy is the tenant's catalog texts
// (`strings`, docs/slices/locale-1.md § 6.3); the facet ids in every href never change.

/** The catalog listing's filter state, passed to the shop and category views only on a catalog site. */
type CatalogFacets = { listing: FacetListing<any>; pagerBase: string };

function FacetValueRow({ v, strings }: { v: FacetValueView; strings: LocaleStrings["catalog"] }) {
    switch (v.state) {
        case "link":
            return <a href={v.href} rel="nofollow" className="hover:text-primary" data-facet-value="link">{v.value} ({v.count})</a>;
        case "selected": {
            const text = <><span aria-hidden="true">✓ </span>{v.value} ({v.count})</>;
            return v.href
                ? <a href={v.href} rel="nofollow" aria-current="true" className="font-semibold text-primary" data-facet-value="selected">{text}</a>
                : <span className="font-semibold" data-facet-value="selected">{text}</span>;
        }
        case "zero":
            return <span aria-disabled="true" className="text-muted-foreground opacity-60" data-facet-value="zero">{v.value} (0)</span>;
        case "too-long":
            return <span aria-disabled="true" title={strings.facetsTooMany} className="text-muted-foreground opacity-60" data-facet-value="too-long">{v.value} ({v.count})</span>;
        default: {
            const unreachable: never = v;
            return unreachable;
        }
    }
}

function FacetPanel({ listing, strings }: { listing: FacetListing<any>; strings: LocaleStrings["catalog"] }) {
    const n = listing.items.length;
    return (
        <div className="space-y-4 text-sm">
            <p className="text-muted-foreground" data-facet-total={n}>{fillTemplate(selectPluralText(strings.facetsCount, n), { n })}</p>
            {listing.tooLong && <p role="status" className="text-muted-foreground" data-facet-notice>{strings.facetsUrlTooLong}</p>}
            {listing.chips.length > 0 && (
                <ul className="flex flex-wrap gap-2" data-facet-chips>
                    {listing.chips.map((c) => (
                        <li key={`${c.facetLabel}\u0000${c.value}`}>
                            {c.href
                                ? <a href={c.href} rel="nofollow" aria-label={fillTemplate(strings.facetsRemove, { facet: c.facetLabel, value: c.value })} className="inline-block rounded-full border px-3 py-1 hover:bg-muted">{c.facetLabel}: {c.value} <span aria-hidden="true">×</span></a>
                                : <span className="inline-block rounded-full border px-3 py-1">{c.facetLabel}: {c.value}</span>}
                        </li>
                    ))}
                </ul>
            )}
            {(listing.chips.length > 0 || listing.tooLong) && listing.clearHref && (
                <a href={listing.clearHref} rel="nofollow" className="inline-block underline hover:text-primary" data-facet-clear>{strings.facetsClear}</a>
            )}
            {listing.budgetHint && <p className="text-muted-foreground" data-facet-hint>{strings.facetsTooMany}</p>}
            {listing.facets.map((f) => (
                <details key={f.id} open={f.values.some((v) => v.state === "selected") || f.values.length <= 10} className="border-t pt-3" data-facet={f.id}>
                    <summary className="cursor-pointer font-medium">{f.label}</summary>
                    <ul className="mt-2 space-y-1">
                        {f.values.map((v) => <li key={v.value}><FacetValueRow v={v} strings={strings} /></li>)}
                    </ul>
                </details>
            ))}
        </div>
    );
}

/**
 * The listing area of a catalog page: the panel (a left column on `lg` and up; one collapsed block above the grid
 * on smaller screens — a CSS-only toggle, the `peer` idiom of `CatalogVariantPresenter`) and the grid. When the
 * panel has nothing to show (no facet narrows, no selection, no notice) the grid renders alone, as before.
 * A selection that matches nothing replaces the grid with the § 4.3 empty result.
 */
function FacetedListing({ listing, grid, strings }: { listing: FacetListing<any>; grid: ReactNode; strings: LocaleStrings["catalog"] }) {
    if (listing.facets.length === 0 && listing.chips.length === 0 && !listing.tooLong) return grid;
    const active = listing.chips.length;
    const body = listing.items.length === 0 && listing.selection.size > 0 ? (
        <div className="py-12 text-center space-y-3" data-facet-empty>
            <p className="text-muted-foreground">{strings.facetsNoMatch}</p>
            {listing.clearHref && <a href={listing.clearHref} rel="nofollow" className="underline hover:text-primary">{strings.facetsClear}</a>}
        </div>
    ) : grid;
    return (
        <div className="lg:flex lg:gap-8 lg:items-start">
            <aside className="mb-6 lg:mb-0 lg:w-64 lg:shrink-0" aria-label={strings.facetsTitle} data-facet-panel>
                <input type="checkbox" id="facet-panel-toggle" className="peer sr-only lg:hidden" />
                <label htmlFor="facet-panel-toggle" className="lg:hidden flex items-center justify-between rounded-lg border px-4 py-3 font-medium cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                    {strings.facetsTitle}{active > 0 ? ` (${active})` : ""}
                </label>
                <h2 className="hidden lg:block font-semibold mb-3">{strings.facetsTitle}</h2>
                <div className="hidden peer-checked:block lg:block mt-4 lg:mt-0">
                    <FacetPanel listing={listing} strings={strings} />
                </div>
            </aside>
            <div className="flex-1 min-w-0">{body}</div>
        </div>
    );
}

function CategoryPageView({ category, products, total, page, config, prefixes, basePath = "", catalog = false, facets }: { category: any; products: any[]; total: number; page: number; config: any; prefixes: any; basePath?: string; catalog?: boolean; facets?: CatalogFacets }) {
    // LOCALE-1A: breadcrumb Home, pagination; LOCALE-1B: the shared product texts and the catalog texts.
    const resolved = resolveLocaleStrings(config);
    const { site, commerce: strings, catalog: catalogStrings } = resolved.strings;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const grid = products.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center">{strings.categoryEmpty}</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {products.map((product: any) => (
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || "/produs"} basePath={basePath} catalog={catalog} tenantId={config.id} catalogStrings={catalogStrings} />
                    ))}
                </div>
            );
    return (
        <>
            {config.searchBar?.enabled && (
                <SearchBar
                    placeholder={config.searchBar?.placeholder || strings.searchPlaceholder}
                    searchPrefix={prefixes.search || "/search"}
                    productPrefix={prefixes.product || "/product"}
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    contentMaxWidth={config.header?.contentMaxWidth || "max-w-6xl"}
                    labels={searchBarLabels(resolved)}
                    {...(catalog ? { showPrices: false } : {})}
                />
            )}
            <main className={`${config.header?.contentMaxWidth || "max-w-6xl"} mx-auto py-12 px-6`}>
                {/* Breadcrumbs */}
                <nav className="text-sm text-muted-foreground mb-8">
                <Link href={`${basePath}/`} className="hover:text-primary">{site.breadcrumbHome}</Link>
                <span className="mx-2">/</span>
                <Link href={`${basePath}${prefixes.shop || "/magazin"}`} className="hover:text-primary">{strings.shopTitle}</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{category.name}</span>
            </nav>

            <div className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
                {category.description && (
                    <p className="text-muted-foreground mt-2">{category.description}</p>
                )}
                <p className="text-sm text-muted-foreground mt-1">{fillTemplate(selectPluralText(strings.productCount, total), { n: total })}</p>
            </div>

            {facets ? <FacetedListing listing={facets.listing} grid={grid} strings={catalogStrings} /> : grid}

                <Pagination page={page} total={total} limit={24} baseUrl={facets ? facets.pagerBase : `${prefixes.category}/${category.slug}`} basePath={basePath} maxHrefBytes={facets ? HREF_BUDGET : undefined} strings={site} />
            </main>
        </>
    );
}

function ShopPageView({ products, categories, total, page, config, prefixes, basePath = "", availability, catalog = false, facets }: { products: any[]; categories: any[]; total: number; page: number; config: any; prefixes: any; basePath?: string; availability?: string; catalog?: boolean; facets?: CatalogFacets }) {
    // LOCALE-1A: breadcrumb Home, pagination; LOCALE-1B: the shared product texts and the catalog texts.
    const resolved = resolveLocaleStrings(config);
    const { site, commerce: strings, catalog: catalogStrings } = resolved.strings;
    const shopUrl = prefixes.shop || "/magazin";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const grid = products.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center">
                    {availability === 'in_stock' ? strings.shopEmptyInStock : strings.shopEmpty}
                </p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {products.map((product: any) => (
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || "/produs"} basePath={basePath} catalog={catalog} tenantId={config.id} catalogStrings={catalogStrings} />
                    ))}
                </div>
            );
    return (
        <>
            {config.searchBar?.enabled && (
                <SearchBar
                    placeholder={config.searchBar?.placeholder || strings.searchPlaceholder}
                    searchPrefix={prefixes.search || "/search"}
                    productPrefix={prefixes.product || "/product"}
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    contentMaxWidth={config.header?.contentMaxWidth || "max-w-6xl"}
                    labels={searchBarLabels(resolved)}
                    {...(catalog ? { showPrices: false } : {})}
                />
            )}
            <main className={`${config.header?.contentMaxWidth || "max-w-6xl"} mx-auto py-12 px-6`}>
                <h1 className="text-3xl font-bold tracking-tight mb-4">{strings.shopTitle}</h1>

            {/* Availability Filter (none on a catalog site) */}
            {!catalog && <div className="flex flex-wrap gap-2 mb-4">
                <Link
                    href={`${basePath}${shopUrl}`}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${!availability ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                >
                    {strings.shopAllProducts}
                </Link>
                <Link
                    href={`${basePath}${shopUrl}?availability=in_stock`}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${availability === 'in_stock' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                >
                    {strings.inStock}
                </Link>
            </div>}

            {/* Category Navigation */}
            {categories.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-8">
                    {categories.map((cat: any) => (
                        <Link key={cat.id} href={`${basePath}${prefixes.category}/${cat.slug}`} className="px-4 py-2 rounded-full border text-sm font-medium hover:bg-muted transition-colors">
                            {cat.name} {cat.productCount > 0 && <span className="text-muted-foreground ml-1">({cat.productCount})</span>}
                        </Link>
                    ))}
                </div>
            )}

            {facets ? <FacetedListing listing={facets.listing} grid={grid} strings={catalogStrings} /> : grid}

            <Pagination page={page} total={total} limit={24} baseUrl={facets ? facets.pagerBase : availability ? `${shopUrl}?availability=${availability}` : shopUrl} basePath={basePath} maxHrefBytes={facets ? HREF_BUDGET : undefined} strings={site} />
            </main>
        </>
    );
}

function SearchPageView({ query, products, total, page, config, prefixes, basePath = "", catalog = false }: { query: string; products: any[]; total: number; page: number; config: any; prefixes: any; basePath?: string; catalog?: boolean }) {
    // LOCALE-1A: breadcrumb Home, pagination; LOCALE-1B: the commerce texts of the search page (§ 5.2) and the catalog
    // texts.
    const resolved = resolveLocaleStrings(config);
    const { site, commerce: strings, catalog: catalogStrings } = resolved.strings;
    const siteWidth = config.header?.contentMaxWidth || "max-w-6xl";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    return (
        <>
            {config.searchBar?.enabled && (
                <SearchBar
                    placeholder={config.searchBar?.placeholder || strings.searchPlaceholder}
                    searchPrefix={prefixes.search || "/search"}
                    productPrefix={prefixes.product || "/product"}
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    contentMaxWidth={siteWidth}
                    labels={searchBarLabels(resolved)}
                    {...(catalog ? { showPrices: false } : {})}
                />
            )}
            <main className={`${siteWidth} mx-auto py-12 px-6`}>
                <nav className="text-sm text-muted-foreground mb-8">
                <Link href={`${basePath}/`} className="hover:text-primary">{site.breadcrumbHome}</Link>
                <span className="mx-2">/</span>
                <Link href={`${basePath}${prefixes.shop || "/shop"}`} className="hover:text-primary">{strings.shopTitle}</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{strings.searchBreadcrumb}</span>
            </nav>

            <h1 className="text-3xl font-bold tracking-tight mb-2">
                {query ? `${strings.resultsFor} "${query}"` : strings.searchProducts}
            </h1>
            {query && <p className="text-sm text-muted-foreground mb-8">{fillTemplate(selectPluralText(strings.searchResultCount, total), { n: total })}</p>}

            {!query ? (
                <p className="text-muted-foreground py-12 text-center">{strings.searchEnterTerm}</p>
            ) : products.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center">{strings.searchNoResults} &ldquo;{query}&rdquo;.</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {products.map((product: any) => (
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || "/product"} basePath={basePath} catalog={catalog} tenantId={config.id} catalogStrings={catalogStrings} />
                    ))}
                </div>
            )}

                <Pagination page={page} total={total} limit={24} baseUrl={`${prefixes.search || "/search"}?q=${encodeURIComponent(query)}`} basePath={basePath} strings={site} />
            </main>
        </>
    );
}

function ConfirmationPageView({ order, config, prefixes, basePath = "" }: { order: any; config: any; prefixes: any; basePath?: string }) {
    // LOCALE-1D: the confirmation texts (§ 6.2), from the tenant's locale table (pattern D).
    const t = resolveLocaleStrings(config).strings.commerce;
    const bankTransfer = config.integrations?.bankTransfer;
    const pageWidth = config.header?.contentPageMaxWidth || "max-w-4xl";

    if (!order) {
        return (
            <main className={`${pageWidth} mx-auto py-20 px-6 text-center`}>
                <div className="text-6xl mb-6">✅</div>
                <h1 className="text-3xl font-bold mb-4">{t.orderThankYou}</h1>
                <p className="text-muted-foreground mb-8">{t.orderPlacedMessage}</p>
                <Link href={`${basePath}${prefixes.shop || "/magazin"}`} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
                    {t.continueShopping}
                </Link>
            </main>
        );
    }

    return (
        <main className={`${pageWidth} mx-auto py-12 px-6`}>
            {config.celebrationEnabled && <CelebrationWrapper />}
            <FBPurchaseEvent
                orderId={order.id}
                value={parseFloat(order.total) || 0}
                currency={order.currency || "USD"}
                items={(order.items || []).map((i: any) => ({ id: i.productId, quantity: i.quantity }))}
            />
            <div className="text-center mb-12">
                <div className="text-6xl mb-4">✅</div>
                <h1 className="text-3xl font-bold mb-2">{t.orderConfirmed}</h1>
                <p className="text-lg text-muted-foreground">
                    {interpolateNodes(t.orderNumber, { number: <span className="font-mono font-bold text-foreground">{order.orderNumber}</span> })}
                </p>
            </div>

            {/* Bank Transfer Details */}
            {order.paymentMethod === "bank_transfer" && bankTransfer && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-3">{t.bankTransferDetails}</h2>
                    <p className="text-sm text-muted-foreground mb-4">{t.bankTransferInstruction}</p>
                    <div className="grid sm:grid-cols-2 gap-3 text-sm">
                        <div><span className="text-muted-foreground">{t.bankLabel}</span> <strong>{bankTransfer.bankName}</strong></div>
                        <div><span className="text-muted-foreground">{t.accountHolderLabel}</span> <strong>{bankTransfer.accountHolder}</strong></div>
                        <div className="sm:col-span-2"><span className="text-muted-foreground">{t.ibanLabel}</span> <strong className="font-mono">{bankTransfer.iban}</strong></div>
                        {bankTransfer.swift && <div><span className="text-muted-foreground">{t.swiftLabel}</span> <strong className="font-mono">{bankTransfer.swift}</strong></div>}
                        <div><span className="text-muted-foreground">{t.referenceLabel}</span> <strong>{order.orderNumber}</strong></div>
                        <div><span className="text-muted-foreground">{t.amountLabel}</span> <strong>{order.total} {order.currency}</strong></div>
                    </div>
                </div>
            )}

            {/* Cash on Delivery */}
            {order.paymentMethod === "cash_on_delivery" && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-2">{t.cashOnDelivery}</h2>
                    <p className="text-sm text-muted-foreground">{interpolateNodes(t.codPayOnDelivery, { amount: <strong>{order.total} {order.currency}</strong> })}</p>
                    {order.estimatedDeliveryDate && <p className="text-sm mt-2">{`${t.estimatedDelivery} `}<strong>{order.estimatedDeliveryDate}</strong></p>}
                </div>
            )}

            {/* Order Items */}
            <div className="border rounded-lg p-6 mb-8">
                <h2 className="font-bold text-lg mb-4">{t.orderDetails}</h2>
                <div className="space-y-3">
                    {(order.items || []).map((item: any, i: number) => (
                        <div key={i} className="flex justify-between text-sm py-2 border-b last:border-0">
                            <div>
                                <p className="font-medium">{item.productTitle}</p>
                                <p className="text-muted-foreground">{interpolateNodes(t.quantityLabel, { n: item.quantity })}</p>
                                {item.personalizations?.length > 0 && (
                                    <p className="text-xs text-muted-foreground">{item.personalizations.map((p: any) => `${p.label}: ${p.value}`).join(", ")}</p>
                                )}
                            </div>
                            <span className="font-medium">{item.totalPrice} {order.currency}</span>
                        </div>
                    ))}
                </div>

                <div className="border-t mt-4 pt-4 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">{t.subtotal}</span><span>{order.subtotal} {order.currency}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t.shipping}</span><span>{order.shippingCost === "0" ? t.freeShipping : `${order.shippingCost} ${order.currency}`}</span></div>
                    {parseFloat(order.discount || "0") > 0 && (
                        <div className="flex justify-between text-green-600"><span>{t.discount}</span><span>-{order.discount} {order.currency}</span></div>
                    )}
                    <div className="flex justify-between font-bold text-base border-t pt-2"><span>{t.total}</span><span>{order.total} {order.currency}</span></div>
                </div>
            </div>

            {/* Shipping Address */}
            {order.shippingAddress && (
                <div className="border rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-3">{t.shippingAddress}</h2>
                    <p className="text-sm">{order.customerName}</p>
                    <p className="text-sm text-muted-foreground">{order.shippingAddress.street}</p>
                    <p className="text-sm text-muted-foreground">{order.shippingAddress.city}, {order.shippingAddress.county} {order.shippingAddress.postalCode}</p>
                    {order.customerPhone && <p className="text-sm text-muted-foreground mt-2">{interpolateNodes(t.phoneLine, { phone: order.customerPhone })}</p>}
                </div>
            )}

            <div className="text-center">
                <Link href={`${basePath}${prefixes.shop || "/magazin"}`} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
                    {t.continueShopping}
                </Link>
            </div>
        </main>
    );
}

/** LOCALE-1D (§ 6.2): each timeline step identifier → its label key. The step list itself is unchanged (F-LOCALE-STEPS). */
const ORDER_STEP_KEYS = {
    pending: "orderStepPending", confirmed: "orderStepConfirmed", processing: "orderStepProcessing",
    shipped: "orderStepShipped", delivered: "orderStepDelivered", completed: "orderStepCompleted",
} as const satisfies Record<string, keyof LocaleStrings["commerce"]>;
/** LOCALE-1D (§ 6.2): each stored history status → its label key. A status without a key renders as stored, as before. */
const ORDER_HISTORY_KEYS: Record<string, keyof LocaleStrings["commerce"]> = {
    placed: "orderHistoryPlaced", confirmed: "orderHistoryConfirmed", prepared: "orderHistoryPrepared", shipped: "orderHistoryShipped",
    delivered: "orderHistoryDelivered", cancelled: "orderHistoryCancelled", annulled: "orderHistoryAnnulled",
};

function OrderTrackingView({ order, config, prefixes, basePath = "" }: { order: any; config: any; prefixes: any; basePath?: string }) {
    // LOCALE-1D: the tracking texts (§ 6.2), from the tenant's locale table (pattern D).
    const t = resolveLocaleStrings(config).strings.commerce;
    const pageWidth = config.header?.contentPageMaxWidth || "max-w-4xl";

    if (!order) {
        return (
            <main className={`${pageWidth} mx-auto py-20 px-6 text-center`}>
                <h1 className="text-3xl font-bold mb-4">{t.orderNotFound}</h1>
                <p className="text-muted-foreground mb-8">{t.orderNotFoundMessage}</p>
                <Link href={`${basePath}${prefixes.shop || "/magazin"}`} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
                    {t.continueShopping}
                </Link>
            </main>
        );
    }

    const statusSteps = Object.keys(ORDER_STEP_KEYS) as (keyof typeof ORDER_STEP_KEYS)[];
    const currentStepIndex = statusSteps.indexOf(order.status);

    return (
        <main className={`${pageWidth} mx-auto py-12 px-6`}>
            <h1 className="text-3xl font-bold tracking-tight mb-2">{interpolateNodes(t.orderNumber, { number: order.orderNumber })}</h1>
            <p className="text-muted-foreground mb-8">{interpolateNodes(t.placedOn, { date: new Date(order.createdAt).toLocaleDateString(config.locale || "en-US") })}</p>

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
                                {t[ORDER_STEP_KEYS[step]]}
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
                    <h2 className="font-bold text-lg mb-4">{t.statusHistory}</h2>
                    <div className="space-y-3">
                        {order.statusHistory.map((entry: any, i: number) => (
                            <div key={i} className="flex gap-3 text-sm">
                                <span className="text-muted-foreground whitespace-nowrap">{new Date(entry.timestamp).toLocaleString(config.locale || "en-US")}</span>
                                <span className="capitalize font-medium">{Object.hasOwn(ORDER_HISTORY_KEYS, entry.status) ? t[ORDER_HISTORY_KEYS[entry.status]] : entry.status}</span>
                                {entry.note && <span className="text-muted-foreground">- {entry.note}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Tracking Number */}
            {order.trackingNumber && (
                <div className="border rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-2">{t.tracking}</h2>
                    <p className="text-sm">{`${t.trackingNumber} `}<span className="font-mono font-bold">{order.trackingNumber}</span></p>
                </div>
            )}

            {/* Order Items Summary */}
            <div className="border rounded-lg p-6">
                <h2 className="font-bold text-lg mb-4">{t.items}</h2>
                {(order.items || []).map((item: any, i: number) => (
                    <div key={i} className="flex justify-between text-sm py-2 border-b last:border-0">
                        <span>{item.productTitle} x{item.quantity}</span>
                        <span className="font-medium">{item.totalPrice} {order.currency}</span>
                    </div>
                ))}
                <div className="border-t mt-3 pt-3 flex justify-between font-bold">
                    <span>{t.total}</span>
                    <span>{order.total} {order.currency}</span>
                </div>
            </div>
        </main>
    );
}
