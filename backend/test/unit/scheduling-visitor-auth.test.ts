import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

/**
 * SCHED-1D2 row D2, the part before any handler (docs/slices/sched-1.md § 10.2, § 16.3: "No backend route becomes
 * anonymous"): the REAL authorizer on the visitor route keys. A request with no credential is refused by the
 * authorizer, so no visitor handler runs; the renderer key resolves to `RENDERER` / `tenantId: "ALL"` (G11), which
 * the visitor frame admits (scheduling-visitor.test.ts, D2).
 * The HTTP status API Gateway answers for a refused simple-response authorizer is the gateway's (staging check);
 * § 17.3 D2 writes 401.
 *
 * Pattern of service-key-authorizer.test.ts: hoisted mocks + vi.resetModules() + dynamic import (the authorizer reads
 * env vars and builds verifiers at module scope). Mocked: the Cognito verifier (rejects every token), Secrets Manager
 * (master and renderer keys), `db.js`, `events.js`.
 */

const { mockAdminVerify } = vi.hoisted(() => ({ mockAdminVerify: vi.fn() }));

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
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));

const VISITOR_ROUTES = [
    "GET /scheduling/visitor/offer",
    "GET /scheduling/visitor/slots",
    "GET /scheduling/visitor/courses/{courseId}/runs",
    "POST /scheduling/visitor/holds",
    "POST /scheduling/visitor/bookings/view",
    "POST /scheduling/visitor/bookings/confirm",
    "POST /scheduling/visitor/bookings/cancel",
    "POST /scheduling/visitor/bookings/move",
];

const authEvent = (routeKey: string, headers: Record<string, string>): any => ({
    headers: { "x-tenant-id": "t1", ...headers }, routeKey, requestContext: { http: { sourceIp: "127.0.0.1" } },
});

let handler: (e: any) => Promise<any>;

beforeAll(async () => {
    process.env.USER_POOL_ID = "admin-pool-id";
    process.env.USER_POOL_CLIENT_ID = "admin-client-id";
    process.env.MASTER_KEY_SECRET_NAME = "master-secret";
    process.env.RENDERER_KEY_SECRET_NAME = "renderer-secret";
    delete process.env.PUBLIC_POOL_ID;
    delete process.env.PUBLIC_POOL_CLIENT_ID;
    vi.resetModules();
    handler = (await import("../../src/auth/authorizer.js")).handler as any;
});
afterAll(() => vi.resetModules());
beforeEach(() => {
    mockAdminVerify.mockReset();
    mockAdminVerify.mockRejectedValue(new Error("invalid token"));
});

describe("D2 the authorizer on the visitor routes", () => {
    it.each(VISITOR_ROUTES)("D2 %s with no credential → refused by the authorizer (no handler runs)", async (route) => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const res = await handler(authEvent(route, {}));
        expect(res.isAuthorized).toBe(false);
        log.mockRestore();
    });

    it.each(VISITOR_ROUTES)("D2 %s with a wrong key and no token → refused", async (route) => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const res = await handler(authEvent(route, { "x-api-key": "not-the-key" }));
        expect(res.isAuthorized).toBe(false);
        log.mockRestore();
        warn.mockRestore();
    });

    it.each(VISITOR_ROUTES)("D2 %s with the renderer key → RENDERER, tenantId ALL (the tenant comes from x-tenant-id)", async (route) => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const res = await handler(authEvent(route, { "x-api-key": "renderer-key" }));
        expect(res).toEqual({ isAuthorized: true, context: { sub: "renderer", role: "RENDERER", tenantId: "ALL" } });
        log.mockRestore();
    });
});
