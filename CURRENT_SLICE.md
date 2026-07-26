# CURRENT_SLICE.md

## Current Priority

**`cache-3` — CloudFront cache-key remediation** (Track CACHE). Slice doc not yet authored;
generate it per `docs/ROADMAP.md`. It is the deploy gate for the whole track (H1: the RSC
header family is missing from the CloudFront cache key).

`cache-2` — ISR revalidation keyed by domain — is **IMPLEMENTED 2026-07-26 (revised same day),
review pending** (`docs/slices/cache-2-isr-revalidation-keying.md`, § Build run). Nothing
deployed. Both operator decisions are now **resolved and applied**: `CACHE-2-D1` (the
multi-domain evidence item had no representable input — one domain per tenant — so it is
replaced by a test pinning the single-domain contract) and `CACHE-2-D2` (scope amended to
allow exactly one `infra/` line, `revalidationSecret.grantRead(createContentFunc)` in
`infra/lib/api.ts:144`, so the `content/create.ts` purge is complete rather than inert).
The slice is therefore backend + one IAM statement; that grant and the create-purge must
deploy together.

`cache-1` is IMPLEMENTED (approved + committed 2026-07-26, d2ecffe) but **NOT DEPLOYED —
deploy gate: cache-3 must land first**. Deploy order: cache-3 → cache-1 + cache-2 (combined
is fine; the `CACHE-2-D2` grant is part of cache-2, not an optional extra step); staging
header probes + rollback per the cache-1 slice doc, ISR purge verification per the cache-2
slice doc.

Read before implementation: `docs/VISION.md` → `docs/ROADMAP.md` → this file →
`docs/slices/cache-1-restore-static-rendering.md` →
`docs/slices/cache-2-isr-revalidation-keying.md` → `docs/caching-architecture.md`.

## Planning phase — COMPLETE

The four feature plans and the platform decisions are approved and are the binding
source for the slice inventory:

- `docs/platform-decisions.md` — PD-001 (tenant-local identity), PD-002 (renderer-proxy
  customer data transport), PD-003 (Cognito as login substrate; dormant CUSTOMER branch).
- `docs/plan-public-pool-customer-auth.md` — approved.
- `docs/plan-appointments-private-table-extension.md` — approved.
- `docs/plan-commerce-private-table.md` — approved.
- `docs/plan-youtube-vimeo-embed.md` — source for Track A.

## In Progress

None. Track A slice docs exist (`vid-1`, `vid-2`, `vid-3`); implementation not started.

## Next

`cache-3` (completes Track CACHE; then deploy cache-3 + cache-1 + cache-2 with the
post-deploy operator verification each slice doc specifies), then
`vid-1` → `vid-2` → `vid-3` (Track A), then `fnd-1` (shared
`normalizeEmail`), then begin
Track B (`cmrc-1`). The `fnd-1` and Track B/C/D slice docs are not yet authored — generate
them per `docs/ROADMAP.md` when their track starts.

## Recently Completed

- `cache-2` — ISR revalidation keyed by domain (2026-07-26). Backend code **plus one IAM
  statement** (`revalidationSecret.grantRead(createContentFunc)`, `infra/lib/api.ts:144`):
  6 handlers now purge `/<domain>/<path>` instead of the no-op `/<tenantId>/<path>`, and
  the 6th (`content/create.ts`) is inert without that grant, so the two deploy together.
  Status `IMPLEMENTED`, not `SHIPPED` — authoritative status is § Current Priority above;
  this entry is a pointer, not a second source of truth.
- Slice infrastructure scaffolding: `VISION.md`, `ROADMAP.md`, `documentation.md`, this
  file, the `CLAUDE.md` Slice Workflow section, and `docs/slices/` + `docs/shipped/slices/`.
