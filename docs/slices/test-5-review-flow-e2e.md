# TEST-5: Deployed-staging e2e for the review import→moderate→display flow

- **Status:** PLANNED (queued 2026-08-09 after batch-A prod deploy)
- **Track:** TEST
- **Depends:** REV track (shipped); the existing Playwright harness + .env.test admin
- **Source:** batch-A staging pass gap — the authenticated write round-trip was
  verified by hand, not by suite. This automates it (and would have auto-caught the
  reserved-keyword `source` 500 that reached staging live).

## The gap it closes

Code-level fixture E2E (`review-import-fixture.test.ts`) proves the LOGIC with mocked
S3/DDB + a simulated email identity. It cannot prove the flow survives real AWS auth,
IAM, S3, and DynamoDB reserved-keyword enforcement. A real-admin staging round-trip can.

## Scope

1. **Auth:** reuse the existing staging test admin (`admin@staging.amodx.net`, creds in
   `.env.test`). Two setup steps, staging-only, idempotent (script or documented):
   (a) ensure `custom:role=GLOBAL_ADMIN` on that user; (b) obtain a token — prefer
   Playwright through the real admin UI SRP login (matches `content-rendering.spec`,
   zero infra change). If UI-login proves too brittle, the fallback is enabling
   `ADMIN_USER_PASSWORD_AUTH` on the STAGING admin app-client only (documented,
   staging-scoped) — decide in-slice, record which.
2. **Round-trip against DEPLOYED staging:** POST a fixture CSV + small ZIP (real image
   bytes) to `/import/reviews` with a real attestation → assert ImportBatch written,
   review pending, image staged PRIVATE (assert the staged key is NOT publicly
   fetchable via the asset CDN); approve the review + image → assert promotion to
   public + `/public/reviews/{id}` returns it (this exercises the real DynamoDB
   projection — the layer that hid the `source` bug from unit tests).
3. **Isolation:** a second tenant cannot read/promote the first tenant's staged image.
4. **Cleanup:** delete all test-created items (batch, reviews, staged+public objects)
   — staging is shared; leave no orphans (follow the existing test cleanup pattern).
5. CI: separate job, NOT in the credential-free gate (needs staging creds); run
   on-demand / pre-deploy, documented.

## Non-scope

Connectors (rev-5/6); no prod runs; no change to the review feature itself.

## DoD / evidence

EXECUTED green round-trip transcript against deployed staging incl. the private→public
promotion assertion and the isolation check; cleanup verified (no residual test items).
