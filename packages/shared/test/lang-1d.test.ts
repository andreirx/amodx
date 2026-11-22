import { describe, it, expect } from "vitest";
import {
    EN_LANGUAGE_PACK, LANGUAGE_PACKS, bookingStandardTexts, pluralCategoriesOf, resolveLocaleStrings, selectPluralText,
    templatePlaceholders, type CountText, type PluralTexts,
} from "../src/index.js";

/**
 * LANG-1D (docs/slices/lang-1.md § 12 `lang-1d`; ruling LANG1-PACK-NOOP = B) — the German and French packs.
 * The compiler proves that no key is missing (`CompleteLanguagePack`); these tests prove what the type does not:
 * the key set of each part equals the English pack's (compared with the English pack, never with a number), each text
 * is non-empty where the English text is, each text keeps the English text's `{placeholders}` (and the quote message
 * its `[…{variant}…]` segment), each count key holds exactly the plural categories of its language
 * (locale-1.md § 16.2 item 6), the unchanged resolver selects the pack, the register is formal (Sie, vous), and the
 * French spacing rule of the pack header holds. Pure: no clock, no I/O.
 */
const PARTS = ["site", "commerce", "catalog", "booking"] as const;
const keys = (o: object) => Object.keys(o).sort();
const holes = (t: string) => templatePlaceholders(t).sort();
const segments = (t: string) => t.match(/\[[^[\]]*\]/g) ?? [];
type Part = Record<string, string | PluralTexts>;
const english = (part: (typeof PARTS)[number]) => EN_LANGUAGE_PACK[part] as unknown as Part;

/** Every text of a pack: `[part.key(.category), text]`. */
function textsOf(language: string): [string, string][] {
    const out: [string, string][] = [];
    for (const part of PARTS) {
        for (const [key, value] of Object.entries(LANGUAGE_PACKS[language][part] as Part)) {
            if (typeof value === "string") out.push([`${part}.${key}`, value]);
            else for (const [category, text] of Object.entries(value)) out.push([`${part}.${key}.${category}`, text as string]);
        }
    }
    return out;
}

for (const [language, informal] of [
    ["de", /(?<!\p{L})(du|dich|dir|dein|deine|deinen|deinem|deiner|deines)(?!\p{L})/iu],
    ["fr", /(?<!\p{L})(tu|toi|ton|ta|tes)(?!\p{L})/iu],
] as const) {
    describe(`LANG-1D — the ${language} pack`, () => {
        const pack = LANGUAGE_PACKS[language];

        it(`is registered under "${language}"; every part has exactly the keys of the English pack`, () => {
            expect(pack.language).toBe(language);
            for (const part of PARTS) expect(keys(pack[part] as Part), part).toEqual(keys(english(part)));
        });

        it("a text key: a non-empty text where the English text is non-empty; \"\" where it is \"\" (the street-address fallbacks and the four placeholders)", () => {
            const emptyInEnglish: string[] = [];
            for (const part of PARTS) {
                for (const [key, en] of Object.entries(english(part))) {
                    if (typeof en !== "string") continue;
                    const own = (pack[part] as Part)[key];
                    expect(typeof own, `${part}.${key}`).toBe("string");
                    expect((own as string).length > 0, `${part}.${key}`).toBe(en.length > 0);
                    if (en === "") emptyInEnglish.push(`${part}.${key}`);
                }
            }
            expect(emptyInEnglish.sort()).toEqual([
                "commerce.billingStreetAddress", "commerce.phonePlaceholder", "commerce.registrationNumberPlaceholder",
                "commerce.shippingStreetAddress", "commerce.taxIdPlaceholder", "commerce.vatNumberPlaceholder",
            ]);
        });

        it("each text keeps exactly the {placeholders} of the English text of its key; the quote message keeps its one […{variant}…] segment", () => {
            for (const part of PARTS) {
                for (const [key, en] of Object.entries(english(part))) {
                    const own = (pack[part] as Part)[key];
                    if (typeof en === "string") {
                        expect(holes(own as string), `${part}.${key}`).toEqual(holes(en));
                        expect(segments(own as string).length, `${part}.${key}: […] segments`).toBe(segments(en).length);
                    } else {
                        for (const [category, text] of Object.entries(own as PluralTexts)) {
                            expect(holes(text as string), `${part}.${key}.${category}`).toEqual(holes(en.other));
                        }
                    }
                }
            }
            const quote = pack.catalog.quoteMessage as string;
            expect(segments(quote)).toHaveLength(1);
            expect(segments(quote)[0]).toContain("{variant}");
        });

        it(`each count key holds exactly the plural categories of "${language}", each a non-empty text`, () => {
            let countKeys = 0;
            for (const part of PARTS) {
                for (const [key, en] of Object.entries(english(part))) {
                    if (typeof en === "string") continue;
                    countKeys += 1;
                    const own = (pack[part] as Part)[key] as PluralTexts;
                    expect(keys(own), `${part}.${key}`).toEqual([...pluralCategoriesOf(language)].sort());
                    for (const text of Object.values(own)) expect((text as string).length, `${part}.${key}`).toBeGreaterThan(0);
                }
            }
            expect(countKeys).toBeGreaterThan(0);
        });

        it(`the unchanged resolver selects the pack for ${pack.defaultLocale}: every text of the three table parts, and the booking texts`, () => {
            const r = resolveLocaleStrings({ locale: pack.defaultLocale });
            expect(r.locale).toBe(pack.defaultLocale);
            expect(r.language).toBe(language);
            for (const part of ["site", "commerce", "catalog"] as const) {
                for (const [key, own] of Object.entries(pack[part] as Part)) {
                    const resolved = (r.strings[part] as Record<string, string | CountText>)[key];
                    if (typeof own === "string") {
                        // A "" pack text is not a text of its own: the resolver keeps it (pattern D); the readers fall back.
                        expect(resolved, `${part}.${key}`).toBe(own);
                    } else {
                        expect((resolved as CountText).forms, `${part}.${key}`).toEqual(own);
                        expect((resolved as CountText).language, `${part}.${key}`).toBe(language);
                    }
                }
            }
            expect(bookingStandardTexts(language)).toEqual(pack.booking);
        });

        it(`the register is formal (${language === "de" ? "Sie" : "vous"}): no informal pronoun in any text`, () => {
            for (const [where, text] of textsOf(language)) expect(informal.test(text), `${where}: ${text}`).toBe(false);
        });
    });
}

/**
 * The count texts as the readers select them (`selectPluralText` on the resolved table): each count `n` gets the pack's
 * form of the category `Intl.PluralRules(language)` names. Cited by the locale-1 coverage rule for every
 * `<part>.<key>@de|fr.<category>` entry (renderer/test/serving-contract/locale-1/1b/coverage.json).
 */
describe("LANG-1D — count texts select by the language's own plural rules (locale-1.md § 16.2 item 6)", () => {
    const COUNT_KEYS = (["site", "commerce", "catalog"] as const).flatMap((part) =>
        Object.entries(english(part)).filter(([, v]) => typeof v !== "string").map(([key]) => [part, key] as const));
    for (const [title, language, cases] of [
        ["German: 0 → other, 1 → one, 2 → other (every count key)", "de", [[0, "other"], [1, "one"], [2, "other"]]],
        ["French: 0 / 1 → one, 1000000 → many, 2 → other (every count key)", "fr", [[0, "one"], [1, "one"], [1000000, "many"], [2, "other"]]],
    ] as const) {
        it(title, () => {
            expect(COUNT_KEYS.length).toBeGreaterThan(0);
            const { strings } = resolveLocaleStrings({ locale: LANGUAGE_PACKS[language].defaultLocale });
            for (const [n, category] of cases) {
                expect(new Intl.PluralRules(language).select(n), `${language} ${n}`).toBe(category);
                for (const [part, key] of COUNT_KEYS) {
                    const resolved = (strings[part] as Record<string, CountText>)[key];
                    const own = (LANGUAGE_PACKS[language][part] as Part)[key] as PluralTexts;
                    expect(selectPluralText(resolved, n), `${part}.${key} ${n}`).toBe(own[category]);
                }
            }
        });
    }
});

describe("LANG-1D — French spacing (the fr pack header)", () => {
    it("a no-break space (U+00A0) before every : ; ! ? and inside « »; no ASCII apostrophe", () => {
        for (const [where, text] of textsOf("fr")) {
            for (const m of text.matchAll(/[:;!?]/g)) {
                expect(text[m.index! - 1], `${where}: before "${m[0]}" in ${JSON.stringify(text)}`).toBe(" ");
            }
            for (const m of text.matchAll(/«/g)) expect(text[m.index! + 1], `${where}: after «`).toBe(" ");
            for (const m of text.matchAll(/»/g)) expect(text[m.index! - 1], `${where}: before »`).toBe(" ");
            expect(text.includes("'"), `${where}: ASCII apostrophe`).toBe(false);
        }
    });
});
