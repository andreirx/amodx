# Database Patterns (Single-Table DynamoDB)

## Table Layout

All entities share one table with composite keys:
- **PK** (partition): `TENANT#<id>` or `SYSTEM`
- **SK** (sort): Entity-specific pattern

| Entity | PK | SK Pattern |
|--------|----|-----------:|
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
| Signal | `TENANT#<id>` | `SIGNAL#<signalId>` |
| Consent | `TENANT#<id>` | `CONSENT#<visitorId>#<timestamp>` |

**GSIs:** GSI_Domain (tenant by domain), GSI_Type (list by entity type), GSI_Status (workflow queries).

## Hard Rules

1. **No Scans.** Never use `ScanCommand` in production paths. Use `QueryCommand` with `PK` and `SK`.
2. **Always project.** List handlers (`backend/src/*/list.ts`) must use `ProjectionExpression` to fetch metadata only. Never fetch full content blocks in a list view.
3. **Tenant isolation.** Every DB operation must validate `x-tenant-id` header. Never query `TENANT#...` without explicit tenant context.
4. **System routes are immutable.** Backend handlers must not allow deletion/rename of `/` and `/contact` routes.

## Content Versioning (Copy-on-Write)

When updating content:
1. Read current `CONTENT#<id>#LATEST` (has `version: N`).
2. Copy it to `CONTENT#<id>#v<N>` (snapshot).
3. Overwrite `LATEST` with new data at `version: N+1`.

## Slug Redirects

When a slug changes, the old `ROUTE#<old-slug>` gets `IsRedirect=true` pointing to the new slug (preserves SEO).

## Conditional & Transactional Writes

- **Prevent duplicates:** `ConditionExpression: "attribute_not_exists(SK)"` on creates.
- **Multi-item consistency:** Use `TransactWriteCommand` for content + route creation.

## Audit Trail

Handlers call `publishAudit()` → EventBridge → `audit/worker.ts` → DynamoDB. Non-blocking.

Requirements:
- `actor.email` — human-readable, not just UUID
- `target.title` — entity name, not just ID
- Include enough snapshot data to be useful without re-querying
