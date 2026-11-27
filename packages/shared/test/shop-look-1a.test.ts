import { describe, it, expect } from "vitest";
import { HeaderConfigSchema, FooterConfigSchema, TenantConfigSchema, SiteStringsSchema, EN_LANGUAGE_PACK, RO_LANGUAGE_PACK } from "../src/index.js";

/**
 * SHOP-LOOK-1A (docs/slices/shop-look-1a.md; design docs/slices/shop-look-1.md § 4.1, § 5) — the four new settings and the
 * one new site key. Every new field is `.optional()` with no default: absent stays absent, so no value is written into
 * stored data and an old stored `header` / `footer` reads unchanged. PUT /settings applies these rules
 * (backend/test/unit/shop-look-1a-settings.test.ts). Pure.
 */

const MINIMAL_TENANT = { id: "t", domain: "t.test", name: "T", plan: "Free", createdAt: "2026-01-01T00:00:00.000Z" } as const;
const OLD_HEADER = { showLogo: true, showTitle: false, navHeight: "h-20", navHeightScrolled: "h-12", logoHeight: "h-12", logoHeightScrolled: "h-8", titleSize: "text-xl", titleSizeScrolled: "text-lg", contentMaxWidth: "max-w-7xl", contentPageMaxWidth: "max-w-4xl", backgroundColor: "#f5f1ea" };
const OLD_FOOTER = { contentMaxWidth: "max-w-screen-2xl", backgroundColor: "#111111", textColor: "#eeeeee" };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `cat-${i + 1}`);
const column = (heading: string, n = 1) => ({ heading, links: Array.from({ length: n }, (_, i) => ({ label: `L${i}`, href: `/l${i}` })) });

describe("header.tagline and header.categoryBarIds (§ 4.1)", () => {
    it("absent stays absent: no default is written", () => {
        const parsed = HeaderConfigSchema.parse({});
        expect(Object.hasOwn(parsed, "tagline")).toBe(false);
        expect(Object.hasOwn(parsed, "categoryBarIds")).toBe(false);
        const tenant = TenantConfigSchema.parse(MINIMAL_TENANT);
        expect(Object.hasOwn(tenant.header, "tagline")).toBe(false);
        expect(Object.hasOwn(tenant.header, "categoryBarIds")).toBe(false);
    });
    it("an old stored header (no new key) reads unchanged", () => {
        expect(HeaderConfigSchema.parse(OLD_HEADER)).toEqual(OLD_HEADER);
    });
    it("tagline: up to 60 characters accepted (whitespace only is valid: the renderer draws it as absent); 61 refused, naming the field", () => {
        for (const ok of ["SINCE 1998", "x".repeat(60), "   ", ""]) expect(HeaderConfigSchema.safeParse({ tagline: ok }).success, JSON.stringify(ok)).toBe(true);
        for (const bad of ["x".repeat(61), 5, null]) {
            const r = HeaderConfigSchema.safeParse({ tagline: bad });
            expect(r.success, JSON.stringify(bad)).toBe(false);
            if (!r.success) expect(r.error.issues[0].path).toEqual(["tagline"]);
        }
    });
    it("categoryBarIds: 0, 1 and 12 ids accepted; 13 ids, an empty id, a non-string id or a non-array refused, naming the field", () => {
        for (const ok of [[], ids(1), ids(12)]) expect(HeaderConfigSchema.safeParse({ categoryBarIds: ok }).success, String(ok.length)).toBe(true);
        for (const bad of [ids(13), ["a", ""], ["a", 3], "cat-1", { 0: "cat-1" }, null]) {
            const r = HeaderConfigSchema.safeParse({ categoryBarIds: bad });
            expect(r.success, JSON.stringify(bad)).toBe(false);
            if (!r.success) expect(r.error.issues[0].path[0]).toBe("categoryBarIds");
        }
    });
});

describe("footer.brandText and footer.columns (§ 4.1)", () => {
    it("absent stays absent; an old stored footer (no new key) reads unchanged", () => {
        const parsed = FooterConfigSchema.parse({});
        expect(Object.hasOwn(parsed, "brandText")).toBe(false);
        expect(Object.hasOwn(parsed, "columns")).toBe(false);
        expect(FooterConfigSchema.parse(OLD_FOOTER)).toEqual(OLD_FOOTER);
        expect(Object.hasOwn(TenantConfigSchema.parse(MINIMAL_TENANT), "footer")).toBe(false);
    });
    it("brandText: up to 400 characters accepted; 401 refused", () => {
        expect(FooterConfigSchema.safeParse({ brandText: "x".repeat(400) }).success).toBe(true);
        const r = FooterConfigSchema.safeParse({ brandText: "x".repeat(401) });
        expect(r.success).toBe(false);
        if (!r.success) expect(r.error.issues[0].path).toEqual(["brandText"]);
    });
    it("columns: 0 to 4 columns of 0 to 12 links accepted (an empty list is valid: the renderer draws it as absent)", () => {
        for (const ok of [[], [column("Explore")], [column("A", 12), column("B"), column("C", 0), column("D")]]) {
            expect(FooterConfigSchema.safeParse({ columns: ok }).success, JSON.stringify(ok).slice(0, 60)).toBe(true);
        }
    });
    it("columns refused: over 4 columns, over 12 links, an empty heading, a heading over 40, an empty label or href, an unknown key in a column or a link", () => {
        const bad: [string, unknown][] = [
            ["5 columns", [column("A"), column("B"), column("C"), column("D"), column("E")]],
            ["13 links", [column("A", 13)]],
            ["empty heading", [column("")]],
            ["41-character heading", [column("x".repeat(41))]],
            ["empty label", [{ heading: "A", links: [{ label: "", href: "/a" }] }]],
            ["61-character label", [{ heading: "A", links: [{ label: "x".repeat(61), href: "/a" }] }]],
            ["empty href", [{ heading: "A", links: [{ label: "a", href: "" }] }]],
            ["unknown column key", [{ ...column("A"), colour: "red" }]],
            ["unknown link key", [{ heading: "A", links: [{ label: "a", href: "/a", target: "_blank" }] }]],
            ["no links key", [{ heading: "A" }]],
            ["not an array", column("A")],
        ];
        for (const [name, value] of bad) {
            const r = FooterConfigSchema.safeParse({ columns: value });
            expect(r.success, name).toBe(false);
            if (!r.success) expect(r.error.issues[0].path[0], name).toBe("columns");
        }
    });
    it("the footer stays strict: an unknown footer key is refused", () => {
        expect(FooterConfigSchema.safeParse({ brandText: "x", tagline: "y" }).success).toBe(false);
    });
});

describe("site key navCategoryBarLabel (§ 5)", () => {
    it("directly follows the 26 block keys (appended after every older key; NEWSLETTER-1 appends its keys after it); EN Categories, RO Categorii", () => {
        const keys = Object.keys(SiteStringsSchema.shape);
        expect(keys.indexOf("navCategoryBarLabel")).toBe(keys.indexOf("postsLoadFailed") + 1);
        expect(keys.indexOf("navCategoryBarLabel")).toBe(78);
        expect(EN_LANGUAGE_PACK.site.navCategoryBarLabel).toBe("Categories");
        expect(RO_LANGUAGE_PACK.site.navCategoryBarLabel).toBe("Categorii");
    });
});
