import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { db, TABLE_NAME } from "../lib/db.js"; // Ensure extension is .js for Lambda ESM
import { GetCommand } from "@aws-sdk/lib-dynamodb";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };

        const body = JSON.parse(event.body || "{}");
        const { name, email, message, tags } = body;

        // 1. Fetch Tenant Config
        const tenantRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));

        const config = tenantRes.Item;

        // 2. Determine Recipient
        // Fallback to the Agency Admin email if tenant hasn't set one
        // Ideally, we default to the FROM_EMAIL if no specific contact is set.
        const recipient = config?.integrations?.contactEmail || FROM_EMAIL;

        // 3. Send Email
        await ses.send(new SendEmailCommand({
            Source: FROM_EMAIL,
            Destination: { ToAddresses: [recipient] },
            ReplyToAddresses: [email],
            Message: {
                Subject: { Data: `[${config?.name || 'AMODX'}] New Contact: ${name}` },
                Body: {
                    Text: { Data: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}\n\nTags: ${tags}` }
                }
            }
        }));

        return { statusCode: 200, body: JSON.stringify({ message: "Sent" }) };

    } catch (e: any) {
        console.error(e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
