import { getTenantConfig, getContentBySlug } from "@/lib/dynamo";
import { RenderBlocks } from "@/components/RenderBlocks";
import { notFound, permanentRedirect } from "next/navigation";
import { Metadata } from "next";
import { ContentItem } from "@amodx/shared";
import Link from "next/link";
import { CommentsSection } from "@/components/CommentsSection";
import { ThemeInjector } from "@/components/ThemeInjector";
import { SocialShare } from "@/components/SocialShare";
import Script from "next/script";

// NEW: Auth Imports
import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";

export const revalidate = 3600; // Default to ISR

type Props = {
    params: Promise<{ siteId: string; slug?: string[] }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// ... [generateMetadata remains the same] ...
export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId, slug } = await params;
    const config = await getTenantConfig(siteId);
    if (!config) return {};

    const slugPath = slug ? "/" + slug.join("/") : "/";
    const result = await getContentBySlug(config.id, slugPath);

    if (!result || 'redirect' in result) return { title: config.name };

    const content = result as ContentItem;
    const canonicalUrl = `https://${config.domain}${slugPath === '/' ? '' : slugPath}`;

    return {
        title: content.seoTitle || content.title || config.name,
        description: content.seoDescription,
        metadataBase: new URL(`https://${config.domain}`),
        openGraph: {
            title: content.seoTitle || content.title,
            description: content.seoDescription,
            url: canonicalUrl,
            type: 'website',
            images: content.featuredImage
                ? [{ url: content.featuredImage }]
                : (config.logo ? [{ url: config.logo }] : []),
            siteName: config.name,
        },
        alternates: {
            canonical: canonicalUrl,
        }
    };
}

export default async function Page({ params, searchParams }: Props) {
    const { siteId, slug } = await params;
    const { preview } = await searchParams;
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

    // Status Check
    if (content.status !== 'Published' && !preview) {
        return notFound();
    }

    // --- ACCESS GATEKEEPER ---
    const policy = content.accessPolicy || { type: 'Public' };
    const isPublic = policy.type === 'Public';

    let isAuthenticated = false;

    // Only check auth if necessary (Preserves ISR for public pages)
    if (!isPublic) {
        const cookieStore = await cookies();
        const sessionToken = cookieStore.get("next-auth.session-token")?.value ||
            cookieStore.get("__Secure-next-auth.session-token")?.value;

        if (sessionToken && process.env.NEXTAUTH_SECRET) {
            try {
                // Verify the JWT signature to prevent cookie spoofing
                const decoded = await decode({
                    token: sessionToken,
                    secret: process.env.NEXTAUTH_SECRET
                });
                if (decoded) isAuthenticated = true;
            } catch (e) {
                console.warn("Invalid session token", e);
            }
        }
    }

    const hasAccess = isPublic || isAuthenticated;

    // --- SCHEMA GENERATOR ---
    const globalSchemaType = config.schemaType || "Organization";
    const pageSchemaType = content.schemaType;

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

    if (effectiveType === 'SoftwareApplication') {
        jsonLd = {
            ...jsonLd,
            "applicationCategory": "BusinessApplication",
            "operatingSystem": "Cloud/Web",
            "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
        };
    } else if (effectiveType === 'Article') {
        jsonLd = {
            ...jsonLd,
            "headline": content.title,
            "image": content.featuredImage ? [content.featuredImage] : [],
            "datePublished": content.createdAt,
            "dateModified": content.updatedAt || content.createdAt,
            "author": { "@type": "Person", "name": content.author || config.name }
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

    // --- RENDER: ACCESS DENIED ---
    if (!hasAccess) {
        return (
            <>
                <ThemeInjector theme={config.theme} tenantId={config.id} />
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
                        <Link
                            href={`/api/auth/signin?callbackUrl=${encodeURIComponent(slugPath)}`}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-10 px-8 hover:opacity-90 transition-opacity"
                        >
                            Log In with Google
                        </Link>

                        {policy.type === 'Purchase' && (
                            <button className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-10 px-8">
                                Purchase Access
                            </button>
                        )}
                    </div>
                </main>
            </>
        );
    }

    // --- RENDER: CONTENT ---
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

            <RenderBlocks blocks={content.blocks} tenantId={config.id} />

            <CommentsSection pageId={content.nodeId} mode={content.commentsMode} />
        </main>
    );
}
