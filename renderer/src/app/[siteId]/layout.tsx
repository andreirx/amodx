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
import { RecaptchaProvider } from "@/components/RecaptchaProvider";
import { URL_PREFIX_DEFAULTS, getCountryPack } from "@amodx/shared";
import { PageEffectWrapper } from "@/components/PageEffectWrapper";
import { ReferralCapture } from "@/components/ReferralCapture";

export const revalidate = false;

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
        // cache-1: this branch must not answer the not-found itself, and must render
        // `children` so the page can.
        //
        // It cannot answer correctly: this layout is shared by the ISR route and the
        // %5Fdyn twin and gets only `{ siteId }`, so it knows neither the rendering mode
        // nor the path — it can pick neither `notFound()` nor the `?nf=1` handoff, and a
        // bare `notFound()` here is stored with the page's own year-long `s-maxage`. It
        // does not need to: `SitePage` / `ProductByIdPage` repeat this lookup and route a
        // null through `notFoundOrHandoff(cacheable, publicPath)`, knowing both facts.
        //
        // Rendering `children` is load-bearing, not cosmetic: a layout that returns early
        // never invokes the page function (an unrendered child element is never
        // evaluated) — which is how the original HTTP-200 "Site Not Found" shell
        // suppressed the page's own not-found. Nothing escapes here: the child always ends
        // in a redirect (ISR) or a 404 (twin) when the tenant is missing.
        console.warn(`[SiteLayout] No tenant record for "${siteId}" — deferring to the page's not-found handoff.`);
        return <>{children}</>;
    }

    const commerceEnabled = config.commerceEnabled ?? false;
    const cartPrefix = config.urlPrefixes?.cart || URL_PREFIX_DEFAULTS.cart;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const showPopups = apiUrl ? await hasActivePopups(config.id) : false;

    return (
        <Providers tenantId={config.id} cartPrefix={commerceEnabled ? cartPrefix : undefined}>
            <div className="site-wrapper flex flex-col min-h-screen">
                {/* Referral attribution trigger — first, so the beacon is issued during
                    HTML parse rather than after hydration. cache-3 moved this out of
                    middleware.ts: `ref`/`utm_source` are no longer in the CloudFront cache
                    key, so a campaign landing is answered from the edge and the origin
                    never sees the page request. The cookie itself is still written
                    server-side, by app/api/ref/route.ts. */}
                <ReferralCapture />

                <ThemeInjector
                    theme={config.theme}
                    tenantId={config.id}
                    recaptchaSiteKey={config.recaptcha?.siteKey || process.env.RECAPTCHA_SITE_KEY}
                />

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

                {/* reCAPTCHA v3 Script — deployment-level always on, tenant can override with own key */}
                {(() => {
                    const recaptchaSiteKey = config.recaptcha?.siteKey || process.env.RECAPTCHA_SITE_KEY;
                    return recaptchaSiteKey ? <RecaptchaProvider siteKey={recaptchaSiteKey} /> : null;
                })()}

                {/* GDPR Cookie Consent Banner */}
                {(() => {
                    const gdprPack = getCountryPack(config.countryCode || "EN").gdpr;
                    return (
                        <CookieConsent
                            tenantId={config.id}
                            config={{
                                headline: config.gdpr?.headline || gdprPack.headline,
                                description: config.gdpr?.description || gdprPack.description,
                                denyAll: config.gdpr?.denyAll || gdprPack.denyAll,
                                necessaryOnly: config.gdpr?.necessaryOnly || gdprPack.necessaryOnly,
                                acceptAll: config.gdpr?.acceptAll || gdprPack.acceptAll,
                                position: config.gdpr?.position || "bottom",
                                primaryColor: config.theme?.primaryColor,
                            }}
                        />
                    );
                })()}

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
                            currency={config.currency || "USD"}
                            contentMaxWidth={config.header?.contentMaxWidth}
                            accountPrefix={config.urlPrefixes?.account || URL_PREFIX_DEFAULTS.account}
                            height={config.commerceBar.height}
                            fontSize={config.commerceBar.fontSize}
                            iconSize={config.commerceBar.iconSize}
                            labels={{
                                signIn: config.commerceStrings?.signIn,
                                accountLabel: config.commerceStrings?.accountLabel,
                            }}
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

                {/* Page-level GPU effect (z-0 behind all content) — zero impact if type is "none" */}
                {config.pageEffect && config.pageEffect.type !== "none" && (
                    <PageEffectWrapper effect={config.pageEffect} />
                )}

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
                            {(config.legalLinks?.termsUrl || config.legalLinks?.privacyUrl || config.legalLinks?.anpcUrl) && (() => {
                                const pack = getCountryPack(config.countryCode || "EN");
                                return (
                                <div className="space-y-1">
                                    <p className="font-semibold text-foreground mb-2">Legal</p>
                                    {config.legalLinks?.termsUrl && (
                                        <a href={config.legalLinks.termsUrl} className="block hover:text-foreground">{config.legalLinks.termsLabel || pack.legal.termsLabel || "Terms & Conditions"}</a>
                                    )}
                                    {config.legalLinks?.privacyUrl && (
                                        <a href={config.legalLinks.privacyUrl} className="block hover:text-foreground">{config.legalLinks.privacyLabel || pack.legal.privacyLabel || "Privacy Policy"}</a>
                                    )}
                                    {config.legalLinks?.anpcUrl && (
                                        <a href={config.legalLinks.anpcUrl} target="_blank" rel="noopener noreferrer" className="block hover:text-foreground">{config.legalLinks.anpcLabel || pack.legal.consumerProtectionLabel || "Consumer Protection"}</a>
                                    )}
                                    {config.legalLinks?.anpcSalUrl && (
                                        <a href={config.legalLinks.anpcSalUrl} target="_blank" rel="noopener noreferrer" className="block hover:text-foreground">{config.legalLinks.anpcSalLabel || pack.legal.disputeResolutionLabel || "Dispute Resolution"}</a>
                                    )}
                                </div>
                                );
                            })()}
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
