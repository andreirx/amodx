import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL || "";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const body = JSON.parse(event.body);
        const {
            items, customerEmail, customerName, customerPhone,
            shippingAddress, paymentMethod, requestedDeliveryDate,
            couponCode
        } = body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: "Items are required" }) };
        }
        if (!customerEmail || !customerName) {
            return { statusCode: 400, body: JSON.stringify({ error: "Customer email and name are required" }) };
        }

        const now = new Date().toISOString();
        const orderId = crypto.randomUUID();

        // --- Server-side price validation ---
        const validatedItems = [];
        let subtotal = 0;

        for (const item of items) {
            const productResult = await db.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${item.productId}` }
            }));

            if (!productResult.Item) {
                return { statusCode: 400, body: JSON.stringify({ error: `Product not found: ${item.productId}` }) };
            }

            const product = productResult.Item;
            let unitPrice = product.salePrice || product.price;

            // Calculate personalization costs
            let personalizationCost = 0;
            const validatedPersonalizations = [];

            if (item.personalizations && Array.isArray(item.personalizations)) {
                for (const pers of item.personalizations) {
                    const productPers = product.personalizations?.find(
                        (p: any) => p.id === pers.id || p.label === pers.label
                    );
                    const addedCost = productPers?.addedCost || 0;
                    personalizationCost += addedCost;
                    validatedPersonalizations.push({
                        ...pers,
                        addedCost
                    });
                }
            }

            const finalUnitPrice = unitPrice + personalizationCost;
            const totalPrice = finalUnitPrice * item.quantity;
            subtotal += totalPrice;

            validatedItems.push({
                productId: item.productId,
                productTitle: product.title,
                quantity: item.quantity,
                unitPrice: finalUnitPrice,
                totalPrice,
                selectedVariant: item.selectedVariant || null,
                personalizations: validatedPersonalizations,
                imageLink: product.imageLink || null
            });
        }

        // --- Fetch delivery config for shipping cost ---
        let shippingCost = 0;
        const deliveryResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `DELIVERYCONFIG#default` }
        }));

        if (deliveryResult.Item) {
            const config = deliveryResult.Item;
            if (config.freeDeliveryThreshold && subtotal >= config.freeDeliveryThreshold) {
                shippingCost = 0;
            } else {
                shippingCost = config.flatShippingCost || 0;
            }
        }

        // --- Server-side coupon validation ---
        let couponDiscount = 0;
        let couponId: string | null = null;
        let couponType: string | null = null;
        let couponValue: number | null = null;
        let validatedCouponCode: string | null = null;

        if (couponCode && typeof couponCode === "string") {
            const upperCode = couponCode.toUpperCase();

            // 1. Lookup COUPONCODE#
            const codeLookup = await db.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: `COUPONCODE#${upperCode}` }
            }));

            if (codeLookup.Item) {
                couponId = codeLookup.Item.couponId as string;

                // 2. Fetch full COUPON#
                const couponResult = await db.send(new GetCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: `TENANT#${tenantId}`, SK: `COUPON#${couponId}` }
                }));

                if (couponResult.Item) {
                    const coupon = couponResult.Item;

                    // Validate: active, date range, usage limit, minimum order
                    const isActive = coupon.status === "active";
                    const inDateRange = (!coupon.validFrom || now >= coupon.validFrom) &&
                                        (!coupon.validUntil || now <= coupon.validUntil);
                    const usageLimit = coupon.usageLimit as number || 0;
                    const usageCount = coupon.usageCount as number || 0;
                    const withinUsage = usageLimit === 0 || usageCount < usageLimit;
                    const minimumOrderAmount = parseFloat(coupon.minimumOrderAmount as string) || 0;
                    const meetsMinimum = subtotal >= minimumOrderAmount;

                    if (isActive && inDateRange && withinUsage && meetsMinimum) {
                        couponType = coupon.type as string;
                        couponValue = parseFloat(coupon.value as string);
                        validatedCouponCode = upperCode;

                        if (couponType === "percentage") {
                            couponDiscount = (couponValue / 100) * subtotal;
                            const maximumDiscount = coupon.maximumDiscount ? parseFloat(coupon.maximumDiscount as string) : 0;
                            if (maximumDiscount > 0 && couponDiscount > maximumDiscount) {
                                couponDiscount = maximumDiscount;
                            }
                        } else if (couponType === "fixed_amount") {
                            couponDiscount = couponValue;
                        }

                        // Never discount more than subtotal
                        if (couponDiscount > subtotal) couponDiscount = subtotal;
                        couponDiscount = Math.round(couponDiscount * 100) / 100;
                    } else {
                        // Coupon invalid — silently ignore (client already validated)
                        couponId = null;
                    }
                } else {
                    couponId = null;
                }
            }
        }

        const total = subtotal + shippingCost - couponDiscount;
        const currency = "RON";

        // --- Generate order number via atomic counter ---
        const counterResult = await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `COUNTER#ORDER` },
            UpdateExpression: "SET currentValue = if_not_exists(currentValue, :zero) + :one",
            ExpressionAttributeValues: {
                ":zero": 0,
                ":one": 1
            },
            ReturnValues: "UPDATED_NEW"
        }));

        const counterValue = counterResult.Attributes?.currentValue || 1;
        const orderNumber = `PPB-${String(counterValue).padStart(4, "0")}`;

        // --- Build transaction items ---
        const transactItems: any[] = [
            // 1. Full order item
            {
                Put: {
                    TableName: TABLE_NAME,
                    Item: {
                        PK: `TENANT#${tenantId}`,
                        SK: `ORDER#${orderId}`,
                        id: orderId,
                        tenantId,
                        orderNumber,
                        items: validatedItems,
                        customerEmail: customerEmail.toLowerCase(),
                        customerName,
                        customerPhone: customerPhone || null,
                        shippingAddress: shippingAddress || null,
                        paymentMethod: paymentMethod || null,
                        requestedDeliveryDate: requestedDeliveryDate || null,
                        subtotal,
                        shippingCost,
                        couponCode: validatedCouponCode,
                        couponId,
                        couponDiscount,
                        total,
                        currency,
                        status: "pending",
                        paymentStatus: "unpaid",
                        statusHistory: [{ status: "pending", timestamp: now, note: "Order placed" }],
                        createdAt: now,
                        updatedAt: now,
                        Type: "Order"
                    }
                }
            },
            // 2. Customer order reference (lightweight)
            {
                Put: {
                    TableName: TABLE_NAME,
                    Item: {
                        PK: `TENANT#${tenantId}`,
                        SK: `CUSTORDER#${customerEmail.toLowerCase()}#${orderId}`,
                        orderNumber,
                        total,
                        status: "pending",
                        createdAt: now,
                        Type: "CustomerOrder"
                    }
                }
            },
            // 3. Customer upsert
            {
                Update: {
                    TableName: TABLE_NAME,
                    Key: {
                        PK: `TENANT#${tenantId}`,
                        SK: `CUSTOMER#${customerEmail.toLowerCase()}`
                    },
                    UpdateExpression: "SET #n = :name, phone = :phone, orderCount = if_not_exists(orderCount, :zero) + :one, totalSpent = if_not_exists(totalSpent, :zero) + :total, lastOrderDate = :now, defaultAddress = :address, #t = :type",
                    ExpressionAttributeNames: {
                        "#n": "name",
                        "#t": "Type"
                    },
                    ExpressionAttributeValues: {
                        ":name": customerName,
                        ":phone": customerPhone || null,
                        ":zero": 0,
                        ":one": 1,
                        ":total": total,
                        ":now": now,
                        ":address": shippingAddress || null,
                        ":type": "Customer"
                    }
                }
            }
        ];

        // 4. Increment coupon usage if applied
        if (couponId) {
            transactItems.push({
                Update: {
                    TableName: TABLE_NAME,
                    Key: { PK: `TENANT#${tenantId}`, SK: `COUPON#${couponId}` },
                    UpdateExpression: "SET usageCount = if_not_exists(usageCount, :zero) + :one",
                    ExpressionAttributeValues: { ":zero": 0, ":one": 1 }
                }
            });
        }

        await db.send(new TransactWriteCommand({ TransactItems: transactItems }));

        // --- Send confirmation emails ---
        if (FROM_EMAIL && customerEmail) {
            try {
                // Fetch tenant config for site name + notification emails
                const tenantRes = await db.send(new GetCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
                }));
                const tenantConfig = tenantRes.Item;
                const siteName = tenantConfig?.name || "Our Shop";
                const adminEmail = tenantConfig?.integrations?.contactEmail;
                const processingEmail = tenantConfig?.integrations?.orderProcessingEmail;

                const itemLines = validatedItems.map(i =>
                    `  ${i.productTitle} x${i.quantity} — ${i.totalPrice.toFixed(2)} ${currency}`
                ).join("\n");

                const discountLine = couponDiscount > 0
                    ? `Discount (${validatedCouponCode}): -${couponDiscount.toFixed(2)} ${currency}\n`
                    : "";

                const addressLine = shippingAddress
                    ? `Shipping to: ${shippingAddress.street}, ${shippingAddress.city}, ${shippingAddress.county}${shippingAddress.postalCode ? ` ${shippingAddress.postalCode}` : ""}`
                    : null;

                // 1. Customer confirmation email
                const customerBody = [
                    `Hi ${customerName},`,
                    ``,
                    `Thank you for your order! Here are your order details:`,
                    ``,
                    `Order Number: ${orderNumber}`,
                    `Date: ${new Date(now).toLocaleDateString("en-GB")}`,
                    ``,
                    `Items:`,
                    itemLines,
                    ``,
                    `Subtotal: ${subtotal.toFixed(2)} ${currency}`,
                    discountLine ? discountLine : null,
                    `Shipping: ${shippingCost === 0 ? "Free" : `${shippingCost.toFixed(2)} ${currency}`}`,
                    `Total: ${total.toFixed(2)} ${currency}`,
                    ``,
                    `Payment: ${paymentMethod === "bank_transfer" ? "Bank Transfer" : "Cash on Delivery"}`,
                    ``,
                    addressLine,
                    ``,
                    `We'll notify you when your order status changes.`,
                    ``,
                    `Best regards,`,
                    siteName,
                ].filter(line => line !== null).join("\n");

                await ses.send(new SendEmailCommand({
                    Source: FROM_EMAIL,
                    Destination: { ToAddresses: [customerEmail.toLowerCase()] },
                    Message: {
                        Subject: { Data: `[${siteName}] Order Confirmation — ${orderNumber}` },
                        Body: { Text: { Data: customerBody } }
                    }
                }));

                // 2. Admin/processing notification email
                const internalRecipients = new Set<string>();
                if (adminEmail) internalRecipients.add(adminEmail);
                if (processingEmail) internalRecipients.add(processingEmail);

                if (internalRecipients.size > 0) {
                    const internalBody = [
                        `New order received!`,
                        ``,
                        `Order Number: ${orderNumber}`,
                        `Date: ${new Date(now).toLocaleDateString("en-GB")}`,
                        ``,
                        `Customer: ${customerName}`,
                        `Email: ${customerEmail}`,
                        customerPhone ? `Phone: ${customerPhone}` : null,
                        ``,
                        `Items:`,
                        itemLines,
                        ``,
                        `Subtotal: ${subtotal.toFixed(2)} ${currency}`,
                        discountLine ? discountLine : null,
                        `Shipping: ${shippingCost === 0 ? "Free" : `${shippingCost.toFixed(2)} ${currency}`}`,
                        `Total: ${total.toFixed(2)} ${currency}`,
                        ``,
                        `Payment: ${paymentMethod === "bank_transfer" ? "Bank Transfer" : "Cash on Delivery"}`,
                        ``,
                        addressLine,
                        shippingAddress?.notes ? `Notes: ${shippingAddress.notes}` : null,
                        requestedDeliveryDate ? `Requested Delivery: ${requestedDeliveryDate}` : null,
                    ].filter(line => line !== null).join("\n");

                    await ses.send(new SendEmailCommand({
                        Source: FROM_EMAIL,
                        Destination: { ToAddresses: [...internalRecipients] },
                        Message: {
                            Subject: { Data: `[${siteName}] New Order ${orderNumber} — ${total.toFixed(2)} ${currency}` },
                            Body: { Text: { Data: internalBody } }
                        }
                    }));
                }
            } catch (emailErr) {
                // Log but don't fail the order
                console.error("Failed to send confirmation email:", emailErr);
            }
        }

        return {
            statusCode: 201,
            body: JSON.stringify({ orderId, orderNumber, couponDiscount })
        };
    } catch (e: any) {
        console.error("Order creation failed:", e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
