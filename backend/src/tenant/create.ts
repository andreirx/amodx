import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { TenantConfigSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        if (!event.body) return { statusCode: 400, body: "Missing body" };

        // 1. Get User Identity
        const auth = event.requestContext.authorizer.lambda;
        const userId = auth.sub;

        const body = JSON.parse(event.body);

        // Auto-generate ID from name
        const id = body.id || body.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

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
            createdAt: new Date().toISOString(),
            ownerId: userId, // <--- RECORD OWNERSHIP
            createdBy: userId
        };

        const validTenant = TenantConfigSchema.parse(newTenant);

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: "SYSTEM",
                SK: `TENANT#${validTenant.id}`,
                ...validTenant,
                Domain: validTenant.domain
            }
        }));

        // OPTIONAL: We could create a USER mapping record here (PK: USER#id SK: TENANT#id)
        // to make listing "My Sites" faster later.

        return { statusCode: 201, body: JSON.stringify(validTenant) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
