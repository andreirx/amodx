/**
 * SCHED-1C (docs/slices/sched-1.md § 6, § 7, § 8.4, § 13, § 14, § 23) — every read and every write of the
 * scheduling-private table. Maturity: PROTOTYPE (until `sched-1i` passes on staging, § 17).
 *
 * This is the ONLY code that names the scheduling table. Callers pass a `SchedulingStore` (client, table name,
 * sleep); handlers get it from `schedulingStoreFromEnv()`, tests build one around a fake or a staging client.
 *
 * Division of work (§ 5.2 "the kernel detects, the database enforces"):
 * - decisions are the kernel's (`@amodx/shared` scheduling.ts, pure); this module never re-states a rule;
 * - this module reads with `ConsistentRead` what a write decides on, calls the kernel on that snapshot, builds
 *   ONE `TransactWriteItems`, and maps DynamoDB cancellation reasons (by item position) to the refusal unions of
 *   the specification;
 * - expected failures are `Result` values; a broken stored item throws `StoredDataInvalidError` (500
 *   `storedDataInvalid`, § 10.2); a broken invariant or caller precondition throws `Error`.
 *
 * Two version rules (§ 7.1), applied by one loop (`versioned`):
 * - container rule: `RESDAY#` and `HOLDS#` are read consistently and written with `v = :v + 1` under `v = :v` (or
 *   `attribute_not_exists(SK)`). Every write that reads a container's entries to decide or to count rewrites the
 *   whole map in that update, without the entries its own clock counts as expired;
 * - booking rule: every change of a booking's `what`, `state` or `tokenHashes` is conditioned on
 *   `attribute_exists(SK) AND rev = :rev` and sets `rev = :rev + 1`; a change of `what` or `state` appends its
 *   `history` entry in the same update. The update sets only the attributes the change names (`changed()`), never
 *   a read copy of another attribute.
 * Reads that a write decides on use `ConsistentRead` (§ 6.4 rule 4); the display reads (`readIntervals`,
 * `getBookingViews`, `listResources(…, false)`, …) do not.
 * Transactions: each booking or container change is ONE `TransactWriteItems`. Not single transactions by design:
 * `removeResource` (fence UpdateItem, check reads, release UpdateItem or delete transaction, § 13), the
 * per-booking transactions of `cleanupExpiredHolds` and `eraseCustomer` (§ 14), and the single-item writes
 * `markHoldMail`, `markWeekMailSent`, `claimWeekMail`, `editResourceDays` (Put) and configuration Puts.
 * A lost container or booking condition (or a `TransactionConflict`) re-reads and decides again, at most 3
 * attempts, then `busy` (503). Any other failed condition is a refusal named by the item that carried it.
 *
 * Abstraction lines (§ 19):
 * - `SchedulingStore` — users: every function here (handlers with the Lambda client and env table; unit tests
 *   with the in-memory fake; the integration test with a staging client); axis: none — a parameter object, not an
 *   interface (rejected: a module-level client + env const as `lib/db.ts`, which a unit test cannot replace).
 * - `versioned` + `Tagged<R>` (the § 7.1 "container write") — users: every transaction of § 7, § 8.4, § 14;
 *   axis: operations fixed, two container kinds as a closed sum (`ContainerWrite`, exhaustive `switch`);
 *   rejected: one hand-written read/condition/retry/reason loop per operation.
 * - `StoredBooking` (SCHED-GROUPS-REMOVE-1) — users: `getBooking`, `cleanupExpiredHolds`, `eraseCustomer`; axis:
 *   variants fixed (a slot, or a stored item of the removed group shape), sum + exhaustive `switch`; rejected: keeping the
 *   removed group variants in `BookingSchema` (the group types would stay on `main`).
 *
 * Stored items of the removed group shape (SCHED-GROUPS-REMOVE-1; code on branch `archive/group-scheduling-2026-11`):
 * a `BOOKING#` whose `what.kind` is `"seat"` or `"unplaced"` is never parsed as a `Booking`. Every reader treats it as absent
 * (`getBooking` → `undefined`), except the two removals of customer data, which delete its item set (`BOOKING#`,
 * `CUST#`, `HELD#`, `INTENT#`, listed `TOKEN#`): `cleanupExpiredHolds` (§ 14.1) and `eraseCustomer` (§ 14.2). The
 * other items of that shape (`COURSE#`, `RUN#`, `RUNSPAN#`, `UNPLACED#`) are not read by any code; they hold no
 * person's name, email or phone.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
    BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand,
    type DynamoDBDocumentClient, type QueryCommandInput, type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import {
    AvailabilityRulesSchema, BookingSchema, DayOverridesSchema, ResDayEntrySchema, ResourceSchema, ServiceSchema,
    activeEntries, appendHistory, changeDecision, confirmDecision, editDays,
    holdExpiry, lastBookableDate, normalizeEmail, overlapCheck, slotDecision,
    type Actor, type AvailabilityRule, type Booking, type BookingWhat, type ChangeRefusal, type ConfirmRefusal,
    type ContainerEntry, type DayOverrides, type DaysEdit, type DaysEditError, type HistoryEntry,
    type Instant, type LocalDate, type Person, type Placement, type Resource,
    type Result, type Service, type SlotRefusal,
    type TimeZone,
} from "@amodx/shared";
import { db } from "./db.js";

// ---------------------------------------------------------------------------------------------------------------
// Store, errors, small helpers
// ---------------------------------------------------------------------------------------------------------------

export type SchedulingStore = {
    db: Pick<DynamoDBDocumentClient, "send">;
    table: string;
    /** Backoff between attempts (§ 6.4 rule 2, § 7.1 point 4). Tests pass a no-op. */
    sleep: (ms: number) => Promise<void>;
};

/**
 * The one place that reads `SCHEDULING_TABLE_NAME` (§ 6.1: set on the scheduling functions only). Follows
 * `lib/db.ts` (shared Lambda client, table name from the environment); unlike its `|| ""`, an unset name throws
 * here, so a miswired function fails at its first call instead of sending requests to table "".
 */
export function schedulingStoreFromEnv(): SchedulingStore {
    const table = process.env.SCHEDULING_TABLE_NAME;
    if (!table) throw new Error("SCHEDULING_TABLE_NAME is not set");
    return { db, table, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
}

/** § 10.2: a stored item that fails its schema → 500 `storedDataInvalid`, logged with the key, never the value. */
export class StoredDataInvalidError extends Error {
    constructor(readonly key: string) {
        super(`[scheduling] storedDataInvalid ${key}`);
        this.name = "StoredDataInvalidError";
    }
}

export type Busy = { kind: "busy" };
export type NotFound = { kind: "notFound" };
const BUSY: Busy = { kind: "busy" };
const NOT_FOUND: NotFound = { kind: "notFound" };

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });

function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_ATTEMPTS = 3;            // § 7.1 point 4
const MAX_BATCH_ATTEMPTS = 5;      // § 6.4 rule 2
const MAX_TOKENS = 20;             // § 4.5, operator ruling R01
const MAX_OPEN_HOLDS = 2;          // § 4.5
const EMAIL_LIMIT_PER_HOUR = 5;    // § 4.5
const ADDRESS_LIMIT_PER_HOUR = 20; // § 4.5
const CLEANUP_AGE_MS = 7 * DAY_MS; // § 14.1
const FENCE_TAKEOVER_MS = 10 * MINUTE_MS; // § 13
const TRANSACTION_ITEM_LIMIT = 100;

export function sha256hex(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

/** UTC ISO-8601 with milliseconds and `Z`, fixed width (§ 4: string order = time order). */
export function iso(ms: Instant): string {
    return new Date(ms).toISOString();
}

/** The UTC date of an instant (`RESDAY#` keys). */
export function utcDate(ms: Instant): string {
    return iso(ms).slice(0, 10);
}

/** The UTC dates that the half-open interval `[s, e)` touches, in order (one, or more across UTC midnight). */
export function utcDatesOf(s: Instant, e: Instant): string[] {
    if (!(e > s)) throw new Error("utcDatesOf: end must be after start");
    const dates: string[] = [];
    for (let day = Date.parse(`${utcDate(s)}T00:00:00.000Z`); day < e; day += DAY_MS) dates.push(utcDate(day));
    return dates;
}

const ttlSeconds = (ms: Instant): number => Math.floor(ms / 1000); // § 4: DynamoDB `ttl` = epoch seconds
const hourNumber = (ms: Instant): number => Math.floor(ms / HOUR_MS);

/** § 6.2: `LIMIT#…` counters are eligible for TTL deletion 2 h after their hour ends. */
const limitTtl = (now: Instant): number => ttlSeconds((hourNumber(now) + 3) * HOUR_MS);

function jitter(attempt: number): number {
    return Math.floor(Math.random() * 50 * attempt) + 10 * attempt;
}

// ---------------------------------------------------------------------------------------------------------------
// Keys (§ 6.2). Every item has PK = TENANT#<tenantId>. An id that carries `#` would make a key ambiguous: refused.
// ---------------------------------------------------------------------------------------------------------------

function part(value: string, what: string): string {
    if (value.length === 0 || value.includes("#")) throw new Error(`[scheduling] invalid ${what} for a key`);
    return value;
}

export const schedulingKeys = {
    pk: (tenantId: string) => `TENANT#${part(tenantId, "tenantId")}`,
    resource: (resourceId: string) => `RESOURCE#${part(resourceId, "resourceId")}`,
    service: (serviceId: string) => `SERVICE#${part(serviceId, "serviceId")}`,
    availability: (resourceId: string) => `AVAILABILITY#${part(resourceId, "resourceId")}`,
    days: (resourceId: string) => `DAYS#${part(resourceId, "resourceId")}`,
    resDay: (resourceId: string, date: string) => `RESDAY#${part(resourceId, "resourceId")}#${date}`,
    booking: (bookingId: string) => `BOOKING#${part(bookingId, "bookingId")}`,
    token: (hash: string) => `TOKEN#${hash}`,
    /** The email is the `normalizeEmail()` form (stored `Person.email`); the booking id is the last segment. */
    cust: (email: string, bookingId: string) => `CUST#${email}#${part(bookingId, "bookingId")}`,
    held: (expiresAt: Instant, bookingId: string) => `HELD#${iso(expiresAt)}#${part(bookingId, "bookingId")}`,
    holds: (emailHash: string) => `HOLDS#${emailHash}`,
    intent: (intentId: string) => `INTENT#${part(intentId, "intentId")}`,
    limitEmail: (emailHash: string, hour: number) => `LIMIT#EMAIL#${emailHash}#${hour}`,
    limitAddr: (addressHash: string, hour: number) => `LIMIT#ADDR#${addressHash}#${hour}`,
    weekMail: (weekStart: LocalDate) => `WEEKMAIL#${weekStart}`,
} as const;

const K = schedulingKeys;
/** U+FFFF: sorts after every ASCII suffix (§ 6.3 range bounds). */
const TOP = "￿";

type Key = { PK: string; SK: string };
const key = (tenantId: string, sk: string): Key => ({ PK: K.pk(tenantId), SK: sk });

// ---------------------------------------------------------------------------------------------------------------
// Item codecs (§ 6.2). Every read goes through one of these; a failed parse throws StoredDataInvalidError.
// ---------------------------------------------------------------------------------------------------------------

const VersionSchema = z.number().int().min(1);
const ResDayItemSchema = z.object({ v: VersionSchema, entries: z.record(z.string(), ResDayEntrySchema) });
const HoldsItemSchema = z.object({ v: VersionSchema, entries: z.record(z.string(), z.object({ x: z.number().int() })) });
const DaysItemSchema = z.object({ v: VersionSchema, days: DayOverridesSchema });
const AvailabilityItemSchema = z.object({ rules: AvailabilityRulesSchema });
const IntentItemSchema = z.object({ fingerprint: z.string(), bookingId: z.string().min(1) });
const TokenItemSchema = z.object({ bookingId: z.string().min(1) });

export type ResDayEntry = z.infer<typeof ResDayEntrySchema>;

function decode<S extends z.ZodType>(schema: S, item: Record<string, unknown>, sk: string): z.output<S> {
    const parsed = schema.safeParse(item);
    if (!parsed.success) throw new StoredDataInvalidError(sk);
    return parsed.data;
}

/** The stored booking item (BOOKING# keys + the § 4.4 record). */
function bookingItem(tenantId: string, b: Booking): Record<string, unknown> {
    return { ...key(tenantId, K.booking(b.id)), ...b };
}

// ---------------------------------------------------------------------------------------------------------------
// Expression builder: every attribute name is aliased (reserved words such as `name`, `status`, `ttl`; booking
// ids as map keys), and only aliases that the expression uses are emitted (DynamoDB refuses unused ones).
// ---------------------------------------------------------------------------------------------------------------

class Expr {
    private readonly names: Record<string, string> = {};
    private readonly values: Record<string, unknown> = {};
    private n = 0;
    private m = 0;

    /** `path("entries", id, "x")` → `#n0.#n1.#n2`. */
    path(...segments: string[]): string {
        return segments.map((segment) => {
            const alias = `#n${this.n++}`;
            this.names[alias] = segment;
            return alias;
        }).join(".");
    }

    value(v: unknown): string {
        const alias = `:v${this.m++}`;
        this.values[alias] = v;
        return alias;
    }

    attrs(): { ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, unknown> } {
        return {
            ...(Object.keys(this.names).length > 0 ? { ExpressionAttributeNames: this.names } : {}),
            ...(Object.keys(this.values).length > 0 ? { ExpressionAttributeValues: this.values } : {}),
        };
    }
}

/** A projection naming exactly `attributes` (top level, or dotted paths such as `who.name`). */
function projection(attributes: string[]): { ProjectionExpression: string; ExpressionAttributeNames: Record<string, string> } {
    const e = new Expr();
    const expr = attributes.map((a) => e.path(...a.split("."))).join(", ");
    return { ProjectionExpression: expr, ExpressionAttributeNames: e.attrs().ExpressionAttributeNames ?? {} };
}

// ---------------------------------------------------------------------------------------------------------------
// Query rules (§ 6.4)
// ---------------------------------------------------------------------------------------------------------------

type KeyRange = { kind: "beginsWith"; prefix: string } | { kind: "between"; low: string; high: string };

/** Rule 1 and 3: loops on `LastEvaluatedKey` until it is absent; a projection is required by the type. */
async function queryAll(store: SchedulingStore, tenantId: string, range: KeyRange, attributes: string[],
    consistent: boolean): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
        const page = await store.db.send(new QueryCommand({ ...queryInput(store, tenantId, range, attributes, consistent), ExclusiveStartKey: start }));
        items.push(...(page.Items ?? []));
        start = page.LastEvaluatedKey;
    } while (start !== undefined);
    return items;
}

function queryInput(store: SchedulingStore, tenantId: string, range: KeyRange, attributes: string[],
    consistent: boolean): QueryCommandInput {
    const proj = projection(attributes);
    const values: Record<string, unknown> = { ":pk": K.pk(tenantId) };
    let condition: string;
    switch (range.kind) {
        case "beginsWith":
            values[":p"] = range.prefix;
            condition = "PK = :pk AND begins_with(SK, :p)";
            break;
        case "between":
            values[":lo"] = range.low;
            values[":hi"] = range.high;
            condition = "PK = :pk AND SK BETWEEN :lo AND :hi";
            break;
        default: return assertNever(range);
    }
    return {
        TableName: store.table,
        KeyConditionExpression: condition,
        ExpressionAttributeValues: values,
        ProjectionExpression: proj.ProjectionExpression,
        ExpressionAttributeNames: proj.ExpressionAttributeNames,
        ConsistentRead: consistent,
    };
}

/**
 * Rule 2: ≤ 100 keys per call; `UnprocessedKeys` are sent again with exponential backoff, at most 5 attempts per
 * chunk; still unprocessed → `busy` (never a partial list presented as complete). Missing items are absent from
 * the result (a removed booking is skipped by its readers, § 14.1).
 */
async function batchGetAll(store: SchedulingStore, keys: Key[], attributes: string[], consistent: boolean)
    : Promise<Result<Record<string, unknown>[], Busy>> {
    const out: Record<string, unknown>[] = [];
    const proj = projection(attributes);
    for (let i = 0; i < keys.length; i += 100) {
        let pending: Record<string, unknown>[] = keys.slice(i, i + 100);
        for (let attempt = 1; pending.length > 0; attempt++) {
            if (attempt > MAX_BATCH_ATTEMPTS) return err(BUSY);
            if (attempt > 1) await store.sleep(50 * 2 ** (attempt - 1));
            const res = await store.db.send(new BatchGetCommand({
                RequestItems: { [store.table]: { Keys: pending, ConsistentRead: consistent, ...proj } },
            }));
            out.push(...(res.Responses?.[store.table] ?? []));
            pending = res.UnprocessedKeys?.[store.table]?.Keys ?? [];
        }
    }
    return ok(out);
}

async function getItem(store: SchedulingStore, tenantId: string, sk: string, consistent: boolean)
    : Promise<Record<string, unknown> | undefined> {
    const res = await store.db.send(new GetCommand({ TableName: store.table, Key: key(tenantId, sk), ConsistentRead: consistent }));
    return res.Item;
}

// ---------------------------------------------------------------------------------------------------------------
// Transactions: tagged items and the versioned loop (§ 7.1)
// ---------------------------------------------------------------------------------------------------------------

type TxItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/**
 * What a failed condition on this item means: `retry` (a container or booking version: re-read and decide
 * again), `unexpected` (a put of a fresh random key: an invariant broke, throw), or a refusal value.
 */
type Tagged<R> = { item: TxItem; onConditionFailed: "retry" | "unexpected" | R };

type Attempt<T, R> = { kind: "final"; result: Result<T, R> } | { kind: "write"; items: Tagged<R>[]; value: T };

type TransactOutcome<R> = { kind: "committed" } | { kind: "retry" } | { kind: "refused"; refusal: R };

async function transact<R>(store: SchedulingStore, items: Tagged<R>[]): Promise<TransactOutcome<R>> {
    if (items.length === 0) return { kind: "committed" };
    if (items.length > TRANSACTION_ITEM_LIMIT) throw new Error(`[scheduling] transaction of ${items.length} items`);
    try {
        await store.db.send(new TransactWriteCommand({ TransactItems: items.map((t) => t.item) }));
        return { kind: "committed" };
    } catch (e) {
        if (!(e instanceof Error) || e.name !== "TransactionCanceledException") throw e;
        const reasons = (e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
        let retry = false;
        for (let i = 0; i < items.length; i++) {
            const code = reasons[i]?.Code;
            if (code === undefined || code === "None") continue;
            if (code === "TransactionConflict" || code === "ThrottlingError") {
                retry = true;
                continue;
            }
            if (code !== "ConditionalCheckFailed") throw e;
            const meaning = items[i].onConditionFailed;
            if (meaning === "retry") retry = true;
            else if (meaning === "unexpected") throw new Error(`[scheduling] unexpected condition failure on item ${i}`);
            else return { kind: "refused", refusal: meaning }; // a refusal wins: a re-read would refuse again
        }
        if (retry) return { kind: "retry" };
        throw e;
    }
}

/** § 7.1 point 4: read, decide, write; on a lost version re-read and decide again; at most 3 attempts, then busy. */
async function versioned<T, R>(store: SchedulingStore, plan: () => Promise<Attempt<T, R>>): Promise<Result<T, R | Busy>> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const step = await plan();
        if (step.kind === "final") return step.result;
        const outcome = await transact(store, step.items);
        switch (outcome.kind) {
            case "committed": return ok(step.value);
            case "refused": return err(outcome.refusal);
            case "retry":
                if (attempt < MAX_ATTEMPTS) await store.sleep(jitter(attempt));
                break;
            default: return assertNever(outcome);
        }
    }
    return err(BUSY);
}

const final = <T, R>(result: Result<T, R>): Attempt<T, R> => ({ kind: "final", result });

function put(store: SchedulingStore, item: Record<string, unknown>, mustBeNew: boolean): TxItem {
    return {
        Put: {
            TableName: store.table, Item: item,
            ...(mustBeNew ? { ConditionExpression: "attribute_not_exists(SK)" } : {}),
        },
    };
}

function del(store: SchedulingStore, tenantId: string, sk: string): TxItem {
    return { Delete: { TableName: store.table, Key: key(tenantId, sk) } };
}

/** § 4.2 resource guard: the resource exists and no removal attempt holds its fence. */
function resourceGuard(store: SchedulingStore, tenantId: string, resourceId: string): Tagged<{ kind: "resourceUnavailable" }> {
    return {
        item: {
            ConditionCheck: {
                TableName: store.table, Key: key(tenantId, K.resource(resourceId)),
                ConditionExpression: "attribute_exists(SK) AND attribute_not_exists(#r)",
                ExpressionAttributeNames: { "#r": "retiring" },
            },
        },
        onConditionFailed: { kind: "resourceUnavailable" },
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Containers (§ 6.2, § 7.1): RESDAY#, HOLDS#. A closed sum; one writer builds each kind's update.
// ---------------------------------------------------------------------------------------------------------------

/** A container read: `v` absent = the item does not exist (the write then conditions on `attribute_not_exists`). */
type ResDaySnapshot = { resourceId: string; date: string; v?: number; entries: Record<string, ResDayEntry> };
type HoldsSnapshot = { emailHash: string; v?: number; entries: Record<string, { x: Instant }> };

type ContainerWrite =
    | { kind: "resDay"; snap: ResDaySnapshot; entries: Record<string, ResDayEntry>; entryX?: { bookingId: string; x: Instant } }
    | { kind: "holds"; snap: HoldsSnapshot; entries: Record<string, { x: Instant }>; now: Instant };

/**
 * The whole map is rewritten under the version read (a writer's snapshot plus its change, minus what it counted
 * as expired). `entryX`: confirm's extra condition that the entry still carries the hold's `x` (§ 7.3, § 7.4).
 */
function containerUpdate(store: SchedulingStore, tenantId: string, w: ContainerWrite): Tagged<never> {
    const e = new Expr();
    const conditions: string[] = [];
    const sets: string[] = [];
    let sk: string;
    let version: number | undefined;
    switch (w.kind) {
        case "resDay":
            sk = K.resDay(w.snap.resourceId, w.snap.date);
            version = w.snap.v;
            sets.push(`${e.path("entries")} = ${e.value(w.entries)}`);
            if (w.entryX) conditions.push(`${e.path("entries", w.entryX.bookingId, "x")} = ${e.value(w.entryX.x)}`);
            break;
        case "holds": {
            sk = K.holds(w.snap.emailHash);
            version = w.snap.v;
            sets.push(`${e.path("entries")} = ${e.value(w.entries)}`);
            // § 6.2: ttl = latest x + 1 day; with no entry left, now + 1 day (nothing in it can still count).
            const latest = Math.max(w.now, ...Object.values(w.entries).map((entry) => entry.x));
            sets.push(`${e.path("ttl")} = ${e.value(ttlSeconds(latest + DAY_MS))}`);
            break;
        }
        default: return assertNever(w);
    }
    if (version === undefined) {
        conditions.unshift("attribute_not_exists(SK)");
        sets.push(`${e.path("v")} = ${e.value(1)}`);
    } else {
        const vPath = e.path("v");
        conditions.unshift(`${vPath} = ${e.value(version)}`);
        sets.push(`${e.path("v")} = ${e.value(version + 1)}`);
    }
    return {
        item: {
            Update: {
                TableName: store.table, Key: key(tenantId, sk),
                UpdateExpression: `SET ${sets.join(", ")}`,
                ConditionExpression: conditions.join(" AND "),
                ...e.attrs(),
            },
        },
        onConditionFailed: "retry",
    };
}

/** § 7.1 point 3: a writer drops every entry its own clock counts as expired. */
function withoutExpired<E extends { x?: Instant }>(entries: Record<string, E>, now: Instant): Record<string, E> {
    return Object.fromEntries(Object.entries(entries).filter(([, entry]) => entry.x === undefined || now < entry.x));
}

async function readResDay(store: SchedulingStore, tenantId: string, resourceId: string, date: string): Promise<ResDaySnapshot> {
    const sk = K.resDay(resourceId, date);
    const item = await getItem(store, tenantId, sk, true);
    if (item === undefined) return { resourceId, date, entries: {} };
    const parsed = decode(ResDayItemSchema, item, sk);
    return { resourceId, date, v: parsed.v, entries: parsed.entries };
}

async function readHolds(store: SchedulingStore, tenantId: string, emailHash: string): Promise<HoldsSnapshot> {
    const sk = K.holds(emailHash);
    const item = await getItem(store, tenantId, sk, true);
    if (item === undefined) return { emailHash, entries: {} };
    const parsed = decode(HoldsItemSchema, item, sk);
    return { emailHash, v: parsed.v, entries: parsed.entries };
}

/** Entries of several day containers as kernel entries, one per booking (copies of one transaction are equal). */
function entriesOf(days: ResDaySnapshot[]): ContainerEntry[] {
    const seen = new Map<string, ContainerEntry>();
    for (const day of days) {
        for (const [bookingId, entry] of Object.entries(day.entries)) {
            if (!seen.has(bookingId)) seen.set(bookingId, { bookingId, ...entry });
        }
    }
    return [...seen.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// Booking helpers
// ---------------------------------------------------------------------------------------------------------------

/** § 8.1: 32 random bytes, base64url without padding (43 characters); only its hash is stored. */
function newToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: sha256hex(token) };
}

function newBookingId(): { id: string; ref: string } {
    const id = randomUUID();
    return { id, ref: `B-${id.slice(0, 8).toUpperCase()}` };
}

export function emailHash(email: string): string {
    return sha256hex(normalizeEmail(email));
}

function placementOf(what: BookingWhat): Placement {
    switch (what.kind) {
        case "slot": return { kind: "slot", resourceId: what.resourceId, start: what.start, end: what.end };
        default: return assertNever(what.kind);
    }
}

/**
 * § 7.1 booking rule: one update conditioned on `attribute_exists(SK) AND rev = :rev` (plus the state the
 * operation requires) that writes EXACTLY `change.sets`: the attributes the change names, `rev + 1`,
 * `updatedAt`, and `history` only when the change adds an entry. An attribute the operation only read is never
 * written back (review SCHED1C-R1): `state.mail` (§ 7.2) and `reminderSentFor` (§ 11.3) change without a `rev`
 * bump, so writing a read copy of them would undo a write that committed between this read and this update.
 */
function bookingUpdate(store: SchedulingStore, tenantId: string, read: Booking, change: BookingChange,
    opts: { requireState?: Booking["state"]["kind"]; forbidState?: Booking["state"]["kind"]; remove?: ("heldUntil")[] }): Tagged<never> {
    const e = new Expr();
    const sets: string[] = [];
    for (const [name, value] of Object.entries(change.sets)) sets.push(`${e.path(name)} = ${e.value(value)}`);
    const conditions = ["attribute_exists(SK)", `${e.path("rev")} = ${e.value(read.rev)}`];
    if (opts.requireState) conditions.push(`${e.path("state", "kind")} = ${e.value(opts.requireState)}`);
    if (opts.forbidState) conditions.push(`${e.path("state", "kind")} <> ${e.value(opts.forbidState)}`);
    const removes = (opts.remove ?? []).map((name) => e.path(name));
    return {
        item: {
            Update: {
                TableName: store.table, Key: key(tenantId, K.booking(read.id)),
                UpdateExpression: `SET ${sets.join(", ")}${removes.length > 0 ? ` REMOVE ${removes.join(", ")}` : ""}`,
                ConditionExpression: conditions.join(" AND "),
                ...e.attrs(),
            },
        },
        onConditionFailed: "retry",
    };
}

/** A booking change: `next` = the booking after the write; `sets` = exactly the attributes the write sets. */
type BookingChange = { next: Booking; sets: Partial<Booking> };

function changed(read: Booking, now: Instant, change: Partial<Pick<Booking, "what" | "state" | "tokenHashes">>,
    entry?: HistoryEntry): BookingChange {
    const sets: Partial<Booking> = {
        ...change, rev: read.rev + 1, updatedAt: now,
        ...(entry ? { history: appendHistory(read.history, entry) } : {}),
    };
    return { next: { ...read, ...sets }, sets };
}

/** The `TOKEN#` deletes for a list of hashes (no condition: a missing token item is already gone). */
function tokenDeletes(store: SchedulingStore, tenantId: string, hashes: string[]): Tagged<never>[] {
    return hashes.map((hash) => ({ item: del(store, tenantId, K.token(hash)), onConditionFailed: "unexpected" as const }));
}

/** The items every booking creator writes (§ 6.1 item set): BOOKING#, its first TOKEN#, CUST#. */
function creationItems(store: SchedulingStore, tenantId: string, b: Booking, tokenHash: string, now: Instant): Tagged<never>[] {
    return [
        { item: put(store, bookingItem(tenantId, b), true), onConditionFailed: "unexpected" },
        { item: put(store, { ...key(tenantId, K.token(tokenHash)), bookingId: b.id, createdAt: now }, true), onConditionFailed: "unexpected" },
        { item: put(store, key(tenantId, K.cust(b.who.email, b.id)), true), onConditionFailed: "unexpected" },
    ];
}

/** § 9: `ADD count :1` under `attribute_not_exists(SK) OR count < :max`, in the same transaction. */
function limitCounter<R>(store: SchedulingStore, tenantId: string, sk: string, max: number, now: Instant, refusal: R): Tagged<R> {
    return {
        item: {
            Update: {
                TableName: store.table, Key: key(tenantId, sk),
                UpdateExpression: "SET #t = :t ADD #c :one",
                ConditionExpression: "attribute_not_exists(SK) OR #c < :max",
                ExpressionAttributeNames: { "#t": "ttl", "#c": "count" },
                ExpressionAttributeValues: { ":t": limitTtl(now), ":one": 1, ":max": max },
            },
        },
        onConditionFailed: refusal,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Reads (§ 6.3)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The attributes that locate a booking's item set (§ 6.1) and its state. Common to every stored `BOOKING#`, whatever
 * its `what`; the removals of customer data (§ 14) need nothing else.
 */
const BookingItemSetSchema = BookingSchema.pick({ id: true, rev: true, state: true, who: true, tokenHashes: true, intentId: true, heldUntil: true });
type BookingItemSet = z.infer<typeof BookingItemSetSchema>;

/** The two `what.kind` values of the removed group shape (SCHED-GROUPS-REMOVE-1) that a stored `BOOKING#` can carry. */
const REMOVED_GROUP_KINDS: readonly unknown[] = ["seat", "unplaced"];

/**
 * One stored `BOOKING#`, by its `what.kind` checked BEFORE parsing: `"seat"` or `"unplaced"` (the removed group shape)
 * → only its item set; anything else → the whole `Booking`. So a broken item (no `what`, an unknown kind, a slot that
 * fails its schema) still throws `StoredDataInvalidError` (§ 10.2: never read as absent), as does a group item whose
 * item set fails its schema.
 */
type StoredBooking = { kind: "slot"; booking: Booking } | { kind: "removedGroupShape"; itemSet: BookingItemSet };

async function readStoredBooking(store: SchedulingStore, tenantId: string, bookingId: string, consistent: boolean)
    : Promise<StoredBooking | undefined> {
    const sk = K.booking(bookingId);
    const item = await getItem(store, tenantId, sk, consistent);
    if (item === undefined) return undefined;
    const what = item.what as { kind?: unknown } | undefined;
    return REMOVED_GROUP_KINDS.includes(what?.kind)
        ? { kind: "removedGroupShape", itemSet: decode(BookingItemSetSchema, item, sk) }
        : { kind: "slot", booking: decode(BookingSchema, item, sk) };
}

/**
 * AP1. `consistent` for reads a write decides on (§ 6.4 rule 4). A stored booking of the removed group shape reads as
 * absent: every route then answers as for an unknown booking (404).
 */
export async function getBooking(store: SchedulingStore, tenantId: string, bookingId: string, consistent: boolean)
    : Promise<Booking | undefined> {
    const stored = await readStoredBooking(store, tenantId, bookingId, consistent);
    if (stored === undefined) return undefined;
    switch (stored.kind) {
        case "slot": return stored.booking;
        case "removedGroupShape": return undefined;
        default: return assertNever(stored);
    }
}

/**
 * AP2: tenant + hash → `TOKEN#` → `BOOKING#`. A token of another tenant, a deleted token, or a token whose
 * booking was removed all give `undefined` (one answer, 404 `linkNotValid`, § 8.4). The token is never logged.
 */
export async function getBookingByToken(store: SchedulingStore, tenantId: string, token: string, consistent: boolean)
    : Promise<Booking | undefined> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined; // malformed → same answer as unknown
    const hash = sha256hex(token);
    const sk = K.token(hash);
    const item = await getItem(store, tenantId, sk, consistent);
    if (item === undefined) return undefined;
    const tokenItem = decode(TokenItemSchema, item, sk);
    const booking = await getBooking(store, tenantId, tokenItem.bookingId, consistent);
    // A listed token only: a hash that left the list opens nothing even if its item outlived a crash.
    return booking !== undefined && booking.tokenHashes.includes(hash) ? booking : undefined;
}

/**
 * AP3 + § 5.5 `activeEntries`: the one list function behind the four display consumers (planner week,
 * all-resource appointments, day-edit answer, weekly mail). One `Query` per resource and span (pages looped), no
 * other read, no `busy`, no corruption report about copies (row C35 (3)); a stored entry that fails its schema
 * still throws `storedDataInvalid` (C35 (4)). Not for writers: they decide on their own consistent Get.
 */
export async function readIntervals(store: SchedulingStore, tenantId: string, resourceId: string,
    span: { start: Instant; end: Instant }, now: Instant): Promise<ContainerEntry[]> {
    const dates = utcDatesOf(span.start, span.end);
    const items = await queryAll(store, tenantId, {
        kind: "between", low: K.resDay(resourceId, dates[0]), high: K.resDay(resourceId, dates[dates.length - 1]),
    }, ["SK", "entries"], false);
    const raw: ContainerEntry[] = [];
    for (const item of items) {
        const sk = String(item.SK);
        const parsed = decode(ResDayItemSchema.pick({ entries: true }), item, sk);
        for (const [bookingId, entry] of Object.entries(parsed.entries)) raw.push({ bookingId, ...entry });
    }
    return activeEntries(raw, span, now);
}

/** The projections of § 6.3 for bookings read in a list (BatchGet). Exhaustive by consumer kind. */
export type BookingProjection = "display" | "feed";
const BookingDisplaySchema = BookingSchema.pick({ id: true, ref: true, what: true, state: true })
    .extend({ who: z.object({ name: z.string() }) });
const BookingFeedSchema = BookingSchema.pick({ id: true, ref: true, what: true, state: true });
export type BookingDisplayView = z.infer<typeof BookingDisplaySchema>;
export type BookingFeedView = z.infer<typeof BookingFeedSchema>;

/**
 * Planner / appointments / feed: BatchGet `BOOKING#` with the consumer's projection; ids not returned are skipped.
 * The ids come from `RESDAY#` entries, which only slot bookings have, so every item read here is a slot booking.
 */
export async function getBookingViews(store: SchedulingStore, tenantId: string, ids: string[], view: "display")
    : Promise<Result<BookingDisplayView[], Busy>>;
export async function getBookingViews(store: SchedulingStore, tenantId: string, ids: string[], view: "feed")
    : Promise<Result<BookingFeedView[], Busy>>;
export async function getBookingViews(store: SchedulingStore, tenantId: string, ids: string[], view: BookingProjection)
    : Promise<Result<(BookingDisplayView | BookingFeedView)[], Busy>> {
    let attributes: string[];
    let schema: z.ZodType<BookingDisplayView | BookingFeedView>;
    switch (view) {
        case "display": attributes = ["SK", "id", "ref", "what", "state", "who.name"]; schema = BookingDisplaySchema; break;
        case "feed": attributes = ["SK", "id", "ref", "what", "state"]; schema = BookingFeedSchema; break;
        default: return assertNever(view);
    }
    const unique = [...new Set(ids)];
    const res = await batchGetAll(store, unique.map((id) => key(tenantId, K.booking(id))), attributes, false);
    if (!res.ok) return res;
    return ok(res.value.map((item) => decode(schema, item, String(item.SK))));
}

/** AP9: ids of every booking of one person (`CUST#<email>#`), all pages. */
export async function bookingIdsOfEmail(store: SchedulingStore, tenantId: string, email: string, consistent: boolean): Promise<string[]> {
    const prefix = `CUST#${normalizeEmail(email)}#`;
    const items = await queryAll(store, tenantId, { kind: "beginsWith", prefix }, ["SK"], consistent);
    return items.map((item) => String(item.SK).slice(prefix.length));
}

/** AP10: resources (display projection; `retiring` never leaves this module except as `hasFeed`-free data). */
export async function listResources(store: SchedulingStore, tenantId: string, consistent: boolean)
    : Promise<{ id: string; name: string; hasFeed: boolean }[]> {
    const items = await queryAll(store, tenantId, { kind: "beginsWith", prefix: "RESOURCE#" }, ["SK", "name", "feedSecretHash"], consistent);
    return items.map((item) => {
        const sk = String(item.SK);
        const parsed = decode(z.object({ name: z.string(), feedSecretHash: z.string().optional() }), item, sk);
        return { id: sk.slice("RESOURCE#".length), name: parsed.name, hasFeed: parsed.feedSecretHash !== undefined };
    });
}

/** AP10: one resource, whole item (the resource guard and `slotDecision` read `retiring`). */
export async function getResource(store: SchedulingStore, tenantId: string, resourceId: string, consistent: boolean)
    : Promise<Resource | undefined> {
    const sk = K.resource(resourceId);
    const item = await getItem(store, tenantId, sk, consistent);
    return item === undefined ? undefined : decode(ResourceSchema, item, sk);
}

/** AP10 `SERVICE#` list. `consistent` as `listResources`: `true` for a read that decides a write (the create bound). */
export async function listServices(store: SchedulingStore, tenantId: string, consistent: boolean): Promise<Service[]> {
    const items = await queryAll(store, tenantId, { kind: "beginsWith", prefix: "SERVICE#" }, ["SK", "id", "name", "durationMin", "eligibility"], consistent);
    return items.map((item) => decode(ServiceSchema, item, String(item.SK)));
}

export async function getService(store: SchedulingStore, tenantId: string, serviceId: string, consistent: boolean)
    : Promise<Service | undefined> {
    const sk = K.service(serviceId);
    const item = await getItem(store, tenantId, sk, consistent);
    return item === undefined ? undefined : decode(ServiceSchema, item, sk);
}

/** AP10 `AVAILABILITY#<r>`: absent item = no weekly hours. */
export async function getAvailability(store: SchedulingStore, tenantId: string, resourceId: string, consistent: boolean)
    : Promise<AvailabilityRule[]> {
    const sk = K.availability(resourceId);
    const item = await getItem(store, tenantId, sk, consistent);
    return item === undefined ? [] : decode(AvailabilityItemSchema, item, sk).rules;
}

/**
 * AP10 `DAYS#<r>`: absent item = no override (every date follows the defaults). A stored item that fails its
 * schema throws `storedDataInvalid` — never "no override", which would open a day the admin closed (§ 23.7).
 */
export async function getDays(store: SchedulingStore, tenantId: string, resourceId: string, consistent: boolean): Promise<DayOverrides> {
    return (await readDaysItem(store, tenantId, resourceId, consistent)).days;
}

async function readDaysItem(store: SchedulingStore, tenantId: string, resourceId: string, consistent: boolean)
    : Promise<{ v?: number; days: DayOverrides }> {
    const sk = K.days(resourceId);
    const item = await getItem(store, tenantId, sk, consistent);
    if (item === undefined) return { days: {} };
    const parsed = decode(DaysItemSchema, item, sk);
    return { v: parsed.v, days: parsed.days };
}

/** AP10 for several resources: one BatchGet of `AVAILABILITY#<r>` + `DAYS#<r>` per resource (§ 6.4 rule 2). */
export async function getResourcePlans(store: SchedulingStore, tenantId: string, resourceIds: string[])
    : Promise<Result<Record<string, { rules: AvailabilityRule[]; days: DayOverrides }>, Busy>> {
    const keys = resourceIds.flatMap((r) => [key(tenantId, K.availability(r)), key(tenantId, K.days(r))]);
    const res = await batchGetAll(store, keys, ["SK", "rules", "v", "days"], false);
    if (!res.ok) return res;
    const out: Record<string, { rules: AvailabilityRule[]; days: DayOverrides }> =
        Object.fromEntries(resourceIds.map((r) => [r, { rules: [], days: {} }]));
    for (const item of res.value) {
        const sk = String(item.SK);
        if (sk.startsWith("AVAILABILITY#")) out[sk.slice("AVAILABILITY#".length)].rules = decode(AvailabilityItemSchema, item, sk).rules;
        else out[sk.slice("DAYS#".length)].days = decode(DaysItemSchema, item, sk).days;
    }
    return ok(out);
}

/** AP13: `HELD#` items of holds that expired more than 7 days before `now` (§ 14.1). */
async function expiredHeldKeys(store: SchedulingStore, tenantId: string, now: Instant): Promise<{ sk: string; bookingId: string }[]> {
    const items = await queryAll(store, tenantId, { kind: "between", low: "HELD#", high: `HELD#${iso(now - CLEANUP_AGE_MS)}#${TOP}` }, ["SK"], true);
    return items.map((item) => {
        const sk = String(item.SK);
        return { sk, bookingId: sk.slice(sk.lastIndexOf("#") + 1) };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration writes (admin; no customer data; not in any container's version chain, § 7.7)
// ---------------------------------------------------------------------------------------------------------------

export async function createResource(store: SchedulingStore, tenantId: string, name: string): Promise<Resource> {
    const resource = decodeInput(ResourceSchema, { id: randomUUID(), name });
    await store.db.send(new PutCommand({
        TableName: store.table, Item: { ...key(tenantId, K.resource(resource.id)), ...resource },
        ConditionExpression: "attribute_not_exists(SK)",
    }));
    return resource;
}

/** Rename; a missing resource → `notFound`. */
export async function renameResource(store: SchedulingStore, tenantId: string, resourceId: string, name: string)
    : Promise<Result<void, NotFound>> {
    return singleUpdate(store, tenantId, K.resource(resourceId), "SET #n = :n", { "#n": "name" }, { ":n": name });
}

/** § 12: a new secret hash replaces the old one (the old URL stops at once). */
export async function setFeedSecretHash(store: SchedulingStore, tenantId: string, resourceId: string, hash: string)
    : Promise<Result<void, NotFound>> {
    return singleUpdate(store, tenantId, K.resource(resourceId), "SET #h = :h", { "#h": "feedSecretHash" }, { ":h": hash });
}

async function singleUpdate(store: SchedulingStore, tenantId: string, sk: string, update: string,
    names: Record<string, string>, values: Record<string, unknown>): Promise<Result<void, NotFound>> {
    try {
        await store.db.send(new UpdateCommand({
            TableName: store.table, Key: key(tenantId, sk), UpdateExpression: update,
            ConditionExpression: "attribute_exists(SK)", ExpressionAttributeNames: names, ExpressionAttributeValues: values,
        }));
        return ok(undefined);
    } catch (e) {
        if (e instanceof Error && e.name === "ConditionalCheckFailedException") return err(NOT_FOUND);
        throw e;
    }
}

/** A caller precondition: the value must pass its schema (the route validated it); throws otherwise. */
function decodeInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new Error(`[scheduling] invalid input: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    return parsed.data;
}

/** Create or replace a service (§ 13: bookings keep their stored start, end and `serviceName`). */
export async function putService(store: SchedulingStore, tenantId: string, service: Service): Promise<Service> {
    const s = decodeInput(ServiceSchema, service);
    await store.db.send(new PutCommand({ TableName: store.table, Item: { ...key(tenantId, K.service(s.id)), ...s } }));
    return s;
}

/**
 * Replace an EXISTING service (the update route): one Put under `attribute_exists(SK)`, so a delete that committed
 * after the caller's read is never undone — the Put fails and the answer is `notFound` (review S1E1-R03). § 13: only
 * the service item is written; bookings keep their stored times and `serviceName`. `putService` stays for create.
 */
export async function replaceService(store: SchedulingStore, tenantId: string, service: Service): Promise<Result<Service, NotFound>> {
    const s = decodeInput(ServiceSchema, service);
    try {
        await store.db.send(new PutCommand({
            TableName: store.table, Item: { ...key(tenantId, K.service(s.id)), ...s }, ConditionExpression: "attribute_exists(SK)",
        }));
        return ok(s);
    } catch (e) {
        if (e instanceof Error && e.name === "ConditionalCheckFailedException") return err(NOT_FOUND);
        throw e;
    }
}

export async function deleteService(store: SchedulingStore, tenantId: string, serviceId: string): Promise<void> {
    await store.db.send(new DeleteCommand({ TableName: store.table, Key: key(tenantId, K.service(serviceId)) }));
}

/** The defaults of one resource: one Put replaces the list (§ 6.2). */
export async function putAvailability(store: SchedulingStore, tenantId: string, resourceId: string, rules: AvailabilityRule[])
    : Promise<AvailabilityRule[]> {
    const parsed = decodeInput(AvailabilityRulesSchema, rules);
    await store.db.send(new PutCommand({ TableName: store.table, Item: { ...key(tenantId, K.availability(resourceId)), rules: parsed } }));
    return parsed;
}

// ---------------------------------------------------------------------------------------------------------------
// Idempotency (§ 7.2)
// ---------------------------------------------------------------------------------------------------------------

/** The `what` of a hold request (§ 10.2 `HoldRequest.what`). */
export type HoldWhatInput = { kind: "slot"; serviceId: string; start: string };

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

/** § 7.2: every submitted field except `intentId`, `recaptchaToken` and `resend`; the email normalized. */
export function intentFingerprint(what: HoldWhatInput, who: { email: string; name: string; phone?: string; language?: string }): string {
    return sha256hex(canonicalJson({
        what,
        who: { email: normalizeEmail(who.email), name: who.name, phone: who.phone ?? null, language: who.language ?? null },
    }));
}

/**
 * § 7.2 replay table, decided on the stored intent and its booking:
 * - `new`: no intent stored → reCAPTCHA, limits, hold;
 * - `intentReused` (409): another fingerprint, whatever the state;
 * - `intentClosed` (409): held and expired, cancelled, or the booking is gone;
 * - `confirmed` (200, no side effect);
 * - `held` with `send`: `recover` (mail pending or failed: 201, new token, mail), `resend` (sent, `resend` true:
 *   200, new token, mail), `none` (sent, no resend: 200).
 * Recovery and resend mint through `mintToken(..., { countForEmail: true })`.
 */
export type IntentReplay =
    | { kind: "new" }
    | { kind: "intentReused" }
    | { kind: "intentClosed" }
    | { kind: "confirmed"; booking: Booking }
    | { kind: "held"; booking: Booking; send: "recover" | "resend" | "none" };

export async function replayIntent(store: SchedulingStore, tenantId: string, intentId: string, fingerprint: string,
    resend: boolean, now: Instant): Promise<IntentReplay> {
    const sk = K.intent(intentId);
    const item = await getItem(store, tenantId, sk, true);
    if (item === undefined) return { kind: "new" };
    const intent = decode(IntentItemSchema, item, sk);
    if (intent.fingerprint !== fingerprint) return { kind: "intentReused" };
    const booking = await getBooking(store, tenantId, intent.bookingId, true);
    if (booking === undefined) return { kind: "intentClosed" };
    const state = booking.state;
    switch (state.kind) {
        case "cancelled": return { kind: "intentClosed" };
        case "confirmed": return { kind: "confirmed", booking };
        case "held":
            if (now >= state.expiresAt) return { kind: "intentClosed" };
            switch (state.mail) {
                case "pending":
                case "failed": return { kind: "held", booking, send: "recover" };
                case "sent": return { kind: "held", booking, send: resend ? "resend" : "none" };
                default: return assertNever(state.mail);
            }
        default: return assertNever(state);
    }
}

/**
 * § 7.2 step 4: after the hold mail, `state.mail = sent | failed`, conditioned on `state.kind = held AND rev =
 * :rev`. Not a change of the booking's state kind: no `rev` bump, no history (§ 4.4). `false` = the booking
 * changed since (confirmed, cancelled, or a new token): nothing written.
 */
export async function markHoldMail(store: SchedulingStore, tenantId: string, bookingId: string, rev: number,
    mail: "sent" | "failed"): Promise<boolean> {
    try {
        await store.db.send(new UpdateCommand({
            TableName: store.table, Key: key(tenantId, K.booking(bookingId)),
            UpdateExpression: "SET #s.#m = :m",
            ConditionExpression: "attribute_exists(SK) AND #r = :r AND #s.#k = :held",
            ExpressionAttributeNames: { "#s": "state", "#m": "mail", "#r": "rev", "#k": "kind" },
            ExpressionAttributeValues: { ":m": mail, ":r": rev, ":held": "held" },
        }));
        return true;
    } catch (e) {
        if (e instanceof Error && e.name === "ConditionalCheckFailedException") return false;
        throw e;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Holds (§ 7.3, § 7.5, § 9) — the visitor's only write without a token
// ---------------------------------------------------------------------------------------------------------------

export type HoldSettings = { timezone: TimeZone; holdMinutes: number; bookingHorizonWeeks: number };

type HoldCommon = {
    tenantId: string; who: Person; intentId: string; fingerprint: string;
    /** `addressKey(ip)` of § 9.2, or absent (missing/invalid address → no address limit). */
    addressKey?: string;
    settings: HoldSettings; now: Instant;
};
export type SlotHoldInput = HoldCommon & { serviceId: string; start: Instant };

type LimitRefusal = { kind: "tooManyForEmail" } | { kind: "tooManyFromAddress" };
export type SlotHoldRefusal = SlotRefusal | { kind: "slotTaken" } | LimitRefusal | { kind: "intentExists" } | NotFound | Busy;
/** The new booking and its first link token (for the `hold` mail; never stored, logged or returned to a page). */
export type Created = { booking: Booking; token: string };

/** The items every visitor hold carries besides its container(s) (§ 7.3 table). */
function holdItems(store: SchedulingStore, input: HoldCommon, b: Booking, tokenHash: string, holds: HoldsSnapshot)
    : Tagged<LimitRefusal | { kind: "intentExists" }>[] {
    const { tenantId, now } = input;
    const x = b.heldUntil as Instant;
    const items: Tagged<LimitRefusal | { kind: "intentExists" }>[] = [
        containerUpdate(store, tenantId, { kind: "holds", snap: holds, now, entries: { ...withoutExpired(holds.entries, now), [b.id]: { x } } }),
        limitCounter(store, tenantId, K.limitEmail(holds.emailHash, hourNumber(now)), EMAIL_LIMIT_PER_HOUR, now, { kind: "tooManyForEmail" }),
    ];
    if (input.addressKey !== undefined) {
        items.push(limitCounter(store, tenantId, K.limitAddr(sha256hex(input.addressKey), hourNumber(now)), ADDRESS_LIMIT_PER_HOUR, now,
            { kind: "tooManyFromAddress" }));
    }
    items.push(...creationItems(store, tenantId, b, tokenHash, now));
    items.push({
        item: put(store, { ...key(tenantId, K.intent(input.intentId)), fingerprint: input.fingerprint, bookingId: b.id, ttl: ttlSeconds(now + DAY_MS) }, true),
        onConditionFailed: { kind: "intentExists" },
    });
    items.push({ item: put(store, key(tenantId, K.held(x, b.id)), true), onConditionFailed: "unexpected" });
    return items;
}

function newHeldBooking(input: HoldCommon, what: BookingWhat, tokenHash: string): Booking {
    const { id, ref } = newBookingId();
    const x = holdExpiry(input.now, input.settings.holdMinutes);
    return {
        id, ref, rev: 1, what,
        state: { kind: "held", expiresAt: x, mail: "pending" },
        source: { kind: "visitor" }, who: input.who, tokenHashes: [tokenHash], intentId: input.intentId, heldUntil: x,
        createdAt: input.now, updatedAt: input.now,
        history: [{ action: "created", at: input.now, state: "held", placement: placementOf(what) }],
    };
}

/** § 7.5: a visitor hold requires fewer than 2 active open holds for the email. */
function openHoldsFull(holds: HoldsSnapshot, now: Instant): boolean {
    return Object.keys(withoutExpired(holds.entries, now)).length >= MAX_OPEN_HOLDS;
}

/** Refusals of one candidate resource after which "any available" tries the next one (§ 7.3, base plan step 5). */
function triesNextResource(r: SlotHoldRefusal | MoveSlotRefusal): boolean {
    switch (r.kind) {
        case "notEligible": case "resourceUnavailable": case "notOnGrid": case "outsideAvailability": case "slotTaken":
            return true;
        default: return false;
    }
}

/**
 * Try `candidates` in code-unit order (§ 5.2 `pickResource`); the first success wins. When every candidate is
 * refused: `slotTaken` if one of them was taken, else the first candidate's refusal. A refusal that does not
 * depend on the resource (past, horizon, limits, intent, busy) ends the loop at once.
 */
async function overCandidates<T, R extends SlotHoldRefusal | MoveSlotRefusal>(candidates: string[],
    one: (resourceId: string) => Promise<Result<T, R>>): Promise<Result<T, R>> {
    const order = [...new Set(candidates)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (order.length === 0) throw new Error("[scheduling] no candidate resource");
    let first: R | undefined;
    let taken: R | undefined;
    for (const resourceId of order) {
        const result = await one(resourceId);
        if (result.ok || !triesNextResource(result.error)) return result;
        first ??= result.error;
        if (result.error.kind === "slotTaken") taken ??= result.error;
    }
    return err((taken ?? first) as R);
}

/** The resource ids a service may use (§ 4.2 eligibility), among the existing resources. */
async function eligibleResourceIds(store: SchedulingStore, tenantId: string, service: Service): Promise<string[]> {
    const eligibility = service.eligibility;
    switch (eligibility.kind) {
        case "all": return (await listResources(store, tenantId, true)).map((r) => r.id); // a write decides on it (§ 6.4 rule 4)
        case "only": return [...eligibility.resourceIds];
        default: return assertNever(eligibility);
    }
}

/**
 * § 7.3 visitor slot hold, "any available": `slotDecision` on a consistent read of the resource's config, then
 * the `RESDAY#` container(s) of the slot (`overlapCheck`), the open-hold cap, the limits, and the item set — one
 * transaction of ≤ 12 items (§ 7.3: ≤ 13).
 */
export async function holdSlot(store: SchedulingStore, input: SlotHoldInput): Promise<Result<Created, SlotHoldRefusal>> {
    const { tenantId, now, settings } = input;
    const service = await getService(store, tenantId, input.serviceId, true);
    if (service === undefined) return err(NOT_FOUND);
    const candidates = await eligibleResourceIds(store, tenantId, service);
    if (candidates.length === 0) return err({ kind: "notEligible" });
    const lastDate = lastBookableDate(now, settings.timezone, settings.bookingHorizonWeeks);
    return overCandidates<Created, SlotHoldRefusal>(candidates, (resourceId) => versioned<Created, SlotHoldRefusal>(store, async () => {
        const resource = await getResource(store, tenantId, resourceId, true);
        if (resource === undefined) return final(err({ kind: "notEligible" }));
        const rules = await getAvailability(store, tenantId, resourceId, true);
        const days = await getDays(store, tenantId, resourceId, true);
        const decision = slotDecision({ service, resource, rules, days, start: input.start, lastBookableDate: lastDate, tz: settings.timezone, now });
        if (!decision.ok) return final(decision);
        const end = decision.value.end;
        const dayList = await Promise.all(utcDatesOf(input.start, end).map((d) => readResDay(store, tenantId, resourceId, d)));
        if (!overlapCheck({ start: input.start, end }, entriesOf(dayList), now).ok) return final(err({ kind: "slotTaken" }));
        const holds = await readHolds(store, tenantId, emailHash(input.who.email));
        if (openHoldsFull(holds, now)) return final(err({ kind: "tooManyForEmail" }));

        const t = newToken();
        const b = newHeldBooking(input, {
            kind: "slot", serviceId: service.id, serviceName: service.name, resourceId, start: input.start, end,
        }, t.hash);
        const entry: ResDayEntry = { s: input.start, e: end, x: b.heldUntil, rev: b.rev };
        const items: Tagged<SlotHoldRefusal>[] = [
            ...dayList.map((day) => containerUpdate(store, tenantId, { kind: "resDay", snap: day, entries: { ...withoutExpired(day.entries, now), [b.id]: entry } })),
            resourceGuard(store, tenantId, resourceId),
            ...holdItems(store, input, b, t.hash, holds),
        ];
        return { kind: "write", items, value: { booking: b, token: t.token } };
    }));
}

// ---------------------------------------------------------------------------------------------------------------
// Confirm (§ 7.3): no recount; the container entry must still carry the hold's `x`
// ---------------------------------------------------------------------------------------------------------------

export type ConfirmFailure = ConfirmRefusal | NotFound | Busy;

/**
 * The outcome of a successful confirm (SCHED-1D2 ruling S1D2-CONFIRM-OUTCOME): `applied` = THIS call's transaction
 * committed the held → confirmed change (the caller owns the `confirmed` mail); `alreadyConfirmed` = the booking was
 * confirmed when this call read it (no write; another request confirmed it). Taken from the attempt that ends the
 * versioned loop, never inferred from timestamps.
 */
export type ConfirmOutcome = { kind: "applied"; booking: Booking } | { kind: "alreadyConfirmed"; booking: Booking };

/**
 * § 5.3 confirm by link: held and unexpired → confirmed (≤ 5 items) → `applied`; confirmed → no write →
 * `alreadyConfirmed`; expired, or the entry went to another writer after expiry (`entryLost`) → `expired`; cancelled →
 * `cancelled`. A lost version re-reads: a competing confirm that committed first makes this call `alreadyConfirmed`.
 */
export async function confirmBooking(store: SchedulingStore, tenantId: string, bookingId: string, now: Instant)
    : Promise<Result<ConfirmOutcome, ConfirmFailure>> {
    return versioned<ConfirmOutcome, ConfirmFailure>(store, async () => {
        const b = await getBooking(store, tenantId, bookingId, true);
        if (b === undefined) return final(err(NOT_FOUND));
        const decision = confirmDecision(b, now);
        if (!decision.ok) return final(decision);
        if (decision.value === "noop") return final(ok({ kind: "alreadyConfirmed", booking: b }));
        const state = b.state;
        if (state.kind !== "held" || b.heldUntil === undefined) throw new Error("[scheduling] held booking without heldUntil");
        const x = state.expiresAt;
        const entryLost = final<ConfirmOutcome, ConfirmFailure>(err({ kind: "expired", at: x }));
        const change = changed(b, now, { state: { kind: "confirmed", at: now } }, { action: "confirmed", at: now });
        const next: Booking = { ...change.next };
        delete next.heldUntil;

        const items: Tagged<never>[] = [];
        const what = b.what;
        switch (what.kind) {
            case "slot": {
                const dayList = await Promise.all(utcDatesOf(what.start, what.end).map((d) => readResDay(store, tenantId, what.resourceId, d)));
                if (dayList.some((day) => day.entries[b.id]?.x !== x)) return entryLost;
                for (const day of dayList) {
                    items.push(containerUpdate(store, tenantId, {
                        kind: "resDay", snap: day, entryX: { bookingId: b.id, x },
                        entries: { ...withoutExpired(day.entries, now), [b.id]: { s: what.start, e: what.end, rev: next.rev } },
                    }));
                }
                break;
            }
            default: return assertNever(what.kind);
        }
        const holds = await readHolds(store, tenantId, emailHash(b.who.email));
        const remaining = withoutExpired(holds.entries, now);
        delete remaining[b.id];
        items.push(
            bookingUpdate(store, tenantId, b, change, { requireState: "held", remove: ["heldUntil"] }),
            { item: del(store, tenantId, K.held(b.heldUntil, b.id)), onConditionFailed: "unexpected" },
            containerUpdate(store, tenantId, { kind: "holds", snap: holds, now, entries: remaining }),
        );
        return { kind: "write", items, value: { kind: "applied", booking: next } };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Cancel (§ 7.3): customer by link or admin; tokens deleted in the same transaction (§ 8.4)
// ---------------------------------------------------------------------------------------------------------------

export type ChangeFailure = ChangeRefusal | { kind: "stale" } | NotFound | Busy;

type CancelInput = {
    tenantId: string; bookingId: string; actor: Actor; cutoffHours: number; now: Instant;
    /** An admin route that received a `rev` answers `stale` when the booking moved on (§ 7.1). */
    expectedRev?: number;
};

/**
 * Cancel an active booking (≤ 25 items): its container entry, `BOOKING#` → cancelled with
 * `tokenHashes = []` and its history entry, every listed `TOKEN#`, the `HOLDS#` entry when held. `HELD#` and
 * `heldUntil` stay: the daily cleanup removes a held-then-cancelled item set (§ 14.1).
 */
export async function cancelBooking(store: SchedulingStore, input: CancelInput): Promise<Result<Booking, ChangeFailure>> {
    const { tenantId, now, actor } = input;
    return versioned<Booking, ChangeFailure>(store, async () => {
        const b = await getBooking(store, tenantId, input.bookingId, true);
        if (b === undefined) return final(err(NOT_FOUND));
        if (input.expectedRev !== undefined && input.expectedRev !== b.rev) return final(err({ kind: "stale" }));
        const what = b.what;
        const decision = changeDecision(b, now, input.cutoffHours, "cancel", actor.kind);
        if (!decision.ok) return final(decision);

        const change = changed(b, now, { state: { kind: "cancelled", at: now, by: actor }, tokenHashes: [] },
            { action: "cancelled", at: now, by: actor });
        const next = change.next;
        const items: Tagged<never>[] = [];
        switch (what.kind) {
            case "slot": {
                const dayList = await Promise.all(utcDatesOf(what.start, what.end).map((d) => readResDay(store, tenantId, what.resourceId, d)));
                for (const day of dayList.filter((d) => d.entries[b.id] !== undefined)) {
                    const entries = withoutExpired(day.entries, now);
                    delete entries[b.id];
                    items.push(containerUpdate(store, tenantId, { kind: "resDay", snap: day, entries }));
                }
                break;
            }
            default: return assertNever(what.kind);
        }
        items.push(bookingUpdate(store, tenantId, b, change, {}), ...tokenDeletes(store, tenantId, b.tokenHashes));
        if (b.state.kind === "held") {
            const holds = await readHolds(store, tenantId, emailHash(b.who.email));
            if (holds.entries[b.id] !== undefined) {
                const remaining = withoutExpired(holds.entries, now);
                delete remaining[b.id];
                items.push(containerUpdate(store, tenantId, { kind: "holds", snap: holds, now, entries: remaining }));
            }
        }
        return { kind: "write", items, value: next };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Slot move and manual appointment (§ 7.3)
// ---------------------------------------------------------------------------------------------------------------

export type MoveSlotRefusal = SlotRefusal | ChangeRefusal | { kind: "slotTaken" } | { kind: "stale" } | NotFound | Busy;

export type MoveSlotInput = {
    tenantId: string; bookingId: string; start: Instant;
    /** Target resources: the admin names one; a visitor move passes the service's eligible ones (any available). */
    resourceIds: string[];
    actor: Actor; settings: HoldSettings & { changeCutoffHours: number }; now: Instant; expectedRev?: number;
};

/**
 * Move a confirmed slot booking in place (§ 8.5: the id and every token stay), ≤ 6 items: old day container(s)
 * lose the entry, new day container(s) gain it with the new `rev` (one update per container when they share a
 * day), the resource guard on the target, `BOOKING#.what` with a `moved` history entry. A customer move passes
 * `slotDecision` with the current service (its duration). An admin move skips `slotDecision` and is bound by the
 * known service's current duration (§ 5.2), the resource guard and `overlapCheck`; when the service was deleted
 * it keeps the stored duration `end − start` (§ 13). `serviceName` stays the name at booking time (§ 4.4).
 */
export async function moveSlot(store: SchedulingStore, input: MoveSlotInput): Promise<Result<Booking, MoveSlotRefusal>> {
    const { tenantId, now, actor, settings } = input;
    return overCandidates<Booking, MoveSlotRefusal>(input.resourceIds, (resourceId) => versioned<Booking, MoveSlotRefusal>(store, async () => {
        const b = await getBooking(store, tenantId, input.bookingId, true);
        if (b === undefined) return final(err(NOT_FOUND));
        if (input.expectedRev !== undefined && input.expectedRev !== b.rev) return final(err({ kind: "stale" }));
        const what = b.what;
        const decision = changeDecision(b, now, settings.changeCutoffHours, "move", actor.kind);
        if (!decision.ok) return final(decision);
        const resource = await getResource(store, tenantId, resourceId, true);
        if (resource === undefined) return final(err({ kind: "resourceUnavailable" }));

        // § 5.2: a move is bound to the known service and its CURRENT duration; § 13: when the service was
        // deleted, an admin move keeps the stored duration (`end − start`) and a customer move has nothing to
        // offer (`notFound`, no slot grid without a service).
        const service = await getService(store, tenantId, what.serviceId, true);
        let end: Instant;
        switch (actor.kind) {
            case "customer": {
                if (service === undefined) return final(err(NOT_FOUND));
                const slot = slotDecision({
                    service, resource, rules: await getAvailability(store, tenantId, resourceId, true),
                    days: await getDays(store, tenantId, resourceId, true), start: input.start,
                    lastBookableDate: lastBookableDate(now, settings.timezone, settings.bookingHorizonWeeks), tz: settings.timezone, now,
                });
                if (!slot.ok) return final(slot);
                end = slot.value.end;
                break;
            }
            case "admin":
                if (resource.retiring !== undefined) return final(err({ kind: "resourceUnavailable" }));
                end = input.start + (service !== undefined ? service.durationMin * MINUTE_MS : what.end - what.start);
                break;
            default: return assertNever(actor);
        }
        const target: BookingWhat = { ...what, resourceId, start: input.start, end };
        const change = changed(b, now, { what: target },
            { action: "moved", at: now, by: actor, from: placementOf(what), to: placementOf(target) });
        const next = change.next;

        // Every container the move touches, read once; one update per container.
        const oldKeys = utcDatesOf(what.start, what.end).map((d) => ({ r: what.resourceId, d }));
        const newKeys = utcDatesOf(input.start, end).map((d) => ({ r: resourceId, d }));
        const all = new Map<string, { r: string; d: string }>();
        for (const k of [...oldKeys, ...newKeys]) all.set(`${k.r}#${k.d}`, k);
        const snaps = new Map<string, ResDaySnapshot>();
        for (const [id, k] of all) snaps.set(id, await readResDay(store, tenantId, k.r, k.d));
        const targetDays = newKeys.map((k) => snaps.get(`${k.r}#${k.d}`) as ResDaySnapshot);
        if (!overlapCheck({ start: input.start, end }, entriesOf(targetDays), now, b.id).ok) return final(err({ kind: "slotTaken" }));

        const newIds = new Set(newKeys.map((k) => `${k.r}#${k.d}`));
        const items: Tagged<MoveSlotRefusal>[] = [];
        for (const [id, snap] of snaps) {
            const entries = withoutExpired(snap.entries, now);
            delete entries[b.id];
            if (newIds.has(id)) entries[b.id] = { s: input.start, e: end, rev: next.rev };
            items.push(containerUpdate(store, tenantId, { kind: "resDay", snap, entries }));
        }
        items.push(resourceGuard(store, tenantId, resourceId), bookingUpdate(store, tenantId, b, change, { requireState: "confirmed" }));
        return { kind: "write", items, value: next };
    }));
}

type ManualCommon = { tenantId: string; who: Person; channel: string; adminEmail: string; now: Instant };
export type ManualAppointmentInput = ManualCommon & { serviceId: string; resourceId: string; start: Instant };
export type ManualAppointmentRefusal = { kind: "slotTaken" } | { kind: "resourceUnavailable" } | NotFound | Busy;

function newConfirmedBooking(input: ManualCommon, what: BookingWhat, tokenHash: string): Booking {
    const { id, ref } = newBookingId();
    return {
        id, ref, rev: 1, what,
        state: { kind: "confirmed", at: input.now },
        source: { kind: "manual", adminEmail: input.adminEmail, channel: input.channel },
        who: input.who, tokenHashes: [tokenHash], createdAt: input.now, updatedAt: input.now,
        history: [{ action: "created", at: input.now, state: "confirmed", placement: placementOf(what) }],
    };
}

/**
 * § 7.3 manual appointment (admin), ≤ 6 items: no `slotDecision` (windows, grid, day off and horizon do not bind
 * the admin, § 5.2); a known service (its duration), the resource guard, `overlapCheck`; confirmed, `manual`.
 */
export async function createManualAppointment(store: SchedulingStore, input: ManualAppointmentInput)
    : Promise<Result<Created, ManualAppointmentRefusal>> {
    const { tenantId, now } = input;
    return versioned<Created, ManualAppointmentRefusal>(store, async () => {
        const service = await getService(store, tenantId, input.serviceId, true);
        if (service === undefined) return final(err(NOT_FOUND));
        const resource = await getResource(store, tenantId, input.resourceId, true);
        if (resource === undefined) return final(err(NOT_FOUND));
        if (resource.retiring !== undefined) return final(err({ kind: "resourceUnavailable" }));
        const end = input.start + service.durationMin * MINUTE_MS;
        const dayList = await Promise.all(utcDatesOf(input.start, end).map((d) => readResDay(store, tenantId, input.resourceId, d)));
        if (!overlapCheck({ start: input.start, end }, entriesOf(dayList), now).ok) return final(err({ kind: "slotTaken" }));
        const t = newToken();
        const b = newConfirmedBooking(input, {
            kind: "slot", serviceId: service.id, serviceName: service.name, resourceId: input.resourceId, start: input.start, end,
        }, t.hash);
        const entry: ResDayEntry = { s: input.start, e: end, rev: b.rev };
        const items: Tagged<ManualAppointmentRefusal>[] = [
            ...dayList.map((day) => containerUpdate(store, tenantId, { kind: "resDay", snap: day, entries: { ...withoutExpired(day.entries, now), [b.id]: entry } })),
            resourceGuard(store, tenantId, input.resourceId),
            ...creationItems(store, tenantId, b, t.hash, now),
        ];
        return { kind: "write", items, value: { booking: b, token: t.token } };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Link tokens (§ 8.4): one new token per mail
// ---------------------------------------------------------------------------------------------------------------

/**
 * Mint a token for one mail (≤ 3 items, or 4 with the per-email counter): put `TOKEN#<new>`; `BOOKING#`
 * `tokenHashes` = read list + new (the oldest dropped and its `TOKEN#` deleted when 20 are listed), `rev + 1`,
 * under `attribute_exists(SK) AND rev = :rev AND state.kind <> cancelled`. A booking that is gone or cancelled →
 * `linkNotIssued` (no mail). `countForEmail`: a resend or replay recovery also counts in `LIMIT#EMAIL#` (§ 7.2).
 * Entries in containers are not touched (row C35 (2)).
 */
export async function mintToken(store: SchedulingStore, tenantId: string, bookingId: string, now: Instant,
    opts: { countForEmail: boolean }): Promise<Result<{ booking: Booking; token: string }, { kind: "linkNotIssued" } | { kind: "tooManyForEmail" } | Busy>> {
    type R = { kind: "linkNotIssued" } | { kind: "tooManyForEmail" } | Busy;
    return versioned<{ booking: Booking; token: string }, R>(store, async () => {
        const b = await getBooking(store, tenantId, bookingId, true);
        if (b === undefined || b.state.kind === "cancelled") {
            console.log("[scheduling] linkNotIssued", bookingId);
            return final(err({ kind: "linkNotIssued" }));
        }
        const t = newToken();
        const dropped = b.tokenHashes.length >= MAX_TOKENS ? b.tokenHashes.slice(0, b.tokenHashes.length - MAX_TOKENS + 1) : [];
        const change = changed(b, now, { tokenHashes: [...b.tokenHashes.slice(dropped.length), t.hash] });
        const next = change.next;
        const items: Tagged<R>[] = [
            { item: put(store, { ...key(tenantId, K.token(t.hash)), bookingId, createdAt: now }, true), onConditionFailed: "unexpected" },
            bookingUpdate(store, tenantId, b, change, { forbidState: "cancelled" }),
            ...tokenDeletes(store, tenantId, dropped),
        ];
        if (opts.countForEmail) {
            items.push(limitCounter(store, tenantId, K.limitEmail(emailHash(b.who.email), hourNumber(now)), EMAIL_LIMIT_PER_HOUR, now,
                { kind: "tooManyForEmail" } as R));
        }
        return { kind: "write", items, value: { booking: next, token: t.token } };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Reminder marker (§ 11.3): the one booking attribute outside the booking rule
// ---------------------------------------------------------------------------------------------------------------

export type ReminderTarget = { kind: "slot"; start: Instant };

/**
 * Mark `reminderSentFor = S` only while the booking still starts at `S` (`what.start`), is confirmed, and was not
 * reminded for `S`. `stale` = a move or a mark happened since the selection: no reminder for that start.
 */
export async function markReminder(store: SchedulingStore, tenantId: string, bookingId: string, target: ReminderTarget)
    : Promise<{ kind: "marked" } | { kind: "stale" }> {
    const e = new Expr();
    const S = target.start;
    const conditions = [`${e.path("state", "kind")} = ${e.value("confirmed")}`];
    switch (target.kind) {
        case "slot": conditions.unshift(`${e.path("what", "start")} = ${e.value(target.start)}`); break;
        default: return assertNever(target.kind);
    }
    const reminded = e.path("reminderSentFor");
    const s = e.value(S);
    conditions.push(`(attribute_not_exists(${reminded}) OR ${reminded} <> ${s})`);
    const update: TxItem = {
        Update: {
            TableName: store.table, Key: key(tenantId, K.booking(bookingId)),
            UpdateExpression: `SET ${e.path("reminderSentFor")} = ${s}`,
            ConditionExpression: conditions.join(" AND "), ...e.attrs(),
        },
    };
    const items: Tagged<{ kind: "stale" }>[] = [{ item: update, onConditionFailed: { kind: "stale" } }];
    const out = await transact(store, items);
    switch (out.kind) {
        case "committed": return { kind: "marked" };
        case "refused": return out.refusal;
        case "retry": return { kind: "stale" }; // a concurrent write on the booking: the next job run selects again
        default: return assertNever(out);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Resource removal (§ 13): fence owned by one attempt
// ---------------------------------------------------------------------------------------------------------------

export type RemoveResourceRefusal =
    | NotFound | { kind: "resourceRemovalInProgress" } | { kind: "resourceInUse"; activeBookings: number } | Busy;

/**
 * Three steps, one attempt id per call: (1) acquire the fence `retiring = { attemptId, at }` (a fence older than
 * 10 minutes is taken over); (2) consistent check of active future entries (AP3 from today's UTC date); (3a) in use
 * → release own fence,
 * `resourceInUse`; (3b) free → delete `RESOURCE#` (own fence only), `AVAILABILITY#`, `DAYS#`. A step 3 whose fence
 * was taken over → `resourceRemovalInProgress`, nothing changed.
 */
export async function removeResource(store: SchedulingStore, tenantId: string, resourceId: string, now: Instant)
    : Promise<Result<void, RemoveResourceRefusal>> {
    const attemptId = randomUUID();
    const resourceKey = key(tenantId, K.resource(resourceId));
    try {
        await store.db.send(new UpdateCommand({
            TableName: store.table, Key: resourceKey,
            UpdateExpression: "SET #r = :fence",
            ConditionExpression: "attribute_exists(SK) AND (attribute_not_exists(#r) OR #r.#at < :stale)",
            ExpressionAttributeNames: { "#r": "retiring", "#at": "at" },
            ExpressionAttributeValues: { ":fence": { attemptId, at: now }, ":stale": now - FENCE_TAKEOVER_MS },
        }));
    } catch (e) {
        if (!(e instanceof Error) || e.name !== "ConditionalCheckFailedException") throw e;
        return err((await getResource(store, tenantId, resourceId, true)) === undefined ? NOT_FOUND : { kind: "resourceRemovalInProgress" });
    }

    const dayItems = await queryAll(store, tenantId,
        { kind: "between", low: K.resDay(resourceId, utcDate(now)), high: `RESDAY#${resourceId}#${TOP}` }, ["SK", "entries"], true);
    const active = new Set<string>();
    for (const item of dayItems) {
        const parsed = decode(ResDayItemSchema.pick({ entries: true }), item, String(item.SK));
        for (const [bookingId, entry] of Object.entries(parsed.entries)) {
            if (entry.e > now && (entry.x === undefined || now < entry.x)) active.add(bookingId);
        }
    }
    if (active.size > 0) {
        if (!(await releaseFence(store, resourceKey, attemptId))) return err({ kind: "resourceRemovalInProgress" });
        return err({ kind: "resourceInUse", activeBookings: active.size });
    }
    const out = await transact<{ kind: "resourceRemovalInProgress" }>(store, [
        {
            item: {
                Delete: {
                    TableName: store.table, Key: resourceKey, ConditionExpression: "#r.#a = :a",
                    ExpressionAttributeNames: { "#r": "retiring", "#a": "attemptId" }, ExpressionAttributeValues: { ":a": attemptId },
                },
            },
            onConditionFailed: { kind: "resourceRemovalInProgress" },
        },
        { item: del(store, tenantId, K.availability(resourceId)), onConditionFailed: "unexpected" },
        { item: del(store, tenantId, K.days(resourceId)), onConditionFailed: "unexpected" },
    ]);
    switch (out.kind) {
        case "committed": return ok(undefined);
        case "refused": return err(out.refusal);
        case "retry": return err({ kind: "resourceRemovalInProgress" }); // nothing written; the admin tries again
        default: return assertNever(out);
    }
}

/** `REMOVE retiring` only while this attempt owns the fence; `false` = another attempt took it over. */
async function releaseFence(store: SchedulingStore, resourceKey: Key, attemptId: string): Promise<boolean> {
    try {
        await store.db.send(new UpdateCommand({
            TableName: store.table, Key: resourceKey, UpdateExpression: "REMOVE #r",
            ConditionExpression: "#r.#a = :a",
            ExpressionAttributeNames: { "#r": "retiring", "#a": "attemptId" }, ExpressionAttributeValues: { ":a": attemptId },
        }));
        return true;
    } catch (e) {
        if (e instanceof Error && e.name === "ConditionalCheckFailedException") return false;
        throw e;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Removal of customer data (§ 14)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The deletes of a booking's whole item set, every key read from the stored booking (never from settings). Takes the
 * item set only, so a stored booking of the removed group shape (`readStoredBooking`) is removed the same way.
 */
function itemSetDeletes(store: SchedulingStore, tenantId: string, b: BookingItemSet): Tagged<never>[] {
    const items: Tagged<never>[] = [
        {
            item: {
                Delete: {
                    TableName: store.table, Key: key(tenantId, K.booking(b.id)),
                    ConditionExpression: "attribute_exists(SK) AND #r = :r",
                    ExpressionAttributeNames: { "#r": "rev" }, ExpressionAttributeValues: { ":r": b.rev },
                },
            },
            onConditionFailed: "retry",
        },
        { item: del(store, tenantId, K.cust(b.who.email, b.id)), onConditionFailed: "unexpected" },
    ];
    if (b.heldUntil !== undefined) items.push({ item: del(store, tenantId, K.held(b.heldUntil, b.id)), onConditionFailed: "unexpected" });
    if (b.intentId !== undefined) items.push({ item: del(store, tenantId, K.intent(b.intentId)), onConditionFailed: "unexpected" });
    items.push(...tokenDeletes(store, tenantId, b.tokenHashes));
    return items;
}

/**
 * § 14.1 daily cleanup for one tenant (any `schedulingEnabled`): every `HELD#` older than 7 days → one
 * transaction (≤ 24 items) removes `BOOKING#` (booking rule), `CUST#`, `HELD#`, `INTENT#`, listed `TOKEN#`s.
 * Container entries are not touched (expired entries are free; the next writer drops them). A booking already
 * gone → skipped. Idempotent: a second run the same day finds nothing. A booking of the removed group shape is
 * removed by the same rule: its `HELD#` is only found while it was never confirmed.
 */
export async function cleanupExpiredHolds(store: SchedulingStore, tenantId: string, now: Instant)
    : Promise<{ removed: number; skipped: number; busy: number }> {
    const out = { removed: 0, skipped: 0, busy: 0 };
    for (const held of await expiredHeldKeys(store, tenantId, now)) {
        const result = await versioned<boolean, Busy>(store, async () => {
            const stored = await readStoredBooking(store, tenantId, held.bookingId, true);
            if (stored === undefined) return final(ok(false));
            let b: BookingItemSet;
            switch (stored.kind) {
                case "slot": b = stored.booking; break;
                case "removedGroupShape": b = stored.itemSet; break;
                default: return assertNever(stored);
            }
            // A HELD# exists only for a never-confirmed booking (§ 6.2); a confirmed one is never removed here.
            if (b.state.kind === "confirmed") {
                console.log("[scheduling] cleanup: HELD# of a confirmed booking left in place", held.bookingId);
                return final(ok(false));
            }
            return { kind: "write", items: itemSetDeletes(store, tenantId, b), value: true };
        });
        if (!result.ok) out.busy++;
        else if (result.value) out.removed++;
        else out.skipped++;
    }
    return out;
}

/**
 * § 14.2 erasure of one customer: AP9 (consistent, all pages: every `CUST#<email>#<bookingId>`, which every booking
 * creator writes); per booking one transaction (≤ 27 items) that releases its place by the cancel rule (the
 * `RESDAY#` entry, versioned, when present) and removes its whole item set; then the read-back. A booking of the
 * removed group shape has its item set removed; its `RUN#` seat entry or `UNPLACED#` pointer is left (a
 * random booking id, no person data; no code reads them). Idempotent; two passes at once both finish without error.
 */
export async function eraseCustomer(store: SchedulingStore, tenantId: string, email: string, now: Instant)
    : Promise<Result<{ removedBookings: number; remainingBookings: number }, Busy>> {
    let removed = 0;
    for (const bookingId of await bookingIdsOfEmail(store, tenantId, email, true)) {
        const result = await versioned<boolean, Busy>(store, async () => {
            const stored = await readStoredBooking(store, tenantId, bookingId, true);
            if (stored === undefined) return final(ok(false)); // removed by another pass
            const items: Tagged<never>[] = [];
            switch (stored.kind) {
                case "slot": {
                    const b = stored.booking;
                    const what = b.what;
                    const dayList = await Promise.all(utcDatesOf(what.start, what.end).map((d) => readResDay(store, tenantId, what.resourceId, d)));
                    for (const day of dayList.filter((d) => d.entries[b.id] !== undefined)) {
                        const entries = withoutExpired(day.entries, now);
                        delete entries[b.id];
                        items.push(containerUpdate(store, tenantId, { kind: "resDay", snap: day, entries }));
                    }
                    items.push(...itemSetDeletes(store, tenantId, b));
                    break;
                }
                case "removedGroupShape":
                    items.push(...itemSetDeletes(store, tenantId, stored.itemSet));
                    break;
                default: return assertNever(stored);
            }
            return { kind: "write", items, value: true };
        });
        if (!result.ok) return result;
        if (result.value) removed++;
    }
    const remaining = await bookingIdsOfEmail(store, tenantId, email, true);
    return ok({ removedBookings: removed, remainingBookings: remaining.length });
}

// ---------------------------------------------------------------------------------------------------------------
// Week planner storage (§ 23): DAYS# conditional write, WEEKMAIL# marker (AP14)
// ---------------------------------------------------------------------------------------------------------------

/**
 * § 10.3 day edits: read `DAYS#<r>` consistently, `editDays` on it, Put the whole map with `v + 1` under the
 * version read (`attribute_not_exists(SK)` when absent: the first write creates `v = 1`); on a lost condition
 * re-read, re-apply the same edit and write once more; a second loss → `busy`. `v` never leaves this module.
 */
export async function editResourceDays(store: SchedulingStore, tenantId: string, resourceId: string, edit: DaysEdit, today: LocalDate)
    : Promise<Result<{ changed: LocalDate[]; days: DayOverrides }, DaysEditError | Busy>> {
    const sk = K.days(resourceId);
    for (let attempt = 1; attempt <= 2; attempt++) {
        const current = await readDaysItem(store, tenantId, resourceId, true);
        const edited = editDays(current.days, edit, today);
        if (!edited.ok) return edited;
        try {
            await store.db.send(new PutCommand({
                TableName: store.table, Item: { ...key(tenantId, sk), v: (current.v ?? 0) + 1, days: edited.value.next },
                ...(current.v === undefined
                    ? { ConditionExpression: "attribute_not_exists(SK)" }
                    : { ConditionExpression: "#v = :v", ExpressionAttributeNames: { "#v": "v" }, ExpressionAttributeValues: { ":v": current.v } }),
            }));
            return ok({ changed: edited.value.changed, days: edited.value.next });
        } catch (e) {
            if (!(e instanceof Error) || e.name !== "ConditionalCheckFailedException") throw e;
        }
    }
    return err(BUSY);
}

/**
 * § 11.4 step 1 (AP14): claim the week's marker (`claimedAt` kept from the first attempt, `ttl` = `weekStart` +
 * 14 days). `alreadySent` = a numeric `sentAt` was returned (stop); a `sentAt` that is not a number is logged and
 * read as not sent (a duplicate mail is the harmless side, row C34).
 */
export async function claimWeekMail(store: SchedulingStore, tenantId: string, weekStart: LocalDate, now: Instant)
    : Promise<{ alreadySent: boolean }> {
    const res = await store.db.send(new UpdateCommand({
        TableName: store.table, Key: key(tenantId, K.weekMail(weekStart)),
        UpdateExpression: "SET #c = if_not_exists(#c, :now), #t = :ttl",
        ExpressionAttributeNames: { "#c": "claimedAt", "#t": "ttl" },
        ExpressionAttributeValues: { ":now": now, ":ttl": ttlSeconds(Date.parse(`${weekStart}T00:00:00.000Z`) + 14 * DAY_MS) },
        ReturnValues: "ALL_NEW",
    }));
    const sentAt = res.Attributes?.sentAt;
    if (sentAt === undefined) return { alreadySent: false };
    if (typeof sentAt !== "number") {
        console.log("[scheduling] weekly mail marker: sentAt is not a number", tenantId, weekStart);
        return { alreadySent: false };
    }
    return { alreadySent: true };
}

/** § 11.4 step 3: written only after SES accepted the mail. */
export async function markWeekMailSent(store: SchedulingStore, tenantId: string, weekStart: LocalDate, now: Instant): Promise<void> {
    await store.db.send(new UpdateCommand({
        TableName: store.table, Key: key(tenantId, K.weekMail(weekStart)),
        UpdateExpression: "SET #s = :now", ExpressionAttributeNames: { "#s": "sentAt" }, ExpressionAttributeValues: { ":now": now },
    }));
}
