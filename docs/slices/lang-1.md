# LANG-1 — more than one language on one site (SPECIFICATION slice)

> Copied 2026-11-18 from `satulbanului/docs/amodx-slices/lang-1.md` (draft by the satulbanului session).
> Rewritten 2026-11-21 as a buildable specification after the LANG1-HTML-LANG spike (§ 3). Every `file:line`
> in this file was read again on `main` at `d1ffd80`. Evidence labels: `EXECUTED`, `OBSERVED`, `INFERRED`,
> `NOT RUN` (`docs/documentation.md` § Evidence Labels).
> **HEAD moved** to `68f0dbb` (the `sched-1*` commits) before revision 3. Cited files changed since `d1ffd80`, so
> their line numbers here are those of `d1ffd80` unless the text says `68f0dbb`: `backend/src/tenant/settings.ts`,
> `docs/caching-architecture.md` (+58 lines after `:119`), `infra/lib/database.ts`, `packages/shared/src/index.ts`,
> `renderer/middleware.ts` (a booking branch was added), `renderer/src/lib/dynamo.ts`,
> `renderer/test/serving-contract/{contract.test.mjs,README.md}`, `docs/ROADMAP.md`, `docs/platform-decisions.md`.
> Each build slice reads its files again (the new middleware branch included) before it relies on a line.
> § 9.4 and the revision-3 parts of § 13 cite `68f0dbb`.
> **Revision 6 (ratification, 2026-11-22)** read again at `7618acc` (equal to `68f0dbb` for every code file; `7618acc`
> changed only this file and `docs/ROADMAP.md`): `renderer/middleware.ts`, `renderer/src/lib/booking-path.ts`,
> `renderer/src/lib/booking-text.ts`, `renderer/src/lib/tenant-directory.ts`, `packages/shared/src/language-packs/`,
> `admin/src/pages/Settings.tsx`, `renderer/test/serving-contract/{cm1-byte-identity.mjs,contract.test.mjs}`. The
> middleware and serving-test lines in § 3.4, § 5.2, § 7.1 and § 7.3, the comparator rules (§ 7.4) and the row
> counts of § 12 are at `7618acc`.

Status: **RATIFIED 2026-11-22** (human: LANG1-HTML-LANG, LANG1-LANG-SOURCE with the homepage rule, LANG1-DATA-SHAPES,
LANG1-OVERRIDES = A; LANG1-PACK-NOOP = **B**; LANG1-STALENESS-BOUND = A with the second edge flush; § 13,
Appendix D). **Next: `lang-1a`.**
Track: `lang` (the `locale` track is the neighbour and the base). Depends: `locale-1a`…`1e` (built);
LANG1-SCOPE = A (§ 2.1). Source plans: `docs/plan-site-move-satulbanului.md`, `docs/plan-courses-group-sessions.md`
§ 1 and § 5. Maturity target of the build slices: PROTOTYPE; MATURE after one live two-language site runs `lang-1c`.

This slice changes no code. The spike changed renderer code in the worktree to measure, and reverted it (§ 3.1).

**Scope.** The spike record (§ 3) and the specification of the build slices `lang-1a`…`1d` (§ 4–§ 12).
**Architectural boundaries.** Tenant isolation (§ 7.1, § 9.2: the `~` separator never comes from the wire); no
DynamoDB scan (§ 6.2); the dependency graph and the platform decisions PD-001…003 do not change (§ 14); the serving
contract changes as ruled by LANG1-HTML-LANG = A (§ 7.3).

**Base assumption (human, 2026-11-22).** galeriilevoicu.ro and satulbanului are the first sites with more than one
language. No existing site has more than one language, and no existing site uses German or French. The live sites
have one language, English or Romanian; every rule below keeps their output (§ 8, § 12).

**Purpose / risk retired.** The open point LANG1-HTML-LANG: can the root layout write the page's language
(`<html lang>`, the menu, the texts) while every page stays in the ISR cache and one-language sites stay
byte-identical? Answer, measured: one way works (W1, § 3); three ways do not.

## 1. The problem

AMODX gives a site one language. The setting is `locale` on the tenant (`packages/shared/src/index.ts:1243`),
and the direction recorded in `docs/slices/locale-1.md:22` is: "the language setting is per tenant". Everything a
visitor reads that is not page text — block chrome, shop texts, `<html lang>` — resolves from that one value
(`packages/shared/src/locale-strings.ts:67` `normalizeLocale`, `:87` `localeLanguageSubtag`, `:180`
`resolveLocaleStrings`; `renderer/src/app/[siteId]/layout.tsx:262` `<html lang>`).

Nothing joins a page to a language. `ContentItemSchema` (`index.ts:369-414`) and `RouteSchema` (`index.ts:248-256`)
have no language field. `git grep -n -i -E "hreflang|alternates\.languages|languages:" -- renderer/src
packages/*/src` gives no hit (EXECUTED 2026-11-21; deterministic text search). There is one menu and one footer
list per site (`navLinks`, `footerLinks`, `index.ts:1187-1188`).

What already works: an address may hold `/` (`packages/shared/src/slug.ts:27-34` keeps `/`), so
`/ro/room/maica-lina` is a valid page address today. A four-language site can be typed in as unrelated pages. What
it then gets wrong (OBSERVED in the spike control W0, § 3.2: a page at `/ro/despre` answers `<html lang="en">`):

- every page says the one tenant language to browsers, screen readers and search engines;
- no `hreflang`, so search engines see competing copies in place of one page in several languages;
- the menu, footer and block texts stay in one language on every page;
- the visitor has no language switch;
- language packs exist for EN and RO only (`packages/shared/src/language-packs/` holds `en.ts`, `ro.ts`;
  re-exported at `index.ts:17`).

Named tenants that need this: **satulbanului** (en, ro, de, fr) and **galeriilevoicu.ro** (ro, en;
`docs/plan-courses-group-sessions.md` § 1).

## 2. Decision LANG1-SCOPE (record)

The options as written in the draft (layout changed to fit 120 characters; text unchanged):

- **A. A page may state its language; the tenant language stays the default** (this specification).
  Reward: one site, one domain, the old addresses kept, correct `hreflang`. Sites with one language see no change.
  Risk: changes a ratified statement. Touches the root layout and the string resolution of every live tenant; four
  build slices; German and French packs must be written and kept complete as texts are added.
- **B. One tenant per language** (`ro.` / `de.` / `fr.` subdomains).
  Reward: no platform change apart from a cross-site `hreflang` list in settings.
  Risk: every old address changes host; four tenants to edit; shared photos uploaded four times; cross-tenant links
  are configuration that nothing checks.
- **C. Multi-language sites stay off AMODX** (static, as today).
  Reward: zero risk to live tenants.
  Risk: no online editing for such sites; the gap stays for the next multi-language client.

### 2.1 Ruling (human, 2026-11-20)

LANG1-SCOPE = **A**. Multi-language sites are mandatory: a second named client, galeriilevoicu.ro, has Romanian
and English (`docs/plan-courses-group-sessions.md` § 1). The condition of § 2 ("when a second multi-language
client is named") is met. Next step: the LANG1-HTML-LANG spike, then the review of § 3. For galeriilevoicu the
existing EN and RO packs are enough; `lang-1d` (German, French) is needed by satulbanului only.

## 3. Spike LANG1-HTML-LANG (2026-11-21)

### 3.1 Question and method

Question: how does the root layout (`renderer/src/app/[siteId]/layout.tsx`) write a correct `<html lang>` for a
page whose language differs from the tenant language, with the serving contract intact
(`docs/caching-architecture.md` § *Serving contract*; `renderer/middleware.ts`)?

Why it is hard: a Next layout receives only the parameters of its own segment and the segments above it. The root
layout is `app/[siteId]/layout.tsx` (`locale-1e`); it receives `{ siteId }` (`layout.tsx:105-108`), not the page
address. A request API (`headers()`, `cookies()`) in it makes every cacheable page fail (`layout.tsx:1-6`; measured
again here, way W4). The layout also renders the menu (`layout.tsx:352` `links={config.navLinks}`), the footer
links (`:233-236`) and the cookie texts (`:196`), so the same limit applies to every piece of chrome, not only to
`<html lang>`.

Method (EXECUTED for every way):

1. Edit renderer files in the worktree. No branch, no commit, no stash.
2. `cd renderer && npm run test:serving` (126 rows at `d1ffd80`). The suite deletes `.next`, runs `next build` and
   `next start` (Next 16.4.6) under a constructed environment with a local DynamoDB stub, no AWS
   (`renderer/test/serving-contract/README.md` § *How it runs*, § *Credential-free*).
3. A probe script outside the repo (`/tmp/LANG-1-spike/probe.mjs`, deleted at the end) reuses the suite's own
   harness (`startStubs`, `buildRenderer`, `rendererEnv`, `request`) and adds two tenants to the stub:
   - `lang-spike-multi`: `languages: ["ro"]`, a Romanian menu, pages `/`, `/about`, `/ro`, `/ro/despre`;
   - `lang-spike-mono` (control, one language): pages `/about` and `/ro/x`.
   It prints the build's route table, requests each address twice (status, `cache-control`, `x-nextjs-cache`,
   `<html lang>`, which menu), one twin request (`?x=1`), one preview request, lists the stored ISR files, then
   calls `POST /api/revalidate` (`{ domain, slug }`, the body the backend sends) and requests the address again.
4. Revert: `git checkout -- <path>` per file, delete new files; `git status --short --untracked-files=all` was empty
   after each way.

Under `next start` the ISR store is `.next/server/route-cache/APP_PAGE/<hash>/$/<host>/<path>.{html,meta,rsc}`
(OBSERVED) — the same key layout as the S3 purge (`renderer/src/app/api/revalidate/route.ts:35-38`).

### 3.2 Results

Ways: W0 = HEAD (control). W1 = the language in the rewritten first segment (`/<host>~ro/ro/despre`). W2 = a route
group per language (`app/[siteId]/(ro)/`). W3 = tenant language on `<html>`, page language on `<main>`. W4 (found,
smaller in code) = the language in a request header, `headers()` in the layout.

| Way | Build | `test:serving`, 126 rows | Cached per address | `<html lang>`, `/ro/despre` | Menu follows |
|---|---|---|---|---|---|
| W0 | ok | 126 pass | yes | `en` (the defect) | no |
| W1 | ok | 125 pass, `(c)` fails; 126 with the gate rule widened | yes | `ro` | yes |
| W2 | ok, no error | 118 pass, 8 fail | yes | `en`; `ro` wrapper on all pages | no |
| W3 | ok | 126 pass | yes | `en`; `<main lang="ro">` | no |
| W4 | ok | 45 pass, 81 fail | **no**: every page 500 | twin only: `ro` | — |

"Cached per address" evidence, for each way that caches (OBSERVED): the build's route table keeps
`● /[siteId]/[[...slug]]` (SSG/ISR) and `ƒ /[siteId]/_dyn/[[...slug]]`; `.next/prerender-manifest.json`
`dynamicRoutes` holds `/[siteId]/[[...slug]]`; each address answers `200`, `cache-control: s-maxage=31536000`,
`x-nextjs-cache: MISS` then `HIT`; one ISR file per address. The twin (`?x=1`) answers
`private, no-cache, no-store, max-age=0, must-revalidate` in every way.

### 3.3 Each way

**W0 — HEAD (control).** All six probe addresses: `200`, `s-maxage=31536000`, MISS → HIT, `<html lang="en">`,
including `/ro` and `/ro/despre`. After the purge call each address is a MISS.

**W1 — the language in the rewritten first segment.** Spike edits (9 files: 8 changed, 1 new):
`renderer/src/lib/tenant-directory.ts`
(the host gate query projects `languages` in place of `Select: "COUNT"`); `renderer/middleware.ts` (production
branch: segment `<host>~<first>` when `first` is one of the tenant's languages and the path is not a route handler);
new `renderer/src/lib/site-segment.ts` (`parseSiteSegment`); `layout.tsx` (tenant by host, `<html lang>`, Romanian
menu); both catch-all `page.tsx` files (pass the host); `renderer/src/lib/dynamo.ts` (`mapTenant` passes the new
fields); `renderer/src/app/api/revalidate/route.ts` (W1b); `renderer/test/serving-contract/ddb-stub.mjs` (W1c).

- OBSERVED: `/ro` and `/ro/despre` → `<html lang="ro">`, Romanian menu, `200`, `s-maxage=31536000`, MISS → HIT.
  Stored as `…/$/lang-spike-multi.serving-contract.test~ro/ro/despre.html` and `…~ro/ro.html`.
- OBSERVED: `/`, `/about` of the same tenant and the control's `/ro/x` → `<html lang="en">`, default menu; the
  control's key stays `…/$/lang-spike-mono.serving-contract.test/ro/x.html`.
- OBSERVED: the twin (`/ro/despre?x=1`) → `<html lang="ro">`, no-store.
- OBSERVED: preview `/_site/lang-spike-multi/ro/despre` → `<html lang="en">` (the spike had no preview rule; § 7.1
  adds one).
- OBSERVED: with the purge route unchanged, `POST /api/revalidate {slug: "/ro/despre"}` leaves `/ro/despre` a
  **HIT** (the purge names `/<domain>/ro/despre`, the entry is under `<domain>~ro`). W1b adds
  `revalidatePath("/<domain>~ro/ro/despre")` and the `~ro` layout: the next request is a MISS.
- OBSERVED: the RSC payload of the page holds the segment value (`"n":"siteId","t":"d","k":"<host>~ro"`).
- OBSERVED: a bare `RSC: 1` request answers `307` to `?_rsc` on `/about` too (control), so it is Next's
  cache-busting rule, not an effect of W1.
- EXECUTED W1b suite: 125 pass, 1 fail: `(c) unknown host … without rendering` — `render` was 1. The stub counts a
  read as the host gate only when it is a `Select: "COUNT"` query on `GSI_Domain`
  (`renderer/test/serving-contract/ddb-stub.mjs:187-191`); the projected gate query counted as a render.
- EXECUTED W1c (stub classifies the projected gate query as the gate): **126 / 126 pass**, every byte-identity row
  included (`cm1-identity-*`, `loc1-*`, `loc1e-*`, `cq1-*`, `ct1-*`, `sl1*`, `hc1-*`, `bpf1-*`, `cc1-*`).

**W2 — a route group per language.** Spike: `app/[siteId]/(ro)/layout.tsx` (a `<div lang="ro">` wrapper) and a copy
of the catch-all page in `(ro)`. OBSERVED: `next build` gives **no error**; the route table is unchanged; Next serves
every address of every tenant through `(ro)` (the English home and the one-language control got the `ro`
wrapper). A route group adds no address segment, so it cannot be chosen by tenant data. EXECUTED suite: 118 pass,
8 fail: `cm1-identity-commerce`, `cm1-identity-content`, `cq1-bars-own`, `cq1-quote-channels`, `ct1-footer-width`,
`loc1-diff-cdl-2`, `loc1-flight-controls`, `loc1e-category-controls` (also in Appendix A). Cannot work.

**W3 — tenant language on `<html>`, page language on `<main>`.** Spike: `SitePage.tsx:690` `<main>` gets `lang` from
the page item by a conditional spread. OBSERVED: `<html lang="en">` + `<main lang="ro">`; keys and purge unchanged.
EXECUTED suite: 126 pass. It caches, but `<html lang>` stays wrong — the defect this slice exists to remove — and
the layout's menu, footer and cookie texts cannot follow the page. Fails the slice goal.

**W4 — request header + `headers()` (smaller in code than W1).** Spike: the middleware rewrites with
`x-amodx-page-lang: ro`; the layout reads `(await headers()).get(…)`. OBSERVED: the build keeps `●` for the route,
but at run time every cacheable page answers `500`, `private, no-cache, no-store, max-age=0, must-revalidate`, and
nothing is stored; only the twin renders. EXECUTED suite: 45 pass, 81 fail (`a1`, `a2`, `c1`, `d1`, `d3`, `e1`,
`e2`, `h1*`, `p1`, every `cm1-identity-*`, `loc1-text-*` and `loc1-ro-*` row, …; of the `loc1*` rows only
`loc1-subjects` and `loc1e-404-document` pass; all 81 names: Appendix A). Cannot work: a request API in an ISR
route is a 500 (`docs/caching-architecture.md` § *Measured serving behaviour*).

**Considered, not built (INFERRED).** W5 — a separate dynamic segment `app/[siteId]/[lang]/…` with the root layout
there: every route directory moves and the middleware writes a language segment for every tenant, so every ISR
key and every purge path of every live tenant changes; larger than W1 and not a no-op for one-language sites.
W6 — move the menu and footer into the page: leaves `<html lang>` wrong (as W3) and moves the chrome of every page
type (content, product, category, cart).

### 3.4 Purge and cache-key sites

Search (EXECUTED; a text search is a subset until each hit is read — every hit below was read):
`git grep -n -E "revalidatePath|revalidateTag|api/revalidate|unstable_cache|cacheTag"` and
`git grep -n -E "ListObjectsV2|DeleteObjects|CreateInvalidation"` over `backend/src`, `renderer/src`,
`renderer/middleware.ts`, `packages/*/src`, `infra/lib`, `tools/mcp-server/src`.

Sites that build a cache key or a purge path from the host or the first segment (`route.ts` =
`renderer/src/app/api/revalidate/route.ts`):

- `renderer/middleware.ts:295-298` at `d1ffd80` (`:337-341` at `7618acc`) — the rewrite `/<host><path>` or
  `/<host>/_dyn<path>`, which is the ISR key. Under W1: `<host>~<lang>` for listed prefixes. The booking rewrite
  `/_book/<host><rest>` (`:149-157`, branch A3, since `68f0dbb`) is never stored and gets no suffix (§ 7.1).
- `route.ts:174` — `revalidatePath("/<domain><slug>")`. Under W1: misses `~` entries (OBSERVED). Fix: § 9.2.
- `route.ts:177` — `revalidatePath("/<domain>", "layout")`. Under W1: misses `~` entries (INFERRED from the tag
  form). Fix: § 9.2.
- `route.ts:84-117` — S3 keys `<base>/…` and `<base>.cache`, base `…$/<domain>`. Under W1: misses `<domain>~ro…`
  (INFERRED from the code; NOT RUN against S3). Fix: § 9.2.
- `route.ts:164` — the domain check (a dot, no `/`). Under W1: add "no `~`".
- `backend/src/lib/revalidate-paths.ts:97-120` — `{ domain, slug }` with the public slug. Unchanged.
- `backend/src/lib/revalidate.ts:74-110`, `:190-196` — POST `{ domain, slug }` to the route. Unchanged.
- `backend/src/scheduled/debounce-flush.ts:126-137` — CloudFront paths = public paths. Unchanged.
- `backend/src/system/invalidation.ts:102-108` — CloudFront `/*`. Unchanged.
- `backend/src/scheduled/nightly-cache-flush.ts:112-130` — every S3 object under `_cache/`. Unchanged; covers `~`.

### 3.5 Chosen way

**W1** (LANG1-HTML-LANG = A, ratified 2026-11-22, § 13). Reasons: the only way that gives a correct `<html lang>` and
lets the menu and texts follow the page while every page stays cached per address; for a tenant without
`languages` the rewrite, the key and the bytes are unchanged (OBSERVED control, 126/126). Rejected: W2 (a group
cannot be chosen by data; silent capture of every address), W3 (the defect stays), W4 (500 on every cacheable
page), W5 and W6 (larger; not a no-op for one-language sites).

## 4. Design rule

Rule (LANG1-LANG-SOURCE = A, ratified 2026-11-22, § 13): **the address states the language.**

- The tenant has one **default language**: the language subtag of its `locale` (`localeLanguageSubtag`, today's
  rule). Its pages have no language prefix.
- The tenant may add **extra languages** (`languages`). A page whose address starts with `/<l>` or `/<l>/`, where
  `<l>` is in `languages`, is in language `<l>`. Every other address is in the default language.
- Pages that are the same page in different languages share a **`translationKey`**.

Assumption (INFERRED, to confirm with each client before import): satulbanului keeps English at the root and
`/ro`, `/de`, `/fr` prefixes (the draft's `/ro/room/maica-lina`); galeriilevoicu keeps Romanian at the root and
`/en`. Other old addresses are moved by `redirect-1`.

Request flow (W1):

```
Host: x.ro   GET /ro/despre
middleware   gate read (GSI_Domain, cached 60 s) → wired; default en (locale en-US); languages ["ro"]
             "ro" is in languages → rewrite /x.ro~ro/ro/despre       otherwise /x.ro/ro/despre (today)
layout       [siteId] = "x.ro~ro" → tenant x.ro, page language ro → <html lang="ro">, menu ro, texts ro
page         [[...slug]] = [ro, despre] → SitePage(host x.ro) → ROUTE#/ro/despre
ISR key      …/$/x.ro~ro/ro/despre          CloudFront key: Host x.ro + /ro/despre (unchanged)
```

## 5. Data model (`packages/shared`)

New optional fields; all absent = today's behaviour.

```ts
// TenantConfigSchema (index.ts, next to locale :1243 and navLinks :1187)
languages: z.array(z.string()).optional(),                          // extra language subtags
navLinksByLang: z.record(z.string(), z.array(LinkSchema)).optional(),  // LinkSchema = index.ts:67-74
footerLinksByLang: z.record(z.string(), z.array(LinkSchema)).optional(),

// ContentItemSchema (index.ts:369-414) — written only by the backend
translationKey: z.string().optional(),   // the set id: a random UUID made when two pages are first linked

// Content API input only (POST /content, PUT /content/{id}) — never stored
translationOf: z.string().nullable().optional(),  // nodeId of a page whose set to join; null = leave the set

// packages/shared/src/languages.ts (new, pure, imports nothing)
type PageLanguage = { kind: "default" } | { kind: "extra"; subtag: string };
type LanguageSettings = { languages: string[]; navLinksByLang: Record<string, Link[]>;
    footerLinksByLang: Record<string, Link[]> };
function readLanguageSettings(raw: unknown): LanguageSettings;       // the one READ rule (§ 5.1); never throws
function pageLanguageOf(slug: string, languages: readonly string[]): PageLanguage;

// packages/shared/src/index.ts (next to the tenant schema; it uses normalizeLocale and LinkSchema, so it stays out
// of the import-free module above, which the middleware loads)
function languageSettingsProblem(input: { languages?: unknown; locale?: unknown; urlPrefixes?: unknown;
    navLinksByLang?: unknown; footerLinksByLang?: unknown; homePageSlug?: unknown }): string | null;
    // WRITE rule, called with the MERGED settings (stored item + request body); null = valid
```

`pageLanguageOf`: the first segment of `slug` (`"/ro/x"` → `"ro"`, `"/ro"` → `"ro"`, `"/"` → none) is an extra
language when it is in `languages`; else `{ kind: "default" }`. Exhaustive `switch` on `kind` at every reader.
A page's language is always derived at read time from its **current** address and the tenant's **current**
language list. No item stores a language.

### 5.1 Read rule — `readLanguageSettings` (one function, every reader)

Input: a **plain** record (DocumentClient form: strings, arrays, objects) with the stored `languages`,
`navLinksByLang` and `footerLinksByLang`. Output: `LanguageSettings`. It never throws; it drops what is invalid:

- `languages`: not an array → `[]`. An entry is kept when it is a string matching `/^[a-z]{2,3}$/` and is not
  already kept (first one wins). The function takes no `locale` and does not decide what the default language is.
- `navLinksByLang`, `footerLinksByLang`: not a plain object → `{}`. A key is kept when it is in the kept
  `languages` and its value is an array. In that array an entry is kept when it is a plain object whose `label`
  and `href` are strings; its `children` are kept only as an array of such objects (other children dropped; a
  `children` that is not an array is removed). An array whose entries are all dropped stays as `[]`.
- Legacy `navLinks` and `footerLinks` are not read by this function and stay as they are (`mapTenant`, today).

**The default language** keeps one meaning everywhere: `localeLanguageSubtag(locale)` — the normalized-locale
contract of `locale-strings.ts:80-89` (an absent or malformed `locale` gives `en`). The parser does not
reimplement it. A stored list that names the default subtag (refused at write by V3, so only a direct table edit
makes it) is read the same way by every reader: pages under `/<that subtag>/` are pages of an extra language whose
`hreflang` value equals the default's; the same-language rule of § 5.3 compares `hreflang` values, so such a
member and the default-language member are both left out.

**The input boundary.** `mapTenant` (§ 7.2) receives DocumentClient items, which are already plain. The middleware's
gate (§ 7.1) uses the low-level client (`tenant-directory.ts:21`, `QueryCommand` of `@aws-sdk/client-dynamodb`),
whose items are AttributeValues (`{ "languages": { "L": [ { "S": "ro" } ] } }`). The gate converts its projected
attributes to the plain form **before** it calls the parser, by the DocumentClient mapping for every shape the
parser can keep: `S` → string, `L` → array (each element converted the same way), `M` → object; every other type
(`N`, `BOOL`, `NULL`, `SS`, …) → `null`, which the parser drops exactly as it drops the number, boolean, null or
`Set` that the DocumentClient would give. So both readers reach the same `LanguageSettings` for the same stored
item. Rows: `L1B-GATE-ATTRIBUTE-SHAPE` (the real projected response shapes — `L` of `S`, `L` with `N` and `NULL`
elements, a bare `S`, an `M`, an absent attribute — converted by the gate, and the same items unmarshalled by
`@aws-sdk/util-dynamodb`, give equal parser output) and `L1B-LANG-AGREEMENT` (the middleware's segment decision
equals `pageLanguageOf` over `mapTenant` output on a table of malformed inputs).

Callers: the middleware (§ 7.1) and `mapTenant` (§ 7.2).

### 5.2 Write rules

`PUT /settings`, `languageSettingsProblem` on the merged settings (the handler's `merged`,
`backend/src/tenant/settings.ts:323` at `7618acc`); each refusal is a `400` that names the field:

- **V1** `languages` is an array; each entry is a bare language subtag: `/^[a-z]{2,3}$/` and
  `normalizeLocale(e) === e` (the runtime can format it; `locale-strings.ts:67-78`). The internal first segments
  `_booking`, `_book`, `_site`, `_dyn` cannot pass V1 (`_` is not in `[a-z]`).
- **V2** No entry twice.
- **V3** No entry equals the default subtag (`localeLanguageSubtag(locale)`, checked against the locale being saved).
- **V4** No entry equals the first segment of one of the tenant's URL prefixes (`urlPrefixesOf`), nor `api` (the
  middleware never rewrites `/api`, `middleware.ts:196-205` at `7618acc`).
- **V5** Every key of `navLinksByLang` and `footerLinksByLang` is in `languages`; each value is an array that
  `LinkSchema` accepts.
- **V6** (homepage rule, LANG1-LANG-SOURCE = A) When `languages` is not empty and `homePageSlug` is a non-empty
  string, `pageLanguageOf(homePageSlug, languages)` is `{ kind: "default" }`; else `400` naming `homePageSlug`.
  Why: the page named by `homePageSlug` is served at `/` (`SitePage.tsx:303`, `:547`), and `/` is a
  default-language address; an extra-language page there would get default-language chrome and be advertised as
  that language's alternate. Because the check runs on the merged settings, it refuses both a new `homePageSlug`
  under a listed prefix and a new language whose prefix holds the stored `homePageSlug`. A tenant without
  `languages` is not checked (all its pages are in the default language).

Content rules (backend `content/create.ts`, `content/update.ts`):

- **C1** `translationKey` is never accepted as input; the backend writes it. A new set gets a new random UUID
  (`crypto.randomUUID()`), never a page's `nodeId`; a set id is never used again for another set.
- **C2** `translationOf` is refused (`400`) when the tenant has no `languages`, when it names no page of this
  tenant, or when it names the page itself.
- **C3** "Translation of" a page whose set already has a page in this page's language (derived now), or a page in
  the same language, is refused (`409`). The admin picker hides such targets (§ 10); the backend repeats the check
  because MCP writes have no picker. The check reads before it writes, so two concurrent requests can still both
  pass; the reader rule (§ 6.2) then lists neither page for that language.

### 5.3 Rule for every combination

- **A page under a language prefix, no `translationKey`.** Allowed. Served in its language; no `hreflang`; the
  switch links to the language homes.
- **Two members of one set with the same derived language** — compared by their `hreflang` value (§ 8.4), so a
  default-language member and an extra member named like the default subtag also collide (by a race, a
  language-list change, or a later address change). The reader lists **neither** of them for that language;
  every other language of the set is listed as usual; if that language is the default, `x-default` is also left
  out. Rows `lang1c-same-language-pair`,
  `lang1c-language-removed`.
- **A language not in the tenant list.** Cannot be stated: the language comes from the prefix. `/xx/…` with `xx`
  not listed is a default-language page.
- **A language removed while pages hold it.** Allowed; no write to any page or membership item. Pages under
  `/<l>/` now derive the default language: they serve with default `<html lang>`, menu and texts. In a set that
  also has a default-language page, two members now derive the default language → neither is listed for it
  (rule above). Adding the language again restores the earlier alternates, again with no write. The settings save
  purges the whole tenant (§ 9.3). Rows `lang1c-language-removed`, `lang1c-language-readded`.
- **A language added while default-language pages sit under that prefix.** Allowed. Those pages become pages of
  the new language (the address rule); the Languages card help text says so.
- **`translationKey` stored, tenant now without `languages`.** A new link is refused (C2); a stored key is kept.
  The renderer reads sets only when `languages` is not empty.
- **A set with one member left.** No cleanup: one member gives no alternates.
- **The default `locale` changed to a subtag in `languages`.** Refused (V3).
- **`homePageSlug` names a page under a listed prefix.** Refused at write (V6), also when the language is added
  later. Only a direct table edit makes it. The reader then advertises that page at its own address, never at `/`
  (§ 8.4, § 8.5). Row `lang1c-hreflang-home`.

## 6. Storage

### 6.1 The `TRANSLATION#` membership item

```
PK   = TENANT#<tenantId>
SK   = TRANSLATION#<translationKey>#<nodeId>       one item per member page
Type = "Translation"
```

The item says only "page `<nodeId>` was put in set `<translationKey>`". It holds no language, no slug and no status:
the reader takes the address and the status from the page, and derives the language. A language-list change, an
address change and a restore therefore need no membership write.

An item can outlive its truth: for example a whole-item write by the WordPress importer that lost the race against
a link (§ 6.3). Such an item is never trusted alone: the reader takes a member only when the page's **current**
`translationKey` equals the key (§ 6.2). Orphan items are inert (§ 15 debt).

### 6.2 Reads (no scan) — one membership rule for the head and the sitemap

**Membership rule** (the only one; the head, the sitemap and the admin set display all apply it). Page `<n>` is a
**member** of set `K` when all of these hold:

1. a membership item `TRANSLATION#K#<n>` exists;
2. `CONTENT#<n>#LATEST` exists, its `status` is `Published`, and its `slug` is a string;
3. that LATEST's current `translationKey` equals `K`.

A member's language is `pageLanguageOf(slug, settings.languages)`; its `hreflang` value is the subtag (§ 8.4).
Then the same-language rule of § 5.3 gives the **listed** members. A page that holds the key but has no item
(condition 1 fails) is listed nowhere — not in the head, not in the sitemap. An item whose page now holds another
key, or none (condition 3 fails), is ignored everywhere. Sets are read only when `settings.languages` is not empty.

Reads:

- **Page metadata** (`hreflang`, § 8.4), only when the page has a `translationKey`: `Query PK = TENANT#<t> AND
  begins_with(SK, "TRANSLATION#<key>#")`, paginated on `LastEvaluatedKey`. The `nodeId` is the SK text after the
  second `#`; an SK without it is skipped. Then one `GetCommand` per item on `CONTENT#<nodeId>#LATEST`,
  `ProjectionExpression: slug, #s, translationKey` (in parallel; the pattern of `getActiveCategoriesByIds`,
  `renderer/src/lib/dynamo.ts:351`).
- **Sitemap** (§ 8.5): one `Query PK = TENANT#<t> AND begins_with(SK, "TRANSLATION#")`, paginated, gives every
  (key, node) item of the tenant. `getPublishedContent` (`dynamo.ts:719-746`) adds `nodeId` and `translationKey` to
  its `ProjectionExpression` (`:737`) and to the objects it returns (`:748-756`); today it returns neither (`id`
  there is the content id, not the node id). The join applies conditions 1–3 in memory. Pages without a key, and
  every existing returned field, are unchanged.

Row `lang1c-set-missing-item` checks that a keyed page without its item is absent from the head of its siblings
**and** from the sitemap; row `lang1c-member-not-owner` checks the same for condition 3.

### 6.3 Writers of content items

How the list was made (EXECUTED): `git grep -n -E "(SK|Key).*(CONTENT#|ROUTE#)|\`CONTENT#|\`ROUTE#"` over
`backend/src`, `tools/mcp-server/src`, `renderer/src`, `packages`; `git grep -n -E
"PutCommand|UpdateCommand|TransactWriteCommand|DeleteCommand"` over `backend/src/content`, `backend/src/import`,
`backend/src/tenant/create.ts`; the API routes `infra/lib/api.ts:163-192`. A text search is a subset until read:
every hit was read. The renderer only reads (`dynamo.ts:197`, `:209`).

**One rule for every writer of a page item:** a writer that replaces the whole page item (`Put`) or changes its
`translationKey` puts a condition on the key it read: `translationKey = :read`, or
`attribute_not_exists(translationKey)` when it read none. A writer that only `SET`s other attributes (today's
`update.ts:134` expression) cannot change the key and needs no condition. A failed condition cancels the
transaction; the API answers `409` ("the page changed; load it again").

**The link transaction** (create or update with `translationOf = P`, for page Q). The writer reads Q's key `kq`
(none on create) and P's LATEST with its key `kp`, then:

1. `kp` present and `kq === kp` → the page is already in that set: **no-op** (no membership action; the rest of
   the update runs as today).
2. Else `K = kp ?? crypto.randomUUID()`. One transaction, one action per item:
   - Q LATEST: the normal create `Put` or update `Update`, plus `translationKey = K`, conditioned on `kq` (rule
     above);
   - `kq` present → `Delete TRANSLATION#kq#<Q>`;
   - `Put TRANSLATION#K#<Q>`;
   - P LATEST: `kp` present → `ConditionCheck translationKey = :kp`; `kp` absent → `Update SET translationKey = :K`
     with `attribute_not_exists(translationKey)`;
   - `kp` absent → `Put TRANSLATION#K#<P>`.
   Plus today's items (snapshot, routes). All keys differ, so no item gets two actions (`kq !== K` always: case 1
   took `kq === kp`, and a new `K` is fresh).

**Leave** (`translationOf: null`): `kq` absent → no-op. Else Q LATEST `REMOVE translationKey` conditioned on `kq`,
and `Delete TRANSLATION#kq#<Q>`, in the same transaction as the update.

Each writer:

- **Create**, `backend/src/content/create.ts:68-127`. Today: one transaction, `Put CONTENT#…#LATEST` + conditional
  `Put ROUTE#<slug>`. Rule: with `translationOf`, the link transaction (C2, C3 first).
- **Update**, `backend/src/content/update.ts:73-199`. Today: one transaction, snapshot + `Update` LATEST (+ old
  route → redirect, conditional new route). Rule: with `translationOf`, the link transaction or leave. An address
  change alone writes no membership item (the language is derived). The snapshot keeps the key it had (history).
- **Archive.** No delete exists (`infra/lib/api.ts:163-192` has no `DELETE /content`); a page is archived by `PUT`
  with `status: "Archived"`. Rule: nothing more; an Archived member does not count (§ 6.2).
- **Restore**, `backend/src/content/restore.ts:46-63`. Today: `Put` LATEST = the history item, which also writes
  the history item's `slug` without moving any `ROUTE#` item (`:60-63`). Rule (operator ruling
  LANG1-RESTORE-SCOPE = A — the rule stops at the multi-language boundary, a `translationKey` on the page):
  - **The current LATEST has a `translationKey`.** The restored LATEST keeps the **current** `slug` and the
    **current** `translationKey`; the `Put` is conditioned on both as read: `slug = :readSlug AND translationKey =
    :readKey`. A concurrent rename (which changes `slug`, not the key) therefore fails the restore with `409`
    instead of writing the old address back. Effect: a restore cannot change a member's derived language or move
    it out of its set, so it cannot make a same-language collision. Rows `L1A-RESTORE-KEEPS-KEY-SLUG`,
    `L1A-RESTORE-VS-RENAME`, `L1A-RESTORE-THEN-EDIT`.
  - **The current LATEST has no `translationKey`.** Exactly today's restore: the history item's fields, its `slug`
    included, no route moved, plus one guard: the restored item takes no `translationKey` from the history item
    (HEAD's history items have no such field) and the `Put` is conditioned on `attribute_not_exists(translationKey)`
    (the general rule above). On a tenant without `languages` no page can hold a key (C2), so the condition always
    holds and the result is HEAD's, byte for byte in the stored item. Row `L1A-RESTORE-NO-KEY-AS-HEAD` (the stored
    item equals HEAD's for the same history, including a history `slug` that differs from the served address).
  - **Narrowed claim.** The keyed rule keeps a member's address as it is; it does not repair a record that an
    earlier restore already made inconsistent (a LATEST `slug` that no route serves). That condition stays, at
    HEAD and after `lang-1a`, as finding F-LANG-RESTORE-SLUG (§ 15).
- **WordPress import**, `backend/src/import/wordpress.ts:248-279`. Today: `Put` LATEST (the whole item) + `Put`
  ROUTE, no condition. Rule: it writes no new key; when it overwrites an existing page it copies the existing
  `translationKey` (`findContentBySlug`, `:15-49`, already reads that item; add the attribute) and conditions the
  `Put` on it. A failed condition is reported for that post like any other failed post.
- **Tenant create**, `backend/src/tenant/create.ts:68-143`. Today: seeds `/` and `/contact`. Rule: no change (a
  new tenant has no `languages`).
- **MCP**, `tools/mcp-server/src/index.ts:888-944` (`update_page`), `:1021-1042` (`create_page`), `:1065`
  (`restore_page_version`). Today: calls the backend API only. Rule: a `translation_of` parameter →
  `translationOf`; no table write.
- **Settings** (`backend/src/tenant/settings.ts`, `PUT /settings`): a language-list change writes no page and no
  membership item.

Grants: the create, update and restore functions already hold `grantReadWriteData`
(`infra/lib/api-catalog.ts:132`, `:155`, `:172`); the renderer holds `grantReadData`
(`infra/lib/renderer-hosting.ts:272`). No infra change.

## 7. Serving (`lang-1b`)

### 7.1 Middleware (`renderer/middleware.ts`)

Lines in § 7.1 are at `7618acc` (the file is the same as at `68f0dbb`). **Order of the branches today:** 0 origin
check (`:170-179`); A internals `/_next`, `/api`, `/static` → pass through (`:196-205`); A2 `/_dyn` → 404
(`:210-212`); A2b leaked twin `/<id>/_dyn/…` → `308` (`:227-232`); **A3 booking** (`:234-259`, since `68f0dbb`); the
twin decision (`:263-266`); B by id `/tenant/` (`:269-289`) and `/_site/` (`:290-319`); the production branch
(`:320-342`: gate `:333-335`, rewrite `:337-341`).

**Where the language rules sit.** `lang-1b` adds two rules, both **after A3**: the `~` refusal (below) directly
after A3, and the language segment inside the by-id branches and the production branch. A3 changes only in its
gate call (`:250`, verdict type below): `unwired` → `notFoundResponse()` as today; `wired` (its language list is not
read) and `unknown` → the booking rewrite with the plain host, as today. Therefore:

- `/_booking…` (tenant host) and `/_site/<id>/_booking…` (preview host) are **not language paths**. A3 answers them
  before any language rule; they never get a `~` suffix; the booking tree `app/%5Fbook/[siteId]/` never parses `~`.
  The booking pages keep their own language rule: `?lang=` when a pack exists for it, else the tenant locale's
  language, else English (`renderer/src/lib/booking-text.ts:19-29`; `sched-1.md` § 10.1).
- `/<l>/_booking` is not a booking address (`booking-path.ts:64` needs the raw path to start with `/_booking`); it
  takes the production branch as an ordinary path of language `<l>`, as it does today without the suffix.
- The 13 `sched1g-*` rows (of the 139 serving rows at `7618acc`, § 7.4) keep their answers: the A3 rows do not depend on
  the language rules, and `sched1g-preserve` (near-miss paths, the unknown-host gate) and `sched1g-g2` (by-id gates) are
  in the proof of `lang-1b`.

Local choice, recorded: the `~` refusal sits after A3, not before it, so A3's answers stay byte for byte as at
`68f0dbb`. A3 then treats a `~` host on `/_booking` as it treats any host today (`:250-253`): a gate lookup that
succeeds and finds no tenant (`unwired`; no tenant domain holds `~`, F-LANG-TILDE) → `404`; an `unknown` verdict
(no table, no credentials, or a failed read) → the booking rewrite, fail open, as at `68f0dbb`. The booking tree
never parses `~`, so that rewrite binds no language and no other tenant.

- **Host gate read** (`renderer/src/lib/tenant-directory.ts:81-110`): the same `GSI_Domain` query, with
  `ProjectionExpression: "SK, #l"` (`#l` = `languages`) in place of `Select: "COUNT"` (`:100`). The index projects
  all attributes (`infra/lib/database.ts:27-31`, no projection given; INFERRED from the CDK default). `SK` keeps a
  tenant without `languages` from coming back as an empty item (INFERRED from DynamoDB projection rules; the stub
  ignores projections, `README.md` § *Deliberate limits*). The gate converts the projected AttributeValues to the
  plain form (§ 5.1, the input boundary) and then calls `readLanguageSettings`, the same function `mapTenant`
  uses. The verdict is cached 60 s as today (`:31`).
  Result type: `HostVerdict = { kind: "unknown" } | { kind: "unwired" } | { kind: "wired"; languages: readonly
  string[] }`. `isWiredTenantHost` is replaced at its two call sites — `middleware.ts:250` (A3, booking) and
  `:333` (production) — and in its unit tests (`renderer/test/unit/tenant-directory.test.ts`); the doc
  `renderer/ARCHITECTURE.md:756` names it and changes with it (`git grep -n isWiredTenantHost`, EXECUTED at
  `7618acc`, deterministic text search; every hit read).
- **Production branch** (`:320-342`), by verdict (exhaustive `switch`):
  - `unwired` → `notFoundResponse()`, as today (`:333-335`).
  - `wired` → segment = `<host>~<first>` when `first` (= `path.split("/")[1]`) is in its `languages` and the path
    is not a route handler (`SITE_ROUTE_HANDLERS`, `:125`); else `<host>`. The ISR rewrite and the twin rewrite
    both use the segment.
  - `unknown` (no table, no credentials, or the read failed — today "fail open", `:326-332`): a path whose `first`
    matches `/^[a-z]{2,3}$/` and is not a route handler is rewritten to the **twin** with the segment
    `<host>~<first>` (no-store: never stored by either cache layer). The layout keeps the language only when the
    renderer's own tenant read lists it, so the page renders right in both cases. Every other path keeps today's
    unsuffixed fail-open rewrite: it cannot be an extra-language page. So a gate failure can never put an
    extra-language page into a cache with default-language chrome. Cost: during a gate failure, language-shaped
    paths of every tenant render per request (no cache) — for a one-language tenant the HTML body is the same; the
    payload's segment value carries the suffix. Row `lang1b-gate-unknown` (needs a stub control that fails the
    gate read, `failHostGate(bool)`, added in `lang-1b`).
- **The separator cannot come from the wire**: after A3, a host that contains `~` → `notFoundResponse()` before the
  production gate (no DNS host name contains `~`). A by-id path (`/tenant/<id>`, `/_site/<id>`) whose id contains
  `~` → the same 404. Today ids and domains are not checked for `~` (`backend/src/tenant/create.ts:30`, `:37`); see
  F-LANG-TILDE (§ 15).
- **By-id branches** (`/tenant/` `:269-289`, `/_site/` `:290-319`; always the uncached twin): the id gets
  `~<first>` when `first` (the first segment after the id) matches `/^[a-z]{2,3}$/` (no tenant read). The layout
  keeps the language only when it is in the tenant's list, so a wrong guess renders the default language. These
  responses are never stored. `/_site/<id>/_booking…` never reaches this branch (A3).
- **Leaked twin addresses** (rule A2b, `:214-232`): a preview page hands the client router its rewritten path, so
  `/<id>~ro/_dyn/ro/x` can reach the address bar. A2b redirects it to `/_site/<id>/ro/x` — the id part before the
  first `~`; the language prefix is already in the rest of the path, so nothing is lost. Without this, the `~`
  refusal above would answer such an address 404. Row `lang1b-dyn-leak` (INFERRED need, from the A2b comment).

The middleware must not pull the whole shared package into the edge bundle (`tenant-directory.ts:11-13`). It imports
only the built module: `@amodx/shared/dist/languages.js`. This is a legal deep import because
`packages/shared/package.json` has no `exports` map (OBSERVED); the module imports nothing (§ 5), so the edge
bundle gets that file only (INFERRED; the `lang-1b` build confirms it from the middleware bundle). The middleware
segment rule (`languages.includes(first)`) is `pageLanguageOf` on the same parsed list; rows `lang1b-segment` and
`L1B-LANG-AGREEMENT` pin that they agree.

### 7.2 The segment, the layout, the pages

- `renderer/src/lib/site-segment.ts` (new): `parseSiteSegment(siteId) → { host: string; language?: string }`,
  split at the first `~`; and `localeInputFor(config, language)` (§ 8.2).
- `layout.tsx` `generateMetadata` (`:111-113`) and `SiteLayout` (`:155-157`): look the tenant up by `host`; keep
  `language` only when it is in `config.languages` (its own tenant read, which can lag, § 9.4); else the default
  language.
- `app/[siteId]/[[...slug]]/page.tsx:35`, `:40` and `app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:41`, `:46` pass
  `host` to `buildSitePageMetadata` / `SitePage` (each uses `siteId` only for `getTenantConfig`,
  `SitePage.tsx:242`, `:336`). The product pages and the four route handlers never receive a suffix (their first
  segment is `products` or a handler name): unchanged.
- **No page-level language guard** (human ruling LANG1-STALENESS-BOUND = A, 2026-11-22). The layout takes the
  page language from the segment (and keeps it only when its own tenant read lists it); the page does not compare
  the segment with its address, and no response is refused because the two disagree. During a change of the
  tenant's language list the segment and the reads can be older than the save; what that can store, and how it
  ends, is stated in § 9.4. (Revision 2 specified a mismatch guard here; review-2 showed it could not hold for
  the whole response — the root layout on the twin, and independent index reads — and the human chose to accept
  the window instead.)
- `renderer/src/lib/dynamo.ts` `mapTenant` (`:120-178`) is a whitelist: it adds the output of
  `readLanguageSettings(item)` (§ 5.1) — parsed `languages`, `navLinksByLang`, `footerLinksByLang`, invalid values
  dropped — and leaves every existing field, legacy `navLinks` / `footerLinks` included, as it is today. A tenant
  without the fields gets `languages: []` and empty maps on `config`; no reader output changes for it (§ 8).

### 7.3 Contract changes (LANG1-HTML-LANG = A, ratified 2026-11-22)

- `docs/caching-architecture.md` § *Serving contract*: a new row — an address under a listed language prefix is
  rewritten to `/<host>~<lang><path>` and stored under that key; every other address as today. And: with an
  unknown gate verdict, a language-shaped first segment goes to the twin (no-store), not to the ISR route.
  § *Booking pages* gets one sentence: `/_booking…` is answered before the language rules and never carries a `~`
  suffix (§ 7.1).
- Row `(c)` keeps its meaning ("the render never runs for an unwired host"). Its executable form changes: the stub
  identifies the gate by the new query shape (`ddb-stub.mjs:187-191`; it also counts A3's gate read, which takes
  the same shape), and the message "exactly one COUNT query" (`contract.test.mjs:696` at `7618acc`) becomes
  "exactly one host-gate read".
- `tenant-directory.ts:77-79` ("nothing is unmarshalled and no tenant data crosses into the edge layer"): the
  language list crosses (public data, a few subtags).

### 7.4 Serving rows and byte comparators at `7618acc` — rules for every build slice

- **Rows.** `cd renderer && npm run test:serving` at `7618acc`: **139 tests, 139 pass, 0 fail** (EXECUTED
  2026-11-22 for revision 6; `next` target, about 20 s). These are the 126 rows of the spike base and the 13
  `sched1g-*` rows of `sched-1g2`. Every build slice keeps all 139 and adds its own rows.
- **One listed comparator difference.** Since `sched-1g2` the root folder `app/%5Fbook` is a static sibling of
  `[siteId]`, so every page's payload holds `"s":["%5Fbook","api"]` in the root `siteId` descriptor where the
  committed baselines hold `["api"]`. The comparators accept exactly that item at that place
  (`renderer/test/serving-contract/cm1-byte-identity.mjs:259-292` `rootSiblingAllowance`, ruling
  SCHED-1G2-ROOT-SIBLING = A), inside `maskBody` (`:326`), which both comparator families run (`compareTenant`,
  `:410`; `locale-1/proof.mjs` `checkExpected`). Controls: row `sched1g-root-sibling-controls`.
- **Rules for `lang-1a`…`1d`:**
  1. Add no folder (route segment) directly under `renderer/src/app/`. A third static sibling of `[siteId]` changes
     the descriptor of every page, falls outside the allowance, and fails every identity row. `site-segment.ts`
     goes in `renderer/src/lib/`.
  2. Add no comparator allowance and change no committed baseline. A one-language page keeps `"k":"<host>"` in the
     descriptor, so the identity rows compare it unchanged.
  3. A language page carries `"k":"<host>~<l>"` (OBSERVED in W1). Such pages exist only in the new `lang1*`
     fixtures, which have no `before/` capture and are not added to the en-US subjects or to any captured fixture
     set, so no identity row sees them.
  4. The `sched1g-*` rows stay in every slice's proof without change (§ 7.1).

## 8. Output contract

> **§ 8 Ruling — forwarding note.** `docs/plan-site-move-satulbanului.md:40` cites "LANG-1 § 8" for the human
> ruling LANG1-SCOPE = A. That ruling is now in **§ 2.1**, word for word. § 8 below is the output contract.

For every rule: a tenant without `languages` gets today's bytes. The general proof is the serving suite's
byte-identity rows (`cm1-identity-*`, `loc1-text-*`, `loc1-ro-*`, `loc1e-*`, `cq1-*`, `ct1-*`, `sl1*`, `hc1-*`,
`bpf1-*`, `cc1-*`) on every build slice, plus the `locale-1e` staging identity proof on the en-US and ro-RO
staging sites. The spike shows the routing half already passes them (W1c, 126/126 at `d1ffd80`); at `7618acc` the
suite has 139 rows and the comparator rules of § 7.4.

### 8.1 `<html lang>` (`lang-1b`)

Rule: the page language subtag when the segment carries a listed language; else `localeLanguageSubtag(config.locale)`
(today, `layout.tsx:262`). The not-found branch (`:180`) is unchanged. One language: the segment never has a suffix
→ same attribute. Proof: `loc1e-html-lang` unchanged + new `lang1b-html-lang` (two-language fixture).

### 8.2 Texts by page language (`lang-1b`)

Rule: `resolveLocaleStrings(localeInputFor(config, language))`. `localeInputFor` returns `config` for the default
language, and `{ locale: language }` for an extra language: the pack of that language, without the tenant's
overrides (`siteStrings`, `catalogStrings`, `commerceStrings`, `gdpr.*`, `legalLinks` labels — written in the default
language; LANG1-OVERRIDES = A, ratified 2026-11-22). A language without a pack (de, fr before `lang-1d`) gets the
English pack (today's rule, `locale-strings.ts:92-96`). After `lang-1d` the `de` and `fr` packs are in the global
registry `LANGUAGE_PACKS` (LANG1-PACK-NOOP = B), so the same call selects them: no other selection path, no
parameter. galeriilevoicu (ro, en) needs no new pack. Call sites: `layout.tsx:124` (meta description), `:196` (chrome),
`SitePage.tsx:636` (block chrome of content pages). One language: `localeInputFor(config, undefined) === config` →
same texts. Proof: `loc1-text-*`, `loc1-ro-*` unchanged + `lang1b-texts`.

### 8.3 Menu and footer per language (`lang-1c`)

Rule: a page in extra language `l` uses `config.navLinksByLang[l]` when the key is there, else `navLinks`; the same
for `footerLinksByLang[l]` / `footerLinks`. The maps are the output of `readLanguageSettings` (§ 5.1), so every
entry has a string `label` and `href` before it reaches the consumers that dereference entries directly
(`Navbar.tsx:161-206`, `layout.tsx:236-237`); a stored value that is not an array never becomes a key, so that
language gets the default list. The default language uses `navLinks`, `footerLinks` (today, `layout.tsx:352`,
`:233-236`), not read through the parser. Footer `columns`, `brandText`, `header.tagline`, `topBar.content` and
`companyDetails` stay one per tenant (§ 15). One language: the maps are read only with an extra language → same
props. Proof: identity rows + `lang1c-menu`, `lang1c-menu-fallback`, `lang1c-menu-malformed-entries`
(`navLinksByLang.ro = [null, {"label": 1}, {"label": "Acasă", "href": "/ro"}]` → one link, no error).

### 8.4 `hreflang` and `x-default` (`lang-1c`)

Rule, in `buildSitePageMetadata` (`SitePage.tsx:241-326`), content pages only. Take the counting members of the
page's set (§ 6.2); leave out every `hreflang` value held by two or more of them (§ 5.3); the rest are the **listed**
members. When at least two members are listed, `alternates` becomes `{ canonical, languages }` with one entry per
listed member — `hreflang` = its derived language (`extra` → its subtag; `default` →
`localeLanguageSubtag(locale)`), `href` = `https://<domain><address>`, where the address is `/` for the member
whose slug equals `homePageSlug` **and** whose derived language is the default (the read-side guard of V6, § 5.2),
else its slug — plus `x-default` = the `href` of the listed default-language member, when there is one. Fewer than
two listed members → the metadata object is exactly today's (`alternates: { canonical }`, `:324`). One language: no
read, same object. Proof: identity rows (the `<head>` bytes) + `lang1c-hreflang`, `lang1c-hreflang-home`,
`lang1c-hreflang-member-invalid`, `lang1c-same-language-pair`.

### 8.5 Sitemap alternates (`lang-1c`)

Rule (`renderer/src/app/[siteId]/sitemap.xml/route.ts:30-67`): when `config.languages` is not empty, published pages
are joined with the tenant's membership items (§ 6.2, the same membership rule as the head); each `<url>` of a
listed member gets one `<xhtml:link rel="alternate" hreflang="…" href="…"/>` per listed member of its set, plus
`x-default` (same rules as § 8.4, the same two-member threshold). The `href` of a member is `/` only when its slug
equals `homePageSlug` and it derives the default language (the guard of § 8.4); else its slug. The `<loc>` of each
`<url>` stays the page's slug, as today (`route.ts:33`, `:38`). `<urlset>` gets
`xmlns:xhtml="http://www.w3.org/1999/xhtml"` only when at least one link is written. One language: no
membership query, no join, same bytes. Proof: `cm1-catalog-sitemap`
unchanged + new `lang1c-sitemap` (two-language fixture), `lang1c-hreflang-home` (its sitemap half) and
`lang1c-sitemap-identity` (one-language fixtures: the sitemap body equals the one before the slice).

### 8.6 Language switch (`lang-1c`)

Rule: when `config.languages` is not empty the layout passes `languageSwitch` to the Navbar (a client component,
`renderer/src/components/Navbar.tsx:1`): one link per language (default first, then `languages` in order), label =
the language's own name (`new Intl.DisplayNames([l], { type: "language" }).of(l)` — no new pack texts), `href` = the
language home (`/` or `/<l>`), the current language marked `aria-current="true"`. On the client the switch replaces
each `href` with the `href` of `<link rel="alternate" hreflang="<l>">` of the current document when one exists, and
reads it again after a client navigation. Why on the client: the layout cannot see the page (§ 3.1), and the head
already holds the sibling list (§ 8.4). Without script the links go to the language homes. One language: no prop,
no element, same payload. Proof: `lang1c-switch` (server HTML) + `lang1c-switch-identity`; the client half is
checked in headless Chromium on staging (as `locale-1e` § 5) — a NOT-automated row, named in `lang-1c`.

### 8.7 Commerce and catalog pages

Default language only. `matchCommercePrefix` matches the whole path (`/cart`), so `/en/cart` is an ordinary
content lookup. galeriilevoicu's shop is in Romanian on every page (§ 15).

## 9. Cache and purge

### 9.1 Keys

Change only for addresses under a listed prefix: ISR key `…/$/<domain>~<lang>/<path>` (OBSERVED W1). CloudFront keys
do not change (the public URL). One language: no key changes (OBSERVED control `/ro/x`).

### 9.2 The purge route (`renderer/src/app/api/revalidate/route.ts`, `lang-1b`)

- `purgeTenantIsrCache` (`:98-117`): also delete every object whose key starts with `<ownerRoot>$/<domain>~` and
  `<buildRoot><domain>~` (covers `<domain>~ro.cache` and `<domain>~ro/…`). Isolation: no host contains `~`
  (§ 7.1), so `<domain>~` addresses only this domain's language segments.
- Domain check (`:164`): also refuse a domain that contains `~`.
- `revalidatePath` (`:174`, `:177`): when the slug's first segment matches `/^[a-z]{2,3}$/`, also
  `revalidatePath("/<domain>~<first><slug>")` and `revalidatePath("/<domain>~<first>", "layout")` (OBSERVED W1b:
  the page is a MISS after the purge). The route reads no tenant data; a path with no entry is a no-op.
- The backend (`revalidate-paths.ts`, `revalidate.ts`) does not change: it names public paths.

### 9.3 What a write purges

**One rule for set purges** (it closes the class "a write that changes who is listed"). Listed membership depends on
a member's key, address and publication status (§ 6.2), and any write of a keyed page can change one of them. So:
any write of a page item whose LATEST **as read or as written** holds a `translationKey` — create, update (any
field: `status` to or from `Published`, address, content), restore, a WordPress-import overwrite — purges, besides
today's targets: every current address of each set named by the read key and the written key (the writer reads the
set with the paginated query of § 6.2), and `/sitemap.xml` (its alternates change; the route is edge-cached for an
hour today, `sitemap.xml/route.ts:69-74`). A page that holds no key before or after the write purges exactly as
today. Content-only edits of a keyed page purge a few extra paths (≤ 1 + `languages.length`); that is the price of
one rule without a list of trigger fields. Row `L1C-PURGE-SIBLINGS-SITEMAP` (unit: the target list for join,
leave, rename, publish, archive and a content-only edit of a member; and for a keyless page: today's list; the
bulk writers stay wrapped by `withInvalidation(…, purgeStoredPagesOfRequestTenant)`).

Latency, by writer class (today's mechanisms, unchanged):

- **Ordinary writes** (create, update; `revalidateTenantPaths`, `revalidate.ts:219`): Layer 2 — the renderer
  deletes the whole tenant's stored pages before the response (CACHE-10, `revalidate.ts:182-184`, including the
  `~` segments after § 9.2); Layer 1 — the sibling paths and `/sitemap.xml` go into the fast lane, drained in
  about 1 s and then every 10 s (`docs/caching-architecture.md:386` at `68f0dbb`). A CloudFront path carries no
  host, so the `/sitemap.xml` path refreshes that path for every tenant: harmless, one path. The bulk `/*`
  (≤ 15 min) as today.
- **Bulk writes** (restore, `restore.ts:82`; WordPress import, `wordpress.ts:314`; both
  `withInvalidation(…, purgeStoredPagesOfRequestTenant)`): Layer 2 — the whole tenant after the response; Layer 1
  — only the `/*` marker: siblings and the sitemap refresh at the edge within 15 min, or at once with GO LIVE NOW.
  The whole-tenant purge plus `/*` already covers every target of the set rule, so these writers need no new
  purge code; this is today's latency of these writers for every page they touch.
- **Settings** (languages, menus): the handler purges the stored pages of its domains (`invalidate-cdn.ts:260-261`,
  `tenant/settings.ts:384`) + the `/*` marker — every segment after § 9.2.
- **Nightly flush**: unchanged (all of `_cache/`).

### 9.4 The language-list window and the deferred flush (human ruling LANG1-STALENESS-BOUND = A, strengthened)

Ruling (human, 2026-11-22, verbatim "A with strengthening"): the window after a change of the tenant's language
list is accepted and stated plainly; no consistency mechanism is added to the serving path; a settings save that
changes the language list schedules by itself a second cache flush a few minutes later. Line numbers in this
section are at `68f0dbb`.

**Why there is a window.** Two stale sources, independent of each other:

1. *Middleware memory.* The gate keeps a host's verdict, with its language list, for 60 s per renderer instance
   (`renderer/src/lib/tenant-directory.ts:31`). An instance routes by the old list until its verdict expires.
2. *Index lag.* The gate and every renderer tenant read (`getTenantConfig`, a `GSI_Domain` query) read a global
   secondary index, which DynamoDB updates after the base item; the repository records this lag
   (`backend/src/tenant/settings.ts:369-370`: "GSIs are eventually consistent"). The settings save reads its own
   item strongly consistently (`:314-318`), but no reader by host can. The layout's metadata, the layout, the page
   metadata and the page each read on their own, so one response can mix two states. This specification gives
   **no bound** for this lag: none can be supported from the repository. A gate read made after a verdict expires can
   itself be lagged, so source 1 also lasts "60 s after the instance's first gate read that sees the new list".

**What can be stored** (language `L` added or removed by the save; `x` any page under `/L/`):

1. *`L` added, the middleware is old.* No suffix: default chrome around the `L` page. Origin: under the old key
   `<host>/L/x`, which no request reaches after the window — inert. Edge: `/L/x` with wrong chrome.
2. *`L` added, the layout's read is old.* Suffix `~L`, but the layout's list lacks `L`: default chrome. Origin:
   under the **live key** `<host>~L/L/x`, wrong chrome. Edge: `/L/x` with wrong chrome.
3. *`L` removed, the middleware is old.* Suffix `~L`; the layout drops `L`: default chrome, which is correct for
   the new state. Origin: old key `<host>~L/…`, inert. Edge: correct.
4. *`L` removed, the renderer's reads are old.* No suffix: default chrome; `hreflang` may still list `L` members.
   Origin: under the **live key** `<host>/L/x`, stale alternates. Edge: the same.

Mixed reads inside one response give any mix of these cases. The twin (query string, session) is never stored; it
can show mixed chrome per request during the window. An unknown gate verdict is § 7.1 (twin, no-store), unchanged.

**How it ends.** Two kinds of stored copy end in two different ways (lines at `68f0dbb`):

- *An edge copy* (under the public URL) ends at the next CloudFront `/*` after it was stored: the settings save's
  own bulk `/*` (≤ 15 min), the bulk `/*` of any later change of any tenant (the marker is one per deployment),
  GO LIVE NOW (`backend/src/system/invalidation.ts:102-112`), the deferred flush below, or the nightly flush
  (`backend/src/scheduled/nightly-cache-flush.ts`; it skips when nothing changed since its last run, `:72-75`).
  If the origin still holds a wrong copy under the live key, the edge fills again from it.
- *An origin copy under the live key* (cases 2 and 4) ends only at the next **stored-page purge** of that tenant.
  The actions that do one today: an ordinary content or catalog write through `revalidateTenantPaths`
  (`backend/src/lib/revalidate.ts:219`; callers `content/{create,update}.ts`, `products/{update,delete}.ts`,
  `categories/{update,delete}.ts`), whose renderer call deletes every stored page of the tenant (CACHE-10); the
  18 bulk handlers wrapped as `withInvalidation(…, purgeStoredPagesOfRequestTenant)` (for example
  `content/restore.ts:82`, `import/wordpress.ts:314`, `forms/update.ts:130`, `popups/update.ts:66`); a settings
  save (`tenant/settings.ts:428`); tenant creation (`tenant/create.ts:172`); and the nightly flush, which deletes
  every stored page of every tenant (`nightly-cache-flush.ts:112-130`) unless it skips (`:72-75`). GO LIVE NOW
  and the deferred flush do **not** purge stored pages.
- *An origin copy under an old key* (cases 1 and 3) is never requested again once the routing uses the new list;
  the same purges remove it. Not visible.

**The deferred flush — a best-effort strengthening of the accepted window** (operator ruling
LANG1-DEFERRED-FLUSH-LAYER2 = A′, 2026-11-22: edge only; no origin purge, no domain list, no infra change).

- *Trigger.* The settings update handler (`backend/src/tenant/settings.ts`, `updateHandler` at `:436`) compares
  `readLanguageSettings(current).languages` with `readLanguageSettings(merged).languages` **as sets**. Different →
  it arms the deferred flush after its existing stored-page purge (`:428`). Same set (another field changed, or
  only the order changed) → nothing. The menus per language do not trigger it: they do not change routing.
- *Shape.* The pending-flush marker cannot carry it. `SYSTEM#CDN_PENDING` holds one due time,
  `min(updatedAt + 15 min, firstPendingAt + 15 min)` (`backend/src/lib/edge-invalidation.ts:113-120`), and the
  flush deletes it when its `/*` is accepted (`backend/src/scheduled/debounce-flush.ts:313-333`); a later due time
  written into it would either be consumed by the first flush or delay that flush. So **one more marker item**,
  holding one due time and nothing else:

  ```
  PK = SYSTEM   SK = CDN_DEFERRED_FLUSH     one item for the deployment (a CloudFront path carries no host)
  dueAt = <epoch ms: save time + N>
  ```

- *Monotonic due time: a later save moves it later.* Written with `UpdateItem SET dueAt = :due`, condition
  `attribute_not_exists(dueAt) OR dueAt < :due`; a failed condition (the stored due time is already later) is
  logged and ignored. Why later and not "keep the earlier": the flush is meant to come after the routing memory
  of the **last** language change; keeping the earlier time would fire it inside the second change's window. The
  flush is one global `/*`, so moving it later loses no tenant's work: every edge copy of every tenant is in its
  scope whenever it fires, and the bulk `/*` keeps its own 15-min clock. Best-effort like `markCdnPending`
  (`backend/src/lib/invalidate-cdn.ts:118-154`): a write failure is logged and never fails the save.
- *Drain.* The debounce function (`debounce-flush.ts`, run every minute, `infra/lib/amodx-stack.ts:388-392`) gets a
  third branch next to `flushBulkIfDue` (`:250-336`), in the same form: no item → nothing; `dueAt` a finite
  number and in the future → nothing; due → `submitInvalidation(["/*"], "deferred")`; on success `Delete` with a
  **snapshot condition** on what the drain read: `dueAt` present → `dueAt = :read` (the raw value read, whatever
  its type); `dueAt` absent → `attribute_exists(SK) AND attribute_not_exists(dueAt)`. A save that wrote a new due
  time during the flush fails the condition and keeps the item, so one more flush follows. A malformed item
  (`dueAt` absent, `null`, a string, or a number that is not finite) is treated as due: one `/*`, then the same
  snapshot delete — an extra edge flush is harmless, a stuck item is not. A failed condition is logged, not
  retried in the same invocation. A failed or skipped submit keeps
  the item: the retry of the bulk path applies unchanged (`debounce-flush.ts:295-305`: the error is logged, the
  marker is kept, the next EventBridge invocation about 1 min later tries again). At most one deferred attempt
  per invocation; it counts as work for the idle-exit rule only when it acted, as the bulk branch does. No new
  function, no new schedule, no new grant: the function already holds table read/write and
  `cloudfront:CreateInvalidation` (`amodx-stack.ts:382-386`).
- *N = 5 minutes, a best-effort delay.* Chosen to be longer than the middleware's memory (60 s) plus the drain's
  resolution (one EventBridge tick, 1 min, plus up to about 50 s of polling, `debounce-flush.ts:117-119`); short
  enough to be the human's "a few minutes"; shorter than the 15-min bulk wait. It fires between 5 and about 6
  minutes after the last language change. It is **not** a proven end of the window: the window also depends on
  index lag, which has no bound (above).
- *A second change inside N.* The second save moves `dueAt` to its own time + N; one deferred flush runs, N after
  the last change.
- *Review-1's timing case.* A `/*` fires inside the window (the bulk `/*` of an older pending change, GO LIVE NOW,
  or the nightly flush), and a later request in the window stores old-rule chrome at the edge, while later
  nightly runs may skip. The deferred flush removes that edge copy if the copy was stored before the deferred
  flush and the origin holds no wrong copy under the live key.

**What the deferred flush removes, and what it does not.**

- *Removes:* every edge copy stored before it, provided that the origin key the edge reaches afterwards holds a
  right page (cases 1 and 3, and case 2 or 4 when no wrong live-key origin copy exists).
- *Does not remove — residual case 1 (review-3):* a routing verdict that is still stale after the flush (index lag
  plus the 60-s memory of an instance that read the old list late) stores a wrong edge copy again. It stays until
  the next CloudFront `/*` (any later change of any tenant, GO LIVE NOW, or the nightly flush with its skip rule).
  No bound.
- *Does not remove — residual case 2 (review-4):* the gate already has the new list while the layout's own tenant
  read is stale, so the wrong page is stored under the **live origin key** (cases 2 and 4). The edge fills again
  from it after any `/*`, the deferred one included. It ends at the next stored-page purge of that tenant (the
  actions listed under *How it ends*) or the nightly flush. No bound in a quiet tenant.
- *Not stored:* the twin's mixed chrome during the window, per request.

The same purge-then-stale-render sequence exists today for every other settings field the layout renders (finding
F-LANG-SETTINGS-RACE, § 15).

**Tests bound by name** (`L1B-*` = unit tests with fake clients; `B-*` = bundle serving rows; `lang1b-*` = `next`
serving rows):

- `L1B-DEFERRED-FLUSH-ARMED` — `["ro"]` → `["ro", "de"]`: one `UpdateItem` on `SYSTEM#CDN_DEFERRED_FLUSH` with
  `dueAt` = save time + 5 min, issued after the stored-page purge; the item has no other attribute.
- `L1B-DEFERRED-FLUSH-NOT-ARMED` — the same set, a reordered list, another field only, a tenant without
  `languages`: no write to the item.
- `L1B-DEFERRED-FLUSH-TWO-CHANGES` — a second change 2 min later moves `dueAt` to the second save + 5 min; a write
  with an earlier or equal `:due` does not move it; the drain fires nothing at first save + 5 min and one `/*` at
  second save + 5 min.
- `L1B-DEFERRED-FLUSH-DRAIN` — the item **absent** → no submit; **valid** `dueAt` in the future → no submit; valid
  and due → exactly one `/*`, then the item deleted with `dueAt = :read`; **malformed**, each a value the
  DynamoDB marshaller can store — `dueAt` absent (delete conditioned on `attribute_exists(SK) AND
  attribute_not_exists(dueAt)`), `null`, a string `"soon"` (both deleted with `dueAt = :read` on the raw value) —
  → one `/*`, then the item deleted, and a second invocation submits nothing; for each malformed form, a valid
  `dueAt` written between the read and the delete → the delete fails and the item is kept; CloudFront throws → no
  delete, the item kept and submitted again by the next invocation. The delete is called only after the submit
  returned success. A non-finite number (`NaN`, `Infinity`) cannot be stored (the marshaller refuses it), so the
  due-time parser's "not finite → due" rule is checked in a parser-level case of the same test, not as a stored
  item.
- `L1B-LIMIT-STALE-VERDICT` (documented limit, residual case 1) — after the deferred flush has run and its item is
  gone, the drain alone submits nothing more; when a later change of any tenant writes `SYSTEM#CDN_PENDING`, the
  bulk branch submits the next `/*`. The test asserts only that this next flush happens; it asserts no time bound.
- `B-LANG-LIMIT-LIVE-KEY` (documented limit, residual case 2; bundle target, S3 stub, the real `/api/revalidate`
  route) — a stub control makes renderer tenant reads return the record from before the save while the gate
  already sees the new list (the index-lag model); `/de/x` is stored under `<domain>~de` with default chrome and
  is a HIT again after the lag model ends (the wrong copy stays; the deferred flush, an edge action, cannot reach
  it). Then the next stored-page purge — `POST /api/revalidate { domain, slug }` with the token, the call an
  ordinary content write makes through `revalidateTenantPaths` — deletes it, and the next request is a MISS with
  `<html lang="de">`. The test asserts only that the stored-page purge removes it. Why the bundle target: the
  whole-tenant purge of `~` segments is an S3 action (§ 9.2); `next start` has no S3.
- Edge layer: no suite models the edge cache (`renderer/test/serving-bundle/README.md:128-131`), so the removal of
  edge copies by the deferred flush is bound to `L1B-DEFERRED-FLUSH-DRAIN` (the function submits the `/*`), and
  NOT RUN against a deployed edge until the `lang-1b` staging check.

The row `lang1b-window` of revision 2 is withdrawn with the guard it tested; the option-B row
`B-LANG-DEFERRED-PURGE` of revision 3 is withdrawn with the origin call (ruling A′).

## 10. Admin (English UI) and MCP

- **Settings → Languages card** (`admin/src/pages/Settings.tsx`): shows the default language (from Locale, read
  only) and edits the extra languages (subtags, each with its English name from `Intl.DisplayNames`). Messages come
  from `languageSettingsProblem`. Removing a language removes its menu and footer lists from the form (V5). Help
  text: pages whose address starts with `/<l>` are in language `<l>`. Under the list, one sentence (human ruling
  LANG1-STALENESS-BOUND, § 9.4): "A change to the language list can take a few minutes to show on every page."
  The GO LIVE NOW button stays where it is today. Rationale of "a few minutes": the deferred flush runs about 5–6
  min after the save; it is best-effort, and in the two residual cases of § 9.4 a page can show the old language
  state until a later flush or stored-page purge. The sentence does not promise a time; GO LIVE NOW clears the
  edge again, and any content save of the site clears its stored pages.
- **Settings → home page** (same file, the `homePageSlug` field, `Settings.tsx:1003-1004`): no new control. A save
  that breaks V6 shows the `400` message that names `homePageSlug`.
- **Settings → "Site language" select** (`Settings.tsx:2015-2032`; LANG1-PACK-NOOP = B). After `lang-1d` the
  select offers German and French with no admin code change: it lists `Object.values(LANGUAGE_PACKS)` (`:2025`),
  and choosing one writes the pack's `defaultLocale` (`withSiteLanguage`, `:59-61`). Why this is the smallest
  consistent answer: ruling LOCALE1-LANGUAGE = A (`locale-1.md` § 16.2 item 3) makes a new language "one
  language-pack file plus its registration … no other code changes"; under B a one-language `de-DE` or `fr-FR`
  site is a supported site with German or French texts, so the owner must be able to choose it; hiding the two
  options needs a second list of packs, which is the selection path that B removes.
- **Settings → menu and footer links** (same file): a "Language" selector above the two link editors —
  "Default (<subtag>)" edits `navLinks` / `footerLinks` exactly as today; `<l>` edits `navLinksByLang[l]` /
  `footerLinksByLang[l]`; "Use the default menu" stores no list for `<l>`.
- **Page editor** (`admin/src/pages/ContentEditor.tsx`), shown only when the tenant has `languages`: a "Language"
  select next to the address that rewrites the address prefix (`/about` → `/ro/about`; the stored data is the
  address); a "Translation of" picker listing the tenant's pages in the other languages (title, address,
  language) → `translationOf`; "Not a translation" → `null`; the current set shown as language → page. The picker
  hides a target in this page's language and a target whose set already has a page in this page's language (C3).
  When the set shows two pages in one language (a race, a language-list change), the editor marks both: "Two pages
  in <language>: neither is listed for search engines. Change the address or the set of one of them."

- **Content list** (`backend/src/content/list.ts:44`): the projection adds `translationKey`, so the picker needs no
  extra read.
- **MCP** (`tools/mcp-server/src/index.ts`): `create_page` (`:1021`) and `update_page` (`:888`) get
  `translation_of: z.string().nullable().optional()` (nodeId, or `null` to leave the set); `list_content` (`:845`)
  shows `translationKey`. No new tool and no new backend route (`routes.json` unchanged; `cd tools/mcp-server &&
  npm test` stays the route-coverage check). No MCP tool writes settings (`git grep -n "navLinks"
  tools/mcp-server/src/index.ts`: no hit), so languages and menus are set in the admin only.

## 11. Evidence taxonomy

Row names: `L1A-*` = pure unit tests (`packages/shared/test/`, `backend/test/unit/`, no AWS); `lang1b-*`,
`lang1c-*` = serving rows (`renderer/test/serving-contract/contract.test.mjs`, new fixtures); `L1B-*` = renderer
unit (`renderer/test/unit/`).

For each field or input: **absent** / **present, valid** / **present, malformed** → the named rows.

- **Tenant `languages`, write.** Absent: `L1A-SETTINGS-NO-LANGS` (save accepted, nothing stored). Valid:
  `L1A-LANGS-VALID`. Malformed: `L1A-LANGS-REFUSED`, one case per V1–V4 (not an array, `"RO"`, `"xx"`, twice, the
  default subtag, a URL-prefix segment, `api`) → `400` that names the field.
- **Tenant `languages`, `navLinksByLang`, `footerLinksByLang`, read** (`readLanguageSettings`, every reader).
  Absent: `lang1b-one-language-identity` (the identity rows) and `L1A-READ-SETTINGS-ABSENT` (→ `[]`, `{}`, `{}`).
  Valid: `L1A-READ-SETTINGS-VALID`, `lang1b-segment`, `lang1c-menu`. Malformed: `L1A-READ-SETTINGS-MALFORMED` (unit:
  `languages` = `"ro"` → `[]`; `[null, "RO", "ro", "ro", 5]` → `["ro"]`; a map that is an array or `null`; a key
  not in `languages`; a value that is not an array; entries `null`, `{"label": 1}`; `children` not an array or
  with a bad child — each dropped, nothing thrown), `L1B-GATE-ATTRIBUTE-SHAPE` (the gate's AttributeValue →
  plain conversion on real projected shapes — `L` of `S`, `L` with `N` and `NULL` elements, a bare `S`, an `M`,
  absent — gives the same parser output as `@aws-sdk/util-dynamodb` `unmarshall` of the same items),
  `L1B-LANG-AGREEMENT` (the same table through the gate path and through `mapTenant` + `pageLanguageOf` gives the
  same segment decision), `lang1c-default-subtag-listed` (a stored list that names the default subtag, which V3
  refuses at write: `<html lang>` of root pages stays `localeLanguageSubtag(locale)`; the two members with the
  same `hreflang` value are both left out), `lang1b-langs-malformed` (fixture `languages: "ro"` → today's bytes),
  `lang1c-menu-fallback`, `lang1c-menu-malformed-entries`.
- **Tenant `languages`, write rule for maps.** Malformed: `L1A-BYLANG-REFUSED` (a key not in `languages`; a value
  that is not a link list) → `400`.
- **Tenant `homePageSlug` with `languages`, write (V6).** Absent: `L1A-SETTINGS-NO-LANGS` (no check without
  `languages`). Valid: `L1A-LANGS-VALID` includes `homePageSlug: "/acasa"` with `languages: ["en"]`. Malformed:
  `L1A-LANGS-HOMEPAGE-REFUSED` — (a) `languages: ["en"]` and `homePageSlug: "/en/home"` in one body → `400`
  naming `homePageSlug`; (b) stored `homePageSlug: "/en/home"`, body `languages: ["en"]` only → `400` (the merged
  check); (c) stored `languages: ["en"]`, body `homePageSlug: "/en"` → `400`; control: a tenant without
  `languages` and `homePageSlug: "/en/home"` → accepted.
- **Tenant `homePageSlug`, read (§ 8.4, § 8.5).** Valid: `lang1c-hreflang-home` — a set with a default-language
  member whose slug is `homePageSlug` → its alternate `href` is `https://<domain>/`, in the head and in the
  sitemap. Malformed (only a direct table edit makes it): the stored `homePageSlug` names a member under a listed
  prefix → that member is advertised at its own slug, never at `/`; the default member keeps its own slug.
- **Content `translationKey`.** Absent: the identity rows and `lang1c-no-set` (a page in a language without a key
  → no `hreflang`). Valid: `lang1c-hreflang`. Malformed: `lang1c-key-malformed` (a stored non-string or `""` →
  treated as absent).
- **Input `translationOf`** (unit tests of the handlers with a fake client, `backend/test/unit/`, as
  `content-update-contract.test.ts`). Absent: `L1A-CONTENT-NO-TRANSOF` (create and update send today's
  transaction). Valid:
  - `L1A-SET-NEW-ID` — the first link of two unlinked pages makes one random id, not a `nodeId`, on both pages and
    two membership items;
  - `L1A-SET-SAME-NOOP` — `translationOf` naming a page of the set the page is already in: no membership action;
  - `L1A-SET-LEAVE` — `null`: `REMOVE translationKey` (conditioned) + `Delete` of the own item;
  - `L1A-SET-MOVE` — from set S1 to set S2: `Delete` S1 item, `Put` S2 item, target `ConditionCheck`; no item twice;
  - `L1A-SET-NO-REUSE` — A and B share id K; A leaves; a new translation of A gets a new id; B keeps K alone.
  Malformed or conflicting:
  - `L1A-TRANSOF-REFUSED` — no `languages`; an unknown page; the page itself → `400`;
  - `L1A-SET-SAME-LANGUAGE` — a target in this page's language, or a set with a page in it → `409` (C3);
  - `L1A-SET-CONCURRENT` — two links of one unlinked page into two sets: the second transaction fails on the page
    condition → `409`; only one membership item matches the page's key;
  - `L1A-SET-TARGET-CHANGED` — the target's key changed between read and write → its `ConditionCheck` fails →
    `409`.
- **Restore and import** (page-item writers). Keyed page: `L1A-RESTORE-KEEPS-KEY-SLUG` (a restore of a history
  item with another `slug` and another key keeps the current `slug` and key; the `Put` is conditioned on both),
  `L1A-RESTORE-VS-RENAME` (restore reads `/old`; a concurrent update renames the page to `/new` with the key
  unchanged; the restore's condition `slug = /old` fails → `409`; LATEST keeps `/new`), `L1A-RESTORE-THEN-EDIT`
  (an update after a restore keeps the set: its condition holds). Keyless page: `L1A-RESTORE-NO-KEY-AS-HEAD` (the
  stored item equals HEAD's for the same history, a history `slug` different from the served one included; a
  `translationKey` in the history item is not copied). Import: `L1A-IMPORT-KEEPS-KEY` (the WordPress importer
  copies the existing key and conditions its `Put`; a changed key → that post is reported failed).
- **`TRANSLATION#` item.** Absent: `lang1c-set-missing-item` (a key on the page, no item → the page is not listed).
  Valid: `lang1c-hreflang`. Malformed or stale: `lang1c-member-not-owner` (an item whose page now has another key,
  or no key → skipped), `lang1c-hreflang-member-invalid` (an Archived member; an SK without a node id; a missing
  page → skipped), `lang1c-pagination` (more items than one query page → all read).
- **Derived language of members.** `lang1c-same-language-pair` (two members derive `ro` → no `ro` entry, the other
  entries listed), `lang1c-language-removed` (`ro` removed, `fr` kept: `/ro/about` now derives the default; with
  `/about` in the set → no default entry and no `x-default`; no write happened), `lang1c-language-readded` (`ro`
  added again → the earlier alternates, no write).
- **Segment `<host>~<lang>`.** Absent: the identity rows. Valid: `lang1b-segment`, `lang1b-html-lang`,
  `lang1b-dyn-leak` (a leaked `/<id>~ro/_dyn/…` → `308` to `/_site/<id>/…`). Malformed:
  `lang1b-segment-unlisted` (a preview `~xx` not in the list → the default language) and `lang1b-tilde-host` (a
  host or id with `~` → `404` no-store, no render).
- **Language-list change** (§ 9.4; human ruling LANG1-STALENESS-BOUND = A, strengthened). The window itself is
  stated, not tested as absent. Marker `SYSTEM#CDN_DEFERRED_FLUSH` `dueAt` — absent / valid / malformed:
  `L1B-DEFERRED-FLUSH-DRAIN`; arming: `L1B-DEFERRED-FLUSH-ARMED`, `L1B-DEFERRED-FLUSH-NOT-ARMED`,
  `L1B-DEFERRED-FLUSH-TWO-CHANGES`; documented limits: `L1B-LIMIT-STALE-VERDICT` (residual case 1),
  `B-LANG-LIMIT-LIVE-KEY` (residual case 2). Each is defined in § 9.4. Withdrawn: `lang1b-window` (revision 2),
  `B-LANG-DEFERRED-PURGE` (revision 3).
- **Gate verdict `unknown`.** `lang1b-gate-unknown` (stub `failHostGate(true)`: `/ro/despre` of a two-language tenant
  → twin, no-store, `<html lang="ro">`, nothing stored; `/about` → today's fail-open answer; after recovery the
  ISR route as usual).
- **Purge of a `~` entry and of the sitemap.** Absent: the identity rows. Valid: `lang1b-purge` (`next` target: MISS
  after the purge), the bundle row `B-LANG-PURGE` (S3 stub: the `<domain>~ro` objects are deleted),
  `L1C-PURGE-SIBLINGS-SITEMAP` (unit, § 9.3: join, leave, rename, publish, unpublish/archive, a content-only edit
  of a member — sibling addresses + `/sitemap.xml`; a keyless page → today's list; restore and import keep their
  whole-tenant wrapper). Malformed: `L1B-PURGE-DOMAIN-TILDE` (a `domain` with `~` → `400`).
- **German and French packs** (`lang-1d`, LANG1-PACK-NOOP = B). Absent (no `de`/`fr` page, an EN or RO tenant):
  the identity rows, `loc1-text-*` and `loc1-ro-*` unchanged (the EN and RO packs, `packFor` and the resolver do
  not change). Valid: `lang1d-extra-de` and `lang1d-extra-fr` — a `de` page and a `fr` page of a multi-language
  fixture tenant show the German and the French site texts and `<html lang="de">` / `"fr"`. Completeness: the
  compiler (the packs are typed `CompleteLanguagePack`, § 12). No witness keeps a one-language `de-DE` or `fr-FR`
  tenant on English texts: no such tenant exists (human, 2026-11-22), and one made later gets German or French
  texts — the intended result.

## 12. Build slices

Re-cut after the spike: the serving segment (W1) is the base of `<html lang>`, the menus and the texts, so it is
one slice (`1b`) after the data (`1a`). **galeriilevoicu.ro** (Romanian default, English extra) is served by
`1a`–`1c` with the existing EN and RO packs; it does not wait for `1d`. **satulbanului** (English default; Romanian,
German, French extra) needs `1a`–`1d`. Each slice: staging, the full probe suite, the identity proof on the en-US and
ro-RO staging sites (the `locale-1e` proof), then the human's production deploy. None migrates data: every field is
optional. Every slice keeps the 139 serving rows of `7618acc` and the comparator rules of § 7.4.

**`lang-1a` — data and writes** (§ 5, § 6, § 10; V1–V6).
- Paths: `packages/shared/src/index.ts`, `packages/shared/src/languages.ts` (new), `packages/shared/test/`;
  `backend/src/content/{create,update,restore,list}.ts`, `backend/src/import/wordpress.ts`,
  `backend/src/tenant/settings.ts`, `backend/test/unit/`; `admin/src/pages/{Settings,ContentEditor}.tsx`;
  `tools/mcp-server/src/index.ts`; `docs/database-patterns.md` (the `TRANSLATION#` item), this file.
- Proof: the `L1A-*` rows (`L1A-LANGS-HOMEPAGE-REFUSED` and the preservation witness `L1A-RESTORE-NO-KEY-AS-HEAD`
  included); `npm run typecheck`; `cd backend && npm run test:unit`; `cd tools/mcp-server && npm test`;
  `cd renderer && npm run test:serving` still 139/139 (no renderer file changes, but the shared package the
  renderer imports does).
- Deploy order: shared build, then backend, then admin. Reason: the settings handler stores the merged body
  (`settings.ts:323`), so an admin that sends `languages` to an old backend would store it unchecked.
- Rollback: redeploy the previous backend and admin. Stored fields and items are ignored by the old code (an old
  restore writes the history `slug` again, as it does today).

**`lang-1b` — segment, `<html lang>`, texts, purge** (§ 7, § 8.1, § 8.2, § 9.2, § 9.4).
- Paths: `renderer/middleware.ts` (the language rules after A3, and A3's gate call only, § 7.1),
  `renderer/src/lib/{tenant-directory,site-segment,dynamo}.ts`, `renderer/src/app/[siteId]/layout.tsx`, both
  catch-all `page.tsx`, `renderer/src/components/SitePage.tsx` (`:636`), `renderer/src/app/api/revalidate/route.ts`,
  `renderer/test/{serving-contract,serving-bundle,unit}/`, `renderer/ARCHITECTURE.md` (the gate's name, `:756`),
  `docs/caching-architecture.md` (§ *Serving contract*, one sentence in § *Booking pages*); the deferred flush
  (§ 9.4): `backend/src/tenant/settings.ts`, `backend/src/scheduled/debounce-flush.ts`, `backend/test/unit/`, the
  Languages card text (`admin/src/pages/Settings.tsx`). No folder under `renderer/src/app/` (§ 7.4). No infra
  change (LANG1-DEFERRED-FLUSH-LAYER2 = A′).
- Proof: `npm run test:serving` (all 139 rows of `7618acc`, the `sched1g-*` rows included, + `lang1b-*`),
  `npm run test:serving-bundle` (`B-LANG-PURGE`, `B-LANG-LIMIT-LIVE-KEY`), the `L1B-*` rows (the
  `L1B-DEFERRED-FLUSH-*` and `L1B-LIMIT-STALE-VERDICT` rows included), `renderer/test/unit/tenant-directory.test.ts`
  on `HostVerdict`; staging: `<html lang>` correct on a two-language staging site, the booking walk of `sched-1g`
  unchanged, and one language-list change followed by the deferred `/*` in the debounce function's log (the
  deployed-edge half, NOT RUN before then).
- Deploy order: before production, the F-LANG-TILDE check (§ 15). Then the renderer (segment, layout and purge route
  in one deploy: `~` entries exist only once this renderer runs, and its own purge route deletes them), then the
  backend (deferred flush) and the admin (one sentence).
- Rollback: redeploy the previous renderer (and backend), then GO LIVE NOW. A `SYSTEM#CDN_DEFERRED_FLUSH` item
  left behind is read by no old code (inert). `~` objects are orphaned and leave with the nightly
  flush.

**`lang-1c` — `hreflang`, sitemap, menu, switch** (§ 8.3–§ 8.6; the sibling purge of § 9.3).
- Paths: `renderer/src/components/{SitePage,Navbar}.tsx`, `renderer/src/app/[siteId]/layout.tsx`,
  `renderer/src/app/[siteId]/sitemap.xml/route.ts`, `renderer/src/lib/dynamo.ts`,
  `backend/src/content/{create,update}.ts` (sibling and sitemap purge targets), their tests, docs.
- Proof: the `lang1c-*` rows (`lang1c-hreflang-home` included) + the identity rows and every earlier row; the
  headless-Chromium switch check on staging.
- Deploy order: backend (the sibling and sitemap purge), then renderer (the reads it keeps fresh).
- Rollback: redeploy the previous renderer (and backend), then GO LIVE NOW.

**`lang-1d` — German and French packs** (LANG1-PACK-NOOP = B; § 8.2, § 10). Last; for satulbanului only.
- Scope: `packages/shared/src/language-packs/de.ts` and `fr.ts`, registered in the global `LANGUAGE_PACKS`
  (`language-packs/index.ts:15-18`) — the ratified way to add a language (`locale-1.md` § 16.2 item 3). No `packs`
  parameter on `resolveLocaleStrings` or `packFor`, no second pack table.
- Effects, all intended: a `de` or `fr` page of a multi-language tenant shows German or French texts (§ 8.2); a
  one-language `de-DE` or `fr-FR` tenant created later shows German or French texts; the admin "Site language"
  select offers German and French (§ 10); the booking pages select the new packs by `?lang=de|fr` and for a `de-DE`
  or `fr-FR` tenant (`renderer/src/lib/booking-text.ts:25-27`, `:33`); the backend texts that resolve through the
  packs follow the tenant locale in the same way (`git grep -l resolveLocaleStrings -- backend/src`:
  `orders/create.ts`, `interest/public.ts`, `import/glam-pricelist.ts`, EXECUTED at `7618acc`).
- EN and RO tenants: no change. The EN and RO packs, `packFor`, `resolveLocaleStrings` and `bookingLanguage` do not
  change, so these tenants resolve the same texts. The only new answer they can give is a booking page asked with
  `?lang=de` or `?lang=fr` by the visitor, which before `1d` fell back to the tenant language; that is the
  `?lang=` contract of `sched-1.md` § 10.1 (row `sched1g-g3` checks `lang=xx`, not `de` or `fr`, and stays green).
- Coverage rule (no key without a text): the two packs are typed `CompleteLanguagePack`
  (`language-packs/types.ts:61-66`), as the English pack is, so the compiler refuses a pack with a key missing in
  any part. Size at `7618acc` (EXECUTED: key count of the built English pack): site 79, commerce 180, catalog 55,
  booking 98 — 412 keys per language (a count key counts once). All four parts, because under B the packs are
  global: every visitor surface of a German or French site and the booking `?lang=` read them, and a partial pack
  gives two languages on one page (for example `?lang=de`: German dates, English booking texts). The human approves
  the texts, as for Romanian (`locale-1.md` § 16.2 item 4).
- Tests whose subject changes. They use German or French as "a language without a pack" (`git grep` for `de-DE`,
  `fr-FR`, `"de"`, `"fr"` over the test trees, EXECUTED at `7618acc`; a text search, so `1d` searches again; each
  hit line was read): `packages/shared/test/locale-strings.test.ts:304-306`, `:385-387`, `:411-427`, `:523-526`;
  `packages/shared/test/cdl-1.test.ts:52-53`; `admin/src/pages/Settings.test.ts:94`;
  `renderer/test/unit/sched-1g-pure.test.ts:132-137`; the case label of
  `renderer/test/unit/locale-1e-html-lang.test.ts:42` ("no de pack"; its assertion `lang="de"` stays true). Rule
  that closes the class: a test of the no-pack fallback uses a language that has no pack and asserts that
  precondition in the test (`!Object.prototype.hasOwnProperty.call(LANGUAGE_PACKS, l)`, the form of
  `locale-strings.test.ts:414`); the old `de` and `fr` cases become cases of a language with a pack. Tests that
  use `de-DE` only to format dates or prices (`price-locale-1*`, `locale-1c-blocks-client`, `locale-1d-server-render`)
  do not change (INFERRED from their assertions, which read the format locale, not a text).
- Paths: `packages/shared/src/language-packs/{de,fr,index}.ts`, the tests above, the comment of
  `packages/shared/src/locale-strings.ts:80-85` (it gives `de-DE` as the example of a language with no pack), this
  file.
- Proof: `lang1d-extra-de`, `lang1d-extra-fr`; the identity rows, `loc1-text-*` and `loc1-ro-*` unchanged;
  `npm run typecheck` (completeness); `cd packages/shared && npm test`; `cd admin && npm run test:unit`;
  `cd renderer && npm test`; the human approves the texts.
- Deploy order: shared build, then backend, renderer and admin in one deploy window (each bundles the shared
  package; with no German or French tenant, the order has no visible effect).
- Rollback: redeploy the previous backend, renderer and admin. A tenant that chose German or French in the
  meantime keeps its `locale` and shows English texts again (the fallback of today); no data repair.

One-language argument per slice (the live sites are one-language EN or RO sites): `1a` — the new paths run only
with `translationOf`, with new settings fields, or on a page that holds a `translationKey` (keyed restore); a tenant
without `languages` can hold no key (C2), so its restores are HEAD's (the added condition
`attribute_not_exists(translationKey)` always holds; witness `L1A-RESTORE-NO-KEY-AS-HEAD`); V6 checks nothing
without `languages`; `1b` — the rewrite, the key and `resolveLocaleStrings` input are unchanged without `languages`,
the booking branch A3 answers as before, and the deferred flush is armed only when the language set changes (the
gate read changes shape, same count: one per host per 60 s); `1c` — every new read and element is guarded by
`config.languages` or a set of ≥ 2, and the set purge runs only for keyed pages; `1d` — no change for EN and RO
tenants (above); a one-language German or French tenant changes from English to its own texts, which is the
intended result, and none exists (human, 2026-11-22).
`1b` has one exception, stated in § 7.1: while the gate read fails, language-shaped paths are served uncached.

## 13. Decisions

**Ratified: LANG1-STALENESS-BOUND = A, with strengthening** (human, 2026-11-22, verbatim: "A with strengthening").
The window after a change of the tenant's language list is accepted and stated plainly (§ 9.4); no consistency
mechanism is added to the serving path (the mismatch guard of revision 2 is withdrawn, § 7.2); a settings save that
changes the language list schedules by itself a second cache flush a few minutes later (§ 9.4, the deferred
flush), so the admin does not have to press GO LIVE NOW. The question and options as review-2 raised them: A —
keep the mechanism, disclose that no recovery bound is guaranteed; B — require a guarantee before W1 ships.
The deferred flush is a **best-effort strengthening** of the accepted window, not a bound: it removes the edge
copies stored before it whose origin key holds a right page; it does not remove (1) an edge copy stored again by a
routing verdict that is still stale after it, or (2) a wrong page stored under the live origin key by a stale
layout read, from which the edge fills again. Both end at a later flush or stored-page purge, with no bound
(§ 9.4, *What the deferred flush removes, and what it does not*).

**Ruled: LANG1-DEFERRED-FLUSH-LAYER2 = A′** (operator, 2026-11-22, packet § 10; the reviewer's recommendation).
The deferred flush is edge only: one monotonic due time, one distribution-wide `/*` by the existing debounce
function, no stored-page (origin) purge, no domain list, no infra change. Both residual cases are disclosed
(§ 9.4). The rejected option B (a deferred origin purge too) needed two environment values and a secret grant on
the debounce function, plus target-retention and purge-failure contracts, and still gave no bound.

**Ratified by the human, 2026-11-22** (Appendix D, words quoted there): LANG1-HTML-LANG = A, LANG1-LANG-SOURCE = A
with the homepage rule, LANG1-DATA-SHAPES = A, LANG1-OVERRIDES = A, LANG1-PACK-NOOP = **B**. The base assumption
of the ratification: these are the first sites with more than one language, and no existing site uses German or
French. The five records below keep the question and the options as they were put to the human; the line
`RULED` gives the answer and what it changed in this file. None is open.

DECISION RECORD (ratified 2026-11-22): LANG1-HTML-LANG
QUESTION: The root layout writes `<html lang>`, the menu, the footer and the cookie texts, but it cannot see the page
address, and it may not read the request (that turns every cached page into an error, W4). The spike found one way
that works: the middleware, which sees the address, puts the language into the internal first segment
(`/<host>~ro/...`) for tenants that list extra languages. This changes the serving contract: the middleware rewrite,
the host-gate read (it reads the tenant's language list in place of a count), the purge route, the stub's gate rule
behind row `(c)`, and a new contract row. Do we take this way?
OPTIONS:
- A. W1 as specified in § 7 and § 9.2. Reward: correct `<html lang>`, menu and texts per page; every page cached
  per address; one-language tenants keep rewrite, keys and bytes (OBSERVED 126/126). Risk: touches the core of the
  serving contract; three files every request passes (middleware, gate, layout); a purge-route change that, if
  wrong, leaves language pages stale (proof rows `lang1b-purge`, `B-LANG-PURGE`); while the gate read fails,
  language-shaped paths of every tenant are served uncached (§ 7.1). The window after a change of the language
  list is ruled separately (LANG1-STALENESS-BOUND = A, ratified; § 9.4): pages of the changed language can be
  stored with the other language's chrome; the deferred flush (about 5–6 min after the change) removes the edge
  copies stored before it, best-effort; copies stored again by a still-stale verdict, and live-key origin copies
  from a stale layout read, end at a later flush or stored-page purge of the tenant — no bound.
- B. W3: tenant language on `<html>`, page language on the page's `<main>`. Reward: no contract change (126/126).
  Risk: `<html lang>` stays wrong on every extra-language page (the defect this slice was ruled to remove); the menu,
  footer and cookie texts cannot follow the page; § 8.3 and § 8.6 cannot be built.
- C. W6: move the menu, footer and texts into the page, keep W3 for `<html>`. Reward: no middleware change. Risk:
  `<html lang>` still wrong; every page type (content, product, category, cart) changes; not measured.
RECOMMENDED: A.
RULED: A (human, 2026-11-22). § 3.5, § 7, § 9.2 apply as written.
BLOCKING_REASON: `lang-1b` and `lang-1c` are built on the chosen way; the serving contract is changed only by the
human.

DECISION RECORD (ratified 2026-11-22): LANG1-LANG-SOURCE
QUESTION: Where does a page's language come from? The draft said "the page's language is data on the page; the
address is not parsed". The spike shows the middleware must know the language before the page is read; it can see
only the address and the tenant record. If the language is a stored page field, the middleware must read the page
route on every uncached request, or the field and the address prefix must be kept equal by validation. This also
amends the ratified sentence of `locale-1.md:22` ("the language setting is per tenant").
OPTIONS:
- A. The address prefix states the language (§ 4): no stored `lang` field; the language select in the editor writes
  the prefix. Amended sentence: "the default language is set per tenant; a tenant may add languages, one per
  address prefix". Reward: one source of truth, no field to keep in step, no per-request page read. Risk: every
  extra-language page must live under `/<l>/` (both named clients do, INFERRED § 4); a tenant that adds `de` turns
  existing `/de/…` pages German.
- B. A stored `lang` field plus a write rule "the prefix equals `lang`". Reward: the language is visible in the data.
  Risk: two values that must agree; every writer (create, update, restore, import, MCP) enforces it; no address
  freedom gained.
- C. A stored `lang` field and free addresses; the middleware reads `ROUTE#<path>` + the page per uncached request.
  Reward: any address in any language. Risk: one or two DynamoDB reads in the middleware per origin request (row
  `a2` "zero DynamoDB reads on HIT" fails unless a per-path cache is added); stale language for up to its TTL.
RECOMMENDED: A.
RULED: A with the homepage rule (human, 2026-11-22; the correction of the decision review, Appendix C): rule V6
(§ 5.2), the read-side guard (§ 8.4, § 8.5), rows `L1A-LANGS-HOMEPAGE-REFUSED` and `lang1c-hreflang-home` (§ 11).
`locale-1.md` § 1.1 carries the dated amendment note with the amended sentence.
BLOCKING_REASON: § 5 and § 6 (fields, validation, language derivation) and the editor design follow from it; it
amends a ratified statement.

DECISION RECORD (ratified 2026-11-22): LANG1-DATA-SHAPES
QUESTION: New data crosses the boundaries backend ↔ renderer ↔ admin ↔ MCP: tenant `languages`, `navLinksByLang`,
`footerLinksByLang`; page `translationKey`; API input `translationOf`; the `TRANSLATION#<key>#<nodeId>` item (§ 5,
§ 6). Are these the shapes?
OPTIONS:
- A. As specified (operator scope freeze, 2026-11-21): a set id is a new random UUID, never a `nodeId`, never
  used again; the item `TRANSLATION#<key>#<nodeId>` holds no language, slug or status; every page-item writer
  conditions on the key it read; the reader trusts an item only when the page's current key matches. Reward: the
  existing `navLinks` / `footerLinks` stay the default language with no migration; one paginated `Query` gives a
  set; language-list changes, address changes and restores write no item. Risk: two parallel maps for menus (a
  later per-language field adds one more map each); orphan items can remain (inert, § 15); two members in one
  language are both left out, not refused at every write (C3 is read-then-write).
- B. One map `languageSettings: Record<lang, { navLinks, footerLinks }>`. Reward: later per-language fields go in one
  place. Risk: a nested shape for two lists today; the admin form and validation get one more level.
- C. A sibling list on each page (`translations: { ro: "/ro/despre", … }`) in place of `translationKey` + items.
  Reward: no new item type. Risk: every set change and every address change writes every member; a missed write
  leaves wrong `hreflang`.
RECOMMENDED: A.
RULED: A (human, 2026-11-22). § 5 and § 6 apply as written (with `homePageSlug` as an input of V6).
BLOCKING_REASON: `lang-1a` writes these shapes; once stored on live tenants, a change is a data migration.

DECISION RECORD (ratified 2026-11-22): LANG1-OVERRIDES
QUESTION: A tenant can override texts (`siteStrings`, `catalogStrings`, `commerceStrings`, cookie and legal labels;
ratified "overridable per tenant", `locale-1.md:22`). These overrides are written in the default language. What
does a page in an extra language show?
OPTIONS:
- A. The pack of the page language, without the tenant's overrides (§ 8.2). Reward: every text on the page is in
  one language; no new data. Risk: a tenant's custom wording (for example its own cookie text) is not shown on
  extra-language pages; a language without a pack shows English until `lang-1d`.
- B. The default-language overrides on every page. Reward: custom wording everywhere. Risk: mixed languages on
  extra-language pages (a Romanian cookie text on a German page).
- C. Overrides per language (one more map per part). Reward: full control. Risk: a larger Labels page and data
  shape that neither named client asked for.
RECOMMENDED: A.
RULED: A (human, 2026-11-22). § 8.2 applies as written.
BLOCKING_REASON: `lang-1b` implements the resolver input; it narrows a ratified statement for extra-language pages.

DECISION RECORD (ratified 2026-11-22): LANG1-PACK-NOOP
QUESTION: German and French site texts are needed by satulbanului only. Today a tenant picks its texts by the
language of its `locale`, from one global list of packs (`locale-strings.ts:92-96`); a `de-DE` or `fr-FR` tenant gets
English texts because no `de` or `fr` pack exists. Adding the packs to that global list changes what every live
one-language German or French site shows, but this packet requires every build slice to keep one-language output
unchanged. Which constraint applies?
OPTIONS:
- A. Keep all one-language output: the new packs are used only for extra-language pages (`localeInputFor`, § 8.2);
  the global list stays EN and RO. Reward: meets the packet; witnesses `lang1d-one-language-de`, `-fr`. Risk: a
  second selection path for packs; a German default-language site still shows English texts.
- B. Approve a preservation exception for one-language German and French sites. Reward: one selection path; such
  sites get German or French texts. Risk: changes live tenant output (the operator first lists which tenants have a
  `de` or `fr` locale — NOT RUN) and amends the acceptance criteria.
- C. Defer the German and French packs. Reward: no change to any output, no new selection rule. Risk: satulbanului's
  German and French pages show English texts for the site part.
RECOMMENDED: A, subject to review of the selection rule.
RULED: **B** (human, 2026-11-22), not the corrected A of Appendix C. The human states as a fact that no existing
site uses German or French, so the preservation exception of option B touches no live site, and the operator's
tenant list of option B is not needed. Applied: the German and French packs go into the global `LANGUAGE_PACKS`;
no `packs` parameter, no `EXTRA_LANGUAGE_PACKS`, no witness for one-language German or French tenants (the rows
`lang1d-one-language-de`, `-fr` and `L1D-PACKS-OPTION-ABSENT` are withdrawn). A one-language `de-DE` or `fr-FR`
tenant made later gets German or French texts: the intended result. The admin "Site language" select offers German
and French (§ 10). `lang-1d` keeps its coverage rule and its rows for a `de` and a `fr` page (§ 12). § 14 holds no
pack abstraction (none was added).
BLOCKING_REASON: `lang-1d` cannot both add the packs to the global list and keep one-language output; `lang-1a`…`1c`
do not depend on it (galeriilevoicu needs `ro` and `en` only).

## 14. Abstractions introduced

One line each: what — current users — axis of variation — simpler choice rejected.

- `PageLanguage` + `pageLanguageOf` (`packages/shared/src/languages.ts`) and `languageSettingsProblem`
  (`packages/shared/src/index.ts`) — backend create/update/settings, renderer SitePage/sitemap/middleware, admin
  Settings/ContentEditor — none: the address rule and the write rule shared by four packages (dispatch: sum type,
  variants fixed `default | extra`) — rejected: a copy per package (copies of one rule drift).
- `readLanguageSettings` (`languages.ts`, import-free; operator ruling R-LANG-READ-CONTRACT) — the middleware
  gate and `mapTenant` — none: one read rule for malformed stored values, so both readers decide the same
  language — rejected: a `HostVerdict` parse in the middleware and a second parse in `mapTenant` (two rules that
  can disagree).
- `TRANSLATION#<key>#<nodeId>` membership item — writes: content create/update; reads: page metadata, sitemap —
  none: required by the no-scan rule to list a set from one page — rejected: sibling lists on each page (DECISION
  LANG1-DATA-SHAPES C). Head and sitemap apply one membership rule to it (§ 6.2).
- `SYSTEM#CDN_DEFERRED_FLUSH` marker item (§ 9.4) — written by the settings update handler, drained by
  `debounce-flush.ts` — none: a second due time the existing marker cannot hold — rejected: a later due time in
  `SYSTEM#CDN_PENDING` (one due time, `edge-invalidation.ts:113-120`, deleted at its first `/*`,
  `debounce-flush.ts:313-333`), and a new scheduled function (the existing one runs every minute).
- `HostVerdict` sum type (`tenant-directory.ts`) — the middleware (two call sites at `7618acc`: branch A3, booking, and
  the production branch) — none: it replaces `boolean | null` now that the verdict carries the language list — rejected:
  a second function reading the same cache entry (two awaits, a boolean and a list that can disagree).
- `parseSiteSegment` + `localeInputFor` (`renderer/src/lib/site-segment.ts`) — layout (2 functions), both catch-all
  pages, SitePage — none: one parse rule and one resolver-input rule at 4+ sites — rejected: `getTenantConfig`
  strips the suffix silently (a name that hides a parse), and a ternary repeated at every site.

No new package, module boundary, interface, adapter or configuration layer. The package graph does not change:
the renderer already depends on `@amodx/shared`; the middleware's deep import of one built module (§ 7.1) is a new
file-level edge inside that existing package edge.

## 15. Non-scope, deferred debt, findings

Non-scope: machine translation; a language chosen from `Accept-Language` (it breaks edge caching); a domain per
language; commerce and catalog pages in an extra language (galeriilevoicu's shop pages stay Romanian); right-to-left
scripts; per-language text overrides (LANG1-OVERRIDES C); per-language footer columns, brand text, tagline, top bar,
company details and legal-page URLs; WordPress WPML/Polylang mapping (`docs/slices/import-paths-1.md:35-36`: after
`lang-1a`); per-language product data.

Deferred debt (to `docs/TECH-DEBT.md` when `lang-1a` ships): `TRANSLATION#` items of archived pages, and orphan
items whose page no longer holds the key (§ 6.1), stay; the reader ignores them, nothing removes them. After a
language change, renders in the window can leave stored pages at the origin under an old key (not requested
again) and under the live key (served, residual case 2); the deferred flush clears neither; the next stored-page
purge of the tenant or the nightly flush does (§ 9.4, *How it ends*).

Findings (pre-existing; not fixed here):

- **F-LANG-RESTORE-SLUG** (not corrected here; LANG1-RESTORE-SCOPE = A). `backend/src/content/restore.ts:46-63`
  restores the history item's `slug` into LATEST without changing any `ROUTE#` item, so a restore across a rename
  leaves the page's `slug` and its route apart (the sitemap then lists an address that redirects). It stays as it
  is for every page without a `translationKey`, so for every page of a one-language tenant. For a page with a key,
  `lang-1a` keeps the current `slug` (§ 6.3), but it does not repair a record that an earlier restore already made
  inconsistent.
- **F-LANG-SETTINGS-RACE** (not corrected here; operator ruling, packet § 10). Every settings save today writes the
  tenant item (`backend/src/tenant/settings.ts` ~:398-406), then purges the tenant's stored pages (`:428`), then
  arms the edge `/*` (`:436`). A render after the purge whose own tenant read (`renderer/src/lib/dynamo.ts:93-100`,
  an eventually consistent `GSI_Domain` query; lag recorded at `settings.ts:424-426`) still returns the old record
  stores the OLD settings — theme, menu, footer, texts, anything the layout renders — under the live key, and the
  edge fills again from it until the next stored-page purge of the tenant or the nightly flush. LANG-1 adds the
  language list to the fields this race can affect (§ 9.4, residual case 2). INFERRED from the code and DynamoDB's
  eventual consistency; not reproduced (the serving stub is consistent). The operator carries it to
  `docs/TECH-DEBT.md` (outside this allocation).
- **F-LANG-TILDE.** Tenant ids and domains are not checked for `~` (`backend/src/tenant/create.ts:30` id =
  `body.id` as sent; `:37` domain = `body.domain` as sent). § 7.1 refuses such hosts and ids in the middleware.
  Check before the `lang-1b` deploy: no live tenant id or domain contains `~` (operator, admin tenant list) — NOT
  RUN.
- **F-LANG-SITEID-NAME.** The `[siteId]` parameter holds a host, a tenant id, and after `lang-1b` `<host>~<lang>`;
  the name says "site id". A rename changes the RSC payload of every tenant (`"n":"siteId"` is in it, OBSERVED W1),
  so it is not proposed; `parseSiteSegment` states the contract.
- **F-LANG-PATHS.** The middleware is `renderer/middleware.ts`, not `renderer/src/middleware.ts`.
- `getPublishedContent` (`renderer/src/lib/dynamo.ts:719-746`) reads every version of every page (`begins_with
  CONTENT#`) and keeps LATEST: a cost, not a defect.

## 16. Deployment notes

Every build slice touches code that serves live tenants. Order: staging, the full probe suite, the identity proof
on the en-US and ro-RO staging sites, the human's production deploy. No data migration (all fields optional).
`lang-1b` changes the host-gate read for every request, the booking branch A3 included: before its production
deploy, F-LANG-TILDE is checked. Per-slice deploy order and rollback: § 12. `lang-1a`…`1c` ship for galeriilevoicu
without waiting for `lang-1d`.

## 17. Definition of done, evidence, exit

Definition of done of this specification slice: the spike recorded (§ 3, done); the five decisions of § 13
answered (done, human ratification 2026-11-22, Appendix D); `lang-1a`…`1d` registered in `docs/ROADMAP.md` and the
dated amendment note in `locale-1.md` § 1.1 (done in revision 6, packet LANG-1R).

Evidence of this slice (EXECUTED 2026-11-21, base `d1ffd80`): seven `npm run test:serving` runs (HEAD, W3, W2, W4,
W1b, W1c: counts in § 3.2; and one on the reverted tree at the end: 126/126); six probe runs (W0, W3, W2, W4, W1,
W1b); the searches of § 1, § 3.4, § 6.3 and § 10. Failed-row names: Appendix A. Revision 1 (after review-0) ran no
build and no spike again: it changed the design text only (§ 5, § 6, § 7.1, § 8, § 9, § 11–§ 15). Revision 2
(after review-1; operator rulings LANG1-RESTORE-SCOPE = A and LANG1-STALENESS-BOUND, packet § 7) also ran
nothing: § 5.1, § 5.3, § 6.2, § 6.3 restore, § 7.1, § 7.2, § 8.4, § 8.5, § 9.3, § 9.4, § 11–§ 15.
Revision 3 (after review-2; human ruling LANG1-STALENESS-BOUND = A with strengthening, packet § 8) ran nothing:
§ 7.2 (guard withdrawn), § 9.4 (rewritten), § 10 (one admin sentence), § 11–§ 14, Appendix B, the header. The
machinery facts of § 9.4 were read at `68f0dbb` (OBSERVED). Revision 4 stopped with no edit (the reason of
packet § 9 missed the live-key origin case; `notes-for-human.md` in the relay directory). Revision 5 (packet § 10,
LANG1-DEFERRED-FLUSH-LAYER2 = A′) ran nothing: § 9.4 from *How it ends*, § 10 (the sentence's rationale), § 11,
§ 12, § 13, § 15 (F-LANG-SETTINGS-RACE), Appendix B, the status line; its new citations are at `68f0dbb`.
Revision 6 (packet LANG-1R, the human's ratification) changed the text of the header, the status line, § 2
(base assumption), § 3.4, § 3.5, § 4, § 5 (V6 and its input), § 5.2, § 5.3, § 7.1, § 7.3, § 7.4 (new), § 8, § 10,
§ 11, § 12, § 13, § 14, § 16, § 17, Appendix C (state line) and Appendix D (new). It ran one
`cd renderer && npm run test:serving` at `7618acc` on the unchanged tree (EXECUTED: 139 tests, 139 pass, 0 fail),
the deterministic searches named where they are used (§ 7.1 `isWiredTenantHost`; § 12 the pack readers and the
tests that name German or French), and a key count of the built English pack (§ 12). It read the files listed in
the header at `7618acc` (OBSERVED).
NOT RUN: `npm run test:serving-bundle` (the spike changed no S3 code; the S3 half of § 9.2 is INFERRED from
`route.ts:84-117`); any staging or production call; `cd backend && npm test`.

Exit criterion: with the decisions answered (done), `lang-1a` can be built from § 5, § 6, § 10, § 11 and § 12
without further design. Next: `lang-1a`.

References: `docs/caching-architecture.md` § *Serving contract*, § *Measured serving behaviour*;
`renderer/test/serving-contract/README.md`; `docs/slices/locale-1.md` § 16, `docs/slices/locale-1e.md`;
`docs/plan-site-move-satulbanului.md`; `docs/plan-courses-group-sessions.md` § 1, § 5; `docs/platform-decisions.md`
(no PD is touched); CLAUDE.md Critical Rules 2 (no scan: § 6.2) and 3 (tenant isolation: § 7.1, § 9.2).

## Appendix A. Failed serving rows of the spike (exact names)

Source: the test-runner output of each run, captured in this session's tool output (EXECUTED 2026-11-21; the log
files under `/tmp` were deleted at cleanup with the rest of the spike state). Names as the runner printed them; the
row texts are in `renderer/test/serving-contract/contract.test.mjs`. W0, W1c and W3 failed no row; W1b failed one
row, `(c)` (§ 3.3). These are measured `next start` results; nothing here was measured through the OpenNext
bundle, S3 or CloudFront.

**W2 — route group per language: 8 failed rows** (118 of 126 passed).

- `(cm1-identity-commerce)`, `(cm1-identity-content)`, `(cq1-bars-own)`, `(cq1-quote-channels)`, `(ct1-footer-width)`,
  `(loc1-diff-cdl-2)`, `(loc1-flight-controls)`, `(loc1e-category-controls)`

**W4 — request header + `headers()`: 81 failed rows** (45 of 126 passed). Count check: 81 distinct names, equal to
the runner's `fail 81`.

- `(a1)`, `(a2)`, `(b3)`, `(bpf1-footer-background-only)`, `(bpf1-footer-colours)`, `(c1)`, `(cc1-category-content)`,
  `(cc1-category-no-content)`, `(cdl2-moved-address)`, `(cdl2-partial-prefixes)`, `(cf1-bare-intact)`, `(cf1-legacy)`,
  `(cf1-namespace)`, `(cf1-order)`, `(cf1-preserve)`, `(cf1-roundtrip)`, `(cf1-singleton)`, `(cig1-catalog-hidden)`,
  `(cig1-commerce-hidden)`, `(cip1b-attributes-joined)`, `(cip1b-mixed)`, `(cip1b-never)`, `(cip1b-shop-modes)`,
  `(cip1b-variant-never)`, `(cm1-catalog-cart)`, `(cm1-catalog-listings)`, `(cm1-catalog-product)`,
  `(cm1-catalog-showcase-stale)`, `(cm1-identity-commerce)`, `(cm1-identity-content)`, `(cq1-bars-fallback)`,
  `(cq1-bars-own)`, `(cq1-quote-channels)`, `(cq1-quote-ro)`, `(ct1-editorial)`, `(ct1-footer-width)`,
  `(ct1-no-shadows)`, `(cvg1-text-removal-missing)`, `(cvg1-text-removal-unlisted)`, `(cvg1-text-removal-wrong-text)`,
  `(d1)`, `(d3)`, `(e1)`, `(e2)`, `(h1)`, `(h1b)`, `(h1c)`, `(h2)`, `(hc1-header-colours)`, `(hc1-header-invalid)`,
  `(loc1-diff-cdl-2)`, `(loc1-facet-hrefs)`, `(loc1-flight-controls)`, `(loc1-order-pages)`, `(loc1-ro-catalog)`,
  `(loc1-ro-commerce)`, `(loc1-ro-content)`, `(loc1-text-catalog)`, `(loc1-text-cip1b-catalog)`,
  `(loc1-text-commerce)`, `(loc1-text-content)`, `(loc1-text-fixture-tenant)`, `(loc1-text-iso-a)`,
  `(loc1-text-iso-b)`, `(loc1-text-mutation)`, `(loc1-text-wk)`, `(loc1e-cache-headers)`, `(loc1e-category-controls)`,
  `(loc1e-html-lang)`, `(p1)`, `(sl1a-blank-as-absent)`, `(sl1a-header-footer)`, `(sl1b-blank-as-absent)`,
  `(sl1b-hero-options)`, `(sl1c-blank-draws-nothing)`, `(sl1c-grid)`, `(sl1d-blank-as-absent)`,
  `(sl1d-catalog-no-effect)`, `(sl1d-options)`, `(sl1e-draws-nothing)`, `(sl1e-form)`

## Appendix B. Review state (operator, 2026-11-21; updated by the builder in revisions 3 and 5, 2026-11-22)

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), build cycles 0-5. Separate invocations, not assurance
by independent providers.

- Closed by review-2: translation-set membership and lifecycle, restore (LANG1-RESTORE-SCOPE = A, operator),
  reader contracts, purges on publication change, spike evidence, the § 8 reference.
- **R-LANG-FRESHNESS — corrected in revisions 3 and 5 under the human and operator rulings; waits for
  review-5.** Review-2 showed that
  revision 2's claim (after a change of the tenant's language list no page with wrong-language chrome is stored)
  was not established:
  1. on the dynamic twin, the page can see the mismatch but the root layout still renders default-language
     chrome (the layout sees only the segment);
  2. the tenant record is read from `GSI_Domain` by the layout and the page independently, with propagation lag
     (`backend/src/tenant/settings.ts:369-370` at `68f0dbb`), so the middleware and the page can agree on an old
     list, or the layout and the page can see different lists;
  3. the planned test `lang1b-window` changed fixture data without the purge of the real settings save, so a warm
     entry answered before the guard ran.
  Human ruling LANG1-STALENESS-BOUND = A with strengthening (2026-11-22). Revision 3: the guard, its claim and
  `lang1b-window` are withdrawn (§ 7.2); § 9.4 states what can be stored, when, and how it ends, with no bound for
  index lag; a deferred flush 5 min after a language-list change is specified on the existing debounce function
  with one more marker item (§ 9.4). Revision 4 stopped: the edge-only reason of packet § 9 missed the live-key
  origin case (stale layout read). Packet § 10 ruled LANG1-DEFERRED-FLUSH-LAYER2 = A′ (edge only, both residual
  cases disclosed); revision 5 applies it and records F-LANG-SETTINGS-RACE (§ 15).
- Ratified: LANG1-STALENESS-BOUND (§ 13). Decisions for the human: LANG1-HTML-LANG, LANG1-LANG-SOURCE,
  LANG1-DATA-SHAPES, LANG1-OVERRIDES, LANG1-PACK-NOOP (§ 13). Ruled: LANG1-DEFERRED-FLUSH-LAYER2 = A′ (operator,
  § 13). No build slice starts before them.

## Appendix C. Document review and decision review (operator, 2026-11-22)

- Document review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), build cycles 0-6; review-6
  verdict: approved (the document only; separate invocations, not assurance by independent providers).
- Human ruling 2026-11-22: LANG1-STALENESS-BOUND = A with the strengthening. Operator rulings:
  LANG1-RESTORE-SCOPE = A; LANG1-DEFERRED-FLUSH-LAYER2 = A′ (edge only, both residual cases disclosed, § 9.4,
  § 15).
- Decision review (reviewer challenges each recommendation against the source, builder answers once): five
  decisions, five converged; three recommendations stand (LANG1-HTML-LANG = A, LANG1-DATA-SHAPES = A,
  LANG1-OVERRIDES = A) and two were corrected. The corrections are NOT yet applied to the text above; they
  are applied in one pass after the human ratifies:
  - **LANG1-LANG-SOURCE = A with a homepage constraint.** Cause: `homePageSlug` can name a page of an extra
    language, which is then served at `/` with default-language chrome and advertised as that language's
    alternate. Rule V6: on a tenant with a non-empty `languages` list, `homePageSlug`, when set, must derive the
    default language (checked on the merged settings at save, 400 naming `homePageSlug`). Read side: a member
    is advertised at `/` only when its slug equals `homePageSlug` and it derives the default language. Rows
    `L1A-LANGS-HOMEPAGE-REFUSED`, `lang1c-hreflang-home`.
  - **LANG1-PACK-NOOP = A with pack selection by parameter.** Cause: the resolver selects packs from the
    global registry only, so a separate German/French table would never be used. Rule:
    `resolveLocaleStrings(input, options?: { packs })` and `packFor(locale, packs = LANGUAGE_PACKS)`; a
    constant `EXTRA_LANGUAGE_PACKS` used only by the extra-language branch of `localeInputFor`; the global
    registry and the admin "Site language" select stay EN and RO. Rows in `lang1d-extra-de`, the preservation
    witnesses `lang1d-one-language-de` / `-fr`, and `L1D-PACKS-OPTION-ABSENT`.
- State (revision 5): waits for the human's ratification of the five decisions. No build slice starts before it.
- State (revision 6, 2026-11-22): ratified (Appendix D). The LANG1-LANG-SOURCE correction above is applied (§ 5.2
  V6, § 8.4, § 8.5, § 11). The LANG1-PACK-NOOP correction above is **not** applied: the human ruled B (§ 13), so
  `packs`, `EXTRA_LANGUAGE_PACKS`, `lang1d-one-language-de` / `-fr` and `L1D-PACKS-OPTION-ABSENT` are withdrawn.

## Appendix D. Ratification record (human, 2026-11-22; applied by revision 6, packet LANG-1R)

- The human's words: "these are the first sites that need languages so build from that assumption, THERE ARE NO
  EXISTING SITES THAT USE GERMAN AND FRENCH WE ARE BUILDING SUPPORT FOR LANGUAGES FOR THESE SITES THAT NEED THEM
  FOR THE FIRST TIME." and "what you recommended is fine."
- Rulings: LANG1-HTML-LANG = A; LANG1-LANG-SOURCE = A with the homepage rule (V6, § 5.2; read-side guard § 8.4,
  § 8.5); LANG1-DATA-SHAPES = A; LANG1-OVERRIDES = A; LANG1-STALENESS-BOUND = A with the second edge flush (§ 9.4,
  ratified earlier the same day); LANG1-PACK-NOOP = **B** (§ 13, § 12 `lang-1d`).
- Base assumption applied in the whole file: galeriilevoicu.ro and satulbanului are the first sites with more than
  one language; no existing site uses German or French. Every protection of the live one-language EN and RO sites
  stays (§ 8, § 12); no protection is kept for a multi-language, German or French site that does not exist.
- Amended elsewhere: `docs/slices/locale-1.md` § 1.1 (one dated amendment note; the ratified text is kept);
  `docs/ROADMAP.md` (the `lang-1` row and the rows `lang-1a`…`lang-1d`).
- HEAD moved to `7618acc`: the booking branch A3 and the root folder `app/%5Fbook` are taken into account (§ 7.1,
  § 7.4); `/_booking` paths are not language paths; the serving suite has 139 rows (EXECUTED).
- Next: `lang-1a`.

## Appendix E. Build record — `lang-1a` (builder, 2026-11-22, base `4cb6b96`)

Status: built in the worktree, not committed, waiting for review. Maturity: PROTOTYPE. Every file of § 12 `lang-1a` was
read again at `4cb6b96` before use (OBSERVED: `backend/src/tenant/settings.ts` now holds four string parts incl.
`bookingStrings`; the merged record is `merged`, the language check runs after the scheduling check).

**Changed paths.** `packages/shared/src/languages.ts` (new; imports nothing — OBSERVED: the built `dist/languages.js`
has no `import`), `packages/shared/src/index.ts`, `packages/shared/test/lang-1a.test.ts` + two fixtures (the HEAD
parse capture was taken from `4cb6b96`'s own source in a throwaway worktree); `backend/src/content/{create,update,
restore,list}.ts`, `backend/src/import/wordpress.ts`, `backend/src/tenant/settings.ts`,
`backend/test/unit/lang-1a-{settings,content,import,list}.test.ts` + `lang-1a-table.ts` (a test-only in-memory table that
applies a transaction atomically; `memory-table.ts` has none and was not extended); `admin/src/pages/{Settings,
ContentEditor}.tsx`, `Settings.test.ts`, `ContentEditor.test.ts` (new); `tools/mcp-server/src/index.ts`;
`docs/database-patterns.md`; the ARCHITECTURE.md of shared, backend, admin and the MCP server; this appendix. No renderer
file, no infra, no dependency.

**Rows (EXECUTED, all pass).** Shared (`test/lang-1a.test.ts`, 17): `L1A-READ-SETTINGS-ABSENT`, `-VALID`, `-MALFORMED`
(×5), `L1A-PAGE-LANGUAGE` (×2, added), `L1A-SETTINGS-NO-LANGS`, `L1A-LANGS-VALID`, `L1A-LANGS-REFUSED` (×2),
`L1A-BYLANG-REFUSED`, `L1A-LANGS-HOMEPAGE-REFUSED`, `L1A-PRESERVE-RECORDS` (×2, added: an en-US and a ro-RO tenant and a
content item parse equal to the `4cb6b96` capture). Backend settings (6): `L1A-SETTINGS-NO-LANGS` (the written item is
HEAD's), `L1A-LANGS-VALID`, `L1A-LANGS-REFUSED` (×2), `L1A-BYLANG-REFUSED`, `L1A-LANGS-HOMEPAGE-REFUSED` (a, b, c,
control). Backend content (22): `L1A-CONTENT-NO-TRANSOF` (×4, incl. C1), `L1A-SET-NEW-ID` (×3), `L1A-SET-SAME-NOOP`,
`L1A-SET-LEAVE`, `L1A-SET-MOVE`, `L1A-SET-NO-REUSE`, `L1A-TRANSOF-REFUSED`, `L1A-SET-SAME-LANGUAGE` (×2),
`L1A-SET-CONCURRENT`, `L1A-SET-TARGET-CHANGED`, one route-message test, `L1A-RESTORE-KEEPS-KEY-SLUG`,
`L1A-RESTORE-VS-RENAME`, `L1A-RESTORE-THEN-EDIT`, `L1A-RESTORE-NO-KEY-AS-HEAD` (×2; the stored-item test also passes
against `4cb6b96`'s own `restore.ts`, EXECUTED in the throwaway worktree). Import (3): `L1A-IMPORT-KEEPS-KEY`. List (3,
added in revision 1): `L1A-LIST-MEMBERSHIP` (no key → today's response and one query; member / key without item /
stale item; pagination). Admin: `L1A-ADMIN-LANGUAGES` (×3), `L1A-ADMIN-MENUS` (×2), `L1A-ADMIN-EDITOR` (×8: incl. missing
membership, stale key, Draft and Archived members, two Published members in one language); the Settings captures still compare equal
after removing exactly the one new group (so no React id moved). Mutation checks (EXECUTED): removing the join condition
fails `L1A-SET-NEW-ID` and `L1A-SET-CONCURRENT`; removing the no-op fails `L1A-SET-SAME-NOOP` and
`L1A-RESTORE-THEN-EDIT`.

**Gates (EXECUTED, exit codes read bare).** `npm run build` 0; `npm run typecheck` 0; `packages/shared` `npm test` 0
(601); `backend` `npm run test:unit` 0 (2043 pass, 1 skipped, as before); `admin` `npm run test:unit` 0 (441);
`tools/mcp-server` `npm test` 0 (route coverage PASS, 17); `renderer` `npm test` 0 (836); `renderer`
`npm run test:serving` 0 — **142 / 142**, equal to HEAD's 142 / 142 (EXECUTED first with `4cb6b96`'s shared build;
the same 142 row names; both runs repeated in revision 1); `git diff --check` 0. NOT RUN: `cd backend && npm test` (forbidden), staging, production.

**Differences from the specification (local decisions, recorded).**
1. The set logic (`planTranslation`) lives in `content/update.ts` and is imported by `create.ts`: a new backend module is
   outside the slice's paths.
2. Conditions use the key **as read**, raw: a stored key that is present but not a non-empty string (only a table edit
   makes it) is matched by equality, not treated as absent; restore applies the keyed rule whenever the attribute is
   present; a malformed key has no membership item to delete.
3. C3 counts every member whose LATEST holds the key (Draft and Archived too: they can be published again); languages
   are compared by tag (`languageTagOf`, § 5.3).
4. `translationOf: null` (leave) is accepted on a tenant without `languages` (C2 names a page; leaving only removes a key).
5. Create adds no condition to its page Put without `translationOf` (`L1A-CONTENT-NO-TRANSOF`: today's transaction); the
   WordPress importer adds `attribute_not_exists(translationKey)` to an overwrite of a keyless page (the general rule of
   § 6.3; it always holds on a one-language site) and no condition to a new page.
6. V4 `api`: the runtime cannot format `api` (EXECUTED: `normalizeLocale("api")` = `en-US`), so V1 refuses it first.
7. Admin: the Languages controls are a section at the end of the "Language & Country" card, not a separate card (a new
   card would move the page's React ids, which the capture test pins).
8. § 10 says the list projection adds `translationKey` "so the picker needs no extra read". To apply the § 6.2
   membership rule in the editor (review R-L1A-01), `GET /content` also gives each page that holds a key
   `hasTranslationItem` (its membership item exists): one more paginated Query of the tenant's `TRANSLATION#` items,
   sent only when some page holds a key — a one-language site gets today's response and today's single query. The
   picker still makes no read of its own. **Ruled: LANG1A-MEMBERSHIP-RESPONSE = approve** (operator, 2026-11-22, after
   review-1). Meaning: `hasTranslationItem` is present only on a page whose LATEST holds a set key, and is true exactly
   when `TRANSLATION#<that key>#<nodeId>` exists (§ 6.2 conditions 1 and 3; status and address come from the item
   itself). Reader: the admin page editor only (`admin/src/pages/ContentEditor.tsx`: the picker and the set display).
   The public renderer does not read it — it reads DynamoDB directly and calls no `GET /content` (EXECUTED:
   `git grep hasTranslationItem` over `renderer`, `tools`, `packages`: no hit; the MCP `list_content` tool receives the
   field and does not print it). Reason of the ruling: the ratified admin rule (the picker must not offer or count a
   page whose membership item is missing) cannot be met without this evidence; the field is admin-only, additive and
   optional.
9. Pre-existing finding (not fixed): `TenantConfigSchema`'s own default `integrations.contactEmail: ""` fails its
   `.email()` check, so a parse output cannot be parsed again.

**Revision 1 (review-0).** R-L1A-01: the editor applies the § 6.2 membership rule — a member holds the key now, has its
membership item and an address; a member whose status is Published is listed unless another Published member shares
its language. The picker offers exactly the targets the backend would
join (`planTranslation`'s order: not itself, not its own set, not its language, not a set with a member in its
language — Draft and Archived members count, as in C3); the set display shows Draft and Archived members as not
listed, and the search-engine warning counts PUBLISHED members only (review R-L1A-04: the field is `published`, not
`listed`, because two published members in one language are both left out). R-L1A-02: the warning uses `text-destructive`; no line
the slice adds in the admin uses a fixed colour (grep of the diff; the editor's remaining `text-red-600` is HEAD's
slug-review line). R-L1A-03, closed as a class with one rule: every decision on the `kind` of `PageLanguage`,
`TranslationPlan` or `TranslationChoice` is a `switch` whose every arm returns, in a function whose declared return
type excludes `undefined`, with no default arm; the refusal of `planTranslation` is a Result (`ok: false`), not a plan
variant. EXECUTED check: a fourth variant added to each type in turn gives TS2366 at every decision site (4, 4 and 3
sites), then the files were restored byte for byte.

**Deferred.** The § 15 debt (orphan and archived `TRANSLATION#` items) goes to `docs/TECH-DEBT.md` when `lang-1a`
ships — that file is outside this slice's paths (operator).

**Staging check (operator; a staging TEST tenant only, never a live site).** `API` = the staging API URL, `TOKEN` = an
admin token, `T` = the test tenant id (locale en-US); headers `Authorization: Bearer $TOKEN`, `x-tenant-id: $T`,
`content-type: application/json`.
1. `PUT $API/settings` `{"languages":["ro"]}` → 200; `{"languages":["en"]}` → 400 naming `languages` (V3);
   `{"homePageSlug":"/ro/x"}` → 400 naming `homePageSlug` (V6).
2. `POST $API/content` `{"title":"About LANG","slug":"/about-lang","status":"Draft"}` → 201, nodeId `E`;
   `POST $API/content` `{"title":"Despre LANG","slug":"/ro/despre-lang","status":"Draft","translationOf":"E"}` → 201,
   nodeId `R`; `GET $API/content` → `E` and `R` show the same `translationKey` (a UUID, neither nodeId) and
   `hasTranslationItem: true`; a page in no set has neither field.
3. `POST $API/content` `{"title":"Alt","slug":"/ro/alt-lang","translationOf":"E"}` → 409 (C3).
4. Removal: `PUT $API/content/R` `{"translationOf":null}` and `PUT $API/content/E` `{"translationOf":null}` → 200 each
   (both keys and both membership items removed); `PUT` each page `{"status":"Archived"}`; `PUT $API/settings`
   `{"languages":[],"navLinksByLang":{},"footerLinksByLang":{}}` → 200. Pages cannot be deleted through the API.
5. The en-US and ro-RO staging sites: one settings save and one page save each answer 200 as before (no renderer change
   in this slice). Deploy order: shared build, backend, then admin (§ 12).

### `lang-1a` — operator closeout (2026-11-22): shipped to `main` and to staging

- Review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), three cycles, approved (separate
  invocations). Operator ruling LANG1A-MEMBERSHIP-RESPONSE = approve (Appendix E, difference 8).
- Operator gates, all exit 0: build, typecheck, shared, plugins, renderer unit, serving suite 142 / 142 on three
  consecutive runs, admin unit, backend unit, infra, MCP, `git diff --check`.
- Staging (operator, OBSERVED): diff read first — code only, no resource added or removed, no IAM change;
  deployed; the Appendix E calls on tenant `cm1-content`, 14 checks pass: `languages: ["ro"]` accepted; the
  default language as an extra refused (400 naming `languages`); a Romanian home page refused (400 naming
  `homePageSlug`); an English page and its Romanian translation share one set id (a UUID, neither page id) and
  carry `hasTranslationItem: true`; a page in no set carries neither field; a second Romanian member → 409; an
  unknown page → 400; both pages leave the set and no `TRANSLATION#` item is left; an ordinary settings save
  answers 200. The probe's page, route and link items were removed from `AmodxTable-staging`; `languages` is `[]`
  again. The 51 reference pages of the staging sites are identical to the capture taken before this slice
  (status, headers, `lang`, word multiset).
- Deferred debt carried by the operator: orphan and archived `TRANSLATION#` items (§ 15) → `docs/TECH-DEBT.md`
  with `lang-1c`, the first reader.
- Next: `lang-1b` (the routing change).
