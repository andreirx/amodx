import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ContextItemSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        if (!event.body) return { statusCode: 400, body: "Missing body" };

        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const auth = event.requestContext.authorizer.lambda;

        const body = JSON.parse(event.body);

        // Zod Validation (Strips unknown fields)
        const input = ContextItemSchema.omit({
            id: true,
            tenantId: true,
            createdAt: true,
            createdBy: true,
            updatedAt: true
        }).parse(body);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `CONTEXT#${id}`,
                tenantId,
                id,
                createdBy: auth.sub,
                createdAt: now,
                updatedAt: now,
                title: input.title,
                blocks: input.blocks,
                tags: input.tags,
                Type: "Context" // For GSI indexing if we add one later
            },
        }));

        return { statusCode: 201, body: JSON.stringify({ id, message: "Context Saved" }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
