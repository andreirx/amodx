import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { orderRef, customerRef, customerOrderRef, orderCounterRef } from "../lib/commerce-db.js";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { getDefaultTemplates, renderTemplate, STATUS_LABELS } from "../lib/order-email.js";
import { verifyRecaptcha, resolveRecaptchaConfig } from "../lib/recaptcha.js";
import { verifyTenantFromOrigin } from "../lib/tenant-verify.js";
import { OrderInputSchema, normalizeEmail, linePrice, roundToCents, sameAmountInCents, resolveLocaleStrings, evaluateCoupon, amountInCents, isCouponType, type PriceChangedAnswer, type CouponCartLine, type CouponRuleRecord } from "@amodx/shared";
import { formatFromHeader } from "../lib/email-from.js";
import { commerceWriteFreezeRefusal } from "../lib/commerce-freeze.js";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL || "";

// Email rate limiting: max emails per address per hour
const EMAIL_RATE_LIMIT = 5;

/**
 * COUPON-FIX-1 rule 7: true when a cancelled order transaction names `ConditionalCheckFailed` as the reason of one of
 * the coupon items (`indexes` are their positions in TransactItems; DynamoDB gives one reason per item, in order).
 */
function couponConditionFailed(e: unknown, indexes: readonly number[]): boolean {
    if (!(e instanceof Error) || e.name !== "TransactionCanceledException") return false;
    const reasons = (e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
    return indexes.some((i) => reasons[i]?.Code === "ConditionalCheckFailed");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        // CMRC-2B (docs/slices/cmrc-2b.md): a tenant in COMMERCE_WRITE_FREEZE_TENANTS takes no order. Before the origin
        // check (a DynamoDB Query), reCAPTCHA, every read and the order-counter UpdateItem: a refused request has no effect.
        const frozen = commerceWriteFreezeRefusal(tenantId);
        if (frozen) return frozen;

        // Phase 3.4: Verify tenant ID matches origin domain
        const tenantVerified = await verifyTenantFromOrigin(event.headers as Record<string, string | undefined>, tenantId);
        if (!tenantVerified) {
            console.warn("Tenant verification failed", { tenantId, origin: event.headers['origin'] });
            return { statusCode: 403, body: JSON.stringify({ error: "Invalid request origin" }) };
        }

        // --- Zod validation (Phase 1.1) ---
        // fnd-2 (PD-001): email-format validation MUST run on the NORMALIZED form, not raw.
        // Fold customerEmail through normalizeEmail BEFORE the schema's z.string().email()
        // sees it. The two verdicts differ — a fullwidth-＠ / NFKC / whitespace address fails
        // .email() raw but passes once canonicalised — so validating raw and persisting the
        // normalized value would store a form that was never validated as stored. Non-string
        // / missing customerEmail is left untouched for the schema to reject as before.
        const rawBody = JSON.parse(event.body);
        if (rawBody && typeof rawBody.customerEmail === "string") {
            rawBody.customerEmail = normalizeEmail(rawBody.customerEmail);
        }
        const parseResult = OrderInputSchema.safeParse(rawBody);
        if (!parseResult.success) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Invalid input",
                    details: parseResult.error.flatten()
                })
            };
        }

        const {
            items, customerEmail, customerName, customerPhone, customerBirthday,
            shippingAddress, billingDetails, paymentMethod, requestedDeliveryDate,
            couponCode, recaptchaToken
        } = parseResult.data;

        // fnd-2: customerEmail already arrived normalized from validation above, so this
        // re-derivation is byte-identical (normalizeEmail is idempotent). Kept explicit as
        // the ONE canonical identity form: every CUSTOMER# / CUSTORDER# / EMAILLIMIT# key,
        // the persisted customerEmail attribute, and the SES recipient below key/route on
        // this — never on raw input — so the write path cannot fork from the read paths
        // (customers/get, renderer account).
        const normalizedEmail = normalizeEmail(customerEmail);

        const now = new Date().toISOString();
        const orderId = crypto.randomUUID();

        // --- Fetch tenant config for currency and reCAPTCHA ---
        const tenantResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));
        const tenantConfig = tenantResult.Item || {};

        // CATALOG-MODE-1 (CM-D6 = A; first named exception to the commerce freeze): only a site that sells takes
        // orders. A missing record maps to {} above and is refused here too (fail closed). Placed before reCAPTCHA and
        // before any product read, so a refused request causes no further call.
        if (tenantConfig.commerceEnabled !== true) {
            return { statusCode: 403, body: JSON.stringify({ error: "This site does not take online orders." }) };
        }

        // --- reCAPTCHA verification (deployment-level mandatory, tenant can override keys/threshold) ---
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
                console.warn(`reCAPTCHA failed [${recaptchaConfig.source}]:`, {
                    success: recaptchaResult.success,
                    score: recaptchaResult.score,
                    errors: recaptchaResult["error-codes"]
                });
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: "Verification failed. Please try again." })
                };
            }
        }

        // --- Server-side price validation ---
        const validatedItems = [];
        let subtotal = 0;
        // COUPON-FIX-1 rule 3: the coupon rule's lines, one per item, with the STORED product's categories.
        const couponLines: CouponCartLine[] = [];

        for (const item of items) {
            const productResult = await db.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${item.productId}` }
            }));

            if (!productResult.Item) {
                return { statusCode: 400, body: JSON.stringify({ error: `Product not found: ${item.productId}` }) };
            }

            const product = productResult.Item;

            // ORDER-PRICE-1 (docs/slices/order-price-1.md § 1 item 2): the chosen option of the FIRST variant group,
            // read from the display label the cart sends ("<group>: <value>[, <group>: <value>…]"). Needed only when
            // an option of that group has a priceOverride; then it must match exactly one option — never a guess.
            const firstGroup = product.variants?.[0];
            let priceOverride: string | undefined;
            if (firstGroup?.options?.some((o: any) => o.priceOverride)) {
                const label = item.selectedVariant;
                const matches = label ? firstGroup.options.filter((o: any) => {
                    const choice = `${firstGroup.name}: ${o.value}`;
                    return label === choice || label.startsWith(`${choice}, `);
                }) : [];
                if (matches.length !== 1) {
                    console.warn("Order refused: variant selection does not match one option", { productId: item.productId, label, matches: matches.length });
                    return { statusCode: 400, body: JSON.stringify({ error: `Variant selection not recognised for product: ${item.productId}` }) };
                }
                priceOverride = matches[0].priceOverride;
            }

            // Personalizations: the request gives which ones; their costs come from the stored product only.
            // `pers.id !== undefined` keeps the id comparison meaningful now that the input id is optional.
            const addedCosts: string[] = [];
            const validatedPersonalizations = [];

            if (item.personalizations && Array.isArray(item.personalizations)) {
                for (const pers of item.personalizations) {
                    const productPers = product.personalizations?.find(
                        (p: any) => (pers.id !== undefined && p.id === pers.id) || p.label === pers.label
                    );
                    const addedCost = productPers?.addedCost || 0;
                    if (productPers?.addedCost !== undefined) addedCosts.push(productPers.addedCost);
                    validatedPersonalizations.push({
                        ...pers,
                        addedCost
                    });
                }
            }

            const priced = linePrice({
                price: product.price,
                salePrice: product.salePrice,
                volumePricing: product.volumePricing,
                priceOverride,
                addedCosts,
            }, item.quantity, tenantConfig.locale); // PRICE-LOCALE-1: the tenant item's locale, never the request's
            if (priced.kind === "invalid-price") {
                console.warn("Order refused: product price does not parse", { productId: item.productId, source: priced.source, text: priced.text });
                return { statusCode: 400, body: JSON.stringify({ error: `Invalid price for product: ${item.productId}` }) };
            }

            const totalPrice = priced.lineTotal;
            subtotal = roundToCents(subtotal + totalPrice);
            couponLines.push({
                productId: item.productId,
                categoryIds: Array.isArray(product.categoryIds) ? product.categoryIds : [],
                lineTotalCents: amountInCents(totalPrice),
            });

            validatedItems.push({
                productId: item.productId,
                productTitle: product.title,
                quantity: item.quantity,
                unitPrice: roundToCents(priced.unitPrice + priced.addedCost).toFixed(2),
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
                        // Phase 1.6: Genericize error message to prevent zone enumeration
                        return {
                            statusCode: 400,
                            body: JSON.stringify({
                                error: "Delivery not available",
                                message: "We don't deliver to this address. Please check our delivery information page."
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
                        // Phase 1.6: Genericize error message to prevent zone enumeration
                        return {
                            statusCode: 400,
                            body: JSON.stringify({
                                error: "Delivery not available",
                                message: "We don't deliver to this address. Please check our delivery information page."
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

        // --- Server-side coupon validation (COUPON-FIX-1: the shared coupon rule on the server's lines) ---
        let couponDiscount = 0;
        let couponId: string | null = null;
        let validatedCouponCode: string | null = null;
        let perCustomerLimit = 0;
        // COUPON-FIX-1 rule 6: the per-customer counter's sort key; set only when the applied coupon has a limit.
        let couponUseSk: string | null = null;

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

                if (couponResult.Item && !isCouponType(couponResult.Item.type)) {
                    // COUPON-FIX-1 § 6: a record whose type is outside the schema enum is a coupon that does not apply
                    console.warn("Coupon not applied: unknown coupon type", { tenantId, couponId, type: couponResult.Item.type });
                    couponId = null;
                } else if (couponResult.Item) {
                    const coupon = couponResult.Item;

                    // COUPON-FIX-1 § 6 (finding 1): a counter already at the per-customer limit is known BEFORE the
                    // totals, so the first answer is already without the discount. Consistent read of the tenant's own
                    // key; the conditional write in the transaction below stays the authority for a race.
                    let customerUseCount: number | undefined;
                    const limit = (coupon.perCustomerLimit as number) || 0;
                    const useSk = `COUPONUSE#${couponId}#${createHash("sha256").update(normalizedEmail).digest("hex")}`;
                    if (limit > 0) {
                        const useResult = await db.send(new GetCommand({
                            TableName: TABLE_NAME,
                            Key: { PK: `TENANT#${tenantId}`, SK: useSk },
                            ConsistentRead: true,
                        }));
                        customerUseCount = (useResult.Item?.count as number) || 0;
                    }

                    // Status, dates, usage limit (the value read here; the write below re-checks the stored value),
                    // per-customer limit, minimum on the whole subtotal, product/category limits; discount on the
                    // covered lines only.
                    const outcome = evaluateCoupon(coupon as CouponRuleRecord, couponLines, new Date(now), customerUseCount);
                    if (outcome.applies) {
                        validatedCouponCode = upperCode;
                        couponDiscount = outcome.discountCents / 100;
                        perCustomerLimit = limit;
                        if (limit > 0) couponUseSk = useSk;
                    } else {
                        // Coupon does not apply — silently ignore; the expectedTotal comparison below tells the visitor
                        couponId = null;
                    }
                } else {
                    couponId = null;
                }
            }
        }

        const { expectedTotal } = parseResult.data;
        const currency = tenantConfig.currency || "USD";

        // COUPON-FIX-1 rule 7: at most two passes. When the order transaction is cancelled because the condition of the
        // coupon item or of the per-customer counter failed (another order used the coupon first), the coupon does
        // not apply: the second pass computes the totals without it, compares them with expectedTotal again, and
        // writes the order without the discount. A cancelled transaction writes none of its items (no order, no
        // customer, no coupon count). The order number taken in the first pass is kept, so it is consumed once; when
        // the second pass answers 409, that number stays unused. The second pass has no coupon item, so it cannot
        // loop again: any failure there is rethrown.
        let orderNumber: string | undefined;
        let total: number;
        for (;;) {
            total = subtotal + shippingCost - couponDiscount;

            // ORDER-CONFIRM-1 (docs/slices/order-confirm-1.md § 1 item 2): an order is created only with a total the visitor
            // saw. The request's total differs in whole cents → 409 with this handler's figures for the request's own
            // items. First pass: this runs before the first write (the order-number counter below), so nothing is
            // written. Second pass (COUPON-FIX-1 rule 7): the counter was raised in the first pass and the first
            // transaction was cancelled, so this 409 leaves that order number unused. No expectedTotal → no comparison
            // (a page loaded before ORDER-CONFIRM-1). `validatedItems[i]` is the line of `items[i]` (the loop above
            // pushes one line per item, in order, or returns).
            if (expectedTotal !== undefined && !sameAmountInCents(expectedTotal, total)) {
                // Ruling OC1-TEXT = A: `message` is the tenant's `pricesChanged` text, from the tenant item read above (its
                // override, else the pack of its locale); a blank override gives the pack text (the rule of the backend's
                // other locale texts, `catalogServerTexts`).
                const texts = resolveLocaleStrings(tenantConfig);
                const answer: PriceChangedAnswer = {
                    code: "price-changed",
                    error: "Prices have changed. Check the new total, then place the order again.",
                    message: texts.strings.commerce.pricesChanged.trim() || texts.defaults.commerce.pricesChanged,
                    total: roundToCents(total),
                    subtotal,
                    shippingCost,
                    couponDiscount,
                    items: validatedItems.map((line, i) => ({
                        productId: line.productId,
                        ...(items[i].selectedVariant !== undefined ? { selectedVariant: items[i].selectedVariant } : {}),
                        quantity: line.quantity,
                        unitPrice: Number(line.unitPrice),
                        totalPrice: line.totalPrice,
                    })),
                };
                console.warn("Order refused: total differs from the total the visitor saw", { tenantId, expectedTotal, total: answer.total });
                return { statusCode: 409, body: JSON.stringify(answer) };
            }

            // --- Generate order number via atomic counter (once: a second pass keeps the number of the first) ---
            if (orderNumber === undefined) {
                const counterResult = await db.send(new UpdateCommand({
                    ...orderCounterRef(tenantId),
                    UpdateExpression: "SET currentValue = if_not_exists(currentValue, :zero) + :one",
                    ExpressionAttributeValues: {
                        ":zero": 0,
                        ":one": 1
                    },
                    ReturnValues: "UPDATED_NEW"
                }));

                const counterValue = counterResult.Attributes?.currentValue || 1;
                orderNumber = `PPB-${String(counterValue).padStart(4, "0")}`;
            }

            // --- Build transaction items ---
            // CMRC-1A: the three commerce-private items take their table and key from lib/commerce-db.ts; the two
            // coupon items below keep TABLE_NAME (cmrc-4 moves the first three to another table; the transaction
            // then spans two tables with no edit here).
            const orderReference = orderRef(tenantId, orderId);
            const customerOrderReference = customerOrderRef(tenantId, normalizedEmail, orderId);
            const transactItems: any[] = [
                // 1. Full order item
                {
                    Put: {
                        TableName: orderReference.TableName,
                        Item: {
                            ...orderReference.Key,
                            id: orderId,
                            tenantId,
                            orderNumber,
                            items: validatedItems,
                            customerEmail: normalizedEmail,
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
                        TableName: customerOrderReference.TableName,
                        Item: {
                            ...customerOrderReference.Key,
                            orderNumber,
                            total,
                            status: "placed",
                            createdAt: now,
                            Type: "CustomerOrder"
                        }
                    }
                },
                // 3. Customer upsert (Phase 1.2: use if_not_exists for PII to prevent overwrite attacks)
                {
                    Update: {
                        ...customerRef(tenantId, normalizedEmail),
                        UpdateExpression: [
                            // Only set name/phone/address on FIRST order (protect existing customer data)
                            "SET #n = if_not_exists(#n, :name)",
                            "phone = if_not_exists(phone, :phone)",
                            "defaultAddress = if_not_exists(defaultAddress, :address)",
                            // Always increment counters
                            "orderCount = if_not_exists(orderCount, :zero) + :one",
                            "totalSpent = if_not_exists(totalSpent, :zero) + :total",
                            "loyaltyPoints = if_not_exists(loyaltyPoints, :zero) + :points",
                            "lastOrderDate = :now",
                            "#t = :type",
                            // Only set birthday/billingDetails if provided AND not already set
                            ...(customerBirthday ? ["birthday = if_not_exists(birthday, :birthday)"] : []),
                            ...(billingDetails?.isCompany ? ["defaultBillingDetails = if_not_exists(defaultBillingDetails, :billing)"] : []),
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

            // 4. Increment coupon usage if applied. COUPON-FIX-1 rule 5: the condition reads the STORED attributes, so
            // two orders at the same moment cannot both pass a limit the earlier read allowed.
            // 5. COUPON-FIX-1 rule 6: the per-customer counter, raised in the same transaction under its own condition.
            // The key holds the SHA-256 of the normalized email, not the address (Track B decides the item's final table).
            const couponItemIndexes: number[] = [];
            if (couponId) {
                couponItemIndexes.push(transactItems.push({
                    Update: {
                        TableName: TABLE_NAME,
                        Key: { PK: `TENANT#${tenantId}`, SK: `COUPON#${couponId}` },
                        UpdateExpression: "SET usageCount = if_not_exists(usageCount, :zero) + :one",
                        ConditionExpression: "attribute_not_exists(usageLimit) OR usageLimit = :zero OR attribute_not_exists(usageCount) OR usageCount < usageLimit",
                        ExpressionAttributeValues: { ":zero": 0, ":one": 1 }
                    }
                }) - 1);
                if (couponUseSk) {
                    couponItemIndexes.push(transactItems.push({
                        Update: {
                            TableName: TABLE_NAME,
                            Key: { PK: `TENANT#${tenantId}`, SK: couponUseSk },
                            UpdateExpression: "SET #c = if_not_exists(#c, :zero) + :one, #t = :type",
                            ConditionExpression: "attribute_not_exists(#c) OR #c < :limit",
                            ExpressionAttributeNames: { "#c": "count", "#t": "Type" },
                            ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":limit": perCustomerLimit, ":type": "CouponUse" }
                        }
                    }) - 1);
                }
            }

            try {
                await db.send(new TransactWriteCommand({ TransactItems: transactItems }));
                break;
            } catch (e) {
                if (couponId && couponConditionFailed(e, couponItemIndexes)) {
                    console.warn("Coupon not applied: its condition failed at write time", { tenantId, couponId });
                    couponId = null;
                    validatedCouponCode = null;
                    couponDiscount = 0;
                    continue;
                }
                throw e;
            }
        }

        // --- Send confirmation emails via templates ---
        if (FROM_EMAIL && customerEmail) {
            try {
                // Phase 1.4: Email rate limiting - prevent email bombing
                const emailKey = `EMAILLIMIT#${normalizedEmail}`;
                const hour = Math.floor(Date.now() / 3600000);

                const emailLimitRes = await db.send(new GetCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: 'SYSTEM', SK: emailKey }
                }));

                const currentHour = emailLimitRes.Item?.hour;
                const emailCount = currentHour === hour ? (emailLimitRes.Item?.count || 0) : 0;

                if (emailCount >= EMAIL_RATE_LIMIT) {
                    console.warn(`Email rate limit exceeded for ${customerEmail}, skipping order confirmation email`);
                    // Still return success - order is created, just skip email
                    return {
                        statusCode: 201,
                        body: JSON.stringify({ orderId, orderNumber, couponDiscount })
                    };
                }

                // Update email counter with TTL (expires in 2 hours)
                await db.send(new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: 'SYSTEM', SK: emailKey },
                    UpdateExpression: 'SET #h = :hour, #c = if_not_exists(#c, :zero) + :one, #ttl = :ttl',
                    ExpressionAttributeNames: { '#h': 'hour', '#c': 'count', '#ttl': 'ttl' },
                    ExpressionAttributeValues: {
                        ':hour': hour,
                        ':zero': 0,
                        ':one': 1,
                        ':ttl': Math.floor(Date.now() / 1000) + 7200 // 2 hour TTL
                    }
                }));

                const tenantRes = await db.send(new GetCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
                }));
                const tenantConfig = tenantRes.Item;
                const siteName = tenantConfig?.name || "Our Shop";
                // From display name uses the raw tenant name so an unnamed tenant falls
                // back to the platform brand ("AMODX"), NOT the template-only "Our Shop"
                // (EMAIL-HOTFIX-1 review-1). siteName stays "Our Shop"-defaulted for the
                // email body/subject templates below.
                const fromHeader = formatFromHeader(tenantConfig?.name, FROM_EMAIL);
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
                    customerEmail: normalizedEmail,
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
                        Source: fromHeader,
                        Destination: { ToAddresses: [normalizedEmail] },
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
                        Source: fromHeader,
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
        console.error("[orders/create] Order creation failed:", e);
        return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
    }
};

export const handler = _handler;
