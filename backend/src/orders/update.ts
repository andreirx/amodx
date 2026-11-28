import { APIGatewayProxyHandlerV2WithLambdaAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { orderRef } from "../lib/commerce-db.js";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { PaymentStatusSchema, paymentTransition, type PaymentStatus } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";
import { getDefaultTemplates, renderTemplate } from "../lib/order-email.js";
import { formatFromHeader } from "../lib/email-from.js";
import { commerceWriteFreezeRefusal } from "../lib/commerce-freeze.js";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL || "";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;
type Result = APIGatewayProxyStructuredResultV2;

const NOTE_MAX = 500;
const PAYMENT_STATUSES = PaymentStatusSchema.options;

const answer = (statusCode: number, body: unknown): Result => ({ statusCode, body: JSON.stringify(body) });

const _handler: Handler = async (event) => {
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

        // CMRC-2B (docs/slices/cmrc-2b.md): a frozen tenant's order is not changed. Before the split below, so both the
        // field patch and the payment transition (its read, update, audit event and mail) are refused.
        const frozen = commerceWriteFreezeRefusal(tenantId);
        if (frozen) return frozen;

        const body = JSON.parse(event.body);

        // PAY-1: the payment state is a transition, not a field. One concern per request.
        if (body.paymentStatus !== undefined) {
            return await changePaymentStatus({ tenantId, id, body, auth, ip: event.requestContext.http.sourceIp });
        }

        const now = new Date().toISOString();

        // Only update fields that are present in the body
        const allowedFields: Record<string, string> = {
            trackingNumber: "trackingNumber",
            internalNotes: "internalNotes",
            estimatedDeliveryDate: "estimatedDeliveryDate"
        };

        const expressionParts: string[] = ["#updatedAt = :updatedAt"];
        const expressionNames: Record<string, string> = { "#updatedAt": "updatedAt" };
        const expressionValues: Record<string, unknown> = { ":updatedAt": now };

        let hasUpdates = false;

        for (const [inputKey, dbKey] of Object.entries(allowedFields)) {
            if (body[inputKey] !== undefined) {
                hasUpdates = true;
                const placeholder = `:${inputKey}`;
                const nameToken = `#${inputKey}`;
                expressionParts.push(`${nameToken} = ${placeholder}`);
                expressionNames[nameToken] = dbKey;
                expressionValues[placeholder] = body[inputKey];
            }
        }

        if (!hasUpdates) {
            return { statusCode: 400, body: JSON.stringify({ error: "No valid fields to update" }) };
        }

        await db.send(new UpdateCommand({
            ...orderRef(tenantId, id),
            UpdateExpression: `SET ${expressionParts.join(", ")}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            ConditionExpression: "attribute_exists(SK)"
        }));

        return { statusCode: 200, body: JSON.stringify({ message: "Order updated" }) };
    } catch (e: any) {
        if (e.name === "ConditionalCheckFailedException") {
            return { statusCode: 404, body: JSON.stringify({ error: "Order not found" }) };
        }
        console.error("[orders/update] Error:", e);
        return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
    }
};

/**
 * PAY-1 (docs/slices/pay-1.md § 2 items 2-4): THE place where an order's payment state changes. Validates the
 * request, reads the order, applies `paymentTransition`, writes conditionally on the state read, then writes the
 * audit entry and (pending → paid only) sends the `paid` mail. A later consumer of "the order was paid" (invoice-1,
 * voucher-1) attaches after the audit entry. Throws only on an unexpected dependency failure (the handler answers 500).
 */
async function changePaymentStatus(args: {
    tenantId: string; id: string; body: Record<string, unknown>; auth: AuthorizerContext; ip: string;
}): Promise<Result> {
    const { tenantId, id, body, auth, ip } = args;

    const requested = PaymentStatusSchema.safeParse(body.paymentStatus);
    if (!requested.success) return answer(400, { error: `paymentStatus must be one of: ${PAYMENT_STATUSES.join(", ")}` });
    if (Object.keys(body).some((k) => k !== "paymentStatus" && k !== "note")) {
        return answer(400, { error: "Send the payment state alone: paymentStatus and an optional note." });
    }
    const note = body.note;
    if (note !== undefined && (typeof note !== "string" || note.length > NOTE_MAX)) {
        return answer(400, { error: `note must be text of at most ${NOTE_MAX} characters` });
    }
    const next = requested.data;

    const read = await db.send(new GetCommand(orderRef(tenantId, id)));
    const order = read.Item;
    if (!order) return answer(404, { error: "Order not found" });

    const stored: unknown = order.paymentStatus;
    const storedParse = PaymentStatusSchema.safeParse(stored);
    if (stored !== undefined && !storedParse.success) {
        // A value outside the enum, written by the field patch before PAY-1. The rule cannot decide from it.
        return answer(409, { error: `The stored payment state is not one of ${PAYMENT_STATUSES.join(", ")}.`, paymentStatus: stored });
    }
    const previousRead: PaymentStatus | undefined = storedParse.success ? storedParse.data : undefined;
    const previous: PaymentStatus = previousRead ?? "pending";

    const outcome = paymentTransition(previousRead, next);
    switch (outcome.kind) {
        case "refused": return answer(409, { error: outcome.reason, paymentStatus: previous });
        case "no-op": return answer(200, { message: "Payment status unchanged", paymentStatus: previous });
        case "apply": break;
    }

    const now = new Date().toISOString();
    // The time attribute of the state reached. `apply` happens only for pending → paid and paid → refunded.
    const timeAttribute = next === "paid" ? "paidAt" : "refundedAt";
    const names: Record<string, string> = { "#paymentStatus": "paymentStatus", "#updatedAt": "updatedAt", [`#${timeAttribute}`]: timeAttribute };
    const values: Record<string, unknown> = { ":next": next, ":now": now };
    let condition = "attribute_exists(SK) AND attribute_not_exists(#paymentStatus)";
    if (previousRead !== undefined) {
        condition = "attribute_exists(SK) AND #paymentStatus = :previous";
        values[":previous"] = previousRead;
    }

    try {
        await db.send(new UpdateCommand({
            ...orderRef(tenantId, id),
            UpdateExpression: `SET #paymentStatus = :next, #updatedAt = :now, #${timeAttribute} = :now`,
            ConditionExpression: condition,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        }));
    } catch (e: any) {
        if (e.name === "ConditionalCheckFailedException") {
            return answer(409, { error: "The payment state changed; read the order again." });
        }
        throw e;
    }

    await publishAudit({
        tenantId,
        actor: { id: auth.sub, email: auth.email },
        action: "UPDATE_ORDER_PAYMENT",
        target: { id, title: order.orderNumber },
        details: { previous, next, note },
        ip,
    });

    if (previous === "pending" && next === "paid") await sendPaidMail(tenantId, order, typeof note === "string" ? note : "");

    return answer(200, { message: "Payment status updated", paymentStatus: next });
}

/**
 * The `paid` mail: the tenant's `orderEmailConfig.templates.paid`, else the default of `getDefaultTemplates()`.
 * Sender, recipient rule, variables and failure handling are those of `orders/update-status.ts` (a mail failure is
 * logged and never fails the request). The variable block repeats update-status.ts's (recorded as debt in the
 * build record of docs/slices/pay-1.md).
 */
async function sendPaidMail(tenantId: string, order: Record<string, any>, note: string): Promise<void> {
    const customerEmail = order.customerEmail;
    if (!FROM_EMAIL || !customerEmail) return;
    try {
        const tenantRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));
        const tenantConfig = tenantRes.Item;
        const siteName = tenantConfig?.name || "Our Shop";
        const fromHeader = formatFromHeader(tenantConfig?.name, FROM_EMAIL);
        const adminEmail = tenantConfig?.integrations?.contactEmail;
        const processingEmail = tenantConfig?.integrations?.orderProcessingEmail;

        const customTemplates = tenantConfig?.orderEmailConfig?.templates || {};
        const template = customTemplates.paid || getDefaultTemplates().paid;

        const itemLines = (order.items || []).map((i: any) =>
            `  ${i.productTitle || i.title} x${i.quantity} — ${(parseFloat(i.totalPrice || 0)).toFixed(2)} ${order.currency || "USD"}`
        ).join("\n");
        const addressLine = order.shippingAddress
            ? `${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.county}`
            : "";

        const vars: Record<string, string> = {
            orderNumber: order.orderNumber || "",
            customerName: order.customerName || "",
            customerEmail,
            customerPhone: order.customerPhone || "",
            status: "paid",
            statusLabel: "Paid",
            trackingNumber: order.trackingNumber || "",
            items: itemLines,
            subtotal: (parseFloat(order.subtotal || 0)).toFixed(2),
            total: (parseFloat(order.total || 0)).toFixed(2),
            currency: order.currency || "USD",
            shippingCost: (parseFloat(order.shippingCost || 0)).toFixed(2),
            couponDiscount: order.couponDiscount ? `${parseFloat(order.couponDiscount).toFixed(2)}` : "",
            paymentMethod: order.paymentMethod === "bank_transfer" ? "Bank Transfer" : "Cash on Delivery",
            deliveryDate: order.requestedDeliveryDate || "",
            shippingAddress: addressLine,
            note,
            siteName,
        };

        const message = {
            Subject: { Data: `[${siteName}] ${renderTemplate(template.subject, vars)}` },
            Body: { Text: { Data: renderTemplate(template.body, vars) } },
        };

        if (template.sendToCustomer) {
            await ses.send(new SendEmailCommand({ Source: fromHeader, Destination: { ToAddresses: [customerEmail] }, Message: message }));
        }

        const internalRecipients = new Set<string>();
        if (template.sendToAdmin && adminEmail) internalRecipients.add(adminEmail);
        if (template.sendToProcessing && processingEmail) internalRecipients.add(processingEmail);
        if (internalRecipients.size > 0) {
            await ses.send(new SendEmailCommand({ Source: fromHeader, Destination: { ToAddresses: [...internalRecipients] }, Message: message }));
        }
    } catch (emailErr) {
        console.error("Failed to send payment notification email:", emailErr);
    }
}

export const handler = _handler;
