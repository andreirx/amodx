import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { SignalSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN"], tenantId);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Forbidden";
            return { statusCode: 403, body: JSON.stringify({ error: message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const body = JSON.parse(event.body);

        const input = SignalSchema.omit({
            id: true,
            tenantId: true,
            createdAt: true,
            updatedAt: true,
            status: true,
        }).parse(body);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `SIGNAL#${id}`,
                id,
                tenantId,
                ...input,
                status: "New",
                createdAt: now,
                updatedAt: now,
                Type: "Signal",
            },
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_SIGNAL",
            target: { id, title: input.title },
            details: { source: input.source, painScore: input.painScore },
            ip: event.requestContext.http.sourceIp,
        });

        return { statusCode: 201, body: JSON.stringify({ id, message: "Signal created" }) };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Internal error";
        return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
};
