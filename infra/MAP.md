# infra — MAP.md

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
└── infra.test.ts               # Jest test for stack synthesis
```

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

30+ functions covering: content CRUD (6), products (5), comments (3), leads (2), context (5), tenant (3), users (1), resources (3), assets (2), audit (3), contact (1), consent (1), themes (3), webhooks (1), import (1).

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
