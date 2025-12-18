import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db, TABLE_NAME } from "../lib/db";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context";
import {publishAudit} from "../lib/events";

const s3 = new S3Client({});
const BUCKET = process.env.UPLOADS_BUCKET!;
const CDN_URL = process.env.UPLOADS_CDN_URL!;

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const auth = event.requestContext.authorizer.lambda;

        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const { filename, contentType, size } = JSON.parse(event.body);

        const assetId = crypto.randomUUID();
        const key = `${tenantId}/${assetId}-${filename}`; // Collision-proof key

        // 1. Generate S3 Presigned URL
        const command = new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            ContentType: contentType,
        });
        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

        // 2. Calculate Final Public URL
        const publicUrl = `${CDN_URL}/${key}`;

        // 3. Record Asset in DB (Optimistic)
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `ASSET#${assetId}`,
                id: assetId,
                fileName: filename,
                fileType: contentType,
                size: size,
                s3Key: key,
                publicUrl: publicUrl,
                uploadedBy: auth.sub,
                createdAt: new Date().toISOString(),
                Type: 'Asset'
            }
        }));

        // 4. Audit
        await publishAudit({
            tenantId,
            actorId: auth.sub,
            action: "UPLOAD_ASSET",
            details: { filename, size, assetId },
            ip: event.requestContext.http.sourceIp
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ uploadUrl, publicUrl, assetId })
        };

    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
