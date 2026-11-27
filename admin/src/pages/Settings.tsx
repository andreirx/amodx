import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2, Palette, AlertCircle } from "lucide-react";
import { uploadFile } from "@/lib/upload";
import { ServiceKeys } from "@/components/ServiceKeys";
import { isCatalogMode, readLanguageSettings } from "@amodx/shared";
import type { SettingsDraft } from "./settings/draft";
import { LanguageCountryCard, CountryApplyDialog } from "./settings/Languages";
import { FooterLinksCard, NavigationMenuCard } from "./settings/Menus";
import { SiteIdentityCard, CompanyDetailsCard, LegalLinksCard } from "./settings/Identity";
import { NavbarLayoutCard } from "./settings/NavbarLayout";
import type { CategoryOption } from "./settings/NavbarLayout";
import { SchedulingSwitchCard } from "./settings/SchedulingSwitch";
import { CatalogCard, CommerceCard, CommerceBarCard, ProductSearchCard, OrderCelebrationCard } from "./settings/Commerce";
import { DigitalSalesCard, PaymentMethodsCard, BankTransferCard } from "./settings/Payments";
import { UrlPrefixesCard } from "./settings/UrlPrefixes";
import { withContactForSave, ContactChannelsCard, NotificationsCard } from "./settings/Contact";
import { mailerLiteDraft, AnalyticsCard, GoogleOAuthCard, MailerLiteCard, ResearchCard } from "./settings/Integrations";
import { CookieConsentCard, BotProtectionCard } from "./settings/Privacy";
import { withThemeKey, PageEffectCard, TypographyCard, ThemeTabSwitch, ThemeCard, InterfaceCard } from "./settings/Theme";
import type { ThemeKeySetter } from "./settings/Theme";

// REFACTOR-SETTINGS-1: every name this module exported before the move, now defined in its section file.
export type { SettingsDraft } from "./settings/draft";
export { localeStatus, withSiteLanguage, withCountry, languageName, draftLanguages, withLanguageAdded, withLanguageRemoved, LanguageListControls } from "./settings/Languages";
export { linksFor, withLinksFor, MenuLanguageSelect } from "./settings/Menus";
export { HEADER_WIDTH_OPTIONS, PAGE_WIDTH_OPTIONS, withFooterKey, FooterWidthControl, FooterColorControls, withHeaderKey, HeaderColorControls, HeaderTaglineAndCategoryBarControls, FooterBrandAndColumnsControls } from "./settings/NavbarLayout";
export type { CategoryOption } from "./settings/NavbarLayout";
export { COMMERCE_BAR_DESCRIPTION, COMMERCE_BAR_FALLBACK_NOTE } from "./settings/Commerce";
export { withContactForSave, ContactChannelsCard } from "./settings/Contact";
export { mailerLiteDraft, MailerLiteCard } from "./settings/Integrations";
export { withThemeKey, EXTRA_FONT_WEIGHTS, TypographyDetails, ThemeColorDetails, ShapeAndCards } from "./settings/Theme";
export type { ThemeKeySetter } from "./settings/Theme";

export default function SettingsPage() {
    const { currentTenant, refreshTenants } = useTenant();
    const { userRole } = useAuth();
    const [config, setConfig] = useState<SettingsDraft>({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Tracks whether secrets have been merged into config.
    // Guards the secrets effect so it only fires once per settings load.
    const [secretsLoaded, setSecretsLoaded] = useState(false);
    // NEWSLETTER-1: whether the loaded record holds a MailerLite connection (so a token is stored: the backend refuses a
    // connection without one). Only the placeholder of the token field and the Disconnect button read it.
    const [mailerLiteStored, setMailerLiteStored] = useState(false);

    const isAdmin = userRole === "TENANT_ADMIN" || userRole === "GLOBAL_ADMIN";

    // Country pack apply dialog
    const [pendingPackCode, setPendingPackCode] = useState<string | null>(null);

    // Theme Engine State
    const [activeTab, setActiveTab] = useState<'light' | 'dark'>('light');
    const [customThemes, setCustomThemes] = useState<any[]>([]);
    const [isSaveThemeOpen, setIsSaveThemeOpen] = useState(false);
    const [newThemeName, setNewThemeName] = useState("");
    // SHOP-LOOK-1A: the tenant's categories for the category bar picker; null until loaded (or when the load failed).
    const [categories, setCategories] = useState<CategoryOption[] | null>(null);
    // LANG-1A: the language whose menu and footer lists the two link editors edit; null = the default lists (today).
    // A language no longer in the list falls back to the default lists.
    const [linkLanguageChoice, setLinkLanguage] = useState<string | null>(null);
    const extraLanguages = readLanguageSettings(config).languages;
    const linkLanguage = linkLanguageChoice !== null && extraLanguages.includes(linkLanguageChoice) ? linkLanguageChoice : null;

    // Load settings (redacted — no secrets)
    useEffect(() => {
        if (currentTenant) {
            loadSettings();
            loadCategories();
        }
    }, [currentTenant?.id]);

    // Load secrets separately once admin role resolves and config is loaded.
    // Fixes race condition: useAuth starts userRole as "EDITOR" and resolves async.
    // If secrets were fetched inside loadSettings(), isAdmin would be false on first run.
    useEffect(() => {
        if (isAdmin && config.id && !secretsLoaded) {
            loadSecrets();
        }
    }, [isAdmin, config.id, secretsLoaded]);

    async function loadSettings() {
        setLoading(true);
        setError(null);
        setSecretsLoaded(false);
        try {
            const data = await apiRequest("/settings");
            setConfig(data);
            setMailerLiteStored(mailerLiteDraft(data?.integrations?.mailerlite) !== null);
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to load settings");
        } finally {
            setLoading(false);
        }
    }

    async function loadCategories() {
        setCategories(null);
        try {
            const res = await apiRequest("/categories");
            setCategories(res.items || []);
        } catch (e) {
            console.warn("Failed to load categories", e);
        }
    }

    async function loadSecrets() {
        try {
            const secrets = await apiRequest("/settings/secrets");
            setConfig(prev => ({
                ...prev,
                recaptcha: { ...prev.recaptcha, ...secrets.recaptcha },
                integrations: {
                    ...prev.integrations,
                    ...secrets.integrations,
                    google: { ...prev.integrations?.google, ...secrets.integrations?.google },
                },
            }));
            setSecretsLoaded(true);
        } catch (err: any) {
            console.warn("Failed to load secrets:", err.message);
        }
    }

    async function loadCustomThemes() {
        try {
            const res = await apiRequest("/themes");
            setCustomThemes(res.items || []);
        } catch (e) {
            console.warn("Failed to load themes", e);
        }
    }

    async function save() {
        setSaving(true);
        setError(null);
        try {
            await apiRequest("/settings", {
                method: "PUT",
                body: JSON.stringify(withContactForSave(config))
            });
            setMailerLiteStored(mailerLiteDraft(config.integrations?.mailerlite) !== null);
            // Both commerce and scheduling navigation read the existing tenant-list context.
            await refreshTenants();
        } catch (e: any) {
            setError(e.message || "Failed to save settings");
        } finally {
            setSaving(false);
        }
    }

    async function saveCurrentTheme() {
        if (!newThemeName) return;
        try {
            // Save whichever tab is active
            const themeToSave = activeTab === 'light' ? config.theme : config.darkTheme;
            await apiRequest("/themes", {
                method: "POST",
                body: JSON.stringify({ name: newThemeName, theme: themeToSave })
            });
            setIsSaveThemeOpen(false);
            setNewThemeName("");
            loadCustomThemes();
        } catch (e: any) {
            alert(e.message);
        }
    }

    async function deleteTheme(id: string) {
        if (!confirm("Delete this theme?")) return;
        await apiRequest(`/themes/${id}`, { method: "DELETE" });
        loadCustomThemes();
    }

// Smart Theme Updater (Targeting correct tab) — the rule is `withThemeKey` (CAT-THEME-1, review-0 R-CT-3).
    const updateTheme: ThemeKeySetter = (key, val) => setConfig(prev => withThemeKey(prev, activeTab, key, val));

    const updateIntegration = (key: string, val: any) => {
        setConfig(prev => ({
            ...prev,
            integrations: { ...prev.integrations!, [key]: val }
        }));
    };

    const updateHeader = (key: string, val: boolean | string) => {
        setConfig(prev => ({
            ...prev,
            header: { ...prev.header!, [key]: val }
        }));
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            setLoading(true);
            try {
                const url = await uploadFile(e.target.files[0]);
                setConfig({ ...config, logo: url });
            } catch (err) {
                alert("Upload failed");
            } finally {
                setLoading(false);
            }
        }
    };

    // Guard Clause
    if (!currentTenant) {
        return (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] text-muted-foreground">
                <Palette className="h-10 w-10 mb-4 opacity-20" />
                <p>Select a site to configure settings.</p>
            </div>
        );
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    // Helper for active theme config
    const activeConfig = activeTab === 'light' ? config.theme : (config.darkTheme || config.theme);

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-8 pb-20">
            <div className="flex justify-between items-center border-b pb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
                    <p className="text-muted-foreground mt-1">Manage identity and appearance for <span className="font-semibold text-foreground">{config.name}</span></p>
                </div>
                <Button onClick={save} disabled={saving} size="lg">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                </Button>
            </div>

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* LEFT COLUMN */}
                <div className="lg:col-span-2 space-y-8">

                    {/* IDENTITY & LOGO */}
                    <SiteIdentityCard config={config} setConfig={setConfig} updateHeader={updateHeader} handleLogoUpload={handleLogoUpload} />

                    {/* NAVBAR & LAYOUT SIZES */}
                    <NavbarLayoutCard config={config} setConfig={setConfig} updateHeader={updateHeader} categories={categories} />

                    {/* COMMERCE TOGGLE — CATALOG-MODE-1 (CM-D11): the kind is fixed at creation; a catalog site never sells.
                        CAT-ADMIN-1 (docs/slices/cat-admin-1.md § 4.5): a catalog gets its own card, which states the kind; no control. */}
                    {/* One child slot preserves the existing settings controls' React useId paths. */}
                    <>
                    {isCatalogMode(config) ? (
                    <CatalogCard />
                    ) : (
                    <CommerceCard config={config} setConfig={setConfig} />
                    )}

                    {/* SCHED-MENU-1: the switch is available even when the Scheduling menu is hidden. */}
                    <SchedulingSwitchCard config={config} setConfig={setConfig} isAdmin={isAdmin} />
                    </>

                    {/* DIGITAL SALES (PADDLE) */}
                    <DigitalSalesCard config={config} setConfig={setConfig} />

                    {/* COMMERCE BAR */}
                    {config.commerceEnabled && (
                    <CommerceBarCard config={config} setConfig={setConfig} />
                    )}

                    {/* PRODUCT SEARCH BAR — CAT-ADMIN-1 (§ 4.5): search is a catalog feature too (catalog-mode-1.md § 8.4 F-5). */}
                    {(config.commerceEnabled || isCatalogMode(config)) && (
                    <ProductSearchCard config={config} setConfig={setConfig} />
                    )}

                    {/* COUNTRY, LOCALE & CURRENCY — moved to general section (before GDPR) */}

                    {/* PAYMENT METHODS */}
                    {config.commerceEnabled && (
                    <PaymentMethodsCard config={config} setConfig={setConfig} />
                    )}

                    {/* BANK TRANSFER DETAILS */}
                    {config.commerceEnabled && (config.enabledPaymentMethods || []).includes("bank_transfer") && (
                    <BankTransferCard config={config} setConfig={setConfig} />
                    )}

                    {/* COMPANY DETAILS */}
                    <CompanyDetailsCard config={config} setConfig={setConfig} />

                    {/* FOOTER LINKS */}
                    <FooterLinksCard config={config} setConfig={setConfig} extraLanguages={extraLanguages} linkLanguage={linkLanguage} setLinkLanguage={setLinkLanguage} />

                    {/* LEGAL LINKS */}
                    <LegalLinksCard config={config} setConfig={setConfig} />

                    {/* CONTACT CHANNELS — CAT-QUOTE-1 (every site kind), then NOTIFICATIONS. One fragment in the place the
                        Notifications card had: the column keeps its children, so the ids React derives from the tree
                        (the Radix selects further down) stay as the preservation captures hold (Settings.test.ts). */}
                    <>
                    <ContactChannelsCard config={config} setConfig={setConfig} />
                    <NotificationsCard config={config} updateIntegration={updateIntegration} />
                    </>

                    {/* NAVIGATION */}
                    <NavigationMenuCard config={config} setConfig={setConfig} extraLanguages={extraLanguages} linkLanguage={linkLanguage} setLinkLanguage={setLinkLanguage} />

                    {/* URL PREFIXES (Commerce Routing) — CAT-ADMIN-1 (§ 4.5, CA-D2): a catalog has no cart, checkout or account
                        pages; it has the interest-list page (`urlPrefixes.interest`, finding F-CA-1). A non-catalog site: unchanged.
                        CAT-ADMIN-2 (F-CA-IMPL-2): on a catalog the description and the footnote say "catalog"; each is one whole
                        string per kind, so the non-catalog markup stays byte-equal. */}
                    <UrlPrefixesCard config={config} setConfig={setConfig} />

                    {/* ANALYTICS CARD */}
                    <AnalyticsCard config={config} setConfig={setConfig} updateIntegration={updateIntegration} />

                    {/* IDENTITY PROVIDERS — admin only (contains clientSecret) */}
                    {isAdmin && <GoogleOAuthCard config={config} setConfig={setConfig} />}

                    {/* INTEGRATION KEYS — admin only (SERVICE-ACCOUNT-1: tenant-bound service keys) */}
                    {isAdmin && <ServiceKeys />}


                    {/* GPU VISUAL EFFECTS */}
                    <PageEffectCard config={config} setConfig={setConfig} />

                    {/* CELEBRATION CONFETTI */}
                    {config.commerceEnabled && (
                    <OrderCelebrationCard config={config} setConfig={setConfig} />
                    )}

                    {/* SITE LANGUAGE, LOCALE, COUNTRY & CURRENCY — always visible (LOCALE-1A, docs/slices/locale-1.md § 3.5).
                        Texts follow the language of the normalised `locale`; dates follow the locale; the country sets
                        country facts only (it no longer copies texts into storage, § 7.2). */}
                    <LanguageCountryCard config={config} setConfig={setConfig} setPendingPackCode={setPendingPackCode} />

                    {/* GDPR / PRIVACY */}
                    <CookieConsentCard config={config} setConfig={setConfig} />

                    {/* BOT PROTECTION (reCAPTCHA v3) */}
                    <BotProtectionCard config={config} setConfig={setConfig} isAdmin={isAdmin} />

                    {/* NEWSLETTER (MailerLite) and RESEARCH — admin only (secrets). One fragment in the Research card's slot, so the
                        column keeps its number of children and no React tree id of the page moves (NEWSLETTER-1). */}
                    {isAdmin && (
                    <>
                    <MailerLiteCard value={config.integrations?.mailerlite} stored={mailerLiteStored} onChange={(next) => updateIntegration("mailerlite", next)} />
                    <ResearchCard config={config} updateIntegration={updateIntegration} />
                    </>
                    )}
                </div>

                {/* RIGHT COLUMN: Colors */}
                <div className="lg:col-span-1">
                    {/* TYPOGRAPHY */}
                    <TypographyCard activeConfig={activeConfig} updateTheme={updateTheme} />

                    {/* THEME SWITCHER TAB */}
                    <ThemeTabSwitch activeTab={activeTab} setActiveTab={setActiveTab} />

                    <ThemeCard activeTab={activeTab} activeConfig={activeConfig} updateTheme={updateTheme} setConfig={setConfig} customThemes={customThemes} deleteTheme={deleteTheme} isSaveThemeOpen={isSaveThemeOpen} setIsSaveThemeOpen={setIsSaveThemeOpen} newThemeName={newThemeName} setNewThemeName={setNewThemeName} saveCurrentTheme={saveCurrentTheme} />


                    {/* INTERFACE */}
                    <InterfaceCard config={config} updateTheme={updateTheme} />
                </div>
            </div>

            {/* Country Pack Apply Confirmation Dialog */}
            <CountryApplyDialog pendingPackCode={pendingPackCode} setPendingPackCode={setPendingPackCode} setConfig={setConfig} />
        </div>
    );
}
