// CAT-IMPORT-PROFILE-1B — the golden's record shape and its serialisation (design docs/slices/cat-import-profile-1.md
// § 7.3 "1b golden"). ONE serialiser, used by the capture (run against the base commit, `cat-import-profile-1b-capture/`)
// and by the comparisons (`cat-import-profile-1b-golden.test.ts` here, `renderer/test/unit/catalog-listing.test.ts`), so
// the golden and the candidate are reduced to plain JSON by the same code.
//
// Serialisation rules (each one keeps every observable of the output):
//   - a `Selection` (Map<id, Set<value>>) → `[id, [values…]][]` in insertion order (stricter than Map equality);
//   - `FacetListing.items` → the indices of the items in the base set, by identity (the function returns base
//     elements, never copies — the index list is the membership AND the order);
//   - an absent `f` (`undefined`) is written `null` and replayed as `undefined`;
//   - size: every recorded output carries `digest` = sha256 of `JSON.stringify` of its serialised form; the full
//     serialised form (`out`) is kept only when that string is ≤ FULL_OUTPUT_LIMIT bytes. The comparison checks the
//     digest for every call (equal digest = equal serialisation) and deep-equality where `out` is kept (a readable
//     diff). Without the limit the file is 72.8 MB (the 2,000-run property test and the 147-value greedy steps);
//     with 4,096 it is 7.3 MB, almost all of it inputs (`bases` 4.4 MB and the `f` strings), always kept in full.

import { createHash } from "node:crypto";

/** The fields of a `FacetListing` this serialiser knows. Kept structural so this file imports no implementation. */
type ListingLike = {
    items: unknown[];
    selection: Map<string, Set<string>>;
    tooLong: boolean;
    facets: unknown[];
    chips: unknown[];
    clearHref: string | null;
    budgetHint: boolean;
};

export const FULL_OUTPUT_LIMIT = 4096;

/** The digest the golden records for a serialised output, and the output itself when it is small enough. */
export function recorded(serialised: unknown): { digest: string; out?: unknown } {
    const json = JSON.stringify(serialised);
    const digest = createHash("sha256").update(json).digest("hex");
    return Buffer.byteLength(json, "utf8") <= FULL_OUTPUT_LIMIT ? { digest, out: JSON.parse(json) } : { digest };
}

export type SerialisedListing = {
    items: number[];
    selection: [string, string[]][];
    tooLong: boolean;
    facets: unknown[];
    chips: unknown[];
    clearHref: string | null;
    budgetHint: boolean;
};

export function serialiseSelection(sel: Map<string, Set<string>>): [string, string[]][] {
    return [...sel].map(([k, v]) => [k, [...v]]);
}

export function serialiseListing(base: readonly unknown[], out: ListingLike): SerialisedListing {
    return {
        items: out.items.map((p) => {
            const i = base.indexOf(p);
            if (i < 0) throw new Error("golden: a listed item is not an element of the base set");
            return i;
        }),
        selection: serialiseSelection(out.selection),
        tooLong: out.tooLong,
        facets: out.facets,
        chips: out.chips,
        clearHref: out.clearHref,
        budgetHint: out.budgetHint,
    };
}

/** One recorded `buildFacetListing(base, f, path)` call; `base` indexes `bases`. */
export type FacetCall = { base: number; f: string | null; path: string; digest: string; out?: SerialisedListing };
/** One recorded `facetValuesOf(product)` call. */
export type ValuesCall = { product: unknown; out: [string, string[]][] };
/** One recorded `getCatalogListing(tenantId, scope)` call over `fixture`; `scope` null = the shop. */
export type ListingCall = { fixture: string; tenantId: string; scope: string | null; out: Record<string, unknown>[] };
/** One `buildFacetListing` call over the output of `listing.calls[listingCall]` (the serving fixtures). */
export type ServingFacetCall = { listingCall: number; f: string | null; path: string; digest: string; out?: SerialisedListing };

export type Golden1b = {
    baseCommit: string;
    /** The test file whose every `buildFacetListing` / `facetValuesOf` call was recorded. */
    facetsTest: { source: string; bases: unknown[][]; facetCalls: FacetCall[]; valuesCalls: ValuesCall[] };
    /** `getCatalogListing` over the in-memory store, the clock fixed at `now`. */
    listing: { now: string; fixtures: Record<string, Record<string, unknown>[]>; calls: ListingCall[] };
    /** `buildFacetListing` over the serving catalog tenant's base sets, with the `f` values the `cf1-*` rows send. */
    servingFacets: { calls: ServingFacetCall[] };
};
