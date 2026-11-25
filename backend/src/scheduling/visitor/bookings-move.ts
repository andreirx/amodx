/**
 * SCHED-1D2 — POST /scheduling/visitor/bookings/move (renderer op `move`; docs/slices/sched-1.md § 10.2, § 5.2, § 5.3,
 * § 7.3, § 8.5) → `BookingViewDTO`. Body `{ token, to: { kind: "slot"; start } }`.
 *
 * The booking keeps its id and every link (§ 8.5). Customer rules: a confirmed booking only (held → 409
 * `notConfirmed`), before the change cutoff (409 `tooLate`).
 * Slot → slot (`moveSlot`): the visitor's `slotDecision` on the new start with the CURRENT service (its duration);
 * "any available" over the service's eligible resources; the § 10.2 hold codes (`slotTaken`, `notOnGrid`, …). The
 * service no longer exists → 404 `notFound`; no eligible resource → 409 `notEligible`.
 * The booking gone meanwhile → 404 `linkNotValid`.
 *
 * Token: absent or not a string → 404 `linkNotValid` before the target is checked (`parseLinkBody`).
 * Mail (§ 11.1 `moved`): a NEW link token (`mintToken`), to the customer per template, built for the booking the mint
 * returned (review S1D2-R03); a mail or mint failure is logged and the move stands.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { MoveBodySchema } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { getService, listResources, mintToken, moveSlot, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { answer, refusal } from "../common.js";
import { bookingByLink, eligibleIds, linkNotValid, parseLinkBody, visitorRefusal, visitorRoute } from "./common.js";
import { bookingViewDTO } from "./dto.js";
import { sendVisitorMail } from "./mail.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    visitorRoute(event, "bookings-move", { consistent: true }, async ({ tenantId, tenant, settings }) => {
        const body = parseLinkBody(event, MoveBodySchema);
        if (!body.ok) return body.answer;
        const store = schedulingStoreFromEnv();
        const now = Date.now();
        const before = await bookingByLink(store, tenantId, body.token, now);
        if (before === undefined) return linkNotValid();
        const to = body.value.to;
        const customer = { kind: "customer" as const };

        let moved;
        const what = before.what;
        switch (what.kind) {
            case "slot": {
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
                break;
            }
            default: {
                const never: never = what.kind;
                throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
            }
        }
        if (!moved.ok) return visitorRefusal(moved.error, now, linkNotValid());
        const booking = moved.value;

        try {
            const minted = await mintToken(store, tenantId, booking.id, now, { countForEmail: false });
            if (minted.ok) {
                await sendVisitorMail({ key: "moved", tenantId, tenant, settings, booking: minted.value.booking, token: minted.value.token });
            } else {
                console.error("[scheduling] bookings-move no link for the moved mail", booking.id, minted.error.kind);
            }
        } catch (e) {
            console.error("[scheduling] bookings-move mail step failed", booking.id, e instanceof Error ? e.name : "unknown");
        }
        return answer(200, bookingViewDTO(booking, settings, now));
    });
