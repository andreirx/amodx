import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { revokeServiceKey } from "../lib/service-keys.js";
import { publishAudit } from "../lib/events.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * POST /service-keys/{id}/revoke — revokes an active key of the caller's tenant. Admins only.
 * The key record stays (listed as revoked); the authorizer's lookup item is deleted, so the secret is refused
 * from the next request on. 404 when the key is not in this tenant or is already revoked.
 */
export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const auth = event.requestContext.authorizer.lambda;
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN"], tenantId);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Forbidden";
            return { statusCode: 403, body: JSON.stringify({ error: message }) };
        }

        const keyId = event.pathParameters?.id;
        if (!keyId) return { statusCode: 400, body: JSON.stringify({ error: "Missing key id" }) };

        const key = await revokeServiceKey(tenantId, keyId);
        if (!key) return { statusCode: 404, body: JSON.stringify({ error: "Service key not found or already revoked" }) };

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "SERVICE_KEY_REVOKED",
            target: { id: key.id, title: key.name },
            ip: event.requestContext.http?.sourceIp,
        });

        return { statusCode: 200, body: JSON.stringify({ key }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
