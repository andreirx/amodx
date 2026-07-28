# CURRENT_SLICE.md

## Current Priority

**Awaiting the human's GO for Track B (`cmrc-1`, commerce-private table).** Before any
data copy: fix F-SHARED-1 (hardcoded "Romania" country default — persisted in orders)
and author the `cmrc-*` slice docs around the PARTIALLY PRE-EXISTING migration script
(`scripts/migrate-commerce-private-table.ts` — do not rebuild it).

Also queued (order per `docs/ROADMAP.md`): `opennext-1` (open-next upgrade — image
optimizer incompatible with next 16, probe-proven; full serving-adapter swap gated on
the test-2 suite), `cache-4` (instant per-page go-live), `fnd-2` (normalizeEmail
call-site migration, inventory in the fnd-1 build report).

## Shipped 2026-07-28 (production, human-deployed, probe-verified)

Tracks CACHE (1,2,3,6), TEST (1–4), A (vid-1..3), `fnd-1`, `sec-1` — slice docs in
`docs/shipped/slices/`. Serving contract live: tenant pages cached at edge + ISR
(zero-DB hits), poisoning/leak vectors closed, deployed ISR purging working for the
first time, admin edits refresh caches, CI gates green.

## Known-open (tracked in docs/TECH-DEBT.md)

- Optimized images 500 (open-next 3.1.3 image handler vs next 16) — pre-existing, no
  regression; fix = `opennext-1`.
- F-SHARED-1 "Romania" default (blocks Track B data copy), F-BACKEND-2 UTC
  availability, stale playwright specs, weekly audit red until upstream Next patch.
