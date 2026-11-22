/**
 * SCHED-1F1 — POST /scheduling/admin/bookings/{bookingId}/move-seat (E+T; docs/slices/sched-1.md § 10.3, § 5.4, § 7.4,
 * § 8.5, § 11.1; D8): `{ runId: string | null, rev }` → `BookingAdminDTO`.
 *
 * The person stays in the booking's own course (the course comes from the stored booking, § 10.3); `runId: null` →
 * out of the run, `unplaced`. `moveSeat` (`scheduling-db.ts`) decides with the ADMIN rules on consistent reads under
 * the run versions and the booking's `rev`: a confirmed seat or an unplaced booking only (held → 409 `notConfirmed`;
 * cancelled or expired → 409 `notActive`); the booking still at `rev` (409 `stale`, § 7.1); the target run not
 * cancelled (409 `runCancelled`) and not full without this person (409 `runFull`); a closed or started run and another
 * language do not bind the admin, and the move never changes the run's language (row F3). The booking keeps its id and
 * every link token (§ 8.5) and gets a `moved` history entry with `by: { kind: "admin", email }` in the same write
 * (SCHED-AUDIT-PII = C: no main-table audit event, so no event-bus permission). A slot booking → 400 `invalid`;
 * unknown booking or target run → 404; 503 `busy`. An unplaced booking moved to `null` changes nothing: 200 with the
 * booking, no mail.
 *
 * Before the write: the tenant (`readTenantBeforeWrite`: consistent; malformed stored setting → 500
 * `storedDataInvalid`); the time zone (409 `timezoneNotSet`); the booking, CONSISTENT (404 / 400 decide the write);
 * a move OUT of a run also raises the course's dependent version (S1F1-COURSE-DELETE-GUARD, in `moveSeat`);
 * its course (display: name); the target run (display: name and time for the answer and mail).
 * After the commit: a NEW link token (`mintToken`, § 8.4) and the mail `moved` (into a run, through `sendVisitorMail`)
 * or `unplaced` (out of a run, through `sendGroupAdminMail`); a mint or mail failure is logged with the booking id and
 * the move stands. Review S1F1-R01: the notice is sent only when the booking as the mint saved it still has the
 * placement this move wrote (`hasPlacement`); otherwise it is logged by booking id and not sent (the answer shows the
 * booking as saved). The answer is the booking as last written (after the mint when it succeeded: the mint raises `rev`,
 * so the screen's next `rev` is current), with the course and run of THAT booking (`seatPlace`). Recorded limit: when a
 * move commits between ours and the mint, `seatPlace` reads that booking's run after the commit; a failure of that
 * read answers 500 although the move stands. The `{{when}}` of the mail is the target run's first meeting as read
 * before the write (a run move mails every person itself).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { getBooking, getCourse, getRun, mintToken, moveSeat, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminActor, adminRoute } from "./common.js";
import { answer, parseBody, pathParam, refusal } from "../common.js";
import { sendVisitorMail } from "../visitor/mail.js";
import { bookingAdminDTO } from "./booking-dto.js";
import { IdSchema, readTenantBeforeWrite, zonedSettings } from "./appt-common.js";
import { hasPlacement, placeNames, seatPlace, seatWriteAnswer, sendGroupAdminMail, type GroupPlacement } from "./group-common.js";

const MoveSeatBodySchema = z.object({
    runId: IdSchema.nullable(),
    rev: z.number().int().min(1),
}).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-move-seat", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const id = pathParam(event, "bookingId");
        if (!id.ok) return id.answer;
        const body = parseBody(event, MoveSeatBodySchema);
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
        if (before.what.kind === "slot") {
            return refusal(400, "invalid", "The request is not valid.", { issues: [{ path: "bookingId", message: "The booking is not a group booking." }] });
        }
        const courseId = before.what.courseId;
        const course = await getCourse(store, tenantId, courseId, false);
        if (course === undefined) throw new Error("[scheduling] group booking without its course");
        const target = body.value.runId === null ? undefined : await getRun(store, tenantId, courseId, body.value.runId, false);
        const now = Date.now();
        const moved = await moveSeat(store, {
            tenantId, bookingId: id.value, runId: body.value.runId, actor,
            cutoffHours: 0, // not read for an admin: the admin has no time window (§ 5.3 changeDecision)
            now, expectedRev: body.value.rev,
        });
        if (!moved.ok) return seatWriteAnswer(moved.error, refusal(404, "notFound", "Booking or group not found."));
        let booking = moved.value;
        if (booking.rev === body.value.rev) {
            // Nothing was written (unplaced → unplaced): no token, no mail.
            return answer(200, bookingAdminDTO(booking, placeNames(await seatPlace(store, tenantId, booking, course, target))));
        }

        let token: string | null = null;
        try {
            const minted = await mintToken(store, tenantId, booking.id, now, { countForEmail: false });
            if (minted.ok) {
                booking = minted.value.booking;
                token = minted.value.token;
            } else {
                console.error("[scheduling] group-move-seat no link for the mail", booking.id, minted.error.kind);
            }
        } catch (e) {
            console.error("[scheduling] group-move-seat mint failed", booking.id, e instanceof Error ? e.name : "unknown");
        }
        // The course and run of the booking as last written (one read only when it is not the target read before).
        const place = await seatPlace(store, tenantId, booking, course, target);
        // Review S1F1-R01 (`hasPlacement`): the notice is about the placement THIS move wrote; it is sent only when the
        // booking as the mint saved it still has it (a later move or a run cancel in between sends its own notice).
        const about: GroupPlacement = body.value.runId === null
            ? { kind: "unplaced", courseId } : { kind: "seat", courseId, runId: body.value.runId };
        if (token !== null && !hasPlacement(booking, about)) {
            console.error("[scheduling] group-move-seat notice not sent: placement changed", booking.id);
        } else if (token !== null) {
            try {
                switch (about.kind) {
                    case "seat":
                        await sendVisitorMail({ key: "moved", tenantId, tenant, settings: settings.value, booking, place, token });
                        break;
                    case "unplaced":
                        await sendGroupAdminMail({ key: "unplaced", tenantId, tenant, booking, place, token });
                        break;
                    default: {
                        const never: never = about;
                        throw new Error(`Unhandled placement ${JSON.stringify(never)}`);
                    }
                }
            } catch (e) {
                console.error("[scheduling] group-move-seat mail step failed", booking.id, e instanceof Error ? e.name : "unknown");
            }
        }
        return answer(200, bookingAdminDTO(booking, placeNames(place)));
    });
