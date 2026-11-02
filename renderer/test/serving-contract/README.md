# Serving-contract characterization suite

Slice `test-2`. The **executable form** of `docs/caching-architecture.md` § *Serving
contract*. It pins the behaviour that slices `cache-1`/`cache-2`/`cache-3` measured with
one-off probes, so a later renderer change that regresses it fails a build instead of
shipping.

```bash
cd renderer && npm run test:serving
```

Requires only a built `packages/shared`, `packages/effects` and `packages/plugins` (the
renderer imports their `dist/`). It builds the renderer itself.

**Two serving targets (slice `opennext-1a`).** `SERVING_TARGET=next` (the default, `npm run
test:serving`, PR CI) serves with `next start`. `SERVING_TARGET=bundle` (`npm run
test:serving-bundle`, deploy gate) runs the same rows against the built OpenNext Lambda
artefact behind an emulated CloudFront edge, with S3 / SQS / DynamoDB stubs — see
`../serving-bundle/README.md`. The helpers keep their names on both targets (`startStubs`,
`buildRenderer`, `startRenderer`, `request`); `storedIsrEntries()` reads the filesystem on
`next` and the S3 stub on `bundle`. Under `bundle` every row first resolves a version-explicit
expectation (`BUNDLE_EXPECTATIONS`, keyed by open-next major) and a few rows are restated for
the bundle (`d1`/`h1b`/`h1c`/`h2` doubled MISS `Location` on open-next 3.1.3 only — `SAME` on
`@opennextjs/aws` 4.1.9, which emits one `Location` (`opennext-1b`); `d3` S3 journal; `e1` header
absent-or-`no-store`, `g4` pinned to the renderer's own status because `Origin` is stripped
at the edge — the bundle suite proves the renderer behind the edge; the edge security rule is
proven by infra (i)); one extra row, `(journals)`, runs there. On `next`: 39 rows, plus the `next`-only rows of
later slices (`cm1-*`, `cf1-*`, `cip1b-*`, `loc1-*`, …); the run recorded in `docs/slices/locale-1d.md` counted 91 tests; `docs/slices/cat-quote-1-impl.md`, 99; `docs/slices/cat-theme-1-impl.md`, 101 (round 1) and 102 (round 2).

## What it asserts

Each test is named `(row)` after the contract row it pins and cites the document section in
a comment. Failing test = **contract change**, not a flaky test.

| Test | Pins |
|---|---|
| `a1` `a2` `a3` | published page: `s-maxage=31536000`, MISS → HIT, **zero** DynamoDB reads on HIT, no `Set-Cookie` on cacheable HTML |
| `b1` `b2` `b3` | query string **or** any ratified session-cookie shape → the `force-dynamic` twin (`no-store`); non-session cookies stay on the cacheable route (prefix match, not substring) |
| `c` | unknown host → middleware `404` + `private, no-store`, **no render**; a dotted path (`/x.php`) gets the same gate |
| `d1` `d2` `d3` | missing page → cacheable `307` → `?nf=1` → non-cacheable `404`; the `?nf=1` request never loops; the stored artefact is the 307 and **no 404 is ever stored** |
| `c1` `c2` `h1` `h2` | **cache-8**: an ISR page emits `s-maxage` but **no** `stale-while-revalidate` (`expireTime` is inert — `c1`); the adapter's `fixISRHeaders()` edge SWR window is the patched `300`, not `2592000`, in the INSTALLED source the build bundles (`c2`; since `opennext-1b` it resolves `@opennextjs/aws/core/routing/util.js`, patch `patches/@opennextjs+aws+4.1.9.patch` — the bundled artefact itself is checked by `scripts/verify-opennext-patch.mjs`); a tenant's dotted slug renders on its own host (`GET /index.php` on `wk`'s host → `200`), so no path-shape scanner shield is admissible (`h1`); an unshielded scanner path still takes the ordinary cacheable `307` handoff (`h2`) |
| `p1` `p2` `t1` `t2` | **siteid-binding-1**, by-id addressing: `/_site/<id>` on a preview host → `200`, `no-store`, `amodx_preview_base` cookie, nothing stored (`p1`); on a tenant host → `403` (`p2`); `/tenant/<id>` on a tenant host → `403` (`t1`); on a preview host → `200` + `no-store` (`t2`) |
| `h1b` `h1c` | **siteid-binding-1**, `[siteId]` is bound only by the middleware: another tenant's id (`/wk/index.php`, `h1b`) or host (`/<wk's host>/index.php`, `h1c`) in the path does not select that tenant — the request host's `307` handoff instead — and nothing is stored under the other tenant's ISR key (`h1c`, which must run before `h1`) |
| `e1` `e2` | read failing *after* tenant resolution → `500` with **no** `Cache-Control` and no ISR entry; the same path caches normally once reads recover (human decision `CACHE-1-D4`) |
| `f` | `?preview=true` → renders, `no-store` |
| `g1` `g2` `g3` | `/api/*` never advertises a storable lifetime; `/api/posts` answers `400`/`500` rather than an empty `200`; the referral `Set-Cookie` lives on an uncacheable `/api` response |
| `cm1-identity-commerce` `cm1-identity-content` `cm1-rewire` `cm1-control` | **cat-mode-1, CM1-BYTE-IDENTITY Layer 1** (`docs/slices/catalog-mode-1.md` § 3.6, comparison contract § 8.19 "CM1-A1"): a tenant without `catalogMode` (commerce; content-only) answers every § 3.6 URL with the status, Content-Type and canonical body of the committed `cm1-byte-identity/baseline/` (first `de4ad52`; advanced by `locale-1a`, `locale-1b`, `cmrc-counties-1`, `locale-1d`, `locale-1c`, `locale-reviews-date-1` and `locale-1e`, each with its reviewed `expected-diff.json` entries — history in `cm1-byte-identity/README.md`; `cm1-control` keeps the `de4ad52` set, `control-de4ad52/`) — capture sets committed in `cm1-byte-identity/` (how they were made, the canonicalisations, what is NOT compared, what to do on failure: `cm1-byte-identity/README.md`); counts printed per URL. `cm1-rewire` is the bound mutation (an element rewired to another client component, or a client row to another module, MUST change the canonical body); `cm1-control` is the detector's positive control (the catalog tenant's product page and feed MUST differ) |
| `loc1-subjects` `loc1-text-<subject>` `loc1-text-mutation` `loc1-diff-theme-1` `loc1-facet-hrefs` `loc1-flight-controls` `loc1-ro-content` `loc1-ro-commerce` `loc1-ro-catalog` `loc1-order-pages` | **locale-1a / 1b / 1d / 1c, locale-reviews-date-1, locale-1e, cat-quote-1 and cat-theme-1, the tenant locale table** (`docs/slices/locale-1.md` § 8.5, rulings § 16.2 items 4-6; helpers `locale-1/proof.mjs` and `locale-1/extract.mjs`; run LAST in the `next`-only block; the rows read the CURRENT slice's inputs, `locale-1/theme-1/` (cat-theme-1) — the `1a/`, `1b/`, `1c/`, `1d/` and `reviews-date-1/` files are those slices' records, `1e/` is read only by the `loc1e-*` rows and `quote-1/` only by the `cq1-*` rows; since 1c the `cm1-content` home holds the block-chrome blocks, `fixtures.mjs` `blockChromeBlocks`): the en-US subjects are, by rule, every `fixtures.mjs` tenant without `locale` (`EN_US_REQUESTS`: today 8 tenants, 81 URLs — since 1d the commerce subject's order pages too, `orderRequests`: `/account`, the order confirmation with and without an order, the tracking page, "Order Not Found"); for each, the visible-text extraction of every captured URL equals the immutable `0865ac6` capture `locale-1/theme-1/before/` (which also holds the RO copies, the `CQ1` and the `CT1` tenants), except exactly the `text` of the listed category-3 (ledger) entries — `theme-1` lists none (a category-3 entry without `text` is markup only) (`loc1-text-mutation` proves each comparison can fail); every byte difference is one listed in `locale-1/theme-1/expected-diff.json` (in `cat-theme-1`: NONE on any URL — every list is `[]`, `loc1-subjects` requires it, and `loc1-diff-theme-1` adds five controls that each editorial class or marker leaking to a tenant without the field is reported; in `cat-quote-1`: row CQ1-INTEREST-LINK on the 13 catalog product pages — the interest toggle's `variant` "page" → "link" and two class attributes; every shop and content URL lists nothing; in `locale-1e`: one category-4 entry, row LOC1E-ROOT-LAYOUT, on every page with a payload — the root-layout move, with raw `src`/`href` checks and the error-shell preload rule; before that slice, `locale-reviews-date-1`'s one category-3 entry L-ALL-2; each listed one must occur; CM1-A1 plus the ruled resolved-tree payload comparison `resolveFlight` (LOCALE1B-ROW-CUT = A): every outlined row — a plain `$<id>`, or a lazy `$L<id>` to an element tuple, the encoder's element outline — is resolved into its place on both sides; every parsed row is compared once; other typed references stay typed; text rows are cut at their length; an unknown form fails closed; no URL is excluded; `loc1-flight-controls` proves that changed values, rewired references, dropped and added rows, typed-reference changes, the second review's controls, the real-payload productId mutation and HTML bytes fail; a disconnected cycle fails closed, and that a renaming or a different cut does not); `loc1-facet-hrefs`: every filter href of the catalog pages equals the start capture (the facet ids are URL contract); on the RO copies `loc1-ro-*` (fixtures `LOC1`) each URL shows exactly the text changes of `locale-1/theme-1/ro-expected.json` against THE SAME COPY in `before/` (none in `locale-1e`, `cat-quote-1` and `cat-theme-1`), each the EN pack value of its key → the RO pack value, plus, in `cat-quote-1`, its `added` texts (row CQ1-QUOTE: the "Cere ofertă" button and dialog on the RO catalog copy's product pages, each the RO pack value of its key; `cat-theme-1` lists none); `loc1-order-pages` is the positive control that the en-US order pages reach their states. Key coverage: `locale-1/<slice>/coverage.json`, checked by `test/unit/locale-coverage.test.ts` (each plural category of each count key, per language, since 1b) |
| `cmrc-counties-1` | **cmrc-counties-1, checkout region list** (`docs/slices/cmrc-counties-1.md`): on `/checkout` the RO commerce copy (`countryCode: "RO"`) receives the 42 counties of the RO country pack as `CheckoutPageView.defaultRegions`, the en-US commerce tenant (`countryCode: "EN"`) none (its client-rendered form shows the free-text county field — markup proven in `test/unit/cmrc-counties-1-checkout.test.ts`); since `locale-1d` each receives the checkout `strings` of its LANGUAGE's table (RO / EN), never of its country. Row `cmrc-counties-diff` (the `959f288` capture `cmrc-counties-1/before/` with one listed difference) was retired by `locale-1d`, which changes every commerce page; its successor is `loc1-diff-1d` (the `92adbba` capture already holds the counties change) — the retired row compared under CM1-A1 exactly; `loc1-diff-1d` compares under CM1-A1 plus the ruled resolved-tree payload comparison of locale-1b (LOCALE1B-ROW-CUT = A: payload row labels and row cuts are not compared); the CM1-A1-exact comparison of those 32 URLs continues in rows `cm1-identity-*` against the baseline this slice re-captured; the capture set stays as that slice's record; since `locale-1c` the locale byte row was `loc1-diff-1c` (the `0c0dbc8` capture, same comparison), since `locale-reviews-date-1` it was `loc1-diff-reviews-date-1` (the `eba5e18` capture, same comparison), since `locale-1e` it is `loc1-diff-1e` (the `d9999d2` capture, same comparison plus category 4) |
| `cm1-catalog-product` `cm1-catalog-listings` `cm1-catalog-showcase-stale` `cm1-catalog-showcase-dom` `cm1-catalog-cart` `cm1-catalog-sitemap` `cm1-catalog-feed` | **cat-mode-1, the catalog surface rows** (spec § 3.2, § 3.3): on a `catalogMode` tenant no price, currency, availability or Buy text and no `offers` on the product page, shop, category, search, legacy pages and `categoryShowcase` — also for a product that still holds legacy price, tier and Paddle data; the variant presenter renders the 3-option fixture group and the attributes (none under commerce); a showcase whose lookup misses and whose authored prefetch is stale emits no price or overlay and its payload carries display fields only (commerce = positive control); the imageless product's legacy by-ID page has no main `<img>`, JSON-LD `image` or `og:image`; the showcase's browser fallback, rendered into jsdom in a child process (`cm1-showcase-dom.mjs`, a committed test; `jsdom` is a declared renderer devDependency), emits none under `_catalogMode` and both without it; `/cart` and `/checkout` take the not-found handoff to `404`; the sitemap lists the catalog products and category; the OpenAI feed is `404` |
| `cq1-quote-ro` `cq1-quote-channels` `cq1-bars-fallback` `cq1-bars-own` | **cat-quote-1, "Cere ofertă" and the contact channels** (`docs/slices/cat-quote-1-impl.md`; fixtures `LOC1.roCatalog` with all three channels and `CQ1`, requests `CQ1_REQUESTS`, before side `locale-1/quote-1/before/`): on the RO catalog copy's product pages the button above the presenter, the native `<dialog>` (closed in the server HTML) with its Romanian texts and the three hrefs (`tel:` without spaces, `wa.me/<digits>?text=`, `mailto:` with subject = title and body = the message), the low-key interest link after the presenter, the RO texts and the title + absolute URL in the payload; e-mail only → one `mailto` action; an empty `contactChannels` → no button and the page byte-equal to `29a2282` but for CQ1-INTEREST-LINK (positive control: the copy with channels differs); a shop whose Top Bar / Commerce Bar / Quick contact own values are empty shows the channels (server HTML; `29a2282` did not), a shop whose own values are set is byte-equal to `29a2282` (positive control: the fallback shop differs) |
| `ct1-editorial` `ct1-no-shadows` `ct1-footer-width` | **cat-theme-1, the theme details** (`docs/slices/cat-theme-1-impl.md`; fixtures `CT1` — each with a `locale`, so not an en-US subject — requests `CT1_REQUESTS`, before side `locale-1/theme-1/before/` from `0865ac6`, which ignores every new field): `ct1-editorial` — a catalog copy with EVERY new theme field set renders each, and each asserted string is absent from its `0865ac6` capture: the font request (`400;700` ∪ the listed weights, ascending, on all three families incl. the nav font), `:root` (`--font-nav`, muted text, border and input hairline colours, `--section-gap`), the heading-weight, no-shadow and arrow rules, the header's 3 px primary top border, the nav-font class, the arrow marker on exactly the two nav links and the contact button, the footer on the surface colour at 1440 px, the section gap on the content-page and listing wrappers, landscape cards with the first category's name on every card, the 50 % spec table with hairlines, and the page's stylesheet holding every new class (Tailwind compiles only names written in the scanned files); the header's 1920 class name was already emitted at `0865ac6` (a pass-through string) — what is new is its compiled rule. `ct1-no-shadows` (round 2) — on a `/hero` page with a cover hero (not in `before/`), every class whose compiled rule sets and paints a shadow variable (`box-shadow` / `filter`) must have it forced by the editorial block (`--tw-shadow`, `--tw-drop-shadow`); the same evaluator reports the round-1 rule and the default-shape control tenant; rings are untouched. `ct1-footer-width` — a site with ONLY `footer.contentMaxWidth` (1600 px): footer at 1600, header at its default `max-w-7xl`, and the page byte-equal to `0865ac6` (CM1-A1 + the resolved payload) but for the footer width (one listed category-3 entry, HTML and payload), with a positive control |
| `loc1e-html-lang` `loc1e-404-document` `loc1e-category-controls` `loc1e-cache-headers` | **locale-1e, `<html lang>` per tenant** (`docs/slices/locale-1e.md`; `app/[siteId]/layout.tsx` is the root layout, `app/not-found.tsx` the root 404 boundary): every 200 HTML page of the RO copies `loc1-ro-*` opens `<html lang="ro">`, every en-US subject page and the `LOC1E` en-GB and malformed-locale (`"123"`) homes `<html lang="en">` (literals, not the helper). `loc1e-404-document`: the 404 landings of a known tenant, the RO copy and a missing tenant (`LOC1E_404_REQUESTS`) each equal one of the d9999d2 `__next_error__` shell variants in `locale-1/1e/before-404/` (minus the category's stylesheet preload) with a payload moved by category 4, whose root 404 boundary is exactly `<html lang="en"><body class>` + Next's 404 UI. CI infers the rendered 404 document from the payload; the browser evidence (headless Chromium) is recorded in `docs/slices/locale-1e.md` § 5, not automated. `loc1e-category-controls`: the refusals of category 4 on real pages (23 since `cat-quote-1`, whose F-CQ-3 correction made a consistent stylesheet rename — what a new client build does — a positive control; texts, `lang`, links and scripts added or removed; CHANGED URLs that CM1-A1 masks — the `[siteId]` script `src`, the payload and head stylesheet `href`, the root-layout script in the head — caught by the category's raw half; a style preload removed on a 200 page; a shell missing another href or two preloads). The error shell is identified by its raw `__next_error__` response, never by a URL list. `loc1e-cache-headers`: status, `cache-control`, `content-type` and `vary` of every request of `EN_US_REQUESTS`, `LOC1_REQUESTS` and `LOC1E_PROBE_REQUESTS` equal `locale-1/1e/before-headers.json` (from `d9999d2`, each URL requested twice there); bound mutation: one changed field is reported. Runs last in the `next`-only block |
| `iso1`…`iso4` | **not contract rows** — the suite's own isolation, which every row above depends on for its meaning. See *Credential-free* below |

Every *absence* assertion (`no 404 stored`, `no entry for the failed render`) is paired with
a **positive control** using the same detector, so a silently-broken detector fails the suite
instead of passing it. Same reason the `ddb-stub` reports `unhandled` reads and the suite
asserts that list is empty: a stub that invented absence would be the very defect
`CACHE-1-D4` removed from `lib/dynamo.ts`.

## How it runs

`next build` → `next start` on an ephemeral port → sequential HTTP requests, with
`AWS_ENDPOINT_URL_DYNAMODB` pointed at an in-process stub. This is the recipe documented in
`docs/caching-architecture.md` § *Measured serving behaviour*, committed.

- **`fixtures.mjs`** — the DynamoDB items, in the shapes `lib/dynamo.ts` reads back. Hosts
  use the `.test` TLD (RFC 6761 §6.2: permanently non-resolvable). Two isolation tenants
  (`a.serving-contract.test`, `b.serving-contract.test`) serve only the bundle B-rows
  (`opennext-1a` increment 2); no `next`-target row requests them.
- **`ddb-stub.mjs`** — DynamoDB JSON-1.0 responder. Not an emulator: it implements exactly
  the read shapes the renderer emits and answers anything else with a loud error. Control is
  by plain methods on the returned handle — `stats()`, `reset()`, `failContentReads(bool)`,
  `putItem(item)` (an admin edit on that stub's own copy of the fixtures; bundle B-rows) —
  because the stub and the assertions share one process. (The `cache-1` probe harness used an
  HTTP `/__ctl/…` plane only because its probes were separate shell scripts.) On the
  `bundle` target it also serves the OpenNext tag-cache table (`startDdbStub({ tagTable })`),
  counted in `tagCache`, never in `render`; fault injection stays on the renderer's table.
- **`harness.mjs`** — build/serve/HTTP helpers, the constructed child environment, the
  `SERVING_TARGET` switch, and `operationInventory` (bundle target). `request()` takes an
  optional `body` and `timeoutMs` and returns `rawHeaders` too.
- **`no-dotenv.cjs`** — the preload that hides `renderer/.env*` from the children, plus the
  journal the isolation assertions read back.
- **`contract.test.mjs`** — the assertions.

`.next` is deleted before the build. `next start` persists on-demand ISR entries under
`.next/server/app/<host>/<path>.{html,meta,rsc}`, and a leftover entry would answer the
suite's first request `HIT` — silently voiding the MISS→HIT row.

### Credential-free

The child processes get a **constructed** environment, not an inherited one. `rendererEnv()`
in `harness.mjs` is the complete list of what `next build` / `next start` can see.

1. **No `...process.env`.** Exactly four OS variables cross over — `PATH`, `HOME`, `TMPDIR`,
   `CI`. An ambient `AWS_PROFILE`, `AMODX_API_KEY` or CI secret cannot reach the renderer, so
   the suite cannot exercise a credentialed path and pass for the wrong reason. Assertion
   `iso1` fails if an unlisted name appears — i.e. if the spread ever comes back.
2. **`renderer/.env*` is invisible to the children**, two independent ways:
   - `no-dotenv.cjs` makes those paths throw `ENOENT` from `fs.statSync`/`readFileSync`.
     `@next/env`'s loader then takes the branch it already takes on a checkout without the
     file — the only branch CI ever sees. Nothing on disk is touched. The predicate is
     narrow: direct children of `renderer/` whose basename starts with `.env`, nothing else.
   - `__NEXT_PROCESSED_ENV=true` makes `@next/env`'s own `processEnv()` return before its
     merge loop, independently of how the file was read. On its own this is **not** enough
     for the slice's constraint: `loadEnvConfig`'s `statSync`/`readFileSync` loop runs
     *before* `processEnv()`, so the guard stops the merge but not the read.
3. `AWS_ENDPOINT_URL_DYNAMODB` addresses `127.0.0.1`, so no SDK call can leave the host.
   `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are fixed literals: the SDK needs *some*
   credentials to sign, and the stub ignores signatures.
4. `NEXT_TELEMETRY_DISABLED=1` — the build makes no outbound request either.
5. `next` is run as `node <resolved next bin>`, not through `npx`: a plain Node child is what
   makes a four-entry environment sufficient, and `npx` would reach the network on a cache
   miss.

#### How the hook reaches the whole process tree

`next build` is not one process. It forks build/export workers, and those workers call
`loadEnvConfig` themselves (`next/dist/export/index.js`, `next/dist/server/config.js`). So the
hook has to be delivered by a channel every one of them inherits.

It is delivered in **`NODE_OPTIONS`**, not as an argv `--require`. `fork()` inherits the
parent's `process.execArgv` only when the caller does not supply its own — and jest-worker
always does (`next/dist/lib/worker.js:98-107`), so argv flags are dropped at that hop while
the environment is always inherited. MEASURED outside Next:

| delivery | `fork(child, {execArgv: []})` | `new Worker(child, {execArgv: []})` |
|---|---|---|
| `node --require pre.cjs parent.js` | **not** preloaded | — |
| `NODE_OPTIONS='--require "pre.cjs"'` | preloaded | preloaded |

`iso3` turns that from an argument into a measurement. `no-dotenv.cjs` appends one record per
process it loads into, and one per `.env*` access it refuses, to a journal in `$TMPDIR`;
`iso3` reads the journal back after the real build and boot and asserts the build process,
**at least one process the build spawned**, and the live server are all in it. MEASURED
2026-07-28 on this repo: **14 processes covered, 12 accesses blocked.**

`iso3` also asserts something that does not depend on our journal or our hook at all: `next
build` reports the env files it loaded, itself, as `- Environments: <files>` — printed only
when the list is non-empty (`next/dist/server/lib/app-info-log.js:104`, fed by
`next/dist/build/index.js`). Its absence is the build's own first-party statement.

Both signals are demonstrably live. Re-running the same real build with the hook removed
entirely (2026-07-28, throwaway script, not committed):

| delivery | processes covered | accesses blocked | build printed `- Environments:` |
|---|---|---|---|
| `NODE_OPTIONS` — *what the suite runs* | 13 | 8 | no |
| argv `--require` (revision 1) | 13 | 8 | no |
| no hook | **0** | **0** | **yes** |

The middle row is worth stating plainly rather than quietly dropping: on `next@16.2.12`
revision 1's argv delivery *did* in fact reach the workers, because Next rebuilds each
worker's `NODE_OPTIONS` from `[...process.execArgv, ...NODE_OPTIONS]`
(`server/lib/utils.js#getParsedNodeOptions`). It was correct by accident, through an
undocumented internal of a dependency that `sec-1` has already bumped once. Revision 2 does
not rely on it, and `iso3`/`iso4` fail if the property stops holding.

`iso4` pins the transitive half directly: `@next/env#loadEnvConfig` run one hop deeper, in a
process launched with its own argument vector, must still load nothing. Its **positive
control** points the identical probe at a throwaway directory holding a decoy `.env.local`
and requires `loadedEnvFiles` to fill — otherwise an empty result could just mean the field
stopped being populated. (The decoy's keys still do not reach `process.env`: that is
`__NEXT_PROCESSED_ENV` doing its half, observed live.)

`iso2` remains the narrow version of the same check — `loadEnvConfig` under the suite's exact
environment, one hop. **MEASURED 2026-07-28**, each mechanism removed in turn against the
operator's real `.env.local`:

| `fs` hook | guard | `loadedEnvFiles` | keys injected |
|---|---|---|---|
| ✅ | ✅ | `[]` | 0 — *what the suite runs* |
| ❌ | ✅ | `[".env.local"]` | 0 |
| ✅ | ❌ | `[]` | 0 |
| ❌ | ❌ | `[".env.local"]` | 5, incl. `AMODX_API_KEY` |

Both are load-bearing and they fail differently: the hook stops the *read*, the guard stops
the *merge*. The last row is what this suite did before revision 1.

The suite is additionally self-evidencing: a renderer talking to a real table would find no
fixture tenant and every assertion would go red.

## Why `node:test`

No test framework is installed for this suite, and none is needed: it makes HTTP requests
and reads response headers. There is no module to mock, no DOM, and no TypeScript to
transform (the files are `.mjs`, so `npm run typecheck` and `next build` ignore them).

The reason it is not vitest is the repo's own history. `test-1` had to hand-repair
`package-lock.json` because npm records only the platform variants of native binaries that
resolved on the authoring host, and CI's `npm ci` then failed on Linux
(`docs/TECH-DEBT.md`). Vitest pulls in exactly that family (rollup, esbuild). A suite whose
job is to be green from a bare checkout should not add that risk for a feature it does not
use. `test-3` may still add vitest to `renderer` for pure unit tests — that is orthogonal;
the two can coexist, and porting this file if it ever becomes worthwhile is mechanical.

**Update, `test-3` (2026-07-28): it did.** `renderer/test/unit/` is a vitest suite and
`npm test -w renderer` runs it; this file still runs only under `npm run test:serving`. The
lockfile risk above did not materialise — vitest 4.1.8 was ALREADY in the tree for
`backend`, so the change added a `devDependencies` line to two workspace manifests and
resolved zero new packages (verified: `npm ci --dry-run` against the hand-edited lockfile
in an isolated copy, 1571 packages, exit 0 — the same count as before).

The two suites are kept apart by `renderer/vitest.config.ts`, whose `include` is narrowed
to `test/unit/**/*.test.ts`. Do not widen it: vitest's default glob matches
`contract.test.mjs`, and running this file under vitest would bypass `harness.mjs` — which
is the thing that CONSTRUCTS the child environment. The credential-free claim would then be
asserted rather than measured, which is precisely the failure mode `(iso1)`–`(iso4)` exist
to prevent.

## Deliberate limits

- **Origin only.** No CloudFront, no warm-edge probes — slice non-scope. The cache-key half
  of `H1` (`RSC` header) and `H3` (`x-has-session`) lives in
  `infra/lib/renderer-hosting.ts` and belongs to `cdk synth` assertions (slice `test-4`) and
  to the operator's post-deploy runbook.
- **`next start`, not the OpenNext Lambda bundle** — on the `next` target. `cache-1`
  re-measured every row through the built bundle and found them identical; the committed
  OpenNext harness is the `bundle` target (slice `opennext-1a`, `../serving-bundle/`), run at
  the deploy gate rather than in PR CI.
- **`ProjectionExpression` is ignored by the stub.** Returning extra attributes cannot change
  an assertion here, and honouring it would add a parser with no caller.
- **POSIX only.** `OS_PASSTHROUGH` carries no `SystemRoot`/`ComSpec`, so a Windows host would
  need one line added. macOS (operator) and `ubuntu-latest` (CI) are the demonstrated hosts;
  the entry was not added speculatively.
- **The journal sees a process only if the hook loaded in it.** A Node process that inherited
  neither our environment nor our flags would be invisible to `iso3`(b) — which is why
  `iso3`(a), the `- Environments:` reading, is asserted alongside it: that one comes from the
  build itself and needs no cooperation from us. Closing the gap completely would take an OS
  syscall trace (`dtrace`/`strace`), which needs privileges CI does not have and would make
  the gate non-portable. Not built.
- One build, one server, sequential requests. Measured wall time ≈ 9–10 s.
