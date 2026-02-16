import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

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
                submitterEmail: data.email || body.email,
                status: "new",
                createdAt: now,
            }
        }));

        // Skip email notification for now

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
