import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const email = event.pathParameters?.email
            ? decodeURIComponent(event.pathParameters.email)
            : undefined;

        if (!tenantId || !email) return { statusCode: 400, body: JSON.stringify({ error: "Missing parameters" }) };

        const auth = event.requestContext.authorizer.lambda;
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        // Fetch customer record
        const customerResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CUSTOMER#${email}` }
        }));

        if (!customerResult.Item) return { statusCode: 404, body: JSON.stringify({ error: "Customer not found" }) };

        // Fetch customer orders
        const ordersResult = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `CUSTORDER#${email}#`
            }
        }));

        return {
            statusCode: 200,
            body: JSON.stringify({
                customer: customerResult.Item,
                orders: ordersResult.Items || []
            })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
