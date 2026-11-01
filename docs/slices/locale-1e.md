# LOCALE-1E — `<html lang>` per tenant (record)

Status: **BUILT, iteration 2** (builder, 2026-11-02; uncommitted, for review). Row `locale-1e` of `docs/slices/locale-1.md`
§ 10 under the rulings of § 16, and the operator rulings after review 0 (§ 9) and after review 0 of iteration 1 (§ 10).
Start: `main` at `d9999d2`, tree clean (EXECUTED). No open decision. Gates and repeat runs: § 14.

## 1. Decisions in force

- **LOCALE1-HTML-LANG = A** (operator, 2026-11-01, under the human's delegation): `locale-1e` is in this track.
- **The `lang` value** (operator decision 2): `new Intl.Locale(normalizeLocale(config.locale)).language` — the language
  of the content, not the resolver's `language` (the selected pack's). `en-US`/`en-GB` → `en`, `ro-RO` → `ro`,
  `de-DE` → `de`, absent or malformed → `en`. Shared helper `localeLanguageSubtag`.
- **LOC1E-404-DOCUMENT = B (F7)** and **LOC1E-STRUCTURE-CATEGORY = A**, bounded (operator, 2026-11-01 ~21:45Z): § 9.

## 2. Behaviour

- `renderer/src/app/[siteId]/layout.tsx` is the ROOT layout: `<html lang={localeLanguageSubtag(config.locale)}>` and
  `<body className={BODY_CLASS_NAME}>` around today's tree. `app/layout.tsx` is deleted; its `globals.css` import moved
  (`import "../globals.css"`), its body class moved unchanged into `renderer/src/lib/document-shell.ts` (one source).
- The missing-tenant branch (cache-1: renders `children`, never the not-found) writes
  `<html lang={localeLanguageSubtag(undefined)}><body className={BODY_CLASS_NAME}>{children}</body></html>` = `lang="en"`.
- `renderer/src/app/not-found.tsx` (F7) is the ROOT 404 boundary: `<html lang={localeLanguageSubtag(undefined)}>`
  (= `en`), `<body className={BODY_CLASS_NAME}>`, `globals.css`, and Next's built-in 404
  (`next/dist/client/components/builtin/not-found`). Every 404 page stays English with `lang="en"`, on every tenant (as
  before). Option C (a tenant-language 404 inside the site chrome) is a product question for the human (§ 13), not built.
- The layout reads only `params` and the tenant record (no `headers()`, `cookies()` or other request API).
- `git grep -n 'lang="en"' -- renderer/src`: exit 1 (EXECUTED). The same holds with plain `grep -rn` over `renderer/src`,
  which also covers the untracked `not-found.tsx`. One comment in it held the literal; it was reworded (§ 14).

## 3. Mechanism proofs (packet § 1)

1. **No new dynamic rendering** (EXECUTED). The route table of `npm run build` at `d9999d2`
   (`.agent-manager/slices/LOCALE-1E/logs/route-table-before.txt`) and of the iteration-1 gate 1
   (`…/iter1-route-table-after.txt`) are byte-equal (`cmp`). The same holds for the serving harness's isolated build
   (`route-table-harness-before.txt` vs the iteration-1 capture). Both:

   ```
   Route (app)
   ┌ ○ /_not-found
   ├ ƒ /[siteId]/_dyn/[[...slug]]
   ├ ƒ /[siteId]/_dyn/products/[productId]
   ├ ● /[siteId]/[[...slug]]
   ├ ƒ /[siteId]/llms.txt
   ├ ƒ /[siteId]/openai-feed
   ├ ● /[siteId]/products/[productId]
   ├ ƒ /[siteId]/robots.txt
   ├ ƒ /-/sitemap.xml
   ├ ƒ /api/account/orders
   ├ ƒ /api/auth/[...nextauth]
   ├ ƒ /api/comments
   ├ ƒ /api/consent
   ├ ƒ /api/contact
   ├ ƒ /api/leads
   ├ ƒ /api/posts
   ├ ƒ /api/profile
   ├ ƒ /api/ref
   └ ƒ /api/revalidate
   ```
2. **Missing-tenant branch** (EXECUTED): rows `d1`/`d2`/`d3` pass unchanged. The branch is reached by a missing id on a
   preview host (twin; row `loc1e-404-document`) and by the paths the middleware matcher skips (`/api/<x>`,
   `/favicon.ico`, `/_next/static/<missing>`), which match `[siteId]` with `siteId` = their first segment (cacheable
   route, `307`; OBSERVED). Unit: the branch renders `<html lang="en"><head></head><body …><main>page</main></body></html>`.
3. **The built-in 404** (EXECUTED): the build succeeds without a top-level layout and without a `global-not-found` file
   or a config flag. The prerendered `/_not-found` artefact changes (OBSERVED in the final build, § 12): before,
   `<html lang="en">` + the root stylesheet; now Next's default layout `<html><body>` wraps F7's document
   `<html lang="en"><body class>` — nested. None of the 11 named probes
   of `LOC1E_PROBE_REQUESTS` reaches `/_not-found`; each answers through `[siteId]` or the middleware (OBSERVED for those
   probes only — reachability by other requests is not claimed).
4. **Cache headers** (EXECUTED): status, `cache-control`, `content-type` and `vary` of 150 requests equal
   `renderer/test/serving-contract/locale-1/1e/before-headers.json` (`d9999d2`; each URL requested twice there, the answers
   agreed). Row `loc1e-cache-headers`: `{"200":131,"307":13,"404":6}`, in every run.

## 4. Hard rule 2 — the enumeration on the F7 candidate (EXECUTED; the `1b` comparator unchanged)

Inputs: `locale-1/1e/before/` (139 captures from `d9999d2`, § 7) vs a capture of the F7 candidate. Unchanged
`checkExpected(…, [])` reports problems on 69 of 81 en-US URLs (every page with a payload); the 12 route-handler bodies are
equal. A full recursive diff of the resolved trees gives the same 17 paths on all 69
(`.agent-manager/slices/LOCALE-1E/logs/enumeration-f7.txt`). Values read from content `/` (ISR) and `/search?q=rug` (twin):

| Row kind | Before (`d9999d2`) | After (F7) |
|---|---|---|
| root segment `""`, `d.r` | `fragment[[LINK, SCRIPT], html{lang:"en"} > body{className} > LR{notFound: [[title, div], []]}]` | `fragment[null, LR{notFound: [html{lang:"en"} > body{className} > [title, div], [LINK]]}]` |
| root segment `d.v` | `null` | the stream-row reference `#row(["C","X"])` |
| root segment `h` | ISR `1040`, twin `16` | unchanged |
| `[siteId]` segment `d.r` | `fragment[[script, script], Providers…]` | `fragment[[LINK, script, script], html{lang} > body{className} > Providers…]` |
| `[siteId]` segment `h` | ISR `1024`, twin absent | ISR `1040`, twin `16` |
| `G[1]` (global-error stylesheets) | `[LINK]` | `[]` |
| SCRIPT (the deleted root layout's chunk, raw `/_next/static/chunks/0a-rekt06v0sv.js`) | in the root segment's resources | REMOVED from the payload. The same chunk stays in the document head's bootstrap scripts on both sides |
| HTML outside the payload, the 4 `307` shells (content and catalog `/cart`, `/checkout`) | `<link rel="preload" href="/_next/static/chunks/0cx63klkdro8w.css" as="style"/>` | absent |

LINK is `["$","link","0",{"rel":"stylesheet","href":…,"precedence":"next",…}]`, the same element everywhere. Its raw
`href` is `/_next/static/chunks/0cx63klkdro8w.css` on both sides: chunk names are content-stable across the two builds
(EXECUTED, raw bodies). The `[siteId]` scripts are the same two (raw `src` equal). `[siteId]` content (Providers and below)
is identical once the wrapper is removed. The iteration-0 enumeration (candidate without F7) is the same table except that
the root `notFound` stayed `[[title, div], []]` and nothing linked the stylesheet in it. Iteration 0 described the
script as "moving" in § 9 and "removed" in § 4 (review finding 3). It is REMOVED from the payload, as above.

**Category 4** (`proof.mjs`, entry exactly `{ category: 4, row: "LOC1E-ROOT-LAYOUT", lang }` — any other field refuses):
1. **Forward transform** `moveRootLayout` of the BEFORE tree (masked, CM1-A1). It validates every input against the
   d9999d2 shape and builds the expected AFTER tree from the before side's own values: the same LINK, the same
   `className`, `lang:"en"` on the root boundary, the tenant's `lang` on the wrapper, and `h` mapped `1024→1040` /
   absent→`16` (any other value refuses). The after tree must then be EQUAL.
2. **Raw half** `moveRootLayoutRaw` (iteration 2, R1). CM1-A1 masks every `/_next/static` path, so the masked equality
   cannot see a changed URL (the reviewer reproduced a changed `[siteId]` script `src` and a changed head stylesheet that
   passed). The raw half resolves both payloads with the asset paths KEPT: the body's `/_next/static/` prefix is renamed
   before the UNCHANGED CM1-A1 pipeline, so the mask does not match it. It then requires, element for element and with
   real URLs:
   - the after `[siteId]` resources equal `[LINK, ...SCRIPTS]` of the before side (same `href`, same `src`);
   - the after root 404 boundary links `[LINK]`, and the before `G[1]` is `[LINK]`;
   - the removed root-layout script's `src` is in the document head on both sides;
   - the head's `/_next/static` stylesheet hrefs are equal before/after, and each equals LINK's href.
3. **The error-shell preload** (ruling LOC1E-404-SHELL-PRELOAD = A, bounded): a shell is identified by its raw response
   starting `<!DOCTYPE html><html id="__next_error__">`, never by a URL list. On a shell, exactly ONE
   `<link rel="preload" href="<LINK's href>" as="style"/>` may be absent after. Any other preload difference refuses: a
   different href, more than one missing, one added. A missing style preload on a page that is not a shell also refuses.
   **The predicate, not this list, is the authority.** Pages in that class today:
   - the 4 `307` shells of `1e/before/`: content `/cart`, content `/checkout`, catalog `/cart`, catalog `/checkout`;
   - the 3 captured 404 landings of `1e/before-404/`: fixture `/no-such-page?nf=1`, roContent `/no-such-page?nf=1`,
     `/_site/loc1e-no-such-tenant` on a preview host.

Everything else stays a difference. EXECUTED: 81/81 en-US URLs exact; `1e/expected-diff.json` lists the move on the 69
pages with a payload.

Refusals (row `loc1e-category-controls`, 16, each reported on a real page):
- On the content home (200), after side: a text inside the wrapper; the wrapper `lang`; every stylesheet href; a second
  stylesheet link; one removed script; a text inside the root 404 boundary; a removed head stylesheet; an expected `lang`
  that differs; an entry with an extra field.
- CHANGED URLs, each caught ONLY by the raw half (EXECUTED offline: the single reported problem is the raw one): the
  `[siteId]` script `src` in the payload; the `[siteId]` stylesheet `href` in the payload; the head stylesheet `href`; the
  removed root-layout script's `src` in the head.
- Before side: a style preload removed on a 200 page.
- On the content `/cart` shell: a missing preload with another href; two missing preloads.

Positive controls: content `/` and the content `/cart` shell are exact.

Hard rule 1 (SSR DOM equality) excepted exactly as ruled: the 4 shells' one preload, and the wrapper. Every other
en-US `200` page's HTML outside the payload is byte-equal under CM1-A1 (row `loc1-diff-1e`).

## 5. The 404 document (EXECUTED)

Browser view (headless Chromium 1.57 against the harness server; `.agent-manager/slices/LOCALE-1E/logs/iter1-browser.txt`):

| Build | `?nf=1` landing (fixture, cm1-content, RO content), `/_site/<missing>`, `/api/x` | `/` |
|---|---|---|
| `d9999d2` (iteration 0) | `<html lang="en">`, body class, "404 This page could not be found." | `lang="en"` |
| candidate without F7 (iteration 0) | no `lang`, empty body class, same text | `lang="en"` |
| **final (F7)** | `<html lang="en">`, body class, same text and title, stylesheet `0cx63klkdro8w.css` loaded | `lang="en"` |

Serving row `loc1e-404-document`: the response of each 404 landing is Next's `__next_error__` shell. Its HTML outside the
payload has NO `lang` and no body class, at `d9999d2` and now (EXECUTED; `<html id="__next_error__"><body>` on both sides).
The browser builds the document from the payload's root 404 boundary. For a known en-US tenant, the RO copy and a missing
tenant (`LOC1E_404_REQUESTS`), each of 8 live responses must:
(1) be a 404 `__next_error__` shell;
(2) equal one `d9999d2` variant of `1e/before-404/` under category 4 (`lang` en / ro / en; the error-shell preload rule), so the shell
equals the `d9999d2` shell minus the preload, and the payload equals the `d9999d2` payload moved;
(3) have a root boundary that is exactly `html{lang:"en"} > body{className} > [title, div]`.
A bound mutation (one changed 404 text) matches no variant. The RO copy's payload wrapper says `ro`, and its rendered 404
says `en` (the root boundary replaces the wrapper).

**Limitation (ruling LOC1E-404-ASSERT-OUTSIDE-PAYLOAD = A):** CI infers the rendered 404 document from the payload; the
browser evidence above (headless Chromium, this build) is recorded, not automated.

**The 404 shell is not deterministic, independently of this slice** (EXECUTED at `d9999d2`: a known tenant's 404 streams its
metadata either in `<head>` or later in the body — 35/25 and 21/39 of 60 requests; the missing tenant 60/60 one variant).
The first series of 6 runs failed this row twice (runs 4 and 5: "the HTML outside the flight payload differs"). Class:
an exact comparison against ONE capture of a non-deterministic render. Rule now in the tree: the before side holds EVERY
variant the start commit produced in 60 requests (`<file>.variant-<n>`), and each live response must equal one of them
exactly. Nothing is masked. In the new series both variants matched live in 5 of 6 runs.

## 6. Changes, per file

| File | What | Serves |
|---|---|---|
| `packages/shared/src/locale-strings.ts`, `src/index.ts` | `localeLanguageSubtag(raw)`, exported | decision 2 |
| `packages/shared/test/locale-strings.test.ts` | 15 cases (incl. de-DE vs the resolver's `"en"`) | decision 2 |
| `renderer/src/app/[siteId]/layout.tsx` | root layout: `globals.css`, `<html lang>`/`<body>`, the missing-tenant branch | § 2 |
| `renderer/src/app/layout.tsx` | deleted | § 2 |
| `renderer/src/app/not-found.tsx` (new, allocated by ruling) | the root 404 boundary (F7) | LOC1E-404-DOCUMENT = B |
| `renderer/src/lib/document-shell.ts` (new, allocated by ruling) | `BODY_CLASS_NAME`, the one source of the body class | ruling condition 1 |
| `renderer/test/unit/locale-1e-html-lang.test.ts` | 10 cases: `lang` per locale, missing tenant renders `children`, the root 404 document, one body-class source | § 2 |
| `renderer/test/serving-contract/fixtures.mjs` | `LOC1E`: an en-GB tenant, a tenant with `locale: "123"` | rule 4 |
| `renderer/test/serving-contract/locale-1/proof.mjs` | category 4 (`moveRootLayout`, `moveRootLayoutRaw` with `rawParts`, wired into `checkExpected`); `LOC1E_PROBE_REQUESTS`, `LOC1E_404_REQUESTS`, `cacheFields` | rule 2, § 3, § 5 |
| `renderer/test/serving-contract/contract.test.mjs` | `loc1-*` rows on the `1e` set (`LOC1_SLICE`, `LOC1_START`, `LOC1_EN_MOVE`), `loc1-diff-1e`, new rows `loc1e-category-controls`, `loc1e-html-lang`, `loc1e-404-document`, `loc1e-cache-headers`; `cm1-identity-*` title | rules 1-4 |
| `renderer/test/serving-contract/locale-1/1e/` | `before/` (139, `d9999d2`, immutable), `before-404/` (5 variants of 3 URLs, `d9999d2`), `before-headers.json`, `expected-diff.json`, `ro-expected.json` | DoD 1, 4 |
| `renderer/test/serving-contract/cm1-byte-identity/baseline/` | re-captured from this tree (§ 7) | rule 3 |
| `renderer/test/serving-contract/README.md`, `cm1-byte-identity/README.md`, `renderer/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md` | rows, current set, baseline history, root layout + 404 boundary, the helper | docs |
| `docs/slices/locale-1e.md` | this record | |

No dependency, no infra, no `next.config.ts`/`middleware.ts` change, no data write.

## 7. Captures and the strict baseline (EXECUTED)

- `1e/before/` (iteration 0, unchanged): worktree `/tmp/LOCALE-1E-before` at `d9999d2`, `node_modules` cloned, the packages
  built there (no `localeLanguageSubtag` in its `dist`), this tree's `fixtures.mjs` and `proof.mjs` copied in (the
  `LOC1E` fixtures were added first). Build `yXyUCg4rE-A_VEoLuYMn_`, 139 captures, stub `unhandled` = `[]`.
- `1e/before-404/` (iteration 1): the same worktree procedure, build `E7f33E6ghOHWVrVBAMkZZ`; 60 requests per URL, one
  body per distinct HTML variant (2, 2, 1). The worktree was removed afterwards.
- `cm1-byte-identity/baseline/`: pre-check — `1e/before/` is CM1-A1-equal to the previous baseline on all 32 commerce/content
  URLs. Then `node test/serving-contract/cm1-byte-identity.mjs capture test/serving-contract/cm1-byte-identity/baseline`
  from `renderer/` (build `KTdyd9b3U6UspWv85Hifc`). Post-check — `checkExpected` with the listed entries reports nothing
  on all 32; `client-modules.json` unchanged. The first serving run before the re-capture failed exactly `cm1-identity-*`
  (93/95). Moved CM1-A1 lines over the 24 commerce/content pages with a payload (full list:
  `.agent-manager/slices/LOCALE-1E/logs/cm1-moved-lines.txt`), each with its cause:

  | Line kind | − / + | Cause |
  |---|---|---|
  | row 0 (root tree, `G`) | 24 / 24 | the root segment's layout replaced by `[null, layout-router]`, the 404 boundary's document, `G[1]` emptied, `d.v` |
  | `[siteId]` segment row | 24 / 24 | gains the stylesheet LINK; `h` 1024 → 1040 (twin: gains `h:16`) |
  | outlined `Providers` row → outlined `html` row | 24 / 24 | the encoder now outlines the wrapper (`html` > `body` > Providers) instead of Providers (a row cut) |
  | child segment rows (slug, `%5Fdyn`, `products`) | 30 / 30 | row labels renumbered inside their references only (resolved trees equal) |
  | stream rows `C` / `X` | 48 / 48 | relabelled |
  | HTML line of content `/cart`, `/checkout` (307 shells) | 2 / 2 | the one stylesheet preload removed |

  The raw `.body` files of the 39 HTML pages change; the 12 non-HTML bodies are byte-equal. History row added in
  `cm1-byte-identity/README.md`.

## 8. Hard rule 1 and the RO proof (EXECUTED, every serving run)

en-US: 8 subjects, 81 URLs; `loc1-text-<subject>` equal to `1e/before/` with zero ledger rows (1,673 extracted items); SSR
HTML outside the payload byte-equal under CM1-A1 on every page, except the ruled 4-shell preload. `<html lang="en">` on
all 65 en-US `200` HTML pages. RO: `loc1-ro-*` 58 URLs, 0 visible-text changes; `<html lang="ro">` on all 42 RO `200` pages.
`LOC1E` en-GB and malformed (`"123"`) homes: `<html lang="en">`.

## 9. Operator rulings after review 0 (2026-11-01 ~21:45Z), and how each is met

| Ruling item | In the tree |
|---|---|
| LOC1E-404-DOCUMENT = B (F7): `app/not-found.tsx` with `<html lang>` + body class + Next's built-in 404 + `globals.css` | § 2; browser § 5 |
| condition 1: one source for the body class | `lib/document-shell.ts`; both files import it; the unit test asserts that neither file holds the literal |
| condition 2: the internal import, and why | `not-found.tsx` header and § 11 |
| LOC1E-STRUCTURE-CATEGORY = A, values validated, not reset; refusal tests | § 4 |
| SSR-DOM exception only for the 4 shells' preload and the wrapper; assert the 404 document | § 4 last paragraph; § 5 — see § 10 D-1 for the "outside the payload" clause |
| `loc1-*` rows to the `1e/` set; `cm1-identity-*` re-captured; `1e/before/` immutable | § 7; `1e/before/` unchanged since iteration 0 |
| record corrections (finding 3) | § 4 (script removed), § 3 item 3 and the `proof.mjs` comment (where the missing static file matches; "not reached by the named probes" kept apart from reachability), § 12 (split) |

## 10. Operator rulings after review 0 of iteration 1 (2026-11-01 ~22:15Z), and how each is met

| Ruling item | In the tree |
|---|---|
| R1: raw checks of the enumerated scripts (`src`) and the document's stylesheet references (head `href` = payload `href` = before `href`); refusals for CHANGED URLs; CM1-A1 unchanged | § 4 item 2; refusals listed in § 4; `cm1-byte-identity.mjs` not edited |
| LOC1E-404-ASSERT-OUTSIDE-PAYLOAD = A (the operator's earlier premise corrected; B refused) | row `loc1e-404-document` unchanged; the limitation sentence in § 5 and in the serving README |
| LOC1E-404-SHELL-PRELOAD = A, bounded: the predicate is the raw `__next_error__` id; one preload of the payload href; refusals; the URL class listed, the predicate the authority | § 4 item 3; the per-URL `shellPreload` flag of iteration 1 was REMOVED from `1e/expected-diff.json` and from the rows |

The iteration-1 decision blocks LOC1E-404-ASSERT-OUTSIDE-PAYLOAD and LOC1E-404-SHELL-PRELOAD are closed by these rulings.

## 11. Abstractions introduced (one line each)

- `localeLanguageSubtag` (shared) — users: the layout (2 calls), `not-found.tsx`, unit tests; axis: none, it is required by
  the packet ("one exported shared helper"); rejected: `new Intl.Locale(normalizeLocale(…)).language` inline 3 times.
- `BODY_CLASS_NAME` (`renderer/src/lib/document-shell.ts`) — users: `[siteId]/layout.tsx` (2 branches), `not-found.tsx`; axis:
  none (one value, one source, ruling condition 1); rejected: a copy of the literal (it drifts).
- `not-found.tsx` imports `next/dist/client/components/builtin/not-found` — users: the root 404 boundary; rejected: a
  hand-written copy of Next's 404 markup. Reason (ruling condition 2): if a Next upgrade moves the module, the BUILD fails
  loudly; a copy would drift silently from Next's 404.
- Category 4 (`moveRootLayout`, `moveRootLayoutRaw` in `proof.mjs`) — users: rows `loc1-diff-1e`, `loc1e-category-controls`,
  `loc1e-404-document`, `loc1-flight-controls` (precondition); axis: dispatch on the `category` sum already in
  `checkExpected`; rejected: resetting the enumerated subtrees on both sides (ruled out: values must be validated).
- `rawParts` (`proof.mjs`, iteration 2) — users: `moveRootLayoutRaw` only; axis: none; it feeds a body with the `/_next/static/`
  prefix renamed through the unchanged `canonicalParts`/`maskBody`; rejected: an asset-mask switch in `cm1-byte-identity.mjs`
  (the ruling keeps CM1-A1 unchanged) and a second CM1-A1 copy without the mask (duplicated logic).
- `LOC1E_PROBE_REQUESTS`, `LOC1E_404_REQUESTS`, `cacheFields` (`proof.mjs`) — users: the `loc1e-*` rows and the capture
  scripts; axis: data; rejected: lists in `contract.test.mjs` only (the captures would need a second copy).

## 12. Findings

Pre-existing at `d9999d2` (not changed):
- **F-LOC1E-MATCHER-SITEID**: the paths the middleware matcher excludes (`/api/<x>`, `/favicon.ico`,
  `/_next/static/<missing>`) match `[siteId]` with `siteId` = their first segment. They answer a year-long cacheable `307`
  to a WRONG location (`/api/x` → `/x?nf=1`, the first segment dropped; browser OBSERVED), and `/api/x?nf=1` answers
  `307` again (the twin is never selected). Left to a serving slice.
- **F-LOC1E-404-SHELL-RACE**: a known tenant's 404 shell streams its metadata in one of two places (§ 5). Handled in the
  row; not a product defect in this slice.

A consequence of this candidate:
- **F-LOC1E-NOT-FOUND-ARTEFACT** (re-stated after F7; OBSERVED in the final build's `.next/server/app/_not-found.html`):
  without a top-level layout, Next builds the `/_not-found` route with its default layout (`<html><body>`), and F7's root
  boundary renders inside it, so the artefact holds TWO `html` and two `body` start tags — outer `<html>` with no `lang`,
  inner `<html lang="en"><body class="antialiased …">`. It links the stylesheet. Its text is the 404 text, once in
  `<title>` and once in the body. At `d9999d2` it was one `<html lang="en">` document. A browser parsing it would add the
  inner tags' attributes to the outer elements (HTML "in body" insertion rules — INFERRED, not observed). No named probe
  reaches `/_not-found` (§ 3 item 3); no wider reachability claim is made. A clean fix is `app/global-not-found.tsx` plus
  `experimental.globalNotFound` in `next.config.ts` (the `/_not-found` route then uses it as its layout,
  `next-app-loader`): a serving/config change outside the allocation, NOT proposed here.

## 13. For the human (product question, not built)

Option C of LOC1E-404-DOCUMENT: a 404 page in the tenant's language, inside the site chrome (cookie banner, navbar, footer),
`lang` = the tenant's. Tested in iteration 0 (throwaway): the 404 text itself stays English (Next's built-in), and every
en-US tenant's 404 page changes visibly.

## 14. Gates and repeat runs (EXECUTED 2026-11-02, iteration 2, on the final code)

`…` = `/Users/apple/Documents/APLICATII BIJUTERIE`. Logs: `.agent-manager/slices/LOCALE-1E/logs/iter2-*`.

| # | Command | Exit | Last lines |
|---|---|---|---|
| 1 | `npm --prefix "…/amodx" run build` | 0 | route table byte-equal to `d9999d2` (`iter2-route-table-after.txt`) |
| 2 | `npm --prefix "…/amodx" run typecheck` | 0 | |
| 3 | `npm --prefix "…/amodx/packages/shared" test` | 0 | `Tests 263 passed (263)` |
| 4 | `npm --prefix "…/amodx/packages/plugins" test` | 0 | `Tests 204 passed (204)` |
| 5 | `npm --prefix "…/amodx/renderer" test` | 0 | `Tests 375 passed (375)` |
| 6 | `npm --prefix "…/amodx/renderer" run test:serving` | 0 | `# tests 95` / `# pass 95` / `# fail 0` (= run 1 below) |
| 7 | `npm --prefix "…/amodx/admin" run test:unit` | 0 | `Tests 214 passed (214)` |
| 8 | `npm --prefix "…/amodx/backend" run test:unit` | 0 | `Tests 1192 passed \| 1 skipped (1193)` |
| 9 | `npm --prefix "…/amodx/tools/mcp-server" test` | 0 | `# pass 13` / `# fail 0` |
| 10 | `git -C "…/amodx" diff --check` | 0 | (no output) |
| + | `git -C "…/amodx" diff --stat -- infra docs/slices/locale-1.md docs/slices/locale-1a.md docs/slices/locale-1b.md docs/slices/locale-1c.md docs/slices/locale-1d.md docs/slices/cmrc-counties-1.md docs/slices/locale-reviews-date-1.md` | 0 | prints nothing |
| + | `git -C "…/amodx" grep -n 'lang="en"' -- renderer/src` | 1 | prints nothing (plain `grep -rn` over `renderer/src`, untracked files included: exit 1) |
| + | 6 consecutive serving runs | 0 × 6 | `iter2-serving-run-{1..6}.log`: each 95/95; each `loc1e-cache-headers` 150 URLs equal, `loc1e-404-document` both variants matched, `loc1e-category-controls` 16 refusals, `cm1-identity-*` 32 × same |

History: iteration 1's first series had two red runs (§ 5, the 404 shell race), then 6 green; iteration 2 is a new series
on the code with the raw half.

Never run: `cd backend && npm test`.

## 15. Not done

No staging or prod step (the operator's: renderer to staging; Layer 2 — the 51 CM1 URLs text- and status-identical, and
`<html lang>` `en` on every staging en-US page; a missing page's 404 renders `lang="en"`). `docs/ROADMAP.md`,
`CURRENT_SLICE.md`, `docs/TECH-DEBT.md` and `docs/caching-architecture.md` are not allocated (the latter's "`layout.tsx`
renders `children` bare" stays true at document level).

## 16. History

Iteration 0 stopped at packet § 2 rule 2. It produced the candidate without F7, the enumeration of § 4 (iteration-0 form:
`logs/enumeration-1.txt`) and the browser evidence of § 5 rows 1-2. It also tested F7 and F1 in a throwaway worktree
(both: route table byte-equal, 150/150 header rows equal; F1 put the site chrome on every 404 page). Its decisions
LOC1E-404-DOCUMENT and LOC1E-STRUCTURE-CATEGORY were ruled B and A (§ 9).

Iteration 1 (rulings of § 9): F7, the category with a per-URL `shellPreload` flag, the `1e` rows and the strict
baseline. Review 0 of iteration 1 found that the category checked resources only after CM1-A1's asset masking (R1). It
also left two ratification points open, now ruled (§ 10). Iteration 2 added the raw half, replaced the flag by the
error-shell predicate, and changed nothing in the product code.

## 17. Operator closeout (2026-11-02 ~00:50Z; staging only — no prod deploy overnight, human's rule)

- Review: approved at the third relaunch (review 0 → escalate on LOC1E-404-DOCUMENT / LOC1E-STRUCTURE-CATEGORY; review of
  iteration 1 → escalate on R1 / LOC1E-404-ASSERT-OUTSIDE-PAYLOAD / LOC1E-404-SHELL-PRELOAD; iteration 2 → approved: the
  reviewer replayed the 16 refusal controls offline and re-checked all 51 stored baseline responses). Rulings §§ 9–10 were
  taken by the operator under the human's overnight delegation; each is reversible; the human may override in the morning.
- Operator gate run (log `glam/loc1e-gates.log`, bare exit codes): build, typecheck, shared 263, plugins 204, renderer 375,
  serving 95/95, admin 214, backend 1192 (+1 skipped), MCP 13, `git diff --check` — all exit 0; infra/spec/dependency
  blocks print nothing; the lang-literal grep exits 1; the only paths outside the packet's original allocation are the two
  files the § 9 ruling allocated (`renderer/src/app/not-found.tsx`, `renderer/src/lib/document-shell.ts`).
- `cdk diff -c stage=staging`: code-only — every Lambda asset (the shared package is in every bundle), renderer
  server/assets, admin runtime config; no resource added or removed, no IAM line. Three nested-stack `Description` lines
  show `?` → `—`: a pre-existing encoding difference between the deployed template and the synthesized one (the infra
  diff of this tree is empty); metadata only.
- Staging (build `wGKV_V8ivq4FovkfgSPMy` → `3D5T1ZzXa7IFFqqouxI8L`): the 51 CM1 URLs text- and status-identical (0
  differences); raw checks before AND after the deploy identical: the three en-US roots `<html lang="en">`, the two 404
  landings (`?nf=1` on a known tenant, a missing tenant) the `__next_error__` shell with `lang` `en` in the payload
  (`glam/loc1e-staging-raw-{before,after}.log`). Staging has no Romanian tenant; the RO proof is the serving suite's.
- For the human (morning): § 13 (a tenant-language 404 in the site chrome — product question); § 12
  F-LOC1E-MATCHER-SITEID (pre-existing, a serving slice candidate) and F-LOC1E-NOT-FOUND-ARTEFACT (a `next.config`
  change outside this allocation). Prod deploy order unchanged: povesti-pe-biscuite locale `ro-RO` first, then deploy.
