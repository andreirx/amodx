/**
 * SCHED-1D2 — POST /scheduling/visitor/bookings/view (renderer op `view`; docs/slices/sched-1.md § 10.2, § 8.3, § 8.4)
 * → `BookingViewDTO`. Body `{ token }` (a POST keeps the token out of URLs and logs, § 8.2). Changes nothing: the page
 * shows the booking and a Confirm button when held; only POST confirm confirms (§ 8.3).
 *
 * Token rule (§ 8.4, § 16.3 class 3): `TENANT#<x-tenant-id>` + `TOKEN#<sha256(token)>` → exactly one booking of that
 * tenant; unknown, malformed (any length or shape), deleted, another tenant's, past its view window, or a stored
 * booking of the removed group shape (SCHED-GROUPS-REMOVE-1) → 404 `linkNotValid` (one answer). A held booking past
 * `expiresAt` → 410 `expired` (§ 8.4 answer table; operator ruling S1D2-EXPIRED-VIEW = A; the page offers a new booking). So `BookingViewDTO.state: "expired"` (§ 10.2) has no producer
 * in this slice: every route that answers a view refuses an expired hold first.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { iso, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { answer, refusal } from "../common.js";
import { NoMoreFields, bookingByLink, linkNotValid, parseLinkBody, visitorRoute } from "./common.js";
import { bookingViewDTO } from "./dto.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    visitorRoute(event, "bookings-view", { consistent: false }, async ({ tenantId, settings }) => {
        const body = parseLinkBody(event, NoMoreFields);
        if (!body.ok) return body.answer;
        const store = schedulingStoreFromEnv();
        const now = Date.now();
        const found = await bookingByLink(store, tenantId, body.token, now);
        if (found === undefined) return linkNotValid();
        const state = found.state;
        if (state.kind === "held" && now >= state.expiresAt) {
            return refusal(410, "expired", "The booking has expired.", { expiresAt: iso(state.expiresAt) });
        }
        return answer(200, bookingViewDTO(found, settings, now));
    });
