import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// POST /themes - Save a new theme
const _createHandler: Handler = async (event) => {
    try {
        const auth = event.requestContext.authorizer.lambda;

        // THEME-ROLES-1 (docs/slices/theme-roles-1.md): the library is shared by all sites (PK SYSTEM). Saving:
        // GLOBAL_ADMIN and TENANT_ADMIN of any tenant — no tenant argument, the item belongs to no tenant.
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN"]);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

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
const _deleteHandler: Handler = async (event) => {
    try {
        // THEME-ROLES-1: deleting an entry every site lists is the agency's only (GLOBAL_ADMIN, the MCP master key too).
        try {
            requireRole(event.requestContext.authorizer.lambda, ["GLOBAL_ADMIN"]);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

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

export const createHandler = withInvalidation(_createHandler);
export const deleteHandler = withInvalidation(_deleteHandler);
