import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ProductSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import {requireRole} from "../auth/policy.js";
import { writeCatProductItems, deleteCatProductItems } from "../lib/catprod.js";
import { revalidateTenantPaths } from "../lib/revalidate.js";
import { readTenantMode, checkProductWrite } from "../lib/catalog-product.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const _handler: Handler = async (event) => {
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

        // CATALOG-MODE-1: the tenant's mode, read authoritatively (404 when the tenant record is missing).
        const mode = await readTenantMode(tenantId);
        if (!mode) return { statusCode: 404, body: JSON.stringify({ error: "Site not found" }) };

        // Fetch existing
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: "Product not found" };

        // CM-D7: `imageLink: null` is the removal instruction (storage never holds null or ""); the schema refuses
        // null, so it is taken out of the body before the parse and applied to the merged item below.
        const removeImage = body.imageLink === null;
        if (removeImage) delete body.imageLink;

        // Partial validation. `importSource`, `facetModes` and `importProfileRevision` are importer-owned: omitted, so
        // the body cannot set, change or remove them (the merge keeps the stored values).
        const parsed = ProductSchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true, importSource: true,
            facetModes: true, importProfileRevision: true,
        }).partial().safeParse(body);
        if (!parsed.success) {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid product", details: parsed.error.issues }) };
        }
        const input = parsed.data;

        const draft: Record<string, any> = { ...existing.Item, ...input, updatedAt: new Date().toISOString() };
        if (removeImage) delete draft.imageLink;

        // CATALOG-MODE-1 write boundary, on the merged item (what will be stored).
        const check = checkProductWrite(draft, mode.catalogMode);
        if (check.kind === "refused") return { statusCode: 400, body: JSON.stringify({ error: check.error }) };
        const merged = check.item;

        // Update GSI attribute if slug changed
        if (input.slug && input.slug !== existing.Item.slug) {
            merged.TenantSlug = `${tenantId}#${input.slug}`;
        }

        // C10-1: the write never re-creates a product deleted since the read above. A cancelled write answers 404
        // and the CATPROD# rebuild below does not run.
        try {
            await db.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: merged,
                ConditionExpression: "attribute_exists(PK)",
            }));
        } catch (e: any) {
            if (e?.name === "ConditionalCheckFailedException") {
                return { statusCode: 404, body: "Product not found" };
            }
            throw e;
        }

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

        // Cache invalidation: product page (+ the old URL on a rename). cache-2: the paths
        // are built from the tenant's DOMAIN and its own `urlPrefixes.product`, not from
        // the tenant id and the hardcoded `/product` default.
        await revalidateTenantPaths(tenantId, "product", [merged.slug, existing.Item.slug]);

        return { statusCode: 200, body: JSON.stringify(merged) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

// cache-4a: ORDINARY class — edge invalidated via the fast lane in `revalidateTenantPaths()`
// (targeted, ~10s). No `withInvalidation()` wrapper.
// CACHE-10: `revalidateTenantPaths()` also arms the bulk `/*` lane (CDN_PENDING) so listings
// refresh ≤ ~16 min (bulk `/*` due ≤15 min after the first pending change — max wait) — the
// "GO LIVE NOW" banner therefore shows after this edit too.
export const handler = _handler;
