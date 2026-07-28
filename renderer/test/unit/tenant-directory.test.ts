import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * slice `test-3` — `src/lib/tenant-directory.ts`: the host → "is this a wired tenant?"
 * verdict that `middleware.ts` consults on EVERY production-mode request.
 *
 * WHY UNIT TESTS AND NOT THE SERVING SUITE (test-2). The serving-contract suite drives a
 * real `next start` and pins what the wire does. It cannot reach the three branches that
 * make this module safe, because they are all functions of TIME and of ACCUMULATED
 * PROCESS STATE:
 *
 *   - the 60 s TTL expiring (a wire probe would have to sleep a minute),
 *   - the 512-entry bound evicting (513 distinct Host headers per probe run),
 *   - DynamoDB throwing (a wire probe cannot make the real table fail on command).
 *
 * Those three are exactly where a defect is unrecoverable at the estate level: this
 * function's `null` return is the ONLY thing standing between a DynamoDB blip and a 404
 * served for every tenant at once. So they are unit-tested here, against the real module,
 * with the SDK mocked at the import boundary.
 *
 * HOW THE MODULE STATE IS CONTROLLED. `cache` and `client` are module-level singletons —
 * that is deliberate (per-instance memoisation on a warm Lambda), and it is also why every
 * test re-imports the module through `vi.resetModules()`. Without that, test N would
 * inherit test N-1's warm cache. The slice asked for an injected clock/lookup; the module
 * exposes no such seam and `test-3` forbids src changes, so the seam used instead is the
 * module registry plus fake timers — no src change, same branch coverage. Recorded as
 * finding F-RENDERER-1.
 */

// `vi.mock` is hoisted above the imports, so the spy it closes over must be hoisted too.
const ddbSend = vi.hoisted(() => vi.fn());
const clientCtor = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: class {
        send = ddbSend;
        constructor(cfg: unknown) { clientCtor(cfg); }
    },
    // The real QueryCommand is an opaque SDK object; keeping the raw input reachable is
    // what lets the query-shape test below assert tenant isolation without unwrapping it.
    QueryCommand: class { constructor(public input: unknown) {} },
}));

/** Fresh module instance — empty verdict cache, no memoised client. */
async function loadModule() {
    vi.resetModules();
    // Relative + extensionless: the renderer's own code uses the `@/*` tsconfig alias,
    // which vite would need a matching `resolve.alias` to honour. A relative path keeps
    // the unit config free of a second copy of that mapping.
    return await import("../../src/lib/tenant-directory");
}

const ENV_KEYS = [
    "TABLE_NAME",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_REGION",
    "AWS_ENDPOINT_URL_DYNAMODB",
] as const;

let savedEnv: Record<string, string | undefined>;

/** Count query answer: `Count` is what the module reads (`Select: "COUNT"`). */
const count = (n: number) => ({ Count: n });

const T0 = new Date("2026-07-28T12:00:00.000Z");

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.TABLE_NAME = "AmodxStack-Table";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    ddbSend.mockReset();
    clientCtor.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
});

afterEach(() => {
    vi.useRealTimers();
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k]!;
    }
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------

describe("isWiredTenantHost — the verdict itself", () => {
    /**
     * INVARIANT: `true` iff at least one `TENANT#` item exists on `GSI_Domain` for the
     * host. `Select: COUNT` means the answer is a number, never a tenant record — the
     * point being that no tenant data crosses into the edge bundle.
     */
    it("returns true when the COUNT query finds a tenant", async () => {
        ddbSend.mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();
        await expect(isWiredTenantHost("dental-pros.com")).resolves.toBe(true);
    });

    it("returns false when the COUNT query finds nothing", async () => {
        ddbSend.mockResolvedValue(count(0));
        const { isWiredTenantHost } = await loadModule();
        await expect(isWiredTenantHost("nobody.example")).resolves.toBe(false);
    });

    it("treats an absent Count as 'not wired', not as an error", async () => {
        // DynamoDB omits `Count` in some responses. `(res.Count ?? 0) > 0` makes that a
        // definite `false` (404) rather than a `null` (fail open). Pinned because the two
        // outcomes are visibly different to a visitor.
        ddbSend.mockResolvedValue({});
        const { isWiredTenantHost } = await loadModule();
        await expect(isWiredTenantHost("nobody.example")).resolves.toBe(false);
    });
});

describe("isWiredTenantHost — the query it sends (tenant isolation + edge safety)", () => {
    /**
     * INVARIANT (CLAUDE.md rules 2 and 3): a Query on `GSI_Domain` keyed by the exact host,
     * filtered to `TENANT#` items, `Select: COUNT`. Never a Scan; never a cross-tenant read;
     * never an unmarshalled item.
     */
    it("queries GSI_Domain by exact host, TENANT# only, COUNT only", async () => {
        ddbSend.mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();
        await isWiredTenantHost("dental-pros.com");

        expect(ddbSend).toHaveBeenCalledTimes(1);
        const { input } = ddbSend.mock.calls[0][0] as { input: Record<string, unknown> };
        expect(input).toEqual({
            TableName: "AmodxStack-Table",
            IndexName: "GSI_Domain",
            KeyConditionExpression: "#d = :d",
            FilterExpression: "begins_with(SK, :t)",
            ExpressionAttributeNames: { "#d": "Domain" },
            ExpressionAttributeValues: { ":d": { S: "dental-pros.com" }, ":t": { S: "TENANT#" } },
            Select: "COUNT",
        });
    });

    it("hands the edge client explicit static credentials", async () => {
        // The edge runtime has no default credential provider chain (module header,
        // measured). If this regresses to an implicit chain, every request fails
        // `Credential is missing` and the module silently degrades to permanent fail-open.
        process.env.AWS_REGION = "eu-west-1";
        process.env.AWS_SESSION_TOKEN = "token";
        ddbSend.mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();
        await isWiredTenantHost("dental-pros.com");

        expect(clientCtor).toHaveBeenCalledTimes(1);
        expect(clientCtor.mock.calls[0][0]).toMatchObject({
            region: "eu-west-1",
            credentials: {
                accessKeyId: "AKIATEST",
                secretAccessKey: "secret",
                sessionToken: "token",
            },
        });
    });

    it("memoises the client across calls (one construction, not one per request)", async () => {
        ddbSend.mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();
        await isWiredTenantHost("a.example");
        await isWiredTenantHost("b.example");
        expect(clientCtor).toHaveBeenCalledTimes(1);
        expect(ddbSend).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------------------

describe("isWiredTenantHost — FAIL OPEN (null) is the estate-wide safety valve", () => {
    /**
     * INVARIANT, from the module's own contract: "**Callers must fail open on `null`.** A
     * DynamoDB blip must degrade to 'render it', never to '404 the whole estate'."
     *
     * Each test below pairs its absence assertion (`ddbSend` not called) with the positive
     * control in the first block above, which proves the same detector DOES fire when the
     * lookup runs — the control required by `docs/testing-strategy.md` § Invariants.
     */
    it("returns null and issues no query when TABLE_NAME is unset (local dev)", async () => {
        delete process.env.TABLE_NAME;
        const { isWiredTenantHost } = await loadModule();
        await expect(isWiredTenantHost("dental-pros.com")).resolves.toBeNull();
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("returns null and issues no query for an empty host", async () => {
        const { isWiredTenantHost } = await loadModule();
        await expect(isWiredTenantHost("")).resolves.toBeNull();
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("returns null when no static credentials are in the environment", async () => {
        delete process.env.AWS_SECRET_ACCESS_KEY;
        const { isWiredTenantHost } = await loadModule();
        await expect(isWiredTenantHost("dental-pros.com")).resolves.toBeNull();
        expect(ddbSend).not.toHaveBeenCalled();
        expect(clientCtor).not.toHaveBeenCalled();
    });

    it("returns null when DynamoDB throws", async () => {
        ddbSend.mockRejectedValue(new Error("ProvisionedThroughputExceededException"));
        const { isWiredTenantHost } = await loadModule();
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(isWiredTenantHost("dental-pros.com")).resolves.toBeNull();
        expect(spy).toHaveBeenCalled();
    });

    it("does NOT cache a failure — the next request retries instead of inheriting the blip", async () => {
        // The blast radius if this regressed: one transient error would pin a host into
        // fail-open (or, if the failure were cached as `false`, into a 404) for the whole
        // TTL on that instance.
        vi.spyOn(console, "error").mockImplementation(() => {});
        ddbSend.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();

        await expect(isWiredTenantHost("dental-pros.com")).resolves.toBeNull();
        await expect(isWiredTenantHost("dental-pros.com")).resolves.toBe(true);
        expect(ddbSend).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------------------

describe("isWiredTenantHost — 60 s TTL", () => {
    /**
     * INVARIANT: a verdict, positive OR negative, is trusted for 60 000 ms and then
     * re-read. The symmetry is the design (module header): a newly wired domain 404s for at
     * most a minute, and a removed tenant keeps serving for at most a minute.
     *
     * The boundary test below pins `>` rather than `>=` — at exactly t0+60 000 the entry is
     * already stale. That single character is the difference between "60 s" and "60 s plus
     * however long the clock sits on the boundary", and no wire probe can see it.
     */
    it("serves a repeat host from cache without a second query", async () => {
        ddbSend.mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();
        await isWiredTenantHost("dental-pros.com");
        await isWiredTenantHost("dental-pros.com");
        expect(ddbSend).toHaveBeenCalledTimes(1);
    });

    it("still serves from cache at 59 999 ms", async () => {
        ddbSend.mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();
        await isWiredTenantHost("dental-pros.com");
        vi.setSystemTime(T0.getTime() + 59_999);
        await isWiredTenantHost("dental-pros.com");
        expect(ddbSend).toHaveBeenCalledTimes(1);
    });

    it("re-reads at exactly 60 000 ms (expiry is strict `>`, not `>=`)", async () => {
        ddbSend.mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();
        await isWiredTenantHost("dental-pros.com");
        vi.setSystemTime(T0.getTime() + 60_000);
        await isWiredTenantHost("dental-pros.com");
        expect(ddbSend).toHaveBeenCalledTimes(2);
    });

    it("lets a newly wired domain flip false → true after the TTL", async () => {
        ddbSend.mockResolvedValueOnce(count(0)).mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();

        await expect(isWiredTenantHost("just-bought.com")).resolves.toBe(false);
        vi.setSystemTime(T0.getTime() + 30_000);
        await expect(isWiredTenantHost("just-bought.com")).resolves.toBe(false); // still cached
        vi.setSystemTime(T0.getTime() + 60_001);
        await expect(isWiredTenantHost("just-bought.com")).resolves.toBe(true);
    });

    it("caches negatives too — a 404 storm costs one query per host per minute", async () => {
        ddbSend.mockResolvedValue(count(0));
        const { isWiredTenantHost } = await loadModule();
        for (let i = 0; i < 5; i++) await isWiredTenantHost("scanner-target.example");
        expect(ddbSend).toHaveBeenCalledTimes(1);
    });

    it("keys the cache per host — one host's verdict never answers another's", async () => {
        ddbSend.mockResolvedValueOnce(count(1)).mockResolvedValueOnce(count(0));
        const { isWiredTenantHost } = await loadModule();
        await expect(isWiredTenantHost("wired.example")).resolves.toBe(true);
        await expect(isWiredTenantHost("unwired.example")).resolves.toBe(false);
        expect(ddbSend).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------------------

describe("isWiredTenantHost — 512-entry bound (memory-exhaustion defence)", () => {
    /**
     * INVARIANT: cache keys come from the attacker-controlled `Host` header, so the map is
     * hard-bounded. At 512 entries the strategy is drop-everything-and-re-learn, NOT LRU —
     * with ≤99 real tenants, anything past the bound is junk and a full clear is both
     * cheaper and simpler than eviction bookkeeping. The cost is that the ~99 legitimate
     * hosts re-read once after a flood; the benefit is a flat memory ceiling.
     *
     * A wire probe would need 513 distinct Host headers against a live server to reach
     * this; here it is a loop.
     */
    const MAX_ENTRIES = 512;

    it("holds 512 distinct hosts without evicting any of them", async () => {
        ddbSend.mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();
        for (let i = 0; i < MAX_ENTRIES; i++) await isWiredTenantHost(`h${i}.example`);
        expect(ddbSend).toHaveBeenCalledTimes(MAX_ENTRIES);

        // Positive control for the assertion below: while under the bound, a repeat host
        // is answered from cache. So a later re-query really means eviction happened.
        await isWiredTenantHost("h0.example");
        expect(ddbSend).toHaveBeenCalledTimes(MAX_ENTRIES);
    });

    it("clears the whole cache on the 513th distinct host", async () => {
        ddbSend.mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();
        for (let i = 0; i < MAX_ENTRIES; i++) await isWiredTenantHost(`h${i}.example`);
        ddbSend.mockClear();

        await isWiredTenantHost("overflow.example");   // triggers cache.clear() then stores
        expect(ddbSend).toHaveBeenCalledTimes(1);

        // Everything learned before the flush is gone — including h0, which the previous
        // test proved was still cached at 512 entries.
        await isWiredTenantHost("h0.example");
        expect(ddbSend).toHaveBeenCalledTimes(2);

        // ...and the host that caused the flush IS retained, so a flood does not
        // permanently disable caching.
        await isWiredTenantHost("overflow.example");
        expect(ddbSend).toHaveBeenCalledTimes(2);
    });

    it("bounds by distinct host, not by request volume", async () => {
        ddbSend.mockResolvedValue(count(1));
        const { isWiredTenantHost } = await loadModule();
        for (let i = 0; i < 2000; i++) await isWiredTenantHost("dental-pros.com");
        expect(ddbSend).toHaveBeenCalledTimes(1);
    });
});
