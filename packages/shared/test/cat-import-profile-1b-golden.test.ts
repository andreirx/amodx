// CAT-IMPORT-PROFILE-1B — preservation, baseline-backed (design docs/slices/cat-import-profile-1.md § 7.3 "1b golden").
// The golden was captured from the UNCHANGED base code (`fixtures/cat-import-profile-1b-capture/run.sh`); it holds
// every input and output of:
//   (1) every `buildFacetListing` / `facetValuesOf` call the base `renderer/test/unit/facets.test.ts` made;
//   (2) the base `getCatalogListing` over two fixtures (the serving catalog tenant, the membership edge cases) with the
//       clock fixed — replayed here through the shared `catalogListing` (the renderer replays it through
//       `getCatalogListing` itself, `renderer/test/unit/catalog-listing.test.ts`);
//   (3) `buildFacetListing` over the serving catalog tenant's base sets with every `f` the `cf1-*` rows send.
// No input product carries `facetModes`, so the shared functions must reproduce the golden exactly: an equal digest of
// the serialised output for every call, and a deep-equal output where the golden keeps it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildFacetListing, facetValuesOf } from "../src/facets";
import { catalogListing, utcDay } from "../src/catalog-listing";
import { recorded, serialiseListing, serialiseSelection, type Golden1b } from "./cat-import-profile-1b-golden";

const golden: Golden1b = JSON.parse(readFileSync(new URL("./fixtures/cat-import-profile-1b-baseline.json", import.meta.url), "utf8"));

/** Compares one recorded output with the candidate's: digest always, deep-equality where the golden kept `out`. */
function same(expected: { digest: string; out?: unknown }, candidate: unknown, label: string) {
    const got = recorded(candidate);
    if (expected.out !== undefined) expect(got.out, label).toEqual(expected.out);
    expect(got.digest, label).toBe(expected.digest);
}

describe("1b golden — the inputs hold no facetModes (the comparison is the no-modes case)", () => {
    it("no base product, listing fixture item or serving item carries `facetModes`", () => {
        const all = [...golden.facetsTest.bases.flat(), ...Object.values(golden.listing.fixtures).flat()];
        expect(all.length).toBeGreaterThan(40000);
        expect(all.filter((p: any) => p && typeof p === "object" && "facetModes" in p)).toEqual([]);
    });
});

describe("1b golden (1) — every buildFacetListing / facetValuesOf call of the base facets.test.ts", () => {
    it(`${golden.facetsTest.facetCalls.length} buildFacetListing calls reproduce the base outputs`, () => {
        expect(golden.facetsTest.facetCalls.length).toBe(2138);
        golden.facetsTest.facetCalls.forEach((c, i) => {
            const base = golden.facetsTest.bases[c.base] as any[];
            same(c, serialiseListing(base, buildFacetListing(base, c.f ?? undefined, c.path)), `call ${i}`);
        });
    });
    it("facetValuesOf calls reproduce the base outputs", () => {
        expect(golden.facetsTest.valuesCalls.length).toBeGreaterThan(0);
        for (const c of golden.facetsTest.valuesCalls) expect(serialiseSelection(facetValuesOf(c.product as any))).toEqual(c.out);
    });
});

describe("1b golden (2) — the shared catalogListing reproduces the base getCatalogListing membership and order", () => {
    const today = utcDay(new Date(golden.listing.now));
    it(`${golden.listing.calls.length} listing calls`, () => {
        expect(golden.listing.calls.length).toBe(11);
        for (const c of golden.listing.calls) {
            const items = golden.listing.fixtures[c.fixture].filter((i: any) => i.PK === `TENANT#${c.tenantId}` && String(i.SK).startsWith("PRODUCT#"));
            // The base read returned projected items; the rule decides membership and order, so compare the ids in order.
            expect(catalogListing(items, c.scope ?? undefined, today).map((p: any) => p.id), `${c.fixture} ${c.scope}`).toEqual(c.out.map((p) => p.id));
        }
    });
});

describe("1b golden (3) — the serving catalog tenant's panels", () => {
    it(`${golden.servingFacets.calls.length} buildFacetListing calls over the base listings reproduce the base outputs`, () => {
        expect(golden.servingFacets.calls.length).toBe(198);
        golden.servingFacets.calls.forEach((c, i) => {
            const base = golden.listing.calls[c.listingCall].out;
            same(c, serialiseListing(base, buildFacetListing(base, c.f ?? undefined, c.path)), `serving call ${i} ${c.path}`);
        });
    });
});
