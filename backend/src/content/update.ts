import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand, TransactWriteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ContentItemSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import {publishAudit} from "../lib/events";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const auth = event.requestContext.authorizer.lambda;
        const nodeId = event.pathParameters?.id;

        if (!nodeId || !event.body) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing ID or Body" }) };
        }

        const body = JSON.parse(event.body);
        const input = ContentItemSchema.pick({
            title: true, blocks: true, status: true, slug: true
        }).partial().parse(body);

        const currentRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` }
        }));
        const current = currentRes.Item;

        if (!current) return { statusCode: 404, body: "Content not found" };

        const oldSlug = current.slug;
        const rawNewSlug = input.slug ?? oldSlug;
        const newSlug = rawNewSlug.startsWith("/") ? rawNewSlug : "/" + rawNewSlug;
        const slugChanged = newSlug !== oldSlug;

        const timestamp = new Date().toISOString();
        const userId = auth.sub;

        if (slugChanged) {
            await db.send(new TransactWriteCommand({
                TransactItems: [
                    {
                        // 1. OLD ROUTE -> Redirect
                        Put: {
                            TableName: TABLE_NAME,
                            Item: {
                                PK: `TENANT#${tenantId}`,
                                SK: `ROUTE#${oldSlug}`,
                                Type: "Route",
                                IsRedirect: true,
                                RedirectTo: newSlug,
                                CreatedAt: timestamp,
                                UpdatedBy: userId
                            }
                        }
                    },
                    {
                        // 2. NEW ROUTE
                        Put: {
                            TableName: TABLE_NAME,
                            Item: {
                                PK: `TENANT#${tenantId}`,
                                SK: `ROUTE#${newSlug}`,
                                TargetNode: `NODE#${nodeId}`,
                                Type: "Route",
                                Domain: "localhost",
                                CreatedAt: timestamp,
                                CreatedBy: userId
                            },
                            ConditionExpression: "attribute_not_exists(SK)"
                        }
                    },
                    {
                        // 3. UPDATE CONTENT
                        Update: {
                            TableName: TABLE_NAME,
                            Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` },
                            UpdateExpression: "SET title = :t, blocks = :b, #s = :s, slug = :sl, updatedAt = :u, updatedBy = :ub",
                            ExpressionAttributeNames: { "#s": "status" },
                            ExpressionAttributeValues: {
                                ":t": input.title || current.title,
                                ":b": input.blocks || current.blocks,
                                ":s": input.status || current.status,
                                ":sl": newSlug,
                                ":u": timestamp,
                                ":ub": userId
                            }
                        }
                    }
                ]
            }));
        } else {
            await db.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` },
                UpdateExpression: "SET title = :t, blocks = :b, #s = :s, updatedAt = :u, updatedBy = :ub",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: {
                    ":t": input.title || current.title,
                    ":b": input.blocks || current.blocks,
                    ":s": input.status || current.status,
                    ":u": timestamp,
                    ":ub": userId
                }
            }));
        }

        // Non-blocking (or awaited, it's fast)
        await publishAudit({
            tenantId,
            actorId: userId,
            action: "UPDATE_PAGE",
            details: { title: input.title },
            ip: event.requestContext.http.sourceIp
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Updated successfully", slug: newSlug }),
        };

    } catch (error: any) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
