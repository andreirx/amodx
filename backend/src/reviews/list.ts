import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { Review } from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

/**
 * Exactly the fields this handler projects from DynamoDB (see the ProjectionExpression below).
 * Deriving it from `Review` (rev-1) ties the projected shape to the shared contract: a rename of
 * any of these fields in `ReviewSchema` breaks this compile — the § 2.1 "projection silently
 * drops a field" risk becomes a type error. Type annotation only; no query/behavior change.
 *
 * `scope` is projected so the admin moderation UI can distinguish a business (site) review from a
 * product review even when `productId` is absent, and route the subsequent approve/delete call to
 * the correct sort-key namespace (rev-1 D-REV-5).
 *
 * rev-3 adds two projected fields the moderation UI needs and nothing else read before:
 *   • `images` — the per-image METADATA array (assetKey + per-image status; rev-1 ReviewImageSchema).
 *     The moderation UI renders per-image approve tiles and their disposition from it. Bounded by
 *     MAX_REVIEW_IMAGES (~12 entries, ~2 KB each), so it stays well within the projected-item size.
 *   • `importBatchId` — so the UI can filter reviews by import batch (set only on imported reviews).
 * Both are additive to the SAME PK+begins_with Query — no new capability, no Scan.
 */
type ReviewListItem = Pick<
    Review,
    "id" | "productId" | "scope" | "authorName" | "rating" | "content" | "source" | "status" | "createdAt" | "images" | "importBatchId"
>;

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const PROJECTION = "id, productId, #sc, authorName, rating, content, source, #s, createdAt, images, importBatchId";
const NAMES = { "#s": "status", "#sc": "scope" } as const;

async function queryPrefix(tenantId: string, prefix: string): Promise<ReviewListItem[]> {
    const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": prefix },
        ProjectionExpression: PROJECTION,
        ExpressionAttributeNames: NAMES,
        ScanIndexForward: false,
    }));
    return (result.Items ?? []) as ReviewListItem[];
}

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        // SECURITY: Editors allowed
        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const productId = event.queryStringParameters?.productId;

        // rev-2b finding #1 — the moderation list must surface BOTH namespaces. Product reviews live
        // under `REVIEW#<productId>#`; business (site-scope) reviews — the DEFAULT scope for bulk
        // imports (rev-2b) — live under the DISJOINT `SITEREVIEW#` prefix (rev-1 D-REV-5), which does
        // NOT match `begins_with(SK, "REVIEW#")`. So an unfiltered moderation list runs TWO
        // PK+begins_with queries (never a Scan) and merges them; a productId filter stays a single
        // targeted product query. Both are `QueryCommand` on `PK`+`SK` — the no-Scan rule holds.
        let items: ReviewListItem[];
        if (productId) {
            items = await queryPrefix(tenantId, `REVIEW#${productId}#`);
        } else {
            const [productReviews, siteReviews] = await Promise.all([
                queryPrefix(tenantId, "REVIEW#"),
                queryPrefix(tenantId, "SITEREVIEW#"),
            ]);
            // Merge and re-establish the newest-first order the single-query path returns (each
            // query is already sorted, but the two streams interleave by createdAt).
            items = [...productReviews, ...siteReviews].sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            );
        }

        return { statusCode: 200, body: JSON.stringify({ items }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
