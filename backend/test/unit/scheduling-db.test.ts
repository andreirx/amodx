/**
 * SCHED-1C unit rows (docs/slices/sched-1.md § 17.3 table `sched-1c`, rows C1…C35). No AWS: every test runs the
 * REAL `scheduling-db.ts` against `FakeTable`, an in-memory client that
 *   - records every command input (transaction sizes and shapes are asserted from the record);
 *   - evaluates the expression grammar the module emits (conditions, updates, key conditions, projections) and
 *     answers like DynamoDB: `ConditionalCheckFailedException`, `TransactionCanceledException` with one reason per
 *     item in order, `ValidationException` for unused aliases, two operations on one item, or a SET under a
 *     missing map; anything outside the grammar throws, so a test cannot pass on an expression the fake guessed;
 *   - runs injected hooks before or after a chosen command: a competing operation (interleavings of § 7, § 8.4,
 *     § 13, § 14) or a thrown "crash" (a fault after a commit).
 * Concurrency on a real table is in `backend/test/scheduling-db.integration.test.ts` (operator-run).
 *
 * Abstraction line: `FakeTable` — users: every test in this file; axis: none (one test double); rejected:
 * `aws-sdk-client-mock` scripted answers (they record inputs but cannot show that a condition the module wrote
 * refuses the state it must refuse, which is what most rows assert).
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
    BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { activeEntries, tokenView, type Person } from "@amodx/shared";
import * as sdb from "../../src/lib/scheduling-db";

// ---------------------------------------------------------------------------------------------------------------
// FakeTable
// ---------------------------------------------------------------------------------------------------------------

type Item = Record<string, any>;
type Hook = { op: string; when?: (input: any) => boolean; phase: "before" | "after"; run: () => unknown };

const ddbError = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name, ...extra });

class Parser {
    i = 0;
    readonly used = new Set<string>();
    constructor(private readonly t: string[], private readonly names: Record<string, string>, private readonly values: Record<string, unknown>) {}
    peek(): string | undefined { return this.t[this.i]; }
    next(): string {
        const tok = this.t[this.i++];
        if (tok === undefined) throw new Error("fake: unexpected end of expression");
        return tok;
    }
    expect(tok: string): void {
        const got = this.next();
        if (got.toUpperCase() !== tok) throw new Error(`fake: expected ${tok}, got ${got}`);
    }
    done(): boolean { return this.i >= this.t.length; }
    segment(tok: string): string {
        if (tok.startsWith("#")) {
            if (!(tok in this.names)) throw ddbError("ValidationException", { message: `undefined name ${tok}` });
            this.used.add(tok);
            return this.names[tok];
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) throw new Error(`fake: bad path segment ${tok}`);
        return tok;
    }
    path(): string[] {
        const segs = [this.segment(this.next())];
        while (this.peek() === ".") { this.next(); segs.push(this.segment(this.next())); }
        return segs;
    }
    operand(): { v: unknown } | { path: string[] } {
        const tok = this.peek() as string;
        if (tok?.startsWith(":")) {
            this.next();
            if (!(tok in this.values)) throw ddbError("ValidationException", { message: `undefined value ${tok}` });
            this.used.add(tok);
            return { v: this.values[tok] };
        }
        return { path: this.path() };
    }
}

function tokenize(s: string): string[] {
    const out: string[] = [];
    const re = /\s*(<>|<=|>=|[=<>(),.+-]|[#:]?[A-Za-z_][A-Za-z0-9_]*)\s*/y;
    let m: RegExpExecArray | null;
    while (re.lastIndex < s.length && (m = re.exec(s)) !== null) out.push(m[1]);
    if (re.lastIndex < s.length && s.slice(re.lastIndex).trim() !== "") throw new Error(`fake: cannot tokenize ${s}`);
    return out;
}

const getPath = (item: Item | undefined, p: string[]): unknown =>
    p.reduce<unknown>((o, seg) => (o !== null && typeof o === "object" ? (o as Item)[seg] : undefined), item);

const canon = (v: unknown): string => JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1))) : val);

type Cond = (item: Item | undefined) => boolean;

function parseCondition(p: Parser): Cond {
    const orTerms: Cond[] = [parseAnd(p)];
    while (p.peek()?.toUpperCase() === "OR") { p.next(); orTerms.push(parseAnd(p)); }
    return (item) => orTerms.some((c) => c(item));
}
function parseAnd(p: Parser): Cond {
    const terms: Cond[] = [parseUnary(p)];
    while (p.peek()?.toUpperCase() === "AND") { p.next(); terms.push(parseUnary(p)); }
    return (item) => terms.every((c) => c(item));
}
function parseUnary(p: Parser): Cond {
    const tok = p.peek() as string;
    if (tok === "(") { p.next(); const c = parseCondition(p); p.expect(")"); return c; }
    if (tok === "attribute_exists" || tok === "attribute_not_exists") {
        p.next(); p.expect("("); const path = p.path(); p.expect(")");
        return tok === "attribute_exists" ? (item) => getPath(item, path) !== undefined : (item) => getPath(item, path) === undefined;
    }
    if (tok === "begins_with") {
        p.next(); p.expect("("); const path = p.path(); p.expect(","); const o = p.operand(); p.expect(")");
        return (item) => {
            const a = getPath(item, path);
            const b = "v" in o ? o.v : getPath(item, o.path);
            return typeof a === "string" && typeof b === "string" && a.startsWith(b);
        };
    }
    const a = p.operand();
    const op = p.next();
    const val = (o: { v: unknown } | { path: string[] }, item: Item | undefined) => ("v" in o ? o.v : getPath(item, o.path));
    if (op.toUpperCase() === "BETWEEN") {
        const lo = p.operand(); p.expect("AND"); const hi = p.operand();
        return (item) => {
            const x = val(a, item) as any, l = val(lo, item) as any, h = val(hi, item) as any;
            return x !== undefined && x >= l && x <= h;
        };
    }
    const b = p.operand();
    return (item) => {
        const x = val(a, item) as any;
        const y = val(b, item) as any;
        if (x === undefined || y === undefined) {
            if (op === "<>") throw new Error("fake: <> on a missing attribute (semantics not modelled)");
            return false;
        }
        switch (op) {
            case "=": return canon(x) === canon(y);
            case "<>": return canon(x) !== canon(y);
            case "<": return x < y;
            case "<=": return x <= y;
            case ">": return x > y;
            case ">=": return x >= y;
            default: throw new Error(`fake: operator ${op}`);
        }
    };
}

function setPath(target: Item, p: string[], value: unknown): void {
    let o: any = target;
    for (const seg of p.slice(0, -1)) {
        if (o[seg] === null || typeof o[seg] !== "object") {
            throw ddbError("ValidationException", { message: "The document path provided in the update expression is invalid for update" });
        }
        o = o[seg];
    }
    o[p[p.length - 1]] = structuredClone(value);
}
function removePath(target: Item, p: string[]): void {
    const parent: any = getPath(target, p.slice(0, -1));
    if (parent && typeof parent === "object") delete parent[p[p.length - 1]];
}

function applyUpdate(p: Parser, before: Item | undefined, keyAttrs: Item): Item {
    const next: Item = structuredClone(before ?? keyAttrs);
    while (!p.done()) {
        const clause = p.next().toUpperCase();
        do {
            if (p.peek() === ",") p.next();
            if (clause === "SET") {
                const target = p.path();
                p.expect("=");
                let value: unknown;
                if (p.peek() === "if_not_exists") {
                    p.next(); p.expect("("); const src = p.path(); p.expect(","); const o = p.operand(); p.expect(")");
                    const existing = getPath(before, src);
                    value = existing !== undefined ? existing : ("v" in o ? o.v : getPath(before, o.path));
                } else {
                    const o = p.operand();
                    value = "v" in o ? o.v : getPath(before, o.path);
                }
                setPath(next, target, value);
            } else if (clause === "REMOVE") {
                removePath(next, p.path());
            } else if (clause === "ADD") {
                const target = p.path();
                const o = p.operand();
                const cur = getPath(next, target);
                setPath(next, target, (typeof cur === "number" ? cur : 0) + ((o as { v: number }).v));
            } else {
                throw new Error(`fake: update clause ${clause}`);
            }
        } while (p.peek() === ",");
    }
    return next;
}

/** Parse a projection once per request (its aliases count as used even when no item is returned). */
function projectionPaths(expr: string | undefined, names: Record<string, string>, used: Set<string>): string[][] | undefined {
    if (!expr) return undefined;
    return expr.split(",").map((part) => {
        const p = new Parser(tokenize(part.trim()), names, {});
        const path = p.path();
        if (!p.done()) throw new Error(`fake: bad projection ${expr}`);
        p.used.forEach((u) => used.add(u));
        return path;
    });
}

function project(item: Item, paths: string[][] | undefined): Item {
    if (!paths) return structuredClone(item);
    const out: Item = {};
    for (const path of paths) {
        const v = getPath(item, path);
        if (v === undefined) continue;
        let o: any = out;
        for (const seg of path.slice(0, -1)) o = o[seg] ??= {};
        o[path[path.length - 1]] = structuredClone(v);
    }
    return out;
}

function checkUnused(names: Record<string, string> | undefined, values: Record<string, unknown> | undefined, used: Set<string>): void {
    for (const k of [...Object.keys(names ?? {}), ...Object.keys(values ?? {})]) {
        if (!used.has(k)) throw ddbError("ValidationException", { message: `unused in expressions: ${k}` });
    }
}

class FakeTable {
    readonly items = new Map<string, Item>();
    readonly calls: { op: string; input: any }[] = [];
    readonly hooks: Hook[] = [];
    pageSize = Number.POSITIVE_INFINITY;
    unprocessedRounds = 0;
    readonly client = { send: (cmd: any) => this.send(cmd) };

    static id(pk: string, sk: string): string { return `${pk}\u0000${sk}`; }
    get(pk: string, sk: string): Item | undefined { return this.items.get(FakeTable.id(pk, sk)); }
    putRaw(item: Item): void { this.items.set(FakeTable.id(item.PK, item.SK), structuredClone(item)); }
    deleteRaw(pk: string, sk: string): void { this.items.delete(FakeTable.id(pk, sk)); }
    sks(prefix = ""): string[] {
        return [...this.items.values()].map((i) => i.SK as string).filter((sk) => sk.startsWith(prefix)).sort();
    }
    /** Run `run` once, before or after the next command `op` (that matches `when`). */
    on(op: string, phase: "before" | "after", run: () => unknown, when?: (input: any) => boolean): void {
        this.hooks.push({ op, phase, run, when });
    }
    ops(op: string): any[] { return this.calls.filter((c) => c.op === op).map((c) => c.input); }
    txSizes(): number[] { return this.ops("TransactWriteCommand").map((i) => i.TransactItems.length); }

    private async runHook(op: string, phase: "before" | "after", input: any): Promise<void> {
        const i = this.hooks.findIndex((h) => h.op === op && h.phase === phase && (h.when?.(input) ?? true));
        if (i < 0) return;
        const [h] = this.hooks.splice(i, 1);
        await h.run();
    }

    async send(cmd: any): Promise<any> {
        const op: string = cmd.constructor.name;
        const input = structuredClone(cmd.input);
        await this.runHook(op, "before", input);
        this.calls.push({ op, input });
        await Promise.resolve(); // let concurrent operations interleave at every request, as on a network
        const out = this.exec(cmd, input);
        await this.runHook(op, "after", input);
        return out;
    }

    private condition(expr: string | undefined, names: any, values: any, used: Set<string>): Cond {
        if (!expr) return () => true;
        const p = new Parser(tokenize(expr), names ?? {}, values ?? {});
        const c = parseCondition(p);
        if (!p.done()) throw new Error(`fake: trailing tokens in ${expr}`);
        p.used.forEach((u) => used.add(u));
        return c;
    }

    private exec(cmd: any, input: any): any {
        if (cmd instanceof GetCommand) {
            const item = this.get(input.Key.PK, input.Key.SK);
            return { Item: item ? structuredClone(item) : undefined };
        }
        if (cmd instanceof PutCommand) {
            const used = new Set<string>();
            const c = this.condition(input.ConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues, used);
            checkUnused(input.ExpressionAttributeNames, input.ExpressionAttributeValues, used);
            if (!c(this.get(input.Item.PK, input.Item.SK))) throw ddbError("ConditionalCheckFailedException");
            this.putRaw(input.Item);
            return {};
        }
        if (cmd instanceof UpdateCommand) {
            const { item } = this.prepareUpdate(input);
            if (!item.ok) throw ddbError("ConditionalCheckFailedException");
            this.putRaw(item.next);
            return input.ReturnValues === "ALL_NEW" ? { Attributes: structuredClone(item.next) } : {};
        }
        if (cmd instanceof DeleteCommand) {
            const used = new Set<string>();
            const c = this.condition(input.ConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues, used);
            checkUnused(input.ExpressionAttributeNames, input.ExpressionAttributeValues, used);
            if (!c(this.get(input.Key.PK, input.Key.SK))) throw ddbError("ConditionalCheckFailedException");
            this.deleteRaw(input.Key.PK, input.Key.SK);
            return {};
        }
        if (cmd instanceof QueryCommand) return this.query(input);
        if (cmd instanceof BatchGetCommand) {
            const [table] = Object.keys(input.RequestItems);
            const req = input.RequestItems[table];
            if (req.Keys.length > 100) throw ddbError("ValidationException", { message: "more than 100 keys" });
            if (this.unprocessedRounds > 0) {
                this.unprocessedRounds--;
                return { Responses: { [table]: [] }, UnprocessedKeys: { [table]: { ...req } } };
            }
            const used = new Set<string>();
            const paths = projectionPaths(req.ProjectionExpression, req.ExpressionAttributeNames ?? {}, used);
            const found = req.Keys.map((k: Item) => this.get(k.PK, k.SK)).filter(Boolean).map((i: Item) => project(i, paths));
            checkUnused(req.ExpressionAttributeNames, undefined, used);
            return { Responses: { [table]: found }, UnprocessedKeys: {} };
        }
        if (cmd instanceof TransactWriteCommand) return this.transact(input);
        throw new Error(`fake: command ${cmd.constructor.name} is not modelled`);
    }

    private prepareUpdate(input: any): { item: { ok: true; next: Item } | { ok: false } } {
        const used = new Set<string>();
        const before = this.get(input.Key.PK, input.Key.SK);
        const c = this.condition(input.ConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues, used);
        const p = new Parser(tokenize(input.UpdateExpression), input.ExpressionAttributeNames ?? {}, input.ExpressionAttributeValues ?? {});
        const next = applyUpdate(p, before, { PK: input.Key.PK, SK: input.Key.SK });
        p.used.forEach((u) => used.add(u));
        checkUnused(input.ExpressionAttributeNames, input.ExpressionAttributeValues, used);
        return { item: c(before) ? { ok: true, next } : { ok: false } };
    }

    private query(input: any): any {
        const used = new Set<string>();
        const c = this.condition(input.KeyConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues, used);
        let rows = [...this.items.values()].filter((i) => c(i)).sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
        if (input.ExclusiveStartKey) rows = rows.filter((r) => r.SK > input.ExclusiveStartKey.SK);
        const limit = Math.min(input.Limit ?? Number.POSITIVE_INFINITY, this.pageSize);
        const page = rows.slice(0, limit);
        const paths = projectionPaths(input.ProjectionExpression, input.ExpressionAttributeNames ?? {}, used);
        const items = page.map((i) => project(i, paths));
        checkUnused(input.ExpressionAttributeNames, input.ExpressionAttributeValues, used);
        const more = rows.length > page.length;
        const last = page[page.length - 1];
        return { Items: items, ...(more && last ? { LastEvaluatedKey: { PK: last.PK, SK: last.SK } } : {}) };
    }

    private transact(input: any): any {
        const list: any[] = input.TransactItems;
        if (list.length > 100) throw ddbError("ValidationException", { message: "more than 100 items" });
        const ids = list.map((t) => {
            const body = t.Put ?? t.Update ?? t.Delete ?? t.ConditionCheck;
            const k = t.Put ? t.Put.Item : body.Key;
            return FakeTable.id(k.PK, k.SK);
        });
        if (new Set(ids).size !== ids.length) throw ddbError("ValidationException", { message: "multiple operations on one item" });
        const writes: (() => void)[] = [];
        const reasons = list.map((t, i) => {
            const used = new Set<string>();
            const [pk, sk] = ids[i].split("\u0000");
            const current = this.get(pk, sk);
            if (t.Update) {
                const { item } = this.prepareUpdate(t.Update);
                if (!item.ok) return { Code: "ConditionalCheckFailed" };
                writes.push(() => this.putRaw(item.next));
                return { Code: "None" };
            }
            const body = t.Put ?? t.Delete ?? t.ConditionCheck;
            if (t.ConditionCheck && !body.ConditionExpression) throw ddbError("ValidationException", { message: "ConditionCheck without condition" });
            const c = this.condition(body.ConditionExpression, body.ExpressionAttributeNames, body.ExpressionAttributeValues, used);
            checkUnused(body.ExpressionAttributeNames, body.ExpressionAttributeValues, used);
            if (!c(current)) return { Code: "ConditionalCheckFailed" };
            if (t.Put) writes.push(() => this.putRaw(t.Put.Item));
            if (t.Delete) writes.push(() => this.deleteRaw(pk, sk));
            return { Code: "None" };
        });
        if (reasons.some((r) => r.Code !== "None")) throw ddbError("TransactionCanceledException", { CancellationReasons: reasons });
        writes.forEach((w) => w());
        return {};
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures (Europe/Bucharest; § 5 worked examples)
// ---------------------------------------------------------------------------------------------------------------

const T = "tenant-a";
const PK = `TENANT#${T}`;
const TZ = "Europe/Bucharest";
const NOW = Date.parse("2026-12-01T10:00:00.000Z");
const MON_0900 = Date.parse("2026-12-07T07:00:00.000Z"); // Monday 09:00 local
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const settings = { timezone: TZ, holdMinutes: 30, bookingHorizonWeeks: 8, changeCutoffHours: 24 };

function setup() {
    const fake = new FakeTable();
    const store: sdb.SchedulingStore = { db: fake.client as any, table: "AmodxSchedulingTable-unit", sleep: async () => {} };
    return { fake, store };
}

const person = (email = "ana@example.com", language?: string): Person =>
    ({ email, name: "Ana Pop", ...(language ? { language } : {}) });

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
    return r.value;
}

async function seedSlots(store: sdb.SchedulingStore, opts: { resources?: number; services?: { id: string; durationMin: number }[] } = {}) {
    const resources = [];
    for (let i = 0; i < (opts.resources ?? 1); i++) {
        const r = await sdb.createResource(store, T, `Practitioner ${i}`);
        await sdb.putAvailability(store, T, r.id, [
            { weekday: 1, start: "09:00", end: "12:00" }, { weekday: 2, start: "00:30", end: "23:55" }, // Tue grid 00:30, 01:30 (= 23:30Z Mon: crosses UTC midnight)
        ]);
        resources.push(r);
    }
    for (const s of opts.services ?? [{ id: "svc60", durationMin: 60 }]) {
        await sdb.putService(store, T, { id: s.id, name: `Consult ${s.durationMin}`, durationMin: s.durationMin, eligibility: { kind: "all" } });
    }
    return resources.map((r) => r.id);
}

function holdSlot(store: sdb.SchedulingStore, start = MON_0900, who = person(), extra: Partial<sdb.SlotHoldInput> = {}) {
    return sdb.holdSlot(store, { tenantId: T, serviceId: "svc60", start, who, intentId: randomUUID(), fingerprint: "fp", settings, now: NOW, ...extra });
}

async function seedRun(store: sdb.SchedulingStore, opts: { capacity?: number; language?: string; meetings?: any[]; trainerId?: string; now?: number } = {}) {
    await sdb.putCourse(store, T, { id: "c1", name: "Pottery", defaultCapacity: 8, languages: ["ro", "en"] });
    const trainerId = opts.trainerId ?? (await sdb.createResource(store, T, "Trainer")).id;
    const run = must(await sdb.createRun(store, {
        tenantId: T, courseId: "c1", timezone: TZ, capacity: opts.capacity ?? 8, trainerIds: [trainerId],
        language: opts.language ? { kind: "set", tag: opts.language } : { kind: "notSet" },
        meetings: opts.meetings ?? [{ date: "2026-12-12", start: "10:00", end: "13:00" }], now: opts.now ?? NOW,
    }));
    return { run, trainerId };
}

function holdSeat(store: sdb.SchedulingStore, runId: string, who = person(), extra: Partial<sdb.SeatHoldInput> = {}) {
    return sdb.holdSeat(store, { tenantId: T, courseId: "c1", runId, who, intentId: randomUUID(), fingerprint: "fp", settings, now: NOW, ...extra });
}

const admin = { kind: "admin" as const, email: "owner@studio.example" };
const customer = { kind: "customer" as const };

/** § 6.1 item-set invariant over the whole fake table. */
function itemSetViolations(fake: FakeTable): string[] {
    const out: string[] = [];
    const items = [...fake.items.values()].filter((i) => i.PK === PK);
    const bookings = new Map(items.filter((i) => i.SK.startsWith("BOOKING#")).map((i) => [i.id as string, i]));
    const custIds = new Set(items.filter((i) => i.SK.startsWith("CUST#")).map((i) => i.SK.slice(i.SK.lastIndexOf("#") + 1)));
    for (const id of bookings.keys()) if (!custIds.has(id)) out.push(`BOOKING# ${id} without CUST#`);
    for (const id of custIds) if (!bookings.has(id)) out.push(`CUST# ${id} without BOOKING#`);
    for (const i of items) {
        const sk: string = i.SK;
        const tail = sk.slice(sk.lastIndexOf("#") + 1);
        if ((sk.startsWith("HELD#") || sk.startsWith("UNPLACED#")) && !bookings.has(tail)) out.push(`${sk} without BOOKING#`);
        if (sk.startsWith("TOKEN#") && !bookings.has(i.bookingId)) out.push(`${sk} without BOOKING#`);
        if (sk.startsWith("HELD#") && bookings.get(tail)?.heldUntil === undefined) out.push(`${sk} without heldUntil`);
    }
    return out;
}

const tokenItems = (fake: FakeTable, bookingId: string) => [...fake.items.values()].filter((i) => i.SK.startsWith("TOKEN#") && i.bookingId === bookingId);
const booking = (fake: FakeTable, id: string) => fake.get(PK, `BOOKING#${id}`);
const crash = () => { throw new Error("injected crash after commit"); };

// ---------------------------------------------------------------------------------------------------------------
// Step 1: keys and codecs (§ 6.2), and the structural rules of the module
// ---------------------------------------------------------------------------------------------------------------

describe("§ 6.2 keys and codecs", () => {
    it("keys follow § 6.2 exactly; an id with '#' is refused", () => {
        const k = sdb.schedulingKeys;
        expect(k.pk("t1")).toBe("TENANT#t1");
        expect(k.resDay("r1", "2026-12-07")).toBe("RESDAY#r1#2026-12-07");
        expect(k.held(Date.parse("2026-12-01T10:30:00Z"), "b1")).toBe("HELD#2026-12-01T10:30:00.000Z#b1");
        expect(k.runSpan("2026-12-12T11:00:00.000Z", "c1", "r1")).toBe("RUNSPAN#2026-12-12T11:00:00.000Z#c1#r1");
        expect(k.limitEmail("h", 491234)).toBe("LIMIT#EMAIL#h#491234");
        expect(k.cust("ana@example.com", "b1")).toBe("CUST#ana@example.com#b1");
        expect(() => k.booking("a#b")).toThrow();
        expect(() => k.pk("")).toThrow();
    });

    it("utcDatesOf: one date, or two across UTC midnight; ISO is fixed width", () => {
        expect(sdb.utcDatesOf(MON_0900, MON_0900 + HOUR)).toEqual(["2026-12-07"]);
        expect(sdb.utcDatesOf(Date.parse("2026-12-06T23:30:00Z"), Date.parse("2026-12-07T00:30:00Z"))).toEqual(["2026-12-06", "2026-12-07"]);
        expect(sdb.iso(0)).toBe("1970-01-01T00:00:00.000Z");
    });

    it("§ 6.3 rule / CLAUDE.md rule 2: the module source has no Scan", () => {
        const src = readFileSync(path.resolve(__dirname, "../../src/lib/scheduling-db.ts"), "utf8");
        expect(src).not.toMatch(/ScanCommand|\bScan\b/);
        expect(src).toContain("SCHEDULING_TABLE_NAME");
    });

    it("schedulingStoreFromEnv reads SCHEDULING_TABLE_NAME at one place and refuses an unset name", () => {
        const before = process.env.SCHEDULING_TABLE_NAME;
        delete process.env.SCHEDULING_TABLE_NAME;
        expect(() => sdb.schedulingStoreFromEnv()).toThrow(/SCHEDULING_TABLE_NAME/);
        process.env.SCHEDULING_TABLE_NAME = "AmodxSchedulingTable-x";
        expect(sdb.schedulingStoreFromEnv().table).toBe("AmodxSchedulingTable-x");
        if (before === undefined) delete process.env.SCHEDULING_TABLE_NAME; else process.env.SCHEDULING_TABLE_NAME = before;
    });

    it("a stored BOOKING# that fails its schema throws storedDataInvalid with the key and no value", async () => {
        const { fake, store } = setup();
        fake.putRaw({ PK, SK: "BOOKING#b1", id: "b1", ref: "B-XXXX", secret: "ana@example.com" });
        const e = await sdb.getBooking(store, T, "b1", true).catch((x) => x);
        expect(e).toBeInstanceOf(sdb.StoredDataInvalidError);
        expect(e.key).toBe("BOOKING#b1");
        expect(e.message).not.toContain("ana@example.com");
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Step 2: reads (§ 6.3, § 6.4)
// ---------------------------------------------------------------------------------------------------------------

describe("§ 6.3 / § 6.4 reads", () => {
    it("C17 — a run that started before a window, with a meeting inside it, is found by AP6", async () => {
        const { store } = setup();
        const { run } = await seedRun(store, {
            meetings: [{ date: "2026-11-28", start: "10:00", end: "12:00" }, { date: "2026-12-12", start: "10:00", end: "12:00" }],
            now: Date.parse("2026-11-01T00:00:00Z"),
        });
        const windowStart = Date.parse("2026-12-05T00:00:00Z");
        const found = must(await sdb.runsNotEndedBy(store, T, windowStart, windowStart + 60 * DAY, false));
        expect(found.map((r) => r.runId)).toEqual([run.id]);
        expect(found[0].courseId).toBe("c1");
        const ended = must(await sdb.runsNotEndedBy(store, T, Date.parse("2026-12-13T00:00:00Z"), Date.parse("2027-01-13T00:00:00Z"), false));
        expect(ended).toEqual([]);
    });

    it("C18 — a query with more than one page is read to the end", async () => {
        const { fake, store } = setup();
        await seedRun(store);
        await seedRun(store, { trainerId: (await sdb.createResource(store, T, "T2")).id });
        await seedRun(store, { trainerId: (await sdb.createResource(store, T, "T3")).id });
        fake.pageSize = 1;
        expect(await sdb.listRuns(store, T, "c1")).toHaveLength(3);
        expect(fake.ops("QueryCommand").filter((q) => q.ExpressionAttributeValues[":p"] === "RUN#c1#").length).toBeGreaterThanOrEqual(3);
        expect(fake.ops("QueryCommand").every((q) => typeof q.ProjectionExpression === "string" && q.Limit === undefined)).toBe(true);
    });

    it("C18 — BatchGet UnprocessedKeys are retried; still unprocessed after 5 attempts → busy", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const id = must(await holdSlot(store)).booking.id;
        fake.unprocessedRounds = 2;
        expect(must(await sdb.getBookingViews(store, T, [id], "display")).map((b) => b.id)).toEqual([id]);
        fake.unprocessedRounds = 5;
        expect(await sdb.getBookingViews(store, T, [id], "display")).toEqual({ ok: false, error: { kind: "busy" } });
        fake.unprocessedRounds = 4;
        expect((await sdb.getResourcePlans(store, T, [r])).ok).toBe(true);
    });

    it("C18 — BatchGet sends at most 100 keys per call", async () => {
        const { fake, store } = setup();
        const ids = Array.from({ length: 230 }, () => randomUUID());
        expect(must(await sdb.getBookingViews(store, T, ids, "feed"))).toEqual([]);
        expect(fake.ops("BatchGetCommand").map((b) => Object.values<any>(b.RequestItems)[0].Keys.length)).toEqual([100, 100, 30]);
    });

    it("C19 — a booking id or token of tenant A under tenant B is not found", async () => {
        const { store } = setup();
        await seedSlots(store);
        const { booking: b, token } = must(await holdSlot(store));
        expect(await sdb.getBooking(store, T, b.id, true)).toBeDefined();
        expect(await sdb.getBookingByToken(store, T, token, true)).toBeDefined();
        expect(await sdb.getBooking(store, "tenant-b", b.id, true)).toBeUndefined();
        expect(await sdb.getBookingByToken(store, "tenant-b", token, true)).toBeUndefined();
        expect(await sdb.getBookingByToken(store, T, "not-a-token", true)).toBeUndefined();
    });

    it("AP8 — unplaced people are paged by 100 with an opaque cursor; a forged cursor is refused", async () => {
        const { store } = setup();
        await seedRun(store);
        for (let i = 0; i < 3; i++) {
            must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: null, who: person(`p${i}@example.com`), channel: "phone", adminEmail: admin.email, now: NOW }));
        }
        const page = must(await sdb.listUnplacedPage(store, T, "c1"));
        expect(page.bookingIds).toHaveLength(3);
        expect(page.cursor).toBeUndefined();
        const forged = Buffer.from(JSON.stringify({ PK: "TENANT#tenant-b", SK: "UNPLACED#c1#x" })).toString("base64url");
        expect(await sdb.listUnplacedPage(store, T, "c1", forged)).toEqual({ ok: false, error: { kind: "invalidCursor" } });
        expect(await sdb.listUnplacedPage(store, T, "c1", "%%%")).toEqual({ ok: false, error: { kind: "invalidCursor" } });
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Step 3: slot writes (§ 7.1-§ 7.3) and step 4: seat and run writes (§ 7.4-§ 7.6)
// ---------------------------------------------------------------------------------------------------------------

describe("§ 7 transactions", () => {
    it("§ 7.3 / § 7.4 item counts: hold ≤ 13 / 10, confirm ≤ 5 / 4, cancel ≤ 25 / 24, move ≤ 6 / 3, manual ≤ 6 / 5", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const midnight = Date.parse("2026-12-07T23:30:00Z"); // Tuesday 01:30 local, on the grid; crosses UTC midnight
        const sizes = async (f: () => Promise<unknown>) => {
            const before = fake.txSizes().length;
            await f();
            return fake.txSizes().slice(before);
        };
        const slot = await sizes(async () => must(await holdSlot(store, midnight, person(), { addressKey: "198.51.100.4" })));
        expect(slot[0]).toBeLessThanOrEqual(13);
        expect(slot[0]).toBe(11); // 2 days + guard + HOLDS + 2 limits + BOOKING, TOKEN, CUST, INTENT, HELD
        const held = [...fake.items.values()].find((i) => i.SK.startsWith("BOOKING#"))!;
        expect((await sizes(() => sdb.confirmBooking(store, T, held.id, NOW)))[0]).toBe(5);
        expect((await sizes(() => sdb.moveSlot(store, { tenantId: T, bookingId: held.id, start: midnight + DAY, resourceIds: [r], actor: admin, settings, now: NOW })))[0]).toBeLessThanOrEqual(6);
        for (let i = 0; i < 19; i++) must(await sdb.mintToken(store, T, held.id, NOW, { countForEmail: false }));
        expect((await sizes(() => sdb.cancelBooking(store, { tenantId: T, bookingId: held.id, actor: admin, cutoffHours: 24, now: NOW })))[0]).toBeLessThanOrEqual(25);
        expect((await sizes(() => sdb.createManualAppointment(store, { tenantId: T, serviceId: "svc60", resourceId: r, start: midnight, who: person("b@example.com"), channel: "phone", adminEmail: admin.email, now: NOW })))[0]).toBeLessThanOrEqual(6);

        const { run } = await seedRun(store);
        const seat = await sizes(async () => must(await holdSeat(store, run.id, person("c@example.com"), { addressKey: "198.51.100.4" })));
        expect(seat[0]).toBeLessThanOrEqual(10);
        const seatId = [...fake.items.values()].find((i) => i.SK.startsWith("BOOKING#") && i.what.kind === "seat")!.id;
        expect((await sizes(() => sdb.confirmBooking(store, T, seatId, NOW)))[0]).toBe(4);
        expect((await sizes(() => sdb.moveSeat(store, { tenantId: T, bookingId: seatId, runId: null, actor: admin, cutoffHours: 24, now: NOW })))[0]).toBe(3);
        expect((await sizes(() => sdb.moveSeat(store, { tenantId: T, bookingId: seatId, runId: run.id, actor: admin, cutoffHours: 24, now: NOW })))[0]).toBe(3);
        expect((await sizes(() => sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person("d@example.com"), channel: "phone", adminEmail: admin.email, now: NOW })))[0]).toBeLessThanOrEqual(5);
        expect((await sizes(() => sdb.updateRun(store, T, "c1", run.id, { capacity: 3 }, NOW)))[0]).toBe(1);
    });

    it("C1 — 20 parallel seat holds on the last seat: exactly 1 success, 19 runFull; active count = capacity", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store, { capacity: 1 });
        const results = await Promise.all(Array.from({ length: 20 }, (_, i) => holdSeat(store, run.id, person(`v${i}@example.com`))));
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok).map((r) => (r as any).error)).toEqual(Array(19).fill({ kind: "runFull", capacity: 1 }));
        const stored = fake.get(PK, `RUN#c1#${run.id}`)!;
        expect(Object.keys(stored.seats)).toHaveLength(1);
        expect(itemSetViolations(fake)).toEqual([]);
        expect(fake.sks("BOOKING#")).toHaveLength(1); // the losers' puts were in cancelled transactions
    });

    it("C2 — parallel slot holds 60 min at 09:00 and 30 min at 09:30 on one resource: exactly 1 success", async () => {
        const { store } = setup();
        await seedSlots(store, { services: [{ id: "svc60", durationMin: 60 }, { id: "svc30", durationMin: 30 }] });
        const [a, b] = await Promise.all([
            holdSlot(store, MON_0900, person("a@example.com")),
            holdSlot(store, MON_0900 + 30 * MIN, person("b@example.com"), { serviceId: "svc30" }),
        ]);
        expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
        expect((a.ok ? b : a)).toEqual({ ok: false, error: { kind: "slotTaken" } });
    });

    it("C2 — any available: a taken first resource moves the hold to the next one (lowest id first)", async () => {
        const { store } = setup();
        const [r1, r2] = (await seedSlots(store, { resources: 2 })).sort();
        expect(must(await holdSlot(store, MON_0900, person("a@example.com"))).booking.what).toMatchObject({ resourceId: r1 });
        expect(must(await holdSlot(store, MON_0900, person("b@example.com"))).booking.what).toMatchObject({ resourceId: r2 });
        expect(await holdSlot(store, MON_0900, person("c@example.com"))).toEqual({ ok: false, error: { kind: "slotTaken" } });
        expect(await holdSlot(store, MON_0900 + 15 * MIN, person("d@example.com"))).toEqual({ ok: false, error: { kind: "notOnGrid" } });
        expect(await holdSlot(store, MON_0900 - 2 * DAY)).toEqual({ ok: false, error: { kind: "outsideAvailability" } });
    });

    describe("C3 — confirm and hold at expiry, both commit orders, clocks skewed ±2 s", () => {
        const holdAt = NOW;
        const X = holdAt + 30 * MIN;
        it("C3 seat (a): A's confirm (clock X − 2 s) commits first → B (clock X + 2 s) re-reads → runFull", async () => {
            const { fake, store } = setup();
            const { run } = await seedRun(store, { capacity: 1 });
            const A = must(await holdSeat(store, run.id, person("a@example.com"))).booking;
            fake.on("TransactWriteCommand", "before", async () => {
                must(await sdb.confirmBooking(store, T, A.id, X - 2000));
            });
            const B = await holdSeat(store, run.id, person("b@example.com"), { now: X + 2000 });
            expect(B).toEqual({ ok: false, error: { kind: "runFull", capacity: 1 } });
            expect(booking(fake, A.id)!.state.kind).toBe("confirmed");
            expect(Object.keys(fake.get(PK, `RUN#c1#${run.id}`)!.seats)).toEqual([A.id]);
        });
        it("C3 seat (b): B's hold (clock X + 2 s) commits first, removing A → A's confirm (clock X − 2 s) → expired (seatLost)", async () => {
            const { fake, store } = setup();
            const { run } = await seedRun(store, { capacity: 1 });
            const A = must(await holdSeat(store, run.id, person("a@example.com"))).booking;
            fake.on("TransactWriteCommand", "before", async () => {
                must(await holdSeat(store, run.id, person("b@example.com"), { now: X + 2000 }));
            });
            expect(await sdb.confirmBooking(store, T, A.id, X - 2000)).toEqual({ ok: false, error: { kind: "expired", at: X } });
            expect(booking(fake, A.id)!.state.kind).toBe("held");
            expect(Object.keys(fake.get(PK, `RUN#c1#${run.id}`)!.seats)).toHaveLength(1);
        });
        it("C3 slot (a) and (b): never overlapping; the loser is slotTaken or expired", async () => {
            for (const order of ["confirmFirst", "holdFirst"] as const) {
                const { fake, store } = setup();
                const [r] = await seedSlots(store);
                const A = must(await holdSlot(store, MON_0900, person("a@example.com"))).booking;
                let other: any;
                if (order === "confirmFirst") {
                    fake.on("TransactWriteCommand", "before", async () => { must(await sdb.confirmBooking(store, T, A.id, X - 2000)); });
                    other = await holdSlot(store, MON_0900, person("b@example.com"), { now: X + 2000 });
                    expect(other).toEqual({ ok: false, error: { kind: "slotTaken" } });
                } else {
                    fake.on("TransactWriteCommand", "before", async () => { must(await holdSlot(store, MON_0900, person("b@example.com"), { now: X + 2000 })); });
                    other = await sdb.confirmBooking(store, T, A.id, X - 2000);
                    expect(other).toEqual({ ok: false, error: { kind: "expired", at: X } });
                }
                const entries = fake.get(PK, `RESDAY#${r}#2026-12-07`)!.entries;
                expect(Object.keys(entries)).toHaveLength(1);
            }
        });
    });

    it("C4 — intent replay: same fingerprint → same booking; changed language → intentReused; changed email → intentReused", async () => {
        const { store } = setup();
        await seedSlots(store);
        const intentId = randomUUID();
        const what: sdb.HoldWhatInput = { kind: "slot", serviceId: "svc60", start: sdb.iso(MON_0900) };
        const who = { email: "Ana@Example.com", name: "Ana Pop", language: "ro" };
        const fp = sdb.intentFingerprint(what, who);
        expect(sdb.intentFingerprint(what, { ...who, email: "ana@example.com" })).toBe(fp); // normalized
        const created = must(await holdSlot(store, MON_0900, person("ana@example.com", "ro"), { intentId, fingerprint: fp }));
        const same = await sdb.replayIntent(store, T, intentId, fp, false, NOW);
        expect(same).toMatchObject({ kind: "held", booking: { id: created.booking.id } });
        expect(await sdb.replayIntent(store, T, intentId, sdb.intentFingerprint(what, { ...who, language: "en" }), false, NOW)).toEqual({ kind: "intentReused" });
        expect(await sdb.replayIntent(store, T, intentId, sdb.intentFingerprint(what, { ...who, email: "other@example.com" }), false, NOW)).toEqual({ kind: "intentReused" });
        expect(await sdb.replayIntent(store, T, randomUUID(), fp, false, NOW)).toEqual({ kind: "new" });
    });

    it("C4 — double submit: both holds read 'no intent'; one commits; the other fails on INTENT# → intentExists → replay answers the same booking", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store);
        const intentId = randomUUID();
        const [a, b] = await Promise.all([
            holdSeat(store, run.id, person(), { intentId, fingerprint: "same" }),
            holdSeat(store, run.id, person(), { intentId, fingerprint: "same" }),
        ]);
        const winner = (a.ok ? a : b) as { ok: true; value: sdb.Created };
        expect(a.ok ? b : a).toEqual({ ok: false, error: { kind: "intentExists" } });
        expect(await sdb.replayIntent(store, T, intentId, "same", false, NOW)).toMatchObject({ kind: "held", booking: { id: winner.value.booking.id }, send: "recover" });
        expect(fake.sks("BOOKING#")).toHaveLength(1);
    });

    it("C5 — a fault after the hold commit, before the send; then replay → recover (201): one new token, mail = sent", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const intentId = randomUUID();
        fake.on("TransactWriteCommand", "after", crash);
        await expect(holdSlot(store, MON_0900, person(), { intentId, fingerprint: "fp" })).rejects.toThrow(/injected crash/);
        const replay = await sdb.replayIntent(store, T, intentId, "fp", false, NOW);
        expect(replay).toMatchObject({ kind: "held", send: "recover" });
        const b = (replay as any).booking as sdb.Created["booking"];
        expect(b.state).toMatchObject({ kind: "held", mail: "pending" });
        const minted = must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: true }));
        expect(minted.booking.tokenHashes).toHaveLength(2);
        expect(await sdb.markHoldMail(store, T, b.id, minted.booking.rev, "sent")).toBe(true);
        expect(booking(fake, b.id)!.state).toMatchObject({ kind: "held", mail: "sent" });
        expect(await sdb.replayIntent(store, T, intentId, "fp", false, NOW)).toMatchObject({ kind: "held", send: "none" });
        expect(fake.sks("LIMIT#EMAIL#")).toHaveLength(1);
        expect(fake.get(PK, fake.sks("LIMIT#EMAIL#")[0])!.count).toBe(2); // the hold and the recovery mail
    });

    it("C6 — the send fails: mail = failed, the hold is kept; replay → recover, mail sent; a resend after sent mints again", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const intentId = randomUUID();
        const { booking: b } = must(await holdSlot(store, MON_0900, person(), { intentId, fingerprint: "fp" }));
        expect(await sdb.markHoldMail(store, T, b.id, b.rev, "failed")).toBe(true);
        expect(booking(fake, b.id)!.state).toMatchObject({ kind: "held", mail: "failed" });
        expect(await sdb.replayIntent(store, T, intentId, "fp", false, NOW)).toMatchObject({ kind: "held", send: "recover" });
        const minted = must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: true }));
        expect(await sdb.markHoldMail(store, T, b.id, b.rev, "sent")).toBe(false); // stale rev: nothing written
        expect(await sdb.markHoldMail(store, T, b.id, minted.booking.rev, "sent")).toBe(true);
        expect(await sdb.replayIntent(store, T, intentId, "fp", true, NOW)).toMatchObject({ kind: "held", send: "resend" });
    });

    it("C6 — resend over the per-email limit → tooManyForEmail, no token", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const { booking: b } = must(await holdSlot(store));
        for (let i = 0; i < 4; i++) must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: true }));
        expect(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: true })).toEqual({ ok: false, error: { kind: "tooManyForEmail" } });
        expect(booking(fake, b.id)!.tokenHashes).toHaveLength(5);
    });

    it("C7 — replay of a confirmed / expired / cancelled booking → confirmed / intentClosed / intentClosed; replay reads no reCAPTCHA input", async () => {
        const { store } = setup();
        await seedSlots(store);
        const ids = [randomUUID(), randomUUID(), randomUUID()];
        const [c, e, x] = [
            must(await holdSlot(store, MON_0900, person("c@example.com"), { intentId: ids[0], fingerprint: "c" })).booking,
            must(await holdSlot(store, MON_0900 + HOUR, person("e@example.com"), { intentId: ids[1], fingerprint: "e" })).booking,
            must(await holdSlot(store, MON_0900 + 2 * HOUR, person("x@example.com"), { intentId: ids[2], fingerprint: "x" })).booking,
        ];
        must(await sdb.confirmBooking(store, T, c.id, NOW));
        must(await sdb.cancelBooking(store, { tenantId: T, bookingId: x.id, actor: customer, cutoffHours: 24, now: NOW }));
        expect(await sdb.replayIntent(store, T, ids[0], "c", false, NOW)).toMatchObject({ kind: "confirmed", booking: { id: c.id } });
        expect(await sdb.replayIntent(store, T, ids[1], "e", false, e.heldUntil!)).toEqual({ kind: "intentClosed" });
        expect(await sdb.replayIntent(store, T, ids[2], "x", false, NOW)).toEqual({ kind: "intentClosed" });
        expect(sdb.replayIntent.length).toBe(6); // (store, tenant, intent, fingerprint, resend, now): no token parameter
    });

    it("C8 — capacity lowered below taken: 200; a held booking then confirms; a new hold → runFull", async () => {
        const { store } = setup();
        const { run } = await seedRun(store, { capacity: 3 });
        const held = must(await holdSeat(store, run.id, person("a@example.com"))).booking;
        must(await holdSeat(store, run.id, person("b@example.com")));
        must(await holdSeat(store, run.id, person("c@example.com")));
        const lowered = must(await sdb.updateRun(store, T, "c1", run.id, { capacity: 1 }, NOW));
        expect(lowered.capacity).toBe(1);
        expect(must(await sdb.confirmBooking(store, T, held.id, NOW)).booking.state.kind).toBe("confirmed");
        expect(await holdSeat(store, run.id, person("d@example.com"))).toEqual({ ok: false, error: { kind: "runFull", capacity: 1 } });
    });

    it("C9 — two first enrolments ro / en on a notSet run: one wins and sets the language; the other languageMismatch", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store);
        const [ro, en] = await Promise.all([
            holdSeat(store, run.id, person("ro@example.com", "ro")),
            holdSeat(store, run.id, person("en@example.com", "en")),
        ]);
        expect([ro.ok, en.ok].filter(Boolean)).toHaveLength(1);
        const winner = ro.ok ? "ro" : "en";
        expect(fake.get(PK, `RUN#c1#${run.id}`)!.language).toEqual({ kind: "set", tag: winner });
        expect((ro.ok ? en : ro)).toEqual({ ok: false, error: { kind: "languageMismatch", run: winner, person: winner === "ro" ? "en" : "ro" } });
    });

    it("C10 — two admin moves of one booking at once: one commits; the other re-reads and decides from the new what", async () => {
        const { fake, store } = setup();
        const { run, trainerId } = await seedRun(store);
        const { run: run2 } = await seedRun(store, { trainerId });
        const { run: run3 } = await seedRun(store, { trainerId });
        const b = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person(), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        const move = (runId: string, expectedRev?: number) => sdb.moveSeat(store, { tenantId: T, bookingId: b.id, runId, actor: admin, cutoffHours: 24, now: NOW, expectedRev });
        const [m2, m3] = await Promise.all([move(run2.id), move(run3.id)]);
        expect(m2.ok && m3.ok).toBe(true);
        const stored = booking(fake, b.id)!;
        const moves = stored.history.filter((h: any) => h.action === "moved");
        expect(moves).toHaveLength(2);
        expect(moves[1].from).toEqual(moves[0].to); // the second decided from the first one's result
        const seatsTaken = [run, run2, run3].map((r) => Object.keys(fake.get(PK, `RUN#c1#${r.id}`)!.seats).length);
        expect(seatsTaken.reduce((a, n) => a + n, 0)).toBe(1);
    });

    it("C10 — with a rev: the second admin move answers stale", async () => {
        const { store } = setup();
        const { run, trainerId } = await seedRun(store);
        const { run: run2 } = await seedRun(store, { trainerId });
        const b = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person(), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        const [m1, m2] = await Promise.all([
            sdb.moveSeat(store, { tenantId: T, bookingId: b.id, runId: run2.id, actor: admin, cutoffHours: 24, now: NOW, expectedRev: b.rev }),
            sdb.moveSeat(store, { tenantId: T, bookingId: b.id, runId: null, actor: admin, cutoffHours: 24, now: NOW, expectedRev: b.rev }),
        ]);
        expect([m1, m2].filter((r) => r.ok)).toHaveLength(1);
        expect([m1, m2].find((r) => !r.ok)).toEqual({ ok: false, error: { kind: "stale" } });
    });

    it("C10 — slot move: keeps id and tokens; moveSlot with a stale rev → stale; a customer move inside the cutoff → tooLate", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const { booking: b, token } = must(await holdSlot(store));
        must(await sdb.confirmBooking(store, T, b.id, NOW));
        const moved = must(await sdb.moveSlot(store, { tenantId: T, bookingId: b.id, start: MON_0900 + HOUR, resourceIds: [r], actor: customer, settings, now: NOW }));
        expect(moved.id).toBe(b.id);
        expect((await sdb.getBookingByToken(store, T, token, true))?.what).toMatchObject({ start: MON_0900 + HOUR });
        expect(await sdb.moveSlot(store, { tenantId: T, bookingId: b.id, start: MON_0900, resourceIds: [r], actor: admin, settings, now: NOW, expectedRev: b.rev }))
            .toEqual({ ok: false, error: { kind: "stale" } });
        const late = MON_0900 + HOUR - 23 * HOUR;
        expect(await sdb.moveSlot(store, { tenantId: T, bookingId: b.id, start: MON_0900, resourceIds: [r], actor: customer, settings, now: late }))
            .toMatchObject({ ok: false, error: { kind: "tooLate" } });
        expect(Object.keys(fake.get(PK, `RESDAY#${r}#2026-12-07`)!.entries)).toEqual([b.id]);
    });
});

describe("C11 / C26 — resource removal against inventory writes (§ 13)", () => {
    it("C11 (a) hold commits first → removal resourceInUse", async () => {
        const { store } = setup();
        const [r] = await seedSlots(store);
        must(await holdSlot(store));
        expect(await sdb.removeResource(store, T, r, NOW)).toEqual({ ok: false, error: { kind: "resourceInUse", activeBookings: 1, runs: 0 } });
        expect(await sdb.getResource(store, T, r, true)).toMatchObject({ id: r });
        expect((await sdb.getResource(store, T, r, true))!.retiring).toBeUndefined();
    });

    it("C11 (a) fence commits first → the hold resourceUnavailable; the removal completes", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        let hold: any;
        fake.on("QueryCommand", "before", async () => { hold = await holdSlot(store); }, (q) => q.ExpressionAttributeValues[":lo"]?.startsWith("RESDAY#"));
        expect(await sdb.removeResource(store, T, r, NOW)).toEqual({ ok: true, value: undefined });
        expect(hold).toEqual({ ok: false, error: { kind: "resourceUnavailable" } });
        expect(fake.sks("BOOKING#")).toEqual([]);
        expect(fake.sks("AVAILABILITY#")).toEqual([]);
    });

    it("C11 (b) a hold and a manual appointment that read the resource before a removal that completes → resourceUnavailable; no booking names it", async () => {
        for (const write of ["hold", "manual"] as const) {
            const { fake, store } = setup();
            const [r] = await seedSlots(store);
            fake.on("TransactWriteCommand", "before", async () => { must(await sdb.removeResource(store, T, r, NOW)); });
            const result = write === "hold" ? await holdSlot(store)
                : await sdb.createManualAppointment(store, { tenantId: T, serviceId: "svc60", resourceId: r, start: MON_0900, who: person(), channel: "phone", adminEmail: admin.email, now: NOW });
            expect(result).toEqual({ ok: false, error: { kind: "resourceUnavailable" } });
            expect(fake.sks("BOOKING#")).toEqual([]);
            expect(fake.sks("RESOURCE#")).toEqual([]);
        }
    });

    it("C11 (c) a run trainer change naming the resource, both orders", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store);
        const r2 = (await sdb.createResource(store, T, "R2")).id;
        must(await sdb.updateRun(store, T, "c1", run.id, { trainerIds: [r2] }, NOW));
        expect(await sdb.removeResource(store, T, r2, NOW)).toMatchObject({ ok: false, error: { kind: "resourceInUse", runs: 1 } });

        const r3 = (await sdb.createResource(store, T, "R3")).id;
        fake.on("TransactWriteCommand", "before", async () => { must(await sdb.removeResource(store, T, r3, NOW)); });
        expect(await sdb.updateRun(store, T, "c1", run.id, { trainerIds: [r3] }, NOW)).toEqual({ ok: false, error: { kind: "resourceUnavailable" } });
        expect(fake.get(PK, `RUN#c1#${run.id}`)!.trainerIds).toEqual([r2]);
    });

    it("C11 (d) two removal requests at once: one 204, the other resourceRemovalInProgress", async () => {
        const { store } = setup();
        const [r] = await seedSlots(store);
        const results = await Promise.all([sdb.removeResource(store, T, r, NOW), sdb.removeResource(store, T, r, NOW)]);
        expect(results.filter((x) => x.ok)).toHaveLength(1);
        expect(results.find((x) => !x.ok)).toEqual({ ok: false, error: { kind: "resourceRemovalInProgress" } });
    });

    it("C11 (e) an attempt crashed after acquire: +5 min → in progress; +11 min → takes over and completes", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        fake.putRaw({ ...fake.get(PK, `RESOURCE#${r}`)!, retiring: { attemptId: "crashed", at: NOW } });
        expect(await sdb.removeResource(store, T, r, NOW + 5 * MIN)).toEqual({ ok: false, error: { kind: "resourceRemovalInProgress" } });
        expect(await sdb.removeResource(store, T, r, NOW + 11 * MIN)).toEqual({ ok: true, value: undefined });
        expect(fake.sks("RESOURCE#")).toEqual([]);
    });

    it("C11 (f) attempt A's release racing B's takeover: A's conditional step fails, B's fence stays", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        must(await holdSlot(store)); // in use, so A releases
        fake.on("UpdateCommand", "before", () => {
            fake.putRaw({ ...fake.get(PK, `RESOURCE#${r}`)!, retiring: { attemptId: "B", at: NOW + 11 * MIN } });
        }, (u) => u.UpdateExpression === "REMOVE #r");
        expect(await sdb.removeResource(store, T, r, NOW)).toEqual({ ok: false, error: { kind: "resourceRemovalInProgress" } });
        expect(fake.get(PK, `RESOURCE#${r}`)!.retiring).toEqual({ attemptId: "B", at: NOW + 11 * MIN });
    });

    it("C11 (g) a move of an ended run to future dates whose trainer is being removed, both commit orders", async () => {
        const past = [{ date: "2026-11-21", start: "10:00", end: "12:00" }];
        const future = [{ date: "2026-12-19", start: "10:00", end: "12:00" }];
        {
            const { store } = setup();
            const { run, trainerId } = await seedRun(store, { meetings: past, now: Date.parse("2026-11-01T00:00:00Z") });
            must(await sdb.moveRun(store, T, "c1", run.id, future, NOW));
            expect(await sdb.removeResource(store, T, trainerId, NOW)).toMatchObject({ ok: false, error: { kind: "resourceInUse", runs: 1 } });
        }
        {
            const { fake, store } = setup();
            const { run, trainerId } = await seedRun(store, { meetings: past, now: Date.parse("2026-11-01T00:00:00Z") });
            fake.on("TransactWriteCommand", "before", async () => { must(await sdb.removeResource(store, T, trainerId, NOW)); });
            expect(await sdb.moveRun(store, T, "c1", run.id, future, NOW)).toEqual({ ok: false, error: { kind: "resourceUnavailable" } });
            expect(fake.get(PK, `RUN#c1#${run.id}`)!.meetings).toEqual(past);
        }
    });

    it("C26 — trainers change R1 → R2: removal of R1 is not refused by that run; R2 → resourceInUse", async () => {
        const { store } = setup();
        const { run, trainerId: r1 } = await seedRun(store);
        const r2 = (await sdb.createResource(store, T, "R2")).id;
        must(await sdb.updateRun(store, T, "c1", run.id, { trainerIds: [r2] }, NOW));
        expect(await sdb.removeResource(store, T, r1, NOW)).toEqual({ ok: true, value: undefined });
        expect(await sdb.removeResource(store, T, r2, NOW)).toMatchObject({ ok: false, error: { kind: "resourceInUse", runs: 1 } });
    });
});

describe("unplaced, run cancel, erasure, tokens", () => {
    it("C25 — cancel of an unplaced booking deletes UNPLACED#; admin seat → unplaced → seat puts / deletes it; AP8 lists exactly the unplaced", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store);
        const u = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: null, who: person("u@example.com"), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        const s = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person("s@example.com"), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        expect(must(await sdb.listUnplacedPage(store, T, "c1")).bookingIds).toEqual([u.id]);
        must(await sdb.cancelBooking(store, { tenantId: T, bookingId: u.id, actor: customer, cutoffHours: 24, now: NOW }));
        expect(fake.sks("UNPLACED#")).toEqual([]);
        const toUnplaced = fake.txSizes().length;
        must(await sdb.moveSeat(store, { tenantId: T, bookingId: s.id, runId: null, actor: admin, cutoffHours: 24, now: NOW }));
        expect(fake.ops("TransactWriteCommand")[toUnplaced].TransactItems.some((t: any) => t.Put?.Item.SK === `UNPLACED#c1#${s.id}`)).toBe(true);
        expect(must(await sdb.listUnplacedPage(store, T, "c1")).bookingIds).toEqual([s.id]);
        must(await sdb.moveSeat(store, { tenantId: T, bookingId: s.id, runId: run.id, actor: admin, cutoffHours: 24, now: NOW }));
        expect(fake.ops("TransactWriteCommand").at(-1).TransactItems.some((t: any) => t.Delete?.Key.SK === `UNPLACED#c1#${s.id}`)).toBe(true);
        expect(must(await sdb.listUnplacedPage(store, T, "c1")).bookingIds).toEqual([]);
        expect(itemSetViolations(fake)).toEqual([]);
    });

    it("C12 / C32 — cancel a run of 45: one transaction ≤ 92 items; 45 changed with history; RUNSPAN# gone; held tokens cleared after commit", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store, { capacity: 45 });
        const held: string[] = [];
        for (let i = 0; i < 45; i++) {
            if (i < 15) held.push(must(await holdSeat(store, run.id, person(`h${i}@example.com`))).booking.id);
            else must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person(`m${i}@example.com`), channel: "phone", adminEmail: admin.email, now: NOW }));
        }
        const before = fake.txSizes().length;
        const result = must(await sdb.cancelRun(store, T, "c1", run.id, admin.email, NOW));
        const sizes = fake.txSizes().slice(before);
        expect(sizes[0]).toBe(2 + 2 * 30 + 15);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(92);
        expect(result.unplaced).toHaveLength(30);
        expect(result.cancelled.sort()).toEqual(held.sort());
        expect(fake.sks("RUNSPAN#")).toEqual([]);
        expect(fake.get(PK, `RUN#c1#${run.id}`)).toMatchObject({ status: "cancelled", seats: {} });
        for (const id of result.unplaced) {
            const b = booking(fake, id)!;
            expect(b.what).toEqual({ kind: "unplaced", courseId: "c1" });
            expect(b.history.at(-1)).toMatchObject({ action: "moved", by: admin, from: { kind: "seat", runId: run.id }, to: { kind: "unplaced" } });
        }
        for (const id of held) {
            const b = booking(fake, id)!;
            expect(b.state).toMatchObject({ kind: "cancelled", by: admin });
            expect(b.history.at(-1)).toMatchObject({ action: "cancelled", by: admin });
            expect(b.tokenHashes).toEqual([]);
            expect(tokenItems(fake, id)).toEqual([]);
        }
        expect(must(await sdb.listUnplacedPage(store, T, "c1")).bookingIds).toHaveLength(30);
        expect(await sdb.cancelRun(store, T, "c1", run.id, admin.email, NOW)).toEqual({ ok: false, error: { kind: "runCancelled" } });
        expect(itemSetViolations(fake)).toEqual([]);
    });

    it("C24 — run cancel with a crash after commit, before the held tokens' cleanup; then erase of that email", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store);
        const { booking: h, token } = must(await holdSeat(store, run.id, person("h@example.com")));
        fake.on("TransactWriteCommand", "after", crash);
        await expect(sdb.cancelRun(store, T, "c1", run.id, admin.email, NOW)).rejects.toThrow(/injected crash/);
        const viaLink = await sdb.getBookingByToken(store, T, token, true);
        expect(viaLink!.state.kind).toBe("cancelled");
        expect(tokenView(viaLink!, null, NOW)).toBe("gone"); // → 404 linkNotValid
        expect(tokenItems(fake, h.id)).toHaveLength(1); // still listed, still findable
        expect(must(await sdb.eraseCustomer(store, T, "h@example.com", NOW))).toEqual({ removedBookings: 1, remainingBookings: 0 });
        expect(tokenItems(fake, h.id)).toEqual([]);
        expect(itemSetViolations(fake)).toEqual([]);
    });

    it("C13 — erasure while a hold for the same email commits after step 1's read: remaining 1; a second run removes it", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store);
        must(await holdSeat(store, run.id, person("ana@example.com")));
        fake.on("GetCommand", "before", async () => { must(await holdSeat(store, run.id, person("ana@example.com"))); }, (g) => g.Key.SK.startsWith("BOOKING#"));
        expect(must(await sdb.eraseCustomer(store, T, "ana@example.com", NOW))).toEqual({ removedBookings: 1, remainingBookings: 1 });
        expect(must(await sdb.eraseCustomer(store, T, "Ana@Example.com", NOW))).toEqual({ removedBookings: 1, remainingBookings: 0 });
        expect(Object.keys(fake.get(PK, `RUN#c1#${run.id}`)!.seats)).toEqual([]);
        expect(itemSetViolations(fake)).toEqual([]);
    });

    it("C27 — two erasures of one email at once: both 200; total removed = bookings that existed; read-back 0", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        must(await holdSlot(store, MON_0900));
        must(await sdb.createManualAppointment(store, { tenantId: T, serviceId: "svc60", resourceId: r, start: MON_0900 + HOUR, who: person(), channel: "phone", adminEmail: admin.email, now: NOW }));
        const [a, b] = await Promise.all([sdb.eraseCustomer(store, T, "ana@example.com", NOW), sdb.eraseCustomer(store, T, "ana@example.com", NOW)]);
        const va = must(a), vb = must(b);
        expect(va.removedBookings + vb.removedBookings).toBe(2);
        expect([va.remainingBookings, vb.remainingBookings]).toEqual([0, 0]);
        expect(fake.sks("BOOKING#")).toEqual([]);
        expect(Object.keys(fake.get(PK, `RESDAY#${r}#2026-12-07`)!.entries)).toEqual([]);
    });

    it("C28 — a TOKEN# item whose booking was removed: the link finds nothing; nothing changes", async () => {
        const { fake, store } = setup();
        const token = "A".repeat(43);
        fake.putRaw({ PK, SK: `TOKEN#${sdb.sha256hex(token)}`, bookingId: "ghost", createdAt: NOW });
        const before = JSON.stringify([...fake.items.entries()]);
        expect(await sdb.getBookingByToken(store, T, token, true)).toBeUndefined();
        expect(await sdb.confirmBooking(store, T, "ghost", NOW)).toEqual({ ok: false, error: { kind: "notFound" } });
        expect(await sdb.cancelBooking(store, { tenantId: T, bookingId: "ghost", actor: customer, cutoffHours: 24, now: NOW })).toEqual({ ok: false, error: { kind: "notFound" } });
        expect(await sdb.moveSeat(store, { tenantId: T, bookingId: "ghost", runId: "r", actor: customer, cutoffHours: 24, now: NOW })).toEqual({ ok: false, error: { kind: "notFound" } });
        expect(JSON.stringify([...fake.items.entries()])).toBe(before);
    });

    it("C14 — 21 link mails for one booking: the first token → 404, the 21st → 200; tokenHashes length 20", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const { booking: b, token: first } = must(await holdSlot(store));
        let last = first;
        for (let i = 0; i < 20; i++) last = must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: false })).token;
        expect(booking(fake, b.id)!.tokenHashes).toHaveLength(20);
        expect(tokenItems(fake, b.id)).toHaveLength(20);
        expect(await sdb.getBookingByToken(store, T, first, true)).toBeUndefined();
        expect((await sdb.getBookingByToken(store, T, last, true))?.id).toBe(b.id);
        expect(Math.max(...fake.txSizes().slice(1))).toBeLessThanOrEqual(3); // § 8.4: ≤ 3 items per mint
    });

    it("C15 — cancel: every token → 404", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const { booking: b, token } = must(await holdSlot(store));
        must(await sdb.confirmBooking(store, T, b.id, NOW));
        const second = must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: false })).token;
        must(await sdb.cancelBooking(store, { tenantId: T, bookingId: b.id, actor: customer, cutoffHours: 24, now: NOW }));
        expect(await sdb.getBookingByToken(store, T, token, true)).toBeUndefined();
        expect(await sdb.getBookingByToken(store, T, second, true)).toBeUndefined();
        expect(tokenItems(fake, b.id)).toEqual([]);
        expect(booking(fake, b.id)!.tokenHashes).toEqual([]);
    });

    it("C20 — three holds of one email: the third tooManyForEmail; after one confirm, a new hold passes", async () => {
        const { store } = setup();
        await seedSlots(store);
        const a = must(await holdSlot(store, MON_0900)).booking;
        must(await holdSlot(store, MON_0900 + HOUR));
        expect(await holdSlot(store, MON_0900 + 2 * HOUR)).toEqual({ ok: false, error: { kind: "tooManyForEmail" } });
        must(await sdb.confirmBooking(store, T, a.id, NOW));
        expect((await holdSlot(store, MON_0900 + 2 * HOUR)).ok).toBe(true);
    });

    it("C20 — per-email (5/hour) and per-address (20/hour) counters in the hold transaction", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store, { capacity: 45 });
        for (let i = 0; i < 5; i++) {
            const b = must(await holdSeat(store, run.id, person())).booking;
            must(await sdb.cancelBooking(store, { tenantId: T, bookingId: b.id, actor: customer, cutoffHours: 24, now: NOW }));
        }
        expect(await holdSeat(store, run.id, person())).toEqual({ ok: false, error: { kind: "tooManyForEmail" } });
        for (let i = 0; i < 20; i++) must(await holdSeat(store, run.id, person(`x${i}@example.com`), { addressKey: "2001:db8:1:2::/64" }));
        expect(await holdSeat(store, run.id, person("y@example.com"), { addressKey: "2001:db8:1:2::/64" })).toEqual({ ok: false, error: { kind: "tooManyFromAddress" } });
        expect(fake.sks("LIMIT#ADDR#")).toHaveLength(1);
        expect(fake.sks("LIMIT#ADDR#")[0]).not.toContain("2001"); // a hash, no plaintext
    });

    describe("C21 / C22 / C23 — token mint against confirm, cancel, erasure (both orders)", () => {
        async function heldBooking() {
            const env = setup();
            await seedSlots(env.store);
            const created = must(await holdSlot(env.store));
            return { ...env, b: created.booking, first: created.token };
        }
        it("C21 — mint vs confirm, both orders: confirmed, both tokens listed and opening it", async () => {
            for (const order of ["mintFirst", "confirmFirst"] as const) {
                const { fake, store, b, first } = await heldBooking();
                let token = "";
                if (order === "mintFirst") {
                    fake.on("TransactWriteCommand", "before", async () => { token = must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: false })).token; });
                    must(await sdb.confirmBooking(store, T, b.id, NOW));
                } else {
                    fake.on("TransactWriteCommand", "before", async () => { must(await sdb.confirmBooking(store, T, b.id, NOW)); });
                    token = must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: false })).token;
                }
                const stored = booking(fake, b.id)!;
                expect(stored.state.kind).toBe("confirmed");
                expect(stored.tokenHashes).toHaveLength(2);
                expect((await sdb.getBookingByToken(store, T, first, true))?.id).toBe(b.id);
                expect((await sdb.getBookingByToken(store, T, token, true))?.id).toBe(b.id);
            }
        });
        it("C22 — mint vs cancel, both orders: no TOKEN# left, tokenHashes = []; cancel first → linkNotIssued (no mail)", async () => {
            for (const order of ["mintFirst", "cancelFirst"] as const) {
                const { fake, store, b } = await heldBooking();
                let mint: any;
                const cancel = () => sdb.cancelBooking(store, { tenantId: T, bookingId: b.id, actor: customer, cutoffHours: 24, now: NOW });
                if (order === "mintFirst") {
                    fake.on("TransactWriteCommand", "before", async () => { mint = await sdb.mintToken(store, T, b.id, NOW, { countForEmail: false }); });
                    must(await cancel());
                    expect(mint.ok).toBe(true);
                } else {
                    fake.on("TransactWriteCommand", "before", async () => { must(await cancel()); });
                    mint = await sdb.mintToken(store, T, b.id, NOW, { countForEmail: false });
                    expect(mint).toEqual({ ok: false, error: { kind: "linkNotIssued" } });
                }
                expect(tokenItems(fake, b.id)).toEqual([]);
                expect(booking(fake, b.id)!.tokenHashes).toEqual([]);
            }
        });
        it("C23 — mint vs erasure, both orders: no TOKEN# of the booking exists, or the mint failed", async () => {
            for (const order of ["mintFirst", "eraseFirst"] as const) {
                const { fake, store, b } = await heldBooking();
                let mint: any;
                if (order === "mintFirst") {
                    fake.on("TransactWriteCommand", "before", async () => { mint = await sdb.mintToken(store, T, b.id, NOW, { countForEmail: false }); });
                    must(await sdb.eraseCustomer(store, T, "ana@example.com", NOW));
                    expect(mint.ok).toBe(true);
                } else {
                    fake.on("TransactWriteCommand", "before", async () => { must(await sdb.eraseCustomer(store, T, "ana@example.com", NOW)); });
                    mint = await sdb.mintToken(store, T, b.id, NOW, { countForEmail: false });
                    expect(mint).toEqual({ ok: false, error: { kind: "linkNotIssued" } });
                }
                expect([...fake.items.values()].filter((i) => i.SK.startsWith("TOKEN#"))).toEqual([]);
                expect(itemSetViolations(fake)).toEqual([]);
            }
        });
    });
});

// ---------------------------------------------------------------------------------------------------------------
// C16 / C32 — item-set invariant and history, one row per operation, with a fault after each transaction
// ---------------------------------------------------------------------------------------------------------------

describe("C16 / C32 — item-set invariant and history per operation (fault injected after each transaction)", () => {
    /** Runs `op` with a crash injected after its (first) transaction commits; returns the committed state. */
    async function withCrash(fake: FakeTable, op: () => Promise<unknown>) {
        fake.on("TransactWriteCommand", "after", crash);
        await expect(op()).rejects.toThrow(/injected crash/);
        expect(itemSetViolations(fake)).toEqual([]);
    }
    const lastEntry = (fake: FakeTable, id: string) => booking(fake, id)!.history.at(-1);

    it("C16 (1) / C32 create: hold, manual appointment, manual seat → BOOKING# with CUST#; one `created` entry", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const { run } = await seedRun(store);
        await withCrash(fake, () => holdSlot(store));
        await withCrash(fake, () => sdb.createManualAppointment(store, { tenantId: T, serviceId: "svc60", resourceId: r, start: MON_0900 + HOUR, who: person("m@example.com"), channel: "phone", adminEmail: admin.email, now: NOW }));
        await withCrash(fake, () => sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person("s@example.com"), channel: "phone", adminEmail: admin.email, now: NOW }));
        const all = fake.sks("BOOKING#").map((sk) => fake.get(PK, sk)!);
        expect(all).toHaveLength(3);
        for (const b of all) {
            expect(b.history).toHaveLength(1);
            expect(b.history[0]).toMatchObject({ action: "created", state: b.state.kind, placement: { kind: b.what.kind } });
        }
        expect(fake.sks("HELD#")).toHaveLength(1);
    });

    it("C16 (2) / C32 confirm: HELD# gone with heldUntil; one `confirmed` entry", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const { booking: b } = must(await holdSlot(store));
        await withCrash(fake, () => sdb.confirmBooking(store, T, b.id, NOW));
        expect(fake.sks("HELD#")).toEqual([]);
        expect(booking(fake, b.id)!.heldUntil).toBeUndefined();
        expect(lastEntry(fake, b.id)).toEqual({ action: "confirmed", at: NOW });
        expect(booking(fake, b.id)!.history).toHaveLength(2);
    });

    it("C16 (3) / C32 move: slot, seat, unplaced → one `moved` entry with the old and new placement", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const { run, trainerId } = await seedRun(store);
        const { run: run2 } = await seedRun(store, { trainerId });
        const slot = must(await sdb.createManualAppointment(store, { tenantId: T, serviceId: "svc60", resourceId: r, start: MON_0900, who: person(), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        await withCrash(fake, () => sdb.moveSlot(store, { tenantId: T, bookingId: slot.id, start: MON_0900 + HOUR, resourceIds: [r], actor: admin, settings, now: NOW }));
        expect(lastEntry(fake, slot.id)).toEqual({ action: "moved", at: NOW, by: admin,
            from: { kind: "slot", resourceId: r, start: MON_0900, end: MON_0900 + HOUR },
            to: { kind: "slot", resourceId: r, start: MON_0900 + HOUR, end: MON_0900 + 2 * HOUR } });
        const seat = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person(), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        await withCrash(fake, () => sdb.moveSeat(store, { tenantId: T, bookingId: seat.id, runId: run2.id, actor: admin, cutoffHours: 24, now: NOW }));
        expect(lastEntry(fake, seat.id)).toMatchObject({ action: "moved", from: { kind: "seat", runId: run.id }, to: { kind: "seat", runId: run2.id } });
        await withCrash(fake, () => sdb.moveSeat(store, { tenantId: T, bookingId: seat.id, runId: null, actor: admin, cutoffHours: 24, now: NOW }));
        expect(lastEntry(fake, seat.id)).toMatchObject({ action: "moved", from: { kind: "seat", runId: run2.id }, to: { kind: "unplaced" } });
        await withCrash(fake, () => sdb.moveSeat(store, { tenantId: T, bookingId: seat.id, runId: run.id, actor: admin, cutoffHours: 24, now: NOW }));
        expect(lastEntry(fake, seat.id)).toMatchObject({ action: "moved", from: { kind: "unplaced" }, to: { kind: "seat", runId: run.id } });
        expect(booking(fake, seat.id)!.history).toHaveLength(4);
    });

    it("C16 (4) / C32 cancel: held (HELD# kept), confirmed, unplaced → one `cancelled` entry", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        await seedRun(store);
        const held = must(await holdSlot(store, MON_0900, person("h@example.com"))).booking;
        const conf = must(await holdSlot(store, MON_0900 + HOUR, person("c@example.com"))).booking;
        must(await sdb.confirmBooking(store, T, conf.id, NOW));
        const unp = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: null, who: person("u@example.com"), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        for (const b of [held, conf, unp]) {
            await withCrash(fake, () => sdb.cancelBooking(store, { tenantId: T, bookingId: b.id, actor: customer, cutoffHours: 24, now: NOW }));
            expect(lastEntry(fake, b.id)).toEqual({ action: "cancelled", at: NOW, by: customer });
        }
        expect(fake.sks("HELD#")).toEqual([`HELD#${sdb.iso(held.heldUntil!)}#${held.id}`]);
        expect(booking(fake, held.id)!.heldUntil).toBe(held.heldUntil);
    });

    it("C32 — a transaction that did not commit adds no entry", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const { booking: b } = must(await holdSlot(store));
        fake.on("TransactWriteCommand", "before", () => { throw new Error("injected network failure"); });
        await expect(sdb.confirmBooking(store, T, b.id, NOW)).rejects.toThrow(/network/);
        expect(booking(fake, b.id)!.history).toHaveLength(1);
        expect(booking(fake, b.id)!.state.kind).toBe("held");
    });

    it("C32 — a booking changed 51 times keeps 50 entries, the oldest gone; the stored item still parses", async () => {
        const { fake, store } = setup();
        const { run, trainerId } = await seedRun(store, { capacity: 45 });
        const { run: run2 } = await seedRun(store, { trainerId, capacity: 45 });
        const b = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person(), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        for (let i = 0; i < 51; i++) {
            must(await sdb.moveSeat(store, { tenantId: T, bookingId: b.id, runId: i % 2 === 0 ? run2.id : run.id, actor: admin, cutoffHours: 24, now: NOW + i }));
        }
        const stored = await sdb.getBooking(store, T, b.id, true);
        expect(stored!.history).toHaveLength(50);
        expect(stored!.history.some((h) => h.action === "created")).toBe(false);
        expect(stored!.history.at(-1)).toMatchObject({ action: "moved", at: NOW + 50 });
        expect(stored!.rev).toBe(52);
    });

    it("C16 (5) expiry cleanup and (6) erasure incl. hold → cancel while held → INTENT# TTL-deleted → erase", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const { booking: h } = must(await holdSlot(store, MON_0900, person("h@example.com")));
        const later = h.heldUntil! + 7 * DAY + 1;
        await withCrash(fake, () => sdb.cleanupExpiredHolds(store, T, later));
        expect(booking(fake, h.id)).toBeUndefined();

        const { booking: c } = must(await holdSlot(store, MON_0900 + HOUR, person("c@example.com")));
        must(await sdb.cancelBooking(store, { tenantId: T, bookingId: c.id, actor: customer, cutoffHours: 24, now: NOW }));
        fake.deleteRaw(PK, `INTENT#${c.intentId}`); // DynamoDB TTL deleted it (24 h)
        await withCrash(fake, () => sdb.eraseCustomer(store, T, "c@example.com", NOW + 2 * DAY));
        expect(fake.sks("HELD#")).toEqual([]);
        expect(fake.sks("CUST#")).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Step 5: retention (§ 14) and step 6: DAYS# and WEEKMAIL# (§ 23)
// ---------------------------------------------------------------------------------------------------------------

describe("§ 14.1 daily cleanup, § 6.1 TTL rule", () => {
    it("C29 — removes the 8-day hold and the held-then-cancelled one (≤ 24 items each); keeps the 6-day hold and the confirmed; second run changes nothing; next day catches up", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const t0 = NOW;
        const old = must(await holdSlot(store, MON_0900, person("o@example.com"), { now: t0 })).booking;
        const canc = must(await holdSlot(store, MON_0900 + HOUR, person("x@example.com"), { now: t0 })).booking;
        must(await sdb.cancelBooking(store, { tenantId: T, bookingId: canc.id, actor: customer, cutoffHours: 24, now: t0 }));
        const conf = must(await holdSlot(store, MON_0900 + 2 * HOUR, person("c@example.com"), { now: t0 })).booking;
        must(await sdb.confirmBooking(store, T, conf.id, t0));
        const young = must(await holdSlot(store, Date.parse("2026-12-08T07:30:00Z"), person("y@example.com"), { now: t0 + 2 * DAY })).booking;
        for (let i = 0; i < 19; i++) must(await sdb.mintToken(store, T, old.id, t0, { countForEmail: false }));

        const cleanupAt = old.heldUntil! + 8 * DAY; // young expired 6 days before this instant
        const before = fake.txSizes().length;
        expect(await sdb.cleanupExpiredHolds(store, T, cleanupAt)).toEqual({ removed: 2, skipped: 0, busy: 0 });
        expect(Math.max(...fake.txSizes().slice(before))).toBeLessThanOrEqual(24);
        expect(booking(fake, old.id)).toBeUndefined();
        expect(booking(fake, canc.id)).toBeUndefined();
        expect(booking(fake, conf.id)).toBeDefined();
        expect(booking(fake, young.id)).toBeDefined();
        expect(tokenItems(fake, old.id)).toEqual([]);
        expect(fake.get(PK, `INTENT#${old.intentId}`)).toBeUndefined();

        const snapshot = JSON.stringify([...fake.items.entries()]);
        expect(await sdb.cleanupExpiredHolds(store, T, cleanupAt + MIN)).toEqual({ removed: 0, skipped: 0, busy: 0 });
        expect(JSON.stringify([...fake.items.entries()])).toBe(snapshot);
        expect(await sdb.cleanupExpiredHolds(store, T, cleanupAt + 2 * DAY)).toEqual({ removed: 1, skipped: 0, busy: 0 }); // missed day
        expect(booking(fake, young.id)).toBeUndefined();
        expect(itemSetViolations(fake)).toEqual([]);
        // The module has no switch: a tenant with scheduling off is cleaned the same (AP12 selection is sched-1g's).
        expect(sdb.cleanupExpiredHolds.length).toBe(3);
    });

    it("C30 — only INTENT#, LIMIT#EMAIL#, LIMIT#ADDR#, HOLDS#, WEEKMAIL# carry ttl", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const { run } = await seedRun(store);
        const b = must(await holdSlot(store, MON_0900, person(), { addressKey: "198.51.100.4" })).booking;
        must(await holdSeat(store, run.id, person("s@example.com")));
        must(await sdb.confirmBooking(store, T, b.id, NOW));
        must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: true }));
        must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: null, who: person("u@example.com"), channel: "x", adminEmail: admin.email, now: NOW }));
        must(await sdb.editResourceDays(store, T, r, { kind: "set", from: "2026-12-24", to: "2026-12-24", value: { kind: "dayOff" } }, "2026-12-01"));
        await sdb.claimWeekMail(store, T, "2026-12-07", NOW);
        const withTtl = [...fake.items.values()].filter((i) => "ttl" in i).map((i) => i.SK.split("#")[0] + (i.SK.startsWith("LIMIT#") ? `#${i.SK.split("#")[1]}` : ""));
        expect(new Set(withTtl)).toEqual(new Set(["INTENT", "LIMIT#EMAIL", "LIMIT#ADDR", "HOLDS", "WEEKMAIL"]));
        const kinds = new Set([...fake.items.values()].map((i) => i.SK.split("#")[0]));
        for (const k of ["BOOKING", "CUST", "TOKEN", "HELD", "DAYS", "UNPLACED", "RESDAY", "RUN"]) expect(kinds.has(k)).toBe(true);
        const holds = fake.get(PK, fake.sks("HOLDS#")[0])!;
        expect(holds.ttl).toBeGreaterThanOrEqual(Math.floor((NOW + DAY) / 1000));
    });
});

describe("§ 23 DAYS# and WEEKMAIL#", () => {
    const today = "2026-12-01";
    const set = (date: string, value: any) => ({ kind: "set" as const, from: date, to: date, value });

    it("C31 — the first edit creates the item with attribute_not_exists(SK), v = 1", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        must(await sdb.editResourceDays(store, T, r, set("2026-12-24", { kind: "dayOff" }), today));
        const put = fake.ops("PutCommand").at(-1);
        expect(put.ConditionExpression).toBe("attribute_not_exists(SK)");
        expect(fake.get(PK, `DAYS#${r}`)).toMatchObject({ v: 1, days: { "2026-12-24": { kind: "dayOff" } } });
    });

    it("C31 — two edits at once on different dates: both stored (the loser re-reads and re-applies)", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        fake.on("PutCommand", "before", async () => { must(await sdb.editResourceDays(store, T, r, set("2026-12-25", { kind: "dayOff" }), today)); },
            (p) => p.Item.SK === `DAYS#${r}`);
        must(await sdb.editResourceDays(store, T, r, set("2026-12-24", { kind: "dayOff" }), today));
        expect(Object.keys(fake.get(PK, `DAYS#${r}`)!.days).sort()).toEqual(["2026-12-24", "2026-12-25"]);
        expect(fake.get(PK, `DAYS#${r}`)!.v).toBe(2);
    });

    it("C31 — two edits at once on the same date: the value of the write that commits last", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const hours = { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] };
        fake.on("PutCommand", "before", async () => { must(await sdb.editResourceDays(store, T, r, set("2026-12-24", hours), today)); },
            (p) => p.Item.SK === `DAYS#${r}`);
        must(await sdb.editResourceDays(store, T, r, set("2026-12-24", { kind: "dayOff" }), today));
        expect(fake.get(PK, `DAYS#${r}`)!.days["2026-12-24"]).toEqual({ kind: "dayOff" });
    });

    it("C31 — three at once (the condition lost twice): one busy, nothing of it stored", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const isDays = (p: any) => p.Item.SK === `DAYS#${r}`;
        fake.on("PutCommand", "before", async () => {
            must(await sdb.editResourceDays(store, T, r, set("2026-12-25", { kind: "dayOff" }), today));
            fake.on("PutCommand", "before", async () => {
                must(await sdb.editResourceDays(store, T, r, set("2026-12-26", { kind: "dayOff" }), today));
            }, isDays);
        }, isDays);
        expect(await sdb.editResourceDays(store, T, r, set("2026-12-24", { kind: "dayOff" }), today)).toEqual({ ok: false, error: { kind: "busy" } });
        expect(Object.keys(fake.get(PK, `DAYS#${r}`)!.days).sort()).toEqual(["2026-12-25", "2026-12-26"]);
    });

    it("C31 — editDays refusals pass through (startsInPast)", async () => {
        const { store } = setup();
        const [r] = await seedSlots(store);
        expect(await sdb.editResourceDays(store, T, r, set("2026-11-30", { kind: "dayOff" }), today))
            .toEqual({ ok: false, error: { kind: "startsInPast", today } });
    });

    it("C33 — DAYS# absent / valid / malformed: defaults; the overrides; storedDataInvalid (never 'no override')", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        expect(await sdb.getDays(store, T, r, true)).toEqual({});
        fake.putRaw({ PK, SK: `DAYS#${r}`, v: 3, days: { "2026-12-24": { kind: "dayOff", note: "Holiday" } } });
        expect(await sdb.getDays(store, T, r, false)).toEqual({ "2026-12-24": { kind: "dayOff", note: "Holiday" } });
        const malformed = [
            { v: 1, days: { "2026-12-24": { kind: "dayHours", windows: [] } } },
            { v: 1, days: { "2026-13-01": { kind: "dayOff" } } },
            { days: {} },
            { v: 0, days: {} },
            { v: 1.5, days: {} },
        ];
        for (const m of malformed) {
            fake.putRaw({ PK, SK: `DAYS#${r}`, ...m });
            await expect(sdb.getDays(store, T, r, true)).rejects.toBeInstanceOf(sdb.StoredDataInvalidError);
            await expect(sdb.editResourceDays(store, T, r, set("2026-12-24", { kind: "dayOff" }), today)).rejects.toBeInstanceOf(sdb.StoredDataInvalidError);
            await expect(holdSlot(store)).rejects.toBeInstanceOf(sdb.StoredDataInvalidError);
        }
    });

    it("C34 — WEEKMAIL# claim, second claim, after sentAt, two at once, next week, ttl, malformed sentAt", async () => {
        const { fake, store } = setup();
        const W = "2026-12-07";
        const ttl = Math.floor((Date.parse(`${W}T00:00:00Z`) + 14 * DAY) / 1000);
        expect(await sdb.claimWeekMail(store, T, W, NOW)).toEqual({ alreadySent: false });
        expect(fake.get(PK, `WEEKMAIL#${W}`)).toMatchObject({ claimedAt: NOW, ttl });
        expect(fake.get(PK, `WEEKMAIL#${W}`)!.sentAt).toBeUndefined();
        expect(await sdb.claimWeekMail(store, T, W, NOW + 15 * MIN)).toEqual({ alreadySent: false });
        expect(fake.get(PK, `WEEKMAIL#${W}`)!.claimedAt).toBe(NOW);
        await sdb.markWeekMailSent(store, T, W, NOW + 16 * MIN);
        expect(await sdb.claimWeekMail(store, T, W, NOW + 30 * MIN)).toEqual({ alreadySent: true });

        const W2 = "2026-12-14";
        expect(await Promise.all([sdb.claimWeekMail(store, T, W2, NOW), sdb.claimWeekMail(store, T, W2, NOW + 1)]))
            .toEqual([{ alreadySent: false }, { alreadySent: false }]); // the documented duplicate case
        expect(fake.get(PK, `WEEKMAIL#${W2}`)!.ttl).toBe(Math.floor((Date.parse(`${W2}T00:00:00Z`) + 14 * DAY) / 1000));

        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        fake.putRaw({ PK, SK: "WEEKMAIL#2026-12-21", claimedAt: NOW, sentAt: "yes", ttl: 1 });
        expect(await sdb.claimWeekMail(store, T, "2026-12-21", NOW)).toEqual({ alreadySent: false });
        expect(log).toHaveBeenCalledWith(expect.stringContaining("sentAt is not a number"), T, "2026-12-21");
        log.mockRestore();
    });
});

// ---------------------------------------------------------------------------------------------------------------
// C35 — entry `rev` in persistence and the one display list function
// ---------------------------------------------------------------------------------------------------------------

describe("C35 — entry rev", () => {
    const entriesOf = (fake: FakeTable, id: string) => [...fake.items.values()]
        .filter((i) => i.SK.startsWith("RESDAY#") && i.entries[id]).map((i) => i.entries[id]);

    it("C35 (1) after a hold, a confirm, slot moves (same day, another day, across UTC midnight) and a manual appointment: every entry rev = BOOKING#.rev", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const check = (id: string) => {
            const copies = entriesOf(fake, id);
            expect(copies.length).toBeGreaterThan(0);
            for (const e of copies) expect(e.rev).toBe(booking(fake, id)!.rev);
        };
        const { booking: b } = must(await holdSlot(store));
        check(b.id);
        must(await sdb.confirmBooking(store, T, b.id, NOW));
        check(b.id);
        must(await sdb.moveSlot(store, { tenantId: T, bookingId: b.id, start: MON_0900 + HOUR, resourceIds: [r], actor: admin, settings, now: NOW }));
        check(b.id);
        must(await sdb.moveSlot(store, { tenantId: T, bookingId: b.id, start: MON_0900 + DAY, resourceIds: [r], actor: admin, settings, now: NOW }));
        check(b.id);
        must(await sdb.moveSlot(store, { tenantId: T, bookingId: b.id, start: Date.parse("2026-12-08T23:30:00Z"), resourceIds: [r], actor: admin, settings, now: NOW }));
        expect(entriesOf(fake, b.id)).toHaveLength(2);
        check(b.id);
        expect(Object.keys(fake.get(PK, `RESDAY#${r}#2026-12-07`)!.entries)).toEqual([]);
        const m = must(await sdb.createManualAppointment(store, { tenantId: T, serviceId: "svc60", resourceId: r, start: MON_0900, who: person("m@example.com"), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        check(m.id);
    });

    it("C35 (2) after a token mint and a reminder mark: entries unchanged, their rev now below BOOKING#.rev, copies equal", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const { booking: b } = must(await sdb.createManualAppointment(store, { tenantId: T, serviceId: "svc60", resourceId: r, start: Date.parse("2026-12-07T23:30:00Z"), who: person(), channel: "phone", adminEmail: admin.email, now: NOW }));
        const before = JSON.stringify(entriesOf(fake, b.id));
        must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: false }));
        expect(await sdb.markReminder(store, T, b.id, { kind: "slot", start: Date.parse("2026-12-07T23:30:00Z") })).toEqual({ kind: "marked" });
        expect(await sdb.markReminder(store, T, b.id, { kind: "slot", start: Date.parse("2026-12-07T23:30:00Z") })).toEqual({ kind: "stale" });
        expect(JSON.stringify(entriesOf(fake, b.id))).toBe(before);
        const copies = entriesOf(fake, b.id);
        expect(copies).toHaveLength(2);
        expect(copies[0]).toEqual(copies[1]);
        expect(copies[0].rev).toBeLessThan(booking(fake, b.id)!.rev);
    });

    it("C35 (3) readIntervals with one Query returning the A25 (c), (d), (e) items: the A25 results, one Query, no other read", async () => {
        const { fake, store } = setup();
        const r = "r1";
        const s = Date.parse("2026-12-06T23:30:00Z");
        fake.putRaw({ PK, SK: `RESDAY#${r}#2026-12-06`, v: 4, entries: {
            C: { s, e: s + HOUR, x: NOW + HOUR, rev: 3 },         // (c) held copy
            D: { s: s - 3 * HOUR, e: s - 2 * HOUR, rev: 5 },      // (d) old placement
            B: { s, e: s + HOUR, x: NOW + HOUR, rev: 2 },         // (e) B held copy
            A: { s: s - HOUR, e: s + HOUR, rev: 7 },              // (e) A
        } });
        fake.putRaw({ PK, SK: `RESDAY#${r}#2026-12-07`, v: 2, entries: {
            C: { s, e: s + HOUR, rev: 4 },                         // (c) confirmed copy
            D: { s: s + 2 * HOUR, e: s + 3 * HOUR, rev: 6 },      // (d) new placement
            B: { s, e: s + HOUR, rev: 3 },                         // (e) B confirmed during the read
            A: { s: s - HOUR, e: s + HOUR, rev: 7 },
        } });
        const span = { start: Date.parse("2026-12-06T12:00:00Z"), end: Date.parse("2026-12-07T12:00:00Z") };
        const got = await sdb.readIntervals(store, T, r, span, NOW);
        const byId = Object.fromEntries(got.map((e) => [e.bookingId, e]));
        expect(Object.keys(byId).sort()).toEqual(["A", "B", "C", "D"]);
        expect(byId.C.rev).toBe(4);
        expect(byId.C.x).toBeUndefined();
        expect(byId.D).toMatchObject({ rev: 6, s: s + 2 * HOUR });
        expect(byId.A.rev).toBe(7);
        expect(byId.B.rev).toBe(3);
        expect(fake.calls.map((c) => c.op)).toEqual(["QueryCommand"]);
        expect(fake.ops("QueryCommand")[0].ProjectionExpression).toBeDefined();
        // same answer as the kernel on the raw entries
        expect(got).toEqual(activeEntries(got, span, NOW));
    });

    it("C35 (4) field evidence of the entry rev: absent, 0, 1.5 → storedDataInvalid; 1 accepted", async () => {
        const { fake, store } = setup();
        const span = { start: MON_0900 - HOUR, end: MON_0900 + 2 * HOUR };
        const put = (entry: Record<string, unknown>) => fake.putRaw({ PK, SK: "RESDAY#r1#2026-12-07", v: 1, entries: { b1: { s: MON_0900, e: MON_0900 + HOUR, ...entry } } });
        for (const bad of [{}, { rev: 0 }, { rev: 1.5 }]) {
            put(bad);
            await expect(sdb.readIntervals(store, T, "r1", span, NOW)).rejects.toBeInstanceOf(sdb.StoredDataInvalidError);
        }
        put({ rev: 1 });
        expect(await sdb.readIntervals(store, T, "r1", span, NOW)).toHaveLength(1);
    });
});

describe("§ 11.3 reminder marker (seat)", () => {
    it("a seat reminder marks once; a run move between selection and mark → stale", async () => {
        const { store } = setup();
        const { run } = await seedRun(store);
        const b = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person(), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        const first = Date.parse(run.firstStartIso);
        must(await sdb.moveRun(store, T, "c1", run.id, [{ date: "2026-12-13", start: "10:00", end: "13:00" }], NOW));
        expect(await sdb.markReminder(store, T, b.id, { kind: "seat", courseId: "c1", runId: run.id, firstStart: first })).toEqual({ kind: "stale" });
        const moved = (await sdb.getRun(store, T, "c1", run.id, true))!;
        expect(await sdb.markReminder(store, T, b.id, { kind: "seat", courseId: "c1", runId: run.id, firstStart: Date.parse(moved.firstStartIso) })).toEqual({ kind: "marked" });
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Revision 1 — regressions for review-0 findings SCHED1C-R1…R4, each closed by one rule
// ---------------------------------------------------------------------------------------------------------------

describe("review-0 regressions", () => {
    const setNamesOf = (update: any): string[] => {
        const clause = String(update.UpdateExpression).split(" REMOVE ")[0].replace(/^SET /, "");
        return clause.split(",").map((a) => update.ExpressionAttributeNames[a.split("=")[0].trim().split(".")[0]]).sort();
    };
    const bookingUpdates = (fake: FakeTable, from: number) => fake.ops("TransactWriteCommand").slice(from)
        .flatMap((tx) => tx.TransactItems).map((t: any) => t.Update).filter((u: any) => u && String(u.Key.SK).startsWith("BOOKING#"));

    it("C6 — (R1) markHoldMail commits between the mint's read and its write: the mint keeps mail = sent", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const { booking: b } = must(await holdSlot(store));
        fake.on("TransactWriteCommand", "before", async () => { expect(await sdb.markHoldMail(store, T, b.id, b.rev, "sent")).toBe(true); });
        must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: true }));
        expect(booking(fake, b.id)!.state).toMatchObject({ kind: "held", mail: "sent" });
        expect(booking(fake, b.id)!.tokenHashes).toHaveLength(2);
    });

    it("C6 — (R1) the mint commits first: a mark with the old rev writes nothing; with the new rev it marks", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const { booking: b } = must(await holdSlot(store));
        const minted = must(await sdb.mintToken(store, T, b.id, NOW, { countForEmail: true }));
        expect(await sdb.markHoldMail(store, T, b.id, b.rev, "sent")).toBe(false);
        expect(booking(fake, b.id)!.state).toMatchObject({ mail: "pending" });
        expect(await sdb.markHoldMail(store, T, b.id, minted.booking.rev, "sent")).toBe(true);
        expect(booking(fake, b.id)!.state).toMatchObject({ mail: "sent" });
    });

    it("C21 — (R1 rule) every booking update sets only the attributes its change names (+ rev, updatedAt, history with an entry)", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const { run } = await seedRun(store);
        const { booking: b } = must(await holdSlot(store));
        const check = async (op: () => Promise<unknown>, expected: string[]) => {
            const from = fake.ops("TransactWriteCommand").length;
            must(await op() as any);
            const updates = bookingUpdates(fake, from);
            expect(updates.length).toBeGreaterThan(0);
            for (const u of updates) expect(setNamesOf(u)).toEqual([...expected].sort());
        };
        await check(() => sdb.mintToken(store, T, b.id, NOW, { countForEmail: false }), ["tokenHashes", "rev", "updatedAt"]);
        await check(() => sdb.confirmBooking(store, T, b.id, NOW), ["state", "rev", "updatedAt", "history"]);
        await check(() => sdb.moveSlot(store, { tenantId: T, bookingId: b.id, start: MON_0900 + HOUR, resourceIds: [r], actor: admin, settings, now: NOW }),
            ["what", "rev", "updatedAt", "history"]);
        await check(() => sdb.cancelBooking(store, { tenantId: T, bookingId: b.id, actor: admin, cutoffHours: 24, now: NOW }),
            ["state", "tokenHashes", "rev", "updatedAt", "history"]);
        const s = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person("s@example.com"), channel: "x", adminEmail: admin.email, now: NOW })).booking;
        await check(() => sdb.moveSeat(store, { tenantId: T, bookingId: s.id, runId: null, actor: admin, cutoffHours: 24, now: NOW }), ["what", "rev", "updatedAt", "history"]);
    });

    it("C3 — (R2) a run move at X + 2 s counts A's hold as expired and removes it; A's confirm at X − 2 s → expired", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store, { capacity: 2 });
        const A = must(await holdSeat(store, run.id, person("a@example.com"))).booking;
        const C = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person("c@example.com"), channel: "x", adminEmail: admin.email, now: NOW })).booking;
        const X = A.heldUntil!;
        const moved = must(await sdb.moveRun(store, T, "c1", run.id, [{ date: "2026-12-13", start: "10:00", end: "13:00" }], X + 2000));
        expect(moved.activeBookingIds).toEqual([C.id]);
        expect(Object.keys(fake.get(PK, `RUN#c1#${run.id}`)!.seats)).toEqual([C.id]);
        expect(moved.run.seats).toEqual({ [C.id]: {} });
        expect(await sdb.confirmBooking(store, T, A.id, X - 2000)).toEqual({ ok: false, error: { kind: "expired", at: X } });
    });

    it("C8 — (R2) updateRun reads no seat and leaves seats as stored (an expired entry stays until the next seat writer)", async () => {
        const { fake, store } = setup();
        const { run } = await seedRun(store, { capacity: 3 });
        const A = must(await holdSeat(store, run.id, person("a@example.com"))).booking;
        must(await sdb.updateRun(store, T, "c1", run.id, { capacity: 2 }, A.heldUntil! + 1));
        expect(Object.keys(fake.get(PK, `RUN#c1#${run.id}`)!.seats)).toEqual([A.id]);
        must(await holdSeat(store, run.id, person("b@example.com"), { now: A.heldUntil! + 1 }));
        expect(Object.keys(fake.get(PK, `RUN#c1#${run.id}`)!.seats)).not.toContain(A.id);
    });

    it("C10 — (R4) admin slot move: the current service duration (60 → 30 min); a deleted service keeps the stored duration", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store);
        const a = must(await sdb.createManualAppointment(store, { tenantId: T, serviceId: "svc60", resourceId: r, start: MON_0900, who: person("a@example.com"), channel: "x", adminEmail: admin.email, now: NOW })).booking;
        const b = must(await sdb.createManualAppointment(store, { tenantId: T, serviceId: "svc60", resourceId: r, start: MON_0900 + HOUR, who: person("b@example.com"), channel: "x", adminEmail: admin.email, now: NOW })).booking;
        await sdb.putService(store, T, { id: "svc60", name: "Consult 60", durationMin: 30, eligibility: { kind: "all" } });
        const movedA = must(await sdb.moveSlot(store, { tenantId: T, bookingId: a.id, start: MON_0900 + DAY, resourceIds: [r], actor: admin, settings, now: NOW }));
        expect(movedA.what).toMatchObject({ start: MON_0900 + DAY, end: MON_0900 + DAY + 30 * MIN, serviceName: "Consult 60" });
        await sdb.deleteService(store, T, "svc60");
        const movedB = must(await sdb.moveSlot(store, { tenantId: T, bookingId: b.id, start: MON_0900 + DAY + 2 * HOUR, resourceIds: [r], actor: admin, settings, now: NOW }));
        expect(movedB.what).toMatchObject({ end: MON_0900 + DAY + 3 * HOUR });
        expect(await sdb.moveSlot(store, { tenantId: T, bookingId: b.id, start: MON_0900 + 2 * DAY, resourceIds: [r], actor: customer, settings, now: NOW }))
            .toEqual({ ok: false, error: { kind: "notFound" } });
        expect(booking(fake, b.id)!.what.end - booking(fake, b.id)!.what.start).toBe(HOUR);
    });

    it("§ 6.4 rule 4 — (R3 rule) every read sent by a write operation is ConsistentRead; display reads are not", async () => {
        const { fake, store } = setup();
        const [r] = await seedSlots(store); // eligibility "all": the hold enumerates RESOURCE#
        const { run, trainerId } = await seedRun(store, { capacity: 10 });
        const { run: run2 } = await seedRun(store, { trainerId, capacity: 10 });
        const reads = () => fake.calls.filter((c) => ["GetCommand", "QueryCommand", "BatchGetCommand"].includes(c.op));
        const consistentFlag = (c: { op: string; input: any }) => c.op === "BatchGetCommand"
            ? Object.values<any>(c.input.RequestItems)[0].ConsistentRead : c.input.ConsistentRead;
        const writeOps: [string, () => Promise<unknown>][] = [];
        let slot: any, seat: any, unplaced: any;
        writeOps.push(["holdSlot", async () => { slot = must(await holdSlot(store)).booking; }]);
        writeOps.push(["holdSeat", async () => { seat = must(await holdSeat(store, run.id, person("s@example.com"))).booking; }]);
        writeOps.push(["confirm", () => sdb.confirmBooking(store, T, slot.id, NOW)]);
        writeOps.push(["mint", () => sdb.mintToken(store, T, slot.id, NOW, { countForEmail: true })]);
        writeOps.push(["moveSlot customer", () => sdb.moveSlot(store, { tenantId: T, bookingId: slot.id, start: MON_0900 + HOUR, resourceIds: [r], actor: customer, settings, now: NOW })]);
        writeOps.push(["moveSlot admin", () => sdb.moveSlot(store, { tenantId: T, bookingId: slot.id, start: MON_0900, resourceIds: [r], actor: admin, settings, now: NOW })]);
        writeOps.push(["manual appointment", () => sdb.createManualAppointment(store, { tenantId: T, serviceId: "svc60", resourceId: r, start: MON_0900 + 2 * HOUR, who: person("m@example.com"), channel: "x", adminEmail: admin.email, now: NOW })]);
        writeOps.push(["manual seat unplaced", async () => { unplaced = must(await sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: null, who: person("u@example.com"), channel: "x", adminEmail: admin.email, now: NOW })).booking; }]);
        writeOps.push(["manual seat run", () => sdb.createManualSeat(store, { tenantId: T, courseId: "c1", runId: run.id, who: person("v@example.com"), channel: "x", adminEmail: admin.email, now: NOW })]);
        writeOps.push(["moveSeat", () => sdb.moveSeat(store, { tenantId: T, bookingId: unplaced.id, runId: run2.id, actor: admin, cutoffHours: 24, now: NOW })]);
        writeOps.push(["cancel", () => sdb.cancelBooking(store, { tenantId: T, bookingId: seat.id, actor: customer, cutoffHours: 24, now: NOW })]);
        writeOps.push(["updateRun", () => sdb.updateRun(store, T, "c1", run.id, { capacity: 9 }, NOW)]);
        writeOps.push(["moveRun", () => sdb.moveRun(store, T, "c1", run.id, [{ date: "2026-12-13", start: "10:00", end: "13:00" }], NOW)]);
        writeOps.push(["cancelRun", () => sdb.cancelRun(store, T, "c1", run2.id, admin.email, NOW)]);
        writeOps.push(["removeResource", () => sdb.removeResource(store, T, trainerId, NOW)]);
        writeOps.push(["editDays", () => sdb.editResourceDays(store, T, r, { kind: "set", from: "2026-12-24", to: "2026-12-24", value: { kind: "dayOff" } }, "2026-12-01")]);
        writeOps.push(["cleanup", () => sdb.cleanupExpiredHolds(store, T, NOW + 30 * DAY)]);
        writeOps.push(["erase", () => sdb.eraseCustomer(store, T, "ana@example.com", NOW)]);
        for (const [name, op] of writeOps) {
            const from = reads().length;
            await op();
            const sent = reads().slice(from);
            expect(sent.length, name).toBeGreaterThan(0);
            for (const c of sent) expect(consistentFlag(c), `${name}: ${c.op}`).toBe(true);
        }
        // The two reads named by review-0:
        const resourceQueries = fake.ops("QueryCommand").filter((q) => q.ExpressionAttributeValues[":p"] === "RESOURCE#");
        expect(resourceQueries.length).toBeGreaterThan(0);
        expect(resourceQueries.every((q) => q.ConsistentRead === true)).toBe(true);
        expect(fake.ops("GetCommand").filter((g) => g.Key.SK === "COURSE#c1").every((g) => g.ConsistentRead === true)).toBe(true);
        // Display reads stay eventually consistent:
        const from = reads().length;
        await sdb.listResources(store, T, false);
        await sdb.readIntervals(store, T, r, { start: MON_0900 - HOUR, end: MON_0900 + 3 * HOUR }, NOW);
        await sdb.listRuns(store, T, "c1");
        expect(reads().slice(from).every((c) => consistentFlag(c) === false)).toBe(true);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// SCHED-1D2 ruling S1D2-CONFIRM-OUTCOME (review finding S1D2-R02): confirmBooking says whether THIS call committed
// the confirmation, from the attempt that ends its versioned loop — never from a timestamp.
// ---------------------------------------------------------------------------------------------------------------

describe("S1D2-R02 — confirmBooking outcome (applied | alreadyConfirmed)", () => {
    const transactions = (fake: FakeTable) => fake.calls.filter((c) => c.op === "TransactWriteCommand").length;

    it("S1D2-R02 a held booking → applied, with the confirmed booking; the same call again, same clock → alreadyConfirmed, no write", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const { booking: held } = must(await holdSlot(store));
        const first = must(await sdb.confirmBooking(store, T, held.id, NOW));
        expect(first.kind).toBe("applied");
        expect(first.booking.state).toEqual({ kind: "confirmed", at: NOW });
        expect(first.booking.rev).toBe(held.rev + 1);
        const before = transactions(fake);
        const again = must(await sdb.confirmBooking(store, T, held.id, NOW));   // the SAME millisecond (review probe)
        expect(again.kind).toBe("alreadyConfirmed");
        expect(again.booking.state).toEqual({ kind: "confirmed", at: NOW });
        expect(transactions(fake)).toBe(before);
    });

    it("S1D2-R02 two confirms at once, same clock: the one that commits is applied, the other re-reads → alreadyConfirmed", async () => {
        for (const kind of ["slot", "seat"] as const) {
            const { fake, store } = setup();
            let id: string;
            if (kind === "slot") {
                await seedSlots(store);
                id = must(await holdSlot(store)).booking.id;
            } else {
                const { run } = await seedRun(store);
                id = must(await holdSeat(store, run.id)).booking.id;
            }
            let inner: any;
            fake.on("TransactWriteCommand", "before", async () => { inner = await sdb.confirmBooking(store, T, id, NOW); });
            const outer = must(await sdb.confirmBooking(store, T, id, NOW));
            expect({ kind, inner: must(inner).kind, outer: outer.kind }).toEqual({ kind, inner: "applied", outer: "alreadyConfirmed" });
            expect(booking(fake, id)!.history.filter((e: any) => e.action === "confirmed")).toHaveLength(1);
        }
    });

    it("S1D2-R02 a token mint commits between the confirm's read and write: the confirm retries and is still applied", async () => {
        const { fake, store } = setup();
        await seedSlots(store);
        const { booking: held } = must(await holdSlot(store));
        fake.on("TransactWriteCommand", "before", async () => { must(await sdb.mintToken(store, T, held.id, NOW, { countForEmail: false })); });
        const outcome = must(await sdb.confirmBooking(store, T, held.id, NOW));
        expect(outcome.kind).toBe("applied");
        expect(outcome.booking.tokenHashes).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// SCHED-1E1 store extension (operator ruling S1E1-STORE-ALLOCATION): listServices(consistent), replaceService
// ---------------------------------------------------------------------------------------------------------------

describe("SCHED-1E1 store extension", () => {
    const svc = { id: "svc1", name: "Consult", durationMin: 60, eligibility: { kind: "all" as const } };

    it("listServices sends ConsistentRead exactly as asked (true for the create bound, false for displays)", async () => {
        const { fake, store } = setup();
        await sdb.putService(store, T, svc);
        expect((await sdb.listServices(store, T, true)).map((s) => s.id)).toEqual(["svc1"]);
        expect((await sdb.listServices(store, T, false)).map((s) => s.id)).toEqual(["svc1"]);
        expect(fake.ops("QueryCommand").map((q) => q.ConsistentRead)).toEqual([true, false]);
    });

    it("replaceService: an existing service is replaced (one Put under attribute_exists(SK)); a missing one → notFound, nothing written", async () => {
        const { fake, store } = setup();
        await sdb.putService(store, T, svc);
        expect(await sdb.replaceService(store, T, { ...svc, durationMin: 30 })).toEqual({ ok: true, value: { ...svc, durationMin: 30 } });
        expect(fake.get(PK, "SERVICE#svc1")).toMatchObject({ durationMin: 30 });
        expect(fake.ops("PutCommand").at(-1).ConditionExpression).toBe("attribute_exists(SK)");
        expect(await sdb.replaceService(store, T, { ...svc, id: "ghost" })).toEqual({ ok: false, error: { kind: "notFound" } });
        expect(fake.get(PK, "SERVICE#ghost")).toBeUndefined();
    });

    it("replaceService: a delete that commits after the caller's read is not undone (review S1E1-R03)", async () => {
        const { fake, store } = setup();
        await sdb.putService(store, T, svc);
        expect(await sdb.getService(store, T, "svc1", true)).toBeDefined();      // the update route's preflight read
        fake.on("PutCommand", "before", () => sdb.deleteService(store, T, "svc1"));  // the delete commits in between
        expect(await sdb.replaceService(store, T, { ...svc, name: "Renamed" })).toEqual({ ok: false, error: { kind: "notFound" } });
        expect(fake.get(PK, "SERVICE#svc1")).toBeUndefined();
    });
});
