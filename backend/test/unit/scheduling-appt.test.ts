import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BookingSchema, activeEntries, localDaySpan, planDay, type Booking, type ContainerEntry } from "@amodx/shared";

/**
 * SCHED-1E1 — the appointment admin routes of `sched-1e` (docs/slices/sched-1.md § 10.3, § 17.3 table `sched-1e`,
 * rows E1-E14, E16, E22, E23, E25; backend parts). Credential-free.
 *
 * REAL: the twelve handlers, `requireRole`, `events.ts`, `scheduling-email.ts`, `visitor/mail.ts`, the visitor `slots`
 * and `offer` handlers (E1-E3: what a visitor sees after an admin change), the kernel, and every READ and configuration
 * write of `scheduling-db.ts` (`readIntervals`, `getBookingViews`, `editResourceDays`, `putService`, …) on `MemTable`,
 * an in-memory table that answers Get / Query / BatchGet / Put (with the two conditions the module sends) / Delete and
 * records every command.
 * Iteration 1 adds one test per review-0 finding, named "S1E1-R01" … "S1E1-R05".
 * REPLACED: the main-table client (the tenant record), the AWS clients of EventBridge and SES (they record every
 * `PutEvents` and `SendEmail`), and the three booking TRANSACTIONS (`createManualAppointment`, `moveSlot`, `mintToken`):
 * their rules and items are rows C10, C11 (b), C16 (1), C32, C35 (1) of `sched-1c` (scheduling-db.test.ts, FakeTable);
 * here the rows prove what the ROUTE does around them (arguments, answers, mails, no audit).
 */

const h = vi.hoisted(() => {
    process.env.EVENT_BUS_NAME = "test-bus";
    process.env.SCHEDULING_TABLE_NAME = "sched-table";
    return {
        ddbSend: vi.fn(),
        putEvents: [] as any[],
        sesSends: [] as any[],
        sesFail: { on: false },
        mem: { current: undefined as any },
        create: vi.fn(),
        move: vi.fn(),
        mint: vi.fn(),
        readIntervalsCalls: { n: 0 },
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
    return {
        ...real,
        createManualAppointment: h.create,
        moveSlot: h.move,
        mintToken: h.mint,
        // Counted, then the REAL list function (E25: every interval read of a consumer goes through it).
        readIntervals: (...args: Parameters<typeof real.readIntervals>) => { h.readIntervalsCalls.n++; return real.readIntervals(...args); },
        schedulingStoreFromEnv: () => ({ db: h.mem.current, table: "sched-table", sleep: async () => {} }),
    };
});

import { handler as listServicesRoute } from "../../src/scheduling/admin/appt-services-list.js";
import { handler as createServiceRoute } from "../../src/scheduling/admin/appt-services-create.js";
import { handler as updateServiceRoute } from "../../src/scheduling/admin/appt-services-update.js";
import { handler as deleteServiceRoute } from "../../src/scheduling/admin/appt-services-delete.js";
import { handler as getAvailabilityRoute } from "../../src/scheduling/admin/appt-availability-get.js";
import { handler as putAvailabilityRoute } from "../../src/scheduling/admin/appt-availability-put.js";
import { handler as weekRoute } from "../../src/scheduling/admin/appt-week.js";
import { handler as daysRoute } from "../../src/scheduling/admin/appt-days-edit.js";
import { handler as copyWeekRoute } from "../../src/scheduling/admin/appt-days-copy-week.js";
import { handler as appointmentsRoute } from "../../src/scheduling/admin/appt-appointments-list.js";
import { handler as manualRoute } from "../../src/scheduling/admin/appt-appointments-create.js";
import { handler as moveSlotRoute } from "../../src/scheduling/admin/appt-move-slot.js";
import { handler as slotsRoute } from "../../src/scheduling/visitor/slots.js";
import { handler as offerRoute } from "../../src/scheduling/visitor/offer.js";
import { utcDatesOf } from "../../src/lib/scheduling-db.js";

// ---------------------------------------------------------------------------------------------------------------
// MemTable: the requests scheduling-db.ts sends, answered from a Map (PK|SK → item)
// ---------------------------------------------------------------------------------------------------------------

class MemTable {
    items = new Map<string, Record<string, any>>();
    calls: { op: string; input: any }[] = [];
    /** One-shot hook run when a consistent Get of the given SK is answered (E11 interleavings). */
    onConsistentGet: { sk: string; run: () => Promise<void> } | undefined;
    /** One-shot hook run just before a Put of the given SK is applied (S1E1-R03: a delete that commits in between). */
    beforePut: { sk: string; run: () => Promise<void> } | undefined;

    put(item: Record<string, any>): void { this.items.set(`${item.PK}|${item.SK}`, structuredClone(item)); }
    get(pk: string, sk: string): Record<string, any> | undefined { return this.items.get(`${pk}|${sk}`); }
    ops(op: string): any[] { return this.calls.filter((c) => c.op === op).map((c) => c.input); }

    private project(item: Record<string, any>, input: any): Record<string, any> {
        if (!input.ProjectionExpression) return structuredClone(item);
        const names: Record<string, string> = input.ExpressionAttributeNames ?? {};
        const out: Record<string, any> = {};
        for (const path of String(input.ProjectionExpression).split(",").map((p) => p.trim())) {
            const top = path.split(".")[0];
            const attr = top.startsWith("#") ? names[top] : top;
            if (item[attr] !== undefined) out[attr] = structuredClone(item[attr]);
        }
        return out;
    }

    async send(cmd: any): Promise<any> {
        const op = cmd.constructor.name as string;
        const input = cmd.input;
        this.calls.push({ op, input });
        switch (op) {
            case "GetCommand": {
                const item = this.get(input.Key.PK, input.Key.SK);
                const answer = { Item: item === undefined ? undefined : structuredClone(item) };
                if (input.ConsistentRead && this.onConsistentGet?.sk === input.Key.SK) {
                    const hook = this.onConsistentGet;
                    this.onConsistentGet = undefined;
                    await hook.run();
                }
                return answer;
            }
            case "QueryCommand": {
                const v = input.ExpressionAttributeValues;
                const cond = String(input.KeyConditionExpression);
                const match = (sk: string) => cond.includes("begins_with") ? sk.startsWith(v[":p"]) : sk >= v[":lo"] && sk <= v[":hi"];
                const items = [...this.items.values()].filter((i) => i.PK === v[":pk"] && match(i.SK))
                    .sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
                return { Items: items.map((i) => this.project(i, input)) };
            }
            case "BatchGetCommand": {
                const table = Object.keys(input.RequestItems)[0];
                const req = input.RequestItems[table];
                const found = req.Keys.map((k: any) => this.get(k.PK, k.SK)).filter((i: any) => i !== undefined);
                return { Responses: { [table]: found.map((i: any) => this.project(i, req)) } };
            }
            case "PutCommand": {
                if (this.beforePut?.sk === input.Item.SK) {
                    const hook = this.beforePut;
                    this.beforePut = undefined;
                    await hook.run();
                }
                const existing = this.get(input.Item.PK, input.Item.SK);
                const c = input.ConditionExpression as string | undefined;
                const fail = () => { throw Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" }); };
                if (c === "attribute_not_exists(SK)" && existing !== undefined) fail();
                if (c === "attribute_exists(SK)" && existing === undefined) fail();
                if (c === "#v = :v" && (existing === undefined || existing.v !== input.ExpressionAttributeValues[":v"])) fail();
                if (c !== undefined && !["attribute_not_exists(SK)", "attribute_exists(SK)", "#v = :v"].includes(c)) throw new Error(`MemTable: unsupported condition ${c}`);
                this.put(input.Item);
                return {};
            }
            case "DeleteCommand": {
                this.items.delete(`${input.Key.PK}|${input.Key.SK}`);
                return {};
            }
            default: throw new Error(`MemTable: unsupported ${op}`);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures. NOW = Tuesday 2026-12-01 12:00 in Europe/Bucharest (UTC+2 in December).
// ---------------------------------------------------------------------------------------------------------------

const NOW = Date.parse("2026-12-01T10:00:00.000Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const PK = "TENANT#t1";
const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const EDITOR = { sub: "u2", email: "editor@t1.test", role: "EDITOR", tenantId: "t1" };
const GLOBAL = { sub: "g1", email: "root@amodx.test", role: "GLOBAL_ADMIN", tenantId: "ALL" };
const OTHER_TENANT_ADMIN = { sub: "u3", email: "admin@t2.test", role: "TENANT_ADMIN", tenantId: "t2" };
const RENDERER = { sub: "renderer", role: "RENDERER", tenantId: "ALL" };
const TENANT_RECORD = {
    PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Clinic One", domain: "clinic.example",
    schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" },
    integrations: { contactEmail: "owner@clinic.example" },
};
const MON_FRI_9_17 = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

let mem: MemTable;
let tenantRecord: Record<string, any> | undefined;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const refOf = (id: string) => `B-${id.slice(0, 8).toUpperCase()}`;
/** Booking ids: hex prefix so the ref is valid (§ 4.4). */
const bid = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

function seedResource(id: string, name: string, tenant = "t1"): void { mem.put({ PK: `TENANT#${tenant}`, SK: `RESOURCE#${id}`, id, name }); }
function seedService(id: string, name: string, durationMin: number, eligibility: any = { kind: "all" }): void {
    mem.put({ PK, SK: `SERVICE#${id}`, id, name, durationMin, eligibility });
}
function seedRules(resourceId: string, rules: any[]): void { mem.put({ PK, SK: `AVAILABILITY#${resourceId}`, rules }); }
function seedDays(resourceId: string, days: Record<string, any>, v = 1): void { mem.put({ PK, SK: `DAYS#${resourceId}`, v, days }); }
function addEntry(resourceId: string, date: string, bookingId: string, entry: Record<string, number>): void {
    const sk = `RESDAY#${resourceId}#${date}`;
    const item = mem.get(PK, sk) ?? { PK, SK: sk, v: 1, entries: {} };
    item.entries[bookingId] = entry;
    mem.put(item);
}
/** A slot booking (BOOKING# valid against BookingSchema) and its entry copies in every UTC day it touches. */
function seedBooking(o: { id: string; resourceId: string; s: number; e: number; x?: number; rev?: number; name: string; serviceName?: string }): Booking {
    const rev = o.rev ?? 1;
    const b = BookingSchema.parse({
        id: o.id, ref: refOf(o.id), rev,
        what: { kind: "slot", serviceId: "svc1", serviceName: o.serviceName ?? "Consultation", resourceId: o.resourceId, start: o.s, end: o.e },
        state: o.x !== undefined ? { kind: "held", expiresAt: o.x, mail: "sent" } : { kind: "confirmed", at: NOW - MIN },
        source: { kind: "visitor" },
        who: { email: `${o.name.toLowerCase().replace(/ /g, ".")}@example.test`, name: o.name },
        tokenHashes: [], createdAt: NOW - 2 * MIN, updatedAt: NOW - MIN,
        ...(o.x !== undefined ? { heldUntil: o.x } : {}),
        history: [{ action: "created", at: NOW - 2 * MIN, state: o.x !== undefined ? "held" : "confirmed", placement: { kind: "slot", resourceId: o.resourceId, start: o.s, end: o.e } }],
    });
    mem.put({ PK, SK: `BOOKING#${o.id}`, ...b });
    for (const d of utcDatesOf(o.s, o.e)) addEntry(o.resourceId, d, o.id, { s: o.s, e: o.e, ...(o.x !== undefined ? { x: o.x } : {}), rev });
    return b;
}

type Res = { statusCode: number; body: string };
async function call(route: any, opts: { auth?: any; path?: Record<string, string>; query?: Record<string, string>; body?: unknown; rawBody?: string; tenant?: string } = {})
    : Promise<Res & { json: any }> {
    const event = {
        headers: { "x-tenant-id": opts.tenant ?? "t1" },
        pathParameters: opts.path,
        queryStringParameters: opts.query,
        requestContext: { authorizer: { lambda: opts.auth ?? TENANT_ADMIN }, http: { sourceIp: "203.0.113.9" } },
        body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    };
    const res = (await route(event, {} as any, () => {})) as Res;
    return { ...res, json: res.body ? JSON.parse(res.body) : undefined };
}
const days = (r: string, body: unknown, auth?: any) => call(daysRoute, { path: { resourceId: r }, body, auth });
const copyWeek = (r: string, body: unknown) => call(copyWeekRoute, { path: { resourceId: r }, body });
const week = (r: string, start?: string, tenant?: string) => call(weekRoute, { path: { resourceId: r }, query: start === undefined ? {} : { start }, tenant });
const slots = (serviceId: string, from: string, to: string) => call(slotsRoute, { auth: RENDERER, query: { serviceId, from, to } });
const auditEvents = () => h.putEvents.flatMap((input) => input.Entries.map((e: any) => ({ raw: e.Detail as string, detail: JSON.parse(e.Detail) })));
const startsOn = async (date: string) => (await slots("svc1", date, date)).json.days[0].starts as string[];
const dayOf = (w: any, date: string) => w.days.find((d: any) => d.date === date);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.SES_FROM_EMAIL = "noreply@amodx.test";
    process.env.RENDERER_CLOUDFRONT_ORIGIN = "https://d111.cloudfront.net";
    h.putEvents.length = 0;
    h.sesSends.length = 0;
    h.sesFail.on = false;
    h.readIntervalsCalls.n = 0;
    mem = new MemTable();
    h.mem.current = mem;
    tenantRecord = structuredClone(TENANT_RECORD);
    h.ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd.input?.Key?.PK === "SYSTEM" && cmd.input?.Key?.SK === "TENANT#t1") return { Item: tenantRecord };
        return {};
    });
    for (const fn of [h.create, h.move, h.mint]) fn.mockReset();
    seedResource("res1", "Dr. Ionescu");
    seedResource("res2", "Dr. Popa");
    seedService("svc1", "Consultation", 60);
    seedRules("res1", MON_FRI_9_17);
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------------------------------------------
// Services and default availability
// ---------------------------------------------------------------------------------------------------------------

describe("services", () => {
    it("create (201, ServiceDTO, audit with the name, no ip), list sorted by name, update, delete (204)", async () => {
        const created = await call(createServiceRoute, { body: { name: "  Check-up ", durationMin: 30, eligibility: { kind: "all" } } });
        expect(created.statusCode).toBe(201);
        expect(created.json).toMatchObject({ name: "Check-up", durationMin: 30, eligibility: { kind: "all" } });
        const listed = await call(listServicesRoute);
        expect(listed.json.services.map((s: any) => s.name)).toEqual(["Check-up", "Consultation"]);
        const updated = await call(updateServiceRoute, { path: { serviceId: created.json.id }, body: { name: "Check-up long", durationMin: 45, eligibility: { kind: "all" } } });
        expect(updated.json).toEqual({ id: created.json.id, name: "Check-up long", durationMin: 45, eligibility: { kind: "all" } });
        const deleted = await call(deleteServiceRoute, { path: { serviceId: created.json.id } });
        expect(deleted.statusCode).toBe(204);
        expect(mem.get(PK, `SERVICE#${created.json.id}`)).toBeUndefined();
        const events = auditEvents();
        expect(events.map((e) => e.detail.action)).toEqual(["CREATE_SCHEDULING_SERVICE", "UPDATE_SCHEDULING_SERVICE", "DELETE_SCHEDULING_SERVICE"]);
        expect(events.map((e) => e.detail.target.title)).toEqual(["Check-up", "Check-up long", "Check-up long"]);
        for (const e of events) { expect(e.detail.actor.email).toBe("admin@t1.test"); expect(e.detail.ip).toBeUndefined(); }
    });

    it("validation: § 4.5 bounds, strict body, unknown service 404, update/delete of another tenant's service 404", async () => {
        for (const body of [
            { name: "", durationMin: 30, eligibility: { kind: "all" } },
            { name: "x".repeat(201), durationMin: 30, eligibility: { kind: "all" } },
            { name: "A", durationMin: 3, eligibility: { kind: "all" } },
            { name: "A", durationMin: 485, eligibility: { kind: "all" } },
            { name: "A", durationMin: 32, eligibility: { kind: "all" } },
            { name: "A", durationMin: 30, eligibility: { kind: "only", resourceIds: [] } },
            { name: "A", durationMin: 30, eligibility: { kind: "all" }, extra: 1 },
        ]) expect((await call(createServiceRoute, { body })).json.code).toBe("invalid");
        expect((await call(updateServiceRoute, { path: { serviceId: "nope" }, body: { name: "A", durationMin: 30, eligibility: { kind: "all" } } })).statusCode).toBe(404);
        expect((await call(deleteServiceRoute, { path: { serviceId: "nope" } })).statusCode).toBe(404);
        mem.put({ PK: "TENANT#t2", SK: "SERVICE#svcT2", id: "svcT2", name: "Other", durationMin: 30, eligibility: { kind: "all" } });
        expect((await call(deleteServiceRoute, { path: { serviceId: "svcT2" } })).statusCode).toBe(404);
        expect(mem.get("TENANT#t2", "SERVICE#svcT2")).toBeDefined();
        expect(h.putEvents).toHaveLength(0);
    });

    it("E1 eligibility `only`: listed resources must exist (400 with the path); the service's slots come from the listed resource only", async () => {
        const bad = await call(createServiceRoute, { body: { name: "A", durationMin: 60, eligibility: { kind: "only", resourceIds: ["res1", "ghost"] } } });
        expect(bad.statusCode).toBe(400);
        expect(bad.json.issues).toEqual([{ path: "eligibility.resourceIds.1", message: "Unknown resource." }]);
        // res1: Monday 09-12; res2: Monday 14-17. A service limited to res2 offers 14:00-16:00 starts only.
        seedRules("res1", [{ weekday: 1, start: "09:00", end: "12:00" }]);
        seedRules("res2", [{ weekday: 1, start: "14:00", end: "17:00" }]);
        mem.items.delete(`${PK}|SERVICE#svc1`);
        const only = await call(createServiceRoute, { body: { name: "Therapy", durationMin: 60, eligibility: { kind: "only", resourceIds: ["res2"] } } });
        expect(only.statusCode).toBe(201);
        const got = await call(slotsRoute, { auth: RENDERER, query: { serviceId: only.json.id, from: "2026-12-07", to: "2026-12-07" } });
        expect(got.json.days[0].starts).toEqual(["2026-12-07T12:00:00.000Z", "2026-12-07T13:00:00.000Z", "2026-12-07T14:00:00.000Z"]);
        const all = await call(createServiceRoute, { body: { name: "Any", durationMin: 60, eligibility: { kind: "all" } } });
        const both = await call(slotsRoute, { auth: RENDERER, query: { serviceId: all.json.id, from: "2026-12-07", to: "2026-12-07" } });
        expect(both.json.days[0].starts).toHaveLength(6);
    });

    it("E3 a deleted service: its bookings keep serviceName (item unchanged, shown in the week read); offer omits it", async () => {
        const b = seedBooking({ id: bid(1), resourceId: "res1", s: Date.parse("2026-12-07T07:00:00Z"), e: Date.parse("2026-12-07T08:00:00Z"), name: "Ana Pop" });
        const before = JSON.stringify(mem.get(PK, `BOOKING#${b.id}`));
        expect((await call(offerRoute, { auth: RENDERER })).json.services.map((s: any) => s.id)).toEqual(["svc1"]);
        expect((await call(deleteServiceRoute, { path: { serviceId: "svc1" } })).statusCode).toBe(204);
        expect((await call(offerRoute, { auth: RENDERER })).json.services).toEqual([]);
        expect(JSON.stringify(mem.get(PK, `BOOKING#${b.id}`))).toBe(before);
        const w = await week("res1", "2026-12-07");
        expect(dayOf(w.json, "2026-12-07").entries[0]).toMatchObject({ ref: b.ref, serviceName: "Consultation", customerName: "Ana Pop" });
    });

    it("E4 a duration change: an existing booking keeps its start and end; new slots use the new duration", async () => {
        const s = Date.parse("2026-12-07T07:00:00Z");
        const b = seedBooking({ id: bid(2), resourceId: "res1", s, e: s + HOUR, name: "Ana Pop" });
        const before = JSON.stringify(mem.get(PK, `BOOKING#${b.id}`));
        const resdayBefore = JSON.stringify(mem.get(PK, "RESDAY#res1#2026-12-07"));
        const up = await call(updateServiceRoute, { path: { serviceId: "svc1" }, body: { name: "Consultation", durationMin: 30, eligibility: { kind: "all" } } });
        expect(up.statusCode).toBe(200);
        expect(JSON.stringify(mem.get(PK, `BOOKING#${b.id}`))).toBe(before);
        expect(JSON.stringify(mem.get(PK, "RESDAY#res1#2026-12-07"))).toBe(resdayBefore);
        const entry = dayOf((await week("res1", "2026-12-07")).json, "2026-12-07").entries[0];
        expect([entry.start, entry.end]).toEqual(["2026-12-07T07:00:00.000Z", "2026-12-07T08:00:00.000Z"]);
        expect((await startsOn("2026-12-07"))).toContain("2026-12-07T08:30:00.000Z"); // 30-minute grid now
    });
});

describe("default availability", () => {
    it("GET (absent → []; another tenant's resource → 404); PUT replaces the list with one Put; validation of § 10.3", async () => {
        expect((await call(getAvailabilityRoute, { path: { resourceId: "res2" } })).json).toEqual({ rules: [] });
        seedResource("resT2", "Other", "t2");
        expect((await call(getAvailabilityRoute, { path: { resourceId: "resT2" } })).statusCode).toBe(404);
        expect((await call(putAvailabilityRoute, { path: { resourceId: "resT2" }, body: { rules: [] } })).statusCode).toBe(404);
        const rules = [{ weekday: 6, start: "10:00", end: "12:30" }];
        const put = await call(putAvailabilityRoute, { path: { resourceId: "res2" }, body: { rules } });
        expect(put.json).toEqual({ rules });
        expect(mem.ops("PutCommand").filter((p) => p.Item.SK === "AVAILABILITY#res2")).toHaveLength(1);
        expect((await call(getAvailabilityRoute, { path: { resourceId: "res2" } })).json).toEqual({ rules });
        for (const bad of [
            [{ weekday: 0, start: "10:00", end: "11:00" }],
            [{ weekday: 8, start: "10:00", end: "11:00" }],
            [{ weekday: 1, start: "10:03", end: "11:00" }],
            [{ weekday: 1, start: "10:00", end: "11:02" }],
            [{ weekday: 1, start: "11:00", end: "11:00" }],
            [{ weekday: 1, start: "12:00", end: "11:00" }],
            [{ weekday: 1, start: "9:00", end: "11:00" }],
            Array.from({ length: 51 }, () => ({ weekday: 1, start: "10:00", end: "11:00" })),
        ]) {
            const res = await call(putAvailabilityRoute, { path: { resourceId: "res2" }, body: { rules: bad } });
            expect({ bad: JSON.stringify(bad).slice(0, 60), code: res.json.code }).toEqual({ bad: JSON.stringify(bad).slice(0, 60), code: "invalid" });
        }
        expect((await call(putAvailabilityRoute, { path: { resourceId: "res2" }, body: { rules, v: 2 } })).json.code).toBe("invalid");
    });

    it("E13 the defaults change while one Monday has a dayHours override: that Monday keeps it, the other Mondays follow the new defaults", async () => {
        seedDays("res1", { "2026-12-07": { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] } });
        const put = await call(putAvailabilityRoute, { path: { resourceId: "res1" }, body: { rules: [{ weekday: 1, start: "08:00", end: "14:00" }] } });
        expect(put.statusCode).toBe(200);
        const overridden = dayOf((await week("res1", "2026-12-07")).json, "2026-12-07");
        expect(overridden).toMatchObject({ source: "dayHours", windows: [{ start: "09:00", end: "12:00" }] });
        const next = dayOf((await week("res1", "2026-12-14")).json, "2026-12-14");
        expect(next).toMatchObject({ source: "default", windows: [{ start: "08:00", end: "14:00" }] });
        expect(mem.get(PK, "DAYS#res1")!.days).toEqual({ "2026-12-07": { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] } });
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Week read
// ---------------------------------------------------------------------------------------------------------------

describe("week read", () => {
    /** The E16 week: Monday 2026-11-23 … Sunday 2026-11-29; local today 2026-12-01, so today − 8 = 11-23 (past). */
    function seedE16() {
        seedDays("res1", {
            "2026-11-26": { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }], note: "short day" },
            "2026-11-27": { kind: "dayOff" },
        });
        const past = seedBooking({ id: bid(0x11), resourceId: "res1", s: Date.parse("2026-11-23T08:00:00Z"), e: Date.parse("2026-11-23T09:00:00Z"), name: "Old Visit" });
        const held = seedBooking({ id: bid(0x12), resourceId: "res1", s: Date.parse("2026-11-25T08:00:00Z"), e: Date.parse("2026-11-25T09:00:00Z"), x: NOW + 10 * MIN, rev: 2, name: "Held Person" });
        const off = seedBooking({ id: bid(0x13), resourceId: "res1", s: Date.parse("2026-11-27T08:00:00Z"), e: Date.parse("2026-11-27T09:00:00Z"), name: "Day Off Person" });
        return { past, held, off };
    }

    it("E16 seven DayDTOs as planDay: past day with its entries; default; dayHours (removed, note); dayOff with a booking outside hours; a held entry with expiresAt", async () => {
        const { past, held, off } = seedE16();
        const res = await week("res1", "2026-11-23");
        expect(res.statusCode).toBe(200);
        const w = res.json;
        expect(w).toMatchObject({ timezone: "Europe/Bucharest", resourceId: "res1", resourceName: "Dr. Ionescu", lastBookableDate: "2027-01-26", defaults: MON_FRI_9_17 });
        expect(w.days.map((d: any) => [d.date, d.kind, d.source])).toEqual([
            ["2026-11-23", "past", undefined], ["2026-11-24", "past", undefined], ["2026-11-25", "planned", "default"],
            ["2026-11-26", "planned", "dayHours"], ["2026-11-27", "planned", "dayOff"], ["2026-11-28", "planned", "default"],
            ["2026-11-29", "planned", "default"],
        ]);
        expect(dayOf(w, "2026-11-23").entries).toEqual([{
            bookingId: past.id, ref: past.ref, start: "2026-11-23T08:00:00.000Z", end: "2026-11-23T09:00:00.000Z",
            state: "confirmed", customerName: "Old Visit", serviceName: "Consultation",
        }]);
        expect(dayOf(w, "2026-11-25").entries).toEqual([{
            bookingId: held.id, ref: held.ref, start: "2026-11-25T08:00:00.000Z", end: "2026-11-25T09:00:00.000Z",
            state: "held", expiresAt: new Date(NOW + 10 * MIN).toISOString(), customerName: "Held Person", serviceName: "Consultation",
        }]);
        expect(dayOf(w, "2026-11-26")).toMatchObject({ windows: [{ start: "09:00", end: "12:00" }], removed: [{ start: "12:00", end: "17:00" }], note: "short day" });
        expect(dayOf(w, "2026-11-27")).toMatchObject({ windows: [], removed: [{ start: "09:00", end: "17:00" }], open: [], outsideHours: [off.ref] });
        expect(dayOf(w, "2026-11-27").entries.map((e: any) => e.ref)).toEqual([off.ref]);
        // Every planned day equals the kernel's planDay on the same inputs (instants as UTC ISO, ids as refs).
        const raw: ContainerEntry[] = [past, held, off].map((b) => ({ bookingId: b.id, s: (b.what as any).start, e: (b.what as any).end, rev: b.rev, ...(b.state.kind === "held" ? { x: b.state.expiresAt } : {}) }));
        const storedDays = mem.get(PK, "DAYS#res1")!.days;
        for (const d of w.days.filter((x: any) => x.kind === "planned")) {
            const p = planDay({ rules: MON_FRI_9_17 as any, days: storedDays, date: d.date, entries: activeEntries(raw, localDaySpan(d.date, "Europe/Bucharest"), NOW), tz: "Europe/Bucharest", now: NOW });
            if (p.kind !== "planned") throw new Error("expected planned");
            expect({ date: d.date, source: d.source, windows: d.windows, removed: d.removed, open: d.open, outsideHours: d.outsideHours }).toEqual({
                date: d.date, source: p.source, windows: p.windows, removed: p.removed,
                open: p.open.map((o) => ({ start: new Date(o.start).toISOString(), end: new Date(o.end).toISOString() })),
                outsideHours: p.outsideHours.map(refOf),
            });
        }
    });

    it("E16 the same answer with the switch off; another tenant's resource id → 404", async () => {
        seedE16();
        const on = await week("res1", "2026-11-23");
        tenantRecord!.schedulingEnabled = false;
        const off = await week("res1", "2026-11-23");
        expect(off.statusCode).toBe(200);
        expect(off.body).toBe(on.body);
        seedResource("resT2", "Other tenant's", "t2");
        expect((await week("resT2", "2026-11-23")).statusCode).toBe(404);
    });

    it("E22 field `start`: absent → 400; a Monday → 7 days from it; a Wednesday → 7 days from it; malformed ×3 → 400; unknown resource → 404", async () => {
        expect((await week("res1")).json.code).toBe("invalid");
        expect((await week("res1", "2026-12-07")).json.days.map((d: any) => d.date)).toEqual(
            ["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13"]);
        expect((await week("res1", "2026-12-09")).json.days.map((d: any) => d.date)).toEqual(
            ["2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13", "2026-12-14", "2026-12-15"]);
        for (const bad of ["2026-12-32", "12/07/2026", "x"]) {
            const res = await week("res1", bad);
            expect({ bad, status: res.statusCode, code: res.json.code }).toEqual({ bad, status: 400, code: "invalid" });
        }
        expect((await week("ghost", "2026-12-07")).statusCode).toBe(404);
    });

    it("no stored time zone → 409 timezoneNotSet; a stored setting that fails its schema → 500 storedDataInvalid (key logged, not the value)", async () => {
        tenantRecord!.scheduling = {};
        expect((await week("res1", "2026-12-07")).json.code).toBe("timezoneNotSet");
        tenantRecord!.scheduling = { timezone: "Mars/Olympus" };
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await week("res1", "2026-12-07");
        expect([res.statusCode, res.json.code]).toEqual([500, "storedDataInvalid"]);
        expect(JSON.stringify(err.mock.calls)).toContain("TENANT#t1.scheduling");
        expect(JSON.stringify(err.mock.calls)).not.toContain("Mars/Olympus");
        err.mockRestore();
    });
});

// ---------------------------------------------------------------------------------------------------------------
// All-resource appointments read
// ---------------------------------------------------------------------------------------------------------------

describe("all-resource appointments read", () => {
    it("E6 three days, two resources: every resource's intervals with ref, customer and service name; the 01:30-02:30 local booking (two RESDAY# items) listed once; 32 days → 400 rangeTooLong", async () => {
        // local 2026-12-07 01:30-02:30 Bucharest = 2026-12-06T23:30Z - 2026-12-07T00:30Z: two UTC days.
        const cross = seedBooking({ id: bid(0x21), resourceId: "res1", s: Date.parse("2026-12-06T23:30:00Z"), e: Date.parse("2026-12-07T00:30:00Z"), rev: 3, name: "Night Owl" });
        expect(Object.keys(mem.get(PK, "RESDAY#res1#2026-12-06")!.entries)).toEqual([cross.id]);
        expect(Object.keys(mem.get(PK, "RESDAY#res1#2026-12-07")!.entries)).toEqual([cross.id]);
        const other = seedBooking({ id: bid(0x22), resourceId: "res2", s: Date.parse("2026-12-08T08:00:00Z"), e: Date.parse("2026-12-08T09:00:00Z"), name: "Ion Pop", serviceName: "Therapy" });
        seedBooking({ id: bid(0x23), resourceId: "res2", s: Date.parse("2026-12-10T08:00:00Z"), e: Date.parse("2026-12-10T09:00:00Z"), name: "Out Of Range" });
        const res = await call(appointmentsRoute, { query: { from: "2026-12-06", to: "2026-12-08" } });
        expect(res.statusCode).toBe(200);
        expect(res.json).toEqual({
            timezone: "Europe/Bucharest",
            resources: [
                { resourceId: "res1", name: "Dr. Ionescu", entries: [{ bookingId: cross.id, ref: cross.ref, start: "2026-12-06T23:30:00.000Z", end: "2026-12-07T00:30:00.000Z", state: "confirmed", customerName: "Night Owl", serviceName: "Consultation" }] },
                { resourceId: "res2", name: "Dr. Popa", entries: [{ bookingId: other.id, ref: other.ref, start: "2026-12-08T08:00:00.000Z", end: "2026-12-08T09:00:00.000Z", state: "confirmed", customerName: "Ion Pop", serviceName: "Therapy" }] },
            ],
        });
        const long = await call(appointmentsRoute, { query: { from: "2026-12-01", to: "2027-01-01" } });
        expect([long.statusCode, long.json.code, long.json.maxDays]).toEqual([400, "rangeTooLong", 31]);
        expect((await call(appointmentsRoute, { query: { from: "2026-12-01", to: "2026-12-31" } })).statusCode).toBe(200);
        expect((await call(appointmentsRoute, { query: { from: "2026-12-08", to: "2026-12-06" } })).json.code).toBe("rangeInverted");
        expect((await call(appointmentsRoute, { query: { from: "2026-12-06" } })).json.code).toBe("invalid");
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Day edits and copy-week
// ---------------------------------------------------------------------------------------------------------------

describe("day edits", () => {
    it("E2 dayOff and a shorter dayHours on a date with one confirmed and one held booking: starts leave slots at once; both refs in outsideHours; bookings unchanged; no mail", async () => {
        const a = seedBooking({ id: bid(0x31), resourceId: "res1", s: Date.parse("2026-12-07T07:00:00Z"), e: Date.parse("2026-12-07T08:00:00Z"), name: "Ana Pop" });
        const b = seedBooking({ id: bid(0x32), resourceId: "res1", s: Date.parse("2026-12-07T09:00:00Z"), e: Date.parse("2026-12-07T10:00:00Z"), x: NOW + 20 * MIN, name: "Ion Held" });
        const snapshot = () => JSON.stringify([...mem.items.entries()].filter(([k]) => k.includes("BOOKING#") || k.includes("RESDAY#")));
        const before = snapshot();
        expect(await startsOn("2026-12-07")).toEqual(["2026-12-07T08:00:00.000Z", "2026-12-07T10:00:00.000Z", "2026-12-07T11:00:00.000Z", "2026-12-07T12:00:00.000Z", "2026-12-07T13:00:00.000Z", "2026-12-07T14:00:00.000Z"]);

        const short = await days("res1", { from: "2026-12-07", to: "2026-12-07", value: { kind: "dayHours", windows: [{ start: "13:00", end: "17:00" }] } });
        expect(short.json).toEqual({ changed: ["2026-12-07"], outsideHours: [a.ref, b.ref] });
        expect(await startsOn("2026-12-07")).toEqual(["2026-12-07T11:00:00.000Z", "2026-12-07T12:00:00.000Z", "2026-12-07T13:00:00.000Z", "2026-12-07T14:00:00.000Z"]);

        const off = await days("res1", { from: "2026-12-07", to: "2026-12-07", value: { kind: "dayOff" } });
        expect(off.json).toEqual({ changed: ["2026-12-07"], outsideHours: [a.ref, b.ref] });
        expect(await startsOn("2026-12-07")).toEqual([]);
        expect(snapshot()).toBe(before);           // both bookings and their entries untouched (the held one stays confirmable)
        expect(h.sesSends).toEqual([]);
    });

    it("E2 cross-midnight: dayOff on 2026-12-08 lists the 23:30-00:30 admin booking; a range over both days lists it once", async () => {
        // local 2026-12-07 23:30 - 2026-12-08 00:30 = 21:30Z - 22:30Z on 2026-12-07.
        const x = seedBooking({ id: bid(0x41), resourceId: "res1", s: Date.parse("2026-12-07T21:30:00Z"), e: Date.parse("2026-12-07T22:30:00Z"), name: "Late One" });
        expect((await days("res1", { from: "2026-12-08", to: "2026-12-08", value: { kind: "dayOff" } })).json).toEqual({ changed: ["2026-12-08"], outsideHours: [x.ref] });
        const range = await days("res1", { from: "2026-12-07", to: "2026-12-08", value: { kind: "dayHours", windows: [{ start: "09:00", end: "10:00" }] } });
        expect(range.json).toEqual({ changed: ["2026-12-07", "2026-12-08"], outsideHours: [x.ref] });
    });

    it("E9 366 dates → 200; 367 → 400 rangeTooLong; from yesterday → 400 startsInPast; `default` on an edited date → changed, week shows source default", async () => {
        expect((await days("res1", { from: "2026-12-01", to: "2027-12-01", value: { kind: "dayOff" } })).statusCode).toBe(200); // 366 dates
        expect(Object.keys(mem.get(PK, "DAYS#res1")!.days)).toHaveLength(366);
        const tooLong = await days("res1", { from: "2026-12-01", to: "2027-12-02", value: { kind: "dayOff" } });
        expect([tooLong.statusCode, tooLong.json.code, tooLong.json.maxDays]).toEqual([400, "rangeTooLong", 366]);
        const past = await days("res1", { from: "2026-11-30", to: "2026-12-02", value: { kind: "dayOff" } });
        expect([past.statusCode, past.json.code, past.json.today]).toEqual([400, "startsInPast", "2026-12-01"]);
        const reset = await days("res1", { from: "2026-12-07", to: "2026-12-07", value: { kind: "default" } });
        expect(reset.json).toEqual({ changed: ["2026-12-07"], outsideHours: [] });
        expect(dayOf((await week("res1", "2026-12-07")).json, "2026-12-07")).toMatchObject({ source: "default", windows: [{ start: "09:00", end: "17:00" }], removed: [] });
        expect((await days("res1", { from: "2026-12-08", to: "2026-12-07", value: { kind: "dayOff" } })).json.code).toBe("rangeInverted");
    });

    it("E9 / A22 malformed windows and notes → 400 invalid with an issue that names the field", async () => {
        const w = (windows: any, note?: string) => ({ from: "2026-12-07", to: "2026-12-07", value: { kind: "dayHours", windows, ...(note !== undefined ? { note } : {}) } });
        const cases: [string, unknown, string][] = [
            ["empty", w([]), "value.windows"],
            ["nine", w(Array.from({ length: 9 }, (_, i) => ({ start: `${String(9 + i).padStart(2, "0")}:00`, end: `${String(9 + i).padStart(2, "0")}:30` }))), "value.windows"],
            ["end<=start", w([{ start: "10:00", end: "10:00" }]), "value.windows.0.end"],
            ["overlap", w([{ start: "09:00", end: "11:00" }, { start: "10:00", end: "12:00" }]), "value.windows.1.start"],
            ["off grid", w([{ start: "09:03", end: "10:00" }]), "value.windows.0.start"],
            ["unsorted", w([{ start: "13:00", end: "14:00" }, { start: "09:00", end: "10:00" }]), "value.windows.1.start"],
            ["note 201", w([{ start: "09:00", end: "10:00" }], "n".repeat(201)), "value.note"],
            ["closed", { from: "2026-12-07", to: "2026-12-07", value: { kind: "closed" } }, "value.kind"],
        ];
        for (const [name, body, path] of cases) {
            const res = await days("res1", body);
            expect({ name, status: res.statusCode, code: res.json.code }).toEqual({ name, status: 400, code: "invalid" });
            expect({ name, paths: res.json.issues.map((i: any) => i.path) }).toEqual({ name, paths: expect.arrayContaining([path]) });
        }
        expect(mem.get(PK, "DAYS#res1")).toBeUndefined();
        expect(h.putEvents).toHaveLength(0);
    });

    it("E10 copy-week: the § 5.5 example (3 Mondays set, the other 18 target overrides removed) and the A20 refusals; weeks 0 and 53 → 400", async () => {
        seedDays("res1", {
            "2026-12-07": { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] },
            "2026-12-15": { kind: "dayOff" }, "2026-12-23": { kind: "dayOff" }, "2027-01-02": { kind: "dayOff" },
            "2027-01-05": { kind: "dayOff" }, // after the 21 target dates (2026-12-14 … 2027-01-03): kept
        });
        const res = await copyWeek("res1", { sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks: 3 });
        expect(res.json).toEqual({ changed: ["2026-12-14", "2026-12-15", "2026-12-21", "2026-12-23", "2026-12-28", "2027-01-02"], outsideHours: [] });
        expect(mem.get(PK, "DAYS#res1")!.days).toEqual({
            "2026-12-07": { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] },
            "2026-12-14": { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] },
            "2026-12-21": { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] },
            "2026-12-28": { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] },
            "2027-01-05": { kind: "dayOff" },
        });
        const refusals: [unknown, string][] = [
            [{ sourceStart: "2026-12-08", targetStart: "2026-12-14", weeks: 1 }, "weekdayMismatch"],      // Tuesday → Monday
            [{ sourceStart: "2026-12-07", targetStart: "2026-12-07", weeks: 1 }, "targetOverlapsSource"],
            [{ sourceStart: "2026-11-24", targetStart: "2026-12-08", weeks: 1 }, "sourceTooOld"],         // today − 7
            [{ sourceStart: "2026-12-07", targetStart: "2026-11-30", weeks: 1 }, "startsInPast"],         // yesterday
        ];
        for (const [body, code] of refusals) {
            const r = await copyWeek("res1", body);
            expect({ code, status: r.statusCode, got: r.json.code }).toEqual({ code, status: 400, got: code });
        }
        expect((await copyWeek("res1", { sourceStart: "2026-11-24", targetStart: "2026-12-08", weeks: 1 })).json.oldest).toBe("2026-11-25");
        for (const weeks of [0, 53]) expect((await copyWeek("res1", { sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks })).json.code).toBe("invalid");
    });

    it("E11 two PUTs at once on different dates → both applied; on the same date → the later write's value stored; a body with `v` → 400; two lost conditions → 503 busy", async () => {
        seedDays("res1", {}, 4);
        // B commits between A's consistent read of DAYS# and A's conditional Put: A's Put loses, A re-reads and re-applies.
        let inner: any;
        mem.onConsistentGet = { sk: "DAYS#res1", run: async () => { inner = await days("res1", { from: "2026-12-09", to: "2026-12-09", value: { kind: "dayOff" } }); } };
        const outer = await days("res1", { from: "2026-12-08", to: "2026-12-08", value: { kind: "dayOff" } });
        expect([inner.statusCode, outer.statusCode]).toEqual([200, 200]);
        expect(mem.get(PK, "DAYS#res1")).toMatchObject({ v: 6, days: { "2026-12-08": { kind: "dayOff" }, "2026-12-09": { kind: "dayOff" } } });

        mem.onConsistentGet = { sk: "DAYS#res1", run: async () => { await days("res1", { from: "2026-12-10", to: "2026-12-10", value: { kind: "dayHours", windows: [{ start: "09:00", end: "10:00" }] } }); } };
        await days("res1", { from: "2026-12-10", to: "2026-12-10", value: { kind: "dayOff", note: "later" } });
        expect(mem.get(PK, "DAYS#res1")!.days["2026-12-10"]).toEqual({ kind: "dayOff", note: "later" });

        const withV = await days("res1", { from: "2026-12-11", to: "2026-12-11", value: { kind: "dayOff" }, v: 7 });
        expect([withV.statusCode, withV.json.code]).toEqual([400, "invalid"]);
        expect(JSON.stringify(outer.json)).not.toMatch(/"v"/);

        // Every consistent read of DAYS# is followed by another writer's commit: the route answers busy after two losses.
        const always = async () => {
            const item = mem.get(PK, "DAYS#res1")!;
            mem.put({ ...item, v: item.v + 1 });
            mem.onConsistentGet = { sk: "DAYS#res1", run: always };
        };
        mem.onConsistentGet = { sk: "DAYS#res1", run: always };
        const busy = await days("res1", { from: "2026-12-14", to: "2026-12-14", value: { kind: "dayOff" } });
        mem.onConsistentGet = undefined;
        expect([busy.statusCode, busy.json.code]).toEqual([503, "busy"]);
    });

    it("E12 audit of a day edit, a copy-week and a default-availability change: one event each, the admin, the resource name, dates and kind; no ref, no customer data, no ip", async () => {
        const b = seedBooking({ id: bid(0x51), resourceId: "res1", s: Date.parse("2026-12-07T07:00:00Z"), e: Date.parse("2026-12-07T08:00:00Z"), name: "Ana Pop" });
        const edit = await days("res1", { from: "2026-12-07", to: "2026-12-08", value: { kind: "dayOff", note: "sick" } });
        expect(edit.json.outsideHours).toEqual([b.ref]);
        await copyWeek("res1", { sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks: 2 });
        await call(putAvailabilityRoute, { path: { resourceId: "res1" }, body: { rules: MON_FRI_9_17 } });
        const events = auditEvents();
        expect(events.map((e) => e.detail)).toEqual([
            expect.objectContaining({ action: "EDIT_SCHEDULING_DAYS", actor: { id: "u1", email: "admin@t1.test" }, target: { id: "res1", title: "Dr. Ionescu" },
                details: { from: "2026-12-07", to: "2026-12-08", setting: "dayOff", changedDates: 2 } }),
            expect.objectContaining({ action: "COPY_SCHEDULING_WEEK", target: { id: "res1", title: "Dr. Ionescu" },
                details: { sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks: 2, changedDates: 4 } }), // 12-14, 12-15, 12-21, 12-22
            expect.objectContaining({ action: "UPDATE_SCHEDULING_AVAILABILITY", target: { id: "res1", title: "Dr. Ionescu" }, details: { rules: 5 } }),
        ]);
        for (const e of events) {
            expect(e.detail.ip).toBeUndefined();
            for (const secret of [b.ref, b.id, "Ana Pop", "ana.pop@example.test", "sick"]) expect(e.raw).not.toContain(secret);
        }
    });

    it("E23 edit request fields: each missing field → 400 naming it; each DaySetting kind → 200; impossible date, unknown kind, unknown key → 400; copy-week weeks 1 and 52 → 200, 0 / 53 / 2.5 / \"3\" → 400", async () => {
        const full = { from: "2026-12-07", to: "2026-12-07", value: { kind: "dayOff" } };
        for (const field of ["from", "to", "value"] as const) {
            const body: Record<string, unknown> = { ...full };
            delete body[field];
            const res = await days("res1", body);
            expect({ field, code: res.json.code, paths: res.json.issues.map((i: any) => i.path) }).toEqual({ field, code: "invalid", paths: [field] });
        }
        for (const value of [{ kind: "dayOff" }, { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] }, { kind: "default" }]) {
            expect({ kind: value.kind, status: (await days("res1", { ...full, value })).statusCode }).toEqual({ kind: value.kind, status: 200 });
        }
        expect((await days("res1", { ...full, from: "2026-02-30" })).json.code).toBe("invalid");
        expect((await days("res1", { ...full, value: { kind: "closed" } })).json.code).toBe("invalid");
        expect((await days("res1", { ...full, extra: true })).json.code).toBe("invalid");

        const cw = { sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks: 1 };
        for (const field of ["sourceStart", "targetStart", "weeks"] as const) {
            const body: Record<string, unknown> = { ...cw };
            delete body[field];
            const res = await copyWeek("res1", body);
            expect({ field, code: res.json.code, paths: res.json.issues.map((i: any) => i.path) }).toEqual({ field, code: "invalid", paths: [field] });
        }
        expect((await copyWeek("res1", cw)).statusCode).toBe(200);
        expect((await copyWeek("res1", { ...cw, weeks: 52 })).statusCode).toBe(200);
        for (const weeks of [0, 53, 2.5, "3"]) {
            expect({ weeks, code: (await copyWeek("res1", { ...cw, weeks })).json.code }).toEqual({ weeks, code: "invalid" });
        }
        expect((await copyWeek("res1", { ...cw, extra: 1 })).json.code).toBe("invalid");
    });

    it("unknown resource → 404 and no write; no time zone → 409 timezoneNotSet; a broken stored setting → 500 with nothing written", async () => {
        expect((await days("ghost", { from: "2026-12-07", to: "2026-12-07", value: { kind: "dayOff" } })).statusCode).toBe(404);
        tenantRecord!.scheduling = { holdMinutes: 30 };
        expect((await days("res1", { from: "2026-12-07", to: "2026-12-07", value: { kind: "dayOff" } })).json.code).toBe("timezoneNotSet");
        tenantRecord!.scheduling = { timezone: "Europe/Bucharest", bookingHorizonWeeks: 0 };
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await copyWeek("res1", { sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks: 1 })).json.code).toBe("storedDataInvalid");
        err.mockRestore();
        expect(mem.ops("PutCommand")).toEqual([]);
        expect(h.putEvents).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Manual appointment and admin slot move (the transactions are sched-1c's; the route around them is tested here)
// ---------------------------------------------------------------------------------------------------------------

function confirmedSlot(over: Partial<Booking> = {}): Booking {
    const s = Date.parse("2026-12-12T08:00:00Z");
    return BookingSchema.parse({
        id: bid(0x61), ref: refOf(bid(0x61)), rev: 1,
        what: { kind: "slot", serviceId: "svc1", serviceName: "Consultation", resourceId: "res1", start: s, end: s + HOUR },
        state: { kind: "confirmed", at: NOW },
        source: { kind: "manual", adminEmail: "admin@t1.test", channel: "phone" },
        who: { email: "ana.pop@example.test", name: "Ana Pop", phone: "+40 700 000 000" },
        tokenHashes: [sha("TOKEN_ONE_".padEnd(43, "a"))], createdAt: NOW, updatedAt: NOW,
        history: [{ action: "created", at: NOW, state: "confirmed", placement: { kind: "slot", resourceId: "res1", start: s, end: s + HOUR } }],
        ...over,
    });
}
const TOKEN_ONE = "TOKEN_ONE_".padEnd(43, "a");
const TOKEN_TWO = "TOKEN_TWO_".padEnd(43, "b");
const WHO = { email: "  Ana.Pop@Example.TEST ", name: "Ana Pop", phone: "+40 700 000 000" };

describe("manual appointment", () => {
    it("E5 outside the windows, on a dayOff date and after lastBookableDate: 201 confirmed each time (the route adds no visitor rule); mail with a working link; owner copy without it; no audit", async () => {
        seedDays("res1", { "2026-12-12": { kind: "dayOff" } });
        const starts = ["2026-12-07T05:00:00.000Z", "2026-12-12T08:00:00.000Z", "2027-03-01T08:00:00.000Z"]; // 07:00 local; day off; after 2027-01-26
        for (const start of starts) {
            h.sesSends.length = 0;
            const b = confirmedSlot({ what: { kind: "slot", serviceId: "svc1", serviceName: "Consultation", resourceId: "res1", start: Date.parse(start), end: Date.parse(start) + HOUR } });
            h.create.mockResolvedValueOnce({ ok: true, value: { booking: b, token: TOKEN_ONE } });
            const res = await call(manualRoute, { body: { serviceId: "svc1", resourceId: "res1", start, who: WHO, channel: "phone" } });
            expect(res.statusCode).toBe(201);
            expect(res.json).toMatchObject({ id: b.id, state: { kind: "confirmed" }, source: { kind: "manual", channel: "phone" }, what: { kind: "slot", resourceName: "Dr. Ionescu", start } });
            expect(h.create).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
                tenantId: "t1", serviceId: "svc1", resourceId: "res1", start: Date.parse(start), channel: "phone", adminEmail: "admin@t1.test", now: NOW,
                who: { email: "ana.pop@example.test", name: "Ana Pop", phone: "+40 700 000 000" },
            }));
            const toCustomer = h.sesSends.find((m) => m.Destination.ToAddresses[0] === "ana.pop@example.test");
            const link = `https://clinic.example/_booking/manage#t=${TOKEN_ONE}`;
            expect(toCustomer.Message.Body.Text.Data).toContain(link);
            expect(b.tokenHashes).toContain(sha(TOKEN_ONE)); // the link's token is one the booking lists
            const owner = h.sesSends.find((m) => m.Destination.ToAddresses[0] === "owner@clinic.example");
            expect(owner).toBeDefined();
            expect(owner.Message.Body.Text.Data).not.toContain(TOKEN_ONE);
        }
        expect(h.putEvents).toEqual([]);
    });

    it("refusals: slotTaken 409, resourceUnavailable 409, notFound 404, busy 503; validation (strict, channel ≤ 40, email); an unknown resource → 404 before the store", async () => {
        const body = { serviceId: "svc1", resourceId: "res1", start: "2026-12-07T07:00:00.000Z", who: WHO, channel: "phone" };
        for (const [error, status, code] of [[{ kind: "slotTaken" }, 409, "slotTaken"], [{ kind: "resourceUnavailable" }, 409, "resourceUnavailable"],
            [{ kind: "notFound" }, 404, "notFound"], [{ kind: "busy" }, 503, "busy"]] as const) {
            h.create.mockResolvedValueOnce({ ok: false, error });
            const res = await call(manualRoute, { body });
            expect([res.statusCode, res.json.code]).toEqual([status, code]);
        }
        expect(h.sesSends).toEqual([]);
        h.create.mockClear();
        for (const bad of [{ ...body, extra: 1 }, { ...body, channel: "c".repeat(41) }, { ...body, channel: "" }, { ...body, who: { ...WHO, email: "not-an-email" } },
            { ...body, start: "2026-12-07 07:00" }, { ...body, who: { ...WHO, extra: 1 } }]) {
            expect((await call(manualRoute, { body: bad })).json.code).toBe("invalid");
        }
        expect((await call(manualRoute, { body: { ...body, resourceId: "ghost" } })).statusCode).toBe(404);
        expect(h.create).not.toHaveBeenCalled();
    });

    it("a mail failure is logged with the booking id only (no customer data) and the booking stands (201)", async () => {
        h.create.mockResolvedValueOnce({ ok: true, value: { booking: confirmedSlot(), token: TOKEN_ONE } });
        h.sesFail.on = true;
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const res = await call(manualRoute, { body: { serviceId: "svc1", resourceId: "res1", start: "2026-12-12T08:00:00.000Z", who: WHO, channel: "phone" } });
        const logged = JSON.stringify([...err.mock.calls, ...log.mock.calls]);
        err.mockRestore(); log.mockRestore();
        expect(res.statusCode).toBe(201);
        expect(logged).toContain(bid(0x61));
        for (const secret of ["ana.pop@example.test", "Ana Pop", "+40 700", TOKEN_ONE]) expect(logged).not.toContain(secret);
    });
});

describe("admin slot move", () => {
    it("E7 keeps the id and the tokens; the store gets the admin actor, the target and the rev; a new link token for the `moved` mail; the answer carries the rev after the mint; no audit", async () => {
        const before = confirmedSlot();
        seedBooking({ id: before.id, resourceId: "res1", s: (before.what as any).start, e: (before.what as any).end, name: "Ana Pop" });
        const s2 = Date.parse("2026-12-14T08:00:00Z");
        const moved = { ...before, rev: 2, what: { ...before.what, resourceId: "res2", start: s2, end: s2 + HOUR } } as Booking;
        const minted = { ...moved, rev: 3, tokenHashes: [...before.tokenHashes, sha(TOKEN_TWO)] } as Booking;
        h.move.mockResolvedValueOnce({ ok: true, value: moved });
        h.mint.mockResolvedValueOnce({ ok: true, value: { booking: minted, token: TOKEN_TWO } });
        const res = await call(moveSlotRoute, { path: { bookingId: before.id }, body: { start: "2026-12-14T08:00:00.000Z", resourceId: "res2", rev: 1 } });
        expect(res.statusCode).toBe(200);
        expect(res.json).toMatchObject({ id: before.id, rev: 3, what: { kind: "slot", resourceId: "res2", resourceName: "Dr. Popa", start: "2026-12-14T08:00:00.000Z" } });
        expect(h.move).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            tenantId: "t1", bookingId: before.id, start: s2, resourceIds: ["res2"], actor: { kind: "admin", email: "admin@t1.test" }, expectedRev: 1, now: NOW,
        }));
        expect(minted.tokenHashes).toContain(before.tokenHashes[0]); // the old link's token is still listed
        expect(h.sesSends).toHaveLength(1);
        expect(h.sesSends[0].Destination.ToAddresses).toEqual(["ana.pop@example.test"]);
        expect(h.sesSends[0].Message.Body.Text.Data).toContain(`https://clinic.example/_booking/manage#t=${TOKEN_TWO}`);
        expect(h.putEvents).toEqual([]);
    });

    it("E8 a stale rev → 409 stale (the rev the screen sent is passed through); other refusals; a seat booking → 400; unknown → 404", async () => {
        const b = confirmedSlot({ rev: 5 });
        seedBooking({ id: b.id, resourceId: "res1", s: (b.what as any).start, e: (b.what as any).end, rev: 5, name: "Ana Pop" });
        const body = { start: "2026-12-14T08:00:00.000Z", resourceId: "res1", rev: 4 };
        for (const [error, status, code] of [[{ kind: "stale" }, 409, "stale"], [{ kind: "notConfirmed" }, 409, "notConfirmed"],
            [{ kind: "slotTaken" }, 409, "slotTaken"], [{ kind: "resourceUnavailable" }, 409, "resourceUnavailable"],
            [{ kind: "notActive", state: "cancelled" }, 409, "notActive"], [{ kind: "notFound" }, 404, "notFound"], [{ kind: "busy" }, 503, "busy"]] as const) {
            h.move.mockResolvedValueOnce({ ok: false, error });
            const res = await call(moveSlotRoute, { path: { bookingId: b.id }, body });
            expect([res.statusCode, res.json.code]).toEqual([status, code]);
        }
        expect(h.move).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expectedRev: 4 }));
        expect(h.mint).not.toHaveBeenCalled();
        expect(h.sesSends).toEqual([]);
        h.move.mockClear();
        mem.put({ PK, SK: `BOOKING#${bid(0x62)}`, ...BookingSchema.parse({ ...b, id: bid(0x62), ref: refOf(bid(0x62)), what: { kind: "seat", courseId: "c1", runId: "r1" },
            history: [{ action: "created", at: NOW, state: "confirmed", placement: { kind: "seat", runId: "r1" } }] }) });
        expect((await call(moveSlotRoute, { path: { bookingId: bid(0x62) }, body })).statusCode).toBe(400);
        expect((await call(moveSlotRoute, { path: { bookingId: bid(0x63) }, body })).statusCode).toBe(404);
        for (const bad of [{ ...body, rev: 0 }, { ...body, rev: "4" }, { start: body.start, resourceId: "res1" }, { ...body, extra: 1 }]) {
            expect((await call(moveSlotRoute, { path: { bookingId: b.id }, body: bad })).json.code).toBe("invalid");
        }
        expect(h.move).not.toHaveBeenCalled();
    });

    it("a mint refusal or a mail failure: logged with the id only, the move stands (200 with the moved booking)", async () => {
        const b = confirmedSlot();
        seedBooking({ id: b.id, resourceId: "res1", s: (b.what as any).start, e: (b.what as any).end, name: "Ana Pop" });
        h.move.mockResolvedValue({ ok: true, value: { ...b, rev: 2 } });
        h.mint.mockResolvedValueOnce({ ok: false, error: { kind: "linkNotIssued" } });
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const r1 = await call(moveSlotRoute, { path: { bookingId: b.id }, body: { start: "2026-12-14T08:00:00.000Z", resourceId: "res1", rev: 1 } });
        expect([r1.statusCode, r1.json.rev]).toEqual([200, 2]);
        h.mint.mockResolvedValueOnce({ ok: true, value: { booking: { ...b, rev: 3 }, token: TOKEN_TWO } });
        h.sesFail.on = true;
        const r2 = await call(moveSlotRoute, { path: { bookingId: b.id }, body: { start: "2026-12-14T08:00:00.000Z", resourceId: "res1", rev: 1 } });
        expect([r2.statusCode, r2.json.rev]).toEqual([200, 3]);
        const logged = JSON.stringify(err.mock.calls);
        err.mockRestore();
        expect(logged).toContain(b.id);
        for (const secret of ["ana.pop@example.test", "Ana Pop", TOKEN_TWO]) expect(logged).not.toContain(secret);
    });

    it("both booking routes: no time zone → 409 timezoneNotSet; a broken stored setting → 500 storedDataInvalid; neither reaches the store", async () => {
        const manual = { serviceId: "svc1", resourceId: "res1", start: "2026-12-07T07:00:00.000Z", who: WHO, channel: "phone" };
        const move = { start: "2026-12-14T08:00:00.000Z", resourceId: "res1", rev: 1 };
        tenantRecord!.scheduling = undefined;
        expect((await call(manualRoute, { body: manual })).json.code).toBe("timezoneNotSet");
        expect((await call(moveSlotRoute, { path: { bookingId: bid(0x61) }, body: move })).json.code).toBe("timezoneNotSet");
        tenantRecord!.scheduling = { timezone: "Europe/Bucharest", holdMinutes: "30" };
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await call(manualRoute, { body: manual })).json.code).toBe("storedDataInvalid");
        expect((await call(moveSlotRoute, { path: { bookingId: bid(0x61) }, body: move })).json.code).toBe("storedDataInvalid");
        err.mockRestore();
        expect(h.create).not.toHaveBeenCalled();
        expect(h.move).not.toHaveBeenCalled();
    });

    it("a caller without an email cannot act on a booking (403)", async () => {
        const noEmail = { sub: "k1", role: "TENANT_ADMIN", tenantId: "t1" };
        expect((await call(manualRoute, { auth: noEmail, body: { serviceId: "svc1", resourceId: "res1", start: "2026-12-07T07:00:00.000Z", who: WHO, channel: "phone" } })).statusCode).toBe(403);
        expect((await call(moveSlotRoute, { auth: noEmail, path: { bookingId: bid(0x61) }, body: { start: "2026-12-14T08:00:00.000Z", resourceId: "res1", rev: 1 } })).statusCode).toBe(403);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// E25 — the three interval consumers on the C35 (3) items
// ---------------------------------------------------------------------------------------------------------------

describe("E25 interval consumers", () => {
    const s = Date.parse("2026-12-06T23:30:00Z"); // local 2026-12-07 01:30
    const A = bid(0xa), B = bid(0xb), C = bid(0xc), D = bid(0xd);
    function seedC35(): void {
        mem.put({ PK, SK: "RESDAY#res1#2026-12-06", v: 4, entries: {
            [C]: { s, e: s + HOUR, x: NOW + HOUR, rev: 3 },     // (c) held copy
            [D]: { s: s - 3 * HOUR, e: s - 2 * HOUR, rev: 5 },  // (d) old placement
            [B]: { s, e: s + HOUR, x: NOW + HOUR, rev: 2 },     // (e) B held copy
            [A]: { s: s - HOUR, e: s + HOUR, rev: 7 },          // (e) A
        } });
        mem.put({ PK, SK: "RESDAY#res1#2026-12-07", v: 2, entries: {
            [C]: { s, e: s + HOUR, rev: 4 },                     // (c) confirmed copy
            [D]: { s: s + 2 * HOUR, e: s + 3 * HOUR, rev: 6 },  // (d) new placement
            [B]: { s, e: s + HOUR, rev: 3 },                     // (e) B confirmed during the read
            [A]: { s: s - HOUR, e: s + HOUR, rev: 7 },
        } });
        for (const [id, name] of [[A, "Person A"], [B, "Person B"], [C, "Person C"], [D, "Person D"]]) {
            const b = BookingSchema.parse({
                id, ref: refOf(id), rev: 9, what: { kind: "slot", serviceId: "svc1", serviceName: "Consultation", resourceId: "res1", start: s, end: s + HOUR },
                state: { kind: "confirmed", at: NOW }, source: { kind: "visitor" }, who: { email: "p@example.test", name }, tokenHashes: [],
                createdAt: NOW, updatedAt: NOW, history: [{ action: "created", at: NOW, state: "confirmed", placement: { kind: "slot", resourceId: "res1", start: s, end: s + HOUR } }],
            });
            mem.put({ PK, SK: `BOOKING#${id}`, ...b });
        }
    }
    const resdayQueries = () => mem.ops("QueryCommand").filter((q) => String(q.ExpressionAttributeValues[":lo"] ?? q.ExpressionAttributeValues[":p"]).startsWith("RESDAY#"));
    const expectA25 = (entries: { bookingId: string; start: string; state: string }[]) => {
        const byId = Object.fromEntries(entries.map((e) => [e.bookingId, e]));
        expect(entries.map((e) => e.bookingId).sort()).toEqual([A, B, C, D].sort()); // each once
        expect(byId[C].state).toBe("confirmed");                                    // (c) the rev 4 copy
        expect(byId[D].start).toBe(new Date(s + 2 * HOUR).toISOString());           // (d) the new placement only
        expect(byId[B].state).toBe("confirmed");                                    // (e) B at rev 3
        expect(byId[A].start).toBe(new Date(s - HOUR).toISOString());               // (e) A unaffected
    };

    it("planner week: the A25 (c), (d), (e) results; one RESDAY# Query, sent by readIntervals", async () => {
        seedC35();
        const res = await week("res1", "2026-12-07");
        expect(res.statusCode).toBe(200);
        const all = res.json.days.flatMap((d: any) => d.entries);
        const unique = [...new Map(all.map((e: any) => [e.bookingId, e])).values()] as any[];
        expectA25(unique);
        expect(dayOf(res.json, "2026-12-07").entries.map((e: any) => e.bookingId).sort()).toEqual([A, B, C, D].sort());
        expect([resdayQueries().length, h.readIntervalsCalls.n]).toEqual([1, 1]);
    });

    it("all-resource appointments: the A25 results; one RESDAY# Query per resource, each sent by readIntervals", async () => {
        seedC35();
        const res = await call(appointmentsRoute, { query: { from: "2026-12-06", to: "2026-12-07" } });
        expect(res.statusCode).toBe(200);
        const r1 = res.json.resources.find((r: any) => r.resourceId === "res1");
        expectA25(r1.entries);
        expect([resdayQueries().length, h.readIntervalsCalls.n]).toEqual([2, 2]); // res1 and res2
    });

    it("day-edit answer: A, B, C, D once each in outsideHours (refs); one RESDAY# Query, sent by readIntervals", async () => {
        seedC35();
        const res = await days("res1", { from: "2026-12-06", to: "2026-12-07", value: { kind: "dayOff" } });
        expect(res.statusCode).toBe(200);
        expect([...res.json.outsideHours].sort()).toEqual([A, B, C, D].map(refOf).sort());
        expect([resdayQueries().length, h.readIntervalsCalls.n]).toEqual([1, 1]);
    });

    it("no appt-*.ts file can send a DynamoDB request of its own: no client import, no QueryCommand (source scan: zero)", () => {
        const dir = join(__dirname, "../../src/scheduling/admin");
        const files = readdirSync(dir).filter((f) => f.startsWith("appt-") && f.endsWith(".ts"));
        expect(files.length).toBe(13);
        for (const f of files) {
            const src = readFileSync(join(dir, f), "utf8");
            expect({ f, query: /QueryCommand|@aws-sdk\/lib-dynamodb|@aws-sdk\/client-dynamodb|lib\/db\.js/.test(src) }).toEqual({ f, query: false });
        }
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Access (§ 10.3: E+T on every route of sched-1e; GLOBAL_ADMIN passes; another tenant's admin → 403)
// ---------------------------------------------------------------------------------------------------------------

describe("access", () => {
    const routes: [string, any, Record<string, any>][] = [
        ["services list", listServicesRoute, {}],
        ["services create", createServiceRoute, { body: { name: "A", durationMin: 30, eligibility: { kind: "all" } } }],
        ["services update", updateServiceRoute, { path: { serviceId: "svc1" }, body: { name: "A", durationMin: 30, eligibility: { kind: "all" } } }],
        ["services delete", deleteServiceRoute, { path: { serviceId: "svc1" } }],
        ["availability get", getAvailabilityRoute, { path: { resourceId: "res1" } }],
        ["availability put", putAvailabilityRoute, { path: { resourceId: "res1" }, body: { rules: [] } }],
        ["week", weekRoute, { path: { resourceId: "res1" }, query: { start: "2026-12-07" } }],
        ["days", daysRoute, { path: { resourceId: "res1" }, body: { from: "2026-12-07", to: "2026-12-07", value: { kind: "dayOff" } } }],
        ["copy-week", copyWeekRoute, { path: { resourceId: "res1" }, body: { sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks: 1 } }],
        ["appointments", appointmentsRoute, { query: { from: "2026-12-07", to: "2026-12-07" } }],
    ];

    it("another tenant's admin → 403 forbidden on all twelve routes, nothing read or written; EDITOR and GLOBAL_ADMIN pass", async () => {
        const all = [...routes,
            ["manual", manualRoute, { body: { serviceId: "svc1", resourceId: "res1", start: "2026-12-07T07:00:00.000Z", who: WHO, channel: "phone" } }],
            ["move-slot", moveSlotRoute, { path: { bookingId: bid(0x61) }, body: { start: "2026-12-14T08:00:00.000Z", resourceId: "res1", rev: 1 } }],
        ] as [string, any, Record<string, any>][];
        expect(all).toHaveLength(12);
        for (const [name, route, opts] of all) {
            const res = await call(route, { ...opts, auth: OTHER_TENANT_ADMIN });
            expect({ name, status: res.statusCode, code: res.json.code }).toEqual({ name, status: 403, code: "forbidden" });
        }
        expect(mem.calls).toEqual([]);
        for (const auth of [EDITOR, GLOBAL]) {
            seedService("svc1", "Consultation", 60); // the delete of the previous role removed it
            for (const [name, route, opts] of routes) {
                const res = await call(route, { ...opts, auth });
                expect({ name, role: auth.role, ok: res.statusCode < 300 }).toEqual({ name, role: auth.role, ok: true });
            }
        }
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Review-0 findings (iteration 1): one test per finding
// ---------------------------------------------------------------------------------------------------------------

describe("review-0 corrections", () => {
    const MANUAL_BODY = { serviceId: "svc1", resourceId: "res1", start: "2026-12-07T07:00:00.000Z", who: WHO, channel: "phone" };
    /** The eight routes of sched-1e that write, each with a body that passes validation. */
    const WRITERS: [string, any, Record<string, any>][] = [
        ["services create", createServiceRoute, { body: { name: "A", durationMin: 30, eligibility: { kind: "all" } } }],
        ["services update", updateServiceRoute, { path: { serviceId: "svc1" }, body: { name: "A", durationMin: 30, eligibility: { kind: "all" } } }],
        ["services delete", deleteServiceRoute, { path: { serviceId: "svc1" } }],
        ["availability put", putAvailabilityRoute, { path: { resourceId: "res1" }, body: { rules: [] } }],
        ["days", daysRoute, { path: { resourceId: "res1" }, body: { from: "2026-12-07", to: "2026-12-07", value: { kind: "dayOff" } } }],
        ["copy-week", copyWeekRoute, { path: { resourceId: "res1" }, body: { sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks: 1 } }],
        ["manual", manualRoute, { body: MANUAL_BODY }],
        ["move-slot", moveSlotRoute, { path: { bookingId: bid(0x61) }, body: { start: "2026-12-14T08:00:00.000Z", resourceId: "res1", rev: 1 } }],
    ];
    const BAD: [string, Record<string, unknown>][] = [
        ["scheduling.timezone malformed", { scheduling: { timezone: "Mars/Olympus" } }],
        ["scheduling.bookingHorizonWeeks 0", { scheduling: { timezone: "Europe/Bucharest", bookingHorizonWeeks: 0 } }],
        ["schedulingEmailConfig malformed", { schedulingEmailConfig: { templates: "x" } }],
    ];

    it("S1E1-R01 every writing route: a malformed stored scheduling setting or mail configuration → 500 storedDataInvalid; no write, no store transaction, no audit, no mail; the tenant read is consistent", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        for (const [name, route, opts] of WRITERS) {
            for (const [bad, patch] of BAD) {
                tenantRecord = { ...structuredClone(TENANT_RECORD), ...structuredClone(patch) };
                const writesBefore = mem.calls.filter((c) => c.op === "PutCommand" || c.op === "DeleteCommand").length;
                h.ddbSend.mockClear();
                const res = await call(route, opts);
                expect({ name, bad, status: res.statusCode, code: res.json.code }).toEqual({ name, bad, status: 500, code: "storedDataInvalid" });
                expect({ name, bad, writes: mem.calls.filter((c) => c.op === "PutCommand" || c.op === "DeleteCommand").length - writesBefore })
                    .toEqual({ name, bad, writes: 0 });
                const tenantGet = h.ddbSend.mock.calls.map((c) => c[0].input).find((i: any) => i.Key?.SK === "TENANT#t1");
                expect({ name, consistent: tenantGet?.ConsistentRead }).toEqual({ name, consistent: true });
            }
        }
        err.mockRestore();
        expect(h.create).not.toHaveBeenCalled();
        expect(h.move).not.toHaveBeenCalled();
        expect(h.mint).not.toHaveBeenCalled();
        expect(h.putEvents).toEqual([]);
        expect(h.sesSends).toEqual([]);
        expect(mem.get(PK, "SERVICE#svc1")).toBeDefined();                 // the delete did not run
    });

    it("S1E1-R02 the service bound: a CONSISTENT count; 199 existing → 201, 200 existing → 400 invalid", async () => {
        for (let i = 2; i <= 199; i++) seedService(`svc${i}`, `Service ${i}`, 30);   // svc1 + 198 = 199
        const ok = await call(createServiceRoute, { body: { name: "The 200th", durationMin: 30, eligibility: { kind: "all" } } });
        expect(ok.statusCode).toBe(201);
        const over = await call(createServiceRoute, { body: { name: "The 201st", durationMin: 30, eligibility: { kind: "all" } } });
        expect([over.statusCode, over.json.code]).toEqual([400, "invalid"]);
        const counts = mem.ops("QueryCommand").filter((q) => q.ExpressionAttributeValues[":p"] === "SERVICE#");
        expect(counts.map((q) => q.ConsistentRead)).toEqual([true, true]);
        expect(mem.ops("PutCommand").filter((p) => String(p.Item.SK).startsWith("SERVICE#"))).toHaveLength(1);
    });

    it("S1E1-R03 a delete that commits while an update runs: the update answers 404, the service stays deleted, no update audit", async () => {
        mem.beforePut = { sk: "SERVICE#svc1", run: async () => { expect((await call(deleteServiceRoute, { path: { serviceId: "svc1" } })).statusCode).toBe(204); } };
        const res = await call(updateServiceRoute, { path: { serviceId: "svc1" }, body: { name: "Renamed", durationMin: 30, eligibility: { kind: "all" } } });
        expect([res.statusCode, res.json.code]).toEqual([404, "notFound"]);
        expect(mem.get(PK, "SERVICE#svc1")).toBeUndefined();
        expect(auditEvents().map((e) => e.detail.action)).toEqual(["DELETE_SCHEDULING_SERVICE"]);
        expect(mem.ops("PutCommand").at(-1).ConditionExpression).toBe("attribute_exists(SK)");
    });

    it("S1E1-R04 day edit and copy-week: a stored interval item that fails its schema after the commit → 500, the edit stands, and its ONE audit event was sent", async () => {
        mem.put({ PK, SK: "RESDAY#res1#2026-12-07", v: 1, entries: { [bid(0x71)]: { s: Date.parse("2026-12-07T07:00:00Z"), e: Date.parse("2026-12-07T08:00:00Z") } } }); // no rev
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const edit = await days("res1", { from: "2026-12-07", to: "2026-12-07", value: { kind: "dayOff" } });
        const copy = await copyWeek("res1", { sourceStart: "2026-11-30", targetStart: "2026-12-07", weeks: 1 });
        err.mockRestore();
        expect([edit.statusCode, edit.json.code]).toEqual([500, "storedDataInvalid"]);
        expect([copy.statusCode, copy.json.code]).toEqual([500, "storedDataInvalid"]);
        expect(mem.get(PK, "DAYS#res1")!.v).toBe(2);                         // both edits committed
        expect(auditEvents().map((e) => [e.detail.action, e.detail.details.changedDates])).toEqual([
            ["EDIT_SCHEDULING_DAYS", 1], ["COPY_SCHEDULING_WEEK", 1],
        ]);
    });

    it("S1E1-R05 a move that commits between ours and the mint: the answer names the resource of the booking it describes", async () => {
        seedResource("res3", "Dr. Three");
        const b = confirmedSlot();
        const s2 = Date.parse("2026-12-14T08:00:00Z");
        const ours = { ...b, rev: 2, what: { ...b.what, resourceId: "res2", start: s2, end: s2 + HOUR } } as Booking;
        const theirs = { ...b, rev: 4, what: { ...b.what, resourceId: "res3", start: s2, end: s2 + HOUR }, tokenHashes: [...b.tokenHashes, sha(TOKEN_TWO)] } as Booking;
        mem.put({ PK, SK: `BOOKING#${b.id}`, ...b });
        h.move.mockResolvedValueOnce({ ok: true, value: ours });
        h.mint.mockResolvedValueOnce({ ok: true, value: { booking: theirs, token: TOKEN_TWO } });
        const res = await call(moveSlotRoute, { path: { bookingId: b.id }, body: { start: "2026-12-14T08:00:00.000Z", resourceId: "res2", rev: 1 } });
        expect(res.statusCode).toBe(200);
        expect(res.json).toMatchObject({ rev: 4, what: { resourceId: "res3", resourceName: "Dr. Three" } });
        // Positive control: the mint returns the booking on our target → the name read before the write is reused.
        h.move.mockResolvedValueOnce({ ok: true, value: ours });
        h.mint.mockResolvedValueOnce({ ok: true, value: { booking: { ...ours, rev: 3 }, token: TOKEN_TWO } });
        const same = await call(moveSlotRoute, { path: { bookingId: b.id }, body: { start: "2026-12-14T08:00:00.000Z", resourceId: "res2", rev: 1 } });
        expect(same.json).toMatchObject({ rev: 3, what: { resourceId: "res2", resourceName: "Dr. Popa" } });
    });
});
