# CURRENT_SLICE.md

Rewritten 2026-11-18 (the earlier text described 2026-10-15). `docs/ROADMAP.md` holds the full rows.

## In the worktree

`public-harden-1` — reviewed (gpt-6.1-sol, third cycle), ten gates green, **not on staging, not committed**.
A reCAPTCHA answer without a score is refused; 14 public handlers answer a server failure with a fixed text.
Record `docs/slices/public-harden-1.md`.

## Blocked

The operator's staging deploy. The Next.js build stops on a security advisory when an agent runs it, and the
deploy builds twice. Fix = `next-patch-1` (`docs/slices/next-patch-1.md`), PLANNED; human 2026-11-18: "leave
next.js for now".

## Waiting for the human's production deploy

Everything on `main` after `bulk-purge-footer-1` (prod 2026-11-14): `admin-english-1/2`, `cdl-1/2`,
`header-colours-1`, `category-content-1`, `cat-variant-gallery-1`, `order-price-1`, `order-checkout-1`,
`order-email-1`, `price-locale-1`, `order-confirm-1`, `shop-look-1a`…`1e`, `small-fixes-1`, `badge-case-1`,
`form-submit-2`. After it: set the locale on shops with comma prices; one real order with a price change in the
cart; one real custom-form submission; `/lista-mea` on the Romanian site.

## Not started, by track

- **B commerce-private** (`cmrc-1`…`6`): mandatory (human 2026-11-20; a client with real orders is named).
  Slice docs not yet written. Backlog behind it: `cmrc-reviews-ask`, `cmrc-withdrawal`.
- **C customer sign-in** (`auth-1`…`7`): planned, no code; Google sign-in exists.
- **D scheduling**: draft `course-1` proposes seats in course runs first; `appt-1`…`7` unscheduled.
- **Languages**: `lang-1` mandatory (human 2026-11-20); next is the `<html lang>` spike.
- **Two client sites** (drafts; map in `docs/plan-courses-group-sessions.md` § 5): `gallery-1`, `redirect-1`,
  `landing-1`, `tags-1`, `coupon-fix-1`, `newsletter-1`, `import-paths-1`, `booking-embed-1`, `pay-1`, `pay-2`,
  `invoice-1`, `voucher-1`, `loyalty-1`, `contract-1`.
- **Maintenance**: `next-patch-1`, `dep-1`.
- **Plans waiting for rulings**: STATIC (`D-STATIC-1`…`5`), EMAIL (`D-EMAIL-1`, `D-EMAIL-6`), AI (provider).

## Known-open

`docs/TECH-DEBT.md`. Optimised images stay parked (OPENNEXT1-IMAGE = A).
