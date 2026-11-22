/**
 * LANG-1B (docs/slices/lang-1.md § 7.1, § 7.2, § 8.2) — the internal first segment `[siteId]` and the language it carries.
 *
 * The middleware rewrites every public request to `/<siteSegment>/<path>`. For a page of an EXTRA language (the first
 * address segment is one of the tenant's `languages`) the segment is `<host>~<language>` (way W1, § 3); for every other
 * page it is `<host>` (or the tenant id on a by-id path), exactly as before. The root layout cannot see the address
 * (§ 3.1), so the segment is how it learns the page language: `<html lang>`, the menu and the texts follow it, and the
 * ISR key is per language (`…/$/<host>~ro/ro/despre`).
 *
 * Contract of the separator: `~` never comes from the wire. The middleware refuses a host or a by-id id that carries it
 * (literal or percent-encoded, `carriesSiteSegmentSeparator`), so every `~` in a segment was written by
 * `siteSegmentFor`. No DNS host name contains `~` (finding F-LANG-TILDE: tenant ids and domains are not checked for it
 * at create; the operator checks the live list before the deploy).
 *
 * This module is loaded by the middleware (edge bundle), so its only runtime import is the import-free built module
 * `@amodx/shared/dist/languages.js` (§ 7.1); the `TenantConfig` and resolver-input types are type imports (erased).
 *
 * Abstraction line (§ 14): `parseSiteSegment` + `localeInputFor` and the segment writer — users: the middleware (write,
 * wire refusal, the leaked-twin redirect, the page body's first segment), `app/[siteId]/layout.tsx` (two functions), both catch-all pages, `SitePage`
 * (`localeInputFor`) — axis: none, one parse rule and one resolver-input rule at 4+ sites — rejected: `getTenantConfig`
 * stripping the suffix silently (a name that hides a parse), and a ternary repeated at every site.
 */
import { readLanguageSettings, type PageLanguage } from "@amodx/shared/dist/languages.js";
import type { LocaleStringsInput, TenantConfig } from "@amodx/shared";

/** The separator between the host (or tenant id) and the page language in the internal first segment. */
export const SITE_SEGMENT_SEPARATOR = "~";

/** The internal first segment, read: the host (or tenant id) and, when the segment carries one, the page language. */
export type SiteSegment = { host: string; language?: string };

/**
 * `"x.ro~ro"` → `{ host: "x.ro", language: "ro" }`; `"x.ro"` → `{ host: "x.ro" }`. Split at the FIRST `~`; an empty
 * language (`"x.ro~"`) is no language. The language is not checked here: the reader keeps it only when the tenant lists
 * it (`segmentLanguage`).
 */
export function parseSiteSegment(siteId: string): SiteSegment {
    const at = siteId.indexOf(SITE_SEGMENT_SEPARATOR);
    if (at === -1) return { host: siteId };
    const language = siteId.slice(at + 1);
    return language === "" ? { host: siteId.slice(0, at) } : { host: siteId.slice(0, at), language };
}

/** The internal first segment written by the middleware: `<id>~<language>`, or `<id>` when there is no language. */
export function siteSegmentFor(id: string, language: string | undefined): string {
    return language === undefined ? id : `${id}${SITE_SEGMENT_SEPARATOR}${language}`;
}

/** True for one hexadecimal digit. */
const isHex = (c: string | undefined) => c !== undefined && /^[0-9A-Fa-f]$/.test(c);

/**
 * True when a value that comes from the wire (a host header, a by-id id) carries the separator, literally or
 * percent-encoded in ANY depth (`%7E`, `%257E`, `%25257E`, …, also with encoded digits such as `%25%37%45`), whatever
 * else the value holds (a malformed escape elsewhere, `%ZZ`, does not hide it). Such a request is refused (§ 7.1): the
 * separator is written only by `siteSegmentFor`.
 *
 * How (revision 1, review R-LANG1B-03; the first form stopped after four `decodeURIComponent` rounds and at the first
 * malformed escape): one left-to-right pass pushes each character on a stack and, while the top three are `%` and two
 * hex digits, replaces them by the character they encode — so an escape that a decode forms is decoded too, to any
 * depth. Each replacement removes two characters, so the pass is linear in the length of the value. A decoded byte is
 * taken as one character (Latin-1): only the ASCII separator is looked for.
 */
export function carriesSiteSegmentSeparator(raw: string): boolean {
    const out: string[] = [];
    for (const ch of raw) {
        out.push(ch);
        let n = out.length;
        while (n >= 3 && out[n - 3] === "%" && isHex(out[n - 2]) && isHex(out[n - 1])) {
            const decoded = String.fromCharCode(parseInt(out[n - 2] + out[n - 1], 16));
            out.length = n - 3;
            out.push(decoded);
            n = out.length;
        }
    }
    return out.includes(SITE_SEGMENT_SEPARATOR);
}

/** One percent-decoding of `value`; a malformed escape keeps the value as written. */
function decodeOnce(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * The first path segment as the PAGE BODY receives it (the `slug[0]` of `app/[siteId]/[[...slug]]`, which `SitePage`
 * joins into the address it derives the language from): every escape decoded once, EXCEPT an encoded slash, which stays
 * encoded (`%2F`, upper case), and the segment is never split again. OBSERVED on Next 16.4.6, `next start` and the
 * OpenNext 4.1.9 bundle alike (revision 1 probe, `docs/slices/lang-1.md` Appendix F): `/r%6F/x` → `ro`;
 * `/ro%2Fdespre`, `/ro%2fdespre`, `/r%6F%2Fdespre` → `ro%2Fdespre` (the page body looks up `/ro%2Fdespre`; Next hands
 * `generateMetadata` the slash decoded, a different parameter in the same response); `/ro%252Fdespre` → `ro%2Fdespre`.
 * The middleware (wired, unknown verdict, by-id) and the purge route decide the language on this one form, so the
 * segment and the page body name the same language (review R-LANG1B-01: the first form of the wired branch split a
 * decoded `ro/despre` again and wrote `~ro` while the page body rendered the default language).
 */
export function firstPageSegmentOf(path: string): string | undefined {
    const raw = path.split("/")[1];
    return raw === undefined ? undefined : raw.split(/%2F/i).map(decodeOnce).join("%2F");
}

/**
 * True when `first` has the form the language READ rule keeps (`readLanguageSettings`, § 5.1: 2-3 lowercase letters),
 * so it could be a listed extra language. Decided BY that rule, not by a copy of its pattern, so the two cannot drift.
 * Used where the middleware has no language list: an unknown gate verdict (§ 7.1, fail closed to the twin) and the
 * by-id branches (no tenant read).
 */
export function isLanguageShaped(first: string | undefined): first is string {
    return first !== undefined && readLanguageSettings({ languages: [first] }).languages.length === 1;
}

/**
 * The page language the layout uses (§ 7.2, § 8.1): the segment's language when the tenant's OWN list (its own tenant
 * read) holds it; else the default language. A wrong guess of the by-id branches, or a list that changed, gives the
 * default language.
 */
export function segmentLanguage(segment: SiteSegment, languages: readonly string[]): PageLanguage {
    return segment.language !== undefined && languages.includes(segment.language)
        ? { kind: "extra", subtag: segment.language }
        : { kind: "default" };
}

/**
 * The input of `resolveLocaleStrings` for a page (§ 8.2, ruling LANG1-OVERRIDES = A): the tenant record itself for the
 * default language (today's call, the same object), and only `{ locale: <subtag> }` for an extra language — that
 * language's pack, without the tenant's overrides (they are written in the default language). A language without a
 * pack gets the English pack (the resolver's rule).
 */
export function localeInputFor(config: TenantConfig, language: PageLanguage): LocaleStringsInput {
    switch (language.kind) {
        case "default": return config;
        case "extra": return { locale: language.subtag };
    }
}
