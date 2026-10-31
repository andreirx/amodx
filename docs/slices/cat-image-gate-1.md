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
