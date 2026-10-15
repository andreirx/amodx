# mcp-sync-1 — bring `tools/mcp-server` up to the non-commerce backend, with a mechanical drift oracle

- **Status:** IMPLEMENTED (2026-10-15; revised after review-0 per the operator ruling of the same day) — code complete,
  builder gates green; operator live proof (read-only, prod) pending
- **Track:** Maintenance (operator tooling hygiene; not a feature track)
- **Maturity:** `tools/mcp-server` stays PROTOTYPE — the oracle proves route existence only; there is no behavioural
  test suite and no CI wiring
- **Depends:** none
- **Source plan:** none. Human direction 2026-10-15: "The MCP adding commerce belongs to the commerce track. What we can
  do now before that track is to update it to use most things that were behind but not the commerce part."

## Purpose / risk retired

The definition-of-done line "Check that the MCP server reflects the changes" had no oracle, so drift between the
backend route table and the MCP tools was invisible until a tool was called (two commerce tools already call a
route that does not exist). This slice (1) adds a mechanical oracle — a checked-in route table plus a script that
fails on calls to non-existent routes and on a stale tool count in ARCHITECTURE.md — and (2) covers the
ruled IN set of non-commerce routes, with the deferrals listed in the OUT set below (tenant-unsafe routes, `POST /assets`,
`POST /comments`, the security exclusions).

## § 1 Scope split (the ruling, as amended by the review-0 ruling)

- **IN** (catalog, engagement, platform): content, context, products (admin CRUD in `CatalogApi`), leads, signals,
  themes, resources, system invalidation, audit, email dns-check, research search, forms, popups.
- **OUT — commerce track** (`infra/lib/api-commerce.ts`): categories, orders, customers, coupons, reviews, delivery,
  reports, bulk-price, `/import/woocommerce`, `/import/reviews`. Existing commerce tools untouched, including the two
  broken `/delivery` calls.
- **OUT — security:** `GET /settings/secrets` (secret values into the model's context); user create / update /
  delete / status (admin-account mutation through a robot key — product decision not taken).
- **OUT — deferred (cross-tenant backend reads):** `GET /users`, `POST /import/wordpress`, `POST /import/media`. The
  backend route reads across tenants (`users/list.ts` returns the whole pool to a global key; the import handlers
  `GetObject` any `s3Key` without a tenant-prefix check). Admit after a backend slice scopes them —
  `docs/TECH-DEBT.md` § *BACKEND-TENANT-SCOPE-1 candidate*. The exception path (ratify cross-tenant reads) is the
  human's to take, not this slice's.
- **OUT — deferred (not in the ruled IN set):** `POST /assets` (asset upload needs the presign flow) and
  `POST /comments` (deliberately unexposed: the visitor comment route, RENDERER role — see ARCHITECTURE.md).
- **OUT:** every `/public/*` route, `/consent`, `/contact`, `/webhooks/paddle` (not admin surfaces).

### OUT admin routes, exact keys (the acceptance list)

The oracle's "admin routes with no tool" report must equal this list exactly (`/public/*` and `/webhooks/*` are not
admin routes and are not reported). 27 keys:

```
DELETE /categories/{id}
GET /categories/{id}
PUT /categories/{id}
DELETE /coupons/{id}
GET /coupons/{id}
PUT /coupons/{id}
PUT /customers/{email}
GET /delivery/config
PUT /delivery/config
POST /import/reviews
POST /import/woocommerce
PUT /orders/{id}
DELETE /reviews/{id}
GET /reviews/{id}/image-view-url
POST /reviews
GET /settings/secrets
DELETE /users/{username}
POST /users
PUT /users/{username}
PUT /users/{username}/status
GET /users
POST /import/wordpress
POST /import/media
POST /assets
POST /comments
POST /consent
POST /contact
```

(15 commerce, 5 security, 3 deferred cross-tenant, 2 deferred not-in-IN, 2 visitor.)

## Scope (delivered)

1. **URL convention:** `API_URL = (process.env.AMODX_API_URL ?? '').replace(/\/+$/, '')`, every call
   `${API_URL}/…` including the startup check (was `${API_URL}tenants`).
2. **28 new tools** (45 → 73), each written after reading its handler:

| Tool | Route | Handler |
|---|---|---|
| `page_history` | `GET /content/{id}/versions` | `backend/src/content/history.ts` |
| `restore_page_version` | `POST /content/{id}/restore` | `backend/src/content/restore.ts` |
| `update_context` | `PUT /context/{id}` | `backend/src/context/update.ts` |
| `delete_context` | `DELETE /context/{id}` | `backend/src/context/delete.ts` |
| `get_product` | `GET /products/{id}` | `backend/src/products/get.ts` |
| `update_product` | `GET` + `PUT /products/{id}` | `backend/src/products/update.ts` |
| `delete_product` | `DELETE /products/{id}` | `backend/src/products/delete.ts` |
| `list_leads` | `GET /leads` | `backend/src/leads/list.ts` |
| `create_lead` | `POST /leads` | `backend/src/leads/create.ts` |
| `delete_lead` | `DELETE /leads/{email}` | `backend/src/leads/delete.ts` |
| `update_signal` | `PUT /signals/{id}` | `backend/src/signals/update.ts` |
| `delete_theme` | `DELETE /themes/{id}` | `backend/src/themes/manage.ts` |
| `list_resources` | `GET /resources/list` | `backend/src/resources/list.ts` |
| `resource_download_url` | `GET /resources/{id}/download` | `backend/src/resources/presign.ts` |
| `resource_upload_url` | `POST /resources/upload` | `backend/src/resources/presign.ts` |
| `get_invalidation_status` | `GET /system/invalidation` | `backend/src/system/invalidation.ts` |
| `request_invalidation` | `POST /system/invalidation` | `backend/src/system/invalidation.ts` |
| `list_audit` | `GET /audit` | `backend/src/audit/list.ts` |
| `audit_graph` | `GET /audit/graph` | `backend/src/audit/graph.ts` |
| `email_dns_check` | `POST /email/dns-check` | `backend/src/email/dns-check.ts` |
| `create_form` / `get_form` / `update_form` / `delete_form` | `POST /forms`, `GET/PUT/DELETE /forms/{id}` | `backend/src/forms/{create,get,update,delete}.ts` |
| `create_popup` / `get_popup` / `update_popup` / `delete_popup` | `POST /popups`, `GET` + `PUT`, `DELETE /popups/{id}` | `backend/src/popups/{create,get,update,delete}.ts` |

   `list_users`, `import_wordpress`, `import_media` were built in round 0 and removed by the review-0 ruling (deferred,
   § 1).
3. **`search_web` re-pointed** to `POST /research/search`: the backend reads the tenant's Brave key and calls Brave;
   the MCP process no longer reads the key. Name, inputs and result text unchanged. The "not configured" error text
   is now the backend's ("Brave Search not configured. Add API key in Settings.").
4. **Drift oracle:** `tools/mcp-server/routes.json` + `tools/mcp-server/scripts/route-coverage.ts`, run by `npm test`.
   Rules and guarantee scope: `tools/mcp-server/ARCHITECTURE.md` § *Drift oracle*.
5. **Docs:** ARCHITECTURE.md regenerated from the registration list; CLAUDE.md definition-of-done line; this doc;
   ROADMAP Maintenance row; one `docs/TECH-DEBT.md` entry (BACKEND-TENANT-SCOPE-1 candidate).

### Design decisions taken inside the slice (one line each)

- **Read-merge-write for `update_product` / `update_popup`.** EXECUTED proof (zod 4.1.13, real shared schemas):
  `ProductSchema.omit(…).partial().parse({ price: "10" })` returns `status: "draft"`, `slug: ""`, `currency: "USD"`,
  `categoryIds: []`, `tags: []`, `variants: []`, …; `PopupSchema` likewise (`status: "disabled"`,
  `trigger: "page_load"`). The handlers spread that over the stored item, so a bare partial body unpublishes and
  de-categorises a product. The tools GET the stored item and PUT `{ ...stored, ...patch }` — the same full-object
  shape the admin UI sends. Rejected: sending the partial body (data corruption); fixing the backend (not allocated
  — residual R3). Not atomic (stated in the tool description).
- **`apiError()`** — what: tool error result with HTTP status + the backend's reason; users: the 28 new tools and
  `search_web`; axis: none (deduplication); rejected: inline copy per tool. Older tools keep `error.message`.
- **`parseJsonInput()` — one rule for the class "JSON-string input not shape-checked" (review-0 correction 2).**
  What: parse + top-level shape check (`array` / `object`), returning `isError` that names the expected shape before
  any request is sent; users: `update_context.blocks` (array), `update_product.fields` (object), `create_lead.data`
  (object), `create_form` / `update_form` `fields` (array, via `formPayload`); axis: none (one rule instead of per-tool
  checks); rejected: per-tool ad-hoc checks (the round-0 state, which missed four of five inputs). Rule: no new tool
  calls `JSON.parse` directly.
- **Cache wording rule — one rule for the class "tool text claims a cache or publication outcome the handler does
  not guarantee" (review-0 correction 4, and the review of iteration 0 that found the round-1 sentence still
  over-claimed).** Rule: in tools added by this slice, a cache or publication effect is stated only as a best-effort
  backend *attempt*, never as an outcome. Basis (OBSERVED): `backend/src/lib/invalidate-cdn.ts` `markCdnPending()`
  skips the write when `TABLE_NAME` is unset and logs-and-swallows a failed write, and `withInvalidation()` still
  returns the handler's success; `backend/src/lib/revalidate.ts` `revalidateTenantPaths()` is best-effort the same
  way and skips when the site has no domain. Two shared sentences carry the rule:
  `PENDING_MARKER_ATTEMPT` on the 8 tools whose handler is wrapped in `withInvalidation()` (`restore_page_version`,
  `delete_theme`, `create_form`, `update_form`, `delete_form`, `create_popup`, `update_popup`, `delete_popup`), and
  `PAGE_REVALIDATION_ATTEMPT` on `update_product` / `delete_product` (replaces the round-1 claim "Its public page
  becomes not-found"). **Claim scope, explicitly narrowed:** tools that existed before this slice and reach a wrapped
  handler — `create_tenant` (`POST /tenants`), `create_product` (`POST /products`), `create_theme` (`POST /themes`),
  `apply_theme` (`PUT /settings`), and the commerce tools `create_category`, `bulk_price_adjust` — carry no cache
  wording and are not changed (residual R17).
- **`get_invalidation_status` / `request_invalidation`** report only what the handler returns: "No pending
  invalidation marker", or the marker's last-change time plus `goLiveAt` named as a *calculated flush-due time* that
  is not proof of a flush or of publication; the POST response is shown raw, with the statement that it confirms
  neither a CloudFront invalidation (skipped when `RENDERER_DISTRIBUTION_ID` is unset) nor the marker delete (a failed
  delete is logged and ignored) — the handler returns the same `{flushed: true}` in all these cases.
- **`page_history` sorts numerically** (newest first): the handler's sort-key order puts `v10` after `v2`.
- **`FormInput`/`formPayload` and `PopupInput`/`popupPayload`** — what: one zod field set + snake→camel mapper per
  entity; users: create_* and update_* of that entity (2 each); axis: none (deduplication); rejected: duplicating the
  field declarations and mappings in two tools.
- **`delete_theme` takes no `tenant_id`:** themes are `PK: SYSTEM` (shared by all tenants); the route is not
  tenant-scoped.
- **`email_dns_check.provider` is a string, not an enum:** the recipe list lives in `@amodx/shared`, which this
  package does not depend on; the backend returns 400 for an unknown ID. Current IDs are in the description.
- **Section comment renamed** "COMMERCE: POPUPS & FORMS" → "ENGAGEMENT: POPUPS & FORMS" (comment only).
- **ROADMAP placement:** the Maintenance table (the only other MCP mention is the deferred Track E / AI backlog row —
  a different product).

## Non-scope

No backend, infra, admin, renderer or shared change. No commerce tool change. No user tool, secrets tool or import
tool. No CI wiring of the oracle (`.github/` not allocated).

## Architectural boundaries

- The MCP server is an HTTP client of the backend; tenant isolation is enforced by the backend (`x-tenant-id` +
  `requireRole`). Routes whose backend handler does not scope to the tenant are not exposed (§ 1 deferred).
- The robot key is `GLOBAL_ADMIN`; unchanged by this slice.
- No new dependency edge: `tools/mcp-server` still does not import `@amodx/shared`; the oracle reads source as text.
- `routes.json` is an operator-maintained snapshot, not generated at build time.

## Migration / deployment notes

None server-side. The MCP server runs on the operator's machine: after review, `cd tools/mcp-server && npm run build`
and restart the MCP client. Rollback: revert the listed files and rebuild.

## Definition of Done

- [x] `cd tools/mcp-server && npm run typecheck` → 0
- [x] `cd tools/mcp-server && npm test` → 0, coverage report printed, uncovered list == the OUT list above
- [x] `cd tools/mcp-server && npm run build` → 0, `dist/index.js` produced
- [x] Oracle FAILS on the two `/delivery` calls without the allowlist, PASSES with it (round 0)
- [x] No `${API_URL}` followed by a letter remains in `src/index.ts`
- [ ] Operator live proof (below)

## Evidence

- **EXECUTED (builder):** the gates above (logs in the operator's `.agent-manager/slices/MCP-SYNC-1/`); round 0 oracle
  run A (no allowlist) exit 1 on `GET /delivery`, `PUT /delivery`; run B exit 0; stale-allowlist probe exit 1.
  Isolated stdio smoke (both rounds): `dist/index.js` driven by an MCP SDK client against a local stub API (fake key,
  temp cwd, prod not contacted), recording every request method/path/body.
- **Coverage before → after:** tools 45 → 73; distinct live routes called 36 → 65; admin routes with no tool
  56 → 27, and the 27 equal the OUT list above (diffed).
- **Operator live proof (pending, read-only, prod):** headless stdio smoke of `dist/index.js` with the real `.env`:
  list tools (expect 73); call `list_leads`, `get_invalidation_status`, `list_audit` on one prod tenant. The packet
  also named `list_users`, which no longer exists (deferred, § 1); `list_resources` or `page_history` are read-only
  substitutes. No write tool is called.

## Exit criterion

Any backend route change can be checked against the MCP server in one command; the tenant-safe non-commerce admin
capabilities are reachable from Claude.

## Residuals (recorded, not fixed here)

- **R1 — commerce `/delivery`:** `get_delivery_config` / `update_delivery_config` call `/delivery`; live route is
  `/delivery/config` (404 verified by the operator 2026-10-15). Commerce track, with the rest of the commerce
  coverage; that slice also deletes the two `knownBroken` entries.
- **R2 — excluded on purpose:** user create/update/delete/status and `GET /settings/secrets` (§ 1).
- **R3 — backend partial-update defaults (EXECUTED proof above):** `PUT /products/{id}` and `PUT /popups/{id}`
  overwrite stored fields with schema defaults when the body is partial. Masked today because the admin UI sends full
  objects; any other caller is exposed. Fix belongs in the backend.
- **R4 — `create_lead` vs reCAPTCHA:** `POST /leads` is the public capture route; when a reCAPTCHA secret is
  configured (deployment env or tenant) it requires a token the robot cannot produce → HTTP 400. Whether prod has the
  secret set: NOT VERIFIED.
- **R5 — backend cross-tenant reads (review-0, verified by the operator):** `backend/src/import/media.ts:111-113`,
  `backend/src/import/wordpress.ts:89-91` (`GetObject` with any caller-supplied `s3Key`, no tenant-prefix check);
  `backend/src/users/list.ts:26-51` (whole pool to a global key, first page only). Tracked in `docs/TECH-DEBT.md`
  § *BACKEND-TENANT-SCOPE-1 candidate*; the three tools wait for that backend slice.
- **R6 — admin Migration page (INFERRED from code, NOT RUN):** `uploadToS3()` posts `contentType: application/xml`
  (or the browser's XML type) to `POST /assets`, whose `validateUpload` allowlist accepts only image/video; and the
  media loop feeds `nextBatchStart` into a list that the handler recomputes without the already-imported items, so
  each call skips one batch.
- **R7 — existing engagement tools (INFERRED from code + schema, NOT RUN):** `list_forms` / `list_popups` print
  `title` / `active`, but the records carry `name` / `status` → "undefined" / "Inactive" in the output.
- **R8 — older tools:** report only axios' `error.message` (status, no reason) and call `JSON.parse` without a shape
  check (`update_page`, `add_block`, `update_delivery_config`).
- **R9 — `get_schema` text:** says currency default "RON" (schema default is USD) and describes Resources under
  "Assets".
- **R10 — oracle reach:** not wired into CI; `scripts/` is outside `tsconfig.json`'s `rootDir`, so
  `npm run typecheck` does not cover it (the builder typechecked it separately with `tsc --strict`).
- **R11 — `context/delete.ts`** publishes no audit event (sibling handlers do).
- **R12 — `content/restore.ts` (INFERRED, NOT RUN):** writes the snapshot's slug into LATEST but does not touch
  `ROUTE#` records; if the slug changed since that version, routing and page slug may disagree.
- **R13 — forms on pages (INFERRED; text grep, subset claim):** no caller of `getFormBySlug` / `DynamicForm` was found
  in `renderer/src` or `packages/plugins/src`.
- **R14 — `POST /system/invalidation`** returns `{flushed: true}` whether or not it sent a CloudFront invalidation
  (`RENDERER_DISTRIBUTION_ID` unset → warning log only) and whether or not the marker delete succeeded (failure logged
  and ignored), so no caller can tell these cases apart. Likewise every `withInvalidation()` mutation returns success
  when `markCdnPending()` silently failed or skipped.
- **R17 — cache wording on pre-existing tools:** `create_tenant`, `create_product`, `create_theme`, `apply_theme`
  (and commerce `create_category`, `bulk_price_adjust`) reach handlers wrapped in `withInvalidation()` but say
  nothing about cache effects. Not a false claim, so not changed here; the commerce two belong to the commerce track.
- **R15 — packet arithmetic:** the § 7 snapshot has 12 `/public/*` routes + 1 webhook → 92 admin routes (packet said
  93); uncovered-before measured 56 (packet said 48). The 56 is cross-checked by an independent grep (35 distinct
  inline calls + 3 via `const url` − 2 broken = 36 covered).
- **R16 — stale prose left alone (§ 4 condition not met):** `docs/architecture-deep -dive.md` § 11 ("1,881 lines",
  "Content CRUD … delete"); README states no tool count.

## References

- `tools/mcp-server/ARCHITECTURE.md` (tool tables, § *Deliberately not exposed*, § *Drift oracle*, § *Key Patterns*)
- `docs/TECH-DEBT.md` § *BACKEND-TENANT-SCOPE-1 candidate*
- `infra/lib/api.ts`, `infra/lib/api-catalog.ts`, `infra/lib/api-commerce.ts`, `infra/lib/api-engagement.ts`
- `backend/src/lib/invalidate-cdn.ts` (`withInvalidation`, `markCdnPending`)
- `CLAUDE.md` § *Definition of Done*
