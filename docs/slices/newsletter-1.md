# NEWSLETTER-1 — a newsletter signup that stores the address and sends it to MailerLite

Status: **IMPLEMENTED 2026-11-27** — built, operator gates pending (sender = MailerLite, option A, ratified 2026-11-22; build ratified 2026-11-27; scope item 4 cut — see Build record). Track: growth. Depends: none.

## The problem

- The popup type `newsletter` (`packages/shared/src/index.ts:2333`) shows a headline, text and a link button. It
  has no field and stores nothing (`renderer/src/components/PopupManager.tsx:157-172`). **The name says more
  than the popup does.**
- Addresses are collected only by the lead-magnet block: `LeadMagnetRender.tsx:49` → renderer `/api/leads` →
  `POST /leads` → item `LEAD#<email>` (`backend/src/leads/create.ts:62-74`).
- Nothing sends a campaign. No third-party push exists; `integrations.mailerlite` is an unused boolean
  (`index.ts:581`). Leads leave the system as a CSV download (`admin/src/pages/Leads.tsx:41-57`).

## Decision NEWSLETTER-SENDER (the human's)

| Option | Reward | Risk |
|---|---|---|
| A. MailerLite sends the campaigns; AMODX collects the address and the consent and pushes the subscriber | campaign editor, unsubscribe, bounce and complaint handling exist there; small slice | a third party holds the list; a monthly cost above the free level; the client makes the account |
| B. Campaigns built in AMODX on SES | one system | a campaign editor, lists, unsubscribe, bounce and complaint handling to build; `docs/plan-email-onboarding.md` found one shared sender, no bounce capture, and one reputation for every tenant — a bad list harms every tenant's order mails |

Recommendation: A. SES stays the transport for transactional mail.

## Scope (under A)

1. Popup type `newsletter` and a `newsletter` block: an email field, a consent line (text from the locale
   table), the standard public path (origin check, reCAPTCHA). Stores a lead with `source: "newsletter"`, the
   consent text version and time.
2. Tenant settings: MailerLite API token (redacted on read, `backend/src/tenant/settings.ts:182-196`) and group
   id; the unused boolean is replaced by this object, absent = off.
3. Push: after the lead is stored, the subscriber goes to MailerLite. A failed push never fails the signup; the
   lead keeps `push: Pending | Sent(at) | Failed(reason, at)` and the admin Leads page has "Send again".
4. Checkout and course enrolment: an unticked "send me news" box that uses the same path.
5. Existing popups of type `newsletter` with no field keep working as link popups (no stored popup changes).

## Evidence taxonomy

No settings → the address is stored, no call out. Valid → one subscriber in the group. Same address twice → one
lead, no error shown. MailerLite refuses or times out → signup answers success, `Failed` recorded. Consent box
absent in the request → 400. Foreign origin or failed reCAPTCHA → 403, nothing stored.

## Non-scope

Campaign sending. Double opt-in mail from AMODX (MailerLite's own setting). Other providers (a port when a
second one is named). Unsubscribe sync back to AMODX (follow-up).

## Exit criterion

A signup on staging appears in a MailerLite test group with the consent recorded on the lead.

## Build record (2026-11-27, builder `claude-opus-5-5`, base `3ab1aac`; revision 1 after review-0)

### Scope as built

Items 1, 2, 3 and 5. **Item 4 is cut** (operator ruling 1): course enrolment is not in the product any more; the
"send me news" box at checkout is the follow-up `newsletter-2`, because it touches the order path.

### Corrected references (the specification's `file:line` are from 2026-11-20; these are at `3ab1aac`)

| Specification | At `3ab1aac` |
|---|---|
| `packages/shared/src/index.ts:2333` (popup type `newsletter`) | `packages/shared/src/index.ts:2490` |
| `renderer/src/components/PopupManager.tsx:157-172` | `:157-173` (the content box; the link button `:164-171`) |
| `LeadMagnetRender.tsx:49` | `packages/plugins/src/lead-magnet/LeadMagnetRender.tsx:49` (unchanged) |
| `backend/src/leads/create.ts:62-74` (the lead write) | `:63-75` (DIGITAL-FILE-GUARD-1 moved it; the resource rule follows at `:77-108`) |
| `index.ts:581` (`integrations.mailerlite` boolean) | `packages/shared/src/index.ts:635`, default object `:1362` |
| `admin/src/pages/Leads.tsx:41-57` (CSV) | `:41-58` |
| `backend/src/tenant/settings.ts:182-196` (redaction) | `redactSecrets` `:262-277`; the secret deep-merge of PUT `:418-433`; `GET /settings/secrets` in `settings-secrets.ts` |

### MailerLite contract (ruling 6; read 2026-11-27 from the published documentation)

Sources: <https://developers.mailerlite.com/docs/subscribers.html> ("Create/upsert subscriber") and
<https://developers.mailerlite.com/docs/> (authentication, versioning, validation errors, rate limits).

- Endpoint: `POST https://connect.mailerlite.com/api/subscribers`. It is an upsert: "If a subscriber already exists, it
  will be updated with new values. This is non-destructive operation, so omitting fields or groups will not remove them".
- Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`, `Accept: application/json`;
  `X-Version: 2026-11-27` (the documented way to lock the API version: "the current date at the time of implementation").
- Body sent: `{ "email": <address>, "groups": [<groupId>] }`. Groups are only added by this call. Not sent: status (new
  subscribers are `active`, or `unconfirmed` under MailerLite's own double opt-in), IP address, `resubscribe`.
- Answers relied on: **201** created and **200** already in the list → `Sent`; **422** `{ message, errors }` (invalid
  data — an invalid address; also a person who unsubscribed in MailerLite earlier, because `resubscribe` is not sent:
  AMODX never reverses an unsubscribe made there); **401** `{"message":"Unauthenticated."}` (wrong token); **429** "Too
  Many Attempts." (120 requests per minute). Every answer except 200/201 → `Failed({ kind: "http", status })`.
- Not in the documentation: a timeout value; whether this endpoint takes `Idempotency-Key` (not used); an explicit
  type for group ids (every example is a string → `groupId` is a string).
- One `fetch` in one module (`backend/src/lib/mailerlite.ts`), no SDK, no provider interface. The answer's body is never
  read (it can repeat the address).

### Design decisions (as of revision 1)

- **Where consent lives (ruling NL1-CONSENT-STORAGE = A, operator 2026-11-27; amends ruling 3's "the stored lead holds"
  to "the subscription item holds").** The item `NEWSLETTER#<normalizeEmail(email)>` in the tenant partition holds
  `{ consent, push }`. Three handlers replace the whole lead item with `PutCommand`: the lead magnet
  (`backend/src/leads/create.ts:80`, the `PutCommand` that `digital-file-guard-1.test.ts:74` counts), `contact/send.ts:95-110`
  and `comments/create.ts:66-90` (inside a `TransactWriteCommand`). Consent stored on the lead would be erased by the
  person's next download, message or comment; none of the three is changed.
- **Signup = ONE transaction** (`leads/newsletter.ts:150`): the subscription `Put` and, for the lead, a `Put` conditional on
  `attribute_not_exists(SK)` when the read found no lead, or a `ConditionCheck` on `attribute_exists(SK)` when it found
  one (`leadPart`, `:96`) — an existing lead is never written, not even an added attribute. The answer is success only
  after the transaction committed. **After a cancelled transaction (finding NL1-R5)** the subscription is re-read
  (`:161`): a durable subscription with the same text, or with a consent newer than the one this request read, answers
  success; otherwise the transaction is retried ONCE (`SIGNUP_TRIES` = 2, `:93`); a second cancellation answers 503
  "The signup was not stored. Please try again." (`:164`) — never 201 with nothing stored.
- **Consent evidence (ruling 3, finding NL1-R3): the exact text, plus the locale the browser drew it in.** The text is
  stored itself, not a version id: the owner can edit the line and no store of past texts exists. The browser sends
  `consentText` and `consentLocale` (`NewsletterForm.tsx:45`; `newsletterTexts` carries `locale`); the backend accepts the
  request only when the PAIR is a line a page of the tenant shows now (`shownConsentLines`, `:70`; match on both at
  `:124`) — the default language with the tenant's overrides, each extra language's pack (LANG-1 § 8.2). The locale is
  never inferred from the text. Otherwise 409, nothing stored. Stored: `consent = { id, at, locale, text }`.
- **Newness and push ownership (ruling 12, finding NL1-R2): fenced by ids never reused, not by time.** Each stored consent
  has a random `id`; each push attempt a random `attempt` id, carried by `Pending`, `Sent` and `Failed`. The rule:
  (1) the same text as the stored consent → the stored consent stays and nothing is sent; (2) a different text replaces
  it only while the stored consent is still the one the request read — the write is conditional on `consent.id`
  (`:147`), or on the item's absence; a request that lost settles as NL1-R5 above; (3) a push result is
  written only while the stored item still holds the consent id AND the attempt id that produced it (`:230`); otherwise
  the write does not apply; (4) "Send again" first CLAIMS a new attempt with a write conditional on the consent id and the
  attempt it read (`leads/push.ts:63-65`); a concurrent claim fails → 409, nothing sent. `at` is evidence only.
- **The bound (ruling 5, finding NL1-R4; ruling NL1-WRITE-ACK-UNCERTAINTY = A): 4 s.** `POST_STORE_DEADLINE_MS` = 4,000 ms
  (`:50`) is the longest time between the committed signup transaction and the answer. It is enforced by a timer that
  RACES the whole post-store work (`pushWithinDeadline`, `:189`, race at `:203`) — outside every SDK call, so the SDK's
  retries and backoff cannot extend it — and its expiry also aborts the MailerLite call (`mailerlite.ts:50`, itself
  capped at 3 s) and the result write (`abortSignal`, `:233`). Proven through the real SDK with throttling and backoff
  (`newsletter-1-deadline-sdk.test.ts`: control without the race 4,900 ms; contract 4,012 ms after the transaction).
  Existing asynchronous mechanisms checked and not used: the EventBridge bus (`backend/src/lib/events.ts:28`) has one
  rule, for `AUDIT_LOG` (`infra/lib/events.ts:24`); the async Lambda invoke (`backend/src/lib/invalidate-cdn.ts:99`)
  serves only the CDN flusher — both need new infrastructure.
- **What a push attempt knows (NL1-WRITE-ACK-UNCERTAINTY = A, finding NL1-R7).** The outcome of the result write is one
  of exactly two words: `recorded` (the conditional write was acknowledged) or `unconfirmed` (no acknowledgement — the
  deadline came first, the write failed or was not sent, or its condition found a newer consent or attempt; whether it
  committed is not known to this request). A client cannot know that a dispatched write did not commit, so no outcome
  claims "not recorded", and cancellation is not rollback. The STORED push state is the only truth: the Leads page reads
  it (and reloads after Send again, `Leads.tsx:77`); a later read may show `Pending` ("Pending: no MailerLite result is
  stored — use Send again", `Leads.tsx:18`), `Sent` or `Failed` — each correct. Send again is offered for `Pending` and
  `Failed` (and for `NoSettings`); on a subscriber MailerLite already holds it is harmless (an upsert). Code:
  `PushOutcome = { attempted?, resultWrite }`; Send again answers `{ push?, resultWrite }`; its audit event holds
  `{ mailerliteAnswer, resultWrite }`.
- **One lead identity: the normalized address (finding NL1-R8).** The subscription `NEWSLETTER#<n>` exists only
  together with the lead `LEAD#<n>` (`n` = `normalizeEmail(address)`), which the signup creates in the same transaction
  when absent. Deleting `LEAD#<n>` deletes both in one transaction; deleting a lead item whose stored key is another
  spelling of the address deletes that item only (`leads/delete.ts:34`). The Leads list shows the subscription on the
  normalized row only (`leads/list.ts:56`). Other spellings are separate stored items: not read, merged, copied or
  rewritten here; merging them is the persisted-key backfill F-FND2-1 (`docs/ROADMAP.md`, this item kind added to its
  note). **A tenant holding such an item sees two rows for that person until F-FND2-1 runs.** Verified premise: the
  ruling expected every lead writer since `fnd-2` to write the normalized key; on the code NONE does —
  `leads/create.ts:84` writes `LEAD#${input.email}`, `contact/send.ts:39,99` trims only, `comments/create.ts:68` writes
  the raw `authorEmail`; `fnd-2` (`docs/ROADMAP.md:121`) migrated 14 customer-email call sites, not these. So the two
  rows also arise for NEW items whenever an address reaches those writers in another spelling (typically letter case).
  Reported as a decision; the rules above hold either way (invariant tested after every test).
- **Value-free rule (ruling 7, finding NL1-R1),** `backend/src/lib/value-free.ts`: the handlers that receive an address or
  the token — `POST /leads`, `GET /leads`, `DELETE /leads/{email}`, `POST /leads/{email}/push`, `GET/PUT /settings`,
  `GET /settings/secrets` — answer a malformed body with a fixed 400 (`create.ts:31`, `settings.ts:409`) and an
  unexpected error with a fixed 500, logging the handler and the error's NAME only (`create.ts:137`, `settings.ts:338`,
  `:590`). The renderer proxy `/api/leads` answers its catch with a fixed text (`route.ts:77`). The token stays
  write-only (`redactSecrets`; `GET /settings/secrets` never returns it; `mailerLiteSave` keeps a stored token when none is
  sent); `mapTenant` never maps `integrations.mailerlite`.
- **Leads list (finding NL1-R6):** the leads query has a projection (`list.ts:29`; the answer no longer carries
  `PK`, `SK`, `Type`); every `NEWSLETTER#` page is read (`:53`), and each returned lead gets its subscription by the
  normalized address. The leads query still reads one page (an older, separate limit).
- **Retired boolean (ruling 8):** `IntegrationsSchema.mailerlite = preprocess(boolean → absent, settings.optional())`.
- **Public path (ruling 9):** unchanged route; the newsletter branch is after the origin check and reCAPTCHA and before
  the lead-magnet write and the resource lookup — never a download link.
- **Send again (ruling 10):** one new route, `POST /leads/{email}/push`, in the `EngagementApi` nested stack (the parent
  template is near CloudFormation's 500-resource limit). Refused for `Sent`, without settings, without a subscription, or
  when the claim is lost. Not open to service keys.
- **Popups (scope item 5, ruling 11):** `PopupSchema.collectEmail`; the texts come from `GET /public/popups` only when an
  opted-in newsletter popup is active, so no page of any other tenant changes.

Abstractions introduced (one line each):
- `NewsletterForm` (plugins, package entry `@amodx/plugins/newsletter/NewsletterForm`) — users: `NewsletterRender`, renderer `PopupManager`; axis: none beyond two callers sharing a non-trivial submit; rejected: a copy in `PopupManager`.
- `newsletterTexts` (shared) — users: renderer `prepareBlocks`, backend `GET /public/popups`, backend signup check; axis: none (one rule for the line shown and the line checked); rejected: three copies.
- `newsletterCanSendAgain` (shared) — users: `leads/push.ts`, admin Leads page; axis: variants fixed, exhaustive match; rejected: the rule twice.
- `value-free.ts` (backend lib: `errorName`, `parseJsonObject`, fixed answers) — users: 8 handlers + `newsletter.ts`; axis: none (one rule); rejected: inline copies.
- `MailerLiteCard` (exported component, admin Settings) — users: the Settings page; the byte-preservation test renders it to remove exactly its markup (a test seam); rejected: inline JSX.
- No provider interface, no queue, no new package.

### Revision 1 — one row per review-0 finding

| Finding | What changed (`file:line`) | Proving test |
|---|---|---|
| NL1-R1 values in diagnostics | `backend/src/lib/value-free.ts` (new); `leads/create.ts:31,71,137`; `leads/list.ts`, `leads/delete.ts`, `leads/push.ts` catches; `tenant/settings.ts:338,409,590`; `settings-secrets.ts` catch; `renderer/src/app/api/leads/route.ts:77`. Rule: a malformed body → fixed 400; an error → its name in the log, a fixed 500 — for every handler that receives an address or the token | backend `newsletter-1.test.ts` "NL1-R1: malformed bodies and errors BEFORE the newsletter dispatch…" and "no log line, error answer, audit event or admin answer holds the token…"; renderer `newsletter-1-boundaries.test.ts` (proxy); `public-harden-1-errors.test.ts` (POST /leads row: one name-only line, no address) |
| Storage = A, condition 1 (one transaction) | `leads/newsletter.ts:84-161` | backend "Storage A — …": "no lead yet → ONE transaction…", "an existing lead is NOT written…", "the lead is deleted between the read and the transaction…", "the transaction fails (throttled) → 500, NEITHER…" |
| Storage = A, condition 2 (erase paths) | `leads/delete.ts:31` one transaction; inventory below | backend "deleting the lead is ONE transaction…; a failed transaction removes neither"; `tenant-binding.test.ts` (both keys in the bound partition) |
| Storage = A, condition 3 (key lists, renderer) | `docs/database-patterns.md`, `docs/architecture-deep -dive.md`, `docs/plan-commerce-private-table.md`, `docs/slices/cmrc-1.md` (P3) | renderer `newsletter-1-boundaries.test.ts` "no file under renderer/ … contains the key prefix" |
| NL1-R2 / condition 4 (fencing) | consent `id` + push `attempt` (shared `index.ts` schemas); `newsletter.ts:138,194`; `push.ts:63-65` | backend "Ruling 12 / finding NL1-R2 …": reversed completion order; equal timestamps (fake clock); concurrent Send again (200 + 409, one MailerLite call) |
| NL1-R3 (locale) | `newsletterTexts.locale` (shared); `NewsletterForm.tsx:45`; `newsletter.ts:115` | backend "the SAME text in two locales…", "an extra language (LANG-1)…"; renderer client test (body holds `consentLocale`) |
| NL1-R4 (bound) | `POST_STORE_DEADLINE_MS` `newsletter.ts:42`; `mailerlite.ts:50`; `newsletter.ts:197` | backend "MailerLite answers at once but the result write is slow…" (answer at 4 s, Pending, then Send again → Sent), "MailerLite hangs AND the result write is slow…" |
| NL1-R5 (durability) | as condition 1 and 2 | as condition 1 and 2 |
| NL1-R6 / condition 5 (list) | `leads/list.ts:29,40-53` | backend "Finding NL1-R6 — …": a subscription on a later page (pages of one item); the leads query has a projection |
| NL1-R7 (docs) | `packages/plugins/ARCHITECTURE.md` (23 plugins); `packages/shared/ARCHITECTURE.md`; `renderer/ARCHITECTURE.md`; `backend/ARCHITECTURE.md`; this record; `pushAndRecord` → `{ attempted, recorded }` | — (documentation) |

### Revision 2 — one row per review-1 correction (operator rulings 2026-11-27)

| Correction | What changed (`file:line`) | Proving test |
|---|---|---|
| 1. NL1-R4 — bound outside the SDK | `pushWithinDeadline` `leads/newsletter.ts:189-207` (timer race; expiry aborts the I/O); signup and Send again use it (`:169`, `leads/push.ts:79`) | `backend/test/unit/newsletter-1-deadline-sdk.test.ts` (real SDK, throttling + backoff): control without the race 4,900 ms; contract 4,012 ms after the committed transaction. In-memory: "MailerLite answers at once but the result write is held…", "MailerLite hangs AND the result write is held…" |
| 2. NL1-R5 — no success without durable storage | re-read after a cancellation, one retry, then 503 — `newsletter.ts:157-165` | "both items are deleted (through DELETE /leads/{email}) just before a changed-consent transaction…" (retried → stored); "a conflicting subscription appears before EVERY try…" (503, nothing stored); "the subscription changed meanwhile to the SAME text…" (success, no second write) |
| 3. NL1-R7 / NL1-WRITE-ACK-UNCERTAINTY = A — truthful words | `ResultWrite = "recorded" \| "unconfirmed"`, `PushOutcome = { attempted?, resultWrite }` (`newsletter.ts`); Send again answer `{ push?, resultWrite }` and audit `{ mailerliteAnswer, resultWrite }` (`push.ts`); shared `Pending` comment; admin `Leads.tsx:18`; this record, `block-types.md`, `backend/ARCHITECTURE.md` | "COMMITTED but the acknowledgement is lost → … `unconfirmed` …; the stored state is Sent"; "a DELAYED commit (after the client gave up) → … `unconfirmed` … with Pending stored; … a later read shows Sent" |
| 4. NL1-R8 — one lead identity | `leads/delete.ts:34` (normalized → transaction of both; other spelling → that item only); `leads/list.ts:56` (normalized row only); signup unchanged (already `LEAD#<n>` + `NEWSLETTER#<n>`); ROADMAP F-FND2-1 note | "Finding NL1-R8 — …" (5 tests: a legacy spelling before and after the signup, deleting each of the two items, normalization equivalents); the invariant "a subscription never exists without its normalized lead" is asserted after EVERY test of the file (`afterEach`) |

### Paths that delete or export a lead or a tenant's personal data (condition 2)

Search: `git grep "LEAD#"` over `backend/src`, `renderer/src`, `admin/src`, `tools/mcp-server/src`, `infra/lib`, `scripts`;
`git grep -l "DeleteCommand|BatchWriteCommand|DeleteRequest"` over `backend/src`; `git grep -i "erase|deleteTenant|purgeTenant|exportData"`.
- Admin `DELETE /leads/{email}` (`leads/delete.ts`): the normalized lead → it and the subscription in one transaction;
  a lead under another spelling → that item only (NL1-R8). Corrected.
- MCP `delete_lead` (`tools/mcp-server/src/index.ts:2250`): calls that admin route → the same transaction.
- Admin CSV export (`admin/src/pages/Leads.tsx` `exportCsv`): reads the loaded list; writes no item; does not export the
  subscription (no consent columns; debt below).
- Tenant deletion: no route, handler or script exists (`backend/src/tenant/` holds create, list, settings only).
- Erase jobs: `scheduling/admin/customers-erase.ts` erases scheduling customers in the scheduling-private table; it does
  not touch `LEAD#` (searched). No other erase or cleanup job reads `LEAD#`.
- Other writers (`contact/send.ts`, `comments/create.ts`, the lead magnet) `Put` the lead and never delete; they cannot
  orphan a subscription. No path leaves a subscription without its lead.

Key-kind lists updated (condition 3): `docs/database-patterns.md` table, `docs/architecture-deep -dive.md` key diagram,
`docs/plan-commerce-private-table.md` "not moved" list, `docs/slices/cmrc-1.md` P3 row. No key-registry or key-ownership
test exists (searched for prefix lists and registry names in tests).

### Default renderer suite timing (operator ruling; test configuration unchanged)

Isolated worktree of the base `3ab1aac` (`/tmp/NEWSLETTER-1-base`, its own `@amodx` links and built packages; removed after),
`npx vitest run`, alternating with this candidate. All six runs passed.

| Round | Base: load / A1 / tests / duration | Candidate: load / A1 / tests / duration |
|---|---|---|
| 1 | 9.37 / 1,584 ms / 929 / 7.58 s | 9.19 / 2,882 ms / 940 / 6.48 s |
| 2 | 10.62 / 3,232 ms / 929 / 7.66 s | 15.21 / 3,645 ms / 940 / 7.82 s |
| 3 | 27.11 / 2,637 ms / 929 / 6.69 s | 19.37 / 3,113 ms / 940 / 6.93 s |

Result: the suite's duration does not change measurably. The `landing-1-expectations` A1 test takes 0.4–1.3 s longer
in each pair: the slice's new test files run in parallel with it. The build-0 timeout (A1 over the 5 s default) came
at a load average of 84 on 10 cores, where A1 also failed without the new files (5,012 ms). At such load the base is at
the limit too; this slice adds to the contention but did not create the limit.

### Evidence (every row bound to a test; EXECUTED on the fresh build of revision 1)

| Row | Test (`backend/test/unit/newsletter-1.test.ts` unless named) |
|---|---|
| ET1 no settings → stored, no call out | "ET1 no settings" |
| ET2 valid → one subscriber in the group (the documented call) | "ET2 valid settings" |
| ET3 same address twice → one lead, no error (also with another case and spaces) | "ET3 same address twice" |
| ET4 MailerLite refuses (422, 401, 429, 500, no connection) or times out → success, `Failed` | "ET4 …" (6 tests) |
| ET5 consent absent → 400, nothing stored, nothing sent | "ET5" |
| ET6 foreign origin / failed reCAPTCHA → 403, nothing stored | "ET6" (real `tenant-verify.ts`, `recaptcha.ts`) |
| Ruling 3 consent evidence (id, time, locale, exact text; de pack; same text in two locales; extra language; 409) | "Ruling 3 / finding NL1-R3 …" (4); shared `packages/shared/test/newsletter-1.test.ts` "NL-R3" (every pack) |
| Ruling 4 push sum type (attempt ids) | shared "NL-R4"; "Ruling 4 …"; admin `Leads.newsletter-1.test.ts`; exhaustiveness by `tsc` (`npm run typecheck`) |
| Ruling 5 bound (4 s after the committed transaction; `recorded` / `unconfirmed`; stored state is the truth) | `newsletter-1-deadline-sdk.test.ts` (2, real SDK); "Ruling 5 / NL1-R4 / NL1-WRITE-ACK-UNCERTAINTY = A …" (5); "ET4 … does not answer" |
| Ruling 7 token and address secret (sentinels; malformed bodies; errors before dispatch) | "Ruling 7 / finding NL1-R1 …" (3); renderer `newsletter-1-map-tenant.test.ts`, `newsletter-1-boundaries.test.ts`; serving row `(newsletter-1-page)` |
| Ruling 8 stored boolean `true` / `false` (absent = off) | shared "NL-R8" (stored-shape fixtures); "Ruling 8 …" |
| Ruling 9 no download link via newsletter; lead-magnet unchanged | "Ruling 9 …"; `digital-file-guard-1.test.ts` passes untouched |
| Ruling 10 Send again (claim, recorded, refusals) | "Ruling 10 …" (3); infra `(newsletter-1)` |
| Ruling 11 existing popups and pages unchanged | renderer `newsletter-1-client.test.ts` (popup rows); `npm run test:serving` and `npm run test:serving-bundle` with no baseline change |
| Ruling 12 both orders, reversed completion, equal timestamps, concurrent retries; lead-magnet lead keeps its fields | "Ruling 12 / finding NL1-R2 …" (6) |
| Storage conditions 1–3, 5 | "Storage A — …" (5); "Finding NL1-R6 — …" (2); renderer `newsletter-1-boundaries.test.ts` |
| NL1-R5 (no success without durable storage) | "Finding NL1-R5 — …" (3) |
| NL1-R8 (one lead identity; subscription never without its normalized lead) | "Finding NL1-R8 — …" (5); `afterEach` invariant over every test |

### Gates (revision 2)

EXECUTED on the fresh build, 2026-11-27, load average about 8–10 on 10 cores: `npm run build` exit 0; `npm run
typecheck` exit 0 (0 errors); `npm --prefix backend run test:unit` 88 files, 2294 pass (2 skipped); `cd admin && npm run
test:unit` 28 files, 460; `cd packages/plugins && npm test` 13 files, 360; `cd packages/shared && npx vitest run` 31
files, 608; `cd renderer && npm test` exit 0, 64 files, 940; `npm run test:serving` 175/175 (no baseline file changed);
`npm run test:serving-bundle` 61/61; `cd infra && npm test` 90; `cd tools/mcp-server && npm test` route coverage + 17/17;
`git diff --check` clean.

Existing tests changed (each because this slice changes what it pinned; names say what they prove): shared
`lang-1a.test.ts` L1A-PRESERVE-RECORDS and `scheduling.test.ts` PARSED_AT_HEAD (the captures stay; the retired
`mailerlite: false` default is removed explicitly), `schemas.test.ts`, `locale-strings.test.ts` (allocation +6),
`shop-look-1a.test.ts` (`navCategoryBarLabel` follows the block keys); backend `tenant-binding.test.ts` and
`service-key-routes.test.ts` (rule: EVERY item an authorised request addresses — a transaction's items included — is in
the bound partition), `public-harden-1-errors.test.ts` (the POST /leads row: one name-only log line, never the address —
finding NL1-R1; the other rows unchanged); plugins `renderLoaders.test.ts` (22 → 23); admin `Labels.test.ts` (+6 site
keys), `Settings.test.ts` (render helper `renderSettingsWithoutLaterCards` also removes the MailerLite card, exactly once,
before the Research card).

### Live proof: NOT VERIFIED

No MailerLite account or group was available. The operator runs, on staging after deploy:
1. MailerLite → Integrations → API: create a token. Subscribers → Groups: create a test group; note its id.
2. Admin → Settings → "Newsletter (MailerLite)": enter the group id and the token; Save. Reload: the token field is
   empty with "A token is stored…"; the browser's network tab shows no token in `GET /settings` or `/settings/secrets`.
3. Add a "Newsletter Signup" block to a page (or a popup of type Newsletter with "Collect email addresses"); publish.
4. On the public page, in a real browser: type a test address, tick the box, Subscribe → the thanks text.
5. Admin → Leads: the address with "Consent <time> (<locale>)", the consent line on hover, and "Sent to MailerLite".
   MailerLite → the group holds the address.
6. Same address again → thanks; still one lead; the consent time unchanged.
7. Settings: change the token to a wrong one; sign up a second address → thanks; Leads shows "Failed: MailerLite
   refused the API token (401)" and "Send again". Fix the token; Send again → "Sent".
8. Delete the second lead on the Leads page; in the DynamoDB console the tenant partition holds neither its `LEAD#` nor
   its `NEWSLETTER#` item.

### Findings and deferred debt (not fixed here; outside the slice)

- MCP `create_lead` with `source: "newsletter"` now answers 400 "Consent is required." (a tool cannot give a person's
  consent). Before, it stored a lead with that source. The tool is unchanged.
- `admin/src/pages/PopupEditor.tsx` edits `imageUrl`; `PopupSchema` names the field `imageLink`, so a popup image is
  never saved. Name mismatch; rename proposed, not applied.
- The `form` block's `_form.strings` use the tenant's default language, not the page's language (LANG-1B).
- `GET /leads` reads one page of leads (1 MB); since revision 1 every subscription page is read for the returned leads.
- Not synced back: an unsubscribe in MailerLite; deleting a lead in AMODX does not remove the MailerLite subscriber.
- The CSV export of the Leads page has no consent columns.
- The lead magnet, the contact form and comments write `LEAD#<email as typed>` (not normalized; see the NL1-R8 bullet
  above): a person reaching them in another spelling has a second row, without the subscription, until those writers
  are migrated and F-FND2-1 merges the stored items. Decision requested in the build report (NL1-LEAD-WRITERS).

## Operator closeout 2026-11-27 — SHIPPED on staging; production deploy pending; live delivery to MailerLite NOT VERIFIED

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, three cycles. Review-2 found every implementation finding closed
and left one authority decision; the operator ruled on it and closed out (no fourth cycle).

Operator rulings (they amend the specification and the packet):

- **Scope item 4 cut** (the "send me news" box at checkout and at course enrolment): follow-up `newsletter-2`.
- **NL1-CONSENT-STORAGE = A.** Consent and push state live in `NEWSLETTER#<normalized address>`, beside the lead;
  written and deleted with it in one transaction.
- **NL1-WRITE-ACK-UNCERTAINTY = A.** The visitor is answered at most 4 seconds after the durable signup write. The
  result write is `recorded` or `unconfirmed`; the stored push state is the only truth; "Send again" is offered for
  `Pending` and `Failed`.
- **NL1-R8, lead identity = the normalized address.** A subscription exists only together with `LEAD#<normalized>`.
- **NL1-LEAD-WRITERS = A.** The premise of the previous ruling was wrong: three current writers store a lead under
  the address as typed (`leads/create.ts`, `contact/send.ts`, `comments/create.ts`), so two spellings of one address
  still make two lead rows, for new submissions too. Accepted for this slice: the subscription and its lead are
  always under the normalized address, so consent evidence is never split or lost. Follow-up `lead-normalize-1`
  (ROADMAP): those three writers store the normalized key; the merge of stored items stays F-FND2-1.

Operator-executed on the final tree:

| Check | Result |
|---|---|
| Gates: build, typecheck, shared, plugins, renderer unit, serving, serving bundle, admin unit, backend unit, infra, MCP, `git diff --check` | every exit 0. The operator's manifest oracle flagged `packages/plugins/package.json`: the change is one export entry (`./newsletter/NewsletterForm`, used by the block and by the renderer's popup), no dependency; accepted |
| Staging diff, read before the deploy | new: `PushLeadFunc` with its role, log group, route `POST /leads/{email}/push`, read/write on the main table, `events:PutEvents`; the rest is rebuilt code; no resource replaced |
| Staging, real browser, a page with the block on `cm1-content` | headline, email field, consent box and button shown; consent line "Yes, send me the newsletter by email. I can unsubscribe at any time."; nothing is sent without the box; with the box the form sends the address, `source: "newsletter"`, that exact line, `consentLocale: "en-US"`, and shows the thanks text |
| Public signup from the scripted browser | 403 "Verification failed due to low score." — reCAPTCHA is mandatory on the deployment and refuses a scripted browser; nothing stored. **The signup write through the public route is therefore not proven on staging** (unit tests only) |
| A subscription written to the staging table in the stored shape (operator write), state `Pending` | `GET /leads` shows the lead with the consent text, locale and `Pending` |
| "Send again", site not connected | 409 "MailerLite is not connected…"; the state stays `Pending` |
| Settings with an invented token | saved; `PUT /settings`, `GET /settings`, `GET /settings/secrets` and the public page bytes do not hold the token |
| "Send again" with the invented token | the call reaches MailerLite; its refusal is stored: `Failed`, `http 401`; the answer holds no token; a second "Send again" stores a new attempt identity |
| Delete the lead | the lead item and the subscription item are both gone |
| Disconnect (`mailerlite: null`) and cleanup | the connection is removed; the run's page, routes and audit items deleted (one audit item arrived after the script's own comparison and was deleted by hand) |

Not verified: a successful delivery into a MailerLite group (no account; the steps are in "Live proof" above); the
signup write through the public route on a deployed system (reCAPTCHA); the popup's field on staging (unit and
serving tests only).
