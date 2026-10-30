import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * SERVICE-ACCOUNT-1 — GET /service-keys, POST /service-keys, POST /service-keys/{id}/revoke.
 *
 * The real repository (backend/src/lib/service-keys.ts) runs; only `db.js` (its `send`) and `events.js`
 * (`publishAudit`) are mocked. `@aws-sdk/lib-dynamodb` command classes stay real (they only hold `input`),
 * so each row inspects exactly what would be sent to DynamoDB. Credential-free.
 */

const { ddbSend, mockAudit } = vi.hoisted(() => ({ ddbSend: vi.fn(), mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));

import { handler as createKey } from "../../src/service-keys/create.js";
import { handler as listKeys } from "../../src/service-keys/list.js";
import { handler as revokeKey } from "../../src/service-keys/revoke.js";

type Ctx = { sub: string; role: string; tenantId: string; email?: string };
const TENANT_ADMIN_T1: Ctx = { sub: "u2", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const EDITOR_T1: Ctx = { sub: "u1", email: "editor@t1.test", role: "EDITOR", tenantId: "t1" };
const GLOBAL_ADMIN: Ctx = { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" };

function event(ctx: Ctx, header: string | undefined, extra: object = {}) {
    return {
        headers: header === undefined ? {} : { "x-tenant-id": header },
        requestContext: { authorizer: { lambda: ctx }, http: { sourceIp: "127.0.0.1" } },
        ...extra,
    } as any;
}
const call = async (h: any, e: any) => (await h(e, {} as any, () => {})) as any;
const createBody = (body: unknown) => ({ body: JSON.stringify(body) });
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(() => {
    ddbSend.mockReset();
    ddbSend.mockResolvedValue({});
    mockAudit.mockReset();
    mockAudit.mockResolvedValue(undefined);
});

describe("SERVICE-ACCOUNT-1 — POST /service-keys", () => {
    const VALID = { name: "glamCRM sync", scopes: ["catalog:read", "leads:read"] };

    it("TENANT_ADMIN of t1 → 201, secret 'amx_sk_' + 43 base64url chars, view without keyHash", async () => {
        const res = await call(createKey, event(TENANT_ADMIN_T1, "t1", createBody(VALID)));
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.secret).toMatch(/^amx_sk_[A-Za-z0-9_-]{43}$/);
        expect(body.key).toEqual({
            id: expect.any(String),
            tenantId: "t1",
            name: "glamCRM sync",
            scopes: ["catalog:read", "leads:read"],
            createdBy: "admin@t1.test",
            createdAt: expect.any(String),
            lastUsedAt: null,
            revokedAt: null,
        });
        expect(res.body).not.toContain("keyHash");
        expect(res.body).not.toContain(sha256(body.secret));
    });

    it("stored key item carries sha256(secret) hex and not the secret; lookup item keyed by the hash; one transaction", async () => {
        const res = await call(createKey, event(TENANT_ADMIN_T1, "t1", createBody(VALID)));
        const { secret, key } = JSON.parse(res.body);
        const hash = sha256(secret);

        expect(ddbSend).toHaveBeenCalledTimes(1);
        const cmd = ddbSend.mock.calls[0][0];
        expect(cmd).toBeInstanceOf(TransactWriteCommand);
        const [keyPut, lookupPut] = cmd.input.TransactItems.map((t: any) => t.Put);

        expect(keyPut.Item).toMatchObject({ PK: "TENANT#t1", SK: `SVCKEY#${key.id}`, keyHash: hash, revokedAt: null, Type: "ServiceKey" });
        expect(keyPut.ConditionExpression).toBe("attribute_not_exists(PK)");
        expect(lookupPut.Item).toEqual({
            PK: `SVCKEYHASH#${hash}`, SK: `SVCKEYHASH#${hash}`,
            tenantId: "t1", keyId: key.id, name: "glamCRM sync", scopes: ["catalog:read", "leads:read"], lastUsedDay: null,
        });
        expect(lookupPut.ConditionExpression).toBe("attribute_not_exists(PK)");
        expect(JSON.stringify(cmd.input)).not.toContain(secret);
    });

    it("EDITOR → 403, no write", async () => {
        const res = await call(createKey, event(EDITOR_T1, "t1", createBody(VALID)));
        expect(res.statusCode).toBe(403);
        expect(ddbSend).not.toHaveBeenCalled();
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it("TENANT_ADMIN of t1 with header t2 → 403, no write", async () => {
        const res = await call(createKey, event(TENANT_ADMIN_T1, "t2", createBody(VALID)));
        expect(res.statusCode).toBe(403);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("GLOBAL_ADMIN → 201", async () => {
        const res = await call(createKey, event(GLOBAL_ADMIN, "t2", createBody(VALID)));
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).key.tenantId).toBe("t2");
    });

    it.each([
        // `leads:write` was dropped from the scope set (no consumer). `catalog:write` was the witness here until
        // CAT-IMPORT-1 added it to ServiceKeyScope with its route.
        ["unknown scope → 400", { name: "x", scopes: ["leads:write"] }],
        ["empty scopes → 400", { name: "x", scopes: [] }],
        ["empty name → 400", { name: "   ", scopes: ["leads:read"] }],
        ["repeated scope → 400", { name: "x", scopes: ["leads:read", "leads:read"] }],
    ])("%s", async (_n, body) => {
        const res = await call(createKey, event(TENANT_ADMIN_T1, "t1", createBody(body)));
        expect(res.statusCode).toBe(400);
        expect(typeof JSON.parse(res.body).error).toBe("string");
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("audit SERVICE_KEY_CREATED published once", async () => {
        const res = await call(createKey, event(TENANT_ADMIN_T1, "t1", createBody(VALID)));
        const { key, secret } = JSON.parse(res.body);
        expect(mockAudit).toHaveBeenCalledTimes(1);
        expect(mockAudit.mock.calls[0][0]).toMatchObject({
            tenantId: "t1",
            actor: { id: "u2", email: "admin@t1.test" },
            action: "SERVICE_KEY_CREATED",
            target: { id: key.id, title: "glamCRM sync" },
            details: { scopes: ["catalog:read", "leads:read"] },
        });
        expect(JSON.stringify(mockAudit.mock.calls)).not.toContain(secret);
    });
});

describe("SERVICE-ACCOUNT-1 — GET /service-keys", () => {
    it("views carry no keyHash; revoked keys included", async () => {
        // Even if DynamoDB returned the hash, the view would not carry it.
        ddbSend.mockResolvedValue({
            Items: [
                { id: "k1", tenantId: "t1", name: "old", scopes: ["leads:read"], createdBy: "a", createdAt: "2026-10-01T00:00:00.000Z", lastUsedAt: null, revokedAt: "2026-10-02T00:00:00.000Z", keyHash: "h1" },
                { id: "k2", tenantId: "t1", name: "new", scopes: ["catalog:read"], createdBy: "a", createdAt: "2026-10-20T00:00:00.000Z", lastUsedAt: null, revokedAt: null, keyHash: "h2" },
            ],
        });
        const res = await call(listKeys, event(TENANT_ADMIN_T1, "t1"));
        expect(res.statusCode).toBe(200);
        const { items } = JSON.parse(res.body);
        expect(items.map((k: any) => k.id)).toEqual(["k2", "k1"]); // newest first, revoked included
        expect(items[1].revokedAt).toBe("2026-10-02T00:00:00.000Z");
        expect(res.body).not.toContain("keyHash");

        const cmd = ddbSend.mock.calls[0][0];
        expect(cmd).toBeInstanceOf(QueryCommand);
        expect(cmd.input.ExpressionAttributeValues).toEqual({ ":pk": "TENANT#t1", ":sk": "SVCKEY#" });
        expect(cmd.input.ProjectionExpression).not.toContain("keyHash");
    });

    it("follows LastEvaluatedKey: two pages (active + revoked) combined, same key condition and projection, sorted globally", async () => {
        const page1 = { Items: [{ id: "k1", tenantId: "t1", name: "old-active", scopes: ["leads:read"], createdBy: "a", createdAt: "2026-10-01T00:00:00.000Z", lastUsedAt: null, revokedAt: null }],
            LastEvaluatedKey: { PK: "TENANT#t1", SK: "SVCKEY#k1" } };
        const page2 = { Items: [
            { id: "k2", tenantId: "t1", name: "newest-revoked", scopes: ["catalog:read"], createdBy: "a", createdAt: "2026-10-25T00:00:00.000Z", lastUsedAt: null, revokedAt: "2026-10-26T00:00:00.000Z" },
            { id: "k3", tenantId: "t1", name: "mid-active", scopes: ["catalog:read"], createdBy: "a", createdAt: "2026-10-10T00:00:00.000Z", lastUsedAt: null, revokedAt: null },
        ] };
        ddbSend.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

        const res = await call(listKeys, event(TENANT_ADMIN_T1, "t1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).items.map((k: any) => k.id)).toEqual(["k2", "k3", "k1"]);

        expect(ddbSend).toHaveBeenCalledTimes(2);
        const [q1, q2] = ddbSend.mock.calls.map((c) => c[0].input);
        expect(q1.ExclusiveStartKey).toBeUndefined();
        expect(q2.ExclusiveStartKey).toEqual({ PK: "TENANT#t1", SK: "SVCKEY#k1" });
        for (const k of ["KeyConditionExpression", "ExpressionAttributeValues", "ExpressionAttributeNames", "ProjectionExpression"]) {
            expect(q2[k]).toEqual(q1[k]);
        }
    });

    it("EDITOR → 403", async () => {
        const res = await call(listKeys, event(EDITOR_T1, "t1"));
        expect(res.statusCode).toBe(403);
        expect(ddbSend).not.toHaveBeenCalled();
    });
});

describe("SERVICE-ACCOUNT-1 — POST /service-keys/{id}/revoke", () => {
    const ACTIVE = { PK: "TENANT#t1", SK: "SVCKEY#k1", id: "k1", tenantId: "t1", name: "glamCRM sync", scopes: ["leads:read"], createdBy: "a", createdAt: "2026-10-20T00:00:00.000Z", lastUsedAt: null, revokedAt: null, keyHash: "h1" };
    const revokeEvent = (ctx: Ctx = TENANT_ADMIN_T1) => event(ctx, "t1", { pathParameters: { id: "k1" } });

    it("existing active key → 200 with revokedAt; one transaction: key item updated, lookup item deleted", async () => {
        ddbSend.mockImplementation(async (cmd: any) => (cmd instanceof GetCommand ? { Item: ACTIVE } : {}));
        const res = await call(revokeKey, revokeEvent());
        expect(res.statusCode).toBe(200);
        const { key } = JSON.parse(res.body);
        expect(key.revokedAt).toEqual(expect.any(String));
        expect(res.body).not.toContain("keyHash");

        const get = ddbSend.mock.calls[0][0];
        expect(get).toBeInstanceOf(GetCommand);
        expect(get.input.Key).toEqual({ PK: "TENANT#t1", SK: "SVCKEY#k1" });

        const tx = ddbSend.mock.calls.map((c) => c[0]).filter((c) => c instanceof TransactWriteCommand);
        expect(tx).toHaveLength(1);
        const [update, del] = tx[0].input.TransactItems;
        expect(update.Update.Key).toEqual({ PK: "TENANT#t1", SK: "SVCKEY#k1" });
        expect(update.Update.UpdateExpression).toBe("SET revokedAt = :now");
        expect(update.Update.ConditionExpression).toContain("attribute_exists(PK)");
        expect(del.Delete.Key).toEqual({ PK: "SVCKEYHASH#h1", SK: "SVCKEYHASH#h1" });
    });

    it("unknown id → 404", async () => {
        ddbSend.mockResolvedValue({});
        const res = await call(revokeKey, revokeEvent());
        expect(res.statusCode).toBe(404);
        expect(ddbSend.mock.calls.some((c) => c[0] instanceof TransactWriteCommand)).toBe(false);
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it("already revoked → 404", async () => {
        ddbSend.mockImplementation(async (cmd: any) =>
            cmd instanceof GetCommand ? { Item: { ...ACTIVE, revokedAt: "2026-10-21T00:00:00.000Z" } } : {});
        const res = await call(revokeKey, revokeEvent());
        expect(res.statusCode).toBe(404);
        expect(ddbSend.mock.calls.some((c) => c[0] instanceof TransactWriteCommand)).toBe(false);
    });

    it("concurrent revoke (key-item condition failed) → 404", async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
            if (cmd instanceof GetCommand) return { Item: ACTIVE };
            throw Object.assign(new Error("Transaction cancelled"), {
                name: "TransactionCanceledException",
                CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
            });
        });
        const res = await call(revokeKey, revokeEvent());
        expect(res.statusCode).toBe(404);
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it("EDITOR → 403, no DynamoDB call", async () => {
        const res = await call(revokeKey, revokeEvent(EDITOR_T1));
        expect(res.statusCode).toBe(403);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("audit SERVICE_KEY_REVOKED published once", async () => {
        ddbSend.mockImplementation(async (cmd: any) => (cmd instanceof GetCommand ? { Item: ACTIVE } : {}));
        await call(revokeKey, revokeEvent());
        expect(mockAudit).toHaveBeenCalledTimes(1);
        expect(mockAudit.mock.calls[0][0]).toMatchObject({
            tenantId: "t1",
            actor: { id: "u2", email: "admin@t1.test" },
            action: "SERVICE_KEY_REVOKED",
            target: { id: "k1", title: "glamCRM sync" },
        });
    });
});
