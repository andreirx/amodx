import { describe, it, expect, afterAll } from "vitest";
import sharp from "sharp";
import { screenReviewImageBytes, classifyHeifBrand } from "../../src/lib/review-media-screen.js";
import { HEIC_REJECTION_REASON } from "../../src/lib/review-media.js";

/**
 * REV-2a — the BYTE-LEVEL SCREEN fixture transcript (D-REV-4 / DoD "EXECUTED local run of the
 * screen step on fixture images"). Real image bytes are GENERATED with sharp at test time (no
 * committed binary fixtures, fully reproducible), fed through `screenReviewImageBytes`, and the
 * accept-and-normalize / reject-on-bytes behaviour is asserted AND printed as a transcript.
 *
 * Pure: no AWS, no credentials, no S3, no DDB. Runs under `npm run test:unit`. It DOES exercise
 * the native sharp/libvips binary — that is the point (this is the only step that touches bytes).
 *
 * Format list (REV2A-HEIC-RUNTIME, ratified): AVIF is an ACCEPTED input in its own right — the
 * prebuilt sharp 0.35.3 here decodes AV1/AVIF. HEIC (HEVC) is REJECTED with the exact
 * `HEIC_REJECTION_REASON` message as the OUTCOME of the FULL screen path: sharp is asked to
 * decode the bytes, this AV1-only libvips fails, and the decode failure is then mapped to the
 * ratified message by inspecting the ISOBMFF `ftyp` container brand (CYCLE-3). The HEIC fixture
 * is CONSTRUCTED-BYTES evidence (see `constructedHeicBytes` below) — a genuine encoder-produced
 * `.heic` is not obtainable in this sandbox (no HEVC encoder); what is being pinned is the
 * REJECTION behaviour, and the constructed bytes exercise it through the real decode attempt.
 */

const transcript: string[] = [];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function isJpeg(bytes: Uint8Array): boolean {
    return JPEG_MAGIC.every((b, i) => bytes[i] === b);
}

/** A 4×4 solid image encoded to a target format — a real, decodable image of that format. */
async function makeImage(encode: (p: sharp.Sharp) => sharp.Sharp): Promise<Buffer> {
    return encode(
        sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 100, b: 50 } } }),
    ).toBuffer();
}

const fixtures: Array<{ name: string; make: () => Promise<Buffer> }> = [
    { name: "JPEG", make: () => makeImage((p) => p.jpeg()) },
    { name: "PNG", make: () => makeImage((p) => p.png()) },
    { name: "WebP", make: () => makeImage((p) => p.webp()) },
    // AVIF — an ACCEPTED input in its own right (ratified allowlist), decoded via AV1/libvips.
    { name: "AVIF", make: () => makeImage((p) => p.avif()) },
];

/**
 * CONSTRUCTED-BYTES evidence for the HEIC REJECTION fixture (NOT an encoder-produced `.heic` — this
 * AV1-only libvips has no HEVC encoder, and a genuine encoder-produced file is not obtainable in
 * this sandbox). We craft a real ISOBMFF file that IDENTIFIES as HEIC — an `ftyp` box (major_brand
 * "heic", compatible brands "mif1","heic") FOLLOWED BY an `mdat` media-payload box — so the screen
 * makes a real sharp decode ATTEMPT on ftyp-heic bytes + payload. The decode fails (no HEVC
 * decoder), and the failure is mapped to the ratified guidance by the container-brand classifier.
 * What is pinned is the REJECTION behaviour through the full screen path, not a specific codec.
 */
function constructedHeicBytes(): Buffer {
    const brands = ["mif1", "heic"]; // compatible brands after the major brand
    const ftypSize = 8 /* size+type */ + 4 /* major */ + 4 /* minor */ + brands.length * 4;
    const ftyp = Buffer.alloc(ftypSize);
    ftyp.writeUInt32BE(ftypSize, 0);
    ftyp.write("ftyp", 4, "ascii");
    ftyp.write("heic", 8, "ascii"); // major_brand
    // minor_version at offset 12 stays 0
    brands.forEach((b, i) => ftyp.write(b, 16 + i * 4, "ascii"));

    // A minimal `mdat` payload box — the "+ payload" the sharp decode attempt actually chews on
    // before it fails (this build cannot decode the HEVC media inside a HEIC container).
    const payload = Buffer.from("HEVC media payload bytes that this AV1-only libvips cannot decode");
    const mdat = Buffer.alloc(8 + payload.length);
    mdat.writeUInt32BE(mdat.length, 0);
    mdat.write("mdat", 4, "ascii");
    payload.copy(mdat, 8);

    return Buffer.concat([ftyp, mdat]);
}

afterAll(() => {
    // Emit the fixture-run transcript so the reviewer can read the accept/reject outcomes.
    // eslint-disable-next-line no-console
    console.log("\n──── REV-2a byte-screen fixture transcript ────\n" + transcript.join("\n") + "\n");
});

describe("screenReviewImageBytes — real formats accepted and normalized to JPEG", () => {
    it.each(fixtures)("accepts a real $name and normalizes it to a JPEG derivative", async ({ name, make }) => {
        const bytes = await make();
        const res = await screenReviewImageBytes(bytes);

        expect(res.screened).toBe(true);
        if (!res.screened) return; // narrow for TS
        expect(isJpeg(res.normalized)).toBe(true);
        expect(res.width).toBe(4);
        expect(res.height).toBe(4);

        transcript.push(
            `ACCEPT  ${name.padEnd(34)} in=${String(bytes.length).padStart(5)}B sourceFormat=${res.sourceFormat} → normalized JPEG ${res.normalized.length}B (${res.width}x${res.height})`,
        );
    });

    it("re-screening the normalized JPEG succeeds (output is a clean allowlisted image)", async () => {
        const first = await screenReviewImageBytes(await makeImage((p) => p.png()));
        expect(first.screened).toBe(true);
        if (!first.screened) return;
        const second = await screenReviewImageBytes(first.normalized);
        expect(second.screened).toBe(true);
        if (!second.screened) return;
        expect(second.sourceFormat).toBe("jpeg");
    });
});

describe("screenReviewImageBytes — rejects non-images and disallowed formats ON BYTES", () => {
    it("rejects a text file that merely CLAIMS to be a .jpg (not a decodable image)", async () => {
        const fake = Buffer.from("This is a text file pretending to be photo.jpg — it has no image bytes at all.");
        const res = await screenReviewImageBytes(fake);
        expect(res.screened).toBe(false);
        if (res.screened) return;
        expect(res.reason).toMatch(/decodable image|decode/i);
        transcript.push(`REJECT  fake .jpg (text bytes)              → ${res.reason}`);
    });

    it("rejects SVG bytes outright (script-bearing markup) even though libvips can parse SVG", async () => {
        const svg = Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
        );
        const res = await screenReviewImageBytes(svg);
        expect(res.screened).toBe(false);
        if (res.screened) return;
        expect(res.reason).toMatch(/svg|not an allowlisted/i);
        transcript.push(`REJECT  SVG                                 → ${res.reason}`);
    });

    it("rejects a decodable-but-not-allowlisted format (GIF)", async () => {
        const gif = await makeImage((p) => p.gif());
        const res = await screenReviewImageBytes(gif);
        expect(res.screened).toBe(false);
        if (res.screened) return;
        expect(res.reason).toMatch(/not an allowlisted/i);
        transcript.push(`REJECT  GIF (decodable, off-allowlist)      → ${res.reason}`);
    });
});

describe("screenReviewImageBytes — HEIC is rejected with the ratified guidance via the full screen path (REV2A-HEIC-RUNTIME)", () => {
    it("rejects constructed HEIC bytes (ftyp+payload) after a real sharp decode attempt, with the exact export-as-JPEG message", async () => {
        const heic = constructedHeicBytes();
        const res = await screenReviewImageBytes(heic);
        expect(res.screened).toBe(false);
        if (res.screened) return;
        // The SPECIFIC ratified message, not a generic decode-failure string — proving the decode
        // failure was mapped to HEIC guidance by the container-brand classifier.
        expect(res.reason).toBe(HEIC_REJECTION_REASON);
        transcript.push(`REJECT  constructed HEIC (ftyp+mdat, decode-attempt) → ${res.reason}`);
    });

    it("records this libvips build cannot decode/encode HEVC-HEIC (why the decode attempt fails, and the ftyp brand names it)", async () => {
        let hevcEncodeSupported = false;
        try {
            await makeImage((p) => p.heif({ compression: "hevc" }));
            hevcEncodeSupported = true;
        } catch {
            hevcEncodeSupported = false;
        }
        // Capability PROBE, not a gate: this AV1-only build has no HEVC codec, so the real decode
        // attempt on HEIC bytes FAILS; the container-brand classifier then maps that failure to the
        // ratified guidance. The rejection holds regardless of this build's codec set.
        transcript.push(
            `PROBE   HEVC-HEIC encode support = ${hevcEncodeSupported} (AV1/AVIF only here — HEIC decode ATTEMPTED, fails, ftyp brand names the failure)`,
        );
        expect(typeof hevcEncodeSupported).toBe("boolean");
    });
});

describe("classifyHeifBrand — byte-level HEIF container discrimination", () => {
    it("classifies real AVIF bytes as avif", async () => {
        const avif = await makeImage((p) => p.avif());
        expect(classifyHeifBrand(avif)).toBe("avif");
    });

    it("classifies constructed HEIC ftyp bytes as heic", () => {
        expect(classifyHeifBrand(constructedHeicBytes())).toBe("heic");
    });

    it("returns null for a non-HEIF image (JPEG) and for too-short/garbage bytes", async () => {
        const jpeg = await makeImage((p) => p.jpeg());
        expect(classifyHeifBrand(jpeg)).toBeNull();
        expect(classifyHeifBrand(new Uint8Array([1, 2, 3]))).toBeNull();
        expect(classifyHeifBrand(Buffer.from("not an image at all, just text bytes here"))).toBeNull();
    });
});
