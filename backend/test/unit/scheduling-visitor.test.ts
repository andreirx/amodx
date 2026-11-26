import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BookingSchema, type Booking } from "@amodx/shared";

/**
 * SCHED-1D2 — the visitor routes of `sched-1d` (docs/slices/sched-1.md § 10.2; § 17.3 rows D1-D6, D7 (token part),
 * D9, D10 (visitor part), D11 (route part), D14 (visitor slots), D15; the route parts of C5-C7).
 *
 * REAL: the eight handlers, `requireRole`, the kernel (`availableSlots`, `propose`, `changeDecision`, …),
 * `resolveRecaptchaConfig`, `scheduling-email.ts` rendering, `intentFingerprint`, `client-address.ts`.
 * REPLACED at their boundaries: the store functions of `scheduling-db.ts` (their transactions are rows C1-C35 of
 * `sched-1c`, tested against `FakeTable`), the main-table client (`db.js`: the tenant record), SES (`SendEmail`
 * recorded), EventBridge (`PutEvents` recorded: none may be sent), and `verifyRecaptcha` (the call to Google).
 * Row D8 runs the REAL `scheduling-db.ts` in scheduling-visitor-d8.test.ts; the authorizer part of D2 in
 * scheduling-visitor-auth.test.ts. Credential-free.
 */

const h = vi.hoisted(() => {
    process.env.SCHEDULING_TABLE_NAME = "sched-table";
    process.env.EVENT_BUS_NAME = "test-bus";
    return {
        ddbSend: vi.fn(),
        putEvents: [] as any[],
        sesSends: [] as any[],
        sesFail: { on: false },
        verifyRecaptcha: vi.fn(),
        store: {
            getBookingByToken: vi.fn(), confirmBooking: vi.fn(), cancelBooking: vi.fn(), moveSlot: vi.fn(),
            mintToken: vi.fn(), holdSlot: vi.fn(), replayIntent: vi.fn(), markHoldMail: vi.fn(),
            getService: vi.fn(), listServices: vi.fn(),
            listResources: vi.fn(), getResourcePlans: vi.fn(), readIntervals: vi.fn(),
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
vi.mock("../../src/lib/recaptcha.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/lib/recaptcha.js")>()),
    verifyRecaptcha: h.verifyRecaptcha,
}));
vi.mock("../../src/lib/scheduling-db.js", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../src/lib/scheduling-db.js")>();
    return { ...real, ...h.store, schedulingStoreFromEnv: () => ({ db: { send: vi.fn() }, table: "sched-table", sleep: async () => {} }) };
});

import { handler as offerRoute } from "../../src/scheduling/visitor/offer.js";
import { handler as slotsRoute } from "../../src/scheduling/visitor/slots.js";
import { handler as holdRoute } from "../../src/scheduling/visitor/holds.js";
import { handler as viewRoute } from "../../src/scheduling/visitor/bookings-view.js";
import { handler as confirmRoute } from "../../src/scheduling/visitor/bookings-confirm.js";
import { handler as cancelRoute } from "../../src/scheduling/visitor/bookings-cancel.js";
import { handler as moveRoute } from "../../src/scheduling/visitor/bookings-move.js";
import { intentFingerprint } from "../../src/lib/scheduling-db.js";

const RENDERER = { sub: "renderer", role: "RENDERER", tenantId: "ALL" };
const GLOBAL = { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" };
const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const EDITOR = { sub: "u2", email: "editor@t1.test", role: "EDITOR", tenantId: "t1" };

const MIN = 60_000;
const HOUR = 3_600_000;
const NOW = Date.parse("2026-12-01T10:00:00.000Z");
const START = Date.parse("2026-12-07T07:00:00.000Z");  // Monday 09:00 Europe/Bucharest
const END = START + HOUR;
const BOOKING_ID = "0b9f1c2a-1111-4222-8333-444455556666";
const TOKEN = "T".repeat(43);
const NEW_TOKEN = "N".repeat(43);
const INTENT = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CUSTOMER = { email: "ana.pop@example.test", name: "Ana Pop", phone: "+40 700 000 000" };
const RESOURCE_ID = "res-hidden-7";
const RESOURCE_NAME = "Dr. Hidden Name";
const SERVICE = { id: "svc1", name: "Consultation", durationMin: 60, eligibility: { kind: "only", resourceIds: [RESOURCE_ID] } };

const TENANT_RECORD = {
    PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Clinic One", domain: "clinic.example",
    schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" },
    integrations: { contactEmail: "owner@clinic.example" },
};
let tenantRecord: Record<string, any> | undefined;

function booking(over: Partial<Booking> = {}): Booking {
    return BookingSchema.parse({
        id: BOOKING_ID, ref: "B-0B9F1C2A", rev: 2,
        what: { kind: "slot", serviceId: "svc1", serviceName: "Consultation", resourceId: RESOURCE_ID, start: START, end: END },
        state: { kind: "held", expiresAt: NOW + 30 * MIN, mail: "sent" },
        source: { kind: "visitor" }, who: CUSTOMER, tokenHashes: ["a".repeat(64)], intentId: INTENT, heldUntil: NOW + 30 * MIN,
        createdAt: NOW - MIN, updatedAt: NOW - MIN,
        history: [{ action: "created", at: NOW - MIN, state: "held", placement: { kind: "slot", resourceId: RESOURCE_ID, start: START, end: END } }],
        ...over,
    });
}
const confirmed = (over: Partial<Booking> = {}) => booking({ state: { kind: "confirmed", at: NOW - MIN }, heldUntil: undefined, ...over });

type Res = { statusCode: number; body: string; headers?: Record<string, string> };
async function call(route: any, opts: {
    auth?: any; body?: unknown; rawBody?: string; tenant?: string | null; query?: Record<string, string>;
    path?: Record<string, string>; headers?: Record<string, string>;
} = {}): Promise<Res & { json: any }> {
    const event = {
        headers: { ...(opts.tenant === null ? {} : { "x-tenant-id": opts.tenant ?? "t1" }), ...(opts.headers ?? {}) },
        queryStringParameters: opts.query, pathParameters: opts.path,
        requestContext: { authorizer: { lambda: opts.auth ?? RENDERER }, http: { sourceIp: "10.0.0.9" } },
        body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    };
    const res = (await route(event, {} as any, () => {})) as Res;
    return { ...res, json: res.body ? JSON.parse(res.body) : undefined };
}

const holdBody = (over: Record<string, unknown> = {}) => ({
    intentId: INTENT, recaptchaToken: "captcha-token",
    what: { kind: "slot", serviceId: "svc1", start: "2026-12-07T07:00:00.000Z" }, who: CUSTOMER, ...over,
});
const WRITES = ["confirmBooking", "cancelBooking", "moveSlot", "mintToken", "holdSlot", "markHoldMail"] as const;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.SES_FROM_EMAIL = "noreply@amodx.test";
    process.env.RENDERER_CLOUDFRONT_ORIGIN = "https://d111.cloudfront.net";
    process.env.RECAPTCHA_SECRET_KEY = "deployment-secret";
    h.putEvents.length = 0;
    h.sesSends.length = 0;
    h.sesFail.on = false;
    tenantRecord = structuredClone(TENANT_RECORD);
    h.ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd.input?.Key?.PK === "SYSTEM" && cmd.input?.Key?.SK === "TENANT#t1") return { Item: tenantRecord };
        return {};
    });
    for (const fn of Object.values(h.store)) fn.mockReset();
    h.verifyRecaptcha.mockReset().mockResolvedValue({ success: true, score: 0.9 });
    h.store.replayIntent.mockResolvedValue({ kind: "new" });
    h.store.markHoldMail.mockResolvedValue(true);
    h.store.getService.mockResolvedValue(SERVICE);
    h.store.listResources.mockResolvedValue([{ id: RESOURCE_ID, name: RESOURCE_NAME, hasFeed: false }]);
    h.store.mintToken.mockImplementation(async (_s: any, _t: string, _id: string, _now: number) => ({ ok: true, value: { booking: confirmed({ rev: 9 }), token: NEW_TOKEN } }));
});
afterEach(() => vi.useRealTimers());

const customerMails = () => h.sesSends.filter((m) => m.Destination.ToAddresses[0] === CUSTOMER.email);
const ownerMails = () => h.sesSends.filter((m) => m.Destination.ToAddresses[0] === "owner@clinic.example");

// ---------------------------------------------------------------------------------------------------------------
// D1, D2 — switch and access
// ---------------------------------------------------------------------------------------------------------------

const ALL_ROUTES: [string, any, Parameters<typeof call>[1]][] = [
    ["offer", offerRoute, {}],
    ["slots", slotsRoute, { query: { serviceId: "svc1", from: "2026-12-07", to: "2026-12-08" } }],
    ["hold", holdRoute, { body: holdBody() }],
    ["view", viewRoute, { body: { token: TOKEN } }],
    ["confirm", confirmRoute, { body: { token: TOKEN } }],
    ["cancel", cancelRoute, { body: { token: TOKEN } }],
    ["move", moveRoute, { body: { token: TOKEN, to: { kind: "slot", start: "2026-12-07T08:00:00.000Z" } } }],
];

describe("D1 switch off / tenant record missing → 403 notAvailable on every visitor route", () => {
    it.each(ALL_ROUTES)("D1 %s: schedulingEnabled false → 403 notAvailable; no scheduling read or write", async (_name, route, opts) => {
        tenantRecord!.schedulingEnabled = false;
        const res = await call(route, opts);
        expect([res.statusCode, res.json.code]).toEqual([403, "notAvailable"]);
        for (const fn of Object.values(h.store)) expect(fn).not.toHaveBeenCalled();
    });
    it.each(ALL_ROUTES)("D1 %s: switch absent (never enabled) → 403 notAvailable", async (_name, route, opts) => {
        delete tenantRecord!.schedulingEnabled;
        const res = await call(route, opts);
        expect([res.statusCode, res.json.code]).toEqual([403, "notAvailable"]);
    });
    it.each(ALL_ROUTES)("D1 %s: tenant record missing → 403 notAvailable", async (_name, route, opts) => {
        tenantRecord = undefined;
        const res = await call(route, opts);
        expect([res.statusCode, res.json.code]).toEqual([403, "notAvailable"]);
        for (const fn of Object.values(h.store)) expect(fn).not.toHaveBeenCalled();
    });
});

describe("D2 role oracle of the visitor routes (§ 10.2)", () => {
    it.each(ALL_ROUTES)("D2 %s: TENANT_ADMIN and EDITOR tokens → 403 forbidden, nothing read", async (_name, route, opts) => {
        for (const auth of [TENANT_ADMIN, EDITOR, { sub: "k1", role: "SERVICE", tenantId: "t1", scopes: "catalog:read" }, { sub: "anonymous" }]) {
            const res = await call(route, { ...opts, auth });
            expect([res.statusCode, res.json.code]).toEqual([403, "forbidden"]);
        }
        expect(h.ddbSend).not.toHaveBeenCalled();
        for (const fn of Object.values(h.store)) expect(fn).not.toHaveBeenCalled();
    });

    it("D2 GLOBAL_ADMIN passes requireRole and is handled like the renderer, with the x-tenant-id it sent", async () => {
        h.store.listServices.mockResolvedValue([]);
        const res = await call(offerRoute, { auth: GLOBAL });
        expect(res.statusCode).toBe(200);
        expect(h.store.listServices.mock.calls[0][1]).toBe("t1");
        // Another tenant id in the header → that tenant's record is read (here: none → notAvailable, never t1's data).
        const other = await call(offerRoute, { auth: GLOBAL, tenant: "t2" });
        expect([other.statusCode, other.json.code]).toEqual([403, "notAvailable"]);
        expect(h.ddbSend.mock.calls.at(-1)[0].input.Key).toEqual({ PK: "SYSTEM", SK: "TENANT#t2" });
    });

    it("D2 the renderer passes; the tenant is the x-tenant-id header (no header → 400)", async () => {
        h.store.listServices.mockResolvedValue([]);
        expect((await call(offerRoute)).statusCode).toBe(200);
        const none = await call(offerRoute, { tenant: null });
        expect([none.statusCode, none.json.code]).toEqual([400, "invalid"]);
    });
});

describe("stored settings (§ 10.2 storedDataInvalid)", () => {
    it("an enabled tenant without a stored time zone → 500 storedDataInvalid, logged by key", async () => {
        tenantRecord!.scheduling = {};
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call(offerRoute);
        expect([res.statusCode, res.json.code]).toEqual([500, "storedDataInvalid"]);
        expect(log.mock.calls.flat().join(" ")).toContain("TENANT#t1.scheduling");
        log.mockRestore();
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Read routes: D9, D14, D15; a GET never changes state (§ 8.3)
// ---------------------------------------------------------------------------------------------------------------

describe("read routes", () => {
    beforeEach(() => {
        h.store.listServices.mockResolvedValue([SERVICE]);
        h.store.getResourcePlans.mockResolvedValue({
            ok: true, value: { [RESOURCE_ID]: { rules: [{ weekday: 1, start: "09:00", end: "12:00" }], days: {} } },
        });
        h.store.readIntervals.mockResolvedValue([{ bookingId: "bk-busy", s: START + HOUR, e: START + 2 * HOUR, rev: 1 }]);
    });

    const PRIVATE = [RESOURCE_ID, RESOURCE_NAME, "bk-busy", CUSTOMER.email, CUSTOMER.name, CUSTOMER.phone];

    it("D9 offer and slots carry no resource id or name, booking id, email, phone or customer name", async () => {
        const offer = await call(offerRoute);
        const slots = await call(slotsRoute, { query: { serviceId: "svc1", from: "2026-12-07", to: "2026-12-07" } });
        for (const res of [offer, slots]) {
            expect(res.statusCode).toBe(200);
            for (const secret of PRIVATE) expect({ body: res.body, secret, found: res.body.includes(secret) }).toMatchObject({ found: false });
        }
        expect(offer.json).toEqual({
            timezone: "Europe/Bucharest",
            services: [{ id: "svc1", name: "Consultation", durationMin: 60 }],
        });
    });

    it("slots: the kernel decides — windows of the defaults, busy intervals removed; starts as UTC ISO", async () => {
        const res = await call(slotsRoute, { query: { serviceId: "svc1", from: "2026-12-07", to: "2026-12-07" } });
        expect(res.json).toEqual({
            timezone: "Europe/Bucharest", serviceId: "svc1", durationMin: 60, lastBookableDate: "2027-01-26",
            days: [{ date: "2026-12-07", starts: ["2026-12-07T07:00:00.000Z", "2026-12-07T09:00:00.000Z"] }],
        });
        // One interval read for the eligible resource over the local day; the display read is not consistent.
        expect(h.store.readIntervals).toHaveBeenCalledTimes(1);
        expect(h.store.readIntervals.mock.calls[0].slice(1, 4)).toEqual(["t1", RESOURCE_ID,
            { start: Date.parse("2026-12-06T22:00:00.000Z"), end: Date.parse("2026-12-07T22:00:00.000Z") }]);
        expect(h.store.listResources.mock.calls[0][2]).toBe(false);
    });

    it("D15 slots with `to` after lastBookableDate → 200, lastBookableDate in the DTO, the days after it with no starts", async () => {
        const res = await call(slotsRoute, { query: { serviceId: "svc1", from: "2027-01-25", to: "2027-01-28" } });
        expect(res.statusCode).toBe(200);
        expect(res.json.lastBookableDate).toBe("2027-01-26");
        expect(res.json.days.map((d: any) => [d.date, d.starts.length])).toEqual([
            ["2027-01-25", 3], ["2027-01-26", 0], ["2027-01-27", 0], ["2027-01-28", 0],   // Monday 09-12: three 60-min starts
        ]);
        // Intervals read only up to the last bookable date.
        expect(h.store.readIntervals.mock.calls[0][3].end).toBe(Date.parse("2027-01-26T22:00:00.000Z"));
    });

    it("D15 slots with `from` after lastBookableDate → 200 with every day empty, no interval read", async () => {
        const res = await call(slotsRoute, { query: { serviceId: "svc1", from: "2027-02-01", to: "2027-02-03" } });
        expect(res.statusCode).toBe(200);
        expect(res.json.days.every((d: any) => d.starts.length === 0)).toBe(true);
        expect(h.store.readIntervals).not.toHaveBeenCalled();
        expect(h.store.getResourcePlans).not.toHaveBeenCalled();
    });

    it("D14 slots: bookingHorizonWeeks absent → 8 (lastBookableDate = today + 56 days); stored 1 → today + 7", async () => {
        expect((await call(slotsRoute, { query: { serviceId: "svc1", from: "2026-12-07", to: "2026-12-07" } })).json.lastBookableDate).toBe("2027-01-26");
        tenantRecord!.scheduling.bookingHorizonWeeks = 1;
        expect((await call(slotsRoute, { query: { serviceId: "svc1", from: "2026-12-07", to: "2026-12-07" } })).json.lastBookableDate).toBe("2026-12-08");
    });

    it.each([0, 53, 2.5, "8"])("D14 slots: a stored bookingHorizonWeeks of %s → 500 storedDataInvalid (never a default)", async (value) => {
        tenantRecord!.scheduling.bookingHorizonWeeks = value;
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call(slotsRoute, { query: { serviceId: "svc1", from: "2026-12-07", to: "2026-12-07" } });
        expect([res.statusCode, res.json.code]).toEqual([500, "storedDataInvalid"]);
        expect(h.store.readIntervals).not.toHaveBeenCalled();
        log.mockRestore();
    });

    it("slots: range errors from the kernel → 400 before any read; unknown service → 404; bad query → 400 invalid", async () => {
        const inverted = await call(slotsRoute, { query: { serviceId: "svc1", from: "2026-12-08", to: "2026-12-07" } });
        expect([inverted.statusCode, inverted.json.code]).toEqual([400, "rangeInverted"]);
        const long = await call(slotsRoute, { query: { serviceId: "svc1", from: "2026-12-01", to: "2027-02-01" } });
        expect([long.statusCode, long.json.code, long.json.maxDays]).toEqual([400, "rangeTooLong", 62]);
        expect(h.store.readIntervals).not.toHaveBeenCalled();
        h.store.getService.mockResolvedValueOnce(undefined);
        const missing = await call(slotsRoute, { query: { serviceId: "nope", from: "2026-12-07", to: "2026-12-07" } });
        expect([missing.statusCode, missing.json.code]).toEqual([404, "notFound"]);
        const bad = await call(slotsRoute, { query: { serviceId: "svc1", from: "2026-13-01", to: "2026-12-07" } });
        expect([bad.statusCode, bad.json.code]).toEqual([400, "invalid"]);
    });

    it("slots: BatchGet of the plans still unprocessed → 503 busy", async () => {
        h.store.getResourcePlans.mockResolvedValue({ ok: false, error: { kind: "busy" } });
        const res = await call(slotsRoute, { query: { serviceId: "svc1", from: "2026-12-07", to: "2026-12-07" } });
        expect([res.statusCode, res.json.code]).toEqual([503, "busy"]);
    });

    it("§ 8.3 a GET never changes state: offer and slots call no write function", async () => {
        await call(offerRoute);
        await call(slotsRoute, { query: { serviceId: "svc1", from: "2026-12-07", to: "2026-12-07" } });
        for (const name of WRITES) expect({ name, calls: h.store[name].mock.calls.length }).toEqual({ name, calls: 0 });
        expect(h.sesSends).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Hold: D3, D4, D5, D11 (route part); replay table (route parts of C5-C7)
// ---------------------------------------------------------------------------------------------------------------

describe("POST /scheduling/visitor/holds", () => {
    beforeEach(() => {
        h.store.holdSlot.mockImplementation(async (_s: any, input: any) => ({ ok: true, value: { booking: booking({ rev: 1, intentId: input.intentId }), token: TOKEN } }));
    });

    it("D5 hold → 201 without token or id; one mail whose link has #t=<token>; mail marked sent", async () => {
        const res = await call(holdRoute, { body: holdBody() });
        expect(res.statusCode).toBe(201);
        expect(res.json).toEqual({ ref: "B-0B9F1C2A", state: "held", expiresAt: "2026-12-01T10:30:00.000Z", emailMasked: "a***@example.test" });
        expect(res.body).not.toContain(BOOKING_ID);
        expect(res.body).not.toContain(TOKEN);
        expect(h.sesSends).toHaveLength(1);
        const mail = h.sesSends[0];
        expect(mail.Destination.ToAddresses).toEqual([CUSTOMER.email]);
        expect(mail.ReplyToAddresses).toEqual(["owner@clinic.example"]); // F1 R1
        expect(mail.Message.Body.Text.Data).toContain(`https://clinic.example/_booking/manage#t=${TOKEN}`);
        expect(mail.Message.Body.Text.Data).toContain("2026-12-07 09:00 (Europe/Bucharest)");
        expect(mail.Message.Subject.Data).toBe("Please confirm your booking B-0B9F1C2A");
        expect(h.store.markHoldMail).toHaveBeenCalledWith(expect.anything(), "t1", BOOKING_ID, 1, "sent");
        // The hold input: normalized email, the kernel settings, the fingerprint of the canonical form, no address.
        const input = h.store.holdSlot.mock.calls[0][1];
        expect(input).toMatchObject({
            tenantId: "t1", serviceId: "svc1", start: START, intentId: INTENT, now: NOW,
            settings: { timezone: "Europe/Bucharest", holdMinutes: 30, bookingHorizonWeeks: 8 },
            fingerprint: intentFingerprint({ kind: "slot", serviceId: "svc1", start: "2026-12-07T07:00:00.000Z" }, CUSTOMER),
        });
        expect(input.addressKey).toBeUndefined();
    });

    it("D5 a tenant without a domain: the link base is the CloudFront preview path (§ 8.2)", async () => {
        tenantRecord!.domain = "t1.localhost";
        await call(holdRoute, { body: holdBody() });
        expect(h.sesSends[0].Message.Body.Text.Data).toContain(`https://d111.cloudfront.net/_site/t1/_booking/manage#t=${TOKEN}`);
    });

    it("F1 R2 a customer mail with no tenant contactEmail omits Reply-To", async () => {
        tenantRecord!.integrations = {};
        const res = await call(holdRoute, { body: holdBody() });
        expect(res.statusCode).toBe(201);
        expect(customerMails()).toHaveLength(1);
        expect(customerMails()[0]).not.toHaveProperty("ReplyToAddresses");
    });

    it("D5 the hold mail fails → 503 mailFailed, the hold kept, mail marked failed", async () => {
        h.sesFail.on = true;
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call(holdRoute, { body: holdBody() });
        expect([res.statusCode, res.json.code]).toEqual([503, "mailFailed"]);
        expect(h.store.markHoldMail).toHaveBeenCalledWith(expect.anything(), "t1", BOOKING_ID, 1, "failed");
        expect(log.mock.calls.flat().map(String).join(" ")).not.toContain(CUSTOMER.email);
        log.mockRestore();
    });

    it("D5 the hold mail is sent even when the tenant turned its customer copy off (the only way to confirm)", async () => {
        tenantRecord!.schedulingEmailConfig = { templates: { hold: { subject: "S {{ref}}", body: "B {{link}}", sendToCustomer: false } } };
        const res = await call(holdRoute, { body: holdBody() });
        expect(res.statusCode).toBe(201);
        expect(customerMails()).toHaveLength(1);
        expect(customerMails()[0].Message.Body.Text.Data).toBe(`B https://clinic.example/_booking/manage#t=${TOKEN}`);
    });

    it("D3 no reCAPTCHA token (absent or empty) → 400 verificationRequired; nothing written, no mail", async () => {
        for (const recaptchaToken of [undefined, ""]) {
            const res = await call(holdRoute, { body: holdBody({ recaptchaToken }) });
            expect([res.statusCode, res.json.code]).toEqual([400, "verificationRequired"]);
        }
        expect(h.verifyRecaptcha).not.toHaveBeenCalled();
        expect(h.store.holdSlot).not.toHaveBeenCalled();
        expect(h.sesSends).toEqual([]);
    });

    it("D3 low score / failed verification → 403 verificationFailed; nothing written, no mail", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        for (const verdict of [{ success: true, score: 0.2 }, { success: false, score: 0 }]) {
            h.verifyRecaptcha.mockResolvedValueOnce(verdict);
            const res = await call(holdRoute, { body: holdBody() });
            expect([res.statusCode, res.json.code]).toEqual([403, "verificationFailed"]);
        }
        expect(h.store.holdSlot).not.toHaveBeenCalled();
        expect(h.sesSends).toEqual([]);
        warn.mockRestore();
    });

    it("D3 the commerce resolution: the deployment secret, or the tenant's own pair when it set both keys, with its threshold", async () => {
        await call(holdRoute, { body: holdBody() });
        expect(h.verifyRecaptcha.mock.calls[0].slice(0, 2)).toEqual(["captcha-token", "deployment-secret"]);
        tenantRecord!.recaptcha = { siteKey: "tenant-site", secretKey: "tenant-secret", threshold: 0.8 };
        h.verifyRecaptcha.mockResolvedValueOnce({ success: true, score: 0.7 });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const res = await call(holdRoute, { body: holdBody() });
        expect(h.verifyRecaptcha.mock.calls[1][1]).toBe("tenant-secret");
        expect([res.statusCode, res.json.code]).toEqual([403, "verificationFailed"]);
        warn.mockRestore();
    });

    it("D4 the 6th hold of one email in an hour (the store's counter refuses) → 429 tooManyForEmail with Retry-After", async () => {
        h.store.holdSlot.mockResolvedValue({ ok: false, error: { kind: "tooManyForEmail" } });
        const res = await call(holdRoute, { body: holdBody() });
        expect([res.statusCode, res.json.code]).toEqual([429, "tooManyForEmail"]);
        expect(res.headers?.["Retry-After"]).toBe("3600");  // NOW is on the hour
        expect(h.sesSends).toEqual([]);
        h.store.holdSlot.mockResolvedValue({ ok: false, error: { kind: "tooManyFromAddress" } });
        const addr = await call(holdRoute, { body: holdBody() });
        expect([addr.statusCode, addr.json.code]).toEqual([429, "tooManyFromAddress"]);
    });

    it("D11 x-viewer-address from a RENDERER call → address key in the hold and remoteip to Google", async () => {
        await call(holdRoute, { body: holdBody(), headers: { "x-viewer-address": "198.51.100.4" } });
        expect(h.store.holdSlot.mock.calls[0][1].addressKey).toBe("198.51.100.4");
        expect(h.verifyRecaptcha.mock.calls[0][2]).toBe("198.51.100.4");
        await call(holdRoute, { body: holdBody(), headers: { "x-viewer-address": "2001:DB8:1:2:aaaa::5" } });
        expect(h.store.holdSlot.mock.calls[1][1].addressKey).toBe("2001:db8:1:2::/64");
        expect(h.verifyRecaptcha.mock.calls[1][2]).toBe("2001:db8:1:2:aaaa::5");
        await call(holdRoute, { body: holdBody(), headers: { "x-viewer-address": "::ffff:198.51.100.4" } });
        expect(h.store.holdSlot.mock.calls[2][1].addressKey).toBe("198.51.100.4");
    });

    it("D11 the header from another role (GLOBAL_ADMIN) is ignored; absent or invalid → no address limit, no remoteip", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        await call(holdRoute, { body: holdBody(), auth: GLOBAL, headers: { "x-viewer-address": "198.51.100.4" } });
        await call(holdRoute, { body: holdBody() });
        await call(holdRoute, { body: holdBody(), headers: { "x-viewer-address": "999.1.1.1" } });
        await call(holdRoute, { body: holdBody(), headers: { "x-viewer-address": "fe80::1%eth0" } });
        for (const c of h.store.holdSlot.mock.calls) expect(c[1].addressKey).toBeUndefined();
        for (const c of h.verifyRecaptcha.mock.calls) expect(c[2]).toBeUndefined();
        const logged = log.mock.calls.flat().map(String);
        expect(logged.filter((l) => l === "[scheduling] no viewer address")).toHaveLength(4);
        expect(logged.join(" ")).not.toContain("999.1.1.1");
        log.mockRestore();
    });

    it("hold refusals map to the § 10.2 codes", async () => {
        const cases: [any, number, string][] = [
            [{ kind: "notOnGrid" }, 409, "notOnGrid"], [{ kind: "outsideAvailability" }, 409, "outsideAvailability"],
            [{ kind: "inPast" }, 409, "inPast"], [{ kind: "beyondHorizon", lastBookableDate: "2027-01-26" }, 409, "beyondHorizon"],
            [{ kind: "notEligible" }, 409, "notEligible"], [{ kind: "resourceUnavailable" }, 409, "resourceUnavailable"],
            [{ kind: "slotTaken" }, 409, "slotTaken"], [{ kind: "busy" }, 503, "busy"], [{ kind: "notFound" }, 404, "notFound"],
        ];
        for (const [error, status, code] of cases) {
            h.store.holdSlot.mockResolvedValueOnce({ ok: false, error });
            const res = await call(holdRoute, { body: holdBody() });
            expect({ error, status: res.statusCode, code: res.json.code }).toEqual({ error, status, code });
        }
        h.store.holdSlot.mockResolvedValueOnce({ ok: false, error: { kind: "beyondHorizon", lastBookableDate: "2027-01-26" } });
        expect((await call(holdRoute, { body: holdBody() })).json.lastBookableDate).toBe("2027-01-26");
        expect(h.sesSends).toEqual([]);
    });

    it("a hold of the removed group shape (`what.kind: \"seat\"`) → 400 invalid at the body schema: no intent read, no reCAPTCHA, nothing held, no mail", async () => {
        const res = await call(holdRoute, { body: holdBody({ what: { kind: "seat", courseId: "c1", runId: "r1" } }) });
        expect([res.statusCode, res.json.code]).toEqual([400, "invalid"]);
        expect(h.store.replayIntent).not.toHaveBeenCalled();
        expect(h.verifyRecaptcha).not.toHaveBeenCalled();
        for (const name of WRITES) expect({ name, calls: h.store[name].mock.calls.length }).toEqual({ name, calls: 0 });
        expect(h.sesSends).toEqual([]);
    });

    it("body schema: unknown key, bad intent id, email invalid after normalization → 400 invalid, nothing read", async () => {
        for (const body of [holdBody({ extra: 1 }), holdBody({ intentId: "not-a-uuid" }), holdBody({ who: { ...CUSTOMER, email: "no-at-sign" } }),
            holdBody({ what: { kind: "slot", serviceId: "svc1", start: "2026-12-07T09:00:00+02:00" } })]) {
            const res = await call(holdRoute, { body });
            expect([res.statusCode, res.json.code]).toEqual([400, "invalid"]);
        }
        expect(h.store.replayIntent).not.toHaveBeenCalled();
        // The email is stored in its normalizeEmail() form (PD-001).
        await call(holdRoute, { body: holdBody({ who: { ...CUSTOMER, email: "  Ana.Pop@Example.TEST " } }) });
        expect(h.store.holdSlot.mock.calls[0][1].who.email).toBe("ana.pop@example.test");
    });

    describe("C5-C7 route parts: the § 7.2 replay table", () => {
        const held = (mail: "pending" | "sent" | "failed") => booking({ rev: 4, state: { kind: "held", expiresAt: NOW + 20 * MIN, mail } });

        it("C7 a replay is not verified by reCAPTCHA (a spent token passes): confirmed → 200 state confirmed, no side effect", async () => {
            h.store.replayIntent.mockResolvedValue({ kind: "confirmed", booking: confirmed() });
            h.verifyRecaptcha.mockResolvedValue({ success: false, score: 0 });
            const res = await call(holdRoute, { body: holdBody() });
            expect([res.statusCode, res.json]).toEqual([200, { ref: "B-0B9F1C2A", state: "confirmed", emailMasked: "a***@example.test" }]);
            expect(h.verifyRecaptcha).not.toHaveBeenCalled();
            expect(h.store.mintToken).not.toHaveBeenCalled();
            expect(h.sesSends).toEqual([]);
        });

        it("C5 held, mail pending (crash between commit and send) → 201, new token counted for the email, mail sent, marked sent", async () => {
            h.store.replayIntent.mockResolvedValue({ kind: "held", booking: held("pending"), send: "recover" });
            h.store.mintToken.mockResolvedValue({ ok: true, value: { booking: held("pending"), token: NEW_TOKEN } });
            const res = await call(holdRoute, { body: holdBody() });
            expect(res.statusCode).toBe(201);
            expect(h.store.mintToken.mock.calls[0][4]).toEqual({ countForEmail: true });
            expect(h.sesSends).toHaveLength(1);
            expect(h.sesSends[0].Message.Body.Text.Data).toContain(`#t=${NEW_TOKEN}`);
            expect(h.store.markHoldMail).toHaveBeenCalledWith(expect.anything(), "t1", BOOKING_ID, 4, "sent");
            expect(h.store.holdSlot).not.toHaveBeenCalled();
        });

        it("C6 held, mail failed, replay → 201 and the mail is sent; send fails again → 503 mailFailed", async () => {
            h.store.replayIntent.mockResolvedValue({ kind: "held", booking: held("failed"), send: "recover" });
            h.store.mintToken.mockResolvedValue({ ok: true, value: { booking: held("failed"), token: NEW_TOKEN } });
            expect((await call(holdRoute, { body: holdBody() })).statusCode).toBe(201);
            h.sesFail.on = true;
            const log = vi.spyOn(console, "error").mockImplementation(() => {});
            const res = await call(holdRoute, { body: holdBody() });
            expect([res.statusCode, res.json.code]).toEqual([503, "mailFailed"]);
            log.mockRestore();
        });

        it("held, mail sent: no resend → 200 and nothing sent; resend → 200 with a new mail; resend over the limit → 429", async () => {
            h.store.replayIntent.mockResolvedValue({ kind: "held", booking: held("sent"), send: "none" });
            const quiet = await call(holdRoute, { body: holdBody() });
            expect([quiet.statusCode, quiet.json.state]).toEqual([200, "held"]);
            expect(h.sesSends).toEqual([]);
            h.store.replayIntent.mockResolvedValue({ kind: "held", booking: held("sent"), send: "resend" });
            h.store.mintToken.mockResolvedValue({ ok: true, value: { booking: held("sent"), token: NEW_TOKEN } });
            const resend = await call(holdRoute, { body: holdBody({ resend: true }) });
            expect(resend.statusCode).toBe(200);
            expect(h.sesSends).toHaveLength(1);
            expect(h.store.replayIntent.mock.calls.at(-1)[4]).toBe(true);
            h.store.mintToken.mockResolvedValue({ ok: false, error: { kind: "tooManyForEmail" } });
            const limited = await call(holdRoute, { body: holdBody({ resend: true }) });
            expect([limited.statusCode, limited.json.code]).toEqual([429, "tooManyForEmail"]);
            expect(h.sesSends).toHaveLength(1);
        });

        it("C4/C7 different fingerprint → 409 intentReused; expired or cancelled → 409 intentClosed; no side effect", async () => {
            h.store.replayIntent.mockResolvedValueOnce({ kind: "intentReused" });
            expect((await call(holdRoute, { body: holdBody() })).json.code).toBe("intentReused");
            h.store.replayIntent.mockResolvedValueOnce({ kind: "intentClosed" });
            const closed = await call(holdRoute, { body: holdBody() });
            expect([closed.statusCode, closed.json.code]).toEqual([409, "intentClosed"]);
            expect(h.store.mintToken).not.toHaveBeenCalled();
            expect(h.sesSends).toEqual([]);
        });

        it("double submit: the hold loses on INTENT# → re-reads the intent and answers by the table (200, no second mail)", async () => {
            h.store.holdSlot.mockResolvedValue({ ok: false, error: { kind: "intentExists" } });
            h.store.replayIntent.mockResolvedValueOnce({ kind: "new" }).mockResolvedValueOnce({ kind: "held", booking: held("sent"), send: "none" });
            const res = await call(holdRoute, { body: holdBody() });
            expect([res.statusCode, res.json.state]).toEqual([200, "held"]);
            expect(h.sesSends).toEqual([]);
        });
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Token routes: D6, D7 (token part), view, cancel, move
// ---------------------------------------------------------------------------------------------------------------

describe("token routes", () => {
    it("D6 confirm with a valid token → 200 confirmed; mail `confirmed` with a NEW token link; owner copy without a link", async () => {
        h.store.getBookingByToken.mockResolvedValue(booking());
        h.store.confirmBooking.mockResolvedValue({ ok: true, value: { kind: "applied", booking: booking({ rev: 3, state: { kind: "confirmed", at: NOW }, heldUntil: undefined }) } });
        const res = await call(confirmRoute, { body: { token: TOKEN } });
        expect(res.statusCode).toBe(200);
        expect(res.json).toMatchObject({ ref: "B-0B9F1C2A", state: "confirmed", can: { confirm: false, cancel: true, move: true } });
        expect(res.body).not.toContain(BOOKING_ID);
        expect(h.store.getBookingByToken).toHaveBeenCalledWith(expect.anything(), "t1", TOKEN, true);
        expect(h.store.mintToken.mock.calls[0][4]).toEqual({ countForEmail: false });
        expect(customerMails()).toHaveLength(1);
        expect(customerMails()[0].Message.Body.Text.Data).toContain(`https://clinic.example/_booking/manage#t=${NEW_TOKEN}`);
        expect(ownerMails()).toHaveLength(1);
        expect(customerMails()[0].ReplyToAddresses).toEqual(["owner@clinic.example"]); // F1 R1
        expect(ownerMails()[0].ReplyToAddresses).toEqual([CUSTOMER.email]); // F1 R3
        expect(ownerMails()[0].Message.Body.Text.Data).not.toContain("#t=");
    });

    it("D6 confirm with an expired hold → 410 expired; unknown token → 404 linkNotValid; another tenant's token → 404", async () => {
        h.store.getBookingByToken.mockResolvedValue(booking());
        h.store.confirmBooking.mockResolvedValue({ ok: false, error: { kind: "expired", at: NOW - MIN } });
        const expired = await call(confirmRoute, { body: { token: TOKEN } });
        expect([expired.statusCode, expired.json.code]).toEqual([410, "expired"]);
        h.store.getBookingByToken.mockResolvedValue(undefined);
        const unknown = await call(confirmRoute, { body: { token: TOKEN } });
        expect([unknown.statusCode, unknown.json.code]).toEqual([404, "linkNotValid"]);
        // Tenant B's page (x-tenant-id t2, enabled): the lookup runs under t2 only, finds nothing → the same 404.
        h.ddbSend.mockImplementation(async (cmd: any) => ({ Item: cmd.input.Key.SK === "TENANT#t2" ? { ...TENANT_RECORD, id: "t2" } : undefined }));
        const other = await call(confirmRoute, { body: { token: TOKEN }, tenant: "t2" });
        expect([other.statusCode, other.json.code]).toEqual([404, "linkNotValid"]);
        expect(h.store.getBookingByToken.mock.calls.at(-1)[1]).toBe("t2");
        expect(h.store.confirmBooking).toHaveBeenCalledTimes(1);
        expect(h.sesSends).toEqual([]);
    });

    it("D6 S1D2-R02 confirm the store reports alreadyConfirmed — even with state.at = this request's clock → 200, no mint, no mail", async () => {
        // The review probe: an already-confirmed booking whose `state.at` equals NOW. Ownership comes from the store's
        // outcome, never from the timestamp.
        h.store.getBookingByToken.mockResolvedValue(booking());
        h.store.confirmBooking.mockResolvedValue({ ok: true, value: { kind: "alreadyConfirmed", booking: confirmed({ state: { kind: "confirmed", at: NOW } }) } });
        const res = await call(confirmRoute, { body: { token: TOKEN } });
        expect([res.statusCode, res.json.state]).toEqual([200, "confirmed"]);
        expect(h.store.mintToken).not.toHaveBeenCalled();
        expect(h.sesSends).toEqual([]);
    });

    it("D6 S1D2-R02 two confirms of one link at once: the applied one mails once, the alreadyConfirmed one sends nothing", async () => {
        h.store.getBookingByToken.mockResolvedValue(booking());
        const done = booking({ rev: 3, state: { kind: "confirmed", at: NOW }, heldUntil: undefined });
        h.store.confirmBooking
            .mockResolvedValueOnce({ ok: true, value: { kind: "applied", booking: done } })
            .mockResolvedValueOnce({ ok: true, value: { kind: "alreadyConfirmed", booking: done } });
        const [a, b] = await Promise.all([call(confirmRoute, { body: { token: TOKEN } }), call(confirmRoute, { body: { token: TOKEN } })]);
        expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
        expect(h.store.mintToken).toHaveBeenCalledTimes(1);
        expect(customerMails()).toHaveLength(1);
    });

    it("D6 confirm of an already confirmed booking → 200, no second mail; cancelled meanwhile → 409 cancelled", async () => {
        h.store.getBookingByToken.mockResolvedValue(confirmed());
        h.store.confirmBooking.mockResolvedValue({ ok: true, value: { kind: "alreadyConfirmed", booking: confirmed() } });
        expect((await call(confirmRoute, { body: { token: TOKEN } })).statusCode).toBe(200);
        expect(h.sesSends).toEqual([]);
        h.store.confirmBooking.mockResolvedValue({ ok: false, error: { kind: "cancelled" } });
        const res = await call(confirmRoute, { body: { token: TOKEN } });
        expect([res.statusCode, res.json.code]).toEqual([409, "cancelled"]);
    });

    it("view: held → DTO with Confirm; S1D2-R05 past expiresAt → 410 expired (§ 8.4); changes nothing (§ 8.3)", async () => {
        h.store.getBookingByToken.mockResolvedValue(booking());
        const res = await call(viewRoute, { body: { token: TOKEN } });
        expect(res.json).toEqual({
            ref: "B-0B9F1C2A", state: "held", expiresAt: "2026-12-01T10:30:00.000Z",
            what: { kind: "slot", serviceId: "svc1", serviceName: "Consultation", start: "2026-12-07T07:00:00.000Z", end: "2026-12-07T08:00:00.000Z", timezone: "Europe/Bucharest" },
            who: { name: "Ana Pop", emailMasked: "a***@example.test" },
            can: { confirm: true, cancel: true, move: false },
            changeCutoff: "2026-12-06T07:00:00.000Z",
        });
        expect(res.body).not.toContain(RESOURCE_ID);
        vi.setSystemTime(NOW + 31 * MIN);
        const late = await call(viewRoute, { body: { token: TOKEN } });
        expect([late.statusCode, late.json.code, late.json.expiresAt]).toEqual([410, "expired", "2026-12-01T10:30:00.000Z"]);
        expect(late.body).not.toContain("Ana Pop");
        for (const name of WRITES) expect({ name, calls: h.store[name].mock.calls.length }).toEqual({ name, calls: 0 });
        expect(h.sesSends).toEqual([]);
    });

    it("SCHED-1G2 slot view: `serviceId` is the booking's own stored service id (renamed service, another service of the same name), on view and on move", async () => {
        // The booking keeps its name snapshot "Consultation"; the stored id is "svc-own". Another service is now named
        // "Consultation" too: the view must name the booking's service by id, never by its name.
        const own = { kind: "slot" as const, serviceId: "svc-own", serviceName: "Consultation", resourceId: RESOURCE_ID, start: START, end: END };
        h.store.getBookingByToken.mockResolvedValue(confirmed({ what: own }));
        const view = await call(viewRoute, { body: { token: TOKEN } });
        expect(view.statusCode).toBe(200);
        expect(view.json.what).toEqual({ kind: "slot", serviceId: "svc-own", serviceName: "Consultation", start: "2026-12-07T07:00:00.000Z", end: "2026-12-07T08:00:00.000Z", timezone: "Europe/Bucharest" });
        expect(view.body).not.toContain(RESOURCE_ID);
        const target = START + 2 * HOUR;
        const moved = { ...own, start: target, end: target + HOUR };
        h.store.moveSlot.mockResolvedValue({ ok: true, value: confirmed({ rev: 3, what: moved }) });
        h.store.mintToken.mockResolvedValue({ ok: true, value: { booking: confirmed({ rev: 4, what: moved }), token: NEW_TOKEN } });
        const move = await call(moveRoute, { body: { token: TOKEN, to: { kind: "slot", start: "2026-12-07T09:00:00.000Z" } } });
        expect(move.statusCode).toBe(200);
        expect(move.json.what).toMatchObject({ kind: "slot", serviceId: "svc-own", start: "2026-12-07T09:00:00.000Z" });
    });

    it("D7 (token part) a link whose booking is cancelled, or past its 30-day view window, → 404 linkNotValid", async () => {
        h.store.getBookingByToken.mockResolvedValue(booking({ state: { kind: "cancelled", at: NOW - MIN, by: { kind: "admin", email: "a@t1.test" } }, tokenHashes: ["a".repeat(64)] }));
        expect((await call(viewRoute, { body: { token: TOKEN } })).json.code).toBe("linkNotValid");
        h.store.getBookingByToken.mockResolvedValue(confirmed({ what: { kind: "slot", serviceId: "svc1", serviceName: "C", resourceId: RESOURCE_ID, start: NOW - 31 * 24 * HOUR - HOUR, end: NOW - 31 * 24 * HOUR } }));
        const gone = await call(viewRoute, { body: { token: TOKEN } });
        expect([gone.statusCode, gone.json.code]).toEqual([404, "linkNotValid"]);
    });

    it("cancel by the customer → {ref, state: cancelled}; mail `cancelled` without a link + owner copy; actor customer, cutoff passed", async () => {
        h.store.getBookingByToken.mockResolvedValue(confirmed());
        h.store.cancelBooking.mockResolvedValue({ ok: true, value: confirmed({ rev: 3, state: { kind: "cancelled", at: NOW, by: { kind: "customer" } }, tokenHashes: [] }) });
        const res = await call(cancelRoute, { body: { token: TOKEN } });
        expect([res.statusCode, res.json]).toEqual([200, { ref: "B-0B9F1C2A", state: "cancelled" }]);
        expect(h.store.cancelBooking.mock.calls[0][1]).toEqual({ tenantId: "t1", bookingId: BOOKING_ID, actor: { kind: "customer" }, cutoffHours: 24, now: NOW });
        expect(customerMails()).toHaveLength(1);
        expect(customerMails()[0].Message.Body.Text.Data).not.toContain("#t=");
        expect(customerMails()[0].Message.Subject.Data).toBe("Booking B-0B9F1C2A cancelled");
        expect(ownerMails()).toHaveLength(1);
        expect(h.store.mintToken).not.toHaveBeenCalled();
    });

    it("cancel refusals: tooLate (with cutoff), expired → 410; the cancel mail failure keeps the 200", async () => {
        h.store.getBookingByToken.mockResolvedValue(confirmed());
        const cases: [any, number, string][] = [
            [{ kind: "tooLate", cutoff: START - 24 * HOUR }, 409, "tooLate"],
            [{ kind: "notActive", state: "expired" }, 410, "expired"], [{ kind: "notActive", state: "cancelled" }, 409, "cancelled"],
            [{ kind: "notFound" }, 404, "linkNotValid"], [{ kind: "busy" }, 503, "busy"],
        ];
        for (const [error, status, code] of cases) {
            h.store.cancelBooking.mockResolvedValueOnce({ ok: false, error });
            const res = await call(cancelRoute, { body: { token: TOKEN } });
            expect({ error, status: res.statusCode, code: res.json.code }).toEqual({ error, status, code });
        }
        h.store.cancelBooking.mockResolvedValueOnce({ ok: false, error: { kind: "tooLate", cutoff: START - 24 * HOUR } });
        expect((await call(cancelRoute, { body: { token: TOKEN } })).json.cutoff).toBe("2026-12-06T07:00:00.000Z");
        h.store.cancelBooking.mockResolvedValue({ ok: true, value: confirmed({ rev: 3, state: { kind: "cancelled", at: NOW, by: { kind: "customer" } }, tokenHashes: [] }) });
        h.sesFail.on = true;
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await call(cancelRoute, { body: { token: TOKEN } })).statusCode).toBe(200);
        log.mockRestore();
    });

    it("move slot → slot: the service's eligible resources, the customer's settings; mail `moved` with a new token", async () => {
        h.store.getBookingByToken.mockResolvedValue(confirmed());
        const target = START + 2 * HOUR;
        const movedWhat = { kind: "slot" as const, serviceId: "svc1", serviceName: "Consultation", resourceId: RESOURCE_ID, start: target, end: target + HOUR };
        h.store.moveSlot.mockResolvedValue({ ok: true, value: confirmed({ rev: 3, what: movedWhat }) });
        h.store.mintToken.mockResolvedValue({ ok: true, value: { booking: confirmed({ rev: 4, what: movedWhat }), token: NEW_TOKEN } });
        const res = await call(moveRoute, { body: { token: TOKEN, to: { kind: "slot", start: "2026-12-07T09:00:00.000Z" } } });
        expect(res.statusCode).toBe(200);
        expect(res.json.what).toMatchObject({ kind: "slot", start: "2026-12-07T09:00:00.000Z" });
        expect(h.store.moveSlot.mock.calls[0][1]).toEqual({
            tenantId: "t1", bookingId: BOOKING_ID, start: target, resourceIds: [RESOURCE_ID], actor: { kind: "customer" }, now: NOW,
            settings: { timezone: "Europe/Bucharest", holdMinutes: 30, bookingHorizonWeeks: 8, changeCutoffHours: 24 },
        });
        expect(customerMails()).toHaveLength(1);
        expect(customerMails()[0].Message.Subject.Data).toBe("Booking B-0B9F1C2A moved");
        expect(customerMails()[0].Message.Body.Text.Data).toContain(`#t=${NEW_TOKEN}`);
        expect(customerMails()[0].Message.Body.Text.Data).toContain("2026-12-07 11:00 (Europe/Bucharest)");
    });

    it("move refusals: held → notConfirmed; tooLate; slotTaken; a target of the removed group shape (`seat`) → 400 invalid", async () => {
        h.store.getBookingByToken.mockResolvedValue(booking());
        for (const [error, code] of [[{ kind: "notConfirmed" }, "notConfirmed"], [{ kind: "tooLate", cutoff: START }, "tooLate"], [{ kind: "slotTaken" }, "slotTaken"]] as const) {
            h.store.moveSlot.mockResolvedValueOnce({ ok: false, error });
            const res = await call(moveRoute, { body: { token: TOKEN, to: { kind: "slot", start: "2026-12-07T09:00:00.000Z" } } });
            expect([res.statusCode, res.json.code]).toEqual([409, code]);
        }
        h.store.moveSlot.mockClear();
        const seatTarget = await call(moveRoute, { body: { token: TOKEN, to: { kind: "seat", runId: "r1" } } });
        expect([seatTarget.statusCode, seatTarget.json.code]).toEqual([400, "invalid"]);
        expect(h.store.moveSlot).not.toHaveBeenCalled();
        expect(h.sesSends).toEqual([]);
    });

});

// ---------------------------------------------------------------------------------------------------------------
// D10 (visitor part): SCHED-AUDIT-PII = C — no booking event in the main table; no customer data in logs
// ---------------------------------------------------------------------------------------------------------------

describe("D10 visitor booking operations publish no audit event", () => {
    it("D10 hold, confirm, cancel and move send no PutEvents at all; history is the store's (actor = customer)", async () => {
        h.store.holdSlot.mockResolvedValue({ ok: true, value: { booking: booking({ rev: 1 }), token: TOKEN } });
        h.store.getBookingByToken.mockResolvedValue(confirmed());
        h.store.confirmBooking.mockResolvedValue({ ok: true, value: { kind: "applied", booking: confirmed() } });
        h.store.cancelBooking.mockResolvedValue({ ok: true, value: confirmed({ state: { kind: "cancelled", at: NOW, by: { kind: "customer" } }, tokenHashes: [] }) });
        h.store.moveSlot.mockResolvedValue({ ok: true, value: confirmed() });
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect((await call(holdRoute, { body: holdBody(), headers: { "x-viewer-address": "198.51.100.4" } })).statusCode).toBe(201);
        expect((await call(confirmRoute, { body: { token: TOKEN } })).statusCode).toBe(200);
        expect((await call(cancelRoute, { body: { token: TOKEN } })).statusCode).toBe(200);
        expect((await call(moveRoute, { body: { token: TOKEN, to: { kind: "slot", start: "2026-12-07T09:00:00.000Z" } } })).statusCode).toBe(200);
        expect(h.putEvents).toEqual([]);
        expect(h.store.cancelBooking.mock.calls[0][1].actor).toEqual({ kind: "customer" });
        expect(h.store.moveSlot.mock.calls[0][1].actor).toEqual({ kind: "customer" });
        // No customer data, token or address in any log line (ids only).
        const logged = [...log.mock.calls, ...err.mock.calls, ...warn.mock.calls].flat().map((v) => JSON.stringify(v)).join(" ");
        for (const secret of [CUSTOMER.email, CUSTOMER.name, CUSTOMER.phone, TOKEN, NEW_TOKEN, "198.51.100.4"]) expect(logged).not.toContain(secret);
        log.mockRestore(); err.mockRestore(); warn.mockRestore();
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Review-0 corrections (S1D2-R01, R03, R04, R05) and the operator rulings after review-0
// ---------------------------------------------------------------------------------------------------------------

describe("S1D2-R01 reCAPTCHA fails closed", () => {
    it("D3 S1D2-R01 no tenant key pair and no deployment secret → 503 verificationUnavailable; nothing verified, nothing written, no mail", async () => {
        delete process.env.RECAPTCHA_SECRET_KEY;
        h.store.holdSlot.mockResolvedValue({ ok: true, value: { booking: booking({ rev: 1 }), token: TOKEN } });
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        for (const recaptcha of [undefined, { siteKey: "only-site-key" }, { secretKey: "only-secret" }]) {
            if (recaptcha === undefined) delete tenantRecord!.recaptcha; else tenantRecord!.recaptcha = recaptcha;
            const res = await call(holdRoute, { body: holdBody() });
            expect({ recaptcha, status: res.statusCode, code: res.json.code }).toEqual({ recaptcha, status: 503, code: "verificationUnavailable" });
        }
        expect(h.verifyRecaptcha).not.toHaveBeenCalled();
        expect(h.store.holdSlot).not.toHaveBeenCalled();
        expect(h.sesSends).toEqual([]);
        expect(log.mock.calls.flat().map(String).join(" ")).not.toContain("only-secret");
        // A tenant with its own full pair still verifies without the deployment secret.
        tenantRecord!.recaptcha = { siteKey: "tenant-site", secretKey: "tenant-secret" };
        expect((await call(holdRoute, { body: holdBody() })).statusCode).toBe(201);
        expect(h.verifyRecaptcha.mock.calls[0][1]).toBe("tenant-secret");
        log.mockRestore();
    });
});

describe("S1D2-R04 reads that decide whether a write runs are consistent", () => {
    it("S1D2-R04 the token lookup is read consistently on every token route", async () => {
        const b = confirmed();
        h.store.getBookingByToken.mockResolvedValue(b);
        h.store.confirmBooking.mockResolvedValue({ ok: true, value: { kind: "alreadyConfirmed", booking: b } });
        h.store.cancelBooking.mockResolvedValue({ ok: false, error: { kind: "tooLate", cutoff: NOW } });
        h.store.moveSlot.mockResolvedValue({ ok: false, error: { kind: "slotTaken" } });
        for (const [route, body] of [[viewRoute, { token: TOKEN }], [confirmRoute, { token: TOKEN }], [cancelRoute, { token: TOKEN }],
            [moveRoute, { token: TOKEN, to: { kind: "slot", start: "2026-12-07T09:00:00.000Z" } }]] as const) {
            h.store.getBookingByToken.mockClear();
            await call(route, { body });
            expect(h.store.getBookingByToken.mock.calls[0][3]).toBe(true);
        }
    });
});

describe("S1D2-R05 malformed tokens and the switch-first rule", () => {
    const TOKEN_ROUTES: [string, any, Record<string, unknown>][] = [
        ["view", viewRoute, {}], ["confirm", confirmRoute, {}], ["cancel", cancelRoute, {}],
        ["move", moveRoute, { to: { kind: "slot", start: "2026-12-07T08:00:00.000Z" } }],
    ];
    const MALFORMED: [string, unknown][] = [
        ["201 characters", "T".repeat(201)], ["42 characters", "T".repeat(42)], ["10 000 characters", "x".repeat(10_000)],
        ["a number", 12345], ["null", null], ["an object", { t: TOKEN }], ["absent", undefined],
    ];
    it.each(TOKEN_ROUTES)("D6 S1D2-R05 %s: a malformed token of any length or shape → 404 linkNotValid, nothing written", async (_n, route, rest) => {
        for (const [what, token] of MALFORMED) {
            const res = await call(route, { body: { ...(token === undefined ? {} : { token }), ...rest } });
            expect({ what, status: res.statusCode, code: res.json.code }).toEqual({ what, status: 404, code: "linkNotValid" });
        }
        // The token is checked before any other field: a malformed token with a malformed target is still 404.
        const both = await call(route, { body: { token: 7, to: "nowhere" } });
        expect([both.statusCode, both.json.code]).toEqual([404, "linkNotValid"]);
        for (const array of [[TOKEN], "just a string"]) {
            const res = await call(route, { body: array });
            expect([res.statusCode, res.json.code]).toEqual([404, "linkNotValid"]);
        }
        // Not JSON at all stays 400 invalid (no token can be read).
        expect((await call(route, { rawBody: "{not json" })).json.code).toBe("invalid");
        for (const name of WRITES) expect({ name, calls: h.store[name].mock.calls.length }).toEqual({ name, calls: 0 });
    });

    // Review-1 (S1D2-R05 residual): malformed token STRINGS must win over invalid remaining fields too.
    const MALFORMED_STRINGS: [string, string][] = [
        ["empty", ""], ["\"bad\"", "bad"], ["42 characters", "A".repeat(42)], ["44 characters", "A".repeat(44)],
        ["201 characters", "A".repeat(201)], ["43 with +", "A".repeat(42) + "+"], ["43 with /", "A".repeat(42) + "/"],
        ["43 with =", "A".repeat(42) + "="], ["43 with a space", "A".repeat(42) + " "], ["43 with a non-ASCII letter", "A".repeat(42) + "é"],
        ["43 + newline", TOKEN + "\n"],
    ];
    const INVALID_REST: Record<string, Record<string, unknown>[]> = {
        view: [{ extra: 1 }], confirm: [{ extra: 1 }], cancel: [{ extra: 1 }],
        move: [{ to: "nowhere" }, { to: { kind: "slot", start: "not a date" } }, {}, { to: { kind: "seat", runId: "r1" }, extra: 1 }],
    };
    it.each(TOKEN_ROUTES)("D6 S1D2-R05 %s: a malformed token STRING with invalid other fields → 404 linkNotValid; no lookup, write or mail", async (name, route) => {
        for (const [what, token] of MALFORMED_STRINGS) {
            for (const rest of INVALID_REST[name]) {
                const res = await call(route, { body: { token, ...rest } });
                expect({ what, rest, status: res.statusCode, code: res.json.code }).toEqual({ what, rest, status: 404, code: "linkNotValid" });
            }
        }
        expect(h.store.getBookingByToken).not.toHaveBeenCalled();
        for (const name of WRITES) expect({ name, calls: h.store[name].mock.calls.length }).toEqual({ name, calls: 0 });
        expect(h.sesSends).toEqual([]);
    });

    it.each(TOKEN_ROUTES)("D6 S1D2-R05 %s: preserved 400s — a body that is not JSON; a WELL-FORMED token with invalid other fields", async (name, route) => {
        expect((await call(route, { rawBody: "{not json" })).json.code).toBe("invalid");
        for (const rest of INVALID_REST[name]) {
            const res = await call(route, { body: { token: TOKEN, ...rest } });
            expect({ rest, status: res.statusCode, code: res.json.code }).toEqual({ rest, status: 400, code: "invalid" });
        }
        expect(h.store.getBookingByToken).not.toHaveBeenCalled();
    });

    it("S1D2-R05 the route's token format equals the store's: the REAL getBookingByToken looks up exactly the tokens the routes pass on", async () => {
        const real = await vi.importActual<typeof import("../../src/lib/scheduling-db.js")>("../../src/lib/scheduling-db.js");
        const { randomBytes } = await import("node:crypto");
        const samples = [
            ...MALFORMED_STRINGS.map(([, t]) => t), TOKEN, "a".repeat(43), "0".repeat(43), "_".repeat(43), "-".repeat(43),
            randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url"), randomBytes(32).toString("base64"),
        ];
        h.store.getBookingByToken.mockResolvedValue(undefined);
        for (const token of samples) {
            const sent: unknown[] = [];
            await real.getBookingByToken({ db: { send: async (c: unknown) => { sent.push(c); return {}; } }, table: "t", sleep: async () => {} }, "t1", token, true);
            const storeLooksUp = sent.length > 0;
            h.store.getBookingByToken.mockClear();
            await call(viewRoute, { body: { token } });
            const routeLooksUp = h.store.getBookingByToken.mock.calls.length > 0;
            expect({ token, routeLooksUp }).toEqual({ token, routeLooksUp: storeLooksUp });
        }
    });

    it("S1D2-R05 the 43-character shape goes to the lookup; a well-formed unknown token → 404 linkNotValid (one answer)", async () => {
        h.store.getBookingByToken.mockResolvedValue(undefined);
        const res = await call(viewRoute, { body: { token: TOKEN } });
        expect([res.statusCode, res.json.code]).toEqual([404, "linkNotValid"]);
        expect(h.store.getBookingByToken.mock.calls[0][2]).toBe(TOKEN);
    });

    it("S1D2-R05 an unknown extra key beside a string token → 400 invalid (strict body)", async () => {
        const res = await call(viewRoute, { body: { token: TOKEN, extra: 1 } });
        expect([res.statusCode, res.json.code]).toEqual([400, "invalid"]);
    });

    it.each(ALL_ROUTES)("D1 S1D2-R05 %s: switch off with BROKEN stored settings (horizon 0, bad templates) → 403 notAvailable, not 500", async (_n, route, opts) => {
        tenantRecord!.schedulingEnabled = false;
        tenantRecord!.scheduling = { timezone: "Mars/Olympus", bookingHorizonWeeks: 0 };
        tenantRecord!.schedulingEmailConfig = { templates: { hold: { body: "no subject" } } };
        const res = await call(route, opts);
        expect([res.statusCode, res.json.code]).toEqual([403, "notAvailable"]);
    });

    it("D1 S1D2-R05 the same broken settings with the switch ON → 500 storedDataInvalid (enabled tenants are still validated)", async () => {
        tenantRecord!.scheduling = { timezone: "Europe/Bucharest", bookingHorizonWeeks: 0 };
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call(offerRoute);
        expect([res.statusCode, res.json.code]).toEqual([500, "storedDataInvalid"]);
        log.mockRestore();
    });
});

/**
 * SCHED-GROUPS-REMOVE-1 row G4: a visitor opens an old emailed link of a seat booking (the group shape, removed). The
 * lookup here is the REAL `getBookingByToken` over a fake DynamoDB client that holds the stored items exactly as they
 * were written before the slice (`TOKEN#<sha256(token)>` → booking id; a `BOOKING#` with `what.kind: "seat"`). Every
 * token route answers exactly as for an unknown token (404 `linkNotValid`, same body), never 500; nothing is written,
 * no mail is sent.
 */
describe("G4 an old emailed link of a stored seat booking of the removed group shape", () => {
    const SEAT_ID = "5ea70000-1111-4222-8333-444455556666";
    const SEAT_TOKEN = "S".repeat(43);
    const UNKNOWN_TOKEN = "U".repeat(43);
    const TOKEN_ROUTES: [string, any, Record<string, unknown>][] = [
        ["view", viewRoute, {}], ["confirm", confirmRoute, {}], ["cancel", cancelRoute, {}],
        ["move", moveRoute, { to: { kind: "slot", start: "2026-12-07T08:00:00.000Z" } }],
    ];
    it.each(TOKEN_ROUTES)("G4 %s: the seat booking's link → 404 linkNotValid, the same answer as an unknown token; no write, no mail", async (_n, route, rest) => {
        const real = await vi.importActual<typeof import("../../src/lib/scheduling-db.js")>("../../src/lib/scheduling-db.js");
        const hash = real.sha256hex(SEAT_TOKEN);
        const stored: Record<string, Record<string, unknown>> = {
            [`TOKEN#${hash}`]: { PK: "TENANT#t1", SK: `TOKEN#${hash}`, bookingId: SEAT_ID, createdAt: NOW - MIN },
            [`BOOKING#${SEAT_ID}`]: {
                PK: "TENANT#t1", SK: `BOOKING#${SEAT_ID}`, id: SEAT_ID, ref: "B-5EA70000", rev: 3,
                what: { kind: "seat", courseId: "c1", runId: "r1" }, state: { kind: "confirmed", at: NOW - MIN },
                source: { kind: "visitor" }, who: { ...CUSTOMER, language: "ro" }, tokenHashes: [hash],
                createdAt: NOW - 2 * MIN, updatedAt: NOW - MIN,
                history: [{ action: "created", at: NOW - 2 * MIN, state: "held", placement: { kind: "seat", runId: "r1" } }, { action: "confirmed", at: NOW - MIN }],
            },
        };
        const sent: any[] = [];
        const fakeStore = { db: { send: async (c: any) => { sent.push(c); return { Item: stored[c.input?.Key?.SK] }; } }, table: "sched-table", sleep: async () => {} };
        h.store.getBookingByToken.mockImplementation((_s: unknown, tenantId: string, token: string, consistent: boolean) =>
            real.getBookingByToken(fakeStore as any, tenantId, token, consistent));
        const legacy = await call(route, { body: { token: SEAT_TOKEN, ...rest } });
        const unknown = await call(route, { body: { token: UNKNOWN_TOKEN, ...rest } });
        expect([legacy.statusCode, legacy.json]).toEqual([404, unknown.json]);
        expect(unknown.json.code).toBe("linkNotValid");
        expect(sent.map((c) => c.input.Key.SK)).toContain(`BOOKING#${SEAT_ID}`);   // control: the stored seat booking WAS read
        for (const name of WRITES) expect({ name, calls: h.store[name].mock.calls.length }).toEqual({ name, calls: 0 });
        expect(h.sesSends).toEqual([]);
    });
});
