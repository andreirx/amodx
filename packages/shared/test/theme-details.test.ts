import { describe, it, expect } from "vitest";
import { ThemeSchema, TenantConfigSchema, ContentItemSchema, CssColorSchema, isCssColor } from "../src/index.js";

/**
 * CAT-THEME-1 (docs/slices/cat-theme-1.md § 3; record docs/slices/cat-theme-1-impl.md) — the new theme fields and the
 * footer width. What the schema accepts and refuses; PUT /settings applies the same schema to the new fields
 * (backend/test/unit/cat-theme-settings.test.ts). Pure.
 */

const MINIMAL_TENANT = { id: "t", domain: "t.test", name: "T", plan: "Free", createdAt: "2026-01-01T00:00:00.000Z" } as const;
const ALL_SET = {
    fontNav: "Inter", fontWeights: [300, 500], headingWeight: 300, mutedColor: "#6b6b6b", borderColor: "rgb(212, 212, 212)",
    shape: "editorial", cardImage: "landscape", cardCategoryLine: true,
} as const;

describe("ThemeSchema — the CAT-THEME-1 fields", () => {
    it("every new field is optional and has no default: a stored theme without them parses without them", () => {
        const parsed = ThemeSchema.parse({});
        for (const key of Object.keys(ALL_SET)) expect(Object.hasOwn(parsed, key), key).toBe(false);
        const tenant = TenantConfigSchema.parse(MINIMAL_TENANT);
        for (const key of Object.keys(ALL_SET)) expect(Object.hasOwn(tenant.theme, key), key).toBe(false);
        expect(tenant.footer).toBeUndefined();
    });

    it("accepts every field set", () => {
        expect(ThemeSchema.parse(ALL_SET)).toMatchObject(ALL_SET);
    });

    it("a weight is an integer from 100 to 900 (each list entry and the heading weight)", () => {
        for (const ok of [100, 400, 650, 900]) {
            expect(ThemeSchema.safeParse({ headingWeight: ok }).success, String(ok)).toBe(true);
            expect(ThemeSchema.safeParse({ fontWeights: [ok] }).success, String(ok)).toBe(true);
        }
        for (const bad of [0, 99, 901, 1000, 350.5, "300"]) {
            expect(ThemeSchema.safeParse({ headingWeight: bad }).success, JSON.stringify(bad)).toBe(false);
            expect(ThemeSchema.safeParse({ fontWeights: [400, bad] }).success, JSON.stringify(bad)).toBe(false);
        }
        expect(ThemeSchema.safeParse({ fontWeights: 300 }).success).toBe(false);
    });

    it("the two colours follow the one colour rule; shape and card image are closed sets; the category line is a boolean", () => {
        for (const bad of ["", "#12", "red;}", "url(x)", "var(--x)", "rgb(1,2)"]) {
            expect(ThemeSchema.safeParse({ mutedColor: bad }).success, JSON.stringify(bad)).toBe(false);
            expect(ThemeSchema.safeParse({ borderColor: bad }).success, JSON.stringify(bad)).toBe(false);
        }
        expect(ThemeSchema.safeParse({ shape: "brutalist" }).success).toBe(false);
        expect(ThemeSchema.safeParse({ shape: "default" }).success).toBe(true);
        expect(ThemeSchema.safeParse({ cardImage: "portrait" }).success).toBe(false);
        expect(ThemeSchema.safeParse({ cardCategoryLine: "yes" }).success).toBe(false);
    });

    it("a page themeOverride (ThemeSchema.partial()) takes the new fields with the same rules", () => {
        const item = { id: "c", nodeId: "n", version: 1, title: "T", author: "a", createdAt: "2026-01-01T00:00:00.000Z" };
        expect(ContentItemSchema.safeParse({ ...item, themeOverride: { shape: "editorial" } }).success).toBe(true);
        expect(ContentItemSchema.safeParse({ ...item, themeOverride: { headingWeight: 50 } }).success).toBe(false);
    });
});

describe("isCssColor / CssColorSchema — the colour grammar of the new fields (review-0 R-CT-2)", () => {
    it("accepts hex 3/4/6/8, rgb/rgba and hsl/hsla with the right arity and ranges, and the short name list (any case)", () => {
        for (const ok of ["#fff", "#ffff", "#64748b", "#64748bcc", "rgb(1, 2, 3)", "rgb(255,255,255)", "rgba(1,2,3,0.5)", "rgba(1, 2, 3, .5)", "rgba(1,2,3,1)",
            "rgba(1,2,3,1.0)", "rgba(1,2,3,0)", "hsl(210, 40%, 50%)", "hsl(360,100%,0%)", "hsla(210,40%,50.5%,0.2)", "Navy", "transparent"]) {
            expect(isCssColor(ok), ok).toBe(true);
            expect(CssColorSchema.safeParse(ok).success, ok).toBe(true);
        }
    });
    it("refuses the review's counterexamples: 5 and 7 hex digits, a non-number alpha", () => {
        for (const bad of ["#12345", "#1234567", "rgba(1,2,3,...)"]) expect(isCssColor(bad), bad).toBe(false);
    });
    it("refuses a wrong arity, out-of-range values, a bad alpha, other syntaxes, and anything that could close the style rule", () => {
        for (const bad of [undefined, null, 1, "", "#ggg", "#12", "#1234567890", "rgb(1,2)", "rgb(1,2,3,0.5)", "rgba(1,2,3)", "rgba(1,2,3,4,5)",
            "rgb(256,0,0)", "rgb(1.5,2,3)", "rgb(-1,2,3)", "rgba(1,2,3,1.5)", "rgba(1,2,3,2)", "rgba(1,2,3,.)", "hsl(361,50%,50%)", "hsl(10,101%,50%)",
            "hsl(10,50,50)", "hsla(10,50%,50%)", "RGB(1,2,3)", "rgb(1 2 3)", "red;", "red}", "rgb(1,2,3);x", "rgb(1,2,3)}", "papayawhip", "currentColor", "var(--x)"]) {
            expect(isCssColor(bad), JSON.stringify(bad)).toBe(false);
        }
    });
});

describe("TenantConfig.footer — the footer width (§ 3 item 3)", () => {
    it("absent on an existing tenant; a width class when set; unknown keys refused", () => {
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, footer: { contentMaxWidth: "max-w-[1440px]" } }).success).toBe(true);
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, footer: {} }).success).toBe(true);
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, footer: { contentMaxWidth: 1440 } }).success).toBe(false);
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, footer: { width: "max-w-7xl" } }).success).toBe(false);
    });
});
