import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * LANG-1B (docs/slices/lang-1.md § 9.4, § 11) — the deferred edge flush: the settings save that changes a tenant's language
 * SET arms `SYSTEM#CDN_DEFERRED_FLUSH` (`dueAt` = save time + 5 min, moved only later), and the debounce function drains it
 * with one distribution-wide `/*` and a snapshot-conditioned delete. Both REAL handlers run against ONE in-memory marker
 * table (`send` below) that evaluates exactly the update and condition expressions they send — an expression it does not
 * know fails loudly. Mocked boundaries: `lib/db.js` (the settings handler's client), the DocumentClient factory (the debounce
 * function's client), `lib/events.js`, `lib/revalidate.js` (the stored-page purge, recorded for the call order) and
 * CloudFront. Credential-free.
 *
 * Rows: L1B-DEFERRED-FLUSH-ARMED, -NOT-ARMED, -TWO-CHANGES, -DRAIN; documented limit L1B-LIMIT-STALE-VERDICT (residual
 * case 1: it asserts only that the next `/*` happens when a later change writes CDN_PENDING — no time bound).
 */

const { send, cfSend, purgeSpy, auditSpy } = vi.hoisted(() => ({ send: vi.fn(), cfSend: vi.fn(), purgeSpy: vi.fn(), auditSpy: vi.fn() }));

vi.mock("../../src/lib/db.js", () => ({ db: { send }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: auditSpy }));
vi.mock("../../src/lib/revalidate.js", () => ({ purgeStoredPagesOfDomains: purgeSpy }));
// PROJECTION-RESERVED-1: the replacement goes through guardCommandClasses (bare reserved words refused).
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    const { guardCommandClasses } = await import("./dynamo-expression-guard.js");
    return guardCommandClasses({ ...real, DynamoDBDocumentClient: { from: () => ({ send }) } });
});
vi.mock("@aws-sdk/client-cloudfront", () => ({
    CloudFrontClient: class { send = cfSend; },
    CreateInvalidationCommand: class { constructor(public input: any) {} },
}));

import { updateHandler as putSettings } from "../../src/tenant/settings.js";

// ── The in-memory table ──────────────────────────────────────────────────────────────────────────────────────────────

const table = new Map<string, Record<string, unknown>>();
const keyOf = (k: { PK: string; SK: string }) => `${k.PK}|${k.SK}`;
/** Every call, in order: `["purge"]`, `["arm", due]`, `["submit"]`, `["delete", condition]`, … */
const order: unknown[][] = [];

function conditionFailed(): Error {
    const e = new Error("The conditional request failed");
    e.name = "ConditionalCheckFailedException";
    return e;
}

/** Evaluates the condition expressions the two handlers send; anything else is a loud test failure. */
function holds(condition: string | undefined, item: Record<string, unknown> | undefined, values: Record<string, unknown>): boolean {
    if (condition === undefined) return true;
    const has = (a: string) => item !== undefined && Object.hasOwn(item, a);
    switch (condition) {
        case "attribute_not_exists(dueAt) OR dueAt < :due":
            return !has("dueAt") || (item!.dueAt as number) < (values[":due"] as number);
        case "dueAt = :read":
            return has("dueAt") && JSON.stringify(item!.dueAt) === JSON.stringify(values[":read"]);
        case "attribute_exists(SK) AND attribute_not_exists(dueAt)":
            return item !== undefined && !has("dueAt");
        case "updatedAt = :original":
            return has("updatedAt") && item!.updatedAt === values[":original"];
        default:
            throw new Error(`fake table: unsupported condition "${condition}"`);
    }
}

beforeEach(() => {
    table.clear();
    order.length = 0;
    send.mockReset().mockImplementation(async (cmd: any) => {
        const input = cmd.input;
        if (cmd instanceof GetCommand) {
            const item = table.get(keyOf(input.Key));
            return { Item: item === undefined ? undefined : structuredClone(item) };
        }
        if (cmd instanceof QueryCommand) return { Items: [] };
        if (cmd instanceof PutCommand) {
            table.set(keyOf(input.Item), structuredClone(input.Item));
            return {};
        }
        if (cmd instanceof UpdateCommand) {
            const k = keyOf(input.Key);
            const item = table.get(k);
            const values = input.ExpressionAttributeValues ?? {};
            if (!holds(input.ConditionExpression, item, values)) throw conditionFailed();
            if (input.UpdateExpression === "SET dueAt = :due") {
                order.push(["arm", values[":due"]]);
                table.set(k, { ...(item ?? input.Key), dueAt: values[":due"] });
            } else if (input.UpdateExpression === "SET updatedAt = :now, firstPendingAt = if_not_exists(firstPendingAt, :now)") {
                table.set(k, { ...(item ?? input.Key), updatedAt: values[":now"], firstPendingAt: item?.firstPendingAt ?? values[":now"] });
            } else {
                throw new Error(`fake table: unsupported update "${input.UpdateExpression}"`);
            }
            return {};
        }
        if (cmd instanceof DeleteCommand) {
            const k = keyOf(input.Key);
            order.push(["delete", input.Key.SK, input.ConditionExpression, input.ExpressionAttributeValues?.[":read"]]);
            if (!holds(input.ConditionExpression, table.get(k), input.ExpressionAttributeValues ?? {})) throw conditionFailed();
            table.delete(k);
            return {};
        }
        throw new Error(`fake table: unsupported command ${cmd.constructor.name}`);
    });
    cfSend.mockReset().mockImplementation(async (cmd: any) => {
        order.push(["submit", cmd.input.InvalidationBatch.Paths.Items, cmd.input.InvalidationBatch.CallerReference.split("-")[0]]);
        return {};
    });
    purgeSpy.mockReset().mockImplementation(async () => { order.push(["purge"]); });
    auditSpy.mockReset().mockResolvedValue(undefined);
    process.env.TABLE_NAME = "test-table";
    process.env.RENDERER_DISTRIBUTION_ID = "DIST123";
    process.env.DEBOUNCE_WINDOW_MS = "900000";
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const T0 = new Date("2026-11-22T12:00:00.000Z").getTime();
const MIN = 60_000;
const MARKER = { PK: "SYSTEM", SK: "CDN_DEFERRED_FLUSH" };
const marker = () => table.get(keyOf(MARKER));

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
/** Store the tenant record with `extra` fields (a one-language en-US tenant when `extra` is empty). */
function storeTenant(extra: Record<string, unknown> = {}) {
    table.set("SYSTEM|TENANT#t1", { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", Domain: "t1.test", locale: "en-US", ...extra });
}
async function save(body: Record<string, unknown>) {
    const event = { headers: { "x-tenant-id": "t1" }, requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } }, body: JSON.stringify(body) } as any;
    return (await (putSettings as any)(event, {} as any, () => {})) as { statusCode: number; body: string };
}
const arms = () => order.filter((e) => e[0] === "arm");
const submits = () => order.filter((e) => e[0] === "submit");

/** The REAL debounce handler, freshly imported (it reads its environment at load), run through its poll sleeps. */
async function runDrain(): Promise<void> {
    vi.resetModules();
    const { handler } = await import("../../src/scheduled/debounce-flush.js");
    const p = handler();
    await vi.runAllTimersAsync();
    await p;
}

// ── Arming ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("LANG-1B deferred flush — arming by PUT /settings", () => {
    it("L1B-DEFERRED-FLUSH-ARMED: [\"ro\"] → [\"ro\",\"de\"]: one UpdateItem on SYSTEM#CDN_DEFERRED_FLUSH, dueAt = save + 5 min, after the stored-page purge; the item holds dueAt only", async () => {
        storeTenant({ languages: ["ro"] });
        const res = await save({ languages: ["ro", "de"] });
        expect(res.statusCode, res.body).toBe(200);
        expect(arms()).toEqual([["arm", T0 + 5 * MIN]]);
        const purgeAt = order.findIndex((e) => e[0] === "purge");
        const armAt = order.findIndex((e) => e[0] === "arm");
        expect(purgeAt).toBeGreaterThanOrEqual(0);
        expect(armAt).toBeGreaterThan(purgeAt);
        expect(marker()).toEqual({ ...MARKER, dueAt: T0 + 5 * MIN });
        const update = send.mock.calls.map((c) => c[0]).find((c) => c instanceof UpdateCommand && c.input.Key.SK === "CDN_DEFERRED_FLUSH");
        expect(update.input).toEqual({
            TableName: "test-table", Key: MARKER, UpdateExpression: "SET dueAt = :due",
            ConditionExpression: "attribute_not_exists(dueAt) OR dueAt < :due", ExpressionAttributeValues: { ":due": T0 + 5 * MIN },
        });
    });

    it("L1B-DEFERRED-FLUSH-ARMED: a removed language and a first language also change the set", async () => {
        storeTenant({ languages: ["ro", "de"] });
        expect((await save({ languages: ["ro"] })).statusCode).toBe(200);
        expect(arms()).toHaveLength(1);
        table.delete(keyOf(MARKER));
        storeTenant();
        expect((await save({ languages: ["ro"] })).statusCode).toBe(200);
        expect(arms()).toHaveLength(2);
    });

    it("L1B-DEFERRED-FLUSH-NOT-ARMED: the same set, a reordered list, another field only, the menus only, a tenant without languages, a refused save: no write to the marker", async () => {
        const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
            ["the same set", { languages: ["ro"] }, { languages: ["ro"] }],
            ["a reordered list", { languages: ["ro", "de"] }, { languages: ["de", "ro"] }],
            ["another field only", { languages: ["ro"] }, { name: "Renamed" }],
            ["the menus only", { languages: ["ro"] }, { navLinksByLang: { ro: [{ label: "Acasă", href: "/ro" }] } }],
            ["a tenant without languages", {}, { name: "Renamed" }],
            ["an empty list on a tenant without languages", {}, { languages: [] }],
        ];
        for (const [name, stored, body] of cases) {
            storeTenant(stored);
            const res = await save(body);
            expect(res.statusCode, `${name}: ${res.body}`).toBe(200);
            expect(arms(), name).toEqual([]);
            expect(marker(), name).toBeUndefined();
        }
        // Positive control (same harness): a changed set does write.
        storeTenant({ languages: ["ro"] });
        await save({ languages: ["de"] });
        expect(arms()).toHaveLength(1);
        // A refused save (V3: the default language as an extra) arms nothing.
        table.delete(keyOf(MARKER));
        order.length = 0;
        storeTenant({ languages: ["ro"] });
        expect((await save({ languages: ["en"] })).statusCode).toBe(400);
        expect(arms()).toEqual([]);
    });

    it("L1B-DEFERRED-FLUSH-ARMED: a marker write failure is logged and never fails the save", async () => {
        storeTenant({ languages: ["ro"] });
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const real = send.getMockImplementation()!;
        send.mockImplementation(async (cmd: any) => {
            if (cmd instanceof UpdateCommand && cmd.input.Key.SK === "CDN_DEFERRED_FLUSH") throw new Error("ProvisionedThroughputExceededException");
            return real(cmd);
        });
        const res = await save({ languages: ["ro", "de"] });
        expect(res.statusCode).toBe(200);
        expect(errors).toHaveBeenCalled();
        expect(marker()).toBeUndefined();
    });
});

// ── Two changes inside the delay ─────────────────────────────────────────────────────────────────────────────────────

describe("LANG-1B deferred flush — two changes", () => {
    it("L1B-DEFERRED-FLUSH-TWO-CHANGES: a second change 2 min later moves dueAt to its own save + 5 min; an earlier or equal due does not move it; the drain fires nothing at first save + 5 min and one /* at second save + 5 min", async () => {
        storeTenant({ languages: ["ro"] });
        await save({ languages: ["ro", "de"] });
        expect(marker()!.dueAt).toBe(T0 + 5 * MIN);
        vi.setSystemTime(T0 + 2 * MIN);
        await save({ languages: ["ro"] });
        expect(marker()!.dueAt).toBe(T0 + 7 * MIN);
        // An earlier due (a save whose clock reads T0 + 1 min) and an equal due (T0 + 2 min again): not moved.
        vi.setSystemTime(T0 + 1 * MIN);
        expect((await save({ languages: ["ro", "fr"] })).statusCode).toBe(200);
        expect(marker()!.dueAt).toBe(T0 + 7 * MIN);
        vi.setSystemTime(T0 + 2 * MIN);
        expect((await save({ languages: ["ro"] })).statusCode).toBe(200);
        expect(marker()!.dueAt).toBe(T0 + 7 * MIN);
        // The drain: nothing at the first save + 5 min, one /* at the second save + 5 min.
        order.length = 0;
        vi.setSystemTime(T0 + 5 * MIN);
        await runDrain();
        expect(submits()).toEqual([]);
        expect(marker()).toBeDefined();
        vi.setSystemTime(T0 + 7 * MIN);
        await runDrain();
        expect(submits()).toEqual([["submit", ["/*"], "deferred"]]);
        expect(marker()).toBeUndefined();
    });
});

// ── The drain ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("LANG-1B deferred flush — the drain (debounce-flush.ts)", () => {
    it("L1B-DEFERRED-FLUSH-DRAIN: the item absent → no submit; a valid dueAt in the future → no submit", async () => {
        await runDrain();
        expect(submits()).toEqual([]);
        table.set(keyOf(MARKER), { ...MARKER, dueAt: T0 + 1 });
        await runDrain();
        expect(submits()).toEqual([]);
        expect(marker()).toEqual({ ...MARKER, dueAt: T0 + 1 });
    });

    it("L1B-DEFERRED-FLUSH-DRAIN: valid and due → exactly one /*, then the item deleted with dueAt = :read, after the submit", async () => {
        table.set(keyOf(MARKER), { ...MARKER, dueAt: T0 });
        await runDrain();
        expect(submits()).toEqual([["submit", ["/*"], "deferred"]]);
        const submitAt = order.findIndex((e) => e[0] === "submit");
        const deleteAt = order.findIndex((e) => e[0] === "delete" && e[1] === "CDN_DEFERRED_FLUSH");
        expect(deleteAt).toBeGreaterThan(submitAt);
        expect(order[deleteAt]).toEqual(["delete", "CDN_DEFERRED_FLUSH", "dueAt = :read", T0]);
        expect(marker()).toBeUndefined();
        order.length = 0;
        await runDrain();
        expect(submits()).toEqual([]);
    });

    const MALFORMED: [string, Record<string, unknown>, string][] = [
        ["dueAt absent", { ...MARKER }, "attribute_exists(SK) AND attribute_not_exists(dueAt)"],
        ["dueAt null", { ...MARKER, dueAt: null }, "dueAt = :read"],
        ["dueAt a string", { ...MARKER, dueAt: "soon" }, "dueAt = :read"],
    ];
    for (const [name, item, condition] of MALFORMED) {
        it(`L1B-DEFERRED-FLUSH-DRAIN: malformed (${name}) → one /*, the snapshot delete (${condition}), then nothing`, async () => {
            table.set(keyOf(MARKER), structuredClone(item));
            await runDrain();
            expect(submits()).toEqual([["submit", ["/*"], "deferred"]]);
            const del = order.find((e) => e[0] === "delete" && e[1] === "CDN_DEFERRED_FLUSH")!;
            expect(del[2]).toBe(condition);
            if (condition === "dueAt = :read") expect(del[3]).toEqual(item.dueAt);
            expect(marker()).toBeUndefined();
            order.length = 0;
            await runDrain();
            expect(submits()).toEqual([]);
        });

        it(`L1B-DEFERRED-FLUSH-DRAIN: malformed (${name}) and a valid dueAt written between the read and the delete → the delete fails, the item is kept`, async () => {
            table.set(keyOf(MARKER), structuredClone(item));
            cfSend.mockImplementation(async (cmd: any) => {
                order.push(["submit", cmd.input.InvalidationBatch.Paths.Items, "deferred"]);
                table.set(keyOf(MARKER), { ...MARKER, dueAt: T0 + 5 * MIN }); // a save armed meanwhile
                return {};
            });
            await runDrain();
            expect(submits()).toHaveLength(1);
            expect(marker()).toEqual({ ...MARKER, dueAt: T0 + 5 * MIN });
        });
    }

    it("L1B-DEFERRED-FLUSH-DRAIN: CloudFront throws → no delete, the item kept; the next invocation submits again and deletes", async () => {
        table.set(keyOf(MARKER), { ...MARKER, dueAt: T0 });
        vi.spyOn(console, "error").mockImplementation(() => {});
        cfSend.mockImplementationOnce(async () => { order.push(["submit-failed"]); throw new Error("ServiceUnavailable"); });
        await runDrain();
        expect(order.filter((e) => e[0] === "delete")).toEqual([]);
        expect(marker()).toEqual({ ...MARKER, dueAt: T0 });
        expect(order.filter((e) => e[0] === "submit-failed")).toHaveLength(1); // at most one attempt per invocation
        await runDrain();
        expect(submits()).toEqual([["submit", ["/*"], "deferred"]]);
        expect(marker()).toBeUndefined();
    });

    it("L1B-DEFERRED-FLUSH-DRAIN: the due-time rule — a finite number is due when not in the future; anything else (NaN, ±Infinity, cannot be stored) is due", async () => {
        vi.resetModules();
        const { deferredFlushIsDue } = await import("../../src/scheduled/debounce-flush.js");
        expect(deferredFlushIsDue(T0 + 1, T0)).toBe(false);
        expect(deferredFlushIsDue(T0, T0)).toBe(true);
        expect(deferredFlushIsDue(T0 - 1, T0)).toBe(true);
        for (const raw of [NaN, Infinity, -Infinity, undefined, null, "soon", String(T0 + MIN), { n: 1 }]) {
            expect(deferredFlushIsDue(raw, T0), String(raw)).toBe(true);
        }
    });
});

// ── Documented limit, residual case 1 ────────────────────────────────────────────────────────────────────────────────

describe("LANG-1B deferred flush — documented limit (residual case 1)", () => {
    it("L1B-LIMIT-STALE-VERDICT: after the deferred flush ran and its item is gone, the drain alone submits nothing more; a later change of any tenant (CDN_PENDING) makes the bulk branch submit the next /* (no time bound asserted)", async () => {
        table.set(keyOf(MARKER), { ...MARKER, dueAt: T0 });
        await runDrain();
        expect(submits()).toEqual([["submit", ["/*"], "deferred"]]);
        order.length = 0;
        vi.setSystemTime(T0 + 30 * MIN);
        await runDrain();
        expect(submits()).toEqual([]);
        // A later change of another tenant writes the bulk marker (markCdnPending's shape); its window has passed.
        table.set("SYSTEM|CDN_PENDING", { PK: "SYSTEM", SK: "CDN_PENDING", updatedAt: T0 + 10 * MIN, firstPendingAt: T0 + 10 * MIN });
        await runDrain();
        expect(submits()).toEqual([["submit", ["/*"], "debounce"]]);
    });
});

// PROJECTION-RESERVED-1 — rejection control for THIS file's own `@aws-sdk/lib-dynamodb` replacement: it goes through
// `guardCommandClasses`, so a bare reserved word is refused here as on DynamoDB, and a clean command still builds.
describe("PROJECTION-RESERVED-1 guard on this file's lib-dynamodb replacement", () => {
    it("refuses a bare reserved word with DynamoDB's text; builds a clean command", async () => {
        const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
        expect(() => new UpdateCommand({ TableName: "t", Key: { PK: "p", SK: "s" }, UpdateExpression: "SET data = :d" } as any))
            .toThrow("Invalid UpdateExpression: Attribute name is a reserved keyword; reserved keyword: data");
        const clean = new UpdateCommand({ TableName: "t", Key: { PK: "p", SK: "s" }, UpdateExpression: "SET #d = :d" } as any);
        expect(clean.constructor.name).toBe("UpdateCommand");
        expect((clean as any).input.UpdateExpression).toBe("SET #d = :d");
    });
});
