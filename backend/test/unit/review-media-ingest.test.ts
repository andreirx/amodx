import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { stageAndScreenReviewImage } from "../../src/lib/review-media-ingest.js";
import { reviewOriginalKey, reviewNormalizedKey } from "../../src/lib/review-media.js";

/**
 * REV-2a — the STAGING PATH proof (CYCLE 2 gap a): `screenReviewImageBytes` is wired into the
 * staging path so an accepted image lands BOTH the raw `.../original` and the byte-screened
 * `.../normalized.jpg` (the object promotion later copies). Real bytes via sharp; S3 mocked.
 *
 * Pure/mocked: no AWS, no credentials — runs under `npm run test:unit`. It DOES exercise sharp
 * (the screen), because proving the normalized derivative is produced is the point.
 */

const s3mock = mockClient(S3Client);

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const isJpeg = (b: Uint8Array | undefined): boolean =>
    !!b && JPEG_MAGIC.every((x, i) => b[i] === x);

async function makePng(): Promise<Buffer> {
    return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
        .png()
        .toBuffer();
}

const base = {
    tenantId: "t1",
    batchId: "b1",
    imageId: "img1",
    privateBucket: "amodx-private-staging",
};

beforeEach(() => s3mock.reset());

describe("stageAndScreenReviewImage — stage → screen → write normalized", () => {
    it("writes the raw original AND the byte-screened normalized.jpg for a real image", async () => {
        s3mock.on(PutObjectCommand).resolves({});
        const bytes = await makePng();

        const r = await stageAndScreenReviewImage({ ...base, declaredContentType: "image/png", bytes, declaredSize: bytes.length });
        expect(r.ingested).toBe(true);
        if (!r.ingested) return;

        expect(r.originalKey).toBe(reviewOriginalKey("t1", "b1", "img1"));
        expect(r.normalizedKey).toBe(reviewNormalizedKey("t1", "b1", "img1"));

        const puts = s3mock.commandCalls(PutObjectCommand);
        expect(puts).toHaveLength(2);

        const byKey = new Map(puts.map((c) => [String(c.args[0].input.Key), c.args[0].input]));
        // original: raw as-arrived bytes, declared content-type.
        const original = byKey.get(reviewOriginalKey("t1", "b1", "img1"));
        expect(original?.ContentType).toBe("image/png");
        // normalized: a real JPEG derivative, image/jpeg.
        const normalized = byKey.get(reviewNormalizedKey("t1", "b1", "img1"));
        expect(normalized?.ContentType).toBe("image/jpeg");
        expect(isJpeg(normalized?.Body as Uint8Array)).toBe(true);
    });

    it("rejects a fake .jpg (text bytes) ON BYTES: original staged, NO normalized written", async () => {
        s3mock.on(PutObjectCommand).resolves({});
        const fake = Buffer.from("this text pretends to be a photo.jpg but carries no image bytes");

        const r = await stageAndScreenReviewImage({ ...base, declaredContentType: "image/jpeg", bytes: fake, declaredSize: fake.length });
        expect(r.ingested).toBe(false);
        if (r.ingested) return;
        expect(r.reason).toMatch(/decodable image|decode/i);

        // The declared gate passed (image/jpeg), so the raw original was staged (it will expire via
        // the lifecycle rule); the byte-screen refused it, so NO normalized.jpg exists to promote.
        const puts = s3mock.commandCalls(PutObjectCommand);
        expect(puts).toHaveLength(1);
        expect(String(puts[0].args[0].input.Key)).toBe(reviewOriginalKey("t1", "b1", "img1"));
    });

    it("rejects HEIC at the declared gate: writes NOTHING", async () => {
        s3mock.on(PutObjectCommand).resolves({});
        const r = await stageAndScreenReviewImage({
            ...base,
            declaredContentType: "image/heic",
            bytes: new Uint8Array([1, 2, 3, 4]),
            declaredSize: 4,
        });
        expect(r.ingested).toBe(false);
        expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });
});
