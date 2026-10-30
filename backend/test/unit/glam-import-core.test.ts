import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";
import { parseGlamCsv, parseCsvRecords, type GlamRow } from "../../src/import/glam/parse.js";
import { groupStyles, norm, KEY_SEPARATOR } from "../../src/import/glam/group.js";
import { checkUpload, planGlamImport, type GlamUpload } from "../../src/import/glam/map.js";
import { codeHits } from "./glam-code-hits.js";

/**
 * CAT-IMPORT-1 — the pure core (docs/slices/cat-import-1.md § 5 "Unit"; spec docs/slices/catalog-mode-1.md § 3.4).
 * No AWS, no mocks: text in, plan out.
 */

const HEADER = "colectie,produs,cod producator VECHI,pret achizitie,pret de lista (cu TVA),cod producator INLOCUITOR,unitate de masura,unitate de impachetare,comanda minima,link imagine produs,specificatii tehnice,format";

/** CSV-quote a cell when it needs it. */
const q = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

interface Cells {
    collection?: string; name?: string; unit?: string; packaging?: string; minimumOrder?: string;
    image?: string; specs?: string; format?: string;
    /** Columns 2–5: codes and prices. Never read. */
    codeOld?: string; purchase?: string; list?: string; codeNew?: string;
}
const line = (c: Cells) => [
    c.collection ?? "Coll", c.name ?? "Prod", c.codeOld ?? "", c.purchase ?? "", c.list ?? "", c.codeNew ?? "",
    c.unit ?? "", c.packaging ?? "", c.minimumOrder ?? "", c.image ?? "", c.specs ?? "", c.format ?? "",
].map(q).join(",");
const csv = (...rows: Cells[]) => [HEADER, ...rows.map(line)].join("\n") + "\n";

function rowsOf(text: string): GlamRow[] {
    const parsed = parseGlamCsv(text);
    if (parsed.kind !== "parsed") throw new Error(parsed.error);
    return parsed.rows;
}
function uploadOf(producer = "BOEN", sheet = "PL", variantName = "Format"): GlamUpload {
    const check = checkUpload({ producer, sheet, variantName });
    if (check.kind !== "accepted") throw new Error(check.error);
    return check.upload;
}
const plan = (text: string, upload = uploadOf()) => planGlamImport(rowsOf(text), upload);
const img = (n: number) => `https://img.test/${n}.jpg`;

// Codes and prices that a leak would carry.
const CODE_OLD = "EBG-OLD-7701";
const PURCHASE = "123.45";
const LIST = "456.78";
const CODE_NEW = "EBG-NEW-8802";
const MONEY = { codeOld: CODE_OLD, purchase: PURCHASE, list: LIST, codeNew: CODE_NEW };

describe("CAT-IMPORT-1 parser — RFC 4180, 12 columns by index, header ignored", () => {
    it("header row ignored; a product row maps idx 0,1,6–11 to named fields; columns 2–5 have no field", () => {
        const rows = rowsOf(csv({ collection: "Herringbone", name: "Oak", unit: "mp", packaging: "cutie", minimumOrder: "10", image: img(1), specs: "S", format: "120x20", ...MONEY }));
        expect(rows).toEqual([{
            index: 2, collection: "Herringbone", name: "Oak", unit: "mp", packaging: "cutie", minimumOrder: "10",
            imageUrl: img(1), specs: "S", format: "120x20",
        }]);
        expect(Object.keys(rows[0]).sort()).toEqual(
            ["collection", "format", "imageUrl", "index", "minimumOrder", "name", "packaging", "specs", "unit"]);
        const text = JSON.stringify(rows);
        for (const leaked of [CODE_OLD, PURCHASE, LIST, CODE_NEW]) expect(text).not.toContain(leaked);
    });

    it("quoted comma: BOEN's produs and format cells keep their commas", () => {
        const rows = rowsOf(`${HEADER}\nHerringbone light,"Oak Andante Live Matt brushed , 4V bevel",,,,,,,,,,"10,5x137x790 mm"\n`);
        expect(rows[0].name).toBe("Oak Andante Live Matt brushed , 4V bevel");
        expect(rows[0].format).toBe("10,5x137x790 mm");
    });

    it("quoted cells hold line breaks and doubled quotes; CRLF line ends and a BOM are accepted", () => {
        const text = `﻿${HEADER}\r\nC,"Oak ""Vivo""",,,,,,,,,"Line 1\r\nLine 2",x\r\n`;
        const rows = rowsOf(text);
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('Oak "Vivo"');
        expect(rows[0].specs).toBe("Line 1\nLine 2"); // line breaks normalised by the specs rule
        expect(rows[0].collection).toBe("C");
    });

    it("cells are trimmed; a final line break does not add a record", () => {
        expect(parseCsvRecords("a,b\n")).toEqual({ kind: "records", records: [["a", "b"]] });
        expect(rowsOf(csv({ collection: "  Coll  ", name: "  Oak  " }))[0]).toMatchObject({ collection: "Coll", name: "Oak" });
    });

    it("blank row (12 empty cells) is a row — it is reported as skipped no-name; a blank line is passed over", () => {
        const text = `${HEADER}\n,,,,,,,,,,,\n\nC,Oak,,,,,,,,,,x\n`;
        const rows = rowsOf(text);
        expect(rows.map((r) => r.index)).toEqual([2, 4]);
        expect(groupStyles(rows, "BOEN").rows).toEqual([
            { status: "skipped", index: 2, reason: "no-name" },
            expect.objectContaining({ status: "created", index: 4 }),
        ]);
    });

    it("garbage: a record whose cell count is not 12 refuses the whole file, naming the row (no shifted read of a code column)", () => {
        const shifted = `${HEADER}\nC,Oak, unquoted comma,${CODE_OLD},${PURCHASE},${LIST},${CODE_NEW},,,,,,x\n`;
        const result = parseGlamCsv(shifted);
        expect(result).toEqual({ kind: "refused", error: "The file is not the 12-column pricelist layout: row 2 has 13 cells." });
        expect(parseGlamCsv(`${HEADER}\njust some text\n`)).toMatchObject({ kind: "refused" });
    });

    it("garbage: an unclosed quoted cell refuses the file", () => {
        expect(parseGlamCsv(`${HEADER}\nC,"Oak,,,,,,,,,,x\n`)).toEqual({ kind: "refused", error: "The file is not a valid CSV: a quoted cell is not closed (row 2)." });
    });

    it("malformed quote placement in a twelve-cell record refuses the file (text is never joined)", () => {
        // `"Oak"x` would otherwise become `Oakx`; `Oa"k` is a quote inside an unquoted cell. Both records have 12 cells.
        expect(parseGlamCsv(`${HEADER}\nC,"Oak"x,,,,,,,,,,x\n`)).toEqual({
            kind: "refused", error: "The file is not a valid CSV: a character follows the closing quote of a cell in row 2.",
        });
        expect(parseGlamCsv(`${HEADER}\nC,Oak,,,,,,,,,,x\nC,Oa"k,,,,,,,,,,x\n`)).toEqual({
            kind: "refused", error: "The file is not a valid CSV: a quote appears inside an unquoted cell in row 3.",
        });
        expect(parseCsvRecords('a,"b"oops,c')).toMatchObject({ kind: "malformed" });
        expect(parseCsvRecords('a,"",c')).toEqual({ kind: "records", records: [["a", "", "c"]] });
    });

    it("U+001F inside a cell is kept by the parser (the grouping refuses the row)", () => {
        const rows = rowsOf(csv({ name: `Oak${KEY_SEPARATOR}Vivo` }));
        expect(rows[0].name).toBe(`Oak${KEY_SEPARATOR}Vivo`);
    });
});

describe("CAT-IMPORT-1 code removal from the specs (cat-import-1 § 9, CI1-SPECS-CODES)", () => {
    const SPECS = "Product type: 3-layer parquet\nArticle no.: 1016054 (EBGV2KMD)\nWood: Oak";
    const specsOf = (c: Cells) => rowsOf(csv(c))[0].specs;

    it("a line holding the row's column-5 code is removed; the other lines are kept", () => {
        expect(specsOf({ specs: SPECS, codeNew: "1016054" })).toBe("Product type: 3-layer parquet\nWood: Oak");
    });

    it("the code inside a longer number or glued to a letter is NOT matched (whole token only)", () => {
        const specs = "Dimensions: 10160543 mm\nRef X1016054\nBatch 1016054Z\nArticle no.: 1016054";
        expect(specsOf({ specs, codeNew: "1016054" })).toBe("Dimensions: 10160543 mm\nRef X1016054\nBatch 1016054Z");
    });

    it("column 2 and column 5 are both applied (trimmed cells)", () => {
        const specs = "Old reference: EBGV2KMD\nArticle no.: 1016054\nColor: Natural";
        expect(specsOf({ specs, codeOld: " EBGV2KMD ", codeNew: "1016054 " })).toBe("Color: Natural");
        expect(specsOf({ specs, codeOld: "EBGV2KMD" })).toBe("Article no.: 1016054\nColor: Natural");
    });

    it("empty code cells remove nothing", () => {
        expect(specsOf({ specs: SPECS, codeOld: "", codeNew: "  " })).toBe(SPECS);
    });

    it("the codes never reach the row: no field holds them (the row type has no code field)", () => {
        const row = rowsOf(csv({ specs: SPECS, codeOld: "EBGV2KMD", codeNew: "1016054" }))[0];
        expect(Object.keys(row)).not.toContain("codeOld");
        expect(JSON.stringify(row)).not.toMatch(/1016054|EBGV2KMD/);
    });
});

describe("CAT-IMPORT-1 key normalisation (spec § 3.4 'Product key'; tests owed before the first import)", () => {
    it("order: trim → whitespace collapse → lower-case → NFC last; diacritics kept", () => {
        expect(norm("  ȘTEFAN \t cel   MARE ")).toBe("ștefan cel mare");
    });

    it("canonical equivalence: ['P','C','J\\u030C'] and ['P','C','\\u01F0'] give one key", () => {
        expect(norm("J̌")).toBe("ǰ");
        expect(norm("ǰ")).toBe("ǰ");
        const grouped = groupStyles(rowsOf(csv(
            { collection: "C", name: "J̌", format: "a" },
            { collection: "C", name: "ǰ", format: "b" },
        )), "P");
        expect(grouped.styles).toHaveLength(1);
        expect(grouped.styles[0].key).toBe(["p", "c", "ǰ"].join(KEY_SEPARATOR));
    });

    it("idempotence: norm(norm(x)) === norm(x) for the witness, Romanian upper/lower diacritics and a whitespace-only value", () => {
        for (const x of ["J̌", "ǰ", "ĂÂÎȘȚ", "ăâîșț", "ŞŢ şţ", "ȘȚ", " \t \n "]) {
            expect(norm(norm(x))).toBe(norm(x));
        }
        expect(norm(" \t \n ")).toBe("");
    });

    it("separator witness: a produs or colecție holding U+001F → the row is skipped separator-in-key, column named", () => {
        const grouped = groupStyles(rowsOf(csv(
            { name: `Oak${KEY_SEPARATOR}Vivo` },
            { collection: `Co${KEY_SEPARATOR}ll`, name: "Oak" },
            { name: "Oak" },
        )), "BOEN");
        expect(grouped.rows).toEqual([
            { status: "skipped", index: 2, reason: "separator-in-key", column: "produs" },
            { status: "skipped", index: 3, reason: "separator-in-key", column: "colecție" },
            expect.objectContaining({ status: "created", index: 4 }),
        ]);
        // normalisation does not remove the separator (trim and \s keep it)
        expect(norm(`${KEY_SEPARATOR} a ${KEY_SEPARATOR}`)).toBe(`${KEY_SEPARATOR} a ${KEY_SEPARATOR}`);
    });

    it("empty produs → no-name; empty colecție → no-collection (the canonical header-row layout is refused openly)", () => {
        const grouped = groupStyles(rowsOf(csv({ name: "  " }, { collection: "", name: "Oak" })), "BOEN");
        expect(grouped.rows).toEqual([
            { status: "skipped", index: 2, reason: "no-name" },
            { status: "skipped", index: 3, reason: "no-collection" },
        ]);
    });

    it("the identifier rule: 'a/b'+'c' and 'a'+'b/c' are both refused; U+001F refused; producer and sheet required", () => {
        expect(checkUpload({ producer: "a/b", sheet: "c" })).toEqual({ kind: "refused", error: 'The producer name may not contain "/".' });
        expect(checkUpload({ producer: "a", sheet: "b/c" })).toEqual({ kind: "refused", error: 'The sheet name may not contain "/".' });
        expect(checkUpload({ producer: `a${KEY_SEPARATOR}`, sheet: "c" })).toMatchObject({ kind: "refused" });
        expect(checkUpload({ producer: "a", sheet: `c${KEY_SEPARATOR}` })).toMatchObject({ kind: "refused" });
        expect(checkUpload({ producer: "", sheet: "c" })).toMatchObject({ kind: "refused" });
        expect(checkUpload({ producer: "a", sheet: "   " })).toMatchObject({ kind: "refused" });
        expect(checkUpload({ producer: "—", sheet: "c" })).toEqual({ kind: "refused", error: "The producer name must give a non-empty slug: after accents are removed it needs at least one letter a–z or digit 0–9." });
        // B-4 states the slug rule: a name of letters that fold to a–z passes, even with diacritics
        expect(checkUpload({ producer: "Ștefan", sheet: "c" })).toMatchObject({ kind: "accepted" });
    });

    it("importSource = 'glam:' + norm(producer) + '/' + norm(sheet); variant name defaults to 'Variantă'", () => {
        expect(checkUpload({ producer: "  BOEN ", sheet: "PL" })).toEqual({
            kind: "accepted",
            upload: { producer: "BOEN", sheet: "PL", variantName: "Variantă", importSource: "glam:boen/pl" },
        });
        expect(checkUpload({ producer: "Alpod  Floors", sheet: "Ștefan", variantName: " Culoare " })).toMatchObject({
            upload: { producer: "Alpod Floors", variantName: "Culoare", importSource: "glam:alpod floors/ștefan" },
        });
    });
});

describe("CAT-IMPORT-1 mapper — NO-CODES / NO-PRICES over rows that carry codes and prices", () => {
    const text = csv(
        { collection: "Herringbone", name: "Oak", unit: "mp", packaging: "cutie", minimumOrder: "10", image: img(1), specs: "Spec <b>1</b>\nLine 2", format: "120x20", ...MONEY },
        { collection: "Herringbone", name: "Oak", unit: "mp", packaging: "cutie", minimumOrder: "10", image: img(2), specs: "", format: "140x20", ...MONEY },
        { collection: "Herringbone", name: "Ash", format: "", ...MONEY },
    );

    it("the draft's keys are exactly the spec's member list (with and without the optional members)", () => {
        const [oak, ash] = plan(text).styles.map((s) => s.draft);
        expect(Object.keys(oak).sort()).toEqual([
            "additionalImageLinks", "attributes", "brand", "categoryKeys", "description", "imageLink", "importSource",
            "longDescription", "rowIndexes", "slug", "title", "variants",
        ]);
        expect(Object.keys(ash).sort()).toEqual([
            "additionalImageLinks", "attributes", "brand", "categoryKeys", "description", "importSource",
            "rowIndexes", "slug", "title", "variants",
        ]);
        expect(oak.variants).toHaveLength(1);
        expect(Object.keys(oak.variants[0]).sort()).toEqual(["name", "options"]);
        for (const option of [...oak.variants[0].options, ...ash.variants[0].options]) {
            expect(Object.keys(option).every((k) => k === "value" || k === "imageLink")).toBe(true);
        }
    });

    it("no code and no price appears anywhere in the plan (drafts, rows, report)", () => {
        const serialised = JSON.stringify(plan(text));
        for (const leaked of [CODE_OLD, PURCHASE, LIST, CODE_NEW]) expect(serialised).not.toContain(leaked);
    });

    it("per column: title ← produs; attributes ← idx 0, 6, 7, 8 of the first row (format is not an attribute); brand ← producer", () => {
        const oak = plan(text).styles[0].draft;
        expect(oak.title).toBe("Oak");
        expect(oak.brand).toBe("BOEN");
        expect(oak.attributes).toEqual([
            { key: "colecție", value: "Herringbone" },
            { key: "unitate", value: "mp" },
            { key: "împachetare", value: "cutie" },
            { key: "comandă minimă", value: "10" },
        ]);
        expect(plan(text).styles[1].draft.attributes).toEqual([{ key: "colecție", value: "Herringbone" }]);
    });

    it("per column: specs (idx 10) from the first row whose specs are non-empty → escaped paragraphs + plain description", () => {
        const p = plan(csv(
            { name: "Oak", specs: "", format: "a" },
            { name: "Oak", specs: "First <b>&</b>\n\nSecond", format: "b" },
            { name: "Oak", specs: "Other", format: "c" },
        ));
        const outcome = p.styles[0];
        expect(outcome.draft.longDescription).toBe("<p>First &lt;b&gt;&amp;&lt;/b&gt;</p><p>Second</p>");
        expect(outcome.draft.description).toBe("First <b>&</b> Second");
        expect(outcome.differing).toEqual(["specificații tehnice"]);
    });

    it("specs differences include empty values, in both directions (description still from the first non-empty specs)", () => {
        const emptyFirst = plan(csv({ name: "Oak", specs: "", format: "a" }, { name: "Oak", specs: "A", format: "b" })).styles[0];
        expect(emptyFirst.differing).toEqual(["specificații tehnice"]);
        expect(emptyFirst.draft.description).toBe("A");
        const emptyLater = plan(csv({ name: "Oak", specs: "A", format: "a" }, { name: "Oak", specs: "", format: "b" })).styles[0];
        expect(emptyLater.differing).toEqual(["specificații tehnice"]);
        expect(emptyLater.draft.description).toBe("A");
        const same = plan(csv({ name: "Oak", specs: "A", format: "a" }, { name: "Oak", specs: "A", format: "b" })).styles[0];
        expect(same.differing).toEqual([]);
    });

    it("description is at most 300 characters, cut at a word boundary", () => {
        const long = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
        const d = plan(csv({ specs: long })).styles[0].draft.description;
        expect(d.length).toBeLessThanOrEqual(300);
        expect(d.endsWith("…")).toBe(true);
        expect(long.startsWith(d.slice(0, -1))).toBe(true);
    });

    it("categories: the producer's parent and one child per collection, slugs by the WooCommerce slugify", () => {
        const p = plan(csv({ collection: "Herringbone Light", name: "Oak" }, { collection: "Chevron", name: "Oak" }), uploadOf("Boen Ștefan"));
        expect(p.categories).toEqual([
            { slug: "boen-stefan", name: "Boen Ștefan", parentSlug: null },
            { slug: "boen-stefan-herringbone-light", name: "Herringbone Light", parentSlug: "boen-stefan" },
            { slug: "boen-stefan-chevron", name: "Chevron", parentSlug: "boen-stefan" },
        ]);
        expect(p.styles[0].draft.categoryKeys).toEqual(["boen-stefan", "boen-stefan-herringbone-light"]);
    });
});

describe("CAT-IMPORT-1 grouping — one style per key, dedupe, collision-aware labels, derived images", () => {
    it("format is not in the key: rows of one style become options of one product", () => {
        const p = plan(csv({ name: "Oak", format: "120", image: img(1) }, { name: "Oak", format: "140", image: img(2) }));
        expect(p.counts).toEqual({ products: 1, options: 2, deduped: 0, skipped: 0 });
        expect(p.styles[0].draft.variants[0]).toEqual({
            name: "Format", options: [{ value: "120", imageLink: img(1) }, { value: "140", imageLink: img(2) }],
        });
    });

    it("equal normalised label AND equal image → one option (the later row is deduped)", () => {
        const p = plan(csv({ name: "Oak", format: "X 1", image: img(1) }, { name: "Oak", format: " x  1 ", image: img(1) }));
        expect(p.counts).toEqual({ products: 1, options: 1, deduped: 1, skipped: 0 });
        expect(p.rows[1]).toEqual({ status: "deduped", index: 3, slug: p.styles[0].draft.slug, optionValue: "X 1" });
    });

    it("options merge on equal label AND equal image CELL: distinct invalid cells stay two options (B-3 withdrawn, § 9)", () => {
        const p = plan(csv({ name: "Oak", format: "x", image: "invalid-a" }, { name: "Oak", format: "x", image: "invalid-b" }));
        expect(p.counts).toEqual({ products: 1, options: 2, deduped: 0, skipped: 0 });
        expect(p.styles[0].draft.variants[0].options).toEqual([{ value: "x" }, { value: "x (2)" }]);
        expect(p.rows.map((r) => (r.status === "skipped" || r.status === "deduped" ? r.status : r.image.disposition))).toEqual(["invalid", "invalid"]);
    });

    it("an invalid image cell and an empty one are two options; equal invalid cells merge", () => {
        const twoKinds = plan(csv({ name: "Oak", format: "x", image: "invalid-a" }, { name: "Oak", format: "x" }));
        expect(twoKinds.counts.options).toBe(2);
        expect(twoKinds.rows.map((r) => r.status === "created" || r.status === "option" ? r.image.disposition : r.status)).toEqual(["invalid", "absent"]);
        const equal = plan(csv({ name: "Oak", format: "x", image: "invalid-a" }, { name: "Oak", format: "x", image: "invalid-a" }));
        expect(equal.counts).toEqual({ products: 1, options: 1, deduped: 1, skipped: 0 });
    });

    it("labels x, x, x (2) (distinct images) → x, x (3), x (2)", () => {
        const p = plan(csv(
            { name: "Oak", format: "x", image: img(1) },
            { name: "Oak", format: "x", image: img(2) },
            { name: "Oak", format: "x (2)", image: img(3) },
        ));
        expect(p.styles[0].draft.variants[0].options.map((o) => o.value)).toEqual(["x", "x (3)", "x (2)"]);
        expect(p.relabelled).toEqual([{ slug: p.styles[0].draft.slug, value: "x (3)" }]);
    });

    it("labels #1, '', '' (distinct images) → #1, #2, #3", () => {
        const p = plan(csv(
            { name: "Oak", format: "#1", image: img(1) },
            { name: "Oak", format: "", image: img(2) },
            { name: "Oak", format: "", image: img(3) },
        ));
        expect(p.styles[0].draft.variants[0].options.map((o) => o.value)).toEqual(["#1", "#2", "#3"]);
    });

    it("derived: imageLink = first option image, additionalImageLinks = the other distinct option images in order; no image → imageless", () => {
        const p = plan(csv(
            { name: "Oak", format: "a" },
            { name: "Oak", format: "b", image: img(1) },
            { name: "Oak", format: "c", image: "ftp://img.test/x.jpg" },
            { name: "Oak", format: "d", image: img(2) },
            { name: "Oak", format: "e", image: img(1) },
            { name: "Ash", format: "a", image: "not a url" },
        ));
        const [oak, ash] = p.styles.map((s) => s.draft);
        expect(oak.imageLink).toBe(img(1));
        expect(oak.additionalImageLinks).toEqual([img(2)]);
        expect(oak.variants[0].options[0]).toEqual({ value: "a" });
        expect("imageLink" in ash).toBe(false);
        expect(ash.additionalImageLinks).toEqual([]);
    });

    it("report rows: every row once, in file order; created / option / deduped / skipped with image disposition", () => {
        const p = plan(csv(
            { name: "Oak", format: "a", image: img(1) },
            { name: "Oak", format: "b", image: "nope" },
            { name: "Oak", format: "a", image: img(1) },
            { name: "", format: "z" },
            { name: "Ash", format: "" },
        ));
        const oak = p.styles[0].draft.slug;
        const ash = p.styles[1].draft.slug;
        expect(p.rows).toEqual([
            { status: "created", index: 2, slug: oak, optionValue: "a", image: { sourceUrl: img(1), disposition: "used" } },
            { status: "option", index: 3, slug: oak, optionValue: "b", image: { sourceUrl: "nope", disposition: "invalid" } },
            { status: "deduped", index: 4, slug: oak, optionValue: "a" },
            { status: "skipped", index: 5, reason: "no-name" },
            { status: "created", index: 6, slug: ash, optionValue: "#1", image: { sourceUrl: "", disposition: "absent" } },
        ]);
        expect(p.styles[0].options.map((o) => o.rowIndexes)).toEqual([[2, 4], [3]]);
    });

    it("slug: two keys with one slug (review-8's BOEN witness, PL.csv rows 17/18) → the later gets -2, reported", () => {
        const p = plan(csv(
            { collection: "Herringbone Click Castle", name: "Oak Vivo Live Natural brushed, 4V bevel" },
            { collection: "Herringbone Click Castle", name: "Oak Vivo Live Natural brushed , 4V bevel" },
        ));
        expect(p.styles.map((s) => s.draft.slug)).toEqual([
            "boen-herringbone-click-castle-oak-vivo-live-natural-brushed-4v-bevel",
            "boen-herringbone-click-castle-oak-vivo-live-natural-brushed-4v-bevel-2",
        ]);
        expect(p.suffixedSlugs).toEqual([{ slug: p.styles[1].draft.slug, rowIndex: 3 }]);
    });

    it("idempotent: the same file planned twice gives the same plan", () => {
        const text = csv({ name: "Oak", format: "a", image: img(1) }, { name: "Oak", format: "", image: img(2) }, { name: "Ash" });
        expect(plan(text)).toEqual(plan(text));
    });
});

describe("CAT-IMPORT-1 acceptance fixture — BOEN PL.csv (launch amendment CI1-A1)", () => {
    const fixtures = path.resolve(__dirname, "fixtures/glam");
    const expected = JSON.parse(readFileSync(path.join(fixtures, "cat-import-1-expected-counts.json"), "utf8")).acceptance["BOEN/PL"];

    it("478 rows → 437 styles, 455 options, 23 deduped, 53 empty labels, 0 suffixed, 157 imageless, 27 collections, 0 skipped", () => {
        const text = readFileSync(path.join(fixtures, "boen-PL.csv"), "utf8");
        const rows = rowsOf(text);
        // No record was passed over as a blank line: every record after the header is a row (operator's blank = 0).
        expect(expected.skipped.blank).toBe(0);
        const records = parseCsvRecords(text);
        expect(records.kind === "records" && records.records.length - 1).toBe(rows.length);
        const p = planGlamImport(rows, uploadOf(expected.producer, expected.sheet, "Format"));
        const options = p.styles.flatMap((s) => s.options);
        const skipped = (reason: string) => p.rows.filter((r) => r.status === "skipped" && r.reason === reason).length;
        expect({
            rows: p.totalRows,
            styles: p.counts.products,
            options: p.counts.options,
            deduped: p.counts.deduped,
            emptyLabels: options.filter((o) => o.labelOrigin === "empty-numbered").length,
            suffixed: options.filter((o) => o.labelOrigin === "duplicate-suffixed").length,
            imagelessStyles: p.styles.filter((s) => s.draft.imageLink === undefined).length,
            collections: new Set(rows.map((r) => norm(r.collection))).size,
            skipped: { noName: skipped("no-name"), noCollection: skipped("no-collection"), refusedSeparator: skipped("separator-in-key") },
        }).toEqual({
            rows: expected.rows,
            styles: expected.styles,
            options: expected.options,
            deduped: expected.deduped,
            emptyLabels: expected.emptyLabels,
            suffixed: expected.suffixed,
            imagelessStyles: expected.imagelessStyles,
            collections: expected.collections,
            skipped: { noName: expected.skipped.noName, noCollection: expected.skipped.noCollection, refusedSeparator: expected.skipped.refusedSeparator },
        });
        // Every row appears exactly once in the report.
        expect(p.rows.map((r) => r.index)).toEqual(rows.map((r) => r.index));
        // The child categories are one per collection, plus the producer's parent.
        expect(p.categories).toHaveLength(expected.collections + 1);
    });

    it("code-removal oracle: over all 478 rows no draft field holds a column-2/5 value of any row (image fields excepted, § 9)", () => {
        const text = readFileSync(path.join(fixtures, "boen-PL.csv"), "utf8");
        const records = parseCsvRecords(text);
        if (records.kind !== "records") throw new Error(records.error);
        const codes = [...new Set(records.records.slice(1).flatMap((r) => [r[2], r[5]]).map((c) => c.trim()).filter(Boolean))];
        expect(codes.length).toBeGreaterThan(400); // the fixture keeps columns 2 and 5 (CI1-A2)
        const p = planGlamImport(rowsOf(text), uploadOf(expected.producer, expected.sheet, "Format"));
        const hits = codeHits(p.styles.map((s) => s.draft), codes);
        expect(hits).toEqual([]);
        // the oracle can see a code: the image URLs (the named exclusion) do hold them
        expect(codeHits(p.styles.map((s) => ({ image: s.draft.imageLink ?? "" })), codes).length).toBeGreaterThan(0);
        // and the article lines are gone from every description
        expect(p.styles.some((s) => /Article no\./.test(s.draft.longDescription ?? ""))).toBe(false);
    });
});

