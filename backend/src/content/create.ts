import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb"; // <--- Using Transactions
import { ContentItemSchema } from "@amodx/shared";

// Helper: Simple slug generator
const toSlug = (str: string) => "/" + str.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const body = JSON.parse(event.body);
        const tenantId = "DEMO";

        // Validate Input
        const input = ContentItemSchema.omit({
            id: true, createdAt: true, author: true, nodeId: true, version: true
        }).parse(body);

        const nodeId = crypto.randomUUID();
        const contentId = crypto.randomUUID();
        const now = new Date().toISOString();

        // 1. Generate Slug
        // In a real app, you might let the user define this or check for collisions.
        const slug = toSlug(input.title);

        // 2. Atomic Transaction
        await db.send(new TransactWriteCommand({
            TransactItems: [
                {
                    // A. Create the Content Record
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            PK: `SITE#${tenantId}`,
                            SK: `CONTENT#${nodeId}#LATEST`,
                            ...input,
                            id: contentId,
                            nodeId: nodeId,
                            slug: slug,
                            version: 1,
                            createdAt: now,
                            author: "Admin",
                            Type: "Page",
                        }
                    }
                },
                {
                    // B. Create the Route Record
                    // This is what the Renderer looks up!
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            PK: `SITE#${tenantId}`,
                            SK: `ROUTE#${slug}`,
                            TargetNode: `NODE#${nodeId}`, // Points to the content
                            Type: "Route",
                            Domain: "localhost", // For GSI Lookup
                            CreatedAt: now
                        },
                        // Fail if route already exists (prevent overwrite)
                        ConditionExpression: "attribute_not_exists(SK)"
                    }
                }
            ]
        }));

        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "Page Created",
                id: contentId,
                nodeId: nodeId,
                slug: slug
            }),
        };

    } catch (error: any) {
        console.error(error);
        // Handle Route Collision
        if (error.name === "TransactionCanceledException") {
            return { statusCode: 409, body: JSON.stringify({ error: "Page with this title/slug already exists" }) };
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
