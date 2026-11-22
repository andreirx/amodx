/**
 * SCHED-1F1 — POST /scheduling/admin/seats (E+T; docs/slices/sched-1.md § 10.3, § 5.4, § 7.4, § 11.1; D9):
 * `{ courseId, runId?, who: WhoInput, channel }` → 201 `BookingAdminDTO`. A confirmed booking with source `manual`
 * (the admin's email, `channel` 1-40 characters). No `runId` → an `unplaced` booking of the course (row F7).
 *
 * Admin seat rules (§ 5.4), decided by `createManualSeat` (`scheduling-db.ts`) on a consistent read of the run under its
 * version: refused only when the run is cancelled (409 `runCancelled`) or full (409 `runFull` with the capacity); a
 * closed or started run and another language do not bind the admin, and an admin placement never changes the run's
 * language. Unknown course or run → 404 (also a course deleted after the read: an unplaced entry raises the course's
 * dependent version under `attribute_exists`, ruling S1F1-COURSE-DELETE-GUARD); 503 `busy`. Its one transaction writes the booking with its `created` history
 * entry and its first link token (SCHED-AUDIT-PII = C: no main-table audit event, so no event-bus permission).
 * `who.language`, when sent, must be one of the course's languages (§ 4.3, as the visitor hold) → else 400.
 *
 * Before the write: the tenant (`readTenantBeforeWrite`: consistent; malformed stored setting → 500
 * `storedDataInvalid`, nothing written); the time zone (409 `timezoneNotSet`, as every mailing group route); the
 * course, CONSISTENT (404 decides the write; its languages; its name for the answer and the mail); the run (display
 * read, for the answer and the mail). A caller without an email cannot be the booking's `adminEmail` → 403.
 * After the commit: mail `confirmed` with the link of the token the transaction created and, for a seat, the run's
 * group link (row F8) — customer per `sendToCustomer`, owner copy per `sendToAdmin` without the link — through
 * `sendVisitorMail`. A mail failure is logged with the booking id and the booking stands (201). The answer and the mail
 * name the course and run of the booking as saved (`seatPlace`; the run read before the write is reused — one read
 * after the commit only when that display read missed the run, and a failure of it answers 500 although the booking
 * stands: recorded limit).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { PersonSchema } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { createManualSeat, getCourse, getRun, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminActor, adminRoute } from "./common.js";
import { answer, parseBody, refusal } from "../common.js";
import { sendVisitorMail } from "../visitor/mail.js";
import { bookingAdminDTO } from "./booking-dto.js";
import { IdSchema, readTenantBeforeWrite, zonedSettings } from "./appt-common.js";
import { languageNotOffered, placeNames, seatPlace, seatWriteAnswer } from "./group-common.js";

const ManualSeatBodySchema = z.object({
    courseId: IdSchema,
    runId: IdSchema.optional(),
    who: PersonSchema.strict(),
    channel: z.string().trim().min(1).max(40),
}).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-seats-create", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const body = parseBody(event, ManualSeatBodySchema);
        if (!body.ok) return body.answer;
        const actor = adminActor(auth);
        if (actor === null) return refusal(403, "forbidden", "Changing a booking needs a signed-in user with an email address.");
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const tenant = read.tenant;
        const settings = zonedSettings(tenant);
        if (!settings.ok) return settings.answer;

        const store = schedulingStoreFromEnv();
        const { courseId, runId, who, channel } = body.value;
        const course = await getCourse(store, tenantId, courseId, true);
        if (course === undefined) return refusal(404, "notFound", "Course not found.");
        if (who.language !== undefined) {
            const notOffered = languageNotOffered(course, who.language, "who.language");
            if (notOffered !== null) return notOffered;
        }
        const runBefore = runId === undefined ? undefined : await getRun(store, tenantId, course.id, runId, false);
        const now = Date.now();
        const created = await createManualSeat(store, {
            tenantId, courseId: course.id, runId: runId ?? null, who, channel, adminEmail: actor.email, now,
        });
        if (!created.ok) return seatWriteAnswer(created.error, refusal(404, "notFound", "Course or group not found."));
        const { booking, token } = created.value;
        const place = await seatPlace(store, tenantId, booking, course, runBefore);

        try {
            await sendVisitorMail({ key: "confirmed", tenantId, tenant, settings: settings.value, booking, place, token });
        } catch (e) {
            console.error("[scheduling] group-seats-create mail step failed", booking.id, e instanceof Error ? e.name : "unknown");
        }
        return answer(201, bookingAdminDTO(booking, placeNames(place)));
    });
