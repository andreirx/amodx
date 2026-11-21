/**
 * SCHED-1D1 — POST /scheduling/admin/customers/erase (T; docs/slices/sched-1.md § 10.3, § 14.2): `{ email }` →
 * `{ removedBookings, remainingBookings }`. One idempotent pass with a read-back (`eraseCustomer`).
 * Acceptance boundary (shown in the admin next to the button): "Everything that existed when the action started is
 * removed. A booking made during the action is reported by the read-back and removed by running the action again."
 * Audit (§ 6.5 point 3): `SCHEDULING_CUSTOMER_ERASED` with the two counts only; `target.title` is the fixed text
 * "Scheduling customer erasure" (the email would be customer data); no `ip`. The email is never logged.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { eraseCustomer, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { TENANT_ADMIN, adminRoute, answer, parseBody, refusal } from "./common.js";
import { EmailBodySchema } from "./customers-lookup.js";

export const ERASURE_AUDIT_TITLE = "Scheduling customer erasure";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "customers-erase", TENANT_ADMIN, async ({ tenantId, auth }) => {
        const body = parseBody(event, EmailBodySchema);
        if (!body.ok) return body.answer;
        const result = await eraseCustomer(schedulingStoreFromEnv(), tenantId, body.value.email, Date.now());
        if (!result.ok) return refusal(503, "busy", "Busy, please try again. Run the erasure again to finish it.");
        const counts = { removedBookings: result.value.removedBookings, remainingBookings: result.value.remainingBookings };
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "SCHEDULING_CUSTOMER_ERASED",
            target: { title: ERASURE_AUDIT_TITLE },
            details: counts,
        });
        return answer(200, counts);
    });
