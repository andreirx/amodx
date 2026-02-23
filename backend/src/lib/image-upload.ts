import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "./db.js";

const s3 = new S3Client({});

export function getExtensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
    };
    return map[contentType.toLowerCase()] || ".jpg";
}

/**
 * Download an image from a URL, upload to S3, record as ASSET# in DynamoDB.
 * Returns the public CDN URL.
 */
export async function downloadAndUploadImage(
    tenantId: string,
    imageUrl: string,
    bucket: string,
    cdnUrl: string,
): Promise<string> {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";

    const extension = getExtensionFromContentType(contentType);
    const assetId = crypto.randomUUID();
    const filename = `${assetId}${extension}`;
    const s3Key = `${tenantId}/${filename}`;

    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: Buffer.from(imageBuffer),
        ContentType: contentType,
    }));

    const publicUrl = `${cdnUrl}/${s3Key}`;
    await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: `TENANT#${tenantId}`,
            SK: `ASSET#${assetId}`,
            id: assetId,
            tenantId,
            fileName: filename,
            filename, // keep for backward compat
            s3Key,
            publicUrl,
            url: publicUrl, // keep for backward compat
            fileType: contentType,
            contentType, // keep for backward compat
            uploadedBy: "wordpress-importer",
            createdAt: new Date().toISOString(),
            Type: "Asset",
        },
    }));

    return `${cdnUrl}/${s3Key}`;
}
