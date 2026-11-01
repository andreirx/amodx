import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
    CommerceStringsSchema, CatalogStringsSchema, SiteStringsSchema, PluralTextsSchema, EN_PACK, RO_PACK,
    EN_LANGUAGE_PACK, RO_LANGUAGE_PACK, LANGUAGE_PACKS, COOKIE_AND_LEGAL_LABEL_LOCATIONS, PLURAL_CATEGORIES,
    normalizeLocale, localeLanguageSubtag, resolveLocaleStrings, fillTemplate, selectPluralText, pluralCategoriesOf, type LanguagePack, type CountText,
    BLOCK_SITE_KEYS, BLOCK_FALLBACK_KEYS, blockStrings,
} from "../src/index.js";
import * as shared from "../src/index.js";

/**
 * LOCALE-1A — the shared checks of docs/slices/locale-1.md § 10 row `locale-1a`: EN pack complete, RO pack covers
 * every shipped key, layer order, the § 3.3 locale cases, non-string values ignored, the nine cookie/legal keys never
 * read from `siteStrings`, `fillTemplate`; plus § 16.2 item 3 (a new language = one pack + its registration).
 * Imports the TS source (`../src/index.js`), as schemas.test.ts does. Pure: no clock, no I/O.
 * LOCALE-1B adds: the 1b allocation (39 catalog keys, 21 shared commerce keys), the count keys and their plural
 * categories (§ 16.2 item 6): EN 0/1/2, RO 0/1/2/19/20/101/119/120, per-category overrides, a throwaway third pack with
 * its own categories, the missing-category and missing-key fallbacks.
 * LOCALE-1D adds: the 80 commerce-only keys and `site.errorTryAgain`; the RO pack holds literals (the values the RO
 * country pack held at the start commit, from `fixtures/locale-1d-packs-92adbba.json`, unchanged); the country packs
 * hold facts only; the compatibility export of the English commerce defaults is gone (§ 10.2).
 * LOCALE-1C adds: the 26 block-chrome site keys and `commerce.showcaseEmpty` (EN = the literal each block renderer showed at
 * the start commit 0c0dbc8; RO = the § 6.1 / § 6.2 column), and `blockStrings` — the `strings` prop of every block (§ 5.3).
 */

/** The text members of the packs at the slice's start commit 92adbba (read from that commit's build; see the file). */
const START = JSON.parse(readFileSync(new URL("./fixtures/locale-1d-packs-92adbba.json", import.meta.url), "utf8")) as {
    countryPacks: Record<"EN" | "RO", { defaultStrings: Record<string, string>; gdpr: Record<string, string>; legal: Record<string, string> }>;
    languagePacks: Record<"en" | "ro", { commerce: Record<string, unknown>; site: Record<string, string> }>;
};

const keys = (o: object) => Object.keys(o).sort();
const SITE_KEYS = keys(SiteStringsSchema.shape);
/** The count keys of a part schema (LOCALE-1B): the keys whose type is the plural-texts object. */
const countKeys = (shape: Record<string, { unwrap: () => unknown }>) => Object.keys(shape).filter((k) => shape[k].unwrap() === PluralTextsSchema).sort();
const COMMERCE_COUNT_KEYS = countKeys(CommerceStringsSchema.shape);
const CATALOG_COUNT_KEYS = countKeys(CatalogStringsSchema.shape);
/** The 21 shared product-surface keys of locale-1b (§ 6.2, without the two CategoryShowcaseRender rows of 1c). */
const COMMERCE_1B_KEYS = [
    "metaCategoryDescription", "metaShopTitle", "metaSearchQueryTitle", "metaSearchTitle", "searchPlaceholder", "shopTitle",
    "volumePricing", "preOrder", "buyNow", "ingredients", "nutritionalValues", "reviewsHeading", "reviewsSummary",
    "categoryEmpty", "productCount", "shopEmptyInStock", "shopEmpty", "shopAllProducts", "searchBreadcrumb",
    "searchResultCount", "searchEnterTerm",
];
/** The 80 commerce-only keys of locale-1d (§ 6.2 "Commerce-only surfaces", the rows that are not E: rows), in order. */
const COMMERCE_1D_KEYS = [
    "metaCartTitle", "metaCheckoutTitle", "metaOrderConfirmationTitle", "metaOrderTrackingTitle", "personalizationRequired",
    "variantRequired", "cartWidgetTotal", "couponValidateFailed", "deliveryDatesLoading", "calendarMo", "calendarTu", "calendarWe",
    "calendarTh", "calendarFr", "calendarSa", "calendarSu", "checkoutEmptyMessage", "orderFailed", "orderFailedStatus",
    "deliveryDateSelected", "bankTransferTo", "orderStatusPlaced", "orderStatusConfirmed", "orderStatusPrepared", "orderStatusShipped",
    "orderStatusDelivered", "orderStatusCancelled", "orderStatusAnnulled", "myAccount", "accountSignInPrompt", "signInWithGoogle",
    "signOut", "profileHeading", "edit", "accountName", "save", "saving", "cancel", "loyaltyPoints", "defaultAddress", "orderHistory",
    "noOrdersYet", "startShopping", "orderThankYou", "orderPlacedMessage", "orderConfirmed", "orderNumber", "bankTransferDetails",
    "bankTransferInstruction", "bankLabel", "accountHolderLabel", "ibanLabel", "swiftLabel", "referenceLabel", "amountLabel",
    "codPayOnDelivery", "estimatedDelivery", "orderDetails", "quantityLabel", "phoneLine", "orderNotFound", "orderNotFoundMessage",
    "placedOn", "orderStepPending", "orderStepConfirmed", "orderStepProcessing", "orderStepShipped", "orderStepDelivered",
    "orderStepCompleted", "statusHistory", "orderHistoryPlaced", "orderHistoryConfirmed", "orderHistoryPrepared", "orderHistoryShipped",
    "orderHistoryDelivered", "orderHistoryCancelled", "orderHistoryAnnulled", "tracking", "trackingNumber", "items",
];
/** LOCALE-1C: the 26 block-chrome site keys of § 6.1, in schema order, with the literal each block renderer showed at the
 *  start commit 0c0dbc8 (`packages/plugins/src/<block>/<Block>Render.tsx`) — the EN pack value, byte for byte — and the
 *  RO value proposed in § 6.1. */
const SITE_1C: [string, string, string][] = [
    ["contactSendFailed", "Failed to send message", "Mesajul nu a putut fi trimis"],
    ["contactSent", "Message Sent!", "Mesaj trimis!"],
    ["contactSentDetail", "We'll get back to you shortly.", "Îți răspundem în curând."],
    ["contactName", "Name", "Nume"],
    ["contactEmail", "Email", "Email"],
    ["contactMessage", "Message", "Mesaj"],
    ["contactSending", "Sending...", "Se trimite..."],
    ["leadUnlocked", "Unlocked!", "Deblocat!"],
    ["leadFileReady", "Your file is ready.", "Fișierul tău este gata."],
    ["leadDownload", "Download Now", "Descarcă acum"],
    ["leadEmail", "Email", "Email"],
    ["leadEmailPlaceholder", "name@example.com", "nume@exemplu.ro"],
    ["leadUnlocking", "Unlocking...", "Se deblochează..."],
    ["heroNoImage", "No Image", "Fără imagine"],
    ["imageAltFallback", "Image", "Imagine"],
    ["videoTitle", "Embedded video", "Video încorporat"],
    ["videoBackgroundTitle", "Background video", "Video de fundal"],
    ["noImage", "No image", "Fără imagine"],
    ["noImageCaps", "NO IMAGE", "FĂRĂ IMAGINE"],
    ["carouselView", "View", "Vezi"],
    ["codeCopy", "Copy", "Copiază"],
    ["codeCopied", "Copied!", "Copiat!"],
    ["reviewsReadMore", "Read more", "Citește mai mult"],
    ["reviewsShowLess", "Show less", "Arată mai puțin"],
    ["postsEmpty", "No posts found.", "Nu s-au găsit articole."],
    ["postsLoadFailed", "API {status}", "Eroare API {status}"],
];

describe("the language packs", () => {
    it("the EN pack has exactly the schema keys of every part (completeness is also a compile-time fact)", () => {
        expect(keys(EN_LANGUAGE_PACK.commerce)).toEqual(keys(CommerceStringsSchema.shape));
        expect(keys(EN_LANGUAGE_PACK.catalog)).toEqual(keys(CatalogStringsSchema.shape));
        expect(keys(EN_LANGUAGE_PACK.site)).toEqual(SITE_KEYS);
        // A text key holds a string; a count key (LOCALE-1B) the English categories `one` and `other`, and only those.
        for (const part of [EN_LANGUAGE_PACK.site, EN_LANGUAGE_PACK.commerce, EN_LANGUAGE_PACK.catalog] as Record<string, unknown>[]) {
            for (const [k, v] of Object.entries(part)) {
                if ([...COMMERCE_COUNT_KEYS, ...CATALOG_COUNT_KEYS].includes(k)) expect(keys(v as object), k).toEqual(["one", "other"]);
                else expect(typeof v, k).toBe("string");
            }
        }
    });

    it("the allocation so far: 51 site keys (1a) + errorTryAgain (1d) + 26 block keys (1c); 39 catalog keys and 21 shared commerce keys (1b); 80 commerce-only keys (1d) + showcaseEmpty (1c); the count keys", () => {
        expect(SITE_KEYS).toHaveLength(52 + 26);
        expect(Object.keys(SiteStringsSchema.shape).slice(51)).toEqual(["errorTryAgain", ...SITE_1C.map(([k]) => k)]);
        expect(COMMERCE_1D_KEYS).toHaveLength(80);
        expect(new Set(COMMERCE_1D_KEYS).size).toBe(80);
        expect(Object.keys(CommerceStringsSchema.shape)).toHaveLength(77 + 21 + 80 + 1);
        expect(Object.keys(CommerceStringsSchema.shape).slice(77 + 21)).toEqual([...COMMERCE_1D_KEYS, "showcaseEmpty"]);
        expect(keys(CatalogStringsSchema.shape)).toHaveLength(39);
        expect(COMMERCE_1B_KEYS.filter((k) => !Object.hasOwn(CommerceStringsSchema.shape, k))).toEqual([]);
        expect(COMMERCE_COUNT_KEYS).toEqual(["productCount", "reviewsSummary", "searchResultCount"]);
        expect(CATALOG_COUNT_KEYS).toEqual(["facetsCount", "interestWidgetLabel"]);
        expect(countKeys(SiteStringsSchema.shape)).toEqual([]);
        expect(Object.keys(PluralTextsSchema.shape)).toEqual([...PLURAL_CATEGORIES]);
    });

    it("the EN commerce part: the 98 values of the start commit unchanged (key order included), then the 80 literals of 1d; no compatibility export is left (§ 10.2)", () => {
        const start = START.languagePacks.en.commerce;
        expect(Object.keys(start)).toHaveLength(98);
        expect(Object.fromEntries(Object.entries(EN_LANGUAGE_PACK.commerce).slice(0, 98))).toEqual(start);
        expect(Object.keys(EN_LANGUAGE_PACK.commerce).slice(0, 98)).toEqual(Object.keys(start));
        expect(Object.keys(EN_LANGUAGE_PACK.commerce).slice(98)).toEqual([...COMMERCE_1D_KEYS, "showcaseEmpty"]);
        expect(EN_LANGUAGE_PACK.commerce.personalizationRequired).toBe('Please fill in "{label}"');
        expect(EN_LANGUAGE_PACK.commerce.orderStepPending).toBe("pending");
        expect(Object.keys(shared).filter((name) => /COMMERCE_STRINGS_DEFAULTS|getCommerceStrings/.test(name))).toEqual([]);
        // The EN site part: the 51 values of the start commit unchanged, then errorTryAgain (the CheckoutPageView literal).
        expect(Object.fromEntries(Object.entries(EN_LANGUAGE_PACK.site).slice(0, 51))).toEqual(START.languagePacks.en.site);
        expect(EN_LANGUAGE_PACK.site.errorTryAgain).toBe("Something went wrong. Please try again.");
    });

    it("the EN cookie and legal values are the chain the layout rendered before 1a (field || EN country pack || literal); since 1d literals equal to the start commit's EN country pack", () => {
        const c = START.countryPacks.EN;
        expect([EN_LANGUAGE_PACK.site.cookieHeadline, EN_LANGUAGE_PACK.site.cookieDescription, EN_LANGUAGE_PACK.site.cookieDenyAll, EN_LANGUAGE_PACK.site.cookieNecessaryOnly, EN_LANGUAGE_PACK.site.cookieAcceptAll])
            .toEqual([c.gdpr.headline, c.gdpr.description, c.gdpr.denyAll, c.gdpr.necessaryOnly, c.gdpr.acceptAll]);
        expect([EN_LANGUAGE_PACK.site.legalTermsLabel, EN_LANGUAGE_PACK.site.legalPrivacyLabel, EN_LANGUAGE_PACK.site.legalConsumerProtectionLabel, EN_LANGUAGE_PACK.site.legalDisputeResolutionLabel])
            .toEqual([c.legal.termsLabel, c.legal.privacyLabel, c.legal.consumerProtectionLabel, c.legal.disputeResolutionLabel]);
        expect(EN_LANGUAGE_PACK.site.cookieHeadline).toBe("We value your privacy");
        expect(EN_LANGUAGE_PACK.site.cookieDescription).toBe("We use cookies to enhance your browsing experience and analyze our traffic. Choose your preference below.");
        expect(EN_LANGUAGE_PACK.site.cookieDenyAll).toBe("Deny All");
        expect(EN_LANGUAGE_PACK.site.cookieNecessaryOnly).toBe("Necessary Only");
        expect(EN_LANGUAGE_PACK.site.cookieAcceptAll).toBe("Accept All");
        expect(EN_LANGUAGE_PACK.site.legalTermsLabel).toBe("Terms & Conditions");
        expect(EN_LANGUAGE_PACK.site.legalPrivacyLabel).toBe("Privacy Policy");
        expect(EN_LANGUAGE_PACK.site.legalConsumerProtectionLabel).toBe("Consumer Protection");
        expect(EN_LANGUAGE_PACK.site.legalDisputeResolutionLabel).toBe("Dispute Resolution");
    });

    it("the RO pack covers every site and catalog key, and every commerce key except the two whose English value is the empty fallback; each count key has every Romanian plural category", () => {
        expect(keys(RO_LANGUAGE_PACK.site)).toEqual(SITE_KEYS);
        for (const v of Object.values(RO_LANGUAGE_PACK.site)) expect(typeof v === "string" && v.length > 0).toBe(true);
        expect(keys(RO_LANGUAGE_PACK.catalog)).toEqual(keys(CatalogStringsSchema.shape));
        const isCount = (k: string) => [...COMMERCE_COUNT_KEYS, ...CATALOG_COUNT_KEYS].includes(k);
        const present = (part: Record<string, unknown>, k: string) => (isCount(k)
            ? typeof part[k] === "object" && part[k] !== null && keys(part[k] as object).join() === pluralCategoriesOf("ro").sort().join()
                && Object.values(part[k] as object).every((t) => typeof t === "string" && t.length > 0)
            : typeof part[k] === "string");
        const missing = keys(CommerceStringsSchema.shape).filter((k) => !present(RO_LANGUAGE_PACK.commerce as Record<string, unknown>, k));
        expect(missing).toEqual(["billingStreetAddress", "shippingStreetAddress"]);
        expect(keys(CatalogStringsSchema.shape).filter((k) => !present(RO_LANGUAGE_PACK.catalog as Record<string, unknown>, k))).toEqual([]);
        expect(pluralCategoriesOf("ro")).toEqual(["one", "few", "other"]);
    });

    it("LOCALE-1D: the RO pack holds the start commit's RO country-pack texts as literals, unchanged; its 1b values unchanged; then the 80 keys of 1d", () => {
        const c = START.countryPacks.RO;
        const ro = RO_LANGUAGE_PACK.commerce as Record<string, unknown>;
        expect(Object.keys(c.defaultStrings)).toHaveLength(75);
        for (const [k, v] of Object.entries(c.defaultStrings)) expect(ro[k], k).toBe(v);
        // The start commit's RO language pack (75 country-pack values + the 21 keys of 1b): every value unchanged.
        expect(Object.keys(START.languagePacks.ro.commerce)).toHaveLength(96);
        for (const [k, v] of Object.entries(START.languagePacks.ro.commerce)) expect(ro[k], k).toEqual(v);
        expect(keys(ro).filter((k) => !Object.hasOwn(START.languagePacks.ro.commerce, k))).toEqual([...COMMERCE_1D_KEYS, "showcaseEmpty"].sort());
        const s = RO_LANGUAGE_PACK.site;
        expect([s.cookieHeadline, s.cookieDescription, s.cookieDenyAll, s.cookieNecessaryOnly, s.cookieAcceptAll])
            .toEqual([c.gdpr.headline, c.gdpr.description, c.gdpr.denyAll, c.gdpr.necessaryOnly, c.gdpr.acceptAll]);
        expect([s.legalTermsLabel, s.legalPrivacyLabel, s.legalConsumerProtectionLabel, s.legalDisputeResolutionLabel])
            .toEqual([c.legal.termsLabel, c.legal.privacyLabel, c.legal.consumerProtectionLabel, c.legal.disputeResolutionLabel]);
        for (const [k, v] of Object.entries(START.languagePacks.ro.site)) expect((s as Record<string, string>)[k], k).toBe(v);
        expect(s.errorTryAgain).toBe("A apărut o eroare. Încearcă din nou.");
    });

    it("LOCALE-1D: the country packs hold facts only (currency, locale, regions, address formats); the RO counties are unchanged", () => {
        for (const pack of [EN_PACK, RO_PACK]) expect(keys(pack)).toEqual(["address", "code", "currency", "locale", "name"]);
        expect(RO_PACK.address.regions).toHaveLength(42);
        expect(RO_PACK.currency.code).toBe("RON");
        expect(EN_PACK.address.regions).toEqual([]);
    });

    it("the registry holds en and ro, each under its own language subtag", () => {
        expect(keys(LANGUAGE_PACKS)).toEqual(["en", "ro"]);
        for (const [language, pack] of Object.entries(LANGUAGE_PACKS)) expect(pack.language).toBe(language);
        expect(LANGUAGE_PACKS.ro.defaultLocale).toBe("ro-RO");
        expect(LANGUAGE_PACKS.en.defaultLocale).toBe("en-US");
    });
});

describe("LOCALE-1C: the block-chrome keys and blockStrings (§ 5.3, § 6.1, § 6.2)", () => {
    it("EN = the literal each block renderer showed at 0c0dbc8; RO = the § 6.1 column; showcaseEmpty likewise (§ 6.2)", () => {
        for (const [key, en, ro] of SITE_1C) {
            expect((EN_LANGUAGE_PACK.site as Record<string, string>)[key], key).toBe(en);
            expect((RO_LANGUAGE_PACK.site as Record<string, string>)[key], key).toBe(ro);
        }
        expect(EN_LANGUAGE_PACK.commerce.showcaseEmpty).toBe("No products found in this category.");
        expect(RO_LANGUAGE_PACK.commerce.showcaseEmpty).toBe("Nu s-au găsit produse în această categorie.");
        // The two shared form texts the blocks also read keep their values.
        expect([EN_LANGUAGE_PACK.site.formSubmissionFailed, EN_LANGUAGE_PACK.site.errorTryAgain]).toEqual(["Submission failed", "Something went wrong. Please try again."]);
    });

    it("blockStrings: exactly the block site keys, showcaseEmpty and outOfStock, in that order, as resolved; no locale for an en-US tenant", () => {
        const resolved = resolveLocaleStrings({});
        const s = blockStrings(resolved, { catalogMode: false });
        expect(Object.keys(s)).toEqual([...BLOCK_SITE_KEYS, "showcaseEmpty", "outOfStock"]);
        expect(BLOCK_SITE_KEYS).toEqual(["formSubmissionFailed", "errorTryAgain", ...SITE_1C.map(([k]) => k)]);
        for (const k of BLOCK_SITE_KEYS) expect(s[k], k).toBe(resolved.strings.site[k]);
        expect(s.outOfStock).toBe("Out of Stock");
        expect(Object.hasOwn(s, "dateLocale")).toBe(false);
        // A malformed or absent locale is en-US (§ 3.3): no locale either.
        for (const locale of [undefined, "en-US", "en_US", " en-US ", "xx-YY", 42]) {
            expect(Object.hasOwn(blockStrings(resolveLocaleStrings({ locale }), { catalogMode: false }), "dateLocale"), String(locale)).toBe(false);
        }
    });

    it("blockStrings: a non-en-US tenant gets its normalised locale; a catalog site gets no stock text (CATALOG-MODE-1 § 3.2.6)", () => {
        const ro = blockStrings(resolveLocaleStrings({ locale: "ro_RO" }), { catalogMode: false });
        expect(ro.dateLocale).toBe("ro-RO");
        expect(ro.contactName).toBe("Nume");
        expect(ro.outOfStock).toBe("Stoc epuizat");
        expect(blockStrings(resolveLocaleStrings({ locale: "de-DE" }), { catalogMode: false }).dateLocale).toBe("de-DE");
        expect(blockStrings(resolveLocaleStrings({ locale: "en-GB" }), { catalogMode: false }).dateLocale).toBe("en-GB");
        for (const locale of ["en-US", "ro-RO"]) {
            const catalog = blockStrings(resolveLocaleStrings({ locale }), { catalogMode: true });
            expect(Object.hasOwn(catalog, "outOfStock"), locale).toBe(false);
            expect(Object.keys(catalog).slice(0, BLOCK_SITE_KEYS.length + 1)).toEqual([...BLOCK_SITE_KEYS, "showcaseEmpty"]);
        }
    });

    it("LOCALE1C-IFRAME-NAMES = A: the two iframe-name keys are pattern F — \"\" → the language default (EN and RO), \"X\" wins; every registered pack's default is non-empty", () => {
        expect(BLOCK_FALLBACK_KEYS).toEqual(["videoTitle", "videoBackgroundTitle"]);
        for (const locale of ["en-US", "ro-RO"]) {
            const defaults = resolveLocaleStrings({ locale }).defaults.site;
            const empty = blockStrings(resolveLocaleStrings({ locale, siteStrings: { videoTitle: "", videoBackgroundTitle: "", codeCopy: "" } }), { catalogMode: false });
            expect([empty.videoTitle, empty.videoBackgroundTitle], locale).toEqual([defaults.videoTitle, defaults.videoBackgroundTitle]);
            expect(empty.codeCopy, `${locale}: every other block key stays pattern D`).toBe("");
            const own = blockStrings(resolveLocaleStrings({ locale, siteStrings: { videoTitle: "Tur", videoBackgroundTitle: "Fundal" } }), { catalogMode: false });
            expect([own.videoTitle, own.videoBackgroundTitle], locale).toEqual(["Tur", "Fundal"]);
        }
        expect(blockStrings(resolveLocaleStrings({ locale: "ro-RO", siteStrings: { videoTitle: "" } }), { catalogMode: false }).videoTitle).toBe("Video încorporat");
        for (const language of Object.keys(LANGUAGE_PACKS)) {
            const d = resolveLocaleStrings({ locale: LANGUAGE_PACKS[language].defaultLocale }).defaults.site;
            for (const key of BLOCK_FALLBACK_KEYS) expect(d[key].length, `${language}.${key}`).toBeGreaterThan(0);
        }
    });

    it("blockStrings: tenant overrides as resolved — \"\" stays \"\" (pattern D, § 5.2), \"X\" wins, in both parts", () => {
        const s = blockStrings(resolveLocaleStrings({
            locale: "ro-RO",
            siteStrings: { contactName: "", codeCopy: "Copie", postsLoadFailed: "" },
            commerceStrings: { outOfStock: "", showcaseEmpty: "Gol" },
        }), { catalogMode: false });
        expect([s.contactName, s.codeCopy, s.postsLoadFailed, s.outOfStock, s.showcaseEmpty]).toEqual(["", "Copie", "", "", "Gol"]);
        expect(s.contactEmail).toBe("Email");
    });
});

describe("normalizeLocale (§ 3.3; inputs of § 12 E20)", () => {
    const cases: [unknown, string][] = [
        ["ro-RO", "ro-RO"], ["ro_RO", "ro-RO"], ["ro-ro", "ro-RO"], ["RO", "ro"], ["en-GB", "en-GB"], [" ro-RO ", "ro-RO"],
        ["", "en-US"], ["xx-YY", "en-US"], ["en_US", "en-US"], ["de-DE", "de-DE"], ["123", "en-US"],
        ["ro-RO-u-nu-arab", "ro-RO"], [undefined, "en-US"], [null, "en-US"], [42, "en-US"], [{}, "en-US"],
    ];
    for (const [raw, expected] of cases) {
        it(`${JSON.stringify(raw) ?? "undefined"} → ${expected}`, () => expect(normalizeLocale(raw)).toBe(expected));
    }

    it("is idempotent", () => {
        for (const [raw] of cases) expect(normalizeLocale(normalizeLocale(raw))).toBe(normalizeLocale(raw));
    });

    it("the normalised value never throws in a date formatter, where the raw value did", () => {
        const d = new Date("2026-10-31T12:00:00Z");
        expect(() => d.toLocaleDateString("ro_RO")).toThrow(RangeError);
        expect(d.toLocaleDateString(normalizeLocale("ro_RO"), { timeZone: "UTC" })).toBe("31.10.2026");
    });
});

// LOCALE-1E (operator decision 2 of the packet): the `<html lang>` value is the language subtag of the NORMALISED tenant
// locale — the language the page content is in —, not the resolver's `language` (the language of the selected pack).
describe("localeLanguageSubtag (locale-1e, `<html lang>`)", () => {
    const cases: [unknown, string][] = [
        ["en-US", "en"], ["en-GB", "en"], ["ro-RO", "ro"], ["de-DE", "de"],
        [undefined, "en"], ["", "en"], ["123", "en"], ["xx-YY", "en"], [null, "en"], [42, "en"], [{}, "en"],
        ["ro_RO", "ro"], [" ro-RO ", "ro"], ["ro-RO-u-nu-arab", "ro"],
    ];
    for (const [raw, expected] of cases) {
        it(`${JSON.stringify(raw) ?? "undefined"} → ${expected}`, () => expect(localeLanguageSubtag(raw)).toBe(expected));
    }

    it("follows the tenant's locale, not the selected pack: de-DE → \"de\" while the resolver's pack language is \"en\"", () => {
        expect(resolveLocaleStrings({ locale: "de-DE" }).language).toBe("en");
        expect(localeLanguageSubtag("de-DE")).toBe("de");
    });
});

describe("resolveLocaleStrings — layers, language, mismatch (§ 5.1, § 3.3)", () => {
    it("a missing locale → en-US and the English texts", () => {
        const r = resolveLocaleStrings({});
        expect(r.locale).toBe("en-US");
        expect(r.language).toBe("en");
        expect(r.strings.site.breadcrumbHome).toBe("Home");
        expect(r.strings.commerce.addToCart).toBe("Add to Cart");
        expect(r.strings).toEqual(r.defaults);
    });

    it("layer order: EN < language pack < tenant override, per key", () => {
        const r = resolveLocaleStrings({ locale: "ro-RO", siteStrings: { navContact: "Scrie-ne aici" }, commerceStrings: { addToCart: "Pune în coș" } });
        expect(r.defaults.site.breadcrumbHome).toBe("Acasă");                      // layer 2
        expect(r.strings.site.navContact).toBe("Scrie-ne aici");                     // layer 3
        expect(r.defaults.site.navContact).toBe("Contact");                           // the default stays visible
        expect(r.strings.commerce.addToCart).toBe("Pune în coș");
        expect(r.strings.commerce.shippingStreetAddress).toBe("");                    // RO lacks it → layer 1
    });

    it("a stored \"\" is an override of an ordinary key (pattern D renders it empty)", () => {
        const r = resolveLocaleStrings({ siteStrings: { paginationNext: "" } });
        expect(r.strings.site.paginationNext).toBe("");
        expect(r.defaults.site.paginationNext).toBe("Next");
    });

    it("non-string stored values, unknown keys, prototype keys and non-object attributes are ignored", () => {
        const r = resolveLocaleStrings({
            siteStrings: { navContact: 7, navViewAll: null, notAKey: "x", toString: "y" } as any,
            commerceStrings: ["Add"] as any,
            gdpr: "corrupt",
        });
        expect(r.strings.site.navContact).toBe("Contact");
        expect(r.strings.site.navViewAll).toBe("View All");
        expect(r.strings.site).not.toHaveProperty("notAKey");
        expect(r.strings.commerce.addToCart).toBe("Add to Cart");
        expect(r.strings.site.cookieHeadline).toBe("We value your privacy");
        const inherited = Object.create({ navContact: "inherited" });
        expect(resolveLocaleStrings({ siteStrings: inherited }).strings.site.navContact).toBe("Contact");
    });

    it("the nine cookie/legal keys come only from gdpr/legalLinks, non-empty wins, never from siteStrings", () => {
        const nine = Object.keys(COOKIE_AND_LEGAL_LABEL_LOCATIONS);
        expect(nine).toHaveLength(9);
        const fromSite = Object.fromEntries(nine.map((k) => [k, "FROM SITE STRINGS"]));
        const r = resolveLocaleStrings({
            locale: "ro-RO",
            siteStrings: fromSite,
            gdpr: { headline: "Cookie-uri", acceptAll: "", enabled: true },
            legalLinks: { termsLabel: "Termeni", anpcLabel: "", termsUrl: "/t" },
        });
        for (const k of nine) expect((r.strings.site as any)[k]).not.toBe("FROM SITE STRINGS");
        expect(r.strings.site.cookieHeadline).toBe("Cookie-uri");
        expect(r.strings.site.cookieAcceptAll).toBe(RO_LANGUAGE_PACK.site.cookieAcceptAll);   // "" falls through (||)
        expect(r.strings.site.cookieAcceptAll).toBe("Acceptă toate");
        expect(r.strings.site.legalTermsLabel).toBe("Termeni");
        expect(r.strings.site.legalConsumerProtectionLabel).toBe("ANPC");
        expect(r.strings.site.cookieDescription).toBe(RO_LANGUAGE_PACK.site.cookieDescription);
    });

    it("country and language are independent: countryCode RO + locale en-GB → English texts, en-GB dates", () => {
        const tenant = { countryCode: "RO", locale: "en-GB" };
        const r = resolveLocaleStrings(tenant);
        expect(r.locale).toBe("en-GB");
        expect(r.strings.site.breadcrumbHome).toBe("Home");
        expect(new Date("2026-10-31T12:00:00Z").toLocaleDateString(r.locale, { timeZone: "UTC" })).toBe("31/10/2026");
    });

    it("countryCode EN + locale ro-RO → Romanian texts, ro-RO dates", () => {
        const tenant = { countryCode: "EN", locale: "ro-RO" };
        const r = resolveLocaleStrings(tenant);
        expect(r.language).toBe("ro");
        expect(r.strings.site.breadcrumbHome).toBe("Acasă");
        expect(new Date("2026-10-31T12:00:00Z").toLocaleDateString(r.locale, { timeZone: "UTC" })).toBe("31.10.2026");
    });

    it("a language without a pack (de-DE) → German dates, English texts", () => {
        const r = resolveLocaleStrings({ locale: "de-DE" });
        expect(r.locale).toBe("de-DE");
        expect(r.language).toBe("en");
        expect(r.strings.site.paginationNext).toBe("Next");
    });

    it("a malformed locale (ro_RO, \" ro-RO \") still selects Romanian; garbage selects English; nothing throws", () => {
        expect(resolveLocaleStrings({ locale: "ro_RO" }).strings.site.breadcrumbHome).toBe("Acasă");
        expect(resolveLocaleStrings({ locale: " ro-RO " }).locale).toBe("ro-RO");
        expect(resolveLocaleStrings({ locale: "123" }).strings.site.breadcrumbHome).toBe("Home");
    });

    it("returns fresh objects: mutating a result does not change the packs", () => {
        const r = resolveLocaleStrings({ locale: "ro-RO" });
        r.strings.site.breadcrumbHome = "changed";
        r.defaults.commerce.addToCart = "changed";
        expect(RO_LANGUAGE_PACK.site.breadcrumbHome).toBe("Acasă");
        expect(resolveLocaleStrings({ locale: "ro-RO" }).strings.site.breadcrumbHome).toBe("Acasă");
        expect(resolveLocaleStrings({}).defaults.commerce.addToCart).toBe("Add to Cart");
    });
});

describe("a new language is one pack file + its registration (§ 16.2 item 3)", () => {
    it("a throwaway pack registered in this test only: its keys resolve, a missing key falls back to English", () => {
        const XX: LanguagePack = {
            language: "fr", name: "French (test only)", defaultLocale: "fr-FR",
            commerce: { addToCart: "Ajouter au panier" }, catalog: {}, site: { breadcrumbHome: "Accueil" },
        };
        expect(Object.prototype.hasOwnProperty.call(LANGUAGE_PACKS, "fr")).toBe(false);
        expect(resolveLocaleStrings({ locale: "fr-FR" }).strings.site.breadcrumbHome).toBe("Home");
        LANGUAGE_PACKS.fr = XX;                                   // the registration: one entry
        try {
            const r = resolveLocaleStrings({ locale: "fr-FR" });
            expect(r.language).toBe("fr");
            expect(r.strings.site.breadcrumbHome).toBe("Accueil");
            expect(r.strings.commerce.addToCart).toBe("Ajouter au panier");
            expect(r.strings.site.paginationNext).toBe("Next");       // the pack lacks it → English
            expect(r.strings.commerce.checkout).toBe("Checkout");
        } finally {
            delete LANGUAGE_PACKS.fr;
        }
        expect(resolveLocaleStrings({ locale: "fr-FR" }).strings.site.breadcrumbHome).toBe("Home");
    });
});

// ── LOCALE-1B: count keys and plural categories (§ 16.2 item 6; packet rule 3) ───────────────────────────────────────
const count = (value: CountText, n: number) => fillTemplate(selectPluralText(value, n), { n });

describe("count keys: one text per plural category, selected by Intl.PluralRules(<language>) (§ 16.2 item 6)", () => {
    it("English: 0 → other, 1 → one, 2 → other — exactly today's `n === 1 ? … : …s` (the EN forms reproduce today's text)", () => {
        const { strings } = resolveLocaleStrings({});
        expect([0, 1, 2].map((n) => count(strings.commerce.productCount, n))).toEqual(["0 products", "1 product", "2 products"]);
        expect([0, 1, 2].map((n) => count(strings.commerce.searchResultCount, n))).toEqual(["0 results", "1 result", "2 results"]);
        expect([0, 1, 2].map((n) => fillTemplate(selectPluralText(strings.commerce.reviewsSummary, n), { n, rating: 4.5 })))
            .toEqual(["4.5/5 (0 reviews)", "4.5/5 (1 review)", "4.5/5 (2 reviews)"]);
        expect([0, 1, 2].map((n) => count(strings.catalog.facetsCount, n))).toEqual(["0 products", "1 product", "2 products"]);
        expect([0, 1, 2].map((n) => count(strings.catalog.interestWidgetLabel, n))).toEqual(["My list: 0 products", "My list: 1 product", "My list: 2 products"]);
        // Today's English rule, for every count the pages can show (0 … 1000): the EN forms give the same text.
        for (let n = 0; n <= 1000; n++) expect(count(strings.commerce.productCount, n)).toBe(`${n} product${n !== 1 ? "s" : ""}`);
    });

    it("Romanian: 1 → one, 0 / 2 / 19 / 101 / 119 → few, 20 / 120 → other (the operator's executed table)", () => {
        const { strings } = resolveLocaleStrings({ locale: "ro-RO" });
        const ns = [0, 1, 2, 19, 20, 101, 119, 120];
        expect(ns.map((n) => new Intl.PluralRules("ro").select(n))).toEqual(["few", "one", "few", "few", "other", "few", "few", "other"]);
        expect(ns.map((n) => count(strings.catalog.facetsCount, n)))
            .toEqual(["0 produse", "1 produs", "2 produse", "19 produse", "20 de produse", "101 produse", "119 produse", "120 de produse"]);
        expect(ns.map((n) => count(strings.commerce.productCount, n)))
            .toEqual(["0 produse", "1 produs", "2 produse", "19 produse", "20 de produse", "101 produse", "119 produse", "120 de produse"]);
        expect(ns.map((n) => count(strings.commerce.searchResultCount, n)))
            .toEqual(["0 rezultate", "1 rezultat", "2 rezultate", "19 rezultate", "20 de rezultate", "101 rezultate", "119 rezultate", "120 de rezultate"]);
        expect([1, 2, 20].map((n) => fillTemplate(selectPluralText(strings.commerce.reviewsSummary, n), { n, rating: 5 })))
            .toEqual(["5/5 (1 recenzie)", "5/5 (2 recenzii)", "5/5 (20 de recenzii)"]);
        // The header widget's aria-label (L-RO-PLURAL: "Lista mea: 1 produse" before 1b).
        expect(ns.map((n) => count(strings.catalog.interestWidgetLabel, n))).toEqual([
            "Lista mea: 0 produse", "Lista mea: 1 produs", "Lista mea: 2 produse", "Lista mea: 19 produse", "Lista mea: 20 de produse",
            "Lista mea: 101 produse", "Lista mea: 119 produse", "Lista mea: 120 de produse",
        ]);
    });

    it("a tenant override replaces single categories; the others keep the language default; non-string or non-object values are ignored", () => {
        const { strings, defaults } = resolveLocaleStrings({
            locale: "ro-RO",
            catalogStrings: { facetsCount: { other: "{n} de articole", few: 7, bogus: "x" } },
            commerceStrings: { productCount: "{n} items", searchResultCount: ["x"] },
        });
        expect([1, 2, 20].map((n) => count(strings.catalog.facetsCount, n))).toEqual(["1 produs", "2 produse", "20 de articole"]);
        expect(strings.catalog.facetsCount.forms).not.toHaveProperty("bogus");
        expect(strings.commerce.productCount).toEqual(defaults.commerce.productCount);       // a string is not a count value
        expect(strings.commerce.searchResultCount).toEqual(defaults.commerce.searchResultCount);
        expect(defaults.catalog.facetsCount).toEqual({ language: "ro", forms: RO_LANGUAGE_PACK.catalog.facetsCount, english: EN_LANGUAGE_PACK.catalog.facetsCount });
    });

    it("an English tenant's override uses the English categories; a stored \"\" is an override (renders empty)", () => {
        const { strings } = resolveLocaleStrings({ catalogStrings: { facetsCount: { one: "one item", other: "" } } });
        expect([1, 2].map((n) => count(strings.catalog.facetsCount, n))).toEqual(["one item", ""]);
    });
});

describe("a new language adds its plural categories in its pack file only (packet rule 3)", () => {
    it("a throwaway Polish pack (one / few / many / other): its own categories select; a missing category falls back to its `other`, then to English by English rules; every available form is kept", () => {
        const PL: LanguagePack = {
            language: "pl", name: "Polish (test only)", defaultLocale: "pl-PL", site: {}, commerce: {
                productCount: { one: "{n} produkt", few: "{n} produkty", many: "{n} produktów", other: "{n} produktu" },
                searchResultCount: { one: "{n} wynik", few: "{n} wyniki", other: "{n} wyniku" },     // no `many`
            },
            catalog: { facetsCount: { one: "{n} sztuka", few: "{n} sztuki" } },                     // no `other`
        };
        expect(pluralCategoriesOf("pl")).toEqual(["one", "few", "many", "other"]);
        LANGUAGE_PACKS.pl = PL;
        try {
            const { strings, language } = resolveLocaleStrings({ locale: "pl-PL" });
            expect(language).toBe("pl");
            expect([1, 2, 5, 22].map((n) => count(strings.commerce.productCount, n))).toEqual(["1 produkt", "2 produkty", "5 produktów", "22 produkty"]);
            expect([1, 2, 5].map((n) => count(strings.commerce.searchResultCount, n))).toEqual(["1 wynik", "2 wyniki", "5 wyniku"]);
            // facetsCount has `one` and `few` but no `other`: those two forms are kept (review-0 R3); a `many` count (5) has
            // neither its form nor the language's `other`, so it falls back to English, selected by English rules.
            expect(strings.catalog.facetsCount.language).toBe("pl");
            expect([1, 2, 22, 5].map((n) => count(strings.catalog.facetsCount, n))).toEqual(["1 sztuka", "2 sztuki", "22 sztuki", "5 products"]);
            // No reviewsSummary in the pack: every count is English, by English rules (1 → one, 5 → other).
            expect(strings.commerce.reviewsSummary).toEqual({ language: "pl", forms: {}, english: EN_LANGUAGE_PACK.commerce.reviewsSummary });
            expect([1, 5].map((n) => fillTemplate(selectPluralText(strings.commerce.reviewsSummary, n), { n, rating: 5 }))).toEqual(["5/5 (1 review)", "5/5 (5 reviews)"]);
            // A complete tenant override is used in the tenant's language.
            const withOther = resolveLocaleStrings({ locale: "pl-PL", commerceStrings: { reviewsSummary: { one: "{n} opinia", few: "{n} opinie", other: "{n} opinii" } } });
            expect(withOther.strings.commerce.reviewsSummary.language).toBe("pl");
            expect([1, 2, 5].map((n) => count(withOther.strings.commerce.reviewsSummary, n))).toEqual(["1 opinia", "2 opinie", "5 opinii"]);
            // A partial tenant override is kept per form: `one` from the tenant, every other count from English.
            const partial = resolveLocaleStrings({ locale: "pl-PL", commerceStrings: { reviewsSummary: { one: "{n} opinia" } } });
            expect(partial.strings.commerce.reviewsSummary.forms).toEqual({ one: "{n} opinia" });
            expect([1, 2, 5].map((n) => fillTemplate(selectPluralText(partial.strings.commerce.reviewsSummary, n), { n, rating: 5 })))
                .toEqual(["1 opinia", "5/5 (2 reviews)", "5/5 (5 reviews)"]);
        } finally {
            delete LANGUAGE_PACKS.pl;
        }
    });

    it("a registered pack without count keys (French: 0 → one) gets the English texts with English rules — never \"0 product\"", () => {
        LANGUAGE_PACKS.fr = { language: "fr", name: "French (test only)", defaultLocale: "fr-FR", commerce: {}, catalog: {}, site: {} };
        try {
            expect(new Intl.PluralRules("fr").select(0)).toBe("one");
            const { strings } = resolveLocaleStrings({ locale: "fr-FR" });
            expect([0, 1, 2].map((n) => count(strings.commerce.productCount, n))).toEqual(["0 products", "1 product", "2 products"]);
        } finally {
            delete LANGUAGE_PACKS.fr;
        }
    });
});

describe("fillTemplate (§ 5.1)", () => {
    it("fills every placeholder with String(value)", () => {
        expect(fillTemplate("Page {page} of {total}", { page: 2, total: 5 })).toBe("Page 2 of 5");
        expect(fillTemplate("© {year} {name}. All rights reserved.", { year: 2026, name: "Acme" })).toBe("© 2026 Acme. All rights reserved.");
        expect(fillTemplate("{a}{a}", { a: "x" })).toBe("xx");
    });
    it("leaves an unknown placeholder as written; text without placeholders is unchanged", () => {
        expect(fillTemplate("Add {amount} more", {})).toBe("Add {amount} more");
        expect(fillTemplate("No placeholders here.", { x: 1 })).toBe("No placeholders here.");
        expect(fillTemplate("{toString}", {})).toBe("{toString}");
    });
});
