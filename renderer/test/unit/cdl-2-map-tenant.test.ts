import { describe, it, expect, vi, beforeEach } from "vitest";
import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

/**
 * CDL-2 (docs/slices/catalog-data-labels-1.md § 7.1; record docs/slices/cdl-2.md) — `mapTenant` applies the per-key
 * path rule (`urlPrefixesOf`) instead of the whole-object fallback. Driven through the real `getTenantConfig`; only the
 * DynamoDB document client is replaced (same harness as locale-1a-map-tenant.test.ts).
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

beforeEach(() => { process.env.TABLE_NAME = "cdl-2-unit"; });

const prefixesOf = async (urlPrefixes: unknown) => {
    store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "T", ...(urlPrefixes === undefined ? {} : { urlPrefixes }) };
    return (await getTenantConfig("t1"))!.urlPrefixes;
};

describe("CDL-2 mapTenant — urlPrefixes: the saved path per key, else the English default", () => {
    it("no stored urlPrefixes → every default (interest /my-list, checkoutConfirmation /confirmation)", async () => {
        expect(await prefixesOf(undefined)).toEqual(URL_PREFIX_DEFAULTS);
        expect((await prefixesOf(undefined)).interest).toBe("/my-list");
    });
    it("partial { interest: \"/lista-mea\" } (the one-key object Settings saves, F-CDL-PARTIAL-PREFIXES) → the other keys routable", async () => {
        expect(await prefixesOf({ interest: "/lista-mea" })).toEqual({ ...URL_PREFIX_DEFAULTS, interest: "/lista-mea" });
    });
    it("a cleared field (\"\") → that key's default; other stored keys kept", async () => {
        expect(await prefixesOf({ ...URL_PREFIX_DEFAULTS, shop: "", product: "/produs" })).toEqual({ ...URL_PREFIX_DEFAULTS, product: "/produs" });
    });
    it("not an object → as absent", async () => {
        expect(await prefixesOf("/produs")).toEqual(URL_PREFIX_DEFAULTS);
        expect(await prefixesOf(null)).toEqual(URL_PREFIX_DEFAULTS);
    });
});
