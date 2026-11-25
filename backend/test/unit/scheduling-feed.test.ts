import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { BatchGetCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

/**
 * SCHED-1G1 — the calendar feed, POST /scheduling/visitor/feed (docs/slices/sched-1.md § 12; § 17.3 row G11).
 *
 * REAL: the handler, `requireRole`, every read of `scheduling-db.ts` it calls (`getResource`, `readIntervals` with
 * `activeEntries`, `getBookingViews`), the kernel, `feedCalendar`.
 * REPLACED: the DynamoDB client of both tables by `ReadTable` below (an in-memory READ-ONLY table: Get, Query with
 * `begins_with` or `BETWEEN` on SK, BatchGet, projections with aliases and dotted paths; it records every command).
 * The feed writes nothing, so a write command fails the test. Clock: `Date` faked at `NOW`. Credential-free.
 * The seed also holds items of the removed group shape (a course, a run with seats, its `RUNSPAN#`), as a table written
 * before SCHED-GROUPS-REMOVE-1 can: every test here runs with them present (rows G3 and G5 of that slice).
 */

type Item = Record<string, any>;

const h = vi.hoisted(() => {
    process.env.SCHEDULING_TABLE_NAME = "sched-table";
    // Inside vi.hoisted: vi.mock factories run before the module body, so the fake is declared here.
    type Item = Record<string, any>;
    /** In-memory read-only DynamoDB (one partition space for both tables; the main table uses PK `SYSTEM`). */
    const ReadTable = class {
        items = new Map<string, Item>();
        commands: { op: string; input: any }[] = [];
        /** BatchGet: report every key as unprocessed (row § 6.4 rule 2 → 503 busy). */
        unprocessed = false;
        /** A lagging replica: an EVENTUALLY consistent Get of a key listed here returns this older copy (review S1G1-R02). */
        stale = new Map<string, Item>();
        put(item: Item) { this.items.set(`${item.PK}\u0000${item.SK}`, structuredClone(item)); }
        remove(pk: string, sk: string) { this.items.delete(`${pk}\u0000${sk}`); }
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
                const k = `${input.Key.PK}\u0000${input.Key.SK}`;
                const item = input.ConsistentRead !== true && this.stale.has(k) ? this.stale.get(k) : this.items.get(k);
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
                if (this.unprocessed) return { Responses: { [table]: [] }, UnprocessedKeys: { [table]: req } };
                const found = req.Keys.map((k: any) => this.items.get(`${k.PK}\u0000${k.SK}`)).filter(Boolean)
                    .map((i: Item) => this.project(i, req.ProjectionExpression, req.ExpressionAttributeNames));
                return { Responses: { [table]: found } };
            }
            throw new Error(`the feed must not send ${cmd.constructor.name}`);
        }
    };
    return { table: new ReadTable() };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => h.table.send(cmd) }, TABLE_NAME: "main-table" }));

import { handler as feedRoute, feedCalendar } from "../../src/scheduling/visitor/feed.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.parse("2026-12-01T10:00:00.000Z");
const SECRET = "S".repeat(43);
const OLD_SECRET = "O".repeat(43);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const R1 = "res-r1";
const R2 = "res-r2";
const PK = "TENANT#t1";
const CUSTOMER = { email: "ana.pop@example.test", name: "Ana Pop", phone: "+40 700 000 000" };
const RENDERER = { sub: "renderer", role: "RENDERER", tenantId: "ALL" };

/** A booking item as `scheduling-db.ts` stores it (§ 4.4). */
function bookingItem(id: string, start: number, state: Item, resourceId = R1): Item {
    return {
        PK, SK: `BOOKING#${id}`, id, ref: `B-${id.slice(0, 8).toUpperCase()}`, rev: 2,
        what: { kind: "slot", serviceId: "svc1", serviceName: "Consultation", resourceId, start, end: start + HOUR },
        state, source: { kind: "visitor" }, who: CUSTOMER, tokenHashes: [], createdAt: NOW - DAY, updatedAt: NOW - DAY,
        history: [{ action: "created", at: NOW - DAY, state: "held", placement: { kind: "slot", resourceId, start, end: start + HOUR } }],
    };
}
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A run of course c1 as stored before SCHED-GROUPS-REMOVE-1 (meetings as Bucharest local times); nothing reads it now. */
function runItem(runId: string, trainerIds: string[], meetings: { date: string; start: string; end: string }[], extra: Item = {}): Item {
    return {
        PK, SK: `RUN#c1#${runId}`, id: runId, courseId: "c1", timezone: "Europe/Bucharest", capacity: 8, trainerIds,
        language: { kind: "notSet" }, status: "open", meetings, firstStartIso: "", lastEndIso: "", v: 1,
        seats: { "bk-1": {}, "bk-2": { x: NOW + HOUR }, "bk-3": { x: NOW - HOUR } }, ...extra,
    };
}
function putRun(run: Item, firstStartIso: string, lastEndIso: string) {
    h.table.put({ ...run, firstStartIso, lastEndIso });
    h.table.put({ PK, SK: `RUNSPAN#${lastEndIso}#c1#${run.id}`, firstStartIso });
}

const C_ID = "0a000001-0000-4000-8000-000000000001";
const H_ID = "0b000002-0000-4000-8000-000000000002";
const X_ID = "0c000003-0000-4000-8000-000000000003";
const CONFIRMED_START = Date.parse("2026-12-07T07:00:00.000Z"); // Mon 09:00 Bucharest
const HELD_START = Date.parse("2026-12-08T07:00:00.000Z");
const EXPIRED_START = Date.parse("2026-12-09T07:00:00.000Z");

function seed() {
    h.table.items.clear();
    h.table.unprocessed = false;
    h.table.stale.clear();
    h.table.commands = [];
    h.table.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Clinic", schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" } });
    h.table.put({ PK, SK: `RESOURCE#${R1}`, id: R1, name: "Dr. One", feedSecretHash: sha(SECRET) });
    h.table.put({ PK, SK: `RESOURCE#${R2}`, id: R2, name: "Dr. Two", feedSecretHash: sha("T".repeat(43)) });
    h.table.put({ PK, SK: "COURSE#c1", id: "c1", name: "Pottery, beginners", defaultCapacity: 8, languages: ["ro"] });
    h.table.put(bookingItem(C_ID, CONFIRMED_START, { kind: "confirmed", at: NOW - DAY }));
    h.table.put(bookingItem(H_ID, HELD_START, { kind: "held", expiresAt: NOW + HOUR, mail: "sent" }));
    h.table.put(bookingItem(X_ID, EXPIRED_START, { kind: "held", expiresAt: NOW - HOUR, mail: "sent" }));
    const entry = (s: number, rev: number, x?: number) => ({ s, e: s + HOUR, rev, ...(x !== undefined ? { x } : {}) });
    h.table.put({ PK, SK: `RESDAY#${R1}#${utcDay(CONFIRMED_START)}`, v: 1, entries: { [C_ID]: entry(CONFIRMED_START, 2) } });
    h.table.put({ PK, SK: `RESDAY#${R1}#${utcDay(HELD_START)}`, v: 1, entries: { [H_ID]: entry(HELD_START, 2, NOW + HOUR) } });
    h.table.put({ PK, SK: `RESDAY#${R1}#${utcDay(EXPIRED_START)}`, v: 1, entries: { [X_ID]: entry(EXPIRED_START, 2, NOW - HOUR) } });
    // Items of the removed group shape: a run with a meeting inside the window, naming R1 as trainer (rows G3, G5).
    putRun(runItem("run-long", [R1], [
        { date: "2026-09-22", start: "10:00", end: "12:00" },   // 2026-09-22T07:00Z: before NOW − 60 days
        { date: "2026-12-05", start: "10:00", end: "13:00" },   // Bucharest UTC+2 → 08:00Z-11:00Z
    ]), "2026-09-22T07:00:00.000Z", "2026-12-05T11:00:00.000Z");
}

async function feed(body: unknown, opts: { auth?: Item; tenant?: string; raw?: string } = {}) {
    const event = {
        headers: { "x-tenant-id": opts.tenant ?? "t1" },
        requestContext: { authorizer: { lambda: opts.auth ?? RENDERER } },
        body: opts.raw ?? JSON.stringify(body),
    };
    return (await feedRoute(event as any, {} as any, () => {})) as { statusCode: number; body: string; headers: Record<string, string> };
}
const ok = (resourceId = R1, secret = SECRET) => feed({ resourceId, secret });
/** The VEVENT blocks of a body, unfolded (a continuation line starts with one space). */
const events = (body: string) => body.replace(/\r\n /g, "").split("BEGIN:VEVENT").slice(1).map((b) => b.split("END:VEVENT")[0]);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    seed();
});
afterEach(() => vi.useRealTimers());

describe("G11 calendar feed (§ 12)", () => {
    it("G11 a valid secret → 200 text/calendar, private max-age=300, UTC times, CRLF lines, one event per active appointment in the window", async () => {
        const res = await ok();
        expect(res.statusCode).toBe(200);
        expect(res.headers["Content-Type"]).toBe("text/calendar; charset=utf-8");
        expect(res.headers["Cache-Control"]).toBe("private, max-age=300");
        expect(res.body.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
        expect(res.body.endsWith("END:VCALENDAR\r\n")).toBe(true);
        expect(res.body.replace(/\r\n/g, "")).not.toMatch(/\n/);   // every line break is CRLF
        const ev = events(res.body);
        expect(ev).toHaveLength(2);   // confirmed slot, held slot (not the expired hold)
        const confirmed = ev.find((e) => e.includes(`UID:${C_ID}@t1`))!;
        expect(confirmed).toContain("DTSTART:20261207T070000Z");
        expect(confirmed).toContain("DTEND:20261207T080000Z");
        expect(confirmed).toContain("SUMMARY:Consultation B-0A000001");
        expect(confirmed).toContain("STATUS:CONFIRMED");
        expect(confirmed).toContain("DTSTAMP:20261201T100000Z");
        expect(ev.find((e) => e.includes(`UID:${H_ID}@t1`))).toContain("STATUS:TENTATIVE");
        expect(res.body).not.toContain(X_ID);
        for (const line of res.body.split("\r\n").filter((l) => /^DT(START|END|STAMP):/.test(l))) expect(line).toMatch(/^\w+:\d{8}T\d{6}Z$/);
        expect(res.body).not.toContain("VTIMEZONE");
    });

    it("G3 G5 a course, a run (trainer R1, a meeting in the window) and a seat booking of the removed group shape: 200 with the two appointments only; no request names a group key or the seat booking", async () => {
        const seatId = "0d000004-0000-4000-8000-000000000004";
        h.table.put({ ...bookingItem(seatId, CONFIRMED_START, { kind: "confirmed", at: NOW - DAY }), what: { kind: "seat", courseId: "c1", runId: "run-long" },
            history: [{ action: "created", at: NOW - DAY, state: "confirmed", placement: { kind: "seat", runId: "run-long" } }] });
        const res = await ok();
        expect(res.statusCode).toBe(200);
        expect(events(res.body).map((e) => /UID:([^\r\n]*)/.exec(e)![1]).sort()).toEqual([`${C_ID}@t1`, `${H_ID}@t1`]);
        expect(res.body).not.toContain("run-long");
        expect(res.body).not.toContain("Pottery");
        const sent = JSON.stringify(h.table.commands.map((c: any) => c.input));
        expect(sent).toContain(`RESDAY#${R1}#`);   // control: the recorded requests are the feed's reads
        for (const key of ["COURSE#", "RUN#", "RUNSPAN#", seatId]) expect({ key, named: sent.includes(key) }).toEqual({ key, named: false });
    });

    it("G11 no customer field: no name, email or phone in the body, and the BOOKING# read does not ask for `who`", async () => {
        const res = await ok();
        for (const value of [CUSTOMER.name, CUSTOMER.email, CUSTOMER.phone, "Ana", "example.test"]) expect(res.body).not.toContain(value);
        const bookingReads = h.table.commands.filter((c: any) => c.op === "BatchGetCommand"
            && Object.values(c.input.RequestItems as Record<string, any>)[0].Keys.some((k: any) => String(k.SK).startsWith("BOOKING#")));
        expect(bookingReads).toHaveLength(1);
        const req = Object.values(bookingReads[0].input.RequestItems as Record<string, any>)[0];
        const projected = req.ProjectionExpression.split(", ").map((p: string) => p.split(".").map((a) => req.ExpressionAttributeNames[a]).join("."));
        expect(projected.sort()).toEqual(["SK", "id", "ref", "state", "what"]);
    });

    it("G11 the old secret → 404 after rotation; same body and the same reads as an unknown resource and a resource with no secret", async () => {
        h.table.put({ PK, SK: `RESOURCE#${R1}`, id: R1, name: "Dr. One", feedSecretHash: sha(OLD_SECRET) });
        expect((await feed({ resourceId: R1, secret: OLD_SECRET })).statusCode).toBe(200);
        h.table.put({ PK, SK: `RESOURCE#${R1}`, id: R1, name: "Dr. One", feedSecretHash: sha(SECRET) });   // rotation

        const trace = async (body: Item) => {
            h.table.commands = [];
            const res = await feed(body);
            return { status: res.statusCode, body: res.body, reads: h.table.commands.map((c: any) => `${c.op} ${c.input.Key?.SK ?? ""}`) };
        };
        const rotated = await trace({ resourceId: R1, secret: OLD_SECRET });
        const unknown = await trace({ resourceId: "res-unknown", secret: SECRET });
        h.table.put({ PK, SK: "RESOURCE#res-nosecret", id: "res-nosecret", name: "No feed" });
        const noSecret = await trace({ resourceId: "res-nosecret", secret: SECRET });
        expect(rotated.status).toBe(404);
        expect(JSON.parse(rotated.body)).toEqual({ error: "This link is not valid.", code: "linkNotValid" });
        expect(unknown.body).toBe(rotated.body);
        expect(noSecret.body).toBe(rotated.body);
        // One timing class: the tenant record, then the resource, then the answer — nothing else for any of the three.
        expect(rotated.reads).toEqual(["GetCommand TENANT#t1", `GetCommand RESOURCE#${R1}`]);
        expect(unknown.reads).toEqual(["GetCommand TENANT#t1", "GetCommand RESOURCE#res-unknown"]);
        expect(noSecret.reads).toEqual(["GetCommand TENANT#t1", "GetCommand RESOURCE#res-nosecret"]);
    });

    it("G11 rotation acts at once even while a replica still holds the old hash: the secret and switch reads are consistent (S1G1-R02)", async () => {
        const oldResource = { PK, SK: `RESOURCE#${R1}`, id: R1, name: "Dr. One", feedSecretHash: sha(OLD_SECRET) };
        h.table.stale.set(`${PK}\u0000RESOURCE#${R1}`, oldResource);   // the rotation to SECRET committed; a replica lags
        // Positive control: the fake really serves the old hash to an eventually consistent read.
        const lagging = await h.table.send(new GetCommand({ TableName: "sched-table", Key: { PK, SK: `RESOURCE#${R1}` } }));
        expect(lagging.Item.feedSecretHash).toBe(sha(OLD_SECRET));
        h.table.commands = [];
        const old = await feed({ resourceId: R1, secret: OLD_SECRET });
        expect(old.statusCode).toBe(404);
        expect(JSON.parse(old.body).code).toBe("linkNotValid");
        expect((await ok()).statusCode).toBe(200);
        const access = h.table.commands.filter((c: any) => c.op === "GetCommand");
        expect(access.map((c: any) => [c.input.Key.SK, c.input.ConsistentRead])).toContainEqual([`RESOURCE#${R1}`, true]);
        expect(access.map((c: any) => [c.input.Key.SK, c.input.ConsistentRead])).toContainEqual(["TENANT#t1", true]);
        // A switch-off that a replica has not seen yet also acts at once.
        h.table.stale.set("SYSTEM\u0000TENANT#t1", { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", schedulingEnabled: true });
        h.table.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", schedulingEnabled: false });
        expect((await ok()).statusCode).toBe(404);
    });

    it("G11 switch off, no tenant record, a malformed secret or resource id → the same 404 body; another role → 403; a body that is not JSON → 400", async () => {
        const notValid = (await feed({ resourceId: R1, secret: OLD_SECRET })).body;
        h.table.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", schedulingEnabled: false });
        expect(await feed({ resourceId: R1, secret: SECRET })).toMatchObject({ statusCode: 404, body: notValid });
        seed();
        expect(await feed({ resourceId: R1, secret: SECRET }, { tenant: "t-none" })).toMatchObject({ statusCode: 404, body: notValid });
        expect(await feed({ resourceId: R1, secret: "short" })).toMatchObject({ statusCode: 404, body: notValid });
        expect(await feed({ resourceId: "a#b", secret: SECRET })).toMatchObject({ statusCode: 404, body: notValid });
        expect(await feed({ resourceId: R1, secret: SECRET, extra: 1 })).toMatchObject({ statusCode: 404, body: notValid });
        expect((await feed({ resourceId: R1, secret: SECRET }, { auth: { sub: "u1", role: "TENANT_ADMIN", tenantId: "t1", email: "a@t1.test" } })).statusCode).toBe(403);
        expect((await feed(undefined, { raw: "{not json" })).statusCode).toBe(400);
    });

    it("G11 a booking BatchGet that never finishes → 503 busy (never a partial feed)", async () => {
        h.table.unprocessed = true;
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await ok();
        log.mockRestore();
        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.body).code).toBe("busy");
    });
});

describe("G11 feedCalendar (pure)", () => {
    it("G11 folds lines longer than 75 octets without splitting a UTF-8 character, and escapes TEXT", () => {
        const text = feedCalendar({
            tenantId: "t1", now: NOW,
            slots: [{ bookingId: "b1", ref: "B-1", serviceName: `Ședință; lungă, ${"ă".repeat(60)}\nrând`, start: NOW, end: NOW + HOUR, held: false }],
        });
        for (const line of text.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
        const summary = text.replace(/\r\n /g, "").split("\r\n").find((l) => l.startsWith("SUMMARY:"))!;
        expect(summary).toBe(`SUMMARY:Ședință\\; lungă\\, ${"ă".repeat(60)}\\nrând B-1`);
    });

    it("G11 the same data gives the same text (events sorted by start, then UID)", () => {
        const a = { bookingId: "b2", ref: "B-2", serviceName: "X", start: NOW + HOUR, end: NOW + 2 * HOUR, held: true };
        const b = { bookingId: "b1", ref: "B-1", serviceName: "X", start: NOW, end: NOW + HOUR, held: false };
        const one = feedCalendar({ tenantId: "t1", now: NOW, slots: [a, b] });
        expect(feedCalendar({ tenantId: "t1", now: NOW, slots: [b, a] })).toBe(one);
        expect(one.indexOf("UID:b1@t1")).toBeLessThan(one.indexOf("UID:b2@t1"));
    });
});
