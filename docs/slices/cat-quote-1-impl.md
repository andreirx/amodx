# CAT-QUOTE-1-IMPL — "Request a quote" on catalog products, and one place for the contact channels (IMPL record)

Status: **IMPLEMENTED** (2026-11-02, round 2, after the operator rulings of ~06:50Z: CQ-IMPL-MAPTENANT = A, R2 option a,
R3 granted, R4, CQ-ADMIN-PRESERVATION = A, CQ-INTEREST-EMAIL-CLEAR = A, F-CQ-3 fix, Romanian table approved). Code
complete, review pending; the ten gates and 6 consecutive serving runs: § 8. Round 1 (kept below): PARTIAL — stopped at
decision CQ-IMPL-MAPTENANT (2026-11-02, round 1). Built: the store, the settings
route, the interest-list recipient, the quote component, the low-key interest link, the bar fallbacks, the admin
card and the Labels inputs, with their tests. Not built: the mount in the catalog product page, the serving fixtures,
the `quote-1/before/` capture and the serving rows of packet rule 7 (§ 6). Uncommitted on `main` at `29a2282`.
Contract: the ratified spec `docs/slices/cat-quote-1.md` (§ 3 items 1–4, § 4 CQ-D1 = A, CQ-D2 = A). Builder packet:
operator, 2026-11-01.
Track F — Glam catalog. Vision tie: a catalog visitor can ask for a quote on a product through the channel they prefer,
with the product, the chosen variant and the link already written for them; the tenant fills its phone, WhatsApp and
e-mail in one place. No price reaches the message (a catalog product has none), and no live site changes.
Maturity: contact channels + quote dialog **PROTOTYPE** → **MATURE** after review and a staging check on a real catalog
tenant (round 1: not reachable by visitors; round 2: reachable).

Evidence labels: **EXECUTED** = a command run by the builder in this slice; **OBSERVED** = read in a file or in the
output of a command; **INFERRED** = a conclusion, not run.

---

## 1. What changed, per packet rule (file:line on the working tree)

(2026-11-02, round 2: the "not mounted" / "inert" / "not built" cells below are round-1 state; round 2 is § 8.)

| Rule | Change |
|---|---|
| 2 Store | `packages/shared/src/index.ts:126` `ContactNumberSchema`, `:129` `ContactChannelsSchema` (`{ phone?, whatsapp?, email? }`, strict), `:1057` `TenantConfig.contactChannels?`, `:1059` `interestListEmail?` (e-mail). `backend/src/tenant/settings.ts:108` `contactAttributesError`, called at `:212` before any read (with the LOCALE-1A limits); `:248` `interestListEmail: null` removes the attribute. `backend/src/interest/public.ts:278` recipient = `interestListEmail` → `integrations.contactEmail` → none. |
| 3 Button and dialog | `renderer/src/components/QuoteRequest.tsx` (new): `quoteMessage` `:39`, `quoteActions` `:52`, `QuoteRequest` `:68`; dialog panel `:122`. Not mounted (§ 6). |
| 4 Texts | `CatalogStringsSchema` `index.ts:876-882` (7 keys); EN `language-packs/en.ts:256-262`, RO `ro.ts:247-253` (§ 5). Labels: `admin/src/pages/Labels.tsx:519` card "Request a quote" (7 inputs). |
| 5 Low-key interest | `renderer/src/components/InterestShortlist.tsx:86` `variant?: "card" \| "page" \| "link"`, `:122` the link form. The product page still uses `variant="page"` (the mount waits for § 6). |
| 1 / item 1 Fallbacks | `renderer/src/app/[siteId]/layout.tsx:90` `ownOrChannel`; `:198-199` Top Bar, `:207-208` Commerce Bar, `:318` Quick contact. Inert today: `mapTenant` does not pass `contactChannels` (§ 6). |
| 6 Settings | `admin/src/pages/Settings.tsx:84` `withContactForSave` (used by `save()`), `:96` `ContactChannelsCard`, mounted at `:1311` with the Notifications card; `:840` Commerce Bar description + note (`COMMERCE_BAR_FALLBACK_NOTE`). |
| 7 Proof | shared `test/contact-channels.test.ts` (new, 4); backend `test/unit/cat-quote-settings.test.ts` (new, 5), `test/unit/cat-quote-interest-recipient.test.ts` (new, 4); renderer `test/unit/quote-request.test.ts` (new, 11, jsdom); admin `Settings.test.ts` (+7), `Labels.test.ts` (+1); `renderer/test/serving-contract/locale-1/quote-1/coverage.json` (new). Serving rows: NOT built (§ 6). |
| Docs | `packages/shared/ARCHITECTURE.md`, `backend/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`; this file. |

Changed existing tests: `packages/shared/test/locale-strings.test.ts` (the catalog key count 39 → 39 + 7, and the 7 keys
in order); `admin/src/pages/Labels.test.ts` (`SECTION_KEYS.catalog` 39 → 39 + 7); `admin/src/pages/Settings.test.ts` (the
two preservation rows now remove exactly the slice's additions before the comparison, § 2).

## 2. How live sites stay byte-equal (rule 1)

(2026-11-02, round 2: round-1 evidence, kept; the round-2 proof against the `29a2282` capture is § 8.2.)

- **Renderer.** No visitor page can see `contactChannels` yet (§ 6), so every fallback returns the own value as it is
  (`ownOrChannel`: `""` stays `""`, absent stays absent — the same props). The new `link` variant has no caller.
  EXECUTED: `test:serving` 95/95, including `cm1-identity-*`, `loc1-diff-1e` with no new ledger row, and the
  locale `1e/before/` captures, unchanged.
- **The stylesheet (found while building).** Tailwind writes ONE stylesheet for the whole renderer, named by a hash of
  its content. My first class choice (`bg-foreground/50`, `max-w-sm`, not used anywhere before) added two rules, so the
  stylesheet of EVERY page of every tenant got a new name, and `loc1-diff-1e`, `loc1e-category-controls` and
  `loc1-flight-controls` failed: "the head stylesheets differ" (EXECUTED, serving run 1: 92/95). The component now uses
  only classes that the base already uses (`bg-background/80 backdrop-blur`, `max-w-md`); the build emits the base
  stylesheet `0cx63klkdro8w.css` again and the suite passes (EXECUTED). Rule recorded as D-7. Finding F-CQ-3 (§ 6).
- **Admin.** The two non-catalog captures `admin/src/pages/__markup__/settings.{content,commerce}.html` are NOT
  re-taken and not changed. The preservation rows compare the page minus exactly the slice's additions: the Contact
  channels card (its own render for the same config, required to occur once) and the Commerce Bar note (required once on
  a shop with the bar on, never elsewhere). A control row proves one more changed byte is still reported. A first
  placement (the card as a new sibling of the column, the note as a new `<p>`) changed the Radix ids further down the
  page (`radix-_R_4mkb_` → `_R_4mlb_`, EXECUTED): React derives `useId` from the tree position. The card now shares one
  fragment with the Notifications card (the column keeps its children) and the note is part of the description's single
  text node (D-8).
- **Backend.** No interest-list recipient changes for a tenant without `interestListEmail`; the mail is the same
  whichever address receives it (test "the mail is otherwise the same").

## 3. Local decisions (naming and detail; one line each)

- **D-1 Dialog element.** A fixed-position panel (`role="dialog"`, `aria-modal`, `aria-labelledby`), rendered only while
  open — not the native `<dialog>`: jsdom 28.1.0 has no `showModal` (EXECUTED: `typeof showModal` is `undefined`), so
  the rule-7 jsdom rows could not open it. Escape, Close and a backdrop click close it; focus goes to the first action on
  open and back to the button on close.
  - 2026-11-02 (round 2): SUPERSEDED by ruling R2 (option a). The native `<dialog>` opened with `showModal()` (the browser makes the
    page inert and keeps focus inside); always in the server HTML, closed; Escape (handled in the component too), Close
    and a backdrop click (a click whose target is the `<dialog>`) close it; focus to the first action on open, back to
    the button on close. The jsdom file stubs `HTMLDialogElement.prototype.showModal/close` (test-only); containment and
    inertness are the browser's and are not claimed by the jsdom rows.
- **D-2 Variant segment.** `quoteMessage` is one key; the part that names the variant is written in `[…]`
  ("…{product}[, option {variant}]: {url}"). A `[…]` that holds `{variant}` is kept without brackets when an option is
  chosen and dropped otherwise; other brackets stay; segments are resolved before the values are filled, so a title is
  never syntax. The Labels input label states the rule. Reason: one translatable sentence; the Labels inputs are single
  line, so a line-based rule was not usable.
- **D-3 Variant read time.** The checked radio of the presenter is read when the dialog opens (the page behind a modal
  cannot change it), not tracked with a listener as `InterestToggle` does. No shared hook was extracted.
  - 2026-11-02 (round 2): SUPERSEDED by ruling R2. Read on open AND followed on every `change` of the presenter's radio group while the
    dialog is open; regression row "REGRESSION (review-0 R2): a radio changed while the dialog is open → the three links
    follow it" (`renderer/test/unit/quote-request.test.ts`). The false comment ("the background cannot be used") is gone.
- **D-4 Link forms.** `tel:` drops spaces (dashes are valid tel separators, as `CommerceBar` does); `wa.me` keeps digits
  only (as `QuickContact`); `mailto:` subject = the product title, body = the message, both `encodeURIComponent`
  (spaces as `%20`, which mail clients read; `+` would show as a plus). WhatsApp opens in a new tab (as `QuickContact`).
- **D-5 Number rule.** "Non-empty trimmed, digits/`+`/spaces/dashes" plus "at least one digit": `"+"` or `"- -"` gives a
  dead `tel:` / `wa.me` link. The server refuses an untrimmed value; the admin trims before saving (`withContactForSave`).
- **D-6 Clearing.** `contactChannels: {}` clears every channel (the object replaces the stored one). `interestListEmail:
  null` removes the attribute — the route merges top-level attributes, so an attribute the body only omits cannot be
  removed (see `homePageSlug`, which today cannot be cleared that way). Only this attribute gets the `null` rule.
- **D-7 Classes.** The renderer's new markup uses only Tailwind classes already used in the renderer or the plugins, so
  the global stylesheet keeps its name (§ 2). A later slice that needs a new class changes the stylesheet name of every
  page; see F-CQ-3.
  - 2026-11-02 (round 2): WITHDRAWN by ruling F-CQ-3 (the stylesheet pin is fixed, § 8). The component uses the classes it needs
    (`max-w-sm`, `backdrop:bg-foreground/50`); every page's stylesheet name changes, which `cm1-identity-*` masks (CM1-A1)
    and the corrected raw rule accepts.
- **D-8 Admin placement.** The Contact channels card is placed just before Notifications (both in one fragment); the
  Commerce Bar note is appended to that card's description: "…optional CTA button. Phone and WhatsApp: defaults from
  Contact channels when empty." (the packet's sentence, scoped to the two fields it covers).
- **D-9 "Send interest lists to" on a catalog only.** Interest lists exist only on catalog sites; the radio is shown
  there. Options: "The contact e-mail (Notifications → Contact Email)" (default; = `integrations.contactEmail`, the
  spec's "visitor e-mail = today's contactEmail behaviour") or "A separate address" (`interestListEmail`). The phone,
  WhatsApp and e-mail inputs are on every site kind.
  - 2026-11-02 (round 2): GRANTED as an exception by operator ruling R3 (the packet's rule 6 is amended by it); `Settings.test.ts`
    pins it ("… only on a catalog (ruling R3)"). The default option is now labelled "Visitor contact e-mail (default) —
    Notifications → Contact Email" and sends `interestListEmail: null` (ruling CQ-INTEREST-EMAIL-CLEAR = A).
- **D-10 No arrow.** The button text is the key value only ("Cere ofertă"); the "↗" of the spec heading is a theme
  detail of `cat-theme-1` (the `editorial` preset), not a text.
- **D-11 The page variant of `InterestToggle` is KEPT.** It still has its caller (`SitePage.tsx:1122`) because the mount
  is stopped (§ 6). The rule-5 choice (delete or keep) is made in the round that moves the product page to `link`.
  - 2026-11-02 (round 2): DONE. The `page` variant is DELETED: after the mount it had no caller (`git grep -n 'variant="page"\|variant: "page"'
    -- renderer/src renderer/test` → no match, EXECUTED); `interest-toggle.test.ts` (the F4 rows) now drives `variant="link"`
    with the same expectations.
- **D-12 Coverage set name.** `renderer/test/serving-contract/locale-1/quote-1/` (the packet's `quote-1/`, under the
  locale proof directory that `locale-coverage.test.ts` reads). It holds `coverage.json` only; `before/`,
  `expected-diff.json` and `ro-expected.json` wait for § 6.
  - 2026-11-02 (round 2): the set is complete: `before/` (145 captures from `29a2282`), `expected-diff.json`, `ro-expected.json`,
    `coverage.json` (§ 8).
- **D-13 Log line.** The "notification not sent" warning text is unchanged; it is logged only when both addresses are
  absent, and it stays true then.

- **D-14 (2026-11-02, round 2) Slot order.** With a channel: [Request a quote][presenter][interest link][attributes]; without one:
  [presenter][interest link][attributes] — the link keeps the toggle's place for every catalog tenant. Reason: the spec
  says "a text link under the 'Cere ofertă' button" and the ruling "QuoteRequest above the presenter, the link under it";
  a first placement directly under the button moved an existing text past the presenter's image `alt` texts on the RO
  copy, which the locale text comparison (`textChanges`, positional) reports as a reorder (EXECUTED, `loc1-ro-catalog`:
  "item 25: kind @alt → text"). Two JSX fragments, not a conditional child, so a tenant without a channel keeps the
  slot's children as before.
- **D-15 (2026-11-02, round 2) Fixtures.** The RO catalog copy `loc1-ro-catalog` has all three channels; new group `CQ1`
  (`fixtures.mjs`): `cq1-ro-email` and `cq1-ro-none` (copies of the CM1 catalog in Romanian: e-mail only, and an EMPTY
  `contactChannels` object), `cq1-shop-fallback` and `cq1-shop-own` (shops: bar own values empty / set). Each has a
  `locale`, so none joins the en-US subjects (the `LOC1E` precedent); their requests `proof.mjs` `CQ1_REQUESTS`.
- **D-16 (2026-11-02, round 2) A category-3 entry without `text` is markup only.** `ledgerTexts` (contract.test.mjs) lists only entries
  that declare `text`; CQ1-INTEREST-LINK changes classes, not text.
- **D-17 (2026-11-02, round 2) Added texts in `ro-expected.json`.** Item form `{ row: "CQ1-QUOTE", part: "catalog", key, kind,
  added: true, to }`: each removed once from the after extraction, then the rest must be exactly the listed changes.
- **D-18 (2026-11-02, round 2) Product URL.** `https://<tenant domain><product prefix>/<slug>` — the form the interest mail already
  writes (`interest/public.ts`) and the page's canonical URL.

## 4. Abstractions introduced (one line each)

- `ContactChannelsSchema` / `ContactNumberSchema` (shared) — users: `TenantConfigSchema`, `PUT /settings`
  (`contactAttributesError`), the renderer (type of `QuoteRequest` and the layout); axis: none new — the one rule for a
  channel value on both sides of the route (variants fixed); rejected: a second regex in the handler.
- `quoteMessage`, `quoteActions` (QuoteRequest.tsx, exported pure functions) — users: `QuoteRequest`, the jsdom/unit
  test; axis: none; rejected: inline in the component (untestable without a DOM per case).
- `ownOrChannel` (layout.tsx, local) — users: the five fallback props; axis: none; rejected: five inline ternaries.
- `ContactChannelsCard`, `withContactForSave` (Settings.tsx, exported) — users: `SettingsPage`, `Settings.test.ts`
  (the exact-exclusion seam of § 2 needs the card's own render); axis: none; rejected: the card inline in the page (the
  test could then remove it only by a markup search).
- `SettingsDraft` (type) — the page state where `interestListEmail` may be `null`; rejected: casts at each use.

- (2026-11-02, round 2) `CQ1_REQUESTS` (proof.mjs, exported) — users: the before capture, `cq1Set` (contract.test.mjs),
  `loc1-subjects`; axis: none; rejected: request lists inline in each `cq1-*` row (the capture needs the same list).
  `CQ1_LINK` (contract.test.mjs const) — users: `loc1-subjects`, `loc1-diff-quote-1`, `cq1-quote-channels`; the one
  statement of the link-form difference. `quoteRequestStrings` (SitePage, local) — the `interestToggleStrings`
  pattern (a fresh object per element). No new interface, module or dependency.

## 5. Romanian table — APPROVED as proposed (operator, 2026-11-02 ~06:50Z)

Register: the informal one of the `1a`/`1b`/`1d` amendments ("tu" forms, no "ca să").

| Key | EN | RO (proposed) | Where |
|---|---|---|---|
| `catalog.quoteButton` | Request a quote | Cere ofertă | the button on the catalog product page |
| `catalog.quoteTitle` | Ask us for a quote | Cere-ne o ofertă | dialog heading |
| `catalog.quoteCall` | Call us | Sună-ne | action, `tel:` |
| `catalog.quoteWhatsApp` | WhatsApp | WhatsApp | action, `wa.me` (brand name, not translated) |
| `catalog.quoteEmail` | Send an e-mail | Trimite un e-mail | action, `mailto:` |
| `catalog.quoteMessage` | Hello! I would like a quote for {product}[, option {variant}]: {url} | Bună! Aș vrea o ofertă pentru {product}[, varianta {variant}]: {url} | the WhatsApp text and the e-mail body (`[…]` only with a chosen variant) |
| `catalog.quoteClose` | Close | Închide | dialog close button |

## 6. Decision and findings

DECISION_REQUIRED:
- ID: CQ-IMPL-MAPTENANT
  QUESTION: The renderer reads the tenant through `renderer/src/lib/dynamo.ts` `mapTenant` (`:120-184`), which is a
  field WHITELIST (its own comment, `:153`: "mapTenant is a whitelist, not a pass-through"). `contactChannels` is not in
  it, and the file is not allocated to this slice. So no visitor page can see the channels: the quote button can never
  render, the bar fallbacks never apply, and the rule-7 serving rows (the button, the dialog texts, the three hrefs, the
  bar fallback values) cannot pass. Which way may the channels reach the renderer?
  OPTIONS:
  - A — allocate `renderer/src/lib/dynamo.ts` for ONE line in `mapTenant`, `contactChannels: item.contactChannels ||
    undefined`, plus a row in `renderer/test/unit/locale-1a-map-tenant.test.ts` (allocated). REWARD: the spec's design as
    ratified; the whitelist keeps its role (it already lists `quickContact`, `topBar`, `commerceBar`); the serving
    suite proves no byte moves for tenants without the field (`CLAUDE.md` requires `test:serving` for this file, and the
    round runs it anyway). RISK: one more allocated file; `mapTenant` serves every tenant, so a typo there is
    production-wide — the suite and the unit row cover it.
  - B — read the raw tenant item a second time in the layout and in `SitePage`. REWARD: no change to `dynamo.ts`. RISK:
    a second tenant read on every render (cache MISS) of every tenant, and two sources of the same record; not
    recommended.
  - C — keep the slice without the renderer reach: ship store, admin and backend now, and move the button and the
    fallbacks to a follow-up slice that allocates `dynamo.ts`. REWARD: this round is reviewable as is. RISK: the
    human's "immediate" button is not delivered by this slice; the built renderer code stays unreachable meanwhile.
  RECOMMENDED: A.
  RULED 2026-11-02 (~06:50Z, operator under the human's delegation): A — `renderer/src/lib/dynamo.ts` allocated for the one
  line. B and C refused. Built in round 2 (§ 8).
  BLOCKING_REASON: the button, the fallbacks and the rule-7 serving proof all need the field in the renderer; building the
  catalog mount and the serving capture now would capture a page that cannot show the button and be redone after the
  ruling.

What the next round does under A (INFERRED plan): the `mapTenant` line and its unit row; `SitePage.tsx` catalog slot:
`QuoteRequest` above the presenter when a channel has a value (absolute URL from the tenant domain and the product
prefix, as the interest mail builds it), `InterestToggle variant="link"` under it, and the rule-5 choice for the page
variant; fixtures (the RO catalog copy with all three channels, a second catalog copy with e-mail only, a third without;
a shop copy with `contactChannels` and empty bar fields); the `quote-1/before/` capture from `29a2282` with those
fixtures (README procedure); `expected-diff.json` for the catalog product pages (the toggle `variant` prop, category 2
with `beforeValue`; its HTML, category 3) and `ro-expected.json`; the rule-7 rows; 6 consecutive serving runs.

Findings (not allocated; no change made):

- **F-CQ-1 (packet assumption): the Top Bar and the Quick contact have no Settings card.** `git grep -n -E
  "topBar|quickContact|Top Bar|Quick Contact" -- admin/src tools/mcp-server/src` (EXECUTED, exit 0) lists only two
  Labels texts. Their fields are set outside the admin. The note is on the Commerce Bar card only; the Contact channels
  card's description names all three users of the fallback.
  - 2026-11-02 (round 2): DISPOSITION (ruling): no control is invented. The Contact channels card's description names the three
    surfaces ("Also used by the Top Bar, the Commerce Bar and the floating Quick contact when their own value is empty");
    the Commerce Bar note stays; their values are set only through the API.
- **F-CQ-2 (stale copy): the Catalog card says lists go "to the contact e-mail below (Notifications)".**
  `Settings.tsx` Catalog card; true by default, wrong when a separate address is set. Kept: the text is the ratified
  `cat-admin-1` § 4.5 wording and a test pins it. Proposed: "…send it to the address set in Contact channels (by default
  the contact e-mail, Notifications)."
  - 2026-11-02 (round 2): CLOSED by ruling R4: the Catalog card now says "…send it to the address chosen in Contact channels → Send
    interest lists to (by default the visitor contact e-mail, Notifications → Contact Email)."; its test is updated.
- **F-CQ-3 (proof pin, same class as `locale-1e.md` § 18): the head stylesheet name is compared with the `d9999d2`
  capture.** `renderer/test/serving-contract/locale-1/proof.mjs` `moveRootLayoutRaw`, `canon(sheetsB) !== canon(sheetsA)`.
  Next/Tailwind name the stylesheet by its content, so ANY new class anywhere in the renderer or the plugins fails three
  rows on every page, on a correct build (EXECUTED, § 2). This slice avoided it (D-7); it is not fixed. Proposed (needs a
  ruling, as § 18 did for scripts): the head stylesheets must be the live payload link on the after side, as they are
  already checked to be, without equality to the before names.
  - 2026-11-02 (round 2): FIXED by ruling F-CQ-3: `proof.mjs` `moveRootLayoutRaw` — on EACH side every head stylesheet is that
    side's payload stylesheet, same count on both sides, no before/after name equality; controls in
    `loc1e-category-controls` (§ 8); `docs/slices/locale-1e.md` § 18 appended (dated). The row's before-side preload is
    now read from the before payload (`cssB`), the same pin class.
- **F-CQ-4 (a11y, deferred): no focus trap.** Tab can leave the open dialog for the page behind it. Escape, Close and
  the backdrop close it, and focus returns to the button (packet rule 3 asks only for these).
  - 2026-11-02 (round 2): CLOSED by D-1's supersession: the native modal dialog.
- **F-CQ-5 (existing behaviour, noted): `PUT /settings` cannot remove an omitted top-level attribute.** The admin sends
  the whole config; `{ ...current, ...body }` keeps any attribute the body lacks (for example `homePageSlug` cleared in
  the admin stays stored). D-6 gives `interestListEmail` a `null` rule; nothing else changes.

  - 2026-11-02 (round 2): STAYS a finding for the human (ruling CQ-INTEREST-EMAIL-CLEAR = A): only `interestListEmail` has a removal
    convention (`null`), documented in `backend/ARCHITECTURE.md` as a boundary convention of this request field.

## 7. Gates and oracles — round 1 (EXECUTED on the round-1 tree, 2026-11-02, in this order; logs were temporary, results in `.agent-manager/slices/CAT-QUOTE-1/build-progress.md`)

| Check | Command | Result | Label |
|---|---|---|---|
| 1 | `npm --prefix "<repo>" run build` | exit 0 | EXECUTED |
| 2 | `npm --prefix "<repo>" run typecheck` | exit 0 | EXECUTED |
| 3 | `npm --prefix "<repo>/packages/shared" test` | exit 0, 273 tests (269 + 4) | EXECUTED |
| 4 | `npm --prefix "<repo>/packages/plugins" test` | exit 0, 204 tests | EXECUTED |
| 5 | `npm --prefix "<repo>/renderer" test` | exit 0, 387 tests (375 + 11 jsdom/unit + 1 coverage slice) | EXECUTED |
| 6 | `npm --prefix "<repo>/renderer" run test:serving`, 6 consecutive runs | exit 0 six times, 95 pass / 0 fail each; each run "65 live 200 pages agree on the [siteId] resources"; the build emits the base stylesheet `0cx63klkdro8w.css` every time | EXECUTED |
| 7 | `npm --prefix "<repo>/admin" run test:unit` | exit 0, 231 tests (223 + 8) | EXECUTED |
| 8 | `npm --prefix "<repo>/backend" run test:unit` | exit 0, 1232 passed, 1 skipped (1223 + 9) | EXECUTED |
| 9 | `npm --prefix "<repo>/tools/mcp-server" test` | exit 0, 0 fail | EXECUTED |
| 10 | `git -C "<repo>" diff --check` | exit 0 | EXECUTED |
| O-1 | `git diff --stat -- infra docs/slices/cat-quote-1.md docs/slices/cat-interest-1.md docs/slices/locale-1.md` | empty | EXECUTED |
| O-2 | `git status --porcelain -uall` | only allocated paths: 16 modified, 7 added (this file included) | EXECUTED |
| O-3 | `git ls-files -z --others --exclude-standard \| grep -zv '\.body$' \| xargs -0 grep -c -E '[[:space:]]+$'` | 0 lines in each of the 7 files (grep exit 1) | EXECUTED |
| O-4 | `git status --porcelain -- tools/mcp-server` (`routes.json` unchanged; no route added) | empty | EXECUTED |
| O-5 | `git status --porcelain -- admin/src/pages/__markup__` (captures not re-taken) | empty | EXECUTED |
| — | `cd backend && npm test` | NOT RUN (packet: never; it uses real staging DynamoDB) | NOT RUN |
| — | rule-7 serving rows (button, dialog texts, hrefs, bar fallbacks) | NOT RUN: not built, decision CQ-IMPL-MAPTENANT (§ 6) | NOT RUN |

## 8. Round 2 (2026-11-02, after the operator rulings of ~06:50Z)

### 8.1 What changed (file:line on the working tree)

| Ruling / rule | Change |
|---|---|
| CQ-IMPL-MAPTENANT = A | `renderer/src/lib/dynamo.ts:181` `contactChannels: item.contactChannels \|\| undefined` in `mapTenant`; `renderer/test/unit/locale-1a-map-tenant.test.ts` row "contactChannels is copied (CAT-QUOTE-1); absent stays absent". |
| Rule 3, rule 5 (mount) | `renderer/src/components/SitePage.tsx:1123` catalog slot: with a channel `[QuoteRequest][presenter][InterestToggle variant="link"][attributes]` (`:1146`), without one `[presenter][link][attributes]` (D-14); `:191` `quoteRequestStrings`; product URL D-18. `InterestShortlist.tsx`: `variant?: "card" \| "link"` — the `page` form DELETED (D-11). |
| R2 (option a) | `renderer/src/components/QuoteRequest.tsx:131` native `<dialog>`, `:101` `openDialog` → `showModal()`; `:93` the `change` listener while open; Escape / Close / backdrop close, focus returns. Tests `renderer/test/unit/quote-request.test.ts` (12; stubs in the file; + the REGRESSION row). |
| R3, R4, F-CQ-1 | `admin/src/pages/Settings.tsx`: the Catalog card text (R4), the Contact channels description (F-CQ-1), the default radio "Visitor contact e-mail (default) — Notifications → Contact Email" (sends `null`), the doc comment of the card (R3, CQ-INTEREST-EMAIL-CLEAR). `Settings.test.ts`: R4 assertions; R3 row titled with the ruling; the description row. |
| CQ-ADMIN-PRESERVATION = A | `Settings.test.ts` `withoutCatQuote`: EXCLUSION 1 (the card element = `ContactChannelsCard` rendered alone, starts `<div class="rounded-xl border bg-card text-card-foreground shadow">`, holds "Contact channels", exactly once) and EXCLUSION 2 (" " + `COMMERCE_BAR_FALLBACK_NOTE` with the description and `</div>`, exactly once on the shop); controls: positive (both captures equal), one attribute elsewhere (content `placeholder`), one text, one attribute in the Commerce Bar card (`placeholder`) — each fails. Policy: the captures are the immutable 3912c5d artefacts; a base re-capture cannot change them (the base has no card) and a candidate capture is forbidden, so the comparison is narrowed by exactly these two named exclusions; the first placement's Radix-id shift is why the card shares a fragment with Notifications (D-8). |
| CQ-INTEREST-EMAIL-CLEAR = A | `backend/ARCHITECTURE.md` (settings.ts entry): the boundary convention, this request field only; the admin control sends `null`; F-CQ-5 stays. |
| F-CQ-3 | `renderer/test/serving-contract/locale-1/proof.mjs:629-631` (each side: head stylesheets = that side's payload stylesheet, same count; no name equality); `contract.test.mjs` `loc1e-category-controls`: +2 refusals (a second head stylesheet, same / another href), the consistent rename now a positive control, the before preload from the before payload (`cssB`); `docs/slices/locale-1e.md` § 18 appended (dated; 0 lines removed). D-7 lifted (D-7 sub-bullet). |
| Rule 7 (serving) | Fixtures `fixtures.mjs:622` `CQ1` + the RO catalog copy's channels (D-15); `proof.mjs:76` `CQ1_REQUESTS`; the current locale set is now `locale-1/quote-1/` (`LOC1_SLICE = "quote-1"`, `LOC1_START = "29a2282"`): `before/` (145 captures), `expected-diff.json`, `ro-expected.json` (D-17), `coverage.json` (+6 capture checks). Rows: `loc1-subjects` (the rule: CQ1-INTEREST-LINK exactly on the 13 catalog product pages, `[]` elsewhere), `loc1-diff-quote-1` (`:1935`, successor of `loc1-diff-1e`; controls: each link entry dropped, a ghost, the page form left in the payload, HTML bytes, the content-home and order-page controls), the `loc1-ro-*` rows accept listed added texts (title renamed to say so), `cq1-quote-ro` (`:2307`), `cq1-quote-channels` (`:2341`), `cq1-bars-fallback` (`:2367`), `cq1-bars-own` (`:2387`); `loc1e-category-controls` reads `1e/` explicitly (`loc1eBeforeSet`, `loc1eJson`). `README.md` rows updated. |

### 8.2 The base capture and what moved (EXECUTED)

- **Capture.** Worktree `/tmp/CAT-QUOTE-1-base` at `29a2282` (`node_modules` cloned; `packages/shared`, `effects`, `plugins`
  built there — no `quoteButton` in its `dist`, no `contactChannels` in its `mapTenant`); `harness.mjs`, `ddb-stub.mjs`,
  `cm1-byte-identity.mjs`, `no-dotenv.cjs`, `locale-1/extract.mjs` byte-identical in both trees (`diff -q`); this tree's
  `fixtures.mjs` and `locale-1/proof.mjs` copied in. A throwaway script (not committed) built and served the base
  renderer with the suite's harness and captured `EN_US_REQUESTS` + `LOC1_REQUESTS` + `CQ1_REQUESTS`: build
  `MBGgxTeTxPCg7Y_k6n3k6`, 145 captures (200: 135, 307: 8, 404: 2), stub `unhandled` = `[]`. Worktree and scripts removed.
- **Consistency with the locale-1e record.** All 81 en-US URLs of `1e/before/` (d9999d2) against `quote-1/before/` under
  `1e/expected-diff.json` (the category-4 move): 0 problems.
- **Candidate vs base, en-US subjects.** Only the 13 catalog product pages (3 `catalog`, 10 `cip1b-catalog`) differ, each
  by exactly CQ1-INTEREST-LINK (`variant` "page" → "link"; the button's class; the icon's size class); every shop and
  content URL (and every other URL) lists nothing — zero ledger rows (hard rule 1). `cm1-identity-commerce` /
  `-content`: 32 × "same" against the unchanged baseline, so `cm1-byte-identity/baseline/` was NOT re-captured.
- **RO copies.** Text: no change; added: the six visible quote texts on the RO catalog copy's 3 product pages
  (18 items, row CQ1-QUOTE). CQ1: the e-mail copy gains the button, title, e-mail action and close; the empty-channels
  copy gains nothing; the fallback shop shows the channel values; the own-values shop shows no change.
- **Stylesheet.** The new classes rename the one stylesheet on every page: masked by CM1-A1 in `cm1-identity-*`,
  accepted by the corrected category-4 rule (F-CQ-3) — no other row compares the name.

### 8.3 Gates and oracles — round 2 (EXECUTED on the final tree, in this order; results in `build-progress.md`)

| Check | Command | Result | Label |
|---|---|---|---|
| 1 | `npm --prefix "<repo>" run build` | exit 0 | EXECUTED |
| 2 | `npm --prefix "<repo>" run typecheck` | exit 0 | EXECUTED |
| 3 | `npm --prefix "<repo>/packages/shared" test` | exit 0, 273 tests | EXECUTED |
| 4 | `npm --prefix "<repo>/packages/plugins" test` | exit 0, 204 tests | EXECUTED |
| 5 | `npm --prefix "<repo>/renderer" test` | exit 0, 389 tests (round 1: 387; + map-tenant row, + regression row) | EXECUTED |
| 6 | `npm --prefix "<repo>/renderer" run test:serving`, 6 consecutive runs | exit 0 six times, 99 pass / 0 fail each (95 + 4 `cq1-*`); run on the final code after the last test-title edit (an earlier set of six, before that edit, also 99/99) | EXECUTED |
| 7 | `npm --prefix "<repo>/admin" run test:unit` | exit 0, 232 tests | EXECUTED |
| 8 | `npm --prefix "<repo>/backend" run test:unit` | exit 0, 1232 passed, 1 skipped | EXECUTED |
| 9 | `npm --prefix "<repo>/tools/mcp-server" test` | exit 0, 13 pass / 0 fail | EXECUTED |
| 10 | `git -C "<repo>" diff --check` | exit 0 | EXECUTED |
| O-1 | `git diff --stat -- infra docs/slices/cat-quote-1.md docs/slices/cat-interest-1.md docs/slices/locale-1.md` | empty | EXECUTED |
| O-2 | `git status --porcelain -uall` | only allocated paths (incl. the ruled `renderer/src/lib/dynamo.ts`, `proof.mjs`, `contract.test.mjs`, `locale-1e.md`): 25 modified, 9 untracked files + 147 under `quote-1/before/` | EXECUTED |
| O-3 | `git ls-files -z --others --exclude-standard \| grep -zv '\.body$' \| xargs -0 grep -c -E '[[:space:]]+$'` | 0 in each of the 11 files (grep exit 1) | EXECUTED |
| O-4 | `git status --porcelain -- tools/mcp-server` | empty (`routes.json` unchanged) | EXECUTED |
| O-5 | `git status --porcelain -- admin/src/pages/__markup__` | empty (captures never re-taken) | EXECUTED |
| O-6 | `git diff -U0 -- docs/slices/locale-1e.md \| grep -c '^-[^-]'` | 0 (append only) | EXECUTED |
| O-7 | `git grep -n 'variant="page"\|variant: "page"' -- renderer/src renderer/test` | no match (exit 1): the page form has no caller | EXECUTED |
| — | `cd backend && npm test` | NOT RUN (packet: never) | NOT RUN |
| — | real-browser check of the modal (`showModal` containment, inert background, Escape) | NOT RUN: no browser harness in the gates; jsdom stubs the two methods; the behaviour is the platform's | NOT RUN |

### 8.4 Left open

- F-CQ-5 (no general removal mechanism on `PUT /settings`) — for the human.
- Staging: a real catalog tenant with channels, the dialog in a browser (Escape, focus, inert page), the three links on
  a phone (the `tel:` / WhatsApp hand-off) — operator, after review.

## 9. Operator closeout (2026-11-02 ~08:20Z; staging only — no prod deploy overnight, human's rule)

- Review: round 1 → escalate (CQ-IMPL-MAPTENANT, R1–R5); round 2 → approved; decision review all-converged (1/1);
  CQ-IMPL-MAPTENANT = A ratified by the operator under the human's overnight delegation (`.agent-manager/slices/CAT-QUOTE-1/
  human-ratification.md`; reversible). Rulings of ~06:50Z (R2 → native `<dialog>` chosen by the builder; R3 exception;
  R4; CQ-ADMIN-PRESERVATION = A; CQ-INTEREST-EMAIL-CLEAR = A; F-CQ-1 disposition; F-CQ-3 fixed in-slice) are in the packet
  and § 8. Packet defect recorded: the allocation missed `renderer/src/lib/dynamo.ts` (`mapTenant` is a whitelist) —
  lesson in the operator's memory: a slice adding a tenant field the renderer reads allocates the mapper.
- Operator gate run (`glam/quote-gates.log`, bare exit codes): build, typecheck, shared 273, plugins 204, renderer 389,
  serving 99/99, admin 232, backend 1232 (+1 skipped), MCP 13, `git diff --check` — all exit 0; infra and spec diffs
  empty; `locale-1e.md` append-only (12/0); allocation `(none)`; whitespace none.
- `cdk diff -c stage=staging`: code-only (41 Lambda assets, two bucket deployments, admin runtime config; the three
  pre-existing `Description` encoding lines); no resource added or removed, no IAM.
- Staging (build `rv89Ivxd6puAjxw3nv86q` → `0uY20H-6ZKQdDbyKt0vJS`): the 51 CM1 URLs text- and status-identical (0
  differences). On the operator tenant `glam-staging` (`glam/quote-staging-out/`): `PUT /settings` with
  `contactChannels.email: "not-an-email"` → 400 `contactChannels.email: Invalid email address`, nothing written (GET
  unchanged); the PUT of three channels + `interestListEmail` stored; the SIL product page (server HTML): `lang="ro"`,
  three hrefs (`tel:`, `wa.me`, `mailto:`) with the product title and URL in the pre-filled text, Romanian texts, the
  `<dialog>`, the interest link. Headless Chromium (Playwright 1.57, `glam/quote-browser.mjs`, screenshot
  `quote-staging-out/dialog-open.png`): the button opens the dialog, focus is inside it, title "Cere-ne o ofertă", actions
  "Sună-ne" / "WhatsApp" / "Trimite un e-mail", Escape closes it, focus returns to the button. The product has one variant,
  so the variant-change branch ran only in the jsdom regression test, not in the browser.
- Open for the human (morning): F-CQ-5 (`PUT /settings` has no general removal mechanism — `null` is ratified for
  `interestListEmail` only); the interest-list mail to a separate address is provable only with a real submission
  (reCAPTCHA; cat-interest-1 closeout) — the first prod submission is the check.
