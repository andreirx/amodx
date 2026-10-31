import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import * as path from "path";
import { GlamImportProfileSchema, type GlamImportProfile } from "@amodx/shared";
import { parseGlamCsv, parseCsvRecords } from "../../src/import/glam/parse.js";
import { foldTokens, norm, slugify } from "../../src/import/glam/group.js";
import { checkUpload, planGlamImport, type GlamImportPlan, type GlamUpload } from "../../src/import/glam/map.js";
import {
    DEFAULT_PROFILE, MONEY_WORDS, analyseSpecKeys, buildGuard, checkProfile, guardSpecLine, guardedFragments, importStatus,
    parseProfileChoice, readStoredProfile, resolveProfile, specLinesOf, splitParts, type SpecLineGuard,
} from "../../src/import/glam/profile.js";
import { codeHits } from "./glam-code-hits.js";

/**
 * CAT-IMPORT-PROFILE-1A — the pure profile core (docs/slices/cat-import-profile-1.md § 7.4 units, § 4.5 oracles, and
 * the T3 obligations of ruling CIP1-VALUE-GUARD = B1 with T3, § 11). No AWS, no mocks: text and profile in, plan out.
 */

const HEADER = "colectie,produs,cod vechi,pret achizitie,pret lista,cod nou,unitate,impachetare,comanda minima,imagine,specificatii,format";
const q = (c: string) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
interface Row { c?: string; p?: string; old?: string; neu?: string; img?: string; specs?: string; f?: string }
/** Columns 3–4 always carry prices. */
const csv = (...rows: Row[]) => [HEADER, ...rows.map((r) =>
    [r.c ?? "Coll", r.p ?? "Prod", r.old ?? "", "111.11", "222.22", r.neu ?? "", "mp", "", "", r.img ?? "", r.specs ?? "", r.f ?? ""]
        .map(q).join(","))].join("\n") + "\n";
const img = (n: number) => `https://img.test/${n}.jpg`;

function parsed(text: string) {
    const result = parseGlamCsv(text);
    if (result.kind !== "parsed") throw new Error(result.error);
    return result;
}
function uploadOf(producer = "P", sheet = "S", variantName = "Format"): GlamUpload {
    const check = checkUpload({ producer, sheet, variantName });
    if (check.kind !== "accepted") throw new Error(check.error);
    return check.upload;
}
const profile = (p: Partial<GlamImportProfile>): GlamImportProfile => GlamImportProfileSchema.parse({ ...DEFAULT_PROFILE, ...p });
const planWith = (text: string, p: GlamImportProfile | undefined, upload = uploadOf()): GlamImportPlan => {
    const file = parsed(text);
    return planGlamImport(file.rows, upload, p ? { profile: p, revision: 1, codeCells: file.codeCells } : undefined);
};
const drafts = (plan: GlamImportPlan) => plan.styles.map((s) => s.draft);
const attrs = (plan: GlamImportPlan, i = 0) => drafts(plan)[i].attributes.map((a) => `${a.key}=${a.value}`);
const attribute = (key: string, label: string, split: "none" | "comma" = "none") => ({ key, action: "attribute" as const, label, split });

const BOEN = readFileSync(path.resolve(__dirname, "fixtures/glam/boen-PL.csv"), "utf8");
const CORPUS: string[] = JSON.parse(readFileSync(path.resolve(__dirname, "fixtures/glam/cat-import-profile-1a-fold-corpus.json"), "utf8")).lines;

// ── Schema, validation, versioning (§ 3.2, § 3.3) ──────────────────────────────────────────────────────────────────

describe("CAT-IMPORT-PROFILE-1A schema and checkProfile", () => {
    it("DEFAULT_PROFILE parses and is accepted", () => {
        expect(GlamImportProfileSchema.parse(DEFAULT_PROFILE)).toEqual(DEFAULT_PROFILE);
        expect(checkProfile(DEFAULT_PROFILE)).toEqual({ kind: "accepted" });
    });

    it.each([
        ["an unknown key at the top", { ...DEFAULT_PROFILE, valueMap: [] }],
        ["an unknown key inside a rule", { ...DEFAULT_PROFILE, specKeys: [{ ...attribute("Wood", "Esență"), map: {} }] }],
        ["an unknown enum value", { ...DEFAULT_PROFILE, grouping: { kind: "trailing-letter" } }],
        ["an unknown split", { ...DEFAULT_PROFILE, specKeys: [attribute("Wood", "Esență", "semicolon" as any)] }],
        ["version 2", { ...DEFAULT_PROFILE, version: 2 }],
        ["an unknown facet mode", { ...DEFAULT_PROFILE, facetModes: { attributes: [{ key: "k", mode: "sometimes" }] } }],
    ])("strict: %s → the parse fails (never stripped)", (_n, value) => {
        expect(GlamImportProfileSchema.safeParse(value).success).toBe(false);
        expect(readStoredProfile({ revision: 4, profile: value })).toMatchObject({ kind: "unsupported", revision: 4 });
        expect(parseProfileChoice({ profile: value, baseRevision: null }).kind).toBe("refused");
    });

    it.each([
        ["a label equal to a column key", [attribute("Wood", "colecție")], /column attribute/],
        ["a label equal to a column key in another case", [attribute("Wood", "Colecție")], /column attribute/],
        ["a duplicate spec key", [attribute("Wood", "A"), { key: "Wood", action: "prose-only" as const }], /listed twice/],
        ["an untrimmed label", [attribute("Wood", " Esență")], /leading or trailing/],
    ])("refused: %s", (_n, specKeys, error) => {
        const check = checkProfile(profile({ specKeys }));
        expect(check.kind).toBe("refused");
        if (check.kind === "refused") expect(check.error).toMatch(error);
    });

    it("refused: the collection spec key also in specKeys; one facet key both always and never", () => {
        expect(checkProfile(profile({ collection: { kind: "spec", key: "Collection" }, specKeys: [{ key: "Collection", action: "prose-only" }] })))
            .toMatchObject({ kind: "refused", error: expect.stringMatching(/collection source/) });
        expect(checkProfile(profile({ facetModes: { attributes: [{ key: "Esență", mode: "always" }, { key: "Esență", mode: "never" }] } })))
            .toMatchObject({ kind: "refused", error: expect.stringMatching(/set twice/) });
    });

    it("parseProfileChoice: absent → absent; baseRevision must be null or a positive integer; extra members refused", () => {
        expect(parseProfileChoice(undefined)).toEqual({ kind: "absent" });
        expect(parseProfileChoice({ profile: DEFAULT_PROFILE, baseRevision: null }).kind).toBe("accepted");
        expect(parseProfileChoice({ profile: DEFAULT_PROFILE, baseRevision: 0 }).kind).toBe("refused");
        expect(parseProfileChoice({ profile: DEFAULT_PROFILE }).kind).toBe("refused");
        expect(parseProfileChoice({ profile: DEFAULT_PROFILE, baseRevision: null, force: true }).kind).toBe("refused");
    });
});

describe("CAT-IMPORT-PROFILE-1A resolveProfile (§ 2.8, § 3.3, § 3.5)", () => {
    const P1 = profile({ specKeys: [attribute("Wood", "Esență")] });
    const P2 = profile({ specKeys: [attribute("Wood", "Lemn")] });
    const stored = { kind: "supported" as const, revision: 3, profile: P1 };

    it("no choice: none → unprofiled default; supported → stored; unsupported → unsupported", () => {
        expect(resolveProfile(null, { kind: "none" }, "execution")).toEqual({ kind: "unprofiled", source: "default", profile: DEFAULT_PROFILE });
        expect(resolveProfile(null, stored, "execution")).toEqual({ kind: "stored", source: "stored", revision: 3, profile: P1 });
        expect(resolveProfile(null, { kind: "unsupported", revision: 2, reason: "r" }, "execution")).toEqual({ kind: "unsupported", revision: 2, reason: "r" });
    });

    it("a choice equal to DEFAULT_PROFILE while none is stored stays unprofiled (byte identity, § 2.8)", () => {
        expect(resolveProfile({ profile: DEFAULT_PROFILE, baseRevision: null }, { kind: "none" }, "execution").kind).toBe("unprofiled");
    });

    it("acceptance: baseRevision equal → save next; content equal → stored, no write; both differ → changed", () => {
        expect(resolveProfile({ profile: P2, baseRevision: 3 }, stored, "execution")).toEqual({ kind: "save", revision: 4, observedRevision: 3, profile: P2 });
        expect(resolveProfile({ profile: P1, baseRevision: 1 }, stored, "execution")).toEqual({ kind: "stored", source: "explicit", revision: 3, profile: P1 });
        expect(resolveProfile({ profile: P2, baseRevision: 2 }, stored, "execution")).toEqual({ kind: "changed", storedRevision: 3, baseRevision: 2 });
        expect(resolveProfile({ profile: P2, baseRevision: 2 }, stored, "dry-run").kind).toBe("save");
        expect(resolveProfile({ profile: P2, baseRevision: null }, { kind: "none" }, "execution")).toEqual({ kind: "save", revision: 1, observedRevision: null, profile: P2 });
        expect(resolveProfile({ profile: P2, baseRevision: 5 }, { kind: "none" }, "execution").kind).toBe("changed");
    });

    it("unsupported stored: replaced only with baseRevision = its revision (§ 3.3 item 5)", () => {
        const bad = { kind: "unsupported" as const, revision: 7, reason: "version: Invalid input" };
        expect(resolveProfile({ profile: P2, baseRevision: 7 }, bad, "execution")).toEqual({ kind: "save", revision: 8, observedRevision: 7, profile: P2 });
        expect(resolveProfile({ profile: P2, baseRevision: 6 }, bad, "execution").kind).toBe("changed");
    });
});

// ── Grouping and collection (§ 2.1, § 2.3, § 7.4) ──────────────────────────────────────────────────────────────────

describe("CAT-IMPORT-PROFILE-1A grouping trailing-number", () => {
    const tn = (label: "removed-token" | "format-column") => profile({ grouping: { kind: "trailing-number", label } });

    it("`Altona UX Altona 34` → title `Altona UX Altona`, label `34`; rows of one base name are one product", () => {
        const plan = planWith(csv({ p: "Altona UX Altona 34", f: "x", img: img(1) }, { p: "Altona UX Altona 35", f: "y", img: img(2) }), tn("removed-token"));
        expect(drafts(plan).map((d) => d.title)).toEqual(["Altona UX Altona"]);
        expect(drafts(plan)[0].variants[0].options.map((o) => o.value)).toEqual(["34", "35"]);
    });

    it("`SR Lumen AB` and a one-token name `34` are unchanged; a row without a removed token keeps column 11", () => {
        const plan = planWith(csv({ p: "SR Lumen AB", f: "fmt" }, { p: "34", f: "" }), tn("removed-token"));
        expect(drafts(plan).map((d) => [d.title, d.variants[0].options.map((o) => o.value)])).toEqual([["SR Lumen AB", ["fmt"]], ["34", ["#1"]]]);
    });

    it("label format-column keeps column 11", () => {
        const plan = planWith(csv({ p: "Altona 34", f: "200x300" }), tn("format-column"));
        expect(drafts(plan)[0].title).toBe("Altona");
        expect(drafts(plan)[0].variants[0].options[0].value).toBe("200x300");
    });

    it("the existing label rows still pass under the rule: x, x, x (2) → x, x (3), x (2); #1, '', '' → #1, #2, #3", () => {
        const a = planWith(csv({ p: "Oak", f: "x", img: img(1) }, { p: "Oak", f: "x", img: img(2) }, { p: "Oak", f: "x (2)", img: img(3) }), tn("removed-token"));
        expect(drafts(a)[0].variants[0].options.map((o) => o.value)).toEqual(["x", "x (3)", "x (2)"]);
        const b = planWith(csv({ p: "Oak", f: "#1", img: img(1) }, { p: "Oak", f: "", img: img(2) }, { p: "Oak", f: "", img: img(3) }), tn("removed-token"));
        expect(drafts(b)[0].variants[0].options.map((o) => o.value)).toEqual(["#1", "#2", "#3"]);
    });
});

describe("CAT-IMPORT-PROFILE-1A collection from a spec key", () => {
    const SENTENCE = "Prices in EUR per m², valid from 01.03.2024, ex works Tielt, Belgium";
    const byCollection = profile({ collection: { kind: "spec", key: "Collection" } });

    it("the spec value feeds the product key, the child category (name, slug), the product slug and colecție", () => {
        const plan = planWith(csv({ c: SENTENCE, p: "Altona", specs: "Collection: Delight\nPile weight: 620 gr/m²" }), byCollection);
        expect(plan.categories).toEqual([{ slug: "p", name: "P", parentSlug: null }, { slug: "p-delight", name: "Delight", parentSlug: "p" }]);
        expect(drafts(plan)[0]).toMatchObject({ slug: "p-delight-altona", categoryKeys: ["p", "p-delight"] });
        expect(attrs(plan)).toContain("colecție=Delight");
    });

    it("a row without the key gets the sheet name; the price sentence is absent from every planned field", () => {
        const plan = planWith(csv({ c: SENTENCE, p: "Altona" }, { c: SENTENCE, p: "Ash", specs: "Collection: Delight" }), byCollection);
        expect(plan.categories.map((c) => c.name)).toEqual(["P", "S", "Delight"]);
        expect(attrs(plan, 0)).toContain("colecție=S");
        const planned = JSON.stringify({ categories: plan.categories, drafts: drafts(plan) });
        expect(planned).not.toContain("Prices in EUR");
        expect(planned).not.toMatch(/eur/i);
    });
});

// ── Extraction (§ 2.4, § 2.5) and prose (CIP1-PROSE = A) ───────────────────────────────────────────────────────────

describe("CAT-IMPORT-PROFILE-1A extraction", () => {
    it("first-colon split: `a: b: c` → key a, value `b: c`; an empty value, no colon or an empty key give nothing", () => {
        expect(specLinesOf("a: b: c\nAppearance:\nno colon\n: v").map((l) => [l.key, l.value])).toEqual([["a", "b: c"]]);
        const plan = planWith(csv({ specs: "a: b: c\nAppearance:" }), profile({ specKeys: [attribute("a", "A"), attribute("Appearance", "Aspect")] }));
        expect(attrs(plan)).toEqual(["colecție=Coll", "unitate=mp", "A=b: c"]);
    });

    it("comma split: trims parts and drops empty parts; split none keeps the value whole", () => {
        expect(splitParts("Classic, ,Nordic,", "comma")).toEqual(["Classic", "Nordic"]);
        const plan = planWith(csv({ specs: "Style: Classic, ,Nordic,\nSurface: Brushed, Oiled" }),
            profile({ specKeys: [attribute("Style", "Stil", "comma"), attribute("Surface", "Suprafață")] }));
        expect(attrs(plan)).toEqual(["colecție=Coll", "unitate=mp", "Stil=Classic", "Stil=Nordic", "Suprafață=Brushed, Oiled"]);
    });

    it("union over the style's rows in file order, each value once by norm; two keys with one label are one attribute", () => {
        const plan = planWith(csv(
            { f: "1", img: img(1), specs: "Format: Plank 138\nWood: Oak" },
            { f: "2", img: img(2), specs: "Format: plank  138\nWood species: Ash" },
            { f: "3", img: img(3), specs: "Format: Plank 181" },
        ), profile({ specKeys: [attribute("Format", "Format"), attribute("Wood", "Esență"), attribute("Wood species", "Esență")] }));
        expect(attrs(plan)).toEqual(["colecție=Coll", "unitate=mp", "Format=Plank 138", "Format=Plank 181", "Esență=Oak", "Esență=Ash"]);
    });

    it("prose-only and an unlisted key: the same output (no attribute), a different analysis state", () => {
        const text = csv({ specs: "Wood: Oak" });
        const proseOnly = profile({ specKeys: [{ key: "Wood", action: "prose-only" }] });
        expect(drafts(planWith(text, proseOnly))).toEqual(drafts(planWith(text, DEFAULT_PROFILE)));
        const file = parsed(text);
        const analyse = (p: GlamImportProfile) => analyseSpecKeys(file.rows, [[2]], p, buildGuard(file.codeCells))[0].rule;
        expect(analyse(proseOnly)).toEqual({ action: "prose-only" });
        expect(analyse(DEFAULT_PROFILE)).toEqual({ action: "not-reviewed" });
    });

    it("stamps: importProfileRevision on every product; facetModes only when the modes are not empty", () => {
        const text = csv({ p: "A" }, { p: "B" });
        expect(drafts(planWith(text, DEFAULT_PROFILE)).map((d) => [d.importProfileRevision, "facetModes" in d])).toEqual([[1, false], [1, false]]);
        const modes = { variant: "never" as const, attributes: [{ key: "colecție", mode: "always" as const }] };
        expect(drafts(planWith(text, profile({ facetModes: modes }))).map((d) => d.facetModes)).toEqual([modes, modes]);
        expect(drafts(planWith(text, undefined)).every((d) => !("importProfileRevision" in d) && !("facetModes" in d))).toBe(true);
    });

    it("O-PRICES-1 key set: a profiled draft gains exactly facetModes and importProfileRevision", () => {
        const text = csv({ specs: "Wood: Oak", img: img(1) });
        const plain = Object.keys(drafts(planWith(text, undefined))[0]).sort();
        const profiled = Object.keys(drafts(planWith(text, profile({ facetModes: { attributes: [{ key: "k", mode: "never" }] } })))[0]).sort();
        expect(profiled).toEqual([...plain, "facetModes", "importProfileRevision"].sort());
    });

    it("CIP1-PROSE = A: over the BOEN fixture, a profiled import's prose equals the unprofiled prose for the same rows", () => {
        const file = parsed(BOEN);
        const keys = [...new Set(file.rows.flatMap((r) => specLinesOf(r.specs).map((l) => l.key)))];
        const everything = profile({ specKeys: keys.map((k) => attribute(k, `L ${k}`, "comma")) });
        const plain = planGlamImport(file.rows, uploadOf("BOEN", "PL"));
        const profiled = planGlamImport(file.rows, uploadOf("BOEN", "PL"), { profile: everything, revision: 1, codeCells: file.codeCells });
        const prose = (p: GlamImportPlan) => drafts(p).map((d) => [d.slug, d.description, d.longDescription]);
        expect(prose(profiled)).toEqual(prose(plain));
        expect(drafts(profiled).filter((d) => d.attributes.some((a) => a.key.startsWith("L "))).length).toBe(280);
    });
});

// ── The value guard: § 4.5 oracles and the T3 witnesses ────────────────────────────────────────────────────────────

describe("CAT-IMPORT-PROFILE-1A value guard (§ 4.3, B1 with T3)", () => {
    const guardOf = (...codes: string[]) => buildGuard(new Set(codes));
    const verdict = (line: string, g: SpecLineGuard = guardOf(), split: "none" | "comma" = "none") => guardSpecLine(line, split, g);

    it("O-CODES-4: a cross-row code in a selected line → no attribute, refusal row 3 `code`, no AAA-1 in the plan's drafts", () => {
        const text = csv(
            { p: "Oak", old: "AAA-1", f: "1", img: img(1), specs: "Wood: Oak" },
            { p: "Oak", old: "BBB-2", f: "2", img: img(2), specs: "Wood: Oak\nAlternate article: AAA-1" },
        );
        const plan = planWith(text, profile({ specKeys: [attribute("Alternate article", "Articol"), attribute("Wood", "Esență")] }));
        expect(attrs(plan)).toEqual(["colecție=Coll", "unitate=mp", "Esență=Oak"]);
        expect(plan.profile!.refused).toEqual([{ key: "Alternate article", rowIndex: 3, reason: "code" }]);
        expect(codeHits(drafts(plan), ["AAA-1", "BBB-2"])).toEqual([]);
    });

    it("O-PRICES-2: `Price: 25 EUR`, `Cost: 12 lei`, `Finish: €` → no attribute, each `money`; `Wood: Oak` written", () => {
        const plan = planWith(csv({ specs: "Price: 25 EUR\nCost: 12 lei\nFinish: €\nWood: Oak" }),
            profile({ specKeys: ["Price", "Cost", "Finish", "Wood"].map((k) => attribute(k, `L${k}`)) }));
        expect(attrs(plan)).toEqual(["colecție=Coll", "unitate=mp", "LWood=Oak"]);
        expect(plan.profile!.refused.map((r) => [r.key, r.reason])).toEqual([["Cost", "money"], ["Finish", "money"], ["Price", "money"]]);
    });

    it("O-PRICES-3: collection from `Price: 25 EUR` → category is the sheet; no 25/EUR in any category, slug or colecție; positive control Delight", () => {
        const plan = planWith(csv({ p: "Oak", specs: "Price: 25 EUR" }, { p: "Ash", specs: "Collection: Delight" }),
            profile({ collection: { kind: "spec", key: "Price" } }), uploadOf("P", "S"));
        expect(plan.profile!.refused).toEqual([{ key: "Price", rowIndex: 2, reason: "money" }]);
        const identifiers = JSON.stringify([plan.categories, drafts(plan).map((d) => [d.slug, d.categoryKeys, d.attributes])]);
        expect(identifiers).not.toMatch(/25|eur/i);
        expect(attrs(plan, 0)).toContain("colecție=S");
        const control = planWith(csv({ p: "Ash", specs: "Collection: Delight" }), profile({ collection: { kind: "spec", key: "Collection" } }));
        expect(control.categories.map((c) => c.name)).toEqual(["P", "Delight"]);
    });

    it("O-PRICES-4: `Price: 25` refused as an attribute and as the collection; `Pricey look: yes` is not refused", () => {
        expect(verdict("Price: 25")).toEqual({ kind: "refused", reason: "money" });
        expect(verdict("Price:25")).toEqual({ kind: "refused", reason: "money" });
        expect(planWith(csv({ specs: "Price: 25" }), profile({ specKeys: [attribute("Price", "P")] })).profile!.refused).toHaveLength(1);
        expect(planWith(csv({ specs: "Price: 25" }), profile({ collection: { kind: "spec", key: "Price" } })).profile!.refused).toHaveLength(1);
        expect(verdict("Pricey look: yes")).toEqual({ kind: "kept" });
    });

    it("O-CODES-5: a cross-row code as the collection → the sheet name; no category or slug holds aaa-1", () => {
        const plan = planWith(csv({ p: "Oak", old: "AAA-1" }, { p: "Ash", specs: "Series: AAA-1" }), profile({ collection: { kind: "spec", key: "Series" } }));
        expect(plan.profile!.refused).toEqual([{ key: "Series", rowIndex: 3, reason: "code" }]);
        expect(JSON.stringify([plan.categories, drafts(plan).map((d) => d.slug)]).toLowerCase()).not.toContain("aaa-1");
    });

    it("T3 (3): `Collection: Cóst` and `Collection: ABC` with a same-file code `abc` are REFUSED at the source (→ sheet)", () => {
        const byCollection = profile({ collection: { kind: "spec", key: "Collection" } });
        const cost = planWith(csv({ p: "Oak", specs: "Collection: Cóst" }), byCollection);
        expect(cost.profile!.refused).toEqual([{ key: "Collection", rowIndex: 2, reason: "money" }]);
        expect(cost.categories.map((c) => c.slug)).toEqual(["p", "p-s"]);
        const abc = planWith(csv({ p: "Oak", old: "abc" }, { p: "Ash", specs: "Collection: ABC" }), byCollection);
        expect(abc.profile!.refused).toEqual([{ key: "Collection", rowIndex: 3, reason: "code" }]);
        expect(abc.categories.map((c) => c.slug)).toEqual(["p", "p-s"]);
        // the unfolded (B1) check alone would keep both lines — the witnesses of § 4.3 (E-20)
        expect(/\bcost\b/i.test("Collection: Cóst")).toBe(false);
        expect("Collection: ABC".includes("abc")).toBe(false);
    });

    it("T3: folded forms the unfolded check misses — a cedilla `Preţ`, a code inside other punctuation", () => {
        expect(verdict("Preţ: 10")).toEqual({ kind: "refused", reason: "money" });
        expect(verdict("Ref: 12/34", guardOf("1234"))).toEqual({ kind: "refused", reason: "code" });
        expect(verdict("Wood:Oak", guardOf("oak"))).toEqual({ kind: "refused", reason: "code" }); // the value fragment folds to `oak`
        expect(verdict("Style: Classic,Nordic", guardOf("nordic"), "comma")).toEqual({ kind: "refused", reason: "code" });
        expect(verdict("Style: Classic,Nordic", guardOf("nordic"), "none")).toEqual({ kind: "kept" }); // `classicnordic` as one token
    });

    it("known false refusals, stated in § 4.3: a listed word in a harmless line; a short code cell as a token", () => {
        expect(verdict("Cost class: A")).toEqual({ kind: "refused", reason: "money" });
        expect(verdict("Width: 12 mm", guardOf("12"))).toEqual({ kind: "refused", reason: "code" });
    });

    it("every money word folds to exactly one token (the folded money check compares tokens)", () => {
        for (const word of MONEY_WORDS) expect(foldTokens(word)).toHaveLength(1);
    });
});

// ── T3 obligation (1): one folding, derived from slugify; a corpus test pins the token boundaries ─────────────────

/** The corpus: one real spec line per value class of the three producers' files (fixture header), plus witnesses. */
const WITNESSES = [
    "Collection: Cóst", "Collection: ABC", "Wood:Oak", "Collection: A,B", "Note: a: b:c", "Collection: x.AAA",
    "Key: Ünïcödé Ø ß", "Collection: _under_score", "Collection:  spaced   out ", "Collection: ---", "Collection: 12/34",
    "İstanbul: İzmir", "Series: ǅemal", "Tab:\tvalue\twith tabs", "Dimensions (mm): 13,2x181x2200 mm",
    "Pile weight: 620 gr/m²", "Surface: Beveled 4V, Deep brushed, handcrafted, Toplayer ca. 4.5 mm",
];
const STRINGS = [...CORPUS, ...WITNESSES].flatMap((line) => {
    const l = specLinesOf(line)[0];
    return l ? [line, l.key, l.value, ...splitParts(l.value, "comma")] : [line];
});
const PRODUCERS = ["BOEN", "ITC", "ALPOD", "Prod X"];

describe("CAT-IMPORT-PROFILE-1A T3 (1) — folding and slugify agree on token boundaries (corpus)", () => {
    it(`the corpus holds the producers' value classes and the witnesses (${CORPUS.length} + ${WITNESSES.length} lines)`, () => {
        expect(CORPUS.length).toBeGreaterThan(50);
    });

    it.each(STRINGS.map((s) => [s]))("%j: fold tokens = slugify tokens; norm moves no boundary; a slug component keeps its tokens", (s) => {
        expect(foldTokens(s).join("-")).toBe(slugify(norm(s)));
        expect(slugify(norm(s))).toBe(slugify(s));
        for (const producer of PRODUCERS) {
            const joined = slugify(`${norm(producer)} ${norm(s)}`).split("-").filter(Boolean);
            expect(joined).toEqual([...foldTokens(producer), ...foldTokens(s)]);
        }
    });
});

// ── T3 obligation (2), AS RULED by the operator on review-0 (docs/slices/cat-import-profile-1a.md "Operator rulings
// on review-0", item 1): every token of every identifier derived from a checked spec line is a token of one of that
// line's GUARDED FRAGMENTS — the folded key, the folded value, or the folded value's list parts when splitting applies.
// (The packet's first wording, "a token of the folded source line", is unsatisfiable: `Collection:Oak` folds to the one
// token `collectionoak`. No test here claims that wording.) ──────────────────────────────────────────────────────────

/** The tokens of a line's guarded fragments (`guardedFragments`: key, value, list parts), folded. */
const fragmentTokens = (line: string, split: "none" | "comma") => new Set(guardedFragments(line.normalize("NFC"), split).flatMap(foldTokens));
const fragmentFolds = (line: string, split: "none" | "comma") => new Set(guardedFragments(line.normalize("NFC"), split).map((f) => foldTokens(f).join("-")));

/**
 * For one spec line, plan a one-row file under (a) `collection: spec <key>`, (b) the key as an attribute, split none,
 * (c) split comma, (d) the key as an attribute whose label is the file's key spelled as written (the § 6.1 proposal);
 * return every violation of the ruled obligation. Derived fields: the child category name and slug, the `colecție`
 * value, the product slug's collection part, each attribute value, and the attribute key when it is the file's key.
 */
function derivedViolations(line: string, producer = "P", codes: string[] = []): string[] {
    const spec = specLinesOf(line)[0];
    if (!spec) return [];
    const text = csv({ c: "Col", p: "Name", old: codes[0] ?? "", specs: line });
    const file = parsed(text);
    const upload = uploadOf(producer, "Sheet");
    const out: string[] = [];
    const subset = (what: string, tokens: string[], allowed: Set<string>) => {
        for (const t of tokens) if (!allowed.has(t)) out.push(`${line} → ${what}: token "${t}" is not a token of a guarded fragment`);
    };
    // (a) collection
    const a = planGlamImport(file.rows, upload, { profile: profile({ collection: { kind: "spec", key: spec.key } }), revision: 1, codeCells: file.codeCells });
    const refused = a.profile!.refused.length > 0;
    const allowedA = fragmentTokens(line, "none");
    const child = a.categories.find((c) => c.parentSlug !== null);
    const producerTokens = foldTokens(producer);
    if (refused) {
        if (child && child.name !== "Sheet") out.push(`${line} → refused line still named the category ${child.name}`);
    } else {
        if (!fragmentFolds(line, "none").has(foldTokens(spec.value).join("-"))) out.push(`${line} → the value's fold is not a guarded fragment's fold`);
        if (child) {
            if (child.name !== spec.value) out.push(`${line} → category name ${child.name} is not the line's value`);
            subset("category name (folded)", foldTokens(child.name), allowedA);
            subset("category slug", child.slug.split("-").slice(producerTokens.length), allowedA);
        }
        const colectie = a.styles[0].draft.attributes.find((x) => x.key === "colecție")!.value;
        if (colectie !== spec.value) out.push(`${line} → colecție ${colectie} is not the line's value`);
        subset("colecție (folded)", foldTokens(colectie), allowedA);
        const slugTokens = a.styles[0].draft.slug.split("-");
        const collectionPart = slugTokens.slice(producerTokens.length, slugTokens.length - foldTokens("Name").length);
        subset("product slug part", collectionPart, allowedA);
    }
    // (b), (c) attribute values under an author label; (d) the attribute key when the label is the file's key
    for (const split of ["none", "comma"] as const) {
        for (const label of ["Lbl", spec.key]) {
            const b = planGlamImport(file.rows, upload, { profile: profile({ specKeys: [attribute(spec.key, label, split)] }), revision: 1, codeCells: file.codeCells });
            const allowed = fragmentTokens(line, split);
            const folds = fragmentFolds(line, split);
            for (const v of b.styles[0].draft.attributes.filter((x) => x.key === label && x.key !== "colecție" && x.key !== "unitate")) {
                if (!folds.has(foldTokens(v.value).join("-"))) out.push(`${line} → attribute value ${v.value} (${split}) is not a guarded fragment's fold`);
                subset(`attribute value (${split})`, foldTokens(v.value), allowed);
                if (label === spec.key) subset(`attribute key = file key (${split})`, foldTokens(v.key), allowed);
            }
        }
    }
    return out;
}

describe("CAT-IMPORT-PROFILE-1A T3 (2) as ruled — derived identifiers hold only tokens of the line's guarded fragments", () => {
    it.each([...CORPUS, ...WITNESSES, "Collection:Oak"].map((l) => [l]))("%j", (line) => {
        for (const producer of PRODUCERS) expect(derivedViolations(line, producer)).toEqual([]);
    });

    it("reviewer's witness `Collection:Oak` (no space): kept; `oak` is a token of the folded VALUE fragment; slugs p-oak, p-oak-name", () => {
        const plan = planWith(csv({ p: "Name", specs: "Collection:Oak" }), profile({ collection: { kind: "spec", key: "Collection" } }));
        expect(plan.profile!.refused).toEqual([]);
        expect(guardedFragments("Collection:Oak", "none")).toEqual(["Collection", "Oak"]);
        expect(foldTokens("Oak")).toEqual(["oak"]);
        expect(plan.categories.map((c) => c.slug)).toEqual(["p", "p-oak"]);
        expect(drafts(plan)[0].slug).toBe("p-oak-name");
        // the first wording is unsatisfiable: the whole line folds to one token that is not `oak`
        expect(foldTokens("Collection:Oak")).toEqual(["collectionoak"]);
    });

    it("with a same-file code cell, a refused collection line names no category after itself", () => {
        expect(derivedViolations("Collection: ABC", "P", ["abc"])).toEqual([]);
    });

    it("no attribute key is derived from a spec line except a label typed equal to it: a rule without a label does not parse", () => {
        expect(GlamImportProfileSchema.safeParse({ ...DEFAULT_PROFILE, specKeys: [{ key: "Wood", action: "attribute", split: "none" }] }).success).toBe(false);
        // a label is author input (ruling item 2): it is stored as written and carries no file value
        expect(attrs(planWith(csv({ specs: "Wood: Oak" }), profile({ specKeys: [attribute("Wood", "Esență")] })))).toContain("Esență=Oak");
    });
});

// ── O-VALUE-1 and the false-refusal regression over the three producers' sanitised fixtures (ruling item 3) ─────────

const FIXTURE_DIR = path.resolve(__dirname, "fixtures/glam");
const PRODUCER_FILES: [string, string[], { lines: number; products: number }][] = [
    ["ITC", readdirSync(path.join(FIXTURE_DIR, "itc")).filter((f) => f.endsWith(".csv")).sort().map((f) => `itc/${f}`), { lines: 3113, products: 576 }],
    ["BOEN", ["boen-PL.csv"], { lines: 3837, products: 437 }],
    ["ALPOD", readdirSync(path.join(FIXTURE_DIR, "alpod")).filter((f) => f.endsWith(".csv")).sort().map((f) => `alpod/${f}`), { lines: 3726, products: 915 }],
];

describe.each(PRODUCER_FILES)("CAT-IMPORT-PROFILE-1A %s fixtures: O-VALUE-1 and 0 false refusals", (producer, files, expected) => {
    it(`${files.length} file(s); every spec line kept by the guard (split none and comma); every spec attribute value is a substring of a line of one row of its style`, () => {
        let lines = 0, products = 0, values = 0;
        const refusals: string[] = [];
        for (const name of files) {
            const file = parsed(readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
            const guard = buildGuard(file.codeCells);
            for (const row of file.rows) {
                for (const line of specLinesOf(row.specs)) {
                    lines++;
                    for (const split of ["none", "comma"] as const) {
                        const verdict = guardSpecLine(line.line, split, guard);
                        if (verdict.kind === "refused") refusals.push(`${name}:${row.index} ${line.key} ${split} ${verdict.reason}`);
                    }
                }
            }
            const keys = [...new Set(file.rows.flatMap((r) => specLinesOf(r.specs).map((l) => l.key)))];
            const worst = profile({ specKeys: keys.map((k) => attribute(k, `L ${k}`, "comma")) });
            const sheet = path.basename(name, ".csv");
            const plan = planGlamImport(file.rows, uploadOf(producer, sheet), { profile: worst, revision: 1, codeCells: file.codeCells });
            expect(plan.profile!.refused).toEqual([]);
            const rowsByIndex = new Map(file.rows.map((r) => [r.index, r]));
            products += plan.styles.length;
            for (const { draft } of plan.styles) {
                const rowLines = draft.rowIndexes.flatMap((i) => rowsByIndex.get(i)!.specs.split("\n"));
                for (const a of draft.attributes.filter((x) => x.key.startsWith("L "))) {
                    values++;
                    expect(rowLines.some((l) => l.includes(a.value)), `${name} ${draft.slug} ${a.key}=${a.value}`).toBe(true);
                }
            }
        }
        expect(refusals).toEqual([]);
        expect({ lines, products }).toEqual(expected);
        console.log(`[CAT-IMPORT-PROFILE-1A] ${producer}: ${files.length} files, ${lines} spec lines, 0 refusals, ${products} products, ${values} spec attribute values checked (O-VALUE-1)`);
    });
});

// ── The BOEN facts of the analysis (§ 3.5) and O-CODES-3 at plan level ────────────────────────────────────────────────────────────

describe("CAT-IMPORT-PROFILE-1A over the BOEN fixture", () => {
    const file = parsed(BOEN);
    const keys = [...new Set(file.rows.flatMap((r) => specLinesOf(r.specs).map((l) => l.key)))];
    const worst = profile({ specKeys: keys.map((k) => attribute(k, `L ${k}`, "comma")) });
    const plan = planGlamImport(file.rows, uploadOf("BOEN", "PL"), { profile: worst, revision: 1, codeCells: file.codeCells });

    it("O-CODES-3 (plan level): with every key extracted, split comma, no draft holds a column-2/5 cell of any row", () => {
        const records = parseCsvRecords(BOEN);
        if (records.kind !== "records") throw new Error(records.error);
        const codes = [...new Set(records.records.slice(1).flatMap((r) => [r[2], r[5]]).map((c) => c.trim()).filter(Boolean))];
        expect(codes.length).toBe(801);
        expect(codeHits(drafts(plan), codes)).toEqual([]);
        expect(codeHits([{ attributes: [{ key: "L Wood", value: codes[0] }] }], codes)).toHaveLength(1); // positive control
    });

    it("analysis facts equal the design's independent measurements (§ 1.1, § 9 E-4/E-5/E-6/E-17)", () => {
        const analysed = analyseSpecKeys(file.rows, plan.styles.map((s) => s.draft.rowIndexes),
            profile({ specKeys: [attribute("Style", "Stil", "comma"), { key: "Dimensions (mm)", action: "prose-only" }] }), buildGuard(file.codeCells));
        const by = new Map(analysed.map((k) => [k.key, k]));
        expect(by.get("Dimensions (mm)")).toMatchObject({ rows: 310, equalToFormat: 258, variantLevelProducts: 7, rule: { action: "prose-only" } });
        expect(by.get("Format")).toMatchObject({ equalToFormat: 0, variantLevelProducts: 7, distinctValues: 11, rule: { action: "not-reviewed" } });
        expect(by.get("Surface")).toMatchObject({ commaRows: 310, variantLevelProducts: 7, distinctValues: 17 });
        expect(by.get("Style")).toMatchObject({ commaRows: 201, products: 277, distinctValues: 4, rule: { action: "attribute", label: "Stil", split: "comma" } });
        expect(by.get("Certificates")).toMatchObject({ products: 280, distinctValues: 1, maxValueHolders: 280, repeatRule: "offered" });
        expect(by.get("Nordic swan")).toMatchObject({ products: 120 });
        expect(analysed.every((k) => k.refused.length === 0 && k.samples.length <= 5)).toBe(true);
    });
});

describe("CAT-IMAGE-GATE-1 — importStatus and the publishWithoutImages equivalence (absent = false)", () => {
    const PUBLISH: GlamImportProfile = { ...DEFAULT_PROFILE, publishWithoutImages: true };
    it("importStatus: active only for publishWithoutImages true; absent or false → draft", () => {
        expect(importStatus(DEFAULT_PROFILE)).toBe("draft");
        expect(importStatus({ ...DEFAULT_PROFILE, publishWithoutImages: false })).toBe("draft");
        expect(importStatus(PUBLISH)).toBe("active");
    });
    it("resolveProfile: false equals absent (unprofiled with none stored; `stored` against a stored profile without it); true is a change", () => {
        const sentFalse = { profile: { ...DEFAULT_PROFILE, publishWithoutImages: false }, baseRevision: null };
        expect(resolveProfile(sentFalse, { kind: "none" }, "execution").kind).toBe("unprofiled");
        expect(resolveProfile({ ...sentFalse, baseRevision: 2 }, { kind: "supported", revision: 2, profile: DEFAULT_PROFILE }, "execution"))
            .toMatchObject({ kind: "stored", revision: 2 });
        expect(resolveProfile({ profile: PUBLISH, baseRevision: null }, { kind: "none" }, "execution")).toMatchObject({ kind: "save", revision: 1 });
        expect(resolveProfile({ profile: DEFAULT_PROFILE, baseRevision: 4 }, { kind: "supported", revision: 4, profile: PUBLISH }, "execution"))
            .toMatchObject({ kind: "save", revision: 5 });
    });
    it("readStoredProfile: a stored item without the member is supported and reads as off", () => {
        const stored = readStoredProfile({ profile: { ...DEFAULT_PROFILE }, revision: 1 });
        expect(stored).toMatchObject({ kind: "supported", revision: 1 });
        if (stored.kind === "supported") expect(importStatus(stored.profile)).toBe("draft");
    });
});
