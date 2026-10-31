# LOCALE-1A — foundation + site chrome of the tenant locale table (record)

Status: **BUILT 2026-10-31, revised in iteration 1 for review-0 and in iteration 2 for review-1 / operator ruling
LOCALE1A-ROW-IDS = A (§ 9)** (builder; uncommitted, for review). Slice row `locale-1a` of `docs/slices/locale-1.md` § 10,
under the human rulings of § 16 (they win over §§ 8, 10, 11). Start: `main` at `5841a86`, tree clean (EXECUTED).
Maturity: the resolution module (`packages/shared/src/locale-strings.ts`, `language-packs/`) is **PROTOTYPE**; it becomes
MATURE when every visitor surface reads it (end of `locale-1d`).

What the slice does, in one paragraph: the tenant gets a general locale table with three parts — `commerceStrings`
(unchanged), `catalogStrings` (no keys yet) and `siteStrings` (51 site-chrome keys) — plus per-tenant language from the
existing `locale` field. One pure function resolves it (English pack < language pack < tenant override). The renderer's
site chrome (navbar, footer, cookie banner texts, legal labels, restricted page, pagination, breadcrumb "Home",
comments, sharing, quick contact, dynamic form) reads it. Admin edits it on Labels (now for every tenant); Settings gets
the "Site language" select and loses "Overwrite All Texts". `PUT /settings` bounds the two new attributes. **en-US
tenants render the same visible text** on all 74 captured URLs of the 8 en-US fixture tenants; their HTML outside the
RSC payload is byte-identical **except the two category-1 pager consolidations** on `cm1-catalog` `/shop` and
`/shop?availability=in_stock` (`Page <!-- -->1<!-- --> of <!-- -->2` → `Page 1 of 2`, same visible text); every other
byte difference is a listed category-2 added prop (EXECUTED, § 3). The byte comparison of the locale rows uses CM1-A1
plus one ruled widening — row labels of the RSC payload are renumbered (§ 3, § 9).

## 1. Changes, per item (file:line in the candidate tree)

| Item | File:line | What |
|---|---|---|
| Schemas | `packages/shared/src/index.ts:691` `CatalogStringsSchema` (no keys), `:697` `SiteStringsSchema` (51 keys), `:761` `LocaleStrings`, `:863-864` `catalogStrings` / `siteStrings` optional on `TenantConfigSchema`, `:14-18` re-exports | the two new parts (ruling § 16.2 item 1) |
| `COMMERCE_STRINGS_DEFAULTS` | `index.ts:771` bound to `EN_LANGUAGE_PACK.commerce`; literal moved unchanged to `language-packs/en.ts` | deviation D1 |
| Language packs | `packages/shared/src/language-packs/{types,en,ro,index}.ts` | `LanguagePack` / `CompleteLanguagePack`; EN complete by type; RO reads commerce/cookie/legal from `RO_PACK`; `LANGUAGE_PACKS` registry |
| Resolver | `packages/shared/src/locale-strings.ts` | `normalizeLocale`, `resolveLocaleStrings` (`{ locale, language, strings, defaults }`), `fillTemplate`, `COOKIE_AND_LEGAL_LABEL_LOCATIONS` |
| PUT limits | `backend/src/tenant/settings.ts:52-79` (limits + `localeStringsLimitError`), `:162-167` (applied before any read) | § 4.4 |
| mapTenant | `renderer/src/lib/dynamo.ts:139-140` (`untitledSiteName`), `:157-165` (`catalogStrings`, `siteStrings`, `locale: normalizeLocale(item.locale)`) | § 3.2 item 4; `countryCode` stays out |
| Layout | `renderer/src/app/[siteId]/layout.tsx:21-34` `interpolate` (D2), `:55` meta description, `:106` one resolution, `:146-158` cookie props, `:209` Navbar strings, `:233-235` footer lines, `:243`, `:254` headings, `:256-266` legal labels, `:272` copyright, `:283` QuickContact strings | site chrome |
| Navbar | `renderer/src/components/Navbar.tsx:13` `NavbarStrings`, `:61`, `:131`, `:178`, `:190`, `:222`, `:277` | 5 site keys only (commerce "Account"/"Sign In"/"My Account" stay for `1d`) |
| SitePage | `renderer/src/components/SitePage.tsx:515` resolution, `:527-549` restricted page, `:674` SocialShare strings, `:681-685` CommentsSection strings + `dateLocale` spread, `:736-754` Pagination, `:839`, `:1228`, `:1280`, `:1347` view resolutions, `:885`, `:1256`, `:1367` breadcrumb | page chrome |
| Comments | `renderer/src/components/CommentsSection.tsx:21-25` (`strings`, `dateLocale`), `:107` date | texts + date locale |
| SocialShare, QuickContact, DynamicForm, CookieConsent | the four component files | texts as props; CookieConsent's literal fallbacks removed (its five texts are now required props; the layout is the one caller) |
| Admin Labels | `admin/src/pages/Labels.tsx:34-104` pure helpers, `:237` Site group, `:333` cookie & legal card, `:353` commerce (commerce tenants); 128 inputs = 42 site + 9 cookie/legal + all 77 commerce keys (iteration 1 added the 16 commerce inputs that were missing) | § 7.1 |
| Admin Settings | `admin/src/pages/Settings.tsx:35-66` pure helpers `localeStatus`, `withSiteLanguage`, `withCountry`; `:1611` "Language & Country" card (Locale input shows the stored value, warning on a fallback); `:1154`, `:1682` (notes where the moved texts are); `:2008` Apply = `countryCode` + `currency` | § 3.5, § 7.2; nine text inputs removed; "Overwrite All Texts" removed |
| Sidebar | `admin/src/components/layout/Sidebar.tsx:98-99` | "Labels" in System, every tenant |
| Fixtures | `renderer/test/serving-contract/fixtures.mjs` `LOC1`, `localeCopy` | `loc1-ro-content`, `loc1-ro-commerce` (copies with `locale: "ro-RO"`) |
| Proof | `renderer/test/serving-contract/locale-1/proof.mjs` (incl. the subject rule `EN_US_REQUESTS`, iteration 1); `locale-1/1a/{before/,expected-diff.json,ro-expected.json,coverage.json}`; rows in `contract.test.mjs`; `cm1-byte-identity.mjs` `CM1_CONTROL_DIR`; `cm1-byte-identity/{baseline/,control-de4ad52/,README.md}` | § 8.5, § 16.2 item 5 |
| Tests | `packages/shared/test/locale-strings.test.ts`; `backend/test/unit/locale-settings.test.ts`; `admin/src/pages/{Labels,Settings}.test.ts`; `admin/src/components/layout/Sidebar.test.ts`; `renderer/test/unit/locale-1a-{map-tenant,server-render,client,coverage}.test.ts` | § 10 row 1a "Slice checks"; review-0 R2-R4 |
| Docs | `packages/shared/`, `backend/`, `admin/`, `renderer/ARCHITECTURE.md`; `renderer/test/serving-contract/README.md` | |

## 2. Oracles (EXECUTED 2026-10-31, iteration 3, in the packet's order, on the final tree)

| # | Command | Exit | Last lines |
|---|---|---|---|
| 1 | `npm --prefix "…/amodx" run build` | 0 | `> infra@0.1.0 build` / `> tsc` |
| 2 | `npm --prefix "…/amodx" run typecheck` | 0 | `> infra@0.1.0 typecheck` / `> tsc --noEmit` |
| 3 | `npm --prefix "…/packages/shared" test` | 0 | `Test Files 11 passed (11)` / `Tests 235 passed (235)` |
| 4 | `npm --prefix "…/packages/plugins" test` | 0 | `Test Files 5 passed (5)` / `Tests 201 passed (201)` |
| 5 | `npm --prefix "…/renderer" test` | 0 | `Test Files 15 passed (15)` / `Tests 183 passed (183)` |
| 6 | `npm --prefix "…/renderer" run test:serving` | 0 | `# tests 87` / `# pass 87` / `# fail 0` (plus 8 repeat runs on the same final iteration-3 code, each exit 0, § 9) |
| 7 | `npm --prefix "…/admin" run test:unit` | 0 | `Test Files 9 passed (9)` / `Tests 166 passed (166)` |
| 8 | `npm --prefix "…/backend" run test:unit` | 0 | `Test Files 44 passed \| 1 skipped (45)` / `Tests 1188 passed \| 1 skipped (1189)` |
| 9 | `npm --prefix "…/tools/mcp-server" test` | 0 | `# pass 13` / `# fail 0` |
| 10 | `git -C "…/amodx" diff --check` | 0 | (no output) |
| + | `git -C "…/amodx" diff --stat -- infra` | — | prints nothing |
| + | `git -C "…/amodx" diff --stat -- docs/slices/locale-1.md` | — | prints nothing |
| + | `git diff -- '**/package.json' package-lock.json` | — | prints nothing (no dependency line) |
| + | `git status --porcelain -uall` | — | only allocated paths (§ 4 of the packet; listed in the build report) |

`…` = `/Users/apple/Documents/APLICATII BIJUTERIE`. `git diff --check` does not read untracked files; the new files were
checked for trailing whitespace with `grep -nE "[[:space:]]+$"` (no hit). Never run: `cd backend && npm test`.

Serving rows of this slice, from the gate-6 log: `(loc1-subjects) 8 subjects, 74 URLs`; `(loc1-text-<subject>)` all
equal — fixture-tenant 3 HTML URLs / 23 items, wk 1 / 8, iso-a 3 / 29, iso-b 1 / 8, commerce 14 / 308, content 10 / 118,
catalog 15 / 527, cip1b-catalog 15 / 449; `(loc1-text-mutation)` ok; `(loc1-diff-1a)` ok (all 74 URLs asserted, none excluded); `(loc1-renumber-controls)`
`positive control equal; 6 mutations and 3 R5 counterexamples reported; 2 unknown forms fail closed`;
`(loc1-ro-content) 14 URLs, 19 text changes, all listed and all from the RO pack`; `(loc1-ro-commerce) 18 URLs, 34 text
changes, …`; `cm1-identity-commerce` / `-content` ok, 32 × `same` against the advanced baseline; `cm1-control` ok.

## 3. Proof of "en-US tenants do not change" (§ 16.2 item 4)

- **Subjects** (iteration 1, review-0 R1): by rule, every `fixtures.mjs` tenant without `locale` — today 8 tenants
  (`fixture-tenant`, `wk`, `iso-a`, `iso-b`, CM1 `commerce`, `content`, `catalog`, `cip1b-catalog`), 74 URLs
  (`proof.mjs` `EN_US_REQUESTS`: the 51 reviewed CM1 URLs, and for each other tenant every ROUTE# page plus, when it has
  any, `/shop`, each category and each active product). Row `loc1-subjects` asserts that `before/` and
  `expected-diff.json` hold exactly these URLs and no category-3 item, so a new locale-less fixture joins the gate.
- **Start-commit capture** (EXECUTED): `renderer/test/serving-contract/locale-1/1a/before/` — the 74 responses, from
  `5841a86` in the worktree `/tmp/LOCALE-1A-before` (removed), built with that commit's shared/effects/plugins, served
  with THIS tree's `fixtures.mjs` (RO copies added; no other item changed), `ddb-stub.mjs` (unchanged),
  `cm1-byte-identity.mjs` and `locale-1/proof.mjs` (README procedure). Build `SuJy4UzCEmml00QM_lcRE`. It replaces the
  iteration-0 capture of the same commit (51 CM1 responses, build `Qyd7tR0xJJhldn7MjJ2vj`; never committed); the 51 CM1
  captures of the two are equal under CM1-A1 (EXECUTED).
- **Visible text**: rows `loc1-text-<subject>` — equal on every HTML URL of every subject (numbers above);
  `loc1-text-mutation` adds one visible text to one page of each subject and requires that it is reported. The extraction is § 8.5 (text nodes
  with `<!-- -->` removed, `alt`/`title`/`placeholder`/`aria-label`/button `value`, `<title>`, description/og metas);
  the footer year is tokenised with the CM1-A1 step-4 regex (deviation D7).
- **Bytes**: row `loc1-diff-1a`. `expected-diff.json`, per fixture:

| Fixture | URLs | Category 1 | Category 2 (added string props) | Category 3 |
|---|---|---|---|---|
| `cm1-commerce` (en-US) | 18 | 0 | `Navbar.strings` on the 14 HTML URLs; `SocialShare.strings` and `CommentsSection.strings` on `/`, `/about`, `/stale-showcase`; 4 machine routes byte-equal (`[]`) | 0 |
| `cm1-content` (en-US) | 14 | 0 | `Navbar.strings` on the 10 HTML URLs (incl. the two `307` bodies of `/cart`, `/checkout`); `SocialShare.strings`, `CommentsSection.strings` on `/`, `/about`; 4 machine routes `[]` | 0 |
| `cm1-catalog` (en-US) | 19 | `/shop`, `/shop?availability=in_stock`: the pager `Page <!-- -->1<!-- --> of <!-- -->2` → `Page 1 of 2` (HTML) and `["Page ",1," of ",2]` → `"Page 1 of 2"` (RSC row) | `Navbar.strings` on the 15 HTML URLs; `SocialShare`, `CommentsSection` on `/`, `/about`, `/stale-showcase`; 4 machine routes `[]` | 0 |
| `cip1b-catalog` (en-US) | 15 | 0 | `Navbar.strings` on every URL | 0 |
| `fixture-tenant`, `wk`, `iso-a`, `iso-b` (en-US) | 3, 1, 3, 1 | 0 | `Navbar.strings`, `SocialShare.strings`, `CommentsSection.strings` on every URL (content pages) | 0 |

  Outside the two pager pages the HTML outside the flight payload is byte-equal (no other consolidation renders on the
  fixtures: no other pager, no company details or comments with text). Comparison = CM1-A1 (unchanged) plus the ruled
  row renumbering (`proof.mjs` `renumberRows`, locale rows only): RSC rows are relabelled in first-reference order from
  the root row, so only the NUMBER a row carries is ignored; row contents, every reference and its target, dropped and
  added rows, and unreferenced rows are all still compared. References are recognised by their place in the React
  Flight protocol (iteration 3, review-2 R5): only string values of model rows; object keys and non-model rows (error,
  text, stream-marker rows) are data and are never relabelled; an unknown `$`-form or row kind fails closed. The checker removes each listed prop (only when its
  value equals the listed value) from the touched rows and then demands equality; all other rows compare as exact
  strings; a category-1 entry names its HTML form and, when the element travels in the payload, its RSC-row form.
  Bound mutations, inside row `loc1-diff-1a` (the `cm1-rewire` precedent): a dropped listed entry, a listed entry that
  does not occur, one changed HTML byte, a changed prop value and a dropped category-1 entry must each be reported.
- **Strict baseline advanced** (§ 8.5 rule 4, EXECUTED): `cm1-byte-identity/baseline/` re-captured from this tree
  (build `1-KNoKCLJNj3_OcG4T5LY`); reviewed reason = `expected-diff.json`; history added to `cm1-byte-identity/README.md`.

### How each en-US formatter stays identical

| Formatter | Before | After, for an en-US tenant |
|---|---|---|
| `SitePage.tsx` checkout `locale={config.locale \|\| "en-US"}` (→ `CheckoutPageView.tsx:524,598`), review dates `:1099`, order date `:1525`, history time `:1555` (code unchanged) | `config.locale` always `undefined` (mapTenant dropped it) → `"en-US"` | `config.locale = normalizeLocale(item.locale)` = `"en-US"` for an absent, `"en-US"` or malformed value → the same argument `"en-US"` |
| `CommentsSection.tsx:107` comment dates | `toLocaleDateString()` (runtime default) | `toLocaleDateString(dateLocale)` with `dateLocale` ABSENT (the prop is spread only when the locale is not en-US) → `toLocaleDateString(undefined)`, which ECMA-402 defines as the runtime default — the same call |
| `layout.tsx` footer year | `new Date().getFullYear()` as its own child | the same value, its own child (`interpolate`) |

Limit (INFERRED, not verified on prod): a live tenant whose stored `locale` normalises to something other than en-US
(for example `de-DE`) would now get dates in that locale on the five readers above. The human stated that all live
tenants with domains use en-US (§ 16.1); the operator cannot read prod.

## 4. Romanian text table — for the human's approval before the prod deploy (§ 16.2 item 4)

Every key `1a` ships. "RO (proposed)" is `packages/shared/src/language-packs/ro.ts`; a value marked ¹ is read from the
RO country pack (`country-packs/ro.ts`, already used by tenants that pressed "Overwrite All Texts"). A changed value is
edited in `ro.ts` only (no code review beyond the pack file, § 16.2 item 4). `{…}` are placeholders filled at render.
Where the RO value equals the EN value (`Contact`, `CUI: {value}`, `Tel: {value}`), that is the proposal, not an omission.

| # | Key | EN (renders today) | RO (proposed) | Where it renders |
|---|---|---|---|---|
| 1 | `untitledSiteName` | Untitled Site | Site fără nume | site name when the tenant has none (`lib/dynamo.ts` mapTenant → Navbar, titles, footer) |
| 2 | `metaSiteDescription` | Official site for {name} | Site-ul oficial {name} | `<meta name=description>` when the tenant has no description (`layout.tsx`) |
| 3 | `footerTaxId` | CUI: {value} | CUI: {value} | footer company column (`layout.tsx`) |
| 4 | `footerTradeRegister` | Reg: {value} | Reg. Com.: {value} | footer company column |
| 5 | `footerPhone` | Tel: {value} | Tel: {value} | footer company column |
| 6 | `footerLinksHeading` | Links | Linkuri | footer links column heading |
| 7 | `footerLegalHeading` | Legal | Informații legale | footer legal column heading |
| 8 | `legalTermsLabel` | Terms & Conditions | Termeni și condiții ¹ | footer legal link (stored in `legalLinks.termsLabel`) |
| 9 | `legalPrivacyLabel` | Privacy Policy | Politica de confidențialitate ¹ | footer legal link (`legalLinks.privacyLabel`) |
| 10 | `legalConsumerProtectionLabel` | Consumer Protection | ANPC ¹ | footer legal link (`legalLinks.anpcLabel`) |
| 11 | `legalDisputeResolutionLabel` | Dispute Resolution | Soluționare alternativă a litigiilor ¹ | footer legal link (`legalLinks.anpcSalLabel`) |
| 12 | `footerCopyright` | © {year} {name}. All rights reserved. | © {year} {name}. Toate drepturile rezervate. | footer bottom line |
| 13 | `cookieHeadline` | We value your privacy | Respectăm confidențialitatea ta ¹ | cookie banner (stored in `gdpr.headline`) |
| 14 | `cookieDescription` | We use cookies to enhance your browsing experience and analyze our traffic. Choose your preference below. | Folosim cookie-uri pentru a îmbunătăți experiența ta de navigare și pentru a analiza traficul. Alege preferința ta mai jos. ¹ | cookie banner (`gdpr.description`) |
| 15 | `cookieDenyAll` | Deny All | Refuză toate ¹ | cookie banner button (`gdpr.denyAll`) |
| 16 | `cookieNecessaryOnly` | Necessary Only | Doar necesare ¹ | cookie banner button (`gdpr.necessaryOnly`) |
| 17 | `cookieAcceptAll` | Accept All | Acceptă toate ¹ | cookie banner button (`gdpr.acceptAll`) |
| 18 | `navAllOf` | {label} (All) | {label} (toate) | navbar dropdown, first entry (desktop) |
| 19 | `navContact` | Contact | Contact | navbar Contact button (desktop) |
| 20 | `navToggleMenu` | Toggle menu | Deschide sau închide meniul | navbar menu button, `aria-label` (mobile) |
| 21 | `navViewAll` | View All | Vezi tot | navbar dropdown, first entry (mobile) |
| 22 | `navContactUs` | Contact Us | Contactează-ne | mobile menu Contact button |
| 23 | `breadcrumbHome` | Home | Acasă | breadcrumb on product, category and search pages |
| 24 | `restrictedTitle` | Restricted Access | Acces restricționat | restricted page heading |
| 25 | `restrictedLoginRequired` | You must be logged in to view this page. | Trebuie să fii autentificat ca să vezi această pagină. | restricted page, sign-in needed |
| 26 | `restrictedSubscription` | This content requires a subscription ({currency} {price}). | Acest conținut necesită un abonament ({currency} {price}). | restricted page, purchase needed |
| 27 | `restrictedLogIn` | Log In with Google | Autentificare cu Google | restricted page button |
| 28 | `restrictedPurchase` | Purchase Access | Cumpără accesul | restricted page button |
| 29 | `paginationPrevious` | Previous | Înapoi | pager (category, shop, search) |
| 30 | `paginationPageOf` | Page {page} of {total} | Pagina {page} din {total} | pager |
| 31 | `paginationNext` | Next | Înainte | pager |
| 32 | `commentsPostFailed` | Failed to post | Comentariul nu a putut fi publicat | comments: browser alert when a post fails |
| 33 | `commentsHeading` | Discussion ({count}) | Discuție ({count}) | comments heading |
| 34 | `commentsEmpty` | No comments yet. Be the first! | Niciun comentariu încă. Fii primul! | comments: empty list |
| 35 | `commentsClosed` | Comments are closed for this post. | Comentariile sunt închise pentru acest articol. | comments: locked thread |
| 36 | `commentsPlaceholder` | Write a comment... | Scrie un comentariu... | comments textarea placeholder |
| 37 | `commentsPost` | Post | Publică | comments submit button |
| 38 | `commentsJoin` | Join the conversation | Alătură-te discuției | comments: signed-out heading |
| 39 | `commentsSignIn` | Sign in with Google | Autentificare cu Google | comments: sign-in button |
| 40 | `shareLabel` | Share: | Distribuie: | share row label (content pages) |
| 41 | `shareOnX` | Share on X | Distribuie pe X | share button `title` |
| 42 | `shareOnLinkedIn` | Share on LinkedIn | Distribuie pe LinkedIn | share button `title` |
| 43 | `shareOnFacebook` | Share on Facebook | Distribuie pe Facebook | share button `title` |
| 44 | `shareByEmail` | Share via Email | Trimite pe e-mail | share button `title` |
| 45 | `shareCopyLink` | Copy Link | Copiază linkul | share button `title` |
| 46 | `quickContactCall` | Call us | Sună-ne | floating contact button `title` (phone) |
| 47 | `quickContactEmail` | Email us | Scrie-ne | floating contact button `title` (email) |
| 48 | `formSubmissionFailed` | Submission failed | Trimiterea a eșuat | dynamic form error (no importer today) |
| 49 | `formErrorShort` | Something went wrong | Ceva nu a funcționat | dynamic form error (no importer today) |
| 50 | `formSelectPlaceholder` | Select... | Selectează... | dynamic form select placeholder (no importer today) |
| 51 | `formSubmitting` | Submitting... | Se trimite... | dynamic form busy button (no importer today) |

## 5. Abstractions introduced (one line each)

- `SiteStringsSchema` / `CatalogStringsSchema` — users: resolver, Labels page, PUT validation (key names), mapTenant
  test; axis: keys added per surface (fixed parts, operations grow → typed object per part); rejected: all keys in
  `CommerceStringsSchema` (its name would lie). `CatalogStringsSchema` has no key until `1b`; it exists now because the
  packet and § 10 allocate the part (read, validated, resolved) to `1a`.
- `LanguagePack` + `LANGUAGE_PACKS` (en, ro) — users: resolver, admin Site language select, Labels placeholders; axis:
  languages (Romanian tenants exist; "whatever other language may arrive"), independent of country → registry, adding
  a language touches no code; rejected: texts in country packs (couples language to country).
- `resolveLocaleStrings` — users: layout, SitePage (5 call sites), mapTenant, Labels, Settings; axis: none new (one
  layering for three parts); rejected: one resolver per part.
- `normalizeLocale` — users: resolver, mapTenant; axis: none; rejected: passing the raw stored string (throws for `ro_RO`).
- `fillTemplate` — users: layout (meta description, 3 footer lines), SitePage (restricted subscription, pager), Navbar,
  CommentsSection; axis: none; rejected: inline `.replace` per site.
- `COOKIE_AND_LEGAL_LABEL_LOCATIONS` — users: resolver, backend reserved-key check, Labels save; axis: none (nine fixed
  keys with one stored home each); rejected: three copies of the nine names.
- `interpolate` (renderer, local to `layout.tsx`) — users: the footer copyright; axis: none; rejected: `fillTemplate`
  (merges the clock year into one string → the strict byte baseline would hold a literal year, D2).
- Labels pure helpers (`draftFromSettings`, `setText`, `labelsSaveBody`, `resetSection`, `overrideCount`) — users: the
  page and `Labels.test.ts` (test seam: the admin unit config is node-only, no DOM); rejected: logic inline in handlers.
- `locale-1/proof.mjs` — users: the five `loc1-*` rows and the later locale slices (§ 8.5 "one helper"); rejected:
  per-row inline parsing.
- `renumberRows` (in `proof.mjs`, iteration 2) — users: `checkExpected` (rows `loc1-diff-1a`, `loc1-renumber-controls`);
  axis: none (one fixed canonical form); rejected: blanking ids (loses where references point) and per-URL exclusions
  (a waived check) — operator ruling LOCALE1A-ROW-IDS = A.
- `EN_US_REQUESTS` (in `proof.mjs`, iteration 1) — users: rows `loc1-subjects`, `loc1-text-<subject>`, `loc1-diff-1a`;
  axis: fixture tenants added by later slices (8 today) → a rule over `fixtures.mjs`; rejected: a hand list (review-0 R1).
- Settings helpers `localeStatus`, `withSiteLanguage`, `withCountry` — users: the "Language & Country" card and its
  Apply dialog, `Settings.test.ts` (test seam: node-only admin unit config); axis: none; rejected: logic inline in JSX
  handlers (untestable without a DOM).

## 6. Deviations from the design, with the reason

- **D1** `COMMERCE_STRINGS_DEFAULTS`' literal moved to `language-packs/en.ts`; `index.ts` binds the same exported name to
  it. Reason (EXECUTED): `index.ts` re-exports the resolver, which imports the EN pack; a value import from `index.ts`
  inside that graph throws `ReferenceError: Cannot access … before initialization` (ESM cycle, reproduced in
  `/tmp/LOCALE-1A-esm`, removed). Value identity (EXECUTED): JSON of the new export, key order included, equals the
  `5841a86` literal.
- **D2** The footer copyright uses a local `interpolate`, not `fillTemplate`: same children as the replaced JSX, so the
  bytes and the CM1-A1 footer-year canonicalisation (which only matches `© <!-- -->dddd<!-- -->`) are unchanged.
- **D3** `resolveLocaleStrings` also returns `language` (the pack used): the Settings card needs "Texts: <language>".
- **D4** The site part ships the 51 keys `1a` reads, not all 78 of § 6.1; the 27 block keys come with `locale-1c` (a
  key without a reader would have no coverage check).
- **D5** `mapTenant` stores the NORMALISED locale. § 3.4 says the commerce date readers change "via mapTenant"; they
  pass `config.locale` straight to formatters, so a raw `ro_RO` would throw there.
- **D6** The de4ad52 capture set moved from `baseline/` to `control-de4ad52/`; row `cm1-control` reads it. Reason: rule 4
  of § 8.5 advances `baseline/`, but `cm1-control` must see the catalog tenant differ from the pre-catalog-mode
  renderer. The `cm1-identity-*` row titles said "as the de4ad52 baseline did"; that became false and was corrected
  (row ids unchanged).
- **D7** The extraction replaces the footer digits with the token `{year}` (CM1-A1 step-4 regex; `maskBody`'s `<year>`
  would parse as a tag). Without it the immutable `before/` (2026) would fail every text row from 1 January 2027.
- **D8** Labels: "Reset" confirms with the browser `confirm()` (the pattern of `Comments.tsx`, `Categories.tsx`) and the
  pattern-D note is one line per section, not per input. Save sends nothing when nothing changed.
- **D9** Settings: the card is titled "Language & Country"; the country button is "Apply Country"; the dialog has one
  "Apply" button (`countryCode` + `currency`). The currency input stays on the card.
- **D10** `ro-expected.json` is an added support file: the RO rows need a reviewed expectation, each `from`/`to` checked
  against the packs by the row. (An authoring CLI and an "added props" report I used to draft `expected-diff.json` were
  removed before the gates: no row or test used them.)
- **D11** (iteration 1) The en-US subject set is a rule over `fixtures.mjs` (no `locale`), with request lists derived
  by rule for the non-CM1 tenants; the `loc1-*` rows run last in the `next`-only block so the new captures follow every
  row that depends on those tenants' cache state.
- **D12** (iteration 1) Settings' card rules are exported pure helpers (`localeStatus`, `withSiteLanguage`,
  `withCountry`), the admin pattern of `Labels`/`FormSubmissions`; the admin unit config has no DOM. The warning rule:
  a PRESENT value that is not itself a spelling of en-US but falls back to en-US (`""`, blanks, `xx-YY`, `123`); `en_US`
  is en-US and does not warn; an absent value is the documented default and does not warn. The input now shows the
  stored value (it used to show `en-US` for an empty value, so a blank could not be seen).
- **D13** (iteration 2, ruled: LOCALE1A-ROW-IDS = A) The locale byte rows compare RSC payloads after relabelling rows in
  first-reference order (`renumberRows`) — a widening of CM1-A1 limited to row labels, in `loc1-diff-*` only; reason:
  the pre-existing render-to-render variation of row numbering on catalog-mode category pages (§ 9).

## 7. Findings and what I could not determine

- **F-LOCALE-DYNAMICFORM-ORPHAN** (OBSERVED, `git grep -n DynamicForm`, a text search over tracked files): no file imports
  `renderer/src/components/DynamicForm.tsx`. Its four keys are proven by jsdom only; no visitor sees them today.
  Not deleted (registry-style code; not this slice's call).
- **F-LOCALE-SHARE-MAILTO** (OBSERVED): `SocialShare.tsx` builds the e-mail body `Check this out: <link>` inside the
  `mailto:` href. § 6.0 dropped `href` values by syntax, so § 6 has no key for it. Visible in the visitor's mail client;
  English on RO sites. Not changed (not allocated). Proposed: a site key in `1c` or a follow-up.
- **Serving README row count** was already stale before this slice ("= 50"); corrected to a pointer and this run's 78.
- **F-LOCALE-ROW-IDS** (EXECUTED, iteration 1): on catalog-mode category pages the RSC encoder numbers the outlined
  product-card rows in an order that varies between renders of one tree (§ 9). Not caused by this slice (the variation
  is between renders of the same code); it made an exact CM1-A1 byte comparison of those pages flaky. Handled in the
  locale rows by the ruled renumbering; the `cm1-identity-*` rows (commerce, content) do not meet it and keep CM1-A1.
- **F-CATALOG-RSC-ORDER** (follow-up, NOT built here; the operator's ruling item 6): find and remove the varying row
  order at its source in the catalog listing render (`SitePage.tsx` catalog category listing / `InterestToggle` cards),
  so the payload is deterministic again; then the renumbering could be retired. Needs its own slice with its own proof.
- **No date proof in captures**: the fixtures render no review, order or comment, so the RO date rows (L-RO-6) are
  proven only by unit tests (`locale-1a-client.test.ts` comment dates; shared `normalizeLocale` cases). The order
  confirmation/tracking fixtures of the rebuttal item 2 belong to `locale-1d` (their texts are commerce keys).
- **Prod data** (NOT RUN, cannot): whether a live tenant stores a non-en-US `locale`, or values in `gdpr`/`legalLinks`
  label fields; whether `povesti-pe-biscuite` has `locale: "ro-RO"`.

## 8. Operator's staging checklist (Layer 2) and the human's pre-deploy step

Deploy order (§ 4.5): backend → admin → renderer. Rollback: renderer first.

1. Backend + admin to staging. In admin, on `cm1-content`: Labels is in the System section; Site group placeholders
   are English; Settings shows "Language & Country" with "Dates: en-US. Texts: English."; no "Overwrite All Texts".
2. `PUT /settings` with `siteStrings: { cookieHeadline: "x" }` → 400 naming `gdpr.headline`; a Settings save without the
   new attributes → 200.
3. Renderer to staging. Layer 2 extraction (same helper, `locale-1/proof.mjs` `extractVisibleText`) of the 14
   `cm1-content`, 18 `cm1-commerce` and 19 `cm1-catalog` URLs (all en-US) against a capture taken before the renderer
   deploy: **every list must be text-identical** (zero ledger rows; `cm1-catalog` too — its catalog texts change only in `1b`).
4. RO evidence on staging needs a RO staging tenant (none exists, § 12 E2): either create one (copy of `cm1-content` with
   `locale: "ro-RO"`) and compare with `ro-expected.json`, or record Layer 2 as EN-only.
5. **Human, prod, before the `locale-1a` renderer deploy (§ 16.3):** set `povesti-pe-biscuite`'s Site language to
   Romanian (`locale` = `ro-RO`) in Settings if it is not; approve or amend the table of § 4.

¹ Read from `RO_PACK` (`packages/shared/src/country-packs/ro.ts`), one copy until `locale-1d` (§ 3.2 item 2).

## 9. Iteration 1 — review-0 findings, the class each is an instance of, and the rule that closes it

| Finding | Class of defect | Rule now in the tree |
|---|---|---|
| R1 en-US gate covered 2 of the locale-absent fixtures | a gate whose subjects are listed by hand instead of derived from the rule it enforces | `EN_US_REQUESTS` = every `fixtures.mjs` tenant without `locale`; `loc1-subjects` asserts `before/` and `expected-diff.json` hold exactly those URLs; `loc1-text-mutation` proves each subject's comparison can fail |
| R2 commerce Reset covered 16 keys without an input | a Reset scope that is a key list not bound to the page's inputs | `Labels.test.ts` reads the page's `<F … field>` inputs per part and asserts they equal `SECTION_KEYS[part]`, one each; the 16 inputs were added |
| R3 Settings/Sidebar untested; 2 of 9 F readers and no D case per component | checks chosen by example instead of by the reader list of § 5.2 | `Settings.test.ts` (language, country, help line, warning); `Sidebar.test.ts` (server render, 3 tenant kinds); renderer: all nine F readers × EN/RO × absent / `""` / `"X"` / not-from-`siteStrings`, and one D reader per component (Navbar, QuickContact, CommentsSection, SocialShare, DynamicForm, footer heading, pager, `untitledSiteName`), expected values written out from § 6.1 and `country-packs/ro.ts` |
| R4 blank locale showed no warning | "absent" and "present but empty" merged into one state | `localeStatus` distinguishes absent (no warning) from present-and-falls-back (warning); the input no longer substitutes `en-US` for `""` |

Found while closing R1 (EXECUTED, iteration 1): with all 8 subjects in the byte gate, `loc1-diff-1a` failed in 8 of 16
suite runs of one unchanged tree — always and only on `catalog /category/floors` (6 runs) and `cip1b-catalog
/category/cip1b-boen` (2 runs). Three fresh builds captured sequentially gave identical canonical bodies on all 74 URLs,
and the visible text of those pages was equal in every run. In iteration 1 the two URLs were excluded from the byte
assertion (`byteGateExclusions`); that was a reduced check — a temporary waiver of the byte contract on two URLs — and
the decision LOCALE1A-ROW-IDS went to review. A blanking diagnostic showed the rows agreed with ids and references
blanked; review-1 rightly noted that blanking also erases where references point, so it did not prove a pure renumbering.

**Ruling (operator, 2026-10-31, under the human's delegation; packet § 6): LOCALE1A-ROW-IDS = A, with controls.** Built
in iteration 2:
- `proof.mjs` `renumberRows`: the RSC rows are relabelled in first-reference order (root row `0`, row bodies walked in
  textual order, each referenced row numbered at its first encounter and walked at once, depth first; every reference
  rewritten; rows emitted by new id; rows never reached from the root follow in input order and are compared too).
  This is a **ruled widening of the comparison, limited to row labels**, in the locale byte rows only; the
  `cm1-identity-*` rows keep CM1-A1 exactly. All lines carrying one label are one row (found on the real payload: an
  empty async-iterable stream row `8:X` + `8:C`). A reference to a missing row is marked (`"$!<id>"`) so it can never
  match. The blanking diagnostic was removed.
- `byteGateExclusions` removed from `expected-diff.json` and from the row; the row asserts that no URL is excluded. All
  74 URLs have the exact byte assertion.
- Bound controls, row `loc1-renumber-controls`: a rewired reference, a changed value in one row, a dropped row, an added
  row, two rows' contents swapped and one changed HTML byte are each reported; rows that are only permuted with their ids
  consistently renamed compare equal. The earlier real-capture mutations of `loc1-diff-1a` stay.
- (Superseded by iteration 3.) The iteration-2 renumbering recognised references by spelling; review-2 R5 showed it
  also relabelled object keys and error digests and left `$W`/path references unresolved, so the claim made here — that
  the two pages' differences were label-only — rested on a canonicaliser that could accept changed data. It is
  re-established under the iteration-3 rule below.
- Serving suite on the final tree: 8 runs, each exit 0 (EXECUTED; 87/87 each). INFERRED: the varying order occurred in
  some of them (at the measured 8-in-16 rate, eight unaffected runs by chance ≈ 0.4 %); the runs do not log it.
- Follow-up F-CATALOG-RSC-ORDER (§ 7): remove the variation at its source; not built here.
- Re-verified on re-dispatch (EXECUTED, unchanged tree): the ten gates exit 0 again (serving 87/87) and 6 more
  serving runs each exit 0. Those 15 passing runs used the iteration-2 canonicaliser and are NOT evidence for R5. My
  build-2 report also said review-1 was the latest open feedback; that was wrong — R5 was open (review-2 point 2).

**Iteration 3 — review-2 R5: the renumbering must respect the protocol, not the spelling.**
- Class of defect: references recognised by spelling instead of by their place in the React Flight protocol. Rule now
  in `proof.mjs` (`rowKind`, `referenceIn`, `eachValue`, `renumberRows`): only MODEL rows (JSON bodies) hold
  references, and only their string VALUES — an object key is data; error rows `E{…}`, text rows `T<len>,…` and the
  bare stream markers `X`/`x`/`R`/`r`/`C` are kept as written and not scanned; every React Flight row-reference form is
  recognised — `"$<hex>"`, `$@`, `$L`, `$F`, `$Q`, `$W`, `$B`, `$K`, `$i` — with an optional `:path`, which is kept; the
  known non-references (`"$"`, `"$$…"`, `$S…`, `$Infinity`, `$NaN`, `$-0`, `$-Infinity`, `$undefined`, `$D…`, `$n…`,
  the CM1-A1 identities `$L[project]…`) stay as written; any other `$`-form or labelled row kind THROWS (fail closed).
- Controls added to `loc1-renumber-controls`: the three review-2 counterexamples (an object key `$1` → `$7` with a
  reference that moved with it; an error digest `$2` → `$9`; a Set reference `$W1` retargeted from row A to row B) are
  each reported; an unknown `$`-form and an unknown row kind each make the checker throw; the positive control now
  also renames rows around an object key, a `$W` reference, a path reference and an error row, and still compares
  equal. EXECUTED: a reconstruction of the iteration-2 canonicaliser accepts all three counterexamples (false
  accepts); the iteration-3 one rejects all three — so the controls bind.
- The 74 real URLs (before and candidate) pass the stricter rules without any fail-closed refusal, and the two
  formerly varying catalog pages still compare equal — now under a canonicaliser whose controls show that keys,
  metadata, values and reference targets are compared; so their differences are label-only (EXECUTED, runs below).
- Runs on the final iteration-3 code (EXECUTED): the ten gates exit 0 (serving 87/87), then 8 serving runs, each
  exit 0 (87/87 each).

## 10. Operator approval of the Romanian text table (2026-10-31)

Authority: the human delegated the approval of each slice's Romanian table to the operator overnight on 2026-10-31
("use your best judgement on the Romanian text table - implement what you recommend"). The table of § 4 is
approved with four amendments, applied after review approval in `packages/shared/src/language-packs/ro.ts` and the
one renderer unit test that pins the values (`renderer/test/unit/locale-1a-server-render.test.ts`); the gates were
re-run on the amended tree. The § 4 rows stay as the builder's proposal; this section wins.

| # | Key | Proposed | Approved | Reason |
|---|---|---|---|---|
| 25 | `restrictedLoginRequired` | Trebuie să fii autentificat ca să vezi această pagină. | Trebuie să fii autentificat pentru a vedea această pagină. | the usual register for a site notice |
| 29 | `paginationPrevious` | Înapoi | Anterior | "Înapoi" reads as "go back"; Romanian pagers use Anterior / Următor |
| 31 | `paginationNext` | Înainte | Următor | as row 29 |
| 49 | `formErrorShort` | Ceva nu a funcționat | A apărut o eroare | the usual Romanian error message |

Every other row is approved as proposed. Any value can be changed later in `ro.ts` alone, and a tenant admin can
override any of them on the Labels page.

## 11. Operator closeout (2026-10-31)

- **Relay.** 4 cycles (builder claude-opus-5-5, reviewer gpt-6.1-sol). Cycle 2 escalated `LOCALE1A-ROW-IDS`. The
  operator ruled **A** under the human's overnight delegation (2026-10-31): the locale byte rows compare RSC rows
  renumbered in first-reference order, with no URL excluded. Bound controls: a rewired reference, a changed value, a
  dropped row, an added row, swapped rows, one changed HTML byte, plus a positive renaming control. The reviewer
  approved at cycle 4 after closing R5 (canonicaliser fidelity). The `cm1-identity-*` rows are unchanged. Follow-up
  `F-CATALOG-RSC-ORDER` (remove the varying row order at its source) is recorded and not built.
- **Gates.** The ten common gates and the packet's four extra checks passed on the accepted candidate, and again on the
  tree with the § 10 amendments (`ALL GATES GREEN` both times).
- **Staging (Layer 2), en-US.** `cdk diff`: Lambda code and nested-stack template URLs only (41 functions, 3 nested
  stacks; no IAM, network or resource change). Two captures before the deploy of the 51 CM1 URLs (`cm1-content` 14,
  `cm1-commerce` 18, `cm1-catalog` 19) were equal to each other once the streamed metadata block (`<title>`, `<meta>`),
  which Next places in `<head>` or later in `<body>` by timing, is compared as its own ordered list. After the deploy
  (new build id served on every HTML page): **51 of 51 URLs equal** in status, content type and visible text (the
  slice's own `extractVisibleText`). Control: one changed word on `cm1-commerce /about` is reported (exit 1).
  Limitation: the three tenant roots were requested with a trailing slash and answered 308 in both captures, so on
  staging their HTML was not compared; the serving contract compares them byte for byte (74 URLs). After the § 10
  amendments the tree was deployed again: 48 URLs equal, the 3 roots differ only by that URL fix (308 → 200).
- **Staging backend.** `PUT /settings` on `cm1-content` with `siteStrings.cookieHeadline` → 400 naming
  `gdpr.headline`, item unchanged; `PUT {}` → 200, same attributes, no `siteStrings`/`catalogStrings` written.
- **Not proven on staging.** Romanian rendering: no Romanian staging tenant exists (§ 8 item 4); Romanian output is
  proven by the serving-contract fixtures `loc1-ro-content` and `loc1-ro-commerce`.
- **Human, before the prod renderer deploy:** set `povesti-pe-biscuite`'s Site language to Romanian (`ro-RO`) if it
  is not (§ 8 item 5).
