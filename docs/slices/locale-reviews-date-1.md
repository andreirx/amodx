# LOCALE-REVIEWS-DATE-1 — review dates follow the site language (record)

Status: **BUILT 2026-11-01, revised in iterations 1 and 2** for operator ruling LRD1-DOCUMENTATION-SCOPE = A (§ 11) and
review-0 finding F-LRD1-RO-PRESERVATION (§ 12) (builder;
uncommitted, for review); no open decision. Closes finding
**F-LOCALE-REVIEWS-DATE** of `docs/slices/locale-1c.md` § 8. Start: `main` at `36876a8`, tree clean (EXECUTED). Render
output start commit: `eba5e18` (`locale-1c`) — the five later commits change no render code: `git diff --stat eba5e18
HEAD -- packages renderer` lists only `packages/plugins/src/{admin.ts,types.ts,category-showcase/index.ts,
reviews-carousel/index.ts}` (the admin inserter's `offeredOn`), `ARCHITECTURE.md` and one test (EXECUTED).

Human ruling (2026-11-01, verbatim): "the reviews carousel should show en-US style dates if no other setting is in
effect, or use the site setting". It puts ledger row **L-ALL-2** of `docs/slices/locale-1.md` § 8.3 in force; § 16.2
item 4 had held it back.

## 1. Behaviour

`packages/plugins/src/reviews-carousel/ReviewsCarouselRender.tsx:166`:
`const dateLocale = typeof locale === "string" && locale !== "" ? locale : (strings.dateLocale ?? "en-US");`

1. A block `locale` attribute that is a non-empty string is the block's own setting. It is passed raw, not normalised,
   as since `locale-1c`.
2. Otherwise (attribute absent, `""`, or not a string) the site setting applies: the tenant's normalised locale
   (`locale-1.md` § 3.3). `blockStrings` gives `strings.dateLocale` only for a tenant that is not en-US, so the en-US
   path is the explicit literal `"en-US"`. A tenant without a valid `locale` normalises to en-US.
3. Date options unchanged (`day: "numeric", month: "long", year: "numeric"`). The unreachable `"ro-RO"` default
   parameter of `formatDate` (`:44`) is removed; `locale` is now a required `string` in `formatDate` and `ReviewCard`.
   `git grep -n '"ro-RO"' -- packages/plugins/src/reviews-carousel` prints nothing.
4. `blockStrings` is unchanged, so the post grid keeps its `locale-1c` behaviour (runtime default for an en-US
   tenant, the tenant's locale otherwise). Only the doc comment of `BlockStrings.dateLocale`
   (`packages/shared/src/locale-strings.ts:214-216`) is corrected (D1).

The date for 31 October 2026, per tenant and attribute (EXECUTED, Node 22.21.1, the formatter's own options):

| Block `locale` attribute | Before (`eba5e18`) | After: en-US tenant | After: ro-RO tenant | After: en-GB tenant |
|---|---|---|---|---|
| absent | `31 octombrie 2026` (the `"ro-RO"` default; a non-en-US tenant: its locale) | `October 31, 2026` | `31 octombrie 2026` | `31 October 2026` |
| `""` | the raw date string (`toLocaleDateString("")` throws `RangeError`, caught) | `October 31, 2026` | `31 octombrie 2026` | `31 October 2026` |
| not a string: `null` | the raw date string (`TypeError`, caught) | `October 31, 2026` | `31 octombrie 2026` | `31 October 2026` |
| not a string: `42`, `true`, `{}` | the runtime default (en-US on the test machine) | `October 31, 2026` | `31 octombrie 2026` | `31 October 2026` |
| not a string: `["de-DE"]` | `31. Oktober 2026` | `October 31, 2026` | `31 octombrie 2026` | `31 October 2026` |
| `"ro-RO"`, `"en-US"`, `"ro-RO-u-nu-arab"`, `"ro_RO"`, `"xx-YY"` | raw | unchanged, raw: `31 octombrie 2026`, `October 31, 2026`, `٣١ octombrie ٢٠٢٦`, the raw date string, the runtime default | same | same |

Romanian tenants (scope of every RO preservation claim in this record): a carousel WITHOUT a `locale` attribute keeps
`31 octombrie 2026` — the RO fixtures, and every editor-made block (the block schema has no `locale` field). A carousel
with `""` or a non-string attribute changes on a RO tenant too: the raw date string (`""`, `null`) or the runtime
default (`42`, `true`, `{}`; `["de-DE"]` German) → `31 octombrie 2026`. No fixture holds such a block (only a hand-edited
block can); the jsdom cases prove the after-values for ro-RO (§ 3 item 5). This is rule 2 of the packet; review 0
finding F-LRD1-RO-PRESERVATION (§ 12).

## 2. Changes, per file

| File | What | Serves |
|---|---|---|
| `packages/plugins/src/reviews-carousel/ReviewsCarouselRender.tsx` | `:166` the rule; `:44` no default; `:54` `locale: string`; `:154-163` doc comment | § 1 items 1-3 |
| `packages/shared/src/locale-strings.ts` | `:214-216` doc comment of `BlockStrings.dateLocale` only (no code) | D1 |
| `packages/plugins/ARCHITECTURE.md` | the "Dates" paragraph of the render contract | docs |
| `packages/shared/ARCHITECTURE.md` | `:125-128` F-LOCALE-REVIEWS-DATE no longer open: closed by this slice, the rule in one sentence | § 11 (ruling, item 2) |
| `renderer/ARCHITECTURE.md` | locale section: heading and records list name this slice; the "en-US tenants do not change" claim states its one ruled exception; new `locale-reviews-date-1` bullet; the rows read set `reviews-date-1` (from `eba5e18`), row `loc1-diff-reviews-date-1`, text rows equal except listed ledger texts; the jsdom en-US markup claim states the declared L-ALL-2 dates; the baseline was advanced from this tree too | § 11 (ruling, item 2) |
| `renderer/test/unit/locale-1c-blocks-client.test.ts` | `L_ALL_2` / `withLedger` (`:124-138`): the en-US oracle against the `0c0dbc8` capture with exactly the declared date difference; the reviews states declare the date as a formatted value for the RO oracle (`:289`, `:300`); the date block `:453` rewritten to the ruling (en-US, en_US, no or malformed tenant locale, ro-RO, en-GB, de-DE, non-string attributes, the explicit `"en-US"` argument) | § 3 item 3 |
| `renderer/test/serving-contract/locale-1/reviews-date-1/before/` | 139 captures from `eba5e18` (§ 3) | § 3 items 1-2 |
| `renderer/test/serving-contract/locale-1/reviews-date-1/expected-diff.json` | 81 en-US URLs; one category-3 entry (content `/`, L-ALL-2); every other URL `[]` | § 3 item 1 |
| `renderer/test/serving-contract/locale-1/reviews-date-1/ro-expected.json` | 58 RO URLs, all `[]` | § 3 item 2 |
| `renderer/test/serving-contract/locale-1/proof.mjs` | `textMismatches` (`:145`) takes an optional `listed(path)`: the exact visible-text changes a URL must show; default none = the old behaviour | § 3 item 1 |
| `renderer/test/serving-contract/contract.test.mjs` | `LOC1_SLICE = "reviews-date-1"`, `LOC1_START`, `LOC1_EN_ROWS` (`:1820-1824`); `loc1-subjects` accepts only L-ALL-2 category-3 items; `loc1-text-*` and `loc1-text-mutation` use the listed texts; row `loc1-diff-1c` → `loc1-diff-reviews-date-1` with this slice's bound mutations; titles cite `eba5e18`; the `cm1-identity-*` title names this tree | § 3 |
| `renderer/test/serving-contract/cm1-byte-identity/baseline/` | re-captured from this tree (§ 3 item 4) | § 3 item 4 |
| `renderer/test/serving-contract/cm1-byte-identity/README.md`, `renderer/test/serving-contract/README.md` | baseline origin, history row, row table | docs |
| `docs/slices/locale-reviews-date-1.md` | this record | |

No dependency, no infra, no data write, no backend or admin change.

## 3. Proof

1. **Start-commit capture** (EXECUTED): `locale-1/reviews-date-1/before/` — 139 responses (the 81 URLs of
   `EN_US_REQUESTS` and the 58 of `LOC1_REQUESTS`) from `eba5e18` in the worktree `/tmp/LOCALE-REVIEWS-DATE-1-before`
   (removed), built with that commit's shared/effects/plugins (its `dist` holds the old line, `grep`). `fixtures.mjs`,
   `harness.mjs`, `no-dotenv.cjs`, `ddb-stub.mjs`, `cm1-byte-identity.mjs`, `locale-1/proof.mjs`, `locale-1/extract.mjs`
   byte-identical to this tree's at capture time (`diff -q`; `proof.mjs` was changed afterwards, only in
   `textMismatches`, which the capture does not call). Build `y_yXdZaceyw1PYN5VN8ni`; stub `unhandled` = `[]`;
   statuses 200 × 129, 307 × 8, 404 × 2. Procedure (the `1c` one; throwaway script deleted after use):

   ```bash
   git worktree add --detach /tmp/LOCALE-REVIEWS-DATE-1-before eba5e18
   cp -cR node_modules /tmp/LOCALE-REVIEWS-DATE-1-before/node_modules   # and renderer, packages/plugins, packages/shared node_modules
   (cd /tmp/LOCALE-REVIEWS-DATE-1-before && npm run build -w packages/shared && npm run build -w packages/effects && npm run build -w packages/plugins)
   # script, run from /tmp/LOCALE-REVIEWS-DATE-1-before/renderer: harness.mjs startStubs → buildRenderer → startRenderer;
   # proof.mjs captureRequests over [...EN_US_REQUESTS, ...LOC1_REQUESTS]; cm1-byte-identity.mjs writeCaptures(<tree>/…/reviews-date-1/before)
   git worktree remove --force /tmp/LOCALE-REVIEWS-DATE-1-before
   ```
   Cross-check (EXECUTED): `before/` equals the previous strict `baseline/` (from the `locale-1c` tree) under CM1-A1 on
   all 32 commerce/content URLs.
2. **en-US** (rows `loc1-text-*`, `loc1-diff-reviews-date-1`): the only difference on all 81 URLs is the L-ALL-2 date
   on content `/`; every other URL is byte-equal under the `1b` comparator as shipped (`checkExpected`, unchanged:
   CM1-A1 plus the resolved-tree payload comparison). The date is server HTML only; the payload carries the item's ISO
   date and the unchanged `strings`, so it needs no payload entry. Bound mutations in `loc1-diff-reviews-date-1`, each
   reported: the listed entry dropped; a ghost entry; one HTML byte; the date left Romanian; the date as `10/31/2026`; a
   block text changed in the payload; a block label left Romanian; the date entry listed on a product page; one order
   page byte. In `loc1-text-mutation`: an added text per subject; the date left Romanian; another date format; the
   change with nothing listed.
3. **RO copies** (rows `loc1-ro-*`): 58 URLs, 0 text changes against their own `eba5e18` capture (the roContent home's
   carousel has no `locale` attribute and keeps `31 octombrie 2026`). This proves the absent-attribute case only; the
   `""` / non-string change on RO tenants (§ 1) is proven in jsdom.
4. **Strict baseline advanced** (`locale-1.md` § 8.5 rule 4, EXECUTED): the first serving run of the candidate gave 90/91;
   the only failure was `cm1-identity-content`, the only `DIFF` URL content `/` (`cm1-identity-commerce` 18 × `same`).
   Then `node test/serving-contract/cm1-byte-identity.mjs capture test/serving-contract/cm1-byte-identity/baseline` (from
   `renderer/`; build `Nj_Hl05gMXjIHRLuWy5wx`). Check after the re-capture (EXECUTED): the new `baseline/` differs from
   `before/` under CM1-A1 on content `/` only, and `checkExpected` with the listed entry reports nothing on all 32 URLs;
   `client-modules.json` is unchanged. The raw `.body` files of the 39 HTML pages change (build id, asset hashes, which
   CM1-A1 masks), as at every earlier re-capture; the 12 non-HTML bodies (sitemap, robots, llms, feed) are byte-equal. History row added in `cm1-byte-identity/README.md`.
5. **Client states** (`renderer/test/unit/locale-1c-blocks-client.test.ts`, jsdom, through `@amodx/plugins/render`):
   en-US markup equals the `0c0dbc8` capture except exactly the declared L-ALL-2 dates — `reviews-toggle` steps 0-1
   (`31 octombrie 2026`) and `reviews-dates` steps 0 (`31 octombrie 2026`) and 6 (`""`: the raw date string) →
   `October 31, 2026`; each declared text must occur exactly once in the capture. The capture file is not edited.
   Before the change, with the pre-change `dist`, the suite passed 44/44 (EXECUTED): the `0c0dbc8` capture still equals
   the HEAD en-US markup. The date cases of § 1 for en-US, en_US, no/malformed tenant locale, ro-RO, en-GB and de-DE
   tenants; the non-string attributes; a spy proves the formatter receives the literal `"en-US"` (not the runtime
   default) for an en-US tenant.
   Bound mutations (EXECUTED on the built module, restored by `cmp`): the old line → 10 failures; `""` passed raw → 6;
   runtime default instead of `"en-US"` → 7 under `LC_ALL=de_DE.UTF-8` and, after the spy was added, 1 on the en-US
   machine; restored → 47/47 (also under `LC_ALL=de_DE.UTF-8`).
6. **en-GB**: no en-GB serving fixture exists (`fixtures.mjs`: "No en-GB copy"); en-GB is proven in the jsdom cases.

## 4. Ledger row that occurred (exact strings)

| Row | Fixture | URL | Before → After |
|---|---|---|---|
| L-ALL-2 | `content` (en-US, serving) | `/` | `31 octombrie 2026` → `October 31, 2026` |
| L-ALL-2 | jsdom `reviews-toggle`, en-US | steps 0, 1 | `31 octombrie 2026` → `October 31, 2026` |
| L-ALL-2 | jsdom `reviews-dates`, en-US | step 0 (absent) | `31 octombrie 2026` → `October 31, 2026` |
| L-ALL-2 | jsdom `reviews-dates`, en-US | step 6 (`""`) | `2026-10-31T12:00:00.000Z` → `October 31, 2026` |

No other en-US capture renders a reviews carousel (EXECUTED: a search of all 139 `before/` bodies finds a review date
only on content `/` and roContent `/`). RO fixtures: no change (no attribute). RO tenants with a `""` or non-string
attribute: the date changes to ro-RO (§ 1); no fixture holds one.

## 5. Oracles (EXECUTED 2026-11-01, in this order, on the final code; re-run in iterations 1 and 2 with the same results)

`…` = `/Users/apple/Documents/APLICATII BIJUTERIE`.

| # | Command | Exit | Last lines |
|---|---|---|---|
| 1 | `npm --prefix "…/amodx" run build` | 0 | |
| 2 | `npm --prefix "…/amodx" run typecheck` | 0 | |
| 3 | `npm --prefix "…/amodx/packages/shared" test` | 0 | `Tests 248 passed (248)` |
| 4 | `npm --prefix "…/amodx/packages/plugins" test` | 0 | `Tests 204 passed (204)` |
| 5 | `npm --prefix "…/amodx/renderer" test` | 0 | `Test Files 22 passed (22)` / `Tests 365 passed (365)` |
| 6 | `npm --prefix "…/amodx/renderer" run test:serving` | 0 | `# tests 91` / `# pass 91` / `# fail 0` |
| 7 | `npm --prefix "…/amodx/admin" run test:unit` | 0 | `Tests 214 passed (214)` |
| 8 | `npm --prefix "…/amodx/backend" run test:unit` | 0 | `Tests 1192 passed \| 1 skipped (1193)` |
| 9 | `npm --prefix "…/amodx/tools/mcp-server" test` | 0 | `# pass 13` / `# fail 0` |
| 10 | `git -C "…/amodx" diff --check` | 0 | (no output) |
| + | `git -C "…/amodx" diff --stat -- infra docs/slices/locale-1.md docs/slices/locale-1a.md docs/slices/locale-1b.md docs/slices/locale-1c.md docs/slices/locale-1d.md docs/slices/cmrc-counties-1.md` | 0 | prints nothing |
| + | `git -C "…/amodx" grep -n '"ro-RO"' -- packages/plugins/src/reviews-carousel` | 1 | prints nothing |
| + | `git -C "…/amodx" status --porcelain -uall` | 0 | only allocated paths (iteration 1: `locale-strings.ts` authorized, D1; the two `ARCHITECTURE.md` files allocated, § 11) |
| + | `npm --prefix "…/amodx/renderer" run test:serving`, runs 2-6 after gate 6 | 0 × 5 | 91/91 each |

Serving lines (gate 6): `(loc1-subjects) 8 subjects, 81 URLs …; RO copies 58 URLs`; `(loc1-text-content) 10 HTML URLs,
155 extracted items, all equal except the listed ledger texts: / "31 octombrie 2026" → "October 31, 2026"`;
`(loc1-diff-reviews-date-1) content /: 1 listed difference(s) [cat 3 L-ALL-2 …]`; `(loc1-ro-content) 14 URLs, 0 text
changes`, `(loc1-ro-commerce) 25 URLs, 0`, `(loc1-ro-catalog) 19 URLs, 0`; `cm1-identity-*` all `same`.
Never run: `cd backend && npm test`.

## 6. Abstractions introduced (one line each)

- `textMismatches(…, listed)` optional parameter (`proof.mjs`) — users: rows `loc1-text-*`, `loc1-text-mutation`; axis:
  the ledger texts a slice lists per URL (data, not code); rejected: a second, near-identical text helper in
  `contract.test.mjs` (duplicates the status/structure loop).
- `ledgerTexts`, `LOC1_START`, `LOC1_EN_ROWS` (`contract.test.mjs`) — users: the `loc1-*` rows; axis: none (one place
  for the start commit in titles and for the en-US rows in force); rejected: the commit and row literal repeated in
  five titles and two assertions.
- `L_ALL_2` / `withLedger` (jsdom test) — users: the en-US oracle; axis: none; rejected: re-capturing the `0c0dbc8`
  file (it is an earlier slice's immutable evidence) or a new capture file for four changed strings.
- The `text` field of a category-3 entry (`expected-diff.json`) — users: `loc1-subjects`, `loc1-text-*`; `checkExpected`
  ignores it (it reads `before`/`after`); rejected: deriving the text from the HTML substring at run time (a second
  extraction path).

## 7. Deviations and local decisions (one line each)

- **D1** `packages/shared/src/locale-strings.ts` is allocated "only if `blockStrings.dateLocale` must change". Its
  behaviour does not change, but its doc comment stated that the carousel uses `"ro-RO"` for an en-US tenant, which is
  now false. I corrected that comment only (no code, no test). **Authorized** by ruling LRD1-DOCUMENTATION-SCOPE = A,
  item 1 (§ 11).
- **D2** `""` counts as "no setting" (operator decision of the packet). Before: the raw date string (the caught
  `RangeError`). A whitespace-only attribute such as `" "` is a non-empty string: passed raw, as before (raw date
  string) — the packet's rule 1 read literally.
- **D3** A non-empty but invalid attribute (`"xx-YY"`, `"ro_RO"`) is still the block's own setting, passed raw (the
  runtime default; the raw date string): the ruling replaces only the case "no other setting".
- **D4** The new capture set lives in `locale-1/reviews-date-1/` (the `locale-1/<slice>/` convention; this slice is not a
  `locale-1` letter); the byte row is renamed `loc1-diff-reviews-date-1` (a row id says which set it checks, as
  `loc1-diff-1c` did).
- **D5** The jsdom test stays in `renderer/test/unit/` (the `locale-1c` D2 reason: the plugins package has no DOM test
  harness); `packages/plugins/test/**` is not changed (`reviewsCarousel.test.ts` asserts no date).

## 8. Findings

- **F-LOCALE-REVIEWS-DATE — CLOSED** by the human's ruling of 2026-11-01 (this slice).
- **F-LRD1-ARCH-STALE — CLOSED** in iteration 1 (§ 11): `renderer/ARCHITECTURE.md` named set `1c` and row
  `loc1-diff-1c` as current; now set `reviews-date-1`, row `loc1-diff-reviews-date-1`, and every other current-truth
  sentence of its locale section matches this slice.
- **F-LRD1-INVALID-ATTR** (not changed): a block whose `locale` attribute is a non-empty but invalid tag (`ro_RO`, `" "`)
  shows the raw ISO date string. The block schema has no `locale` field, so only a hand-edited block can carry one. Kept
  by D3; normalising the attribute would change the `-u-nu-arab` case (`locale-1.md` § 3.4).

## 9. Repeat runs and cleanup

6 consecutive serving runs (gate 6 + 5): each exit 0, `# pass 91` / `# fail 0`. Removed after use:
`/tmp/LOCALE-REVIEWS-DATE-1-before` (worktree), `/tmp/LOCALE-REVIEWS-DATE-1-scripts`, `/tmp/LOCALE-REVIEWS-DATE-1-mut`,
`/tmp/LOCALE-REVIEWS-DATE-1-gates`, `/tmp/LOCALE-REVIEWS-DATE-1-serving-1.log`.

## 10. Operator's staging checklist and not done here

1. Renderer to staging (no admin, backend or infra change). Layer 2 extraction of the 51 CM1 URLs against a capture
   taken before the deploy: text-identical, except the staging `cm1-content` home if it holds a reviews carousel without
   a `locale` attribute (then exactly L-ALL-2: Romanian date → en-US date). Not run here.
2. Prod: every en-US tenant's reviews carousel without its own `locale` changes from Romanian to en-US dates (the
   ruling). RO tenants: a carousel without the attribute keeps its date; one with a `""` or non-string attribute (only
   hand-edited blocks) now shows the ro-RO date instead of the raw date string or the runtime default.
3. Not done: `docs/ROADMAP.md` (the operator's, at closeout — its `locale-1` row still says "F-LOCALE-REVIEWS-DATE left
   to the human"), `CURRENT_SLICE.md`, `docs/TECH-DEBT.md` (not allocated). No
   browser run: the carousel is a client component; server and client both format with the same explicit locale, so no
   hydration difference is expected (INFERRED, not observed in a browser).

## 11. Operator ruling after review 0 (2026-11-01 ~19:45Z, under the human's delegation; dated, reversible) — iteration 1

| Ruling | Class of defect | Rule now in the tree |
|---|---|---|
| **LRD1-DOCUMENTATION-SCOPE = A**: (1) the comment-only correction of `locale-strings.ts:214-216` is authorized; (2) allocation extended, documentation only, to `renderer/ARCHITECTURE.md` and `packages/shared/ARCHITECTURE.md:126` | a current-truth sentence that still describes a superseded rule (a false name), left because its file was outside the allocation | every CURRENT-truth sentence that names the reviews-carousel date rule, the current `loc1-*` set and byte row, the en-US "no change" claim or the baseline's origin states this slice's behaviour; historical records (`docs/slices/locale-1*.md`, the `1c/` set, the README history rows of earlier slices) stay as written. Basis of completeness: `git grep -n "loc1-diff-1c\|set (\`1c\`\|F-LOCALE-REVIEWS-DATE"` over all tracked files except `docs/slices`, `docs/shipped` and the generated `*_MAP.md` — every remaining hit is a historical record, the new text, or `docs/ROADMAP.md` (the operator's) |

No code, test or capture changed in iteration 1. Iteration-1 evidence: the ten gates re-run in order and 5 more serving
runs (§ 5; logs `.agent-manager/slices/LOCALE-REVIEWS-DATE-1/logs/iter1-*`).

## 12. Review 0, finding F-LRD1-RO-PRESERVATION — iteration 2

| Finding | Class of defect | Rule now in the tree |
|---|---|---|
| F-LRD1-RO-PRESERVATION: `renderer/ARCHITECTURE.md:512` said "RO tenants unchanged" and this record (§ 4, § 10 item 2) "RO: no change"; the reviewer reproduced a ro-RO site with `locale: ""` or `null` changing from the raw date string to `31 octombrie 2026` | a preservation claim stated for a whole tenant class when it holds only for the case the fixtures test (no attribute) | every Romanian preservation claim names its scope: a carousel WITHOUT a `locale` attribute keeps its date (the RO fixtures, every editor-made block); a `""` or non-string attribute takes the tenant's locale on RO tenants too. Applied in `renderer/ARCHITECTURE.md`, this record (§ 1 paragraph under the table, § 3 item 3, § 4, § 10 item 2), the comment above the `loc1-ro-*` rows in `contract.test.mjs`, the `rule` text of `reviews-date-1/ro-expected.json`, and the jsdom ro-RO case title (its assertions unchanged). Basis of completeness: a search of every changed and new file (except captures) for RO / ro-RO / Romanian claims — every remaining one is scoped or is not a preservation claim |

No behaviour, no assertion and no capture changed in iteration 2. Evidence: § 5 re-run (logs
`.agent-manager/slices/LOCALE-REVIEWS-DATE-1/logs/iter2-*`).


## 13. Operator closeout (2026-11-01)

- Review: relay review 1 (Codex `gpt-6.1-sol`) approved after the operator ruling LRD1-DOCUMENTATION-SCOPE = A (§ 11);
  the date behaviour was accepted at review 0 (witness: English `content /` `"31 octombrie 2026"` → `"October 31, 2026"`;
  Romanian with no attribute unchanged; en-GB `"31 October 2026"`).
- Gates (OPERATOR-EXECUTED on the approved candidate, unchanged): the ten common gates exit 0; infra, the spec and
  the earlier records untouched; no dependency line; every path inside the (extended) allocation; the `"ro-RO"`
  literal gone from the carousel (grep exit 1); no trailing whitespace. Serving suite: 6 consecutive runs exit 0.
- Staging: deployed from this tree (code only: 3 Lambda assets, the admin and renderer uploads, the admin config
  write). Renderer build `JbiMn8xs3jZFnWpSUXFug` → `wGKV_V8ivq4FovkfgSPMy`; the 51 CM1 URLs text- and
  status-identical — no staging fixture page holds a reviews carousel, so the change has no staging witness; the
  serving fixtures (§ 3) are the proof.
- Left to the human: the prod deploy (no pre-deploy step for this slice).
