# HEADER-COLOURS-1 — the site header takes its own background and text colour (implementation record)

Status: **BUILT** (2026-11-15, builder), uncommitted, awaiting review. Start: `main` at `542dafc`, tree clean. All 11
oracles of the packet's § 5 pass on the final tree (§ 9): serving contract 111 / 111 (109 existing rows unchanged + 2
new `hc1-*` rows). Two allocation additions (§ 8): `backend/src/tenant/settings.ts` (PUT /settings did not check the
header) and `backend/ARCHITECTURE.md` (its ripple). Maturity: the two settings are **PROTOTYPE** until the operator
sees them on staging; the mechanism is the footer's (BULK-PURGE-FOOTER-1, deployed 2026-11-14).

## 1. Human direction (quoted)

> "I am also wondering whether we should support a different color header as well" … "for now yeah queue it but it will
> likely be a light tint."

## 2. The precedent (BULK-PURGE-FOOTER-1, `docs/slices/bulk-purge-footer-1.md` § 3)

- Shared: `footer.backgroundColor` / `footer.textColor`, each `CssColorSchema.optional()`; `isCssColor` is the one
  colour rule.
- Renderer: `layout.tsx#footerColorStyle` — inline `style` on `<footer>`, added by a conditional spread only when a valid
  colour is set; text by re-declaring `--color-foreground` and `--color-muted-foreground` (not `--foreground`: `@theme`
  resolves `--color-foreground: var(--foreground)` on `:root`).
- Admin: `FooterColorControls` + `withFooterKey`, the palette's `ColorInput`, "Navbar & Layout" card, one fragment slot.

This slice extends it. It does not contradict it.

## 3. The background mechanism and its proof

**Chosen: re-declare `--color-background` on the `<nav>`** (the preferred mechanism of packet § 1 item 2).

Proof on the built CSS (EXECUTED: `renderer/.next/static/chunks/*.css` after the root build, and asserted on every
serving run by row `hc1-header-colours`):

```
.bg-background,.bg-background\/60{background-color:var(--color-background)}
.bg-background\/80{background-color:var(--color-background)}
@supports (color:color-mix(in lab, red, red)){.bg-background\/80{background-color:color-mix(in oklab,var(--color-background)80%,transparent)}}
:root,:host{… --color-background:var(--background) …}      (globals.css @theme, not `inline`)
```

So the three background utilities of the navbar — `bg-background/80` on the `<nav>` (`Navbar.tsx:118`), `bg-background`
on the desktop dropdown panel (`:154`) and on the mobile panel (`:235`) — all read `--color-background`. Both panels are
DOM descendants of the `<nav>` (the mobile panel is `absolute`, but inheritance follows the DOM, not the layout), so one
declaration on the `<nav>` colours all three, in the full and the scrolled state. The bar keeps its 80 % translucency
and its `backdrop-blur`. Where a browser has no `color-mix`, the bar is opaque in the chosen colour — as it is opaque in
the theme colour today.

Chromium proof (EXECUTED, temporary Playwright spec on the real build, deleted after the run; copy and logs in
`.agent-manager/slices/HEADER-COLOURS-1/`): tenant `hc1-colours` (`#f5f1ea` / `#1f2937`) against its twin `hc1-plain`:

| Element | Colours tenant | Twin (no colours) |
|---|---|---|
| `<nav>` background, full and scrolled, desktop and phone | `oklab(0.959303 0.00150734 0.01017 / 0.8)` = the browser's value of `color-mix(in oklab, #f5f1ea 80%, transparent)` | `oklab(0.999994 … / 0.8)` (white 80 %) |
| `<nav>` backdrop filter | `blur(8px)` | `blur(8px)` |
| desktop dropdown panel (open; and open after scroll) | `rgb(245, 241, 234)` | `rgb(255, 255, 255)` |
| mobile panel (open; and open after scroll) | `rgb(245, 241, 234)` | `rgb(255, 255, 255)` |
| title, links, menu button, chevron / menu / user icons | `rgb(31, 41, 55)` | `rgb(2, 8, 23)` title and menu button, `rgb(100, 116, 139)` links |
| "About" link on hover (after the 150 ms transition) | `rgb(0, 0, 0)` = this theme's Primary | `rgb(0, 0, 0)` |
| Top Bar; Commerce Bar; footer | equal to the twin | — |

Rejected: `background-color` on the `<nav>` (the footer's way). It would make the bar opaque (an inline
`background-color` beats the `bg-background/80` class) and leave both panels on the theme background, which breaks rule
§ 1 item 2 (text chosen for the header must stay readable in the panels).

## 4. What changed (file:line at the end of the build)

| File | Change |
|---|---|
| `packages/shared/src/index.ts:623-627` | `HeaderConfigSchema` + `backgroundColor`, `textColor`: `CssColorSchema.optional()`, no default |
| `renderer/src/app/[siteId]/layout.tsx:70-96` | `headerColorStyle(header)`: `--color-background` and/or the two text variables; `undefined` when neither value passes `isCssColor` |
| `renderer/src/app/[siteId]/layout.tsx:197`, `:311` | `const headerStyle = headerColorStyle(config.header)`; `{...(headerStyle ? { colorStyle: headerStyle } : {})}` on `<Navbar>` |
| `renderer/src/components/Navbar.tsx:44`, `:83-88`, `:118` | optional prop `colorStyle?: React.CSSProperties`; `<nav … style={colorStyle}>` (no prop → React writes no `style` attribute) |
| `backend/src/tenant/settings.ts:140`, `:157` | `HeaderColorsSchema = HeaderConfigSchema.pick({ backgroundColor, textColor })`, checked on an object `header` (allocation addition, § 8) |
| `admin/src/pages/Settings.tsx:215-244`, `:901` | `withHeaderKey`, `HeaderColorControls` ("Header Colours": Background, Text, help line "Empty = theme default (light and dark)."), first in the footer groups' fragment slot |
| tests | `packages/shared/test/header-colours-1.test.ts` (new); `renderer/test/unit/header-colours-1.test.ts` (new); `renderer/test/serving-contract/fixtures.mjs:751-779` (`HC1`), `contract.test.mjs:2788-2858` (rows `hc1-*`); `admin/src/pages/Settings.test.ts` (one more excluded group, two mutation controls, `describe` at `:421`); `backend/test/unit/cat-theme-settings.test.ts:163` |
| docs | `renderer/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md`, `backend/ARCHITECTURE.md` |

No infra change, no new dependency, no theme-palette change, no dark-mode variant.

**Step 1 enumeration (before any edit).** Captured lines a page changes when both values are UNSET: none. Basis: the
layout adds the prop only by a conditional spread, and the Navbar's `style={undefined}` writes no attribute. Confirmed
(EXECUTED): oracle 5 passes with no expectation changed; and the control of § 6 shows that the capture rows would see
a difference.

## 5. Taxonomy → tests (all EXECUTED, pass)

| Input | State | Expected | Test |
|---|---|---|---|
| both values | absent | no style, no new prop; server render byte-equal to the base for catalog, commerce and content | unit `header-colours-1.test.ts` "[content\|commerce\|catalog] both values absent" (nav tag, no `colorStyle` key in the Navbar element's props, no `--color-` in the HTML); serving: every existing capture row unchanged — `cm1-identity-commerce`, `cm1-identity-content`, `loc1-diff-cdl-2` (all en-US subjects, the catalog tenants included), `loc1e-*`, `cq1-*`, `ct1-*`; control § 6 |
| `backgroundColor` | valid | nav, dropdown panel and mobile panel show it, full and scrolled | unit "only one value valid" (style has `--color-background` only), jsdom "the desktop dropdown panel and the mobile panel are inside the styled `<nav>` … full and scrolled"; serving `hc1-header-colours` (compiled `.bg-background`, `.bg-background/80` both forms read `--color-background`); Chromium proof § 3 |
| `textColor` | valid | title, links, icons, menu button show it; hover stays Primary; contact button unchanged | jsdom "text: the title, the links, the icons and the menu button …" (every text-colour class in the open header is one of `text-foreground`, `text-muted-foreground`, `hover:text-primary`, `text-primary-foreground`; icons carry no colour class); serving `hc1-header-colours` (compiled `.text-foreground`, `.text-muted-foreground`, `.hover:text-primary:hover`→`--color-primary`, `.bg-primary`, `.text-primary-foreground`); Chromium proof § 3 |
| either value | invalid (`red; x:y`, `url(…)`, `#12`, `var(--x)`, `""`, a number) | ignored, as absent | unit "[kind] an invalid value is ignored" (HTML byte-equal, no prop); serving `hc1-header-invalid` (`red; x:y` / `url(https://…)` stored: today's `<nav>`, no `colorStyle`, HTML and payload equal to the twin) |
| only one of the two | valid | only that one applies | unit "[kind] only one value valid" (background only; text only with an invalid background) |
| `PUT /settings` | invalid colour | refused | `backend/test/unit/cat-theme-settings.test.ts` "PUT /settings — header colours": 400 naming `header.backgroundColor` / `header.textColor`, nothing read or written; valid values written as sent; other header keys and a non-object header unchanged. Before the backend change the refusal test FAILED (EXECUTED) — § 8 |
| admin | set, then cleared | saved under `header.backgroundColor` / `header.textColor`; clearing removes the key | `admin/src/pages/Settings.test.ts` "Settings — the header colours" (placement on every site kind, empty/stored values, set → cleared, other header keys kept, draft not mutated); capture rows minus exactly one more group |
| Top Bar / Commerce Bar / Search Bar shown with header colours set | — | their markup is unchanged | unit "[kind] both values valid … every other byte is unchanged" + the "control" test (both bars are in the compared HTML, before the `<nav>`); serving `hc1-header-colours`: `/` and `/shop` (search bar present) — HTML equal to the twin but for the `<nav>` tag, payload rows equal but for `colorStyle` |

Shared schema: `packages/shared/test/header-colours-1.test.ts` (absent stays absent, valid accepted, each invalid value
refused naming its field).

## 6. Controls (EXECUTED, each restored)

| Mutation | Result |
|---|---|
| layout passes `colorStyle={headerStyle}` unconditionally | unit: 6 rows fail (absent + invalid × 3 kinds); serving: 11 rows fail — `cm1-identity-commerce`, `cm1-identity-content`, `loc1-diff-cdl-2`, `loc1e-category-controls`, `loc1-flight-controls`, `cq1-quote-channels`, `cq1-bars-own`, `ct1-footer-width`, `loc1e-404-document`, `hc1-*` |
| admin: `HeaderColorControls` not in the excluded groups | 3 rows fail (content capture, commerce capture, mutation controls) |
| backend: no header check (the base) | the refusal test fails |

## 7. Abstractions (one line each)

- `headerColorStyle` (layout.tsx) — the `<nav>`'s colour style; user: the layout's `<Navbar>` (1); axis: none new — a
  second small function beside `footerColorStyle` because the background mechanism differs (a variable here, the
  property there); rejected: one shared helper with a flag that changes what it emits (packet § 2 forbids it).
- `Navbar` prop `colorStyle` — the server-to-client DTO (a plain object of strings); user: the layout (1); rejected:
  passing the two raw colours and building the style in the client (moves the colour rule and the CSS mechanism into
  the client component, away from `footerColorStyle`); rejected: a wrapper `<div style>` around the Navbar (adds an
  element to every coloured header and breaks the header-clearance test's part-by-part measurement).
- `withHeaderKey` (Settings.tsx) — sets or removes one header colour key; users: the two colour inputs (2); rejected:
  one generic helper shared with `withFooterKey` (renames that export and its tests for four lines of logic); rejected:
  `updateHeader` (it cannot remove a key, so "clearing removes the key" would fail).
- `HeaderColorControls` (Settings.tsx) — exported so the capture test can remove exactly this group (the footer's
  procedure); user: the Navbar & Layout card (1).
- `HeaderColorsSchema` (settings.ts) — the two keys PUT /settings checks; user: `themeAttributesError` (1); rejected:
  the whole `HeaderConfigSchema` (it would refuse stored headers with odd legacy values, and a non-object header, which
  are accepted today).
- Test-only: fixtures `HC1`, `hc1Fields`; contract helpers `hc1Page`, `rowsOf`, `firstDiff`.

## 8. Allocation additions

1. `backend/src/tenant/settings.ts` — the packet expected no backend source change ("settings are validated by the shared
   schema"). OBSERVED: PUT /settings checks only the new theme fields, `footer`, `contactChannels` and
   `interestListEmail`; it never parsed `header`. EXECUTED: the new refusal test failed against the unchanged handler, so
   a stored `header.backgroundColor: "red; x:y"` was accepted. Smallest change: the two header colour keys, on an object
   `header` only, inside the existing check (same place, same message form, before any read).
2. `backend/ARCHITECTURE.md` — 2 lines: the ripple of item 1 (it describes that check).

## 9. Gates (each run bare; exit code printed by `echo $?`; EXECUTED on the final tree)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run build` (root) | 0 | |
| 2 | `npm run typecheck` (root) | 0 | |
| 3 | `cd packages/shared && npm test` | 0 | 311 / 311 |
| 4 | `cd renderer && npm test` | 0 | 463 / 463 |
| 5 | `cd renderer && npm run test:serving` | 0 | 111 / 111; no expectation changed |
| 6 | `cd admin && npm run test:unit` | 0 | 265 / 265 |
| 7 | `cd backend && npm run test:unit` | 0 | 1335 / 1335 (+1 skipped) |
| 8 | `cd packages/plugins && npm test` | 0 | 204 / 204 |
| 9 | `cd tools/mcp-server && npm test` | 0 | 15 / 15 (no route change; `routes.json` unchanged) |
| 10 | `git diff --check` | 0 | |
| 11 | `git status --porcelain -- renderer/test/serving-contract` | — | only `contract.test.mjs` and `fixtures.mjs` modified; no `before/`, `after/`, `baseline/` or `expected*` file |

## 10. What a visitor sees with a light tint (for example `#f5f1ea`, dark text `#1f2937`)

- **Desktop, top of the page:** the Top Bar and (on a commerce site with the bar on) the Commerce Bar keep the theme's
  colours; under them the navbar is the tint at 80 % with the page blurred behind it. The site title, the links and the
  chevrons are the dark text colour; a link turns Primary on hover; the "Contact" button stays Primary / Primary Text.
  A dropdown opens as a solid tint panel with the same dark text.
- **Desktop, scrolled:** the bar shrinks as before; its colour, the blur and the open dropdown stay the same.
- **Phone:** the bar is the tint; the cart/interest icon and the menu button are the text colour. The menu opens as a
  solid tint panel under the bar, its links in the text colour, the "Contact us" button Primary. Scrolled: the same.

## 11. Findings

1. **PUT /settings did not validate `header` at all** (pre-existing; fixed for the two new keys only, § 8). The other
   header keys (`navHeight`, …) remain unvalidated, as before.
2. **Packet fact correction:** the Search Bar is not in the layout's sticky wrapper; it is rendered by `SitePage`
   (`renderer/src/components/SitePage.tsx:1084` and three more call sites) at the top of the page body. It is outside
   the `<nav>` in both cases; row `hc1-header-colours` compares it on `/shop`.
3. **A seam on commerce sites:** the Commerce Bar keeps the theme background (`bg-background/80`, a sibling of the
   `<nav>`), so a tinted navbar sits under a white Commerce Bar. Bar colours are non-scope (§ 7 of the packet).
4. **Dark logo on a dark header:** the logo is not changed; a logo with dark parts loses contrast on a dark header.
   Not solved (non-scope: a second logo).
5. **One value for light and dark:** a site in dark mode that sets only a light background keeps the dark theme's light
   text on it, which is unreadable. Set both values (same as the footer).
6. **Hover is Primary:** on a background close to Primary, a hovered link is hard to read; with a text colour close to
   Primary, the hover is not visible. The panels' hover fills (`hover:bg-muted`, `hover:bg-muted/50`) stay the theme's
   Muted. A light tint is fine with the usual themes.
7. **Cart and interest widgets** (inside the `<nav>`) hover to `text-foreground`, which is now the same colour as their
   normal state: no visible hover change on them. Their count badges stay Primary. The interest widget's storage notice
   (`bg-background text-foreground`, inside the `<nav>`) takes the header colours — consistent with the panels.
8. **Name mismatch (not renamed):** `themeAttributesError` (`backend/src/tenant/settings.ts`) checks `theme`,
   `darkTheme`, `footer` and now `header`. The name says "theme". Proposed rename: `appearanceAttributesError`. Local
   (one definition, one call site), but outside this slice's purpose — for the operator to rule.
9. A tenant record that never stored a `header`: setting a header colour saves `header: { backgroundColor }` only; the
   renderer reads each absent header key as the Navbar's default. The existing `updateHeader` already does this for its
   keys (documented at `withHeaderKey`).
10. The admin's `tsc -p .` checks no file (`admin/tsconfig.json` has `files: []`); the package's `npm run typecheck`
    (`tsc -b`) does. Noted because a quick `tsc -p .` reports a false green there.

## 12. What could not be determined

- Safari / iOS rendering of `color-mix` and `backdrop-filter` (only Chromium was run). An old browser without
  `color-mix` shows an opaque bar in the chosen colour (from the compiled fallback rule) — INFERRED from the CSS.
- The admin colour inputs in a real browser (only the static render and the handlers were tested).
- Staging (operator).

## 13. Operator closeout


Operator, 2026-11-15. Review-0 approved (reviewer `gpt-6.1-sol`, builder `claude-opus-5-5`, one cycle).

**Allocation addition accepted.** `backend/src/tenant/settings.ts` (+ `backend/ARCHITECTURE.md`): the packet said the
settings route validated header values through the shared schema. It did not: `header` was stored as sent. The
build added a check of the two new colour keys only; the older header keys stay unvalidated, as before.

**Gates (operator run on the approved tree).** build 0, typecheck 0, shared 0, plugins 0, renderer 0, serving 0, admin
unit 0, backend unit 0, mcp 0, `git diff --check` 0. Oracles: no change under `infra/`, `tools/`, any `package.json`;
every changed path is in the allocation plus the accepted addition; no capture or expectation file changed; no
trailing whitespace in the new files.

**Staging.** `cdk diff`: code and asset hashes only; no resource added or removed, no permission change. Deployed
to `AmodxStack-staging`. Evidence on tenant `glam-staging`, by script and Chromium:

| Check | Result |
|---|---|
| `PUT /settings` with `header.backgroundColor: "red; x:y"` | 400, "header.backgroundColor: must be a CSS colour: …" |
| `PUT /settings` with `#F5E9EC` / `#5A1626` | 200; stored under `header.backgroundColor` / `header.textColor`; the four other header keys kept |
| Desktop 1400 px, `/shop`, full and scrolled | navbar background = the tint at 80 % (the navbar keeps its translucency); title and links `rgb(90, 22, 38)`; the header stays pinned |
| Phone 390 px | the same background and text colour |
| Colours removed | 200; the stored header equals the one before the check |

Seen in the screenshot: the Search Bar under the navbar keeps its own colour, the contact button keeps Primary.

Not checked: the desktop dropdown panel and the opened mobile panel in a browser (unit tests and the built-CSS proof
bind them); the admin "Header Colours" control in a browser; Safari.
