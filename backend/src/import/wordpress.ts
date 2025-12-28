import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseWXR, WordPressPost } from "./wxr-parser.js";
import { HTMLToTiptapConverter } from "./html-to-tiptap.js";

const s3 = new S3Client({});
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET;
const UPLOADS_CDN_URL = process.env.UPLOADS_CDN_URL;

interface ImportRequest {
    tenantId: string;
    wxrContent: string;
    batchStart?: number;
    batchSize?: number;
}

interface ImportResponse {
    processedCount: number;
    totalCount: number;
    nextBatchStart?: number;
    complete: boolean;
    errors?: string[];
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing Tenant Context" })
            };
        }

        const body: ImportRequest = JSON.parse(event.body || "{}");
        const { wxrContent, batchStart = 0, batchSize = 100 } = body;

        if (!wxrContent) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing wxrContent" })
            };
        }

        console.log(`Starting WordPress import for tenant ${tenantId}, batch ${batchStart}-${batchStart + batchSize}`);

        // Parse the WXR XML
        const allPosts = await parseWXR(wxrContent);
        const totalCount = allPosts.length;

        // Get the batch to process
        const postsToProcess = allPosts.slice(batchStart, batchStart + batchSize);
        const errors: string[] = [];

        // Process each post
        for (let i = 0; i < postsToProcess.length; i++) {
            const post = postsToProcess[i];
            const itemIndex = batchStart + i;

            try {
                await processPost(tenantId, post);
                console.log(`Processed item ${itemIndex + 1}/${totalCount}: ${post.title}`);
            } catch (error: any) {
                const errorMsg = `Failed to process "${post.title}": ${error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
            }
        }

        const processedCount = batchStart + postsToProcess.length;
        const complete = processedCount >= totalCount;
        const nextBatchStart = complete ? undefined : processedCount;

        const response: ImportResponse = {
            processedCount,
            totalCount,
            nextBatchStart,
            complete,
            errors: errors.length > 0 ? errors : undefined
        };

        return {
            statusCode: 200,
            body: JSON.stringify(response)
        };

    } catch (e: any) {
        console.error("WordPress import error:", e);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: e.message })
        };
    }
};

async function processPost(tenantId: string, post: WordPressPost): Promise<void> {
    // 1. Convert HTML to Tiptap JSON
    const converter = new HTMLToTiptapConverter();
    const { blocks, imageUrls } = converter.convert(post.content);

    // 2. Handle featured image (if exists)
    let featuredImageUrl: string | undefined;
    if (post.featuredImage) {
        try {
            featuredImageUrl = await downloadAndUploadImage(tenantId, post.featuredImage);
        } catch (error) {
            console.warn(`Failed to download featured image for "${post.title}":`, error);
        }
    }

    // 3. Create content record
    const contentId = crypto.randomUUID();
    const nodeId = crypto.randomUUID();

    // Map WordPress status to AMODX status
    const status = post.status === 'publish' ? 'Published' : 'Draft';

    // Build slug path - FLATTEN everything instead of keeping the blog
    const slugPath = `/${post.slug}`;

    await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: `TENANT#${tenantId}`,
            SK: `CONTENT#${nodeId}#LATEST`,
            id: contentId,
            nodeId,
            slug: slugPath,
            title: post.title,
            status,
            version: 1,
            author: "wordpress-importer",
            createdAt: post.publishedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            Type: "Page",
            blocks,
            featuredImage: featuredImageUrl,
            commentsMode: "Disabled"
        }
    }));

    // 4. Create route record
    await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: `TENANT#${tenantId}`,
            SK: `ROUTE#${slugPath}`,
            TargetNode: `NODE#${nodeId}`,
            createdAt: new Date().toISOString(),
            Type: "Route"
        }
    }));

    console.log(`Created content and route for "${post.title}" at ${slugPath}`);
}

async function downloadAndUploadImage(tenantId: string, imageUrl: string): Promise<string> {
    if (!UPLOADS_BUCKET || !UPLOADS_CDN_URL) {
        throw new Error("UPLOADS_BUCKET or UPLOADS_CDN_URL not configured");
    }

    // Download image
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Generate unique filename
    const extension = getExtensionFromContentType(contentType);
    const assetId = crypto.randomUUID();
    const filename = `${assetId}${extension}`;
    const s3Key = `${tenantId}/${filename}`;

    // Upload to S3
    await s3.send(new PutObjectCommand({
        Bucket: UPLOADS_BUCKET,
        Key: s3Key,
        Body: Buffer.from(imageBuffer),
        ContentType: contentType
    }));

    // Create asset record in DynamoDB
    await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: `TENANT#${tenantId}`,
            SK: `ASSET#${assetId}`,
            id: assetId,
            tenantId,
            filename,
            s3Key,
            url: `${UPLOADS_CDN_URL}/${s3Key}`,
            contentType,
            uploadedBy: "wordpress-importer",
            createdAt: new Date().toISOString(),
            Type: "Asset"
        }
    }));

    return `${UPLOADS_CDN_URL}/${s3Key}`;
}

function getExtensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg'
    };

    return map[contentType.toLowerCase()] || '.jpg';
}
