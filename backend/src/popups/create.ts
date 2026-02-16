import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { PopupSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing Tenant" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing Body" }) };

        const body = JSON.parse(event.body);

        const input = PopupSchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true
        }).parse(body);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const item = {
            PK: `TENANT#${tenantId}`,
            SK: `POPUP#${id}`,
            Type: "Popup",
            id,
            tenantId,
            ...input,
            createdAt: now,
            updatedAt: now,
        };

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: item,
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_POPUP",
            target: { title: input.name, id },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 201, body: JSON.stringify(item) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
