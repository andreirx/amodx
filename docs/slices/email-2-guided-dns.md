# EMAIL-2: Guided DNS for external mailbox providers + read-only DNS checker

- **Status:** PLANNED (implementation wave; EMAIL phase, first buildable)
- **Track:** EMAIL
- **Depends:** RATIFIED plan docs/plan-email-onboarding.md §4.2 (binding), D-EMAIL-3
  (neutral recipes), D-EMAIL-4 (read-only, never write DNS)

## Scope (exactly §4.2)

1. **Recipes as DATA** (provider → record set): Google Workspace, Microsoft 365, Zoho,
   "keep existing cPanel/host". Each record: type, host, value, priority + a
   `lastVerified` date. Lives in `packages/shared` ONLY IF both admin and backend
   consume it; if only admin renders, keep it in admin (decide + record).
2. **One backend handler** performs read-only public DNS lookups (Node dns resolver;
   tenant-scoped x-tenant-id) and returns per-record {expected, observed, status,
   queriedAt, observedTtl}. NEVER writes DNS. NEVER in renderer/browser.
3. **Admin surface** (deep-vertical, mandatory): Settings→Email (or top-level Email
   page): provider selector; record table with copy buttons; a "Check DNS" action;
   per-record expected-vs-observed pass/fail with the query timestamp. Theme tokens.
4. **Destructive-advice guard:** MX rows carry an explicit "publishing this replaces
   your current mail routing domain-wide" warning (a client on cPanel who pastes
   Google MX loses mail). email-5 owns ordering; here it's a visible warning.
5. **Never assert permanent verdicts** from one read (negative-cache ambiguity): show
   queriedAt + observed TTL; "not published" and "not yet propagated" are labeled as
   indistinguishable.

## Non-scope

AmodX writes NO DNS (D-EMAIL-4); no registrar/DNS-provider adapters; no credential
storage; no mailbox provisioning/reseller/billing; no inbound mail; NO change to the
sending identity (email-2a/D-EMAIL-1 territory — must not be smuggled in). No infra
beyond the one handler's registration if the import-family pattern implies it (STOP if
more than a route+grant).

## DoD / evidence

Unit tests: recipe data shape; the DNS-result mapper (expected vs observed → status),
incl. the propagation-ambiguity labeling; handler contract test (tenant-scoping,
read-only). Admin build + typecheck. The DNS checker's live behavior against a real
domain is an operator/NOT-RUN probe. No renderer change → serving suite unaffected
(confirm).

## Output surface

The admin Email page (provider selector + record table + Check DNS result rendering)
+ unit transcripts + the recipe-data-location decision recorded.

## Revision 1 (EMAIL-IMPL-2, 2026-08-09) — reviewer findings addressed

The iteration-0 review (`revise`) is closed by the following changes; the notes below the
line were updated in place to describe the FINAL implementation:

1. **Theme tokens (Critical Rule 6).** Status pills no longer use hardcoded `green/amber/red`.
   Verdict semantics are carried by an ICON (accessible, colour-independent) tinted with the
   admin palette's `primary` / `destructive` / `muted` tokens: `match`→primary, `mismatch`→
   destructive, `missing`/`error`→muted (the two AMBIGUOUS states).
2. **No blank records; M365 MX is derived + checkable.** The M365 MX row is now a `derive:
   "m365-mx"` row: its value is computed from the domain (`<domain dots→dashes>.mail`
   `.protection.outlook.com`) by the pure `deriveEmailDnsValue` in `shared`, used identically
   by admin (copyable display) and the backend (server-authoritative `expected`). It is
   therefore checkable, not a blank reference row. M365 DKIM selectors are added as
   `checkable:false` CNAME guidance rows (console-generated). The UI renders a guidance line
   for every reference row so no row is blank.
3. **MX priority preserved + compared.** The resolver's MX priority is kept (`observedMx`),
   the DTO carries `expectedPriority` + `observedMx`, and the mapper compares BOTH exchange
   and preference — a right exchange at the wrong priority is a `mismatch`, never `match`.
4. **Collision-free per-row identity.** Results are keyed by `recordIndex` (the row's index
   in `recipe.records`), so Zoho's three `MX @` rows are assessed and rendered independently
   instead of collapsing under a `type|host` key.
5. **Observed TTL rendered.** Each checked row shows its TTL; because Node exposes none for
   MX/TXT/CNAME it renders the resolver limitation explicitly, next to the query timestamp
   and the ambiguity statement.
6. **DMARC removed.** All `_dmarc` `p=none` rows are deleted from the recipes — DMARC
   health/remediation is `email-3`'s surface (plan §4.3); offering a policy value here could
   downgrade a tenant's existing DMARC.
7. **Docs.** `admin` / `backend` / `packages/shared` / `infra` `ARCHITECTURE.md` updated with
   the page/handler/DTO/route; this slice doc reconciled.

## Implementation notes (EMAIL-IMPL-2, 2026-08-09, uncommitted — pending review)

**Recipe-data-location DECISION → `packages/shared`.** Both admin AND backend consume the
catalogue, which is the slice's own promotion gate. Admin renders the recipe table + copy
buttons + `lastVerified`; the backend DNS-check handler consumes the SAME records so the
"expected" side of every check is **server-authoritative**, never asserted by the browser.
Rejected alternative: keep recipes in admin and have the client POST records to a generic
checker — smaller in the backend, but it makes "expected" client-controlled and permits
arbitrary-host lookups, defeating the tenant-scoped, trustworthy-diagnostic property §4.2
requires. Location: `EMAIL_PROVIDER_RECIPES` + the `EmailDns*` DTO types in
`packages/shared/src/index.ts`.

**Abstractions introduced (each earned):**
- `EmailDnsRecipeRecord.derive?: EmailDnsDerivation` + `deriveEmailDnsValue(kind, domain)` —
  concrete user: the M365 MX row, whose target is a deterministic transform of the domain and
  is therefore server-knowable and CHECKABLE. Axis: static-expected vs domain-derived-expected.
  Both admin (display/copy) and backend (the check's `expected`) call the SAME pure function,
  so it lives in `shared`. Rejected simpler forms: leave it `checkable:false` blank (the
  reviewer's rejected iteration-0 state — a blank, uncheckable record) or hardcode the value
  (impossible — it depends on the tenant). Sum type + exhaustive `switch` (one variant today).
- `EmailDnsRecipeRecord.checkable?: boolean` — concrete users: the DKIM-selector rows (Google
  `google._domainkey`, Zoho `zmail._domainkey`, M365 `selector1/2._domainkey`), whose value is
  generated per-tenant in the provider console and cannot be statically compared. Axis:
  console-generated vs known (static or derived) value. Rejected: omitting these rows (recipe
  incomplete) or comparing them anyway (permanent false "mismatch"). `checkable:false` rows are
  rendered WITH their setup guidance but never sent to the checker.
- `EmailDnsCheckRecordResult.recordIndex` — the collision-free row identity; concrete user:
  Zoho's three same-`(type,host)` MX rows, which a `type|host` key collapses. Rejected: a
  `type|host|value` key (breaks for `derive` rows whose static value is empty).
- `dns-map.ts` (pure mapper) split from `dns-check.ts` (edge I/O) — the seam that lets the
  verdict logic + propagation-ambiguity labelling + MX-priority comparison be unit-tested with
  no network/AWS.

**Contract details / assumptions:**
- Domain is derived from the tenant record (`SYSTEM` / `TENANT#<id>`.domain), never the
  request body (§4.3 cross-tenant-leak rule applied here). ASSUMPTION: the tenant's mail
  domain == its website `domain`. A separate email-domain field is a named future extension.
- The checker queries public resolvers (1.1.1.1 / 8.8.8.8), not the Lambda's local
  resolver, so the view matches an external receiver's and a private negative cache does
  not masquerade as "not published".
- `observedTtl` is **null** for MX/TXT/CNAME: Node's resolver does not expose per-record
  TTL for these RR types. The UI renders this null EXPLICITLY as the resolver limitation
  (never hidden), next to `queriedAt` + the `missing`/`error` labelling, exactly as
  §4.2/point 5 requires — the field is retained per the ratified DTO and populated only if a
  future A-record recipe uses it.
- Record VALUES are provider-documentation snapshots (INFERRED from public provider docs,
  NOT verified live) dated via `lastVerified`; a stale recipe reads as a `mismatch` against
  observed DNS rather than as silent breakage.

**Infra:** one handler + one route + one `grantReadData` (`POST /email/dns-check` in the
parent `infra/lib/api.ts`) — within the "route+grant" ceiling; no NestedStack, no SES/IAM
identity change (email-2a territory, explicitly not touched).

**Live DNS probe against a real domain: NOT RUN** (operator probe — requires deploy). The
natural pair per §4.2 is `bijup.com` (Cloudflare, no MX → `missing`) and `mocheta.com`
(spatiul.ro, MX present → `mismatch` vs any provider recipe).
