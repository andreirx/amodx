# LANG-1 — more than one language on one site (SPECIFICATION slice)

> Copied 2026-11-18 from `satulbanului/docs/amodx-slices/lang-1.md` (draft by the satulbanului session).
> Rewritten 2026-11-21 as a buildable specification after the LANG1-HTML-LANG spike (§ 3). Every `file:line`
> in this file was read again on `main` at `d1ffd80`. Evidence labels: `EXECUTED`, `OBSERVED`, `INFERRED`,
> `NOT RUN` (`docs/documentation.md` § Evidence Labels).

Status: **PLANNED — specification written 2026-11-21, three review cycles; NOT approved by review: one finding
open (Appendix B); not ratified; six decisions open (§ 13 and Appendix B)**.
Track: `lang` (the `locale` track is the neighbour and the base). Depends: `locale-1a`…`1e` (built);
LANG1-SCOPE = A (§ 2.1). Source plans: `docs/plan-site-move-satulbanului.md`, `docs/plan-courses-group-sessions.md`
§ 1 and § 5. Maturity target of the build slices: PROTOTYPE; MATURE after one live two-language site runs `lang-1c`.

This slice changes no code. The spike changed renderer code in the worktree to measure, and reverted it (§ 3.1).

**Scope.** The spike record (§ 3) and the specification of the build slices `lang-1a`…`1d` (§ 4–§ 12).
**Architectural boundaries.** Tenant isolation (§ 7.1, § 9.2: the `~` separator never comes from the wire); no
DynamoDB scan (§ 6.2); the dependency graph and the platform decisions PD-001…003 do not change (§ 14); the serving
contract changes only under DECISION LANG1-HTML-LANG (§ 7.3).

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

- `renderer/middleware.ts:295-298` — the rewrite `/<host><path>` or `/<host>/_dyn<path>`, which is the ISR key.
  Under W1: `<host>~<lang>` for listed prefixes.
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

**W1** (subject to DECISION LANG1-HTML-LANG, § 13). Reasons: the only way that gives a correct `<html lang>` and
lets the menu and texts follow the page while every page stays cached per address; for a tenant without
`languages` the rewrite, the key and the bytes are unchanged (OBSERVED control, 126/126). Rejected: W2 (a group
cannot be chosen by data; silent capture of every address), W3 (the defect stays), W4 (500 on every cacheable
page), W5 and W6 (larger; not a no-op for one-language sites).

## 4. Design rule

Rule (subject to DECISION LANG1-LANG-SOURCE, § 13): **the address states the language.**

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
    navLinksByLang?: unknown; footerLinksByLang?: unknown }): string | null;   // WRITE rule; null = valid
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

`PUT /settings`, `languageSettingsProblem`; each refusal is a `400` that names the field:

- **V1** `languages` is an array; each entry is a bare language subtag: `/^[a-z]{2,3}$/` and
  `normalizeLocale(e) === e` (the runtime can format it; `locale-strings.ts:67-78`).
- **V2** No entry twice.
- **V3** No entry equals the default subtag (`localeLanguageSubtag(locale)`, checked against the locale being saved).
- **V4** No entry equals the first segment of one of the tenant's URL prefixes (`urlPrefixesOf`), nor `api` (the
  middleware never rewrites `/api`, `middleware.ts:181-189`).
- **V5** Every key of `navLinksByLang` and `footerLinksByLang` is in `languages`; each value is an array that
  `LinkSchema` accepts.

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

- **Host gate read** (`renderer/src/lib/tenant-directory.ts:81-110`): the same `GSI_Domain` query, with
  `ProjectionExpression: "SK, #l"` (`#l` = `languages`) in place of `Select: "COUNT"` (`:100`). The index projects
  all attributes (`infra/lib/database.ts:27-31`, no projection given; INFERRED from the CDK default). `SK` keeps a
  tenant without `languages` from coming back as an empty item (INFERRED from DynamoDB projection rules; the stub
  ignores projections, `README.md` § *Deliberate limits*). The gate converts the projected AttributeValues to the
  plain form (§ 5.1, the input boundary) and then calls `readLanguageSettings`, the same function `mapTenant`
  uses. The verdict is cached 60 s as today (`:31`).
  Result type: `HostVerdict = { kind: "unknown" } | { kind: "unwired" } | { kind: "wired"; languages: readonly
  string[] }`. `isWiredTenantHost` is replaced: one caller (`middleware.ts:291`) and its unit tests
  (`renderer/test/unit/tenant-directory.test.ts`; deterministic `git grep`).
- **Production branch** (`:278-300`), by verdict (exhaustive `switch`):
  - `unwired` → `notFoundResponse()`, as today (`:291-293`).
  - `wired` → segment = `<host>~<first>` when `first` (= `path.split("/")[1]`) is in its `languages` and the path
    is not a route handler (`SITE_ROUTE_HANDLERS`, `:124`); else `<host>`. The ISR rewrite and the twin rewrite
    both use the segment.
  - `unknown` (no table, no credentials, or the read failed — today "fail open", `:284-290`): a path whose `first`
    matches `/^[a-z]{2,3}$/` and is not a route handler is rewritten to the **twin** with the segment
    `<host>~<first>` (no-store: never stored by either cache layer). The layout keeps the language only when the
    renderer's own tenant read lists it, so the page renders right in both cases. Every other path keeps today's
    unsuffixed fail-open rewrite: it cannot be an extra-language page. So a gate failure can never put an
    extra-language page into a cache with default-language chrome. Cost: during a gate failure, language-shaped
    paths of every tenant render per request (no cache) — for a one-language tenant the HTML body is the same; the
    payload's segment value carries the suffix. Row `lang1b-gate-unknown` (needs a stub control that fails the
    gate read, `failHostGate(bool)`, added in `lang-1b`).
- **The separator cannot come from the wire**: a host that contains `~` → `notFoundResponse()` before the gate (no
  DNS host name contains `~`). A by-id path (`/tenant/<id>`, `/_site/<id>`) whose id contains `~` → the same 404.
  Today ids and domains are not checked for `~` (`backend/src/tenant/create.ts:30`, `:37`); see F-LANG-TILDE (§ 15).
- **By-id branches** (`/tenant/` `:227-247`, `/_site/` `:248-277`; always the uncached twin): the id gets
  `~<first>` when `first` matches `/^[a-z]{2,3}$/` (no tenant read). The layout keeps the language only when it is
  in the tenant's list, so a wrong guess renders the default language. These responses are never stored.
- **Leaked twin addresses** (rule A2b, `:199-217`): a preview page hands the client router its rewritten path, so
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
  `language` only when it is in `config.languages` (the fresh tenant read); else the default language.
- `app/[siteId]/[[...slug]]/page.tsx:35`, `:40` and `app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:41`, `:46` pass
  `host` to `buildSitePageMetadata` / `SitePage` (each uses `siteId` only for `getTenantConfig`,
  `SitePage.tsx:242`, `:336`). The product pages and the four route handlers never receive a suffix (their first
  segment is `products` or a handler name): unchanged.
- **The segment must agree with the address (staleness rule, operator ruling LANG1-STALENESS-BOUND, review-1).**
  `SitePage` and `buildSitePageMetadata` see the address. Both compare the language the segment states (`~<l>`,
  or none) with `pageLanguageOf(address, config.languages)` computed from the fresh tenant read. When they differ,
  the cached route (`[[...slug]]/page.tsx`) **throws** a named error (`SegmentLanguageMismatch`): a thrown render
  is the ISR route's one non-cacheable outcome — `500`, no `Cache-Control` under `next start`, `no-store` through
  the deployed bundle, stored by neither layer (`docs/caching-architecture.md:676-692`, row `e1`). This needs no
  request API, so it is not the W4 failure. The twin route (`%5Fdyn`) is never stored, so there it renders the
  page with the fresh language. The difference occurs only when the middleware's cached verdict is older than the
  tenant's language list: for up to 60 s per renderer instance after a language is added or removed. Visible
  effect, stated: in that time the cacheable addresses of the added or removed language answer `500` (the twin's
  per-request answers stay correct); before and after, the correct page, cacheable. A page with default-language
  chrome is never stored for an extra-language address, at the origin or at the edge. Row `lang1b-window`
  (§ 11). A one-language tenant never has a mismatch (no list, no suffix), so its bytes do not change.
- `renderer/src/lib/dynamo.ts` `mapTenant` (`:120-178`) is a whitelist: it adds the output of
  `readLanguageSettings(item)` (§ 5.1) — parsed `languages`, `navLinksByLang`, `footerLinksByLang`, invalid values
  dropped — and leaves every existing field, legacy `navLinks` / `footerLinks` included, as it is today. A tenant
  without the fields gets `languages: []` and empty maps on `config`; no reader output changes for it (§ 8).

### 7.3 Contract changes (all under DECISION LANG1-HTML-LANG)

- `docs/caching-architecture.md` § *Serving contract*: a new row — an address under a listed language prefix is
  rewritten to `/<host>~<lang><path>` and stored under that key; every other address as today. And: with an
  unknown gate verdict, a language-shaped first segment goes to the twin (no-store), not to the ISR route.
- Row `(c)` keeps its meaning ("the render never runs for an unwired host"). Its executable form changes: the stub
  identifies the gate by the new query shape (`ddb-stub.mjs:187-191`), and the message "exactly one COUNT query"
  (`contract.test.mjs:695`) becomes "exactly one host-gate read".
- `tenant-directory.ts:77-79` ("nothing is unmarshalled and no tenant data crosses into the edge layer"): the
  language list crosses (public data, a few subtags).

## 8. Output contract

> **§ 8 Ruling — forwarding note.** `docs/plan-site-move-satulbanului.md:40` cites "LANG-1 § 8" for the human
> ruling LANG1-SCOPE = A. That ruling is now in **§ 2.1**, word for word. § 8 below is the output contract.

For every rule: a tenant without `languages` gets today's bytes. The general proof is the serving suite's
byte-identity rows (`cm1-identity-*`, `loc1-text-*`, `loc1-ro-*`, `loc1e-*`, `cq1-*`, `ct1-*`, `sl1*`, `hc1-*`,
`bpf1-*`, `cc1-*`) on every build slice, plus the `locale-1e` staging identity proof on the en-US and ro-RO
staging sites. The spike shows the routing half already passes them (W1c, 126/126).

### 8.1 `<html lang>` (`lang-1b`)

Rule: the page language subtag when the segment carries a listed language; else `localeLanguageSubtag(config.locale)`
(today, `layout.tsx:262`). The not-found branch (`:180`) is unchanged. One language: the segment never has a suffix
→ same attribute. Proof: `loc1e-html-lang` unchanged + new `lang1b-html-lang` (two-language fixture).

### 8.2 Texts by page language (`lang-1b`)

Rule: `resolveLocaleStrings(localeInputFor(config, language))`. `localeInputFor` returns `config` for the default
language, and `{ locale: language }` for an extra language: the pack of that language, without the tenant's
overrides (`siteStrings`, `catalogStrings`, `commerceStrings`, `gdpr.*`, `legalLinks` labels — written in the default
language; DECISION LANG1-OVERRIDES). A language without a pack (de, fr before `lang-1d`) gets the English pack
(today's rule, `locale-strings.ts:92-96`). Call sites: `layout.tsx:124` (meta description), `:196` (chrome),
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
whose slug is `homePageSlug`, else its slug — plus `x-default` = the `href` of the listed default-language member,
when there is one. Fewer than two listed members → the metadata object is exactly today's
(`alternates: { canonical }`, `:324`). One language: no read, same object. Proof: identity rows (the `<head>`
bytes) + `lang1c-hreflang`, `lang1c-hreflang-member-invalid`, `lang1c-same-language-pair`.

### 8.5 Sitemap alternates (`lang-1c`)

Rule (`renderer/src/app/[siteId]/sitemap.xml/route.ts:30-67`): when `config.languages` is not empty, published pages
are joined with the tenant's membership items (§ 6.2, the same membership rule as the head); each `<url>` of a
listed member gets one `<xhtml:link rel="alternate" hreflang="…" href="…"/>` per listed member of its set, plus
`x-default` (same rules as § 8.4, the same two-member threshold). `<urlset>` gets
`xmlns:xhtml="http://www.w3.org/1999/xhtml"` only when at least one link is written. One language: no
membership query, no join, same bytes. Proof: `cm1-catalog-sitemap`
unchanged + new `lang1c-sitemap` (two-language fixture) and `lang1c-sitemap-identity` (one-language fixtures: the
sitemap body equals the one before the slice).

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
  about 1 s and then every 10 s (`docs/caching-architecture.md:328`). A CloudFront path carries no host, so the
  `/sitemap.xml` path refreshes that path for every tenant: harmless, one path. The bulk `/*` (≤ 15 min) as today.
- **Bulk writes** (restore, `restore.ts:82`; WordPress import, `wordpress.ts:314`; both
  `withInvalidation(…, purgeStoredPagesOfRequestTenant)`): Layer 2 — the whole tenant after the response; Layer 1
  — only the `/*` marker: siblings and the sitemap refresh at the edge within 15 min, or at once with GO LIVE NOW.
  The whole-tenant purge plus `/*` already covers every target of the set rule, so these writers need no new
  purge code; this is today's latency of these writers for every page they touch.
- **Settings** (languages, menus): the handler purges the stored pages of its domains (`invalidate-cdn.ts:260-261`,
  `tenant/settings.ts:384`) + the `/*` marker — every segment after § 9.2.
- **Nightly flush**: unchanged (all of `_cache/`).

### 9.4 The language-list window (part of DECISION LANG1-HTML-LANG, not ratified)

The middleware trusts a cached language list for up to 60 s per renderer instance (`tenant-directory.ts:31`).
After a language is added or removed, a request in that window is rewritten by the old list. The page compares the
segment with the fresh list (§ 7.2) and, on the cached route, throws: `500`, stored by neither layer. So:

- Nothing with the wrong chrome is stored, at the origin or at the edge, in the window or after it. Review-1's case
  — a `/*` (a nightly flush, a debounced flush or GO LIVE NOW) fires inside the window, a later request in the
  window stores the old chrome again, and later nightly runs skip — cannot happen: that request answers `500` and
  is not stored.
- **Visible effect** (stated): for up to 60 s per instance after a language is added or removed, the cacheable
  addresses of that language answer `500`. Requests that go to the twin (query string, session) render correctly.
- Pages the edge stored **before** the settings save (the old language state, correct when stored) stay until the
  settings `/*`: within 15 min of the save (`min(updatedAt + 15 min, firstPendingAt + 15 min)`,
  `docs/caching-architecture.md:397-399`), or at once with GO LIVE NOW. That is today's latency of every settings
  change; no new window.
- INFERRED: CloudFront may hold the `500` itself for its error-caching minimum TTL (default 10 s) when the origin
  sends no `Cache-Control` (the `next start` form); the deployed bundle sends `no-store` (row `e1`, bundle form).
  An error page is not wrong chrome.

Row `lang1b-window` (§ 11). It costs two 61-s waits in the serving suite (today about 17 s in total, so about
2 min 20 s after); a test-only TTL setting would avoid the waits but adds a seam that nothing else needs, so it is
not specified.

## 10. Admin (English UI) and MCP

- **Settings → Languages card** (`admin/src/pages/Settings.tsx`): shows the default language (from Locale, read
  only) and edits the extra languages (subtags, each with its English name from `Intl.DisplayNames`). Messages come
  from `languageSettingsProblem`. Removing a language removes its menu and footer lists from the form (V5). Help
  text: pages whose address starts with `/<l>` are in language `<l>`.
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
- **Segment older than the language list** (staleness rule, § 7.2). `lang1b-window`, two phases on a fixture with
  `languages: ["ro"]` and a page `/de/x`:
  1. Add: one request warms the middleware's verdict; `putItem` sets `languages: ["ro", "de"]` (the settings
     change); a request for `/de/x` inside the 60-s window → `500`, no `Cache-Control`, nothing stored (no ISR
     file, no `x-nextjs-cache`); after 61 s the same request → `200`, `<html lang="de">`, `s-maxage=31536000`,
     MISS then HIT.
  2. Remove: `putItem` sets `languages: ["ro"]` again; `/de/x` inside the window → `500`, nothing stored; after
     61 s → `200`, the default `<html lang>`, cacheable.
  A one-language fixture requested in the same run never answers `500`.
- **Gate verdict `unknown`.** `lang1b-gate-unknown` (stub `failHostGate(true)`: `/ro/despre` of a two-language tenant
  → twin, no-store, `<html lang="ro">`, nothing stored; `/about` → today's fail-open answer; after recovery the
  ISR route as usual).
- **Purge of a `~` entry and of the sitemap.** Absent: the identity rows. Valid: `lang1b-purge` (`next` target: MISS
  after the purge), the bundle row `B-LANG-PURGE` (S3 stub: the `<domain>~ro` objects are deleted),
  `L1C-PURGE-SIBLINGS-SITEMAP` (unit, § 9.3: join, leave, rename, publish, unpublish/archive, a content-only edit
  of a member — sibling addresses + `/sitemap.xml`; a keyless page → today's list; restore and import keep their
  whole-tenant wrapper). Malformed: `L1B-PURGE-DOMAIN-TILDE` (a `domain` with `~` → `400`).
- **German and French packs** (`lang-1d`, under LANG1-PACK-NOOP). `lang1d-one-language-de`,
  `lang1d-one-language-fr`: a one-language `de-DE` and a `fr-FR` fixture tenant answer the same bytes before and
  after the slice (the preservation witnesses); `lang1d-extra-de` (a `de` page of a multi-language tenant uses the
  German site texts, under option A).

## 12. Build slices

Re-cut after the spike: the serving segment (W1) is the base of `<html lang>`, the menus and the texts, so it is
one slice (`1b`) after the data (`1a`). galeriilevoicu needs `1a`–`1c`; satulbanului `1a`–`1d`. Each slice: staging,
the full probe suite, the identity proof on the en-US and ro-RO staging sites (the `locale-1e` proof), then the
human's production deploy. None migrates data: every field is optional.

**`lang-1a` — data and writes** (§ 5, § 6, § 10).
- Paths: `packages/shared/src/index.ts`, `packages/shared/src/languages.ts` (new), `packages/shared/test/`;
  `backend/src/content/{create,update,restore,list}.ts`, `backend/src/import/wordpress.ts`,
  `backend/src/tenant/settings.ts`, `backend/test/unit/`; `admin/src/pages/{Settings,ContentEditor}.tsx`;
  `tools/mcp-server/src/index.ts`; `docs/database-patterns.md` (the `TRANSLATION#` item), this file.
- Proof: the `L1A-*` rows (the preservation witness `L1A-RESTORE-NO-KEY-AS-HEAD` included); `npm run typecheck`;
  `cd backend && npm run test:unit`; `cd tools/mcp-server && npm test`; `cd renderer && npm run test:serving` still
  126/126 (no renderer file changes, but the shared package the
  renderer imports does).
- Rollback: redeploy the previous backend and admin. Stored fields and items are ignored by the old code (an old
  restore writes the history `slug` again, as it does today).

**`lang-1b` — segment, `<html lang>`, texts, purge** (§ 7, § 8.1, § 8.2, § 9.2).
- Paths: `renderer/middleware.ts`, `renderer/src/lib/{tenant-directory,site-segment,dynamo}.ts`,
  `renderer/src/app/[siteId]/layout.tsx`, both catch-all `page.tsx`, `renderer/src/components/SitePage.tsx`
  (`:636`; the staleness check of § 7.2), `renderer/src/app/api/revalidate/route.ts`,
  `renderer/test/{serving-contract,serving-bundle,unit}/`, `docs/caching-architecture.md`.
- Proof: `npm run test:serving` (every identity row + `lang1b-*`, `lang1b-window` included),
  `npm run test:serving-bundle` (`B-LANG-PURGE`), the `L1B-*` rows; staging: `<html lang>` correct on a
  two-language staging site.
- Rollback: redeploy the previous renderer, then GO LIVE NOW. `~` objects are orphaned and leave with the nightly
  flush.

**`lang-1c` — `hreflang`, sitemap, menu, switch** (§ 8.3–§ 8.6; the sibling purge of § 9.3).
- Paths: `renderer/src/components/{SitePage,Navbar}.tsx`, `renderer/src/app/[siteId]/layout.tsx`,
  `renderer/src/app/[siteId]/sitemap.xml/route.ts`, `renderer/src/lib/dynamo.ts`,
  `backend/src/content/{create,update}.ts` (sibling and sitemap purge targets), their tests, docs.
- Proof: the `lang1c-*` rows + the identity rows; the headless-Chromium switch check on staging.
- Rollback: redeploy the previous renderer (and backend), then GO LIVE NOW.

**`lang-1d` — German and French packs, site part. Last; blocked on DECISION LANG1-PACK-NOOP (§ 13).**
- Why blocked: `packFor` selects a pack from the global registry by the locale's language, for every tenant
  (`locale-strings.ts:92-96`). Adding `de` and `fr` there changes a one-language `de-DE` or `fr-FR` tenant from the
  English fallback texts to the new pack: not a no-op. galeriilevoicu needs `ro` and `en` only, so `lang-1a`…`1c` do
  not depend on this decision.
- Paths (option A): `packages/shared/src/language-packs/{de,fr}.ts`, a pack table used only for extra-language
  pages (`localeInputFor`, § 8.2) — not the global `LANGUAGE_PACKS` that `packFor` reads — and pack tests.
- Proof: `lang1d-one-language-de`, `lang1d-one-language-fr` (preservation witnesses, § 11), `lang1d-extra-de`; the
  coverage rule of `locale-1.md` § 16 (no site key without a text); the human approves the texts.
- Rollback: redeploy the previous shared package and renderer.

One-language no-op argument per slice: `1a` — the new paths run only with `translationOf`, with new settings
fields, or on a page that holds a `translationKey` (keyed restore); a tenant without `languages` can hold no key
(C2), so its restores are HEAD's (the added condition `attribute_not_exists(translationKey)` always holds; witness
`L1A-RESTORE-NO-KEY-AS-HEAD`); `1b` — the rewrite, the key and `resolveLocaleStrings` input are unchanged without
`languages`, and the staleness rule (§ 7.2) cannot fire without a list (the gate read changes shape, same count:
one per host per 60 s); `1c` — every new read and element is guarded by `config.languages` or a set of ≥ 2, and
the set purge runs only for keyed pages; `1d` — only under LANG1-PACK-NOOP option A, where the new packs are reached
only from extra-language pages (witnesses `lang1d-one-language-de`, `-fr`); under option B it is not a no-op.
`1b` has one exception, stated in § 7.1: while the gate read fails, language-shaped paths are served uncached.

## 13. Decisions

DECISION_REQUIRED: LANG1-HTML-LANG
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
  language-shaped paths of every tenant are served uncached (§ 7.1); for up to 60 s per renderer instance after a
  language is added or removed, the cacheable addresses of that language answer `500` (the staleness rule of § 7.2
  and § 9.4: nothing with wrong chrome is ever stored); pages the edge stored before the settings save stay up to
  15 min, as for every settings change today. Choosing A also approves that 60-s error window.
- B. W3: tenant language on `<html>`, page language on the page's `<main>`. Reward: no contract change (126/126).
  Risk: `<html lang>` stays wrong on every extra-language page (the defect this slice was ruled to remove); the menu,
  footer and cookie texts cannot follow the page; § 8.3 and § 8.6 cannot be built.
- C. W6: move the menu, footer and texts into the page, keep W3 for `<html>`. Reward: no middleware change. Risk:
  `<html lang>` still wrong; every page type (content, product, category, cart) changes; not measured.
RECOMMENDED: A.
BLOCKING_REASON: `lang-1b` and `lang-1c` are built on the chosen way; the serving contract is changed only by the
human.

DECISION_REQUIRED: LANG1-LANG-SOURCE
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
BLOCKING_REASON: § 5 and § 6 (fields, validation, language derivation) and the editor design follow from it; it
amends a ratified statement.

DECISION_REQUIRED: LANG1-DATA-SHAPES
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
BLOCKING_REASON: `lang-1a` writes these shapes; once stored on live tenants, a change is a data migration.

DECISION_REQUIRED: LANG1-OVERRIDES
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
BLOCKING_REASON: `lang-1b` implements the resolver input; it narrows a ratified statement for extra-language pages.

DECISION_REQUIRED: LANG1-PACK-NOOP
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
- `HostVerdict` sum type (`tenant-directory.ts`) — the middleware (one caller) — none: it replaces `boolean | null`
  now that the verdict carries the language list — rejected: a second function reading the same cache entry (two
  awaits, a boolean and a list that can disagree).
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
items whose page no longer holds the key (§ 6.1), stay; the reader ignores them, nothing removes them. (No ISR
object is left under an old segment after a language change: the settings save deletes the tenant's stored pages,
and in the 60-s window the cached route stores nothing, § 9.4.)

Findings (pre-existing; not fixed here):

- **F-LANG-RESTORE-SLUG** (not corrected here; LANG1-RESTORE-SCOPE = A). `backend/src/content/restore.ts:46-63`
  restores the history item's `slug` into LATEST without changing any `ROUTE#` item, so a restore across a rename
  leaves the page's `slug` and its route apart (the sitemap then lists an address that redirects). It stays as it
  is for every page without a `translationKey`, so for every page of a one-language tenant. For a page with a key,
  `lang-1a` keeps the current `slug` (§ 6.3), but it does not repair a record that an earlier restore already made
  inconsistent.
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
`lang-1b` changes the host-gate read for every request: before its production deploy, F-LANG-TILDE is checked.

## 17. Definition of done, evidence, exit

Definition of done of this specification slice: the spike recorded (§ 3, done); the five decisions of § 13
answered; at ratification the operator registers `lang-1a`…`1d` in `docs/ROADMAP.md` and amends `locale-1.md:22`
with the wording of LANG1-LANG-SOURCE (both outside this slice's allocation).

Evidence of this slice (EXECUTED 2026-11-21, base `d1ffd80`): seven `npm run test:serving` runs (HEAD, W3, W2, W4,
W1b, W1c: counts in § 3.2; and one on the reverted tree at the end: 126/126); six probe runs (W0, W3, W2, W4, W1,
W1b); the searches of § 1, § 3.4, § 6.3 and § 10. Failed-row names: Appendix A. Revision 1 (after review-0) ran no
build and no spike again: it changed the design text only (§ 5, § 6, § 7.1, § 8, § 9, § 11–§ 15). Revision 2
(after review-1; operator rulings LANG1-RESTORE-SCOPE = A and LANG1-STALENESS-BOUND, packet § 7) also ran
nothing: § 5.1, § 5.3, § 6.2, § 6.3 restore, § 7.1, § 7.2, § 8.4, § 8.5, § 9.3, § 9.4, § 11–§ 15.
NOT RUN: `npm run test:serving-bundle` (the spike changed no S3 code; the S3 half of § 9.2 is INFERRED from
`route.ts:84-117`); any staging or production call; `cd backend && npm test`.

Exit criterion: with the decisions answered, `lang-1a` can be built from § 5, § 6, § 10, § 11 and § 12 without
further design.

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

## Appendix B. Review state (operator, 2026-11-21)

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), build cycles 0-2. Separate invocations, not assurance
by independent providers.

- Closed by review-2: translation-set membership and lifecycle, restore (LANG1-RESTORE-SCOPE = A, operator),
  reader contracts, purges on publication change, spike evidence, the § 8 reference.
- **Open: R-LANG-FRESHNESS.** § 7 and § 9.4 claim that after a change of the tenant's language list no page with
  wrong-language chrome is stored. Review-2 shows the claim is not established:
  1. on the dynamic twin, the page can see the mismatch but the root layout still renders default-language
     chrome (the layout sees only the segment);
  2. the tenant record is read from `GSI_Domain` by the layout and the page independently, with propagation lag
     (`backend/src/tenant/settings.ts:320`), so the middleware and the page can agree on an old list, or the
     layout and the page can see different lists;
  3. the planned test `lang1b-window` changes fixture data without the purge of the real settings save, so a warm
     entry answers before the guard runs.
  The guarantee text of § 7 and § 9.4 is therefore NOT to be relied on until decision LANG1-STALENESS-BOUND
  (the human's) is answered and the text is corrected.
- Decisions for the human: LANG1-HTML-LANG, LANG1-LANG-SOURCE, LANG1-DATA-SHAPES, LANG1-OVERRIDES,
  LANG1-PACK-NOOP (§ 13) and LANG1-STALENESS-BOUND (this appendix). No build slice starts before them.
