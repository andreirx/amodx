# PADDLE-HOOK-1 — the Paddle notification route fulfils nothing until a verified path exists

Status: **SHIPPED to `main` and staging 2026-11-22 (operator closeout).** Production: at the human's next deploy.

## The defect

`POST /webhooks/paddle` (`backend/src/webhooks/paddle.ts`) verified no Paddle signature. A body with
`alert_name: "payment_succeeded"`, an `email` and `passthrough: {"tenantId","productId"}` made the handler read
that product's private resource, sign a 24-hour download link and mail it to the given address. The tenant came
from the body, not from the caller's credential.

Who could reach it (OBSERVED on staging, 2026-11-22): the route is behind the API's authorizer. A request with
no credential, or with only the public client key, answers 401. A request with any accepted credential (a
signed-in admin or editor of ANY tenant, a service key) reached the handler. So the exposure was: any
authenticated user could get any tenant's paid file mailed to any address. It was NOT open to an anonymous
caller. The first description of this defect (in the operator's packet and in the report to the human) said
"public"; that was written from the source without a call to the deployed route, and is corrected here.

Two further facts (OBSERVED): Paddle's own notification carries no platform credential, so it answers 401 and
never reached the handler; and the site's buy buttons send no `passthrough`. No real purchase was ever
fulfilled by this route.

## The change

The handler fulfils nothing: it answers 200 `Not processed`, logs the event name only, and makes no table read,
no S3 call and no mail. Unit tests with calibrated call recorders. No infra change (the function keeps grants it
no longer uses; `pay-2` rewrites the route and removes them).

## Evidence

- Review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), two cycles, approved. Gates exit 0: build,
  typecheck, backend unit, infra, `git diff --check`.
- Staging: diff read first (one function's code; no IAM change); deployed; a forged `payment_succeeded` sent
  with a signed-in admin token answers 200 `Not processed` and the function logs
  `paddle-hook: not fulfilled (unverified route), event=payment_succeeded`; without a credential 401.

## Follow-up

Verified fulfilment of digital products moves to the order's paid state in the payment specification (`pay-2`).
