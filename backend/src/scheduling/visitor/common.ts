/**
 * SCHED-1D2 — the frame of the scheduling VISITOR routes (docs/slices/sched-1.md § 10.1, § 10.2, § 16.3). PROTOTYPE.
 *
 * Access (§ 10.2, PD-002 booking-token variant, § 16.3): the caller is the renderer (`RENDERER` key, which resolves to
 * `tenantId: "ALL"`, G11); `GLOBAL_ADMIN` also passes `requireRole` (policy) and is handled the same way. The tenant is
 * the `x-tenant-id` header that caller sets — the renderer derives it from the URL it serves, never from the browser.
 * `requireRole` is therefore called WITHOUT a target tenant: both admitted callers are deployment-wide by design; every
 * other role (TENANT_ADMIN, EDITOR, SERVICE, CUSTOMER, anonymous) → 403 `forbidden`. A request without a credential
 * never reaches a handler: the authorizer refuses it (these routes are not in its anonymous list).
 *
 * Switch (§ 10.2, row D1): no tenant record, or `schedulingEnabled !== true` → 403 `notAvailable` on every visitor
 * route (the feed of `sched-1g` answers 404 instead), decided on the RAW record before any stored scheduling setting
 * is validated (review S1D2-R05: a switched-off tenant with a broken stored setting is still "not available"). For an
 * enabled tenant the settings are then parsed (`parseSchedulingTenant`: a stored value that fails → 500
 * `storedDataInvalid`). An enabled tenant without a stored time zone cannot be produced by PUT /settings (enabling
 * without it is 400), so it is stored data that fails its rule: 500 `storedDataInvalid`.
 *
 * Reads that decide whether a write runs are consistent (§ 6.4 rule 4, review S1D2-R04): the token lookup and the
 * booking's place (`bookingByLink`), the move target. Reads for an answer or a mail after the decision are display
 * reads (`placeFor`).
 *
 * Abstraction lines:
 * - `visitorRoute` — users: the eight visitor handlers; axis: none (one access and switch rule for every visitor
 *   route, row D2); rejected: the block written eight times.
 * - `visitorRefusal` — users: hold, confirm, cancel, move; axis: refusal kinds of `scheduling-db.ts` (a closed sum,
 *   exhaustive `switch`: a new refusal breaks the compile here); rejected: one mapping per route (the § 10.2 codes
 *   would drift between routes).
 * - `parseLinkBody` + `bookingByLink` + `readPlace` — users: view, confirm, cancel, move; axis: none (the one token rule
 *   of § 8.4: an unknown, malformed — any length or shape —, deleted, other-tenant or `gone` link is one answer, 404
 *   `linkNotValid`); rejected: per-route lookups.
 * - `placeFor` — users: confirm, cancel, move (answers and mails); axis: none (one rule, review S1D2-R03: an answer
 *   or a mail is built from the place of the EXACT booking it describes; a known place is reused only when that
 *   booking has the same placement); rejected: pairing a re-read booking with a place read for another placement.
 */
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { requireRole } from "../../auth/policy.js";
import {
    addressKey, tokenView, viewerAddress,
    type Booking, type ChangeRefusal, type ConfirmRefusal, type Course, type Eligibility, type Instant,
    type SchedulingSettings, type SeatRefusal, type SlotRefusal, type TimeZone,
} from "@amodx/shared";
import {
    StoredDataInvalidError, getBookingByToken, getCourse, getRun, iso,
    type Busy, type NotFound, type RunRecord, type SchedulingStore,
} from "../../lib/scheduling-db.js";
import {
    guarded, parseSchedulingTenant, parseValue, readTenantRecord, refusal,
    type Answer, type SchedulingEvent, type SchedulingTenant,
} from "../common.js";

/** § 10.2 role oracle: the renderer key; `requireRole` admits GLOBAL_ADMIN before it reads this list. */
const VISITOR_CALLERS = ["RENDERER"];
const HOUR_MS = 3_600_000;

/** The tenant's scheduling settings with the time zone present (an enabled tenant always has one, § 4.1). */
export type VisitorSettings = SchedulingSettings & { timezone: TimeZone };
export type VisitorContext = { tenantId: string; auth: AuthorizerContext; tenant: SchedulingTenant; settings: VisitorSettings };

/**
 * The frame of every visitor route: tenant header (400), role (403 `forbidden`), then inside `guarded`: the tenant
 * record (`consistent` for the routes that write), the switch (403 `notAvailable`), then `run`.
 */
export async function visitorRoute(event: SchedulingEvent, route: string, opts: { consistent: boolean },
    run: (ctx: VisitorContext) => Promise<Answer>): Promise<Answer> {
    const tenantId = event.headers["x-tenant-id"];
    if (!tenantId) return refusal(400, "invalid", "Missing x-tenant-id header");
    const auth = event.requestContext.authorizer.lambda;
    try {
        requireRole(auth, VISITOR_CALLERS);
    } catch (e) {
        return refusal(403, "forbidden", e instanceof Error ? e.message : "Access Denied");
    }
    return guarded(route, async () => {
        const record = await readTenantRecord(tenantId, opts.consistent);
        // D1: the switch first, on the raw record; nothing stored is validated for a tenant that is off.
        if (record === undefined || record.schedulingEnabled !== true) return refusal(403, "notAvailable", "Booking is not available on this site.");
        const tenant = parseSchedulingTenant(tenantId, record);
        const timezone = tenant.scheduling?.timezone;
        if (tenant.scheduling === undefined || timezone === undefined) throw new StoredDataInvalidError(`TENANT#${tenantId}.scheduling`);
        return run({ tenantId, auth, tenant, settings: { ...tenant.scheduling, timezone } });
    });
}

/**
 * § 9.2: the viewer address the renderer proxy sent as `x-viewer-address`, read ONLY from a `RENDERER` caller (the
 * renderer builds that request and never forwards browser headers; any other caller's header is ignored, row D11).
 * The backend re-checks it with the shared rule (`viewerAddress(…, "xff", 1)`: one entry, same forms) and recomputes
 * `addressKey`. Missing, invalid or another role → `undefined`: no address limit and no `remoteip` for this request,
 * logged without the header value.
 */
export function viewerAddressOf(event: SchedulingEvent, auth: AuthorizerContext): { ip: string; key: string } | undefined {
    const parsed = auth.role === "RENDERER" ? viewerAddress(event.headers["x-viewer-address"], "xff", 1) : undefined;
    if (parsed === undefined || !parsed.ok) {
        console.log("[scheduling] no viewer address");
        return undefined;
    }
    return { ip: parsed.value, key: addressKey(parsed.value) };
}

/** The resource ids a service may use among `existing` (§ 4.2 eligibility). Used to bound reads and move candidates. */
export function eligibleIds(eligibility: Eligibility, existing: string[]): string[] {
    switch (eligibility.kind) {
        case "all": return existing;
        case "only": return existing.filter((id) => eligibility.resourceIds.includes(id));
        default: {
            const never: never = eligibility;
            throw new Error(`Unhandled eligibility ${JSON.stringify(never)}`);
        }
    }
}

/** Seconds to the next hour: the `LIMIT#` counters are hourly windows (§ 9). */
function retryAfter(now: Instant): string {
    const next = (Math.floor(now / HOUR_MS) + 1) * HOUR_MS;
    return String(Math.max(1, Math.ceil((next - now) / 1000)));
}

/** Every refusal a visitor write can meet (hold, confirm, cancel, move), from the kernel and `scheduling-db.ts`. */
export type VisitorRefusal =
    | SlotRefusal | SeatRefusal | ChangeRefusal | ConfirmRefusal
    | { kind: "slotTaken" } | { kind: "tooManyForEmail" } | { kind: "tooManyFromAddress" } | { kind: "stale" }
    | NotFound | Busy;

/**
 * § 10.2 / § 8.4 answers. `notFound` is the route's own answer for a missing target (404 `linkNotValid` on the token
 * routes, where it means the booking is gone; 404 `notFound` on the hold, where it means the service or run).
 */
export function visitorRefusal(r: VisitorRefusal, now: Instant, notFound: Answer): Answer {
    switch (r.kind) {
        case "inPast": return refusal(409, "inPast", "This time has passed.");
        case "beyondHorizon": return refusal(409, "beyondHorizon", "This date is too far ahead.", { lastBookableDate: r.lastBookableDate });
        case "notEligible": return refusal(409, "notEligible", "This service is not offered at this time.");
        case "resourceUnavailable": return refusal(409, "resourceUnavailable", "This time is no longer offered.");
        case "notOnGrid": return refusal(409, "notOnGrid", "This is not a start time of the service.");
        case "outsideAvailability": return refusal(409, "outsideAvailability", "This time is not open for booking.");
        case "slotTaken": return refusal(409, "slotTaken", "This time was just taken.");
        case "runCancelled": return refusal(409, "runCancelled", "This group is cancelled.");
        case "runClosed": return refusal(409, "runClosed", "This group takes no new bookings.");
        case "runStarted": return refusal(409, "runStarted", "This group has started.");
        case "runFull": return refusal(409, "runFull", "This group is full.", { capacity: r.capacity });
        case "languageMismatch": return refusal(409, "languageMismatch", "This group is in another language.", { run: r.run, person: r.person });
        case "tooManyForEmail":
            return refusal(429, "tooManyForEmail", "Too many bookings for this email address. Please try later.", {}, { "Retry-After": retryAfter(now) });
        case "tooManyFromAddress":
            return refusal(429, "tooManyFromAddress", "Too many bookings from this network. Please try later.", {}, { "Retry-After": retryAfter(now) });
        case "tooLate": return refusal(409, "tooLate", "The change window has closed.", { cutoff: iso(r.cutoff) });
        case "notConfirmed": return refusal(409, "notConfirmed", "The booking is not confirmed yet.");
        case "paidContactTenant": return refusal(409, "paidContactTenant", "A paid booking is changed by the site. Please contact us.");
        case "notActive":
            switch (r.state) {
                case "expired": return refusal(410, "expired", "The booking has expired.");
                case "cancelled": return refusal(409, "cancelled", "The booking is cancelled.");
                default: {
                    const never: never = r.state;
                    throw new Error(`Unhandled state ${String(never)}`);
                }
            }
        case "expired": return refusal(410, "expired", "The booking has expired.", { expiresAt: iso(r.at) });
        case "cancelled": return refusal(409, "cancelled", "The booking is cancelled.");
        case "stale": return refusal(409, "stale", "The booking changed; read it again.");
        case "notFound": return notFound;
        case "busy": return refusal(503, "busy", "Busy, please try again.");
        default: {
            const never: never = r;
            throw new Error(`Unhandled refusal ${JSON.stringify(never)}`);
        }
    }
}

/** The one answer for a link that opens nothing (§ 8.4: no existence leak). */
export const linkNotValid = (): Answer => refusal(404, "linkNotValid", "This link is not valid.");

/**
 * § 8.1 link token format: 32 random bytes, base64url without padding = exactly 43 characters of `[A-Za-z0-9_-]`.
 * The same rule as the store's `getBookingByToken` (which keeps its own check as a second guard); the two are pinned
 * equal by the test "S1D2-R05 the route's token format equals the store's" (scheduling-visitor.test.ts), which runs the
 * REAL `getBookingByToken` on the same samples. Not exported from `scheduling-db.ts` (outside the allocation).
 */
const LINK_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/**
 * The body of a token route: `{ token, ...rest }`. Not JSON → 400 `invalid`.
 * Rule (review S1D2-R05, operator ruling after review-0: a malformed token of any length or shape is the one answer
 * of § 8.4): the token is checked IN FULL — present, a string, in the § 8.1 format — before any other field. A body
 * that is not an object, or a token that fails any part → 404 `linkNotValid`, with no lookup, write or mail.
 * Only then `rest` through `schema` (strict) → 400 `invalid` with the issue paths.
 */
export function parseLinkBody<S extends z.ZodType>(event: SchedulingEvent, schema: S)
    : { ok: true; token: string; value: z.output<S> } | { ok: false; answer: Answer } {
    let raw: unknown = {};
    if (event.body) {
        try {
            raw = JSON.parse(event.body);
        } catch {
            return { ok: false, answer: refusal(400, "invalid", "The body is not JSON.") };
        }
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, answer: linkNotValid() };
    const { token, ...rest } = raw as Record<string, unknown>;
    if (typeof token !== "string" || !LINK_TOKEN_FORMAT.test(token)) return { ok: false, answer: linkNotValid() };
    const parsed = parseValue(rest, schema);
    return parsed.ok ? { ok: true, token, value: parsed.value } : parsed;
}

/** The rest of the body of view, confirm and cancel: nothing besides the token. */
export const NoMoreFields = z.object({}).strict();

/** The course and run a booking names (none for a slot). */
export type Place = { course?: Course; run?: RunRecord };

/**
 * The course and run of a seat or unplaced booking. `consistent` when the result decides whether a write runs
 * (§ 6.4 rule 4). A missing one is a broken invariant (a course is not deleted while a run or an unplaced booking
 * exists; a run is cancelled, never deleted): it throws (500 `internal`).
 */
export async function readPlace(store: SchedulingStore, tenantId: string, b: Booking, consistent: boolean): Promise<Place> {
    const what = b.what;
    switch (what.kind) {
        case "slot": return {};
        case "seat": {
            const [course, run] = await Promise.all([
                getCourse(store, tenantId, what.courseId, consistent), getRun(store, tenantId, what.courseId, what.runId, consistent),
            ]);
            if (course === undefined || run === undefined) throw new Error("[scheduling] seat booking without its course or run");
            return { course, run };
        }
        case "unplaced": {
            const course = await getCourse(store, tenantId, what.courseId, consistent);
            if (course === undefined) throw new Error("[scheduling] unplaced booking without its course");
            return { course };
        }
        default: {
            const never: never = what;
            throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
        }
    }
}

/** The placement a `Place` belongs to: the course and run ids a booking names (a slot names none). */
function placementKey(what: Booking["what"]): string {
    switch (what.kind) {
        case "slot": return "slot";
        case "seat": return `seat#${what.courseId}#${what.runId}`;
        case "unplaced": return `unplaced#${what.courseId}`;
        default: {
            const never: never = what;
            throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
        }
    }
}

/**
 * The place of EXACTLY `booking` (review S1D2-R03): `known.place` when `booking` names the same course and run as
 * `known.what`, else a display read for `booking`. Every visitor answer and mail goes through this, so a booking
 * re-read by a later step (a token mint, a competing move) is never paired with another placement's run.
 */
export async function placeFor(store: SchedulingStore, tenantId: string, booking: Booking,
    known: { what: Booking["what"]; place: Place }): Promise<Place> {
    return placementKey(booking.what) === placementKey(known.what) ? known.place : readPlace(store, tenantId, booking, false);
}

/**
 * § 8.4 AP2: the booking a link token opens, with its place; `undefined` for every case of the one answer 404
 * `linkNotValid` (unknown, malformed, deleted, another tenant's, a booking whose `tokenView` is `gone`). Both reads are
 * consistent (§ 6.4 rule 4): they decide whether the route answers 404 or goes on to write; a link opened seconds
 * after its mail must not read as unknown, and a stale run end must not close a valid link. The token is never logged.
 * A held booking past `expiresAt` is returned: each route decides (view → 410, the writers → the store's `expired`).
 */
export async function bookingByLink(store: SchedulingStore, tenantId: string, token: string, now: Instant)
    : Promise<{ booking: Booking; place: Place } | undefined> {
    const booking = await getBookingByToken(store, tenantId, token, true);
    if (booking === undefined || booking.state.kind === "cancelled") return undefined;
    const place = await readPlace(store, tenantId, booking, true);
    const endOf = place.run !== undefined ? Date.parse(place.run.lastEndIso) : null;
    return tokenView(booking, endOf, now) === "valid" ? { booking, place } : undefined;
}
