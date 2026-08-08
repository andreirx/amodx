import { describe, it, expect } from "vitest";
import type { ReviewImportReport } from "@amodx/shared";
import { buildImportReportView } from "./importReportView";

/**
 * REV-2b finding #5 — admin output-surface coverage. Proves the import dialog's UI contract at its
 * pure seam: the FULL disposition reaches the screen — accepted images carry their staged private
 * `assetKey` + KB size, every rejection (rows AND images) is surfaced, and an image on a REJECTED
 * row still appears exactly once (the backend "every referenced image appears once" invariant, as
 * the operator sees it). `Reviews.tsx` renders verbatim from this view-model, so this node-env test
 * (no DOM) covers what renders. `npm run test:unit` in the admin workspace.
 */

// A report exercising every branch: one accepted row with an accepted image, one rejected row
// whose referenced image is surfaced as a rejected disposition, plus a standalone rejected image
// (missing from the ZIP) on the accepted row.
const REPORT: ReviewImportReport = {
    batchId: "batch-123",
    format: "csv",
    totalRows: 2,
    accepted: 1,
    rejected: 1,
    rows: [
        { index: 0, status: "accepted", reviewId: "r1", scope: "site", imagesAccepted: 1 },
        { index: 1, status: "rejected", reason: "rating out of range" },
    ],
    images: [
        // accepted: 2048 bytes -> 2 KB, private staging key
        { status: "accepted", rowIndex: 0, entry: "a.jpg", assetKey: "review-staging/t1/b/original", size: 2048 },
        // rejected image on the ACCEPTED row (missing from ZIP)
        { status: "rejected", rowIndex: 0, entry: "missing.jpg", reason: "not found in media ZIP" },
        // rejected image belonging to the REJECTED row — must still be surfaced once
        { status: "rejected", rowIndex: 1, entry: "b.jpg", reason: "row rejected: rating out of range" },
    ],
};

describe("buildImportReportView", () => {
    it("carries the summary + batchId to the view", () => {
        const v = buildImportReportView(REPORT);
        expect(v.accepted).toBe(1);
        expect(v.rejected).toBe(1);
        expect(v.totalRows).toBe(2);
        expect(v.batchId).toBe("batch-123");
        expect(v.someAccepted).toBe(true);
    });

    it("renders accepted images as first-class entries with assetKey and KB size", () => {
        const v = buildImportReportView(REPORT);
        expect(v.acceptedImages).toHaveLength(1);
        const img = v.acceptedImages[0];
        expect(img.assetKey).toBe("review-staging/t1/b/original");
        expect(img.sizeKB).toBe(2); // 2048 / 1024
        expect(img.rowLabel).toBe("Row 1 · a.jpg");
    });

    it("surfaces every rejected image once, including images on a rejected row", () => {
        const v = buildImportReportView(REPORT);
        expect(v.rejectedImages).toHaveLength(2);
        const labels = v.rejectedImages.map((r) => r.label);
        expect(labels).toContain("Row 1 · missing.jpg: not found in media ZIP");
        expect(labels).toContain("Row 2 · b.jpg: row rejected: rating out of range");
    });

    it("lists rejected rows with 1-based numbering and reason", () => {
        const v = buildImportReportView(REPORT);
        expect(v.rejectedRows).toHaveLength(1);
        expect(v.rejectedRows[0].label).toBe("Row 2: rating out of range");
    });

    it("keys every list entry uniquely (stable React keys)", () => {
        const v = buildImportReportView(REPORT);
        const keys = [
            ...v.rejectedRows.map((r) => r.key),
            ...v.acceptedImages.map((r) => r.key),
            ...v.rejectedImages.map((r) => r.key),
        ];
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("suppresses the 'pending in list' affordance when nothing was accepted", () => {
        const v = buildImportReportView({ ...REPORT, accepted: 0 });
        expect(v.someAccepted).toBe(false);
    });
});
