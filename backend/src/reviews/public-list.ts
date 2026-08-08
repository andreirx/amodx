import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { Review, ReviewImage } from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { REVIEW_STAGING_PREFIX } from "../lib/review-media.js";

/**
 * The stored fields this public handler reads (see the ProjectionExpression below), derived from
 * `Review` (rev-1) so the projected shape stays tied to the shared contract — a field rename in
 * `ReviewSchema` breaks this compile instead of silently dropping the field from the public payload.
 *
 * rev-3 deep-vertical: `images` is now projected so an approved review's APPROVED (promoted) photos
 * become visible in the public payload. The renderer gallery is rev-4; this handler only exposes the
 * data — the proof the moderation pipeline reaches the public boundary.
 */
type StoredReviewItem = Pick<Review, "id" | "authorName" | "rating" | "content" | "source" | "createdAt" | "images">;

/** One image in the PUBLIC payload — a public asset KEY (+ optional alt), never a private key. */
type PublicReviewImage = Pick<ReviewImage, "assetKey"> & { alt?: string };

/** The public review DTO. `images` carries ONLY approved+public photos (see the filter below). */
type PublicReviewItem = Pick<Review, "id" | "authorName" | "rating" | "content" | "source" | "createdAt"> & {
    images: PublicReviewImage[];
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const productId = event.pathParameters?.productId;
        if (!productId) return { statusCode: 400, body: JSON.stringify({ error: "Missing productId" }) };

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "#s = :approved",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `REVIEW#${productId}#`,
                ":approved": "approved"
            },
            ExpressionAttributeNames: { "#s": "status" },
            ProjectionExpression: "id, authorName, rating, content, source, createdAt, images"
        }));

        const rows = ((result.Items ?? []) as StoredReviewItem[]).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        // PUBLIC-BOUNDARY FILTER (rev-3): the review is already status=approved, but WITHIN it only
        // APPROVED images have been promoted to the public bucket — pending/hidden images still hold
        // their PRIVATE `review-staging/` key. Expose ONLY images that are (a) approved AND (b) not on
        // a staging key. (b) is defense-in-depth: an approved image always carries a promoted public
        // key, but should a stray (approved + staging) entry ever exist, this guarantees a private
        // quarantine key can NEVER leak into a public response. Ties to the single-source prefix
        // constant so it cannot silently drift from the quarantine namespace.
        const items: PublicReviewItem[] = rows.map((r) => ({
            id: r.id,
            authorName: r.authorName,
            rating: r.rating,
            content: r.content,
            source: r.source,
            createdAt: r.createdAt,
            images: (Array.isArray(r.images) ? r.images : [])
                .filter(
                    (img) =>
                        img.status === "approved" &&
                        typeof img.assetKey === "string" &&
                        !img.assetKey.startsWith(REVIEW_STAGING_PREFIX),
                )
                .map((img) => ({ assetKey: img.assetKey, ...(img.alt ? { alt: img.alt } : {}) })),
        }));

        // Calculate average rating
        const totalReviews = items.length;
        const averageRating = totalReviews > 0
            ? Math.round((items.reduce((sum: number, r) => sum + (r.rating || 0), 0) / totalReviews) * 10) / 10
            : 0;

        return {
            statusCode: 200,
            headers: { "Cache-Control": "public, max-age=60" },
            body: JSON.stringify({ items, averageRating, totalReviews })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
