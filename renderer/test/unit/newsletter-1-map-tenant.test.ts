import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md, ruling 7) — the MailerLite token never reaches the settings the renderer
 * reads: `mapTenant` does not map `integrations.mailerlite` (no renderer code reads it; the push runs in the backend).
 * Driven through the real `getTenantConfig`; only the DynamoDB document client is replaced (the cdl-2 harness). The
 * page payload is checked by the serving-contract row `newsletter-1-page`.
 */

const SENTINEL = "SENTINEL-ML-TOKEN-renderer-41b2";
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

beforeEach(() => { process.env.TABLE_NAME = "newsletter-1-unit"; });

const integrationsOf = async (integrations: unknown) => {
    store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "T", ...(integrations === undefined ? {} : { integrations }) };
    return (await getTenantConfig("t1"))!;
};

describe("NEWSLETTER-1 mapTenant — integrations without mailerlite", () => {
    it("a stored MailerLite connection is not mapped; the other integrations are, unchanged; the token is nowhere in the mapped record", async () => {
        const config = await integrationsOf({ contactEmail: "office@t1.test", fbPixelId: "123", mailerlite: { apiToken: SENTINEL, groupId: "g1" } });
        expect(config.integrations).toEqual({ contactEmail: "office@t1.test", fbPixelId: "123" });
        expect(JSON.stringify(config)).not.toContain(SENTINEL);
        expect(JSON.stringify(config)).not.toContain("mailerlite");
    });

    it("the legacy boolean is not mapped either; no integrations → {} as before", async () => {
        expect((await integrationsOf({ mailerlite: false, perplexity: false })).integrations).toEqual({ perplexity: false });
        expect((await integrationsOf(undefined)).integrations).toEqual({});
    });
});
