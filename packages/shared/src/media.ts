/**
 * Shared media classification and upload policy.
 *
 * Single source of truth for:
 * - MIME type allowlists (image, video)
 * - Media kind classification from asset metadata
 * - Upload size limits
 * - Picker compatibility checks
 *
 * Consumed by: backend (upload validation), admin (MediaPicker, MediaLibrary),
 * plugin editors (upload pre-check). Must remain framework-agnostic.
 */

// ─── MIME Allowlists ───────────────────────────────────────

export const ALLOWED_IMAGE_MIMES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/avif",
    "image/heic",
    "image/heif",
]);

export const ALLOWED_VIDEO_MIMES = new Set([
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime",   // .mov
]);

export const ALLOWED_UPLOAD_MIMES = new Set([
    ...ALLOWED_IMAGE_MIMES,
    ...ALLOWED_VIDEO_MIMES,
]);

// ─── Size Limits ───────────────────────────────────────────

/** Maximum upload size in bytes per media kind. */
export const MAX_UPLOAD_BYTES = {
    image: 10 * 1024 * 1024,    // 10 MB
    video: 50 * 1024 * 1024,    // 50 MB
} as const;

// ─── Media Kind Classification ─────────────────────────────

export type MediaKind = "image" | "video" | "other";

/**
 * Classify an asset as image, video, or other.
 * Normalizes across `fileType` and `contentType` fields that may
 * coexist in asset records due to legacy/migration differences.
 */
export function classifyMedia(asset: { fileType?: string; contentType?: string }): MediaKind {
    const mime = (asset.fileType || asset.contentType || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    return "other";
}

/**
 * Get the resolved MIME string from an asset record,
 * normalizing across fileType/contentType fields.
 */
export function getAssetMime(asset: { fileType?: string; contentType?: string }): string {
    return (asset.fileType || asset.contentType || "").toLowerCase();
}

/**
 * Check whether an asset matches a picker's media type filter.
 */
export function matchesMediaFilter(asset: { fileType?: string; contentType?: string }, filter: "image" | "video" | "all"): boolean {
    if (filter === "all") return true;
    return classifyMedia(asset) === filter;
}

// ─── Upload Validation ─────────────────────────────────────

export interface UploadValidationResult {
    valid: boolean;
    error?: string;
    mediaKind?: MediaKind;
}

/**
 * Validate a file before upload. Checks MIME allowlist and size limit.
 * Usable on both client (pre-check) and server (enforcement).
 */
export function validateUpload(contentType: string, sizeBytes: number): UploadValidationResult {
    const mime = contentType.toLowerCase();

    if (!ALLOWED_UPLOAD_MIMES.has(mime)) {
        return { valid: false, error: `File type "${contentType}" is not allowed. Accepted: images (JPEG, PNG, GIF, WebP, SVG, AVIF) and videos (MP4, WebM, OGG, MOV).` };
    }

    const kind: MediaKind = mime.startsWith("image/") ? "image" : "video";
    const maxBytes = MAX_UPLOAD_BYTES[kind];

    if (sizeBytes > maxBytes) {
        const maxMB = maxBytes / (1024 * 1024);
        const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
        return { valid: false, error: `File is ${sizeMB} MB. Maximum for ${kind}s is ${maxMB} MB.` };
    }

    return { valid: true, mediaKind: kind };
}
