// CAT-IMPORT-PROFILE-1B — `getCatalogListing` after the listing rule moved to `@amodx/shared` (design
// docs/slices/cat-import-profile-1.md § 7.1 slice 1b, § 7.3 "1b golden", § 5.5 "the same fixture through the
// renderer's getCatalogListing").
//   (1) Preservation: every `getCatalogListing` call of the golden — captured from the BASE code over the in-memory
//       store with the clock fixed — gives deep-equal items (membership, order AND the projected fields).
//   (2) The projection gains `facetModes` (§ 7.1): a stored `facetModes` reaches the facet rules.
//   (3) The read and the shared rule agree: the same items through `getCatalogListing` and `catalogListing` give the
//       same members in the same order — the proof that the admin preview (1c) and the site share one rule.
// No AWS, no network: the document client is the in-memory store `memory-dynamo.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { memoryDocClient, type MemoryDocClient } from "./memory-dynamo";

const store = vi.hoisted(() => ({ client: null as null | { send: (c: any) => Promise<any> } }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    return { ...real, DynamoDBDocumentClient: { from: () => ({ send: (c: any) => store.client!.send(c) }) } };
});

import { getCatalogListing } from "@/lib/dynamo";
import { catalogListing, utcDay } from "@amodx/shared";

type ListingCall = { fixture: string; tenantId: string; scope: string | null; out: Record<string, unknown>[] };
const golden: { baseCommit: string; listing: { now: string; fixtures: Record<string, any[]>; calls: ListingCall[] } } = JSON.parse(
    readFileSync(new URL("../../../packages/shared/test/fixtures/cat-import-profile-1b-baseline.json", import.meta.url), "utf8"),
);

function use(items: any[]): MemoryDocClient {
    const client = memoryDocClient(items);
    store.client = client;
    return client;
}

beforeEach(() => {
    process.env.TABLE_NAME = "cip1b-unit";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(golden.listing.now));
});
afterEach(() => {
    vi.useRealTimers();
    delete process.env.TABLE_NAME;
});

describe("(1) the golden's getCatalogListing calls, through the renderer's own read", () => {
    it(`${golden.listing.calls.length} calls from ${golden.baseCommit.slice(0, 7)} give deep-equal items`, async () => {
        expect(golden.listing.calls.length).toBe(11);
        for (const c of golden.listing.calls) {
            use(golden.listing.fixtures[c.fixture]);
            expect(await getCatalogListing(c.tenantId, c.scope ?? undefined), `${c.fixture} ${c.scope}`).toEqual(c.out);
        }
    });
    it("the store paged the serving tenant (the read's ExclusiveStartKey loop ran)", async () => {
        const client = use(golden.listing.fixtures.serving);
        await getCatalogListing("cm1-catalog");
        expect(client.calls.length).toBeGreaterThan(1);
    });
});

describe("(2) the projection gains facetModes", () => {
    const fm = { variant: "never", attributes: [{ key: "Certificates", mode: "never" }] };
    const items = [
        { PK: "TENANT#t1", SK: "PRODUCT#p1", id: "p1", status: "active", categoryIds: ["c"], facetModes: fm, description: "x" },
        { PK: "TENANT#t1", SK: "PRODUCT#p2", id: "p2", status: "active", categoryIds: ["c"] },
    ];
    it("the query projects `facetModes`; a product that carries it returns it, one that does not has no such key", async () => {
        const client = use(items);
        const out = await getCatalogListing("t1");
        expect(client.calls[0].ProjectionExpression.split(", ")).toContain("facetModes");
        expect(out.map((p) => p.facetModes)).toEqual([fm, undefined]);
        expect("facetModes" in out[1]).toBe(false);
        expect("description" in out[0]).toBe(false);     // the store applies the projection (control)
    });
});

describe("(3) getCatalogListing and the shared catalogListing give the same members in the same order", () => {
    it("over both golden fixtures, every scope of the golden", async () => {
        const today = utcDay(new Date());
        for (const c of golden.listing.calls) {
            use(golden.listing.fixtures[c.fixture]);
            const read = (await getCatalogListing(c.tenantId, c.scope ?? undefined)).map((p) => p.id);
            const items = golden.listing.fixtures[c.fixture].filter((i) => i.PK === `TENANT#${c.tenantId}` && String(i.SK).startsWith("PRODUCT#"));
            expect(read, `${c.fixture} ${c.scope}`).toEqual(catalogListing(items, c.scope ?? undefined, today).map((p) => p.id));
        }
    });
});
