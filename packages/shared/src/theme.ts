// Theme: the colour grammar (isCssColor), ThemeSchema, saved themes and THEME_PRESETS.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

/**
 * CAT-THEME-1 (review-0 R-CT-2) — the colour GRAMMAR of the new theme colours (`mutedColor`, `borderColor`), checked by
 * PUT /settings through `CssColorSchema`:
 *   - `#` + 3, 4, 6 or 8 hex digits;
 *   - `rgb(r, g, b)` / `rgba(r, g, b, a)`: exactly 3 / 4 comma-separated components, r g b integers 0–255;
 *   - `hsl(h, s%, l%)` / `hsla(h, s%, l%, a)`: exactly 3 / 4, h an integer 0–360, s l percentages 0–100;
 *   - a (alpha): 0–1 written `0`, `1`, `0.5`, `.5`, `1.0`;
 *   - one of a short list of colour names (case-insensitive).
 * Lower-case function names only. Every accepted value also passes the renderer's older injection-safety filter
 * (`renderer/src/lib/sanitize.ts` `sanitizeCssColor`, which still guards the legacy colour fields), so a stored value
 * renders as stored. Not the full CSS Color grammar (no space syntax, `color()`, all 148 names): the narrower set is
 * what this route accepts.
 */
const SAFE_COLOR_NAMES = [
    "black", "white", "red", "green", "blue", "yellow", "cyan", "magenta",
    "gray", "grey", "silver", "maroon", "olive", "lime", "aqua", "teal",
    "navy", "fuchsia", "purple", "orange", "pink", "brown", "transparent",
];
const ALPHA = /^(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+)$/;
const inRange = (text: string, form: RegExp, max: number) => form.test(text) && Number.parseFloat(text) <= max;
export function isCssColor(color: unknown): color is string {
    if (typeof color !== "string") return false;
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) return true;
    if (SAFE_COLOR_NAMES.includes(color.toLowerCase())) return true;
    const call = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(color);
    if (!call) return false;
    const [fn, args] = [call[1], call[2].split(",").map((a) => a.trim())];
    if (args.length !== (fn.endsWith("a") ? 4 : 3)) return false;
    if (fn.endsWith("a") && !ALPHA.test(args[3])) return false;
    if (fn.startsWith("rgb")) return args.slice(0, 3).every((c) => inRange(c, /^\d{1,3}$/, 255));
    return inRange(args[0], /^\d{1,3}$/, 360) && args.slice(1, 3).every((c) => inRange(c, /^\d{1,3}(?:\.\d+)?%$/, 100));
}
export const CssColorSchema = z.string().refine(isCssColor, { message: "must be a CSS colour: #hex, rgb(), rgba(), hsl(), hsla() or a basic colour name" });
/** CAT-THEME-1 — a CSS font weight: an integer from 100 to 900. */
export const FontWeightSchema = z.number().int().min(100).max(900);

// Expanded Theme Config
export const ThemeSchema = z.object({
    mode: z.enum(["light", "dark"]).default("light"),

    // Colors
    primaryColor: z.string().default("#000000"),
    primaryForeground: z.string().default("#ffffff"),

    secondaryColor: z.string().default("#ffffff"),
    secondaryForeground: z.string().default("#000000"),

    // backgrounds
    backgroundColor: z.string().default("#ffffff"),
    surfaceColor: z.string().default("#f4f4f5"), // Cards/Sidebars

    // Global Text
    textColor: z.string().default("#020817"),

    // Typography (We will load these from Google Fonts in the Renderer)
    fontHeading: z.string().default("Prata"),
    fontBody: z.string().default("Lato"),

    // UI Roundness
    radius: z.string().default("0.5rem"),

    // CAT-THEME-1 (docs/slices/cat-theme-1.md § 3; record docs/slices/cat-theme-1-impl.md). Every field is optional and
    // has NO default: absent = today's rendering, byte for byte. Read by the renderer's ThemeInjector, layout, Navbar,
    // CommerceBar and SitePage; validated on PUT /settings (backend tenant/settings.ts `themeAttributesError`).
    // A third Google Font for the nav links; absent → the nav keeps today's font (record § 6, CT-IMPL-NAV-DEFAULT).
    fontNav: z.string().optional(),
    // Weights requested IN ADDITION to 400 and 700 for every theme font (CT-D2 = B): the loader asks 400;700 ∪ this list.
    fontWeights: z.array(FontWeightSchema).optional(),
    // The heading weight (h1–h6); absent → no rule (the headings keep their classes' weights).
    headingWeight: FontWeightSchema.optional(),
    // Muted text and hairline (border and input border) colours; absent → the injector's constants #64748b / #e2e8f0.
    mutedColor: CssColorSchema.optional(),
    borderColor: CssColorSchema.optional(),
    // The shape preset (CT-D1 = A): "editorial" = the design's details together; absent or "default" = today.
    shape: z.enum(["default", "editorial"]).optional(),
    // Product card: image shape (absent → square) and the first category's name under the title (absent → off).
    cardImage: z.enum(["square", "landscape"]).optional(),
    cardCategoryLine: z.boolean().optional(),
});

// Saved Theme Entity (Agency-wide assets)
export const SavedThemeSchema = z.object({
    id: z.string(),
    name: z.string(),
    theme: ThemeSchema, // The actual style values
    createdBy: z.string(),
    createdAt: z.string()
});

export type SavedTheme = z.infer<typeof SavedThemeSchema>;

type Theme = z.infer<typeof ThemeSchema>;

// CAT-THEME-1: a preset sets only the colour, font and radius fields (all strings); the slice's detail fields (a number
// list, numbers, a boolean) are never part of a preset. The narrower type keeps that true and lets the admin pages
// merge a preset into their string-valued theme state (ContentEditor.tsx `themeOverride: Record<string, string>`).
type ThemePreset = Partial<Omit<Theme, "fontNav" | "fontWeights" | "headingWeight" | "mutedColor" | "borderColor" | "shape" | "cardImage" | "cardCategoryLine">>;

export const THEME_PRESETS: Record<string, ThemePreset> = {
    "standard": {
        primaryColor: "#000000",
        primaryForeground: "#ffffff",
        backgroundColor: "#ffffff",
        textColor: "#020817",
        surfaceColor: "#f4f4f5",
        fontHeading: "Inter",
        fontBody: "Inter",
        radius: "0.5rem"
    },
    "midnight": {
        primaryColor: "#6366f1", // Indigo 500
        primaryForeground: "#ffffff",
        backgroundColor: "#09090b", // Zinc 950
        textColor: "#fafafa", // Zinc 50
        surfaceColor: "#18181b", // Zinc 900
        secondaryColor: "#27272a", // Zinc 800
        secondaryForeground: "#fafafa",
        fontHeading: "Plus Jakarta Sans",
        fontBody: "Inter",
        radius: "0.75rem"
    },
    "editorial": {
        primaryColor: "#1c1917", // Stone 900
        primaryForeground: "#fafaf9",
        backgroundColor: "#fefce8", // Yellow 50 (Cream)
        textColor: "#1c1917",
        surfaceColor: "#f5f5f4", // Stone 100
        fontHeading: "Playfair Display",
        fontBody: "Lora",
        radius: "0rem"
    },
    "corporate": {
        primaryColor: "#0f172a", // Slate 900
        primaryForeground: "#f8fafc",
        backgroundColor: "#ffffff",
        textColor: "#334155", // Slate 700
        surfaceColor: "#f1f5f9", // Slate 100
        secondaryColor: "#e2e8f0",
        secondaryForeground: "#0f172a",
        fontHeading: "Lato",
        fontBody: "Lato",
        radius: "0.3rem"
    },
    "vibrant": {
        primaryColor: "#db2777", // Pink 600
        primaryForeground: "#ffffff",
        backgroundColor: "#ffffff",
        textColor: "#1f2937",
        surfaceColor: "#f3f4f6",
        fontHeading: "Poppins",
        fontBody: "Open Sans",
        radius: "1rem"
    }
};
