// LOCALE-1E (docs/slices/locale-1e.md): this is the ROOT layout. Next writes `<html>` only in a root layout, and a
// root layout at `app/layout.tsx` receives no route parameters, so it could not know the tenant; `<html>`/`<body>`
// moved here (the `app/[lang]/layout.tsx` pattern) and `app/layout.tsx` was deleted. Its stylesheet import and its
// `<body>` class moved with it, unchanged. `lang` = the language subtag of the tenant's normalised locale. This
// layout reads only `params` and the tenant record: a request API (`headers()`, `cookies()`) here would make every
// page dynamic and break the ISR cache.
import "../globals.css";
import { Providers } from "@/components/Providers";
import { getTenantConfig, hasActivePopups, getActiveCategoriesByIds } from "@/lib/dynamo";
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
import { URL_PREFIX_DEFAULTS, isCatalogMode, resolveLocaleStrings, fillTemplate, localeLanguageSubtag, isCssColor, urlPrefixesOf, type TenantConfig } from "@amodx/shared";
import { PageEffectWrapper } from "@/components/PageEffectWrapper";
import { ReferralCapture } from "@/components/ReferralCapture";
import { BODY_CLASS_NAME } from "@/lib/document-shell";
import { sanitizeFontFamily } from "@/lib/sanitize";

export const revalidate = false;

/**
 * LOCALE-1A — a site-part template split at its `{placeholders}` into React children: each text segment, and each
 * value as its OWN child (numbers stay numbers); empty segments are dropped; an unknown placeholder stays as written.
 * Used for the footer copyright only. `"© {year} {name}. All rights reserved."` gives exactly the children of the JSX
 * this slice replaced (`© {year} {name}. All rights reserved.`), so the HTML (`© <!-- -->2026<!-- --> <!-- -->…`) and
 * the RSC row are byte-identical, and the clock-derived year stays the separate text node that the CM1-A1
 * footer-year canonicalisation matches (`cm1-byte-identity.mjs`, step 4). `fillTemplate` would merge it into one
 * string and put a literal year into the strict byte baseline.
 */
function interpolate(template: string, values: Record<string, string | number>): (string | number)[] {
    return template.split(/\{([A-Za-z0-9_]+)\}/)
        .map((piece, i) => (i % 2 === 0 ? piece : Object.prototype.hasOwnProperty.call(values, piece) ? values[piece] : `{${piece}}`))
        .filter((part) => part !== "");
}

/**
 * BULK-PURGE-FOOTER-1 (Part B) — the `<footer>` element's inline style for `footer.backgroundColor` / `footer.textColor`
 * (one value for the light and the dark theme); `undefined` when neither is set, and then the caller adds no `style`
 * prop at all (a conditional spread: an RSC payload would encode `style: undefined` as `"$undefined"`), so the footer
 * keeps today's bytes in the HTML and in the payload.
 * - Background: `background-color`, which overrides the shape's class (`bg-muted/30`, editorial `bg-muted`).
 * - Text: the footer's texts take their colour from Tailwind utilities that read `--color-foreground` and
 *   `--color-muted-foreground` (`text-foreground`, `text-muted-foreground`, `hover:text-foreground`; `globals.css`
 *   `@theme`). Re-declaring those two variables on the `<footer>` gives every text inside it — hover included — the one
 *   colour, so a hover stays readable on the chosen background. Not `--foreground`: `@theme` declares
 *   `--color-foreground: var(--foreground)` on `:root`, where the `var()` is resolved, so a footer-level `--foreground`
 *   would reach nothing. The hairlines (`border-t`, `--color-border`) keep the theme's colour.
 * A value outside the shared colour rule (`isCssColor`, the rule PUT /settings validates with) is ignored, as
 * `ThemeInjector` ignores an invalid theme colour.
 */
function footerColorStyle(footer: TenantConfig["footer"]): React.CSSProperties | undefined {
    const background = isCssColor(footer?.backgroundColor) ? footer.backgroundColor : undefined;
    const text = isCssColor(footer?.textColor) ? footer.textColor : undefined;
    if (!background && !text) return undefined;
    return {
        ...(background ? { backgroundColor: background } : {}),
        ...(text ? { "--color-foreground": text, "--color-muted-foreground": text } : {}),
    } as React.CSSProperties;
}

/**
 * HEADER-COLOURS-1 — the navbar `<nav>`'s inline style for `header.backgroundColor` / `header.textColor` (one value for
 * the light and the dark theme); `undefined` when neither is set, and then the layout passes NO `colorStyle` prop to the
 * Navbar (a conditional spread), so the HTML and the RSC payload keep today's bytes. The Top Bar, the Commerce Bar and
 * the Search Bar are siblings of the `<nav>`, not inside it: they keep the theme's colours.
 * - Background: re-declares `--color-background`, which the navbar's three background utilities read (`bg-background/80`
 *   on the `<nav>`, `bg-background` on the desktop dropdown panel and on the mobile panel; compiled
 *   `background-color: var(--color-background)` and, where `color-mix` exists,
 *   `color-mix(in oklab, var(--color-background) 80%, transparent)`). So the bar keeps its 80 % translucency and blur,
 *   and both panels — DOM descendants of the `<nav>` — take the same colour, full and scrolled. Not `background-color`
 *   (as the footer does): that would make the bar opaque and leave the panels on the theme's background.
 * - Text: the same two variables as the footer (`--color-foreground`, `--color-muted-foreground`; see `footerColorStyle`
 *   for why not `--foreground`): the title, the links, the icons (`currentColor`) and the menu button. `hover:text-primary`
 *   reads `--color-primary` and the contact button `--color-primary` / `--color-primary-foreground`: both unchanged.
 * A different function from `footerColorStyle` because the background mechanism differs (a variable here, the property
 * there); one function would need a flag that changes what it emits.
 * A value outside the shared colour rule (`isCssColor`) is ignored, as for the footer.
 */
function headerColorStyle(header: TenantConfig["header"]): React.CSSProperties | undefined {
    const background = isCssColor(header?.backgroundColor) ? header.backgroundColor : undefined;
    const text = isCssColor(header?.textColor) ? header.textColor : undefined;
    if (!background && !text) return undefined;
    return {
        ...(background ? { "--color-background": background } : {}),
        ...(text ? { "--color-foreground": text, "--color-muted-foreground": text } : {}),
    } as React.CSSProperties;
}

/**
 * SHOP-LOOK-1A (docs/slices/shop-look-1.md § 6.2) — the `lg:` column class of the footer grid with named columns, one
 * literal per count (Tailwind compiles only the classes the sources name literally). The count is every column the grid
 * holds: the brand text, the named columns (≤ 4) and the three existing columns (≤ 3), so at most 8.
 */
const FOOTER_LG_COLUMNS = ["", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4", "lg:grid-cols-5", "lg:grid-cols-6", "lg:grid-cols-7", "lg:grid-cols-8"];

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
        description: config.description || fillTemplate(resolveLocaleStrings(config).strings.site.metaSiteDescription, { name: config.name }),
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

/**
 * CAT-QUOTE-1 (docs/slices/cat-quote-1.md § 3 item 1, CQ-D1 = A): a bar's own contact value, or — only when that value
 * is empty — the tenant's contact channel (`contactChannels`, Settings → Contact channels). Without a channel the own
 * value is returned as it is (`""` stays `""`, absent stays absent), so a tenant without `contactChannels` renders the
 * same props, hence the same bytes.
 */
function ownOrChannel<T extends string | undefined>(own: T, channel: string | undefined): T | string {
    return !own && channel ? channel : own;
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
        //
        // LOCALE-1E: as the root layout it must still emit `<html>`/`<body>` around `children` (Next requires both in a
        // root layout); `lang` is the § 3.3 fallback, "en", as before the move.
        console.warn(`[SiteLayout] No tenant record for "${siteId}" — deferring to the page's not-found handoff.`);
        return (
            <html lang={localeLanguageSubtag(undefined)}>
            <body className={BODY_CLASS_NAME}>
            {children}
            </body>
            </html>
        );
    }

    const commerceEnabled = config.commerceEnabled ?? false;
    const cartPrefix = config.urlPrefixes?.cart || URL_PREFIX_DEFAULTS.cart;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const showPopups = apiUrl ? await hasActivePopups(config.id) : false;
    // LOCALE-1A: the tenant's locale table, resolved once per request (docs/slices/locale-1.md § 5.3). Each client
    // component below receives only the keys it renders, as a plain prop. LOCALE-1B: `catalog` for the interest widget.
    // LOCALE-1D: `commerce` for the commerce bar and the navbar account links (commerce sites only); `defaults` for the
    // two pattern-F texts of the commerce bar (§ 5.2: a stored "" falls back to the language default).
    const { strings: { site, catalog, commerce }, defaults } = resolveLocaleStrings(config);
    const channels = config.contactChannels;
    // CAT-THEME-1 (docs/slices/cat-theme-1-impl.md § 3): the `editorial` shape and the nav font, decided once here. Each
    // is passed to a client component by a conditional spread and switches a class only when set, so a tenant without
    // them renders the same props and classes. `navFont` uses the injector's own test (a valid font name).
    const editorial = config.theme?.shape === "editorial";
    const navFont = !!sanitizeFontFamily(config.theme?.fontNav as string, "");
    const footerStyle = footerColorStyle(config.footer);
    const headerStyle = headerColorStyle(config.header);
    // SHOP-LOOK-1A (docs/slices/shop-look-1.md § 4, § 6.3; SHOPLOOK-CATBAR = C). Each new header piece reaches the Navbar
    // by a conditional spread and only when it draws something, so a tenant without the fields renders the same props.
    // The category bar reads its categories (≤ 12 GetCommands, `getActiveCategoriesByIds`) only when ids are stored; a hidden or
    // missing category is skipped, and no resolved category → no bar. Links use the tenant's category path.
    const tagline = typeof config.header?.tagline === "string" ? config.header.tagline.trim() : "";
    const barIds = Array.isArray(config.header?.categoryBarIds) ? config.header.categoryBarIds.filter((id) => typeof id === "string" && id !== "") : [];
    const categoryPrefix = urlPrefixesOf(config.urlPrefixes).category;
    const barLinks = barIds.length > 0
        ? (await getActiveCategoriesByIds(config.id, barIds)).map((c) => ({ label: c.name, href: `${categoryPrefix}/${c.slug}` }))
        : [];
    // The footer's brand text and named columns: blank text and an empty list draw nothing (today's footer).
    const brandText = typeof config.footer?.brandText === "string" ? config.footer.brandText.trim() : "";
    const footerColumns = Array.isArray(config.footer?.columns) ? config.footer.columns : [];

    // Today's three footer columns, as elements (or false), used in either footer grid below (SHOP-LOOK-1A). The same
    // values as the JSX they were before, so today's grid holds the same children.
    const companyColumn = (config.companyDetails?.legalName || config.companyDetails?.address || config.companyDetails?.cui) && (
        <div className="space-y-1">
            {config.companyDetails?.legalName && (
                <p className="font-semibold text-foreground">{config.companyDetails.legalName}</p>
            )}
            {config.companyDetails?.address && <p>{config.companyDetails.address}</p>}
            {config.companyDetails?.cui && <p>{fillTemplate(site.footerTaxId, { value: config.companyDetails.cui })}</p>}
            {config.companyDetails?.tradeRegister && <p>{fillTemplate(site.footerTradeRegister, { value: config.companyDetails.tradeRegister })}</p>}
            {config.companyDetails?.phone && <p>{fillTemplate(site.footerPhone, { value: config.companyDetails.phone })}</p>}
            {config.companyDetails?.email && <p>{config.companyDetails.email}</p>}
        </div>
    );
    const linksColumn = (config.footerLinks || []).length > 0 && (
        <div className="space-y-1">
            <p className="font-semibold text-foreground mb-2">{site.footerLinksHeading}</p>
            {(config.footerLinks || []).map((link: any, i: number) => (
                <a key={i} href={link.href} className="block hover:text-foreground">{link.label}</a>
            ))}
        </div>
    );
    const legalColumn = (config.legalLinks?.termsUrl || config.legalLinks?.privacyUrl || config.legalLinks?.anpcUrl) && (() => {
        return (
        <div className="space-y-1">
            <p className="font-semibold text-foreground mb-2">{site.footerLegalHeading}</p>
            {config.legalLinks?.termsUrl && (
                <a href={config.legalLinks.termsUrl} className="block hover:text-foreground">{site.legalTermsLabel}</a>
            )}
            {config.legalLinks?.privacyUrl && (
                <a href={config.legalLinks.privacyUrl} className="block hover:text-foreground">{site.legalPrivacyLabel}</a>
            )}
            {config.legalLinks?.anpcUrl && (
                <a href={config.legalLinks.anpcUrl} target="_blank" rel="noopener noreferrer" className="block hover:text-foreground">{site.legalConsumerProtectionLabel}</a>
            )}
            {config.legalLinks?.anpcSalUrl && (
                <a href={config.legalLinks.anpcSalUrl} target="_blank" rel="noopener noreferrer" className="block hover:text-foreground">{site.legalDisputeResolutionLabel}</a>
            )}
        </div>
        );
    })();

    return (
        <html lang={localeLanguageSubtag(config.locale)}>
        <body className={BODY_CLASS_NAME}>
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
                {/* LOCALE-1A: the five texts are the site keys cookie*, stored only in `gdpr.*` (the resolver keeps the
                    `||` rule: an empty field falls through to the language default). Same object shape as before. */}
                <CookieConsent
                    tenantId={config.id}
                    config={{
                        headline: site.cookieHeadline,
                        description: site.cookieDescription,
                        denyAll: site.cookieDenyAll,
                        necessaryOnly: site.cookieNecessaryOnly,
                        acceptAll: site.cookieAcceptAll,
                        position: config.gdpr?.position || "bottom",
                        primaryColor: config.theme?.primaryColor,
                    }}
                />

                {/* Sticky Header Wrapper */}
                <div className={editorial ? "sticky top-0 z-50 border-t-[3px] border-primary" : "sticky top-0 z-50"}>
                    {/* Top Bar (announcement) */}
                    {config.topBar?.show && (
                        <TopBar
                            content={config.topBar.content}
                            quickContactPhone={ownOrChannel(config.topBar.quickContactPhone, channels?.phone)}
                            quickContactEmail={ownOrChannel(config.topBar.quickContactEmail, channels?.email)}
                            contentMaxWidth={config.header?.contentMaxWidth}
                        />
                    )}

                    {/* Commerce Bar (utility: phone, social, cart, CTA) */}
                    {config.commerceBar?.enabled && commerceEnabled && (
                        <CommerceBar
                            phone={ownOrChannel(config.commerceBar.phone, channels?.phone)}
                            whatsappNumber={ownOrChannel(config.commerceBar.whatsappNumber, channels?.whatsapp)}
                            socialLinks={config.commerceBar.socialLinks}
                            ctaButton={config.commerceBar.ctaButton}
                            currency={config.currency || "USD"}
                            contentMaxWidth={config.header?.contentMaxWidth}
                            accountPrefix={config.urlPrefixes?.account || URL_PREFIX_DEFAULTS.account}
                            height={config.commerceBar.height}
                            fontSize={config.commerceBar.fontSize}
                            iconSize={config.commerceBar.iconSize}
                            {...(editorial ? { ctaArrow: true } : {})}
                            labels={{
                                signIn: commerce.signIn || defaults.commerce.signIn,
                                accountLabel: commerce.accountLabel || defaults.commerce.accountLabel,
                                cartWidgetTotal: commerce.cartWidgetTotal,
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
                        {...(isCatalogMode(config) ? { interest: {
                            tenantId: config.id, listPrefix: config.urlPrefixes?.interest || URL_PREFIX_DEFAULTS.interest,
                            strings: { interestListTitle: catalog.interestListTitle, interestWidgetLabel: catalog.interestWidgetLabel, interestStorageWarning: catalog.interestStorageWarning, interestStorageAck: catalog.interestStorageAck },
                        } } : {})}
                        {...(commerceEnabled ? { commerceStrings: { signIn: commerce.signIn, accountLabel: commerce.accountLabel, myAccount: commerce.myAccount } } : {})}
                        strings={{ navAllOf: site.navAllOf, navContact: site.navContact, navToggleMenu: site.navToggleMenu, navViewAll: site.navViewAll, navContactUs: site.navContactUs }}
                        {...(navFont ? { navFont: true } : {})}
                        {...(editorial ? { linkArrows: true } : {})}
                        {...(headerStyle ? { colorStyle: headerStyle } : {})}
                        {...(tagline ? { tagline } : {})}
                        {...(barLinks.length > 0 ? { categoryBar: { label: site.navCategoryBarLabel, links: barLinks } } : {})}
                    />

                </div>

                {/* Page-level GPU effect (z-0 behind all content) — zero impact if type is "none" */}
                {config.pageEffect && config.pageEffect.type !== "none" && (
                    <PageEffectWrapper effect={config.pageEffect} />
                )}

                <div className="flex-1">
                    {children}
                </div>

                {/* CAT-THEME-1: under `editorial` the footer is on the surface colour (`--muted` = the theme's surfaceColor,
                    ThemeInjector); its width is `footer.contentMaxWidth`, absent → the header's (the rule before the slice).
                    BULK-PURGE-FOOTER-1: `footer.backgroundColor` / `footer.textColor` override both shapes (footerColorStyle). */}
                <footer className={editorial ? "border-t py-12 bg-muted" : "border-t py-12 bg-muted/30"} {...(footerStyle ? { style: footerStyle } : {})}>
                    <div className={`${config.footer?.contentMaxWidth || config.header?.contentMaxWidth || "max-w-7xl"} mx-auto px-6`}>
                        {/* SHOP-LOOK-1A (§ 6.3 rule 1): one slot. With a brand text or named columns, a wider grid replaces
                            today's grid element whole: brand text, named columns, then today's three columns; else today's
                            grid element, unchanged. */}
                        {brandText || footerColumns.length > 0 ? (
                            <div className={`grid grid-cols-1 sm:grid-cols-2 ${FOOTER_LG_COLUMNS[(brandText ? 1 : 0) + footerColumns.length + [companyColumn, linksColumn, legalColumn].filter(Boolean).length]} gap-8 text-sm text-muted-foreground`}>
                                {brandText && (
                                    <div>
                                        <p className="whitespace-pre-line">{brandText}</p>
                                    </div>
                                )}
                                {footerColumns.map((column, i) => (
                                    <div key={i} className="space-y-1">
                                        <p className="font-semibold text-foreground mb-2">{column.heading}</p>
                                        {(column.links || []).map((link, j) => (
                                            <a key={j} href={link.href} className="block hover:text-foreground">{link.label}</a>
                                        ))}
                                    </div>
                                ))}
                                {companyColumn}
                                {linksColumn}
                                {legalColumn}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-muted-foreground">
                                {/* Column 1: Company Details */}
                                {companyColumn}

                                {/* Column 2: Footer Links */}
                                {linksColumn}

                                {/* Column 3: Legal Links */}
                                {legalColumn}
                            </div>
                        )}
                        <div className="mt-8 pt-4 border-t text-center text-xs text-muted-foreground">
                            <p>{interpolate(site.footerCopyright, { year: new Date().getFullYear(), name: config.companyDetails?.legalName || config.name })}</p>
                        </div>
                    </div>
                </footer>

                {/* Quick Contact Floating Button */}
                {config.quickContact && (
                    <QuickContact
                        type={config.quickContact.type}
                        value={ownOrChannel(config.quickContact.value, channels?.[config.quickContact.type])}
                        label={config.quickContact.label}
                        strings={{ quickContactCall: site.quickContactCall, quickContactEmail: site.quickContactEmail }}
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
        </body>
        </html>
    );
}
