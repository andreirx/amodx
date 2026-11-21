# PAY-1 — "paid" becomes a real order transition, with an event

Status: **SHIPPED 2026-11-21 (staging)** — prod deploy pending (human). Drafted 2026-11-20; human 2026-11-21: "continue in the proposed order". Track: commerce. Depends: none. Prerequisite of `pay-2`,
`invoice-1`, `voucher-1`, `sched-1h`. Maturity target: PROTOTYPE.

## Purpose / risk retired

An order's payment state exists as a field and nothing manages it.

- Orders are created `paymentStatus: "pending"` (`backend/src/orders/create.ts:395`).
- The only writer is the generic field patch `PUT /orders/{id}`: `paymentStatus` is in its allowlist
  (`orders/update.ts:30-35`) and the value is not checked against the enum
  (`packages/shared/src/index.ts:1755`: `pending | paid | refunded`).
- The admin shows the state and has no control to change it (`admin/src/pages/OrderDetail.tsx:329-330`).
- No event is published on order creation or on a payment change (`orders/create.ts`, `orders/update.ts`: no
  `publishAudit`). The status route does publish (`orders/update-status.ts:81-88`).

Everything that must happen "when the money arrives" (invoice, voucher, a paid mark in a course roster) has no
moment to attach to.

## Scope

1. `PUT /orders/{id}/payment` `{paymentStatus, note?}` — admin roles of the status route. Allowed transitions as
   a table in shared code: `pending → paid`, `paid → refunded`, `pending → refunded` refused, same → same is a
   no-op 200. Conditional write on the previous state (two admins at once: one wins, the other gets 409).
2. `paymentStatus` leaves the allowlist of the generic patch (a request that sends it gets 400 naming the new
   route).
3. Event: a domain event `ORDER_PAYMENT_CHANGED` on the existing bus (`backend/src/lib/events.ts`), next to the
   audit entry (actor email, order number as title — Critical Rule 7). No consumer in this slice; `invoice-1`
   and `voucher-1` add theirs.
4. Admin: "Mark as paid" / "Mark as refunded" on the order page, with a confirmation. English text.
5. Customer mail "payment received" through the per-tenant template pattern (`order-email.ts`), EN + RO
   defaults in the language packs.
6. MCP route + `routes.json`.

## Non-scope

Online payment (`pay-2`). Partial payments. Refund execution at a processor.

## Evidence taxonomy

| Input | Expected |
|---|---|
| `pending → paid` | 200, one event, one audit entry, one mail |
| `paid → paid` | 200, no event, no mail |
| `paid → pending`, unknown value | 400 |
| two `pending → paid` at once | one 200, one 409, one event |
| generic patch with `paymentStatus` | 400, order unchanged (read back) |
| another tenant's order id | 404 |

## Deployment notes

Commerce freeze: this changes order handlers without moving data (human 2026-11-15: fix what can be fixed
now). Route registration in `infra/lib/api-commerce.ts` (gain: the owner can record a payment). When Track B's
`cmrc-4` lands, the write goes through `commerce-db.ts`; the transition table does not change.

## Exit criterion

An owner marks a bank-transfer order paid in the admin, the customer gets the mail, and the event is visible in
the audit trail.

## Build record (2026-11-21, builder; on `main` `c1e8a9b`, uncommitted)

Executed under the operator packet of 2026-11-21 (it wins where it differs from the draft above). Evidence labels:
EXECUTED / OBSERVED / INFERRED / NOT RUN.

### Deviations from the draft (deliberate, from the packet)

- **No new route.** The draft named `PUT /orders/{id}/payment`. The transition is on the existing `PUT /orders/{id}`
  (`backend/src/orders/update.ts`), which already received `paymentStatus`. No `infra/` change; `routes.json` does not
  change (OBSERVED: `git status` shows it unmodified; `tools/mcp-server` route-coverage test passes, EXECUTED).
- **No domain event.** `ORDER_PAYMENT_CHANGED` is not built: it has no consumer. The first consumer (`invoice-1` or
  `voucher-1`) attaches in `changePaymentStatus` (`orders/update.ts`), after the audit entry — the one function that
  performs the transition.
- Draft row "`paid → pending` → 400" is now 409 (the packet: refused → 409 with the reason and the current state); a
  value outside the enum stays 400. Draft row "generic patch with `paymentStatus` → 400" is replaced: `paymentStatus`
  with another field → 400 "send the payment state alone"; `paymentStatus` alone is the transition.
- EN + RO defaults in the language packs: not built. The packet rules the default as English backend text, the
  existing pattern of `getDefaultTemplates()` (finding F1 below).

### What changed

| Path | Serves |
|---|---|
| `packages/shared/src/payment-transition.ts` (new) | § 2 item 1: `paymentTransition(previous, requested)` → `apply` / `no-op` / `refused { reason }`; one arm per pair of the 3 × 3 states, a `never` check per `switch` |
| `packages/shared/src/index.ts` | `PaymentStatusSchema` (the enum, now used by `OrderSchema.paymentStatus` — same values, same default); re-export of the rule |
| `backend/src/orders/update.ts` | § 2 items 2-4, 6: `changePaymentStatus` (validation, read, rule, conditional write, audit, mail); `paymentStatus` removed from the field allowlist (the branch before the loop makes it unreachable there); 500 answers "Internal error" and logs `[orders/update] Error:` |
| `backend/src/lib/order-email.ts` | § 2 item 4: default template `paid` (flags of `confirmed`) |
| `admin/src/pages/OrderDetail.tsx` | § 2 item 5: `paymentAction`, `paymentErrorText` (exported for tests), the button, `confirm()`, reload after success |
| `admin/src/pages/OrderEmails.tsx` | § 2 item 5: `paid` key, label "Paid", description, page default text; file-local `ALL_STATUSES` renamed `TEMPLATE_KEYS` (it no longer lists only statuses) |
| `packages/shared/test/pay-1.test.ts`, `backend/test/unit/pay-1.test.ts`, `admin/src/pages/OrderDetail.test.ts` (new) | § 3 taxonomy rows |
| `backend/test/unit/order-email.test.ts` | The test "default templates cover every schema status and nothing else" encoded the invariant this slice changes; it now says "… plus the payment key `paid` …"; one row added for the `paid` flags |
| `docs/commerce.md`, `packages/shared/ARCHITECTURE.md`, `backend/ARCHITECTURE.md`, `admin/ARCHITECTURE.md` | § 2 item 8 and the per-package docs |

`tools/mcp-server/src/**`: not changed. No tool sends `PUT /orders/{id}`: the only order calls are `get_order`
(`GET /orders/{id}`) and `update_order_status` (`PUT /orders/{id}/status`) (OBSERVED: `grep -rn 'orders/' tools/mcp-server/src`,
a text search over every file of `src`, two hits). No new tool (packet).

Abstraction lines:
- `paymentTransition` — users: `orders/update.ts`; axis: variants fixed, operations growing → closed sum + exhaustive
  `switch` (a new payment state breaks the compile at every arm: EXECUTED, a temp copy with a fourth state gave four
  `TS2345 … not assignable to parameter of type 'never'` errors); rejected: the rule inline in the handler (the packet
  rules it into shared code, beside the order schemas, so `pay-2` and the admin can read the same table).
- `PaymentStatusSchema` — users: `OrderSchema`, `orders/update.ts` (request and stored-value parse), the rule's type;
  axis: none (one definition of the enum for three users); rejected: a second `z.enum` literal in the handler.
- File choice: a new file beside `index.ts`, as `coupon.ts` (the precedent for a pure rule); `index.ts` keeps schemas.

### Decisions recorded by the builder

- **Stored value outside the enum.** Before this slice the patch stored any text. Such a value (e.g. `"PAID"`) → 409
  `"The stored payment state is not one of pending, paid, refunded."` with the stored value; no write. The rule
  cannot decide from it; an owner can see it on the order page (no button is offered). Not in the packet; it makes
  the handler total. Production has demo shops only (human), so INFERRED: no such record exists.
- **Condition also requires `attribute_exists(SK)`.** Without it, an `attribute_not_exists(#paymentStatus)` update of
  an order deleted between read and write would create a partial item. With it the race answers 409.
- **Order of checks.** enum → only `paymentStatus`/`note` → `note` text ≤ 500 → read. A value outside the enum is
  refused before any read (taxonomy row).
- **`{{status}}` / `{{statusLabel}}` in the `paid` mail** are `paid` / `Paid`; `{{note}}` is the payment note; the other
  variables are those of `update-status.ts`.
- **Audit `details.previous`** is the state the rule used (`pending` when the field was absent).
- **Admin confirmation** is the browser `confirm()` (the repository's pattern, e.g. `Coupons.tsx`). The admin sends no
  note; the API accepts one. On a 409 the page shows the server's reason and does not reload (packet: reload after
  success).
- **Admin tests are pure-logic** (no markup capture): `paymentAction` (button per state) and `paymentErrorText` (409 text).
- **`orderEmailConfig`** is `{ templates: z.record(string, template) }` — an open record (OBSERVED,
  `packages/shared/src/index.ts`). No schema edit; a stored config without `paid` uses the default (test row). The
  packet wrote `orderEmailConfig.paid`; the real path is `orderEmailConfig.templates.paid`.

### Findings (not fixed here)

- **F1** — The default mails are English text in the backend (`getDefaultTemplates()`), not the tenant's language
  pack. The `paid` default follows that pattern (packet).
- **F2** — The admin page `OrderEmails.tsx` holds its own `DEFAULT_TEMPLATES`, whose texts differ from the backend's
  for every key (now also `paid`). Which one a tenant gets depends on whether the owner saved the page.
- **F3 (debt)** — The mail-assembly block (template choice, variables, recipients, send) now exists twice:
  `orders/update-status.ts` and `orders/update.ts` (`sendPaidMail`). One shared function needs `update-status.ts`,
  which is outside this slice's allocation.
- **F4** — `update-status.ts`, `get.ts`, `list.ts` still answer 500 with `e.message` (packet § 2 item 6: only this handler).
- **F5** — `OrderEmails.tsx` names `STATUS_LABELS`, `STATUS_DESCRIPTIONS`, `activeStatus` are keyed by template key now
  (`paid` is not a status). File-local; left as they are to keep the diff small.
- **F6** — No test covers `OrderEmails.tsx` (the `paid` key there is verified by typecheck and reading only).

### Gates (logs in `.agent-manager/slices/PAY-1/`, gitignored)

| Command | Exit | Result | Label |
|---|---|---|---|
| `npm run build` | 0 | all workspaces | EXECUTED |
| `npm run typecheck` | 0 | | EXECUTED |
| `npm --prefix packages/shared test` | 0 | 24 files, 424 tests | EXECUTED |
| `npm --prefix backend run test:unit` | 0 | 61 files passed + 1 skipped (the existing golden capture), 1559 tests | EXECUTED |
| `npm --prefix admin run test:unit` | 0 | 16 files, 303 tests | EXECUTED |
| `npm --prefix renderer test` | 0 | 46 files, 626 tests | EXECUTED |
| `npm --prefix renderer run test:serving` | 0 | 126 pass, 0 fail | EXECUTED |
| `npm --prefix packages/plugins test` | 0 | 12 files, 355 tests | EXECUTED |
| `npm --prefix tools/mcp-server test` | 0 | 17 pass | EXECUTED |
| `git diff --check` | 0 | (untracked new files checked by a trailing-space grep: none) | EXECUTED |

Baseline proof of the golden: the four `it`s of "patch without paymentStatus" in `backend/test/unit/pay-1.test.ts`
were run against the `c1e8a9b` handler in a temporary worktree: 4 passed (EXECUTED). The whole file there: 25 failed,
5 passed — the payment rows do discriminate (EXECUTED). Worktree removed.

NOT RUN (operator): staging checks — an owner marks a bank-transfer order paid in the admin, the customer receives the
mail, the entry `UPDATE_ORDER_PAYMENT` is in the audit trail; a refund; two admins at once.

## Build record — revision 1 (2026-11-21, builder; after review-0 and operator rulings R1-R4, packet § 6)

### Correction to the first build record

The first record says "No `infra/` change" and states the `paid` mail as delivered behaviour. On the CDK source of
`c1e8a9b` that was not true: `UpdateOrderFunc` had no `SES_FROM_EMAIL` and no SES permission, so a deployment
would record the payment and answer 200 without a mail (`sendPaidMail` returns when the sender is absent). The unit
test set the sender itself and mocked SES, so it could not see the gap. Class of defect: a handler gains a new
dependency on its environment (a variable or a permission) and only the handler side is tested. Rule applied here:
every dependency the handler reads from its Lambda environment or calls through an AWS client has its wiring checked
in the deployment definition. For `orders/update.ts` after PAY-1: `TABLE_NAME` and the DynamoDB grant (existing),
`EVENT_BUS_NAME` and `events:PutEvents` (existing: `nodeProps` and the stack-wide `grantPutEventsTo` loop,
`infra/lib/api-commerce.ts`, OBSERVED), `SES_FROM_EMAIL` and `ses:SendEmail` (added now).

### What changed in this revision

| Path | Serves |
|---|---|
| `infra/lib/api-commerce.ts` | R1: `UpdateOrderFunc` gets `SES_FROM_EMAIL: sesEmail` and one statement `ses:SendEmail` on `sesIdentityArn` — the two lines of `UpdateOrderStatusFunc` |
| `infra/test/amodx-stack.test.ts` | R1: `(pay1-1)` the variable is on the function, with the neighbour's value; `(pay1-2)` exactly one SES statement on the function's role, action `ses:SendEmail`, one resource containing `:identity/`, not `*`, equal to the neighbour's statement |
| `admin/src/pages/OrderDetail.tsx`, `OrderDetail.test.ts` | R2: `null` is not absent → no button (test). R3: the confirmation text is "Mark this order as paid? The Paid email follows your Email Templates settings. A failed email does not undo the payment change." (test pins it) |
| `backend/test/unit/pay-1.test.ts` | R2: stored `null` → 409, no write, no audit, no mail. The handler already refused it (`stored !== undefined`); no handler change |
| `admin/src/pages/OrderEmails.tsx` | R4: file-local renames `STATUS_LABELS` → `TEMPLATE_LABELS`, `STATUS_DESCRIPTIONS` → `TEMPLATE_DESCRIPTIONS`, `activeStatus`/`setActiveStatus` → `activeKey`/`setActiveKey`, parameters and loop names `status`/`s` → `key`/`k`, comment "Template key tabs". Kept: the template variable names `status`, `statusLabel` (a stored template contract) and UI text that stays true |
| `docs/commerce.md`, `backend/ARCHITECTURE.md`, `admin/ARCHITECTURE.md` | The wiring, `null`, the button rule |

Finding F5 of the first record is fixed by R4. `infra/ARCHITECTURE.md` is not changed: R1 allows nothing else under
`infra/`; its function list does not name per-function variables (OBSERVED, line 89 lists the variables generically).

### Synth effect (R1)

`npm --prefix infra test` logs per-template counts. With this change: `CommerceApi=221/36fn` (OBSERVED,
`r1-infra.log`). Before: 221 (INFERRED). Basis: `.agent-manager/slices/CAT-IMAGES-1/iter3-o5.log` (2026-10-30) shows
221; the one later commit to `api-commerce.ts` (`8eb1aac`) adds only grants to functions whose roles already had a
policy. A baseline synth of `c1e8a9b` in a temporary worktree failed before the stack was built (Turbopack: "Could
not find the Next.js package" through a symlinked `node_modules`), so the before-count was not measured. The change
is one statement in the existing default policy of `UpdateOrderFunc`'s role and one environment variable: no new
resource. That a mail is delivered after deployment is the operator's staging check (NOT RUN).

### Gates (logs `r1-*.log` in `.agent-manager/slices/PAY-1/`)

| Command | Exit | Result | Label |
|---|---|---|---|
| `npm run build` | 0 | | EXECUTED |
| `npm run typecheck` | 0 | | EXECUTED |
| `npm --prefix packages/shared test` | 0 | 424 tests | EXECUTED |
| `npm --prefix backend run test:unit` | 0 | 1560 passed, 1 skipped (existing golden capture) | EXECUTED |
| `npm --prefix admin run test:unit` | 0 | 304 tests | EXECUTED |
| `npm --prefix renderer test` | 0 | 626 tests | EXECUTED |
| `npm --prefix renderer run test:serving` | 0 | 126 pass, 0 fail | EXECUTED |
| `npm --prefix packages/plugins test` | 0 | 355 tests | EXECUTED |
| `npm --prefix tools/mcp-server test` | 0 | 17 pass | EXECUTED |
| `npm --prefix infra test` | 0 | 63 tests, `(pay1-1)` and `(pay1-2)` pass | EXECUTED (run on the final tree) |
| `git diff --check` | 0 | new untracked files: trailing-space grep, none | EXECUTED |

NOT RUN (operator): staging — mark a bank-transfer order paid, the customer receives the mail, `UPDATE_ORDER_PAYMENT`
in the audit trail; a refund; two admins at once.

## Operator closeout (2026-11-21)

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, two cycles. Review-0 escalated on one point: the mail of this
slice could not be sent from the deployed function. Review-1 approved.

**Deviations from the draft above, decided in the packet.** No new route (the rule lives in `PUT /orders/{id}`;
a request that changes the payment state sends it alone). No domain event (no consumer exists; `invoice-1` or
`voucher-1` adds it at the one function that performs the transition).

**Operator ruling R1 — one infra change, named gain.** `UpdateOrderFunc` gets `SES_FROM_EMAIL` and `ses:SendEmail`
on the platform's sending identity (the same two lines `UpdateOrderStatusFunc` has). Gain: the "payment received"
mail cannot be sent otherwise. Infra assertions `(pay1-1)`, `(pay1-2)`. Reported to the human.

**Gates (operator run on the approved tree).** build 0, typecheck 0, shared 0, plugins 0, renderer 0, serving 0,
admin unit 0, backend unit 0, mcp 0, infra 0, `git diff --check` 0. Oracles: the only paths under `infra/` are the
two allowed files; no `package.json`, lockfile, renderer or `routes.json` change; every path in the allocation.

**Staging.** `cdk diff`, read first: IAM — one statement added, `ses:SendEmail` on the sending identity for the
role of `UpdateOrderFunc`; one variable added to that function; 54 functions change by code only (shared package);
no resource added or removed. Deployed to `AmodxStack-staging`.

Probe order put into `AmodxTable-staging` (tenant `cm1-commerce`; the public order route cannot be used on staging),
driven through the deployed admin API, read back from the table, deleted at the end:

| Step | Result |
|---|---|
| no state stored, request `refunded` | 409 "Only a paid order can be refunded." |
| value outside the enum | 400 |
| payment state together with another field | 400; nothing written |
| no state stored → `paid` | 200; stored `paid` with `paidAt` |
| `paid` → `paid` | 200; nothing written (`updatedAt` unchanged) |
| `paid` → `pending` | 409 |
| patch of the tracking number only | 200; stored; payment state untouched |
| `paid` → `refunded` | 200; stored with `refundedAt` |
| `refunded` → `paid` | 409 |
| the same order id under another tenant | 404 |
| audit trail | two `UPDATE_ORDER_PAYMENT` entries with the order number |
| the "paid" mail (customer address = the SES mailbox simulator) | the function has `SES_FROM_EMAIL`; its log of the run (10 invocations) holds no error and no "Failed to send" line |
| 51 CM1 reference URLs against the capture after `coupon-fix-1` | status, headers, `lang` and words equal on 51 of 51 |

**Not checked.** The admin buttons in a browser (their logic is unit-tested; the API they call is proven above).
The text of the delivered mail (the simulator accepts and discards it).

**Findings left open.** The default order mails, the new one included, are English text in the backend, not the
tenant's locale table. `paymentStatus: null` on a stored order is refused by design (only an absent field counts
as pending).
