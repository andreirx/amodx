# CURRENT_SLICE.md

Rewritten 2026-11-18 (the earlier text described 2026-10-15). `docs/ROADMAP.md` holds the full rows.

## In the worktree

`ci-lockfile-1` (the human, 2026-11-27; `docs/slices/ci-lockfile-1.md`): IMPLEMENTED 2026-11-28, built, operator
proof on GitHub pending. `playwright.yml` and `staging-e2e.yml` install with `npm ci` and pin Node `'22'`;
`backend/vitest.config.ts` loads the shared reserved-word guard setup file for the unit files, so the backend step of "Playwright Tests"
(red since `31112cb`) can pass. The proof is the operator's: the GitHub run of "Playwright Tests" on the commit is
green and its install log shows `npm ci`. Next in the order of work: `theme-roles-1`, then `cmrc-1`.

`settings-findings-1` is on staging since 2026-11-28 (`docs/slices/settings-findings-1.md` § "Closeout") and waits
for the human's production deploy: the Settings screen lists the saved themes on open, the Interface card shows the
radius the site renders, the "Mode (TODO)" control and the repeated font fields are gone; what a first Save writes
is characterised (three empty secret fields; harmless).
`refactor-renderer-reads-1` is on staging since 2026-11-27 (`docs/slices/refactor-renderer-reads-1.md` § "Closeout")
and waits for the human's production deploy: the three reads of personal commerce data (`getOrderForCustomer`,
`getCustomerOrders`, `getCustomerProfile`) live in `renderer/src/lib/dynamo-customer-reads.ts`, the client in
`renderer/src/lib/dynamo-client.ts`; `dynamo.ts` re-exports them; moves only.
`refactor-mcp-1` is done since 2026-11-27 (`docs/slices/refactor-mcp-1.md` § "Closeout"; a local tool, nothing to
deploy): `tools/mcp-server/src/index.ts` keeps the server start (130 lines); the 80 tools live in 21 group files
under `tools/mcp-server/src/tools/`, moves only; an MCP client receives a byte-identical tool list.
`refactor-sitepage-1` is on staging since 2026-11-27 (`docs/slices/refactor-sitepage-1.md` § "Closeout") and waits
for the human's production deploy: `renderer/src/components/SitePage.tsx` keeps the page entry (479 lines); the
selectors, metadata, block preparation and views live in nine files under `renderer/src/components/site-page/`,
moves only; the serving captures did not move.
`refactor-settings-1` is on staging since 2026-11-27 (`docs/slices/refactor-settings-1.md` § "Closeout") and waits
for the human's production deploy: `admin/src/pages/Settings.tsx` is split into one file per section under
`admin/src/pages/settings/`, moves only; the markup and Save-body captures taken before the move are byte-identical
after it.
`projection-reserved-1` (hotfix) is on staging since 2026-11-27 (`docs/slices/projection-reserved-1.md` §
"Closeout") and waits for the human's production deploy: five DynamoDB projections that named a reserved word
bare are aliased (admin Orders list, review moderation list, Reports page, the download check, the account order
history); the unit-test doubles refuse a bare reserved word; a static lint (not a proof) checks the expression sites.
`refactor-shared-1` is on staging since 2026-11-27 (`docs/slices/refactor-shared-1.md` § "Closeout"): the
schemas of `packages/shared/src/index.ts` live in 24 domain files; `index.ts` re-exports only.
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
