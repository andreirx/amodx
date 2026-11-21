/**
 * SCHED-1D1 — PUT /scheduling/admin/resources/{resourceId} (E+T; docs/slices/sched-1.md § 10.3): `{ name }` →
 * `ResourceDTO`. Unknown resource → 404. Audit (§ 6.5 point 2): the new name as `target.title`; no `details` (they
 * hold counts and dates only, and a rename has neither); no `ip`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { getResource, renameResource, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute, answer, parseBody, pathParam, refusal } from "./common.js";
import { ResourceBodySchema } from "./resources-create.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "resources-update", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const id = pathParam(event, "resourceId");
        if (!id.ok) return id.answer;
        const body = parseBody(event, ResourceBodySchema);
        if (!body.ok) return body.answer;
        const store = schedulingStoreFromEnv();
        const before = await getResource(store, tenantId, id.value, true);
        if (before === undefined) return refusal(404, "notFound", "Resource not found.");
        const renamed = await renameResource(store, tenantId, id.value, body.value.name);
        if (!renamed.ok) return refusal(404, "notFound", "Resource not found.");
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_SCHEDULING_RESOURCE",
            target: { id: id.value, title: body.value.name },
        });
        return answer(200, { id: id.value, name: body.value.name, hasFeed: before.feedSecretHash !== undefined });
    });
