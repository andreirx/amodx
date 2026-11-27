import { vi } from "vitest";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";

/**
 * CMRC-1A, test T1b (docs/slices/cmrc-1a.md § Proofs; docs/slices/cmrc-1.md § 5.9) — the command trace of the twelve
 * handler files that read or write a commerce-private key (`ORDER#`, `CUSTORDER#`, `CUSTOMER#`, `COUNTER#ORDER`).
 *
 * What it is: a recorder and a list of scenarios. A scenario calls ONE real handler with one event. The recorder
 * replaces the modules through which a handler causes an effect, answers each DynamoDB command from the scenario's
 * script, and writes down every effect in the order it happens:
 *
 *   - `dynamodb` — the command class name and its full input (TableName, Key, every expression, names, values, each
 *     TransactItems entry), copied at the moment of the call;
 *   - `audit`    — the parameters of `publishAudit`;
 *   - `mail`     — the input of each SES SendEmailCommand.
 *
 * The scenario's result is that list plus the handler's HTTP answer (status, headers, body as the exact string).
 *
 * Why: requirement C2 says the re-pointing to `lib/commerce-db.ts` changes no command and no answer. The trace of
 * the baseline commit is stored in `fixtures/cmrc-1-command-trace.baseline.json` (the golden);
 * `cmrc-1-command-trace.test.ts` runs the same scenarios on the current code and compares. `cmrc-4` reuses the
 * golden: its only permitted differences are the `TableName` values of the moved kinds (cmrc-1.md § 6).
 *
 * This module imports no handler at load time. The two test files register their `vi.mock` factories (which read the
 * replacement modules exported here), then call `runTrace()`, which imports the handlers. A static handler import
 * here would start a cycle: handler → `db.js` factory → this module, not yet evaluated.
 *
 * Replaced, with the reason:
 *   - `lib/db.js`                    the seam every handler uses; `TABLE_NAME` is "test-table";
 *   - `lib/events.js`                `publishAudit` (EventBridge);
 *   - `@aws-sdk/client-ses`          mail;
 *   - `@aws-sdk/s3-request-presigner` the download link (needs credentials);
 *   - `lib/tenant-verify.js`         the origin check of `orders/create.ts`: it keeps a module-level cache, so its one
 *                                    Query would appear in the first scenario only. Not a commerce-private read; the
 *                                    file is not changed by CMRC-1A. Its Query is NOT in the trace;
 *   - `lib/recaptcha.js`             answers "not configured", as the other order tests do.
 * Real: every handler, `lib/resource-products.js` (its Query is in the trace), the shared rules (`normalizeEmail`,
 * `linePrice`, `evaluateCoupon`, `paymentTransition`), `auth/policy.js`, `lib/order-email.js`.
 *
 * Fixed: the clock (`TRACE_TIME`), `crypto.randomUUID` (a counter, restarted per scenario).
 * No personal data of a real person: every name and address is invented (`example.com`, `*.test`).
 */

// Read at module load by orders/create.ts, orders/update-status.ts, orders/update.ts and resources/presign.ts. This
// module is evaluated before `runTrace()` imports them.
process.env.SES_FROM_EMAIL = "shop@platform.test";
process.env.PRIVATE_BUCKET = "private-test";

export const TRACE_TIME = "2026-11-28T10:00:00.000Z";
export const GOLDEN_FILE = "fixtures/cmrc-1-command-trace.baseline.json";

type Effect =
    | { kind: "dynamodb"; command: string; input: unknown }
    | { kind: "audit"; params: unknown }
    | { kind: "mail"; input: unknown };

/** How one scenario answers the DynamoDB commands. `nth` counts the commands of the same class, from 0. */
type Script = {
    /** GetCommand: the Item per `"<PK>|<SK>"`; a key that is not listed has no Item. */
    items?: Record<string, Record<string, unknown>>;
    query?: (input: any, nth: number) => unknown;
    update?: (input: any, nth: number) => unknown;
    transact?: (input: any, nth: number) => unknown;
    /** Every command fails (a DynamoDB outage): the handler's first command throws. */
    outage?: true;
};

const recorder = {
    effects: [] as Effect[],
    script: {} as Script,
    counts: new Map<string, number>(),
};

function answer(command: string, input: any): unknown {
    const nth = recorder.counts.get(command) ?? 0;
    recorder.counts.set(command, nth + 1);
    const { script } = recorder;
    if (script.outage) throw Object.assign(new Error("Simulated DynamoDB failure"), { name: "InternalServerError" });
    switch (command) {
        case "GetCommand": {
            const item = script.items?.[`${input.Key.PK}|${input.Key.SK}`];
            return item ? { Item: structuredClone(item) } : {};
        }
        case "QueryCommand": return script.query ? script.query(input, nth) : { Items: [] };
        case "UpdateCommand": return script.update ? script.update(input, nth) : {};
        case "TransactWriteCommand": return script.transact ? script.transact(input, nth) : {};
        default: throw new Error(`cmrc-1-command-trace: no answer for ${command}`);
    }
}

// --- The replacement modules (the test files' vi.mock factories return these) ---

export const dbModule = {
    db: {
        send: async (cmd: { constructor: { name: string }; input: unknown }) => {
            const command = cmd.constructor.name;
            // Copied now: a handler may change the same object after the call.
            recorder.effects.push({ kind: "dynamodb", command, input: structuredClone(cmd.input) });
            return answer(command, cmd.input);
        },
    },
    TABLE_NAME: "test-table",
};
export const eventsModule = {
    publishAudit: async (params: unknown) => { recorder.effects.push({ kind: "audit", params: structuredClone(params) }); },
};
export const sesModule = {
    SESClient: class {
        send = async (cmd: { input: unknown }) => { recorder.effects.push({ kind: "mail", input: structuredClone(cmd.input) }); return {}; };
    },
    SendEmailCommand: class { constructor(public input: unknown) {} },
};
export const presignerModule = {
    getSignedUrl: async (_client: unknown, command: { input: { Bucket: string; Key: string } }) =>
        `https://signed.test/${command.input.Bucket}/${command.input.Key}`,
};
export const tenantVerifyModule = { verifyTenantFromOrigin: async () => true };
export const recaptchaModule = {
    resolveRecaptchaConfig: () => null,
    verifyRecaptcha: async () => { throw new Error("cmrc-1-command-trace: reCAPTCHA is not configured in the trace"); },
};

// --- Fixtures (invented data) ---

const T = "t1";
const PK = `TENANT#${T}`;
const key = (sk: string, pk = PK) => `${pk}|${sk}`;
const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";
const ORDER_ID = "0a000000-0000-4000-8000-0000000000aa";
const RESOURCE_ID = "r1";

const TENANT = {
    PK: "SYSTEM", SK: `TENANT#${T}`, id: T, name: "Trace Shop", domain: "t1.test", commerceEnabled: true, currency: "RON",
    integrations: { contactEmail: "owner@t1.test", orderProcessingEmail: "orders@t1.test" },
};
const product = (id: string, price: string) => ({
    PK, SK: `PRODUCT#${id}`, id, title: `Product ${id.slice(-1)}`, price, volumePricing: [], variants: [], personalizations: [],
});
const CATALOG = {
    [key(`TENANT#${T}`, "SYSTEM")]: TENANT,
    [key(`PRODUCT#${P1}`)]: product(P1, "25.00"),
    [key(`PRODUCT#${P2}`)]: product(P2, "10.00"),
};
const COUPON = { PK, SK: "COUPON#cp1", id: "cp1", code: "TEN", status: "active", type: "percentage", value: "10", usageLimit: 0, usageCount: 0 };
const COUPON_ITEMS = { [key("COUPONCODE#TEN")]: { couponId: "cp1" }, [key("COUPON#cp1")]: COUPON };
const ADDRESS = { street: "1 Test Street", city: "Testville", county: "Test County", postalCode: "010101", country: "Romania", notes: "Ring twice" };

const storedOrder = (extra: Record<string, unknown> = {}) => ({
    PK, SK: `ORDER#${ORDER_ID}`, id: ORDER_ID, tenantId: T, orderNumber: "PPB-0042",
    items: [{ productId: P1, productTitle: "Product 1", quantity: 3, unitPrice: "25.00", totalPrice: 75, selectedVariant: null, personalizations: [], imageLink: null }],
    customerEmail: "buyer@example.com", customerName: "Test Buyer", customerPhone: "0700000000",
    shippingAddress: ADDRESS, billingDetails: null, paymentMethod: "bank_transfer", requestedDeliveryDate: null,
    subtotal: 75, shippingCost: 15, couponCode: null, couponId: null, couponDiscount: 0, total: 90, currency: "RON",
    status: "placed", paymentStatus: "pending", internalNotes: "call before delivery",
    statusHistory: [{ status: "placed", timestamp: "2026-11-27T09:00:00.000Z", note: "Order placed" }],
    createdAt: "2026-11-27T09:00:00.000Z", updatedAt: "2026-11-27T09:00:00.000Z", Type: "Order", ...extra,
});
const ORDER_ITEMS = (extra: Record<string, unknown> = {}) => ({ ...CATALOG, [key(`ORDER#${ORDER_ID}`)]: storedOrder(extra) });

const CUSTOMER = {
    PK, SK: "CUSTOMER#buyer@example.com", name: "Test Buyer", phone: "0700000000", defaultAddress: ADDRESS,
    orderCount: 2, totalSpent: 165, loyaltyPoints: 165, lastOrderDate: "2026-11-27T09:00:00.000Z", Type: "Customer",
};
const CUSTORDER_ROWS = [
    { PK, SK: "CUSTORDER#buyer@example.com#o-1", orderNumber: "PPB-0041", total: 75, status: "placed", createdAt: "2026-11-26T09:00:00.000Z", Type: "CustomerOrder" },
    { PK, SK: `CUSTORDER#buyer@example.com#${ORDER_ID}`, orderNumber: "PPB-0042", total: 90, status: "placed", createdAt: "2026-11-27T09:00:00.000Z", Type: "CustomerOrder" },
];
const RESOURCE = { PK, SK: `RESOURCE#${RESOURCE_ID}`, id: RESOURCE_ID, fileName: "guide.pdf", s3Key: `${T}/${RESOURCE_ID}-guide.pdf`, Type: "Resource" };

const conditionFailed = () => Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
const cancelled = (...codes: string[]) => new TransactionCanceledException({
    message: "Transaction cancelled", $metadata: {}, CancellationReasons: codes.map((Code) => ({ Code })),
});

// --- Events ---

type Auth = { sub: string; email?: string; role?: string; tenantId?: string };
const ADMIN: Auth = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: T };
const OTHER_TENANT_ADMIN: Auth = { sub: "u9", email: "admin@t9.test", role: "TENANT_ADMIN", tenantId: "t9" };
const RENDERER: Auth = { sub: "renderer", role: "RENDERER", tenantId: "ALL" };
const SHOPPER: Auth = { sub: "c1", email: "Buyer@Example.com", role: "CUSTOMER", tenantId: T };

function authed(auth: Auth, parts: { path?: Record<string, string>; query?: Record<string, string>; body?: unknown; tenant?: string | null } = {}) {
    return {
        headers: parts.tenant === null ? {} : { "x-tenant-id": parts.tenant ?? T },
        pathParameters: parts.path,
        queryStringParameters: parts.query,
        requestContext: { http: { sourceIp: "203.0.113.7" }, authorizer: { lambda: auth } },
        body: parts.body === undefined ? undefined : JSON.stringify(parts.body),
    };
}
function anonymous(parts: { path?: Record<string, string>; query?: Record<string, string>; body?: unknown; tenant?: string | null } = {}) {
    return {
        headers: parts.tenant === null ? { origin: "https://t1.test" } : { "x-tenant-id": parts.tenant ?? T, origin: "https://t1.test" },
        pathParameters: parts.path,
        queryStringParameters: parts.query,
        requestContext: { http: { sourceIp: "203.0.113.7" } },
        body: parts.body === undefined ? undefined : JSON.stringify(parts.body),
    };
}
const checkout = (body: Record<string, unknown>) =>
    anonymous({ body: { customerEmail: "buyer@example.com", customerName: "Test Buyer", paymentMethod: "cash_on_delivery", ...body } });
const ONE = [{ productId: P1, quantity: 3 }]; // 3 × 25.00 = 75
const TWO = [{ productId: P1, quantity: 3 }, { productId: P2, quantity: 1 }]; // 75 + 10 = 85

// --- Scenarios ---

type HandlerName =
    | "createOrder" | "getOrder" | "listOrders" | "publicGetOrder" | "updateOrderStatus" | "updateOrder"
    | "reportsSummary" | "getCustomer" | "listCustomers" | "updateCustomer" | "publicUpdateCustomer" | "download";

type Scenario = { name: string; handler: HandlerName; event: unknown; script?: Script };

const byId = { path: { id: ORDER_ID } };
const byEmail = { path: { email: encodeURIComponent("Buyer@Example.com") } };
const orderPage = () => ({
    Items: [
        { id: "o-1", orderNumber: "PPB-0041", customerEmail: "other@example.com", customerName: "Other Person", status: "delivered", paymentMethod: "cash_on_delivery", paymentStatus: "paid", total: 75, currency: "RON", createdAt: "2026-11-26T09:00:00.000Z" },
        { id: ORDER_ID, orderNumber: "PPB-0042", customerEmail: "buyer@example.com", customerName: "Test Buyer", status: "placed", paymentMethod: "bank_transfer", paymentStatus: "pending", total: 90, currency: "RON", createdAt: "2026-11-27T09:00:00.000Z" },
    ],
    // The handlers that list read ONE page: a LastEvaluatedKey is answered here to record that no second Query follows.
    LastEvaluatedKey: { PK, SK: `ORDER#${ORDER_ID}` },
});
const reportPage = () => ({
    Items: [
        { id: "o-1", status: "delivered", total: 75, currency: "RON", paymentMethod: "cash_on_delivery", paymentStatus: "paid", items: [{ productId: P1, productTitle: "Product 1", quantity: 3, totalPrice: 75 }], createdAt: "2026-11-28T08:00:00.000Z", couponCode: null, couponDiscount: 0 },
        { id: "o-2", status: "placed", total: "67.50", currency: "RON", paymentMethod: "bank_transfer", paymentStatus: "pending", items: [{ productId: P1, productTitle: "Product 1", quantity: 3, totalPrice: "75.00" }], createdAt: "2026-11-03T08:00:00.000Z", couponCode: "TEN", couponDiscount: 7.5 },
        { id: "o-3", total: 10, items: [{ productId: P2, quantity: 1, totalPrice: 10 }], createdAt: "2026-10-30T08:00:00.000Z" },
    ],
    LastEvaluatedKey: { PK, SK: "ORDER#o-3" },
});
const purchasedRows = (productId: string) => ({ Items: [{ items: [{ productId: "another" }] }, { items: [{ productId }] }] });
/** `resources/presign.ts`: the product Query (lib/resource-products.ts) and the CUSTORDER# Query, told apart by prefix. */
const downloadQueries = (productIds: string[], bought: (nth: number) => unknown) => {
    let custOrderQueries = 0;
    return (input: any) => String(input.ExpressionAttributeValues[":sk"]).startsWith("PRODUCT#")
        ? { Items: productIds.map((id) => ({ id })) }
        : bought(custOrderQueries++);
};

const OUTAGE_EVENTS: readonly (readonly [HandlerName, unknown])[] = [
    ["createOrder", checkout({ items: ONE })],
    ["getOrder", authed(ADMIN, byId)],
    ["listOrders", authed(ADMIN)],
    ["publicGetOrder", anonymous({ ...byId, query: { email: "buyer@example.com" } })],
    ["updateOrderStatus", authed(ADMIN, { ...byId, body: { status: "confirmed" } })],
    ["updateOrder", authed(ADMIN, { ...byId, body: { trackingNumber: "AWB123" } })],
    ["reportsSummary", authed(ADMIN)],
    ["getCustomer", authed(ADMIN, byEmail)],
    ["listCustomers", authed(ADMIN)],
    ["updateCustomer", authed(ADMIN, { ...byEmail, body: { notes: "x" } })],
    ["publicUpdateCustomer", authed(RENDERER, { body: { email: "buyer@example.com" } })],
    ["download", authed(SHOPPER, { path: { id: RESOURCE_ID } })],
];

export const SCENARIOS: readonly Scenario[] = [
    // S1-S4 — POST /public/orders (orders/create.ts)
    { name: "create: no tenant header → 400, no command", handler: "createOrder", event: anonymous({ tenant: null, body: {} }) },
    { name: "create: invalid input → 400, no command", handler: "createOrder", event: checkout({ items: [] }) },
    { name: "create: commerce switched off → 403 after the tenant read", handler: "createOrder", event: checkout({ items: ONE }),
        script: { items: { [key(`TENANT#${T}`, "SYSTEM")]: { ...TENANT, commerceEnabled: false } } } },
    { name: "create: product not found → 400, no write", handler: "createOrder", event: checkout({ items: ONE }),
        script: { items: { [key(`TENANT#${T}`, "SYSTEM")]: TENANT } } },
    { name: "create: no coupon, smallest request, counter answers no value → 201, three transaction items, mails", handler: "createOrder",
        event: checkout({ items: ONE }), script: { items: CATALOG } },
    { name: "create: no coupon, every optional field, delivery cost, expectedTotal equal → 201", handler: "createOrder",
        event: checkout({
            items: TWO, customerEmail: "Buyer@Example.com", customerPhone: "0700000000", customerBirthday: "1990-01-31",
            shippingAddress: ADDRESS, billingDetails: { isCompany: true, companyName: "Test Company SRL", taxId: "RO000000" },
            paymentMethod: "bank_transfer", requestedDeliveryDate: "2026-12-05", expectedTotal: 100,
        }),
        script: {
            items: { ...CATALOG, [key("DELIVERYCONFIG#default")]: { PK, SK: "DELIVERYCONFIG#default", flatShippingCost: 15, freeDeliveryThreshold: 200 } },
            update: (input) => (input.Key.SK === "COUNTER#ORDER" ? { Attributes: { currentValue: 7 } } : {}),
        } },
    { name: "create: expectedTotal differs → 409 before the first write", handler: "createOrder",
        event: checkout({ items: ONE, expectedTotal: 60 }), script: { items: CATALOG } },
    { name: "create: coupon with a per-customer limit → 201, five transaction items", handler: "createOrder",
        event: checkout({ items: ONE, couponCode: "ten" }),
        script: {
            items: {
                ...CATALOG, ...COUPON_ITEMS, [key("COUPON#cp1")]: { ...COUPON, perCustomerLimit: 2 },
                [key(`COUPONUSE#cp1#${createHash("sha256").update("buyer@example.com").digest("hex")}`)]: { count: 1 },
            },
            update: (input) => (input.Key.SK === "COUNTER#ORDER" ? { Attributes: { currentValue: 8 } } : {}),
        } },
    { name: "create: coupon without limits → 201, four transaction items", handler: "createOrder",
        event: checkout({ items: ONE, couponCode: "TEN" }),
        script: { items: { ...CATALOG, ...COUPON_ITEMS }, update: (input) => (input.Key.SK === "COUNTER#ORDER" ? { Attributes: { currentValue: 9 } } : {}) } },
    { name: "create: coupon item cancelled → second pass without the coupon, same order number → 201", handler: "createOrder",
        event: checkout({ items: ONE, couponCode: "TEN" }),
        script: {
            items: { ...CATALOG, ...COUPON_ITEMS },
            update: (input) => (input.Key.SK === "COUNTER#ORDER" ? { Attributes: { currentValue: 10 } } : {}),
            transact: (_input, nth) => { if (nth === 0) throw cancelled("None", "None", "None", "ConditionalCheckFailed"); return {}; },
        } },
    { name: "create: coupon item cancelled, expectedTotal was the discounted total → 409 on the second pass", handler: "createOrder",
        event: checkout({ items: ONE, couponCode: "TEN", expectedTotal: 67.5 }),
        script: {
            items: { ...CATALOG, ...COUPON_ITEMS },
            update: (input) => (input.Key.SK === "COUNTER#ORDER" ? { Attributes: { currentValue: 11 } } : {}),
            transact: () => { throw cancelled("None", "None", "None", "ConditionalCheckFailed"); },
        } },
    { name: "create: the transaction fails for another reason → 500", handler: "createOrder",
        event: checkout({ items: ONE }),
        script: { items: CATALOG, transact: () => { throw Object.assign(new Error("Internal server error"), { name: "InternalServerError" }); } } },
    { name: "create: mail counter at the limit → 201, no mail", handler: "createOrder",
        event: checkout({ items: ONE }),
        script: { items: { ...CATALOG, [key("EMAILLIMIT#buyer@example.com", "SYSTEM")]: { hour: Math.floor(Date.parse(TRACE_TIME) / 3600000), count: 5 } } } },

    // S5 — GET /orders/{id} (orders/get.ts)
    { name: "order get: found → 200", handler: "getOrder", event: authed(ADMIN, byId), script: { items: ORDER_ITEMS() } },
    { name: "order get: absent → 404", handler: "getOrder", event: authed(ADMIN, byId) },
    { name: "order get: admin of another tenant → 403, no command", handler: "getOrder", event: authed(OTHER_TENANT_ADMIN, byId) },
    { name: "order get: no tenant header → 400", handler: "getOrder", event: authed(ADMIN, { ...byId, tenant: null }) },

    // S6 — GET /orders (orders/list.ts)
    { name: "order list: no filter, the answer has a LastEvaluatedKey → 200, one Query", handler: "listOrders",
        event: authed(ADMIN), script: { query: orderPage } },
    { name: "order list: status, dates and search → 200, filter expression", handler: "listOrders",
        event: authed(ADMIN, { query: { status: "placed", dateFrom: "2026-11-01", dateTo: "2026-11-30", search: "BUYER" } }), script: { query: orderPage } },
    { name: "order list: admin of another tenant → 403, no command", handler: "listOrders", event: authed(OTHER_TENANT_ADMIN) },

    // S7 — GET /public/orders/{id}?email= (orders/public-get.ts)
    { name: "public order get: email matches (other letter case) → 200 without internalNotes, PK, SK", handler: "publicGetOrder",
        event: anonymous({ ...byId, query: { email: " Buyer@Example.COM " } }), script: { items: ORDER_ITEMS() } },
    { name: "public order get: email does not match → 404", handler: "publicGetOrder",
        event: anonymous({ ...byId, query: { email: "someone@example.com" } }), script: { items: ORDER_ITEMS() } },
    { name: "public order get: absent → 404", handler: "publicGetOrder", event: anonymous({ ...byId, query: { email: "buyer@example.com" } }) },
    { name: "public order get: no email → 400, no command", handler: "publicGetOrder", event: anonymous(byId) },

    // S8 — PUT /orders/{id}/status (orders/update-status.ts)
    { name: "order status: shipped with a tracking number → 200, audit, mail", handler: "updateOrderStatus",
        event: authed(ADMIN, { ...byId, body: { status: "shipped", trackingNumber: "AWB123", note: "Left the workshop" } }), script: { items: ORDER_ITEMS() } },
    { name: "order status: confirmed, no tracking number, no note → 200, audit, mail", handler: "updateOrderStatus",
        event: authed(ADMIN, { ...byId, body: { status: "confirmed" } }), script: { items: ORDER_ITEMS() } },
    { name: "order status: the status it already has → 200, audit, no mail", handler: "updateOrderStatus",
        event: authed(ADMIN, { ...byId, body: { status: "placed" } }), script: { items: ORDER_ITEMS() } },
    { name: "order status: the stored order has no statusHistory → 200, a history of one entry", handler: "updateOrderStatus",
        event: authed(ADMIN, { ...byId, body: { status: "prepared", note: "Packed" } }), script: { items: ORDER_ITEMS({ statusHistory: undefined }) } },
    { name: "order status: absent → 404, no write", handler: "updateOrderStatus", event: authed(ADMIN, { ...byId, body: { status: "confirmed" } }) },
    { name: "order status: unknown status → 400, no command", handler: "updateOrderStatus", event: authed(ADMIN, { ...byId, body: { status: "lost" } }) },
    { name: "order status: admin of another tenant → 403, no command", handler: "updateOrderStatus",
        event: authed(OTHER_TENANT_ADMIN, { ...byId, body: { status: "confirmed" } }) },

    // S9 — PUT /orders/{id} (orders/update.ts)
    { name: "order patch: three fields → 200, one conditional update", handler: "updateOrder",
        event: authed(ADMIN, { ...byId, body: { trackingNumber: "AWB123", internalNotes: "fragile", estimatedDeliveryDate: "2026-12-05", ignored: "x" } }) },
    { name: "order patch: absent → 404", handler: "updateOrder",
        event: authed(ADMIN, { ...byId, body: { trackingNumber: "AWB123" } }), script: { update: () => { throw conditionFailed(); } } },
    { name: "order patch: no known field → 400, no command", handler: "updateOrder", event: authed(ADMIN, { ...byId, body: { status: "shipped" } }) },
    { name: "order payment: pending → paid with a note → 200, audit, mail", handler: "updateOrder",
        event: authed(ADMIN, { ...byId, body: { paymentStatus: "paid", note: "Bank statement 12" } }), script: { items: ORDER_ITEMS() } },
    { name: "order payment: no stored state → paid → 200, condition attribute_not_exists", handler: "updateOrder",
        event: authed(ADMIN, { ...byId, body: { paymentStatus: "paid" } }), script: { items: ORDER_ITEMS({ paymentStatus: undefined }) } },
    { name: "order payment: paid → refunded → 200, audit, no mail", handler: "updateOrder",
        event: authed(ADMIN, { ...byId, body: { paymentStatus: "refunded" } }), script: { items: ORDER_ITEMS({ paymentStatus: "paid" }) } },
    { name: "order payment: pending → refunded → 409, no write", handler: "updateOrder",
        event: authed(ADMIN, { ...byId, body: { paymentStatus: "refunded" } }), script: { items: ORDER_ITEMS() } },
    { name: "order payment: paid → paid → 200, no write", handler: "updateOrder",
        event: authed(ADMIN, { ...byId, body: { paymentStatus: "paid" } }), script: { items: ORDER_ITEMS({ paymentStatus: "paid" }) } },
    { name: "order payment: stored state outside the enum → 409, no write", handler: "updateOrder",
        event: authed(ADMIN, { ...byId, body: { paymentStatus: "paid" } }), script: { items: ORDER_ITEMS({ paymentStatus: "partial" }) } },
    { name: "order payment: absent → 404", handler: "updateOrder", event: authed(ADMIN, { ...byId, body: { paymentStatus: "paid" } }) },
    { name: "order payment: the state changed between read and write → 409", handler: "updateOrder",
        event: authed(ADMIN, { ...byId, body: { paymentStatus: "paid" } }), script: { items: ORDER_ITEMS(), update: () => { throw conditionFailed(); } } },
    { name: "order payment: another field in the same request → 400, no command", handler: "updateOrder",
        event: authed(ADMIN, { ...byId, body: { paymentStatus: "paid", trackingNumber: "AWB123" } }) },

    // S10 — GET /reports/summary (reports/summary.ts)
    { name: "reports: three orders, the answer has a LastEvaluatedKey → 200, one Query", handler: "reportsSummary", event: authed(ADMIN), script: { query: reportPage } },
    { name: "reports: no order → 200", handler: "reportsSummary", event: authed(ADMIN) },
    { name: "reports: admin of another tenant → 403, no command", handler: "reportsSummary", event: authed(OTHER_TENANT_ADMIN) },

    // S11 — GET /customers/{email} (customers/get.ts)
    { name: "customer get: found → 200, GetItem then Query", handler: "getCustomer", event: authed(ADMIN, byEmail),
        script: { items: { [key("CUSTOMER#buyer@example.com")]: CUSTOMER }, query: () => ({ Items: structuredClone(CUSTORDER_ROWS), LastEvaluatedKey: { PK, SK: CUSTORDER_ROWS[1].SK } }) } },
    { name: "customer get: absent → 404, no Query", handler: "getCustomer", event: authed(ADMIN, byEmail) },
    { name: "customer get: admin of another tenant → 500 (the role refusal is not caught as 403)", handler: "getCustomer", event: authed(OTHER_TENANT_ADMIN, byEmail) },

    // S12 — GET /customers (customers/list.ts)
    { name: "customer list: three customers, one without an order date → 200, newest order first", handler: "listCustomers", event: authed(ADMIN),
        script: { query: () => ({ Items: [{ name: "No Order Yet" }, { name: "Older", lastOrderDate: "2026-11-01T09:00:00.000Z" }, { name: "Test Buyer", lastOrderDate: "2026-11-27T09:00:00.000Z" }], LastEvaluatedKey: { PK, SK: "CUSTOMER#x@example.com" } }) } },
    { name: "customer list: admin of another tenant → 500 (the role refusal is not caught as 403)", handler: "listCustomers", event: authed(OTHER_TENANT_ADMIN) },

    // S13 — PUT /customers/{email} (customers/update.ts)
    { name: "customer note: found → 200", handler: "updateCustomer", event: authed(ADMIN, { ...byEmail, body: { notes: "Prefers phone calls" } }),
        script: { update: () => ({ Attributes: { ...CUSTOMER, notes: "Prefers phone calls", updatedAt: TRACE_TIME } }) } },
    { name: "customer note: no notes field → 200, empty text stored", handler: "updateCustomer", event: authed(ADMIN, { ...byEmail, body: {} }),
        script: { update: () => ({ Attributes: { ...CUSTOMER, notes: "", updatedAt: TRACE_TIME } }) } },
    { name: "customer note: absent → 404", handler: "updateCustomer", event: authed(ADMIN, { ...byEmail, body: { notes: "x" } }),
        script: { update: () => { throw conditionFailed(); } } },
    { name: "customer note: admin of another tenant → 403, no command", handler: "updateCustomer", event: authed(OTHER_TENANT_ADMIN, { ...byEmail, body: { notes: "x" } }) },
    { name: "customer note: no body → 400", handler: "updateCustomer", event: authed(ADMIN, byEmail) },

    // S14 — POST /public/customers/profile (customers/public-update.ts)
    { name: "profile update: customer present, four fields → 200", handler: "publicUpdateCustomer",
        event: authed(RENDERER, { body: { email: " Buyer@Example.com", phone: "0711111111", birthday: "1990-01-31", defaultAddress: ADDRESS, defaultBillingDetails: { isCompany: false } } }),
        script: { items: { [key("CUSTOMER#buyer@example.com")]: {} }, update: () => ({ Attributes: { ...CUSTOMER, phone: "0711111111", birthday: "1990-01-31", updatedAt: TRACE_TIME } }) } },
    { name: "profile update: customer present, fields cleared → 200, empty phone and null values", handler: "publicUpdateCustomer",
        event: authed(RENDERER, { body: { email: "buyer@example.com", phone: "", birthday: "", defaultAddress: null, defaultBillingDetails: null } }),
        script: { items: { [key("CUSTOMER#buyer@example.com")]: { email: "buyer@example.com" } }, update: () => ({ Attributes: { ...CUSTOMER, phone: "", birthday: null, defaultAddress: null } }) } },
    { name: "profile update: customer present, no field → 200, only updatedAt", handler: "publicUpdateCustomer",
        event: authed(RENDERER, { body: { email: "buyer@example.com" } }), script: { items: { [key("CUSTOMER#buyer@example.com")]: {} } } },
    { name: "profile update: customer absent → 404, no write", handler: "publicUpdateCustomer", event: authed(RENDERER, { body: { email: "buyer@example.com", phone: "0711111111" } }) },
    { name: "profile update: tenant admin → 403, no command", handler: "publicUpdateCustomer", event: authed(ADMIN, { body: { email: "buyer@example.com" } }) },
    { name: "profile update: no email → 400", handler: "publicUpdateCustomer", event: authed(RENDERER, { body: { phone: "0711111111" } }) },
    { name: "profile update: email without a domain → 400", handler: "publicUpdateCustomer", event: authed(RENDERER, { body: { email: "not-an-address" } }) },
    { name: "profile update: birthday in another format → 400", handler: "publicUpdateCustomer", event: authed(RENDERER, { body: { email: "buyer@example.com", birthday: "31.01.1990" } }) },

    // S15 — GET /resources/{id}/download (resources/presign.ts, downloadHandler)
    { name: "download: customer, a CUSTORDER# row lists the product → 200", handler: "download", event: authed(SHOPPER, { path: { id: RESOURCE_ID } }),
        script: { items: { [key(`RESOURCE#${RESOURCE_ID}`)]: RESOURCE }, query: downloadQueries([P1], () => purchasedRows(P1)) } },
    { name: "download: customer, the rows hold no items (today's stored shape) → 403", handler: "download", event: authed(SHOPPER, { path: { id: RESOURCE_ID } }),
        script: { items: { [key(`RESOURCE#${RESOURCE_ID}`)]: RESOURCE }, query: downloadQueries([P1], () => ({ Items: structuredClone(CUSTORDER_ROWS) })) } },
    { name: "download: customer, two products, the second is bought → 200, two CUSTORDER# queries", handler: "download", event: authed(SHOPPER, { path: { id: RESOURCE_ID } }),
        script: { items: { [key(`RESOURCE#${RESOURCE_ID}`)]: RESOURCE }, query: downloadQueries([P1, P2], (nth) => (nth === 0 ? {} : purchasedRows(P2))) } },
    { name: "download: caller without an email → 403, no CUSTORDER# query", handler: "download", event: authed({ sub: "c2", role: "CUSTOMER", tenantId: T }, { path: { id: RESOURCE_ID } }),
        script: { items: { [key(`RESOURCE#${RESOURCE_ID}`)]: RESOURCE }, query: downloadQueries([P1], () => purchasedRows(P1)) } },
    { name: "download: resource linked to no product → 403", handler: "download", event: authed(SHOPPER, { path: { id: RESOURCE_ID } }),
        script: { items: { [key(`RESOURCE#${RESOURCE_ID}`)]: RESOURCE }, query: downloadQueries([], () => ({})) } },
    { name: "download: tenant admin → 200, no purchase check", handler: "download", event: authed(ADMIN, { path: { id: RESOURCE_ID } }),
        script: { items: { [key(`RESOURCE#${RESOURCE_ID}`)]: RESOURCE } } },
    { name: "download: resource absent → 404", handler: "download", event: authed(SHOPPER, { path: { id: RESOURCE_ID } }) },

    // Every handler: DynamoDB fails at the first command → the handler's 500 answer.
    ...OUTAGE_EVENTS.map(([handler, event]): Scenario => ({ name: `outage: ${handler} → 500 at its first command`, handler, event, script: { outage: true } })),
];

// --- The run ---

/** Object keys sorted, arrays in order, `undefined` written out (JSON would drop it). The golden file is this form. */
export function canonical(value: unknown): unknown {
    if (value === undefined) return "<undefined>";
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(canonical);
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((k) => [k, canonical(record[k])]));
}
export const serialize = (trace: unknown) => JSON.stringify(canonical(trace), null, 2) + "\n";

async function loadHandlers(): Promise<Record<HandlerName, (event: any, context: any, callback: any) => Promise<unknown>>> {
    return {
        createOrder: (await import("../../src/orders/create.js")).handler,
        getOrder: (await import("../../src/orders/get.js")).handler,
        listOrders: (await import("../../src/orders/list.js")).handler,
        publicGetOrder: (await import("../../src/orders/public-get.js")).handler,
        updateOrderStatus: (await import("../../src/orders/update-status.js")).handler,
        updateOrder: (await import("../../src/orders/update.js")).handler,
        reportsSummary: (await import("../../src/reports/summary.js")).handler,
        getCustomer: (await import("../../src/customers/get.js")).handler,
        listCustomers: (await import("../../src/customers/list.js")).handler,
        updateCustomer: (await import("../../src/customers/update.js")).handler,
        publicUpdateCustomer: (await import("../../src/customers/public-update.js")).handler,
        download: (await import("../../src/resources/presign.js")).downloadHandler,
    } as any;
}

export type ScenarioTrace = { handler: HandlerName; effects: Effect[]; answer: unknown };

/** Runs every scenario on the handlers the caller's `vi.mock` set-up resolves; returns `{ traceTime, scenarios }`. */
export async function runTrace(): Promise<{ traceTime: string; scenarios: Record<string, ScenarioTrace> }> {
    const handlers = await loadHandlers();
    const scenarios: Record<string, ScenarioTrace> = {};
    const quiet = (["log", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
        for (const scenario of SCENARIOS) {
            if (scenarios[scenario.name]) throw new Error(`cmrc-1-command-trace: two scenarios are named "${scenario.name}"`);
            vi.setSystemTime(new Date(TRACE_TIME));
            let n = 0;
            const uuid = vi.spyOn(globalThis.crypto, "randomUUID")
                .mockImplementation(() => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}` as ReturnType<typeof crypto.randomUUID>);
            recorder.effects = [];
            recorder.script = scenario.script ?? {};
            recorder.counts = new Map();
            let answerOfHandler: unknown;
            try {
                answerOfHandler = await handlers[scenario.handler](structuredClone(scenario.event), {}, () => {});
            } catch (e) {
                answerOfHandler = { threw: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
            }
            uuid.mockRestore();
            scenarios[scenario.name] = { handler: scenario.handler, effects: recorder.effects, answer: answerOfHandler };
        }
    } finally {
        vi.useRealTimers();
        quiet.forEach((spy) => spy.mockRestore());
    }
    return { traceTime: TRACE_TIME, scenarios };
}
