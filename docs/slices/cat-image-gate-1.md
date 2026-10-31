# CAT-IMAGE-GATE-1 — a catalog product is published only when it has an image (IMPL slice)

Status: **READY 2026-10-31** — human ruling of 2026-10-31 (below). Track: Glam catalog. Depends on `cat-import-1`,
`cat-images-1`, `cat-import-profile-1` (1a–1c, shipped `2cf738e`/`86fca54`/`07627c7`).

## 1. The human's direction and ruling

> "Why no images though? No point in having a catalog sites with no images. Products with no images should not become
> cards or pages just warn about them maybe offer the option of importing them too or not." — human, 2026-10-31

Problem as presented: whether a product has an image is known only AFTER the image copy (`cat-images-1`) — BOEN's 280
products with image cells point at a host that answers 404 for every file; 157 more have no image cell. Ruling (option
"Hidden until an image copies"): **every product a glam import writes starts hidden; the image copy publishes each
product as soon as one of its images is copied into the site's storage; products left with no copied image stay hidden
and are listed in the report with the row, the product and the failed address; an import option "publish products
without images too" (default OFF) is remembered in the producer's profile.** Accepted risks (stated to the human): a
re-imported sheet is invisible while the copy runs; if the copy stops (tab closed), products stay hidden until "Copiază
imaginile" runs again; hidden products are replaced by the next import (hand-added photos belong in the pricelist).

**This supersedes**, for glam imports on catalog tenants, `docs/slices/cat-images-1.md` § 2 item 5's "when every source
fails the product is imageless (the gallery renders nothing, the card shows its placeholder)" and `catalog-mode-1.md`
CM-D7's honest-absence display for such products: an imageless imported product is not shown at all unless the
producer's profile opts in.

## 2. Verified facts (operator, 2026-10-31, on `f80a976`)

- `ProductStatus = z.enum(["active", "archived", "draft"])` (`packages/shared/src/index.ts:976`); the glam importer
  writes `status: "active"` (`backend/src/import/glam-pricelist.ts:538`, `:562`). "Hidden" = `draft`.
- Surfaces that already exclude a non-`active` product: the catalog listings (`renderer/src/lib/dynamo.ts`
  `getCatalogListing` rule via `packages/shared/src/catalog-listing.ts` — shop `status === "active"`, category
  `!status || status === "active"`); the sitemap's product entries (from `getActiveProducts`, `FilterExpression` on
  `active`); the interest list (`backend/src/interest/public.ts:144,163` → `not-available`).
- **Gap:** the product page (`getProductBySlug`, `renderer/src/lib/dynamo.ts:230-243`) checks only the availability
  window, not `status` — a `draft` product's page opens by direct link on every tenant today. This slice closes it for
  CATALOG tenants only (commerce unchanged: byte identity). The commerce behaviour is a named finding for the human.
- The image copy writes one conditional `UpdateCommand` per touched product (`backend/src/import/glam-images.ts:146`,
  `updateProductImages :238`, expression `:260`) and rebuilds `CATPROD#` afterwards (cards carry `status`).
- `GlamImportProfileSchema` (`packages/shared/src/index.ts:1043`) is strict, `version: 1`.
- Admin image report `admin/src/components/GlamPricelistImport.tsx:645-648`; dry-run "Products without any image"
  `:674`, `:685`.
- Staging `cm1-catalog`: 437 BOEN products, all imageless today (157 no cell + 280 copy failures, 404).

## 3. Scope

1. **Profile field** `publishWithoutImages: boolean`, optional, absent = `false`, in `GlamImportProfileSchema` (an
   optional member of a strict object: profiles stored before this slice still parse; `version` stays 1 — state the
   compatibility rule in the record). Importer default without a profile: `false`.
2. **Import:** when the effective `publishWithoutImages` is `false`, every product the import writes gets
   `status: "draft"`; when `true`, `"active"` (today's behaviour). The dry run reports, per product, whether it will
   start hidden and which have no image cell at all ("will stay hidden unless images are added to the file").
3. **Image copy:** a product of the import set that is `draft` and, after the copy's write, holds at least one option
   or main image under the site's uploads CDN, becomes `active` in the SAME conditional `UpdateCommand` (one write; the
   `attribute_exists(PK)` condition kept); its `CATPROD#` rebuild follows as today. A product left with no copied image
   stays `draft`. Products with no image source are never touched by the copy and stay `draft`. With
   `publishWithoutImages: true`, the copy never changes status. Only the copy's own import set is affected (selected by
   `importSource`, as today).
4. **Report:** the copy's response and the admin image section list the products that remain hidden for lack of an
   image (product title, slug, row indexes from the import report when in memory, and each failed source with its
   reason); the dry run and the import report state the count that will start/stay hidden. Romanian copy for every new
   string.
5. **Product page (catalog tenants only):** a product whose `status` is not `active` → 404 (the same not-found path as
   a missing product). Non-catalog tenants unchanged (the `cm1-*` byte-identity rows stay green).
6. **Admin:** the profile editor gains the checkbox "Publică și produsele fără imagine" (default off), saved with the
   profile on import; the preview's cards and filter panels show only the products that would be published (with the
   option off: products whose images are not yet copied are shown as "ascuns până la copierea imaginilor" — say how the
   preview treats them, since copying happens after the import; the honest rule: the preview cannot know which links
   will work — it shows all products that have an image cell, marked "imagine de copiat", and lists those without any
   cell as hidden).
7. **MCP:** the import summary states how many products start hidden; a service-account import whose caller does not
   run the copy leaves its products hidden — record this (follow-up `CAT-IMAGES-MCP-1` gains weight).

## 4. Non-scope

Changing the commerce product page; any change to how images are copied, refused or cached; image optimisation; a
manual "publish anyway" button per product (the admin product editor can already set `status`); glamCRM.

## 5. Evidence (Definition of Done)

- Units: profile parse with and without the field (old stored profile → `false`); import statuses for both settings;
  dry-run counts; copy: draft + one copied image → active in one write; all sources failed → stays draft; no source →
  untouched; `publishWithoutImages: true` → status never changed; cancelled update → no publish, reported; CATPROD
  rebuild carries the new status; the product page 404 for a catalog `draft` and unchanged for a commerce `draft`.
- The 1a golden (`backend/test/unit/fixtures/glam/cat-import-profile-1-baseline.json`) changes ON PURPOSE only in the
  written `status` (now `draft` by default): the record shows the exact diff (status fields only) and re-captures the
  golden from the base commit with the new expectation stated — no other byte may move.
- Serving rows: catalog `draft` product page → 404; listings unchanged for active products; `cm1-*` green.
- Staging (operator): re-import BOEN → all 437 hidden (no image works); the shop shows no BOEN product; the image report
  lists them; an ALPOD sheet import → products published as their images copy; one ALPOD product with a deliberately
  dead link in every option → stays hidden and listed.

## 6. References

`docs/slices/cat-images-1.md` § 2 (superseded item 5 for this case), `catalog-mode-1.md` CM-D7,
`cat-import-profile-1.md` §§ 3, 6, 11; glamCRM `docs/slices/pl-tools-2.md` § 10 (scrapers must deliver working image
addresses).

## 7. Implementation record (builder, 2026-10-31, base `b5ef8fb`, uncommitted working tree)

Status: **BUILT, revision 1 (review-0 CIG-R1..R3 addressed, § 7.11) — awaiting review.** Evidence labels: EXECUTED / OBSERVED / INFERRED / NOT RUN. Line numbers are of the
working tree at the time of writing.

### 7.1 Fact correction to § 2 (OBSERVED — read before reviewing item 5)

§ 2 says the product page "checks only the availability window, not `status` — a `draft` product's page opens by direct
link on every tenant today". The code says otherwise: `renderer/src/components/SitePage.tsx` (base line 250, since
`d2ecffe` cache-1) already had `if (status !== 'active' && !preview) return notFoundHere();`. So on every tenant a
non-active product page was ALREADY not found — unless the request carries `?preview=<anything>`, which the dynamic twin
turns into `preview = true` (`app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:55`) with no authentication. The real gap was
that bypass, plus the metadata branch (`buildSitePageMetadata`), which read no status and put a hidden product's title
in the not-found page's metadata. Item 5 is implemented against the real gap: on a catalog site the status rule ignores
`preview`, and the metadata takes the missing-product path. The ruling (hidden products are not shown) is unchanged by
this correction, so I did not escalate. Consequence to know: an admin can no longer open a hidden catalog product with
`?preview=true` (the admin product editor still edits it).

### 7.2 Per item: what changed

1. **Profile field** — `packages/shared/src/index.ts:1063` `publishWithoutImages: z.boolean().optional()`.
   Compatibility rule: an OPTIONAL member of the strict object, so a profile stored before this slice parses unchanged
   (no key inserted; strictness unchanged for unknown keys); `version` stays 1; absent ≡ `false`. The equivalence is
   also in the "same profile" comparison (`backend/src/import/glam/profile.ts:118` `comparable`): a sent `false` equals
   a stored profile without the member (`stored`, no new revision), and the default sent with `false` stays
   `unprofiled` (no save, no stamp). The admin writes the member only when `true` (enabled-only, like `variant: "never"`).
2. **Import status + dry-run counts** — `glam/profile.ts:126` `importStatus(profile)`: `active` only for
   `publishWithoutImages: true`, else `draft`. `glam-pricelist.ts:177` (dry run, the profile it plans with) and `:215`
   (execution, the profile decided under the lock) → `productItem(..., status)` `:561/:570`; the dry-run `drafts` use the
   same `productItem`. New response member `publication` (`:942` `publicationOf`, sent at `:189` and `:307`, so also in a
   503 "incomplete"): `{ status, startHidden, withoutImageAddress: [{ slug, title, rowIndexes }] }`. A separate member
   so the 1a golden's `counts`/`products[]` keep their shape. Interpretation: "per product, whether it will start
   hidden" is all-or-none within one import (one profile), so it is stated once by `status`; the per-product list is
   `withoutImageAddress` (an empty OR invalid image cell — the parser drops an invalid one, `disposition: "invalid"`).
3. **1a golden** — see § 7.3.
4. **Image copy** — pure rules in `backend/src/import/glam/images.ts`: `:204` `holdsCopiedImage` (an option or main image
   under `<cdnUrl>/`), `:229` `planProductWrite` (the one write decision: images by `rewriteProduct`; publish when the
   product is `draft` and holds a copied image after the write — also with no image change, CIG-R2), `:142`
   `rewriteProduct(…, read)` (re-planning on a later read, CIG-R1), `:249` `hiddenWithoutImage` (`draft`, no copied
   image, no producer URL left). Handler `glam-images.ts`: projection `title, #status, imageLink` (`PRODUCT_PROJECTION`);
   `:172` plans; `writeProduct` `:316` puts images and/or `#status = :active` in ONE `UpdateCommand` with the condition
   `attribute_exists(PK) AND #status = :read` (`:348`); a cancelled write re-reads (`readProduct` `:275`): absent →
   `products.replaced` (as before), present → re-planned, at most `WRITE_ATTEMPTS` = 3 (`:73`). `CATPROD#` rebuild
   unchanged — it projects the returned item, so cards carry `active`. Holdings reported = the options the committed
   write changed (`changedValues` `:268`, filter `:211`).
   **Design choice (recorded):** the copy does NOT read the profile. It changes only `draft` → `active`. With
   `publishWithoutImages: true` the import writes `active`, so the copy never changes those products' status. Reading
   the profile instead would be wrong: profiles are per producer, products per sheet — sheet A imported with `false`,
   then sheet B with `true`, would leave sheet A hidden forever. Residual (accepted, INFERRED low): a product an admin
   sets to `draft` by hand while it holds a copied image is published again by the copy's next write for it (a write
   happens only while it still holds a producer URL, or once for a draft that holds a CDN image).
5. **Reports** — copy answer: `products.published[]` (`{ productId, slug }`), `hiddenWithoutImage[]` (`{ productId, slug,
   title }`, computed over the whole live set every request), audit `productsPublished`.
   The failed sources of a hidden product are the `sources` entries naming it as a holder (this or an earlier answer of
   the same copy) — not repeated per product in the answer; the admin joins them (`hiddenProducts`). MCP:
   `tools/mcp-server/src/tool-shapes.ts:103` — lines for `draft` ("Pornesc ascunse: N … Acest instrument nu copiază
   imagini: fără copiere, produsele rămân ascunse.") and `active`, plus the no-image-address list (first 10 + count).
   Item 7 record: a service-account import via `import_glam_pricelist` that does not call
   `POST /import/glam-pricelist/images` leaves every product hidden — follow-up `CAT-IMAGES-MCP-1` gains weight.
6. **Renderer (catalog only)** — `SitePage.tsx:254` `if (status !== 'active' && (catalog || !preview)) return notFoundHere();`
   and `:146` metadata: a catalog non-active product takes the missing-product path. Non-catalog: byte identity (`cm1-*`).
   No change in `lib/dynamo.ts`.
7. **Admin** — `GlamProfileEditor.tsx`: edit `publish-without-images` (`:504`, enabled-only; `:243` no-op on an
   unsupported profile — found by the compiler's exhaustiveness error), checkbox `:739`, help `:323`; preview uses
   `publishedDrafts` for cards, product-page choice and panels (`:894`), lists hidden drafts (`:948`).
   `glamPreview.ts`: `draftPublication` `:92` (`active` → published; `draft` + an option image address → `after-copy`,
   card marked "imagine de copiat"; else hidden), `publishedDrafts` `:99`, `hiddenDrafts` `:112`, `PUBLICATION_NOTICE`
   `:117`, panels through the rule `:266`. How the preview treats products not yet copied: it shows the state after a copy
   in which every image link works (`after-copy` → `active` for the listing rule) and says so; the products without any
   image address are not cards and are listed as hidden. `GlamPricelistImport.tsx`: `PublicationLines` `:824` (check and
   import report; replaces the old English "Products without any image" line), totals `productsPublished`/`hidden`,
   `start { resume }` `:300/:346` and the `importSource` guard `:351`, `HiddenCause` `:452`, `hiddenProducts` `:461`,
   `hiddenCauseText` `:479`, image section counts `:730` and hidden list `:737`.

### 7.3 The golden (EXECUTED)

Procedure: `git worktree add /tmp/CAT-IMAGE-GATE-1-baseline b5ef8fb`; capture harness copied in (it now leaves the
post-b0a3055 response members `ADDED_MEMBERS` out — `backend/test/unit/cat-import-profile-1-golden.ts:25`, one list
shared by capture and comparison, `publication` added); `node_modules` linked (the unit config aliases `@amodx/shared` to
the worktree's own `packages/shared/src`).
- Control: capture on unchanged `b5ef8fb` → `cmp` **byte-identical** to the committed b0a3055 golden.
- Re-capture with ONE change in the worktree, `glam-pricelist.ts:562` `status: "active"` → `status: "draft"`.
- Structural diff old → new (`jsondiff`, every leaf): **4430 differing leaves; 0 whose key is not `status`; 0 value
  changes other than `"active"` → `"draft"`**. By shape: 443 × `steps.execution.writes[].input.Item.status` (product
  Puts), 1772 × `steps.execution.writes[].input.RequestItems.test-table[].PutRequest.Item.status` (`CATPROD#` cards),
  the same two in `steps.reExecution`. Category items (`status: "active"`), plans, responses, audits: unchanged.
- File: sha256 `c818dd41…` → `9733ee91…`; size −4430 bytes (one byte per value). Worktree removed.
- Current code vs the new golden: `glam-profile-golden.test.ts` 7/7, (a) no choice and (b) `DEFAULT_PROFILE` choice.

### 7.4 Oracles (EXECUTED, fresh `npm run build`, in packet order; revision-1 run — iteration-0 numbers in brackets)

| Command | Last lines |
|---|---|
| `npm run build` | exit 0 [iteration 0: first run exit 2, admin TS2345 exhaustiveness in `editedEditor` → fixed] |
| `npm run typecheck` | exit 0 |
| `packages/shared` `npm test` | 10 files, 197 passed |
| `backend` `npm run test:unit` | 43 files passed, 1 skipped (the capture); 1156 passed, 1 skipped [1149] |
| `renderer` `npm test` | 11 files, 115 passed |
| `renderer` `npm run test:serving` | 73 tests, 73 pass (incl. `cig1-catalog-hidden`, `cig1-commerce-hidden`, `cm1-identity-commerce/content`, `cf1-preserve`) |
| `renderer` `npm run test:serving-bundle` | 58 tests, 58 pass |
| `renderer` `npm run test:interest-e2e` | 5 passed |
| `admin` `npm run test:unit` | 6 files, 129 passed [125] |
| `tools/mcp-server` `npm test` | route coverage ran (112 routes, no route change); 12 pass |
| `infra` `npm test` | 61 passed |
| `git diff --check` | exit 0 |
| `git diff --stat -- infra` | empty |
| `cm1-byte-identity/` | untouched (`git status` empty for it) |
| `git status --porcelain -uall` | 31 paths, all allocated (+ `backend/test/unit/memory-table.ts` in revision 1) |

Negative control (EXECUTED): the new renderer unit test against the
base `SitePage.tsx` fails 4 rows (the three `?preview=` catalog rows and the metadata row). The serving rows were not run
against base code (NOT RUN; the unit control covers the same decision).

### 7.5 New tests (by § 5 bullet)

Profile parse with/without the member: `packages/shared/test/glam-import-profile.test.ts`; `backend/test/unit/glam-profile.test.ts`
(importStatus, false ≡ absent, old stored item). Import statuses both settings, dry-run counts, CATPROD status:
`glam-import-handler.test.ts` "CAT-IMAGE-GATE-1 import status". Copy rules: `glam-images-core.test.ts`; copy handler
(draft + one copied image → active in one write; all failed → stays draft, listed; no source → untouched, listed;
`publishWithoutImages: true` → no status in any write; cancelled → not published, reported; other sheet untouched):
`glam-images-handler.test.ts`. Product page: `renderer/test/unit/catalog-product-status.test.ts` + serving rows `cig1-*`
(fixture: a `draft` commerce product with no `CATPROD#` card, `fixtures.mjs:323`). Admin: `glamPreview.test.ts`,
`GlamPricelistImport.test.ts` (checkbox edit, totals, `hiddenProducts`). MCP: `tool-shapes.test.ts`. Revision-1 rows:
§ 7.11.
Two existing assertions changed on purpose (`status === "active"` → `"draft"`): `glam-import-handler.test.ts` first
integration row and the 1a "dry run with an explicit profile" row; both titles still state what they prove.

### 7.6 Abstraction one-liners

- `importStatus(profile)` — users: dry run + execution in `glam-pricelist.ts`, tests; axis: the profile setting (variants fixed); rejected: inline ternary twice (the rule then has no single test point).
- `holdsCopiedImage` / `planProductWrite` (sum `none | write { images | null, publish }`) / `hiddenWithoutImage` (pure, `glam/images.ts`) — users: `glam-images.ts` update loop and hidden list; axis: none new (pure core, the slice's dispatch is `status` equality); rejected: inline in the handler (untestable without the in-memory table).
- `publicationOf` — users: dry-run and execution responses; rejected: two inline object literals.
- `ADDED_MEMBERS` / `splitAddedMembers` (test helper) — users: capture test and comparison test; rejected: two copies of the list (the old state, which this slice would have had to edit twice).
- `draftPublication` (sum `published | after-copy | hidden`, exhaustive switch) / `publishedDrafts` / `hiddenDrafts` — users: `previewCards`, `previewPanel`, `ImportPreview`; axis: variants fixed, operations growing → sum + match; rejected: a boolean `pendingCopy` on items (two booleans for three states).
- `PublicationLines` (component) — users: check report and import result; rejected: duplicated JSX.
- `hiddenProducts` (pure) + `HiddenCause` (sum `failed | no-image-address | unknown`) + `hiddenCauseText` — users: `ImageCopyReport`, tests; axis: variants fixed (the evidence states), exhaustive switch; rejected: a `failed[]` array whose emptiness meant "no address" (the CIG-R3 defect: absence of evidence read as evidence of absence).
No new module, package, dependency, boundary or DTO crossing a new boundary. New wire members: `publication`,
`products.published`, `hiddenWithoutImage` (raw JSON, existing route boundary).

### 7.7 Copy inventory (new strings; Romanian per § 3 item 4)

Admin editor: "Publică și produsele fără imagine"; help `PUBLISH_WITHOUT_IMAGES_HELP`. Preview: `PUBLICATION_NOTICE`
(contains "ascuns până la copierea imaginilor", "nu poate ști care adrese de imagine vor funcționa", „imagine de
copiat”); card label "imagine de copiat" (tooltip "ascuns până la copierea imaginilor"); "Rămân ascunse — fără adresă de
imagine în fișier (N); se publică doar dacă adăugați imagini în fișier". Check/import report: "Ar porni ascunse" / "Pornesc
ascunse: N produse — fiecare devine public când una dintre imaginile lui se copiază pe site. Dacă copierea se oprește,
apăsați din nou „Copiază imaginile”."; "Fără adresă de imagine în fișier — rămân ascunse dacă nu adăugați imagini în
fișier (N)" / "— publicate fără imagine (N)"; "Profilul publică și produsele fără imagine: toate produsele sunt publicate
la import."; "rândurile …". Image section: "Produse publicate acum (o imagine a lor s-a copiat)"; "Produse care rămân
ascunse — nicio imagine copiată"; `HIDDEN_CAUSE_UNKNOWN` ("Cauza nu este cunoscută în această sesiune: fie rândul nu are
adresă de imagine, fie imaginile lui au eșuat la o copiere anterioară. Importați lista din nou și copiați imaginile ca să
vedeți adresele care eșuează."); "Aceste produse rămân ascunse pe site: niciuna dintre imaginile lor nu s-a copiat.
Adăugați în fișier adrese de imagine care funcționează și importați-l din nou. O imagine adăugată în editorul produsului
se pierde la următorul import al listei."; "Fără adresă de imagine în fișier." MCP: "Ar porni ascunse"/"Pornesc
ascunse: N produse — …"; "Acest instrument nu copiază imagini: fără copiere, produsele rămân ascunse."; "Fără adresă de
imagine în fișier (rămân ascunse dacă nu adăugați imagini în fișier): N — …"; "Profilul publică și produsele fără
imagine: niciun produs nu pornește ascuns."; "Publicate fără adresă de imagine în fișier: N — …"; ", și încă N".
The surrounding existing admin copy stays English (not this slice).

### 7.8 Findings and follow-ups (not fixed: outside the allocation or the slice)

- F-CIG1-1 `renderer/src/components/ProductByIdPage.tsx:58` — `/products/<id>` keeps the unauthenticated `?preview=`
  exception, also on catalog sites: a hidden imported product opens at `/products/<id>?preview=1` when its id is known
  (ids are not published for hidden products; INFERRED low exposure). Same one-line rule would close it.
- F-CIG1-2 (for the human, § 2) — on NON-catalog sites `?preview=` (unauthenticated) still opens any `draft` product page,
  and `buildSitePageMetadata` still emits a draft commerce product's title/description on its not-found answer.
- F-CIG1-3 `tools/mcp-server/src/index.ts:1139` — the `import_glam_pricelist` description says "image URLs are kept as in
  the file until cat-images-1" — stale; it should say products start hidden and the tool does not copy images.
- `CAT-IMAGES-MCP-1` gains weight (item 7).
- The audit of `GLAM_PRICELIST_IMPORT` does not carry the hidden count (adding it would move golden bytes; not asked).

### 7.9 What I could not determine

- Whether the edge/ISR invalidation after a copy makes a newly published product page reachable at once: a hidden
  product's URL may hold a cached not-found handoff (307) until an invalidation; the copy route already runs under
  `withInvalidation` (as for image changes). NOT RUN here (no deployed edge) — staging check below.
- Real BOEN/ALPOD behaviour (437 products, live 404 host): staging only.

### 7.10 Operator's staging checklist (§ 5 staging bullets)

1. Deploy backend + admin + renderer together (the admin reads `publication`, `products.published`, `hiddenWithoutImage`).
2. Re-import BOEN on `cm1-catalog` without the option → check report says "Pornesc ascunse: 437"; after "Copiază
   imaginile": all 437 still `draft`, the shop and category pages show no BOEN product, the image section lists 437 hidden
   (157 "Fără adresă de imagine în fișier", 280 with their 404 sources).
3. Open one BOEN product URL directly and with `?preview=true` → not found both times.
4. Import an ALPOD sheet → products appear on the shop as their images copy; one product with a dead link in every option
   stays hidden and is listed with its sources.
5. After the copy: open a newly published ALPOD product URL that was requested while hidden → it must render (checks the
   invalidation question of § 7.9).
6. Optional: tick "Publică și produsele fără imagine", import a small sheet → all products public at import; the profile
   item stores `publishWithoutImages: true` with a new revision.

### 7.11 Revision 1 — review-0 findings (EXECUTED unless labelled)

**CIG-R1 (P1) — overlapping copies could leave a product active and imageless.** Defect class: *a stale write overrides
a publication decision another request has committed* (the status was decided by one request, the images by another
request's older read). Rule that closes the class (`glam-images.ts` header, `writeProduct`): **a product's write
commits only if the `status` it was planned from is still stored** (`attribute_exists(PK) AND #status = :read`;
`attribute_not_exists(#status)` for a status-less read). A cancelled write re-reads the product (consistent Get): absent
→ replaced (unchanged behaviour); present → planned again from the fresh read with this request's source results,
where an option's source is its own image or, when another request removed it, the image it had in this request's read
(`rewriteProduct(…, read)`): a success is applied, a failure never removes a stored copied image. At most 3 tries;
still contended → left to a later request (not reported as replaced). Why this is sufficient: a stale write whose
read status is still stored read the product *with* every copied image it had then (a CDN URL is never a source, so it is
kept), so it cannot drop the image that made the product public; a write planned after a status change is computed
from the fresh state. So **a product the copy published always holds a copied image**. While the status does not
change, a stale write commits exactly as CAT-IMAGES-1 § 9 rules (restored producer URL, repaired by a later request) —
those § 9 rows now import with `publishWithoutImages: true` (no publication at stake) so they still prove what their
titles say; with the default (`draft`) the new rows below apply. The report rule is kept exact: a holding is reported
only when the committed write changed that option (`changedValues`), so a re-planned write that changes nothing reports
nothing. Rows (`glam-images-handler.test.ts` "CIG-R1", real handler, in-memory table, R2 held after its reads):
success-then-stale-failure → R2's write cancelled, re-planned to nothing, product + cards active with the image;
failure-then-stale-success → status unchanged, R2 commits and publishes; R1 removes X and publishes through Y, R2's
stale success is cancelled, re-planned, restores X and reports only option 1 (write sequence `:read` = draft, draft,
active); both fail → draft, listed hidden. Every row ends with a further copy: `complete`, no write, no fetch.
`MemoryTable` implements the two new condition forms exactly; any other condition still throws.

**CIG-R2 (P2) — an imported image already under the tenant CDN never published the product.** `planProductWrite`
publishes a `draft` that holds a copied image even when no image changes: a publish-only write
(`SET #updatedAt = :now, #status = :active`, same condition). Row: import of a CDN image cell → `startHidden: 1`; copy →
no fetch, one publish-only write, product and cards active, `complete`; a further copy writes nothing. A product with no
image is still untouched (row "draft + one copied image …", Ash). Termination: a publish-only write moves a product out
of `draft`, so it happens at most once per product; the remaining-holdings measure is unchanged.

**CIG-R3 (P2) — "copy again" lost the failure evidence and claimed an empty image cell.** Defect class: *absence of
evidence presented as evidence of absence*. Rules: (1) the cause of a hidden product is a sum — `failed` (recorded lost
sources), `no-image-address` (ONLY when the same sheet's import report in memory shows no image address for it),
`unknown` (otherwise, with `HIDDEN_CAUSE_UNKNOWN`); (2) "Copiază imaginile" resumes the outcomes recorded so far
(`start { resume: true }`), the copy that follows an import starts fresh (its products are new), and a batch answered
for another `importSource` discards the recorded outcomes before merging. Rows (`GlamPricelistImport.test.ts`): same-sheet
retry keeps `failed` with the URL and reason; standalone copy → `unknown`, never "no address" (also when the report shows
an address); a genuinely empty cell with the report → `no-image-address`; fresh start after an import; another sheet
discards. INFERRED limit: a copy started in a new browser session, after an earlier session recorded the failures, can
only say `unknown` — the backend keeps no failure history (failed URLs are removed from the product); re-importing and
copying shows them again, which the text says.

**Also fixed:** a latent order-dependent assertion in the iteration-0 row "draft + one copied image …" (the published
list follows store order, `PRODUCT#<random id>`; it passed by chance) — now compared without order; 5 consecutive runs
of the two glam-images files: 48/48 each.

**Not changed:** findings F-CIG1-1..3 stay outside the allocation (§ 7.8). Staging checklist § 7.10 still applies; add:
7. Run two "Copiază imaginile" at once on a small sheet (two tabs) — every product ends active with an image or draft and
listed; none active without an image (CIG-R1, deployed). INFERRED (not verifiable here): DynamoDB evaluates
`#status = :read` exactly as the in-memory table does (plain string equality — no list/map comparison is used).

## 8. Operator closeout (operator, 2026-10-31)

**Review.** review-0 revise (three recovery cases), review-1 **approved** (builder claude-opus-5-5, reviewer codex
gpt-6.1-sol).

**Operator fact error (§ 2), acknowledged.** § 2 said the product page "checks only the availability window, not
`status`". That came from reading `getProductBySlug` alone; `SitePage.tsx` already refused a non-active product unless
`preview` was set. The builder's § 7.1 correction is right and was verified on the deployed pre-slice build (below).

**Gates (operator, approved candidate, bare exit codes, `ALL GATES GREEN`).** build 0; typecheck 0; `packages/shared`
197; backend unit 1,156 + 1 skipped; renderer unit 115; `test:serving` 73 / 0; `test:serving-bundle` 58 / 0;
`test:interest-e2e` 5 passed; admin 129; MCP 12 / 0; infra 61; `git diff --check` 0; no `infra` change;
`cm1-byte-identity/` untouched; 31 changed paths, all allocated. The 1a golden: an independent structural diff of the
committed and the re-captured file finds exactly 4,430 differences, every one `status: "active" → "draft"`.

**Staging CDK diff and deploy.** 0 resources added or removed; 41 functions `Code`/`Metadata` only. ✅.

**Staging evidence (tenant `cm1-catalog`).**
1. BOEN `PL.csv` (stored profile revision 1, no opt-in): import → `publication.status = "draft"`, `startHidden: 437`, the
   products without an image address listed by row; copy → 203 sources failed (404), nothing published; database: 437
   BOEN products `draft`; `/shop` shows 4 products, none BOEN; the copy's response carries `hiddenWithoutImage`; a BOEN
   product address → 404 plain and 404 with `?preview=true`.
2. ALPOD `AUR` sample (sheet `CIG1-aur`, 1 product, 6 images): before the copy `draft`, page 404 plain and with
   `?preview`; copy → 6 ingested; after: `active`, page 200.
3. ALPOD `CLA` sample (sheet `CIG1-mini`) with every image of "Melody" dead: after the copy "Melody" stays `draft` and
   is listed in `hiddenWithoutImage`; "Tradition" is published. (Page statuses for this pair are confounded by finding
   F-2: the earlier `CIM1-mini` sheet holds published products at the same two addresses.)
4. Commerce unchanged, verified with a staging-only probe product (`draft`, tenant `cm1-commerce`, deleted afterwards):
   plain address 404, `?preview=1` 200 — before AND after the deploy, as the slice specifies.
5. Layer 2 (canonicaliser) against the 1b closeout capture: commerce 18/18, content 14/14 identical.

**Findings for the human (not fixed here).**
- **F-1 — unauthenticated draft preview on every non-catalog site (pre-existing).** On the pre-slice build, a `draft`
  product answered 200 with `?preview=<any value>` and its title appeared in the plain 404 page's metadata. The query
  parameter needs no login (`app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:55`). This slice closes it for catalog tenants
  only; commerce and content drafts remain reachable by anyone who appends `?preview=1` (content: per the allowlist
  comment, not verified here).
- **F-2 — product addresses collide across sheets of one producer (pre-existing, `cat-import-1`).** Slugs are unique only
  within one file. The importer's own planner over the 24 real files: 1,920 distinct slugs, 8 produced by two sheets —
  all `ALPOD/ORC-laminate` + `ALPOD/ORC-wood` (e.g. `alpod-organic-eco-design-water-resistant-wood-flooring-clever`).
  After both sheets are imported, such an address shows whichever product the slug index returns first.
