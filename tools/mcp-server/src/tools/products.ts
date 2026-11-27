import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { createProductBody, productListLine, glamPricelistRequest, glamPricelistSummary } from "../tool-shapes.js";
import { apiError, PAGE_REVALIDATION_ATTEMPT, parseJsonInput } from "../tool-helpers.js";

export function registerProductTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// LIST PRODUCTS
server.tool("list_products",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/products`, { headers: getHeaders(tenant_id) });
            const summary = response.data.items.map(productListLine).join("\n");
            return { content: [{ type: "text", text: `Products for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("list_tags",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/content`, { headers: getHeaders(tenant_id) });
            const allTags = new Set<string>();
            (response.data.items || []).forEach((item: any) => {
                if (Array.isArray(item.tags)) {
                    item.tags.forEach((t: string) => allTags.add(t));
                }
            });
            const sorted = Array.from(allTags).sort();
            return { content: [{ type: "text", text: `Available Tags for ${tenant_id}:\n${sorted.join(", ")}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// CREATE PRODUCT
server.tool("create_product",
    {
        tenant_id: z.string(),
        title: z.string(),
        price: z.string().optional().describe("Price. Required on a shop site; refused on a catalog site (catalog sites store no price)."),
        slug: z.string().optional().describe("URL-friendly slug (auto-generated if omitted)"),
        description: z.string().describe("Plain text description"),
        image_link: z.string().optional().describe("URL of main image. Required on a shop site; optional on a catalog site."),
        currency: z.string().optional().describe("Currency code (e.g., 'RON', 'EUR'). Defaults to tenant currency."),
        category_ids: z.string().optional().describe("Comma-separated category IDs to assign product to"),
        sale_price: z.string().optional().describe("Discounted price (shown with strikethrough on original)"),
        sku: z.string().optional().describe("Stock Keeping Unit code"),
        tags: z.string().optional().describe("Comma-separated product tags"),
        resource_id: z.string().optional().describe("ID of a private file to deliver upon purchase"),
    },
    async ({ tenant_id, title, price, slug, description, image_link, currency, category_ids, sale_price, sku, tags, resource_id }) => {
        try {
            const payload = createProductBody({ title, price, slug, description, image_link, currency, category_ids, sale_price, sku, tags, resource_id });
            const response = await axios.post(`${API_URL}/products`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Created product "${title}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("get_product",
    "Read one product with all its stored fields (JSON).",
    {
        tenant_id: z.string(),
        product_id: z.string().describe("Product ID (from list_products)"),
    },
    async ({ tenant_id, product_id }) => {
        try {
            const response = await axios.get(`${API_URL}/products/${product_id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("update_product",
    "Update a product. Only the keys you send change. The tool reads the stored product, merges your keys over it and sends the full product, " +
    "because the backend's partial validation fills every omitted field with its schema default (e.g. status 'draft', categoryIds []). " +
    "Not atomic: an admin edit made between the read and the write is overwritten. " + PAGE_REVALIDATION_ATTEMPT,
    {
        tenant_id: z.string(),
        product_id: z.string().describe("Product ID (from list_products)"),
        fields: z.string().describe(
            "JSON object of ProductSchema fields to change (camelCase), validated by the backend. Common keys: title, slug, status ('active'|'archived'|'draft'), " +
            "price (string; required on shop sites, refused on catalog sites), salePrice (string; refused on catalog sites), currency, description (plain text, max 5000), longDescription (HTML), imageLink (null removes the stored image), additionalImageLinks (array), " +
            "availability ('in_stock'|'out_of_stock'|'preorder'), inventoryQuantity (integer), availableFrom/availableUntil (ISO date), categoryIds (array), tags (array), sku, sortOrder. " +
            "Use get_product to see the full shape (variants, volumePricing, personalizations, attributes)."
        ),
    },
    async ({ tenant_id, product_id, fields }) => {
        const parsed = parseJsonInput(fields, "object", "fields");
        if (!parsed.ok) return parsed.result;
        const patch = parsed.value;
        try {
            const headers = getHeaders(tenant_id);
            const current = await axios.get(`${API_URL}/products/${product_id}`, { headers });
            const response = await axios.put(`${API_URL}/products/${product_id}`, { ...current.data, ...patch }, { headers });
            return { content: [{ type: "text", text: `✓ Updated product "${response.data.title}" (${Object.keys(patch).join(", ")})` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("delete_product",
    "Permanently delete a product and its category links. No undo. " + PAGE_REVALIDATION_ATTEMPT,
    {
        tenant_id: z.string(),
        product_id: z.string().describe("Product ID (from list_products)"),
    },
    async ({ tenant_id, product_id }) => {
        try {
            await axios.delete(`${API_URL}/products/${product_id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Deleted product ${product_id}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

// ==========================================
// CATALOG: GLAM PRICELIST IMPORT (CAT-IMPORT-1)
// ==========================================

server.tool("import_glam_pricelist",
    "Import ONE glam enriched pricelist sheet (.csv, the 12-column layout) into a catalog site: one product per style, " +
    "its rows as variants. REPLACES the products of that producer + sheet. Prices are never read; specification lines that name " +
    "the row's producer code are removed (image URLs are kept as in the file until cat-images-1). " +
    "Defaults to a dry run (nothing written) — call again with dry_run=false to apply.",
    {
        tenant_id: z.string(),
        csv_path: z.string().describe("Local path of the enriched CSV, e.g. pl-tools/out/boen/enriched/PL.csv"),
        producer: z.string().describe("Producer name (becomes the brand and the parent category); no '/'"),
        sheet: z.string().optional().describe("Sheet name (default: the file name without .csv); no '/'"),
        variant_name: z.string().optional().describe("What the variants are, e.g. Format, Color (default: the site's default option name)"),
        labels: z.enum(["site", "file"]).optional().describe("Attribute names of the collection, unit, packaging and minimum-order columns: 'site' = the site's labels (Labels page; default), 'file' = this file's header cells (products of this list get their own filters, separate from other lists)"),
        dry_run: z.boolean().optional().describe("Preview only (default true)"),
    },
    async ({ tenant_id, csv_path, producer, sheet, variant_name, labels, dry_run }) => {
        try {
            const csvContent = fs.readFileSync(csv_path, "utf8");
            const request = glamPricelistRequest({ producer, sheet, variant_name, labels, dry_run }, csvContent, path.basename(csv_path));
            const response = await axios.post(`${API_URL}/import/glam-pricelist`, request.body, {
                headers: getHeaders(tenant_id),
                params: request.dryRun ? { dryRun: "1" } : undefined,
            });
            return { content: [{ type: "text", text: glamPricelistSummary(response.data) }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);
}
