import { getTenantConfig, getContentBySlug } from "@/lib/dynamo";
import { RenderBlocks } from "@/components/RenderBlocks";
import { ThemeInjector } from "@/components/ThemeInjector";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

// Force Next.js to not cache indefinitely
export const dynamic = "force-dynamic";

export default async function Page({
                                       params,
                                   }: {
    params: Promise<{ slug: string[] }>; // Updated for Next.js 15 type strictness
}) {
    // 1. Identify Tenant
    const headersList = await headers();
    const host = headersList.get("x-amodx-host") || "localhost";

    const config = await getTenantConfig(host);

    if (!config) {
        return (
            <div className="p-10 text-center">
                <h1 className="text-2xl font-bold">Site Not Found</h1>
                <p>No configuration found for domain: {host}</p>
            </div>
        );
    }

    // 2. Resolve Content
    // Await params (Next.js 15 requirement)
    const resolvedParams = await params;
    const slugPath = "/" + resolvedParams.slug.join("/");

    // FIX: Use config.id instead of config.tenantId
    const content = await getContentBySlug(config.id, slugPath);

    if (!content) {
        return notFound();
    }

    // 3. Render
    return (
        <>
            <ThemeInjector theme={config.theme} />
            <main className="min-h-screen bg-white">
                <div className="max-w-4xl mx-auto py-12 px-6">
                    {/* Optional: Render Title if not in blocks */}
                    <h1 className="text-4xl font-bold mb-8">{content.title}</h1>

                    <RenderBlocks blocks={content.blocks} />
                </div>
            </main>
        </>
    );
}
