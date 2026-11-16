# BADGE-CASE-1 — the showcase badge matches without regard to letter case (implementation record)

Status: **IMPLEMENTED** (2026-11-16, builder), uncommitted, awaiting review. Start: `main` at `a41ea1f`, tree clean.
Track: SHOP-LOOK (follow-up of `shop-look-1d`). Depends: `shop-look-1d` (the badge). Maturity: the `categoryShowcase`
badge stays **PROTOTYPE** until the operator's closeout. Closes finding F-1D-BADGE-CASE (`docs/slices/shop-look-1d.md`,
operator closeout). Amends `docs/slices/shop-look-1.md` § 4.2 (row `badgeTags`) and § 7.4 by the appended § 17.6.

## 1. The ruling

Human ruling 2026-11-16. Question: "Badge letter case: treat "Top pick" and "TOP PICK" as the same? Today they are not,
and the badge is drawn in capitals, so the owner cannot see why one product has no badge." Answer, verbatim: "ok yes".

Purpose / risk retired: an owner types a badge tag in one letter case and a product tag in another; the card draws the
badge in capitals (CSS `uppercase`), so the two look the same, but no badge shows. The owner cannot see the cause.

## 2. The cause

`packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx`, `badgeOf` (at `a41ea1f`, lines 52-55):
`badgeTags.find((tag) => tags.includes(tag))`. `Array.prototype.includes` compares each element with strict equality
(SameValueZero), so `"Top pick"` and `"TOP PICK"` are different. The badge `<span>` has the class `uppercase`.

## 3. The change

| File:line | Change | Serves |
|---|---|---|
| `packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx:54-58` | `badgeOf`: keep only the product tags that are strings, lower-case them (`own`), then return the first block entry whose `toLowerCase()` is in `own`. | the new § 7.4 match rule |
| `CategoryShowcaseRender.tsx:46-53` | doc comment states the new rule (letter case ignored, spaces kept, non-strings never match, text = the block's entry as stored) | § 3 texts |
| `packages/plugins/src/category-showcase/CategoryShowcaseEditor.tsx:19-21` | `badgeTagsFromText` comment: the site ignores letter case but not spaces, and draws the entry as typed | § 3 texts |
| `CategoryShowcaseEditor.tsx:162` | help text: "Capital letters do not count: TOP PICK matches Top pick. The badge shows the tag as you type it here." | § 3 texts |
| `packages/plugins/test/sectionBlocks.test.ts:153-200` | the old test "exact match: …" is replaced by five tests (§ 4) | taxonomy rows |
| `docs/block-types.md:77-81` | § Category showcase card options, `badgeTags` | § 3 texts |
| `packages/plugins/ARCHITECTURE.md:313-315`, `:367` | the `badgeOf` summary and the test table row | § 3 texts |
| `tools/mcp-server/src/index.ts:621` | the `badgeTags` description text of the block shape | § 3 texts |
| `docs/slices/shop-look-1.md:877-891` | § 17.6 appended (dated amendment; § 4.2 and § 7.4 not rewritten) | § 3 texts |

How the new `badgeOf` works. `Array.isArray(tags)` is unchanged (not a list → no badge). `tags.filter(typeof t ===
"string")` drops every value that is not a string before any conversion; this is the guard that makes "a product tag
that is not a string never matches and never throws" true — `null.toLowerCase()` would throw, and `String(null)` would
equal the block entry `"null"`. `.map(toLowerCase)` builds the product's lower-case tags once per card. `badgeTags.find`
walks the BLOCK's list in its order and returns the block's own entry, so precedence and the drawn text are as before.
No trimming is added. Block entries are already non-blank strings when they reach `badgeOf` (`:158`, unchanged).

`String.prototype.toLowerCase()` is the Unicode default case mapping and does not depend on the locale, so the server
render and the browser fallback render give the same result (no hydration difference).

No new function is exported, no attribute, no schema, no editor control. The render file imports no runtime
`@amodx/shared` (plugin D3; the existing test "type-only `@amodx/shared` import" passes).

## 4. Tests — one per taxonomy row (`packages/plugins/test/sectionBlocks.test.ts`, describe "categoryShowcase — badge")

| Taxonomy row | Test (line) | Red before the change |
|---|---|---|
| block `["top pick"]`, `["Top Pick"]`; product tag `TOP PICK` → badge, text = block entry as stored | "letter case does not count: …" (`:156`): badges `[entry, null, null, entry, null]` on the five fixture products; removing the badge spans gives the baseline HTML | yes |
| block `["TOP PICK"]`; product tag `top pick` → badge `TOP PICK` | same test (`:164-165`) | yes |
| block `["TOP PICK "]`, `[" TOP PICK"]`, `["TOPPICK"]`; product `TOP PICK` → no badge, baseline HTML. Product tag `TOP PICK `, block `["TOP PICK"]` → no badge | "spaces count: a tag that differs by a space does not match (no trimming)" (`:167`): baseline equality; for the reverse case the HTML equals the same products rendered without `badgeTags` | no (preserved behaviour) |
| block `["popular", "Top pick"]` and `["Top pick", "popular"]`; product with both tags in capitals → the block's first entry wins | "letter case does not change the precedence: …" (`:177`), with the product's tags in both orders | yes |
| `["Sale", "SALE"]` → one badge, the first entry | "two block entries that differ only by case: …" (`:185`), product tags `SALE`, `sale`, `Sale`; one `<span>` each | yes |
| product `tags` holds a number, `null`, an object beside a matching string → the string matches, no throw | "a product tag that is not a string never matches …" (`:193-195`): `[42, null, {a:1}, "top pick"]` → `TOP PICK` | yes |
| product `tags` holds only non-strings → no badge, no throw | same test (`:196-200`): `[42, null, {a:1}, true, undefined]` against block entries `"42"`, `"null"`, `"[object Object]"`, `"true"`, `"undefined"` (what a string conversion would give) → zero badges, HTML equals the render without `badgeTags` | no (today's `includes` also never matched) |
| every existing badge test with exactly equal strings passes unchanged | `:122`, `:130`, `:138`, `:143`, `:203`, `:208`, `:214`, and `:96` ("badgeTags that no product's tags hold"), plus `:237` (fallback fetch) | — |

Red run (EXECUTED, before the change): `cd packages/plugins && npx vitest run test/sectionBlocks.test.ts` → 4 failed |
45 passed; the 4 failures were the four rows marked "yes". Green after the change: 49 passed.

Renamed test: "exact match: a tag that differs only by case or by spaces does not match (no trimming, no case folding)"
is gone. Its space cases moved to "spaces count: …"; its case cases now assert the opposite result in "letter case does
not count: …". No test name states the old rule.

## 5. The search for texts that state the old rule (§ 3 of the packet)

Scope: every git-tracked file of the repository except `*.json` and `*.lock` (`git grep -I`).

1. `git grep -n -I -i -E "badge" -- . ':!*.json' ':!*.lock' | grep -i -E "exact|case kept|case and spaces|case folding|case-sensitive|case sensitive|letter case|as stored|same case|uppercase"`.
2. Context search (3 lines either side) for `badgeTags|badge tag`, filtered for `exact|case|capital|spaces|fold|trim`, in
   `docs/block-types.md`, `packages/plugins/ARCHITECTURE.md`, `tools/mcp-server/src`, `packages/plugins/src`, `admin`,
   `renderer/src`, `backend/src`, `packages/shared/src`, `docs/*.md`, `CLAUDE.md`.
3. `git grep -n -I -E "capitals included|match exactly|Exact match, capitals"` (tests that pin the help text: none).

Current texts found and corrected: the five rows "§ 3 texts" of § 3 above. `tools/mcp-server/src/tool-shapes.ts` holds
no badge text (OBSERVED, `grep -i badge` empty) — untouched. Not a rule statement: `CategoryShowcaseRender.tsx:117`
and the test literals (the CSS class `uppercase`); `renderer/test/serving-contract/contract.test.mjs:3296-3311` (exact
same-case fixtures; they pass unchanged). History, left as written: `docs/slices/shop-look-1d.md:32`, `:68`, `:258`,
`:268`. Ratified spec, amended by append only: `docs/slices/shop-look-1.md:264` (§ 4.2) and `:468-476` (§ 7.4).

## 6. Gates (all EXECUTED on the final tree, 2026-11-16, each bare, exit code by `echo $?`)

| Command | Expected | Actual |
|---|---|---|
| `npm run build` (root) | 0 | 0 |
| `npm run typecheck` (root) | 0 | 0 |
| `cd packages/plugins && npm test` | 0 | 0 — 12 files, 355 tests |
| `cd packages/shared && npm test` | 0 | 0 — 22 files, 385 tests |
| `cd renderer && npm test` | 0 | 0 — 45 files, 625 tests |
| `cd renderer && npm run test:serving` | 0, no capture or expectation changed | 0 — 124 / 124; `git status --short renderer` empty |
| `cd admin && npm run test:unit` | 0 | 0 — 15 files, 296 tests |
| `cd backend && npm run test:unit` | 0 | 0 — 1456 passed, 1 skipped |
| `cd tools/mcp-server && npm test` | 0 | 0 — 17 / 17 |
| `git diff --check` | 0 | 0 |

NOT RUN: `cd backend && npm test` (forbidden by the packet; uses staging DynamoDB). No staging or browser run: the change
is a pure render function covered by the static and streaming render tests. No backend route change, so `routes.json`
is not refreshed.

## 7. Findings

- **F-BC1-UNICODE (information, no action).** `toLowerCase()` is a case mapping, not full Unicode case folding. Pairs
  such as `STRASSE` / `straße` or Turkish dotted `İ` / `i` do not match. The ruling names `toLowerCase()`; a change
  needs a new ruling.
- **F-BC1-SPACES (non-scope, kept).** An outer space still blocks a match, and the CSS `uppercase` badge does not show
  it. The editor trims what the owner types (`badgeTagsFromText`), so this case comes only from a product tag with a
  space or from data written by the API/MCP. Trimming was not ruled (packet § 7).

## 8. Non-scope

Outer spaces (trimming); a badge field on the product; duplicate form labels; anything on the checkout.

## Operator closeout

2026-11-16. Builder `claude-opus-5-5`; reviewer `gpt-6.1-sol` (Codex), approved on the first cycle. The reviewer's
sandbox could not run the suites (read-only); the operator ran the ten gates on the unchanged candidate: all exit 0,
allocation and append-only oracles empty. Staging diff: renderer functions, the two bucket deployments, the admin
config, descriptions; deployed.

Staging (tenant `cm1-commerce`, one probe category, three products, one published page with a showcase,
`badgeTags: ["Top pick"]`, read in Chromium):

| Product tag | Badge on the card |
|---|---|
| `TOP PICK` | `Top pick` (drawn in capitals by CSS) |
| `top pick` | `Top pick` |
| `TOP PICK ` (end space, stored as sent by the API) | none |

Not checked: the editor's help text in a browser. The probes were removed (the page archived).

Finding: the products API stores a tag with an end space as sent; the admin tag field trims (see
`admin/src/components/ui/tag-input.tsx`), so the case arises only for tags written through the API or an import.

Prod deploy: the human's.
