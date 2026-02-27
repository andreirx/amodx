# Backend

100+ Lambda handlers (Node.js 22, ARM64) behind API Gateway HTTP v2. esbuild bundled with source maps.

## Stack

- **Node.js 22** (ARM64) — 20% cheaper than x86
- **AWS SDK v3** — DynamoDB, Cognito, SES, EventBridge, S3, Secrets Manager
- **aws-jwt-verify** — Cognito JWT validation
- **fast-xml-parser** — WordPress WXR import
- **esbuild** — bundled by CDK, minified + source maps
- **Vitest** — tests against real staging DynamoDB

## Auth (3 modes)

Single Lambda authorizer (`src/auth/authorizer.ts`):

1. **Admin users**: Cognito JWT in `Authorization` header. Custom attributes: `role`, `tenantId`
2. **Robots** (MCP, renderer): `x-api-key` against Secrets Manager
3. **Public routes**: `/public/*` uses `HttpNoneAuthorizer` (no auth)

Roles: `GLOBAL_ADMIN` (cross-tenant), `TENANT_ADMIN`, `EDITOR`

## Modules (30)

| Module | Handlers | Key patterns |
|--------|----------|-------------|
| `content` | 7 | Auto-versioning on update, slug-guard checks commerce prefix conflicts |
| `products` | 8 | `productType` field (physical/digital), CATPROD# adjacency, availability date filtering |
| `categories` | 8 | CATPROD# dual-write on product assignment |
| `orders` | 6 | TransactWrite (ORDER# + CUSTORDER# + CUSTOMER# upsert), atomic counter for order numbers, SES email per status |
| `customers` | 3 | Upserted from orders, CUSTORDER# adjacency for order history |
| `delivery` | 3 | 5-level date priority (unblockedDates > blockedDates > yearlyOffDays > weekday > default) |
| `coupons` | 6 | COUPON# + COUPONCODE# dual-write, atomic usage increment at checkout |
| `reviews` | 5 | REVIEW#productId#reviewId key pattern |
| `forms` | 7 | FORM# + FORMSLUG# dual-write, SES notification on public submit |
| `popups` | 6 | Trigger types: page_load, exit_intent, scroll, time_delay |
| `reports` | 1 | Aggregates orders → KPIs, by-status, by-payment, by-month, top products |
| `import` | 2 | WooCommerce CSV (two-pass variable→variants) + WordPress WXR |
| `auth` | 1 | Lambda authorizer (JWT + API key + public whitelist) |
| `audit` | 3 | EventBridge consumer + graph visualization + list |
| `tenant` | 3 | Tenant CRUD |
| `users` | 4 | Cognito user management + SES invite emails |
| `contact` | 1 | Form → SES |
| `webhooks` | 1 | Paddle payment processing |
| `signals`, `research`, `leads`, `consent`, `context`, `assets`, `resources`, `comments`, `themes` | various | Supporting modules |

## Event-Driven Architecture

All mutations call `publishAudit()` → EventBridge custom bus → Audit Worker Lambda → DynamoDB `AUDIT#` records. DLQ on worker prevents event loss. Handlers never write audit logs directly.

## Database Patterns

- **Single table**: All entities in one DynamoDB table, PK+SK access patterns
- **No scans**: Always `QueryCommand`. List handlers use `ProjectionExpression`
- **Dual-writes**: `TransactWriteCommand` for consistency (orders, coupons, forms)
- **Adjacency lists**: CATPROD#, CUSTORDER# for relationship queries
- **Atomic counters**: `COUNTER#ORDER` with `ADD` expression for order numbers
- **Tenant isolation**: Every handler validates `x-tenant-id`. Never cross-tenant queries

## CDK Registration

Main API stack (`infra/lib/api.ts`) + 2 nested stacks:
- `api-commerce.ts` — categories, products, orders, customers, delivery, coupons, reviews, reports, woo import
- `api-engagement.ts` — popups, forms

Nested stacks use L1 `CfnRoute`/`CfnIntegration` because `httpApi.addRoutes()` creates resources in the parent stack.

## Commands

```bash
npm test         # Vitest (real staging DynamoDB)
npx tsc --noEmit # Type check only
```
