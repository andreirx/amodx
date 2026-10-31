# CAT-IMPORT-PROFILE-1 — the per-producer import profile: grouping, specification lines → attributes, filter choices, preview (SPEC slice)

Status: **PLANNED** (2026-10-30) — implementation not started (`docs/documentation.md` § Status taxonomy).
Design state (separate from the lifecycle status): spec revision 3 (2026-10-31, after review-2 `revise`; corrections
by class in § 10); next step decision-review, then the human. SPEC ONLY: this file is the whole deliverable; no code,
infra or test file changes with it. Eight decisions are open (§ 8). The impl slices (§ 7) start only after the human
rules on them.
Track: F — Glam catalog (`docs/ROADMAP.md:195`, row `cat-import-profile-1`). Depends (built, prod deploy pending):
`cat-import-1`, `cat-images-1`, `cat-facets-1` + `cat-facets-1-impl`. Written from `main` at `bacdd86`.
Maturity target: the profile module enters as **PROTOTYPE**; it becomes MATURE when the staging evidence of § 7.5 is
recorded for all three producers.

Evidence labels: **OBSERVED** = read in the file at the cited line on `bacdd86` (2026-10-30); **EXECUTED** = a command
was run (§ 9); **INFERRED** = a conclusion from observed code or measured data, not run. Every `file:line` is OBSERVED
unless marked otherwise. Measurements ran the importer's own pure core (`parseGlamCsv`, `groupStyles`,
`planGlamImport`) over the enriched files `glamCRM/pl-tools/out/{itc,boen,alpod}/enriched/*.csv`, read only; the
replay script is kept (§ 9).

---

## 1. Purpose and the human's direction

> Human direction, 2026-10-30 (`docs/slices/cat-facets-1.md` § 13): "filters will need to work on any spec sheet
> parameter that consistently repeats too, like the arc edition or itc various parameters for the carpeting … maybe we
> grow some flexibility at import pricelist level so the importer shows options like you showed me — for how to handle
> grouping — and also a preview."
>
> Rulings: (1) grouping and specification-filter choices live in an amodx **import profile** per producer, chosen in
> admin with a preview; (2) the filters are built now with a data-driven facet set, before the profiles (shipped in
> `cat-facets-1-impl`).
>
> Ruling CF1I-COLLECTION-CAP = **C** (`docs/slices/cat-facets-1-impl.md` "Ratification"): the 40-value cap applies to
> every key, `colecție` included, until this slice; this design must state how a profile's filter choice takes
> precedence over the renderer's repeat rule (§ 2.6).

**What this slice retires.** Today the importer has one fixed shape for every producer
(`backend/src/import/glam/map.ts:128-133`, four attribute keys from columns 6–8 and 0). The specification text
(column 10) — where the useful facts are (ITC `Pile weight`, BOEN `Wood`, ALPOD `installation_method`) — becomes only
prose, taken from the first row of the style that has specs (`map.ts:182`, `:207-208`). So the filters that
`cat-facets-1` built cannot see those facts. ITC's file also puts style and colour in one name, so every colour becomes
its own product (576 products for 66 styles), and ITC's collection column holds a price sentence, which becomes a
category name. A profile per producer lets the human decide, once and with a preview, what one product is, which spec
lines become filterable attributes and how they are labelled. Every re-import and every service-account import
applies the same decisions.

**Vision tie.** VISION "Core product guarantees" 1 (tenant isolation: the profile is a per-tenant item under
`TENANT#<t>`, § 3.1) and 3 (the profile's effect is a pure function of the file and the profile, tested off-target,
§ 7); "How work is executed" (expand before contract: while no profile exists, the import writes exactly what it
writes today, § 2.8, proven against a golden captured from the base commit, § 7.3; the renderer change is inert until
a product carries the new field, § 7.1).

### 1.1 Findings that change what the packet assumed (EXECUTED, § 9)

1. **BOEN: the spec key that repeats column 11 is `Dimensions (mm)`, not `Format`.** `Dimensions (mm)` equals column
   11 on 258 of 310 rows after spaces and `mm` are removed; the other 52 differ only by the decimal sign (`13.2x181x2200
   mm` vs `13,2x181x2200 mm`, 45 + 7 rows). The spec key `Format` is a format NAME (`14mm Plank 138`,
   `14mm Plank Herringbone Click Castle`), equal to column 11 on 0 of 310 rows. Both vary between the options of 7
   styles.
2. **ITC regrouping gives 66 only on `Arc_Edition.csv`, and only if the dropped token is all digits.** 536 rows, 532
   distinct names; 531 names end in a number token; 5 names end in `AB` (`SR Lumen AB`, `SR Obscura AB`, `E-Strike AB`,
   `Alethea AB`, `Promethea AB`). The rule "drop the last token when it is all digits" gives 66 products, 536 options,
   9 relabelled options (a colour number repeated inside a style with another image, e.g. `10 (2)`). `ITC.csv` (44
   rows, no specs, no images) has no name that ends in a number: the rule changes nothing there.
3. **ITC's price sentence can be replaced from the specs.** Column 0 holds one value on all 580 ITC rows: "Prices in
   EUR per m², valid from 01.03.2024, ex works Tielt, Belgium". The spec key `Collection` (6 values) is on 531 of 536
   `Arc_Edition.csv` rows, and each base name has exactly one `Collection` value (0 conflicts). The 5 rows without
   specs and the 44 `ITC.csv` rows have no `Collection` line. So a profile rule fixes 531 rows; 49 rows need a fallback
   (§ 2.3). glamCRM `docs/slices/pl-tools-2.md` § 8 lists this as a fix "only amodx cannot make" — that is true for 49
   rows only.
4. **Every spec key narrows the BOEN base set.** 157 of BOEN's 437 products have no specs at all (280 have). So under
   the § 2.3 visibility rule of `cat-facets-1` (shown when some value is held by some but not all products), a
   one-value key such as `Certificates: controlled sources` (on all 280) IS shown as a filter — it filters "products
   with a spec sheet". `cat-facets-1.md` § 13 expected it hidden. A profile choice is needed (§ 2.6 "never").
5. **The ITC variant filter would list 131 values.** After regrouping, the `varianta` facet on the ITC category holds
   127 distinct colour numbers plus 4 suffixed labels (`10 (2)`, …); 64 colour numbers occur in 2 or more styles (max
   29). The variant facet has no value cap (`renderer/src/lib/facets.ts:212-213`: always offered). Whether colour "34"
   is the same colour in two styles is still open (`cat-facets-1.md` § 12, CF1-PL-TOOLS-2-ORDER). A profile switch for
   the variant facet is needed (§ 2.6).
6. **`colecție` is a contract, not a label.** `backend/src/interest/public.ts:58` and `:164-165` find a product's
   collection by the literal attribute key `colecție`. So a profile must not rename the four column keys (§ 2.4).
7. **The 11 "other" BOEN lines of `cat-facets-1.md` § 13 are lines with an empty value** (`Appearance:` 5,
   `Style:` 6) — they have no space after the colon. After code-line removal every non-empty spec line of all three
   producers contains a `:` (ITC 3,113 / 0 other; BOEN 3,848 / 0; ALPOD 3,726 / 0).
8. **Spec text is not covered by any mechanism against prices, and only same-row codes are removed** (§ 4). Today's
   prose already publishes a `Price: 25 EUR` line when it is in the style's first specs row (EXECUTED witness, § 9
   E-14). This is pre-existing; a profile that extracts more rows widens it (§ 4.2).
9. **Packet line references, corrected:** `mapStyle` is at `map.ts:180` (not `:178`); `allocateLabels` spans
   `group.ts:190-212`; the repeat rule is `facets.ts:200-207` inside `facetDefs` (`:188-216`); `CODE_COLUMNS` is
   `parse.ts:31-34`.

---

## 2. Profile contents

A profile belongs to one tenant and one producer (`norm(producer)`, the importer's normalisation, `group.ts:25`). It
applies to every sheet of that producer. Every setting has a default; the default is today's behaviour (§ 2.8).

| # | Setting | Values | Default (= today) | Effect on the plan |
|---|---|---|---|---|
| a | `grouping` | `as-is` \| `trailing-number` | `as-is` | what one product is (§ 2.1) |
| b | variant label source (part of `grouping`) | column 11 \| the removed token | column 11 | `options[].value` (§ 2.1) |
| — | `collection` | `column` \| `spec <key>` | `column` | child category + `colecție` attribute (§ 2.3) |
| c | `specKeys` | per key: `attribute { label, split }` \| `prose-only`; unlisted = not extracted, "not reviewed" | empty list | `attributes` from spec lines (§ 2.4) |
| d | variant-level values | the union over the style's rows | — (nothing extracted today) | § 2.5 |
| e | `facetModes` | per stored attribute key: `always` \| `never`; `variant: never`; absent = automatic | empty | which facets the renderer offers and lists (§ 2.6) |

### 2.1 Grouping (a) and the variant label (b)

Today the product key is producer + collection + name, normalised (`group.ts:144`); the variant label is column 11
(`group.ts:152`, `:194`); an empty label becomes `#<n>` (`group.ts:196-198`).

`grouping` is a sum type, so the label source can only be chosen where it means something:

- `{ kind: "as-is" }` — today's key and today's label (column 11).
- `{ kind: "trailing-number", label: "removed-token" | "format-column" }` — before grouping, for each row: split the
  trimmed name on whitespace; when there are at least 2 tokens and the last token matches `^\d+$`, the name becomes
  the other tokens joined by one space, and the removed token is kept. The key and the title use the new name. With
  `label: "removed-token"`, the option label is the removed token; a row without one keeps column 11 (then `#<n>` when
  that is empty, by the existing rule). With `label: "format-column"`, the label stays column 11.

Then the existing dedupe (equal label AND equal image cell, `group.ts:153`), the collision-aware labels and the slug
rule run unchanged. Expected on the real files (EXECUTED, § 9 E-8): ITC `Arc_Edition.csv` with `trailing-number` +
`removed-token` → 66 products, 536 options, 0 deduped, 9 relabelled, 5 imageless; `ITC.csv` → 44 products, unchanged.

**What else the data needs, and what a profile cannot do.**
- ALPOD's Model + Decor grain cannot be made in amodx: the enriched ALPOD files have 12 columns and no Decor column
  (glamCRM `docs/slices/pl-tools-2.md` § 9; header of `out/alpod/enriched/AUR.csv`, OBSERVED). No grouping rule over
  the existing cells can recreate data that is not in the file. Decision CIP1-ALPOD (§ 8).
- **Prerequisite for ALPOD compatibility, stated, not promised.** The profile reads only the closed set of `GlamRow`
  fields (`parse.ts:40-52`), and the parser refuses any record that does not have exactly 12 cells (`parse.ts:77`).
  So an ALPOD profile made now also works for a corrected ALPOD file ONLY IF PL-TOOLS-2 delivers the storefront grain
  through fields this profile already reads: Model + Decor inside `produs` (column 1), with column 11 empty or a
  label, in the 12-column layout — which is what `pl-tools-2.md` § 3 item 2 specifies (`produs` ← Model + Decor).
  Any other delivery (a 13th column, a `Decor: …` spec line, Decor in column 11) needs a new grouping setting, and
  maybe a profile version (§ 3.3). This design does not promise compatibility with such a delivery.
- BOEN needs no regrouping (decor + finish in the name, size in column 11).
- No other grouping rule is designed. A rule is added only when a file shows the need.

### 2.2 Where the profile rules run

```
parseGlamCsv (same-row code lines removed, parse.ts:89)  →  applyProfileToRows (grouping, collection)
   →  groupStyles (unchanged)  →  mapStyle + extractAttributes (spec keys, labels, split, union, value guard § 4.3)
   →  GlamStyleDraft (+ facetModes, + importProfileRevision)
```

The profile rules read only `GlamRow` fields (`parse.ts:40-52`). `GlamRow` has no field for columns 2–5. § 4 states
what this guarantees and what it does not.

### 2.3 Collection source

- `{ kind: "column" }` — today: column 0 (`map.ts:147`, `:186`).
- `{ kind: "spec", key: <spec key> }` — the collection is the value of the row's spec line with that key. A row that
  has no such line gets the SHEET name as its collection. The value then feeds everything column 0 feeds today: the
  product key, the child category (its name and slug), the product slug, the `colecție` attribute. The spec key is
  consumed: it is not extracted again as an attribute (a `specKeys` rule for the same key is refused at validation).
  The collection line passes the same value guard as an extracted attribute (§ 4.3): a refused line counts as absent,
  so the row gets the sheet name, and the dry run reports the row (reason `money` or `code`). Witness (O-PRICES-3):
  `collection: { kind: "spec", key: "Price" }` over a row with `Price: 25 EUR` gives the category `<sheet>`, never
  `25 EUR`.

ITC with `{ kind: "spec", key: "Collection" }` (EXECUTED, § 9 E-8): `Arc_Edition.csv` → categories ITC + 6 collections
+ `Arc_Edition` (the 5 rows without specs); `ITC.csv` → a child category `ITC` (slug `itc-itc`) under the parent `ITC`.
Column 0 is not read for ITC, so the price sentence never becomes a category or an attribute (EXECUTED: the sentence
is in no draft of either file under the rule).
Rejected alternatives: "fallback = column 0" (brings back the price sentence for 49 ITC rows); "fallback = skip the
row" (loses all 44 `ITC.csv` products). Builder decision B-3 (§ 8.1).

### 2.4 Spec-line extraction (c)

**Line grammar (one rule).** A spec line is one line of the cleaned specs (`GlamRow.specs`, same-row code lines
already removed). Its key is the text before the FIRST `:`, trimmed; its value is the text after it, trimmed. A line
without a `:`, with an empty key or with an empty value gives no attribute. Measured: 100 % of the non-empty cleaned
lines of all three producers have a `:` (§ 1.1 item 7). Keys are compared exactly after trim (case-sensitive): the
profile lists keys as the file spells them (`Pile weight`, `installation_method`).

**Per key, one of:**
- `{ key, action: "attribute", label, split }` — every line with this key gives `{ key: label, value }` on the
  product, subject to the value guard (§ 4.3). `label` is the text the site shows (Romanian, typed by the human).
  `split`: `"none"` keeps the value whole; `"comma"` splits it on `,`, trims each part and drops empty parts, giving
  one attribute entry per part.
- `{ key, action: "prose-only" }` — reviewed by the human; the key does not become an attribute; its lines stay in the
  published prose exactly as today. (Revision 0 called this action `drop`, which wrongly suggested the text is removed
  — § 10.)
- A key that the profile does not list has the same effect as `prose-only` (not extracted, prose unchanged), but the
  dry run lists it as "not reviewed", so a new key in a later file is visible (§ 6.2). The two differ only in review
  state.

**Label rules (validated before anything is planned; a refused profile → 400):**
- non-empty after trim;
- not one of the four column keys `colecție`, `unitate`, `împachetare`, `comandă minimă` (`map.ts:128-133`) — they are
  fixed names, and `colecție` is read by name by the interest list (`interest/public.ts:58`). The profile cannot rename
  them; it can set their filter mode (§ 2.6).

No other label rule is needed: the facet URL id is `a.<label>` (`facets.ts:26-28`), and every non-empty key gives a
valid facet id (`facets.ts:31-38`).

**Merges.**
- *Across producers:* two producers' keys with the same label give the same stored attribute key, so the renderer
  shows one facet. Example: BOEN `Wood` and a later producer's `Wood species` both labelled `Esență`. The values are
  not mapped (BOEN `Connection` holds `5G Click`, `T/G`; ALPOD `installation_system` holds `5G`, `Tongue+groove`, …):
  a merged facet shows both spellings. Value mapping is NOT designed — decision CIP1-VALUE-MAPPING (§ 8).
- *Within one producer:* two keys with the same label are one attribute (values joined as in § 2.5).
- *With a column:* the spec key repeats data a column already carries. The profile either makes the key `prose-only`
  (BOEN `Dimensions (mm)` repeats the variant label, column 11) or uses it as the collection source (ITC `Collection`,
  § 2.3). The dry-run analysis shows, per key, on how many rows its value equals column 11 or column 0 after `norm` and
  the removal of spaces and `mm` (§ 3.5), so the human can see it.

**Comma lists (measured, union rule of § 2.5, § 9 E-17):** BOEN `Style` (201 of 310 rows hold a comma list; 17 distinct non-empty values
whole → 4 values after the split: `Classic`, `Nordic`, `Rustic`, `Urban`), BOEN `Surface` (310 of 310; 17 distinct
whole → 11 parts that mix three things: bevel, brushing, top-layer thickness), ALPOD
`installation_method` (207 rows; `Floating`, `Gluedown`, `Clip` after the split), ALPOD `type_of_material`
(`MDF, Wood`), ITC `Pile material` (10 rows). Splitting is per key and the human's choice in the preview: `Style`
reads well split, `Surface` does not. A decimal comma inside a value (`13,2x181`) would be split too; the preview
shows it.

**Prose.** Today: all cleaned lines of the style's first specs row (`map.ts:182`, `:207-208`). Decision CIP1-PROSE
(§ 8) asks whether the lines of `attribute` keys leave the prose; `prose-only` and unlisted keys stay in it in every
option.

### 2.5 Product-level vs variant-level values (d)

Today `mapStyle` takes the first row's columns 6–8 and the first non-empty specs (`map.ts:181-189`) and only REPORTS a
difference in `differing` (`map.ts:199-203`). Measured, non-empty values that differ between the rows of one style
(EXECUTED, § 9 E-5): BOEN `Format` 7 styles, `Dimensions (mm)` 7, `Surface` 7; ALPOD `dimensions` 13,
`installation_system` 11; ITC 0.

**Rule:** an extracted attribute takes the UNION of the values of all rows of the style, in file order, each value
once (compared with `norm`), each value subject to the value guard (§ 4.3). The product stores one entry per value:
`attributes` may hold the same key more than once. This needs no schema change: `attributes` is an array of
`{ key, value }` (`packages/shared/src/index.ts:1044-1047`) and nothing forbids a repeated key (OBSERVED readers:
`facets.ts:122-131` collects a set per key; `SitePage.tsx:800-813` renders each entry; `interest/public.ts:164-165`
takes the first `colecție`; `ProductEditor.tsx:670-678` edits a list). Columns 6–8 keep today's first-row rule (0
styles differ on them today, `cat-facets-1.md` § 2.2).

**What the union publishes that today does not (EXECUTED, § 9 E-15).** Today only the first specs row of a style is
published. The union also publishes the lines of the other rows: BOEN 22 line occurrences (`Format` 7,
`Dimensions (mm)` 7, `Surface` 7, `Style` 1), ALPOD 260 (`installation_system` 129, `dimensions` 131), ITC 0. These
lines pass the same code removal and the same value guard as every extracted value (§ 4); they are not covered by the
claim "already published".

**How the filters treat a variant-level value.** The facet reads the product's set of values per key
(`facets.ts:150-163`), so the product counts once for each value it holds and is listed when any of its options has
the selected value. Fidelity limit, named: the product item does not record WHICH option has which value, so a
selected filter does not preselect the option on the product page, and the product page lists the values of all
options. Rejected alternative: values per option (`ProductVariantSchema` options gain attributes,
`index.ts:986-995`) — a shared schema change, a new invariant at the catalog write boundary, and a renderer change,
for 7 BOEN and 13 ALPOD styles. The product page shows a repeated key as one row with the values joined by ", "
(renderer change in `cat-import-profile-1b`, § 7.1; today `SitePage.tsx:805-810` would print one row per entry).

### 2.6 Filter modes (e) and their precedence over the repeat rule (ruling C)

The renderer's rules today (`facets.ts`): an attribute key is OFFERED when it passes the repeat rule — (i) ≥ 2 products
hold it, (ii) its most frequent value is held by ≥ 2 products, (iii) ≤ 40 distinct values (`facets.ts:45-47`,
`:200-207`). An offered or selected facet is SHOWN when selecting could change the listing (`facets.ts:345-346`). The
variant facet is always offered (`:213`). Matching and counts use every product's values (`facets.ts:293-306`,
`:333-343`).

The profile holds `facetModes`: `{ variant?: "never"; attributes: { key, mode: "always" | "never" }[] }`, where `key`
is the STORED attribute key (a label, or one of the four column keys). Absence means automatic. The importer copies
the profile's `facetModes` onto every product it writes (§ 3.4).

**`always`** has one meaning in every option below: facet `a.<k>` is offered on base set B when some product of B
marks `k` `always` and holds a value for it, whatever (i), (ii) and (iii) give. The visibility rule and "a selected
facet is always shown" are unchanged in every option: they are not the repeat rule; a facet that cannot narrow the
listing has no use.

**`never` has three possible meanings; the choice is the human's** (CIP1-FILTER-PRECEDENCE, § 8). For facet F
(attribute `k`, or the variant facet), call a product of B that marks F `never` a *silent holder*:

- **N1 — value suppression.** A silent holder contributes no value to F at all: not to the offer, not to the listed
  values, not to matching, not to counts. The product keeps the attribute for display. When F is selected through
  other products' values, the silent holder leaves the listing even if it displays the selected value.
- **N2 — offer suppression, matching kept.** A silent holder's values do not count toward the offer (repeat rule and
  `always` are computed over non-silent holders) and are not LISTED as values; but they still MATCH a selection and
  still COUNT in the listed values' counts. The visibility test runs over the listed values.
- **N3 — key veto.** If any product of B marks F `never`, F is not offered on B, whatever other products mark.

**Mixed-producer witness (same key, same value).** Shop base set: BOEN product `b1` with `Esență: Oak`, BOEN marks
`Esență` `never`; producer X products `x1`, `x2` with `Esență: Oak` and `x3` with `Esență: Ash`, X marks `Esență`
`always`.

| Option | `Esență` offered? | Listed values (counts) | Selecting `Oak` lists | `b1` shows "Esență: Oak" on its page? |
|---|---|---|---|---|
| N1 | yes (x-products, `always`) | Oak (2), Ash (1) | x1, x2 — **b1 leaves the listing** | yes |
| N2 | yes | Oak (3), Ash (1) | x1, x2, b1 | yes |
| N3 | **no** (b1 vetoes) | — | — | yes |

**Expected results for the single-producer cases** (identical under N1 and N2; N3 differs only where marked):

| Base set and modes | Today | With the rule |
|---|---|---|
| shop, 147 collections, ALPOD marks `colecție` `always` | `colecție` not offered (147 > 40) | offered, 147 values, the `<details>` closed (> 10 values, `cat-facets-1.md` § 6) |
| BOEN category, BOEN marks the label chosen for `Certificates` `never` | shown, 1 value (280) — § 1.1 item 4 | not shown |
| ITC category, ITC marks `variant: "never"` | `varianta` 131 values | not shown |
| shop with ITC (`variant: never`) + BOEN (no mode) | `varianta` = ITC labels + BOEN sizes | N1/N2: `varianta` lists BOEN's 26 sizes only; N3: `varianta` not shown |
| `k` marked `always`, held by 1 of 20 products | not offered (rule (i)) | offered; shown (narrows 1 of 20) |
| `k` marked `always`, every product holds one value | not offered | offered but NOT shown (cannot narrow) |
| no `facetModes` on any product (every import without a profile) | as built | identical (golden comparison, § 7.3) |

A product cannot mark one key both `always` and `never` (`checkProfile`, § 3.2). The CF1I-COLLECTION-CAP caveat is
closed by the `always` rule: extracting attributes alone does not change the cap; only an explicit `always` does.

### 2.7 The three producers — an illustrative profile (labels are the human's; the dry run proposes, § 6.1)

| Producer | grouping | collection | spec keys (label, split) | facetModes |
|---|---|---|---|---|
| ITC | `trailing-number`, `removed-token` (variant name "Culoare") | `spec Collection` | `Pile weight`, `Structure`, `Usage class`, `Pile material`, `Pattern` → attributes, split none | `variant: never` |
| BOEN | `as-is` | `column` | `Product type`, `Wood`, `Treatment`, `Connection`, `Floor Heating`, `Appearance`, `Color`, `Format` (variant-level), `Style` (comma) → attributes; `Surface` → attribute, split none; `Certificates`, `Nordic swan` → attributes; `Dimensions (mm)` → `prose-only` | `never` on the labels chosen for `Certificates` and `Nordic swan` |
| ALPOD | `as-is` (CIP1-ALPOD) | `column` | `installation_method` (comma), `installation_system`, `type_of_material` (comma) → attributes; `dimensions` → attribute (82 values under the union rule: not offered by the repeat rule, shown on the page) | `colecție` `always` if the human wants the 119-value collection filter |

### 2.8 The default profile and byte identity

`DEFAULT_PROFILE = { version: 1, grouping: { kind: "as-is" }, collection: { kind: "column" }, specKeys: [],
facetModes: { attributes: [] } }`. With it, `applyProfileToRows` returns the rows unchanged and `extractAttributes`
returns nothing.

**The byte-identity promise, exactly.** While NO profile item exists for the producer, and the request carries no
profile or carries one equal to `DEFAULT_PROFILE`: no profile item is written, and no product gets `facetModes` or
`importProfileRevision`. The written items are then the items today's code writes for the same file, field for field
(ids and timestamps aside). The proof is a golden captured from the base commit (§ 7.3), not a comparison of two new
code paths. Once a profile item exists for the producer, every later import of that producer is a profiled import
(stamped, § 3.4) — also when its settings equal the default — so byte identity is not promised for it.

The dry-run response gains members (§ 3.5); that is additive and changes no written item.

---

## 3. Data shapes

### 3.1 Storage (decision CIP1-STORAGE, § 8)

One item per tenant and producer, in the existing table, under the tenant's partition:

| Attribute | Value |
|---|---|
| `PK` | `TENANT#<tenantId>` |
| `SK` | `IMPORTPROFILE#glam#<norm(producer)>` (`norm` = `group.ts:25`; the producer cannot hold `/` or U+001F, `map.ts:39-42`; a `#` inside it is harmless: everything after the prefix is the producer) |
| `Type` | `"ImportProfile"` |
| `producer` | display form (`map.ts:53-55`) |
| `profile` | the `GlamImportProfile` value (§ 3.2) |
| `revision` | integer, 1 on first save, +1 when the saved `profile` differs from the stored one (canonical JSON compare) |
| `updatedAt`, `updatedBy` | ISO time; `actor.email` |

Reads: `GetCommand` on the full key (no scan, no query across tenants). Writes: only the import handler, only in an
execution, only under the per-tenant import lock, BEFORE the mutation phase (§ 6.6). No new route and no new
function: the glam import function already has `grantReadWriteData` on the table (`cat-import-1.md` § 8.1 item 10).

**Which profile made which products is recorded on the products, not in the profile item** (§ 3.4
`importProfileRevision`). Revision 0 kept a side map `appliedTo` in the profile item, written after the products; that
map could disagree with the products after a failure and could not see sheets imported before profiles existed. It is
removed (§ 10).

### 3.2 Schema — zod in `packages/shared` (it crosses the admin ↔ backend boundary and the MCP surface)

```ts
// packages/shared/src/index.ts (sketch; names are the contract)
const SpecKeyRule = z.discriminatedUnion("action", [
  z.object({ key: z.string().min(1), action: z.literal("attribute"), label: z.string().min(1), split: z.enum(["none", "comma"]) }),
  z.object({ key: z.string().min(1), action: z.literal("prose-only") }),
]);
export const FacetModesSchema = z.object({
  variant: z.literal("never").optional(),
  attributes: z.array(z.object({ key: z.string().min(1), mode: z.enum(["always", "never"]) })).default([]),
});
export const GlamImportProfileSchema = z.object({
  version: z.literal(1),
  grouping: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("as-is") }),
    z.object({ kind: z.literal("trailing-number"), label: z.enum(["removed-token", "format-column"]) }),
  ]),
  collection: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("column") }),
    z.object({ kind: z.literal("spec"), key: z.string().min(1) }),
  ]),
  specKeys: z.array(SpecKeyRule),
  facetModes: FacetModesSchema,
});
```

Every `z.object` of this schema is `.strict()` (§ 3.3 item 1); the sketch omits it for brevity.

Validation beyond the shape, in one pure function `checkProfile` (refused → 400 before any read): spec keys unique;
a label is not a column key (§ 2.4); the collection spec key is not also in `specKeys`; every `facetModes.attributes`
key is unique (so no key is both `always` and `never`). No column index appears anywhere in the schema (§ 4.1).

`ProductSchema` gains two optional, importer-owned members, omitted from the authoring input exactly as
`importSource` is (`backend/src/products/create.ts:44-46`, `update.ts:48-50`), so an admin edit keeps them and cannot
set them:
- `facetModes: FacetModesSchema.optional()` — the modes the renderer applies to this product's facet values;
- `importProfileRevision: z.number().int().positive().optional()` — the revision of the producer's import profile
  this product was written with; absent = written without a profile.

### 3.3 Versioning

Goal: an importer never applies only PART of a stored profile. Revision 1 allowed a new optional setting without a
version change; zod objects strip unknown keys by default, so an older importer (after a rollback) would have accepted
a profile with an ENABLED new setting and silently dropped it (review-1 R9). The compatibility contract:

1. **Strict parsing.** Every object of `GlamImportProfileSchema` is `.strict()`: an unknown key, an unknown enum value
   or an unknown `version` makes the parse fail. A parse never strips.
2. **Enabled-only serialisation.** A later slice that adds an optional setting writes its key ONLY when its value is
   not the default; an absent key means the old behaviour. So an older importer accepts exactly the profiles whose
   meaning it can apply in full, and refuses every profile that uses something it cannot apply.
3. **Version change.** A change of what an existing setting or value MEANS raises the `version` literal, and that
   slice adds a pure `migrateProfile` (old → new) with a unit row per field. The newer importer reads both versions; it
   writes the new version when it saves.
4. **Refusal.** A stored profile that does not parse is `unsupported`: the dry run answers with
   `profile.source = "unsupported"`, the stored revision and the reason (the version, or the unknown keys / values); an
   execution that relies on it (no `profileChoice`, which includes every MCP import) answers 409 and writes nothing.
5. **Recovery — two reachable paths.** (a) *Compatible deployment:* deploy an importer that knows the settings (roll
   forward); the stored profile then parses again. (b) *Explicit replacement (the approved migration path):* in admin
   the user builds a profile this importer supports (the unsupported value cannot be loaded into the editor; the
   proposal of § 6.1 is the starting point), previews it — the dry run shows "the stored profile uses settings this
   importer cannot apply: <reason>; importing replaces it" — and imports it with `baseRevision` = the stored revision
   named in the refusal. The revision clause of § 3.5 accepts it; the stored profile is replaced (revision + 1). The
   lost setting is a human's explicit choice after a preview, never a silent drop.
6. **Product data written by a newer importer.** The renderer treats a `facetModes` value it does not know as absent
   (automatic). The failure direction is presentation only: a filter the newer profile hid may be offered; no value is
   exposed that the product does not already show.

### 3.4 What the product item stores

- `attributes`: `{ key, value }` with `key` = the LABEL (spec keys) or the column key, as today's shape. Repeated keys
  for variant-level and split values (§ 2.5). The stored item is self-describing: the product page (`SitePage.tsx:800`),
  the facets (`facets.ts:150`) and the interest list read it without the profile.
- `facetModes` (optional): a copy of the profile's modes, written on every product of a profiled import when the modes
  are not empty.
- `importProfileRevision` (optional): written on every product of a profiled import (§ 2.8).
- No raw producer key is stored next to the label.

**Discovery of each sheet's state** (the dry run already reads every product of the tenant, `glam-pricelist.ts:125`,
`:310-326`; its projection gains `importProfileRevision`). The products of producer P are those whose `importSource`
starts with `glam:<norm(P)>/` — unambiguous because a producer cannot contain `/` (`map.ts:39-42`, `:49`). Per sheet
(per `importSource`), the dry run reports one of:
- `no-profile` — no product carries `importProfileRevision` (imported before profiles, or without one);
- `current` — every product carries the stored revision;
- `stale` — every product carries one older revision;
- `mixed` — the products carry different revisions, or some carry one and some none (an overlapping or partly failed
  history) — "import this sheet again".

**How a later label change reaches existing products** (decision CIP1-LABELS, § 8): only by a re-import of each sheet;
the discovery above lists the sheets that need one (§ 6.3). Named consequence: ALPOD has 21 sheets, so one ALPOD label
change means 21 uploads. A filtered URL that names the old label (`?f=a.<old label>=…`) then shows its chip and
"Niciun produs nu corespunde filtrelor alese." — the canonical of a filtered page is the bare path (`cat-facets-1.md`
§ 5.4), so indexing is not affected.

### 3.5 Request and response changes of `POST /import/glam-pricelist` (route unchanged)

Request body (today `{ csvContent, producer, sheet, variantName? }`, `glam-pricelist.ts:25`) gains one optional member:

- absent → **stored**: the producer's stored profile if one exists, else the default (§ 2.8); an `unsupported`
  stored profile (§ 3.3 item 4) → 409 in an execution;
- `profileChoice: { profile: GlamImportProfile, baseRevision: number | null }` → **explicit**: this profile.
  `baseRevision` is the revision the admin loaded (`null` = none stored). In an execution the choice is ACCEPTED when
  the stored revision equals `baseRevision`, OR the stored profile equals the sent one (canonical JSON). Otherwise →
  409 "the profile was changed by another import since you loaded it"; nothing written. The second clause makes a retry
  safe after a profile write whose outcome was unknown (§ 6.6). For an `unsupported` stored profile only the first
  clause can apply (the explicit replacement of § 3.3 item 5).

Response (dry run and execution) gains:
- `profile`: a sum on `source` — `stored | explicit | default` with `{ revision: number | null, value: GlamImportProfile }`,
  or `unsupported` with `{ revision: number, reason: string }` (no `value`: it cannot be parsed, § 3.3);
- `sheets[]` — the per-sheet discovery of § 3.4 for this producer (`importSource`, display sheet, state, revisions);
- dry run only: `specKeys[]` — per key in the file: rows, products holding it, distinct values (product grain), the
  largest value-holder count, the repeat-rule outcome, comma-list rows, variant-level styles, rows equal to column 11 /
  column 0, up to 5 sample values, values the value guard refused (§ 4.3), and the profile's rule for it (or "not
  reviewed");
- dry run only: `drafts[]` and `siteProducts[]` — the preview DTO, defined by the rules of § 5.2.

### 3.6 Abstraction lines (one per new abstraction)

- `GlamImportProfileSchema` (+ `FacetModesSchema`) — zod schema in `packages/shared`; users: backend handler (request
  + stored item), admin editor, MCP summary; axis: data crossing a documented boundary (admin ↔ API ↔ MCP); dispatch:
  sum types (`grouping`, `collection`, `SpecKeyRule`) with exhaustive `switch` + `assertNever` in the core; rejected:
  untyped JSON per caller (three copies of the shape).
- `backend/src/import/glam/profile.ts` — pure module (`checkProfile`, `applyProfileToRows`, `extractAttributes`,
  `guardSpecLine`, `analyseSpecKeys`); users: `map.ts`/the handler, unit tests; axis: none — the slice's pure core, as
  `parse.ts` / `group.ts` / `map.ts` (`cat-import-1.md` § 8.6); rejected: rules inline in `group.ts`/`map.ts` (the
  golden comparison and the code/price oracles need the profile step as one seam).
- Facet module and the catalog-listing rule (membership, date window, sort, and the page path) moved to
  `packages/shared` — only under CIP1-PREVIEW = A (§ 8); users:
  renderer listing (`SitePage.tsx:294`, `:307`), admin preview; axis: none (one rule, two apps); rejected: a copy in
  admin (duplicates non-trivial logic; the preview would drift from the site).
- No interface, registry, adapter or config layer. The profile item is read with one `GetCommand` inside the handler.

---

## 4. NO-CODES / NO-PRICES — what is guaranteed, what is measured, what is not covered

Revision 0 claimed "extraction cannot carry a code or a price". That exceeded the mechanism (review-0 R1; witness
§ 9 E-14). This section separates three guarantees of different strength, names what none of them covers, and puts
the remaining choice to the human (CIP1-VALUE-GUARD, § 8).

### 4.1 G1 — structural (holds by construction)

- Columns 3 and 4 (prices) are never indexed (`parse.ts:36-37`; oracle 5 of `cat-import-1.md` § 8.2). Columns 2 and 5
  (codes) are read only inside `removeCodeLines` (`parse.ts:89`, `:109-117`). `GlamRow` (`parse.ts:40-52`) has no
  field for columns 2–5. The profile step runs on `GlamRow[]` after `parseGlamCsv` returns (§ 2.2).
- The profile schema (§ 3.2) has no column index and no free field reference: `grouping` and `collection` are closed
  enums over named `GlamRow` fields; spec keys are matched against cleaned spec lines only. **No profile can make the
  importer read the CELL of column 2, 3, 4 or 5.**
- What G1 does not say: anything about the CONTENT of the cells it does read (name, collection, specs, format).

### 4.2 G2 — same-row code removal (holds per row)

- A spec line that holds one of ITS OWN ROW's code cells (column 2 or 5, trimmed, non-empty) as a whole token is
  removed before any later stage (`parse.ts:109-117`, `cat-import-1.md` § 9 CI1-SPECS-CODES).
- What G2 does not cover (EXECUTED witnesses, § 9 E-14): a line that holds ANOTHER row's code (row 3
  `Alternate article: AAA-1`, where `AAA-1` is row 2's code, is kept); a code of another code system; any monetary text
  (`Price: 25 EUR` is kept).
- Pre-existing exposure (not created by profiles): today's prose publishes every cleaned line of the style's FIRST
  specs row (`map.ts:182`, `:207-208`), so a `Price: …` line or another row's code in that row is published today.
- Exposure a profile ADDS: (a) the union over rows (§ 2.5) publishes lines of the other rows, which today are not
  published (BOEN 22, ALPOD 260 line occurrences, § 9 E-15) — so "extraction only re-shapes text already published"
  is FALSE for those lines; (b) an extracted value becomes a filter value, shown on listing pages, not only on the
  product page; (c) under `collection: { kind: "spec" }` a spec value becomes a category name, part of a category slug
  and of every product slug of that collection, and the `colecție` value (§ 2.3).

### 4.3 G3 — the value guard on every spec line a profile selects (proposed; scope = CIP1-VALUE-GUARD)

Recommended scope (option B1 of CIP1-VALUE-GUARD). **Unit of the check: the whole spec line** — key and value — not the
value alone (a line `Price: 25` holds its price word only in the key; review-1 R1). **Where it runs:** on every spec
line a profiled import SELECTS for any destination, before the line feeds that destination.

| Destination derived from spec text | Source line | Guard |
|---|---|---|
| attribute value (stored, product page, filter value) | a line of an `attribute` key (§ 2.4) | G3; a refused line gives no attribute |
| collection → product key, product slug, child category name and slug, `colecție` value | the line of `collection.key` (§ 2.3) | G3; a refused line counts as absent → the sheet name |
| filter value, filter heading | the stored attribute above (heading = the human's label) | inherited from the rows above |
| dry-run `specKeys[].samples` (admin-only response; the caller holds the file) | lines of the file | only lines that pass G3 are sampled |
| prose (`description`, `longDescription`) | the first specs row, as today (minus `attribute` lines under CIP1-PROSE B) | **not guarded** (pre-existing, F-CIP1-5; option B2 would guard it) |

The checks:
1. **File-wide code check.** The line is refused when it contains, as a whole token (the `removeCodeLines` token rule:
   not preceded or followed by a letter or digit), any non-empty, trimmed column-2 or column-5 cell of ANY row of the
   file — any length. The code cells reach `profile.ts` only as an opaque set of strings built inside the parser
   (`codeTokens`, never a `GlamRow` field, never stored, never in the report).
2. **Monetary-text check.** The line is refused when, after NFC and case-insensitively, it contains a currency sign
   (`€`, `$`, `£`), or as a whole token a currency code (`eur`, `ron`, `usd`, `gbp`, `lei`) or a price word (`price`,
   `prices`, `preț`, `prețuri`, `pret`, `cost`).
3. A refused line is reported per key and row (`specKeys[].refused[]: { rowIndex, reason: "code" | "money" }`; the
   line is NOT echoed for `code`) in the dry run and the execution.

**What G3 guarantees — at the checked source boundary only.** Every spec line a profiled import selects, after the
same-row code removal and NFC, contains no column-2/5 cell of any row of the same file as a whole token (compared
case-sensitively, as `removeCodeLines` does) and no money-pattern token (compared case-insensitively). Stored TEXT
fields copied from a checked line without transformation inherit this: the attribute value, the category name and the
`colecție` value are parts of the checked line cut only at `:`, `,` or whitespace (the line grammar and the split rule,
§ 2.4); a cut there cannot turn part of a longer word into a whole token, because the character beside the cut is
already neither a letter nor a digit in the line.
**Explicitly excluded — transformed identifiers.** Every form COMPUTED from a checked value is outside the
token-absence guarantee: the normalised key component (`norm`: lower-case, NFC, `group.ts:25`), the category slug and
the product slug (`slugify`: lower-case, accents removed, punctuation dropped, `group.ts:34-43`), `TenantSlug`, and the
URL-encoded filter hrefs. Lower-casing and accent removal can CREATE a matching token. Witnesses (EXECUTED, § 9 E-20):
`Collection: Cóst` passes the source check (`cóst` is not the token `cost`) and gives the category slug `p-cost`;
`Collection: ABC`, with a same-file code cell `abc`, passes (the code check is case-sensitive) and gives `p-abc`.
Whether such identifiers get their own check is decision CIP1-VALUE-GUARD (T1 / T2, § 8).
**What G3 does not cover:** the transformed identifiers above; a code of a system that is not in columns 2/5 of the same file; a monetary form outside
the pattern (`25,-`, `12.50/m²` with no currency word); anything in COLUMN-derived fields — the name (column 1, and the
token `trailing-number` removes from it), column 0 under `collection: column` (ITC's price sentence, F-CIP1-1), the
variant labels of column 11; and the prose. Its false refusals: a harmless line with a listed word (`Cost class: A`),
or a line holding a short code cell as a token (a cell `12` refuses `Width: 12 mm` in the same file).

### 4.4 G4 — measured on the real files (EXECUTED, § 9 E-17)

Measured with exactly the G3 checks (whole lines; code cells of any length as whole tokens; the full money pattern)
over the cleaned specs of all files: 0 lines refused for a code (BOEN 801 code cells, all 8 characters; ALPOD 1,404
code cells summed per file, of which 6 have 3 characters and 22 have 4; ITC's code columns are empty in both files);
0 lines refused for money (ITC 3,113, BOEN 3,848, ALPOD 3,726 lines). So on today's files G3 refuses nothing — no false
refusal either, the short ALPOD codes included — and the union of § 2.5 publishes no code or money token. ITC's price
SENTENCE is in column 0, not in the specs; the `spec Collection` rule stops reading it (§ 2.3). An ITC import WITHOUT
that profile still makes it a category, as today (`cat-import-1.md` § 10, last line).

### 4.5 Oracles (owed by `cat-import-profile-1a`, § 7.3)

- O-CODES-1 (G1): the oracle-5 grep of `cat-import-1.md` § 8.2 prints exactly `parse.ts:32`, `:33`, `:37`.
- O-CODES-2 (G1): `grep -n "parseCsvRecords\|cells\[" "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend/src/import/glam/profile.ts"; echo "exit $?"` prints `exit 1` and nothing else: the profile module never sees a raw record.
- O-CODES-3 (G2 + G3, real data): the BOEN write-history code-hit oracle (`cat-import-1.md` § 8.3) re-run with a
  WORST-CASE profile that extracts every BOEN key as an attribute with `split: "comma"` → 0 hits outside the three
  image fields; positive control: a code planted in a written `attributes` value is found.
- O-CODES-4 (G3, negative, cross-row): synthetic file — row 2 code `AAA-1`, specs `Wood: Oak`; row 3 code `BBB-2`,
  specs `Wood: Oak` + `Alternate article: AAA-1`; profile extracts `Alternate article`. Expected under B1: no attribute
  `Alternate article`; `specKeys[].refused` names row 3, reason `code`; the written payloads contain no `AAA-1` outside
  image fields. Under A: the attribute is written (the oracle then documents the accepted exposure).
- O-PRICES-1 (G1): the existing integration assertion "no written item carries a monetary key" (`catalog-mode-1.md`
  § 3.4 "NO-CODES / NO-PRICES as a type guarantee") runs with the worst-case profile; `GlamStyleDraft` gains only
  `facetModes` and `importProfileRevision`, and the exact-key-set unit row is updated by those two members.
- O-PRICES-2 (G3, negative, monetary text): synthetic row with specs `Price: 25 EUR`, `Cost: 12 lei`, `Finish: €`
  (one per rule) and a profile that extracts all three keys → under B1 no attribute is written, each refusal reported
  with reason `money`; positive control `Wood: Oak` on the same row → written.
- O-PRICES-3 (G3, negative, collection destination): synthetic sheet `S`, row with `Price: 25 EUR` and
  `collection: { kind: "spec", key: "Price" }` → no category, slug or `colecție` value contains `25` or `EUR`; the
  product is in category `S`; the row is reported (`money`). Positive control: `Collection: Delight` → category
  `Delight`.
- O-PRICES-4 (G3, negative, money word in the KEY only): a line `Price: 25` selected as an attribute and, in a second
  profile, as the collection key → refused in both destinations (`money`); a line `Pricey look: yes` is NOT refused
  (whole-token rule).
- O-CODES-5 (G3, negative, cross-row code in the collection destination): row 2 code `AAA-1`; row 3 line
  `Series: AAA-1`; `collection: { kind: "spec", key: "Series" }` → row 3's collection is the sheet name; no category
  or slug contains `aaa-1`.
- O-TRANSFORM-1 (transformed identifier, money): synthetic producer `P`, line `Collection: Cóst`,
  `collection: { kind: "spec", key: "Collection" }` → not refused at the source; stored category name `Cóst`; category
  slug `p-cost`. Under T1 the row is the pinned, documented exclusion; under T2 the slug check refuses it and the row
  takes the sheet name.
- O-TRANSFORM-2 (transformed identifier, code): same setup, line `Collection: ABC`, a same-file column-2 cell `abc` →
  not refused at the source; slug `p-abc`. Under T1 pinned as excluded; under T2 refused (`code`).
- O-VALUE-1 (substring): every written attribute from a spec key is a substring of a kept line of one row of the
  style's cleaned specs (unit row over the three producers' files in memory).

---

## 5. Preview (decision CIP1-PREVIEW, § 8)

### 5.1 What the user sees before anything is written

In the admin's glam import dialog, after "Verifică":
1. **Cards** — the first 24 products of the file as cards (image, title; no price, as on the catalog site), with the
   count "N produse".
2. **One product page** — chosen from a list (default: the product with the most options): gallery from the options'
   images, the variant labels under the variant name, the attribute list as the site will show it (repeated keys
   joined, § 2.5), the prose (`longDescription`).
3. **The filter panel with counts** — for three base sets: the producer's parent category, one chosen collection
   category, and the SHOP after the import. Values clickable inside the preview (selection kept in the admin state),
   counts recomputed per click.
4. **The key table** — every spec key of the file with its measured facts (§ 3.5 `specKeys`) and its controls (label,
   split, `prose-only`, filter mode). Each change runs the dry run again, on demand ("Previzualizează").

### 5.2 The preview DTO and how the base sets are assembled (recommended A)

Revision 0 listed preview fields by hand and missed fields the readers use (review-0 R2: `brand`, `longDescription`,
`availableFrom`, `availableUntil`). Rule that closes the class: **each preview member is defined by the code that
consumes its data on the site, never by a hand-picked list.**

- **`drafts[]`** = for each planned product, the item the execution would write, built by the SAME function
  (`productItem`, `glam-pricelist.ts:449-485`, including its `checkProductWrite` derivation), with: `PK`, `SK`,
  `TenantSlug` removed; `id` = `preview:<slug>`; `categoryIds` = for each category key, the id the dry-run category
  lookup found (`idBySlug`, `glam-pricelist.ts:174`, `:374`) or `new:<slug>` for a category the import would create;
  timestamps = the dry run's time. So every field the site reads (`brand`, `title`, `description`, `longDescription`,
  `attributes`, `variants`, images, `status`, `availability`, `sortOrder`, `facetModes`) is present by construction.
- **`siteProducts[]`** = every product of the tenant except the previous set (the products this import replaces), with
  the union of the fields the two site readers read: the facet function (`brand`, `attributes`, `variants`, and
  `facetModes` after 1b) and the catalog-listing rule (`id`, `status`, `categoryIds`, `availableFrom`,
  `availableUntil`, `sortOrder`). The dry run already reads every product of the tenant (`glam-pricelist.ts:125`); only
  its projection grows, in the dry run only.
- **Base sets.** The renderer's `getCatalogListing` (`renderer/src/lib/dynamo.ts:388-418`) does I/O and then applies a
  pure rule: membership (shop: `status === "active"`; category: `!status || status === "active"` and `categoryIds`
  contains the id, `:410-412`), then `isProductAvailable` (`:75-81`, UTC day), then the sort by `sortOrder`, ties by
  `id` (`:417`). Under A, that rule moves to `packages/shared` as a pure function
  `catalogListing(items, categoryId | undefined, today)`, and both the renderer and the admin preview call it. The
  preview's three base sets are `catalogListing(siteProducts ∪ drafts, scope, todayUtc)` with scope = undefined (shop),
  the producer's parent category id, or the chosen collection's id. The panel is then
  `buildFacetListing(base, f, path)` (`facets.ts:316`), also from `packages/shared`.
- **Every input equals the public renderer's input** (rule that closes review-1 R2's class "same function, different
  inputs"): `path` is an input of the URL-budget rule (`facets.ts:263-266`, `:355-358`), so the preview passes, per
  panel, the exact string the renderer passes on the tenant's PUBLIC domain. There `basePath` is `""`
  (`renderer/src/app/[siteId]/[[...slug]]/page.tsx:46`); the category path is `${prefixes.category}/${slug}`
  (`SitePage.tsx:293`) and the shop path is `prefixes.shop || "/magazin"` (`SitePage.tsx:306`), with
  `prefixes = config.urlPrefixes || URL_PREFIX_DEFAULTS` (`SitePage.tsx:244`). Under A this path rule moves to
  `packages/shared` with the listing rule (`catalogListingPath(prefixes, scope)`), and both callers use it: the
  renderer prepends its `basePath`, the admin prepends `""`. The admin reads `urlPrefixes` from `GET /settings` (as the
  Settings page does, `admin/src/pages/Settings.tsx:89`). A new category's slug is its `categoryKey`. The `f` string is
  the canonical `formatSelection` of the preview's selection (`facets.ts:244-250`), the form the renderer's links carry.

### 5.3 Fidelity limits, stated

- *Data:* the drafts are exactly what the execution writes for the same file and profile, because the plan is a pure
  function of both (`planGlamImport`, `map.ts:140`) and the item is built by the same `productItem`. Limits: the
  execution re-reads under the lock — the previous set, the category conflicts and `siteProducts` are a snapshot of
  the dry run's time; products other users change meanwhile, or a date window that opens or closes between the dry run
  and the visit, are not reflected. Membership by date uses the UTC day, as the renderer does (`dynamo.ts:77`).
- *URL budget — exact for the public domain only.* The panel's `link` / `too-long` states are those of the tenant's
  public domain. The same pages reached through a preview path (`/_site/<id>/…`, base from the `amodx_preview_base`
  cookie, `renderer/src/lib/routing-server.ts:5-8`, passed by the dynamic route,
  `renderer/src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:56`) have longer hrefs, so a selection near the 6,144-byte
  budget (`facets.ts:41`) can be a `link` in the preview and `too-long` there. A tenant whose URL prefixes change after
  the dry run has other paths too.
- *Category panels:* exact for the snapshot, including hand-made products of an existing category (they are in
  `siteProducts` with the category's id). A category the import would create has only drafts as members — which is
  true on the site too. (Revision 0 stated that category panels used the file's products only; the `categoryIds` rule
  above closes that gap.)
- *Visual: approximate.* The cards and the product page are admin components, not the renderer's `SitePage`
  (separate apps); the tenant theme, fonts and layout are not applied. The panel's values, counts, order and
  visibility are exact for the snapshot and the public-domain path (the same functions, the same inputs); its look is
  not. The preview says so: "aspect aproximativ — datele și filtrele sunt exacte pentru adresa publică a site-ului".
- *Images:* the preview shows the producer URLs (the copy runs after the import, `cat-images-1.md` § 7 CIM-A1-1). BOEN's
  images do not display today in any browser (expired certificate, `cat-images-1.md` § 7) — the preview shows them
  broken; the site shows the copies or nothing.

### 5.4 Cost

Build: the move of the facet module and of the catalog-listing rule (two pure modules; their tests move with them;
`getCatalogListing` keeps its query and calls the shared rule); the admin preview components (cards grid, product
view, panel); the dry-run response members of § 3.5. Run: one dry run per "Previzualizează": the tenant read, category
lookups and one full product read (BOEN dry run 5.0 s cold, `cat-import-1.md` § 10). Response size (INFERRED from § 9
E-9): drafts ≤ 0.7 MB (ITC `Arc_Edition.csv`, whose drafts without the stored-only fields measure 0.60 MB) plus
`siteProducts` ≈ 1,900 products × the facet and listing fields ≈ 1–2.5 MB — inside the 6 MB Lambda response limit;
`1a` measures the real size on staging (§ 7.5 item 8). Nothing is written.

### 5.5 Preview units owed (`1b` for the shared rule, `1c` for the admin assembly)

`catalogListing` and the assembled base sets over one fixture with: a kept active product (on shop and in its
category); a kept `draft` product (on neither); a kept legacy product without `status` (NOT on the shop, ON its
category page — the two membership rules differ); a kept product with `availableFrom` tomorrow (on neither); a kept
product with `availableUntil` yesterday (on neither); a product of the previous set (absent: replaced); a draft in an
existing category (on the shop, in that category with the found id); a draft in a new category (`new:<slug>`, only in
that category). The panel built from the result shows the producer value from each draft's `brand`. The same
fixture through the renderer's `getCatalogListing` (in-memory store) gives the same members in the same order — the
proof that the preview and the site share one rule.

**Near-budget comparison (the path is an input).** Fixture: a category with a long slug and attribute values long
enough that one more selected value brings the page-1 href within 16 bytes (`PAGE_RESERVE`, `facets.ts:43`) of the
budget. Rows: (1) the admin's assembled panel with the public path deep-equals the renderer's `buildFacetListing`
output for the same base, `f` and `${prefixes.category}/${slug}`, value states included; (2) the same value is `link`
on the public path and `too-long` on `/_site/<id>` + that path — the stated limit, pinned; (3) with custom
`urlPrefixes` (`/categorie`), the admin path follows them.

### 5.6 Why not the renderer's preview of draft data (B)

`/_site/<id>/…` is always dynamic and shows drafts (`renderer/middleware.ts:248-262`), but only on the product page
(`SitePage.tsx:250`); the listings read `status === "active"` even in preview (`renderer/src/lib/dynamo.ts:289`,
`:410-412`), so cards and filters of draft products do not appear. Writing draft copies would also put a second
product item on each live slug in `GSI_Slug`; `getProductBySlug` takes the first match (`dynamo.ts:243`), so a preview
write could change what a LIVE product page shows. That is a write into the production tenant to answer a "what if"
question.

---

## 6. Flows

### 6.1 First import of a producer — the profile is proposed from the data

1. The user picks the file, types the producer and sheet. The admin sends a dry run WITHOUT `profileChoice`.
2. No profile is stored → `profile.source = "default"`; the plan is today's; `specKeys` lists every key with its facts;
   `sheets[]` lists this producer's existing sheets as `no-profile`.
3. The admin builds a PROPOSAL (pure function `proposeProfile(specKeys)` in the admin): every key → `attribute` with
   label = the key as written, `split: "none"`, no mode. Facts are shown as hints next to each key: "comma list in
   201 rows", "differs between options in 7 products", "equals the variant label on 258/310 rows", "one value only",
   "not offered by the repeat rule (82 values)". Grouping and collection stay at the default; hints say "531 of 536
   names end in a number" and "column 0 has one value; spec key `Collection` has 6". The proposal is not the default:
   nothing changes until the user accepts it.
4. The user edits labels and choices; "Previzualizează" sends a dry run with `profileChoice` (`baseRevision: null`).
5. "Importă" sends the execution with the same snapshot (the existing `confirmInput` rule,
   `GlamPricelistImport.tsx:118`). The profile is stored with `revision: 1` before the mutation phase (§ 6.6); every
   written product carries `importProfileRevision: 1`.

### 6.2 Re-import — the profile is reused

The dry run without `profileChoice` returns the stored profile, its revision and the sheet states. The admin loads it
into the editor; keys of the new file that the profile does not list are marked "not reviewed". If the user changes
nothing, the execution is sent with the stored profile as `profileChoice` and `baseRevision` = its revision; the
revision does not change (the saved profile is equal), and the sheet becomes `current`.

### 6.3 Profile change — a re-import is needed

Every effect of a profile is in the written products (§ 3.4). So a change takes effect for a sheet only when that sheet
is imported again. After an import with revision n, the dry run's `sheets[]` lists the producer's other sheets as
`stale` (revision < n), `no-profile` (imported before profiles) or `mixed`; the admin shows: "Aceste liste au fost
importate cu un profil mai vechi sau fără profil: … — importați-le din nou." A profile change cannot be saved without
an import (no save route, CIP1-STORAGE = A); the editor says so. Rejected: re-applying a profile to stored products
without the file — the products do not keep the raw spec lines as structured data, and the replace rule needs the
file.

### 6.4 Service-account import (MCP)

`import_glam_pricelist` (`tools/mcp-server/src/index.ts:1137`) sends no `profileChoice`, so the server applies the
stored profile of that producer (§ 3.5 "stored") — the same profile the admin saved. No new tool parameter is needed.
The tool's summary (`tools/mcp-server/src/tool-shapes.ts` `glamPricelistSummary`) gains: "Profil: <source>, revizia
<n>" and the sheets that are not `current`. The tool cannot change a profile. Named consequence: a dry run and its
execution through MCP each resolve the stored profile; if an admin import changes it between the two calls, the
execution uses the newer one and its summary says which revision it used.

### 6.5 Image copy

Unchanged. `POST /import/glam-pricelist/images` reads the set by `importSource` (`cat-images-1.md` § 7 CIM-A1-1). The
profile does not change `importSource` (producer + sheet). It changes which products exist and their option images:
the ITC regrouping puts 536 option images on 66 products; the copy rewrites option images per product
(`cat-images-1.md` § 2 item 4) as for any import. The copy's `UpdateCommand` sets only image fields, so
`facetModes` and `importProfileRevision` are kept (`cat-images-1.md` § 8.1 item 4).

### 6.6 The lock, the write order, failures and recovery

**Order in an execution** (one rule: the profile snapshot is stored BEFORE any product claims it):
1. tenant read (before the lock, as today, `glam-pricelist.ts:106-110`);
2. lock (`:130-135`);
3. category lookup (`:141`) and, next to it, the stored profile `GetCommand` — every read that decides an execution
   write is made under the lock (`cat-import-1.md` § 8.11 R1); the version check (§ 3.3) and the `profileChoice`
   acceptance rule (§ 3.5) are applied here; a refusal → 409, the lock released, nothing written;
4. new step `profile`: when the import is profiled (§ 2.8) and the profile to use differs from the stored one, one
   `PutCommand` of the profile item with the next revision, conditioned on the observed revision (or on
   `attribute_not_exists(SK)` when none was stored). One import per tenant at a time (the lock), so the condition
   fails only if the lock was lost; then 500, step `profile`;
5. the mutation phase as today (`:155-191`), every product stamped with that revision;
6. audit (`:195-202`), with `profileRevision` and `profileSource` in `details`; lock release in `finally`.

**Failures and recovery:**

| Failure | State after | Recovery |
|---|---|---|
| refusal at step 3 (version, `baseRevision`, invalid profile) | nothing changed | fix the profile / reload; nothing to recover |
| step 4 fails or its answer is lost | no product or category changed; the profile item MAY hold the new revision | try again with the same file and the same `profileChoice`: accepted by the "stored equals sent" clause (§ 3.5); the recovery text says "No product or category was changed; the profile may have been saved." |
| failure after the mutation phase starts (steps 5–6), or a 503 `incompleteCategories` | products partly replaced; the stored profile = the snapshot this import used | import the same file again with the same profile. **If no other import changed the producer's profile since the failure:** the admin re-sends its snapshot (accepted, equal); MCP sends none (stored = the same snapshot); both reproduce the same plan, and the sheet then shows `current`. **If another import changed it meanwhile:** see "Intervening import" below |
| dry run | nothing written (no lock, no profile write) | — |

**Intervening import (the lock does not hold between requests).** The lock serialises executions; it is released at
the end of each request (`glam-pricelist.ts:220-222`), so between a failed request and its retry another import of the
same producer (another sheet, another user, MCP) can store a different profile (revision m > n). Then:
- an MCP retry resolves the stored profile and imports with revision m — not the failed import's snapshot; its summary
  names revision m (§ 6.4);
- an admin retry with the old snapshot is refused (409: revision n ≠ m and content differs, § 3.5). The admin then
  reloads the stored profile (a dry run without `profileChoice`), shows both — "Profilul a fost schimbat de alt import
  (revizia m)" — and previews again. The user either imports with revision m, or re-applies the old snapshot by
  sending it with `baseRevision = m`: an explicit overwrite after seeing the preview, which makes the other import's
  sheets `stale`.
In both cases the result is a full replacement of the sheet, and its products carry the revision actually used.
Reproducing the failed import's exact plan is guaranteed only when no profile change intervened.

**What can disagree, stated (corrects revision 0's CIP1-STORAGE claim).** The stored profile and the products CAN
disagree: other sheets imported with an older revision or before profiles; a sheet whose import failed after the
profile write. The stamps detect the first two per sheet (`stale`, `no-profile`, `mixed`). A failed import whose
written products all carry the current revision but whose set is incomplete is NOT detectable from the stamps — the
same as today's partial failure, which the 500/503 answer reports at the time (`cat-import-1.md` § 2 item 6).

---

## 7. Impl outline (assuming the RECOMMENDED rulings of § 8)

### 7.1 Slices and allocation

**`cat-import-profile-1a` — backend + shared schema + MCP summary** (first; ships inert: no stored profile exists →
every import is as today).
- Step 0 — capture the backend golden from the base commit (§ 7.3).
- `packages/shared/src/index.ts`: `GlamImportProfileSchema`, `FacetModesSchema`, `ProductSchema.facetModes`,
  `ProductSchema.importProfileRevision`.
- `backend/src/import/glam/parse.ts`: `parseGlamCsv` also returns the file's opaque code-token set for the value guard
  (B1); `GlamRow` unchanged.
- `backend/src/import/glam/profile.ts` (new, pure): `checkProfile`, `applyProfileToRows`, `extractAttributes`,
  `guardSpecLine`, `analyseSpecKeys`.
- `backend/src/import/glam/map.ts`: `planGlamImport` takes the profile; `GlamStyleDraft` gains `facetModes?`,
  `importProfileRevision?`.
- `backend/src/import/glam-pricelist.ts`: `profileChoice` parse/validate; stored read (dry run + under the lock); the
  acceptance rule and version refusal; step `profile` before the mutation phase; stamps; sheet discovery; response
  members of § 3.5; dry-run projection; `drafts[]` via `productItem`.
- `backend/src/products/create.ts`, `update.ts`: `facetModes: true, importProfileRevision: true` in the omit lists.
- `tools/mcp-server/src/tool-shapes.ts`: the summary line (no route change → `routes.json` unchanged).
- Tests: `backend/test/unit/glam-profile.test.ts` (new), `glam-import-core.test.ts`, `glam-import-handler.test.ts`
  (over `backend/test/unit/memory-table.ts`); MCP `test/tool-shapes.test.ts`; docs `backend/ARCHITECTURE.md`,
  `tools/mcp-server/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md`.

**`cat-import-profile-1b` — shared listing + facet rules, renderer precedence and display** (after or beside 1a; inert
until a product carries `facetModes`).
- Step 0 — capture the facet/listing golden from the base commit (§ 7.3).
- Move `renderer/src/lib/facets.ts` → `packages/shared/src/facets.ts`; extract the pure membership/date/sort rule of
  `getCatalogListing` (`dynamo.ts:410-417`) and `isProductAvailable` (`:75-81`, `today` injected) into
  `packages/shared/src/catalog-listing.ts`, together with the page-path rule `catalogListingPath(prefixes, scope)`
  (`SitePage.tsx:293`, `:306`); all exported from the package index; the renderer imports them.
  `renderer/test/unit/facets.test.ts` moves to `packages/shared/test/`.
- The `facetModes` rules of § 2.6 (the ratified `never` option) in `facetValuesOf` / `facetDefs` /
  `buildFacetListing`.
- `renderer/src/lib/dynamo.ts:402-403`: the catalog listing projection gains `facetModes`.
- `renderer/src/components/SitePage.tsx:800-813`: repeated keys shown as one row, values joined by ", ".
- Serving-contract rows (`renderer/test/serving-contract/`): a catalog fixture with `facetModes` (always / never /
  variant never, and the mixed witness of § 2.6); the non-catalog byte-identity rows unchanged. Docs:
  `renderer/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md`, `docs/caching-architecture.md` only if a serving row
  changes meaning.

**`cat-import-profile-1c` — admin: editor, proposal, preview** (after 1a and 1b).
- `admin/src/components/GlamPricelistImport.tsx` (or a sibling component file if the file passes ≈ 800 lines): the
  profile editor state inside the existing reducer (every edit bumps `revision` and withdraws the report, as today,
  `:80`), `proposeProfile`, the preview (cards, product, three panels via the shared functions with the public paths
  from `GET /settings` `urlPrefixes`, § 5.2), sheet states, the `unsupported` profile state (§ 3.3).
- Tests: `admin/src/components/GlamPricelistImport.test.ts` (reducer rows: edit withdraws the report; confirm sends the
  previewed profile and `baseRevision`; proposal rows over BOEN's measured `specKeys`; the assembly and near-budget
  rows of § 5.5; the 409 → reload → re-preview path of § 6.6).

### 7.2 Oracles (each slice report quotes exact commands; bare exit codes)

```
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run build; echo "exit $?"
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run typecheck; echo "exit $?"
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/shared" && npm test; echo "exit $?"
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend" && npm run test:unit; echo "exit $?"
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm test; echo "exit $?"
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving; echo "exit $?"
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/admin" && npm run test:unit; echo "exit $?"
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/tools/mcp-server" && npm test; echo "exit $?"
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/infra" && npm test; echo "exit $?"
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check; echo "exit $?"
```
(Script names OBSERVED in each `package.json` on `bacdd86`: shared `test`, backend `test:unit`, renderer `test` and
`test:serving`, admin `test:unit`, MCP `test`; infra `test` per `cat-import-1.md` § 8.2 oracle 8.) Plus the § 4.5
oracles and the golden comparisons of § 7.3. Each slice reports every command with its exit code; 1a additionally
states that `infra` synth is unchanged (no route, no function).

### 7.3 Preservation — baseline-backed (golden captured from the base commit)

Rule (closes review-0 R5's class "preservation proven by comparing two new code paths"): **every preservation claim
is checked against output captured by the UNCHANGED code of the base commit; equality between two new paths is never
used as proof.**

- **1a golden.** Before any edit: `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" worktree add "/tmp/CAT-IMPORT-PROFILE-1A-baseline" <base commit>`; in it, a capture script (kept in the slice's
  test directory) runs today's `planGlamImport` and today's handler over the in-memory table for each input: the BOEN
  fixture (`backend/test/unit/fixtures/glam/boen-PL.csv`), and synthetic files covering duplicates, empty labels, a
  quoted comma, a same-row code line, a cross-row code line and a `Price:` line. It writes the complete plans and the
  complete write history (every payload of every command, in order) with ids, variant-group ids and timestamps
  replaced by placeholders in order of first appearance, to
  `backend/test/unit/fixtures/glam/cat-import-profile-1-baseline.json`. The worktree is removed afterwards; the
  report records the base commit and the file's sha256.
  Units: the NEW code with (a) no `profileChoice` and no stored profile, and (b) `profileChoice = DEFAULT_PROFILE`
  with no stored profile, must each produce plans and write histories deep-equal to the golden (same masking), and
  write no `IMPORTPROFILE#` item. `cat-import-1-expected-counts.json` stays unchanged.
- **1b golden.** Before any edit, from a base worktree (`/tmp/CAT-IMPORT-PROFILE-1B-baseline`): the outputs of today's
  `buildFacetListing` over every input of `renderer/test/unit/facets.test.ts` plus the cat-facets serving fixtures, and
  of today's `getCatalogListing` over a listing fixture (in-memory store), written to
  `packages/shared/test/fixtures/cat-import-profile-1b-baseline.json`. After the move and the precedence change, the
  shared functions over the same inputs (no product carries `facetModes`) must give deep-equal outputs; the serving
  suite's existing rows (incl. `cm1-*` byte identity and `cf1-*`) pass unchanged.

### 7.4 Units owed (beyond § 4.5, § 5.5 and § 7.3)

- **Grouping (1a):** `Altona UX Altona 34` → title `Altona UX Altona`, label `34`; `SR Lumen AB` unchanged; a one-token
  name `34` unchanged; `trailing-number` + `format-column` keeps column 11; the existing `x, x, x (2)` and `#1, "", ""`
  label rows still pass after the rule.
- **Collection (1a):** spec value used; row without the key → sheet name; the price sentence absent from every written
  field when the rule is on.
- **Extraction (1a):** first-colon split (`a: b: c` → key `a`, value `b: c`); empty value → nothing; comma split with
  empty parts; union in file order with `norm` dedupe; `prose-only` vs unlisted (same output, different analysis
  state); refused profiles (label = `colecție`, duplicate spec key, collection key also in `specKeys`, one key both
  `always` and `never`, unknown version → 409).
- **Handler (1a):** stored vs explicit vs default; acceptance rule (`baseRevision` equal → accepted; differs but
  content equal → accepted; differs and content differs → 409, nothing written, lock released); the profile written
  before the first product write (write-history order); step `profile` failure → 500 "no product or category was
  changed", retry accepted; failure after the mutation phase → the retry with the same snapshot reproduces the golden
  plan of that profile; stamps on every product; sheet states `no-profile` / `current` / `stale` / `mixed`; dry run
  writes nothing.
- **Versioning (1a):** a stored profile with an unknown key, an unknown enum value or `version: 2` → parse refused
  (never stripped); dry run `profile.source = "unsupported"` with the stored revision and reason; execution without
  `profileChoice` → 409, nothing written; explicit replacement with `baseRevision` = the stored revision → accepted,
  revision + 1; with another `baseRevision` → 409.
- **Intervening import (1a):** failed import with revision n; another import stores m; admin retry with snapshot n and
  `baseRevision` n → 409; the same snapshot with `baseRevision` m → accepted; MCP-style retry (no `profileChoice`)
  → applies m and reports it.
- **Facets (1b):** a product whose `facetModes` holds an unknown value is treated as automatic (§ 3.3 item 6);
  the tables of § 2.6 row by row for the ratified `never` option, including the mixed-producer
  witness; plus the golden rows of § 7.3.

### 7.5 Staging evidence (operator-run, real files, tenant `cm1-catalog`, before the prod GO)

1. BOEN `PL.csv` without a profile → the report equals `cat-import-1.md` § 10 (437 / 455 / 23 / 0); no
   `IMPORTPROFILE#` item written by the dry run or the execution; no product carries `importProfileRevision`.
2. BOEN with the human's profile → 437 products; attributes on 280; `/category/boen` panel: the chosen keys with counts
   equal to independent counts (`aws dynamodb query`, as in `cat-facets-1-impl.md` closeout); `Certificates` not shown
   when marked `never`; a product page with `Format` holding two values shows one joined row.
3. ITC `Arc_Edition.csv` + `ITC.csv` with the ITC profile → 66 + 44 products, 536 + 44 options, categories ITC + 6
   collections + `Arc_Edition` + `ITC`; no written field contains "Prices in EUR"; `/category/itc` panel without
   `varianta`; the image copy then reports per source as in `cat-images-1.md` § 10.
4. ALPOD (all 21 sheets, the ALPOD profile) → 915 products (grain unchanged); `/shop` with `colecție` `always`: the
   facet shown with its values, closed by default.
5. MCP: `import_glam_pricelist` dry run for BOEN → summary names `stored, revizia <n>`; counts equal the admin's.
6. Re-import of one ALPOD sheet after a label change → the dry run lists the other 20 sheets as `stale`.
7. Layer 2 byte identity for commerce + content tenants, as in `cat-facets-1-impl.md` closeout item 5 (1b changes the
   renderer).
8. The size of the largest dry-run response (ALPOD sheet on a tenant with all three producers) recorded.

---

## 8. Decisions

```
DECISION_REQUIRED:
- ID: CIP1-STORAGE
  QUESTION: Where are profiles stored, who may change them, and how does a change get saved?
  PROBLEM: A profile must survive between imports and be the SAME for the admin and for a service-account (MCP)
    import. The importer runs under a per-tenant lock and has a rule that every read deciding a write happens under
    that lock. A separate "save profile" action adds a route (the parent stack is ≈ 467/500 resources after
    cat-images-1, `cat-images-1.md` § 8.2 oracle 5) and a second writer that is not under the lock. A profile stored
    anywhere the renderer reads on every page (TenantConfig) costs every public render bytes it does not use.
  OPTIONS:
  - A: One item per tenant + producer (`TENANT#<t>` / `IMPORTPROFILE#glam#<producer>`), written ONLY by an import
    execution, under the lock, BEFORE the mutation phase; each written product stamped with `importProfileRevision`.
    REWARD: no new route, function, IAM or infra; one writer, serialised by the existing lock; MCP applies the stored
    profile by default; the stamps show per sheet whether it was made with the current revision, an older one, none,
    or a mix (§ 3.4); a failed import leaves its snapshot stored, so "import the same file again" reproduces it when no
    other import changed the profile in between (otherwise a 409 and a re-preview, § 6.6 "Intervening import").
    RISK: the stored profile and the products CAN disagree (other sheets stale; a failed import after the profile
    write) — detected per sheet by the stamps, except an incomplete set whose written products all carry the current
    revision (as today's partial failure, reported by the 500/503 answer); a profile cannot be saved without
    importing (an edited draft is lost when the dialog closes); a retry after an intervening import of the same
    producer uses (MCP) or must re-preview against (admin) the newer profile; roles = the import's roles (TENANT_ADMIN, EDITOR,
    service key `catalog:write`); one more optional field on products.
  - B: The same item plus a `PUT /import/glam-profiles/{producer}` route with a revision condition.
    REWARD: save without import; a profile can be prepared before the file is final. RISK: +3 parent-stack resources
    (route, integration, permission); a second writer outside the lock (needs its own conditional write); more stored
    states that differ from the site (saved but never imported), still needing the stamps.
  - C: Inside TenantConfig (`PK SYSTEM`, `SK TENANT#<t>`, `catalog-product.ts:23`).
    REWARD: one record per tenant. RISK: every public render reads it (bytes with no public use); `PUT /settings`
    must preserve a server-owned member; a settings save invalidates the site; mixes import mechanics into the site
    config.
  - D: In glamCRM pl-tools vendor config.
    REWARD: next to the data preparation. RISK: contradicts the human ruling ("an amodx import profile, chosen in
    admin"); no admin preview; amodx imports without glamCRM lose it.
  RECOMMENDED: A — the smallest design that keeps one writer under the existing lock, makes MCP parity automatic and
    makes divergence visible per sheet; B can be added later if "save without import" is asked for.
  BLOCKING_REASON: the storage decides the request shape (§ 3.5), the write order (§ 6.6) and whether 1a changes infra.

- ID: CIP1-PREVIEW
  QUESTION: How is the preview (cards, one product page, filter panel with counts) produced?
  PROBLEM: Admin and renderer are separate apps. The renderer's preview path shows draft PRODUCT PAGES but its
    listings read active products only (`dynamo.ts:289`, `:410-412`), and writing draft copies of a file into the live
    tenant would put a second item on live slugs (`GSI_Slug`, first match wins, `dynamo.ts:243`). The dry run writes
    nothing and returns a report without attributes today (`glam-pricelist.ts:579-586`).
  OPTIONS:
  - A: Admin renders the dry-run plan; drafts built by the execution's own `productItem`; the base sets assembled by the
    renderer's listing rule and the panel by the renderer's facet function, both moved to `packages/shared` (one
    implementation, two callers) — § 5.2.
    REWARD: nothing written; data, membership (status + date window + category) and filter behaviour exact for the
    snapshot and the tenant's public-domain path (the same functions with the same inputs, path included). RISK: URL-
    budget states can differ on the longer preview path `/_site/<id>/…` (§ 5.3); visual fidelity approximate (admin components, no tenant theme); two pure modules move between
    packages (renderer import paths change; `packages/shared` gains them next to `slug.ts`); larger dry-run responses
    (≈ 1–3 MB, INFERRED, measured on staging).
  - B: Write the plan as draft products and open `/_site/<id>/…`.
    REWARD: real renderer for the product page. RISK: listings and filters do not show drafts (renderer change needed);
    second items on live slugs can change live pages; cleanup of the drafts; images; a write for a "what if".
  - C: A renderer route that renders a posted plan.
    REWARD: real renderer components for all three views. RISK: a public app that renders arbitrary posted product
    data (needs signing/auth); a new cross-app contract; the largest build.
  - D: Import into a scratch catalog tenant and preview it with `/_site/<scratch>/…`.
    REWARD: full fidelity, real writes, real image copy. RISK: a tenant per preview (99-tenant ceiling), created by a
    GLOBAL_ADMIN only, theme not the real tenant's; slow (a real import per edit).
  RECOMMENDED: A — exact data, membership and public-domain filter behaviour at the lowest risk; the visual gap and the
    preview-path budget limit are stated in the UI ("aspect aproximativ — datele și filtrele sunt exacte pentru adresa
    publică a site-ului").
  BLOCKING_REASON: decides slice 1b's module moves and slice 1c's whole scope.

- ID: CIP1-FILTER-PRECEDENCE
  QUESTION: How does a profile's filter choice override the renderer's repeat rule (ruling CF1I-COLLECTION-CAP = C),
    and what does `never` do to matching?
  PROBLEM: The renderer offers an attribute key only when ≥ 2 products hold it, its top value is held by ≥ 2, and it has
    ≤ 40 values. That hides `colecție` on the shop (147) and shows useless one-value keys on BOEN (157 products without
    specs). The renderer must learn the profile's choice, and two producers on one shop page may choose differently
    for the same key. A `never` choice can also change WHICH products a selected filter lists — not only whether the
    filter is offered (witness § 2.6: a BOEN product that shows "Esență: Oak" can leave the "Oak" listing).
  OPTIONS:
  - Storage of the choice:
    - S-A: the importer copies the modes onto each product (`facetModes`, importer-owned). REWARD: no extra read on
      the public path; inert for every product without the field; one optional schema member. RISK: a mode change
      needs a re-import (as labels do, CIP1-LABELS); the listing projection grows by one small field.
    - S-B: a tenant-level key → mode map in TenantConfig. REWARD: one decision per facet for the site; no re-import.
      RISK: a second writer to the tenant record; settings invalidation per change; the choice no longer lives "in
      the profile per producer".
    - S-C: the renderer reads the profile items at render time. REWARD: changes apply without re-import. RISK: an extra
      query on every catalog listing render (filtered views are not cached, `cat-facets-1.md` § 5.3); a merge rule
      across profiles; the renderer depends on an import artefact.
    - S-D: no override; the repeat rule decides alone. REWARD: no renderer change. RISK: does not satisfy ruling C.
  - Meaning of `never` (with S-A, § 2.6):
    - N1 value suppression: silent holders' values are removed from offer, listing, matching and counts. REWARD:
      `never` fully removes a producer's values from the panel and its counts. RISK: a product can disappear from a
      filtered listing while its page shows the selected value (b1 in the witness) — the listing contradicts the
      product page.
    - N2 offer suppression, matching kept: silent holders do not create an offer or a listed value, but match a
      selection and count in listed values. REWARD: a selected value always lists every product that shows it; no
      contradiction with the product page; `never` still hides ITC's 131 colour numbers and BOEN's one-value keys.
      RISK: counts of a listed value include products of a producer that chose `never` for that key (Oak (3), not 2).
    - N3 key veto: any silent holder hides the facet on that base set. REWARD: simplest rule. RISK: one producer's
      choice removes another producer's wanted filter on mixed pages (the shop); `always` and `never` then conflict.
  RECOMMENDED: S-A with N2 — no extra public read, no cross-producer conflict, and no filtered listing that contradicts
    a product page; `always` overrides the repeat rule as in § 2.6.
  BLOCKING_REASON: ruling C requires this rule to be ratified before 1b; N1/N2/N3 give different listings (§ 2.6 table).

- ID: CIP1-LABELS
  QUESTION: Are Romanian labels stored on the products (as the attribute key), or applied at render?
  PROBLEM: The file's keys are English and producer-specific; the site needs Romanian labels and merged keys. If the
    label is stored, a label change needs a re-import of every sheet of that producer (ALPOD: 21). If it is applied at
    render, the renderer needs a label map on every render and the product item is no longer self-describing (the
    interest list, the product page and the facets all read `attributes` directly).
  OPTIONS:
  - A: Stored: `attributes.key` = the label; the sheet states (§ 3.4) list the sheets to re-import.
    REWARD: no renderer read, no schema change of `attributes`, merges are automatic (same label = same key), every
    reader unchanged. RISK: a label change = re-import of each sheet; filtered links with the old label match nothing
    (canonical is the bare path, so SEO is not affected).
  - B: Raw keys stored; a tenant label map applied by the renderer.
    REWARD: label changes are instant. RISK: renderer reads the map on every catalog render; facet ids and labels split;
    the product page, interest list and facets all need the map; merges need the map in every reader.
  - C: Both on each attribute (`{ key, label, value }`).
    REWARD: raw key kept for later re-labelling. RISK: shared schema change of `attributes`; every reader must choose
    which field to show; still needs a re-import to change the label.
  RECOMMENDED: A — the catalog is disposable and replace-per-file is the designed update path (BOEN re-import 10.8 s,
    `cat-import-1.md` § 10).
  BLOCKING_REASON: decides the product item shape (§ 3.4) and whether the renderer needs a new read.

- ID: CIP1-ALPOD
  QUESTION: Ship the ALPOD profile without Decor, or wait for PL-TOOLS-2?
  PROBLEM: ALPOD's storefront grain (Model + Decor) needs a Decor value that the enriched files do not contain
    (pl-tools drops it upstream, `pl-tools-2.md` § 9). No amodx rule can recreate it. Today ALPOD imports type-level
    styles: 915 products, 1,503 options, all labels generated (`cat-facets-1.md` § 2.2).
  OPTIONS:
  - A: Ship now: ALPOD gets spec extraction, labels and filter modes (`installation_method`, `installation_system`,
    `type_of_material`); grain unchanged.
    REWARD: ALPOD filters now; no wait on another repo. RISK: ALPOD products stay type-level with `#n` options until
    PL-TOOLS-2; a second re-import later; the same profile carries over ONLY IF PL-TOOLS-2 puts Model + Decor into
    `produs` (column 1) in the 12-column layout (§ 2.1 prerequisite) — another delivery needs a profile change.
  - B: Wait for PL-TOOLS-2 before any ALPOD profile.
    REWARD: one ALPOD import at the right grain; the delivery format is known before the profile is made. RISK: ALPOD
    filters wait on glamCRM work that is deferred (`pl-tools-2.md` § 6).
  RECOMMENDED: A, with the prerequisite recorded for PL-TOOLS-2: deliver Model + Decor inside `produs`, as its
    § 3 item 2 already says. PL-TOOLS-2's remaining duties, named only: ALPOD Decor into `produs`; BOEN image
    addresses (`pl-tools-2.md` § 7). ITC's collection column becomes optional for PL-TOOLS-2 (the profile covers
    531/536 rows, the rest falls back to the sheet name, § 2.3) — the human decides whether PL-TOOLS-2 keeps it.
  BLOCKING_REASON: decides the staging evidence of § 7.5 item 4 and the PL-TOOLS-2 re-scope.

- ID: CIP1-VALUE-GUARD
  QUESTION: What protection against codes and prices applies to the spec lines a profile selects (attributes and the
    collection), and to the prose?
  PROBLEM: The mechanisms that exist today remove only lines holding the SAME row's code and never read the price
    columns (§ 4.1–4.2). They do not detect another row's code or any monetary text inside the specs; today's prose
    already publishes such text if it is in the style's first specs row. A profile widens this in three ways: the union
    over rows publishes lines no page shows today (BOEN 22, ALPOD 260); extracted values become filter values on
    listing pages; and a spec-sourced collection becomes category names, slugs and the `colecție` value. On today's
    files nothing is affected (measured with the exact checks, § 4.4); the question is what is GUARANTEED for the next
    file. The packet also promises that an import without a profile is byte-identical to today, which forbids changing
    the prose rule for such imports.
  OPTIONS:
  - A: No new guard; the guarantee is G1 + G2 + the measured G4; the residual exposure is recorded.
    REWARD: smallest change; byte identity untouched. RISK: a future file with a price line or a cross-row code in its
    specs publishes it as an attribute, a filter value, or (via `collection: spec`) a category name and slug.
  - B1: The guard of § 4.3 (whole line; file-wide code tokens of any length + money pattern) on every spec line a
    profile selects — attribute lines and the collection line; the prose unchanged.
    REWARD: every spec line a profile selects is checked at the source, key and value; the stored text fields copied
    unchanged from a checked line (attribute values, category names, `colecție`) hold no same-file column-2/5 cell and
    no money-pattern token as a whole token (§ 4.3, bounded claim); byte identity holds (no profile → nothing selected
    → guard not run); refusals reported per row in the dry run. RISK: not covered — transformed identifiers (normalised
    key, category and product slugs, `TenantSlug`, URL-encoded hrefs: `Collection: Cóst` → `p-cost`, `Collection: ABC`
    with a same-file code `abc` → `p-abc`; see T1 / T2), codes of other systems, money forms outside the
    pattern, every column-derived field (name, the removed name token, column 0 under `collection: column` — ITC's
    price sentence, column 11 labels), and the prose (F-CIP1-5); false refusals of harmless lines with a listed word or
    a short code token (none on today's files, § 4.4).
  - B2: B1, plus the same file-wide code removal and money-line removal applied by the parser to the prose of EVERY
    import.
    REWARD: also covers the prose. RISK: as B1 for column-derived fields; breaks the byte-identity promise for inputs
    that hold such lines (none of today's files: § 4.4); changes `cat-import-1`'s ratified CI1-SPECS-CODES rule (same
    row) — needs that ruling amended.
  - Transformed identifiers (applies under B1 or B2):
    - T1 — exclude them explicitly: the guarantee stops at the checked source line and the text fields copied from
      it; normalised keys, slugs, `TenantSlug` and URL-encoded hrefs are listed as not covered; O-TRANSFORM-1/2 pin the
      result. REWARD: no extra check, no new refusal path, no second fallback; the visible TEXT (category names,
      attribute and filter values) is covered. RISK: a URL — a category or product slug, in links and the sitemap —
      can hold a money word or a same-file code in folded form (`p-cost`, `p-abc`).
    - T2 — check the final values: after `norm` / `slugify`, check each derived identifier against the slugified code
      cells and the slugified money words, as whole tokens between `-` separators; a hit refuses the source line (→ the
      sheet name). REWARD: the token-absence guarantee extends to URLs. RISK: the sheet-name fallback must pass the same
      check (a sheet named `Cost` fails too → a second fallback or a row refusal is needed); the product slug also holds
      column-derived parts (producer, name), so a hit can come from outside the profile's selection — the rule must say
      whether that refuses the row; more false refusals (folding widens matches, e.g. a short code cell `12`); the check
      must change with `slugify` (`group.ts:34-43`) every time `slugify` changes.
  RECOMMENDED: B1 with T1 — it checks every spec line the profile selects, at the source, and guarantees the visible
    text copied from it, with every transformed identifier named as not covered; T2's fallback and mixed-source rules
    add more policy than the exposure it removes; B2 stays available as a follow-up decision on the prose;
    column-derived fields stay as today (named, F-CIP1-1). Neither reopens a ratified rule or the byte-identity promise.
  BLOCKING_REASON: decides `profile.ts` and the parser's output in 1a, and oracles O-CODES-4/5, O-PRICES-2/3/4,
    O-TRANSFORM-1/2.

- ID: CIP1-VALUE-MAPPING
  QUESTION: Should the profile also translate or unify VALUES (not only keys)? This scope was never mentioned.
  PROBLEM: Labels become Romanian, values stay English as in the file (`Oak`, `Floating`, `suitable`). A merge across
    producers shows both spellings (`T/G` and `Tongue+groove`). The DoD of this design lists key labels, merges,
    splitting and keys kept out of attributes — not values.
  OPTIONS:
  - A: Not in these slices; values shown as in the file; a follow-up `cat-import-values-1` if wanted.
    REWARD: smallest scope; values remain checkable against the producer's sheet. RISK: mixed-language rows
    ("Esență: Oak"); merged facets with near-duplicate values.
  - B: Add a per-key value map (`{ from, to }[]`) to `attribute` rules in 1a.
    REWARD: Romanian values and clean merges. RISK: more profile surface to edit and review; the map must be kept for
    every new value in later files (the dry run would list unmapped values).
  RECOMMENDED: A — surface, do not build; decide after the human sees the preview with real values.
  BLOCKING_REASON: changes the profile schema (§ 3.2) if B.

- ID: CIP1-PROSE
  QUESTION: When a spec line becomes an attribute, does it stay in the product's prose?
  PROBLEM: Today the spec lines of the style's first specs row are prose (`longDescription`, and the first ~300
    characters as `description`, used on cards and in SEO meta). After extraction the product page shows the same
    fact twice: "Wood: Oak" in the prose and "Esență: Oak" in the attribute list.
  OPTIONS:
  - A: Keep the prose as today.
    REWARD: no change to description/SEO text; nothing lost. RISK: visible duplication, two languages for one fact.
  - B: Remove from the prose the lines of keys with action `attribute`; `prose-only` and unlisted keys stay.
    REWARD: each fact shown once, in its labelled form. RISK: `description` (card/SEO text) changes and can become
    empty for a product whose every line was extracted; a line refused by the value guard (§ 4.3) stays in the prose
    (the guard does not touch the prose under B1).
  RECOMMENDED: B — one presentation per fact; byte identity is unaffected (it applies only to imports without a
    profile, § 2.8).
  BLOCKING_REASON: changes `mapStyle`'s description rule in 1a.
```

### 8.1 Builder decisions (local, recorded, not asked)

- B-1 Names: `GlamImportProfile`, `facetModes`, `importProfileRevision`, `profileChoice`, `baseRevision`, `prose-only`,
  `IMPORTPROFILE#glam#`. Each states its contract (`facetModes` = the modes the renderer applies to this product's
  facet values; `importProfileRevision` = the profile revision the product was written with; `prose-only` = not an
  attribute, the text stays published).
- B-2 First-colon split for spec lines (a value may contain `:`; a key never does in the measured data).
- B-3 Collection fallback = the sheet name (§ 2.3); rejected: column 0, skip.
- B-4 `revision` changes only when the saved profile differs (canonical JSON compare), so a plain re-import does not
  make other sheets look stale.
- B-5 `always` = any holder in the base set forces the offer (§ 2.6). The meaning of `never` is NOT a builder decision:
  three options are put to the human (CIP1-FILTER-PRECEDENCE). (Revision 0 called its rule "the only
  order-independent rule"; that was false — § 10.)
- B-6 No "auto" value is stored: absence is automatic (one representation of absence).
- B-7 The profile item is written before the mutation phase, so no product ever claims a revision that was not stored
  first (§ 6.6).

### 8.2 Findings outside this slice (named, not fixed)

- F-CIP1-1: an ITC import today (without a profile) makes the price sentence a category and a `colecție` value —
  already named in `cat-import-1.md` § 10; this design gives the fix (§ 2.3) but does not apply it to imports without
  a profile.
- F-CIP1-2: 157 of 437 BOEN products have no spec sheet (and 157 have no image — INFERRED same rows, not checked); the
  storefront shows them with prose-less pages.
- F-CIP1-3: the facet panel lists every value of an offered facet; a 147-value `colecție` relies on the closed
  `<details>` (`cat-facets-1.md` § 6). A "show more" control is not designed.
- F-CIP1-4: the 4 ITC styles with a repeated colour number get `<n> (2)` labels (9 options) — whether these are two
  different articles or a file duplicate is for the human to check in the preview.
- F-CIP1-5: pre-existing — today's prose publishes every cleaned line of a style's first specs row, with no check for
  another row's code or for monetary text (§ 4.2; witness § 9 E-14). Not created by this slice; option B2 of
  CIP1-VALUE-GUARD would close it.

---

## 9. Evidence log (builder, 2026-10-30)

Measurement scripts are kept, replayable, in the relay's gitignored directory
`.agent-manager/slices/CAT-IMPORT-PROFILE-1/measure/`: `union.mts` (sha256 `5b81fa1e…bdcd7`, output `union.out.json`
`2ed07e52…34e1`) — revision 2, the union rule of § 2.5 and the exact G3 checks of § 4.3; `replay.mts` (`c2ffc192…6f4c33`,
output `replay.out.json` `f3090e31…96a2`; copies `replay.rev1.*`) — row/product counts, ITC simulation, BOEN columns;
`r1-witness.mts` (`5c38105489…2318`, output `r1-witness.out`). **`replay.mts`'s per-key statistics (`keys.*`) and its
`residue` are superseded:** they record only each product's first value and count holders with an empty value, and the
residue used a narrower pattern (review-1 R8); every per-key number and every residue number in this document comes
from `union.mts`. Replay from the repo root:
`node_modules/.bin/tsx .agent-manager/slices/CAT-IMPORT-PROFILE-1/measure/union.mts "$PWD" "/Users/apple/Documents/APLICATII BIJUTERIE/glamCRM/pl-tools/out"` (same arguments for `replay.mts`). Both import the repo's own
`backend/src/import/glam/{parse,group,map}.ts` and read the enriched files only. Revision 0's scratch scripts
(`/tmp/CAT-IMPORT-PROFILE-1-measure/`, deleted) gave the same numbers except where E-2 and E-10 state a definition
change.

| # | Command | Result line | Label |
|---|---|---|---|
| E-1 | `git rev-parse --short HEAD`; `git status --porcelain -uall` | `bacdd86`; before revision 0: empty; before revision 1: `?? docs/slices/cat-import-profile-1.md` only | EXECUTED |
| E-2 | `replay.mts` — keys per producer, product grain, repeat rule | exit 0; ITC 580 rows / 576 products / 580 options, 3,113 lines, 0 other; BOEN 478 / 437 / 455, 3,848 lines (after code removal), 0 other; ALPOD 1,803 / 915 / 1,503, 3,726, 0 other; styles with specs: ITC 527, BOEN 280, ALPOD 345 (per-key numbers: see E-17) | EXECUTED |
| E-3 | revision 0 `m2.mts` — ITC per file | `Arc_Edition.csv` rows 536, distinct names 532, minus last token 66, non-numeric last 5 (`SR Lumen AB` …), base names with > 1 `Collection` 0; `ITC.csv` rows 44, no specs, 0 numeric last tokens | EXECUTED (rev 0; E-8 replays the outcome) |
| E-4 | `replay.mts` `BOEN_COLUMNS` | `Dimensions (mm)` = col 11 on 258/310 after removing spaces and `mm`; spec `Format` = col 11 on 0/310 | EXECUTED |
| E-5 | `replay.mts` — non-empty values differing within a style | BOEN `Format` 7, `Dimensions (mm)` 7, `Surface` 7 (`Style` 0; revision 0 counted 1 because an empty value differed); ALPOD `dimensions` 13, `installation_system` 11; ITC 0 | EXECUTED |
| E-6 | revision 0 `m2.mts`/`m3.mts` — comma lists, merge value sets, Dimensions mismatch | Style → 4 values + empty after split; Surface 11 parts; BOEN Connection `5G Click` 248, `T/G` 62; ALPOD installation_system 11 values incl. `5G`, `Tongue+groove`; Dimensions ≠ col 11: `13.2…` vs `13,2…` 45 + 7; Certificates `controlled sources` 310; comma rows (replay): BOEN Style 201, Surface 310, ALPOD installation_method 207, type_of_material 10, ITC Pile material 10 | EXECUTED |
| E-7 | `replay.mts` `ITC_COLOUR_NUMBERS` | distinct 127, held by ≥ 2 styles 64, max styles per number 29 | EXECUTED |
| E-8 | `replay.mts` `ITC_PROFILE` — ITC profile through `planGlamImport` | `Arc_Edition.csv` products 66, options 536, deduped 0, skipped 0, categories 8, relabelled 9, imageless 5, distinct variant values 131, price sentence in any draft: false; `ITC.csv` products 44, options 44, categories 2 (`ITC`, `ITC`), price sentence: false | EXECUTED |
| E-9 | revision 0 `m4.mts` — payload sizes | drafts JSON (today's `GlamStyleDraft`): ITC Arc_Edition 598,006 B (csv 213,392 B), BOEN 455,234 B (csv 196,944 B) | EXECUTED (rev 0) |
| E-10 | `replay.mts` `residue` (SUPERSEDED by E-17) | substring check, code cells of ≥ 4 characters, narrower money pattern: 0 / 0 / 0 | EXECUTED (superseded) |
| E-11 | `replay.mts` `BOEN_COLUMNS.emptyValueLinesRaw` | empty-value lines in the raw BOEN specs: Appearance 5, Style 6 (= the 11 "other" lines of `cat-facets-1.md` § 13) | EXECUTED |
| E-12 | Code reads for every `file:line` cited | read with `cat -n` / `sed -n` on `bacdd86`; corrections § 1.1 item 9 | OBSERVED |
| E-13 | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" status --porcelain -uall`; `git -C "…/amodx" diff --check`; `git diff --no-index --check /dev/null docs/slices/cat-import-profile-1.md`; the citation-print script | see the build report of this revision | EXECUTED |
| E-14 | `r1-witness.mts` — today's parser on two synthetic rows | row 2 (code `AAA-1`): cleaned specs `Wood: Oak\nPrice: 25 EUR` (the `Article no.: AAA-1` line removed); row 3 (code `BBB-2`): `Wood: Oak\nAlternate article: AAA-1` (another row's code kept; `Part: BBB-2` removed); today's `longDescription` = `<p>Wood: Oak</p><p>Price: 25 EUR</p>` | EXECUTED |
| E-15 | `replay.mts` `unionNewlyPublished*` — lines the union over rows publishes that today's prose (first specs row) does not | BOEN 22 (`Style` 1, `Format` 7, `Dimensions (mm)` 7, `Surface` 7); ALPOD 260 (`installation_system` 129, `dimensions` 131); ITC 0 | EXECUTED |
| E-17 | `union.mts` — per key, union rule (every non-empty value once per product; holders = products with a non-empty value) and the exact G3 checks | ALPOD `dimensions` 340 holders, **82** distinct, max 22 → not offered (the only key not offered); BOEN `Surface` **17** distinct whole, 11 after a comma split; BOEN `Style` 277 holders, 17 whole, 4 after split; BOEN `Appearance` 277, `Color` 277, `Certificates` 280 (1 value), `Nordic swan` 120; BOEN `Format` 11 distinct, `Dimensions (mm)` 11; products with several values: BOEN `Format`/`Dimensions (mm)`/`Surface` 7 each, ALPOD `dimensions` 13, `installation_system` 11; G3 residue: whole-line money matches 0 (all three), whole-token code matches 0 (ITC 0 code cells; BOEN 801, all 8 chars; ALPOD 1,404 per file, 6 of 3 chars, 22 of 4) | EXECUTED |
| E-18 | `union.mts` `WITNESS_HER_71` (review-1's residual witness) | ALPOD `HER.csv` row 71 `Oak WINDSOR lacq`: `dimensions` = `2200 x 260 x 15 mm` — a value first-value aggregation omitted | EXECUTED |
| E-19 | `sed -n` on `renderer/src/components/SitePage.tsx:244`, `:293`, `:306`; `renderer/src/app/[siteId]/[[...slug]]/page.tsx:46`; `renderer/src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:56`; `renderer/src/lib/routing-server.ts:5-8`; `renderer/src/lib/facets.ts:263-266`, `:355-358` | public `basePath = ""`; category path `${prefixes.category}/${category.slug}`; shop path `prefixes.shop \|\| "/magazin"`; dynamic route passes the `amodx_preview_base` cookie; the budget test depends on `path` | OBSERVED |
| E-20 | `node_modules/.bin/tsx .agent-manager/slices/CAT-IMPORT-PROFILE-1/measure/r1-transform-witness.mts "$PWD"` (sha256 `de2fd753…71ef`, output `r1-transform-witness.out` `cd731370…aeb7`) — the § 4.3 source checks vs the importer's own `norm` / `slugify` | `Collection: Cóst`: source refused false, stored name `Cóst`, child slug `p-cost`, token in slug true; `Collection: ABC` with code `abc`: source refused false, name `ABC`, key component `abc`, child slug `p-abc`, token in slug true | EXECUTED |
| E-16 | `node -e` over each workspace `package.json` | renderer: `test`, `test:serving` (no `test:unit`); packages/shared: `test`; admin: `test:unit`; backend: `test`, `test:unit`; MCP: `test` | EXECUTED |

### 9.1 Not determined

- Whether an ITC colour number means the same colour across styles (open since `cat-facets-1.md` § 12).
- Whether the 9 `<n> (2)` ITC options are distinct articles or file duplicates (F-CIP1-4).
- The real size and wall time of a dry run with `drafts` + `siteProducts` on a 1,900-product tenant (INFERRED ≈ 1–3
  MB; § 7.5 item 8 measures it).
- Whether 157 BOEN products without specs are the 157 imageless styles (INFERRED from equal counts; not checked).
- The human's labels and choices per key — the illustrative profile of § 2.7 is not a proposal of wording.
- The false-positive rate of the money pattern (§ 4.3) on future files — 0 matches on today's files.

---

## 10. Revision record

### 10.1 Revision 1 (builder, 2026-10-30, after review-0 `revise`) — corrections by defect class

1. **R1 — a guarantee stated beyond what its mechanism enforces.** Rule applied: every safety claim names the
   mechanism that enforces it, its scope, and a negative oracle; what no mechanism covers is listed as not covered.
   § 4 is now G1 (structural), G2 (same-row code removal), G3 (proposed value guard, scope put to the human as
   CIP1-VALUE-GUARD), G4 (measured); the false claim "no new source" is removed (the union publishes BOEN 22 / ALPOD
   260 lines that today's first-row prose does not, E-15); negative oracles O-CODES-4 (cross-row code) and O-PRICES-2
   (monetary text) added; the pre-existing prose exposure recorded as F-CIP1-5. The same rule is applied to § 2.5
   (union exposure stated) and § 1.1 item 8.
2. **R2 — a DTO that claims exactness but omits fields its consumers read.** Rule applied: each preview member is
   defined by the code that consumes it on the site, never by a hand-picked list (§ 5.2): drafts = the execution's own
   `productItem` output; `siteProducts` = the union of the fields the facet function and the listing rule read; base
   sets = the renderer's membership/date/sort rule, moved to `packages/shared` with the facet function. Preview units
   for active, draft, legacy-status, future-start, expired, replaced and new-category products added (§ 5.5). The
   category-panel limitation of revision 0 is closed by the `categoryIds` rule and the remaining limits are stated
   (§ 5.3).
3. **R3 — a record of what was done that can diverge from what was done, without a detection rule.** Rule applied:
   provenance is recorded on the products themselves (`importProfileRevision`), and the snapshot is stored before any
   product claims it. `appliedTo` removed; per-sheet states `no-profile` / `current` / `stale` / `mixed` discovered from
   the products (covers sheets imported before profiles); the profile write moved before the mutation phase; the
   acceptance rule tolerates an unknown profile-write outcome; the failure/recovery table (§ 6.6); CIP1-STORAGE's
   claim corrected (disagreement can exist; what the stamps detect and what they do not); byte identity defined
   exactly (§ 2.8: no profile item written and no stamp while none exists).
4. **R4 — a filter-offer choice that changes listing membership, and a uniqueness claim that is false.** `never` now
   has three stated meanings (N1 value suppression, N2 offer suppression with matching kept, N3 key veto) with a
   mixed-producer same-key/same-value witness (§ 2.6) and REWARD/RISK in CIP1-FILTER-PRECEDENCE; the policy is left to
   ratification (recommended N2). B-5's "only order-independent rule" removed.
5. **R5 — preservation proven by comparing two new code paths; wrong commands.** Rule applied: every preservation claim
   is checked against a golden captured from the base commit (§ 7.3). Renderer command corrected to `npm test`;
   `packages/shared` `npm test` added (E-16).
6. **R6 — a name that does not describe its effect.** `drop` → `prose-only` in the table, schema, examples, decisions
   and units; its difference from an unlisted key (review state only) stated (§ 2.4).
7. **R7 — compatibility promised before the upstream contract is defined.** The prerequisite is stated (§ 2.1): the
   same profile carries over only if PL-TOOLS-2 puts Model + Decor into `produs` in the 12-column layout; any other
   delivery needs a profile change; CIP1-ALPOD reworded.
8. **Evidence replay (review-0 DoD 9).** The measurement scripts are kept in the gitignored relay directory with their
   sha256 (§ 9); two definition changes against revision 0 are stated (E-5, E-10); the ITC facet value count corrected
   from 127 to 131 (127 colour numbers + 4 suffixed labels, E-8).

### 10.2 Revision 2 (builder, 2026-10-30, after review-1 `revise`) — corrections by defect class

1. **R1 — a guard placed at one destination while the same source feeds others.** Rule applied: the guard runs on the
   source, not on one sink — on every spec line a profile SELECTS, for every destination, before the line feeds it,
   and on the whole line (key and value). § 4.3 now lists every destination derived from spec text (attribute,
   collection → product key, product slug, category name and slug, `colecție`; filter values; dry-run samples) with
   its guard, and the one that is not guarded (the prose). The collection line passes G3 (a refused line → the sheet
   name, § 2.3). Claims are bounded by the checks (revision 2 wrote "no stored field derived from a selected spec line holds
   a same-file column-2/5 cell or a money-pattern token as a whole token"; revision 3 narrows this to the checked source
   boundary and the text fields copied from it, § 10.3); the uncovered cases (other code systems, money forms
   outside the pattern, column-derived fields, prose) and the false-refusal cases are stated in § 4.3 and in
   CIP1-VALUE-GUARD's risks. New negative witnesses: O-PRICES-3 (collection from `Price: 25 EUR`), O-PRICES-4 (money
   word in the key only, `Price: 25`, in both destinations), O-CODES-5 (cross-row code in the collection).
2. **R2 — same function, different inputs.** Rule applied: every input the preview passes to a shared function equals
   the input the public renderer passes — the page path included (§ 5.2). The path rule moves to `packages/shared`
   with the listing rule; the admin reads `urlPrefixes`; the exactness claim is narrowed to the public-domain path, and
   the longer preview path `/_site/<id>/…` is a stated limit (§ 5.3); a near-budget comparison test is owed (§ 5.5).
3. **R3 — a recovery promise that silently assumes nothing happened between two requests.** Rule applied: every
   recovery claim states the condition it depends on, and the path when the condition fails. § 6.6 now qualifies
   "reproduces the same plan" by "no intervening profile change", names that the lock does not hold between requests
   (`glam-pricelist.ts:220-222`), and specifies the 409 → reload → re-preview → choose path; CIP1-STORAGE reworded;
   units owed (§ 7.4 "Intervening import").
4. **R8 — a measurement that does not implement the rule it measures.** Rule applied: every statistic about a
   proposed rule is computed by a script that implements that rule. `union.mts` aggregates with the union rule of
   § 2.5 (every non-empty value once per product, only non-empty holders) and measures residue with exactly the G3
   checks (whole lines, code cells of any length, the full money pattern). Corrected: ALPOD `dimensions` 82 (was 77),
   BOEN `Surface` 17 (was 15), BOEN `Appearance`/`Style` holders 277 (was 280); the HER.csv row 71 witness recorded
   (E-18); `replay.mts`'s per-key and residue numbers marked superseded (§ 9). Dependent prose updated: § 2.4, § 2.7,
   § 4.4, § 6.1, E-2, E-10.
5. **R9 — a compatibility rule that holds for defaults but not for enabled settings.** Rule applied: an importer never
   applies part of a stored profile. § 3.3 now requires strict parsing (never stripping), enabled-only serialisation
   of new settings, a version change for changed meanings, a deterministic `unsupported` refusal, and two reachable
   recovery paths (compatible deployment; explicit replacement after a preview, with `baseRevision` = the stored
   revision). The unreachable "open it in admin and save it again" is removed. § 3.5's `profile` member is now a sum
   with an `unsupported` variant; units owed (§ 7.4 "Versioning").

### 10.3 Revision 3 (builder, 2026-10-31, after review-2 `revise`; operator cycle-4 directive) — one correction

1. **R1 (remaining) — a guarantee checked on a source but claimed for values TRANSFORMED from it.** Rule applied: a
   token-absence guarantee is stated only for the boundary where the check runs and for values copied from it without
   transformation; every transformed form is either checked on its final value or named as excluded. § 4.3 now states
   the guarantee at the checked source line, extends it only to the text fields copied unchanged (attribute values,
   category names, `colecție`), and lists every transformed identifier (normalised key, category and product slugs,
   `TenantSlug`, URL-encoded hrefs) as excluded, with the two witnesses `Collection: Cóst` → `p-cost` and
   `Collection: ABC` + code `abc` → `p-abc` (E-20; oracles O-TRANSFORM-1/2). CIP1-VALUE-GUARD gains the sub-choice
   T1 (exclude, recommended) / T2 (check final values) with REWARD and RISK; B1's reward and § 10.2 item 1 now quote the
   bounded claim. The function is renamed `guardValue` → `guardSpecLine` (it checks a whole line, key and value), in
   § 3.6 and § 7.1. Nothing else changed.

## 11. Ratification (human, 2026-10-31)

Review approved cycle 4 (review-3); decision review 8/8 converged (challenger codex gpt-6.1-sol; on CIP1-STORAGE,
CIP1-PREVIEW and CIP1-VALUE-GUARD the builder conceded the challenger's corrections, which the text above already
carries). Packet: `.agent-manager/slices/CAT-IMPORT-PROFILE-1/ratification-packet.md` (local). Human rulings:

- **CIP1-STORAGE = A** — one item per tenant + producer, written only by an import execution under the lock;
  products stamped with `importProfileRevision`.
- **CIP1-PREVIEW = A** — admin renders the dry-run plan with the renderer's listing rule and facet function moved to
  `packages/shared`; the approximate look and the preview-path budget limit are stated in the UI.
- **CIP1-FILTER-PRECEDENCE = S-A with N2** — modes copied onto products; `always` overrides the repeat rule; `never`
  suppresses the offer only, matching and counts kept.
- **CIP1-LABELS = A** — the Romanian label is stored as the attribute key.
- **CIP1-ALPOD = A** — ship the ALPOD profile now at today's grain; the prerequisite for PL-TOOLS-2 (Model + Decor
  inside `produs`, column 1) stands.
- **CIP1-VALUE-GUARD = B1 with T3 (NOT one of the options above; proposed by the operator at ratification, not
  challenged by the decision review).** The § 4.3 guard runs on every spec line a profile selects (B1), and its
  comparison is made on the FOLDED form: the line, the file's column-2/5 code cells and the money words are each
  folded exactly as the address rule folds text (`slugify`, `backend/src/import/glam/group.ts:34-43`: case, accents,
  separators) and compared as whole tokens of that folded form. Intended effect: any identifier derived from a checked
  line by `norm`/`slugify` holds no folded same-file code token and no folded money token — the witnesses `Collection:
  Cóst` (→ `p-cost`) and `Collection: ABC` with a same-file code `abc` (→ `p-abc`) are refused at the source, and no
  second fallback is needed. Owed by `cat-import-profile-1a`: (1) the folding is ONE function shared with or derived
  from `slugify`, so the two cannot drift (a test fails if they disagree on a corpus); (2) a proof, as tests, that for
  the fields derived from a checked line, every token of the derived identifier is a token of the folded source line;
  (3) both witnesses as refusal rows; (4) the false-refusal count on today's three producers' files, reported (the
  measured § 4.4 baseline was 0 for the unfolded check). Not covered, as § 4.3 states: column-derived fields
  (producer, name, column 0 under `collection: column`, column 11 labels), the prose, codes of other systems, money
  forms outside the pattern. If (2) cannot be shown for a derived field, the slice stops and reports it.
- **CIP1-VALUE-MAPPING = A** — values shown as in the file; follow-up `cat-import-values-1` decided after the preview.
- **CIP1-PROSE = A (NOT the recommendation)** — the prose stays exactly as today; a line extracted into an attribute
  also remains in `longDescription` / `description`. The duplication on the product page is accepted.

**Next:** `cat-import-profile-1a` per § 7.1 under these rulings (the T3 obligations above added to its oracles).

## 12. Correction to § 11 CIP1-VALUE-GUARD obligation (2) (operator, 2026-10-31)

§ 11 obligation (2) reads "every token of the derived identifier is a token of the folded source line". That wording,
written by the operator at ratification, is unsatisfiable for harmless input: the whole line `Collection:Oak` folds
to one token `collectionoak`, while the derived category slug holds `oak` (review-0 of `cat-import-profile-1a`). The
guard examines a line's KEY and VALUE as separate fragments. Obligation (2) is replaced by: **every token of every
identifier derived from a checked spec line is a token of one of that line's guarded fragments (the folded key, the
folded value, or the folded value's list parts when splitting applies).** Together with the guard refusing any
fragment that holds a folded same-file code token or a folded money token, this gives the ratified property: no
derived identifier holds either. Profile labels are author input, not file data; they are not guarded and carry no
file value. The ruling itself (B1 with T3) is unchanged.
