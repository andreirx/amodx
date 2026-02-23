import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ProductSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import {requireRole} from "../auth/policy.js";
import { writeCatProductItems, deleteCatProductItems } from "../lib/catprod.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;
        const id = event.pathParameters?.id;

        // SECURITY: Editors allowed
        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId || !id || !event.body) return { statusCode: 400, body: "Missing Data" };

        const body = JSON.parse(event.body);

        // Fetch existing
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: "Product not found" };

        // Partial validation
        const input = ProductSchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true
        }).partial().parse(body);

        const merged: Record<string, any> = { ...existing.Item, ...input, updatedAt: new Date().toISOString() };

        // Update GSI attribute if slug changed
        if (input.slug && input.slug !== existing.Item.slug) {
            merged.TenantSlug = `${tenantId}#${input.slug}`;
        }

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: merged
        }));

        // Rebuild CATPROD# adjacency items (delete old, write new)
        const oldCategoryIds: string[] = existing.Item.categoryIds || [];
        const newCategoryIds: string[] = merged.categoryIds || [];
        await deleteCatProductItems(tenantId!, id!, oldCategoryIds);
        await writeCatProductItems(tenantId!, {
            id: id!, title: merged.title, slug: merged.slug, sku: merged.sku,
            price: merged.price, currency: merged.currency, salePrice: merged.salePrice,
            imageLink: merged.imageLink, availability: merged.availability,
            status: merged.status,
            sortOrder: merged.sortOrder || 0, tags: merged.tags || [],
            volumePricing: merged.volumePricing || [],
            categoryIds: newCategoryIds,
            availableFrom: merged.availableFrom,
            availableUntil: merged.availableUntil,
        });

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_PRODUCT",
            target: { title: merged.title, id: id },
            details: { updatedFields: Object.keys(input).filter(key => input[key as keyof typeof input] !== undefined) },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify(merged) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
