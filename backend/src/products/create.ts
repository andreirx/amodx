import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ProductSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";
import { writeCatProductItems } from "../lib/catprod.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { readTenantMode, checkProductWrite } from "../lib/catalog-product.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const slugify = (str: string) => {
    return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-');
};

const _handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        // SECURITY: Editors allowed
        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };
        if (!event.body) return { statusCode: 400, body: "Missing Body" };

        const body = JSON.parse(event.body);

        // CATALOG-MODE-1: the tenant's mode, read authoritatively (404 when the tenant record is missing).
        const mode = await readTenantMode(tenantId);
        if (!mode) return { statusCode: 404, body: JSON.stringify({ error: "Site not found" }) };

        // Validate. `importSource` is importer-owned: omitted here, so the body cannot set it (stripped, not refused).
        const parsed = ProductSchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true, importSource: true
        }).safeParse(body);
        if (!parsed.success) {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid product", details: parsed.error.issues }) };
        }

        // CATALOG-MODE-1 write boundary: no monetary field on a catalog tenant; price and image required elsewhere.
        const check = checkProductWrite(parsed.data, mode.catalogMode);
        if (check.kind === "refused") return { statusCode: 400, body: JSON.stringify({ error: check.error }) };
        const input = check.item as typeof parsed.data;

        // Auto-generate slug if not provided
        if (!input.slug) {
            input.slug = slugify(input.title);
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `PRODUCT#${id}`,
                TenantSlug: `${tenantId}#${input.slug}`,
                id,
                tenantId,
                ...input,
                createdAt: now,
                updatedAt: now,
                Type: "Product"
            }
        }));

        // Write CATPROD# adjacency items for category lookups
        await writeCatProductItems(tenantId, {
            id, title: input.title, slug: input.slug, sku: input.sku,
            price: input.price, currency: input.currency, salePrice: input.salePrice,
            imageLink: input.imageLink, availability: input.availability,
            status: input.status,
            sortOrder: input.sortOrder || 0, tags: input.tags || [],
            volumePricing: input.volumePricing || [],
            categoryIds: input.categoryIds || [],
            availableFrom: input.availableFrom,
            availableUntil: input.availableUntil,
        });

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_PRODUCT",
            target: { title: input.title, id: id },
            details: { price: input.price, status: input.status, slug: input.slug },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 201, body: JSON.stringify({ id, slug: input.slug, message: "Product created" }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

export const handler = withInvalidation(_handler);
