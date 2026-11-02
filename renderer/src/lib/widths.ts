/**
 * CAT-THEME-1 (docs/slices/cat-theme-1.md § 3 item 3; the human's width ruling of 2026-11-01) — the three wide content
 * widths a tenant may choose, separately, for the header (`header.contentMaxWidth`: Top Bar, Commerce Bar, Navbar),
 * the pages (`header.contentPageMaxWidth`) and the footer (`footer.contentMaxWidth`).
 *
 * Why this file exists: the renderer's stylesheet is built by Tailwind 4 from the class names it finds written in the
 * sources (`app/globals.css` `@import "tailwindcss"`). A width setting is a plain string at run time, so a class that no
 * source names is never compiled and the setting would have no effect. Writing the three names here makes Tailwind
 * compile them. No code reads this list at run time: the layout and pages use the stored class string as they did
 * before (record docs/slices/cat-theme-1-impl.md § 4, deviation D-2). Each is a `max-w-*` used with `mx-auto`, so it
 * shrinks to the viewport on narrow screens like every other width.
 */
export const WIDTH_CLASSES = ["max-w-[1440px]", "max-w-[1600px]", "max-w-[1920px]"] as const;
