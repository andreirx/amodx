// CAT-IMPORT-PROFILE-1B golden capture — `getCatalogListing` and the serving fixtures' facet panels, captured from the
// BASE code (runs only inside the base worktree, see run.sh; copied to <worktree>/renderer/test/capture/).
//
// - The DynamoDB document client is replaced by the in-memory store `memory-dynamo.ts` (one query form; projection
//   applied; paged by 7). Nothing else of the base `lib/dynamo.ts` is touched.
// - The clock is fixed at NOW, so the date window (`isProductAvailable`, UTC day) is reproducible.
// - Named without `.test.ts` so the shared package's own vitest glob never picks it up; the capture config names it.
// - Fixtures: `serving` = every item of the serving-contract catalog tenant (`cm1-catalog`, `fixtures.mjs`); `edge` =
//   the membership edge cases below. Neither holds `facetModes`.
// - Serving facets: every base set of `serving` × every `f` the `cf1-*` rows send (and the malformed witnesses), on
//   the public path the renderer passes (`/shop`, `/category/<slug>`; the tenant has no `urlPrefixes`).
import { afterAll, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { memoryDocClient, type MemoryDocClient } from "./memory-dynamo";
import { recorded, serialiseListing, type ListingCall, type ServingFacetCall } from "./golden";

const store = vi.hoisted(() => ({ client: null as null | { send: (c: any) => Promise<any> } }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    return { ...real, DynamoDBDocumentClient: { from: () => ({ send: (c: any) => store.client!.send(c) }) } };
});

import { getCatalogListing } from "../../src/lib/dynamo";
import { buildFacetListing } from "@capture/facets-real";
import { ITEMS, CM1, CF1 } from "../serving-contract/fixtures.mjs";

export const NOW = "2026-10-31T12:00:00.000Z";
const EDGE_TENANT = "cip1b-edge";
const pk = `TENANT#${EDGE_TENANT}`;
const edge = (id: string, fields: Record<string, unknown>) => ({
    PK: pk, SK: `PRODUCT#${id}`, id, title: `T ${id}`, slug: `s-${id}`, description: "not projected", brand: "B",
    attributes: [{ key: "k", value: id }], variants: [], ...fields,
});
export const EDGE_ITEMS = [
    edge("e01", { status: "active", categoryIds: ["A"], sortOrder: 0 }),
    edge("e02", { status: "draft", categoryIds: ["A"], sortOrder: 0 }),
    edge("e03", { categoryIds: ["A"], sortOrder: 0 }),                                       // legacy: no status
    edge("e04", { status: "active", categoryIds: ["A"], availableFrom: "2026-11-01" }),       // starts tomorrow
    edge("e05", { status: "active", categoryIds: ["A"], availableUntil: "2026-10-30" }),      // ended yesterday
    edge("e06", { status: "active", categoryIds: ["A"], availableFrom: "2026-10-31" }),       // starts today
    edge("e07", { status: "active", categoryIds: ["A"], availableUntil: "2026-10-31" }),      // ends today
    edge("e08", { status: "archived", categoryIds: ["A"] }),
    edge("e09", { status: "active", categoryIds: ["A", "B"], sortOrder: 2 }),
    edge("e10", { status: "active", categoryIds: ["B"], sortOrder: -1 }),
    edge("e11", { status: "active" }),                                                         // no categoryIds, no sortOrder
    edge("e12", { status: "active", categoryIds: "A" }),                                       // not an array
    edge("e13", { status: "", categoryIds: ["A"] }),                                           // empty status
    edge("e15b", { status: "active", categoryIds: ["B"], sortOrder: 1 }),
    edge("e15a", { status: "active", categoryIds: ["B"], sortOrder: 1 }),
    edge("e16", { status: "active", categoryIds: ["B"], availableFrom: "2026-10-01", availableUntil: "2026-12-01", price: "9.00" }),
    { PK: pk, SK: "CATEGORY#A", id: "A", status: "active" },                                  // not a product
    { PK: "TENANT#cip1b-other", SK: "PRODUCT#e01", id: "x01", status: "active", categoryIds: ["A"] }, // other tenant
];

const servingTenant = CM1.catalog.id;
const servingItems = (ITEMS as any[]).filter((i) => i.PK === `TENANT#${servingTenant}`);
const fixtures: Record<string, any[]> = { serving: servingItems, edge: EDGE_ITEMS };

const fOf = (pairs: [string, string][]) => new URLSearchParams(pairs).toString();
const serie = (n: number) => CF1.longValues[n - 1];
const x = "/".repeat(2000);
const padded = (pad: number) => fOf([1, 2, 3, 4].map((n) => ["a.Serie", serie(n)] as [string, string]).concat([["a.Serie", "Z" + "z".repeat(pad)]]));
/** Row `cf1-pager-guard`'s selection: its canonical href on `/category/cf1-many` is exactly 6,125 bytes. */
const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const hrefOf = (f: string) => `/category/cf1-many?f=${encodeURIComponent(f)}`;
const nearBudget = padded(6125 - bytes(hrefOf(padded(0))));
/** Every `f` a `cf1-*` row sends (as the page receives it, after Next's outer decode), plus the malformed witnesses. */
const SERVING_F: (string | undefined)[] = [
    undefined, "",
    fOf([["producator", "BOEN"]]), fOf([["producator", "ITC"]]), fOf([["producator", "KRONO"]]), fOf([["producator", "ALPOD"]]),
    fOf([["producator", "BOEN"], ["a.unitate", "ml"]]), fOf([["producator", "Nimeni"]]), fOf([["producator", "Atelier Nord"]]),
    fOf([["a.colecție", "Planks 138 mm"]]), fOf([["a.Pile weight", CF1.roundtripValue]]), fOf([["a.unitate", "ml"]]),
    fOf([["a.producator", "Atelier Nord"]]), fOf([["a.varianta", "Mat"]]), fOf([["varianta", "14x138x2200 mm"]]), fOf([["varianta", "Mat"]]),
    fOf([["a.Nordic swan", "da"]]), fOf([["a.Article no.", "BN-002"]]), fOf([["a.Color", CF1.colors[4]]]), fOf([["a.Inexistent", "x"]]),
    fOf([1, 2, 3, 4].map((n) => ["a.Serie", serie(n)] as [string, string])), fOf([2, 3, 4].map((n) => ["a.Serie", serie(n)] as [string, string])),
    nearBudget,
    "%zz", "colectie=%E0%A4%A", "colectie=a%", "&&", "zzz=1", "a.=1", "a.colec%C8%9Bie=%E0%A4%A", "a.colec%C8%9Bie=a%",
    `a.colecție=${x}A&a.colecție=${x}B`, `colectie=${x}A&colectie=${x}B`,
];

const listingCalls: ListingCall[] = [];
const servingCalls: ServingFacetCall[] = [];

describe("CAT-IMPORT-PROFILE-1B golden capture — base getCatalogListing and serving facet panels", () => {
    it("captures", async () => {
        process.env.TABLE_NAME = "cip1b-capture";
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(NOW));
        const scopes: Record<string, (string | undefined)[]> = {
            serving: [undefined, "floors", "cf1-boen", "cf1-alpod", "cf1-itc", "cf1-many", "missing"],
            edge: [undefined, "A", "B", "missing"],
        };
        for (const [fixture, items] of Object.entries(fixtures)) {
            const tenantId = fixture === "serving" ? servingTenant : EDGE_TENANT;
            for (const scope of scopes[fixture]) {
                const client: MemoryDocClient = memoryDocClient(items);
                store.client = client;
                const out = await getCatalogListing(tenantId, scope);
                expect(client.calls.length).toBeGreaterThan(0);
                listingCalls.push({ fixture, tenantId, scope: scope ?? null, out });
                if (fixture !== "serving" || scope === "missing") continue;
                const listingCall = listingCalls.length - 1;
                const path = scope === undefined ? "/shop" : `/category/${scope}`;
                for (const f of SERVING_F) {
                    const res = buildFacetListing(out, f, path);
                    servingCalls.push({ listingCall, f: f === undefined ? null : f, path, ...(recorded(serialiseListing(out, res)) as { digest: string }) });
                }
            }
        }
        vi.useRealTimers();
    });
});

afterAll(() => {
    writeFileSync(`${process.env.CAPTURE_DIR}/listing.json`, JSON.stringify({ now: NOW, fixtures, listingCalls, servingCalls }));
});
