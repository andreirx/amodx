import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand, TransactWriteCommand, GetCommand, DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ContentItemSchema } from "@amodx/shared";

// Helper for slug generation
const toSlug = (str: string) => "/" + str.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = "DEMO";
        const nodeId = event.pathParameters?.id;

        if (!nodeId || !event.body) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing ID or Body" }) };
        }

        const body = JSON.parse(event.body);

        // We allow passing 'slug' in the body now
        const input = ContentItemSchema.pick({
            title: true, blocks: true, status: true, slug: true
        }).partial().parse(body);

        // 1. Fetch Current Page (To see if slug changed)
        const currentRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `SITE#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` }
        }));
        const current = currentRes.Item;

        if (!current) return { statusCode: 404, body: "Content not found" };

        const oldSlug = current.slug;

        // Only update slug if explicitly provided in input.
        // Never auto-generate from title during an update.
        const rawNewSlug = input.slug ?? oldSlug;
        const newSlug = rawNewSlug.startsWith("/") ? rawNewSlug : "/" + rawNewSlug;

        const slugChanged = newSlug !== oldSlug;

        // 2. Prepare Update Logic
        const timestamp = new Date().toISOString();

        // If slug changed, we need a Transaction:
        // - Delete Old Route
        // - Create New Route
        // - Update Content

        if (slugChanged) {
            await db.send(new TransactWriteCommand({
                TransactItems: [
                    {
                        // 1. OLD ROUTE: Become a Redirect
                        Put: {
                            TableName: TABLE_NAME,
                            Item: {
                                PK: `SITE#${tenantId}`,
                                SK: `ROUTE#${oldSlug}`,
                                Type: "Route",
                                IsRedirect: true,        // <--- Flag
                                RedirectTo: newSlug,     // <--- Destination
                                CreatedAt: timestamp
                            }
                            // We overwrite whatever was there
                        }
                    },
                    {
                        // 2. NEW ROUTE: Point to Node
                        Put: {
                            TableName: TABLE_NAME,
                            Item: {
                                PK: `SITE#${tenantId}`,
                                SK: `ROUTE#${newSlug}`,
                                TargetNode: `NODE#${nodeId}`,
                                Type: "Route",
                                Domain: "localhost",
                                CreatedAt: timestamp
                            },
                            ConditionExpression: "attribute_not_exists(SK)"
                        }
                    },
                    {
                        // 3. UPDATE CONTENT
                        Update: {
                            TableName: TABLE_NAME,
                            Key: { PK: `SITE#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` },
                            UpdateExpression: "SET title = :t, blocks = :b, #s = :s, slug = :sl, updatedAt = :u",
                            ExpressionAttributeNames: { "#s": "status" },
                            ExpressionAttributeValues: {
                                ":t": input.title || current.title,
                                ":b": input.blocks || current.blocks,
                                ":s": input.status || current.status,
                                ":sl": newSlug,
                                ":u": timestamp
                            }
                        }
                    }
                ]
            }));
        } else {
            // Simple Update (No slug change)
            await db.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: `SITE#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` },
                UpdateExpression: "SET title = :t, blocks = :b, #s = :s, updatedAt = :u",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: {
                    ":t": input.title || current.title,
                    ":b": input.blocks || current.blocks,
                    ":s": input.status || current.status,
                    ":u": timestamp
                }
            }));
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Updated successfully", slug: newSlug }),
        };

    } catch (error: any) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
