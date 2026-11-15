import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * SHOP-LOOK-1A (docs/slices/shop-look-1a.md; design docs/slices/shop-look-1.md § 4.1) — PUT /settings checks the two new
 * header keys (`tagline`, `categoryBarIds`, picked into the header check beside the colours) and the two new footer keys
 * (`brandText`, `columns`, in the strict `FooterConfigSchema`). Each malformed value → 400 naming the field, nothing read,
 * nothing written; valid values are written as sent; the older header keys stay unvalidated. The style of
 * cat-theme-settings.test.ts: the real handler; only `db.js` and `events.js` are mocked. Credential-free.
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
async function expectWritten(body: Record<string, unknown>, attribute: "header" | "footer") {
    ddbSend.mockClear();
    expect((await put(body)).statusCode, JSON.stringify(body)).toBe(200);
    expect(tenantPuts()[0].input.Item[attribute]).toEqual(body[attribute]);
}
const ids = (n: number) => Array.from({ length: n }, (_, i) => `cat-${i + 1}`);
const column = (heading: string, n = 1) => ({ heading, links: Array.from({ length: n }, (_, i) => ({ label: `L${i}`, href: `/l${i}` })) });

describe("PUT /settings — header.tagline and header.categoryBarIds (SHOP-LOOK-1A)", () => {
    it("valid values are written as sent, with the older header keys and the colours", async () => {
        await expectWritten({ header: { showLogo: true, navHeight: "h-20", backgroundColor: "#f5f1ea", tagline: "SINCE 1998", categoryBarIds: ids(12) } }, "header");
        await expectWritten({ header: { tagline: "x".repeat(60) } }, "header");
        await expectWritten({ header: { categoryBarIds: [] } }, "header");
        await expectWritten({ header: { tagline: "   " } }, "header");     // whitespace only: valid; the renderer draws it as absent
    });
    it("a tagline over 60 characters or not a text → 400 naming header.tagline, nothing read or written", async () => {
        for (const bad of ["x".repeat(61), 5, null, ["a"]]) await expectRefused({ header: { navHeight: "h-16", tagline: bad } }, /^header\.tagline: /);
    });
    it("over 12 ids, an empty id, a non-text id or not an array → 400 naming header.categoryBarIds, nothing read or written", async () => {
        await expectRefused({ header: { categoryBarIds: ids(13) } }, /^header\.categoryBarIds: /);
        await expectRefused({ header: { categoryBarIds: ["cat-1", ""] } }, /^header\.categoryBarIds\.1: /);
        await expectRefused({ header: { categoryBarIds: ["cat-1", 7] } }, /^header\.categoryBarIds\.1: /);
        for (const bad of ["cat-1", { a: "cat-1" }, null, 3]) await expectRefused({ header: { categoryBarIds: bad } }, /^header\.categoryBarIds: /);
    });
    it("old stored headers unchanged: the older keys stay unvalidated and a non-object header is stored as sent", async () => {
        await expectWritten({ header: { navHeight: 64, showLogo: "yes", extra: "kept" } }, "header");
        for (const odd of [null, "h-16", [1]]) {
            ddbSend.mockClear();
            expect((await put({ header: odd })).statusCode, JSON.stringify(odd)).toBe(200);
        }
    });
});

describe("PUT /settings — footer.brandText and footer.columns (SHOP-LOOK-1A)", () => {
    it("valid values are written as sent, with the older footer keys", async () => {
        await expectWritten({ footer: { contentMaxWidth: "max-w-7xl", backgroundColor: "#111111", brandText: "x".repeat(400), columns: [column("Explore", 12), column("Company"), column("Categories", 0), column("More")] } }, "footer");
        await expectWritten({ footer: { columns: [] } }, "footer");
        await expectWritten({ footer: { backgroundColor: "#111111" } }, "footer");          // an old stored footer
    });
    it("brandText over 400 characters → 400 naming footer.brandText", async () => {
        await expectRefused({ footer: { brandText: "x".repeat(401) } }, /^footer\.brandText: /);
    });
    it("a bad column → 400 naming footer.columns: over 4 columns, over 12 links, an empty heading, an empty label or href, an unknown key", async () => {
        await expectRefused({ footer: { columns: [column("A"), column("B"), column("C"), column("D"), column("E")] } }, /^footer\.columns: /);
        await expectRefused({ footer: { columns: [column("A", 13)] } }, /^footer\.columns\.0\.links: /);
        await expectRefused({ footer: { columns: [column("")] } }, /^footer\.columns\.0\.heading: /);
        await expectRefused({ footer: { columns: [{ heading: "A", links: [{ label: "", href: "/a" }] }] } }, /^footer\.columns\.0\.links\.0\.label: /);
        await expectRefused({ footer: { columns: [{ heading: "A", links: [{ label: "a", href: "" }] }] } }, /^footer\.columns\.0\.links\.0\.href: /);
        await expectRefused({ footer: { columns: [{ ...column("A"), colour: "red" }] } }, /^footer\.columns\.0: .*colour/);
        await expectRefused({ footer: { columns: [{ heading: "A", links: [{ label: "a", href: "/a", target: "_blank" }] }] } }, /^footer\.columns\.0\.links\.0: .*target/);
        await expectRefused({ footer: { columns: column("A") } }, /^footer\.columns: /);
    });
    it("the footer stays strict: an unknown footer key → 400", async () => {
        await expectRefused({ footer: { brandText: "x", tagline: "y" } }, /^footer: .*tagline/);
    });
});
