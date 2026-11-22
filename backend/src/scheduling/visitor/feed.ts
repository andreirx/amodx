/**
 * SCHED-1G1 — POST /scheduling/visitor/feed (docs/slices/sched-1.md § 12, § 10.2, § 16.3 class 4): the calendar feed
 * of one resource, as `text/calendar`. PROTOTYPE.
 *
 * Path to this route (PD-002 booking-token variant, § 16.3; § 10.1): the browser or calendar app fetches
 * `<base>/_booking/feed/<resourceId>/<secret>.ics` from the RENDERER; the renderer handler (`sched-1g2`) calls this
 * route with the renderer key, `x-tenant-id` derived from the URL it serves, and the body `{ resourceId, secret }`
 * taken from the path. No backend route is anonymous: the authorizer refuses a request without a credential, and
 * `requireRole` admits only `RENDERER` (and `GLOBAL_ADMIN`, by policy) — any other role → 403 `forbidden`, as every
 * visitor route (`visitor/common.ts`).
 *
 * One answer for a URL holder (§ 12, § 10.2): wrong secret, rotated secret, unknown resource, a resource with no
 * secret, a malformed resource id or secret, no tenant record, switch off → 404 `linkNotValid`, the same body. Timing
 * class: for a well-formed body of an enabled tenant, an unknown resource, a resource without a secret and a wrong
 * secret take the SAME steps — one Get of the tenant record, one Get of `RESOURCE#`, one SHA-256 of the presented
 * secret, one `timingSafeEqual` of two 64-byte buffers (against the stored hash, or a fixed dummy hash when there is
 * none) — and only then answer 404. A body that is not JSON → 400 `invalid` (only a broken proxy sends one; it carries
 * nothing of the URL). The secret is never logged.
 *
 * Access reads are CONSISTENT (review S1G1-R02; the rule of `bookingByLink` in `visitor/common.ts`: a read that decides
 * whether the route answers 404 or serves data is a consistent read). Both the tenant record (the switch) and
 * `RESOURCE#` (the secret hash) are read with `ConsistentRead: true`, so a rotation or a switch-off that committed
 * before the request stops the old URL at once (§ 12 "the old URL stops at once"). The reads after the match are
 * display reads (eventually consistent).
 *
 * After the secret matched (only a holder of the URL gets here), a failure is not a 404: a BatchGet that cannot finish
 * → 503 `busy`; a stored item that fails its schema → 500 `storedDataInvalid` (`guarded`).
 *
 * Content (§ 12): window `[now − 60 days, now + 365 days]`.
 * - Slots: AP3 over the window through `readIntervals` (each booking once, at the highest `rev` the query returned,
 *   active only, § 5.5), then BatchGet `BOOKING#` with the `feed` projection (`id, ref, what, state` — no `who`).
 *   Times and service name come from `BOOKING#.what` (§ 6.3); a booking that BatchGet does not return, that is no
 *   longer a slot of this resource, that is cancelled or an expired hold, or that no longer intersects the window,
 *   is skipped. Confirmed → `STATUS:CONFIRMED`; held → `STATUS:TENTATIVE`. `SUMMARY` = service name + ref.
 * - Runs: AP6 with `t = windowStart` (`runsNotEndedBy`: keeps `firstStartIso <= windowEnd`), then on the run's own
 *   item: this resource in `trainerIds`, `status ≠ cancelled`; one event per meeting that intersects the window,
 *   converted with the RUN's `timezone` (never the tenant's current zone). `SUMMARY` = course name + `taken/capacity`
 *   (`taken` = held unexpired + confirmed seats, `activeSeats`).
 * - `UID` = `<bookingId>@<tenantId>` / `<runId>-<n>@<tenantId>` (n = 1-based position of the meeting in the stored,
 *   sorted list); `DTSTAMP` = now; `DTSTART`/`DTEND` in UTC (`…Z`), no `VTIMEZONE`.
 * - Guarantee (§ 12): no customer name, email or phone — the booking projection does not read `who`.
 * Answer: 200, `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`.
 *
 * Deviations from § 6.3 (consumer row "Calendar feed"), recorded in the build report:
 * - the run capacity for `taken/capacity` is not in the AP6 projection; it is read by one `getRun` per run of this
 *   trainer in the window (display read) — DECISION SCHED-1G1-FEED-CAPACITY;
 * - course names are read by one `getCourse` per distinct course (the row names one BatchGet of `COURSE#`): same
 *   items, more requests; no store function batches courses;
 * - the tenant record is read only for the switch; no stored scheduling setting is parsed (the feed uses none).
 *
 * Abstraction line: `feedCalendar` (pure) — users: this handler and its tests; axis: none (the one iCalendar writer);
 * rejected: building the text inside the handler (the clock and the line rules could not be tested without the store).
 */
import { timingSafeEqual } from "node:crypto";
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { activeSeats, localToInstant, type Instant } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { requireRole } from "../../auth/policy.js";
import {
    getBookingViews, getCourse, getResource, getRun, readIntervals, runsNotEndedBy, schedulingStoreFromEnv, sha256hex,
    type BookingFeedView,
} from "../../lib/scheduling-db.js";
import { guarded, readTenantRecord, refusal, type Answer } from "../common.js";
import { linkNotValid } from "./common.js";

const DAY_MS = 86_400_000;
const FEED_PAST_DAYS = 60;
const FEED_AHEAD_DAYS = 365;
/** Compared when there is no stored hash, so every "no" takes the same steps. Not the hash of any 43-character secret. */
const NO_HASH = "0".repeat(64);
/** § 12 secret: 32 random bytes, base64url without padding = 43 characters (`resources-feed-secret.ts`). */
const SECRET_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const FeedBodySchema = z.object({
    resourceId: z.string().min(1).max(200).refine((v) => !v.includes("#")),
    secret: z.string().regex(SECRET_FORMAT),
}).strict();

/** One slot appointment in the feed: times and names from `BOOKING#` (no customer field exists in this type). */
export type FeedSlot = { bookingId: string; ref: string; serviceName: string; start: Instant; end: Instant; held: boolean };
/** One meeting of a run the resource trains. `n` = 1-based position in the run's stored meeting list. */
export type FeedMeeting = { runId: string; n: number; courseName: string; start: Instant; end: Instant; taken: number; capacity: number };

/** `YYYYMMDDTHHMMSSZ` (iCalendar UTC form, RFC 5545 § 3.3.5). */
function icsTime(at: Instant): string {
    return new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** RFC 5545 § 3.3.11 TEXT: backslash, semicolon, comma escaped; a line break becomes `\n`. */
function icsText(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** RFC 5545 § 3.1: a content line longer than 75 octets is folded (CRLF + one space); a UTF-8 sequence is never split. */
function fold(line: string): string {
    const out: string[] = [];
    let current = "";
    let octets = 0;
    for (const ch of line) {
        const size = Buffer.byteLength(ch, "utf8");
        const limit = out.length === 0 ? 75 : 74; // a continuation line starts with the one space
        if (octets + size > limit) {
            out.push(current);
            current = "";
            octets = 0;
        }
        current += ch;
        octets += size;
    }
    out.push(current);
    return out.join("\r\n ");
}

/**
 * The iCalendar text (pure; `now` injected). Events sorted by start, then UID, so the same data gives the same text.
 * Lines end with CRLF (RFC 5545 § 3.1).
 */
export function feedCalendar(input: { tenantId: string; now: Instant; slots: FeedSlot[]; meetings: FeedMeeting[] }): string {
    const { tenantId, now } = input;
    type Event = { uid: string; start: Instant; end: Instant; summary: string; status: "CONFIRMED" | "TENTATIVE" };
    const events: Event[] = [
        ...input.slots.map((s): Event => ({
            uid: `${s.bookingId}@${tenantId}`, start: s.start, end: s.end, summary: `${s.serviceName} ${s.ref}`,
            status: s.held ? "TENTATIVE" : "CONFIRMED",
        })),
        ...input.meetings.map((m): Event => ({
            uid: `${m.runId}-${m.n}@${tenantId}`, start: m.start, end: m.end, summary: `${m.courseName} ${m.taken}/${m.capacity}`,
            status: "CONFIRMED",
        })),
    ].sort((a, b) => a.start - b.start || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AMODX//Scheduling feed//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    for (const e of events) {
        lines.push(
            "BEGIN:VEVENT",
            `UID:${icsText(e.uid)}`,
            `DTSTAMP:${icsTime(now)}`,
            `DTSTART:${icsTime(e.start)}`,
            `DTEND:${icsTime(e.end)}`,
            `SUMMARY:${icsText(e.summary)}`,
            `STATUS:${e.status}`,
            "END:VEVENT",
        );
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
}

/** The slot events of `views` for `resourceId` inside `window` (the rules of the header). */
function feedSlots(views: BookingFeedView[], resourceId: string, window: { start: Instant; end: Instant }, now: Instant): FeedSlot[] {
    return views.flatMap((b): FeedSlot[] => {
        if (b.what.kind !== "slot" || b.what.resourceId !== resourceId) return [];
        if (!(b.what.start < window.end && window.start < b.what.end)) return [];
        let held: boolean;
        switch (b.state.kind) {
            case "confirmed": held = false; break;
            case "held": if (b.state.expiresAt <= now) return []; held = true; break;
            case "cancelled": return [];
            default: {
                const never: never = b.state;
                throw new Error(`Unhandled state ${JSON.stringify(never)}`);
            }
        }
        return [{ bookingId: b.id, ref: b.ref, serviceName: b.what.serviceName, start: b.what.start, end: b.what.end, held }];
    });
}

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event): Promise<Answer> => {
    const tenantId = event.headers["x-tenant-id"];
    if (!tenantId) return refusal(400, "invalid", "Missing x-tenant-id header");
    try {
        requireRole(event.requestContext.authorizer.lambda, ["RENDERER"]);
    } catch (e) {
        return refusal(403, "forbidden", e instanceof Error ? e.message : "Access Denied");
    }
    let raw: unknown = {};
    if (event.body) {
        try {
            raw = JSON.parse(event.body);
        } catch {
            return refusal(400, "invalid", "The body is not JSON.");
        }
    }
    return guarded("visitor-feed", async () => {
        // Access reads are consistent (rule of the header): a switch turned off or a secret rotated acts at once.
        const record = await readTenantRecord(tenantId, true);
        if (record === undefined || record.schedulingEnabled !== true) return linkNotValid();
        const body = FeedBodySchema.safeParse(raw);
        if (!body.success) return linkNotValid();
        const { resourceId, secret } = body.data;

        const store = schedulingStoreFromEnv();
        const resource = await getResource(store, tenantId, resourceId, true);
        const presented = Buffer.from(sha256hex(secret), "utf8");
        const stored = Buffer.from(resource?.feedSecretHash ?? NO_HASH, "utf8");
        const equal = stored.length === presented.length && timingSafeEqual(stored, presented);
        if (resource === undefined || resource.feedSecretHash === undefined || !equal) return linkNotValid();

        const now = Date.now();
        const window = { start: now - FEED_PAST_DAYS * DAY_MS, end: now + FEED_AHEAD_DAYS * DAY_MS };

        const entries = await readIntervals(store, tenantId, resourceId, window, now);
        const views = await getBookingViews(store, tenantId, entries.map((e) => e.bookingId), "feed");
        if (!views.ok) return refusal(503, "busy", "Busy, please try again.");

        const runs = await runsNotEndedBy(store, tenantId, window.start, window.end, false);
        if (!runs.ok) return refusal(503, "busy", "Busy, please try again.");
        const trained = runs.value.filter((r) => r.trainerIds.includes(resourceId) && r.status !== "cancelled");
        const courseIds = [...new Set(trained.map((r) => r.courseId))];
        const [courses, records] = await Promise.all([
            Promise.all(courseIds.map((c) => getCourse(store, tenantId, c, false))),
            Promise.all(trained.map((r) => getRun(store, tenantId, r.courseId, r.runId, false))),
        ]);
        const courseName = new Map(courseIds.map((c, i) => [c, courses[i]?.name ?? ""]));
        const meetings: FeedMeeting[] = trained.flatMap((r, i) => {
            const capacity = records[i]?.capacity;
            if (capacity === undefined) return []; // a run is cancelled, never deleted: not reached
            const taken = activeSeats(r.seats, now);
            return r.meetings.flatMap((m, index): FeedMeeting[] => {
                const start = localToInstant(m.date, m.start, r.timezone);
                const end = localToInstant(m.date, m.end, r.timezone);
                if (!start.ok || !end.ok) {
                    // Validated in this zone when written; a time-zone rules update could remove the local time.
                    console.error("[scheduling] visitor-feed meeting time does not exist", r.courseId, r.runId, index + 1);
                    return [];
                }
                if (!(start.value < window.end && window.start < end.value)) return [];
                return [{ runId: r.runId, n: index + 1, courseName: courseName.get(r.courseId) ?? "", start: start.value, end: end.value, taken, capacity }];
            });
        });

        // Not `answer()`: that writes JSON. The body is the calendar text itself.
        return {
            statusCode: 200,
            headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" },
            body: feedCalendar({ tenantId, now, slots: feedSlots(views.value, resourceId, window, now), meetings }),
        };
    });
};
