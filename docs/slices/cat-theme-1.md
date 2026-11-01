# CAT-THEME-1 — the theme details the glam catalog design needs (SPEC, draft)

Status: **RATIFIED 2026-11-01** (human; § 6: CT-D1 = A as read by the operator, CT-D2 = B, widths restated). Facts read in
the tree at `215ee53`. The design list (fonts, colours, shape, header/footer, catalog list, product page) came from the glamCRM
session's message of 2026-11-01; the human's rulings on it are quoted in § 1.

## 1. The human's direction (2026-11-01, quoted)

> "we may need to add support for 1440px? at least for the top bar width if not the pages too. and we need to
> support images that span the viewport width (I think we do). yeah so a theme slice for all the details would be
> needed. load more - NO - we are going to keep pagination. and optional third font for nav would be cute for all
> tenants (default to heading font if none set)."

## 2. Facts (OBSERVED)

| Item of the design list | Today | Where |
|---|---|---|
| Fonts | `fontHeading`, `fontBody` (free-text Google Font names); the loader requests weights **400 and 700** only | `packages/shared/src/index.ts:219-221`; `renderer/src/components/ThemeInjector.tsx:27-31` |
| Colours | primary (+ foreground), secondary (+ foreground), background, surface, text. **No** muted-text or hairline (border) token: they come from the framework defaults | `index.ts:205-217`; `renderer/src/app/globals.css` `@theme` |
| Corners | `radius` (free CSS length) → `--radius`; `0` gives square corners everywhere | `index.ts:224`; `ThemeInjector.tsx:69` |
| Shadows | not a setting; the floating quick contact and some cards use `shadow-lg` | `QuickContact.tsx:29` |
| Width | `header.contentMaxWidth`: a **Tailwind class name** from a list (5xl, 6xl, 7xl = 1280 px, screen-xl); the renderer is Tailwind 4 (`@import "tailwindcss"`, classes compiled from the sources), so a value absent from the sources is not compiled; `contentPageMaxWidth` (pages) the same way | `admin/src/pages/Settings.tsx:509-515`; `renderer/src/app/globals.css:1-9`; `index.ts:517` |
| Full-width images | yes: four block types are full-bleed by default, every block has a `blockWidth` attribute | `index.ts:86-88` |
| Header | logo height classes, nav links, the Commerce Bar CTA (shops only) | `Navbar.tsx:33-35`; `index.ts:140-143` |
| Footer | fixed `bg-muted/30` tint, `border-t`; no top border on the header | `app/[siteId]/layout.tsx:230` |
| Listing | 2 / 3 / 4 columns, 24 per page, Previous / Next; the facet panel with the count, chips and collapsible facets | `SitePage.tsx:1346,1403,1501`; `:411,:425`; `:1245-1300` |
| Card | square image, fixed title size, no category line | `SitePage.tsx:810-845` |
| Spec table | `dl` with an auto-width key column, hairline rows | `SitePage.tsx:943` |

## 3. The design (what changes; everything tenant-settable, defaults = today's bytes)

1. **Third font, every tenant.** `theme.fontNav?` (Google Font name; absent → the heading font). `ThemeInjector`
   emits `--font-nav`; the Navbar links use it. The loader keeps **400;700** by default; `theme.fontWeights?`
   (a list of additional weights, e.g. `[300, 500, 600]`) adds to that request — CT-D2 = B (human). Live sites,
   with no list, keep their `<link>` bytes.
2. **Two more colour tokens**: `theme.mutedColor?` (muted text) and `theme.borderColor?` (hairlines); absent → the
   framework defaults, so no live site changes. Settings → Typography / Theme gets the two inputs.
3. **Widths 1440 / 1600 / 1920 (human ruling, § 6).** Three new entries (`max-w-[1440px]`, `max-w-[1600px]`,
   `max-w-[1920px]`) in the width lists; the classes are written literally in the renderer source so that Tailwind 4
   compiles them. Three settings, set separately: `header.contentMaxWidth` (Top Bar, Commerce Bar, Navbar — as
   today), `contentPageMaxWidth` (pages — as today), and new `footer.contentMaxWidth?` (absent → the header's, which
   is today's behaviour: `layout.tsx:231` uses the header width for the footer). Every width is a `max-w-*` with
   `mx-auto`, so each collapses to the viewport on narrow screens exactly as today.
4. **Section spacing, separators, shadows, arrows**: a tenant "shape" preset `theme.shape?: "default" | "editorial"`.
   `editorial` = no shadows, 1 px hairline separators, wider section spacing, "↗" after links and buttons, a 3 px
   primary-colour top border on the header, the footer on the surface colour. Absent → `default` (today's bytes).
   Reason for a preset instead of six switches: the six move together in the design, and a preset is one row in the
   byte proof.
5. **Card**: `catalog.cardCategoryLine` (show the first category under the title; default off) and the image shape
   setting `theme.cardImage?: "square" | "landscape"` (245 px cover = landscape; default square).
6. **Spec table**: key column 50 % under the `editorial` shape (a `dl` grid template change), auto otherwise.
7. **Kept as is (human ruling):** pagination (no "load more"). **Not possible as asked:** per-element weights and
   tracking beyond the nav font; the heading at 300 is the heading font's weight choice (`theme.headingWeight?`,
   default 700 — one more optional field, included).

## 4. Decisions

- **CT-D1 — preset vs switches for the shape details (§ 3 item 4).** OPTIONS: **A** one `shape` preset (REWARD: one
  setting, one proof row, the design's details move together; RISK: a tenant that wants only some of them waits for a
  second preset). **B** six independent switches (REWARD: any mix; RISK: six settings, 64 combinations, six proof
  rows). RECOMMENDED: A.
- **CT-D2 — the font weights for every tenant (§ 3 item 1).** OPTIONS: **A** request 300–700 for every tenant (REWARD:
  one loader; RISK: a larger font download on every live site, one category-1 byte row). **B** request 400;700 unless
  the theme names other weights (`theme.fontWeights?`) (REWARD: live sites unchanged; RISK: one more field).
  RECOMMENDED: B.

## 5. Proof

Shop byte-identity suite (`cm1-identity-*`) unchanged for every live-tenant fixture (all new fields absent); a
fixture tenant with every new field set renders the editorial shape; the locale `before/` captures unchanged.

## 6. Ratification (2026-11-01)

Human, verbatim: "theme additional options third font, the 2 colors, 1440, 1600, 1920 px options too, for header,
page, footer, can be set separately (but of course they all should collapse just like they do now when the viewport
is narrowing like for mobile), and B for font weights, 400 and 700 but the theme should list additional weights
right". Applied in § 3 items 1–3. CT-D2 = B. CT-D1 (the `editorial` shape preset) was not lettered; the operator
reads the restated list as acceptance of A (reversible — say so and § 3 item 4 becomes six switches). Queue: after
`cat-quote-1`.
