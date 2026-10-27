# SERVICE-ACCOUNT-1 — tenant-scoped machine credentials (IMPL slice)

Status: **PROPOSED** (packet written 2026-10-27 by the glamCRM operator session). Track: Glam
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
