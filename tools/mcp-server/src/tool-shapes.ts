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
}): string {
    const c = report.counts;
    const lines = [
        `${report.dryRun ? "DRY RUN (nothing written)" : "IMPORTED"} — ${report.producer} / ${report.sheet} (${report.importSource}), ${report.totalRows} rows`,
        `${report.dryRun ? "Would replace" : "Replaced"} ${c.deleted} previous products` +
            (report.previousSet.firstTitles.length ? ` (e.g. ${report.previousSet.firstTitles.join(", ")})` : ""),
        `${report.dryRun ? "Would create" : "Created"} ${c.products} products with ${c.options} variants; ${c.deduped} rows merged; ${report.categoriesCreated} new categories`,
        `Skipped ${c.skipped} rows` + (c.skipped ? `: ${report.rows.filter((r) => r.status === "skipped").map((r) => `row ${r.index} ${r.reason}`).join(", ")}` : ""),
    ];
    if (report.profile) {
        // The tool cannot change a profile: it applies the producer's stored one (§ 6.4).
        lines.push(`Profil: ${report.profile.source}, ${report.profile.revision === null ? "fără revizie" : `revizia ${report.profile.revision}`}` +
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
        // stay hidden until someone runs the copy ("Copiază imaginile" in admin, or POST /import/glam-pricelist/images).
        const pub = report.publication;
        const listed = pub.withoutImageAddress.slice(0, 10).map((x) => `${x.slug} (rândurile ${x.rowIndexes.join(", ")})`).join(", ") +
            (pub.withoutImageAddress.length > 10 ? `, și încă ${pub.withoutImageAddress.length - 10}` : "");
        switch (pub.status) {
            case "draft":
                lines.push(`${report.dryRun ? "Ar porni ascunse" : "Pornesc ascunse"}: ${pub.startHidden} produse — fiecare devine public când copierea imaginilor („Copiază imaginile” în admin) copiază una dintre imaginile lui. Acest instrument nu copiază imagini: fără copiere, produsele rămân ascunse.`);
                if (pub.withoutImageAddress.length) lines.push(`Fără adresă de imagine în fișier (rămân ascunse dacă nu adăugați imagini în fișier): ${pub.withoutImageAddress.length} — ${listed}`);
                break;
            case "active":
                lines.push(`Profilul publică și produsele fără imagine: niciun produs nu pornește ascuns.`);
                if (pub.withoutImageAddress.length) lines.push(`Publicate fără adresă de imagine în fișier: ${pub.withoutImageAddress.length} — ${listed}`);
                break;
            default: {
                const unhandled: never = pub.status;
                throw new Error(`Unhandled publication status ${String(unhandled)}`);
            }
        }
    }
    if (report.crossSheetSuffixed?.length) {
        // Only what is true on every allocation path: never what the new address ends with.
        lines.push(`Adrese ${report.dryRun ? "care ar fi schimbate" : "schimbate"} (adresa era deja a altui produs; adresa nouă este adresa ocupată, urmată de numele foii și/sau de un număr): ${report.crossSheetSuffixed.length} ${report.crossSheetSuffixed.length === 1 ? "produs" : "produse"}`);
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
