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

- **B commerce-private** (`cmrc-1`…`6`): waits for the human's GO. Backlog behind it: `cmrc-reviews-ask`,
  `cmrc-withdrawal`.
- **C customer sign-in** (`auth-1`…`7`), **D scheduling** (`appt-1`…`7`): planned, no code.
- **Content-site gaps** (drafts 2026-11-18): `gallery-1`, `redirect-1`, `stay-1`, `lang-1`.
- **Maintenance**: `next-patch-1`, `dep-1`.
- **Plans waiting for rulings**: STATIC (`D-STATIC-1`…`5`), EMAIL (`D-EMAIL-1`, `D-EMAIL-6`), AI (provider).

## Known-open

`docs/TECH-DEBT.md`. Optimised images stay parked (OPENNEXT1-IMAGE = A).
