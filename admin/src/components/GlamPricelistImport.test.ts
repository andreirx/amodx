import { describe, it, expect } from "vitest";
import {
    glamFormReducer, canCheck, confirmInput, brandsOf, INITIAL_GLAM_FORM, type GlamFormState, type GlamFormEvent,
} from "./GlamPricelistImport";

/**
 * CAT-IMPORT-1 (cycle 2, review-0 correction 2) — the pricelist form's state: a confirmed import is exactly the input
 * the shown dry run was made for. Delayed and out-of-order completions (file reads, dry runs) are replayed as events.
 */

const run = (events: GlamFormEvent[], from: GlamFormState = INITIAL_GLAM_FORM) => events.reduce(glamFormReducer, from);
const fields: GlamFormEvent[] = [
    { type: "field", field: "producer", value: "BOEN" },
    { type: "field", field: "sheet", value: "PL" },
];
/** A dry run sent now: the snapshot `check()` captures before calling the API. */
const snapshot = (s: GlamFormState) => ({ revision: s.revision, input: s.input });

describe("glamFormReducer — file reads", () => {
    it("checking is impossible while a file read is pending, and the old file's content is dropped at once", () => {
        let s = run([{ type: "file-chosen", fileName: "A.csv", fileToken: 1 }, { type: "file-read", fileToken: 1, content: "A" }, ...fields]);
        expect(canCheck(s)).toBe(true);
        s = glamFormReducer(s, { type: "file-chosen", fileName: "B.csv", fileToken: 2 });
        expect(s.reading).toBe(true);
        expect(s.input.csvContent).toBe("");
        expect(s.input.sheet).toBe("B");
        expect(canCheck(s)).toBe(false);
    });

    it("a delayed read of a replaced file is ignored; the latest file's read is taken", () => {
        let s = run([{ type: "file-chosen", fileName: "A.csv", fileToken: 1 }, { type: "file-chosen", fileName: "B.csv", fileToken: 2 }]);
        s = glamFormReducer(s, { type: "file-read", fileToken: 1, content: "A" }); // A finishes late
        expect(s.input.csvContent).toBe("");
        expect(s.reading).toBe(true);
        s = glamFormReducer(s, { type: "file-read", fileToken: 2, content: "B" });
        expect(s.input).toMatchObject({ csvContent: "B", fileName: "B.csv" });
        expect(s.reading).toBe(false);
    });
});

describe("glamFormReducer — dry run bound to its input", () => {
    const loaded = run([{ type: "file-chosen", fileName: "A.csv", fileToken: 1 }, { type: "file-read", fileToken: 1, content: "A" }, ...fields]);

    it("review-0 sequence: A checked, B chosen while A's dry run is in flight → A's report is ignored, nothing to confirm", () => {
        const sentA = snapshot(loaded);
        let s = glamFormReducer(loaded, { type: "check-sent" });
        s = glamFormReducer(s, { type: "file-chosen", fileName: "B.csv", fileToken: 2 });
        s = glamFormReducer(s, { type: "file-read", fileToken: 2, content: "B" });
        s = glamFormReducer(s, { type: "check-done", ...sentA, report: { sheet: "A" } }); // A's answer arrives last
        expect(s.preview).toBeNull();
        expect(confirmInput(s)).toBeNull();
        expect(s.pending).toBeNull();
        expect(canCheck(s)).toBe(true); // B must be checked first
    });

    it("an edit while the dry run is in flight → its (out-of-order) answer and its failure are ignored", () => {
        const sent = snapshot(loaded);
        let s = glamFormReducer(loaded, { type: "check-sent" });
        s = glamFormReducer(s, { type: "field", field: "producer", value: "ITC" });
        expect(glamFormReducer(s, { type: "check-done", ...sent, report: {} }).preview).toBeNull();
        expect(glamFormReducer(s, { type: "check-failed", revision: sent.revision, message: "boom" }).error).toBeNull();
    });

    it("an accepted dry run: the confirmation sends exactly the checked snapshot; any later edit withdraws it", () => {
        const sent = snapshot(loaded);
        let s = run([{ type: "check-sent" }, { type: "check-done", ...sent, report: { sheet: "PL" } }], loaded);
        expect(confirmInput(s)).toEqual({ csvContent: "A", fileName: "A.csv", producer: "BOEN", sheet: "PL", variantName: "Variantă" });
        s = glamFormReducer(s, { type: "field", field: "variantName", value: "Format" });
        expect(s.preview).toBeNull();
        expect(confirmInput(s)).toBeNull();
    });

    it("a failure of the current dry run is shown", () => {
        const sent = snapshot(loaded);
        const s = run([{ type: "check-sent" }, { type: "check-failed", revision: sent.revision, message: "API Error (409): …" }], loaded);
        expect(s.error).toBe("API Error (409): …");
    });

    it("no confirmation while a request is pending; after the import the report is withdrawn", () => {
        const sent = snapshot(loaded);
        let s = run([{ type: "check-sent" }, { type: "check-done", ...sent, report: {} }, { type: "import-sent" }], loaded);
        expect(confirmInput(s)).toBeNull();
        s = glamFormReducer(s, { type: "import-done", result: { counts: {} } });
        expect(s.preview).toBeNull();
        expect(s.result).toEqual({ counts: {} });
    });
});

describe("brandsOf — producer suggestions", () => {
    it("distinct, trimmed, non-empty, sorted", () => {
        expect(brandsOf([{ brand: "BOEN" }, { brand: " ITC " }, {}, { brand: "" }, { brand: "BOEN" }, { brand: "Alpod" }])).toEqual(["Alpod", "BOEN", "ITC"]);
    });
});
