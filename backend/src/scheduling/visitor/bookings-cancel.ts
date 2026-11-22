/**
 * SCHED-1D2 — POST /scheduling/visitor/bookings/cancel (renderer op `cancel`; docs/slices/sched-1.md § 10.2, § 5.3,
 * § 7.3, § 7.4, § 8.4) → `{ ref, state: "cancelled" }`. Body `{ token }`.
 *
 * The customer's change rule (`changeDecision`, actor customer): held or confirmed, before `start − changeCutoffHours`
 * (a seat counts from the run's first meeting; an unplaced booking is always inside the window); an `order` booking →
 * 409 `paidContactTenant`; after the cutoff → 409 `tooLate` with `cutoff`; expired → 410 `expired`; cancelled meanwhile →
 * 409 `cancelled`. One transaction (`cancelBooking`): the place released, every link token deleted (later links answer
 * 404), the `cancelled` history entry with `by: { kind: "customer" }`. No audit event.
 *
 * Mail (§ 11.1 `cancelled`): no link (the tokens are gone); to the customer per template; owner copy on a customer
 * cancel per template (`sendToAdmin`, default on). Built for the cancelled booking and its own place (`placeFor`: the
 * place read before the write, unless a move committed in between). A mail failure is logged and the cancel stands.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { cancelBooking, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { answer } from "../common.js";
import { NoMoreFields, bookingByLink, linkNotValid, parseLinkBody, placeFor, visitorRefusal, visitorRoute } from "./common.js";
import { sendVisitorMail } from "./mail.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    visitorRoute(event, "bookings-cancel", { consistent: true }, async ({ tenantId, tenant, settings }) => {
        const body = parseLinkBody(event, NoMoreFields);
        if (!body.ok) return body.answer;
        const store = schedulingStoreFromEnv();
        const now = Date.now();
        const found = await bookingByLink(store, tenantId, body.token, now);
        if (found === undefined) return linkNotValid();

        const cancelled = await cancelBooking(store, {
            tenantId, bookingId: found.booking.id, actor: { kind: "customer" }, cutoffHours: settings.changeCutoffHours, now,
        });
        if (!cancelled.ok) return visitorRefusal(cancelled.error, now, linkNotValid());
        const booking = cancelled.value;

        try {
            const place = await placeFor(store, tenantId, booking, { what: found.booking.what, place: found.place });
            await sendVisitorMail({ key: "cancelled", tenantId, tenant, settings, booking, place, token: null });
        } catch (e) {
            console.error("[scheduling] bookings-cancel mail step failed", booking.id, e instanceof Error ? e.name : "unknown");
        }
        return answer(200, { ref: booking.ref, state: "cancelled" });
    });
