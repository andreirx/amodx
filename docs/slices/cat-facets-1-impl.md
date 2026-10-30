# CAT-FACETS-1-IMPL — storefront filters for catalog tenants (IMPL record)

Status: **IMPLEMENTED** (2026-10-30) — code complete; review and the operator's staging evidence (§ 9) pending
(`docs/documentation.md` § Status taxonomy). Uncommitted on `main` at `4c6f314`. Cycle 2: after review-0 `escalate`
and the operator rulings recorded in § 2.
Contract: the ratified design `docs/slices/cat-facets-1.md` — § 8 (allocation, oracles, units, staging) under the
rulings of § 12 and amendment § 13 "CF1-FACET-SET-2" (the facet set is data-driven), and the operator rulings on
review-0 (§ 2 below). Where § 13 and an earlier section differ, § 13 wins. Maturity: the facet module enters as
**PROTOTYPE**; it becomes MATURE when § 9 below is recorded.
Track F — Glam catalog. Vision tie: guarantee 1 (every read is one tenant's `PK`), guarantee 3 (the filter rules are a
pure module tested off-target, `renderer/src/lib/facets.ts`).

Evidence labels: **EXECUTED** = a command run by the builder in this slice; **OBSERVED** = read in a file or a command's
output; **INFERRED** = a conclusion, not run.

---

## 1. What changed, per packet item

| # | Item | Change (file:line on the working tree) |
|---|---|---|
| 1 | Facet rules | `renderer/src/lib/facets.ts` (new, 372 lines). Fixed ids `:19-21`; URL identity rule `ATTRIBUTE_FACET_PREFIX` `:23`, `attributeFacetId` `:26`, `attributeKeyOf` `:31`, `isFacetId` `:36`; constants `:41-47` (`HREF_BUDGET` 6,144, `PAGE_RESERVE` 16, `MAX_ATTRIBUTE_VALUES` 40, `MIN_HOLDERS` 2); value order `compareValues` `:104` (`Intl.Collator("ro", { numeric: true })` + code-unit tie-break); `matchesGeneratedLabelForm` `:114`; `facetValuesOf` `:150`; facet set + repeat rule + § 13 order + kept selections `facetDefs` `:188`; `parseSelection` `:225`; canonical `formatSelection` `:244`; `listingHref` `:257`; `selectionFits` `:264`; `buildFacetListing` `:316`. Units: `renderer/test/unit/facets.test.ts` (new, 603 lines, 38 tests). |
| 2 | Data path | `renderer/src/lib/dynamo.ts:388` `getCatalogListing(tenantId, categoryId?)` (doc comment above it). `getActiveProducts` and `getProductsByCategory` are not edited. |
| 3 | Pages | `renderer/src/components/SitePage.tsx`: catalog category branch `:292`, catalog shop branch `:305`; `Pagination` gains optional `maxHrefBytes` `:724`; `CatalogFacets` `:1113`, `FacetValueRow` `:1117`, `FacetPanel` `:1138`, `FacetedListing` `:1177`; `CategoryPageView` `:1203` and `ShopPageView` `:1254` take `facets?` and fill only their existing grid slot and `Pagination`'s base URL. Not changed in cycle 2. |
| 4 | Infra + doc | `infra/lib/renderer-hosting.ts:595` `'f'` + comment (rule (a)), read list of rule (b) `:553`; `infra/test/amodx-stack.test.ts:308` title "seven" → "eight", `:335` `'f'`; `docs/caching-architecture.md` `:20` "eight", diagram `:1944`, policy listing `:1983`, allowlist table row `:2157`, "eight parameters" `:2179`, read-site table `:2189`. |
| 5 | Contract rows | `renderer/test/serving-contract/fixtures.mjs:354-445` block `CF1` (4 categories, 43 new products on `cm1-catalog`: 46 catalog products, 42 on the shop page); `renderer/test/serving-contract/contract.test.mjs:1334-1694` rows `cf1-filter`, `cf1-counts`, `cf1-not-stored`, `cf1-bare-intact`, `cf1-empty`, `cf1-roundtrip`, `cf1-order`, `cf1-preserve`, `cf1-pager`, `cf1-pager-guard`, `cf1-legacy`, `cf1-singleton`, `cf1-namespace`, `cf1-lifetime`, `cf1-malformed`, `cf1-url-budget` (16); `renderer/test/interest-e2e/facets.spec.mjs` (new) row `cf1-prefetch`. The `cm1-identity-*` baseline was NOT re-captured. |
| 6 | Architecture | `renderer/ARCHITECTURE.md:377` § "Catalog listings and filters"; the allowlist sentence `:284` and the pairing table `:294` (8 parameters); the review-read paragraph `:339` re-attached to `getProductReviews` / `getSiteReviews`; file-tree and `dynamo.ts` function lists. |
| 7 | Record | this file. |

Not touched (oracle § 4, last rows): `backend/`, `packages/`, `admin/`, `tools/`, `docs/slices/cat-facets-1.md`.

## 2. Operator rulings on review-0

Recorded verbatim (packet § 5, operator, 2026-10-30, binding):

> 1. **Selection lifetime (finding 1).** A selection parsed from `f` is kept and applied whether or not its key passes
>    the § 13 repeat rule on the current base set. Basis: the ratified § 2.3 — "A selected value is always shown and
>    always removable" and "facet F is rendered iff F has an active selection" — and § 4.3 (a stale selected value is
>    kept, never silently dropped). § 13 governs only which keys are OFFERED. A selected key that no product holds, or
>    that fails (i), (ii) or (iii), is rendered with its selection chip; products without the value leave the listing
>    (§ 2.3); an empty result shows the § 4.3 recovery copy. Rows: one transition per repeat condition (i), (ii), (iii)
>    plus "no product holds the key", each asserting chip shown + listing filtered + removable.
> 2. **Name collisions (finding 2).** § 13 says EVERY attribute key, so no reserved-name exception. The two fixed
>    facets (producer, variant values) and attribute facets have separate identities in `f`: choose one encoding rule
>    that can never confuse an attribute key with a fixed facet (e.g. a namespace marker on attribute keys or on the
>    fixed ones), keep § 5.1's canonical-order, round-trip and fixed-point properties, and replace the test that
>    endorses the exclusion with rows proving attributes literally named `producator` and `varianta` are offered and
>    filter independently of the fixed facets.
> 3. **Findings 3, 4, 5:** as review-0 requires — a filtered result over 24 products followed through the rendered pager
>    (exact cards, totals, retained selection, return to page 1 on change, href byte guard), nonzero `sortOrder`,
>    draft, future-start and expired cases on both listing branches; the `renderer/ARCHITECTURE.md` ripple (lines 284,
>    294, the review-read paragraph); `isGeneratedLabel` renamed to a name that states the form check (e.g.
>    `matchesGeneratedLabelForm`) everywhere. The non-catalog baseline stays unchanged.
> 4. All § 8.2 oracles again, fresh logs; update the record.

### 2.1 How each finding is closed — by class, with one rule

| Finding | Class of defect | Rule that closes the class | Where proven |
|---|---|---|---|
| 1 Selection lifetime | Two different questions answered by one predicate: "may this key be OFFERED" and "is this selection VALID" | Validity of a selection depends only on the URL identity grammar (`isFacetId`), which does not depend on the base set. Offering depends on the repeat rule. `buildFacetListing` keeps every parsed facet id; a selected attribute key that is not offered is rendered with its selected values only (nothing can be added to it). | units "ruling 1 —" (4 transitions); row `cf1-lifetime` (same 4, rendered) |
| 2 Name collisions | A URL key space shared by two sources (fixed facets, attribute keys) — a collision rule then needs an exception list | Separate identities by construction: the fixed facets are exactly `producator` and `varianta`; attribute key `k` is ALWAYS `a.k`. Neither fixed id starts with `a.`, so no attribute key can equal a fixed id, whatever its name. No exception list. | units "ruling 2 —" (offering, independent filtering, round trip / canonical order / fixed point with the colliding names, the grammar); row `cf1-namespace` |
| 3 Pager / preservation not exercised | A guarantee asserted on a model while the rendered path is untested | Every pager and preservation claim is asserted on the RENDERED pages, followed through the rendered links, and compared with an independent model of the two existing reads (CATPROD# path for the category, `getActiveProducts` for the shop). The pager byte guard has its own row with a positive control and a mutation check. | rows `cf1-preserve`, `cf1-pager`, `cf1-pager-guard`; § 4 X-12 |
| 4 Doc ripple | A structural edit checked only at the edit site | Every current-state claim the slice changes is searched for across the WHOLE file, not only at the edit site: literal search of `renderer/ARCHITECTURE.md` for `7-parameter`, `seven`, `'nf'`, `query allowlist`, `allowlists only` (2 hits left, both updated: `:284`, `:294`); re-read of the sections that state the allowlist (`:270-330`) and the `dynamo.ts` function list (`:330-375`). Not a line-by-line re-read of all 503 lines. | § 1 item 6 |
| 5 Name ≠ semantics | A name that claims more than the check establishes | The name states the check: `matchesGeneratedLabelForm`; its doc says the stored item does not record the label's origin. Literal search for `isGeneratedLabel` over `renderer/` and this record: 0 hits. | § 4 X-13 |

## 3. How it works (for the reviewer)

**Request path.** A catalog shop or category URL without a query string is the cacheable route (it passes
`query={}`), so `f` is `undefined`: the page renders the panel with no selection and is stored in ISR and at the edge,
as before. A URL with `?f=…` is a distinct CloudFront cache key (allowlist), so it reaches the origin; middleware sends
every URL with a query string to the `force-dynamic` twin, whose response is `no-store` — never stored.

**Render.** The catalog branch reads the whole listing with `getCatalogListing`, calls
`buildFacetListing(items, query.f, basePath + path)`, slices 24 cards for the page, and passes the model to the view.
The non-catalog branches run the old code; the views receive no `facets` prop, so each of their element trees is the
same (the grid JSX moved into a local constant; its output is the same element).

**URL identity (ruling 2).** Inside `f`, the producer facet is `producator`, the variant-values facet is `varianta`,
and attribute key `k` is `a.k` — e.g. `?f=producator%3DBOEN%26a.colec%25C8%259Bie%3DPlanks%2B138%2Bmm`. Any other inner
key is not a facet id and `parseSelection` drops it (§ 4.4 step 3). Canonical order: producer, variant, then the
attribute ids by the value order; values by the value order. Cost: 2 bytes per attribute pair inside `f`.

**`buildFacetListing`, in order.**
1. Per product, the value sets of every facet (`facetValuesOf`): `brand`; option values minus labels of the form
   `#<digits>`; `a.<key>` for each `attributes` key with its non-empty values (every key, whatever its name).
2. The selection: `parseSelection(f)` — total (WHATWG form decoding), keeps every facet id, offered or not (ruling 1).
3. The acceptance rule: if the canonical href of that selection plus 16 bytes exceeds 6,144 bytes, nothing is applied
   (`tooLong`, notice).
4. Filter (OR within a facet, AND across facets).
5. The facets (`facetDefs`): producer, variant, then the attribute facets — every key that passes the repeat rule (≥ 2
   holders, the most frequent value on ≥ 2 products, ≤ 40 distinct values) PLUS every selected attribute key — by
   holders, ties by the value order. A key that is offered lists all its values; a selected key that is not offered
   lists only its selected values.
6. For each facet, counts over the products that match every OTHER facet's selection; a facet is shown iff it has a
   selection or some value is held by some but not all products. For each value: `selected` (remove-link, measured),
   `zero` (disabled), `too-long` (disabled + hint) or `link` (add-link, emitted only when the selection it leads to
   fits).

## 4. Oracle outputs (§ 8.2 of the design, in order; bare exit codes) — cycle 2, fresh logs

All EXECUTED by the builder on 2026-10-30 on the final source, after every cycle-2 edit. Logs in
`/tmp/CAT-FACETS-1-IMPL-c2/` during the run, deleted at the end (X-15).

| Command | Exit | Last lines |
|---|---|---|
| `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run build; echo "exit=$?"` | 0 | `> infra@0.1.0 build` / `> tsc` |
| `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run typecheck; echo "exit=$?"` | 0 | `> infra@0.1.0 typecheck` / `> tsc --noEmit` |
| `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm test; echo "exit=$?"` | 0 | `Test Files  10 passed (10)` / `Tests  138 passed (138)` |
| `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving; echo "exit=$?"` | 0 | `# tests 66` / `# pass 66` / `# fail 0`; `(cm1-identity-commerce)` and `(cm1-identity-content)` `same` on every URL, 0 `DIFF` lines; `(cf1-malformed) outer f=%E0%A4%A → 200` |
| `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving-bundle; echo "exit=$?"` | 0 | `# tests 58` / `# pass 58` / `# fail 0` |
| `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:interest-e2e; echo "exit=$?"` | 0 | `5 passed (26.1s)` — `(cf1-prefetch)` and the four interest rows (the harness deletes `.next` and rebuilds, `harness.mjs:342-347`) |
| `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/infra" && npm test; echo "exit=$?"` | 0 | `✓ (a2) query allowlist is EXACTLY the eight read parameters, in order`; `Tests: 61 passed, 61 total` |
| `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/tools/mcp-server" && npm test; echo "exit=$?"` | 0 | `# pass 10` / `# fail 0` |
| `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check; echo "exit=$?"` | 0 | (no output); the untracked new files: 0 lines with trailing blanks (`grep -nE '[[:blank:]]$'`) |
| `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --stat -- backend packages admin tools` | 0 | empty |
| `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" status --porcelain -uall` | 0 | the 12 allocated paths (8 modified, 4 new incl. this file); nothing else; `git diff --quiet -- docs/slices/cat-facets-1.md` → 0 |

## 5. Abstraction lines

- `renderer/src/lib/facets.ts` — a module of pure functions. Users: the catalog category branch and the catalog shop
  branch of `SitePage.tsx` (two) and `test/unit/facets.test.ts`. Axis: none (operations fixed; the facet list is data
  rebuilt per base set). Rejected: inline in `SitePage.tsx` (≈ 1,500 lines; the rules need off-target tests — the
  test-seam criterion).
- The facet "table" — data, not a registry: one array built per base set and selection by `facetDefs` — producer, the
  variant values, then the attribute keys that pass the § 13 repeat rule and the selected attribute keys. Dispatch by
  iteration over that array. Axis: the data (which keys the import writes; `cat-import-profile-1` will add keys) — no
  code change per key. Rejected: a fixed six-row table (replaced by § 13).
- The URL identity rule (`ATTRIBUTE_FACET_PREFIX`, `attributeFacetId`, `isFacetId`) — a string grammar, not a type.
  Users: `parseSelection`, `facetValuesOf`, `facetDefs`, the units, the contract rows. Axis: none (two fixed sources,
  one open source). Rejected: a prefix on the fixed ids (an attribute key could still start with that prefix) and a
  reserved-name exception (ruling 2 forbids it).
- `getCatalogListing` — a function. Users: the two catalog branches. Axis: none. Rejected: a flag on
  `getActiveProducts` (changes the function every non-catalog shop render calls, § 7) and two inline copies.
- `FacetValueView` — a sum type of four exclusive states (`selected` / `link` / `zero` / `too-long`), each carrying
  only its data; `FacetValueRow` matches it exhaustively (`never` check). Users: `FacetPanel`, the units. Axis:
  variants fixed, operations growing (sum type). Rejected: `{ href?: string; disabled: boolean; selected: boolean }`.
- `Pagination`'s optional `maxHrefBytes` prop — users: the catalog category and shop views. Axis: none; it is the
  § 5.1 runtime guard on pager links (row `cf1-pager-guard`). Rejected: clamping `page` in the catalog branch (changes
  what `?page=` past the end renders, § 4.2 says "as today").

No new package, module boundary, dependency edge or dependency. Data across the renderer ↔ DynamoDB boundary stays the
raw item.

## 6. Builder decisions (local, implied by the ratified text or the rulings; recorded, not asked)

1. **Identity encoding = `a.` before every attribute key** (ruling 2 asked for one rule). `.` is not encoded by the
   form encoding, so the marker costs 2 bytes per attribute pair, not 6–10. The fixed ids keep the § 9.6 names.
   Measured cost of the stored key: `a.colecție` costs 11 bytes more per value inside `f` than the ASCII `colectie` the
   design measured (9 for `ț`, 2 for `a.`; X-2, unit "greedy on `colecție`": the 40 longest names = 5,851 bytes).
2. **Canonical key order = producer, variant, then the attribute ids by the value order** — not by holder count. The
   § 5.1 oracle requires the canonical form to be a function of the selection alone; § 13's holder-count order depends
   on the base set, so it orders the PANEL only. Consequence: the § 5.1 example string starts with the `varianta` pairs.
3. **A selected attribute key that is not offered lists only its selected values** (ruling 1: "§ 13 governs only which
   keys are OFFERED"). Its facet sits among the attribute facets by the § 13 order (holders, then the value order).
4. **The repeat rule applies to `attributes` keys only**; the producer and variant facets keep the § 2.3 rules.
5. **Tie-break by `id` in `getCatalogListing`'s sort.** For ASCII ids (UUIDs) it equals DynamoDB's SK order of both
   item families, so it changes no order on real data (INFERRED from SK = `PRODUCT#<id>` / `CATPROD#<cat>#<id>`); it
   makes rows `cf1-order` / `cf1-preserve` independent of the stub's return order (fixture-array order, not SK order).
6. **Shop status rule in memory** (`status === "active"`), with `status` projected, instead of the
   `FilterExpression` — one query shape for both branches; equivalent (both true iff the attribute is the string
   "active"); same read units (a filter does not reduce them, design § 3.1).
7. **Mobile panel = CSS-only checkbox toggle** (the `peer` idiom of `CatalogVariantPresenter`), one copy of the panel.
   The facets themselves are native `<details>` as § 6 states.
8. **Plain `<a>` for every panel link** (no Next `<Link>`): never prefetched, no client JavaScript.
9. **Total line in the panel** (`data-facet-total`), because the shop page has no total line today; the category page
   keeps its English "{n} products" line (named finding, § 6), which now shows the filtered total.

## 7. Copy inventory (Romanian, fixed — design § 6)

| Copy | Where |
|---|---|
| `Filtre` | mobile toggle label (with ` (n)` = active selections) and desktop heading; `aria-label` of the panel |
| `{n} produse` / `1 produs` | panel total line |
| `Producător` | producer facet heading |
| the group name (e.g. `Format`) or `Variantă` | variant facet heading (§ 4.5) |
| the attribute key as stored | every attribute facet heading (§ 13) — also for keys named `producator` / `varianta` |
| `{value} ({count})`, `✓ {value} ({count})` | value rows (the check mark is `aria-hidden`) |
| `{facet}: {value} ×` | selection chips (the `×` is `aria-hidden`) |
| `Elimină filtrul {facet}: {value}` | `aria-label` of a chip (NEW copy, not in § 6 — accessibility name of the remove link) |
| `Șterge filtrele` | panel link and empty-result link |
| `Niciun produs nu corespunde filtrelor alese.` | empty result (§ 4.3) |
| `Prea multe filtre selectate — eliminați unul` | budget hint (once per panel, and `title` of each value the budget disables) |
| `Filtrele din adresă sunt prea lungi și nu au fost aplicate.` | acceptance-rule notice |

Grammar note: standard Romanian writes "20 de produse" and up (`de` after numbers ≥ 20). The ratified copy
`{n} produse` is kept as written; the operator may promote a fix. Naming note: the fixed producer facet's heading is
`Producător`, an attribute literally named `producator` is headed `producator` — two facets a visitor can tell apart
only by the diacritic and the capital. Display labels are `cat-import-profile-1`'s scope.

## 8. Findings, follow-ups, and what could not be determined

**F-CF1I-1 — § 13 rule (iii) hides `colecție` on large listings (consequence of the ratified text, not a defect).**
Rule (iii) (≤ 40 distinct values) applies to EVERY `attributes` key, the four importer keys included. Today's data
(X-2): 147 collections across the glam tenant, ALPOD alone 119 (design § 2.2) → no `colecție` facet on a shop page
that holds ALPOD, or on the ALPOD parent category; BOEN (27) keeps it. A hand-built `?f=a.colecție=…` still filters
(ruling 1). Unit "today's `colecție` on the glam shop page (147 values) is NOT offered" pins it.

DECISION_REQUIRED:
- ID: CF1I-COLLECTION-CAP
  QUESTION: Does the 40-value cap of § 13 rule (iii) apply to the collection key `colecție`?
  PROBLEM: The cap was introduced to drop spec keys with many values (ALPOD `dimensions`, 82). Applied as written, it
    also drops the collection facet wherever a listing holds more than 40 collections (glam shop page: 147; ALPOD
    parent: 119). The category tree still offers collections there (one child category per collection).
  OPTIONS:
  - A. Keep as built (the ratified text). REWARD: one rule for every key; no special case. RISK: no collection filter
    on the shop page of a multi-producer catalog; a visitor cannot combine "collection" with another filter there.
  - B. Exempt `colecție` from rule (iii). REWARD: the collection facet everywhere. RISK: a 147-value list in the panel;
    a special case keyed on an importer label (the `cat-import-profile-1` profiles would own such choices).
  - C. Defer to `CAT-IMPORT-PROFILE-1` (a per-producer profile marks which keys are filters). REWARD: the choice lives
    with the other filter choices. RISK: until then, behaviour A.
  RECOMMENDED: C (A until the profile slice).
  BLOCKING_REASON: Not blocking — the built behaviour is the ratified text; the question decides a later change.

**F-CF1I-2 — rule (i) cannot fail alone.** (ii) (the most frequent value is held by ≥ 2 products) implies (i) (≥ 2
holders). The units and `cf1-lifetime` show (i) failing (with (ii) failing by implication) and say why. The code keeps
(i) with a comment so it reads as the rule.

**F-CF1I-3 — witnesses written with `colectie`.** § 5.5's `cf1-malformed` and `cf1-url-budget` (b) witnesses use the
bare name `colectie`; under the identity rule (ruling 2) that is not a facet id and § 4.4 step 3 drops it. The rows run
each witness as written (asserting 200, nothing applied) AND on the attribute id `a.colecție` (asserting the § 4.4 /
§ 5.1 behaviour: a removable stale value; the notice). The design's byte figures (4,031 → 20,035 → 10,020) are
re-measured in the units on the design's map; with `a.colectie` the canonical href is 20,039 bytes.

**F-CF1I-4 — "network idle" is unreachable on the catalog shop (pre-existing).** Next's viewport prefetch of the
header's Contact link (`/contact`, absent on the fixture tenant) follows the not-found handoff to `/contact?nf=1` and
that RSC request stays open (OBSERVED 2026-10-30 from a request log; `interest.spec.mjs` notes the same for commerce
pages). `cf1-prefetch` waits for "network quiet except `nf` requests, none started for 1 s". Whether this also happens
on staging is not determined.

**F-CF1I-5 — the stub ignores `ProjectionExpression`** (`ddb-stub.mjs` returns whole items). A projection that forgot
`#s`, `#b`, `#a` or `#v` would pass every hermetic row and fail on DynamoDB (an empty shop if `status` were missing).
The projection is checked only by reading; staging steps 1–2 (§ 9) are its first executed check. Follow-up: make the
stub honour projections (outside this slice's allocation).

**F-CF1I-6 (cycle 1) — closed.** Pager links on a filtered catalog page were not exercised; rows `cf1-pager` and
`cf1-pager-guard` now render and follow them (§ 2.1). The pager `<Link>`s keep Next's default prefetch (pre-existing
behaviour, as for `?page=` today); on a filtered view they prefetch `?f=…&page=2` (INFERRED; `cf1-prefetch` runs on a
3-product selection, so it does not observe this).

**Other named items.**
- English copy around the panel stays (design § 6 named finding): "Shop", "{n} products", "No products in this
  category yet.", "Page 1 of N", "Previous"/"Next". On the category page the English and the Romanian totals both appear.
- `Color` with 41 values in the fixture is carried by TWO products as a multi-valued key (one product holds 21 values),
  so rule (iii) is proven without 42 products; single-valued 40/41 is proven in the units.
- The 147 measured collection names are committed in `facets.test.ts` (vendor collection names, already public as
  category names on the storefront).
- `renderer/test/serving-contract/README.md` and the `MAP.md` files were not updated (not in the allocation); the row
  count in `renderer/ARCHITECTURE.md`'s file tree ("26 contract-row assertions … (30 tests)", line 60) was stale before
  this slice (66 tests now) and was not corrected.

**Not determined.** Real item sizes and consumed capacity of the catalog read (staging step 4); render latency of a
filtered view (step 4); whether staging's import stored the upload's variant name so the heading reads "Format"
(step 2); whether the Contact-link prefetch hangs on staging (F-CF1I-4); the order of the ALPOD sample relative to
BOEN on staging (both `sortOrder` 0 → id order).

## 9. Operator checklist — staging evidence (design § 8.4, restated)

Tenant `cm1-catalog` on staging (BOEN import, 437 products; ALPOD sample, 2 products — `cat-images-1.md` § 10), after
the renderer and infra deploy. **Note (§ 13):** the importer still writes only `colecție`, `unitate`, `împachetare`,
`comandă minimă`; spec-sheet keys (`Wood`, `Pile weight`, …) appear in staging data only after `cat-import-profile-1`.
Expect on the shop page: `Producător` (BOEN, ALPOD), the variant facet (BOEN's real labels; ALPOD's `#n` excluded),
`colecție` if the two producers together hold ≤ 40 collections. Attribute filters in URLs use the `a.` form
(`?f=a.colec%25C8%259Bie%3D…`).

1. `/shop?f=producator%3DBOEN`: the panel total equals the count of active, available BOEN `PRODUCT#` items from an
   independent read-only script; the first page's card slugs are BOEN slugs; with 437 BOEN products, follow the Next
   link once — page 2 keeps the filter (chip present) and lists the next 24.
2. BOEN parent category: every variant count equals the script's count of products holding that label; no
   `#<digits>` value; the heading is the upload's variant name. Also proves the projection carries `brand`,
   `attributes`, `variants`, `status` (F-CF1I-5).
3. Each filtered URL requested twice: `x-cache: Miss from cloudfront` both times and `cache-control` contains
   `no-store`; then the bare path: `x-cache: Hit from cloudfront` and the full count.
4. Origin time of a filtered shop view (`curl -w '%{time_starttransfer}'` with a fresh `id=cf1-<run>` value) and the
   `ConsumedCapacity` of the catalog listing query from a read-only probe (`ReturnConsumedCapacity: TOTAL`) — replaces
   the INFERRED numbers of design § 3.2 and feeds the CF1-DATA-PATH revisit threshold (unresolved).
5. CM1-BYTE-IDENTITY Layer 2 on the two staging non-catalog tenants: PASS.
6. `aws cloudfront get-cache-policy`: 8 query strings, on staging and, after the human's GO, on prod.

## 10. Evidence log (builder, 2026-10-30)

| # | Command (abridged) | Result |
|---|---|---|
| X-1 | `git log --oneline -1 && git status --porcelain -uall` (cycle 1 start) | `4c6f314 …`; tree clean (EXECUTED) |
| X-2 | `tsx /tmp/CAT-FACETS-1-IMPL-measure/m.mts <repo> <glamCRM/pl-tools/out>` (imports `backend/src/import/glam/parse.ts`, `map.ts`; reads the 24 enriched CSVs; writes nothing in either tree) | `files 24, products 1928, distinct 147, longestChars 127, maxPerValueInF 235, allInF 13444` (key `colecție`, no `a.`); the 147 names → `facets.test.ts` (EXECUTED) |
| X-3 | `tsx …/b.mts` (cycle 1) | 40 longest names selected on `colecție`: href 5,771 bytes (cycle 2 with `a.`: 5,851, unit) (EXECUTED) |
| X-4 | cycle 1 units / mutation of `selectionFits` | 30 passed; mutation → 2 budget units fail; restored, `cmp` identical (EXECUTED) |
| X-5 | `npx playwright test … facets` with a temporary request log (cycle 1) | the only request open after 5 s: `/contact?nf=1&_rsc=…`; no request with `f=` before the click (EXECUTED; the log was removed from the spec) |
| X-6 | `grep -rnoE "query\??\.[a-zA-Z_]+" renderer/src`, `grep -rn "query\[" renderer/src` | `SitePage.tsx`: `availability`, `email`, `f`, `id`, `page`, `q`; `%5Fdyn/[[...slug]]`: `preview`; no bracket reads; `nf` via `NOT_FOUND_PARAM` (literal-text scan; basis of the rule (b) list) (EXECUTED) |
| X-7 | cycle 1 gates | all exit 0 (superseded by § 4) (EXECUTED) |
| X-8 | `cat .agent-manager/slices/CAT-FACETS-1-IMPL/review-0.json`, `build-progress.md`; `git status --porcelain -uall` (cycle 2 start) | review-0 `escalate`, 5 findings; the 12 cycle-1 paths (EXECUTED) |
| X-9 | `npx vitest run test/unit/facets.test.ts` (cycle 2) | 38 passed (EXECUTED) |
| X-10 | `npx tsc --noEmit` (renderer), then `npm run test:serving` (cycle 2, first run) | tsc 0; 66/66 (EXECUTED) |
| X-11 | the fixture models in `contract.test.mjs` (`categoryModel("cf1-many")`, `shopModel(KRONO)`) | 30 each; last two `placa-02`, `placa-01`; `placa-ciorna`, `placa-viitoare`, `placa-expirata` absent — asserted inside `cf1-preserve` before the comparison (EXECUTED) |
| X-12 | scratch mutation `Pagination`: `fits = () => true`, then `npm run test:serving` | `# pass 65` / `# fail 1` — `not ok 60 - (cf1-pager-guard)` only; file restored, `cmp` identical (EXECUTED) |
| X-13 | `grep -rn "isGeneratedLabel" renderer docs/slices/cat-facets-1-impl.md` | 0 hits in `renderer/` (EXECUTED; this record names the old identifier only in the verbatim ruling and § 2.1) |
| X-14 | § 4 gates (cycle 2) | see § 4 (EXECUTED) |
| X-15 | `rm -rf /tmp/CAT-FACETS-1-IMPL-c2` | the cycle-2 log directory removed (EXECUTED) |

## Ratification (human, 2026-10-30)

Decision review: CF1I-COLLECTION-CAP converged (challenger codex gpt-6.1-sol agrees). Human ruling: **C** — the
40-value cap applies to every key, `colecție` included, as built (behaviour A) until `cat-import-profile-1`; that
slice's design must state explicitly how a profile's filter choice takes precedence over the renderer's repeat rule
(the reviewer's caveat: extracting more attributes alone does not change this behaviour).

## Operator closeout (operator, 2026-10-30)

**Review.** review-0 escalate (selection lifetime, name collisions, pager evidence, doc ripple, a false name →
operator rulings § 2), review-1 **approved**; decision review CF1I-COLLECTION-CAP converged → human ruling C (above).
Builder claude-opus-5-5, reviewer codex gpt-6.1-sol.

**Gates (operator, on the approved candidate, bare exit codes, `ALL GATES GREEN`).** root build 0; typecheck 0; backend
unit 659; renderer unit 138; `test:serving` 66 pass / 0 fail (incl. `cm1-*` byte identity and `cf1-*`);
`test:serving-bundle` 58 / 0; `test:interest-e2e` 5 passed; admin 65; infra 61; MCP 10 / 0; `git diff --check` 0;
no change under `backend packages admin tools`; `docs/slices/cat-facets-1.md` unchanged since `4c6f314`; the
`cm1-byte-identity/` baseline untouched; every changed path inside the allocation.

**Staging CDK diff and deploy.** `RendererCachePolicy` query strings `+ "f"` (8 names); the three renderer functions
(server, image optimisation, revalidation) change code only; the renderer asset redeploys. Nothing added, removed or
replaced. `cdk deploy` → `AmodxStack-staging` ✅.

**Staging evidence (design § 8.4; tenant `cm1-catalog`; independent counts from `aws dynamodb query`, not renderer code).**
1. `/shop?f=producator%3DBOEN` → 200, "437 produse" = the independent count (441 active+available products: 437
   BOEN, 2 ALPOD, 2 without `brand`); page 1: 24 cards, all BOEN; the Next link keeps `f`; page 2: 24 further BOEN
   cards, none repeated. Bare `/shop`: "441 produse".
2. `/category/boen` → 200: facet `varianta` headed "Format" (the upload's variant name), 26 values, every count equal
   to the independent count, no `#<digits>` value; facet `a.colecție` 27 values summing to 437 (offered: 27 ≤ 40).
   This also proves the listing projection carries `brand`, `attributes`, `variants`, `status` on DynamoDB
   (F-CF1I-5).
3. Filtered URL requested twice: `x-cache: Miss from cloudfront` both times, `cache-control: private, no-cache,
   no-store, max-age=0, must-revalidate`. **The bare-path Hit could not be observed on staging:** every
   `/_site/<id>/…` request is "always dynamic: previews show drafts and must never enter either cache"
   (`renderer/middleware.ts` `/_site/` branch) — the home page is a Miss too — and the staging catalog tenant has no
   real domain. The cached route is covered by the hermetic serving rows.
4. Filtered shop view time-to-first-byte: 2.65 s cold, 0.46 s warm. Listing query on 441 products, projection as the
   catalog read, `ReturnConsumedCapacity: TOTAL`: **66.5 read units** (≈ 0.15 per product; the design's ≈ 361 for
   1,928 products is consistent).
5. CM1-BYTE-IDENTITY Layer 2 (canonicaliser, human ruling A of 2026-10-29) against cat-mode-1's staging capture:
   content **14/14** identical; commerce 8/18 raw, every difference the embedded `apiUrl` — the old capture carries
   the PROD API host built into staging (the BUILD-ENV defect fixed on 2026-10-29), today's the staging host. With
   only that host normalised in a copy of the old capture: commerce **18/18**, content **14/14** — identical across
   cat-import-1, cat-images-1, cat-interest-1 and this slice. Catalog differs by design. Operator tooling slip on the
   way: the first two captures used run ids the mask does not recognise (it accepts `before|after|base|cand…`).
6. Deployed cache policies: `AmodxStack-staging-RendererCache` 8 query strings incl. `f`; prod
   `AmodxStack-RendererCache` 7 (until the human's prod deploy).
