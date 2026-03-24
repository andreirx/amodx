import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { publishAudit } from "../lib/events.js";
import { verifyRecaptcha, getRecaptchaErrorMessage, resolveRecaptchaConfig } from "../lib/recaptcha.js";
import { verifyTenantFromOrigin } from "../lib/tenant-verify.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL!;

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    // LOG EVERYTHING
    console.log("📨 Contact Handler Started");
    console.log("Headers:", JSON.stringify(event.headers));

    try {
        const tenantId = event.headers['x-tenant-id'];

        if (!tenantId) {
            console.error("Missing x-tenant-id header");
            return { statusCode: 400, body: "Missing Tenant" };
        }

        // Verify tenant ID — trusted if RENDERER (proxy derived tenant from host), otherwise check Origin
        const callerRole = (event.requestContext as any)?.authorizer?.lambda?.role as string | undefined;
        const tenantVerified = await verifyTenantFromOrigin(event.headers as Record<string, string | undefined>, tenantId, callerRole);
        if (!tenantVerified) {
            console.warn("Tenant verification failed", { tenantId, origin: event.headers['origin'] });
            return { statusCode: 403, body: JSON.stringify({ error: "Invalid request origin" }) };
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

        // reCAPTCHA verification (deployment-level mandatory, tenant can override keys/threshold)
        const recaptchaConfig = resolveRecaptchaConfig(config?.recaptcha);
        if (recaptchaConfig) {
            const recaptchaToken = body.recaptchaToken;

            if (!recaptchaToken) {
                return { statusCode: 400, body: JSON.stringify({ error: "CAPTCHA verification required" }) };
            }

            const result = await verifyRecaptcha(
                recaptchaToken,
                recaptchaConfig.secretKey,
                event.requestContext?.http?.sourceIp
            );

            if (!result.success || result.score < recaptchaConfig.threshold) {
                console.warn(`reCAPTCHA BLOCKED [${recaptchaConfig.source}]: score=${result.score}, ip=${event.requestContext?.http?.sourceIp}, form=contact`);
                return { statusCode: 403, body: JSON.stringify({ error: getRecaptchaErrorMessage(result) }) };
            }

            console.log(`reCAPTCHA passed [${recaptchaConfig.source}]: score=${result.score}, action=${result.action}`);
        }

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

        // Create Lead record for CRM
        const leadId = crypto.randomUUID();
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `LEAD#${email}`,
                id: leadId,
                tenantId,
                email,
                name,
                source: tags || "contact-form",
                status: "New",
                data: { message },
                createdAt: new Date().toISOString(),
                Type: "Lead"
            }
        }));
        console.log("✅ Lead record created");

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

export const handler = withInvalidation(_handler);
