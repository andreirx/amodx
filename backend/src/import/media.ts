import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { XMLParser } from "fast-xml-parser";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";
import { downloadAndUploadImage } from "../lib/image-upload.js";
import { writeMediaMapEntry, loadMediaMap } from "../lib/media-map.js";

const s3 = new S3Client({});
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET!;
const UPLOADS_CDN_URL = process.env.UPLOADS_CDN_URL!;

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

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers["x-tenant-id"];
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["TENANT_ADMIN"], tenantId);
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

        // Read XML from S3
        console.log(`Reading media XML from S3: ${s3Key}`);
        const s3Obj = await s3.send(new GetObjectCommand({
            Bucket: UPLOADS_BUCKET,
            Key: s3Key,
        }));
        const xmlContent = await s3Obj.Body!.transformToString("utf-8");

        // Parse attachments
        const allAttachments = parseMediaXml(xmlContent);
        const totalInXml = allAttachments.length;
        console.log(`Found ${totalInXml} media attachments in XML`);

        // Load existing media map to skip duplicates
        const existingMap = await loadMediaMap(tenantId);
        const newAttachments = allAttachments.filter(a => !existingMap.has(a.url));
        const alreadyImported = totalInXml - newAttachments.length;

        console.log(`${alreadyImported} already imported, ${newAttachments.length} new to download`);

        // Get the batch to process (from the NEW attachments list)
        const batchToProcess = newAttachments.slice(batchStart, batchStart + batchSize);

        if (batchToProcess.length === 0) {
            // Nothing left to do
            return {
                statusCode: 200,
                body: JSON.stringify({
                    total: totalInXml,
                    newTotal: newAttachments.length,
                    alreadyImported,
                    downloaded: 0,
                    failed: 0,
                    complete: true,
                    errors: [],
                }),
            };
        }

        // Process this batch
        const errors: string[] = [];
        const downloaded = await processBatch(tenantId, batchToProcess, errors);
        const processedSoFar = batchStart + batchToProcess.length;
        const complete = processedSoFar >= newAttachments.length;
        const nextBatchStart = complete ? undefined : processedSoFar;

        console.log(`Batch ${batchStart}-${processedSoFar}/${newAttachments.length}: ${downloaded} downloaded, ${errors.length} failed`);

        // Only audit on completion
        if (complete) {
            await publishAudit({
                tenantId,
                actor: { id: auth.sub, email: auth.email },
                action: "MEDIA_IMPORT",
                target: { title: "WordPress Media Import", id: "media-import" },
                details: {
                    total: totalInXml,
                    newTotal: newAttachments.length,
                    alreadyImported,
                },
                ip: event.requestContext.http.sourceIp,
            });
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                total: totalInXml,
                newTotal: newAttachments.length,
                alreadyImported,
                batchDownloaded: downloaded,
                batchFailed: errors.length,
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
