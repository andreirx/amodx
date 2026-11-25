import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BatchGetCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { BookingSchema, weekMailDue } from "@amodx/shared";

/**
 * SCHED-1G1 — the scheduled job `backend/src/scheduling/reminders.ts` (docs/slices/sched-1.md § 11.3, § 11.4, § 14.1;
 * § 17.3 rows G10, G14, G15, G17; the tenant-selection part of C29; the cadence argument of § 11.3).
 *
 * REAL: the job, the kernel (`weekMailDue`, `planDay`, `activeEntries`), `scheduling-email.ts` (templates, rendering,
 * `whenText`), `parseSchedulingTenant`, and every READ of `scheduling-db.ts` the job calls (`listResources`,
 * `readIntervals`, `getResourcePlans`) over `ReadTable` below — an in-memory READ-ONLY
 * DynamoDB (Get, Query with `begins_with` / `BETWEEN`, BatchGet, projections), which also serves the main-table
 * tenant Query (AP12).
 * REPLACED at their boundaries (mocked, stateful, with the documented semantics; the transactions themselves are rows
 * C14, C29, C34, C35 (2) of `sched-1c`, run against `FakeTable` in scheduling-db.test.ts): `markReminder` (its
 * condition: start = S, confirmed, not reminded for S), `mintToken`,
 * `cleanupExpiredHolds`, `claimWeekMail`, `markWeekMailSent`; SES (`SendEmail` recorded; refusals injected).
 * Clock: injected (`runSchedulingJobs({ scheduledAt, now })`). Credential-free.
 * Rows G3 and G5 of SCHED-GROUPS-REMOVE-1: `storedGroupItems` writes the items of the removed group shape.
 */

type Item = Record<string, any>;

const h = vi.hoisted(() => {
    process.env.SCHEDULING_TABLE_NAME = "sched-table";
    process.env.SES_FROM_EMAIL = "bookings@amodx.test";
    process.env.RENDERER_CLOUDFRONT_ORIGIN = "https://d111.cloudfront.net";
    process.env.ADMIN_URL = "https://admin.amodx.test";
    type Item = Record<string, any>;
    /** In-memory read-only DynamoDB (both tables; the main table's tenant records have PK `SYSTEM`). */
    const ReadTable = class {
        items = new Map<string, Item>();
        commands: { op: string; input: any }[] = [];
        put(item: Item) { this.items.set(`${item.PK}\u0000${item.SK}`, structuredClone(item)); }
        get(pk: string, sk: string): Item | undefined { const i = this.items.get(`${pk}\u0000${sk}`); return i && structuredClone(i); }
        private project(item: Item, expr: string | undefined, names: Record<string, string> = {}): Item {
            if (!expr) return structuredClone(item);
            const out: Item = {};
            for (const raw of expr.split(",").map((s) => s.trim())) {
                const path = raw.split(".").map((p) => (p.startsWith("#") ? names[p] : p));
                let src: any = item;
                for (const p of path) src = src?.[p];
                if (src === undefined) continue;
                let dst = out;
                path.slice(0, -1).forEach((p) => { dst[p] ??= {}; dst = dst[p]; });
                dst[path[path.length - 1]] = structuredClone(src);
            }
            return out;
        }
        async send(cmd: any): Promise<any> {
            const input = structuredClone(cmd.input);
            this.commands.push({ op: cmd.constructor.name, input });
            if (cmd instanceof GetCommand) {
                const item = this.items.get(`${input.Key.PK}\u0000${input.Key.SK}`);
                return { Item: item ? this.project(item, input.ProjectionExpression, input.ExpressionAttributeNames) : undefined };
            }
            if (cmd instanceof QueryCommand) {
                const v = input.ExpressionAttributeValues;
                const hit = (sk: string) => (v[":p"] !== undefined ? sk.startsWith(v[":p"]) : v[":lo"] <= sk && sk <= v[":hi"]);
                const items = [...this.items.values()].filter((i) => i.PK === v[":pk"] && hit(String(i.SK)))
                    .sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
                return { Items: items.map((i) => this.project(i, input.ProjectionExpression, input.ExpressionAttributeNames)) };
            }
            if (cmd instanceof BatchGetCommand) {
                const [table, req] = Object.entries(input.RequestItems as Record<string, any>)[0];
                const found = req.Keys.map((k: any) => this.items.get(`${k.PK}\u0000${k.SK}`)).filter(Boolean)
                    .map((i: Item) => this.project(i, req.ProjectionExpression, req.ExpressionAttributeNames));
                return { Responses: { [table]: found } };
            }
            throw new Error(`write commands go through the mocked store functions, not ${cmd.constructor.name}`);
        }
    };
    return {
        table: new ReadTable(),
        mails: [] as { to: string; subject: string; body: string }[],
        sesAttempts: 0,
        /** Return true to make SES refuse this mail. */
        sesRefuses: (_mail: { to: string; subject: string }) => false,
        /** Run before each `markReminder` (a concurrent move between selection and mark). */
        beforeMark: null as null | ((bookingId: string) => void),
        cleanups: [] as { tenantId: string; now: number }[],
        cleanupThrowsFor: new Set<string>(),
        markers: new Map<string, { claimedAt: number; sentAt?: number }>(),
        markSentFails: false,
        tokens: 0,
    };
});

vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => h.table.send(cmd) }, TABLE_NAME: "main-table" }));
vi.mock("@aws-sdk/client-ses", () => ({
    SESClient: class {
        async send(cmd: any) {
            h.sesAttempts++;
            const mail = { to: cmd.input.Destination.ToAddresses[0], subject: cmd.input.Message.Subject.Data, body: cmd.input.Message.Body.Text.Data };
            if (h.sesRefuses(mail)) throw Object.assign(new Error("MessageRejected: secret detail"), { name: "MessageRejected" });
            h.mails.push(mail);
            return {};
        }
    },
    SendEmailCommand: class { constructor(public input: any) {} },
}));
vi.mock("../../src/lib/scheduling-db.js", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../src/lib/scheduling-db.js")>();
    const bookingOf = (tenantId: string, id: string) => h.table.get(`TENANT#${tenantId}`, `BOOKING#${id}`);
    return {
        ...real,
        markReminder: vi.fn(async (_store: any, tenantId: string, bookingId: string, target: any) => {
            h.beforeMark?.(bookingId);
            const b = bookingOf(tenantId, bookingId);
            const S = target.start;
            const placed = b !== undefined && b.what.kind === "slot" && b.what.start === S;
            if (!b || !placed || b.state.kind !== "confirmed" || b.reminderSentFor === S) return { kind: "stale" };
            h.table.put({ ...b, reminderSentFor: S });
            return { kind: "marked" };
        }),
        mintToken: vi.fn(async (_store: any, tenantId: string, bookingId: string) => {
            const b = bookingOf(tenantId, bookingId);
            if (!b || b.state.kind === "cancelled") return { ok: false, error: { kind: "linkNotIssued" } };
            // The items the real mint writes (§ 8.4): TOKEN#<sha256(token)> → bookingId, and the hash listed on BOOKING#,
            // so the REAL lookup (getBookingByToken, the visitor view route) can open the link (review S1G1-R05).
            const token = `tok${++h.tokens}`.padEnd(43, "_");
            const hash = real.sha256hex(token);
            h.table.put({ PK: `TENANT#${tenantId}`, SK: `TOKEN#${hash}`, bookingId, createdAt: 0 });
            const next = { ...b, rev: b.rev + 1, tokenHashes: [...b.tokenHashes, hash].slice(-20) };
            h.table.put(next);
            const { PK: _pk, SK: _sk, ...record } = next;
            return { ok: true, value: { booking: BookingSchema.parse(record), token } };
        }),
        cleanupExpiredHolds: vi.fn(async (_store: any, tenantId: string, now: number) => {
            if (h.cleanupThrowsFor.has(tenantId)) throw Object.assign(new Error("Throttled: a secret detail"), { name: "ProvisionedThroughputExceededException" });
            h.cleanups.push({ tenantId, now });
            return { removed: 1, skipped: 0, busy: 0 };
        }),
        claimWeekMail: vi.fn(async (_store: any, tenantId: string, weekStart: string, now: number) => {
            const k = `${tenantId}#${weekStart}`;
            const m = h.markers.get(k) ?? { claimedAt: now };
            h.markers.set(k, m);
            return { alreadySent: typeof m.sentAt === "number" };
        }),
        markWeekMailSent: vi.fn(async (_store: any, tenantId: string, weekStart: string, now: number) => {
            if (h.markSentFails) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
            h.markers.get(`${tenantId}#${weekStart}`)!.sentAt = now;
        }),
    };
});

import { runSchedulingJobs, handler, isCleanupRun } from "../../src/scheduling/reminders.js";
import { handler as viewRoute } from "../../src/scheduling/visitor/bookings-view.js";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const at = (s: string) => Date.parse(s);
const iso = (ms: number) => new Date(ms).toISOString();
const utcDay = (ms: number) => iso(ms).slice(0, 10);
const NOW = at("2026-12-01T10:07:00.000Z");   // Tuesday; a run of a rate schedule aligned at :07
const CUSTOMER = { email: "ana.pop@example.test", name: "Ana Pop", phone: "+40 700 000 000" };
const R1 = "res-r1";
const R2 = "res-r2";
const pk = (t: string) => `TENANT#${t}`;
/** The first token the mocked `mintToken` returns in a test (43 characters, as § 8.1). */
const TOKEN_1 = "tok1".padEnd(43, "_");

function tenant(id: string, over: Item = {}) {
    h.table.put({
        PK: "SYSTEM", SK: `TENANT#${id}`, id, name: `Site ${id}`, domain: `${id}.example`,
        schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest", reminderHours: 24 },
        integrations: { contactEmail: `owner@${id}.example` }, ...over,
    });
}

let n = 0;
/** A confirmed slot booking with its RESDAY# entry (rev = booking rev). Returns its id. */
function slot(t: string, start: number, opts: { state?: Item; resourceId?: string } = {}): string {
    n++;
    const id = `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
    const resourceId = opts.resourceId ?? R1;
    const state = opts.state ?? { kind: "confirmed", at: NOW - DAY };
    h.table.put({
        PK: pk(t), SK: `BOOKING#${id}`, id, ref: `B-${id.slice(0, 8)}`, rev: 2,
        what: { kind: "slot", serviceId: "svc1", serviceName: "Consultation", resourceId, start, end: start + HOUR },
        state, source: { kind: "visitor" }, who: CUSTOMER, tokenHashes: [], createdAt: NOW - DAY, updatedAt: NOW - DAY,
        history: [{ action: "created", at: NOW - DAY, state: "confirmed", placement: { kind: "slot", resourceId, start, end: start + HOUR } }],
    });
    putEntry(t, resourceId, id, start, 2, state.kind === "held" ? state.expiresAt : undefined);
    return id;
}
function putEntry(t: string, resourceId: string, id: string, s: number, rev: number, x?: number) {
    const sk = `RESDAY#${resourceId}#${utcDay(s)}`;
    const day = h.table.get(pk(t), sk) ?? { PK: pk(t), SK: sk, v: 1, entries: {} };
    day.entries[id] = { s, e: s + HOUR, rev, ...(x !== undefined ? { x } : {}) };
    h.table.put(day);
}
function dropEntry(t: string, resourceId: string, id: string, s: number) {
    const sk = `RESDAY#${resourceId}#${utcDay(s)}`;
    const day = h.table.get(pk(t), sk)!;
    delete day.entries[id];
    h.table.put(day);
}
/** A slot move as the store commits it: the booking's start and rev, the entry moved (§ 7.3). */
function move(t: string, id: string, to: number) {
    const b = h.table.get(pk(t), `BOOKING#${id}`)!;
    dropEntry(t, b.what.resourceId, id, b.what.start);
    h.table.put({ ...b, rev: b.rev + 1, what: { ...b.what, start: to, end: to + HOUR } });
    putEntry(t, b.what.resourceId, id, to, b.rev + 1);
}
function resource(t: string, id: string, name: string, rules: Item[] = [], days?: Item) {
    h.table.put({ PK: pk(t), SK: `RESOURCE#${id}`, id, name });
    if (rules.length > 0) h.table.put({ PK: pk(t), SK: `AVAILABILITY#${id}`, rules });
    if (days) h.table.put({ PK: pk(t), SK: `DAYS#${id}`, v: 1, days });
}
const WEEKDAYS_9_17 = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

const run = (now: number, scheduledAt = now) => runSchedulingJobs({ scheduledAt, now });
const mailsTo = (to: string) => h.mails.filter((m) => m.to === to);

let logs: string[];
beforeEach(() => {
    h.table.items.clear();
    h.table.commands = [];
    h.mails = [];
    h.sesAttempts = 0;
    h.sesRefuses = () => false;
    h.beforeMark = null;
    h.cleanups = [];
    h.cleanupThrowsFor.clear();
    h.markers.clear();
    h.markSentFails = false;
    h.tokens = 0;
    logs = [];
    const record = (...args: unknown[]) => { logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(record);
    vi.spyOn(console, "error").mockImplementation(record);
});
afterEach(() => vi.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("G10 reminders (§ 11.3)", () => {
    it("G10 the reminder's link works: its token opens the booking through the REAL token lookup and visitor view route; a token never issued does not", async () => {
        tenant("t1");
        resource("t1", R1, "Dr. One");
        const id = slot("t1", NOW + 3 * HOUR);
        await run(NOW);
        const token = /#t=([A-Za-z0-9_-]{43})/.exec(mailsTo(CUSTOMER.email)[0].body)![1];
        const view = async (t: string) => {
            const res = (await viewRoute({
                headers: { "x-tenant-id": "t1" }, body: JSON.stringify({ token: t }),
                requestContext: { authorizer: { lambda: { sub: "renderer", role: "RENDERER", tenantId: "ALL" } } },
            } as any, {} as any, () => {})) as { statusCode: number; body: string };
            return { status: res.statusCode, json: JSON.parse(res.body) };
        };
        const opened = await view(token);
        expect(opened.status).toBe(200);
        expect(opened.json.ref).toBe(`B-${id.slice(0, 8)}`);
        // Negative control: a well-formed token that no mail carried.
        expect(await view("n".repeat(43))).toMatchObject({ status: 404, json: { code: "linkNotValid" } });
    });

    it("G10 one reminder per start: the first run sends one with a working link shape; a second run sends nothing", async () => {
        tenant("t1");
        resource("t1", R1, "Dr. One");
        const id = slot("t1", NOW + 3 * HOUR);
        await run(NOW);
        expect(mailsTo(CUSTOMER.email)).toHaveLength(1);
        const mail = mailsTo(CUSTOMER.email)[0];
        expect(mail.subject).toBe(`Reminder: booking B-${id.slice(0, 8)}, 2026-12-01 15:07 (Europe/Bucharest)`);
        // The link carries the token `mintToken` returned for THIS mail (§ 8.4), on the tenant's domain.
        expect(mail.body).toContain(`https://t1.example/_booking/manage#t=${TOKEN_1}`);
        await run(NOW + 15 * MIN);
        expect(mailsTo(CUSTOMER.email)).toHaveLength(1);
        expect(h.table.get(pk("t1"), `BOOKING#${id}`)!.reminderSentFor).toBe(NOW + 3 * HOUR);
    });

    it("G10 the window is [now, now + reminderHours]: a start after the window or in the past gets none; a held booking gets none", async () => {
        tenant("t1", { scheduling: { timezone: "Europe/Bucharest", reminderHours: 2 } });
        resource("t1", R1, "Dr. One");
        slot("t1", NOW + 2 * HOUR);                    // exactly at the window end → in
        slot("t1", NOW + 2 * HOUR + MIN);              // after the window
        slot("t1", NOW - 30 * MIN);                    // started
        slot("t1", NOW + HOUR, { state: { kind: "held", expiresAt: NOW + 20 * MIN, mail: "sent" } });
        await run(NOW);
        expect(h.mails).toHaveLength(1);
    });

    it("G10 a move between selection and mark → no reminder for the old time; the next run reminds the new start", async () => {
        tenant("t1");
        resource("t1", R1, "Dr. One");
        const id = slot("t1", NOW + 3 * HOUR);
        h.beforeMark = (b) => { if (b === id) { h.beforeMark = null; move("t1", id, NOW + 5 * HOUR); } };
        const first = await run(NOW);
        expect(h.mails).toHaveLength(0);
        expect(first.reminders.stale).toBe(1);
        await run(NOW + 15 * MIN);
        expect(h.mails).toHaveLength(1);
        expect(h.mails[0].subject).toContain("2026-12-01 17:07 (Europe/Bucharest)");   // the new start
    });

    it("G10 a booking moved A → B → A after both reminders gets a second reminder for A (the documented limit)", async () => {
        tenant("t1");
        resource("t1", R1, "Dr. One");
        const A = NOW + 3 * HOUR;
        const B = NOW + 4 * HOUR;
        const id = slot("t1", A);
        await run(NOW);
        move("t1", id, B);
        await run(NOW + 15 * MIN);
        move("t1", id, A);
        await run(NOW + 30 * MIN);
        expect(h.mails.map((m) => m.subject.split(", ")[1])).toEqual([
            "2026-12-01 15:07 (Europe/Bucharest)", "2026-12-01 16:07 (Europe/Bucharest)", "2026-12-01 15:07 (Europe/Bucharest)",
        ]);
    });

    it("G10 a tenant with a domain and a saved `reminder` override: the text is the override, the link https://<domain>/_booking/manage#t=…", async () => {
        tenant("t1", { schedulingEmailConfig: { templates: { reminder: { subject: "See you {{customerName}}", body: "At {{when}}: {{link}} — {{siteName}}" } } } });
        resource("t1", R1, "Dr. One");
        slot("t1", NOW + 3 * HOUR);
        await run(NOW);
        expect(h.mails).toEqual([{
            to: CUSTOMER.email, subject: "See you Ana Pop",
            body: `At 2026-12-01 15:07 (Europe/Bucharest): https://t1.example/_booking/manage#t=${TOKEN_1} — Site t1`,
        }]);
    });

    it("G10 a tenant without a domain: the link base is the renderer origin and /_site/<id> (§ 8.2)", async () => {
        tenant("t2", { domain: "" });
        resource("t2", R1, "Dr. One");
        slot("t2", NOW + 3 * HOUR);
        await run(NOW);
        expect(h.mails[0].body).toContain("https://d111.cloudfront.net/_site/t2/_booking/manage#t=tok1");
    });

    it("G3 a confirmed seat booking of the removed group shape whose run starts in the reminder window: no mark, no mail, no failure; the appointment in the window is reminded", async () => {
        tenant("t1");
        resource("t1", R1, "Dr. One");
        storedGroupItems("t1", NOW + 5 * HOUR);
        const slotId = slot("t1", NOW + 5 * HOUR);
        const s = await run(NOW);
        expect(s.reminders).toMatchObject({ sent: 1, failed: 0 });
        expect(h.mails).toHaveLength(1);
        expect(h.mails[0].subject).toContain(`B-${slotId.slice(0, 8).toUpperCase()}`);
        expect(h.table.get(pk("t1"), "BOOKING#seat-1")!.reminderSentFor).toBeUndefined();
        expect(logs.join("\n")).not.toContain("storedDataInvalid");
    });

    it("G10 the mail is built from the booking as saved: a booking moved after the mark (before the mint) is not mailed", async () => {
        tenant("t1");
        resource("t1", R1, "Dr. One");
        const id = slot("t1", NOW + 3 * HOUR);
        const { mintToken } = await import("../../src/lib/scheduling-db.js");
        const realMint = (mintToken as any).getMockImplementation();
        (mintToken as any).mockImplementationOnce(async (...args: any[]) => { move("t1", id, NOW + 6 * HOUR); return realMint(...args); });
        const s = await run(NOW);
        expect(h.mails).toHaveLength(0);
        expect(s.reminders.placementChanged).toBe(1);
    });

    it("G10 a `reminder` override with sendToCustomer off → nothing marked or sent; reminderHours 0 → none", async () => {
        tenant("t1", { schedulingEmailConfig: { templates: { reminder: { subject: "x", body: "y", sendToCustomer: false } } } });
        tenant("t2", { scheduling: { timezone: "Europe/Bucharest", reminderHours: 0 } });
        for (const t of ["t1", "t2"]) { resource(t, R1, "Dr. One"); slot(t, NOW + 3 * HOUR); }
        await run(NOW);
        expect(h.mails).toHaveLength(0);
        expect([...h.table.items.values()].some((i) => i.reminderSentFor !== undefined)).toBe(false);
    });
});

/**
 * The items a table written before SCHED-GROUPS-REMOVE-1 can hold (rows G3, G5): a course, a run with one meeting at
 * `first` naming R1 as trainer, its RUNSPAN#, and a confirmed seat booking `seat-1` of CUSTOMER with its CUST# item.
 * No code reads them now; the tests below prove that their presence changes nothing.
 */
function storedGroupItems(t: string, first: number) {
    const local = (ms: number) => new Date(ms + 2 * HOUR).toISOString();   // Bucharest = UTC+2 in December
    h.table.put({ PK: pk(t), SK: "COURSE#c1", id: "c1", name: "Pottery", defaultCapacity: 8, languages: ["ro"] });
    h.table.put({
        PK: pk(t), SK: "RUN#c1#run1", id: "run1", courseId: "c1", timezone: "Europe/Bucharest", capacity: 8, trainerIds: [R1],
        language: { kind: "notSet" }, status: "open",
        meetings: [{ date: local(first).slice(0, 10), start: local(first).slice(11, 16), end: local(first + HOUR).slice(11, 16) }],
        firstStartIso: iso(first), lastEndIso: iso(first + HOUR), v: 1, seats: { "seat-1": {} },
    });
    h.table.put({ PK: pk(t), SK: `RUNSPAN#${iso(first + HOUR)}#c1#run1`, firstStartIso: iso(first) });
    h.table.put({
        PK: pk(t), SK: "BOOKING#seat-1", id: "seat-1", ref: "B-5EA70001", rev: 2, what: { kind: "seat", courseId: "c1", runId: "run1" },
        state: { kind: "confirmed", at: NOW - DAY }, source: { kind: "visitor" }, who: CUSTOMER, tokenHashes: [], createdAt: NOW - DAY,
        updatedAt: NOW - DAY, history: [{ action: "created", at: NOW - DAY, state: "confirmed", placement: { kind: "seat", runId: "run1" } }],
    });
    h.table.put({ PK: pk(t), SK: `CUST#${CUSTOMER.email}#seat-1` });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("§ 14.1 daily cleanup and tenant selection (C29 tenant part)", () => {
    it("C29 the 03:00-03:14 UTC run cleans EVERY tenant (switch off and broken settings included); other runs clean none; the switched-off tenant gets no reminder", async () => {
        tenant("t-on");
        tenant("t-off", { schedulingEnabled: false });
        tenant("t-broken", { scheduling: { timezone: "Not/AZone" } });
        tenant("t-never", { schedulingEnabled: undefined, scheduling: undefined });
        const night = at("2026-12-02T03:07:00.000Z");
        // The same booking, inside the reminder window at `night`, for a tenant switched on and one switched off.
        resource("t-on", R1, "Dr. On");
        resource("t-off", R1, "Dr. Off");
        const onId = slot("t-on", night + 3 * HOUR);
        const offId = slot("t-off", night + 3 * HOUR);
        const s = await run(night, night);
        expect(h.cleanups.map((c) => c.tenantId).sort()).toEqual(["t-broken", "t-never", "t-off", "t-on"]);
        expect(s.cleanup).toMatchObject({ tenants: 4, removed: 4, failed: 0 });
        expect(s.settingsInvalid).toBe(1);
        // Positive control: t-on's booking is reminded; t-off's identical booking is not (no mark, no mail).
        expect(h.mails).toHaveLength(1);
        expect(h.mails[0].body).toContain("https://t-on.example/_booking/manage#t=");
        expect(h.table.get(pk("t-on"), `BOOKING#${onId}`)!.reminderSentFor).toBe(night + 3 * HOUR);
        expect(h.table.get(pk("t-off"), `BOOKING#${offId}`)!.reminderSentFor).toBeUndefined();
        h.cleanups = [];
        await run(night + 15 * MIN, night + 15 * MIN);
        expect(h.cleanups).toEqual([]);
    });

    it("C29 the cleanup window: 03:00:00 and 03:14:59 are in, 02:59:59 and 03:15:00 are out", () => {
        expect(isCleanupRun(at("2026-12-02T03:00:00.000Z"))).toBe(true);
        expect(isCleanupRun(at("2026-12-02T03:14:59.999Z"))).toBe(true);
        expect(isCleanupRun(at("2026-12-02T02:59:59.999Z"))).toBe(false);
        expect(isCleanupRun(at("2026-12-02T03:15:00.000Z"))).toBe(false);
    });

    it("the handler takes the cleanup decision from the event's scheduled `time`, not from the clock", async () => {
        tenant("t-on");
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(at("2026-12-02T03:20:00.000Z"));   // a late invocation of the 03:05 run
        const s = await handler({ time: "2026-12-02T03:05:00Z" });
        vi.useRealTimers();
        expect(s.cleanupRun).toBe(true);
        expect(h.cleanups.map((c) => c.tenantId)).toEqual(["t-on"]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("cadence (§ 11.3): one rate(15 minutes) rule serves all three jobs", () => {
    /** Every scheduled time of one UTC day for a rate schedule aligned at minute `phase` (the rule's creation minute). */
    const day = (date: string, phase: number) => Array.from({ length: 96 }, (_, k) => at(`${date}T00:00:00.000Z`) + phase * MIN + k * 15 * MIN);

    it("§ 5.5 weekMailDue examples (Europe/Bucharest): 06:59Z notDue, 07:00Z due 2026-12-07, 21:59Z due, 22:00Z notDue, Sun 01:00 local notDue", () => {
        const tz = "Europe/Bucharest";
        expect(weekMailDue(at("2026-12-06T06:59:00Z"), tz)).toEqual({ kind: "notDue" });
        expect(weekMailDue(at("2026-12-06T07:00:00Z"), tz)).toEqual({ kind: "due", weekStart: "2026-12-07" });
        expect(weekMailDue(at("2026-12-06T21:59:00Z"), tz)).toEqual({ kind: "due", weekStart: "2026-12-07" });
        expect(weekMailDue(at("2026-12-06T22:00:00Z"), tz)).toEqual({ kind: "notDue" });
        expect(weekMailDue(at("2026-12-05T23:00:00Z"), tz)).toEqual({ kind: "notDue" });
    });

    it("whatever minute the rule is aligned to, every zone (incl. +05:45, +12:45 and two clock-change Sundays) gets ≥ 56 due runs, and every UTC day exactly one cleanup run", () => {
        const sundays: [string, string, string[]][] = [
            // [zone, local Sunday, the UTC dates that cover it]
            ["Europe/Bucharest", "2026-12-06", ["2026-12-05", "2026-12-06", "2026-12-07"]],
            ["Europe/Bucharest", "2027-03-28", ["2027-03-27", "2027-03-28", "2027-03-29"]],   // spring forward
            ["America/Los_Angeles", "2026-11-01", ["2026-10-31", "2026-11-01", "2026-11-02"]], // fall back
            ["Asia/Kathmandu", "2026-12-06", ["2026-12-05", "2026-12-06", "2026-12-07"]],
            ["Pacific/Chatham", "2026-12-06", ["2026-12-05", "2026-12-06", "2026-12-07"]],
        ];
        for (let phase = 0; phase < 15; phase++) {
            for (const [tz, sunday, dates] of sundays) {
                const due = dates.flatMap((d) => day(d, phase)).filter((t) => {
                    const d = weekMailDue(t, tz);
                    return d.kind === "due" && d.weekStart > sunday;
                });
                expect({ phase, tz, enough: due.length >= 56 }).toEqual({ phase, tz, enough: true });
            }
            for (const date of ["2026-12-06", "2027-03-28"]) {
                expect({ phase, date, cleanups: day(date, phase).filter(isCleanupRun).length }).toEqual({ phase, date, cleanups: 1 });
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("G14 weekly mail population and delivery (§ 11.4)", () => {
    // Sunday 2026-12-06 in Bucharest (UTC+2): 09:00 local = 07:00Z; Monday 00:00 local = 22:00Z.
    const SUN_0859 = at("2026-12-06T06:59:00.000Z");
    const SUN_0900 = at("2026-12-06T07:00:00.000Z");
    const SUN_0915 = at("2026-12-06T07:15:00.000Z");
    const OWNER = "owner@t1.example";
    const weekly = () => { tenant("t1"); resource("t1", R1, "Dr. One", WEEKDAYS_9_17); };

    it("G14 a Bucharest tenant with weekly hours: 08:59 none; 09:00 one mail and sentAt; 09:15 none (sentAt present)", async () => {
        weekly();
        await run(SUN_0859);
        expect(mailsTo(OWNER)).toHaveLength(0);
        await run(SUN_0900);
        expect(mailsTo(OWNER)).toHaveLength(1);
        expect(h.markers.get("t1#2026-12-07")).toEqual({ claimedAt: SUN_0900, sentAt: SUN_0900 });
        const s = await run(SUN_0915);
        expect(mailsTo(OWNER)).toHaveLength(1);
        expect(s.weekMail.alreadySent).toBe(1);
    });

    it("G6 a saved weekAhead override that names {{courseName}} and {{groupLink}}: both stay as written in the weekly mail, as before the removal (review SGR-R2)", async () => {
        tenant("t1", { schedulingEmailConfig: { templates: { weekAhead: { subject: "Week {{weekStart}} {{courseName}}", body: "Appointment summary|{{groupLink}}|{{courseName}}" } } } });
        resource("t1", R1, "Dr. One", WEEKDAYS_9_17);
        await run(SUN_0900);
        expect(mailsTo(OWNER).map((m) => ({ subject: m.subject, body: m.body }))).toEqual([
            { subject: "Week 2026-12-07 {{courseName}}", body: "Appointment summary|{{groupLink}}|{{courseName}}" },
        ]);
    });

    it("G3 G5 a course, a run and a seat booking of the removed group shape in the week: the weekly mail is the same as without them", async () => {
        weekly();
        await run(SUN_0900);
        const without = mailsTo(OWNER).map((m) => ({ subject: m.subject, body: m.body }));
        expect(without).toHaveLength(1);
        h.mails = [];
        h.markers.clear();
        storedGroupItems("t1", at("2026-12-08T08:00:00.000Z"));   // Tuesday of the mailed week, 10:00 Bucharest, trainer R1
        const s = await run(SUN_0900);
        expect(mailsTo(OWNER).map((m) => ({ subject: m.subject, body: m.body }))).toEqual(without);
        expect(s.weekMail).toMatchObject({ sent: 1 });
    });

    it("G14 none for: switch off; no resource with weekly hours; sendToAdmin false; no contactEmail (and the log line)", async () => {
        tenant("t-off", { schedulingEnabled: false });
        resource("t-off", R1, "Dr. One", WEEKDAYS_9_17);
        tenant("t-nohours");
        resource("t-nohours", R1, "Dr. Two");     // a resource with no AVAILABILITY# item
        tenant("t-quiet", { schedulingEmailConfig: { templates: { weekAhead: { subject: "s", body: "b", sendToAdmin: false } } } });
        resource("t-quiet", R1, "Dr. One", WEEKDAYS_9_17);
        tenant("t-nomail", { integrations: {} });
        resource("t-nomail", R1, "Dr. One", WEEKDAYS_9_17);
        const s = await run(SUN_0900);
        expect(h.mails).toHaveLength(0);
        expect(h.markers.size).toBe(0);   // no claim for any of them
        expect(s.weekMail).toMatchObject({ due: 3, noWeeklyHours: 1, off: 1, noContactEmail: 1, sent: 0 });
        expect(logs).toContain("[scheduling] weekly mail: no contactEmail t-nomail");
    });

    it("G14 an America/Los_Angeles tenant: none at the 03:00 UTC run of a Sunday (Saturday local), then one mail at Sunday 09:00 local", async () => {
        tenant("t-la", { scheduling: { timezone: "America/Los_Angeles", reminderHours: 24 } });
        resource("t-la", R1, "Dr. West", WEEKDAYS_9_17);
        await run(at("2026-12-06T03:00:00.000Z"), at("2026-12-06T03:00:00.000Z"));   // Sat 19:00 PST
        expect(h.mails).toHaveLength(0);
        await run(at("2026-12-06T17:00:00.000Z"));                                       // Sun 09:00 PST
        expect(mailsTo("owner@t-la.example")).toHaveLength(1);
        expect(h.markers.get("t-la#2026-12-07")?.sentAt).toBe(at("2026-12-06T17:00:00.000Z"));
    });

    it("G14 SES refuses at 09:00 and accepts at 09:15: one attempt each run, sentAt after 09:15, two attempts in total", async () => {
        weekly();
        h.sesRefuses = () => true;
        await run(SUN_0900);
        expect(h.markers.get("t1#2026-12-07")).toEqual({ claimedAt: SUN_0900 });
        h.sesRefuses = () => false;
        await run(SUN_0915);
        expect(h.sesAttempts).toBe(2);
        expect(h.markers.get("t1#2026-12-07")).toEqual({ claimedAt: SUN_0900, sentAt: SUN_0915 });
        expect(mailsTo(OWNER)).toHaveLength(1);
        expect(logs.some((l) => l.includes("[scheduling] weekly mail failed t1 2026-12-07 MessageRejected"))).toBe(true);
        expect(logs.join("\n")).not.toContain("secret detail");   // the error NAME only
    });

    it("G14 a fault after SES accepts and before sentAt → a second mail at the next run (the documented duplicate)", async () => {
        weekly();
        h.markSentFails = true;
        await run(SUN_0900);
        h.markSentFails = false;
        await run(SUN_0915);
        expect(mailsTo(OWNER)).toHaveLength(2);
        expect(h.markers.get("t1#2026-12-07")?.sentAt).toBe(SUN_0915);
    });

    it("G14 SES refuses every run until Monday 00:00 local; a run at Monday 00:15 sends nothing and writes no sentAt (the documented loss)", async () => {
        weekly();
        h.sesRefuses = () => true;
        for (const t of [SUN_0900, at("2026-12-06T13:00:00.000Z"), at("2026-12-06T21:45:00.000Z")]) await run(t);
        expect(h.sesAttempts).toBe(3);
        h.sesRefuses = () => false;
        const s = await run(at("2026-12-06T22:15:00.000Z"));   // Monday 00:15 local
        expect(s.weekMail.due).toBe(0);
        expect(h.mails).toHaveLength(0);
        expect(h.markers.get("t1#2026-12-07")?.sentAt).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("G15 weekly mail content (§ 11.4)", () => {
    it("G15 {{summary}} per day: source, windows, distinct active bookings (cross-midnight on both days), outside hours; the resource without hours or overrides is not listed; no customer field; the planner link", async () => {
        tenant("t1");
        // Week of Mon 2026-12-07 (Bucharest UTC+2). Tue: edited; Wed: day off with a booking; Thu 23:30 - Fri 00:30.
        resource("t1", R1, "Dr. One", WEEKDAYS_9_17, {
            "2026-12-08": { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] },
            "2026-12-09": { kind: "dayOff" },
        });
        resource("t1", R2, "Dr. Two");   // no weekly hours, no override in the week → not listed
        resource("t1", "res-r3", "Room", [], { "2026-12-12": { kind: "dayHours", windows: [{ start: "10:00", end: "12:00" }] } });   // no weekly hours, one override → listed
        const mon10 = at("2026-12-07T08:00:00.000Z");
        slot("t1", mon10);                                            // Mon 10:00-11:00 inside hours
        slot("t1", at("2026-12-09T08:00:00.000Z"));                  // Wed 10:00 on the day off → outside hours
        slot("t1", at("2026-12-10T21:30:00.000Z"));                  // Thu 23:30 - Fri 00:30 local
        slot("t1", at("2026-12-08T08:00:00.000Z"), { state: { kind: "cancelled", at: NOW, by: { kind: "customer" } } });
        dropEntry("t1", R1, [...h.table.items.values()].find((i) => i.state?.kind === "cancelled")!.id, at("2026-12-08T08:00:00.000Z"));
        await run(at("2026-12-06T07:00:00.000Z"));
        const mails = mailsTo("owner@t1.example");
        expect(mails).toHaveLength(1);
        const { subject, body } = mails[0];
        // § 11.4 default (ruling SCHED-1G1-WEEKMAIL-DEFAULT = A).
        expect(subject).toBe("Your week from 2026-12-07: hours and bookings");
        expect(body).toContain("Every week is open for booking from your weekly hours. You can change the hours of any day, or turn a day off, in the planner.");
        expect(body).toContain([
            "Dr. One",
            "  Mon 2026-12-07: default, 09:00-17:00, 1 booking",
            "  Tue 2026-12-08: edited, 09:00-12:00, 13:00-17:00, 0 bookings",
            "  Wed 2026-12-09: day off, no hours, 1 booking, 1 outside hours",
            "  Thu 2026-12-10: default, 09:00-17:00, 1 booking, 1 outside hours",
            "  Fri 2026-12-11: default, 09:00-17:00, 1 booking, 1 outside hours",
            "  Sat 2026-12-12: default, no hours, 0 bookings",
            "  Sun 2026-12-13: default, no hours, 0 bookings",
        ].join("\n"));
        expect(body).not.toContain("Dr. Two");
        // The resource with no weekly hours but an override in the week IS listed, after "Dr. One" (name order).
        expect(body).toContain("\n\nRoom\n  Mon 2026-12-07: default, no hours, 0 bookings");
        expect(body).toContain("  Sat 2026-12-12: edited, 10:00-12:00, 0 bookings\n  Sun 2026-12-13: default, no hours, 0 bookings");
        for (const v of [CUSTOMER.name, CUSTOMER.email, CUSTOMER.phone, "B-0000"]) expect(body).not.toContain(v);
        expect(body).toContain("https://admin.amodx.test/scheduling/planner?tenant=t1&week=2026-12-07");
        expect(body).toContain("Site t1");
        // No BOOKING# read by the weekly mail (counts only, § 6.3).
        const bookingReads = h.table.commands.filter((c: any) => JSON.stringify(c.input).includes("BOOKING#"));
        expect(bookingReads).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("G17 weekly mail on the C35 (3) items (§ 5.5 activeEntries, highest observed rev)", () => {
    it("G17 each day's count holds each booking once at its highest-rev placement; the moved booking counts on its new day only; sent, no error", async () => {
        tenant("t1", { scheduling: { timezone: "Europe/Bucharest", reminderHours: 0 } });   // no reminder Query: only the mail's
        resource("t1", R1, "Dr. One", WEEKDAYS_9_17);
        // The A25 (c), (d), (e) items of row C35 (3), one day later so both placements of (d) fall inside the target week:
        // s = 2026-12-07T23:30Z = Tue 01:30 local. (d) old placement Mon 22:30 local (rev 5), new Tue 03:30 local (rev 6).
        const NOW_SUN = at("2026-12-06T07:00:00.000Z");
        const s = at("2026-12-07T23:30:00.000Z");
        const x = NOW_SUN + HOUR;
        h.table.put({ PK: pk("t1"), SK: `RESDAY#${R1}#2026-12-07`, v: 4, entries: {
            C: { s, e: s + HOUR, x, rev: 3 }, D: { s: s - 3 * HOUR, e: s - 2 * HOUR, rev: 5 }, B: { s, e: s + HOUR, x, rev: 2 }, A: { s: s - HOUR, e: s + HOUR, rev: 7 },
        } });
        h.table.put({ PK: pk("t1"), SK: `RESDAY#${R1}#2026-12-08`, v: 2, entries: {
            C: { s, e: s + HOUR, rev: 4 }, D: { s: s + 2 * HOUR, e: s + 3 * HOUR, rev: 6 }, B: { s, e: s + HOUR, rev: 3 }, A: { s: s - HOUR, e: s + HOUR, rev: 7 },
        } });
        const summary = await run(NOW_SUN);
        expect(summary.weekMail).toMatchObject({ sent: 1, failed: 0, mailFailed: 0 });
        const body = mailsTo("owner@t1.example")[0].body;
        expect(body).toContain("  Mon 2026-12-07: default, 09:00-17:00, 0 bookings");                      // D's old placement not counted
        expect(body).toContain("  Tue 2026-12-08: default, 09:00-17:00, 4 bookings, 4 outside hours");     // A, B, C, D once each
        // Exactly one Query of RESDAY# for the resource and range.
        const resday = h.table.commands.filter((c: any) => c.op === "QueryCommand" && String(c.input.ExpressionAttributeValues[":lo"] ?? "").startsWith("RESDAY#"));
        expect(resday).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("isolation and the summary line", () => {
    it("one tenant's failure does not stop the others; the log carries ids and error names only; one summary line with counts", async () => {
        tenant("t-a");
        tenant("t-b");
        resource("t-b", R1, "Dr. B");
        slot("t-b", NOW + 3 * HOUR);
        h.cleanupThrowsFor.add("t-a");
        // Scheduled in the cleanup window; `now` puts t-b's booking (NOW + 3 h) in its reminder window.
        const s = await run(NOW, at("2026-12-02T03:07:00.000Z"));
        expect(s.cleanup).toMatchObject({ tenants: 1, failed: 1 });
        expect(h.cleanups.map((c) => c.tenantId)).toEqual(["t-b"]);
        expect(s.reminders.sent).toBe(1);
        expect(logs).toContain("[scheduling] cleanup failed t-a ProvisionedThroughputExceededException");
        expect(logs.join("\n")).not.toContain("secret detail");
        const lines = logs.filter((l) => l.startsWith("[scheduling] job summary"));
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0].slice("[scheduling] job summary ".length));
        expect(parsed).toMatchObject({ tenants: 2, cleanupRun: true, reminders: { sent: 1 } });
        expect(lines[0]).not.toContain(CUSTOMER.email);
    });

    it("two runs at once: reminders send ONE mail per booking and start (the conditional mark); the weekly mail can be sent TWICE (both claims return no sentAt: the documented duplicate, C34)", async () => {
        tenant("t1");
        resource("t1", R1, "Dr. One", WEEKDAYS_9_17);
        const sun = at("2026-12-06T07:00:00.000Z");
        slot("t1", sun + 3 * HOUR);
        const [a, b] = await Promise.all([run(sun), run(sun)]);
        expect(mailsTo(CUSTOMER.email)).toHaveLength(1);
        expect(a.reminders.sent + b.reminders.sent).toBe(1);
        expect(a.reminders.stale + b.reminders.stale).toBe(1);
        expect(mailsTo("owner@t1.example")).toHaveLength(2);
    });

    it("the tenant read is one main-table Query on PK SYSTEM with a projection (no scan)", async () => {
        tenant("t1");
        await run(NOW);
        const tenantReads = h.table.commands.filter((c: any) => c.input.TableName === "main-table");
        expect(tenantReads.map((c: any) => c.op)).toEqual(["QueryCommand"]);
        expect(tenantReads[0].input.ExpressionAttributeValues).toEqual({ ":pk": "SYSTEM", ":p": "TENANT#" });
        expect(tenantReads[0].input.ProjectionExpression).toBeDefined();
    });
});
