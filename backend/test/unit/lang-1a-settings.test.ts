import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * LANG-1A (docs/slices/lang-1.md § 5.2, § 11) — PUT /settings and the language settings: `languageSettingsProblem`
 * (V1-V6) runs on the MERGED record (the stored item with the body over it). A refusal is a 400 that names the field,
 * after the strongly consistent tenant read and before any write. A tenant without the fields saves exactly as before.
 * Harness of sched-labels-1-settings.test.ts: the real handler; only `db.js` (`send`) and `events.js` are mocked.
 * Credential-free.
 */

const { ddbSend, mockAudit } = vi.hoisted(() => ({ ddbSend: vi.fn(), mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));

import { updateHandler as putSettings } from "../../src/tenant/settings.js";

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
/** A stored one-language tenant record, as live today (no language fields). */
const ONE_LANGUAGE = {
    PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", Domain: "t1.test", locale: "en-US",
    navLinks: [{ label: "Home", href: "/" }], footerLinks: [], homePageSlug: "/en/home", urlPrefixes: { shop: "/shop" },
};
let stored: Record<string, unknown> = ONE_LANGUAGE;

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const tenantPuts = () => commands().filter((c) => c instanceof PutCommand && c.input.Item?.SK === "TENANT#t1");
/** Every command that is not a read — a refused save must send none (the purge does not run either). */
const writes = () => commands().filter((c) => c instanceof PutCommand || c instanceof UpdateCommand || c instanceof DeleteCommand || c instanceof TransactWriteCommand);

const event = (body: unknown) => ({
    headers: { "x-tenant-id": "t1" },
    requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
}) as any;
const put = async (body: unknown) => (await (putSettings as any)(event(body), {} as any, () => {})) as { statusCode: number; body: string };

beforeEach(() => {
    stored = ONE_LANGUAGE;
    ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) return { Item: structuredClone(stored) };
        if (cmd instanceof QueryCommand) return { Items: [] };
        return {};
    });
    mockAudit.mockReset().mockResolvedValue(undefined);
});

async function expectRefused(body: unknown, field: string) {
    const res = await put(body);
    expect(res.statusCode, res.body).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(new RegExp(`^${field}[.:]`));
    expect(writes()).toEqual([]);
}

async function expectStored(body: Record<string, unknown>) {
    const res = await put(body);
    expect(res.statusCode, res.body).toBe(200);
    const items = tenantPuts();
    expect(items).toHaveLength(1);
    return items[0].input.Item as Record<string, unknown>;
}

describe("PUT /settings — language settings (LANG-1A)", () => {
    it("L1A-SETTINGS-NO-LANGS: a one-language tenant saves as before — nothing new stored, V6 not checked without languages", async () => {
        const item = await expectStored({ name: "Renamed", homePageSlug: "/en/home" });
        const { updatedAt, ...rest } = item;
        expect(typeof updatedAt).toBe("string");
        // Exactly HEAD's written item: the stored record, the body over it, the two metadata fields, the keys.
        expect(rest).toEqual({ ...ONE_LANGUAGE, name: "Renamed", updatedBy: "u1" });
        for (const key of ["languages", "navLinksByLang", "footerLinksByLang"]) expect(Object.hasOwn(item, key), key).toBe(false);
    });

    it("L1A-LANGS-VALID: a list, menus per language and a default-language homePageSlug are stored as sent", async () => {
        stored = { ...ONE_LANGUAGE, locale: "ro-RO", homePageSlug: undefined };
        const body = {
            languages: ["en", "de"],
            navLinksByLang: { en: [{ label: "Home", href: "/en", children: [{ label: "Team", href: "/en/team" }] }] },
            footerLinksByLang: { de: [] },
            homePageSlug: "/acasa",
        };
        const item = await expectStored(body);
        expect(item.languages).toEqual(body.languages);
        expect(item.navLinksByLang).toEqual(body.navLinksByLang);
        expect(item.footerLinksByLang).toEqual(body.footerLinksByLang);
        expect(item.homePageSlug).toBe("/acasa");
        // A language-list change writes no page and no membership item: the one write is the tenant record.
        // (Writes outside the tenant's page partition — the record itself, the existing CDN-pending marker — are allowed.)
        const pagePartition = (c: any) => (c.input.Item?.PK ?? c.input.Key?.PK) === "TENANT#t1" || c instanceof TransactWriteCommand;
        expect(writes().filter(pagePartition)).toEqual([]);
    });

    it("L1A-LANGS-REFUSED: V1 not an array, \"RO\", \"xx\" → 400 naming languages", async () => {
        await expectRefused({ languages: "ro" }, "languages");
        ddbSend.mockClear();
        await expectRefused({ languages: ["RO"] }, "languages");
        ddbSend.mockClear();
        await expectRefused({ languages: ["xx"] }, "languages");
    });

    it("L1A-LANGS-REFUSED: V2 twice, V3 the default subtag (also by a locale change), V4 a URL-prefix segment and api → 400", async () => {
        await expectRefused({ languages: ["de", "de"] }, "languages");
        ddbSend.mockClear();
        await expectRefused({ languages: ["en"] }, "languages");
        ddbSend.mockClear();
        stored = { ...ONE_LANGUAGE, homePageSlug: undefined, languages: ["de"] };
        await expectRefused({ locale: "de-DE" }, "languages");     // the merged check: the locale being saved
        ddbSend.mockClear();
        stored = { ...ONE_LANGUAGE, homePageSlug: undefined };
        await expectRefused({ languages: ["de"], urlPrefixes: { shop: "/de/shop" } }, "languages");
        ddbSend.mockClear();
        stored = { ...ONE_LANGUAGE, homePageSlug: undefined, urlPrefixes: { product: "/fr" } };
        await expectRefused({ languages: ["fr"] }, "languages");   // a stored prefix
        ddbSend.mockClear();
        await expectRefused({ languages: ["api"] }, "languages");
    });

    it("L1A-BYLANG-REFUSED: a key not in languages; a value that is not a link list → 400 naming the map", async () => {
        stored = { ...ONE_LANGUAGE, homePageSlug: undefined };
        await expectRefused({ languages: ["de"], navLinksByLang: { fr: [] } }, "navLinksByLang");
        ddbSend.mockClear();
        await expectRefused({ languages: ["de"], footerLinksByLang: { de: [{ label: "x" }] } }, "footerLinksByLang");
        ddbSend.mockClear();
        // Removing a language without removing its menu: the stored map still names it.
        stored = { ...ONE_LANGUAGE, homePageSlug: undefined, languages: ["de"], navLinksByLang: { de: [] } };
        await expectRefused({ languages: [] }, "navLinksByLang");
    });

    it("L1A-LANGS-HOMEPAGE-REFUSED: (a) one body, (b) stored homePageSlug + new language, (c) stored language + new homePageSlug → 400; control accepted", async () => {
        stored = { ...ONE_LANGUAGE, locale: "ro-RO", homePageSlug: undefined };
        await expectRefused({ languages: ["en"], homePageSlug: "/en/home" }, "homePageSlug");      // (a)
        ddbSend.mockClear();
        stored = { ...ONE_LANGUAGE, locale: "ro-RO", homePageSlug: "/en/home" };
        await expectRefused({ languages: ["en"] }, "homePageSlug");                                // (b)
        ddbSend.mockClear();
        stored = { ...ONE_LANGUAGE, locale: "ro-RO", homePageSlug: undefined, languages: ["en"] };
        await expectRefused({ homePageSlug: "/en" }, "homePageSlug");                              // (c)
        ddbSend.mockClear();
        stored = { ...ONE_LANGUAGE, locale: "ro-RO" };                                             // control: no languages
        expect((await expectStored({ homePageSlug: "/en/home" })).homePageSlug).toBe("/en/home");
    });
});
