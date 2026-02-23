import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const slug = event.pathParameters?.slug;
        if (!slug) return { statusCode: 400, body: JSON.stringify({ error: "Missing form slug" }) };

        // 1. Look up form via FORMSLUG# pointer (O(1) lookup)
        const slugResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `FORMSLUG#${slug}` }
        }));

        if (!slugResult.Item) return { statusCode: 404, body: JSON.stringify({ error: "Form not found" }) };

        const formId = slugResult.Item.formId;

        // 2. Fetch full form definition
        const formResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `FORM#${formId}` }
        }));

        if (!formResult.Item) return { statusCode: 404, body: JSON.stringify({ error: "Form not found" }) };

        const form = formResult.Item;

        if (form.status !== "active") {
            return { statusCode: 403, body: JSON.stringify({ error: "This form is not currently accepting submissions" }) };
        }

        // 3. Parse and validate submission data
        const body = JSON.parse(event.body || "{}");
        const data = body.data || {};

        // SECURITY: Validate email format if provided (prevents header injection)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const submitterEmail = data.email || body.email;
        if (submitterEmail && !emailRegex.test(submitterEmail)) {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid email format" }) };
        }

        // Validate required fields
        const missingFields: string[] = [];
        for (const field of (form.fields || [])) {
            if (field.required && (!data[field.name] || String(data[field.name]).trim() === "")) {
                missingFields.push(field.label || field.name);
            }
        }

        if (missingFields.length > 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Missing required fields",
                    fields: missingFields
                })
            };
        }

        // 4. Create submission
        const submissionId = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `FORMSUB#${formId}#${submissionId}`,
                Type: "FormSubmission",
                id: submissionId,
                tenantId,
                formId,
                formName: form.name,
                data,
                submitterEmail: submitterEmail || null,
                status: "new",
                createdAt: now,
            }
        }));

        // 5. Send email notification if configured
        if (form.notifyEmail) {
            const fieldLines = (form.fields || [])
                .map((f: any) => `${f.label || f.name}: ${data[f.name] || "(empty)"}`)
                .join("\n");

            try {
                await ses.send(new SendEmailCommand({
                    Source: FROM_EMAIL,
                    Destination: { ToAddresses: [form.notifyEmail] },
                    ReplyToAddresses: submitterEmail ? [submitterEmail] : undefined,
                    Message: {
                        Subject: { Data: `New submission: ${form.name}` },
                        Body: {
                            Text: { Data: `New form submission for "${form.name}"\n\n${fieldLines}\n\nSubmitted: ${now}` }
                        }
                    }
                }));
            } catch (emailErr: any) {
                console.error("Form notification email failed:", emailErr.message);
            }
        }

        return {
            statusCode: 201,
            headers: { "Cache-Control": "no-store" },
            body: JSON.stringify({
                message: form.successMessage || "Thank you for your submission!",
                submissionId,
            })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
