import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { MIGRATION_CONTENT_TYPES, MIGRATION_UPLOAD_MAX_BYTES, SIZE_ADVICE, migrationUploadKey } from "./migration-upload.js";

/**
 * MIGRATION-UPLOAD-1 — `POST /import/upload-url` `{ filename, contentType, size }` → `{ uploadUrl, s3Key }`: a PUT link,
 * valid 300 s, for one migration file in the PRIVATE bucket at `migration/<tenantId>/<uuid>-<safe name>`. The admin
 * Migration screen PUTs the file there and passes `s3Key` to `POST /import/wordpress` and `POST /import/media`.
 *
 * Who: the callers the import routes admit (`requireRole(auth, ["TENANT_ADMIN", "EDITOR"], x-tenant-id)`, and a
 * GLOBAL_ADMIN); no service scope, so a service key is refused (policy.ts). It writes nothing: no record, no audit —
 * the link alone stores nothing until the PUT, and the import that reads the file audits as before.
 *
 * Size: the declared size is checked here; the PUT link does not bind the length (as `/assets`, docs/TECH-DEBT.md), so
 * the importers check the stored object's length again before they read it (migration-upload.ts).
 *
 * Signing (review-0 F-MU1-SIGNING): the link's contract is set here, not by SDK defaults. The browser PUTs a body the
 * signer never sees, so (1) no checksum may be signed — from @aws-sdk/client-s3 3.729 the default
 * (`requestChecksumCalculation: "WHEN_SUPPORTED"`) signs `x-amz-checksum-crc32` of the EMPTY body into the URL and S3
 * refuses the real file — and (2) `content-type` is a signed header, so a PUT with another type is refused. Both are
 * checked against the real presigner in migration-upload-1-signing.test.ts.
 */
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });
const SIGNED_HEADERS = new Set(["content-type"]);
const PRIVATE_BUCKET = process.env.PRIVATE_BUCKET;

const bad = (error: string) => ({ statusCode: 400, body: JSON.stringify({ error }) });

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) => {
    try {
        const tenantId = event.headers["x-tenant-id"];
        if (!tenantId) return bad("Missing x-tenant-id header");

        const auth = event.requestContext.authorizer.lambda;
        try {
            requireRole(auth, ["TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        let body: any;
        try {
            body = JSON.parse(event.body || "{}");
        } catch {
            return bad("The body is not JSON");
        }
        const { filename, contentType, size } = body ?? {};
        if (typeof filename !== "string" || filename.length === 0) return bad("filename is required");
        if (typeof contentType !== "string" || !MIGRATION_CONTENT_TYPES.includes(contentType)) {
            return bad(`File type "${contentType}" is not allowed for a migration file. Allowed: ${MIGRATION_CONTENT_TYPES.join(", ")}.`);
        }
        if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return bad("File size is required.");
        if (size > MIGRATION_UPLOAD_MAX_BYTES) {
            return bad(`The file is ${size} bytes; the limit for a migration file is ${SIZE_ADVICE}`);
        }
        if (!PRIVATE_BUCKET) return { statusCode: 500, body: JSON.stringify({ error: "PRIVATE_BUCKET is not configured" }) };

        const s3Key = migrationUploadKey(tenantId, filename);
        const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: PRIVATE_BUCKET, Key: s3Key, ContentType: contentType }), { expiresIn: 300, signableHeaders: SIGNED_HEADERS });
        return { statusCode: 200, body: JSON.stringify({ uploadUrl, s3Key }) };
    } catch (e: any) {
        console.error("Migration upload link error:", e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
