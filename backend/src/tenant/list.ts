import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        const auth = event.requestContext.authorizer.lambda;
        const role = auth.role;

        // 1. GLOBAL ADMIN: List All
        if (role === 'GLOBAL_ADMIN') {
            const result = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues: {
                    ":pk": "SYSTEM",
                    ":sk": "TENANT#"
                }
            }));

            const tenants = result.Items?.map(item => ({
                id: item.id,
                name: item.name,
                domain: item.domain,
                status: item.status
            })) || [];

            return { statusCode: 200, body: JSON.stringify({ items: tenants }) };
        }

        // 2. TENANT SPECIFIC USER: Get Single Tenant
        // If they are a Tenant Admin or Editor, they can only see their own tenant in the list
        if (auth.tenantId && auth.tenantId !== 'GLOBAL') {
            const result = await db.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: {
                    PK: "SYSTEM",
                    SK: `TENANT#${auth.tenantId}`
                }
            }));

            if (!result.Item) return { statusCode: 200, body: JSON.stringify({ items: [] }) };

            const tenant = {
                id: result.Item.id,
                name: result.Item.name,
                domain: result.Item.domain,
                status: result.Item.status
            };

            return { statusCode: 200, body: JSON.stringify({ items: [tenant] }) };
        }

        // 3. Fallback: No access
        return { statusCode: 200, body: JSON.stringify({ items: [] }) };

    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
