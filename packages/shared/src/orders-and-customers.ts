// Orders and customers: the stored order and customer records, the customer self-service read DTOs (CMRC-1B), the
// public checkout input and the price-changed answer.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

// --- ORDERS & CUSTOMERS ---

export const ShippingAddressSchema = z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    county: z.string().min(1),
    postalCode: z.string().default(""),
    country: z.string().default("Romania"),
    notes: z.string().default(""),
});
export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;

// Billing details for B2B / company orders (invoicing)
// Generic field names - labels are customized per tenant via commerceStrings
export const BillingDetailsSchema = z.object({
    // Individual name split for invoicing
    firstName: z.string().default(""),
    lastName: z.string().default(""),
    // Company fields (optional - for B2B)
    isCompany: z.boolean().default(false),
    companyName: z.string().default(""),
    taxId: z.string().default(""),              // Generic: CUI/CIF (RO), EIN (US), Company Number (UK), etc.
    vatNumber: z.string().default(""),          // Generic: VAT/TVA number (RO prefix for EU)
    registrationNumber: z.string().default(""), // Generic: Trade Register (RO J-number), Company House Number (UK), etc.
    // Billing address (can differ from shipping)
    useSameAsShipping: z.boolean().default(true),
    billingStreet: z.string().default(""),
    billingCity: z.string().default(""),
    billingCounty: z.string().default(""),
    billingPostalCode: z.string().default(""),
    billingCountry: z.string().default(""),
});
export type BillingDetails = z.infer<typeof BillingDetailsSchema>;

export const OrderItemSchema = z.object({
    productId: z.string(),
    productTitle: z.string(),
    productImage: z.string().default(""),
    productSlug: z.string().default(""),
    quantity: z.number().int().min(1),
    unitPrice: z.string(),
    totalPrice: z.string(),
    personalizations: z.array(z.object({
        label: z.string(),
        value: z.string(),
        addedCost: z.string().default("0"),
    })).default([]),
    selectedVariant: z.string().optional(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const StatusHistorySchema = z.object({
    status: z.string(),
    timestamp: z.string(),
    note: z.string().default(""),
});

/** PAY-1: an order's payment state. Set to `pending` at creation; after that changed only by `orders/update.ts` through `paymentTransition`. */
export const PaymentStatusSchema = z.enum(["pending", "paid", "refunded"]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const OrderSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    orderNumber: z.string(),
    customerEmail: z.string().email(),
    customerName: z.string().min(1),
    customerPhone: z.string().default(""),
    shippingAddress: ShippingAddressSchema,
    billingDetails: BillingDetailsSchema.optional(), // B2B / company invoice details
    items: z.array(OrderItemSchema).min(1),
    subtotal: z.string(),
    shippingCost: z.string().default("0"),
    discount: z.string().default("0"),
    total: z.string(),
    currency: z.string().default("USD"),
    couponCode: z.string().optional(),
    couponDiscount: z.string().default("0"),
    paymentMethod: z.enum(["cash_on_delivery", "bank_transfer"]).default("cash_on_delivery"),
    paymentStatus: PaymentStatusSchema.default("pending"),
    requestedDeliveryDate: z.string().optional(),
    estimatedDeliveryDate: z.string().optional(),
    trackingNumber: z.string().optional(),
    status: z.enum(["placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled"]).default("placed"),
    statusHistory: z.array(StatusHistorySchema).default([]),
    internalNotes: z.string().default(""),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

export const CustomerSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    email: z.string().email(),
    name: z.string().min(1),
    phone: z.string().default(""),
    birthday: z.string().optional(),           // YYYY-MM-DD format for birthday vouchers
    loyaltyPoints: z.number().default(0),      // Accumulated points from orders
    orderCount: z.number().default(0),
    totalSpent: z.string().default("0"),
    lastOrderDate: z.string().optional(),
    defaultAddress: ShippingAddressSchema.optional(),
    defaultBillingDetails: BillingDetailsSchema.optional(), // Save company details for repeat orders
    notes: z.string().default(""),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Customer = z.infer<typeof CustomerSchema>;

// --- CUSTOMER SELF-SERVICE READS (CMRC-1B; docs/slices/cmrc-1b.md, docs/slices/cmrc-1.md § 5.6) ---
// The data that crosses the renderer → backend boundary of POST /customer/order-history and POST
// /customer/profile-read. The renderer sends the email of the validated session (PD-002); the backend answers the
// stored attributes as they are.

/**
 * The request body of both routes: exactly one field, a non-empty string. A STRUCTURE check only — no format rule and
 * no length bound: the backend applies `normalizeEmail()` and reads; an email that matches no stored record is
 * "nothing found", never an error (the input rule). The renderer always builds this shape, so a body that fails here
 * is a renderer defect.
 */
export const CustomerSelfRequestSchema = z.object({ email: z.string().min(1) }).strict();

/**
 * A stored attribute value exactly as the DynamoDB document client returns it and JSON carries it. The answers below
 * are typed with it ON PURPOSE instead of `OrderSchema` / `CustomerSchema`: those schemas do not describe the stored
 * data (for example `OrderSchema.total` is a string, the order handler stores a number), and the routes pass every
 * value through unchanged (the value rule): no parse, no default, no `null` removed.
 */
export type StoredValue = string | number | boolean | null | StoredValue[] | { [key: string]: StoredValue };

/**
 * One row of the answer `{ orders }` of POST /customer/order-history: one item of the email → order index. A field is
 * absent exactly when the stored item lacks the attribute. `orderId` is the text after the last `#` of the item's
 * sort key.
 */
export type OrderHistoryEntry = {
    orderNumber?: StoredValue;
    total?: StoredValue;
    status?: StoredValue;
    createdAt?: StoredValue;
    orderId: string;
};

/**
 * The answer `{ profile }` of POST /customer/profile-read (`null` when no record is stored): the stored customer item
 * reduced to these five attributes. Each is absent when the item lacks it — a record the checkout created has no
 * `email` attribute, so `{}` is a possible profile.
 */
export type CustomerProfileView = {
    email?: StoredValue;
    name?: StoredValue;
    phone?: StoredValue;
    birthday?: StoredValue;
    defaultAddress?: StoredValue;
};

// --- ORDER INPUT VALIDATION (for public checkout API) ---

export const OrderItemInputSchema = z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
    selectedVariant: z.string().optional(),
    personalizations: z.array(z.object({
        // ORDER-PRICE-1 (§ 1 item 3): optional — a cart saved before ORDER-PRICE-1 holds no `id`; the server then
        // matches the product's personalization by `label`.
        id: z.string().optional(),
        label: z.string(),
        value: z.string().max(500)
    })).optional()
});

export const OrderInputSchema = z.object({
    items: z.array(OrderItemInputSchema).min(1).max(50),
    customerEmail: z.string().email().max(254),
    customerName: z.string().min(1).max(200),
    customerPhone: z.string().max(30).optional(),
    customerBirthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    shippingAddress: ShippingAddressSchema.optional(),
    billingDetails: BillingDetailsSchema.optional(),
    // ORDER-CHECKOUT-1: the values the checkout sends and the tenant setting, the stored order and the admin use.
    paymentMethod: z.enum(["cash_on_delivery", "bank_transfer"]),
    requestedDeliveryDate: z.string().optional(),
    couponCode: z.string().max(50).optional(),
    recaptchaToken: z.string().min(1).optional(), // Optional for backwards compat, enforced in handler when enabled
    // ORDER-CONFIRM-1 (docs/slices/order-confirm-1.md § 1 item 1): the total the Place Order screen showed. A claim the
    // handler compares with its own total (`sameAmountInCents`), never a price it charges. Absent (a page loaded before
    // ORDER-CONFIRM-1) → no comparison. zod 4's `z.number()` refuses NaN and ±Infinity.
    expectedTotal: z.number().min(0).optional(),
});
export type OrderInput = z.infer<typeof OrderInputSchema>;

/** ORDER-CONFIRM-1: the figures the order handler charges for one request item. */
export interface PriceChangedLine {
    productId: string;
    /** As the request sent it; absent when the request had none. */
    selectedVariant?: string;
    quantity: number;
    /** Per unit, added costs included, rounded to cents (the stored order's `unitPrice`, as a number). */
    unitPrice: number;
    /** The line total (the stored order's `totalPrice`). */
    totalPrice: number;
}

/**
 * ORDER-CONFIRM-1 (docs/slices/order-confirm-1.md § 1 item 2, amended by ruling OC1-TEXT = A): the body of the order
 * handler's HTTP 409 answer when the request's `expectedTotal` differs from the handler's total in whole cents. Written
 * by `backend/src/orders/create.ts`, read by `renderer/src/components/CheckoutPageView.tsx` and `CartContext.tsx`. The
 * figures of the request's own items (`items` in request order) and ONE tenant text, `message`; nothing else of the
 * product or the tenant. `total` is rounded to cents; it is the value the checkout sends as `expectedTotal` on the next
 * press.
 */
export interface PriceChangedAnswer {
    code: "price-changed";
    /** English, for logs and API clients. The checkout shows it only when `message` is absent or blank. */
    error: string;
    /**
     * The tenant's text of the commerce key `pricesChanged` (its Labels override; a blank override or none → the
     * language pack of the tenant's locale). A public label the tenant's own site shows. The checkout shows it.
     */
    message: string;
    total: number;
    subtotal: number;
    shippingCost: number;
    couponDiscount: number;
    items: PriceChangedLine[];
}
