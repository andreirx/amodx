import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * CAT-THEME-1 (docs/slices/cat-theme-1.md § 3; packet rule 3) — PUT /settings accepts the eight new theme fields (on
 * `theme` and `darkTheme`) and the new `footer` attribute: each malformed field → 400 naming the field, nothing read,
 * nothing written; valid values are written as sent; the older theme fields are not validated (a stored theme that
 * predates any rule still saves). Same style as cat-quote-settings.test.ts: the real handler, `requireRole` and
 * `withInvalidation`; only `db.js` and `events.js` are mocked. Credential-free.
 */

const { ddbSend, mockAudit } = vi.hoisted(() => ({ ddbSend: vi.fn(), mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));

import { updateHandler as putSettings } from "../../src/tenant/settings.js";

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const TENANT = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", Domain: "t1.test", theme: { primaryColor: "#000000" } };

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

const ALL_SET = {
    fontNav: "Inter", fontWeights: [300, 500], headingWeight: 300, mutedColor: "#6b6b6b", borderColor: "#d4d4d4",
    shape: "editorial", cardImage: "landscape", cardCategoryLine: true,
};

describe("PUT /settings — the CAT-THEME-1 theme fields", () => {
    it("a weight outside 100–900 → 400 naming the field, nothing written (list entry and heading weight)", async () => {
        for (const bad of [0, 99, 901, 350.5, "300"]) {
            await expectRefused({ theme: { fontWeights: [400, bad] } }, /^theme\.fontWeights\.1: /);
            await expectRefused({ theme: { headingWeight: bad } }, /^theme\.headingWeight: /);
        }
        await expectRefused({ theme: { fontWeights: 300 } }, /^theme\.fontWeights: /);
    });

    it("a non-colour → 400 naming the field; an unknown shape or card image, a non-boolean category line → 400", async () => {
        for (const bad of ["", "red;}", "url(x)", "#12"]) {
            await expectRefused({ theme: { mutedColor: bad } }, /^theme\.mutedColor: must be a CSS colour/);
            await expectRefused({ theme: { borderColor: bad } }, /^theme\.borderColor: must be a CSS colour/);
        }
        await expectRefused({ theme: { shape: "brutalist" } }, /^theme\.shape: /);
        await expectRefused({ theme: { cardImage: "portrait" } }, /^theme\.cardImage: /);
        await expectRefused({ theme: { cardCategoryLine: "yes" } }, /^theme\.cardCategoryLine: /);
        await expectRefused({ theme: { fontNav: 5 } }, /^theme\.fontNav: /);
        await expectRefused({ darkTheme: { headingWeight: 1000 } }, /^darkTheme\.headingWeight: /);
    });

    it("every field set is written as sent", async () => {
        const theme = { primaryColor: "#111111", ...ALL_SET };
        expect((await put({ theme })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.theme).toEqual(theme);
    });

    it("the older theme fields are not validated: a stored-looking theme with odd legacy values still saves", async () => {
        const legacy = { primaryColor: "not-a-colour", fontHeading: "Weird; Font", radius: "huge" };
        expect((await put({ theme: legacy })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.theme).toEqual(legacy);
        ddbSend.mockClear();
        // A legacy JSON-string theme whose older fields are odd still saves (only the new fields are checked in it).
        expect((await put({ theme: '{"primaryColor":"not-a-colour"}' })).statusCode).toBe(200);
    });

    it("a body without theme, darkTheme or footer is never refused by this check", async () => {
        expect((await put({ name: "Renamed" })).statusCode).toBe(200);
    });
});

// Review-0 R-CT-1 / R-CT-2: the same checks on BOTH representations the renderer reads (an object, and the legacy JSON
// string that `mapTenant` parses) and on BOTH themes; the stored representation is never rewritten.
describe("PUT /settings — both theme representations (review-0 R-CT-1, R-CT-2)", () => {
    const forms: [string, (t: Record<string, unknown>) => unknown][] = [["object", (t) => t], ["JSON string", (t) => JSON.stringify(t)]];
    const bad: [Record<string, unknown>, string][] = [
        [{ headingWeight: 1000 }, "headingWeight"], [{ fontWeights: [400, 50] }, "fontWeights.1"], [{ shape: "brutalist" }, "shape"],
        [{ cardImage: "portrait" }, "cardImage"], [{ cardCategoryLine: "yes" }, "cardCategoryLine"],
        ...["#12345", "#1234567", "rgba(1,2,3,...)", "rgb(1,2,3,0.5)", "red;}"].flatMap((c): [Record<string, unknown>, string][] => [[{ mutedColor: c }, "mutedColor"], [{ borderColor: c }, "borderColor"]]),
    ];
    it("each malformed new field → 400 naming the field, nothing read or written — object and JSON string, theme and darkTheme", async () => {
        for (const [, encode] of forms) for (const attribute of ["theme", "darkTheme"]) for (const [fields, name] of bad) {
            const escaped = `${attribute}.${name}`.replace(/\./g, "\\.");
            await expectRefused({ [attribute]: encode({ primaryColor: "#000000", ...fields }) }, new RegExp(`^${escaped}: `));
        }
    });
    it("valid new fields in a JSON-string theme: written as sent (the string is not rewritten)", async () => {
        const text = JSON.stringify({ primaryColor: "#111111", ...ALL_SET });
        expect((await put({ theme: text, darkTheme: text })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.theme).toBe(text);
        expect(tenantPuts()[0].input.Item.darkTheme).toBe(text);
    });
    it("a string that is not a JSON object keeps today's behaviour (not checked, stored as sent)", async () => {
        for (const text of ["{not json", "\"#12345\"", "[1,2]", "null"]) {
            ddbSend.mockClear();
            expect((await put({ theme: text })).statusCode, text).toBe(200);
            expect(tenantPuts()[0].input.Item.theme).toBe(text);
        }
    });
});

describe("PUT /settings — footer (CAT-THEME-1 § 3 item 3)", () => {
    it("a width class is written; {} is written (→ the header's width)", async () => {
        expect((await put({ footer: { contentMaxWidth: "max-w-[1440px]" } })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.footer).toEqual({ contentMaxWidth: "max-w-[1440px]" });
        ddbSend.mockClear();
        expect((await put({ footer: {} })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.footer).toEqual({});
    });

    it("malformed → 400 naming the field, nothing written", async () => {
        await expectRefused({ footer: { contentMaxWidth: 1440 } }, /^footer\.contentMaxWidth: /);
        await expectRefused({ footer: { width: "max-w-7xl" } }, /^footer: .*width/);
        for (const bad of [null, "max-w-7xl", [], 3]) await expectRefused({ footer: bad }, /^footer: /);
    });
});

describe("PUT /settings — footer colours (BULK-PURGE-FOOTER-1 Part B rule 1)", () => {
    it("valid colours are written as sent, alone or with the width", async () => {
        const footer = { contentMaxWidth: "max-w-[1440px]", backgroundColor: "#1f2937", textColor: "rgb(249, 250, 251)" };
        expect((await put({ footer })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.footer).toEqual(footer);
        ddbSend.mockClear();
        expect((await put({ footer: { backgroundColor: "navy" } })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.footer).toEqual({ backgroundColor: "navy" });
    });

    it("a bad colour → 400 naming the field (`footer.backgroundColor: …`), nothing read, nothing written", async () => {
        for (const bad of ["", "#12", "red;}", "url(x)", "var(--x)", 0]) {
            await expectRefused({ footer: { backgroundColor: bad } }, /^footer\.backgroundColor: /);
            await expectRefused({ footer: { textColor: bad } }, /^footer\.textColor: /);
            await expectRefused({ footer: { contentMaxWidth: "max-w-7xl", textColor: bad } }, /^footer\.textColor: /);
        }
    });
});
