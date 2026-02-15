import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import {requireRole} from "../auth/policy.js";
import { deleteCatProductItems } from "../lib/catprod.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const id = event.pathParameters?.id;
        const auth = event.requestContext.authorizer.lambda;

        // SECURITY: Editors allowed
        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId || !id) return { statusCode: 400, body: "Missing ID" };

        // Fetch product to get categoryIds for CATPROD# cleanup
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${id}` }
        }));

        // Delete the product
        await db.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${id}` }
        }));

        // Clean up CATPROD# adjacency items
        const oldCategoryIds = existing.Item?.categoryIds as string[] | undefined;
        if (oldCategoryIds && oldCategoryIds.length > 0) {
            await deleteCatProductItems(tenantId, id, oldCategoryIds);
        }

        return { statusCode: 200, body: JSON.stringify({ message: "Deleted" }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
