import { describe, it, expect, vi, beforeEach } from "vitest";
import { TenantConfigSchema } from "@amodx/shared";

/**
 * LOCALE-1A — `mapTenant` is a whitelist (docs/slices/locale-1.md § 3.2 item 4): a field it does not copy never
 * reaches a render. That class of defect dropped `countryCode` and `locale` (F-LOCALE-MAPTENANT) and, earlier,
 * `catalogMode`. This test lists the locale-table part fields FROM THE SCHEMA and fails when `mapTenant` drops one.
 * Driven through the real `getTenantConfig`; only the DynamoDB document client is replaced (one GetCommand).
 */

const store = vi.hoisted(() => ({ item: null as null | Record<string, unknown> }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    return {
        ...real,
        DynamoDBDocumentClient: {
            from: () => ({
                send: async (c: any) => (c.constructor.name === "QueryCommand" ? { Items: [] } : { Item: store.item ?? undefined }),
            }),
        },
    };
});

import { getTenantConfig } from "@/lib/dynamo";

beforeEach(() => { process.env.TABLE_NAME = "locale-1a-unit"; });

/** The parts of the locale table, by the schema's naming rule (`<part>Strings`), plus the two cookie/legal homes. */
const PART_FIELDS = Object.keys(TenantConfigSchema.shape).filter((k) => k.endsWith("Strings"));

describe("mapTenant passes every part of the locale table and the language", () => {
    it("the schema has exactly the three parts (a fourth part must be added here AND to mapTenant)", () => {
        expect(PART_FIELDS.sort()).toEqual(["catalogStrings", "commerceStrings", "siteStrings"]);
    });

    it("every part field, gdpr, legalLinks and locale reach the TenantConfig", async () => {
        const item: Record<string, unknown> = {
            PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "T", domain: "t.test", locale: "ro-RO",
            gdpr: { headline: "H", enabled: true }, legalLinks: { termsUrl: "/t", termsLabel: "T" },
        };
        for (const field of PART_FIELDS) item[field] = { someKey: `value of ${field}` };
        store.item = item;
        const config: any = await getTenantConfig("t1");
        for (const field of PART_FIELDS) expect(config[field], field).toEqual({ someKey: `value of ${field}` });
        expect(config.gdpr).toEqual(item.gdpr);
        expect(config.legalLinks).toEqual(item.legalLinks);
        expect(config.locale).toBe("ro-RO");
    });

    it("locale is normalised (§ 3.3): absent → en-US, ro_RO → ro-RO, garbage → en-US", async () => {
        for (const [raw, expected] of [[undefined, "en-US"], ["ro_RO", "ro-RO"], [" ro-ro ", "ro-RO"], ["xx-YY", "en-US"], ["en-US", "en-US"]] as const) {
            store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "T", ...(raw === undefined ? {} : { locale: raw }) };
            expect((await getTenantConfig("t1"))!.locale, String(raw)).toBe(expected);
        }
    });

    it("countryCode stays out (F-LOCALE-COUNTIES, § 13: a commerce slice owns it)", async () => {
        store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "T", countryCode: "RO" };
        expect((await getTenantConfig("t1")) as any).not.toHaveProperty("countryCode");
    });

    it("untitledSiteName: a tenant without a name gets the fallback of its language, or its override", async () => {
        store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1" };
        expect((await getTenantConfig("t1"))!.name).toBe("Untitled Site");
        store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", locale: "ro-RO" };
        expect((await getTenantConfig("t1"))!.name).toBe("Site fără nume");
        store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", locale: "ro-RO", siteStrings: { untitledSiteName: "Atelier" } };
        expect((await getTenantConfig("t1"))!.name).toBe("Atelier");
        // § 5.2 pattern D: a stored "" is an override that renders empty (review-0 R3)
        store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", locale: "ro-RO", siteStrings: { untitledSiteName: "" } };
        expect((await getTenantConfig("t1"))!.name).toBe("");
        store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Real Name", locale: "ro-RO" };
        expect((await getTenantConfig("t1"))!.name).toBe("Real Name");
    });
});
