# Technical Debt Tracker

Items tracked here are known issues that don't block production but should be addressed.

---

## High Priority

### Split Settings page into sections
The Settings page (`admin/src/pages/Settings.tsx`) is ~900 lines covering site identity, theme, analytics, identity providers, payments, GDPR, research, and now URL prefixes. Split into tabbed sections: **Visual** (theme, typography, interface), **Integrations** (analytics, payments, identity, research), **Commerce** (URL prefixes, delivery, bank transfer).

### Extract commerce views from catch-all page
`renderer/src/app/[siteId]/[[...slug]]/page.tsx` is ~900 lines containing ProductPageView, CategoryPageView, CartPageView, CheckoutPageView, ConfirmationPageView, OrderTrackingView, and ShopPageView all inline. Extract each to its own file under `renderer/src/components/commerce/`.

### Coupon not wired through checkout
CartPageView validates coupons but the discount is NOT passed through to the checkout POST /public/orders call. The couponCode and couponDiscount fields need to be included in the order creation payload.

### Delivery date picker missing from checkout
CheckoutPageView does not include a delivery date picker. The backend has `GET /public/delivery/dates` but it's not called from the checkout form.

---

## Medium Priority

### Replace `any` types in admin pages
Several admin pages (Orders, Customers, Products, etc.) use `any` types for API responses. Create proper TypeScript interfaces using the shared schemas.

### Split CDK api.ts
`infra/lib/api.ts` has grown with 50+ Lambda registrations. Group into separate construct files: `api-content.ts`, `api-commerce.ts`, `api-engagement.ts`, `api-system.ts`.

### availableFrom/availableUntil not enforced
ProductSchema has `availableFrom` and `availableUntil` fields but the public product endpoints don't filter by these dates. Products outside their availability window should return 404 on the renderer and be excluded from category listings.

### Form email notifications not implemented
`backend/src/forms/public-submit.ts` saves submissions but doesn't send notification emails to `FormDefinition.notifyEmail`. Needs SES integration similar to existing contact form handler.

---

## Low Priority

### Navbar shrink-on-scroll
Plan called for sticky navbar with shrink behavior on scroll. Currently sticky but no shrink animation.

### Google Reviews sync
ReviewSchema supports `source: "google"` and `googleReviewId` but there's no import/sync handler for Google Places API reviews.

### Reports / Analytics page
No admin page for viewing order reports, revenue charts, or product performance metrics.
