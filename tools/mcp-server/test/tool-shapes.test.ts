/**
 * cat-mode-1 (CATALOG-MODE-1) — the MCP tool shapes, asserted on what they return (not on route references).
 * Imports only `src/tool-shapes.ts` (pure): no `.env`, no network, no server. Run: `npm test` (after route coverage).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTenantBody, createProductBody, productListLine } from "../src/tool-shapes.ts";

test("create_tenant with catalog_mode: true → { name, domain, catalogMode: true }", () => {
    assert.deepEqual(createTenantBody({ name: "Glam", domain: "glam.test", catalog_mode: true }), { name: "Glam", domain: "glam.test", catalogMode: true });
});

test("create_tenant without catalog_mode → catalogMode: false", () => {
    assert.deepEqual(createTenantBody({ name: "Plain" }), { name: "Plain", domain: undefined, catalogMode: false });
});

test("create_product without an image (absent or empty) sends no imageLink key and never \"\"", () => {
    for (const image_link of [undefined, ""]) {
        const body = createProductBody({ title: "Rug", description: "d", image_link });
        assert.ok(!("imageLink" in body), `image_link=${JSON.stringify(image_link)}`);
        assert.ok(!Object.values(body).includes(""), "no empty-string value");
    }
});

test("create_product without a price sends no price key; with both, both are sent", () => {
    assert.ok(!("price" in createProductBody({ title: "Rug", description: "d", price: "" })));
    const body = createProductBody({ title: "Rug", description: "d", price: "10", image_link: "https://img.test/r.jpg" });
    assert.equal(body.price, "10");
    assert.equal(body.imageLink, "https://img.test/r.jpg");
});

test("list_products line for a priceless product prints no \"undefined\" and no price part", () => {
    const line = productListLine({ title: "Oak Plank", currency: "USD", status: "active", id: "p1" });
    assert.equal(line, "- Oak Plank [active] ID: p1");
    assert.ok(!line.includes("undefined"));
});

test("list_products line for a priced product keeps the price part", () => {
    assert.equal(productListLine({ title: "Rug", price: "10", currency: "USD", status: "draft", id: "p2" }), "- Rug (10 USD) [draft] ID: p2");
});
