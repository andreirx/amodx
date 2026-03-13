import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

/**
 * System endpoints for cache invalidation status and manual flush ("GO LIVE NOW").
 *
 * GET  /system/invalidation → Returns pending status + countdown
 * POST /system/invalidation → Immediate flush (clears marker + fires CloudFront invalidation)
 *
 * Both require GLOBAL_ADMIN or TENANT_ADMIN role.
 */

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const CDN_PENDING_PK = "SYSTEM";
const CDN_PENDING_SK = "CDN_PENDING";
const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_WINDOW_MS || "900000", 10); // 15 min

const cf = new CloudFrontClient({});
const distributionId = process.env.RENDERER_DISTRIBUTION_ID;

/**
 * GET /system/invalidation
 *
 * Returns:
 *   { pending: false }
 * or:
 *   { pending: true, lastChangeAt: "2026-03-13T18:30:00.000Z", goLiveAt: "2026-03-13T18:45:00.000Z" }
 */
export const statusHandler: Handler = async (event) => {
    try {
        const tenantId = event.headers["x-tenant-id"];
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        }

        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: CDN_PENDING_PK, SK: CDN_PENDING_SK },
        }));

        if (!result.Item) {
            return {
                statusCode: 200,
                body: JSON.stringify({ pending: false }),
            };
        }

        const updatedAt = result.Item.updatedAt as number;
        const goLiveAt = updatedAt + DEBOUNCE_MS;

        return {
            statusCode: 200,
            body: JSON.stringify({
                pending: true,
                lastChangeAt: new Date(updatedAt).toISOString(),
                goLiveAt: new Date(goLiveAt).toISOString(),
            }),
        };
    } catch (error: any) {
        if (error.statusCode) throw error;
        console.error("[InvalidationStatus] Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
    }
};

/**
 * POST /system/invalidation
 *
 * "GO LIVE NOW" — fires immediate CloudFront /* invalidation and clears the marker.
 */
export const flushHandler: Handler = async (event) => {
    try {
        const tenantId = event.headers["x-tenant-id"];
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        }

        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN"], tenantId);

        // 1. Fire CloudFront invalidation
        if (distributionId) {
            await cf.send(new CreateInvalidationCommand({
                DistributionId: distributionId,
                InvalidationBatch: {
                    CallerReference: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    Paths: {
                        Quantity: 1,
                        Items: ["/*"],
                    },
                },
            }));
            console.log("[InvalidationFlush] CloudFront /* invalidation submitted (manual)");
        } else {
            console.warn("[InvalidationFlush] RENDERER_DISTRIBUTION_ID not set");
        }

        // 2. Delete marker (unconditional — admin wants it gone now)
        try {
            await db.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: { PK: CDN_PENDING_PK, SK: CDN_PENDING_SK },
            }));
        } catch (deleteErr) {
            // Marker may not exist — that's fine
            console.log("[InvalidationFlush] Marker delete:", deleteErr);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ flushed: true }),
        };
    } catch (error: any) {
        if (error.statusCode) throw error;
        console.error("[InvalidationFlush] Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
    }
};
