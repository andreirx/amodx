import { describe, it, expect } from "vitest";
import {
    parseReviewSource,
    parseCsv,
    extractReviewInput,
    extractImageRefs,
    mimeFromExtension,
} from "../../src/import/reviews-parse.js";

/**
 * REV-2b — the PURE parser proof. No AWS, no image decoding: runs under `npm run test:unit` anywhere.
 * Pins the slice's parser DoD: CSV AND JSON fixtures incl. malformed rows → per-row rejection
 * with a reason (never abort-the-batch, never silently skip), and the ZIP-entry MIME inference.
 */

describe("parseCsv", () => {
    it("parses headers + quoted fields with embedded commas and escaped quotes", () => {
        const csv =
            'authorName,rating,content\n' +
            '"Doe, Jane",5,"Great, really ""loved"" it"\n' +
            "John,4,Nice\n";
        const rows = parseCsv(csv);
        expect(rows).toHaveLength(2);
        expect(rows[0].authorName).toBe("Doe, Jane");
        expect(rows[0].content).toBe('Great, really "loved" it');
        expect(rows[1].rating).toBe("4");
    });

    it("ignores trailing blank lines", () => {
        expect(parseCsv("authorName,rating\nA,5\n\n")).toHaveLength(1);
    });
});

describe("parseReviewSource", () => {
    it("accepts a bare JSON array", () => {
        const rows = parseReviewSource("json", JSON.stringify([{ author: "A", rating: 5 }]));
        expect(rows).toHaveLength(1);
    });

    it("accepts a { reviews: [...] } envelope", () => {
        const rows = parseReviewSource("json", JSON.stringify({ reviews: [{ author: "A", rating: 5 }] }));
        expect(rows).toHaveLength(1);
    });

    it("throws on unparseable JSON (whole-import 400, not a per-row reject)", () => {
        expect(() => parseReviewSource("json", "{not json")).toThrow(/invalid JSON/);
    });

    it("throws when JSON is not an array of objects", () => {
        expect(() => parseReviewSource("json", JSON.stringify({ foo: 1 }))).toThrow(/must be an array/);
    });
});

describe("extractReviewInput — per-row validation", () => {
    it("accepts a well-formed product review (productId → product scope input)", () => {
        const r = extractReviewInput({ authorName: "Jane", rating: "5", content: "Lovely", productId: "p1", images: "a.jpg;b.png" });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.productId).toBe("p1");
        expect(r.value.rating).toBe(5);
        expect(r.value.imageRefs).toEqual(["a.jpg", "b.png"]);
    });

    it("accepts a business review with NO productId (→ site scope input)", () => {
        const r = extractReviewInput({ name: "Ana", stars: "4", text: "Great place" });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.productId).toBeUndefined();
        expect(r.value.imageRefs).toEqual([]);
    });

    it("rejects a row missing authorName (reason, not throw)", () => {
        const r = extractReviewInput({ rating: "5", content: "x" });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reason).toMatch(/authorName/);
    });

    it("rejects a row with an out-of-range rating", () => {
        const r = extractReviewInput({ authorName: "A", rating: "9" });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reason).toMatch(/rating/);
    });

    it("rejects a non-numeric rating", () => {
        const r = extractReviewInput({ authorName: "A", rating: "five" });
        expect(r.ok).toBe(false);
    });

    it("parses a JSON images ARRAY", () => {
        const r = extractReviewInput({ authorName: "A", rating: 5, photos: ["x.jpg", "y.webp"] });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.imageRefs).toEqual(["x.jpg", "y.webp"]);
    });

    it("keeps a parseable date as ISO, drops an unparseable one", () => {
        const ok = extractReviewInput({ authorName: "A", rating: 5, date: "2024-01-02" });
        expect(ok.ok && ok.value.createdAt).toBe(new Date("2024-01-02").toISOString());
        const bad = extractReviewInput({ authorName: "A", rating: 5, date: "not-a-date" });
        expect(bad.ok && bad.value.createdAt).toBeUndefined();
    });

    it("rejects a row referencing MORE than MAX_REVIEW_IMAGES photos BEFORE staging (review-1 #2)", () => {
        // 13 references > the 12-image per-review maximum. Rejecting in the PURE parser means the
        // handler never stages any of the 13 — the domain rule is enforced before the effectful step,
        // not after (which would leave 13 private orphans + a lying "accepted" report). Otherwise
        // valid fields, so ONLY the count trips it.
        const refs = Array.from({ length: 13 }, (_, i) => `p${i}.jpg`).join(";");
        const r = extractReviewInput({ authorName: "A", rating: 5, images: refs });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reason).toMatch(/too many images/);
    });

    it("accepts a row referencing EXACTLY MAX_REVIEW_IMAGES photos (boundary)", () => {
        const refs = Array.from({ length: 12 }, (_, i) => `p${i}.jpg`).join(";");
        const r = extractReviewInput({ authorName: "A", rating: 5, images: refs });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.imageRefs).toHaveLength(12);
    });
});

describe("extractImageRefs — refs computable without validation (rejected-row disposition)", () => {
    it("splits a CSV image cell on ; and |, trimming and dropping empties", () => {
        expect(extractImageRefs({ images: "a.jpg; b.png |c.webp|" })).toEqual(["a.jpg", "b.png", "c.webp"]);
    });
    it("passes a JSON array through (photos alias)", () => {
        expect(extractImageRefs({ photos: ["x.jpg", " y.png "] })).toEqual(["x.jpg", "y.png"]);
    });
    it("returns [] when there is no image cell — even on an otherwise-malformed row", () => {
        // A row missing rating (which extractReviewInput would reject) still yields its refs here.
        expect(extractImageRefs({ authorName: "A" })).toEqual([]);
        expect(extractImageRefs({ rating: "not-a-number", images: "only.jpg" })).toEqual(["only.jpg"]);
    });
});

describe("mimeFromExtension", () => {
    it("maps allowlisted extensions", () => {
        expect(mimeFromExtension("photo.JPG")).toBe("image/jpeg");
        expect(mimeFromExtension("a/b/c.png")).toBe("image/png");
        expect(mimeFromExtension("x.webp")).toBe("image/webp");
        expect(mimeFromExtension("x.avif")).toBe("image/avif");
    });
    it("maps heic so the declared gate rejects it with guidance", () => {
        expect(mimeFromExtension("iphone.heic")).toBe("image/heic");
    });
    it("returns undefined for unknown / extension-less names", () => {
        expect(mimeFromExtension("noext")).toBeUndefined();
        expect(mimeFromExtension("doc.pdf")).toBeUndefined();
    });
});
