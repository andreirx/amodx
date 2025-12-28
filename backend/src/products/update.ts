import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ProductSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;
        const id = event.pathParameters?.id;

        if (!tenantId || !id || !event.body) return { statusCode: 400, body: "Missing Data" };

        const body = JSON.parse(event.body);

        // Fetch existing
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: "Product not found" };

        // Partial validation
        const input = ProductSchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true
        }).partial().parse(body);

        const merged = { ...existing.Item, ...input, updatedAt: new Date().toISOString() };

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: merged
        }));

        await publishAudit({
            tenantId,
            actorId: auth.sub,
            action: "UPDATE_PRODUCT",
            details: { title: merged.title },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify(merged) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
