import { getTenantConfig } from "@/lib/dynamo";
import { getMasterKey } from "@/lib/api-client";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);
    if (!config) return new NextResponse("", { status: 404 });

    const apiKey = await getMasterKey();
    const apiUrl = process.env.API_URL;

    // Fetch All Pages
    const res = await fetch(`${apiUrl}/content`, {
        headers: {
            "x-tenant-id": config.id,
            "x-api-key": apiKey || "",
            "Authorization": "Bearer robot"
        }
    });

    if (!res.ok) {
        console.error(`Sitemap fetch failed: ${res.status} ${res.statusText}`);
        return new NextResponse("", { status: res.status });
    }

    const { items } = await res.json();
    // Use the domain from config, or fallback to the request host if needed
    const baseUrl = `https://${config.domain}`;

    const urls = items
        .filter((p: any) => p.status === "Published" || p.status === "Live")
        .map((page: any) => {
            return `
  <url>
    <loc>${baseUrl}${page.slug}</loc>
    <lastmod>${page.updatedAt || page.createdAt}</lastmod>
    <changefreq>weekly</changefreq>
  </url>`;
        })
        .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    return new NextResponse(xml, {
        headers: { "Content-Type": "text/xml" }, // Fixed content type
    });
}
