import { describe, it, expect } from "vitest";
import { EN_LANGUAGE_PACK, LANGUAGE_PACKS, fillTemplate, galleryTexts, resolveLocaleStrings, templatePlaceholders } from "../src/index.js";

/**
 * GALLERY-1 (docs/slices/gallery-1.md, ruling 2) — the photo viewer's texts from the tenant's locale table
 * (`galleryTexts`): the language of the tenant's locale, the tenant's own texts over the pack's, a blank override gives the
 * language default (each text is an accessible name or the position announcement), and the two templates keep their
 * placeholders in every pack. Pure: no I/O.
 */
const KEYS = { viewer: "galleryViewer", close: "galleryClose", previous: "galleryPrevious", next: "galleryNext", counter: "galleryCounter", photo: "galleryPhoto" } as const;

describe("galleryTexts", () => {
    for (const [language, pack] of Object.entries(LANGUAGE_PACKS)) {
        it(`${language}: the six texts of the ${language} pack, for its default locale`, () => {
            const texts = galleryTexts(resolveLocaleStrings({ locale: pack.defaultLocale }));
            for (const [field, key] of Object.entries(KEYS)) expect(texts[field as keyof typeof KEYS], key).toBe(pack.site[key]);
        });
    }

    it("the English texts; the counter and the tile name are templates that fillTemplate fills", () => {
        const en = galleryTexts(resolveLocaleStrings({}));
        expect(en).toEqual({ viewer: "Photo viewer", close: "Close", previous: "Previous photo", next: "Next photo", counter: "{n} of {total}", photo: "Photo {n}" });
        expect(fillTemplate(en.counter, { n: 3, total: 30 })).toBe("3 of 30");
        expect(fillTemplate(galleryTexts(resolveLocaleStrings({ locale: "ro-RO" })).counter, { n: 3, total: 30 })).toBe("3 din 30");
        expect(fillTemplate(galleryTexts(resolveLocaleStrings({ locale: "de-DE" })).photo, { n: 7 })).toBe("Foto 7");
    });

    it("the tenant's own text wins; a stored \"\" or blank override gives the language default (never an empty name)", () => {
        const own = galleryTexts(resolveLocaleStrings({ locale: "ro-RO", siteStrings: { galleryClose: "Gata", galleryCounter: "Poza {n}/{total}", galleryNext: "", galleryPhoto: "   " } }));
        expect(own.close).toBe("Gata");
        expect(own.counter).toBe("Poza {n}/{total}");
        expect(own.next).toBe(LANGUAGE_PACKS.ro.site.galleryNext);
        expect(own.photo).toBe(LANGUAGE_PACKS.ro.site.galleryPhoto);
    });

    it("every pack keeps the placeholders of the English templates: counter {n} {total}, photo {n}", () => {
        expect(templatePlaceholders(EN_LANGUAGE_PACK.site.galleryCounter)).toEqual(["n", "total"]);
        expect(templatePlaceholders(EN_LANGUAGE_PACK.site.galleryPhoto)).toEqual(["n"]);
        for (const pack of Object.values(LANGUAGE_PACKS)) {
            expect(templatePlaceholders(pack.site.galleryCounter!).sort(), pack.language).toEqual(["n", "total"]);
            expect(templatePlaceholders(pack.site.galleryPhoto!), pack.language).toEqual(["n"]);
        }
    });
});
