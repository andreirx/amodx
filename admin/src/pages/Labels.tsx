import { createContext, useContext, useEffect, useState } from "react";
import { useTenant } from "@/context/TenantContext";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RotateCcw, Save } from "lucide-react";
import {
    COOKIE_AND_LEGAL_LABEL_LOCATIONS, CatalogStringsSchema, CommerceStringsSchema, SiteStringsSchema, isCatalogMode,
    pluralCategoriesOf, resolveLocaleStrings, type CookieOrLegalLabelKey, type CountText, type LocaleStrings, type PluralCategory,
} from "@amodx/shared";

// ── LOCALE-1A (docs/slices/locale-1.md § 7.1): the Labels page edits the tenant's locale table ─────────────────────
// Four stored homes, one input per key: `commerceStrings` (commerce part), `catalogStrings` (catalog part, LOCALE-1B),
// `siteStrings` (site part, without the nine cookie/legal keys) and the label fields of `gdpr` / `legalLinks` (the
// nine, § 4.1). The page shows them in SECTIONS (each with its Reset); a section edits exactly one home. The pure
// helpers below build what a save sends; `Labels.test.ts` pins them.

/** Which stored home an input edits. `labels` = the nine cookie/legal keys, stored in gdpr/legalLinks fields. */
export type LabelsPart = "commerce" | "catalog" | "site" | "labels";

/** What the page edits: copies of the loaded objects (unknown and non-string stored keys are kept, § 2.4). */
export type LabelsDraft = {
    commerce: Record<string, unknown>;
    catalog: Record<string, unknown>;
    site: Record<string, unknown>;
    labels: Partial<Record<CookieOrLegalLabelKey, string>>;
};

const NINE = Object.keys(COOKIE_AND_LEGAL_LABEL_LOCATIONS) as CookieOrLegalLabelKey[];
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** The draft of a loaded `GET /settings` answer. A label field counts as an override only when it is a non-empty text. */
export function draftFromSettings(settings: Record<string, unknown>): LabelsDraft {
    const labels: LabelsDraft["labels"] = {};
    for (const key of NINE) {
        const { attribute, field } = COOKIE_AND_LEGAL_LABEL_LOCATIONS[key];
        const stored = asObject(settings[attribute])[field];
        if (nonEmpty(stored)) labels[key] = stored;
    }
    return {
        commerce: { ...asObject(settings.commerceStrings) }, catalog: { ...asObject(settings.catalogStrings) },
        site: { ...asObject(settings.siteStrings) }, labels,
    };
}

/** One input changed. An empty input removes the override (the page never writes ""). */
export function setText(draft: LabelsDraft, part: LabelsPart, key: string, value: string): LabelsDraft {
    const next = { ...draft[part] } as Record<string, unknown>;
    if (value) next[key] = value;
    else delete next[key];
    return { ...draft, [part]: next };
}

/**
 * LOCALE-1B: one plural category of a count key changed (§ 16.2 item 6). The stored value is an object of texts per
 * category; an empty input removes that category, and the key goes when no category is left. Other stored
 * categories (for example those of another language) are kept.
 */
export function setCountText(draft: LabelsDraft, part: LabelsPart, key: string, category: PluralCategory, value: string): LabelsDraft {
    const forms = { ...asObject((draft[part] as Record<string, unknown>)[key]) };
    if (value) forms[category] = value;
    else delete forms[category];
    const next = { ...draft[part] } as Record<string, unknown>;
    if (Object.keys(forms).length > 0) next[key] = forms;
    else delete next[key];
    return { ...draft, [part]: next };
}

/**
 * LOCALE-1B (§ 7.1, § 2.1 note): the commerce-part keys that render on the product, category, shop and search pages —
 * shared by commerce AND catalog sites, so the page shows them in their own section ("Product pages & search") to both.
 * The 21 keys of `locale-1b` and the seven existing ones a catalog site renders (`description` and the six search texts);
 * LOCALE-1C: + `showcaseEmpty`, the category-showcase block's empty text (a product listing on shops and catalogs).
 */
const PRODUCT_PAGE_KEYS = [
    "description", "volumePricing", "preOrder", "buyNow", "ingredients", "nutritionalValues", "reviewsHeading", "reviewsSummary",
    "shopTitle", "categoryEmpty", "productCount", "shopEmpty", "shopEmptyInStock", "shopAllProducts", "metaCategoryDescription", "metaShopTitle",
    "showcaseEmpty",
    "searchPlaceholder", "searchButton", "searchNoResults", "searchSearching", "viewAllResults", "resultsFor", "searchProducts",
    "searchBreadcrumb", "searchResultCount", "searchEnterTerm", "metaSearchTitle", "metaSearchQueryTitle",
];

/** A section of the page: one heading, one Reset. Each section edits exactly one stored home. */
export type LabelsSection = "site" | "labels" | "catalog" | "product" | "commerce" | "showcase";
export const SECTION_HOME = {
    site: "site", labels: "labels", catalog: "catalog", product: "commerce", commerce: "commerce", showcase: "commerce",
} as const satisfies Record<LabelsSection, LabelsPart>;

/**
 * LOCALE-1C (operator ruling R4, 2026-11-01): the two texts of the category-showcase block a content-only tenant can
 * render (`showcaseEmpty`, `outOfStock`; stored in `commerceStrings`). A commerce or catalog tenant edits them in
 * "Product pages & search" / "Commerce"; a content-only tenant gets this section instead — so each key has ONE input
 * on the page for every tenant kind (`visibleSections`).
 */
const SHOWCASE_KEYS = ["showcaseEmpty", "outOfStock"];

/** The keys each Reset button covers: every key of its section that has an input. */
export const SECTION_KEYS = {
    site: Object.keys(SiteStringsSchema.shape).filter((k) => !NINE.includes(k as CookieOrLegalLabelKey)),
    labels: NINE as string[],
    catalog: Object.keys(CatalogStringsSchema.shape),
    product: PRODUCT_PAGE_KEYS,
    commerce: Object.keys(CommerceStringsSchema.shape).filter((k) => !PRODUCT_PAGE_KEYS.includes(k)),
    showcase: SHOWCASE_KEYS,
} satisfies Record<LabelsSection, string[]>;

/** The sections the page shows a tenant, in page order: site and cookie/legal for everyone; Catalog for a catalog site;
 *  Product pages & search for a shop or a catalog; Commerce for a shop; the showcase section for a content-only site. */
export function visibleSections(settings: Record<string, unknown> | null): LabelsSection[] {
    const isCommerce = settings?.commerceEnabled === true;
    const isCatalog = isCatalogMode(settings);
    const out: LabelsSection[] = ["site", "labels"];
    if (isCatalog) out.push("catalog");
    if (isCommerce || isCatalog) out.push("product");
    if (isCommerce) out.push("commerce");
    if (!isCommerce && !isCatalog) out.push("showcase");
    return out;
}

/** How many overrides a Reset of `section` removes. */
export function overrideCount(draft: LabelsDraft, section: LabelsSection): number {
    const home = draft[SECTION_HOME[section]];
    return SECTION_KEYS[section].filter((k) => Object.prototype.hasOwnProperty.call(home, k)).length;
}

/** "Reset to the language defaults": removes every override of the section's keys; nothing else (§ 7.1). */
export function resetSection(draft: LabelsDraft, section: LabelsSection): LabelsDraft {
    const part = SECTION_HOME[section];
    const next = { ...draft[part] } as Record<string, unknown>;
    for (const key of SECTION_KEYS[section]) delete next[key];
    return { ...draft, [part]: next };
}

function sameEntries(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/**
 * The `PUT /settings` body of a save: only the attributes that changed (§ 7.1). `gdpr` and `legalLinks` are sent
 * whole (PUT replaces a top-level field whole), built from the LOADED object with only the label fields changed —
 * so `gdpr.enabled`, `gdpr.position` and the four legal URLs are kept. A cleared label is deleted from the object;
 * a stored empty label that the owner did not touch is left as stored.
 */
export function labelsSaveBody(settings: Record<string, unknown>, draft: LabelsDraft): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (!sameEntries(asObject(settings.commerceStrings), draft.commerce)) body.commerceStrings = draft.commerce;
    if (!sameEntries(asObject(settings.catalogStrings), draft.catalog)) body.catalogStrings = draft.catalog;
    if (!sameEntries(asObject(settings.siteStrings), draft.site)) body.siteStrings = draft.site;
    for (const attribute of ["gdpr", "legalLinks"] as const) {
        const loaded = asObject(settings[attribute]);
        const next: Record<string, unknown> = { ...loaded };
        for (const key of NINE) {
            const location = COOKIE_AND_LEGAL_LABEL_LOCATIONS[key];
            if (location.attribute !== attribute) continue;
            const value = draft.labels[key];
            if (value) next[location.field] = value;
            else if (nonEmpty(loaded[location.field])) delete next[location.field];
        }
        if (!sameEntries(loaded, next)) body[attribute] = next;
    }
    return body;
}

// Context so F can live outside the component (stable identity = no focus loss)
const LabelsCtx = createContext<{
    draft: LabelsDraft;
    defaults: LocaleStrings | null;
    /** The tenant's text language (the resolver's `language`): which plural categories a count key offers. */
    language: string;
    update: (part: LabelsPart, key: string, value: string) => void;
    updateCount: (part: LabelsPart, key: string, category: PluralCategory, value: string) => void;
}>({ draft: { commerce: {}, catalog: {}, site: {}, labels: {} }, defaults: null, language: "en", update: () => {}, updateCount: () => {} });

/** The language default of one key of a stored home (the nine cookie/legal keys are site keys). */
function defaultOf(defaults: LocaleStrings | null, part: LabelsPart, field: string): unknown {
    if (!defaults) return undefined;
    return (defaults[part === "labels" ? "site" : part] as Record<string, unknown>)[field];
}

/**
 * One input. The value is the tenant's stored override; the placeholder is the default of the tenant's site language
 * (layers 1 + 2 of the resolver), so an owner sees what visitors get when the input is blank.
 */
function F({ label, field, section = "commerce", placeholder }: { label: string; field: string; section?: LabelsSection; placeholder?: string }) {
    const { draft, defaults, update } = useContext(LabelsCtx);
    const part = SECTION_HOME[section];
    const stored = (draft[part] as Record<string, unknown>)[field];
    const found = defaultOf(defaults, part, field);
    const languageDefault = typeof found === "string" ? found : "";
    return (
        <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            <Input
                value={typeof stored === "string" ? stored : ""}
                onChange={e => update(part, field, e.target.value)}
                placeholder={languageDefault || placeholder || ""}
                className="h-9"
            />
        </div>
    );
}

/**
 * LOCALE-1B: the inputs of a count key (§ 16.2 item 6) — one per plural category of the tenant's text language
 * (English: one, other; Romanian: one, few, other), each with the stored text of that category and, as placeholder,
 * the language default of that category (else its `other`). Stored categories of another language are not shown and
 * are kept on save.
 */
export function countInputs(draft: LabelsDraft, defaults: LocaleStrings | null, language: string, part: LabelsPart, field: string): { category: PluralCategory; value: string; placeholder: string }[] {
    const stored = asObject((draft[part] as Record<string, unknown>)[field]);
    const languageDefault = defaultOf(defaults, part, field) as CountText | undefined;
    return pluralCategoriesOf(language).map((category) => ({
        category,
        value: typeof stored[category] === "string" ? stored[category] as string : "",
        // The language's form, else its `other`, else English `other` (the chain of `selectPluralText`; for a registered
        // complete pack — en, ro — always the language's own form).
        placeholder: languageDefault ? (languageDefault.forms[category] ?? languageDefault.forms.other ?? languageDefault.english.other) : "",
    }));
}

/** LOCALE-1B: a count key's inputs (`countInputs`), under one label. */
function CountF({ label, field, section, example }: { label: string; field: string; section: LabelsSection; example: string }) {
    const { draft, defaults, language, updateCount } = useContext(LabelsCtx);
    const part = SECTION_HOME[section];
    return (
        <div className="space-y-1.5 col-span-2">
            <Label className="text-xs text-muted-foreground">{label} — one text per plural form ({example})</Label>
            <div className="grid grid-cols-3 gap-2">
                {countInputs(draft, defaults, language, part, field).map(({ category, value, placeholder }) => (
                    <div key={category} className="space-y-0.5">
                        <span className="text-[11px] text-muted-foreground">{category}</span>
                        <Input value={value} onChange={e => updateCount(part, field, category, e.target.value)} placeholder={placeholder} className="h-9" />
                    </div>
                ))}
            </div>
        </div>
    );
}

/** A group heading with its one-line description and its Reset button. */
function SectionHeader({ title, description, section, onReset }: { title: string; description: string; section: LabelsSection; onReset: (section: LabelsSection, title: string) => void }) {
    const { draft } = useContext(LabelsCtx);
    const count = overrideCount(draft, section);
    return (
        <div className="flex items-end justify-between gap-4 pt-2">
            <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="text-muted-foreground text-sm">{description}</p>
            </div>
            <Button variant="outline" size="sm" disabled={count === 0} onClick={() => onReset(section, title)}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset to the language defaults
            </Button>
        </div>
    );
}

export default function Labels() {
    const { currentTenant } = useTenant();
    const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
    const [draft, setDraft] = useState<LabelsDraft>({ commerce: {}, catalog: {}, site: {}, labels: {} });
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (currentTenant?.id) {
            loadConfig();
        }
    }, [currentTenant?.id]);

    async function loadConfig() {
        if (!currentTenant?.id) return;
        setLoading(true);
        setError(null);
        try {
            const config = await apiRequest("/settings");
            setSettings(config);
            setDraft(draftFromSettings(config));
        } catch (err: any) {
            console.error("Failed to load config", err);
            setError(err?.message || "Failed to load the labels.");
        } finally {
            setLoading(false);
        }
    }

    const update = (part: LabelsPart, key: string, value: string) => {
        setDraft(prev => setText(prev, part, key, value));
    };
    const updateCount = (part: LabelsPart, key: string, category: PluralCategory, value: string) => {
        setDraft(prev => setCountText(prev, part, key, category, value));
    };

    const reset = (section: LabelsSection, title: string) => {
        const count = overrideCount(draft, section);
        if (count === 0) return;
        if (!confirm(`Reset ${count} text${count === 1 ? "" : "s"} in "${title}" to the language defaults? Click Save Changes to apply.`)) return;
        setDraft(prev => resetSection(prev, section));
    };

    const handleSave = async () => {
        if (!currentTenant || !settings) return;
        const body = labelsSaveBody(settings, draft);
        if (Object.keys(body).length === 0) return;
        setSaving(true);
        setError(null);
        try {
            await apiRequest("/settings", {
                method: "PUT",
                body: JSON.stringify(body),
            });
            setSettings(prev => ({ ...prev, ...body }));
        } catch (err: any) {
            console.error("Failed to save labels", err);
            setError(err?.message || "Failed to save the labels.");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const resolved = settings ? resolveLocaleStrings(settings) : null;
    const defaults = resolved ? resolved.defaults : null;
    const visible = visibleSections(settings);

    return (
        <LabelsCtx.Provider value={{ draft, defaults, language: resolved?.language ?? "en", update, updateCount }}>
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Labels</h1>
                    <p className="text-muted-foreground text-sm">
                        The texts visitors see, in your site language (Settings → Site language). The grey text in an input is the language default; leave an input blank to use it.
                    </p>
                </div>
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Save Changes
                </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* ── Site (every tenant) ── */}
            <SectionHeader section="site" onReset={reset} title="Site" description="Header, footer, page navigation, comments, sharing, forms and the fixed texts of content blocks — on every page of the site. A cleared input uses the language default." />

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Header & Navigation</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="site" label="Contact button" field="navContact" />
                        <F section="site" label="Contact button (mobile menu)" field="navContactUs" />
                        <F section="site" label="Menu button (screen readers)" field="navToggleMenu" />
                        <F section="site" label="Dropdown: all of {label}" field="navAllOf" />
                        <F section="site" label="Dropdown: View All (mobile)" field="navViewAll" />
                        <F section="site" label="Breadcrumb: Home" field="breadcrumbHome" />
                        <F section="site" label="Site name, when none is set" field="untitledSiteName" />
                        <F section="site" label="Search engine description, when none is set ({name})" field="metaSiteDescription" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Footer</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="site" label="Tax ID line ({value})" field="footerTaxId" />
                        <F section="site" label="Trade register line ({value})" field="footerTradeRegister" />
                        <F section="site" label="Phone line ({value})" field="footerPhone" />
                        <F section="site" label="Links heading" field="footerLinksHeading" />
                        <F section="site" label="Legal heading" field="footerLegalHeading" />
                        <F section="site" label="Copyright ({year}, {name})" field="footerCopyright" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Pages</CardTitle>
                    <CardDescription>Page navigation and pages that need a sign-in</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="site" label="Previous page" field="paginationPrevious" />
                        <F section="site" label="Page {page} of {total}" field="paginationPageOf" />
                        <F section="site" label="Next page" field="paginationNext" />
                        <F section="site" label="Restricted: title" field="restrictedTitle" />
                        <F section="site" label="Restricted: sign-in needed" field="restrictedLoginRequired" />
                        <F section="site" label="Restricted: subscription ({currency} {price})" field="restrictedSubscription" />
                        <F section="site" label="Restricted: sign-in button" field="restrictedLogIn" />
                        <F section="site" label="Restricted: purchase button" field="restrictedPurchase" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Comments</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="site" label="Heading ({count})" field="commentsHeading" />
                        <F section="site" label="No comments" field="commentsEmpty" />
                        <F section="site" label="Comments closed" field="commentsClosed" />
                        <F section="site" label="Comment placeholder" field="commentsPlaceholder" />
                        <F section="site" label="Post button" field="commentsPost" />
                        <F section="site" label="Post failed" field="commentsPostFailed" />
                        <F section="site" label="Join heading" field="commentsJoin" />
                        <F section="site" label="Sign-in button" field="commentsSignIn" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Sharing, Contact Button & Forms</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="site" label="Share label" field="shareLabel" />
                        <F section="site" label="Share on X" field="shareOnX" />
                        <F section="site" label="Share on LinkedIn" field="shareOnLinkedIn" />
                        <F section="site" label="Share on Facebook" field="shareOnFacebook" />
                        <F section="site" label="Share by email" field="shareByEmail" />
                        <F section="site" label="Copy link" field="shareCopyLink" />
                        <F section="site" label="Contact button: call" field="quickContactCall" />
                        <F section="site" label="Contact button: email" field="quickContactEmail" />
                        <F section="site" label="Form: submitting" field="formSubmitting" />
                        <F section="site" label="Error: try again" field="errorTryAgain" />
                        <F section="site" label="Form: select placeholder" field="formSelectPlaceholder" />
                        <F section="site" label="Form: submission failed" field="formSubmissionFailed" />
                        <F section="site" label="Form: other error" field="formErrorShort" />
                    </div>
                </CardContent>
            </Card>

            {/* LOCALE-1C (ruling LOCALE1-BLOCK-TEXTS = A): the fixed texts of the content blocks — the same in every block
                instance. A text the author writes in a block (headline, button text, success message, image alt, video
                caption) stays in the block and wins over these. The contact and lead blocks also use "Error: try again"
                and "Form: submission failed" above. */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Content Blocks</CardTitle>
                    <CardDescription>The fixed texts of the blocks in your pages. A text you write in a block itself (for example its success message or image description) is shown instead.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="site" label="Contact form: Name" field="contactName" />
                        <F section="site" label="Contact form: Email" field="contactEmail" />
                        <F section="site" label="Contact form: Message" field="contactMessage" />
                        <F section="site" label="Contact form: sending" field="contactSending" />
                        <F section="site" label="Contact form: sent (heading)" field="contactSent" />
                        <F section="site" label="Contact form: sent (text, when the block has none)" field="contactSentDetail" />
                        <F section="site" label="Contact form: sending failed" field="contactSendFailed" />
                        <F section="site" label="Lead magnet: Email (screen readers)" field="leadEmail" />
                        <F section="site" label="Lead magnet: email placeholder" field="leadEmailPlaceholder" />
                        <F section="site" label="Lead magnet: unlocking" field="leadUnlocking" />
                        <F section="site" label="Lead magnet: unlocked (heading)" field="leadUnlocked" />
                        <F section="site" label="Lead magnet: file ready" field="leadFileReady" />
                        <F section="site" label="Lead magnet: download button" field="leadDownload" />
                        <F section="site" label="Hero: no image" field="heroNoImage" />
                        <F section="site" label="Image: description, when the block has none" field="imageAltFallback" />
                        <F section="site" label="Video: title, when the block has no caption" field="videoTitle" />
                        <F section="site" label="Video hero: title, when the block has no headline" field="videoBackgroundTitle" />
                        <F section="site" label="Carousel and product showcase: no image" field="noImage" />
                        <F section="site" label="Carousel (coverflow): NO IMAGE" field="noImageCaps" />
                        <F section="site" label="Carousel (coverflow): View" field="carouselView" />
                        <F section="site" label="Code block: Copy" field="codeCopy" />
                        <F section="site" label="Code block: Copied" field="codeCopied" />
                        <F section="site" label="Reviews: Read more" field="reviewsReadMore" />
                        <F section="site" label="Reviews: Show less" field="reviewsShowLess" />
                        <F section="site" label="Post grid: no posts" field="postsEmpty" />
                        <F section="site" label="Post grid: loading failed ({status})" field="postsLoadFailed" />
                    </div>
                </CardContent>
            </Card>

            {/* ── Cookie banner & legal links (every tenant; stored in gdpr / legalLinks, § 4.1) ── */}
            <SectionHeader section="labels" onReset={reset} title="Cookie banner & legal links" description="The cookie banner and the legal link texts in the footer. The banner on/off, its position and the link addresses stay in Settings." />

            <Card>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="labels" label="Banner headline" field="cookieHeadline" />
                        <F section="labels" label="Banner text" field="cookieDescription" />
                        <F section="labels" label="Deny All button" field="cookieDenyAll" />
                        <F section="labels" label="Necessary Only button" field="cookieNecessaryOnly" />
                        <F section="labels" label="Accept All button" field="cookieAcceptAll" />
                        <F section="labels" label="Terms link" field="legalTermsLabel" />
                        <F section="labels" label="Privacy link" field="legalPrivacyLabel" />
                        <F section="labels" label="Consumer protection link" field="legalConsumerProtectionLabel" />
                        <F section="labels" label="Dispute resolution link" field="legalDisputeResolutionLabel" />
                    </div>
                </CardContent>
            </Card>

            {/* ── Catalog (catalog tenants; LOCALE-1B, § 7.1) ── */}
            {visible.includes("catalog") && <>
            <SectionHeader section="catalog" onReset={reset} title="Catalog" description="The interest list and the product filters of the catalog. A saved text shows as written, so do not save an empty text: clear the input to use the language default." />

            {/* CAT-QUOTE-1: the "Request a quote" button and dialog of the catalog product page (QuoteRequest.tsx). */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Request a quote</CardTitle>
                    <CardDescription>The button on the product page and its dialog with the contact channels (Settings → Contact channels)</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="catalog" label="Button" field="quoteButton" />
                        <F section="catalog" label="Dialog title" field="quoteTitle" />
                        <F section="catalog" label="Action: call" field="quoteCall" />
                        <F section="catalog" label="Action: WhatsApp" field="quoteWhatsApp" />
                        <F section="catalog" label="Action: e-mail" field="quoteEmail" />
                        <F section="catalog" label="Message ({product}, {variant}, {url}; text in [ ] only with a variant)" field="quoteMessage" />
                        <F section="catalog" label="Close" field="quoteClose" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Interest list</CardTitle>
                    <CardDescription>The “I'm interested” button on products, the list link in the header and the list page with its form</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="catalog" label="Button" field="interestAdd" />
                        <F section="catalog" label="Button, product in the list" field="interestAdded" />
                        <F section="catalog" label="List full" field="interestListFull" />
                        <F section="catalog" label="List title" field="interestListTitle" />
                        <F section="catalog" label="Empty list ({action} = the button)" field="interestEmpty" />
                        <F section="catalog" label="Link to the products" field="interestBrowse" />
                        <F section="catalog" label="Earlier list received" field="interestPreviouslySent" />
                        <F section="catalog" label="Row: collection" field="interestCollection" />
                        <F section="catalog" label="Row: remove ({title}, screen readers)" field="interestRemove" />
                        <F section="catalog" label="Row: no longer in the catalog" field="interestRowExpired" />
                        <F section="catalog" label="Row: not available" field="interestRowUnavailable" />
                        <F section="catalog" label="Row: option no longer offered" field="interestRowOptionGone" />
                        <F section="catalog" label="Form heading" field="interestContactHeading" />
                        <F section="catalog" label="Form: name" field="interestName" />
                        <F section="catalog" label="Form: e-mail" field="interestEmail" />
                        <F section="catalog" label="Form: phone" field="interestPhone" />
                        <F section="catalog" label="Form: message" field="interestMessage" />
                        <F section="catalog" label="Form: send button" field="interestSubmit" />
                        <F section="catalog" label="Sent: title" field="interestSentTitle" />
                        <F section="catalog" label="Sent: thank you" field="interestSentBody" />
                        <F section="catalog" label="Sent: products not included" field="interestExcludedIntro" />
                        <F section="catalog" label="Error: no available product" field="interestErrorNoneAvailable" />
                        <F section="catalog" label="Error: invalid details" field="interestErrorInvalid" />
                        <F section="catalog" label="Error: list check failed" field="interestErrorCheck" />
                        <F section="catalog" label="Error: products gone" field="interestErrorAllGone" />
                        <F section="catalog" label="Error: send failed" field="interestErrorSend" />
                        <F section="catalog" label="Error: no connection" field="interestErrorNetwork" />
                        <F section="catalog" label="Header: storage notice" field="interestStorageWarning" />
                        <F section="catalog" label="Header: storage notice button" field="interestStorageAck" />
                        <CountF section="catalog" label="Header: list link for screen readers ({n})" field="interestWidgetLabel" example="My list: {n} products" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Filters</CardTitle>
                    <CardDescription>The filter panel of the shop and category pages</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="catalog" label="Panel title" field="facetsTitle" />
                        <F section="catalog" label="Producer filter heading" field="facetProducer" />
                        <F section="catalog" label="Option filter heading (mixed option names)" field="facetVariantDefault" />
                        <F section="catalog" label="Clear filters" field="facetsClear" />
                        <F section="catalog" label="Remove a filter ({facet}, {value}; screen readers)" field="facetsRemove" />
                        <F section="catalog" label="No match" field="facetsNoMatch" />
                        <F section="catalog" label="Too many filters" field="facetsTooMany" />
                        <F section="catalog" label="Filters in the address too long" field="facetsUrlTooLong" />
                        <CountF section="catalog" label="Product count ({n})" field="facetsCount" example="{n} products" />
                    </div>
                </CardContent>
            </Card>
            </>}

            {/* ── Product pages & search (commerce and catalog tenants; LOCALE-1B, § 7.1) ── */}
            {visible.includes("product") && <>
            <SectionHeader section="product" onReset={reset} title="Product pages & search" description="Product, category, shop and search pages — on shops and on catalogs. Texts saved here are stored with the commerce texts. A saved text shows as written; clear an input to use the language default." />

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Product page</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="product" label="Description" field="description" />
                        <F section="product" label="Volume pricing" field="volumePricing" />
                        <F section="product" label="Pre-order" field="preOrder" />
                        <F section="product" label="Buy now" field="buyNow" />
                        <F section="product" label="Ingredients" field="ingredients" />
                        <F section="product" label="Nutritional values" field="nutritionalValues" />
                        <F section="product" label="Reviews heading" field="reviewsHeading" />
                        <CountF section="product" label="Reviews summary ({rating}, {n})" field="reviewsSummary" example="{rating}/5 ({n} reviews)" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Category & shop pages</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="product" label="Shop (title and breadcrumb)" field="shopTitle" />
                        <F section="product" label="Shop: all products" field="shopAllProducts" />
                        <F section="product" label="Shop: no products" field="shopEmpty" />
                        <F section="product" label="Shop: none in stock" field="shopEmptyInStock" />
                        <F section="product" label="Category: no products" field="categoryEmpty" />
                        <F section="product" label="Product showcase block: no products" field="showcaseEmpty" />
                        <F section="product" label="Shop page title ({site})" field="metaShopTitle" />
                        <F section="product" label="Category description for search engines ({category})" field="metaCategoryDescription" />
                        <CountF section="product" label="Category product count ({n})" field="productCount" example="{n} products" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Search</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="product" label="Search bar placeholder (when Settings has none)" field="searchPlaceholder" />
                        <F section="product" label="Search Button" field="searchButton" />
                        <F section="product" label="No Results" field="searchNoResults" />
                        <F section="product" label="Searching..." field="searchSearching" />
                        <F section="product" label="View All Results" field="viewAllResults" />
                        <F section="product" label="Results For (heading)" field="resultsFor" />
                        <F section="product" label="Search Products (heading)" field="searchProducts" />
                        <F section="product" label="Breadcrumb: Search" field="searchBreadcrumb" />
                        <F section="product" label="No search term" field="searchEnterTerm" />
                        <F section="product" label="Page title ({site})" field="metaSearchTitle" />
                        <F section="product" label="Page title with a query ({query}, {site})" field="metaSearchQueryTitle" />
                        <CountF section="product" label="Result count ({n})" field="searchResultCount" example="{n} results" />
                    </div>
                </CardContent>
            </Card>
            </>}

            {/* ── Commerce (commerce tenants; the existing commerce cards) ── */}
            {/* ── Product showcase block (content-only tenants; LOCALE-1C ruling R4) ── */}
            {visible.includes("showcase") && <>
            <SectionHeader section="showcase" onReset={reset} title="Product showcase block" description="The texts of the product showcase block in your pages. Texts saved here are stored with the commerce texts. A cleared input uses the language default." />

            <Card>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F section="showcase" label="No products in the category" field="showcaseEmpty" />
                        <F section="showcase" label="Out of Stock (on a product image)" field="outOfStock" />
                    </div>
                </CardContent>
            </Card>
            </>}

            {visible.includes("commerce") && <>
            <SectionHeader section="commerce" onReset={reset} title="Commerce" description="Cart, checkout, account, order confirmation and tracking, and the buying controls of the shop. A cleared input uses the language default." />

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Product Page — buying</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Add to Cart" field="addToCart" />
                        <F label="In Stock" field="inStock" />
                        <F label="Out of Stock" field="outOfStock" />
                        <F label="Units (volume pricing)" field="units" />
                        <F label="Added to Cart!" field="addedToCart" />
                        <F label="View Cart" field="viewCart" />
                        <F label="Variant Unavailable" field="variantUnavailable" />
                        <F label="Personalization required ({label})" field="personalizationRequired" />
                        <F label="Option required ({name})" field="variantRequired" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Header — account and cart</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Sign In" field="signIn" />
                        <F label="Account (signed in, no name)" field="accountLabel" />
                        <F label="My Account (mobile menu, account page)" field="myAccount" />
                        <F label="Commerce bar cart total ({total}, {currency})" field="cartWidgetTotal" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Shopping Cart</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Cart" field="cart" />
                        <F label="Shopping Cart" field="shoppingCart" />
                        <F label="Empty cart" field="emptyCart" />
                        <F label="Empty cart message" field="emptyCartMessage" />
                        <F label="Continue Shopping" field="continueShopping" />
                        <F label="Order Summary" field="orderSummary" />
                        <F label="Subtotal" field="subtotal" />
                        <F label="Shipping" field="shipping" />
                        <F label="Free Shipping" field="freeShipping" />
                        <F label="Discount" field="discount" />
                        <F label="Total" field="total" />
                        <F label="Apply (coupon)" field="apply" />
                        <F label="Proceed to Checkout" field="proceedToCheckout" />
                        <F label="Free delivery from" field="freeDeliveryFrom" />
                        <F label="Add {amount} more for free delivery" field="addMoreForFreeDelivery" />
                        <F label="Minimum order" field="minimumOrder" />
                        <F label="Coupon code" field="couponCode" />
                        <F label="Remove (coupon)" field="remove" />
                        <F label="Invalid coupon" field="invalidCoupon" />
                        <F label="Coupon could not be checked" field="couponValidateFailed" />
                        <F label="Page title ({site})" field="metaCartTitle" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Contact Information</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Checkout (page title)" field="checkout" />
                        <F label="Contact Information (section)" field="contactInformation" />
                        <F label="Full Name" field="fullName" />
                        <F label="Billing Details (section)" field="billingDetails" />
                        <F label="First Name" field="firstName" />
                        <F label="Last Name" field="lastName" />
                        <F label="Email" field="email" />
                        <F label="Phone" field="phone" />
                        <F label="Phone placeholder" field="phonePlaceholder" />
                        <F label="Birthday" field="birthday" />
                        <F label="Birthday hint" field="birthdayHint" placeholder="For a birthday surprise!" />
                        <F label="Empty cart message (checkout)" field="checkoutEmptyMessage" />
                        <F label="Browser tab title ({site})" field="metaCheckoutTitle" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Company / B2B</CardTitle>
                    <CardDescription>Labels for business customers ordering with invoice</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Order as Company" field="orderAsCompany" />
                        <F label="Company Name" field="companyName" />
                        <F label="Tax ID (e.g. CUI)" field="taxId" />
                        <F label="Tax ID placeholder" field="taxIdPlaceholder" placeholder="e.g. 12345678" />
                        <F label="VAT Number" field="vatNumber" />
                        <F label="VAT placeholder" field="vatNumberPlaceholder" placeholder="e.g. RO12345678" />
                        <F label="Registration No." field="registrationNumber" />
                        <F label="Registration placeholder" field="registrationNumberPlaceholder" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Shipping Address</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Shipping Address (section)" field="shippingAddress" />
                        <F label="Street Address" field="streetAddress" />
                        <F label="Shipping street address (blank = Street Address)" field="shippingStreetAddress" />
                        <F label="City" field="city" />
                        <F label="County / Region" field="county" />
                        <F label="Select County..." field="selectCounty" />
                        <F label="Country" field="country" />
                        <F label="Select Country..." field="selectCountry" />
                        <F label="Postal Code" field="postalCode" />
                        <F label="Delivery Notes" field="deliveryNotes" />
                        <F label="Delivery Notes placeholder" field="deliveryNotesPlaceholder" placeholder="Apartment, floor, etc." />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Billing Address</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Use same for billing" field="useSameAsShipping" />
                        <F label="Billing Address (section)" field="billingAddress" />
                        <F label="Billing street address (blank = Street Address)" field="billingStreetAddress" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Delivery Date</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Preferred Delivery Date" field="preferredDeliveryDate" />
                        <F label="Loading the dates" field="deliveryDatesLoading" />
                        <F label="Selected date ({date})" field="deliveryDateSelected" />
                        <F label="Monday (short)" field="calendarMo" />
                        <F label="Tuesday (short)" field="calendarTu" />
                        <F label="Wednesday (short)" field="calendarWe" />
                        <F label="Thursday (short)" field="calendarTh" />
                        <F label="Friday (short)" field="calendarFr" />
                        <F label="Saturday (short)" field="calendarSa" />
                        <F label="Sunday (short)" field="calendarSu" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Payment & Submit</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Payment Method" field="paymentMethod" />
                        <F label="Cash on Delivery" field="cashOnDelivery" />
                        <F label="COD description" field="cashOnDeliveryDesc" />
                        <F label="Bank Transfer" field="bankTransfer" />
                        <F label="Bank transfer to ({bank}, {iban})" field="bankTransferTo" />
                        <F label="Place Order" field="placeOrder" />
                        <F label="Placing Order..." field="placingOrder" />
                        <F label="Terms Agreement" field="termsAgreement" />
                        <F label="Order failed" field="orderFailed" />
                        <F label="Order failed, with the error code ({status})" field="orderFailedStatus" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Account Page</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Sign-in prompt" field="accountSignInPrompt" />
                        <F label="Sign in with Google" field="signInWithGoogle" />
                        <F label="Sign Out" field="signOut" />
                        <F label="Profile (heading)" field="profileHeading" />
                        <F label="Edit" field="edit" />
                        <F label="Name" field="accountName" />
                        <F label="Save" field="save" />
                        <F label="Saving..." field="saving" />
                        <F label="Cancel" field="cancel" />
                        <F label="Loyalty Points" field="loyaltyPoints" />
                        <F label="Default Address" field="defaultAddress" />
                        <F label="Order History (heading)" field="orderHistory" />
                        <F label="No orders yet" field="noOrdersYet" />
                        <F label="Start Shopping" field="startShopping" />
                        <F label="Status: placed" field="orderStatusPlaced" />
                        <F label="Status: confirmed" field="orderStatusConfirmed" />
                        <F label="Status: prepared" field="orderStatusPrepared" />
                        <F label="Status: shipped" field="orderStatusShipped" />
                        <F label="Status: delivered" field="orderStatusDelivered" />
                        <F label="Status: cancelled" field="orderStatusCancelled" />
                        <F label="Status: annulled" field="orderStatusAnnulled" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Order Confirmation</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Order Confirmation" field="orderConfirmation" />
                        <F label="Page title ({site})" field="metaOrderConfirmationTitle" />
                        <F label="Thank you (no order shown)" field="orderThankYou" />
                        <F label="Order placed message" field="orderPlacedMessage" />
                        <F label="Order Confirmed!" field="orderConfirmed" />
                        <F label="Order number ({number})" field="orderNumber" />
                        <F label="Bank transfer: heading" field="bankTransferDetails" />
                        <F label="Bank transfer: instruction" field="bankTransferInstruction" />
                        <F label="Bank:" field="bankLabel" />
                        <F label="Account Holder:" field="accountHolderLabel" />
                        <F label="IBAN:" field="ibanLabel" />
                        <F label="SWIFT:" field="swiftLabel" />
                        <F label="Reference:" field="referenceLabel" />
                        <F label="Amount:" field="amountLabel" />
                        <F label="Cash on delivery: you will pay ({amount})" field="codPayOnDelivery" />
                        <F label="Estimated delivery:" field="estimatedDelivery" />
                        <F label="Order Details (heading)" field="orderDetails" />
                        <F label="Quantity ({n})" field="quantityLabel" />
                        <F label="Phone line ({phone})" field="phoneLine" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Order Tracking</CardTitle>
                    <CardDescription>The order page a customer opens from the e-mail. The step and history labels are shown with a capital first letter.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Page title ({site})" field="metaOrderTrackingTitle" />
                        <F label="Order Not Found" field="orderNotFound" />
                        <F label="Order not found message" field="orderNotFoundMessage" />
                        <F label="Placed on ({date})" field="placedOn" />
                        <F label="Step: pending" field="orderStepPending" />
                        <F label="Step: confirmed" field="orderStepConfirmed" />
                        <F label="Step: processing" field="orderStepProcessing" />
                        <F label="Step: shipped" field="orderStepShipped" />
                        <F label="Step: delivered" field="orderStepDelivered" />
                        <F label="Step: completed" field="orderStepCompleted" />
                        <F label="Status History (heading)" field="statusHistory" />
                        <F label="History: placed" field="orderHistoryPlaced" />
                        <F label="History: confirmed" field="orderHistoryConfirmed" />
                        <F label="History: prepared" field="orderHistoryPrepared" />
                        <F label="History: shipped" field="orderHistoryShipped" />
                        <F label="History: delivered" field="orderHistoryDelivered" />
                        <F label="History: cancelled" field="orderHistoryCancelled" />
                        <F label="History: annulled" field="orderHistoryAnnulled" />
                        <F label="Tracking (heading)" field="tracking" />
                        <F label="Tracking Number:" field="trackingNumber" />
                        <F label="Items (heading)" field="items" />
                    </div>
                </CardContent>
            </Card>
            </>}

            <div className="flex justify-end pb-8">
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Save Changes
                </Button>
            </div>
        </div>
        </LabelsCtx.Provider>
    );
}
