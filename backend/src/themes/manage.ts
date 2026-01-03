import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// POST /themes - Save a new theme
export const createHandler: Handler = async (event) => {
    try {
        const auth = event.requestContext.authorizer.lambda;

        // Security: Only Global Admins should create shared themes for now
        // Or Tenant Admins can create themes for their tenant?
        // Let's allow anyone to create for now, filtered by scope in V2.

        const body = JSON.parse(event.body || "{}");
        if (!body.name || !body.theme) return { statusCode: 400, body: "Missing name or theme data" };

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const item = {
            PK: "SYSTEM",
            SK: `THEME#${id}`,
            id,
            name: body.name,
            theme: body.theme, // The JSON object of colors/fonts
            createdBy: auth.sub,
            createdAt: now,
            Type: "Theme"
        };

        await db.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
        return { statusCode: 201, body: JSON.stringify(item) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

// GET /themes - List available themes
export const listHandler: Handler = async () => {
    try {
        const res = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": "SYSTEM", ":sk": "THEME#" }
        }));
        return { statusCode: 200, body: JSON.stringify({ items: res.Items || [] }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

// DELETE /themes/{id}
export const deleteHandler: Handler = async (event) => {
    try {
        const id = event.pathParameters?.id;
        if (!id) return { statusCode: 400, body: "Missing ID" };

        await db.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `THEME#${id}` }
        }));
        return { statusCode: 200, body: JSON.stringify({ message: "Deleted" }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
