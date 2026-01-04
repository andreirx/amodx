import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TenantConfigSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import {publishAudit} from "../lib/events";
import { requireRole } from "../auth/policy.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        const auth = event.requestContext.authorizer.lambda;

        // SECURITY: Only Global Admin can create tenants
        try {
            requireRole(auth, []); // Empty array + Global check means ONLY Global Admin passes
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!event.body) return { statusCode: 400, body: "Missing body" };

        const userId = auth.sub;
        const body = JSON.parse(event.body);

        // Auto-generate ID
        const id = body.id || body.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

        const now = new Date().toISOString();

        // 1. Prepare Tenant Record
        const newTenant = {
            id,
            domain: body.domain || `${id}.localhost`,
            name: body.name,
            status: "LIVE",
            plan: "Pro",
            theme: body.theme || {
                primaryColor: "#000000",
                fontHeading: "Inter",
                fontBody: "Inter"
            },
            integrations: {},
            createdAt: now,
            ownerId: userId,
            createdBy: userId
        };
        const validTenant = TenantConfigSchema.parse(newTenant);

        // 2. Prepare Default Home Page
        const homeNodeId = crypto.randomUUID();
        const homeContentId = crypto.randomUUID();

        const homePage = {
            PK: `TENANT#${id}`,
            SK: `CONTENT#${homeNodeId}#LATEST`,
            id: homeContentId,
            nodeId: homeNodeId,
            slug: "/",
            title: "Home",
            status: "Published", // Auto-publish home
            version: 1,
            author: userId,
            createdAt: now,
            Type: "Page",
            blocks: [
                {
                    type: "hero",
                    attrs: {
                        headline: `Welcome to ${validTenant.name}`,
                        subheadline: "This site is powered by AMODX.",
                        ctaText: "Get Started",
                        style: "center"
                    }
                }
            ]
        };

        const homeRoute = {
            PK: `TENANT#${id}`,
            SK: `ROUTE#/`,
            TargetNode: `NODE#${homeNodeId}`,
            Type: "Route",
            CreatedAt: now
        };

        // 3. Prepare Default Contact Page
        const contactNodeId = crypto.randomUUID();
        const contactContentId = crypto.randomUUID();

        const contactPage = {
            PK: `TENANT#${id}`,
            SK: `CONTENT#${contactNodeId}#LATEST`,
            id: contactContentId,
            nodeId: contactNodeId,
            slug: "/contact",
            title: "Contact Us",
            status: "Published",
            version: 1,
            author: userId,
            createdAt: now,
            Type: "Page",
            blocks: [
                {
                    type: "heading",
                    attrs: { level: 1 },
                    content: [{ type: "text", text: "Contact Us" }]
                },
                {
                    type: "contact",
                    attrs: {
                        headline: "Send us a message",
                        buttonText: "Send"
                    }
                }
            ]
        };

        const contactRoute = {
            PK: `TENANT#${id}`,
            SK: `ROUTE#/contact`,
            TargetNode: `NODE#${contactNodeId}`,
            Type: "Route",
            CreatedAt: now
        };

        // 4. Execute Transaction (All or Nothing)
        await db.send(new TransactWriteCommand({
            TransactItems: [
                // Tenant Config (System Partition)
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            PK: "SYSTEM",
                            SK: `TENANT#${validTenant.id}`,
                            ...validTenant,
                            Domain: validTenant.domain
                        },
                        // Ensure ID doesn't exist
                        ConditionExpression: "attribute_not_exists(SK)"
                    }
                },
                // Home Page
                { Put: { TableName: TABLE_NAME, Item: homePage } },
                { Put: { TableName: TABLE_NAME, Item: homeRoute } },
                // Contact Page
                { Put: { TableName: TABLE_NAME, Item: contactPage } },
                { Put: { TableName: TABLE_NAME, Item: contactRoute } }
            ]
        }));

        return { statusCode: 201, body: JSON.stringify(validTenant) };

    } catch (error: any) {
        console.error("Tenant Create Error:", error);
        // Handle Duplicate ID
        if (error.name === 'TransactionCanceledException') {
            return { statusCode: 409, body: JSON.stringify({ error: "Tenant ID already exists" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
