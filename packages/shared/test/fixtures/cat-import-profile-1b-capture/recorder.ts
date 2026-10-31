// CAT-IMPORT-PROFILE-1B golden capture — the recording wrapper (runs ONLY inside the base worktree, see run.sh).
// The base test file `test/unit/facets.test.ts` imports `../../src/lib/facets`; the capture config aliases that
// specifier to this module. Every export of the REAL base module is re-exported unchanged; `buildFacetListing` and
// `facetValuesOf` call the real function and record (input, output). The base code itself is not edited.
import * as real from "@capture/facets-real";
import { recorded, serialiseListing, serialiseSelection, type FacetCall, type ValuesCall } from "./golden";
import { isDeepStrictEqual } from "node:util";

export * from "@capture/facets-real";

export const bases: unknown[][] = [];
const baseIndex = new Map<string, number>();
export const facetCalls: FacetCall[] = [];
export const valuesCalls: ValuesCall[] = [];

/** The input must survive JSON unchanged, or the replay would not be the same input. */
function jsonFaithful<T>(v: T): T {
    const copy = JSON.parse(JSON.stringify(v));
    if (!isDeepStrictEqual(copy, v)) throw new Error("capture: an input does not survive JSON: " + JSON.stringify(v).slice(0, 200));
    return copy;
}

export function buildFacetListing(base: any[], f: string | undefined, path: string) {
    const out = real.buildFacetListing(base, f, path);
    const key = JSON.stringify(jsonFaithful(base));
    let i = baseIndex.get(key);
    if (i === undefined) { i = bases.length; bases.push(JSON.parse(key)); baseIndex.set(key, i); }
    facetCalls.push({ base: i, f: f === undefined ? null : f, path, ...(recorded(serialiseListing(base, out)) as { digest: string }) });
    return out;
}

export function facetValuesOf(p: any) {
    const out = real.facetValuesOf(p);
    valuesCalls.push({ product: jsonFaithful(p), out: serialiseSelection(out) });
    return out;
}
