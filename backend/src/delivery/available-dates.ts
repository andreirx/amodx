import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

function toDateStr(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: "DELIVERYCONFIG#default" }
        }));

        const config = result.Item || {};
        const leadDays: number = config.deliveryLeadDays ?? 1;
        const allowedDays: number[] = config.deliveryDaysOfWeek ?? [1, 2, 3, 4, 5];
        const blockedDates: string[] = config.blockedDates ?? [];
        const yearlyOffDays: string[] = config.yearlyOffDays ?? [];
        const unblockedDates: string[] = config.unblockedDates ?? [];

        const blockedSet = new Set(blockedDates);
        const yearlySet = new Set(yearlyOffDays);
        const unblockedSet = new Set(unblockedDates);

        // Priority: unblockedDates > blockedDates > yearlyOffDays > weekday check
        function isAvailable(date: Date): boolean {
            const dateStr = toDateStr(date);
            if (unblockedSet.has(dateStr)) return true;
            if (blockedSet.has(dateStr)) return false;
            const mmdd = dateStr.substring(5); // "MM-DD"
            if (yearlySet.has(mmdd)) return false;
            if (!allowedDays.includes(date.getDay())) return false;
            return true;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Step 1: Walk from tomorrow, count leadDays of AVAILABLE days (skip off-days)
        const cursor = new Date(today);
        let leadCounted = 0;

        while (leadCounted < leadDays) {
            cursor.setDate(cursor.getDate() + 1);
            if (isAvailable(cursor)) {
                leadCounted++;
            }
        }

        // If leadDays is 0, start from tomorrow
        if (leadDays === 0) {
            cursor.setTime(today.getTime());
            cursor.setDate(cursor.getDate() + 1);
        }

        // Step 2: From cursor, collect up to 30 available dates (scan up to 90 days)
        const dates: string[] = [];

        if (isAvailable(cursor)) {
            dates.push(toDateStr(cursor));
        }

        for (let i = 1; i < 90 && dates.length < 30; i++) {
            const candidate = new Date(cursor);
            candidate.setDate(cursor.getDate() + i);
            if (isAvailable(candidate)) {
                dates.push(toDateStr(candidate));
            }
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
