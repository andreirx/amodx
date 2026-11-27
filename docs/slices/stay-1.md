# STAY-1 — booking a room for a range of nights

> Copied 2026-11-18 from `satulbanului/docs/amodx-slices/stay-1.md` (draft written by the satulbanului session). This copy is the one to edit.
> Not ratified. Its `file:line` evidence comes from one read-only pass on `main` at `3388999`; a builder reads each again.

Status: **Part A IMPLEMENTED 2026-11-27 (built, operator gates pending; § "Build record (STAY-1A)")**; part B
WITHDRAWN 2026-11-20 (§ 5). Part A was ratified by the human's order of work of 2026-11-27; the builder packet's
operator rulings 1–11 apply. Track: D (Scheduling), with one small slice outside it. Source plan:
`docs/plan-appointments-private-table-extension.md`. Maturity target of part A: PROTOTYPE → MATURE after the operator's
staging check.

## 1. The problem

A guesthouse sells one room for a run of nights. Today the site (old and new) takes bookings by phone and
email only. AMODX has a scheduling plan, Track D, with no code yet (search 2026-11-18: no `appointment`, no
slot code in backend, shared, renderer, admin, infra; `appt-1`…`appt-7` all PLANNED, `docs/ROADMAP.md:177-183`).

Track D as planned does not reach a guesthouse soon, for three reasons:

1. **It is behind two other tracks.** Order B → C → D (`ROADMAP.md:95-111`). The private table that Track D
   copies is not built (one table, `infra/lib/database.ts:17-18`; `cmrc-1`…`6` PLANNED; Track B waits for the
   human's GO). Customer sign-in is not built (`auth-1`…`7` PLANNED).
2. **It models an appointment, not a stay.** One booking = one service with a duration = one lock item
   `SLOT#<resourceId>#<startIso>`. A stay is N nights on one room, with arrival and departure rules, a
   minimum stay, a price per night that changes by season, and guest counts.
3. **It demands a signed-in customer** (plan, Non-Goals: "No anonymous bookings"). A guest who books three
   nights once a year will not make an account.

## 2. STAY-1A — a booking request form (outside Track D; small; useful now)

Purpose: the visitor picks a room, arrival and departure dates and guest count; the owner gets an email and a
stored submission, and confirms by phone or email. No availability, no payment, no promise. This is what a
small guesthouse does by hand today, without the lost emails.

Evidence: the stored-form block already delivers this path — `DynamicForm.tsx:88-94` →
`/public/forms/{slug}/submit` → `backend/src/forms/public-submit.ts` (reCAPTCHA `:187-210`, stored
`FORMSUB#` `:252-256`, SES email). The field types are `text, email, phone, textarea, select, checkbox,
number` (`packages/shared/src/index.ts:2354`). There is no date field.

Scope:
1. Field type `date` in the form schema (shared first), the editor's field picker, `DynamicForm` (a native
   `<input type="date">`), and the submit handler's validation: a real calendar date in `YYYY-MM-DD`; optional
   `min: "today"`. Stored as the same text.
2. Optional pair rule on a form: field B must be later than field A (departure after arrival). One rule, on
   the server; the client repeats it only as a hint.
3. The submission email and the admin submission view show dates in the site's locale.

Taxonomy: date absent on a required field → 400 naming the field; malformed (`2026-02-30`, `30/02/2026`) → 400;
before today with `min` → 400; departure not after arrival → 400; valid → stored + email.

Non-scope: availability, prices, calendars, payment, a room entity.
Deployment: additive; forms without a date field are unchanged (unit suite `forms-public-submit.test.ts`
passes unchanged). Note: `public-harden-1` is editing the same handler now — this slice starts after it lands.

Exit: a "Request a stay" form on a room page sends the owner one email with room, dates, guests and phone.

## 3. STAY-1B — real availability: an amendment to the Track D plan (specification only)

What changes in the plan, and nothing else:

- **Kernel (`appt-1`).** A second booking shape next to the timed appointment: a *stay* = resource + arrival
  date + departure date in the tenant's timezone. Pure rules: nights = the dates in `[arrival, departure)`;
  minimum nights; allowed arrival weekdays; a closed-dates list. Two shapes, both closed → a sum type with an
  exhaustive match, not a flag on one record.
- **Locks (`appt-3`).** One lock item per night, `SLOT#<resourceId>#<localDate>`, all in the booking's one
  `TransactWrite` with `attribute_not_exists` on each. Any night taken → the whole booking fails; no partial
  stay. Limit to state: a DynamoDB transaction holds 100 items, so a stay is capped (proposal: 30 nights).
  A night key is a local date, not a UTC instant — this is a named exception to the plan's time invariant and
  must be written into it, with the reason (a night has no instant).
- **Public read.** A derived DTO "free / taken per night per room" for a date range, through a backend route,
  as the plan already says for slots.

### Decision STAY1-GUEST-IDENTITY (the human's)

| Option | Reward | Risk |
|---|---|---|
| A. Keep "signed-in customers only" | one rule for all of Track D; PD-002 unchanged | stays wait for all of Track C; guests must make an account for one visit |
| B. Allow a guest booking confirmed by an emailed link (no account) | fits how people book a room; Track C is no longer a precondition for stays | a new anonymous write path on a private table: needs the endpoint hardening of `static-pages-architecture.md` § 2, a hold that expires, and abuse limits; PD-002's wording must be amended |

### Decision STAY1-PRICE (the human's)

| Option | Reward | Risk |
|---|---|---|
| A. No price in the booking; the owner confirms the price | small; no money rules | the visitor does not see a total |
| B. Seasonal price per night, total computed on the server | a real booking engine | a pricing domain (seasons, guests, meals, children) — its own track; and the rule from `order-confirm-1` applies: no visitor is shown one total and charged another |

Payment is outside both options.

Exit of 1B: the two decisions answered and the amended sections of the plan reviewed; `appt-1` and `appt-3`
slice files then carry the stay shape from their first version.

## 4. Recommendation

Build STAY-1A. It gives the owner structured requests with no dependency. Treat STAY-1B as input to Track D
when that track opens, so the kernel is not written for appointments only and then bent.

## 5. Direction (human, 2026-11-20)

The guesthouse's room booking is done by an existing external booking service that the site integrates:
`docs/slices/booking-embed-1.md`. **Part B (§ 3) is withdrawn**; STAY1-GUEST-IDENTITY and STAY1-PRICE need no
answer. Part A (§ 2, a date field for stored forms) stays a draft for owners with no booking service; it is not
needed for satulbanului if the service is integrated. Track D gets the seat shape first (`docs/slices/sched-1.md`).

## Build record (STAY-1A)

Builder `claude-opus-5-5`, 2026-11-27, on `6b2e139`. Not committed. Part B: nothing built.

### Corrected references (ruling 1)

The `file:line` evidence of § 2 came from `3388999`. On `6b2e139` (each place read again):

| § 2 said | Now |
|---|---|
| `DynamicForm.tsx:88-94` | `packages/plugins/src/form/DynamicForm.tsx:91` (the component moved into the `form` block, SHOP-LOOK-1E); the block render is `FormRender.tsx`; the server pass is `renderer/src/components/SitePage.tsx` `formForBlock` |
| reCAPTCHA `public-submit.ts:187-210` | `backend/src/forms/public-submit.ts:194-214` |
| stored `FORMSUB#` `:252-256` | `:252-267` (before this slice) |
| field types `packages/shared/src/index.ts:2354` | `:2623` (before this slice) |
| — | values cleaned per type in `cleanValue` (`switch` with a `never` default, `:63-95`); refusals `:130-133`; error shape `badRequest` `:159-162` = `{ error: <English text>, fields?: [labels] }`; save handlers `forms/create.ts:52-67`, `forms/update.ts:62-73` (no schema validation of fields) |

### What was built

- **Shared** (`packages/shared`): `FormFieldSchema.type` gains `date`; `min: z.literal("today").optional()`;
  `FormDefinitionSchema.dateOrder?: { earlier, later }`; `formFieldsOf` (the one field-list rule: the entries that pass
  the schema, the first of each label); new `form-date.ts`: `resolveFormDateOrder`, `earliestFormDate`,
  `formatFormDate`, `isFormDate` (the value check).
- **Submit handler**: `case "date"` — `""`/absent = blank, else the exact text `YYYY-MM-DD` of a real date, stored as
  that text, else 400 "Invalid value"; `min: "today"` → 400 "Date is before today"; pair rule → 400 "Date must be after
  the earlier date" with `fields: [<later label>]`; the mail shows a date in the tenant locale.
- **Save handlers**: the pair rule is checked on the form (create) or the merged form (update) before any write; a
  problem → 400 `{ error }` naming the key; stored as `{ earlier, later }`; `dateOrder: null` removes it.
- **Renderer/plugins**: `DynamicForm` renders a native `<input type="date">`; `formForBlock` adds `dateOrder` to `_form`
  only when the rule resolves.
- **Admin**: picker "Date", switch "Not before today", card "Date Order" (two or more date fields only); the submission
  view shows a date in the tenant locale.
- **MCP**: `create_form` / `update_form` describe `date` and `min`, and take `date_order` (`null` removes).

### Rulings applied

- **Ruling 2 — the closed set; site list.** After `date` was added to the shared enum, the compiler named ONE site
  (`npx tsc --noEmit`, EXECUTED): `backend/src/forms/public-submit.ts(75,19)` (`cleanValue`). The other sites used local
  types, `string` or `any`, so no compiler saw them. Each now has an explicit `date` decision, and the two that dispatch
  are compiler-checked:
  `packages/plugins/src/form/DynamicForm.tsx` (local copy of `FormField` removed, the shared type used; the control
  chain is now one `switch` with a `never` default — a new type is a compile error), `admin/src/pages/FormEditor.tsx`
  (`FIELD_TYPE_LABELS: Record<FormFieldType, string>` — a type without a label is a compile error),
  `admin/src/pages/FormSubmissions.tsx` (`submissionValueText`: date → locale form; every other value unchanged),
  the mail line in `public-submit.ts` (`mailFieldValue`), `tools/mcp-server/src/tool-shapes.ts`
  (`FORM_FIELDS_DESCRIPTION`, test-bound to the shared enum). Predicates over one type that stay as they were (each
  gives the right answer for `date`): `DynamicForm` label line (`!== "checkbox"`), its submit default
  (`=== "checkbox" ? false : ""`), its email lookup; `public-submit` email checks; `FormEditor` options input
  (`=== "select"`). Not a dispatch: `backend/src/interest/public.ts` (a fixed field list). No wildcard arm accepts `date`.
- **Ruling 3 — value contract.** `isFormDate` (pattern + round trip): `2026-02-30`, `30/02/2026`, `2026-2-3`, a
  number, a padded text, a date-time are refused. Every four-digit year 0000–9999 is accepted (ISO 8601, proleptic
  Gregorian). Revision 1 (F-STAY1A-YEAR-REMAP) removed a restriction to years ≥ 0100 that came from `Date.UTC`.
- **Ruling 4 — "today".** The only stored zone of a tenant is `scheduling.timezone` (`scheduling.ts:282`, SCHED-1,
  optional IANA name; required only to enable scheduling). The handler passes it to `earliestFormDate`: a valid zone →
  today in that zone; none → the UTC date minus one day. **Which case applies:** a tenant whose settings hold no
  `scheduling.timezone` (the usual case: the field exists only for scheduling) gets the UTC-minus-one rule; a tenant
  that holds one gets its local today. Which live tenants hold one was NOT observed (no read of a live table). Both
  sides of both boundaries are tested with an injected clock (`vi.setSystemTime`; pure rows with explicit instants).
- **Ruling 5 — pair rule.** `{ earlier, later }` field ids; save refuses a missing id, a non-date field, the same id
  twice, a non-object; read against `formFieldsOf` (the submit handler's field list), so a rule that passes save always
  applies at submit. Either value blank → not applied. A stored rule that does not resolve (only a record written
  around the save handlers) is not applied at submit and is logged (`console.warn`); refusing every submission of the
  form was the alternative, rejected: it loses requests for a configuration fault.
- **Ruling 6 — refusals.** The existing shape `{ error, fields }`; the field named by its label. The handler answers
  English texts for every field refusal and `DynamicForm` shows `error` as sent: the new texts follow that pattern
  (recorded, not widened; TECH-DEBT "stay-1 part A residuals"). No locale-table key added: the visitor sees no new
  client text (the date input's own messages come from the browser).
- **Ruling 7 — renderer.** Choice: `min` is set in an effect after hydration (the visitor's local date), never during
  render; the server HTML has no `min`. Proven: `renderToString` has no `min=`; `hydrateRoot` reports no recoverable
  error and no console error (jsdom). The later field's `min` is the day after the earlier value (UTC arithmetic).
  `DynamicForm` imports only types from `@amodx/shared` (a runtime import in a render chunk moved the shell in
  `gallery-1`). Bytes: `test/dynamicForm.baseline.json` (every older type, both server renderers) passes unchanged;
  `test:serving` 176/176 and `test:serving-bundle` 61/61 with no capture file changed.
- **Ruling 8 — display.** `formatFormDate` (shared, pure): `setUTCFullYear` + `timeZone: "UTC"`, no local-time `Date`;
  the year part is the stored four-digit text (`0099-12-31` → `31.12.0099`);
  en-US `11/27/2026`, ro-RO and de-DE `27.11.2026`, fr-FR `27/11/2026`; tested in three process zones. Used by the mail
  and the admin view.
- **Ruling 9 — editor.** Admin texts English. A form with fewer than two date fields saves no rule (the card is hidden,
  so nothing hidden can block the save — found by this slice's own test); a form that had one sends `null`. Revision 1
  (F-STAY1A-EDITOR-RULE-LEAK): the rule state belongs to the form on screen (see § "Revision 1").
- **Ruling 10 — MCP.** `formBody` moved into `tool-shapes.ts` (the existing test seam); the shape test binds the
  described types to `FormFieldSchema`.
- **Ruling 11.** No `infra/` change: no new route, no new DynamoDB operation (the submit handler already reads the tenant
  item; create/update already read).

### New structure (one line each)

- `formFieldsOf` (shared function) — users: `public-submit.ts`, `create.ts`, `update.ts`, `SitePage.tsx`; no axis of
  variation: one rule that four places must agree on; rejected: a third and fourth inline copy of the 10-line loop.
- `form-date.ts` (file in the existing shared package, not a new package) — users: three backend handlers, the renderer,
  two admin pages; axis: none, it holds the pure rules of one closed field type next to `zoned-time.ts` it uses;
  rejected: the functions in the 2,900-line `index.ts`.
- `resolveFormDateOrder` (Result of Option) — users: save ×2, submit, renderer, admin editor; rejected: three copies of
  "both ids exist, both dates, different".
- `submissionValueText`, `dateOrderToSave` (admin, exported pure functions) — one page each plus the test seam;
  rejected: inline logic with no test access.
- `formBody`, `FORM_FIELDS_DESCRIPTION`, `FORM_DATE_ORDER_DESCRIPTION` (MCP `tool-shapes.ts`) — users: `create_form`,
  `update_form`; the existing test-seam pattern (`index.ts` starts the server on import).
- Dispatch: the field type is a closed sum (Zod enum) with exhaustive `switch` + `never`; adding `date` broke each
  match on purpose.

### Tests bound to the packet's rows

| Row | Test |
|---|---|
| required date absent → 400 naming the field | `backend/test/unit/stay-1a-submit.test.ts` "required date absent" |
| `2026-02-30`, `30/02/2026`, `2026-2-3`, a number, `""` required → 400 | same file, "→ 400 Invalid value" (7 values) and `'"" on a required date field'`; shared `stay-1a.test.ts` `isFormDate` (incl. years 0000–0100) |
| before today with `min` → 400; today and tomorrow accepted | same file, both `min: "today"` describes (no zone; Bucharest zone; both sides of midnight); shared `earliestFormDate` rows |
| departure ≤ arrival → 400 naming the later field | same file, "the pair rule" (equal, earlier) |
| pair rule, one value absent → accepted | same file (later empty, later absent, earlier empty) |
| valid → stored as the same text; e-mail and admin view in locale form | same file "valid → 201" and the e-mail describe; `admin/src/pages/FormSubmissions.stay-1a.test.ts`, `FormSubmissions.test.ts` `submissionValueText`; renderer `shop-look-1e-form-client.test.ts` STAY-1A request row |
| a form without a date field: unchanged | `forms-public-submit.test.ts` 39/39 unchanged; `dynamicForm.baseline.json`; `shop-look-1e-form*.test.ts` existing rows; serving 176/176, bundle 61/61 |
| save with a rule naming a missing or non-date field → refused | `backend/test/unit/stay-1a-form-save.test.ts` (create and update) |

### Revision 1 (after review-0)

Two findings of review-0, each closed by one rule over its class (not by a patch of the reported case):

- **F-STAY1A-EDITOR-RULE-LEAK.** One `FormEditor` stays mounted across `/forms/:id` changes (`admin/src/App.tsx`: one
  route `forms/:id`). The editor set the rule state only when a loaded form had a rule, so form F2 without a rule saved
  F1's rule. Class: state of one form surviving a change of form in the same mounted editor. **Rule:** the rule state
  is reset at every change of the route id (also to `new`), every loaded answer sets it (`dateOrderStateOf`, rule
  present or absent), and a load's answer is applied only while its id is still on screen (the effect's `current()`
  flag; this guard covers every state the load writes). Tests: `FormEditor.stay-1a.test.ts` "the editor across form
  changes" (F1 rule → F2 none; F1 none → F2 rule; F1 → New; a late F1 answer after the move to F2). EXECUTED: without
  the reset and the guard 3 of these rows fail; with them all pass.
- **F-STAY1A-YEAR-REMAP.** `Date.UTC` (and `new Date(y, …)`) read a year 0–99 as 1900–1999: `0099-12-31` was refused,
  not formatted, and the client's "day after" gave `2000-01-01`. Class: a calendar day built or shown through an API
  that reinterprets the year. **Rule:** slice code builds a day only with `setUTCFullYear` (`utcDay` in `form-date.ts`;
  `dayAfter` in `DynamicForm.tsx`), and a shown year is the stored four-digit text, never the number `Intl` prints
  (`99` for 0099, `1` with era BC for 0000). `isFormDate` replaces the use of `zoned-time.ts` `isLocalDate` for forms;
  `isLocalDate` and scheduling are unchanged. Source guards: `packages/shared/test/stay-1a.test.ts` and
  `packages/plugins/test/dynamicForm.test.ts` fail on a `Date.UTC(` call in those modules. Rows across
  `0099-12-31` → `0100-01-01` in shared, plugins/renderer (client `min`), backend (stored, mail `31.12.0099`, pair rule)
  and admin (view).

### Revision 2 (after review-1)

- **F-STAY1A-THEME.** The new "Not before today" checkbox used `border-gray-300` (CLAUDE.md Critical Rule 6). Class: a
  fixed colour in code this slice adds. **Rule:** every added `.ts`/`.tsx` line of the slice (tracked diff and new
  files) uses theme tokens only; checked by one scan for Tailwind palette classes and hex colours. The scan found that
  one site; it is now `border-border`. The "Required" checkbox beside it (`FormEditor.tsx:418`) keeps
  `border-gray-300`: it existed before the slice and is unchanged.
- **F-STAY1A-FINAL-EVIDENCE.** The gate summary below kept the counts of iteration 0 under "final tree". Class: a
  durable evidence record that does not name the run it reports. **Rule:** the summary names the revision and date of
  the run it reports, it is rewritten from that run's results, and earlier runs are labelled as earlier.

### Gates — revision 2 tree, 2026-11-27 (EXECUTED, exit status bare)

The run on the tree under review (after the revision-2 change). Commands as in the builder packet; each exited 0:

| Command | Exit | Result |
|---|---|---|
| `npm run build` | 0 | |
| `npm run typecheck` | 0 | |
| `cd packages/shared && npm test` | 0 | 662 passed |
| `cd packages/plugins && npm test` | 0 | 388 passed |
| `cd renderer && npm test` | 0 | 964 passed |
| `cd renderer && npm run test:serving` | 0 | 176/176; no serving capture file changed |
| `cd renderer && npm run test:serving-bundle` | 0 | 61/61 |
| `cd admin && npm run test:unit` | 0 | 489 passed |
| `npm --prefix backend run test:unit` | 0 | 2394 passed, 2 skipped (the two opt-in golden capture files) |
| `cd tools/mcp-server && npm test` | 0 | route coverage OK, 23/23 |
| `git diff --check` (+ `git diff --no-index --check /dev/null <f>` per new file) | 0 (new files: 1 = clean) | |

Earlier runs (superseded, kept for the trail): iteration 0 — shared 649, plugins 387, renderer 963, admin 484, backend
2391, serving 176/176, bundle 61/61, MCP 23/23, all exit 0; revision 1 — the counts of the table above, all exit 0.

Not run by the builder: `cd backend && npm test` (it reaches the live staging table); the staging deploy and the
staging check (the operator's; the public submit stops at reCAPTCHA for a scripted browser, so the form is proven in a
browser and the submit by the unit tests).

### Findings and deferred debt

- **F-STAY1A-ZONE-SOURCE.** The site timezone used for "today" is `scheduling.timezone`: its name and place say
  scheduling, and since this slice it also sets form dates. A tenant that sets it for scheduling changes its forms'
  "today" too (to the correct local date). A site-level zone setting is not built; propose one if a non-scheduling
  tenant needs exact local "today".
- **F-STAY1A-ERROR-LANGUAGE (pre-existing pattern).** Submit refusals are English and `DynamicForm` shows them as sent
  on every site language. Fixing it means codes in the answer and texts in the locale table — its own slice.
- **The admin editor still shows "Placeholder" for a date field**; a date input ignores it. Cosmetic.
- **TECH-DEBT.md:334 is stale**: it says `public-submit.ts` sends no notification mail; it does. Not edited (outside the
  slice).
- **F-STAY1A-EDITOR-NEW-KEEPS (pre-existing, INFERRED from the code, not fixed).** When the mounted editor moves from a
  form to `/forms/new` (history back/forward between the two addresses), the effect loads nothing, so the name, slug and
  fields of the previous form stay in the "New Form" screen; a save creates a copy. The rule state is reset (revision
  1, tested). The Forms list opens "new" from another route, so the usual path remounts the editor.
- **`zoned-time.ts` `isLocalDate` (scheduling) refuses years 0000–0099** for the same `Date.UTC` reason. Scheduling
  dates are near today, so no effect is known; left unchanged (outside the slice; review-0 asked to keep it out).

## Closeout (STAY-1A) 2026-11-27 — ON STAGING

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, three cycles, approved (review-2). Part A only; Part B stays withdrawn.

Operator-executed on the final tree:

| Check | Result |
|---|---|
| Gate script (build, typecheck, shared, plugins, renderer, serving, serving-bundle, admin unit, backend unit, infra, MCP, `git diff --check`) | every exit 0; no manifest, lockfile, infra or serving capture path changed |
| Staging diff, read before the deploy | code updates only (90 functions, the renderer and admin bundles); no resource added or removed; no permission change |
| Staging deploy | `AmodxStack-staging` success line present |
| Save a form whose pair rule names a missing field, a non-date field, or one field twice | 400 with the reason; no form stored |
| Save a "Request a stay" form (room, arrival with `min: today`, departure, guests, phone; rule departure later than arrival) | stored with the two date fields and the rule |
| The form on a public page, real browser, 1280 px and 390 px | two native date fields, required, no sideways scroll; the arrival field's earliest date is the visitor's today; after an arrival date is chosen the departure field's earliest date is the day after; a departure before the arrival is invalid in the browser and nothing is sent; no page error, no hydration error |
| Admin form editor, real browser | opens the form and offers the pair rule with its two pickers; no page error |
| Cleanup | every table item the run added is deleted; the test site's key set equals the one before |

**Not verified on staging.** The stored submission, the server's refusals at submit and the e-mail with the dates in the
site's locale: the public submit on staging is protected (origin check and reCAPTCHA) and refuses a scripted request, so
these are proven by the unit tests only. The admin submission view with a date value, for the same reason.

Module maturity: `packages/shared/src/form-date.ts` PROTOTYPE.
