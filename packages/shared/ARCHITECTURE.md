# packages/shared — ARCHITECTURE.md

## Role in the System

This is the single source of truth for all domain types and validation schemas. Every other package depends on it. Zod schemas defined here are used at runtime for validation (backend, renderer) and at compile time for TypeScript type inference (admin, plugins, MCP server).

**Consumed by:** backend, admin, renderer, plugins, mcp-server

## Internal Structure

```
src/
├── index.ts            # RE-EXPORTS ONLY (REFACTOR-SHARED-1): the rule modules below and every domain file; imports nothing for its own use
│
│   Domain files (schemas, types, constants and the small rules that belong to them; moved out of index.ts by REFACTOR-SHARED-1):
├── content.ts          # Content status/access enums, inline rich text, FULL_BLEED_DEFAULTS, AccessPolicySchema, RouteSchema, ContentItemSchema, CommentSchema
├── context-and-work-items.ts # ContextItemSchema (strategy documents), WorkItemStatus, WorkItemSchema
├── signals.ts          # SignalStatus, SignalSource, SignalSchema
├── tenant-config-parts.ts # The TenantConfigSchema parts without a file of their own: LinkSchema, quick contact, ContactChannelsSchema, top/commerce/search bars, reCAPTCHA, order e-mail templates, company + legal, MailerLiteSettingsSchema, IntegrationsSchema, HeaderConfigSchema, FooterConfigSchema, GDPRConfigSchema
├── url-prefixes.ts     # URL_PREFIX_DEFAULTS, UrlPrefixesSchema, urlPrefixesOf, catalogListingPath
├── theme.ts            # isCssColor / CssColorSchema, FontWeightSchema, ThemeSchema, SavedThemeSchema, THEME_PRESETS
├── tenant-config.ts    # TenantStatus, TenantConfigSchema, languageSettingsProblem (LANG-1 write rule), isCatalogMode
├── users-and-keys.ts   # UserRole, UserProfileSchema (staff), TenantMemberSchema (site members), ServiceKeyScope / ServiceKeyView
├── effects.ts          # GPU effect configuration (EffectConfigSchema, PageEffectConfigSchema, deprecated aliases)
├── locale-table.ts     # PluralTextsSchema, CommerceStringsSchema, CatalogStringsSchema, BookingStringsSchema, SiteStringsSchema; CountText, ResolvedPart, LocaleStrings
├── media-asset.ts      # AssetSchema (the stored media record; upload classification is media.ts)
├── leads-and-newsletter.ts # LeadSchema, the newsletter subscription schemas, newsletterCanSendAgain
├── audit-log.ts        # AuditLogSchema
├── products.ts         # ProductStatus, Availability, Condition, the product parts, deriveGallery, ProductSchema
├── glam-import-profile.ts # FacetModesSchema, SpecKeyRuleSchema, GlamImportProfileSchema, ImportLabelsSchema, IMPORT_LABELS_WITHOUT_MARKER
├── categories.ts       # CategorySchema
├── delivery.ts         # DeliveryConfigSchema
├── orders-and-customers.ts # Address, billing, order item, status history, PaymentStatusSchema, OrderSchema, CustomerSchema, the customer self-service read DTOs (CustomerSelfRequestSchema, StoredValue, OrderHistoryEntry, CustomerProfileView; CMRC-1B), the order-lookup DTOs (OrderLookupRequestSchema, ORDER_VIEW_FIELDS, OrderViewField, OrderView; CMRC-1L), OrderInputSchema, PriceChangedAnswer
├── order-price.ts      # linePrice, parseMoney, localeUsesDecimalComma, roundToCents, sameAmountInCents, toMachineFormPriceInputs
├── coupon-schema.ts    # CouponSchema (the stored record; the coupon RULE is coupon.ts)
├── reviews.ts          # MAX_REVIEW_IMAGES, ReviewImageSchema, ReviewSchema, ImportBatchSchema, the review-import report DTOs
├── popups.ts           # PopupSchema
├── forms-and-interest-list.ts # FormFieldSchema, formFieldsOf, FormDefinitionSchema, FormSubmissionSchema; INTEREST_FORM_ID and the interest-list API bodies
├── email-dns.ts        # EMAIL_PROVIDER_RECIPES, deriveEmailDnsValue, the EmailDns* DTOs (email-2)
│
│   Rule modules (behaviour with its own contract and test file):
├── normalizeEmail.ts   # normalizeEmail() — the canonical email identity primitive (PD-001, slice fnd-1)
├── slug.ts             # normalizeSlug(), needsSlugReview() — the content-slug rule (backend-contract-1 D3; moved here by import-policy-1)
├── media.ts            # Upload/MIME classification (classifyMedia, validateUpload, …)
├── facets.ts           # Catalog storefront filter rules: buildFacetListing (required `labels`, locale-1b), the URL form, filter modes (cat-facets-1, cat-import-profile-1b)
├── catalog-listing.ts  # Catalog listing rule: catalogListing, isProductAvailable(p, today), utcDay (cat-import-profile-1b; catalogListingPath left it in CDL-2 and is in url-prefixes.ts since REFACTOR-SHARED-1)
├── coupon.ts           # The coupon rule: evaluateCoupon(coupon, lines, now, customerUseCount?), amountInCents, isCouponType, CouponPrecheckItemSchema (coupon-fix-1)
├── payment-transition.ts # The payment-state rule: paymentTransition(previous, requested) (pay-1)
├── scheduling.ts       # SCHED-1A kernel (docs/slices/sched-1.md § 4, § 5; PROTOTYPE): the booking domain types as Zod
│                       #   schemas (one definition for stored items and request bodies) and the pure rules of the
│                       #   appointment shape (a slot with a practitioner) and of the week planner (slotDecision,
│                       #   overlapCheck, confirmDecision, changeDecision, activeEntries, planDay, editDays, …). No I/O,
│                       #   no clock. Persistence and concurrency live in its first consumer,
│                       #   backend/src/lib/scheduling-db.ts (sched-1c). The group shape was removed by
│                       #   SCHED-GROUPS-REMOVE-1 (code on branch archive/group-scheduling-2026-11)
├── zoned-time.ts       # Local wall time ↔ UTC instant on Intl (spring gap refused, ambiguous = earlier), for scheduling.ts and form-date.ts
├── form-date.ts        # STAY-1A: the `date` form field — FormDateOrderSchema + resolveFormDateOrder (the pair rule), earliestFormDate (min "today"), formatFormDate (a stored date in a locale, no local-time Date), isFormDate (the value check, years 0000-9999); days built only with setUTCFullYear (never Date.UTC, which reads 0-99 as 19xx)
├── locale-strings.ts   # Tenant locale table: normalizeLocale, resolveLocaleStrings, fillTemplate, COOKIE_AND_LEGAL_LABEL_LOCATIONS (locale-1a); blockStrings (locale-1c); count keys: PLURAL_CATEGORIES, pluralCategoriesOf, selectPluralText (locale-1b); localeLanguageSubtag (locale-1e); catalogServerTexts (cdl-1); booking texts: BOOKING_TEXT_KEYS, bookingStandardTexts, templatePlaceholders (sched-labels-1)
├── languages.ts        # LANG-1A (PROTOTYPE): readLanguageSettings, pageLanguageOf, languageTagOf, types PageLanguage, LanguageSettings, LanguageLink. Imports NOTHING (the renderer middleware will load dist/languages.js alone, lang-1b)
├── language-packs/     # Texts per language: types.ts, en.ts (complete by type), ro.ts, de.ts + fr.ts (complete by type, lang-1d), index.ts (LANGUAGE_PACKS registry) (locale-1a)
└── country-packs/      # Per-country facts only: currency, locale, regions, address formats (texts removed by locale-1d)
```

`src/index.ts` is the single public entry point: every module is re-exported from it, and consumers
import from `@amodx/shared`. One deliberate exception: the renderer imports the import-free
`@amodx/shared/dist/languages.js` directly (`middleware.ts`, `src/lib/site-segment.ts`,
`src/lib/tenant-directory.ts`; `lang-1b`), so no existing file is moved or renamed without checking that path.

**Where a declaration goes (REFACTOR-SHARED-1).** `index.ts` re-exports only — it holds no declaration and imports
nothing for its own use. A new schema, type or constant goes in its domain file (the list above); a new domain gets a
new file and one `export * from "./<file>.js"` line in `index.ts`. A rule module exists where the code is **behaviour
rather than shape** — a function with its own contract and its own test file.

**Import graph rule.** No file inside `src/` imports the barrel `./index.js` — not even `import type`: an import of the
barrel from inside the package is a cycle. A file imports a sibling from the sibling's own file. A zod schema is a value
built at import time — read before its module has run, it is a TDZ error at run time even when TypeScript is
satisfied. The value imports (the ones that survive compilation) form a DAG, so every module runs after the modules it
reads. The value edges of the domain files today (`zod` omitted):

- `content.ts` → `theme.ts`; `categories.ts` → `content.ts`; `tenant-config-parts.ts` → `theme.ts`
- `products.ts` → `glam-import-profile.ts`; `order-price.ts` → `locale-strings.ts` (and the TYPE `VolumePricingTier` of `products.ts`)
- `locale-table.ts` → `locale-strings.ts` (`BOOKING_TEXT_KEYS`; the TYPE `BookingStrings` of `language-packs/`)
- `forms-and-interest-list.ts` → `normalizeEmail.ts`, `form-date.ts`
- `tenant-config.ts` → `locale-strings.ts`, `languages.ts`, `scheduling.ts`, `content.ts`, `theme.ts`, `effects.ts`,
  `url-prefixes.ts`, `locale-table.ts`, `tenant-config-parts.ts`
- every other domain file imports `zod` only (`email-dns.ts` nothing)

Type-only cycles that remain (accepted debt, `docs/TECH-DEBT.md` § *refactor-shared-1 residuals*; erased at compile
time, so they decide no evaluation order): `form-date.ts` reads the type `FormField` of `forms-and-interest-list.ts`,
which imports `form-date.ts`; `locale-strings.ts` and `language-packs/types.ts` read the locale-table types of
`locale-table.ts`, which imports `locale-strings.ts` and the type `BookingStrings` of `language-packs/` (14 elementary
cycles, listed in `docs/slices/refactor-shared-1.md` § *Module graph*). Breaking them needs a type to move. Do not add a cycle.

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
| TenantConfigSchema | TenantConfig | Complete site configuration (domain, theme, integrations, GDPR, nav, plan); CAT-QUOTE-1: optional `contactChannels` and `interestListEmail`; NEWSLETTER-1: `integrations.mailerlite` is `MailerLiteSettingsSchema` or absent (a stored legacy boolean parses as absent) |
| MailerLiteSettingsSchema | MailerLiteSettings | NEWSLETTER-1: `{ apiToken, groupId }`, both non-blank (trimmed). The token is write-only: GET /settings and /settings/secrets never return it; the renderer never maps it |
| NewsletterSubscriptionSchema (+ `NewsletterConsentSchema`, `NewsletterPushSchema`, `NewsletterPushFailureSchema`) | NewsletterSubscription | NEWSLETTER-1: the item `NEWSLETTER#<normalizeEmail(email)>` = `{ consent: { id, at, locale, text }, push }`. `push` is a sum: `NoSettings \| Pending(attempt) \| Sent(at, attempt) \| Failed(reason, at, attempt)`, `reason` = `http(status) \| timeout \| network`. `consent.id` and `attempt` are random ids never reused: every later write is conditional on the ones it read (finding NL1-R2) |
| PopupSchema | Popup | NEWSLETTER-1: optional `collectEmail` (exactly `true` on a `newsletter` popup = the popup draws the signup form) |
| ThemeSchema | — | Site theme (colours, fonts, radius). CAT-THEME-1 adds eight OPTIONAL fields with no default (absent = the renderer's rendering before the slice): `fontNav`, `fontWeights` (each `FontWeightSchema`, int 100–900), `headingWeight`, `mutedColor`/`borderColor` (`CssColorSchema`), `shape` ("default" \| "editorial"), `cardImage` ("square" \| "landscape"), `cardCategoryLine`. `ContentItem.themeOverride = ThemeSchema.partial()` takes them with the same rules. `THEME_PRESETS` is typed `ThemePreset` (the older string fields only) |
| FooterConfigSchema | — | CAT-THEME-1: `TenantConfig.footer?` = `{ contentMaxWidth? }` (strict); absent → the footer uses the header's width. BULK-PURGE-FOOTER-1: + `backgroundColor?`, `textColor?` (`CssColorSchema`; no default; absent → the theme's colours; read by the renderer `app/[siteId]/layout.tsx` footer). SHOP-LOOK-1A: + `brandText?` (≤ 400) and `columns?` (≤ 4 strict `{ heading 1-40, links ≤ 12 × strict { label 1-60, href ≥ 1 } }`); no default; absent, blank or `[]` → today's footer |
| isCssColor / CssColorSchema | — | CAT-THEME-1 (round 2, R-CT-2): the colour GRAMMAR of the new theme colours (hex 3/4/6/8; `rgb`/`rgba`/`hsl`/`hsla` with exact arity, ranges and a numeric alpha; a short name list), used by `PUT /settings`. Every accepted value also passes the renderer's older injection-safety filter `sanitizeCssColor` (renderer `lib/sanitize.ts`, unchanged), which keeps guarding the legacy colour fields |
| ContactChannelsSchema | ContactChannels | CAT-QUOTE-1: the visitor contact channels `{ phone?, whatsapp?, email? }` (strict; a number = trimmed, digits/`+`/spaces/dashes, ≥ 1 digit — `ContactNumberSchema`); read by the quote dialog and the bar fallbacks, applied by `PUT /settings` |
| ContentItemSchema | ContentItem | Page/post with blocks, SEO, access policy, theme overrides |
| CategorySchema | Category | Product category (name, slug, plain-text description, parent, image, SEO, status). CATEGORY-CONTENT-1: + `blocks?` = `ContentItemSchema.shape.blocks.unwrap().optional()` — the content page's block type and rule, WITHOUT its `[]` default (zod 4 applies a default inside `.partial()`, so a default would make every partial `PUT /categories/{id}` write `[]` over the stored content). Absent = no page content. Drawn by the renderer's category page after the title block |
| RouteSchema | Route | URL slug mapping to content nodes, supports redirects |
| CustomerSelfRequestSchema (+ types `StoredValue`, `OrderHistoryEntry`, `CustomerProfileView`) | — | CMRC-1B (`docs/slices/cmrc-1b.md`): the data that crosses the renderer → backend boundary of `POST /customer/order-history` and `POST /customer/profile-read`. Request: exactly `{ email: non-empty string }` (strict) — a STRUCTURE check only, no format rule and no length bound (the backend applies `normalizeEmail` and reads; an email that matches nothing is "nothing found"). Answers: `{ orders: OrderHistoryEntry[] }` and `{ profile: CustomerProfileView \| null }`, every field a `StoredValue` — the stored attribute passed through, typed so ON PURPOSE instead of `OrderSchema` / `CustomerSchema`, which do not describe the stored data (e.g. `OrderSchema.total` is a string, the order handler stores a number). Parsed by `backend/src/customers/self-service.ts`; the types are read by `renderer/src/lib/customer-api.ts` |
| OrderLookupRequestSchema (+ const `ORDER_VIEW_FIELDS`, types `OrderViewField`, `OrderView`) | — | CMRC-1L (`docs/slices/cmrc-1l.md`): the data that crosses the renderer → backend boundary of `POST /customer/order-lookup`, the read of the order confirmation and tracking pages. Request: exactly `{ orderId, email }`, two non-empty strings (strict) — a STRUCTURE check only, no format rule and no length bound (a value that matches nothing is "not found"). `ORDER_VIEW_FIELDS`: the 17 attributes of a stored order that the two pages read and the route may answer — ONE list, from which the backend builds its projection and its answer; the PD-002 amendment of 2026-11-28 (`docs/platform-decisions.md`) names it, so a field added here changes that exception. Answer: `{ order: OrderView }`, every field a `StoredValue` passed through, absent when the stored item lacks it. Parsed by `backend/src/customers/self-service.ts`; the type is read by `renderer/src/lib/customer-api.ts`; the list also by the serving suite's backend stub |
| CommentSchema | Comment | User comment with moderation status |
| ContextItemSchema | ContextItem | Strategy documents with tags and blocks |
| WorkItemSchema | WorkItem | Automation tasks (social, email, research, audit) |
| ProductSchema | Product | E-commerce product with pricing, inventory, Paddle integration; importer-owned `importSource`, `facetModes`, `importProfileRevision`, `importLabels` (omitted from the authoring input by products/create.ts, update.ts). CDL-1: `importLabels` (`ImportLabelsSchema`, strict, four non-empty strings `collection`, `unit`, `packaging`, `minimumOrder`) = the attribute keys the glam import wrote the label columns under; absent or malformed → read as `IMPORT_LABELS_WITHOUT_MARKER` (the four Romanian words the importer wrote before cdl-1; fixed history, not the RO pack; readers: backend `interest/public.ts`, `import/glam-pricelist.ts` `otherLabels`). Variant option (`ProductVariantSchema`): `value`, `priceOverride?`, `imageLink?`, `availability?`, `additionalImageLinks?` (CAT-IMPORT-GALLERY-1: the option's other images, the glam import's column 13). `deriveGallery(options)` (products.ts, pure; test `test/derive-gallery.test.ts`) is the ONE product-gallery rule of an imported product: each option's `imageLink` then its `additionalImageLinks`, in option order, each address once → `imageLink` (first) + `additionalImageLinks` (rest). Callers: backend `lib/catalog-product.ts` `withDerivedGallery`, `import/glam/map.ts`, `import/glam-images.ts` |
| GlamImportProfileSchema | GlamImportProfile | CAT-IMPORT-PROFILE-1: per-producer import profile (grouping, collection source, `specKeys` rules, `facetModes`); every object STRICT — an unknown key, value or version fails the parse, never stripped. CAT-IMAGE-GATE-1: optional `publishWithoutImages` (absent ≡ false: products start hidden until an image copies); `version` stays 1, so profiles stored before it still parse |
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
| HeaderConfigSchema | HeaderConfig | Navigation header display options. HEADER-COLOURS-1: + `backgroundColor?`, `textColor?` (`CssColorSchema`; no default; absent → the theme's colours; read by the renderer `app/[siteId]/layout.tsx#headerColorStyle` for the navbar only; PUT /settings checks these two keys). SHOP-LOOK-1A: + `tagline?` (≤ 60) and `categoryBarIds?` (≤ 12 non-empty category ids, bar order; the renderer reads each category at render time); no default; PUT /settings checks them too |
| SignalSchema | Signal | Outbound lead signal (URL, pain score, wallet signal, analysis, draft reply) |

### Constants

- `THEME_PRESETS` — 5 built-in themes: standard, midnight, editorial, corporate, vibrant
- `URL_PREFIX_DEFAULTS` — the English default of every tenant path setting (`UrlPrefixesSchema` has the same keys):
  product, category, cart, checkout, shop, account, search, `interest` = `/my-list` (CDL-2; was `/lista-mea`) and
  `checkoutConfirmation` = `/confirmation` (CDL-2: the order-confirmation segment, appended to `checkout`; was the fixed
  `/confirmare` in the renderer). Read a tenant's prefixes through `urlPrefixesOf`.
- `MAX_REVIEW_IMAGES` (= 12) — upper bound on photos carried INLINE (as metadata) on one
  `ReviewSchema` row (D-REV-1, ratified). Bounds the entry COUNT, not photo size (bytes live in
  S3). It bounds only the images' CONTRIBUTION to the item: 12 × ~2.1 KB worst-case metadata
  ≈ 25 KB (< 7% of the DynamoDB 400 KB item cap). It is not a whole-item size guarantee —
  `ReviewSchema.content` and other string fields are unbounded. See the constant's header in
  `src/reviews.ts` for the full budget; `plan-reviews-import.md` D-REV-1.

### Functions

| Function | Contract | Used by |
|----------|----------|---------|
| `normalizeEmail(raw)` | `NFKC → trim → lowercase`. Pure, deterministic, idempotent, no locale/env/IO. Its output IS the `CUSTOMER#<email>` sort key and the pre-image of the Cognito username hash (PD-001) | NEWSLETTER-1: `backend/src/leads/newsletter.ts` (the signup's address, validated after normalizing; the `NEWSLETTER#` key), `leads/list.ts` (the join), `leads/delete.ts` and `leads/push.ts` (through `newsletterKey`). The older inline sites are still `fnd-2`'s to migrate (inventory in `docs/slices/fnd-1-normalize-email.md`) |
| `newsletterCanSendAgain(push)` | NEWSLETTER-1: exhaustive over the push states; true for `NoSettings`, `Pending`, `Failed`, false for `Sent` (sending again could reverse an unsubscribe made in MailerLite) | `backend/src/leads/push.ts`; `admin/src/pages/Leads.tsx` (whether "Send again" shows) |
| `evaluateCoupon(coupon, lines, now, customerUseCount?)` (+ `amountInCents`, `isCouponType`) | Pure; clock, money (whole cents per line) and the customer's use count are arguments. Returns `{ applies: true, discountCents, coveredLineIndexes }` or `{ applies: false, reason }`, `reason` ∈ `not-active \| not-yet-valid \| expired \| usage-limit \| customer-limit \| below-minimum \| no-covered-line` (checked in that order; `customer-limit` only when `customerUseCount` is given). Covered lines: no product/category limit → all; else product in `applicableProducts` OR a category in `applicableCategories`. Money rule CF1-MONEY-PRESERVATION = B: every coupon money text to whole cents half up when read; discount on the covered lines' sum only (percentage half up, then `maximumDiscount`; fixed `value`; never more than that sum); `minimumOrderAmount` against the whole subtotal; all comparisons in cents. Throws on a `type` outside the enum: callers test `isCouponType` first. Full rule: module header, `docs/commerce.md` § Coupon Validation | `backend/src/orders/create.ts` (server prices, STORED `categoryIds`, the counter's `count`); `backend/src/coupons/public-validate.ts` (the cart's line totals, STORED `categoryIds`, no customer count) |
| `paymentTransition(previous, requested)` (+ `PaymentStatusSchema`, types `PaymentStatus`, `PaymentTransition`) | Pure. PAY-1 (record `docs/slices/pay-1.md`): THE payment-state rule. Returns `{ kind: "apply" }` for `pending → paid` and `paid → refunded`, `{ kind: "no-op" }` for the same state, `{ kind: "refused", reason }` (English text) for the four other pairs. `previous` absent counts as `pending`. One arm per pair of the 3 × 3 states, a `never` check per switch: a new state does not compile until its pairs are decided. `PaymentStatusSchema` (`pending \| paid \| refunded`) is the enum `OrderSchema.paymentStatus` uses. Tests `test/pay-1.test.ts` | `backend/src/orders/update.ts` (`changePaymentStatus`, the only writer of the state after creation) |
| `CouponPrecheckItemSchema` (+ `COUPON_PRECHECK_MAX_LINES` = 50) | One line of the coupon pre-check request: `{ productId, quantity, lineTotal }` (`lineTotal` ≥ 0, the cart's own figure, advisory) | `backend/src/coupons/public-validate.ts` (parse); `renderer/src/components/CartPageView.tsx` (type of the body lines) |
| `normalizeSlug(raw)` | Pure. lowercase + trim → `[\s_]+`→`-` → strip `[^a-z0-9-/]` → collapse `-+` → strip trailing `-` → ensure leading `/`. Applied to a slug supplied to create and to a changed slug on update; NOT applied by the WordPress importer with `keepOldAddresses` off, which stores `/<wp:post_name>` raw by human decision (slice `import-policy-1`); applied to the decoded old path with the option on (slice `import-paths-1`). Full contract in the module header | `backend/src/content/create.ts`, `backend/src/content/update.ts`, `backend/src/import/wp-addresses.ts`, `admin/src/pages/ContentEditor.tsx` ("saved as" text) |
| `needsSlugReview(slug)` | Pure. `slug !== normalizeSlug(slug)` — a text rule only: it says the slug breaks the slug rules, it knows nothing of where the slug came from | `admin/src/pages/ContentList.tsx` (REVIEW SLUG badge), `admin/src/pages/ContentEditor.tsx` (red URL line) |
| `buildFacetListing(base, f, path, labels)` (+ `parseSelection`, `formatSelection`, `listingHref`, `selectionFits`, `facetValuesOf`, `compareValues`, …) | Pure. The catalog filter panel model: from a base set, the raw `f` and the page path — the filtered items, the shown facets with disjunctive counts, chips, and every href measured against the 6,144-byte budget. Facet set = producer, variant values, then every attribute key that is offered. Filter modes (`facetModes` on a product, design `cat-import-profile-1` § 2.6, ruling S-A with N2): a product marking a facet `never` is a silent holder — its values neither count toward the offer nor are listed, but still match a selection and count in the listed values; `always` offers a key whatever the repeat rule gives; unknown or malformed modes = automatic. Moved from `renderer/src/lib/facets.ts` by `cat-import-profile-1b` (ruling CIP1-PREVIEW = A). `labels: FacetLabels` (`{ producer, variantDefault }`, REQUIRED, `locale-1b`): the two fixed facet headings in the visitor's language — the module holds no language; ids and hrefs never depend on them. Full contract in the module header | `renderer/src/components/SitePage.tsx` (catalog shop and category; the tenant's `catalog.facetProducer` / `facetVariantDefault`); `admin/src/components/glamPreview.ts` (the same tenant texts, `siteContextOf`); shared tests pass the test constant `RO_FACET_LABELS` (`test/cat-import-profile-1b-golden.ts`) |
| `formFieldsOf(stored)` (forms-and-interest-list.ts), `resolveFormDateOrder(fields, rule)`, `earliestFormDate(now, timezone)`, `formatFormDate(value, locale)`, `isFormDate(value)` (form-date.ts) | Pure. STAY-1A (`docs/slices/stay-1.md` § 2, Build record). `formFieldsOf`: the stored form's entries that pass `FormFieldSchema`, the first of each label — the one field-list rule. `FormFieldSchema.type` gained `date` (closed set; every switch ends in a `never` check) and `min?: "today"`; `FormDefinitionSchema.dateOrder?` = `{ earlier, later }` field ids. `resolveFormDateOrder` → `{ ok, value: null }` (no rule) / `{ ok, value: { earlier, later } }` (two different date fields) / `{ ok: false, error }` naming the key. `earliestFormDate`: today in a valid IANA zone, else the UTC date − 1 day (a visitor west of UTC is not refused). `isFormDate`: the exact text of a real proleptic-Gregorian date, year 0000-9999 (round trip through `setUTCFullYear`; `zoned-time.ts` `isLocalDate`, used by scheduling, is unchanged). `formatFormDate`: `YYYY-MM-DD` → the locale's numeric date (`setUTCFullYear` + `timeZone: "UTC"`, no day shift; the year part is the stored four-digit text: `0099-12-31` → `31.12.0099` ro-RO); not a date text → unchanged. Tests `test/stay-1a.test.ts` | backend `forms/public-submit.ts`, `forms/create.ts`, `forms/update.ts`; renderer `SitePage.tsx` `formForBlock`; admin `FormSubmissions.tsx` (`formatFormDate`), `FormEditor.tsx` (`resolveFormDateOrder`) |
| `catalogListing(items, categoryId \| undefined, today)` | Pure. Which products a catalog page lists, in which order: shop `status === "active"`; category `!status \|\| status === "active"` and `categoryIds` holds the id; then `isProductAvailable(p, today)`; then `sortOrder` (absent = 0), ties by `id`. `today` = `utcDay(now)` (UTC `YYYY-MM-DD`; injected — the module reads no clock). Behaviour of the renderer's former inline rule, pinned by the 1b golden | `renderer/src/lib/dynamo.ts` (`getCatalogListing`; its other availability checks call `isProductAvailable`); admin import preview (1c) |
| `urlPrefixesOf(stored)` | Pure. CDL-2, the ONE path rule (design `docs/slices/catalog-data-labels-1.md` § 7.1; record `docs/slices/cdl-2.md`): per key of `URL_PREFIX_DEFAULTS`, the stored text when it has a non-blank character (kept as stored), else the default; `stored` absent / not an object / an array → every default; unknown keys dropped; always a new object | `renderer/src/lib/dynamo.ts` `mapTenant`, `admin/src/components/glamPreview.ts` `siteContextOf`, `backend/src/lib/slug-guard.ts` |
| `catalogListingPath(prefixes, categorySlug \| undefined)` | Pure. In `url-prefixes.ts` (in `index.ts` from CDL-2 until REFACTOR-SHARED-1; ruling CDL2-SHARED-DAG: it reads `URL_PREFIX_DEFAULTS`; `catalog-listing.ts` stays a leaf that imports nothing; the public export is unchanged). The public path of a catalog page without `basePath`: shop `prefixes.shop \|\| URL_PREFIX_DEFAULTS.shop` (CDL-2; was the literal "/magazin"), category `` `${prefixes.category}/${slug}` ``. The path is an input of the URL budget, so both callers must pass the same string | `renderer/src/components/SitePage.tsx`; admin import preview (1c) |
| `linePrice(inputs, quantity, locale)` (+ `roundToCents`, types `LinePriceInputs`, `LinePriceResult`) | Pure. ORDER-PRICE-1 (record `docs/slices/order-price-1.md`): THE price rule of one order line. Unit price: the chosen first-group option's `priceOverride` when non-empty; else the volume tier with the largest `minQuantity` ≤ quantity; else `salePrice` when non-empty; else `price`. Added cost: the sum of `addedCosts` (blank = 0). Line total = (unit + added) × quantity, rounded to cents (`roundToCents`: half up after `toPrecision(15)` removes float noise). Only the selected money texts are parsed, each by `parseMoney` with the tenant `locale` (PRICE-LOCALE-1); a text that does not parse, or an absent needed price, → `{ kind: "invalid-price", source, text }` — never NaN, never 0. `OrderItemInputSchema` personalization `id` is optional since this slice (old carts send none). Tests `test/order-price-1.test.ts` | `backend/src/orders/create.ts` (charges it); renderer `AddToCartButton.tsx` (shows it, stores the inputs in the cart item), `context/CartContext.tsx` `cartLineTotal` (cart subtotal, cart page, checkout) |
| `sameAmountInCents(a, b)` (+ types `PriceChangedAnswer`, `PriceChangedLine`; `OrderInputSchema.expectedTotal`) | Pure. ORDER-CONFIRM-1 (record `docs/slices/order-confirm-1.md`): true when two amounts are the same whole cents after `roundToCents`. The order handler's one comparison of the visitor's `expectedTotal` (optional, number ≥ 0) with its own total. `PriceChangedAnswer` is the 409 body the handler writes and `CheckoutPageView` reads (two users): the figures of the request's items, the English `error`, and `message` — the tenant's text of the commerce key `pricesChanged` (ruling OC1-TEXT = A; the key is in `CommerceStringsSchema` and the `en`/`ro` packs, and is resolved only by the order handler). |
| `parseMoney(text, locale)`, `localeUsesDecimalComma(locale)`, `toMachineFormPriceInputs(inputs, locale)` (type `MachineFormPriceInputs`) | Pure. PRICE-LOCALE-1 (record `docs/slices/price-locale-1.md`): THE money-text parser. Machine form in every locale (digits, one optional decimal point; `12.50`, `.50`, `12.`; `1.250` = 1.25). A locale whose own number format writes a decimal comma (`Intl.NumberFormat(normalizeLocale(locale)).formatToParts`, the `decimal` part — never a language list) also reads a text WITH a comma: comma = decimal, points = group separators in groups of three (`12,50`, `1.250,50`, `,50`, `12,`). Anything else (comma in a point locale, sign, exponent, space, currency, two commas, blank, absent) → `undefined`. Absent/unknown locale = en-US. `localeUsesDecimalComma` is exported for the renderer, which passes a locale prop only when it is true (byte identity of decimal-point tenants). `toMachineFormPriceInputs` (ruling PL1-CART-WIRING = N): the price texts `linePrice` can select (a chosen `priceOverride` alone; else every tier and the base — `salePrice` when non-empty, else `price`; every `addedCost`) rewritten in machine form by the same grammar (`12,50` → `12.50`, a point text unchanged); the first that does not parse → `invalid-price` with its source. Tests `test/price-locale-1.test.ts` | `linePrice`; `backend/src/products/bulk-price.ts`; renderer `AddToCartButton.tsx` (added-cost number and label; `toMachineFormPriceInputs` for the cart item), `SitePage.tsx` (`localeUsesDecimalComma`; `parseMoney` for the showcase range) |
| `readLanguageSettings(raw)` (`languages.ts`) | Pure, never throws. LANG-1A, the ONE read rule of the stored `languages`, `navLinksByLang`, `footerLinksByLang` (`docs/slices/lang-1.md` § 5.1): input a plain record; `languages` not an array → `[]`, entries kept when a 2-3 lowercase-letter string not kept before; a map not a plain object → `{}`, a key kept when a kept language with an array value, an entry kept when a plain object with string `label` and `href` (`children` kept only as an array of such); output holds only those fields. Takes no `locale`. Tests `test/lang-1a.test.ts` | `backend/src/content/update.ts` (`planTranslation`, rule C2), `admin/src/pages/Settings.tsx` (menu-language selector), `admin/src/pages/ContentEditor.tsx`; next: renderer middleware and `mapTenant` (`lang-1b`) |
| `pageLanguageOf(slug, languages)` (+ `languageTagOf(language, defaultSubtag)`) (`languages.ts`) | Pure. The address states the language (ruling LANG1-LANG-SOURCE = A): the first segment (`slug.split("/")[1]`) is `{ kind: "extra", subtag }` when listed, else `{ kind: "default" }`. `languageTagOf` gives the `hreflang` value (extra → its subtag; default → the caller's `localeLanguageSubtag(locale)`); two pages are "in the same language" when their tags are equal (§ 5.3). Exhaustive `switch` on `kind` | `languageSettingsProblem` (V6), `backend/src/content/update.ts` (rule C3), `admin/src/pages/ContentEditor.tsx`; next: renderer (`lang-1b`, `lang-1c`) |
| `languageSettingsProblem(input)` | Pure. LANG-1A, the WRITE rule V1-V6 (`lang-1.md` § 5.2), called with the MERGED settings: V1 `languages` an array of 2-3 lowercase-letter subtags that `normalizeLocale` keeps unchanged; V2 no duplicate; V3 not the default subtag (`localeLanguageSubtag(locale)`); V4 not the first segment of a URL prefix (`urlPrefixesOf`) nor `api`; V5 map keys listed, values `LinkSchema` lists; V6 with a non-empty list, a non-empty `homePageSlug` derives the default language. Returns a message naming the field, or null. A record without the three fields → null. In `tenant-config.ts` (it uses `normalizeLocale`, `urlPrefixesOf`, `LinkSchema`), not in the import-free module | `backend/src/tenant/settings.ts` (PUT /settings → 400), `admin/src/pages/Settings.tsx` (the Languages controls' messages) |
| `TranslationOfInputSchema` | `z.string().nullable().optional()`: the content API input `translationOf` (a nodeId to join its set; `null` = leave; absent = no change). Never stored; `ContentItemSchema.translationKey` is written only by the backend (rule C1) | `backend/src/content/create.ts`, `backend/src/content/update.ts` |
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

## Tenant locale table (`locale-strings.ts`, `language-packs/`) — slices `locale-1a`, `locale-1b`, `locale-1d`, `locale-1c`, `locale-1e`, `lang-1d` (PROTOTYPE)

Design: `docs/slices/locale-1.md` (§ 16 rulings win); records `docs/slices/locale-1a.md`, `docs/slices/locale-1b.md`,
`docs/slices/locale-1d.md`, `docs/slices/locale-1c.md`. Maturity **PROTOTYPE**: since `locale-1c` every visitor text
surface reads the table (the block chrome was the last); promotion is the operator's decision at closeout (`1e`
`<html lang>`: built, `docs/slices/locale-1e.md`; money formatting out of scope). Finding F-LOCALE-REVIEWS-DATE is closed by `locale-reviews-date-1`
(`docs/slices/locale-reviews-date-1.md`): a reviews carousel without its own non-empty `locale` attribute formats its
dates in the tenant's normalised locale — `dateLocale`, or `"en-US"` when it is absent.

- **Parts and storage.** Three parts, one tenant attribute each: `commerceStrings` (`CommerceStringsSchema`, 179 keys:
  the 77 existing ones, the 21 shared product-surface keys of `1b`, the 80 commerce-only keys of `1d` — cart, checkout,
  account, order confirmation and tracking, add-to-cart, commerce bar, navbar account links — and `showcaseEmpty` of
  `1c`), `catalogStrings` (`CatalogStringsSchema`, 39 keys in `1b`: interest list and facet panel, + the 7 `quote*` keys of CAT-QUOTE-1: the "Request a quote" button and dialog, + the 9 server-text keys of `cdl-1`: `import*` and `interestMail*`) and `siteStrings`
  (`SiteStringsSchema`, 51 keys in `1a` + `errorTryAgain` in `1d` + the 26 block-chrome keys of `1c` + `navCategoryBarLabel` of `shop-look-1a`, last). Every key is optional (absent = no override). The nine cookie/legal site keys
  are stored ONLY in `gdpr.*` / `legalLinks.*Label` (`COOKIE_AND_LEGAL_LABEL_LOCATIONS`); `PUT /settings` refuses them
  in `siteStrings`. `LocaleStrings` is the resolved DTO (every key a string; a count key a `CountText`).
- **Count keys** (`1b`, § 16.2 item 6): `reviewsSummary`, `productCount`, `searchResultCount`, `facetsCount`,
  `interestWidgetLabel` hold one text per plural category of the language (`PluralTextsSchema`, the six CLDR categories
  `PLURAL_CATEGORIES`; EN and DE `one`/`other`, RO `one`/`few`/`other`, FR `one`/`many`/`other` — French `one` is 0 and 1). Resolved per category, every form kept: `CountText =
  { language, forms, english }` — `forms` = the pack's texts, then the tenant's (a partial override included),
  `english` = the English texts. `selectPluralText(value, n)`: the form `Intl.PluralRules(language).select(n)` names,
  else the language's `other`, else English by English rules (`Intl.PluralRules("en")`), else the English `other`
  (always present). A new language adds its categories in its pack only;
  `pluralCategoriesOf(language)` lists them (admin Labels inputs, the RO pack test, the coverage rule).
- **Language.** `normalizeLocale(raw)` (never throws: not a string, malformed or unsupported → `en-US`; Unicode
  extensions dropped; idempotent) gives the date/number locale; its language subtag selects the pack in
  `LANGUAGE_PACKS` (none → English). `countryCode` never selects texts. `localeLanguageSubtag(raw)` (`locale-1e`) =
  the language subtag of `normalizeLocale(raw)`, the renderer's `<html lang>`: the language the content is in, NOT the
  resolver's `language` (the selected pack's: `"en"` for an `es-ES` tenant, which has no `es` pack).
- **Resolution.** `resolveLocaleStrings(tenantFields)` → `{ locale, language, strings, defaults }`: per key, EN pack <
  language pack < tenant override (an own string property; for the nine cookie/legal keys a non-empty string — the old
  `||` rule). Non-string and unknown stored values are ignored. `defaults` = without the override (admin placeholders,
  the fallback reader sites of § 5.2). `fillTemplate` fills `{name}` placeholders; an unknown one stays visible.
- **Block texts** (`1c`, § 5.3; ruling LOCALE1-BLOCK-TEXTS = A). `blockStrings(resolved, { catalogMode })` → the DTO
  `BlockStrings` that `RenderBlocks` gives every block renderer: the 28 site keys of `BLOCK_SITE_KEYS` (26 block-chrome
  keys + `formSubmissionFailed`, `errorTryAgain`), `showcaseEmpty`, `outOfStock` (absent on a catalog site: no stock
  text in a catalog page's payload, CATALOG-MODE-1 § 3.2.6) and `dateLocale` (the normalised locale, present only for a
  tenant that is not en-US, § 16.2 item 4). Every text as resolved (pattern D), except `BLOCK_FALLBACK_KEYS`
  (`videoTitle`, `videoBackgroundTitle`): pattern F — a stored `""` gives the language default, so an iframe name is
  never empty (ruling LOCALE1C-IFRAME-NAMES = A). The block renderers import only its TYPE (`packages/plugins/ARCHITECTURE.md`).
- **Server texts** (`cdl-1`, `docs/slices/catalog-data-labels-1.md` § 3; PROTOTYPE until the staging run of § 8.4).
  `catalogServerTexts(resolved)` → `{ siteLabels, variantName, interestMail }`: the catalog texts the BACKEND writes into
  products (the four site labels of the glam label columns, the default option name) or mails (the interest-list
  subject and lines, reusing `interestName` / `Email` / `Phone` / `Message`). Pattern F for every text: a stored `""` or
  whitespace gives the language default; a non-blank override is used trimmed — an empty attribute key would be dropped
  by the product page and the facets. Users: backend `import/glam-pricelist.ts`, `interest/public.ts`. The RO values
  equal the literals the backend wrote before (`test/cdl-1.test.ts`).
- **Booking texts** (`sched-labels-1`, amendment of `docs/slices/locale-1.md` dated 2026-11-22). The `booking` part of the
  language packs (the 75 texts of the hosted booking pages, `BookingStrings` in `language-packs/types.ts`) is NOT a part
  of the table above, but a tenant overrides it in a fourth stored home, `bookingStrings` (`BookingStringsSchema`, one
  optional text per key; `TenantConfig.bookingStrings`). `BOOKING_TEXT_KEYS` = the keys of the English pack (the list is
  written once). `bookingStandardTexts(language)` = English ← the language's pack (a `""` or absent pack text gives
  English): the admin placeholders and the renderer's lower layers; the renderer (`lib/booking-text.ts`) adds the tenant
  layer and owns the rule of when it applies (only on a page in the tenant's own language). An absent key or `""` =
  no override. `templatePlaceholders(text)` = the `{name}`s `fillTemplate` fills (one shared regex), for the
  PUT /settings rule "a booking text keeps exactly the placeholders of its standard text" and the admin's "Must keep"
  line. Test: `test/sched-labels-1.test.ts`.
- **Adding a key:** schema (`locale-table.ts`) → EN, DE and FR values (`language-packs/en.ts`, `de.ts`, `fr.ts`: complete by type, compile
  error until done) → RO value
  (`language-packs/ro.ts`, `test/locale-strings.test.ts` fails until done) → the reader → its Labels input → the
  slice's `coverage.json`. **Adding a language:** one pack file + one `LANGUAGE_PACKS` entry; a missing key → English.
- **Values.** Every pack value is a literal in its pack file (`locale-1d`): the EN pack holds the texts the renderer
  rendered before each slice; the RO pack holds the 75 commerce, five cookie and four legal texts that the RO country
  pack held at `92adbba`, unchanged (`test/fixtures/locale-1d-packs-92adbba.json` and `test/locale-strings.test.ts`
  compare them), plus the approved Romanian columns of § 6. The DE and FR packs (`lang-1d`, `docs/slices/lang-1.md` § 12,
  ruling LANG1-PACK-NOOP = B) hold new texts in all four parts (formal register); the human approves them as tables (key,
  EN, new text) before the production deploy. `test/lang-1d.test.ts` checks their keys against the EN pack, the
  placeholders per key, the plural categories and the French spacing rule. The compatibility export of the English commerce defaults
  and the country packs' text members are gone (§ 10.2); `country-packs/` holds country facts only (`CountryPack`:
  `code`, `name`, `currency`, `locale`, `address`). A renderer reader takes `resolveLocaleStrings(config)` only.

### Newsletter texts (`newsletterTexts`, NEWSLETTER-1)

`newsletterTexts(resolved)` → `{ locale, email, emailPlaceholder, consent, subscribe, subscribing, thanks, failed }` from
the six site keys `newsletter*` (packs en, ro, de, fr) and `formSubmissionFailed`. Pattern D except `consent` (a blank
override gives the language default). `locale` is the resolved locale (finding NL1-R3): the browser sends it with the
consent line and the backend checks the pair. Users: renderer `prepareBlocks` (`_newsletter`, the page's language), backend
`GET /public/popups` and the signup check (`shownConsentLines`). The keys are NOT block keys (`BLOCK_SITE_KEYS` travel in
every block's payload).

### Gallery texts (`galleryTexts`, GALLERY-1)

`galleryTexts(resolved)` → `{ viewer, close, previous, next, counter, photo }` from the six site keys `gallery*` (packs
en, ro, de, fr; Labels page). Pattern F for every text: a blank override gives the language default, because each is an
accessible name (the dialog, the three buttons, a tile without a description) or the position the viewer announces.
`counter` is a template with `{n}` and `{total}`, `photo` one with `{n}` (every pack keeps them, `test/lang-1d.test.ts`).
User: renderer `prepareBlocks` (`_gallery`, the page's language). Not block keys. Test: `test/gallery-1.test.ts`.

## Key Patterns

- **Zod-first design:** Types are inferred from schemas via `z.infer<>`, never manually defined
- **Multi-tenancy:** Every entity except SavedTheme has `tenantId`
- **Blocks as `any[]`:** ContentItem and ContextItem store Tiptap JSON blocks without schema enforcement at this level (plugin schemas handle block-level validation)
- **Default values:** Most fields have sensible defaults in the Zod schema, making partial creation safe
- **Theme overrides:** ContentItem supports per-page `themeOverride` and `darkThemeOverride` as partial Theme objects

## When Modifying

- Adding a new entity: define the Zod schema and export the inferred type in its domain file (a new domain: a new file
  and one `export * from` line in `index.ts`, which declares nothing itself); describe it in this ARCHITECTURE.md
- Adding a field: add with a default value to preserve backward compatibility with existing DynamoDB items
- Changing an enum: search all consumers — backend handlers, admin forms, renderer pages, MCP tools
- Rebuild after changes: `cd packages/shared && npm run build`, then rebuild dependents
- Changing `facets.ts` or `catalog-listing.ts` changes what every catalog site lists and filters. The 1b golden
  (`test/cat-import-profile-1b-golden.test.ts` over `test/fixtures/cat-import-profile-1b-baseline.json`, captured from
  `2cf738e` by `test/fixtures/cat-import-profile-1b-capture/run.sh`) must stay green: a red row there is a behaviour
  change for products without `facetModes`, not a test to update. Run the renderer serving suite too
  (`cd renderer && npm run test:serving`, rows `cf1-*`, `cip1b-*`)
