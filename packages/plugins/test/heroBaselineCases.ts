/**
 * SHOP-LOOK-1B: the hero inputs whose HTML was recorded BEFORE the slice changed the render (`hero.baseline.json`,
 * rendered from `HeroRender.tsx` at 783e95f with `renderToStaticMarkup` and an en-US tenant's `blockStrings`).
 * `hero.test.ts` renders each case with the current code — alone, and with every new attribute absent, `null` or blank
 * — and asserts the HTML equals the recorded one (design `docs/slices/shop-look-1.md` § 4: absent = today's bytes).
 * Every style is covered with and without an image, with rich and legacy subheadlines, without a button text, with
 * the cover tokens, and with only the attributes Tiptap writes by default.
 */
const STYLES = ["center", "split", "cover", "minimal"] as const;

/** The plugin schema defaults (`HeroSchema`), as a block inserted by the admin and saved stores them. */
const SCHEMA_DEFAULTS = {
    headline: "Welcome to AMODX",
    subheadline: "The operating system for modern agencies.",
    ctaText: "Get Started",
    ctaLink: "/contact",
    overlayOpacity: 0.5,
    overlayColorToken: "auto",
    headlineColorToken: "auto",
    subheadlineColorToken: "auto",
    blockWidth: "content",
};

/** The Tiptap attribute defaults (`hero/index.ts`), as the editor writes them for a new block. */
const TIPTAP_DEFAULTS = {
    headline: "Welcome",
    subheadline: "",
    subheadlineRich: null,
    ctaText: "Get Started",
    ctaLink: "#",
    overlayOpacity: 0.5,
    overlayColorToken: "auto",
    headlineColorToken: "auto",
    subheadlineColorToken: "auto",
    imageSrc: null,
    blockWidth: "content",
    effect: null,
    buttonEffect: null,
    glow: null,
};

const perStyle = (style: (typeof STYLES)[number]): Record<string, Record<string, unknown>> => ({
    [`${style}-schema-defaults`]: { ...SCHEMA_DEFAULTS, style },
    [`${style}-tiptap-defaults`]: { ...TIPTAP_DEFAULTS, style },
    [`${style}-style-only`]: { style },
    [`${style}-image`]: { ...SCHEMA_DEFAULTS, style, imageSrc: "https://cdn.example.test/hero.jpg", headline: "Floors & more <b>" },
    [`${style}-rich`]: { ...SCHEMA_DEFAULTS, style, subheadlineRich: [{ text: "Bold", bold: true }, { br: true }, { text: "plain" }] },
    [`${style}-legacy-br`]: { ...SCHEMA_DEFAULTS, style, subheadline: "line one<br>line two\nline three" },
    [`${style}-no-button`]: { ...SCHEMA_DEFAULTS, style, ctaText: "" },
    [`${style}-no-subheadline`]: { ...SCHEMA_DEFAULTS, style, subheadline: "" },
    [`${style}-tokens`]: { ...SCHEMA_DEFAULTS, style, overlayColorToken: "primary", overlayOpacity: 0.3, headlineColorToken: "primary", subheadlineColorToken: "muted-foreground", imageSrc: "/a.jpg" },
});

export const HERO_BASELINE_CASES: Record<string, Record<string, unknown>> = Object.assign(
    { "no-style": { ...SCHEMA_DEFAULTS }, "unknown-style": { ...SCHEMA_DEFAULTS, style: "bogus" }, "cover-unknown-token": { ...SCHEMA_DEFAULTS, style: "cover", headlineColorToken: "nope" } },
    ...STYLES.map(perStyle),
);
