// CAT-IMPORT-PROFILE-1B golden capture — merges the two record files into the golden. Usage:
//   node merge.mjs <capture dir> <base commit> <output json>
import { readFileSync, writeFileSync } from "node:fs";
const [dir, baseCommit, out] = process.argv.slice(2);
const facets = JSON.parse(readFileSync(`${dir}/facets.test.ts.records.json`, "utf8"));
const listing = JSON.parse(readFileSync(`${dir}/listing.json`, "utf8"));
if (facets.facetCalls.length === 0) throw new Error("no buildFacetListing call was recorded — is the alias wired?");
const golden = {
    baseCommit,
    facetsTest: { source: "renderer/test/unit/facets.test.ts", bases: facets.bases, facetCalls: facets.facetCalls, valuesCalls: facets.valuesCalls },
    listing: { now: listing.now, fixtures: listing.fixtures, calls: listing.listingCalls },
    servingFacets: { calls: listing.servingCalls },
};
writeFileSync(out, JSON.stringify(golden) + "\n");
console.log(`bases ${golden.facetsTest.bases.length}, facetCalls ${golden.facetsTest.facetCalls.length}, valuesCalls ${golden.facetsTest.valuesCalls.length}, listing calls ${golden.listing.calls.length}, serving facet calls ${golden.servingFacets.calls.length}`);
