/**
 * SCHED-1D1 — GET /scheduling/admin/bookings/{bookingId} (E+T; docs/slices/sched-1.md § 10.3): the booking with its
 * `history`. A display read (not consistent). Unknown id, or an id of another tenant → 404 `notFound`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { getBooking, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, refusal, pathParam } from "../common.js";
import { bookingAdminDTO, bookingNames } from "./booking-dto.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "bookings-get", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const id = pathParam(event, "bookingId");
        if (!id.ok) return id.answer;
        const store = schedulingStoreFromEnv();
        const booking = await getBooking(store, tenantId, id.value, false);
        if (booking === undefined) return refusal(404, "notFound", "Booking not found.");
        return answer(200, bookingAdminDTO(booking, await bookingNames(store, tenantId, booking)));
    });
