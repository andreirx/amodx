# LOCALE-1 — one per-tenant locale table for every visitor-facing text of a tenant site

Status: **PLANNED 2026-10-31** — design (SPEC) only. No code change. The DECISION_REQUIRED blocks of § 11 go to
decision-review, then to the human. Implementation starts only after the rulings, slice by slice (§ 10).
Revision 1 (2026-10-31) answers review-0 (R-LOC1-INVENTORY … R-LOC1-EVIDENCE); revision 2 (2026-10-31) answers
review-1 (four findings). § 15 maps each finding to the rule that closes its class.
Track: cross-cutting (renderer, shared, admin; commerce part under the Track B freeze, § 9).
Depends: none for the design. Implementation: the § 11 rulings; `locale-1d` also needs the commerce-freeze exception.
Source plan: none. The builder packet of 2026-10-31 and the human direction (§ 1) are the plan.
Maturity target: the new resolution module starts **PROTOTYPE** in `locale-1a` and becomes **MATURE** when every
visitor surface reads it (end of `locale-1d`).
Basis: `main` at `898ad31` (identical to `29b4178` outside `docs/ROADMAP.md`, EXECUTED § 12 E1). Every file:line in
this document was read at that commit.

## 1. Purpose

### 1.1 The human direction (2026-10-31), quoted

> "admin stays in English. for the locales the deeper question is whether it's a COMMERCE related table (it was
> previously) or a GENERAL table (as you mentioned, sites will use the "commerce" locale table on non-commerce
> enabled sites) - so in fact now this table has moved out of commerce. it is a general locale table that should be
> used throughout the tenant, it is per tenant so overridable, the language setting is per tenant, and we must treat
> it as such. commerce will use the commerce part of it. catalog will use the new catalog items. the "normal"
> websites I don't know what will use maybe "home" vs "acasa""

Settled by this direction, not re-opened here: the admin UI stays English and is out of scope. The table is GENERAL:
one per tenant, overridable by the tenant. It has a commerce part (today's keys), a catalog part (new) and a site
part (for ordinary content sites). The language is a per-tenant setting.

### 1.2 Risk retired

Today a tenant cannot get its visitor-facing texts in its own language. Three causes, all OBSERVED on the code:

1. More than 200 visitor-facing texts are literals in the renderer, in the block renderers and in
   `packages/shared/src/facets.ts`; § 6 maps them to 223 new keys. Only the 77 keys of `CommerceStringsSchema` can
   be changed per tenant.
2. The renderer never applies the language of the tenant. `mapTenant` (`renderer/src/lib/dynamo.ts:120-174`) is a
   whitelist. It does not copy `countryCode` or `locale`. So in the renderer `config.countryCode` and `config.locale`
   are always `undefined`. The country-pack layer of `getCommerceStrings` (`renderer/src/components/SitePage.tsx:83-86`)
   always selects the EN pack. The GDPR banner (`renderer/src/app/[siteId]/layout.tsx:128`) and the footer legal labels
   (`layout.tsx:236`) also always use the EN pack. Every date that reads `config.locale` is formatted `en-US`; the
   other dates follow the server's or the visitor's browser default (§ 3.4).
   Romanian text reaches a live site only through values stored in the tenant's `commerceStrings`, `gdpr` or
   `legalLinks` fields.
3. The catalog track wrote Romanian literals into the renderer and into `facets.ts` because its spec prescribed them
   (`docs/slices/cat-facets-1.md:495`, "Copy (Romanian, business register)"). An English catalog tenant shows
   Romanian texts; a Romanian content tenant shows English texts.

After the track: every visitor-facing text of a tenant site comes from one resolution function. That function
layers the built-in English text, the text of the tenant's language, and the tenant's own override.

### 1.3 Non-scope

Code, infra, test and data changes (this is a design). The admin UI language. Other slice docs and the ROADMAP.
E-mail templates (`orderEmailConfig`, `backend/src/lib/order-email.ts`) and every text that a server generates
(backend handlers, renderer API routes, middleware) — named in § 6.4 as follow-ups only. Content that authors write
(pages, posts, products, block fields).

### 1.4 Architectural boundaries

- Tenant isolation: the table is a field set of the tenant item (`PK: "SYSTEM"`, `SK: "TENANT#<id>"`). The renderer
  reads it through `getTenantConfig` like every other tenant field. No new read path, no cross-tenant read.
- No DynamoDB scan: the design needs no data migration (§ 4). The one operator check (§ 4.5) reads one item by key.
- Shared stays pure: the schema, the language packs, `normalizeLocale` and the resolution function are pure
  TypeScript in `@amodx/shared`. No I/O. `facets.ts` stays pure: its headings become an input (§ 6.3).
- Plugin split entry: block renderers receive their texts as a plain object prop. They import no renderer code.
- Data across boundaries is raw: the resolved table is a plain object of strings (a DTO).

## 2. Table model

### 2.1 Parts

The table has three parts. A part groups keys by the surface that owns them. Any surface may read any part (for
example, a product breadcrumb reads `site.breadcrumbHome`).

| Part | Contains | Rendered on | Keys |
|---|---|---|---|
| `commerce` | Today's 77 keys, unchanged names. New keys for the product pages, listings and search (shared by commerce and catalog sites) and for the cart, checkout, account, order confirmation and order tracking pages (commerce sites only). | Commerce sites; the product, category, shop and search pages of catalog sites | 77 existing + 105 new (§ 6.2) |
| `catalog` | Keys of the catalog-only features: the interest list ("Mă interesează") and the facet panel, including the two fixed facet headings of `facets.ts`. | Catalog sites only | 40 new (§ 6.3) |
| `site` | Keys every site has: navigation, footer, cookie banner, legal link labels, pagination, restricted page, comments, social share, quick contact, forms, block chrome, the fallback site name. | Every tenant | 78 new (§ 6.1) |

Total: 77 existing + 223 new = 300 keys.

Assignment rule for a new key: if only `commerceEnabled` tenants render it, or it is about products and prices →
`commerce`. If only `catalogMode` tenants render it → `catalog`. Else → `site`. The site part is derived from the
inventory (§ 6.1), not from the human's example. The example ("home" vs "acasă") is key `site.breadcrumbHome`.

Note on the part name `commerce`: a catalog site reads the product-page keys of this part (for example `inStock`,
`searchProducts`). This is the human's split ("commerce part (today's keys)"); today's keys already serve those
shared pages. The Labels page shows this group to catalog tenants under an honest heading (§ 7).

### 2.2 Key rules

1. **Naming.** camelCase. A key names the meaning, not the English text (`paginationPrevious`, not `previous`).
   Existing commerce keys keep their names exactly (stored overrides reference them).
2. **A key holds a whole phrase or sentence.** Values in it are `{placeholders}` (the convention already used by
   `addMoreForFreeDelivery`, "Add {amount} more for free delivery", filled at `CartPageView.tsx:213`). A key never
   holds a sentence fragment. Reason: a fragment ("Page", "of", the plural suffix "s") cannot be translated into
   Romanian word order or plural forms. Consequence: some HTML bytes change for English tenants (§ 8.5).
3. **Counts.** Two keys, `…One` and `…Other`, both with `{n}`. Selection: `n === 1` → `One`, else `Other`. This is
   exactly the rule the code applies today, in both languages (`SitePage.tsx:1157`, `:1258`, `:1365`, `:1079`).
   Romanian has a third form ("20 de produse"). Adding it is deferred (§ 13): it would change today's Romanian catalog
   output ("20 produse").
4. **Default values.** The English value of a new key is the literal that renders today, byte for byte (so English
   tenants see no text change from it). Exception: the catalog part, whose literals are Romanian today; its English
   values are new copy (§ 6.3, decision LOCALE1-VISIBLE-DEFAULTS).
5. **A key is never renamed.** A rename is a new key plus a reader change; the old key stays readable until no
   stored override uses it.

### 2.3 Where the schema lives, and how a key is added later

- Schema: `packages/shared/src/index.ts` (rule "shared-first types"). `CommerceStringsSchema` stays as it is and
  gets new optional keys. New `CatalogStringsSchema` and `SiteStringsSchema` beside it, same style (every key
  `z.string().optional()`). `LocaleStrings = { commerce: Required<CommerceStrings>; catalog: …; site: … }` is the
  resolved type.
- Language packs: `packages/shared/src/language-packs/{types,index,en,ro}.ts`, the pattern of `country-packs/`. The
  EN pack is typed `Required<…>` per part, so the compiler refuses an EN pack with a missing key. The RO pack is
  `Partial`; a test asserts that it covers every key shipped so far (§ 10).
- Adding a key later: (1) add it to the part schema; (2) add its English value to the EN pack (compile error until
  done); (3) add its Romanian value to the RO pack (test failure until done); (4) read it in the surface, as pattern
  D of § 5.2; (5) add an input to the Labels page group of its part. No storage change, no migration.

### 2.4 Unknown and removed stored keys

`PUT /settings` does not strip unknown keys today (`backend/src/tenant/settings.ts:124-126`, only the
`SERVER_OWNED_FIELDS` of `:28-31` are removed). The resolution function reads only the keys of the schema. So:

- An unknown stored key (a typo written by a script, a key from a future version after a rollback) is kept in
  storage and never rendered. It counts toward the limits of § 4.4.
- A removed key is the same case. The Labels page loads the stored object and saves it back whole
  (`admin/src/pages/Labels.tsx:50`, `:68`), so it keeps such keys. That is harmless. No clean-up is designed.

## 3. Language and country

### 3.1 What exists today (OBSERVED)

- `countryCode` (`packages/shared/src/index.ts:847`, default `"EN"`) and `locale` (`:848`, BCP 47, default
  `"en-US"`) are two separate fields of the tenant item. Admin Settings writes `locale` from a free-text input
  (`admin/src/pages/Settings.tsx:1637-1638`); nothing validates it. So a stored value such as `"ro_RO"` or `" ro-RO "`
  is possible.
- One country pack (`packages/shared/src/country-packs/types.ts:39-48`) carries country facts (currency, address
  regions, phone prefix) AND texts (`defaultStrings`, `gdpr`, `legal`). Packs: EN (`name: "English (Default)"`,
  currency USD, no regions) and RO.
- Admin Settings "Country & Locale" card (`Settings.tsx:1603-1645`): a country-pack select, an "Apply Pack" button
  and the free-text `locale` input ("Auto-filled from pack. Override if needed.").
- "Apply pack" dialog (`Settings.tsx:2023-2081`): "Locale & Currency Only" writes `countryCode`, `locale`, `currency`
  (`:2036-2044`). "Overwrite All Texts" also replaces the whole stored `commerceStrings` with `pack.defaultStrings`
  (`:2057`), the five `gdpr` texts (`:2058-2065`) and four `legalLinks` labels (`:2066-2072`).

**Can country and language differ for a tenant today?** Yes, in two ways, and the old pack model only makes it
inconvenient:
- The stored fields are independent: `countryCode`, `locale` and every text override are separate fields. A Romanian
  company with an English site can keep `countryCode: "RO"` (Romanian regions and ANPC links) and write English texts
  in Labels and in the GDPR and legal fields of Settings.
- On the live renderer the texts never depend on `countryCode` at all (§ 1.2): every tenant renders the English
  defaults plus its stored overrides, whatever its country. So today a Romanian company with the RO pack applied
  "Locale & Currency Only" already shows an English site.
What the pack model does couple is the admin action: "Apply Pack" offers the texts and the country facts of one
pack together. The design separates the two (§ 3.2).

### 3.2 Design

1. **The language setting is `locale`.** No new field (decision LOCALE1-LANGUAGE). The stored value is normalised
   once per request by `normalizeLocale` (§ 3.3) before any use. The tenant's text language is the language subtag
   of the normalised value; a language without a pack selects English.
2. **Texts move to language packs.** New `packages/shared/src/language-packs/` holds the texts per language (`en`,
   `ro`). The country pack keeps country facts. Its text members (`defaultStrings`, `gdpr`, the label texts of
   `legal`) stay in place, unchanged, until their last reader moves; they are removed in `locale-1d` (§ 10.2). Until
   then the RO language pack reads its existing commerce, cookie and legal values from `RO_PACK` so that no text has
   two copies.
3. **`countryCode` keeps its country role only.** It is not read for texts. This design does NOT add `countryCode`
   to `mapTenant`. Reason: `SitePage.tsx:399` reads `getCountryPack(config.countryCode || "RO")` for the checkout
   regions. Because `countryCode` is always `undefined` there, every tenant's checkout gets the 42 Romanian counties
   when its delivery config has no `availableCounties` (`CheckoutPageView.tsx:152`). Passing `countryCode` would
   change commerce behaviour for every English commerce tenant. That defect is named (§ 13, F-LOCALE-COUNTIES) and
   left to a commerce slice.
4. **`mapTenant` copies `locale`, `catalogStrings` and `siteStrings`** (`commerceStrings` it already copies,
   `dynamo.ts:156`). This is the first `locale-1a` change. A unit test lists the part fields from the schema and
   fails when `mapTenant` drops one (the class of defect that dropped `countryCode` and `locale`, and that the
   CATALOG-MODE-1 comment at `dynamo.ts:152` records for `catalogMode`).
5. **The locale-sensitive formatters of § 3.4 use the normalised locale**, passed explicitly. After the track none
   of them uses the runtime default, and none receives the raw stored tenant string. Scope limits, stated so that no
   reader assumes more: (a) money is NOT in scope — prices and totals keep `toFixed(2)` plus the currency code (15
   sites: `AddToCartButton.tsx:272`, `CartPageView.tsx:132,160,184-213`, `CartWidget.tsx:16`, `CheckoutPageView.tsx:574-603`), so a
   RO tenant still reads `120.00 RON`; deferred (§ 13); (b) a reviews-carousel block that carries its own `locale`
   attribute keeps today's behaviour exactly (§ 3.4).

### 3.3 Normalisation and fallback (one rule, applied before text selection and before formatting)

`normalizeLocale(raw: unknown): string` in `packages/shared/src/locale-strings.ts`, pure:

1. Not a string → `"en-US"`.
2. Trim, then replace every `_` with `-`.
3. `Intl.getCanonicalLocales(value)[0]`; if it throws → `"en-US"`.
4. Keep the base name only (language, script, region): `new Intl.Locale(canonical).baseName`. Unicode extensions
   such as `-u-nu-arab` are dropped, so an owner cannot switch the digit system by accident.
5. If `Intl.DateTimeFormat.supportedLocalesOf([base])` is empty → `"en-US"`.
6. Return `base`.

Text language: `new Intl.Locale(normalised).language`; if no language pack exists for it → `en`.

Behaviour, EXECUTED in Node 22.21.1 (§ 12 E20): `"ro-RO"` → `ro-RO`; `"ro-ro"` → `ro-RO`; `"ro_RO"` and `"en_US"`
throw today in `toLocaleDateString` (`RangeError`) and normalise to `ro-RO` / `en-US`; `" ro-RO "` throws today and
normalises to `ro-RO`; `""`, `"123"` → `en-US`; `"xx-YY"` canonicalises but is not supported → `en-US`; `"de-DE"` →
`de-DE` (dates German, texts English: there is no `de` pack).

Mismatch rule: dates and numbers follow the normalised locale; texts follow the language pack, or English. A tenant
with `de-DE` therefore reads English texts with German dates. This is stated in the Settings help text (§ 3.5) and
is a planned test case.

Planned test cases (`packages/shared`, `locale-1a`): the 12 inputs above; country/language mismatch
(`countryCode: "RO"`, `locale: "en-GB"` → English texts, `en-GB` dates; `countryCode: "EN"`, `locale: "ro-RO"` →
Romanian texts, `ro-RO` dates); a missing `locale` → `en-US`.

### 3.4 Every formatting consumer and its allocation

Found by `git grep -n -E "toLocale(Date|Time)?String|toLocaleString|Intl\.|localeCompare"` over the renderer, the
block renderers and the reachable shared modules (§ 12 E19). Today's behaviour is OBSERVED on the code.

| Consumer | Today | After | Slice |
|---|---|---|---|
| `SitePage.tsx:400` → `CheckoutPageView.tsx:524`, `:598` | `config.locale` (always undefined) → `"en-US"` | normalised locale | `locale-1a` (via `mapTenant`) |
| `SitePage.tsx:1090` review dates | same → `"en-US"` | normalised locale | `locale-1a` |
| `SitePage.tsx:1513` order date, `:1543` status history time | same → `"en-US"` | normalised locale | `locale-1a` |
| `AccountPageView.tsx:319` order dates | hard-coded `"en-US"` | normalised locale (prop) | `locale-1d` |
| `AccountPageView.tsx:273` birthday | runtime default (client component → visitor's browser) | normalised locale (prop) | `locale-1d` |
| `AccountPageView.tsx:286` loyalty points (number) | runtime default (browser) | normalised locale (prop) | `locale-1d` |
| `CheckoutPageView.tsx:79` calendar month name | `"default"` (browser) | normalised locale (prop already passed, `:150`) | `locale-1d` |
| `CommentsSection.tsx:97` comment dates | runtime default (browser) | normalised locale (prop) | `locale-1a` |
| `packages/plugins/src/post-grid/PostGridRender.tsx:110`, `:133` post dates | runtime default (browser) | normalised locale (`strings` prop carries it) | `locale-1c` |
| `packages/plugins/src/reviews-carousel/ReviewsCarouselRender.tsx:43`, `:47` | block attribute `locale` passed raw into `formatDate` (try/catch returns the raw date string on a `RangeError`); default `"ro-RO"` when the attribute is absent | attribute present (any value, even `""`): passed raw, exactly as today — NOT normalised; attribute absent: the tenant's normalised locale | `locale-1c` |
| `packages/shared/src/facets.ts:108` value sort order | `Intl.Collator("ro", { numeric: true })` | unchanged (sort order is a catalog contract of `cat-facets-1`; changing it reorders every facet list). Deferred, § 13 | — |

The first three rows change in `locale-1a` without touching a commerce file, because `mapTenant` starts to copy
`locale` (§ 9).

Reviews-carousel block attribute — today's behaviour, EXECUTED with the component's own `formatDate` options
(§ 12 E24), for the date `2026-10-31`: absent → `31 octombrie 2026`; `"ro-RO"` → `31 octombrie 2026`; `"en-US"` →
`October 31, 2026`; `"ro-RO-u-nu-arab"` → `٣١ octombrie ٢٠٢٦`; `"ro_RO"` → `2026-10-31` (the caught `RangeError`
returns the raw string); `"xx-YY"` → `October 31, 2026` (runtime fallback); `""` → `2026-10-31`. The design keeps
every one of these for a block that has the attribute (preservation cases, `locale-1c`). Only the absent case
changes (ledger row L-ALL-2). Reason for not normalising the attribute: normalisation would change the
`-u-nu-arab` and `ro_RO` rows above, and the author set that value on purpose or by mistake on one block; the
tenant-level `normalizeLocale` protects every formatter that receives the TENANT locale, which is where a throw
could reach a page.

### 3.5 Admin Settings (English UI)

The "Country & Locale" card becomes:

- **Site language** — a select of the language packs ("English", "Romanian"). Writes `locale` = the pack's default
  locale (`en-US`, `ro-RO`). Help text: "The language of every text visitors see. Edit single texts in Labels."
- **Locale (advanced)** — the existing free-text input, for a region variant such as `en-GB`. Below it, the value
  after normalisation and the text language it selects ("Dates: en-GB. Texts: English."). A value that normalises
  to `en-US` from something else shows a warning ("Not a valid locale; en-US is used").
- **Country** — the existing country-pack select. "Apply" writes `countryCode` and `currency` only. The dialog's
  "Overwrite All Texts" button is removed (§ 7.2).

## 4. Storage and migration

### 4.1 Stored shape (recommended, decision LOCALE1-STORAGE)

One attribute per part, on the tenant item:

| Attribute | Part | Status |
|---|---|---|
| `commerceStrings` | `commerce` | exists; unchanged; new keys are added to its schema |
| `catalogStrings` | `catalog` | new, optional |
| `siteStrings` | `site` | new, optional; never holds the nine keys below |

Each is a map of key → string. Absent attribute or absent key = no override. A key with a string value (including
`""`) is stored as given. How a reader renders `""` is fixed per reader site and preserved from today (§ 5.2).

**The nine cookie and legal keys have exactly one stored location: the existing fields.**

| Key | Stored in (only) |
|---|---|
| `site.cookieHeadline`, `cookieDescription`, `cookieDenyAll`, `cookieNecessaryOnly`, `cookieAcceptAll` | `gdpr.headline`, `gdpr.description`, `gdpr.denyAll`, `gdpr.necessaryOnly`, `gdpr.acceptAll` |
| `site.legalTermsLabel`, `legalPrivacyLabel`, `legalConsumerProtectionLabel`, `legalDisputeResolutionLabel` | `legalLinks.termsLabel`, `legalLinks.privacyLabel`, `legalLinks.anpcLabel`, `legalLinks.anpcSalLabel` |

Rules for these nine (one rule set, no precedence question):
- `siteStrings` must not contain them: `PUT /settings` refuses such a body with 400 (§ 4.4), and the resolver never
  reads them from `siteStrings`.
- Rendering keeps today's `||` rule (`layout.tsx:128-140`, `:240-250`): an absent or empty field falls through to
  the language default.
- Labels edits them (§ 7.1); Settings keeps the other fields of `gdpr` (`enabled`, `position`) and of `legalLinks`
  (the four URLs) and no longer shows the nine text inputs.
- A save writes the whole `gdpr` and `legalLinks` objects (PUT replaces a top-level field whole,
  `backend/src/tenant/settings.ts:139`): the writer starts from the loaded object and changes only the label fields,
  so `enabled`, `position` and the URLs are kept. Clearing an input deletes that field from the object sent.
- No data moves.

### 4.2 Existing `commerceStrings` values, including pack copies

No migration. Every stored value stays where it is and is read as an owner override, as today.

A value written by "Overwrite All Texts" (`Settings.tsx:2057`) cannot be told apart from an owner's edit. The
design does not try to. Consequences:

- Stored-text safety: no stored text changes on any tenant.
- Cost: a pack copy hides later improvements of the RO pack for that key. The Labels page gets a "Reset to the
  language defaults" action (§ 7.1) so an owner can drop copies on purpose. Decision LOCALE1-COPIES.
- The same class has a second member: `searchBar.placeholder` is stored with the schema default
  `"Search products..."` (`packages/shared/src/index.ts:825`; `backend/src/tenant/create.ts:53` parses new tenants
  with that schema). Staging: 171 tenant items store `searchBar`, the two read both hold `"Search products..."`
  (§ 12 E18). That English value stays on Romanian tenants until the owner edits it. Named in § 8.2.

### 4.3 Read compatibility during rollout

The old renderer reads only `commerceStrings` and ignores `catalogStrings` and `siteStrings`. The new renderer reads
all three; on a tenant without the new attributes it renders the defaults. No dual write is needed: the commerce
part never moves, and the nine cookie/legal keys stay in their existing fields.

### 4.4 `PUT /settings`

- Strip list (`SERVER_OWNED_FIELDS`, `settings.ts:28-31`, SETTINGS-KEYS-1): unchanged. The new attributes are
  ordinary tenant fields, not keys of the table or of a GSI.
- Validation: today the route validates only the two mode flags (`settings.ts:33-43`, CM-D11, "a new validator on a
  path that never validated" risk). The design adds a check of the same narrow kind. It runs only when the body
  contains `siteStrings` or `catalogStrings`, and only on those attributes. `commerceStrings`, `gdpr` and
  `legalLinks` keep no validation, so no live tenant's next save can be refused for its existing data.
- The limits, per attribute (`siteStrings`, `catalogStrings`), all checked on the attribute as sent:

| Limit | Value | Reason |
|---|---|---|
| Type | a JSON object; every value a string | the resolver reads strings only |
| Key form | `^[A-Za-z][A-Za-z0-9]{0,63}$` | key names of § 2.2; bounds the key length |
| Entries | at most 200 | 77 / 40 known keys plus room for keys of a later version (unknown keys are kept, § 2.4) |
| Value length | at most 500 UTF-16 code units | longest text of § 6 is 131 (`catalog.interestErrorInvalid`) |
| Serialised size | `Buffer.byteLength(JSON.stringify(attribute), "utf8")` at most 32 768 bytes | the actual storage bound; it holds for any script (one UTF-16 unit can take 3 UTF-8 bytes, so the length limit alone does not bound bytes) |
| Reserved keys | `siteStrings` must not contain the nine keys of § 4.1 | one stored location per key |

- Unknown keys count toward every limit. A body that breaks a limit → 400, nothing written, the message names the
  attribute and the limit. A stored attribute cannot exceed the limits, because the only writer is this route.
- What this guarantees: the two new attributes add at most 64 KiB (2 × 32 768 bytes) of serialised JSON to the tenant
  item. It does NOT bound the whole item: `commerceStrings` and the other fields stay unbounded, as today. The
  DynamoDB item limit is 400 KB for all attributes together.
- Size today (EXECUTED, § 12 E21): the largest of 539 staging tenant items is 2 775 bytes as DynamoDB JSON (a
  generous upper estimate of the stored size); the median is 1 114 bytes. Estimate of a fully overridden table in
  short texts (INFERRED): about 300 keys × 40 bytes ≈ 12 KB.

### 4.5 Deploy order and rollback (per implementation slice)

1. Backend (validation of the new attributes), when the slice adds a part.
2. Admin (the Labels group of the part), so owners can override before visitors see a change.
3. Renderer (reads the part and changes visible text) — the production-impacting step.

Rollback: the renderer first (restores the old literals; stored data is unaffected and ignored by old code). Then
admin and backend if needed. An admin rollback is safe: the old Settings page edits the same nine `gdpr` /
`legalLinks` fields, and the old Labels page edits only `commerceStrings`. No data rollback exists or is needed.

Operator pre-deploy check for `locale-1b` (catalog): read the prod catalog tenant's item by key and record its
`locale`. If it does not normalise to `ro-*`, its catalog texts would turn English. The human then decides (§ 8.4)
before the renderer deploy. The operator cannot read prod data; this check is the human's (UNVERIFIED on prod today).

## 5. Resolution

### 5.1 One function, two views

`resolveLocaleStrings(input)` in `packages/shared/src/locale-strings.ts`, re-exported from `index.ts` (the
`slug.ts` precedent of IMPORT-POLICY-1).

```ts
input: {
  locale?: unknown;                                  // tenant.locale, raw from the item
  commerceStrings?: Record<string, unknown>;         // tenant overrides, raw from the item
  catalogStrings?: Record<string, unknown>;
  siteStrings?: Record<string, unknown>;
  gdpr?: Record<string, unknown>;                    // only stored location of the 5 cookie keys
  legalLinks?: Record<string, unknown>;              // only stored location of the 4 legal label keys
}
returns: {
  locale: string;          // normalizeLocale(input.locale), § 3.3 — the only locale any formatter receives
  strings: LocaleStrings;  // layers 1 + 2 + 3: what a reader shows
  defaults: LocaleStrings; // layers 1 + 2 only: the language default, used by the fallback reader sites of § 5.2
}
```

Layers, per key, lowest first:

1. the EN language pack (complete by type);
2. the language pack of the text language (§ 3.3), when it has the key;
3. the tenant override: an own property whose value is a string. For the nine `gdpr`/`legalLinks` keys: a non-empty
   string (today's `||` rule, § 4.1); these nine are never read from `siteStrings`.

Missing key: impossible after layer 1 (the compiler enforces a complete EN pack). Non-string stored value (corrupt
data): ignored, the lower layer stays. Unknown stored key: ignored (§ 2.4). Malformed locale: `en-US` and English
(§ 3.3) — never an exception.

A second pure function, `fillTemplate(template, values)`, replaces each `{name}` with `String(values[name])` and
leaves an unknown placeholder as written. Callers: the existing `addMoreForFreeDelivery` and every key of § 6 with a
placeholder. For the two sentences that wrap a value in markup (`SitePage.tsx:1415` "Order {number}" with a
`<span>`, `:1439` "You will pay {amount} …" with a `<strong>`), the renderer adds a small
`interpolate(template, nodes)` that splits the template at its placeholders and returns React children, so the
markup stays.

### 5.2 Readers moved to it, and the empty-string rule

Readers found by the command of § 12 E4 (`git grep`, exit 0, 57 lines). That is a deterministic text search, not a
compiler query. Completeness basis: a reader must name one of the searched identifiers (a computed access such as
`config["commerce" + x]` would escape it; none was seen in the AST walk of § 6), or receive a value from a reader
that does; the walk found no other visitor text source.

| Reader today | What it does | After | Slice |
|---|---|---|---|
| `SitePage.tsx:83-86` `getCommerceStrings` (5 calls: `:287`, `:345`, `:361`, `:381`, `:1338`) | defaults → country pack (always EN, § 1.2) → tenant | callers read `resolveLocaleStrings(config)`; the function is deleted when its last caller moves | `:287`, `:1338` in `locale-1b`; `:345`, `:361`, `:381` and the deletion in `locale-1d` |
| `SitePage.tsx:88-96` `getSearchLabels` (4 calls: `:867`, `:1239`, `:1293`, `:1349`) | tenant layer ONLY; SearchBar falls back to English literals | deleted; SearchBar gets `strings` and `defaults` values | `locale-1b` |
| `layout.tsx:170-173` → `CommerceBar.tsx:164`, `:172` | tenant layer ONLY; English literal fallback | resolved values with the fallback rule below | `locale-1d` |
| `layout.tsx:128-140` CookieConsent; `:236-250` legal labels | tenant field → country pack (always EN) → literal | `site.cookie*`, `site.legal*Label` | `locale-1a` |
| `AccountPageView.tsx:62`, `CartPageView.tsx:24`, `CheckoutPageView.tsx:150` | prop default `COMMERCE_STRINGS_DEFAULTS` | `strings` and `defaults` props required | `locale-1d` |
| `SitePage.tsx:399` `getCountryPack(config.countryCode \|\| "RO")` | checkout regions (country fact, not text) | unchanged (F-LOCALE-COUNTIES, § 13) | — |
| `renderer/src/lib/dynamo.ts:156` | copies `commerceStrings` | also copies `locale`, `catalogStrings`, `siteStrings` | `locale-1a` |
| `admin/src/pages/Labels.tsx:10,26,50,68` | edits `commerceStrings`; placeholders from `COMMERCE_STRINGS_DEFAULTS` | § 7.1 | `locale-1a` (Site group), `1b`, `1d` |
| `admin/src/pages/Settings.tsx:29,1613-1629,2026-2072` | country pack select and "apply" | § 3.5, § 7.2 | `locale-1a` |
| `backend/src/tenant/list.ts:32-33,60-61` | returns `countryCode`, `locale` for the tenant list | unchanged (admin use) | — |
| `packages/shared/src/country-packs/*` | packs; text members read by `getCommerceStrings`, layout, Settings | text members kept until `locale-1d`, then removed (§ 10.2) | `locale-1d` |
| `packages/shared/src/facets.ts:54-55`, `:223`, `:279` | fixed Romanian headings | headings passed in by the caller (§ 6.3) | `locale-1b` |

`COMMERCE_STRINGS_DEFAULTS` stays exported, unchanged, until `locale-1d` removes its last reader. No MCP server or
backend handler reads the table (§ 12 E4).

**The empty-string rule (preservation).** Today two reader patterns exist, and they render a stored `""`
differently. The design keeps each site's pattern; only the fallback source changes from a literal to the table.

| Pattern | Sites today (exact expressions, § 12 E22) | Stored `""` renders today | After |
|---|---|---|---|
| F — fallback | `AccountPageView.tsx:213,224,265,270` (`phone`, `birthday`), `:219` (`phonePlaceholder \|\| ""`); `AddToCartButton.tsx:265,268,272,284` (`addedToCart`, `variantUnavailable`, `outOfStock`, `addToCart`, `viewCart`); `CheckoutPageView.tsx:361,364,368,381,396,404,408,409,412,413,416,417,470,478` (`billingDetails`, `firstName`, `lastName`, `birthday`, `orderAsCompany`, `companyName`, `taxId`, `taxIdPlaceholder`, `registrationNumber`, `registrationNumberPlaceholder`, `vatNumber`, `vatNumberPlaceholder`, `useSameAsShipping`, `billingAddress`); `CommerceBar.tsx:164,172` (`accountLabel`, `signIn`); `SearchBar.tsx:163,173,177,217` (`searchButton`, `searchSearching`, `searchNoResults`, `viewAllResults`); the nine `gdpr`/`legalLinks` keys (`layout.tsx:128-140`, `:240-250`) | the English literal | `strings.k \|\| defaults.k` — the language default. Equal to today for EN tenants (every literal equals its EN default, § 12 E8); for RO tenants the Romanian default (ledger row L-RO-4, § 8) |
| D — direct | every other existing key read (for example `{strings.continueShopping}`, `CartPageView.tsx:144`) | nothing (empty) | `strings.k` — unchanged |
| New keys (§ 6) | — (they are literals today) | — | D: a stored `""` renders empty. The Labels page states this under the input ("Empty = shows nothing"); clearing the input instead removes the override |

Planned preservation cases (renderer unit tests, jsdom, per F site and for one D site of each component):
override absent → default; override `""` → F: default, D: empty; override `"X"` → `"X"`; for EN and RO tenants.

### 5.3 How strings reach client components

Server components resolve once per request and pass each client component only the keys it uses (and, for F sites,
the matching `defaults` values), as a plain prop object — the pattern `SitePage` already uses for `AddToCartButton`
(`SitePage.tsx:1011-1017`). `RenderBlocks` passes block renderers a `strings` prop with the block keys of the site
part and the normalised locale (a subset, about 30 short strings). Rejected: a React context with the whole table in
`Providers.tsx`. It would serialise all 300 strings into the RSC flight payload of every page, and `RenderBlocks` is
a client component (perf-1).

### 5.4 Abstractions introduced (one line each)

- `SiteStringsSchema` / `CatalogStringsSchema` — users: Labels page, PUT validation, resolver; axis: keys added per
  surface (sum of fixed parts, operations grow); rejected: adding all keys to `CommerceStringsSchema` (its name would
  lie about its content).
- Language packs `en`, `ro` — users: resolver, Labels placeholders; axis: a demonstrated second language (Romanian
  tenants exist) independent of country; rejected: keeping texts in country packs (couples language to country,
  § 3.1).
- `resolveLocaleStrings` — users: SitePage, layout, ProductByIdPage, Labels page; axis: none new — it replaces
  `getCommerceStrings` and three partial readers; rejected: one resolver per part (three copies of one layering).
  Its `defaults` view exists because 30 fallback expressions and the nine cookie/legal keys (§ 5.2) need it;
  rejected: keeping English literals there (would leave English on Romanian sites).
- `normalizeLocale` — users: the resolver and every formatter of § 3.4 (through the resolver's `locale`); axis:
  none; rejected: passing the raw stored string (throws `RangeError` for `"ro_RO"`, § 3.3).
- `fillTemplate` — users: `addMoreForFreeDelivery` (existing) and about 30 new keys; axis: none; rejected: inline
  `.replace` per call site (duplicated, and silent on a missing placeholder).
- `interpolate` (renderer only) — users: the two markup sentences of § 5.1; axis: none; rejected: splitting each
  sentence into fragment keys (untranslatable, § 2.2 rule 2).

## 6. Inventory

### 6.0 Method and completeness basis

- **Method (EXECUTED, § 12 E6).** An AST walk with the TypeScript compiler API (5.9.3) over the visitor module
  graph. Seeds: every `.ts`/`.tsx` under `renderer/src` and `packages/plugins/src/render.ts`. The walk follows every
  static and dynamic import that is relative, `@/`, or a workspace package the visitor code imports:
  `@amodx/shared` → `packages/shared/src/index.ts`, `@amodx/plugins/render` → `packages/plugins/src/render.ts`,
  `@amodx/effects`, `@amodx/effects/render`, `@amodx/effects/celebration` → `packages/effects/src/{index,render,
  celebration}.ts` (the walker reports any other `@amodx/*` specifier as unresolved; none remained). It also resolves
  the `.js` suffix the shared package uses in its relative imports. Result: 131 files — 63 renderer source files,
  `renderer/src/app/globals.css` (reached by an import; its content ignored), 27 plugin files (`render.ts`, the 20
  `*Render.tsx`, 6 `common/` files), 11 shared files and 29 effects files. No `*Editor.tsx`, no `EffectControls`,
  `InlineRichTextField`, `EffectPreview` or `BlockWidthControl` is reachable — they are admin-only. It collected
  every JSX text node (159) and every string or template literal with a letter (4 326).
- **Triage.** Removed by syntax: import specifiers, type positions, comparisons (`=== "x"`), `case` labels, element
  access, and JSX attributes that never render text (`className`, `href`, `src`, `type`, `id`, `key`, SVG geometry,
  …). Then a text filter (a capital word with a space, a sentence end, or a non-ASCII letter) → 752 candidates
  (§ 12 E7). The literals that the filter removed in the renderer and plugin files (576) were listed and read one
  by one; 12 of them are visitor texts ("Saving...", "Searching...", "Select...", "Submitting...", "Sending...",
  "Unlocking...", "Pre-order", `${n} produse`, "1 produs", and the plural suffix `"s"` at three places) and are
  included below. The 356 candidates from the shared and effects files were each traced to their consumers (§ 6.4).
  The 383 literals the filter removed in the shared and effects files were read as well: enum identifiers,
  colours, DNS record types, shader names and console messages. None is a visitor text, except the order status
  values (`index.ts:1308`), which the tracking page renders raw and § 6.2 maps (`orderHistory*`).
- **Classification by consumer, not by location.** A literal is a visitor text when a consumer renders it to a
  visitor, wherever the literal lives: `facets.ts` headings reach the facet panel (`SitePage.tsx:1164`, `:1165`,
  `:1176`); the `mapTenant` default `"Untitled Site"` becomes `config.name` in the Navbar, the page titles and the
  footer (`layout.tsx:37-40`, `:178`, `:257`); raw order-status identifiers are rendered on the tracking page. A data
  default whose consumers only compare it (for example `"Draft"`, `"Hidden"`) is excluded with that consumer named.
- **Completeness claim.** Every visitor-facing literal in the renderer, the block renderers and the shared and
  effects modules they import is listed below, mapped or excluded. Basis: the walk is syntax-complete over the
  import graph, including the workspace packages (not a regex); a script checked that every candidate appears in
  this document (§ 12 E16). Limits: (a) `renderer/middleware.ts` is outside the seeds; it was read by hand (§ 6.4);
  (b) texts from dependencies (the Next.js default 404 page, NextAuth pages) are not literals of this repo (§ 6.4);
  (c) a literal built at run time from non-literal parts is invisible to any static method; none was seen.
- Notation: `E:` = existing commerce key, now also read here; its RO value is the `RO_PACK.defaultStrings` value at
  `packages/shared/src/country-packs/ro.ts:78-152`. "RO (proposed)" values are **pending the human's approval**
  (§ 8.1); they are given here so that the change ledger is exact before approval is asked.

### 6.1 Site part (`site.*`, 78 new keys)

EN default = the text that renders today (byte for byte). RO = proposed, pending approval, except where it cites
`ro.ts`.

| Source | Key | EN default (today) | RO |
|---|---|---|---|
| `renderer/src/lib/dynamo.ts:139` → `config.name` (`layout.tsx:37-40`, `:178`, `:257`) | `untitledSiteName` | Untitled Site | Site fără nume |
| `renderer/src/app/[siteId]/layout.tsx:40` (meta description fallback) | `metaSiteDescription` | Official site for {name} | Site-ul oficial {name} |
| `layout.tsx:217` | `footerTaxId` | CUI: {value} | CUI: {value} |
| `layout.tsx:218` | `footerTradeRegister` | Reg: {value} | Reg. Com.: {value} |
| `layout.tsx:219` | `footerPhone` | Tel: {value} | Tel: {value} |
| `layout.tsx:227` | `footerLinksHeading` | Links | Linkuri |
| `layout.tsx:239` | `footerLegalHeading` | Legal | Informații legale |
| `layout.tsx:241` | `legalTermsLabel` (stored only in `legalLinks.termsLabel`) | Terms & Conditions | `ro.ts:65` |
| `layout.tsx:244` | `legalPrivacyLabel` (`legalLinks.privacyLabel`) | Privacy Policy | `ro.ts:66` |
| `layout.tsx:247` | `legalConsumerProtectionLabel` (`legalLinks.anpcLabel`) | Consumer Protection | `ro.ts:67` |
| `layout.tsx:250` | `legalDisputeResolutionLabel` (`legalLinks.anpcSalLabel`) | Dispute Resolution | `ro.ts:68` |
| `layout.tsx:257` | `footerCopyright` | © {year} {name}. All rights reserved. | © {year} {name}. Toate drepturile rezervate. |
| `renderer/src/components/CookieConsent.tsx:145` | `cookieHeadline` (`gdpr.headline`) | We value your privacy | `ro.ts:71` |
| `CookieConsent.tsx:146` | `cookieDescription` (`gdpr.description`) | We use cookies to enhance your browsing experience and analyze our traffic. Choose your preference below. | `ro.ts:72` |
| `CookieConsent.tsx:147` | `cookieDenyAll` (`gdpr.denyAll`) | Deny All | `ro.ts:73` |
| `CookieConsent.tsx:148` | `cookieNecessaryOnly` (`gdpr.necessaryOnly`) | Necessary Only | `ro.ts:74` |
| `CookieConsent.tsx:149` | `cookieAcceptAll` (`gdpr.acceptAll`) | Accept All | `ro.ts:75` |
| `renderer/src/components/Navbar.tsx:125` | `navAllOf` | {label} (All) | {label} (toate) |
| `Navbar.tsx:172` | `navContact` | Contact | Contact |
| `Navbar.tsx:184` (aria-label) | `navToggleMenu` | Toggle menu | Deschide sau închide meniul |
| `Navbar.tsx:216` | `navViewAll` | View All | Vezi tot |
| `Navbar.tsx:271` | `navContactUs` | Contact Us | Contactează-ne |
| `SitePage.tsx:876`, `:1246`, `:1355` (breadcrumb) | `breadcrumbHome` | Home | Acasă |
| `SitePage.tsx:524` | `restrictedTitle` | Restricted Access | Acces restricționat |
| `SitePage.tsx:527` | `restrictedLoginRequired` | You must be logged in to view this page. | Trebuie să fii autentificat ca să vezi această pagină. |
| `SitePage.tsx:528` | `restrictedSubscription` | This content requires a subscription ({currency} {price}). | Acest conținut necesită un abonament ({currency} {price}). |
| `SitePage.tsx:536` | `restrictedLogIn` | Log In with Google | Autentificare cu Google |
| `SitePage.tsx:541` | `restrictedPurchase` | Purchase Access | Cumpără accesul |
| `SitePage.tsx:738` | `paginationPrevious` | Previous | Înapoi |
| `SitePage.tsx:740` | `paginationPageOf` | Page {page} of {total} | Pagina {page} din {total} |
| `SitePage.tsx:742` | `paginationNext` | Next | Înainte |
| `renderer/src/components/CommentsSection.tsx:70` (alert) | `commentsPostFailed` | Failed to post | Comentariul nu a putut fi publicat |
| `CommentsSection.tsx:82` | `commentsHeading` | Discussion ({count}) | Discuție ({count}) |
| `CommentsSection.tsx:103` | `commentsEmpty` | No comments yet. Be the first! | Niciun comentariu încă. Fii primul! |
| `CommentsSection.tsx:109` | `commentsClosed` | Comments are closed for this post. | Comentariile sunt închise pentru acest articol. |
| `CommentsSection.tsx:123` (placeholder) | `commentsPlaceholder` | Write a comment... | Scrie un comentariu... |
| `CommentsSection.tsx:131` | `commentsPost` | Post | Publică |
| `CommentsSection.tsx:138` | `commentsJoin` | Join the conversation | Alătură-te discuției |
| `CommentsSection.tsx:144` | `commentsSignIn` | Sign in with Google | Autentificare cu Google |
| `renderer/src/components/SocialShare.tsx:26` | `shareLabel` | Share: | Distribuie: |
| `SocialShare.tsx:32` (title) | `shareOnX` | Share on X | Distribuie pe X |
| `SocialShare.tsx:41` | `shareOnLinkedIn` | Share on LinkedIn | Distribuie pe LinkedIn |
| `SocialShare.tsx:50` | `shareOnFacebook` | Share on Facebook | Distribuie pe Facebook |
| `SocialShare.tsx:58` | `shareByEmail` | Share via Email | Trimite pe e-mail |
| `SocialShare.tsx:66` | `shareCopyLink` | Copy Link | Copiază linkul |
| `renderer/src/components/QuickContact.tsx:18` (title) | `quickContactCall` | Call us | Sună-ne |
| `QuickContact.tsx:18` (title) | `quickContactEmail` | Email us | Scrie-ne |
| `renderer/src/components/DynamicForm.tsx:64`; `packages/plugins/src/lead-magnet/LeadMagnetRender.tsx:60` (when the server sends no error) | `formSubmissionFailed` | Submission failed | Trimiterea a eșuat |
| `DynamicForm.tsx:69` | `formErrorShort` | Something went wrong | Ceva nu a funcționat |
| `DynamicForm.tsx:109`; `AddToCartButton.tsx:226` | `formSelectPlaceholder` | Select... | Selectează... |
| `DynamicForm.tsx:146` | `formSubmitting` | Submitting... | Se trimite... |
| `packages/plugins/src/contact/ContactRender.tsx:57` | `contactSendFailed` | Failed to send message | Mesajul nu a putut fi trimis |
| `ContactRender.tsx:62`; `LeadMagnetRender.tsx:73`; `CheckoutPageView.tsx:345` | `errorTryAgain` | Something went wrong. Please try again. | Ceva nu a funcționat. Încearcă din nou. |
| `ContactRender.tsx:70` | `contactSent` | Message Sent! | Mesaj trimis! |
| `ContactRender.tsx:71` (fallback of block field `successMessage`) | `contactSentDetail` | We'll get back to you shortly. | Îți răspundem în curând. |
| `ContactRender.tsx:85` | `contactName` | Name | Nume |
| `ContactRender.tsx:95` | `contactEmail` | Email | Email |
| `ContactRender.tsx:105` | `contactMessage` | Message | Mesaj |
| `ContactRender.tsx:125` | `contactSending` | Sending... | Se trimite... |
| `LeadMagnetRender.tsx:84` | `leadUnlocked` | Unlocked! | Deblocat! |
| `LeadMagnetRender.tsx:85` | `leadFileReady` | Your file is ready. | Fișierul tău este gata. |
| `LeadMagnetRender.tsx:92` | `leadDownload` | Download Now | Descarcă acum |
| `LeadMagnetRender.tsx:111` | `leadEmail` | Email | Email |
| `LeadMagnetRender.tsx:116` (placeholder) | `leadEmailPlaceholder` | name@example.com | nume@exemplu.ro |
| `LeadMagnetRender.tsx:129` | `leadUnlocking` | Unlocking... | Se deblochează... |
| `packages/plugins/src/hero/HeroRender.tsx:90` | `heroNoImage` | No Image | Fără imagine |
| `packages/plugins/src/image/ImageRender.tsx:23` (alt fallback) | `imageAltFallback` | Image | Imagine |
| `packages/plugins/src/video/VideoRender.tsx:109` (iframe title) | `videoTitle` | Embedded video | Video încorporat |
| `packages/plugins/src/video-hero/VideoHeroRender.tsx:192` (title) | `videoBackgroundTitle` | Background video | Video de fundal |
| `packages/plugins/src/carousel/CarouselRender.tsx:126`; `category-showcase/CategoryShowcaseRender.tsx:49` | `noImage` | No image | Fără imagine |
| `CarouselRender.tsx:150` | `noImageCaps` | NO IMAGE | FĂRĂ IMAGINE |
| `CarouselRender.tsx:160` | `carouselView` | View | Vezi |
| `packages/plugins/src/code-block/CodeBlockRender.tsx:80` | `codeCopy` | Copy | Copiază |
| `CodeBlockRender.tsx:80` | `codeCopied` | Copied! | Copiat! |
| `packages/plugins/src/reviews-carousel/ReviewsCarouselRender.tsx:114` | `reviewsReadMore` | Read more | Citește mai mult |
| `ReviewsCarouselRender.tsx:114` | `reviewsShowLess` | Show less | Arată mai puțin |
| `packages/plugins/src/post-grid/PostGridRender.tsx:74` | `postsEmpty` | No posts found. | Nu s-au găsit articole. |
| `PostGridRender.tsx:43` (built in the component from the HTTP status; shown at `:66`) | `postsLoadFailed` | API {status} | Eroare API {status} |

Count: 78 keys. The three `noImage*` variants are kept apart so that English bytes do not change; a later cleanup may
merge them as an enumerated change.

**Block texts — table or block field (decision LOCALE1-BLOCK-TEXTS).** Rule: a text the author already writes per
block (headline, button text, `successMessage`, image `alt`, carousel `linkText`) stays a block field; it is author
content. Fixed UI chrome that is the same in every block instance (form field labels, status messages, "Copy",
"Read more", "No posts found.", placeholders for a missing image, iframe titles) goes to the site part, so it follows
the site language without editing each block. A block field that exists wins over the key (`ContactRender.tsx:71`
keeps `attrs.successMessage ||` first). Excluded block texts: `HeroRender.tsx:47-50` (render defaults of the block
fields `headline`, `subheadline`, `ctaText`, which the editor stores at insert — author content); the block schema
defaults in `packages/plugins/src/*/schema.ts` (admin-side, English by the settled admin rule).

### 6.2 Commerce part (`commerce.*`, 77 existing + 105 new keys)

**Shared product surfaces** (commerce and catalog sites; `locale-1b`, except the two `CategoryShowcaseRender.tsx` rows,
which go with the blocks in `locale-1c`):

| Source | Key | EN default (today) | RO |
|---|---|---|---|
| `SitePage.tsx:158` (meta description) | `metaCategoryDescription` | Browse {category} products | Vezi produsele din {category} |
| `SitePage.tsx:165` (title) | `metaShopTitle` | Shop - {site} | Magazin - {site} |
| `SitePage.tsx:174` (title, with a query) | `metaSearchQueryTitle` | Search: {query} - {site} | Căutare: {query} - {site} |
| `SitePage.tsx:174` (title, no query) | `metaSearchTitle` | Search - {site} | Căutare - {site} |
| `SitePage.tsx:861`, `:1233`, `:1287`, `:1343`; `SearchBar.tsx:36` (fallback of the tenant field `searchBar.placeholder`) | `searchPlaceholder` | Search products... | Caută produse... |
| `SitePage.tsx:878`, `:1248`, `:1298`, `:1357` | `shopTitle` | Shop | Magazin |
| `SitePage.tsx:910` | `volumePricing` | Volume Pricing | Prețuri de volum |
| `SitePage.tsx:929`; `ProductByIdPage.tsx:146` | `preOrder` | Pre-order | Precomandă |
| `SitePage.tsx:984`; `ProductByIdPage.tsx:141` | `buyNow` | Buy Now | Cumpără acum |
| `ProductByIdPage.tsx:146` | E: `outOfStock` | Out of Stock | `ro.ts:83` |
| `SitePage.tsx:1049` | `ingredients` | Ingredients | Ingrediente |
| `SitePage.tsx:1055` | `nutritionalValues` | Nutritional Values | Valori nutriționale |
| `SitePage.tsx:1076` | `reviewsHeading` | Reviews | Recenzii |
| `SitePage.tsx:1079` (n = 1) | `reviewsSummaryOne` | {rating}/5 ({n} review) | {rating}/5 ({n} recenzie) |
| `SitePage.tsx:1079` (n ≠ 1) | `reviewsSummaryOther` | {rating}/5 ({n} reviews) | {rating}/5 ({n} recenzii) |
| `SitePage.tsx:1221` | `categoryEmpty` | No products in this category yet. | Nu există încă produse în această categorie. |
| `SitePage.tsx:1258` (n = 1) | `productCountOne` | {n} product | {n} produs |
| `SitePage.tsx:1258` (n ≠ 1) | `productCountOther` | {n} products | {n} produse |
| `SitePage.tsx:1274` (filter "in stock") | `shopEmptyInStock` | No products currently in stock. | Nu există produse în stoc momentan. |
| `SitePage.tsx:1274` | `shopEmpty` | No products available yet. | Nu există încă produse disponibile. |
| `SitePage.tsx:1306` | `shopAllProducts` | All Products | Toate produsele |
| `SitePage.tsx:1312` (filter) | E: `inStock` | In Stock | `ro.ts:82` |
| `SitePage.tsx:1359` (breadcrumb) | `searchBreadcrumb` | Search | Căutare |
| `SitePage.tsx:1365` (n = 1) | `searchResultCountOne` | {n} result | {n} rezultat |
| `SitePage.tsx:1365` (n ≠ 1) | `searchResultCountOther` | {n} results | {n} rezultate |
| `SitePage.tsx:1368` | `searchEnterTerm` | Enter a search term to find products. | Introdu un termen de căutare ca să găsești produse. |
| `SearchBar.tsx:163`, `:173`, `:177`, `:217` (F sites, § 5.2) | E: `searchButton`, `searchSearching`, `searchNoResults`, `viewAllResults` | Search / Searching... / No products found / View all results | `ro.ts:145`, `:147`, `:146`, `:148` |
| `CategoryShowcaseRender.tsx:53` | E: `outOfStock` | Out of Stock | `ro.ts:83` |
| `CategoryShowcaseRender.tsx:145` | `showcaseEmpty` | No products found in this category. | Nu s-au găsit produse în această categorie. |

New shared keys: 25.

**Commerce-only surfaces** (`locale-1d`, under the freeze):

| Source | Key | EN default (today) | RO |
|---|---|---|---|
| `SitePage.tsx:179` | `metaCartTitle` | Cart - {site} | Coș - {site} |
| `SitePage.tsx:180` | `metaCheckoutTitle` | Checkout - {site} | Finalizare comandă - {site} |
| `SitePage.tsx:181` | `metaOrderConfirmationTitle` | Order Confirmation - {site} | Confirmare comandă - {site} |
| `SitePage.tsx:182` | `metaOrderTrackingTitle` | Order Tracking - {site} | Urmărire comandă - {site} |
| `AddToCartButton.tsx:120` | `personalizationRequired` | Please fill in "{label}" | Completează „{label}” |
| `AddToCartButton.tsx:128` | `variantRequired` | Please select {name} | Selectează {name} |
| `AddToCartButton.tsx:265`, `:268`, `:272`, `:284` (F sites) | E: `addedToCart`, `variantUnavailable`, `outOfStock`, `addToCart`, `viewCart` | Added to Cart! / Variant Unavailable / Out of Stock / Add to Cart / View Cart | `ro.ts:80`, `:84`, `:83`, `:79`, `:81` |
| `CartWidget.tsx:16` | `cartWidgetTotal` | Cart/{total} {currency} | Coș/{total} {currency} |
| `CartPageView.tsx:53` (when the API sends no `reason`) | E: `invalidCoupon` | Invalid coupon | `ro.ts:104` |
| `CartPageView.tsx:57` | `couponValidateFailed` | Could not validate coupon | Cuponul nu a putut fi verificat |
| `CheckoutPageView.tsx:64` | `deliveryDatesLoading` | Loading delivery dates... | Se încarcă datele de livrare... |
| `CheckoutPageView.tsx:118` | `calendarMo`, `calendarTu`, `calendarWe`, `calendarTh`, `calendarFr`, `calendarSa`, `calendarSu` | Mo, Tu, We, Th, Fr, Sa, Su | Lu, Ma, Mi, Jo, Vi, Sâ, Du |
| `CheckoutPageView.tsx:237` | E: `emptyCart` | Your cart is empty | `ro.ts:88` |
| `CheckoutPageView.tsx:238` | `checkoutEmptyMessage` | Add some products before checking out. | Adaugă produse înainte de a finaliza comanda. |
| `CheckoutPageView.tsx:333` | `orderFailed` | Order failed | Comanda a eșuat |
| `CheckoutPageView.tsx:334` | `orderFailedStatus` | Order failed ({status}) | Comanda a eșuat ({status}) |
| `CheckoutPageView.tsx:361-417`, `:470`, `:478` (F sites) | E: the 14 keys of § 5.2 row F | the literals at those lines | `ro.ts:130` (birthday), `:132-144` |
| `CheckoutPageView.tsx:524` | `deliveryDateSelected` | Selected: {date} | Selectată: {date} |
| `CheckoutPageView.tsx:548` | `bankTransferTo` | Transfer to {bank} - {iban} | Transfer către {bank} - {iban} |
| `AccountPageView.tsx:33-39` | `orderStatusPlaced`, `orderStatusConfirmed`, `orderStatusPrepared`, `orderStatusShipped`, `orderStatusDelivered`, `orderStatusCancelled`, `orderStatusAnnulled` | Placed, Confirmed, Prepared, Shipped, Delivered, Cancelled, Annulled | Plasată, Confirmată, Pregătită, Expediată, Livrată, Anulată, Stornată |
| `AccountPageView.tsx:130`, `:147`; `Navbar.tsx:251` | `myAccount` | My Account | Contul meu |
| `AccountPageView.tsx:131` | `accountSignInPrompt` | Sign in to view your orders and manage your account. | Autentifică-te ca să vezi comenzile și să îți gestionezi contul. |
| `AccountPageView.tsx:136` | `signInWithGoogle` | Sign In with Google | Autentificare cu Google |
| `AccountPageView.tsx:154` | `signOut` | Sign Out | Deconectare |
| `AccountPageView.tsx:161` | `profileHeading` | Profile | Profil |
| `AccountPageView.tsx:167` | `edit` | Edit | Editează |
| `AccountPageView.tsx:205`, `:257` | `accountName` | Name | Nume |
| `AccountPageView.tsx:209`, `:261` | E: `email` | Email | `ro.ts:111` |
| `AccountPageView.tsx:213`, `:219`, `:224`, `:265`, `:270` (F sites) | E: `phone`, `phonePlaceholder`, `birthday` | Phone / "" / Birthday | `ro.ts:112`, `:113`, `:130` |
| `AccountPageView.tsx:243` | `save` | Save | Salvează |
| `AccountPageView.tsx:243` | `saving` | Saving... | Se salvează... |
| `AccountPageView.tsx:250` | `cancel` | Cancel | Anulează |
| `AccountPageView.tsx:285` | `loyaltyPoints` | Loyalty Points | Puncte de fidelitate |
| `AccountPageView.tsx:291` | `defaultAddress` | Default Address | Adresa implicită |
| `AccountPageView.tsx:305` | `orderHistory` | Order History | Istoric comenzi |
| `AccountPageView.tsx:334` | `noOrdersYet` | No orders yet. | Nicio comandă încă. |
| `AccountPageView.tsx:339` | `startShopping` | Start Shopping | Începe cumpărăturile |
| `Navbar.tsx:156`; `CommerceBar.tsx:164` (F site) | E: `accountLabel` | Account | `ro.ts:152` |
| `Navbar.tsx:161`, `:259`; `CommerceBar.tsx:172` (F site) | E: `signIn` | Sign In | `ro.ts:151` |
| `SitePage.tsx:1393` | `orderThankYou` | Thank you for your order! | Îți mulțumim pentru comandă! |
| `SitePage.tsx:1394` | `orderPlacedMessage` | Your order has been placed successfully. You will receive a confirmation email shortly. | Comanda ta a fost plasată. Vei primi în curând un e-mail de confirmare. |
| `SitePage.tsx:1396`, `:1485`, `:1501` | E: `continueShopping` | Continue Shopping | `ro.ts:90` |
| `SitePage.tsx:1413` | `orderConfirmed` | Order Confirmed! | Comandă confirmată! |
| `SitePage.tsx:1415`, `:1512` | `orderNumber` | Order {number} | Comanda {number} |
| `SitePage.tsx:1422` | `bankTransferDetails` | Bank Transfer Details | Detalii pentru transfer bancar |
| `SitePage.tsx:1423` | `bankTransferInstruction` | Please transfer the total amount to the following account: | Transferă suma totală în contul următor: |
| `SitePage.tsx:1425` | `bankLabel` | Bank: | Banca: |
| `SitePage.tsx:1426` | `accountHolderLabel` | Account Holder: | Titular cont: |
| `SitePage.tsx:1427` | `ibanLabel` | IBAN: | IBAN: |
| `SitePage.tsx:1428` | `swiftLabel` | SWIFT: | SWIFT: |
| `SitePage.tsx:1429` | `referenceLabel` | Reference: | Referință: |
| `SitePage.tsx:1430` | `amountLabel` | Amount: | Suma: |
| `SitePage.tsx:1438` | E: `cashOnDelivery` | Cash on Delivery | `ro.ts:123` |
| `SitePage.tsx:1439` | `codPayOnDelivery` | You will pay {amount} when you receive your order. | Vei plăti {amount} când primești comanda. |
| `SitePage.tsx:1440` | `estimatedDelivery` | Estimated delivery: | Livrare estimată: |
| `SitePage.tsx:1446` | `orderDetails` | Order Details | Detalii comandă |
| `SitePage.tsx:1452` | `quantityLabel` | Qty: {n} | Cant.: {n} |
| `SitePage.tsx:1463`, `:1464`, `:1466`, `:1468`, `:1570` | E: `subtotal`, `shipping`, `freeShipping`, `discount`, `total` | Subtotal / Shipping / Free / Discount / Total | `ro.ts:92`, `:93`, `:96`, `:94`, `:95` |
| `SitePage.tsx:1475` | E: `shippingAddress` | Shipping Address | `ro.ts:114` |
| `SitePage.tsx:1479` | `phoneLine` | Phone: {phone} | Telefon: {phone} |
| `SitePage.tsx:1498` | `orderNotFound` | Order Not Found | Comanda nu a fost găsită |
| `SitePage.tsx:1499` | `orderNotFoundMessage` | Please check the order ID and email address. | Verifică numărul comenzii și adresa de e-mail. |
| `SitePage.tsx:1513` | `placedOn` | Placed on {date} | Plasată pe {date} |
| `SitePage.tsx:1526` step labels (identifier rendered with CSS `capitalize`) | `orderStepPending`, `orderStepConfirmed`, `orderStepProcessing`, `orderStepShipped`, `orderStepDelivered`, `orderStepCompleted` | pending, confirmed, processing, shipped, delivered, completed | în așteptare, confirmată, în procesare, expediată, livrată, finalizată |
| `SitePage.tsx:1539` | `statusHistory` | Status History | Istoric status |
| `SitePage.tsx:1544` history status (raw value, CSS `capitalize`) | `orderHistoryPlaced`, `orderHistoryConfirmed`, `orderHistoryPrepared`, `orderHistoryShipped`, `orderHistoryDelivered`, `orderHistoryCancelled`, `orderHistoryAnnulled` | placed, confirmed, prepared, shipped, delivered, cancelled, annulled | plasată, confirmată, pregătită, expediată, livrată, anulată, stornată |
| `SitePage.tsx:1555` | `tracking` | Tracking | Urmărire |
| `SitePage.tsx:1556` | `trackingNumber` | Tracking Number: | Număr AWB: |
| `SitePage.tsx:1562` | `items` | Items | Produse |

New commerce-only keys: 80. New commerce keys in total: 25 + 80 = 105.

Tracking labels are localised now, independently of F-LOCALE-STEPS (§ 13). Rules: the step list and its order stay
as today (the timeline defect is not repaired here); each step identifier maps to its `orderStep*` key; each history
`entry.status` value maps to its `orderHistory*` key; a value with no key (a legacy or unknown status) renders as
today, raw. The EN defaults are today's lower-case identifiers and the CSS `capitalize` stays, so English bytes do
not change. Under `capitalize` the Romanian values render with a capital on each word ("În Așteptare") — part of
the approval of the RO values.

### 6.3 Catalog part (`catalog.*`, 40 new keys)

The Romanian value is today's literal and becomes the RO pack value verbatim (so a Romanian catalog tenant sees no
change). The English value is new copy, proposed here for the human to amend.

| Source | Today (RO pack value) | Key | EN default (proposed) |
|---|---|---|---|
| `renderer/src/components/InterestShortlist.tsx:51` | Lista are deja 50 de produse. Scoateți un produs ca să adăugați altul. | `interestListFull` | Your list already has 50 products. Remove one to add another. |
| `InterestShortlist.tsx:102` | Mă interesează | `interestAdd` | I'm interested |
| `InterestShortlist.tsx:102` | În lista mea | `interestAdded` | In my list |
| `InterestShortlist.tsx:128` | `Lista mea: ${count} produse` (aria-label) | `interestWidgetLabel` "Lista mea: {count} produse" | My list: {count} products |
| `InterestShortlist.tsx:137`, `:203`, `:266`; `SitePage.tsx:137` (title) | Lista mea | `interestListTitle` | My list |
| `InterestShortlist.tsx:141` | Lista nu poate fi salvată în acest browser; o păstrăm cât timp pagina rămâne deschisă. | `interestStorageWarning` | This browser cannot save the list. We keep it while this page stays open. |
| `InterestShortlist.tsx:142` | Am înțeles | `interestStorageAck` | Got it |
| `InterestShortlist.tsx:183` | Vedeți produsele | `interestBrowse` | See the products |
| `InterestShortlist.tsx:188` | Lista a fost trimisă | `interestSentTitle` | Your list was sent |
| `InterestShortlist.tsx:189` | Vă mulțumim! Am primit lista dumneavoastră și vă vom contacta în curând. | `interestSentBody` | Thank you! We received your list and will contact you soon. |
| `InterestShortlist.tsx:192` | Aceste produse nu au fost incluse, pentru că nu mai sunt disponibile: | `interestExcludedIntro` | These products were not included because they are no longer available: |
| `InterestShortlist.tsx:204` | Lista este goală. Apăsați „Mă interesează” la produsele care vă plac. | `interestEmpty` "Lista este goală. Apăsați „{action}” la produsele care vă plac." ({action} = `interestAdd`) | Your list is empty. Press “{action}” on the products you like. |
| `InterestShortlist.tsx:217` | Lista nu are produse disponibile. Alegeți din nou produsele dorite. | `interestErrorNoneAvailable` | The list has no available products. Choose the products again. |
| `InterestShortlist.tsx:228` | Verificați datele: numele, o adresă de e-mail validă, telefonul (cel mult 40 de caractere) și mesajul (cel mult 2000 de caractere). | `interestErrorInvalid` | Check your details: your name, a valid e-mail address, the phone (at most 40 characters) and the message (at most 2000 characters). |
| `InterestShortlist.tsx:248` | Nu am putut verifica lista acum. Încercați din nou peste câteva momente. | `interestErrorCheck` | We could not check the list now. Try again in a few moments. |
| `InterestShortlist.tsx:250` | Produsele din listă nu mai sunt disponibile. Alegeți din nou produsele dorite. | `interestErrorAllGone` | The products in the list are no longer available. Choose the products again. |
| `InterestShortlist.tsx:252` | Lista nu a putut fi trimisă. Încercați din nou. | `interestErrorSend` | The list could not be sent. Try again. |
| `InterestShortlist.tsx:255` | Lista nu a putut fi trimisă. Verificați conexiunea și încercați din nou. | `interestErrorNetwork` | The list could not be sent. Check your connection and try again. |
| `InterestShortlist.tsx:268` | Lista trimisă anterior a fost primită. Produsele de mai jos nu au fost trimise încă. | `interestPreviouslySent` | Your earlier list was received. The products below were not sent yet. |
| `InterestShortlist.tsx:275` | Datele dumneavoastră de contact | `interestContactHeading` | Your contact details |
| `InterestShortlist.tsx:277` | Nume | `interestName` | Name |
| `InterestShortlist.tsx:281` | E-mail | `interestEmail` | E-mail |
| `InterestShortlist.tsx:285` | Telefon | `interestPhone` | Phone |
| `InterestShortlist.tsx:289` | Mesaj | `interestMessage` | Message |
| `InterestShortlist.tsx:295` | Trimite lista | `interestSubmit` | Send the list |
| `InterestShortlist.tsx:303` | Produsul nu mai este în catalog. Alegeți-l din nou din produsele actuale. | `interestRowExpired` | This product is no longer in the catalog. Choose it again from the current products. |
| `InterestShortlist.tsx:304` | Produsul nu este disponibil momentan și nu va fi trimis. | `interestRowUnavailable` | This product is not available now and will not be sent. |
| `InterestShortlist.tsx:305` | Varianta aleasă nu mai este oferită. Alegeți din nou varianta dorită. | `interestRowOptionGone` | The chosen option is no longer offered. Choose the option again. |
| `InterestShortlist.tsx:325` | Colecția | `interestCollection` | Collection |
| `InterestShortlist.tsx:329` | `Scoateți ${item.title} din listă` (aria-label) | `interestRemove` "Scoateți {title} din listă" | Remove {title} from the list |
| `SitePage.tsx:1130` | Prea multe filtre selectate — eliminați unul | `facetsTooMany` | Too many filters selected — remove one |
| `SitePage.tsx:1157` | 1 produs / `${n} produse` | `facetsCountOne` "1 produs", `facetsCountOther` "{n} produse" | 1 product / {n} products |
| `SitePage.tsx:1158` | Filtrele din adresă sunt prea lungi și nu au fost aplicate. | `facetsUrlTooLong` | The filters in the address are too long and were not applied. |
| `SitePage.tsx:1164` | `Elimină filtrul ${facetLabel}: ${value}` (aria-label) | `facetsRemove` "Elimină filtrul {facet}: {value}" | Remove the filter {facet}: {value} |
| `SitePage.tsx:1171`, `:1198` | Șterge filtrele | `facetsClear` | Clear the filters |
| `SitePage.tsx:1197` | Niciun produs nu corespunde filtrelor alese. | `facetsNoMatch` | No product matches the selected filters. |
| `SitePage.tsx:1203` (aria-label), `:1206`, `:1208` | Filtre | `facetsTitle` | Filters |
| `packages/shared/src/facets.ts:54`, used at `:279` → facet heading (`SitePage.tsx:1176`) and chip label (`:1164`, `:1165`) | Producător | `facetProducer` | Brand |
| `facets.ts:55`, used at `:223` (when the products' option groups do not share one name) → same consumers | Variantă | `facetVariantDefault` | Option |

Facet rules (`facets.ts`): the facet ids `producator` and `varianta` (`facets.ts:24`, `:26`) are URL contract and do not
change. A variant heading taken from the products' own option-group name (`facets.ts:223`) is author data and is not
translated. Attribute headings (`:281`, the attribute key) are author data too.

**The shared signature change and every current caller.** Rule: a change to a shared signature carries its current
consumers and their preservation obligations in the same slice. `buildFacetListing(base, f, path)`
(`facets.ts:387`) gains a fourth, REQUIRED parameter `labels: { producer: string; variantDefault: string }`. It is
required (no default) so that no caller silently gets a heading language it did not choose, and so that the shared
module holds no Romanian default (the EN-first rule). Current callers, found by § 12 E23 (exit 0), and what each
passes, all in `locale-1b`:

| Caller | Passes | Preservation obligation |
|---|---|---|
| `renderer/src/components/SitePage.tsx:298`, `:312` | `resolveLocaleStrings(config).strings.catalog` → `{ producer: facetProducer, variantDefault: facetVariantDefault }` | RO catalog tenant: headings unchanged (L-RO-CAT); EN catalog: L-EN-CAT |
| `admin/src/components/glamPreview.ts:267` (`previewPanel`, the import preview of the visitor filter panel) | the same tenant labels as the public site: `siteContextOf` (`glamPreview.ts:41-48`) gains a `facetLabels` field, computed from the `GET /settings` answer it already receives (`GlamPricelistImport.tsx:539`) with `resolveLocaleStrings(settings)`. The admin controls around the preview stay English; only the previewed visitor panel shows visitor texts, exactly as the site will. On a settings read failure the context is `null` today and the panels say so (`:536-544`); unchanged | the preview deep-equals the public panel (`glamPreview.test.ts:93,138,144`), now with equal labels on both sides |
| `admin/src/components/glamPreview.test.ts:93`, `:138`, `:144` | the same constant on both sides of each equality | the deep-equality assertions stay; no expectation is rewritten |
| `admin/src/components/GlamPricelistImport.test.ts:633`, `:679` | `RO_FACET_LABELS = { producer: "Producător", variantDefault: "Variantă" }` (today's headings) | today's expectations unchanged |
| `packages/shared/test/facets.test.ts` (`:179` helper and the direct calls `:275`, `:375`, `:381`, `:418`, `:437`, `:540`, `:576`, `:583`, `:597`) | `RO_FACET_LABELS` | today's expectations unchanged, plus one new case: the headings come from the input (EN labels → `Brand` / `Option`) |
| `packages/shared/test/facet-modes.test.ts:23` | `RO_FACET_LABELS` | unchanged expectations |
| `packages/shared/test/cat-import-profile-1b-golden.test.ts:39`, `:65` | `RO_FACET_LABELS` | the golden file `packages/shared/test/fixtures/cat-import-profile-1b-baseline.json` is NOT re-recorded: the original Romanian headings make the comparison byte-equal to the recorded output |
| `packages/shared/test/fixtures/cat-import-profile-1b-capture/recorder.ts:23-24`, `listing.capture.ts:105` (the capture tool of that golden) | passes `RO_FACET_LABELS` through, so a later re-capture records the same headings | the tool keeps recording the same calls |

`RO_FACET_LABELS` is a test constant (one per test package), not an export of `facets.ts`. The three architecture
documents that state the old signature (`packages/shared/ARCHITECTURE.md:90`, `renderer/ARCHITECTURE.md:403`,
`admin/ARCHITECTURE.md:106`) are updated in `locale-1b`.

Note: `interestWidgetLabel` and `facetsCountOther` keep today's Romanian form for every count (`"Lista mea: 1
produse"` is what renders today for one item). The two-form rule of § 2.2 rule 3 applies to `facetsCount*`; the
aria-label keeps one form to stay byte-identical (§ 13, deferred).

Three test files pin these Romanian texts and change with `locale-1b`: `renderer/test/unit/interest-toggle.test.ts`,
`packages/shared/test/facets.test.ts` (facet headings) and rows of `renderer/test/serving-contract/contract.test.mjs`
(§ 12 E9). The Glam importer also writes "Producător" / "Variantă" (`backend/src/import/glam/map.ts`); those are
attribute names stored as product data, not renderer texts, and are out of scope.

### 6.4 Excluded, with the reason (each traced to its consumer)

| Class | Where | Consumer and reason |
|---|---|---|
| Machine-readable output | `robots.txt/route.ts:11,17,18`; `sitemap.xml/route.ts:13,36,46,54,64`; `openai-feed/route.ts:14,18`; `llms.txt/route.ts:17,23`; JSON-LD `@type` values `SitePage.tsx:468,491,500,835,842`, `ProductByIdPage.tsx:72,78,83`, `FaqRender.tsx:12,15`; schema-type enum `packages/shared/src/index.ts:239-245`, `:792` | crawlers and AI agents; schema.org vocabulary; not page text |
| Data defaults that are only compared | `renderer/src/lib/dynamo.ts:143` "Pro" (plan; no visitor reader), `:202` "Public" (compared at `SitePage.tsx:447`), `:207` "Draft" (compared at `SitePage.tsx:654`), `:208` "Hidden" (compared at `CommentsSection.tsx:22,26,76`); `:630,691` "Published" (query value); `packages/shared/src/index.ts:44-48,166,235,252,269,286,310,862,940,952,1805` enum values and their defaults | no consumer renders them. (`dynamo.ts:139` "Untitled Site" IS rendered and is mapped, § 6.1) |
| Stored schema defaults of author or tenant fields | `index.ts:145`, `:825` "Search products..." (`searchBar.placeholder`, its fallback literal is mapped § 6.2); `index.ts:1691-1692` "Submit", "Thank you! Your submission has been received." (form definition fields `submitButtonText`, `successMessage`, rendered by `DynamicForm.tsx:79`, `:146` from the stored form); `index.ts:212-213,880-881,1820-1865` font names | written into the stored item when it is created; the value is the tenant's or author's from then on (same class as LOCALE1-COPIES) |
| Country default "Romania" | `index.ts:1220` (`DeliveryConfigSchema.defaultCountry`, the checkout's preselected country) and `:1236` (`ShippingAddressSchema.country`, persisted in orders) | a stored country value, not a table text; tracked as F-SHARED-1 (`CURRENT_SLICE.md:6`), which Track B fixes |
| Admin-only shared texts | `index.ts:1924-2033` (e-mail DNS provider labels and notes); `packages/shared/src/media.ts:95`, `:104` (upload errors); `index.ts:1449`, `:1538` (schema validation messages of asset and review writes) | reachable through the `index.ts` re-export, but no renderer or block file calls them (`git grep`, § 12 E19) |
| Country facts | `country-packs/ro.ts:15-56` county names; `en.ts:15-16`, `ro.ts:58-59` region and postal labels; pack `name` | county names are proper names (checkout list); the region and postal labels and pack names have no renderer reader (§ 12 E4) |
| Country-pack text members | `country-packs/en.ts:21-108`, `ro.ts:65-152` | they ARE the RO values cited in § 6.1 and § 6.2; they move to the language packs (§ 3.2) |
| Effects | `packages/effects/src/shaders/*.ts`, `pipelines/base.ts:132-165` | shader source and developer errors (console) |
| Code and developer texts | `ThemeInjector.tsx:23,24,28,33,90,108` (CSS, fonts, script); `dynamo.ts:98,236,253,314,343,403,436,513,555,585,611,695,737` and `tenant-directory.ts:98` (query expressions); `Analytics.tsx:38`, `FBPixel.tsx:11`, `ReferralCapture.tsx:53` (scripts); `CodeBlockRender.tsx:84` (font stack); `CartContext.tsx:128`, `dynamo.ts:67-68`, `app/api/revalidate/route.ts:131-197` (developer/operator errors); `app/api/comments/route.ts:37,95` (auth header); `app/api/leads/route.ts:40` (lead source data) | not rendered to visitors |
| Brand names | "Google" `SitePage.tsx:1088`; "WhatsApp" `CommerceBar.tsx:134`, `QuickContact.tsx:18` | proper names |
| Author-only preview chrome | "Draft Preview Mode" `SitePage.tsx:656`; "DRAFT PREVIEW" `ProductByIdPage.tsx:103` | shown only to signed-in editors in preview; admin language is English (settled) |
| Symbols | arrows `CartPageView.tsx:144`, `CheckoutPageView.tsx:109,114`; "x" quantity `CheckoutPageView.tsx:572`, `SitePage.tsx:1565`; quotes `SitePage.tsx:1370`; stars `SitePage.tsx:1078,1092`; "—" `AccountPageView.tsx:206,258` | language-neutral symbols. The quotes around a search query (`“…”`) are English typography; a Romanian site would use „…”. Kept as code; deferred (§ 13) |
| Author content | block render defaults `HeroRender.tsx:47-50`; block schema defaults | written by the author per block |
| URL segments and templates | `"/confirmare"` `SitePage.tsx:106,109,386`; Romanian prefix fallbacks `"/comanda"`, `"/cos"`, `"/magazin"`, `"/produs"` `SitePage.tsx:364-365,386-387,878,1225,1248,1270,1279,1395,1484,1500`; URL templates `AccountPageView.tsx:312`, `SitePage.tsx:737,741,1379`; facet ids `facets.ts:24,26` | URLs, not texts; changing them breaks links already sent in e-mails. Named finding F-LOCALE-URL (§ 13) |
| Server-generated texts (FOLLOW-UP, packet § 3) | renderer API routes `app/api/{account/orders,auth,comments,consent,contact,leads,posts,profile}/route.ts` error strings; "Anonymous" `app/api/comments/route.ts:83` (stored author name); "Google Auth not configured for this site." `app/api/auth/[...nextauth]/route.ts:23`; middleware "Not found" `renderer/middleware.ts:146` and "Direct access forbidden" `:162`; the Next.js default 404 page (no `app/not-found.tsx` exists); backend error texts shown verbatim by `ContactRender.tsx:57`, `LeadMagnetRender.tsx:60`, `DynamicForm.tsx:64`, `CheckoutPageView.tsx:334` (`data.error`), `CartPageView.tsx:53` (`data.reason`); order e-mails `backend/src/lib/order-email.ts` | generated on a server; the packet puts them out of scope. A follow-up slice should make the clients show the table text for a failure class and log the server text |

## 7. Admin

### 7.1 The Labels page edits the whole table

`admin/src/pages/Labels.tsx` today: 10 cards for commerce keys (`:104-264`), reachable only for commerce tenants
(`admin/src/components/layout/Sidebar.tsx:61-69`, inside `isCommerce`).

After:
- **Navigation.** "Labels" moves from the Commerce section to the System section and is shown to every tenant.
- **Groups.** One section per part, shown when the part applies: "Site" (every tenant; includes a "Cookie banner &
  legal links" card with the nine keys of § 4.1), "Catalog" (catalog tenants), "Product pages & search" (commerce
  and catalog tenants), and the existing commerce cards (commerce tenants). Each section has a one-line English
  description of where the texts appear. Every key of § 6 has exactly one input on this page.
- **Inputs.** Each input shows the tenant's stored override. The placeholder shows the value of the tenant's site
  language (from the language pack), not always the English value as today (`Labels.tsx:26`). Clearing an input
  removes the override (today's behaviour, `Labels.tsx:59`). For a key of pattern D (§ 5.2) the help line says that
  an override must not be empty to show text; the page does not write `""` for a cleared input.
- **Where a save writes.** Ordinary keys → `commerceStrings` / `catalogStrings` / `siteStrings`. The nine keys →
  their fields in `gdpr` and `legalLinks` (§ 4.1). The save sends `gdpr` and `legalLinks` as the loaded objects with
  only the label fields changed, so `gdpr.enabled`, `gdpr.position` and the four legal URLs are kept. A cleared
  label is deleted from the object sent.
- **Reset.** Each section has "Reset to the language defaults". After a confirmation that states how many inputs
  will change, it removes every override of that section. For the "Cookie banner & legal links" card it deletes
  only the nine label fields; it never touches `gdpr.enabled`, `gdpr.position` or the URLs. This is how an owner
  drops copies written by the old "Overwrite All Texts" (§ 4.2).
- **Save.** One `PUT /settings` with the attributes that changed. A 400 from the limits of § 4.4 is shown with its
  message.
- **Settings page.** The five GDPR text inputs and the four legal label inputs move from Settings to Labels; Settings
  keeps `gdpr.enabled`, `gdpr.position` and the legal URLs. (Both pages save whole top-level objects, as today; the
  existing lost-update risk between two open admin pages is unchanged and not addressed here.)

### 7.2 The "apply pack" action

- "Apply" of the country select writes `countryCode` and `currency` only.
- "Overwrite All Texts" is removed in `locale-1a`. Reason: it copies texts into storage, which makes later
  language-pack fixes invisible and makes copies indistinguishable from edits. The language select (§ 3.5) plus
  "Reset to the language defaults" (§ 7.1) give the same visible result without copies.
- Existing copies stay (§ 4.2).

## 8. Visible change per tenant type — the exact ledger

### 8.1 Definitions

- Normalised locale: § 3.3. Text language: its language subtag, or English without a pack.
- "EN tenant": text language English. Within it, "en-US tenant" (normalised `en-US`, which includes an absent or
  malformed `locale`) and "EN regional tenant" (any other `en-*`, for example `en-GB`).
- "RO tenant": normalised locale `ro-*`.
- Before = what renders on `29b4178`. After = what renders when the named slice is deployed.
- The after-values are exact: the EN column, the RO column or the `ro.ts` line cited in § 6. Romanian values marked
  "RO (proposed)" in § 6 are **pending the human's approval** (decision LOCALE1-VISIBLE-DEFAULTS); each slice ships
  only approved values, and a value the human changes replaces the § 6 value in that slice's ledger.
- Date examples below are for 31 October 2026, EXECUTED in Node 22.21.1 (§ 12 E20).

### 8.2 Unchanged in every case

- Every text a tenant overrode (stored `commerceStrings`, `catalogStrings`, `siteStrings`, the nine `gdpr` /
  `legalLinks` label fields, `searchBar.placeholder`, block fields, form definition fields), on every surface where
  it renders today — with the single exception of rows L-EN-OVR / L-RO-2, where an existing override starts to
  show at a NEW place.
- A stored `""` at a pattern-D site still renders empty (§ 5.2).
- Today's Romanian catalog output on a RO catalog tenant (every row of § 6.3 keeps its "Today" value).
- `searchBar.placeholder` stored with the English schema default (§ 4.2) stays "Search products..." on RO tenants.
- The facet value sort order (§ 3.4) and every URL (§ 6.4).

### 8.3 The ledger

| Row | Tenants | Slice | Where | Before → After |
|---|---|---|---|---|
| L-ALL-1 | every tenant | `1a`: `CommentsSection.tsx:97`; `1c`: `PostGridRender.tsx:110,133`; `1d`: `AccountPageView.tsx:273,286`, `CheckoutPageView.tsx:79` | dates and numbers that used the runtime default | the visitor's browser locale (server default during server render) → the tenant's normalised locale. No change for an en-US tenant seen in an en-US browser |
| L-ALL-2 | every tenant whose reviews-carousel block has no `locale` attribute | `1c` | `ReviewsCarouselRender.tsx:43,47` | always `ro-RO` ("31 octombrie 2026") → the tenant's normalised locale; en-US tenant: "October 31, 2026"; RO tenant: no change. **This is an English-tenant text change** |
| L-ALL-2P | every tenant whose reviews-carousel block HAS a `locale` attribute | `1c` | `ReviewsCarouselRender.tsx:43,47` | **no change** — the attribute is passed raw as today (`ro-RO-u-nu-arab` keeps Arabic digits, `ro_RO` and `""` keep the raw date string, § 3.4) |
| L-EN-REG | EN regional tenants | `1a`: `SitePage.tsx:400` (→ `CheckoutPageView.tsx:524,598`), `:1090`, `:1513`, `:1543`; `1d`: `AccountPageView.tsx:319` | dates that today read `config.locale` (always undefined) or the literal `"en-US"` | en-US format → that locale; en-GB: "10/31/2026" → "31/10/2026", "Saturday, October 31, 2026" → "Saturday, 31 October 2026" |
| L-EN-CAT | EN catalog tenants | `1b` | the 40 rows of § 6.3 | the "Today" column (Romanian) → the "EN default (proposed)" column, for example "Mă interesează" → "I'm interested", "Producător" → "Brand", "Filtre" → "Filters", "3 produse" → "3 products" |
| L-EN-OVR | EN tenants with a stored override of an existing key | `1b`: `ProductByIdPage.tsx:146`, `SitePage.tsx:1312`, `SearchBar.tsx:163,173,177,217` (override already used there today: no change), `CategoryShowcaseRender.tsx:53` (`1c`); `1d`: `CartPageView.tsx:53`, `CheckoutPageView.tsx:237`, `Navbar.tsx:156,161,259`, `SitePage.tsx:1396,1438,1463-1475,1485,1501,1570`, `AccountPageView.tsx:209,261` | the E: rows of § 6.2 | English literal → the tenant's override for that key. Staging: no tenant has an override (§ 12 E3); prod UNVERIFIED |
| L-RO-1 | RO tenants | the slice that allocates the key (§ 10) | every new key of § 6.1 and § 6.2 without an override | EN column → RO column, for example "Home" → "Acasă", "Previous" → "Înapoi", "Page 2 of 5" → "Pagina 2 din 5", "Shop" → "Magazin", "3 products" → "3 produse", "Thank you for your order!" → "Îți mulțumim pentru comandă!" |
| L-RO-2 | RO tenants | as L-EN-OVR | the E: rows of § 6.2 | English literal → the tenant's override if it has one, else the cited `ro.ts` value; for example "Sign In" → "Autentificare" (`ro.ts:151`) in the Navbar |
| L-RO-3 | RO tenants | `1b`: product page (`SitePage.tsx:287`) and search page (`:1338`); `1d`: cart, checkout, account (`:345`, `:361`, `:381`) | every existing key that these callers read today through `getCommerceStrings`, without an override | the EN default (the pack layer is dead today, § 1.2) → the `ro.ts:78-152` value; for example "Description" → "Descriere", "Results for" → "Rezultate pentru", "Proceed to Checkout" → "Finalizează comanda". `shippingStreetAddress` / `billingStreetAddress` stay `""` (no RO value) |
| L-RO-4 | RO tenants with a stored `""` at a pattern-F site (§ 5.2) | the slice of that site | the 30 F expressions | the English literal → the RO default of that key |
| L-RO-5 | RO tenants without the stored field | `1a` | cookie banner and legal link labels | `en.ts:21-31` texts → `ro.ts:65-68`, `:71-75` texts (for example "Accept All" → "Acceptă toate") |
| L-RO-6 | RO tenants | as L-EN-REG and L-ALL-1 | every date and number of § 3.4, except reviews-carousel blocks with their own `locale` attribute (L-ALL-2P) and money (not in scope, § 3.2 item 5) | en-US or browser format → ro-RO: "10/31/2026" → "31.10.2026", "Saturday, October 31, 2026" → "sâmbătă, 31 octombrie 2026", "12,345" → "12.345" |
| L-RO-CAT | RO catalog tenants | `1b` | § 6.3 | **no change** (RO value = today's literal) |

Per tenant type, the rows that apply (L-ALL-2P, a no-change row, applies to every type):

| Tenant | Rows |
|---|---|
| EN content (en-US) | L-ALL-1, L-ALL-2 (only with a reviews carousel without `locale`); no other text change |
| EN commerce (en-US) | L-ALL-1, L-ALL-2, L-EN-OVR |
| EN catalog (en-US) | L-ALL-1, L-ALL-2, L-EN-CAT |
| EN regional (any kind) | the rows of its kind plus L-EN-REG |
| RO content | L-ALL-1, L-RO-1 (site part), L-RO-5, L-RO-6 |
| RO commerce | L-ALL-1, L-RO-1, L-RO-2, L-RO-3, L-RO-4, L-RO-5, L-RO-6 |
| RO catalog | L-ALL-1, L-RO-1 (site and shared product keys), L-RO-2, L-RO-3 (product and search pages), L-RO-5, L-RO-6, L-RO-CAT |

### 8.4 The live Romanian catalog tenant

Its catalog output must not change (L-RO-CAT). That holds only if its normalised `locale` is `ro-*`. Its stored
`locale` on prod is UNVERIFIED (the operator cannot read prod; staging has no RO tenant, § 12 E2). Before the
`locale-1b` renderer deploy, the human reads it (§ 4.5). If it is not `ro-*`, the human sets the site language to
Romanian in Settings in the same window; that also applies L-RO-1 … L-RO-6 to its site and product texts, which is
the intended end state for a Romanian site. Decision LOCALE1-VISIBLE-DEFAULTS.

### 8.5 How each slice will prove the ledger and nothing else (planned checks, Layer 1 and Layer 2)

Facts:
- Layer 1 is in the repo: rows `cm1-identity-commerce` and `cm1-identity-content` of
  `renderer/test/serving-contract/contract.test.mjs:1144-1153` compare the bytes of 32 URLs of two EN fixture
  tenants with `renderer/test/serving-contract/cm1-byte-identity/baseline/`, under the four CM1-A1
  canonicalisations (`cm1-byte-identity/README.md`). Its rule for an intended change: re-capture the baseline from the
  slice's start commit and record the change; never widen a canonicalisation. The fixtures set no `locale`
  (`renderer/test/serving-contract/fixtures.mjs`), so they are en-US tenants.
- Layer 2 is the operator's staging capture (`docs/slices/catalog-mode-1.md` § Layer 2, from line 869; fixture
  tenants `cm1-commerce`, `cm1-content`, `cm1-catalog`, all EN on staging, § 12 E2).

Nothing in this section has run: this document is a design. Every check below is planned for the implementation
slice named in § 10.

**The three permitted byte-difference categories.** A slice may change the bytes of a captured URL only in these
ways. Each listed difference names its category; a difference that fits none, or that the list does not name, fails.
1. *Text-node consolidation.* A literal with values becomes one filled string (§ 2.2 rule 2). React then emits one
   text node instead of several, so the `<!-- -->` separators between them disappear (example:
   `Page <!-- -->2<!-- --> of <!-- -->5` becomes `Page 2 of 5`). Visible text unchanged.
2. *Added string props.* A client component that receives its texts as a prop (Navbar, CommentsSection,
   SocialShare, InterestShortlist, block renderers) carries those strings in the RSC flight payload. Visible text
   unchanged.
3. *Approved ledger change.* A text node, an attribute value of the extraction below, or a formatted date that
   changes as one row of § 8.3 states, to that row's after-value (§ 6 EN/RO column, as approved). The listed
   difference names the row (for example `L-EN-CAT`, `L-ALL-2`).

**Before evidence and how the byte gate advances.** Rules, in the order a slice applies them:
1. The immutable before evidence of a slice is a capture taken from the slice's own start commit with the procedure
   of `cm1-byte-identity/README.md` (separate worktree, same fixtures and stub). It is committed with the slice
   under `renderer/test/serving-contract/locale-1/<slice>/before/` and never edited afterwards.
2. The slice also commits `renderer/test/serving-contract/locale-1/<slice>/expected-diff.json`: per fixture tenant
   and URL, the exact list of differences with their category (1, 2 or 3) and, for category 3, the ledger row and the
   after-value.
3. A new row `loc1-diff-<slice>` compares the candidate capture with `before/` under the CM1-A1 canonicalisations
   (unchanged — no canonicalisation is widened) and passes only when the set of differences equals
   `expected-diff.json` exactly: an unlisted difference fails, and a listed difference that does not occur fails.
4. The strict `cm1-identity-*` rows then compare with a `baseline/` that the slice re-captures from its own
   candidate tree, as the README requires for an intended change; the slice document records that it did this and
   points to `expected-diff.json` as the reviewed reason. This is the only way the strict baseline advances, and it
   happens in the same commit as the reviewed diff list.
5. The next slice starts from the advanced baseline, so its `cm1-identity-*` rows are strict again for everything
   the earlier slice did, and its own changes need their own `expected-diff.json`.

Proof per slice (decision LOCALE1-PROOF):
- **Visible-text extraction** (one helper in `renderer/test/serving-contract/`, used by all rows below): from the
  server HTML, outside `<script>` and `<style>`: (a) every text node, `<!-- -->` removed, whitespace collapsed;
  (b) the values of the attributes `alt`, `title`, `placeholder`, `aria-label`, and `value` on `<button>` and on
  `<input type="submit|button">`; (c) `<title>` and the `content` of `<meta name="description">`,
  `<meta property="og:title">`, `<meta property="og:description">`. Each item keeps its kind and document order.
- **EN rows** `loc1-text-commerce`, `loc1-text-content`: the extraction of every captured URL equals the extraction
  of `before/`, except the items of category 3 in `expected-diff.json`, which must equal their after-values. Every
  byte difference is in `expected-diff.json` with its category.
- **RO rows**: fixtures `loc1-ro-content`, `loc1-ro-commerce`, `loc1-ro-catalog` (copies of the CM1 fixtures with
  `locale: "ro-RO"`) and one fixture `loc1-en-gb-content` (`locale: "en-GB"`). A row asserts, per URL, the exact
  list of extracted items that differ from the EN capture of the same fixture, and their after-values, taken from
  the ledger (§ 8.3) and the approved RO column of § 6.
- **Client-only states** (texts that appear only after an interaction or a client fetch, so not in the server
  HTML): every text of § 6 at these sites is checked by a jsdom unit test that mounts the component (the pattern of
  `renderer/test/unit/interest-toggle.test.ts`) with the EN and the RO table and drives the state: errors and
  alerts (`CommentsSection.tsx:70`, `DynamicForm.tsx:64,69`, `PostGridRender.tsx:43,66` (`postsLoadFailed` with a
  failed fetch: EN `API 500` unchanged), `ContactRender.tsx:57,62`, `LeadMagnetRender.tsx:60,73`,
  `AddToCartButton.tsx:120,128`, `CartPageView.tsx:53,57`, `CheckoutPageView.tsx:333,334,345`, `InterestShortlist.tsx`
  errors `:51,217,228,248,250,252,255`); busy and success states (`Submitting...`, `Sending...`, `Unlocking...`,
  `Saving...`, `Searching...`, `Copied!`, `Message Sent!`, `Unlocked!`, `Added to Cart!`, the interest list sent
  state `:188-192`); toggled states (`InterestShortlist.tsx:102`, `ReviewsCarouselRender.tsx:114`); the client-fetched
  lists (`CommentsSection.tsx:82-144`, `PostGridRender.tsx:74`, `CategoryShowcaseRender.tsx:49,53,145`, the account
  page). Expected values: the EN and RO columns of § 6. Plus the preservation cases of § 5.2, and the seven
  reviews-carousel attribute cases of § 3.4 (each renders exactly today's output).
- **Layer 2 (operator, staging)**: the same extraction on `cm1-commerce`, `cm1-content` (equal except the en-US
  ledger rows) and `cm1-catalog` (exactly L-EN-CAT). RO evidence on staging needs RO staging tenants, which do not
  exist; the operator creates them or Layer 2 stays EN-only (stated in each slice).

## 9. Commerce freeze

Track B (`cmrc-1` … `cmrc-6`, `docs/ROADMAP.md:140`) is planned; commerce code changes need a named exception from
the human.

- `locale-1a`, `locale-1b`, `locale-1c` touch no commerce-only file. They do touch shared surfaces that commerce
  tenants also render: `layout.tsx`, `Navbar.tsx`, `SitePage.tsx` (product, category, shop and search branches),
  `SearchBar.tsx`, `ProductByIdPage.tsx`, `CategoryShowcaseRender.tsx`, `RenderBlocks.tsx`. For en-US commerce
  tenants the visible text stays equal except the ledger rows of § 8.3 (a planned check on the commerce fixture,
  § 8.5). For RO
  commerce tenants these shared surfaces turn Romanian. Whether the freeze covers shared surfaces is part of
  decision LOCALE1-FREEZE.
- Three changes reach commerce output without touching a commerce file:
  1. `locale-1a`: once `mapTenant` copies `locale`, the dates that already read `config.locale` change for
     non-en-US tenants — the checkout delivery picker (`SitePage.tsx:400` → `CheckoutPageView.tsx:524,598`), the
     order confirmation and tracking dates (`SitePage.tsx:1513,1543`) and the review dates (`:1090`) (rows L-EN-REG,
     L-RO-6).
  2. `locale-1b`: the product page caller (`SitePage.tsx:287`) moves to the resolver, so `AddToCartButton` receives
     language defaults: on a RO commerce tenant "Add to Cart" → "Adaugă în coș" (row L-RO-3) before `locale-1d`.
  3. The removal of the "Overwrite All Texts" button (`locale-1a`, admin).
  All three are part of the same decision.
- `locale-1d` touches commerce-only files and needs the exception: `CheckoutPageView.tsx`, `CartPageView.tsx`,
  `AccountPageView.tsx`, `AddToCartButton.tsx`, `CommerceBar.tsx`, `CartWidget.tsx`, the cart, checkout, account,
  confirmation and tracking branches of `SitePage.tsx` (routing `:339-420`, `ConfirmationPageView` `:1385`,
  `OrderTrackingView` `:1492-1576`), the commerce cards of `Labels.tsx`, the removal of `getCommerceStrings` and of
  the country-pack text members. Change kind: literal → key, prop default removed, formatter locale passed in, no
  logic, no data path, no API. Track B's `cmrc-1` changes the renderer's account and order read path
  (`docs/ROADMAP.md:140`), so the two touch `AccountPageView.tsx` and the order pages; order them, do not run them in
  parallel.
- Cost of avoiding the exception (no `locale-1d` until Track B ends): Romanian commerce tenants keep about 90
  English texts on cart, checkout, account and order pages (the 80 commerce-only keys plus the E: rows), while their
  product pages, header and footer are Romanian; `getCommerceStrings`, `COMMERCE_STRINGS_DEFAULTS` and the
  country-pack text members stay as a second, compatible path (§ 10.2).

## 10. Implementation slice outline

Each slice ships visible output on a fixture tenant, is deployed alone (§ 4.5), builds and passes its gates on its
own, and can be rolled back alone. Oracles are exit codes; paths are absolute and quoted.

Common gates (every slice; run in this order, each must exit 0):

```
npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" run build
npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" run typecheck
npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/shared" test
npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/plugins" test
npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" test
npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" run test:serving
npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/admin" run test:unit
npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend" run test:unit
npm --prefix "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/tools/mcp-server" test
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check
```

(`backend` `test:unit` needs no AWS credentials, per `CLAUDE.md`; `test:serving` is required because `layout.tsx`,
`SitePage.tsx` and `dynamo.ts` change.)

| Slice | Allocation (files) | Visible output | Slice checks (in addition) | Staging evidence (Layer 2) |
|---|---|---|---|---|
| `locale-1a` foundation + site chrome | shared: `index.ts` (Site/Catalog schemas, `LocaleStrings`), `language-packs/{types,index,en,ro}.ts` (RO commerce/cookie/legal values read from `RO_PACK`), `locale-strings.ts` (`normalizeLocale`, `resolveLocaleStrings`, `fillTemplate`); renderer: `lib/dynamo.ts` (`mapTenant`), `app/[siteId]/layout.tsx`, `Navbar.tsx` (site keys only), `SitePage.tsx` (pagination, restricted, breadcrumb Home, metadata description, `untitledSiteName`), `CommentsSection.tsx` (texts + date locale), `SocialShare.tsx`, `QuickContact.tsx`, `DynamicForm.tsx`, `CookieConsent.tsx`; admin: `Labels.tsx` (Site group incl. cookie/legal card, Reset), `Sidebar.tsx`, `Settings.tsx` (§ 3.5, § 7.2, nine text inputs removed); backend: `tenant/settings.ts` (§ 4.4 limits); docs: package `ARCHITECTURE.md` files | `loc1-ro-content` renders the site chrome in Romanian; `loc1-en-gb-content` dates en-GB | shared: EN pack complete (compile), RO pack covers every shipped key, layer order, the § 3.3 locale cases, non-string ignored, nine keys never read from `siteStrings`, `fillTemplate`; renderer unit: `mapTenant` passes every part field and `locale`; client-only states of the 1a sites (§ 8.5); `loc1-text-commerce`, `loc1-text-content`, RO and en-GB rows; backend unit: each § 4.4 limit → 400 with nothing written, a body without the new attributes is never refused, `commerceStrings` never validated; admin unit: the Labels save keeps `gdpr.enabled`, `gdpr.position` and the legal URLs, a cleared label is deleted, Reset touches only label fields | `cm1-content` 14 URLs, `cm1-commerce` 18 URLs: extraction equal except en-US ledger rows; byte diffs enumerated |
| `locale-1b` catalog + shared product surfaces | shared: catalog part (40 keys) + 25 shared commerce keys + RO values, `facets.ts` (required `labels` parameter) and every caller of § 6.3 "The shared signature change" — `test/facets.test.ts`, `test/facet-modes.test.ts`, `test/cat-import-profile-1b-golden.test.ts`, `test/fixtures/cat-import-profile-1b-capture/{recorder,listing.capture}.ts`; admin: `components/glamPreview.ts` (`facetLabels` in the site context), `components/GlamPricelistImport.tsx` (unchanged call, richer context), `components/glamPreview.test.ts`, `components/GlamPricelistImport.test.ts`; docs: the three `ARCHITECTURE.md` lines of § 6.3; renderer: `InterestShortlist.tsx`, `SitePage.tsx` (facets, product/category/shop/search branches, metadata, callers `:287` and `:1338` moved to the resolver, `getSearchLabels` removed), `SearchBar.tsx`, `ProductByIdPage.tsx`; admin: `Labels.tsx` (Catalog and Product pages & search groups); tests: `interest-toggle.test.ts`, catalog rows of `contract.test.mjs` | `cm1-catalog` (EN) shows the English catalog copy; `loc1-ro-catalog` shows today's Romanian catalog texts unchanged plus Romanian product/shop texts | RO catalog: the 40 catalog texts equal to today's; EN catalog: exactly L-EN-CAT; facet ids unchanged in every href; client-only states of the interest list; preservation cases of the SearchBar F sites; the golden test passes against the unchanged baseline JSON; `glamPreview.test.ts` equalities pass; admin typecheck (the common gate) proves no caller is left without `labels` | `cm1-catalog` 19 URLs: exactly L-EN-CAT; `cm1-commerce`, `cm1-content` as in `1a`; prod pre-check § 4.5 recorded |
| `locale-1c` block chrome | plugins: the 11 `*Render.tsx` of § 6.1 (for `CategoryShowcaseRender.tsx` also its two rows of § 6.2; `PostGridRender.tsx` and `ReviewsCarouselRender.tsx` also their date locale); renderer: `RenderBlocks.tsx` (`strings` prop) | `loc1-ro-content` blocks in Romanian | plugins tests (jsdom) for every block state of § 8.5, including `postsLoadFailed` (a failed fetch renders `API 500` in EN) and the seven reviews-carousel attribute cases of § 3.4 (L-ALL-2P); L-ALL-2 on a fixture page with a reviews carousel | `cm1-content`, `cm1-commerce`: equal except en-US ledger rows |
| `locale-1d` commerce (needs the exception) | renderer: § 9 list; shared: 80 commerce-only keys, `language-packs/ro.ts` takes the RO values as literals, `country-packs/{types,en,ro}.ts` text members removed; admin: commerce cards regrouped | `loc1-ro-commerce` cart/checkout/account/confirmation/tracking in Romanian | command `L1D-NO-READER` of § 10.2 exits 1 (no reader left); preservation cases for every F site of § 5.2; client-only states of the commerce views | `cm1-commerce` 18 URLs: equal except en-US ledger rows |
| `locale-1e` `<html lang>` per tenant (optional) | `renderer/src/app/layout.tsx:9` (`lang="en"` for every tenant) and the root/`[siteId]` layout split | `<html lang="ro">` on RO tenants | serving-contract suite (structure change of the root layout) | all fixture URLs: only the `lang` attribute differs |

### 10.1 Slice-specific command

`L1D-NO-READER` (`locale-1d`; expected exit 1 = no match):

```
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -n -E 'getCommerceStrings|COMMERCE_STRINGS_DEFAULTS|defaultStrings' -- renderer/src admin/src packages/shared/src
```

### 10.2 Compatibility members and their removal point

| Member | Kept by | Read until | Removed in |
|---|---|---|---|
| `CountryPack.defaultStrings`, `CountryPack.gdpr`, the label texts of `CountryPack.legal` | `getCommerceStrings` (`SitePage.tsx:85`), `language-packs/ro.ts` (reads them, no second copy), Settings "Overwrite All Texts" (removed in `1a`), `layout.tsx:128`, `:236` (moved in `1a`) | `locale-1d` | `locale-1d`, after `getCommerceStrings` is deleted and `language-packs/ro.ts` holds the values |
| `getCommerceStrings` | callers `:345`, `:361`, `:381` (commerce-only) | `locale-1d` | `locale-1d` |
| `COMMERCE_STRINGS_DEFAULTS` | prop defaults of the three commerce views, `Labels.tsx` placeholders (until the `1a` Labels change) | `locale-1d` | `locale-1d` |

Intermediate behaviour (after `1a`, before `1d`): the commerce-only pages keep today's resolution exactly
(`getCommerceStrings`, the country-pack layer still dead because `countryCode` is not copied), so their texts do not
change before the exception; only rows L-EN-REG and L-RO-6 (dates) and the `1b` product-page row of § 9 reach them.
If LOCALE1-FREEZE = B, this intermediate state lasts until Track B ends; every gate above still passes in it.

Order (decision LOCALE1-SLICE-ORDER): `1a` → `1b` → `1c` → `1d` (after the exception, and not in parallel with
`cmrc-1`) → `1e`. Each slice: backend → admin → renderer; rollback renderer first.

## 11. Decisions for the human

DECISION_REQUIRED:
- ID: LOCALE1-STORAGE
  QUESTION: Where are the overrides of the general table stored, and does today's `commerceStrings` move?
  PROBLEM: Today the only overridable table is the attribute `commerceStrings` of the tenant item (77 keys). The
    table becomes general with three parts. The old attribute may hold live data on prod (UNVERIFIED; on staging
    all 169 are empty maps), some of it possibly copies from "Overwrite All Texts". The renderer reads the tenant
    item through `mapTenant`, a whitelist that has already dropped two fields silently (`countryCode`, `locale`).
    The stored shape decides whether live data moves, what a rollback must handle, and how many places a future part
    touches.
  OPTIONS:
  - A — one attribute per part: `commerceStrings` (unchanged, = commerce part), new `catalogStrings`, `siteStrings`.
    REWARD: no data migration, no dual write; rollback of any component is safe (old code ignores new attributes,
    new code reads the old one as before); smallest change; each name says what it holds. RISK: three attributes
    instead of one; a future fourth part needs a new attribute and a `mapTenant` line (mitigated by a unit test that
    fails when `mapTenant` drops a part field).
  - B — one new attribute `localeStrings: { commerce, catalog, site }`; `commerceStrings` deprecated. REWARD: one
    attribute matches the one-table concept; a new part needs no new attribute. RISK: expand/contract migration —
    dual write of the commerce part during rollout, a backfill (Query over `PK = "SYSTEM"`), a reader switch, a
    later removal; an admin rollback during the dual-write phase can hide an owner's edit unless the reader stays on
    `commerceStrings` until the contract step; two more production-impacting slices.
  - C — add every new key to `commerceStrings`. REWARD: no new attribute at all. RISK: the attribute name then lies
    about its content (site and catalog texts in "commerce strings") — a misleading persisted name for every later
    reader; rejected by the naming rule.
  RECOMMENDED: A. It satisfies the direction (one general table, one resolver, per-tenant overrides) with no data
    movement. The table is general at the type and resolver level (`LocaleStrings`), not by forcing one attribute.
  BLOCKING_REASON: the schema, the PUT validation and the Labels save all depend on the stored shape.

DECISION_REQUIRED:
- ID: LOCALE1-COPIES
  QUESTION: What happens to stored values that are copies of a default (pack copies from "Overwrite All Texts";
    `searchBar.placeholder` stored as "Search products...")?
  PROBLEM: A copy and an owner's edit look the same in storage. Because the pack layer never runs on the
    renderer (§ 1.2), a stored RO pack copy is today the ONLY source of Romanian on that tenant. After this track,
    a copy blocks the language value for that key (e.g. a Romanian tenant keeps the English
    "Search products..." placeholder; a pack copy hides later fixes of the RO pack).
  OPTIONS:
  - A — keep every stored value as an override; give owners "Reset to the language defaults" per Labels group.
    REWARD: zero visible change from stored data; no script on prod data; the owner decides. RISK: copies persist
    until an owner acts; some RO tenants keep English stored defaults.
  - B — at deploy, a script removes every stored value equal to a known default (EN or the tenant's pack). REWARD:
    tenants get language values without acting. RISK: removes some deliberate choices that happen to equal a
    default; a write to every tenant item on prod; the operator cannot read prod to check it.
  RECOMMENDED: A.
  BLOCKING_REASON: decides whether `locale-1a` includes a data script.

DECISION_REQUIRED:
- ID: LOCALE1-LANGUAGE
  QUESTION: Which field is the per-tenant language setting, and do texts leave the country packs?
  PROBLEM: One country pack holds country facts and texts, and "Apply Pack" offers them together. The stored
    fields are already independent (§ 3.1): a Romanian company with an English site can keep `countryCode: "RO"`
    via "Locale & Currency Only" and render English, because on the live renderer texts never depend on the
    country. The renderer also never receives `countryCode` or `locale` (§ 1.2), so no language layer works today. `countryCode` also feeds a commerce default (`SitePage.tsx:399`) that would change if
    it started to reach the renderer.
  OPTIONS:
  - A — language = primary subtag of the existing `locale`; texts move to language packs; country packs keep facts;
    `mapTenant` copies `locale`, not `countryCode`. REWARD: no new field; country and language independent; no
    commerce behaviour change from `countryCode`. RISK: the dates and numbers of § 3.4 change format for tenants
    with a non-`en-US` locale (enumerated, § 8.3; money formatting stays as today); a malformed locale normalises to `en-US` and English (§ 3.3) — never an error, shown as
    a warning in Settings.
  - B — a new field `language` ("en" | "ro"). REWARD: explicit, validated by an enum. RISK: three overlapping
    fields (`countryCode`, `locale`, `language`) that can contradict (language ro, locale en-US); a data default for
    every existing tenant.
  - C — keep `countryCode` as the text selector and copy it in `mapTenant`. REWARD: smallest code change. RISK:
    the default texts follow the country, so a Romanian company with an English site must override every text by
    hand once the pack layer works (today it gets English only because that layer is dead); every English
    commerce tenant's checkout changes its default region list (F-LOCALE-COUNTIES) — a commerce change under the
    freeze.
  RECOMMENDED: A.
  BLOCKING_REASON: the resolver input and the admin Settings card depend on it.

DECISION_REQUIRED:
- ID: LOCALE1-VISIBLE-DEFAULTS
  QUESTION: Which visible texts may change on live tenants?
  PROBLEM: Making the language real changes what visitors read. The exact set is the ledger of § 8.3 (rows L-ALL-1
    … L-RO-CAT), with after-values from § 6: (1) RO tenants: every text without an override becomes Romanian,
    including "Shop" → "Magazin" and the cookie banner; (2) EN catalog tenants: the 40 Romanian catalog texts become
    English; (3) where an existing key is read at a new place, an owner's existing override of that key shows there
    too; (4) dates and numbers follow the normalised `locale`, which also changes EN regional tenants (en-GB) and
    every date that followed the visitor's browser; (5) reviews-carousel dates without a block `locale` change from
    Romanian format to the tenant's (an English-tenant change). The RO values in § 6 are proposals: approving this
    decision also approves them, or names the values to change. The live Romanian catalog tenant keeps its catalog
    texts only if its `locale` is `ro-*` (UNVERIFIED on prod).
  OPTIONS:
  - A — accept the enumerated set; before the `locale-1b` renderer deploy, the human checks the Romanian catalog
    tenant's `locale` and sets it to Romanian if needed. REWARD: every tenant ends in its own language; one rule
    everywhere. RISK: RO tenants see many texts change in one deploy per slice; the new Romanian copy must be right
    (the human approves the RO column of § 6 with this decision).
  - B — pin today's output: before each renderer deploy, write today's rendered texts as overrides for every affected
    tenant. REWARD: zero visible change on any live tenant. RISK: freezes English on Romanian tenants (the defect this
    track removes); a write to every tenant item on prod; brings back the copy problem of LOCALE1-COPIES.
  - C — a per-tenant switch "use the language table" (default off for existing tenants). REWARD: owners opt in.
    RISK: two rendering paths to keep and test for every text; existing tenants stay on English literals until they act.
  RECOMMENDED: A, with the catalog-tenant check as a recorded pre-deploy step.
  BLOCKING_REASON: Layer 1/2 pass rules and the RO values are defined by this list.

DECISION_REQUIRED:
- ID: LOCALE1-BLOCK-TEXTS
  QUESTION: Do the fixed texts of block renderers go to the table or to new block fields?
  PROBLEM: Blocks have author fields (headline, button text) and fixed chrome ("Name", "Email", "Sending...",
    "Copy", "Read more", "No posts found."). The chrome is English in every language today.
  OPTIONS:
  - A — chrome to the site part; author fields stay; an existing block field wins over the key. REWARD: chrome follows
    the site language with no per-block work; no block schema change; existing blocks keep their content. RISK: an
    author cannot give two blocks of one page different chrome texts.
  - B — a new block field for every chrome text. REWARD: per-block control. RISK: every existing block instance
    stays English until edited; about 30 new fields in 11 block editors; English defaults stored per block (the copy
    problem again).
  RECOMMENDED: A.
  BLOCKING_REASON: `locale-1c` allocation.

DECISION_REQUIRED:
- ID: LOCALE1-FREEZE
  QUESTION: Do you grant a named commerce-freeze exception for `locale-1d`, and does the freeze cover shared surfaces?
  PROBLEM: Commerce code changes need your exception while Track B is planned. `locale-1d` changes only texts in
    commerce-only files (§ 9 list). `locale-1a`–`1c` change shared files that commerce tenants also render (layout,
    Navbar, the product/shop/search branches of SitePage); for en-US commerce tenants the visible text stays equal
    except the ledger rows (a planned check, § 8.5), for RO commerce tenants those shared texts turn Romanian. Three changes reach
    commerce pages without a commerce file (§ 9): dates (once `mapTenant` copies `locale`), the product page's
    AddToCartButton defaults (`1b`), and the removed "Overwrite All Texts" button. `cmrc-1` touches the account and
    order pages too.
  OPTIONS:
  - A — grant "LOCALE-1D commerce strings" now: literal → key only, no logic or data path, scheduled after `cmrc-1`
    merges (or before it starts), never in parallel; the freeze does not cover shared surfaces. REWARD: Romanian
    commerce tenants become fully Romanian; one resolution path. RISK: a merge conflict with Track B if the order is
    not kept; commerce pages change visibly for RO tenants.
  - B — no exception until Track B ends; shared surfaces may change. REWARD: Track B untouched. RISK: RO commerce
    tenants show mixed languages (Romanian header and product pages, English cart/checkout/account) for the length
    of Track B; two resolution paths remain.
  - C — the freeze also covers shared surfaces. REWARD: commerce tenants see no change until the exception. RISK:
    `locale-1a`–`1c` must keep commerce tenants on the old texts (a per-tenant branch in shared code), which adds the
    two-path cost of LOCALE1-VISIBLE-DEFAULTS C.
  RECOMMENDED: A.
  BLOCKING_REASON: `locale-1d` cannot start, and the scope of `1a`–`1c` on commerce tenants is undefined, without it.

DECISION_REQUIRED:
- ID: LOCALE1-SLICE-ORDER
  QUESTION: In which order do the implementation slices run?
  PROBLEM: The catalog's Romanian literals are the defect that started this track; the foundation (schema, packs,
    resolver, mapTenant) is needed by every slice.
  OPTIONS:
  - A — `1a` foundation + site chrome → `1b` catalog + shared product surfaces → `1c` blocks → `1d` commerce → `1e`
    html lang. REWARD: the first deploy exercises the mechanism on every tenant kind while en-US tenants see only
    the date rows of the ledger (L-ALL-1 for comment dates; L-EN-REG only on regional English tenants), checked by
    the planned rows of § 8.5; risk grows slice by slice. RISK: the catalog fix waits one slice.
  - B — `1a'` foundation + catalog first, then site chrome, blocks, commerce. REWARD: the catalog defect is fixed in
    the first deploy. RISK: the first deploy changes visible text (EN catalog → English) at the same time as the new
    mechanism goes live, so a failure is harder to attribute.
  RECOMMENDED: A.
  BLOCKING_REASON: the first slice's allocation depends on it.

DECISION_REQUIRED:
- ID: LOCALE1-PROOF
  QUESTION: How do the slices prove "no visible change" for English tenants when the bytes must change?
  PROBLEM: The Layer 1 identity rows compare bytes. Translatable keys hold whole phrases (§ 2.2), which removes React
    `<!-- -->` separators, and client components carry their texts in the RSC payload. So EN bytes change although
    EN text does not, and the approved ledger rows (§ 8.3) change text and dates on purpose. The identity README
    forbids widening a canonicalisation to make a row pass.
  OPTIONS:
  - A — add a visible-text row per tenant: text nodes plus the text-bearing attributes (`alt`, `title`,
    `placeholder`, `aria-label`, button values) plus `<title>` and description metas; three permitted byte-difference
    categories (consolidation, added props, approved ledger change), each difference listed in a committed
    `expected-diff.json` against an immutable start-commit capture; the strict baseline advances only with that
    reviewed list (§ 8.5); equal for EN except the
    ledger rows; jsdom unit tests for texts that appear only in client states; re-capture the byte baseline per slice
    and list every byte diff per URL with its cause (§ 8.5). REWARD: proves the claim that matters on every text
    surface of § 6; keeps the byte rows strict for later slices. RISK: one new helper in the test harness and one
    unit test per client state; a reviewer reads the per-URL diff list.
  - B — keep byte identity by using fragment keys ("Page", "of", "s"). REWARD: no harness change. RISK: Romanian word
    order and plurals cannot be expressed; the table would not be translatable.
  - C — manual screenshot review. REWARD: no harness change. RISK: not repeatable; not evidence by the house rules.
  RECOMMENDED: A.
  BLOCKING_REASON: the oracle of every slice depends on it.

DECISION_REQUIRED:
- ID: LOCALE1-HTML-LANG
  QUESTION: Is `<html lang>` per tenant in this track (`locale-1e`) or deferred?
  PROBLEM: `renderer/src/app/layout.tsx:9` declares `lang="en"` for every tenant. A Romanian page announced as
    English is read with English pronunciation by screen readers and is a weaker language signal for search engines.
    The root layout has no tenant config; the fix moves `<html>` into the tenant layout, a serving-structure change.
  OPTIONS:
  - A — include as `locale-1e`, gated by the serving-contract suite. REWARD: correct language for assistive
    technology and search. RISK: a root-layout restructure touches every route; cache behaviour must be re-proven.
  - B — defer to a separate slice after this track. REWARD: smaller track. RISK: Romanian sites keep `lang="en"`.
  RECOMMENDED: A, last.
  BLOCKING_REASON: not blocking `1a`–`1d`; it decides whether `1e` exists.

## 12. Evidence log

Commands that contain `|` are given in code blocks, exactly as run (a `|` inside a table cell would have to be
escaped and would then not reproduce). Revision 1 corrects E4, E7 and E9 of revision 0: the recorded E4/E9 commands
had escaped pipes and reproduce with exit 1; E7 said 11 recovered texts where § 6.0 said 12.

| # | Label | Command / read | Result |
|---|---|---|---|
| E1 | EXECUTED | `git log --oneline -3`; `git status --porcelain -uall`; `git diff 29b4178 HEAD --stat` | HEAD `898ad31`; tree clean at start; only `docs/ROADMAP.md` differs from `29b4178` (1 insertion) |
| E2 | EXECUTED | E2 block below | 539 tenant items; `cm1-catalog` (catalogMode, EN), `cm1-commerce` (EN), `cm1-content` (EN); 0 items with `countryCode` other than EN. No RO tenant on staging |
| E3 | EXECUTED | E3 block below | 169 items have `commerceStrings`; every one is an empty map |
| E4 | EXECUTED | E4 block below | exit 0, 57 lines in 19 files: `admin/src/context/TenantContext.tsx` 1, `admin/src/pages/Labels.tsx` 4, `admin/src/pages/Settings.tsx` 10, `backend/src/tenant/list.ts` 2, `packages/shared/src/country-packs/{en,index,ro,types}.ts` 1/4/1/1, `packages/shared/src/index.ts` 4, `packages/shared/test/schemas.test.ts` 2, `renderer/src/app/[siteId]/layout.tsx` 5, `AccountPageView.tsx` 2, `CartPageView.tsx` 2, `CheckoutPageView.tsx` 2, `SitePage.tsx` 11, `renderer/src/lib/dynamo.ts` 1, renderer test fixtures 4. No `tools/mcp-server` and no backend handler other than `tenant/list.ts` |
| E5 | OBSERVED | read `renderer/src/lib/dynamo.ts:87-174` | `getTenantConfig` returns `mapTenant(item)`; the returned object has no `countryCode` and no `locale` |
| E6 | EXECUTED | `node walk.cjs "/Users/apple/Documents/APLICATII BIJUTERIE/amodx"` (TypeScript 5.9.3 compiler API; run from `/tmp/LOCALE-1-inv/`, deleted after the run; copies of `walk.cjs` and `filter.py` kept in the gitignored `.agent-manager/slices/locale-1/`) | revision 1 walker (workspace imports followed): 131 files; 159 JSX text nodes; 4 326 string/template literals with a letter; 0 unresolved `@amodx/*` imports. (Revision 0 walker: 91 files, 3 275 literals — it did not follow workspace imports and missed `facets.ts`) |
| E7 | EXECUTED | `python3 -I filter.py` over the E6 output; residual list of the renderer and plugin files printed and read | 752 candidates (396 renderer/plugin, 356 shared/effects); 576 residual renderer/plugin literals read, 12 visitor texts recovered; 383 residual shared/effects literals read, 0 new visitor texts (§ 6.0) |
| E8 | EXECUTED | `node -e` over `packages/shared/dist/index.js` (built, gitignored) | `COMMERCE_STRINGS_DEFAULTS` 77 keys = schema 77 keys; EN pack differs from the defaults only by lacking `shippingStreetAddress`, `billingStreetAddress`; the RO pack lacks the same two. Every literal of the 30 F expressions equals its `COMMERCE_STRINGS_DEFAULTS` value (compared by reading E22's output against `index.ts:677-760`) |
| E9 | EXECUTED | E9 block below | exit 0: `renderer/test/serving-contract/contract.test.mjs`, `renderer/test/unit/interest-toggle.test.ts`, 28 `cm1-byte-identity` bodies; admin hits (`Labels.tsx`, Glam import files) are admin-only. A second search for `Producător\|Variantă` adds `packages/shared/test/facets.test.ts` and the backend Glam importer (§ 6.3) |
| E10 | OBSERVED | read `packages/shared/src/index.ts:1308` and `SitePage.tsx:1507-1527` | order status enum `placed…annulled`; the tracking timeline uses `pending, confirmed, processing, shipped, delivered, completed` |
| E11 | OBSERVED | read `CheckoutPageView.tsx:150-152`, `SitePage.tsx:399` | counties = `availableCounties` or `defaultRegions` (= RO pack regions while `countryCode` is undefined) |
| E12 | OBSERVED | read `backend/src/tenant/settings.ts:28-50,108-235` | PUT merges `{ ...current, ...body }` (`:139`); top-level keys replaced whole; only the strip list and the mode flags are checked |
| E13 | OBSERVED | read `admin/src/components/layout/Sidebar.tsx:43,61-69` | "Labels" shown only when `commerceEnabled` |
| E14 | NOT RUN | any read of prod data | the operator and the builder cannot read prod; every prod claim in this document is labelled UNVERIFIED |
| E15 | EXECUTED | `git show 29b4178:<file> \| sed -n <line>p` for the packet's citations | all hold, except: the packet's `Settings.tsx:2056` (the copy) is `:2057` at `29b4178` (`:2056` is `currency: pack.currency.code`); the dialog spans `:2023-2081` |
| E16 | EXECUTED | script over the E7 candidates: for each, a line of this document naming the file and a line number or range that contains it | result recorded in § 12.1 |
| E17 | EXECUTED | script: every `file:line` token of this document resolved against `git ls-tree -r 29b4178` and checked against the file's line count at `29b4178` | result recorded in § 12.1 |
| E18 | EXECUTED | staging query, filter `attribute_exists(searchBar)`; one query for `TENANT#cm1-content` | 171 items store `searchBar`; the first two (`c9-probe-…`, `cm1-catalog`) hold `placeholder: "Search products..."`; `cm1-content` stores no `searchBar`, `gdpr` or `legalLinks` |
| E19 | EXECUTED | E19 block below | first command: exit 0, 16 lines = 14 formatting call sites (13 date/number calls and the `facets.ts:108` collator) plus 2 comment lines (`facets.ts:106-107`); all in § 3.4 (the block default `ReviewsCarouselRender.tsx:43` was read by hand). Second command: exit 1 — no renderer or plugin caller of `media.ts` or of the country-pack address labels |
| E20 | EXECUTED | E20 block below (Node 22.21.1) | `ro_RO`, `en_US`, `" ro-RO "`, `""`, `"123"` → `Intl.getCanonicalLocales` throws `RangeError` and `toLocaleDateString` throws `RangeError`; `ro-ro` → `ro-RO`; `RO` → `ro`; `xx-YY` canonical but unsupported (formats as `10/31/2026`); `de-DE` supported; `ro-RO-u-nu-arab` formats `٣١.١٠.٢٠٢٦`. Formats for 31 Oct 2026: en-US `10/31/2026`, en-GB `31/10/2026`, ro-RO `31.10.2026`; long: `Saturday, October 31, 2026` / `Saturday, 31 October 2026` / `sâmbătă, 31 octombrie 2026`; `12345` → `12,345` / `12,345` / `12.345` |
| E21 | EXECUTED | staging query of all 539 `TENANT#` items (no projection); size = UTF-8 bytes of each item's DynamoDB JSON | largest 2 775 bytes; median 1 114 bytes; `gdpr` holds only `enabled`, `position` on staging; no item stores `legalLinks` fields |
| E22 | EXECUTED | E22 block below | exit 0; 30 fallback expressions (§ 5.2 row F) |
| E23 | EXECUTED | E23 block below | exit 0: callers of `buildFacetListing(` in code — `renderer/src/components/SitePage.tsx:298,312`; `admin/src/components/glamPreview.ts:267`; `admin/src/components/glamPreview.test.ts:93,138,144`; `admin/src/components/GlamPricelistImport.test.ts:633,679`; `packages/shared/test/facets.test.ts` (10 calls); `packages/shared/test/facet-modes.test.ts:23`; `packages/shared/test/cat-import-profile-1b-golden.test.ts:39,65`; `packages/shared/test/fixtures/cat-import-profile-1b-capture/{recorder.ts:23-24,listing.capture.ts:105}`; plus 7 documentation lines: 3 `ARCHITECTURE.md` lines (allocated to `locale-1b`) and 4 lines in older slice documents (`cat-facets-1-impl.md:74`, `cat-import-profile-1.md:653`, `cat-import-profile-1c.md:63,144`), left as written history |
| E24 | EXECUTED | E24 block below (Node 22.21.1) | the reviews-carousel `formatDate` of today, for `2026-10-31`: absent → `31 octombrie 2026`; `ro-RO` → `31 octombrie 2026`; `en-US` → `October 31, 2026`; `ro-RO-u-nu-arab` → `٣١ octombrie ٢٠٢٦`; `ro_RO` → `2026-10-31`; `xx-YY` → `October 31, 2026`; `""` → `2026-10-31` |
| E25 | EXECUTED | E25 block below | exit 0, 15 money `toFixed` sites in `renderer/src` (`AddToCartButton.tsx:272`; `CartPageView.tsx:132,160,184,189,194,198,207,213`; `CartWidget.tsx:16`; `CheckoutPageView.tsx:574,583,588,593,603`); none in the block renderers except the admin-only `EffectControls.tsx` |

E2 / E3 / E18 / E21 (read-only queries on `AmodxTable-staging`; key condition `PK = "SYSTEM"` and
`begins_with(SK, "TENANT#")`, never a scan):

```
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"SYSTEM"},":s":{"S":"TENANT#"}}' --projection-expression "SK, countryCode, #l, commerceEnabled, catalogMode, currency" --expression-attribute-names '{"#l":"locale"}' --output json
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"SYSTEM"},":s":{"S":"TENANT#"},":en":{"S":"EN"}}' --filter-expression "attribute_exists(countryCode) AND countryCode <> :en" --projection-expression "SK, countryCode" --output text
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"SYSTEM"},":s":{"S":"TENANT#"}}' --filter-expression "attribute_exists(commerceStrings)" --projection-expression "SK, commerceStrings, countryCode" --output json
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"SYSTEM"},":s":{"S":"TENANT#"}}' --filter-expression "attribute_exists(searchBar)" --projection-expression "SK, searchBar" --output json
aws dynamodb query --table-name AmodxTable-staging --key-condition-expression "PK = :p AND begins_with(SK, :s)" --expression-attribute-values '{":p":{"S":"SYSTEM"},":s":{"S":"TENANT#"}}' --output json
```

E4:

```
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -n -E 'commerceStrings|getCommerceStrings|COMMERCE_STRINGS_DEFAULTS|CommerceStrings\b|defaultStrings|getCountryPack|COUNTRY_PACKS|countryCode|\.locale\b' -- ':!*.md' ':!docs' ':!*.cache' ':!*.vf'
```

E9:

```
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -l -E 'Mă interesează|Filtre|Șterge filtrele|produse|Lista mea|No products in this category|Restricted Access|Add to Cart|Sign In' -- renderer/test packages/plugins/test packages/shared/test admin/src
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -l -E 'Producător|Variantă' -- packages renderer/test admin/src backend
```

E19:

```
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -n -E 'toLocale(Date|Time)?String|toLocaleString|Intl\.|localeCompare' -- renderer/src packages/plugins/src packages/shared/src/facets.ts packages/shared/src/catalog-listing.ts
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -n -E 'validateMedia|media\.js|regionLabel|postalCodeLabel|phonePrefix|phoneFormat' -- renderer/src packages/plugins/src
```

E20:

```
node -e 'for (const v of ["ro-RO","ro_RO","ro-ro","RO","en-GB"," ro-RO ","","xx-YY","en_US","de-DE","123","ro-RO-u-nu-arab", undefined]) { let c,e; try { c = Intl.getCanonicalLocales(v)[0]; } catch (x) { e = x.name; } let f; try { f = new Date("2026-10-31T12:00:00Z").toLocaleDateString(v); } catch (x) { f = "THROWS " + x.name; } console.log(JSON.stringify(v), c ?? e, JSON.stringify(c ? Intl.DateTimeFormat.supportedLocalesOf([c]) : []), f); }'
node -e 'const d = new Date("2026-10-31T00:00:00"); for (const l of ["en-US","en-GB","ro-RO"]) console.log(l, d.toLocaleDateString(l), d.toLocaleDateString(l, {weekday:"long",year:"numeric",month:"long",day:"numeric"}), (12345).toLocaleString(l));'
```

E22:

```
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -n -o -E '(strings|labels\??)\.[a-zA-Z]+ *\|\| *("[^"]*"|'"'"'[^'"'"']*'"'"'|strings\.[a-zA-Z]+)' -- renderer/src packages/plugins/src
```

E23:

```
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -n "buildFacetListing("
```

E24:

```
node -e 'function formatDate(s, locale = "ro-RO") { if (!s) return ""; try { return new Date(s).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }); } catch { return s; } } for (const l of [undefined, "ro-RO", "en-US", "ro-RO-u-nu-arab", "ro_RO", "xx-YY", ""]) console.log(JSON.stringify(l), "->", JSON.stringify(formatDate("2026-10-31", l)));'
```

E25:

```
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" grep -n "toFixed" -- renderer/src packages/plugins/src
```

### 12.1 Results of the document checks (re-run for revision 2)

- E16 (coverage): 764 texts checked (752 candidates of E7 plus the 12 recovered literals); 54 are covered by a
  directory class of § 6.4 (`renderer/src/app/api/**` server texts, `packages/effects/src/shaders/**`); for the other
  710 a line of this document names the file and a line or range that contains the literal; 0 not found. The check
  is lenient by design: it proves that each literal is placed somewhere in the document, not that its row is right.
- E17 (citations): 606 `file:line` references in uniquely named files, 0 beyond the end of the file at `29b4178`.
  Bare `index.ts:` and `layout.tsx:` short forms and the brace form `{recorder.ts:…,listing.capture.ts:105}` (not
  resolvable by the script) follow a full path in the same
  sentence or table and were not counted. Content was checked by hand for a sample of new citations (§ 3.4, § 6.3,
  § 6.4 rows).

## 13. Named findings and deferred debt (outside this design's slices)

- **F-LOCALE-MAPTENANT** — `mapTenant` drops `countryCode` and `locale` (§ 1.2). Fixed for `locale` by `locale-1a`;
  `countryCode` deliberately left out (next item).
- **F-LOCALE-COUNTIES** (commerce, freeze) — `SitePage.tsx:399` `getCountryPack(config.countryCode || "RO")` with
  `countryCode` always undefined → every tenant's checkout county list defaults to the 42 Romanian counties when its
  delivery config has no `availableCounties` (`CheckoutPageView.tsx:152`). INFERRED visible on English commerce
  tenants; not observed on a live page.
- **F-LOCALE-STEPS** (commerce, freeze) — the order tracking timeline (`SitePage.tsx:1507`) lists statuses that are
  not in the order status enum (`index.ts:1308`); `indexOf` returns -1 for `placed` and `prepared`, so the timeline
  shows no progress for them. Its labels ARE localised by `locale-1d` (§ 6.2); the step list is not repaired.
- **F-LOCALE-LOCALE-INPUT** — the Settings `locale` input accepts any text (`Settings.tsx:1637-1638`); a value such
  as `ro_RO` would throw `RangeError` in every formatter that receives it (§ 3.3). Today it is harmless only because
  `mapTenant` drops `locale`. Closed by `normalizeLocale` in `locale-1a`; the Settings warning (§ 3.5) shows it.
- **F-LOCALE-URL** — Romanian URL fallbacks (`"/comanda"`, `"/cos"`, `"/magazin"`, `"/produs"`, `"/confirmare"`) in
  `SitePage.tsx`; the EN-first rule says defaults are English. URLs are out of this track.
- **F-LOCALE-CONTACT-DEFAULTS** — the contact block's schema defaults (`packages/plugins/src/contact/schema.ts`:
  "Get Access", "Unlock Now", "Success! Redirecting...", tags `"contact-form"`) are lead-magnet texts; the names do
  not match the block. Admin-side, out of scope.
- **Deferred** — the Romanian third plural form ("20 de produse"); `interestWidgetLabel` single form; the quote marks
  around a search query; the facet value sort order (`facets.ts:108`, Romanian collation for every tenant); a
  `not-found.tsx` with table texts (serving-contract change); clients that show server error strings verbatim
  (§ 6.4); order e-mail texts; merging the three `noImage*` keys; locale-aware money formatting (15 `toFixed` sites,
  § 3.2 item 5); a friendlier `postsLoadFailed` wording (kept as `API {status}` in English so no EN text changes).

## 14. Exit criterion

After `locale-1d`: every visitor-facing text of § 6 comes from `resolveLocaleStrings`; its language and the
locale-sensitive formatters of § 3.4 follow the tenant's normalised `locale` (money formatting and reviews-carousel
blocks with their own `locale` attribute stay as today); every key has exactly one input on the Labels page and exactly
one stored location; command `L1D-NO-READER` (§ 10.1) exits 1. The literals that remain are the classes of § 6.4.

## 15. Review-0 findings and the rule that closes each class

| Finding | Class of defect | Rule now in this document |
|---|---|---|
| R-LOC1-INVENTORY | inventory bounded by directory instead of by consumer | the walk follows every workspace import the visitor code makes; each literal is classified by its consumer (§ 6.0); `facets.ts` headings, `"Untitled Site"` and the tracking labels are mapped (§ 6.1–6.3) |
| R-LOC1-PRESERVATION | two empty-string semantics merged into one | each reader site keeps its pattern (F or D); the fallback source becomes the language default, not a literal; preservation cases per site (§ 5.2) |
| R-LOC1-LANGUAGE | a raw stored value passed to a throwing API | one `normalizeLocale` runs before text selection and before every formatter; every formatting consumer is listed with its slice (§ 3.3, § 3.4); § 3.1 corrected |
| R-LOC1-CHANGES | change set stated by category instead of by value | the ledger names every row with its sites and exact before → after values, through the EN/RO columns of § 6 (§ 8.3); English changes (L-ALL-2, L-EN-REG) are listed |
| R-LOC1-SEQUENCE | a member removed before its last reader moves | every compatibility member has a recorded last reader and removal slice (§ 10.2); no slice removes a member another slice still reads |
| R-LOC1-LABELS | two stored locations for one key | each key has exactly one stored location and one input; the nine cookie/legal keys live only in `gdpr`/`legalLinks`, are refused in `siteStrings`, and are edited on Labels with the other fields kept (§ 4.1, § 7.1) |
| R-LOC1-SIZE | a guarantee that the validation did not enforce | the guarantee is stated only for what the limits enforce (serialised bytes per attribute), separately from the whole-item limit and from the estimate (§ 4.4) |
| R-LOC1-EVIDENCE | evidence commands not reproducible as recorded | commands with `|` are recorded in code blocks exactly as run, and re-run in revision 1; gates for backend, admin and plugins added; the proof covers attribute text and client-only states (§ 8.5, § 10, § 12) |

Review-1 (revision 2):

| Finding | Class of defect | Rule now in this document |
|---|---|---|
| R-LOC1-SEQUENCE | a shared signature changed without its current consumers | a shared signature change carries every current caller and its preservation obligation in the same slice; `buildFacetListing` gains a required `labels` parameter and all callers are allocated to `locale-1b`, the golden JSON is kept by passing the original Romanian headings (§ 6.3, § 10) |
| R-LOC1-INVENTORY | exclusion by circumstance (a failed HTTP request) instead of by producer | a text is classified by who builds it and who shows it; `PostGridRender.tsx:43` is built in the component and is mapped (`site.postsLoadFailed`, § 6.1); only texts built on a server stay in the follow-up row (§ 6.4) |
| R-LOC1-CHANGES / R-LOC1-LANGUAGE | a promise broader than the allocation, and summaries that drifted from the body | every formatting promise is limited to the listed consumers (§ 3.2 item 5, § 3.4, § 14); block-level `locale` attributes are preserved exactly, with their seven cases enumerated (§ 3.4, L-ALL-2P); decision texts restate § 3.1 instead of their own version |
| R-LOC1-EVIDENCE | a proof contract that could not pass for the changes it approves | three permitted byte-difference categories, the third being an approved ledger row; an immutable start-commit capture and an exact `expected-diff.json` per slice; the strict baseline advances only with that reviewed list; every future check is called planned (§ 8.5, § 9, § 11) |

## 16. Human rulings (2026-10-31) — this section wins where §§ 8, 10 and 11 differ

Recorded by the operator after the decision review (all nine decisions converged; LOCALE1-PROOF corrected by the
builder's concession in `.agent-manager/slices/LOCALE-1/decision-rebuttal.md`).

### 16.1 Facts the human stated (prod; the operator cannot read prod)

> "all live tenants with domains use en-US, NO commerce. one tenant for which the entire Ro language support was
> built and it had commerce, and now I want to expand with catalog, and I want to support Romanian, English and
> whatever other language may arrive in the future. no en-GB."

So: every live tenant with a domain is an en-US content tenant. The Romanian tenants are `povesti-pe-biscuite`
(commerce; a test tenant) and the glam catalog tenant. No en-GB or other regional English tenant exists. Supported
languages: Romanian and English now; further languages later.

Earlier direction (same day): "the point is the existing English sites should not change and we make all the
decisions incremental for the future".

### 16.2 Rulings

1. **LOCALE1-STORAGE = A.** `commerceStrings` stays and is the commerce part; new `catalogStrings` and `siteStrings`.
2. **LOCALE1-COPIES = A.** Stored values stay as overrides; "Reset to the language defaults" per Labels group.
3. **LOCALE1-LANGUAGE = A.** The language is the primary subtag of the normalised `locale`; texts move to language
   packs; country packs keep the facts. A new language is one language-pack file plus its registration; a key that
   the pack does not have falls back to English (§ 3.3). No other code changes for a new language.
4. **LOCALE1-VISIBLE-DEFAULTS = A′ (replaces A).**
   - **en-US tenants: no visible change in any slice.** Every text and every date renders as today. Consequences:
     L-ALL-1 does not apply to an en-US tenant (a formatter that uses the runtime default today keeps it for an
     en-US tenant); L-ALL-2 is NOT part of this track (the reviews carousel's Romanian dates on English sites are
     recorded as finding F-LOCALE-REVIEWS-DATE, a separate decision for the human); L-EN-REG does not occur (no
     regional English tenant). L-EN-OVR is permitted on the human's facts (live en-US tenants have no commerce, so
     no reason to hold commerce overrides); if a live en-US tenant is found with an override, the operator stops and
     asks. L-EN-CAT is permitted: no live English catalog tenant exists, and English catalog texts are wanted.
   - **Romanian tenants change per slice.** The human approves each slice's Romanian texts as a table (key, EN,
     proposed RO) before that slice's prod deploy; a changed value replaces the § 6 value in that slice.
   - Hard oracle for every slice: on every en-US fixture tenant the visible-text extraction (§ 8.5) is equal to the
     immutable start-commit capture, with zero ledger rows, except L-EN-CAT on `cm1-catalog` in `locale-1b`.
5. **LOCALE1-PROOF = A plus the coverage rule** of the builder's concession (items 1–6: per-slice `coverage.json`
   mapping every allocated key to a captured URL or a named headless/jsdom test state; order confirmation and
   tracking fixtures; checkout and cart with items), **without the en-GB fixtures** (no regional English tenant).
   Locale normalisation keeps unit tests for regional and malformed values.
6. **Romanian plurals (moved from "Deferred", § 13) into `locale-1b`.** Count texts take the plural category of
   `Intl.PluralRules(<language>)`; for `ro` the categories are `one` / `few` / `other`, e.g. "1 produs", "2 produse"
   (also 101–119), "20 de produse" (EXECUTED in Node 22.21.1 by the operator: 0→few, 1→one, 2→few, 19→few,
   20→other, 101→few, 119→few, 120→other). A count key holds one text per category of its language.
7. **LOCALE1-SLICE-ORDER (replaces A):** `locale-1a` (foundation + site chrome) → `locale-1b` (catalog + shared
   product surfaces + plurals) → `cmrc-counties-1` (commerce track, ROADMAP) → `locale-1d` (commerce texts) →
   `locale-1c` (block chrome) → `locale-1e` (`<html lang>`). Reason: the human ranks commerce above blocks.
8. **Decided when their slice is next (not now):** LOCALE1-BLOCK-TEXTS (`1c`), LOCALE1-FREEZE (`1d`),
   LOCALE1-HTML-LANG (`1e`).

### 16.3 Pre-deploy steps (the human's, on prod)

- Before the `locale-1a` renderer deploy: set `povesti-pe-biscuite`'s site language to Romanian (`locale` `ro-RO`)
  in Settings if it is not. Before `1a` the renderer ignores `locale` (§ 1.2), so setting it earlier changes nothing.
- Before the `locale-1b` renderer deploy: the same for the glam catalog tenant (§ 8.4).

### 16.4 Commerce finding moved to the commerce track

F-LOCALE-COUNTIES (§ 13) is root-caused (operator, 2026-10-31): `SitePage.tsx:399` passes
`getCountryPack(config.countryCode || "RO")` regions and `countryCode` never reaches the renderer, so every shop
without `availableCounties` offers the 42 Romanian counties. Passing `countryCode` alone breaks checkout: the EN pack
has no regions (`country-packs/en.ts:14`) and the county field is a required select (`CheckoutPageView.tsx:447`), so
an English customer could not order. Fix shape: the tenant's real country, and a free-text region field when the list
is empty. ROADMAP `cmrc-counties-1`. Latent today: no live English commerce tenant (§ 16.1).
