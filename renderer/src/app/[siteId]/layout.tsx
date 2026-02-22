import { Providers } from "@/components/Providers";
import { getTenantConfig, hasActivePopups } from "@/lib/dynamo";
import { ThemeInjector } from "@/components/ThemeInjector";
import { Navbar } from "@/components/Navbar";
import { Analytics } from "@/components/Analytics";
import { Metadata } from "next";
import { PaddleLoader } from "@/components/PaddleLoader";
import { CookieConsent } from "@/components/CookieConsent";
import { QuickContact } from "@/components/QuickContact";
import { TopBar } from "@/components/TopBar";
import { CommerceBar } from "@/components/CommerceBar";
import { FBPixel } from "@/components/FBPixel";
import { PopupManager } from "@/components/PopupManager";
import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

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

    const commerceEnabled = config.commerceEnabled ?? false;
    const cartPrefix = config.urlPrefixes?.cart || URL_PREFIX_DEFAULTS.cart;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const showPopups = apiUrl ? await hasActivePopups(config.id) : false;

    return (
        <Providers tenantId={config.id} cartPrefix={commerceEnabled ? cartPrefix : undefined}>
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

                {/* Sticky Header Wrapper */}
                <div className="sticky top-0 z-50">
                    {/* Top Bar (announcement) */}
                    {config.topBar?.show && (
                        <TopBar
                            content={config.topBar.content}
                            quickContactPhone={config.topBar.quickContactPhone}
                            quickContactEmail={config.topBar.quickContactEmail}
                            contentMaxWidth={config.header?.contentMaxWidth}
                        />
                    )}

                    {/* Commerce Bar (utility: phone, social, cart, CTA) */}
                    {config.commerceBar?.enabled && commerceEnabled && (
                        <CommerceBar
                            phone={config.commerceBar.phone}
                            whatsappNumber={config.commerceBar.whatsappNumber}
                            socialLinks={config.commerceBar.socialLinks}
                            ctaButton={config.commerceBar.ctaButton}
                            currency={config.currency || "RON"}
                            contentMaxWidth={config.header?.contentMaxWidth}
                            accountPrefix={config.urlPrefixes?.account || URL_PREFIX_DEFAULTS.account}
                            height={config.commerceBar.height}
                            fontSize={config.commerceBar.fontSize}
                            iconSize={config.commerceBar.iconSize}
                        />
                    )}

                    <Navbar
                        siteName={config.name}
                        logo={config.logo}
                        links={config.navLinks}
                        showLogo={config.header?.showLogo}
                        showTitle={config.header?.showTitle}
                        commerceEnabled={commerceEnabled}
                        hideContactButton={!!(config.commerceBar?.enabled && commerceEnabled)}
                        accountPrefix={config.urlPrefixes?.account || URL_PREFIX_DEFAULTS.account}
                        navHeight={config.header?.navHeight}
                        navHeightScrolled={config.header?.navHeightScrolled}
                        logoHeight={config.header?.logoHeight}
                        logoHeightScrolled={config.header?.logoHeightScrolled}
                        titleSize={config.header?.titleSize}
                        titleSizeScrolled={config.header?.titleSizeScrolled}
                        contentMaxWidth={config.header?.contentMaxWidth}
                    />
                </div>

                <div className="flex-1">
                    {children}
                </div>

                <footer className="border-t py-12 bg-muted/30">
                    <div className={`${config.header?.contentMaxWidth || "max-w-7xl"} mx-auto px-6`}>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-muted-foreground">
                            {/* Column 1: Company Details */}
                            {(config.companyDetails?.legalName || config.companyDetails?.address || config.companyDetails?.cui) && (
                                <div className="space-y-1">
                                    {config.companyDetails?.legalName && (
                                        <p className="font-semibold text-foreground">{config.companyDetails.legalName}</p>
                                    )}
                                    {config.companyDetails?.address && <p>{config.companyDetails.address}</p>}
                                    {config.companyDetails?.cui && <p>CUI: {config.companyDetails.cui}</p>}
                                    {config.companyDetails?.tradeRegister && <p>Reg: {config.companyDetails.tradeRegister}</p>}
                                    {config.companyDetails?.phone && <p>Tel: {config.companyDetails.phone}</p>}
                                    {config.companyDetails?.email && <p>{config.companyDetails.email}</p>}
                                </div>
                            )}

                            {/* Column 2: Footer Links */}
                            {(config.footerLinks || []).length > 0 && (
                                <div className="space-y-1">
                                    <p className="font-semibold text-foreground mb-2">Links</p>
                                    {(config.footerLinks || []).map((link: any, i: number) => (
                                        <a key={i} href={link.href} className="block hover:text-foreground">{link.label}</a>
                                    ))}
                                </div>
                            )}

                            {/* Column 3: Legal Links */}
                            {(config.legalLinks?.termsUrl || config.legalLinks?.privacyUrl || config.legalLinks?.anpcUrl) && (
                                <div className="space-y-1">
                                    <p className="font-semibold text-foreground mb-2">Legal</p>
                                    {config.legalLinks?.termsUrl && (
                                        <a href={config.legalLinks.termsUrl} className="block hover:text-foreground">Termeni și condiții</a>
                                    )}
                                    {config.legalLinks?.privacyUrl && (
                                        <a href={config.legalLinks.privacyUrl} className="block hover:text-foreground">Politica de confidențialitate</a>
                                    )}
                                    {config.legalLinks?.anpcUrl && (
                                        <a href={config.legalLinks.anpcUrl} target="_blank" rel="noopener noreferrer" className="block hover:text-foreground">ANPC</a>
                                    )}
                                    {config.legalLinks?.anpcSalUrl && (
                                        <a href={config.legalLinks.anpcSalUrl} target="_blank" rel="noopener noreferrer" className="block hover:text-foreground">Soluționare alternativă a litigiilor</a>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="mt-8 pt-4 border-t text-center text-xs text-muted-foreground">
                            <p>© {new Date().getFullYear()} {config.companyDetails?.legalName || config.name}. All rights reserved.</p>
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

                {/* Popup Manager — only rendered if tenant has active popups (checked server-side) */}
                {showPopups && (
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
