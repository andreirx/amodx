# SCHED-APPT-FIXES-1 — appointment mail replies and admin navigation

- **Status:** IMPLEMENTED 2026-11-26; ROADMAP says BUILT as the selection packet requires. Full validation pending.
- **Track:** Courses, payments and growth; appointment-only maintenance.
- **Depends:** `sched-groups-remove-1`.
- **Source plan:** operator selection packet SCHED-APPT-FIXES-1, 2026-11-26; existing scheduling contract in
  `sched-1.md` § 11 and § 25 (the group-removal record).
- **Maturity:** PROTOTYPE, unchanged. These fixes do not claim production qualification.

## Purpose / risk retired

A customer must be able to reply to the business, not the platform sender. Admin API requests must not rely on a
permissive gateway URL parser. A mistyped admin address must retain normal navigation and the sign-in guard.
This supports `docs/VISION.md`: independent tenant businesses, narrow deployable slices, and pure off-target rules.

## Scope, causes and fixes

### F1 — booking mail replies reach the wrong mailbox

**OBSERVED (source):** each of the three scheduling SES command sites set `Source` but no `ReplyToAddresses`.
The sender is the platform identity; replying therefore did not select the business address.

**Fix:** the pure `schedulingReplyTo` in the existing `backend/src/lib/scheduling-email.ts` selects an address list
by copy kind. Each send site conditionally adds the SES member; `undefined` omits the member entirely, not `[]`.
An exhaustive switch with a `never` check makes an added copy kind a compile-time obligation. Tenant contact data
is already projected/parsed by `scheduling/common.ts`; there is no new lookup or schema.

| Row | Mail | Required Reply-To | Pure rule test | Real sender wiring test |
|---|---|---|---|---|
| R1 | Customer copy, tenant contactEmail present | `[contactEmail]` | `scheduling-email.test.ts`, R1 | `scheduling-visitor.test.ts` D5/D6; `scheduling-admin.test.ts` F1 R1/R2; `scheduling-reminders.test.ts` F1 R1/R3 |
| R2 | Customer copy, no contactEmail | Header absent | `scheduling-email.test.ts`, R2 | Visitor F1 R2, admin F1 R1/R2, reminder F1 R2: assert the SES input has no member |
| R3 | Booking owner copy with customer email | `[customer email]` | `scheduling-email.test.ts`, R3 (also absent-customer case) | Visitor D6 and reminder F1 R1/R3: owner copy still has no booking link |
| R4 | Weekly planner to owner, no single customer | Header absent | `scheduling-email.test.ts`, R4 | Reminder suite G14 weekly delivery: one SES input, no ReplyToAddresses |

Abstraction: `schedulingReplyTo`; current users: visitor mail, admin cancellation, reminder/weekly job; fixed copy
variants, operations can grow; concrete variation: customer copy, booking owner copy, weekly planner; rejected:
repeating this non-trivial recipient rule at three SES command sites. No new module or boundary.

### F2 — double slash in every admin API request

**OBSERVED (source):** `apiRequest` joined `${API_URL}${path}`. A base ending in `/` and path starting in `/`
produced two slashes. `api.ts` has no sibling address builder.

**Fix:** at that one fetch site, remove all trailing slashes from the base and all leading slashes from the path,
then join with one `/`. No helper/module is needed for one current caller. Scheme, base subpath, path content and
query are preserved. Runtime config precedence, auth headers, tenant header and error handling are unchanged.

`admin/src/lib/api.test.ts` calls the real wrapper with invented config and mocked Amplify/fetch. It covers a base
with/without trailing slash, multiple boundary slashes, a path without a leading slash, base subpath + query,
and retained auth/tenant/API-key headers.

### F3 — an unknown admin address displays the raw router error

**OBSERVED (source before change):** the route table had no wildcard or errorElement. An unmatched path did not
reach AppShell and displayed React Router's raw 404, whether signed in or out. For matched protected routes,
AppShell waits for `getCurrentUser()`, then redirects signed-out visitors using `loginPathFor(pathname, search)` to
`/login?next=<encoded path+query>` with replace. Login accepts a safe local `next` after password sign-in or the
new-password step, else `/`. API 401/403 still redirects to plain `/login`.

**Fix:** append one `*` child inside AppShell, after the unchanged known children. Signed-in visitors see
**Page not found**, the normal AdminLayout/menu and **Go to start page** → `/`. The same guard runs before that
child; signed-out visitors now follow the existing protected-page redirect, including path/query. The login and
guard implementations did not change. No generic render-error boundary or errorElement is added.

Test seam: `appRoutes` names/exports the existing table, used by createBrowserRouter and `App.test.ts`; concrete
variation: production browser history versus test memory history; rejected: a copied table or source-text assertions
which could pass while the real router differs. No routing module added. The tests match unknown paths plus known
`/` and `/scheduling/planner`, then mount the real guard/layout/menu/login in jsdom with external I/O replaced.
They observe the heading, menu links, start link, and signed-out unknown/known redirects with query retention.

## Searches run and completeness basis

**EXECUTED / OBSERVED:** deterministic text searches over current source (not an indexed call-graph claim):

```sh
rg -n 'SendEmailCommand|SendRawEmailCommand|SESClient|@aws-sdk/client-ses|ses\.send' backend/src/scheduling backend/src/lib/scheduling*
rg -n 'sendVisitorMail' backend/src/scheduling
rg -n 'client-ses|SendEmailCommand|SendRawEmailCommand' backend/src
rg -n 'VITE_API_URL|API_URL|apiUrl|apiBase' admin/src --glob '!*.test.ts'
rg -n 'fetch\(|axios|AMODX_CONFIG|import\.meta\.env' admin/src --glob '!*.test.ts'
```

All scheduling SES construction/send hits are in **three files**, one command site per file:
`backend/src/scheduling/visitor/mail.ts`, `backend/src/scheduling/admin/bookings-cancel.ts`,
`backend/src/scheduling/reminders.ts`. Reviewing the delegating call sites shows visitor hold, confirm, cancel,
move and admin manual appointment/move all use `sendVisitorMail`. Reminders and weekAhead share the third site.
The whole-backend SES search found no additional scheduling sender outside those paths. This is a source inventory,
not a claim about external deployed senders.

The sole API-base concatenation in `admin/src` is `lib/api.ts`; no sibling functions build an API address.
Other fetches: `main.tsx` loads `/config.json`; `lib/upload.ts`, `pages/Migration.tsx`, `pages/Resources.tsx` PUT to
backend-returned presigned upload URLs, not the API base. `SchedulingPlanner.tsx` has a comment describing a local
fetch callback, not another global fetch. Renderer-base references in Categories, Products, ContentList and Settings
build public site links, not admin API calls. No other address site requires this fix.

## Boundaries, preservation and non-scope

- No DynamoDB operation, tenant binding, shared DTO, backend route, existing admin route or permission changes.
- No mail text/template, sender, recipient set, token/link, failure policy, audit or log-line changes.
- No dependency, infra, renderer, Google Fonts or generic render-error handling changes.
- Existing `whenText` re-export from admin cancellation remains untouched; its already-recorded import follow-up
  is not part of this slice. No functionality removed; no renames.
- `docs/platform-decisions.md` PD-001/002/003 remain unchanged. Mail selection stays pure; I/O stays at existing sites.
- MCP route inventory needs no update because no backend route or request/response DTO changed (OBSERVED diff).

## Definition of Done / evidence

Builder gates are the packet's exact bare commands in this order. They run changed source without deployment.
Admin tests use jsdom/Node with auth/fetch replaced; backend uses `vitest.unit.config.ts` (no integration setup).
No real records, installed environment, or staging data are used. No persistent isolated state root was created.

| Exact command | Expected | Actual | Evidence |
|---|---|---|---|
| `npm run typecheck` | Exit 0, all eight workspaces | Exit 0 | EXECUTED; operational build-progress.md, Gate 1 |
| `npm --prefix admin run test:unit` | Exit 0 | Exit 0; 23 files, 407 tests passed | EXECUTED; Gate 2, including the source URL and jsdom router outcomes above |
| `npm --prefix backend run test:unit` | Exit 0 | Exit 1; 79 files passed, 1 failed, 1 skipped; 1986 tests passed, 59 skipped; one unhandled error | EXECUTED; Gate 3: image-destination-policy beforeAll cannot bind 127.0.0.1 (`listen EPERM`), times out at 10000 ms; 58 tests there skipped. Full backend gate is NOT green |
| `git diff --check` | Exit 0 | Exit 0, no whitespace errors | EXECUTED; Gate 4 |

**EXECUTED, supplemental (not a replacement for Gate 3):**
`npm --prefix backend run test:unit -- test/unit/scheduling-email.test.ts test/unit/scheduling-visitor.test.ts test/unit/scheduling-admin.test.ts test/unit/scheduling-reminders.test.ts`
→ exit 0, four files / 205 tests passed. These run the real senders with SDK/store replacements and assert R1–R4
on SES inputs. They do not prove delivery through SES or a mailbox client's reply behavior.

Operational evidence: `.agent-manager/slices/SCHED-APPT-FIXES-1/build-progress.md` (gitignored); runner output is
also in the builder transcript. No durable acceptance or review record is asserted here.

### Revision iteration 1 — full backend gate remains unresolved (2026-11-26)

The review requests a completed full backend unit run where loopback binding is permitted; it requests no code
change. **EXECUTED:** `npm run typecheck` exited 0 (all eight workspaces); `npm --prefix admin run test:unit`
exited 0 (23 files, 407 tests passed). **EXECUTED:** `npm --prefix backend run test:unit` exited 1 after 10.47 s:
79 files passed, one failed, one skipped; 1986 tests passed, 59 skipped; one unhandled error. The failure is again
`test/unit/image-destination-policy.test.ts:115`: its beforeAll hook times out after 10000 ms following
`listen EPERM: operation not permitted 127.0.0.1`; its 58 tests did not execute. This run confirms the current
sandbox still denies binding. It does not meet the review's loopback-permitted full-suite requirement.

Defect class: validation-environment incompatibility. Rule: only a completed exit-0 full required suite closes this
gate; a denied setup or passing focused suite cannot replace it. No product code, tests, timeouts, suite selection,
or sandbox controls were changed. The supervisor must arrange a permitted builder environment or an authorized
operator run of the same full command against this candidate and return its exit code/output. The review item stays
open; no passing full-backend or acceptance claim is made. This iteration's evidence is in build-progress.md under
Revision 1; the focused 205-test result above is historical, not a new focused rerun.

## Migration / deployment, operator gates and remaining coverage

No data migration. After review, operator runs `npm run build` (the ordered full build, including affected workspaces),
`npm --prefix tools/mcp-server test` (MCP route coverage), applicable `test:serving*`, and staging checks as allocated
by the packet. Also re-run the full backend unit command where loopback binding is permitted. These operator duties
were **NOT RUN** by the builder; they are not failed builder checks. Typecheck uses existing dependency dist; no
fresh deployment build is claimed. Vitest transforms the edited source for local unit proofs.

Staging proof: receive a customer booking/cancellation/reminder mail and inspect its Reply-To with a configured
business address and with none; inspect the owner copy's customer Reply-To; inspect a weekly planner mail's absent
header. Check a deployed admin request has one separator, and unknown signed-in paths retain navigation while
signed-out paths return through login. No new deployed end-to-end automation was added: the narrow local tests
cover construction, routing and auth behavior; real transport and deployment remain operator checks.

Deploy backend mail code and admin assets through the existing process. Rollback: restore these code/assets from the
previous reviewed build; there is no stored-data change. Exit criterion: review and operator gates clear before
shipping; BUILT is not a claim of deployment, mailbox delivery, or a fully passing backend gate.

## References

`../../CLAUDE.md`, `../VISION.md`, `../ROADMAP.md`, `../documentation.md`, `../platform-decisions.md`,
`../testing-strategy.md`, `../frontend-patterns.md`, `../../admin/ARCHITECTURE.md`, `../../backend/ARCHITECTURE.md`,
`./sched-1.md` § 11 and § 25.

## Operator closeout (2026-11-26)

- Models: builder `gpt-6.1-sol`, reviewer `gpt-6.1-terra`; two review cycles. Review-0 found F1–F3 correct and in
  scope; both cycles stopped only because the builder's sandbox cannot bind a loopback port, so the full backend unit
  suite could not run there. That gate is **operator-executed** below, on the unchanged candidate.
- Operator gates (log read, exit codes bare): build, typecheck, shared, plugins, renderer, serving, serving bundle,
  admin unit, backend unit (full suite), infra, MCP, `git diff --check` — all 0.
- Staging diff, read before the deploy: no resource added or removed; functions change by code bundle only.
- Staging after the deploy:
  - F2: a signed-in walk of six admin pages made 41 API requests; none holds a double slash.
  - F3: `/scheduling/courses` and `/no-such-page-xyz` show "Page not found" inside the admin with the menu and a link
    that goes to the start page; signed out, an unknown address goes to `/login?next=<the address>`.
  - Appointments unchanged: the planner link walk and the scheduled job with the calendar feed pass.
  - F1 is proven by unit tests on the SES command input (rows R1–R4). Not observed on staging: the test mails go to
    the SES mailbox simulator, whose headers cannot be read.
- Operator oracle corrections: the first form of the request check selected requests by the wrong host and saw none
  (its control row failed, so no result was taken from it); requests are now selected by their API key header.
- Finding, present before this slice (F-ADMIN-FIRST-LOAD-400): in a new browser, right after sign-in and before a
  site is selected, the admin sends `GET /content` and `GET /system/invalidation` without `x-tenant-id`; both answer
  400 "Missing x-tenant-id header". No visible effect was seen; the requests are wasted. Not fixed here. Closed by
  `findings-1` Part 4 (`docs/slices/findings-1.md`).
