# packages/shared — ARCHITECTURE.md

## Role in the System

This is the single source of truth for all domain types and validation schemas. Every other package depends on it. Zod schemas defined here are used at runtime for validation (backend, renderer) and at compile time for TypeScript type inference (admin, plugins, MCP server).

**Consumed by:** backend, admin, renderer, plugins, mcp-server

## Internal Structure

```
src/
├── index.ts            # All Zod schemas, types, enums, constants; re-exports the modules below
├── normalizeEmail.ts   # normalizeEmail() — the canonical email identity primitive (PD-001, slice fnd-1)
├── media.ts            # Upload/MIME classification (classifyMedia, validateUpload, …)
└── country-packs/      # Per-country locale/currency/address packs
```

`src/index.ts` is the single public entry point: every sibling module is re-exported from it,
so consumers always import from `@amodx/shared` and never from a subpath. The schemas live in
`index.ts` itself; a sibling module exists only where the code is **behaviour rather than
shape** — a function with its own contract and its own test file.

## Domain Entities

### Enums

| Enum | Values | Used By |
|------|--------|---------|
| ContentStatus | Draft, Published, Archived | Content lifecycle |
| AccessType | Public, LoginRequired, Group, Purchase, EmailGate | Content gating |
| CommentsMode | Enabled, Locked, Hidden | Per-page comment control |
| SchemaType | Organization, Corporation, LocalBusiness, SoftwareApplication, Person, Article, WebPage | JSON-LD SEO |
| TenantStatus | LIVE, SUSPENDED, OFF | Site operational state |
| UserRole | GLOBAL_ADMIN, CLIENT_ADMIN, EDITOR | RBAC |
| ProductStatus | active, archived, draft | Product lifecycle |
| Availability | in_stock, out_of_stock, preorder | Inventory |
| Condition | new, refurbished, used | Product condition |
| WorkItemStatus | Draft, PendingApproval, Scheduled, Completed, Failed | Automation tasks |
| SignalStatus | New, Drafted, Replied, Dismissed | Outbound lead tracking |
| SignalSource | Reddit, Twitter, LinkedIn, Web | Signal origin platform |

### Core Schemas (with inferred types)

| Schema | Type | Purpose |
|--------|------|---------|
| TenantConfigSchema | TenantConfig | Complete site configuration (domain, theme, integrations, GDPR, nav, plan) |
| ContentItemSchema | ContentItem | Page/post with blocks, SEO, access policy, theme overrides |
| RouteSchema | Route | URL slug mapping to content nodes, supports redirects |
| CommentSchema | Comment | User comment with moderation status |
| ContextItemSchema | ContextItem | Strategy documents with tags and blocks |
| WorkItemSchema | WorkItem | Automation tasks (social, email, research, audit) |
| ProductSchema | Product | E-commerce product with pricing, inventory, Paddle integration |
| LeadSchema | Lead | Email capture with source tracking and status |
| AssetSchema | Asset | S3 media file metadata (URL, size, type) |
| AuditLogSchema | AuditLog | Activity log entry (actor, action, entity, IP) |
| UserProfileSchema | UserProfile | Staff identity linked to Cognito (role, tenantId) |
| TenantMemberSchema | TenantMember | End-user/customer identity (Member/Subscriber/VIP) |
| AccessPolicySchema | AccessPolicy | Content access control rules |
| ThemeSchema | Theme | Color palette, fonts, border radius, light/dark mode |
| SavedThemeSchema | SavedTheme | Named reusable theme in theme library |
| IntegrationsSchema | Integrations | Third-party connections (GA, Paddle, OAuth, analytics) |
| GDPRConfigSchema | GDPRConfig | Cookie consent banner settings |
| HeaderConfigSchema | HeaderConfig | Navigation header display options |
| SignalSchema | Signal | Outbound lead signal (URL, pain score, wallet signal, analysis, draft reply) |

### Constants

- `THEME_PRESETS` — 5 built-in themes: standard, midnight, editorial, corporate, vibrant
- `MAX_REVIEW_IMAGES` (= 12) — upper bound on photos carried INLINE (as metadata) on one
  `ReviewSchema` row (D-REV-1, ratified). Bounds the entry COUNT, not photo size (bytes live in
  S3). It bounds only the images' CONTRIBUTION to the item: 12 × ~2.1 KB worst-case metadata
  ≈ 25 KB (< 7% of the DynamoDB 400 KB item cap). It is not a whole-item size guarantee —
  `ReviewSchema.content` and other string fields are unbounded. See the constant's header in
  `src/index.ts` for the full budget; `plan-reviews-import.md` D-REV-1.

### Functions

| Function | Contract | Used by |
|----------|----------|---------|
| `normalizeEmail(raw)` | `NFKC → trim → lowercase`. Pure, deterministic, idempotent, no locale/env/IO. Its output IS the `CUSTOMER#<email>` sort key and the pre-image of the Cognito username hash (PD-001) | **Nothing yet** — slice `fnd-1` added the primitive and migrated zero call sites by design; `fnd-2` migrates the 14 inline sites (inventory in `docs/slices/fnd-1-normalize-email.md`) |

> **`normalizeEmail` is not an ordinary helper.** Changing its output is a DynamoDB key
> migration across every tenant, not a refactor. Its order of operations is load-bearing and
> pinned by `test/normalizeEmail.test.ts` — read the module header before touching it.

## Key Patterns

- **Zod-first design:** Types are inferred from schemas via `z.infer<>`, never manually defined
- **Multi-tenancy:** Every entity except SavedTheme has `tenantId`
- **Blocks as `any[]`:** ContentItem and ContextItem store Tiptap JSON blocks without schema enforcement at this level (plugin schemas handle block-level validation)
- **Default values:** Most fields have sensible defaults in the Zod schema, making partial creation safe
- **Theme overrides:** ContentItem supports per-page `themeOverride` and `darkThemeOverride` as partial Theme objects

## When Modifying

- Adding a new entity: define the Zod schema, export the inferred type, add to this file
- Adding a field: add with a default value to preserve backward compatibility with existing DynamoDB items
- Changing an enum: search all consumers — backend handlers, admin forms, renderer pages, MCP tools
- Rebuild after changes: `cd packages/shared && npm run build`, then rebuild dependents
