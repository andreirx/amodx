import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

/**
 * CAT-ADMIN-1 (docs/slices/cat-admin-1.md § 4.4, § 4.3) — the Products page per site kind, and the page its "Import a
 * pricelist" link opens. The real page, rendered with react-dom/server in the admin's node test environment (no DOM).
 * Replaced: the tenant context, Amplify, and ONE
 * test-only state seed — `useState(true)` starts `false`, because the page's only `true` initial state is `loading`
 * and react-dom/server never runs the effect that would clear it. The rendered state is therefore "the product list
 * has loaded and is empty"; product rows are not covered (this slice does not change them).
 *
 * Non-catalog: the markup must equal the capture taken from 3912c5d (before this slice) — the files under
 * `__markup__/` were written by the first run of this test on the unchanged tree; a later difference fails the run.
 */

const tenant = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ tenants: tenant.current ? [tenant.current] : [], currentTenant: tenant.current, selectTenant: () => {}, refreshTenants: async () => {} }),
}));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));
vi.mock("react", async (importOriginal) => {
    const React = await importOriginal<typeof import("react")>();
    const useState = ((init: unknown) => React.useState(init === true ? false : init)) as typeof React.useState;
    return { ...React, default: { ...React, useState }, useState };
});

import Products from "./Products";
import CatalogImport from "./CatalogImport";

const render = (t: Record<string, unknown>) => {
    tenant.current = t;
    return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Products)));
};

const CONTENT = { id: "t1", name: "Content", domain: "content.test", commerceEnabled: false };
const COMMERCE = { id: "t2", name: "Shop", domain: "shop.test", commerceEnabled: true, currency: "RON" };
const CATALOG = { id: "t3", name: "Catalog", domain: "catalog.test", commerceEnabled: false, catalogMode: true };

describe("Products — a non-catalog site renders byte-equal to 3912c5d (rule 2)", () => {
    it("content site", async () => {
        await expect(render(CONTENT)).toMatchFileSnapshot("./__markup__/products.content.html");
    });
    it("commerce site", async () => {
        await expect(render(COMMERCE)).toMatchFileSnapshot("./__markup__/products.commerce.html");
    });
});

describe("Products — a catalog site (§ 4.4)", () => {
    const html = () => render(CATALOG);
    it("the catalog subtitle replaces the store subtitle", () => {
        expect(html()).toContain("The products of the catalog. Imported products are replaced by the next import of their sheet; products you add here stay.");
        expect(html()).not.toContain("Manage physical products for your store.");
    });
    it("\"Import a pricelist\" is a link to the pricelist import page; \"Add Product\" stays", () => {
        expect(html()).toMatch(/<a [^>]*href="\/catalog-import"[^>]*>[\s\S]*?Import a pricelist<\/a>/);
        expect(html()).toContain("Add Product");
    });
    it("no WooCommerce button or panel, no bulk-price tool", () => {
        expect(html()).not.toContain("Import CSV");
        expect(html()).not.toContain("WooCommerce");
        expect(html()).not.toContain("Adjust Prices");
    });
});

/*
 * CAT-ADMIN-1 § 4.3 — the page that "Import a pricelist" opens: "Pricelist import" (route `/catalog-import`). The real
 * page and the real import form; the state seed above does not touch them (no `useState(true)` in the page, in
 * GlamPricelistImport.tsx or in GlamProfileEditor.tsx — checked by grep in the build). The form's own behaviour is
 * pinned by GlamPricelistImport.test.ts.
 */
const renderImportPage = (t: Record<string, unknown>) => {
    tenant.current = t;
    return renderToStaticMarkup(createElement(CatalogImport));
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** The import form is mounted: its file input and its producer field are present. */
const hasImportForm = (html: string) => html.includes('id="glam-csv"') && html.includes('id="glam-producer"');

describe("Pricelist import page (§ 4.3) — a catalog site", () => {
    const html = () => renderImportPage(CATALOG);
    it("the title and the two contract sentences", () => {
        expect(html()).toContain(">Pricelist import</h1>");
        expect(html()).toContain("Upload one producer sheet at a time.");
        expect(html()).toContain("The next import of a sheet replaces the products it created, hand edits included.");
    });
    it("mounts the import form", () => {
        expect(hasImportForm(html())).toBe(true);
    });
});

describe("Pricelist import page (§ 4.3) — a non-catalog site opens the address", () => {
    for (const [kind, t] of [["content site", CONTENT], ["commerce site", COMMERCE]] as const) {
        it(`${kind}: one sentence, no form`, () => {
            const html = renderImportPage(t);
            expect(text(html)).toBe("This site is not a catalog.");
            expect(hasImportForm(html)).toBe(false);
        });
    }
});
