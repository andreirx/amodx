import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * SETTINGS-KEYS-1B — request-controlled metadata never sets an index key or claims a hostname; the public slug
 * readers accept only an item of the caller's partition.
 *
 * Same style as `settings-keys.test.ts`: the real handlers (`tenant/settings.ts` `updateHandler`,
 * `products/public-get.ts`, `categories/public-get.ts`), the real `requireRole`, `withInvalidation`, `catprod.ts`
 * and `availability.ts` run; only `db.js` (its `send`) and `events.js` (`publishAudit`) are mocked. Command classes
 * stay real, so each row inspects exactly what would be sent to DynamoDB. Credential-free.
 */

const { ddbSend, mockAudit } = vi.hoisted(() => ({ ddbSend: vi.fn(), mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));

import { updateHandler } from "../../src/tenant/settings.js";
import { handler as productPublicGet } from "../../src/products/public-get.js";
import { handler as categoryPublicGet } from "../../src/categories/public-get.js";

const TENANT_ADMIN_T1 = { sub: "u2", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };

/** The five GSI key attributes that are not also table keys (`infra/lib/database.ts:27-51`). */
const INDEX_ONLY_KEYS = ["Type", "CreatedAt", "Status", "ScheduledFor", "TenantSlug"];

/** The stored tenant record as `tenant/create.ts` writes it, plus one secret. */
const CURRENT = {
    PK: "SYSTEM",
    SK: "TENANT#t1",
    id: "t1",
    domain: "t1.test",
    Domain: "t1.test",
    name: "Tenant One",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "creator-sub",
    recaptcha: { siteKey: "site", secretKey: "RC_SECRET" },
};

/** A tenant record that carries index keys (the poisoned shape before this slice). */
const POISONED = {
    PK: "SYSTEM",
    SK: "TENANT#t1",
    Type: "Product",
    status: "active",
    price: "999",
    recaptcha: { secretKey: "S" },
};
const PRODUCT = { PK: "TENANT#t2", SK: "PRODUCT#p1", id: "p1", Type: "Product", status: "active", slug: "probe", price: "10" };
const CATEGORY = { PK: "TENANT#t2", SK: "CATEGORY#c1", id: "c1", Type: "Category", slug: "probe", name: "Rings" };

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const domainQueries = () => commands().filter((c) => c instanceof QueryCommand && c.input.IndexName === "GSI_Domain");
const writes = () =>
    commands().filter((c) => c instanceof PutCommand || c instanceof UpdateCommand || c instanceof DeleteCommand);

/** Answers: Get → CURRENT; Query on `index` → `items`; any other Query or write → empty. */
function mockDb(index: string | null, items: Record<string, any>[]) {
    ddbSend.mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) return { Item: structuredClone(CURRENT) };
        if (cmd instanceof QueryCommand) return { Items: cmd.input.IndexName === index ? structuredClone(items) : [] };
        return {};
    });
}

function settingsEvent(body: unknown) {
    return {
        headers: { "x-tenant-id": "t1" },
        requestContext: { authorizer: { lambda: TENANT_ADMIN_T1 }, http: { sourceIp: "127.0.0.1" } },
        body: JSON.stringify(body),
    } as any;
}
const putSettings = async (body: unknown) => (await (updateHandler as any)(settingsEvent(body), {} as any, () => {})) as any;

/** The one Put that is not the CDN_LAST_CHANGE marker — the settings write. */
function settingsPut(): Record<string, any> {
    const puts = commands().filter((c) => c instanceof PutCommand && c.input.Item!.SK !== "CDN_LAST_CHANGE");
    expect(puts).toHaveLength(1);
    return puts[0].input.Item;
}

const publicEvent = (tenantId: string, slug: string) =>
    ({ headers: { "x-tenant-id": tenantId }, pathParameters: { slug }, queryStringParameters: {} }) as any;
const callPublic = async (h: any, e: any) => (await h(e, {} as any, () => {})) as any;

beforeEach(() => {
    ddbSend.mockReset();
    mockDb(null, []);
    mockAudit.mockReset();
    mockAudit.mockResolvedValue(undefined);
});

describe("SETTINGS-KEYS-1B — PUT /settings never sets an index key", () => {
    it("(a) body TenantSlug 't2#probe' + Type 'Product' + status + price → 200, the Put carries none of the five index names, rejectedFields [Type, TenantSlug]", async () => {
        const res = await putSettings({ TenantSlug: "t2#probe", Type: "Product", status: "active", price: "999" });
        expect(res.statusCode).toBe(200);

        const item = settingsPut();
        expect(item.SK).toBe("TENANT#t1");
        for (const key of INDEX_ONLY_KEYS) expect(item).not.toHaveProperty(key);
        // lower-case `status` and `price` are ordinary (unvalidated) config fields, not index keys.
        expect(item.status).toBe("active");

        expect(mockAudit.mock.calls[0][0].details).toEqual({
            updatedFields: ["status", "price"],
            rejectedFields: ["Type", "TenantSlug"],
        });
    });

    it("(a′) body naming all five index keys → 200, none written, rejectedFields lists all five", async () => {
        const res = await putSettings({
            TenantSlug: "t2#probe", Type: "Product", CreatedAt: "x", Status: "PENDING", ScheduledFor: "y", name: "n",
        });
        expect(res.statusCode).toBe(200);

        const item = settingsPut();
        for (const key of INDEX_ONLY_KEYS) expect(item).not.toHaveProperty(key);
        expect(mockAudit.mock.calls[0][0].details).toEqual({ updatedFields: ["name"], rejectedFields: INDEX_ONLY_KEYS });
    });
});

describe("SETTINGS-KEYS-1B — PUT /settings: a hostname belongs to at most one tenant", () => {
    it("(b) domain 'taken.example' held by TENANT#t2 → 409 with an error message, no write, no audit", async () => {
        mockDb("GSI_Domain", [{ PK: "SYSTEM", SK: "TENANT#t2", Domain: "taken.example" }]);
        const res = await putSettings({ domain: "taken.example" });
        expect(res.statusCode).toBe(409);
        expect(typeof JSON.parse(res.body).error).toBe("string");

        const [q] = domainQueries();
        expect(q.input.KeyConditionExpression).toBe("#d = :d");
        expect(q.input.ExpressionAttributeNames).toEqual({ "#d": "Domain" });
        expect(q.input.ExpressionAttributeValues).toEqual({ ":d": "taken.example", ":tenant": "TENANT#" });
        expect(q.input.FilterExpression).toBe("begins_with(SK, :tenant)");
        expect(writes()).toHaveLength(0);
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it("(c) domain 'taken.example' whose only holder is the caller's own record → 200, Domain written", async () => {
        mockDb("GSI_Domain", [{ PK: "SYSTEM", SK: "TENANT#t1", Domain: "taken.example" }]);
        const res = await putSettings({ domain: "taken.example" });
        expect(res.statusCode).toBe(200);
        expect(domainQueries()).toHaveLength(1);
        expect(settingsPut().Domain).toBe("taken.example");
    });

    it("(d) domain 'free.example' with no holder → 200, Domain written", async () => {
        const res = await putSettings({ domain: "free.example" });
        expect(res.statusCode).toBe(200);
        expect(domainQueries()).toHaveLength(1);
        expect(settingsPut().Domain).toBe("free.example");
    });

    it("(e) unchanged domain → 200, no GSI_Domain query sent", async () => {
        const res = await putSettings({ domain: CURRENT.domain, name: "Renamed" });
        expect(res.statusCode).toBe(200);
        expect(domainQueries()).toHaveLength(0);
        expect(settingsPut().Domain).toBe(CURRENT.domain);
    });
});

describe("SETTINGS-KEYS-1B — GET /public/products/{slug} accepts only the tenant's product item", () => {
    it("(f) the only GSI_Slug hit is a tenant record carrying Type 'Product' → 404, no secret in the body", async () => {
        mockDb("GSI_Slug", [POISONED]);
        const res = await callPublic(productPublicGet, publicEvent("t2", "probe"));
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toContain("secretKey");
        expect(JSON.parse(res.body)).toEqual({ error: "Product not found" });
    });

    it("(g) a real product hit after the poisoned one → 200 with the product", async () => {
        mockDb("GSI_Slug", [POISONED, PRODUCT]);
        const res = await callPublic(productPublicGet, publicEvent("t2", "probe"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual(PRODUCT);
    });
});

describe("SETTINGS-KEYS-1B — GET /public/categories/{slug} accepts only the tenant's category item", () => {
    it("(h-f) the only GSI_Slug hit is a tenant record carrying Type 'Category' → 404, no secret in the body", async () => {
        mockDb("GSI_Slug", [{ ...POISONED, Type: "Category" }]);
        const res = await callPublic(categoryPublicGet, publicEvent("t2", "probe"));
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toContain("secretKey");
        expect(JSON.parse(res.body)).toEqual({ error: "Category not found" });
    });

    it("(h-g) a real category hit after the poisoned one → 200 with the category", async () => {
        mockDb("GSI_Slug", [{ ...POISONED, Type: "Category" }, CATEGORY]);
        const res = await callPublic(categoryPublicGet, publicEvent("t2", "probe"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).category).toEqual(CATEGORY);
    });
});
