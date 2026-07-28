# Block Types Reference

18 custom plugins + 2 Tiptap builtins (`paragraph`, `heading`).

Block type names are **camelCase** and must match exactly in Tiptap JSON.

## Complete Plugin Table

| Key | Label | Key Attributes | Variants |
|-----|-------|---------------|----------|
| `hero` | Hero Section | headline, subheadline, ctaText, ctaLink, imageSrc, style | center, split, minimal |
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
| `postGrid` | Post Grid | headline, filterTag, limit, showImages, layout, columns | grid, list; 2 or 3 cols |
| `carousel` | Carousel | headline, items[] (title, description, image, link, linkText), height, style | standard, coverflow |
| `codeBlock` | Code Block | code, language, filename, showLineNumbers | 19 languages |
| `reviewsCarousel` | Reviews Carousel | headline, items[] (name, avatarUrl, date, rating, text, source), showSource, autoScroll | google, facebook, manual sources |
| `categoryShowcase` | Category Showcase | categoryId, categoryName, categorySlug, limit, columns, showPrice, ctaText | 2, 3, 4 columns |

## Video embed support

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

`video-hero` (`videoSrc`) is NOT yet on this parser — it remains native-`<video>`-only until
slice `vid-3`.

## Rules

- Array items (plans, items, columns, rows, cells) require UUID `id` fields.
- MCP server `BLOCK_SCHEMAS` constant in `tools/mcp-server/src/index.ts` must stay in sync with this table.
- Schemas are defined in `packages/plugins/src/blocks/<name>/schema.ts` using Zod.
