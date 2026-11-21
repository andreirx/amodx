/**
 * SCHED-1D1 — POST /scheduling/admin/customers/lookup (E+T; docs/slices/sched-1.md § 10.3): `{ email }` →
 * `{ bookings: BookingAdminDTO[] }`, every booking of that person (AP9, then AP1 per booking), newest first.
 * The email travels in the body, never the URL (base plan line 259), and is never logged. It is normalized
 * (`normalizeEmail`, PD-001) and validated after normalization.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { PersonSchema } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { bookingIdsOfEmail, getBooking, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute, answer, parseBody } from "./common.js";
import { bookingAdminDTO, bookingNames } from "./booking-dto.js";

/** `{ email }`: the stored-email rule of `Person` (normalized, then validated). Shared with the erasure route. */
export const EmailBodySchema = z.object({ email: PersonSchema.shape.email }).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "customers-lookup", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const body = parseBody(event, EmailBodySchema);
        if (!body.ok) return body.answer;
        const store = schedulingStoreFromEnv();
        const ids = await bookingIdsOfEmail(store, tenantId, body.value.email, false);
        const found = await Promise.all(ids.map((id) => getBooking(store, tenantId, id, false)));
        const bookings = [];
        for (const b of found) {
            if (b === undefined) continue; // removed between the two reads (§ 14)
            bookings.push(bookingAdminDTO(b, await bookingNames(store, tenantId, b)));
        }
        bookings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return answer(200, { bookings });
    });
