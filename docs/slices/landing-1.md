# LANDING-1 — a page without the site's header and footer

Status: **PLANNED (draft 2026-11-20, not ratified)**. Track: growth. Depends: none.

## Purpose

An advertising landing page has no menu and no footer links. The page editor has the two switches
(`hideNav`, `hideFooter`: `packages/shared/src/index.ts:390-392`; `admin/src/pages/ContentEditor.tsx:212-213`),
and they are done with a style rule (`renderer/src/components/SitePage.tsx:704-710`):

```
nav, .site-navbar { display: none !important; }      footer, .site-footer { display: none !important; }
```

What is wrong with it:

- The top bar and the commerce bar are plain `<div>` elements (`TopBar.tsx:13`, `CommerceBar.tsx:122`); they
  stay on a "no navigation" page. (INFERRED from the markup; the slice shows it on staging first.)
- The rule hides every `<nav>` and `<footer>` element on the page, also inside the page's own blocks.
- The hidden header and footer are still sent in the HTML, links included.

## Scope

1. One class on the layout's own chrome wrapper per part (top bar, commerce bar, navbar, footer); the page's
   style rule names those classes only. No element selector.
2. `hideNav` hides the top bar, the commerce bar and the navbar. `hideFooter` hides the footer. Labels in the
   editor say exactly that.
3. The cookie banner, the popups and the quick-contact button stay; a third switch is not added until a client
   asks.

Not in scope: leaving the chrome out of the HTML. The layout cannot see the page (the same limit as
LANG1-HTML-LANG in `lang-1.md`); if the `lang-1` spike gives the layout a way to know the page, this follows.

## Evidence taxonomy

Both switches off → page bytes unchanged (serving suite, zero changed captures). `hideNav` → none of the three
bars visible at 1280 px and 390 px; a `<nav>` inside a block stays visible. `hideFooter` → the site footer
hidden; a `<footer>` inside a block stays visible.

## Exit criterion

A staging landing page shows only its own blocks, on desktop and on a phone.
