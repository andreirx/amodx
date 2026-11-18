# REDIRECT-1 — an owner can add a redirect from an old address

> Copied 2026-11-18 from `satulbanului/docs/amodx-slices/redirect-1.md` (draft written by the satulbanului session). This copy is the one to edit.
> Not ratified. Its `file:line` evidence comes from one read-only pass on `main` at `3388999`; a builder reads each again.

Status: **PLANNED (draft, not ratified)**. Track: new, `redirect`. Depends: none. Maturity target: PROTOTYPE.

## Purpose / risk retired

A site that moves to AMODX loses the search position of every old address that has no page with the same
address. The redirect record already exists and the renderer already obeys it; only a slug rename can write one.

- Record: `packages/shared/src/index.ts:246-247` — `isRedirect`, `redirectTo` on the route.
- Reader: `renderer/src/lib/dynamo.ts:202-203` returns `{redirect}`; `SitePage.tsx:552-553` calls
  `permanentRedirect` (answer 308).
- Only writer: `backend/src/content/update.ts:149-158`, on a slug change.
- List: `backend/src/content/list.ts:22-29` (`type=Redirect`). No admin screen calls it.

## Scope

1. Backend: `POST /redirects` `{from, to}` and `DELETE /redirects` `{from}` (admin roles of the content
   handlers). `from` goes through `normalizeSlug`; refused when `reservedAddressRefusal` refuses it, when a
   live page owns `ROUTE#<from>` (a conditional write: never overwrite a page route), when `from === to`, or
   when `to` is itself a redirect (no chains). `to` is a root-relative address of the same site; an absolute
   URL is refused. Writes the same item shape as `update.ts:149-158`. `publishAudit` with actor email and a
   title (Critical Rule 7). Cache: purge the changed path the way a slug rename does.
2. Admin: a "Redirects" list under the content section — the existing `type=Redirect` list, an add row, a
   delete button. English texts (the admin stays English).
3. MCP server: the two routes, `routes.json` refreshed.

## Non-scope

Patterns or wildcards. Redirects to another host. Answer code 301 in place of 308 (search engines treat both
as permanent). Import of a redirect file.

## Evidence taxonomy

| Input | Expected |
|---|---|
| valid `from`, valid `to` | 201; the renderer answers 308 with `Location: to` |
| `from` owned by a published page | 409, the page route unchanged (read back) |
| `from` under a reserved prefix | 400 with the refusal text of the guard |
| `to` absolute URL / empty / equal to `from` | 400 |
| `to` is a redirect | 400 (no chain) |
| `from` with a trailing slash | stored without it (the address Next asks for after its own 308) |
| delete of an address that is a page, not a redirect | 409, nothing deleted |
| another tenant's `from` | not reachable: keys are built from `x-tenant-id` only |

## Migration / deployment notes

Additive: one new route pair; no existing item changes. No `infra/` edit beyond the route registration that
every new handler needs (name it at the cdk-diff gate: gain = owners keep old addresses). Staging first.
Rollback: redeploy; redirect items already written keep working, because the reader is unchanged.

## Definition of Done

Repository gates exit 0; `tools/mcp-server` route coverage green. Staging: add `/room` → `/guest-house`,
`curl -sI` shows 308 and the Location; delete it; the address answers 404.

## Exit criterion

The 17 addresses in `satulbanului/infra/redirects.json` can be entered by hand or by script and all answer 308.
