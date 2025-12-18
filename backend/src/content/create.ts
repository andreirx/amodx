import {
    APIGatewayProxyHandlerV2WithLambdaAuthorizer
} from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ContentItemSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js"; // Import your context definition
import { publishAudit } from "../lib/events.js";


// Typed Handler
type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const toSlug = (str: string) => "/" + str.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

export const handler: AmodxHandler = async (event) => {
    try {
        // 1. Get User Info from Authorizer
        // This is guaranteed to exist because the Authorizer ran first
        const auth = event.requestContext.authorizer.lambda;
        const userId = auth.sub;
        const authorName = auth.email || "Robot";

        // 2. Resolve Tenant
        const tenantId = event.headers['x-tenant-id'] || "DEMO";

        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const body = JSON.parse(event.body);

        const input = ContentItemSchema.omit({
            id: true, createdAt: true, author: true, nodeId: true, version: true
        }).parse(body);

        const nodeId = crypto.randomUUID();
        const contentId = crypto.randomUUID();
        const now = new Date().toISOString();
        const slug = toSlug(input.title);

        await db.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            PK: `TENANT#${tenantId}`,
                            SK: `CONTENT#${nodeId}#LATEST`,
                            ...input,
                            id: contentId,
                            nodeId: nodeId,
                            slug: slug,
                            version: 1,
                            createdAt: now,
                            author: userId,
                            authorEmail: authorName,
                            Type: "Page",
                        }
                    }
                },
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            PK: `TENANT#${tenantId}`,
                            SK: `ROUTE#${slug}`,
                            TargetNode: `NODE#${nodeId}`,
                            Type: "Route",
                            Domain: "localhost",
                            CreatedAt: now
                        },
                        ConditionExpression: "attribute_not_exists(SK)"
                    }
                }
            ]
        }));

        // Non-blocking (or awaited, it's fast)
        await publishAudit({
            tenantId,
            actorId: userId,
            action: "CREATE_PAGE",
            details: { title: input.title, slug },
            ip: event.requestContext.http.sourceIp
        });


        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "Page Created",
                id: contentId,
                nodeId: nodeId,
                slug: slug,
                tenantId
            }),
        };

    } catch (error: any) {
        console.error(error);
        if (error.name === "TransactionCanceledException") {
            return { statusCode: 409, body: JSON.stringify({ error: "Page with this title/slug already exists" }) };
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
