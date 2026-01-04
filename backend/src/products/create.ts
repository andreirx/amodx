import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ProductSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import {requireRole} from "../auth/policy";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        // SECURITY: Editors allowed
        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };
        if (!event.body) return { statusCode: 400, body: "Missing Body" };

        const body = JSON.parse(event.body);

        // Validate
        const input = ProductSchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true
        }).parse(body);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `PRODUCT#${id}`,
                id,
                tenantId,
                ...input,
                createdAt: now,
                updatedAt: now,
                Type: "Product"
            }
        }));

        await publishAudit({
            tenantId,
            actorId: auth.sub,
            action: "CREATE_PRODUCT",
            details: { title: input.title },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 201, body: JSON.stringify({ id, message: "Product created" }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
