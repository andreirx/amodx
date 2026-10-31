import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * LOCALE-1A — the PUT /settings limits of docs/slices/locale-1.md § 4.4 (backend unit checks of § 10 row `locale-1a`):
 * each limit → 400 with nothing written; a body without the new attributes is never refused by them;
 * `commerceStrings` (and `gdpr`, `legalLinks`) are never validated. Same style as catalog-mode.test.ts: the real
 * handler, `requireRole` and `withInvalidation`; only `db.js` (`send`) and `events.js` (`publishAudit`) are mocked.
 * Credential-free.
 */

const { ddbSend, mockAudit } = vi.hoisted(() => ({ ddbSend: vi.fn(), mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));

import { updateHandler as putSettings } from "../../src/tenant/settings.js";

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const TENANT = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", Domain: "t1.test" };

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const tenantPuts = () => commands().filter((c) => c instanceof PutCommand && c.input.Item?.SK === "TENANT#t1");
const anyWrite = () => commands().some((c) => (c instanceof PutCommand || c instanceof UpdateCommand));

const event = (body: unknown) => ({
    headers: { "x-tenant-id": "t1" },
    requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
}) as any;
const put = async (body: unknown) => (await (putSettings as any)(event(body), {} as any, () => {})) as { statusCode: number; body: string };

beforeEach(() => {
    ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) return { Item: structuredClone(TENANT) };
        if (cmd instanceof QueryCommand) return { Items: [] };
        return {};
    });
    mockAudit.mockReset().mockResolvedValue(undefined);
});

const many = (n: number, value = "x") => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, value]));

async function expectRefused(body: unknown, message: RegExp) {
    const res = await put(body);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(message);
    expect(anyWrite()).toBe(false);
    expect(commands()).toEqual([]);          // refused before the tenant read: nothing read, nothing written
}

describe("PUT /settings — siteStrings / catalogStrings limits (§ 4.4)", () => {
    for (const attribute of ["siteStrings", "catalogStrings"] as const) {
        describe(attribute, () => {
            it("type: not a JSON object → 400 naming the attribute", async () => {
                for (const bad of [null, "text", 3, ["a"], true]) {
                    ddbSend.mockClear();
                    await expectRefused({ [attribute]: bad }, new RegExp(`^${attribute} must be a JSON object`));
                }
            });
            it("type: a non-string value → 400", async () => {
                await expectRefused({ [attribute]: { navContact: 5 } }, new RegExp(`^${attribute}\\.navContact must be a text`));
            });
            it("key form: 64 characters pass, 65 or a bad first character → 400", async () => {
                expect((await put({ [attribute]: { ["a".repeat(64)]: "x" } })).statusCode).toBe(200);
                ddbSend.mockClear();
                await expectRefused({ [attribute]: { ["a".repeat(65)]: "x" } }, /is not a valid key/);
                ddbSend.mockClear();
                await expectRefused({ [attribute]: { "1nav": "x" } }, /is not a valid key/);
                ddbSend.mockClear();
                await expectRefused({ [attribute]: { "nav-contact": "x" } }, /is not a valid key/);
            });
            it("entries: 200 pass, 201 → 400 (unknown keys count)", async () => {
                expect((await put({ [attribute]: many(200) })).statusCode).toBe(200);
                ddbSend.mockClear();
                await expectRefused({ [attribute]: many(201) }, new RegExp(`^${attribute} has 201 entries`));
            });
            it("value length: 500 UTF-16 units pass, 501 → 400", async () => {
                expect((await put({ [attribute]: { k: "a".repeat(500) } })).statusCode).toBe(200);
                ddbSend.mockClear();
                await expectRefused({ [attribute]: { k: "a".repeat(501) } }, new RegExp(`^${attribute}\\.k is 501 characters`));
            });
            it("serialised size: within every other limit but over 32 768 UTF-8 bytes → 400", async () => {
                // 100 × 200 "ș" (1 UTF-16 unit, 2 UTF-8 bytes each) ≈ 40 KB of JSON; each value is under 500 units.
                await expectRefused({ [attribute]: many(100, "ș".repeat(200)) }, new RegExp(`^${attribute} is \\d+ bytes as JSON; at most 32768`));
            });
            it("a valid attribute is written as sent, unknown keys kept (§ 2.4)", async () => {
                const value = { navContact: "Scrie-ne", futureKey: "kept", empty: "" };
                const res = await put({ [attribute]: value });
                expect(res.statusCode).toBe(200);
                expect(tenantPuts()).toHaveLength(1);
                expect(tenantPuts()[0].input.Item[attribute]).toEqual(value);
            });
        });
    }

    it("reserved keys: siteStrings must not hold any of the nine cookie/legal keys → 400 naming the real location", async () => {
        const nine: Record<string, string> = {
            cookieHeadline: "gdpr.headline", cookieDescription: "gdpr.description", cookieDenyAll: "gdpr.denyAll",
            cookieNecessaryOnly: "gdpr.necessaryOnly", cookieAcceptAll: "gdpr.acceptAll",
            legalTermsLabel: "legalLinks.termsLabel", legalPrivacyLabel: "legalLinks.privacyLabel",
            legalConsumerProtectionLabel: "legalLinks.anpcLabel", legalDisputeResolutionLabel: "legalLinks.anpcSalLabel",
        };
        for (const [key, home] of Object.entries(nine)) {
            ddbSend.mockClear();
            await expectRefused({ siteStrings: { navContact: "ok", [key]: "x" } }, new RegExp(`"${key}": that text is stored only in ${home.replace(".", "\\.")}`));
        }
    });

    it("the reserved-key rule is for siteStrings only: catalogStrings may hold such a name (an unknown key there)", async () => {
        expect((await put({ catalogStrings: { cookieHeadline: "x" } })).statusCode).toBe(200);
    });
});

describe("PUT /settings — what the limits never touch", () => {
    it("a body without siteStrings/catalogStrings is never refused by them, and commerceStrings is never validated", async () => {
        const commerceStrings: Record<string, unknown> = { ...many(1000, "y".repeat(2000)), "bad key!": 7, nested: { a: 1 } };
        const res = await put({ name: "Tenant One", commerceStrings, gdpr: { headline: "z".repeat(5000), enabled: true }, legalLinks: { termsLabel: 9 } });
        expect(res.statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.commerceStrings).toEqual(commerceStrings);
    });

    it("a stored siteStrings that the body does not resend is not re-checked", async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
            if (cmd instanceof GetCommand) return { Item: { ...structuredClone(TENANT), siteStrings: many(300) } };
            if (cmd instanceof QueryCommand) return { Items: [] };
            return {};
        });
        expect((await put({ name: "Renamed" })).statusCode).toBe(200);
    });
});
