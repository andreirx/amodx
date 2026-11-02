import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * CAT-QUOTE-1 (docs/slices/cat-quote-1.md § 3 items 1 and 4; packet rules 2 and 7) — PUT /settings accepts
 * `contactChannels` and `interestListEmail`: each malformed field → 400 naming the field, nothing read, nothing written;
 * a valid value is written as sent; `interestListEmail: null` removes the attribute; a body without them is never
 * refused by them; the server-owned keys are still removed. Same style as locale-settings.test.ts: the real handler,
 * `requireRole` and `withInvalidation`; only `db.js` and `events.js` are mocked. Credential-free.
 */

const { ddbSend, mockAudit } = vi.hoisted(() => ({ ddbSend: vi.fn(), mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));

import { updateHandler as putSettings } from "../../src/tenant/settings.js";

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const TENANT = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", Domain: "t1.test", interestListEmail: "old@t1.test" };

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const tenantPuts = () => commands().filter((c) => c instanceof PutCommand && c.input.Item?.SK === "TENANT#t1");
const anyWrite = () => commands().some((c) => (c instanceof PutCommand || c instanceof UpdateCommand));

const put = async (body: unknown) => (await (putSettings as any)({
    headers: { "x-tenant-id": "t1" },
    requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
}, {} as any, () => {})) as { statusCode: number; body: string };

beforeEach(() => {
    ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) return { Item: structuredClone(TENANT) };
        if (cmd instanceof QueryCommand) return { Items: [] };
        return {};
    });
    mockAudit.mockReset().mockResolvedValue(undefined);
});

async function expectRefused(body: unknown, message: RegExp) {
    ddbSend.mockClear();
    const res = await put(body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(message);
    expect(anyWrite()).toBe(false);
    expect(commands()).toEqual([]);          // refused before the tenant read: nothing read, nothing written
}

describe("PUT /settings — contactChannels (CAT-QUOTE-1)", () => {
    it("each malformed field → 400 naming the field, nothing written", async () => {
        for (const bad of ["", " 0721", "0721 ", "07.21", "+", "tel:0721", 721]) {
            await expectRefused({ contactChannels: { phone: bad } }, /^contactChannels\.phone: /);
            await expectRefused({ contactChannels: { whatsapp: bad } }, /^contactChannels\.whatsapp: /);
        }
        for (const bad of ["", "office", "office@", 5]) await expectRefused({ contactChannels: { email: bad } }, /^contactChannels\.email: /);
        await expectRefused({ contactChannels: { fax: "0721" } }, /^contactChannels: .*fax/);
        for (const bad of [null, "0721", ["0721"], 3]) await expectRefused({ contactChannels: bad }, /^contactChannels: /);
    });

    it("a valid value is written as sent; {} clears every channel", async () => {
        const channels = { phone: "+40 721-000 111", whatsapp: "40721000111", email: "office@t1.test" };
        expect((await put({ contactChannels: channels })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.contactChannels).toEqual(channels);
        ddbSend.mockClear();
        expect((await put({ contactChannels: {} })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.contactChannels).toEqual({});
    });
});

describe("PUT /settings — interestListEmail (CAT-QUOTE-1)", () => {
    it("not an e-mail → 400 naming the field, nothing written", async () => {
        for (const bad of ["", "lists", 5, {}, ["a@b.test"]]) await expectRefused({ interestListEmail: bad }, /^interestListEmail: /);
    });

    it("an e-mail is written; null removes the attribute (lists go to the visitor contact e-mail again)", async () => {
        expect((await put({ interestListEmail: "lists@t1.test" })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.interestListEmail).toBe("lists@t1.test");
        ddbSend.mockClear();
        expect((await put({ interestListEmail: null })).statusCode).toBe(200);
        expect(Object.hasOwn(tenantPuts()[0].input.Item, "interestListEmail")).toBe(false);
    });

    it("a body without the two attributes is not refused and keeps the stored ones; server-owned keys are still removed", async () => {
        const res = await put({ name: "Renamed", PK: "SYSTEM", SK: "TENANT#other", id: "other" });
        expect(res.statusCode).toBe(200);
        const item = tenantPuts()[0].input.Item;
        expect(item).toMatchObject({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Renamed", interestListEmail: "old@t1.test" });
        expect(Object.hasOwn(item, "contactChannels")).toBe(false);
    });
});
