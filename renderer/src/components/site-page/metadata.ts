import { getTenantConfig, getContentBySlug, getProductBySlug, getCategoryBySlug, getTranslationSetMembers, isTranslationKey, listedAlternates } from "@/lib/dynamo";
import { Metadata } from "next";
import { ContentItem, isCatalogMode, resolveLocaleStrings, fillTemplate } from "@amodx/shared";
import type { SitePageInput } from "@/components/site-page/input";
import { matchCommercePrefix, interestPrefix, normalizePageAddressOrKeepRaw } from "@/components/site-page/addresses";

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
