import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL || "";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const STATUS_LABELS: Record<string, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    processing: "Processing",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    refunded: "Refunded",
};

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const id = event.pathParameters?.id;

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: "Missing order ID" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        const body = JSON.parse(event.body);
        const { status, note, trackingNumber } = body;

        if (!status) return { statusCode: 400, body: JSON.stringify({ error: "Status is required" }) };

        const now = new Date().toISOString();

        // Fetch existing order to get current statusHistory
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `ORDER#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: JSON.stringify({ error: "Order not found" }) };

        const previousStatus = existing.Item.status;
        const statusHistory = existing.Item.statusHistory || [];
        statusHistory.push({ status, timestamp: now, note: note || null });

        // Build update expression
        let updateExpr = "SET #s = :status, statusHistory = :history, updatedAt = :now";
        const exprNames: Record<string, string> = { "#s": "status" };
        const exprValues: Record<string, any> = {
            ":status": status,
            ":history": statusHistory,
            ":now": now
        };

        if (trackingNumber) {
            updateExpr += ", trackingNumber = :tracking";
            exprValues[":tracking"] = trackingNumber;
        }

        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `ORDER#${id}` },
            UpdateExpression: updateExpr,
            ExpressionAttributeNames: exprNames,
            ExpressionAttributeValues: exprValues
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_ORDER_STATUS",
            target: { id, title: existing.Item.orderNumber },
            details: { previousStatus, newStatus: status, note },
            ip: event.requestContext.http.sourceIp
        });

        // --- Send status notification email to customer ---
        const customerEmail = existing.Item.customerEmail;
        if (FROM_EMAIL && customerEmail && status !== previousStatus) {
            try {
                const tenantRes = await db.send(new GetCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
                }));
                const siteName = tenantRes.Item?.name || "Our Shop";
                const orderNumber = existing.Item.orderNumber;
                const statusLabel = STATUS_LABELS[status] || status;

                let extraInfo = "";
                if (status === "shipped" && (trackingNumber || existing.Item.trackingNumber)) {
                    extraInfo = `\nTracking Number: ${trackingNumber || existing.Item.trackingNumber}`;
                }
                if (note) {
                    extraInfo += `\nNote: ${note}`;
                }

                const emailBody = [
                    `Hi ${existing.Item.customerName},`,
                    ``,
                    `Your order ${orderNumber} has been updated.`,
                    ``,
                    `New Status: ${statusLabel}`,
                    extraInfo ? extraInfo : null,
                    ``,
                    `Order Total: ${existing.Item.total?.toFixed?.(2) || existing.Item.total} ${existing.Item.currency || "RON"}`,
                    ``,
                    `Thank you for shopping with us!`,
                    ``,
                    `Best regards,`,
                    siteName,
                ].filter(line => line !== null).join("\n");

                await ses.send(new SendEmailCommand({
                    Source: FROM_EMAIL,
                    Destination: { ToAddresses: [customerEmail] },
                    Message: {
                        Subject: { Data: `[${siteName}] Order ${orderNumber} — ${statusLabel}` },
                        Body: { Text: { Data: emailBody } }
                    }
                }));
            } catch (emailErr) {
                console.error("Failed to send status notification email:", emailErr);
            }
        }

        return { statusCode: 200, body: JSON.stringify({ message: "Order status updated", status }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
