# REFACTOR-SHARED-1 — `packages/shared/src/index.ts` into one file per domain (moves only)

- **Status:** IMPLEMENTED 2026-11-27 — built, operator gates pending. Iteration 1 (after review-0): acceptance blocked by
  DECISION_REQUIRED `RS1-ENUM-KEY-ORDER` (§ *Decisions*)
- **Track:** maintenance (order of work from 2026-11-27, `docs/ROADMAP.md`: the first of the pure-move refactor slices,
  before Track B)
- **Depends:** none
- **Source plan:** none. Ratified by the human's order of work of 2026-11-27 ("I would also add a slice for refactoring
  the 3 big files if it makes sense before moving on to a consequential track like the private commerce table", then
  "Four I mean", then "Ok dynamo too"). ROADMAP row `refactor-shared-1`.
- **Maturity:** unchanged (a move changes no module's maturity).

## Purpose / risk retired

`packages/shared/src/index.ts` held 3,082 lines (the ROADMAP row said 2,938; the file grew since): every schema of
every domain. Most slices edit it, so every review read it and two slices in a row collided in it. After this slice
each domain has its own file and `index.ts` only re-exports. Nothing a user, a visitor or another package can observe
changes. The next track (the private commerce table, Track B) changes the order and customer schemas; it finds them in
`orders-and-customers.ts` (185 lines).

## Scope

1. The declarations of `index.ts` move, byte for byte with their comments, into 24 domain files (file map below).
2. `index.ts` keeps only re-exports: the re-exports it already had for the existing rule modules, and one
   `export * from "./<file>.js"` per domain file. It imports nothing for its own use.
3. Docs: `packages/shared/ARCHITECTURE.md`, root `CLAUDE.md` and `AGENTS.md`, and the live docs that point to
   `index.ts` as the home of a schema (list in § *Docs corrected*).
4. Iteration 1, ruling RS1-DAG-SCOPE = A: the five older modules that imported types from the barrel
   (`payment-transition.ts`, `form-date.ts`, `coupon.ts`, `locale-strings.ts`, `language-packs/types.ts`) import them
   from the domain file that now holds each type. Only the import line changes (in `locale-strings.ts` one line becomes
   two, because its types now live in two files).

## Non-scope

No rename, no reordering inside a declaration, no type change, no new export, no removed export, no new abstraction,
no new dependency, no edit outside `packages/shared/src/`, `packages/shared/ARCHITECTURE.md`, `docs/`, and the root
`CLAUDE.md`, `AGENTS.md`, `CURRENT_SLICE.md`. A defect found on the way is recorded in § *Findings, not fixed*.
In the five older modules of scope item 4, only the import line changes; their emitted JavaScript is byte-identical.

## Architectural boundaries

- The public surface is `index.ts` only, as before. Runtime export names identical line for line; types by the
  bounded oracle of ruling RS1-TYPE-ORACLE (proof 1 — not met for 8 lines, decision `RS1-ENUM-KEY-ORDER`).
- The run-time module graph inside `shared` is a DAG, and no file inside `packages/shared/src` imports the barrel
  `./index.js` (§ *Module graph*). The type-only cycles that remain are enumerated there and accepted by ruling
  RS1-DAG-SCOPE = A.
- Deep imports into `shared/dist` keep working: no existing file is moved or renamed (ruling 7, § *Deep imports*).
- Tests in `packages/shared/test` import what they imported before (ruling 8): no test file changed.

## File map (ruling 1)

Line counts are of the source files in `packages/shared/src/` (`wc -l`, EXECUTED). Each file starts with two comment lines (what it holds;
the moves-only rule) and its own imports. Every other line is a line of the old `index.ts`, in its old order.

| File | Lines | Holds (old `index.ts` section) | Imports (besides `zod`) |
|---|---:|---|---|
| `content.ts` | 159 | content status and access enums (§ 1), inline rich text and `FULL_BLEED_DEFAULTS` (§ 1b), access policy (§ 2), routes (§ 3), content item, comments (§ 4) | `theme` |
| `context-and-work-items.ts` | 58 | `WorkItemStatus` (§ 1), context items (§ 5), work items (§ 6) | — |
| `signals.ts` | 26 | `SignalStatus`, `SignalSource` (§ 1), `SignalSchema` (SIGNALS) | — |
| `tenant-config-parts.ts` | 262 | the parts of `TenantConfigSchema` without a file of their own: `LinkSchema` (§ 1), quick contact, contact channels, top bar, commerce bar, search bar, reCAPTCHA, order e-mail templates, company and legal, MailerLite settings, integrations, header, footer, GDPR (§ 7) | `theme` |
| `url-prefixes.ts` | 64 | `URL_PREFIX_DEFAULTS`, `UrlPrefixesSchema`, `urlPrefixesOf`, `catalogListingPath` | — |
| `theme.ts` | 159 | colour grammar `isCssColor` / `CssColorSchema`, `FontWeightSchema`, `ThemeSchema`, saved themes, `THEME_PRESETS` | — |
| `tenant-config.ts` | 267 | `TenantStatus`, `TenantConfigSchema`, `languageSettingsProblem` (LANG-1 write rule), `isCatalogMode` | `locale-strings`, `languages`, `scheduling`, `content`, `theme`, `effects`, `url-prefixes`, `locale-table`, `tenant-config-parts` |
| `users-and-keys.ts` | 55 | `UserRole`, service keys, `UserProfileSchema`, `TenantMemberSchema` | — |
| `effects.ts` | 56 | GPU effect configuration | — |
| `locale-table.ts` | 458 | `PluralTextsSchema`, the three locale-table parts, `BookingStringsSchema`, `CountText`, `ResolvedPart`, `LocaleStrings` | `locale-strings` (value `BOOKING_TEXT_KEYS`), `language-packs` (type) |
| `media-asset.ts` | 19 | `AssetSchema` (MEDIA ASSETS) | — |
| `leads-and-newsletter.ts` | 95 | `LeadSchema`, the newsletter subscription, `newsletterCanSendAgain` | — |
| `audit-log.ts` | 21 | `AuditLogSchema` (AUDIT LOG) | — |
| `products.ts` | 168 | product enums and parts, `deriveGallery`, `ProductSchema` | `glam-import-profile` |
| `glam-import-profile.ts` | 80 | `FacetModesSchema`, `SpecKeyRuleSchema`, `GlamImportProfileSchema`, `ImportLabelsSchema`, `IMPORT_LABELS_WITHOUT_MARKER` | — |
| `categories.ts` | 42 | `CategorySchema` | `content` |
| `delivery.ts` | 34 | `DeliveryConfigSchema` | — |
| `orders-and-customers.ts` | 185 | address, billing, order item, status history, `PaymentStatusSchema`, `OrderSchema`, `CustomerSchema`, the checkout input, the price-changed answer | — |
| `order-price.ts` | 187 | `linePrice`, `parseMoney`, `localeUsesDecimalComma`, `roundToCents`, `sameAmountInCents`, `toMachineFormPriceInputs` and their types | `locale-strings`, `products` (type) |
| `coupon-schema.ts` | 27 | `CouponSchema` (the coupon RULE stays `coupon.ts`) | — |
| `reviews.ts` | 269 | review record, photos, import batch, import report DTOs | — |
| `popups.ts` | 29 | `PopupSchema` | — |
| `forms-and-interest-list.ts` | 151 | form fields, `formFieldsOf`, definitions, submissions; the interest-list system form and its API bodies | `normalizeEmail`, `form-date` |
| `email-dns.ts` | 230 | e-mail DNS recipes and the DNS-check DTO (slice email-2) | none (not even `zod`) |
| `index.ts` | 118 | re-exports only | — |

Five files are under 30 lines (`media-asset`, `audit-log`, `signals`, `coupon-schema`, `popups`); each is one record
with its own section in the old file, the exception ruling 1 names. `locale-table.ts` (458) is the largest: its three
string schemas are one table and each stays whole.

Placement choices (local detail, recorded, not asked):

- `isCatalogMode` goes to `tenant-config.ts`, not `products.ts` (it sat after `ProductSchema`): it reads only the
  tenant flag, and `TenantConfigSchema.catalogMode` says "Read it through isCatalogMode()".
- The order e-mail templates go to `tenant-config-parts.ts`, not `orders-and-customers.ts`: they are a
  `TenantConfigSchema` member stored on the tenant, and Track B's file then holds the order and customer records only.
- The five enums of section 1 ("GLOBAL ENUMS & CONSTANTS") go to the files of their domains. That banner is the one
  comment that no longer describes anything and is not kept. Every other section banner moves with its section
  (`§ 7 INFRASTRUCTURE & SETTINGS` heads the settings parts in `tenant-config-parts.ts`).
- `coupon-schema.ts` and `media-asset.ts`, not `coupons.ts` and `assets.ts`: `coupon.ts` (the rule) and `media.ts`
  (upload classification) exist beside them, and a name one letter away would mislead.

Abstractions introduced: none. 24 files are a split of one file, not a new layer; `index.ts` stays the one public entry.

## Module graph (ruling 2)

Edges inside `src/` after iteration 1 (`→` value import — survives compilation; `⇢` type-only import — erased;
`zod` omitted). Produced by the trail script `graph.mjs` from the import statements (TypeScript parser, deterministic).

- `categories.ts` → `content.ts`
- `client-address.ts` ⇢ `zoned-time.ts`
- `content.ts` → `theme.ts`
- `country-packs/en.ts` ⇢ `country-packs/types.ts`
- `country-packs/index.ts` ⇢ `country-packs/types.ts`, → `country-packs/en.ts`, → `country-packs/ro.ts`
- `country-packs/ro.ts` ⇢ `country-packs/types.ts`
- `coupon.ts` ⇢ `coupon-schema.ts`
- `form-date.ts` ⇢ `forms-and-interest-list.ts`, → `locale-strings.ts`, → `zoned-time.ts`
- `forms-and-interest-list.ts` → `normalizeEmail.ts`, → `form-date.ts`
- `index.ts` → `normalizeEmail.ts`, → `slug.ts`, → `locale-strings.ts`, → `languages.ts`, → `language-packs/index.ts`, → `sandbox.ts`, → `media.ts`, → `facets.ts`, → `catalog-listing.ts`, → `coupon.ts`, → `payment-transition.ts`, → `zoned-time.ts`, → `scheduling.ts`, → `client-address.ts`, → `content.ts`, → `context-and-work-items.ts`, → `signals.ts`, → `tenant-config-parts.ts`, → `url-prefixes.ts`, → `theme.ts`, → `tenant-config.ts`, → `users-and-keys.ts`, → `effects.ts`, → `locale-table.ts`, → `media-asset.ts`, → `leads-and-newsletter.ts`, → `audit-log.ts`, → `products.ts`, → `glam-import-profile.ts`, → `categories.ts`, → `delivery.ts`, → `orders-and-customers.ts`, → `order-price.ts`, → `coupon-schema.ts`, → `reviews.ts`, → `popups.ts`, → `forms-and-interest-list.ts`, → `form-date.ts`, → `country-packs/index.ts`, → `email-dns.ts`
- `language-packs/de.ts` ⇢ `language-packs/types.ts`
- `language-packs/en.ts` ⇢ `language-packs/types.ts`
- `language-packs/fr.ts` ⇢ `language-packs/types.ts`
- `language-packs/index.ts` ⇢ `language-packs/types.ts`, → `language-packs/en.ts`, → `language-packs/ro.ts`, → `language-packs/de.ts`, → `language-packs/fr.ts`
- `language-packs/ro.ts` ⇢ `language-packs/types.ts`
- `language-packs/types.ts` ⇢ `locale-table.ts`
- `locale-strings.ts` ⇢ `locale-table.ts`, ⇢ `glam-import-profile.ts`, → `language-packs/en.ts`, → `language-packs/index.ts`, ⇢ `language-packs/types.ts`
- `locale-table.ts` → `locale-strings.ts`, ⇢ `language-packs/index.ts`
- `order-price.ts` → `locale-strings.ts`, ⇢ `products.ts`
- `payment-transition.ts` ⇢ `orders-and-customers.ts`
- `products.ts` → `glam-import-profile.ts`
- `scheduling.ts` → `normalizeEmail.ts`, → `zoned-time.ts`
- `tenant-config-parts.ts` → `theme.ts`
- `tenant-config.ts` → `locale-strings.ts`, → `languages.ts`, → `scheduling.ts`, → `content.ts`, → `theme.ts`, → `effects.ts`, → `url-prefixes.ts`, → `locale-table.ts`, → `tenant-config-parts.ts`

Checks (EXECUTED, `node graph.mjs packages/shared/src`, exit 0; ruling RS1-DAG-SCOPE = A):

| Check | Required | Result |
|---|---|---|
| (1) cycles of the RUNTIME graph (value edges) | 0 | 0 |
| (2) imports of the barrel `index.ts` from a file inside `src/` | 0 | 0 (iteration 0: 5, all type-only; retargeted, scope item 4) |
| (3) elementary cycles of the full source graph | exactly the enumerated list | 14, all in the list below |

The 14 accepted type-only cycles (each holds at least one `⇢` edge, so none is a run-time cycle):

```
form-date.ts ⇢ forms-and-interest-list.ts → form-date.ts
locale-strings.ts ⇢ locale-table.ts → locale-strings.ts
language-packs/types.ts ⇢ locale-table.ts → locale-strings.ts ⇢ language-packs/types.ts
language-packs/index.ts ⇢ language-packs/types.ts ⇢ locale-table.ts ⇢ language-packs/index.ts
language-packs/index.ts ⇢ language-packs/types.ts ⇢ locale-table.ts → locale-strings.ts → language-packs/index.ts
language-packs/index.ts → language-packs/ro.ts ⇢ language-packs/types.ts ⇢ locale-table.ts ⇢ language-packs/index.ts
language-packs/index.ts → language-packs/ro.ts ⇢ language-packs/types.ts ⇢ locale-table.ts → locale-strings.ts → language-packs/index.ts
language-packs/en.ts ⇢ language-packs/types.ts ⇢ locale-table.ts → locale-strings.ts → language-packs/en.ts
language-packs/en.ts ⇢ language-packs/types.ts ⇢ locale-table.ts → locale-strings.ts → language-packs/index.ts → language-packs/en.ts
language-packs/en.ts ⇢ language-packs/types.ts ⇢ locale-table.ts ⇢ language-packs/index.ts → language-packs/en.ts
language-packs/de.ts ⇢ language-packs/types.ts ⇢ locale-table.ts → locale-strings.ts → language-packs/index.ts → language-packs/de.ts
language-packs/de.ts ⇢ language-packs/types.ts ⇢ locale-table.ts ⇢ language-packs/index.ts → language-packs/de.ts
language-packs/fr.ts ⇢ language-packs/types.ts ⇢ locale-table.ts → locale-strings.ts → language-packs/index.ts → language-packs/fr.ts
language-packs/fr.ts ⇢ language-packs/types.ts ⇢ locale-table.ts ⇢ language-packs/index.ts → language-packs/fr.ts
```

The ruling asked for the remaining cycles "between two domain files, each pair". Two are pairs (`form-date.ts` ⇄
`forms-and-interest-list.ts`, `locale-strings.ts` ⇄ `locale-table.ts`); the other 12 are longer and run through
`language-packs/`, because `language-packs/types.ts` reads the locale-table types and `locale-table.ts` reads
`BOOKING_TEXT_KEYS` (value, `locale-strings.ts`) and `BookingStrings` (type, `language-packs/`). All 14 are listed;
`graph.mjs` fails on a cycle not in the list and on a listed cycle that is gone. Negative control (EXECUTED): a copy of
`src/` with one added `import type … from "./index.js"` in `signals.ts` → check (2) = 1, one cycle "NOT ACCEPTED", exit 1.
Breaking the 14 needs a type to move (debt, `docs/TECH-DEBT.md` § *refactor-shared-1 residuals*, F-RS1-TYPE-CYCLES).

## Proofs

Scripts and outputs are in the slice trail `.agent-manager/slices/REFACTOR-SHARED-1/` (operational, gitignored):
`surface.mjs`, `classify.mjs`, `diagnose-neither.mjs`, `assignable.mjs`, `blocks.mjs`, `split.mjs` (the generator that
cut the file), `verify-moves.mjs`, `graph.mjs`; `index.orig.ts` = the old file (sha1 `bbd10a7f…`). Iteration-1 lists:
`i1/before` (built in a worktree of `HEAD`, `/tmp/REFACTOR-SHARED-1-base`, removed afterwards) and `i1/after` (the final
tree); `i1-pre/` = the same before the retarget of scope item 4.

### Proof 1 — public surface (ruling 4, amended by RS1-TYPE-ORACLE = A, bounded)

The oracle: (a) runtime names identical line for line; (b) the BOUNDED canonical type lists equal — canonicalization
does only two things: sorts the members of a union whose members are all literal types, and removes the numeric suffix
of a well-known-symbol property name (`__@toStringTag@NNNN`); no object member, signature or other union is reordered
and every other character stays as printed; (c) bidirectional assignability of every export with a negative control.
`before` = the untouched tree (iteration 0: built before any edit; iteration 1: rebuilt from a worktree of `HEAD`, and
its raw lists equal the iteration-0 `before/` lists).

| List | Lines | Result (EXECUTED) |
|---|---:|---|
| (a) `runtime-names.txt` — sorted export names of `dist/index.js` | 245 | **identical** (sha1 `5a77d329…`) — met |
| `runtime-values.txt` — per export: `typeof`; per zod schema its JSON Schema (`z.toJSONSchema`, every nested schema, key order, defaults); per function its arity | 245 | **identical** (sha1 `5c98aebf…`) |
| `type-surface.txt` — raw printed types (name, kind, value type, declared type, property types) | 403 | 17 lines differ |
| (b) `type-surface-bounded.txt` — the bounded canonical form | 403 | **8 lines differ — NOT met** (sha1 before `ed5411ab…`, after `67fbc11f…`) |
| (c) `assignable.mjs` | 405 pairs | **0 failures** — met; negative control (`PriceChangedAnswer.code` widened to `"price-changed" \| "x"`) → 1 failure, exit 1 |

The 17 differing raw lines, each classified by `classify.mjs` (EXECUTED; "symbol suffix" = equal after removing the
suffix only; "union order" = equal in the bounded form; anything else = NEITHER, a defect by the ruling):

| # | Export | Class |
|---:|---|---|
| 15 | `AvailabilityRule` | union order |
| 16 | `AvailabilityRuleSchema` | union order |
| 17 | `AvailabilityRulesSchema` | union order |
| 113 | `FacetModesSchema` | **NEITHER** |
| 123 | `FormDefinitionSchema` | **NEITHER** |
| 125 | `FormFieldSchema` | **NEITHER** |
| 127 | `FormSubmission` | union order |
| 128 | `FormSubmissionSchema` | **NEITHER** |
| 133 | `GlamImportProfileSchema` | **NEITHER** |
| 241 | `ProductSchema` | **NEITHER** |
| 258 | `ReviewImageSchema` | **NEITHER** |
| 262 | `ReviewSchema` | **NEITHER** |
| 280 | `Selection` | symbol suffix |
| 327 | `availableSlots` | union order |
| 339 | `dayWindows` | union order |
| 385 | `planDay` | union order |
| 394 | `slotDecision` | union order |

The 21 lines the ruling names are the iteration-0 tree (before the retarget). Classified the same way
(`i1-pre/`, EXECUTED): union order — `AvailabilityRule`, `AvailabilityRuleSchema`, `AvailabilityRulesSchema`,
`FormDatePair`, `FormDefinition`, `FormField`, `FormFieldType`, `availableSlots`, `dayWindows`, `formFieldsOf`,
`planDay`, `resolveFormDateOrder`, `slotDecision` (13); symbol suffix — `Selection` (1); NEITHER — `FacetModesSchema`,
`FormDefinitionSchema`, `FormFieldSchema`, `GlamImportProfileSchema`, `ProductSchema`, `ReviewImageSchema`,
`ReviewSchema` (7). The retarget changed which lines differ (the checker meets the files in another order): six
union-order lines became equal, `FormSubmission` (union order) and `FormSubmissionSchema` (NEITHER) began to differ.

**What the NEITHER lines are** (`diagnose-neither.mjs`, a diagnostic, NOT the oracle; EXECUTED): each of the 8 becomes
equal when, in addition, the members of an object type are sorted where EVERY member is `k: "k"` — the object zod's
`z.enum([...])` builds (`ZodEnum<{ always: "always"; never: "never"; }>` before, `{ never: "never"; always: "always"; }`
after). Nothing else differs. They come from four `z.enum` calls: `FacetModesSchema.attributes.mode` (also inside
`GlamImportProfileSchema`, `ProductSchema`), `FormFieldSchema.type` (also inside `FormDefinitionSchema`),
`FormSubmissionSchema.status`, `ReviewImageSchema.status` (also inside `ReviewSchema`). The order is in the emitted
`.d.ts` text itself: tsc's declaration emitter writes the key object in the order of the literal union, and that order
followed the order in which the checker first created each literal (OBSERVED: `index.d.ts` before has
`mode: z.ZodEnum<{ always; never }>`, `glam-import-profile.d.ts` after has `{ never; always }`). Bidirectional
assignability holds for all four. The ruling forbids sorting object members, so these 8 lines are defects by the
oracle and the slice does not meet ruling 4 as amended: DECISION_REQUIRED `RS1-ENUM-KEY-ORDER` (§ *Decisions*).

What the evidence supports, and no more: on this tree and on one other experiment (the untouched build with the
exports visited in reverse order, iteration 0: 19 raw lines differ there), the printed order of literal unions and of
these enum objects followed the order in which the checker met the declarations. I did not test other file layouts.

### Proof 2 — every line moved as written

`verify-moves.mjs packages/shared/src` (EXECUTED, PASS, iteration 0 and again on the final tree). The old file has
3,082 lines: 280 blocks (a statement with its attached comment lines, or a detached comment block) over 2,887 lines,
and 195 blank lines between blocks. Each of 279 blocks occurs as the same consecutive lines in exactly one file of
`src/`, in the old order within that file. The 7 own-use imports of the old `index.ts` are gone from it. 1 block
dropped: the banner `// 1. GLOBAL ENUMS & CONSTANTS`, whose five enums went to four files. Lines of `src/` that are not
old text: the two header lines of each domain file, the import lines, and in `index.ts` the 24 `export *` lines and
their two-line comment. `split.mjs` copies line ranges of `index.orig.ts`; nothing was retyped.

The five retargeted modules (scope item 4): `git diff` shows only their import line changed (6 insertions, 5
deletions); their emitted `.js` is byte-identical to the baseline build (EXECUTED: `cmp` of `payment-transition.js`,
`form-date.js`, `coupon.js`, `locale-strings.js`, `language-packs/types.js`); so are the other 19 `.js` files that
existed before — of the 25 old `.js` files only `index.js` differs.

### Proof 3 — evaluation order (ruling 3)

A zod schema is a value built at import time; one read before its module has run is a TDZ error even when TypeScript is
satisfied. With the runtime graph a DAG (§ *Module graph*) and siblings imported from their own files, every module runs
after every module it reads, so this cannot happen. Shown by execution: `surface.mjs` imports `dist/index.js`, reads
every one of the 245 exported values (0 `undefined`, no throw) and walks every zod schema with `z.toJSONSchema` — the
result is identical to the baseline. `cd packages/shared && npm test`: 33 files, 662 tests after each of the 24 move
steps, after the retarget, and in the final gates.

### Proof 4 — no consumer changes (ruling 5)

`npm run build` exit 0 and `npm run typecheck` exit 0 (8 workspaces), with no code path changed outside
`packages/shared/src/` (`git status`, EXECUTED, both iterations).

### Proof 5 — serving bytes (ruling 6)

`cd renderer && npm run test:serving`: 176/176. `npm run test:serving-bundle`: 61/61; its log shows its own
`open-next build` and `next build` in the run. No capture file changed (`git status renderer/` empty). EXECUTED in both
iterations. The Lambda bundles are not compared here; that is the operator's closeout check.

## Deep imports (ruling 7)

Search (EXECUTED, `git grep` over tracked files of every workspace, excluding `*.md` and lock files): `@amodx/shared/`,
relative paths `(../)+(packages/)?shared/(src|dist)`, configs naming `shared/(src|dist)`, and dynamic
`import(…)` / `require(…)` of either. A text search finds literal paths only; a path built at run time would not be
found (none is known). Results:

| Importer | Path | After the slice |
|---|---|---|
| `renderer/middleware.ts` | `@amodx/shared/dist/languages.js` | unchanged file, still built |
| `renderer/src/lib/site-segment.ts` | `@amodx/shared/dist/languages.js` | same |
| `renderer/src/lib/tenant-directory.ts` | `@amodx/shared/dist/languages.js` | same |
| `backend/vitest.config.ts`, `backend/vitest.unit.config.ts` | alias `@amodx/shared` → `packages/shared/src/index.ts` | `index.ts` still exists and re-exports everything |
| `tools/mcp-server/test/tool-shapes.test.ts` | `../../../packages/shared/src/index.ts` | same |
| `packages/shared/test/*.ts` | `../src/index(.js)`, `../src/{catalog-listing,facets,sandbox,zoned-time}` | unchanged (ruling 8) |

Every other consumer imports the barrel `@amodx/shared` (package `main` = `dist/index.js`).

## Docs corrected (ruling 9)

Search policy (review-0 F-RS1-DOC-RIPPLES): a reference that tells future work WHERE a declaration lives or goes is an
instruction and is corrected to the domain file; a reference that cites `index.ts:<line>` or records a command that was
run is evidence of its date and is kept. Search basis (EXECUTED): `git grep` for `shared/src/index`, `shared/index.ts`,
`in index.ts`, `(index.ts` over tracked `*.md` outside `docs/slices/` and `docs/shipped/`, and the same in code comments
(none outside `packages/shared` besides the functional imports of § *Deep imports*).

| File | Was | Now |
|---|---|---|
| `CLAUDE.md` rule 4, `AGENTS.md` rule 4 | schema changes go to `packages/shared/src/index.ts` | to the schema's domain file in `packages/shared/src/` (map in `packages/shared/ARCHITECTURE.md`) |
| `packages/shared/ARCHITECTURE.md` | "All Zod schemas … `index.ts`"; "consumers never import from a subpath"; `deriveGallery`, `formFieldsOf`, `catalogListingPath`, `languageSettingsProblem`, `MAX_REVIEW_IMAGES`, "Adding a key" and "Adding a new entity" placed in `index.ts`; `catalogListingPath` listed under `catalog-listing.ts` | the file map; "a new schema goes in its domain file; `index.ts` re-exports only"; the import-graph rule (no barrel import inside `src/`, the remaining type-only cycles); the renderer's `dist/languages.js` exception; each pointer to its file |
| `docs/commerce.md` | `parseMoney` in `index.ts` | `order-price.ts` |
| `docs/authentication-architecture.md` | `TenantMemberSchema` in `index.ts` | `users-and-keys.ts` |
| `docs/TECH-DEBT.md` | `RouteSchema` at `index.ts:280-288`; `RecaptchaConfigSchema` in `shared/index.ts` | `content.ts`; `tenant-config-parts.ts` |
| `docs/security-remediation-status.md` | `OrderInputSchema` in `index.ts` (2 lines) | `orders-and-customers.ts` |
| `docs/plan-public-pool-customer-auth.md` | A2 "File: `index.ts` → `IntegrationsSchema`"; file table rows for `customerAuth` and the auth URL prefix defaults | `tenant-config-parts.ts`; `tenant-config-parts.ts`; `url-prefixes.ts` |
| `docs/plan-email-onboarding.md` (rule 4 of its constraints) | a shared DNS DTO "goes in `packages/shared/src/index.ts` first" | its domain file in `packages/shared/src/` (the email-2 DTO is in `email-dns.ts`) |
| `docs/plan-ai-admin.md` (References) | tenant config patterns: `index.ts` | `tenant-config.ts` (parts: `tenant-config-parts.ts`) |
| `docs/plan-security-and-caching-remediation.md` | code sample "`// In packages/shared/src/index.ts`" above `OrderInputSchema` | `orders-and-customers.ts` |

Kept as evidence (line citations or recorded commands): `plan-courses-group-sessions.md:129`,
`plan-email-onboarding.md:117` (a grep that was run), `:375`, `:829`, `:1122`, `plan-reviews-import.md:81`, `:196`,
`plan-static-html-pages.md:694`, `:765`, and the slice records in `docs/slices/` and `docs/shipped/`.
`plan-public-pool-customer-auth.md:531` ("re-exported from `src/index.ts`") stays: still true.

Also updated: `docs/ROADMAP.md` row (status; the line count 2,938 → 3,082), `CURRENT_SLICE.md`, and
`docs/documentation.md` § *Naming Conventions* (prefix `refactor-`).

## Findings, not fixed

- **F-RS1-TYPE-CYCLES** (accepted by ruling RS1-DAG-SCOPE = A). The 14 type-only cycles of § *Module graph*.
  Breaking them needs a type to move (e.g. `FormField` next to the date rule, or the resolved locale types out of
  `locale-table.ts`) — not a move-only change. `docs/TECH-DEBT.md`.
- **F-RS1-USERROLE-DOC.** `packages/shared/ARCHITECTURE.md` § *Enums* gives `UserRole` = `GLOBAL_ADMIN, CLIENT_ADMIN,
  EDITOR`; the code (`users-and-keys.ts`) is `GLOBAL_ADMIN, TENANT_ADMIN, EDITOR`. Not a location claim, so not
  corrected here. Proposed: correct the table.
- **F-RS1-ENUM-KEY-ORDER.** Proof 1: the emitted `.d.ts` writes four zod enum key objects in another key order; 8
  lines of the bounded oracle. Decision below.

Closed in iteration 1: F-RS1-BARREL-TYPES (the five barrel imports, retargeted by scope item 4).

No false name was found in the moved declarations. The names I created (the 24 file names) say what each file holds;
`coupon-schema.ts` and `media-asset.ts` are named so to differ from the rule modules `coupon.ts` and `media.ts`.

## Decisions

**Ruled after review-0 (operator, 2026-11-27):** RS1-TYPE-ORACLE = A, bounded (the oracle of proof 1; this slice
only). RS1-DAG-SCOPE = A with the retarget of scope item 4 (runtime DAG required; no barrel import inside `src/`;
the remaining type-only cycles enumerated and accepted).

**RS1-ENUM-KEY-ORDER** (raised by iteration 1; the code work is complete; it blocks acceptance).

Problem: the bounded oracle accepts two kinds of difference — literal-union order and the symbol suffix — and forbids
sorting object members. 8 of the 17 differing lines are of a third kind: the key order of the object that
`z.enum([...])` builds (`ZodEnum<{ never: "never"; always: "always"; }>` where the single file emitted
`{ always: "always"; never: "never"; }`). Each key's type is the string of its own name, and the object is derived from
a literal union; tsc writes its keys in that union's order, which is the same artefact as the accepted union-order
class, one step removed. The order is in the emitted `.d.ts` text that consumers compile against. All four affected
types are mutually assignable before and after, and every workspace type-checks (proof 4). In iteration 0 I described
these lines as part of the union-order class; that description was not exact, and the bounded ruling now separates them.

| Option | Reward | Risk |
|---|---|---|
| **A — admit one more canonical operation, bounded to this shape (recommended):** sort the members of an object type only when EVERY member is `k: "k"` (the name's own string literal) — the zod enum key object; nothing else | the 8 lines are equal (shown by `diagnose-neither.mjs`); the rule cannot reorder a signature, a general object or a union of non-literals; assignability already holds | key order of such an object is visible in editor hovers and in the `.d.ts` text; no type-level meaning that this slice depends on (INFERRED from the assignability result and the green type-check of 8 workspaces, not from a proof over every consumer) |
| B — keep the bounded oracle as ruled; the slice is not accepted | the oracle stays exactly as ratified | the move cannot be accepted in this layout; matching the emitted order would need the checker to meet the literals in the old order — no move-only change is known to do that (not tried: changing build inputs such as `tsconfig` to chase a print order is outside the slice) |
| C — accept these 8 lines as named exceptions for this slice | smallest wording change | a list of exceptions instead of a rule; a later change to these four schemas would need the list edited |

## Migration / deployment notes

None. No data, route, permission or infrastructure changes. Rollback = revert the commit. The operator checks at
closeout that the Lambda and site bundles change only as rebuilt code (staging diff) and runs a staging smoke.

## Definition of Done

- Proof 1 met: runtime names identical line for line; the bounded canonical type lists equal; bidirectional
  assignability with its negative control (ruling RS1-TYPE-ORACLE = A). NOT MET today: 8 lines (`RS1-ENUM-KEY-ORDER`).
- Every old line accounted for (moved verbatim, kept, or listed as dropped); no new line besides headers and imports.
- Runtime graph acyclic; no file inside `src/` imports `./index.js`; the full graph's cycles exactly the enumerated list.
- Every workspace builds and type-checks with no edit outside the allowed paths.
- No serving capture changes (`test:serving`, `test:serving-bundle`).
- Docs updated; ROADMAP row and `CURRENT_SLICE.md` updated.

## Evidence required

The gates of § *Build record*, each exit status reported bare, and the proof outputs above.

## Exit criterion

Track B can change the order and customer schemas in one 185-line file; a slice that touches one domain no longer
edits the 3,082-line file every other slice edits.

## References

`docs/ROADMAP.md` § *Order of work from 2026-11-27*; `docs/slices/gallery-1.md` (the serving-row mechanism of a changed
`@amodx/shared` import); `packages/shared/ARCHITECTURE.md`; `docs/caching-architecture.md` § *Serving contract*.

## Build record

Builder `claude-opus-5-5`, 2026-11-27. Not committed. Order of the round as in the packet; progress notes in the slice
trail `build-progress.md`.

1. Baseline surface lists on the untouched tree (proof 1) — EXECUTED; file map computed by a dry run of the generator
   into a scratch directory, then written above.
2. Moves, leaf first, one domain file per step (`split.mjs 1` … `24`): after each step `npx tsc` (packages/shared)
   exit 0 and `npx vitest run` 33 files / 662 tests — EXECUTED, 24 of 24 steps green. Intermediate steps gave
   `index.ts` temporary imports of the moved files (it still held code that used them); the last step removed them and
   the own-use imports.
3. Surface after, graph, evaluation — EXECUTED (proofs 1-3).
4. Consumers — EXECUTED (proof 4).
5. Serving — EXECUTED (proof 5).
6. Docs, ROADMAP row, `CURRENT_SLICE.md` — done (§ *Docs corrected*).
7. Gates on the iteration-0 tree, in the packet's order (EXECUTED 2026-11-27; logs in the trail `gates/`; superseded by
   the iteration-1 gates below):

| Gate | Exit | Result |
|---|---:|---|
| `npm run build` | 0 | 8 workspaces |
| `npm run typecheck` | 0 | 8 workspaces |
| `cd packages/shared && npm test` | 0 | 33 files / 662 tests |
| `cd packages/plugins && npm test` | 0 | 14 / 388 |
| `cd renderer && npm test` | 0 | 66 / 964 |
| `cd renderer && npm run test:serving` | 0 | 176 / 176, no capture changed |
| `cd renderer && npm run test:serving-bundle` | 0 | 61 / 61 (own open-next build in the run) |
| `cd admin && npm run test:unit` | 0 | 32 / 489 |
| `npm --prefix backend run test:unit` | 0 | 92 files + 2 skipped / 2417 + 2 skipped |
| `cd infra && npm test` | 0 | 1 suite / 94 |
| `cd tools/mcp-server && npm test` | 0 | route coverage PASS + 23 / 23; `routes.json` not refreshed (no backend route changed) |
| `git diff --check` | 0 | clean; the 25 new files checked with `git diff --no-index --check /dev/null <file>` and for a final newline: 0 problems |

NOT RUN: `cd backend && npm test` (uses real staging DynamoDB; forbidden by the packet). The staging bundle diff and the
staging smoke are the operator's closeout checks.

Self-review (iteration 0): the change adds no abstraction; the files are a split of one file along its own sections;
`index.ts` uses `export *` (no export list to keep in step with the files).

### Iteration 1 (after review-0, 2026-11-27)

Review-0 findings and how each is closed:

| Finding | Class of defect | Correction |
|---|---|---|
| RS1-TYPE-ORACLE | oracle compared printer output | ruled A, bounded: `surface.mjs` now writes `type-surface-bounded.txt` with exactly the two ruled operations (no object or property sort; the text is kept as printed outside the sorted unions); `classify.mjs` classifies every differing line. Result: 8 lines in neither class → `RS1-ENUM-KEY-ORDER` |
| RS1-DAG-SCOPE | an exception taken without a ruling | ruled A: barrel imports retargeted (scope item 4); `graph.mjs` now requires a runtime DAG and 0 barrel imports, enumerates every elementary cycle of the full graph and fails on any cycle outside the list (or a listed one that is gone); negative control |
| F-RS1-DOC-RIPPLES | instructions treated as history | rule: an instruction about where a declaration goes is corrected; a line citation or recorded command is kept (§ *Docs corrected*, policy first); 6 plan references corrected |
| F-RS1-ORACLE-CLAIMS | conclusions wider than the experiments | the claims now name the experiments they rest on (proof 1, last paragraph); "object-member order has no meaning" removed — the ruling does not sort them, and option A of the new decision is bounded to one object shape |

Gates on the final tree, in the packet's order (EXECUTED 2026-11-27; logs in the trail `gates-i1/`):

| Gate | Exit | Result |
|---|---:|---|
| `npm run build` | 0 | 8 workspaces |
| `npm run typecheck` | 0 | 8 workspaces |
| `cd packages/shared && npm test` | 0 | 33 files / 662 tests |
| `cd packages/plugins && npm test` | 0 | 14 / 388 |
| `cd renderer && npm test` | 0 | 66 / 964 |
| `cd renderer && npm run test:serving` | 0 | 176 / 176, no capture changed |
| `cd renderer && npm run test:serving-bundle` | 0 | 61 / 61 (own open-next build in the run) |
| `cd admin && npm run test:unit` | 0 | 32 / 489 |
| `npm --prefix backend run test:unit` | 0 | 92 files + 2 skipped / 2417 + 2 skipped |
| `cd infra && npm test` | 0 | 1 suite / 94 |
| `cd tools/mcp-server && npm test` | 0 | route coverage PASS + 23 / 23; `routes.json` not refreshed (no route changed) |
| `git diff --check` | 0 | clean; new files checked with `git diff --no-index --check /dev/null <file>` and for a final newline: 0 problems |

NOT RUN: `cd backend && npm test` (forbidden by the packet). The surface lists of the gate build equal the measured
`i1/after` lists (EXECUTED).

Self-review (iteration 1): the only code change of this iteration is five import lines (scope item 4), required by
RS1-DAG-SCOPE; no other source file changed after iteration 0. Nothing was added to make the oracle pass: the bounded
canonical form is exactly the ruled one, and the 8 lines it does not accept are reported, not reclassified. Deferred:
F-RS1-TYPE-CYCLES, F-RS1-USERROLE-DOC, F-RS1-ENUM-KEY-ORDER (`docs/TECH-DEBT.md` § *refactor-shared-1 residuals*).

## Closeout 2026-11-27 — ON STAGING

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, two cycles. Review-1 found every finding closed and left one authority
decision; the operator ruled on it and closed out with no third cycle.

**Operator rulings.** RS1-TYPE-ORACLE = A, bounded (canonical equality over two difference classes plus bidirectional
assignability). RS1-DAG-SCOPE = A with the type-only barrel imports retargeted to the domain files (runtime graph a DAG;
14 enumerated type-only source cycles are debt). **RS1-ENUM-KEY-ORDER = C:** the eight remaining printed-type lines
(`FacetModesSchema`, `GlamImportProfileSchema`, `ProductSchema`, `FormFieldSchema`, `FormDefinitionSchema`,
`FormSubmissionSchema`, `ReviewImageSchema`, `ReviewSchema`) differ only in the printed order of an enum object's
members; they are accepted as these exact lines, for this slice only. Basis: the reviewer reproduced bidirectional
assignability (403 exports, 405 comparisons, zero failures, negative control fails as expected), identical runtime
names and serialized descriptions (245 exports), and byte-identical emitted JavaScript for every file but `index.js`.

Operator-executed on the final tree:

| Check | Result |
|---|---|
| Gate script (build, typecheck, shared, plugins, renderer, serving, serving-bundle, admin unit, backend unit, infra, MCP, `git diff --check`) | every exit 0; no path changed outside `packages/shared/src`, `packages/shared/ARCHITECTURE.md`, `docs/` and the root instruction files; no serving capture changed |
| Staging diff, read before the deploy | rebuilt code only (91 functions, the renderer and admin bundles); no resource added or removed; no permission change |
| Staging deploy | `AmodxStack-staging` success line present |
| Staging smoke, read-only: three test sites | home page and the first sitemap addresses render; `GET /settings`, `/content`, `/products`, `/categories`, `/leads`, `/forms`, `/coupons`, `/content?type=Redirect` answer 200; the admin opens Settings, Products, Leads, Forms and Redirects with no page error |

**Found by the smoke, not caused by this slice (F-PROJECTION-RESERVED).** `GET /orders` and `GET /reviews` answer 500 on
staging: DynamoDB refuses their `ProjectionExpression` ("Attribute name is a reserved keyword": `total` in
`backend/src/orders/list.ts`, `source` in `backend/src/reviews/list.ts`). The same query sent to the staging table with
the AWS CLI is refused the same way, so the cause is the expression, not the deployed code of this slice; both files are
unchanged by it. Fix slice: `projection-reserved-1`.

Module maturity: unchanged.
