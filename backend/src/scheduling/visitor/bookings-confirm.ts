/**
 * SCHED-1D2 — POST /scheduling/visitor/bookings/confirm (renderer op `confirm`; docs/slices/sched-1.md § 10.2,
 * § 5.3, § 7.3, § 7.4, § 8.4) → `BookingViewDTO`. Body `{ token }`.
 *
 * The booking the token opens (404 `linkNotValid` otherwise, § 8.4) is confirmed by `confirmBooking`: held and
 * unexpired → confirmed (the container entry must still carry the hold's `x`; `HELD#` deleted; the `confirmed`
 * history entry in the same write) → outcome `applied`; already confirmed → no write → `alreadyConfirmed` (200);
 * held and expired, or the entry went to another writer after expiry (`seatLost`) → 410 `expired`; cancelled meanwhile
 * → 409 `cancelled`.
 *
 * Mail (§ 11.1 `confirmed`): ONLY on `applied` — the store says which call committed the confirmation (ruling
 * S1D2-CONFIRM-OUTCOME; review S1D2-R02: a timestamp does not identify the request) — with a NEW link token
 * (`mintToken`, § 8.4) and, for a seat, the group link; owner copy per template. The mail is built for the booking the
 * mint returned and that booking's own place (`placeFor`, review S1D2-R03); the answer for the booking the confirm
 * returned. A mail, mint or place-read failure after the commit is logged (booking id) and the confirm stands.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { confirmBooking, mintToken, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { answer } from "../common.js";
import { NoMoreFields, bookingByLink, linkNotValid, parseLinkBody, placeFor, visitorRefusal, visitorRoute } from "./common.js";
import { bookingViewDTO } from "./dto.js";
import { sendVisitorMail } from "./mail.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    visitorRoute(event, "bookings-confirm", { consistent: true }, async ({ tenantId, tenant, settings }) => {
        const body = parseLinkBody(event, NoMoreFields);
        if (!body.ok) return body.answer;
        const store = schedulingStoreFromEnv();
        const now = Date.now();
        const found = await bookingByLink(store, tenantId, body.token, now);
        if (found === undefined) return linkNotValid();
        const known = { what: found.booking.what, place: found.place };

        const confirmed = await confirmBooking(store, tenantId, found.booking.id, now);
        if (!confirmed.ok) return visitorRefusal(confirmed.error, now, linkNotValid());
        const outcome = confirmed.value;
        const booking = outcome.booking;

        switch (outcome.kind) {
            case "applied":
                try {
                    const minted = await mintToken(store, tenantId, booking.id, now, { countForEmail: false });
                    if (minted.ok) {
                        const mailed = minted.value.booking;
                        await sendVisitorMail({
                            key: "confirmed", tenantId, tenant, settings, booking: mailed,
                            place: await placeFor(store, tenantId, mailed, known), token: minted.value.token,
                        });
                    } else {
                        console.error("[scheduling] bookings-confirm no link for the confirmed mail", booking.id, minted.error.kind);
                    }
                } catch (e) {
                    console.error("[scheduling] bookings-confirm mail step failed", booking.id, e instanceof Error ? e.name : "unknown");
                }
                break;
            case "alreadyConfirmed": break;   // another request confirmed it and owns the mail
            default: {
                const never: never = outcome;
                throw new Error(`Unhandled outcome ${JSON.stringify(never)}`);
            }
        }
        return answer(200, await bookingViewDTO(store, tenantId, booking, await placeFor(store, tenantId, booking, known), settings, now));
    });
