import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "../lib/db.js";

/**
 * The product slug rule of the WooCommerce CSV import and its slug lookup. Moved out of woocommerce.ts unchanged by
 * IMPORT-PATHS-1, so that the WordPress import (wordpress.ts, product redirects) finds a product by the slug that import
 * stored without loading a second handler module. Users: woocommerce.ts, wordpress.ts.
 */

/**
 * Look up existing product by slug using GSI_Slug. IMPORT-PATHS-1 (review F-IP1-TENANT-LOOKUP): only a `PRODUCT#` item
 * of THIS tenant's partition counts — the index key `TenantSlug` is data, not proof of ownership (the renderer's
 * `getProductBySlug` and backend/src/products/public-get.ts apply the same check). Before, any row whose index attribute
 * matched was returned, so a forged or mis-written row of another tenant could become the WooCommerce import's
 * "existing product" or a WordPress redirect target.
 */
export async function findProductBySlug(tenantId: string, slug: string): Promise<any | null> {
    const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI_Slug",
        KeyConditionExpression: "TenantSlug = :ts",
        ExpressionAttributeValues: { ":ts": `${tenantId}#${slug}` },
    }));
    return result.Items?.find((item: any) => item.PK === `TENANT#${tenantId}` && item.SK?.startsWith("PRODUCT#")) || null;
}

/** The product slug of a row without a `Slug` cell: `slugify(Name)`. */
export const slugify = (str: string) => {
    return str
        .toLowerCase()
        .trim()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")  // strip diacritics
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
};
