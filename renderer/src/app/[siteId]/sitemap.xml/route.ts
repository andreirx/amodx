import { getTenantConfig } from "@/lib/dynamo";
import { getMasterKey } from "@/lib/api-client";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic'; // Ensure fresh data

export async function GET(
    request: Request,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);
    if (!config) return new NextResponse("Site not found", { status: 404 });

    const apiKey = await getMasterKey();
    const apiUrl = process.env.API_URL;

    // 1. Fetch Pages from Backend
    const res = await fetch(`${apiUrl}/content`, {
        headers: {
            "x-tenant-id": config.id,
            "x-api-key": apiKey || "",
            "Authorization": "Bearer robot"
        }
    });

    if (!res.ok) {
        console.error(`Sitemap fetch failed: ${res.status}`);
        return new NextResponse("Error generating sitemap", { status: 500 });
    }

    const { items } = await res.json();

    // Ensure no trailing slash on domain
    const baseUrl = `https://${config.domain.replace(/\/$/, '')}`;

    // 2. Build URL Nodes
    const urlNodes = items
        .filter((p: any) => p.status === "Published" || p.status === "Live")
        .map((page: any) => {
            // Ensure slug has leading slash
            const slug = page.slug.startsWith('/') ? page.slug : `/${page.slug}`;
            // Use update time or create time
            const lastMod = page.updatedAt || page.createdAt || new Date().toISOString();
            // Higher priority for Homepage
            const priority = slug === '/' ? '1.0' : '0.8';

            return `
  <url>
    <loc>${baseUrl}${slug}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
        })
        .join("");

    // 3. Wrap in XML (Trimmed to avoid whitespace errors)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlNodes}
</urlset>`.trim();

    return new NextResponse(xml, {
        headers: {
            "Content-Type": "application/xml",
            // Cache at edge for 1 hour to reduce Lambda costs
            "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=59"
        },
    });
}
