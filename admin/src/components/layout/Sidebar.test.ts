import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

/**
 * LOCALE-1A — the Labels page is reachable by EVERY tenant, from the System section (docs/slices/locale-1.md § 7.1;
 * review-0 R3). The real Sidebar, rendered with react-dom/server in the admin's node test environment (no DOM); only
 * the tenant context and the Amplify sign-out are replaced. No production seam was added for this test.
 */

const tenant = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ tenants: tenant.current ? [tenant.current] : [], currentTenant: tenant.current, selectTenant: () => {}, refreshTenants: async () => {} }),
}));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn() }));

import { Sidebar } from "./Sidebar";

/** The nav as `{ section: [item names] }`, read from the rendered markup (section heading, then its items). */
function sections(html: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    let current = "";
    // An item renders as <a href><button><svg …></svg>Name</button></a> (Link > Button > icon + name).
    const re = /<p class="text-\[11px\][^"]*">([^<]+)<\/p>|<a [^>]*href="([^"]*)"[^>]*><button[^>]*>[\s\S]*?<\/svg>([^<]+)<\/button><\/a>/g;
    for (const m of html.matchAll(re)) {
        if (m[1]) { current = m[1]; out[current] = []; } else if (current) out[current].push(m[3].trim());
    }
    return out;
}
const render = (t: Record<string, unknown>) => {
    tenant.current = t;
    return sections(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Sidebar))));
};

describe("Sidebar — Labels for every tenant (§ 7.1)", () => {
    for (const [kind, t] of [
        ["content tenant", { id: "t1", name: "Content", commerceEnabled: false }],
        ["commerce tenant", { id: "t2", name: "Shop", commerceEnabled: true }],
        ["catalog tenant", { id: "t3", name: "Catalog", commerceEnabled: false, catalogMode: true }],
    ] as const) {
        it(`${kind}: Labels is listed once, in System, and not in Commerce`, () => {
            const nav = render(t);
            expect(nav.System).toContain("Labels");
            expect(nav.Commerce ?? []).not.toContain("Labels");
            expect(Object.values(nav).flat().filter((n) => n === "Labels")).toHaveLength(1);
        });
    }

    it("the commerce-only entries still depend on commerceEnabled (unchanged)", () => {
        expect(render({ id: "t1", commerceEnabled: false }).Commerce).not.toContain("Orders");
        expect(render({ id: "t2", commerceEnabled: true }).Commerce).toContain("Orders");
    });
});
