# infra — ARCHITECTURE.md

## Role in the System

AWS CDK infrastructure-as-code. Defines and deploys all cloud resources: DynamoDB, Lambda functions, API Gateway, Cognito, S3, CloudFront, EventBridge, Route53, ACM certificates. A single stack serves both production and staging via a suffix-based naming convention.

**Depends on:** backend (Lambda handler source code), admin (Vite build output), renderer (OpenNext build output)

## Internal Structure

```
bin/
└── infra.ts                    # CDK App entry point: reads stage context, loads config file

lib/
├── amodx-stack.ts              # Main stack: composes all constructs, wires dependencies
├── api.ts                      # HTTP API Gateway + 30+ Lambda functions + authorizer
├── auth.ts                     # Two Cognito User Pools (Admin invite-only, Public self-signup)
├── database.ts                 # DynamoDB single table with 3 GSIs
├── uploads.ts                  # S3 buckets (public assets + private resources) + CloudFront CDN
├── domains.ts                  # Route53 hosted zone + ACM certificates (global + regional)
├── events.ts                   # EventBridge bus + audit rule + dead letter queue
├── config-generator.ts         # Writes runtime config to S3 for admin/renderer
├── admin-hosting.ts            # S3 + CloudFront for admin SPA deployment
└── renderer-hosting.ts         # OpenNext → Lambda + CloudFront for Next.js SSR

test/
├── amodx-stack.test.ts         # Real `Template.fromStack` assertions over the whole stack
└── no-dotenv.cjs               # `.env*` blindfold for the builds the synth spawns
```

See § *Testing* near the end of this document — the suite has behaviour worth knowing about
before you run it.

## Stack Composition (`amodx-stack.ts`)

```
AmodxStack
├── Secrets (Master API Key + NextAuth Secret via Secrets Manager)
├── AmodxUploads (S3 assets + S3 private + CloudFront CDN)
├── AmodxDatabase (DynamoDB table + 3 GSIs)
├── AmodxAuth (Admin Cognito Pool + Public Cognito Pool)
├── AmodxEvents (EventBridge bus + Audit rule + SQS DLQ)
├── AmodxApi (HTTP API Gateway + 30+ Lambdas + Custom Authorizer)
├── AmodxRendererHosting (OpenNext Lambda + CloudFront)
├── AmodxAdminHosting (S3 + CloudFront)
├── AmodxDomains (Route53 + ACM certs)
└── ConfigGenerator (Runtime config written to S3)
```

## Environment Strategy

Controlled by `-c stage=<name>` CDK context flag:

| Aspect | Production | Staging |
|--------|-----------|---------|
| Config file | `amodx.config.json` | `amodx.staging.json` |
| Stack name | `AmodxStack` | `AmodxStack-staging` |
| Resource suffix | (none) | `-staging` |
| Table | `AmodxTable` | `AmodxTable-staging` |
| Removal policy | RETAIN | RETAIN |

All resources tagged with `Stage` and `Project: AMODX`.

## DynamoDB Table (`database.ts`)

- **Billing:** PAY_PER_REQUEST (serverless auto-scaling)
- **PITR:** Enabled
- **Removal policy:** RETAIN

| Index | PK | SK | Purpose |
|-------|----|----|---------|
| Primary | PK (STRING) | SK (STRING) | All entity access |
| GSI_Domain | Domain (STRING) | PK (STRING) | Tenant lookup by domain |
| GSI_Type | Type (STRING) | CreatedAt (STRING) | List entities by type |
| GSI_Status | Status (STRING) | ScheduledFor (STRING) | Workflow/inbox queries |

## Lambda Configuration (`api.ts`)

Standard template for all functions:
- Runtime: Node.js 22.x
- Memory: 1024 MB (3008 MB for import function)
- Timeout: 29 seconds (15 min for import)
- Bundling: esbuild, minified, source maps, `@aws-sdk/*` external
- Environment: TABLE_NAME, EVENT_BUS_NAME, SES_FROM_EMAIL, secret names, bucket names

30+ functions covering: content CRUD (6), products (5), comments (3), signals (3), leads (2), context (5), tenant (3), users (1), resources (3), assets (2), audit (3), contact (1), consent (1), themes (3), webhooks (1), import (1).

Custom Lambda authorizer validates Cognito JWT or master API key. Public routes (`POST /leads`, `/contact`, `/consent`) bypass auth.

## Storage (`uploads.ts`)

| Bucket | Access | CDN | Purpose |
|--------|--------|-----|---------|
| `amodx-assets{-suffix}` | CORS PUT/POST from browser | CloudFront with OAC | Public images/media |
| `amodx-private{-suffix}` | Lambda presigned URLs only | None | Gated downloads, digital products |

Both buckets: `BlockPublicAccess.BLOCK_ALL`, removal policy RETAIN.

## Certificates & DNS (`domains.ts`)

Two-certificate strategy:
1. **Global cert** (us-east-1) — required by CloudFront. Covers `root-domain` + `*.root-domain`
2. **Regional cert** (stack region) — for API Gateway custom domain (`api.root-domain`)

Optional `globalCertArn` in config imports a pre-managed wildcard cert covering tenant custom domains.

## Config Generator (`config-generator.ts`)

Writes runtime config files to S3 during deployment:
- **Admin config:** API URL, Cognito pool IDs, region, renderer URL → served as `/config.json`
- **Renderer config:** TABLE_NAME, API_URL, NEXTAUTH_SECRET, API key secret name → Lambda env vars

Uses `AwsCustomResource` with `S3.putObject`, cache-control `no-cache`.

## Testing

`cd infra && npm test` — jest + ts-jest, CI job `infra-synth`. Added by slice `test-4`;
rationale and the assertion → ratified-property map are in
`docs/slices/test-4-infra-truth.md`.

`test/amodx-stack.test.ts` synthesizes the **real** `AmodxStack` once and makes 15 named
assertions over the resulting template: the CloudFront cache key (header + query allowlists,
`CookieBehavior: none`, TTLs), the viewer-request Function on the default and `api/*`
behaviors, `api/*` = CACHING_DISABLED, the S3 static behaviors, the
`cloudfront:CreateInvalidation` blast radius (4 roles, asserted in two named categories: the
**3 request-path** cache Lambdas — the least-privilege set — plus **1 deploy-time** role, CDK's
`BucketDeployment` custom resource), and both flush schedules. Not a snapshot: a snapshot over
410 resources gets re-blessed instead of read.

Three things to know before running it:

- **It takes ≈58 s and rebuilds `renderer/.open-next` and `admin/dist`.** Not a design choice
  of the test — `RendererHosting` and `AdminHosting` run those builds inside their constructors
  (`lib/renderer-hosting.ts:62`, `lib/admin-hosting.ts:31`), so *any* synth does this. Both are
  gitignored outputs that a deploy regenerates. Tracked in `docs/TECH-DEBT.md`.
  Consequence to know: consecutive runs are **not** independent. If a run is interrupted, the
  next one can die in `beforeAll` with `ENOTEMPTY … .next/standalone/node_modules/next` and
  report *all 15* assertions red for a reason unrelated to infra — `rm -rf renderer/.next` and
  re-run before believing a wholesale failure.
- **It is credential-free and enforces that itself.** The test stack passes
  `config: { domains: {} }`, so `AmodxDomains` — the only synth-time context provider
  (`HostedZone.fromLookup`) — is never built; and the suite strips credential-shaped
  environment variables, closes the SDK's file and IMDS credential paths, and hides
  `renderer/.env*` + `admin/.env*` from the whole spawned process tree via `no-dotenv.cjs`.
  Assertions `(iso1)`–`(iso3)` fail if any of that regresses.
- **`jest.config.js` pins `moduleFileExtensions` with `ts` before `js`,** the jest equivalent of
  the `--prefer-ts-exts` that `cdk.json` passes to ts-node. `lib/` and `bin/` carry untracked
  compiled `*.js` leftovers from before `tsconfig.json` gained `noEmit: true`; without the pin,
  jest loads those instead of the sources. Assertion `(src1)` fails if the pin is removed.

## Deployment

```bash
# First time
npm run setup              # Interactive wizard (root)

# Deploy
cd infra && npx cdk deploy                          # Production
cd infra && npx cdk deploy -c stage=staging          # Staging

# Post-deploy
npm run post-deploy        # Writes runtime configs, sets up MCP server
```
