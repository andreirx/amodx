# SEO-EXTRACT-MD: SEO auto-extraction reads markdown blocks

- **Status:** PLANNED
- **Evidence:** TECH-DEBT 2026-08-16: extractText/findImage (admin ContentEditor)
  walk only rich-text nodes; markdown blocks (text in attrs) yield EMPTY
  seoDescription/featuredImage → no meta description, no grid excerpt.

## Scope

1. extractText: include markdown-block content — strip markdown syntax (headings
   markers, links→text, emphasis, code fences), take the first ~160 chars, in
   DOCUMENT ORDER (a leading md block contributes first, before later paragraphs).
2. findImage: markdown image refs (![alt](src)) count, document order.
3. Applies wherever the same extraction pattern exists (ContentEditor; check
   Product/Category editors for the same helper — dedupe into ONE shared helper if
   2+ consumers, per earned-abstraction).
4. Unit tests: md-only page, md+richtext mix (order preserved), md image found,
   160-char bound, syntax stripped.

## Non-scope

No backend changes (extraction is admin-side, stored on save); no re-extraction of
existing pages (user edits refresh naturally); no renderer changes.

## DoD

Admin build + typecheck + unit green; the exact bug case (one big markdown block →
non-empty description + image) pinned by test.
