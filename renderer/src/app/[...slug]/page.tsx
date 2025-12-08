import { getTenantConfig, getContentBySlug } from "@/lib/dynamo";
import { RenderBlocks } from "@/components/RenderBlocks";
import { ThemeInjector } from "@/components/ThemeInjector";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

// This forces Next.js to not cache this page indefinitely at build time,
// allowing our On-Demand ISR strategy to work.
export const dynamic = "force-static";
export const revalidate = 60; // Fallback: revalidate every 60s if events fail

export default async function Page({
                                       params,
                                   }: {
    params: { slug: string[] };
}) {
    // 1. Identify Tenant
    // We read the header set by middleware.ts
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
    // Join the slug array back into a path string (e.g., ["about", "us"] -> "/about/us")
    const slugPath = "/" + (await params).slug.join("/");

    const content = await getContentBySlug(config.tenantId, slugPath);

    if (!content) {
        return notFound(); // Renders the default Next.js 404 page
    }

    // 3. Render
    return (
        <>
            {/* Inject the Client's Colors */}
            <ThemeInjector theme={config.theme} />

            <main className="min-h-screen bg-white">
                {/* Render the Dynamic Bricks */}
                <RenderBlocks blocks={content.blocks} />
            </main>
        </>
    );
}
