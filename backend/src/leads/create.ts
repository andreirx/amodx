import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { LeadSchema } from "@amodx/shared";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});
const PRIVATE_BUCKET = process.env.PRIVATE_BUCKET; // Ensure this env var is passed in CDK!

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: "Missing Tenant Context" };

        const body = JSON.parse(event.body || "{}");

        // 1. Save Lead
        const input = LeadSchema.omit({ id: true, tenantId: true, createdAt: true, status: true }).parse(body);
        const id = crypto.randomUUID();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `LEAD#${input.email}`,
                id,
                tenantId,
                ...input,
                status: "New",
                createdAt: new Date().toISOString(),
                Type: "Lead"
            }
        }));

        // 2. Handle Gated Resource (The "Exchange")
        let downloadUrl = undefined;
        // We look for 'resourceId' in the custom data payload or top level
        const resourceId = body.resourceId;

        if (resourceId && PRIVATE_BUCKET) {
            // A. Find the resource meta
            const resourceRes = await db.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: `RESOURCE#${resourceId}` }
            }));

            if (resourceRes.Item) {
                // B. Generate Link
                const command = new GetObjectCommand({
                    Bucket: PRIVATE_BUCKET,
                    Key: resourceRes.Item.s3Key
                });
                // URL valid for 15 minutes
                downloadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
            }
        }

        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "Subscribed",
                downloadUrl: downloadUrl // Frontend checks this
            })
        };

    } catch (e: any) {
        console.error(e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
