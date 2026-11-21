# Commerce Extension

Optional per-tenant module gated by `TenantConfig.commerceEnabled`. Adds physical product catalog, cart, checkout, order management, coupons, reviews, delivery scheduling, customer accounts, email notifications, and reporting. Digital products (Paddle) are a separate path and do not require `commerceEnabled`.

## Architecture

```
Browser (localStorage cart)
    │
    ├─ Product pages ────── SSR (renderer, dynamo.ts queries)
    ├─ Cart page ─────────── Client-side (CartContext)
    ├─ Checkout ──────────── Client POST → /public/orders
    │                              │
    │                        ┌─────┴─────────────────────┐
    │                        │ TransactWriteCommand       │
    │                        │  1. ORDER#                 │
    │                        │  2. CUSTORDER# (adjacency) │
    │                        │  3. CUSTOMER# (upsert)     │
    │                        │  4. COUPON# (usage++)      │
    │                        │  5. COUNTER#ORDER (atomic)  │
    │                        └───────────┬───────────────┘
    │                                    │
    │                              SES (email)
    │                              EventBridge (audit)
    │
    ├─ Order tracking ────── Public GET with email verification
    └─ Customer account ──── NextAuth Google OAuth → order history
```

## Database Key Patterns

All under `PK = TENANT#<tenantId>`.

| Entity | SK Pattern | Notes |
|--------|-----------|-------|
| Product | `PRODUCT#<uuid>` | Full product record |
| Category | `CATEGORY#<uuid>` | Category metadata |
| Category→Product | `CATPROD#<catId>#<prodId>` | Adjacency list. Duplicates price/title/image for fast category listings |
| Order | `ORDER#<uuid>` | Full order with items, addresses, status history |
| Customer→Order | `CUSTORDER#<email>#<orderId>` | Lightweight adjacency (orderNumber, total, status, createdAt) |
| Customer | `CUSTOMER#<email>` | Profile with orderCount, totalSpent, loyaltyPoints, defaultAddress |
| Coupon | `COUPON#<uuid>` | Full coupon definition |
| Coupon Code | `COUPONCODE#<UPPERCASE_CODE>` | Points to couponId. O(1) code lookup via dual-write |
| Coupon Use | `COUPONUSE#<couponId>#<sha256 hex of normalized email>` | Per-customer use `count`; written by the order transaction only when `perCustomerLimit` > 0 (`coupon-fix-1`). Not removed when the coupon is deleted |
| Review | `REVIEW#<productId>#<uuid>` | Individual product review |
| Order Counter | `COUNTER#ORDER` | Atomic counter, format `PPB-XXXX` |
| Delivery Config | `TENANT#<id>` SK `TENANT#<id>` | Stored in TenantConfig (not separate entity) |

**Dual-write consistency**: Orders, coupons, and forms use `TransactWriteCommand` to write multiple items atomically.

## Cart System

**File**: `renderer/src/context/CartContext.tsx`

Client-side only. No server state. CartProvider wraps site layout via `Providers.tsx`.

### Storage

- **Items**: `localStorage.amodx_cart_{tenantId}` → JSON array of `CartItem`
- **Coupon**: `localStorage.amodx_cart_{tenantId}_coupon` → `{ code, discount }`
- Tenant-scoped keys prevent cart cross-contamination in multi-tenant environments

### CartItem Structure

```typescript
interface CartItem {
    productId: string;
    productTitle: string;
    productImage: string;
    productSlug: string;
    quantity: number;
    unitPrice: number;
    currency: string;
    selectedVariant?: string;           // e.g., "Size: Large"
    personalizations: {
        id?: string;                    // the product's personalization id (absent on items saved before order-price-1)
        label: string;
        value: string;
        addedCost: number;              // read by the tenant locale (PRICE-LOCALE-1)
    }[];
    priceInputs?: LinePriceInputs;      // the price texts the shared rule reads, in MACHINE FORM (PRICE-LOCALE-1; absent on old items)
}
```

### Item Uniqueness

Keyed by `productId` + optional `selectedVariant` (format: `{productId}__{variant}`). Same product with different variants = separate cart items.

### Price Calculation

```
lineTotal = linePrice(item.priceInputs, quantity, undefined).lineTotal   // shared rule on machine-form texts, see "Price texts" below
            // an item without priceInputs (saved before order-price-1): (unitPrice + Σ addedCost) × quantity
subtotal  = sum(lineTotal for all items), rounded to cents
shipping  = (freeDeliveryThreshold > 0 && subtotal >= threshold) ? 0 : flatShippingCost
total     = subtotal + shipping - couponDiscount
```

### API

| Method | Behavior |
|--------|----------|
| `addItem(item)` | Merges quantities if product+variant already exists |
| `removeItem(productId, variant?)` | Removes by composite key |
| `updateQuantity(productId, qty, variant?)` | Auto-removes if qty ≤ 0 |
| `clearCart()` | Wipes items + coupon from localStorage |
| `takeServerUnitPrices(lines)` | `order-confirm-1`: after a `price-changed` answer, each item with the same product, variant and quantity as an answer line gets `priceInputs = { price: <server unit price, 2 decimals> }` and `unitPrice` = that number (the server's unit price already holds the added costs). Also an item saved before `order-price-1`, so it never falls back to its old `unitPrice`. The item's volume tiers are not kept |
| `applyCoupon(code, discount)` | Stores coupon state |
| `removeCoupon()` | Clears coupon state |

## Product Pages

### Catalog (Shop/Category Pages)

**SSR** via `renderer/src/lib/dynamo.ts`. Product lists are fetched server-side with `ProjectionExpression` (no full content in list views).

- **Shop page**: `getActiveProducts(tenantId)` → all active, available products
- **Category page**: `getProductsByCategory(tenantId, categoryId)` → CATPROD# adjacency query
- **Availability filtering**: `isProductAvailable()` checks `availableFrom`/`availableUntil` against current date. Products with no dates = always available

### Product Detail Page

Rendered in `page.tsx` (lines ~615-874). Sections:

1. **Breadcrumbs**: Home → Shop → Product Title
2. **Image Gallery**: `ProductImageGallery` — main image + thumbnails for additional images
3. **Price Display**: Sale price (red) + strikethrough original, or single price. Volume pricing table if tiers exist
4. **Availability Badge**: Green (In Stock) / Amber (Pre-order) / Red (Out of Stock)
5. **AddToCartButton**: Client component with variant selector dropdowns, personalization inputs (text/textarea/select/checkbox with added costs), quantity picker. Volume pricing auto-applies based on quantity
6. **Digital Products**: "Buy Now" button with `data-product={paymentLinkId}` for Paddle overlay (no cart)
7. **Categories/Tags**: Clickable badges
8. **Description Tabs**: Short description, long description (HTML), ingredients, nutritional values table
9. **Reviews Section**: Average rating + star display, individual reviews with Google/Facebook source badges

**Schema.org JSON-LD** output:
```json
{
    "@type": "Product",
    "name": "...",
    "offers": { "@type": "Offer", "price": "...", "priceCurrency": "...", "availability": "..." },
    "aggregateRating": { "@type": "AggregateRating", "ratingValue": 4.5, "reviewCount": 12 }
}
```

## Cart Page

**File**: `renderer/src/components/CartPageView.tsx`

Two-column layout: items (left 2/3) + summary (right 1/3).

### Item Display
- Image (80x80), title, variant label, personalization details
- Quantity controls (- / number / +), line total, delete button
- Personalization costs shown inline per item

### Coupon Input
- If applied: green badge with code + discount amount + remove button
- If not applied: text input + "Apply" button → validates via `POST /public/coupons/validate`
- Error messages for invalid/expired/minimum-not-met

### Free Delivery Progress Bar
- Shown when `freeDeliveryThreshold > 0 && subtotal < threshold`
- Visual progress bar + "Add X more for free delivery" text

### Minimum Order Enforcement
- Checkout button disabled if `subtotal < minimumOrderAmount`
- Amber warning text shown

## Checkout Flow

**File**: `renderer/src/components/CheckoutPageView.tsx`

### Form Fields

**Contact & Billing:**
- `firstName`, `lastName` (required)
- `customerEmail` (required, type=email)
- `customerPhone` (optional)
- `birthday` (optional, shown if delivery config has `askBirthday=true`)
- `isCompany` checkbox → reveals: `companyName`, `taxId`, `vatNumber`, `registrationNumber`

**Shipping Address:**
- `street`, `city`, `county` (all required)
- `county`: Dropdown populated from country pack's regions list (e.g., Romanian counties)
- `postalCode` (optional)
- `country`: Dropdown shown when `availableCountries.length > 1`
- `notes`: Delivery notes textarea

**Billing Address (optional):**
- `useSameAsShipping` checkbox (default: true)
- If unchecked: separate `billingStreet`, `billingCity`, `billingCounty`, `billingPostalCode`, `billingCountry`

**Payment Method:**
- Radio buttons for enabled methods from `TenantConfig.enabledPaymentMethods`
- Options: `cash_on_delivery`, `bank_transfer`
- Bank transfer: displays IBAN + bank name inline

**Delivery Date Picker:**
- `DeliveryDatePicker` component — inline mini calendar
- Fetches available dates from `GET /public/delivery/dates`
- Month navigation constrained to first/last available month
- Selected date stored as ISO `YYYY-MM-DD`

### Shipping Cost Logic

```javascript
const shippingCost =
    (freeDeliveryThreshold > 0 && subtotal >= freeDeliveryThreshold)
        ? 0
        : flatShippingCost;
```

### API POST Body

```
POST /public/orders
x-tenant-id: <tenantId>

{
    customerName, customerEmail, customerPhone, customerBirthday,
    shippingAddress: { street, city, county, postalCode, country, notes },
    billingDetails: {
        firstName, lastName, isCompany, companyName, taxId,
        vatNumber, registrationNumber, useSameAsShipping,
        billingStreet, billingCity, billingCounty, billingPostalCode, billingCountry
    },
    items: [{
        productId, productTitle, productImage, productSlug,
        quantity, unitPrice, totalPrice,
        personalizations: [{ label, value, addedCost }],
        selectedVariant
    }],
    paymentMethod, currency, couponCode, requestedDeliveryDate,
    expectedTotal          // order-confirm-1: the total the Place Order screen shows, rounded to cents
}
```

### Price confirmation (`order-confirm-1`)

**Shop rule: an order is created only with a total the visitor saw.** The cart is a snapshot in the visitor's
browser, and the checkout page is cached with the delivery figures of its build. When a price, a volume tier, an added
cost, the delivery settings or a coupon changed after the visitor filled the cart, the server's total differs from the
total on the screen. Then the server does not create the order. The checkout shows the server's figures (each line
total, subtotal, shipping, discount, total) and a notice, keeps the cart, and does not go to the confirmation page.
The notice is the shop's own text of the label `pricesChanged` (Admin > Labels > "Checkout - Payment & Submit"; empty
→ the default of the shop's language: English "Prices have changed. Check the new total, then place the order
again.", Romanian in the `ro` pack). The order server reads it from the shop's settings and sends it with the new
figures; the checkout page does not carry it, so the page itself is unchanged.
The visitor checks the new total and presses Place Order again; that press sends the shown total, so one confirmation
is enough when nothing changes again. Honouring the old price is not offered (the server stays the only source of
prices). Record: `docs/slices/order-confirm-1.md`.

- The shown server figures stay while the cart holds the same items and quantities; a change in the cart drops them
  and the figures come from the cart again.
- The cart items take the server's unit prices (`takeServerUnitPrices`), so the cart page shows the same line totals.
  The cart page still computes shipping and the coupon discount from its own cached figures.
- A request without `expectedTotal` (a page loaded before this rule) is handled as before: no comparison.

### Facebook Pixel
- Fires `InitiateCheckout` on submit: `content_ids`, `num_items`, `value`, `currency`
- On success: stores order in `sessionStorage.amodx_last_order` for confirmation page

### Post-Checkout
- Redirects to the confirmation page: `<checkout><checkoutConfirmation>?id=<orderId>&email=<email>` (default
  `/checkout/confirmation?id=…`), with `orderId` from the order answer `{ orderId, orderNumber, couponDiscount }`
  (`order-checkout-1`). The page reads the order with `getOrderForCustomer(tenant, id, email)`; no match shows the
  generic thank-you panel.
- `ConfirmationPageView`: Order details, bank transfer instructions (if applicable), order tracking link

## Order Creation (Backend)

**File**: `backend/src/orders/create.ts`

### Server-Side Validation

1. **Product lookup**: Fetches each product from DB to validate existence
2. **Price validation**: the shared `linePrice` on the STORED product (option `priceOverride` > volume tier >
   `salePrice` > `price`, plus added costs), with the locale of the tenant item (never the request's); ignores every
   client-submitted price. A text that does not parse → 400 `Invalid price for product: <id>` (record
   `docs/slices/order-price-1.md`, `docs/slices/price-locale-1.md`)
3. **Personalization cost**: Re-calculates from product's `personalizations` array by matching `id` or `label`
4. **Delivery zone restrictions**: If `deliveryConfig.restrictDeliveryZones` is true, validates `allowedCountries` and `allowedCounties` (case-insensitive). Returns 400 if address not in allowed zones

### Coupon Validation (Server-Side)

Duplicates validation even if client already validated — never trust client state:

1. Lookup `COUPONCODE#{upperCode}` → get `couponId`
2. Fetch `COUPON#{couponId}`. A `type` outside the schema enum (`isCouponType` false) → the coupon does not apply
   (one `console.warn` with the coupon id); never a 500
3. When `perCustomerLimit` > 0: read the customer's counter `COUPONUSE#…` (consistent read, the tenant's key) and
   pass its `count` to the rule
4. Apply the coupon rule `evaluateCoupon` (shared, `packages/shared/src/coupon.ts`; `coupon-fix-1`) to the order
   lines. Each line is the server's line total in whole cents and the STORED product's `categoryIds`; nothing about
   coverage comes from the request. A coupon that does not apply is not applied (no refusal of its own); the
   `expectedTotal` comparison below tells the visitor.

**The coupon rule (shop behaviour).** Checks in this order; the first that fails is the reason (`not-active`,
`not-yet-valid`, `expired`, `usage-limit`, `customer-limit`, `below-minimum`, `no-covered-line`):

- `status` is `active`;
- `validFrom` / `validUntil` are compared as text with the current time in ISO form; a time equal to either bound is
  inside. A date-only `validUntil` (`2026-11-21`, what the admin date field stores) is therefore already past at
  `2026-11-21T00:00:00.000Z` — the coupon ends at the START of that day (known, not changed by `coupon-fix-1`);
- `usageLimit` > 0 and `usageCount` ≥ `usageLimit` → used up;
- only when the caller gives the customer's use count (the order handler): `perCustomerLimit` > 0 and the count ≥ it
  → `customer-limit`;
- `minimumOrderAmount` is compared with the WHOLE subtotal;
- covered lines: no product and no category limit → every line. Otherwise a line is covered when its product is in
  `applicableProducts` OR one of its categories is in `applicableCategories`. No covered line → the coupon does not
  apply.

Discount, on the sum of the covered lines only, in whole cents: **percentage** → `value` % of it, rounded half up,
then capped by `maximumDiscount` when > 0; **fixed amount** → `value`. Never more than the covered lines' sum.

**Money rule (ruling CF1-MONEY-PRESERVATION = B).** Every coupon money text — `value` of a fixed coupon,
`maximumDiscount`, `minimumOrderAmount` — is read with `parseFloat` and converted to whole cents, rounded half up,
when it is read. A percentage discount is the percent of the covered sum in cents, rounded half up. Every comparison
(minimum, cap, covered sum) is in cents. Compared with the float arithmetic before `coupon-fix-1`, four classes of
outcome change, each by at most one cent or at a third-decimal threshold:

| Class | Witness | Before | Now |
|---|---|---|---|
| percentage tie | 50 % of 0.29 | 0.14 | 0.15 |
| fixed value with a third decimal | `value` `"0.145"` | 0.14 | 0.15 |
| cap with a third decimal | `maximumDiscount` `"0.145"` | 0.14 | 0.15 |
| minimum with a third decimal | subtotal 1.00, `minimumOrderAmount` `"1.004"` | does not apply | applies |

Coupons without limits and with money texts of at most two decimals give the figures they gave before, except the
percentage tie.

**Per-customer limit.** When `perCustomerLimit` > 0, the handler reads the counter item
`COUPONUSE#<couponId>#<sha256 hex of the normalized email>` (consistent read) BEFORE the totals: a counter at the
limit → the coupon does not apply, so the first answer (201, or 409 when `expectedTotal` included the discount) is
already without it and no order number is taken for that 409. When the coupon applies, the order transaction raises
the same item with the condition "absent or `count < perCustomerLimit`" — the authority when two orders race. The key
holds a hash, not the address (no plain address in a new key of the main table; Track B decides the item's final
table). 0 or absent → no read and no counter item. The pre-check does not know the customer
and does not check this limit.

**Losing the race.** The `usageCount` update has the condition `attribute_not_exists(usageLimit) OR usageLimit = :zero
OR attribute_not_exists(usageCount) OR usageCount < usageLimit`, evaluated on the stored item. When the transaction
is cancelled with `ConditionalCheckFailed` on the coupon item or on the counter item, the coupon does not apply: the
handler computes the totals again without it, compares them with `expectedTotal` (409 when they differ) and else
writes the order without the discount. At most one such second pass; any other cancellation is rethrown (500). The
cancelled attempt writes nothing. Its order number (taken before the transaction) is kept for the second pass; when
the second pass answers 409, that number stays unused (a gap in the `PPB-` sequence).

### Total Confirmation (`order-confirm-1`)

After the coupon block: when the request has `expectedTotal` and `sameAmountInCents(expectedTotal, total)` is false,
the handler answers **409**. What was written before that 409 depends on the pass (`coupon-fix-1`):

- **First pass (an initial total mismatch)** — the comparison runs BEFORE any write (the order counter is the first
  write): nothing is written (no counter update, no transaction, no mail).
- **Second pass (the coupon lost a race, see *Losing the race*)** — the order counter was already raised in the first
  pass and the first transaction was cancelled (none of its items applied). The 409 then leaves that order number
  unused (a gap in the `PPB-` sequence); nothing else is written, no mail.

Body: the shared `PriceChangedAnswer` —

```
{ code: "price-changed", error: "Prices have changed. Check the new total, then place the order again.",
  message /* the tenant's pricesChanged text: override, else the pack of its locale; blank → pack */,
  total /* rounded to cents */, subtotal, shippingCost, couponDiscount,
  items: [{ productId, selectedVariant?, quantity, unitPrice /* per unit, added costs included */, totalPrice }] }
```

`items` are the request's items in request order. Besides them, only `message` (a public label of the tenant's own
site; ruling OC1-TEXT = A); nothing else of the product or the tenant. `error` stays English; the checkout shows
`message`, or `error` when `message` is absent or blank. `expectedTotal`
negative or not a number → 400 `Invalid input` (schema). Equal totals → the order is created exactly as without the
field.

### Atomic Order Counter

```javascript
UpdateCommand({
    Key: { PK: `TENANT#${tenantId}`, SK: `COUNTER#ORDER` },
    UpdateExpression: "SET currentValue = if_not_exists(currentValue, :zero) + :one",
    ReturnValues: "UPDATED_NEW"
})
// Format: "PPB-0001", "PPB-0002", ...
```

### TransactWrite (3 to 5 Items)

| # | Key | What |
|---|-----|------|
| 1 | `ORDER#<uuid>` | Full order record: items, addresses, totals, status="placed", paymentStatus="pending", statusHistory=[{status:"placed"}] |
| 2 | `CUSTORDER#<email>#<orderId>` | Lightweight reference: orderNumber, total, status, createdAt |
| 3 | `CUSTOMER#<email>` | Upsert: increment orderCount + totalSpent, add loyalty points (1 per currency unit), update lastOrderDate + defaultAddress. Sets birthday + defaultBillingDetails if provided |
| 4 | `COUPON#<couponId>` | Increment `usageCount` (only if coupon applied), conditional on the stored `usageLimit` / `usageCount` |
| 5 | `COUPONUSE#<couponId>#<sha256(email)>` | Per-customer counter `count` (only if coupon applied and `perCustomerLimit` > 0), conditional |
| — | `COUNTER#ORDER` | Already incremented before TransactWrite (separate UpdateCommand with ReturnValues); not part of the transaction |

### Post-Creation

- Sends email via SES using template for "placed" status
- Publishes audit event to EventBridge

## Order Status Workflow

**File**: `backend/src/orders/update-status.ts`

### Valid Statuses

```
placed → confirmed → prepared → shipped → delivered
                                    └──→ cancelled
                                    └──→ annulled
```

Seven statuses: `placed`, `confirmed`, `prepared`, `shipped`, `delivered`, `cancelled`, `annulled`.

### Status Update Process

1. Auth: requires `EDITOR` or `TENANT_ADMIN` role
2. Fetches existing order (validates it exists, gets current statusHistory)
3. Appends `{ status, timestamp, note }` to `statusHistory` array
4. Updates `status`, `statusHistory`, `updatedAt`
5. Optionally updates `trackingNumber` (if provided in body)
6. Publishes audit event: `previousStatus → newStatus`
7. Sends email if status changed and template exists for new status

## Payment States (`pay-1`)

**Files**: rule `packages/shared/src/payment-transition.ts` (`paymentTransition`); writer `backend/src/orders/update.ts`
(`changePaymentStatus`, the only code that changes an order's `paymentStatus` after creation).

An order is created `paymentStatus: "pending"` (`orders/create.ts`). The payment state is separate from the order status:
the status route does not change it, and it does not change the status.

```
pending → paid → refunded        (refunded is final)
```

| From \ To | pending | paid | refunded |
|---|---|---|---|
| pending (or field absent) | no-op | **apply** | refused: "Only a paid order can be refunded." |
| paid | refused: "A paid order cannot go back to pending." | no-op | **apply** |
| refunded | refused: "A refunded order cannot change its payment state." | refused (same text) | no-op |

**Who changes it**: a user with role `EDITOR` or `TENANT_ADMIN` (or `GLOBAL_ADMIN`) of the tenant, through
`PUT /orders/{id}` with body `{ "paymentStatus": "paid" | "refunded", "note"?: string ≤ 500 }` and no other field. In
the admin: the order page, Payment card, "Mark as paid" (state `pending`, or the field absent) / "Mark as refunded"
(state `paid`), with a confirmation; no button for `refunded` or an invalid stored value. Online payment (`pay-2`) is not built; nothing changes the state automatically.

`PUT /orders/{id}` answers for a request with `paymentStatus`:

| Case | Answer | Effect |
|---|---|---|
| value not `pending`/`paid`/`refunded` | 400 | the order is not read |
| another field than `note`, or `note` not text / > 500 characters | 400 "Send the payment state alone…" / note text | none |
| order not found (or another tenant's id) | 404 | none |
| stored value outside the enum, `null` included (written by the field patch before `pay-1`) | 409 with the stored value | none |
| refused | 409 `{ error: <reason>, paymentStatus: <current> }` | none |
| no-op (same state) | 200 "Payment status unchanged" | none: no write, no audit, no mail |
| apply | 200 "Payment status updated" | one `UpdateCommand` conditional on the state read (`#paymentStatus = :previous`, or `attribute_not_exists` when the field was absent) and `attribute_exists(SK)`; sets `paymentStatus`, `updatedAt` and `paidAt` or `refundedAt` (ISO time) |
| the condition fails (another change between read and write) | 409 "The payment state changed; read the order again." | none: no audit, no mail |

On apply: audit entry `UPDATE_ORDER_PAYMENT` (actor email, title = order number, details `{ previous, next, note }`).
On `pending → paid` only: the `paid` order mail (see Email Templates). No mail on a refund. A mail failure is logged and
does not fail the request. The Lambda `UpdateOrderFunc` has the sender (`SES_FROM_EMAIL`) and `ses:SendEmail` on the
sender identity (`infra/lib/api-commerce.ts`). A request without `paymentStatus` is the field patch of before (tracking number, internal
notes, estimated delivery date), unchanged.

## Email Templates

**File**: `backend/src/lib/order-email.ts`

### Template Structure

```typescript
interface OrderEmailTemplate {
    subject: string;       // "Order {{orderNumber}} – Thank You!"
    body: string;          // HTML with {{variable}} placeholders
    sendToCustomer: boolean;
    sendToAdmin: boolean;
    sendToProcessing: boolean;
}
```

Stored in `TenantConfig.orderEmailConfig.templates` — one template per key. The keys are the 7 statuses and `paid`
(`pay-1`: sent on the payment change `pending → paid`, by `orders/update.ts`; default flags: customer yes, admin no,
processing no). `templates` is an open record: a stored config without the `paid` key uses the default. Admin can
customize via Order Emails page. `getDefaultTemplates()` provides English-language fallbacks for all 8 keys (backend
text, not the tenant's language pack). In the `paid` mail, `{{status}}` is `paid`, `{{statusLabel}}` is `Paid` and
`{{note}}` is the payment note.

### Variable Placeholders

Mustache-style `{{var}}`:

| Variable | Source |
|----------|--------|
| `{{orderNumber}}` | PPB-XXXX format |
| `{{customerName}}` | order.customerName |
| `{{customerEmail}}` | order.customerEmail |
| `{{customerPhone}}` | order.customerPhone |
| `{{status}}` | Raw status string |
| `{{statusLabel}}` | Human-readable status |
| `{{trackingNumber}}` | Tracking ID (for shipped status) |
| `{{items}}` | Preformatted multiline text |
| `{{subtotal}}`, `{{total}}`, `{{shippingCost}}`, `{{couponDiscount}}` | Order amounts |
| `{{currency}}` | e.g., "USD" |
| `{{paymentMethod}}` | e.g., "Bank Transfer" |
| `{{deliveryDate}}` | Requested delivery date |
| `{{shippingAddress}}` | Formatted address string |
| `{{siteName}}` | Tenant display name |
| `{{note}}` | Status change note |

### Recipients

- **Customer**: `order.customerEmail`
- **Admin**: `tenantConfig.integrations.contactEmail`
- **Processing**: `tenantConfig.integrations.orderProcessingEmail`

Admin/processing emails include extra section with full customer details, payment method, shipping address, and delivery notes.

## Delivery Date Calculation

**File**: `backend/src/delivery/available-dates.ts`

### 5-Level Priority Algorithm

```
Priority 1 (highest): unblockedDates  → date is available (override everything)
Priority 2:           blockedDates    → date is blocked
Priority 3:           yearlyOffDays   → date is blocked (recurring MM-DD, e.g., holidays)
Priority 4:           weekday check   → date blocked if not in deliveryDaysOfWeek
Priority 5 (lowest):  default         → date is available
```

### Config Fields

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `deliveryLeadDays` | number | 1 | Business days before first available date |
| `deliveryDaysOfWeek` | number[] | [1,2,3,4,5] | Mon=1..Sun=0 |
| `blockedDates` | string[] | [] | `"YYYY-MM-DD"` specific dates |
| `yearlyOffDays` | string[] | [] | `"MM-DD"` recurring annually |
| `unblockedDates` | string[] | [] | `"YYYY-MM-DD"` emergency overrides |

### Lead Days Logic

Starts from tomorrow. Walks forward, counting only **available** days (weekends/holidays skipped during lead day counting). After N available lead days pass, starts collecting up to 30 available dates.

Uses manual `toDateStr()` instead of `toISOString()` to avoid Lambda UTC timezone issues.

### Response

```json
{ "dates": ["2026-03-15", "2026-03-16", "2026-03-18", ...] }
```

Cached: `Cache-Control: public, max-age=3600` (1 hour).

## Coupon System

### Schema (Shared)

```typescript
CouponSchema = {
    id, tenantId, code (uppercase),
    type: "percentage" | "fixed_amount",
    value: number,
    minimumOrderAmount: number,
    maximumDiscount: number,        // cap for percentage type
    usageLimit: number,             // 0 = unlimited
    usageCount: number,             // atomic increment
    validFrom: string,              // ISO date
    validUntil: string,             // ISO date
    status: "active" | "expired" | "disabled",
    applicableCategories: string[], // empty = all
    applicableProducts: string[],   // empty = all
}
```

### Dual-Write

`TransactWriteCommand` writes both `COUPON#<uuid>` (full record) and `COUPONCODE#<UPPERCASE_CODE>` (lookup pointer with `couponId` field).

### Public Validation (`POST /public/coupons/validate`)

Request (`coupon-fix-1`, ruling CF1-PRECHECK-LINES = B):
`{ code, subtotal, items: [{ productId, quantity, lineTotal }], recaptchaToken }` — `lineTotal` is the line total the
cart shows (shared `CouponPrecheckItemSchema`; other fields such as `categoryIds` are dropped).

Validation steps:
1. Uppercase code → lookup `COUPONCODE#`
2. Fetch `COUPON#` record; a `type` outside the schema enum → `{ valid: false, reason: "Coupon cannot be used" }`
   and one `console.warn` with the coupon id
3. Lines: more than 50 → 400 `Too many items`; a line that does not parse → 400 `Invalid items`. The categories of
   each product come from the tenant's own `PRODUCT#` records (one `BatchGet`, projection `SK, categoryIds`,
   `UnprocessedKeys` retried at most 3 times, then 500). An old cart body (no `lineTotal` on any item) is one line
   holding the whole `subtotal` with no product and no category: a coupon without limits gets the answer it got
   before; a limited coupon gets `valid: false` "Coupon does not apply to any items in cart"
4. The shared rule `evaluateCoupon` without a customer count (the per-customer limit is not checked here)

Response: `{ valid: true, discount: 15.50, couponId, type, value }` or `{ valid: false, reason: "..." }`. `discount`
is the covered-lines discount. The reasons keep their texts: `not-active` "Coupon is not active", `not-yet-valid`
"Coupon is not yet valid", `expired` "Coupon has expired", `usage-limit` "Coupon usage limit reached", `below-minimum`
"Minimum order amount is <n>", `no-covered-line` "Coupon does not apply to any items in cart" (`customer-limit` is
never produced here).

**Advisory only.** The amounts are the browser's; the order handler prices every line itself and is the authority
(see *Coupon Validation (Server-Side)*). When the cart's discount differs, the checkout gets the 409 with the server's
figures. The cart shows `reason` to the visitor as it comes (English; finding recorded in `coupon-fix-1`).

### Checkout Integration

- Client validates coupon via API → stores in CartContext (localStorage)
- Server re-validates during order creation → increments `usageCount` (and the per-customer counter) in the order
  transaction, each under its own condition

## Product Variants & Personalizations

### Variants

Stored in `product.variants[]`:
```typescript
{
    id: string,
    name: string,           // e.g., "Size"
    options: [{
        value: string,      // e.g., "Small"
        priceOverride?: number,
        imageLink?: string,
        availability?: string
    }]
}
```

Displayed as dropdown selectors in `AddToCartButton`. When variant has `priceOverride`, it replaces the base price.

### Personalizations

Stored in `product.personalizations[]`:
```typescript
{
    id: string,
    label: string,          // e.g., "Engraving Text"
    type: "text" | "textarea" | "select" | "checkbox",
    required: boolean,
    addedCost: number,      // added per unit
    maxLength?: number,
    options?: string[]       // for select type
}
```

Each adds `addedCost` per unit to the line total. Values are captured in the cart item and validated server-side during order creation.

### Volume Pricing

Stored in `product.volumePricing[]`:
```typescript
{ minQuantity: number, price: string }   // price is a money TEXT, read by the tenant locale
```

Sorted ascending by minQuantity. When quantity >= a tier's minQuantity, that tier's price applies. Displayed as a table on the product page.

## Bulk Price Adjustment

**File**: `backend/src/products/bulk-price.ts`

`POST /products/bulk-price` — `TENANT_ADMIN` only.

### Parameters

| Field | Type | Purpose |
|-------|------|---------|
| `categoryId` | string? | Scope to category (all products if omitted) |
| `percent` | number | Change percentage (+10 = increase, -10 = decrease) |
| `roundTo` | 0 \| 5 \| 9 \| 0.99 | Rounding mode |
| `applyToSalePrice` | boolean | Also adjust sale prices |
| `dryRun` | boolean | Preview only, no writes |

### Rounding Modes

| Mode | Example (raw: 42.30) | Logic |
|------|---------------------|-------|
| `0` | 42.30 | No rounding, 2 decimal precision |
| `5` | 45.00 | `Math.ceil(price/5) * 5` |
| `9` | 49.00 | Round up to ending in 9 |
| `0.99` | 42.99 | Round to .99 ending |

Dry run returns preview array: `[{ id, title, oldPrice, newPrice, oldSalePrice?, newSalePrice? }]`. Apply mode updates products and their CATPROD# adjacency entries, publishes audit event.

The old `price` / `salePrice` texts are read by the shared `parseMoney` with the tenant's locale (one `GetCommand` on
`SYSTEM` / `TENANT#<id>`, PRICE-LOCALE-1): on a `ro-RO` tenant `12,50` is 12.5. A text that does not parse is skipped.
The new price is written in machine form (`toFixed(2)`): after a bulk change a comma price `12,50` becomes `13.75`
(+10 %). Volume tier prices and option `priceOverride`s are not changed by a bulk change.

## Price texts and the locale (PRICE-LOCALE-1)

Money on a product (`price`, `salePrice`, tier `price`, option `priceOverride`, personalization `addedCost`) is stored
as free TEXT. One shared parser reads it: `parseMoney(text, locale)` (`packages/shared/src/index.ts`, used by
`linePrice`). Every locale reads machine form (digits and an optional decimal point: `12.50`, `1.250` = 1.25). A locale
whose own number format writes a decimal comma (`Intl.NumberFormat(locale)`, the `decimal` part — `ro-RO`, `de-DE`,
`fr-FR`; not `en-US`, `en-GB`, `de-CH`) also reads a text WITH a comma: comma = decimal separator, points = group
separators in groups of three (`12,50` = 12.5, `1.250,50` = 1250.5). Anything else fails. The locale is the tenant's
`locale` setting: the order handler and the bulk change read it from the tenant item; the product page receives it
from `SitePage` (only for a decimal-comma locale). The cart needs no locale: at add time the button stores the item's
price texts in machine form (`12,50` → `12.50`); a text the line can use that does not parse → the item is not added.
The category showcase card gets its range from the server pass for a decimal-comma tenant's product with a comma text;
other products keep the card's `parseFloat` reading (recorded debt F-PL1-9). A stored text is still shown as stored;
computed totals keep their format (`50.00`). Record: `docs/slices/price-locale-1.md`.

## WooCommerce Import

**File**: `backend/src/import/woocommerce.ts`

`POST /import/woocommerce` — `TENANT_ADMIN` only. 3GB memory, 15min timeout.

### CSV Parsing

- Strips UTF-8 BOM, handles quoted fields with escaped quotes
- 46 Romanian→English column mappings (e.g., "Preț obișnuit" → "Regular price")
- Auto-detects weight unit from header: `(g)` vs `(kg)`

### Two-Pass Variable Product Strategy

**Pass 1**: Separate parents and variations
- Build `wooIdToSlug` map from WooCommerce IDs
- Parents (simple/variable) → `parents` array
- Variations → grouped by parent reference

**Pass 2**: Process parents + merge variations
- Generate slug from title, check for existing product by slug (update if found)
- Parse `"Parent > Child"` category format, auto-create categories if missing
- Extract attributes from "Attribute N" columns
- Merge variations into `variants[]` with per-option price/image/availability overrides
- Rewrite media URLs via `loadMediaMap(tenantId)` (maps old WooCommerce URLs to S3 URLs)

### Response

```json
{
    "imported": 50,
    "updated": 10,
    "skipped": 5,
    "drafts": 3,
    "categoriesCreated": 8,
    "errors": ["Row 'Product X': Invalid price"]
}
```

## Customer Accounts

### Authentication

NextAuth.js 4 with per-tenant Google OAuth. Client ID/secret stored in `TenantConfig.integrations.googleClientId` / `googleClientSecret`. Public Cognito pool handles self-signup.

### Account Page (`AccountPageView.tsx`)

- **Profile card**: Name, email, phone, birthday, loyalty points, default address. Edit mode for phone + birthday
- **Order history table**: Order #, date, status badge (color-coded), total. Click → order tracking page
- Profile updates via `/api/profile` proxy (validates NextAuth session server-side)

### Loyalty Points

Calculated during order creation: `Math.floor(order.total)` = points earned. Stored in `CUSTOMER#<email>.loyaltyPoints`. Currently display-only (no redemption system).

## Commerce Bar

**File**: `renderer/src/components/CommerceBar.tsx`

Sticky top bar, hidden on mobile (`hidden md:flex`). Sits above Navbar in the sticky wrapper.

| Left | Right |
|------|-------|
| Phone (`tel:` link) + WhatsApp icon | Social icons + Account/Sign In + Cart widget + CTA button |

Social icons: Facebook, Instagram, TikTok, YouTube, Twitter/X, LinkedIn, Pinterest — inline SVG paths.

Cart widget shows icon + item count badge + subtotal (when `showTotal` enabled).

CTA button: configurable text + URL, colored with primary color.

## URL Prefixes

Configurable per tenant via Settings > URL Prefixes. Defaults in `URL_PREFIX_DEFAULTS` (shared):

| Prefix | Default | Purpose |
|--------|---------|---------|
| `product` | `/product` | Product detail pages |
| `category` | `/category` | Category listing pages |
| `cart` | `/cart` | Cart page |
| `checkout` | `/checkout` | Checkout + confirmation + tracking |
| `shop` | `/shop` | Shop listing page |

`matchCommercePrefix()` in the renderer matches incoming slugs against tenant's configured prefixes. Also handles `account` type for customer account pages.

Slug conflict validation: `reservedAddressRefusal()` in `backend/src/lib/slug-guard.ts` refuses a content slug that equals, or lies under, the address of a built-in page the renderer serves for the tenant's kind of site (cart, checkout, shop, product, category, account, search; the interest list on a catalog site). It returns the refusal text, or null if the slug is free.

## Reports

**File**: `backend/src/reports/summary.ts`

`GET /reports/summary` — requires `EDITOR` or `TENANT_ADMIN`.

Queries all `ORDER#` records with projection, aggregates into:

### KPIs

| Metric | Calculation |
|--------|-------------|
| `totalRevenue` | Sum of all order totals |
| `totalOrders` | Count of all orders |
| `avgOrderValue` | totalRevenue / totalOrders |
| `deliveredRevenue` | Sum of delivered order totals |
| `todayRevenue` / `todayOrders` | Today's orders |
| `monthRevenue` / `monthOrders` | Current month's orders |

### Breakdowns

- **By status**: `{ [status]: { count, revenue } }` — all 7 statuses
- **By payment method**: `{ [method]: { count, revenue } }`
- **By month** (last 12): `[{ month: "2026-02", count, revenue }]`
- **Top products** (top 10 by revenue): `[{ id, title, quantity, revenue }]`
- **Coupon usage**: `{ orders: count, discount: totalDiscount }`

## Admin Pages (14)

| Page | Route | Purpose |
|------|-------|---------|
| `Products.tsx` | `/products` | List, filter by status/category, bulk price adjustment, CSV import |
| `ProductEditor.tsx` | `/products/:id` | 8-tab editor (Basic, Pricing, Variants, Personalization, Details, Categories, Media, SEO) |
| `Categories.tsx` | `/categories` | List with parent/child tree, product counts |
| `CategoryEditor.tsx` | `/categories/:id` | Name, slug, parent, image, SEO, sort order |
| `Orders.tsx` | `/orders` | List with status/search filters |
| `OrderDetail.tsx` | `/orders/:id` | Items, totals, customer card, status management, tracking, status history timeline |
| `Customers.tsx` | `/customers` | List with search, order count, total spent |
| `CustomerDetail.tsx` | `/customers/:email` | Profile, order history, company details |
| `Coupons.tsx` | `/coupons` | List with status filter, usage counts |
| `CouponEditor.tsx` | `/coupons/:id` | Code, type, value, limits, date range, scope (categories/products) |
| `Reviews.tsx` | `/reviews` | List with moderation (approve/reject/delete), source badges |
| `DeliverySettings.tsx` | `/delivery` | Costs, zones, schedule, visual 2-month calendar customizer |
| `OrderEmails.tsx` | `/order-emails` | Per-status template editor with variable suggestions |
| `Reports.tsx` | `/reports` | 7 KPI cards + 4 data tables (by-status, by-payment, by-month, top products) |

## CDK Registration

Commerce routes live in `infra/lib/api-commerce.ts` (NestedStack, ~234 resources). Uses L1 `CfnRoute`/`CfnIntegration` constructs.

### API Endpoints

**Public (no auth):**

| Method | Path | Handler |
|--------|------|---------|
| GET | `/public/products` | products/public-list |
| GET | `/public/products/{id}` | products/public-get |
| GET | `/public/categories` | categories/public-list |
| GET | `/public/categories/{slug}` | categories/public-get |
| POST | `/public/orders` | orders/create |
| GET | `/public/orders/{id}` | orders/public-get |
| POST | `/public/coupons/validate` | coupons/public-validate |
| GET | `/public/delivery/dates` | delivery/available-dates |
| GET | `/public/reviews/{productId}` | reviews/public-list |

**Authenticated (admin):**

| Method | Path | Handler |
|--------|------|---------|
| GET/POST | `/products` | products/list, products/create |
| GET/PUT/DELETE | `/products/{id}` | products/get, update, delete |
| POST | `/products/bulk-price` | products/bulk-price |
| GET/POST | `/categories` | categories/list, create |
| GET/PUT/DELETE | `/categories/{id}` | categories/get, update, delete |
| PUT | `/categories/{id}/products` | categories/catprod |
| GET | `/orders` | orders/list |
| GET | `/orders/{id}` | orders/get |
| PUT | `/orders/{id}` | orders/update (field patch; with `paymentStatus`: the payment transition, see Payment States) |
| PUT | `/orders/{id}/status` | orders/update-status |
| GET | `/customers` | customers/list |
| GET/PUT | `/customers/{email}` | customers/get, update |
| GET/PUT | `/delivery` | delivery/get, update |
| GET/POST | `/coupons` | coupons/list, create |
| GET/PUT/DELETE | `/coupons/{id}` | coupons/get, update, delete |
| GET/POST | `/reviews` | reviews/list, create |
| PUT/DELETE | `/reviews/{id}` | reviews/update (field update **and** `action:"approve-image"` — see below), delete |
| POST | `/import/woocommerce` | import/woocommerce |
| GET | `/reports/summary` | reports/summary |

## Review Images — Staged Media Pipeline (rev-2a)

Imported review photos are attacker-influenced third-party bytes, so they never reach the public
bucket directly. The ratified spine (D-REV-2, `docs/plan-reviews-import.md`) is
**private-stage → human moderation → promote**, and *the moderation gate governs the public object,
not merely the render*.

**D-REV-4 SUPERSEDED (2026-08-08, human): no automated byte-screening.** `sharp` was dropped from
the backend entirely — its Linux-binary-on-Lambda cost outweighed a benefit that was mostly
privacy+display, not security. The **human moderation gate is the content control**: every staged
image lands `pending` and a human approves it before it can go public. The declared **type-AND-size**
STAGE gate (allowlist JPEG/PNG/WebP/AVIF; HEIC rejected by a pure MIME check) is all that runs
pre-approval — those formats display natively, so no re-encode is needed. Promotion copies the
staged **original** (no normalized derivative). RESIDUAL (tracked, TECH-DEBT): a raw original may
carry EXIF/GPS — Google/FB exports strip it server-side; a pure-JS EXIF strip is the revisit, not
built now.

**Backend modules** (`backend/src/lib/`):

| Module | Step | Notes |
|--------|------|-------|
| `review-media.ts` | STAGE + PROMOTE | Declared **type-AND-size** gate → write raw bytes to the PRIVATE quarantine (`review-staging/<tenant>/<batch>/<id>/original`). `promoteReviewImage()` copies the **staged original** to public **only** when review AND image are both approved, records the original's declared **type + true size** as the `Asset`, and compensates (deletes the public object) on any post-copy failure. No `sharp`. |

**Approval action** — `PUT /reviews/{id}` with `{ action: "approve-image", productId?, imageIndex }`
(REV2A-INFRA-SURFACE option B: rides the existing handler additively; no dedicated Lambda/route,
same EDITOR/TENANT_ADMIN roles):

- Approval is **derived from the tenant-scoped review row**, never the client body.
- **Ordering contract:** the **review record must already be `approved`** before any of its images
  can be approved. `approve-image` on a still-`pending` review is refused with `409` and leaves the
  image entry untouched — it never flips an image to `approved` without promoting it. (Without this,
  an image could reach `approved` while its `assetKey` is still the private staging key: promotion
  is skipped because the review is not approved, a later review approval does not retroactively
  promote, and a repeat `approve-image` is refused because the image is no longer `pending` — a
  permanently unpromotable image.) The moderator therefore approves the review first (default
  field-update path, `status → approved`), then approves each image, which promotes it.
- Transition is strictly **pending → approved** for the image entry; a `hidden` (or otherwise
  non-pending) entry is refused with `409`.
- On promotion the `ReviewImage.assetKey` is replaced with the **public S3 object KEY** (never a
  URL; the URL is derived at render via `${CDN_URL}/${key}`, served as a raw asset URL — never
  `next/image`, per the opennext-1 parking rule).
- A per-image **optimistic-concurrency guard** pins the entry's own `status` + `assetKey` and the
  review `status`. The final write updates **only the targeted element's document paths**
  (`images[index].status`, and `images[index].assetKey` when promoted) — **never** a full-array
  `SET images = …` replacement. A full-array write is last-writer-wins over every sibling, so a
  concurrent approval of a *different* index would restore this entry to its stale pending/staging
  snapshot and orphan the first promotion; element-path updates of distinct indices touch disjoint
  attributes and are applied independently. If the final entry update fails for **any** reason after
  the object was promoted — a lost concurrency race on the same index
  (`ConditionalCheckFailedException` → `409`) **or** a non-conditional fault (throttle / network /
  IAM → `500`) — the promoted public object **and** its `ASSET#` record are rolled back before the
  error is returned. No double-copy, no orphan on any post-copy failure.

**Infra**: one S3 lifecycle rule expires `review-staging/` after 30 days (`infra/lib/uploads.ts`).
The moderation function gets least-privilege S3 grants — on the PUBLIC bucket, exactly
`s3:PutObject`/`s3:GetObject`/`s3:DeleteObject` (CopyObject dest, HeadObject for true size, rollback
delete) wired in the nested stack; on the PRIVATE bucket, a lone `s3:GetObject` scoped to
`review-staging/*` (HeadObject for the original's type + CopyObject source) wired in the parent stack
(composition root). Neither uses `grantReadWrite`/`grantRead`, whose bucket-list / abort / tagging /
retention / legal-hold / version-delete convenience set is refused; the boundary is pinned by name in
`infra/test/amodx-stack.test.ts` (`rev2a-iam`). The backend carries **no `sharp` dependency**
(D-REV-4 superseded); the bulk-review importer (`POST /import/reviews`) is a plain `NodejsFunction`
whose only extra dep is the pure-JS `fflate` ZIP reader.

## Product Availability Filtering

**File**: `backend/src/lib/availability.ts`

```javascript
function isProductAvailable(product) {
    if (!availableFrom && !availableUntil) return true;
    const now = new Date().toISOString().split("T")[0];
    if (availableFrom && now < availableFrom) return false;
    if (availableUntil && now > availableUntil) return false;
    return true;
}
```

Applied in: `public-get.ts`, `public-list.ts`, `categories/public-get.ts`, `dynamo.ts` (renderer SSR). CATPROD# adjacency items include `availableFrom`/`availableUntil` in their projections for filtering without product fetches.
