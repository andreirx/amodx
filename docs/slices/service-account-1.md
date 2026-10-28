# SERVICE-ACCOUNT-1 — tenant-scoped machine credentials (IMPL slice)

Status: **IMPLEMENTED 2026-10-28; review approved; STAGING VERIFIED 2026-10-28 (§ 9); prod on the human's word, not on prod** (packet written 2026-10-27 by the glamCRM operator session; build record § 8). Track: Glam
catalog (platform capability; independent of the catalog slices — can run in parallel).

## 1. Purpose / risk retired

Today an `x-api-key` maps to one of two FIXED GLOBAL identities (`backend/src/auth/authorizer.ts`:
`system-robot` GLOBAL_ADMIN / `renderer` RENDERER, both `tenantId: "ALL"`). There is no way to
give an external system a credential that can touch ONE tenant and nothing else. glamCRM needs
exactly that: push the catalog after each yearly pricelist replacement and read interest leads
for ONE tenant — without a human's Cognito login and without a global key (a global key in a
second system's secret store would be a cross-tenant breach waiting to happen).

The human's direction (2026-10-27): "support a service account or other automated login formula
so glamCRM can operate on the related site."

## 2. Scope

1. **The credential**: a **tenant-bound API key** — `ServiceKey{ id, tenantId, name, scopes[],
   keyHash (sha256 of the secret; secret shown ONCE at creation), createdBy, createdAt,
   lastUsedAt, revokedAt|null }`. Stored under the tenant (`TENANT#<id>` partition, `SVCKEY#<id>`
   sort — raw DTO, no framework object). The secret format carries a prefix (`amx_sk_…`) so a leak
   is recognizable in logs/scanners.
2. **Scopes** (fixed enum, deny-by-default; trimmed 2026-10-27 to scopes with a named consumer):
   `catalog:read` (`GET /products` — the staging proof's route), `leads:read` (`GET /leads` —
   glamCRM's pull), `catalog:write` (declared by CAT-IMPORT-1 on `/import/glam-pricelist`, the
   push). `leads:write` and `content:read` dropped: no consumer is named. No scope grants tenant
   settings, users, keys, or anything outside the tenant. The enum is in `packages/shared`.
   No CommerceApi route (categories CRUD, public product reads) is given a scope.
3. **Authorizer**: a third branch — a key with the service prefix is looked up by hash → context
   `{ sub: "service:<keyId>", role: "SERVICE", tenantId, scopes }`. Revoked or unknown → 401.
   The lookup is one point read (hash as key), no scan; no secret comparison happens in code.
   **Call shape (added 2026-10-27):** the HTTP API authorizer's `identitySource` is BOTH
   `$request.header.Authorization` and `$request.header.x-api-key` (`infra/lib/api.ts:106`); a
   request missing either is refused by API Gateway with 401 before the authorizer runs. A service
   caller therefore sends `x-api-key: amx_sk_…` AND a placeholder `Authorization: Bearer service`;
   the branch must resolve on the key before the token branch reads `Authorization`. The packet's
   integration rows and the glamCRM contract (§ 6) state this shape. `resultsCacheTtl` is 0
   (:105), so a revocation is effective on the next request.
   Context encoding: pass `scopes` as one comma-joined string in the authorizer context (simple
   responses carry primitive values) and parse it in `policy.ts`.
4. **Policy** (`backend/src/auth/policy.ts`): the existing role checks gain the SERVICE role; a
   route accepts SERVICE only when it declares a required scope and the key holds it. Note
   `policy.ts:15` defaults a missing role to `EDITOR` — the SERVICE context must always carry its
   role. A SERVICE call must always pass the target tenant (the third `requireRole` argument is
   optional today); a scoped route that omits it is a defect. **Precondition:** `GET /leads`
   (`backend/src/leads/list.ts`) calls no `requireRole` at all today and serves any `x-tenant-id`
   to any authenticated caller (operator probe on staging 2026-10-27). It must be tenant-bound
   before a `leads:read` key can exist — see TENANT-BIND-1. Routes
   without a declared scope REFUSE service callers (deny by default — an undeclared route cannot
   be reached by a key by accident). The tenant binding is the key's tenant, never a header: a
   service call carrying a different `x-tenant-id` is refused (403), the same discipline
   `import-policy-1` applied to EDITOR imports.
5. **Admin UI**: Settings → "Chei de integrare" (TENANT_ADMIN): create (name + scopes → the secret
   shown once with a copy button and the warning that it will not be shown again), list (name,
   scopes, created, last used), revoke. Business-language copy.
6. **Audit**: creation, revocation and every authenticated service request's first use per day
   write `AUDIT#` entries (actor `service:<keyId>`); the existing audit view shows them.
7. **Rate limit**: service callers get a per-key limit (API Gateway usage plan or the existing
   limiter — cite which); a revoked key's requests are counted and alertable (sketched only —
   not built: a named follow-up for the audit/alerting track).
8. **MCP parity**: `service_key_list/create/revoke` tools per the drift oracle.

## 3. Non-scope

OAuth/JWT machine identities, key auto-rotation, a global "integrations" marketplace. Cognito
changes of any kind (PD-003: the public pool is a login substrate, not the authz transport —
this credential is backend-side, not a Cognito identity).

## 4. Architectural boundaries

PD-001 (tenant-local identity) extended to machine actors: the key IS tenant-local by
construction. The authorizer's three branches share one output shape (the existing context);
`policy.ts` is the only place scope semantics live. The hash lookup is a repository method; the
authorizer never touches DynamoDB SDK types. Secret generation uses `crypto.randomBytes(32)`
base64url; the stored form is the hash only.

## 5. Definition of Done / evidence

- Unit: scope enum + policy decisions (holds scope / lacks scope / undeclared route / revoked /
  foreign `x-tenant-id` / global key unaffected); hash compare constant-time (the library call,
  asserted by name); secret format + prefix.
- Integration: create → the secret authorizes `GET /products` for ITS tenant; the same secret
  against another tenant's `x-tenant-id` → 403; after revoke → 401; `system-robot` and the
  renderer key behave exactly as before (regression rows); an undeclared route → 403 for the key.
- Admin hermetic E2E: create a key (secret shown once), list it, revoke it.
- Staging: a real key created for the glam tenant; a `curl` with it lists that tenant's products
  and is refused on a second tenant (operator-run; the key then revoked and the audit rows shown).
- CDK: state the resource delta (a usage plan if chosen; otherwise none) against the 500-ceiling
  precondition. Typecheck + suites bare-green.

## 6. The consumer (recorded, not built here)

glamCRM `GC-SITE-SYNC-1` (queued in glamCRM's ROADMAP): stores the key in its TenantConfig's
secret store, pushes the canonical pricelist after each replacement (`catalog:write`), pulls
leads (`leads:read`) into its own prospects view. The contract this slice fixes is the key's
scope set and the two routes' shapes.

## 7. References

`backend/src/auth/{authorizer,policy,context}.ts`; `docs/platform-decisions.md` PD-001/003;
`docs/slices/import-policy-1.md` (tenant binding precedent); `docs/plan-glam-catalog.md`.

## 8. Implementation record (SERVICE-ACCOUNT-1 build)

Built 2026-10-28 from the operator's builder packet (which fixed the open choices below). Not deployed.

### 8.1 Decisions (operator, recorded here)

- **D-SA-A — two items, lookup by hash, no GSI.** Key item `PK TENANT#<tenantId>`, `SK SVCKEY#<keyId>`
  (`id, tenantId, name, scopes, keyHash, createdBy, createdAt, lastUsedAt, revokedAt, Type: "ServiceKey"`) and
  lookup item `PK = SK = SVCKEYHASH#<sha256(secret) hex>` (`tenantId, keyId, name, scopes, lastUsedDay`), written in
  one `TransactWriteCommand`, both conditioned `attribute_not_exists(PK)`. The authorizer does one strongly
  consistent `GetItem` on the lookup item. The hash IS the key of the point read, so no secret comparison exists
  anywhere (this replaces § 5's "hash compare constant-time": there is nothing to compare). The secret
  (`amx_sk_` + base64url of 32 random bytes = 43 chars) is returned once by `POST /service-keys` and is never stored
  or logged. Only `backend/src/lib/service-keys.ts` knows the two items.
- **D-SA-B — one-declaration policy.** `requireRole(auth, allowedRoles, targetTenantId?, serviceScope?)`. For
  `role: "SERVICE"` the call throws unless the route declares `serviceScope`, names a target tenant equal to the
  key's tenant, and the key holds the scope. `"SERVICE"` never appears in `allowedRoles`; a route that omits the
  fourth argument refuses keys by construction. Declared in this slice: `GET /products` → `catalog:read`
  (`backend/src/products/list.ts`, whose `requireRole` throw now answers 403 instead of 500), `GET /leads` →
  `leads:read` (`backend/src/leads/list.ts`). Every other caller's behaviour is unchanged.
  **Corrected by D-SA-E:** "refuses keys by construction" holds only for handlers that call `requireRole`.
  Review-0 showed handlers that never call it; the system-wide guarantee is the authorizer allowlist (D-SA-E).
- **D-SA-C — 403, not 401; revoke = delete of the lookup item.** A Lambda-authorizer deny is answered by API
  Gateway with 403 (operator probe on prod, 2026-10-28), so § 2.3's "revoked or unknown → 401" is 403.
  `POST /service-keys/{id}/revoke` sets `revokedAt` on the key item (kept, listed as revoked) and deletes the
  lookup item in one transaction; with `resultsCacheTtl` 0 and the consistent read the next request is refused.
  The route is `POST …/revoke`, not `DELETE`, because the record stays.
- **D-SA-D — `catalog:write` deferred to CAT-IMPORT-1.** § 2.2 lists it; a scope with no route would be a value the
  admin offers and nothing honours. CAT-IMPORT-1 adds the enum value in the same change as its route. The enum
  in `packages/shared` is `ServiceKeyScope = ["catalog:read", "leads:read"]`.
- **D-SA-E — authorizer route allowlist (ruling SA_SCOPE_CLOSURE, operator, 2026-10-28, cycle 2).** Review-0
  finding 1: a found key was authorised on EVERY route, and handlers that never call `requireRole` admitted it.
  Witnesses (reviewer, mocked I/O): `resources/presign.ts` (`POST /resources/upload` — a `leads:read` key of t1 with
  header t2 got an upload URL and a write under `TENANT#t2`), `themes/manage.ts` (`POST/GET /themes`,
  `DELETE /themes/{id}` — shared `SYSTEM/THEME#` records), `comments/list.ts` (`GET /comments` — queried
  `TENANT#t2`), `tenant/list.ts` (`GET /tenants`). Ruling: the authorizer, the one place that sees every request,
  closes the class. `SERVICE_ROUTE_SCOPES` in `backend/src/auth/policy.ts` (`GET /products` → `catalog:read`,
  `GET /leads` → `leads:read`) is the only table of routes a key may reach. After the lookup and BEFORE metering
  the authorizer denies a key when the route key is not in the table, when the key lacks the route's scope, or when
  `x-tenant-id` is absent or ≠ the key's tenant. A denied request runs no Lambda and is not metered. The
  handler-side fourth argument stays (defence in depth). Each layer checks only its own declaration: a route in the
  table whose handler declares nothing → 403 from policy; a handler declaration with no table entry → authorizer
  deny. Nothing compares the two declarations at runtime (a handler declaring a DIFFERENT scope than the table would
  admit a key holding both); keeping them equal is a maintenance requirement, pinned by `service-key-policy.test.ts`
  (exact table) and `service-key-routes.test.ts` (each handler admits a key holding only its table scope).
  (Wording corrected in cycle 3 after review-1; cycle 2 said "a mismatch either way fails closed".)
  The four witness handlers get no gating here: their human-caller binding is tenant-bind-1 follow-up (c).
  Only routes configured `authorizationType: NONE` (`noAuth: true` in the nested stacks' `addRoute`) run no
  authorizer; on them a key is not evaluated and confers nothing over anonymous. In the cycle-2 staging synth these
  are 11 route keys, all `/public/*` in CommerceApi / EngagementApi; the parent stack has none. The prefix is NOT
  the rule: `POST /public/customers/profile` uses the authorizer (`CUSTOM`, renderer-proxy boundary, PD-002), so the
  allowlist refuses a key there. (Corrected in cycle 3 after review-1; cycle 2 said "routes under `/public/*`".)
- **SA_LOOKUP_NAME = retain `name` (operator, 2026-10-28, cycle 2).** The D2 lookup item shape is amended to
  `{ tenantId, keyId, name, scopes, lastUsedDay }`: `name` is immutable (no rename route), written once in the same
  transaction, and gives the daily `SERVICE_KEY_USED` audit entry a readable `target.title` without a second read.
- **Pagination (review-0 finding 2, cycle 2).** `listServiceKeys` follows `LastEvaluatedKey` with the same key
  condition and projection and sorts all pages together (newest first).

### 8.2 Other deviations from § 1–§ 6 (operator packet § 6, plus build-level)

- § 2.5 "Chei de integrare" is rendered "Integration keys" (the Settings page copy is English).
- § 2.7 per-key rate limit: not built. The stage throttling (50 rps, burst 100, `infra/lib/api.ts`) applies to
  every caller, keys included.
- § 5 "Admin hermetic E2E": the admin workspace has no browser harness (its vitest config is node-only); the UI is
  proven by the operator on the deployed staging admin.
- The lookup item carries the key's `name` — ratified as SA_LOOKUP_NAME (§ 8.1). The machine actor has no email;
  the audit worker records `actorEmail: "System"`.
- Build-level: the revoke condition is `attribute_exists(PK) AND attribute_type(revokedAt, NULL)` — `revokedAt`
  is stored `null` at creation; `attribute_type(revokedAt, NULL)` is the documented DynamoDB condition function
  that tests for a NULL-typed attribute.
- Build-level: a lookup that throws (DynamoDB error) is a deny, not an unhandled authorizer error (fail closed).
  A failure of the once-a-day use mark or its audit entry is logged and the request is still authorised.
- Build-level: `tools/mcp-server/routes.json` carries the three new routes added by hand; its header still names
  the 2026-10-15 prod snapshot. The operator regenerates the file from the live gateway after the staging deploy
  and must get the same list.

### 8.3 Call shape for glamCRM (all three headers required)

```
x-api-key: amx_sk_…            # the secret shown once at creation
Authorization: Bearer service  # placeholder: identitySource needs both headers; the key branch never reads it
x-tenant-id: <the key's tenant>
```

A key presented on any route resolves as itself or is refused (403); it never falls through to the anonymous
public routes or the Cognito token branch. The authorizer refuses (403, no body detail; the reason is in its log)
a route outside `SERVICE_ROUTE_SCOPES`, a missing scope, and an absent or different `x-tenant-id`. Behind it, the
handler's `requireRole` gives the same refusals with a reason in the 403 body ("service key is bound to another
tenant", "service key lacks scope <s>", "this route is not available to service keys").

### 8.4 Surface added

- Shared: `ServiceKeyScope`, `ServiceKeyView` (`packages/shared/src/index.ts`).
- Backend: `backend/src/lib/service-keys.ts`; authorizer third branch (`backend/src/auth/authorizer.ts`, after the
  renderer-key check); `AuthorizerContext.scopes?` / `keyId?`; handlers `backend/src/service-keys/{list,create,revoke}.ts`
  (`x-tenant-id` required → 400; TENANT_ADMIN / GLOBAL_ADMIN of that tenant → else 403). Audit actions
  `SERVICE_KEY_CREATED`, `SERVICE_KEY_REVOKED`, `SERVICE_KEY_USED` (first use per UTC day, actor `service:<keyId>`).
- Routes (parent `AmodxStack`): `GET /service-keys`, `POST /service-keys`, `POST /service-keys/{id}/revoke`.
- Admin: Settings → "Integration keys" card (`admin/src/components/ServiceKeys.tsx`, behind `isAdmin`).
- MCP: `service_key_list`, `service_key_create`, `service_key_revoke` (76 tools).

### 8.5 Tests (`backend/test/unit/`, credential-free, run by `npm run test:unit`)

- `service-key-policy.test.ts` — scope held / lacked / undeclared route / foreign tenant / no tenant / empty
  scopes; EDITOR, TENANT_ADMIN, CUSTOMER and GLOBAL_ADMIN unchanged with a scope declared; `"SERVICE"` in
  `allowedRoles` admits nothing; `SERVICE_ROUTE_SCOPES` has exactly `GET /products` and `GET /leads` (cycle 2).
- `service-key-authorizer.test.ts` — found → SERVICE context from the record; lookup key = sha256(secret) hex;
  unknown/revoked → deny, also on `POST /leads` (not anonymous); daily touch + `SERVICE_KEY_USED` once / not on the
  same day; touch failure still authorised; lookup failure denied; master, renderer and wrong-key rows as before.
  Cycle 2 (D-SA-E): route not in the table (`'GET /resources/upload'`) → denied, no touch, no audit; `GET /products`
  lacking `catalog:read` / foreign `x-tenant-id` / no `x-tenant-id` → denied; `GET /leads` with `leads:read` and
  the matching header → authorised; review-0 witnesses `POST /resources/upload`, `POST /themes`, `GET /themes`,
  `DELETE /themes/{id}`, `GET /comments`, `GET /tenants` → denied with both scopes, own or foreign header. Each
  refusal row also asserts the logged reason, so it pins WHICH check refused (the scope check alone would also
  refuse an unlisted route).
- `service-key-handlers.test.ts` — create (secret format, hash-only storage, one transaction, 403/400 rows, audit),
  list (no hash, revoked included, newest first; two pages via `LastEvaluatedKey`, sorted globally — cycle 2), revoke (one transaction, 404 unknown / already revoked /
  concurrent, audit).
- `service-key-routes.test.ts` — `GET /products` and `GET /leads` admit a key holding the scope for its own tenant
  only; `GET /audit` (undeclared) refuses a key holding both scopes; EDITOR rows on `GET /products` (foreign → 403).

### 8.6 CDK delta (measured by synth; the operator verifies with `cdk diff`)

Staging parent `AmodxStack-staging`, `cdk synth` before/after this build (2026-10-28): **440 → 461 (+21)**:
3 × (Function + Role + DefaultPolicy + LogGroup) + 3 integrations + 3 routes + 3 Lambda permissions. The packet's
estimate of 18 did not count the per-function `AWS::Logs::LogGroup`. Nested stacks unchanged (CatalogApi 57,
CommerceApi 258, EngagementApi 94). Prod parent was also 440 → expected 461/500 (not synthesised for prod). The
authorizer gets `TABLE_NAME` / `EVENT_BUS_NAME` and `grantReadWriteData` on the table (a statement in its existing
DefaultPolicy, 0 resources); it already had `events:PutEvents` from the stack-wide grant. No GSI, no usage plan.

### 8.7 Follow-ups

- Per-key rate limit and alerting on refused keys (§ 2.7).
- `catalog:write` with CAT-IMPORT-1 (enum value + route + declaration in one change).
- Key rotation (create new → switch glamCRM → revoke old works today by hand; no rotation endpoint).
- The authorizer's table grant is `grantReadWriteData` (packet); least privilege would be `GetItem` + `UpdateItem`.
- tenant-bind-1 follow-up (c): handlers that call no `requireRole` (e.g. the four D-SA-E witnesses) still admit any
  authenticated HUMAN identity across tenants; service keys no longer reach them (D-SA-E).
- Cycle 2 documented the SERVICE branch in `docs/authentication-architecture.md` (§ 4c) and `backend/ARCHITECTURE.md`.

## 9. Review, staging verification and deploy record (operator, 2026-10-28 — appended after review approval and the staging deploy)

- Relay: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, four cycles. review-0 **escalate** — correct finding
  against the operator's packet: "deny by construction" in the policy held only for handlers that call `requireRole`;
  a found key reached handlers that never call it (`resources/presign.ts` cross-tenant upload URL and write,
  `themes/manage.ts`, `comments/list.ts`, `tenant/list.ts`; reviewer-executed with mocked I/O). Operator rulings
  (§ 8.1 D-SA-E): the authorizer allowlist `SERVICE_ROUTE_SCOPES` (route → scope, tenant header must equal the key's
  tenant, decided before any Lambda runs), the handler-side declaration kept as defence in depth; `name` retained on
  the lookup item (SA_LOOKUP_NAME); key listing follows `LastEvaluatedKey`. review-1 revise (two documentation
  claims wider than the code: `/public/*` is not "no authorizer" — anonymous access is per-route `noAuth`; the two
  scope declarations are checked independently, not compared), review-2 revise (one caller list in
  `docs/authentication-architecture.md:40`), review-3 **approved**.
- Operator gates on the approved tree: shared build 0; backend `test:unit` 393/393 (332 + 61 new rows in the four
  `service-key-*.test.ts` files); root typecheck 0; MCP route-coverage PASS (76 tools); `git diff --check` 0;
  `"SERVICE"` only in `auth/policy.ts` and `auth/authorizer.ts`; `amx_sk_` only in `auth/authorizer.ts` and
  `lib/service-keys.ts`. Logs: operator scratchpad `glam/sa1-g*.log`.
- `cdk diff -c stage=staging` (read-only): +21 resources (3 × Function/Role/Policy/LogGroup, 3 × Integration/Route/
  Permission), 0 removed; the authorizer's policy gains the table grant; every Lambda bundle changes (shared package
  and `policy.ts` are in every bundle). `cdk deploy -c stage=staging AmodxStack-staging` exit 0 (212 s).
- Live API proof (operator scratchpad `glam/sa1-staging-proof.ts`, log `sa1-staging-proof.log`; key created on
  `cache-probe-2026` as the mandated staging admin, revoked at the end): create → 201 with a 50-char `amx_sk_` secret
  and a view without hash; `GET /products` and `GET /leads` with the key, own tenant → 200; foreign `x-tenant-id` →
  403; no `x-tenant-id` → 403; `GET /audit` (not in the allowlist) → 403; `POST /resources/upload` (never calls
  `requireRole`) → 403; `GET /service-keys` with the key → 403; no `Authorization` header → 401 (API Gateway
  identitySource); unknown `amx_sk_` secret → 403; admin list shows `lastUsedAt` and no hash; the other tenant's
  list does not show it; revoke → 200 with `revokedAt`, second revoke → 404, the secret → 403 afterwards; audit rows
  `SERVICE_KEY_CREATED` (admin), `SERVICE_KEY_USED` (actor `service:<keyId>`), `SERVICE_KEY_REVOKED` (admin) present.
  16/16 PASS.
- Admin UI (deployed staging admin, Playwright, `glam/sa1-admin-ui.ts`, screenshots `sa1-ui-*.png`): the
  "Integration keys" card renders for an admin; create shows the one-time secret box with "Copy it now — it will not
  be shown again." and a Copy button; the list shows name, scope chips, created, last used; Revoke (with confirm)
  turns the row into "Revoked <date>". 4/4 PASS. All keys created by the proofs are revoked.
- `routes.json` equals the live staging route table (108 routes; the three new keys present). The file's header
  still names the prod gateway; regenerate after the prod deploy.
- Prod `cdk diff` (read-only): +21, 0 removed, the same shape as staging; 101 changed (all Lambda bundles, the
  authorizer's policy, the per-deploy renderer/admin assets, the nested-stack description encodings). Prod on the
  human's word. Not on prod.
- glamCRM call shape (fixed by this slice): `x-api-key: amx_sk_…`, `Authorization: Bearer service`,
  `x-tenant-id: <the key's tenant>` — all three required; `GET /products`, `GET /leads`.

## 10. Prod record (operator, 2026-10-28) — SHIPPED

Prod deploy by the human (from the clean `amodx-hotfix` worktree at `7d0b522`, carrying this slice, SETTINGS-KEYS-1 and 1B).
Read-only checks (`sa1-prod-check.sh`, 30/30 PASS): authorizer `LastModified` 2026-10-28T14:00:11Z, the three
service-key functions 14:00:22–23Z; bundle literals `SVCKEYHASH#`, `SERVICE_KEY_USED`, `amx_sk_`, `SERVICE_KEY_CREATED`,
`SVCKEY#`, `SERVICE_KEY_REVOKED` present; CloudWatch Errors 0 (30 min) on all four; `tools/mcp-server/routes.json`
equals the live prod route table (108 = 108); GLOBAL_ADMIN `GET /tenants`, `/service-keys`, `/products`, `/leads` → 200
on two tenants; unknown `amx_sk_` secret → 403; no `Authorization` → 401; bogus credentials → 403. No key was created
on prod. Not proven on prod: the full create/use/revoke cycle (proven on staging, § 9).
