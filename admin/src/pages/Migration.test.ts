import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * CAT-ADMIN-1 (docs/slices/cat-admin-1.md § 4.6) — the WP Migration page per site kind. The real page, rendered with
 * react-dom/server in the admin's node test environment (no DOM); only the tenant context and Amplify are replaced.
 * The rendered state is the first render: no media count yet (the effect that reads `/assets` does not run).
 *
 * Non-catalog: the markup must equal the capture taken from 3912c5d (before this slice) — the files under
 * `__markup__/` were written by the first run of this test on the unchanged tree; a later difference fails the run.
 */

const tenant = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ tenants: tenant.current ? [tenant.current] : [], currentTenant: tenant.current, selectTenant: () => {}, refreshTenants: async () => {} }),
}));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));

import MigrationPage from "./Migration";

const render = (t: Record<string, unknown>) => {
    tenant.current = t;
    return renderToStaticMarkup(createElement(MigrationPage));
};

/** The step headings, in page order (an `<h3 class="font-semibold">`, text before any nested element). */
const steps = (html: string) => [...html.matchAll(/<h3 class="font-semibold">([^<]+)/g)].map((m) => m[1].trim());

describe("WP Migration — a non-catalog site renders byte-equal to 3912c5d (rule 2)", () => {
    it("content site", async () => {
        await expect(render({ id: "t1", name: "Content", commerceEnabled: false })).toMatchFileSnapshot("./__markup__/migration.content.html");
    });
    it("commerce site", async () => {
        await expect(render({ id: "t2", name: "Shop", commerceEnabled: true })).toMatchFileSnapshot("./__markup__/migration.commerce.html");
    });
});

describe("WP Migration — a catalog site (§ 4.6)", () => {
    const html = () => render({ id: "t3", name: "Catalog", commerceEnabled: false, catalogMode: true });
    it("two steps, Media then Pages; no products step", () => {
        expect(steps(html())).toEqual(["Step 1: Media Library", "Step 2: Pages"]);
        expect(html()).not.toContain("Products CSV File");
        expect(html()).not.toContain("Import Products");
    });
    it("the sentence under the title", () => {
        expect(html()).toContain("Products of a catalog come from the pricelist import.");
    });
});
