// CAT-FACETS-1 — units of `src/facets.ts` (spec docs/slices/cat-facets-1.md § 8.3, amended by § 13
// "CF1-FACET-SET-2"). Pure: no server, no DynamoDB, no React. Moved from `renderer/test/unit/` with the module by
// CAT-IMPORT-PROFILE-1B; only this header and the import path changed. The filter-mode rows are `facet-modes.test.ts`.
//
// Fixture shapes follow the measured data (§ 2.2, § 13): one `brand`, the four importer keys (`colecție`, `unitate`,
// `împachetare`, `comandă minimă`), a single variant group whose labels may be generated (`#<digits>`), and the
// spec-style keys that `cat-import-profile-1` will extract (`Wood`, `Pile weight`, `Article no.`, `Certificates`,
// `Color`). The 147 collection names below are the distinct `colecție` values of the 24 enriched files of
// 2026-08-02, extracted read-only with the importer's own `parseGlamCsv` + `planGlamImport`
// (docs/slices/cat-facets-1-impl.md, evidence X-2).
import { describe, expect, it } from "vitest";
import {
    HREF_BUDGET, PAGE_RESERVE, PRODUCER_FACET, VARIANT_FACET,
    attributeFacetId, buildFacetListing, compareValues, facetValuesOf, formatSelection, isFacetId, listingHref,
    matchesGeneratedLabelForm, parseSelection, selectionFits, utf8Bytes, type FacetListing, type Selection,
} from "../src/facets";

const MEASURED_COLLECTIONS: string[] = [
    "AURORA - Accessories / Skirtings",
    "AURORA - Design FLOOR covering click tiles from stone plastic composite (SPC)",
    "AURORA - Design FLOOR covering glue down tiles from stone plastic composite (SPC)",
    "AURORA - Design WALL covering click glue down tiles from stone plastic composite (SPC)",
    "Actiflex",
    "Adhesive",
    "Boflex Olympia",
    "Boflex Stadium",
    "CLASSEN - Water resistant laminate flooring",
    "COSMOFLOORITAN - Laminate CONTRACT 10/32 4V",
    "COSMOFLOORITAN - Laminate FUSION 8/33 with water repelent Aquastop base board",
    "COSMOFLOORITAN - Laminate HOME 7/31",
    "COSMOFLOORITAN - Laminate PRESTIGE 8/32 4V",
    "COSMOFLOORITAN - Laminate SONIC 12/33 4V",
    "COSMOFLOORITAN - Laminate STYLE 8/32",
    "COSMOFLOORITAN - Laminate VILLA 8/31",
    "Care products",
    "Castle planks 209 mm",
    "Chalet",
    "Chaletino",
    "Chevron",
    "EGGER PRO Accessories - Skirtings",
    "EGGER PRO Accessories - Underlays",
    "EGGER PRO Accessories / Corner elements",
    "EGGER PRO Accessories / Fixing clips",
    "EGGER PRO Accessories / Installation and Repair sets",
    "EGGER PRO DESIGN 2021  - Green Tec water resistant design flooring",
    "EGGER PRO Laminate 2021 - Laminate flooring",
    "EGGER PRO Laminate 2021 - Laminate flooring (ACTION decors)",
    "EVOLUTION - Water resistant laminate flooring (48 h)",
    "EXTERRA COMPOSITE - WPC decking boards",
    "EXTERRA COMPOSITE - accessories",
    "EXTERRA TIMBER - Accessories for installing decking / clips",
    "EXTERRA TIMBER - Accessories for installing decking / screws",
    "EXTERRA TIMBER - Decking / boards from exotic wood",
    "EXTERRA TIMBER - Decking / boards from softwood",
    "EXTERRA TIMBER -Accessories for installing decking / Pedestals",
    "FLEXCARE - Floor care products",
    "FLOOR EXPERTS - ISOFLEX Underlays",
    "FLOOR EXPERTS - ISOFLEX Underlays - Accessories",
    "FLOOR EXPERTS - Laminate ORIGINAL CLASSIC 7/31 AC3",
    "FLOOR EXPERTS - Laminate ORIGINAL COMFORT 8/32 AC4",
    "FLOOR EXPERTS - Laminate ORIGINAL EDITION 8/32 AC4 4V",
    "FLOOR EXPERTS - Laminate ORIGINAL EMOTION 7/31 AC3 4V",
    "FLOOR EXPERTS - Laminate ORIGINAL HYDRON 12/33 AC5 4V MO-RE",
    "FLOOR EXPERTS - Laminate ORIGINAL MARINE 8/32 AC4 4V MO-RE",
    "FLOOR EXPERTS - Laminate ORIGINAL NAUTIC 10/33 AC5 4V MO-RE",
    "FLOOR EXPERTS - Laminate ORIGINAL TOUCH 10/32 AC4 4V",
    "For repair work",
    "Gents 138mm",
    "HERITAGE ALPINE. 3-layer wood floors - narrow plank.",
    "HERITAGE CASTLE. 3-layer wood floors - extra wide plank.",
    "HERITAGE DREAM CLICK. 3-layer wood floors - wide plank, 5G click.",
    "HERITAGE DREAM. 3-layer wood floors - wide plank, t+g.",
    "HERITAGE LOUNGE. 3-layer wood floors - wide plank.",
    "HERITAGE PALACE. 3-layer wood floors - Mosaic wood tiles",
    "HERITAGE SOLID - EXOTIC. Prefinished solid Exotic species parquet.",
    "HERITAGE SOLID - OAK 18 mm. Prefinished solid Oak parquet thickness 18 mm.",
    "HERITAGE STYLE - LARGE. 2-layer parquet floors in large size.",
    "HERITAGE STYLE - MEDIUM CHEVRON. 2-layer parquet floors in medium size and Chevron pattern.",
    "HERITAGE STYLE - MEDIUM. 2-layer parquet floors in medium size.",
    "HERITAGE STYLE - PROJECT. 2-layer parquet floors on HDF.",
    "HERITAGE STYLE - QUICK. 2-layer parquet floors on HDF and click joint system..",
    "HERITAGE STYLE - SMALL. 2-layer parquet floors in small size.",
    "HERITAGE STYLE - X LARGE. 2-layer parquet floors in X-large size.",
    "Handcafted",
    "Herrinbone Click",
    "Herringbone Click Castle",
    "Herringbone light",
    "KRONO ORIGINAL - Accessories / PVC elements and clips",
    "KRONO ORIGINAL - Accessories / Skirtings",
    "KRONO ORIGINAL - Laminate",
    "KRONO ORIGINAL - Venereed floors",
    "KRONOTEX - Accessories / PVC elements and fixing clips",
    "KRONOTEX - Accessories / Skirtings",
    "KRONOTEX - Laminate",
    "LIFESTYLE - Laminate  Active 8/32",
    "LIFESTYLE - Laminate Adventure 8/32 4V Wide board",
    "LIFESTYLE - Laminate Classic 7/31",
    "LIFESTYLE - Laminate Fashion 8/32 4V",
    "LIFESTYLE - Laminate Fish Bone 8/32 4V (with Moisture Guard Core)",
    "LIFESTYLE - Laminate Modern 8/32 4V",
    "LIFESTYLE - Laminate Nature 8/32",
    "LIFESTYLE - Laminate Nomad 10/32 4V",
    "LIFESTYLE - Laminate Premium 12/33 4V Longboard (with Moisture Guard Core)",
    "LIFESTYLE - Laminate Royal 10/33 4V Longboard Wide (with Moisture Guard Core)",
    "LIFESTYLE - Laminate Tradition 12/33 4V (with Moisture Guard Core)",
    "LIFESTYLE - Laminate Trend 10/33 (with Moisture Guard Core)",
    "Longstrip 3-strips",
    "ORGANIC - ECO Design water resistant wood flooring*",
    "ORGANIC - Skirtings",
    "PROFILEX - Accessories for MDF skirting board - profile M30",
    "PROFILEX - Accessories for skirting board V02",
    "PROFILEX - HDF skirting board (water resistant) - profile H61",
    "PROFILEX - MDF skirting board - profile M01 and M02 (Cubic Square)",
    "PROFILEX - MDF skirting board - profile M10 (Cubic Slanted)",
    "PROFILEX - MDF skirting board - profile M20, M21 and M22 (Cubic Chamfered)",
    "PROFILEX - MDF skirting board - profile M30 (Slanted)",
    "PROFILEX - MDF skirting board - profile M40, M41 and M42 (Hamburg)",
    "PROFILEX - MDF skirting board - profile M50, M51 and M52 (Rounded)",
    "PROFILEX - MDF skirting board - profile M61",
    "PROFILEX - PVC waterproof skirting - profile P01",
    "PROFILEX - PVC waterproof skirting - profile P10",
    "PROFILEX - Veneered skirting board (on spruce base) - profile V01",
    "PROFILEX - Veneered skirting board (on spruce base) - profile V02",
    "PROFILEX - Veneered skirting board (on spruce base) - profile V03",
    "PROFILEX - Veneered skirting board (on spruce base) - profile V04",
    "PROFILEX - Veneered skirting board (on spruce base) - profile V10 (Cubical)",
    "PROFILEX - Veneered skirting board (on spruce base) - profile V11 (Cubical)",
    "PROFILEX - Veneered skirting board (on spruce base) - profile V12 (Cubical)",
    "PROFILEX - Veneered skirting board (on spruce base) - profile V13 (Cubical)",
    "PROFILEX - Veneered skirting board (on spruce base) - profile V14 (Cubical)",
    "PROFILEX - Veneered skirting board (on spruce base) - profile V15 (Cubical)",
    "PROFILPAS Profiles for LVT (PVC) floors",
    "PROFILPAS aluminium angle profiles",
    "PROFILPAS aluminium base profiles",
    "PROFILPAS aluminium diletation profiles",
    "PROFILPAS aluminium finishing elements",
    "PROFILPAS aluminium finishing profiles",
    "PROFILPAS aluminium finishing skirtings",
    "PROFILPAS aluminium leveling profiles",
    "PROFILPAS aluminium stair profiles",
    "PROFILPAS aluminium transition profiles",
    "Planks 138 mm",
    "Planks 138mm",
    "Planks 181mm",
    "Prestige",
    "Prices in EUR per m², valid from 01.03.2024, ex works Tielt, Belgium",
    "SILTEX - protecting Chairmats from polycarbonate and PET",
    "SPC composite flooring XL, thickness 5,5 mm (4,5 mm SPC + 1 mm cork underlaymnet), wear layer 0,55 mm (33/42)",
    "SPC composite flooring XL, thickness 6,0 mm (5,0 mm SPC + 1 mm cork underlaymnet), wear layer 0,70 mm (34/43)",
    "SPC composite flooring in chevron pattern, thickness 6,0 mm (5,0 mm SPC + 1 mm cork underlaymnet), wear layer 0,55 mm (33/42)",
    "SPC composite flooring in fish bone pattern, thickness 5,5 mm (4,5 mm SPC + 1 mm cork underlaymnet), wear layer 0,55 mm (33/42)",
    "SPC composite flooring,  6 mm thickness (5 mm SPC + 1 mm cork underlaymnet), wear layer 0,55 mm (33/42)",
    "SPC composite flooring,  thickness 4,5 mm (3,5 mm SPC + 1 mm IXPE underlaymnet), wear layer 0,30 mm (23/31)",
    "SPC composite flooring,  thickness 5 mm (4 mm SPC + 1 mm IXPE underlaymnet), wear layer 0,40 mm (23/32)",
    "SPC composite flooring,  thickness 5 mm (4 mm SPC + 1 mm IXPE underlaymnet), wear layer 0,55 mm (33/42)",
    "Skirting board Design 17",
    "Skirting boards from parquet",
    "Skirting boards veneered",
    "Skirting old-German profile",
    "Stair nosings",
    "Traffic",
    "Underlay systems",
    "Vinyl flooring in tiles, 2.0 mm thickness, wear layer 0.3 mm (23/31)",
    "Vinyl flooring in tiles, 2.5 mm thickness, wear layer 0.55 mm (33/42)",
    "Vinyl flooring in tiles, 4.2 mm thickness, wear layer 0.55 mm (33/42)",
];

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────

type P = { id: string; brand?: string; attributes?: { key: string; value: string }[]; variants?: { id: string; name: string; options: { value: string }[] }[] };
const PATH = "/shop";
const attrs = (pairs: Record<string, string>) => Object.entries(pairs).map(([key, value]) => ({ key, value }));
const opts = (values: string[], name = "Format") => [{ id: "format", name, options: values.map((value) => ({ value })) }];
const A = attributeFacetId;
/** Tests name a facet by its source: the two fixed ids as they are, any other name as an `attributes` key (→ `a.<key>`).
 *  The collision rows below, where an attribute is literally named `producator` / `varianta`, build ids explicitly. */
const fid = (name: string) => (name === PRODUCER_FACET || name === VARIANT_FACET ? name : A(name));
const sel = (o: Record<string, string[]>): Selection => new Map(Object.entries(o).map(([k, v]) => [fid(k), new Set(v)]));
const listing = (base: P[], o?: Record<string, string[]>, path = PATH) => buildFacetListing(base, o ? formatSelection(sel(o)) : undefined, path);
const ids = (l: FacetListing<P>) => l.items.map((p) => p.id);
const facet = (l: FacetListing<P>, name: string) => l.facets.find((x) => x.id === fid(name));
const counts = (l: FacetListing<P>, id: string) => Object.fromEntries(facet(l, id)!.values.map((v) => [v.value, v.count]));
const asPlain = (s: Selection) => Object.fromEntries([...s].map(([k, v]) => [k, [...v].sort()]));
/** Every href the panel model emits (values, chips, clear) plus the pager links of a 10-digit page number. */
function emittedHrefs(l: FacetListing<P>, path = PATH): string[] {
    const out: string[] = [];
    for (const f of l.facets) for (const v of f.values) if ((v.state === "link" || v.state === "selected") && v.href) out.push(v.href);
    for (const c of l.chips) if (c.href) out.push(c.href);
    if (l.clearHref) out.push(l.clearHref);
    out.push(listingHref(path, l.selection, 2), listingHref(path, l.selection, 9_999_999_999));
    return out;
}
/** Deterministic PRNG (mulberry32) so the property runs are reproducible. */
function rng(seed: number) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── § 2.3 visibility ────────────────────────────────────────────────────────────────────────────────────────────

describe("§ 2.3 — a facet is shown iff selecting could change the listing", () => {
    it("{ml, ml, —} → `unitate` shown with ml (2); selecting ml lists {p1, p2}", () => {
        const base: P[] = [{ id: "p1", attributes: attrs({ unitate: "ml" }) }, { id: "p2", attributes: attrs({ unitate: "ml" }) }, { id: "p3" }];
        expect(facet(listing(base), "unitate")?.values).toEqual([{ state: "link", value: "ml", count: 2, href: listingHref(PATH, sel({ unitate: ["ml"] })) }]);
        expect(ids(listing(base, { unitate: ["ml"] }))).toEqual(["p1", "p2"]);
    });
    it("{ml, ml} → `unitate` hidden", () => {
        expect(facet(listing([{ id: "p1", attributes: attrs({ unitate: "ml" }) }, { id: "p2", attributes: attrs({ unitate: "ml" }) }]), "unitate")).toBeUndefined();
    });
    it("variant {A,B},{A,B} → hidden; {A,B},{A} → shown (B narrows; A is listed too)", () => {
        expect(facet(listing([{ id: "p1", variants: opts(["A", "B"]) }, { id: "p2", variants: opts(["A", "B"]) }]), VARIANT_FACET)).toBeUndefined();
        expect(counts(listing([{ id: "p1", variants: opts(["A", "B"]) }, { id: "p2", variants: opts(["A"]) }]), VARIANT_FACET)).toEqual({ A: 2, B: 1 });
    });
    it("producer on its own category (every product has the brand) → hidden; a key no product holds → hidden", () => {
        const l = listing([{ id: "p1", brand: "BOEN" }, { id: "p2", brand: "BOEN" }]);
        expect(facet(l, PRODUCER_FACET)).toBeUndefined();
        expect(facet(l, "comandă minimă")).toBeUndefined();
    });
    it("a facet with a selection is shown even when the base set gives it no narrowing value", () => {
        const base: P[] = [{ id: "p1", attributes: attrs({ unitate: "ml" }) }, { id: "p2", attributes: attrs({ unitate: "ml" }) }];
        const l = listing(base, { unitate: ["ml"] });
        expect(facet(l, "unitate")?.values).toEqual([{ state: "selected", value: "ml", count: 2, href: PATH }]);
        expect(ids(l)).toEqual(["p1", "p2"]);
    });
});

// ── § 4.1 counts and combination ────────────────────────────────────────────────────────────────────────────────

describe("§ 4.1 — OR within a facet, AND across facets; disjunctive counts", () => {
    it("single-valued worked example: X selected → {p1, p3}, counts X 2 Y 1; adding Y → 3 = 2 + 1", () => {
        const base: P[] = [
            { id: "p1", attributes: attrs({ colecție: "X" }) }, { id: "p2", attributes: attrs({ colecție: "Y" }) }, { id: "p3", attributes: attrs({ colecție: "X" }) },
        ];
        const l = listing(base, { colecție: ["X"] });
        expect(ids(l)).toEqual(["p1", "p3"]);
        expect(counts(l, "colecție")).toEqual({ X: 2, Y: 1 });
        expect(ids(listing(base, { colecție: ["X", "Y"] }))).toEqual(["p1", "p2", "p3"]);
    });
    it("multi-valued worked example: A selected → {p1, p3}, counts A 2 B 2; adding B → 3, not 2 + 2", () => {
        const base: P[] = [{ id: "p1", variants: opts(["A", "B"]) }, { id: "p2", variants: opts(["B"]) }, { id: "p3", variants: opts(["A"]) }];
        const l = listing(base, { [VARIANT_FACET]: ["A"] });
        expect(ids(l)).toEqual(["p1", "p3"]);
        expect(counts(l, VARIANT_FACET)).toEqual({ A: 2, B: 2 });
        expect(ids(listing(base, { [VARIANT_FACET]: ["A", "B"] }))).toHaveLength(3);
    });
    it("counts of one facet are computed under the OTHER facets' selections; a zero-count value is disabled", () => {
        const base: P[] = [
            { id: "p1", attributes: attrs({ colecție: "X", unitate: "ml" }) }, { id: "p2", attributes: attrs({ colecție: "X", unitate: "buc" }) },
            { id: "p3", attributes: attrs({ colecție: "Y", unitate: "ml" }) }, { id: "p4", attributes: attrs({ colecție: "Y", unitate: "buc" }) },
            { id: "p5", attributes: attrs({ colecție: "X", unitate: "ml" }) }, { id: "p6", attributes: attrs({ colecție: "Z", unitate: "buc" }) },
            { id: "p7", attributes: attrs({ colecție: "Z", unitate: "buc" }) },
        ];
        const l = listing(base, { unitate: ["ml"] });
        expect(ids(l)).toEqual(["p1", "p3", "p5"]);
        expect(counts(l, "colecție")).toEqual({ X: 2, Y: 1, Z: 0 });
        expect(facet(l, "colecție")!.values.find((v) => v.value === "Z")).toEqual({ state: "zero", value: "Z", count: 0 });
        // The selected facet's own counts ignore its own selection.
        expect(counts(l, "unitate")).toEqual({ buc: 4, ml: 3 });
    });
    it("a product without a value for F stays while F has no selection and leaves once F has one", () => {
        const base: P[] = [{ id: "p1", brand: "A" }, { id: "p2", brand: "B" }, { id: "p3" }];
        expect(ids(listing(base))).toEqual(["p1", "p2", "p3"]);
        expect(ids(listing(base, { [PRODUCER_FACET]: ["A"] }))).toEqual(["p1"]);
    });
    it("§ 4.3 a stale value matches nothing and stays as a removable selection; an unknown id is ignored", () => {
        const base: P[] = [{ id: "p1", brand: "A" }, { id: "p2", brand: "B" }];
        const stale = listing(base, { [PRODUCER_FACET]: ["Gone"] });
        expect(ids(stale)).toEqual([]);
        expect(facet(stale, PRODUCER_FACET)!.values).toContainEqual({ state: "selected", value: "Gone", count: 0, href: PATH });
        expect(stale.chips).toEqual([{ facetLabel: "Producător", value: "Gone", href: PATH }]);
        const unknown = buildFacetListing(base, "zzz=1", PATH);
        expect(ids(unknown)).toEqual(["p1", "p2"]);
        expect(unknown.selection.size).toBe(0);
        expect(unknown.chips).toEqual([]);
    });
});

// ── generated labels ────────────────────────────────────────────────────────────────────────────────────────────

describe("§ 2.3 / § 12 amendment 1 — `#<digits>` labels are not values", () => {
    it("#1…#44 excluded, a read label and a duplicate-suffixed label kept", () => {
        const generated = Array.from({ length: 44 }, (_, i) => `#${i + 1}`);
        const values = facetValuesOf({ variants: opts([...generated, "14x138x2200 mm", "14x138x2200 mm (2)"]) }).get(VARIANT_FACET);
        expect([...values!]).toEqual(["14x138x2200 mm", "14x138x2200 mm (2)"]);
        expect(matchesGeneratedLabelForm("#12")).toBe(true);
        for (const kept of ["#12a", "# 1", "#", "12", "Nr. #3"]) expect(matchesGeneratedLabelForm(kept)).toBe(false);
    });
});

// ── value order ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("§ 2.3 — value order is a total order", () => {
    it('"2"/"02" sort the same from both input orders; numbers sort as numbers', () => {
        expect(["2", "02"].sort(compareValues)).toEqual(["02", "2"]);
        expect(["02", "2"].sort(compareValues)).toEqual(["02", "2"]);
        expect(["10", "9", "1"].sort(compareValues)).toEqual(["1", "9", "10"]);
    });
    it("cmp(a, b) === 0 only when a === b, and cmp is antisymmetric", () => {
        const sample = ["2", "02", "002", "a", "A", "á", "s", "ș", "ş", "10", "9", "Planks 138 mm", "planks 138 mm", "", " "];
        for (const a of sample) for (const b of sample) {
            expect(compareValues(a, b) === 0).toBe(a === b);
            expect(Math.sign(compareValues(a, b)) + Math.sign(compareValues(b, a))).toBe(0);
        }
    });
});

// ── § 4.4 / § 5.1 URL form ──────────────────────────────────────────────────────────────────────────────────────

describe("§ 4.4 / § 5.1 — parseSelection and formatSelection", () => {
    const c = (x: string) => formatSelection(parseSelection(x));
    it("round trip for every measured value class", () => {
        const s = sel({
            [PRODUCER_FACET]: ["BOEN", "ALPOD"],
            [VARIANT_FACET]: ["13,2x181x2200 mm", "14x138x2200 mm (2)"],
            colecție: ["EXTERRA TIMBER - Accessories for installing decking / clips", "Parchet stejar ș ț ă î â"],
            "comandă minimă": ["10 m²", "a+b", "a&b", "a=b", "100%", "%zz", "(x)"],
            "Pile weight": ["1.050 g/m²"],
        });
        expect(asPlain(parseSelection(formatSelection(s)))).toEqual(asPlain(s));
    });
    it("the malformed witnesses give exactly the § 4.4 selection, and c(c(x)) === c(x)", () => {
        // The § 4.4 witnesses on an attribute id (`a.colectie`), and the same witnesses on the bare name `colectie`, which
        // is not a facet id under the identity rule (operator ruling 2) and is dropped by step 3.
        const cases: [string, Record<string, string[]>][] = [
            ["%zz", {}],
            ["a.colectie=%E0%A4%A", { "a.colectie": ["�%A"] }],
            ["a.colectie=a%", { "a.colectie": ["a%"] }],
            ["&&", {}],
            ["=x", {}],
            ["a.colectie", {}],
            ["a.colectie=a&a.colectie=a&a.colectie=a", { "a.colectie": ["a"] }],
            ["", {}],
            ["colectie=%E0%A4%A", {}],
            ["colectie=a%", {}],
            ["a.=x", {}],
            ["A.colectie=x", {}],
            ["producator=BOEN&zzz=1", { producator: ["BOEN"] }],
        ];
        for (const [x, expected] of cases) {
            expect(asPlain(parseSelection(x)), x).toEqual(expected);
            expect(c(c(x)), x).toBe(c(x));
        }
        expect(parseSelection(undefined).size).toBe(0);
    });
    it("order independence, including the tie witness and the key order (producer, variant, then keys by cmp)", () => {
        const a: Selection = new Map([[A("Wood"), new Set(["oak"])], [VARIANT_FACET, new Set(["2", "02"])], [PRODUCER_FACET, new Set(["BOEN"])], [A("colecție"), new Set(["X"])]]);
        const b: Selection = new Map([[A("colecție"), new Set(["X"])], [PRODUCER_FACET, new Set(["BOEN"])], [VARIANT_FACET, new Set(["02", "2"])], [A("Wood"), new Set(["oak"])]]);
        expect(formatSelection(a)).toBe(formatSelection(b));
        expect(formatSelection(a)).toBe("producator=BOEN&varianta=02&varianta=2&a.colec%C8%9Bie=X&a.Wood=oak");
        expect(formatSelection(new Map())).toBe("");
        expect(listingHref(PATH, new Map())).toBe(PATH);
    });
    it("identity rule: the fixed ids, and `a.` + a non-empty key; nothing else is a facet id", () => {
        for (const id of [PRODUCER_FACET, VARIANT_FACET, "a.colecție", "a.producator", "a.varianta", "a.a.", "a. "]) expect(isFacetId(id), id).toBe(true);
        for (const id of ["", "a.", "colectie", "Wood", "A.x", "producator ", "Producator", ".a"]) expect(isFacetId(id), id).toBe(false);
    });
    it("the § 5.1 example, in the § 13 key order (variant before the attribute keys)", () => {
        const s = sel({ colectie: ["Planks 138 mm"], [VARIANT_FACET]: ["14x138x2200 mm", "13,2x181x2200 mm"] });
        expect(formatSelection(s)).toBe("varianta=13%2C2x181x2200+mm&varianta=14x138x2200+mm&a.colectie=Planks+138+mm");
        expect(listingHref("/category/boen", s)).toBe("/category/boen?f=varianta%3D13%252C2x181x2200%2Bmm%26varianta%3D14x138x2200%2Bmm%26a.colectie%3DPlanks%2B138%2Bmm");
        expect(listingHref("/category/boen", s, 3)).toMatch(/&page=3$/);
        expect(listingHref("/category/boen", new Map(), 3)).toBe("/category/boen?page=3");
    });
});

// ── § 13 data-driven facet set ──────────────────────────────────────────────────────────────────────────────────

describe("§ 13 — the repeat rule, the facet order and the labels", () => {
    const many = (n: number, make: (i: number) => P) => Array.from({ length: n }, (_, i) => make(i));
    /** The shown facets of a base set with no selection, by name (attribute facets by their key). */
    const offeredIds = (base: P[]) => buildFacetListing(base, undefined, PATH).facets.map((f) => (f.id.startsWith("a.") ? f.id.slice(2) : f.id));

    it("a spec key held by ≥ 2 products, top value held by ≥ 2, ≤ 40 values → offered (label = key as stored)", () => {
        const base: P[] = [
            { id: "p1", attributes: attrs({ Wood: "Oak" }) }, { id: "p2", attributes: attrs({ Wood: "Oak" }) }, { id: "p3", attributes: attrs({ Wood: "Ash" }) },
        ];
        expect(buildFacetListing(base, undefined, PATH).facets).toEqual([{ id: "a.Wood", label: "Wood", values: [
            { state: "link", value: "Ash", count: 1, href: listingHref(PATH, sel({ Wood: ["Ash"] })) },
            { state: "link", value: "Oak", count: 2, href: listingHref(PATH, sel({ Wood: ["Oak"] })) },
        ] }]);
    });
    it("(i) fails: one holder → not offered. (i) cannot fail ALONE: (ii) (top value on ≥ 2 products) implies (i)", () => {
        expect(offeredIds([{ id: "p1", attributes: attrs({ "Nordic swan": "yes" }) }, { id: "p2" }, { id: "p3" }])).toEqual([]);
    });
    it("(ii) fails alone: a value unique to each product (article number) → not offered", () => {
        expect(offeredIds(many(5, (i) => ({ id: `p${i}`, attributes: attrs({ "Article no.": `A-${i}` }) })))).toEqual([]);
    });
    it("(iii) fails alone: 40 distinct values → offered, 41 → not offered", () => {
        const withValues = (n: number) => [
            { id: "dup", attributes: attrs({ Color: "c0" }) },
            ...many(n, (i) => ({ id: `p${i}`, attributes: attrs({ Color: `c${i}` }) })),
        ];
        expect(offeredIds(withValues(40))).toEqual(["Color"]);
        expect(offeredIds(withValues(41))).toEqual([]);
    });
    it("a one-value key held by every product passes the repeat rule but is hidden by § 2.3 (Certificates)", () => {
        expect(offeredIds(many(3, (i) => ({ id: `p${i}`, attributes: attrs({ Certificates: "FSC" }) })))).toEqual([]);
        expect(offeredIds([...many(3, (i) => ({ id: `p${i}`, attributes: attrs({ Certificates: "FSC" }) })), { id: "x" }])).toEqual(["Certificates"]);
    });
    it("today's `colecție` on the glam shop page (147 values) is NOT offered — rule (iii) applies to every key", () => {
        const base = MEASURED_COLLECTIONS.flatMap((name, i) => [{ id: `a${i}`, attributes: attrs({ colecție: name }) }, { id: `b${i}`, attributes: attrs({ colecție: name }) }]);
        expect(MEASURED_COLLECTIONS).toHaveLength(147);
        expect(offeredIds(base)).toEqual([]);
    });
    it("order: producer, variant, then keys by holders (descending), ties by cmp on the key", () => {
        const base: P[] = [
            { id: "p1", brand: "BOEN", variants: opts(["A"]), attributes: attrs({ colecție: "X", Wood: "Oak", "Pile weight": "1", Treatment: "Oil" }) },
            { id: "p2", brand: "BOEN", variants: opts(["B"]), attributes: attrs({ colecție: "X", Wood: "Oak", "Pile weight": "1", Treatment: "Oil" }) },
            { id: "p3", brand: "ITC", variants: opts(["A"]), attributes: attrs({ colecție: "Y", Wood: "Ash", "Pile weight": "2", Treatment: "Lacquer" }) },
            { id: "p4", brand: "ITC", variants: opts(["B"]), attributes: attrs({ colecție: "Y", Wood: "Ash", "Pile weight": "2" }) },
            { id: "p5", attributes: attrs({ colecție: "X" }) },
        ];
        expect(offeredIds(base)).toEqual([PRODUCER_FACET, VARIANT_FACET, "colecție", "Pile weight", "Wood", "Treatment"]);
        const labels = buildFacetListing(base, undefined, PATH).facets.map((f) => f.label);
        expect(labels).toEqual(["Producător", "Format", "colecție", "Pile weight", "Wood", "Treatment"]);
    });
    it("§ 4.5 variant heading: the shared group name, else Variantă", () => {
        const mixed: P[] = [{ id: "p1", variants: opts(["A"], "Format") }, { id: "p2", variants: opts(["B"], "Culoare") }];
        expect(facet(listing(mixed), VARIANT_FACET)!.label).toBe("Variantă");
    });
});

// ── operator ruling 2 on review-0: attributes named `producator` / `varianta` are facets of their own ─────────────

describe("ruling 2 — fixed facets and attribute facets have separate identities", () => {
    // p1, p2: brand A; p3: brand B. Attribute `producator` = Z, Z, Y; attribute `varianta` = Mat, Lucios, Mat;
    // option values V1, V2, V1. Every source narrows, so all four facets are offered.
    const base: P[] = [
        { id: "p1", brand: "A", variants: opts(["V1"]), attributes: attrs({ producator: "Z", varianta: "Mat" }) },
        { id: "p2", brand: "A", variants: opts(["V2"]), attributes: attrs({ producator: "Z", varianta: "Lucios" }) },
        { id: "p3", brand: "B", variants: opts(["V1"]), attributes: attrs({ producator: "Y", varianta: "Mat" }) },
    ];
    const raw = (pairs: [string, string][]) => buildFacetListing(base, new URLSearchParams(pairs).toString(), PATH);
    const byId = (l: FacetListing<P>, id: string) => Object.fromEntries(l.facets.find((x) => x.id === id)!.values.map((v) => [v.value, v.count]));

    it("both attributes are offered, labelled with the key as stored, next to the fixed facets", () => {
        const l = raw([]);
        expect(l.facets.map((f) => [f.id, f.label])).toEqual([
            [PRODUCER_FACET, "Producător"], [VARIANT_FACET, "Format"], ["a.producator", "producator"], ["a.varianta", "varianta"],
        ]);
        expect(byId(l, PRODUCER_FACET)).toEqual({ A: 2, B: 1 });
        expect(byId(l, "a.producator")).toEqual({ Y: 1, Z: 2 });
    });
    it("the attribute `producator` filters on the attribute, the fixed `producator` on the brand", () => {
        expect(ids(raw([["a.producator", "Z"]]))).toEqual(["p1", "p2"]);
        expect(ids(raw([[PRODUCER_FACET, "Z"]]))).toEqual([]);
        expect(ids(raw([[PRODUCER_FACET, "B"]]))).toEqual(["p3"]);
        expect(ids(raw([[PRODUCER_FACET, "A"], ["a.producator", "Y"]]))).toEqual([]);
        const l = raw([["a.producator", "Z"]]);
        expect(byId(l, PRODUCER_FACET)).toEqual({ A: 2, B: 0 });
        expect(l.chips).toEqual([{ facetLabel: "producator", value: "Z", href: PATH }]);
    });
    it("the attribute `varianta` filters on the attribute, the fixed `varianta` on the option values", () => {
        expect(ids(raw([["a.varianta", "Mat"]]))).toEqual(["p1", "p3"]);
        expect(ids(raw([[VARIANT_FACET, "V2"]]))).toEqual(["p2"]);
        expect(ids(raw([[VARIANT_FACET, "Mat"]]))).toEqual([]);
        expect(ids(raw([[VARIANT_FACET, "V1"], ["a.varianta", "Lucios"]]))).toEqual([]);
        expect(byId(raw([[VARIANT_FACET, "V1"]]), "a.varianta")).toEqual({ Lucios: 0, Mat: 2 });
    });
    it("round trip, canonical order and fixed point hold with the colliding names", () => {
        const s: Selection = new Map([["a.varianta", new Set(["Mat"])], ["a.producator", new Set(["Z"])], [VARIANT_FACET, new Set(["V1"])], [PRODUCER_FACET, new Set(["A"])]]);
        const text = formatSelection(s);
        expect(text).toBe("producator=A&varianta=V1&a.producator=Z&a.varianta=Mat");
        expect(asPlain(parseSelection(text))).toEqual(asPlain(s));
        expect(formatSelection(parseSelection(text))).toBe(text);
    });
});

// ── operator ruling 1 on review-0: a selection outlives the key's eligibility ─────────────────────────────────────

describe("ruling 1 — a selected key is applied and shown whether or not it is offered", () => {
    const many = (n: number, make: (i: number) => P) => Array.from({ length: n }, (_, i) => make(i));
    /** The facet of the selected key renders ONLY its selected values (nothing can be added to a key not offered). */
    function expectKeptSelection(l: FacetListing<P>, key: string, value: string, items: string[]) {
        expect(ids(l)).toEqual(items);
        expect(l.chips).toEqual([{ facetLabel: key, value, href: PATH }]);
        expect(facet(l, key)).toEqual({ id: A(key), label: key, values: [{ state: "selected", value, count: items.length, href: PATH }] });
    }
    it("(i) fails — one holder: the selection filters, its chip and its facet are shown, removable", () => {
        const base: P[] = [{ id: "p1", attributes: attrs({ Wood: "Ash" }) }, { id: "p2" }, { id: "p3" }];
        expect(facet(listing(base), "Wood")).toBeUndefined();               // not offered without a selection
        expectKeptSelection(listing(base, { Wood: ["Ash"] }), "Wood", "Ash", ["p1"]);
        // The review-0 reproduction: a value no product holds → empty listing, the selection stays removable.
        const stale = listing(base, { Wood: ["Oak"] });
        expect(ids(stale)).toEqual([]);
        expect(stale.chips).toEqual([{ facetLabel: "Wood", value: "Oak", href: PATH }]);
    });
    it("(ii) fails — a value per product (article number)", () => {
        const base = many(4, (i) => ({ id: `p${i}`, brand: i < 2 ? "A" : "B", attributes: attrs({ "Article no.": `A-${i}` }) }));
        expect(facet(listing(base), "Article no.")).toBeUndefined();
        expectKeptSelection(listing(base, { "Article no.": ["A-1"] }), "Article no.", "A-1", ["p1"]);
    });
    it("(iii) fails — 41 distinct values", () => {
        const base: P[] = [{ id: "dup", attributes: attrs({ Color: "c0" }) }, ...many(41, (i) => ({ id: `p${i}`, attributes: attrs({ Color: `c${i}` }) }))];
        expect(facet(listing(base), "Color")).toBeUndefined();
        expectKeptSelection(listing(base, { Color: ["c0"] }), "Color", "c0", ["dup", "p0"]);
    });
    it("no product holds the key at all", () => {
        const base: P[] = [{ id: "p1", brand: "A" }, { id: "p2", brand: "B" }];
        const l = listing(base, { Inexistent: ["x"] });
        expect(ids(l)).toEqual([]);
        expect(l.chips).toEqual([{ facetLabel: "Inexistent", value: "x", href: PATH }]);
        expect(facet(l, "Inexistent")).toEqual({ id: A("Inexistent"), label: "Inexistent", values: [{ state: "selected", value: "x", count: 0, href: PATH }] });
        // The other facets still offer their values, counted under the selection (all 0 here).
        expect(counts(l, PRODUCER_FACET)).toEqual({ A: 0, B: 0 });
    });
});

// ── § 5.1 URL budget ────────────────────────────────────────────────────────────────────────────────────────────

describe("§ 5.1 — every emitted href is ≤ HREF_BUDGET; add-links only when they fit; incoming selections that do not fit are not applied", () => {
    // The 147 measured names on the uncapped variant facet (a product per name, two for the first so the panel is
    // realistic), and the 40 longest of them on `colecție` (its key costs 9 bytes more per value inside `f`).
    const longest40 = [...MEASURED_COLLECTIONS].sort((a, b) => b.length - a.length).slice(0, 40);
    const base: P[] = [
        ...MEASURED_COLLECTIONS.map((name, i) => ({ id: `v${i}`, variants: opts([name]) })),
        ...longest40.flatMap((name, i) => [{ id: `c${i}a`, attributes: attrs({ colecție: name }) }, { id: `c${i}b`, attributes: attrs({ colecție: name }) }]),
    ];

    function checkInvariants(l: FacetListing<P>) {
        for (const href of emittedHrefs(l)) expect(utf8Bytes(href)).toBeLessThanOrEqual(HREF_BUDGET);
        for (const f of l.facets) for (const v of f.values) {
            if (v.state === "link") expect(utf8Bytes(v.href) + PAGE_RESERVE).toBeLessThanOrEqual(HREF_BUDGET);
            if (v.state === "selected") expect(v.href).not.toBeNull();
            if (v.state === "too-long") expect(selectionFits(PATH, new Map([...l.selection, [f.id, new Set([...(l.selection.get(f.id) ?? []), v.value])]]))).toBe(false);
        }
        for (const chip of l.chips) expect(chip.href).not.toBeNull();
        expect(l.clearHref).toBe(PATH);
    }

    /** Adds the longest add-link of `facetId` until none is left; checks the invariants at every step. */
    function greedy(facetId: string): { last: FacetListing<P>; steps: number } {
        let f: string | undefined;
        let steps = 0;
        for (;;) {
            const l = buildFacetListing(base, f, PATH);
            expect(l.tooLong).toBe(false);
            checkInvariants(l);
            const links = facet(l, facetId)!.values.filter((v): v is Extract<typeof v, { state: "link" }> => v.state === "link");
            if (links.length === 0) return { last: l, steps };
            const next = links.reduce((a, b) => (utf8Bytes(b.href) > utf8Bytes(a.href) ? b : a));
            f = new URL(next.href, "http://x").searchParams.get("f")!;     // one decode: the outer level, as Next does
            steps += 1;
        }
    }

    it("greedy on the variant facet (147 names): invariants at every step; the budget stops it and the hint shows", () => {
        const { last, steps } = greedy(VARIANT_FACET);
        expect(steps).toBeGreaterThan(10);
        expect(last.budgetHint).toBe(true);
        expect(facet(last, VARIANT_FACET)!.values.some((v) => v.state === "too-long")).toBe(true);
    });

    it("greedy on `colecție` (≤ 40 values by § 13): the 40 longest measured names fit together (5,851 bytes as `a.colecție`), no hint", () => {
        const { last, steps } = greedy("colecție");
        expect(steps).toBe(40);
        expect(last.budgetHint).toBe(false);
        expect(utf8Bytes(listingHref(PATH, last.selection))).toBe(5851);
    });

    it("the review-1 witness: a 4,031-byte incoming URL whose canonical href is 20,035 bytes (+4 as `a.colectie`) is NOT applied", () => {
        const x = "/".repeat(2000);
        // The design's arithmetic (E-22), on the selection map as written there (key `colectie`).
        expect(utf8Bytes(`/shop?f=colectie=${x}A%26colectie=${x}B`)).toBe(4031);
        const designSel: Selection = new Map([["colectie", new Set([`${x}A`, `${x}B`])]]);
        expect(utf8Bytes(listingHref(PATH, designSel))).toBe(20035);
        expect(utf8Bytes(listingHref(PATH, new Map([["colectie", new Set([`${x}A`])]])))).toBe(10020);
        // Under the identity rule the attribute id is `a.colectie` (2 bytes more per pair).
        const f = `a.colectie=${x}A&a.colectie=${x}B`;     // what the page receives after Next decodes the outer level
        expect(utf8Bytes(listingHref(PATH, parseSelection(f)))).toBe(20039);
        const witnessBase: P[] = [{ id: "p1", attributes: attrs({ colectie: "Q" }) }, { id: "p2", attributes: attrs({ colectie: "Q" }) }, { id: "p3" }];
        const l = buildFacetListing(witnessBase, f, PATH);
        expect(l.tooLong).toBe(true);
        expect(l.selection.size).toBe(0);
        expect(ids(l)).toEqual(["p1", "p2", "p3"]);
        expect(l.chips).toEqual([]);
        for (const href of emittedHrefs(l)) expect(utf8Bytes(href)).toBeLessThanOrEqual(HREF_BUDGET);
        // The witness on the bare name: not a facet id → dropped at the parse; nothing applied, no notice.
        const literal = buildFacetListing(witnessBase, `colectie=${x}A&colectie=${x}B`, PATH);
        expect([literal.tooLong, literal.selection.size, ids(literal).length]).toEqual([false, 0, 3]);
    });

    it("property (2,000 random selections): a remove-link is never longer than the current canonical href; pager links fit", () => {
        const next = rng(20261030);
        const alphabet = ["/", " ", ",", "+", "&", "=", "%", "²", "ș", "a", "B", "7"];
        const word = () => Array.from({ length: 1 + Math.floor(next() * 60) }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
        for (let run = 0; run < 2000; run++) {
            const keys = ["k1", "colecție"];
            const values = Object.fromEntries(keys.map((k) => [k, Array.from({ length: 6 }, word)]));
            const runBase: P[] = keys.flatMap((k) => values[k].flatMap((v, i) => [{ id: `${k}${i}a`, attributes: attrs({ [k]: v }) }, { id: `${k}${i}b`, attributes: attrs({ [k]: v }) }]));
            const chosen: Record<string, string[]> = {};
            for (const k of keys) chosen[k] = values[k].filter(() => next() < 0.5);
            const l = buildFacetListing(runBase, formatSelection(sel(chosen)), PATH);
            if (l.tooLong) continue;
            const current = utf8Bytes(listingHref(PATH, l.selection));
            for (const chip of l.chips) expect(utf8Bytes(chip.href!)).toBeLessThanOrEqual(current);
            for (const href of emittedHrefs(l)) expect(utf8Bytes(href)).toBeLessThanOrEqual(HREF_BUDGET);
        }
    });
});
