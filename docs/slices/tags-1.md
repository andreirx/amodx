# TAGS-1 — Google Ads and purchase events, behind the cookie consent

Status: **PLANNED (draft 2026-11-20, not ratified)**. Track: growth. Depends: none.

## Purpose

A site that buys Google Ads must report purchases to Google. Today:

- GA4 page views only: `gtag('config', gaId)` (`renderer/src/components/Analytics.tsx:31-46`), driven by
  `integrations.googleAnalyticsId` (`packages/shared/src/index.ts:559`), behind the analytics consent (`:24`).
- No GA4 purchase event, no Google Ads id, no conversion event, no Tag Manager container (search of
  `renderer/src` for `gtag|GTM-|AW-|conversion|purchase`, 2026-11-20). `IntegrationsSchema` (`:555-605`) has no
  field for them.
- Facebook reports the purchase (`FBPurchaseEvent.tsx:17-24`, mounted in the confirmation view
  `SitePage.tsx:1825-1830`).
- **Defect:** the Facebook pixel is mounted whenever its id is set (`app/[siteId]/layout.tsx:289-291`), without
  the consent check that `Analytics.tsx` applies; `renderer/src/lib/fbpixel.ts:3` says it is consent-gated.

## Scope

1. Settings: `integrations.googleAdsId` (`AW-…`) and `integrations.googleAdsPurchaseLabel`; admin fields next to
   the Analytics id. Format checked at save.
2. `Analytics.tsx`: the Ads id is configured in the same gtag loader, behind a marketing consent category.
3. Confirmation page: one purchase event to GA4 (`purchase`: order id, value, currency, items) and one Ads
   conversion (value, currency, order id as the transaction id), sent once per order (a reload does not send
   again). Value = the order total the server stored.
4. The Facebook pixel and its events go behind the marketing consent.
5. Google Consent Mode defaults ("denied" until the visitor chooses) set before the loader.

## Non-scope

Google Tag Manager containers (arbitrary third-party script chosen in a Google console runs on the tenant's
pages: a security decision of its own). Enhanced conversions with hashed customer data. Server-side tagging.

## Evidence taxonomy

No ids → page bytes unchanged (serving suite). Consent refused → no request to Google or Facebook (Playwright
request log). Consent given → loader present; the confirmation page sends each purchase event once; reload →
none. Order of another email → the confirmation page shows nothing and sends nothing.

## Deployment notes

Changes the scripts of live tenants that set a Facebook pixel id: after this slice the pixel loads only after
consent. That is the behaviour the code comment already claims. Name it to the human before the prod deploy.

## Exit criterion

In Google's tag checker, a staging order shows one GA4 purchase and one Ads conversion after consent, and
nothing without consent.
