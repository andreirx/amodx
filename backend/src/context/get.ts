import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import {requireRole} from "../auth/policy.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        const auth = event.requestContext.authorizer.lambda;
        const tenantId = event.headers['x-tenant-id'];
        const id = event.pathParameters?.id;

        if (!id) return { statusCode: 400, body: "Missing ID" };

        // 1. FAIL if no tenant ID (No more "DEMO")
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // 2. ENFORCE Policy
        // Editors and Admins can list content
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTEXT#${id}` }
        }));

        if (!result.Item) return { statusCode: 404, body: "Context not found" };

        return { statusCode: 200, body: JSON.stringify(result.Item) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
