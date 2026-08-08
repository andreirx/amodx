import sharp from "sharp";
import { HEIC_REJECTION_REASON } from "./review-media.js";

/**
 * REV-2a — STEP 2 of the staged media pipeline: the BYTE-LEVEL SCREEN (D-REV-4).
 *
 * This is the ONLY step that touches the untrusted bytes. It DECODES the staged original with
 * sharp/libvips and re-encodes it to a single normalized JPEG. Two things happen at once:
 *   1. VERIFICATION — bytes that are not a decodable image of an allowlisted format are refused
 *      (a text file renamed `.jpg`, a truncated/garbage payload, an SVG, a GIF/TIFF). The
 *      STEP-1 declared-type gate (review-media.ts) is a CLAIM check; THIS is the bytes check.
 *   2. NORMALIZATION — AVIF/WebP/PNG/JPEG all collapse to one re-encoded JPEG, which strips
 *      trailing/ancillary data (EXIF, appended payloads, polyglot tails) that rode along in the
 *      original container. The public bucket only ever receives this derivative.
 *
 * HEIC/HEVC (REV2A-HEIC-RUNTIME, ratified; CYCLE-3): genuine HEIC is REJECTED with the exact
 * `HEIC_REJECTION_REASON` guidance as the OUTCOME of the FULL screen path — sharp is actually
 * asked to decode the bytes, this build's AV1-only libvips fails (no HEVC decoder), and only THEN
 * is the failure mapped to the specific export-as-JPEG message by inspecting the ISOBMFF `ftyp`
 * container brand (`classifyHeifBrand`). So the rejection is proven on a real decode attempt, not
 * a pre-decode classifier short-circuit. Should a deployed libvips ever gain an HEVC decoder, the
 * post-metadata compression check below still refuses the (now-decodable) HEIC as HEIC. AVIF (an
 * AV1-coded HEIF, distinct brand `avif`) DECODES and is ACCEPTED and normalized.
 *
 * HONEST SCOPE (recorded per the slice's ratified requirement): this is CONTROLLED-DECODE
 * NORMALIZATION, NOT antivirus. It defeats format-confusion and container-appended payloads and
 * removes the "valid-looking image carrying a tail" vector, but it is not a malware scanner and
 * does not reason about image *content* (NSFW/abuse — that is human moderation, D-REV-4 option A).
 * Full AV is later-hardening (plan-reviews-import § D-REV-4), not this slice.
 *
 * Kept in its own module (no S3, no DDB, pure bytes-in → bytes-out) so it is unit-testable
 * against real fixtures with NO AWS, and so `sharp` — a heavyweight native dep — is NOT bundled
 * into the promotion/moderation handler (review-media.ts / reviews/update.ts), which do only S3+DDB.
 * (The sharp-free `HEIC_REJECTION_REASON` import above does not pull sharp the other way.)
 */

/**
 * Decoded formats sharp may report that we accept. `sharp.metadata().format` returns the CONTAINER
 * family, so an AVIF reports `"heif"` (with `compression: "av1"`). By the time bytes reach the
 * decode step, genuine HEIC has ALREADY been refused by `classifyHeifBrand` (below) — so the only
 * `"heif"` that gets here is AVIF. The post-metadata compression check in `screenReviewImageBytes`
 * is a belt-and-suspenders that also refuses an HEVC-coded HEIF should a future deployed libvips
 * gain the HEVC decoder (ratified: HEIC stays rejected even if it becomes decodable).
 *
 * This is NARROWER than the platform's general ALLOWED_IMAGE_MIMES: gif/svg/tiff decode fine in
 * libvips but are deliberately excluded — imported review media is attacker-influenced third-party
 * content and gets the tighter ratified list (JPEG/JPG, PNG, WebP, AVIF).
 */
const ALLOWED_DECODED_FORMATS = new Set<string>(["jpeg", "png", "webp", "heif"]);

// ── HEIF container-brand classification (byte-level, no decode) ──────────────────────────────
// An ISOBMFF/HEIF file opens with an `ftyp` box: [size:4][ "ftyp":4 ][ major_brand:4 ][ minor:4 ]
// [ compatible_brands: 4·N ]. AVIF and HEIC share the container but are distinguished by brand:
// AVIF carries `avif`/`avis`; HEVC-coded HEIC carries `heic`/`heix`/`heim`/`heis`/`hevc`/`hevx`/
// the generic `heif`. `mif1`/`miaf` are shared and NON-discriminating (AVIF lists them too), so
// they are ignored. We key on the discriminating brands only.
const AVIF_BRANDS = new Set<string>(["avif", "avis"]);
const HEIC_BRANDS = new Set<string>(["heic", "heix", "heim", "heis", "hevc", "hevx", "heif"]);

/**
 * Classify a HEIF-family container by its `ftyp` brands. Returns `"avif"`, `"heic"`, or `null`
 * (not a recognizable HEIF `ftyp` — e.g. a JPEG/PNG/WebP/non-image, which the sharp path handles).
 * Pure byte inspection — never decodes, so it classifies an HEVC file this build cannot decode.
 */
export function classifyHeifBrand(bytes: Uint8Array): "avif" | "heic" | null {
    // Need at least ftyp header + major brand: size(4)+"ftyp"(4)+major(4) = 12 bytes.
    if (bytes.length < 12) return null;
    const ascii = (o: number): string => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (ascii(4) !== "ftyp") return null;

    // Box size is a big-endian u32 at offset 0; clamp to the buffer. Brands are major (offset 8)
    // plus 4-byte compatible brands from offset 16 to the box end.
    const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    const end = Math.min(boxSize > 0 ? boxSize : bytes.length, bytes.length);

    const brands: string[] = [ascii(8).toLowerCase()];
    for (let o = 16; o + 4 <= end; o += 4) brands.push(ascii(o).toLowerCase());

    // AVIF wins if present (an AV1 file we accept); otherwise any HEVC-family brand → HEIC.
    if (brands.some((b) => AVIF_BRANDS.has(b))) return "avif";
    if (brands.some((b) => HEIC_BRANDS.has(b))) return "heic";
    return null;
}

/** Quality of the normalized JPEG. 82 is a standard visually-lossless-enough re-encode. */
const NORMALIZED_JPEG_QUALITY = 82;

/** Expected failure is in the signature: a Result with per-failure reason context (no throw). */
export type ScreenResult =
    | { screened: true; normalized: Uint8Array; sourceFormat: string; width: number; height: number }
    | { screened: false; reason: string };

/**
 * Decode `bytes`, verify they are a decodable image of an allowlisted format, and re-encode to a
 * normalized JPEG. Never throws for bad input — a decode/format failure is returned as
 * `{ screened: false, reason }` so the caller (rev-2's importer) can mark the item rejected.
 */
export async function screenReviewImageBytes(bytes: Uint8Array): Promise<ScreenResult> {
    const input = Buffer.from(bytes);

    // STEP 2a — read the header via a REAL sharp decode attempt to learn the container format.
    // `failOn: "error"` makes libvips reject error-level corruption rather than paper over it; a
    // non-image (a text file renamed .jpg) throws "unsupported image format" here, and a genuine
    // HEVC-coded HEIC ALSO throws here (this build's libvips is AV1-only). The failure is mapped
    // to a specific reason AFTER the attempt (REV2A-HEIC-RUNTIME, CYCLE-3): if the raw bytes carry
    // an ISOBMFF HEIC container brand, emit the ratified export-as-JPEG guidance; otherwise the
    // generic not-a-decodable-image reason. This keeps HEIC on the FULL screen path.
    let format: string | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let compression: string | undefined;
    try {
        const meta = await sharp(input, { failOn: "error" }).metadata();
        format = meta.format;
        width = meta.width;
        height = meta.height;
        compression = meta.compression;
    } catch (e: unknown) {
        // A decode failure whose raw bytes are a HEIC container → the specific guidance message.
        if (classifyHeifBrand(bytes) === "heic") {
            return { screened: false, reason: HEIC_REJECTION_REASON };
        }
        const detail = e instanceof Error ? e.message : String(e);
        return { screened: false, reason: `bytes are not a decodable image (${detail})` };
    }

    // Belt-and-suspenders: an HEVC-coded HEIF whose brand slipped past the byte gate (or a future
    // libvips that decodes HEVC) is still rejected as HEIC. AVIF reports compression "av1".
    if (format === "heif" && compression && compression !== "av1") {
        return { screened: false, reason: HEIC_REJECTION_REASON };
    }

    if (!format || !ALLOWED_DECODED_FORMATS.has(format)) {
        // Catches SVG (script-bearing markup — reported as "svg"), GIF, TIFF, and anything else
        // decodable-but-not-allowlisted. SVG is refused here on BYTES even if it lied "image/jpeg"
        // through the STEP-1 declared gate.
        return {
            screened: false,
            reason: `decoded format "${format ?? "unknown"}" is not an allowlisted review-image format (JPEG, PNG, WebP, AVIF)`,
        };
    }

    // STEP 2b — the actual decode + re-encode. This is where truncated/garbage bytes that passed
    // the header read fail, and where the normalization (strip tails/EXIF, single JPEG) happens.
    // `.rotate()` with no args bakes in EXIF orientation before the metadata is dropped.
    try {
        const { data, info } = await sharp(input, { failOn: "error" })
            .rotate()
            .jpeg({ quality: NORMALIZED_JPEG_QUALITY })
            .toBuffer({ resolveWithObject: true });
        return {
            screened: true,
            normalized: new Uint8Array(data),
            sourceFormat: format,
            width: info.width ?? width ?? 0,
            height: info.height ?? height ?? 0,
        };
    } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        return { screened: false, reason: `image decode/re-encode failed (${detail})` };
    }
}
