import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { getDefaultTemplates, renderTemplate, STATUS_LABELS } from "../lib/order-email.js";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL || "";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const VALID_STATUSES = ["placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled"];

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

        // Validate against allowed statuses
        if (!VALID_STATUSES.includes(status)) {
            return { statusCode: 400, body: JSON.stringify({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}` }) };
        }

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

        // --- Send status notification email via templates ---
        const customerEmail = existing.Item.customerEmail;
        if (FROM_EMAIL && customerEmail && status !== previousStatus) {
            try {
                const tenantRes = await db.send(new GetCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
                }));
                const tenantConfig = tenantRes.Item;
                const siteName = tenantConfig?.name || "Our Shop";
                const adminEmail = tenantConfig?.integrations?.contactEmail;
                const processingEmail = tenantConfig?.integrations?.orderProcessingEmail;

                // Get template for this status (custom or default)
                const defaults = getDefaultTemplates();
                const customTemplates = tenantConfig?.orderEmailConfig?.templates || {};
                const template = customTemplates[status] || defaults[status];

                if (template) {
                    const order = existing.Item;
                    const itemLines = (order.items || []).map((i: any) =>
                        `  ${i.productTitle || i.title} x${i.quantity} — ${(parseFloat(i.totalPrice || 0)).toFixed(2)} ${order.currency || "USD"}`
                    ).join("\n");

                    const addressLine = order.shippingAddress
                        ? `${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.county}`
                        : "";

                    const vars: Record<string, string> = {
                        orderNumber: order.orderNumber || "",
                        customerName: order.customerName || "",
                        customerEmail: customerEmail,
                        customerPhone: order.customerPhone || "",
                        status,
                        statusLabel: STATUS_LABELS[status] || status,
                        trackingNumber: trackingNumber || order.trackingNumber || "",
                        items: itemLines,
                        subtotal: (parseFloat(order.subtotal || 0)).toFixed(2),
                        total: (parseFloat(order.total || 0)).toFixed(2),
                        currency: order.currency || "USD",
                        shippingCost: (parseFloat(order.shippingCost || 0)).toFixed(2),
                        couponDiscount: order.couponDiscount ? `${parseFloat(order.couponDiscount).toFixed(2)}` : "",
                        paymentMethod: order.paymentMethod === "bank_transfer" ? "Bank Transfer" : "Cash on Delivery",
                        deliveryDate: order.requestedDeliveryDate || "",
                        shippingAddress: addressLine,
                        note: note || "",
                        siteName,
                    };

                    const renderedSubject = renderTemplate(template.subject, vars);
                    const renderedBody = renderTemplate(template.body, vars);

                    // Send to customer
                    if (template.sendToCustomer) {
                        await ses.send(new SendEmailCommand({
                            Source: FROM_EMAIL,
                            Destination: { ToAddresses: [customerEmail] },
                            Message: {
                                Subject: { Data: `[${siteName}] ${renderedSubject}` },
                                Body: { Text: { Data: renderedBody } }
                            }
                        }));
                    }

                    // Send to admin/processing if configured
                    const internalRecipients = new Set<string>();
                    if (template.sendToAdmin && adminEmail) internalRecipients.add(adminEmail);
                    if (template.sendToProcessing && processingEmail) internalRecipients.add(processingEmail);

                    if (internalRecipients.size > 0) {
                        await ses.send(new SendEmailCommand({
                            Source: FROM_EMAIL,
                            Destination: { ToAddresses: [...internalRecipients] },
                            Message: {
                                Subject: { Data: `[${siteName}] ${renderedSubject}` },
                                Body: { Text: { Data: renderedBody } }
                            }
                        }));
                    }
                }
            } catch (emailErr) {
                console.error("Failed to send status notification email:", emailErr);
            }
        }

        return { statusCode: 200, body: JSON.stringify({ message: "Order status updated", status }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
