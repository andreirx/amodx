import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js"; // <--- Added .js
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js"; // <--- Added .js
import { publishAudit } from "../lib/events.js"; // <--- Added .js
import { requireRole } from "../auth/policy.js"; // <--- Added .js
import { withInvalidation } from "../lib/invalidate-cdn.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * SETTINGS-KEYS-1 — fields of the tenant record that only the server sets (see `tenant/create.ts`).
 * PUT /settings removes them from the request body before the merge. Before this rule, `{ ...current, ...body }`
 * let a body `PK`/`SK` choose WHICH item of the single table was written (another tenant's record, or any item
 * such as `TENANT#<t>`/`PRODUCT#<p>`), and a body `id` relabelled the record (the renderer's `mapTenant` copies
 * `item.id` as the tenant id). `Domain` is derived from `domain`; `createdAt`/`createdBy` come from the stored record.
 * The handler, not the body, names the item: the written Item sets PK, SK and id after the spread.
 *
 * SETTINGS-KEYS-1B — the rule: no request field may name a key of the table or of any GSI
 * (`infra/lib/database.ts:27-51`: GSI_Domain `Domain`/`PK`, GSI_Type `Type`/`CreatedAt`,
 * GSI_Status `Status`/`ScheduledFor`, GSI_Slug `TenantSlug`). A body `TenantSlug: "<other>#<slug>"` plus
 * `Type: "Product"` placed this record (secrets included) in another tenant's GSI_Slug partition, where
 * `GET /public/products/{slug}` returned it.
 * See docs/slices/settings-keys-1.md §§ 2, 12.
 */
const SERVER_OWNED_FIELDS = [
    "PK", "SK", "id", "Domain", "createdAt", "createdBy",
    "Type", "CreatedAt", "Status", "ScheduledFor", "TenantSlug",
] as const;

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
        const rejectedFields = SERVER_OWNED_FIELDS.filter((field) => Object.hasOwn(body, field));
        for (const field of rejectedFields) delete body[field];

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

        // SETTINGS-KEYS-1B — best-effort hostname claim check: reject a new hostname when another tenant's record is
        // visible in GSI_Domain now. Two identity resolvers (renderer getTenantConfig, lib/tenant-verify
        // getTenantByDomain) take the first GSI_Domain hit, so two tenant records on one hostname make the answer
        // undefined. Checked only when the hostname changes, so a record that already shares a hostname can still
        // save its other settings. NOT a uniqueness guarantee: overlapping requests (check-then-write) and GSI
        // propagation lag (GSIs are eventually consistent; also hits sequential requests) can both let two tenants
        // store the same hostname (docs/slices/settings-keys-1.md § 12.4).
        if (merged.domain && merged.domain !== current.domain) {
            const holders = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                IndexName: "GSI_Domain",
                KeyConditionExpression: "#d = :d",
                FilterExpression: "begins_with(SK, :tenant)",
                ExpressionAttributeNames: { "#d": "Domain" },
                ExpressionAttributeValues: { ":d": merged.domain, ":tenant": "TENANT#" },
            }));
            if ((holders.Items ?? []).some((item) => item.SK !== `TENANT#${tenantId}`)) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({ error: `The domain "${merged.domain}" is already used by another site.` }),
                };
            }
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
                ...merged,
                PK: "SYSTEM",
                SK: `TENANT#${tenantId}`,
                id: tenantId,
            }
        }));

        // AUDIT LOG
        await publishAudit({
            tenantId: tenantId, // TS is happy now because of the early return above
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_SETTINGS",
            target: { title: current.name || "Settings" },
            details: {
                updatedFields: Object.keys(body),
                ...(rejectedFields.length > 0 ? { rejectedFields } : {}),
            },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Settings Saved" }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export const updateHandler = withInvalidation(_updateHandler);
