import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { XMLParser } from "fast-xml-parser";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";
import { downloadAndUploadImage } from "../lib/image-upload.js";
import { writeMediaMapEntry, loadMediaMap } from "../lib/media-map.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { purgeStoredPagesOfRequestTenant } from "../lib/revalidate.js";
import { readMigrationUpload, deleteMigrationUpload } from "./migration-upload.js";

const s3 = new S3Client({});
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET!;
const UPLOADS_CDN_URL = process.env.UPLOADS_CDN_URL!;
// MIGRATION-UPLOAD-1: the export is read from the PRIVATE bucket (`migration/<tenantId>/…`); images still go to UPLOADS_BUCKET.
const PRIVATE_BUCKET = process.env.PRIVATE_BUCKET;

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

interface AttachmentItem {
    url: string;
    title: string;
}

function parseMediaXml(xmlContent: string): AttachmentItem[] {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
        parseAttributeValue: true,
        trimValues: true,
        isArray: (name) => name === "item",
    });

    const parsed = parser.parse(xmlContent);
    const channel = parsed?.rss?.channel;
    if (!channel) throw new Error("Invalid WXR format — missing rss/channel");

    let items = channel.item || [];
    if (!Array.isArray(items)) items = [items];

    const attachments: AttachmentItem[] = [];

    for (const item of items) {
        const postType = item["wp:post_type"] || "";
        if (postType !== "attachment") continue;

        const url = item["wp:attachment_url"] || "";
        if (!url) continue;

        attachments.push({
            url,
            title: item.title || "",
        });
    }

    return attachments;
}

async function processBatch(
    tenantId: string,
    batch: AttachmentItem[],
    errors: string[],
): Promise<number> {
    let downloaded = 0;

    const results = await Promise.allSettled(
        batch.map(async (attachment) => {
            const newUrl = await downloadAndUploadImage(
                tenantId,
                attachment.url,
                UPLOADS_BUCKET,
                UPLOADS_CDN_URL,
                "wordpress-importer",
            );
            await writeMediaMapEntry(tenantId, attachment.url, newUrl);
            return newUrl;
        }),
    );

    for (let i = 0; i < results.length; i++) {
        if (results[i].status === "fulfilled") {
            downloaded++;
        } else {
            const reason = (results[i] as PromiseRejectedResult).reason;
            errors.push(`"${batch[i].title}": ${reason?.message || reason}`);
        }
    }

    return downloaded;
}

const _handler: Handler = async (event) => {
    try {
        const tenantId = event.headers["x-tenant-id"];
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing tenant" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const body = JSON.parse(event.body);
        const { s3Key, batchStart = 0, batchSize = 50 } = body;
        if (!s3Key) {
            return { statusCode: 400, body: JSON.stringify({ error: "s3Key is required" }) };
        }
        // The cursor must advance on every request, or a caller that follows `nextBatchStart` never ends.
        if (!Number.isInteger(batchStart) || batchStart < 0 || !Number.isInteger(batchSize) || batchSize < 1) {
            return { statusCode: 400, body: JSON.stringify({ error: "batchStart must be an integer >= 0 and batchSize an integer >= 1" }) };
        }
        // BACKEND-CONTRACT-1 D4, MIGRATION-UPLOAD-1: after the authorisation above, the key must be this tenant's
        // migration upload (`migration/<tenantId>/<uuid>-<name>`, POST /import/upload-url) — checked before any S3 call.
        console.log(`Reading media XML from S3: ${s3Key}`);
        const read = await readMigrationUpload(s3, PRIVATE_BUCKET, tenantId, s3Key);
        if (read.kind === "refused") return { statusCode: read.statusCode, body: JSON.stringify({ error: read.error }) };
        const xmlContent = read.content;

        // Parse attachments
        const allAttachments = parseMediaXml(xmlContent);
        const totalInXml = allAttachments.length;
        console.log(`Found ${totalInXml} media attachments in XML`);

        // MIGRATION-UPLOAD-1 review-0 F-MU1-EARLY-DELETE. The cursor walks the export's OWN attachment order, the same on
        // every request. (Before, it indexed the attachments not yet in the media map — a list that shrinks as each batch
        // writes its mappings — so a later offset skipped attachments and `complete` came early; the upload is now deleted
        // on `complete`, so that would delete it before every attachment was tried.) Rule: `complete` = every position of
        // the export was attempted in some batch. An attachment already in the media map is skipped inside its batch.
        const existingMap = await loadMediaMap(tenantId);
        const notMapped = allAttachments.filter(a => !existingMap.has(a.url)).length;
        const batch = allAttachments.slice(batchStart, batchStart + batchSize);
        const toDownload = batch.filter(a => !existingMap.has(a.url));
        const batchSkipped = batch.length - toDownload.length;

        const errors: string[] = [];
        const downloaded = toDownload.length > 0 ? await processBatch(tenantId, toDownload, errors) : 0;
        const processedSoFar = batchStart + batch.length;
        const complete = processedSoFar >= totalInXml;
        const nextBatchStart = complete ? undefined : processedSoFar;

        console.log(`Positions ${batchStart}-${processedSoFar}/${totalInXml}: ${downloaded} downloaded, ${errors.length} failed, ${batchSkipped} already imported`);

        // Only audit on completion. MIGRATION-UPLOAD-1: every position was attempted, so the upload is no longer needed.
        if (complete) {
            await deleteMigrationUpload(s3, PRIVATE_BUCKET!, s3Key);
            await publishAudit({
                tenantId,
                actor: { id: auth.sub, email: auth.email },
                action: "MEDIA_IMPORT",
                target: { title: "WordPress Media Import", id: "media-import" },
                details: {
                    total: totalInXml,
                    // As read at the start of the last request: the mappings written by earlier batches are included.
                    notMappedAtLastBatch: notMapped,
                },
                ip: event.requestContext.http.sourceIp,
            });
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                total: totalInXml,
                // A snapshot at the start of THIS request (mappings of earlier batches included); per-run totals are the
                // sums of the batch* fields.
                newTotal: notMapped,
                alreadyImported: totalInXml - notMapped,
                batchSkipped,
                batchDownloaded: downloaded,
                batchFailed: errors.length,
                // Positions of the export attempted so far (out of `total`).
                processedSoFar,
                nextBatchStart,
                complete,
                errors: errors.slice(0, 20),
            }),
        };
    } catch (e: any) {
        console.error("Media import error:", e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

export const handler = withInvalidation(_handler, purgeStoredPagesOfRequestTenant);
