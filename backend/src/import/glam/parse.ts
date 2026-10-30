/**
 * CAT-IMPORT-1 — parser of one glam enriched pricelist CSV (glamCRM pl-tools `out/<vendor>/enriched/<sheet>.csv`).
 * Pure: text in, rows out. No I/O. Spec: docs/slices/catalog-mode-1.md § 3.4 "Input" and the column table, as
 * amended by docs/slices/cat-import-1.md § 9 (CI1-SPECS-CODES).
 *
 * The frozen layout has twelve columns, read BY INDEX; the first record (the header) is ignored. Columns 3 and 4 hold
 * prices: they are NEVER read. Columns 2 and 5 hold producer codes: they are read ONLY to remove, from the specs
 * text, every line that contains one of the row's codes as a whole token. `GlamRow` has no field for any of the four
 * columns, so no later stage can store a price or a code cell from this file.
 */

/** The number of cells every record of the frozen layout has. */
export const GLAM_COLUMN_COUNT = 12;

/**
 * The column indexes this parser reads into `GlamRow`. The only place these indexes are written; columns not named
 * here or in `CODE_COLUMNS` are not read.
 */
const COLUMN = {
    collection: 0,   // colecție
    name: 1,         // produs
    unit: 6,         // unitate de măsură
    packaging: 7,    // unitate de împachetare
    minimumOrder: 8, // comandă minimă
    imageUrl: 9,     // link imagine produs
    specs: 10,       // specificații tehnice
    format: 11,      // format — the variant label
} as const;

/** The producer-code columns. Read only by `removeCodeLines`; never copied into a row. */
const CODE_COLUMNS = {
    codeOld: 2,      // cod producător vechi
    codeNew: 5,      // cod producător înlocuitor
} as const;

/** Skip list — documentation only, never used to index a record: purchase price, list price. */
export const NEVER_READ_COLUMNS = [3, 4] as const;

/** One data record of the file. Every value is the cell trimmed; a missing value is "". */
export interface GlamRow {
    /** The record's line in the file as a spreadsheet shows it: the header is 1, the first data record is 2. */
    readonly index: number;
    readonly collection: string;
    readonly name: string;
    readonly unit: string;
    readonly packaging: string;
    readonly minimumOrder: string;
    readonly imageUrl: string;
    /** The specs text with every line that contains one of the row's producer codes removed (`removeCodeLines`). */
    readonly specs: string;
    readonly format: string;
}

export type GlamParseResult =
    | { readonly kind: "parsed"; readonly rows: GlamRow[] }
    | { readonly kind: "refused"; readonly error: string };

/**
 * Parse the file. Refused (the caller answers 400, nothing is written) when the CSV is malformed (an unclosed quoted
 * cell, or a quote where RFC 4180 does not allow one) or when a data record does not have exactly twelve cells: a
 * record with a different cell count is not the frozen layout, and reading it by index would put a cell of another
 * column — possibly a code or a price — in a read field. A blank line is not a record of the layout and is passed over.
 */
export function parseGlamCsv(text: string): GlamParseResult {
    const parsed = parseCsvRecords(text);
    if (parsed.kind === "malformed") return { kind: "refused", error: `The file is not a valid CSV: ${parsed.error}` };
    const records = parsed.records;

    const wrongWidth: string[] = [];
    const rows: GlamRow[] = [];
    // records[0] is the header: ignored.
    for (let r = 1; r < records.length; r++) {
        const cells = records[r];
        const index = r + 1;
        // A blank line holds no cell of the layout: it is not a row (it is neither reported nor refused).
        if (cells.length === 1 && cells[0].trim() === "") continue;
        if (cells.length !== GLAM_COLUMN_COUNT) {
            wrongWidth.push(`row ${index} has ${cells.length}`);
            continue;
        }
        rows.push({
            index,
            collection: cells[COLUMN.collection].trim(),
            name: cells[COLUMN.name].trim(),
            unit: cells[COLUMN.unit].trim(),
            packaging: cells[COLUMN.packaging].trim(),
            minimumOrder: cells[COLUMN.minimumOrder].trim(),
            imageUrl: cells[COLUMN.imageUrl].trim(),
            specs: removeCodeLines(cells[COLUMN.specs], [cells[CODE_COLUMNS.codeOld], cells[CODE_COLUMNS.codeNew]]).trim(),
            format: cells[COLUMN.format].trim(),
        });
    }
    if (wrongWidth.length > 0) {
        const shown = wrongWidth.slice(0, 10).join("; ");
        const more = wrongWidth.length > 10 ? ` (and ${wrongWidth.length - 10} more)` : "";
        return {
            kind: "refused",
            error: `The file is not the 12-column pricelist layout: ${shown}${more} cells.`,
        };
    }
    return { kind: "parsed", rows };
}

/**
 * CI1-SPECS-CODES (§ 9): drop every line of `specs` that contains one of the code cells (trimmed, non-empty) as a
 * whole token — not preceded or followed by a letter or a digit, so code `1016054` does not match inside `10160543`.
 * Empty code cells remove nothing. The kept lines are joined with "\n" (with or without codes, one form).
 */
function removeCodeLines(specs: string, codeCells: readonly string[]): string {
    const codes = codeCells.map((c) => c.trim()).filter((c) => c !== "");
    const tokens = codes.map((code) =>
        new RegExp(`(?<![\\p{L}\\p{N}])${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u"));
    return specs
        .split(/\r\n|\r|\n/)
        .filter((line) => !tokens.some((token) => token.test(line)))
        .join("\n");
}

export type CsvRecordsResult =
    | { readonly kind: "records"; readonly records: string[][] }
    | { readonly kind: "malformed"; readonly error: string };

/**
 * RFC 4180 records: comma-separated cells; a double-quoted cell may hold commas, line breaks and `""` (one quote).
 * Line breaks: CRLF, LF or CR. A leading UTF-8 BOM is dropped. A final line break does not start a record.
 * Malformed (nothing is guessed): a quoted cell not closed before the end of the text; a character other than a
 * comma or a line break after a closing quote (`"b"oops`); a quote inside an unquoted cell (`b"c`).
 * Row numbers in the error are spreadsheet rows (the header is 1).
 */
export function parseCsvRecords(text: string): CsvRecordsResult {
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const records: string[][] = [];
    let record: string[] = [];
    let cell = "";
    let i = 0;
    let quoted = false;     // inside a quoted cell
    let closed = false;     // the current cell was quoted and its closing quote has been read
    // True once the current record has any content (a cell separator or a character); an empty text has no record.
    let started = false;
    const malformed = (what: string): CsvRecordsResult =>
        ({ kind: "malformed", error: `${what} in row ${records.length + 1}.` });

    while (i < src.length) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"') {
                if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
                quoted = false; closed = true; i++; continue;
            }
            cell += ch; i++; continue;
        }
        if (ch === ",") { record.push(cell); cell = ""; closed = false; started = true; i++; continue; }
        if (ch === "\r" || ch === "\n") {
            record.push(cell);
            records.push(record);
            record = []; cell = ""; closed = false; started = false;
            i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
            continue;
        }
        if (closed) return malformed("a character follows the closing quote of a cell");
        if (ch === '"') {
            if (cell !== "") return malformed("a quote appears inside an unquoted cell");
            quoted = true; started = true; i++; continue;
        }
        cell += ch; started = true; i++;
    }
    if (quoted) return { kind: "malformed", error: `a quoted cell is not closed (row ${records.length + 1}).` };
    if (started) { record.push(cell); records.push(record); }
    return { kind: "records", records };
}
