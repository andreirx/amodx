import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

const s3 = new S3Client({});
const PRIVATE_BUCKET = process.env.PRIVATE_BUCKET!;

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * Check if a user has purchased a specific product.
 * Returns true if:
 * - User has an order containing this productId
 * - Or user is TENANT_ADMIN/GLOBAL_ADMIN
 */
async function hasUserPurchasedProduct(
    tenantId: string,
    userEmail: string,
    productId: string,
    userRole: string
): Promise<boolean> {
    // Admins always have access
    if (userRole === "TENANT_ADMIN" || userRole === "GLOBAL_ADMIN") {
        return true;
    }

    if (!userEmail) {
        return false;
    }

    // Query orders for this customer
    const emailLower = userEmail.toLowerCase();
    const ordersResult = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
            ":pk": `TENANT#${tenantId}`,
            ":sk": `CUSTORDER#${emailLower}#`,
        },
        ProjectionExpression: "items",
    }));

    // Check if any order contains this product
    for (const order of (ordersResult.Items || [])) {
        const items = order.items || [];
        if (items.some((item: any) => item.productId === productId)) {
            return true;
        }
    }

    return false;
}

/**
 * Find the product(s) that reference this resource.
 */
async function getProductsForResource(tenantId: string, resourceId: string): Promise<string[]> {
    // Query all products for this tenant and filter by resourceId
    // This is not optimal for large catalogs, but resources are typically
    // linked to single products
    const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        FilterExpression: "resourceId = :resourceId",
        ExpressionAttributeValues: {
            ":pk": `TENANT#${tenantId}`,
            ":sk": "PRODUCT#",
            ":resourceId": resourceId,
        },
        ProjectionExpression: "id",
    }));

    return (result.Items || []).map((item: any) => item.id);
}

// POST /resources/upload-url (Admin Only)
export const uploadHandler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const { filename, contentType, size } = JSON.parse(event.body);

        const resourceId = crypto.randomUUID();
        const key = `${tenantId}/${resourceId}-${filename}`;

        // Generate PUT URL
        const command = new PutObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key, ContentType: contentType });
        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

        // Record in DB
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `RESOURCE#${resourceId}`,
                id: resourceId,
                fileName: filename,
                s3Key: key,
                uploadedBy: auth.sub,
                createdAt: new Date().toISOString(),
                Type: 'Resource'
            }
        }));

        return { statusCode: 200, body: JSON.stringify({ uploadUrl, resourceId }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

// GET /resources/{id}/download-url (Protected by Purchase Verification)
export const downloadHandler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const resourceId = event.pathParameters?.id;
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId || !resourceId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing tenant or resource ID" }) };
        }

        // Get Resource Metadata
        const record = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `RESOURCE#${resourceId}` }
        }));

        if (!record.Item) {
            return { statusCode: 404, body: JSON.stringify({ error: "Resource not found" }) };
        }

        // SECURITY: Verify user has purchased the product linked to this resource
        const userEmail = auth.email || "";
        const userRole = auth.role || "";

        // Admins bypass purchase check
        if (userRole !== "TENANT_ADMIN" && userRole !== "GLOBAL_ADMIN") {
            // Find which product(s) this resource belongs to
            const productIds = await getProductsForResource(tenantId, resourceId);

            if (productIds.length === 0) {
                // Resource not linked to any product - require admin access
                console.warn(`Resource ${resourceId} not linked to any product, denying access`);
                return { statusCode: 403, body: JSON.stringify({ error: "This resource is not available for download" }) };
            }

            // Check if user has purchased ANY of these products
            let hasAccess = false;
            for (const productId of productIds) {
                if (await hasUserPurchasedProduct(tenantId, userEmail, productId, userRole)) {
                    hasAccess = true;
                    break;
                }
            }

            if (!hasAccess) {
                console.warn(`User ${userEmail} denied access to resource ${resourceId} - no purchase found`);
                return { statusCode: 403, body: JSON.stringify({ error: "Purchase required to download this resource" }) };
            }
        }

        // Generate GET URL (Short expiry)
        const command = new GetObjectCommand({ Bucket: PRIVATE_BUCKET, Key: record.Item.s3Key });
        const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

        return { statusCode: 200, body: JSON.stringify({ downloadUrl }) };
    } catch (e: any) {
        console.error("Download handler error:", e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
