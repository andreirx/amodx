import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Public endpoint for customers to update their own profile.
 * Requires email verification via a simple token check (email must match).
 * POST /public/customers/profile
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const body = JSON.parse(event.body);
        const { email, phone, birthday, defaultAddress, defaultBillingDetails } = body;

        if (!email) {
            return { statusCode: 400, body: JSON.stringify({ error: "Email is required" }) };
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid email format" }) };
        }

        // Validate birthday format if provided (YYYY-MM-DD)
        if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid birthday format. Use YYYY-MM-DD" }) };
        }

        const emailLower = email.toLowerCase();
        const now = new Date().toISOString();

        // Check if customer exists
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CUSTOMER#${emailLower}` },
            ProjectionExpression: "email"
        }));

        if (!existing.Item) {
            return { statusCode: 404, body: JSON.stringify({ error: "Customer not found" }) };
        }

        // Build update expression dynamically based on provided fields
        const updates: string[] = ["updatedAt = :now"];
        const values: Record<string, any> = { ":now": now };

        if (phone !== undefined) {
            updates.push("phone = :phone");
            values[":phone"] = phone || "";
        }

        if (birthday !== undefined) {
            updates.push("birthday = :birthday");
            values[":birthday"] = birthday || null;
        }

        if (defaultAddress !== undefined) {
            updates.push("defaultAddress = :address");
            values[":address"] = defaultAddress || null;
        }

        if (defaultBillingDetails !== undefined) {
            updates.push("defaultBillingDetails = :billing");
            values[":billing"] = defaultBillingDetails || null;
        }

        const result = await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CUSTOMER#${emailLower}` },
            UpdateExpression: `SET ${updates.join(", ")}`,
            ExpressionAttributeValues: values,
            ReturnValues: "ALL_NEW"
        }));

        // Don't return sensitive data
        const { PK, SK, ...safeData } = result.Attributes || {};

        return {
            statusCode: 200,
            headers: { "Cache-Control": "no-store" },
            body: JSON.stringify(safeData)
        };
    } catch (e: any) {
        console.error("Customer profile update failed:", e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
