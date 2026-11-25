/**
 * SCHED-1E1 — POST /scheduling/admin/appointments (E+T; docs/slices/sched-1.md § 10.3, § 5.2, § 7.3, § 11.1):
 * `{ serviceId, resourceId, start, who: WhoInput, channel }` → 201 `BookingAdminDTO`. A confirmed booking with source
 * `manual` (the admin's email, `channel` 1-40 characters).
 *
 * Admin rules (§ 5.2), decided by `createManualAppointment` (`scheduling-db.ts`): no `slotDecision` — windows, grid,
 * day off and booking horizon do not bind the admin; bound by a known service (its duration), a known resource that
 * passes the resource guard, and `overlapCheck`. Answers: 404 `notFound` (service or resource), 409 `slotTaken`,
 * 409 `resourceUnavailable` (removal under way), 503 `busy`. Its one transaction writes the booking with its `created`
 * history entry and its first link token (SCHED-AUDIT-PII = C: no main-table audit event, so no event-bus permission).
 *
 * Before the write: the tenant (`readTenantBeforeWrite`: consistent; a stored setting or mail configuration that fails
 * its schema → 500 `storedDataInvalid`, nothing written); the time zone (409 `timezoneNotSet`: the mail's `{{when}}`); the resource, consistent (its name
 * for the answer; an unknown resource → 404 before the write). A caller without an email cannot be the booking's
 * `adminEmail` → 403.
 * After the commit: mail `confirmed` with the link of the token the transaction created (§ 11.1: customer per
 * `sendToCustomer`, owner copy per `sendToAdmin`, never with the link) through `sendVisitorMail` (visitor/mail.ts; its
 * name is narrower than this use — recorded in the SCHED-1E1 build report). A mail failure is logged with the booking
 * id and the booking stands.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { PersonSchema } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { createManualAppointment, getResource, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminActor, adminRoute } from "./common.js";
import { answer, parseBody, refusal } from "../common.js";
import { sendVisitorMail } from "../visitor/mail.js";
import { bookingAdminDTO } from "./booking-dto.js";
import { IdSchema, readTenantBeforeWrite, slotNames, slotWriteAnswer, zonedSettings } from "./appt-common.js";

/** § 10.3 `WhoInput` (§ 4.5 lengths; the email normalized, PD-001) and `channel` ≤ 40 (§ 4.5). */
const ChannelSchema = z.string().trim().min(1).max(40);
const ManualAppointmentBodySchema = z.object({
    serviceId: IdSchema,
    resourceId: IdSchema,
    start: z.iso.datetime(),
    who: PersonSchema.strict(),
    channel: ChannelSchema,
}).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-appointments-create", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const body = parseBody(event, ManualAppointmentBodySchema);
        if (!body.ok) return body.answer;
        const actor = adminActor(auth);
        if (actor === null) return refusal(403, "forbidden", "Changing a booking needs a signed-in user with an email address.");
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const tenant = read.tenant;
        const settings = zonedSettings(tenant);
        if (!settings.ok) return settings.answer;

        const store = schedulingStoreFromEnv();
        const resource = await getResource(store, tenantId, body.value.resourceId, true);
        if (resource === undefined) return refusal(404, "notFound", "Resource not found.");
        const now = Date.now();
        const created = await createManualAppointment(store, {
            tenantId, serviceId: body.value.serviceId, resourceId: body.value.resourceId, start: Date.parse(body.value.start),
            who: body.value.who, channel: body.value.channel, adminEmail: actor.email, now,
        });
        if (!created.ok) return slotWriteAnswer(created.error, refusal(404, "notFound", "Service or resource not found."));
        const { booking, token } = created.value;

        try {
            await sendVisitorMail({ key: "confirmed", tenantId, tenant, settings: settings.value, booking, token });
        } catch (e) {
            console.error("[scheduling] appt-appointments-create mail step failed", booking.id, e instanceof Error ? e.name : "unknown");
        }
        return answer(201, bookingAdminDTO(booking, await slotNames(store, tenantId, booking, resource)));
    });
