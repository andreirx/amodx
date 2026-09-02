import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * cache-4a regression for the ENQUEUE half of the fast-lane generation protocol
 * (CACHE-4A/review-2, required change 1).
 *
 * The drain's generation-safe cleanup (`debounce-flush.test.ts`) is only correct if the WRITER
 * upholds its invariant: every enqueue must merge the changed-path String Set AND advance the
 * `rev` counter in ONE atomic `UpdateItem`, so `paths` and `rev` can never diverge. The drain
 * test asserted that invariant by hand-incrementing `rev` in a mock; this test proves the real
 * `enqueueEdgeInvalidation()` actually establishes it.
 *
 * Credential-free: `lib/db.ts` (the DocumentClient + TABLE_NAME) is mocked, and the AWS
 * command classes are stubbed to capture their `input`. No AWS SDK client is instantiated, no
 * environment is read — runs under `npm run test:unit` (config `vitest.unit.config.ts`).
 */

const { ddbSend, lambdaSend } = vi.hoisted(() => ({ ddbSend: vi.fn(), lambdaSend: vi.fn() }));

// Mock the db singleton so no real DynamoDBDocumentClient / AWS client is constructed.
vi.mock("../../src/lib/db.js", () => ({
    db: { send: ddbSend },
    TABLE_NAME: "test-table",
}));

// CACHE-9: mock the Lambda client so the async self-invoke is captured, never real. The command
// class stashes its `input` for assertions (same style as the ddb stubs below).
vi.mock("@aws-sdk/client-lambda", () => ({
    LambdaClient: class {
        send = lambdaSend;
    },
    InvokeCommand: class {
        readonly __kind = "Invoke";
        input: any;
        constructor(input: any) {
            this.input = input;
        }
    },
}));

// Stub the command classes to capture their input for assertions (same style as
// debounce-flush.test.ts). `edge-invalidation.js` (pure) is intentionally NOT mocked.
vi.mock("@aws-sdk/lib-dynamodb", () => ({
    PutCommand: class {
        readonly __kind = "Put";
        input: any;
        constructor(input: any) {
            this.input = input;
        }
    },
    UpdateCommand: class {
        readonly __kind = "Update";
        input: any;
        constructor(input: any) {
            this.input = input;
        }
    },
}));

async function loadEnqueue() {
    const mod = await import("../../src/lib/invalidate-cdn.js");
    return mod.enqueueEdgeInvalidation;
}

const updateCalls = () =>
    ddbSend.mock.calls.map(([c]) => c).filter((c) => c.__kind === "Update");

const invokeCalls = () =>
    lambdaSend.mock.calls.map(([c]) => c).filter((c) => c.__kind === "Invoke");

describe("enqueueEdgeInvalidation — atomic paths + rev (writer invariant)", () => {
    beforeEach(() => {
        vi.resetModules();
        ddbSend.mockReset();
        ddbSend.mockResolvedValue({});
    });

    it("issues ONE UpdateCommand that ADDs both the path String Set and rev in the same expression", async () => {
        const enqueue = await loadEnqueue();
        await enqueue(["/about", "/produs/inel"]);

        const updates = updateCalls();
        expect(updates).toHaveLength(1); // exactly one — paths and rev cannot land in separate writes
        const u = updates[0];

        // Single atomic expression: merge the set AND bump the generation counter.
        expect(u.input.UpdateExpression).toContain("ADD #paths :p, #rev :one");
        expect(u.input.Key).toEqual({ PK: "SYSTEM", SK: "CDN_FAST_PENDING" });
        expect(u.input.ExpressionAttributeNames).toMatchObject({ "#paths": "paths", "#rev": "rev" });

        // rev advances by exactly 1 per enqueue; paths arrive as a DynamoDB String Set (Set).
        expect(u.input.ExpressionAttributeValues[":one"]).toBe(1);
        expect(u.input.ExpressionAttributeValues[":p"]).toBeInstanceOf(Set);
        expect([...u.input.ExpressionAttributeValues[":p"]]).toEqual(["/about", "/produs/inel"]);
    });

    it("normalizes paths before enqueueing (bare + double-slashed → exactly one leading slash, deduped)", async () => {
        const enqueue = await loadEnqueue();
        await enqueue(["about", "//about", "/produs/inel"]);

        const set = updateCalls()[0].input.ExpressionAttributeValues[":p"];
        expect([...set]).toEqual(["/about", "/produs/inel"]); // "about" and "//about" fold to "/about"
    });

    it("skips the write entirely when there is nothing to invalidate", async () => {
        const enqueue = await loadEnqueue();
        await enqueue(["", "   "]);
        expect(updateCalls()).toHaveLength(0);
    });
});

/**
 * CACHE-9 (event-driven fast lane, ratified 2026-09-02). After a successful fast-lane marker
 * write, `enqueueEdgeInvalidation()` async-invokes the DebounceFlush function so the drain runs in
 * ~1s instead of waiting up to one EventBridge tick (~60s) while the idle-exit flusher sleeps.
 *
 * These pin the three contract points from the slice packet:
 *   (a) a successful marker write triggers EXACTLY ONE Event-type invoke of the configured fn;
 *   (b) an invoke FAILURE is swallowed — the mutation still resolves and the marker write happened;
 *   (c) the env var UNSET → no invoke attempted, no throw (the sweeper contract still holds).
 *
 * The invoke is read from `process.env.DEBOUNCE_FLUSH_FUNCTION_NAME` per call, so each test sets it
 * before importing and clears it after to prevent cross-test leakage.
 */
describe("enqueueEdgeInvalidation — CACHE-9 event-driven drain trigger", () => {
    beforeEach(() => {
        vi.resetModules();
        ddbSend.mockReset();
        ddbSend.mockResolvedValue({}); // marker write succeeds
        lambdaSend.mockReset();
        lambdaSend.mockResolvedValue({ StatusCode: 202 });
        delete process.env.DEBOUNCE_FLUSH_FUNCTION_NAME;
    });

    afterEach(() => {
        delete process.env.DEBOUNCE_FLUSH_FUNCTION_NAME;
    });

    it("(a) triggers exactly ONE Event-type invoke of the configured function after a successful marker write", async () => {
        process.env.DEBOUNCE_FLUSH_FUNCTION_NAME = "amodx-debounce-flush-staging";
        const enqueue = await loadEnqueue();
        await enqueue(["/about"]);

        // The marker was written first...
        expect(updateCalls()).toHaveLength(1);
        // ...then exactly one async invoke of the flusher.
        const invokes = invokeCalls();
        expect(invokes).toHaveLength(1);
        expect(invokes[0].input).toMatchObject({
            FunctionName: "amodx-debounce-flush-staging",
            InvocationType: "Event", // async — never "RequestResponse" (would block the edit on the flush)
        });
    });

    it("(a2) high-water-mark PUT fails but marker UPDATE succeeds → still exactly one invoke (partial-write gap, review-0 pt1)", async () => {
        process.env.DEBOUNCE_FLUSH_FUNCTION_NAME = "amodx-debounce-flush-staging";
        // The load-bearing marker Update succeeds; only the independent CDN_LAST_CHANGE Put rejects.
        // Before the review-0 fix these shared one Promise.all, so a Put rejection skipped the invoke.
        ddbSend.mockImplementation((cmd: any) => {
            if (cmd.__kind === "Put") return Promise.reject(new Error("high-water put failed"));
            return Promise.resolve({});
        });
        const enqueue = await loadEnqueue();

        // The put failure is swallowed — the mutation still resolves.
        await expect(enqueue(["/about"])).resolves.toBeUndefined();

        // Marker written, and the accelerator still fired exactly once despite the put failure.
        expect(updateCalls()).toHaveLength(1);
        expect(invokeCalls()).toHaveLength(1);
    });

    it("marker UPDATE fails → no invoke attempted (nothing durable to drain)", async () => {
        process.env.DEBOUNCE_FLUSH_FUNCTION_NAME = "amodx-debounce-flush-staging";
        // Only the load-bearing marker Update rejects; there is no durable marker, so no accelerator.
        ddbSend.mockImplementation((cmd: any) => {
            if (cmd.__kind === "Update") return Promise.reject(new Error("marker update failed"));
            return Promise.resolve({});
        });
        const enqueue = await loadEnqueue();

        await expect(enqueue(["/about"])).resolves.toBeUndefined();

        expect(updateCalls()).toHaveLength(1); // attempted
        expect(invokeCalls()).toHaveLength(0); // ...but never invoked without a durable marker
    });

    it("(b) an invoke failure is swallowed — the mutation resolves and the marker write still happened", async () => {
        process.env.DEBOUNCE_FLUSH_FUNCTION_NAME = "amodx-debounce-flush-staging";
        lambdaSend.mockRejectedValue(new Error("Lambda throttled")); // invoke fails
        const enqueue = await loadEnqueue();

        // Must NOT reject — the edit-save path can never fail because the accelerator failed.
        await expect(enqueue(["/about"])).resolves.toBeUndefined();

        // The durable marker write happened regardless (the sweeper will drain it).
        expect(updateCalls()).toHaveLength(1);
        expect(invokeCalls()).toHaveLength(1); // it was attempted
    });

    it("(c) env var unset → no invoke attempted, no throw (sweeper contract still holds)", async () => {
        // DEBOUNCE_FLUSH_FUNCTION_NAME is deleted in beforeEach.
        const enqueue = await loadEnqueue();
        await expect(enqueue(["/about"])).resolves.toBeUndefined();

        expect(updateCalls()).toHaveLength(1); // marker still written
        expect(invokeCalls()).toHaveLength(0); // ...but no invoke without the wiring
    });

    it("does NOT invoke when there is nothing to enqueue (no marker write, no accelerator)", async () => {
        process.env.DEBOUNCE_FLUSH_FUNCTION_NAME = "amodx-debounce-flush-staging";
        const enqueue = await loadEnqueue();
        await enqueue(["", "   "]);

        expect(updateCalls()).toHaveLength(0);
        expect(invokeCalls()).toHaveLength(0);
    });
});
