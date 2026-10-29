/**
 * Pure request-body builders and output formatters of MCP tools (slice cat-mode-1, CATALOG-MODE-1).
 *
 * No I/O, no environment, no import from `index.ts`: `index.ts` runs `dotenv.config()` and `main()` when imported,
 * so its handlers cannot be loaded by a test. The three handlers below call these functions; `test/tool-shapes.test.ts`
 * asserts on what they return. Users: `create_tenant`, `create_product`, `list_products` in `index.ts`.
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
