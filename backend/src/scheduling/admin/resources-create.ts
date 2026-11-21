/**
 * SCHED-1D1 — POST /scheduling/admin/resources (E+T; docs/slices/sched-1.md § 10.3): `{ name }` (1-200 characters,
 * trimmed) → 201 `ResourceDTO`. Resource bound (§ 4.5, a technical limit; operator ruling S1D1-R02): a read of the list,
 * then the create — sequential creates are refused above 200 (400 `invalid`); two simultaneous creates at 199 can
 * both succeed. No counter item and no transaction: no reader breaks above 200 (the list query pages to the end, the
 * batch reads are chunked by 100, the list route and the admin page show the whole list).
 * Audit (§ 6.5 point 2): one main-table event, the admin's email and the resource name; no `ip`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { createResource, listResources, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute, answer, parseBody, refusal } from "./common.js";

export const MAX_RESOURCES = 200; // § 4.5
export const ResourceBodySchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "resources-create", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const body = parseBody(event, ResourceBodySchema);
        if (!body.ok) return body.answer;
        const store = schedulingStoreFromEnv();
        if ((await listResources(store, tenantId, true)).length >= MAX_RESOURCES) {
            return refusal(400, "invalid", `A site can have at most ${MAX_RESOURCES} resources.`);
        }
        const resource = await createResource(store, tenantId, body.value.name);
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_SCHEDULING_RESOURCE",
            target: { id: resource.id, title: resource.name },
        });
        return answer(201, { id: resource.id, name: resource.name, hasFeed: false });
    });
