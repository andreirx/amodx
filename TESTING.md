# AMODX Testing Guide

## Overview

AMODX uses a **persistent staging environment** for all testing. Tests create and destroy data, not infrastructure.

**Staging URL:** `https://staging.amodx.net`  
**Test Tenants:** Use path-based routing: `https://staging.amodx.net/tenant/test-123/`

---

## Prerequisites

### 1. Deploy Staging Stack
```bash
cd infra
cdk deploy AmodxStack-staging -c stage=staging
```

This creates:
- DynamoDB table: `AmodxStack-staging-Table`
- API Gateway: `AmodxStack-staging-AdminAPI` and `AmodxStack-staging-TenantAPI`
- CloudFront: `AmodxStack-staging-Distribution`
- S3 buckets: `AmodxStack-staging-PublicBucket`, `AmodxStack-staging-PrivateBucket`
- Cognito: `AmodxStack-staging-AdminPool`, `AmodxStack-staging-TenantPool`

**Do this once.** Staging stays deployed.

### 2. Configure Environment Variables

Create `.env.test` in repo root:
```bash
# From CDK outputs
TABLE_NAME=AmodxStack-staging-Table
ADMIN_API_URL=https://abc123-staging.execute-api.us-east-1.amazonaws.com
TENANT_API_URL=https://xyz456-staging.execute-api.us-east-1.amazonaws.com

# Test credentials (create in Cognito staging pool)
TEST_ADMIN_USER=test-admin@amodx.net
TEST_ADMIN_PASSWORD=TestPassword123!
```

### 3. Verify AWS Credentials
```bash
aws sts get-caller-identity
```

Tests use your local AWS credentials to access staging resources.

---

## Running Tests

### Backend Unit Tests (Fast)
```bash
cd packages/backend
npm test
```

**What it tests:**
- Input validation
- Business logic
- Zod schema parsing

**Does NOT test:** AWS services (mocked)

### Backend Integration Tests (Medium)
```bash
cd packages/backend
npm run test:integration
```

**What it tests:**
- DynamoDB queries against staging table
- Tenant isolation
- Single-table design patterns

**Creates real data** in staging. Cleaned up in `afterAll()` hooks.

### E2E Tests (Slow)
```bash
npx playwright test
```

**What it tests:**
- Full user workflows
- Admin → API → DB → Renderer → Browser
- OAuth flows
- Cache behavior

**Requires:** Staging deployed and accessible at `staging.amodx.net`

---

## Test Data Isolation

All test data uses **tenant ID prefix `test-`**.

**Example:**
```
DynamoDB Table: AmodxStack-staging-Table
  ├─ SITE#test-e2e-main      (E2E test tenant)
  ├─ SITE#test-1234567890-a  (Integration test tenant)
  └─ SITE#my-staging-client  (Manual QA tenant - OK to keep)
```

**Cleanup:**  
Tests delete their own data. If tests crash, run:
```bash
npm run test:cleanup
```

This deletes all items with PK starting with `SITE#test-`.

---

## Writing New Tests

### Backend Integration Test
```typescript
// packages/backend/__integration__/my-feature.test.ts
import { describe, test, expect, afterAll } from 'vitest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

describe('My Feature', () => {
  const tenantId = `test-${Date.now()}`;
  
  afterAll(async () => {
    // Cleanup: Delete test tenant
  });
  
  test('does something', async () => {
    // Create test data
    await client.send(new PutCommand({ ... }));
    
    // Test your feature
    const result = await myFunction(tenantId);
    
    // Assert
    expect(result).toBeDefined();
  });
});
```

### E2E Test
```typescript
// tests/e2e/my-workflow.spec.ts
import { test, expect } from '@playwright/test';

test('my workflow', async ({ page, request }) => {
  const tenantId = process.env.TEST_TENANT_ID; // test-e2e-main
  
  // Hit admin API
  await request.post('https://api-staging.amodx.net/admin/...');
  
  // Visit tenant site
  await page.goto(`/tenant/${tenantId}/my-page`);
  
  // Assert
  await expect(page.locator('h1')).toBeVisible();
});
```

---

## OAuth Testing

**Google OAuth:** Configured for `staging.amodx.net` only.

**Test flow:**
1. Visit `staging.amodx.net/tenant/test-e2e-main/`
2. Click "Login with Google"
3. Redirected to Google (uses staging OAuth app)
4. Redirected back to `staging.amodx.net/api/auth/callback/google`
5. Session created for tenant `test-e2e-main`

**Note:** Cannot test OAuth on `localhost`. Must use staging domain.

---

## Payment Testing

**Paddle:** Use sandbox mode.

1. Store Paddle sandbox keys in Secrets Manager:
```bash
   aws secretsmanager put-secret-value \
     --secret-id AmodxStack-staging/PaddleSecrets \
     --secret-string '{"apiKey":"test_...","webhookSecret":"test_..."}'
```

2. Configure webhook endpoint: `https://api-staging.amodx.net/webhooks/paddle`

3. E2E test:
```typescript
   test('checkout flow', async ({ page }) => {
     await page.goto('/tenant/test-e2e-main/pricing');
     await page.click('text=Buy Now');
     // Paddle overlay appears (cannot automate further)
     // Manually verify webhook received in staging logs
   });
```

**Cannot fully automate** Paddle UI. Verify webhooks in CloudWatch.

---

## Cache Testing

**Goal:** Prove ISR works and revalidation triggers.
```typescript
test('cache invalidation', async ({ page, request }) => {
  const tenantId = 'test-e2e-main';
  
  // First load
  const r1 = await page.goto(`/tenant/${tenantId}/`);
  const buildTime1 = await page.locator('meta[name="amodx-build-time"]').getAttribute('content');
  
  // Second load (should be cached)
  await page.reload();
  const buildTime2 = await page.locator('meta[name="amodx-build-time"]').getAttribute('content');
  expect(buildTime2).toBe(buildTime1); // Same = cache hit
  
  // Trigger revalidation
  await request.post('https://api-staging.amodx.net/admin/revalidate', {
    data: { path: '/', tenantId },
  });
  
  // Wait for CloudFront propagation
  await page.waitForTimeout(2000);
  
  // Third load (should be fresh)
  await page.reload();
  const buildTime3 = await page.locator('meta[name="amodx-build-time"]').getAttribute('content');
  expect(buildTime3).not.toBe(buildTime1); // Different = cache miss
});
```

---

## Latency Measurement

Track performance regressions with Playwright:
```typescript
test('page loads under 1 second', async ({ page }) => {
  const start = Date.now();
  await page.goto('/tenant/test-e2e-main/');
  const loadTime = Date.now() - start;
  
  console.log(`Load time: ${loadTime}ms`);
  expect(loadTime).toBeLessThan(1000);
});
```

**CloudWatch Logs:**  
Lambda execution time is logged automatically. Check `Duration` field in CloudWatch Logs Insights.

---

## CI/CD Integration

Three workflows exist in `.github/workflows/`. Target architecture and the gap list live in
`docs/testing-strategy.md`.

| Workflow | Runs | Needs secrets |
|---|---|---|
| `ci.yml` | build → typecheck (8 workspaces) → `backend npm run test:unit` | **no** — must stay credential-free |
| `playwright.yml` | `backend npm test` (live staging DynamoDB) + playwright e2e | yes |
| `security-audit.yml` | `npm audit --audit-level=high` | no |

Two rules when editing them:

- **Use `npm ci`, never `rm -f package-lock.json && npm install`.** The lockfile pins what CI
  builds; deleting it lets CI float to whatever the registry serves that day. `ci.yml` uses
  `npm ci`. `playwright.yml` still carries the delete-and-install workaround and should be
  migrated to `npm ci` — see `docs/TECH-DEBT.md`.
- **Do not add secrets to `ci.yml`.** It is the every-push gate and must be green from a bare
  checkout. Anything needing AWS belongs in `playwright.yml`.

### If a Linux runner fails on a missing native binary

Symptom: `npm ci` succeeds, then `npm run build` dies in admin's `vite build` with
`Cannot find module @rollup/rollup-linux-x64-gnu` (or the `lightningcss-*` / `@tailwindcss/oxide-*`
/ `@img/sharp-*` / `@unrs/resolver-binding-*` equivalent).

Cause: npm records only the optional platform binaries it resolved on the **authoring host**
(npm/cli#4828). A lockfile written on macOS lists the `darwin-arm64` sibling of each native family
and nothing else. Those entries are `optional`, so `npm ci` skips the absent ones without an error
— the failure surfaces one step later, at build time.

Fix — **add the missing entries, do not regenerate the lockfile.** Regenerating (even in a clean
room) re-resolves every semver range and rewrites hundreds of unrelated versions; that is a
dependency upgrade wearing a bugfix's clothes and must not ride along in an unrelated slice.
npm will not backfill the entries for you: `npm install`, `npm install --package-lock-only`, the
same with `--os/--cpu/--libc`, and `--force` are all exact no-ops against an existing lockfile
(all four `EXECUTED` in `test-1`). Edit `package-lock.json` directly:

1. Read the offending package's parent entry in `package-lock.json` (e.g. `node_modules/rollup`).
   Its `optionalDependencies` map is the complete sibling list **and the exact pinned version**.
2. For each sibling missing from `packages`, add an entry at that same version, with `resolved`
   and `integrity` taken from `https://registry.npmjs.org/<name>/<version>` (`dist.tarball`,
   `dist.integrity`), and `cpu`/`os`/`engines`/`license` from the same manifest. Copy the `dev`
   flag from a sibling that is already present — it describes how npm classified that family
   in this tree.
3. Keep `packages` in plain lexicographic key order; npm writes the file as
   `JSON.stringify(lock, null, 2) + "\n"`, so a parse → insert → re-serialize round-trip is
   byte-stable for every untouched entry.
4. Verify the edit is surgical before committing: parse the old and new lockfiles and assert
   **0 removed, 0 modified** entries. `git diff` alone is not sufficient evidence here — its
   default myers algorithm mis-anchors large JSON insertions and renders unchanged blocks as
   delete+add. Use `git diff --diff-algorithm=histogram` for a readable diff.
5. Verify the result in a Linux container, not just locally:
   `docker run --rm -i --platform linux/amd64 node:22 …` → `npm ci && npm run build`.

**Tests do NOT deploy staging.** They assume it exists.

---

## Troubleshooting

**Error: "Cannot connect to staging"**  
→ Deploy staging: `cdk deploy AmodxStack-staging -c stage=staging`

**Error: "Tenant not found"**  
→ Run global setup: `npx playwright test --global-setup`

**Error: "OAuth redirect URI mismatch"**  
→ Verify Google OAuth app has: `https://staging.amodx.net/api/auth/callback/google`

**Test data not cleaned up**  
→ Run: `npm run test:cleanup`

---

## Testing Philosophy

1. **Unit tests** verify logic without AWS
2. **Integration tests** verify AWS service interactions
3. **E2E tests** verify user workflows end-to-end
4. **Manual testing** for OAuth/Payment UI flows

**Do NOT test:**
- How Lambda works (trust AWS)
- How DynamoDB works (trust AWS)
- NextAuth internals (trust library)

**DO test:**
- Your business logic
- Your query patterns
- Your tenant isolation
- Your user workflows

---

## Contributing

Before submitting a PR:

1. Run all tests locally:
```bash
   npm test                 # Backend unit
   npm run test:integration # Backend integration
   npx playwright test      # E2E
```

2. Ensure no test data remains:
```bash
   npm run test:cleanup
```

3. Update this guide if you add new test types or infrastructure.

---

## Technical Debt

- **OAuth testing:** Requires manual verification of Google login UI
- **Paddle testing:** Cannot automate checkout overlay
- **MCP testing:** No automation for Claude Desktop integration
- **Cache timing:** CloudFront propagation is probabilistic (2-5 seconds)

These are **acceptable limitations**. Focus on what can be automated.
