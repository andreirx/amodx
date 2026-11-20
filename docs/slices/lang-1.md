# LANG-1 — more than one language on one site (SPECIFICATION slice)

> Copied 2026-11-18 from `satulbanului/docs/amodx-slices/lang-1.md` (draft written by the satulbanului session). This copy is the one to edit.
> Not ratified. Its `file:line` evidence comes from one read-only pass on `main` at `3388999`; a builder reads each again.

Status: **PLANNED (draft, not ratified) — DECISION REQUIRED before any build**. Track: new, `lang`
(the `locale` track is the neighbour and the base). Depends: `locale-1a`…`1e` (built). This slice writes a
specification; it changes no code.

## 1. The problem

AMODX gives a site one language. The setting is `locale` on the tenant (`packages/shared/src/index.ts:1236`),
and the direction recorded in `docs/slices/locale-1.md` is: "the language setting is per tenant". Everything
a visitor reads that is not page text — block chrome, shop texts, `<html lang>` — resolves from that one value
(`locale-strings.ts:67,87,180`; `renderer/src/app/[siteId]/layout.tsx:262`).

Nothing joins a page to a language (deterministic search, 2026-11-18: no `lang` on `ContentItemSchema`
`index.ts:362+` or `RouteSchema` `:242-250`; no `hreflang`, no `alternates.languages` in `renderer/` or
`packages/`). There is one menu and one footer list per site (`navLinks`, `footerLinks`, `index.ts:1180-1181`).

What already works: an address may hold `/` (`packages/shared/src/slug.ts:27-34`), so `/ro/room/maica-lina` is a
valid page address today. A four-language site can be typed in as 283 unrelated pages. What it then gets wrong:

- every page says `lang="en"` (or the one tenant language) to browsers, screen readers and search engines;
- no `hreflang`, so search engines see four competing copies in place of one page in four languages;
- the menu, footer and block texts stay in one language on every page;
- the visitor has no language switch;
- language packs exist for EN and RO only (`packages/shared/src/locale-strings.ts`, `index.ts:17`).

Named tenants that need this: satulbanului (en, ro, de, fr). No other tenant has asked.

## 2. Decision LANG1-SCOPE (the human's)

| Option | Reward | Risk |
|---|---|---|
| **A. A page may state its language; the tenant language stays the default** (this specification) | One site, one domain, the old addresses kept, correct `hreflang`. Sites with one language see no change. | Changes a ratified statement. Touches the root layout and the string resolution of every live tenant; four build slices; German and French packs must be written and kept complete as texts are added. |
| B. One tenant per language (`ro.` / `de.` / `fr.` subdomains) | No platform change apart from a cross-site `hreflang` list in settings. | Every old address changes host; four tenants to edit; shared photos uploaded four times; cross-tenant links are configuration that nothing checks. |
| C. Multi-language sites stay off AMODX (static, as today) | Zero risk to live tenants. | No online editing for such sites; the gap stays for the next multi-language client. |

No recommendation is recorded as decided. With one named tenant, C is the smallest answer; A is right when a
second multi-language client is named or when online editing of this site is worth four slices.

## 3. Design under option A (to be reviewed, not built)

Rule: a page's language is data on the page; the address is not parsed for it.

- **Data.** `ContentItem` gains `lang?` (a language subtag from the site's list) and `translationKey?` (one
  string shared by the pages that are the same page in different languages). Tenant gains `languages?: string[]`
  (the extra languages), `navLinksByLang?` and `footerLinksByLang?` (a record from language to the existing
  `LinkSchema` list). All absent → today's behaviour, byte for byte.
- **Lookup.** `hreflang` needs "all pages with this `translationKey`". No scan: an adjacency item
  `TRANSLATION#<key>#<lang>` → address, written with the page (same transaction as the route).
- **Output.** `alternates.languages` + `x-default` in `buildSitePageMetadata` (`SitePage.tsx:245-324`);
  `xhtml:link` in `sitemap.xml/route.ts:24-33`; menu and footer chosen by the page language; a language
  switch in the header that links to the sibling page, or to that language's home when there is none.
- **Texts.** `resolveLocaleStrings` receives the page language in place of the tenant language. German and
  French packs for the site part only (commerce and catalog parts stay EN/RO until a shop asks).

### Open design point LANG1-HTML-LANG (needs a spike before the specification is final)

`<html lang>` is written by the root layout `app/[siteId]/layout.tsx:262`. A Next layout receives only its own
segment's parameters (`siteId`), not the page address, so it cannot know the page language. Ways out:

| Way | Reward | Risk |
|---|---|---|
| The middleware puts the language into the rewritten first segment (`/<host>~ro/...`) when the first address segment is one of the site's languages | the layout knows the language; cache entries stay separate per language | the rule "the address is not parsed" is broken for this one purpose; the rewrite is the core of the serving contract (`middleware.ts:296-298`); every purge path that names the host must be checked |
| A route group per language under `[siteId]` | pure Next structure | the language list is tenant data, not a build-time list — likely not possible; the spike confirms |
| Keep the tenant language on `<html>` and put `lang` on `<main>` | no routing change | `<html lang>` wrong on three of four languages: the defect this slice exists to remove, only smaller |

The spike runs on a branch with `npm run test:serving`; its result is recorded here before ratification.

## 4. Build slices after ratification (each deployable alone, each a no-op for one-language sites)

| Slice | Content | Proof |
|---|---|---|
| `lang-1a` | fields + `TRANSLATION#` adjacency + `hreflang` + sitemap alternates; editor: language select and "translation of" picker | serving suite: one-language fixtures byte-identical; a two-language fixture shows reciprocal `hreflang` |
| `lang-1b` | menu and footer per language; language switch | the staging URL identity set unchanged for en-US sites (the `locale-1e` proof) |
| `lang-1c` | `<html lang>` and block texts by page language (after the spike) | same identity proof; `lang` correct on a two-language staging site |
| `lang-1d` | German and French packs, site part | coverage rule of `locale-1.md` § 16: no key without a text |

## 5. Non-scope

Machine translation. A language chosen from the browser's `Accept-Language` (it breaks edge caching).
Per-language domains. Commerce and catalog texts in German or French. Right-to-left scripts.

## 6. Deployment notes

Every build slice touches code that serves live tenants. Order: staging, the full probe suite, the identity
proof on the en-US and ro-RO staging sites, then the human's production deploy. Rollback of `1a`: redeploy;
the new fields are ignored by the old code. No data migration in any slice (all fields optional).

## 7. Exit criterion of this specification slice

LANG1-SCOPE answered; if A, the spike result recorded, § 3 reviewed against `docs/caching-architecture.md`
§ *Serving contract*, and the four rows of § 4 registered in `docs/ROADMAP.md`.

## 8. Ruling (human, 2026-11-20)

LANG1-SCOPE = **A**. Multi-language sites are mandatory: a second named client, galeriilevoicu.ro, has Romanian
and English (`docs/plan-courses-group-sessions.md` § 1). The condition of § 2 ("when a second multi-language
client is named") is met. Next step: the LANG1-HTML-LANG spike, then the review of § 3. For galeriilevoicu the
existing EN and RO packs are enough; `lang-1d` (German, French) is needed by satulbanului only.
