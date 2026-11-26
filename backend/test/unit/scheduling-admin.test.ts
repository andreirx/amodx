import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { BookingSchema, type Booking } from "@amodx/shared";

/**
 * SCHED-1D1 — the admin routes of `sched-1d` (docs/slices/sched-1.md § 10.3, § 17.3 rows D7, D10, D12, D13, D16).
 * The REAL handlers, `requireRole`, `events.ts` and `scheduling-email.ts`; replaced: the store functions of
 * `scheduling-db.ts` (their transactions are rows C1…C35 of `sched-1c`, tested against `FakeTable` in
 * scheduling-db.test.ts), the main-table client (`db.js`), and the AWS clients of EventBridge and SES, which record
 * every `PutEvents` and every `SendEmail`. Credential-free.
 *
 * What each row proves HERE, and what it leaves to `sched-1c` (already shipped) or `sched-1d2` (visitor routes):
 * - D7: the admin cancel sends the `cancelled` mail without a link, to the customer only, and calls the store's
 *   cancel with the admin actor. "Every token → 404": the cancel deletes every listed token (`sched-1c` C15); the
 *   route that answers a token (visitor view) is `sched-1d2`.
 * - D10 (admin part): no `PutEvents` for the admin booking cancel; one for a resource create (admin email, resource
 *   name); `SCHEDULING_CUSTOMER_ERASED` with the two counts; no `ip`, no booking id / ref / customer name / email /
 *   phone in any event. "`history` present on `BOOKING#`" for the admin cancel: the entry is appended in the cancel's
 *   own write (`sched-1c` C32); here, the handler passes the admin actor and returns that history. The visitor
 *   operations of D10 are `sched-1d2`.
 * - D12: the route's answers for "in use" and "free"; that the free removal deletes `AVAILABILITY#` and `DAYS#` in
 *   its transaction is `removeResource` (`scheduling-db.ts`, rows C11 of `sched-1c`).
 * - D13 (route part): defaults of all six keys, an override used. The PUT /settings part: scheduling-settings.test.ts.
 * - D16: the booking DTO lists `history` in stored order with instants as UTC ISO.
 */

const h = vi.hoisted(() => {
    process.env.EVENT_BUS_NAME = "test-bus";
    process.env.SCHEDULING_TABLE_NAME = "sched-table";
    return {
        ddbSend: vi.fn(),
        putEvents: [] as any[],
        sesSends: [] as any[],
        sesFail: { on: false },
        store: {
            getBooking: vi.fn(), getResource: vi.fn(), listResources: vi.fn(),
            createResource: vi.fn(), renameResource: vi.fn(), removeResource: vi.fn(), setFeedSecretHash: vi.fn(),
            cancelBooking: vi.fn(), bookingIdsOfEmail: vi.fn(), eraseCustomer: vi.fn(),
        },
    };
});

vi.mock("../../src/lib/db.js", () => ({ db: { send: h.ddbSend }, TABLE_NAME: "main-table" }));
vi.mock("@aws-sdk/client-eventbridge", () => ({
    EventBridgeClient: class { async send(cmd: any) { h.putEvents.push(cmd.input); return {}; } },
    PutEventsCommand: class { constructor(public input: any) {} },
}));
vi.mock("@aws-sdk/client-ses", () => ({
    SESClient: class {
        async send(cmd: any) {
            if (h.sesFail.on) throw Object.assign(new Error("MessageRejected"), { name: "MessageRejected" });
            h.sesSends.push(cmd.input);
            return {};
        }
    },
    SendEmailCommand: class { constructor(public input: any) {} },
}));
vi.mock("../../src/lib/scheduling-db.js", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../src/lib/scheduling-db.js")>();
    return { ...real, ...h.store, schedulingStoreFromEnv: () => ({ db: { send: vi.fn() }, table: "sched-table", sleep: async () => {} }) };
});

import { handler as getBookingRoute } from "../../src/scheduling/admin/bookings-get.js";
import { handler as cancelRoute } from "../../src/scheduling/admin/bookings-cancel.js";
import { handler as lookupRoute } from "../../src/scheduling/admin/customers-lookup.js";
import { handler as eraseRoute } from "../../src/scheduling/admin/customers-erase.js";
import { handler as listResourcesRoute } from "../../src/scheduling/admin/resources-list.js";
import { handler as createResourceRoute } from "../../src/scheduling/admin/resources-create.js";
import { handler as updateResourceRoute } from "../../src/scheduling/admin/resources-update.js";
import { handler as deleteResourceRoute } from "../../src/scheduling/admin/resources-delete.js";
import { handler as feedSecretRoute } from "../../src/scheduling/admin/resources-feed-secret.js";
import { handler as templatesRoute } from "../../src/scheduling/admin/email-templates.js";
import { StoredDataInvalidError } from "../../src/lib/scheduling-db.js";
import { defaultSchedulingTemplates } from "../../src/lib/scheduling-email.js";

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const EDITOR = { sub: "u2", email: "editor@t1.test", role: "EDITOR", tenantId: "t1" };
const GLOBAL = { sub: "g1", email: "root@amodx.test", role: "GLOBAL_ADMIN", tenantId: "ALL" };
const OTHER_TENANT_ADMIN = { sub: "u3", email: "admin@t2.test", role: "TENANT_ADMIN", tenantId: "t2" };

const T0 = Date.parse("2026-12-01T10:00:00.000Z");
const START = Date.parse("2026-12-07T07:00:00.000Z");   // 09:00 Europe/Bucharest
const END = Date.parse("2026-12-07T08:00:00.000Z");
const CUSTOMER = { email: "ana.pop@example.test", name: "Ana Pop", phone: "+40 700 000 000" };
const BOOKING_ID = "0b9f1c2a-1111-4222-8333-444455556666";

function booking(over: Partial<Booking> = {}): Booking {
    return BookingSchema.parse({
        id: BOOKING_ID, ref: "B-0B9F1C2A", rev: 3,
        what: { kind: "slot", serviceId: "svc1", serviceName: "Consultation", resourceId: "res1", start: START, end: END },
        state: { kind: "confirmed", at: T0 + 60_000 },
        source: { kind: "visitor" }, who: CUSTOMER, tokenHashes: ["a".repeat(64)],
        createdAt: T0, updatedAt: T0 + 120_000,
        history: [
            { action: "created", at: T0, state: "held", placement: { kind: "slot", resourceId: "res1", start: START - 3_600_000, end: END - 3_600_000 } },
            { action: "confirmed", at: T0 + 60_000 },
            { action: "moved", at: T0 + 120_000, by: { kind: "admin", email: "admin@t1.test" },
              from: { kind: "slot", resourceId: "res1", start: START - 3_600_000, end: END - 3_600_000 },
              to: { kind: "slot", resourceId: "res1", start: START, end: END } },
        ],
        ...over,
    });
}

const TENANT_RECORD = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Clinic One", domain: "clinic.example", scheduling: { timezone: "Europe/Bucharest" } };
let tenantRecord: Record<string, any> | undefined;

type Res = { statusCode: number; body: string; headers?: Record<string, string> };
async function call(route: any, opts: { auth?: any; path?: Record<string, string>; body?: unknown; rawBody?: string; tenant?: string | null } = {}): Promise<Res & { json: any }> {
    const event = {
        headers: opts.tenant === null ? {} : { "x-tenant-id": opts.tenant ?? "t1" },
        pathParameters: opts.path,
        requestContext: { authorizer: { lambda: opts.auth ?? TENANT_ADMIN }, http: { sourceIp: "203.0.113.9" } },
        body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    };
    const res = (await route(event, {} as any, () => {})) as Res;
    return { ...res, json: res.body ? JSON.parse(res.body) : undefined };
}

/** Every recorded audit event, parsed from its PutEvents `Detail`. */
const auditEvents = () => h.putEvents.flatMap((input) => input.Entries.map((e: any) => ({ raw: e.Detail as string, detail: JSON.parse(e.Detail) })));

beforeEach(() => {
    process.env.SES_FROM_EMAIL = "noreply@amodx.test";
    process.env.RENDERER_CLOUDFRONT_ORIGIN = "https://d111.cloudfront.net";
    h.putEvents.length = 0;
    h.sesSends.length = 0;
    h.sesFail.on = false;
    tenantRecord = structuredClone(TENANT_RECORD);
    h.ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd.input?.Key?.PK === "SYSTEM" && cmd.input?.Key?.SK === "TENANT#t1") return { Item: tenantRecord };
        return {};
    });
    for (const fn of Object.values(h.store)) fn.mockReset();
    h.store.getBooking.mockResolvedValue(booking());   // the cancel reads the booking before its write (R01)
    h.store.getResource.mockResolvedValue({ id: "res1", name: "Dr. Ionescu" });
});

// ---------------------------------------------------------------------------------------------------------------
// Role oracle (§ 10.3)
// ---------------------------------------------------------------------------------------------------------------

describe("role oracle of the admin routes (§ 10.3)", () => {
    it("no x-tenant-id → 400; a user of another tenant → 403 forbidden; GLOBAL_ADMIN passes", async () => {
        h.store.listResources.mockResolvedValue([]);
        expect((await call(listResourcesRoute, { tenant: null })).statusCode).toBe(400);
        const other = await call(listResourcesRoute, { auth: OTHER_TENANT_ADMIN });
        expect([other.statusCode, other.json.code]).toEqual([403, "forbidden"]);
        expect((await call(listResourcesRoute, { auth: GLOBAL })).statusCode).toBe(200);
        expect((await call(listResourcesRoute, { auth: EDITOR })).statusCode).toBe(200);
    });

    it("T routes (erasure, feed secret) refuse an EDITOR with 403 and change nothing", async () => {
        const erase = await call(eraseRoute, { auth: EDITOR, body: { email: CUSTOMER.email } });
        expect([erase.statusCode, erase.json.code]).toEqual([403, "forbidden"]);
        const feed = await call(feedSecretRoute, { auth: EDITOR, path: { resourceId: "res1" }, body: {} });
        expect(feed.statusCode).toBe(403);
        expect(h.store.eraseCustomer).not.toHaveBeenCalled();
        expect(h.store.setFeedSecretHash).not.toHaveBeenCalled();
    });

    it("a stored item that fails its schema → 500 storedDataInvalid, logged with the key only", async () => {
        h.store.getBooking.mockRejectedValue(new StoredDataInvalidError(`BOOKING#${BOOKING_ID}`));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call(getBookingRoute, { path: { bookingId: BOOKING_ID } });
        expect([res.statusCode, res.json.code]).toEqual([500, "storedDataInvalid"]);
        expect(log.mock.calls.flat().join(" ")).toContain(`BOOKING#${BOOKING_ID}`);
        log.mockRestore();
    });

    it("R01 any other error → 500 internal, logged by its name only (a message can carry a stored value)", async () => {
        h.store.getBooking.mockRejectedValue(Object.assign(new Error("timezone Mars/Olympus is not valid"), { name: "RangeError" }));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call(getBookingRoute, { path: { bookingId: BOOKING_ID } });
        expect([res.statusCode, res.json.code]).toEqual([500, "internal"]);
        const logged = log.mock.calls.flat().map(String).join(" ");
        expect(logged).toContain("RangeError");
        expect(logged).not.toContain("Mars/Olympus");
        expect(res.body).not.toContain("Mars/Olympus");
        log.mockRestore();
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------------------------------------------

describe("D16 GET /scheduling/admin/bookings/{bookingId}", () => {
    it("D16 after a hold, a confirm and a move: history = created, confirmed, moved, in that order, instants as UTC ISO", async () => {
        h.store.getBooking.mockResolvedValue(booking());
        const res = await call(getBookingRoute, { path: { bookingId: BOOKING_ID }, auth: EDITOR });
        expect(res.statusCode).toBe(200);
        expect(res.json.history.map((e: any) => e.action)).toEqual(["created", "confirmed", "moved"]);
        expect(res.json.history[0]).toEqual({
            action: "created", at: "2026-12-01T10:00:00.000Z", state: "held",
            placement: { kind: "slot", resourceId: "res1", start: "2026-12-07T06:00:00.000Z", end: "2026-12-07T07:00:00.000Z" },
        });
        expect(res.json.history[2]).toMatchObject({
            action: "moved", at: "2026-12-01T10:02:00.000Z", by: { kind: "admin", email: "admin@t1.test" },
            to: { kind: "slot", start: "2026-12-07T07:00:00.000Z", end: "2026-12-07T08:00:00.000Z" },
        });
        expect(res.json.what).toEqual({
            kind: "slot", serviceId: "svc1", serviceName: "Consultation", resourceId: "res1", resourceName: "Dr. Ionescu",
            start: "2026-12-07T07:00:00.000Z", end: "2026-12-07T08:00:00.000Z",
        });
        expect(res.json.state).toEqual({ kind: "confirmed", at: "2026-12-01T10:01:00.000Z" });
        expect(res.json).not.toHaveProperty("tokenHashes");
        expect(h.store.getBooking).toHaveBeenCalledWith(expect.anything(), "t1", BOOKING_ID, false);
    });

    it("unknown id (or an id of another tenant: the store is read under the caller's tenant) → 404 notFound", async () => {
        h.store.getBooking.mockResolvedValue(undefined);
        const res = await call(getBookingRoute, { path: { bookingId: "nope" } });
        expect([res.statusCode, res.json.code]).toEqual([404, "notFound"]);
    });

    it("G3 a stored booking of the removed group shape (the store's getBooking reads it as absent, scheduling-db.test.ts G3) → 404 notFound, the same answer as an unknown id", async () => {
        h.store.getBooking.mockResolvedValue(undefined);
        const legacy = await call(getBookingRoute, { path: { bookingId: "seat-booking-1" } });
        const unknown = await call(getBookingRoute, { path: { bookingId: "nope" } });
        expect([legacy.statusCode, legacy.json]).toEqual([unknown.statusCode, unknown.json]);
        expect([legacy.statusCode, legacy.json.code]).toEqual([404, "notFound"]);
    });

});

describe("D7 POST /scheduling/admin/bookings/{bookingId}/cancel", () => {
    const cancelledBooking = () => booking({
        rev: 4, tokenHashes: [], state: { kind: "cancelled", at: T0 + 180_000, by: { kind: "admin", email: EDITOR.email } },
        history: [...booking().history, { action: "cancelled", at: T0 + 180_000, by: { kind: "admin", email: EDITOR.email } }],
    });

    it("D7 an admin cancel (its own invocation, apart from any hold call): the cancelled mail WITHOUT a link, to the customer only", async () => {
        h.store.cancelBooking.mockResolvedValue({ ok: true, value: cancelledBooking() });
        const res = await call(cancelRoute, { auth: EDITOR, path: { bookingId: BOOKING_ID }, body: {} });
        expect(res.statusCode).toBe(200);
        // The store's cancel ran with the admin actor (its write appends the `cancelled` history entry, sched-1c C32).
        expect(h.store.cancelBooking).toHaveBeenCalledTimes(1);
        expect(h.store.cancelBooking.mock.calls[0][1]).toMatchObject({ tenantId: "t1", bookingId: BOOKING_ID, actor: { kind: "admin", email: EDITOR.email } });
        expect(h.sesSends).toHaveLength(1);
        const mail = h.sesSends[0];
        expect(mail.Destination.ToAddresses).toEqual([CUSTOMER.email]);
        expect(mail.Source).toBe('"Clinic One" <noreply@amodx.test>');
        expect(mail.Message.Subject.Data).toBe("Booking B-0B9F1C2A cancelled");
        const text = mail.Message.Body.Text.Data as string;
        expect(text).toContain("Ana Pop");
        expect(text).toContain("Consultation, 2026-12-07 09:00 (Europe/Bucharest)");
        expect(text).not.toMatch(/#t=|_booking|https?:\/\//);   // no link: every token was deleted
        expect(text).not.toContain("{{");
        // The answer: the cancelled booking with its history (last entry: cancelled by this admin).
        expect(res.json.state).toEqual({ kind: "cancelled", at: "2026-12-01T10:03:00.000Z", by: { kind: "admin", email: EDITOR.email } });
        expect(res.json.history.at(-1)).toEqual({ action: "cancelled", at: "2026-12-01T10:03:00.000Z", by: { kind: "admin", email: EDITOR.email } });
    });

    it.each([undefined, "business@example.test"])("F1 R1/R2 admin cancel Reply-To follows contactEmail (%s)", async (contactEmail) => {
        tenantRecord!.integrations = contactEmail === undefined ? {} : { contactEmail };
        h.store.cancelBooking.mockResolvedValue({ ok: true, value: cancelledBooking() });
        expect((await call(cancelRoute, { path: { bookingId: BOOKING_ID } })).statusCode).toBe(200);
        expect(h.sesSends).toHaveLength(1);
        expect(h.sesSends[0].Destination.ToAddresses).toEqual([CUSTOMER.email]);
        if (contactEmail === undefined) expect(h.sesSends[0]).not.toHaveProperty("ReplyToAddresses");
        else expect(h.sesSends[0].ReplyToAddresses).toEqual([contactEmail]);
    });

    it("D10 the admin booking cancel publishes NO audit event (SCHED-AUDIT-PII = C)", async () => {
        h.store.cancelBooking.mockResolvedValue({ ok: true, value: cancelledBooking() });
        await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
        expect(h.putEvents).toEqual([]);
    });

    it("the tenant's override is used; sendToCustomer: false sends nothing; the cancel stands", async () => {
        h.store.cancelBooking.mockResolvedValue({ ok: true, value: cancelledBooking() });
        tenantRecord!.schedulingEmailConfig = { templates: { cancelled: { subject: "Annulé {{ref}}", body: "Bye {{customerName}}" } } };
        await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
        expect(h.sesSends[0].Message).toEqual({ Subject: { Data: "Annulé B-0B9F1C2A" }, Body: { Text: { Data: "Bye Ana Pop" } } });
        h.sesSends.length = 0;
        tenantRecord!.schedulingEmailConfig = { templates: { cancelled: { subject: "x", body: "y", sendToCustomer: false } } };
        expect((await call(cancelRoute, { path: { bookingId: BOOKING_ID } })).statusCode).toBe(200);
        expect(h.sesSends).toEqual([]);
    });

    it("a failed send is logged with the booking id only; the cancel stands (200)", async () => {
        h.store.cancelBooking.mockResolvedValue({ ok: true, value: cancelledBooking() });
        h.sesFail.on = true;
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
        expect(res.statusCode).toBe(200);
        const logged = log.mock.calls.flat().join(" ");
        expect(logged).toContain(BOOKING_ID);
        expect(logged).not.toContain(CUSTOMER.email);
        expect(logged).not.toContain(CUSTOMER.name);
        log.mockRestore();
    });

    it("refusals: notActive → 409 with the state; notFound → 404; busy → 503", async () => {
        h.store.cancelBooking.mockResolvedValue({ ok: false, error: { kind: "notActive", state: "cancelled" } });
        const a = await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
        expect([a.statusCode, a.json.code, a.json.state]).toEqual([409, "notActive", "cancelled"]);
        h.store.cancelBooking.mockResolvedValue({ ok: false, error: { kind: "notFound" } });
        expect((await call(cancelRoute, { path: { bookingId: BOOKING_ID } })).statusCode).toBe(404);
        h.store.cancelBooking.mockResolvedValue({ ok: false, error: { kind: "busy" } });
        expect((await call(cancelRoute, { path: { bookingId: BOOKING_ID } })).statusCode).toBe(503);
        expect(h.sesSends).toEqual([]);
    });

    it("refused before any write: an unknown body key (400), a caller without an email (403), broken stored templates (500)", async () => {
        expect((await call(cancelRoute, { path: { bookingId: BOOKING_ID }, body: { rev: 3 } })).statusCode).toBe(400);
        const noEmail = await call(cancelRoute, { auth: { sub: "robot", role: "GLOBAL_ADMIN", tenantId: "ALL" }, path: { bookingId: BOOKING_ID } });
        expect([noEmail.statusCode, noEmail.json.code]).toEqual([403, "forbidden"]);
        tenantRecord!.schedulingEmailConfig = { templates: { cancelled: { body: "no subject" } } };
        vi.spyOn(console, "error").mockImplementation(() => {});
        const broken = await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
        expect([broken.statusCode, broken.json.code]).toEqual([500, "storedDataInvalid"]);
        expect(h.store.cancelBooking).not.toHaveBeenCalled();
        vi.mocked(console.error).mockRestore();
    });

    /**
     * R01 (review S1D1-R01): the stored `scheduling` attribute is parsed by its shared schema BEFORE the cancel. A
     * malformed value → 500 storedDataInvalid, NO cancel, no mail, the key logged and never the value — whether the
     * mail is on or off. Valid controls: the same calls with valid settings cancel (and mail when the mail is on).
     */
    describe("R01 stored scheduling settings are validated before the cancel", () => {
        const MAIL_OFF = { templates: { cancelled: { subject: "x", body: "y", sendToCustomer: false } } };
        const BROKEN: [string, unknown][] = [
            ["timezone not an IANA zone", { timezone: "Mars/Olympus" }],
            ["bookingHorizonWeeks 0", { timezone: "Europe/Bucharest", bookingHorizonWeeks: 0 }],
            ["holdMinutes as text", { timezone: "Europe/Bucharest", holdMinutes: "30" }],
            ["not an object", "Europe/Bucharest"],
        ];
        for (const mail of ["on", "off"] as const) {
            for (const [label, scheduling] of BROKEN) {
                it(`R01 (mail ${mail}) ${label} → 500 storedDataInvalid; no cancel, no mail; key logged, value not`, async () => {
                    h.store.cancelBooking.mockResolvedValue({ ok: true, value: booking() });
                    tenantRecord!.scheduling = scheduling;
                    if (mail === "off") tenantRecord!.schedulingEmailConfig = MAIL_OFF;
                    const log = vi.spyOn(console, "error").mockImplementation(() => {});
                    const res = await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
                    expect([res.statusCode, res.json.code]).toEqual([500, "storedDataInvalid"]);
                    expect(h.store.cancelBooking).not.toHaveBeenCalled();
                    expect(h.sesSends).toEqual([]);
                    const logged = log.mock.calls.flat().map(String).join(" ");
                    expect(logged).toContain("TENANT#t1.scheduling");
                    expect(logged).not.toContain("Mars/Olympus");
                    log.mockRestore();
                });
            }
            it(`R01 (mail ${mail}) valid control: valid stored settings → 200, one cancel, ${mail === "on" ? "one mail with the parsed zone" : "no mail"}`, async () => {
                h.store.cancelBooking.mockResolvedValue({ ok: true, value: booking() });
                tenantRecord!.scheduling = { timezone: "Europe/Bucharest", bookingHorizonWeeks: 8 };
                if (mail === "off") tenantRecord!.schedulingEmailConfig = MAIL_OFF;
                const res = await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
                expect(res.statusCode).toBe(200);
                expect(h.store.cancelBooking).toHaveBeenCalledTimes(1);
                expect(h.sesSends).toHaveLength(mail === "on" ? 1 : 0);
                if (mail === "on") expect(h.sesSends[0].Message.Body.Text.Data).toContain("2026-12-07 09:00 (Europe/Bucharest)");
            });
        }

        it("R01 a record without `scheduling` is valid: the slot time is shown in UTC", async () => {
            h.store.cancelBooking.mockResolvedValue({ ok: true, value: booking() });
            delete tenantRecord!.scheduling;
            expect((await call(cancelRoute, { path: { bookingId: BOOKING_ID } })).statusCode).toBe(200);
            expect(h.sesSends[0].Message.Body.Text.Data).toContain("2026-12-07 07:00 (UTC)");
        });

        it("R01 the same rule on the templates route: malformed stored settings → 500 storedDataInvalid", async () => {
            tenantRecord!.scheduling = { timezone: "Mars/Olympus" };
            vi.spyOn(console, "error").mockImplementation(() => {});
            const res = await call(templatesRoute);
            expect([res.statusCode, res.json.code]).toEqual([500, "storedDataInvalid"]);
            vi.mocked(console.error).mockRestore();
        });

        it("R01 the names the answer needs are read BEFORE the cancel: a failing read → error answer and no cancel", async () => {
            h.store.cancelBooking.mockResolvedValue({ ok: true, value: booking() });
            h.store.getResource.mockRejectedValue(new StoredDataInvalidError("RESOURCE#res1"));
            vi.spyOn(console, "error").mockImplementation(() => {});
            const res = await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
            expect([res.statusCode, res.json.code]).toEqual([500, "storedDataInvalid"]);
            expect(h.store.cancelBooking).not.toHaveBeenCalled();
            expect(h.sesSends).toEqual([]);
            vi.mocked(console.error).mockRestore();
        });

        it("R01 unknown booking → 404 before any write", async () => {
            h.store.getBooking.mockResolvedValue(undefined);
            expect((await call(cancelRoute, { path: { bookingId: BOOKING_ID } })).statusCode).toBe(404);
            expect(h.store.cancelBooking).not.toHaveBeenCalled();
        });

        /**
         * R07 (review S1D1-R07; § 6.4 rule 4): a read whose result decides whether a write runs is consistent. The
         * replaced store and main-table client answer like DynamoDB just after a commit: the EVENTUAL read misses the
         * item, the CONSISTENT read finds it. Only a consistent admission read lets the valid write through.
         */
        it("R07 cancel: an eventual read would miss the committed booking; the admission read is consistent → 200, one cancel", async () => {
            h.store.getBooking.mockImplementation(async (_s: unknown, _t: string, _id: string, consistent: boolean) => (consistent ? booking() : undefined));
            h.store.cancelBooking.mockResolvedValue({ ok: true, value: booking() });
            const res = await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
            expect(res.statusCode).toBe(200);
            expect(h.store.cancelBooking).toHaveBeenCalledTimes(1);
            expect(h.store.getBooking.mock.calls.map((c) => c[3])).toEqual([true]);
        });

        it("R07 cancel: a booking that does not exist for the consistent read either → 404, no cancel (true not-found kept)", async () => {
            h.store.getBooking.mockImplementation(async () => undefined);
            const res = await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
            expect([res.statusCode, res.json.code]).toEqual([404, "notFound"]);
            expect(h.store.cancelBooking).not.toHaveBeenCalled();
            expect(h.store.getBooking.mock.calls.map((c) => c[3])).toEqual([true]);
        });

        it("R01 a move that committed between the read and the cancel: the names of the NEW placement are read again", async () => {
            const moved = booking({ what: { kind: "slot", serviceId: "svc1", serviceName: "Consultation", resourceId: "res2", start: START, end: END } });
            h.store.cancelBooking.mockResolvedValue({ ok: true, value: moved });
            h.store.getResource.mockImplementation(async (_s: unknown, _t: string, id: string) => ({ id, name: id === "res2" ? "Dr. B" : "Dr. Ionescu" }));
            const res = await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
            expect(res.statusCode).toBe(200);
            expect(res.json.what.resourceName).toBe("Dr. B");
            expect(h.store.getResource.mock.calls.map((c) => c[2])).toEqual(["res1", "res2"]);
        });
    });
});

describe("R07 the tenant-record read: consistent where it decides a write, eventual for display", () => {
    /** The main table answers like DynamoDB just after the record was written: only a consistent Get sees it. */
    const onlyConsistentSeesTenant = () => h.ddbSend.mockImplementation(async (cmd: any) =>
        cmd.input?.Key?.SK === "TENANT#t1" && cmd.input?.ConsistentRead === true ? { Item: tenantRecord } : {});
    const tenantGets = () => h.ddbSend.mock.calls.map((c) => c[0].input).filter((i: any) => i?.Key?.SK === "TENANT#t1");

    it("R07 cancel: the tenant read is consistent → 200 although an eventual read would answer 404", async () => {
        onlyConsistentSeesTenant();
        h.store.cancelBooking.mockResolvedValue({ ok: true, value: booking() });
        const res = await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
        expect(res.statusCode).toBe(200);
        expect(tenantGets().map((i: any) => i.ConsistentRead)).toEqual([true]);
    });

    it("R07 feed secret: the tenant read is consistent → 200 although an eventual read would answer 404", async () => {
        onlyConsistentSeesTenant();
        h.store.setFeedSecretHash.mockResolvedValue({ ok: true, value: undefined });
        const res = await call(feedSecretRoute, { path: { resourceId: "res1" } });
        expect(res.statusCode).toBe(200);
        expect(tenantGets().map((i: any) => i.ConsistentRead)).toEqual([true]);
        expect(h.store.getResource.mock.calls.map((c) => c[3])).toEqual([true]);
    });

    it("R07 the templates GET (no write) keeps an eventual read", async () => {
        await call(templatesRoute);
        expect(tenantGets().map((i: any) => i.ConsistentRead)).toEqual([false]);
    });

    it("R07 the other admission reads were already consistent: resource update, resource delete, resource create's list", async () => {
        h.store.renameResource.mockResolvedValue({ ok: true, value: undefined });
        h.store.removeResource.mockResolvedValue({ ok: true, value: undefined });
        h.store.listResources.mockResolvedValue([]);
        h.store.createResource.mockResolvedValue({ id: "r9", name: "X" });
        await call(updateResourceRoute, { path: { resourceId: "res1" }, body: { name: "Y" } });
        await call(deleteResourceRoute, { path: { resourceId: "res1" } });
        await call(createResourceRoute, { body: { name: "X" } });
        expect(h.store.getResource.mock.calls.map((c) => c[3])).toEqual([true, true]);
        expect(h.store.listResources.mock.calls.map((c) => c[2])).toEqual([true]);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------------------------

describe("customers: lookup and erasure (§ 10.3, § 14.2)", () => {
    it("lookup: the email is normalized before the read, every booking returned as BookingAdminDTO; invalid email → 400", async () => {
        h.store.bookingIdsOfEmail.mockResolvedValue([BOOKING_ID]);
        h.store.getBooking.mockResolvedValue(booking());
        const res = await call(lookupRoute, { auth: EDITOR, body: { email: "  Ana.Pop@EXAMPLE.test " } });
        expect(res.statusCode).toBe(200);
        expect(h.store.bookingIdsOfEmail.mock.calls[0][2]).toBe("ana.pop@example.test");
        expect(res.json.bookings).toHaveLength(1);
        expect(res.json.bookings[0]).toMatchObject({ id: BOOKING_ID, ref: "B-0B9F1C2A", who: CUSTOMER });
        expect((await call(lookupRoute, { body: { email: "not-an-email" } })).statusCode).toBe(400);
        expect((await call(lookupRoute, { body: {} })).statusCode).toBe(400);
    });

    it("G3 lookup skips a stored booking of the removed group shape: CUST# lists its id, getBooking reads it as absent → only the appointment is answered, 200", async () => {
        h.store.bookingIdsOfEmail.mockResolvedValue(["seat-booking-1", BOOKING_ID]);
        h.store.getBooking.mockImplementation(async (_s: unknown, _t: string, id: string) => (id === BOOKING_ID ? booking() : undefined));
        const res = await call(lookupRoute, { auth: EDITOR, body: { email: "ana.pop@example.test" } });
        expect(res.statusCode).toBe(200);
        expect(res.json.bookings.map((b: { id: string }) => b.id)).toEqual([BOOKING_ID]);
    });

    it("D10 erasure: SCHEDULING_CUSTOMER_ERASED with the two counts only, the fixed title, the admin's email, no ip, no email in the event", async () => {
        h.store.eraseCustomer.mockResolvedValue({ ok: true, value: { removedBookings: 2, remainingBookings: 0 } });
        const res = await call(eraseRoute, { body: { email: CUSTOMER.email } });
        expect([res.statusCode, res.json]).toEqual([200, { removedBookings: 2, remainingBookings: 0 }]);
        const events = auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0].detail).toMatchObject({
            tenantId: "t1", action: "SCHEDULING_CUSTOMER_ERASED", actor: { id: "u1", email: TENANT_ADMIN.email },
            target: { title: "Scheduling customer erasure" }, details: { removedBookings: 2, remainingBookings: 0 },
        });
        expect(Object.keys(events[0].detail.details).sort()).toEqual(["remainingBookings", "removedBookings"]);
        expect(events[0].detail).not.toHaveProperty("ip");
        expect(events[0].raw).not.toContain(CUSTOMER.email);
    });

    it("erasure busy → 503, no audit event", async () => {
        h.store.eraseCustomer.mockResolvedValue({ ok: false, error: { kind: "busy" } });
        expect((await call(eraseRoute, { body: { email: CUSTOMER.email } })).statusCode).toBe(503);
        expect(h.putEvents).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------------------------------------------

describe("resources (§ 10.3)", () => {
    it("list: { resources } sorted by name, ResourceDTO fields only", async () => {
        h.store.listResources.mockResolvedValue([{ id: "b", name: "Zed", hasFeed: false }, { id: "a", name: "Ana", hasFeed: true }]);
        const res = await call(listResourcesRoute, { auth: EDITOR });
        expect(res.json).toEqual({ resources: [{ id: "a", name: "Ana", hasFeed: true }, { id: "b", name: "Zed", hasFeed: false }] });
    });

    it("D10 create: 201 ResourceDTO; one audit event with the admin's email and the resource name as target.title; no ip", async () => {
        h.store.listResources.mockResolvedValue([]);
        h.store.createResource.mockResolvedValue({ id: "res9", name: "Room 2" });
        const res = await call(createResourceRoute, { auth: EDITOR, body: { name: "  Room 2 " } });
        expect([res.statusCode, res.json]).toEqual([201, { id: "res9", name: "Room 2", hasFeed: false }]);
        expect(h.store.createResource.mock.calls[0][2]).toBe("Room 2");
        const events = auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0].detail).toMatchObject({ action: "CREATE_SCHEDULING_RESOURCE", actor: { email: EDITOR.email }, target: { id: "res9", title: "Room 2" } });
        expect(events[0].detail).not.toHaveProperty("ip");
    });

    it("create: empty or 201-character name, an unknown key → 400; the 201st resource → 400; nothing created", async () => {
        h.store.listResources.mockResolvedValue([]);
        for (const body of [{ name: "" }, { name: "   " }, { name: "x".repeat(201) }, { name: "A", extra: 1 }, {}]) {
            expect({ body, status: (await call(createResourceRoute, { body })).statusCode }).toEqual({ body, status: 400 });
        }
        h.store.listResources.mockResolvedValue(Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, hasFeed: false })));
        const full = await call(createResourceRoute, { body: { name: "One more" } });
        expect([full.statusCode, full.json.code]).toEqual([400, "invalid"]);
        expect(h.store.createResource).not.toHaveBeenCalled();
        expect(h.putEvents).toEqual([]);
    });

    it("R02 (documented limit, ruling S1D1-R02) two simultaneous creates at 199 BOTH answer 201: the bound of 200 is not strict", async () => {
        // Both requests read the list before either created: each sees 199. Read-then-create admits both (201 in all);
        // sequential creates are refused above 200 (the test above). No reader breaks above 200.
        h.store.listResources.mockResolvedValue(Array.from({ length: 199 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, hasFeed: false })));
        let n = 0;
        h.store.createResource.mockImplementation(async (_s: unknown, _t: string, name: string) => ({ id: `new${++n}`, name }));
        const [a, b] = await Promise.all([
            call(createResourceRoute, { body: { name: "First" } }),
            call(createResourceRoute, { body: { name: "Second" } }),
        ]);
        expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
        expect(h.store.createResource).toHaveBeenCalledTimes(2);
    });

    it("update: renamed with an audit event; unknown → 404", async () => {
        h.store.renameResource.mockResolvedValue({ ok: true, value: undefined });
        const res = await call(updateResourceRoute, { path: { resourceId: "res1" }, body: { name: "Dr. I." } });
        expect([res.statusCode, res.json]).toEqual([200, { id: "res1", name: "Dr. I.", hasFeed: false }]);
        expect(auditEvents()[0].detail).toMatchObject({ action: "UPDATE_SCHEDULING_RESOURCE", target: { id: "res1", title: "Dr. I." } });
        // R04 (§ 6.5 point 2): details hold counts and dates only — a rename has neither, so no details at all.
        expect(auditEvents()[0].detail).not.toHaveProperty("details");
        h.store.getResource.mockResolvedValue(undefined);
        expect((await call(updateResourceRoute, { path: { resourceId: "gone" }, body: { name: "X" } })).statusCode).toBe(404);
    });

    it("D12 delete with a future booking → 409 resourceInUse { activeBookings }; no audit event", async () => {
        h.store.removeResource.mockResolvedValue({ ok: false, error: { kind: "resourceInUse", activeBookings: 1 } });
        const res = await call(deleteResourceRoute, { path: { resourceId: "res1" } });
        expect([res.statusCode, res.json.code, res.json.activeBookings, Object.hasOwn(res.json, "runs")]).toEqual([409, "resourceInUse", 1, false]);
        expect(h.putEvents).toEqual([]);
    });

    it("D12 delete without bookings → 204 (the store's removal deletes RESOURCE#, AVAILABILITY#, DAYS# in one transaction); one audit event", async () => {
        h.store.removeResource.mockResolvedValue({ ok: true, value: undefined });
        const res = await call(deleteResourceRoute, { path: { resourceId: "res1" } });
        expect([res.statusCode, res.body]).toEqual([204, ""]);
        expect(h.store.removeResource.mock.calls[0].slice(1, 3)).toEqual(["t1", "res1"]);
        expect(auditEvents().map((e) => e.detail.action)).toEqual(["DELETE_SCHEDULING_RESOURCE"]);
        expect(auditEvents()[0].detail.target).toEqual({ id: "res1", title: "Dr. Ionescu" });
    });

    it("delete: removal in progress → 409; unknown → 404; busy → 503", async () => {
        h.store.removeResource.mockResolvedValue({ ok: false, error: { kind: "resourceRemovalInProgress" } });
        expect((await call(deleteResourceRoute, { path: { resourceId: "res1" } })).json.code).toBe("resourceRemovalInProgress");
        h.store.removeResource.mockResolvedValue({ ok: false, error: { kind: "busy" } });
        expect((await call(deleteResourceRoute, { path: { resourceId: "res1" } })).statusCode).toBe(503);
        h.store.getResource.mockResolvedValue(undefined);
        expect((await call(deleteResourceRoute, { path: { resourceId: "res1" } })).statusCode).toBe(404);
    });

    it("D13 feed secret: the URL is answered once; only the secret's SHA-256 is stored; the old one is replaced; no secret in the audit", async () => {
        h.store.setFeedSecretHash.mockResolvedValue({ ok: true, value: undefined });
        const res = await call(feedSecretRoute, { path: { resourceId: "res1" }, body: {} });
        expect(res.statusCode).toBe(200);
        const m = /^https:\/\/clinic\.example\/_booking\/feed\/res1\/([A-Za-z0-9_-]{43})\.ics$/.exec(res.json.feedUrl);
        expect(m).not.toBeNull();
        const secret = m![1];
        expect(h.store.setFeedSecretHash.mock.calls[0][3]).toBe(createHash("sha256").update(secret).digest("hex"));
        const again = await call(feedSecretRoute, { path: { resourceId: "res1" }, body: {} });
        expect(again.json.feedUrl).not.toBe(res.json.feedUrl);
        const events = auditEvents();
        expect(events.map((e) => e.detail.action)).toEqual(["ROTATE_SCHEDULING_FEED_SECRET", "ROTATE_SCHEDULING_FEED_SECRET"]);
        for (const e of events) {
            expect(e.raw).not.toContain(secret);
            expect(e.detail).not.toHaveProperty("ip");
        }
    });

    it("feed secret: a tenant without a real domain gets the preview base (§ 8.2)", async () => {
        h.store.setFeedSecretHash.mockResolvedValue({ ok: true, value: undefined });
        tenantRecord!.domain = "t1.localhost";
        const res = await call(feedSecretRoute, { path: { resourceId: "res1" } });
        expect(res.json.feedUrl).toMatch(/^https:\/\/d111\.cloudfront\.net\/_site\/t1\/_booking\/feed\/res1\/[A-Za-z0-9_-]{43}\.ics$/);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Mail templates
// ---------------------------------------------------------------------------------------------------------------

describe("D13 GET /scheduling/admin/email-templates", () => {
    it("D13 defaults for all six keys; no overrides when none are stored", async () => {
        const res = await call(templatesRoute, { auth: EDITOR });
        expect(res.statusCode).toBe(200);
        expect(res.json.defaults).toEqual(defaultSchedulingTemplates());
        expect(Object.keys(res.json.defaults)).toHaveLength(6);
        expect(res.json.defaults.weekAhead.sendToAdmin).toBe(true);
        expect(res.json.overrides).toEqual({});
    });

    it("G6 a stored override of the retired group key `unplaced` → 200, not 500; it is not listed; the other overrides are", async () => {
        tenantRecord!.schedulingEmailConfig = { templates: { unplaced: { subject: "u", body: "v" }, hold: { subject: "H {{ref}}", body: "{{link}}" } } };
        const res = await call(templatesRoute, { auth: EDITOR });
        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.json.overrides)).toEqual(["hold"]);
    });

    it("D13 an override is returned with both recipient flags resolved", async () => {
        tenantRecord!.schedulingEmailConfig = { templates: { weekAhead: { subject: "Week {{weekStart}}", body: "{{summary}}", sendToAdmin: false } } };
        const res = await call(templatesRoute);
        expect(res.json.overrides).toEqual({ weekAhead: { subject: "Week {{weekStart}}", body: "{{summary}}", sendToCustomer: false, sendToAdmin: false } });
    });

    it("D13 a malformed stored override → 500 storedDataInvalid (never read as 'no override')", async () => {
        tenantRecord!.schedulingEmailConfig = { templates: { weekAhead: { body: "no subject" } } };
        vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call(templatesRoute);
        expect([res.statusCode, res.json.code]).toEqual([500, "storedDataInvalid"]);
        vi.mocked(console.error).mockRestore();
    });
});

describe("D10 no customer data in any audit event of these routes", () => {
    it("D10 across a create, a rename, a delete, a feed rotation, an erasure and an admin cancel: no booking id, ref, customer name, email or phone; no ip", async () => {
        h.store.listResources.mockResolvedValue([]);
        h.store.createResource.mockResolvedValue({ id: "res9", name: "Room 2" });
        h.store.renameResource.mockResolvedValue({ ok: true, value: undefined });
        h.store.removeResource.mockResolvedValue({ ok: true, value: undefined });
        h.store.setFeedSecretHash.mockResolvedValue({ ok: true, value: undefined });
        h.store.eraseCustomer.mockResolvedValue({ ok: true, value: { removedBookings: 1, remainingBookings: 0 } });
        h.store.cancelBooking.mockResolvedValue({ ok: true, value: booking({ state: { kind: "cancelled", at: T0, by: { kind: "admin", email: TENANT_ADMIN.email } } }) });
        await call(createResourceRoute, { body: { name: "Room 2" } });
        await call(updateResourceRoute, { path: { resourceId: "res1" }, body: { name: "Room 3" } });
        await call(deleteResourceRoute, { path: { resourceId: "res1" } });
        await call(feedSecretRoute, { path: { resourceId: "res1" } });
        await call(eraseRoute, { body: { email: CUSTOMER.email } });
        await call(cancelRoute, { path: { bookingId: BOOKING_ID } });
        const events = auditEvents();
        expect(events.map((e) => e.detail.action)).toEqual([
            "CREATE_SCHEDULING_RESOURCE", "UPDATE_SCHEDULING_RESOURCE", "DELETE_SCHEDULING_RESOURCE",
            "ROTATE_SCHEDULING_FEED_SECRET", "SCHEDULING_CUSTOMER_ERASED",
        ]);
        // R04 (§ 6.5 point 2): over the complete set, `details` exists only on the erasure and holds its two counts.
        expect(events.filter((e) => e.detail.details !== undefined).map((e) => [e.detail.action, Object.keys(e.detail.details).sort()]))
            .toEqual([["SCHEDULING_CUSTOMER_ERASED", ["remainingBookings", "removedBookings"]]]);
        for (const e of events) {
            expect(e.detail).not.toHaveProperty("ip");
            for (const secret of [BOOKING_ID, "B-0B9F1C2A", CUSTOMER.name, CUSTOMER.email, CUSTOMER.phone]) {
                expect({ action: e.detail.action, leaks: e.raw.includes(secret) }).toEqual({ action: e.detail.action, leaks: false });
            }
        }
    });
});
