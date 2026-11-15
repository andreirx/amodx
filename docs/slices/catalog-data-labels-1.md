# CATALOG-DATA-LABELS-1 — the catalog's fixed data words come from the tenant's language pack

Status: **RATIFIED 2026-11-15** — design (SPEC). No code change. The human ruled every open choice on 2026-11-15
(§ 1.2, § 9). Implementation runs in two slices, `cdl-1` and `cdl-2` (§ 10).
Revisions: revisions 0-2 (2026-11-14/15) answered reviews 0-1; review-2 approved. Revision 3 (2026-11-15) rewrites the
design to the human's ruling of 2026-11-15. It removes the preservation machinery of revisions 1-2 (check P1, the
reader-first ordering, the per-tenant path gates): only a test tenant is live. Revision 4 (2026-11-15) answers review-3:
the planner receives the default option name as data (§ 4.4, § 4.5); the golden oracle gets an allowed-delta contract
(§ 4.10).
Track: catalog (backend import, interest list, shared language packs, admin import screens; renderer for the paths
of § 7).
Depends: LOCALE-1 (`docs/slices/locale-1.md`): the per-tenant locale table, the language packs and
`resolveLocaleStrings`. This design adds keys to its catalog part and calls its resolver unchanged.
Maturity target: the new pack keys, `catalogServerTexts` and the `importLabels` marker start **PROTOTYPE** in
`cdl-1`; they become **MATURE** when `cdl-1` has run on staging with both label choices (§ 8.4).
Basis: `main` at `fd39faa`. Every file:line in this document was read at that commit (§ 11, E1, E18).

## 1. Purpose

### 1.1 The human direction (2026-11-14), quoted

> "the attribute names written to products as well as the others that "stay Romanian" SHOULD be part of the catalog
> and or commerce language pack"

> "1 option a, each site admin is responsible to put the csv or xls in the appropriate language for their site.
> 2 woocommerce column names stay as they are."

"Option a": the importer takes the fixed words AT IMPORT TIME and writes them into the product. The word stays the
identity of the attribute. The VALUES come from the file. Products that exist keep the old word until the next import
of their list. The admin UI stays English. The WooCommerce header maps stay as they are.

### 1.2 The human ruling (2026-11-15), quoted

> "I don't understand all this discussion on details - think from an usability perspective and don't care about
> breaking what is now live - only a test tenant is live. we put labels in admin. warn if importing different labels
> from xls/csv or present the option at import level which labels to keep. recommend from this perspective."

The operator recommended six points (§ 9). The human answered: "GO. yes on point 5." Consequences for this design:

- Prod has only a test tenant. Staging evidence is enough. There is no pre-deploy check of prod data and no
  protection of live URLs or stored texts.
- The labels live in the admin (Labels page). At import, the preview offers a choice between the site labels and
  the file's labels (§ 4.3).

### 1.3 Risk retired

Today the glam importer writes four Romanian attribute names and one Romanian variant name into every product, on
every catalog tenant, whatever the tenant's language (`backend/src/import/glam/profile.ts:27-32`,
`backend/src/import/glam/map.ts:31`). A visitor sees these words: the product page prints every attribute key as a row
label (`renderer/src/components/SitePage.tsx:985`); the variant group name is the legend of the option picker
(`SitePage.tsx:922`) and can be a facet heading (`packages/shared/src/facets.ts:54-66`). Staging shows the defect:
the English test tenant `cm1-catalog` holds `colecție` on 458 of its 460 products (§ 11, E8). The interest route
stores and mails Romanian texts for every tenant (`backend/src/interest/public.ts:61`, `:67-73`, `:284-296`,
`:303`). Shared code holds Romanian path fallbacks (`/magazin`, `/produs`, `/lista-mea`).

After the track: the owner sees and edits the import labels on the Labels page; each import uses the site labels or
the file's labels, by the owner's choice; the interest mail is in the site language; every path default is English.

### 1.4 Non-scope

The admin UI language. The WooCommerce header maps. The stock Excel import and the commerce look-alike site (parked by
the human). Translation of stored values. Migration of stored products (old words stay until re-import). Other slice
docs and the ROADMAP.

### 1.5 Architectural boundaries

- Tenant isolation: every new read is a `GetCommand` on the request tenant's own item, or reads the tenant's own
  products in the reads the import already makes. No cross-tenant read.
- No DynamoDB scan: no new query. The dry run's existing product query (`backend/src/import/glam-pricelist.ts:197`)
  gives the facts of § 5.3.
- Core stays pure: the parser returns the header labels as data; `planGlamImport` receives the chosen labels and the
  site's default option name as data, and `checkProfile` the chosen labels (§ 4.4, § 4.5). Two tenants that need
  different outputs always give the planner different inputs.
- Shared-first: the new pack keys and the product field `importLabels` go to `packages/shared/src/index.ts` first.
- Data across boundaries is raw: the dry run gains one plain member `labels` (§ 4.8); the request gains one string
  member `labels` (§ 4.3).

## 2. Inventory

### 2.1 Method and completeness basis

Four deterministic text searches over the source trees, at `fd39faa` (§ 11, E3, E4, E5):

1. Every line with a Romanian letter or a Romanian opening quote (`[ăâîșțĂÂÎȘȚşţ„]`) in `backend/src`,
   `packages/shared/src`, `packages/plugins/src`, `renderer/src`, `tools/mcp-server/src`, `infra/lib`, without tests,
   `MAP.md` files and the two Romanian pack files. 15 files; every line read.
2. Every line with a whole Romanian word without diacritics (`Nume`, `Telefon`, `Mesaj`, `Produse`, `Trimis`,
   `magazin`, `comanda`, `confirmare`, `cos`, `produs`, `categorie`, `lista`) in the same trees.
3. Every backend file that sends mail (`SendEmailCommand` or `sendEmail(`): 7 files, each read for the texts it
   writes.
4. Path fallbacks: every `|| "/<letters>"` and `?? "/<letters>"` in `renderer/src`, `packages`, `backend/src`,
   `admin/src`, `tools/mcp-server/src`.

The readers of a stored attribute key by name were found by a search for `attributes` over the same trees plus
`admin/src` (§ 11, E6), every hit read.

Basis of the completeness claim: a text search is a subset claim, not a compiler query. It finds a Romanian word only
if it has a diacritic or is in the word list. A word without both (for example a new Romanian slug) would be missed.
The class "stored data word" is closed by the code paths that write products, forms and submissions for a catalog
tenant: the glam importer (`glam-pricelist.ts:601`, `:604`), the WooCommerce importer (excluded by ruling), the admin
product editor (the owner types the words) and the interest route (`interest/public.ts:246`, `:265`). Each was read
in full.

### 2.2 The table

Class: **A** attribute key (stored, identity), **V** default value (stored, display default; not an identity, § 3.2),
**F** form data (stored), **M** mail text, **P** path default, **R** report word (API answer only, not stored),
**C** comment or type-level tag.

| # | File:line | Text | Class | Where a person sees it | Scope (ruled) |
|---|---|---|---|---|---|
| 1 | `backend/src/import/glam/profile.ts:28` | `colecție` | A | Product page row label (`SitePage.tsx:985`); facet heading and filter URL `a.colecție` (`facets.ts:27-33`); the interest list page collection line (`interest/public.ts:166` → `renderer/src/components/InterestShortlist.tsx:361`) | In: Labels key, or the file's header (§ 4) |
| 2 | `profile.ts:29` | `unitate` | A | Product page row label; facet | In, as row 1 |
| 3 | `profile.ts:30` | `împachetare` | A | Product page row label; facet | In, as row 1 |
| 4 | `profile.ts:31` | `comandă minimă` | A | Product page row label; facet | In, as row 1 |
| 5 | `backend/src/import/glam/map.ts:31` (used `:51`) | `Variantă` | V | Option picker legend (`SitePage.tsx:922`); variant facet heading when all products share the name (`facets.ts:58-59`) | In: Labels key (§ 4.5) |
| 6 | `admin/src/components/GlamProfileEditor.tsx:334` (used `:336`, `:431`, `:571`, `:749`) | the four words of rows 1-4 | A (second copy) | Admin "Column filters" row (`:747-754`); collection hint (`:563-579`); mode pruning (`:430-432`) | In: removed; the dry run gives the labels (§ 4.7) |
| 7 | `admin/src/components/GlamPricelistImport.tsx:110` | initial `variantName: "Variantă"` | V (second copy) | The admin form sends it (`:537`); so the backend default of row 5 never applies to an admin import | In: initial value empty (§ 4.5) |
| 8 | `GlamPricelistImport.tsx:703` | placeholder `Variantă, Culoare, Format…` | admin example | Admin form | In: English placeholder |
| 9 | `tools/mcp-server/src/index.ts:1147`, `tools/mcp-server/src/tool-shapes.ts:52` | "(default: 'Variantă')" | description of row 5 | MCP tool description; a comment | In: text follows row 5 |
| 10 | `backend/src/interest/public.ts:59` (used `:166`) | `colecție` | A (reader) | The interest list page collection line | In: the reader uses the stored marker (§ 6.1) |
| 11 | `interest/public.ts:61` (used `:246`, `:265`, `:303`) | `Listă de interes` | F, M | Stored form `name` (`:246`) and submission `formName` (`:265`): shown nowhere — the forms list omits the system form (`backend/src/forms/list.ts:30-32`), the submissions heading prints "Interest lists" for this form id (`admin/src/pages/FormSubmissions.tsx:119`; `:117` is a comment), and no admin or MCP code reads `formName` (E7). Mail subject (`:303`): the owner's mailbox | In: stored name an English constant; mail subject in the site language (§ 6) |
| 12 | `interest/public.ts:68-72` | field labels `Nume`, `E-mail`, `Telefon`, `Mesaj`, `Produse` | F | Admin submissions table headers (`FormSubmissions.tsx:140`). Data is keyed by field id (`:174`), not by label | In: fixed English headers in the admin; stored labels English constants (§ 6.2) |
| 13 | `interest/public.ts:285-295` | mail body lines (`Listă de interes nouă de la {name}`, `Nume:`, `E-mail:`, `Telefon:`, `Mesaj:`, `Produse ({n}):`, `Trimisă: {date}`) | M | The owner's mailbox | In: site language (§ 6.3) |
| 14 | `packages/shared/src/index.ts:99` | `URL_PREFIX_DEFAULTS.interest = "/lista-mea"` | P | The interest list URL of every catalog tenant without a stored value; stored at creation by `backend/src/tenant/create.ts:54`, `:152` | In: becomes `/my-list` (§ 7.2) |
| 15 | `admin/src/pages/Settings.tsx:1655` | placeholder `/lista-mea` | P (admin copy) | Admin Settings | In: follows row 14 |
| 16 | `packages/shared/src/catalog-listing.ts:73`; `SitePage.tsx:1044`, `:1426`, `:1451` | `prefixes.shop \|\| "/magazin"` | P | Breadcrumb and shop links of product, category and shop pages | In: removed (§ 7.1) |
| 17 | `SitePage.tsx:1403`, `:1460` | `prefixes.product \|\| "/produs"` | P | Product card links on category and shop pages | In: removed (§ 7.1) |
| 18 | `SitePage.tsx:482`, `:1581`, `:1670`, `:1699` | `prefixes.shop \|\| "/magazin"` | P | Cart, confirmation and tracking pages (commerce only) | Unreachable after § 7.1; code not edited (commerce branches, § 8.5) |
| 19 | `SitePage.tsx:481`, `:503`, `:504` | `"/comanda"`, `"/cos"` fallbacks | P | Commerce pages only | As row 18 |
| 20 | `SitePage.tsx:218`, `:221`, `:503` | fixed segment `/confirmare` | P (fixed, not a fallback) | Checkout confirmation URL of every commerce tenant | Excluded: commerce routing, not a default. Finding F-CDL-CONFIRMARE (§ 12) |
| 21 | `backend/src/import/glam/map.ts:208` (used `:332`) | `specificații tehnice` | R | Only in `products[].differing` of the import answer (`glam-pricelist.ts:732`). No admin or MCP code reads `differing` (E7); the MCP summary prints counts, previous set and skipped rows only (`tool-shapes.ts:89-95`) | Excluded: not stored, not shown |
| 22 | `backend/src/import/glam/group.ts:94`, `:181`, `:185` | skip tag `column: "colecție" \| "produs"` | R, C | Only in `rows[]` of the import answer. The admin shows the skip `reason` only (`GlamPricelistImport.tsx:53-57`, `:917`); the MCP summary prints `index` and `reason` only (`tool-shapes.ts:94`) | Excluded: it names a FILE column, as the WooCommerce header maps do |
| 23 | `backend/src/import/glam/parse.ts:27-41` | column comments | C | Nobody | Excluded |
| 24 | `backend/src/import/glam/profile.ts:351` | `MONEY_WORDS` (`preț`, `prețuri`, `pret`, `lei`, …) | recognition list | Nobody; the NO-PRICES value guard matches file values against it | Excluded: input recognition for a safety guard, not a written word |
| 25 | `backend/src/import/woocommerce.ts` (21 lines) | Romanian WooCommerce headers | header map | Nobody | Excluded by ruling |
| 26 | `backend/src/contact/send.ts:84-86`, `backend/src/forms/public-submit.ts:147-149` | English mail texts ("New Contact", "New form submission") | M | The owner's mailbox, every tenant | Excluded: English, not "stay Romanian" words; same class as the server texts LOCALE-1 § 1.3 left to follow-ups |
| 27 | `backend/src/orders/*`, `backend/src/webhooks/paddle.ts`, `backend/src/users/invite.ts` | order, payment and invitation mails | M | Commerce customers; admin users | Excluded: commerce (freeze) or admin (English) |
| 28 | `packages/shared/src/index.ts:2111`, `facets.ts:27`, `interest/public.ts:38`, `profile.ts:25`, renderer comments | the word in a comment | C | Nobody | Comments follow the code in the impl slice |

## 3. The words

### 3.1 Keys

All new keys go to the **catalog** part (`CatalogStringsSchema`, `packages/shared/src/index.ts:899`; stored override
attribute `catalogStrings`): only catalog tenants write or render them (LOCALE-1 § 2.1 assignment rule).

| Key | Romanian (`ro.ts`) | English (`en.ts`) | New or reused | Used for |
|---|---|---|---|---|
| `importCollectionAttribute` | `colecție` | `Collection` | new | Site label of file column 0 (rows 1, 6, 10) |
| `importUnitAttribute` | `unitate` | `Unit` | new | Site label of column 6 (rows 2, 6) |
| `importPackagingAttribute` | `împachetare` | `Packaging` | new | Site label of column 7 (rows 3, 6) |
| `importMinimumOrderAttribute` | `comandă minimă` | `Minimum order` | new | Site label of column 8 (rows 4, 6) |
| `importVariantName` | `Variantă` | `Option` | new | Default option name when the request gives none (rows 5, 7, 9) |
| `interestMailSubject` | `Listă de interes — {name}` | `Interest list — {name}` | new | Mail subject (row 11) |
| `interestMailIntro` | `Listă de interes nouă de la {name}` | `New interest list from {name}` | new | First mail line (row 13) |
| `interestMailProducts` | `Produse ({n}):` | `Products ({n}):` | new | Mail product-list heading (row 13) |
| `interestMailSentAt` | `Trimisă: {date}` | `Sent: {date}` | new | Last mail line; `{date}` stays the ISO time of today (row 13) |
| `interestName` | `Nume` (`ro.ts:228`) | `Name` (`en.ts:237`) | reused | Mail line label |
| `interestEmail` | `E-mail` (`ro.ts:229`) | `E-mail` (`en.ts:238`) | reused | Mail line label |
| `interestPhone` | `Telefon` (`ro.ts:230`) | `Phone` (`en.ts:239`) | reused | Mail line label |
| `interestMessage` | `Mesaj` (`ro.ts:231`) | `Message` (`en.ts:240`) | reused | Mail line label |

The Romanian values equal today's literals, so a Romanian site writes the same words as before. The English values
are ruled (§ 9 item 6). A mail line stays `{label}: {value}`; an empty value prints `—`.

### 3.2 Reuse rule

A key is reused only when its meaning is the same AND the text is not stored as product data.

- **The four column labels are attribute identities.** The attribute key is the facet id and the filter URL key
  (`a.<key>`, `facets.ts:27-33`), the key of saved attribute filter modes (`FacetModesSchema`, `index.ts:1364`), and
  the key the interest reader finds (§ 6.1). So: new keys. `interestCollection` (`Colecția`, `ro.ts:236`) is the
  visitor caption before the collection name, not the stored key.
- **The default option name is a stored display default, not an identity.** The variant facet has the fixed id
  `varianta` (`facets.ts:26`); its values are the option values of every group, whatever the group name
  (`facets.ts:168-173`). The saved variant mode is `variant: "never"`, keyed by no name (`facets.ts:211`). The group
  name is shown only: as the option picker legend (`SitePage.tsx:922`) and as the variant facet heading when every
  product with options shares one name (`facets.ts:229-235`). It has its own key because it is written into each
  product, while `facetVariantDefault` (`ro.ts:246`, `en.ts:255`) is a render-time visitor heading; one shared key
  would let a heading edit change what future imports store.
- **The four contact-field captions are reused for the mail.** Same meaning in the visitor form and the mail; not
  product data.

### 3.3 Resolution, overrides and missing keys

- Resolution: `resolveLocaleStrings({ locale, catalogStrings })` (`packages/shared/src/locale-strings.ts:180-197`),
  unchanged. Layers per key: the EN pack, then the pack of the tenant's language, then the tenant's own string in
  `catalogStrings`. It never throws. The backend can call it unchanged: the backend workspace imports `@amodx/shared`
  (`backend/src/tenant/settings.ts:10` imports from the same module), and a probe from `backend/` resolves `ro-RO`,
  `ro_RO`, an absent locale and `de-DE` correctly (E9).
- Override: the owner edits a key on the Labels page (§ 4.9). It takes effect at the next import (labels) or the next
  submission (mail). A stored product is never rewritten.
- Empty override: the resolver returns a stored `""` as `""` (E9). A written text must never be empty (an empty
  attribute key is dropped by the product page, `SitePage.tsx:970`, and by the facets). Rule for every text the
  backend writes or mails: `strings[key].trim()`, else `defaults[key]` (LOCALE-1 pattern F).
- A pack lacks a key: the resolver gives the English value (the EN pack is complete by type,
  `packages/shared/src/language-packs/types.ts:24-29`). The RO pack test requires every key in `ro.ts`.
- `PUT /settings` limits on `catalogStrings` stay as they are (`backend/src/tenant/settings.ts:57-60`).

### 3.4 Label check

Two column labels that are equal after `norm` (`backend/src/import/glam/group.ts:30-32`) would put two file columns
under one key. The product page would merge them into one row, and no later import could separate them. Rule: the
import refuses (400, nothing written; the dry run shows the refusal) when two of the four CHOSEN labels are equal after
`norm`. Message (English): "The labels for <a> and <b> are the same. Change one in Labels, or in the file." With the
packs this cannot happen; an override or a file header can cause it.

### 3.5 Abstractions introduced (one line each)

- `catalogServerTexts(resolved: ResolvedLocaleStrings)` in `packages/shared/src/locale-strings.ts`: the catalog texts
  the backend writes or mails, each non-empty by § 3.3. Two groups: `siteLabels: { collection, unit, packaging,
  minimumOrder }` with `variantName`, and `interestMail: { subject, intro, products, sentAt, name, email, phone,
  message }`. Users: the import handler (`glam-pricelist.ts`) and the interest route (`interest/public.ts`) — two
  current callers. Axis: the tenant's language and overrides (data, not dispatch). Precedent: `blockStrings`
  (`locale-strings.ts:239-246`). Rejected: the selection written inline in each caller (two copies of the
  non-empty rule).
- Product field `importLabels: { collection, unit, packaging, minimumOrder }` (stored marker, § 4.6). Users: the
  interest reader (§ 6.1) and the dry run's other-lists report (§ 5.3) — two current readers. Axis: the label set
  per list (site or file, ruled choice 2). Rejected: the reader accepts the site label and every pack's word — it
  misses every file label (the fixture header `colectie` is in no pack, E12), so it does not work with choice 2.
- Dry-run member `labels: { site, file, used }` (a DTO across the admin ↔ API boundary). Users: the admin preview
  (the side-by-side choice) and the profile editor (`pruneModes`, `collectionHint`, the "Column filters" row read
  `labels[used]`). Axis: per-tenant site labels and per-file header labels. Rejected: the admin resolves the site
  labels again from `GET /settings` (a second resolution site) and parses the header itself (a second parser).
- `urlPrefixesOf(stored)` in `packages/shared/src/index.ts` (§ 7.1). Users: the three readers that fall back on the
  WHOLE object today (`stored || URL_PREFIX_DEFAULTS`): `renderer/src/lib/dynamo.ts:180` (`mapTenant`),
  `admin/src/components/glamPreview.ts:56` (`siteContextOf`), `backend/src/lib/slug-guard.ts:20`. Readers that
  already apply the per-key rule inline stay as they are: `backend/src/lib/revalidate-paths.ts:83`,
  `backend/src/interest/public.ts:282`, `renderer/src/app/[siteId]/layout.tsx:154`, `:245`, `:266`, `:275`,
  `SitePage.tsx:237`, `:353-354`, `:1174`. Axis: stored prefix objects that are partial or hold `""`. Rejected: the
  13 per-site literals of rows 16-19 (they already disagree: `/produs` at `SitePage.tsx:1403`, `/product` at `:1413`).

No new module, file, registry or configuration layer.

## 4. Import behaviour

### 4.1 The site labels

The handler reads the tenant's `locale` and `catalogStrings`: one `GetCommand` on `PK: "SYSTEM"`,
`SK: "TENANT#<id>"`, `ConsistentRead: true`, projection `#l, catalogStrings`, right after the mode read
(`glam-pricelist.ts:178-182`), for the dry run and the execution. `readTenantMode`
(`backend/src/lib/catalog-product.ts:20-29`) is not changed. `catalogServerTexts(resolveLocaleStrings(...))` gives
the site labels and the default option name.

### 4.2 The file's labels

The parser already reads the header record: its cell count selects the 12- or 13-column layout
(`backend/src/import/glam/parse.ts:93-94`; a leading BOM is dropped, `:181`). It now also returns the header cells of
the four label columns (indexes 0, 6, 7, 8, the `COLUMN` table, `parse.ts:26-36`) as a new member of the parsed result
(`GlamParseResult`, `parse.ts:68-79`): `headerLabels: { collection, unit, packaging, minimumOrder }`, each in display
form (trimmed, inner whitespace collapsed, as `displayForm`, `map.ts:58-60`). The parser stays the only place that
reads cells by index.

The file label set is built per column: the header cell, or the site label of that column when the cell is empty
(smallest rule: an empty cell never becomes an empty key, and the owner still gets a usable label). Staging fixtures:
every file has the four cells `colectie`, `unitate de masura`, `unitate de impachetare`, `comanda minima` (E12).

### 4.3 The choice

- Request member `labels`: `"site"` or `"file"`. Absent = `"site"`. Any other value → 400 before any read. The
  handler builds the chosen set: the site labels, or the file label set of § 4.2. The label check of § 3.4 runs on
  the chosen set.
- The dry run answers `labels: { site, file, used }` (§ 4.8): both sets, whatever the choice.
- Admin preview: the two sets side by side, each with its four labels:
  - "Use the site labels" (default, selected first);
  - "Use this file's labels". Under it, one line: "Products of this list get their own filters, separate from other
    lists."
  A change of the choice is a form edit: it withdraws the shown preview and asks for a new dry run, as every edit does
  today (`GlamProfileEditor.tsx:16-17`). The import request sends the choice of the last preview.
- MCP tool `import_glam_pricelist` (`tools/mcp-server/src/index.ts:1137-1163`): a new optional argument `labels`
  (`"site"` | `"file"`, default `"site"`), sent as the request member. The summary prints one line: the label set used
  and its four labels.
- The choice is not stored. Each import asks again, with the site labels selected first.

### 4.4 The pure core receives the labels as data

- `planGlamImport(rows, upload, labels, defaultVariantName, applied?, taken?)` (`map.ts:222`). `labels` = the four
  chosen labels (§ 4.3); `defaultVariantName` = the site's `importVariantName`, non-empty (§ 3.3). `mapStyle` writes
  `labels.collection`,
  `labels.unit`, `labels.packaging`, `labels.minimumOrder` where it writes `ATTRIBUTE.*` today (`map.ts:307-310`).
  `COLUMN_ATTRIBUTE` (`profile.ts:27-32`) and its alias `ATTRIBUTE` (`map.ts:207`) are removed. Attribute order is
  unchanged.
- `differing` (`map.ts:328-332`) lists the chosen labels of the three columns and keeps the report word
  `specificații tehnice` (shown nowhere, row 21).
- `checkProfile(profile, labels)`: a profile label may not equal one of the four chosen labels after `norm`
  (`profile.ts:61`, `:70-72`). Callers: `readStoredProfile(item, labels)` (`profile.ts:149`, check at `:157`) and the
  profile choice: `parseProfileChoice` (`profile.ts:182-186`) keeps its shape check before any read
  (`glam-pricelist.ts:146`); its label part runs after the labels are known. A stored profile whose label equals a
  chosen label reads as `unsupported` (`profile.ts:160`): the import is refused with today's 409
  (`glam-pricelist.ts:828`) until the profile is edited or the other label set is chosen.
- Golden test (`backend/test/unit/glam-profile-golden.test.ts`): it stays the oracle against the frozen capture, with
  the allowed-delta contract of § 4.10.

### 4.5 The default option name

- `checkUpload` (`map.ts:39-56`) stops applying a default. `GlamUpload.variantName?: string` is present only when the
  request gave a name that is not blank after `displayForm`. Absence has this one representation; no `""` sentinel
  enters the core. `glam-images.ts:134` is not affected (it reads producer, sheet and `importSource` only).
- `planGlamImport` resolves the name once from its own inputs: `upload.variantName ?? defaultVariantName`, and records
  it as the plan member `variantName: string`, always non-empty. `mapStyle` writes that member. The report's
  `variantName` (`glam-pricelist.ts:714`) reads it.
- The handler passes `defaultVariantName` from the site labels (`catalogServerTexts`, § 4.1) for BOTH label choices:
  the four file columns of § 4.2 hold no option name. Unit check (`cdl-1`): a request without a name writes the
  site default under `labels: "site"` and under `labels: "file"`; a request with a name writes that name under both.
- Admin form: initial `variantName: ""` (`GlamPricelistImport.tsx:110`); English placeholder "Empty: the site's
  default option name" (`:703`).
- MCP: the description (`index.ts:1147`) and the comment (`tool-shapes.ts:52`) say "default: the site's default
  option name".

### 4.6 The stored marker `importLabels`

Every imported product also stores the label set it was written with: `importLabels: { collection, unit, packaging,
minimumOrder }` (the chosen set, in full, even for a column whose cell was empty in the file). Shared-first:
`ProductSchema` (`packages/shared/src/index.ts:1405`) gains it as an optional strict object of four non-empty strings,
beside `importProfileRevision` (`:1489`). It is importer-owned like `importSource`: `backend/src/products/create.ts:49`
and `backend/src/products/update.ts:52` add it to their omit lists (the precedent of `cat-import-profile-1a`,
`docs/slices/cat-import-profile-1a.md:37`), so an admin edit keeps it and cannot set it. Those two files serve
catalog and commerce products; the change adds one key to a list and changes no commerce behaviour.

A product without `importLabels` was written before `cdl-1` (or by hand). Its labels are the four Romanian words of
`profile.ts:28-31`: the old importer wrote no others.

### 4.7 The admin editor's second copy (`GlamProfileEditor.tsx:334`)

`COLUMN_ATTRIBUTE_KEYS` and `COLLECTION_ATTRIBUTE` (`:334-336`) are removed. The editor reads `labels[labels.used]`
from the dry run (stored in its `facts`; the editing state keeps the dry run's facts, `GlamProfileEditor.tsx:231`):
`pruneModes` (`:430-432`), `collectionHint` (`:563-579`) and the "Column filters" row (`:747-754`). One source: the
backend.

### 4.8 What the dry run reports (new or changed members)

| Member | Content |
|---|---|
| `labels` | new: `{ site: {4 labels}, file: {4 labels}, used: "site" \| "file" }` |
| `variantName` | changed meaning: the name that will be written (request name, else the site's default option name) |
| `otherLabels` | new: the other lists that hold other labels (§ 5.3) |
| refusal | new: the label check of § 3.4; a stored profile made `unsupported` by the chosen labels (§ 4.4) |

### 4.9 Labels page

The Labels page is shown to every tenant (`admin/src/components/layout/Sidebar.tsx:108-109`).

- New card "Import labels" in the catalog group (beside "Filters", `admin/src/pages/Labels.tsx:578-591`): Collection,
  Unit, Packaging, Minimum order, Default option name. Placeholders show the language defaults (ro / en). Help text:
  "Written into the products at the next import of a list. Products keep their labels until their list is imported
  again."
- The existing "Interest list" card (`Labels.tsx:537`) gains the four mail keys of § 3.1.

### 4.10 The golden oracle: allowed-delta contract

The golden test compares the current code with a FROZEN capture: the plan, every write payload in order, the audit
calls and the response, for three inputs (`backend/test/unit/cat-import-profile-1-golden.ts:66-117`;
`fixtures/glam/cat-import-profile-1-baseline.json`). Its existing allowed deltas are named, each with its own
assertion: response members added later go to `ADDED_MEMBERS` (`cat-import-profile-1-golden.ts:27`), and the English
audit title is mapped member by member, throwing on any other form (`glam-profile-golden.test.ts:63-74`). `cdl-1`
keeps the capture, does not re-capture, and adds only these named deltas:

| # | Delta | How the test treats it |
|---|---|---|
| D1 | Test input: the tenant item of the comparing run (`glam-profile-golden.test.ts:97`) gains `locale: "ro-RO"` | An input, not an expectation: it makes the site labels the Romanian words the capture holds. Without it the tenant resolves to English. |
| D2 | Every `PRODUCT#` Put payload gains `importLabels` | A named function removes `importLabels` from PRODUCT Put payloads only, and asserts that each removed value equals `{ "collection": "colecție", "unit": "unitate", "packaging": "împachetare", "minimumOrder": "comandă minimă" }` (literal). It throws when a captured payload already holds the member, or when a non-PRODUCT payload holds it. |
| D3 | Every `plan.styles[].draft` gains `importLabels` | The same removal and the same literal assertion, on drafts only. |
| D4 | The plan gains `variantName`; `plan.upload.variantName` is absent when the input sent no name | Asserted per input against the capture: `plan.variantName` equals the captured `plan.upload.variantName` (`"Format"` for `synthetic-mixed` and `boen-PL`; `"Variantă"` for `synthetic-no-product`, which sends no name). Then `plan.variantName` is removed, and for an input without a name the captured `upload.variantName` is compared with the new plan's `variantName` instead of with `upload`. No other plan member is touched. |
| D5 | Responses gain `labels` and `otherLabels` | Both join `ADDED_MEMBERS`. The test asserts that the dry-run answer of every input holds both (the execution answer of `synthetic-no-product` is the 400 "no product" body), and asserts their values wherever they are present: `labels.used = "site"`; `labels.site` = the four Romanian words; `labels.file` = the header cells of each input file, written as literals in the test; `otherLabels = []` (only `synthetic-mixed` seeds another sheet, `cat-import-profile-1-golden.ts:73-76`; it holds no marker, so its labels are the Romanian words, the same as this import's). |
| D6 | The calls of `planGlamImport` in the test helpers (`glam-profile-golden.test.ts:115`, `planOf`) | Call sites follow the new signature. They pass the Romanian labels and `defaultVariantName` from `catalogServerTexts(resolveLocaleStrings({ locale: "ro-RO" }))`; D2-D5 pin the values as literals. |

Everything else must equal the capture byte for byte after `mask` (`cat-import-profile-1-golden.ts:135-142`), which
replaces only generated ids and timestamps. No field is stripped by a general rule.

## 5. Identity and change

### 5.1 The rule

The importer writes the chosen labels into every product of the list it imports, and records them in `importLabels`.
It never rewrites a product of another list. Nothing blocks an import because of labels, and facets are never merged.

### 5.2 When labels differ between lists

Causes: the owner edits a site label; the site language changes; one list is imported with the file's labels.
Old label `W1`, new label `W2`, for one column:

| Surface | Effect |
|---|---|
| Products | each holds the label of its own list's last import. |
| Product page | each product shows its own label as the row label. |
| Shop and category pages that mix the lists | two facets, `W1` and `W2`, each with its own values; each passes or fails the repeat rule on its own (`MIN_HOLDERS`, `facets.ts:52`). This is the line the preview shows under "Use this file's labels". |
| Filter URLs | `a.W1=v` still filters the products that hold `W1`. When none holds it any more, the selection is shown with count 0 and can be removed (`facets.ts:13-15`, `:392`). |
| Product and category links | unchanged: slugs and categories come from the values (`map.ts:236`). |
| Saved attribute modes | a mode keyed by `W1` does not apply to products that hold `W2`. The editor drops it at the next profile edit (§ 4.7). |
| Interest list | finds the collection through each product's own `importLabels` (§ 6.1). |

A change of the default option name splits nothing: the variant facet id is `varianta`, its mode is keyed by no name,
and only its heading falls back to `facetVariantDefault` on a page that mixes names (§ 3.2).

### 5.3 The preview names the other lists

The dry run reads all products of the tenant already (`glam-pricelist.ts:197`; `importLabels` is added to its
projection, `DRY_RUN_FIELDS`, `:100`). It answers `otherLabels`: every other list (`importSource` starting with
`glam:`, other than this one) whose products' labels (their `importLabels`, else the Romanian words of § 4.6) differ
from this import's chosen labels. Each entry: `importSource`, its labels, the product count. The admin shows it under
the preview: "These lists use other labels: … Import them again to share filters." The MCP summary prints the same
line. Nothing blocks.

### 5.4 Cases not solved

1. Between the first and the last re-import, a listing that mixes lists with different labels shows two facets.
2. A visitor's saved filter link to `W1` shows "no product matches" after every list is re-imported with `W2`.
3. A hand-made product (no `importLabels`) is read with the Romanian words of § 4.6, as today.

## 6. The interest list

### 6.1 Finding the collection (`interest/public.ts:166`)

Rule: the collection of a product is the value of its attribute whose key equals `importLabels.collection`; a product
without `importLabels` uses `colecție` (§ 4.6), exactly as today. NFC compare, as today. `COLLECTION_ATTRIBUTE`
(`:59`) is removed; `RESOLVE_PROJECTION` (`:57`) adds `importLabels`. The resolve route needs no tenant read.

Why this rule (size): it is one stored member and one projected field. It works for both label choices, and it needs no
pack lookup. A reader that accepts "the site label and every pack's word" would miss every file label (§ 3.5).

### 6.2 The stored form and the admin table

- The system form (`FORM#interest-list`, written once at `interest/public.ts:243-251`) and each submission's
  `formName` (`:265`) get English constants: name "Interest list"; labels "Name", "E-mail", "Phone", "Message",
  "Products". These texts are admin data, and the admin is English; no visitor and no mail shows them.
- The admin submissions table shows fixed English headers for this system form, by field id
  (`admin/src/pages/FormSubmissions.tsx:140`; the data is keyed by id, `:174`). A form stored before `cdl-1`
  (Romanian labels) therefore shows English headers too. Its stored labels are no longer read.

### 6.3 The mail

The subject and body (`:284-296`, `:303`) are built at send time from `catalogServerTexts(...).interestMail`, in the
site language, with today's layout and symbols. The submit route already reads the whole tenant item (`:203-206`); it
needs no new read. For a site in Romanian without overrides the mail equals today's mail; an impl test pins this
with today's literal mail as the expected value.

## 7. Path defaults

### 7.1 One rule: the saved path, else the English default

When is a stored prefix empty? OBSERVED on the code:

- A tenant that stores no `urlPrefixes`: `mapTenant` substitutes `URL_PREFIX_DEFAULTS` whole
  (`renderer/src/lib/dynamo.ts:180`).
- A tenant created by `POST /tenant` stores the full object (`tenant/create.ts:54`, `:152`).
- A stored object that lacks a key or holds `""`. Two writers make it: (a) the admin Settings page on a tenant that
  stores no `urlPrefixes`: `updateUrlPrefix` saves `{ ...undefined, [key]: value }` (`admin/src/pages/Settings.tsx:507`),
  an object with ONE key; (b) clearing a field in Settings stores `""` (`:1626`). In case (a), INFERRED from the code
  (not run), `matchCommercePrefix` (`SitePage.tsx:213-233`) compares the path with `undefined`, so product, category,
  shop, cart and checkout pages stop routing (F-CDL-PARTIAL-PREFIXES).

Rule (ruled, § 9 item 5): per key, the stored non-empty value, else `URL_PREFIX_DEFAULTS[key]` — the backend's rule of
`revalidate-paths.ts:80-84`. `urlPrefixesOf(stored)` applies it for the three whole-object readers (§ 3.5).
`catalogListingPath` (`catalog-listing.ts:72-74`) falls back to `URL_PREFIX_DEFAULTS.shop`. The Romanian literals of
rows 16-17 are removed. The literals of rows 18-19 sit in commerce branches; under the rule they are never reached,
and they are not edited (§ 8.5).

Effects, accepted by the human ("don't care about breaking what is now live"; "yes on point 5"):
- A tenant with a partial or `""` object routes again at the default paths, cart and checkout included (the named
  commerce-freeze exception, § 8.5).
- On such a tenant a content page at a default commerce path (for example `/shop`) is reached no more: the renderer
  matches commerce routes before content (`SitePage.tsx:360`, `:545`). The content-slug check now also reserves these
  paths for new slugs (`slug-guard.ts:23-29` reads `urlPrefixesOf`). Staging: 0 tenants have a partial object for
  these keys (E2); no `ROUTE#/shop` item on either catalog tenant (E21).

### 7.2 The interest path

`URL_PREFIX_DEFAULTS.interest` becomes `/my-list` (`index.ts:99`). This one constant is the runtime default
(`SitePage.tsx:237`, `app/[siteId]/layout.tsx:275`, and `urlPrefixesOf`) and the creation default
(`tenant/create.ts:54`). The admin placeholder (`Settings.tsx:1655`) shows `/my-list`. A Romanian site sets
`/lista-mea` in Settings → URL Prefixes → Interest list.

Effects:
- A catalog tenant that stores no `interest` moves to `/my-list` (staging: `cm1-catalog`, `glam-staging`). Header and
  card links follow when the pages render again after the renderer deploy (INFERRED; `cdl-2` proves it on staging).
- A tenant that stores a value keeps it. That includes the 96 staging tenants created since 2026-10-30 that store
  `/lista-mea` from the old creation default (E2, E11); their owner changes it in Settings.
- The interest route runs before content on a catalog site (`SitePage.tsx:347`), so a content page at `/my-list` on a
  catalog tenant without a stored `interest` is hidden. Staging: no `ROUTE#/my-list` on either catalog tenant (E21).
  The content-slug check does not reserve the interest path (F-CDL-INTEREST-SLUG, § 12).

## 8. Rollout

### 8.1 What changes on deploy

Prod holds only a test tenant (§ 1.2). Nothing is preserved by a check. Stored products are never rewritten: old
products keep their labels until their list is imported again, and the interest reader reads them as § 6.1 says.

### 8.2 Deploy order

Shared (`@amodx/shared`) is built into each deployable and ships with each step.

| Slice | Order | Why |
|---|---|---|
| `cdl-1` | backend → admin | the admin reads the dry-run members (`labels`, `otherLabels`) that only the new backend sends |
| `cdl-2` | backend (`slug-guard.ts`, tenant creation default) → admin (`glamPreview.ts`, placeholder) → renderer | the renderer is the step that changes routing and the interest path |

The MCP server is a local tool; it is rebuilt with `cdl-1`.

### 8.3 Rollback

Reverse order of the deploy. Data is never rolled back.
- `cdl-1`, backend: imports write the Romanian literals again and no marker; products written with other labels keep
  them; the old interest reader finds only `colecție`, so those products show no collection line until re-imported.
  The mail is Romanian again.
- `cdl-2`, renderer: the whole-object path fallback and `/lista-mea` return for tenants that store nothing.

### 8.4 Staging evidence the slices must produce

- `cdl-1`, `cm1-catalog` (en-US), the smallest sheet `glam:alpod/cig1-aur` (1 product, E8):
  1. dry run: `labels.site` = `Collection`, `Unit`, `Packaging`, `Minimum order`; `labels.file` = `colectie`,
     `unitate de masura`, `unitate de impachetare`, `comanda minima`; `otherLabels` lists the other `glam:` lists;
  2. import with "site": the product holds `Collection` (+ the other present columns) and `importLabels` with the
     site set; the product page shows the row "Collection";
  3. import again with "file": the product holds `colectie` and `importLabels` with the file set;
  4. interest resolve for this product and for one `glam:boen/pl` product (`colecție`, no marker): both answer
     `collection`;
  5. an interest submit to a mailbox the operator controls: English mail; the admin submissions table shows English
     headers.
- `cdl-1`, `glam-staging` (ro-RO): import of one small sheet with "site": attribute keys and order equal those before
  the import; the mail is Romanian.
- `cdl-2`: the serving-contract suite with a new row (a tenant whose stored `urlPrefixes` is
  `{ "interest": "/lista-mea" }` routes `/product/<slug>` and `/lista-mea`); `cm1-catalog`'s list page at `/my-list`.

### 8.5 Commerce freeze

- `cdl-1` touches no commerce-only file. It adds one key to the importer-owned omit lists of
  `backend/src/products/create.ts` and `update.ts` (shared product routes; precedent § 4.6).
- `cdl-2` edits no commerce branch. It changes commerce routing for a tenant with incomplete path settings (cart and
  checkout start to route at the default paths). The human named this as the commerce-freeze exception on
  2026-11-15 ("yes on point 5"). The commerce-branch literals of rows 18-19 stay in the code, unreachable
  (F-CDL-DEAD-FALLBACKS).

## 9. Rulings (human 2026-11-15)

The human ruled "GO. yes on point 5" on the operator's six points. Each ruling, as it applies to this design:

1. **The labels live in the admin.** The Labels page has a card "Import labels": Collection, Unit, Packaging,
   Minimum order, Default option name. The defaults come from the site language pack (ro / en); the owner can change
   them (§ 3.1, § 4.9).
2. **At import the preview offers a choice, not a warning.** The real file headers never equal the site labels, so a
   warning would show on every import. The preview shows the two sets side by side: "Use the site labels" (default)
   and "Use this file's labels", with the line "Products of this list get their own filters, separate from other
   lists." The request carries the choice; the importer writes the chosen labels. An empty header cell takes the site
   label of its column. The MCP tool passes the choice as an optional argument (§ 4.2, § 4.3).
3. **When labels change later**, the preview names the other lists that still hold other labels. Nothing blocks. No
   facet merge (§ 5.3).
4. **Interest list.** The reader finds the collection through the label set each product stores (`importLabels`). The
   mail to the site owner is in the site language. The admin submissions table shows fixed English headers for this
   system form (§ 6).
5. **Paths.** One rule everywhere: the path the owner saved, else the English default. The Romanian fallbacks go. The
   interest default becomes `/my-list` for every tenant; a Romanian site sets `/lista-mea` in Settings. The commerce
   effect is accepted: cart and checkout routing changes for a tenant with incomplete path settings, with no commerce
   file edited — the named commerce-freeze exception (§ 7, § 8.5).
6. **English words:** `Collection`, `Unit`, `Packaging`, `Minimum order`, `Option`, and the mail texts of § 3.1.

How this design reads two points of the ruling (no new choice; stated so a reviewer can check them):
- Point 5 "the Romanian fallbacks are removed" together with "no commerce file edited": the fallbacks are removed
  from behaviour everywhere (none is ever reached), and from the code outside the commerce branches. The four
  commerce-branch literals stay in the code until the commerce track removes them.
- Point 5 "the path the owner saved": a value stored at creation by the old default (`/lista-mea`) is a saved value.
  The design does not rewrite stored tenant settings.

No new choice for the human was found.

## 10. Implementation slices

Root build first in each slice: `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run build; echo $?` →
`0`; then `npm run typecheck; echo $?` → `0`.

| Slice | Visible output | Allocation (files) | Oracles (exit codes) | Staging evidence |
|---|---|---|---|---|
| `cdl-1` labels, import choice, interest list, mail, admin headers | The preview offers site / file labels; English sites get English labels; the interest mail is in the site language; English submission headers | `packages/shared/src/{index.ts (catalog keys, ProductSchema.importLabels), locale-strings.ts (catalogServerTexts), language-packs/en.ts, language-packs/ro.ts}`; `backend/src/import/glam/{parse.ts, map.ts, profile.ts}`; `backend/src/import/glam-pricelist.ts`; `backend/src/interest/public.ts`; `backend/src/products/{create.ts, update.ts}` (omit lists); `admin/src/components/{GlamPricelistImport.tsx, GlamProfileEditor.tsx}`; `admin/src/pages/{Labels.tsx, FormSubmissions.tsx}`; `tools/mcp-server/src/{index.ts, tool-shapes.ts}`; tests beside each | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/shared" && npm test; echo $?` → `0` (RO pack covers the keys; RO values equal today's literals; non-empty rule); `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend" && npm run test:unit; echo $?` → `0` (golden against the frozen capture with exactly the deltas D1-D6 of § 4.10; header labels and the empty-cell rule; absent request name → site default under both label choices; label check; profile check with chosen labels; marker written; collection lookup with and without marker; RO mail equals today's literal mail; EN mail; `otherLabels`); `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/admin" && npm run test:unit; echo $?` → `0` (choice withdraws the preview; editor reads `labels[used]`; English headers); `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/tools/mcp-server" && npm test; echo $?` → `0` | § 8.4, `cdl-1` items |
| `cdl-2` paths | English path defaults; incomplete path settings route; Romanian fallbacks gone | `packages/shared/src/{index.ts (urlPrefixesOf, URL_PREFIX_DEFAULTS.interest), catalog-listing.ts}`; `renderer/src/lib/dynamo.ts`; `renderer/src/components/SitePage.tsx` (rows 16-17 only); `admin/src/components/glamPreview.ts`; `admin/src/pages/Settings.tsx` (placeholder); `backend/src/lib/slug-guard.ts`; tests | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving; echo $?` → `0` (with the partial-prefix row); `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm test; echo $?` → `0`; shared `npm test` → `0` (`urlPrefixesOf`: absent, partial, `""`, full); backend `npm run test:unit` → `0` (slug check on a partial object; created tenant stores `/my-list`); admin `npm run test:unit` → `0` | § 8.4, `cdl-2` item |

Order: `cdl-1` and `cdl-2` are independent; either can go first. Each slice updates the `ARCHITECTURE.md` files it
touches and refreshes the MCP route coverage (`npm test`). No slice changes infra.

## 11. Evidence log

| Id | Label | Command | Result |
|---|---|---|---|
| E1 | EXECUTED | `git rev-parse HEAD`; `git status --porcelain -uall` | `fd39faa077ea2a6ba0a79ae07b4c38c2e5deb329`; empty (tree clean at start) |
| E2 | EXECUTED | E2 block below (Query on `AmodxTable-staging`, `PK = SYSTEM`, `begins_with(SK, TENANT#)`) | 597 items, one page; 371 without `urlPrefixes`; of 226 with it, 0 lack or empty `shop`/`product`/`category`/`cart`/`checkout`; 130 lack `interest`; 96 store `/lista-mea`; locales: 370 absent, 226 `en-US`, 1 `ro-RO`; catalog tenants `cm1-catalog` (no locale, no `urlPrefixes`) and `glam-staging` (`ro-RO`, no `urlPrefixes`); 0 items store `catalogStrings` |
| E3 | EXECUTED | E3 block below (diacritic search) | 15 files; every line read; classified in § 2.2 |
| E4 | EXECUTED | E4 block below (word search, path fallbacks) | interest form and mail words; `/magazin` ×7 + `catalog-listing.ts:73`; `/produs` ×2; `/comanda` ×2; `/cos` ×1; `/confirmare` ×3 |
| E5 | EXECUTED | `git grep -l -E 'SendEmailCommand\|sendEmail\('` over `backend/src` | 7 files: `contact/send.ts`, `forms/public-submit.ts`, `interest/public.ts`, `orders/create.ts`, `orders/update-status.ts`, `users/invite.ts`, `webhooks/paddle.ts` |
| E6 | EXECUTED | `git grep -n attributes` over `backend/src renderer/src packages/shared/src packages/plugins/src admin/src tools/mcp-server/src` (tests and `MAP.md` excluded), each hit read | readers by name: `interest/public.ts:166`, `GlamProfileEditor.tsx:571`; generic readers: `SitePage.tsx:967-990`, `facets.ts`, `glamPreview.ts:150-184`, `ProductEditor.tsx` (owner-typed); no MCP reader |
| E7 | EXECUTED | `git grep -n -E 'differing\|\.column\b'` over `admin/src tools/mcp-server/src renderer/src packages`; `git grep -n formName` over `admin/src backend/src renderer/src tools/mcp-server/src` | no reader of `differing` or of the skip `column`; `formName` is written by the forms handlers and `interest/public.ts:265`, projected by `forms/submissions.ts:27`, read by no admin or MCP code |
| E8 | EXECUTED | E8 block below (Query `PK = TENANT#glam-staging` and `TENANT#cm1-catalog`) | `glam-staging`: 446 products (437 `glam:boen`, 9 `glam:alpod`); keys `colecție` 446, `unitate` 9; variant names `Format` 446; no product `facetModes`; no `IMPORTPROFILE#`, no `FORM#interest-list`, 0 submissions. `cm1-catalog`: 460 products; sources `glam:boen/pl` 437, `glam:alpod/orc-wood` 8, `orc-laminate` 8, `cig1-mini` 2, `cim1-mini` 2, `cig1-aur` 1, none 2; keys incl. `colecție` 458, `Style` 489, `Format` 287, `Esență` 280, `Finisaj` 280; variant names `Format` 458; one profile `IMPORTPROFILE#glam#boen`, 13 spec keys, modes `Certificates`/`Nordic swan` = never; no `FORM#` item |
| E9 | EXECUTED | `cd backend && node --input-type=module -e "…resolveLocaleStrings({ locale, catalogStrings: { facetVariantDefault: '' } })…"` (shared `dist` built 2026-11-14 22:20; last `packages/shared/src` commit 2026-11-02) | `ro-RO` → `ro-RO ro "" "Variantă" Nume`; absent → `en-US en "" "Option" Name`; `ro_RO` → `ro-RO ro …`; `de-DE` → `de-DE en … Name`; packs `en,ro` |
| E10 | OBSERVED | read `backend/src/forms/list.ts:30-32`, `admin/src/pages/FormSubmissions.tsx:100-185` | system form left out of the forms list; heading "Interest lists" for its id; field labels are table headers; data read by field id first |
| E11 | EXECUTED | `git log --format='%h %ad %s' --date=short -S'interest: "/lista-mea"' -- packages/shared/src/index.ts`; read `backend/src/tenant/create.ts:40-60,145-155` | `39f4081 2026-10-30 cat-interest-1`; `create.ts` stores `TenantConfigSchema.parse(...)` with full `urlPrefixes` |
| E12 | EXECUTED | `find backend/test/unit/fixtures/glam -name '*.csv'` (26 files); header lines, BOM and CR removed, `sort \| uniq -c` | one header in 24 files (12 columns) and the same plus `link imagini suplimentare` in 2 files: `colectie,produs,…,unitate de masura,unitate de impachetare,comanda minima,…` |
| E13 | OBSERVED | read `admin/src/pages/Settings.tsx:495-510,1585-1660`; `backend/src/tenant/settings.ts:196-222`; `renderer/src/lib/dynamo.ts:180`; `SitePage.tsx:213-238,328,348,362` | GET returns the raw item; `updateUrlPrefix` spreads `prev.urlPrefixes`; `mapTenant` keeps a stored object as is; routing compares with the stored keys |
| E14 | OBSERVED | read `backend/src/lib/revalidate-paths.ts:74-84` | backend purge uses `configured \|\| URL_PREFIX_DEFAULTS[kind]` per key |
| E15 | OBSERVED | read `docs/slices/admin-english-1.md:290-330`, `docs/slices/admin-english-2.md:86-95,205-213` | rows 7-9, 15, 16, 22 were kept as data by those slices and sent to this design (F-AE2-2, F-AE2-3) |
| E16 | NOT RUN | any read of prod data | the operator and the builder cannot read prod. Every prod claim here is UNVERIFIED |
| E17 | NOT RUN | a run of the admin Settings save plus the renderer on a tenant without `urlPrefixes` | F-CDL-PARTIAL-PREFIXES is INFERRED from code; it was not reproduced (a reproduction writes tenant data) |
| E19 | EXECUTED | revision 1: `git grep -n URL_PREFIX_DEFAULTS` over `backend/src admin/src renderer/src packages/shared/src packages/plugins/src tools/mcp-server/src`; read `backend/src/lib/slug-guard.ts:1-38`, `packages/shared/src/facets.ts:160-175,205-235`, `backend/src/lib/revalidate-paths.ts:65` | whole-object fallback readers: `dynamo.ts:180`, `glamPreview.ts:56`, `slug-guard.ts:20` (plus `SitePage.tsx:214,348,362,711`, which receive `mapTenant` output); per-key readers listed in § 3.5; `PurgeKind` = `page`, `product`, `category` (no `interest`); variant facet id fixed `varianta`, heading = shared group name else `facetVariantDefault`, variant mode keyed by no name |
| E20 | EXECUTED | revision 1: `cd backend && node --input-type=module -e "…resolveLocaleStrings({ locale: 'ro-RO', catalogStrings: { interestName: 'Numele complet' } })…"` | `strings.catalog.interestName` = `"Numele complet"`, `defaults` = `"Nume"`: an override wins over the Romanian pack, so a Romanian locale alone does not prove today's mail (R-CDL-PRESERVATION) |
| E21 | EXECUTED | revision 3: `aws dynamodb get-item --table-name AmodxTable-staging --key '{"PK":{"S":"TENANT#<t>"},"SK":{"S":"ROUTE#<path>"}}' --projection-expression SK` for `<t>` in `glam-staging`, `cm1-catalog` and `<path>` in `/my-list`, `/lista-mea`, `/shop`; key format checked by a Query `begins_with(SK, "ROUTE#")` on `glam-staging` | no item at any of the six keys; the key format is `ROUTE#/` + path (`glam-staging` holds only `ROUTE#/`; writer `backend/src/content/create.ts:118`) |
| E22 | OBSERVED | revision 3: read `backend/src/products/create.ts:45-50`, `update.ts:48-53`, `docs/slices/cat-import-profile-1a.md:37`, `renderer/src/components/SitePage.tsx:345-360,543-545`, `backend/src/import/glam/parse.ts:68-79,175-181`, `packages/shared/src/index.ts:1478-1490` | importer-owned fields are omitted from the authoring parse (precedent for `importLabels`); route order interest → commerce → content; the parsed result type and the BOM rule; the product schema's importer-owned members |
| E23 | OBSERVED / EXECUTED | revision 4: read `backend/test/unit/glam-profile-golden.test.ts:1-132` and `backend/test/unit/cat-import-profile-1-golden.ts:27-180`; `python3 -I -c` over `fixtures/glam/cat-import-profile-1-baseline.json` printing each case's `plan.upload.variantName`; `git diff --stat fd39faa HEAD -- backend/src backend/test packages/shared/src` | the golden compares plan, write payloads, audit calls and response after `mask` (ids, timestamps) with two named deltas today; the comparing run seeds the tenant without `locale` (`:97`); captured `upload.variantName`: `synthetic-mixed` `Format`, `synthetic-no-product` `Variantă`, `boen-PL` `Format`; HEAD `0ea790c` differs from `fd39faa` in none of those paths |
| E18 | EXECUTED | § 11.1 script: every `file:line` token of this document checked against `git show fd39faa:<file>` line counts | result in § 11.1 |

E2 / E8 (read-only Query commands; never a Scan):

```
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"SYSTEM"},":s":{"S":"TENANT#"}}' --projection-expression "SK, urlPrefixes, #l, catalogMode, catalogStrings, commerceEnabled" --expression-attribute-names '{"#l":"locale"}' --output json
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"TENANT#glam-staging"},":s":{"S":"PRODUCT#"}}' --projection-expression "SK, attributes, variants, importSource, facetModes" --output json
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"TENANT#glam-staging"},":s":{"S":"IMPORTPROFILE#glam#"}}' --output json
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"TENANT#glam-staging"},":s":{"S":"FORM#interest-list"}}' --output json
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"TENANT#glam-staging"},":s":{"S":"FORMSUB#interest-list#"}}' --projection-expression "SK, formName" --output json
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"TENANT#cm1-catalog"},":s":{"S":"PRODUCT#"}}' --projection-expression "SK, attributes, variants, importSource, facetModes" --output json
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"TENANT#cm1-catalog"},":s":{"S":"IMPORTPROFILE#"}}' --output json
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"TENANT#cm1-catalog"},":s":{"S":"FORM#"}}' --projection-expression "SK" --output json
```

The JSON was counted with `python3 -I` scripts in `/tmp` (deleted after the run).

E3:

```
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -n -E "[ăâîșțĂÂÎȘȚşţ„]" -- backend/src packages/shared/src packages/plugins/src renderer/src tools/mcp-server/src infra/lib ':!*MAP.md' ':!**/language-packs/ro.ts' ':!**/country-packs/ro.ts'
```

(test files removed from the output with `grep -v -E '/test/|\.test\.'`).

E4:

```
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -n -w -E 'Nume|Telefon|Mesaj|Produse|Trimis[aă]?|magazin|comanda|confirmare|cos|produs|categorie|lista' -- backend/src packages/shared/src renderer/src packages/plugins/src tools/mcp-server/src ':!**/language-packs/ro.ts' ':!**/country-packs/ro.ts' ':!*MAP.md'
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -n -E '\|\| *"/[a-z-]+"|\?\? *"/[a-z-]+"' -- renderer/src packages backend/src admin/src tools/mcp-server/src
```

### 11.1 Results of the document checks

Filled in after the file was written (§ 11, E18). Command:
`python3 -I cites.py "<repo>" docs/slices/catalog-data-labels-1.md fd39faa` (a script in `/tmp`, deleted after the
run). It reads every `path:line[-line][, :line]` token, resolves a bare file name when it is unique in
`git ls-tree -r fd39faa`, and checks the last cited line against the file's line count at `fd39faa`. Result of the
final run (revision 4): 180 tokens checked, 0 out of range, 0 unresolved. Five base names are not unique (`en.ts`,
`ro.ts`, `index.ts`, `map.ts`, `update.ts`); each of their 22 tokens was printed from the intended file
(`language-packs/en.ts`, `language-packs/ro.ts`, `packages/shared/src/index.ts` or `tools/mcp-server/src/index.ts`,
`backend/src/import/glam/map.ts`, `backend/src/products/update.ts`) and read: all hold the cited text. Bare `:line`
citations after a named file are not tokens of the script; a sample of 47 (revision 0), 25 (revision 1) and 14
(revision 3: `SitePage.tsx`, `GlamProfileEditor.tsx`, `parse.ts`, `products/create.ts`, `products/update.ts`,
`Labels.tsx`, `interest/public.ts`) and 9 (revision 4: the two golden test files) was printed with `git show fd39faa:<file> | sed -n <line>p` and read: all hold
the cited text. The first run found one range past the
end of a file (lines 205 to 215 of `admin-english-2.md`, a file of 213 lines); it is corrected to 205 to 213.

## 12. Named findings and deferred debt

- **F-CDL-PARTIAL-PREFIXES** (pre-existing, INFERRED, § 7.1): an owner who edits one URL prefix in Settings on a
  tenant that stores no `urlPrefixes` saves a one-key object; the renderer then stops routing product, category, shop,
  cart and checkout pages. Closed by `cdl-2`.
- **F-CDL-INTEREST-SLUG** (pre-existing): the content-slug check does not reserve the interest path on catalog
  tenants (`slug-guard.ts:23-29`); a content page at that path is hidden by the interest route (`SitePage.tsx:347`).
  Not in this design.
- **F-CDL-CONFIRMARE** (pre-existing, commerce): the checkout confirmation path segment `/confirmare` is fixed for every
  commerce tenant (`SitePage.tsx:218`, `:221`, `:503`). Left to the commerce track.
- **F-CDL-DEAD-FALLBACKS** (after `cdl-2`): the literal fallbacks of rows 18-19 in the commerce branches are never
  reached. Removal belongs to the commerce track.
- **Packet corrections** (evidence over the packet's wording): the header row is not wholly ignored (its cell count
  selects the layout, `parse.ts:93-94`); `FormSubmissions.tsx:117` is a comment, and the stored interest form name is
  shown nowhere in the admin (row 11); the Romanian path fallbacks are more than `/magazin` (rows 17, 19, 20).

## 13. Exit criterion

The design is ratified (§ 9). Each impl slice is done when its oracles of § 10 exit 0 on a fresh build and its
staging evidence of § 8.4 is recorded in its own slice record.
