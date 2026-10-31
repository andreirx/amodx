// CAT-IMPORT-PROFILE-1B — the filter modes of design docs/slices/cat-import-profile-1.md § 2.6 under the human's ruling
// CIP1-FILTER-PRECEDENCE = S-A with N2 (§ 11): the modes are copied onto products (`facetModes`); "always" overrides
// the repeat rule; "never" suppresses the OFFER only — a silent holder's values are not listed and do not count toward
// the offer, but they still match a selection and still count in the listed values' counts. § 7.4 "Facets (1b)": the
// § 2.6 tables row by row, the mixed-producer witness, an unknown mode value = automatic (§ 3.3 item 6).
// The no-modes row of the table ("identical") is the 1b golden (`cat-import-profile-1b-golden.test.ts`).
import { describe, expect, it } from "vitest";
import { VARIANT_FACET, attributeFacetId, buildFacetListing, formatSelection, type FacetListing, type Selection } from "../src/facets";

type Mode = { key: string; mode: string };
type P = {
    id: string;
    brand?: string;
    attributes?: { key: string; value: string }[];
    variants?: { id: string; name: string; options: { value: string }[] }[];
    facetModes?: unknown;
};
const SHOP = "/shop";
const kv = (pairs: [string, string][]) => pairs.map(([key, value]) => ({ key, value }));
const opts = (values: string[], name = "Format") => [{ id: "g", name, options: values.map((value) => ({ value })) }];
const modes = (attributes: Mode[], variant?: string) => ({ ...(variant !== undefined ? { variant } : {}), attributes });
const sel = (o: Record<string, string[]>): Selection => new Map(Object.entries(o).map(([k, v]) => [k, new Set(v)]));
const listing = (base: P[], o?: Record<string, string[]>, path = SHOP) => buildFacetListing(base, o ? formatSelection(sel(o)) : undefined, path);
const facet = (l: FacetListing<P>, id: string) => l.facets.find((f) => f.id === id);
const rows = (l: FacetListing<P>, id: string) => facet(l, id)?.values.map((v) => ({ state: v.state, value: v.value, count: v.count }));
const ids = (l: FacetListing<P>) => l.items.map((p) => p.id);
const A = attributeFacetId;
const withoutModes = (base: P[]) => base.map(({ facetModes: _drop, ...p }) => p);

// ── the mixed-producer witness (§ 2.6: same key, same value) ─────────────────────────────────────────────────────

describe("§ 2.6 mixed-producer witness — BOEN marks Esență never, producer X marks it always (N2 row of the table)", () => {
    const base: P[] = [
        { id: "b1", brand: "BOEN", attributes: kv([["Esență", "Oak"]]), facetModes: modes([{ key: "Esență", mode: "never" }]) },
        { id: "x1", brand: "X", attributes: kv([["Esență", "Oak"]]), facetModes: modes([{ key: "Esență", mode: "always" }]) },
        { id: "x2", brand: "X", attributes: kv([["Esență", "Oak"]]), facetModes: modes([{ key: "Esență", mode: "always" }]) },
        { id: "x3", brand: "X", attributes: kv([["Esență", "Ash"]]), facetModes: modes([{ key: "Esență", mode: "always" }]) },
    ];
    it("Esență is offered (not N3); listed values Oak (3), Ash (1) — b1 counts in Oak (not N1's 2)", () => {
        expect(rows(listing(base), A("Esență"))).toEqual([
            { state: "link", value: "Ash", count: 1 },
            { state: "link", value: "Oak", count: 3 },
        ]);
    });
    it("selecting Oak lists x1, x2 AND b1 (not N1, where b1 leaves the listing); Oak stays selected with count 3", () => {
        const l = listing(base, { [A("Esență")]: ["Oak"] });
        expect(new Set(ids(l))).toEqual(new Set(["x1", "x2", "b1"]));
        expect(ids(l)).toEqual(["b1", "x1", "x2"]);     // base order
        expect(rows(l, A("Esență"))).toEqual([
            { state: "link", value: "Ash", count: 1 },
            { state: "selected", value: "Oak", count: 3 },
        ]);
    });
    it("b1 keeps its attribute (the page shows Esență: Oak); the function does not change any item", () => {
        const snapshot = JSON.stringify(base);
        listing(base, { [A("Esență")]: ["Oak"] });
        expect(JSON.stringify(base)).toBe(snapshot);
        expect(base[0].attributes).toEqual([{ key: "Esență", value: "Oak" }]);
    });
    it("a value ONLY a silent holder has is not listed; selected through the URL it matches and shows with its count", () => {
        const b: P[] = [...base, { id: "b2", brand: "BOEN", attributes: kv([["Esență", "Pine"]]), facetModes: modes([{ key: "Esență", mode: "never" }]) }];
        expect(rows(listing(b), A("Esență"))!.map((r) => r.value)).toEqual(["Ash", "Oak"]);
        const l = listing(b, { [A("Esență")]: ["Pine"] });
        expect(ids(l)).toEqual(["b2"]);
        expect(rows(l, A("Esență"))).toEqual([
            { state: "link", value: "Ash", count: 1 },
            { state: "link", value: "Oak", count: 3 },
            { state: "selected", value: "Pine", count: 1 },
        ]);
    });
});

// ── the single-producer table of § 2.6 ───────────────────────────────────────────────────────────────────────────

describe("§ 2.6 single-producer table, row by row", () => {
    it("shop, 147 collections, ALPOD marks colecție always: today not offered (147 > 40); with the rule offered, 147 values (the panel closes a facet of > 10 values)", () => {
        const names = Array.from({ length: 147 }, (_, i) => `Colecția ${String(i + 1).padStart(3, "0")}`);
        const base: P[] = [
            ...names.map((n, i) => ({ id: `a${i}`, brand: "ALPOD", attributes: kv([["colecție", n]]), facetModes: modes([{ key: "colecție", mode: "always" }]) })),
            { id: "a-extra", brand: "ALPOD", attributes: kv([["colecție", names[0]]]), facetModes: modes([{ key: "colecție", mode: "always" }]) },
            { id: "boen", brand: "BOEN" },
        ];
        expect(facet(listing(withoutModes(base)), A("colecție"))).toBeUndefined();
        const values = rows(listing(base), A("colecție"))!;
        expect(values.length).toBe(147);
        expect(values.every((v) => v.state === "link")).toBe(true);
        expect(values[0]).toEqual({ state: "link", value: names[0], count: 2 });
    });

    it("BOEN category, BOEN marks Certificates never: today shown with one value (FSC on 3 of 5); with the rule not shown", () => {
        const base: P[] = [
            ...[1, 2, 3].map((n) => ({ id: `b${n}`, brand: "BOEN", attributes: kv([["Certificates", "FSC"], ["Wood", n === 1 ? "Oak" : "Ash"]]), facetModes: modes([{ key: "Certificates", mode: "never" }]) })),
            { id: "b4", brand: "BOEN", facetModes: modes([{ key: "Certificates", mode: "never" }]) },
            { id: "b5", brand: "BOEN", facetModes: modes([{ key: "Certificates", mode: "never" }]) },
        ];
        expect(rows(listing(withoutModes(base), undefined, "/category/boen"), A("Certificates"))).toEqual([{ state: "link", value: "FSC", count: 3 }]);
        const l = listing(base, undefined, "/category/boen");
        expect(facet(l, A("Certificates"))).toBeUndefined();
        // Only the marked key is affected: `Wood` (automatic) is still offered and shown.
        expect(rows(l, A("Wood"))).toEqual([{ state: "link", value: "Ash", count: 2 }, { state: "link", value: "Oak", count: 1 }]);
    });

    it("ITC category, ITC marks variant never: today `varianta` shown; with the rule not shown", () => {
        const itc = (id: string, values: string[]): P => ({ id, brand: "ITC", variants: opts(values, "Culoare"), facetModes: modes([], "never") });
        const base: P[] = [itc("i1", ["10", "34"]), itc("i2", ["34", "50"]), itc("i3", ["10 (2)", "77"])];
        expect(rows(listing(withoutModes(base), undefined, "/category/itc"), VARIANT_FACET)!.length).toBe(5);
        expect(facet(listing(base, undefined, "/category/itc"), VARIANT_FACET)).toBeUndefined();
    });

    it("shop with ITC (variant never) + BOEN (no mode): `varianta` lists BOEN's sizes only", () => {
        const base: P[] = [
            { id: "b1", brand: "BOEN", variants: opts(["14x138x2200 mm", "13,2x181x2200 mm"]) },
            { id: "b2", brand: "BOEN", variants: opts(["14x138x2200 mm"]) },
            { id: "i1", brand: "ITC", variants: opts(["10", "34"], "Culoare"), facetModes: modes([], "never") },
            { id: "i2", brand: "ITC", variants: opts(["34"], "Culoare"), facetModes: modes([], "never") },
        ];
        expect(rows(listing(withoutModes(base)), VARIANT_FACET)!.map((r) => r.value)).toEqual(["10", "13,2x181x2200 mm", "14x138x2200 mm", "34"]);
        expect(rows(listing(base), VARIANT_FACET)).toEqual([
            { state: "link", value: "13,2x181x2200 mm", count: 1 },
            { state: "link", value: "14x138x2200 mm", count: 2 },
        ]);
        // Matching kept: an ITC colour selected through the URL lists the ITC products, shown as selected.
        const l = listing(base, { [VARIANT_FACET]: ["34"] });
        expect(ids(l)).toEqual(["i1", "i2"]);
        // Counts of a facet ignore its own selection (§ 4.1, disjunctive), so the BOEN sizes stay links.
        expect(rows(l, VARIANT_FACET)).toEqual([
            { state: "link", value: "13,2x181x2200 mm", count: 1 },
            { state: "link", value: "14x138x2200 mm", count: 2 },
            { state: "selected", value: "34", count: 2 },
        ]);
    });

    it("k marked always, held by 1 of 20 products: today not offered (rule i); with the rule offered and shown (narrows 1 of 20)", () => {
        const base: P[] = Array.from({ length: 20 }, (_, i) => (i === 0
            ? { id: "p0", attributes: kv([["Finisaj", "Mat"]]), facetModes: modes([{ key: "Finisaj", mode: "always" }]) }
            : { id: `p${i}` }));
        expect(facet(listing(withoutModes(base)), A("Finisaj"))).toBeUndefined();
        expect(rows(listing(base), A("Finisaj"))).toEqual([{ state: "link", value: "Mat", count: 1 }]);
    });

    it("k marked always, every product holds one value: offered but NOT shown (cannot narrow)", () => {
        const base: P[] = [1, 2, 3].map((n) => ({ id: `p${n}`, attributes: kv([["Origine", "UE"]]), facetModes: modes([{ key: "Origine", mode: "always" }]) }));
        expect(facet(listing(base), A("Origine"))).toBeUndefined();
        // Selected through the URL it is shown (a selected facet is always shown — unchanged by the modes).
        expect(rows(listing(base, { [A("Origine")]: ["UE"] }), A("Origine"))).toEqual([{ state: "selected", value: "UE", count: 3 }]);
    });

    it("no facetModes, or an empty one, on every product: the result equals the result without the field", () => {
        const base: P[] = [
            { id: "p1", brand: "A", attributes: kv([["k", "x"]]), variants: opts(["s"]) },
            { id: "p2", brand: "B", attributes: kv([["k", "x"]]), variants: opts(["s", "m"]) },
            { id: "p3", brand: "B", attributes: kv([["k", "y"]]) },
        ];
        const plain = listing(base, { [A("k")]: ["x"] });
        for (const fm of [undefined, { attributes: [] }, modes([])]) {
            const l = listing(base.map((p) => ({ ...p, facetModes: fm })), { [A("k")]: ["x"] });
            expect({ facets: l.facets, chips: l.chips, ids: ids(l) }).toEqual({ facets: plain.facets, chips: plain.chips, ids: ids(plain) });
        }
    });
});

// ── N2 detail: the offer counts non-silent holders only ─────────────────────────────────────────────────────────

describe("N2 — a silent holder does not count toward the offer", () => {
    it("two silent + one automatic holder of the same value: today offered; with the modes rule (i) fails → not offered", () => {
        const base: P[] = [
            { id: "p1", attributes: kv([["Nod", "da"]]), facetModes: modes([{ key: "Nod", mode: "never" }]) },
            { id: "p2", attributes: kv([["Nod", "da"]]), facetModes: modes([{ key: "Nod", mode: "never" }]) },
            { id: "p3", attributes: kv([["Nod", "da"]]) },
            { id: "p4" },
        ];
        expect(rows(listing(withoutModes(base)), A("Nod"))).toEqual([{ state: "link", value: "da", count: 3 }]);
        expect(facet(listing(base), A("Nod"))).toBeUndefined();
    });
    it("one silent + two automatic holders: offered; the listed value counts all three holders", () => {
        const base: P[] = [
            { id: "p1", attributes: kv([["Nod", "da"]]), facetModes: modes([{ key: "Nod", mode: "never" }]) },
            { id: "p2", attributes: kv([["Nod", "da"]]) },
            { id: "p3", attributes: kv([["Nod", "da"]]) },
            { id: "p4" },
        ];
        expect(rows(listing(base), A("Nod"))).toEqual([{ state: "link", value: "da", count: 3 }]);
    });
    it("facet order counts EVERY holder (cat-facets-1 § 13; the modes change only the offer and the listed values): 3 holders (2 silent) sort before 2", () => {
        const base: P[] = [
            { id: "p1", attributes: kv([["Alfa", "1"]]), facetModes: modes([{ key: "Alfa", mode: "never" }]) },
            { id: "p2", attributes: kv([["Alfa", "1"]]), facetModes: modes([{ key: "Alfa", mode: "never" }]) },
            { id: "p3", attributes: kv([["Alfa", "2"]]), facetModes: modes([{ key: "Alfa", mode: "always" }]) },
            { id: "p4", attributes: kv([["Beta", "x"]]) },
            { id: "p5", attributes: kv([["Beta", "x"]]) },
            { id: "p6" },
        ];
        const order = listing(base).facets.map((f) => f.id).filter((id) => id.startsWith("a."));
        expect(order).toEqual([A("Alfa"), A("Beta")]);
        // Offer and listing still follow N2: only the non-silent holder's value is listed; counts include everyone.
        expect(rows(listing(base), A("Alfa"))).toEqual([{ state: "link", value: "2", count: 1 }]);
    });
    it("the producer facet has no mode: a `producator` key in facetModes is an attribute key, not the brand facet", () => {
        const base: P[] = [
            { id: "p1", brand: "A", facetModes: modes([{ key: "producator", mode: "never" }]) },
            { id: "p2", brand: "B", facetModes: modes([{ key: "producator", mode: "never" }]) },
        ];
        expect(rows(listing(base), "producator")).toEqual([{ state: "link", value: "A", count: 1 }, { state: "link", value: "B", count: 1 }]);
    });
});

// ── § 3.3 item 6: what this renderer does not know is automatic ─────────────────────────────────────────────────

describe("§ 3.3 item 6 — an unknown or malformed facetModes value = automatic", () => {
    const two = (fm: unknown): P[] => [
        { id: "p1", attributes: kv([["Nod", "da"]]), facetModes: fm },
        { id: "p2", attributes: kv([["Nod", "da"]]), facetModes: fm },
        { id: "p3" },
    ];
    const one = (fm: unknown): P[] => [{ id: "p1", attributes: kv([["Nod", "da"]]), facetModes: fm }, { id: "p2" }, { id: "p3" }];
    it("mode 'sometimes': not treated as never (offered by the repeat rule) and not as always (one holder → not offered)", () => {
        const fm = modes([{ key: "Nod", mode: "sometimes" }]);
        expect(rows(listing(two(fm)), A("Nod"))).toEqual([{ state: "link", value: "da", count: 2 }]);
        expect(facet(listing(one(fm)), A("Nod"))).toBeUndefined();
    });
    it("variant 'always' / 'maybe' (variant has only 'never'): automatic — the variant facet is listed", () => {
        for (const variant of ["always", "maybe"]) {
            const base: P[] = [
                { id: "p1", variants: opts(["s"]), facetModes: modes([], variant) },
                { id: "p2", variants: opts(["m"]), facetModes: modes([], variant) },
            ];
            expect(rows(listing(base), VARIANT_FACET)!.map((r) => r.value)).toEqual(["m", "s"]);
        }
    });
    it("malformed shapes (string, array, null, attributes not an array, entries without a key, upper-case mode): automatic", () => {
        for (const fm of ["never", ["never"], null, { attributes: "Nod" }, { attributes: [{ mode: "never" }] }, { attributes: [null, 3] }, modes([{ key: "Nod", mode: "NEVER" }])]) {
            expect(rows(listing(two(fm)), A("Nod")), JSON.stringify(fm)).toEqual([{ state: "link", value: "da", count: 2 }]);
            expect(facet(listing(one(fm)), A("Nod")), JSON.stringify(fm)).toBeUndefined();
        }
    });
    it("a key listed twice: the first entry decides (the importer writes each key once, checkProfile)", () => {
        expect(facet(listing(two(modes([{ key: "Nod", mode: "never" }, { key: "Nod", mode: "always" }]))), A("Nod"))).toBeUndefined();
        expect(rows(listing(one(modes([{ key: "Nod", mode: "always" }, { key: "Nod", mode: "never" }]))), A("Nod"))).toEqual([{ state: "link", value: "da", count: 1 }]);
        // An unknown first entry is automatic; it is not skipped in favour of a later one.
        expect(facet(listing(one(modes([{ key: "Nod", mode: "x" }, { key: "Nod", mode: "always" }]))), A("Nod"))).toBeUndefined();
    });
});
