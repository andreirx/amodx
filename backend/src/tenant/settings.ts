import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { TenantConfigSchema } from "@amodx/shared";

export const getHandler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        // Resolve ID from header or path, OR hardcode to DEMO for safety if missing
        // For settings, usually we want the settings OF the current tenant.
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: "SYSTEM",
                SK: `TENANT#${tenantId}`
            }
        }));

        // Return default if not exists
        const config = result.Item || {
            id: tenantId,
            domain: "localhost",
            name: "My Agency Site",
            status: "LIVE",
            plan: "Pro",
            theme: { primaryColor: "#000000" }
        };

        return { statusCode: 200, body: JSON.stringify(config) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export const updateHandler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const body = JSON.parse(event.body);

        // 1. Fetch Current State Directly (Don't reuse getHandler to avoid response wrapping confusion)
        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));

        const current = result.Item || {};

        // 2. Merge (Cleanly)
        const merged = { ...current, ...body };
        // SYNC GSI: Ensure 'Domain' matches 'domain'
        if (merged.domain) {
            merged.Domain = merged.domain;
        }

        // 3. Cleanup (Remove any previous error pollution)
        delete merged.error;

        // 4. Save to DB
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: "SYSTEM",
                SK: `TENANT#${tenantId}`,
                ...merged,
                Domain: merged.domain // Ensure GSI key is set
            }
        }));

        return { statusCode: 200, body: JSON.stringify({ message: "Settings Saved" }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
