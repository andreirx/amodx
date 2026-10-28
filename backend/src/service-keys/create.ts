import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { ServiceKeyScope } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { createServiceKey } from "../lib/service-keys.js";
import { publishAudit } from "../lib/events.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const CreateServiceKeyBody = z.object({
    name: z.string().trim().min(1, "name is required").max(80, "name is at most 80 characters"),
    scopes: z.array(ServiceKeyScope)
        .min(1, "at least one scope is required")
        .refine((s) => new Set(s).size === s.length, "scopes must not repeat"),
});

/**
 * POST /service-keys { name, scopes } — creates a key for the caller's tenant. Admins only.
 * 201 { key, secret }: the response is the ONLY place the secret ever appears.
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

        let raw: unknown;
        try {
            raw = JSON.parse(event.body || "{}");
        } catch {
            return { statusCode: 400, body: JSON.stringify({ error: "Body is not valid JSON" }) };
        }
        const parsed = CreateServiceKeyBody.safeParse(raw);
        if (!parsed.success) {
            const error = parsed.error.issues
                .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
                .join("; ");
            return { statusCode: 400, body: JSON.stringify({ error }) };
        }
        const { name, scopes } = parsed.data;

        const { view, secret } = await createServiceKey(tenantId, name, scopes, auth.email || auth.sub);

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "SERVICE_KEY_CREATED",
            target: { id: view.id, title: view.name },
            details: { scopes },
            ip: event.requestContext.http?.sourceIp,
        });

        return {
            statusCode: 201,
            headers: { "Cache-Control": "no-store" },
            body: JSON.stringify({ key: view, secret }),
        };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
