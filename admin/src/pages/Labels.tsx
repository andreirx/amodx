import { createContext, useContext, useEffect, useState } from "react";
import { useTenant } from "@/context/TenantContext";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RotateCcw, Save } from "lucide-react";
import {
    COOKIE_AND_LEGAL_LABEL_LOCATIONS, CommerceStringsSchema, SiteStringsSchema, resolveLocaleStrings,
    type CookieOrLegalLabelKey, type LocaleStrings,
} from "@amodx/shared";

// ── LOCALE-1A (docs/slices/locale-1.md § 7.1): the Labels page edits the tenant's locale table ─────────────────────
// Three stored homes, one input per key: `commerceStrings` (commerce part), `siteStrings` (site part, without the
// nine cookie/legal keys) and the label fields of `gdpr` / `legalLinks` (the nine, § 4.1). The pure helpers below
// build what a save sends; `Labels.test.ts` pins them.

/** Which stored home an input edits. `labels` = the nine cookie/legal keys, stored in gdpr/legalLinks fields. */
export type LabelsPart = "commerce" | "site" | "labels";

/** What the page edits: copies of the loaded objects (unknown and non-string stored keys are kept, § 2.4). */
export type LabelsDraft = {
    commerce: Record<string, unknown>;
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
    return { commerce: { ...asObject(settings.commerceStrings) }, site: { ...asObject(settings.siteStrings) }, labels };
}

/** One input changed. An empty input removes the override (the page never writes ""). */
export function setText(draft: LabelsDraft, part: LabelsPart, key: string, value: string): LabelsDraft {
    const next = { ...draft[part] } as Record<string, unknown>;
    if (value) next[key] = value;
    else delete next[key];
    return { ...draft, [part]: next };
}

/** The keys each Reset button covers: every key of its section that has an input. */
export const SECTION_KEYS = {
    site: Object.keys(SiteStringsSchema.shape).filter((k) => !NINE.includes(k as CookieOrLegalLabelKey)),
    labels: NINE as string[],
    commerce: Object.keys(CommerceStringsSchema.shape),
} satisfies Record<LabelsPart, string[]>;

/** How many overrides a Reset of `part` removes. */
export function overrideCount(draft: LabelsDraft, part: LabelsPart): number {
    return SECTION_KEYS[part].filter((k) => Object.prototype.hasOwnProperty.call(draft[part], k)).length;
}

/** "Reset to the language defaults": removes every override of the section's keys; nothing else (§ 7.1). */
export function resetSection(draft: LabelsDraft, part: LabelsPart): LabelsDraft {
    const next = { ...draft[part] } as Record<string, unknown>;
    for (const key of SECTION_KEYS[part]) delete next[key];
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
    update: (part: LabelsPart, key: string, value: string) => void;
}>({ draft: { commerce: {}, site: {}, labels: {} }, defaults: null, update: () => {} });

/**
 * One input. The value is the tenant's stored override; the placeholder is the default of the tenant's site language
 * (layers 1 + 2 of the resolver), so an owner sees what visitors get when the input is blank.
 */
function F({ label, field, part = "commerce", placeholder }: { label: string; field: string; part?: LabelsPart; placeholder?: string }) {
    const { draft, defaults, update } = useContext(LabelsCtx);
    const stored = (draft[part] as Record<string, unknown>)[field];
    const languageDefault = defaults ? (part === "commerce" ? (defaults.commerce as Record<string, string>)[field] : (defaults.site as Record<string, string>)[field]) : "";
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

/** A group heading with its one-line description and its Reset button. */
function SectionHeader({ title, description, part, onReset }: { title: string; description: string; part: LabelsPart; onReset: (part: LabelsPart, title: string) => void }) {
    const { draft } = useContext(LabelsCtx);
    const count = overrideCount(draft, part);
    return (
        <div className="flex items-end justify-between gap-4 pt-2">
            <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="text-muted-foreground text-sm">{description}</p>
            </div>
            <Button variant="outline" size="sm" disabled={count === 0} onClick={() => onReset(part, title)}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset to the language defaults
            </Button>
        </div>
    );
}

export default function Labels() {
    const { currentTenant } = useTenant();
    const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
    const [draft, setDraft] = useState<LabelsDraft>({ commerce: {}, site: {}, labels: {} });
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

    const reset = (part: LabelsPart, title: string) => {
        const count = overrideCount(draft, part);
        if (count === 0) return;
        if (!confirm(`Reset ${count} text${count === 1 ? "" : "s"} in "${title}" to the language defaults? Click Save Changes to apply.`)) return;
        setDraft(prev => resetSection(prev, part));
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

    const defaults = settings ? resolveLocaleStrings(settings).defaults : null;
    const isCommerce = settings?.commerceEnabled === true;

    return (
        <LabelsCtx.Provider value={{ draft, defaults, update }}>
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
            <SectionHeader part="site" onReset={reset} title="Site" description="Header, footer, page navigation, comments, sharing and forms — on every page of the site. A cleared input uses the language default." />

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Header & Navigation</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F part="site" label="Contact button" field="navContact" />
                        <F part="site" label="Contact button (mobile menu)" field="navContactUs" />
                        <F part="site" label="Menu button (screen readers)" field="navToggleMenu" />
                        <F part="site" label="Dropdown: all of {label}" field="navAllOf" />
                        <F part="site" label="Dropdown: View All (mobile)" field="navViewAll" />
                        <F part="site" label="Breadcrumb: Home" field="breadcrumbHome" />
                        <F part="site" label="Site name, when none is set" field="untitledSiteName" />
                        <F part="site" label="Search engine description, when none is set ({name})" field="metaSiteDescription" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Footer</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F part="site" label="Tax ID line ({value})" field="footerTaxId" />
                        <F part="site" label="Trade register line ({value})" field="footerTradeRegister" />
                        <F part="site" label="Phone line ({value})" field="footerPhone" />
                        <F part="site" label="Links heading" field="footerLinksHeading" />
                        <F part="site" label="Legal heading" field="footerLegalHeading" />
                        <F part="site" label="Copyright ({year}, {name})" field="footerCopyright" />
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
                        <F part="site" label="Previous page" field="paginationPrevious" />
                        <F part="site" label="Page {page} of {total}" field="paginationPageOf" />
                        <F part="site" label="Next page" field="paginationNext" />
                        <F part="site" label="Restricted: title" field="restrictedTitle" />
                        <F part="site" label="Restricted: sign-in needed" field="restrictedLoginRequired" />
                        <F part="site" label="Restricted: subscription ({currency} {price})" field="restrictedSubscription" />
                        <F part="site" label="Restricted: sign-in button" field="restrictedLogIn" />
                        <F part="site" label="Restricted: purchase button" field="restrictedPurchase" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Comments</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F part="site" label="Heading ({count})" field="commentsHeading" />
                        <F part="site" label="No comments" field="commentsEmpty" />
                        <F part="site" label="Comments closed" field="commentsClosed" />
                        <F part="site" label="Comment placeholder" field="commentsPlaceholder" />
                        <F part="site" label="Post button" field="commentsPost" />
                        <F part="site" label="Post failed" field="commentsPostFailed" />
                        <F part="site" label="Join heading" field="commentsJoin" />
                        <F part="site" label="Sign-in button" field="commentsSignIn" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Sharing, Contact Button & Forms</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F part="site" label="Share label" field="shareLabel" />
                        <F part="site" label="Share on X" field="shareOnX" />
                        <F part="site" label="Share on LinkedIn" field="shareOnLinkedIn" />
                        <F part="site" label="Share on Facebook" field="shareOnFacebook" />
                        <F part="site" label="Share by email" field="shareByEmail" />
                        <F part="site" label="Copy link" field="shareCopyLink" />
                        <F part="site" label="Contact button: call" field="quickContactCall" />
                        <F part="site" label="Contact button: email" field="quickContactEmail" />
                        <F part="site" label="Form: submitting" field="formSubmitting" />
                        <F part="site" label="Form: select placeholder" field="formSelectPlaceholder" />
                        <F part="site" label="Form: submission failed" field="formSubmissionFailed" />
                        <F part="site" label="Form: other error" field="formErrorShort" />
                    </div>
                </CardContent>
            </Card>

            {/* ── Cookie banner & legal links (every tenant; stored in gdpr / legalLinks, § 4.1) ── */}
            <SectionHeader part="labels" onReset={reset} title="Cookie banner & legal links" description="The cookie banner and the legal link texts in the footer. The banner on/off, its position and the link addresses stay in Settings." />

            <Card>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F part="labels" label="Banner headline" field="cookieHeadline" />
                        <F part="labels" label="Banner text" field="cookieDescription" />
                        <F part="labels" label="Deny All button" field="cookieDenyAll" />
                        <F part="labels" label="Necessary Only button" field="cookieNecessaryOnly" />
                        <F part="labels" label="Accept All button" field="cookieAcceptAll" />
                        <F part="labels" label="Terms link" field="legalTermsLabel" />
                        <F part="labels" label="Privacy link" field="legalPrivacyLabel" />
                        <F part="labels" label="Consumer protection link" field="legalConsumerProtectionLabel" />
                        <F part="labels" label="Dispute resolution link" field="legalDisputeResolutionLabel" />
                    </div>
                </CardContent>
            </Card>

            {/* ── Commerce (commerce tenants; the existing commerce cards) ── */}
            {isCommerce && <>
            <SectionHeader part="commerce" onReset={reset} title="Commerce" description="Product pages, cart, checkout, search and account texts of the shop." />

            {/* Product Page */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Product Page</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Description" field="description" />
                        <F label="Add to Cart" field="addToCart" />
                        <F label="In Stock" field="inStock" />
                        <F label="Out of Stock" field="outOfStock" />
                        <F label="Units (volume pricing)" field="units" />
                        <F label="Added to Cart!" field="addedToCart" />
                        <F label="View Cart" field="viewCart" />
                        <F label="Variant Unavailable" field="variantUnavailable" />
                    </div>
                </CardContent>
            </Card>

            {/* Cart */}
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
                    </div>
                </CardContent>
            </Card>

            {/* Checkout - Contact */}
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
                    </div>
                </CardContent>
            </Card>

            {/* Checkout - Company / B2B */}
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

            {/* Checkout - Shipping Address */}
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

            {/* Checkout - Billing Address */}
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

            {/* Checkout - Payment & Submit */}
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
                        <F label="Preferred Delivery Date" field="preferredDeliveryDate" />
                        <F label="Place Order" field="placeOrder" />
                        <F label="Placing Order..." field="placingOrder" />
                        <F label="Terms Agreement" field="termsAgreement" />
                    </div>
                </CardContent>
            </Card>

            {/* Search */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Search</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Search Button" field="searchButton" />
                        <F label="No Results" field="searchNoResults" />
                        <F label="Searching..." field="searchSearching" />
                        <F label="View All Results" field="viewAllResults" />
                        <F label="Results For (heading)" field="resultsFor" />
                        <F label="Search Products (heading)" field="searchProducts" />
                    </div>
                </CardContent>
            </Card>

            {/* Account / Auth */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Account / Authentication</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Sign In" field="signIn" />
                        <F label="Account" field="accountLabel" />
                    </div>
                </CardContent>
            </Card>

            {/* Confirmation */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Order Confirmation</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Order Confirmation" field="orderConfirmation" />
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
