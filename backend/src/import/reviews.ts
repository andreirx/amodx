import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { unzipSync } from "fflate";
import {
    ReviewSchema,
    ImportBatchSchema,
    MAX_UPLOAD_BYTES,
    type ReviewImage,
    type ReviewImportReport,
    type ReviewImportRowResult,
    type ReviewImportImageResult,
} from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { publishAudit } from "../lib/events.js";
import { stageReviewImage } from "../lib/review-media.js";
import {
    parseReviewSource,
    extractReviewInput,
    extractImageRefs,
    mimeFromExtension,
} from "./reviews-parse.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * REV-2b — bulk review import (attestation-gated). The commercial core of Track REV: a tenant
 * hands us a CSV/JSON review export + an optional media ZIP, and we land the reviews (pending) and
 * their photos (staged, pending) under one immutable rights-attestation batch.
 *
 * WHY A DEDICATED IMPORT LAMBDA (import-family pattern). Sibling of `import/woocommerce.ts`,
 * `import/wordpress.ts`, `import/media.ts` — each importer is its own NodejsFunction + `POST
 * /import/*` route. This one belongs in its own bundle for the same reason they do: it is a bulk,
 * long-running, ZIP-parsing (`fflate`) entry point distinct from the reviews CRUD handlers. It is
 * the import-family pattern within the existing api surface, not a new deployable unit (no new
 * stack/bucket/table). NOTE (D-REV-4 SUPERSEDED 2026-08-08): the byte-screen was removed, so this
 * Lambda pulls no native image-decode dependency — it is a plain NodejsFunction; `fflate` bundles
 * as pure JS.
 *
 * THE SPINE (ratified, plan-reviews-import): the moderation gate governs the PUBLIC OBJECT — and
 * with automated byte-screening dropped (D-REV-4 SUPERSEDED), that HUMAN gate IS the content
 * control. Nothing this handler writes is public. Reviews land `status:"pending"`; each image is
 * staged to the PRIVATE quarantine bucket (declared type-AND-size gate only, no decode), its
 * `ReviewImage.assetKey` set to the PRIVATE `/original` key — promotion to the public bucket
 * happens ONLY later, in rev-2a's approve-image path, once a human approves both the review and the
 * image (rev-3 UI). Every image is pending until a human approves it: that is the content control.
 *
 * BULK invalidation class (cache-4a): wrapped in `withInvalidation` like every other `import/*`
 * handler — an import is a large, non-path-scoped mutation, so it uses the debounced `/*` bulk
 * class, never the ordinary per-path edge invalidation.
 */

/** Per-import cap on rows processed, so a pathological upload cannot run unbounded in one Lambda. */
const MAX_IMPORT_ROWS = 2000;

// ── Media-ZIP expansion bounds (zip-bomb guard, reviewer #3) ─────────────────────────────────
// fflate.unzipSync expands EVERY entry into memory at once, so a tiny compressed archive can
// balloon to gigabytes and exhaust Lambda memory BEFORE the per-image 10 MB stage guard (which
// only runs after an entry has already been inflated). fflate's `filter` callback runs per entry
// BEFORE that entry is inflated and exposes the DECLARED uncompressed size (`originalSize`) from
// the ZIP directory — so we reject an oversized entry, a bomb-like aggregate, and an absurd entry
// count HERE, before any bytes expand into memory and before the first DDB write.
//   • per-entry ceiling = the per-image cap (a single ZIP entry cannot exceed one review image);
//   • aggregate ceiling = 256 MB — memory-safe headroom under the 3008 MB Lambda. A legitimate
//     media ZIP rides the ≤10 MB API-Gateway JSON body, so real imports sit far below this; the
//     ceiling exists only to stop a bomb, not to bound honest imports;
//   • entry-count ceiling bounds a bomb of millions of empty (originalSize 0) entries that the
//     byte ceilings alone would not catch.
// Residual (honest, TECH-DEBT): originalSize is attacker-declared in the ZIP header; a malformed
// header could under-state size. The per-entry ACTUAL-bytes 10 MB guard inside stageReviewImage
// (on bytes.length, AFTER inflation) is the second line that catches an under-declared single
// entry. A fully streaming bounded inflate would remove even that residual; not built now
// (fflate's unzipSync has no bounded-output mode).
const MAX_ZIP_ENTRY_BYTES = MAX_UPLOAD_BYTES.image;
const MAX_ZIP_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;

interface ImportBody {
    format?: "csv" | "json";
    csvContent?: string;
    jsonContent?: string;
    /** base64-encoded ZIP of review photos (ZIP is binary; base64 rides the JSON body). */
    zipBase64?: string;
    /** D-REV-3 attestation — REQUIRED. No attestation → no import. */
    attestation?: { rightsBasis?: string; legalTextVersion?: string };
}

const _handler: Handler = async (event) => {
    try {
        const tenantId = event.headers["x-tenant-id"];
        const auth = event.requestContext.authorizer.lambda;

        // Imports are a TENANT_ADMIN operation (woocommerce/wordpress precedent).
        try {
            requireRole(auth, ["TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing Tenant" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing Body" }) };

        const body = JSON.parse(event.body) as ImportBody;
        const format: "csv" | "json" = body.format === "json" ? "json" : "csv";
        const sourceContent = format === "json" ? body.jsonContent : body.csvContent;

        if (!sourceContent || sourceContent.trim() === "") {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: `${format === "json" ? "jsonContent" : "csvContent"} is required` }),
            };
        }

        // ── D-REV-3 ATTESTATION GATE ────────────────────────────────────────────────────────
        // The endpoint REQUIRES the attestation payload. This is a legal-exposure gate, not a
        // nicety: imported review photos are third-party content, so publication is gated on an
        // explicit, recorded human assertion. Missing/blank → 400, and NOTHING is written (no
        // batch, no reviews) — "no batch record → no import".
        const rightsBasis = body.attestation?.rightsBasis?.trim();
        const legalTextVersion = body.attestation?.legalTextVersion?.trim();
        if (!rightsBasis || !legalTextVersion) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error:
                        "attestation is required: provide attestation.rightsBasis and attestation.legalTextVersion",
                }),
            };
        }

        // ── ATTESTATION IDENTITY — FAIL CLOSED (reviewer #1) ─────────────────────────────────
        // The attestation is a LEGAL assertion, and `ImportBatch.attestedBy` is documented as the
        // ACTOR EMAIL (CLAUDE.md audit-context rule). A caller with no attributable email — the
        // master-key/robot GLOBAL_ADMIN context (authorizer.ts writes `sub:"system-robot"` with NO
        // email, and it passes `requireRole` on the GLOBAL_ADMIN short-circuit), or any principal
        // lacking an email claim — MUST NOT be able to author an attestation. The former code fell
        // back to `auth.sub`, which would persist a FALSE attestation identity (e.g. "system-robot")
        // and a misleading audit actor. Require the email HERE, before the first write (batch,
        // review, S3 stage), so a non-attributable principal gets a 403 and NOTHING is written or
        // staged. 403 (not 400): the request is well-formed; the CREDENTIAL is forbidden from
        // attesting. `attestedBy` is set to this exact email below — never `auth.sub`.
        const attestedBy = auth.email?.trim();
        if (!attestedBy) {
            return {
                statusCode: 403,
                body: JSON.stringify({
                    error:
                        "attestation requires an authenticated user with an email address; this credential has no attributable identity and cannot attest an import",
                }),
            };
        }

        // Parse the source FIRST (read-only) so unusable input fails fast as a 400 before any
        // write — no orphan attestation batch for a file that was never importable. A per-ROW
        // problem is NOT a parse throw; it becomes a per-row rejection below.
        let rawRows;
        try {
            rawRows = parseReviewSource(format, sourceContent);
        } catch (e: any) {
            return { statusCode: 400, body: JSON.stringify({ error: e.message }) };
        }
        if (rawRows.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: "No review rows found in source" }) };
        }
        if (rawRows.length > MAX_IMPORT_ROWS) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: `import has ${rawRows.length} rows, exceeds the ${MAX_IMPORT_ROWS}-row per-import cap`,
                }),
            };
        }

        // ── DECODE + BOUND THE MEDIA ZIP (read-only, BEFORE any write) ───────────────────────
        // reviewer #2: the ZIP is decoded and validated BEFORE the first DDB write, so a corrupt
        // or bomb-like archive is a clean 400 that leaves NO orphan attestation batch. Everything
        // above (source parse) and here (ZIP decode/bound) is read-only; the ImportBatch below is
        // the FIRST WRITE. fflate.unzipSync is pure-JS (no native dep) and synchronous; entry
        // names are later matched against each row's imageRefs.
        let zipEntries: Record<string, Uint8Array> = {};
        if (body.zipBase64 && body.zipBase64.trim() !== "") {
            let entryCount = 0;
            let aggregateUncompressed = 0;
            try {
                zipEntries = unzipSync(Buffer.from(body.zipBase64, "base64"), {
                    // reviewer #3 (zip-bomb guard): the filter runs per entry BEFORE fflate inflates
                    // it, so an oversized entry / bomb-like aggregate / absurd entry count is refused
                    // before any bytes expand into memory. Throwing here aborts the whole unzip.
                    filter: (f) => {
                        entryCount++;
                        if (entryCount > MAX_ZIP_ENTRIES) {
                            throw new Error(`media ZIP has more than ${MAX_ZIP_ENTRIES} entries`);
                        }
                        if (f.originalSize > MAX_ZIP_ENTRY_BYTES) {
                            throw new Error(
                                `entry "${f.name}" declares ${f.originalSize}B uncompressed, exceeds the ${MAX_ZIP_ENTRY_BYTES}B per-image cap`,
                            );
                        }
                        aggregateUncompressed += f.originalSize;
                        if (aggregateUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
                            throw new Error(
                                `aggregate uncompressed size exceeds the ${MAX_ZIP_UNCOMPRESSED_BYTES}B limit (possible zip bomb)`,
                            );
                        }
                        return true;
                    },
                });
            } catch (e: any) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: `invalid media ZIP: ${e?.message ?? String(e)}` }),
                };
            }
        }

        // ── WRITE THE IMMUTABLE IMPORTBATCH FIRST (D-REV-3) ──────────────────────────────────
        // Every accepted review/image references this batch. It is written ONCE and never
        // mutated; the ConditionExpression enforces write-once (a UUID collision or a replay
        // cannot overwrite an existing batch). It is the FIRST WRITE — all validation above
        // (source parse, ZIP decode+bound) is read-only, so a rejected request leaves NO orphan
        // batch. If this write fails, the whole import aborts here and no review is written — the
        // batch-before-reviews invariant.
        const batchId = crypto.randomUUID();
        const attestedAt = new Date().toISOString();
        // `attestedBy` is the validated actor email from the fail-closed identity gate above —
        // never `auth.sub`, so a batch record can never carry a non-human/robot attestation.
        const batch = ImportBatchSchema.parse({
            id: batchId,
            tenantId,
            attestedBy,
            attestedAt,
            rightsBasis,
            legalTextVersion,
        });
        await db.send(
            new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    PK: `TENANT#${tenantId}`,
                    SK: `IMPORTBATCH#${batchId}`,
                    ...batch,
                    Type: "ImportBatch",
                },
                // Write-once immutability: refuse to overwrite an existing batch record.
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            }),
        );

        const privateBucket = process.env.PRIVATE_BUCKET || "";

        // ── PER-ROW PROCESSING ───────────────────────────────────────────────────────────────
        const rows: ReviewImportRowResult[] = [];
        // FULL per-image disposition (revise #3): accepted AND rejected entries, not only failures.
        const imageResults: ReviewImportImageResult[] = [];
        let accepted = 0;
        let rejected = 0;

        for (let index = 0; index < rawRows.length; index++) {
            // Buffer THIS row's image dispositions locally and commit them to the report only once
            // the row's OUTCOME is known (reviewer #2). A STAGED image is only PROVISIONALLY
            // "accepted": if the review write below fails, the staged object is an orphan no review
            // references, so it must NOT appear accepted. Terminal per-image rejections
            // (missing/gate/stage-failure) are buffered here too, so every referenced image still
            // appears exactly once whatever the row outcome.
            const rowImages: ReviewImportImageResult[] = [];
            try {
                const extracted = extractReviewInput(rawRows[index]);
                if (!extracted.ok) {
                    rows.push({ index, status: "rejected", reason: extracted.reason });
                    rejected++;
                    // FULL disposition (reviewer fix): a rejected ROW still referenced images in its
                    // (unvalidated) images cell. Surface each once as a rejected image so "every
                    // referenced image appears in the report, even when its row is rejected" holds.
                    for (const entry of extractImageRefs(rawRows[index])) {
                        imageResults.push({
                            status: "rejected",
                            rowIndex: index,
                            entry,
                            reason: `row rejected: ${extracted.reason}`,
                        });
                    }
                    continue;
                }
                const input = extracted.value;

                // Stage each referenced image (rev-2a reuse — declared type+size gate, no decode;
                // D-REV-4 SUPERSEDED). The human moderation gate is the content control.
                const images: ReviewImage[] = [];
                for (const entry of input.imageRefs) {
                    const bytes = zipEntries[entry];
                    if (!bytes) {
                        rowImages.push({ status: "rejected", rowIndex: index, entry, reason: "not found in media ZIP" });
                        continue;
                    }
                    // Per-image stage: an UNEXPECTED throw (e.g. S3 PutObject failure) is caught HERE,
                    // not by the outer row catch (review-2b review-1 finding #3). If it bubbled to the
                    // row catch the row would be rejected with NO disposition for this entry — breaking
                    // the "every referenced image appears once" invariant, and inconsistently rejecting
                    // the whole row (and its already-staged siblings' report entries) on one transient
                    // infra error. A stage throw is treated exactly like a gate rejection: this image
                    // becomes a rejected disposition and the row continues with the images that did stage.
                    let staged;
                    try {
                        staged = await stageReviewImage({
                            tenantId,
                            batchId,
                            imageId: crypto.randomUUID(),
                            declaredContentType: mimeFromExtension(entry),
                            bytes,
                            privateBucket,
                            declaredSize: bytes.length,
                        });
                    } catch (stageErr: any) {
                        rowImages.push({
                            status: "rejected",
                            rowIndex: index,
                            entry,
                            reason: `staging failed: ${stageErr?.message ?? String(stageErr)}`,
                        });
                        continue;
                    }
                    if (!staged.staged) {
                        rowImages.push({ status: "rejected", rowIndex: index, entry, reason: staged.reason });
                        continue;
                    }
                    // assetKey = the PRIVATE `/original` key. Promotion to public happens only on human
                    // approval (rev-2a). Status defaults pending (moderation gate = the content control).
                    images.push({ assetKey: staged.stagedKey, status: "pending" });
                    // PROVISIONALLY-accepted disposition (reviewer #2): the private original key and
                    // its staged byte size, keyed to this row and ZIP entry — the FULL disposition.
                    // Buffered, not committed: it only becomes a real "accepted" report entry once the
                    // review write below succeeds (a failed write converts it to rejected).
                    rowImages.push({
                        status: "accepted",
                        rowIndex: index,
                        entry,
                        assetKey: staged.stagedKey,
                        size: bytes.length,
                    });
                }

                // Map to the domain shape and VALIDATE on write (the importer closes the
                // create.ts validate-on-write gap for its own writes): scope from productId,
                // source "imported", status "pending", importBatchId set.
                const scope: "product" | "site" = input.productId ? "product" : "site";
                const id = crypto.randomUUID();
                const review = ReviewSchema.parse({
                    id,
                    tenantId,
                    scope,
                    productId: input.productId,
                    source: "imported",
                    authorName: input.authorName,
                    rating: input.rating,
                    content: input.content,
                    importBatchId: batchId,
                    images,
                    status: "pending",
                    createdAt: input.createdAt ?? new Date().toISOString(),
                });

                // Site-scope reviews use the DISJOINT `SITEREVIEW#` namespace (rev-1 D-REV-5), which
                // shares no prefix with `REVIEW#<productId>#` and so cannot collide with a product
                // review whose productId is literally "SITE".
                const sk = scope === "product" ? `REVIEW#${input.productId}#${id}` : `SITEREVIEW#${id}`;
                await db.send(
                    new PutCommand({
                        TableName: TABLE_NAME,
                        Item: { PK: `TENANT#${tenantId}`, SK: sk, ...review, Type: "Review" },
                    }),
                );

                // Review PERSISTED — the row's provisionally-accepted (staged) dispositions are now
                // real (a review references each staged object). Commit the whole buffer verbatim:
                // accepted entries plus any per-image rejections for this row.
                imageResults.push(...rowImages);
                rows.push({
                    index,
                    status: "accepted",
                    reviewId: id,
                    scope,
                    productId: input.productId,
                    imagesAccepted: images.length,
                });
                accepted++;
            } catch (rowErr: any) {
                // A single bad row NEVER aborts the batch (slice rule); it becomes a rejection.
                rows.push({ index, status: "rejected", reason: rowErr?.message ?? String(rowErr) });
                rejected++;
                // The row did NOT persist (ReviewSchema.parse throw, or the review PutCommand failed).
                // Any image STAGED for it is now an orphan no review references, so it CANNOT be
                // reported accepted (reviewer #2). Flush the buffer: convert each provisionally-accepted
                // disposition to REJECTED carrying the row-write reason; dispositions already rejected
                // for their own reason keep that (more-specific) reason. Every referenced image still
                // appears exactly once. (The staged orphan expires under the private-bucket lifecycle
                // rule — rev-2a — exactly as an abandoned import does.)
                const rowReason = rowErr?.message ?? String(rowErr);
                for (const d of rowImages) {
                    imageResults.push(
                        d.status === "accepted"
                            ? { status: "rejected", rowIndex: d.rowIndex, entry: d.entry, reason: `row write failed: ${rowReason}` }
                            : d,
                    );
                }
            }
        }

        const imagesAccepted = imageResults.filter((r) => r.status === "accepted").length;
        const imagesRejected = imageResults.length - imagesAccepted;

        const report: ReviewImportReport = {
            batchId,
            format,
            totalRows: rawRows.length,
            accepted,
            rejected,
            rows,
            images: imageResults,
        };

        await publishAudit({
            // actor.email = the validated `attestedBy` (guaranteed non-empty by the fail-closed
            // identity gate), so the audit trail can never record `email: undefined` (reviewer #1).
            tenantId,
            actor: { id: auth.sub, email: attestedBy },
            action: "REVIEW_IMPORT",
            target: { title: `Review import (${accepted} accepted, ${rejected} rejected)`, id: batchId },
            details: {
                batchId,
                format,
                totalRows: rawRows.length,
                accepted,
                rejected,
                imagesAccepted,
                imagesRejected,
                rightsBasis,
                legalTextVersion,
            },
            ip: event.requestContext.http.sourceIp,
        });

        return { statusCode: 200, body: JSON.stringify(report) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

export const handler = withInvalidation(_handler);
