import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";

/**
 * Customer profile update — called via renderer proxy only.
 * Requires RENDERER or GLOBAL_ADMIN role (renderer sends its API key).
 * The renderer proxy (renderer/src/app/api/profile/route.ts) enforces
 * NextAuth session validation and substitutes the session email,
 * preventing callers from modifying arbitrary profiles.
 *
 * Role enforcement:
 *   - RENDERER: renderer Lambda (x-api-key = renderer secret)
 *   - GLOBAL_ADMIN: system robot (x-api-key = master secret)
 *   - EDITOR / TENANT_ADMIN via Cognito: REJECTED (403)
 *
 * tenantId is NOT passed to requireRole because RENDERER has tenantId "ALL",
 * which does not equal any specific tenant ID. The role gate alone is sufficient
 * because only service accounts (RENDERER, GLOBAL_ADMIN) hold these roles.
 *
 * POST /public/customers/profile
 */
type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const _handler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // Only service accounts (RENDERER proxy, GLOBAL_ADMIN robot) may call this.
        // Regular Cognito users must use the renderer proxy, which validates their session.
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "RENDERER"]);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

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

export const handler = withInvalidation(_handler);
