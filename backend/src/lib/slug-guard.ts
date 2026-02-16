import { db, TABLE_NAME } from "./db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

/**
 * Checks if a content slug would conflict with configured commerce URL prefixes.
 * Returns an error message if there's a conflict, or null if the slug is safe.
 */
export async function checkSlugCommerceConflict(tenantId: string, slug: string): Promise<string | null> {
    // Ensure slug starts with /
    const normalizedSlug = slug.startsWith("/") ? slug : `/${slug}`;

    // Fetch tenant config to get their URL prefixes
    const tenantRes = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
        ProjectionExpression: "urlPrefixes",
    }));

    const prefixes = tenantRes.Item?.urlPrefixes || URL_PREFIX_DEFAULTS;

    // Check if the slug matches or starts with any commerce prefix
    const commercePrefixes = [
        prefixes.product,
        prefixes.category,
        prefixes.cart,
        prefixes.checkout,
        prefixes.shop,
    ].filter(Boolean);

    for (const prefix of commercePrefixes) {
        if (normalizedSlug === prefix || normalizedSlug.startsWith(prefix + "/")) {
            return `Slug "${normalizedSlug}" conflicts with commerce URL prefix "${prefix}". Choose a different slug.`;
        }
    }

    return null;
}
