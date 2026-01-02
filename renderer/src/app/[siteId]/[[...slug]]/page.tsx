import { getTenantConfig, getContentBySlug, ContentResult } from "@/lib/dynamo";
import { RenderBlocks } from "@/components/RenderBlocks";
import { notFound, permanentRedirect } from "next/navigation";
import { Metadata } from "next";
import { ContentItem } from "@amodx/shared";
import Link from "next/link"; // For the Login Button
import { CommentsSection } from "@/components/CommentsSection";
import { ThemeInjector } from "@/components/ThemeInjector";
import { SocialShare } from "@/components/SocialShare";
import Script from "next/script";

export const revalidate = 3600;

type Props = {
    params: Promise<{ siteId: string; slug?: string[] }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
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
    // Construct absolute URL
    const canonicalUrl = `https://${config.domain}${slugPath === '/' ? '' : slugPath}`;

    return {
        title: content.seoTitle || content.title || config.name,
        description: content.seoDescription,
        // NEW: Explicit Base for relative assets
        metadataBase: new URL(`https://${config.domain}`),
        openGraph: {
            title: content.seoTitle || content.title,
            description: content.seoDescription,
            url: canonicalUrl, // <--- Ahrefs needs this
            type: 'website',   // <--- And this
            images: content.featuredImage
                ? [{ url: content.featuredImage }]
                : (config.logo ? [{ url: config.logo }] : []), // Fallback to logo
            siteName: config.name,
        },
        alternates: {
            canonical: canonicalUrl,
        }
    };
}

export default async function Page({ params, searchParams }: Props) {
    const { siteId, slug } = await params;
    const { preview } = await searchParams; // Read ?preview=true
    const slugPath = slug ? "/" + slug.join("/") : "/";

    const config = await getTenantConfig(siteId);
    if (!config) return notFound();

    const result = await getContentBySlug(config.id, slugPath);
    if (!result) return notFound();

    // 1. Handle Redirects
    if ('redirect' in result) {
        permanentRedirect(result.redirect);
    }

    const content = result as ContentItem;

    // 2. STATUS CHECK (Draft vs Published)
    // If Draft AND not in preview mode -> 404
    // NOTE: In a real secure system, 'preview=true' should verify a signed token.
    // For now, we allow it so you can test, but add a TODO to secure it.
    if (content.status !== 'Published' && !preview) {
        return notFound();
    }

    // 3. ACCESS GATEKEEPER (The Plumbing)
    // We check the policy. If not Public, we check the session (Placeholder for now).
    const policy = content.accessPolicy || { type: 'Public' };
    const isPublic = policy.type === 'Public';

    // --- SCHEMA GENERATOR ---
    const globalSchemaType = config.schemaType || "Organization";
    const pageSchemaType = content.schemaType; // might be undefined

    // 1. Determine the Entity Type
    // If it's the homepage ('/'), we use the Global Type (e.g. SoftwareApplication)
    // If it's an internal page, we default to WebPage unless overridden (e.g. Article)
    const isHome = slugPath === '/';
    const effectiveType = pageSchemaType || (isHome ? globalSchemaType : 'WebPage');

    const canonicalUrl = `https://${config.domain}${slugPath === '/' ? '' : slugPath}`;

    let jsonLd: any = {
        "@context": "https://schema.org",
        "@type": effectiveType,
        "name": content.seoTitle || content.title || config.name,
        "description": content.seoDescription || config.description,
        "url": canonicalUrl,
    };

    // 2. Specific Enhancements based on Type
    if (effectiveType === 'SoftwareApplication') {
        jsonLd = {
            ...jsonLd,
            "applicationCategory": "BusinessApplication",
            "operatingSystem": "Cloud/Web",
            "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
            }
        };
    } else if (effectiveType === 'Article') {
        jsonLd = {
            ...jsonLd,
            "headline": content.title,
            "image": content.featuredImage ? [content.featuredImage] : [],
            "datePublished": content.createdAt,
            "dateModified": content.updatedAt || content.createdAt,
            "author": {
                "@type": "Person",
                "name": content.author || config.name
            }
        };
    } else if (effectiveType === 'Organization' || effectiveType === 'LocalBusiness') {
        jsonLd = {
            ...jsonLd,
            "logo": config.logo,
            "contactPoint": config.integrations?.contactEmail ? {
                "@type": "ContactPoint",
                "email": config.integrations.contactEmail,
                "contactType": "customer service"
            } : undefined
        };
    }

    // TODO: Connect to NextAuth session here
    const isAuthenticated = false; // Mock: Assume user is anon for now
    const hasAccess = isPublic || isAuthenticated;

    // If Access Denied, render the Gate instead of the Content
    if (!hasAccess) {
        return (
            <main className="max-w-4xl mx-auto py-20 px-6 text-center space-y-6">
                <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                    <span className="text-2xl">🔒</span>
                </div>

                <h1 className="text-4xl font-bold tracking-tight">Restricted Access</h1>

                <p className="text-xl text-muted-foreground max-w-lg mx-auto">
                    {policy.type === 'LoginRequired' && "You must be logged in to view this page."}
                    {policy.type === 'Purchase' && `This content requires a subscription (${policy.currency} ${policy.price}).`}
                </p>

                <div className="flex gap-4 justify-center pt-4">
                    {/* PLUMBING: Login Button redirects to Auth with callback to current page */}
                    <Link
                        href={`/api/auth/signin?callbackUrl=${encodeURIComponent(slugPath)}`}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-10 px-8 hover:opacity-90"
                    >
                        Log In
                    </Link>

                    {policy.type === 'Purchase' && (
                        <button className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-10 px-8">
                            Purchase Access
                        </button>
                    )}
                </div>
            </main>
        );
    }

    // 1. Theme Override Logic
    // We merge the GLOBAL theme with the PAGE override to ensure completeness
    // If we passed just the partial override, ThemeInjector might default missing keys to black/white.
    const mergedTheme = {
        ...config.theme,
        ...(content.themeOverride || {})
    };

    const hasThemeOverride = content.themeOverride && Object.keys(content.themeOverride).length > 0;

    return (
        <main className="max-w-4xl mx-auto py-12 px-6 relative">
            {/* SCHEMA INJECTION */}
            <Script
                id="json-ld-schema"
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />

            {/* A. Apply Color Overrides (if any) */}
            {hasThemeOverride && (
                <ThemeInjector theme={mergedTheme} tenantId={config.id} />
            )}

            {/* B. Apply Hide Nav/Footer Logic */}
            {(content.hideNav || content.hideFooter) && (
                <style dangerouslySetInnerHTML={{
                    __html: `
                        ${content.hideNav ? 'nav, .site-navbar { display: none !important; }' : ''}
                        ${content.hideFooter ? 'footer, .site-footer { display: none !important; }' : ''}
                    `
                }} />
            )}

            {/* DRAFT WATERMARK */}
            {content.status === 'Draft' && (
                <div className="absolute top-0 left-0 w-full bg-yellow-100 border-b border-yellow-200 text-yellow-800 text-xs font-bold text-center py-2 uppercase tracking-widest z-50">
                    Draft Preview Mode
                </div>
            )}

            {/* Title (Hide on Home) */}
            {content.title && slugPath !== "/" && (
                <h1 className="text-4xl font-bold mb-8 text-foreground tracking-tight">
                    {content.title}
                </h1>
            )}

            {!content.hideSharing && <SocialShare title={content.title} />}

            <RenderBlocks blocks={content.blocks} />

            <CommentsSection pageId={content.nodeId} mode={content.commentsMode} />
        </main>
    );
}
