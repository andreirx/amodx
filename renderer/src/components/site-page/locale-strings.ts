import type { LocaleStrings, ResolvedLocaleStrings, FacetLabels } from "@amodx/shared";
import type { CartPageStrings } from "@/components/CartPageView";
import type { CheckoutPageStrings } from "@/components/CheckoutPageView";
import type { AddToCartStrings } from "@/components/AddToCartButton";
import type { AccountPageStrings } from "@/components/AccountPageView";
import type { SearchBarLabels } from "@/components/SearchBar";
import type { InterestListStrings, InterestToggleStrings } from "@/components/InterestShortlist";
import type { QuoteRequestStrings } from "@/components/QuoteRequest";
import { createElement, Fragment, type ReactNode } from "react";

// ── LOCALE-1D (docs/slices/locale-1.md § 5.2, § 5.3): the texts of the commerce-only views, from the tenant's locale
// table (the resolver), each view getting only the keys it renders. Pattern F keys (§ 5.2: a stored "" falls back to the
// language default, as the English literals did before) are resolved here, so the views render what they receive.

/** `override || language default` — the F rule of § 5.2, for the listed keys of one part. */
function withFallback<T extends Record<string, unknown>, K extends keyof T>(strings: T, defaults: T, keys: readonly K[]): Pick<T, K> {
    const out = {} as Pick<T, K>;
    for (const k of keys) out[k] = (strings[k] || defaults[k]) as T[K];
    return out;
}

/** Copies the listed keys (pattern D: a stored "" renders empty). */
function pick<T extends Record<string, unknown>, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
    const out = {} as Pick<T, K>;
    for (const k of keys) out[k] = source[k];
    return out;
}

export function cartPageStrings({ strings }: ResolvedLocaleStrings): CartPageStrings {
    return pick(strings.commerce, ["emptyCart", "emptyCartMessage", "continueShopping", "shoppingCart", "orderSummary", "remove", "couponCode",
        "apply", "subtotal", "discount", "shipping", "freeShipping", "total", "freeDeliveryFrom", "addMoreForFreeDelivery", "minimumOrder",
        "proceedToCheckout", "invalidCoupon", "couponValidateFailed"]);
}

export function checkoutPageStrings({ strings, defaults }: ResolvedLocaleStrings): CheckoutPageStrings {
    return {
        ...pick(strings.commerce, ["checkout", "email", "phone", "phonePlaceholder", "birthdayHint", "shippingAddress", "country", "selectCountry",
            "streetAddress", "city", "county", "selectCounty", "postalCode", "deliveryNotes", "deliveryNotesPlaceholder", "preferredDeliveryDate",
            "paymentMethod", "cashOnDelivery", "cashOnDeliveryDesc", "bankTransfer", "bankTransferTo", "orderSummary", "subtotal", "discount",
            "shipping", "freeShipping", "total", "placingOrder", "placeOrder", "termsAgreement", "emptyCart", "checkoutEmptyMessage", "orderFailed",
            "orderFailedStatus", "deliveryDateSelected", "deliveryDatesLoading", "calendarMo", "calendarTu", "calendarWe", "calendarTh",
            "calendarFr", "calendarSa", "calendarSu"]),
        // The 14 F sites of CheckoutPageView (§ 5.2).
        ...withFallback(strings.commerce, defaults.commerce, ["billingDetails", "firstName", "lastName", "birthday", "orderAsCompany", "companyName",
            "taxId", "taxIdPlaceholder", "registrationNumber", "registrationNumberPlaceholder", "vatNumber", "vatNumberPlaceholder",
            "useSameAsShipping", "billingAddress"]),
        errorTryAgain: strings.site.errorTryAgain,
    };
}

export function accountPageStrings({ strings, defaults }: ResolvedLocaleStrings): AccountPageStrings {
    return {
        ...pick(strings.commerce, ["myAccount", "accountSignInPrompt", "signInWithGoogle", "signOut", "profileHeading", "edit", "accountName", "email",
            "birthdayHint", "save", "saving", "cancel", "loyaltyPoints", "defaultAddress", "orderHistory", "noOrdersYet", "startShopping",
            "orderStatusPlaced", "orderStatusConfirmed", "orderStatusPrepared", "orderStatusShipped", "orderStatusDelivered",
            "orderStatusCancelled", "orderStatusAnnulled"]),
        // The F sites of AccountPageView (§ 5.2).
        ...withFallback(strings.commerce, defaults.commerce, ["phone", "phonePlaceholder", "birthday"]),
    };
}

/** The add-to-cart control's texts: the five button texts are F sites (§ 5.2); the two errors and the select placeholder D. */
export function addToCartStrings({ strings, defaults }: ResolvedLocaleStrings): AddToCartStrings {
    return {
        ...withFallback(strings.commerce, defaults.commerce, ["addToCart", "addedToCart", "viewCart", "outOfStock", "variantUnavailable"]),
        ...pick(strings.commerce, ["personalizationRequired", "variantRequired"]),
        formSelectPlaceholder: strings.site.formSelectPlaceholder,
    };
}

/** The tenant's normalised locale as `formatLocale` — ONLY when it is not en-US (§ 16.2 item 4: an en-US tenant keeps
 *  the formatter defaults it had). A spread, so an en-US page's props stay byte-identical (no "$undefined"). */
export function formatLocaleProp(locale: string): { formatLocale?: string } {
    return locale !== "en-US" ? { formatLocale: locale } : {};
}

/**
 * LOCALE-1D (§ 5.1, "interpolate"): a table template split at its `{placeholders}` into React children — each text
 * segment, and each value (a text, a number or an element) as its own child; empty segments are dropped; an unknown
 * placeholder stays as written. Used where a sentence wraps a value in markup ("You will pay <strong>…</strong> …") or
 * where today's JSX renders the value as its own text node ("Order {number}"): the children equal the JSX they replace,
 * so an en-US page's HTML and payload stay byte-identical. Returned as a fragment with its children as arguments (static
 * children: no list keys needed). Rejected: `fillTemplate` (merges the value into the text, changing the bytes, and
 * cannot hold markup).
 */
export function interpolateNodes(template: string, values: Record<string, ReactNode>): ReactNode {
    const parts = template.split(/\{([A-Za-z0-9_]+)\}/)
        .map((piece, i) => (i % 2 === 0 ? piece : Object.prototype.hasOwnProperty.call(values, piece) ? values[piece] : `{${piece}}`))
        .filter((part) => part !== "");
    return createElement(Fragment, null, ...parts);
}

/**
 * LOCALE-1B (docs/slices/locale-1.md § 5.2 row F): the SearchBar's four texts — the tenant override when it is a
 * non-empty text, else the language default (a stored "" falls back, as the English literals did before).
 * Key order = the order these four had before LOCALE-1B (the RSC payload carries the object).
 */
export function searchBarLabels({ strings, defaults }: ResolvedLocaleStrings): SearchBarLabels {
    const s = strings.commerce, d = defaults.commerce;
    return {
        searchButton: s.searchButton || d.searchButton,
        searchNoResults: s.searchNoResults || d.searchNoResults,
        searchSearching: s.searchSearching || d.searchSearching,
        viewAllResults: s.viewAllResults || d.viewAllResults,
    };
}

/** LOCALE-1B (§ 6.3): the headings of the two fixed facets, from the tenant's catalog texts. */
export function facetLabelsOf(catalog: LocaleStrings["catalog"]): FacetLabels {
    return { producer: catalog.facetProducer, variantDefault: catalog.facetVariantDefault };
}

/** LOCALE-1B: a fresh object per toggle (the RSC encoder outlines an object it meets twice; one per element keeps each
 *  toggle's props inline, as before). */
export function interestToggleStrings(catalog: LocaleStrings["catalog"]): InterestToggleStrings {
    return { interestAdd: catalog.interestAdd, interestAdded: catalog.interestAdded, interestListFull: catalog.interestListFull };
}

/** CAT-QUOTE-1: the quote button's and dialog's texts (only the keys it uses, § 5.3). */
export function quoteRequestStrings(c: LocaleStrings["catalog"]): QuoteRequestStrings {
    return { quoteButton: c.quoteButton, quoteTitle: c.quoteTitle, quoteCall: c.quoteCall, quoteWhatsApp: c.quoteWhatsApp, quoteEmail: c.quoteEmail, quoteMessage: c.quoteMessage, quoteClose: c.quoteClose };
}

/** LOCALE-1B: the list page's texts (only the keys it uses, § 5.3). */
export function interestListStrings(c: LocaleStrings["catalog"]): InterestListStrings {
    return {
        interestListTitle: c.interestListTitle, interestBrowse: c.interestBrowse, interestSentTitle: c.interestSentTitle,
        interestSentBody: c.interestSentBody, interestExcludedIntro: c.interestExcludedIntro, interestEmpty: c.interestEmpty,
        interestAdd: c.interestAdd, interestErrorNoneAvailable: c.interestErrorNoneAvailable, interestErrorInvalid: c.interestErrorInvalid,
        interestErrorCheck: c.interestErrorCheck, interestErrorAllGone: c.interestErrorAllGone, interestErrorSend: c.interestErrorSend,
        interestErrorNetwork: c.interestErrorNetwork, interestPreviouslySent: c.interestPreviouslySent,
        interestContactHeading: c.interestContactHeading, interestName: c.interestName, interestEmail: c.interestEmail,
        interestPhone: c.interestPhone, interestMessage: c.interestMessage, interestSubmit: c.interestSubmit,
        interestRowExpired: c.interestRowExpired, interestRowUnavailable: c.interestRowUnavailable,
        interestRowOptionGone: c.interestRowOptionGone, interestCollection: c.interestCollection, interestRemove: c.interestRemove,
    };
}
