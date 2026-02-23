import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { parseWXR, WordPressPost } from "./wxr-parser.js";
import { HTMLToTiptapConverter } from "./html-to-tiptap.js";
import { downloadAndUploadImage } from "../lib/image-upload.js";
import { loadMediaMap } from "../lib/media-map.js";

/** Find existing content by slug using ROUTE# lookup */
async function findContentBySlug(tenantId: string, slug: string): Promise<{ nodeId: string; contentId: string; createdAt: string } | null> {
    const routeResult = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: {
            ":pk": `TENANT#${tenantId}`,
            ":sk": `ROUTE#${slug}`
        }
    }));

    if (!routeResult.Items || routeResult.Items.length === 0) return null;

    const route = routeResult.Items[0];
    const targetNode = route.TargetNode as string;
    if (!targetNode) return null;

    const nodeId = targetNode.replace('NODE#', '');

    // Get existing content record
    const contentResult = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
            ":pk": `TENANT#${tenantId}`,
            ":sk": `CONTENT#${nodeId}#`
        },
        Limit: 1
    }));

    if (!contentResult.Items || contentResult.Items.length === 0) return null;

    return {
        nodeId,
        contentId: contentResult.Items[0].id,
        createdAt: contentResult.Items[0].createdAt
    };
}

const s3 = new S3Client({});
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET;
const UPLOADS_CDN_URL = process.env.UPLOADS_CDN_URL;

interface ImportRequest {
    tenantId: string;
    wxrContent?: string;
    s3Key?: string;
    batchStart?: number;
    batchSize?: number;
}

interface ImportResponse {
    processedCount: number;
    createdCount: number;
    updatedCount: number;
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
        const { wxrContent, s3Key, batchStart = 0, batchSize = 100 } = body;

        // Get content from either direct string or S3
        let content: string;
        if (s3Key && UPLOADS_BUCKET) {
            console.log(`Reading WXR from S3: ${s3Key}`);
            const s3Obj = await s3.send(new GetObjectCommand({
                Bucket: UPLOADS_BUCKET,
                Key: s3Key,
            }));
            content = await s3Obj.Body!.transformToString("utf-8");
        } else if (wxrContent) {
            content = wxrContent;
        } else {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing wxrContent or s3Key" })
            };
        }

        console.log(`Starting WordPress import for tenant ${tenantId}, batch ${batchStart}-${batchStart + batchSize}`);

        // Load media URL map (from prior media import step)
        const mediaMap = await loadMediaMap(tenantId);
        console.log(`Loaded ${mediaMap.size} media URL mappings`);

        // Parse the WXR XML
        const allPosts = await parseWXR(content);
        const totalCount = allPosts.length;

        // Get the batch to process
        const postsToProcess = allPosts.slice(batchStart, batchStart + batchSize);
        const errors: string[] = [];
        let createdCount = 0;
        let updatedCount = 0;

        // Process each post
        for (let i = 0; i < postsToProcess.length; i++) {
            const post = postsToProcess[i];
            const itemIndex = batchStart + i;

            try {
                const wasUpdate = await processPost(tenantId, post, mediaMap);
                if (wasUpdate) {
                    updatedCount++;
                    console.log(`Updated item ${itemIndex + 1}/${totalCount}: ${post.title}`);
                } else {
                    createdCount++;
                    console.log(`Created item ${itemIndex + 1}/${totalCount}: ${post.title}`);
                }
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
            createdCount,
            updatedCount,
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

async function processPost(
    tenantId: string,
    post: WordPressPost,
    mediaMap: Map<string, string>,
): Promise<boolean> {
    // Build slug path - FLATTEN everything instead of keeping the blog
    const slugPath = `/${post.slug}`;

    // Check for existing content by slug
    const existing = await findContentBySlug(tenantId, slugPath);
    const isUpdate = !!existing;

    // Use existing IDs for update, or generate new ones for create
    const nodeId = existing?.nodeId || crypto.randomUUID();
    const contentId = existing?.contentId || crypto.randomUUID();

    // 1. Rewrite image URLs in HTML content before converting
    let htmlContent = post.content;
    for (const [oldUrl, newUrl] of mediaMap) {
        // Replace full URLs and also resized variants (-NNNxNNN suffix)
        const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match the URL with optional -WIDTHxHEIGHT suffix before extension
        const baseWithoutExt = escaped.replace(/\\\.\w+$/, '');
        const ext = oldUrl.match(/\.\w+$/)?.[0] || '';
        const pattern = new RegExp(baseWithoutExt + '(?:-\\d+x\\d+)?' + ext.replace('.', '\\.'), 'g');
        htmlContent = htmlContent.replace(pattern, newUrl);
    }

    // 2. Convert HTML to Tiptap JSON (pass media map for URL rewriting)
    const converter = new HTMLToTiptapConverter(mediaMap);
    const { blocks } = converter.convert(htmlContent);

    // 3. Handle featured image
    let featuredImageUrl: string | undefined;
    if (post.featuredImage) {
        // Check media map first
        const mapped = mediaMap.get(post.featuredImage);
        if (mapped) {
            featuredImageUrl = mapped;
        } else if (UPLOADS_BUCKET && UPLOADS_CDN_URL) {
            try {
                featuredImageUrl = await downloadAndUploadImage(
                    tenantId, post.featuredImage, UPLOADS_BUCKET, UPLOADS_CDN_URL,
                );
            } catch (error) {
                console.warn(`Failed to download featured image for "${post.title}":`, error);
            }
        }
    }

    // Map WordPress status to AMODX status
    const status = post.status === 'publish' ? 'Published' : 'Draft';

    // Determine Comments Mode
    const commentsMode = post.comments.length > 0 ? "Enabled" : "Hidden";

    // Preserve original createdAt for updates
    const createdAt = existing?.createdAt || post.publishedAt || new Date().toISOString();

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
            createdAt,
            updatedAt: new Date().toISOString(),
            Type: "Page",
            blocks,
            featuredImage: featuredImageUrl,
            commentsMode: commentsMode
        }
    }));

    // 5. Create route record
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

    // 6. PROCESS COMMENTS
    if (post.comments.length > 0) {
        console.log(`Importing ${post.comments.length} comments for ${post.title}`);

        const commentPromises = post.comments.map(c => {
            const commentId = crypto.randomUUID();
            const commentDate = c.date ? new Date(c.date).toISOString() : new Date().toISOString();

            return db.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    PK: `TENANT#${tenantId}`,
                    SK: `COMMENT#${nodeId}#${commentDate}`,
                    id: commentId,
                    tenantId,
                    pageId: nodeId,
                    authorName: c.author || "Anonymous",
                    authorEmail: c.email || "unknown@example.com",
                    authorImage: "",
                    content: c.content,
                    status: c.approved ? "Approved" : "Pending",
                    createdAt: commentDate,
                    Type: "Comment"
                }
            }));
        });

        await Promise.all(commentPromises);
    }
    console.log(`${isUpdate ? 'Updated' : 'Created'} content and route for "${post.title}" at ${slugPath}`);
    return isUpdate;
}
