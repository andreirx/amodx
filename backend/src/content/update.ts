import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand, TransactWriteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { z } from "zod"; // Import Zod directly

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// STRICT SCHEMA - No Defaults!
const StrictUpdateSchema = z.object({
    title: z.string().optional(),
    slug: z.string().optional(),
    status: z.string().optional(),
    commentsMode: z.string().optional(),
    // Crucial: No .default([]) here. If it's missing, it's undefined.
    blocks: z.array(z.any()).optional(),

    // SEO
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    seoKeywords: z.string().optional(),
    featuredImage: z.string().optional(),

    // Overrides
    themeOverride: z.any().optional(),
    hideNav: z.boolean().optional(),
    hideFooter: z.boolean().optional(),
});

export const handler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const auth = event.requestContext.authorizer.lambda;
        const nodeId = event.pathParameters?.id;

        if (!nodeId || !event.body) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing ID or Body" }) };
        }

        const body = JSON.parse(event.body);

        // 1. Parse using the strict local schema
        // This guarantees 'blocks' is undefined if not sent, never []
        const input = StrictUpdateSchema.parse(body);

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

        // 2. Merge Logic using strict undefined checks
        // If input.blocks is undefined, use current.blocks.
        const updateValues = {
            ":t": input.title ?? current.title,
            ":b": input.blocks ?? current.blocks, // <--- SAFETY
            ":s": input.status ?? current.status,
            ":cm": input.commentsMode ?? current.commentsMode ?? "Hidden",

            ":st": input.seoTitle ?? current.seoTitle ?? null,
            ":sd": input.seoDescription ?? current.seoDescription ?? null,
            ":sk": input.seoKeywords ?? current.seoKeywords ?? null,
            ":fi": input.featuredImage ?? current.featuredImage ?? null,

            ":to": input.themeOverride ?? current.themeOverride ?? {},
            ":hn": input.hideNav ?? current.hideNav ?? false,
            ":hf": input.hideFooter ?? current.hideFooter ?? false,

            ":u": timestamp,
            ":ub": userId
        };

        const updateExprBase = "SET title = :t, blocks = :b, #s = :s, commentsMode = :cm, seoTitle = :st, seoDescription = :sd, seoKeywords = :sk, featuredImage = :fi, themeOverride = :to, hideNav = :hn, hideFooter = :hf, updatedAt = :u, updatedBy = :ub";

        if (slugChanged) {
            // ... (TransactWriteCommand logic remains identical to previous version)
            // Copy logic from previous step or repo, ensuring Update uses updateValues
            await db.send(new TransactWriteCommand({
                TransactItems: [
                    {
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
                        Update: {
                            TableName: TABLE_NAME,
                            Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` },
                            UpdateExpression: updateExprBase + ", slug = :sl",
                            ExpressionAttributeNames: { "#s": "status" },
                            ExpressionAttributeValues: {
                                ...updateValues,
                                ":sl": newSlug
                            }
                        }
                    }
                ]
            }));
        } else {
            await db.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` },
                UpdateExpression: updateExprBase,
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: updateValues
            }));
        }

        await publishAudit({
            tenantId,
            actorId: userId,
            action: "UPDATE_PAGE",
            details: { title: input.title, status: input.status },
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
