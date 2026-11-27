/**
 * Pure request-body builders and output formatters of MCP tools (slice cat-mode-1, CATALOG-MODE-1).
 *
 * No I/O, no environment, no import from `index.ts`: `index.ts` runs `dotenv.config()` and `main()` when imported,
 * so its handlers cannot be loaded by a test. The handlers named below call these functions; `test/tool-shapes.test.ts`
 * asserts on what they return. Users: `create_tenant`, `create_product`, `list_products`, `import_glam_pricelist` (CAT-IMPORT-1),
 * `create_category` (CATEGORY-CONTENT-1), `create_form` and `update_form` (STAY-1A) in `index.ts`.
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

/**
 * CATEGORY-CONTENT-1 — `POST /categories` body of `create_category`. The route's schema calls the category's name `name`
 * (`CategorySchema`); the tool's argument stays `title`. `blocks` = the category page's content, already parsed as a JSON
 * array (`parseJsonInput` in `index.ts`); sent only when given. Absent optional values are omitted keys.
 */
export function createCategoryBody(
    args: { title: string; slug?: string; description?: string; image_link?: string; parent_id?: string; sort_order?: number },
    blocks?: unknown[],
): Record<string, unknown> {
    const payload: Record<string, unknown> = { name: args.title };
    if (args.slug) payload.slug = args.slug;
    if (args.description) payload.description = args.description;
    if (args.image_link) payload.imageLink = args.image_link;
    if (args.parent_id) payload.parentId = args.parent_id;
    if (args.sort_order !== undefined) payload.sortOrder = args.sort_order;
    if (blocks !== undefined) payload.blocks = blocks;
    return payload;
}

/** One `list_products` line. Catalog sites store no price: the price part is printed only when present (never "undefined"). */
export function productListLine(p: { title: string; price?: string; currency?: string; status?: string; id: string }): string {
    return `- ${p.title}${p.price !== undefined ? ` (${p.price} ${p.currency})` : ""} [${p.status}] ID: ${p.id}`;
}

/**
 * CAT-IMPORT-1 — `import_glam_pricelist`: the request of `POST /import/glam-pricelist`. The sheet defaults to the
 * file name without `.csv` (as in the admin form); a dry run is the default — the import replaces the sheet's
 * products, so the caller previews first. Absent `variant_name` → no key (default: the site's default option name, CDL-1).
 * CDL-1 (docs/slices/catalog-data-labels-1.md § 4.3): `labels` "site" | "file" → the request member `labels`; absent
 * → no key (the backend uses the site labels).
 */
export function glamPricelistRequest(
    args: { producer: string; sheet?: string; variant_name?: string; labels?: "site" | "file"; dry_run?: boolean },
    csvContent: string,
    fileName: string,
): { dryRun: boolean; body: Record<string, string> } {
    const body: Record<string, string> = {
        csvContent,
        producer: args.producer,
        sheet: args.sheet || fileName.replace(/\.csv$/i, ""),
    };
    if (args.variant_name) body.variantName = args.variant_name;
    if (args.labels) body.labels = args.labels;
    return { dryRun: args.dry_run !== false, body };
}

/** CDL-1: the four column labels of one set, as the backend reports them (`@amodx/shared` `ImportLabels`). */
type ImportLabelsLine = { collection: string; unit: string; packaging: string; minimumOrder: string };
const labelsText = (l: ImportLabelsLine) => [l.collection, l.unit, l.packaging, l.minimumOrder].join(", ");

/** The `import_glam_pricelist` result text: counts, the previous set, skipped rows. Nothing about prices exists to print. */
export function glamPricelistSummary(report: {
    dryRun: boolean; producer: string; sheet: string; importSource: string; totalRows: number;
    counts: { deleted: number; products: number; options: number; deduped: number; skipped: number };
    categoriesCreated: number; previousSet: { count: number; firstTitles: string[] };
    rows: { status: string; index: number; reason?: string }[];
    incompleteCategories?: { categoryId: string }[];
    categoryConflicts?: { slug: string; storedSlug: string }[];
    /** CAT-IMPORT-PROFILE-1 § 6.4: the profile the import used (`revision` null = no profile stored or saved). */
    profile?: { source: string; revision: number | null; reason?: string };
    sheets?: { importSource: string; state: string; revisions: number[] }[];
    specLineRefusals?: { key: string; rowIndex: number; reason: string }[];
    /** CAT-IMAGE-GATE-1 § 3 items 4, 7: the status the products get, how many start hidden, those with no image address. */
    publication?: { status: "active" | "draft"; startHidden: number; withoutImageAddress: { slug: string; rowIndexes: number[] }[] };
    /**
     * CAT-SLUG-UNIQUE-1 § 2 item 3: the products whose planned address another product held; the new address is the
     * occupied one followed by the sheet's name and/or a number (backend `avoidTakenSlugs`).
     */
    crossSheetSuffixed?: { slug: string; previousSlug: string }[];
    /** CDL-1 § 4.8: the site and the file's labels and the set used (dry run and import). */
    labels?: { site: ImportLabelsLine; file: ImportLabelsLine; used: "site" | "file" };
    /** CDL-1 § 5.3: the other glam lists whose products hold other labels (dry run). */
    otherLabels?: { importSource: string; labels: ImportLabelsLine; products: number }[];
}): string {
    const c = report.counts;
    const lines = [
        `${report.dryRun ? "DRY RUN (nothing written)" : "IMPORTED"} — ${report.producer} / ${report.sheet} (${report.importSource}), ${report.totalRows} rows`,
        `${report.dryRun ? "Would replace" : "Replaced"} ${c.deleted} previous products` +
            (report.previousSet.firstTitles.length ? ` (e.g. ${report.previousSet.firstTitles.join(", ")})` : ""),
        `${report.dryRun ? "Would create" : "Created"} ${c.products} products with ${c.options} variants; ${c.deduped} rows merged; ${report.categoriesCreated} new categories`,
        `Skipped ${c.skipped} rows` + (c.skipped ? `: ${report.rows.filter((r) => r.status === "skipped").map((r) => `row ${r.index} ${r.reason}`).join(", ")}` : ""),
    ];
    if (report.labels) {
        lines.push(`Labels: ${report.labels.used === "site" ? "the site labels" : "this file's labels"} — ${labelsText(report.labels[report.labels.used])}`);
    }
    if (report.otherLabels?.length) {
        lines.push(`These lists use other labels: ${report.otherLabels.map((o) => `${o.importSource} (${o.products} products: ${labelsText(o.labels)})`).join("; ")}. Import them again to share filters.`);
    }
    if (report.profile) {
        // The tool cannot change a profile: it applies the producer's stored one (§ 6.4).
        lines.push(`Profile: ${report.profile.source}, ${report.profile.revision === null ? "no revision" : `revision ${report.profile.revision}`}` +
            (report.profile.reason ? ` — ${report.profile.reason}` : ""));
    }
    const notCurrent = (report.sheets ?? []).filter((x) => x.state !== "current");
    if (notCurrent.length) {
        lines.push(`Sheets not current (import them again): ${notCurrent.map((x) => `${x.importSource} ${x.state}${x.revisions.length ? ` [${x.revisions.join(", ")}]` : ""}`).join(", ")}`);
    }
    if (report.specLineRefusals?.length) {
        lines.push(`Spec lines refused by the value guard: ${report.specLineRefusals.map((x) => `row ${x.rowIndex} ${x.key} (${x.reason})`).join(", ")}`);
    }
    if (report.publication) {
        // CAT-IMAGE-GATE-1 § 3 item 7: this tool does not copy images (follow-up CAT-IMAGES-MCP-1), so hidden products
        // stay hidden until someone runs the copy ("Copy images" in admin, or POST /import/glam-pricelist/images).
        const pub = report.publication;
        const listed = pub.withoutImageAddress.slice(0, 10).map((x) => `${x.slug} (rows ${x.rowIndexes.join(", ")})`).join(", ") +
            (pub.withoutImageAddress.length > 10 ? `, and ${pub.withoutImageAddress.length - 10} more` : "");
        switch (pub.status) {
            case "draft":
                lines.push(`${report.dryRun ? "Products that would start hidden" : "Products that start hidden"}: ${pub.startHidden} — each becomes public when the image copy (“Copy images” in admin) copies one of its images. This tool does not copy images: without a copy, the products stay hidden.`);
                if (pub.withoutImageAddress.length) lines.push(`No image address in the file (these stay hidden unless you add images to the file): ${pub.withoutImageAddress.length} — ${listed}`);
                break;
            case "active":
                lines.push(`The profile also publishes products without an image: no product starts hidden.`);
                if (pub.withoutImageAddress.length) lines.push(`Published without an image address in the file: ${pub.withoutImageAddress.length} — ${listed}`);
                break;
            default: {
                const unhandled: never = pub.status;
                throw new Error(`Unhandled publication status ${String(unhandled)}`);
            }
        }
    }
    if (report.crossSheetSuffixed?.length) {
        // Only what is true on every allocation path: never what the new address ends with.
        lines.push(`Addresses ${report.dryRun ? "that would be changed" : "changed"} (the address already belonged to another product; the new address is the taken address, followed by the sheet's name and/or a number): ${report.crossSheetSuffixed.length} ${report.crossSheetSuffixed.length === 1 ? "product" : "products"}`);
    }
    if (report.categoryConflicts?.length) {
        lines.push(`BLOCKED — renamed categories hold keys this import needs: ${report.categoryConflicts.map((x) => `${x.slug} (now ${x.storedSlug})`).join(", ")}; the import would answer 409`);
    }
    if (report.incompleteCategories?.length) {
        lines.push(`INCOMPLETE category lists: ${report.incompleteCategories.map((x) => x.categoryId).join(", ")} — import the same file again`);
    }
    if (report.dryRun) lines.push("To apply, call again with dry_run=false");
    return lines.join("\n");
}

/**
 * GALLERY-1 (docs/slices/gallery-1.md, scope item 6; ruling 6) — the `gallery` block as `get_block_schemas` describes it
 * (an entry of `BLOCK_SCHEMAS` in `index.ts`). Here, not in `index.ts`, so `test/tool-shapes.test.ts` can bind its keys
 * and its example to the plugin's schema (`packages/plugins/src/gallery/schema.ts`). `thumb` and the sizes are accepted
 * from tools; the admin editor does not ask for them.
 */
export const GALLERY_BLOCK_SHAPE = {
    description: "A grid of photo tiles. Each tile links to its large photo (works without script, indexable); with script a full-screen viewer opens it, with previous / next, swipe, arrow keys, Escape, a position counter and the caption. The viewer's button names and counter come from the site's labels in the page's language. Tiles load lazily; the viewer loads the photo of its position and fetches the next one ahead. Offered on every site kind.",
    attrs: {
        items: "array of photo objects (see itemStructure), in tile order. An item whose src is not https:// or a root-relative path (/...) is not shown",
        columns: "'2' | '3' | '4' (default '3'; columns from larger screens, 2 on a phone)",
        blockWidth: "'content' | 'wide' | 'full' (default 'content')",
    },
    itemStructure: {
        src: "string — the large photo: https://… or /… (required)",
        thumb: "string (optional) — a smaller file of the same photo for the tile; absent = the tile uses src",
        alt: "string — what the photo shows, for screen readers and search engines ('' = none; never the file name)",
        caption: "string (optional) — text under the photo in the viewer",
        width: "number (optional) — the photo's width in pixels; with height, the viewer knows its shape before it loads",
        height: "number (optional) — the photo's height in pixels",
    },
    example: {
        type: "gallery",
        attrs: {
            items: [
                { src: "https://cdn.example.com/rooms/garden.jpg", thumb: "https://cdn.example.com/rooms/garden-480.jpg", alt: "The garden with the old walnut tree", caption: "The garden in May", width: 2000, height: 1500 },
                { src: "https://cdn.example.com/rooms/blue-room.jpg", alt: "The blue room with a double bed" },
            ],
            columns: "3",
            blockWidth: "wide",
        },
    },
} as const;

/**
 * STAY-1A (docs/slices/stay-1.md § 2, ruling 10) — the field list and the pair rule as `create_form` / `update_form`
 * describe them. Here, not in `index.ts`, so `test/tool-shapes.test.ts` binds the listed types to the shared
 * `FormFieldSchema` (a type added there and not here fails the test).
 */
export const FORM_FIELDS_DESCRIPTION =
    "JSON array of fields. Each: {id (string), label, type ('text'|'email'|'phone'|'textarea'|'select'|'checkbox'|'number'|'date'), required (boolean), placeholder?, options? (string array, for select), min? ('today', for date: a date before the site's today is refused)}. " +
    "A date value is the text YYYY-MM-DD, stored as sent.";
export const FORM_DATE_ORDER_DESCRIPTION =
    "Optional pair rule as JSON: {\"earlier\": \"<field id>\", \"later\": \"<field id>\"} — two different date fields of this form; " +
    "a submission whose later date is not after the earlier date is refused (checked only when both are filled in). " +
    "The backend refuses a rule that names a missing or non-date field (HTTP 400). Send null to remove the rule.";

/**
 * `POST /forms` / `PUT /forms/{id}` body (snake_case in, camelCase to the API). `fields`: already parsed as a JSON array;
 * `dateOrder`: already parsed as a JSON object, or null (remove the rule). Absent values are omitted keys.
 */
export function formBody(
    args: { name?: string; slug?: string; submit_button_text?: string; success_message?: string; notify_email?: string; status?: string },
    fields?: unknown[], dateOrder?: Record<string, unknown> | null,
): Record<string, unknown> {
    const p: Record<string, unknown> = {
        name: args.name, slug: args.slug, submitButtonText: args.submit_button_text,
        successMessage: args.success_message, notifyEmail: args.notify_email, status: args.status,
        fields, dateOrder,
    };
    return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
}
