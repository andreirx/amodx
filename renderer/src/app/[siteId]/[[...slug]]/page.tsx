import { getTenantConfig, getContentBySlug, ContentResult } from "@/lib/dynamo";
import { RenderBlocks } from "@/components/RenderBlocks";
import { notFound, permanentRedirect } from "next/navigation";
import { Metadata } from "next";
import { ContentItem } from "@amodx/shared"; // Import type

export const revalidate = 3600;

type Props = {
    params: Promise<{ siteId: string; slug?: string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId, slug } = await params;
    const config = await getTenantConfig(siteId);
    if (!config) return {};

    const slugPath = slug ? "/" + slug.join("/") : "/";
    const result = await getContentBySlug(config.id, slugPath);

    // If result is redirect or null, return minimal metadata
    if (!result || 'redirect' in result) return { title: config.name };

    // Result is ContentItem
    const content = result as ContentItem;

    return {
        title: content.seoTitle || content.title || config.name,
        description: content.seoDescription,
        openGraph: {
            title: content.seoTitle || content.title,
            description: content.seoDescription,
            images: content.featuredImage ? [{ url: content.featuredImage }] : [],
            siteName: config.name,
        }
    };
}

export default async function Page({ params }: Props) {
    const { siteId, slug } = await params;
    const slugPath = slug ? "/" + slug.join("/") : "/";

    const config = await getTenantConfig(siteId);
    if (!config) return notFound();

    const result = await getContentBySlug(config.id, slugPath);
    if (!result) return notFound();

    // TYPE GUARD: Handle Redirect
    if ('redirect' in result) {
        permanentRedirect(result.redirect);
    }

    // Now TypeScript knows result is ContentItem
    const content = result as ContentItem;

    return (
        <main className="max-w-4xl mx-auto py-12 px-6">
            {content.title && slugPath !== "/" && (
                <h1 className="text-4xl font-bold mb-8 text-foreground tracking-tight">
                    {content.title}
                </h1>
            )}

            <RenderBlocks blocks={content.blocks} />
        </main>
    );
}
