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
| Translation membership (LANG-1A) | `TENANT#<id>` | `TRANSLATION#<translationKey>#<nodeId>` |
| Product | `TENANT#<id>` | `PRODUCT#<productId>` |
| Comment | `TENANT#<id>` | `COMMENT#<pageId>#<timestamp>` |
| Lead | `TENANT#<id>` | `LEAD#<normalizeEmail(email)>` (LEAD-NORMALIZE-1; rows stored before it may hold the typed spelling, F-FND2-1) |
| Newsletter subscription (NEWSLETTER-1: consent evidence + MailerLite push state; written with its lead in one transaction, deleted with it in one transaction; the renderer never reads it) | `TENANT#<id>` | `NEWSLETTER#<normalizeEmail(email)>` |
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
REDIRECT-1: an owner writes the same item with `POST /redirects` (`backend/src/redirects/create.ts`: one
`TransactWriteCommand` — the Put under `attribute_not_exists(SK)`, so a page or a redirect at the old address is never
overwritten, and a `ConditionCheck` `attribute_not_exists(IsRedirect) OR IsRedirect = :no` (`:no` = false) on the
target's route, `/` read as the home page's route, so the destination is a page route or free at insertion — a stored
`IsRedirect` other than absent, `false` or `true` is refused, since the renderer serves a truthy one as a redirect — and
concurrent `/a → /b` and `/b → /a` cannot both succeed; redirects that point at the old address are not checked, so a
chain `/a → /b → /c` forms when `/a → /b` commits first — F-REDIRECT1-REVERSE-CHAIN in `docs/TECH-DEBT.md`) and deletes it with `DELETE /redirects` (conditioned on
`IsRedirect = true AND RedirectTo = <read>`, so a page route is never deleted). Both refuse `/` and `/contact`
(Hard Rules item 4).

## Conditional & Transactional Writes

- **Prevent duplicates:** `ConditionExpression: "attribute_not_exists(SK)"` on creates.
- **Multi-item consistency:** Use `TransactWriteCommand` for content + route creation.

## Translation Sets (LANG-1A)

Spec: `docs/slices/lang-1.md` § 5, § 6. Pages that are the same page in different languages share a **set**:

- `translationKey` on each member's `CONTENT#<nodeId>#LATEST` — a random UUID made when two pages are first linked,
  never a `nodeId`, never used again for another set. Written only by the backend (never accepted as API input).
- One membership item per member: `PK = TENANT#<id>`, `SK = TRANSLATION#<translationKey>#<nodeId>`,
  `Type = "Translation"`. It holds **no** language, slug or status: the language is derived from the page's current
  address and the tenant's current `languages` (`pageLanguageOf`, `@amodx/shared`), so a language-list change, a rename
  or a restore writes no membership item.
- **Membership rule** (every reader): page `n` is a member of set `K` when `TRANSLATION#K#n` exists, its LATEST holds
  `translationKey = K`, and (for what visitors see) the LATEST is `Published`. An item whose page holds another key is
  ignored (orphan items are inert; nothing removes them — deferred debt, `lang-1.md` § 15).
- **Reads, no scan:** one set = `Query PK = TENANT#<id> AND begins_with(SK, "TRANSLATION#<key>#")`, paginated, then one
  `Get` per member LATEST.
- **Writes:** joining, leaving or moving a set is ONE `TransactWriteCommand` with one action per item: the page's
  LATEST (key set or removed), the membership items (`Put` / `Delete`), and the target page (`ConditionCheck` of its key,
  or `Update` with the new key and its item). Every write that replaces a page item whole (`Put`: restore, WordPress
  import) or changes its key is conditioned on the key **as read** (`translationKey = :read`, or
  `attribute_not_exists(translationKey)` when none was read); a failed condition is a `409` (the importer reports the
  post failed). Handlers: `backend/src/content/update.ts` (`planTranslation`, also used by `create.ts`), `restore.ts`,
  `backend/src/import/wordpress.ts`.
- **Redirect routes (IMPORT-PATHS-1):** `ROUTE#<old path>` with `IsRedirect: true, RedirectTo` — one shape,
  `redirectRouteItem` (content/update.ts), written by the rename, by the WordPress import and by `POST /redirects`
  (REDIRECT-1). The importer writes it
  create only (`attribute_not_exists(SK)`) and only where the renderer looks up content (`wp-addresses.ts`
  `servedBefore`). Its page write (option on) is ONE `TransactWriteCommand` of the content LATEST and its route,
  conditioned on what authorised it; "the same imported item" = equal `wordpressSourceItem`
  (`wordpress:<export host>/<post id>`, on option-on pages only; kept by `content/update.ts`, whose `SET` names its
  attributes, and by its history snapshot). "Does the site hold an imported page?" = one paginated
  `Query begins_with(SK, "CONTENT#")` projected to `SK, author`.
- **Admin reads:** `GET /content` (`content/list.ts`) gives each keyed page `hasTranslationItem` (its membership item
  exists), so the editor applies the same membership rule without reading items itself.

## Audit Trail

Handlers call `publishAudit()` → EventBridge → `audit/worker.ts` → DynamoDB. Non-blocking.

Requirements:
- `actor.email` — human-readable, not just UUID
- `target.title` — entity name, not just ID
- Include enough snapshot data to be useful without re-querying
