import { describe, it, expect } from "vitest";
import {
    CatalogStringsSchema, EN_LANGUAGE_PACK, RO_LANGUAGE_PACK, ImportLabelsSchema, IMPORT_LABELS_WITHOUT_MARKER, ProductSchema,
    LANGUAGE_PACKS, catalogServerTexts, resolveLocaleStrings,
} from "../src/index.js";

/**
 * CDL-1 (docs/slices/catalog-data-labels-1.md § 3, § 4.6; slice record docs/slices/cdl-1.md) — the shared part:
 * the nine catalog keys and their pack values, `catalogServerTexts` (the non-empty rule of § 3.3) and the product
 * member `importLabels`. Pure: no clock, no I/O.
 */

const CDL_KEYS = [
    "importCollectionAttribute", "importUnitAttribute", "importPackagingAttribute", "importMinimumOrderAttribute", "importVariantName",
    "interestMailSubject", "interestMailIntro", "interestMailProducts", "interestMailSentAt",
];

/** The literals the importer and the interest mail wrote before cdl-1 (map.ts, profile.ts, interest/public.ts at 5d4f764). */
const TODAY_RO = {
    importCollectionAttribute: "colecție", importUnitAttribute: "unitate", importPackagingAttribute: "împachetare",
    importMinimumOrderAttribute: "comandă minimă", importVariantName: "Variantă",
    interestMailSubject: "Listă de interes — {name}", interestMailIntro: "Listă de interes nouă de la {name}",
    interestMailProducts: "Produse ({n}):", interestMailSentAt: "Trimisă: {date}",
};
/** The English words of ruling § 9 item 6 and the English mail texts of § 3.1. */
const RULED_EN = {
    importCollectionAttribute: "Collection", importUnitAttribute: "Unit", importPackagingAttribute: "Packaging",
    importMinimumOrderAttribute: "Minimum order", importVariantName: "Option",
    interestMailSubject: "Interest list — {name}", interestMailIntro: "New interest list from {name}",
    interestMailProducts: "Products ({n}):", interestMailSentAt: "Sent: {date}",
};

describe("CDL-1 catalog keys (§ 3.1)", () => {
    it("the nine keys follow the quote keys in the catalog part", () => {
        expect(Object.keys(CatalogStringsSchema.shape).slice(46)).toEqual(CDL_KEYS);
    });
    it("RO values equal today's literals, code point for code point (ț = U+021B)", () => {
        for (const [k, v] of Object.entries(TODAY_RO)) expect((RO_LANGUAGE_PACK.catalog as Record<string, unknown>)[k], k).toBe(v);
        expect(RO_LANGUAGE_PACK.catalog.importCollectionAttribute).toBe("colec\u021Bie");
        expect(IMPORT_LABELS_WITHOUT_MARKER.collection).toBe("colec\u021Bie");
    });
    it("EN values are the ruled English words", () => {
        for (const [k, v] of Object.entries(RULED_EN)) expect((EN_LANGUAGE_PACK.catalog as Record<string, unknown>)[k], k).toBe(v);
    });
    it("the product-without-marker labels are today's four Romanian words (fixed history, equal to the RO pack today)", () => {
        expect(IMPORT_LABELS_WITHOUT_MARKER).toEqual({ collection: "colecție", unit: "unitate", packaging: "împachetare", minimumOrder: "comandă minimă" });
        expect(IMPORT_LABELS_WITHOUT_MARKER.collection).toBe(RO_LANGUAGE_PACK.catalog.importCollectionAttribute);
    });
});

describe("CDL-1 catalogServerTexts (§ 3.3, § 3.5)", () => {
    it("absent locale → English pack values; es-ES (no pack) → English", () => {
        expect(Object.prototype.hasOwnProperty.call(LANGUAGE_PACKS, "es")).toBe(false);   // precondition: es has no pack
        for (const locale of [undefined, "es-ES"]) {
            const t = catalogServerTexts(resolveLocaleStrings({ locale }));
            expect(t.siteLabels).toEqual({ collection: "Collection", unit: "Unit", packaging: "Packaging", minimumOrder: "Minimum order" });
            expect(t.variantName).toBe("Option");
            expect(t.interestMail).toEqual({
                subject: "Interest list — {name}", intro: "New interest list from {name}", products: "Products ({n}):", sentAt: "Sent: {date}",
                name: "Name", email: "E-mail", phone: "Phone", message: "Message",
            });
        }
    });
    it("de-DE and fr-FR without overrides (lang-1d packs) → the words of their pack", () => {
        for (const [locale, language] of [["de-DE", "de"], ["fr-FR", "fr"]] as const) {
            const c = LANGUAGE_PACKS[language].catalog;
            const t = catalogServerTexts(resolveLocaleStrings({ locale }));
            expect(t.siteLabels, locale).toEqual({
                collection: c.importCollectionAttribute, unit: c.importUnitAttribute, packaging: c.importPackagingAttribute,
                minimumOrder: c.importMinimumOrderAttribute,
            });
            expect(t.variantName, locale).toBe(c.importVariantName);
            expect(t.interestMail, locale).toEqual({
                subject: c.interestMailSubject, intro: c.interestMailIntro, products: c.interestMailProducts, sentAt: c.interestMailSentAt,
                name: c.interestName, email: c.interestEmail, phone: c.interestPhone, message: c.interestMessage,
            });
            expect(t.interestMail.subject, locale).not.toBe(EN_LANGUAGE_PACK.catalog.interestMailSubject);
        }
    });
    it("ro-RO without overrides → today's Romanian words", () => {
        const t = catalogServerTexts(resolveLocaleStrings({ locale: "ro-RO" }));
        expect(t.siteLabels).toEqual(IMPORT_LABELS_WITHOUT_MARKER);
        expect(t.variantName).toBe("Variantă");
        expect(t.interestMail).toEqual({
            subject: "Listă de interes — {name}", intro: "Listă de interes nouă de la {name}", products: "Produse ({n}):", sentAt: "Trimisă: {date}",
            name: "Nume", email: "E-mail", phone: "Telefon", message: "Mesaj",
        });
    });
    it("a non-empty override is used (trimmed); \"\" or whitespace gives the pack value — never an empty text", () => {
        const t = catalogServerTexts(resolveLocaleStrings({
            locale: "ro-RO",
            catalogStrings: { importUnitAttribute: "  Unitate de măsură ", importPackagingAttribute: "", importMinimumOrderAttribute: "   ", importVariantName: "Culoare", interestName: "\t", interestMailSubject: "Listă — {name}" },
        }));
        expect(t.siteLabels).toEqual({ collection: "colecție", unit: "Unitate de măsură", packaging: "împachetare", minimumOrder: "comandă minimă" });
        expect(t.variantName).toBe("Culoare");
        expect(t.interestMail.name).toBe("Nume");
        expect(t.interestMail.subject).toBe("Listă — {name}");
        const en = catalogServerTexts(resolveLocaleStrings({ locale: "en-US", catalogStrings: { importCollectionAttribute: "" } }));
        expect(en.siteLabels.collection).toBe("Collection");
    });
    it("a non-string stored value is ignored (the resolver's rule)", () => {
        const t = catalogServerTexts(resolveLocaleStrings({ locale: "en-US", catalogStrings: { importVariantName: 7 } }));
        expect(t.variantName).toBe("Option");
    });
});

describe("CDL-1 importLabels (§ 4.6)", () => {
    const base = { id: "p", tenantId: "t", title: "T", description: "", createdAt: "x", updatedAt: "x" };
    it("the product schema accepts four non-empty strings and an absent member", () => {
        expect(ProductSchema.safeParse(base).success).toBe(true);
        expect(ProductSchema.parse({ ...base, importLabels: { collection: "C", unit: "U", packaging: "P", minimumOrder: "M" } }).importLabels)
            .toEqual({ collection: "C", unit: "U", packaging: "P", minimumOrder: "M" });
    });
    it.each([
        ["not an object", "colecție"],
        ["a member missing", { collection: "C", unit: "U", packaging: "P" }],
        ["an empty member", { collection: "", unit: "U", packaging: "P", minimumOrder: "M" }],
        ["a member not a string", { collection: 1, unit: "U", packaging: "P", minimumOrder: "M" }],
        ["an extra member (strict)", { collection: "C", unit: "U", packaging: "P", minimumOrder: "M", extra: "x" }],
    ])("malformed: %s → refused by the schema (readers then read the product as without marker)", (_n, value) => {
        expect(ImportLabelsSchema.safeParse(value).success).toBe(false);
        expect(ProductSchema.safeParse({ ...base, importLabels: value }).success).toBe(false);
    });
});
