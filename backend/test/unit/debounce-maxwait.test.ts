import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * CACHE-10 — bulk `/*` debounce MAX WAIT (operator decision CACHE10-DEBOUNCE-MAXWAIT, 2026-10-13).
 *
 * Since CACHE-10 every ordinary edit writes the global `SYSTEM#CDN_PENDING` marker (listing
 * freshness). A quiet-window-only debounce never fires under continuous cross-tenant edits, so the
 * marker carries `firstPendingAt` (set once, `if_not_exists`) and debounce-flush fires `/*` when the
 * quiet window OR the max wait (default = the 15-min window) has expired.
 *
 * These tests drive the REAL `markCdnPending()` (writer) and the REAL debounce-flush `handler`
 * (reader) against ONE in-memory marker table, under fake time. Credential-free: every AWS SDK
 * boundary is mocked; nothing leaves the process.
 *
 *   (a) edits every 5 min for 40 min → every edit is covered by a `/*` at most 15 min later,
 *       and `/*`s are at least 15 min apart (no mid-flush mutation in this stream; the mid-flush
 *       exception — one extra `/*` — is pinned by its own test below)
 *   (b) quiet-window path unchanged (max wait set long → fires 15 min after the LAST edit)
 *   (c) a legacy marker without `firstPendingAt` fires on `updatedAt` (never stuck)
 *   (d) `firstPendingAt` is never overwritten by later `markCdnPending()` calls
 *   plus: the banner's `goLiveAt` uses the same rule (`system/invalidation.ts#statusHandler`).
 */

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 13, 12, 0, 0);

const { cfSend, ddbSend } = vi.hoisted(() => ({ cfSend: vi.fn(), ddbSend: vi.fn() }));

vi.mock("@aws-sdk/client-cloudfront", () => ({
    CloudFrontClient: class {
        send = cfSend;
    },
    CreateInvalidationCommand: class {
        constructor(public input: any) {}
    },
}));
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/client-lambda", () => ({
    LambdaClient: class {
        send = vi.fn();
    },
    InvokeCommand: class {
        constructor(public input: any) {}
    },
}));
vi.mock("@aws-sdk/lib-dynamodb", () => {
    const cmd = (kind: string) =>
        class {
            readonly __kind = kind;
            constructor(public input: any) {}
        };
    return {
        DynamoDBDocumentClient: { from: () => ({ send: ddbSend }) },
        GetCommand: cmd("Get"),
        PutCommand: cmd("Put"),
        UpdateCommand: cmd("Update"),
        DeleteCommand: cmd("Delete"),
    };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));

/** The exact write `markCdnPending()` must issue for CDN_PENDING — pinned by test (d). */
const PENDING_UPDATE = "SET updatedAt = :now, firstPendingAt = if_not_exists(firstPendingAt, :now)";

/** In-memory SYSTEM rows keyed by SK. Interprets only the operations the two modules issue. */
let table: Record<string, any>;

function installTable(): void {
    ddbSend.mockImplementation(async (c: any) => {
        const sk = c.input?.Key?.SK ?? c.input?.Item?.SK;
        switch (c.__kind) {
            case "Get":
                return { Item: table[sk] ? { ...table[sk] } : undefined };
            case "Put":
                table[sk] = { ...c.input.Item };
                return {};
            case "Update": {
                if (sk !== "CDN_PENDING") return {}; // fast lane etc. — not exercised here
                // Refuse any expression other than the pinned one, so this fake can never give a
                // semantics the production write does not have.
                expect(c.input.UpdateExpression).toBe(PENDING_UPDATE);
                const now = c.input.ExpressionAttributeValues[":now"];
                const prev = table[sk];
                table[sk] = { PK: "SYSTEM", SK: sk, updatedAt: now, firstPendingAt: prev?.firstPendingAt ?? now };
                return {};
            }
            case "Delete": {
                const original = c.input.ExpressionAttributeValues?.[":original"];
                if (c.input.ConditionExpression && table[sk]?.updatedAt !== original) {
                    throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
                }
                delete table[sk];
                return {};
            }
        }
        throw new Error(`unexpected command ${c.__kind}`);
    });
}

/** Wall-clock times (ms) at which a `/*` was submitted. */
const wildcardTimes: number[] = [];

async function load() {
    vi.resetModules();
    const { markCdnPending } = await import("../../src/lib/invalidate-cdn.js");
    const { handler } = await import("../../src/scheduled/debounce-flush.js");
    return { markCdnPending, handler };
}

/** One EventBridge tick at absolute time `t`: run the handler through its sleeps. */
async function tickAt(handler: () => Promise<void>, t: number): Promise<void> {
    vi.setSystemTime(t);
    const p = handler();
    await vi.runAllTimersAsync();
    await p;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    table = {};
    wildcardTimes.length = 0;
    cfSend.mockReset();
    cfSend.mockImplementation(async (c: any) => {
        if (c.input?.InvalidationBatch?.Paths?.Items?.[0] === "/*") wildcardTimes.push(Date.now());
        return {};
    });
    ddbSend.mockReset();
    installTable();
    process.env.TABLE_NAME = "test-table";
    process.env.RENDERER_DISTRIBUTION_ID = "DIST123";
    process.env.DEBOUNCE_WINDOW_MS = String(15 * MIN);
    delete process.env.DEBOUNCE_MAX_WAIT_MS; // default = the window
});

afterEach(() => {
    vi.useRealTimers();
});

describe("CACHE-10 bulk debounce max wait", () => {
    it("(a) edits every 5 min for 40 min: each edit is covered by a `/*` ≤ 15 min later; `/*`s ≥ 15 min apart", async () => {
        const { markCdnPending, handler } = await load();
        const edits: number[] = [];

        // Minute-resolution simulation of 56 min: an edit at every 5th minute up to minute 40
        // (the edit lands before that minute's EventBridge tick), then quiet.
        for (let m = 0; m <= 56; m++) {
            const t = T0 + m * MIN;
            if (m % 5 === 0 && m <= 40) {
                vi.setSystemTime(t);
                await markCdnPending();
                edits.push(t);
            }
            await tickAt(handler, t);
        }

        // Without the max wait the 5-min gaps never open a 15-min quiet window → only ONE `/*`, at
        // minute 55 (15 min after the last edit). With it, `/*` fires during the edit stream.
        expect(wildcardTimes.length).toBeGreaterThanOrEqual(3);
        expect(wildcardTimes[0]).toBeLessThanOrEqual(T0 + 15 * MIN);
        for (const e of edits) {
            const coveredBy = wildcardTimes.find((f) => f >= e);
            expect(coveredBy, `edit at +${(e - T0) / MIN} min has no later /*`).toBeDefined();
            expect(coveredBy! - e).toBeLessThanOrEqual(15 * MIN);
        }
        for (let i = 1; i < wildcardTimes.length; i++) {
            expect(wildcardTimes[i] - wildcardTimes[i - 1]).toBeGreaterThanOrEqual(15 * MIN);
        }
        expect(table.CDN_PENDING).toBeUndefined(); // the last `/*` cleared the marker
    });

    it("(b) quiet-window path unchanged: with a long max wait, `/*` fires 15 min after the LAST edit", async () => {
        process.env.DEBOUNCE_MAX_WAIT_MS = String(60 * MIN);
        const { markCdnPending, handler } = await load();

        await markCdnPending(); // +0
        vi.setSystemTime(T0 + 5 * MIN);
        await markCdnPending(); // +5 → quiet window ends at +20

        await tickAt(handler, T0 + 19 * MIN);
        expect(wildcardTimes).toEqual([]);
        await tickAt(handler, T0 + 20 * MIN);
        expect(wildcardTimes).toEqual([T0 + 20 * MIN]);
        expect(table.CDN_PENDING).toBeUndefined();
    });

    it("(c) a legacy marker without `firstPendingAt` fires on `updatedAt` (never stuck)", async () => {
        const { handler } = await load();
        table.CDN_PENDING = { PK: "SYSTEM", SK: "CDN_PENDING", updatedAt: T0 }; // pre-CACHE-10 shape

        await tickAt(handler, T0 + 14 * MIN);
        expect(wildcardTimes).toEqual([]);
        await tickAt(handler, T0 + 15 * MIN);
        expect(wildcardTimes).toEqual([T0 + 15 * MIN]);
    });

    it("(d) `firstPendingAt` is set once and never overwritten by later markCdnPending() calls", async () => {
        const { markCdnPending } = await load();

        await markCdnPending();
        vi.setSystemTime(T0 + 7 * MIN);
        await markCdnPending();

        const writes = ddbSend.mock.calls.map(([c]) => c).filter((c) => c.input?.Key?.SK === "CDN_PENDING");
        expect(writes).toHaveLength(2);
        for (const w of writes) {
            expect(w.__kind).toBe("Update"); // not a Put — a Put would replace firstPendingAt
            expect(w.input.UpdateExpression).toBe(PENDING_UPDATE);
        }
        expect(table.CDN_PENDING).toMatchObject({ updatedAt: T0 + 7 * MIN, firstPendingAt: T0 });
    });

    it("mid-flush mutation: marker retained with its ORIGINAL firstPendingAt → next tick fires one more `/*`", async () => {
        const { markCdnPending, handler } = await load();
        await markCdnPending(); // first pending at +0
        vi.setSystemTime(T0 + 10 * MIN);
        await markCdnPending(); // updatedAt +10

        // A mutation lands between the flush's read and its conditional delete.
        cfSend.mockImplementationOnce(async () => {
            wildcardTimes.push(Date.now());
            table.CDN_PENDING = { ...table.CDN_PENDING, updatedAt: Date.now() };
            return {};
        });
        await tickAt(handler, T0 + 15 * MIN);
        expect(wildcardTimes).toEqual([T0 + 15 * MIN]);
        expect(table.CDN_PENDING).toMatchObject({ firstPendingAt: T0 }); // retained, original first

        await tickAt(handler, T0 + 16 * MIN); // next EventBridge tick
        expect(wildcardTimes).toEqual([T0 + 15 * MIN, T0 + 16 * MIN]);
        expect(table.CDN_PENDING).toBeUndefined();
    });
});

describe("CACHE-10 banner goLiveAt uses the same due rule", () => {
    it("GET /system/invalidation reports firstPendingAt + max wait while edits keep arriving", async () => {
        vi.resetModules();
        const { statusHandler } = await import("../../src/system/invalidation.js");
        table.CDN_PENDING = { PK: "SYSTEM", SK: "CDN_PENDING", updatedAt: T0 + 12 * MIN, firstPendingAt: T0 };

        const res: any = await statusHandler(
            {
                headers: { "x-tenant-id": "t1" },
                requestContext: { authorizer: { lambda: { sub: "u", role: "GLOBAL_ADMIN", tenantId: "ALL" } } },
            } as any,
            {} as any,
            () => {},
        );

        expect(res.statusCode).toBe(200);
        // quiet window would say +27; the max wait says +15 — the earlier one is when /* fires
        expect(JSON.parse(res.body)).toMatchObject({ pending: true, goLiveAt: new Date(T0 + 15 * MIN).toISOString() });
    });
});
