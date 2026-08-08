import type { ReviewImportReport } from "@amodx/shared";

/**
 * Pure presentation seam for the rev-2b bulk-import report (finding #5 — admin output-surface
 * coverage). The import dialog in `Reviews.tsx` renders EXCLUSIVELY from the view-model this
 * function returns, so a headless unit test of `buildImportReportView` (node env, no DOM) proves
 * the admin's UI contract: that the FULL disposition — accepted images with their staged private
 * `assetKey` + KB size AND every rejection (rows + images, including images on rejected rows) —
 * reaches the screen. The alternative (a jsdom + React-Testing-Library render test) needs three
 * extra devDeps and a DOM environment to assert the same strings; this seam is the smaller design.
 *
 * Abstraction ledger: `buildImportReportView` — a view-model builder. Concrete user: the
 * `Reviews.tsx` import dialog (single caller). Axis: none (not polymorphism); it exists purely as
 * the TEST SEAM the reviewer's coverage finding requires, unobtainable more simply than either a
 * DOM render test or duplicating the formatting inline-and-untested. Rejected simpler alternative:
 * inline `.filter/.map` in JSX (the prior shape) — untestable without a DOM runner.
 */

export interface AcceptedImageView {
    key: string;
    /** "Row N · entry" — the human-facing origin of this staged image. */
    rowLabel: string;
    /** The PRIVATE `/original` staging key the importer wrote (promoted to public only on approval). */
    assetKey: string;
    /** Staged byte size rounded to whole KB for display. */
    sizeKB: number;
}

export interface RejectedRowView {
    key: string;
    /** "Row N: reason". */
    label: string;
}

export interface RejectedImageView {
    key: string;
    /** "Row N · entry: reason". */
    label: string;
}

export interface ImportReportView {
    accepted: number;
    rejected: number;
    totalRows: number;
    batchId: string;
    rejectedRows: RejectedRowView[];
    acceptedImages: AcceptedImageView[];
    rejectedImages: RejectedImageView[];
    /** Whether to show the "pending in the list below" affordance (some row was imported). */
    someAccepted: boolean;
}

export function buildImportReportView(report: ReviewImportReport): ImportReportView {
    const rejectedRows: RejectedRowView[] = report.rows
        .filter((r) => r.status === "rejected")
        .map((r) => ({ key: `row-${r.index}`, label: `Row ${r.index + 1}: ${r.reason}` }));

    // The report's `images` array is a SUM TYPE discriminated on `status`. Split it into the two
    // display groups; every referenced image appears exactly once across the two (the backend
    // invariant — including images on rejected rows, which land here as rejections).
    const acceptedImages: AcceptedImageView[] = [];
    const rejectedImages: RejectedImageView[] = [];
    report.images.forEach((img, i) => {
        if (img.status === "accepted") {
            acceptedImages.push({
                key: `img-acc-${i}`,
                rowLabel: `Row ${img.rowIndex + 1} · ${img.entry}`,
                assetKey: img.assetKey,
                sizeKB: Math.round(img.size / 1024),
            });
        } else {
            rejectedImages.push({
                key: `img-rej-${i}`,
                label: `Row ${img.rowIndex + 1} · ${img.entry}: ${img.reason}`,
            });
        }
    });

    return {
        accepted: report.accepted,
        rejected: report.rejected,
        totalRows: report.totalRows,
        batchId: report.batchId,
        rejectedRows,
        acceptedImages,
        rejectedImages,
        someAccepted: report.accepted > 0,
    };
}
