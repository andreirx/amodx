import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { TenantConfigSchema } from "@amodx/shared";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const body = JSON.parse(event.body);

        // Auto-generate ID from name if not provided
        const id = body.id || body.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

        const newTenant = {
            id,
            domain: body.domain || `${id}.localhost`, // Fallback for dev
            name: body.name,
            status: "LIVE",
            plan: "Pro",
            theme: body.theme || {
                primaryColor: "#000000",
                fontHeading: "Inter",
                fontBody: "Inter"
            },
            integrations: {},
            createdAt: new Date().toISOString()
        };

        // Validate
        const validTenant = TenantConfigSchema.parse(newTenant);

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: "SYSTEM",
                SK: `TENANT#${validTenant.id}`,
                ...validTenant,
                Domain: validTenant.domain // For GSI Lookup
            }
        }));

        // OPTIONAL: Create a default Home Page for them?
        // We can do that in a transaction or separate call.

        return { statusCode: 201, body: JSON.stringify(validTenant) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
