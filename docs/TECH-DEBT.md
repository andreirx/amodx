# Technical Debt Tracker

Items tracked here are known issues that don't block production but should be addressed.

---

## High Priority (Missing Features)

### Netopia Payments (future)
Some clients need card payments via Netopia. Architecture is ready:
- Add "netopia" to paymentMethod enum and enabledPaymentMethods
- Add Netopia credentials to IntegrationsSchema
- Checkout: redirect to Netopia hosted page after order creation (status=placed, paymentStatus=pending)
- Webhook handler: on payment success → update paymentStatus to "paid"
- Return page: show confirmation
- Estimated effort: Medium (1-2 days)

### Google Reviews sync
ReviewSchema supports `source: "google"` and `googleReviewId` but there's no import/sync handler for Google Places API reviews. Need a backend handler that pulls reviews from Google My Business / Places API and writes them as ReviewSchema items.

### Reports / Analytics page
No admin page for viewing order reports, revenue charts, or product performance metrics. "Nice to have" per original spec.

### Form email notifications not implemented
`backend/src/forms/public-submit.ts` saves submissions but doesn't send notification emails to `FormDefinition.notifyEmail`. Needs SES integration similar to existing contact form handler.

### Customer accounts (Phase 5E)
Reuse existing per-tenant NextAuth Google OAuth for customer login. Need:
- Customer login UI in Navbar/CommerceBar
- SSR account page with order history and saved address
- Pre-fill checkout from session
- Route handling for `/account` URL prefix (schema already added)

---

## Medium Priority (Code Quality)

### Split Settings page into sections
The Settings page (`admin/src/pages/Settings.tsx`) is ~1300 lines covering site identity, theme, analytics, identity providers, payments, GDPR, commerce bar, URL prefixes, company details, legal links, and more. Split into tabbed sections.

### Extract commerce views from catch-all page
`renderer/src/app/[siteId]/[[...slug]]/page.tsx` is ~900 lines containing ProductPageView, CategoryPageView, CartPageView, CheckoutPageView, ConfirmationPageView, OrderTrackingView, and ShopPageView all inline. Extract each to its own file under `renderer/src/components/commerce/`.

---

## Low Priority

### Replace `any` types in admin pages
Several admin pages (Orders, Customers, Products, etc.) use `any` types for API responses. Create proper TypeScript interfaces using the shared schemas.

---

## Completed

- ~~Coupon not wired through checkout~~ — DONE (server-side validation, atomic usage increment)
- ~~Delivery date picker missing from checkout~~ — DONE (mini calendar, yearly holidays, lead-day skip)
- ~~Split CDK api.ts~~ — DONE (parent + 2 NestedStacks)
- ~~Navbar shrink-on-scroll~~ — DONE (h-16→h-12, logo shrinks, CSS transitions)
- ~~Commerce bar above navbar~~ — DONE (phone, social icons, cart total, CTA button)
- ~~availableFrom/availableUntil not enforced~~ — DONE (filtered in all public endpoints + renderer SSR)
- ~~Order workflow / status enum~~ — DONE (placed/confirmed/prepared/shipped/delivered/cancelled/annulled)
- ~~Configurable email templates~~ — DONE (per-status templates with {{variables}}, configurable recipients)
- ~~WooCommerce import: SKU + variations~~ — DONE (two-pass parsing, variable→variants mapping)
- ~~Payment methods config~~ — DONE (enabledPaymentMethods, bank transfer details in admin)
- ~~Footer enhancement~~ — DONE (company details, footer links, legal links, multi-column layout)
- ~~Product variants admin tab~~ — DONE (VariantsTab in ProductEditor with groups + options)
