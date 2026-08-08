# REV-3: Review moderation UI — per-review and per-image approval

- **Status:** IMPLEMENTED — pending review (builder wave; REV phase 3). The one deferred scope
  conflict (per-image HIDE) was operator-resolved in the REVISE CYCLE (2026-08-08) and is now built
  — see *Implementation* → REV3-IMG-HIDE below.
- **Track:** REV
- **Depends:** rev-1 (schema), rev-2a (promotion path), rev-2b (import + report UI)

## Scope

Admin Reviews page grows real moderation (extending the existing page/patterns, not a
new page): filter by status + scope (product|site) + source + importBatch; per-review
approve/hide; PER-IMAGE approve/hide tiles (thumbnails from staged originals need an
ADMIN-side view path — presigned GET on the private staged object via an existing-
pattern admin endpoint; images are NOT public until promoted); approving an image
triggers the rev-2a promotion (existing handler action); disposition states visible
(pending/approved/hidden/rejected+reason). Site-scope reviews listed distinctly.
Deep-vertical output: a moderated review with an approved image is VISIBLE via the
public reviews list (existing public-list) with its public assetKey.

## Non-scope

Renderer gallery block (rev-4); no new backend capabilities beyond a presigned-GET
admin action IF none exists (follow assets/presign pattern); no infra beyond a grant
if the presign pattern requires it (STOP if more).

## DoD / evidence

Admin build + typecheck; unit tests for any new handler action; screenshot-level
evidence is operator/human (NOT RUN); the public-list visibility proof is an
EXECUTED fixture/handler test.

## Implementation (builder wave)

Files changed:

- `backend/src/reviews/update.ts` — folds the presigned-GET moderator VIEW path onto the EXISTING
  reviews-update Lambda. `GET /reviews/{id}/image-view-url?imageIndex=N[&productId=…]` mints a
  short-lived (300 s) presigned GET on the PRIVATE staged original of a pending image (that object
  is NOT public until promoted), or returns the public CDN URL once the image is approved. Dispatch
  is on the HTTP method so the READ bypasses `withInvalidation` (a view must not mark the CDN pending
  or raise the GO-LIVE banner). Follows the `resources/presign.ts` pattern; no new deployable unit.
- `backend/src/reviews/list.ts` — admin list now projects `images` (per-image tiles) and
  `importBatchId` (batch filter). Additive projection on the same PK+begins_with Query; no Scan.
- `backend/src/reviews/public-list.ts` — DEEP-VERTICAL: projects `images` and exposes ONLY
  approved + public-key photos, filtering out any pending/hidden or `review-staging/` key so a
  private quarantine key can never leak into the public payload.
- `infra/lib/api-commerce.ts` — ONE new route `GET /reviews/{id}/image-view-url` → the existing
  `updateReviewFunc`. NO new Lambda, NO new grant: that function already carries `PRIVATE_BUCKET`,
  `s3:GetObject` on `review-staging/*`, and `UPLOADS_CDN_URL` from the rev-2a composition-root wiring.
- `backend/src/reviews/update.ts` — ALSO folds `action: "hide-image"` onto the same handler (REVISE
  CYCLE): a PURE per-image status flip to `hidden` — no promotion, no S3, no assetKey rewrite —
  mirroring approve-image's per-element optimistic-concurrency guard. Allowed transitions
  pending→hidden and approved→hidden; already-hidden is an idempotent no-op. No review-level status
  gate (unlike approve). Hiding an already-promoted image relies on the public-list status filter to
  stop emitting it (no S3 delete — the public bytes remain reachable by direct CDN URL, the ratified
  minimal-action consequence).
- `admin/src/pages/Reviews.tsx` — filters by status + scope + source + importBatch (client-side over
  the one list payload); a Scope badge lists site reviews distinctly; a Photos column expands
  per-image tiles that lazy-load thumbnails via the view endpoint, show per-image disposition
  (pending/approved/hidden), offer per-image APPROVE (rides the rev-2a `approve-image` action) only
  when the review is approved and the image is pending, and offer per-image HIDE (`hide-image`) for
  any non-hidden image. Also fixed a pre-existing display bug: the author cell read `r.author` (never
  projected); the projected field is `authorName`.
- Tests: `backend/test/unit/reviews-public-list.test.ts` (EXECUTED public-list visibility proof,
  incl. the hidden-image exclusion proof), `backend/test/unit/review-view-url.test.ts` (presign path
  + withInvalidation bypass), `backend/test/unit/update-review.test.ts` (approve-image AND hide-image
  action coverage).

### REV3-IMG-HIDE — per-image HIDE (RESOLVED, REVISE CYCLE 2026-08-08)

Originally deferred: the scope named "per-image approve/**hide** tiles", but the earlier non-scope
line capped new backend at the presigned-GET action. The operator resolved REV3-IMG-HIDE-SCOPE = B:
the non-scope line was defective — ratified D-REV-1 converged on per-image approve/HIDE and the
schema already carries the `hidden` state. The MINIMAL `hide-image` action on the existing
review-update handler is ratified (mirror of approve-image, no promotion side effects, sets the image
status hidden; for an already-promoted image, `hidden` makes public-list stop emitting it — verified
by test). Both actions have unit coverage. The image `status` enum (`ReviewImageSchema`) is
`pending|approved|hidden` — there is no `rejected` state, so the "(…/rejected+reason)" disposition in
the original scope line has no schema backing and is not shown.

Known consequence (deliberately out of this slice): hiding an already-promoted image leaves the
public object retrievable by direct CDN URL (only the listing stops emitting it). A public-object GC
on hide is future work, not part of the ratified minimal action.
