import { getTenantConfig, getPublishedContent, getAllCategories, getActiveProducts } from "@/lib/dynamo";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic'; // Ensure fresh data

export async function GET(
    request: Request,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);
    if (!config) return new NextResponse("Site not found", { status: 404 });

    // Phase 2.4: Direct DynamoDB reads instead of API calls with master key
    const [items, categories, productsResult] = await Promise.all([
        getPublishedContent(config.id),
        config.commerceEnabled ? getAllCategories(config.id) : Promise.resolve([]),
        config.commerceEnabled ? getActiveProducts(config.id, 1, 1000) : Promise.resolve({ items: [] })
    ]);

    // Ensure no trailing slash on domain
    const baseUrl = `https://${config.domain.replace(/\/$/, '')}`;
    const prefixes = config.urlPrefixes || {};
    const productPrefix = prefixes.product || '/product';
    const categoryPrefix = prefixes.category || '/category';

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
    <priority>${priority}</priority>
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
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allNodes}
</urlset>`.trim();

    return new NextResponse(xml, {
        headers: {
            "Content-Type": "application/xml",
            // Cache at edge for 1 hour to reduce Lambda costs
            "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=59"
        },
    });
}
