import { getTenantConfig, getContentBySlug } from "@/lib/dynamo";
import { RenderBlocks } from "@/components/RenderBlocks";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page({
                                       params,
                                   }: {
    params: Promise<{ slug: string[] }>;
}) {
    // 1. Context Resolution
    const headersList = await headers();
    const host = headersList.get("x-amodx-host") || "localhost";
    const config = await getTenantConfig(host);

    if (!config) return notFound(); // Should be caught by Layout, but good safety

    // 2. Content Resolution
    const resolvedParams = await params;
    const slugPath = "/" + resolvedParams.slug.join("/");

    const content = await getContentBySlug(config.id, slugPath);

    if (!content) {
        return notFound();
    }

    // --- HANDLE REDIRECT ---
    if (content.redirect) {
        permanentRedirect(content.redirect); // Returns 308 to browser
    }

    // 3. Render Content Only
    return (
        <main className="max-w-4xl mx-auto py-12 px-6">
            {/* Optional: Render Title if not in blocks */}
            {content.title && (
                <h1 className="text-4xl font-bold mb-8 text-gray-900 tracking-tight">
                    {content.title}
                </h1>
            )}

            <RenderBlocks blocks={content.blocks} />
        </main>
    );
}
