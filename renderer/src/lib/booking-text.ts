/**
 * SCHED-1G2 — the page language and the visitor texts of the hosted booking pages (docs/slices/sched-1.md § 10.1):
 * `?lang=` selects a language pack when one exists, else the tenant locale's language, else English. SERVER ONLY (the
 * two pages): it imports `@amodx/shared`, which the browser code of the booking tree must not import (see
 * `booking-ui.ts`). The resolved texts reach the browser as a plain prop.
 *
 * SCHED-LABELS-1 — the texts, per key, lowest layer first: the standard English text ← the text of the page language's
 * pack (`bookingStandardTexts`) ← the tenant's own text (`bookingStrings`, edited on the admin Labels page, "Booking").
 * RULE: the tenant's texts apply ONLY when the page language is the tenant's own language — the language of its booking
 * page without `?lang=` (the pack language of the tenant locale; English when that language has no pack, the language
 * the Labels page shows as the standard texts). A site's own wording is written in its default language (ruling
 * LANG1-OVERRIDES = A, docs/slices/lang-1.md), so a Romanian site's wording never appears on its `?lang=en` page. A
 * tenant text applies when it is a non-empty string own property of a plain-object `bookingStrings`, for a booking key;
 * `""`, a non-text, an unknown key and a malformed attribute are ignored. Texts are shown as text: React escapes them
 * (an override with HTML shows its tags as characters; serving row `schedlabels1-override`).
 *
 * Abstraction line: users — the book page and the manage page (and their `generateMetadata`); axis: none; rejected:
 * the selection written in both pages.
 */
import { BOOKING_TEXT_KEYS, LANGUAGE_PACKS, bookingStandardTexts, localeLanguageSubtag, normalizeLocale } from "@amodx/shared";
import type { BookingTexts } from "@/lib/booking-ui";

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

/** The stored tenant fields the texts read, as `mapTenant` gives them (anything may be malformed). */
export type BookingTextsTenant = { locale?: unknown; bookingStrings?: unknown };

/**
 * The booking texts of a page in `language`: the standard texts of that language, then — only when `language` is the
 * tenant's own language (module header) — the tenant's non-empty texts. Without `tenant`, the standard texts.
 */
export function bookingTexts(language: string, tenant?: BookingTextsTenant): BookingTexts {
    const out = bookingStandardTexts(language);
    if (tenant === undefined) return out;
    const own = tenant.bookingStrings;
    if (own === null || typeof own !== "object" || Array.isArray(own)) return out;
    if (language !== bookingLanguage(undefined, typeof tenant.locale === "string" ? tenant.locale : undefined).language) return out;
    for (const key of BOOKING_TEXT_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(own, key)) continue;
        const value = (own as Record<string, unknown>)[key];
        if (typeof value === "string" && value !== "") out[key] = value;
    }
    return out;
}
