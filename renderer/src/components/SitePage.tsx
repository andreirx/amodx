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
import { getTenantConfig, getContentBySlug, getPosts, getProductBySlug, getCategoryBySlug, getProductsByCategory, getAllCategories, getActiveProducts, getCatalogListing, searchProducts, getDeliveryConfig, getOrderForCustomer, getProductReviews, getSiteReviews, getActiveCategoriesByIds, getProductById, getFormBySlug, getTranslationSetMembers, isTranslationKey, listedAlternates } from "@/lib/dynamo";
import { reviewAssetCdnBase, toPublicReviewPhotos, toCarouselReviewItems } from "@/lib/review-images";
import { RenderBlocks } from "@/components/RenderBlocks";
import { permanentRedirect } from "next/navigation";
import { notFoundOrHandoff } from "@/lib/not-found-handoff";
import { localeInputFor } from "@/lib/site-segment";
import { Metadata } from "next";
import { ContentItem, Product, Category, FormFieldSchema, type FormField, URL_PREFIX_DEFAULTS, urlPrefixesOf, getCountryPack, isCatalogMode, localeUsesDecimalComma, parseMoney, catalogListingPath, resolveLocaleStrings, pageLanguageOf, fillTemplate, selectPluralText, blockStrings, type LocaleStrings, type ResolvedLocaleStrings, type FacetLabels } from "@amodx/shared";
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
import sanitizeHtmlLib from "sanitize-html";
import { CelebrationWrapper } from "@/components/CelebrationWrapper";
import { InterestToggle, InterestListPage, type InterestListStrings, type InterestToggleStrings } from "@/components/InterestShortlist";
import { QuoteRequest, type QuoteRequestStrings } from "@/components/QuoteRequest";
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

/** CAT-QUOTE-1: the quote button's and dialog's texts (only the keys it uses, § 5.3). */
function quoteRequestStrings(c: LocaleStrings["catalog"]): QuoteRequestStrings {
    return { quoteButton: c.quoteButton, quoteTitle: c.quoteTitle, quoteCall: c.quoteCall, quoteWhatsApp: c.quoteWhatsApp, quoteEmail: c.quoteEmail, quoteMessage: c.quoteMessage, quoteClose: c.quoteClose };
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
    if (slugPath === prefixes.checkout + (prefixes.checkoutConfirmation || URL_PREFIX_DEFAULTS.checkoutConfirmation)) return { type: 'checkout-confirm' };
    if (slugPath.startsWith(prefixes.checkout + "/")) {
        const segment = slugPath.slice(prefixes.checkout.length + 1);
        if (segment && "/" + segment !== (prefixes.checkoutConfirmation || URL_PREFIX_DEFAULTS.checkoutConfirmation)) return { type: 'checkout-track', itemSlug: segment };
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

/** CAT-INTEREST-1: the interest-list path of a tenant (`urlPrefixes.interest`, default `URL_PREFIX_DEFAULTS.interest`, "/my-list" since CDL-2). Catalog sites only. */
function interestPrefix(config: any): string {
    return config.urlPrefixes?.interest || URL_PREFIX_DEFAULTS.interest;
}

/** Next-equivalent public address for parseable inputs; keep the existing raw value if parsing fails.
 * Never invent a replacement origin or throw in the page render. This is not tenant-domain validation.
 * Next omits the root slash when there is no query, and otherwise emits the WHATWG URL's href. */
function normalizePageAddressOrKeepRaw(domain: string, slugPath: string): string {
    const raw = `https://${domain}${slugPath === '/' ? '' : slugPath}`;
    try {
        const url = new URL(raw);
        return url.pathname === '/' && url.searchParams.size === 0 ? url.origin : url.href;
    } catch {
        return raw;
    }
}

export async function buildSitePageMetadata({ siteId, slug, query }: Pick<SitePageInput, "siteId" | "slug" | "query">): Promise<Metadata> {
    const config = await getTenantConfig(siteId);
    if (!config) return {};

    const slugPath = slug ? "/" + slug.join("/") : "/";
    const canonicalUrl = normalizePageAddressOrKeepRaw(config.domain, slugPath);

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
    // LANG-1C (docs/slices/lang-1.md § 8.4): `hreflang` + `x-default` from the page's translation set. The set is read
    // only when the tenant lists extra languages AND the page holds a set key (a non-empty string): one Query per 1 MB of
    // the set's membership items + one GetItem per parseable item, stale items included. A one-language tenant or a page
    // in no set → no read. Fewer than two LISTED members → the reads have run, and the object is exactly today's.
    const alternates = (config.languages ?? []).length > 0 && isTranslationKey(content.translationKey)
        ? listedAlternates(await getTranslationSetMembers(config.id, content.translationKey), { languages: config.languages ?? [], locale: config.locale, homePageSlug: config.homePageSlug })
        : null;
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
        alternates: alternates === null ? { canonical: canonicalUrl } : {
            canonical: canonicalUrl,
            // One entry per listed member (its public address on the tenant's domain, never a preview path or a `~`
            // segment), then `x-default`. Next writes each as `<link rel="alternate" hrefLang=… href=…>`.
            languages: Object.fromEntries([
                ...alternates.links.map((l) => [l.hreflang, `https://${config.domain}${l.path}`]),
                ...(alternates.xDefault !== undefined ? [["x-default", `https://${config.domain}${alternates.xDefault}`]] : []),
            ]),
        },
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
    await prepareBlocks(content.blocks, config);

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

/**
 * SERVER PRE-FETCH FOR PLUGIN BLOCKS — the preparation pass every list of blocks gets before `RenderBlocks` draws it.
 * Injects server-fetched data and tenant settings into the attrs of the blocks, IN PLACE: `postGrid` posts,
 * `categoryShowcase` products (+ the catalog-mode reduction and the URL prefixes), `reviewsCarousel` reviews,
 * `categoryGrid` categories (SHOP-LOOK-1C).
 * Eliminates client-side browser→API Gateway fetches which are fragile (CORS, missing env vars, silent failures).
 * A value that is not an array is left alone (no read). Users: the content page and the category page
 * (CATEGORY-CONTENT-1), so a block works the same on both.
 */
/**
 * PRICE-LOCALE-1 (ruling PL1-SHOWCASE = C, narrowed): the showcase card's price range (min and max of `price` and the
 * tier prices — the card's own rule) for a product with tiers whose `price` or a tier price contains a comma, read by
 * `parseMoney` with the tenant locale and given to the card as `_priceRange`. Any other product is returned as it is (the
 * same object). A text that does not parse → no range: the card keeps its own reading. Pure; never mutates `product`.
 */
function withCommaPriceRange(product: any, locale: string | undefined): any {
    const tiers: any[] = Array.isArray(product?.volumePricing) ? product.volumePricing : [];
    const texts: unknown[] = [product?.price, ...tiers.map((t) => t?.price)];
    if (tiers.length === 0 || !texts.some((t) => typeof t === "string" && t.includes(","))) return product;
    const numbers = texts.map((t) => (typeof t === "string" ? parseMoney(t, locale) : undefined));
    if (numbers.some((n) => n === undefined)) return product;
    const values = numbers as number[];
    return { ...product, _priceRange: { min: Math.min(...values), max: Math.max(...values) } };
}

/** SHOP-LOOK-1D (design § 6.4): the card data is read for at most this many products per block — the schema's `limit`
 *  maximum; a larger stored `limit` (the backend does not check block attributes) shows its extra cards without it. */
const SHOWCASE_CARD_READ_LIMIT = 12;
/** SHOP-LOOK-1D (§ 7.2): the most characters of short text a card receives. The card shows two lines (`line-clamp-2`);
 *  two lines of the widest card (two columns, full width) hold fewer, so the cut never shows; it bounds the payload. */
const SHORT_TEXT_MAX = 400;

/**
 * SHOP-LOOK-1D (§ 7.2): a product description as the plain text of a showcase card — never HTML. The stored text may be
 * HTML (the product page sanitizes and draws it as HTML, and reads a literal `\n` as a line break). Here: a literal `\n`
 * and each block-level tag become a space (so two paragraphs do not run together), sanitize-html removes every tag (and
 * the content of `script` / `style`), its three escapes (`&lt;` `&gt;` `&amp;`, the only ones it writes) are undone
 * because React escapes the text again, white space collapses, and the result is cut to `SHORT_TEXT_MAX` characters
 * (code points). Not a string, or nothing left → undefined (no element).
 */
function cardShortText(description: unknown): string | undefined {
    if (typeof description !== "string") return undefined;
    const separated = description.replace(/\\n/g, " ").replace(/<(\/?)(p|div|br|li|h[1-6]|tr|td|th|blockquote|pre|hr)\b/gi, " <$1$2");
    const text = sanitizeHtmlLib(separated, { allowedTags: [], allowedAttributes: {} })
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/\s+/g, " ").trim();
    return text === "" ? undefined : Array.from(text).slice(0, SHORT_TEXT_MAX).join("");
}

/**
 * SHOP-LOOK-1D (design § 6.3 rule 3, § 6.4, § 7): the showcase card data that the block's options ask for, added to the
 * products this pass read. Each option reads ONLY when it is on (stored exactly `true`); with all three off the same
 * array returns and no read is made. Never called for a catalog tenant (SL-D10). Per block, at most:
 * - `showCategoryLabel`: 1 `getAllCategories` call (paginating Query, active categories only) → `_categoryName` = the
 *   name of the product's FIRST category (`categoryIds[0]`, SL-D7); a first category that is hidden or missing → no key.
 * - `showDescription`: 1 `getProductById` (one `GetCommand`) per product → `_descriptionText` (`cardShortText`).
 * - `showRating`: 1 `getProductReviews` (paginating Query, approved only) per product → `_rating` = `{ average, count,
 *   text }`, `text` = the tenant's `reviewsSummary` filled as on the product page; no approved review → no key.
 * Products past the first `SHOWCASE_CARD_READ_LIMIT` are returned as they are. A product without new data is the same
 * object; one with new data is a copy with only the new keys added.
 */
async function withShowcaseCardData(attrs: any, products: any[], config: any): Promise<any[]> {
    const label = attrs.showCategoryLabel === true;
    const description = attrs.showDescription === true;
    const rating = attrs.showRating === true;
    if (!label && !description && !rating) return products;
    const names = label ? new Map((await getAllCategories(config.id)).map((c: any) => [c.id, c.name])) : undefined;
    const summary = rating ? resolveLocaleStrings(config).strings.commerce.reviewsSummary : undefined;
    return Promise.all(products.map(async (product: any, i: number) => {
        if (i >= SHOWCASE_CARD_READ_LIMIT) return product;
        const [item, reviews] = await Promise.all([
            description ? getProductById(config.id, product.id) : undefined,
            rating ? getProductReviews(config.id, product.id) : undefined,
        ]);
        const categoryName = names?.get(Array.isArray(product.categoryIds) ? product.categoryIds[0] : undefined);
        const shortText = cardShortText(item?.description);
        const extra = {
            ...(typeof categoryName === "string" && categoryName.trim() !== "" ? { _categoryName: categoryName } : {}),
            ...(shortText !== undefined ? { _descriptionText: shortText } : {}),
            ...(summary && reviews && reviews.totalReviews > 0 && Number.isFinite(reviews.averageRating)
                ? { _rating: { average: reviews.averageRating, count: reviews.totalReviews, text: fillTemplate(selectPluralText(summary, reviews.totalReviews), { rating: reviews.averageRating, n: reviews.totalReviews }) } }
                : {}),
        };
        return Object.keys(extra).length > 0 ? { ...product, ...extra } : product;
    }));
}

/**
 * SHOP-LOOK-1E (record docs/slices/shop-look-1e.md § 2): the `form` block's `_form`, built field by field from the form
 * `getFormBySlug` read (an active form of this tenant) — never the stored item, which also holds the owner's notify
 * address and the keys. `fields`: the stored entries that are fields (`FormFieldSchema`), the first field of each label
 * only — the rule of the submit handler (`backend/src/forms/public-submit.ts` `formFields`), so the page shows exactly
 * the fields the handler reads. `strings`: the four form texts of the tenant's locale table (three of them are not
 * block keys, so `strings` of RenderBlocks does not hold them).
 */
function formForBlock(form: Record<string, any>, slug: string, site: LocaleStrings["site"]) {
    const seen = new Set<string>();
    const fields: FormField[] = [];
    for (const entry of Array.isArray(form.fields) ? form.fields : []) {
        const parsed = FormFieldSchema.safeParse(entry);
        if (!parsed.success || seen.has(parsed.data.label)) continue;
        seen.add(parsed.data.label);
        fields.push(parsed.data);
    }
    return {
        slug,
        name: typeof form.name === "string" ? form.name : "",
        fields,
        submitButtonText: typeof form.submitButtonText === "string" ? form.submitButtonText : "",
        successMessage: typeof form.successMessage === "string" ? form.successMessage : "",
        strings: {
            formSubmissionFailed: site.formSubmissionFailed, formErrorShort: site.formErrorShort,
            formSelectPlaceholder: site.formSelectPlaceholder, formSubmitting: site.formSubmitting,
        },
    };
}

async function prepareBlocks(blocks: unknown, config: any): Promise<void> {
    if (!Array.isArray(blocks)) return;
    await Promise.all(blocks.map(async (block: any) => {
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
                    // SHOP-LOOK-1D: the card options' data (`withShowcaseCardData`), only for the products read here and
                    // only on a non-catalog tenant (SL-D10); with every option off the same array stays (no read).
                    if (!isCatalogMode(config)) block.attrs.prefetchedProducts = await withShowcaseCardData(block.attrs, items, config);
                }
            }
            // PRICE-LOCALE-1 (ruling PL1-SHOWCASE = C, narrowed): for a decimal-comma tenant only, each product whose price
            // texts hold a comma gets its card range from the shared parser (`withCommaPriceRange`). Every other tenant and
            // product keeps the same attrs, so its payload does not change. Before the catalog reduction below, which
            // keeps display fields only.
            if (Array.isArray(block.attrs.prefetchedProducts) && localeUsesDecimalComma(config.locale)) {
                block.attrs.prefetchedProducts = block.attrs.prefetchedProducts.map((p: any) => withCommaPriceRange(p, config.locale));
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

        // SHOP-LOOK-1C (docs/slices/shop-look-1.md § 6.4; record docs/slices/shop-look-1c.md): the picked categories of a
        // tile grid. Only this block's attrs gain a key (`_categories`, § 6.3 rule 3). The stored ids: strings that are not
        // blank, the first 12 (the schema's limit; the backend does not check block attributes, so a stored 13th id is not
        // read and not drawn) — one `getActiveCategoriesByIds` call per block, one `GetCommand` per id, none when no id is
        // left. A hidden or missing category is skipped by the read; the others keep the picked order. Each tile is built
        // field by field — id, name, description and imageLink when present, and the site path of its category page
        // (`urlPrefixesOf`: the tenant's category prefix, else the default) — so the payload holds these fields whatever
        // the read returns (the attrs of a client block travel in the RSC payload).
        if (block.type === 'categoryGrid') {
            const stored: unknown[] = Array.isArray(block.attrs.categoryIds) ? block.attrs.categoryIds : [];
            const ids = stored.filter((id): id is string => typeof id === "string" && id.trim() !== "").slice(0, 12);
            const categoryPrefix = urlPrefixesOf(config.urlPrefixes).category;
            const categories = ids.length > 0 ? await getActiveCategoriesByIds(config.id, ids) : [];
            block.attrs._categories = categories.map((c) => ({
                id: c.id,
                name: c.name,
                ...(c.description !== undefined ? { description: c.description } : {}),
                ...(c.imageLink !== undefined ? { imageLink: c.imageLink } : {}),
                path: `${categoryPrefix}/${c.slug}`,
            }));
        }

        // SHOP-LOOK-1E: the custom form of a `form` block, by its slug (trimmed; blank → no read). One `getFormBySlug` per
        // block (two keyed `GetCommand`s under TENANT#<this tenant>); only this block's attrs gain `_form`, and only when the
        // form exists and is active. No `_form` → the block draws nothing.
        if (block.type === 'form') {
            const slug = typeof block.attrs.formSlug === "string" ? block.attrs.formSlug.trim() : "";
            const form = slug !== "" ? await getFormBySlug(config.id, slug) : null;
            if (form) block.attrs._form = formForBlock(form, slug, resolveLocaleStrings(config).strings.site);
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

// --- COMMERCE PAGE COMPONENTS ---

/** CAT-THEME-1: the tenant theme's `editorial` shape (CT-D1 = A); absent or "default" → false (today's classes). */
function isEditorial(config: any): boolean {
    return config.theme?.shape === "editorial";
}

/**
 * CAT-THEME-1 (§ 3 item 5): the tenant's categories for the card's category line — read only when the theme turns the
 * line on, so every other tenant's category and search pages make exactly the reads they made before.
 */
async function cardCategoriesOf(config: any): Promise<any[] | undefined> {
    return config.theme?.cardCategoryLine === true ? getAllCategories(config.id) : undefined;
}

/**
 * CAT-THEME-1 (§ 3 item 5): the theme's card options for one product — `landscape` (`theme.cardImage`) and, when
 * `theme.cardCategoryLine` is on, the name of the product's FIRST category (`categoryIds[0]`) found in `categories`; a
 * first category that is not there gives no line. A theme that sets neither gives `{ landscape: false }` — ProductCard's
 * own defaults, so the card renders as before.
 */
function cardThemeProps(config: any, categories: any[] | undefined, product: any): { landscape?: boolean; categoryName?: string } {
    const first = Array.isArray(product.categoryIds) ? product.categoryIds[0] : undefined;
    const categoryName = config.theme?.cardCategoryLine === true ? categories?.find((c: any) => c.id === first)?.name : undefined;
    return { landscape: config.theme?.cardImage === "landscape", ...(categoryName ? { categoryName } : {}) };
}

/**
 * `catalog` (CATALOG-MODE-1): no price line and no availability badge — not emitted, not hidden by CSS.
 * CAT-INTEREST-1: on a catalog site the card is followed by the "Mă interesează" toggle (a button may not sit inside
 * the card's link); any other site renders the link alone, exactly as before. LOCALE-1B: `catalogStrings` = the
 * tenant's catalog texts (the toggle's three texts are taken from it per card).
 */
function ProductCard({ product, productPrefix, basePath = "", catalog = false, tenantId, catalogStrings, landscape = false, categoryName }: { product: any; productPrefix: string; basePath?: string; catalog?: boolean; tenantId: string; catalogStrings: LocaleStrings["catalog"]; landscape?: boolean; categoryName?: string }) {
    const title = <h3 className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">{product.title}</h3>;
    const card = (
        <Link href={`${basePath}${productPrefix}/${product.slug}`} className="group block">
            <div className={landscape ? "h-[245px] bg-muted rounded-lg overflow-hidden mb-3" : "aspect-square bg-muted rounded-lg overflow-hidden mb-3"}>
                {product.imageLink ? (
                    <img src={product.imageLink} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-4xl">🛍</div>
                )}
            </div>
            {/* CAT-THEME-1: the category line shares the title's child slot (a fragment), so a card without it has
                exactly the children it had: the Link is a client element, and its children travel in the payload by position. */}
            {categoryName ? <>{title}<p className="text-xs text-muted-foreground mt-1">{categoryName}</p></> : title}
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
 * The presenter's FIRST group with options (an imported product has exactly one group) and the name of its radio
 * group, as `CatalogVariantPresenter` names it. Readers of the choice: the interest toggle (`interestToggleProps`)
 * and the gallery's option picker (`catalogGalleryProps`, CAT-VARIANT-GALLERY-1).
 */
function firstOptionGroup(product: any): { name: string; options: any[] } | undefined {
    const group = (product.variants || []).find((g: any) => (g.options || []).length > 0);
    return group ? { name: `catalog-option-${group.id || 0}`, options: group.options } : undefined;
}

/**
 * CAT-INTEREST-1: the product-page toggle's props. The option comes from `firstOptionGroup`.
 */
function interestToggleProps(tenantId: string, product: any) {
    const group = firstOptionGroup(product);
    return {
        tenantId, productId: product.id, title: product.title, slug: product.slug || "",
        ...(product.imageLink ? { imageLink: product.imageLink } : {}),
        ...(group ? {
            optionGroupName: group.name,
            options: group.options.map((o: any) => (o.imageLink ? { value: o.value, imageLink: o.imageLink } : { value: o.value })),
        } : {}),
    };
}

/**
 * CAT-VARIANT-GALLERY-1 (ruling CVG1-HEADER-CLEARANCE): the SERVER value of the pinned gallery's CSS `top` — the tallest
 * height the site's sticky header (app/[siteId]/layout.tsx) can have on this tenant WITH A ONE-LINE TOP BAR, plus a 1rem
 * gap. It is the `top` in the HTML, before hydration and without JavaScript. After hydration ProductImageGallery
 * replaces it with the header's measured height + 1rem (review-1: a Top Bar with line breaks, or text that wraps at the
 * window's width, is taller than any configuration value can know). Derived from the same configuration that sizes
 * the header. Its parts at `md` and up:
 *  - the editorial top border (`theme.shape` "editorial"): 3px;
 *  - the Top Bar (`topBar.show`): 2rem — `text-xs` (line height 1rem) + `py-2` (2 × 0.5rem), one line of text;
 *  - the Navbar: its 1px bottom border + the TALLER of `header.navHeight` and `header.navHeightScrolled` (`h-<n>` =
 *    n × 0.25rem; the bar switches to the scrolled height after 20px of scroll, so the taller one clears both states).
 *    Absent → the Navbar's own defaults `h-16` / `h-12`. A value that is not `h-<n>` counts as `h-36` (9rem), the
 *    tallest admin choice.
 * The Commerce Bar is never in a catalog header (catalogMode excludes commerceEnabled, CM-D11). The rem part stays in
 * rem so that the offset grows with the visitor's root font size as the header does; the borders stay px.
 */
function pinnedGalleryTop(config: any): string {
    const navRem = (value: unknown, absent: string) => {
        const m = /^h-(\d+)$/.exec(value === undefined ? absent : String(value));
        return m ? Number(m[1]) / 4 : 9;
    };
    const rem = (config.topBar?.show ? 2 : 0)
        + Math.max(navRem(config.header?.navHeight, "h-16"), navRem(config.header?.navHeightScrolled, "h-12"))
        + 1;
    const px = 1 + (isEditorial(config) ? 3 : 0);
    return `calc(${rem}rem + ${px}px)`;
}

/**
 * CAT-VARIANT-GALLERY-1 (docs/slices/cat-variant-gallery-1.md § 1): the gallery props of a CATALOG product page —
 * pinned from `md` up below the site header (`pinnedGalleryTop`), and, when the product has an option group, that
 * group's radio name and each option's pictures (the gallery uses them as its picker only when an option has an
 * `imageLink`). Only the keys an option holds are passed. Never called for a commerce product page, whose gallery
 * props stay the three of before.
 */
function catalogGalleryProps(product: any, config: any) {
    const group = firstOptionGroup(product);
    return {
        pinnedTop: pinnedGalleryTop(config),
        ...(group ? {
            optionGroupName: group.name,
            options: group.options.map((o: any) => ({
                value: o.value,
                ...(o.imageLink ? { imageLink: o.imageLink } : {}),
                ...(o.additionalImageLinks?.length ? { additionalImageLinks: o.additionalImageLinks } : {}),
            })),
        } : {}),
    };
}

/**
 * CATALOG-MODE-1 (F-1): the product's `attributes` (e.g. unit, packaging, minimum order) as a key/value list.
 * CAT-IMPORT-PROFILE-1B (design § 2.5): a key may be stored more than once (a value per option, or a split list);
 * such a key is ONE row, at the place of its first entry, with its values in stored order joined by ", ". A product
 * whose keys are all distinct renders exactly the rows it rendered before.
 */
function ProductAttributes({ attributes, editorial = false }: { attributes: { key: string; value: string }[]; editorial?: boolean }) {
    const rows = new Map<string, string[]>();
    for (const a of attributes) {
        if (!a.key || !a.value) continue;
        const values = rows.get(a.key);
        if (values) values.push(a.value);
        else rows.set(a.key, [a.value]);
    }
    if (rows.size === 0) return null;
    // CAT-THEME-1 (`editorial` shape, § 3 item 6): the key column takes half the width and every row sits between 1 px
    // hairlines (`border` = the theme's borderColor). Otherwise the classes are the ones before the slice.
    const [dl, dt, dd] = editorial
        ? ["grid grid-cols-2 gap-x-6 text-sm border-t", "text-muted-foreground py-2 border-b", "font-medium py-2 border-b"]
        : ["grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm border-t pt-4", "text-muted-foreground", "font-medium"];
    return (
        <dl className={dl}>
            {[...rows].map(([key, values], i) => (
                <div key={i} className="contents">
                    <dt className={dt}>{key}</dt>
                    <dd className={dd}>{values.join(", ")}</dd>
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
                <Link href={`${basePath}${prefixes.shop || URL_PREFIX_DEFAULTS.shop}`} className="hover:text-primary">{strings.shopTitle}</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{product.title}</span>
            </nav>

            <div className="grid md:grid-cols-2 gap-12">
                {/* Images */}
                <ProductImageGallery
                    mainImage={product.imageLink}
                    additionalImages={product.additionalImageLinks || []}
                    title={product.title}
                    {...(catalog ? catalogGalleryProps(product, config) : {})}
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
                    {catalog ? (() => {
                        // CAT-INTEREST-1 (review-0 F4): keyed by product, so a client navigation to another product
                        // mounts fresh radio inputs and a fresh toggle — no choice carries over between products.
                        // CAT-QUOTE-1 (spec § 3 items 2-3): with a contact channel, "Request a quote" above the presenter; the
                        // interest toggle is the low-key link, under the button, in its place after the presenter (one order
                        // for every catalog tenant). Two fragments, not a conditional child: a tenant without a channel
                        // keeps the slot's children (and their order) as before.
                        const presenter = <CatalogVariantPresenter key={`presenter-${product.id}`} variants={product.variants || []} />;
                        const toggle = <InterestToggle key={`interest-${product.id}`} variant="link" {...interestToggleProps(config.id, product)} strings={interestToggleStrings(catalogStrings)} />;
                        const attributes = <ProductAttributes attributes={product.attributes || []} editorial={isEditorial(config)} />;
                        const channels = config.contactChannels;
                        if (!(channels && (channels.phone || channels.whatsapp || channels.email))) return <>{presenter}{toggle}{attributes}</>;
                        const group = interestToggleProps(config.id, product).optionGroupName;
                        const quote = (
                            <QuoteRequest
                                key={`quote-${product.id}`}
                                channels={channels}
                                productTitle={product.title}
                                productUrl={`https://${config.domain}${prefixes.product || URL_PREFIX_DEFAULTS.product}/${product.slug}`}
                                {...(group ? { optionGroupName: group } : {})}
                                strings={quoteRequestStrings(catalogStrings)}
                            />
                        );
                        return <>{quote}{presenter}{toggle}{attributes}</>;
                    })() : commerceEnabled && !product.paymentLinkId && (
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
                            {...(localeUsesDecimalComma(resolved.locale) ? { priceLocale: resolved.locale } : {})}
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

function CategoryPageView({ category, products, total, page, config, prefixes, basePath = "", catalog = false, facets, cardCategories }: { category: any; products: any[]; total: number; page: number; config: any; prefixes: any; basePath?: string; catalog?: boolean; facets?: CatalogFacets; cardCategories?: any[] }) {
    // LOCALE-1A: breadcrumb Home, pagination; LOCALE-1B: the shared product texts and the catalog texts.
    const resolved = resolveLocaleStrings(config);
    const { site, commerce: strings, catalog: catalogStrings } = resolved.strings;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const grid = products.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center">{strings.categoryEmpty}</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {products.map((product: any) => (
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || URL_PREFIX_DEFAULTS.product} basePath={basePath} catalog={catalog} tenantId={config.id} catalogStrings={catalogStrings} {...cardThemeProps(config, cardCategories, product)} />
                    ))}
                </div>
            );
    const titleBlock = (
            <div className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
                {category.description && (
                    <p className="text-muted-foreground mt-2">{category.description}</p>
                )}
                <p className="text-sm text-muted-foreground mt-1">{fillTemplate(selectPluralText(strings.productCount, total), { n: total })}</p>
            </div>
    );
    // CATEGORY-CONTENT-1: the category's own blocks, after the title block and before the filters and the list, on every
    // page and filter state; prepared by `prepareBlocks` in SitePage. Width: no `contentMaxWidth` is given, so
    // `RenderBlocks` adds no per-block wrapper and each block takes the width of this page's container (`<main>`, the
    // site width), aligned with the title and the grid. No blocks (absent, `[]`, not an array) → `undefined`, and the
    // title block stays the element it was: no extra child (a `false` child would still change the RSC payload).
    const pageContent = Array.isArray(category.blocks) && category.blocks.length > 0 ? (
        <div className="mb-8" data-category-content>
            <RenderBlocks blocks={category.blocks} tenantId={config.id} basePath={basePath}
                strings={blockStrings(resolved, { catalogMode: catalog })} />
        </div>
    ) : undefined;
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
            <main className={`${config.header?.contentMaxWidth || "max-w-6xl"} mx-auto ${isEditorial(config) ? "py-[var(--section-gap)]" : "py-12"} px-6`}>
                {/* Breadcrumbs */}
                <nav className="text-sm text-muted-foreground mb-8">
                <Link href={`${basePath}/`} className="hover:text-primary">{site.breadcrumbHome}</Link>
                <span className="mx-2">/</span>
                <Link href={`${basePath}${prefixes.shop || URL_PREFIX_DEFAULTS.shop}`} className="hover:text-primary">{strings.shopTitle}</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{category.name}</span>
            </nav>

            {pageContent ? <>{titleBlock}{pageContent}</> : titleBlock}

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
    const shopUrl = prefixes.shop || URL_PREFIX_DEFAULTS.shop;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const grid = products.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center">
                    {availability === 'in_stock' ? strings.shopEmptyInStock : strings.shopEmpty}
                </p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {products.map((product: any) => (
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || URL_PREFIX_DEFAULTS.product} basePath={basePath} catalog={catalog} tenantId={config.id} catalogStrings={catalogStrings} {...cardThemeProps(config, categories, product)} />
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
            <main className={`${config.header?.contentMaxWidth || "max-w-6xl"} mx-auto ${isEditorial(config) ? "py-[var(--section-gap)]" : "py-12"} px-6`}>
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

function SearchPageView({ query, products, total, page, config, prefixes, basePath = "", catalog = false, cardCategories }: { query: string; products: any[]; total: number; page: number; config: any; prefixes: any; basePath?: string; catalog?: boolean; cardCategories?: any[] }) {
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
            <main className={`${siteWidth} mx-auto ${isEditorial(config) ? "py-[var(--section-gap)]" : "py-12"} px-6`}>
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
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || "/product"} basePath={basePath} catalog={catalog} tenantId={config.id} catalogStrings={catalogStrings} {...cardThemeProps(config, cardCategories, product)} />
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
                <Link href={`${basePath}${prefixes.shop || URL_PREFIX_DEFAULTS.shop}`} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
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
                <Link href={`${basePath}${prefixes.shop || URL_PREFIX_DEFAULTS.shop}`} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
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
                <Link href={`${basePath}${prefixes.shop || URL_PREFIX_DEFAULTS.shop}`} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
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
