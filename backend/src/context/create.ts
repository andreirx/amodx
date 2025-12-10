import {
    APIGatewayProxyHandlerV2WithLambdaAuthorizer
} from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ContextItemSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        if (!event.body) return { statusCode: 400, body: "Missing body" };

        // Identity & Scope
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const auth = event.requestContext.authorizer.lambda;

        const body = JSON.parse(event.body);
        const input = ContextItemSchema.omit({ id: true, tenantId: true }).parse(body);
        const id = crypto.randomUUID();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `CONTEXT#${id}`,
                tenantId,
                id,
                createdBy: auth.sub,
                createdAt: new Date().toISOString(),
                ...input
            },
        }));

        return { statusCode: 201, body: JSON.stringify({ id, message: "Context Saved" }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
