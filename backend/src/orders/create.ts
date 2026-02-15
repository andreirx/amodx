import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const body = JSON.parse(event.body);
        const {
            items, customerEmail, customerName, customerPhone,
            shippingAddress, paymentMethod, requestedDeliveryDate
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

        const total = subtotal + shippingCost;
        const currency = validatedItems[0]?.unitPrice !== undefined ? "RON" : "RON";

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

        // --- Atomic write: ORDER + CUSTORDER + CUSTOMER upsert ---
        await db.send(new TransactWriteCommand({
            TransactItems: [
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
            ]
        }));

        return {
            statusCode: 201,
            body: JSON.stringify({ orderId, orderNumber })
        };
    } catch (e: any) {
        console.error("Order creation failed:", e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
