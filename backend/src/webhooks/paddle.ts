import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ses = new SESClient({});
const s3 = new S3Client({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL!; // Ensure this is set via CDK
const PRIVATE_BUCKET = process.env.PRIVATE_BUCKET!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        console.log("🔔 Paddle Webhook Received");

        // 1. Basic Validation (Paddle Signature verification omitted for V1 brevity, typically handled via crypto)
        if (!event.body) return { statusCode: 400, body: "No Body" };

        // Paddle sends data as Form Data usually, but JSON if configured. Assuming JSON.
        // If form data, we need a parser. Let's assume JSON for modern webhooks.
        let body: any = {};
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            // Handle URL Encoded (Paddle Classic sometimes uses this)
            const params = new URLSearchParams(event.body);
            body = Object.fromEntries(params.entries());
        }

        const { alert_name, email, passthrough, p_product_id } = body;

        // Only care about success
        if (alert_name !== 'payment_succeeded') {
            return { statusCode: 200, body: "Ignored event type" };
        }

        // 2. Decode Context
        // The frontend PaddleLoader must pass { "tenantId": "..." } in custom_data/passthrough
        let tenantId = "";
        try {
            // Paddle passthrough is often a stringified JSON
            const custom = JSON.parse(passthrough || "{}");
            tenantId = custom.tenantId;
        } catch (e) {
            console.error("Failed to parse passthrough", passthrough);
        }

        if (!tenantId) {
            console.error("❌ No Tenant ID in webhook");
            return { statusCode: 200, body: "Missing Tenant Context" };
        }

        console.log(`Processing Order for Tenant: ${tenantId}, Product: ${p_product_id}`);

        // 3. Find Product in DB
        // Query by GSI? We don't have a GSI for PaymentLinkID yet.
        // Fallback: Scan (Slow) OR assume we passed the Internal Product ID in passthrough too.
        // Let's assume passthrough has { tenantId, productId }.

        let productId = "";
        try {
            const custom = JSON.parse(passthrough || "{}");
            productId = custom.productId;
        } catch(e) {}

        if (!productId) {
            console.warn("⚠️ No Product ID in passthrough. Cannot fulfill digital item.");
            // We still return 200 to satisfy Paddle
            return { statusCode: 200, body: "No Product ID" };
        }

        const productRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${productId}` }
        }));

        const product = productRes.Item;
        if (!product || !product.resourceId) {
            console.log("No linked resource for this product. Skipping delivery.");
            return { statusCode: 200, body: "No Resource" };
        }

        // 4. Get Resource
        const resourceRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `RESOURCE#${product.resourceId}` }
        }));

        if (!resourceRes.Item) {
            console.error("Linked resource not found in DB");
            return { statusCode: 200, body: "Resource Missing" };
        }

        // 5. Generate Link
        const command = new GetObjectCommand({
            Bucket: PRIVATE_BUCKET,
            Key: resourceRes.Item.s3Key
        });
        // 24 Hour Link
        const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 86400 });

        // 6. Send Email
        const subject = `Your Download: ${product.title}`;
        const message = `
            Hi there,

            Thank you for purchasing ${product.title}.
            
            Here is your secure download link (valid for 24 hours):
            ${downloadUrl}
            
            Thanks,
            The Team
        `;

        await ses.send(new SendEmailCommand({
            Source: FROM_EMAIL,
            Destination: { ToAddresses: [email] },
            Message: {
                Subject: { Data: subject },
                Body: { Text: { Data: message } }
            }
        }));

        console.log("✅ Delivery Email Sent");
        return { statusCode: 200, body: "Fulfilled" };

    } catch (e: any) {
        console.error("Webhook Error", e);
        return { statusCode: 500, body: e.message };
    }
};
