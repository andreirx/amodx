import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BookingSchema, type Booking } from "@amodx/shared";

/**
 * SCHED-1F1 — the group admin routes of `sched-1f` (docs/slices/sched-1.md § 10.3, § 17.3 rows F1-F9; backend parts).
 * Credential-free: `npm run test:unit`.
 *
 * REAL: the eleven handlers, `requireRole`, `events.ts`, `scheduling-email.ts`, `visitor/mail.ts`, the kernel, and EVERY
 * function of `scheduling-db.ts` — reads AND transactions (`createRun`, `updateRun`, `moveRun`, `cancelRun`,
 * `createManualSeat`, `moveSeat`, `mintToken`) — on `MemTable`, an in-memory table that answers Get / Query (with
 * `Limit`) / BatchGet / Put / Delete / TransactWrite and evaluates the subset of update and condition expressions the
 * store sends (SET, REMOVE, ADD; AND of `=`, `<>`, `attribute_exists`, `attribute_not_exists`). Transactions are
 * all-or-nothing, report `ConditionalCheckFailed` by item position, and refuse two actions on one item
 * (`ValidationException`), as DynamoDB does. One-shot `before` hooks place a concurrent write at an exact request
 * (the interleavings of review-0).
 * REPLACED: the main-table client (the tenant record), the AWS clients of EventBridge and SES (they record every
 * `PutEvents` and `SendEmail`). `mintToken` can be made to fail for one test (`h.mintFail`).
 * Concurrency rows of the store (versions, retries, interleavings) are rows C… of `sched-1c` (scheduling-db.test.ts,
 * FakeTable); here the rows prove what the ROUTES do with the store.
 * Test-only duplication (recorded): MemTable is a smaller sibling of FakeTable in scheduling-db.test.ts, which is not
 * exported and outside this slice's allocation.
 */

const h = vi.hoisted(() => {
    process.env.EVENT_BUS_NAME = "test-bus";
    process.env.SCHEDULING_TABLE_NAME = "sched-table";
    process.env.SES_FROM_EMAIL = "noreply@amodx.test";
    process.env.RENDERER_CLOUDFRONT_ORIGIN = "https://d1.cloudfront.net";
    return {
        ddbSend: vi.fn(),
        putEvents: [] as any[],
        sesSends: [] as any[],
        sesFail: { on: false },
        mem: { current: undefined as any },
        mintFail: { on: false },
    };
});

vi.mock("../../src/lib/db.js", () => ({ db: { send: h.ddbSend }, TABLE_NAME: "main-table" }));
// Row F6 (review S1F1-R05) runs the REAL visitor hold route; its reCAPTCHA check is replaced by a passing one.
vi.mock("../../src/lib/recaptcha.js", () => ({
    resolveRecaptchaConfig: () => ({ secretKey: "test-secret", threshold: 0.5, source: "test" }),
    verifyRecaptcha: async () => ({ success: true, score: 0.9 }),
}));
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
        mintToken: (...args: Parameters<typeof real.mintToken>) => {
            if (h.mintFail.on) throw Object.assign(new Error("ProvisionedThroughputExceededException"), { name: "ProvisionedThroughputExceededException" });
            return real.mintToken(...args);
        },
        schedulingStoreFromEnv: () => ({ db: h.mem.current, table: "sched-table", sleep: async () => {} }),
    };
});

import { handler as listCoursesRoute } from "../../src/scheduling/admin/group-courses-list.js";
import { handler as deleteCourseRoute } from "../../src/scheduling/admin/group-courses-delete.js";
import { handler as listRunsRoute } from "../../src/scheduling/admin/group-runs-list.js";
import { handler as createRunRoute } from "../../src/scheduling/admin/group-runs-create.js";
import { handler as updateRunRoute } from "../../src/scheduling/admin/group-runs-update.js";
import { handler as moveRunRoute } from "../../src/scheduling/admin/group-runs-move.js";
import { handler as cancelRunRoute } from "../../src/scheduling/admin/group-runs-cancel.js";
import { handler as rosterRoute } from "../../src/scheduling/admin/group-roster.js";
import { handler as unplacedRoute } from "../../src/scheduling/admin/group-unplaced.js";
import { handler as seatsRoute } from "../../src/scheduling/admin/group-seats-create.js";
import { handler as moveSeatRoute } from "../../src/scheduling/admin/group-move-seat.js";
import { handler as createCourseRoute } from "../../src/scheduling/admin/group-courses-create.js";
import { handler as updateCourseRoute } from "../../src/scheduling/admin/group-courses-update.js";
import { handler as holdRoute } from "../../src/scheduling/visitor/holds.js";
import * as sdb from "../../src/lib/scheduling-db.js";
import { getBookingByToken } from "../../src/lib/scheduling-db.js";

// ---------------------------------------------------------------------------------------------------------------
// MemTable
// ---------------------------------------------------------------------------------------------------------------

type Item = Record<string, any>;
const fail = (name: string) => Object.assign(new Error(name), { name });

class MemTable {
    items = new Map<string, Item>();
    calls: { op: string; input: any }[] = [];
    /** One-shot hooks run BEFORE the first matching command is answered (interleavings of reviews S1F1-R01, R02, R04). */
    hooks: { op: string; when: (input: any) => boolean; run: () => Promise<unknown> | unknown }[] = [];
    before(op: string, when: (input: any) => boolean, run: () => Promise<unknown> | unknown): void { this.hooks.push({ op, when, run }); }

    put(item: Item): void { this.items.set(`${item.PK}|${item.SK}`, structuredClone(item)); }
    get(pk: string, sk: string): Item | undefined { return this.items.get(`${pk}|${sk}`); }
    ops(op: string): any[] { return this.calls.filter((c) => c.op === op).map((c) => c.input); }
    sks(prefix: string): string[] { return [...this.items.values()].map((i) => i.SK as string).filter((sk) => sk.startsWith(prefix)).sort(); }

    private project(item: Item, input: any): Item {
        if (!input.ProjectionExpression) return structuredClone(item);
        const names: Record<string, string> = input.ExpressionAttributeNames ?? {};
        const out: Item = {};
        for (const path of String(input.ProjectionExpression).split(",").map((p) => p.trim())) {
            const segs = path.split(".").map((s) => (s.startsWith("#") ? names[s] : s));
            let from: any = item;
            let to: any = out;
            for (let i = 0; i < segs.length; i++) {
                if (from === undefined || from === null) break;
                if (i === segs.length - 1) { if (from[segs[i]] !== undefined) to[segs[i]] = structuredClone(from[segs[i]]); break; }
                from = from[segs[i]];
                to = (to[segs[i]] ??= {});
            }
        }
        return out;
    }

    private path(expr: string, names: Record<string, string>): string[] {
        return expr.trim().split(".").map((s) => (s.startsWith("#") ? names[s] : s));
    }
    private read(item: Item | undefined, segs: string[]): any {
        let v: any = item;
        for (const s of segs) v = v?.[s];
        return v;
    }
    /** AND of `attribute_exists(p)`, `attribute_not_exists(p)`, `p = :v`, `p <> :v` (the store's update/check conditions). */
    private holds(item: Item | undefined, cond: string | undefined, names: Record<string, string>, values: Record<string, any>): boolean {
        if (!cond) return true;
        // `a OR b` (the store's limit counter: `attribute_not_exists(SK) OR #c < :max`): any alternative holds.
        if (cond.includes(" OR ")) return cond.split(" OR ").some((alt) => this.holds(item, alt, names, values));
        return cond.split(" AND ").every((c) => {
            let m = /^attribute_exists\((.+)\)$/.exec(c.trim());
            if (m) return this.read(item, this.path(m[1], names)) !== undefined;
            m = /^attribute_not_exists\((.+)\)$/.exec(c.trim());
            if (m) return this.read(item, this.path(m[1], names)) === undefined;
            m = /^(.+?) (=|<>|<) (:\w+)$/.exec(c.trim());
            if (!m) throw new Error(`MemTable: unsupported condition ${c}`);
            if (m[2] === "<") return this.read(item, this.path(m[1], names)) < values[m[3]];
            const equal = JSON.stringify(this.read(item, this.path(m[1], names))) === JSON.stringify(values[m[3]]);
            return m[2] === "=" ? equal : !equal;
        });
    }
    private applyUpdate(before: Item | undefined, key: Item, expr: string, names: Record<string, string>, values: Record<string, any>): Item {
        const next: Item = structuredClone(before ?? key);
        const add = /^(?:SET (.+) )?ADD (\S+) (:\w+)$/.exec(expr);
        if (add) {
            const withSet = add[1] === undefined ? next : this.applyUpdate(next, key, `SET ${add[1]}`, names, values);
            const attr = this.path(add[2], names)[0];
            withSet[attr] = (withSet[attr] ?? 0) + values[add[3]];
            return withSet;
        }
        const m = /^SET (.+?)(?: REMOVE (.+))?$/.exec(expr) ?? /^()REMOVE (.+)$/.exec(expr);
        if (!m) throw new Error(`MemTable: unsupported update ${expr}`);
        for (const clause of (m[1] ?? "").split(", ").filter(Boolean)) {
            const [lhs, rhs] = clause.split(" = ");
            if (!/^:\w+$/.test(rhs.trim())) throw new Error(`MemTable: unsupported SET ${clause}`);
            const segs = this.path(lhs, names);
            let at: any = next;
            for (const s of segs.slice(0, -1)) at = (at[s] ??= {});
            at[segs[segs.length - 1]] = structuredClone(values[rhs.trim()]);
        }
        for (const p of (m[2] ?? "").split(", ").filter(Boolean)) {
            const segs = this.path(p, names);
            const parent = this.read(next, segs.slice(0, -1));
            if (parent) delete parent[segs[segs.length - 1]];
        }
        return next;
    }

    async send(cmd: any): Promise<any> {
        const op = cmd.constructor.name as string;
        const input = cmd.input;
        const hook = this.hooks.findIndex((x) => x.op === op && x.when(input));
        if (hook >= 0) await this.hooks.splice(hook, 1)[0].run();
        this.calls.push({ op, input });
        switch (op) {
            case "GetCommand": {
                const item = this.get(input.Key.PK, input.Key.SK);
                return { Item: item === undefined ? undefined : structuredClone(item) };
            }
            case "QueryCommand": {
                const v = input.ExpressionAttributeValues;
                const cond = String(input.KeyConditionExpression);
                const match = (sk: string) => cond.includes("begins_with") ? sk.startsWith(v[":p"]) : sk >= v[":lo"] && sk <= v[":hi"];
                let items = [...this.items.values()].filter((i) => i.PK === v[":pk"] && match(i.SK))
                    .sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
                if (input.ExclusiveStartKey) items = items.filter((i) => i.SK > input.ExclusiveStartKey.SK);
                let last: Item | undefined;
                if (input.Limit !== undefined && items.length > input.Limit) {
                    items = items.slice(0, input.Limit);
                    last = { PK: items[items.length - 1].PK, SK: items[items.length - 1].SK };
                }
                return { Items: items.map((i) => this.project(i, input)), ...(last ? { LastEvaluatedKey: last } : {}) };
            }
            case "BatchGetCommand": {
                const table = Object.keys(input.RequestItems)[0];
                const req = input.RequestItems[table];
                const found = req.Keys.map((k: any) => this.get(k.PK, k.SK)).filter((i: any) => i !== undefined);
                return { Responses: { [table]: found.map((i: any) => this.project(i, req)) } };
            }
            case "PutCommand": {
                if (!this.holds(this.get(input.Item.PK, input.Item.SK), input.ConditionExpression, input.ExpressionAttributeNames ?? {}, input.ExpressionAttributeValues ?? {})) {
                    throw fail("ConditionalCheckFailedException");
                }
                this.put(input.Item);
                return {};
            }
            case "DeleteCommand": {
                if (!this.holds(this.get(input.Key.PK, input.Key.SK), input.ConditionExpression, input.ExpressionAttributeNames ?? {}, input.ExpressionAttributeValues ?? {})) {
                    throw fail("ConditionalCheckFailedException");
                }
                this.items.delete(`${input.Key.PK}|${input.Key.SK}`);
                return {};
            }
            case "UpdateCommand": {
                const before = this.get(input.Key.PK, input.Key.SK);
                if (!this.holds(before, input.ConditionExpression, input.ExpressionAttributeNames ?? {}, input.ExpressionAttributeValues ?? {})) {
                    throw fail("ConditionalCheckFailedException");
                }
                this.put(this.applyUpdate(before, input.Key, input.UpdateExpression, input.ExpressionAttributeNames ?? {}, input.ExpressionAttributeValues ?? {}));
                return {};
            }
            case "TransactWriteCommand": {
                // DynamoDB refuses a transaction that names one item twice (review S1F1-R03), before any condition.
                const targets = input.TransactItems.map((t: any) => {
                    const [kind, body] = Object.entries(t)[0] as [string, any];
                    const k = kind === "Put" ? body.Item : body.Key;
                    return `${k.PK}|${k.SK}`;
                });
                if (new Set(targets).size !== targets.length) {
                    throw fail("ValidationException"); // "Transaction request cannot include multiple operations on one item"
                }
                const plans = input.TransactItems.map((t: any) => {
                    const [kind, body] = Object.entries(t)[0] as [string, any];
                    const k = kind === "Put" ? { PK: body.Item.PK, SK: body.Item.SK } : body.Key;
                    const before = this.get(k.PK, k.SK);
                    const ok = this.holds(before, body.ConditionExpression, body.ExpressionAttributeNames ?? {}, body.ExpressionAttributeValues ?? {});
                    return { kind, body, k, before, ok };
                });
                if (plans.some((p: any) => !p.ok)) {
                    throw Object.assign(fail("TransactionCanceledException"), {
                        CancellationReasons: plans.map((p: any) => ({ Code: p.ok ? "None" : "ConditionalCheckFailed" })),
                    });
                }
                for (const p of plans) {
                    switch (p.kind) {
                        case "Put": this.put(p.body.Item); break;
                        case "Delete": this.items.delete(`${p.k.PK}|${p.k.SK}`); break;
                        case "ConditionCheck": break;
                        case "Update": this.put(this.applyUpdate(p.before, p.k, p.body.UpdateExpression, p.body.ExpressionAttributeNames ?? {}, p.body.ExpressionAttributeValues ?? {})); break;
                        default: throw new Error(`MemTable: unsupported transact item ${p.kind}`);
                    }
                }
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
const PK = "TENANT#t1";
const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const EDITOR = { sub: "u2", email: "editor@t1.test", role: "EDITOR", tenantId: "t1" };
const GLOBAL = { sub: "g1", email: "root@amodx.test", role: "GLOBAL_ADMIN", tenantId: "ALL" };
const OTHER_TENANT_ADMIN = { sub: "u3", email: "admin@t2.test", role: "TENANT_ADMIN", tenantId: "t2" };
const KEY_NO_EMAIL = { sub: "k1", role: "TENANT_ADMIN", tenantId: "t1" };
const TENANT_RECORD = {
    PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Atelier", domain: "atelier.example",
    schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" },
    integrations: { contactEmail: "owner@atelier.example" },
};
const GROUP_LINK = "https://chat.whatsapp.com/abc";
const DEC5 = [{ date: "2026-12-05", start: "10:00", end: "13:00" }, { date: "2026-12-06", start: "10:00", end: "13:00" }];
const DEC12 = [{ date: "2026-12-12", start: "10:00", end: "13:00" }, { date: "2026-12-13", start: "10:00", end: "13:00" }];

let mem: MemTable;
let tenantRecord: Item | undefined;
const bid = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

function seedCourse(id = "c1", name = "Pottery", languages = ["ro", "en"], defaultCapacity = 8, tenant = "t1"): void {
    mem.put({ PK: `TENANT#${tenant}`, SK: `COURSE#${id}`, id, name, defaultCapacity, languages });
}
function seedResource(id: string, name: string, extra: Item = {}): void { mem.put({ PK, SK: `RESOURCE#${id}`, id, name, ...extra }); }

function event(method: string, path: string, opts: { auth?: Item; body?: unknown; params?: Record<string, string>; query?: Record<string, string>; tenant?: string } = {}): any {
    return {
        rawPath: path,
        headers: { "x-tenant-id": opts.tenant ?? "t1" },
        pathParameters: opts.params ?? {},
        queryStringParameters: opts.query,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        requestContext: { authorizer: { lambda: opts.auth ?? TENANT_ADMIN }, http: { method, sourceIp: "203.0.113.9" } },
    };
}
async function call(handler: any, ev: any): Promise<{ status: number; body: any }> {
    const res = await handler(ev, {} as any, () => {});
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

const createRun = (body: unknown, course = "c1", auth: Item = TENANT_ADMIN) =>
    call(createRunRoute, event("POST", `/scheduling/admin/courses/${course}/runs`, { auth, body, params: { courseId: course } }));
const updateRun = (runId: string, body: unknown) =>
    call(updateRunRoute, event("PUT", `/scheduling/admin/courses/c1/runs/${runId}`, { body, params: { courseId: "c1", runId } }));
const moveRun = (runId: string, body: unknown) =>
    call(moveRunRoute, event("POST", `/scheduling/admin/courses/c1/runs/${runId}/move`, { body, params: { courseId: "c1", runId } }));
const cancelRun = (runId: string, auth: Item = TENANT_ADMIN) =>
    call(cancelRunRoute, event("POST", `/scheduling/admin/courses/c1/runs/${runId}/cancel`, { auth, body: {}, params: { courseId: "c1", runId } }));
const roster = (runId: string, course = "c1") =>
    call(rosterRoute, event("GET", `/scheduling/admin/courses/${course}/runs/${runId}/roster`, { params: { courseId: course, runId } }));
const unplaced = (query?: Record<string, string>, course = "c1") =>
    call(unplacedRoute, event("GET", `/scheduling/admin/courses/${course}/unplaced`, { params: { courseId: course }, query }));
const seat = (body: unknown, auth: Item = TENANT_ADMIN) => call(seatsRoute, event("POST", "/scheduling/admin/seats", { auth, body }));
const moveSeat = (bookingId: string, body: unknown) =>
    call(moveSeatRoute, event("POST", `/scheduling/admin/bookings/${bookingId}/move-seat`, { body, params: { bookingId } }));
const who = (email: string, name: string, language?: string) => ({ email, name, ...(language ? { language } : {}) });

/** A run made by the real route (201), its id returned. */
async function newRun(meetings = DEC5, extra: Item = {}): Promise<string> {
    const res = await createRun({ meetings, trainerIds: ["r1"], ...extra });
    expect(res.status).toBe(201);
    return res.body.id;
}
/** A confirmed manual seat made by the real route (201), its booking returned. */
async function newSeat(runId: string | undefined, email: string, name: string, language?: string): Promise<any> {
    const res = await seat({ courseId: "c1", ...(runId ? { runId } : {}), who: who(email, name, language), channel: "phone" });
    expect(res.status).toBe(201);
    return res.body;
}
/** A HELD seat written directly (a visitor hold through `holds.ts` needs reCAPTCHA): booking + seat entry with `x`. */
function seedHeldSeat(runId: string, n: number, email: string, name: string, x: number): string {
    const id = bid(n);
    const booking: Booking = BookingSchema.parse({
        id, ref: `B-${id.slice(0, 8).toUpperCase()}`, rev: 1,
        what: { kind: "seat", courseId: "c1", runId }, state: { kind: "held", expiresAt: x, mail: "sent" },
        source: { kind: "visitor" }, who: { email, name }, tokenHashes: [], heldUntil: x,
        createdAt: NOW - 60_000, updatedAt: NOW - 60_000,
        history: [{ action: "created", at: NOW - 60_000, state: "held", placement: { kind: "seat", runId } }],
    });
    mem.put({ PK, SK: `BOOKING#${id}`, ...booking });
    const run = mem.get(PK, `RUN#c1#${runId}`)!;
    run.seats[id] = { x };
    mem.put(run);
    return id;
}
const tokenOf = (mail: any): string => {
    const m = /#t=([A-Za-z0-9_-]{43})/.exec(mail.Message.Body.Text.Data);
    if (!m) throw new Error("no link in the mail");
    return m[1];
};
const mailsTo = (email: string) => h.sesSends.filter((s) => s.Destination.ToAddresses[0] === email);
const store = () => ({ db: mem, table: "sched-table", sleep: async () => {} });
const audits = () => h.putEvents.map((e) => JSON.parse(e.Entries[0].Detail));
const mailCount = () => h.sesSends.length;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    mem = new MemTable();
    h.mem.current = mem;
    tenantRecord = structuredClone(TENANT_RECORD);
    h.ddbSend.mockReset();
    h.ddbSend.mockImplementation(async (cmd: any) => {
        if (cmd.constructor.name === "GetCommand" && cmd.input.Key.SK === "TENANT#t1") return { Item: tenantRecord ? structuredClone(tenantRecord) : undefined };
        return {};
    });
    h.putEvents.length = 0;
    h.sesSends.length = 0;
    h.sesFail.on = false;
    h.mintFail.on = false;
    seedCourse();
    seedResource("r1", "Ana");
    seedResource("r2", "Ion");
});
afterEach(() => { vi.useRealTimers(); });

// ---------------------------------------------------------------------------------------------------------------

describe("courses (list, delete; create and update wait for the store ruling, notes-for-human.md)", () => {
    it("list sorted by name (CourseDTO only); delete → 204 with one audit event (the name, no ip); unknown → 404; another tenant's course → 404", async () => {
        seedCourse("c2", "Drawing", [], 10);
        seedCourse("c9", "Alien", [], 10, "t2");
        const list = await call(listCoursesRoute, event("GET", "/scheduling/admin/courses"));
        expect(list).toEqual({ status: 200, body: { courses: [
            { id: "c2", name: "Drawing", defaultCapacity: 10, languages: [] },
            { id: "c1", name: "Pottery", defaultCapacity: 8, languages: ["ro", "en"] },
        ] } });
        const del = (id: string) => call(deleteCourseRoute, event("DELETE", `/scheduling/admin/courses/${id}`, { params: { courseId: id } }));
        expect((await del("c9")).status).toBe(404);
        expect((await del("nope")).status).toBe(404);
        expect(await del("c2")).toEqual({ status: 204, body: undefined });
        expect(mem.get(PK, "COURSE#c2")).toBeUndefined();
        expect(audits()).toEqual([expect.objectContaining({ action: "DELETE_SCHEDULING_COURSE", actor: { id: "u1", email: "admin@t1.test" }, target: { id: "c2", title: "Drawing" } })]);
        expect(h.putEvents[0].Entries[0].Detail).not.toContain('"ip"');
    });

    it("delete refused with 409 courseInUse while a run exists, and while an unplaced booking exists; nothing deleted, no audit", async () => {
        const runId = await newRun();
        h.putEvents.length = 0;
        const del = () => call(deleteCourseRoute, event("DELETE", "/scheduling/admin/courses/c1", { params: { courseId: "c1" } }));
        expect((await del()).body.code).toBe("courseInUse");
        mem.items.delete(`${PK}|RUN#c1#${runId}`);
        await newSeat(undefined, "u@example.com", "Una");
        h.putEvents.length = 0;
        expect((await del()).body.code).toBe("courseInUse");
        expect(mem.get(PK, "COURSE#c1")).toBeDefined();
        expect(h.putEvents).toEqual([]);
    });
});

describe("runs: create, list, update", () => {
    it("create: 201 RunAdminDTO (course capacity, tenant zone, language notSet → null, meetings sorted); RUN# and RUNSPAN# written; ONE audit event with course name + first date, dates and counts, no ip", async () => {
        const res = await createRun({ meetings: [...DEC5].reverse(), trainerIds: ["r1", "r2"], groupLink: GROUP_LINK });
        expect(res.status).toBe(201);
        expect(res.body).toEqual({
            id: expect.any(String), courseId: "c1", meetings: DEC5, timezone: "Europe/Bucharest", capacity: 8, taken: 0, overCapacityBy: 0,
            trainerIds: ["r1", "r2"], language: null, groupLink: GROUP_LINK, status: "open",
            firstStart: "2026-12-05T08:00:00.000Z", lastEnd: "2026-12-06T11:00:00.000Z",
        });
        expect(mem.get(PK, `RUN#c1#${res.body.id}`)).toMatchObject({ v: 1, seats: {}, status: "open" });
        expect(mem.sks("RUNSPAN#")).toEqual([`RUNSPAN#2026-12-06T11:00:00.000Z#c1#${res.body.id}`]);
        expect(audits()).toEqual([expect.objectContaining({
            action: "CREATE_SCHEDULING_RUN", actor: { id: "u1", email: "admin@t1.test" },
            target: { id: res.body.id, title: "Pottery 2026-12-05" },
            details: { firstDate: "2026-12-05", lastDate: "2026-12-06", meetings: 2, capacity: 8 },
        })]);
        expect(h.putEvents[0].Entries[0].Detail).not.toContain('"ip"');
        // language and capacity given
        const ro = await createRun({ meetings: DEC12, trainerIds: ["r1"], capacity: 12, language: "ro" });
        expect(ro.body).toMatchObject({ capacity: 12, language: "ro" });
    });

    it("F1 invalid meetings → 400 with each MeetingError kind; trainerIds [] → 400; 11 trainers → 400; capacity 46 → 400 with the 45 text; nothing written", async () => {
        const kinds: [unknown[], string][] = [
            [[], "empty"],
            [[{ date: "2026-12-05", start: "10:00", end: "13:00" }, { date: "2026-12-06", start: "10:00", end: "09:00" }], "endNotAfterStart"],
            [[{ date: "2026-12-05", start: "10:00", end: "13:00" }, { date: "2026-12-05", start: "12:00", end: "14:00" }], "overlap"],
            [[{ date: "2027-03-28", start: "03:30", end: "05:00" }], "nonexistentLocalTime"],
            [Array.from({ length: 61 }, (_, i) => ({ date: `2027-01-${String((i % 28) + 1).padStart(2, "0")}`, start: `${String(Math.floor(i / 28) * 4 + 8).padStart(2, "0")}:00`, end: `${String(Math.floor(i / 28) * 4 + 9).padStart(2, "0")}:00` })), "tooMany"],
        ];
        for (const [meetings, kind] of kinds) {
            const res = await createRun({ meetings, trainerIds: ["r1"] });
            expect({ kind, status: res.status, code: res.body.code }).toEqual({ kind, status: 400, code: kind });
        }
        expect((await createRun({ meetings: DEC5, trainerIds: [] })).body).toMatchObject({ code: "invalid", issues: [{ path: "trainerIds.0" }] });
        expect((await createRun({ meetings: DEC5, trainerIds: Array.from({ length: 11 }, () => "r1") })).status).toBe(400);
        const big = await createRun({ meetings: DEC5, trainerIds: ["r1"], capacity: 46 });
        expect(big.status).toBe(400);
        expect(big.body.issues).toEqual([{ path: "capacity", message: "A group in this version holds at most 45 people." }]);
        expect((await createRun({ meetings: DEC5, trainerIds: ["r1"], capacity: 45 })).status).toBe(201);
        expect(mem.sks("RUN#")).toHaveLength(1);
    });

    it("create refusals: unknown course 404; language not offered 400; unknown trainer 400 with its path; trainer being removed 409 resourceUnavailable; no zone 409; malformed stored setting 500; unknown key 400; nothing written", async () => {
        expect((await createRun({ meetings: DEC5, trainerIds: ["r1"] }, "nope")).status).toBe(404);
        expect((await createRun({ meetings: DEC5, trainerIds: ["r1"], language: "de" })).body.issues).toEqual([{ path: "language", message: "Must be one of the course's languages." }]);
        expect((await createRun({ meetings: DEC5, trainerIds: ["r1", "ghost"] })).body.issues).toEqual([{ path: "trainerIds.1", message: "Unknown resource." }]);
        seedResource("r3", "Retiring", { retiring: { attemptId: "a", at: NOW } });
        expect((await createRun({ meetings: DEC5, trainerIds: ["r3"] })).body.code).toBe("resourceUnavailable");
        expect((await createRun({ meetings: DEC5, trainerIds: ["r1"], seats: {} })).status).toBe(400);
        tenantRecord!.scheduling = {};
        expect((await createRun({ meetings: DEC5, trainerIds: ["r1"] })).body.code).toBe("timezoneNotSet");
        tenantRecord!.scheduling = { timezone: "Not/AZone" };
        expect((await createRun({ meetings: DEC5, trainerIds: ["r1"] })).body.code).toBe("storedDataInvalid");
        expect(mem.sks("RUN")).toEqual([]);
        expect(h.putEvents).toEqual([]);
    });

    it("list: every run by first meeting; taken = active seats (an expired hold is not counted); no seat map or booking id in the JSON; unknown course 404", async () => {
        const late = await newRun(DEC12);
        const early = await newRun(DEC5);
        const a = await newSeat(early, "a@example.com", "Ana");
        seedHeldSeat(early, 0xb, "b@example.com", "Bob", NOW + 600_000);
        seedHeldSeat(early, 0xc, "c@example.com", "Cid", NOW - 1);
        const res = await call(listRunsRoute, event("GET", "/scheduling/admin/courses/c1/runs", { params: { courseId: "c1" } }));
        expect(res.body.runs.map((r: any) => [r.id, r.taken])).toEqual([[early, 2], [late, 0]]);
        const json = JSON.stringify(res.body);
        expect(json).not.toContain("seats");
        expect(json).not.toContain(a.id);
        expect((await call(listRunsRoute, event("GET", "/scheduling/admin/courses/nope/runs", { params: { courseId: "nope" } }))).status).toBe(404);
    });

    it("F6 capacity below taken → 200, overCapacityBy, nobody removed; a manual seat is then refused runFull; update audit (one event, no details, no ip); empty body / status cancelled / unknown language → 400; cancelled run → 409", async () => {
        const runId = await newRun(DEC5, { capacity: 3 });
        for (const [e, n] of [["a@example.com", "Ana"], ["b@example.com", "Bob"], ["c@example.com", "Cid"]]) await newSeat(runId, e, n);
        h.putEvents.length = 0;
        const res = await updateRun(runId, { capacity: 1 });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ capacity: 1, taken: 3, overCapacityBy: 2 });
        expect(Object.keys(mem.get(PK, `RUN#c1#${runId}`)!.seats)).toHaveLength(3);
        expect(audits()).toEqual([expect.objectContaining({ action: "UPDATE_SCHEDULING_RUN", tenantId: "t1", actor: { id: "u1", email: "admin@t1.test" }, target: { id: runId, title: "Pottery 2026-12-05" } })]);
        expect(audits()[0]).not.toHaveProperty("details");
        const full = await seat({ courseId: "c1", runId, who: who("d@example.com", "Dan"), channel: "phone" });
        expect(full).toEqual({ status: 409, body: expect.objectContaining({ code: "runFull", capacity: 1 }) });
        expect((await updateRun(runId, {})).status).toBe(400);
        expect((await updateRun(runId, { status: "cancelled" })).status).toBe(400);
        expect((await updateRun(runId, { language: "de" })).status).toBe(400);
        // the group link: set, then removed (D10)
        expect((await updateRun(runId, { groupLink: GROUP_LINK, status: "closed", language: "en" })).body).toMatchObject({ groupLink: GROUP_LINK, status: "closed", language: "en" });
        expect((await updateRun(runId, { groupLink: null, language: null })).body).not.toHaveProperty("groupLink");
        expect(mem.get(PK, `RUN#c1#${runId}`)!.groupLink).toBeUndefined();
        expect((await updateRun("nope", { capacity: 2 })).status).toBe(404);
        expect((await cancelRun(runId)).status).toBe(200);
        expect((await updateRun(runId, { capacity: 2 })).body.code).toBe("runCancelled");
    });
});

describe("roster and unplaced list", () => {
    it("F2 roster lists exactly the active seats (confirmed, held unexpired; not an expired hold, not an erased booking) with every RosterRow field; another tenant's run → 404", async () => {
        const runId = await newRun();
        const ana = await newSeat(runId, "ana@example.com", "Ana", "ro");
        const bob = seedHeldSeat(runId, 0xb, "bob@example.com", "Bob", NOW + 600_000);
        seedHeldSeat(runId, 0xc, "cid@example.com", "Cid", NOW - 1);
        const gone = seedHeldSeat(runId, 0xd, "dan@example.com", "Dan", NOW + 600_000);
        mem.items.delete(`${PK}|BOOKING#${gone}`);
        const res = await roster(runId);
        expect(res.status).toBe(200);
        expect(res.body.run).toMatchObject({ id: runId, taken: 3 });
        expect(res.body.people).toEqual([
            { bookingId: ana.id, ref: ana.ref, name: "Ana", email: "ana@example.com", language: "ro", state: "confirmed", source: "manual", channel: "phone" },
            { bookingId: bob, ref: `B-${bob.slice(0, 8).toUpperCase()}`, name: "Bob", email: "bob@example.com", state: "held", expiresAt: new Date(NOW + 600_000).toISOString(), source: "visitor" },
        ]);
        // AP7 projection: one BatchGet with the roster attributes only
        const batch = mem.ops("BatchGetCommand").at(-1).RequestItems["sched-table"];
        expect(Object.values(batch.ExpressionAttributeNames).sort()).toEqual(["SK", "id", "ref", "source", "state", "who"].sort());
        expect((await roster(runId, "c2")).status).toBe(404);
    });

    it("F7 a manual entry without a run is unplaced and listed by AP8; pages of 100 with an opaque cursor; a foreign or broken cursor → 400; unknown course → 404", async () => {
        const first = await newSeat(undefined, "una@example.com", "Una");
        expect(first.what).toEqual({ kind: "unplaced", courseId: "c1", courseName: "Pottery" });
        const one = await unplaced();
        expect(one).toEqual({ status: 200, body: { people: [{ bookingId: first.id, ref: first.ref, name: "Una", email: "una@example.com", state: "confirmed", source: "manual", channel: "phone" }] } });
        for (let i = 0; i < 100; i++) mem.put({ PK, SK: `UNPLACED#c1#${bid(0x1000 + i)}` }); // keys of erased bookings: skipped rows
        const p1 = await unplaced();
        expect(p1.body.people).toHaveLength(0); // the 100 lowest keys are the erased ones (0x1000… sort before first.id)
        expect(typeof p1.body.cursor).toBe("string");
        const p2 = await unplaced({ cursor: p1.body.cursor });
        expect(p2.body.people.map((p: any) => p.bookingId)).toEqual([first.id]);
        expect(p2.body).not.toHaveProperty("cursor");
        const foreign = Buffer.from(JSON.stringify({ PK: "TENANT#t2", SK: "UNPLACED#c1#x" })).toString("base64url");
        expect((await unplaced({ cursor: foreign })).body.code).toBe("invalid");
        expect((await unplaced({ cursor: "%%%" })).body.code).toBe("invalid");
        expect((await unplaced(undefined, "nope")).status).toBe(404);
    });
});

describe("manual entry", () => {
    it("F8 a manual seat: 201 confirmed manual booking; the `confirmed` mail has a working link and the group link; the owner copy has neither link; no audit event; history `created`", async () => {
        const runId = await newRun(DEC5, { groupLink: GROUP_LINK });
        h.putEvents.length = 0;
        const b = await newSeat(runId, "Ana@Example.com", "Ana", "en");
        expect(b).toMatchObject({
            what: { kind: "seat", courseId: "c1", courseName: "Pottery", runId, firstStart: "2026-12-05T08:00:00.000Z" },
            state: { kind: "confirmed" }, source: { kind: "manual", adminEmail: "admin@t1.test", channel: "phone" },
            who: { email: "ana@example.com", name: "Ana", language: "en" },
            history: [{ action: "created", state: "confirmed", placement: { kind: "seat", runId } }],
        });
        const [customer] = mailsTo("ana@example.com");
        expect(customer.Message.Body.Text.Data).toContain(GROUP_LINK);
        expect((await getBookingByToken(store(), "t1", tokenOf(customer), true))?.id).toBe(b.id);
        const [owner] = mailsTo("owner@atelier.example");
        expect(owner.Message.Body.Text.Data).not.toContain("#t=");
        expect(h.putEvents).toEqual([]);
        // the run's language is unchanged by an admin placement (§ 5.4)
        expect(mem.get(PK, `RUN#c1#${runId}`)!.language).toEqual({ kind: "notSet" });
    });

    it("F5 (part) placement into a cancelled run → 409 runCancelled; unknown run → 404; language not offered → 400; unknown course → 404; caller without email → 403; strict body; no booking written", async () => {
        const runId = await newRun();
        await cancelRun(runId);
        const before = mem.sks("BOOKING#").length;
        expect((await seat({ courseId: "c1", runId, who: who("a@example.com", "Ana"), channel: "phone" })).body.code).toBe("runCancelled");
        expect((await seat({ courseId: "c1", runId: "nope", who: who("a@example.com", "Ana"), channel: "phone" })).status).toBe(404);
        expect((await seat({ courseId: "c1", who: who("a@example.com", "Ana", "de"), channel: "phone" })).body.issues).toEqual([{ path: "who.language", message: "Must be one of the course's languages." }]);
        expect((await seat({ courseId: "nope", who: who("a@example.com", "Ana"), channel: "phone" })).status).toBe(404);
        expect((await seat({ courseId: "c1", who: who("a@example.com", "Ana"), channel: "phone" }, KEY_NO_EMAIL)).status).toBe(403);
        expect((await seat({ courseId: "c1", who: who("a@example.com", "Ana"), channel: "x".repeat(41) })).status).toBe(400);
        expect((await seat({ courseId: "c1", who: who("a@example.com", "Ana"), channel: "phone", extra: 1 })).status).toBe(400);
        expect(mem.sks("BOOKING#").length).toBe(before);
    });

    it("a mail failure is logged with the booking id only and the booking stands (201)", async () => {
        const runId = await newRun();
        h.sesFail.on = true;
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const b = await newSeat(runId, "ana@example.com", "Ana Secret");
        const logged = JSON.stringify(log.mock.calls);
        log.mockRestore();
        expect(mem.get(PK, `BOOKING#${b.id}`)).toBeDefined();
        expect(logged).toContain(b.id);
        expect(logged).not.toContain("ana@example.com");
        expect(logged).not.toContain("Ana Secret");
    });
});

describe("move a person", () => {
    it("F3 admin move across languages → 200, the target run's language unchanged; keeps id and tokens; `moved` history by the admin; `moved` mail with a working link and no group link; no audit", async () => {
        const ro = await newRun(DEC5, { language: "ro", groupLink: GROUP_LINK });
        const en = await newRun(DEC12, { language: "en", groupLink: GROUP_LINK });
        const b = await newSeat(ro, "ana@example.com", "Ana", "ro");
        const firstToken = tokenOf(mailsTo("ana@example.com")[0]);
        h.sesSends.length = 0;
        h.putEvents.length = 0;
        const res = await moveSeat(b.id, { runId: en, rev: b.rev });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: b.id, what: { kind: "seat", runId: en, firstStart: "2026-12-12T08:00:00.000Z", courseName: "Pottery" } });
        expect(res.body.rev).toBe(mem.get(PK, `BOOKING#${b.id}`)!.rev);
        expect(res.body.history.at(-1)).toMatchObject({ action: "moved", by: { kind: "admin", email: "admin@t1.test" }, from: { kind: "seat", runId: ro }, to: { kind: "seat", runId: en } });
        expect(mem.get(PK, `RUN#c1#${en}`)!.language).toEqual({ kind: "set", tag: "en" });
        const [mail] = mailsTo("ana@example.com");
        expect(mail.Message.Subject.Data).toContain("moved");
        expect(mail.Message.Body.Text.Data).not.toContain(GROUP_LINK);
        expect((await getBookingByToken(store(), "t1", tokenOf(mail), true))?.id).toBe(b.id);
        expect((await getBookingByToken(store(), "t1", firstToken, true))?.id).toBe(b.id);
        expect(h.putEvents).toEqual([]);
    });

    it("out of a run (runId null) → unplaced, listed by AP8, `unplaced` mail with a link; back into a run → seat; unplaced → unplaced changes nothing (no mail)", async () => {
        const runId = await newRun();
        const b = await newSeat(runId, "ana@example.com", "Ana");
        h.sesSends.length = 0;
        const out = await moveSeat(b.id, { runId: null, rev: b.rev });
        expect(out.body.what).toEqual({ kind: "unplaced", courseId: "c1", courseName: "Pottery" });
        expect((await unplaced()).body.people.map((p: any) => p.bookingId)).toEqual([b.id]);
        const [mail] = mailsTo("ana@example.com");
        expect(mail.Message.Subject.Data).toContain("choose a new group");
        expect((await getBookingByToken(store(), "t1", tokenOf(mail), true))?.id).toBe(b.id);
        h.sesSends.length = 0;
        const same = await moveSeat(b.id, { runId: null, rev: out.body.rev });
        expect(same.body.rev).toBe(out.body.rev);
        expect(h.sesSends).toEqual([]);
        const back = await moveSeat(b.id, { runId, rev: out.body.rev });
        expect(back.body.what).toMatchObject({ kind: "seat", runId });
        expect((await unplaced()).body.people).toEqual([]);
    });

    it("refusals: stale rev 409; full target 409 runFull; cancelled target 409 runCancelled; a held seat 409 notConfirmed; a slot booking 400; unknown booking or run 404", async () => {
        const a = await newRun(DEC5);
        const full = await newRun(DEC12, { capacity: 1 });
        await newSeat(full, "x@example.com", "Xena");
        const b = await newSeat(a, "ana@example.com", "Ana");
        expect((await moveSeat(b.id, { runId: full, rev: b.rev + 5 })).body.code).toBe("stale");
        expect((await moveSeat(b.id, { runId: full, rev: b.rev })).body).toMatchObject({ code: "runFull", capacity: 1 });
        const gone = await newRun([{ date: "2026-12-19", start: "10:00", end: "12:00" }]);
        await cancelRun(gone);
        expect((await moveSeat(b.id, { runId: gone, rev: b.rev })).body.code).toBe("runCancelled");
        expect((await moveSeat(b.id, { runId: "nope", rev: b.rev })).status).toBe(404);
        const held = seedHeldSeat(a, 0xe, "h@example.com", "Hal", NOW + 600_000);
        expect((await moveSeat(held, { runId: full, rev: 1 })).body.code).toBe("notConfirmed");
        mem.put({ PK, SK: `BOOKING#${bid(0xf)}`, ...BookingSchema.parse({
            id: bid(0xf), ref: `B-0000000F`, rev: 1, what: { kind: "slot", serviceId: "s", serviceName: "S", resourceId: "r1", start: NOW + 1e6, end: NOW + 2e6 },
            state: { kind: "confirmed", at: NOW }, source: { kind: "visitor" }, who: { email: "s@example.com", name: "Sam" }, tokenHashes: [],
            createdAt: NOW, updatedAt: NOW, history: [{ action: "confirmed", at: NOW }],
        }) });
        expect((await moveSeat(bid(0xf), { runId: a, rev: 1 })).status).toBe(400);
        expect((await moveSeat("nope", { runId: a, rev: 1 })).status).toBe(404);
    });
});

describe("move a run", () => {
    it("F4 every active booking (confirmed and held unexpired) gets ONE `moved` mail with a new working link, sent by this later invocation; mailed = 2; people stay; ONE audit event with dates and counts only; no history entry", async () => {
        const runId = await newRun(DEC5);
        const ana = await newSeat(runId, "ana@example.com", "Ana Pop");
        const bob = seedHeldSeat(runId, 0xb, "bob@example.com", "Bob Ray", NOW + 600_000);
        seedHeldSeat(runId, 0xc, "cid@example.com", "Cid Old", NOW - 1);
        h.sesSends.length = 0;
        h.putEvents.length = 0;
        const res = await moveRun(runId, { meetings: DEC12 });
        expect(res.status).toBe(200);
        expect(res.body.mailed).toBe(2);
        expect(res.body.run).toMatchObject({ meetings: DEC12, firstStart: "2026-12-12T08:00:00.000Z", taken: 2 });
        expect(mem.sks("RUNSPAN#")).toEqual([`RUNSPAN#2026-12-13T11:00:00.000Z#c1#${runId}`]);
        for (const [email, id] of [["ana@example.com", ana.id], ["bob@example.com", bob]]) {
            const mails = mailsTo(email);
            expect({ email, n: mails.length }).toEqual({ email, n: 1 });
            expect(mails[0].Message.Body.Text.Data).toContain("2026-12-12 10:00 (Europe/Bucharest)");
            expect((await getBookingByToken(store(), "t1", tokenOf(mails[0]), true))?.id).toBe(id);
        }
        expect(mailsTo("cid@example.com")).toEqual([]);
        expect(mem.get(PK, `BOOKING#${ana.id}`)!.history).toHaveLength(1);
        expect(audits()).toEqual([expect.objectContaining({
            action: "MOVE_SCHEDULING_RUN", target: { id: runId, title: "Pottery 2026-12-12" },
            details: { firstDate: "2026-12-12", lastDate: "2026-12-13", meetings: 2, activeBookings: 2 },
        })]);
        const detail = h.putEvents[0].Entries[0].Detail;
        for (const forbidden of [ana.id, ana.ref, bob, "Ana Pop", "ana@example.com", '"ip"']) expect(detail).not.toContain(forbidden);
    });

    it("refusals: invalid meetings → 400 with the kind; cancelled → 409; unknown → 404; a mint failure is logged by id and the move stands (200, mailed 0)", async () => {
        const runId = await newRun(DEC5);
        await newSeat(runId, "ana@example.com", "Ana");
        expect((await moveRun(runId, { meetings: [] })).body.code).toBe("empty");
        expect((await moveRun("nope", { meetings: DEC12 })).status).toBe(404);
        h.mintFail.on = true;
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await moveRun(runId, { meetings: DEC12 });
        log.mockRestore();
        expect(res.body).toMatchObject({ mailed: 0, run: { firstStart: "2026-12-12T08:00:00.000Z" } });
        h.mintFail.on = false;
        await cancelRun(runId);
        expect((await moveRun(runId, { meetings: DEC5 })).body.code).toBe("runCancelled");
    });
});

describe("cancel a run", () => {
    it("F5 confirmed → unplaced (AP8, `unplaced` mail with a working link), held → cancelled (`cancelled` mail without link, no owner copy), expired ignored; counts; ONE audit event `{ unplaced, cancelled }`; RUNSPAN# gone; again → 409", async () => {
        const runId = await newRun(DEC5);
        const ana = await newSeat(runId, "ana@example.com", "Ana Pop");
        const bob = seedHeldSeat(runId, 0xb, "bob@example.com", "Bob Ray", NOW + 600_000);
        seedHeldSeat(runId, 0xc, "cid@example.com", "Cid Old", NOW - 1);
        h.sesSends.length = 0;
        h.putEvents.length = 0;
        const res = await cancelRun(runId);
        expect(res).toEqual({ status: 200, body: { unplaced: 1, cancelled: 1, notSentPlacementChanged: 0, tokenCleanupFailed: 0 } });
        expect(mem.get(PK, `RUN#c1#${runId}`)).toMatchObject({ status: "cancelled", seats: {} });
        expect(mem.sks("RUNSPAN#")).toEqual([]);
        expect((await unplaced()).body.people.map((p: any) => p.bookingId)).toEqual([ana.id]);
        const [u] = mailsTo("ana@example.com");
        expect(u.Message.Subject.Data).toContain("choose a new group");
        expect((await getBookingByToken(store(), "t1", tokenOf(u), true))?.what).toEqual({ kind: "unplaced", courseId: "c1" });
        const [c] = mailsTo("bob@example.com");
        expect(c.Message.Subject.Data).toContain("cancelled");
        expect(c.Message.Body.Text.Data).not.toContain("#t=");
        expect(mailsTo("owner@atelier.example")).toEqual([]);
        expect(mailsTo("cid@example.com")).toEqual([]);
        expect(mem.get(PK, `BOOKING#${bob}`)).toMatchObject({ state: { kind: "cancelled", by: { kind: "admin", email: "admin@t1.test" } }, tokenHashes: [] });
        expect(mem.get(PK, `BOOKING#${ana.id}`)!.history.at(-1)).toMatchObject({ action: "moved", by: { kind: "admin", email: "admin@t1.test" }, to: { kind: "unplaced" } });
        expect(audits()).toEqual([expect.objectContaining({
            action: "CANCEL_SCHEDULING_RUN", target: { id: runId, title: "Pottery 2026-12-05" }, details: { unplaced: 1, cancelled: 1 },
        })]);
        const detail = h.putEvents[0].Entries[0].Detail;
        for (const forbidden of [ana.id, ana.ref, bob, "Ana Pop", "Bob Ray", "ana@example.com", '"ip"']) expect(detail).not.toContain(forbidden);
        expect((await cancelRun(runId)).body.code).toBe("runCancelled");
        expect((await cancelRun("nope")).status).toBe(404);
        expect((await cancelRun(runId, KEY_NO_EMAIL)).status).toBe(403);
    });

    it("a send failure is logged by booking id only and the cancel stands (200)", async () => {
        const runId = await newRun(DEC5);
        await newSeat(runId, "ana@example.com", "Ana Secret");
        h.sesFail.on = true;
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await cancelRun(runId);
        const logged = JSON.stringify(log.mock.calls);
        log.mockRestore();
        expect(res).toEqual({ status: 200, body: { unplaced: 1, cancelled: 0, notSentPlacementChanged: 0, tokenCleanupFailed: 0 } });
        expect(logged).not.toContain("ana@example.com");
        expect(logged).not.toContain("Ana Secret");
    });
});

describe("rules across the thirteen routes", () => {
    const routes: [string, any, () => any][] = [
        ["courses list", listCoursesRoute, () => event("GET", "/x")],
        ["course delete", deleteCourseRoute, () => event("DELETE", "/x", { params: { courseId: "c1" } })],
        ["runs list", listRunsRoute, () => event("GET", "/x", { params: { courseId: "c1" } })],
        ["run create", createRunRoute, () => event("POST", "/x", { params: { courseId: "c1" }, body: { meetings: DEC5, trainerIds: ["r1"] } })],
        ["run update", updateRunRoute, () => event("PUT", "/x", { params: { courseId: "c1", runId: "r" }, body: { capacity: 2 } })],
        ["run move", moveRunRoute, () => event("POST", "/x", { params: { courseId: "c1", runId: "r" }, body: { meetings: DEC12 } })],
        ["run cancel", cancelRunRoute, () => event("POST", "/x", { params: { courseId: "c1", runId: "r" }, body: {} })],
        ["roster", rosterRoute, () => event("GET", "/x", { params: { courseId: "c1", runId: "r" } })],
        ["unplaced", unplacedRoute, () => event("GET", "/x", { params: { courseId: "c1" } })],
        ["seat", seatsRoute, () => event("POST", "/x", { body: { courseId: "c1", who: who("a@example.com", "Ana"), channel: "phone" } })],
        ["move seat", moveSeatRoute, () => event("POST", "/x", { params: { bookingId: "b" }, body: { runId: null, rev: 1 } })],
        ["course create", createCourseRoute, () => event("POST", "/x", { body: { name: "Weaving", defaultCapacity: 6, languages: [] } })],
        ["course update", updateCourseRoute, () => event("PUT", "/x", { params: { courseId: "c1" }, body: { name: "Pottery", defaultCapacity: 8, languages: ["ro", "en"] } })],
    ];
    const WRITERS = ["course create", "course update", "course delete", "run create", "run update", "run move", "run cancel", "seat", "move seat"];

    it("another tenant's admin → 403 on all thirteen, nothing read from the scheduling table; EDITOR and GLOBAL_ADMIN pass the role check", async () => {
        for (const [name, handler, ev] of routes) {
            const e = ev();
            e.requestContext.authorizer.lambda = OTHER_TENANT_ADMIN;
            const before = mem.calls.length;
            expect({ name, status: (await call(handler, e)).status }).toEqual({ name, status: 403 });
            expect(mem.calls.length).toBe(before);
            for (const auth of [EDITOR, GLOBAL]) {
                const ok = ev();
                ok.requestContext.authorizer.lambda = auth;
                expect({ name, role: auth.role, forbidden: (await call(handler, ok)).status === 403 }).toEqual({ name, role: auth.role, forbidden: false });
            }
        }
    });

    it("every writing route: a malformed stored setting or mail configuration → 500 storedDataInvalid before any write (no Put, Delete or transaction; no audit; no mail); the tenant read is consistent", async () => {
        const runId = await newRun();
        const b = await newSeat(runId, "ana@example.com", "Ana");
        h.sesSends.length = 0;
        h.putEvents.length = 0;
        for (const broken of [{ scheduling: { timezone: "Europe/Bucharest", bookingHorizonWeeks: 0 } }, { schedulingEmailConfig: { templates: { moved: { body: "x" } } } }]) {
            tenantRecord = { ...structuredClone(TENANT_RECORD), ...broken };
            for (const [name, handler, ev] of routes.filter(([n]) => WRITERS.includes(n))) {
                const e = ev();
                if (e.pathParameters.runId) e.pathParameters.runId = runId;
                if (e.pathParameters.bookingId) { e.pathParameters.bookingId = b.id; e.body = JSON.stringify({ runId: null, rev: b.rev }); }
                const writes = () => mem.calls.filter((c) => ["PutCommand", "DeleteCommand", "TransactWriteCommand", "UpdateCommand"].includes(c.op)).length;
                const before = writes();
                const res = await call(handler, e);
                expect({ name, status: res.status, code: res.body?.code }).toEqual({ name, status: 500, code: "storedDataInvalid" });
                expect({ name, writes: writes() - before }).toEqual({ name, writes: 0 });
            }
        }
        expect(h.putEvents).toEqual([]);
        expect(h.sesSends).toEqual([]);
        const tenantReads = h.ddbSend.mock.calls.map((c) => c[0].input).filter((i) => i.Key?.SK === "TENANT#t1");
        expect(tenantReads.every((i) => i.ConsistentRead === true)).toBe(true);
    });

    it("§ 11.2 audit oracle: configuration writes publish exactly one event each; the two person routes publish none; no event has an ip key", async () => {
        const runId = await newRun();                                  // 1
        await updateRun(runId, { capacity: 5 });                        // 2
        const b = await newSeat(runId, "ana@example.com", "Ana");       // none
        await moveSeat(b.id, { runId: null, rev: b.rev });              // none
        await moveRun(runId, { meetings: DEC12 });                      // 3
        await cancelRun(runId);                                         // 4
        expect(audits().map((a) => a.action)).toEqual(["CREATE_SCHEDULING_RUN", "UPDATE_SCHEDULING_RUN", "MOVE_SCHEDULING_RUN", "CANCEL_SCHEDULING_RUN"]);
        for (const e of h.putEvents) expect(e.Entries[0].Detail).not.toContain('"ip"');
        expect(mailCount()).toBeGreaterThan(0);
    });

    it("no group-*.ts file sends a DynamoDB request of its own (no client import, no command class): every read and write goes through scheduling-db.ts", () => {
        const dir = join(__dirname, "../../src/scheduling/admin");
        const files = readdirSync(dir).filter((f) => f.startsWith("group-") && f.endsWith(".ts"));
        expect(files.length).toBe(14);
        for (const f of files) {
            const src = readFileSync(join(dir, f), "utf8");
            expect({ f, hit: /@aws-sdk\/(client-dynamodb|lib-dynamodb)|QueryCommand|GetCommand|PutCommand|TransactWrite|SCHEDULING_TABLE_NAME/.test(src) })
                .toEqual({ f, hit: false });
        }
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Iteration 1: course create / update (ruling S1F1-STORE-ALLOCATION) and one test per review-0 finding
// ---------------------------------------------------------------------------------------------------------------

const createCourse = (body: unknown) => call(createCourseRoute, event("POST", "/scheduling/admin/courses", { body }));
const updateCourse = (id: string, body: unknown) => call(updateCourseRoute, event("PUT", `/scheduling/admin/courses/${id}`, { body, params: { courseId: id } }));
const deleteCourse = (id: string) => call(deleteCourseRoute, event("DELETE", `/scheduling/admin/courses/${id}`, { params: { courseId: id } }));
const isCourseQuery = (q: any) => q.ExpressionAttributeValues?.[":p"] === "COURSE#";

describe("course create and update (S1F1-STORE-ALLOCATION)", () => {
    it("create: 201 CourseDTO (trimmed name), one audit event with the name and no ip; validation: capacity 46 → the 45 text, duplicate or 11 languages, unknown key → 400; nothing written on a refusal", async () => {
        const res = await createCourse({ name: "  Weaving ", defaultCapacity: 6, languages: ["ro"] });
        expect(res).toEqual({ status: 201, body: { id: expect.any(String), name: "Weaving", defaultCapacity: 6, languages: ["ro"] } });
        expect(mem.get(PK, `COURSE#${res.body.id}`)).toMatchObject({ name: "Weaving" });
        expect(audits()).toEqual([expect.objectContaining({ action: "CREATE_SCHEDULING_COURSE", actor: { id: "u1", email: "admin@t1.test" }, target: { id: res.body.id, title: "Weaving" } })]);
        expect(h.putEvents[0].Entries[0].Detail).not.toContain('"ip"');
        const count = mem.sks("COURSE#").length;
        expect((await createCourse({ name: "X", defaultCapacity: 46, languages: [] })).body.issues).toEqual([{ path: "defaultCapacity", message: "A group in this version holds at most 45 people." }]);
        expect((await createCourse({ name: "X", defaultCapacity: 6, languages: ["ro", "ro"] })).status).toBe(400);
        expect((await createCourse({ name: "X", defaultCapacity: 6, languages: Array.from({ length: 11 }, (_, i) => `l${i}`) })).status).toBe(400);
        expect((await createCourse({ name: "X", defaultCapacity: 6, languages: [], v: 1 })).status).toBe(400);
        expect((await createCourse({ name: "   ", defaultCapacity: 6, languages: [] })).status).toBe(400);
        expect(mem.sks("COURSE#").length).toBe(count);
    });

    it("the course bound: a CONSISTENT count; 199 existing → 201, 200 existing → 400 invalid (ruling S1D1-R02 wording)", async () => {
        for (let i = 2; i <= 199; i++) seedCourse(`k${i}`, `K${i}`, [], 5);
        expect(mem.sks("COURSE#")).toHaveLength(199);
        expect((await createCourse({ name: "C200", defaultCapacity: 6, languages: [] })).status).toBe(201);
        expect(mem.ops("QueryCommand").filter(isCourseQuery).every((q) => q.ConsistentRead === true)).toBe(true);
        const refused = await createCourse({ name: "C201", defaultCapacity: 6, languages: [] });
        expect(refused).toEqual({ status: 400, body: expect.objectContaining({ code: "invalid", error: "A site can have at most 200 courses." }) });
        expect(mem.sks("COURSE#")).toHaveLength(200);
    });

    it("update: 200 + audit with the new name; an unknown course → 404 and not created; S1F1-R06 languageInUse lists the tags ANY run uses, a cancelled run included; the run read is consistent", async () => {
        const ro = await newRun(DEC5, { language: "ro" });
        const en = await newRun(DEC12, { language: "en" });
        await cancelRun(en);
        h.putEvents.length = 0;
        const inUse = await updateCourse("c1", { name: "Pottery", defaultCapacity: 8, languages: ["en"] });
        expect(inUse).toEqual({ status: 409, body: expect.objectContaining({ code: "languageInUse", languages: ["ro"] }) });
        expect(mem.ops("QueryCommand").filter((q) => q.ExpressionAttributeValues?.[":p"] === "RUN#c1#").at(-1).ConsistentRead).toBe(true);
        // Review S1F1-R06: `en` is used only by the CANCELLED run — still in use (§ 10.3 excepts no run).
        expect((await updateCourse("c1", { name: "Clay", defaultCapacity: 10, languages: ["ro"] })).body)
            .toEqual(expect.objectContaining({ code: "languageInUse", languages: ["en"] }));
        expect(mem.get(PK, `RUN#c1#${en}`)!.status).toBe("cancelled");
        const ok = await updateCourse("c1", { name: "Clay", defaultCapacity: 10, languages: ["ro", "en", "de"] });
        expect(ok).toEqual({ status: 200, body: { id: "c1", name: "Clay", defaultCapacity: 10, languages: ["ro", "en", "de"] } });
        expect(mem.get(PK, `RUN#c1#${ro}`)!.capacity).toBe(8); // runs keep their capacity (§ 13)
        expect(audits()).toEqual([expect.objectContaining({ action: "UPDATE_SCHEDULING_COURSE", target: { id: "c1", title: "Clay" } })]);
        expect((await updateCourse("nope", { name: "N", defaultCapacity: 5, languages: [] })).status).toBe(404);
        expect(mem.get(PK, "COURSE#nope")).toBeUndefined();
    });

    it("update never re-creates a course: a delete that commits between the request's reads and its write → 404, the course stays deleted, no update audit", async () => {
        mem.before("UpdateCommand", (u) => u.Key.SK === "COURSE#c1", () => mem.items.delete(`${PK}|COURSE#c1`));
        h.putEvents.length = 0;
        expect((await updateCourse("c1", { name: "Back", defaultCapacity: 8, languages: [] })).status).toBe(404);
        expect(mem.get(PK, "COURSE#c1")).toBeUndefined();
        expect(h.putEvents).toEqual([]);
    });
});

describe("S1F1-R04 course delete guard (S1F1-COURSE-DELETE-GUARD) through the routes", () => {
    it("a run create, or an unplaced manual entry, that commits between the delete's checks and its Delete: the dependent stands (201), the delete answers 409 courseInUse, the course is kept; no delete audit", async () => {
        for (const kind of ["run create", "unplaced entry"] as const) {
            mem = new MemTable(); h.mem.current = mem;
            seedCourse(); seedResource("r1", "Ana");
            h.putEvents.length = 0;
            let dependent: { status: number } | undefined;
            mem.before("DeleteCommand", (d) => d.Key.SK === "COURSE#c1", async () => {
                dependent = kind === "run create"
                    ? await createRun({ meetings: DEC5, trainerIds: ["r1"] })
                    : await seat({ courseId: "c1", who: who("u@example.com", "Una"), channel: "phone" });
            });
            const res = await deleteCourse("c1");
            expect({ kind, dependent: dependent?.status, delete: res.status, code: res.body?.code }).toEqual({ kind, dependent: 201, delete: 409, code: "courseInUse" });
            expect(mem.get(PK, "COURSE#c1")).toBeDefined();
            expect(mem.sks(kind === "run create" ? "RUN#c1#" : "UNPLACED#c1#")).toHaveLength(1);
            expect(audits().map((a) => a.action)).not.toContain("DELETE_SCHEDULING_COURSE");
        }
    });

    it("after a completed delete, a run create and an unplaced entry find no course → 404, nothing written", async () => {
        expect((await deleteCourse("c1")).status).toBe(204);
        expect((await createRun({ meetings: DEC5, trainerIds: ["r1"] })).status).toBe(404);
        expect((await seat({ courseId: "c1", who: who("u@example.com", "Una"), channel: "phone" })).status).toBe(404);
        expect(mem.sks("RUN#")).toEqual([]);
        expect(mem.sks("BOOKING#")).toEqual([]);
    });
});

describe("S1F1-R01 a notice is sent only when the booking as saved still has its placement (hasPlacement)", () => {
    /**
     * Run `move` once, just before the mint's CONSISTENT read of BOOKING#<id>: the `skip`-th + 1 such read (run move
     * and run cancel read no booking by Get before their mints: skip 0; a person move has two before: the route's
     * pre-read and the store's read).
     */
    const beforeMintRead = (id: string, move: () => Promise<unknown>, skip = 0) => {
        let seen = 0;
        mem.before("GetCommand", (g) => g.Key.SK === `BOOKING#${id}` && g.ConsistentRead === true && seen++ === skip, move);
    };

    it("run move: a person moved to another run between the run move's commit and the mint gets NO `moved` notice for this run; counted in notSentPlacementChanged; the others are mailed", async () => {
        const runA = await newRun(DEC5);
        const runB = await newRun(DEC12);
        const ana = await newSeat(runA, "ana@example.com", "Ana");
        await newSeat(runA, "bob@example.com", "Bob");
        h.sesSends.length = 0;
        beforeMintRead(ana.id, () => sdb.moveSeat(store(), { tenantId: "t1", bookingId: ana.id, runId: runB, actor: { kind: "admin", email: "other@t1.test" }, cutoffHours: 0, now: NOW }));
        const res = await moveRun(runA, { meetings: [{ date: "2026-12-19", start: "10:00", end: "13:00" }] });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ mailed: 1, notSentPlacementChanged: 1 });
        expect(mailsTo("ana@example.com")).toEqual([]);
        expect(mailsTo("bob@example.com")[0].Message.Body.Text.Data).toContain("2026-12-19 10:00 (Europe/Bucharest)");
        expect(mem.get(PK, `BOOKING#${ana.id}`)!.what).toMatchObject({ kind: "seat", runId: runB });
    });

    it("run cancel: a person placed into another run between the cancel's commit and the mint gets NO `unplaced` notice; counted; the audit counts stay the committed ones", async () => {
        const runA = await newRun(DEC5);
        const runB = await newRun(DEC12);
        const ana = await newSeat(runA, "ana@example.com", "Ana");
        await newSeat(runA, "bob@example.com", "Bob");
        h.sesSends.length = 0;
        h.putEvents.length = 0;
        beforeMintRead(ana.id, () => sdb.moveSeat(store(), { tenantId: "t1", bookingId: ana.id, runId: runB, actor: { kind: "admin", email: "other@t1.test" }, cutoffHours: 0, now: NOW }));
        const res = await cancelRun(runA);
        expect(res.body).toEqual({ unplaced: 2, cancelled: 0, notSentPlacementChanged: 1, tokenCleanupFailed: 0 });
        expect(mailsTo("ana@example.com")).toEqual([]);
        expect(mailsTo("bob@example.com")[0].Message.Subject.Data).toContain("choose a new group");
        expect(audits()[0].details).toEqual({ unplaced: 2, cancelled: 0 });
    });

    it("person move: a later move that commits before our mint → no notice for OUR target (logged by id only); the answer shows the booking as saved", async () => {
        const runA = await newRun(DEC5);
        const runB = await newRun(DEC12);
        const runC = await newRun([{ date: "2026-12-19", start: "10:00", end: "13:00" }]);
        const ana = await newSeat(runA, "ana@example.com", "Ana Secret");
        h.sesSends.length = 0;
        beforeMintRead(ana.id, () => sdb.moveSeat(store(), { tenantId: "t1", bookingId: ana.id, runId: runC, actor: { kind: "admin", email: "other@t1.test" }, cutoffHours: 0, now: NOW }), 2);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await moveSeat(ana.id, { runId: runB, rev: ana.rev });
        const logged = JSON.stringify(log.mock.calls);
        log.mockRestore();
        expect(res.status).toBe(200);
        expect(res.body.what).toMatchObject({ kind: "seat", runId: runC, firstStart: "2026-12-19T08:00:00.000Z" });
        expect(mailsTo("ana@example.com")).toEqual([]);
        expect(logged).toContain(ana.id);
        expect(logged).not.toContain("ana@example.com");
        expect(logged).not.toContain("Ana Secret");
    });
});

describe("S1F1-R02 run cancel: the audit comes from the committed result (S1F1-CANCEL-OUTCOME)", () => {
    it("a run moved just before the cancel's transaction read it: the audit title names the saved first date (the snapshot the cancel used)", async () => {
        const runId = await newRun(DEC5);
        mem.before("GetCommand", (g) => g.Key.SK === `RUN#c1#${runId}` && g.ConsistentRead === true,
            () => sdb.moveRun(store(), "t1", "c1", runId, [{ date: "2026-12-19", start: "10:00", end: "13:00" }], NOW));
        h.putEvents.length = 0;
        expect((await cancelRun(runId)).status).toBe(200);
        expect(audits()).toEqual([expect.objectContaining({ action: "CANCEL_SCHEDULING_RUN", target: { id: runId, title: "Pottery 2026-12-19" } })]);
    });

    it("the audit is published BEFORE the first token-cleanup request (review S1F1-R02); a cleanup failure after the commit: 200 with tokenCleanupFailed 1, ONE audit event, the mails still sent; the cancel stands", async () => {
        const runId = await newRun(DEC5);
        await newSeat(runId, "ana@example.com", "Ana");
        const bob = seedHeldSeat(runId, 0xb, "bob@example.com", "Bob", NOW + 600_000);
        mem.put({ ...mem.get(PK, `BOOKING#${bob}`)!, tokenHashes: ["a".repeat(64)] });
        mem.put({ PK, SK: `TOKEN#${"a".repeat(64)}`, bookingId: bob, createdAt: NOW });
        // The first request of the cleanup is its consistent read of the cancelled booking, after the cancel commit.
        let auditsAtFirstCleanupRequest: number | undefined;
        mem.before("GetCommand", (g) => g.Key.SK === `BOOKING#${bob}` && g.ConsistentRead === true && mem.get(PK, `RUN#c1#${runId}`)?.status === "cancelled",
            () => { auditsAtFirstCleanupRequest = h.putEvents.length; });
        mem.before("TransactWriteCommand", (t) => t.TransactItems.some((i: any) => String(i.Delete?.Key.SK ?? "").startsWith("TOKEN#")),
            () => { throw fail("InternalServerError"); });
        h.sesSends.length = 0;
        h.putEvents.length = 0;
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await cancelRun(runId);
        log.mockRestore();
        expect(res).toEqual({ status: 200, body: { unplaced: 1, cancelled: 1, notSentPlacementChanged: 0, tokenCleanupFailed: 1 } });
        expect(auditsAtFirstCleanupRequest).toBe(1);
        expect(audits()).toHaveLength(1);
        expect(mailsTo("ana@example.com")).toHaveLength(1);
        expect(mailsTo("bob@example.com")).toHaveLength(1);
        expect(mem.get(PK, `RUN#c1#${runId}`)!.status).toBe("cancelled");
        expect(mem.get(PK, `BOOKING#${bob}`)!.state.kind).toBe("cancelled");
    });
});

describe("S1F1-R03 trainers are distinct", () => {
    it("run create and run update with a repeated trainer → 400 before any transaction; the test table refuses a transaction that names one item twice, as DynamoDB does", async () => {
        const writes = () => mem.ops("TransactWriteCommand").length;
        const before = writes();
        expect((await createRun({ meetings: DEC5, trainerIds: ["r1", "r1"] })).body).toMatchObject({ code: "invalid", issues: [{ path: "trainerIds", message: "Each trainer once." }] });
        const runId = await newRun();
        const after = writes();
        expect(after).toBe(before + 1);
        expect((await updateRun(runId, { trainerIds: ["r2", "r1", "r2"] })).body).toMatchObject({ code: "invalid" });
        expect(writes()).toBe(after);
        expect((await updateRun(runId, { trainerIds: ["r2", "r1"] })).body.trainerIds).toEqual(["r2", "r1"]);
        // Positive control of the table rule (the store itself is not asked to dedupe: the route validates).
        await expect(sdb.createRun(store(), {
            tenantId: "t1", courseId: "c1", meetings: DEC5, timezone: "Europe/Bucharest", capacity: 4, trainerIds: ["r1", "r1"], language: { kind: "notSet" }, now: NOW,
        })).rejects.toThrow(/ValidationException/);
    });
});

describe("F6 (review S1F1-R05) the visitor write path after a capacity cut", () => {
    const hold = (runId: string, email: string) => call(holdRoute, {
        ...event("POST", "/scheduling/visitor/holds", {
            auth: { sub: "renderer", role: "RENDERER", tenantId: "ALL" },
            body: { intentId: crypto.randomUUID(), recaptchaToken: "tok", what: { kind: "seat", courseId: "c1", runId }, who: who(email, "Visitor") },
        }),
    });

    it("capacity lowered through the update route below the seats taken → a VISITOR hold through the real hold route is refused 409 runFull; above it a visitor hold succeeds", async () => {
        const runId = await newRun(DEC5, { capacity: 3 });
        await newSeat(runId, "a@example.com", "Ana");
        await newSeat(runId, "b@example.com", "Bob");
        const control = await hold(runId, "c@example.com");          // 2 of 3: the visitor path works
        expect(control.status).toBe(201);
        expect((await updateRun(runId, { capacity: 2 })).body).toMatchObject({ capacity: 2, taken: 3, overCapacityBy: 1 });
        const refused = await hold(runId, "d@example.com");
        expect(refused).toEqual({ status: 409, body: expect.objectContaining({ code: "runFull", capacity: 2 }) });
        expect(Object.keys(mem.get(PK, `RUN#c1#${runId}`)!.seats)).toHaveLength(3);
    });
});

describe("S1F1-LANGUAGE-CONSIST (operator ruling; amends § 4.3): a run language outside its course's list is valid stored data", () => {
    const visitorHold = (runId: string, email: string, language?: string) => call(holdRoute, event("POST", "/scheduling/visitor/holds", {
        auth: { sub: "renderer", role: "RENDERER", tenantId: "ALL" },
        body: { intentId: crypto.randomUUID(), recaptchaToken: "tok", what: { kind: "seat", courseId: "c1", runId }, who: who(email, "Visitor", language) },
    }));

    it("the reachable race leaves it (a run created with `en` commits between the course update's run read and its write: both succeed); the run is then read, shown, booked and moved normally; no reader, schema or writer refuses it", async () => {
        const other = await newRun(DEC12);
        // The course update reads the runs (consistent Query), then writes; the run create commits in between.
        let raced: { status: number; body: any } | undefined;
        mem.before("UpdateCommand", (u) => u.Key.SK === "COURSE#c1", async () => { raced = await createRun({ meetings: DEC5, trainerIds: ["r1"], language: "en", capacity: 3 }); });
        const upd = await updateCourse("c1", { name: "Pottery", defaultCapacity: 8, languages: ["ro"] });
        expect(raced?.status).toBe(201);
        expect(upd.status).toBe(200);
        const runId: string = raced!.body.id;
        expect(mem.get(PK, "COURSE#c1")!.languages).toEqual(["ro"]);
        expect(mem.get(PK, `RUN#c1#${runId}`)!.language).toEqual({ kind: "set", tag: "en" });

        // read and shown: admin runs list and roster
        const list = await call(listRunsRoute, event("GET", "/scheduling/admin/courses/c1/runs", { params: { courseId: "c1" } }));
        expect(list.body.runs.find((r: any) => r.id === runId)).toMatchObject({ language: "en" });
        expect((await roster(runId)).status).toBe(200);
        // booked: a visitor with no language preference (the course list is what NEW choices pick from: a visitor
        // choosing `en` now is refused 400 by the hold, as any language outside the list)
        expect((await visitorHold(runId, "v@example.com")).status).toBe(201);
        expect((await visitorHold(runId, "w@example.com", "en")).status).toBe(400);
        // booked by the admin, moved into and out of, the run moved and updated without touching its language
        const ana = await newSeat(runId, "ana@example.com", "Ana");
        const bob = await newSeat(other, "bob@example.com", "Bob", "ro");
        expect((await moveSeat(bob.id, { runId, rev: bob.rev })).status).toBe(200);
        expect((await moveSeat(ana.id, { runId: other, rev: ana.rev })).status).toBe(200);
        expect((await moveRun(runId, { meetings: [{ date: "2026-12-19", start: "10:00", end: "13:00" }] })).status).toBe(200);
        expect((await updateRun(runId, { capacity: 5, groupLink: GROUP_LINK })).body).toMatchObject({ capacity: 5, language: "en" });
        // The course stays editable: a rename that keeps ["ro"] is not refused by the run's `en` (`en` is not being
        // removed by this update: it is not in the stored list).
        expect((await updateCourse("c1", { name: "Pottery II", defaultCapacity: 8, languages: ["ro"] })).status).toBe(200);
        // Adding `en` back, then removing it, is the sequential guard again: 409 languageInUse.
        expect((await updateCourse("c1", { name: "Pottery II", defaultCapacity: 8, languages: ["ro", "en"] })).status).toBe(200);
        expect((await updateCourse("c1", { name: "Pottery II", defaultCapacity: 8, languages: ["ro"] })).body)
            .toEqual(expect.objectContaining({ code: "languageInUse", languages: ["en"] }));
        expect((await cancelRun(runId)).status).toBe(200);
    });
});
