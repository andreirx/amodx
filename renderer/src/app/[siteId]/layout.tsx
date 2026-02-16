import { Providers } from "@/components/Providers";
import { getTenantConfig } from "@/lib/dynamo";
import { ThemeInjector } from "@/components/ThemeInjector";
import { Navbar } from "@/components/Navbar";
import { Analytics } from "@/components/Analytics";
import { Metadata } from "next";
import { PaddleLoader } from "@/components/PaddleLoader";
import { CookieConsent } from "@/components/CookieConsent";
import { QuickContact } from "@/components/QuickContact";
import { TopBar } from "@/components/TopBar";
import { FBPixel } from "@/components/FBPixel";
import { PopupManager } from "@/components/PopupManager";

export const revalidate = 3600;

type Props = {
    children: React.ReactNode;
    params: Promise<{ siteId: string }>;
};

// Global Metadata (Favicon & Title Template)
export async function generateMetadata({ params }: { params: Promise<{ siteId: string }> }): Promise<Metadata> {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);

    if (!config) return {};

    const baseUrl = `https://${config.domain}`;

    return {
        title: {
            template: `%s | ${config.name}`,
            default: config.name,
        },
        description: config.description || `Official site for ${config.name}`,
        icons: {
            icon: config.icon || config.logo || '/favicon.ico',
        },
        // NEW: AI & Feed Discovery
        alternates: {
            canonical: baseUrl,
            types: {
                // OpenAI / Standard Product Feed Discovery
                'application/json': `${baseUrl}/openai-feed`,
                // RSS/Atom fallback (using the same feed if valid JSON)
                'application/feed+json': `${baseUrl}/openai-feed`,
            }
        },
        // NEW: Explicitly link llms.txt for AI agents that parse HEAD
        other: {
            "ai-resource": `${baseUrl}/llms.txt`
        }
    };
}

export default async function SiteLayout({ children, params }: Props) {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);

    if (!config) {
        return (
            <Providers>
                <div className="flex h-screen items-center justify-center bg-gray-50">
                    <div className="text-center p-8 bg-white shadow-lg rounded-xl border">
                        <h1 className="text-3xl font-bold text-red-600 mb-2">Site Not Found</h1>
                        <p className="text-gray-500">
                            The domain <span className="font-mono bg-gray-100 px-1 rounded">{siteId}</span> is not configured.
                        </p>
                    </div>
                </div>
            </Providers>
        );
    }

    const cartPrefix = config.urlPrefixes?.cart || "/cos";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

    return (
        <Providers tenantId={config.id} cartPrefix={cartPrefix}>
            <div className="site-wrapper flex flex-col min-h-screen">
                <ThemeInjector theme={config.theme} tenantId={config.id} />

                {/* ANALYTICS INJECTION */}
                <Analytics config={{
                    gaId: config.integrations?.googleAnalyticsId,
                    analytics: config.integrations?.analytics
                }} />

                <PaddleLoader config={config.integrations?.paddle} />

                {/* Facebook Pixel */}
                {config.integrations?.fbPixelId && (
                    <FBPixel pixelId={config.integrations.fbPixelId} />
                )}

                {/* GDPR Cookie Consent Banner */}
                <CookieConsent
                    tenantId={config.id}
                    config={{
                        headline: config.gdpr?.headline,
                        description: config.gdpr?.description,
                        position: config.gdpr?.position || "bottom",
                        primaryColor: config.theme?.primaryColor,
                    }}
                />

                {/* Top Bar */}
                {config.topBar?.show && (
                    <TopBar
                        content={config.topBar.content}
                        quickContactPhone={config.topBar.quickContactPhone}
                        quickContactEmail={config.topBar.quickContactEmail}
                    />
                )}

                <Navbar
                    siteName={config.name}
                    logo={config.logo}
                    links={config.navLinks}
                    showLogo={config.header?.showLogo}
                    showTitle={config.header?.showTitle}
                />

                <div className="flex-1">
                    {children}
                </div>

                <footer className="border-t py-12 bg-muted/30">
                    <div className="max-w-7xl mx-auto px-6 flex justify-between items-center text-sm text-muted-foreground">
                        <p>© {new Date().getFullYear()} {config.name}</p>
                        <div className="flex gap-4">
                            {(config.footerLinks || []).map((link: any, i: number) => (
                                <a key={i} href={link.href} className="hover:text-foreground">{link.label}</a>
                            ))}
                        </div>
                    </div>
                </footer>

                {/* Quick Contact Floating Button */}
                {config.quickContact && (
                    <QuickContact
                        type={config.quickContact.type}
                        value={config.quickContact.value}
                        label={config.quickContact.label}
                    />
                )}

                {/* Popup Manager */}
                {apiUrl && (
                    <PopupManager
                        tenantId={config.id}
                        apiUrl={apiUrl}
                        currentPath="/"
                    />
                )}
            </div>
        </Providers>
    );
}
