import { getTenantConfig, getPublishedContent, getAllCategories, getActiveProducts, getTranslationItems, sitemapAlternates, type TranslationAlternates } from "@/lib/dynamo";
import { isCatalogMode } from "@amodx/shared";
import { SITEMAP_BY_ID_HEADER } from "@/lib/site-segment";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic'; // Ensure fresh data

/** An XML attribute value: the five characters XML gives a meaning, escaped. */
function xmlAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * LANG-1C (docs/slices/lang-1.md § 8.5): the `<xhtml:link>` lines of one `<url>` — one per listed member of its set,
 * then `x-default` — or "" when the page is not a listed member (so a page in no set keeps today's bytes). `href` =
 * the tenant's domain + the member's public address ("/" for the default-language home member, else its slug).
 */
function alternateLinks(alternates: TranslationAlternates | undefined, baseUrl: string): string {
    if (alternates === undefined) return "";
    const line = (hreflang: string, path: string) =>
        `\n    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${xmlAttribute(`${baseUrl}${path}`)}"/>`;
    return alternates.links.map((l) => line(l.hreflang, l.path)).join("")
        + (alternates.xDefault !== undefined ? line("x-default", alternates.xDefault) : "");
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);
    if (!config) return new NextResponse("Site not found", { status: 404 });

    // Phase 2.4: Direct DynamoDB reads instead of API calls with master key
    // LANG-1C (docs/slices/lang-1.md § 6.2, § 8.5): the tenant's membership items, read only when it lists extra languages
    // (a one-language tenant makes no extra read and gets today's bytes).
    const hasLanguages = (config.languages ?? []).length > 0;
    const [items, categories, productsResult, translationItems] = await Promise.all([
        getPublishedContent(config.id),
        // CATALOG-MODE-1 (§ 3.3): a catalog site is indexable — its products and categories are listed.
        (config.commerceEnabled || isCatalogMode(config)) ? getAllCategories(config.id) : Promise.resolve([]),
        (config.commerceEnabled || isCatalogMode(config)) ? getActiveProducts(config.id, 1, 1000) : Promise.resolve({ items: [] }),
        hasLanguages ? getTranslationItems(config.id) : Promise.resolve([]),
    ]);

    // Ensure no trailing slash on domain
    const baseUrl = `https://${config.domain.replace(/\/$/, '')}`;
    const prefixes = config.urlPrefixes || {};
    const productPrefix = prefixes.product || '/product';
    const categoryPrefix = prefixes.category || '/category';

    // LANG-1C (§ 8.5): the alternates of each listed member, by node id (the same membership rule and two-member
    // threshold as the head). Empty for a one-language tenant and for a tenant with no listed set.
    const alternatesByNode = hasLanguages
        ? sitemapAlternates(items, translationItems, { languages: config.languages ?? [], locale: config.locale, homePageSlug: config.homePageSlug })
        : new Map<string, TranslationAlternates>();

    // 2. Build URL Nodes for content pages
    const contentNodes = items
        .filter((p: any) => p.status === "Published" || p.status === "Live")
        .map((page: any) => {
            const slug = page.slug.startsWith('/') ? page.slug : `/${page.slug}`;
            const lastMod = page.updatedAt || page.createdAt || new Date().toISOString();
            const priority = slug === '/' ? '1.0' : '0.8';
            return `
  <url>
    <loc>${baseUrl}${slug}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>${alternateLinks(alternatesByNode.get(page.nodeId), baseUrl)}
  </url>`;
        });

    // 3. Build URL Nodes for categories (if commerce enabled)
    const categoryNodes = categories.map((cat: any) => `
  <url>
    <loc>${baseUrl}${categoryPrefix}/${cat.slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`);

    // 4. Build URL Nodes for products (if commerce enabled)
    const productNodes = productsResult.items.map((prod: any) => `
  <url>
    <loc>${baseUrl}${productPrefix}/${prod.slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`);

    const allNodes = [...contentNodes, ...categoryNodes, ...productNodes].join("");

    // 5. Wrap in XML (Trimmed to avoid whitespace errors)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${alternatesByNode.size > 0 ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ""}>
${allNodes}
</urlset>`.trim();

    // FINDINGS-1 Part 5 (F-PREVIEW-SITEMAP-EDGE): the fast-lane purge names `/sitemap.xml` only, which does not match
    // `/_site/<id>/sitemap.xml` or `/tenant/<id>/sitemap.xml`, so a by-id answer is not kept at the edge (CloudFront
    // `minTtl: 0` stores no `no-store` answer). The address form comes from the middleware (`SITEMAP_BY_ID_HEADER`), not
    // from `siteId`: when a tenant's id equals its domain, `siteId` is the same string for both forms.
    const addressedById = request.headers.get(SITEMAP_BY_ID_HEADER) === "1";
    return new NextResponse(xml, {
        headers: {
            "Content-Type": "application/xml",
            // Cache at edge for 1 hour to reduce Lambda costs
            "Cache-Control": addressedById ? "private, no-store" : "public, s-maxage=3600, stale-while-revalidate=59"
        },
    });
}
