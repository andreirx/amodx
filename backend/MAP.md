# backend — MAP.md

## Role in the System

The API layer. All Lambda functions behind API Gateway HTTP API. Handles CRUD for every entity, authentication, authorization, audit logging, email sending, payment webhooks, and content import. The admin panel and renderer both call this backend.

**Consumed by:** admin (via HTTP), renderer (via HTTP and direct DynamoDB), mcp-server (via HTTP)
**Depends on:** packages/shared (Zod schemas, types)

## Internal Structure

```
src/
├── lib/
│   ├── db.ts              # DynamoDB DocumentClient singleton + TABLE_NAME
│   └── events.ts          # EventBridge publishAudit() helper
├── auth/
│   ├── authorizer.ts      # Lambda authorizer (Cognito JWT + API key)
│   ├── context.ts         # AuthorizerContext type definition
│   └── policy.ts          # requireRole(auth, roles[], tenantId?) access control
├── content/
│   ├── create.ts          # POST /content
│   ├── list.ts            # GET /content
│   ├── get.ts             # GET /content/{id}
│   ├── update.ts          # PUT /content/{id}
│   ├── history.ts         # GET /content/{id}/versions
│   └── restore.ts         # POST /content/{id}/restore
├── products/
│   ├── create.ts          # POST /products
│   ├── list.ts            # GET /products
│   ├── get.ts             # GET /products/{id}
│   ├── update.ts          # PUT /products/{id}
│   └── delete.ts          # DELETE /products/{id}
├── comments/
│   ├── create.ts          # POST /comments (public or authed)
│   ├── list.ts            # GET /comments
│   └── moderate.ts        # POST /comments/moderate
├── leads/
│   ├── create.ts          # POST /leads (public, no auth)
│   └── list.ts            # GET /leads
├── context/
│   ├── create.ts          # POST /context
│   ├── list.ts            # GET /context
│   ├── get.ts             # GET /context/{id}
│   ├── update.ts          # PUT /context/{id}
│   └── delete.ts          # DELETE /context/{id}
├── tenant/
│   ├── create.ts          # POST /tenant (Global Admin only)
│   ├── list.ts            # GET /tenant
│   └── settings.ts        # GET/PUT /tenant/settings
├── users/
│   └── invite.ts          # POST /users/invite (Cognito AdminCreateUser)
├── resources/
│   └── presign.ts         # POST /resources/upload-url, GET /resources/{id}/download-url
├── assets/
│   ├── create.ts          # POST /assets (returns presigned upload URL)
│   └── list.ts            # GET /assets
├── audit/
│   ├── worker.ts          # EventBridge consumer → writes audit log to DynamoDB
│   ├── list.ts            # GET /audit
│   └── graph.ts           # GET /audit/graph (content link graph)
├── contact/
│   └── send.ts            # POST /contact (public, sends SES email)
├── consent/
│   └── create.ts          # POST /consent (public, GDPR tracking)
├── themes/
│   └── manage.ts          # Theme CRUD (create, list, delete handlers)
├── webhooks/
│   └── paddle.ts          # POST /webhooks/paddle (payment fulfillment + SES email)
└── import/
    ├── wordpress.ts       # WordPress XML import handler
    ├── wxr-parser.ts      # WXR XML parser utility
    └── html-to-tiptap.ts  # HTML → Tiptap JSON converter

test/
├── setup.ts               # Loads .env.test, validates TABLE_NAME
├── utils.ts               # createEvent(), generateTenantId(), cleanupTenant()
├── content.test.ts
├── products.test.ts
├── comments.test.ts
├── leads.test.ts
├── tenant.test.ts
└── isolation.test.ts      # Cross-tenant isolation verification
```

## Authentication

Three modes, checked in order by `auth/authorizer.ts`:

1. **Master API Key** — `x-api-key` header matched against AWS Secrets Manager. Returns `{sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL"}`
2. **Cognito JWT** — `Authorization: Bearer <idToken>`. Extracts `custom:role` and `custom:tenantId` from token claims
3. **Public routes** — `POST /leads`, `POST /contact`, `POST /consent` bypass auth entirely

Access control via `requireRole(auth, allowedRoles[], targetTenantId?)` in `auth/policy.ts`. GLOBAL_ADMIN always passes. Others must match both role and tenant scope.

## DynamoDB Single-Table Design

All entities in one table. Partition key `PK`, sort key `SK`.

| Entity | PK | SK Pattern |
|--------|----|-----------|
| Tenant config | `SYSTEM` | `TENANT#<id>` |
| Content (latest) | `TENANT#<id>` | `CONTENT#<nodeId>#LATEST` |
| Content (version) | `TENANT#<id>` | `CONTENT#<nodeId>#v<N>` |
| Route | `TENANT#<id>` | `ROUTE#<slug>` |
| Product | `TENANT#<id>` | `PRODUCT#<productId>` |
| Comment | `TENANT#<id>` | `COMMENT#<pageId>#<timestamp>` |
| Lead | `TENANT#<id>` | `LEAD#<email>` |
| Context | `TENANT#<id>` | `CONTEXT#<id>` |
| Asset | `TENANT#<id>` | `ASSET#<assetId>` |
| Resource | `TENANT#<id>` | `RESOURCE#<resourceId>` |
| Audit log | `TENANT#<id>` | `AUDIT#<timestamp>#<id>` |
| Consent | `TENANT#<id>` | `CONSENT#<visitorId>#<timestamp>` |

**GSIs:** GSI_Domain (lookup tenant by domain), GSI_Type (list by entity type), GSI_Status (workflow queries)

## Key Patterns

- **Content versioning:** Update writes a snapshot at `CONTENT#<nodeId>#v<N>` before overwriting `#LATEST` with `v<N+1>`
- **Slug redirects:** When a slug changes, old route gets `IsRedirect=true` pointing to new slug (SEO preservation)
- **Transactional writes:** `TransactWriteCommand` for multi-item consistency (content + route creation)
- **Conditional writes:** `ConditionExpression="attribute_not_exists(SK)"` prevents duplicate slugs/IDs
- **Audit trail:** Handlers call `publishAudit()` → EventBridge → `audit/worker.ts` → DynamoDB. Non-blocking.
- **Presigned S3 URLs:** Assets get 5-min upload URLs. Resources get 15-min download URLs. Paddle fulfillment gets 24-hour URLs.
- **Lead upsert:** Leads keyed by email — PUT overwrites, so re-submissions update rather than duplicate
- **Pagination:** Manual loop with `LastEvaluatedKey`, safety cap at 20 iterations

## Response Format

```typescript
// Success
{ statusCode: 200 | 201, body: JSON.stringify({ ...data }) }

// Error
{ statusCode: 400 | 403 | 404 | 409 | 500, body: JSON.stringify({ error: "message" }) }
```

## Testing

Vitest with real DynamoDB (staging table via `.env.test`). Test utilities in `test/utils.ts`:
- `createEvent(tenantId, body?, pathParams?, queryParams?, userId?, role?, email?)` — builds API Gateway V2 event
- `generateTenantId()` — creates unique `test-<timestamp>-<random>` IDs
- `cleanupTenant(tenantId)` — deletes all items for tenant in batches of 25

Run: `cd backend && npm test` or `npx vitest run <path>` for a single file.
