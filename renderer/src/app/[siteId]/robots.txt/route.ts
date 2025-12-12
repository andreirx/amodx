import { getTenantConfig } from "@/lib/dynamo";
import { NextResponse } from "next/server";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);

    if (!config) return new NextResponse("User-agent: *\nDisallow: /", { status: 404 });

    const baseUrl = `https://${config.domain}`; // Assuming domain is the public URL
    const isLive = config.status === "LIVE";

    const rules = isLive
        ? `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml`
        : `User-agent: *\nDisallow: /`;

    return new NextResponse(rules, {
        headers: { "Content-Type": "text/plain" },
    });
}
