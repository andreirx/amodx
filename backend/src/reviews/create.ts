import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { Review } from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const _handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        // SECURITY: Editors and Tenant Admins allowed
        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };
        if (!event.body) return { statusCode: 400, body: "Missing Body" };

        // Type the untrusted request body against the shared review contract (rev-1): the
        // destructure below now binds field NAMES to `ReviewSchema`, so a schema rename breaks
        // this compile. Partial<Review> — the client sends a subset; this is a type annotation
        // only, NOT runtime validation (adding validation would be a behavior change; deferred
        // to rev-2, tracked in docs/TECH-DEBT.md § "Review `source` enum defects").
        const body = JSON.parse(event.body) as Partial<Review>;

        const { productId, source, authorName, rating, content, googleReviewId, status } = body;

        if (!productId || !authorName || rating === undefined) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields: productId, authorName, rating" }) };
        }

        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `REVIEW#${productId}#${id}`,
                id,
                tenantId,
                productId,
                // KNOWN DEFECT (F-REV1-x, deferred to a future validate-on-write slice): this
                // write bypasses Zod. It persists "manual" when `source` is omitted — a value the
                // pre-rev-1 schema rejected, so ReviewSchema was WIDENED to admit it (it is now a
                // legacy enum member). "manual" should NOT be the source of a new review; the
                // fix is to validate the body with ReviewSchema and default `source` to
                // "internal". Left unchanged here — REV-IMPL-1 is types-only, no behavior change.
                // See docs/TECH-DEBT.md § "Review `source` enum defects".
                source: source || "manual",
                authorName,
                rating,
                content: content || "",
                googleReviewId: googleReviewId || null,
                status: status || "pending",
                createdAt,
                Type: "Review"
            }
        }));

        return { statusCode: 201, body: JSON.stringify({ id, message: "Review created" }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

export const handler = withInvalidation(_handler);
