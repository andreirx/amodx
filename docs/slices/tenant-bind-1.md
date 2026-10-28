# TENANT-BIND-1 — five authenticated routes served any tenant to any caller; they are now bound to the caller's tenant

Status: **SHIPPED — prod 2026-10-28 (§ 13); IMPLEMENTED 2026-10-27; review approved; STAGING VERIFIED 2026-10-27 (§ 12)** — code complete, unit
oracles exit 0 (§ 8); staging deploy and live re-probe done (§ 12). Prod on the human's word; not on prod.
Track: F (security prerequisite of `service-account-1`; `docs/ROADMAP.md` Track F, entry of 2026-10-27).
Depends: none. `requireRole` (`backend/src/auth/policy.ts`) is used as it is.
Source plan: none — the operator's builder packet of 2026-10-27 is the plan. The defect was root-caused on the code and
proven live on staging while grounding `service-account-1`.
Maturity target: the five handlers keep their current maturity. The slice adds a missing guard and changes no feature.

## 1. Purpose / risk retired

Every admin route sits behind the HTTP API default Lambda authorizer (`infra/lib/api.ts:103-112`). The authorizer only
proves that the caller is SOMEONE: an admin-pool token, a public-pool CUSTOMER token, the master key, or the renderer key.
Each handler must bind the caller to a tenant itself, through `requireRole(auth, roles, tenantId)`
(`backend/src/auth/policy.ts`). That function requires the token tenant to equal the `x-tenant-id` header. GLOBAL_ADMIN
passes with no tenant check. A role that is not in `roles` is refused. Five handlers never called it. They read
`x-tenant-id` from the request and queried that tenant's partition for any authenticated caller:

| Route | Handler | Effect before this slice |
|---|---|---|
| `GET /leads` | `backend/src/leads/list.ts` | reads another tenant's leads (names, emails, form data) |
| `DELETE /leads/{email}` | `backend/src/leads/delete.ts` | DELETES another tenant's lead |
| `GET /audit` | `backend/src/audit/list.ts` | reads another tenant's audit log |
| `GET /signals` | `backend/src/signals/list.ts` | reads another tenant's signals |
| `GET /assets` | `backend/src/assets/list.ts` | reads another tenant's media list |

Because the role was not checked either, a public-pool CUSTOMER token (any storefront shopper of any tenant) also reached
all five routes for its own tenant and, by changing the header, for any other tenant.

**Live proof (operator probe, staging, 2026-10-27):** a temporary EDITOR of `cache-probe-2026` was used and deleted
after the probe. `GET /content` with `x-tenant-id: opn1-iso-b` was refused ("You do not have access to this tenant").
`GET /leads`, `GET /audit` (6 rows returned), `GET /signals` and `GET /assets` with the same foreign header returned
**200**. DELETE was not probed because it is destructive; its code has the same shape. Prod runs the same handlers. This
never worked: none of the five handlers has ever called `requireRole`.

## 2. Scope — D1, the rule

In each of the five handlers, immediately after the `x-tenant-id` presence check and before any DynamoDB call:

```ts
const auth = event.requestContext.authorizer.lambda;
try {
    requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);
} catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Forbidden";
    return { statusCode: 403, body: JSON.stringify({ error: message }) };
}
```

This is the shape of `signals/create.ts:16-21`. The inner try/catch makes a denial a **403**, not the 500 of the outer
catch. The role set is the same for all five routes. Before this slice any admin user reached them, so EDITOR keeps
access to its own tenant. The slice changes only the tenant binding (and, as a consequence of the role list, CUSTOMER and
RENDERER contexts are now refused). Sibling handlers already bind with the same or a stricter set: `assets/create.ts:27`
and `audit/graph.ts:54` use `["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"]`; `signals/create.ts:17` and
`signals/update.ts:17` use `["GLOBAL_ADMIN", "TENANT_ADMIN"]`.

| Handler | Import added | Bind inserted | First DynamoDB call (after) |
|---|---|---|---|
| `backend/src/leads/list.ts` | line 5 | lines 14-20 | line 22 |
| `backend/src/leads/delete.ts` | line 5 | lines 14-20 (before the `email` path check) | line 26 |
| `backend/src/audit/list.ts` | line 5 | lines 16-22 | line 24 |
| `backend/src/signals/list.ts` | line 5 | lines 14-20 | line 22 |
| `backend/src/assets/list.ts` | line 5 | lines 14-20 | line 24 |

No other change to the handlers. The 400 responses for a missing header keep their current bodies: `leads/list.ts:12`,
`leads/delete.ts:12`, `audit/list.ts:14` and `assets/list.ts:12` send plain text `"Missing Tenant"`; `signals/list.ts:12`
sends JSON `{ "error": "Missing x-tenant-id header" }`.

## 3. Non-scope

No `policy.ts` or `authorizer.ts` change. No role tightening. No route or CDK change. No admin or renderer change. No
commerce handler. No other handler. No deploy.

## 4. Architectural boundaries

Tenant isolation (`CLAUDE.md` Critical Rule 3): every DB operation validates `x-tenant-id` against the caller. This
slice brings five handlers into line with that rule. No new abstraction: the slice calls the existing `requireRole` in
the established sibling shape.

## 5. D2 — callers (unaffected), and which test row stands for each

Authorizer contexts as built by `backend/src/auth/authorizer.ts`: the master key gives `{role: "GLOBAL_ADMIN",
tenantId: "ALL"}` (line 130); the renderer key gives `{role: "RENDERER", tenantId: "ALL"}` (line 139); an admin-pool
token gives `custom:role` (default `EDITOR`) and `custom:tenantId` (lines 183-192); a public-pool token gives
`{role: "CUSTOMER", tenantId: custom:tenant_id}` (lines 233-234).

| Caller | Call sites | Context | Test row |
|---|---|---|---|
| Admin SPA, EDITOR | `admin/src/pages/Leads.tsx:21,33`, `AuditLog.tsx:30`, `Signals.tsx:75`, `MediaLibrary.tsx:21`, `components/MediaPicker.tsx:28`, `Migration.tsx:42` | user token, own tenant in header | "EDITOR of t1 with header t1 → authorised" |
| Admin SPA, TENANT_ADMIN | same | user token, own tenant | covered by the same role list; the refusal row "TENANT_ADMIN of t1 with header t2 → 403" pins its binding |
| A forged header from an admin user | — | user token, foreign tenant | "EDITOR of t1 with header t2 → 403", "TENANT_ADMIN of t1 with header t2 → 403" |
| MCP server | `tools/mcp-server/src/index.ts:62-66` (`x-api-key` master key on every call); GET `/assets` 1726, GET `/signals` 2063, GET `/leads` 2114, DELETE `/leads` 2163, GET `/audit` 2226 | GLOBAL_ADMIN, any tenant | "GLOBAL_ADMIN with header t2 → authorised" |
| Storefront customer (public pool) | none legitimate | CUSTOMER of its tenant | "CUSTOMER (public pool) with header t1 → 403" |
| Renderer | calls none of the five (`renderer/src/app/api/leads/route.ts:61` is `POST /leads`, another route and handler) | — | none |

Basis for the caller list: a literal-string grep for `/leads`, `/audit`, `/signals` and `/assets` over `admin/src`,
`renderer/src` and `tools/mcp-server/src` (2026-10-27). A URL that is built at runtime from parts would not match, so
the list is a verified subset, not a proof of completeness.

## 6. Tests — `backend/test/unit/tenant-binding.test.ts`

Credential-free. `db.js` is mocked, which is the pattern of `import-key-ownership.test.ts`. Table-driven over the five
handlers. Each test title starts with the handler file name. `leads/delete.ts` rows also carry
`pathParameters.email`. Six rows per handler, 30 tests in total:

- `<handler>: EDITOR of t1 with header t1 → authorised (DynamoDB called, status 200)`
- `<handler>: EDITOR of t1 with header t2 → 403, no DynamoDB call`
- `<handler>: TENANT_ADMIN of t1 with header t2 → 403, no DynamoDB call`
- `<handler>: GLOBAL_ADMIN with header t2 → authorised (DynamoDB called)`
- `<handler>: CUSTOMER (public pool) with header t1 → 403, no DynamoDB call`
- `<handler>: no x-tenant-id → 400, no DynamoDB call` (existing behaviour, now pinned)

The two authorised rows also assert that the one DynamoDB command targets `TENANT#<header>`. This shows that the
tenant that was checked is the tenant that is read or deleted. The 403 rows assert an `Access Denied` message. The
CUSTOMER row asserts `Access Denied: Role 'CUSTOMER'`: CUSTOMER is refused by the role check, not by the tenant check.

**Proof that the tests detect the defect:** the same test file was run against the unchanged handlers at HEAD `ae3b5b5`,
in a temporary worktree. The result: 15 failed, 15 passed. The 15 failures are the three refusal rows of each of the
five handlers. The 15 passes are the authorised rows and the 400 rows, which this slice must not change.

## 7. Migration / deployment notes

No data migration. No infra change. Deploy is the operator's job: staging deploy, then the live probe is run again. The
expected result is that the four foreign-header GETs return **403**. Prod deploy happens on the human's word. Rollback:
revert the five handler hunks.

## 8. Definition of Done / evidence

| # | Oracle | Result | Label |
|---|---|---|---|
| 1 | `cd backend && npm run test:unit` | exit 0; 26 files, 332 tests passed (incl. the 30 above) | EXECUTED |
| 2 | `npm run typecheck` (root) | exit 0 | EXECUTED |
| 3 | `git diff --check` (root) | exit 0 | EXECUTED |
| 4 | `grep -L "requireRole"` over the five handlers | prints nothing | EXECUTED |

Repository Definition of Done builds (`CLAUDE.md`), run in root dependency order from the repo root with
`npm run build -w <workspace>`: `packages/shared`, `packages/effects` (a dependency of plugins), `packages/plugins`,
`backend`, `renderer` — each exit 0 (EXECUTED 2026-10-27; renderer last output: the `next build` route legend).
Also run: `cd tools/mcp-server && npm test` (exit 0; no route changed, so `routes.json` needs no refresh). Coverage note: `backend/tsconfig.json` excludes `**/*.test.ts`, so oracle 2 type-checks
the handlers but not the new test file. Live staging re-probe: NOT RUN (operator's step, § 7).

## 9. Follow-ups (recorded, not done here)

- (a) **`GET /signals` role set.** `signals/create.ts` and `signals/update.ts` allow only GLOBAL_ADMIN and TENANT_ADMIN;
  `signals/list.ts` now allows EDITOR too, because EDITOR could reach it before this slice. Whether an EDITOR may read
  signals is a product question.
- (b) **Denial answered with 500.** `content/list.ts` and other handlers call `requireRole` inside the outer try/catch,
  so a denial is answered with 500 instead of 403. This was observed in the probe: `GET /content` with a foreign
  header → 500 "Access Denied…". Not fixed here.
- (c) **CI guard.** A check that every authenticated handler calls `requireRole`, or states why it does not. Not built
  here.

## 10. Exit criterion

`service-account-1` can scope a key to `leads:read` (and the other four routes) knowing that the handler enforces the
tenant of the key.

## 11. References

`backend/src/auth/policy.ts`, `backend/src/auth/authorizer.ts`, `backend/test/unit/import-key-ownership.test.ts`,
`docs/slices/service-account-1.md`, `docs/ROADMAP.md` Track F (2026-10-27), `docs/slices/import-policy-1.md` (same
`requireRole` binding pattern).

## 12. Review and staging verification (operator, 2026-10-27 — appended after review approval and the staging deploy)

- Review history: review-0 `gpt-6.1-sol` revise (R1 build evidence for shared/plugins/renderer missing from the report;
  R2 "three" → "four" plain-text missing-header handlers in § 2) → builder cycle 2 → review-1 approved. Builder
  `claude-opus-5-5`. No code finding.
- Operator gates on the approved tree: shared build 0; backend `test:unit` 332/332 (302 + the 30 `tenant-binding` rows);
  root typecheck 0; `git diff --check` 0; `grep -L requireRole` over the five handlers prints nothing. Logs: operator
  scratchpad `glam/tb1-g*.log`.
- `cdk diff -c stage=staging` (read-only): the five Lambda functions (`ListAssetFunc`, `ListAuditFunc`, `ListLeadsFunc`,
  `DeleteLeadFunc`, `ListSignalFunc`), the renderer/admin assets that move on every deploy, and the three nested-stack
  descriptions (an em-dash encoding difference, no resource). `cdk deploy -c stage=staging AmodxStack-staging` exit 0.
- Live probe (temporary EDITOR of `cache-probe-2026` on the staging admin pool, deleted after; app-client flows reverted
  and verified): foreign tenant `opn1-iso-b` → **403** "Access Denied: You do not have access to this tenant." on
  `GET /leads`, `/audit`, `/signals`, `/assets` and `DELETE /leads/{email}` (before the deploy: 200 on the four GETs,
  `/audit` returned 6 foreign rows); own tenant → 200 on all five. GLOBAL_ADMIN (mandated staging admin) → 200 on all
  five routes for both tenants. The DELETE rows used a non-existent email, so nothing could be lost.
- Prod: on the human's word. Expected prod `cdk diff`: the same five Lambda functions plus the per-deploy renderer/admin
  assets; no infra resource change.

## 13. Prod deployment record (operator, 2026-10-28 — appended after the human's prod deploy)

- Deployed by the human from `fc8c52c` (`cdk deploy -c stage=prod AmodxStack`). The five prod functions
  (`AmodxStack-ApiListLeadsFunc…`, `…DeleteLeadFunc…`, `…ListAuditFunc…`, `…ListSignalFunc…`, `…ListAssetFunc…`) report
  `LastModified 2026-10-28T06:16:49Z`; they are the five newest functions of the prod API stack.
- Deployed bytes (read-only `aws lambda get-function` download of each of the five bundles): each bundle contains the
  policy module's denial text `You do not have access to this tenant` (its only source in the tree is
  `backend/src/auth/policy.ts`; before this slice none of the five handlers imported it) and one `statusCode: 403`
  response. The bundles are minified, so the identifier `requireRole` itself is not greppable.
- Live regression check (operator, GET-only, master key as the MCP server uses it — GLOBAL_ADMIN path): `GET /leads`,
  `/audit`, `/signals`, `/assets` → 200 with items for two live tenants; bogus credentials → 403 from the authorizer.
  Log: operator scratchpad `glam/tb1-prod-global-probe.log` (statuses and counts only).
- CloudWatch over 06:16–06:40Z: `Errors` 0 on all five functions (`Invocations` 0 — no traffic in the window before the
  probe).
- **Not proven on prod:** the cross-tenant 403 for an EDITOR/TENANT_ADMIN token. No prod EDITOR account exists for the
  operator and prod Cognito reads are not permitted, so that path is proven on staging only (§ 12) with identical
  handler code (`fc8c52c` on both stages) and by the 30 unit rows.
