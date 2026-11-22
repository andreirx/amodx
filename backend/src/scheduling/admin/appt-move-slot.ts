/**
 * SCHED-1E1 — POST /scheduling/admin/bookings/{bookingId}/move-slot (E+T; docs/slices/sched-1.md § 10.3, § 5.2,
 * § 7.3, § 8.5, § 11.1): `{ start, resourceId, rev }` → `BookingAdminDTO`.
 *
 * `moveSlot` (`scheduling-db.ts`) decides with the admin's rules (§ 5.2, § 5.3): a confirmed slot booking only (409
 * `notConfirmed`; cancelled or expired → 409 `notActive`); the booking still at `rev` (409 `stale`, § 7.1); the target
 * resource exists and is not being removed (409 `resourceUnavailable`, the resource guard); no overlap (409
 * `slotTaken`); no window, grid, day-off or horizon check; the duration is the service's current one, or the stored
 * `end − start` when the service was deleted (§ 13). The booking keeps its id and every link token (§ 8.5) and gets a
 * `moved` history entry with `by: { kind: "admin", email }` in the same write (SCHED-AUDIT-PII = C: no main-table audit
 * event, so no event-bus permission). A booking that is not a slot (a seat) → 400 `invalid`; unknown → 404.
 *
 * Before the write: the tenant (`readTenantBeforeWrite`: consistent; a stored setting or mail configuration that fails
 * its schema → 500 `storedDataInvalid`);
 * the time zone (409 `timezoneNotSet`: the mail's `{{when}}`); the booking, consistent (404 / 400 decide whether the
 * write runs); the target resource's name (display). After the commit: a NEW link token (`mintToken`, § 8.4) and the
 * mail `moved` (customer per `sendToCustomer`) through `sendVisitorMail`; a mint or mail failure is logged with the
 * booking id and the move stands. The answer is the booking as last written: after the mint when it succeeded (the
 * mint raises `rev`, § 7.1), so the screen's next `rev` is current. Its names are those of THAT booking (`slotNames`,
 * review S1E1-R05): the target's name read before the write is reused only when the answered booking is on that
 * resource; a move that committed between ours and the mint is described with its own resource's name.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { getBooking, getResource, mintToken, moveSlot, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminActor, adminRoute } from "./common.js";
import { answer, parseBody, pathParam, refusal } from "../common.js";
import { sendVisitorMail } from "../visitor/mail.js";
import { bookingAdminDTO } from "./booking-dto.js";
import { IdSchema, readTenantBeforeWrite, slotNames, slotWriteAnswer, zonedSettings } from "./appt-common.js";

const MoveSlotBodySchema = z.object({
    start: z.iso.datetime(),
    resourceId: IdSchema,
    rev: z.number().int().min(1),
}).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-move-slot", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const id = pathParam(event, "bookingId");
        if (!id.ok) return id.answer;
        const body = parseBody(event, MoveSlotBodySchema);
        if (!body.ok) return body.answer;
        const actor = adminActor(auth);
        if (actor === null) return refusal(403, "forbidden", "Changing a booking needs a signed-in user with an email address.");
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const tenant = read.tenant;
        const settings = zonedSettings(tenant);
        if (!settings.ok) return settings.answer;

        const store = schedulingStoreFromEnv();
        const before = await getBooking(store, tenantId, id.value, true);
        if (before === undefined) return refusal(404, "notFound", "Booking not found.");
        if (before.what.kind !== "slot") {
            return refusal(400, "invalid", "The request is not valid.", { issues: [{ path: "bookingId", message: "The booking is not an appointment." }] });
        }
        const target = await getResource(store, tenantId, body.value.resourceId, false);
        const now = Date.now();
        const moved = await moveSlot(store, {
            tenantId, bookingId: id.value, start: Date.parse(body.value.start), resourceIds: [body.value.resourceId],
            actor, settings: settings.value, now, expectedRev: body.value.rev,
        });
        if (!moved.ok) return slotWriteAnswer(moved.error, refusal(404, "notFound", "Booking not found."));
        let booking = moved.value;

        try {
            const minted = await mintToken(store, tenantId, booking.id, now, { countForEmail: false });
            if (minted.ok) {
                booking = minted.value.booking;
                await sendVisitorMail({ key: "moved", tenantId, tenant, settings: settings.value, booking, place: {}, token: minted.value.token });
            } else {
                console.error("[scheduling] appt-move-slot no link for the moved mail", booking.id, minted.error.kind);
            }
        } catch (e) {
            console.error("[scheduling] appt-move-slot mail step failed", booking.id, e instanceof Error ? e.name : "unknown");
        }
        return answer(200, bookingAdminDTO(booking, await slotNames(store, tenantId, booking, target)));
    });
