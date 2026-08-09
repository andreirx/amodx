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
