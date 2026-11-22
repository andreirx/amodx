/**
 * SCHED-1G2 — the page language and the visitor texts of the hosted booking pages (docs/slices/sched-1.md § 10.1):
 * `?lang=` selects a language pack when one exists, else the tenant locale's language, else English; the texts are
 * the pack's `booking` part over the English one. SERVER ONLY (the two pages): it imports `@amodx/shared`, which the
 * browser code of the booking tree must not import (see `booking-ui.ts`). The resolved texts reach the browser as a
 * plain prop.
 *
 * Abstraction line: users — the book page and the manage page (and their `generateMetadata`); axis: none; rejected:
 * the selection written in both pages.
 */
import { EN_LANGUAGE_PACK, LANGUAGE_PACKS, localeLanguageSubtag, normalizeLocale } from "@amodx/shared";
import type { BookingTextKey, BookingTexts } from "@/lib/booking-ui";

/**
 * The page language: the primary subtag of `?lang=` when a language pack exists for it, else the tenant locale's
 * language, else English. Returns the pack key and the locale used to format dates (`?lang=` → the tenant locale
 * when it has the same language, else the pack's default locale).
 */
export function bookingLanguage(langParam: string | undefined, tenantLocale: string | undefined): { language: string; locale: string } {
    const tenant = normalizeLocale(tenantLocale);
    const tenantLanguage = localeLanguageSubtag(tenant);
    const asked = typeof langParam === "string" && /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{1,8})*$/.test(langParam)
        ? langParam.split(/[-_]/)[0].toLowerCase()
        : undefined;
    const language = asked !== undefined && LANGUAGE_PACKS[asked] !== undefined ? asked
        : LANGUAGE_PACKS[tenantLanguage] !== undefined ? tenantLanguage : "en";
    const locale = language === tenantLanguage ? tenant : (LANGUAGE_PACKS[language]?.defaultLocale ?? "en-US");
    return { language, locale };
}

/** The booking texts of `language`: the English text of every key, replaced by the pack's non-empty text. */
export function bookingTexts(language: string): BookingTexts {
    const own = LANGUAGE_PACKS[language]?.booking ?? {};
    const out = { ...EN_LANGUAGE_PACK.booking };
    for (const key of Object.keys(out) as BookingTextKey[]) {
        const value = own[key];
        if (typeof value === "string" && value !== "") out[key] = value;
    }
    return out;
}
