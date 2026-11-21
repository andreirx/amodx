import { describe, it, expect, beforeEach, vi } from "vitest";
import { BatchGetCommand, GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";

/**
 * COUPON-FIX-1 (docs/slices/coupon-fix-1.md) — the coupon limits are enforced when the order is written.
 * Same style as `order-confirm-1.test.ts`: the real `orders/create.ts` and the real shared coupon rule; mocked are
 * `db.js` (`send`), the origin and reCAPTCHA helpers and the SES client. Credential-free. Each `it` names the
 * taxonomy row it binds.
 *
 * `mockDb` keeps the STORED coupon and the stored per-customer counters apart from what a GetCommand returns, so a test
 * can model "another order used the coupon after this order read it". It evaluates the two coupon condition texts the
 * handler sends, exactly as written (any other condition text throws), and cancels the transaction the way DynamoDB
 * does: a `TransactionCanceledException` with one reason per item, and none of the items applied.
 */

const { ddbSend, sesSend, mockVerifyOrigin, mockResolveRecaptcha } = vi.hoisted(() => {
    process.env.SES_FROM_EMAIL = "shop@t1.test";
    return { ddbSend: vi.fn(), sesSend: vi.fn(), mockVerifyOrigin: vi.fn(), mockResolveRecaptcha: vi.fn() };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/tenant-verify.js", () => ({ verifyTenantFromOrigin: mockVerifyOrigin }));
vi.mock("../../src/lib/recaptcha.js", () => ({ resolveRecaptchaConfig: mockResolveRecaptcha, verifyRecaptcha: vi.fn() }));
vi.mock("@aws-sdk/client-ses", () => ({
    SESClient: class { send = sesSend; },
    SendEmailCommand: class { constructor(public input: any) {} },
}));

import { handler as createOrder } from "../../src/orders/create.js";
import { handler as precheck } from "../../src/coupons/public-validate.js";

const TENANT = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", commerceEnabled: true, currency: "USD" };
const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";
const product = (id: string, extra: Record<string, any> = {}) => ({
    PK: "TENANT#t1", SK: `PRODUCT#${id}`, id, title: `Product ${id.slice(-1)}`, price: "25.00",
    volumePricing: [], variants: [], personalizations: [], ...extra,
});
const COUPON = { PK: "TENANT#t1", SK: "COUPON#cp1", id: "cp1", code: "TEN", status: "active", type: "percentage", value: "10", usageLimit: 1, usageCount: 0 };

const USAGE_CONDITION = "attribute_not_exists(usageLimit) OR usageLimit = :zero OR attribute_not_exists(usageCount) OR usageCount < usageLimit";
const PER_CUSTOMER_CONDITION = "attribute_not_exists(#c) OR #c < :limit";

type Store = {
    /** What GetCommand COUPON#cp1 returns (the handler's read). */
    readCoupon: Record<string, any>;
    /** The coupon as stored at write time; defaults to a copy of `readCoupon`. */
    storedCoupon: Record<string, any>;
    couponUses: Map<string, number>;
    /** A cancellation to throw on the next TransactWriteCommand instead of evaluating it. */
    forcedCancel?: Error;
    /** The counter read returns nothing (models a read made just before another order's write). */
    staleCouponUseRead?: boolean;
    /** The next N BatchGets return every key as unprocessed. */
    unprocessedRounds?: number;
};
let store: Store;

function mockDb(products: Record<string, any>, coupon: Record<string, any>, storedCoupon?: Record<string, any>) {
    store = { readCoupon: coupon, storedCoupon: structuredClone(storedCoupon ?? coupon), couponUses: new Map() };
    ddbSend.mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) {
            const sk = String(cmd.input.Key?.SK);
            if (sk.startsWith("TENANT#")) return { Item: structuredClone(TENANT) };
            if (sk.startsWith("PRODUCT#")) {
                const p = products[sk.slice("PRODUCT#".length)];
                return { Item: p ? structuredClone(p) : undefined };
            }
            if (sk === "COUPONCODE#TEN") return { Item: { couponId: "cp1" } };
            if (sk === "COUPON#cp1") return { Item: structuredClone(store.readCoupon) };
            if (sk.startsWith("COUPONUSE#")) {
                const count = store.staleCouponUseRead ? undefined : store.couponUses.get(sk);
                return { Item: count === undefined ? undefined : { count } };
            }
            return {};
        }
        if (cmd instanceof UpdateCommand && cmd.input.Key?.SK === "COUNTER#ORDER") return { Attributes: { currentValue: 7 } };
        if (cmd instanceof BatchGetCommand) {
            const request = cmd.input.RequestItems!["test-table"];
            if (store.unprocessedRounds) { store.unprocessedRounds--; return { Responses: { "test-table": [] }, UnprocessedKeys: { "test-table": request } }; }
            const found = request.Keys!.map((k) => products[String(k.SK).slice("PRODUCT#".length)]).filter(Boolean)
                .map((p) => ({ SK: p.SK, ...(p.categoryIds ? { categoryIds: p.categoryIds } : {}) }));
            return { Responses: { "test-table": structuredClone(found) } };
        }
        if (cmd instanceof TransactWriteCommand) {
            if (store.forcedCancel) { const e = store.forcedCancel; store.forcedCancel = undefined; throw e; }
            const items = cmd.input.TransactItems!;
            const reasons = items.map((item) => {
                const u = item.Update;
                if (!u?.ConditionExpression) return "None";
                const sk = String(u.Key!.SK);
                if (sk === "COUPON#cp1" && u.ConditionExpression === USAGE_CONDITION) {
                    const { usageLimit, usageCount } = store.storedCoupon;
                    const ok = usageLimit === undefined || usageLimit === 0 || usageCount === undefined || usageCount < usageLimit;
                    return ok ? "None" : "ConditionalCheckFailed";
                }
                if (sk.startsWith("COUPONUSE#") && u.ConditionExpression === PER_CUSTOMER_CONDITION) {
                    const count = store.couponUses.get(sk);
                    const ok = count === undefined || count < u.ExpressionAttributeValues![":limit"];
                    return ok ? "None" : "ConditionalCheckFailed";
                }
                throw new Error(`unsupported condition ${u.ConditionExpression} on ${sk}`);
            });
            if (reasons.some((r) => r !== "None")) {
                throw new TransactionCanceledException({
                    message: "Transaction cancelled", $metadata: {}, CancellationReasons: reasons.map((Code) => ({ Code })),
                });
            }
            for (const item of items) {
                const sk = String(item.Update?.Key?.SK ?? "");
                if (sk === "COUPON#cp1") store.storedCoupon.usageCount = (store.storedCoupon.usageCount ?? 0) + 1;
                if (sk.startsWith("COUPONUSE#")) store.couponUses.set(sk, (store.couponUses.get(sk) ?? 0) + 1);
            }
            return {};
        }
        return {};
    });
}

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const transactions = () => commands().filter((c) => c instanceof TransactWriteCommand) as TransactWriteCommand[];
const couponUpdate = (t: TransactWriteCommand) =>
    t.input.TransactItems!.find((i) => i.Update?.Key?.SK === "COUPON#cp1")?.Update;

const orderEvent = (body: Record<string, unknown>) => ({
    headers: { "x-tenant-id": "t1", origin: "https://t1.test" },
    requestContext: { http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify({ customerEmail: "buyer@example.com", customerName: "Buyer", paymentMethod: "cash_on_delivery", ...body }),
}) as any;
const call = async (body: Record<string, unknown>) => (await (createOrder as any)(orderEvent(body), {} as any, () => {})) as any;
const ONE = [{ productId: P1, quantity: 3 }]; // 3 × 25.00 = 75

beforeEach(() => {
    ddbSend.mockReset();
    sesSend.mockReset().mockResolvedValue({});
    mockVerifyOrigin.mockReset().mockResolvedValue(true);
    mockResolveRecaptcha.mockReset().mockReturnValue(null);
});

describe("COUPON-FIX-1 C — the usage count update carries its own condition", () => {
    it("C regression: the COUPON# update in the order transaction is conditional on the STORED usageLimit / usageCount", async () => {
        mockDb({ [P1]: product(P1) }, COUPON);
        const res = await call({ items: ONE, couponCode: "TEN" });
        expect(res.statusCode).toBe(201);
        const update = couponUpdate(transactions()[0]);
        expect(update).toBeDefined();
        expect(update!.ConditionExpression).toBe(
            "attribute_not_exists(usageLimit) OR usageLimit = :zero OR attribute_not_exists(usageCount) OR usageCount < usageLimit",
        );
    });
});

const storedOrder = (t: TransactWriteCommand) => t.input.TransactItems![0].Put!.Item!;
const counterUpdates = () => commands().filter((c) => c instanceof UpdateCommand && c.input.Key?.SK === "COUNTER#ORDER");
const couponUseItems = (t: TransactWriteCommand) =>
    t.input.TransactItems!.filter((i) => String(i.Update?.Key?.SK ?? "").startsWith("COUPONUSE#"));
const onlyReads = () => commands().every((c) => c instanceof GetCommand);
const UNLIMITED = { ...COUPON, usageLimit: 0 };
const TWO = [{ productId: P1, quantity: 3 }, { productId: P2, quantity: 1 }]; // 75 + 10 = 85
const twoProducts = (p1: Record<string, any> = {}, p2: Record<string, any> = {}) => ({
    [P1]: product(P1, { categoryIds: ["cat-c"], ...p1 }),
    [P2]: product(P2, { price: "10.00", categoryIds: ["cat-d"], ...p2 }),
});

describe("COUPON-FIX-1 — coupon without limits: totals equal to today's", () => {
    it("percentage golden: 10% of 75 → couponDiscount 7.5, total 67.5", async () => {
        mockDb({ [P1]: product(P1) }, UNLIMITED);
        const res = await call({ items: ONE, couponCode: "TEN" });
        expect(res.statusCode).toBe(201);
        expect(storedOrder(transactions()[0])).toMatchObject({ subtotal: 75, couponDiscount: 7.5, total: 67.5, couponId: "cp1", couponCode: "TEN" });
    });
    it("fixed_amount golden: 12.50 off 75 → couponDiscount 12.5, total 62.5", async () => {
        mockDb({ [P1]: product(P1) }, { ...UNLIMITED, type: "fixed_amount", value: "12.50" });
        const res = await call({ items: ONE, couponCode: "TEN" });
        expect(res.statusCode).toBe(201);
        expect(storedOrder(transactions()[0])).toMatchObject({ subtotal: 75, couponDiscount: 12.5, total: 62.5 });
    });
});

describe("COUPON-FIX-1 A — product and category limits, from the server's data", () => {
    it("limited to product A; cart A + B → discount on A's line only (7.5 of 75, not 8.5 of 85)", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableProducts: [P1] });
        const res = await call({ items: TWO, couponCode: "TEN" });
        expect(res.statusCode).toBe(201);
        expect(storedOrder(transactions()[0])).toMatchObject({ subtotal: 85, couponDiscount: 7.5, total: 77.5 });
    });
    it("limited to category C; the server's product is in C, the request claims a false category → the server record decides", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableCategories: ["cat-c"] });
        const items = [{ productId: P1, quantity: 3, categoryIds: ["cat-x"] }, { productId: P2, quantity: 1, categoryIds: [] }];
        const res = await call({ items, couponCode: "TEN" });
        expect(res.statusCode).toBe(201);
        expect(storedOrder(transactions()[0])).toMatchObject({ couponDiscount: 7.5, total: 77.5, couponId: "cp1" });
    });
    it("limited to category X; only the request claims X → not applied", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableCategories: ["cat-x"] });
        const items = [{ productId: P1, quantity: 3, categoryIds: ["cat-x"] }, { productId: P2, quantity: 1, categoryIds: ["cat-x"] }];
        const res = await call({ items, couponCode: "TEN" });
        expect(res.statusCode).toBe(201);
        expect(storedOrder(transactions()[0])).toMatchObject({ couponDiscount: 0, total: 85, couponId: null, couponCode: null });
    });
    it("limited to product A; cart B only → order written without discount, no COUPON# item", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableProducts: [P1] });
        const res = await call({ items: [{ productId: P2, quantity: 1 }], couponCode: "TEN" });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).couponDiscount).toBe(0);
        expect(couponUpdate(transactions()[0])).toBeUndefined();
    });
    it("limited to product A; cart B only, expectedTotal included the discount → 409 with the server's figures, nothing written", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableProducts: [P1] });
        const res = await call({ items: [{ productId: P2, quantity: 1 }], couponCode: "TEN", expectedTotal: 9 });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ code: "price-changed", total: 10, subtotal: 10, couponDiscount: 0 });
        expect(onlyReads()).toBe(true);
    });
    it("fixed amount larger than the covered lines → capped at the covered sum (40 off B's 10 → 10)", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, type: "fixed_amount", value: "40", applicableProducts: [P2] });
        await call({ items: TWO, couponCode: "TEN" });
        expect(storedOrder(transactions()[0])).toMatchObject({ couponDiscount: 10, total: 75 });
    });
    it("percentage with maximumDiscount on the covered lines → capped (50% of A's 75 = 37.5 → 20)", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, value: "50", maximumDiscount: "20", applicableProducts: [P1] });
        await call({ items: TWO, couponCode: "TEN" });
        expect(storedOrder(transactions()[0])).toMatchObject({ couponDiscount: 20, total: 65 });
    });
    it("minimum met by the whole cart (85 ≥ 80), covered line below it (B = 10) → applies", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, minimumOrderAmount: "80", applicableProducts: [P2] });
        await call({ items: TWO, couponCode: "TEN" });
        expect(storedOrder(transactions()[0])).toMatchObject({ couponDiscount: 1, total: 84 });
    });
});

describe("COUPON-FIX-1 C — losing the usage-limit race (rule 7)", () => {
    // The handler READ usageCount 0 of a limit of 1; when it writes, another order has already raised it to 1.
    const raced = () => mockDb({ [P1]: product(P1) }, COUPON, { ...COUPON, usageCount: 1 });

    it("usageLimit 1, the condition fails → second pass without the coupon; order written without discount; usageCount not raised; one order number", async () => {
        raced();
        const res = await call({ items: ONE, couponCode: "TEN" });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body)).toMatchObject({ orderNumber: "PPB-0007", couponDiscount: 0 });
        const [first, second] = transactions();
        expect(transactions()).toHaveLength(2);
        expect(couponUpdate(first)).toBeDefined();
        expect(couponUpdate(second)).toBeUndefined();
        expect(storedOrder(second)).toMatchObject({ orderNumber: "PPB-0007", couponDiscount: 0, total: 75, couponId: null, couponCode: null });
        expect(storedOrder(second).id).toBe(storedOrder(first).id);
        expect(store.storedCoupon.usageCount).toBe(1);
        expect(counterUpdates()).toHaveLength(1);
    });
    it("same race, expectedTotal included the discount → 409 with the server's figures; no second transaction", async () => {
        raced();
        const res = await call({ items: ONE, couponCode: "TEN", expectedTotal: 67.5 });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ code: "price-changed", total: 75, couponDiscount: 0 });
        expect(transactions()).toHaveLength(1); // the cancelled first attempt only
        expect(store.storedCoupon.usageCount).toBe(1);
        expect(counterUpdates()).toHaveLength(1); // the number of the cancelled attempt stays unused
    });
    it("two orders that both read usageCount 0 of a limit of 1 → the first gets the discount, the second does not; usageCount = 1", async () => {
        mockDb({ [P1]: product(P1) }, COUPON); // every read returns usageCount 0
        const a = await call({ items: ONE, couponCode: "TEN" });
        const b = await call({ items: ONE, couponCode: "TEN" });
        expect(JSON.parse(a.body).couponDiscount).toBe(7.5);
        expect(JSON.parse(b.body).couponDiscount).toBe(0);
        expect(store.storedCoupon.usageCount).toBe(1);
    });
    it("cancellation for another reason (TransactionConflict on the coupon item) → rethrown: 500 as today, no second pass", async () => {
        mockDb({ [P1]: product(P1) }, COUPON);
        store.forcedCancel = new TransactionCanceledException({
            message: "Transaction cancelled", $metadata: {},
            CancellationReasons: [{ Code: "None" }, { Code: "None" }, { Code: "None" }, { Code: "TransactionConflict" }],
        });
        const res = await call({ items: ONE, couponCode: "TEN" });
        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res.body)).toEqual({ error: "Internal error" });
        expect(transactions()).toHaveLength(1);
    });
    it("a ConditionalCheckFailed reason on a NON-coupon item → rethrown (500), no second pass", async () => {
        mockDb({ [P1]: product(P1) }, COUPON);
        store.forcedCancel = new TransactionCanceledException({
            message: "Transaction cancelled", $metadata: {},
            CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }, { Code: "None" }, { Code: "None" }],
        });
        const res = await call({ items: ONE, couponCode: "TEN" });
        expect(res.statusCode).toBe(500);
        expect(transactions()).toHaveLength(1);
    });
});

const couponUseReads = () => commands().filter((c) => c instanceof GetCommand && String(c.input.Key?.SK).startsWith("COUPONUSE#")) as GetCommand[];

describe("COUPON-FIX-1 B — perCustomerLimit (rule 6, § 6 finding 1)", () => {
    const sha = (email: string) => createHash("sha256").update(email).digest("hex");
    const ONCE = { ...UNLIMITED, perCustomerLimit: 1 };
    const BUYER_SK = `COUPONUSE#cp1#${sha("buyer@example.com")}`;

    it("perCustomerLimit 1: same email twice (second with capitals and spaces) → second not applied; another email applied", async () => {
        mockDb({ [P1]: product(P1) }, ONCE);
        const first = await call({ items: ONE, couponCode: "TEN", customerEmail: "buyer@example.com" });
        expect(JSON.parse(first.body).couponDiscount).toBe(7.5);
        const [use] = couponUseItems(transactions()[0]);
        expect(use.Update!.Key).toEqual({ PK: "TENANT#t1", SK: BUYER_SK });
        expect(use.Update!.ConditionExpression).toBe(PER_CUSTOMER_CONDITION);
        expect(String(use.Update!.Key!.SK)).not.toContain("@");
        expect(couponUseReads().map((c) => c.input)).toEqual([{ TableName: "test-table", Key: { PK: "TENANT#t1", SK: BUYER_SK }, ConsistentRead: true }]);

        ddbSend.mockClear();
        const again = await call({ items: ONE, couponCode: "TEN", customerEmail: "  Buyer@Example.COM " });
        expect(again.statusCode).toBe(201);
        expect(JSON.parse(again.body).couponDiscount).toBe(0);
        expect(couponUseReads()[0].input.Key).toEqual({ PK: "TENANT#t1", SK: BUYER_SK }); // same key: normalized email
        expect(transactions()).toHaveLength(1); // refused at the read, not by a cancelled write
        expect(couponUpdate(transactions()[0])).toBeUndefined();
        expect(couponUseItems(transactions()[0])).toHaveLength(0);
        expect(store.storedCoupon.usageCount).toBe(1); // the refused use did not count

        ddbSend.mockClear();
        const other = await call({ items: ONE, couponCode: "TEN", customerEmail: "other@example.com" });
        expect(JSON.parse(other.body).couponDiscount).toBe(7.5);
        expect(store.couponUses.get(`COUPONUSE#cp1#${sha("other@example.com")}`)).toBe(1);
        expect(store.couponUses.get(BUYER_SK)).toBe(1);
    });

    it("finding 1 regression: counter at the limit; the discounted total → 409 without discount (no order number taken); the returned total → 201 without discount", async () => {
        mockDb({ [P1]: product(P1) }, ONCE);
        store.couponUses.set(BUYER_SK, 1);
        const first = await call({ items: ONE, couponCode: "TEN", expectedTotal: 67.5 });
        expect(first.statusCode).toBe(409);
        expect(JSON.parse(first.body)).toMatchObject({ code: "price-changed", total: 75, couponDiscount: 0 });
        expect(onlyReads()).toBe(true); // no COUNTER#ORDER update: the first request takes no order number

        ddbSend.mockClear();
        const confirm = await call({ items: ONE, couponCode: "TEN", expectedTotal: JSON.parse(first.body).total });
        expect(confirm.statusCode).toBe(201);
        expect(JSON.parse(confirm.body)).toMatchObject({ orderNumber: "PPB-0007", couponDiscount: 0 });
        expect(storedOrder(transactions()[0])).toMatchObject({ total: 75, couponDiscount: 0, couponId: null });
        expect(counterUpdates()).toHaveLength(1);
        expect(store.couponUses.get(BUYER_SK)).toBe(1);
    });

    it("race: the read saw no use, another order wrote it before this transaction → cancelled on the COUPONUSE# item → second pass without the coupon", async () => {
        mockDb({ [P1]: product(P1) }, ONCE);
        store.couponUses.set(BUYER_SK, 1);
        store.staleCouponUseRead = true;
        const res = await call({ items: ONE, couponCode: "TEN" });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).couponDiscount).toBe(0);
        const [cancelled, written] = transactions();
        expect(couponUseItems(cancelled)[0].Update!.Key).toEqual({ PK: "TENANT#t1", SK: BUYER_SK });
        expect(couponUpdate(written)).toBeUndefined();
        expect(couponUseItems(written)).toHaveLength(0);
        expect(store.storedCoupon.usageCount).toBe(0); // the cancelled attempt raised nothing
        expect(store.couponUses.get(BUYER_SK)).toBe(1);
        expect(counterUpdates()).toHaveLength(1);
    });

    it("race with expectedTotal including the discount → second-pass 409 without discount; the order number taken in the first pass stays unused; the cancelled transaction applied nothing", async () => {
        mockDb({ [P1]: product(P1) }, ONCE);
        store.couponUses.set(BUYER_SK, 1);
        store.staleCouponUseRead = true;
        const res = await call({ items: ONE, couponCode: "TEN", expectedTotal: 67.5 });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ code: "price-changed", total: 75, couponDiscount: 0 });
        expect(counterUpdates()).toHaveLength(1);   // the number is taken, then not used
        expect(transactions()).toHaveLength(1);     // the cancelled first attempt only
        expect(store.storedCoupon.usageCount).toBe(0);
        expect(store.couponUses.get(BUYER_SK)).toBe(1);
        expect(sesSend).not.toHaveBeenCalled();
    });

    it("perCustomerLimit 0 → no COUPONUSE# read and no COUPONUSE# item in the transaction (the transaction as before this slice)", async () => {
        mockDb({ [P1]: product(P1) }, { ...UNLIMITED, perCustomerLimit: 0 });
        await call({ items: ONE, couponCode: "TEN" });
        const t = transactions()[0];
        expect(couponUseReads()).toHaveLength(0);
        expect(couponUseItems(t)).toHaveLength(0);
        expect(t.input.TransactItems!.map((i) => String((i.Put?.Item ?? i.Update?.Key)!.SK).split("#")[0]))
            .toEqual(["ORDER", "CUSTORDER", "CUSTOMER", "COUPON"]);
    });
});

describe("COUPON-FIX-1 § 6 — unknown coupon type in the order handler", () => {
    it("a COUPON# record with type \"percent\" → not applied (201, no discount, no COUPON# item), one console.warn naming the coupon id", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mockDb({ [P1]: product(P1) }, { ...UNLIMITED, type: "percent" });
        const res = await call({ items: ONE, couponCode: "TEN" });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).couponDiscount).toBe(0);
        expect(couponUpdate(transactions()[0])).toBeUndefined();
        const calls = warn.mock.calls.filter((c) => String(c[0]).includes("unknown coupon type"));
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toMatchObject({ couponId: "cp1", type: "percent" });
        warn.mockRestore();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// The pre-check `POST /public/coupons/validate` (rule 8; ruling CF1-PRECHECK-LINES = B)
// ---------------------------------------------------------------------------------------------------------------------

const precheckCall = async (body: Record<string, unknown>) => (await (precheck as any)({
    headers: { "x-tenant-id": "t1", origin: "https://t1.test" },
    requestContext: { http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify({ code: "TEN", ...body }),
}, {} as any, () => {})) as any;
const answer = (res: any) => ({ status: res.statusCode, body: JSON.parse(res.body) });
const batchGets = () => commands().filter((c) => c instanceof BatchGetCommand) as BatchGetCommand[];
/** The cart body of CF1-PRECHECK-LINES = B for the TWO cart: A = 3 × 25 = 75, B = 1 × 10 = 10. */
const CART_LINES = [{ productId: P1, quantity: 3, lineTotal: 75 }, { productId: P2, quantity: 1, lineTotal: 10 }];

describe("COUPON-FIX-1 rule 8 — the pre-check uses the shared rule on the cart's lines", () => {
    it("limited to product A; cart A + B → the same discount in the pre-check and in the order handler (7.5, not 8.5)", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableProducts: [P1] });
        const pre = await precheckCall({ subtotal: "85", items: CART_LINES });
        expect(answer(pre)).toEqual({ status: 200, body: { valid: true, discount: 7.5, couponId: "cp1", type: "percentage", value: 10 } });
        await call({ items: TWO, couponCode: "TEN" });
        expect(storedOrder(transactions()[0]).couponDiscount).toBe(JSON.parse(pre.body).discount);
    });
    it("a category-limited coupon is accepted from the cart body: the categories come from the tenant's own product records", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableCategories: ["cat-c"] });
        const res = await precheckCall({ subtotal: "85", items: CART_LINES });
        expect(answer(res).body).toMatchObject({ valid: true, discount: 7.5 });
        expect(batchGets()).toHaveLength(1);
        expect(batchGets()[0].input.RequestItems).toEqual({ "test-table": {
            Keys: [{ PK: "TENANT#t1", SK: `PRODUCT#${P1}` }, { PK: "TENANT#t1", SK: `PRODUCT#${P2}` }],
            ProjectionExpression: "SK, categoryIds",
        } });
    });
    it("a false categoryIds in the request is ignored", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableCategories: ["cat-x"] });
        const items = CART_LINES.map((l) => ({ ...l, categoryIds: ["cat-x"] }));
        const res = await precheckCall({ subtotal: "85", items });
        expect(answer(res).body).toEqual({ valid: false, reason: "Coupon does not apply to any items in cart" });
    });
    it("repeated product ids (two variants of A) → one key per product in the BatchGet, one line per cart line", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableProducts: [P1] });
        const res = await precheckCall({ subtotal: "85", items: [{ productId: P1, quantity: 1, lineTotal: 25 }, { productId: P1, quantity: 2, lineTotal: 50 }, CART_LINES[1]] });
        expect(answer(res).body).toMatchObject({ valid: true, discount: 7.5 });
        expect(batchGets()[0].input.RequestItems!["test-table"].Keys).toHaveLength(2);
    });
    it("old cart body (only productIds): a coupon without limits → the answer as before (10% of the subtotal 85 = 8.5), no BatchGet", async () => {
        mockDb(twoProducts(), UNLIMITED);
        const res = await precheckCall({ subtotal: "85", items: [{ productId: P1 }, { productId: P2 }] });
        expect(answer(res).body).toEqual({ valid: true, discount: 8.5, couponId: "cp1", type: "percentage", value: 10 });
        expect(batchGets()).toHaveLength(0);
    });
    it("old cart body: a limited coupon → valid false with the existing \"does not apply\" reason (even when a productId matches)", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableProducts: [P1] });
        const res = await precheckCall({ subtotal: "85", items: [{ productId: P1 }, { productId: P2 }] });
        expect(answer(res).body).toEqual({ valid: false, reason: "Coupon does not apply to any items in cart" });
    });
    it("more than 50 lines → 400, no product BatchGet", async () => {
        mockDb(twoProducts(), UNLIMITED);
        const items = Array.from({ length: 51 }, () => ({ productId: P1, quantity: 1, lineTotal: 1 }));
        expect(answer(await precheckCall({ subtotal: "51", items }))).toEqual({ status: 400, body: { error: "Too many items" } });
        expect(batchGets()).toHaveLength(0);
        const fifty = Array.from({ length: 50 }, () => ({ productId: P1, quantity: 1, lineTotal: 1 }));
        expect(answer(await precheckCall({ subtotal: "50", items: fifty })).status).toBe(200);
    });
    it("a line with an invalid lineTotal → 400 Invalid items", async () => {
        mockDb(twoProducts(), UNLIMITED);
        const res = await precheckCall({ subtotal: "85", items: [{ productId: P1, quantity: 3, lineTotal: -1 }] });
        expect(answer(res)).toEqual({ status: 400, body: { error: "Invalid items" } });
    });
    it("the per-customer limit is not checked (the customer is unknown): no COUPONUSE# read", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, perCustomerLimit: 1 });
        const res = await precheckCall({ subtotal: "85", items: CART_LINES, customerEmail: "buyer@example.com" });
        expect(answer(res).body).toMatchObject({ valid: true, discount: 8.5 });
        expect(couponUseReads()).toHaveLength(0);
    });
    it("UnprocessedKeys: retried; still unprocessed after 3 retries → 500 Internal error", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, applicableCategories: ["cat-c"] });
        store.unprocessedRounds = 2;
        expect(answer(await precheckCall({ subtotal: "85", items: CART_LINES })).body).toMatchObject({ valid: true, discount: 7.5 });
        ddbSend.mockClear();
        store.unprocessedRounds = 4;
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(answer(await precheckCall({ subtotal: "85", items: CART_LINES }))).toEqual({ status: 500, body: { error: "Internal error" } });
        expect(batchGets()).toHaveLength(4);
        error.mockRestore();
    });
});

describe("COUPON-FIX-1 rule 8 — the union maps to the pre-check's existing reason texts", () => {
    const NOW_ISO = new Date().toISOString();
    for (const [name, coupon, reason] of [
        ["not-active", { status: "disabled" }, "Coupon is not active"],
        ["not-yet-valid", { validFrom: "2999-01-01" }, "Coupon is not yet valid"],
        ["expired", { validUntil: "2000-01-01" }, "Coupon has expired"],
        ["usage-limit", { usageLimit: 1, usageCount: 1 }, "Coupon usage limit reached"],
        ["below-minimum", { minimumOrderAmount: "100" }, "Minimum order amount is 100"],
        ["no-covered-line", { applicableProducts: ["other"] }, "Coupon does not apply to any items in cart"],
    ] as const) {
        it(`${name} → "${reason}"`, async () => {
            mockDb(twoProducts(), { ...UNLIMITED, ...coupon });
            const res = await precheckCall({ subtotal: "85", items: CART_LINES });
            expect(answer(res)).toEqual({ status: 200, body: { valid: false, reason } });
        });
    }
    it("boundary: a coupon valid from now is not refused as not-yet-valid by a later clock", async () => {
        mockDb(twoProducts(), { ...UNLIMITED, validFrom: NOW_ISO });
        expect(answer(await precheckCall({ subtotal: "85", items: CART_LINES })).body.valid).toBe(true);
    });
    it("unknown coupon type → valid false \"Coupon cannot be used\", one console.warn naming the coupon id", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mockDb(twoProducts(), { ...UNLIMITED, type: "fixed" });
        const res = await precheckCall({ subtotal: "85", items: CART_LINES });
        expect(answer(res)).toEqual({ status: 200, body: { valid: false, reason: "Coupon cannot be used" } });
        const calls = warn.mock.calls.filter((c) => String(c[0]).includes("unknown coupon type"));
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toMatchObject({ couponId: "cp1", type: "fixed" });
        warn.mockRestore();
    });
});
