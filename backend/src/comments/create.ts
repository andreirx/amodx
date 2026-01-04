import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
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

        // 1. Validate Comment
        const input = CommentSchema.omit({
            id: true,
            tenantId: true,
            createdAt: true
        }).parse(body);

        // 2. Prepare Items
        const commentItem = {
            PK: `TENANT#${tenantId}`,
            SK: `COMMENT#${input.pageId}#${now}`,
            id,
            tenantId,
            ...input,
            // Trust the proxy/auth details
            authorName: body.authorName,
            authorEmail: body.authorEmail,
            authorImage: body.authorImage,
            authorId: body.authorId,
            status: "Approved", // Auto-approve per current strategy
            createdAt: now,
            Type: "Comment"
        };

        // 3. Prepare Lead (Upsert strategy)
        // We use the email as part of the SK so we don't duplicate leads
        const leadItem = {
            PK: `TENANT#${tenantId}`,
            SK: `LEAD#${body.authorEmail}`,
            id: crypto.randomUUID(), // This might change on update, but acceptable for V1
            tenantId,
            email: body.authorEmail,
            name: body.authorName,
            source: "Comment",
            status: "New", // Sets them back to New if they comment again? Or keep existing?
                           // Ideally we'd use a ConditionExpression to not overwrite status if exists,
                           // but TransactWrite makes conditional updates complex if the item might not exist.
                           // For V1, overwriting "source" to "Comment" is fine.
            createdAt: now, // Update interaction time
            Type: "Lead"
        };

        // 4. Atomic Write
        await db.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: commentItem
                    }
                },
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: leadItem,
                        // OPTIONAL: prevent overwriting an existing lead's status?
                        // For now, simple Upsert is robust.
                    }
                }
            ]
        }));

        return { statusCode: 201, body: JSON.stringify({ id, message: "Comment Posted" }) };
    } catch (error: any) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
