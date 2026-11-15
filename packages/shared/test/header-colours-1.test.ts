import { describe, it, expect } from "vitest";
import { HeaderConfigSchema, TenantConfigSchema } from "../src/index.js";

/**
 * HEADER-COLOURS-1 (docs/slices/header-colours-1.md) — `header.backgroundColor` / `header.textColor`: the same type and
 * the same colour rule as the footer's colours (`CssColorSchema`, test/theme-details.test.ts). PUT /settings applies this
 * rule to the two keys (backend/test/unit/cat-theme-settings.test.ts). Pure.
 */

const MINIMAL_TENANT = { id: "t", domain: "t.test", name: "T", plan: "Free", createdAt: "2026-01-01T00:00:00.000Z" } as const;
const BAD = ["", "#12", "red; x:y", "red;}", "url(x)", "url(https://x.test/a.png)", "var(--x)", "rgb(1,2)", 0];

describe("TenantConfig.header — the header colours (HEADER-COLOURS-1 rule 1)", () => {
    it("both optional with no default: absent stays absent (the header keeps the theme's colours)", () => {
        const parsed = HeaderConfigSchema.parse({});
        expect(Object.hasOwn(parsed, "backgroundColor")).toBe(false);
        expect(Object.hasOwn(parsed, "textColor")).toBe(false);
        const tenant = TenantConfigSchema.parse(MINIMAL_TENANT);
        expect(Object.hasOwn(tenant.header, "backgroundColor")).toBe(false);
        expect(Object.hasOwn(tenant.header, "textColor")).toBe(false);
    });
    it("each takes a CSS colour of the one colour rule, alone or together", () => {
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, header: { backgroundColor: "#f5f1ea", textColor: "rgb(31, 41, 55)" } }).success).toBe(true);
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, header: { backgroundColor: "navy" } }).success).toBe(true);
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, header: { navHeight: "h-20", textColor: "#fff" } }).success).toBe(true);
    });
    it("a value outside the colour rule is refused, naming the field", () => {
        for (const bad of BAD) {
            for (const key of ["backgroundColor", "textColor"] as const) {
                const r = HeaderConfigSchema.safeParse({ [key]: bad });
                expect(r.success, `${key} ${JSON.stringify(bad)}`).toBe(false);
                if (!r.success) expect(r.error.issues[0].path).toEqual([key]);
            }
        }
    });
});
