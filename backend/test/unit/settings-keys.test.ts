import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * SETTINGS-KEYS-1 — PUT /settings: the request body never names the item that is written; the handler does.
 *
 * The real handler (`backend/src/tenant/settings.ts`, `updateHandler`) and the real `requireRole` run; only `db.js`
 * (its `send`) and `events.js` (`publishAudit`) are mocked. `@aws-sdk/lib-dynamodb` command classes stay real (they
 * only hold `input`), so each row inspects exactly what would be sent to DynamoDB. `withInvalidation` also stays real:
 * after a 2xx it writes the two cache markers `SYSTEM/CDN_PENDING` (Update) and `SYSTEM/CDN_LAST_CHANGE` (Put) through
 * the mocked `db`. Credential-free.
 */

const { ddbSend, mockAudit } = vi.hoisted(() => ({ ddbSend: vi.fn(), mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));

import { updateHandler } from "../../src/tenant/settings.js";

type Ctx = { sub: string; role: string; tenantId: string; email?: string };
const TENANT_ADMIN_T1: Ctx = { sub: "u2", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const EDITOR_T1: Ctx = { sub: "u1", email: "editor@t1.test", role: "EDITOR", tenantId: "t1" };

/** The stored tenant record as `tenant/create.ts` writes it (server-owned keys present), plus two secrets. */
const CURRENT = {
    PK: "SYSTEM",
    SK: "TENANT#t1",
    id: "t1",
    domain: "t1.test",
    Domain: "t1.test",
    name: "Tenant One",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "creator-sub",
    recaptcha: { siteKey: "old-site-key", secretKey: "RC_SECRET" },
    integrations: { google: { clientId: "gid", clientSecret: "G_SECRET" } },
};

/** The keys every 200 must write, and nothing else: the caller's own record plus the two cache markers. */
const EXPECTED_WRITES = ["SYSTEM/CDN_LAST_CHANGE", "SYSTEM/CDN_PENDING", "SYSTEM/TENANT#t1"];

function event(ctx: Ctx, body: unknown) {
    return {
        headers: { "x-tenant-id": "t1" },
        requestContext: { authorizer: { lambda: ctx }, http: { sourceIp: "127.0.0.1" } },
        body: JSON.stringify(body),
    } as any;
}
const call = async (e: any) => (await (updateHandler as any)(e, {} as any, () => {})) as any;

const commands = () => ddbSend.mock.calls.map((c) => c[0]);

/** `PK/SK` of every item any write command targets, sorted. Fails on a write command type this file does not know. */
function writtenKeys(): string[] {
    return commands()
        .filter((c) => !(c instanceof GetCommand))
        .map((c) => {
            if (c instanceof PutCommand) return `${c.input.Item!.PK}/${c.input.Item!.SK}`;
            if (c instanceof UpdateCommand || c instanceof DeleteCommand) return `${c.input.Key!.PK}/${c.input.Key!.SK}`;
            throw new Error(`unexpected write command ${c?.constructor?.name}`);
        })
        .sort();
}

/** The one Put that is not the CDN_LAST_CHANGE marker — the settings write. */
function settingsPut(): Record<string, any> {
    const puts = commands().filter((c) => c instanceof PutCommand && c.input.Item!.SK !== "CDN_LAST_CHANGE");
    expect(puts).toHaveLength(1);
    return puts[0].input;
}

function auditDetails(): Record<string, any> {
    expect(mockAudit).toHaveBeenCalledTimes(1);
    return mockAudit.mock.calls[0][0].details;
}

beforeEach(() => {
    ddbSend.mockReset();
    ddbSend.mockImplementation(async (cmd: any) => (cmd instanceof GetCommand ? { Item: structuredClone(CURRENT) } : {}));
    mockAudit.mockReset();
    mockAudit.mockResolvedValue(undefined);
});

describe("SETTINGS-KEYS-1 — PUT /settings binds the written item to the caller's tenant", () => {
    it("(a) TENANT_ADMIN of t1, body SK 'TENANT#t2' → 200, writes SYSTEM/TENANT#t1 only, id t1, audit rejectedFields [SK]", async () => {
        const res = await call(event(TENANT_ADMIN_T1, { SK: "TENANT#t2", name: "x" }));
        expect(res.statusCode).toBe(200);

        const get = commands().find((c) => c instanceof GetCommand)!;
        expect(get.input.Key).toEqual({ PK: "SYSTEM", SK: "TENANT#t1" });

        const put = settingsPut();
        expect(put.Item.PK).toBe("SYSTEM");
        expect(put.Item.SK).toBe("TENANT#t1");
        expect(put.Item.id).toBe("t1");
        expect(put.Item.name).toBe("x");
        expect(put.Item.createdAt).toBe(CURRENT.createdAt);
        expect(put.Item.createdBy).toBe(CURRENT.createdBy);
        expect(writtenKeys()).toEqual(EXPECTED_WRITES);

        expect(auditDetails()).toEqual({ updatedFields: ["name"], rejectedFields: ["SK"] });
    });

    it("(b) body PK 'TENANT#t1' + SK 'PRODUCT#p' + price → 200, writes SYSTEM/TENANT#t1; price is stored only as an ordinary config field (config content is not validated here)", async () => {
        const res = await call(event(TENANT_ADMIN_T1, { PK: "TENANT#t1", SK: "PRODUCT#p", price: "999" }));
        expect(res.statusCode).toBe(200);

        const put = settingsPut();
        expect(put.Item.PK).toBe("SYSTEM");
        expect(put.Item.SK).toBe("TENANT#t1");
        expect(put.Item.id).toBe("t1");
        expect(put.Item.price).toBe("999");
        expect(writtenKeys()).toEqual(EXPECTED_WRITES);

        expect(auditDetails()).toEqual({ updatedFields: ["price"], rejectedFields: ["PK", "SK"] });
    });

    it("(c) body id 't2' → 200, the record keeps id t1, audit rejectedFields [id]", async () => {
        const res = await call(event(TENANT_ADMIN_T1, { id: "t2" }));
        expect(res.statusCode).toBe(200);

        const put = settingsPut();
        expect(put.Item.SK).toBe("TENANT#t1");
        expect(put.Item.id).toBe("t1");
        expect(writtenKeys()).toEqual(EXPECTED_WRITES);

        expect(auditDetails()).toEqual({ updatedFields: [], rejectedFields: ["id"] });
    });

    it("(d) honest partial save → 200, both stored secrets preserved by the deep-merge, no rejectedFields", async () => {
        const res = await call(event(TENANT_ADMIN_T1, { name: "New", recaptcha: { siteKey: "s" } }));
        expect(res.statusCode).toBe(200);

        const put = settingsPut();
        expect(put.Item.SK).toBe("TENANT#t1");
        expect(put.Item.name).toBe("New");
        expect(put.Item.recaptcha).toEqual({ siteKey: "s", secretKey: "RC_SECRET" });
        expect(put.Item.integrations.google.clientSecret).toBe("G_SECRET");
        expect(writtenKeys()).toEqual(EXPECTED_WRITES);

        const details = auditDetails();
        expect(details).toEqual({ updatedFields: ["name", "recaptcha"] });
        expect(details).not.toHaveProperty("rejectedFields");
    });

    it("(e) EDITOR → 403, no DynamoDB call, no audit", async () => {
        const res = await call(event(EDITOR_T1, { SK: "TENANT#t2", name: "x" }));
        expect(res.statusCode).toBe(403);
        expect(ddbSend).not.toHaveBeenCalled();
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it("(f) admin Settings.tsx echo (whole GET /settings record sent back, secrets absent) → 200, own record saved with stored keys and secrets; audit lists the echoed server-owned names as rejectedFields", async () => {
        // admin/src/pages/Settings.tsx: load() keeps the full GET /settings response; save() PUTs it back whole.
        const { recaptcha, integrations, ...rest } = structuredClone(CURRENT);
        const echoed = {
            ...rest,
            name: "Renamed",
            recaptcha: { siteKey: recaptcha.siteKey },
            integrations: { google: { clientId: integrations.google.clientId } },
        };
        const res = await call(event(TENANT_ADMIN_T1, echoed));
        expect(res.statusCode).toBe(200);

        const put = settingsPut();
        expect(put.Item).toEqual({
            ...CURRENT,
            name: "Renamed",
            updatedBy: "u2",
            updatedAt: expect.any(String),
        });
        expect(writtenKeys()).toEqual(EXPECTED_WRITES);

        expect(auditDetails()).toEqual({
            updatedFields: ["domain", "name", "recaptcha", "integrations"],
            rejectedFields: ["PK", "SK", "id", "Domain", "createdAt", "createdBy"],
        });
    });
});
