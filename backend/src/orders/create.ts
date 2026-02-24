import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { getDefaultTemplates, renderTemplate, STATUS_LABELS } from "../lib/order-email.js";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL || "";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const body = JSON.parse(event.body);
        const {
            items, customerEmail, customerName, customerPhone, customerBirthday,
            shippingAddress, billingDetails, paymentMethod, requestedDeliveryDate,
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

        // --- Fetch tenant config for currency ---
        const tenantResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));
        const tenantConfig = tenantResult.Item || {};

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

            // --- Validate delivery zone restrictions ---
            if (config.restrictDeliveryZones && shippingAddress) {
                const allowedCountries: string[] = config.allowedCountries || [];
                const allowedCounties: string[] = config.allowedCounties || [];

                // Check country (case-insensitive)
                if (allowedCountries.length > 0) {
                    const customerCountry = (shippingAddress.country || "").toLowerCase().trim();
                    const isCountryAllowed = allowedCountries.some(
                        (c: string) => c.toLowerCase().trim() === customerCountry
                    );
                    if (!isCountryAllowed) {
                        return {
                            statusCode: 400,
                            body: JSON.stringify({
                                error: "Delivery not available",
                                message: `We don't deliver to ${shippingAddress.country}. Allowed countries: ${allowedCountries.join(", ")}`
                            })
                        };
                    }
                }

                // Check county/region (case-insensitive)
                if (allowedCounties.length > 0) {
                    const customerCounty = (shippingAddress.county || "").toLowerCase().trim();
                    const isCountyAllowed = allowedCounties.some(
                        (c: string) => c.toLowerCase().trim() === customerCounty
                    );
                    if (!isCountyAllowed) {
                        return {
                            statusCode: 400,
                            body: JSON.stringify({
                                error: "Delivery not available",
                                message: `We don't deliver to ${shippingAddress.county}. Allowed regions: ${allowedCounties.join(", ")}`
                            })
                        };
                    }
                }
            }

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
        const currency = tenantConfig.currency || "RON";

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
                        billingDetails: billingDetails || null,
                        paymentMethod: paymentMethod || null,
                        requestedDeliveryDate: requestedDeliveryDate || null,
                        subtotal,
                        shippingCost,
                        couponCode: validatedCouponCode,
                        couponId,
                        couponDiscount,
                        total,
                        currency,
                        status: "placed",
                        paymentStatus: "pending",
                        statusHistory: [{ status: "placed", timestamp: now, note: "Order placed" }],
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
                        status: "placed",
                        createdAt: now,
                        Type: "CustomerOrder"
                    }
                }
            },
            // 3. Customer upsert (with birthday, billing details, loyalty points)
            {
                Update: {
                    TableName: TABLE_NAME,
                    Key: {
                        PK: `TENANT#${tenantId}`,
                        SK: `CUSTOMER#${customerEmail.toLowerCase()}`
                    },
                    UpdateExpression: [
                        "SET #n = :name",
                        "phone = :phone",
                        "orderCount = if_not_exists(orderCount, :zero) + :one",
                        "totalSpent = if_not_exists(totalSpent, :zero) + :total",
                        "loyaltyPoints = if_not_exists(loyaltyPoints, :zero) + :points",
                        "lastOrderDate = :now",
                        "defaultAddress = :address",
                        "#t = :type",
                        // Only set birthday/billingDetails if provided (don't overwrite with null)
                        ...(customerBirthday ? ["birthday = :birthday"] : []),
                        ...(billingDetails?.isCompany ? ["defaultBillingDetails = :billing"] : []),
                    ].join(", "),
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
                        ":points": Math.floor(total), // 1 loyalty point per currency unit spent
                        ":now": now,
                        ":address": shippingAddress || null,
                        ":type": "Customer",
                        ...(customerBirthday ? { ":birthday": customerBirthday } : {}),
                        ...(billingDetails?.isCompany ? { ":billing": billingDetails } : {}),
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

        // --- Send confirmation emails via templates ---
        if (FROM_EMAIL && customerEmail) {
            try {
                const tenantRes = await db.send(new GetCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
                }));
                const tenantConfig = tenantRes.Item;
                const siteName = tenantConfig?.name || "Our Shop";
                const adminEmail = tenantConfig?.integrations?.contactEmail;
                const processingEmail = tenantConfig?.integrations?.orderProcessingEmail;

                // Get template for "placed" status (custom or default)
                const defaults = getDefaultTemplates();
                const customTemplates = tenantConfig?.orderEmailConfig?.templates || {};
                const template = customTemplates["placed"] || defaults["placed"];

                const itemLines = validatedItems.map(i =>
                    `  ${i.productTitle} x${i.quantity} — ${i.totalPrice.toFixed(2)} ${currency}`
                ).join("\n");

                const addressLine = shippingAddress
                    ? `${shippingAddress.street}, ${shippingAddress.city}, ${shippingAddress.county}${shippingAddress.postalCode ? ` ${shippingAddress.postalCode}` : ""}`
                    : "";

                const vars: Record<string, string> = {
                    orderNumber,
                    customerName,
                    customerEmail: customerEmail.toLowerCase(),
                    customerPhone: customerPhone || "",
                    status: "placed",
                    statusLabel: STATUS_LABELS["placed"],
                    trackingNumber: "",
                    items: itemLines,
                    subtotal: subtotal.toFixed(2),
                    total: total.toFixed(2),
                    currency,
                    shippingCost: shippingCost === 0 ? "Free" : `${shippingCost.toFixed(2)} ${currency}`,
                    couponDiscount: couponDiscount > 0 ? `${couponDiscount.toFixed(2)} ${currency}` : "",
                    paymentMethod: paymentMethod === "bank_transfer" ? "Bank Transfer" : "Cash on Delivery",
                    deliveryDate: requestedDeliveryDate || "",
                    shippingAddress: addressLine,
                    note: "",
                    siteName,
                };

                const renderedSubject = renderTemplate(template.subject, vars);
                const renderedBody = renderTemplate(template.body, vars);

                // Send to customer
                if (template.sendToCustomer) {
                    await ses.send(new SendEmailCommand({
                        Source: FROM_EMAIL,
                        Destination: { ToAddresses: [customerEmail.toLowerCase()] },
                        Message: {
                            Subject: { Data: `[${siteName}] ${renderedSubject}` },
                            Body: { Text: { Data: renderedBody } }
                        }
                    }));
                }

                // Send to admin/processing
                const internalRecipients = new Set<string>();
                if (template.sendToAdmin && adminEmail) internalRecipients.add(adminEmail);
                if (template.sendToProcessing && processingEmail) internalRecipients.add(processingEmail);

                if (internalRecipients.size > 0) {
                    // Internal email includes extra details
                    const internalBody = [
                        renderedBody,
                        ``,
                        `--- Internal Details ---`,
                        `Customer: ${customerName}`,
                        `Email: ${customerEmail}`,
                        customerPhone ? `Phone: ${customerPhone}` : null,
                        `Payment: ${vars.paymentMethod}`,
                        addressLine ? `Shipping: ${addressLine}` : null,
                        shippingAddress?.notes ? `Notes: ${shippingAddress.notes}` : null,
                        requestedDeliveryDate ? `Requested Delivery: ${requestedDeliveryDate}` : null,
                    ].filter(line => line !== null).join("\n");

                    await ses.send(new SendEmailCommand({
                        Source: FROM_EMAIL,
                        Destination: { ToAddresses: [...internalRecipients] },
                        Message: {
                            Subject: { Data: `[${siteName}] ${renderedSubject}` },
                            Body: { Text: { Data: internalBody } }
                        }
                    }));
                }
            } catch (emailErr) {
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
