import { describe, it, expect } from "vitest";
import {
    BOOKING_TEXT_KEYS, BookingStringsSchema, TenantConfigSchema, EN_LANGUAGE_PACK, RO_LANGUAGE_PACK, LANGUAGE_PACKS,
    bookingStandardTexts, templatePlaceholders, fillTemplate,
} from "../src/index.js";

/**
 * SCHED-LABELS-1 — the shared half of the booking-text overrides: the key list derived from the English pack, the
 * `bookingStrings` schema of the tenant record, the standard texts of a language (layers 1 + 2), and the placeholder
 * reader that the PUT /settings check and the admin Labels page share with `fillTemplate`.
 */

describe("SCHED-LABELS-1 — the booking key list and the bookingStrings schema", () => {
    it("the key list is the English pack's keys (98), and the schema has exactly these keys", () => {
        expect(BOOKING_TEXT_KEYS).toEqual(Object.keys(EN_LANGUAGE_PACK.booking));
        expect(BOOKING_TEXT_KEYS).toHaveLength(98);
        expect(Object.keys(BookingStringsSchema.shape)).toEqual(BOOKING_TEXT_KEYS);
    });

    it("every key is an optional text: absent, a text and \"\" parse; a non-text is refused", () => {
        expect(BookingStringsSchema.parse({})).toEqual({});
        expect(BookingStringsSchema.parse({ bookTitle: "Programează-te", back: "" })).toEqual({ bookTitle: "Programează-te", back: "" });
        expect(BookingStringsSchema.safeParse({ bookTitle: 3 }).success).toBe(false);
    });

    it("a tenant without the attribute parses exactly as before (no bookingStrings key); with it, the attribute is kept", () => {
        const base = { id: "t1", name: "T", domain: "t.test", plan: "Free", createdAt: "2026-01-01T00:00:00.000Z" };
        const without = TenantConfigSchema.parse(base);
        expect(Object.hasOwn(without, "bookingStrings")).toBe(false);
        expect(TenantConfigSchema.parse({ ...base, bookingStrings: { bookTitle: "Rezervă" } }).bookingStrings).toEqual({ bookTitle: "Rezervă" });
    });
});

describe("SCHED-LABELS-1 — bookingStandardTexts (English ← the pack of the language)", () => {
    it("English, Romanian, and a language without a pack (English)", () => {
        expect(bookingStandardTexts("en")).toEqual(EN_LANGUAGE_PACK.booking);
        expect(bookingStandardTexts("ro")).toEqual({ ...EN_LANGUAGE_PACK.booking, ...RO_LANGUAGE_PACK.booking });
        expect(bookingStandardTexts("ro").bookTitle).toBe("Programare");
        expect(bookingStandardTexts("de")).toEqual(EN_LANGUAGE_PACK.booking);
        expect(bookingStandardTexts("constructor")).toEqual(EN_LANGUAGE_PACK.booking);
    });

    it("a pack text that is \"\" or absent gives the English text (never an empty standard text)", () => {
        const saved = LANGUAGE_PACKS.xx;
        LANGUAGE_PACKS.xx = { language: "xx", name: "Test", defaultLocale: "xx", commerce: {}, catalog: {}, site: {}, booking: { bookTitle: "", back: "Retour" } };
        try {
            const texts = bookingStandardTexts("xx");
            expect(texts.bookTitle).toBe(EN_LANGUAGE_PACK.booking.bookTitle);
            expect(texts.back).toBe("Retour");
            expect(texts.loading).toBe(EN_LANGUAGE_PACK.booking.loading);
        } finally {
            if (saved === undefined) delete LANGUAGE_PACKS.xx; else LANGUAGE_PACKS.xx = saved;
        }
    });
});

describe("SCHED-LABELS-1 — templatePlaceholders reads what fillTemplate fills", () => {
    it("each name once, in order of first appearance; text without placeholders → none", () => {
        expect(templatePlaceholders("Booking {ref} at {time}; {ref} again")).toEqual(["ref", "time"]);
        expect(templatePlaceholders("Book")).toEqual([]);
        expect(templatePlaceholders("{ not one } {a-b} {}")).toEqual([]);
    });

    it("every placeholder it reads is replaced by fillTemplate, and nothing else is (same form)", () => {
        for (const text of Object.values(EN_LANGUAGE_PACK.booking)) {
            const names = templatePlaceholders(text);
            const filled = fillTemplate(text, Object.fromEntries(names.map((n) => [n, "§"])));
            expect(templatePlaceholders(filled), text).toEqual([]);
            expect(filled.split("§").length - 1, text).toBe(text.split(/\{[A-Za-z0-9_]+\}/).length - 1);
        }
    });

    it("EN and RO standard texts keep the same placeholders per key (the check of PUT /settings compares with English)", () => {
        const ro = bookingStandardTexts("ro");
        for (const key of BOOKING_TEXT_KEYS) {
            expect([...templatePlaceholders(ro[key])].sort(), key).toEqual([...templatePlaceholders(EN_LANGUAGE_PACK.booking[key])].sort());
        }
    });
});
