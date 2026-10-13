import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * CACHE-10 — `revalidateTenantPaths()` purges Layer 2 (S3, via the renderer) BEFORE it enqueues
 * Layer 1 (the CloudFront fast lane), and Layer 1 still fires when Layer 2 fails or is disabled.
 *
 * Why the order matters: CloudFront refills from S3. If the edge is invalidated first and a
 * request lands before the renderer has deleted the S3 objects, the edge re-caches the stale
 * page for a year (`s-maxage=31536000`). See the comment in `src/lib/revalidate.ts`.
 *
 * CACHE-10 listing ruling (human, 2026-10-13): after the fast lane, an ordinary edit ALSO writes
 * the bulk-lane marker `SYSTEM#CDN_PENDING` (via the REAL `markCdnPending()`), so dependent
 * listings refresh at the edge with ONE `/*` (due ≤15 min after the first pending change). Order: S3 purge → fast
 * lane → CDN_PENDING. A marker-write failure must not fail the save.
 *
 * Credential-free: `db.js` and Secrets Manager are mocked; in `invalidate-cdn.js` ONLY
 * `enqueueEdgeInvalidation` is replaced — `markCdnPending` is the real function writing through
 * the mocked `db`, so the swallow-on-failure test exercises production code. `fetch` is stubbed.
 * The module reads RENDERER_URL / REVALIDATION_SECRET_NAME at import, so each test re-imports it.
 */

const { ddbSend, enqueueSpy } = vi.hoisted(() => ({ ddbSend: vi.fn(), enqueueSpy: vi.fn() }));

vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/invalidate-cdn.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/lib/invalidate-cdn.js")>()),
    enqueueEdgeInvalidation: enqueueSpy,
}));
vi.mock("@aws-sdk/client-secrets-manager", () => ({
    SecretsManagerClient: class {
        send = async () => ({ SecretString: "s3cret" });
    },
    GetSecretValueCommand: class {
        constructor(public input: any) {}
    },
}));

const fetchSpy = vi.fn();

async function load(rendererUrl: string | undefined) {
    vi.resetModules();
    if (rendererUrl) process.env.RENDERER_URL = rendererUrl;
    else delete process.env.RENDERER_URL;
    process.env.REVALIDATION_SECRET_NAME = "revalidation-secret";
    return (await import("../../src/lib/revalidate.js")).revalidateTenantPaths;
}

beforeEach(() => {
    ddbSend.mockReset();
    ddbSend.mockResolvedValue({ Item: { domain: "acme.test" } }); // tenant routing GetItem; Puts ignore it
    enqueueSpy.mockReset();
    enqueueSpy.mockResolvedValue(undefined);
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ revalidated: true, purged: 3 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
});

describe("CACHE-10 revalidateTenantPaths ordering", () => {
    it("calls the renderer purge for every target BEFORE enqueueing the edge fast lane", async () => {
        const revalidateTenantPaths = await load("https://renderer.test");

        await revalidateTenantPaths("t1", "page", ["/new", "/old"]);

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(enqueueSpy).toHaveBeenCalledWith(["/new", "/old"]);
        const lastFetch = Math.max(...fetchSpy.mock.invocationCallOrder);
        expect(lastFetch).toBeLessThan(enqueueSpy.mock.invocationCallOrder[0]);
        // the renderer call is bounded, so a hung renderer cannot starve Layer 1
        expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it("still enqueues the edge fast lane when the renderer call fails (e.g. timeout abort)", async () => {
        fetchSpy.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
        const revalidateTenantPaths = await load("https://renderer.test");

        await revalidateTenantPaths("t1", "page", ["/about"]);

        expect(enqueueSpy).toHaveBeenCalledWith(["/about"]);
    });

    it("still enqueues the edge fast lane when the renderer answers 500 (purge failed)", async () => {
        fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: "ISR S3 purge failed" }), { status: 500 }));
        const revalidateTenantPaths = await load("https://renderer.test");

        await revalidateTenantPaths("t1", "page", ["/about"]);

        expect(enqueueSpy).toHaveBeenCalledWith(["/about"]);
    });

    it("renderer not configured → no renderer call, edge fast lane still enqueued (cache-4a contract)", async () => {
        const revalidateTenantPaths = await load(undefined);

        await revalidateTenantPaths("t1", "page", ["/about"]);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(enqueueSpy).toHaveBeenCalledWith(["/about"]);
    });
});

/** `db.send` calls that wrote the bulk-lane marker `SYSTEM#CDN_PENDING` (an UpdateCommand since CACHE-10's max wait). */
function pendingMarkerCalls(): number[] {
    return ddbSend.mock.calls
        .map((c, i) => ({ input: c[0]?.input, order: ddbSend.mock.invocationCallOrder[i] }))
        .filter(({ input }) => input?.Key?.PK === "SYSTEM" && input?.Key?.SK === "CDN_PENDING")
        .map(({ order }) => order);
}

describe("CACHE-10 listing freshness — ordinary edit arms the bulk `/*` debounce lane", () => {
    it("(a) writes CDN_PENDING in addition to the fast-lane enqueue — once per call, not per slug", async () => {
        const revalidateTenantPaths = await load("https://renderer.test");

        await revalidateTenantPaths("t1", "page", ["/new", "/old"]);

        expect(enqueueSpy).toHaveBeenCalledWith(["/new", "/old"]);
        expect(pendingMarkerCalls()).toHaveLength(1);
    });

    it("(b) a CDN_PENDING write failure is swallowed — the save does not fail", async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
            if (cmd?.input?.Key?.SK === "CDN_PENDING" && cmd?.input?.UpdateExpression) throw new Error("ProvisionedThroughputExceeded");
            return { Item: { domain: "acme.test" } };
        });
        const revalidateTenantPaths = await load("https://renderer.test");

        await expect(revalidateTenantPaths("t1", "page", ["/about"])).resolves.toBeUndefined();
        expect(pendingMarkerCalls()).toHaveLength(1); // it WAS attempted
        expect(enqueueSpy).toHaveBeenCalledWith(["/about"]); // and the fast lane was unaffected
    });

    it("(c) order is S3 purge (renderer) → edge fast lane → CDN_PENDING", async () => {
        const revalidateTenantPaths = await load("https://renderer.test");

        await revalidateTenantPaths("t1", "page", ["/about"]);

        const purge = fetchSpy.mock.invocationCallOrder[0];
        const fast = enqueueSpy.mock.invocationCallOrder[0];
        const [pending] = pendingMarkerCalls();
        expect(purge).toBeLessThan(fast);
        expect(fast).toBeLessThan(pending);
    });

    it("renderer not configured → CDN_PENDING still written (listings' edge copy still needs `/*`)", async () => {
        const revalidateTenantPaths = await load(undefined);

        await revalidateTenantPaths("t1", "page", ["/about"]);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(pendingMarkerCalls()).toHaveLength(1);
    });

    it("tenant has no domain → nothing addressable: no fast lane, no CDN_PENDING", async () => {
        ddbSend.mockResolvedValue({ Item: {} });
        const revalidateTenantPaths = await load("https://renderer.test");

        await revalidateTenantPaths("t1", "page", ["/about"]);

        expect(enqueueSpy).not.toHaveBeenCalled();
        expect(pendingMarkerCalls()).toHaveLength(0);
    });
});
