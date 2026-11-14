# ADMIN-ENGLISH-2 — the admin's example placeholders are English (implementation record)

Status: IMPLEMENTED 2026-11-14 (builder, round 1 after review 0: ruling AE2-COMPANY-NAME = A, record only), uncommitted,
awaiting review. Start: `main` at `78527d5`, tree clean.
Track: admin (English admin interface). Depends: `admin-english-1` (§§ 1, 5 of `docs/slices/admin-english-1.md`).
Source plan: none — the builder packet of 2026-11-14 and the human ruling are the plan. Maturity: unchanged (text only).

Ratified by the human on 2026-11-14: "example placeholders become English now part of the admin-english we are doing
or immediately after".

## 1. Purpose, scope, non-scope

- **Risk retired.** Example placeholders and one description in the Settings, Delivery and product-editor pages showed
  Romanian examples (`București`, `/produs`, …). The admin interface is English (standing rule, `admin-english-1` § 1).
- **Scope.** A text replacement of placeholders, one description (two strings) and one fixed preview path, in
  `Settings.tsx`, `DeliverySettings.tsx`, `ProductEditor.tsx`. Every replaced text is in § 3.
- **Non-scope.** No `value`, default, state, validation, request field or stored value changes (packet rule 2). Nothing
  under `packages/`, `backend/`, `renderer/`, `infra/`, `tools/`. No translation mechanism. The captures under
  `admin/src/pages/__markup__/` are not re-taken (packet rule 3).
- **Architectural boundaries.** None crossed: texts change inside existing components. No new module, type, dependency
  or DynamoDB access.
- **Migration / deployment.** No data migration. Deploy admin only; rollback = revert the commit. Staging (operator):
  the deployed admin bundle holds the new placeholders and none of the old ones (packet § 5).

## 2. Decisions taken locally (one line each)

- **Sibling URL-prefix placeholders.** The URL Prefixes card had four more Romanian placeholders not in the packet table
  (`/categorie`, `/cos`, `/comanda`, `/magazin`). Packet rule 1 says to change such a sibling "the same way". Rule used:
  a URL-prefix placeholder shows the real default of its prefix (`URL_PREFIX_DEFAULTS`, `packages/shared/src/index.ts:91`)
  — the same principle that keeps `/lista-mea` (packet rule 1). So `/comanda` became `/checkout` (the default), not a
  literal translation (`/order`). The `Settings.test.ts` test "each placeholder is URL_PREFIX_DEFAULTS of its field"
  makes this rule executable: a placeholder that drifts from its default fails it.
- **Company Details card siblings — not changed (operator ruling AE2-COMPANY-NAME = A, § 7).** The other fields of
  the address card show legal-form and legal-identifier examples, not Romanian-language text: `SC Company Name SRL`
  (legal name), `RO12345678` (CUI/CIF), `J40/1234/2020` (trade register). They stay, unchanged (§ 5, "Stays").
  `+40 700 000 000` and `contact@company.ro` are phone and e-mail formats, not words; they stay too.
- **Delivery page siblings — not changed.** `Romania`, `Romania\nMoldova\nGermany` (country placeholders,
  `DeliverySettings.tsx:390, 424, 438`) are English country names, not Romanian text.
- **Wording.** All new texts are the packet's values; the four sibling values are `URL_PREFIX_DEFAULTS` values.

## 3. Old text → new text

Line numbers are the same at `78527d5` and in the candidate (every change is one line for one line). Each row is the
complete shown text of that attribute or element.

| # | File:line | Kind | Old text (`78527d5`) | New text (candidate) | Source |
|---|---|---|---|---|---|
| 1 | `admin/src/pages/Settings.tsx:1344` | placeholder (Company Details → Address) | `Str. Example nr. 1, București` | `1 Example Street, Example City` | packet table |
| 2 | `admin/src/pages/Settings.tsx:1582` | CardDescription (URL Prefixes, catalog) | `Configure URL paths for catalog pages. Must start with "/" (e.g. "/produs" or "/product").` | `Configure URL paths for catalog pages. Must start with "/" (e.g. "/product").` | packet table |
| 3 | `admin/src/pages/Settings.tsx:1583` | CardDescription (URL Prefixes, non-catalog) | `Configure URL paths for commerce pages. Must start with "/" (e.g. "/produs" or "/product").` | `Configure URL paths for commerce pages. Must start with "/" (e.g. "/product").` | packet table |
| 4 | `admin/src/pages/Settings.tsx:1592` | placeholder (URL Prefixes → Product) | `/produs` | `/product` | packet table |
| 5 | `admin/src/pages/Settings.tsx:1600` | placeholder (URL Prefixes → Category) | `/categorie` | `/category` | sibling (§ 2) |
| 6 | `admin/src/pages/Settings.tsx:1609` | placeholder (URL Prefixes → Cart, non-catalog) | `/cos` | `/cart` | sibling (§ 2) |
| 7 | `admin/src/pages/Settings.tsx:1619` | placeholder (URL Prefixes → Checkout, non-catalog) | `/comanda` | `/checkout` | sibling (§ 2) |
| 8 | `admin/src/pages/Settings.tsx:1628` | placeholder (URL Prefixes → Shop) | `/magazin` | `/shop` | sibling (§ 2) |
| 9 | `admin/src/pages/DeliverySettings.tsx:402` | placeholder (Allowed Counties / Regions) | `București` ⏎ `Ilfov` ⏎ `Prahova` | `Example County` ⏎ `Another County` | packet table |
| 10 | `admin/src/pages/DeliverySettings.tsx:450` | placeholder (Available Counties / Regions (Dropdown)) | `București` ⏎ `Ilfov` ⏎ `Prahova` | `Example County` ⏎ `Another County` | packet table |
| 11 | `admin/src/pages/ProductEditor.tsx:883` | Search Preview path (SEO tab) | `example.com/produs/{form.slug \|\| "product-slug"}` | `example.com/product/{form.slug \|\| "product-slug"}` | packet table |

Stays (packet rule 1): `admin/src/pages/Settings.tsx:1655` placeholder `/lista-mea` (Interest list, catalog only) — it is
the real default `URL_PREFIX_DEFAULTS.interest`. Finding F-AE2-2.

## 4. Capture handling (packet rule 3)

- `admin/src/pages/__markup__/settings.content.html` and `settings.commerce.html` are byte-identical to `78527d5`
  (`git diff --stat -- admin/src/pages/__markup__` is empty). They still hold the Romanian placeholders.
- `Settings.test.ts` no longer uses `toMatchFileSnapshot` for these two files: it reads each capture and compares with
  `toBe`. Side effect: `vitest -u` can no longer rewrite the captures, which matches rule 3 ("never regenerated").
- `ENGLISH_EXAMPLES` (7 rows: rows 1, 2-or-3, 4, 5, 6, 7, 8 of § 3) lists `[old, new, count]` as they appear in the
  HTML (`placeholder="…"`, quotes escaped as `&quot;`). `capture(name)` replaces each old text by its new text in the
  capture and first asserts that it occurs exactly `count` times (1 in each capture). Each capture holds one of the two
  descriptions (both captures are non-catalog: row 3). The commerce fixture's input VALUE `/produs`
  (`COMMERCE.urlPrefixes.product`, tenant data) is a `value="…"` attribute and is not matched.
- Why not the existing exclusion mechanism: `withoutCatTheme` removes whole rendered component groups from the
  *render*; it cannot replace a text inside a capture, so it does not fit.
- Control (new test): for each capture and each of the 7 replacements, the comparison with that one replacement
  removed fails.
- The existing controls ("any other mutation … still fails") now compare against the replaced capture; comparing
  against the raw capture would let them pass for the wrong reason.

Test helper one-liner: `capture(name, replacements)` + `ENGLISH_EXAMPLES` — users: the two capture comparisons, the
removal control and the existing mutation controls (4 tests); axis: none beyond this slice's fixed list (data, not a
dispatch); rejected alternative: re-taking the captures (forbidden by rule 3) or replacing in the render instead of the
capture (the packet asks for the capture side).

## 5. Findings and Romanian text not edited

- **F-AE2-1** — `ProductEditor.tsx:883` shows a fixed example path `example.com/product/…`, not the tenant's real
  product prefix (`urlPrefixes.product`) or domain. Making it follow the tenant is a behaviour change; not built.
- **F-AE2-2** — `Settings.tsx:1655` placeholder `/lista-mea` is the real default `URL_PREFIX_DEFAULTS.interest`
  (`packages/shared/src/index.ts:99`, OBSERVED). The default is
  a Romanian slug used for every catalog tenant; it is tenant data and belongs to `catalog-data-labels-1`. When that
  default changes, the placeholder test of § 2 fails until the placeholder follows — intended.

Other Romanian or Romanian-format shown text in `admin/src` (listed, NOT edited). Basis (EXECUTED): `grep -rnE
'[ăâîșțĂÂÎȘȚşţ„”]'` and a word grep (`produs|categorie|magazin|comanda|cos|lista|adresa|imagine|pentru|livrare|judet|oras|strada|str|nr|Bucuresti|Ilfov|Prahova|Romania|SRL|…`)
over `admin/src/**/*.{ts,tsx}` without tests, plus a grep of placeholders for `RO<digit>`, `.ro`, `+40`, `07xx`. A grep
is a subset claim: a Romanian word outside these patterns is missed.

**Stays — ruling AE2-COMPANY-NAME = A (operator, 2026-11-14).** Reason: legal-form and legal-identifier examples are
format examples of a legal identity, not Romanian-language text. The operator reports them to the human as a named
residual.

| File:line | Text | Card |
|---|---|---|
| `Settings.tsx:1311` | placeholder `SC Company Name SRL` | Company Details → Legal Name |
| `Settings.tsx:1319` | placeholder `RO12345678` | Company Details → CUI / CIF |
| `Settings.tsx:1327` | placeholder `J40/1234/2020` | Company Details → Trade Register |
| `Settings.tsx:1246` | placeholder `SC Company SRL` | Bank Transfer Details → Account Holder |

Other text listed, not edited:

| File:line | Text | Assessment |
|---|---|---|
| `Settings.tsx:1261` | placeholder `RO49AAAA1B31007593840000` (IBAN, Bank Transfer Details) | Bank-account format example; not words. Same reasoning as the ruling. |
| `Settings.tsx:1335, 1352` | `+40 700 000 000`, `contact@company.ro` (Company Details) | Phone and e-mail formats; not words (§ 2). |
| `Settings.tsx:262, 266, 1033, 1041` | phone / WhatsApp placeholders `+40 …`, `0762 271 715` | Phone formats; not words. |
| `Settings.tsx:1421` | placeholder `https://anpc.ro/...` | Romanian authority URL (legal link example); not words. |
| `Labels.tsx:778` | placeholder `e.g. RO12345678` | VAT format; not words. |
| `DeliverySettings.tsx:390, 424, 438` | `Romania`, `Romania` ⏎ `Moldova` ⏎ `Germany` | English country names. |
| `DeliverySettings.tsx:453` | `Leave empty to use Romanian counties as default.` | English; describes current behaviour. |
| `GlamPricelistImport.tsx:110, 703` | `Variantă`; placeholder `Variantă, Culoare, Format…` | Kept by `admin-english-1` rule 2 (§ 2 there). |
| `GlamProfileEditor.tsx:334` | `COLUMN_ATTRIBUTE_KEYS` (`colecție`, …) | Data keys (`admin-english-1` § 5). |
| `lib/csv-headers.ts` | WooCommerce header map | Data recognition (`admin-english-1` § 5). |
| `FormSubmissions.tsx:117` | comment naming `Listă de interes` | Comment; data name. |

## 6. Tests changed

`admin/src/pages/Settings.test.ts` only (no test pins a text of `DeliverySettings.tsx` or `ProductEditor.tsx`: there
is no DeliverySettings test, and `ProductEditor.test.ts` holds neither `/produs` nor `example.com`, OBSERVED by grep).

- The two capture comparisons: `toMatchFileSnapshot(file)` → `toBe(capture(name))` (§ 4); describe title extended
  with ", with the ADMIN-ENGLISH-2 example texts".
- New control: "with any one ADMIN-ENGLISH-2 replacement removed, the comparison fails".
- Existing controls: the local `capture` closure replaced by the module `capture` (replacements applied); the
  `mutations` tuple types its name as `"content" | "commerce"`.
- `URL Prefixes copy on a catalog …`: the pinned description is the new text (`(e.g. &quot;/product&quot;)`).
- New test: "URL Prefixes: each placeholder is URL_PREFIX_DEFAULTS of its field" (content and commerce: 7 fields;
  catalog: 5 fields).

No test was deleted, skipped or weakened.

## 7. Ruling (round 1)

Review 0 carried one open decision, AE2-COMPANY-NAME: do the legal-name placeholders `SC Company Name SRL` (Company
Details) and `SC Company SRL` (Bank Transfer) count as Romanian text under packet rule 1? Operator ruling 2026-11-14:
**A — keep.** Legal-form and legal-identifier examples (the legal name, the registration and tax number examples next to
it, the Bank Transfer placeholder) are format examples of a legal identity, not Romanian-language text. They stay,
unchanged, and are listed in § 5 "Stays". No open decision remains in this slice.

## 8. Evidence

All EXECUTED 2026-11-14 on the candidate tree in round 0 (fresh `npm run build` first). Round 1 changed only this
record, no source byte (ruling: "No source change in this round"), so the round-0 gates stand for the unchanged source.
Basis: the round-1 run edited no file other than this record; `git diff --stat` of the four admin files is the same
as in round 0 (`4 files changed, 66 insertions(+), 19 deletions(-)`, EXECUTED in both rounds); the source diff
`git diff -- admin/src | shasum` is `168937445b61a7e07b59c6b1006a3c6246c2be7c` at the start and end of round 1
(EXECUTED; no round-0 hash was recorded, so equality with round 0 is INFERRED from the identical stat and the absence
of source edits). Round 1 re-ran the admin unit suite and the slice oracles as a check (rows marked "round 1").

| Check | Result |
|---|---|
| `npm --prefix "<repo>" run build` | exit 0 |
| `npm --prefix "<repo>" run typecheck` | exit 0 |
| `npm --prefix "<repo>/packages/shared" test` | exit 0, 285/285 |
| `npm --prefix "<repo>/packages/plugins" test` | exit 0, 204/204 |
| `npm --prefix "<repo>/renderer" test` | exit 0, 398/398 |
| `npm --prefix "<repo>/renderer" run test:serving` | exit 0, 104 pass, 0 fail |
| `npm --prefix "<repo>/admin" run test:unit` | exit 0, 12 files, 243/243 |
| `npm --prefix "<repo>/backend" run test:unit` | exit 0, 1266 pass, 1 skipped (`cat-import-profile-1-golden.capture.test.ts`, an env-gated capture test; not touched) |
| `npm --prefix "<repo>/tools/mcp-server" test` | exit 0, 13 pass |
| `git diff --check` | exit 0 |
| `git status --porcelain -uall` | the four allocated admin files + this record |
| `git diff --stat -- admin/src/pages/__markup__ packages backend renderer infra tools` | empty |
| `grep -nE "București\|Ilfov\|Prahova\|/produs" admin/src/pages/{Settings,DeliverySettings,ProductEditor}.tsx` | prints nothing (exit 1) |
| `grep -c "lista-mea" admin/src/pages/Settings.tsx` | `1` |
| Mutation: `placeholder="/shop"` → `"/magazin"` in `Settings.tsx`, run `Settings.test.ts`, restore (sha1 identical) | 5 tests fail (both comparisons, both controls, the default-placeholder test); restored file passes 40/40 |
| round 1: `npm --prefix "<repo>/admin" run test:unit` | exit 0, 12 files, 243/243 |
| round 1: `git diff --check`; `git status --porcelain -uall`; `git diff --stat -- admin/src/pages/__markup__ packages backend renderer infra tools` | exit 0; the four admin files + this record; empty |
| round 1: the `grep -nE …` and `grep -c "lista-mea" …` oracles above | prints nothing (exit 1); `1` |
| round 1: `sed -n` of `Settings.tsx` lines 1246, 1261, 1311, 1319, 1327, 1335, 1352 | the § 5 "Stays" and listed texts at the cited lines |

NOT RUN: `cd backend && npm test` (forbidden by the packet; real DynamoDB). Staging admin deploy (operator, packet § 5).
No end-to-end browser check: the admin has no e2e suite for these pages; the server render in `Settings.test.ts`
covers the Settings texts; the Delivery and product-editor texts have no rendering test (gap; a placeholder change
does not warrant a new suite).

## 9. Definition of done, exit criterion, references

- **Done when:** § 3 texts in place; captures byte-identical; § 8 checks pass; reviewer accepts. (AE2-COMPANY-NAME was
  ruled A in round 1: § 7.)
- **Exit criterion:** the admin's example texts in these three pages are English; the next text work is the
  language-pack slice `catalog-data-labels-1` (F-AE2-2).
- **References:** `docs/slices/admin-english-1.md` §§ 1, 5; `docs/slices/locale-1.md` § 10 (common gates);
  `packages/shared/src/index.ts` `URL_PREFIX_DEFAULTS`.

## 10. Operator closeout (2026-11-14)

- **Review.** Two rounds (builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`): escalate on AE2-COMPANY-NAME → operator
  ruling A (legal-form and legal-identifier examples stay) → approved. No source finding.
- **Operator gates (EXECUTED on the approved tree).** The ten common gates each exit 0. Five paths changed, all
  allocated; `__markup__`, `packages`, `backend`, `renderer`, `infra`, `tools` and dependency files unchanged. The
  Romanian-placeholder grep prints nothing; `lista-mea` occurs once in `Settings.tsx`.
- **Staging (EXECUTED).** `cdk diff -c stage=staging`: the admin bundle and the renderer rebuild only; no API Lambda,
  no IAM change. The diff and the deploy ran in one command, so the diff was read after the deploy, not before
  (process deviation; the diff held nothing unexpected). The deployed admin bundle contains "1 Example Street, Example
  City", "Another County", "example.com/product/", and still "/lista-mea" and "SC Company Name SRL"; it does not contain
  "Str. Example nr. 1", "example.com/produs/", "/comanda".
- **Two strings the operator's probe expected absent are present, from shared data, not from this slice's files:**
  "Prahova" is the Romanian country pack's county list (`packages/shared/src/country-packs/ro.ts:46`, data);
  "/magazin" is the shop-path fallback of `packages/shared/src/catalog-listing.ts:73` (`prefixes.shop || "/magazin"`).
- **F-AE2-3 (operator).** That `/magazin` fallback is a Romanian data default in shared code, like `/lista-mea`
  (F-AE2-2). Both go to the design of `catalog-data-labels-1`.
