import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { newsletterTexts, resolveLocaleStrings } from "@amodx/shared";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "POPUP#",
                ":active": "active",
            },
            FilterExpression: "#s = :active",
            ProjectionExpression: "id, #t, headline, body, imageLink, ctaText, ctaLink, #tr, triggerValue, showOnPages, showOncePerSession, collectEmail",
            ExpressionAttributeNames: { "#t": "type", "#tr": "trigger", "#s": "status" },
        }));
        const items = result.Items || [];

        // NEWSLETTER-1 (scope item 5): a popup of type "newsletter" with `collectEmail: true` draws the email field and the
        // consent box; their texts come from the tenant's locale table (`newsletterTexts`, the same function the lead write
        // checks the consent line with). Read and added only when such a popup is active, so every other answer is as before.
        // The tenant read projects the locale fields only (never `integrations`).
        if (items.some((p) => p.type === "newsletter" && p.collectEmail === true)) {
            const tenant = (await db.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
                ProjectionExpression: "#locale, #siteStrings",
                ExpressionAttributeNames: { "#locale": "locale", "#siteStrings": "siteStrings" },
            }))).Item;
            return { statusCode: 200, body: JSON.stringify({ items, newsletter: newsletterTexts(resolveLocaleStrings(tenant ?? {})) }) };
        }

        return { statusCode: 200, body: JSON.stringify({ items }) };
    } catch (e: any) {
        console.error("[popups/public-list] Error:", e);
        return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
    }
};
