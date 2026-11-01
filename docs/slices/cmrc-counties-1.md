# CMRC-COUNTIES-1 — checkout region list from the tenant's real country (record)

Status: **BUILT 2026-11-01, revised in iteration 1** (and corrected for review finding R1 of `.agent-manager/slices/CMRC-COUNTIES-1/review-0.json`, § 3) for the operator rulings of 2026-11-01 after review-0 (packet § 5:
CMRC-COUNTIES-BACKEND-TEST = drop, CMRC-COUNTIES-BASELINE = follow the README procedure, record corrections) — builder;
uncommitted, for review. Commerce track, ROADMAP row `cmrc-counties-1`; root cause `docs/slices/locale-1.md` § 16.4.
Start: `main` at `959f288`, tree clean (EXECUTED). Operator decisions (under the human's overnight delegation of
2026-10-31): COUNTIES-FREEZE = named exception (the county field of `CheckoutPageView.tsx`, shipping and billing, and the
`defaultRegions` line of `SitePage.tsx`); COUNTIES-TEXT-LAYER = off.

What the slice does: the renderer now knows the tenant's country. The checkout form gets the region list of that
country (Romania: the 42 counties; English default `EN`: none) instead of the Romanian list for every shop. When no list
exists (no configured counties and a country without regions), the county field is a required free-text input. A
Romanian shop keeps its 42-county select. Commerce texts do not change. No backend change and no backend test (ruling
CMRC-COUNTIES-BACKEND-TEST = drop).

## 1. Changes (file:line in the candidate tree)

| Item | File:line | What |
|---|---|---|
| 1 | `renderer/src/lib/dynamo.ts:165-167` | `mapTenant` copies `countryCode` (`item.countryCode \|\| undefined`: absent stays absent); the F-LOCALE-COUNTIES comment is removed |
| 2 | `renderer/src/components/SitePage.tsx:435` | `defaultRegions` from `getCountryPack(config.countryCode \|\| "EN")` — no Romanian fallback |
| 2 | `renderer/src/components/SitePage.tsx:81-87` | `getCommerceStrings` = `{ ...COMMERCE_STRINGS_DEFAULTS, ...config.commerceStrings }`; one-line comment names `locale-1d` (COUNTIES-TEXT-LAYER = off) |
| 3 | `renderer/src/components/CheckoutPageView.tsx:447-455` (shipping), `:495-502` (billing) | `counties.length > 0` → today's `<select>` (its source lines unchanged); else `<input required>` with the city field's markup, same label `strings.county`, same state keys `county` / `billingCounty` |
| 4 | `renderer/test/unit/cmrc-counties-1-checkout.test.ts` (jsdom, 7 tests), `cmrc-counties-1-site-page.test.ts` (node, 8 tests), `cmrc-counties-1-fields.ts` (helpers of both), `cmrc-counties-1-before.json` (959f288 form-markup oracle) | § 3 |
| 4 | `renderer/test/unit/locale-1a-map-tenant.test.ts:57-63` | the 1a case "countryCode stays out" is replaced by "countryCode is copied; absent stays absent" |
| 4 | `renderer/test/serving-contract/fixtures.mjs:532` | `loc1-ro-commerce` gains `countryCode: "RO"` (comment `:501-503`) |
| 4 | `renderer/test/serving-contract/contract.test.mjs:2123-2158` | new row `cmrc-counties-1` (props per country); `:40` imports `getCountryPack`; `cm1-identity-*` title names the `cmrc-counties-1` tree |
| 4 | `renderer/test/serving-contract/contract.test.mjs:2160-2217` | new row `cmrc-counties-diff` — the `cm1-byte-identity/README.md` procedure (ruling CMRC-COUNTIES-BASELINE) |
| 4 | `renderer/test/serving-contract/cmrc-counties-1/before/` (51 responses, `index.json`, `client-modules.json`) | the immutable start-commit capture (959f288, README procedure, § 3) |
| 4 | `renderer/test/serving-contract/cmrc-counties-1/expected-diff.json` | this slice's exact list of byte differences: one entry |
| 4 | `renderer/test/serving-contract/locale-1/1b/expected-diff.json:446`, `:615-623` | the same change listed for row `loc1-diff-1b` (compares with 4e98f98): one category-2 changed-prop entry (`slice: "cmrc-counties-1"`), `propValues.checkoutRegionsRoPack`, one sentence appended to `rule` |
| 4 | `renderer/test/serving-contract/cm1-byte-identity/baseline/` (40 files), `cm1-byte-identity/README.md:65` | strict baseline re-captured from this tree AFTER the `cmrc-counties-diff` check existed; history row |
| 5 | `renderer/ARCHITECTURE.md` (§ "Checkout region list", locale section), `renderer/test/serving-contract/README.md:49`, this file | docs |

Decided locally (one line each):
- `countryCode: item.countryCode || undefined` — same form as the sibling fields (`currency`); a stored `""` reads as absent, which every reader already maps to `EN`.
- The select lines in `CheckoutPageView.tsx` keep their indentation inside the new conditional, so the diff shows them unchanged.
- The free-text input copies the city input's markup (`required`, same class) — the nearest existing free-text field.
- The slice's capture set lives in `renderer/test/serving-contract/cmrc-counties-1/` (the locale slices use `locale-1/<slice>/`).
- Row `cmrc-counties-diff` compares the cm1-identity subjects (commerce 18, content 14) under CM1-A1 exactly; the catalog captures in `before/` are not compared there (CM1-A1 does not hide their render-to-render row-label variation, F-CATALOG-RSC-ORDER, `locale-1a.md` § 9); the catalog is covered by `loc1-diff-1b`.

Abstractions introduced:
- `cmrc-counties-1-fields.ts` (`BEFORE_FILE`, `FREE_TEXT`, `withFreeText`, `StateName`, `Snapshot`) — users: the two
  slice unit tests; axis: none (one shared definition of "today's form with the county select replaced"); rejected: a
  copy in each test (the two proofs must use the SAME replacement, else they prove different things).
- Capture mode of `cmrc-counties-1-checkout.test.ts` (`CMRC_COUNTIES_1_CAPTURE`) — users: the one capture of § 3 (and a
  reviewer who re-runs it); axis: none; rejected: a hand-written "today's markup" (a claim, not an observation).
- The `check` / `parts` helpers inside row `cmrc-counties-diff` — users: that row and its 3 mutations; axis: none;
  rejected: `locale-1/proof.mjs` `checkExpected` (it applies the resolved-tree payload comparison, which is ruled for the
  locale rows only; the cm1-identity procedure keeps CM1-A1 exactly).

## 2. Oracles (EXECUTED 2026-11-01, iteration 1, in the packet's order, on the final code)

| # | Command | Exit | Last lines |
|---|---|---|---|
| 1 | `npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" run build` | 0 | `> tsc` |
| 2 | `npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" run typecheck` | 0 | `> tsc --noEmit` |
| 3 | `npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/shared" test` | 0 | `Tests 242 passed (242)` |
| 4 | `npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/plugins" test` | 0 | `Tests 201 passed (201)` |
| 5 | `npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" test` | 0 | `Tests 254 passed (254)` (239 + 15 new) |
| 6 | `npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" run test:serving` | 0 | `# tests 91` / `# pass 91` / `# fail 0` |
| 7 | `npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/admin" run test:unit` | 0 | `Tests 175 passed (175)` |
| 8 | `npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend" run test:unit` | 0 | `Tests 1192 passed \| 1 skipped (1193)` |
| 9 | `npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/tools/mcp-server" test` | 0 | `# pass 13` / `# fail 0` |
| 10 | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check` | 0 | (no output) |
| + | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --stat -- infra docs/slices/locale-1.md docs/slices/locale-1a.md docs/slices/locale-1b.md` | — | prints nothing |
| + | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --name-only \| grep -E "package(-lock)?\.json$"` | 1 | prints nothing (no dependency change) |
| + | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" status --porcelain -uall` | — | only allocated paths (§ 1); no `backend/` path |
| + | `npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" run test:serving`, 6 consecutive runs after gate 6 | 0, 0, 0, 0, 0, 0 | 91/91 each |

Never run: `cd backend && npm test`. Gate 10 and the status check were re-run on the tree with this file (build report).

Serving lines of this slice (gate 6): `(cmrc-counties-diff) 32 commerce/content URLs against the 959f288 capture: 1
listed difference (commerce /checkout defaultRegions: 42 names → []), every other commerce/content URL byte-equal under CM1-A1; 3
mutations reported`; `(cmrc-counties-1) roCommerce /checkout defaultRegions 42 (RO pack); commerce /checkout
defaultRegions 0; strings equal (98 keys)`; `(loc1-diff-1b) commerce /checkout: 2 listed difference(s) [cat 2
CheckoutPageView.strings (changed), cat 2 CheckoutPageView.defaultRegions (changed)]`; `(cm1-identity-commerce) same
/checkout`; `(loc1-text-commerce) 14 HTML URLs, 308 extracted items, all equal`; `(loc1-ro-commerce) 18 URLs, 74 text
changes … {"L-RO-1":55,"L-RO-2":10,"L-RO-3":9}` (unchanged from `locale-1b`).

## 3. Proof

**Where the field renders (OBSERVED).** `CheckoutPageView` is a client component; the cart lives in `localStorage`, so
the server HTML of `/checkout` is always "Your cart is empty". The county field exists only in the browser, with a cart.
So on the serving fixtures the change is a PAYLOAD change (the prop `defaultRegions`), not a visible-text change; the
markup and the texts of the field are proven in jsdom against a capture of today's form.

**Start-commit capture of the CM1 set (EXECUTED, ruling CMRC-COUNTIES-BASELINE).** `cmrc-counties-1/before/` — the 51
CM1 responses from `959f288`, made with the `cm1-byte-identity/README.md` procedure: worktree
`/tmp/CMRC-COUNTIES-1-before` at `959f288` (removed), node_modules cloned, that commit's shared, effects and plugins built,
THIS tree's `fixtures.mjs`, `ddb-stub.mjs`, `cm1-byte-identity.mjs` copied in (the worktree then differed from `959f288`
only in `fixtures.mjs`, whose one change is the RO copy's `countryCode`; `harness.mjs`, `no-dotenv.cjs`, `ddb-stub.mjs`,
`cm1-byte-identity.mjs` are unchanged against `959f288`), then
`cd renderer && node test/serving-contract/cm1-byte-identity.mjs capture <tree>/renderer/test/serving-contract/cmrc-counties-1/before`
(build `E0ZbzzMTrARdqybGGUCmB`). Then row `cmrc-counties-diff` was added and passed, and only then `baseline/` was
re-captured (build `uQufVUcjNlEpLZobaAJyz`). Comparisons on these final artifacts (EXECUTED after review finding R1;
subjects and method named for each):

| Compared | Subjects | Method | Result |
|---|---|---|---|
| `before/` vs the committed `959f288` baseline (`git archive HEAD`) | all 51 CM1 URLs | CM1-A1 (`maskBody`) | equal on all 51 (iteration 1) |
| `before/` vs the final `baseline/` | the 32 commerce/content URLs (the cm1-identity subjects) | CM1-A1 | equal except commerce `/checkout` — the one listed difference (`defaultRegions`) |
| `before/` vs the final `baseline/` | the 19 catalog URLs | CM1-A1 | equal except `/category/floors` (not a listed difference) |
| `before/` vs the final `baseline/`, catalog `/category/floors` | 1 URL | the locale resolved-tree comparison (`locale-1/proof.mjs` `checkExpected`, no listed difference) | equal |

The catalog `/category/floors` difference is the known render-to-render variation of that page's payload rows, which
CM1-A1 does not hide and the resolved-tree comparison does (F-CATALOG-RSC-ORDER, `locale-1a.md` § 9; the same page
was the most frequent case there). It is not a behaviour change of this slice: the catalog is not a cm1-identity
subject, the resolved-tree check finds no difference, and row `loc1-diff-1b` passes on it in every run. Iteration 1
claimed "differs on commerce `/checkout` only" for the whole set. That was measured on an earlier capture and did not
name its subjects, so it was wrong for the final catalog captures (review finding R1). No canonicalisation was widened and
no immutable capture was regenerated.

**Row `cmrc-counties-diff`** (`contract.test.mjs:2167`): for each commerce/content URL of `before/`, this run's capture
has the same status and Content-Type; both bodies go through `maskBody` (CM1-A1, unchanged); each listed changed prop
must occur exactly once on each side in a payload row of its element (`"$L[project]/renderer/src/components/CheckoutPageView.tsx#CheckoutPageView"`)
and is put back to its before value; then the HTML and the sorted rows must be byte-equal. A URL without a listed entry
must be byte-equal. Bound mutations, each reported: the entry dropped; one payload byte added next to the prop; a wrong
before value (41 names).

**Today's form markup (EXECUTED).** `renderer/test/unit/cmrc-counties-1-before.json` = the form markup of `959f288`,
four states × two views (as mounted; with "Use same address for billing" unchecked):

```bash
git worktree add --detach /tmp/CMRC-COUNTIES-1-before 959f288
cp -cR node_modules /tmp/CMRC-COUNTIES-1-before/node_modules
for d in renderer packages/plugins packages/shared; do cp -cR $d/node_modules /tmp/CMRC-COUNTIES-1-before/$d/node_modules; done
(cd /tmp/CMRC-COUNTIES-1-before && npm run build -w packages/shared)
cp renderer/test/unit/cmrc-counties-1-{checkout.test,fields}.ts /tmp/CMRC-COUNTIES-1-before/renderer/test/unit/
(cd /tmp/CMRC-COUNTIES-1-before/renderer && CMRC_COUNTIES_1_CAPTURE=<tree>/renderer/test/unit/cmrc-counties-1-before.json \
  CMRC_COUNTIES_1_COMMIT=959f288 npx vitest run test/unit/cmrc-counties-1-checkout.test.ts)
git worktree remove --force /tmp/CMRC-COUNTIES-1-before
```

States: `ro-regions` (no configured counties, the 42 RO-pack names — what EVERY shop without counties got before this
slice), `configured-ro` / `configured-en` (`availableCounties` `["Cluj","Ilfov"]` with and without RO regions), `no-list`.

**Unit tests** (gate 5). They are component- and handler-contract coverage with mocked I/O (cart hook, router, session,
`fetch`, DynamoDB reads), not end-to-end tests:
- `cmrc-counties-1-checkout.test.ts`: `ro-regions`, `configured-ro`, `configured-en` — whole form byte-identical to
  `959f288`, both views (so the `<select>` is today's exactly: same options, same placeholder `Select county...`);
  configured counties win over the country's regions; `no-list` — both fields are the required input, and a submit
  sends the typed texts to the mocked `fetch` as `shippingAddress.county` and `billingDetails.billingCounty`;
  L-EN-COUNTIES markup: today's `ro-regions` form with each county `<select>` replaced by the input (`withFreeText`)
  equals the `no-list` form now, both views.
- `cmrc-counties-1-site-page.test.ts` (real `SitePage`, probes for the two commerce views): `countryCode` absent → `[]`;
  `EN` → `[]`; `RO` → the 42 names; configured `availableCounties` pass through for absent / `EN` / `RO`;
  COUNTIES-TEXT-LAYER = off — `countryCode: "RO"` with no stored keys gives checkout and cart `strings` equal to
  `COMMERCE_STRINGS_DEFAULTS` (same key order), while the RO pack's `checkout` text differs (the check is not vacuous);
  a stored key still overrides; the L-EN-COUNTIES text items (§ 4) via `extractVisibleText` of `locale-1/proof.mjs`.
- `locale-1a-map-tenant.test.ts`: `countryCode: "RO"` → `"RO"`; absent → `undefined`.
- Bound mutations (EXECUTED, each with the file restored after): `CheckoutPageView.tsx` = `959f288` → 2 tests fail;
  `defaultRegions` fallback back to `"RO"` → 1 fails (absent case); pack text layer merged again → 2 fail; billing
  input writing `county` → 1 fails. Restored tree: 15/15.

**Exact text equality of the layer-off change (EXECUTED).** The EN pack's `defaultStrings` (75 keys) is a subset of
`COMMERCE_STRINGS_DEFAULTS` (98 keys) with equal values; `{ ...defaults, ...EN pack }` equals `defaults` in value and
key order. Before this slice `countryCode` never reached the renderer, so the pack was always `EN`; removing the layer
therefore keeps today's `strings` exactly for every tenant.

## 4. Ledger row L-EN-COUNTIES (the only en-US visible change)

Where: the checkout form of every en-US shop without configured `availableCounties` (`countryCode` absent or `EN`),
rendered in the browser with a cart. Not on any server-rendered URL. Extraction = § 8.5 (`extractVisibleText`).

| Field | Before (extraction items after the label item `County *`, kind `text`) | After |
|---|---|---|
| shipping county | `Select county...`, `Alba`, `Arad`, `Arges`, `Bacau`, `Bihor`, `Bistrita-Nasaud`, `Botosani`, `Brasov`, `Braila`, `Bucuresti`, `Buzau`, `Caras-Severin`, `Calarasi`, `Cluj`, `Constanta`, `Covasna`, `Dambovita`, `Dolj`, `Galati`, `Giurgiu`, `Gorj`, `Harghita`, `Hunedoara`, `Ialomita`, `Iasi`, `Ilfov`, `Maramures`, `Mehedinti`, `Mures`, `Neamt`, `Olt`, `Prahova`, `Satu Mare`, `Salaj`, `Sibiu`, `Suceava`, `Teleorman`, `Timis`, `Tulcea`, `Vaslui`, `Valcea`, `Vrancea` (43 items) | none (the input has no text, no placeholder) |
| billing county (shown when "Use same address for billing" is unchecked) | the same 43 items | none |

Markup: `<select required="" class="w-full border rounded-md px-3 py-2 text-sm"><option value="">Select county...</option>`
+ 42 `<option>` → `<input required="" class="w-full border rounded-md px-3 py-2 text-sm" value="">`. Every other item and
byte of the form is equal and in order (unit tests above). Payload: `CheckoutPageView.defaultRegions` 42 names → `[]`.

## 5. Rows whose expectation changed (and rows checked unchanged)

| Row | Old expectation | New expectation |
|---|---|---|
| `loc1-diff-1b` (via `locale-1/1b/expected-diff.json`) | commerce `/checkout`: 1 listed difference (`CheckoutPageView.strings` changed) | 2: also `CheckoutPageView.defaultRegions` changed, `checkoutRegionsRoPack` (42 names) → `[]` |
| `cm1-identity-commerce` (via `cm1-byte-identity/baseline/`) | `/checkout` payload carries the 42 names (baseline from the `locale-1b` tree) | carries `[]` (baseline from this tree, captured after `cmrc-counties-diff`); title says "cmrc-counties-1 tree" |
| `cm1-identity-content` | baseline from the `locale-1b` tree | re-captured from this tree; its 14 URLs equal `before/` under CM1-A1 (EXECUTED on the final `baseline/`); title text only |
| unit `locale-1a-map-tenant` | "countryCode stays out" | "countryCode is copied; absent stays absent" |
| `cmrc-counties-diff` (new) | — | commerce/content URLs = `cmrc-counties-1/before/` (959f288) under CM1-A1, except commerce `/checkout` `defaultRegions` 42 names → `[]` |
| `cmrc-counties-1` (new) | — | RO copy `/checkout` `defaultRegions` = the 42 RO-pack names; `cm1-commerce` `[]`; both `availableCounties` `[]`; RO copy checkout `strings` = cm1-commerce `strings` |

Checked unchanged (expectation not edited, row passes): `loc1-text-commerce` (the field is client-only), `loc1-ro-commerce`
(text rows; the RO copy keeps its 42 counties and its texts), `loc1-subjects` (the RO copy has `locale`, so it is not an
en-US subject), `cm1-rewire`, `cm1-control`, every other row of the suite.

## 6. Deviation from the packet, with the reason

- **D1 — the serving `/checkout` does not show the field.** Packet item 4 says the en-US commerce fixtures' `/checkout`
  "shows the free-text field" and asks for the L-EN-COUNTIES extraction items. The server HTML has no form (§ 3,
  OBSERVED). So the serving rows prove the props (`defaultRegions` `[]` / 42 names) and the byte change; the field's
  markup and the extraction items of § 4 come from the jsdom render compared with the `959f288` capture.

(Iteration 0 also recorded D2 — no own start-commit capture — and D3 — the backend test stopped. Both are closed by the
packet § 5 rulings: the README procedure is now followed, and the backend test is dropped.)

## 7. Corrected premise and findings

**Corrected premise (packet § 5, OBSERVED in review-0 and verified).** `backend/src/orders/create.ts:174-212` refuses a
county only when the delivery config has `restrictDeliveryZones: true` (`:174`) AND a non-empty `allowedCounties`
(`:197`, case-insensitive, outer spaces ignored, exact match). It never reads `availableCounties`, the DISPLAY list
(`packages/shared/src/index.ts:1322-1329`: `restrictDeliveryZones`, `allowedCountries`, `allowedCounties` are the
restriction; `availableCounties` is "Counties shown in dropdown (empty = text input)" — the documented intent this
slice implements in the renderer). The packet's conclusion stands: a free-text county is accepted when zones are not
restricted. No backend change and no backend test in this slice (CMRC-COUNTIES-BACKEND-TEST = drop).

- **F-COUNTIES-ZONE-SPELLING** (INFERRED from the code above; not built): a shop with zone restrictions and allowed
  counties but no display list (`availableCounties` empty) and a country without regions now gets a free-text county
  field, so the customer's spelling must match an allowed county (case-insensitive); otherwise the order gets the
  generic 400 "Delivery not available". Recommended mitigation for such admins: configure `availableCounties` (then the
  form shows a select). Latent: no live English commerce tenant (`locale-1.md` § 16.1).
- **F-CMRC-COUNTIES-LABEL** (OBSERVED, not changed): an English shop's free-text field is labelled "County *"
  (`strings.county`); the EN pack's `address.regionLabel` is "State / Region". The packet forbids text changes; a
  candidate for `locale-1d`.

## 8. Operator's staging checklist (Layer 2) and the human's prod pre-check

Deploy: renderer only (no backend or admin change). Rollback: renderer.

1. Before the deploy, capture the 51 CM1 URLs (`cm1-content` 14, `cm1-commerce` 18, `cm1-catalog` 19). After it, Layer 2
   extraction (`locale-1/proof.mjs` `extractVisibleText`): **all 51 text-identical** — `cm1-commerce` `/checkout`
   included, because its server HTML is the empty-cart view (D1).
2. `cm1-commerce` `/checkout` in a browser: add a product to the cart, open `/checkout` → the County field (shipping,
   and billing after unchecking "Use same address for billing") is a free-text input; an order with a typed county is
   accepted. The page payload carries `"defaultRegions":[]`.
3. If a Romanian staging tenant exists (none known): its `/checkout` keeps the 42-county select.

**Human, prod, before the renderer deploy** (the operator cannot read prod): `povesti-pe-biscuite` (the live RO commerce
tenant) gets the 42 counties today through the `"RO"` fallback even if its stored `countryCode` is absent. After this
slice an absent `countryCode` means `EN` → free text. Before the renderer deploy, open Settings → Country for that
tenant: the admin shows the effective value (`config.countryCode || "EN"`, `admin/src/pages/Settings.tsx:1650`). If it
does not show Romania, apply Romania (`RO`) — note that Apply also sets the currency to the pack's (`RON`;
`withCountry`, `Settings.tsx:64`) — or confirm that its delivery settings list counties (`availableCounties`).

## 9. Not done here (outside the allocation)

`docs/ROADMAP.md` row `cmrc-counties-1` and `CURRENT_SLICE.md` still say BACKLOG / do not name this slice — they are not
allocated; the operator updates them at closeout. No browser end-to-end run was made (no allocated E2E target covers
the checkout form); the jsdom test is the client-state proof with mocked I/O, staging step 2 the browser check.

## Operator closeout (2026-11-01)

- **Relay.** Builder claude-opus-5-5, reviewer gpt-6.1-sol. Review-0 escalated: the packet's backend premise was wrong
  (the server checks the county only under `restrictDeliveryZones` with `allowedCounties`, `create.ts:174-212`; it
  never reads `availableCounties`). Operator rulings (packet § 5, under the human's overnight delegation): backend test
  dropped, baseline README procedure followed, record wording corrected. Freeze exception COUNTIES-FREEZE and
  COUNTIES-TEXT-LAYER = off were operator decisions in the packet. Review-1 asked to scope one equality claim; review-2
  approved.
- **Gates.** The ten common gates and the packet's extra checks passed on the accepted candidate (`ALL GATES GREEN`).
- **Staging.** `cdk diff`: 3 renderer Lambda functions, code only. All 51 CM1 URLs equal in status, content type and
  visible text after the deploy (the staging `/checkout` has an empty cart, so the county field is not rendered there;
  its states are proven by the unit tests). The page data of `cm1-commerce /checkout` changed as intended:
  `defaultRegions` carried the 42 Romanian counties before ("Alba", "Arad", … "Vrancea") and `[]` after.
- **Human, before the prod renderer deploy:** open povesti-pe-biscuite → Settings → Country and confirm Romania
  (`RO`), or confirm its delivery settings list counties. Applying Romania also sets the currency to RON (record
  above); check it is already RON.
