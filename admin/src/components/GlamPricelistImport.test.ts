import { describe, it, expect } from "vitest";
import {
    glamFormReducer, canCheck, confirmRequest, brandsOf, INITIAL_GLAM_FORM, type GlamFormState, type GlamFormEvent,
    imageCopyReducer, imageProblems, imageCounts, IDLE_IMAGE_COPY, type ImageCopyState,
    checkRequest, profileChangedRefusal, requestBody, incompleteImportReport, hiddenProducts, hiddenCauseText, HIDDEN_CAUSE_UNKNOWN,
    crossSheetLine, withinFileLine,
} from "./GlamPricelistImport";
import {
    proposeProfile, keyHints, applyProfileEdit, keyActionOf, attributeModeOf, nameNumberHint, collectionHint,
    sheetsToReimport, storedMoved, movedNotice, SAVE_RULE, FILTER_MODE_HELP, VARIANT_MODE_HELP, FACET_VISIBILITY_HELP, PUBLISH_WITHOUT_IMAGES_HELP, type SpecKeyFact, type ProfileEditor,
} from "./GlamProfileEditor";
import { buildFacetListing } from "@amodx/shared";
import { ApiError } from "@/lib/api";
import type { GlamImportProfile } from "@amodx/shared";

/**
 * CAT-IMPORT-1 (cycle 2, review-0 correction 2) — the pricelist form's state: a confirmed import is exactly the input
 * the shown dry run was made for. Delayed and out-of-order completions (file reads, dry runs) are replayed as events.
 */

const run = (events: GlamFormEvent[], from: GlamFormState = INITIAL_GLAM_FORM) => events.reduce(glamFormReducer, from);
const fields: GlamFormEvent[] = [
    { type: "field", field: "producer", value: "BOEN" },
    { type: "field", field: "sheet", value: "PL" },
];
/** A dry run sent now: the snapshot `check()` captures before calling the API (the first check sends no profile choice). */
const snapshot = (s: GlamFormState) => ({ revision: s.revision, input: s.input, choice: null, context: null });
/** CAT-IMPORT-PROFILE-1C: the default profile as the backend reports it (backend `glam/profile.ts` `DEFAULT_PROFILE`). */
const DEFAULT = { version: 1 as const, grouping: { kind: "as-is" as const }, collection: { kind: "column" as const }, specKeys: [], facetModes: { attributes: [] } };
/** A dry-run answer with the members the form reads; `profile` = nothing stored (the default). */
const dryRun = (over: Record<string, unknown> = {}) => ({
    producer: "BOEN", sheet: "PL", importSource: "glam:boen/pl", products: [], categoryConflicts: [],
    profile: { source: "default", revision: null, value: DEFAULT }, sheets: [], specKeys: [], drafts: [], siteProducts: [], ...over,
});

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
        expect(confirmRequest(s)).toBeNull();
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
        let s = run([{ type: "check-sent" }, { type: "check-done", ...sent, report: dryRun() }], loaded);
        expect(confirmRequest(s)).toEqual({
            input: { csvContent: "A", fileName: "A.csv", producer: "BOEN", sheet: "PL", variantName: "Variantă" },
            choice: { profile: DEFAULT, baseRevision: null },
        });
        s = glamFormReducer(s, { type: "field", field: "variantName", value: "Format" });
        expect(s.preview).toBeNull();
        expect(confirmRequest(s)).toBeNull();
    });

    it("a failure of the current dry run is shown", () => {
        const sent = snapshot(loaded);
        const s = run([{ type: "check-sent" }, { type: "check-failed", revision: sent.revision, message: "API Error (409): …" }], loaded);
        expect(s.error).toBe("API Error (409): …");
    });

    it("no confirmation while a request is pending; after the import the report is withdrawn", () => {
        const sent = snapshot(loaded);
        let s = run([{ type: "check-sent" }, { type: "check-done", ...sent, report: dryRun() }, { type: "import-sent" }], loaded);
        expect(confirmRequest(s)).toBeNull();
        const result = { counts: {}, profile: { source: "explicit", revision: null, value: DEFAULT, stored: { kind: "none" } } };
        s = glamFormReducer(s, { type: "import-done", result });
        expect(s.preview).toBeNull();
        expect(s.result).toEqual(result);
    });
});

describe("brandsOf — producer suggestions", () => {
    it("distinct, trimmed, non-empty, sorted", () => {
        expect(brandsOf([{ brand: "BOEN" }, { brand: " ITC " }, {}, { brand: "" }, { brand: "BOEN" }, { brand: "Alpod" }])).toEqual(["Alpod", "BOEN", "ITC"]);
    });
});

// ── CAT-IMAGES-1 — the image copy's batch loop and failure list ───────────────────────────────────────────────────
// Batch answers below have the shape the images route answers (backend glam-images.ts; its handler rows show a source
// shared by two products reported once per request, with only the holding that request wrote; a holding is reported
// again only when a later request rewrote it after an overlap restored its producer URL, § 9).

const TARGET = { producer: "BOEN", sheet: "PL" };
const U1 = "https://img.test/1.jpg";
const U2 = "https://img.test/2.jpg";
const A = { productId: "pA", slug: "boen-oak", option: "120" };
const B = { productId: "pB", slug: "boen-ash", option: "90" };
const C = { productId: "pC", slug: "boen-elm", option: "60" };
const http404 = { kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 } };
const noAnswer = { kind: "failed", failure: { kind: "error", code: "ETIMEDOUT" } };
const batch = (sources: any[], over: Record<string, any> = {}) => ({
    importSource: "glam:boen/pl",
    sources,
    counts: {},
    products: { updated: 1, replaced: [] },
    progress: { sourcesAtStart: 1, resolved: 1, remainingOptions: 1, remainingSources: 1 },
    complete: false,
    ...over,
});
const done = { complete: true, progress: { sourcesAtStart: 1, resolved: 1, remainingOptions: 0, remainingSources: 0 } };
const started = () => imageCopyReducer(IDLE_IMAGE_COPY, { type: "start", target: TARGET, resume: false });
const run2 = (...answers: any[]) => answers.reduce((s: ImageCopyState, response) => imageCopyReducer(s, { type: "batch", response }), started());
const totalsOf = (s: ImageCopyState) => { if (s.kind === "idle") throw new Error("idle"); return s.totals; };

describe("imageCopyReducer — the batch loop", () => {
    it("start → running; a batch with work left → running; a complete batch → done; products and batches added", () => {
        let s: ImageCopyState = started();
        expect(s.kind).toBe("running");
        s = imageCopyReducer(s, { type: "batch", response: batch([{ kind: "ingested", url: U2, cdnUrl: "c2", holders: [A] }]) });
        expect(s.kind).toBe("running");
        s = imageCopyReducer(s, { type: "batch", response: batch([{ kind: "cached", url: U1, cdnUrl: "c1", holders: [B] }], { ...done, products: { updated: 1, replaced: [{ productId: "p9", slug: "x" }] } }) });
        expect(s.kind).toBe("done");
        expect(totalsOf(s)).toMatchObject({ productsUpdated: 2, productsReplaced: 1, remainingOptions: 0, remainingSources: 0, batches: 2, importSource: "glam:boen/pl" });
    });

    it("a batch that changed no product while work remains → stopped (no endless loop)", () => {
        const s = imageCopyReducer(started(), { type: "batch", response: batch([], { products: { updated: 0, replaced: [] }, progress: { sourcesAtStart: 5, resolved: 0, remainingOptions: 7, remainingSources: 5 } }) });
        expect(s.kind).toBe("stopped");
        if (s.kind === "stopped") expect(s.error).toMatch(/changed no product.*5 image/);
    });

    it("a failed request → stopped with the message; totals kept", () => {
        let s = imageCopyReducer(started(), { type: "batch", response: batch([{ kind: "ingested", url: U2, cdnUrl: "c2", holders: [A] }]) });
        s = imageCopyReducer(s, { type: "failed", message: "Request failed (503)" });
        expect(s).toMatchObject({ kind: "stopped", error: "Request failed (503)" });
        expect(imageCounts(totalsOf(s)).ingested).toBe(1);
    });

    it("events that do not apply leave the state unchanged (a second start while running, a batch when idle or done)", () => {
        const running = started();
        expect(imageCopyReducer(running, { type: "start", target: { producer: "X", sheet: "Y" }, resume: true })).toBe(running);
        expect(imageCopyReducer(IDLE_IMAGE_COPY, { type: "batch", response: batch([], done) })).toBe(IDLE_IMAGE_COPY);
        const finished = imageCopyReducer(running, { type: "batch", response: batch([], done) });
        expect(imageCopyReducer(finished, { type: "failed", message: "late" })).toBe(finished);
    });
});

describe("review-0 CIM-F2 — batches merged by source URL, outcome precedence", () => {
    it("one shared source copied across two batches (ingested for A, then cached for B) → ONE source, counted ingested", () => {
        const t = totalsOf(run2(
            batch([{ kind: "ingested", url: U1, cdnUrl: "c1", holders: [A] }]),
            batch([{ kind: "cached", url: U1, cdnUrl: "c1", holders: [B] }], done),
        ));
        expect(imageCounts(t)).toEqual({ ingested: 1, cached: 0, refused: 0, failed: 0 });
        expect(t.sources[U1].holders.map((h) => [h.productId, h.batch, h.result.kind])).toEqual([["pA", 1, "ingested"], ["pB", 2, "cached"]]);
        expect(imageProblems(t, null)).toEqual([]);
    });

    it("one shared source failing in both batches → ONE failed source, ONE problem entry listing both holdings", () => {
        const t = totalsOf(run2(batch([{ ...http404, url: U1, holders: [A] }]), batch([{ ...noAnswer, url: U1, holders: [B] }], done)));
        expect(imageCounts(t)).toEqual({ ingested: 0, cached: 0, refused: 0, failed: 1 });
        expect(imageProblems(t, null)).toEqual([
            // the latest failure gives the reason
            { url: U1, reason: "no answer (ETIMEDOUT)", places: ["boen-oak — 120", "boen-ash — 90"] },
        ]);
    });

    it("failure then success (a transient error) → still a problem, for the holding that LOST the image only", () => {
        const t = totalsOf(run2(batch([{ ...http404, url: U1, holders: [A] }]), batch([{ kind: "ingested", url: U1, cdnUrl: "c1", holders: [B] }], done)));
        expect(imageCounts(t)).toEqual({ ingested: 0, cached: 0, refused: 0, failed: 1 });
        expect(imageProblems(t, null)).toEqual([{ url: U1, reason: "HTTP 404, text/html, 10 bytes — error status", places: ["boen-oak — 120"] }]);
    });

    it("a refusal outranks an earlier failure only by being later; refused + cached URLs are distinct sources", () => {
        const t = totalsOf(run2(
            batch([{ ...http404, url: U1, holders: [A] }, { kind: "cached", url: U2, cdnUrl: "c2", holders: [C] }]),
            batch([{ kind: "refused", url: U1, rule: "x resolves to 10.0.0.1: private 10.0.0.0/8 (RFC 1918)", holders: [B] }], done),
        ));
        expect(imageCounts(t)).toEqual({ ingested: 0, cached: 1, refused: 1, failed: 0 });
        expect(imageProblems(t, null).map((p) => p.reason)).toEqual(["refused: x resolves to 10.0.0.1: private 10.0.0.0/8 (RFC 1918)"]);
    });

    // review-2 CIM-F2-OVERLAP — rule: a holding's recorded outcome is its LATEST committed outcome. The server reports a
    // holding again when an overlapping stale write (§ 9) restored its producer URL and a later batch rewrote it
    // (backend overlap row: R3 reports the holding R1 already wrote).
    const refusedU1 = { kind: "refused", url: U1, rule: "x resolves to 10.0.0.1: private 10.0.0.0/8 (RFC 1918)" };
    it.each([
        ["failed → ingested (the overlap-to-repair sequence)", { ...http404, url: U1 }, { kind: "ingested", url: U1, cdnUrl: "c1" }, [U1],
            { ingested: 1, cached: 0, refused: 0, failed: 0 }, []],
        ["ingested → failed (restored, then the source died)", { kind: "ingested", url: U1, cdnUrl: "c1" }, { ...noAnswer, url: U1 }, [],
            { ingested: 0, cached: 0, refused: 0, failed: 1 }, ["no answer (ETIMEDOUT)"]],
        ["failed → refused", { ...http404, url: U1 }, refusedU1, [],
            { ingested: 0, cached: 0, refused: 1, failed: 0 }, ["refused: x resolves to 10.0.0.1: private 10.0.0.0/8 (RFC 1918)"]],
        ["refused → cached (copied earlier, never in this session)", refusedU1, { kind: "cached", url: U1, cdnUrl: "c1" }, [],
            { ingested: 0, cached: 1, refused: 0, failed: 0 }, []],
        ["failed → failed (unchanged repeat): listed once, latest reason", { ...http404, url: U1 }, { ...noAnswer, url: U1 }, [],
            { ingested: 0, cached: 0, refused: 0, failed: 1 }, ["no answer (ETIMEDOUT)"]],
        ["ingested → cached (unchanged success repeat)", { kind: "ingested", url: U1, cdnUrl: "c1" }, { kind: "cached", url: U1, cdnUrl: "c1" }, [],
            { ingested: 1, cached: 0, refused: 0, failed: 0 }, []],
    ] as const)("holding A: %s", (_label, first, second, copiedInSecond, counts, reasons) => {
        const t = totalsOf(run2(
            batch([{ ...first, holders: [A] }], { copied: first.kind === "ingested" ? [{ url: U1, cdnUrl: "c1" }] : [] }),
            batch([{ ...second, holders: [A] }], { ...done, copied: copiedInSecond.map((url) => ({ url, cdnUrl: "c1" })) }),
        ));
        expect(t.sources[U1].holders).toHaveLength(1);
        expect(t.sources[U1].holders[0].batch).toBe(2);
        expect(imageCounts(t)).toEqual(counts);
        const problems = imageProblems(t, null);
        expect(problems.map((p) => p.reason)).toEqual(reasons);
        for (const p of problems) expect(p.places).toEqual(["boen-oak — 120"]);
    });

    it("a holding reported under ANOTHER URL (its option image changed) supersedes its outcome under the old URL", () => {
        const t = totalsOf(run2(
            batch([{ ...http404, url: U1, holders: [A] }]),
            batch([{ kind: "ingested", url: U2, cdnUrl: "c2", holders: [A] }], { ...done, copied: [{ url: U2, cdnUrl: "c2" }] }),
        ));
        expect(t.sources[U1].holders).toEqual([]);
        expect(imageCounts(t)).toEqual({ ingested: 1, cached: 0, refused: 0, failed: 0 });
        expect(imageProblems(t, null)).toEqual([]);
    });
});

describe("review-1 CIM-F2 — copy provenance kept apart from committed holdings", () => {
    it("A and B copied in batch 1, only A's product written; B written from MEDIAMAP# in batch 2 → both counted copied this session", () => {
        const t = totalsOf(run2(
            batch([{ kind: "ingested", url: U1, cdnUrl: "c1", holders: [A] }], { copied: [{ url: U1, cdnUrl: "c1" }, { url: U2, cdnUrl: "c2" }] }),
            batch([{ kind: "cached", url: U2, cdnUrl: "c2", holders: [B] }], { ...done, copied: [] }),
        ));
        expect(imageCounts(t)).toEqual({ ingested: 2, cached: 0, refused: 0, failed: 0 });
        expect(imageProblems(t, null)).toEqual([]);
    });

    it("after batch 1 only: B copied but no product written yet → not counted, and no failure claim for its deferred holder", () => {
        const t = totalsOf(run2(batch([{ kind: "ingested", url: U1, cdnUrl: "c1", holders: [A] }], { copied: [{ url: U1, cdnUrl: "c1" }, { url: U2, cdnUrl: "c2" }] })));
        expect(t.copiedThisSession).toEqual({ [U1]: true, [U2]: true });
        expect(imageCounts(t)).toEqual({ ingested: 1, cached: 0, refused: 0, failed: 0 });
        expect(imageProblems(t, null)).toEqual([]);
    });

    it("a source copied in an EARLIER session (MEDIAMAP# hit, never in `copied`) stays cached", () => {
        const t = totalsOf(run2(batch([{ kind: "cached", url: U2, cdnUrl: "c2", holders: [B] }], { ...done, copied: [] })));
        expect(imageCounts(t)).toEqual({ ingested: 0, cached: 1, refused: 0, failed: 0 });
    });
});

describe("imageProblems — the failure list join", () => {
    const report = {
        importSource: "glam:boen/pl",
        products: [
            { slug: "boen-oak", options: [{ value: "120", imageLink: U1, rowIndexes: [7, 3] }, { value: "140", imageLink: U2, rowIndexes: [4] }] },
            { slug: "boen-ash", options: [{ value: "90", imageLink: U1, rowIndexes: [12] }] },
        ],
    };

    it("with the import report of the same sheet: the file rows of the holdings that lost the image, sorted", () => {
        const t = totalsOf(run2(batch([{ ...http404, url: U1, holders: [A, B] }], done)));
        expect(imageProblems(t, report)).toEqual([
            { url: U1, reason: "HTTP 404, text/html, 10 bytes — error status", places: ["row 3", "row 7", "row 12"] },
        ]);
    });

    it("rows only for the holdings that lost the image (B got it from a later batch)", () => {
        const t = totalsOf(run2(batch([{ ...http404, url: U1, holders: [A] }]), batch([{ kind: "ingested", url: U1, cdnUrl: "c1", holders: [B] }], done)));
        expect(imageProblems(t, report)[0].places).toEqual(["row 3", "row 7"]);
    });

    it("without an import in this session, or with another sheet's report: product address and variant label", () => {
        const t = totalsOf(run2(batch([{ ...http404, url: U1, holders: [A] }], done)));
        const expected = [{ url: U1, reason: "HTTP 404, text/html, 10 bytes — error status", places: ["boen-oak — 120"] }];
        expect(imageProblems(t, null)).toEqual(expected);
        expect(imageProblems(t, { ...report, importSource: "glam:alpod/her" })).toEqual(expected);
    });

    it("reasons: a refusal names its rule; a failure without an HTTP answer names its code; not-image", () => {
        const t = totalsOf(run2(batch([
            { kind: "refused", url: "u", rule: "r1", holders: [A] },
            { kind: "failed", url: "v", failure: { kind: "error", code: "CERT_HAS_EXPIRED" }, holders: [A] },
            { kind: "failed", url: "w", failure: { kind: "http", reason: "not-image", status: 200, contentType: "image/jpeg", bytes: 46 }, holders: [A] },
        ], done)));
        expect(imageProblems(t, null).map((p) => p.reason)).toEqual([
            "refused: r1", "no answer (CERT_HAS_EXPIRED)", "HTTP 200, image/jpeg, 46 bytes — not an image",
        ]);
    });
});

// ── CAT-IMPORT-PROFILE-1C — the profile editor inside the form state (design docs/slices/cat-import-profile-1.md § 6) ──

/**
 * BOEN's measured `specKeys` (default profile), hand-built from the backend's own pure planner output: `analyseSpecKeys`
 * over `backend/test/unit/fixtures/glam/boen-PL.csv` (producer BOEN, sheet PL), run by the throwaway script
 * `.agent-manager/slices/CAT-IMPORT-PROFILE-1C/boen-speckeys.mts` (EXECUTED 2026-10-31; output
 * `measure-boen-speckeys.json`: 437 products, 13 keys). Every number below is copied from that output; samples are
 * cut to the first value, `refused` is empty for every key, `rule` is "not-reviewed" for every key.
 */
const fact = (key: string, n: Partial<SpecKeyFact>): SpecKeyFact => ({
    key, rows: 310, products: 280, distinctValues: 1, maxValueHolders: 1, repeatRule: "offered", commaRows: 0,
    variantLevelProducts: 0, equalToFormat: 0, equalToCollection: 0, samples: [], refused: [], rule: { action: "not-reviewed" }, ...n,
});
const BOEN_KEYS: SpecKeyFact[] = [
    fact("Product type", { distinctValues: 2, maxValueHolders: 258, samples: ["3-layer parquet"] }),
    fact("Wood", { distinctValues: 5, maxValueHolders: 250, samples: ["Oak"] }),
    fact("Treatment", { distinctValues: 8, maxValueHolders: 122, samples: ["Live Natural oil"] }),
    fact("Color", { rows: 305, products: 277, distinctValues: 31, maxValueHolders: 117, samples: ["Transparent"] }),
    fact("Format", { distinctValues: 11, maxValueHolders: 68, variantLevelProducts: 7, samples: ["14mm Plank Herringbone Click Castle"] }),
    fact("Dimensions (mm)", { distinctValues: 11, maxValueHolders: 68, variantLevelProducts: 7, equalToFormat: 258, samples: ["14x209x1045 mm"] }),
    fact("Connection", { distinctValues: 2, maxValueHolders: 222, samples: ["5G Click"] }),
    fact("Floor Heating", { distinctValues: 3, maxValueHolders: 253, samples: ["suitable"] }),
    fact("Appearance", { rows: 305, products: 277, distinctValues: 5, maxValueHolders: 105, samples: ["Golden floors"] }),
    fact("Surface", { distinctValues: 17, maxValueHolders: 71, commaRows: 310, variantLevelProducts: 7, samples: ["Beveled 4V, Brushed, Toplayer ca. 3.5 mm"] }),
    fact("Style", { rows: 304, products: 277, distinctValues: 17, maxValueHolders: 54, commaRows: 201, samples: ["Classic"] }),
    fact("Certificates", { distinctValues: 1, maxValueHolders: 280, samples: ["controlled sources"] }),
    fact("Nordic swan", { rows: 133, products: 120, distinctValues: 1, maxValueHolders: 120, samples: ["fulfilled"] }),
];

const STORED: GlamImportProfile = {
    version: 1, grouping: { kind: "as-is" }, collection: { kind: "column" },
    specKeys: [{ key: "Wood", action: "attribute", label: "Esență", split: "none" }, { key: "Dimensions (mm)", action: "prose-only" }],
    facetModes: { attributes: [{ key: "Esență", mode: "always" }] },
};
const storedReport = (revision: number, value: GlamImportProfile) => dryRun({ profile: { source: "stored", revision, value }, specKeys: BOEN_KEYS });
const explicitReport = (revision: number | null, value: GlamImportProfile, stored: unknown) => dryRun({ profile: { source: "explicit", revision, value, stored }, specKeys: BOEN_KEYS });

const loadedFile = run([{ type: "file-chosen", fileName: "PL.csv", fileToken: 1 }, { type: "file-read", fileToken: 1, content: "csv" }, { type: "field", field: "producer", value: "BOEN" }]);
/** Send the check `checkRequest` builds now and answer it with `report`. */
const answer = (s: GlamFormState, report: unknown): GlamFormState => {
    const req = checkRequest(s)!;
    return run([{ type: "check-sent" }, { type: "check-done", revision: s.revision, input: req.input, choice: req.choice, report, context: null }], s);
};
const editing = (s: GlamFormState) => s.profile as Extract<ProfileEditor, { kind: "editing" }>;

describe("1c — loading the profile (§ 6.1, § 6.2, § 3.3)", () => {
    it("nothing stored: the default is loaded, NOT the proposal; confirm sends the default with baseRevision null", () => {
        expect(checkRequest(loadedFile)!.choice).toBeNull(); // the first check sends no choice
        const s = answer(loadedFile, dryRun({ specKeys: BOEN_KEYS }));
        expect(s.profile).toMatchObject({ kind: "editing", base: { kind: "none" }, working: DEFAULT });
        expect(confirmRequest(s)!.choice).toEqual({ profile: DEFAULT, baseRevision: null });
    });

    it("stored revision 3: the stored profile is loaded; confirm unchanged sends it with baseRevision 3 (§ 6.2)", () => {
        const s = answer(loadedFile, storedReport(3, STORED));
        expect(editing(s).working).toEqual(STORED);
        expect(confirmRequest(s)!.choice).toEqual({ profile: STORED, baseRevision: 3 });
        expect(checkRequest(s)!.choice).toEqual({ profile: STORED, baseRevision: 3 }); // "Previzualizează" sends the same
    });

    it("unsupported stored profile: nothing loaded, not importable, no preview until the proposal is taken; then baseRevision = the stored revision", () => {
        let s = answer(loadedFile, dryRun({ profile: { source: "unsupported", revision: 4, reason: "version 2" }, specKeys: BOEN_KEYS }));
        expect(s.profile).toMatchObject({ kind: "unsupported", revision: 4, reason: "version 2" });
        expect(s.preview!.choice).toBeNull();
        expect(confirmRequest(s)).toBeNull();
        expect(checkRequest(s)).toBeNull();
        s = glamFormReducer(s, { type: "profile-edit", edit: { kind: "grouping", grouping: { kind: "trailing-number", label: "removed-token" } } });
        expect(s.profile.kind).toBe("unsupported"); // only the proposal starts an edit
        const proposal = proposeProfile(BOEN_KEYS);
        s = glamFormReducer(s, { type: "profile-edit", edit: { kind: "replace", profile: proposal } });
        expect(s.profile).toMatchObject({ kind: "editing", base: { kind: "unsupported", revision: 4 } });
        expect(checkRequest(s)!.choice).toEqual({ profile: proposal, baseRevision: 4 }); // § 3.3 item 5: explicit replacement
    });

    it("a new file or another producer resets the editor; the sheet name and the variant name keep it", () => {
        const s = answer(loadedFile, storedReport(3, STORED));
        expect(glamFormReducer(s, { type: "field", field: "sheet", value: "PL2" }).profile.kind).toBe("editing");
        expect(glamFormReducer(s, { type: "field", field: "variantName", value: "Format" }).profile.kind).toBe("editing");
        expect(glamFormReducer(s, { type: "field", field: "producer", value: "ITC" }).profile.kind).toBe("not-loaded");
        expect(glamFormReducer(s, { type: "file-chosen", fileName: "B.csv", fileToken: 2 }).profile.kind).toBe("not-loaded");
    });
});

describe("1c — every edit withdraws the report; confirm sends the previewed profile and baseRevision", () => {
    it("an edit bumps the revision, withdraws the report and blocks the confirmation; a late answer of the old check is ignored", () => {
        const before = loadedFile;
        const sent = checkRequest(before)!;
        let s = glamFormReducer(before, { type: "check-sent" });
        s = glamFormReducer(s, { type: "check-done", revision: before.revision, input: sent.input, choice: null, report: storedReport(3, STORED), context: null });
        const shown = s;
        s = glamFormReducer(s, { type: "profile-edit", edit: { kind: "key-label", key: "Wood", label: "Lemn" } });
        expect(s.revision).toBe(shown.revision + 1);
        expect(s.preview).toBeNull();
        expect(confirmRequest(s)).toBeNull();
        expect(editing(s).working.specKeys[0]).toEqual({ key: "Wood", action: "attribute", label: "Lemn", split: "none" });
        // the answer of a preview sent before the edit arrives late: ignored
        const late = glamFormReducer(s, { type: "check-done", revision: shown.revision, input: sent.input, choice: { profile: STORED, baseRevision: 3 }, report: explicitReport(3, STORED, { kind: "supported", revision: 3 }), context: null });
        expect(late.preview).toBeNull();
    });

    it("the preview sends {working, baseRevision}; its answer is confirmable with exactly that snapshot, input included", () => {
        let s = answer(loadedFile, storedReport(3, STORED));
        s = glamFormReducer(s, { type: "profile-edit", edit: { kind: "key-split", key: "Wood", split: "comma" } });
        const sent = checkRequest(s)!;
        const edited = { ...STORED, specKeys: [{ key: "Wood", action: "attribute" as const, label: "Esență", split: "comma" as const }, STORED.specKeys[1]] };
        expect(sent.choice).toEqual({ profile: edited, baseRevision: 3 });
        s = answer(s, explicitReport(4, edited, { kind: "supported", revision: 3 }));
        expect(confirmRequest(s)).toEqual({ input: sent.input, choice: { profile: edited, baseRevision: 3 } });
        expect(JSON.parse(requestBody(confirmRequest(s)!.input, confirmRequest(s)!.choice)).profileChoice).toEqual({ profile: edited, baseRevision: 3 });
        expect(storedMoved(s.profile, s.preview!.report)).toBeNull();
    });

    it("the request body carries profileChoice only when a choice is sent", () => {
        const input = loadedFile.input;
        expect(JSON.parse(requestBody(input, null))).toEqual({ csvContent: "csv", producer: "BOEN", sheet: "PL", variantName: "Variantă" });
        expect(JSON.parse(requestBody(input, { profile: DEFAULT, baseRevision: null }))).toHaveProperty("profileChoice", { profile: DEFAULT, baseRevision: null });
    });

    it("after an import the profile it used is the base: revision from the answer, so the next preview of another sheet is accepted", () => {
        let s = answer(loadedFile, dryRun({ specKeys: BOEN_KEYS }));
        s = glamFormReducer(s, { type: "profile-edit", edit: { kind: "replace", profile: STORED } });
        s = answer(s, explicitReport(1, STORED, { kind: "none" }));
        s = run([{ type: "import-sent" }, { type: "import-done", result: { counts: {}, profile: { source: "explicit", revision: 1, value: STORED, stored: { kind: "none" } } } }], s);
        expect(editing(s).base).toEqual({ kind: "stored", revision: 1, value: STORED });
        s = glamFormReducer(s, { type: "field", field: "sheet", value: "PL2" });
        expect(checkRequest(s)!.choice).toEqual({ profile: STORED, baseRevision: 1 });
    });
});

describe("1c — the 409 → reload → re-preview path (§ 6.6)", () => {
    const OTHER: GlamImportProfile = { ...DEFAULT, specKeys: [{ key: "Wood", action: "prose-only" }] };

    it("snapshot n refused (another import stored m): report withdrawn, the stored m reloaded, the user's snapshot kept, a new preview required", () => {
        let s = answer(loadedFile, storedReport(1, STORED));
        s = glamFormReducer(s, { type: "profile-edit", edit: { kind: "attribute-mode", attributeKey: "Esență", mode: "never" } });
        const mine = editing(s).working;
        s = answer(s, explicitReport(2, mine, { kind: "supported", revision: 1 }));
        const sent = confirmRequest(s)!;
        expect(sent.choice).toEqual({ profile: mine, baseRevision: 1 });
        s = run([{ type: "import-sent" }, { type: "import-profile-changed", message: "refused", storedRevision: 2 }], s);
        expect(s.preview).toBeNull();
        expect(s.error).toBe("refused");
        expect(editing(s).otherImport).toEqual({ storedRevision: 2 });
        // the reload: a dry run WITHOUT a choice; its answer refreshes the base, keeps the snapshot, shows nothing importable
        s = run([{ type: "check-sent" }, { type: "check-done", revision: s.revision, input: sent.input, choice: null, report: storedReport(2, OTHER), context: null }], s);
        expect(editing(s).base).toEqual({ kind: "stored", revision: 2, value: OTHER });
        expect(editing(s).working).toEqual(mine);
        expect(s.preview).toBeNull();
        expect(confirmRequest(s)).toBeNull();
        // option 1: re-apply the old snapshot — sent with baseRevision = m after a new preview
        expect(checkRequest(s)!.choice).toEqual({ profile: mine, baseRevision: 2 });
        // option 2: take the stored m
        const taken = glamFormReducer(s, { type: "profile-edit", edit: { kind: "replace", profile: OTHER } });
        expect(checkRequest(taken)!.choice).toEqual({ profile: OTHER, baseRevision: 2 });
        // the new preview is confirmable; a successful import clears the notice
        s = answer(s, explicitReport(3, mine, { kind: "supported", revision: 2 }));
        expect(confirmRequest(s)!.choice).toEqual({ profile: mine, baseRevision: 2 });
        s = run([{ type: "import-sent" }, { type: "import-done", result: { counts: {}, profile: { source: "explicit", revision: 3, value: mine, stored: { kind: "supported", revision: 2 } } } }], s);
        expect(editing(s)).toMatchObject({ base: { kind: "stored", revision: 3 }, otherImport: null });
    });

    it("a preview answer whose stored revision is not the base shows that it moved", () => {
        const s = answer(loadedFile, storedReport(1, STORED));
        expect(storedMoved(s.profile, explicitReport(2, STORED, { kind: "supported", revision: 2 }) as any)).toEqual({ storedRevision: 2 });
        expect(storedMoved(s.profile, explicitReport(1, STORED, { kind: "supported", revision: 1 }) as any)).toBeNull();
    });

    it("only a 409 naming storedRevision and baseRevision is 'changed by another import'", () => {
        const changed = { error: "changed", storedRevision: 2, baseRevision: 1 };
        expect(profileChangedRefusal(new ApiError(409, changed, "API Error (409): changed"))).toEqual({ storedRevision: 2 });
        expect(profileChangedRefusal(new ApiError(409, { ...changed, storedRevision: null }, "x"))).toEqual({ storedRevision: null });
        expect(profileChangedRefusal(new ApiError(409, { error: "An import is running on this site." }, "x"))).toBeNull(); // the lock
        expect(profileChangedRefusal(new ApiError(409, { error: "u", profile: { source: "unsupported", revision: 4, reason: "r" } }, "x"))).toBeNull();
        expect(profileChangedRefusal(new ApiError(500, changed, "x"))).toBeNull();
        expect(profileChangedRefusal(new Error("API Error (409): changed"))).toBeNull();
    });
});

describe("1c — proposeProfile over BOEN's measured specKeys (§ 6.1 step 3)", () => {
    it("every key → attribute, label = the key as written, split none, no mode; grouping and collection at the default", () => {
        const p = proposeProfile(BOEN_KEYS);
        expect(p.grouping).toEqual({ kind: "as-is" });
        expect(p.collection).toEqual({ kind: "column" });
        expect(p.facetModes).toEqual({ attributes: [] });
        expect(p.specKeys).toHaveLength(13);
        expect(p.specKeys).toEqual(BOEN_KEYS.map((k) => ({ key: k.key, action: "attribute", label: k.key, split: "none" })));
        expect(p).not.toEqual(DEFAULT); // a proposal, not the default
    });

    it("the proposal is not applied by loading: the default stays the working profile until the user takes it", () => {
        const s = answer(loadedFile, dryRun({ specKeys: BOEN_KEYS }));
        expect(editing(s).working).toEqual(DEFAULT);
        const taken = glamFormReducer(s, { type: "profile-edit", edit: { kind: "replace", profile: proposeProfile(BOEN_KEYS) } });
        expect(editing(taken).working.specKeys).toHaveLength(13);
        expect(taken.preview).toBeNull();
    });

    it("hints name the measured facts: comma lists, variant-level values, equality with the variant label, one value", () => {
        const hints = Object.fromEntries(BOEN_KEYS.map((k) => [k.key, keyHints(k)]));
        expect(hints["Style"]).toEqual(["listă cu virgule în 201 rânduri"]);
        expect(hints["Surface"]).toEqual(["listă cu virgule în 310 rânduri", "diferă între opțiuni în 7 produse"]);
        expect(hints["Dimensions (mm)"]).toEqual(["diferă între opțiuni în 7 produse", "egal cu eticheta variantei (fără spații și „mm”) în 258/310 rânduri"]);
        expect(hints["Format"]).toEqual(["diferă între opțiuni în 7 produse"]);
        expect(hints["Certificates"]).toEqual(["o singură valoare"]);
        expect(hints["Wood"]).toEqual([]);
        // design § 2.7 ALPOD `dimensions`: 82 values under the union rule
        expect(keyHints(fact("dimensions", { distinctValues: 82, repeatRule: "not-offered" }))).toEqual(["regula repetării nu l-ar oferi ca filtru pentru produsele acestui fișier (82 valori)"]);
        expect(keyHints(fact("Price", { refused: [{ rowIndex: 3, reason: "money" }] }))).toContain("1 linii refuzate de filtrul de valori (cod sau preț)");
    });

    it("grouping and collection hints come from the dry run that grouped as-is / took the column", () => {
        const products = ["Altona UX Altona 34", "Altona UX Altona 35", "SR Lumen AB", "34"].map((title, i) => ({ slug: `p${i}`, title }));
        expect(nameNumberHint(dryRun({ products }) as any)).toEqual({ endsInNumber: 2, products: 4 });
        expect(nameNumberHint(explicitReport(1, { ...DEFAULT, grouping: { kind: "trailing-number", label: "removed-token" } }, { kind: "none" }) as any)).toBeNull();
        const drafts = [["colecție", "Prices in EUR per m²"], ["colecție", "Prices in EUR per m²"], ["unitate", "m²"]].map(([key, value]) => ({ attributes: [{ key, value }] }));
        expect(collectionHint(dryRun({ drafts }) as any)).toEqual({ values: 1 });
        expect(collectionHint(explicitReport(1, { ...DEFAULT, collection: { kind: "spec", key: "Collection" } }, { kind: "none" }) as any)).toBeNull();
    });
});

describe("1c — applyProfileEdit", () => {
    const P = proposeProfile(BOEN_KEYS.slice(0, 3)); // Product type, Wood, Treatment

    it("the collection spec key is consumed: it leaves specKeys and shows as the collection source", () => {
        const p = applyProfileEdit(P, { kind: "collection", collection: { kind: "spec", key: "Wood" } });
        expect(p.specKeys.map((r) => r.key)).toEqual(["Product type", "Treatment"]);
        expect(keyActionOf(p, "Wood")).toBe("collection");
        expect(keyActionOf(applyProfileEdit(p, { kind: "collection", collection: { kind: "column" } }), "Wood")).toBe("not-reviewed");
    });

    it("rules keep their place; prose-only / not-reviewed / attribute again", () => {
        let p = applyProfileEdit(P, { kind: "key-action", key: "Wood", action: "prose-only" });
        expect(p.specKeys.map((r) => r.key)).toEqual(["Product type", "Wood", "Treatment"]);
        expect(p.specKeys[1]).toEqual({ key: "Wood", action: "prose-only" });
        p = applyProfileEdit(p, { kind: "key-action", key: "Wood", action: "not-reviewed" });
        expect(keyActionOf(p, "Wood")).toBe("not-reviewed");
        p = applyProfileEdit(p, { kind: "key-action", key: "Wood", action: "attribute" });
        expect(p.specKeys[2]).toEqual({ key: "Wood", action: "attribute", label: "Wood", split: "none" }); // appended, label = key
        expect(applyProfileEdit(P, { kind: "key-label", key: "Nope", label: "x" })).toEqual(P);
    });

    it("a label change carries its filter mode; a mode whose rule is gone is dropped; column-key modes stay", () => {
        let p = applyProfileEdit(P, { kind: "attribute-mode", attributeKey: "Wood", mode: "never" });
        p = applyProfileEdit(p, { kind: "attribute-mode", attributeKey: "colecție", mode: "always" });
        p = applyProfileEdit(p, { kind: "key-label", key: "Wood", label: "Esență" });
        expect(attributeModeOf(p, "Esență")).toBe("never");
        expect(attributeModeOf(p, "Wood")).toBe("auto");
        p = applyProfileEdit(p, { kind: "key-action", key: "Wood", action: "prose-only" });
        expect(p.facetModes.attributes).toEqual([{ key: "colecție", mode: "always" }]);
    });

    it("the variant mode is serialised only when enabled (§ 3.3 item 2)", () => {
        const never = applyProfileEdit(P, { kind: "variant-mode", mode: "never" });
        expect(never.facetModes).toEqual({ variant: "never", attributes: [] });
        const auto = applyProfileEdit(never, { kind: "variant-mode", mode: "auto" });
        expect(Object.keys(auto.facetModes)).toEqual(["attributes"]);
    });
});

describe("1c — sheet states (§ 3.4, § 6.3)", () => {
    const sheets = [
        { importSource: "glam:alpod/aur", products: 7, state: "current", revisions: [2], unstamped: 0 },
        { importSource: "glam:alpod/argint", products: 5, state: "stale", revisions: [1], unstamped: 0 },
        { importSource: "glam:alpod/bronz", products: 3, state: "no-profile", revisions: [], unstamped: 3 },
        { importSource: "glam:alpod/cupru", products: 4, state: "mixed", revisions: [1], unstamped: 2 },
    ];
    it("with a stored profile: the OTHER sheets not current are listed for re-import; nothing stored → none listed", () => {
        const s = answer(loadedFile, dryRun({ importSource: "glam:alpod/bronz", sheets, profile: { source: "stored", revision: 2, value: STORED } }));
        expect(sheetsToReimport(s.profile).map((x) => x.importSource)).toEqual(["glam:alpod/argint", "glam:alpod/cupru"]);
        const none = answer(loadedFile, dryRun({ importSource: "glam:alpod/bronz", sheets }));
        expect(sheetsToReimport(none.profile)).toEqual([]);
    });
});

// ── Iteration 1 (review-0) ────────────────────────────────────────────────────────────────────────────────────────

describe("1c — every answer that reports the stored state refreshes the editor (review-0 R1)", () => {
    const sheet = (importSource: string, state: string, revisions: number[]) => ({ importSource, products: 3, state, revisions, unstamped: 0 });
    const before = [sheet("glam:alpod/aur", "current", [1]), sheet("glam:alpod/argint", "current", [1])];
    const loadedAur = () => answer(loadedFile, dryRun({ importSource: "glam:alpod/aur", sheets: before, profile: { source: "stored", revision: 1, value: STORED } }));
    const changedProfile = { ...STORED, specKeys: [STORED.specKeys[0]] };

    it("a new revision: the answer's sheets replace the old ones, so the other sheet is listed for re-import at once", () => {
        let s = glamFormReducer(loadedAur(), { type: "profile-edit", edit: { kind: "replace", profile: changedProfile } });
        s = answer(s, explicitReport(2, changedProfile, { kind: "supported", revision: 1 }));
        expect(sheetsToReimport(s.profile)).toEqual([]); // before the import both sheets carry the stored revision 1
        const after = [sheet("glam:alpod/aur", "current", [2]), sheet("glam:alpod/argint", "stale", [1])];
        s = run([{ type: "import-sent" }, { type: "import-done", result: { counts: {}, sheets: after, profile: { source: "explicit", revision: 2, value: changedProfile, stored: { kind: "supported", revision: 1 } } } }], s);
        expect(editing(s).base).toMatchObject({ kind: "stored", revision: 2 });
        expect(editing(s).facts.sheets).toEqual(after);
        expect(sheetsToReimport(s.profile).map((x) => x.importSource)).toEqual(["glam:alpod/argint"]);
    });

    it("an unchanged-profile re-import: the revision stays, every sheet current, nothing listed", () => {
        let s = loadedAur();
        const after = [sheet("glam:alpod/aur", "current", [1]), sheet("glam:alpod/argint", "current", [1])];
        s = run([{ type: "import-sent" }, { type: "import-done", result: { counts: {}, sheets: after, profile: { source: "explicit", revision: 1, value: STORED, stored: { kind: "supported", revision: 1 } } } }], s);
        expect(editing(s).base).toMatchObject({ kind: "stored", revision: 1 });
        expect(sheetsToReimport(s.profile)).toEqual([]);
    });

    it("a 503 'incomplete' (products written, profile saved) refreshes the base and the sheets too; other failures do not", () => {
        const body = { error: "incomplete", sheets: [sheet("glam:alpod/argint", "stale", [1])], profile: { source: "explicit", revision: 2, value: changedProfile, stored: { kind: "supported", revision: 1 } } };
        const reported = incompleteImportReport(new ApiError(503, body, "API Error (503): incomplete"))!;
        expect(reported).toEqual({ profile: body.profile, sheets: body.sheets });
        let s = run([{ type: "import-sent" }, { type: "import-incomplete", message: "incomplete", reported }], loadedAur());
        expect(editing(s).base).toMatchObject({ kind: "stored", revision: 2 });
        expect(sheetsToReimport(s.profile).map((x) => x.importSource)).toEqual(["glam:alpod/argint"]);
        expect(s.error).toBe("incomplete");
        expect(incompleteImportReport(new ApiError(503, { error: "Service Unavailable" }, "x"))).toBeNull(); // a gateway timeout
        expect(incompleteImportReport(new ApiError(500, body, "x"))).toBeNull();
        s = run([{ type: "import-sent" }, { type: "import-failed", message: "boom" }], loadedAur());
        expect(editing(s).base).toMatchObject({ kind: "stored", revision: 1 });
    });
});

describe("1c — copy states only what the mechanism guarantees (review-0 R4, review-1)", () => {
    // Each restated rule is checked by the module that owns it: `buildFacetListing` from @amodx/shared.
    const shown = (base: any[], f = "") => buildFacetListing(base, f, "/c").facets;
    const facet = (base: any[], id: string, f = "") => shown(base, f).find((x) => x.id === id);
    const values = (base: any[], id: string, f = "") => facet(base, id, f)?.values.map((v) => [v.value, v.count]);
    const p = (id: string, attributes: { key: string; value: string }[], over: Record<string, unknown> = {}) => ({ id, brand: "B", attributes, ...over });

    it("moved stored revision: the notice is bounded ('poate'), it does not restate the backend's acceptance rule", () => {
        for (const text of [movedNotice(2), movedNotice(null)]) {
            expect(text).toContain("Importul poate fi refuzat; dacă este refuzat, nu se schimbă nimic");
            expect(text).not.toMatch(/va fi refuzat|acceptat numai/);
        }
        // the backend decides (accepted: same revision, or equal content, or the explicit default while none is stored —
        // backend glam-profile.test.ts "acceptance…" / "…equal to DEFAULT_PROFILE…"); the admin does not block the import
        let s = answer(loadedFile, storedReport(1, STORED));
        s = answer(s, explicitReport(2, STORED, { kind: "supported", revision: 2 }));
        expect(storedMoved(s.profile, s.preview!.report)).toEqual({ storedRevision: 2 });
        expect(confirmRequest(s)).not.toBeNull();
    });

    it("attribute offer: automat = the repeat rule over non-silent holders; a universal value is listed beside others", () => {
        expect(FILTER_MODE_HELP).toContain("fără produsele marcate „niciodată”, cel puțin 2 produse ale paginii au cheia");
        // reviewer's witness: A holds Oak, Ash; B holds Oak → offered, BOTH values listed (Oak is held by every product)
        expect(values([p("a", [{ key: "Esență", value: "Oak" }, { key: "Esență", value: "Ash" }]), p("b", [{ key: "Esență", value: "Oak" }])], "a.Esență"))
            .toEqual([["Ash", 1], ["Oak", 2]]);
        expect(FILTER_MODE_HELP).not.toMatch(/o valoare pe care o au toate produsele nu apare/);
        // two silent holders + one automatic → not offered (the rule runs over the non-silent holders)
        const never = { attributes: [{ key: "Esență", mode: "never" }] };
        const base = [p("a", [{ key: "Esență", value: "Oak" }], { facetModes: never }), p("b", [{ key: "Esență", value: "Oak" }], { facetModes: never }), p("c", [{ key: "Esență", value: "Ash" }]), p("d", [])];
        expect(facet(base, "a.Esență")).toBeUndefined();
        // …but the silent holders still match and count when the value is chosen
        expect(values(base, "a.Esență", "a.Esență=Oak")).toEqual([["Oak", 2]]);
    });

    it("attribute offer: mereu overrides the repeat rule — one holder of three is offered and shown", () => {
        expect(FILTER_MODE_HELP).toContain("mereu: este oferit pe orice pagină unde un produs importat cu acest profil are cheia");
        const always = { attributes: [{ key: "Esență", mode: "always" }] };
        expect(values([p("a", [{ key: "Esență", value: "Oak" }], { facetModes: always }), p("b", []), p("c", [])], "a.Esență")).toEqual([["Oak", 1]]);
    });

    it("variant offer: no repeat rule — two distinct, non-repeating values are offered", () => {
        expect(VARIANT_MODE_HELP).toContain("automat: este oferit pe orice pagină, fără regula repetării");
        const v = (value: string) => ({ variants: [{ name: "Format", options: [{ value }] }] });
        expect(values([p("a", [], v("120")), p("b", [], v("90"))], "varianta")).toEqual([["90", 1], ["120", 1]]);
        // variant never: those products' values are not proposed, but they match a chosen variant
        const silent = { facetModes: { variant: "never", attributes: [] } };
        const base = [p("a", [], { ...v("120"), ...silent }), p("b", [], v("90")), p("c", [], v("60"))];
        expect(values(base, "varianta")).toEqual([["60", 1], ["90", 1]]);
        expect(buildFacetListing(base, "varianta=120", "/c").items.map((x) => x.id)).toEqual(["a"]);
    });

    it("visibility: a selected facet stays shown even when its value covers the whole page; an unselected one does not", () => {
        expect(FACET_VISIBILITY_HELP).toBe("Pe pagină, un filtru este afișat dacă are deja o valoare aleasă, sau dacă este oferit și cel puțin una dintre valorile propuse nu este la toate produsele paginii.");
        const always = { attributes: [{ key: "Esență", mode: "always" }] };
        const all = ["a", "b", "c"].map((id) => p(id, [{ key: "Esență", value: "Oak" }], { facetModes: always }));
        expect(facet(all, "a.Esență")).toBeUndefined(); // offered (mereu), but no proposed value narrows
        expect(values(all, "a.Esență", "a.Esență=Oak")).toEqual([["Oak", 3]]); // selected → shown
    });

    it("saving: an ACCEPTED import saves the previewed profile only when it differs; the unprofiled default is never saved", () => {
        expect(SAVE_RULE).toContain("un import acceptat salvează profilul previzualizat dacă diferă de cel salvat");
        expect(SAVE_RULE).toContain("profilul implicit nu se salvează");
        // what is sent for that case: the default with no stored revision (backend resolveProfile → unprofiled, no write)
        expect(confirmRequest(answer(loadedFile, dryRun()))!.choice).toEqual({ profile: DEFAULT, baseRevision: null });
    });
});

// ── CAT-IMAGE-GATE-1 (docs/slices/cat-image-gate-1.md § 3 items 4, 6) ────────────────────────────────────────────────

describe("CAT-IMAGE-GATE-1 — the profile checkbox", () => {
    const DEFAULT: GlamImportProfile = { version: 1, grouping: { kind: "as-is" }, collection: { kind: "column" }, specKeys: [], facetModes: { attributes: [] } };
    it("checked → publishWithoutImages: true; unchecked → the member is removed, so the profile equals the default again (nothing to save)", () => {
        const on = applyProfileEdit(DEFAULT, { kind: "publish-without-images", value: true });
        expect(on).toEqual({ ...DEFAULT, publishWithoutImages: true });
        const off = applyProfileEdit(on, { kind: "publish-without-images", value: false });
        expect(off).toEqual(DEFAULT);
        expect("publishWithoutImages" in off).toBe(false);
        expect(applyProfileEdit({ ...DEFAULT, publishWithoutImages: false }, { kind: "publish-without-images", value: false })).toEqual(DEFAULT);
    });
    it("the help text states both settings (Romanian)", () => {
        expect(PUBLISH_WITHOUT_IMAGES_HELP).toMatch(/Oprit \(implicit\): fiecare produs importat rămâne ascuns/);
        expect(PUBLISH_WITHOUT_IMAGES_HELP).toMatch(/Pornit: toate produsele sunt publicate la import/);
    });
});

describe("CAT-IMAGE-GATE-1 — the image section: published count and the products that stay hidden", () => {
    const H = (p: { productId: string; slug: string }, title: string) => ({ ...p, title });
    it("published is summed over batches; hidden is the LATEST batch's list (computed over the whole sheet)", () => {
        const s = run2(
            batch([{ kind: "ingested", url: U2, cdnUrl: "c2", holders: [A] }], { products: { updated: 1, replaced: [], published: [A] }, hiddenWithoutImage: [H(B, "Ash"), H(C, "Elm")] }),
            batch([{ kind: "ingested", url: U1, cdnUrl: "c1", holders: [B] }], { ...done, products: { updated: 1, replaced: [], published: [B] }, hiddenWithoutImage: [H(C, "Elm")] }),
        );
        expect(totalsOf(s)).toMatchObject({ productsPublished: 2, hidden: [{ productId: "pC", slug: "boen-elm", title: "Elm" }] });
    });
    it("an answer without the members (an older backend) keeps the totals: 0 published, hidden null", () => {
        expect(totalsOf(run2(batch([], done)))).toMatchObject({ productsPublished: 0, hidden: null });
    });
    const REPORT = {
        importSource: "glam:boen/pl",
        products: [
            { slug: "boen-oak", rowIndexes: [7, 3], options: [{ value: "120", imageLink: U1, rowIndexes: [7, 3] }] },
            { slug: "boen-elm", rowIndexes: [9], options: [{ value: "60", rowIndexes: [9] }] }, // an empty image cell
        ],
    };
    const FAILED_U1 = { kind: "failed", sources: [{ url: U1, reason: "HTTP 404, text/html, 10 bytes — error status" }] };

    it("hiddenProducts: title, address, the file rows from the same sheet's import report, and the cause", () => {
        const t = totalsOf(run2(batch([{ ...http404, url: U1, holders: [A] }], { ...done, hiddenWithoutImage: [H(A, "Oak"), H(C, "Elm")] })));
        expect(hiddenProducts(t, REPORT)).toEqual([
            { slug: "boen-oak", title: "Oak", rows: [3, 7], cause: FAILED_U1 },
            { slug: "boen-elm", title: "Elm", rows: [9], cause: { kind: "no-image-address" } }, // confirmed by the report
        ]);
        // without the report (a copy started on its own) or with another sheet's: no rows; Elm's cause is UNKNOWN, not "no address"
        expect(hiddenProducts(t, null).map((h) => [h.rows, h.cause.kind])).toEqual([[[], "failed"], [[], "unknown"]]);
        expect(hiddenProducts(t, { ...REPORT, importSource: "glam:alpod/x" }).map((h) => h.cause.kind)).toEqual(["failed", "unknown"]);
    });

    it("CIG-R3 same-sheet retry: \"Copiază imaginile\" again resumes the recorded outcomes — the failure seen before stays the cause", () => {
        let s = run2(batch([{ ...http404, url: U1, holders: [A] }], { ...done, hiddenWithoutImage: [H(A, "Oak")] }));
        s = imageCopyReducer(s, { type: "start", target: TARGET, resume: true });
        // the backend's repeat: the failed URL was removed, so it reports no source, only the hidden product
        s = imageCopyReducer(s, { type: "batch", response: batch([], { ...done, products: { updated: 0, replaced: [] }, hiddenWithoutImage: [H(A, "Oak")] }) });
        expect(hiddenProducts(totalsOf(s), REPORT)[0]).toEqual({ slug: "boen-oak", title: "Oak", rows: [3, 7], cause: FAILED_U1 });
        expect(hiddenProducts(totalsOf(s), null)[0].cause).toEqual(FAILED_U1);
    });

    it("CIG-R3 standalone copy (nothing recorded, no import report): the cause is unknown — never \"no image address\"", () => {
        const t = totalsOf(run2(batch([], { ...done, products: { updated: 0, replaced: [] }, hiddenWithoutImage: [H(A, "Oak")] })));
        const [h] = hiddenProducts(t, null);
        expect(h.cause).toEqual({ kind: "unknown" });
        expect(hiddenCauseText(h.cause)).toEqual([HIDDEN_CAUSE_UNKNOWN]);
        expect(HIDDEN_CAUSE_UNKNOWN).not.toMatch(/^Fără adresă/);
        // a report that shows an image address for it does not make it "no address" either
        expect(hiddenProducts({ ...t, importSource: "glam:boen/pl" }, REPORT)[0].cause).toEqual({ kind: "unknown" });
    });

    it("CIG-R3 the copy after an import starts fresh; a resumed copy answered for another sheet discards the recorded outcomes", () => {
        const before = run2(batch([{ ...http404, url: U1, holders: [A] }], { ...done, hiddenWithoutImage: [H(A, "Oak")] }));
        const fresh = imageCopyReducer(before, { type: "start", target: TARGET, resume: false });
        expect(totalsOf(fresh).sources).toEqual({});
        const resumed = imageCopyReducer(before, { type: "start", target: { producer: "ALPOD", sheet: "X" }, resume: true });
        const other = imageCopyReducer(resumed, { type: "batch", response: batch([], { ...done, importSource: "glam:alpod/x", hiddenWithoutImage: [H(A, "Oak")] }) });
        expect(totalsOf(other)).toMatchObject({ importSource: "glam:alpod/x", sources: {}, batches: 1 });
        expect(hiddenProducts(totalsOf(other), null)[0].cause).toEqual({ kind: "unknown" });
    });

    it("hiddenCauseText: one line per lost source; the confirmed empty cell in words", () => {
        expect(hiddenCauseText(FAILED_U1 as any)).toEqual([`${U1} — HTTP 404, text/html, 10 bytes — error status`]);
        expect(hiddenCauseText({ kind: "no-image-address" })).toEqual(["Fără adresă de imagine în fișier."]);
    });
});

describe("CAT-SLUG-UNIQUE-1 — the cross-sheet and within-file address lines (review-0 R2: true on every allocation path)", () => {
    // One entry per allocation path of the backend's `avoidTakenSlugs` (values as `glam-import-core.test.ts` produces them).
    const paths = {
        ordinary: { slug: "boen-coll-oak-pl-2", previousSlug: "boen-coll-oak", rowIndex: 2, heldBy: "glam:boen/pl 1" },
        suffixTaken: { slug: "boen-coll-oak-pl-2-2", previousSlug: "boen-coll-oak", rowIndex: 2, heldBy: null },
        emptySheet: { slug: "boen-coll-oak-2", previousSlug: "boen-coll-oak", rowIndex: 2, heldBy: null },
        withinFileThenSheet: { slug: "boen-coll-oak-2-pl-2", previousSlug: "boen-coll-oak-2", rowIndex: 3, heldBy: null },
    };
    const RULE = "adresa nouă este adresa ocupată, urmată de numele foii și/sau de un număr";

    it("absent or empty list → no line", () => {
        expect(crossSheetLine(undefined, true)).toBeNull();
        expect(crossSheetLine([], false)).toBeNull();
        expect(withinFileLine([])).toBeNull();
    });

    it("dry run: the cause, the rule true on every path, each old → new address with its row and holder, and that the import can differ", () => {
        expect(crossSheetLine([paths.ordinary, paths.emptySheet], true)).toBe(
            `Adrese de produs schimbate, pentru că sunt deja ale altor produse de pe site — ${RULE} (2): ` +
            "boen-coll-oak → boen-coll-oak-pl-2 (rândul 2; adresa este a unui produs din glam:boen/pl 1), " +
            "boen-coll-oak → boen-coll-oak-2 (rândul 2; adresa este a unui produs fără sursă de import). " +
            "La import lista poate diferi dacă produsele altor foi se schimbă între timp.");
    });

    it("every path: the line shows the exact new address and never promises what the address ends with", () => {
        for (const [name, entry] of Object.entries(paths)) {
            const line = crossSheetLine([entry], false)!;
            expect(line, name).toContain(`${entry.previousSlug} → ${entry.slug} (rândul ${entry.rowIndex};`);
            expect(line, name).toContain(RULE);
            expect(line, name).not.toMatch(/la sfârșit|at the end/);
            expect(line, name).not.toContain("poate diferi");
            // the rule the copy states holds for the entry: the occupied address, then more
            expect(entry.slug.startsWith(`${entry.previousSlug}-`), name).toBe(true);
        }
    });

    it("within-file line: the final address, no claim about where the number is (combined path: number, then the sheet)", () => {
        const line = withinFileLine([{ slug: paths.withinFileThenSheet.slug, rowIndex: 3 }, { slug: "boen-coll-ash-2", rowIndex: 5 }])!;
        expect(line).toBe("2 product address(es) got a number (-2, -3…) because products of this file had the same address; final address: " +
            "boen-coll-oak-2-pl-2 (row 3), boen-coll-ash-2 (row 5)");
        expect(line).not.toMatch(/at the end/);
    });
});
