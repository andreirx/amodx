import { describe, it, expect } from "vitest";
import {
    glamFormReducer, canCheck, confirmInput, brandsOf, INITIAL_GLAM_FORM, type GlamFormState, type GlamFormEvent,
    imageCopyReducer, imageProblems, imageCounts, IDLE_IMAGE_COPY, type ImageCopyState,
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
const started = () => imageCopyReducer(IDLE_IMAGE_COPY, { type: "start", target: TARGET });
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
        expect(imageCopyReducer(running, { type: "start", target: { producer: "X", sheet: "Y" } })).toBe(running);
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
