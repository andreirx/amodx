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

    const res = await fetch(`${apiUrl}/content`, {
        headers: {
            "x-tenant-id": config.id,
            "x-api-key": apiKey || "",
            "Authorization": "Bearer robot"
        }
    });

    if (!res.ok) {
        console.error(`LLMs fetch failed: ${res.status}`);
        return new NextResponse(`# Error fetching content`, { status: 500 });
    }

    const { items } = await res.json();

    let text = `# ${config.name}\n\n`;
    text += `${config.name} is a website about...\n\n`; // Could pull from description
    text += `## Site Structure\n\n`;

    items
        .filter((p: any) => p.status === "Published" || p.status === "Live")
        .forEach((page: any) => {
            const desc = page.seoDescription ? `: ${page.seoDescription}` : "";
            text += `- [${page.title}](${page.slug})${desc}\n`;
        });

    return new NextResponse(text, {
        headers: { "Content-Type": "text/plain" },
    });
}
