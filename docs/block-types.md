# Block Types Reference

18 custom plugins + 2 Tiptap builtins (`paragraph`, `heading`).

Block type names are **camelCase** and must match exactly in Tiptap JSON.

## Complete Plugin Table

| Key | Label | Key Attributes | Variants |
|-----|-------|---------------|----------|
| `hero` | Hero Section | headline, subheadline, ctaText, ctaLink, imageSrc, style, cover tokens (overlayOpacity, overlayColorToken, headlineColorToken, subheadlineColorToken); optional (absent = not shown, SHOP-LOOK-1B): eyebrow, headlineAccent + headlineAccentColorToken, secondaryCtaText + secondaryCtaLink, stats[] (≤ 4: value, label), buttonShape (rounded / pill), splitPanel (plain / inverse, split only) | center, split, cover, minimal |
| `pricing` | Pricing Table | headline, subheadline, plans[] (title, price, interval, features, buttonText, buttonLink, highlight) | — |
| `image` | Image | src, alt, title, caption, width, aspectRatio | full, wide, centered |
| `contact` | Contact Form | headline, description, buttonText, successMessage, tags | — |
| `video` | Video Embed | url, caption, width, autoplay | centered, wide, full (see § *Video embed support*) |
| `leadMagnet` | Lead Magnet | headline, description, buttonText, resourceId, fileName, tags | — |
| `cta` | Call to Action | headline, subheadline, buttonText, buttonLink, style | simple, card, band |
| `features` | Feature Grid | headline, subheadline, items[] (title, description, icon), columns | 2, 3, 4 columns |
| `testimonials` | Testimonials | headline, subheadline, items[] (quote, author, role, avatar), style | grid, slider, minimal |
| `columns` | Column Layout | columnCount, gap, columns[] (width, content) | 2-4 cols, sm/md/lg gap |
| `table` | Data Table | headers[], rows[] (cells[]), striped, bordered | — |
| `html` | Raw HTML | content, isSandboxed | — |
| `faq` | FAQ Accordion | headline, items[] (question, answer) | Generates FAQPage JSON-LD |
| `postGrid` | Post Grid | headline, filterTag, limit, showImages, layout, columns; optional (absent = not shown, SHOP-LOOK-1D): eyebrow, asideText, asideQuote, asideButtonText + asideButtonLink (a side panel; see § *Post grid side panel*) | grid, list; 2 or 3 cols |
| `carousel` | Carousel | headline, items[] (title, description, image, link, linkText), height, style | standard, coverflow |
| `codeBlock` | Code Block | code, language, filename, showLineNumbers | 19 languages |
| `reviewsCarousel` | Reviews Carousel | headline, scope (manual \| product-reviews-by-id \| site-reviews), productId, items[] (name, avatarUrl, date, rating, text, source), showSource, autoScroll | google, facebook, manual sources. `scope: product-reviews-by-id` (needs `productId`) / `scope: site-reviews` (rev-4) render approved moderated reviews with approved photos — server-prefetched, assetKey→raw asset URL, never next/image |
| `categoryShowcase` | Category Showcase | categoryId, categoryName, categorySlug, limit, columns, showPrice, ctaText; optional (absent = not shown, SHOP-LOOK-1D): eyebrow, badgeTags[] (≤ 10), showCategoryLabel, showDescription, showRating (see § *Category showcase card options*) | 2, 3, 4 columns |
| `categoryGrid` | Category Grid | eyebrow, headline, categoryIds[] (≤ 12, tile order), columns, ctaText (foot text of every tile), chips[] (label, href; ≤ 12), blockWidth (SHOP-LOOK-1C; see § *Category grid*) | 2, 3, 4 columns from large screens; 1 on a phone, 2 from `sm` |
| `form` | Custom Form | formSlug (a form of admin Forms), eyebrow, headline, text, card, blockWidth (SHOP-LOOK-1E; see § *Custom form*) | plain or in a card |

## Category grid (`categoryGrid`, slice `shop-look-1c`)

Tall tiles (`aspect-[3/4]`) of categories the owner picks by id, in the picked order: the category photo, its name, its
description (two lines at most) and, when `ctaText` is set, that text at the foot of every tile. Each tile links to the
category page on the tenant's own category path. Optional eyebrow and headline above; optional pill links (`chips`)
under the grid. Offered in the block inserter on commerce and catalog sites; drawn on any site that stores it.

- The categories are read on the server when the page renders (one `GetCommand` per stored id, at most 12; none
  without ids). A hidden or deleted category is left out; the others keep their order. A stored 13th id (the editor and
  the schema stop at 12; the backend does not check block attributes) is not read and not drawn.
- No photo → no image element (the tile's muted background shows). No description → no description element. Blank
  `ctaText`, eyebrow or headline → no element. A chip without a label or a link → not shown.
- No category resolves → the eyebrow, the headline and the chips only; with none of those either → nothing.
- The tile text is on a scrim of the theme's text colour at 75 % opacity, in the theme's background colour: readable on
  any photo (record `docs/slices/shop-look-1c.md` § *Overlay rule*).
- Without the server pass (the admin editor) the public render draws nothing; the editor shows its own list.

## Custom form (`form`, slice `shop-look-1e`)

One custom form of the tenant (admin **Forms**), chosen in the block editor by its name; the block stores the form's
slug (`formSlug`). The form's fields, button text, success text and notify address are edited on the Forms page, not in
the block. Offered on every site kind.

- The form is read on the server when the page renders (`getFormBySlug`: two keyed `GetCommand`s; none without a slug).
  A slug of no form, a disabled form or a blank slug → the block draws nothing. The page receives display data only
  (name, fields, button text, success text, the four form texts of the tenant's locale table) — never the notify address.
- Each stored field is drawn by its type: `text`, `email`, `phone` (tel), `number` → an input; `textarea`; `select` → a
  list of its `options` with the placeholder (else the locale text `formSelectPlaceholder`); `checkbox` → a tick box
  with its placeholder (else its label). A required field has a mark and must be filled (a required tick box ticked). A
  stored entry that is not a valid field, and a later field with the label of an earlier one, are not drawn.
- Options above the form: `eyebrow` (small label), `headline`, `text` — blank = absent. `card: true` → the form in a
  bordered card. The form is at most `max-w-lg` wide, centred.
- Submit: the browser posts to `POST /public/forms/{slug}/submit` (origin check and reCAPTCHA, as the contact form)
  with `data` keyed by field label. The handler keeps only the form's own fields, cleans each value by type, limits the
  length (text 500, textarea 5 000 characters) and refuses a value that is not of the field's type or not an option of
  the select (record `docs/slices/shop-look-1e.md` § 2). After a good submit the form's success text replaces the form; a
  refusal shows the server's error text, else the locale text `formSubmissionFailed`.
- Submissions are listed on admin **Forms → Submissions**; the notify mail (if the form has an address) lists each field
  label with its value.

## Category showcase card options (`categoryShowcase`, slice `shop-look-1d`)

Each option is optional and off by default; absent, `null`, blank or `false` draws exactly the card of before.

- `eyebrow` — a small label above the category name (every site kind).
- `badgeTags` — the tags that act as badges, in precedence order. A card shows **at most one** badge: the first entry of
  this list that the product's `tags` holds. Exact match — case and spaces count. The order of the product's own tags
  does not matter. Blank entries are ignored. The badge is an opaque pill (`bg-primary` / `text-primary-foreground`) over
  the top-left of the photo, so the photo never affects it. No read: the tags are in the card item.
- `showCategoryLabel` — the name of the product's FIRST category (`categoryIds[0]`) above the title; none when that
  category is hidden or missing. Read: one `getAllCategories` per block.
- `showDescription` — the product's description as plain text (tags removed, never HTML), two lines at most, under
  the title. Read: one `getProductById` per product.
- `showRating` — `★` (the rounded average, hidden from screen readers) and the tenant's `reviewsSummary` text (for
  example "4.5/5 (2 reviews)") of the APPROVED reviews; none without an approved review. Read: one `getProductReviews`
  per product (it pages through every review item of the product).
- On a catalog site the four card options have no effect and read nothing (SL-D10); the eyebrow shows.
- Each read runs only when its option is on, only for the products the server pass read (at most 12 per block), and
  only on an uncached render. The browser fallback fetch (the block without server data) can show the badge only.

## Post grid side panel (`postGrid`, slice `shop-look-1d`)

- `eyebrow` — a small label above the headline.
- `asideText`, `asideQuote`, `asideButtonText` + `asideButtonLink` — a panel left of the posts from `md` (the posts take
  the right two thirds), above them on a phone. It shows when the text, the quote or the button text is not blank. The
  button needs a text; its link goes through the tenant URL helper, and a blank link gives `#`. A link without a text
  draws no button.
- No read. The "no posts", error and loading boxes do not show either option.

## Video embed support

Both video blocks store a **plain string** and share one classifier. Neither has a provider
field, and nothing about the provider is persisted (plan Option A).

### `video` — inline player (slices `vid-1`, `vid-2`)

The `video` block's `url` is a **plain string**; there is no provider field to set. One
parser — `packages/plugins/src/common/videoSource.ts` — classifies it, and both the admin
editor and the public render branch on that single classification (slices `vid-1`, `vid-2`).

| Pasted URL | Classifies as | Public page renders |
|-----------|---------------|---------------------|
| `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID`, `youtube.com/embed/ID` | `youtube` | `<iframe>` on `www.youtube.com/embed/ID`, `loading="lazy"`, `title` |
| `vimeo.com/ID`, `player.vimeo.com/video/ID` | `vimeo` | `<iframe>` on `player.vimeo.com/video/ID`, same attributes |
| any http(s) or relative URL whose **path** ends `.mp4` `.webm` `.mov` `.m4v` `.ogg` (query strings ignored, so presigned S3 URLs work) | `direct` | native `<video controls>` — **not** an iframe |
| anything else, including an empty `url` | `unknown` | **nothing at all** — no element, no empty box |

`autoplay` is honoured on all three renderable kinds. On `direct` it also forces `muted` and
`playsInline`, because browsers block autoplay with sound outright.

Not recognized (deliberate, `docs/TECH-DEBT.md` § *vid-1 residuals*): `youtube.com/live/`,
legacy `youtube.com/v/`, `youtube-nocookie.com`, and Vimeo unlisted-video privacy-hash URLs
(`vimeo.com/ID/HASH`). All four fall to `unknown` and therefore render nothing — a graceful
blank, never a broken embed. The admin editor shows a warning callout for any non-empty
unrecognized URL, so an author who pastes one is told before publishing; the warning does not
block saving.

### `video-hero` (slice `vid-3`)

`video-hero`'s `videoSrc` is on the SAME parser and the same four kinds. What differs is what
each kind renders, because this block is a full-bleed background rather than an inline player:

| Classifies as | Public hero renders |
|---------------|---------------------|
| `youtube` | background `<iframe>`, `?autoplay=1&mute=1&loop=1&playlist=ID&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3` |
| `vimeo` | background `<iframe>`, `?background=1` (Vimeo's own background mode subsumes the whole YouTube set) |
| `direct` | native `<video autoplay playsinline>` with `object-cover` — unchanged behaviour |
| `unknown`, including an empty `videoSrc` | **the poster image**, or no backdrop at all when none is set |

The `unknown` row is the one deliberate difference from the inline `video` block, which
renders nothing: a hero still has to have a backdrop behind its headline and CTA.

Three consequences authors and reviewers should know:

- **`muted` and `loop` are ignored on the embed kinds.** A background embed must be muted or
  no browser will autoplay it, and YouTube only loops via the `playlist={id}` pairing. The
  editor replaces those two checkboxes with a note when the source is an embed, so the UI does
  not offer a control that does nothing.
- **A stored URL the parser does not recognize now shows the poster instead of a dead
  `<video>`.** Before `vid-3` any non-empty `videoSrc` produced a `<video>` element — a pasted
  YouTube link rendered a media element pointed at an HTML page and failed silently. Media
  library uploads are unaffected: the S3 key keeps the original filename, so the extension
  survives and those URLs still classify `direct`.
- **The hero iframe is deliberately NOT `loading="lazy"`** — it is above the fold. The inline
  `video` block is lazy for the opposite reason. Do not copy one to the other.

Both blocks' editors warn on a non-empty unrecognized URL and neither blocks saving.

## Rules

- Array items (plans, items, columns, rows, cells) require UUID `id` fields.
- MCP server `BLOCK_SCHEMAS` constant in `tools/mcp-server/src/index.ts` must stay in sync with this table.
- Schemas are defined in `packages/plugins/src/blocks/<name>/schema.ts` using Zod.
