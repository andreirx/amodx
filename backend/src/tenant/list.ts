import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        // Future TODO: Use event.requestContext.authorizer.lambda.sub to filter tenants

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
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
