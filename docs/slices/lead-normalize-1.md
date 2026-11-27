# LEAD-NORMALIZE-1 — every lead writer stores the lead under the normalized address

> Ratified by the operator ruling NL1-LEAD-WRITERS = A (`docs/slices/newsletter-1.md` § "Operator closeout 2026-11-27")
> and the human's order of work of 2026-11-27 (`docs/ROADMAP.md` § "Order of work from 2026-11-27"). No draft existed;
> this file was written by the builder from the operator packet. It surfaces no new ratification-class decision.

Status: **IMPLEMENTED 2026-11-27 — built, operator gates pending** (staging deploy and staging check are the
operator's). Track: lead identity (follow-up of `newsletter-1`). Depends: `fnd-1` (`normalizeEmail`), `newsletter-1`.
Maturity target: PROTOTYPE (no change of maturity: the lead writers stay PROTOTYPE).

## Purpose / risk retired

One person, one lead row. Before this slice the newsletter wrote `LEAD#<normalizeEmail(email)>` and three other writers
wrote `LEAD#<email as typed>`: the lead magnet (`backend/src/leads/create.ts`), the contact form
(`backend/src/contact/send.ts`, trim only) and comments (`backend/src/comments/create.ts`). `Ana@Example.com` in the
contact form and `ana@example.com` in the newsletter made two rows, and the owner saw the subscription on one of them
only.

The real risk of the change: with one key, a writer now meets rows that other writers made. Before, the three writers
replaced the whole item (§ "Before-table"). Under one key that replace would erase the newsletter's lead fields and the
owner's status. This slice changes the write so that a later submission never removes or changes a stored value.

## Scope

1. The three writers build the lead key with `normalizeEmail()`. The stored `email` attribute follows ONE rule for all
   four writers (§ "The email rule").
2. Invalid address: each handler keeps its existing answer, now applied to the normalized form. No new error shape.
3. The overwrite: the three writers use one write, `createOrFillLead` (`backend/src/lib/lead-write.ts`), that creates
   the lead when absent and on an existing lead adds only the attributes it lacks.
4. Readers (`leads/list.ts`, `leads/delete.ts`, `leads/push.ts`, admin `Leads.tsx`) work for a row stored before this
   slice under the typed spelling and for a row stored after it. No reader logic changes (`leads/delete.ts` gets one
   comment change).

## Non-scope

- Merging or rewriting stored items. **Finding F-FND2-1 stays open**: a row stored before this slice under a typed
  spelling (`LEAD#Ana@Example.com`) stays a separate row next to `LEAD#ana@example.com` until a data slice merges them.
- Any change to `normalizeEmail`. Renderer, infra, the newsletter writer's own logic (`leads/newsletter.ts`).
- The comment item (`COMMENT#…`): it keeps `authorEmail` as sent (only its lead changes).

## The email rule (scope 1)

**The stored `email` of a lead is the suffix of its key: `email = normalizeEmail(input)` and `SK = LEAD#<email>`.**

Why this rule (OBSERVED from code on `3ec1047`):

- The writers of `LEAD#` items are four: `leads/create.ts` (lead magnet), `contact/send.ts`, `comments/create.ts` and
  `leads/newsletter.ts`; `leads/delete.ts` deletes. Basis: text search for `LEAD#` over `backend/src`, `renderer/src`,
  `admin/src`, `tools/mcp-server/src`, `packages/shared/src`, `infra/lib` (a deterministic text search, not a call
  graph). "Every writer", "the four writers" and "no writer" in this document mean these four.

- The newsletter writer stores `email: address`, the normalized address (`leads/newsletter.ts:103`).
- The admin Leads page sends `lead.email` back as the path of `DELETE /leads/{email}` and `POST /leads/{email}/push`
  (`admin/src/pages/Leads.tsx:76,88`). `leads/delete.ts:33` builds `LEAD#<path email>`. So a row is deletable from the
  page only when its stored `email` equals its key suffix.
- `leads/list.ts:56` shows a subscription only on a row whose `email` equals its own normalized form.
- Every writer before this slice stored `email` equal to its key suffix (the typed spelling for the three writers),
  so old rows also satisfy "`email` = key suffix". The page therefore deletes old and new rows alike.

## Invalid address (scope 2)

`normalizeEmail` refuses no input: "it never throws or rejects — garbage in, canonical garbage out"
(`packages/shared/src/normalizeEmail.ts:94-98`). The handler's own check therefore decides, and PD-001's ordering rule
says the check runs on the normalized form. What each handler does today, kept as is:

| Writer | Check (before = after, except it now reads the normalized form) | Answer to an invalid address | Written |
|---|---|---|---|
| lead magnet `leads/create.ts` | `LeadSchema` `email: z.string().email()` (`.parse`, throws) | 500 `{"error":"Internal error"}` (the catch, `INTERNAL_ERROR`) | nothing |
| comments `comments/create.ts` | `CommentSchema` `authorEmail: z.string().email()` (`.parse`, throws) | 500 `{"error":<Zod message>}` (the catch) | nothing (comment nor lead) |
| contact form `contact/send.ts` | none. The address goes to SES as `ReplyToAddresses` before the lead write | what SES answers: a refusal throws → 500 `{"error":"Internal error"}` | nothing when SES refuses; when SES accepts, the lead is written (unchanged; finding LN1-F2) |

A consequence of the ordering rule: an address with spaces around a valid address (`Ana@Example.com `) was refused
by the lead magnet and comments before (raw `z.email()` refuses the trailing space → 500; capitals alone were already
accepted, EXECUTED with the repo's `zod`); it is accepted now, because its normalized form is valid. This is the evidence row "`Ana@Example.com ` through each of the three writers".

## Before-table (scope 3) — what each write did to an existing row (read on `3ec1047`)

| Writer | Write before | An existing `LEAD#<same key>` before | Write after | An existing lead after |
|---|---|---|---|---|
| lead magnet `leads/create.ts:80-93` | plain `Put`, no condition: `id` (new), `tenantId`, `email`, `name`, `source`, `data`, `status: "New"`, `createdAt: now`, `Type` | REPLACED: `createdAt`, first `source`, the owner's `status` (reset to `New`), `id`, `name` and `data` lost when absent or different in the new request | `UpdateCommand(createOrFillLead(...))` | nothing changes; absent attributes are added |
| contact form `contact/send.ts:95-110` | plain `Put`, no condition: `id` (new), `tenantId`, `email`, `name`, `source: tags \|\| "contact-form"`, `status: "New"`, `data: { message }`, `createdAt: now`, `Type` | REPLACED, same losses | `UpdateCommand(createOrFillLead(...))` | same |
| comments `comments/create.ts:64-100` | `TransactWrite`: `Put` of the comment + `Put` of the lead, no condition: `id` (new), `tenantId`, `email`, `name`, `source: "Comment"`, `status: "New"`, `createdAt: now`, `Type` | REPLACED, same losses | `TransactWrite`: `Put` of the comment + `{ Update: createOrFillLead(...) }` | same |
| newsletter `leads/newsletter.ts:96-109` (not changed) | `Put` conditional on `attribute_not_exists(SK)` when absent; `ConditionCheck attribute_exists(SK)` when present | never written | unchanged | unchanged |

Under the typed keys, the three writers met each other's rows only for the identical spelling, and never met the
newsletter's normalized row unless the address was typed in normalized form. Under one key they meet every row.

The `NEWSLETTER#<n>` item: none of the three writers names it, before or after (their only key is `LEAD#…`).

## The write after: `createOrFillLead` (`backend/src/lib/lead-write.ts`)

One `UpdateItem` on `TENANT#<x-tenant-id>` / `LEAD#<normalizeEmail(email)>`. Every assignment is
`#a = if_not_exists(#a, :a)`, over `id`, `tenantId`, `email`, `name`, `source`, `status` (`New`), `data`, `createdAt`,
`Type` (`Lead`); undefined values are left out. Under the hood: DynamoDB `UpdateItem` creates the item when no item has
the key, and `if_not_exists(path, value)` evaluates to the stored value when the attribute exists — so on an existing
item each assignment writes back what is there. Result:

- no lead → created with the same attribute set the old `Put` wrote; only the key and `email` are now the normalized
  address;
- an existing lead → no stored value changes: first `createdAt`, first `source`, the owner's `status`, `id`, `name`,
  `data`. An attribute the row lacks is added (example: the newsletter's lead has no `name`; a later contact message
  adds it).

Rule (one rule, the four capture writers above): **a capture write never changes a stored lead value.** (`leads/delete.ts`
removes the lead; it is an owner action, not a capture write.) The newsletter writer already
followed it (it never writes an existing lead). Consequence, recorded: a later contact message is not stored on an
existing lead's `data` (the first `data` stays); the message still reaches the owner by email as before (finding
LN1-F1).

Concurrency (INFERRED from DynamoDB semantics, bound by test where a mock can show it): `UpdateItem` is atomic per item,
so two writers racing on one new key make one item; the second only fills. A newsletter signup that read "no lead" and
then meets a lead created meanwhile by `createOrFillLead` sees its conditional `Put` cancel; its own retry (NL1-R5)
re-reads and continues with the `ConditionCheck`. No new race.

## Evidence taxonomy

| Input | Expected |
|---|---|
| `Ana@Example.com ` through each of the three writers | one item `LEAD#ana@example.com` |
| the same person through the contact form, then the newsletter, then a comment | one lead row; the subscription item intact; `createdAt` and first `source` kept |
| the newsletter first, then the lead magnet in another spelling | one lead row; `NEWSLETTER#` item unchanged (read back) |
| an old row `LEAD#Ana@Example.com` in the table, list / delete / push | listed; delete removes exactly that row; push behaves as before |
| an address that fails the handler's check (`normalizeEmail` refuses none) | the handler's existing invalid-address answer; nothing written |
| tenant keys | built from `x-tenant-id` only |

## Definition of Done

The three writers changed and bound by tests; reader tests for old rows; gates of the packet green; docs updated
(`backend/ARCHITECTURE.md`, ROADMAP row and the F-FND2-1 note, `docs/TECH-DEBT.md` dated note, `CURRENT_SLICE.md`).

## Build record (2026-11-27, builder `claude-opus-5-5`, tree `3ec1047` + uncommitted diff)

### What was built

- `backend/src/lib/lead-write.ts` — `createOrFillLead(tenantId, email, { source?, name?, data?, createdAt })` returns the
  input of one `UpdateItem` (§ "The write after"). It normalizes the address itself, so the key and the stored `email`
  cannot disagree between callers.
  *Abstraction line:* a function, not an interface; users: `leads/create.ts`, `contact/send.ts`, `comments/create.ts`
  (three concrete callers, the same logic); variation axis: none (one write rule, which is the point); rejected
  alternative: three inline `UpdateCommand`s, which would copy the expression builder three times and could drift
  apart on the one rule.
- `leads/create.ts` (lead magnet): the address is normalized, then `LeadSchema` validates it, then the Update runs.
- `contact/send.ts`: the lead write is the Update. The Reply-To and the audit event keep the address as sent.
- `comments/create.ts`: `CommentSchema` validates the normalized `authorEmail`. The transaction is the comment `Put` +
  `{ Update: createOrFillLead(...) }`. The comment item keeps `authorEmail` as sent.
- Comment-only ripples: `leads/newsletter.ts:42`, `leads/delete.ts:31`, `packages/shared/src/index.ts:1525-1529` no
  longer say a writer "does not normalize" / "replaces" in the present tense. No logic change there.
- MCP `create_lead` description: the sentence "an existing lead with the same email is REPLACED and its status reset
  to 'New'" became false; it now states the new contract. No change to the tool's input or route.
- Readers (`leads/list.ts`, `leads/delete.ts`, `leads/push.ts`, admin `Leads.tsx`): no logic change (`leads/delete.ts`:
  one comment, listed above).

IAM (OBSERVED, read-only): the three functions have `grantWriteData` / `grantReadWriteData` (`infra/lib/api.ts:344,
553, 600`); `WRITE_DATA_ACTIONS` of the installed `aws-cdk-lib` 2.241.0 contains `dynamodb:UpdateItem`. No infra change.

### Evidence table → tests (`backend/test/unit/lead-normalize-1.test.ts`, 23 tests since revision 2)

| Row | Tests |
|---|---|
| `Ana@Example.com ` through each writer → one `LEAD#ana@example.com` | "… → one item LEAD#ana@example.com": one per writer, one per writer with a subscription stored (no command names a `NEWSLETTER#` key; the subscription reads back equal; revision 2), all three in turn, the comment item keeps `authorEmail` as sent, the Update shape (every assignment `if_not_exists`, undefined values left out) |
| contact → newsletter → comment | "contact form, then the newsletter, then a comment …": the lead read back equal to the first write; `NEWSLETTER#` read back equal; no command of the comment names a `NEWSLETTER#` key; the list shows one row with its subscription |
| newsletter first, then the lead magnet in another spelling | "the newsletter first, then the lead magnet …": one row; `NEWSLETTER#` read back equal; `source`, `createdAt`, `id` kept; the missing `name` added. Also: "the owner's status stays" (Contacted is not reset); "a lead written by a writer meanwhile does not break a newsletter signup" (NL1-R5 retry) |
| old row `LEAD#Ana@Example.com`: list / delete / push | listed beside the normalized row, the subscription on the normalized row only; the Leads page round trip (each listed row's key is `LEAD#<its email>`; deleting the old row sends one `Delete` and the table equals the table before minus that row); a new row and its subscription deleted in one transaction; push on the old row with no subscription → 404, nothing written; a later submission in the old spelling leaves the old row untouched (no merge) |
| an address that fails the handler's check | lead magnet 500 `Internal error` for `not-an-address`, `""`, `42`, nothing written; comments 500, neither the comment nor the lead written; contact: SES refuses → 500, nothing written; SES accepts → stored under its normalized form (LN1-F2) |
| tenant keys | a body with `tenantId`/`PK`/`SK` of another tenant through each writer: every written row has `PK = TENANT#t1`, `tenantId = t1` |

Detection control (EXECUTED): the same test file run on a separate worktree of `3ec1047` that has only
`lib/lead-write.ts` added (the three writers as before): 10 failed / 10 passed. The 10 failures are the writer and
overwrite rows. The worktree was removed. Re-run in revision 2 on the 23-test file: 12 failed / 11 passed. Of the three
new per-writer `NEWSLETTER#` tests, the lead magnet and comments ones fail on the old code (the old handlers answer 500
to the trailing space). The contact-form one passes on the old code, as it should: the old writers did not touch
`NEWSLETTER#` either. That test guards a kept property; it does not detect a change.

### Tests changed because this slice changes what they proved

- `backend/test/unit/newsletter-1.test.ts`, "Finding NL1-R8": four tests made the legacy row through the lead magnet
  (`signup({ email: LEGACY, source: "Website" })`). After this slice that call writes the normalized lead, so two
  tests failed and one ("deleting the LEGACY item …") passed vacuously (it deleted a row that did not exist). The
  legacy row is now seeded in its stored shape (`putLegacy`: key and `email` the typed spelling, as the old writer
  stored them). The test "a legacy spelling written AFTER the signup" is renamed, because no writer can write a legacy
  spelling now: "a legacy item, then a lead-magnet submission in the legacy spelling after the signup: the submission
  goes to the normalized lead … and changes nothing there; the legacy item stays separate …".
- same file, "order C": it asserted the old replace ("a lead-magnet download after the signup replaces the lead item");
  this slice orders that behaviour changed. Now: "… changes no stored lead value (LEAD-NORMALIZE-1), and the
  subscription stays"; the lead is read back equal.
- `backend/test/unit/digital-file-guard-1.test.ts`: "lead stored" was counted as `PutCommand`s on `LEAD#`
  (`leadPuts`). The write is now an `UpdateCommand`; the helper is `leadWrites` (Updates on `LEAD#`). The test names and
  their claims are unchanged. Rule: a test proves "stored" by the write the handler sends, and the helper's name says
  which write.

### Gates (EXECUTED on the final tree; logs in `.agent-manager/slices/LEAD-NORMALIZE-1/gate-*.log`, gitignored)

| Command | Exit | Result |
|---|---|---|
| `npm run build` | 0 | |
| `npm run typecheck` | 0 | |
| `cd packages/shared && npm test` | 0 | 33 files, 662 tests |
| `cd admin && npm run test:unit` | 0 | 32 files, 489 tests |
| `npm --prefix backend run test:unit` | 0 | 92 files passed, 2 skipped (golden captures); 2414 tests passed, 2 skipped. The first run exited 1 (the `digital-file-guard-1` helper above) |
| `cd tools/mcp-server && npm test` | 0 | 23 pass. No route changed, so `routes.json` is not refreshed |
| `git diff --check` | 0 | new files: `git diff --no-index --check /dev/null <file>` printed 0 lines for each of the 3 (its exit is 1 because the files differ from `/dev/null`; a control file with a trailing space is reported) |

NOT RUN: `cd backend && npm test` (live staging table; forbidden by the packet). Staging deploy and a staging check
are the operator's.

### Revision 1 (after review-0) — finding → the class it belongs to → the rule that closes it

Finding LN1-R1: four texts stated contracts the code does not have. Class: **a text (test title, code comment, doc)
that describes the lead write, its validation or what changed, and says more than the code does or describes the old
code.** Rule: every such text in the slice's surface must match the current code. Applied as a sweep (grep over
`backend/src`, `backend/test`, `packages/shared/src`, `admin/src`, `tools/mcp-server/src`, `renderer/src`,
`packages/plugins/src`, `docs/*.md` and the package ARCHITECTURE files for lead + put/replace/overwrite/upsert/whole/
reset, and every added line of this diff for unchanged/as before/validat/never/every/only/exactly), not only the four
places. No behaviour changed.

| Place | Was | Now |
|---|---|---|
| `newsletter-1.test.ts` Ruling 9 (describe + test title) | "the lead-magnet path is unchanged"; "one Put of the whole lead" | "a request without source "newsletter" takes the lead-magnet path"; "the lead is stored" (what the test asserts) |
| `lead-normalize-1.test.ts` contact/SES-accepts title | "stored under its normalized form, as before this slice" | "stored as a lead (unchanged: no address check); its key is now the normalized form" |
| `lib/lead-write.ts` header | "The caller validates the address … before it calls this" | the function does NOT validate; the lead magnet and comments validate the normalized form; the contact form has no check (SES first, LN1-F2) |
| `backend/ARCHITECTURE.md` Key Patterns | "No writer touches `NEWSLETTER#`" | "These three capture writers never modify `NEWSLETTER#` items" (revision 2; the revision-1 text "only the newsletter writer writes it" was false, see below) |
| this spec, § "The write after" (found by the sweep) | "a new row looks as before" | same attribute set; the key and `email` are now normalized |
| this spec, scope 4 and Build record (sweep) | "No reader code changes" | no logic change; `leads/delete.ts` has one comment change |
| this spec, LN1-F4 (sweep) | "no lead writer stores `resourceId` … the page always shows `data`" | limited to the four current writers and the rows they store; older rows not inspected |
| this spec, LN1-F1 (sweep) | "erased `createdAt`, `source`, `status`" | "replaced … with the new request's values" |
| MCP `create_lead` description (sweep) | "normalized email (trimmed, lowercased)" | "(Unicode NFKC, trimmed, lowercased)" — what `normalizeEmail` does |

### Revision 2 (after review-1) — finding → class → rule

Finding (LN1-R1, still open): the revision-1 text "only the newsletter writer writes `NEWSLETTER#`" was false —
`leads/push.ts` updates the subscription's `push`. Class: **an exclusive or universal claim about which code writes an
item ("only", "no writer", "every writer") made without an enumeration.** Rule: such a claim in this slice's texts
either names its enumeration basis or is cut down to what the slice's code shows. Applied:

- Writers of `NEWSLETTER#` (enumeration: text search for `NEWSLETTER#` and `newsletterKey(` over the same six roots as
  § "The email rule"): `leads/newsletter.ts` (signup `Put`; push result `Update`, also reached from "Send again"),
  `leads/push.ts` (claim `Update`), `leads/delete.ts` (`Delete`); `leads/list.ts` reads only. The architecture text
  now says only what this slice guarantees: "These three capture writers never modify `NEWSLETTER#` items".
- The `LEAD#` writer enumeration is stated once (§ "The email rule"); "every / four / no writer" in this spec and the
  comment in `newsletter-1.test.ts` point to it.
- The rule "a lead write never changes a stored lead value" was wider than the code (`leads/delete.ts` is also a lead
  write): it now names the four capture writers.
- The claim "these writers never touch `NEWSLETTER#`" was bound only for the comment and the lead magnet in order
  tests: a per-writer test now stores a subscription, runs each of the three writers, and asserts that no command names
  a `NEWSLETTER#` key and that the subscription reads back equal.

Left as is, with the reason: `docs/plan-glam-catalog.md:115` ("`LEAD#<email>` … overwritten by three writers") is a
plan dated 2026-10-27 and status PROPOSED. It records the state on that date, which was true then.

### Findings and deferred debt

- **F-FND2-1 stays open.** Rows stored before this slice under a typed spelling stay separate rows (listed, deletable
  from the Leads page). Merging them is a data slice.
- **LN1-F1 — a later message is not kept on an existing lead.** Rule "a lead write never changes a stored value": a
  second contact message (or a lead magnet `data`) does not replace the first `data`. The message still reaches the
  owner by email (SES), as before. Before this slice the same-spelling case replaced `data` (and replaced `createdAt`,
  `source` and `status` with the new request's values). A history of messages on the lead is new scope.
- **LN1-F2 — the contact form has no address check of its own** (before and after). The address goes to SES as
  Reply-To before the lead write; when SES refuses it, 500 and nothing is written; when SES accepts a text that is not
  a valid address, that text is stored as a lead (now normalized). Adding a check is a new error shape (packet: not in
  this slice). Whether SES refuses a given malformed Reply-To is INFERRED, not verified here (SES is mocked).
- **LN1-F3 — MCP `create_lead` with `source: "newsletter"` answers 400** "Consent is required." (recorded by
  `newsletter-1`). Still present: the tool sends no `consentText`; `leads/create.ts` routes that source to
  `newsletterSignup` before the lead write (newsletter logic, non-scope). The 400 follows the consent ruling (a tool
  cannot give a person's consent). Proposed follow-up: the tool description says the source `newsletter` is refused.
  Not applied.
- **LN1-F4 — name/behaviour mismatch, pre-existing, not changed:** the Leads page shows "Downloaded: <resourceId>" and
  `GET /leads` projects `resourceId`, but none of the four current lead writers stores `resourceId`. `LeadSchema` has
  no such field and Zod drops unknown keys, so the lead magnet does not store it (INFERRED from code). For every row
  these writers store, the page shows `data` instead. Rows written by older code were not inspected.
- The comment item keeps `authorEmail` as sent; since the check now runs on the normalized form, a comment whose
  address has spaces around a valid one is accepted (before: 500) and its comment item holds the sent form.
  Only the lead is normalized (scope).

## Closeout 2026-11-27 — ON STAGING

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, three cycles, approved (review-2).

**Operator note on LN1-F1 (accepted, the human may overrule).** Before this slice a second contact message from the
same address replaced the lead row: the Leads page showed the newest message and the status went back to `New`. Now the
row keeps its first values and the owner's status; the newest message reaches the owner by e-mail only. A history of
messages on the lead is new scope.

Operator-executed on the final tree:

| Check | Result |
|---|---|
| Gate script (build, typecheck, shared, plugins, renderer, serving, serving-bundle, admin unit, backend unit, infra, MCP, `git diff --check`) | every exit 0; no manifest, lockfile, infra, renderer, admin or plugin path changed |
| Staging diff, read before the deploy | code updates only (91 functions, the admin bundle); no resource added or removed; no permission change |
| Staging deploy | `AmodxStack-staging` success line present |
| A row stored the old way (mixed-case address) beside a normalized row | both listed; deleting the old row removes exactly that row; deleting the normalized row removes it |
| Cleanup | the test site's key set equals the one before |

**Not verified on staging.** The new write of the three writers: the lead route refused the scripted request ("CAPTCHA
verification required"), so the normalized key and the kept values are proven by the unit tests only.
