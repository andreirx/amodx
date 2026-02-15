import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const body = JSON.parse(event.body);
        const { code, subtotal, customerEmail, items } = body;

        if (!code) return { statusCode: 400, body: JSON.stringify({ error: "Missing coupon code" }) };
        if (subtotal === undefined || subtotal === null) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing subtotal" }) };
        }

        const upperCode = code.toUpperCase();

        // 1. Lookup COUPONCODE# by uppercase code
        const codeLookup = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `COUPONCODE#${upperCode}` }
        }));

        if (!codeLookup.Item) {
            return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "Coupon code not found" }) };
        }

        const couponId = codeLookup.Item.couponId as string;

        // 2. Fetch full COUPON# item
        const couponResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `COUPON#${couponId}` }
        }));

        if (!couponResult.Item) {
            return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "Coupon not found" }) };
        }

        const coupon = couponResult.Item;

        // 3. Check status === "active"
        if (coupon.status !== "active") {
            return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "Coupon is not active" }) };
        }

        // 4. Check validFrom/validUntil (date range)
        const now = new Date().toISOString();
        if (coupon.validFrom && now < coupon.validFrom) {
            return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "Coupon is not yet valid" }) };
        }
        if (coupon.validUntil && now > coupon.validUntil) {
            return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "Coupon has expired" }) };
        }

        // 5. Check usageLimit (usageCount < usageLimit, if usageLimit > 0)
        const usageLimit = coupon.usageLimit as number;
        const usageCount = coupon.usageCount as number;
        if (usageLimit > 0 && usageCount >= usageLimit) {
            return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "Coupon usage limit reached" }) };
        }

        // 6. Check minimumOrderAmount (subtotal >= minimum)
        const minimumOrderAmount = parseFloat(coupon.minimumOrderAmount as string) || 0;
        const orderSubtotal = parseFloat(subtotal);
        if (orderSubtotal < minimumOrderAmount) {
            return {
                statusCode: 200,
                body: JSON.stringify({ valid: false, reason: `Minimum order amount is ${minimumOrderAmount}` })
            };
        }

        // 7. Check applicableCategories/applicableProducts
        const applicableCategories = coupon.applicableCategories as string[] || [];
        const applicableProducts = coupon.applicableProducts as string[] || [];

        if ((applicableCategories.length > 0 || applicableProducts.length > 0) && items && Array.isArray(items)) {
            const hasMatchingItem = items.some((item: any) => {
                // Check product match
                if (applicableProducts.length > 0 && applicableProducts.includes(item.productId)) {
                    return true;
                }
                // Check category match
                if (applicableCategories.length > 0 && item.categoryIds && Array.isArray(item.categoryIds)) {
                    return item.categoryIds.some((catId: string) => applicableCategories.includes(catId));
                }
                return false;
            });

            if (!hasMatchingItem) {
                return {
                    statusCode: 200,
                    body: JSON.stringify({ valid: false, reason: "Coupon does not apply to any items in cart" })
                };
            }
        }

        // 8. Calculate discount
        const couponType = coupon.type as string;
        const couponValue = parseFloat(coupon.value as string);
        let discount = 0;

        if (couponType === "percentage") {
            discount = (couponValue / 100) * orderSubtotal;
            // Cap by maximumDiscount if set
            const maximumDiscount = coupon.maximumDiscount ? parseFloat(coupon.maximumDiscount as string) : 0;
            if (maximumDiscount > 0 && discount > maximumDiscount) {
                discount = maximumDiscount;
            }
        } else if (couponType === "fixed_amount") {
            discount = couponValue;
        }

        // Never discount more than the subtotal
        if (discount > orderSubtotal) {
            discount = orderSubtotal;
        }

        // Round to 2 decimal places
        discount = Math.round(discount * 100) / 100;

        // 9. Return valid result
        return {
            statusCode: 200,
            body: JSON.stringify({
                valid: true,
                discount,
                couponId,
                type: couponType,
                value: couponValue,
            })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
