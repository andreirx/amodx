# CURRENT_SLICE.md

Rewritten 2026-11-18 (the earlier text described 2026-10-15). `docs/ROADMAP.md` holds the full rows.

## In the worktree

Nothing. `refactor-shared-1` is on staging since 2026-11-27 (`docs/slices/refactor-shared-1.md` § "Closeout"): the
schemas of `packages/shared/src/index.ts` live in 24 domain files; `index.ts` re-exports only. Next: `projection-reserved-1` (hotfix), then `refactor-settings-1`.
`packages/shared/src/index.ts` moved into 24 domain files; `index.ts` re-exports only. Next in the order of work:
`refactor-settings-1`.
`lead-normalize-1` is on staging since 2026-11-27 (`docs/slices/lead-normalize-1.md` § "Closeout") and
waits for the human's production deploy.
`stay-1` part A is on staging since 2026-11-27 (`docs/slices/stay-1.md` § "Closeout (STAY-1A)") and waits
for the human's production deploy.
`redirect-1` is on staging since 2026-11-27 (`docs/slices/redirect-1.md` § "Closeout") and waits for the
human's production deploy.
`gallery-1` is on staging since 2026-11-27 (`docs/slices/gallery-1.md` § "Closeout") and waits for the human's
production deploy. The order of work is in `docs/ROADMAP.md`, "Order of work from 2026-11-27" (after `redirect-1`:
`stay-1` part A).
`next-patch-1` (Next.js 16.4.6) and `public-harden-1` are on staging since 2026-11-21.

## Waiting for the human's production deploy

`coupon-fix-1` and `pay-1` (staging 2026-11-21). The diff of `pay-1` shows one permission added:
`ses:SendEmail` for the order-update function. Everything before it is on production since the human's deploy of
2026-11-21 (Next.js 16.4.6, `public-harden-1`, and the slices from `admin-english-1` to `form-submit-2`).
Still to do on production by the human: set the locale on shops with comma prices; `/lista-mea` on the Romanian
site; one real order with a price change in the cart; one real custom-form submission.

## Not started, by track

- **B commerce-private** (`cmrc-1`…`6`): mandatory (human 2026-11-20; a client with real orders is named).
  Slice docs not yet written. Backlog behind it: `cmrc-reviews-ask`, `cmrc-withdrawal`.
- **C customer sign-in** (`auth-1`…`7`): planned, no code; Google sign-in exists.
- **D scheduling**: draft `sched-1` — two shapes (a slot with a practitioner, a seat in a group), booking by
  emailed link; `sched-frame-1` offers it to sites that are not on AMODX. Four decisions open.
- **Languages**: `lang-1` mandatory (human 2026-11-20); next is the `<html lang>` spike.
- **Two client sites** (drafts; map in `docs/plan-courses-group-sessions.md` § 5): `gallery-1`, `redirect-1`,
  `landing-1`, `tags-1`, `newsletter-1`, `import-paths-1`, `booking-embed-1`, `pay-2`,
  `invoice-1`, `voucher-1`, `loyalty-1`, `contract-1`, `wp-export-1`.
- **Maintenance**: `dep-1`.
- **Plans waiting for rulings**: STATIC (`D-STATIC-1`…`5`), EMAIL (`D-EMAIL-1`, `D-EMAIL-6`), AI (provider).

## Known-open

`docs/TECH-DEBT.md`. Optimised images stay parked (OPENNEXT1-IMAGE = A).
