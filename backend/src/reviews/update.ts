import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { Review } from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";
import {
    promoteReviewImage,
    promotionAllowed,
    rollbackPromotedReviewImage,
    REVIEW_STAGING_PREFIX,
} from "../lib/review-media.js";

/**
 * PUT /reviews/{id} — the existing review moderation mutation, now carrying TWO actions on ONE
 * contract (rev-2a, REV2A-INFRA-SURFACE = option B, human-ratified 2026-08-08):
 *
 *   • DEFAULT (no `action`): the pre-existing field update — status/content/authorName/rating on
 *     a product review, keyed `REVIEW#<productId>#<id>`. Unchanged behaviour; existing callers
 *     (admin Reviews console) are untouched.
 *   • `action: "approve-image"`: the review-image approval that TRIGGERS the staged-media
 *     promotion (rev-2a spine). It rides THIS existing handler ADDITIVELY rather than a dedicated
 *     Lambda/route — one moderation action does not earn a new deployable unit (the standing
 *     no-new-infra-without-named-gain directive). Existing auth/roles (EDITOR/TENANT_ADMIN) apply.
 *   • `action: "hide-image"` (rev-3, REV3-IMG-HIDE-SCOPE = B, human-ratified 2026-08-08): the
 *     per-image counterpart to approve-image. A PURE status transition to `hidden` on the targeted
 *     entry — NO promotion, NO S3, NO assetKey rewrite. Removing an already-promoted (public) image
 *     from the site is the job of the public-list status filter (it emits only `status==="approved"`
 *     images), not an S3 delete — so hide is idempotent and side-effect-free. Same auth/roles.
 *
 * Why the image action lives behind a moderation mutation at all: the ratified spine
 * (plan-reviews-import header) is that the moderation gate governs the PUBLIC OBJECT, not merely
 * the render. Approving an image is the act that may copy a private staged ORIGINAL to the public
 * bucket (moderation-only pipeline, D-REV-4 SUPERSEDED — no byte-screen) — so approval MUST be
 * derived from the tenant-scoped review RECORD, never the client body (a caller cannot forge "the
 * review is approved" to force a private→public copy).
 */

// Bucket wiring for the approve-image path (unused by the default field update). Read at module
// load like the other handlers; the field-update path never dereferences them.
const PRIVATE_BUCKET = process.env.PRIVATE_BUCKET!;
const PUBLIC_BUCKET = process.env.UPLOADS_BUCKET!;
const PUBLIC_CDN_URL = process.env.UPLOADS_CDN_URL!;

// One S3 client for the rev-3 moderator VIEW path (presigned GET). The promotion path (S3 copy/
// head/delete) lives in lib/review-media.ts with its own client; this one only ever signs GETs.
const s3 = new S3Client({});

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;
// The event type from the AWS Handler, and the concrete result shape every path here returns. Typed
// single-arg (not the 3-arg AWS `Handler`) so the GET/PUT dispatcher can CALL the inner handlers
// with one arg and forbid the `void` the AWS callback-style `Handler` return admits — AWS invokes
// any `(event) => Promise<result>` function all the same.
type ApiEvent = Parameters<Handler>[0];
type ProxyResult = { statusCode: number; body: string };

// Untrusted body shape for BOTH per-image actions (approve-image / hide-image): the optional
// `action` discriminator plus the targeted `imageIndex`, over the review field allow-list. Named for
// the whole image-action family, not just approve, so the name matches every path that consumes it.
type ImageActionBody = Partial<Review> & { action?: string; imageIndex?: number };

const _handler = async (event: ApiEvent): Promise<ProxyResult> => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;
        const id = event.pathParameters?.id;

        // SECURITY: Editors and Tenant Admins allowed (same for both actions).
        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: "Missing review ID" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        // Type the untrusted body against the shared review contract (rev-1): `productId` and the
        // mutable allow-list below bind to `ReviewSchema` field names, so a schema rename breaks
        // this compile. Annotation only — no runtime validation added (that is a rev-2 change).
        const body = JSON.parse(event.body) as ImageActionBody;

        // ── ACTION DISCRIMINATOR ─────────────────────────────────────────────────────────────
        // Additive: an explicit `action` selects a per-image path (`approve-image` promotes;
        // `hide-image` is a pure status flip). Any body WITHOUT `action` keeps the original
        // field-update semantics — existing callers are unaffected.
        // NOTE: these are `return await …`, not bare `return …`. A bare `return promise` inside a
        // try block does NOT route the promise's REJECTION through this function's catch — the try
        // scope has already exited by the time it settles. `await` re-enters the try, so a rethrown
        // error from the action (e.g. a non-conditional final-update failure in approveReviewImage,
        // or the default path's `attribute_exists(SK)` miss) is mapped here to its intended status
        // (ConditionalCheckFailed → 404; anything else → 500) instead of escaping as a raw rejection.
        if (body.action === "approve-image") {
            return await approveReviewImage({ tenantId, id, body, auth });
        }
        if (body.action === "hide-image") {
            return await hideReviewImage({ tenantId, id, body });
        }

        return await updateReviewFields({ tenantId, id, body });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Internal error";
        if (e instanceof Error && e.name === "ConditionalCheckFailedException") {
            return { statusCode: 404, body: JSON.stringify({ error: "Review not found" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
};

/**
 * DEFAULT action — the pre-rev-2a field update. Behaviour is unchanged from before the
 * discriminator was introduced: a dynamic, allow-listed SET on a product review.
 */
async function updateReviewFields(args: {
    tenantId: string;
    id: string;
    body: Partial<Review>;
}) {
    const { tenantId, id, body } = args;
    const { productId } = body;

    // Sort key follows the rev-1 scope model (D-REV-5): a product review is keyed under its
    // product; a business (site-scope) review — the DEFAULT scope for bulk imports (rev-2b) — has
    // NO productId and lives under the DISJOINT `SITEREVIEW#` namespace. Mirrors the same routing
    // already used by the approve-image action above, so the moderation status transition
    // (pending → approved/hidden) works for BOTH scopes. Without this, an imported business review
    // surfaced in the list (list.ts) could never be approved — rev-2b finding #1.
    const sk = productId ? `REVIEW#${productId}#${id}` : `SITEREVIEW#${id}`;

    const now = new Date().toISOString();

    // Build dynamic update expression from allowed fields. Keys are constrained to `keyof Review`,
    // so the moderation mutable-field allow-list stays tied to the schema — if one of these field
    // names drifts out of `ReviewSchema`, this object fails to compile.
    const allowedFields = {
        status: "status",
        content: "content",
        authorName: "authorName",
        rating: "rating",
    } satisfies Partial<Record<keyof Review, string>>;

    const expressionParts: string[] = ["#updatedAt = :updatedAt"];
    const expressionNames: Record<string, string> = { "#updatedAt": "updatedAt" };
    const expressionValues: Record<string, unknown> = { ":updatedAt": now };

    const bodyByKey = body as Record<string, unknown>; // string-indexed view for the dynamic loop
    for (const [inputKey, dbKey] of Object.entries(allowedFields)) {
        const value = bodyByKey[inputKey];
        if (value !== undefined) {
            const placeholder = `:${inputKey}`;
            const nameToken = `#${inputKey}`;
            expressionParts.push(`${nameToken} = ${placeholder}`);
            expressionNames[nameToken] = dbKey;
            expressionValues[placeholder] = value;
        }
    }

    await db.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
            PK: `TENANT#${tenantId}`,
            SK: sk,
        },
        UpdateExpression: `SET ${expressionParts.join(", ")}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: "attribute_exists(SK)",
    }));

    return { statusCode: 200, body: JSON.stringify({ message: "Review updated" }) };
}

/**
 * `action: "approve-image"` — approve one review image and, iff the review is ALSO approved,
 * promote the staged ORIGINAL from the private quarantine to the public bucket, then rewrite the
 * entry's `assetKey` to the resulting PUBLIC key.
 *
 * Approval is DERIVED FROM THE ROW (never the client body). The entry's `assetKey` is a KEY, never
 * a URL (rev-1 ReviewImageSchema): pre-promotion it holds the private `.../original` staging key the
 * importer wrote; promotion rewrites it to the public asset key. The public URL is derived at
 * render via the existing asset-record/CDN pattern (`${CDN_URL}/${key}`), served raw — never
 * next/image (opennext-1 parking rule).
 */
async function approveReviewImage(args: {
    tenantId: string;
    id: string;
    body: ImageActionBody;
    auth: AuthorizerContext;
}) {
    const { tenantId, id, body, auth } = args;
    const { productId, imageIndex } = body;

    if (typeof imageIndex !== "number" || !Number.isInteger(imageIndex) || imageIndex < 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "imageIndex (non-negative integer) is required" }) };
    }

    // Sort key follows the rev-1 scope model: product reviews are keyed under the product; a
    // business-level (site-scope) review lives under the DISJOINT SITEREVIEW# namespace.
    const sk = productId ? `REVIEW#${productId}#${id}` : `SITEREVIEW#${id}`;

    const got = await db.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { PK: `TENANT#${tenantId}`, SK: sk } }),
    );
    const review = got.Item as (Review & Record<string, unknown>) | undefined;
    if (!review) return { statusCode: 404, body: JSON.stringify({ error: "Review not found" }) };

    const images = Array.isArray(review.images) ? review.images : [];
    if (imageIndex >= images.length) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: `imageIndex ${imageIndex} out of range (review has ${images.length} image(s))` }),
        };
    }

    // The exact entry state we base this transition on. The concurrency guard below pins BOTH of
    // these at write time, so any concurrent modification of this entry makes our update fail.
    const priorImageStatus: string = images[imageIndex].status;
    const priorAssetKey: string = images[imageIndex].assetKey;
    const priorIsStaging =
        typeof priorAssetKey === "string" && priorAssetKey.startsWith(`${REVIEW_STAGING_PREFIX}${tenantId}/`);

    // TRANSITION RULE (CYCLE-3): approve-image performs EXACTLY the image-entry edge
    // pending → approved. Every other prior status is refused, so the promotion has ONE entry
    // point and a moderated-out image can never be silently promoted:
    //   • approved + already-promoted (public key)  → idempotent no-op 200 (the clean repeat call),
    //     distinct from losing a concurrent race (which fails the guard below → 409);
    //   • approved + still-staging / hidden / any other → 409 (not an approvable pending entry).
    if (priorImageStatus !== "pending") {
        if (priorImageStatus === "approved" && !priorIsStaging) {
            return { statusCode: 200, body: JSON.stringify({ message: "Image already approved", promoted: false }) };
        }
        return {
            statusCode: 409,
            body: JSON.stringify({
                error: `image is not pending (status="${priorImageStatus}"); only a pending image can be approved`,
            }),
        };
    }

    // ORDERING GATE (rev-2a revise-2, review-1 fix): the review RECORD must ALREADY be approved
    // before ANY of its images can be approved. Without this gate, approve-image on a still-pending
    // review would flip the image to `approved` while promotion is skipped (promotion needs review
    // approved) — leaving an approved image stuck on its PRIVATE staging key: a later status→approved
    // never promotes, and a later approve-image is refused (no longer pending). That dead state is
    // permanently unpromotable. Refusing here makes the contract strict: approve the review first
    // (default field-update path, status→approved), THEN approve its images — so every accepted
    // approve-image on a staging entry DOES promote. Approval stays derived from the row, never the
    // body. (409, not 200 no-op: the request is well-formed but out of order — the image entry is
    // untouched, so a retry after the review is approved succeeds.)
    if (review.status !== "approved") {
        return {
            statusCode: 409,
            body: JSON.stringify({
                error: `review is not approved (status="${review.status}"); approve the review before approving its images`,
            }),
        };
    }

    // (a) Promotion — permitted ONLY when the RECORD says the review is approved (not the client),
    // and only from a private staging key (a public key = already promoted → idempotent no-op).
    let promoted = false;
    let publicUrl: string | undefined;
    let promotedAssetKey: string | undefined;
    let promotedAssetId: string | undefined;
    if (promotionAllowed(review.status, "approved") && priorIsStaging) {
        const res = await promoteReviewImage({
            tenantId,
            sourceStagingKey: priorAssetKey,
            reviewStatus: review.status,
            imageStatus: "approved",
            uploadedBy: auth.email || auth.sub,
            privateBucket: PRIVATE_BUCKET,
            publicBucket: PUBLIC_BUCKET,
            publicCdnUrl: PUBLIC_CDN_URL,
            tableName: TABLE_NAME,
        });
        if (!res.promoted) {
            // Promotion refused (e.g. the staged original is gone/expired, or an untyped object).
            // Do NOT persist an "approved" image with no public object behind it — surface it so the
            // caller retries once the staged original is present.
            return { statusCode: 502, body: JSON.stringify({ error: `Promotion failed: ${res.reason}` }) };
        }
        promoted = true;
        publicUrl = res.publicUrl;
        promotedAssetKey = res.assetKey;
        promotedAssetId = res.assetId;
    }

    // (b) Persist under a PER-IMAGE OPTIMISTIC-CONCURRENCY GUARD, writing ONLY the targeted entry's
    // OWN document paths — `images[index].status` (→ approved) and, when promoted,
    // `images[index].assetKey` (→ the public key) — NEVER the whole `images` array.
    //
    // review-4 fix: a full-array `SET #images = :images` write, even under a per-INDEX condition,
    // is a last-writer-wins overwrite of every sibling entry. Two approvals of DIFFERENT indices
    // each read the same snapshot, each pass their own index's condition (the other index is
    // untouched), and the second write restores the first's entry to its stale pending/staging
    // snapshot — orphaning the first promotion's public object + asset record. Updating only the
    // targeted element's document paths touches DISJOINT attributes across indices, so DynamoDB
    // applies concurrent distinct-index approvals independently — no clobber, no orphan.
    //
    // The condition still pins the targeted entry to EXACTLY what we read — its `status` AND its
    // `assetKey` — plus the review's own `status`, so per-image idempotency holds: two concurrent
    // approvals of the SAME image both read (pending, staging) and both copy, but only the FIRST
    // commits; the second's condition no longer matches (status flipped to approved / assetKey
    // flipped to the public key) → ConditionalCheckFailedException → we ROLL BACK the loser's
    // copied public object (+ its asset record). Pinning the review status also catches an
    // un-approve that raced between our read and here.
    const now = new Date().toISOString();
    const setParts = [`#images[${imageIndex}].#status = :approvedImageStatus`, "#updatedAt = :updatedAt"];
    const expressionValues: Record<string, unknown> = {
        ":approvedImageStatus": "approved",
        ":updatedAt": now,
        ":priorImageStatus": priorImageStatus,
        ":priorAssetKey": priorAssetKey,
        ":reviewStatus": review.status,
    };
    if (promoted && promotedAssetKey) {
        // Only a promoted image rewrites its assetKey (staging → public). A non-promoted approval
        // (already-public pending edge) leaves assetKey as-is.
        setParts.push(`#images[${imageIndex}].#assetKey = :newAssetKey`);
        expressionValues[":newAssetKey"] = promotedAssetKey;
    }
    try {
        await db.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: sk },
                UpdateExpression: `SET ${setParts.join(", ")}`,
                ExpressionAttributeNames: {
                    "#images": "images",
                    "#updatedAt": "updatedAt",
                    "#status": "status",
                    "#assetKey": "assetKey",
                },
                ExpressionAttributeValues: expressionValues,
                ConditionExpression:
                    `attribute_exists(SK) ` +
                    `AND #images[${imageIndex}].#status = :priorImageStatus ` +
                    `AND #images[${imageIndex}].#assetKey = :priorAssetKey ` +
                    `AND #status = :reviewStatus`,
            }),
        );
    } catch (e: unknown) {
        // COMPENSATE FOR EVERY POST-COPY FAILURE (rev-2a review-3), not just the conditional-loss
        // path. Once `promoteReviewImage` has copied the public object + written its ASSET# record,
        // ANY failure of this final entry update — a lost concurrency race (ConditionalCheckFailed)
        // OR a non-conditional error (throttle, network, IAM, malformed item) — would otherwise
        // leave that public object + record ORPHANED: live in public with no currently-approved
        // review row pointing at it. That breaks the spine's public/private-boundary invariant.
        // `rollbackPromotedReviewImage` is best-effort per step (never throws), so it cannot mask
        // the original error nor turn a 500 into a rollback failure.
        if (promoted && promotedAssetKey && promotedAssetId) {
            await rollbackPromotedReviewImage({
                tenantId,
                publicBucket: PUBLIC_BUCKET,
                assetKey: promotedAssetKey,
                assetId: promotedAssetId,
                tableName: TABLE_NAME,
            });
        }
        if (e instanceof Error && e.name === "ConditionalCheckFailedException") {
            // 409: the entry changed under us (concurrent approval, un-approve, or delete). The
            // promoted object (if any) has just been rolled back — no partial public state remains.
            return {
                statusCode: 409,
                body: JSON.stringify({ error: "Review changed during moderation; no update applied" }),
            };
        }
        // Any other final-update failure: rollback done above, now preserve the original 500
        // semantics (rethrown to the outer handler, which maps it to HTTP 500).
        throw e;
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Image approved", promoted, ...(publicUrl ? { publicUrl } : {}) }),
    };
}

/**
 * `action: "hide-image"` — moderate ONE review image OUT of the public site (rev-3,
 * REV3-IMG-HIDE-SCOPE = B). The per-image counterpart to approve-image, deliberately the MINIMAL
 * mirror: it sets the targeted entry's `status` to `hidden` and does NOTHING ELSE.
 *
 *   • NO promotion, NO S3, NO assetKey rewrite. The entry's key is left exactly as-is.
 *   • For an already-promoted (public-key) image, "hidden" is enough to remove it from the site:
 *     `public-list.ts` emits ONLY `status==="approved"` images, so a hidden entry stops appearing
 *     with no object mutation. (The public bytes remain retrievable by direct CDN URL — that is the
 *     ratified minimal-action consequence; a public-object GC is deliberately out of this slice.)
 *   • Terminal w.r.t. approval: approve-image accepts only pending→approved (CYCLE-3), so a hidden
 *     image is NOT re-approvable through that action — consistent with the existing contract.
 *
 * Allowed transitions: pending→hidden and approved→hidden. `hidden` is an idempotent no-op 200.
 * Persisted under the SAME per-image optimistic-concurrency guard as approve-image (pin the
 * targeted entry's prior `status` on its OWN document path), so a hide racing an approve of the same
 * index loses cleanly (409) and concurrent DISTINCT-index writes never clobber. No review-level
 * status gate: unlike approve (which needs an approved review to promote), hiding an image is
 * always permitted — a moderator can pull any photo regardless of the review's own status.
 */
async function hideReviewImage(args: {
    tenantId: string;
    id: string;
    body: ImageActionBody;
}) {
    const { tenantId, id, body } = args;
    const { productId, imageIndex } = body;

    if (typeof imageIndex !== "number" || !Number.isInteger(imageIndex) || imageIndex < 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "imageIndex (non-negative integer) is required" }) };
    }

    // Same scope-routing as every other path (rev-1 D-REV-5).
    const sk = productId ? `REVIEW#${productId}#${id}` : `SITEREVIEW#${id}`;

    const got = await db.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { PK: `TENANT#${tenantId}`, SK: sk } }),
    );
    const review = got.Item as (Review & Record<string, unknown>) | undefined;
    if (!review) return { statusCode: 404, body: JSON.stringify({ error: "Review not found" }) };

    const images = Array.isArray(review.images) ? review.images : [];
    if (imageIndex >= images.length) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: `imageIndex ${imageIndex} out of range (review has ${images.length} image(s))` }),
        };
    }

    const priorImageStatus: string = images[imageIndex].status;

    // Idempotent no-op — already hidden. Distinct from a lost race (no write attempted).
    if (priorImageStatus === "hidden") {
        return { statusCode: 200, body: JSON.stringify({ message: "Image already hidden", changed: false }) };
    }

    // PER-IMAGE OPTIMISTIC-CONCURRENCY GUARD on the targeted element's OWN status path only — never
    // the whole `images` array (the review-4 clobber fix), so concurrent distinct-index writes touch
    // disjoint attributes. The condition pins the entry's prior `status`: a hide racing a same-index
    // approve (which also flips status) → the loser's condition no longer matches → 409, no clobber.
    const now = new Date().toISOString();
    try {
        await db.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: sk },
                UpdateExpression: `SET #images[${imageIndex}].#status = :hiddenImageStatus, #updatedAt = :updatedAt`,
                ExpressionAttributeNames: {
                    "#images": "images",
                    "#status": "status",
                    "#updatedAt": "updatedAt",
                },
                ExpressionAttributeValues: {
                    ":hiddenImageStatus": "hidden",
                    ":updatedAt": now,
                    ":priorImageStatus": priorImageStatus,
                },
                ConditionExpression:
                    `attribute_exists(SK) AND #images[${imageIndex}].#status = :priorImageStatus`,
            }),
        );
    } catch (e: unknown) {
        if (e instanceof Error && e.name === "ConditionalCheckFailedException") {
            // The entry changed under us (concurrent approve/hide, or the row was deleted). No S3 or
            // asset side effects to compensate — hide is pure. 409 (not the outer catch's 404) so the
            // message is accurate: the request was well-formed but raced.
            return {
                statusCode: 409,
                body: JSON.stringify({ error: "Review changed during moderation; no update applied" }),
            };
        }
        throw e;
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Image hidden", changed: true, previousStatus: priorImageStatus }),
    };
}

/**
 * GET /reviews/{id}/image-view-url?imageIndex=N[&productId=…] — the rev-3 MODERATOR VIEW path.
 *
 * Why it exists: the moderation UI must show a thumbnail of each image BEFORE it is approved, but
 * a pending image is a PRIVATE staged original (`review-staging/<tenant>/…/original`) in a bucket
 * with BlockPublicAccess.BLOCK_ALL and no CloudFront origin (rev-2a). So the UI cannot build a URL
 * for it — it must be handed a short-lived presigned GET. This mirrors the existing presign pattern
 * (`resources/presign.ts` downloadHandler: `getSignedUrl(GetObjectCommand, { expiresIn: 300 })`),
 * riding THIS existing handler/Lambda rather than a new deployable unit — updateReviewFunc already
 * carries `PRIVATE_BUCKET`, `s3:GetObject` on `review-staging/*`, and `UPLOADS_CDN_URL` (rev-2a
 * composition-root wiring), so it needs ZERO new grants. The ONLY infra is the route (api-commerce).
 *
 * It is a READ. It is routed on the GET method precisely so it does NOT pass through
 * `withInvalidation` — minting a view URL must not mark the CDN pending or raise the "GO LIVE NOW"
 * banner (that is a mutation side effect; a thumbnail view is not a mutation).
 *
 * Two cases, discriminated on the entry's `assetKey` READ FROM THE TENANT-SCOPED ROW (never the
 * client), same trust rule as promotion:
 *   • staged private original (key under THIS tenant's `review-staging/<tenant>/` quarantine) →
 *     presigned GET on the PRIVATE bucket. The tenant-prefix check means we only ever sign this
 *     tenant's own quarantined object.
 *   • already-promoted PUBLIC object → its CDN URL (already public; no signing needed).
 */
async function viewImageUrl(event: ApiEvent): Promise<ProxyResult> {
    const tenantId = event.headers["x-tenant-id"];
    const auth = event.requestContext.authorizer.lambda;
    const id = event.pathParameters?.id;

    try {
        requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
    } catch (e: any) {
        return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
    }

    if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: "Missing review ID" }) };

    const q = event.queryStringParameters ?? {};
    const imageIndex = Number(q.imageIndex);
    if (!Number.isInteger(imageIndex) || imageIndex < 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "imageIndex (non-negative integer) query param is required" }) };
    }
    const productId = q.productId;

    // Same scope-routing as the mutation paths (rev-1 D-REV-5): product review under its product,
    // business (site-scope) review under the DISJOINT SITEREVIEW# namespace.
    const sk = productId ? `REVIEW#${productId}#${id}` : `SITEREVIEW#${id}`;

    const got = await db.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { PK: `TENANT#${tenantId}`, SK: sk } }),
    );
    const review = got.Item as (Review & Record<string, unknown>) | undefined;
    if (!review) return { statusCode: 404, body: JSON.stringify({ error: "Review not found" }) };

    const images = Array.isArray(review.images) ? review.images : [];
    if (imageIndex >= images.length) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: `imageIndex ${imageIndex} out of range (review has ${images.length} image(s))` }),
        };
    }

    const assetKey = images[imageIndex].assetKey;
    const imageStatus = images[imageIndex].status;

    if (typeof assetKey === "string" && assetKey.startsWith(`${REVIEW_STAGING_PREFIX}${tenantId}/`)) {
        // Pending/quarantined original — sign a private GET so the moderator can preview it.
        const viewUrl = await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: PRIVATE_BUCKET, Key: assetKey }),
            { expiresIn: 300 },
        );
        return { statusCode: 200, body: JSON.stringify({ viewUrl, kind: "staged", status: imageStatus }) };
    }

    // Promoted (approved) image — already a public asset key; derive the CDN URL (assets/create.ts
    // pattern), served raw, never next/image (opennext-1 parking rule).
    return {
        statusCode: 200,
        body: JSON.stringify({ viewUrl: `${PUBLIC_CDN_URL}/${assetKey}`, kind: "public", status: imageStatus }),
    };
}

const _mutationHandler = withInvalidation(_handler);

/**
 * Route split for the ONE reviews-update Lambda (rev-3): the GET view route bypasses
 * `withInvalidation` (read, no CDN marker); PUT keeps the unchanged mutation+invalidation path.
 * The GET route carries method "GET"; PUT (and the unit tests that omit method) fall through to the
 * mutation handler.
 */
export const handler = async (event: ApiEvent): Promise<ProxyResult> => {
    if (event.requestContext.http?.method === "GET") {
        try {
            return await viewImageUrl(event);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Internal error";
            return { statusCode: 500, body: JSON.stringify({ error: message }) };
        }
    }
    return _mutationHandler(event);
};
