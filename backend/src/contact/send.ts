import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { publishAudit } from "../lib/events.js";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    // LOG EVERYTHING
    console.log("📨 Contact Handler Started");
    console.log("Headers:", JSON.stringify(event.headers));

    try {
        const tenantId = event.headers['x-tenant-id'];

        if (!tenantId) {
            console.error("❌ Missing x-tenant-id header");
            return { statusCode: 400, body: "Missing Tenant" };
        }

        const body = JSON.parse(event.body || "{}");
        const { name, message, tags } = body;

        // SECURITY: Sanitize email to prevent header injection
        const email = (body.email || "").replace(/[\r\n]/g, '').trim();

        console.log(`Processing contact for Tenant: ${tenantId}, Email: ${email}`);

        // 1. Fetch Tenant Config
        const tenantRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));

        const config = tenantRes.Item;

        // 2. Determine Recipient
        const recipient = config?.integrations?.contactEmail || FROM_EMAIL;
        console.log(`Sending from: ${FROM_EMAIL} -> to: ${recipient}`);

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

        console.log("✅ Email dispatched to SES");

        await publishAudit({
            tenantId,
            actor: { id: email || "anonymous", email: email || "anonymous" },
            action: "CONTACT_FORM_SUBMIT",
            target: { title: `Contact from ${name}`, id: email },
            details: { tags },
            ip: event.requestContext?.http?.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Sent" }) };

    } catch (e: any) {
        console.error("❌ Fatal Error:", e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
