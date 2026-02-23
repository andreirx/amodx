import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { queryCatProducts } from "../lib/catprod.js";
import { isProductAvailable } from "../lib/availability.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const categoryFilter = event.queryStringParameters?.category;
        const tag = event.queryStringParameters?.tag;
        const search = event.queryStringParameters?.search?.toLowerCase().trim();
        const page = parseInt(event.queryStringParameters?.page || "1");
        const limit = Math.min(parseInt(event.queryStringParameters?.limit || "24"), 100);

        let allProducts: any[];

        if (categoryFilter) {
            // Use CATPROD# adjacency items — reads only products in this category
            allProducts = await queryCatProducts(tenantId, categoryFilter);

            // Apply tag filter on the smaller set if needed
            if (tag) {
                allProducts = allProducts.filter((p: any) => (p.tags || []).includes(tag));
            }
        } else {
            // No category filter — query all active products
            const filterParts: string[] = ["#s = :active"];
            const exprValues: Record<string, any> = {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "PRODUCT#",
                ":active": "active"
            };

            if (tag) {
                filterParts.push("contains(tags, :tag)");
                exprValues[":tag"] = tag;
            }

            const result = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                FilterExpression: filterParts.join(" AND "),
                ExpressionAttributeValues: exprValues,
                ExpressionAttributeNames: { "#s": "status" },
                ProjectionExpression: search
                    ? "id, title, slug, price, currency, salePrice, availability, imageLink, tags, categoryIds, sortOrder, volumePricing, availableFrom, availableUntil, description, sku"
                    : "id, title, slug, price, currency, salePrice, availability, imageLink, tags, categoryIds, sortOrder, volumePricing, availableFrom, availableUntil"
            }));

            allProducts = (result.Items || []).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
        }

        // Text search filter (in-memory, case-insensitive)
        if (search) {
            allProducts = allProducts.filter((p: any) => {
                const title = (p.title || "").toLowerCase();
                const desc = (p.description || "").toLowerCase();
                const sku = (p.sku || "").toLowerCase();
                const tags = (p.tags || []).join(" ").toLowerCase();
                return title.includes(search) || desc.includes(search) ||
                       sku.includes(search) || tags.includes(search);
            });
        }

        // Filter by availability dates
        allProducts = allProducts.filter((p: any) => isProductAvailable(p));

        // Paginate
        const start = (page - 1) * limit;
        const products = allProducts.slice(start, start + limit);

        return {
            statusCode: 200,
            headers: { "Cache-Control": "public, max-age=60" },
            body: JSON.stringify({
                items: products,
                pagination: {
                    page,
                    limit,
                    total: allProducts.length,
                    totalPages: Math.ceil(allProducts.length / limit)
                }
            })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
