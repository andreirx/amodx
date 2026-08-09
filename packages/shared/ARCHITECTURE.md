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
| `deriveEmailDnsValue(kind, domain)` | Pure. Computes a recipe value that depends on the tenant domain. Only variant today: `"m365-mx"` → `<domain dots→dashes>.mail.protection.outlook.com`. Exhaustive `switch` with an `assertNever` default — a new `EmailDnsDerivation` variant breaks the compile until handled. Consumed on BOTH sides of the admin↔backend boundary (slice `email-2`) | `backend/src/email/dns-check.ts` (server-authoritative `expected` for the M365 MX check) and `admin/src/pages/Email.tsx` (mirrors the same target for display/copy) |

### Email guided-DNS catalogue (`EMAIL_PROVIDER_RECIPES`, slice `email-2`)

Data-not-code recipes (Google Workspace / Microsoft 365 / Zoho / keep-existing) plus the
`EmailDns*` DTOs that cross the admin↔backend boundary as raw JSON. Lives in `shared`
because BOTH admin (renders the table) and the backend DNS-check handler (owns the
server-authoritative `expected` value) consume it — the slice's own promotion gate.

- `EmailProviderRecipe` / `EmailDnsRecipeRecord` — a provider's publishable record set.
  `replacesMailRouting` is coupled to actually having an MX row (the destructive-advice
  guard). A row's expected value is **static** (`value`), **derived** (`derive`, computed
  from the domain — checkable), or **console-generated** (`checkable:false`, guidance only,
  never checked). DMARC is deliberately EXCLUDED — it is `email-3`'s sending-health surface.
- `EmailDnsCheckResponse` / `EmailDnsCheckRecordResult` — one read-only check's result.
  Each row carries `recordIndex` (collision-free identity — a recipe may hold several
  same-`(type,host)` rows, e.g. Zoho's three MX), `expectedPriority` + `observedMx` (MX
  preference is compared — a right exchange at the wrong priority is a mismatch, not a
  match), and `observedTtl` (null for MX/TXT/CNAME; the UI shows the resolver limitation).
  `EmailDnsCheckStatus` = `match | mismatch | missing | error`; `missing`/`error` are
  AMBIGUOUS (never a permanent verdict).

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
