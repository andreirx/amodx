import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

const s3 = new S3Client({});
const PRIVATE_BUCKET = process.env.PRIVATE_BUCKET!;

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// POST /resources/upload-url (Admin Only)
export const uploadHandler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const { filename, contentType, size } = JSON.parse(event.body);

        const resourceId = crypto.randomUUID();
        const key = `${tenantId}/${resourceId}-${filename}`;

        // Generate PUT URL
        const command = new PutObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key, ContentType: contentType });
        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

        // Record in DB
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `RESOURCE#${resourceId}`,
                id: resourceId,
                fileName: filename,
                s3Key: key,
                uploadedBy: auth.sub,
                createdAt: new Date().toISOString(),
                Type: 'Resource'
            }
        }));

        return { statusCode: 200, body: JSON.stringify({ uploadUrl, resourceId }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

// GET /resources/{id}/download-url (Protected by Logic)
export const downloadHandler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const resourceId = event.pathParameters?.id;

        // TODO: ADD PERMISSION CHECK HERE
        // e.g. Check if User has bought product X associated with this resource
        // For now, we assume if you can call this API (authenticated), you can download.

        // Get Resource Metadata
        const record = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `RESOURCE#${resourceId}` }
        }));

        if (!record.Item) return { statusCode: 404, body: "Not found" };

        // Generate GET URL (Short expiry)
        const command = new GetObjectCommand({ Bucket: PRIVATE_BUCKET, Key: record.Item.s3Key });
        const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

        return { statusCode: 200, body: JSON.stringify({ downloadUrl }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
