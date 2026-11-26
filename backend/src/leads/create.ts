import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { LeadSchema } from "@amodx/shared";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { verifyRecaptcha, getRecaptchaErrorMessage, resolveRecaptchaConfig } from "../lib/recaptcha.js";
import { verifyTenantFromOrigin } from "../lib/tenant-verify.js";
import { productIdsReferencingResource } from "../lib/resource-products.js";


const s3 = new S3Client({});
const PRIVATE_BUCKET = process.env.PRIVATE_BUCKET; // Ensure this env var is passed in CDK!

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: "Missing Tenant Context" };

        // Verify tenant ID — trusted if RENDERER (proxy derived tenant from host), otherwise check Origin
        const callerRole = (event.requestContext as any)?.authorizer?.lambda?.role as string | undefined;
        const tenantVerified = await verifyTenantFromOrigin(event.headers as Record<string, string | undefined>, tenantId, callerRole);
        if (!tenantVerified) {
            console.warn("Tenant verification failed", { tenantId, origin: event.headers['origin'] });
            return { statusCode: 403, body: JSON.stringify({ error: "Invalid request origin" }) };
        }

        const body = JSON.parse(event.body || "{}");

        // reCAPTCHA verification (deployment-level mandatory, tenant can override keys/threshold)
        const tenantRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));
        const tenantConfig = tenantRes.Item;

        const recaptchaConfig = resolveRecaptchaConfig(tenantConfig?.recaptcha);
        if (recaptchaConfig) {
            const recaptchaToken = body.recaptchaToken;

            if (!recaptchaToken) {
                return { statusCode: 400, body: JSON.stringify({ error: "CAPTCHA verification required" }) };
            }

            const result = await verifyRecaptcha(
                recaptchaToken,
                recaptchaConfig.secretKey,
                event.requestContext?.http?.sourceIp
            );

            if (!result.success || result.score < recaptchaConfig.threshold) {
                console.warn(`reCAPTCHA BLOCKED [${recaptchaConfig.source}]: score=${result.score}, ip=${event.requestContext?.http?.sourceIp}, form=leads`);
                return { statusCode: 403, body: JSON.stringify({ error: getRecaptchaErrorMessage(result) }) };
            }

            console.log(`reCAPTCHA passed [${recaptchaConfig.source}]: score=${result.score}, action=${result.action}`);
        }

        // 1. Save Lead
        const input = LeadSchema.omit({ id: true, tenantId: true, createdAt: true, status: true }).parse(body);
        const id = crypto.randomUUID();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `LEAD#${input.email}`,
                id,
                tenantId,
                ...input,
                status: "New",
                createdAt: new Date().toISOString(),
                Type: "Lead"
            }
        }));

        // 2. Handle Gated Resource (The "Exchange")
        let downloadUrl = undefined;
        // DIGITAL-FILE-GUARD-1: only a non-empty string is a resource id. The same string is the RESOURCE# key and
        // the value the product lookup compares, so the two reads cannot disagree on its type.
        const resourceId = typeof body.resourceId === "string" ? body.resourceId : undefined;

        if (resourceId && PRIVATE_BUCKET) {
            // A. Find the resource meta
            const resourceRes = await db.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: `RESOURCE#${resourceId}` }
            }));

            if (resourceRes.Item) {
                // DIGITAL-FILE-GUARD-1 (docs/slices/digital-file-guard-1.md): a resource that any product of this
                // tenant references (any status) is a product's file, not a lead magnet. The lead stays stored; the
                // answer has no link. A failed lookup throws to the catch below (500, no link): fail closed. The id
                // in the log line is the one of a stored resource (the Get above matched it), never free text.
                const productIds = await productIdsReferencingResource(tenantId, resourceId);
                if (productIds.length > 0) {
                    console.warn(`[leads/create] product file refused as lead magnet: tenant=${tenantId} resource=${resourceId}`);
                } else {
                    // B. Generate Link
                    const command = new GetObjectCommand({
                        Bucket: PRIVATE_BUCKET,
                        Key: resourceRes.Item.s3Key
                    });
                    // URL valid for 15 minutes
                    downloadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
                }
            }
        }

        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "Subscribed",
                downloadUrl: downloadUrl // Frontend checks this
            })
        };

    } catch (e: any) {
        console.error("[leads/create] Error:", e);
        return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
    }
};

export const handler = _handler;
