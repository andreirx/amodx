/**
 * cat-mode-1 (CATALOG-MODE-1) — the MCP tool shapes, asserted on what they return (not on route references).
 * Imports only `src/tool-shapes.ts` (pure): no `.env`, no network, no server. Run: `npm test` (after route coverage).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTenantBody, createProductBody, productListLine, glamPricelistRequest, glamPricelistSummary } from "../src/tool-shapes.ts";

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

test("import_glam_pricelist: dry run by default; sheet defaults to the file name; body keys exactly csvContent, producer, sheet", () => {
    const req = glamPricelistRequest({ producer: "BOEN" }, "csv", "PL.csv");
    assert.equal(req.dryRun, true);
    assert.deepEqual(req.body, { csvContent: "csv", producer: "BOEN", sheet: "PL" });
});

test("import_glam_pricelist: dry_run false applies; sheet and variant name are sent when given", () => {
    const req = glamPricelistRequest({ producer: "ITC", sheet: "Arc_Edition", variant_name: "Culoare", dry_run: false }, "csv", "x.csv");
    assert.equal(req.dryRun, false);
    assert.deepEqual(req.body, { csvContent: "csv", producer: "ITC", sheet: "Arc_Edition", variantName: "Culoare" });
});

test("import_glam_pricelist summary: dry-run counts, the previous set and skipped rows", () => {
    const text = glamPricelistSummary({
        dryRun: true, producer: "BOEN", sheet: "PL", importSource: "glam:boen/pl", totalRows: 3,
        counts: { deleted: 2, products: 1, options: 2, deduped: 0, skipped: 1 }, categoriesCreated: 2,
        previousSet: { count: 2, firstTitles: ["Oak", "Ash"] },
        rows: [{ status: "created", index: 2 }, { status: "option", index: 3 }, { status: "skipped", index: 4, reason: "no-name" }],
    });
    assert.equal(text, [
        "DRY RUN (nothing written) — BOEN / PL (glam:boen/pl), 3 rows",
        "Would replace 2 previous products (e.g. Oak, Ash)",
        "Would create 1 products with 2 variants; 0 rows merged; 2 new categories",
        "Skipped 1 rows: row 4 no-name",
        "To apply, call again with dry_run=false",
    ].join("\n"));
});

test("import_glam_pricelist summary names category conflicts reported by a dry run", () => {
    const text = glamPricelistSummary({
        dryRun: true, producer: "BOEN", sheet: "PL", importSource: "glam:boen/pl", totalRows: 1,
        counts: { deleted: 0, products: 1, options: 1, deduped: 0, skipped: 0 }, categoriesCreated: 2,
        previousSet: { count: 0, firstTitles: [] }, rows: [{ status: "created", index: 2 }],
        categoryConflicts: [{ slug: "boen", storedSlug: "renamed-boen" }],
    });
    assert.ok(text.includes("BLOCKED — renamed categories hold keys this import needs: boen (now renamed-boen); the import would answer 409"));
});

test("import_glam_pricelist summary (CAT-IMPORT-PROFILE-1): the profile used, the sheets not current, refused spec lines", () => {
    const base = {
        dryRun: true, producer: "BOEN", sheet: "PL", importSource: "glam:boen/pl", totalRows: 1,
        counts: { deleted: 0, products: 1, options: 1, deduped: 0, skipped: 0 }, categoriesCreated: 0,
        previousSet: { count: 0, firstTitles: [] }, rows: [{ status: "created", index: 2 }],
    };
    const text = glamPricelistSummary({
        ...base,
        profile: { source: "stored", revision: 3 },
        sheets: [
            { importSource: "glam:boen/pl", state: "current", revisions: [3] },
            { importSource: "glam:boen/a", state: "stale", revisions: [2] },
            { importSource: "glam:boen/b", state: "no-profile", revisions: [] },
        ],
        specLineRefusals: [{ key: "Price", rowIndex: 4, reason: "money" }],
    });
    assert.ok(text.includes("Profile: stored, revision 3"));
    assert.ok(text.includes("Sheets not current (import them again): glam:boen/a stale [2], glam:boen/b no-profile"));
    assert.ok(!text.includes("glam:boen/pl current"));
    assert.ok(text.includes("Spec lines refused by the value guard: row 4 Price (money)"));
    const plain = glamPricelistSummary({ ...base, profile: { source: "default", revision: null }, sheets: [], specLineRefusals: undefined });
    assert.ok(plain.includes("Profile: default, no revision"));
    assert.ok(!plain.includes("Sheets not current") && !plain.includes("refused"));
});

test("import_glam_pricelist summary (CAT-IMAGE-GATE-1): how many start hidden, that this tool does not copy images, the products with no image address", () => {
    const base = {
        dryRun: false, producer: "BOEN", sheet: "PL", importSource: "glam:boen/pl", totalRows: 3,
        counts: { deleted: 0, products: 3, options: 3, deduped: 0, skipped: 0 }, categoriesCreated: 0,
        previousSet: { count: 0, firstTitles: [] }, rows: [],
    };
    const hidden = glamPricelistSummary({
        ...base,
        publication: { status: "draft", startHidden: 3, withoutImageAddress: [{ slug: "boen-pl-ash", rowIndexes: [4, 5] }] },
    });
    assert.ok(hidden.includes("Products that start hidden: 3"));
    assert.ok(hidden.includes("This tool does not copy images: without a copy, the products stay hidden."));
    assert.ok(hidden.includes("No image address in the file (these stay hidden unless you add images to the file): 1 — boen-pl-ash (rows 4, 5)"));
    const dry = glamPricelistSummary({ ...base, dryRun: true, publication: { status: "draft", startHidden: 3, withoutImageAddress: [] } });
    assert.ok(dry.includes("Products that would start hidden: 3") && !dry.includes("No image address"));
    const many = glamPricelistSummary({
        ...base,
        publication: { status: "draft", startHidden: 12, withoutImageAddress: Array.from({ length: 12 }, (_, i) => ({ slug: `p${i}`, rowIndexes: [i + 2] })) },
    });
    assert.ok(many.includes("p9 (rows 11), and 2 more") && !many.includes("p10 ("));
    const published = glamPricelistSummary({ ...base, publication: { status: "active", startHidden: 0, withoutImageAddress: [{ slug: "boen-pl-ash", rowIndexes: [4] }] } });
    assert.ok(published.includes("no product starts hidden") && published.includes("Published without an image address in the file: 1"));
    assert.ok(!glamPricelistSummary(base).includes("hidden")); // an answer without the member (an older backend) prints nothing about it
});

test("import_glam_pricelist summary (CAT-SLUG-UNIQUE-1): the count of products whose address another product held", () => {
    const base = {
        dryRun: false, producer: "ALPOD", sheet: "ORC-wood", importSource: "glam:alpod/orc-wood", totalRows: 132,
        counts: { deleted: 0, products: 8, options: 132, deduped: 0, skipped: 0 }, categoriesCreated: 0,
        previousSet: { count: 0, firstTitles: [] }, rows: [],
    };
    const eight = Array.from({ length: 8 }, (_, i) => ({ slug: `s${i}-orc-wood`, previousSlug: `s${i}` }));
    const rule = "(the address already belonged to another product; the new address is the taken address, followed by the sheet's name and/or a number)";
    const done = glamPricelistSummary({ ...base, crossSheetSuffixed: eight });
    assert.ok(done.includes(`Addresses changed ${rule}: 8 products`));
    assert.ok(glamPricelistSummary({ ...base, dryRun: true, crossSheetSuffixed: eight }).includes(`Addresses that would be changed ${rule}: 8 products`));
    // review-0 R2: true on every allocation path — an empty sheet slug gives a number only, so no "at the end" promise
    const emptySheet = glamPricelistSummary({ ...base, crossSheetSuffixed: [{ slug: "s0-2", previousSlug: "s0" }] });
    assert.ok(emptySheet.includes(`Addresses changed ${rule}: 1 product`) && !emptySheet.includes("1 products") && !/at the end/.test(emptySheet));
    // an empty list, or an answer without the member (an older backend), prints nothing about it
    assert.ok(!glamPricelistSummary({ ...base, crossSheetSuffixed: [] }).includes("sheet's name"));
    assert.ok(!glamPricelistSummary(base).includes("sheet's name"));
});

// CDL-1 (docs/slices/catalog-data-labels-1.md § 4.3, § 5.3): the label choice and the summary lines.
test("import_glam_pricelist: labels is sent as the request member only when given", () => {
    assert.ok(!("labels" in glamPricelistRequest({ producer: "BOEN" }, "csv", "PL.csv").body));
    assert.equal(glamPricelistRequest({ producer: "BOEN", labels: "file" }, "csv", "PL.csv").body.labels, "file");
    assert.equal(glamPricelistRequest({ producer: "BOEN", labels: "site" }, "csv", "PL.csv").body.labels, "site");
});

test("import_glam_pricelist summary: one line with the label set used and its four labels; the other lists' line", () => {
    const base = {
        dryRun: true, producer: "BOEN", sheet: "PL", importSource: "glam:boen/pl", totalRows: 1,
        counts: { deleted: 0, products: 1, options: 1, deduped: 0, skipped: 0 }, categoriesCreated: 0,
        previousSet: { count: 0, firstTitles: [] }, rows: [{ status: "created", index: 2 }],
    };
    const site = { collection: "Collection", unit: "Unit", packaging: "Packaging", minimumOrder: "Minimum order" };
    const file = { collection: "colectie", unit: "unitate de masura", packaging: "unitate de impachetare", minimumOrder: "comanda minima" };
    const used = glamPricelistSummary({ ...base, labels: { site, file, used: "site" }, otherLabels: [] }).split("\n");
    assert.ok(used.includes("Labels: the site labels — Collection, Unit, Packaging, Minimum order"));
    assert.ok(!used.some((l) => l.startsWith("These lists use other labels")));
    const fromFile = glamPricelistSummary({
        ...base, labels: { site, file, used: "file" },
        otherLabels: [{ importSource: "glam:alpod/a", labels: site, products: 2 }],
    }).split("\n");
    assert.ok(fromFile.includes("Labels: this file's labels — colectie, unitate de masura, unitate de impachetare, comanda minima"));
    assert.ok(fromFile.includes("These lists use other labels: glam:alpod/a (2 products: Collection, Unit, Packaging, Minimum order). Import them again to share filters."));
});
