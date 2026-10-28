import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { createHash } from "node:crypto";

/**
 * SERVICE-ACCOUNT-1 — the authorizer's third branch (`x-api-key: amx_sk_…`).
 *
 * Pattern copied from backend/test/auth-authorizer.test.ts: hoisted mocks + vi.resetModules() + dynamic import,
 * because the authorizer reads env vars and builds verifiers at module scope. Mocked: Cognito verifiers,
 * Secrets Manager (master key / renderer key by SecretId), the repository's two DynamoDB functions
 * (`findServiceKeyByHash`, `touchServiceKey`), `publishAudit`, and `db.js`. The prefix constant and the hash
 * function stay REAL, so the "lookup key = sha256(secret)" row checks the production hashing against an
 * independent sha256 computed here.
 */

const { mockAdminVerify, mockFind, mockTouch, mockAudit } = vi.hoisted(() => ({
    mockAdminVerify: vi.fn(),
    mockFind: vi.fn(),
    mockTouch: vi.fn(),
    mockAudit: vi.fn(),
}));

vi.mock("aws-jwt-verify", () => ({
    CognitoJwtVerifier: { create: vi.fn(() => ({ verify: mockAdminVerify })) },
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
    SecretsManagerClient: class {
        send = vi.fn(async (cmd: any) => ({
            SecretString: JSON.stringify({ apiKey: cmd.input.SecretId === "renderer-secret" ? "renderer-key" : "master-key" }),
        }));
    },
    GetSecretValueCommand: class {
        constructor(public readonly input: any) {}
    },
}));

vi.mock("../../src/lib/db.js", () => ({ db: { send: vi.fn() }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/service-keys.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/lib/service-keys.js")>()),
    findServiceKeyByHash: mockFind,
    touchServiceKey: mockTouch,
}));

const SECRET = "amx_sk_" + "A".repeat(43);
const SECRET_HASH = createHash("sha256").update(SECRET).digest("hex");
const TODAY = "2026-10-28";
const RECORD = { tenantId: "t1", keyId: "k1", name: "glamCRM sync", scopes: ["catalog:read", "leads:read"], lastUsedDay: "2026-10-27" };

/** `tenantHeader`: the request's x-tenant-id; defaults to the key's tenant "t1"; `null` sends no header. */
function authEvent(opts: { apiKey?: string; authorization?: string; routeKey?: string; tenantHeader?: string | null }): any {
    const tenantHeader = opts.tenantHeader === undefined ? "t1" : opts.tenantHeader;
    return {
        headers: {
            ...(opts.apiKey ? { "x-api-key": opts.apiKey } : {}),
            ...(opts.authorization ? { authorization: opts.authorization } : {}),
            ...(tenantHeader !== null ? { "x-tenant-id": tenantHeader } : {}),
        },
        routeKey: opts.routeKey ?? "GET /products",
        requestContext: { http: { sourceIp: "127.0.0.1" } },
    };
}

let handler: (e: any) => Promise<any>;

beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
    process.env.USER_POOL_ID = "admin-pool-id";
    process.env.USER_POOL_CLIENT_ID = "admin-client-id";
    process.env.MASTER_KEY_SECRET_NAME = "master-secret";
    process.env.RENDERER_KEY_SECRET_NAME = "renderer-secret";
    delete process.env.PUBLIC_POOL_ID;
    delete process.env.PUBLIC_POOL_CLIENT_ID;
    vi.resetModules();
    handler = (await import("../../src/auth/authorizer.js")).handler as any;
});

afterAll(() => {
    vi.useRealTimers();
});

beforeEach(() => {
    mockFind.mockReset();
    mockTouch.mockReset();
    mockAudit.mockReset();
    mockAdminVerify.mockReset();
    mockAdminVerify.mockRejectedValue(new Error("invalid token"));
    mockTouch.mockResolvedValue(undefined);
    mockAudit.mockResolvedValue(undefined);
});

describe("SERVICE-ACCOUNT-1 — authorizer service-key branch", () => {
    it("amx_sk_ key found → authorised: role 'SERVICE' literal, tenantId from the record, scopes comma-joined, sub 'service:<keyId>'", async () => {
        mockFind.mockResolvedValue(RECORD);
        const res = await handler(authEvent({ apiKey: SECRET, authorization: "Bearer service" }));
        expect(res).toEqual({
            isAuthorized: true,
            context: { sub: "service:k1", role: "SERVICE", tenantId: "t1", scopes: "catalog:read,leads:read", keyId: "k1" },
        });
        expect(mockAdminVerify).not.toHaveBeenCalled(); // resolved on the key, the token is never read
    });

    it("amx_sk_ key found → the lookup is called with sha256(secret) hex, never the secret", async () => {
        mockFind.mockResolvedValue(RECORD);
        await handler(authEvent({ apiKey: SECRET, authorization: "Bearer service" }));
        expect(mockFind).toHaveBeenCalledTimes(1);
        expect(mockFind).toHaveBeenCalledWith(SECRET_HASH);
        expect(SECRET_HASH).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(mockFind.mock.calls)).not.toContain(SECRET);
        expect(JSON.stringify(mockTouch.mock.calls)).not.toContain(SECRET);
    });

    it("unknown or revoked amx_sk_ key → denied", async () => {
        mockFind.mockResolvedValue(null);
        const res = await handler(authEvent({ apiKey: SECRET, authorization: "Bearer service" }));
        expect(res.isAuthorized).toBe(false);
        expect(mockTouch).not.toHaveBeenCalled();
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it("unknown amx_sk_ key on 'POST /leads' → denied (does not become anonymous)", async () => {
        mockFind.mockResolvedValue(null);
        const res = await handler(authEvent({ apiKey: SECRET, authorization: "Bearer service", routeKey: "POST /leads" }));
        expect(res.isAuthorized).toBe(false);
        expect(res.context?.sub).not.toBe("anonymous");
    });

    it("amx_sk_ key found with lastUsedDay ≠ today → touch + SERVICE_KEY_USED audit once", async () => {
        mockFind.mockResolvedValue(RECORD);
        const res = await handler(authEvent({ apiKey: SECRET, authorization: "Bearer service" }));
        expect(res.isAuthorized).toBe(true);
        expect(mockTouch).toHaveBeenCalledTimes(1);
        expect(mockTouch).toHaveBeenCalledWith("t1", "k1", SECRET_HASH, TODAY);
        expect(mockAudit).toHaveBeenCalledTimes(1);
        expect(mockAudit).toHaveBeenCalledWith({
            tenantId: "t1",
            actor: { id: "service:k1" },
            action: "SERVICE_KEY_USED",
            target: { id: "k1", title: "glamCRM sync" },
        });
    });

    it("amx_sk_ key found with lastUsedDay = today → neither touch nor audit", async () => {
        mockFind.mockResolvedValue({ ...RECORD, lastUsedDay: TODAY });
        const res = await handler(authEvent({ apiKey: SECRET, authorization: "Bearer service" }));
        expect(res.isAuthorized).toBe(true);
        expect(mockTouch).not.toHaveBeenCalled();
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it("touch failure → still authorised", async () => {
        mockFind.mockResolvedValue(RECORD);
        mockTouch.mockRejectedValue(new Error("ConditionalCheckFailedException"));
        const res = await handler(authEvent({ apiKey: SECRET, authorization: "Bearer service" }));
        expect(res.isAuthorized).toBe(true);
        expect(res.context.role).toBe("SERVICE");
    });

    it("lookup failure → denied (fails closed, no unhandled authorizer error)", async () => {
        mockFind.mockRejectedValue(new Error("ProvisionedThroughputExceededException"));
        const res = await handler(authEvent({ apiKey: SECRET, authorization: "Bearer service" }));
        expect(res.isAuthorized).toBe(false);
    });
});

describe("SERVICE-ACCOUNT-1 — authorizer route allowlist (D-SA-E): a found key reaches only SERVICE_ROUTE_SCOPES", () => {
    const run = (routeKey: string, tenantHeader?: string | null) =>
        handler(authEvent({ apiKey: SECRET, authorization: "Bearer service", routeKey, tenantHeader }));
    // Each refusal names its reason in the log; asserting it pins WHICH check refused (the checks overlap).
    const warned = (reason: string) =>
        warnSpy.mock.calls.some((c) => typeof c[0] === "string" && c[0].includes(reason));
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}); });
    afterEach(() => { warnSpy.mockRestore(); });

    it("found key on 'GET /resources/upload' (not in the table) → denied, no touch, no audit", async () => {
        mockFind.mockResolvedValue(RECORD);
        const res = await run("GET /resources/upload");
        expect(res.isAuthorized).toBe(false);
        expect(warned("route not open to service keys")).toBe(true);
        expect(mockTouch).not.toHaveBeenCalled();
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it("found key on 'GET /products' lacking catalog:read → denied", async () => {
        mockFind.mockResolvedValue({ ...RECORD, scopes: ["leads:read"] });
        const res = await run("GET /products");
        expect(res.isAuthorized).toBe(false);
        expect(warned("lacks scope")).toBe(true);
        expect(mockTouch).not.toHaveBeenCalled();
    });

    it("found key on 'GET /products' with x-tenant-id ≠ key tenant → denied", async () => {
        mockFind.mockResolvedValue(RECORD);
        const res = await run("GET /products", "t2");
        expect(res.isAuthorized).toBe(false);
        expect(warned("bound to another tenant")).toBe(true);
        expect(mockTouch).not.toHaveBeenCalled();
    });

    it("found key on 'GET /products' with no x-tenant-id → denied", async () => {
        mockFind.mockResolvedValue(RECORD);
        const res = await run("GET /products", null);
        expect(res.isAuthorized).toBe(false);
        expect(warned("bound to another tenant")).toBe(true);
    });

    it("found key, 'GET /leads', holding leads:read, matching header → authorised", async () => {
        mockFind.mockResolvedValue({ ...RECORD, scopes: ["leads:read"] });
        const res = await run("GET /leads");
        expect(res.isAuthorized).toBe(true);
        expect(res.context).toMatchObject({ role: "SERVICE", tenantId: "t1", scopes: "leads:read" });
    });

    it("found key on 'POST /public/customers/profile' (authorizer route despite the /public/ prefix) → denied, no touch", async () => {
        mockFind.mockResolvedValue(RECORD);
        const res = await run("POST /public/customers/profile");
        expect(res.isAuthorized).toBe(false);
        expect(warned("route not open to service keys")).toBe(true);
        expect(mockTouch).not.toHaveBeenCalled();
        expect(mockAudit).not.toHaveBeenCalled();
    });

    // Review-0 witnesses: handlers that never call requireRole. The key (both scopes, own tenant AND a
    // foreign header) must be refused by the authorizer, so the handler never runs.
    it.each([
        "POST /resources/upload",
        "POST /themes",
        "GET /themes",
        "DELETE /themes/{id}",
        "GET /comments",
        "GET /tenants",
    ])("review-0 witness: found key with both scopes on '%s' → denied (own and foreign x-tenant-id), no touch", async (routeKey) => {
        mockFind.mockResolvedValue(RECORD);
        expect((await run(routeKey, "t1")).isAuthorized).toBe(false);
        expect((await run(routeKey, "t2")).isAuthorized).toBe(false);
        expect(warned("route not open to service keys")).toBe(true);
        expect(mockTouch).not.toHaveBeenCalled();
        expect(mockAudit).not.toHaveBeenCalled();
    });
});

describe("SERVICE-ACCOUNT-1 — master / renderer / wrong-key behaviour as before", () => {
    it("master key → GLOBAL_ADMIN exactly as before", async () => {
        const res = await handler(authEvent({ apiKey: "master-key", authorization: "Bearer robot" }));
        expect(res).toEqual({ isAuthorized: true, context: { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" } });
        expect(mockFind).not.toHaveBeenCalled();
    });

    it("renderer key → RENDERER as before", async () => {
        const res = await handler(authEvent({ apiKey: "renderer-key", authorization: "Bearer robot" }));
        expect(res).toEqual({ isAuthorized: true, context: { sub: "renderer", role: "RENDERER", tenantId: "ALL" } });
        expect(mockFind).not.toHaveBeenCalled();
    });

    it("wrong non-prefixed key + no token → denied as before", async () => {
        const res = await handler(authEvent({ apiKey: "web-client" }));
        expect(res.isAuthorized).toBe(false);
        expect(mockFind).not.toHaveBeenCalled();
    });
});
