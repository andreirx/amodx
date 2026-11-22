/**
 * SCHED-1E1 — POST /scheduling/admin/services (E+T; docs/slices/sched-1.md § 10.3, § 4.2, § 4.5):
 * `{ name, durationMin, eligibility }` → 201 `ServiceDTO`. Validation: name 1-200 characters (trimmed); `durationMin`
 * 5-480, a multiple of 5; `eligibility` `{ kind: "all" }` or `{ kind: "only", resourceIds: [≥ 1] }`, every listed
 * resource exists (one consistent read of the resource list: it decides whether the write runs; an unknown id → 400
 * `invalid` with the issue path). Before any write the tenant is read through `readTenantBeforeWrite` (consistent;
 * a malformed stored scheduling setting or mail configuration → 500 `storedDataInvalid`, nothing written; review
 * S1E1-R01). Service bound (§ 4.5, ruling S1D1-R02 as applied by the operator to services): the count is a CONSISTENT
 * read of the service list, so sequential creates are refused above 200 (400 `invalid`); two simultaneous creates at
 * 199 can both succeed; no reader breaks above 200 (review S1E1-R02).
 * Audit (§ 6.5 point 2): one main-table event, the admin's email and the service name; no `details`; no `ip`.
 */
import { randomUUID } from "node:crypto";
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { ServiceSchema, type Eligibility } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { listResources, listServices, putService, schedulingStoreFromEnv, type SchedulingStore } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, parseBody, refusal, type Answer } from "../common.js";
import { IdSchema, readTenantBeforeWrite } from "./appt-common.js";

const MAX_SERVICES = 200; // § 4.5

/** The body of POST and PUT (§ 10.3 "same"): the stored `ServiceSchema` without `id`, strict (an unknown key → 400). */
export const ServiceBodySchema = z.object({
    name: z.string().trim().pipe(ServiceSchema.shape.name),
    durationMin: ServiceSchema.shape.durationMin,
    eligibility: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("all") }).strict(),
        z.object({ kind: z.literal("only"), resourceIds: z.tuple([IdSchema], IdSchema) }).strict(),
    ]),
}).strict();

/**
 * § 10.3 "listed resources exist": `null` when every id of an `only` list names a resource of this tenant, else the
 * 400 answer naming the unknown entries by path. One consistent read of the list.
 */
export async function unknownResources(store: SchedulingStore, tenantId: string, eligibility: Eligibility): Promise<Answer | null> {
    switch (eligibility.kind) {
        case "all": return null;
        case "only": {
            const known = new Set((await listResources(store, tenantId, true)).map((r) => r.id));
            const issues = eligibility.resourceIds
                .map((id, i) => ({ id, i }))
                .filter(({ id }) => !known.has(id))
                .map(({ i }) => ({ path: `eligibility.resourceIds.${i}`, message: "Unknown resource." }));
            return issues.length === 0 ? null : refusal(400, "invalid", "The request is not valid.", { issues });
        }
        default: {
            const never: never = eligibility;
            throw new Error(`Unhandled eligibility ${JSON.stringify(never)}`);
        }
    }
}

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-services-create", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const body = parseBody(event, ServiceBodySchema);
        if (!body.ok) return body.answer;
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const store = schedulingStoreFromEnv();
        if ((await listServices(store, tenantId, true)).length >= MAX_SERVICES) {
            return refusal(400, "invalid", `A site can have at most ${MAX_SERVICES} services.`);
        }
        const unknown = await unknownResources(store, tenantId, body.value.eligibility);
        if (unknown !== null) return unknown;
        const service = await putService(store, tenantId, { id: randomUUID(), ...body.value });
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_SCHEDULING_SERVICE",
            target: { id: service.id, title: service.name },
        });
        return answer(201, { id: service.id, name: service.name, durationMin: service.durationMin, eligibility: service.eligibility });
    });
