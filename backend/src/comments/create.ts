import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { CommentSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };

        const body = JSON.parse(event.body || "{}");

        // 1. Trust the Proxy
        // Since the request passed the Authorizer with Master Key (Robot),
        // we accept the author details provided in the body.

        // Schema Validation (Ensure body contains author details)
        // We might need to update CommentSchema to make sure these are required in the payload
        // if we are passing them from the proxy.
        // For now, let's merge manually to ensure they overwrite any defaults.

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const input = CommentSchema.omit({
            id: true,
            tenantId: true,
            createdAt: true
        }).parse(body);

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `COMMENT#${input.pageId}#${now}`,
                id,
                tenantId,
                ...input,
                // Explicitly mapping these to be sure
                authorName: body.authorName,
                authorEmail: body.authorEmail,
                authorImage: body.authorImage,
                authorId: body.authorId,

                status: "Approved",
                createdAt: now,
                Type: "Comment"
            }
        }));

        return { statusCode: 201, body: JSON.stringify({ id, message: "Comment Posted" }) };
    } catch (error: any) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
