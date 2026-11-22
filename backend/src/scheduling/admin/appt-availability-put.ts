/**
 * SCHED-1E1 — PUT /scheduling/admin/resources/{resourceId}/availability (E+T; docs/slices/sched-1.md § 10.3, D16,
 * § 13, § 23.2): `{ rules: AvailabilityRule[] }` → `{ rules }`, the defaults of one resource, replaced by ONE Put.
 * Validation: ≤ 50 rules; each `weekday` 1-7, `start`/`end` "HH:MM" on 5-minute boundaries, `end > start`.
 * Dates with an override keep it (§ 23.2: the override replaces the defaults of its date; only `DAYS#` holds overrides
 * and this route does not write it). Before any write: the tenant through `readTenantBeforeWrite` (a malformed stored
 * setting → 500 `storedDataInvalid`; review S1E1-R01); unknown resource → 404 (consistent read: it decides whether the
 * write runs).
 * Audit (§ 6.5 point 2): the resource name as `target.title`, `details` = the number of rules; no `ip`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { AvailabilityRuleSchema } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { getResource, putAvailability, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, parseBody, pathParam, refusal } from "../common.js";
import { readTenantBeforeWrite } from "./appt-common.js";

/** "HH:MM" whose minutes are a multiple of 5 (§ 10.3 "5-minute boundaries"); other forms are the rule schema's issue. */
const onGrid = (t: string) => !/^\d{2}:\d{2}$/.test(t) || Number(t.slice(3)) % 5 === 0;

const RuleBodySchema = AvailabilityRuleSchema
    .refine((r) => onGrid(r.start), { message: "Must be on a 5-minute boundary.", path: ["start"] })
    .refine((r) => onGrid(r.end), { message: "Must be on a 5-minute boundary.", path: ["end"] });

const MAX_RULES = 50; // § 4.5 "Availability rules per resource ≤ 50" (the stored `AvailabilityRulesSchema` bound)

const AvailabilityBodySchema = z.object({ rules: z.array(RuleBodySchema).max(MAX_RULES) }).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-availability-put", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const id = pathParam(event, "resourceId");
        if (!id.ok) return id.answer;
        const body = parseBody(event, AvailabilityBodySchema);
        if (!body.ok) return body.answer;
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const store = schedulingStoreFromEnv();
        const resource = await getResource(store, tenantId, id.value, true);
        if (resource === undefined) return refusal(404, "notFound", "Resource not found.");
        const rules = await putAvailability(store, tenantId, id.value, body.value.rules);
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_SCHEDULING_AVAILABILITY",
            target: { id: id.value, title: resource.name },
            details: { rules: rules.length },
        });
        return answer(200, { rules });
    });
