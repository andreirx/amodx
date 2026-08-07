import { describe, it, expect, beforeEach, vi } from "vitest";

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

const { ddbSend } = vi.hoisted(() => ({ ddbSend: vi.fn() }));

// Mock the db singleton so no real DynamoDBDocumentClient / AWS client is constructed.
vi.mock("../../src/lib/db.js", () => ({
    db: { send: ddbSend },
    TABLE_NAME: "test-table",
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
