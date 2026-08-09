import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { zipSync } from "fflate";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { resolveStagingContext, type StagingContext } from "./support/staging-admin";

/**
 * TEST-5 — DEPLOYED-STAGING e2e for the review import → moderate → display flow.
 *
 * WHAT IT PROVES (the gap the fixture unit test cannot close). review-import-fixture.test.ts drives
 * the SAME import handler with S3/DDB MOCKED — it proves the logic, not that the flow survives real
 * AWS auth/IAM/S3 and DynamoDB reserved-keyword enforcement. This suite runs the real round-trip
 * against DEPLOYED staging and asserts the things only real AWS can show, in the REAL LIFECYCLE ORDER:
 *
 *   1. the private→public MODERATION BOUNDARY: an imported image is staged PRIVATE (not fetchable via
 *      the public CDN) and only reaches the public CDN after a human approves BOTH the review and the
 *      image — with a same-detector positive control so the "not fetchable" assertion can't false-pass;
 *   2. tenant ISOLATION on the STAGED (pre-promotion, PENDING) image — the real gap (revise-3):
 *      promotion rewrites the key to public, so isolating only the promoted row would miss the window
 *      that matters. While the image is still a PRIVATE staged original, tenant B must be unable to
 *      presign-view it (no `image-view-url`) NOR approve/promote it (no cross-tenant copy to public).
 *      The owner (tenant A) doing the same successfully is the same-detector positive control. The
 *      pre-cache post-promotion row isolation stays as a SECOND assertion (test 3 tail);
 *   3. the real DynamoDB PROJECTION on /public/reviews/{productId} — the layer that hid the reserved
 *      -keyword `source` 500 from the mocked unit test. We assert `source` comes back on the wire.
 *
 * Plus MANDATORY cleanup (shared staging → leave no orphans): a NAMESPACE SWEEP of both per-run tenant
 * partitions + S3 key prefixes (so failure-path residue is caught, not just the ids the import surfaced)
 * whose post-cleanup verification is an ASSERTION — any namespace that still has a residual item, or a
 * count we cannot obtain, turns the run RED (revise-2 + review-1). Shared staging tolerates no silent orphan.
 *
 * NOT A DEFAULT GATE. Requires live shared-staging AWS state + secrets, so it is gated behind
 * STAGING_E2E=1 and self-skips otherwise (testing-strategy.md: such a suite is never the
 * credential-free gate). Run on-demand / pre-deploy, or via the manual `workflow_dispatch` CI job
 * (.github/workflows/staging-e2e.yml) — see the run command in the docs.
 *
 * SECRETS: the token/password/api-key are never logged. The transcript logs ids, keys, statuses,
 * and HTTP codes only.
 */

const RUN = process.env.STAGING_E2E === "1";
test.describe.configure({ mode: "serial" }); // one stateful chain; also avoids racing the app-client toggle

// Unique throwaway tenants per run. The suffix must be COLLISION-RESISTANT, not merely time-ordered:
// two manual `workflow_dispatch` jobs can start in the same millisecond, so a `Date.now()` suffix would
// let them pick the SAME namespaces and have their cleanup sweeps (below) delete each other's data on
// shared staging. A random UUID makes each run's tenant partitions + S3 prefixes globally distinct
// (review-5). Both tenants and the product share ONE `runId` so the whole run lives under one namespace.
const runId = randomUUID();
const tenantA = `e2e-rev-a-${runId}`;
const tenantB = `e2e-rev-b-${runId}`;
const productId = `prod-e2e-${runId}`;

// The private staging-bucket key prefix (backend `REVIEW_STAGING_PREFIX`, review-media.ts). Kept as a
// literal here (test package does not import backend) but named so the assertion and the cleanup
// namespace sweep below share ONE source and cannot drift apart.
const STAGING_PREFIX = "review-staging/";

// A genuine 1x1 PNG (real image bytes, per slice) so the promoted public object is a real image.
const PNG_1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42m-8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
);

// Module-scope so afterAll can clean up whatever setup/tests created, even on mid-flow failure.
let ctx: StagingContext;
let ddb: DynamoDBDocumentClient;
let s3: S3Client;
const created = {
    batchId: "" as string,
    reviewId: "" as string,
    stagedKey: "" as string,
    publicKey: "" as string,
    assetId: "" as string,
};

/** Transcript logger — the run's stdout IS the packet's output artifact. */
function log(m: string) {
    // eslint-disable-next-line no-console
    console.log(m);
}

// The parent-stack authorizer's `identitySource` requires BOTH `Authorization` AND `x-api-key` to be
// PRESENT, or API Gateway returns 401 without invoking the authorizer (this is why the other e2e
// specs always send both headers). We send a present-but-DELIBERATELY-NON-MATCHING x-api-key so the
// authorizer falls THROUGH the master/renderer-key checks to Cognito JWT verification and uses our
// real user token — the master key itself would authenticate as the emailless system-robot, which
// the import handler's attestation identity gate 403s. The value only needs to differ from the
// master/renderer keys; it is never a secret.
const DUMMY_API_KEY = "e2e-test5-force-jwt-path-not-a-real-key";

function adminHeaders(tenant: string) {
    return { "x-tenant-id": tenant, authorization: `Bearer ${ctx.idToken}`, "x-api-key": DUMMY_API_KEY };
}

/** Same-detector CDN probe used for BOTH the absence assertion and its positive control. */
async function cdnStatus(req: APIRequestContext, url: string): Promise<number> {
    const r = await req.get(url, { headers: { "cache-control": "no-cache" } });
    return r.status();
}

/** GET the moderator image-view-url for a given tenant scope. Returns the raw APIResponse. */
function imageViewUrl(req: APIRequestContext, tenant: string) {
    return req.get(
        `${ctx.apiUrl}/reviews/${created.reviewId}/image-view-url?imageIndex=0&productId=${productId}`,
        { headers: adminHeaders(tenant) },
    );
}

/** PUT approve-image for a given tenant scope. Returns the raw APIResponse. */
function approveImage(req: APIRequestContext, tenant: string) {
    return req.put(`${ctx.apiUrl}/reviews/${created.reviewId}`, {
        headers: adminHeaders(tenant),
        data: { action: "approve-image", productId, imageIndex: 0 },
    });
}

// ── CLEANUP NAMESPACE (revise-1 #2 / review-1 #2) ─────────────────────────────────────────────────
// The per-run tenants (`e2e-rev-{a,b}-<runId>`, runId = a random UUID) are unique, so EVERY DynamoDB item under their
// partition and EVERY S3 object under their key prefixes belongs to THIS run. Sweeping by namespace —
// not by the ids the import RESPONSE happened to surface — is what makes cleanup complete on the
// failure paths: a batch/staged object written before a mid-import failure, or a rejected-row partial,
// still lives under these namespaces and is found. DDB uses a single-partition Query (PK=TENANT#<t>) —
// scoped, NOT a Scan (no-scan rule holds); S3 uses ListObjectsV2 bounded to this run's prefixes.

/** Every (bucket, prefix, label) this run can create objects under. Staged→private, promoted→public. */
function s3Namespaces(): [string, string, string][] {
    return [
        [ctx.privateBucket, `${STAGING_PREFIX}${tenantA}/`, `private ${STAGING_PREFIX}${tenantA}/`],
        [ctx.privateBucket, `${STAGING_PREFIX}${tenantB}/`, `private ${STAGING_PREFIX}${tenantB}/`],
        [ctx.publicBucket, `${tenantA}/`, `public ${tenantA}/`],
        [ctx.publicBucket, `${tenantB}/`, `public ${tenantB}/`],
    ];
}

/** Delete every item in one tenant partition (paginated single-PK Query — NOT a Scan). */
async function ddbDeletePartition(tenant: string): Promise<void> {
    let start: Record<string, unknown> | undefined;
    do {
        const page = await ddb.send(new QueryCommand({
            TableName: ctx.tableName,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenant}` },
            ProjectionExpression: "PK, SK",
            ExclusiveStartKey: start,
        }));
        for (const it of page.Items ?? []) {
            await ddb.send(new DeleteCommand({ TableName: ctx.tableName, Key: { PK: it.PK, SK: it.SK } }));
        }
        start = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (start);
}

/** Count items remaining in one tenant partition (verification assertion). */
async function ddbCountPartition(tenant: string): Promise<number> {
    let count = 0;
    let start: Record<string, unknown> | undefined;
    do {
        const page = await ddb.send(new QueryCommand({
            TableName: ctx.tableName,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenant}` },
            Select: "COUNT",
            ExclusiveStartKey: start,
        }));
        count += page.Count ?? 0;
        start = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (start);
    return count;
}

/** Delete every object under one bucket/prefix (paginated, batched delete). */
async function s3DeletePrefix(bucket: string, prefix: string): Promise<void> {
    let token: string | undefined;
    do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        const objs = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k).map((Key) => ({ Key }));
        if (objs.length) {
            await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objs, Quiet: true } }));
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
}

/** Count objects remaining under one bucket/prefix (verification assertion). */
async function s3CountPrefix(bucket: string, prefix: string): Promise<number> {
    let count = 0;
    let token: string | undefined;
    do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        count += page.KeyCount ?? (page.Contents?.length ?? 0);
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return count;
}

test.describe("TEST-5 deployed-staging review round-trip", () => {
    test.skip(!RUN, "staging-mutating: set STAGING_E2E=1 (needs .env.test + AWS creds) to run");
    // API-level round-trip: the browser is irrelevant (auth goes through the direct
    // staging-admin helper, not a UI). Pin to ONE project — running the same stateful
    // staging chain across chromium/firefox/webkit in parallel contends on shared
    // staging (observed flake 2026-08-09) and verifies nothing extra.
    test.skip(({ browserName }) => browserName !== "chromium", "single-browser: shared-staging round-trip runs on chromium only");

    test.beforeAll(async () => {
        const line = "─".repeat(90);
        log(`\n${line}\nTEST-5 REVIEW IMPORT → MODERATE → DISPLAY — DEPLOYED-STAGING E2E TRANSCRIPT\n${line}`);
        ctx = await resolveStagingContext(log);
        ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
        s3 = new S3Client({ region: ctx.region });
        log(`[input] tenantA=${tenantA}  tenantB=${tenantB}  productId=${productId}`);
    });

    // ── TEST 1 — IMPORT lands the image STAGED PRIVATE + review PENDING (NOT promoted yet). Stops
    //    BEFORE any approval so test 2 can exercise the pre-promotion isolation window.
    test("import stages the image PRIVATE + review PENDING (pre-promotion)", async ({ request }) => {
        // ── 1. IMPORT (real admin token; master key would be 403'd by the attestation identity gate)
        const csv =
            "authorName,rating,content,productId,images\n" +
            `Ana E2E,5,"Lovely, exactly as pictured.",${productId},photo.png\n`;
        const zipBase64 = Buffer.from(zipSync({ "photo.png": new Uint8Array(PNG_1x1) })).toString("base64");
        const importRes = await request.post(`${ctx.apiUrl}/import/reviews`, {
            headers: adminHeaders(tenantA),
            data: {
                format: "csv",
                csvContent: csv,
                zipBase64,
                attestation: {
                    rightsBasis: "Tenant owns the review content and media (TEST-5 e2e fixture)",
                    legalTextVersion: "rev-terms-v1",
                },
            },
        });
        log(`\n[1 · POST /import/reviews] tenant=${tenantA} → HTTP ${importRes.status()}`);
        expect(importRes.ok(), await importRes.text()).toBeTruthy();
        const report = await importRes.json();
        expect(report).toMatchObject({ format: "csv", totalRows: 1, accepted: 1, rejected: 0 });
        created.batchId = report.batchId;
        created.reviewId = report.rows[0].reviewId;
        created.stagedKey = report.images[0].assetKey;
        log(`  batchId=${created.batchId}  reviewId=${created.reviewId}`);
        log(`  staged image key (PRIVATE): ${created.stagedKey}`);
        expect(report.images[0].status).toBe("accepted");
        expect(created.stagedKey).toMatch(new RegExp(`^${STAGING_PREFIX}${tenantA}/.+/original$`));

        // ── 2. ImportBatch written FIRST, attested to the real admin email (real DDB read)
        const batch = await ddb.send(new GetCommand({
            TableName: ctx.tableName,
            Key: { PK: `TENANT#${tenantA}`, SK: `IMPORTBATCH#${created.batchId}` },
        }));
        log(`\n[2 · DDB] ImportBatch present=${!!batch.Item}  attestedBy=${batch.Item?.attestedBy}`);
        expect(batch.Item).toBeTruthy();
        expect(batch.Item?.attestedBy).toBe(ctx.adminEmail);

        // ── 3. Review landed PENDING, referencing the PRIVATE staging key (real DDB read)
        const rev = await ddb.send(new GetCommand({
            TableName: ctx.tableName,
            Key: { PK: `TENANT#${tenantA}`, SK: `REVIEW#${productId}#${created.reviewId}` },
        }));
        log(`[3 · DDB] Review status=${rev.Item?.status} source=${rev.Item?.source} image[0].status=${rev.Item?.images?.[0]?.status}`);
        expect(rev.Item?.status).toBe("pending");
        expect(rev.Item?.source).toBe("imported");
        expect(rev.Item?.images?.[0]?.status).toBe("pending");
        expect(rev.Item?.images?.[0]?.assetKey).toBe(created.stagedKey);

        // ── 4. ABSENCE: the staged PRIVATE original is NOT fetchable via the public CDN
        const stagedCdnUrl = `${ctx.cdnUrl}/${created.stagedKey}`;
        const stagedStatusBefore = await cdnStatus(request, stagedCdnUrl);
        log(`\n[4 · CDN absence] GET public-CDN/<staged key> → HTTP ${stagedStatusBefore} (expect 403/404: private)`);
        expect([403, 404]).toContain(stagedStatusBefore);
    });

    // ── TEST 2 — the REAL GAP (revise-3). Isolation on the STAGED, PENDING, pre-promotion image.
    //    The image is still a PRIVATE staged original at this point (no approval has run). Tenant B
    //    must not be able to presign-view it NOR approve/promote it (which would copy it to public).
    //    Owner tenant A doing both successfully is the same-detector positive control.
    test("tenant isolation on the STAGED pending image: owner can presign-view; tenant B cannot view nor promote", async ({ request }) => {
        // Positive control + PROOF WE ARE PRE-PROMOTION: the OWNER can mint a view URL, and the handler
        // reports kind="staged" (the private-quarantine branch keyed on the review-staging/<tenant>/
        // prefix) — so the image genuinely has NOT been promoted to public yet. This makes tenant B's
        // 404s below mean ISOLATION, not a broken/late endpoint.
        const ownerView = await imageViewUrl(request, tenantA);
        log(`\n[5a · GET image-view-url as OWNER tenantA] → HTTP ${ownerView.status()} (control: 200)`);
        expect(ownerView.ok(), await ownerView.text()).toBeTruthy();
        const ownerViewBody = await ownerView.json();
        log(`  owner view kind=${ownerViewBody.kind} status=${ownerViewBody.status} (proves image is still STAGED/private)`);
        expect(ownerViewBody.kind).toBe("staged");
        expect(ownerViewBody.status).toBe("pending");

        // Isolation READ: tenant B cannot presign-view tenant A's staged private original. The handler
        // reads the review row under TENANT#<tenantB>, where tenant A's review does not exist → 404.
        const otherView = await imageViewUrl(request, tenantB);
        log(`[5b · GET image-view-url as OTHER tenantB, STAGED image] → HTTP ${otherView.status()} (expect 404)`);
        expect(otherView.status()).toBe(404);

        // Isolation PROMOTE: tenant B cannot approve/promote tenant A's staged image. This is the copy
        // that would rewrite the private original into the PUBLIC bucket — it must never happen
        // cross-tenant. Row is not under tenant B → 404, and crucially NO public object is created.
        const otherPromote = await approveImage(request, tenantB);
        log(`[5c · PUT approve-image as OTHER tenantB, STAGED image] → HTTP ${otherPromote.status()} (expect 404, no cross-tenant promotion)`);
        expect(otherPromote.status()).toBe(404);

        // Confirm tenant B's blocked attempt left the image UNTOUCHED — still staged/pending under the
        // owner (same detector). If B had somehow promoted it, kind would flip to "public".
        const ownerViewAfter = await imageViewUrl(request, tenantA);
        const ownerViewAfterBody = await ownerViewAfter.json();
        log(`[5d · GET image-view-url as OWNER tenantA after B's blocked attempt] kind=${ownerViewAfterBody.kind} status=${ownerViewAfterBody.status} (must still be staged/pending)`);
        expect(ownerViewAfterBody.kind).toBe("staged");
        expect(ownerViewAfterBody.status).toBe("pending");
    });

    // ── TEST 3 — OWNER approval promotes staged→PUBLIC; the real DDB projection returns `source`;
    //    the CDN boundary flips; and post-promotion row isolation STILL holds (the retained second
    //    isolation assertion).
    test("owner approval promotes staged→PUBLIC (real DDB projection); post-promotion isolation holds", async ({ request }) => {
        const stagedCdnUrl = `${ctx.cdnUrl}/${created.stagedKey}`;

        // ── 6. Approve the REVIEW (default field-update path), THEN the IMAGE (triggers promotion).
        const approveReview = await request.put(`${ctx.apiUrl}/reviews/${created.reviewId}`, {
            headers: adminHeaders(tenantA),
            data: { productId, status: "approved" },
        });
        log(`\n[6a · PUT /reviews/{id}] status=approved → HTTP ${approveReview.status()}`);
        expect(approveReview.ok(), await approveReview.text()).toBeTruthy();

        const approveImageRes = await approveImage(request, tenantA);
        log(`[6b · PUT /reviews/{id} approve-image as OWNER] → HTTP ${approveImageRes.status()}`);
        expect(approveImageRes.ok(), await approveImageRes.text()).toBeTruthy();
        const approveBody = await approveImageRes.json();
        expect(approveBody.promoted).toBe(true);
        expect(typeof approveBody.publicUrl).toBe("string");
        // publicUrl = `${cdnUrl}/${publicKey}` (review-media.promoteReviewImage). Derive key + assetId.
        created.publicKey = String(approveBody.publicUrl).slice(ctx.cdnUrl.length + 1);
        created.assetId = created.publicKey.split("/")[1]?.split(".")[0] ?? "";
        log(`  promoted → publicKey=${created.publicKey}  assetId=${created.assetId}`);

        // ── 7. Real DDB PROJECTION on /public/reviews/{productId} — the exact layer that hid the
        //       reserved-keyword `source` bug. Assert the review + `source` come back on the wire.
        const publicList = await request.get(`${ctx.apiUrl}/public/reviews/${productId}`, {
            headers: { "x-tenant-id": tenantA },
        });
        log(`\n[7 · GET /public/reviews/{productId}] → HTTP ${publicList.status()}`);
        expect(publicList.ok(), await publicList.text()).toBeTruthy();
        const listBody = await publicList.json();
        const mine = (listBody.items ?? []).find((i: { id: string }) => i.id === created.reviewId);
        log(`  item present=${!!mine}  source=${mine?.source}  images=${JSON.stringify(mine?.images)}  avg=${listBody.averageRating}`);
        expect(mine, "approved review must appear in the public projection").toBeTruthy();
        expect(mine.source).toBe("imported"); // ← regression guard for the reserved-keyword projection
        expect(mine.images).toHaveLength(1);
        expect(mine.images[0].assetKey).toBe(created.publicKey); // PUBLIC key, not the staging key
        expect(mine.images[0].assetKey.startsWith("review-staging/")).toBe(false);

        // ── 8. POSITIVE CONTROL (same CDN detector as step 4): the PROMOTED public object IS
        //       fetchable; the staged PRIVATE original is STILL not. First fetch is a cache miss, so
        //       retry briefly for CloudFront→S3 origin propagation.
        let publicStatus = 0;
        for (let i = 0; i < 6 && publicStatus !== 200; i++) {
            publicStatus = await cdnStatus(request, approveBody.publicUrl);
            if (publicStatus !== 200) await new Promise((r) => setTimeout(r, 1500));
        }
        const stagedStatusAfter = await cdnStatus(request, stagedCdnUrl);
        log(`\n[8 · CDN boundary] promoted public key → HTTP ${publicStatus} (control: 200)   staged key → HTTP ${stagedStatusAfter} (absence: 403/404)`);
        expect(publicStatus).toBe(200);
        expect([403, 404]).toContain(stagedStatusAfter);

        // ── 9. POST-PROMOTION isolation (the retained second assertion): now that the row carries a
        //       PUBLIC key, tenant B still cannot read/re-promote it — row isolation persists across
        //       the promotion boundary.
        const ownerViewPost = await imageViewUrl(request, tenantA);
        log(`\n[9a · GET image-view-url as OWNER tenantA post-promotion] → HTTP ${ownerViewPost.status()} kind=${(await ownerViewPost.json()).kind} (control: 200, kind=public)`);
        expect(ownerViewPost.ok(), await ownerViewPost.text()).toBeTruthy();

        const otherViewPost = await imageViewUrl(request, tenantB);
        log(`[9b · GET image-view-url as OTHER tenantB post-promotion] → HTTP ${otherViewPost.status()} (expect 404)`);
        expect(otherViewPost.status()).toBe(404);

        const otherPromotePost = await approveImage(request, tenantB);
        log(`[9c · PUT approve-image as OTHER tenantB post-promotion] → HTTP ${otherPromotePost.status()} (expect 404)`);
        expect(otherPromotePost.status()).toBe(404);
    });

    test.afterAll(async ({ request }) => {
        // MANDATORY cleanup (shared staging). Runs regardless of test outcome. Two layers:
        //  (a) exercise the REAL delete handler for the review we know about (matches the existing
        //      cleanup convention + covers the handler's own side effects), then
        //  (b) a NAMESPACE SWEEP that deletes EVERYTHING under this run's unique tenant partitions and
        //      S3 key prefixes — so residue from a partial/failed import (an object or batch written
        //      before a later step failed) is still removed, not just the ids the import response gave.
        const line = "─".repeat(90);
        log(`\n${line}\n[cleanup] tenants=${tenantA},${tenantB} — namespace sweep of all TEST-5 items\n${line}`);
        if (!ctx) { log("[cleanup] no context (setup failed) — nothing created"); return; }

        const safe = async (label: string, fn: () => Promise<unknown>) => {
            try { await fn(); log(`[cleanup] ${label} — ok`); }
            catch (e) { log(`[cleanup] ${label} — FAILED: ${(e as Error).message}`); }
        };

        // (a) Real delete handler for the review row (best-effort; the sweep below is authoritative).
        if (created.reviewId) {
            await safe("DELETE /reviews/{id} (real handler)", async () => {
                const r = await request.delete(`${ctx.apiUrl}/reviews/${created.reviewId}?productId=${productId}`, {
                    headers: adminHeaders(tenantA),
                });
                if (!r.ok()) throw new Error(`HTTP ${r.status()} ${await r.text()}`);
            });
        }

        // (b) Namespace sweep — DDB partitions then S3 prefixes, for BOTH tenants (tenant B should have
        //     created nothing; sweeping it anyway turns a hypothetical cross-tenant write into a caught
        //     leak rather than a silent orphan).
        for (const t of [tenantA, tenantB]) {
            await safe(`DDB sweep TENANT#${t}`, () => ddbDeletePartition(t));
        }
        for (const [bucket, prefix, label] of s3Namespaces()) {
            await safe(`S3 sweep ${label}`, () => s3DeletePrefix(bucket, prefix));
        }

        // VERIFICATION IS AN ASSERTION (revise-2 + review-1 #2): re-count each namespace; ZERO must
        // remain. A residual count — OR a count we cannot obtain (fail-closed) — becomes a `problem`
        // and turns the run RED even if every test passed. Shared staging tolerates no silent orphan.
        const problems: string[] = [];
        const requireEmpty = async (label: string, count: () => Promise<number>) => {
            try {
                const n = await count();
                log(`[cleanup-verify] ${label}: ${n === 0 ? "EMPTY ✓" : `${n} RESIDUAL ✗`}`);
                if (n !== 0) problems.push(`${label} has ${n} residual item(s)`);
            } catch (e) {
                log(`[cleanup-verify] ${label}: UNVERIFIABLE (${(e as Error).message})`);
                problems.push(`${label} UNVERIFIABLE: ${(e as Error).message}`);
            }
        };
        for (const t of [tenantA, tenantB]) {
            await requireEmpty(`DDB TENANT#${t}`, () => ddbCountPartition(t));
        }
        for (const [bucket, prefix, label] of s3Namespaces()) {
            await requireEmpty(`S3 ${label}`, () => s3CountPrefix(bucket, prefix));
        }
        log(`${line}\n`);

        // The leak assertion — a non-empty `problems` list turns the run red even if every test passed.
        expect(problems, `TEST-5 cleanup left residue on shared staging: ${problems.join(" | ")}`).toEqual([]);
    });
});
