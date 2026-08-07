import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * cache-4a regression coverage for the debounce-flush BULK `/*` branch.
 *
 * These pin the two failures flagged in CACHE-4A/review-0:
 *   1. A failed OR skipped bulk `/*` submission must RETAIN both markers (CDN_PENDING and
 *      CDN_FAST_PENDING) so the next invocation retries — dropping them silently loses bulk
 *      invalidation work.
 *   2. The bulk branch must NOT delete CDN_FAST_PENDING. A path enqueued concurrently (between
 *      the `/*` submit and any delete) would otherwise be erased before its own fast-lane drain.
 *
 * Credential-free: the AWS SDK boundary is mocked (no DynamoDB, no CloudFront, no environment),
 * so this runs under `npm run test:unit` (config `vitest.unit.config.ts`, no `setupFiles`).
 *
 * The handler no longer returns after the bulk branch (CACHE-4A/review-3): it always runs its
 * full 6-iteration / 5×10s-sleep polling window so the fast lane keeps draining. These tests use
 * FAKE TIMERS and `runHandler()` to fast-forward through those sleeps in microseconds; the bulk
 * `bulkHandled` latch still guarantees the `/*` is submitted at most once per invocation, so the
 * "attempted exactly once" assertions hold.
 */

// vi.mock factories are hoisted above imports — the spies must be hoisted too.
const { cfSend, ddbSend } = vi.hoisted(() => ({
    cfSend: vi.fn(),
    ddbSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-cloudfront", () => ({
    CloudFrontClient: class {
        send = cfSend;
    },
    CreateInvalidationCommand: class {
        input: any;
        constructor(input: any) {
            this.input = input;
        }
    },
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: class {},
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
    DynamoDBDocumentClient: { from: () => ({ send: ddbSend }) },
    GetCommand: class {
        readonly __kind = "Get";
        input: any;
        constructor(input: any) {
            this.input = input;
        }
    },
    DeleteCommand: class {
        readonly __kind = "Delete";
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

/** Route ddb.send by command kind + SK; record every call for assertions. */
function routeDdb(opts: { fastItem?: any; bulkItem?: any }): void {
    ddbSend.mockImplementation(async (command: any) => {
        const kind = command.__kind;
        const sk = command.input?.Key?.SK;
        if (kind === "Get" && sk === "CDN_FAST_PENDING") return { Item: opts.fastItem };
        if (kind === "Get" && sk === "CDN_PENDING") return { Item: opts.bulkItem };
        return {}; // Delete / Update succeed silently
    });
}

const deletesFor = (sk: string) =>
    ddbSend.mock.calls.filter(([c]) => c.__kind === "Delete" && c.input?.Key?.SK === sk);

const invalidationItems = () =>
    cfSend.mock.calls.map(([c]) => c.input?.InvalidationBatch?.Paths?.Items);

/** An `updatedAt` old enough that `Date.now() - updatedAt >= DEBOUNCE_MS` (15 min). */
const expiredUpdatedAt = () => Date.now() - 1_000_000;

async function loadHandler() {
    const mod = await import("../../src/scheduled/debounce-flush.js");
    return mod.handler;
}

/**
 * Run the handler to completion, fast-forwarding through its 10s poll sleeps.
 * Requires `vi.useFakeTimers()` to be active (set in each suite's beforeEach). Starts the handler,
 * drains every scheduled timer + the microtasks between them, then awaits the handler's promise.
 */
async function runHandler(handler: () => Promise<void>): Promise<void> {
    const p = handler();
    await vi.runAllTimersAsync();
    await p;
}

describe("debounce-flush — BULK /* branch marker retention", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers(); // the handler now sleeps through its full polling window; fast-forward it
        cfSend.mockReset();
        ddbSend.mockReset();
        process.env.TABLE_NAME = "test-table";
        process.env.DEBOUNCE_WINDOW_MS = "900000";
        process.env.RENDERER_DISTRIBUTION_ID = "DIST123";
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("retains BOTH markers when the bulk /* CloudFront call THROWS (defect 1: dropped work)", async () => {
        // Fast lane empty (drainFastLane no-ops); bulk marker expired.
        routeDdb({ fastItem: undefined, bulkItem: { updatedAt: expiredUpdatedAt() } });
        cfSend.mockRejectedValue(new Error("CloudFront throttled")); // transient failure

        const handler = await loadHandler();
        await runHandler(handler);

        // The /* was attempted exactly once...
        expect(invalidationItems()).toEqual([["/*"]]);
        // ...and NOTHING was deleted — both markers survive for the next invocation's retry.
        expect(deletesFor("CDN_PENDING")).toHaveLength(0);
        expect(deletesFor("CDN_FAST_PENDING")).toHaveLength(0);
    });

    it("retains BOTH markers when the bulk /* submit is SKIPPED (no distribution configured)", async () => {
        delete process.env.RENDERER_DISTRIBUTION_ID; // submitInvalidation returns false, never calls CloudFront
        routeDdb({ fastItem: undefined, bulkItem: { updatedAt: expiredUpdatedAt() } });

        const handler = await loadHandler();
        await runHandler(handler);

        expect(cfSend).not.toHaveBeenCalled();
        expect(deletesFor("CDN_PENDING")).toHaveLength(0);
        expect(deletesFor("CDN_FAST_PENDING")).toHaveLength(0);
    });

    it("on a SUCCESSFUL bulk /* deletes ONLY CDN_PENDING, never CDN_FAST_PENDING (defect 2: race)", async () => {
        // A concurrently-enqueued fast path must not be erased by the bulk branch. The branch
        // never deletes CDN_FAST_PENDING, so whatever is in that Set survives to the next
        // ~10s fast-lane drain (one redundant targeted invalidation at worst).
        routeDdb({ fastItem: undefined, bulkItem: { updatedAt: expiredUpdatedAt() } });
        cfSend.mockResolvedValue({});

        const handler = await loadHandler();
        await runHandler(handler);

        expect(invalidationItems()).toEqual([["/*"]]);
        expect(deletesFor("CDN_PENDING")).toHaveLength(1);
        expect(deletesFor("CDN_FAST_PENDING")).toHaveLength(0);
        // The bulk marker delete is conditional (race-safe).
        expect(deletesFor("CDN_PENDING")[0][0].input.ConditionExpression).toBe(
            "updatedAt = :original",
        );
    });
});

/**
 * cache-4a regression for the FAST-LANE generation race flagged in CACHE-4A/review-1.
 *
 * The set-membership `DELETE #paths :drained` cannot see a re-edit of an ALREADY-queued path:
 * the second edit's `ADD` is a no-op on membership, so an unguarded delete erases it and the
 * second edit never reaches the edge. The fix is a generation counter `rev` bumped atomically by
 * every enqueue; the drain snapshots it and conditions cleanup on it.
 *
 * These tests use a stateful DynamoDB mock that actually models the String Set, the `rev`
 * counter, and the `ConditionExpression` — so the same-path interleave can be reproduced and the
 * assertion (the second edit survives) FAILS against the previous unconditional cleanup.
 */
describe("debounce-flush — FAST lane generation-safe cleanup (same-path race)", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers(); // the handler now sleeps through its full polling window; fast-forward it
        cfSend.mockReset();
        ddbSend.mockReset();
        process.env.TABLE_NAME = "test-table";
        process.env.DEBOUNCE_WINDOW_MS = "900000";
        process.env.RENDERER_DISTRIBUTION_ID = "DIST123";
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * A minimal in-memory DynamoDB that honours the two update expressions this Lambda issues:
     *   - enqueue: `ADD #paths :p, #rev :one SET updatedAt = :t`  (merge set, increment rev)
     *   - drain cleanup: `DELETE #paths :drained` guarded by `#rev = :rev` / `attribute_not_exists(#rev)`
     * `store` is returned so a test can mutate it (or read the survivor set) directly.
     */
    function statefulStore(seed: Record<string, any>): Record<string, any> {
        const store: Record<string, any> = { ...seed };
        ddbSend.mockImplementation(async (command: any) => {
            const kind = command.__kind;
            const input = command.input ?? {};
            const sk = input.Key?.SK;

            if (kind === "Get") {
                const it = store[sk];
                // Hand back a copy with a fresh Set so the handler can't mutate our store.
                return { Item: it ? { ...it, paths: it.paths ? new Set(it.paths) : undefined } : undefined };
            }

            if (kind === "Update") {
                const expr: string = input.UpdateExpression ?? "";
                const vals = input.ExpressionAttributeValues ?? {};
                const it = store[sk] ?? { PK: input.Key?.PK, SK: sk };

                if (expr.includes("ADD") && ":p" in vals) { // enqueue
                    it.paths = new Set<string>([...(it.paths ?? []), ...vals[":p"]]);
                    it.rev = (typeof it.rev === "number" ? it.rev : 0) + (vals[":one"] ?? 1);
                    it.updatedAt = vals[":t"];
                    store[sk] = it;
                    return {};
                }

                if (expr.includes("DELETE") && ":drained" in vals) { // drain cleanup
                    const cond: string | undefined = input.ConditionExpression;
                    if (cond) {
                        const ok = cond.includes("attribute_not_exists")
                            ? it.rev === undefined
                            : it.rev === vals[":rev"];
                        if (!ok) {
                            const err: any = new Error("The conditional request failed");
                            err.name = "ConditionalCheckFailedException";
                            throw err;
                        }
                    }
                    if (it.paths) {
                        for (const m of vals[":drained"]) it.paths.delete(m);
                        if (it.paths.size === 0) it.paths = undefined;
                    }
                    store[sk] = it;
                    return {};
                }
                return {};
            }

            if (kind === "Delete") { // bulk marker clear
                delete store[sk];
                return {};
            }
            return {};
        });
        return store;
    }

    it("retains a SAME-PATH edit enqueued during the drain, then re-invalidates it on the NEXT drain (rev guard; review-1 + review-3)", async () => {
        // Seed: /a queued at rev 5, plus an expired bulk marker.
        const store = statefulStore({
            CDN_FAST_PENDING: { PK: "SYSTEM", SK: "CDN_FAST_PENDING", paths: new Set(["/a"]), rev: 5 },
            CDN_PENDING: { PK: "SYSTEM", SK: "CDN_PENDING", updatedAt: expiredUpdatedAt() },
        });

        // The race, exactly ONCE: the instant CloudFront accepts the FIRST fast-lane batch for /a,
        // a NEW edit to the SAME path lands — membership is unchanged, but rev advances 5 → 6.
        let raced = false;
        cfSend.mockImplementation(async (command: any) => {
            const items = command.input?.InvalidationBatch?.Paths?.Items ?? [];
            if (!items.includes("/*") && !raced) {
                raced = true;
                store.CDN_FAST_PENDING.paths.add("/a"); // ADD — no-op on membership
                store.CDN_FAST_PENDING.rev += 1;        // ...but the generation moves: 5 → 6
            }
            return {};
        });

        const handler = await loadHandler();
        await runHandler(handler);

        const targeted = invalidationItems().filter((items: string[]) => !items.includes("/*"));
        // Iteration 0's cleanup condition (rev == 5) failed against the now-rev-6 marker, so /a was
        // NOT dropped (review-1). The very NEXT ~10s drain — same invocation, because the loop no
        // longer returns after the bulk branch (review-3) — re-invalidates /a with rev now stable,
        // so it is submitted at least twice and the set finally clears. Against the OLD
        // unconditional DELETE, /a would be gone after iteration 0; against the OLD return-after-bulk
        // it would linger unqueued until the next EventBridge tick.
        expect(targeted.filter((items: string[]) => items.includes("/a")).length).toBeGreaterThanOrEqual(2);
        expect(store.CDN_FAST_PENDING.paths).toBeUndefined();
    });

    it("clears the set on the happy path (no concurrent enqueue → rev unchanged → condition holds)", async () => {
        const store = statefulStore({
            CDN_FAST_PENDING: { PK: "SYSTEM", SK: "CDN_FAST_PENDING", paths: new Set(["/a", "/b"]), rev: 7 },
            CDN_PENDING: { PK: "SYSTEM", SK: "CDN_PENDING", updatedAt: expiredUpdatedAt() },
        });
        cfSend.mockResolvedValue({}); // no race hook — rev stays 7

        const handler = await loadHandler();
        await runHandler(handler);

        // Fast-lane targeted invalidation fired for the two paths...
        expect(invalidationItems()).toContainEqual(["/a", "/b"]);
        // ...and, rev unchanged, the conditional cleanup removed both members (set now empty).
        expect(store.CDN_FAST_PENDING.paths).toBeUndefined();
    });

    it("the fast-lane cleanup UpdateCommand carries a rev ConditionExpression (guards the race)", async () => {
        statefulStore({
            CDN_FAST_PENDING: { PK: "SYSTEM", SK: "CDN_FAST_PENDING", paths: new Set(["/a"]), rev: 3 },
            CDN_PENDING: { PK: "SYSTEM", SK: "CDN_PENDING", updatedAt: expiredUpdatedAt() },
        });
        cfSend.mockResolvedValue({});

        const handler = await loadHandler();
        await runHandler(handler);

        const cleanup = ddbSend.mock.calls
            .map(([c]) => c)
            .find((c) => c.__kind === "Update"
                && c.input?.Key?.SK === "CDN_FAST_PENDING"
                && String(c.input?.UpdateExpression).includes("DELETE"));
        expect(cleanup).toBeDefined();
        expect(cleanup.input.ConditionExpression).toBe("#rev = :rev");
        expect(cleanup.input.ExpressionAttributeValues[":rev"]).toBe(3);
    });

    it("keeps draining the fast lane AFTER the bulk /* fires — a path enqueued mid-invocation goes live the NEXT ~10s drain, not the next EventBridge tick (review-3)", async () => {
        // Fast lane starts EMPTY; an expired bulk marker makes iteration 0 fire /*.
        const store = statefulStore({
            CDN_PENDING: { PK: "SYSTEM", SK: "CDN_PENDING", updatedAt: expiredUpdatedAt() },
        });

        // The interleave review-3 flagged: the instant the bulk /* is submitted (iteration 0), an
        // ordinary edit lands and enqueues /new-page into the fast lane.
        let enqueued = false;
        cfSend.mockImplementation(async (command: any) => {
            const items = command.input?.InvalidationBatch?.Paths?.Items ?? [];
            if (items.includes("/*") && !enqueued) {
                enqueued = true;
                store.CDN_FAST_PENDING = {
                    PK: "SYSTEM", SK: "CDN_FAST_PENDING", paths: new Set(["/new-page"]), rev: 1,
                };
            }
            return {};
        });

        const handler = await loadHandler();
        await runHandler(handler);

        // A TARGETED invalidation for /new-page fired in a LATER iteration of the SAME invocation.
        // Pre-review-3 the bulk branch `return`ed right after submitting /*, ending the loop, so
        // /new-page sat unqueued until the next EventBridge tick (~1 min) and cfSend only ever saw
        // ["/*"]. This is the failing test the fix makes pass.
        expect(invalidationItems()).toContainEqual(["/new-page"]);
        // Its rev unchanged during its own drain, the fast marker is then cleared.
        expect(store.CDN_FAST_PENDING?.paths).toBeUndefined();
    });
});
