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
        label: string;
        value: string;
        addedCost: number;
    }[];
}
```

### Item Uniqueness

Keyed by `productId` + optional `selectedVariant` (format: `{productId}__{variant}`). Same product with different variants = separate cart items.

### Price Calculation

```
lineTotal = (unitPrice + sum(personalization.addedCost)) * quantity
subtotal  = sum(lineTotal for all items)
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
    paymentMethod, currency, couponCode, requestedDeliveryDate
}
```

### Facebook Pixel
- Fires `InitiateCheckout` on submit: `content_ids`, `num_items`, `value`, `currency`
- On success: stores order in `sessionStorage.amodx_last_order` for confirmation page

### Post-Checkout
- Redirects to confirmation page (`/checkout-confirm/{orderId}`)
- `ConfirmationPageView`: Order details, bank transfer instructions (if applicable), order tracking link

## Order Creation (Backend)

**File**: `backend/src/orders/create.ts`

### Server-Side Validation

1. **Product lookup**: Fetches each product from DB to validate existence
2. **Price validation**: Uses `salePrice || price` from DB record (ignores client-submitted price)
3. **Personalization cost**: Re-calculates from product's `personalizations` array by matching `id` or `label`
4. **Delivery zone restrictions**: If `deliveryConfig.restrictDeliveryZones` is true, validates `allowedCountries` and `allowedCounties` (case-insensitive). Returns 400 if address not in allowed zones

### Coupon Validation (Server-Side)

Duplicates validation even if client already validated — never trust client state:

1. Lookup `COUPONCODE#{upperCode}` → get `couponId`
2. Fetch `COUPON#{couponId}`
3. Check: `status === "active"`, date range, usage limit, minimum order amount
4. Calculate discount:
   - **Percentage**: `(value / 100) * subtotal`, capped by `maximumDiscount`
   - **Fixed amount**: Direct subtraction
   - Never exceeds subtotal

### Atomic Order Counter

```javascript
UpdateCommand({
    Key: { PK: `TENANT#${tenantId}`, SK: `COUNTER#ORDER` },
    UpdateExpression: "SET currentValue = if_not_exists(currentValue, :zero) + :one",
    ReturnValues: "UPDATED_NEW"
})
// Format: "PPB-0001", "PPB-0002", ...
```

### TransactWrite (5 Items)

| # | Key | What |
|---|-----|------|
| 1 | `ORDER#<uuid>` | Full order record: items, addresses, totals, status="placed", paymentStatus="pending", statusHistory=[{status:"placed"}] |
| 2 | `CUSTORDER#<email>#<orderId>` | Lightweight reference: orderNumber, total, status, createdAt |
| 3 | `CUSTOMER#<email>` | Upsert: increment orderCount + totalSpent, add loyalty points (1 per currency unit), update lastOrderDate + defaultAddress. Sets birthday + defaultBillingDetails if provided |
| 4 | `COUPON#<couponId>` | Increment `usageCount` (only if coupon applied) |
| 5 | `COUNTER#ORDER` | Already incremented before TransactWrite (separate UpdateCommand with ReturnValues) |

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

Stored in `TenantConfig.orderEmailConfig.templates` — one template per status. Admin can customize via Order Emails page. `getDefaultTemplates()` provides English-language fallbacks for all 7 statuses.

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

Request: `{ code, subtotal, customerEmail?, items: [{ productId, categoryIds }] }`

Validation steps:
1. Uppercase code → lookup `COUPONCODE#`
2. Fetch `COUPON#` record
3. Check: active, date range, usage limit, minimum order
4. Scope: if `applicableCategories` or `applicableProducts` set, at least one item must match
5. Calculate discount (percentage capped by maximumDiscount, or fixed amount)

Response: `{ valid: true, discount: 15.50, couponId, type, value }` or `{ valid: false, reason: "..." }`

### Checkout Integration

- Client validates coupon via API → stores in CartContext (localStorage)
- Server re-validates during order creation → atomically increments `usageCount`

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
{ minQuantity: number, price: number }
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

Slug conflict validation: `checkSlugCommerceConflict()` in `backend/src/lib/slug-guard.ts` prevents content pages from using slugs that collide with commerce URL prefixes.

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
| GET | `/public/categories/{id}` | categories/public-get |
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
| PUT | `/orders/{id}` | orders/update |
| PUT | `/orders/{id}/status` | orders/update-status |
| GET | `/customers` | customers/list |
| GET/PUT | `/customers/{email}` | customers/get, update |
| GET/PUT | `/delivery` | delivery/get, update |
| GET/POST | `/coupons` | coupons/list, create |
| GET/PUT/DELETE | `/coupons/{id}` | coupons/get, update, delete |
| GET/POST | `/reviews` | reviews/list, create |
| PUT/DELETE | `/reviews/{id}` | reviews/update, delete |
| POST | `/import/woocommerce` | import/woocommerce |
| GET | `/reports/summary` | reports/summary |

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
