import { getTenantConfig, getContentBySlug } from "@/lib/dynamo";
import { RenderBlocks } from "@/components/RenderBlocks";
import { notFound, permanentRedirect } from "next/navigation";
import { Metadata } from "next";

// ISR: Cache pages for 1 hour
export const revalidate = 3600;

type Props = {
    params: Promise<{ siteId: string; slug?: string[] }>;
};

// 1. Dynamic Metadata (SEO)
export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId, slug } = await params;
    const config = await getTenantConfig(siteId);
    if (!config) return {};

    // If slug is undefined, we are at root. Look for "/"
    const slugPath = slug ? "/" + slug.join("/") : "/";

    const content = await getContentBySlug(config.id, slugPath);

    return {
        title: content?.title ? `${content.title} | ${config.name}` : config.name,
    };
}

// 2. The Page Component
export default async function Page({ params }: Props) {
    const { siteId, slug } = await params;

    // Logic: If no slug exists, request the root page "/" from DB
    const slugPath = slug ? "/" + slug.join("/") : "/";

    // A. Resolve Tenant
    const config = await getTenantConfig(siteId);
    if (!config) return notFound();

    // B. Resolve Content
    const content = await getContentBySlug(config.id, slugPath);
    if (!content) return notFound();

    // C. Handle Redirects
    if (content.redirect) {
        permanentRedirect(content.redirect);
    }

    return (
        <main className="max-w-4xl mx-auto py-12 px-6">
            {/* Show title unless it is the root page */}
            {content.title && slugPath !== "/" && (
                <h1 className="text-4xl font-bold mb-8 text-foreground tracking-tight">
                    {content.title}
                </h1>
            )}

            <RenderBlocks blocks={content.blocks} />
        </main>
    );
}
