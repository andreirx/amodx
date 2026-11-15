# SHOP-LOOK-1 — the features a commerce site needs to look like the reference shop

Status: **PLANNED 2026-11-15** — design (SPEC) only. No code change. The three DECISION_REQUIRED blocks of § 10 go to
decision review, then to the human. Implementation starts only after the rulings, slice by slice (§ 9).
Revisions: revision 0 (2026-11-15). Revision 1 (2026-11-15) answers review-0 (six findings); § 16 maps each finding to
the rule that closes its class. Revision 2 (2026-11-15) answers review-1 (one finding, § 16.1).
Track: commerce look (site chrome, block plugins, renderer; one backend handler for the contact form).
Depends: none for the design. It builds on `header-colours-1` (header colours), `bulk-purge-footer-1` (footer colours),
`category-content-1` (blocks on category pages) and `cat-theme-1-impl` (theme options, the byte rule of its § 2).
Source plan: none. The builder packet of 2026-11-15 and the human direction (§ 1.1) are the plan.
Maturity target: every new setting and block attribute starts **PROTOTYPE** in its slice and becomes **MATURE** when
its slice has run on staging with the reference page built from it (§ 9, staging evidence).
Basis: `main` at `e6394652c75f93cf5234b651b9dcfd72fc7d952c` (tree clean at start, § 12 E1). Every file:line in this
document was read at that commit.

## 1. Purpose

### 1.1 The human direction, quoted

2026-11-14:

> "what it would take to make a commerce enabled site for glamour floors (separate from the catalog site) that would
> look and feel like https://efloorcovering.com/ … we should have the features necessary to make a commerce site look
> like this."

2026-11-15:

> "I forgot to follow up on those gaps with the efloorcovering site. yes let's do those slices."

> "the only commerce 'freeze' is not moving the entries to a separate table yet … no reason not to fix things that can
> be fixed right now"

Settled by this direction: commerce blocks, settings and pages may change. The move of commerce entries to a separate
table stays on hold; this design does not touch it.

### 1.2 The reference

The reference is the description of the human's six screenshots in the builder packet (§ 0 of the packet). Nobody in
this slice saw the screenshots. This design uses only that description and invents no other detail. The eleven
sections:

1. Header, two rows. Row 1: logo with a small tagline beside it ("SINCE 1998"), main navigation links, a pill button
   "Get help" at the right. Row 2: a secondary bar of category links.
2. Hero: full-width photo with a dark overlay; a small pill label above the headline (eyebrow); a serif headline in two
   tones; a short text; two buttons (one filled, one outline); a row of three numbers with captions.
3. Feature strip: four items, each an icon with a title and a line of text.
4. "Browse by flooring type": a grid of tall category cards — a photo, with the title, a short description and
   "SHOP CATEGORY" over it.
5. A row of link chips under that grid.
6. "Heritage": a photo beside a dark band of text.
7. "Install & care essentials": product cards with a badge ("TOP PICK", "POPULAR"), a small category label above the
   title, a short text, the price, a rating, and a "View all picks" link.
8. "Guides": left, a text, a quote and a button; right, a list of link cards.
9. "Not sure where to start?": a contact form in a card — Name, E-mail, a select "Primary interest", a textarea.
10. Footer: dark, a brand text and three link columns (Explore, Company, Categories).
11. Overall: serif headings, pill buttons, wide margins, small coloured labels above section headings.

### 1.3 Risk retired

Today an owner cannot build sections 1 (row 2 and the tagline), 2 (eyebrow, two tones, second button, numbers), 4, 5,
6, 7 (badge, label, short text, rating), 8, 9 (the select) and 10 (named columns, brand text) with the blocks and
settings that exist (§ 2). After the four implementation slices of § 9, an owner builds the whole reference page from
Settings and blocks, with no code per tenant, and no existing site changes until its owner sets a new field.

### 1.4 Non-scope

The stock or price-list import. A separate table for commerce entries. A second site kind. A page builder (blocks
inside columns). Pricing per m², pack sizes and minimum quantities (reported in § 8, not designed). The product card on
the shop, category and search pages (§ 7.5). The catalog-site showcase (§ 7.5). A rename of `categoryShowcase`
(finding F-SHOP-SHOWCASE-NAME, § 13). Other slice documents, the ROADMAP and `CURRENT_SLICE.md`.

### 1.5 Architectural boundaries

- Tenant isolation: every new read is a `GetCommand` or `QueryCommand` with `PK = TENANT#<request tenant>` (§ 6.4).
- No DynamoDB scan: no new list read; the new reads are keyed `GetCommand`s and the existing category and review
  Queries (§ 6.4).
- Plugin split entry: the new block has an `admin` part (Tiptap editor) and a `render` part (SSR-safe React); no import
  from `admin/` or `renderer/` into the plugin package (`docs/plugin-architecture.md`).
- Shared-first: every new setting goes to `packages/shared/src/index.ts` first (§ 4).
- Data across boundaries stays raw: settings are plain JSON in the tenant item; block attributes are plain JSON in the
  page item; the server preparation pass adds plain fields to block attributes (the existing `prepareBlocks` mechanism,
  `renderer/src/components/SitePage.tsx:756`).
- No hardcoded colours (Critical Rule 6): every new element uses theme classes (`bg-primary`, `text-foreground`,
  `bg-foreground`, `text-background`, `text-muted-foreground`).
- No infra change. No new Lambda, route or table.

## 2. Inventory

### 2.1 Method and completeness basis

1. Block types: the plugin registry `REGISTRY` (`packages/plugins/src/admin.ts:23-44`, 20 plugins), checked against
   `RENDER_LOADERS` (`packages/plugins/src/render.ts:23-44`, the same 20 keys) and the core types of `RenderBlocks`
   (`renderer/src/components/RenderBlocks.tsx:78-86`: `paragraph`, `heading`, `bulletList`, `orderedList`, `listItem`,
   `blockquote`, `horizontalRule`). Every plugin schema was read for the sections it could serve (§ 12 E2). Basis of
   the completeness claim: the registry is the array the admin toolbar and the editor extensions are built from
   (`admin.ts:47-54`) and `RenderBlocks` renders only `PLUGIN_COMPONENTS` and `CORE_COMPONENTS`
   (`RenderBlocks.tsx:114-120`), so a block type outside these lists cannot appear on a page. `docs/block-types.md` was
   not used as a source (it is stale, F-SHOP-BLOCK-DOC).
2. Site chrome: `renderer/src/app/[siteId]/layout.tsx` read in full (405 lines); `renderer/src/components/Navbar.tsx`
   read in full (324 lines).
3. Settings: `HeaderConfigSchema`, `FooterConfigSchema`, `ThemeSchema`, `TenantConfigSchema` link fields,
   `ProductSchema`, `CategorySchema`, `FormFieldSchema`, `OrderItemInputSchema` read in
   `packages/shared/src/index.ts`; the whitelist `mapTenant` (`renderer/src/lib/dynamo.ts:120-188`) read in full, to
   know which settings reach the renderer.
4. Custom forms: `git grep -E 'getFormBySlug|DynamicForm'` over the current source trees for a caller of the form
   component and its read, plus two `git log -S` searches for two literal spellings (§ 12 E5). The search proves "no
   caller in the searched current source"; it does not prove that no earlier commit ever placed the form under another
   spelling. Any historical statement in this document is INFERRED.
5. Admin editors: for each block, its `*Editor.tsx` in `packages/plugins/src/<block>/`; for each setting, the card of
   `admin/src/pages/Settings.tsx` or the page that writes it (§ 12 E16). A cell that names no editor says "none" and
   the search that found none.

### 2.2 The table

Label column: **O** = OBSERVED (the cited code was read), **I** = INFERRED (concluded, not run). Paths: block files are
under `packages/plugins/src/`; `index.ts` alone = `packages/shared/src/index.ts`; `Settings.tsx` =
`admin/src/pages/Settings.tsx`. "none (searched: …)" = no such item exists; the search is named.

| § | What a tenant can build today | Schema | Render | Admin editor | Gap | Label |
|---|---|---|---|---|---|---|
| 1 row 1 | Logo, site name, main links with dropdowns, a pill button at the right ("Get help" = Labels → `navContact`; target fixed to `/contact`). On a commerce site the row also shows the sign-in link and the cart (`Navbar.tsx:191-204`); with the Commerce Bar on, the pill is hidden and the bar's own button replaces it (`renderer/src/app/[siteId]/layout.tsx:294`) | `HeaderConfigSchema` `index.ts:607-628`; `logo`, `navLinks` `:1157` (`LinkSchema` `:59-66`) | `renderer/src/components/Navbar.tsx:122-138` (logo, title), `:141-190` (links), `:206-214` (pill `rounded-full`, `href` `/contact` at `:209`) | `Settings.tsx:620-635` (logo), `:666-674` (site name), `:1512-1602` (Navigation Menu); `admin/src/pages/Labels.tsx:364` (button text) | A tagline beside the logo | O |
| 1 row 2 | Nothing in the header. The shop page alone shows the active categories as pill links | none for a second header row (searched: `HeaderConfigSchema` `index.ts:607-628`) | shop page only, `renderer/src/components/SitePage.tsx:1580-1585` | categories: `admin/src/pages/CategoryEditor.tsx:182-188` (status), `:225` (sort order); none for a header row (searched: `Settings.tsx` cards, § 12 E16) | A second header row of category links | O |
| 2 | Hero style `cover`: full-width photo, overlay with colour and opacity tokens, headline, text, ONE button | `hero/schema.ts:4-24` (`style` `:14`, overlay `:15-18`); Tiptap attributes `hero/index.ts:19-37` | `hero/HeroRender.tsx:114-153`; button class `rounded-md` `:17` | `hero/HeroEditor.tsx:61-69` (style), `:78` (headline), `:92` (button text) | Eyebrow; a second tone in the headline; a second (outline) button; a row of numbers; pill buttons | O |
| 3 | `features`: 2-6 columns, icon, title, text; layout stacked or inline; headline optional | `features/schema.ts:4-24` (`columns` `:19`, `layout` `:20`) | `features/FeaturesRender.tsx:18-24` (4 columns = `md:grid-cols-2 lg:grid-cols-4`), `:30` (headline only when set) | `features/FeaturesEditor.tsx:38` (columns), `:45` (layout), `:59-60` (headline, subheadline "leave empty to hide") | None. Build: `features`, columns "4", headline and subheadline empty | O |
| 4 | Category data: name, description, image, order, status. No block shows categories as tiles; `categoryShowcase` shows the PRODUCTS of one category | `CategorySchema` `index.ts:1592-1622` (description `:1598`, image `:1605`) | none for tiles (searched: the 20 plugin renders, § 2.1); products of one category: `category-showcase/CategoryShowcaseRender.tsx:138-150`, prefetch `SitePage.tsx:770-795` | `admin/src/pages/CategoryEditor.tsx:230` (description), `:254` (image), `:225` (order), `:182-188` (status); showcase category picker `category-showcase/CategoryShowcaseEditor.tsx:15-28` | A category tile grid block | O |
| 5 | No block. Pill links exist only on the shop page (row "1 row 2") | none (searched: the 20 plugin schemas) | shop page only, `SitePage.tsx:1580-1585` | none (searched: the 20 plugin editors) | A row of link chips | O |
| 6 | Hero `split`: image right (first on a phone), text left on the page background. `cta` style `band`: a `bg-primary` band, no photo. `columns`: raw text only, no image | hero `style` `hero/schema.ts:14`; `cta/schema.ts:9`; `columns/schema.ts:6` | `HeroRender.tsx:83-111` (headline `text-foreground` `:97`, text `text-muted-foreground` `:98`); `cta/CtaRender.tsx:16-31`; `columns/ColumnsRender.tsx:25-26` | `HeroEditor.tsx:61-69`; `cta/CtaEditor.tsx:39-40` (style); `columns/ColumnsEditor.tsx:32-59` (columns, text) | A dark (inverse) text panel on hero `split` | O |
| 7 | `categoryShowcase` card: image, title, price (sale, volume range), out-of-stock overlay; a pill link to the category with the block's `ctaText` ("View all picks") | `category-showcase/schema.ts:3-12`; Tiptap `category-showcase/index.ts:25-36` | `CategoryShowcaseRender.tsx:23-67` (card), `:155-163` (link, `rounded-full`) | `CategoryShowcaseEditor.tsx:15-28` (category), `:46` (show price), `:50-56` (columns), `:59` (limit), `:112-113` (link text) | Badge, category label above the title, short text, rating (§ 7) | O |
| 8 | `postGrid`: list or grid of posts by tag. It cannot sit inside `columns` (raw text, row 6). No block puts a text, a quote and a button beside a list | `post-grid/schema.ts:3-12` | `post-grid/PostGridRender.tsx:103-105` (headline, layout switch) | `post-grid/PostGridEditor.tsx:48-49` (layout), `:60` (headline), `:67-68` (tag), `:80-81` (limit) | A side panel (text, quote, button) beside the post list | O |
| 9 | The `contact` block: fixed fields Name, E-mail, Message; no select; no card. Custom forms with a `select` field exist in the schema, the admin, the backend route and the renderer component, but no caller of the component or of its read was found in the searched current source (§ 12 E5): a custom form cannot be placed on a page | contact `contact/schema.ts:4-12`; custom forms `FormFieldSchema` `index.ts:2103-2110` | contact `contact/ContactRender.tsx:86-121`; custom forms `renderer/src/components/DynamicForm.tsx:105-116` (select), read `renderer/src/lib/dynamo.ts:778`, submit route `infra/lib/api-engagement.ts:224` | contact `contact/ContactEditor.tsx:37` (headline), `:38` (helper text), `:41` (button), `:42` (tags); custom forms `admin/src/pages/FormEditor.tsx:27` (select type), `:354-358` (options), routes `admin/src/App.tsx:116-117` | A select on the contact form; a card look (decision SHOPLOOK-FORM) | O (I for history) |
| 10 | A dark footer works (footer colours). Three columns: company details, ONE link column with the fixed heading `site.footerLinksHeading` ("Links"), legal links | `FooterConfigSchema` `index.ts:636-640`; `footerLinks` `:1158` | `layout.tsx:60-68` (colours), `:328-375` (footer; links heading `:348`) | `Settings.tsx:1395-1420` (Footer Links: label and href only), `:902-903` (footer width, colours), `:1334` (Company Details); `admin/src/pages/Labels.tsx:385` (links heading) | A brand text; named link columns with their own headings | O |
| 11 | Serif headings (default "Prata"). Wide margins (site and page widths, the editorial section gap, `cat-theme-1-impl.md` § 3). Pill buttons: the nav button and the showcase link only. No label above a heading in any block. `theme.radius` does not reach the buttons: only the bare class `rounded` reads `--radius`; `rounded-md` reads `--radius-md` (F-SHOP-RADIUS-INERT) | `ThemeSchema` `fontHeading` `index.ts:307`, `radius` `:311`; `header.contentMaxWidth` / `contentPageMaxWidth` `:620`; label: none (searched: the 20 plugin schemas) | `renderer/src/app/globals.css:47-48`, `renderer/src/components/ThemeInjector.tsx:124-125` (headings), `:111` (`--radius`) | `Settings.tsx:2134-2136` (heading font), `:747`, `:757` (widths), `:2257-2259` (Border Radius) | Small coloured labels above section headings; pill buttons on the hero | O (fonts, widths); O on a local build artefact (radius, E9) |

### 2.3 Corrections to the operator's first reading

| § | Operator's line | Correction (evidence) |
|---|---|---|
| 2 | "hero has one button" → gap includes "photo background with overlay" | The photo background with overlay exists: hero style `cover` (`hero/schema.ts:14-18`, `HeroRender.tsx:114-153`). `docs/block-types.md:11` lists only "center, split, minimal" — the doc is stale (F-SHOP-BLOCK-DOC). The gap is the eyebrow, the second tone, the second button, the numbers and the pill shape |
| 6 | "hero split / columns, roughly" | `columns` cannot hold a photo (raw text only, `columns/schema.ts:6`). Hero `split` has the photo but no band colour. Gap: one option on hero `split` |
| 7 | "product cards, partly" | The home-page card is the `categoryShowcase` card, not the shop card. It has none of badge, label, short text, rating. The theme's category line (`theme.cardCategoryLine`) exists only on the shop/category/search card and sits UNDER the title (`SitePage.tsx:866`) |
| 8 | "`postGrid` inside `columns`, roughly" → "polish only" | Not possible: `columns` holds raw text, not blocks. The gap is a side panel on `postGrid` |
| 9 | "custom forms exist; verify a select field" | The select exists in custom forms, but no caller of the form component or its read was found in the searched current source, so a custom form cannot be placed on a page (F-SHOP-FORMS-UNPLACED). The placeable form (`contact`) has no select |
| 11 | "theme fonts and shape exist" | Fonts: yes. Shape: `theme.radius` does not change the buttons (F-SHOP-RADIUS-INERT) |
| 4 | "`categoryShowcase` lists the PRODUCTS of one category" | Correct. Also: the renderer's category list read does not project `description` (`dynamo.ts:329`) |

## 3. Design per gap

Rule (packet § 1 item 2): (a) a new option on an existing block or setting; (b) a new block; (c) nothing, built
today. Default (a).

| § | Choice | Design |
|---|---|---|
| 1 row 1 | (a) setting | `header.tagline`: a short text shown beside the logo/title, inside the logo link, small and uppercase. "Get help" = (c): Labels → Contact button. |
| 1 row 2 | (a) setting | `header` category bar: a second row inside the same `<nav>`, a horizontal list of category links. Source of the links: decision SHOPLOOK-CATBAR (§ 10). |
| 2 | (a) hero options | `eyebrow` (pill above the headline), `headlineAccent` + `headlineAccentColorToken` (second tone), `secondaryCtaText` + `secondaryCtaLink` (outline button), `stats` (up to four value + caption pairs), `buttonShape` (`rounded` / `pill`). Photo with overlay = today's `cover`. |
| 3 | (c) | `features`, columns "4", layout of choice, headline and subheadline empty. |
| 4 | (b) new block | `categoryGrid`: tall tiles of owner-picked categories (photo, name, description, a CTA text over the photo). Justification line in § 3.1. |
| 5 | (a) on the new block | `categoryGrid.chips`: pill links under the grid. They appear in the reference only with the grid; a separate block would have this one user. |
| 6 | (a) hero option | `splitPanel: "inverse"` on hero `split`: the text panel gets `bg-foreground`, and EVERY text class inside it that names a colour is swapped (§ 6.5), because the split headline and text carry their own colour classes (`HeroRender.tsx:97-98`) and would not inherit a parent colour. The eyebrow of row 2 gives the "Heritage" label. |
| 7 | (a) showcase options | `eyebrow`, `badgeTags` (or a product field, decision SHOPLOOK-BADGE), `showCategoryLabel`, `showDescription`, `showRating`. "View all picks" = today's `ctaText`. § 7 has the detail. |
| 8 | (a) post grid options | `eyebrow`, `asideText`, `asideQuote`, `asideButtonText`, `asideButtonLink`: a panel left of the post list (above it on a phone). The link cards = today's `postGrid` list layout. |
| 9 | (a) contact options | `eyebrow`, `card` (the form inside a bordered card), `selectLabel` + `selectOptions` (one optional select, sent as `interest`). Alternative: a form block that places a custom form — decision SHOPLOOK-FORM. |
| 10 | (a) footer settings | `footer.brandText` and `footer.columns` (each a heading and its links). Dark = today's footer colours (c). |
| 11 | (a) + (c) | Labels above headings = the `eyebrow` options of rows 2, 4, 6-9. Pill buttons = `hero.buttonShape` (the other buttons of the reference are already pills, or new pills). Serif headings, wide margins = (c). |

### 3.1 Abstractions introduced (one line each)

- **Block `categoryGrid`** — what: a grid of tall category tiles plus optional link chips; current users: sections 4
  and 5 of the reference on the Glamour Floors commerce home page (and every category page through
  `category-content-1`); axis: implementations growing, operations fixed — the existing block registry (string-key
  dispatch, `admin.ts:23`, `render.ts:23`) takes block types as its growing set, each with the same three operations
  (schema, editor, render), so a new type is a new registry entry and touches no other block; simpler
  alternative rejected: a `mode` on `categoryShowcase` — the two modes share no data field (`categoryId`, `limit`,
  `showPrice` are valid only for products; `categoryIds`, `chips` only for tiles), which is the "flag plus fields valid
  only under the flag" type the domain rule forbids; building the tiles from `image` or `columns` blocks cannot put
  text over a photo (`columns` holds raw text).
- No other abstraction. The read `getCategoriesByIds` (§ 6.4) is a function beside its sibling reads in
  `renderer/src/lib/dynamo.ts`; its callers are the `categoryGrid` preparation and, if SHOPLOOK-CATBAR = C, the
  layout's category bar. The first slice that needs it adds it. The section label is one element written inline in each of the five
  renders that show it; a shared component was rejected because the element has no logic (packet: architecture is
  earned).

### 3.2 Choices decided here (not asked; one line each)

- **SL-D1** Tile grid = a new block, not a showcase mode (domain rule above).
- **SL-D2** Chips = an option of `categoryGrid` (one user; no block for a section the reference does not show alone).
- **SL-D3** Section labels = an `eyebrow` attribute on each block that owns a section heading in the reference (hero,
  `categoryGrid`, `categoryShowcase`, `postGrid`, `contact`); not a separate label block: a block above a block is
  separated from the heading by the lower block's own top padding (`py-24` in `features`, `my-12` in the showcase), so
  the label would float away from its heading. `features` gets none: the reference strip has no heading.
- **SL-D4** Pill buttons = a per-hero `buttonShape`; no theme-wide button shape: the plugin buttons carry fixed classes
  (`rounded-md`, `HeroRender.tsx:17`, `CtaRender.tsx:10`), so a theme-wide shape needs either a class change on every
  tenant's buttons (bytes change for every site) or `--radius-md` overridden for every `rounded-md` element (inputs,
  panels, the mobile menu). The hero is the only non-pill button of the reference.
- **SL-D5** The rating is read at render time (§ 7.3), not stored.
- **SL-D6** The short text is read at render time from the product item (§ 7.2), not added to the `CATPROD#` card.
- **SL-D7** The category label = the name of the product's first category (`categoryIds[0]`), the rule of
  `cat-theme-1-impl.md` D-8, shown ABOVE the title (reference), switched by the block's own option — not by the theme
  option `cardCategoryLine`, which would change the showcase cards of tenants that already set it.
- **SL-D8** The numbers row is static text (no count-up animation): the reference shows numbers; an animation needs
  the browser and is not described.
- **SL-D9** The tagline is hidden below the `sm` breakpoint (640 px): row 1 on a phone already holds the logo, the cart
  and the menu button.
- **SL-D10** Catalog sites: the showcase's catalog reduction (`SitePage.tsx:788`, display fields only) stays as is; the
  four new card options have no effect on a catalog site.
- **SL-D11** `categoryGrid` is offered on commerce and catalog sites (`offeredOn: ["commerce", "catalog"]`, as
  `categoryShowcase`, `category-showcase/index.ts:14`).
- **SL-D12** `categoryGrid` has no browser fallback fetch: without server data (the admin preview) the public render
  draws nothing; the admin editor draws its own preview from the category list it already fetches.
- **SL-D13** The contact select is optional for the visitor (the reference does not say "required"); its value travels
  as `interest`.
- **SL-D14** Every new internal link (secondary button, chips, aside button, tiles, category bar, footer columns)
  passes through the tenant URL helper (`_getUrl` in blocks, `RenderBlocks.tsx:140`; `useTenantUrl` in the Navbar,
  `Navbar.tsx:90`) — except the footer columns, which follow the existing footer links (raw `href`,
  `layout.tsx:350`) because the layout has no URL helper.

## 4. Data shapes

Rule for every row: **absent = today's bytes**. A field that is absent, `null`, `""` (or whitespace only for texts) or
an empty list draws nothing and changes no attribute, class or prop of an existing element. No default is written into
stored data: every field added to an EXISTING setting or block is `.optional()` in zod with no `.default()`, and every
such Tiptap attribute has `default: null` (the precedent of `subheadlineRich`, `effect`, `hero/index.ts:23`, `:33`).
Old stored values read as absent. No migration. The new block `categoryGrid` has no stored instances, so its
attributes carry ordinary defaults.

### 4.1 Settings (`packages/shared/src/index.ts`, tenant item)

| Field | Zod | Absent / old value reads as | Validated on `PUT /settings` |
|---|---|---|---|
| `header.tagline` | `z.string().max(60).optional()` | no tagline | yes — the header check (`backend/src/tenant/settings.ts:140`, `:157`) picks this key too |
| category bar (SHOPLOOK-CATBAR = A) | `header.showCategoryBar: z.boolean().optional()` | no bar | yes, as above |
| category bar (SHOPLOOK-CATBAR = B) | `header.categoryBar: z.array(z.strictObject({ label: z.string().min(1).max(40), href: z.string().min(1) })).max(12).optional()` | no bar | yes, as above |
| category bar (SHOPLOOK-CATBAR = C) | `header.categoryBarIds: z.array(z.string().min(1)).max(12).optional()` (category ids, in bar order) | no bar | yes, as above |
| `footer.brandText` | `z.string().max(400).optional()` | no brand text | yes — `FooterConfigSchema` is strict and already checked whole (`settings.ts:155`) |
| `footer.columns` | `z.array(z.strictObject({ heading: z.string().min(1).max(40), links: z.array(z.strictObject({ label: z.string().min(1).max(60), href: z.string().min(1) })).max(12) })).max(4).optional()` | today's footer | yes, as above |
| `siteStrings.navCategoryBarLabel` | `z.string().optional()` in `SiteStringsSchema` (`index.ts:1009`) | the language pack value | yes, as every site key |

`mapTenant` copies `header` and `footer` whole (`dynamo.ts:135`, `:148`, `:150`), so the renderer receives the new
keys with no whitelist line. The header check must name what it checks: it is `HeaderColorsSchema` today
(`settings.ts:140`); when it also checks the tagline and the bar, the local constant is renamed (local, one file, no
persisted reference).

### 4.2 Block attributes (page item `blocks`, schema `z.array(z.any())`, `index.ts:396`)

The backend does not validate block attributes; the plugin zod schema and the Tiptap attribute list are the two
declarations, and both change together (precedent: every plugin `index.ts` repeats its schema's keys).

| Block | Attribute | Zod (plugin `schema.ts`) | Shown when |
|---|---|---|---|
| hero | `eyebrow` | `z.string().optional()` | non-blank; every style |
| hero | `headlineAccent` | `z.string().optional()` | non-blank; every style, inside the `<h1>` after the headline |
| hero | `headlineAccentColorToken` | the enum of `headlineColorToken` (`hero/schema.ts:19`), `.optional()` | read only with `headlineAccent`; absent or `auto` → `text-primary` (in an inverse panel: § 6.5); an explicit token → its class, in every style and panel |
| hero | `secondaryCtaText`, `secondaryCtaLink` | `z.string().optional()` each | text non-blank; in the styles that show the first button (center, split, cover) |
| hero | `stats` | `z.array(z.object({ value: z.string().max(12), label: z.string().max(40) })).max(4).optional()` | at least one item with a non-blank value; center, split, cover |
| hero | `buttonShape` | `z.enum(["rounded", "pill"]).optional()` | `pill` → both buttons `rounded-full`; absent/`rounded` → today's class |
| hero | `splitPanel` | `z.enum(["plain", "inverse"]).optional()` | `inverse`, style `split` only; the class swaps of § 6.5 |
| categoryGrid (new) | `eyebrow`, `headline` | `z.string().default("")` each | non-blank |
| categoryGrid | `categoryIds` | `z.array(z.string()).max(12).default([])` | the order of the tiles |
| categoryGrid | `columns` | `z.enum(["2", "3", "4"]).default("4")` | — |
| categoryGrid | `ctaText` | `z.string().default("")` | non-blank: the text at the foot of each tile ("SHOP CATEGORY") |
| categoryGrid | `chips` | `z.array(z.object({ label: z.string(), href: z.string() })).max(12).default([])` | items with label and href |
| categoryGrid | `blockWidth` | `z.enum(["content", "wide", "full"]).default("content")` | as every block |
| categoryShowcase | `eyebrow` | `z.string().optional()` | non-blank, above the category name |
| categoryShowcase | `badgeTags` (SHOPLOOK-BADGE = B) | `z.array(z.string()).max(10).optional()` | at most ONE badge per card: the first entry of `badgeTags` (block order) that the product's `tags` contains (exact match, case kept; blank entries ignored); the order of the product's tags does not matter (§ 7.4) |
| categoryShowcase | `showCategoryLabel`, `showDescription`, `showRating` | `z.boolean().optional()` each | `true` |
| postGrid | `eyebrow`, `asideText`, `asideQuote`, `asideButtonText`, `asideButtonLink` | `z.string().optional()` each | the panel shows when text, quote or button text is non-blank |
| contact | `eyebrow` | `z.string().optional()` | non-blank |
| contact | `card` | `z.boolean().optional()` | `true` |
| contact | `selectLabel`, `selectOptions` | `z.string().optional()`, `z.array(z.string()).max(20).optional()` | label non-blank and at least one non-blank option |

A block that an owner saves again in the new admin gets the new keys with value `null` (Tiptap writes every declared
attribute). That changes the RSC payload of that page (the stored JSON travels as the `blocks` prop of the client
component `RenderBlocks`, `RenderBlocks.tsx:1`, `:93`) but not its HTML. This is an owner action on that page; no page
changes on deploy. (INFERRED from the Tiptap behaviour of the existing `null`-default attributes; the slices prove the
HTML side, § 6.3.)

### 4.3 Product data (SHOPLOOK-BADGE = A only)

`ProductSchema.badge: z.string().max(24).optional()` (`index.ts:1485`); absent = no badge. Edited in the product
editor; read at render time with the short text (§ 7.2), so no `CATPROD#` writer changes.

### 4.4 Contact submission (backend)

`backend/src/contact/send.ts` reads `interest` from the body (string, CR and LF removed, at most 200 characters).
Present and non-blank → one line `Interest: <value>` in the mail text after the message (`send.ts:86`) and
`data.interest` in the lead (`send.ts:106`). Absent or blank → the mail text and the lead are byte-identical to today.

## 5. Texts

Every visitor text of the new pieces is owner content (a setting or a block field) or data (category names, category
descriptions, product descriptions, product tags), except the two below. The admin stays English.

| Text | Source | EN | RO |
|---|---|---|---|
| Accessible name of the category bar (`<nav aria-label>`) | NEW site key `navCategoryBarLabel` (`SiteStringsSchema`, both language packs, Labels page card "Header & Navigation" beside `navToggleMenu`, `Labels.tsx:366`) | `Categories` | `Categorii` |
| Rating text on a showcase card | EXISTING commerce key `reviewsSummary` (plural; `language-packs/en.ts:118`, `ro.ts:114`), filled on the server (§ 7.3) | `{rating}/5 ({n} review)` / `{rating}/5 ({n} reviews)` | `{rating}/5 ({n} recenzie)` / `… recenzii)` / `… de recenzii)` |

Why no other key, and why no key reaches every block: `RenderBlocks` is a client component and gives every block the
same `strings` object (`RenderBlocks.tsx:142`); that object is in the RSC payload of every content page. A new key in
`BLOCK_SITE_KEYS` (`packages/shared/src/locale-strings.ts:205-211`) would change the payload of every page of every
tenant. So a block text that is not owner content is passed only to the block that shows it, only when the option is
on, by the server preparation pass (the `_catalogMode` precedent, `SitePage.tsx:786-789`). The navbar's key travels
inside the category-bar prop, never in the shared `strings` prop (`layout.tsx:308`), for the same reason.

## 6. Rendering

### 6.1 Server or browser

Every new piece is server-rendered HTML. The Navbar and the plugin renders are client components rendered on the
server (`ssr: true`, `RenderBlocks.tsx:17-19`); the new pieces add no effect, no state and no browser fetch. The only
interactions are links and the contact select (a native `<select>`, posted by the existing contact submit).

### 6.2 Phone layout (below `md`, 768 px, unless named)

| Piece | Phone | Desktop |
|---|---|---|
| Tagline | hidden below `sm` (SL-D9) | beside the logo/title, one line |
| Category bar | one row under row 1, horizontal scroll (`overflow-x-auto`, `whitespace-nowrap`), inside the sticky header | one row, centred or left-aligned to the header width |
| Hero eyebrow / accent | same as desktop, smaller text | pill above the `<h1>`; accent on the same line or wrapped |
| Hero buttons | stacked, full width | side by side |
| Hero numbers | `grid-cols-2` for 4 items, `grid-cols-3` for 3, smaller numbers | one row |
| Hero inverse panel | image first, panel below (today's order, `HeroRender.tsx:87-96`) | panel left, image right |
| Category tiles | 1 column (`grid-cols-1`), 2 from `sm` | the block's `columns` from `lg`; tiles `aspect-[3/4]` |
| Chips | wrap | wrap |
| Showcase card extras | as desktop (badge over the image, label, 2-line text, rating) | same |
| Post grid aside | above the list | left third |
| Contact select / card | full width | inside the form width (`max-w-lg`, `ContactRender.tsx:86`) |
| Footer columns | 1 column, 2 from `sm` | brand column + named columns + the existing columns, `lg:grid-cols-N` (literal classes, so Tailwind compiles them) |

### 6.3 Bytes: which rows must stay equal, and the rule that keeps them equal

The rule, from `cat-theme-1-impl.md` § 2 and the payload notes in `layout.tsx:46-49`: an RSC payload carries the props
of every client element and the children of every element a server component renders, by position. So:

1. Server components (the layout's footer): a new piece **replaces an element in its existing slot**; it never adds a
   child slot. The named-column footer body replaces the grid `<div>` of `layout.tsx:330` as a whole, by a
   conditional in that one slot; absent → the same element as today.
2. Client components (Navbar, block renders): new data arrives by **conditional spread** (absent → no prop key; an
   `undefined` prop travels as `"$undefined"`); inside the component's own render, a conditional child adds nothing to
   the HTML when absent (INFERRED from React's server rendering of `false`; proved by the rows below).
3. The server preparation pass adds a key to block attributes or products only when the block's option is on.

Rows that must stay byte-equal in every slice (renderer `test/serving-contract/contract.test.mjs`):
`cm1-identity-commerce`, `cm1-identity-content` (`:1151`), `loc1-diff-<current LOC1_SLICE>` (today `cdl-2`, `:1829`,
`:2045`) and `loc1-text-*`, `loc1e-*`, `cq1-*`, `ct1-*` (`:2594`), `bpf1-*` (`:2752`), `hc1-*` (`:2811`), `cf1-*`,
`cm1-catalog-*`. Exception accepted by precedent: the stylesheet's content-hash file name changes when a slice adds
Tailwind classes (masked by CM1-A1; `cat-theme-1-impl.md` § 2).

Each slice adds rows of its own on a new fixture tenant and its twin without the new fields (the `hc1-colours` /
`hc1-plain` pattern, `docs/slices/header-colours-1.md`): the twin's HTML and payload equal today's; the set tenant's
differ exactly by the new element.

### 6.4 Reads

Two units are counted separately: a **helper call** (one call of a read function in `renderer/src/lib/dynamo.ts`) and
a **DynamoDB request** (one `QueryCommand` or `GetCommand` sent). A Query helper that loops on `LastEvaluatedKey`
sends one request per result page; DynamoDB ends a Query page at 1 MB of items read, BEFORE the `FilterExpression` is
applied, so a page can come back empty and still carry a `LastEvaluatedKey`. Such a helper therefore sends at least
one request, and as many as the size of the read key range requires; no fixed bound holds.

| Piece | Helper | Paginates? | Helper calls | DynamoDB requests | When |
|---|---|---|---|---|---|
| Category bar (CATBAR = A) | `getAllCategories` (Query `CATEGORY#`, filter `status = active`; loop `dynamo.ts:318-334`) | yes | 1 per uncached page render | ≥ 1; one per 1 MB page of the tenant's `CATEGORY#` items, hidden ones included (the filter runs after the read) | only when `header.showCategoryBar` is true |
| Category bar (CATBAR = B) | none | — | 0 | 0 | — |
| Category bar (CATBAR = C) | `getCategoriesByIds` (NEW, below) | no | 1 per uncached page render | ≤ 12 `GetCommand`s (one per stored id) | only when `header.categoryBarIds` is non-empty |
| `categoryGrid` | NEW `getCategoriesByIds(tenantId, ids)`: one `GetCommand` per id on `TENANT#<tid>` / `CATEGORY#<id>` (key `backend/src/categories/create.ts:54`), `ProjectionExpression` `id, #n, slug, description, imageLink, #s`; `status` not `active` → skipped; missing → skipped | no (a `GetCommand` returns one item or none) | 1 per block | ≤ 12 per block | per block, in `prepareBlocks` |
| Showcase label | `getAllCategories` | yes | 1 per block | ≥ 1, as the bar row A | only when `showCategoryLabel` |
| Showcase short text (and badge if BADGE = A) | `getProductById` (`GetCommand`, `dynamo.ts:228`) | no | ≤ `limit` (max 12) per block | ≤ 12 per block | only when `showDescription` (or BADGE = A) |
| Showcase rating | `getProductReviews` (Query `REVIEW#<productId>#`, filter `status = approved`; loop `dynamo.ts:512-533`) | yes | ≤ 12 per block | ≥ 1 per listed product; one per 1 MB page of that product's review items (all statuses, filter after read) | only when `showRating` |

Verification of the pagination-dependent rows (part of the slice oracles, § 9): a renderer unit test drives each
paginating helper as the new code calls it against a DynamoDB stub that answers in two pages (the first page with
`LastEvaluatedKey` and, for one case, zero items after the filter) and asserts that the result holds the items of both
pages and that two requests were sent. `getCategoriesByIds` is tested with 0, 1 and 12 ids, one missing and one
hidden.

Why `getAllCategories` is not reused for the grid: its projection has no `description` (`dynamo.ts:329`), and adding
it would put descriptions into the objects that the shop and product pages already read, with a risk to their bytes.
All reads run only on an uncached render (ISR). Freshness: a category or product update purges the tenant's whole ISR
cache (`backend/src/lib/revalidate.ts:204-206`, called by `categories/update.ts:66`, `products/update.ts:115`); a
review create, update or delete purges it too (`reviews/update.ts:568`); a category create purges it
(`categories/create.ts:80`). So tiles, the bar, labels and ratings follow the data within the existing purge times.

### 6.5 The inverse panel (hero `split`, `splitPanel: "inverse"`)

Problem: the split text panel has no background of its own, and its texts carry explicit colour classes — the headline
`text-foreground` (`HeroRender.tsx:97`), the text `text-muted-foreground` (`:98`). An explicit class on a child wins
over a colour set on the parent, so a parent `text-background` alone would leave the headline in the foreground colour
on a foreground-coloured panel: invisible.

Rule: under `inverse`, the panel element and EVERY descendant element whose colour class is a default (not an owner's
explicit token) get the swapped class below, in the same class position; an owner's explicit token is kept (accent row
below); under `plain` or absent, every class string is today's string, character for
character (one conditional chooses between two complete class strings; no string is built by appending).

| Element | Today (`plain`) | `inverse` |
|---|---|---|
| Text panel `<div>` (`HeroRender.tsx:96`) | no background class | `bg-foreground` added |
| Headline `<h1>` (`:97`) | `text-foreground` | `text-background` |
| Text (`:98`) | `text-muted-foreground` | `text-background/80` |
| Eyebrow (new) | `text-primary`, border `border-primary/30` | `text-background`, border `border-background/40` |
| Headline accent (new), token absent or `auto` | `text-primary` | `text-background/70` |
| Headline accent (new), explicit token (any value of `hero/schema.ts:19` except `auto`) | the token's class (`resolveTextClass`, `packages/plugins/src/common/resolveCoverColorTokens.ts:20-27`) | the same class, kept: an owner's explicit choice is not swapped, even `foreground` (`text-foreground`) or `muted-foreground` (`text-muted-foreground`), which can be hard to read on the panel. This is the owner's choice, made in the editor where the result is visible; the design does not override it |
| First button (`btnClass`, `:17`) | `bg-primary text-primary-foreground` | unchanged: the button paints its own fill, so its label stays readable |
| Second button (new, outline) | `border-foreground text-foreground` | `border-background text-background` |
| Numbers (new) | value `text-foreground`, caption `text-muted-foreground` | value `text-background`, caption `text-background/70` |

The pair `--foreground` / `--background` is the tenant's own page text and page background (ThemeInjector), so the
panel has the page's own contrast, inverted; in the dark theme the panel is light with dark text. `bg-foreground` and
`text-background` compile because the renderer's Tailwind scans the plugin sources (`renderer/src/app/globals.css:7`).

Rule for the swap and its tests: the swap applies to every element whose colour is the default (no owner token);
an element with an explicit owner token keeps the token's class. So a negative assertion ("no `text-foreground`") is
made only on fixtures where every element is on its default, and every explicit-token fixture asserts that the chosen
class is present.

Oracles (slice `shop-look-1b`), plugin render tests:

1. `inverse`, accent token absent, and again with `auto`: the panel has `bg-foreground`; no element inside it carries
   `text-foreground` or `text-muted-foreground`; the headline has `text-background`; the accent has
   `text-background/70`.
2. `inverse`, accent token `foreground`: the accent `<span>` carries `text-foreground`; the headline still has
   `text-background`; the panel still has `bg-foreground`. Same with `muted-foreground` (the accent carries
   `text-muted-foreground`) and with `primary` (the accent carries `text-primary`).
3. absent and `plain`: the HTML equals today's. A renderer check asserts that the built stylesheet contains rules
for `.bg-foreground` and `.text-background`. Staging: the section 6 page in the light and the dark theme; for each, the
computed colour of the headline and of the panel background (browser dev tools or a Playwright `getComputedStyle`)
differ and their WCAG contrast ratio is recorded (target ≥ 4.5:1 with the test tenant's theme). The staging hero uses
the accent token `auto` (case 1), so the measured colours are the design's own, not an owner choice.

## 7. The product card on a commerce site (section 7)

### 7.1 What the card shows today

The home-page section is a `categoryShowcase` block. Its card (`CategoryShowcaseRender.tsx:23-67`) shows the image
(square), the title (`:58`) and, unless the site is a catalog, the price: the sale price with the regular price struck
through, or a volume range "min – max currency" (`:28-37`, `:59-64`). It shows an out-of-stock overlay (`:52-56`). No
badge, no category label, no short text, no rating. Its data is the `CATPROD#` card item (`dynamo.ts:278-308`), which
carries `tags` and `categoryIds` but not `description` (`backend/src/lib/catprod.ts:12-29`, `:31-52`).

(The shop, category and search pages use a second card, `SitePage.tsx:853-889`; it is out of scope, § 7.5.)

### 7.2 Short text

`showDescription` → the preparation pass reads each listed product's item (`getProductById`) and adds
`description` to that product's object; the card shows it under the title, two lines at most (`line-clamp-2`). Not
added to the `CATPROD#` card: six writers build that card, each with its own field list (`products/create.ts:84`,
`products/update.ts:91`, `products/bulk-price.ts`, `import/woocommerce.ts:512`, `import/glam-pricelist.ts:355`,
`import/glam-images.ts:197`), and every stored card would lack the field until rewritten.

### 7.3 Rating

Reviews data: approved reviews are items `REVIEW#<productId>#<reviewId>` with `rating` 1-5 (`index.ts:1936-1950`);
there is no stored aggregate. The product page computes the average and count at render time
(`dynamo.ts:536-537`) and shows `★` and the `reviewsSummary` text (`SitePage.tsx:1317-1323`). `showRating` → the
preparation pass calls the same `getProductReviews` per listed product and, for a product with at least one review,
adds `rating: { average, count, text }` (`text` = `reviewsSummary` filled on the server); the card shows the stars in
`text-primary` and the text. A product without reviews shows no rating line.

### 7.4 Badge

Where a badge comes from is decision SHOPLOOK-BADGE (§ 10). Recommended: the block lists the tags that act as badges
(`badgeTags`); a product whose `tags` contains one of them shows it as a pill over the image (`bg-primary`,
`text-primary-foreground`, uppercase). `tags` are already in the card item (`catprod.ts:46`), so this option needs no
new read.

Cardinality and precedence (one rule): a card shows **at most one** badge. It is the first entry of the block's
`badgeTags`, in the block's order, that occurs in the product's `tags` (exact string match, case kept; a blank entry of
`badgeTags` is ignored). The order of the product's own tags never changes the result. No match, `badgeTags` absent or
empty → no badge element. The badge text is the matched tag as stored; uppercase is CSS (`uppercase`), so the HTML
keeps the stored text. Example: `badgeTags = ["TOP PICK", "POPULAR"]`; a product tagged `["POPULAR", "TOP PICK"]` and
one tagged `["TOP PICK", "POPULAR"]` both show "TOP PICK". Under SHOPLOOK-BADGE = A the field holds one value, so the
question does not arise.

Oracle cases (slice `shop-look-1d`, plugin render test): zero matches; one match; two matches with the product's tags
in both orders (same badge both times); a blank entry in `badgeTags`; a tag that differs only in case (no match). The category label (SL-D7) is the first category's name, above the title, `text-xs uppercase
text-muted-foreground`.

### 7.5 Not in this design

The shop/category/search card (`SitePage.tsx:853-889`): the reference shows only the home page. The same options can
move there later with the same data rules. The catalog showcase: SL-D10.

## 8. Flooring-shop check (report only, no design)

Question: can the commerce product model today price per m² and sell in whole boxes (pack size, unit, minimum
quantity)? Answer: **it can sell whole boxes at a price per box, and nothing else of the list.** The box must be the
product's unit: the price is per cart unit and the quantity is a whole number of units. It cannot show or compute a
price per m², convert an area into boxes, or enforce a minimum or a step.

| Need | Today | Evidence |
|---|---|---|
| A sales unit (m², box) | None. `price` is one string per cart unit; no unit field. `attributes` are free key/value display rows (the glam import writes "unit", "packaging", "minimum order" there as text, `catalog-data-labels-1.md` § 1.3) | `index.ts:1485-1576` (`price`, `attributes`) |
| Pack size (m² per box) | None | same |
| Minimum quantity, step | None on the product. The add-to-cart picker starts at 1, steps by 1, floor 1 | `renderer/src/components/AddToCartButton.tsx:69`, `:238`, `:245`; cart `renderer/src/context/CartContext.tsx:95-105`; cart page `CartPageView.tsx:128`, `:132` |
| Server check of minimum or step | None. The order input accepts any whole quantity 1-100 per line | `index.ts:1765-1767` |
| Quantity per line | at most 100 (100 boxes per line) | `index.ts:1767` |
| Tier prices (`volumePricing`) | shown and applied in the browser (`AddToCartButton.tsx:86-95`), IGNORED by the server: the order uses the sale price, else the price | `backend/src/orders/create.ts:127`, `:147-148` |

Named finding **F-SHOP-FLOOR-UNITS**: the product model has no sales unit, no pack size, no minimum quantity and no
quantity step, and neither the cart nor the order handler enforces any; a flooring shop can only sell "one box" as the
unit at a box price, with m² per box shown as a text attribute. Two related defects found on the way (§ 13):
F-SHOP-SERVER-TIERS and F-SHOP-ORDER-PRICE-STRING.

## 9. Implementation slices

Cut along shared causes. The operator's first cut had four slices; this design keeps four but moves the footer into the
header slice and the card/label/form work into one block slice, because the code groups them that way: the header and
the footer are tenant settings read by the layout (shared schema + `PUT /settings` check + Settings page + layout),
while the card, the post grid aside and the contact select are options of existing blocks (plugin schema + editor +
render + `prepareBlocks`). The tile grid is the only new block; the hero is the only block whose render changes in
two sections. Each slice is independent of the others; any order works. Recommended order: `1a` → `1b` → `1c` → `1d`
(the visible page grows top to bottom).

Common to every slice: root build first, then typecheck (each run from the repository root):

```
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run build; echo $?        # → 0
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run typecheck; echo $?    # → 0
```

The workspace oracles below run from their workspace directory (`packages/shared`, `packages/plugins`, `backend`,
`admin`, `renderer`, `tools/mcp-server`). Each slice updates the `ARCHITECTURE.md` of each package it
touches, `docs/block-types.md` for each block it changes, and the MCP block descriptions
(`tools/mcp-server/src/index.ts`: hero `:120-125`, the `add_block` type list `:891-912`). No slice changes infra.

| Slice | Sections | Visible output | Allocation (files) | Oracles (exit codes) | Staging evidence |
|---|---|---|---|---|---|
| `shop-look-1a` chrome | 1, 10 | Tagline; category bar; footer with brand text and named columns | `packages/shared/src/index.ts` (`HeaderConfigSchema`, `FooterConfigSchema`, `SiteStringsSchema`), `packages/shared/src/language-packs/{en,ro}.ts`; `backend/src/tenant/settings.ts`; `admin/src/pages/{Settings.tsx, Labels.tsx}`; `renderer/src/app/[siteId]/layout.tsx`, `renderer/src/components/Navbar.tsx`; `renderer/src/lib/dynamo.ts` (CATBAR = C: `getCategoriesByIds`, unless `1c` added it first); tests beside each; serving fixtures and rows `sl1a-*` | shared `npm test; echo $?` → `0` (absent stays absent; limits; strict footer refuses unknown keys); backend `npm run test:unit; echo $?` → `0` (`PUT /settings` 400 on an over-long tagline, a bad column; the old keys unchanged); admin `npm run test:unit; echo $?` → `0` (controls add and remove the keys; "none" removes the key); renderer `npm test; echo $?` → `0` (CATBAR = A: the two-page `getAllCategories` case of § 6.4; CATBAR = C: `getCategoriesByIds` with 0, 1, 12 ids, one missing, one hidden); renderer `npm run test:serving; echo $?` → `0` (§ 6.3 rows unchanged; new rows: set tenant vs twin, `/`, `/shop`, a product page); `cd tools/mcp-server && npm test; echo $?` → `0` | English commerce test tenant on staging: Settings set tagline, bar and three columns; screenshots desktop and 390 px; the twin tenant's `/` HTML equal before and after the deploy |
| `shop-look-1b` hero | 2, 6, 11 (hero pills) | Hero with eyebrow, two tones, two buttons, numbers, pill shape; split with an inverse panel | `packages/plugins/src/hero/{schema.ts, index.ts, HeroRender.tsx, HeroEditor.tsx}`; `packages/plugins/test/` (new hero test); `tools/mcp-server/src/index.ts`; `docs/block-types.md`; serving fixture page and rows `sl1b-*` | plugins `npm test; echo $?` → `0` (each attribute absent → the render's HTML equals today's for all four styles; each present → its element; `inverse`: the three cases of § 6.5 — default tokens, explicit tokens kept, absent/`plain` unchanged); renderer `npm run test:serving; echo $?` → `0` (with a built-stylesheet check for `.bg-foreground` and `.text-background`); mcp `npm test; echo $?` → `0` | A staging page with the cover hero of section 2 and the split hero of section 6; screenshots desktop and 390 px; the § 6.5 readability check (headline vs panel colour, contrast ratio recorded) in the light and the dark theme |
| `shop-look-1c` category grid | 4, 5, 11 (labels) | Category tiles and chips | `packages/plugins/src/category-grid/{schema.ts, index.ts, CategoryGridRender.tsx, CategoryGridEditor.tsx}` (new); `packages/plugins/src/{admin.ts, render.ts}`; `admin/src/components/editor/BlockEditor.tsx` (the category list for the new editor, as `:92`); `renderer/src/components/SitePage.tsx` (`prepareBlocks`); `renderer/src/lib/dynamo.ts` (`getCategoriesByIds`); `tools/mcp-server/src/index.ts`; `docs/block-types.md`, `docs/plugin-architecture.md`; tests; serving rows `sl1c-*` | plugins `npm test; echo $?` → `0` (`renderLoaders.test.ts` and `offeredOn.test.ts` with the new key; render with 0, 1, 12 categories; hidden and missing categories skipped); renderer `npm test; echo $?` → `0` (`getCategoriesByIds` keys and projection against the DynamoDB stub; 0, 1, 12 ids, one missing, one hidden; one `GetCommand` per id); renderer `npm run test:serving; echo $?` → `0`; admin `npm run test:unit; echo $?` → `0`; mcp `npm test; echo $?` → `0` | A staging page with six category tiles and chips; a category hidden in admin disappears after the purge; screenshots desktop and 390 px |
| `shop-look-1d` section blocks | 7, 8, 9, 11 (labels) | Showcase card with badge, label, short text, rating; post grid with aside; contact with select and card | `packages/plugins/src/{category-showcase, post-grid, contact}/{schema.ts, index.ts, *Render.tsx, *Editor.tsx}`; `renderer/src/components/SitePage.tsx` (`prepareBlocks`); `backend/src/contact/send.ts`; (BADGE = A: `packages/shared/src/index.ts` `ProductSchema`, `admin/src/pages/ProductEditor.tsx`); (FORM = B: replaces the contact rows with a new form block — re-cut at ruling time); `tools/mcp-server/src/index.ts`; `docs/block-types.md`; tests; serving rows `sl1d-*` | plugins `npm test; echo $?` → `0` (the badge cases of § 7.4); backend `npm run test:unit; echo $?` → `0` (mail and lead byte-equal without `interest`; one line and one field with it; CR/LF removed); renderer `npm test; echo $?` → `0` (`prepareBlocks` adds nothing when the options are off; reads only when on; the two-page cases of § 6.4 for `getAllCategories` and `getProductReviews`); renderer `npm run test:serving; echo $?` → `0`; mcp `npm test; echo $?` → `0` | A staging page with sections 7, 8, 9; one contact submission with an interest (mail line, lead field); screenshots desktop and 390 px |

Never run in any slice: `cd backend && npm test` (live staging DynamoDB). Staging runs are the operator's.

Section → slice (every section of § 1.2 has one):

| § | Slice | Note |
|---|---|---|
| 1 | `shop-look-1a` | tagline, category bar; "Get help" via Labels (no code) |
| 2 | `shop-look-1b` | |
| 3 | `shop-look-1b` (staging page only) | no code: the `1b` staging page includes the four-item `features` strip, as proof that § 3 row 3 holds |
| 4, 5 | `shop-look-1c` | |
| 6 | `shop-look-1b` | |
| 7, 8, 9 | `shop-look-1d` | |
| 10 | `shop-look-1a` | |
| 11 | `1b` (hero pills, eyebrow), `1c` and `1d` (section labels); fonts and widths need no code (proved on every staging page) | |

## 10. Decisions for the human

DECISION_REQUIRED:
- ID: SHOPLOOK-CATBAR
  QUESTION: Where do the links of the category bar (header row 2) come from?
  PROBLEM: The reference shows a second header row of category links. The site has a category tree (names, slugs,
    order, a status `active` / `hidden`) and a first header row whose links the owner types by hand. What `hidden`
    does today, verified on the code: a hidden category is left out of every LIST — `getAllCategories` reads only
    `status = active` (`renderer/src/lib/dynamo.ts:318-327`), which feeds the shop's category links, the sitemap and
    the product page's category links — but its own PAGE still renders: `getCategoryBySlug` returns the category
    without a status check (`dynamo.ts:262-275`) and the category route checks only that it exists
    (`renderer/src/components/SitePage.tsx:408-411`). So "hidden" means "not listed", not "not reachable"
    (finding F-SHOP-HIDDEN-CATEGORY-PAGE; this design does not change it). The source of the bar decides whether the
    bar can point at a deleted or renamed category, whether the owner can choose a subset without touching the
    category's status, whether a non-category link can sit there, and how many database requests the header makes.
  OPTIONS:
  - A — every active top-level category, in category order (`sortOrder`), switched on by one checkbox
    (`header.showCategoryBar`). REWARD: no upkeep; a new category appears by itself; a renamed, hidden or deleted
    category leaves or changes in the bar by itself (category writes purge the tenant's pages, § 6.4). RISK: the only
    way to leave a category out of the bar is to hide it, which also removes it from the shop's category links and the
    sitemap (its page stays reachable); no non-category link; a shop with many top-level categories gets a long
    scrolling row; the header reads every `CATEGORY#` item of the tenant on each uncached render (≥ 1 request,
    pagination-dependent, § 6.4).
  - B — a hand-typed list (label + link, up to 12, `header.categoryBar`), edited like the navigation menu. REWARD:
    full control (order, subset, any link such as "Sale"); no database read. RISK: label and link are copies — a
    renamed category keeps its old label, a changed slug or a deleted category leaves a broken link on every page
    until the owner edits the list; a second link editor in Settings.
  - C — the owner picks categories by id, in a chosen order (up to 12, `header.categoryBarIds`); the label and the link
    are read from each category at render time (the same mechanism and read as `categoryGrid`, § 6.4). REWARD: subset
    and order control without changing any category's status; a rename or slug change shows at once; a deleted or
    hidden category drops out (no broken link); bounded reads (≤ 12 `GetCommand`s, no pagination); one read function
    shared with `categoryGrid`. RISK: a new category does not appear until the owner adds it; no non-category link
    (row 1 holds those); a category picker in Settings (the admin already lists categories for the showcase editor,
    `admin/src/components/editor/BlockEditor.tsx:92`).
  RECOMMENDED: C. It keeps the one property that matters most — no broken link on every page — without forcing the owner
    to hide a category to shape the bar, and its read cost is fixed. Choose A if new categories must appear without an
    edit; choose B only if non-category links are needed in row 2.
  BLOCKING_REASON: the schema field (§ 4.1), the Settings control and the layout read of `shop-look-1a` differ by option.

DECISION_REQUIRED:
- ID: SHOPLOOK-BADGE
  QUESTION: Where does a product card's badge ("TOP PICK", "POPULAR") come from?
  PROBLEM: The reference cards carry a merchandising badge. Products have no badge field today; they have free tags
    (`tags`), which the product page shows as small chips (`SitePage.tsx:1266-1272`) and which the card data already
    carries (`catprod.ts:46`). The badge source decides whether the product data shape changes, how the owner sets a
    badge, and whether the badge is the same on every card of the product.
  OPTIONS:
  - A — a new product field `badge` (text, up to 24 characters), set in the product editor. REWARD: explicit; one
    badge per product, the same everywhere; clear name. RISK: a product schema change and a product editor field; the
    card needs one product read per listed product (already the case when the short text is on, § 7.2); an importer
    that rewrites a whole product item may drop the field (INFERRED; the four importers' write modes were not checked).
  - B — the block lists which tags are badges (`badgeTags`); a product that has one of those tags shows it. REWARD: no
    data change, no new read, no product editor change; the owner tags products as today; different sections can
    use different badge tags. RISK: the badge text is a tag, so it also shows among the tags on the product page
    (`SitePage.tsx:1268-1269`); the owner must type the same text in two places (the tag and the block).
  - C — the block stores a badge per product (a map product → text). REWARD: badge per placement. RISK: the most
    editor work (a product picker per block); the badge disappears when the product leaves the category.
  RECOMMENDED: B. It needs the least change and no data shape crosses a boundary; A stays possible later with no
    migration.
  BLOCKING_REASON: the allocation of `shop-look-1d` (shared schema and product editor, or not) differs by option.

DECISION_REQUIRED:
- ID: SHOPLOOK-FORM
  QUESTION: How does the page get a form with a "Primary interest" select (section 9)?
  PROBLEM: The only form an owner can place on a page is the `contact` block, with three fixed fields. A complete
    custom-forms feature exists — the admin form builder with a select field, a submissions list, a notify mail, and
    a public submit route — but no caller of the renderer form component or of its read was found in the searched
    current source (§ 2.2 row 9, § 12 E5), so no page can show a custom form today. (Whether an earlier commit ever
    placed one is INFERRED as "no" from two literal-spelling history searches only.) So the select can come from a
    small option on the contact block, or from placing custom forms.
  OPTIONS:
  - A — the contact block gets one optional select (label + options), sent as `interest` through today's contact
    path (renderer proxy with the origin guard, then `backend/src/contact/send.ts`). REWARD: the smallest change
    (block options + one backend field); the proven, live contact path; mail and lead unchanged when absent. RISK: the
    custom-forms feature stays unplaceable (finding stays open); the contact block grows by one field kind.
  - B — a new block that places a custom form by its slug (prefetched on the server, drawn by the existing form
    component moved into the plugin package). REWARD: every custom form becomes usable (any fields, submissions list,
    notify mail); the reference form is one such form. RISK: a new block, a form picker in the editor, and the move of
    `DynamicForm` into `packages/plugins` (the split-entry rule forbids importing it from the renderer); the browser
    then calls the API directly (`DynamicForm.tsx:59`), not the renderer proxy that the contact form uses — a path that
    has no caller in the searched current source, so it has no record of serving a page, and needs its own
    isolation review; larger `shop-look-1d`.
  RECOMMENDED: A for this design; F-SHOP-FORMS-UNPLACED goes to the human as its own question (place custom forms, or
    remove the unplaced code).
  BLOCKING_REASON: the scope and allocation of `shop-look-1d` (contact options and one backend field, or a new block).

## 11. Rollout

### 11.1 What changes on deploy

Nothing visible on any existing site. Every new field and attribute is absent on every stored tenant and page; absent
renders today's bytes (§ 4, § 6.3, proved per slice by the unchanged rows). The new block appears only where an owner
inserts it. No data migration, no backfill, no script on tenant data.

### 11.2 Deploy order (per slice)

1. Shared builds into every bundle (no deploy of its own).
2. Backend (`1a`: the settings check accepts the new keys; `1d`: the contact `interest` field). Must precede the admin:
   the strict footer check refuses unknown keys (`settings.ts:155`), so the new admin against the old backend would get
   400 on a save with a footer column.
3. Renderer (draws the new fields; ignores them when absent).
4. Admin last (owners see a control only when the site can draw it).

### 11.3 Rollback

- Admin, then renderer: safe. A stored new field is ignored by the old renderer; a stored `categoryGrid` block is
  skipped by the old renderer (`RenderBlocks.tsx:120` returns `null` for an unknown type).
- Admin rollback past `1c` while a page holds a `categoryGrid` block: the old editor has no node type for it; Tiptap may
  refuse or drop the node when the page is opened and saved (INFERRED, not tested). Rule: before such a rollback,
  remove the block from those pages, or do not roll the admin back past `1c`.
- Backend rollback of `1a` after an owner stored `footer.columns` or `footer.brandText`: the old strict footer check
  refuses every later Settings save of that tenant, because the admin sends the whole configuration
  (`admin/src/pages/Settings.tsx:421-423`). Rule: before such a rollback, list the tenants that store the keys with a
  Query on `PK = SYSTEM`, `begins_with(SK, "TENANT#")`, projection `footer`, and remove the keys, or keep the backend.
- Backend rollback of `1d`: the old handler ignores `interest`; the value is lost from mail and lead, nothing fails.

### 11.4 Commerce freeze

No slice moves commerce entries to another table. `1d` touches the commerce showcase block and the contact handler;
both are inside the human's 2026-11-15 direction (§ 1.1).

## 12. Evidence log

| Id | Label | Command | Result |
|---|---|---|---|
| E1 | EXECUTED | `git rev-parse HEAD`; `git status --porcelain -uall` | `e6394652c75f93cf5234b651b9dcfd72fc7d952c`; empty |
| E2 | EXECUTED / OBSERVED | `cat` of `packages/plugins/src/{admin.ts, render.ts, types.ts}` and of the `schema.ts` of hero, video-hero, features, cta, columns, category-showcase, post-grid, contact; full read of `HeroRender.tsx`, `CtaRender.tsx`, `FeaturesRender.tsx`, `CategoryShowcaseRender.tsx`, `ContactRender.tsx`; `grep` of `PostGridRender.tsx`, `ColumnsRender.tsx` | 20 plugins in `REGISTRY`, the same 20 keys in `RENDER_LOADERS`; 7 core types; per-section facts of § 2.2 |
| E3 | OBSERVED | full read of `renderer/src/app/[siteId]/layout.tsx` and `renderer/src/components/Navbar.tsx`; `sed -n 120,190p renderer/src/lib/dynamo.ts` | header/footer facts of § 2.2; `mapTenant` copies `header`, `footer` whole |
| E4 | OBSERVED | `sed` of `packages/shared/src/index.ts` `:55-75`, `:280-335`, `:600-645`, `:1005-1030`, `:1128-1137`, `:1345-1420`, `:1485-1630`, `:1765-1776`, `:2100-2128`; `sed -n 190,260p packages/shared/src/locale-strings.ts` | schemas of § 4; `BLOCK_SITE_KEYS`, `blockStrings` |
| E5 | EXECUTED (revision 1) | E5 block below | grep exit 0, seven hits, none an invocation: the definitions `renderer/src/components/DynamicForm.tsx:17`, `:29` and `renderer/src/lib/dynamo.ts:778`, and comments at `packages/shared/src/index.ts:1064`, `:2155`, `packages/shared/src/locale-strings.ts:202`, `renderer/src/components/InterestShortlist.tsx:12`. First `git log -S`: no output. Second: one commit, `d2623cb` (the commit that added the definition). Claim proved: no caller in the searched current source. Revision 0 ran the same search with real pipe characters, but recorded it inside this table with the pipes escaped as backslash-bar; copied literally, that text is a different regular expression and matches nothing (exit 1, review-0). Commands now live in code blocks |
| E6 | OBSERVED | `sed -n 745,895p renderer/src/components/SitePage.tsx`; `grep` for `prepareBlocks(`, `<RenderBlocks`, `getAllCategories` | `prepareBlocks` `:756`, callers `:412`, `:675`; showcase prefetch `:770-795`; shop card `:853-889`; `getAllCategories` readers |
| E7 | OBSERVED | `sed` of `renderer/src/lib/dynamo.ts` `:278-345`, `:505-540`; `backend/src/lib/catprod.ts:1-56`; `backend/src/products/update.ts:80-110`; `git grep -n writeCatProductItems -- backend/src` | card item fields; review aggregate computed at render; six `CATPROD#` writers |
| E8 | OBSERVED / EXECUTED | `sed -n 108,160p backend/src/orders/create.ts`; `sed -n 80,100p renderer/src/components/AddToCartButton.tsx`; `git grep -n addedCost -- admin/src backend/src/products backend/src/import`; `node -e 'let u="12.50"; let p=0; p+="5"; const f=u+p; console.log(JSON.stringify(f), f*2); …'` | server price = the sale price, else the price (`orders/create.ts:127`), no tiers; admin stores `addedCost` as a string (`ProductEditor.tsx:571`, `:628`); JS prints `"12.5005" 25.001` and `"12.500" 25` |
| E9 | OBSERVED | `grep -n radius renderer/src/app/globals.css renderer/src/components/ThemeInjector.tsx`; in `renderer/.next/static/chunks/*.css` (a local build artefact dated 2026-11-15 17:25; its source commit was NOT verified): `grep -o` for `var(--radius)` and `--radius-md` | `--radius` is read only by `.rounded{border-radius:var(--radius)}`; `.rounded-md{border-radius:var(--radius-md)}` with `--radius-md:.375rem` |
| E10 | OBSERVED | `sed -n 120,170p backend/src/tenant/settings.ts`; `grep -n PUT admin/src/pages/Settings.tsx` | footer checked strict, header only its colour keys; the admin sends the whole configuration |
| E11 | OBSERVED | `grep` of `backend/src/categories/*.ts`, `backend/src/products/*.ts`, `backend/src/reviews/*.ts` for `withInvalidation(`/`revalidateTenantPaths`; `sed -n 200,240p backend/src/lib/revalidate.ts` | category/product/review writes purge the tenant's whole ISR cache |
| E12 | OBSERVED | `grep` of `renderer/test/serving-contract/contract.test.mjs` for `test(` titles; `sed -n 1815,1835p` | row families of § 6.3; `LOC1_SLICE = "cdl-2"` |
| E13 | EXECUTED | `python3 -I -c` printing the `test*`/`build`/`typecheck` scripts of the root and seven workspace `package.json` files | the oracle commands of § 9 exist: shared/plugins `test`, backend `test:unit`, admin `test:unit`, renderer `test` and `test:serving`, mcp `test` |
| E14 | NOT RUN | any staging, AWS or external-site call; any build or test run | forbidden by the packet; this slice changes no code |
| E15 | EXECUTED | § 12.1 script | result in § 12.1 |
| E16 | EXECUTED (revision 1) | `grep -n` over `packages/plugins/src/{features/FeaturesEditor.tsx, category-showcase/CategoryShowcaseEditor.tsx, post-grid/PostGridEditor.tsx, contact/ContactEditor.tsx, hero/HeroEditor.tsx, cta/CtaEditor.tsx, columns/ColumnsEditor.tsx}`, `admin/src/pages/{CategoryEditor.tsx, FormEditor.tsx, Settings.tsx}`, `admin/src/App.tsx` for the attribute and field names of § 2.2 | the admin-editor column of § 2.2; no plugin editor offers a chip list or a label above a heading |
| E17 | OBSERVED (revision 1) | `sed -n 262,276p renderer/src/lib/dynamo.ts`; `sed -n 405,425p renderer/src/components/SitePage.tsx`; `grep -n` for the words `status` and `hidden` in `admin/src/pages/CategoryEditor.tsx` | a hidden category is not listed but its page renders (F-SHOP-HIDDEN-CATEGORY-PAGE) |
| E18 | OBSERVED (revision 1) | `sed -n 318,327p` and `sed -n 512,534p renderer/src/lib/dynamo.ts` | both helpers loop on `LastEvaluatedKey` (`do … while (lastKey)`), Query with a `FilterExpression`; the request bounds of § 6.4 |
| E19 | OBSERVED (revision 1) | `sed -n 94,100p packages/plugins/src/hero/HeroRender.tsx`; `grep -n -E '@source' renderer/src/app/globals.css` | split headline `text-foreground`, text `text-muted-foreground`; the renderer's Tailwind scans `packages/plugins` (`globals.css:7`) |
| E20 | EXECUTED (revision 2) | `grep -n -o -E` over this document for the negative oracle phrases ("adds nothing", "no element inside", "no badge", "byte-equal without", "equals today's", "draws nothing", "refuses unknown keys", "400 on") | 17 hits; each read; the classification of § 16.1 |

E5 (run from the repository root):

```
git grep -n -E 'getFormBySlug|DynamicForm' -- renderer/src packages admin/src backend/src tools/mcp-server/src ':!*MAP.md'
git log --oneline -S"<DynamicForm" -- renderer/src
git log --oneline -S"getFormBySlug(" -- renderer/src
```

### 12.1 Results of the document checks

Filled in after the file was written (E15). Command: `python3 -I cites.py "<repo>" docs/slices/shop-look-1.md
e6394652c75f93cf5234b651b9dcfd72fc7d952c -v` (a script in `/tmp/SHOP-LOOK-1-check/`, deleted after the run). It reads
every `path:line[-line]` token (and a `, :line` that follows one directly), resolves a bare file name when it is unique
in `git ls-tree -r` of the base (`index.ts` → `packages/shared/src/index.ts`, `en.ts` / `ro.ts` →
`packages/shared/src/language-packs/`, by explicit rule), checks the last line against the file's length at the base
and prints the first cited line. Final run: 142 tokens, 0 out of range, 0 unresolved; every printed line was read and
holds the cited text. The first run found one range past a file end (lines 47 to 55 of `packages/plugins/src/admin.ts`, a file of 54 lines) and six
lines off by one (`SitePage.tsx:865` → `:866`, `RenderBlocks.tsx:139` → `:140`, `:118-120` → `:114-120`,
`AddToCartButton.tsx:244` → `:245`, `dynamo.ts:134/147/149` → `:135/148/150`, `CartContext.tsx:95-104` → `:95-105`)
and two schema ends (`index.ts:1485-1580` → `:1576`, `:1592-1626` → `:1622`); all are corrected. Bare `:line`
citations after a named file are not tokens of the script; a sample of 47 was printed with
`git show <base>:<file> | sed -n <line>p` (Navbar, CategoryShowcaseRender, layout, hero `index.ts`, FeaturesRender,
settings, orders/create, CartPageView, SitePage, ProductEditor, contract.test, the MCP `index.ts`, HeroRender,
BlockEditor, AddToCartButton, dynamo, shared `index.ts`, CategoryEditor, Settings, features schema, bulk-price) and
read: all hold the cited text.

Revision 1 (same method; the script re-created in `/tmp/SHOP-LOOK-1-r1/`, deleted after the run): 182 tokens, 0 out
of range, 0 unresolved, 0 ambiguous; every printed line read, including the new admin-editor references of § 2.2 and
the code of § 6.4, § 6.5 and § 10. Bare `:line` citations added in revision 1 (FeaturesEditor `:45`, `:59-60`;
CategoryShowcaseEditor `:46`, `:50-56`, `:59`, `:112-113`; PostGridEditor `:60`, `:67-68`, `:80-81`; ContactEditor
`:38`, `:41`, `:42`; HeroEditor `:78`, `:92`; FormEditor `:354-358`; Settings `:666-674`, `:1512-1602`, `:902-903`,
`:1334`, `:747`, `:757`; CategoryEditor `:225`, `:254`; shared `index.ts` `:620`, `:1158`; ThemeInjector `:111`;
HeroRender `:98`) were printed with `git show <base>:<file> | sed -n <line>p` and read: all hold the cited text. A
table check (every row of every markdown table outside code blocks has the header's cell count) reports 0
mismatches.

Revision 2 (script re-created in `/tmp/SHOP-LOOK-1-r2/`, deleted after the run): 185 tokens, 0 out of range,
0 unresolved, 0 ambiguous; the new citation `resolveCoverColorTokens.ts:20-27` prints `const TEXT_CLASS_MAP` and
lines 23 and 26 map `foreground` and `muted-foreground` to `text-foreground` and `text-muted-foreground`; table check
0 mismatches.

## 13. Named findings and deferred debt

- **F-SHOP-FORMS-UNPLACED** (pre-existing): the custom-forms feature (admin builder, backend submit route
  `infra/lib/api-engagement.ts:224`, renderer `DynamicForm`) has no way onto a page: no caller of `DynamicForm` or
  `getFormBySlug` was found in the searched current source (E5; the hits are the two definitions and comments). That
  no commit ever placed them is INFERRED (two literal-spelling `git log -S` searches). Owners can build forms that no
  visitor can see. Decision SHOPLOOK-FORM.
- **F-SHOP-HIDDEN-CATEGORY-PAGE** (pre-existing): a category with status `hidden` is left out of every category list
  (`renderer/src/lib/dynamo.ts:318-327`) but its page still renders: `getCategoryBySlug` has no status check
  (`dynamo.ts:262-275`) and the category route checks only existence (`renderer/src/components/SitePage.tsx:408-411`).
  The admin offers "Hidden" (`admin/src/pages/CategoryEditor.tsx:188`) with no text that says which of the two it
  means. The name suggests "not reachable"; the behaviour is "not listed". Not changed by this design; the new
  category reads of § 6.4 follow the "not listed" meaning (they skip a hidden category).
- **F-SHOP-RADIUS-INERT** (pre-existing): the theme field `radius` (admin "Border Radius", `admin/src/pages/Settings.tsx:2257-2259`; schema comment "UI Roundness", `packages/shared/src/index.ts:310`) sets `--radius`
  (`ThemeInjector.tsx:111`), but the components use `rounded-md`, `rounded-lg`, `rounded-full`, which read
  `--radius-md` and others; only the bare class `rounded` reads `--radius` (E9). The setting's name promises a
  site-wide roundness it does not give. Proposed: a rename or a real wiring — a boundary-touching change (stored theme
  key), not done here.
- **F-SHOP-SHOWCASE-NAME** (pre-existing): `categoryShowcase` shows the products of one category, not categories. The
  name misleads (it misled the first reading of section 4). A rename touches stored page JSON (`type`), the MCP tool
  list and the editor; not proposed by this design.
- **F-SHOP-BLOCK-DOC** (pre-existing): `docs/block-types.md:11` lists hero styles "center, split, minimal" and omits
  `cover`; the MCP hero description says the same (`tools/mcp-server/src/index.ts:124`), and the MCP `add_block` type
  list (`:891-912`) omits `videoHero` and `markdown`. Each implementation slice corrects the rows it touches.
- **F-SHOP-FLOOR-UNITS** (§ 8): no sales unit, pack size, minimum or step.
- **F-SHOP-SERVER-TIERS** (pre-existing, commerce): the browser applies `volumePricing` tiers and variant
  `priceOverride` (`AddToCartButton.tsx:86-95`); the order handler charges `salePrice || price` (`orders/create.ts:127`).
  A visitor sees one total in the cart and is charged another.
- **F-SHOP-ORDER-PRICE-STRING** (pre-existing, commerce; INFERRED from code + E8): `price` and `addedCost` are strings
  (`index.ts:1362`, admin `ProductEditor.tsx:571`); `orders/create.ts:138-139`, `:147` add them with `+`, which joins
  strings: unit price "12.50" with an added cost "5" gives the unit price "12.5005" (E8). Without personalizations
  the stored unit price is the string "12.500" and the total is right by accident.
- **F-SHOP-HARDCODED-COLOURS** (pre-existing, Critical Rule 6): `text-red-600` / `text-amber-600` on the shop card
  (`SitePage.tsx:870`, `:878`) and the product page (`:1133`, `:1163`, `:1165`), `text-blue-600` on the post list
  (`PostGridRender.tsx:123`). Fixing them changes the bytes of live pages; not in this design.
- **F-SHOP-AVAILABILITY-TEXT** (pre-existing): the shop card prints the raw availability value with `_` replaced
  (`SitePage.tsx:878`), a visitor text that is not in the locale table.
- Deferred: the card options on the shop/category/search card (§ 7.5); the card options on a catalog site (SL-D10).

## 14. Definition of Done and exit criterion

This SPEC is done when the oracles of the packet pass (only `docs/slices/shop-look-1.md` is new; no whitespace error;
every cited line holds what this document says; each of the 11 sections has an inventory line in § 2.2, a design line
in § 3 and a slice in § 9). After the rulings of § 10, each implementation slice is done when its § 9 oracles exit 0
on a fresh build and its staging evidence is recorded in its own slice record. Exit: an owner builds the reference home
page from Settings and blocks, on staging, with every other tenant byte-equal.

## 15. References

`docs/VISION.md`; `docs/platform-decisions.md`; `docs/plugin-architecture.md`; `docs/caching-architecture.md`
(serving contract); `docs/slices/header-colours-1.md`; `docs/slices/bulk-purge-footer-1.md`;
`docs/slices/category-content-1.md`; `docs/slices/cat-theme-1-impl.md`; `docs/slices/locale-1.md` (the locale table,
the decision format); `docs/slices/catalog-data-labels-1.md` (the house format).

## 16. Revision 1 — review-0 findings, their classes and the rules that close them

| Finding | Class of defect | Rule applied to the whole document | Where |
|---|---|---|---|
| R1 — inventory rows without an admin editor, `—` cells | a required inventory column left implicit | every § 2.2 row names schema, render and admin editor with file:line, or says "none (searched: …)"; the method is § 2.1 item 5 | § 2.1, § 2.2, E16 |
| R2 — CATBAR said "hidden" hides the page; the stable-id option was missing | a behaviour read from a name (`hidden`), and an option matrix that left out the mechanism the design already uses elsewhere | every status or flag a decision relies on is described from the code that reads it, with file:line; every decision lists each mechanism the design already uses for the same data | § 10 SHOPLOOK-CATBAR (option C added, recommendation now C), F-SHOP-HIDDEN-CATEGORY-PAGE, E17 |
| R3 — "one Query" / "≤ 12 Queries" for paginating helpers | a cost bound stated per helper call as if it were per DynamoDB request | every read row states helper calls and DynamoDB requests separately and whether the helper paginates; a paginating helper has no fixed request bound and gets a two-page test | § 6.4, § 9 oracles, E18 |
| R4 — E5 did not reproduce; "never" claims | (a) a command recorded inside a markdown table with its pipes escaped, so the recorded text was not the command run; (b) a historical claim stronger than the search behind it | (a) every command that contains a pipe is in a code block, and no table cell holds a raw pipe (checked for every table, § 12.1); (b) every completeness claim names its search and its scope ("in the searched current source"); a historical conclusion is INFERRED | § 2.1 item 4, § 2.2 row 9, § 2.3, § 10 SHOPLOOK-FORM, § 13, E5 block |
| R5 — inverse panel unreadable | a colour set on a parent, assumed to reach children that carry their own colour classes | every colour option lists each element whose colour class it changes, with the old and the new class; the absent case keeps every class string | § 3 row 6, § 4.2, § 6.5, § 9 (`1b` oracles and staging check), E19 |
| R6 — several badges could match | a list-valued input whose output cardinality and precedence were not stated | every list-valued attribute states how many outputs it gives and in which order, and its tests cover zero, one and several matches in more than one input order | § 4.2, § 7.4, § 9 (`1d` oracles) |

Also found while applying R4(a): the revision-0 row "Tier prices" of § 8 held a raw `||` inside a table cell, which
split the cell; reworded under the same rule.

### 16.1 Revision 2 — review-1

| Finding | Class of defect | Rule applied to the whole document | Where |
|---|---|---|---|
| R5 follow-up — the § 6.5 oracle forbade `text-foreground` / `text-muted-foreground` in the inverse panel, while the same section keeps an explicit accent token, and the token enum allows `foreground` and `muted-foreground` (`packages/plugins/src/common/resolveCoverColorTokens.ts:20-27`) | a blanket negative test assertion that contradicts an input value the design allows | a negative assertion is made only on fixtures where every element is on its default; each owner-selectable value that can produce the forbidden output gets its own fixture that asserts the value is kept. Checked for every negative oracle in the document (search for the negative phrases, § 12 E20): the "absent → HTML equals today's" and "byte-equal without `interest`" cases (§ 9 `1b`, `1d`, § 6.5 case 3) and `prepareBlocks` "adds nothing when the options are off" (§ 9 `1d`) use only fixtures without the new input; the badge "no match" cases (§ 7.4) use only products without a listed tag; the `PUT /settings` refusals (§ 9 `1a`: an over-long tagline, a bad column, an unknown footer key) use only values the schema of § 4.1 forbids. None of them can meet an allowed input | § 4.2, § 6.5 (rule, accent rows, oracle cases 1-3, staging fixture), § 9 `1b` row |

## 17. Ratification — human rulings 2026-11-15

This section records the rulings and the corrections that the decision review forced. It adds to § 1 to § 16 and does
not edit them. Where this section and an earlier section differ, this section governs.

### 17.1 Rulings

| Decision | Ruling | Recommended | What follows |
|---|---|---|---|
| SHOPLOOK-CATBAR | **C** — the owner picks categories by id (up to 12, `header.categoryBarIds`); label and link are read at render | C | `shop-look-1a` as written for C, with the corrected text of § 17.2 |
| SHOPLOOK-BADGE | **B** — the block lists which tags are badges (`badgeTags`) | B | `shop-look-1d` without the product schema and product editor paths |
| SHOPLOOK-FORM | **B** — a new block that places a custom form | A | the re-cut of § 17.3; the contact block is not changed |

Human, verbatim: "decision 1 C, decision 2 B, decision 3 B, and fix those defects".

### 17.2 SHOPLOOK-CATBAR option C — corrected text (decision review, conceded challenge)

The text of option C in § 10 said that a rename or slug change "shows at once" and that a deleted category leaves "no
broken link". The cache code does not give that. The corrected text, which is the ratified one:

- REWARD: subset and order control without a change to any category's status. After a rename, slug change, delete or
  hide, the next page render shows the bar correctly. The change shows on the category's own URL within seconds. On
  every other page it shows after the tenant-wide edge clear, at most about 15 minutes after the change
  (`backend/src/lib/revalidate.ts:270-279`). Stale copies never become permanent, unlike option B. Reads are bounded
  (≤ 12 `GetCommand`s, no pagination); the read function is shared with `categoryGrid`.
- RISK: (1) for up to about 15 minutes after a slug change or a delete, cached pages can show a bar link that leads to
  not-found; if a cache step fails, this lasts until the nightly flush (`revalidate.ts:211-213`). (2) A new category
  does not appear until the owner adds it. (3) No non-category link in row 2.
- Accepted: the bulk-clear delay and the nightly backstop are the same as for today's navigation and listings. A
  guarantee that a link is never broken, even for a moment, is not part of this design; it needs a cache-contract
  change with its own approval.

Corrections that follow from it:

- § 6.4 "Freshness": "within the existing purge times" means: the changed URL within seconds; every other page after
  the tenant-wide clear, at most about 15 minutes after the first pending change; the nightly flush if a step fails.
- § 9 `shop-look-1a` staging evidence gains a warm-page check: on a warm page that shows the bar, (i) change a
  category's slug and (ii) delete a category. For each, record what the bar shows and what its link returns at about
  10 seconds, at about 15 minutes, and after the tenant-wide clear has run.

### 17.3 Re-cut of the slices after SHOPLOOK-FORM = B

| Slice | Change against § 9 |
|---|---|
| `shop-look-1a` | CATBAR = C paths only; the warm-page check of § 17.2 |
| `shop-look-1b` | none |
| `shop-look-1c` | none |
| `shop-look-1d` | showcase card (badge by `badgeTags`, category label, short text, rating) and the post grid aside. The contact rows leave this slice: no change to `packages/plugins/src/contact/`, none to `backend/src/contact/send.ts`, and § 4.4 (`interest` on the contact submission) is not built |
| `shop-look-1e` (new) | a block that places a custom form by its slug, with the card look of section 9. Its packet must first establish, from the code, how the form is read on the server and how the browser submits it (`DynamicForm.tsx:59` calls the API directly today; the contact form goes through the renderer proxy with the origin guard). The submit path gets its own isolation review. If the packet finds that a new route or a new data shape across a boundary is needed, that choice goes to the human before the build |

F-SHOP-FORMS-UNPLACED closes with `shop-look-1e`.

### 17.4 The pricing findings — ruled: fix now, before the look slices

F-SHOP-SERVER-TIERS and F-SHOP-ORDER-PRICE-STRING (§ 13) are fixed first, in the slice `order-price-1`
(`docs/slices/order-price-1.md`). The operator's root-cause check on `e639465` added a third defect of the same path:
the order input schema requires `id` on each personalization (`packages/shared/src/index.ts:1769-1773`), and the
checkout does not send it (`renderer/src/components/CheckoutPageView.tsx:286-290`), so the schema refuses every order
that carries a personalization (probe: `OrderInputSchema.safeParse` on the checkout's payload → `success: false`).
F-SHOP-ORDER-PRICE-STRING is therefore not reachable from the site today; it becomes reachable when the refusal is
fixed, so the three are fixed together.

### 17.5 Order of work

`order-price-1` → `shop-look-1a` → `1b` → `1c` → `1d` → `1e`. The other findings of § 13 stay open and are reported
to the human for ordering.
