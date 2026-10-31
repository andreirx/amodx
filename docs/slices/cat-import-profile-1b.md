# CAT-IMPORT-PROFILE-1B — shared listing + facet rules, filter-mode precedence and display (IMPL record)

Status: **IMPLEMENTED** (2026-10-31; iteration 1 after review-0 `revise`, § 12) — code complete; review and the
operator's staging evidence (§ 10) pending
(`docs/documentation.md` § Status taxonomy). Uncommitted on `main` at `2cf738e`.
Contract: the ratified design `docs/slices/cat-import-profile-1.md` — § 7.1 slice `1b`, § 7.2 oracles, § 7.3 the 1b
golden, § 7.4 the 1b units, § 2.6, § 5.2 / § 5.5 — under § 11: **CIP1-PREVIEW = A** (the listing rule and the facet
function move to `packages/shared`) and **CIP1-FILTER-PRECEDENCE = S-A with N2** (modes copied onto products; `always`
overrides the repeat rule; `never` suppresses the OFFER only, matching and counts kept).
Maturity: `packages/shared/src/facets.ts` and `catalog-listing.ts` stay **PROTOTYPE** (the facet module was PROTOTYPE in
the renderer); MATURE when the staging evidence of `cat-facets-1.md` § 8.4 and of design § 7.5 is recorded.
Track F — Glam catalog. Vision tie: guarantee 3 (the listing and filter rules are pure functions, tested off-target;
DynamoDB and Next stay at the edge — `getCatalogListing` keeps only the read); "expand before contract" (1b ships
inert: no product carries `facetModes` until a profiled import writes it, and with no `facetModes` the shared
functions reproduce the base commit's output — proven against a golden captured from `2cf738e`, § 3).

Evidence labels: **EXECUTED** = a command was run in this session; **OBSERVED** = read in a file; **INFERRED** = a
conclusion, not run. Gate logs: `.agent-manager/slices/CAT-IMPORT-PROFILE-1B/gates/` (relay's gitignored directory).

---

## 1. What changed, per step of the packet (file:line on the working tree)

| Step | Change | Where |
|---|---|---|
| 0 | Golden captured from `2cf738e` BEFORE any product-code edit (§ 3) | `packages/shared/test/fixtures/cat-import-profile-1b-baseline.json`; harness `packages/shared/test/fixtures/cat-import-profile-1b-capture/` (`run.sh`, `recorder.ts`, `setup.ts`, `listing.capture.ts`, `vitest.capture.config.ts`, `merge.mjs`); record shape + serialiser `packages/shared/test/cat-import-profile-1b-golden.ts`; in-memory store `renderer/test/unit/memory-dynamo.ts` |
| 1 | `renderer/src/lib/facets.ts` → `packages/shared/src/facets.ts` (move; the module body is unchanged except the step-2 additions and its header). **The renderer file is DELETED, not a re-export**: it had one importer (`SitePage.tsx:41`, operator fact § 0, re-checked by `grep -rn "lib/facets"` over `renderer/src`, `renderer/test`, `renderer/middleware.ts`, `admin/src`, `packages/*/src`, `tools/mcp-server/src`, `backend/src`), which now imports `@amodx/shared`; a shim would be a second name for the same module | `packages/shared/src/facets.ts` |
| 1 | New pure module: `utcDay` `:26`, `isProductAvailable(p, today)` `:35`, `catalogListing(items, categoryId, today)` `:53`, `catalogListingPath(prefixes, categorySlug)` `:72` — the base rule of `dynamo.ts:411-417`, `:75-81` and `SitePage.tsx:293`, `:306`, unchanged | `packages/shared/src/catalog-listing.ts` |
| 1 | Explicit re-exports (exports only) | `packages/shared/src/index.ts:28-38` |
| 1 | `getCatalogListing` keeps the query and returns `catalogListing(allItems, categoryId, utcDay(new Date()))` `:411`; the file's local `isProductAvailable` `:76` is now the shared rule bound to today's UTC day (its 5 callers unchanged) | `renderer/src/lib/dynamo.ts:50`, `:76-78`, `:411` |
| 1 | Imports from `@amodx/shared` `:25`, `:41`; the two page paths via `catalogListingPath` `:293`, `:306` | `renderer/src/components/SitePage.tsx` |
| 1 | `renderer/test/unit/facets.test.ts` → `packages/shared/test/facets.test.ts`: only the header and the import path changed (EXECUTED `diff` against `git show HEAD:…`: 2 hunks) | `packages/shared/test/facets.test.ts` |
| 2 | `facetModes` rules (§ 2.6, N2): `FacetProduct.facetModes` `:63`; `modesOf` `:185` (tolerant read; unknown = automatic; first entry of a key decides); `isSilent` `:210`; `facetDefs` `:248` (offer over non-silent holders; `always` `:274`; the § 13 order over every holder, iteration 1); `buildFacetListing` `:387` (modes `:389`; listed values = non-silent holders' values + selection `:407-425`; counts and matching over every product, unchanged) | `packages/shared/src/facets.ts` |
| 3 | Catalog listing projection gains `facetModes` | `renderer/src/lib/dynamo.ts:403` |
| 4 | `ProductAttributes`: a repeated key is one row at its first entry, values in stored order joined by ", " | `renderer/src/components/SitePage.tsx:799-824` |
| 5 | Serving fixture tenant `cip1b-catalog` (block `CIP1B`), rows `cip1b-never` `:1705`, `cip1b-variant-never` `:1717`, `cip1b-mixed` `:1728`, `cip1b-shop-modes` `:1745`, `cip1b-attributes-joined` `:1758`; import line `:40` gains `CIP1B`. `cm1-byte-identity/` untouched | `renderer/test/serving-contract/fixtures.mjs:422-462`, `:517`; `contract.test.mjs` |
| units | `packages/shared/test/facet-modes.test.ts` (19, § 2.6 + § 3.3 item 6), `catalog-listing.test.ts` (16), `cat-import-profile-1b-golden.test.ts` (5); `renderer/test/unit/catalog-listing.test.ts` (4: golden through `getCatalogListing`, projection, same-rule) | — |
| 6 | `renderer/ARCHITECTURE.md` (§ Catalog listings and filters; the `lib/` tree), `packages/shared/ARCHITECTURE.md` (tree, Functions table, When Modifying). `docs/caching-architecture.md` NOT changed: no serving row changed meaning (only new rows) | — |

### 1.1 How the filter modes work (for the reviewer)

For each facet the function now asks one more question per product: **is this product a SILENT holder of this facet?**
— it marks the attribute key `never`, or it carries `variant: "never"` for the variant facet. The producer facet has no
mode. Then, under N2:

| Step | Base (today) | With modes (N2) |
|---|---|---|
| Is attribute `k` offered? | repeat rule over all holders | `always` on some non-silent holder, OR the repeat rule over the non-silent holders |
| Which values are listed? | every held value + the selection | the non-silent holders' values + the selection |
| Is the facet shown? | some held value is held by < all products | some LISTED value is held (by anyone, silent included) by < all products |
| Matching a selection | every product's values | unchanged |
| Counts of a listed value | every product (other facets' selections applied) | unchanged — silent holders count |
| Facet order | by holders | unchanged — by EVERY holder, silent ones included (review-0 R1) |

With no `facetModes` on any product nobody is silent and nothing is `always`, so every row of the right column equals
the left one — the golden (§ 3) proves it on 2,348 recorded calls. The renderer reads `facetModes` raw: anything it does
not know (a mode other than `always` / `never`, a `variant` other than `never`, a non-object, a non-array `attributes`,
an entry without a key) is automatic (§ 3.3 item 6), so a newer importer's value can only make a filter APPEAR, never
hide a value or a product.

## 2. Gates (§ 7.2 + packet § 2; bare exit codes; final run on the final code, fresh build)

The table shows the iteration-1 run (§ 12) on the final code: logs `gates/iter1-*.log`. Iteration 0's runs
(`gates/g*.log`, `x*.log`, `final-*.log`) gave the same counts. In iteration 1 the first serving run
(`iter1-g6-serving.log`) exited 1 with 0 pass / 0 fail / 71 cancelled: `next start` could not bind its port
(`EADDRINUSE :::55274` — the harness picks a free port, then binds it; another process took it in between; nothing held
it afterwards, `lsof`). That is an environment failure, not a result. The re-run (`iter1-g6-serving-rerun.log`) is the
row below.

| # | Command | Exit | Last line(s) | Label |
|---|---|---|---|---|
| 1 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run build; echo "exit $?"` | 0 | `> tsc` | EXECUTED |
| 2 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run typecheck; echo "exit $?"` | 0 | `> tsc --noEmit` | EXECUTED |
| 3 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/shared" && npm test; echo "exit $?"` | 0 | `Tests  196 passed (196)` (118 + 38 moved + 40 new) | EXECUTED |
| 4 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend" && npm run test:unit; echo "exit $?"` | 0 | `Tests  1133 passed \| 1 skipped (1134)` | EXECUTED |
| 5 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm test; echo "exit $?"` | 0 | `Tests  104 passed (104)` (138 − 38 moved + 4 new) | EXECUTED |
| 6 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving; echo "exit $?"` | 0 | `# pass 71` / `# fail 0` (66 + 5 `cip1b-*`); 32 `cm1-identity` comparisons `same`, 0 `DIFF` | EXECUTED |
| 7 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/admin" && npm run test:unit; echo "exit $?"` | 0 | `Tests  65 passed (65)` | EXECUTED |
| 8 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/tools/mcp-server" && npm test; echo "exit $?"` | 0 | `# pass 11` / `# fail 0` (`routes.json: 112 routes`; no route change) | EXECUTED |
| 9 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/infra" && npm test; echo "exit $?"` | 0 | `Tests: 61 passed, 61 total` (`AmodxStack(parent)=401/53fn` as in 1a) | EXECUTED |
| 10 | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check; echo "exit $?"` | 0 | (nothing) | EXECUTED |
| + | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving-bundle; echo "exit $?"` | 0 | `# pass 58` / `# fail 0` | EXECUTED |
| + | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:interest-e2e; echo "exit $?"` | 0 | `5 passed` (incl. `cf1-prefetch`) | EXECUTED |
| + | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --stat -- backend admin infra tools` | 0 | prints nothing | EXECUTED |
| + | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" status --porcelain -uall` | 0 | 26 paths (9 tracked: 7 `M`, 2 `D`; 17 untracked incl. this record) — all inside the packet's allocation | EXECUTED |
| + | each untracked file: `git diff --no-index --check /dev/null <file> \| wc -l` | — | `0` for every file | EXECUTED |

## 3. The 1b golden (§ 7.3)

- Base commit: `2cf738e54f6c23975efdbb8839d920a38b5fc571`. Worktree `/tmp/CAT-IMPORT-PROFILE-1B-baseline` (outside the
  repo tree), created and removed by `run.sh` (trap); afterwards `git worktree list` shows no such entry and `/tmp`
  holds no `CAT-IMPORT-PROFILE-1B*` path (EXECUTED).
- File `packages/shared/test/fixtures/cat-import-profile-1b-baseline.json`, 7,277,764 bytes,
  **sha256 `f3507cdebb157d4a06113cd36599ebf3d13e69ffafd90ca847bf972bb22641a8`**. Captured three times with the final
  harness: the same sha256 each time (EXECUTED). Serialiser `cat-import-profile-1b-golden.ts` sha256
  `08418ffedb18c938dbd93e1ecd246cc69660530d51695f0ae6f9ea574e884aad`.
- **How it was captured.** `run.sh 2cf738e`: worktree of the base; the main checkout's `node_modules` linked in
  (dependencies only); the harness copied into `<worktree>/renderer/test/capture/`; the worktree's `git status` checked
  to list only the harness and the links (a modified base file aborts the run). Then vitest ran, in the worktree:
  (1) the BASE `renderer/test/unit/facets.test.ts`, UNCHANGED, with its import of `../../src/lib/facets` aliased to a
  recorder that re-exports the base module and records every `buildFacetListing` and `facetValuesOf` call (input and
  output; 38 tests passed under the recorder); (2) the listing capture: the BASE `getCatalogListing` over the in-memory
  store, clock fixed at `2026-10-31T12:00:00Z`, for the serving catalog tenant (7 scopes) and an edge fixture (16
  products: draft, status-less, empty status, archived, window starts tomorrow / today, ends yesterday / today,
  `categoryIds` absent / not an array, `sortOrder` ties and negatives, another tenant's item, a non-product item; 4
  scopes), then the base `buildFacetListing` over each serving base set × the 33 `f` values the `cf1-*` rows send (and
  the malformed witnesses, the over-budget witness, the 6,125-byte `cf1-pager-guard` selection).
- **Contents:** 2,025 distinct base sets, 2,138 `buildFacetListing` calls and 1 `facetValuesOf` call from the test file;
  11 listing calls; 198 serving panels. Every input is kept in full. Every output carries the sha256 of its serialised
  form; the full output is kept when ≤ 4,096 bytes (326 of 2,336 panel outputs; every listing output in full). Reason: with
  every output in full the file was 72.8 MB (the 2,000-run property test and the 147-value greedy steps).
- **Comparison** (the no-`facetModes` case; a unit asserts that no input item holds the key):
  `packages/shared/test/cat-import-profile-1b-golden.test.ts` — the shared `buildFacetListing` / `facetValuesOf` /
  `catalogListing` over the same inputs: equal digest for every call, deep-equal where the output is kept: **5/5 pass**;
  `renderer/test/unit/catalog-listing.test.ts` row (1) — the renderer's own `getCatalogListing` over the in-memory store:
  deep-equal items (membership, order and projected fields) for all 11 calls: **pass** (EXECUTED).
- **Positive controls** (EXECUTED, then restored; sha256 of the restored files re-checked): `MIN_HOLDERS` 2 → 3 makes the
  two `buildFacetListing` golden rows red; `today > until` → `>=` makes the listing row red (the edge product that ends
  today).
- The serving suite's existing rows pass unchanged: 66/66 incl. 32 `cm1-identity` comparisons `same` and every `cf1-*`
  row (gate 6).

## 4. § 7.4 units and controls

- **§ 2.6 rows, one per table line** (`facet-modes.test.ts`): mixed witness — `Esență` offered, Oak (3) Ash (1);
  selecting Oak lists x1, x2 AND b1; b1's item unchanged; a value only a silent holder has is not listed, but selected
  through the URL it matches with its count. Single-producer table — 147 collections with `always` → offered, 147
  values (without the modes: absent); BOEN `Certificates` never → not shown (without: shown, FSC (3)); ITC
  `variant: never` → `varianta` not shown (without: 5 values); ITC never + BOEN → BOEN sizes only, and an ITC colour
  selected through the URL still lists the ITC products; `always` on 1 of 20 → offered and shown; `always` on every
  product with one value → not shown (shown when selected); no / empty `facetModes` → equal to no field.
- **N2 detail:** two silent + one automatic holder → not offered (rule (i) over non-silent); one silent + two automatic
  → offered, count 3; facet order by EVERY holder (3 holders, 2 of them silent, sort before 2 — review-0 R1's witness;
  control: sorting on non-silent holders turns the row red); a `producator` key in `facetModes` does not touch the brand.
- **§ 3.3 item 6:** mode `sometimes` → neither never nor always; `variant` `always` / `maybe` → automatic; seven
  malformed shapes → automatic; a key listed twice → the first entry decides (an unknown first entry is not skipped).
- **Mutation controls** (EXECUTED, restored, sha256 re-checked): `never` as a no-op → 7 rows red; N1-style counts (silent
  holders not counted) → 5 red; `always` ignored → 4 red.
- **Serving control** (EXECUTED): modes disabled in the built shared package and `ProductAttributes` showing the first
  value only → `cip1b-never`, `cip1b-variant-never`, `cip1b-shop-modes`, `cip1b-attributes-joined` red; `cip1b-mixed`
  stays green — on that witness the base rule and N2 agree (it separates N2 from N1 and N3, which the units pin).
- **Projection:** the serving DynamoDB stub ignores `ProjectionExpression` (`ddb-stub.mjs:253`), so the serving rows
  cannot prove step 3. `renderer/test/unit/catalog-listing.test.ts` row (2) does: the query names `facetModes`, the
  in-memory store applies the projection, a carried `facetModes` is returned. Control: without `facetModes` in the
  projection the row is red (EXECUTED).
- **Same rule** (§ 5.5, the shared-rule half): `getCatalogListing` and `catalogListing` give the same ids in the same
  order over both golden fixtures and every scope (renderer row (3)); `catalog-listing.test.ts` states each membership
  case (kept active, draft, legacy status-less: category yes / shop no, window tomorrow / yesterday) and the paths
  (defaults, `/categorie`, empty shop prefix). The admin assembly rows of § 5.5 belong to 1c.

## 5. Abstraction lines

- `packages/shared/src/facets.ts` (moved) — users: `renderer/src/components/SitePage.tsx` (catalog shop + category);
  slice 1c's admin preview (ratified CIP1-PREVIEW = A); axis: none — one rule, two apps; the `facetModes` sum is read
  with an exhaustive comparison on the two known values (`always` / `never`), everything else = automatic; rejected: a
  copy in admin (duplicates non-trivial logic; the preview drifts from the site).
- `packages/shared/src/catalog-listing.ts` (new module: `catalogListing`, `isProductAvailable(p, today)`,
  `catalogListingPath`, `utcDay`) — users: `renderer/src/lib/dynamo.ts` (`getCatalogListing` + 5 availability checks),
  `SitePage.tsx` (2 paths); 1c; axis: none (same as above); rejected: leaving the rule inside `getCatalogListing` (the
  preview could not call it without DynamoDB). `utcDay` is the one place that defines `today` (UTC day) for both
  callers; rejected: `new Date().toISOString().split("T")[0]` repeated at each call site (2 in the renderer, 1 in 1c).
- `renderer/test/unit/memory-dynamo.ts` (test seam) — users: `catalog-listing.test.ts`, the golden capture; axis: none;
  needed because the serving stub ignores projections and the golden must replay through the real `getCatalogListing`;
  rejected: a mock returning canned arrays (cannot show what the projection returns).
- `packages/shared/test/cat-import-profile-1b-golden.ts` (serialiser) — users: the capture and the shared comparison;
  rejected: two serialisers (the golden and the candidate would be reduced by different code).
- No interface, registry, adapter or config layer. `modesOf` / `isSilent` are private functions of `facets.ts`.

## 6. Builder decisions (local; recorded, not asked)

- B1b-1 A key listed twice in a product's `facetModes`: the FIRST entry decides; an unknown first entry is automatic and
  is not skipped for a later one (the importer writes each key once, `checkProfile`).
- B1b-2 (WITHDRAWN by review-0 R1) Iteration 0 ordered attribute facets by non-silent holders. That changed the
  ratified `cat-facets-1.md` § 13 order, which § 2.6 does not touch. The order is by every holder again (§ 12).
- B1b-3 `variant` values other than `"never"` are automatic (the schema has only `never`).
- B1b-4 `renderer/src/lib/facets.ts` deleted, no re-export (one importer).
- B1b-5 `ProductAttributes` joins all stored values in stored order, no de-duplication (the importer de-duplicates by
  `norm`, design § 2.5); the row sits at the key's first entry.
- B1b-6 The serving fixtures are a NEW tenant `cip1b-catalog`, not new products on `cm1-catalog`: the `cf1-*` and
  `cm1-*` rows assert counts of that tenant (e.g. 42 on the shop) and must stay unchanged.
- B1b-7 The golden keeps every input, a digest of every output, and the full output when ≤ 4,096 bytes (§ 3).
- B1b-8 `dynamo.ts` keeps its local `isProductAvailable(p)` as a one-line binding of the shared rule to the clock, so
  its 5 callers do not change.
- B1b-9 `catalogListingPath(prefixes, categorySlug | undefined)`: the design wrote `scope`; the parameter is named for
  what it is (a category SLUG, while `catalogListing` takes a category ID).

## 7. Copy

No new copy. The only visible change is the separator `", "` between the values of a repeated attribute key (design
§ 2.5).

## 8. Findings and follow-ups (named, not fixed)

- **F-1B-1 `"/magazin"` literal fallback.** `catalogListingPath` keeps the renderer's `prefixes.shop || "/magazin"`
  (`SitePage.tsx:306` on the base), a Romanian default that differs from `URL_PREFIX_DEFAULTS.shop` (`/shop`) and from
  the project rule "never hardcode a country-specific value as a universal default". Reached only when a tenant's
  stored `urlPrefixes.shop` is the empty string (INFERRED: the schema default fills `/shop`). Changing it changes a
  public URL — a decision, not a cleanup.
- **F-1B-2 Stale pointers outside the allocation.** `backend/src/import/glam/profile.ts:513` names
  `renderer/src/lib/facets.ts` and restates `MIN_HOLDERS` / `MAX_ATTRIBUTE_VALUES`; it could now import them from
  `@amodx/shared`. `renderer/src/lib/review-images.ts:23` says `isProductAvailable` is duplicated in `dynamo.ts` (the
  renderer's copy is now the shared rule; `backend/src/lib/availability.ts` is still a copy). The rmap `*_MAP.md` files
  (`packages/shared/src/MAP.md`, `renderer/test/unit/MAP.md`, …) are generated and not regenerated. Historical slice
  docs keep the old path on purpose.
- **F-1B-3 Variant heading over silent holders.** `variantLabel` reads every product's group name (the § 12 rule: the
  modes change only the offer and the listed values): on a shop with ITC (`Culoare`, `variant: never`) and BOEN
  (`Format`) the facet lists only BOEN's sizes but is headed "Variantă". § 2.6 does not state a heading rule; reading
  only non-silent holders' names would be a design change. For the human or 1c.
- **F-1B-4 Golden size.** 7.3 MB tracked JSON (inputs). Acceptable next to 1a's 4.5 MB; a later slice that changes the
  facet module on purpose must re-capture with `run.sh` from its own base.
- **F-1B-5 When a mode change becomes visible.** Only the dynamic `/_site/<id>/…` path (never cached,
  `renderer/middleware.ts` `/_site/` branch) shows a changed `facetModes` on the next request. A direct DynamoDB write
  (the staging witness below) triggers no invalidation at all. A glam import is wrapped in `withInvalidation`
  (`backend/src/import/glam-pricelist.ts:327`), which drives only the bulk `/*` edge debounce — ≤ ~16 min, or "GO LIVE
  NOW" — and no ISR purge (`docs/caching-architecture.md` § Per-mutation-class table, "Bulk / global"). I make no claim
  about when a cached public bare page shows a mode change; that is cache behaviour this slice does not change.

## 9. What I could not determine

- The projection on real DynamoDB (`facetModes` is a map attribute; DynamoDB returns it as projected — INFERRED from
  the API contract; the serving stub ignores projections; the unit store applies them). Staging item 3 below — the
  mode-bearing witness — checks it: its panels change only if the read returns `facetModes`. (Item 2 has no product
  with `facetModes`, so it cannot.)
- The cost of the extra projected field per product (one small map, absent on every product today) — not measured.
- Whether any stored tenant has `urlPrefixes.category` absent (the path would read `undefined/<slug>` — base behaviour,
  kept). Not checked.

## 10. Operator staging checklist for 1b (after the renderer deploy; tenant `cm1-catalog` and the non-catalog tenants)

1. **CM1-BYTE-IDENTITY Layer 2** on the staging commerce and content tenants, as `cat-facets-1-impl.md` closeout item 5
   (design § 7.5 item 7): PASS expected (1b changes the renderer).
2. **Inert on real data:** before any write, on the dynamic path `/_site/<cm1-catalog id>/shop` and
   `/_site/<id>/category/boen`, the panel equals what an independent `aws dynamodb query` of the tenant's `PRODUCT#`
   items gives (active + available products; per facet value, the number of products holding it). For reference only,
   the `cat-facets-1-impl` closeout recorded 441 products, `varianta` "Format" with 26 values, `a.colecție` with 27
   values summing to 437 — the query of the day is the expectation, not these numbers. No product carries
   `facetModes` (operator fact § 0), so this item cannot exercise the new projection.
3. **Precedence witness and projection witness, staged by writing `facetModes` on staging products DIRECTLY in
   DynamoDB (not by the importer: no stored profile exists and the 1c editor is not built).** Every expectation is
   derived from the independent query, recorded before the write. Observe only on the dynamic `/_site/` path (F-1B-5).
   (a) `never`: from the query, take the active, available ALPOD products A and their `colecție` values. Choose one
   value c held by at least one product of A. Record H(c) = every shop product (any producer) holding `colecție = c`,
   and whether some product OUTSIDE A holds c. Write `SET facetModes = {"attributes":[{"key":"colecție","mode":"never"}]}`
   on every product of A. Expect on `/shop`: c is listed in `a.colecție` only if a product outside A holds it (then
   with count |H(c)|); `a.colecție` is shown only if it is still offered — the repeat rule over the products outside A, from the
   query — and the values still listed narrow the shop (§ 2.3); and
   `?f=a.colec%C8%9Bie%3D<c, URL-encoded>` lists exactly H(c), with c shown selected, count |H(c)| (matching and
   counts kept, N2).
   (b) `always`: from the query, choose one active, available product P and an attribute key k that no other shop
   product holds. Before: no `a.<k>` facet on `/shop`. Write `SET facetModes = {"attributes":[{"key":"<k>","mode":"always"}]}`
   on P. Expect `a.<k>` with P's value(s), each count 1.
   A changed panel in (a) or (b) is also the proof that the deployed read projects `facetModes` (§ 9). Then
   `REMOVE facetModes` on every item written and check that `/shop` equals item 2 again.
4. **With a profiled import** (design § 7.5 item 2, once the operator runs BOEN with the human's profile through
   `POST /import/glam-pricelist` + `profileChoice`): on the dynamic `/_site/` path (F-1B-5), `/category/boen` without
   `Certificates` when marked `never`; a product whose `Format` holds two values shows ONE row "a, b".

## 11. Evidence log (builder, 2026-10-31)

All EXECUTED in this session; logs in `.agent-manager/slices/CAT-IMPORT-PROFILE-1B/` (`build-progress.md`, `gates/`).
`git status --porcelain -uall` empty before the first edit (OBSERVED). `run.sh 2cf738e` × 3 → the same sha256. Shared
vitest after the pure move (before step 2): 161/161 incl. the golden. Golden 5/5 after step 2; positive controls red,
restored. `facet-modes.test.ts`: one expectation of mine was wrong at first (I expected the BOEN sizes to turn `zero`
under a variant selection; § 4.1 counts ignore the facet's own selection, so they stay `link`) — the test was
corrected, the code was not changed. Serving control run: 4 red as stated in § 4. Final gates § 2.

## 12. Revision 1 (builder, 2026-10-31, after review-0 `revise`) — corrections by defect class

- **R1 — class: a filter mode applied to more than § 2.6 names.** § 2.6 (N2) changes two things: whether a facet is
  OFFERED and which values are LISTED (with visibility judged over the listed values). Iteration 0 also let silent
  holders drop out of the § 13 facet ORDER (`cat-facets-1.md` § 13: "by the number of products holding them"). **Rule
  that closes the class, stated in the `facetDefs` header:** the modes change only the offer and the listed values;
  everything else — the order, the labels, matching, counts — is computed over every product, as before. Code:
  `facetDefs` keeps `holders` (every holder) for the order and `offerHolders` / `valueHolders` (non-silent) for the
  offer. Other computations checked against the rule: `variantLabel` (every product), counts and matching (every
  product), chips (selection only) — none needed a change. Unit: the reviewer's witness (Alfa: 3 holders, 2 silent;
  Beta: 2) → `[a.Alfa, a.Beta]`; control: sorting on non-silent holders turns it red (EXECUTED). B1b-2 withdrawn;
  `renderer/ARCHITECTURE.md` and the `cip1b-shop-modes` comment corrected (that row's expected order is the same under
  both rules: Esență has 4 holders, 3 non-silent).
- **R2 — class: an operational claim in the record not backed by code or by the caching document.** (1) F-1B-5 said a
  profiled import shows a mode change "at once". It does not: the glam import's `withInvalidation` drives only the bulk
  `/*` edge debounce and no ISR purge (`docs/caching-architecture.md` § Per-mutation-class table). (2) § 9 named staging
  item 2 as the projection check, but item 2 has no product with `facetModes`. (3) Item 3(a) assumed two ALPOD
  products sharing one collection. **Rule:** every staging expectation is derived from an independent query recorded
  before the action, and no visibility timing is claimed except for the dynamic `/_site/` path. F-1B-5, § 9 and § 10
  items 2–4 are rewritten to that rule; item 3 is named the projection witness. No cache code is changed.

## 13. Operator closeout (operator, 2026-10-31)

**Review.** review-0 revise, review-1 **approved** (builder claude-opus-5-5, reviewer codex gpt-6.1-sol).

**Gates (operator, approved candidate, bare exit codes, `ALL GATES GREEN`).** build 0; typecheck 0; `packages/shared`
196; backend unit 1,133 + 1 skipped; renderer unit 104; `test:serving` 71 / 0; `test:serving-bundle` 58 / 0;
`test:interest-e2e` 5 passed; admin 65; MCP 11 / 0; infra 61; `git diff --check` 0; no change under
`backend admin infra tools`; `cm1-byte-identity/` untouched; all 26 changed paths inside the allocation (the
operator's first allocation pattern anchored directory prefixes with `$` and listed allocated test files; re-run with
prefixes matched: none outside).

**Staging CDK diff and deploy.** 0 resources added or removed; 41 functions change `Code`/`Metadata` only; assets
redeploy. `cdk deploy` → `AmodxStack-staging` ✅ (served build `Yo1pVK4cK2Hkzjv22ESsQ`).

**Staging checklist (§ 10).**
1. Layer 2 (canonicaliser) against the `cat-facets-1-impl` closeout capture: commerce **18/18**, content **14/14**
   identical; catalog 15/19 (that tenant's data changed: BOEN re-imported during 1a).
2. Inert on real data (no product carries `facetModes`): `/_site/cm1-catalog/category/boen` → `varianta` 26 values,
   `a.colecție` 27 values, every count equal to an independent `aws dynamodb query` count.
3. Precedence witnesses, staged by writing `facetModes` directly on staging items (no stored profile exists; the 1c
   editor is not built). Before: `/shop` 441 products, `a.colecție` 28 values incl. "CLASSEN - Water resistant
   laminate flooring" (2, held only by the two ALPOD products).
   (a) `never` on `colecție` for the two ALPOD products → `/shop` `a.colecție` 27 values, CLASSEN not offered;
   `?f=a.colec%C8%9Bie%3DCLASSEN…` → "2 produse", exactly the two ALPOD products, the value shown as a selected row
   "✓ CLASSEN … (2)" plus its chip (N2: matching and counts kept).
   (b) `always`: staging-only witness attribute `cip1b-witness = da` added to one BOEN product
   (`01107079-2c06-4f6e-a224-235f8f570fa6`) → not offered (one holder, rule (i)); with `facetModes` `always` on that key
   → offered `da (1)`. Both changed panels also prove the deployed read projects `facetModes`.
   Cleanup: the product's original `attributes` restored exactly, `facetModes` removed from the three items; after:
   0 products with `facetModes` or the witness key, and the `/shop` panel equal to the before state.
4. Profiled BOEN import: NOT RUN — waits for the human's profile through the 1c editor.
