import { describe, it, expect, vi, beforeEach } from "vitest";
import { BOOKING_TEXT_KEYS, EN_LANGUAGE_PACK, RO_LANGUAGE_PACK } from "@amodx/shared";

/**
 * SCHED-LABELS-1 — the renderer half of the booking-text overrides (`renderer/src/lib/booking-text.ts`): the texts of a
 * booking page are the standard English text ← the pack of the page language ← the tenant's `bookingStrings`, and the
 * tenant's texts apply ONLY on a page in the tenant's own language (the language of its page without `?lang=`). Also
 * `mapTenant` (through the real `getTenantConfig`; only the DynamoDB document client is replaced): the attribute is
 * copied when present, and a tenant without it maps exactly as before. That an override with HTML is shown as text on
 * the page is the serving row `schedlabels1-override` (the page's own rendering escapes it).
 */

const store = vi.hoisted(() => ({ item: null as null | Record<string, unknown> }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    return {
        ...real,
        DynamoDBDocumentClient: {
            from: () => ({
                send: async (c: any) => (c.constructor.name === "QueryCommand" ? { Items: [] } : { Item: store.item ?? undefined }),
            }),
        },
    };
});

import { bookingLanguage, bookingTexts } from "@/lib/booking-text";
import { getTenantConfig } from "@/lib/dynamo";

beforeEach(() => { process.env.TABLE_NAME = "sched-labels-1-unit"; });

const RO_STANDARD = { ...EN_LANGUAGE_PACK.booking, ...RO_LANGUAGE_PACK.booking };
const RO_TENANT = { locale: "ro-RO", bookingStrings: { bookTitle: "Programează-te", seatsLeft: "Mai sunt {n} locuri" } };

describe("SCHED-LABELS-1 bookingTexts — the tenant's texts on its own-language page only", () => {
    it("shown on the page in the tenant's language (no ?lang=, and ?lang= naming that language)", () => {
        for (const lang of [undefined, "ro", "ro-MD"]) {
            const texts = bookingTexts(bookingLanguage(lang, RO_TENANT.locale).language, RO_TENANT);
            expect(texts.bookTitle, String(lang)).toBe("Programează-te");
            expect(texts.seatsLeft, String(lang)).toBe("Mai sunt {n} locuri");
            expect(texts.back, String(lang)).toBe(RO_STANDARD.back);          // a key without an override: the pack text
        }
    });

    it("NOT shown under ?lang= of another language: the standard texts of that language", () => {
        expect(bookingTexts(bookingLanguage("en", RO_TENANT.locale).language, RO_TENANT)).toEqual(EN_LANGUAGE_PACK.booking);
        const enTenant = { locale: "en-US", bookingStrings: { bookTitle: "Schedule a visit" } };
        expect(bookingTexts(bookingLanguage(undefined, enTenant.locale).language, enTenant).bookTitle).toBe("Schedule a visit");
        expect(bookingTexts(bookingLanguage("ro", enTenant.locale).language, enTenant)).toEqual(RO_STANDARD);
    });

    it("a tenant locale without a pack: its own language is English (the language of its page and of its Labels placeholders)", () => {
        const deTenant = { locale: "de-DE", bookingStrings: { bookTitle: "Termin buchen" } };
        expect(bookingLanguage(undefined, deTenant.locale).language).toBe("en");
        expect(bookingTexts("en", deTenant).bookTitle).toBe("Termin buchen");
        expect(bookingTexts(bookingLanguage("ro", deTenant.locale).language, deTenant)).toEqual(RO_STANDARD);
    });

    it("every booking key: a tenant text replaces the standard text of that key, and only that key", () => {
        for (const key of BOOKING_TEXT_KEYS) {
            const texts = bookingTexts("ro", { locale: "ro-RO", bookingStrings: { [key]: `site text of ${key}` } });
            expect(texts[key], key).toBe(`site text of ${key}`);
            expect({ ...texts, [key]: RO_STANDARD[key] }, key).toEqual(RO_STANDARD);
        }
    });

    it("absent / empty / malformed stored values give the standard texts", () => {
        const cases: [string, unknown][] = [
            ["no attribute", undefined], ["null", null], ["a string", "Programează-te"], ["an array", ["Programează-te"]],
            ["a number", 7], ["empty object", {}],
            ["\"\" (no override)", { bookTitle: "" }],
            ["non-text values", { bookTitle: 3, back: { other: "x" }, loading: null }],
            ["unknown key only", { futureKey: "kept, never shown" }],
        ];
        for (const [what, stored] of cases) {
            expect(bookingTexts("ro", { locale: "ro-RO", bookingStrings: stored }), what).toEqual(RO_STANDARD);
        }
        expect(bookingTexts("ro", { bookingStrings: { bookTitle: "x" } }), "no locale → own language en").toEqual(RO_STANDARD);
        expect(bookingTexts("ro")).toEqual(RO_STANDARD);
        // an inherited (prototype) property is not an own text
        expect(bookingTexts("ro", { locale: "ro-RO", bookingStrings: Object.create({ bookTitle: "inherited" }) })).toEqual(RO_STANDARD);
    });

    it("an override with HTML is returned as the same characters (no markup is interpreted or removed here)", () => {
        const html = "<b>Programează-te</b> <script>alert(1)</script>";
        expect(bookingTexts("ro", { locale: "ro-RO", bookingStrings: { bookTitle: html } }).bookTitle).toBe(html);
    });

    it("the result is a fresh object: the standard texts are never changed by an override", () => {
        bookingTexts("en", { locale: "en-US", bookingStrings: { bookTitle: "Changed" } });
        expect(bookingTexts("en").bookTitle).toBe("Book");
        expect(EN_LANGUAGE_PACK.booking.bookTitle).toBe("Book");
    });
});

describe("SCHED-LABELS-1 mapTenant — bookingStrings", () => {
    it("copied as stored when present; absent stays absent (no key: the mapped record is unchanged)", async () => {
        const stored = { bookTitle: "Programează-te", futureKey: "kept" };
        store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "T", locale: "ro-RO", bookingStrings: stored };
        expect(((await getTenantConfig("t1")) as any).bookingStrings).toEqual(stored);
        store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "T", locale: "ro-RO" };
        expect(Object.hasOwn((await getTenantConfig("t1")) as object, "bookingStrings")).toBe(false);
    });
});
