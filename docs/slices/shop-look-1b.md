# SHOP-LOOK-1B — the hero of the reference look (implementation record)

Status: **BUILT, revision 1** (2026-11-15, builder), uncommitted, awaiting review. Start: `main` at `783e95f`, tree
clean. Review-0: approved, no required change. Revision 1 applies the two operator rulings of 2026-11-15 from the
staging check (§ 6.1). All oracles of the packet's § 4 pass on the final tree (§ 7): serving contract 117 / 117 (115
existing rows unchanged + 2 new `sl1b-*` rows). Maturity: the eight hero attributes are **PROTOTYPE** until the operator's staging run (Operator
closeout, below).

## 1. The requirement

The ratified design `docs/slices/shop-look-1.md`, row `shop-look-1b` of § 9, with § 17 (no change to this slice,
§ 17.3). The governing rule (§ 4): **absent = today's bytes**. Reference sections built: 2 (cover hero with eyebrow, two
tones, two buttons, numbers, pill buttons), 6 (split hero with a dark text panel), 11 (hero pills and label). Section 3
needs no code (§ 3 row 3: `features`, four columns); it is part of the operator's staging page.

What a visitor sees with each attribute set (each optional; absent, `null` or blank = not shown):

- `eyebrow` — a small uppercase pill label directly above the headline (every style; on `cover` in the cover
  headline's colour, ruling SL1B-COVER-EYEBROW).
- `headlineAccent` (+ `headlineAccentColorToken`) — a second part of the headline, after it on the same line, in a
  second colour (every style).
- `secondaryCtaText` + `secondaryCtaLink` — a second, outline button beside the first (center, split, cover). On a
  phone the two buttons are stacked and full width; from 768 px side by side.
- `stats` — up to four numbers with captions, one row from 768 px; on a phone four items take two columns.
- `buttonShape: "pill"` — both buttons fully rounded.
- `splitPanel: "inverse"` — on style `split`, the text panel takes the page text colour as its background and every
  default text colour inside it is swapped (§ 6.5); in the dark theme the panel is light. The first button keeps its
  fill and label and gains a thin edge in the panel's text colour (ruling SL1B-INVERSE-BUTTON).

## 2. What changed (file:line on the final tree)

| File | Change | Serves |
|---|---|---|
| `packages/plugins/src/hero/schema.ts:4-6`, `:23-24` | `HeroTextColorToken`: the one enum of the hero text tokens, now used by `headlineColorToken`, `subheadlineColorToken` (same values, same default as before) and the new accent token | § 4.2 "the enum of `headlineColorToken`" |
| `packages/plugins/src/hero/schema.ts:28-37` | eight attributes, `.optional()`, no default: `eyebrow`, `headlineAccent`, `headlineAccentColorToken`, `secondaryCtaText`, `secondaryCtaLink`, `stats` (`max(4)`, value `max(12)`, label `max(40)`), `buttonShape` (`rounded`/`pill`), `splitPanel` (`plain`/`inverse`) | § 4.2 |
| `packages/plugins/src/hero/index.ts:37-45` | the eight Tiptap attributes, `default: null` | § 4 |
| `packages/plugins/src/hero/HeroRender.tsx:18-21` | `btnClassPill`: today's `btnClass` with `rounded-full` for `rounded-md`, a second complete literal | § 4.2 `buttonShape`, § 6.5 class rule |
| `HeroRender.tsx:22-32` | `FIRST_BUTTON_CLASS`: `plain` = `btnClass` / `btnClassPill` (today's strings); `inverse` = the same two strings with `border border-background/40`, written out as complete literals | ruling SL1B-INVERSE-BUTTON (amends § 6.5 "First button") |
| `HeroRender.tsx:34-47` | `SPLIT_PANEL.plain` (today's three strings, moved unchanged) / `SPLIT_PANEL.inverse` (the § 6.5 swaps) | § 6.5 |
| `HeroRender.tsx:49-91` | `Tone`, `PAGE_TONE`, `INVERSE_TONE`, `coverTone()`: the colour classes of the new elements by surface; the cover eyebrow = `border-current` + the cover headline class | § 6.5 table; D-1B-1; ruling SL1B-COVER-EYEBROW |
| `HeroRender.tsx:93-103` | `STATS_GRID` (literal grid classes per count), `BUTTON_ROW` | § 6.2 |
| `HeroRender.tsx:105-119` | `textOrNull` (trimmed text or null), `statsToDraw` (non-blank values, at most four) | § 4 "blank = absent" |
| `HeroRender.tsx:167-209` | the options read once; `eyebrowEl`, `accentEl`, `firstButton(panelKind)` (the first button with `FIRST_BUTTON_CLASS[panelKind][shape]`), `buttonsEl`, `statsEl` (each returns today's node or nothing when its option is absent) | § 4.2 |
| `HeroRender.tsx:216-219` (minimal), `:230-254` (split), `:264`, `:284-292` (cover), `:309-317` (center) | the new elements placed in each style; split chooses `SPLIT_PANEL`, the tone and the first button's class kind by one conditional on `splitPanel === "inverse"`; center and cover always use `plain` | § 4.2, § 6.5 |
| `packages/plugins/src/hero/HeroEditor.tsx:9-16` | the local `Input` passes an optional `maxLength` (absent → no attribute) | stats limits in the editor |
| `HeroEditor.tsx:19-33` | `HeroStat`, `storedOption` (exported), `selectClass`: blank text, empty list or the default choice → `null` | packet § 1 item 7 |
| `HeroEditor.tsx:44-50`, `:122-215` | the controls (English): Label above the headline; Headline second tone + colour; Second Button Text / Link; Button Shape; Text Panel (split only); Numbers (up to 4, add / remove). Button options hidden on `minimal` | packet § 1 item 7 |
| `packages/plugins/test/hero.test.ts` (new), `heroBaselineCases.ts` (new), `hero.baseline.json` (new) | the plugin render tests, the 39 baseline inputs, today's HTML recorded before the change | § 3 below |
| `renderer/test/serving-contract/fixtures.mjs:853-896`, `:946-947` | `SL1B` (set / plain / blank content tenants, each a home page with a cover hero and a split hero) | § 6.3 |
| `renderer/test/serving-contract/contract.test.mjs:44`, `:3085-3178` | rows `sl1b-hero-options`, `sl1b-blank-as-absent` | § 6.3, § 6.5 case 3, stylesheet check |
| `tools/mcp-server/src/index.ts:117-150` | hero description: 4 styles incl. `cover`, the cover tokens, the eight new attributes | F-SHOP-BLOCK-DOC (hero rows) |
| `docs/block-types.md:11` | hero row: `cover` added; cover tokens; the new attributes | F-SHOP-BLOCK-DOC (hero row) |
| `packages/plugins/ARCHITECTURE.md` | hero row; new § *The `hero` block's options*; test table row | docs |
| `renderer/ARCHITECTURE.md` | SHOP-LOOK-1B paragraph (no renderer source change; rows `sl1b-*`) | docs |

No renderer source change, no shared change, no backend change, no infra change, no `package.json` change, no new
dependency. `admin/src/**`: no change (no admin test counts hero attributes: `git grep -n "subheadlineColorToken\|headlineColorToken" -- admin/src` → no line).

## 3. Taxonomy → tests (all EXECUTED, pass)

Plugin tests are in `packages/plugins/test/hero.test.ts` (names quoted); they render `RENDER_LOADERS["hero"]` with
`react-dom/server`. "Baseline" = `hero.baseline.json`: the HTML of 39 inputs (four styles × schema defaults, Tiptap
defaults, style only, image, rich subheadline, legacy `<br>`, no button text, no subheadline, cover tokens; plus no style,
an unknown style, an unknown cover token), rendered by `HeroRender.tsx` at `783e95f` before any edit, in both
`renderToStaticMarkup` and `renderToString`.

| Attribute | Absent / null / blank | Present, valid | Present, malformed |
|---|---|---|---|
| `eyebrow` | HTML equals the baseline, every case, both renderers: "absent: …", "null: …", "blank: …" (`"   "`), "empty: …" (`""`); serving `sl1b-blank-as-absent` | `<p>` directly above the `<h1>`, trimmed; removing it gives the baseline — "every style: a <p> directly above the <h1> …"; inverse colours — "split inverse: the inverse colours …"; cover: text and border follow the cover headline (default `text-white`; tokens `primary`, `foreground`, `white` → their class) — "cover (ruling SL1B-COVER-EYEBROW): …"; serving `sl1b-hero-options` | whitespace only → as absent ("blank: …"); a number → as absent ("malformed: …") |
| `headlineAccent` | as above | `<span>` inside the `<h1>` after the headline and one space, default `text-primary`; removing it gives the baseline (both renderers; the streaming renderer adds React's `<!-- -->` text separator) — "every style: a <span> inside the <h1> …"; on cover the default stays `text-primary` — "cover: the accent keeps its § 4.2 default …" | blank → as absent ("blank: …"); an object → as absent ("malformed: …") |
| `headlineAccentColorToken` | default class: "`auto` = absent token = the default class" | each allowed token → its class, every style; the enum tested is the schema's — "each allowed token → its class …" | read only with an accent: a token without accent → baseline ("blank: …" sets `primary` with a blank accent). Unknown token: `resolveTextClass` returns the caller's default for a key it does not know (`resolveCoverColorTokens.ts:55-59`); the render mirrors it → the surface default (`text-primary`, inverse `text-background/70`) — "an unknown token → the default class …"; the schema refuses it — "the schema accepts each token and refuses an unknown one" |
| `secondaryCtaText` / `Link` | as above | center, split, cover: one row (first button, then the outline `<a>`) replaces today's button slot; nothing else changes — "center, split, cover: one row …"; `_getUrl` applied — "the link passes through the tenant URL helper …"; first button text empty → the outline button alone — "without a first button text …"; minimal → no effect — "minimal: the second button, the numbers and the pill shape have no effect …" | Rule (bound): the button shows when its TEXT is non-blank; a blank, `null` or absent link → `href="#"`; a link without text → no button — "rule: the button shows when its text is non-blank; …" and "blank: …" (link `/shop`, text blank) |
| `stats` | as above (`null`, `[]`) | 1 to 4 items in center, split, cover: the grid of § 6.2 per count, after the buttons; removing it gives the baseline — "1 to 4 items: …" | an item with a blank value is skipped; a blank caption → no caption — "an item with a blank value is skipped …"; all skipped → as absent ("blank: …"); not an array → as absent ("malformed: …"); a fifth item → refused by the schema, and a stored fifth item is not drawn — "a fifth item is refused by the schema …" |
| `buttonShape` | today's class | `pill` → `rounded-full` on the first button (the only change: "pill: the first button's class is today's string …") and on both buttons ("pill: both buttons rounded-full") | `rounded` → today's class ("blank: …"); `square` → today's class ("malformed: …"), refused by the schema |
| `splitPanel` | today's class strings ("absent/null: …"; `plain` in "blank: …") | `inverse` on `split`, the three cases of § 6.5: case 1 default tokens (token absent, then `auto`): panel `bg-foreground`, no `text-foreground` / `text-muted-foreground` / `border-foreground` token inside, headline `text-background`, accent `text-background/70`; case 2 explicit tokens `foreground`, `muted-foreground`, `primary` kept on the accent, headline and panel unchanged; case 3 absent / `plain` = baseline, and `inverse` alone = baseline after undoing the four swaps (panel, headline, text, first button) — `describe("hero — split inverse panel (§ 6.5)")`; first button under `inverse`: fill and label kept, `border border-background/40` added, with `rounded` and with `pill`, alone and beside the outline button; `plain`, `null`, absent and the other styles keep today's string — "ruling SL1B-INVERSE-BUTTON: …"; serving `sl1b-hero-options` | `inverse` on center, cover, minimal → no effect — "splitPanel inverse on center, cover and minimal: no effect"; `dark` → today's strings ("malformed: …"), refused by the schema |
| editor: clear an option | a cleared option stores `null`: `storedOption` — blank text, `[]`, `auto` / `rounded` / `plain` → `null`; other values unchanged — "storedOption: …" | every control offered with its stored value; Text Panel only on split; button options not on minimal; "Add number" hidden at four — "offers every option …" | — |

Coverage gap (stated, not hidden): the plugins package has no DOM harness, so the WIRING from a control's `onChange` to
`storedOption` is read, not exercised (`HeroEditor.tsx:49`, every new control calls `updateOption`). A stat item added
with "Add number" is stored as `{ value: "", label: "" }` until typed; the render skips it (blank value). The packet's
"nothing is stored as `""` or `[]`" holds for the attributes; it is not applied inside a stat item.

Teeth check (EXECUTED): five mutations of `HeroRender.tsx` (an extra space before the accent; `bg-foreground` removed;
no four-item cap; blank check without trim; inverse eyebrow on the cover) each failed 13, 5, 1, 3 and 1 tests; the file
was restored and the suite passed again.

## 4. Byte identity

- **Plugin level:** for each of the four styles, a hero with none of the new attributes, or with each of them `null`,
  blank, empty or malformed, renders the baseline HTML character for character, in both server renderers
  (`hero.test.ts`, five "… every baseline case renders byte-equal" tests over 39 inputs).
- **Built site:** every existing row that captures a page with a hero before this slice passed unchanged — the CM1
  content home page holds a `split` hero (`fixtures.mjs:309`, rows `cm1-identity-content`, the `loc1-*` copies), the CT1
  tenants hold a `cover` hero (`fixtures.mjs:662`, rows `ct1-*`). No capture or expectation file changed (`git status`
  lists no file under `renderer/test/serving-contract/` but `contract.test.mjs` and `fixtures.mjs`).
- **New rows:** `sl1b-hero-options` — the set tenant's HTML equals its twin's after 11 exact-once substitutions (remove
  eyebrow ×2, accent ×2, numbers ×2; button row → today's button ×2 — the split row carries the inverse first-button
  class, so its substitution also undoes that swap; the three § 6.5 panel, headline and text swaps). Its payload equals the
  twin's (resolved) after removing the two appended attribute sets. `sl1b-blank-as-absent` — `null` and blank options:
  the twin's HTML byte for byte. The payload of such a page carries the stored `null`s (§ 4.2: changes the RSC payload,
  not the HTML; an owner action on that page).
- How the rule is kept in code: an existing element's class string is a complete literal chosen by one lookup
  (`FIRST_BUTTON_CLASS[plain|inverse][rounded|pill]`, whose `plain` entries ARE `btnClass` / `btnClassPill`;
  `SPLIT_PANEL.plain` / `.inverse`); a new element is a child that is `null`
  when absent (React renders nothing for `null`); the first button's node is passed through unchanged when there is no
  second button.

## 5. Stylesheet check

Method (EXECUTED in `sl1b-hero-options`): the set tenant's home page from the running build; each
`<link rel="stylesheet">` fetched; for each of 38 classes the test asserts a rule selector `.<class>` followed by `{`,
` {`, `:` or `,`. All present, in 1 stylesheet: `bg-foreground`, `text-background`, `text-background/80`,
`text-background/70`, `border-background`, `border-background/40`, `border-primary/30`, `border` (revision 1: the inverse first button's edge), `border-current`,
`border-foreground`, `rounded-full`, `w-fit`, `inline-block`, `tracking-widest`, `uppercase`, `md:flex-row`,
`md:justify-center`, `flex-col`, `gap-4`, `gap-6`, `mt-12`, `grid-cols-1/2/3`, `md:grid-cols-4`, `text-2xl`,
`md:text-4xl`, `drop-shadow-md`, `text-white`, `text-white/90`, `text-primary`, `text-foreground`,
`text-muted-foreground`, `text-xs`, `text-sm`, `px-3`, `py-1`, `mb-6`.
Why they compile: each is a literal in `HeroRender.tsx` (OBSERVED: `grep -c` ≥ 1 for each new one), and the renderer's
Tailwind scans `packages/plugins` (`renderer/src/app/globals.css:7`). Note: that `@source` also scans
`packages/plugins/test/`, whose files hold the same literals, so the CSS check alone does not prove which file supplied a
class; the grep on `HeroRender.tsx` does. The stylesheet's content-hash name changes (accepted precedent, CM1-A1).

## 6. Decisions and abstractions (one line each)

- **D-1B-1 cover colours (gap in the design, decided; eyebrow amended by ruling SL1B-COVER-EYEBROW, § 6.1):** the design gives the new elements' colours on the page
  background and on the inverse panel (§ 6.5), not on the cover overlay. On `cover` the outline button and the numbers
  take the cover headline's class (`border-current` + `hlClass`, default `text-white`), the captions the subheadline's
  (`shClass`, default `text-white/90`) — the cover's own defaults; `text-foreground` on a dark overlay would be
  unreadable. Revision 0 kept the eyebrow and the accent on the § 4.2 default `text-primary`; staging showed the eyebrow
  unreadable (§ 6.1), so the eyebrow now follows the headline too. The accent keeps `text-primary` (F-1B-COVER-ACCENT).
- **D-1B-2 class composition:** the § 6.5 rule ("two complete strings, no appending") is applied to every EXISTING
  element. The NEW elements' strings are composed from literal parts (`${EYEBROW_BASE} …`, `${OUTLINE_BASE[shape]}
  ${tone.outline}`, cover `${…} ${hlClass}` as today's cover `<h1>` does); they exist only when set, so they cannot change
  today's bytes. Reviewer: if the rule is meant for new elements too, the cover tones need a literal per token (7 × 4
  after revision 1: eyebrow, outline, value, caption). Review-0 accepted this; the first button's inverse edge (an
  EXISTING element) is written as complete literals, per the rule.
- **D-1B-3 second-button link:** blank or absent link → `href="#"` (mirrors the first button's default `ctaLink = "#"`
  and `getUrl("") → "#"`, `renderer/src/lib/routing.ts:32`); a non-blank link goes through `attrs._getUrl` (SL-D14).
- **D-1B-4 texts trimmed:** every new text is drawn trimmed (as `header.tagline`, `shop-look-1a`); the editor stores it
  untrimmed while typing.
- **D-1B-5 render cap:** the render draws at most four stats even if more are stored (the schema refuses a fifth; the
  backend does not validate block attributes, `index.ts:396`).
- `HeroTextColorToken` — what: one zod enum of the hero text tokens; users: `headlineColorToken`,
  `subheadlineColorToken`, `headlineAccentColorToken`; axis: variants fixed (the token list of `resolveTextClass`), one
  list for three fields; rejected: a third copy of the literal enum (drift risk between headline and accent).
- `Tone` + `PAGE_TONE` / `INVERSE_TONE` / `coverTone()` — what: the colour classes of the new elements per surface;
  users: center and minimal (page), split (page / inverse), cover; axis: variants fixed (three surfaces), chosen once per
  style; rejected: per-style class literals repeated in four branches (duplication of 5 strings × 4 styles).
- `storedOption` (exported from `HeroEditor.tsx`) — what: the value a cleared option stores; users: the seven `updateOption`
  controls + `hero.test.ts`; axis: none (one rule for every new control); rejected: inline `v.trim() ? v : null` at each
  control (seven copies, and no test seam without a DOM harness).
- No other abstraction. `eyebrowEl`, `accentEl`, `buttonsEl`, `statsEl` are local closures inside `HeroRender` used by
  three or four style branches.

### 6.1 Operator rulings 2026-11-15 (revision 1, from the staging check)

Staging, Chromium, tenant `cm1-content`: its theme has `--primary` equal to the foreground colour (near black), the
platform's default theme. Two elements were not readable.

| Ruling | What was observed | What changed | Bound tests |
|---|---|---|---|
| **SL1B-COVER-EYEBROW** = follow the cover headline | `text-primary` eyebrow on the dark overlay: a black label on a dark photo | `coverTone().eyebrow` = `EYEBROW_BASE` + `border-current` + the cover headline class (default `text-white`), as the outline button and the numbers. Page and inverse eyebrows unchanged. The accent on cover keeps `text-primary` | plugins: "every style: a <p> …" (cover expects the headline class), "cover (ruling SL1B-COVER-EYEBROW): …" (default and the tokens `primary`, `foreground`, `white`; no `border-primary/30`), "cover: the accent keeps its § 4.2 default …"; serving `sl1b-hero-options` (`border-current text-white`) |
| **SL1B-INVERSE-BUTTON** = keep the fill, add an edge | `bg-primary` button on the `bg-foreground` panel, primary = foreground: the label readable, the button not visible | under `splitPanel: "inverse"` on `split` only, the first button's class is today's string (per shape) with `border border-background/40`, two complete literals in `FIRST_BUTTON_CLASS.inverse`. Fill (`bg-primary`) and label (`text-primary-foreground`) unchanged. **This amends the "First button" row of design § 6.5** ("unchanged" → "unchanged fill and label; `border border-background/40` added"); the design document itself is not edited (not allocated) | plugins: "ruling SL1B-INVERSE-BUTTON: …" (rounded, pill, with the outline button; `plain` / `null` / absent and center / cover keep today's string), case 1 and case 3 of § 6.5 updated; the baseline rows (absent / `plain` = today's string) unchanged and green; serving `sl1b-hero-options` (the split row) |

Teeth: before the tests were updated, the changed render failed exactly the four tests that asserted the old classes
(the eyebrow on cover, § 6.5 case 1 twice, case 3); every other test passed (EXECUTED).

## 7. Gates (each run bare; exit code by `echo $?`; EXECUTED on the final tree of revision 1, after a fresh root build)

| Command (from the repository root unless named) | Expected | Actual |
|---|---|---|
| `npm run build; echo $?` | 0 | 0 |
| `npm run typecheck; echo $?` | 0 | 0 |
| `cd packages/plugins && npm test; echo $?` | 0 | 0 — 8 files, 246 tests (38 in `hero.test.ts`) |
| `cd packages/shared && npm test; echo $?` | 0 | 0 — 22 files, 385 tests |
| `cd renderer && npm test; echo $?` | 0 | 0 — 41 files, 578 tests |
| `cd renderer && npm run test:serving; echo $?` | 0, no existing capture or expectation changed | 0 — 117 / 117 (115 existing + `sl1b-hero-options`, `sl1b-blank-as-absent`) |
| `cd admin && npm run test:unit; echo $?` | 0 | 0 — 13 files, 291 tests |
| `cd backend && npm run test:unit; echo $?` | 0 | 0 — 55 files (1 skipped), 1414 tests (1 skipped) |
| `cd tools/mcp-server && npm test; echo $?` | 0 | 0 — route coverage + 17 tool-shape tests |
| `git diff --check; echo $?` | 0 | 0 (the three new untracked files checked separately for trailing whitespace: no line) |

Not run: `cd backend && npm test` (packet: never). MCP `routes.json`: no backend route changed, not refreshed.

## 8. Findings

- **F-1B-PILL-EFFECT** (new, limitation): with `buttonShape: "pill"` AND a `buttonEffect`, the `<a>` is `rounded-full`,
  but `ButtonEffectWrap`'s effect shell keeps `rounded-lg` and its label chip `rounded-md`
  (`common/ButtonEffectWrap.tsx:71`, `:93`); the pill shows only without an effect. Not changed: `common/*` is allocated
  only for a token helper. Fix, if wanted: a shape prop on `ButtonEffectWrap` (its own slice).
- **F-1B-COVER-ACCENT** (ruling SL1B-COVER-EYEBROW): on a theme with a dark primary (the platform's default theme), the
  default accent (`text-primary`) on a cover photo is hard to read until the owner picks `headlineAccentColorToken`
  (e.g. `white`). Not changed: the design's § 4.2 default stands by ruling.
- **F-1B-COVER-COLOURS** (design gap, decided as D-1B-1, eyebrow ruled at staging): the design text of § 6.5 could gain a
  "cover" column.
- **F-SHOP-BLOCK-DOC** (pre-existing): closed for the hero rows (MCP hero entry, `docs/block-types.md:11`). Still open
  outside this slice: the MCP `add_block` type list (`index.ts:904-923`, after this slice) omits `videoHero` and `markdown`; the header
  line of `docs/block-types.md` ("18 custom plugins") and the MCP comment ("18 custom blocks") are stale (20 plugins).
- **F-SHOP-RADIUS-INERT**: not touched (non-scope).
- Generated maps: `packages/plugins/src/hero/*_MAP.md` and `test/MAP.md` are rmap output ("do not hand-edit"); they
  are stale for this change until the next `rmap` run. Not edited.
- Observed, not changed: `HeroRender.tsx` defines `cn()` (clsx + tailwind-merge) and never calls it (pre-existing).

## 9. Design lines that moved

Every line the packet's reading list cites was printed on `783e95f` and holds the cited text, except: the MCP hero entry
is `tools/mcp-server/src/index.ts:117-133` (design: `:120-125`; its `style` line `:124` holds), and the `add_block` type
list was `:891-911` (design: `:891-912`). Held: `hero/schema.ts:4-24`, `:14`, `:15-18`, `:19`; `hero/index.ts:19-37`,
`:23`, `:33`; `HeroRender.tsx:17`, `:83-111`, `:96`, `:97`, `:98`, `:114-153`; `HeroEditor.tsx:61-69`, `:78`, `:92`;
`resolveCoverColorTokens.ts:20-27`; `RenderBlocks.tsx:140`; `globals.css:7`; `docs/block-types.md:11`.

## Operator closeout

(left empty for the operator: a staging page with the cover hero of section 2, the four-item `features` strip of section
3 and the split inverse hero of section 6; screenshots at desktop and 390 px; the § 6.5 readability check — the computed
colour of the split headline and of the panel background, their WCAG contrast ratio recorded, in the light and the dark
theme, with the accent token `auto`; also D-1B-1: the cover's eyebrow, outline button and numbers on the photo; and the
first button's edge on the inverse panel.)

**Review.** Two builds, two reviews, both approved; the second build applies two operator rulings taken from the
staging check (SL1B-COVER-EYEBROW, SL1B-INVERSE-BUTTON; the second amends the "First button" row of
`shop-look-1.md` § 6.5). Builder `claude-opus-5-5`; reviewer `claude-sonnet-5-5` (fallback; the Codex reviewer was
out). Same provider family; not cross-vendor independence.

**Baseline check (operator).** `packages/plugins/test/hero.test.ts` with its baseline was run in a separate checkout
of `783e95f` (the code before this slice): the nine "absent / null / blank / empty / malformed → today's HTML" rows
pass there; the 26 rows of the new options fail there, as they must. So the baseline is the old render.

**Operator gates (2026-11-15, on the final tree).** Build, typecheck, shared, plugins, renderer, serving, admin unit,
backend unit, MCP, `git diff --check`: each exit 0. Protected paths, allocation, existing captures, trailing
whitespace: no line.

**Staging (deployed 2026-11-15, twice; each diff read first: three renderer functions, two bucket deployments, the
admin runtime config).** Tenant `cm1-content` (theme: primary equal to the foreground, near black), one published
probe page: the cover hero of section 2, a four-item `features` strip (section 3, no code) and the split inverse
hero of section 6. Chromium at 1400 px and 390 px.

| Check | First build | Final build |
|---|---|---|
| page served; no horizontal page scroll (both widths) | pass | pass |
| eyebrows, accents, second buttons, numbers, the four features on the page | pass | pass |
| pill buttons | pass | pass |
| cover eyebrow | black on the dark photo: not readable | the headline's colour (white): readable |
| inverse panel, first button | black on near black: the button not visible | the same fill with a light edge: visible |
| inverse panel: headline against the panel | 20.0 : 1 | 20.0 : 1 |

Limits of this evidence. The contrast figure for the panel TEXT (`text-background/80`) reads 20.0 because the
script's colour reader drops the alpha; the true blended value is lower (about 12 : 1 by calculation) and still above
4.5. The dark theme was not switched on: the panel uses the theme's own foreground and background pair, so its
contrast is the page's own, inverted. The block editor was not opened in a browser. The probe pages were archived.

**Finding kept open (F-1B-COVER-ACCENT).** On a cover hero the second tone of the headline defaults to the primary
colour; on a theme with a dark primary it is hard to read until the owner picks another token. Reported to the human.

Prod deploy: the human's.
