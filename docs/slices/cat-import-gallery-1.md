# CAT-IMPORT-GALLERY-1 — the 13-column pricelist (a gallery per row) in the glam importer (SPEC, draft)

Status: **RATIFIED 2026-11-01** (human: "A and ok for your queue proposal" — CIG-D1 = A, CIG-D2 = the § 7 queue). Source: the cross-repo obligation from the glamCRM session (PL-TOOLS-2 /
PL-TOOLS-3, glamCRM commits `6d1facd`, `f6e0d19`; specs `glamCRM/docs/slices/pl-tools-2.md` §§ 10–20,
`pl-tools-3.md` §§ 1–8), relayed by the human on 2026-11-01. Every amodx claim below was read in the tree at
`514971d`; every glamCRM claim was checked read-only on the files under `glamCRM/pl-tools/out/` the same day.

## 1. The obligation (quoted from the glamCRM message)

> Obligation — accept the 13-column file. `backend/src/import/glam/parse.ts` refuses width ≠ 12 (`GLAM_COLUMN_COUNT`).
> Accept width 13 as "12 + gallery": read column 13 through the same image gate as col 9 (copy to own storage; a
> product page shows every copied image of every variant of its style). Keep the 12-column path unchanged. The split
> that was ratified: glamCRM carries rows without an image; amodx hides them and lists them in its report.

The rest of the message (grouping and labels per vendor, the re-import list, the residue) is glamCRM's and the
operator's import plan, not an importer change; it is kept in § 6 for the import day.

## 2. What was verified (EXECUTED 2026-11-01)

| Claim | Check | Result |
|---|---|---|
| Two files per sheet, `enriched/` 12 columns and `catalog/` 13 columns, same first 12 | `csv.reader` over `boen/{enriched,catalog}/PL.csv`, `kuberit/catalog/Gesamt.csv` | widths `{12}` / `{13}` / `{13}`; 479 / 479 / 6,845 records; header 13 = `link imagini suplimentare` |
| Column 13 = other images, `\|`-separated, product photos first | KUBERIT sample row | col 9 the 3D thumb; col 13 `…/568_2Dgfx.png\|…/F2G.jpg` (2D drawing, colour swatch) |
| The amodx parser refuses width ≠ 12 | `backend/src/import/glam/parse.ts:13` `GLAM_COLUMN_COUNT = 12`, `:87-111` | yes: "The file is not the 12-column pricelist layout" |
| One image per row today: a row is one variant option with one `imageLink`; the product's `imageLink` / `additionalImageLinks` are **derived** from the options on every write (first option image, then the other distinct option images) | `backend/src/import/glam/map.ts:289-312`; `glam/images.ts:116-133`; `glam-pricelist.ts:574` | yes — a gallery stored anywhere but on the options is wiped by the next derivation |
| The copy job enumerates sources from the options' `imageLink` only | `backend/src/import/glam/images.ts:55-66` `collectSources` | yes |
| The product page shows the product gallery (`imageLink` + `additionalImageLinks`) and one image per variant | `renderer/src/components/SitePage.tsx:1013-1016` (`ProductImageGallery`), `:881-895` (`CatalogVariantPresenter`) | yes |
| KUBERIT's spec lines carry vendor prices ("Pret < PU: 21.91 EUR", "Pret / m …") | KUBERIT sample; `backend/src/import/glam/profile.ts:350-354, 393-415` | the value guard refuses any spec line holding `eur`, `pret`, a currency sign or a price word as a token → these lines are **refused and listed** ("Spec lines refused by the value guard"), never stored. The no-prices invariant holds without a change |
| The shared option shape | `packages/shared/src/index.ts:1219-1224` `{ value, priceOverride?, imageLink?, availability? }` | one image per option; no gallery field |

## 3. The design

1. **Parse.** `parseGlamCsv` accepts width 12 (as today, byte-for-byte the same result) and width 13. A 13-column
   record gives the same `GlamRow` plus `galleryUrls: string[]` = column 13 split on `|`, trimmed, empty parts
   dropped, duplicates of column 9 dropped. Any other width is refused as today. Columns 3–4 stay never read;
   columns 2 and 5 stay code-only. A file mixing widths is refused (one layout per file).
2. **The row owns its images.** The variant option gains `additionalImageLinks?: string[]` (shared schema
   `index.ts:1219`, optional, so every stored product stays valid). The importer writes a row's column-13 images
   there, in file order. The product-level derivation (`map.ts:289`, `images.ts:116`) becomes: for each option in
   order, its `imageLink` then its `additionalImageLinks`; distinct; the first is `imageLink`, the rest
   `additionalImageLinks`. For a 12-column file this is exactly today's rule (no option has extras), so the 1b
   golden test stays byte-equal.
3. **The image gate.** `collectSources` enumerates the options' extras too; a refused or failed extra is removed
   from the option (as a failed main image is today) and listed in the report; a product's visibility rule is
   unchanged (hidden without a copied **main** image — CAT-IMAGE-GATE-1 — an extra never publishes a product).
4. **The site.** No renderer change: the product gallery already shows `imageLink` + `additionalImageLinks`, and the
   variant presenter keeps one image per variant. "A product page shows every copied image of every variant of its
   style" holds through the product gallery.
5. **Admin.** The product editor's variant options stay label + image on a catalog (`ProductEditor.tsx:431`); the
   extras are import-owned and invisible there, like the derived product images (the editor already says they are
   derived). The import report counts extras copied / refused per sheet.
6. **MCP.** `get_product` shapes carry the new optional field by schema; no tool change.

## 4. Decisions

- **CIG-D1 — where the extra images live.** PROBLEM: the product's images are derived from the options on every write
  (§ 2 row 4), so a gallery must have a home that survives the derivation. OPTIONS: **A** on the option
  (`additionalImageLinks?`), the product gallery derived from all options (REWARD: one rule, the row keeps its own
  images, the 12-column result unchanged by construction; RISK: one optional field on a shared schema). **B** only on
  the product, appended after the option images (REWARD: no schema change; RISK: the derivation must become
  "options plus stored extras", which breaks the one-rule invariant and the byte-equal 12-column proof). RECOMMENDED: A.
- **CIG-D2 — queue position.** See § 7.

## 5. Oracles (for the packet)

The 1b golden (`backend/test/unit/glam-profile-golden.test.ts`) byte-equal on the 12-column fixture; a 13-column
fixture (BOEN rows) → options with extras, product gallery in the stated order; parse refusals for width 11/14 and
for a mixed file; the copy job over a fixture with a failing extra; the shop byte-identity suite unchanged; the ten
common gates. Staging: an import of `boen/catalog/PL.csv` on a catalog tenant (none exists on staging — the packet
creates one), then the product page gallery count equals the row's images.

## 6. The import day (operator plan from the glamCRM message; not this slice)

- Import `catalog/<sheet>.csv` (13 columns), never `enriched/`. Labels per vendor: BOEN format = plank size; ALPOD
  format = the decor or the vendor's English product name, plank and tile rows distinct by `Dimension:`; ITC format
  empty, colour folded into the name; KUBERIT format = colour, codes with leading zeros.
- Re-import list: BOEN PL (274 of 478 rows imaged); ALPOD 21 sheets, one ORC file only (`ORC-wood`) until glamCRM's
  PLTOOLS-ORGANIC is ruled; ITC `Arc_Edition` (531/536); **KUBERIT only after the human states the VAT rate for its
  run** — the file on disk was produced with a proof value and must not be imported.
- Residue, not amodx's: 11 ALPOD AURSTO SKUs pattern-inexact; repeated codes on ALPOD DEC/PRO.

## 7. Queue

Proposed: `cat-admin-2` → `locale-reviews-date-1` → `locale-1e` → **`cat-import-gallery-1`** → the glam tenant's
imports. Reason: the two locale slices are staged and small; a 12-column import today would be replaced by the
13-column re-import anyway (the next import of a sheet replaces its products), so nothing is lost by the order.
The human may pull this slice forward.

## 8. Ratification (2026-11-01)

Human, verbatim: "A and ok for your queue proposal". CIG-D1 = A (the extras live on the variant option; the product
gallery stays derived). CIG-D2 = the § 7 order. The packet is written when `locale-1e` ships.
