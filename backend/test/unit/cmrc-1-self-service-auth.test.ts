import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

/**
 * CMRC-1B (docs/slices/cmrc-1b.md § Proofs; PD-002 "they do NOT accept anonymous or CUSTOMER directly") — the part
 * BEFORE the handler: the REAL authorizer on the two new route keys, and then the real handler with the context the
 * authorizer produced.
 *
 *  - no credential, or a wrong key → the authorizer refuses; no handler runs (the two route keys are not among the
 *    authorizer's anonymous routes);
 *  - the renderer key → `RENDERER`, tenant `ALL` → the handler answers 200;
 *  - a valid ADMIN token (a tenant admin signed in to the admin panel) → the authorizer admits it with its own role,
 *    and the HANDLER answers 403 and reads nothing.
 * The HTTP status the API gateway answers for a refused authorizer is the gateway's (operator's staging check).
 *
 * Pattern of scheduling-visitor-auth.test.ts: hoisted mocks + vi.resetModules() + dynamic import (the authorizer reads
 * environment variables and builds its verifiers at module scope). Mocked: the Cognito verifier, Secrets Manager (the
 * master and the renderer key), `db.js`, `events.js`. Credential-free.
 */

const { mockAdminVerify, dbSend } = vi.hoisted(() => ({ mockAdminVerify: vi.fn(), dbSend: vi.fn() }));

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
vi.mock("../../src/lib/db.js", () => ({ db: { send: dbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));

const ROUTES = [
    ["POST /customer/order-history", "orderHistoryHandler", { orders: [] }],
    ["POST /customer/profile-read", "profileReadHandler", { profile: null }],
] as const;

const authEvent = (routeKey: string, headers: Record<string, string>): any => ({
    headers: { "x-tenant-id": "t1", ...headers }, routeKey, requestContext: { http: { sourceIp: "127.0.0.1" } },
});
/** The handler's event for a request the authorizer admitted with `context`. */
const handlerEvent = (context: unknown): any => ({
    headers: { "x-tenant-id": "t1", "content-type": "application/json" },
    body: JSON.stringify({ email: "ana@example.com" }),
    requestContext: { authorizer: { lambda: context } },
});

let authorizer: (e: any) => Promise<any>;
let handlers: Record<string, (e: any) => Promise<any>>;

beforeAll(async () => {
    process.env.USER_POOL_ID = "admin-pool-id";
    process.env.USER_POOL_CLIENT_ID = "admin-client-id";
    process.env.MASTER_KEY_SECRET_NAME = "master-secret";
    process.env.RENDERER_KEY_SECRET_NAME = "renderer-secret";
    delete process.env.PUBLIC_POOL_ID;
    delete process.env.PUBLIC_POOL_CLIENT_ID;
    vi.resetModules();
    authorizer = (await import("../../src/auth/authorizer.js")).handler as any;
    handlers = (await import("../../src/customers/self-service.js")) as any;
});
afterAll(() => vi.resetModules());
beforeEach(() => {
    mockAdminVerify.mockReset();
    mockAdminVerify.mockRejectedValue(new Error("invalid token"));
    dbSend.mockReset();
    dbSend.mockResolvedValue({});
    for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

describe.each(ROUTES)("CMRC-1B — the authorizer on %s", (route, handlerName, nothingFound) => {
    it("no credential → refused by the authorizer (no handler runs)", async () => {
        expect((await authorizer(authEvent(route, {}))).isAuthorized).toBe(false);
    });

    it("a wrong key, or a key in the place of a token → refused", async () => {
        expect((await authorizer(authEvent(route, { "x-api-key": "not-the-key" }))).isAuthorized).toBe(false);
        expect((await authorizer(authEvent(route, { authorization: "Bearer renderer-key" }))).isAuthorized).toBe(false);
    });

    it("the renderer key → RENDERER, tenant ALL; the handler then answers 200 for the tenant of x-tenant-id", async () => {
        const admitted = await authorizer(authEvent(route, { "x-api-key": "renderer-key" }));
        expect(admitted).toEqual({ isAuthorized: true, context: { sub: "renderer", role: "RENDERER", tenantId: "ALL" } });
        const res = await handlers[handlerName](handlerEvent(admitted.context));
        expect({ status: res.statusCode, body: JSON.parse(res.body) }).toEqual({ status: 200, body: nothingFound });
        expect(dbSend).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(dbSend.mock.calls[0][0].input)).toContain("TENANT#t1");
    });

    it("a valid admin token of the same tenant → admitted by the authorizer with its own role; the HANDLER answers 403 and reads nothing", async () => {
        mockAdminVerify.mockResolvedValue({ sub: "admin-1", email: "admin@example.test", "custom:role": "TENANT_ADMIN", "custom:tenantId": "t1" });
        const admitted = await authorizer(authEvent(route, { authorization: "Bearer a-valid-admin-token" }));
        expect(admitted.isAuthorized).toBe(true);
        expect(admitted.context).toMatchObject({ role: "TENANT_ADMIN", tenantId: "t1" });
        dbSend.mockClear();   // the authorizer itself may read; the claim is about the handler
        const res = await handlers[handlerName](handlerEvent(admitted.context));
        expect({ status: res.statusCode, body: JSON.parse(res.body) }).toEqual({ status: 403, body: { code: "forbidden" } });
        expect(dbSend).not.toHaveBeenCalled();
    });
});
