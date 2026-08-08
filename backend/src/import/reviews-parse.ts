/**
 * REV-2b — the PURE half of the bulk review importer: parse a CSV/JSON review export into
 * normalized, validated per-row inputs. NO AWS, NO image decoding, NO S3/DDB — so it is unit-testable
 * against fixtures on any laptop, and so the malformed-row behaviour the slice mandates
 * ("per-row rejection with reason; never abort-the-batch; never silently skip") is proven in
 * isolation. The handler (reviews.ts) owns the effectful half: attestation, the ImportBatch
 * write-first, media staging (declared type-AND-size gate; no byte-screen — D-REV-4 SUPERSEDED),
 * and the DDB writes.
 *
 * This module is CORE business logic (mapping a third-party export shape onto the domain), so it
 * is not folded into the handler: the handler is only reachable with S3+DDB mocks, whereas the
 * DoD requires the parser + report-shape proven with no AWS at all. That test seam is the earned
 * reason for the split — not speculative reuse (there is one caller today, the handler).
 */

import { MAX_REVIEW_IMAGES } from "@amodx/shared";

/** One raw record straight from the source, before domain validation. Values are unknown-typed. */
export type RawReviewRow = Record<string, unknown>;

/** A row that parsed AND passed domain validation — ready for the handler to write. */
export interface ParsedReviewInput {
    authorName: string;
    rating: number;
    content: string;
    /** Present → the review is product-scoped; absent → business/site-scoped (rev-1 D-REV-5). */
    productId?: string;
    /** ISO string if the source carried a parseable date; else the handler stamps import time. */
    createdAt?: string;
    /** ZIP entry names this review's photos reference (may be empty). */
    imageRefs: string[];
}

/** Expected failure is in the signature: extraction returns a reason, never throws, per row. */
export type ExtractResult =
    | { ok: true; value: ParsedReviewInput }
    | { ok: false; reason: string };

// ── Column aliases ───────────────────────────────────────────────────────────────────────────
// Google Takeout / Facebook exports and hand-rolled CSVs disagree on header spelling; accept the
// common ones case-insensitively. The FIRST alias that is present (and non-empty) wins.
const AUTHOR_KEYS = ["authorname", "author", "name", "reviewer", "reviewer_name"];
const RATING_KEYS = ["rating", "stars", "score", "star_rating"];
const CONTENT_KEYS = ["content", "text", "review", "body", "comment", "review_text"];
const PRODUCT_KEYS = ["productid", "product_id", "product", "sku"];
const DATE_KEYS = ["date", "createdat", "created_at", "review_date", "time"];
const IMAGE_KEYS = ["images", "photos", "media", "image", "photo", "attachments"];

/** Case-insensitive, alias-aware lookup: returns the first non-empty value among the keys. */
function pick(row: RawReviewRow, keys: string[]): unknown {
    // Build a lowercased view once per lookup — rows are small; clarity over micro-optimisation.
    const lower = new Map<string, unknown>();
    for (const k of Object.keys(row)) lower.set(k.toLowerCase().trim(), row[k]);
    for (const k of keys) {
        const v = lower.get(k);
        if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return undefined;
}

/**
 * Split an image cell into ZIP entry names. CSV cannot use commas as the intra-cell separator
 * (they delimit columns), so the list separators are `;` and `|`; a JSON array is passed through.
 * Whitespace-trimmed, empties dropped.
 */
function splitImageRefs(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (Array.isArray(raw)) {
        return raw.map((x) => String(x).trim()).filter((x) => x.length > 0);
    }
    return String(raw)
        .split(/[;|]/)
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
}

/**
 * The ZIP entry names a raw row references — computable WITHOUT full domain validation, so it never
 * throws. Two callers: `extractReviewInput` (below, for an accepted row) and the handler's
 * REJECTED-row branch, which needs a malformed row's referenced images to still appear in the
 * import report as rejected dispositions ("every referenced image appears once, even when its row
 * is rejected" — rev-2b reviewer fix). A row that fails validation still had an images cell; this
 * surfaces it.
 */
export function extractImageRefs(row: RawReviewRow): string[] {
    return splitImageRefs(pick(row, IMAGE_KEYS));
}

/**
 * Validate + normalize one raw row into a `ParsedReviewInput`. This is where a malformed row
 * becomes a per-row rejection reason (the caller records it in the report and moves on) rather
 * than an exception that would abort the batch.
 *
 * Rules (the minimum the domain states — ReviewSchema then re-checks on write in the handler):
 *   • authorName: required, non-empty.
 *   • rating: required, a finite number in [1,5] (integers and halves both parse; out-of-range
 *     or non-numeric → reject — a fabricated rating is worse than a rejected row).
 *   • content: optional, defaults to "".
 *   • productId: optional → drives product-vs-site scope in the handler.
 *   • date: optional; only kept if it parses to a real instant, else the handler stamps now.
 */
export function extractReviewInput(row: RawReviewRow): ExtractResult {
    const authorRaw = pick(row, AUTHOR_KEYS);
    const authorName = authorRaw === undefined ? "" : String(authorRaw).trim();
    if (!authorName) {
        return { ok: false, reason: "missing required field: authorName" };
    }

    const ratingRaw = pick(row, RATING_KEYS);
    if (ratingRaw === undefined) {
        return { ok: false, reason: "missing required field: rating" };
    }
    const rating = Number(ratingRaw);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        return { ok: false, reason: `invalid rating "${String(ratingRaw)}" (expected a number 1–5)` };
    }

    const contentRaw = pick(row, CONTENT_KEYS);
    const content = contentRaw === undefined ? "" : String(contentRaw);

    const productRaw = pick(row, PRODUCT_KEYS);
    const productId = productRaw === undefined ? undefined : String(productRaw).trim() || undefined;

    let createdAt: string | undefined;
    const dateRaw = pick(row, DATE_KEYS);
    if (dateRaw !== undefined) {
        const ms = Date.parse(String(dateRaw));
        if (!Number.isNaN(ms)) createdAt = new Date(ms).toISOString();
    }

    const imageRefs = extractImageRefs(row);
    // Image-COUNT cap enforced HERE, in the pure parser, BEFORE the handler stages any bytes
    // (review-2b review-1 finding #2). ReviewSchema.parse() would also reject >MAX_REVIEW_IMAGES on
    // write — but that fires AFTER the handler has already staged each referenced object to the
    // private bucket, so a 13-reference row would stage 13 objects and emit 13 "accepted" image
    // dispositions, then drop the whole row via the write-time throw: staged orphans + a lying
    // report. Rejecting the row here means the handler's rejected-row branch surfaces every
    // reference ONCE as a rejected disposition, stages NOTHING, and writes no review — the malformed
    // -row + full-disposition contracts both hold. It is a per-row rejection (never a batch abort).
    if (imageRefs.length > MAX_REVIEW_IMAGES) {
        return {
            ok: false,
            reason: `too many images: ${imageRefs.length} references exceed the ${MAX_REVIEW_IMAGES}-image per-review maximum`,
        };
    }

    return { ok: true, value: { authorName, rating, content, productId, createdAt, imageRefs } };
}

// ── Source parsing (CSV / JSON) ──────────────────────────────────────────────────────────────

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (`""`), and embedded
 * commas/newlines inside quotes. The first non-empty record is the header row; each subsequent
 * record maps header→cell. Deliberately small — the review export is a flat table, not the
 * variant-heavy product CSV that justified woocommerce.ts's own parser.
 */
export function parseCsv(content: string): Record<string, string>[] {
    const records: string[][] = [];
    let field = "";
    let record: string[] = [];
    let inQuotes = false;

    const pushField = () => {
        record.push(field);
        field = "";
    };
    const pushRecord = () => {
        pushField();
        records.push(record);
        record = [];
    };

    for (let i = 0; i < content.length; i++) {
        const c = content[i];
        if (inQuotes) {
            if (c === '"') {
                if (content[i + 1] === '"') {
                    field += '"';
                    i++; // consume the escaped quote
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ",") {
            pushField();
        } else if (c === "\n") {
            pushRecord();
        } else if (c === "\r") {
            // swallow CR; a following LF triggers the record via the \n branch
        } else {
            field += c;
        }
    }
    // Flush a trailing field/record with no final newline.
    if (field.length > 0 || record.length > 0) pushRecord();

    // Drop fully-empty records (e.g. a trailing blank line).
    const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ""));
    if (nonEmpty.length === 0) return [];

    const headers = nonEmpty[0].map((h) => h.trim());
    return nonEmpty.slice(1).map((cells) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, idx) => {
            obj[h] = cells[idx] ?? "";
        });
        return obj;
    });
}

/**
 * Parse the import source into raw rows. Throws ONLY on input that is unusable as a whole
 * (unparseable JSON, JSON that is not an array of objects) — that is a 400 the handler returns
 * before writing anything. A per-ROW problem is NOT a throw here; it surfaces later as an
 * `extractReviewInput` rejection so one bad row never aborts the batch.
 */
export function parseReviewSource(format: "csv" | "json", content: string): RawReviewRow[] {
    if (format === "json") {
        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            throw new Error(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
        }
        // Accept either a bare array or a `{ reviews: [...] }` envelope (both appear in exports).
        const arr = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === "object" && Array.isArray((parsed as any).reviews)
              ? (parsed as any).reviews
              : null;
        if (!arr) {
            throw new Error("JSON must be an array of review objects (or { reviews: [...] })");
        }
        return arr.map((x: unknown) => (x && typeof x === "object" ? (x as RawReviewRow) : { __invalid: x }));
    }
    return parseCsv(content);
}

// ── ZIP entry MIME inference ──────────────────────────────────────────────────────────────────

const EXT_TO_MIME: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    avif: "image/avif",
    // heic/heif intentionally mapped so the DECLARED gate rejects them with the ratified
    // export-as-JPEG guidance rather than a bare "missing content-type".
    heic: "image/heic",
    heif: "image/heif",
};

/**
 * Infer a DECLARED content-type from a ZIP entry's file extension. A ZIP entry carries no MIME,
 * so the extension is the only declaration available — and it is exactly that, a CLAIM. There is
 * NO byte-screen verifying the claim against the bytes any more (D-REV-4 SUPERSEDED); the content
 * control on what reaches the public is the HUMAN MODERATION gate (every staged image is pending
 * until approved). Unknown/absent extension → undefined, which the staging gate rejects as
 * "missing declared content-type".
 */
export function mimeFromExtension(filename: string): string | undefined {
    const dot = filename.lastIndexOf(".");
    if (dot < 0) return undefined;
    return EXT_TO_MIME[filename.slice(dot + 1).toLowerCase()];
}
