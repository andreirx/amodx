import { randomUUID } from "node:crypto";
import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

/**
 * MIGRATION-UPLOAD-1 (docs/slices/migration-upload-1.md) — a migration file (a WordPress export, a CSV) uploaded by the
 * admin Migration screen. It is stored in the PRIVATE bucket, never at a public address: a WordPress export holds
 * commenters' names and mail addresses (VISION guarantee 2).
 *
 * Key form: `migration/<tenantId>/<uuid>-<safe file name>`. The prefix `migration/` is one contract with the lifecycle
 * rule `ExpireMigrationUploads` (infra/lib/uploads.ts) and with the `migration/*` grants (infra/lib/api-catalog.ts).
 *
 * Abstraction ledger: this module — the key form, the ownership rule, the read and the delete of a migration upload.
 * Concrete users: `import/upload-url.ts` (builds the key), `import/wordpress.ts` and `import/media.ts` (check, read,
 * delete). Axis: none (it removes the duplication of non-trivial logic in the two importers). Rejected alternative:
 * the check, the read and its error mapping written twice, inline in each importer.
 */

export const MIGRATION_PREFIX = "migration/";

/**
 * The largest migration file the importers accept: a MEASURED ALLOWANCE, not an enforced memory bound. Each batch
 * request reads the WHOLE object into one string and parses all of it (wordpress.ts `parseWXR`, media.ts
 * `parseMediaXml`), so the cost per request depends on the file's size AND its structure. Measured peak RSS of one
 * request (object bytes + string + parse), both parsers, eight shapes (record § Size limit; review-0 F-MU1-MEMORY-BOUND):
 * page-shaped exports 4.7–5.6 × the file, attachment-shaped (a media export) 11.4–13.2 ×, dense tiny elements (no
 * importable item) up to 49 ×. Directly at 40 MB: dense `<x>1</x>` 1981 MB, attachments ≤ 555 MB, pages 294 MB.
 * Batch work of the media importer: 50 parallel image copies of ≤ 10 MiB payload each (lib/image-upload.ts
 * MAX_IMAGE_BYTES) = 500 MiB of payload; `readCapped` keeps the chunks while `Buffer.concat` allocates the joined body,
 * so up to 2 × that = 1000 MiB of payload-derived buffers, plus SDK/TLS allocations that are NOT measured. Against
 * 3008 MB (ImportFunc / MediaImportFunc): a real media export 555 MB + ≤ 1000 MiB + unmeasured; the worst parse shape
 * 1981 MB with no image work (it holds no attachment). NOT covered: a file that mixes the worst parse shape with a full
 * batch of images (≈ 1981 MB + 1000 MiB + unmeasured can exceed 3008 MB).
 * What the length check enforces is the input size only. Two failures stay possible, with different outcomes:
 * - the function ends during the parse (out of memory): the parse precedes every write of both importers, so that
 *   batch writes nothing and the upload stays until the importer's next complete run or the lifecycle rule;
 * - API Gateway answers the browser after 30 s (the dense shape parsed in 10.7–15.3 s here at 40 MB) but the function
 *   keeps running (timeout 15 min): it can still write the batch and, on the last batch, delete the upload. The
 *   outcome is then UNCONFIRMED for the operator, not "nothing written".
 */
export const MIGRATION_UPLOAD_MAX_BYTES = 40 * 1024 * 1024;

/** The limit as the messages state it, and what to do about a larger export. */
export const SIZE_ADVICE = `${MIGRATION_UPLOAD_MAX_BYTES} bytes (${MIGRATION_UPLOAD_MAX_BYTES / 1048576} MB). Split the export: WordPress Tools → Export can export one content type or a date range.`

/** The content types an upload link is issued for: XML (a WordPress export) and CSV. */
export const MIGRATION_CONTENT_TYPES: readonly string[] = ["application/xml", "text/xml", "text/csv"];

/** The file name as it may stand in a key: letters, digits, `.`, `_` and `-`; any other run of characters → `_`. */
export function safeFileName(name: string): string {
    const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 100);
    return safe.length > 0 ? safe : "upload";
}

export function migrationUploadKey(tenantId: string, fileName: string): string {
    return `${MIGRATION_PREFIX}${tenantId}/${randomUUID()}-${safeFileName(fileName)}`;
}

// After `migration/<tenantId>/`: exactly the `<uuid>-<safe name>` part migrationUploadKey builds — no `/`, so a key of
// a tenant whose id starts with this tenant's id and a `/` can never pass.
const OWN_KEY_REST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]+$/;

export type MigrationRead =
    | { kind: "read"; content: string }
    | { kind: "refused"; statusCode: 400 | 403 | 404 | 413 | 500; error: string };

export const UPLOAD_AGAIN =
    "The uploaded file is no longer stored (it is deleted after the import and expires one day after the upload). Upload the file again.";

/**
 * The key rule, checked before any S3 call. The caller is already authorised for `tenantId` (requireRole). A key under
 * `migration/<tenantId>/` in the form migrationUploadKey builds → owned. Any other key under `migration/` (another
 * tenant's upload, or not in that form) → 403, as the check before this slice answered a key outside the tenant
 * prefix. A key outside `migration/` — the old public form `<tenantId>/<assetId>-…` included — → 400.
 */
export function checkMigrationKey(tenantId: string, s3Key: unknown): { owned: true } | Extract<MigrationRead, { kind: "refused" }> {
    if (typeof s3Key !== "string") return { kind: "refused", statusCode: 400, error: "s3Key must be a string" };
    const own = `${MIGRATION_PREFIX}${tenantId}/`;
    if (s3Key.startsWith(own) && OWN_KEY_REST.test(s3Key.slice(own.length))) return { owned: true };
    if (s3Key.startsWith(MIGRATION_PREFIX)) {
        return { kind: "refused", statusCode: 403, error: "s3Key is not owned by this tenant" };
    }
    return { kind: "refused", statusCode: 400, error: "s3Key is not a migration upload: get the upload link from POST /import/upload-url" };
}

/**
 * The key rule, then the object read whole. A missing object → 404 UPLOAD_AGAIN. S3 answers a missing key with
 * `NoSuchKey` only to a caller that may list the bucket; the importers may not (least privilege), so S3 answers them
 * `AccessDenied` (403) for a missing key — after the key rule passed and with `s3:GetObject` on `migration/*`, that is
 * a missing object too (the grant is pinned by infra/test/amodx-stack.test.ts). An object over the limit → 413, not
 * read.
 */
export async function readMigrationUpload(s3: S3Client, bucket: string | undefined, tenantId: string, s3Key: unknown): Promise<MigrationRead> {
    const check = checkMigrationKey(tenantId, s3Key);
    if ("kind" in check) return check;
    if (!bucket) return { kind: "refused", statusCode: 500, error: "PRIVATE_BUCKET is not configured" };
    let object;
    try {
        object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key as string }));
    } catch (e: any) {
        const status = e?.$metadata?.httpStatusCode;
        if (e?.name === "NoSuchKey" || e?.name === "AccessDenied" || status === 404 || status === 403) {
            console.warn(`Migration upload not readable (${e?.name ?? status}): ${s3Key}`);
            return { kind: "refused", statusCode: 404, error: UPLOAD_AGAIN };
        }
        throw e;
    }
    if (typeof object.ContentLength === "number" && object.ContentLength > MIGRATION_UPLOAD_MAX_BYTES) {
        (object.Body as { destroy?: () => void } | undefined)?.destroy?.();
        return { kind: "refused", statusCode: 413, error: `The file is ${object.ContentLength} bytes; the limit is ${SIZE_ADVICE}` };
    }
    return { kind: "read", content: await object.Body!.transformToString("utf-8") };
}

/**
 * Deletes the upload after the last batch of an import. A failure is logged, not answered: the import is done, and the
 * lifecycle rule removes the object within a day (the backstop).
 */
export async function deleteMigrationUpload(s3: S3Client, bucket: string, s3Key: string): Promise<void> {
    try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3Key }));
    } catch (e: any) {
        console.warn(`Migration upload not deleted (the lifecycle rule removes it): ${s3Key}: ${e?.message ?? e}`);
    }
}
