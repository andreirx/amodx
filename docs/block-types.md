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
| `video` | Video Embed | url, caption, width, autoplay | centered, wide, full |
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

## Rules

- Array items (plans, items, columns, rows, cells) require UUID `id` fields.
- MCP server `BLOCK_SCHEMAS` constant in `tools/mcp-server/src/index.ts` must stay in sync with this table.
- Schemas are defined in `packages/plugins/src/blocks/<name>/schema.ts` using Zod.
