/**
 * SCHED-1D2 — POST /scheduling/visitor/bookings/move (renderer op `move`; docs/slices/sched-1.md § 10.2, § 5.2-§ 5.4,
 * § 7.3, § 7.4, § 8.5) → `BookingViewDTO`. Body `{ token, to: { kind: "slot"; start } | { kind: "seat"; runId } }`.
 *
 * The booking keeps its id and every link (§ 8.5). Customer rules: a confirmed booking only (held → 409
 * `notConfirmed`), before the change cutoff (409 `tooLate`), not an `order` booking (409 `paidContactTenant`).
 * - Slot → slot (`moveSlot`): the visitor's `slotDecision` on the new start with the CURRENT service (its duration);
 *   "any available" over the service's eligible resources; the § 10.2 hold codes (`slotTaken`, `notOnGrid`, …). The
 *   service no longer exists → 404 `notFound`; no eligible resource → 409 `notEligible`.
 * - Seat or unplaced → seat (`moveSeat`): `seatDecision` with the visitor's rules on a run of the booking's OWN course
 *   (D8); the run does not exist → 404 `notFound` (a CONSISTENT read: it decides whether the write runs, § 6.4 rule 4,
 *   review S1D2-R04); the hold's seat codes (`runFull`, `runClosed`, …).
 * - Any other pair (slot ↔ seat) → 400 `invalid`. Moving out of a run (unplaced) is an admin action only.
 * The booking gone meanwhile → 404 `linkNotValid`.
 *
 * Token: absent or not a string → 404 `linkNotValid` before the target is checked (`parseLinkBody`).
 * Mail (§ 11.1 `moved`): a NEW link token (`mintToken`), to the customer per template, built for the booking the mint
 * returned and ITS place (`placeFor`, review S1D2-R03: a competing move between the commit and the mint names another
 * run); a mail, mint or place-read failure is logged and the move stands. The answer is the moved booking with the
 * target run as read before the write (its placement; its language may have been set by this move, the next view
 * shows it).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import type { Booking } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import {
    getRun, getService, listResources, mintToken, moveSeat, moveSlot, schedulingStoreFromEnv,
} from "../../lib/scheduling-db.js";
import { answer, refusal, type Answer } from "../common.js";
import { bookingByLink, eligibleIds, linkNotValid, parseLinkBody, placeFor, visitorRefusal, visitorRoute, type Place } from "./common.js";
import { bookingViewDTO } from "./dto.js";
import { sendVisitorMail } from "./mail.js";

/** The body besides the token (`parseLinkBody` takes the token first). */
const MoveBodySchema = z.object({
    to: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("slot"), start: z.iso.datetime() }).strict(),
        z.object({ kind: z.literal("seat"), runId: z.string().min(1).max(100).refine((v) => !v.includes("#"), { message: "Must not contain #." }) }).strict(),
    ]),
}).strict();

const targetMismatch = (): Answer => refusal(400, "invalid", "The request is not valid.", {
    issues: [{ path: "to.kind", message: "The target does not match the booking." }],
});

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    visitorRoute(event, "bookings-move", { consistent: true }, async ({ tenantId, tenant, settings }) => {
        const body = parseLinkBody(event, MoveBodySchema);
        if (!body.ok) return body.answer;
        const store = schedulingStoreFromEnv();
        const now = Date.now();
        const found = await bookingByLink(store, tenantId, body.token, now);
        if (found === undefined) return linkNotValid();
        const before = found.booking;
        const to = body.value.to;
        const customer = { kind: "customer" as const };

        let moved;
        let place: Place;                    // the place of the target placement, read before the write
        let targetWhat: Booking["what"];     // the placement that place belongs to (for `placeFor`)
        const what = before.what;
        switch (what.kind) {
            case "slot": {
                if (to.kind !== "slot") return targetMismatch();
                const service = await getService(store, tenantId, what.serviceId, true);
                if (service === undefined) return refusal(404, "notFound", "The service is no longer offered.");
                const resourceIds = eligibleIds(service.eligibility, (await listResources(store, tenantId, true)).map((r) => r.id));
                if (resourceIds.length === 0) return visitorRefusal({ kind: "notEligible" }, now, linkNotValid());
                moved = await moveSlot(store, {
                    tenantId, bookingId: before.id, start: Date.parse(to.start), resourceIds, actor: customer, now,
                    settings: {
                        timezone: settings.timezone, holdMinutes: settings.holdMinutes,
                        bookingHorizonWeeks: settings.bookingHorizonWeeks, changeCutoffHours: settings.changeCutoffHours,
                    },
                });
                place = {};
                targetWhat = what;
                break;
            }
            case "seat":
            case "unplaced": {
                if (to.kind !== "seat") return targetMismatch();
                const target = await getRun(store, tenantId, what.courseId, to.runId, true);
                if (target === undefined) return refusal(404, "notFound", "Group not found.");
                moved = await moveSeat(store, {
                    tenantId, bookingId: before.id, runId: to.runId, actor: customer, cutoffHours: settings.changeCutoffHours, now,
                });
                place = { course: found.place.course, run: target };
                targetWhat = { kind: "seat", courseId: what.courseId, runId: target.id };
                break;
            }
            default: {
                const never: never = what;
                throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
            }
        }
        if (!moved.ok) return visitorRefusal(moved.error, now, linkNotValid());
        const booking = moved.value;

        try {
            const minted = await mintToken(store, tenantId, booking.id, now, { countForEmail: false });
            if (minted.ok) {
                const mailed = minted.value.booking;
                await sendVisitorMail({
                    key: "moved", tenantId, tenant, settings, booking: mailed,
                    place: await placeFor(store, tenantId, mailed, { what: booking.what, place }), token: minted.value.token,
                });
            } else {
                console.error("[scheduling] bookings-move no link for the moved mail", booking.id, minted.error.kind);
            }
        } catch (e) {
            console.error("[scheduling] bookings-move mail step failed", booking.id, e instanceof Error ? e.name : "unknown");
        }
        return answer(200, await bookingViewDTO(store, tenantId, booking, await placeFor(store, tenantId, booking, { what: targetWhat, place }), settings, now));
    });
