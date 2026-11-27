import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { normalizeEmail } from "@amodx/shared";
import { errorName, INTERNAL_ERROR } from "../lib/value-free.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };

        const auth = event.requestContext.authorizer.lambda;
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId, "leads:read");
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Forbidden";
            return { statusCode: 403, body: JSON.stringify({ error: message }) };
        }

        // The leads: one Query page, as before (whole-list pagination is a separate, older limit). NL1-R6: with a projection
        // (CLAUDE.md rule 2) of the lead fields the readers use — the admin Leads page, the MCP `list_leads`, service keys.
        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ProjectionExpression: "#id, tenantId, #email, #name, #source, #status, #data, createdAt, resourceId",
            ExpressionAttributeNames: { "#id": "id", "#email": "email", "#name": "name", "#source": "source", "#status": "status", "#data": "data" },
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "LEAD#"
            }
        }));

        // NEWSLETTER-1 (NL1-R6): EVERY subscription of the partition (`NEWSLETTER#<normalized email>`, consent + push state),
        // read to the last page. NL1-R8: a subscription is shown on the NORMALIZED lead row only (`LEAD#<n>`, whose email
        // is its own normalized form); a row under another spelling of the address gets none. No MailerLite token here.
        const byEmail = new Map<string, { consent: unknown; push: unknown }>();
        let start: Record<string, any> | undefined;
        do {
            const page = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ProjectionExpression: "#email, #consent, #push",
                ExpressionAttributeNames: { "#email": "email", "#consent": "consent", "#push": "push" },
                ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "NEWSLETTER#" },
                ...(start ? { ExclusiveStartKey: start } : {}),
            }));
            for (const s of page?.Items || []) if (typeof s.email === "string") byEmail.set(normalizeEmail(s.email), { consent: s.consent, push: s.push });
            start = page?.LastEvaluatedKey;
        } while (start !== undefined);

        const items = (result.Items || []).map((lead) => {
            const subscription = typeof lead.email === "string" && lead.email === normalizeEmail(lead.email) ? byEmail.get(lead.email) : undefined;
            return subscription ? { ...lead, newsletter: subscription } : lead;
        });

        // Sort by createdAt desc (Newest first)
        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return { statusCode: 200, body: JSON.stringify({ items }) };
    } catch (error: unknown) {
        // NL1-R1 (lib/value-free.ts): the name only; the answer is a fixed text.
        console.error(`[leads/list] error=${errorName(error)}`);
        return INTERNAL_ERROR;
    }
};
