import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // Fetch delivery config
        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: "DELIVERYCONFIG#default" }
        }));

        const config = result.Item || {};
        const leadDays: number = config.deliveryLeadDays ?? 1;
        const allowedDays: number[] = config.deliveryDaysOfWeek ?? [1, 2, 3, 4, 5];
        const blockedDates: string[] = config.blockedDates ?? [];
        const blockedSet = new Set(blockedDates);

        const dates: string[] = [];
        const today = new Date();
        // Start from today + leadDays
        const start = new Date(today);
        start.setDate(start.getDate() + leadDays);

        for (let i = 0; i < 60; i++) {
            if (dates.length >= 30) break;

            const candidate = new Date(start);
            candidate.setDate(start.getDate() + i);

            // getDay(): 0=Sunday, 1=Monday ... 6=Saturday
            const dayOfWeek = candidate.getDay();

            if (!allowedDays.includes(dayOfWeek)) continue;

            const dateStr = candidate.toISOString().split("T")[0];

            if (blockedSet.has(dateStr)) continue;

            dates.push(dateStr);
        }

        return {
            statusCode: 200,
            headers: { "Cache-Control": "public, max-age=3600" },
            body: JSON.stringify({ dates })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
