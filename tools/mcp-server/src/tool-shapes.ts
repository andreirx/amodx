/**
 * Pure request-body builders and output formatters of MCP tools (slice cat-mode-1, CATALOG-MODE-1).
 *
 * No I/O, no environment, no import from `index.ts`: `index.ts` runs `dotenv.config()` and `main()` when imported,
 * so its handlers cannot be loaded by a test. The handlers named below call these functions; `test/tool-shapes.test.ts`
 * asserts on what they return. Users: `create_tenant`, `create_product`, `list_products`, `import_glam_pricelist` (CAT-IMPORT-1)
 * in `index.ts`.
 */

/** `POST /tenants` body. `catalogMode` is true only for the literal `true` (the mode is fixed at creation, CM-D11). */
export function createTenantBody(args: { name: string; domain?: string; catalog_mode?: boolean }): {
    name: string; domain?: string; catalogMode: boolean;
} {
    return { name: args.name, domain: args.domain, catalogMode: args.catalog_mode === true };
}

/**
 * `POST /products` body. An absent or empty value is an omitted key, never `""`: the backend refuses a present price
 * on a catalog site and an empty image everywhere (CM-D1, CM-D7).
 */
export function createProductBody(args: {
    title: string; description: string; price?: string; slug?: string; image_link?: string; currency?: string;
    category_ids?: string; sale_price?: string; sku?: string; tags?: string; resource_id?: string;
}): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        title: args.title,
        description: args.description,
        resourceId: args.resource_id,
        status: "draft",
        availability: "in_stock",
        condition: "new",
    };
    if (args.price) payload.price = args.price;
    if (args.image_link) payload.imageLink = args.image_link;
    if (args.slug) payload.slug = args.slug;
    if (args.currency) payload.currency = args.currency;
    if (args.sale_price) payload.salePrice = args.sale_price;
    if (args.sku) payload.sku = args.sku;
    if (args.category_ids) payload.categoryIds = args.category_ids.split(",").map((s) => s.trim());
    if (args.tags) payload.tags = args.tags.split(",").map((s) => s.trim());
    return payload;
}

/** One `list_products` line. Catalog sites store no price: the price part is printed only when present (never "undefined"). */
export function productListLine(p: { title: string; price?: string; currency?: string; status?: string; id: string }): string {
    return `- ${p.title}${p.price !== undefined ? ` (${p.price} ${p.currency})` : ""} [${p.status}] ID: ${p.id}`;
}

/**
 * CAT-IMPORT-1 — `import_glam_pricelist`: the request of `POST /import/glam-pricelist`. The sheet defaults to the
 * file name without `.csv` (as in the admin form); a dry run is the default — the import replaces the sheet's
 * products, so the caller previews first. Absent `variant_name` → no key (the backend defaults it to "Variantă").
 */
export function glamPricelistRequest(
    args: { producer: string; sheet?: string; variant_name?: string; dry_run?: boolean },
    csvContent: string,
    fileName: string,
): { dryRun: boolean; body: Record<string, string> } {
    const body: Record<string, string> = {
        csvContent,
        producer: args.producer,
        sheet: args.sheet || fileName.replace(/\.csv$/i, ""),
    };
    if (args.variant_name) body.variantName = args.variant_name;
    return { dryRun: args.dry_run !== false, body };
}

/** The `import_glam_pricelist` result text: counts, the previous set, skipped rows. Nothing about prices exists to print. */
export function glamPricelistSummary(report: {
    dryRun: boolean; producer: string; sheet: string; importSource: string; totalRows: number;
    counts: { deleted: number; products: number; options: number; deduped: number; skipped: number };
    categoriesCreated: number; previousSet: { count: number; firstTitles: string[] };
    rows: { status: string; index: number; reason?: string }[];
    incompleteCategories?: { categoryId: string }[];
    categoryConflicts?: { slug: string; storedSlug: string }[];
}): string {
    const c = report.counts;
    const lines = [
        `${report.dryRun ? "DRY RUN (nothing written)" : "IMPORTED"} — ${report.producer} / ${report.sheet} (${report.importSource}), ${report.totalRows} rows`,
        `${report.dryRun ? "Would replace" : "Replaced"} ${c.deleted} previous products` +
            (report.previousSet.firstTitles.length ? ` (e.g. ${report.previousSet.firstTitles.join(", ")})` : ""),
        `${report.dryRun ? "Would create" : "Created"} ${c.products} products with ${c.options} variants; ${c.deduped} rows merged; ${report.categoriesCreated} new categories`,
        `Skipped ${c.skipped} rows` + (c.skipped ? `: ${report.rows.filter((r) => r.status === "skipped").map((r) => `row ${r.index} ${r.reason}`).join(", ")}` : ""),
    ];
    if (report.categoryConflicts?.length) {
        lines.push(`BLOCKED — renamed categories hold keys this import needs: ${report.categoryConflicts.map((x) => `${x.slug} (now ${x.storedSlug})`).join(", ")}; the import would answer 409`);
    }
    if (report.incompleteCategories?.length) {
        lines.push(`INCOMPLETE category lists: ${report.incompleteCategories.map((x) => x.categoryId).join(", ")} — import the same file again`);
    }
    if (report.dryRun) lines.push("To apply, call again with dry_run=false");
    return lines.join("\n");
}
