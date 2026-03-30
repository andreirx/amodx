import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const _handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };

        // Email is URL-encoded in path
        const email = decodeURIComponent(event.pathParameters?.email || "");
        if (!email) return { statusCode: 400, body: "Missing email parameter" };

        await db.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `LEAD#${email}`
            }
        }));

        return { statusCode: 200, body: JSON.stringify({ message: "Deleted" }) };
    } catch (error: any) {
        console.error("Delete lead error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export const handler = _handler;
