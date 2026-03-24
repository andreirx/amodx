import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js"; // <--- Added .js
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js"; // <--- Added .js
import { publishAudit } from "../lib/events.js"; // <--- Added .js
import { requireRole } from "../auth/policy.js"; // <--- Added .js
import { withInvalidation } from "../lib/invalidate-cdn.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * Strips secret fields from tenant config before returning to any caller.
 * Secrets are served exclusively via GET /settings/secrets (TENANT_ADMIN/GLOBAL_ADMIN only).
 *
 * IMPORTANT: When adding new secret fields to TenantConfig, add them here too.
 * Current secret fields:
 *   - recaptcha.secretKey
 *   - integrations.google.clientSecret
 *   - integrations.braveApiKey
 */
function redactSecrets(config: Record<string, any>): Record<string, any> {
    const redacted = structuredClone(config);

    if (redacted.recaptcha) {
        delete redacted.recaptcha.secretKey;
    }

    if (redacted.integrations) {
        if (redacted.integrations.google) {
            delete redacted.integrations.google.clientSecret;
        }
        delete redacted.integrations.braveApiKey;
    }

    return redacted;
}

export const getHandler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        // 1. FAIL if no tenant ID
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // 2. ENFORCE Policy
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: "SYSTEM",
                SK: `TENANT#${tenantId}`
            }
        }));

        // Default if not found
        const config = result.Item || {
            id: tenantId,
            domain: "localhost",
            name: "Untitled Site",
            status: "LIVE",
            plan: "Pro",
            theme: { primaryColor: "#000000" }
        };

        // SECURITY: Strip secrets for all callers. Use GET /settings/secrets for privileged access.
        return { statusCode: 200, body: JSON.stringify(redactSecrets(config)) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

const _updateHandler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        // CRITICAL FIX: Early return narrows type from (string | undefined) to (string)
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // SECURITY
        try {
            requireRole(auth, ["TENANT_ADMIN", "GLOBAL_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const body = JSON.parse(event.body);

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));

        const current = result.Item || { name: "Unknown" };
        const merged = { ...current, ...body };

        // Deep-merge nested objects that contain secret fields.
        // GET /settings strips recaptcha.secretKey, integrations.google.clientSecret,
        // and integrations.braveApiKey. The client sends the full config on PUT, but
        // those fields are absent because they were never in the response.
        // Without deep-merge, { ...current, ...body } replaces the entire nested object,
        // deleting the secret fields that existed in `current`.
        if (body.integrations && current.integrations) {
            merged.integrations = { ...current.integrations, ...body.integrations };
            // google sub-object needs its own merge (contains clientSecret)
            if (current.integrations.google || body.integrations?.google) {
                merged.integrations.google = {
                    ...current.integrations.google,
                    ...body.integrations?.google,
                };
            }
        }
        if (body.recaptcha && current.recaptcha) {
            merged.recaptcha = { ...current.recaptcha, ...body.recaptcha };
        }

        // Metadata updates
        merged.updatedBy = auth.sub;
        merged.updatedAt = new Date().toISOString();

        if (merged.domain) {
            merged.Domain = merged.domain;
        }
        delete merged.error;

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: "SYSTEM",
                SK: `TENANT#${tenantId}`,
                ...merged,
            }
        }));

        // AUDIT LOG
        await publishAudit({
            tenantId: tenantId, // TS is happy now because of the early return above
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_SETTINGS",
            target: { title: current.name || "Settings" },
            details: { updatedFields: Object.keys(body) },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Settings Saved" }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export const updateHandler = withInvalidation(_updateHandler);
