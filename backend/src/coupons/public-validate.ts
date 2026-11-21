import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { BatchGetCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import {
    evaluateCoupon, amountInCents, isCouponType, CouponPrecheckItemSchema, COUPON_PRECHECK_MAX_LINES,
    type CouponCartLine, type CouponRefusal, type CouponRuleRecord,
} from "@amodx/shared";
import { verifyRecaptcha, resolveRecaptchaConfig } from "../lib/recaptcha.js";
import { verifyTenantFromOrigin } from "../lib/tenant-verify.js";

/** Retries of `UnprocessedKeys` after the first BatchGet (then the read fails: 500, as any server failure). */
const UNPROCESSED_RETRIES = 3;

/**
 * COUPON-FIX-1: `categoryIds` of each named product, from the tenant's own records — one BatchGet (≤ 50 distinct keys,
 * under the 100-key limit), `UnprocessedKeys` retried at most 3 times. A product that does not exist has no entry.
 */
async function readProductCategories(tenantId: string, productIds: string[]): Promise<Map<string, string[]>> {
    const found = new Map<string, string[]>();
    let keys: Record<string, any>[] = [...new Set(productIds)].map((id) => ({ PK: `TENANT#${tenantId}`, SK: `PRODUCT#${id}` }));
    for (let retry = 0; keys.length > 0; retry++) {
        if (retry > UNPROCESSED_RETRIES) throw new Error("Product categories: keys still unprocessed after retries");
        const res = await db.send(new BatchGetCommand({
            RequestItems: { [TABLE_NAME]: { Keys: keys, ProjectionExpression: "SK, categoryIds" } },
        }));
        for (const item of res.Responses?.[TABLE_NAME] ?? []) {
            found.set(String(item.SK).slice("PRODUCT#".length), Array.isArray(item.categoryIds) ? item.categoryIds : []);
        }
        keys = res.UnprocessedKeys?.[TABLE_NAME]?.Keys ?? [];
    }
    return found;
}

/** The answer texts, unchanged for the cases this handler had before COUPON-FIX-1. */
function refusalText(reason: CouponRefusal, coupon: Record<string, any>): string {
    switch (reason) {
        case "not-active": return "Coupon is not active";
        case "not-yet-valid": return "Coupon is not yet valid";
        case "expired": return "Coupon has expired";
        case "usage-limit": return "Coupon usage limit reached";
        // Not produced here (this handler does not pass a customer count); the case keeps the switch exhaustive.
        case "customer-limit": return "Coupon usage limit reached for this customer";
        case "below-minimum": return `Minimum order amount is ${parseFloat(coupon.minimumOrderAmount as string) || 0}`;
        case "no-covered-line": return "Coupon does not apply to any items in cart";
    }
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        // Phase 3.4: Verify tenant ID matches origin domain
        const tenantVerified = await verifyTenantFromOrigin(event.headers as Record<string, string | undefined>, tenantId);
        if (!tenantVerified) {
            return { statusCode: 403, body: JSON.stringify({ error: "Invalid request origin" }) };
        }

        const body = JSON.parse(event.body);
        const { code, subtotal, customerEmail, items, recaptchaToken } = body;

        if (!code) return { statusCode: 400, body: JSON.stringify({ error: "Missing coupon code" }) };
        if (subtotal === undefined || subtotal === null) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing subtotal" }) };
        }

        // Phase 1.5: Fetch tenant config for reCAPTCHA settings
        const tenantResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));
        const tenantConfig = tenantResult.Item || {};

        // reCAPTCHA verification to prevent coupon enumeration (deployment-level mandatory)
        const recaptchaConfig = resolveRecaptchaConfig(tenantConfig.recaptcha);
        if (recaptchaConfig) {
            if (!recaptchaToken) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: "Verification required" })
                };
            }

            const recaptchaResult = await verifyRecaptcha(
                recaptchaToken,
                recaptchaConfig.secretKey,
                event.requestContext?.http?.sourceIp
            );

            if (!recaptchaResult.success || recaptchaResult.score < recaptchaConfig.threshold) {
                console.warn(`Coupon validate reCAPTCHA failed [${recaptchaConfig.source}]:`, {
                    success: recaptchaResult.success,
                    score: recaptchaResult.score
                });
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: "Verification failed" })
                };
            }
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

        // 3. Unknown type (COUPON-FIX-1 § 6): a coupon that does not apply
        if (!isCouponType(coupon.type)) {
            console.warn("Coupon not applied: unknown coupon type", { tenantId, couponId, type: coupon.type });
            return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "Coupon cannot be used" }) };
        }

        // 4. The lines (COUPON-FIX-1 ruling CF1-PRECHECK-LINES = B). The cart sends per line `productId`, `quantity`
        // and the line total it shows (advisory: the order handler prices every line itself). The categories come
        // from the tenant's own product records, never from the request. An old cart body (no line totals) is one
        // line holding the whole subtotal with no product and no category: the same answer as before for a coupon
        // without limits, `no-covered-line` for a limited coupon.
        let lines: CouponCartLine[];
        const hasLineTotals = Array.isArray(items) && items.some((item: any) => item?.lineTotal !== undefined);
        if (Array.isArray(items) && items.length > COUPON_PRECHECK_MAX_LINES) {
            return { statusCode: 400, body: JSON.stringify({ error: "Too many items" }) };
        }
        if (hasLineTotals) {
            const parsed = z.array(CouponPrecheckItemSchema).safeParse(items);
            if (!parsed.success) return { statusCode: 400, body: JSON.stringify({ error: "Invalid items" }) };
            const categoriesById = await readProductCategories(tenantId, parsed.data.map((item) => item.productId));
            lines = parsed.data.map((item) => ({
                productId: item.productId,
                categoryIds: categoriesById.get(item.productId) ?? [],
                lineTotalCents: amountInCents(item.lineTotal),
            }));
        } else {
            lines = [{ productId: "", categoryIds: [], lineTotalCents: amountInCents(parseFloat(subtotal)) }];
        }

        // 5. The shared coupon rule. The customer is unknown here, so the per-customer limit is not checked.
        const outcome = evaluateCoupon(coupon as CouponRuleRecord, lines, new Date());
        if (!outcome.applies) {
            return { statusCode: 200, body: JSON.stringify({ valid: false, reason: refusalText(outcome.reason, coupon) }) };
        }

        // 6. Return valid result (shape unchanged)
        return {
            statusCode: 200,
            body: JSON.stringify({
                valid: true,
                discount: outcome.discountCents / 100,
                couponId,
                type: coupon.type,
                value: parseFloat(coupon.value as string),
            })
        };
    } catch (e: any) {
        console.error("[coupons/public-validate] Error:", e);
        return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
    }
};
