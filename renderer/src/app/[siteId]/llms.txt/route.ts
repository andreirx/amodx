import { getTenantConfig, getPublishedContent } from "@/lib/dynamo";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);
    if (!config) return new NextResponse("", { status: 404 });

    // Phase 2.4: Direct DynamoDB reads instead of API calls with master key
    const items = await getPublishedContent(config.id);

    let text = `# ${config.name}\n\n`;

    // NEW: Use the actual description
    if (config.description) {
        text += `${config.description}\n\n`;
    } else {
        text += `A website for ${config.name}.\n\n`;
    }
    text += `## Site Structure\n\n`;

    items.forEach((page: any) => {
        const desc = page.seoDescription ? `: ${page.seoDescription}` : "";
        text += `- [${page.title}](${page.slug})${desc}\n`;
    });

    return new NextResponse(text, {
        headers: { "Content-Type": "text/plain" },
    });
}
