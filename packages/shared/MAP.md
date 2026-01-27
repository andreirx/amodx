# packages/shared — MAP.md

## Role in the System

This is the single source of truth for all domain types and validation schemas. Every other package depends on it. Zod schemas defined here are used at runtime for validation (backend, renderer) and at compile time for TypeScript type inference (admin, plugins, MCP server).

**Consumed by:** backend, admin, renderer, plugins, mcp-server

## Internal Structure

```
src/
└── index.ts    # Single monolithic file (~524 lines) exporting all schemas, types, enums, and constants
```

Everything lives in one file. All exports are top-level from `src/index.ts`.

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

### Constants

- `THEME_PRESETS` — 5 built-in themes: standard, midnight, editorial, corporate, vibrant

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
