# packages/shared — ARCHITECTURE.md

## Role in the System

This is the single source of truth for all domain types and validation schemas. Every other package depends on it. Zod schemas defined here are used at runtime for validation (backend, renderer) and at compile time for TypeScript type inference (admin, plugins, MCP server).

**Consumed by:** backend, admin, renderer, plugins, mcp-server

## Internal Structure

```
src/
├── index.ts            # All Zod schemas, types, enums, constants; re-exports the modules below
├── normalizeEmail.ts   # normalizeEmail() — the canonical email identity primitive (PD-001, slice fnd-1)
├── slug.ts             # normalizeSlug(), needsSlugReview() — the content-slug rule (backend-contract-1 D3; moved here by import-policy-1)
├── media.ts            # Upload/MIME classification (classifyMedia, validateUpload, …)
├── facets.ts           # Catalog storefront filter rules: buildFacetListing, the URL form, filter modes (cat-facets-1, cat-import-profile-1b)
├── catalog-listing.ts  # Catalog listing rule: catalogListing, isProductAvailable(p, today), utcDay, catalogListingPath (cat-import-profile-1b)
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
| ProductSchema | Product | E-commerce product with pricing, inventory, Paddle integration; importer-owned `importSource`, `facetModes`, `importProfileRevision` (omitted from the authoring input by products/create.ts, update.ts) |
| GlamImportProfileSchema | GlamImportProfile | CAT-IMPORT-PROFILE-1: per-producer import profile (grouping, collection source, `specKeys` rules, `facetModes`); every object STRICT — an unknown key, value or version fails the parse, never stripped |
| SpecKeyRuleSchema | SpecKeyRule | One spec key → `attribute { label, split }` or `prose-only` |
| FacetModesSchema | FacetModes | Filter modes per stored attribute key (`always` / `never`), `variant: never`; absence = automatic |
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
| `normalizeSlug(raw)` | Pure. lowercase + trim → `[\s_]+`→`-` → strip `[^a-z0-9-/]` → collapse `-+` → strip trailing `-` → ensure leading `/`. Applied to a slug supplied to create and to a changed slug on update; NOT applied by the WordPress importer, which stores `/<wp:post_name>` raw by human decision (slice `import-policy-1`). Full contract in the module header | `backend/src/content/create.ts`, `backend/src/content/update.ts`, `admin/src/pages/ContentEditor.tsx` ("saved as" text) |
| `needsSlugReview(slug)` | Pure. `slug !== normalizeSlug(slug)` — a text rule only: it says the slug breaks the slug rules, it knows nothing of where the slug came from | `admin/src/pages/ContentList.tsx` (REVIEW SLUG badge), `admin/src/pages/ContentEditor.tsx` (red URL line) |
| `buildFacetListing(base, f, path)` (+ `parseSelection`, `formatSelection`, `listingHref`, `selectionFits`, `facetValuesOf`, `compareValues`, …) | Pure. The catalog filter panel model: from a base set, the raw `f` and the page path — the filtered items, the shown facets with disjunctive counts, chips, and every href measured against the 6,144-byte budget. Facet set = producer, variant values, then every attribute key that is offered. Filter modes (`facetModes` on a product, design `cat-import-profile-1` § 2.6, ruling S-A with N2): a product marking a facet `never` is a silent holder — its values neither count toward the offer nor are listed, but still match a selection and count in the listed values; `always` offers a key whatever the repeat rule gives; unknown or malformed modes = automatic. Moved from `renderer/src/lib/facets.ts` by `cat-import-profile-1b` (ruling CIP1-PREVIEW = A). Full contract in the module header | `renderer/src/components/SitePage.tsx` (catalog shop and category); admin import preview (slice `cat-import-profile-1c`, not built yet) |
| `catalogListing(items, categoryId \| undefined, today)` | Pure. Which products a catalog page lists, in which order: shop `status === "active"`; category `!status \|\| status === "active"` and `categoryIds` holds the id; then `isProductAvailable(p, today)`; then `sortOrder` (absent = 0), ties by `id`. `today` = `utcDay(now)` (UTC `YYYY-MM-DD`; injected — the module reads no clock). Behaviour of the renderer's former inline rule, pinned by the 1b golden | `renderer/src/lib/dynamo.ts` (`getCatalogListing`; its other availability checks call `isProductAvailable`); admin import preview (1c) |
| `catalogListingPath(prefixes, categorySlug \| undefined)` | Pure. The public path of a catalog page without `basePath`: shop `prefixes.shop \|\| "/magazin"` (the renderer's literal fallback, kept), category `` `${prefixes.category}/${slug}` ``. The path is an input of the URL budget, so both callers must pass the same string | `renderer/src/components/SitePage.tsx`; admin import preview (1c) |
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
- Changing `facets.ts` or `catalog-listing.ts` changes what every catalog site lists and filters. The 1b golden
  (`test/cat-import-profile-1b-golden.test.ts` over `test/fixtures/cat-import-profile-1b-baseline.json`, captured from
  `2cf738e` by `test/fixtures/cat-import-profile-1b-capture/run.sh`) must stay green: a red row there is a behaviour
  change for products without `facetModes`, not a test to update. Run the renderer serving suite too
  (`cd renderer && npm run test:serving`, rows `cf1-*`, `cip1b-*`)
