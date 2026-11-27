# packages/plugins — ARCHITECTURE.md

## Role in the System

The block plugin registry. Defines the visual building blocks used in the Tiptap content editor (admin) and the public site renderer. Each plugin has a split architecture: an editor component for the admin panel and a render component for the public site.

**Consumed by:** admin (editor extensions), renderer (render components)
**Depends on:** packages/shared (Zod schemas), @tiptap/core, @tiptap/react, react, lucide-react, swiper

## Entry Points

Three separate entry points keep bundles lean:

| Entry | Import Path | Exports | Used By |
|-------|-------------|---------|---------|
| `src/index.ts` | `@amodx/plugins` | `types` only | Type-level imports |
| `src/admin.ts` | `@amodx/plugins/admin` | `getExtensions()`, `getPluginList()` | Admin BlockEditor |
| `src/render.ts` | `@amodx/plugins/render` | `RENDER_LOADERS` (key → lazy render loader) | Renderer RenderBlocks |

- `getExtensions()` returns an array of Tiptap Node extensions for all plugins
- `getPluginList()` returns `{key, label, icon, offeredOn}[]` for the editor toolbar insert menu; `offeredOn` (CAT-ADMIN-2)
  is the list of site kinds (`"commerce"`, `"catalog"`) whose inserter offers the block, `[]` = every site
  (`category-showcase`: both; `category-grid`: both; `reviews-carousel`: commerce), and the renderer never reads it
- `RENDER_LOADERS` is a `Record<string, () => Promise<{ default: React.FC<any> }>>` mapping block type
  keys to **dynamic `import()` thunks** (perf-1). It replaced the eager `RENDER_MAP`: because the
  renderer's `RenderBlocks` is a client component, an eager map pulled every plugin (incl.
  highlight.js / marked / swiper) into one ~1.2 MB client chunk on every content page. RenderBlocks
  now wraps each loader in `next/dynamic`, so a page ships only the render chunks for the block types
  it renders. The thunks are plain ESM `import()` — no framework coupling — so the split-entry rule
  (render vs admin) holds. See `docs/slices/perf-1-unused-js.md`.

## Plugin File Structure

Every plugin follows this pattern:

```
src/blocks/<name>/
├── index.ts          # PluginDefinition export (key, label, icon, schema, editorExtension, renderComponent)
├── schema.ts         # Zod schema for block attributes
├── <Name>Editor.tsx  # Tiptap NodeView React component (admin-only)
└── <Name>Render.tsx  # Pure React render component (SSR-safe)
```

## All 24 Plugins

This table lists every key in `RENDER_LOADERS` (`src/render.ts`) — one row per registered
render loader. It must stay in sync with that map (perf-1: 20 loaders; 21 since `shop-look-1c`; 22 since `shop-look-1e`;
23 since `newsletter-1`; 24 since `gallery-1`).

| Key | Label | Attributes | Styles/Variants |
|-----|-------|-----------|-----------------|
| `hero` | Hero Section | headline, subheadline, ctaText, ctaLink, imageSrc, style, cover tokens; optional eyebrow, headlineAccent (+ token), secondaryCtaText/Link, stats[], buttonShape, splitPanel (see § *The `hero` block's options*) | center, split, cover, minimal |
| `videoHero` | Video Hero | headline, subheadline, videoSrc, posterSrc, ctaText, ctaLink, overlay/heading color tokens, muted, loop, blockWidth | direct → native `<video>`, YouTube/Vimeo → cover `<iframe>`, unknown → poster (see § *The `video-hero` block's render contract*) |
| `pricing` | Pricing Table | headline, subheadline, plans[] (title, price, interval, features, highlight) | — |
| `image` | Image | src, alt, caption, width, aspectRatio | full, wide, centered |
| `contact` | Contact Form | headline, description, buttonText, successMessage, tags | — |
| `video` | Video Embed | url, caption, width, autoplay | centered, wide, full; YouTube/Vimeo → iframe, direct media → native `<video>`, unrecognized → nothing (see § *The `video` block's render contract*) |
| `leadMagnet` | Lead Magnet | headline, description, buttonText, resourceId, fileName, tags | — |
| `cta` | Call to Action | headline, subheadline, buttonText, buttonLink, style | simple, card, band |
| `features` | Feature Grid | headline, subheadline, items[] (title, description, icon), columns | 2, 3, or 4 columns |
| `testimonials` | Testimonials | headline, subheadline, items[] (quote, author, role, avatar), style | grid, slider, minimal |
| `columns` | Column Layout | columnCount, gap, columns[] (width, content) | 2-4 cols, sm/md/lg gap |
| `table` | Data Table | headers[], rows[] (cells[]), striped, bordered | — |
| `html` | Raw HTML | content, isSandboxed | — |
| `faq` | FAQ Accordion | headline, items[] (question, answer) | Generates FAQPage JSON-LD |
| `postGrid` | Post Grid | headline, filterTag, limit, showImages, layout, columns; optional (SHOP-LOOK-1D): eyebrow, asideText, asideQuote, asideButtonText, asideButtonLink | grid, list; 2 or 3 cols |
| `carousel` | Carousel | headline, items[] (title, description, image, link), height, style | standard, coverflow (Swiper) |
| `codeBlock` | Code Block | code, language, filename, showLineNumbers, blockWidth | 19 languages; dark `<pre><code>` + copy button |
| `reviewsCarousel` | Reviews Carousel | headline, scope, productId, items[] (name, avatar, date, rating, text, source, photos), showSource, autoScroll, maxLines, blockWidth | manual / product-reviews-by-id / site-reviews (see § *The `reviews-carousel` block's render contract*) |
| `categoryShowcase` | Category Showcase | categoryId, categoryName, categorySlug, limit, columns, showPrice, ctaText, blockWidth; optional (SHOP-LOOK-1D): eyebrow, badgeTags, showCategoryLabel, showDescription, showRating | 2 / 3 / 4 columns |
| `categoryGrid` | Category Grid | eyebrow, headline, categoryIds[] (≤ 12, tile order), columns, ctaText, chips[] (label, href; ≤ 12), blockWidth; server data `_categories` (see § *The `category-grid` block*) | 2 / 3 / 4 columns from `lg` |
| `markdown` | Markdown | content, blockWidth | rendered via `marked` (async chunk) |
| `form` | Custom Form | formSlug, eyebrow, headline, text, card, blockWidth; server data `_form` (see § *The `form` block*) | plain or in a card |
| `newsletter` | Newsletter Signup | headline, description, buttonText, blockWidth; server data `_newsletter` (the locale texts); form component also exported as `@amodx/plugins/newsletter/NewsletterForm` for the renderer's popup (NEWSLETTER-1, `docs/block-types.md` § *Newsletter signup*) | — |
| `gallery` | Photo Gallery | items[] (src, thumb?, alt, caption?, width?, height?), columns, blockWidth; server data `_gallery` (the viewer's locale texts; see § *The `gallery` block*) | 2, 3, 4 columns from larger screens; 2 on a phone |

## Tiptap Integration Pattern

Each plugin registers as a Tiptap `Node` extension:
- `name`: matches the plugin key
- `group: 'block'`, `atom: true` — block-level, non-editable inline
- `addAttributes()`: defines default values for all block attrs
- `addNodeView()`: returns `ReactNodeViewRenderer(EditorComponent)` for the admin UI
- `parseHTML()` / `renderHTML()`: HTML serialization (used for clipboard)

## Storage Injection

Plugins access runtime dependencies via `editor.storage.<key>`:
- `editor.storage.image.uploadFn` — file upload to S3 (presigned URL)
- `editor.storage.image.pickFn` — open media library picker dialog
- `editor.storage.postGrid.fetchTagsFn` — load available tags for autocomplete
- `editor.storage.categoryShowcase.fetchCategoriesFn`, `editor.storage.categoryGrid.fetchCategoriesFn` — the tenant's
  category list (`GET /categories`; one function, both storages)
- `editor.storage.form.fetchFormsFn` — the tenant's custom forms (`GET /forms`: `id, name, slug, status`), SHOP-LOOK-1E
- `editor.storage.gallery.pickManyFn` — the media picker in its multi-select mode: `pickManyFn(callback(urls), { mediaType })`;
  the addresses come in the order the owner marked them (GALLERY-1)

These are injected by the admin's BlockEditor component before the editor mounts.

## Render Component Contract

All render components receive: `{ attrs: <schema type>, tenantId?: string, strings: BlockStrings }` — the type of
`PluginDefinition.renderComponent` (`src/types.ts`, ruling LOCALE1C-REGISTRY-TYPE = A), so the compiler checks every
registration. `strings` is required; the eleven text-bearing renderers of `locale-1c` read it, the nine others ignore it.

**Block texts (slice `locale-1c`, ruling LOCALE1-BLOCK-TEXTS = A).** `strings` is the `BlockStrings` DTO of
`@amodx/shared` (`blockStrings`): the fixed chrome texts of the tenant's locale table — form labels and status texts,
"Copy", "Read more", "No posts found.", missing-image placeholders, iframe-title fallbacks — plus `dateLocale` for the
two date formatters. The renderer's `RenderBlocks` always passes it. A text the author writes in the block (headline,
button text, `successMessage`, image `alt`, video `caption`) stays an attribute and wins over its key. Every text is
shown exactly as resolved (a stored `""` stays empty, docs/slices/locale-1.md § 5.2 pattern D), except the two iframe
names `videoTitle` / `videoBackgroundTitle`: pattern F in `blockStrings` (a stored `""` → the language default), so an
iframe's accessible name is never empty (ruling LOCALE1C-IFRAME-NAMES = A). A branch (which error text, whether an
error box shows) is chosen by the server's answer or the fetch outcome, never by testing a table text.
Dates: the post grid uses `strings.dateLocale` (absent for an en-US tenant → the runtime default, as before). The reviews
carousel (slice `locale-reviews-date-1`, human ruling 2026-11-01 on finding F-LOCALE-REVIEWS-DATE): a block `locale`
attribute that is a non-empty string is passed raw (not normalised); otherwise (absent, `""`, not a string) the site
setting — `strings.dateLocale`, or `"en-US"` for an en-US tenant. No Romanian date default remains.
The render files import `BlockStrings` as a TYPE only: a runtime import of `@amodx/shared` in a render module makes the
renderer's bundler split the shared package into an extra client chunk on every page (EXECUTED, docs/slices/locale-1c.md
D3). There is no English fallback (ruling LOCALE1C-FALLBACK = A): `strings` is required by the typed contract and
omitting it is unsupported; there is no runtime validation (a render branch that reads a text throws a `TypeError`, a
branch that reads none renders). This package's
tests that render a block pass an en-US tenant's `blockStrings` (`videoPlugin`, `videoHeroPlugin`, `reviewsCarousel`).

**Showcase price range (slice `price-locale-1`, ruling PL1-SHOWCASE = C narrowed).** `CategoryShowcaseRender` prints
a product's price range as `min – max` when the product has volume tiers. A product may carry `_priceRange: { min, max }`
(numbers): the renderer's server pass (`prepareBlocks` in `renderer/src/components/SitePage.tsx`) sets it ONLY for a
tenant whose locale writes a decimal comma and a product whose `price` or a tier price contains a comma, computed with
the shared `parseMoney` on the server (the render file keeps its type-only import of `@amodx/shared`, D3 above). The
card prints the given range; without it the card reads `price` and the tier prices with `parseFloat`, exactly as before
— recorded debt (record `docs/slices/price-locale-1.md` F-PL1-9), to be removed with `shop-look-1d`. The browser
fallback fetch (no server prefetch, e.g. the editor preview) has no `_priceRange`: a comma text there is read by
`parseFloat` (`12,50` → 12).

Client-side components (contact form, lead magnet, post grid) use `window.AMODX_TENANT_ID` for API calls and submit to `/api/contact`, `/api/leads`, or `/api/posts`. The `form` block (SHOP-LOOK-1E) uses its `tenantId` prop and posts to the API directly (`process.env.NEXT_PUBLIC_API_URL` + `/public/forms/{slug}/submit`), as the showcase's fallback fetch reads the API address; its reCAPTCHA token comes from the same page globals as the contact form's.

## Shared modules under `src/common/`

Code more than one plugin needs. Imported by RELATIVE path from the plugin directories, so
it works from both the `admin` and `render` entry points without either importing the other
— which is what keeps Critical Rule 1 (plugin split entry) intact. A module here that is not
SSR-safe would break the renderer's server bundle, so anything with a `window` / `document`
reference belongs in a plugin's `*Editor.tsx`, not here.

| Module | What |
|--------|------|
| `videoSource.ts` | **Video URL parser** (slice `vid-1`). `parseVideoSource()` classifies a pasted URL four ways — `youtube` \| `vimeo` \| `direct` \| `unknown` — returning `{ kind, rawUrl, embedUrl, providerId? }`. **`embedUrl` is not uniformly safe:** for `youtube`/`vimeo` it is *rebuilt* from a validated provider id (nothing of the caller's string survives), for `direct` it is the caller's raw URL *verbatim* (`embedUrl === rawUrl` — the plan's rule 3 contract; trimming happens only to classify), and for `unknown` it is `null`. `buildEmbedUrl()` / `buildBackgroundEmbedUrl()` construct player URLs from an id; `isDirectMediaUrl()` detects uploaded media — extension **and** an absent/`http`/`https` scheme, so a `javascript:`/`data:`/`file:` string ending in `.mp4` classifies `unknown`, never `direct` (ratified 2026-07-28, `VID1-DIRECT-SCHEME-CONTRACT`; it is defence in depth, **not** a substitute for encoding output in the render path). Pure, **total** (never throws; `""` → `unknown`, `embedUrl: null`), **zero imports** — so SSR-safety is a property of the file, not of a dependency. Unit-tested. |
| `resolveButtonEffect.ts` | Converts the legacy `GlowEffectConfig` to the unified `EffectConfig` on read |
| `resolveCoverColorTokens.ts` | Cover/overlay colour token resolution |
| `EffectControls.tsx`, `EffectPreview.tsx` | Admin-side effect configuration UI; the only two entries `package.json` exports individually (`@amodx/plugins/common/EffectControls`, `…/EffectPreview`) for the admin app |
| `ButtonEffectWrap.tsx` | Button effect compositor (four-layer shell + chip) |
| `LazyEffectCanvas.tsx` | Lazily-loaded block background effect canvas; carries `'use client'` |
| `InlineRichTextField.tsx`, `InlineRichTextRenderer.tsx` | Inline rich-text editing field and its render counterpart |

*(The one-line descriptions of the pre-`vid-1` modules are read from their file headers;
`vid-1` characterized only `videoSource.ts` and did not re-audit the others.)*

`videoSource.ts` is the SUPPORT module `vid-2` (`video`) and `vid-3` (`video-hero`) consume.
`vid-2` **deleted** the inline YouTube regex from `video/VideoRender.tsx`; `vid-3` put
`video-hero` on the same parser. **No render path in this package now carries a video-URL
regex, and none may grow one** — both video blocks branch on `parseVideoSource` and nothing
else, so they cannot disagree about what a pasted URL means.

## The `video` block's render contract (slice `vid-2`)

`video/VideoRender.tsx` branches on `parseVideoSource(attrs.url).kind` and nothing else:

| Kind | Element | `src` | Notes |
|------|---------|-------|-------|
| `youtube` / `vimeo` | `<iframe>` | `buildEmbedUrl(kind, providerId, { autoplay })` — **rebuilt from the validated id**, nothing of the pasted string survives | `loading="lazy"` + `title` (the caption, else `"Embedded video"`) |
| `direct` | `<video controls>` | `embedUrl`, which for this kind IS the raw URL | `autoPlay` implies `muted` + `playsInline`, or the browser blocks it; no `loading` |
| `unknown` | *(none — returns `null`)* | — | Empty `url` classifies here too. **No markup at all**, so a bad URL leaves no artifact on a public page |

The `unknown` branch is silent by design, so the author's only signal is editor-side:
`video/VideoEditor.tsx` shows a provider indicator (icon shape + label, `text-muted-foreground`
— never brand colour, Critical Rule 6) for the three recognized kinds, and a neutral-token
warning callout for a non-empty unrecognized URL. Validation is warning-only and never blocks
a save. Both surfaces call the SAME classifier, so what the editor promises and what the page
renders cannot drift.

**Do not read "the parser returned an `embedUrl`" as "the parser returned a safe URL"** —
true for `youtube`/`vimeo`, false for `direct` (`docs/TECH-DEBT.md` § *vid-1 residuals*).
The render path's three defences are: provider URLs are rebuilt from a validated id;
`direct` is constrained by `isDirectMediaUrl`'s http(s) scheme guard; and `rawUrl` is **never**
rendered — it stays in the editor for echo-back. No `dangerouslySetInnerHTML` on this path.

## The `video-hero` block's render contract (slice `vid-3`)

`video-hero/VideoHeroRender.tsx` branches on `parseVideoSource(attrs.videoSrc).kind`:

| Kind | Background element | `src` | Notes |
|------|--------------------|-------|-------|
| `direct` | native `<video autoplay playsinline>` | `embedUrl`, which for this kind IS the raw URL | `muted` / `loop` stay author-controlled; `object-cover` does the covering |
| `youtube` / `vimeo` | `<iframe>` | `buildBackgroundEmbedUrl(kind, providerId)` — **rebuilt from the validated id** | cover via the inline sizer below; `title`; `allow="autoplay; …"`; **no** `loading="lazy"` |
| `unknown` | the poster `<img>`, or nothing when no poster is set | — | Empty `videoSrc` classifies here too |

Note the deliberate divergence from the `video` block: `unknown` there renders **nothing**
(`VID2-UNKNOWN-OUTPUT`), because an empty 16:9 box is a black hole in a content column. Here
it renders the **poster**, because a hero is a full-bleed text/CTA surface that still has to
have a backdrop. Both are ratified; they are not an inconsistency to "fix".

**Why the iframe needs a sizer at all.** `object-fit: cover` is a property of REPLACED
elements. An `<iframe>` is not one — it is a viewport onto another document, and the provider
letterboxes its 16:9 video inside whatever box it is given. So cover is done by sizing the
box: `width: max(177.7778vh, 100%)` against `height: max(100vh, 56.25vw)`, centred with
`translate(-50%, -50%)`. Both pairs are exactly 16:9, so whichever wins the video fills the
box and the overflow crops symmetrically — landscape wins on the `vh` pair, portrait on the
`vw` pair. It is an **inline style**, not a class: this package emits no CSS (`npm run build`
is bare `tsc`, there is no bundler and no `.css` file), so a class would need a new delivery
mechanism, and a Tailwind arbitrary value would make the cover depend on the consuming app's
`@source` scan. It is geometry, not colour, so Critical Rule 6 is not in play.

Known boundary, recorded in `docs/TECH-DEBT.md` § *vid-3 residuals*: the `vh` terms are
viewport-relative while the section is `min-h-[70vh]`, so a hero made taller than the
viewport by its own headline/CTA can stop being fully covered.

The editor mirrors the render: `VideoHeroEditor.tsx` has a **tabbed** Upload | Library |
Embed selector over the single `videoSrc` attribute, a provider indicator and warning callout
driven by the SAME classifier, a YouTube thumbnail preview
(`img.youtube.com/vi/{id}/hqdefault.jpg` — `hqdefault`, not `maxresdefault`, which 404s for
sub-720p uploads), and — because `buildBackgroundEmbedUrl` hardcodes mute+loop — it replaces
the Muted/Loop checkboxes with a statement of fact whenever the source is a provider embed,
rather than leaving two controls that silently do nothing.

## The `reviews-carousel` block's render contract (slice `rev-4`)

`reviewsCarousel` (`src/reviews-carousel/`) renders customer reviews as a horizontally-scrolling
card strip. Beyond the authored fields it carries a **data-source discriminator**, `scope`
(`ReviewsCarouselSchema`), with three values — the block is where a review's approved *photos*
reach visitor markup:

| `scope` | `items` source | Photos |
|---------|----------------|--------|
| `manual` (default) | author-typed `items` (unchanged original behaviour) | never rendered |
| `product-reviews-by-id` | server prefetch REPLACES `items` with a product's approved reviews (by the `productId` attr) | rendered |
| `site-reviews` | server prefetch REPLACES `items` with the tenant's approved SITE-scope (`SITEREVIEW#`) reviews | rendered |

**The prefetch lives in the renderer, not here.** `ReviewsCarouselRender` is a pure view: it
consumes an `items[]` whose `photos` are already resolved public URLs. The DB reads
(`getSiteReviews` / `getProductReviews`), the approved-only + private-key-leak filter, and the
assetKey→URL resolution all live in `renderer/src/lib/review-images.ts` + `SitePage.tsx`'s prefetch
branches (see the renderer ARCHITECTURE § *Review images*). This keeps Critical Rule 1 (split
entry) intact — the block imports no renderer/DB code.

**Photos are DB-scope-gated in the render, defence-in-depth.** `items[].photos` is NOT
author-editable (only the server prefetch writes it), but `RenderBlocks` passes persisted attrs
through WITHOUT schema-parsing, so a hand-edited `manual`/legacy block could carry an injected
`photos` array. `ReviewsCarouselRender` therefore emits photo markup ONLY when
`scope ∈ {site-reviews, product-reviews-by-id}`; a non-DB scope renders no thumbnail regardless of
`item.photos`, so an unmoderated URL can never reach markup. Photos render as bounded lazy `<img>`
inside a plain `<a target="_blank">` to the full image — RAW asset URLs, **never** `next/image`
(opennext-1 parking rule).

The editor (`ReviewsCarouselEditor.tsx`) exposes the `scope` toggle and a `productId` input (shown
only for `product-reviews-by-id`); in the two DB scopes the manual item editor is hidden.

## The `hero` block's options (slice `shop-look-1b`)

Design `docs/slices/shop-look-1.md` § 4.2, § 6.2, § 6.5; record `docs/slices/shop-look-1b.md`. Eight optional attributes
(zod `.optional()`, no default; Tiptap `default: null`). **Absent = today's bytes:** absent, `null`, a blank text (whitespace
only), an empty list, `buttonShape: "rounded"` and `splitPanel: "plain"` render the HTML of the hero before the slice,
character for character — pinned by `test/hero.baseline.json` (recorded at 783e95f, before the change).

| Attribute | Styles | Render |
|---|---|---|
| `eyebrow` | all | `<p>` pill (`rounded-full border`, small uppercase) directly above the `<h1>`; text trimmed. Colour: page `text-primary`, inverse panel `text-background`, cover the cover headline's class with `border-current` (ruling SL1B-COVER-EYEBROW) |
| `headlineAccent` | all | inside the `<h1>`, after the headline and one space: `<span>`; colour = `headlineAccentColorToken` via `resolveTextClass` (absent, `auto` or an unknown value → `text-primary`; on the inverse panel `text-background/70`); an explicit token is kept on every surface |
| `secondaryCtaText` / `secondaryCtaLink` | center, split, cover | shown when the text is non-blank: one row (`flex-col`, `md:flex-row`) holds the first button then an outline `<a>`; the row replaces the first button's slot. Link through `attrs._getUrl` (RenderBlocks); a blank link → `#`; a link without text → nothing |
| `stats` | center, split, cover | items with a non-blank value, at most four, in a grid after the buttons (`grid-cols-1/2/3`, four → `grid-cols-2 md:grid-cols-4`); a blank caption → no caption `<p>` |
| `buttonShape` | center, split, cover | `pill` → both buttons `rounded-full` (the first button: a second complete literal, `btnClassPill`). With a `buttonEffect`, the effect shell of `ButtonEffectWrap` keeps its own `rounded-lg` (not changed) |
| `splitPanel` | split | `inverse` → `SPLIT_PANEL.inverse`: panel `+ bg-foreground`, headline `text-background`, text `text-background/80`; the new elements take `INVERSE_TONE`. The first button keeps its fill and label and gains `border border-background/40` (`FIRST_BUTTON_CLASS.inverse`, ruling SL1B-INVERSE-BUTTON, amends design § 6.5) |

Class rule: an EXISTING element's class string is a complete literal chosen by one lookup (`FIRST_BUTTON_CLASS[plain |
inverse][rounded | pill]`, whose `plain` entries are `btnClass` / `btnClassPill`; `SPLIT_PANEL.plain` / `.inverse`), never today's string with a part appended. The NEW elements exist only
when set; their strings are composed from literal parts by surface (`PAGE_TONE`, `INVERSE_TONE`, `coverTone(hl, sh)`). On
`cover` the eyebrow, the outline button and the numbers follow the cover headline token, the captions the subheadline token (defaults
white and white/90 — the cover's own defaults); the design names no cover colour for them (record § *Decisions*).
Every class is a literal in `HeroRender.tsx`, so the renderer's Tailwind (`@source` on this package) compiles it. The editor
stores a cleared option as `null` (`storedOption` in `HeroEditor.tsx`: blank text, empty list or the default choice).

## The `category-grid` block (slice `shop-look-1c`)

Design `docs/slices/shop-look-1.md` § 3 rows 4-5, § 3.1, § 4.2, § 6.2, SL-D11/12/14; record `docs/slices/shop-look-1c.md`.
A new block (no stored instances): ordinary defaults (`schema.ts`; the Tiptap attributes repeat them, pinned by
`test/categoryGrid.test.ts`). Offered on commerce and catalog sites (`offeredOn`); the renderer draws it on every site.

- **Data:** the render reads no category itself. The renderer's server pass (`prepareBlocks`, `renderer/src/components/
  SitePage.tsx`) reads the picked ids (non-blank strings, the first 12) with `getActiveCategoriesByIds` and sets
  `attrs._categories` = the active, existing ones in the picked order, each `{ id, name, description?, imageLink?, path }`
  (`path` = the tenant's category prefix + slug). No `_categories` (no server pass: the admin preview) → the block draws
  nothing; no browser fetch (SL-D12).
- **Render (`CategoryGridRender.tsx`):** `<section>` with an optional header (eyebrow pill, `<h2>` headline), a grid of
  `aspect-[3/4]` tile links (`GRID_CLASS`: one column, two from `sm`, `columns` from `lg`; an unknown value → `"4"`), then
  optional chips (`<ul>` of pill `<a>`; an item without a non-blank label or href is skipped). `_categories` empty → the
  header and chips only; none of them either → nothing. Each tile: the photo (`<img alt="" loading="lazy">`, raw URL as
  the showcase cards; none → no element, the tile's `bg-muted` shows), then the text panel: name `<h3>`, description
  (`line-clamp-2`; blank → no element), `ctaText` (blank → no element). Texts are trimmed. Links through `attrs._getUrl`.
- **Overlay rule:** every tile text sits on a scrim `bg-foreground/75` (a fade `bg-gradient-to-t from-foreground/75` above
  it carries no text), in `text-background`. Worst photo (a pixel of the text's own colour): 9.5 : 1 on the default theme,
  10.4 : 1 on a dark theme (#f8fafc / #020817), calculated; the theme's own text/background pair sets the bound.
- **Texts:** all owner content or category data; no `strings` key; the render imports only `react` (pinned by the test).
- **Editor (`CategoryGridEditor.tsx`):** English; category list from `editor.storage.categoryGrid.fetchCategoriesFn`; add
  (`withPickedId`), move up / down (`withItemMoved`), remove (`withoutItem`) — exported pure functions, the test seam
  (no DOM harness); the picked list with photo and name is the editor's preview; a picked id that is missing or not
  active is marked "skipped on the site".

## The `category-showcase` card options and the `post-grid` side panel (slice `shop-look-1d`)

Design `docs/slices/shop-look-1.md` § 3 rows 7-8, § 4.2, § 6.2, § 6.3, § 7; record `docs/slices/shop-look-1d.md`. Ten
optional attributes (zod `.optional()`, no default; Tiptap `default: null`). **Absent = today's bytes:** absent, `null`,
blank text, an empty list, a list of blank entries, `false` and malformed values render the HTML of both blocks before the
slice, character for character — pinned by `test/sectionBlocks.baseline.json` (recorded at 61d965d, before the change;
cases in `test/sectionBlocksBaselineCases.ts`).

- **Showcase (`CategoryShowcaseRender.tsx`).** `eyebrow`: a pill `<p>` first in the `<section>` (every site). The four
  card options are resolved once per block into `CardOptions`; on a catalog site (`_catalogMode`) all four are off
  (SL-D10). `badgeTags` → `badgeOf`: at most one badge, the first entry of the block's list that the product's `tags`
  holds (letter case ignored, spaces kept — `badge-case-1`; the text is the block's entry as stored; blank entries
  ignored), an opaque `bg-primary` pill over the photo, after the out-of-stock overlay.
  `showCategoryLabel` / `showDescription` / `showRating` draw the product keys `_categoryName` / `_descriptionText` /
  `_rating` that the renderer's server pass adds only when the option is on (`withShowcaseCardData` in
  `renderer/src/components/SitePage.tsx`); a product without the key draws no element. Rating: `★` × the rounded average
  (0-5, `aria-hidden`) and the server-filled `reviewsSummary` text. The price code is unchanged (debt F-PL1-9 kept).
- **Post grid (`PostGridRender.tsx`).** `eyebrow`: a pill `<p>` above the headline. The side panel (text, quote, button)
  shows when one of text, quote, button text is non-blank: `grid md:grid-cols-3` with `<aside>` first (above on a phone)
  and today's list element in `md:col-span-2`. The button: drawn with a text; link through `attrs._getUrl`, blank → `#`.
  The loading, error and empty boxes are unchanged.
- **Texts:** owner content or data; no new `strings` key; both renders keep a type-only import of `@amodx/shared` (D3).
- **Editors:** English controls; a cleared option stores `null` — `storedShowcaseOption` and `badgeTagsFromText`
  (`CategoryShowcaseEditor.tsx`), `storedText` (`PostGridEditor.tsx`), exported pure functions, the test seam.

## The `form` block (slice `shop-look-1e`)

One custom form of the tenant (admin Forms), placed by its slug (`formSlug`). Files: `src/form/{schema.ts, index.ts,
FormEditor.tsx, FormRender.tsx, DynamicForm.tsx}`; record `docs/slices/shop-look-1e.md`. Offered on every site kind (no
`offeredOn`).

- **Server data (`_form`).** The renderer's `prepareBlocks` reads the form with `getFormBySlug` (active forms only) and
  gives `{ slug, name, fields, submitButtonText, successMessage, strings }`: `fields` = the stored entries that pass
  `FormFieldSchema`, the first field of each label (the submit handler's rule — labels are the submission's keys);
  `strings` = `formSubmissionFailed`, `formErrorShort`, `formSelectPlaceholder`, `formSubmitting` of the tenant's
  locale table (three of them are not block keys, so the block's `strings` prop does not hold them). No `_form` → the
  render draws nothing (no slug, no form, disabled form, or the admin preview).
- **Render (`FormRender.tsx`).** Optional eyebrow, headline, text (blank = absent), centred above the form; the form at
  most `max-w-lg`; `card === true` → `rounded-xl border border-border bg-background p-6 md:p-8 shadow-sm`. Theme classes
  only.
- **Form (`DynamicForm.tsx`).** Moved from `renderer/src/components/DynamicForm.tsx` (it had no importer). Each field by
  its type; `data` keyed by field label; `submitterEmail` = the first email field's value; reCAPTCHA v3 action
  `form_submit` from `window.AMODX_RECAPTCHA_KEY` / `window.grecaptcha`; success → the success text replaces the form;
  failure → the server's `error` text, else `formSubmissionFailed`; a thrown fetch → `formErrorShort`. Required mark and
  error text `text-destructive`; the success icon keeps `text-green-500` (no success token in the theme; finding
  F-1E-SUCCESS-COLOUR). Each label is tied to its control (`htmlFor` / `id` from `useId`).
- **Editor (`FormEditor.tsx`).** English; the form list from `editor.storage.form.fetchFormsFn`; a select of the forms by
  name (a disabled form marked), the stored slug kept as an option while the list loads; `formSlugNote` (exported, pure)
  says why the site would draw nothing.
- Render imports: `react`, `lucide-react`, and `@amodx/shared` as a type only (D3).

## The `gallery` block (slice `gallery-1`)

A grid of photo tiles; each tile is a plain link to its large photo, and with script a viewer opens it. Files:
`src/gallery/{schema.ts, index.ts, GalleryEditor.tsx, GalleryRender.tsx, GalleryViewer.tsx}`; record
`docs/slices/gallery-1.md` § *Build record*. Offered on every site kind (no `offeredOn`). Maturity: PROTOTYPE.

- **Server data (`_gallery`).** The renderer's `prepareBlocks` gives `galleryTexts` of the page's language: `{ viewer,
  close, previous, next, counter, photo }` (every text non-blank; `counter` holds `{n}` `{total}`, `photo` `{n}`). No
  `_gallery`, or one not of that shape → the render draws nothing (no English text on a page in another language).
- **Stored items are checked by the render** (the backend does not check block attributes): an item whose `src` is not a
  string, is blank, or fails the address rule is dropped; the others render, numbered again. Address rule
  (`galleryAddress`): the trimmed value is `https://<host>…` or a root-relative `/…` (not `//…`), and holds no control
  character and no backslash (a browser removes the first and reads the second as `/`, which could turn `/…` into a
  `//host` address after the check). Not `isDirectMediaUrl` of `common/videoSource.ts`: that rule accepts `http:`, `//host`
  and relative paths and needs a video extension. A `thumb` that fails the rule counts as absent. `alt` absent or blank →
  `alt=""`, never the file name. `width`/`height`: both positive integers, else neither.
- **Grid (`GalleryRender.tsx`, server-rendered).** `<ul>` of `<li><a href={src} data-gallery-index={i}><img src={thumb ??
  src} alt loading="lazy" decoding="async" width? height?></a></li>`. Every tile is a 4:3 box, photo `object-cover`, so it
  reserves its space before the photo loads. The tile link is named by `alt`; without one by the locale text `photo`
  with its position (`aria-label`). `GRID_CLASS`: two columns on a phone, `sm:`/`lg:` up to `columns` ("2" | "3" | "4",
  strings as `category-grid`; anything else → "3").
- **Tile loading (ruling 9 as narrowed, GALLERY1-TILE-FILES = A).** A tile with `thumb` loads the small file. A tile
  without `thumb` loads the LARGE file, deferred only by native lazy loading, and the browser loads every lazy image within
  its distance of the screen (fixture GL1: 30 of 30 tiles by default, 28 of 30 under 4G emulation), so no page-load
  guarantee is claimed for it. Small files made at upload: follow-up `gallery-thumbs-1`.
- **Viewer (`GalleryViewer.tsx`, `"use client"`).** Wraps the grid; a plain left click on a tile opens the native
  `<dialog>` with `showModal()` at that position (a modifier key or another button keeps the browser's action). Named by
  `viewer`; Close, Previous, Next are 44 px buttons named by the locale texts; Escape, arrow keys, a horizontal swipe
  (`swipeStep`: ≥ 40 px, mostly horizontal); steps wrap (`steppedIndex`); a click on the empty area around the photo
  closes; on close, focus returns to the opening tile. The counter (`aria-live="polite"`) is the `counter` template.
  Closed, the dialog itself holds no image; open, the photo of its position only, and the next one is fetched ahead
  (`new Image()` in an effect). First render = the closed viewer on server and browser (no `window`/`document` read in
  render). No animation or transition. It takes a plain photo list (`ViewerPhoto[]`), but only this block uses it.
- **Template rule.** `fillLocaleTemplate` (in `GalleryViewer.tsx`) is a copy of `@amodx/shared` `fillTemplate`, bound to
  it by `test/galleryBlock.test.ts`. Kept by the stop condition of ruling GALLERY1-TEMPLATE-IMPORT = C: importing
  `fillTemplate` in this lazy chunk moved the stylesheet link and a script of every page (the same 11 serving rows) both
  from the shared barrel and from an import-free module `@amodx/shared/dist/template.js`. Render imports:
  `react`, `lucide-react`, and `@amodx/shared` as a type only.
- **Editor (`GalleryEditor.tsx`).** English; "Add photos" calls `editor.storage.gallery.pickManyFn` (images only) and
  appends the picked addresses in the picked order (`withPhotosAdded`, exported pure function); per photo a description
  and a caption input; move up / move down / remove buttons (`withItemMoved`, `withoutItem` of `category-grid`'s editor,
  reused). `thumb` and the sizes are not asked for (tools write them) and are kept when a photo is edited.

## Tests

`npm test -w packages/plugins` → vitest, `test/**/*.test.ts` (`vitest.config.ts`).

| Suite | Covers |
|-------|--------|
| `test/videoSource.test.ts` (`vid-1`) | The parser's classification and emitted URLs |
| `test/videoPlugin.test.ts` (`vid-2`) | What each classification **emits** — `RENDER_LOADERS["video"]` markup per kind, plus `VideoEditor`'s indicator/warning output |
| `test/videoHeroPlugin.test.ts` (`vid-3`) | The same for `RENDER_LOADERS["videoHero"]`: background element + `src` per kind, the YouTube/Vimeo background parameters named individually, the cover sizer's emitted declarations, `VideoHeroSchema` round-trip (pinning the "schema unchanged" non-scope), and the editor's tabs / indicator / warning / preview |
| `test/reviewsCarousel.test.ts` (`rev-4`) | `RENDER_LOADERS["reviewsCarousel"]` photo markup in a DB scope (lazy `<img>`, `alt`, `<a href>` to the full URL, no `/_next/image`); the **DB-scope gate** — a `manual`/legacy block with an injected `photos` array emits NO thumbnail; and the editor's three `scope` options + conditional `productId` input |
| `renderer/test/unit/locale-1c-blocks-client.test.ts` (`locale-1c`; in the RENDERER suite — this package has no DOM harness and no jsdom dependency) | The block texts of every state of the eleven text-bearing blocks (forms sending/sent/failed, copy, read more, post grid loading/failed/empty/dates, showcase): en-US markup equal to a `0c0dbc8` capture, every Romanian change a declared key, the reviews-carousel date cases, the § 5.2 preservation cases at one reader per block (the iframe names pattern F) |
| `test/hero.test.ts` (`shop-look-1b`) | `RENDER_LOADERS["hero"]`: every case of `test/heroBaselineCases.ts` (four styles × image, rich/legacy subheadline, no button, tokens, Tiptap defaults) renders equal to `test/hero.baseline.json` (HTML recorded at 783e95f; static and streaming renderers) with each new attribute absent, `null`, blank, empty or malformed; each option present → its element, and removing it gives the baseline back; the three § 6.5 inverse cases; schema limits; the editor's controls and `storedOption` |
| `test/showcasePriceRange.test.ts` (`price-locale-1`) | `RENDER_LOADERS["categoryShowcase"]` price line: a given `_priceRange` is printed (`10 – 12.5 RON`); without it the card's reading is today's (`10 – 12 RON` for a comma text, `75 – 100 USD` for point texts); a range with min = max prints the price text |
| `test/sectionBlocks.test.ts` (`shop-look-1d`) | `RENDER_LOADERS["categoryShowcase"]` and `["postGrid"]`: every case of `test/sectionBlocksBaselineCases.ts` renders equal to `test/sectionBlocks.baseline.json` (HTML recorded at 61d965d; static and streaming renderers) with the new attributes absent, `null`, blank, off or malformed, and with the card options on but no product key; each option present → its element, and removing it gives the baseline back; the § 7.4 badge cases (zero / one / several matches, both orders of the block list and of the product's tags, letter case ignored and spaces kept (`badge-case-1`), non-string product tags, blank entries, no tags, catalog); label, short text and rating (HTML escaped, malformed rating); the panel's parts alone and together, a link without a text, phone order; schema and Tiptap defaults; the editors' controls and pure functions; type-only `@amodx/shared` import; no palette colour class |
| `test/categoryGrid.test.ts` (`shop-look-1c`) | `RENDER_LOADERS["categoryGrid"]`: no `_categories` → nothing; 0 / 1 / 12 tiles in the given order (one tile byte for byte); photo and description fallbacks (no element); the scrim around every tile text and no palette colour class; `columns` 2 / 3 / 4 and unknown → the grid class; `ctaText`, eyebrow, headline blank / set; chips none / valid / without label or href; `_getUrl` on tiles and chips; schema defaults and limits (13th id refused); Tiptap defaults = schema defaults; the render imports only `react`; the editor's options and its three list functions |
| `test/formBlock.test.ts` (`shop-look-1e`) | `RENDER_LOADERS["form"]`: no `_form` or a malformed one → nothing; each field type's element, labels in order tied to their controls, required marks, the select's locale placeholder (EN, RO; a field placeholder wins), button text, no success text before a submit; eyebrow / headline / text blank vs set; `card` exactly `true`; owner texts escaped; schema defaults; Tiptap attributes = schema defaults, storage `fetchFormsFn`; registration in both entries (`offeredOn: []`); the editor's controls and `formSlugNote`; no renderer/admin import, type-only `@amodx/shared`; the renderer copy gone; only `text-green-500` as a palette class |
| `test/offeredOn.test.ts` (`cat-admin-2`) | `getPluginList()`'s `offeredOn` per key: `categoryShowcase` and `categoryGrid` both kinds, `reviewsCarousel` commerce, every other block `[]`; the projection's keys (no boolean `commerce`). Imports `src/admin.ts`, so every plugin's admin module loads in `environment: "node"` |
| `test/galleryBlock.test.ts` (`gallery-1`) | `RENDER_LOADERS["gallery"]`: registration and schema defaults; every row of the slice's Evidence taxonomy (absent/empty, thumb + sizes, no thumb, bad `src`, other schemes, no `alt`); the address rule table; no `_gallery` or a malformed one → nothing; Romanian texts; accessible names, 44 px buttons, polite counter; ruling 9 as narrowed: (a) the closed viewer holds no image, (c) 30 tiles with `thumb` load the small files lazily, (d) 30 tiles without `thumb` ARE the large files, lazy only — no page-load guarantee claimed; no motion class; columns; sizes; `fillLocaleTemplate` = `fillTemplate`; `steppedIndex`, `swipeStep`, `withPhotosAdded` |
| `test/renderLoaders.test.ts` (`perf-1`) | The **whole-entry SSR-safety binding**: `await`s every `RENDER_LOADERS` entry in `environment: "node"`, forcing each render module to load, and asserts each resolves to a `{ default: <function component> }`. Catches a module-load `window`/`document` hazard in ANY registered render module (the guarantee eager `RENDER_MAP` gave for free before lazy loaders removed it). Also pins loader count = 24 (20 before `shop-look-1c`, 21 before `shop-look-1e`, 22 before `newsletter-1`, 23 before `gallery-1`), so a new plugin added to the map without its own suite is still covered by this file. Does NOT render the components (no browser-free *render* proof — the per-plugin suites do that). GALLERY-1: no module reachable from `RENDER_LOADERS` imports a runtime value from `@amodx/shared`, by the barrel or any deep path (relative-import walk; a positive control for each measured form) |

`vid-2` widened the scope beyond `src/common/`: `videoPlugin.test.ts` renders real plugin
components through `renderToStaticMarkup` (`react-dom/server`), which is the same code path
the renderer's SSR uses and needs **no DOM, no jsdom, no RTL, and no new dependency** — so the
suite stays in the `environment: "node"` run and stays credential-free. What it cannot reach
is INTERACTION (typing, `onChange`, Tiptap commands); that still needs the DOM/RTL harness of
`docs/testing-strategy.md` §4.

**SSR-safety binding (perf-1 correction).** Before perf-1, `src/render.ts` *eagerly* imported
every render component, so merely importing it in a node environment executed all of them and a
top-level `window` reference anywhere would fail that import. After perf-1 the entry holds only
lazy `import()` thunks: importing `RENDER_LOADERS` executes NONE of the component modules, so it
is NO LONGER a whole-entry SSR smoke test on its own. The per-plugin suites below each `await` and
render only THEIR loader, so each covers only its own module. The whole-entry guarantee now lives
in `test/renderLoaders.test.ts`: it `await`s every `RENDER_LOADERS` entry in `environment: "node"`,
which forces each render module to load. That detects **module-load** SSR hazards (a top-level
`window`/`document` reference in any registered render module) for every loader (24 since `gallery-1`). It does NOT
render each component, so it does not prove browser-free *render execution* — the per-plugin
suites do that for the components they exercise.

`vid-3` follows the same pattern, and adds one caveat worth knowing before writing the next
editor test: `VideoHeroEditor` embeds `InlineRichTextField`, whose Tiptap `useEditor` detects
SSR, logs one notice, and returns `null`. The field therefore renders empty under
`renderToStaticMarkup`. That is expected — the editor is browser-only by construction — but
it means an assertion about rich-text OUTPUT cannot be written in this harness.

Neither suite can reach anything requiring layout. `vid-3`'s cover geometry is asserted as
EMITTED CSS declarations; whether those declarations visually cover a landscape and a
portrait viewport, whether mobile autoplay is permitted by the device, and whether hydration
is visually smooth are MEASUREMENTS and remain the operator's — see
`docs/slices/vid-3-video-hero-block.md` § *Operator visual checklist*.

`include` is pinned to `test/` and must not be widened to `src/`. Tests import `src/`, never
`dist/`, so a stale build cannot read as a passing contract. Runs in CI's
`build-typecheck-unit` job.

## Adding a New Plugin

1. Create `src/blocks/<name>/` with schema.ts, Editor.tsx, Render.tsx, index.ts
2. Implement `PluginDefinition` interface from `src/types.ts`
3. Add to REGISTRY array in `src/admin.ts`
4. Add a lazy loader entry to `RENDER_LOADERS` in `src/render.ts` — a dynamic `import()` thunk
   resolving to `{ default: <Name>Render }`; do NOT eagerly import (perf-1 code-splitting)
5. Add block schema to MCP server's `get_block_schemas` tool if AI should use it
6. Rebuild: `cd packages/plugins && npm run build`

## Hydration prefix fallback (hydration-1)

`CategoryShowcaseRender` uses injected product/category prefixes or fixed defaults in both first renders.
Document meta tags are a browser-only fallback, read in an effect after mount; injected values still win.
The renderer's `test/unit/hydration-1-client.test.ts` covers both hrefs with custom meta tags, with and without
injected prefixes, using `renderToString` then `hydrateRoot` and both React error channels. No new dependency.
