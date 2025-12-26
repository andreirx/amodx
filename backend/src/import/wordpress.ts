import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { WXRParser } from "./wxr-parser.js";
import { HTMLToTiptapConverter } from "./html-to-tiptap.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

interface ImportResult {
    postsImported: number;
    pagesImported: number;
    imagesFound: number;
    errors: string[];
}

/**
 * WordPress Import Lambda Handler
 * Accepts WXR XML content and imports posts/pages into AMODX
 */
export const handler: AmodxHandler = async (event) => {
    try {
        if (!event.body) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing request body" }),
            };
        }

        const auth = event.requestContext.authorizer.lambda;
        const userId = auth.sub;

        // Parse request body
        const body = JSON.parse(event.body);
        const { tenantId, wxrContent } = body;

        if (!tenantId || !wxrContent) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing tenantId or wxrContent" }),
            };
        }

        // Initialize parsers
        const wxrParser = new WXRParser();
        const htmlConverter = new HTMLToTiptapConverter();

        // Parse WXR content
        console.log("Parsing WXR content...");
        const parsed = wxrParser.parse(wxrContent);

        const result: ImportResult = {
            postsImported: 0,
            pagesImported: 0,
            imagesFound: parsed.images.length,
            errors: [],
        };

        const now = new Date().toISOString();

        // Import posts
        for (const post of parsed.posts) {
            try {
                const nodeId = crypto.randomUUID();
                const contentId = crypto.randomUUID();

                // Convert HTML to Tiptap blocks
                const blocks = htmlConverter.convert(post.content);

                // Create content item
                await db.send(
                    new PutCommand({
                        TableName: TABLE_NAME,
                        Item: {
                            PK: `TENANT#${tenantId}`,
                            SK: `CONTENT#${nodeId}#LATEST`,
                            id: contentId,
                            nodeId,
                            slug: `/${post.slug}`,
                            title: post.title,
                            status: post.status === "publish" ? "Published" : "Draft",
                            version: 1,
                            author: userId,
                            createdAt: post.publishedAt || now,
                            Type: "Post",
                            blocks,
                        },
                    })
                );

                // Create route if published
                if (post.status === "publish") {
                    await db.send(
                        new PutCommand({
                            TableName: TABLE_NAME,
                            Item: {
                                PK: `TENANT#${tenantId}`,
                                SK: `ROUTE#/${post.slug}`,
                                TargetNode: `NODE#${nodeId}`,
                                Type: "Route",
                                CreatedAt: now,
                            },
                        })
                    );
                }

                result.postsImported++;
            } catch (error: any) {
                console.error(`Failed to import post: ${post.title}`, error);
                result.errors.push(`Post "${post.title}": ${error.message}`);
            }
        }

        // Import pages
        for (const page of parsed.pages) {
            try {
                const nodeId = crypto.randomUUID();
                const contentId = crypto.randomUUID();

                // Convert HTML to Tiptap blocks
                const blocks = htmlConverter.convert(page.content);

                // Create content item
                await db.send(
                    new PutCommand({
                        TableName: TABLE_NAME,
                        Item: {
                            PK: `TENANT#${tenantId}`,
                            SK: `CONTENT#${nodeId}#LATEST`,
                            id: contentId,
                            nodeId,
                            slug: `/${page.slug}`,
                            title: page.title,
                            status: page.status === "publish" ? "Published" : "Draft",
                            version: 1,
                            author: userId,
                            createdAt: page.publishedAt || now,
                            Type: "Page",
                            blocks,
                        },
                    })
                );

                // Create route if published
                if (page.status === "publish") {
                    await db.send(
                        new PutCommand({
                            TableName: TABLE_NAME,
                            Item: {
                                PK: `TENANT#${tenantId}`,
                                SK: `ROUTE#/${page.slug}`,
                                TargetNode: `NODE#${nodeId}`,
                                Type: "Route",
                                CreatedAt: now,
                            },
                        })
                    );
                }

                result.pagesImported++;
            } catch (error: any) {
                console.error(`Failed to import page: ${page.title}`, error);
                result.errors.push(`Page "${page.title}": ${error.message}`);
            }
        }

        console.log("Import completed:", result);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Import completed",
                result,
            }),
        };
    } catch (error: any) {
        console.error("WordPress Import Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message,
                details: error.stack,
            }),
        };
    }
};
