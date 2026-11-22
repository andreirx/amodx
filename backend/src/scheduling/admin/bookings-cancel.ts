/**
 * SCHED-1D1 — POST /scheduling/admin/bookings/{bookingId}/cancel (E+T; docs/slices/sched-1.md § 10.3, § 7.3, § 7.4):
 * body `{}` → `BookingAdminDTO`. The admin cancels any active booking (no time window, § 5.3); a cancelled or expired
 * hold → 409 `notActive`. One transaction (`cancelBooking`): the place is released, every link token is deleted
 * (`tokenHashes = []`), and the `cancelled` history entry with `by: { kind: "admin", email }` is appended in the same
 * conditional write (SCHED-AUDIT-PII = C). No main-table audit event, so this function has no event-bus permission.
 *
 * Mail (§ 11.1 key `cancelled`, row D7): after the commit, to the customer when the template's `sendToCustomer` is
 * on; no link (the tokens are gone); no owner copy (§ 11.1: the owner copy is for a customer cancel). A failed send is
 * logged with the booking id and the cancel stands (§ 11.1 "Other mails").
 * The tenant's stored scheduling settings and templates are parsed BEFORE the write (`readSchedulingTenant`), so a
 * broken stored value answers 500 `storedDataInvalid` with nothing changed (§ 10.2); the mail uses the parsed values.
 * The booking (consistent: it decides the write, review S1D1-R07) and its names are read before the write as well.
 * After the commit, a failure of the mail step is logged (booking id only) and the answer is still 200. One read can
 * still follow the commit: the names again, only when a move committed between the read before and the cancel
 * changed the placement; a failure of THAT read answers 500 although the cancel stands (recorded limit).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { formatFromHeader } from "../../lib/email-from.js";
import { cancelBooking, getBooking, schedulingStoreFromEnv, type ChangeFailure } from "../../lib/scheduling-db.js";
import { renderSchedulingMail, resolveTemplate, whenText } from "../../lib/scheduling-email.js";
import { EDITOR_OR_ADMIN, adminActor, adminRoute } from "./common.js";
import { answer, parseBody, readSchedulingTenant, refusal, type Answer, pathParam } from "../common.js";
import { bookingAdminDTO, bookingNames } from "./booking-dto.js";

const ses = new SESClient({});

/** Every `ChangeFailure` → its HTTP answer (§ 10.3 common errors; § 8.4 codes). */
export function changeFailureAnswer(f: ChangeFailure): Answer {
    switch (f.kind) {
        case "notFound": return refusal(404, "notFound", "Booking not found.");
        case "notActive": return refusal(409, "notActive", "The booking is not active.", { state: f.state });
        case "tooLate": return refusal(409, "tooLate", "The change window has closed.", { cutoff: new Date(f.cutoff).toISOString() });
        case "notConfirmed": return refusal(409, "notConfirmed", "The booking is not confirmed.");
        case "paidContactTenant": return refusal(409, "paidContactTenant", "A paid booking is changed by the site.");
        case "stale": return refusal(409, "stale", "The booking changed; read it again.");
        case "busy": return refusal(503, "busy", "Busy, please try again.");
        default: {
            const never: never = f;
            throw new Error(`Unhandled failure ${JSON.stringify(never)}`);
        }
    }
}

/**
 * `whenText` moved to `lib/scheduling-email.ts` (SCHED-1G1). Re-exported here ONLY for the two existing importers
 * outside the SCHED-1G1 allocation (`./group-common.ts`, `../visitor/mail.ts`); pointing their imports at
 * `lib/scheduling-email.ts` and deleting this line is a recorded one-line follow-up for each.
 */
export { whenText };

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "bookings-cancel", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const id = pathParam(event, "bookingId");
        if (!id.ok) return id.answer;
        const body = parseBody(event, z.object({}).strict());
        if (!body.ok) return body.answer;
        const actor = adminActor(auth);
        if (actor === null) return refusal(403, "forbidden", "Changing a booking needs a signed-in user with an email address.");

        // Before the write: a broken stored `scheduling` or `schedulingEmailConfig` → 500 storedDataInvalid, nothing changed.
        const tenant = await readSchedulingTenant(tenantId, true);   // decides the write: consistent (§ 6.4 rule 4)
        if (tenant === undefined) return refusal(404, "notFound", "Site not found.");

        // Also before the write: the booking and the names its answer and mail show (resource, or course and run). A
        // stored item that fails its schema → 500 storedDataInvalid here, with nothing changed (review S1D1-R01).
        const store = schedulingStoreFromEnv();
        // Consistent (§ 6.4 rule 4, review S1D1-R07): a "not found" here answers 404 instead of cancelling, so an eventual
        // read that misses a committed booking would refuse a valid cancel. The names read below is a display read: it
        // decides nothing (it can only fail, before the write).
        const before = await getBooking(store, tenantId, id.value, true);
        if (before === undefined) return refusal(404, "notFound", "Booking not found.");
        const namesBefore = await bookingNames(store, tenantId, before);

        const cancelled = await cancelBooking(store, {
            tenantId, bookingId: id.value, actor,
            cutoffHours: 0, // not read for an admin: the admin has no time window (§ 5.3 changeDecision)
            now: Date.now(),
        });
        if (!cancelled.ok) return changeFailureAnswer(cancelled.error);
        const booking = cancelled.value;
        // The cancel changes `state`, not `what`; the names read before still apply. Only a move that committed between
        // that read and the cancel changes the placement: then the names are read again (the one read after the commit;
        // recorded limit — a failure of that read answers 500 although the cancel stands).
        const names = JSON.stringify(booking.what) === JSON.stringify(before.what) ? namesBefore : await bookingNames(store, tenantId, booking);

        // The mail step cannot turn the committed cancel into an error answer: the whole step (template, rendering,
        // sending) is inside one try, and a failure is logged with the booking id only (§ 11.1). (The one post-commit
        // read that CAN still fail is the names read just above, in the concurrent-move case only.)
        try {
            const template = resolveTemplate("cancelled", tenant.templates);
            const from = process.env.SES_FROM_EMAIL ?? "";
            // `sendToCustomer: false` in the tenant's override turns the mail off.
            if (template.sendToCustomer && !from) {
                console.error("[scheduling] bookings-cancel no SES_FROM_EMAIL; mail not sent", booking.id);
            } else if (template.sendToCustomer) {
                const mail = renderSchedulingMail(template, {
                    ref: booking.ref,
                    customerName: booking.who.name,
                    serviceName: booking.what.kind === "slot" ? booking.what.serviceName : "",
                    courseName: names.courseName ?? "",
                    when: whenText(booking, names, tenant.scheduling?.timezone),
                    expiresAt: "", link: "", groupLink: "", // no link after a cancel: every token was deleted (§ 8.4)
                    siteName: tenant.name ?? "",
                });
                await ses.send(new SendEmailCommand({
                    Source: formatFromHeader(tenant.name, from),
                    Destination: { ToAddresses: [booking.who.email] },
                    Message: { Subject: { Data: mail.subject }, Body: { Text: { Data: mail.body } } },
                }));
            }
        } catch (e) {
            console.error("[scheduling] bookings-cancel mail failed", booking.id, e instanceof Error ? e.name : "unknown");
        }
        return answer(200, bookingAdminDTO(booking, names));
    });
