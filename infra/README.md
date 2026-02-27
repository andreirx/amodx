# Infrastructure

AWS CDK (TypeScript) — 9 constructs across 3 CloudFormation stacks.

## Stack

- **CDK 2** (`aws-cdk-lib ^2.232.1`)
- **TypeScript 5.9**
- Deployment region: configurable (default `eu-central-1`)

## Constructs

| File | Purpose | Key resources |
|------|---------|--------------|
| `amodx-stack.ts` | Main orchestrator | Wires all constructs together |
| `database.ts` | DynamoDB | Single table, PAY_PER_REQUEST, PITR, 4 GSIs (Domain, Type, Status, Slug) |
| `auth.ts` | Cognito | 2 user pools — admin (invite-only) + public (self-signup). Custom attributes: role, tenantId |
| `api.ts` | Core API | API Gateway HTTP v2 + Lambda authorizer + ~50 handlers. Rate limit 50/s, burst 100 |
| `api-commerce.ts` | Commerce API | NestedStack. Categories, products, orders, customers, delivery, coupons, reviews, reports |
| `api-engagement.ts` | Engagement API | NestedStack. Popups, forms |
| `renderer-hosting.ts` | Renderer | Lambda Function URL + CloudFront + S3 (static + ISR cache). CloudFront Function for X-Forwarded-Host |
| `admin-hosting.ts` | Admin SPA | S3 + CloudFront + OAC. SPA routing (403/404 → index.html). ConfigGenerator custom resource |
| `uploads.ts` | Storage | 2 S3 buckets (public assets + private resources) + CDN distribution for assets |
| `events.ts` | EventBridge | Custom bus + audit rule + worker Lambda + DLQ |
| `domains.ts` | DNS + SSL | Route53 records (apex, wildcard, admin, api) + ACM certs (global us-east-1 + regional) |
| `config-generator.ts` | Runtime config | Custom resource that writes `config.json` to admin S3 bucket |

## NestedStack Pattern

CloudFormation has a 500-resource limit. The API grew to 710+ resources, so commerce and engagement routes live in nested stacks. Nested stacks use L1 constructs (`CfnRoute`, `CfnIntegration`, `CfnAuthorizer`) because `httpApi.addRoutes()` creates resources in the parent stack.

Each nested stack creates its own `CfnAuthorizer` referencing the parent's auth Lambda ARN.

## Domain Strategy

`amodx.config.json` defines the root domain and tenant custom domains. The `manage-domains` script requests a single ACM certificate covering all domains in `us-east-1` (CloudFront requirement).

CloudFront distributions:
1. `admin.{domain}` → S3
2. `{domain}` + `*.{domain}` + tenant domains → Lambda Function URL
3. `cdn.{domain}` → S3 assets bucket

## Lambda Configuration

Default: Node.js 22, ARM64, 1024MB, 29s timeout, esbuild bundled.
Import handlers: 3GB, 15min timeout.
External: `@aws-sdk/*` (provided by Lambda runtime).

## Commands

```bash
npm run build       # Compile TypeScript
npm run cdk deploy  # Deploy all stacks
npm run cdk diff    # Preview changes
```
