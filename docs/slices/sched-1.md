# SCHED-1 — scheduling with two booking shapes: a slot with a practitioner, a seat in a group (SPECIFICATION slice)

Status: **PLANNED (specification) — RATIFIED by the human 2026-11-21 (nine decisions, § 15); AMENDED 2026-11-21
(SCHED-1R: ratification applied, week planner added, § 23; amendment reviewed, § 24).** Next: `sched-1a`. Track: D (Scheduling), prefix `sched-`. Written 2026-11-20 as `course-1` (seats only);
rewritten 2026-11-21 after the human's directions of that day (§ 1); expanded the same day into a buildable
specification (operator packet 2026-11-21); revised after review-0 (findings SCHED-R01…R12, closure table § 21);
document approved by review-4 (§ 22). Source plan: `docs/plan-courses-group-sessions.md`; base plan
`docs/plan-appointments-private-table-extension.md` (ratified; amended by § 16.1, applied 2026-11-21). This slice
writes the specification; it changes no code.

Named clients: galeriilevoicu.ro (courses and workshops in groups) and a practitioner client (individual
appointments, "like a dentist or a psychologist") named by the human on 2026-11-21.

Evidence labels: **OBSERVED** (read in the file at `main` `cd51c6d`, or a command run on 2026-11-21),
**EXECUTED** (a command run by the builder of this specification), **INFERRED** (reasoned, or taken from vendor
documentation, not seen in this repository), **NOT VERIFIED** (cannot be checked from the repository).

## 1. Directions of the human (2026-11-21) — settled, not open

1. **Both shapes are needed**: individual appointments and group sessions.
2. **Booking is confirmed by an emailed link, with no account.** This replaces "authenticated booking only" of
   the base plan (its Goal and Non-Goals).
3. **The booking screens are a hosted page that also works in a frame** on a site that is not on AMODX
   (`docs/slices/sched-frame-1.md`). A tenant with no domain is an ordinary tenant (the preview paths serve two
   such tenants today).
4. **AMODX provides the scaffolding.** The text of a contract and the lawfulness of what a tenant asks its
   customers are the tenant's responsibility (`docs/slices/contract-1.md`).
5. **AMODX holds the calendar; the admin gets a week planner** (ratification of 2026-11-21, verbatim in
   `.agent-manager/slices/SCHED-1/human-ratification.md`): "good admin tools around it, for the schedule enabled
   tenants, with clear open slots and unavailable times - per week planner, with defaults ... send out an email to
   the admin reminding them they can manually tweak those - and we can tweak individual days, disable whole days
   ... pre-fill ahead of time by weeks and months". Ruling **SCHED-PLANNER = B** ("ok B"): nothing is materialized
   per week; every week is open from the defaults; the admin edits any week; a tenant setting limits how far ahead
   visitors can book. Its specification is § 23.

## 2. The problem

- A practitioner sells time: one person, one practitioner, a start and a duration.
- A school sells a place in a group that meets on a list of days. Today the date is agreed on WhatsApp and the
  groups are kept in a spreadsheet (name, paid or not, language).
- AMODX has no scheduling code (OBSERVED: no scheduling, appointment or booking module under `backend/src`,
  `packages/shared/src`, `renderer/src`). The base plan specifies the first shape only and defers pooled capacity
  (base plan lines 66-69).

Domain statements this specification encodes. Each type and rule names the statement it comes from. A bound that
no statement gives is a **technical limit** and is listed in § 4.5 with its trigger.

| Id | Statement | Source |
|---|---|---|
| D1 | An appointment reserves one named resource for a start and a duration; parallel capacity = several resources | base plan lines 24-27, 71-87 |
| D2 | A service has a duration and a set of eligible resources | base plan lines 79-82 |
| D3 | Availability is local wall time in an explicit timezone; storage and guards use UTC instants | base plan lines 103-112 |
| D4 | A run is one course on a fixed list of meetings, with a capacity and one trainer or more | plan-courses § 2 |
| D5 | A person enrols in the whole run; a person can pay first and have no run yet | plan-courses § 2 |
| D6 | The partly filled run is proposed first; other runs are shown only on request | plan-courses § 2 |
| D7 | A run's language is not known at first; then it is Romanian or English; an unset run language is set by the first enrolment unless the admin set it; the proposal never crosses languages, the admin may | plan-courses § 2, § 6; draft § 4 |
| D8 | The admin moves one person, or moves a whole run; the system mails the people | plan-courses § 2 |
| D9 | People come from other channels; the admin enters them by hand; they get the booking's emailed link | plan-courses § 2, § 4 |
| D10 | A WhatsApp group per run: an invite link stored on the run, sent by mail | plan-courses § 4 |
| D11 | A seat for an order is taken when the order is placed, paid or not; the roster shows the payment state; the admin frees it | plan-courses § 6 (operator shop rule) |
| D12 | Booking is confirmed by an emailed link, no account; the link later shows, cancels or moves that one booking inside the tenant's window | § 1 item 2; draft § 4 |
| D13 | The booking screens are a hosted page that also works in a frame; a tenant with no domain is ordinary | § 1 item 3 |
| D14 | Trainers and practitioners see their schedule in their own calendar (feed) | draft § 6 SCHED-CALENDAR |
| D15 | Customer-private scheduling data is outside the renderer's reach; customer actions are renderer-proxied | VISION guarantee 2; PD-002; base plan lines 52-54 |
| D16 | The admin plans each resource's weeks: weekly defaults; any date edited to other hours or a whole day off; weeks and months ahead; nothing is materialized per week — a date with no edit follows the defaults | § 1 item 5 (SCHED-PLANNER = B) |
| D17 | A visitor books a slot at most a tenant-set number of weeks ahead; the admin is not limited by it; a seat in a group run is not limited (operator decision, § 15) | § 1 item 5; default 8 weeks (operator decision, 2026-11-21: the human gave no number) |
| D18 | Each Sunday the admin gets one mail with the next week per resource and a link to the planner | § 1 item 5 |

## 3. Fact check of the draft, and findings in the code

Every fact the 2026-11-21 draft stated about code or another document, checked again at `main` `cd51c6d`
(`cd51c6d` changes only `infra/deploy.sh`, OBSERVED `git log -1 --stat`).

| # | Draft claim | Source checked | Verdict |
|---|---|---|---|
| F1 | `productType` is `physical \| digital` at `packages/shared/src/index.ts:1570` | `packages/shared/src/index.ts:1577` | **Corrected**: enum right; line 1577 (OBSERVED) |
| F2 | PD-002's list "appointment booking / list / cancel" at `docs/platform-decisions.md:153-154` | `docs/platform-decisions.md:152-155` | **Corrected**: heading line 152, list lines 154-155; the appointment line is 155 (OBSERVED) |
| F3 | Pattern `EMAILLIMIT#` at `backend/src/orders/create.ts:480` | `backend/src/orders/create.ts:540-575` | **Corrected**: line 543. The pattern is one counter per email across all tenants (`PK: 'SYSTEM'`), a read then an unconditioned update (two orders at once both pass the limit of 5, `:16`, `:554`), counts mails after the order is written, and writes a `ttl` (`:573`) that nothing deletes: the main table has no TTL attribute (`infra/lib/database.ts:17-23`). OBSERVED. Not copied; § 9 specifies an atomic per-tenant counter |
| F4 | Schedule rule pattern at `infra/lib/amodx-stack.ts:388-391` | same | **Correct** (OBSERVED) |
| F5 | "the parent stack is at 440 of 500 resources" | `docs/ROADMAP.md:237-240`; `infra/test/amodx-stack.test.ts:1174-1242` | **Corrected**: 440 was the count of 2026-10-15/27. Synth on 2026-11-21: parent raw 401, 53 functions; calibrated estimate **≈ 467 of 500** (EXECUTED `cd infra && npx jest`, 63/63, "(split1-5) DEPLOYED parent ≈ 467"; log `.agent-manager/slices/SCHED-1/infra-counts.log`). `cd51c6d` does not touch `infra/lib` (OBSERVED). Headroom ≈ 33 |
| F6 | `backend/src/lib/order-email.ts` is the per-tenant template pattern | `backend/src/lib/order-email.ts:1-109` | **Correct**, with the limit of `pay-1.md` F1: English defaults in the backend (`:23`); overrides in `TenantConfig.orderEmailConfig.templates` (`packages/shared/src/index.ts:501-505`, `:1233`) |
| F7 | Slot lock `SLOT#<resourceId>#<startIso>` with `attribute_not_exists` | base plan lines 114-143 | **Citation correct; mechanism incomplete**: one lock per start does not stop two bookings of different durations from overlapping. § 7.3; decision SCHED-SLOT-GUARD |
| F8 | Seat guard "a conditional counter on the run"; "an expired hold no longer counts" | draft § 4, § 5; plan-courses § 3 | **Corrected**: a counter does not go down when a hold expires without a write. § 7.4 |
| F9 | The booking-intent item against double submits | base plan lines 139-143 | **Correct**; extended for failure paths (§ 7.2) |
| F10 | "the preview paths serve two such tenants today" | `renderer/middleware.ts:132-134`, `:248-277` | Mechanism **OBSERVED** (`https://<distribution>.cloudfront.net/_site/<tenantId>/…`, always dynamic, preview hosts only). Two production tenants use it: **NOT VERIFIED** |
| F11 | Draft state `Completed` and run status `Done` | draft § 3 | **Removed**: no rule reads them; "past" is derived (§ 4.4) |
| F12 | `contract-1` uses "the reminder job of `sched-1g`" | `docs/slices/contract-1.md:27` | **Correct**; the reminder job stays in `sched-1g` |
| F13 | ROADMAP Track D "depends on the auth substrate (C)" | `docs/ROADMAP.md:110`, `:171-183`, `:325-327` | **Out of date** after § 1 item 2; changed at ratification (§ 16.4) |
| F14 | The `sched-` prefix is registered | `docs/documentation.md:94-104` | **Not yet**: only `appt-` (line 101) |

Findings in the code that shape this specification:

| # | Finding | Evidence | Where it is handled |
|---|---|---|---|
| G1 | Renderer `/api/*` proxies take the tenant from `Host`; `/api/*` is not rewritten by the middleware, so on `<distribution>.cloudfront.net` no tenant is found | `renderer/src/app/api/contact/route.ts:32-35`; `renderer/middleware.ts:181-189`; `renderer/src/lib/dynamo.ts:87-117` (OBSERVED); consequence INFERRED | § 10.1: booking routes are reached through a middleware rewrite that binds the tenant |
| G2 | **Corrected in cycle 2.** Cycle 1 said the visitor's address cannot reach the renderer. Not established: CloudFront adds `X-Forwarded-For` to origin requests (AWS documentation, INFERRED) and the installed OpenNext converter keeps every request header (`node_modules/@opennextjs/aws/dist/overrides/converters/aws-apigw-v2.js:44-56`, OBSERVED); `remoteAddress` is the Lambda URL's `sourceIp`, i.e. CloudFront (`:67`, OBSERVED). What the renderer receives in production is **NOT RUN** | — | § 9.2: extraction rules for both header candidates; a staging witness in `sched-1g` chooses (operator ruling SCHED-ADDR-WITNESS-STAGE = B); its success gates every visitor exposure of a hosted or framed booking page |
| G3 | Audit entries are written to the main table, which the renderer reads | `backend/src/audit/worker.ts:22-41`; `infra/lib/renderer-hosting.ts:272`; precedent with a visitor's email: `backend/src/contact/send.ts:113-120` (OBSERVED) | SCHED-AUDIT-PII = C (ratified): booking events go to `BOOKING#.history` in the private table (§ 4.4, § 6.5) |
| G4 | reCAPTCHA fails open when the function has no secret | `backend/src/lib/recaptcha.ts:41-53`; `backend/src/orders/create.ts:95-96`; per-function wiring `infra/lib/api-commerce.ts:220`, `:394` (OBSERVED) | § 9.1 infra assertion |
| G5 | The root layout `app/[siteId]/layout.tsx` injects analytics, Paddle, the Facebook pixel, reCAPTCHA, the cookie banner and popups into every page under it | `renderer/src/app/[siteId]/layout.tsx:281-302`, `:446` (OBSERVED) | § 10.1; decision SCHED-PAGE-LAYOUT |
| G6 | Preview pages are always rewritten to the `%5Fdyn` twin; query-bearing production pages too | `renderer/middleware.ts:219-299` (OBSERVED) | § 10.1: the booking rewrite runs before these branches |
| G7 | A tenant created without a domain gets `domain = <id>.localhost`, not "no domain" | `backend/src/tenant/create.ts:37` (OBSERVED) | § 8.2 link base |
| G8 | `mapTenant` maps no `recaptcha` field, so the page's `config.recaptcha?.siteKey` is always absent and every page uses the deployment site key, while the backend uses the tenant's secret when the tenant set both keys: the pair differs for such a tenant (pre-existing, every form) | `renderer/src/lib/dynamo.ts:120-188`; `renderer/src/app/[siteId]/layout.tsx:277`, `:295`; `backend/src/lib/recaptcha.ts:32-39` (OBSERVED); failure INFERRED | § 9.1: one mapping rule closes it for every page |
| G9 | Next.js does not route a folder whose name starts with `_`; the repository uses the encoded folder `%5Fdyn` | `renderer/src/app/[siteId]/%5Fdyn` (OBSERVED) | § 10.1 folder `%5Fbook` |
| G10 | CloudFront forwards every query string to the renderer; only an allowlist is in the cache key | `infra/lib/renderer-hosting.ts:476`, `:568` (OBSERVED) | § 10.1: booking responses are never stored, so query parameters reach the page |
| G11 | The RENDERER key resolves to `{ role: "RENDERER", tenantId: "ALL" }`; `requireRole` admits `GLOBAL_ADMIN` before it reads the allowed list | `backend/src/auth/authorizer.ts:147`; `backend/src/auth/policy.ts:39` (OBSERVED) | § 10.2, § 10.3 role oracle |

## 4. Domain model (pure; `packages/shared`)

Notation: TypeScript. Every union is closed and every `switch` over it ends with an `assertNever` arm, so a new
variant breaks the compile at every site that must change. The guarantee is real only because `npm run typecheck`
(`tsc --noEmit`, strict) is in the Definition of Done of every build slice (CLAUDE.md). The same Zod schemas
validate stored items and request bodies.

Time types: `Instant` = epoch **milliseconds** (number) in the kernel and in stored maps; UTC ISO-8601 with `Z`
and milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`, fixed width, so string order = time order) in keys and DTOs;
DynamoDB `ttl` = epoch **seconds** (`Math.floor(ms / 1000)`), used only on the five item kinds § 6.2 marks. `LocalDate` = `"YYYY-MM-DD"`, `LocalTime` =
`"HH:MM"`, `TimeZone` = an IANA name accepted by `Intl.DateTimeFormat(undefined, { timeZone })`.

### 4.1 Tenant settings (main table, `TenantConfig`; not customer data)

| Field | Type | Default | Use | Source |
|---|---|---|---|---|
| `schedulingEnabled` | boolean | `false` | visitor routes, reminder job and feed answer only when `true` | base plan lines 203-219 (renamed from `appointmentsEnabled`: both shapes; name as `sched-frame-1.md` item 7) |
| `scheduling.timezone` | TimeZone, optional | none | wall time of availability rules and new runs; enabling without it → 400 | D3. No default: a default zone would shift every time of a tenant elsewhere |
| `scheduling.holdMinutes` | integer | 30 | life of a hold | D12; draft § 4 |
| `scheduling.changeCutoffHours` | integer | 24 | cancel or move allowed until this many hours before the start | D12 ("inside the tenant's window") |
| `scheduling.reminderHours` | integer | 24 | reminder this many hours before the start; 0 = none | draft § 7 |
| `scheduling.bookingHorizonWeeks` | integer | 8 | a visitor slot may start on a local date up to `today + 7 × weeks` days (§ 5.5 `lastBookableDate`); admin writes are not limited by it, and seats in group runs are not (operator decision, § 15; § 23.3) | D17 |
| `scheduling.embedOrigins` | string[] | `[]` | owned by `sched-frame-1` | `sched-frame-1.md` item 2 |
| `schedulingEmailConfig.templates` | record key → template | `{}` | tenant overrides of the seven mails (§ 11) | F6 pattern |

### 4.2 Appointment side (scheduling-private table)

```ts
type Resource = { id: string; name: string; feedSecretHash?: string;                    // D1, D14
                 retiring?: { attemptId: string; at: Instant } };                        // § 13
type Eligibility = { kind: "all" } | { kind: "only"; resourceIds: [string, ...string[]] };   // D2
type Service = { id: string; name: string; durationMin: number; eligibility: Eligibility };  // D1, D2
type AvailabilityRule = { weekday: 1|2|3|4|5|6|7; start: LocalTime; end: LocalTime };        // D3 (ISO weekday)
type LocalWindow = { start: LocalTime; end: LocalTime };                                     // D16
type DayOverride =                                                                           // D16; § 23.2
  | { kind: "dayOff"; note?: string }
  | { kind: "dayHours"; windows: [LocalWindow, ...LocalWindow[]]; note?: string };
type DayOverrides = Record<LocalDate, DayOverride>;   // per resource; a date with no key follows the defaults
```

- `Eligibility`: "all" and "this list" exclude each other; the base plan's `eligibleResourceIds[] OR
  allResourcesEligible: true` (lines 79-82) is the boolean-plus-list shape. The list is non-empty by type.
- Slots start on a grid of the service duration from the start of each availability window (base plan open item
  lines 418-419, decided here).
- `retiring`: the fence of one removal attempt (§ 13), with its id and start. Every inventory writer that names a
  resource carries the **resource guard**: ConditionCheck `RESOURCE#<r>` `attribute_exists(SK) AND
  attribute_not_exists(retiring)` — the resource exists and no removal is under way.
- `feedSecretHash`: § 12. `note`: shown to the admin only.
- **Defaults** of a resource = its `AvailabilityRule[]` (one weekly pattern). **`DayOverride`** replaces the
  defaults of one local date for one resource: `dayOff` = no window that day; `dayHours` = exactly these windows
  that day (non-empty by type, so "no hours" has one representation, `dayOff`). Windows of one day: `end > start`,
  5-minute boundaries, sorted, no overlap, ≤ 8. The former `ClosedTime` (an instant interval with a note) is
  **removed**: a partial block inside a day is a `dayHours` whose windows leave the blocked part out, and a span of
  days is `dayOff` on each date (reason in § 23.2).
- Not modelled (no client stated a use): price, description, buffer, customer notes. Free text at a practitioner
  invites health data into a field nobody asked for.

### 4.3 Group side (scheduling-private table)

```ts
type Course = { id: string; name: string; defaultCapacity: number; languages: string[] };   // D4, D7
type Meeting = { date: LocalDate; start: LocalTime; end: LocalTime };   // D4, in the run's timezone
type RunLanguage = { kind: "notSet" } | { kind: "set"; tag: string };   // D7
type RunStatus = "open" | "closed" | "cancelled";                       // D8 (cancel); admin closes enrolment
type Run = { id: string; courseId: string; meetings: [Meeting, ...Meeting[]]; timezone: TimeZone;
             capacity: number; trainerIds: [string, ...string[]]; language: RunLanguage; groupLink?: string;
             status: RunStatus };
```

- `languages`: tags offered (e.g. `["ro","en"]`); empty = the form does not ask. A run's `set` tag and a person's
  language are one of them.
- `timezone`: copied from `scheduling.timezone` at creation (plan-courses § 3: "stored with the timezone").
- `trainerIds`: one or more `Resource` ids (D4: "one trainer or more"). A trainer is a person with a calendar,
  the same entity as a practitioner (D14).
- `groupLink`: `https:` URL; sent only to confirmed seats (D10).
- `status`: `closed` stops new visitor seats, the admin may still place; `cancelled` is final for everyone.
  "Full" and "past" are derived (F11).
- A course is linked to a product only by the later `sched-1h` specification (§ 17.2); no field here.

### 4.4 Booking (scheduling-private table; customer-private)

```ts
type BookingWhat =
  | { kind: "slot"; serviceId: string; serviceName: string; resourceId: string; start: Instant; end: Instant }  // D1
  | { kind: "seat"; courseId: string; runId: string }                                                 // D4, D5
  | { kind: "unplaced"; courseId: string };                                                           // D5

type BookingState =
  | { kind: "held"; expiresAt: Instant; mail: "pending" | "sent" | "failed" }                          // D12; § 7.2
  | { kind: "confirmed"; at: Instant }
  | { kind: "cancelled"; at: Instant; by: Actor };
type Actor = { kind: "customer" } | { kind: "admin"; email: string };     // the customer acts only by link token

type Placement =                                                           // SCHED-AUDIT-PII = C
  | { kind: "slot"; resourceId: string; start: Instant; end: Instant }
  | { kind: "seat"; runId: string }
  | { kind: "unplaced" };
type HistoryEntry =                                                        // SCHED-AUDIT-PII = C, § 22 point 1
  | { action: "created"; at: Instant; state: "held" | "confirmed"; placement: Placement }
  | { action: "confirmed"; at: Instant }
  | { action: "cancelled"; at: Instant; by: Actor }
  | { action: "moved"; at: Instant; by: Actor; from: Placement; to: Placement };

type BookingSource =
  | { kind: "visitor" }                                                                               // D12
  | { kind: "order"; orderId: string; line: number }       // D11; constructed only by sched-1h (§ 17.2)
  | { kind: "manual"; adminEmail: string; channel: string };                                          // D9

type Person = { email: string /* normalizeEmail() form */; name: string; phone?: string; language?: string };

type Booking = { id: string; ref: string; rev: number; what: BookingWhat; state: BookingState;
                 source: BookingSource; who: Person; tokenHashes: string[];
                 intentId?: string; heldUntil?: Instant; reminderSentFor?: Instant; createdAt: Instant;
                 updatedAt: Instant; history: HistoryEntry[] /* 1-50, oldest first */ };
```

| Type or field | Rule it encodes | Statement |
|---|---|---|
| `BookingWhat` | what is reserved; `unplaced` only for groups | D1, D4, D5 |
| `serviceName` in `slot` | the name at booking time; a service deleted later does not orphan a booking (§ 13) | D1 (mails and feed show it) |
| `BookingState` | held / confirmed / cancelled exclude each other; `expiresAt` and `mail` exist only while held; "expired" = `held` and `now >= expiresAt`, derived | D12 |
| `held.mail` | whether the confirm mail left (§ 7.2 replay and recovery) | D12 (the mail is the only path to confirm) |
| visitor → `held`; order and manual → `confirmed` | constructor rule of the kernel (a type per source would cost more than the check) | draft § 4 |
| `Person.email` | stored only as `normalizeEmail()` output, validated after normalization | PD-001 (`docs/platform-decisions.md:72-84`) |
| `phone` | optional, shown to the admin | draft § 3 |
| `language` | the person's language for the proposal; absent = no preference | D7 |
| `ref` | first 8 hex characters of `id`, upper case (`B-1A2B3C4D`): display only; never written to the main table (§ 6.5) | mails, admin screens, conflict lists, feed `SUMMARY` (§ 12) |
| `Actor` | who acted on a booking: the customer (by link token) or an admin (by email). Used by `cancelled` state and by history. Replaces the earlier name `CancelledBy` (same variants; the type now serves history too) | D8, D12 |
| `history` | the creating Put writes `[created]`; then one entry per change of `what` or `state`, appended **in the same `rev`-conditioned write** that makes the change (§ 7.1 booking rule), so the list and the booking cannot disagree. 1-50 entries, oldest first; a write that would make 51 drops the oldest (technical limit, § 4.5), so after 50 changes the `created` entry is gone: the stored-item rule is **non-empty**, not "starts with `created`" (`createdAt` and `source` keep the creation facts). Not recorded: token mints, `state.mail`, `reminderSentFor` (mails, not changes of the booking), and a run move (it changes `RUN#.meetings`, not the booking; the run's main-table audit records it, § 6.5) | SCHED-AUDIT-PII = C (§ 22 point 1) |
| `HistoryEntry` variants | `created` — the hold (`held`), an admin manual entry or an order line (`confirmed`); who created it is `source`, stored once on the booking. `confirmed` — only by link token, so no actor field. `cancelled` — by the customer or an admin (a held seat of a cancelled run: the admin who cancelled the run). `moved` — slot → slot, seat → seat, unplaced → seat, seat → unplaced (an admin move out, or a run cancel: `by` = that admin); carries the old and new placement | § 22 point 1 |
| `rev` | optimistic version of the booking: every change of `what`, `state` or `tokenHashes` is conditioned on it and increments it (§ 7.1) | — (concurrency, technical) |
| `tokenHashes` | hashes of every `TOKEN#` item of this booking that may still exist, oldest first, 0-20. A hash leaves the list only in the transaction that deletes its item, or after that item was deleted; so the list is never missing an existing token. Empty after a cancel (§ 8.4) | D12; operator ruling R01 |
| `intentId` | the booking intent that created it (§ 7.2) | base plan lines 139-143 |
| `heldUntil` | the `expiresAt` the hold had; set by the hold, removed by confirm, **kept by a cancel** (the held state is gone then, but the `HELD#` key still needs it). Present exactly while `HELD#<iso(heldUntil)>#<id>` exists; cleanup and erasure build that key from it (§ 14) | — (storage key, technical) |
| `reminderSentFor` | the last start for which a reminder went out (§ 11.3) | draft § 7 |

### 4.5 Bounds (every bound this specification introduces)

| Bound | Value | Kind | Reason | Trigger to change | How it is lifted |
|---|---|---|---|---|---|
| Run capacity | 1-45 | **technical limit of this version** (SCHED-SEAT-BOUND = A, ratified 2026-11-21; the human: "groups are max 10-12 people") | cancelling a run is one transaction of `2 + 2 × capacity` items under DynamoDB's 100-item limit (§ 7.6) | a named client with a group above 45 | resumable two-phase cancel: status `cancelled` first, then batches of ≤ 45 bookings, idempotent, retried until the seat map is empty |
| Meetings per run | 1-60 | technical | item size and admin screen | a course with more than 60 meetings | raise: the run item holds hundreds |
| Trainers per run | 1-10 | lower bound domain (D4), upper technical | one condition check per trainer in run writes (§ 7.6) | a run with more than 10 trainers | raise to the transaction budget |
| `durationMin` | 5-480, multiple of 5 | technical | 5-minute admin grid; one working day | a service longer than 8 h or off the grid | raise; the container (§ 7.3) has no grid |
| Availability rules per resource | ≤ 50 | technical | one item (§ 6.2) | more than 50 windows a week | split by weekday |
| Day overrides per resource (stored, from local today − 6 on) | ≤ 366 | technical | one item `DAYS#<r>` (§ 6.2); dates before the tenant's local today − 6 are pruned on each write (§ 5.5) | an admin plans more than 366 edited dates ahead | one item per resource and month (O3, § 23.6) |
| Windows per `dayHours` | 1-8 | technical | item size (366 × 8 windows fit, § 6.2) | a day with more than 8 separate open windows | raise |
| One day-edit request | ≤ 366 dates (`from`…`to`); copy-week ≤ 52 target weeks | technical | the result must fit the 366 bound | — | — |
| `bookingHorizonWeeks` | 1-52 | technical sanity range (default 8 is the operator's) | one year of open weeks; the visitor slot range stays ≤ 62 days per request | a tenant takes bookings more than a year ahead | raise |
| `history` entries per booking | ≤ 50, oldest dropped | technical (SCHED-AUDIT-PII = C, § 22) | item size of `BOOKING#` (50 × ~150 B ≈ 7.5 KB) | a booking with more than 50 real changes | raise; or move older entries to a `HIST#` item |
| Course languages | ≤ 10 | technical | form size | a course offered in more languages | raise |
| Resources, services, courses per tenant | ≤ 200 each | technical | admin lists are returned whole | a tenant above 200 | page the list (§ 6.4 rule 1) |
| `holdMinutes` | 5-1440 | technical sanity range | — | a tenant needs a longer hold | raise |
| `changeCutoffHours`, `reminderHours` | 0-168 | technical sanity range | — | a tenant needs more than a week | raise |
| Visitor slot range | ≤ 62 days per request | technical | query cost per request | a page shows more than two months at once | page by month |
| Admin appointments range | ≤ 31 days per request | technical | query cost | a longer view | page |
| Open holds per email | 2 | abuse limit (operator choice) | § 9 | real visitors refused | raise |
| Holds per email per hour | 5 | abuse limit (operator choice) | § 9 | real visitors refused | raise |
| Holds per client address per hour | 20 | abuse limit (operator choice) | § 9 | a shared office address refused | raise |
| Live link tokens per booking | 20 | operator ruling R01 | § 8.4 | — | — |
| Token view after the end | 30 days | specification choice | data minimisation | a tenant asks for longer access | raise |
| Expired holds kept | 7 days | specification choice | § 14.1 | — | — |
| Text lengths | name ≤ 200, phone ≤ 40, note ≤ 200 (day override), channel ≤ 40, URL ≤ 500 | technical | item size and logs (366 notes in one `DAYS#` item) | — | raise |
| Request body | ≤ 8 KB (renderer) | technical | abuse | — | raise |

## 5. Kernel rules (pure functions; clock and timezone passed in)

Location: `packages/shared/src/scheduling.ts` (types, rules) and `packages/shared/src/zoned-time.ts` (wall time ↔
instant), beside `payment-transition.ts` and `coupon.ts`. No I/O, no `Date.now()`, no ambient zone. `Result<T,
E>` = `{ ok: true; value: T } | { ok: false; error: E }`. Notation: `bookingId` and `resourceId` = string;
`SeatEntry` = `{ x?: Instant }`; `ContainerEntry` = `{ bookingId; s: Instant; e: Instant; x?: Instant; rev: number }` (§ 6.2; `rev` = the booking's
`rev` written in the same transaction, § 7.3).

Worked examples use `Europe/Bucharest` (UTC+2 winter, UTC+3 summer; 2026-10-25 04:00 summer → 03:00; 2027-03-28
03:00 winter → 04:00).

### 5.1 Zoned time

```ts
localToInstant(date: LocalDate, time: LocalTime, tz: TimeZone): Result<Instant, { kind: "nonexistentLocalTime" }>
instantToLocal(at: Instant, tz: TimeZone): { date: LocalDate; time: LocalTime }
```

Rule: a local time in a spring gap is refused; an ambiguous local time takes the earlier instant. Implementation
with `Intl.DateTimeFormat` offsets (Node 22 ships full ICU), no date library.

Examples: `2026-12-07 09:00` → `2026-12-07T07:00:00.000Z`; `2027-03-29 09:00` → `…06:00:00.000Z`;
`2027-03-28 03:30` → `nonexistentLocalTime`; `2026-10-25 03:30` → `2026-10-25T00:30:00.000Z` (not `01:30Z`).

### 5.2 Appointment shape

**Unchanged from the base plan** (lines 89-112, 145-150): slot generation is a pure function of service,
resources, rules, existing bookings, timezone and an injected `now`; storage uses UTC instants; rules use local
wall time; the kernel detects, the database enforces; "any available" is discover-then-conditionally-write with
a deterministic pick and a retry on the next candidate.

**Changed** (amendment § 16.1): the windows of a day come from the defaults or that date's override (`dayWindows`,
§ 5.5); existing bookings are busy intervals (held unexpired + confirmed); a visitor start must fall on or before
the tenant's last bookable date (§ 5.5); a submitted start is re-checked at write time (`slotDecision`); the guard
is the resource-day container (§ 7.3), not a lock per start; the customer is identified by a link token, not a
session; a move keeps the booking id (§ 8.5).

```ts
availableSlots(input: {
  service: Service; resources: Resource[]; rules: Record<resourceId, AvailabilityRule[]>;
  days: Record<resourceId, DayOverrides>; busy: { resourceId: string; start: Instant; end: Instant }[];
  from: LocalDate; to: LocalDate; lastBookableDate: LocalDate; tz: TimeZone; now: Instant;
}): Result<{ day: LocalDate; starts: { start: Instant; freeResourceIds: string[] }[] }[],
           { kind: "rangeInverted" } | { kind: "rangeTooLong"; maxDays: 62 }>

slotDecision(input: { service: Service; resource: Resource; rules: AvailabilityRule[]; days: DayOverrides;
                      start: Instant; lastBookableDate: LocalDate; tz: TimeZone; now: Instant })
  : Result<{ end: Instant }, SlotRefusal>
type SlotRefusal = { kind: "inPast" } | { kind: "beyondHorizon"; lastBookableDate: LocalDate }
                 | { kind: "notEligible" } | { kind: "resourceUnavailable" }
                 | { kind: "notOnGrid" } | { kind: "outsideAvailability" }

overlapCheck(candidate: { start: Instant; end: Instant }, entries: ContainerEntry[], now: Instant,
             self?: string): Result<void, { kind: "overlap"; bookingId: string }>
pickResource(freeResourceIds: string[]): string        // lowest id in string order; the caller retries the next
```

- **Slots**: for each eligible resource and each local day `d` with `from <= d <= min(to, lastBookableDate)`, each
  window of `dayWindows(rules, days[d], d)` gives starts at `windowStart + k × duration` while
  `start + duration <= windowEnd`; kept when after `now`, not overlapping a busy interval of that resource, and the
  local time exists. Days after `lastBookableDate` are returned with no starts (the range check of 62 days is on
  `from`…`to` as sent). Intervals are half-open `[start, end)`. Example: 60 min, Monday 09:00-12:00, day
  2026-12-07, busy `08:00Z-09:00Z`, `now` 2026-12-01 → `07:00Z`, `09:00Z`. The same day with the override
  `dayHours [09:00-10:00, 11:00-12:00]` and no busy interval → `07:00Z`, `09:00Z`; with `dayOff` → none.
- **slotDecision** (visitor holds and visitor moves): checks in this order — `inPast` (`start <= now`);
  `beyondHorizon` (the start's local date `> lastBookableDate`); `notEligible`; `resourceUnavailable`; then the
  start must be exactly a start that `availableSlots` would offer for that resource, busy intervals aside (they are
  the container's job): a start inside the day's windows but off their grid → `notOnGrid`; any other start (on a
  `dayOff` date, outside every window of the day, or in a part an edit removed) → `outsideAvailability`. Examples:
  the same service and window, start `07:30Z` → `notOnGrid`; start `2026-11-30T07:00Z` with `now` 2026-12-01 →
  `inPast`; a resource outside `only` → `notEligible`; `dayOff` on 2026-12-07 and start `07:00Z` →
  `outsideAvailability`; `lastBookableDate` 2027-01-26 and start `2027-01-27T07:00Z` → `beyondHorizon`.
- **Admin writes** (manual booking, admin move) skip `slotDecision`: the admin may book outside the windows, off
  the grid, on a day off, beyond the horizon or for any resource. They are bound by: a known service (its duration),
  a known resource that passes the resource guard (§ 4.2), and `overlapCheck`. Decided here: the practitioner's own
  entries must not be blocked by the visitor rules.
- **overlapCheck** example: entries `{A: 07:00Z-08:00Z held, x 2026-12-01T10:00Z}`, candidate `07:30Z-08:00Z`,
  `now` 09:59Z → `overlap(A)`; `now` 10:00Z → ok (A expired).

### 5.3 Common rules

```ts
isActive(state: BookingState, now: Instant): boolean      // held && now < expiresAt, or confirmed
holdExpiry(now: Instant, holdMinutes: number): Instant
confirmDecision(b: Booking, now: Instant): Result<"apply" | "noop", ConfirmRefusal>
type ConfirmRefusal = { kind: "expired"; at: Instant } | { kind: "cancelled" }
changeDecision(b: Booking, startOf: Instant | null, now: Instant, cutoffHours: number,
               action: "cancel" | "move", actor: "customer" | "admin"): Result<void, ChangeRefusal>
type ChangeRefusal = { kind: "tooLate"; cutoff: Instant } | { kind: "notActive"; state: "expired" | "cancelled" }
                   | { kind: "notConfirmed" } | { kind: "paidContactTenant" }
tokenView(b: Booking, endOf: Instant | null, now: Instant): "valid" | "gone"
appendHistory(h: HistoryEntry[], e: HistoryEntry): HistoryEntry[]   // h + e, keeping the newest 50 (§ 4.4)
bookingBase(tenant: { id: string; domain?: string }, cloudFrontOrigin: string): string
```

| Rule | Statement | Example |
|---|---|---|
| **Confirm**: `held` and `now < expiresAt` → apply; `confirmed` → noop (200); held expired → `expired`; cancelled → `cancelled`. No capacity recount: the seat or time was taken at hold time; the persistence layer also requires the container entry to be present with the same `x` (§ 7.3, § 7.4) | D12 | `x` 10:30Z: `now` 10:29Z → apply; 10:30Z → expired |
| **Customer change** (link): cancel allowed for held or confirmed; move only for confirmed (a held booking is cancelled and booked again); both before `start − cutoffHours`; `unplaced` has no start and is always inside the window; an `order` booking → `paidContactTenant` | D12, D11 | start 2026-12-07T07:00Z, 24 h: `now` 2026-12-06T06:59Z → ok; 07:00Z → `tooLate` |
| **Admin change**: cancel any active booking; move confirmed or unplaced bookings; no time window | D8 | admin moves a booking that starts in one hour → ok |
| **Token view**: `valid` while not cancelled and `now < end + 30 days` (slot end, or last meeting end); `unplaced` is valid while unplaced; a cancel removes the tokens (§ 8.4), so a cancelled booking has no link | D12 | slot end 2026-12-07T08:00Z → valid until 2027-01-06T08:00Z |
| **Link base**: `https://<domain>` when `domain` is set and does not end with `.localhost`; else `<cloudFrontOrigin>/_site/<id>` | D13; G7 | `{id:"atelier", domain:"atelier.localhost"}` → `https://d1.cloudfront.net/_site/atelier` |

### 5.4 Group shape

```ts
activeSeats(seats: Record<bookingId, SeatEntry>, now: Instant, excluding?: string): number
seatDecision(run: Run, seatsTaken: number, firstStart: Instant, person: Person, actor: "visitor" | "admin",
             now: Instant): Result<{ languageAfter: RunLanguage }, SeatRefusal>
type SeatRefusal = { kind: "runCancelled" } | { kind: "runClosed" } | { kind: "runStarted" }
                 | { kind: "runFull"; capacity: number } | { kind: "languageMismatch"; run: string; person: string }
propose(runs: { run: Run; taken: number; firstStart: Instant }[], personLanguage: string | undefined,
        now: Instant): Proposal
type Proposal = { kind: "proposed"; run: string; others: string[] } | { kind: "choose"; runs: string[] }
              | { kind: "noneOpen" }
validateMeetings(m: Meeting[], tz: TimeZone): Result<[Meeting, ...Meeting[]], MeetingError>
type MeetingError = { kind: "empty" } | { kind: "endNotAfterStart"; index: number }
                  | { kind: "overlap"; a: number; b: number } | { kind: "nonexistentLocalTime"; index: number }
                  | { kind: "tooMany"; max: 60 }
cancelRunEffects(seats: Record<bookingId, SeatEntry>, now: Instant): { toUnplace: string[]; toCancel: string[] }
```

| Rule | Statement | Example |
|---|---|---|
| **Seats, visitor**: refused when `cancelled`, `closed`, `now >= firstStart`, `taken >= capacity`, or the language is incompatible | D4, D5, D7 | capacity 8; 5 confirmed + 2 held unexpired + 1 held expired → taken 7 → ok; the next one → `runFull(8)` |
| **Seats, admin**: refused when `cancelled` or `taken >= capacity`; not bound by `closed`, "started" or language | D7, D8 | admin into a `closed` run with 6/8 → ok; into a `cancelled` run → `runCancelled` |
| **Proposal**: candidates = `open`, not started, `taken < capacity`, language `notSet` or equal (no person language = all). None → `noneOpen`; some with `taken > 0` → `proposed` = most taken, then earliest first meeting, then lowest id; `others` = the rest by first meeting; all empty → `choose` | D6, D7 | person `ro`; R1 `ro` Dec 5 3/8, R2 `notSet` Dec 12 0/8, R3 `en` Dec 6 5/6, R4 `ro` Dec 19 6/8 → `proposed(R4)`, others `[R1, R2]`, R3 never shown |
| **Language**: `languageAfter = set(L)` when the run is `notSet` and the person has `L`; otherwise unchanged; an admin placement never changes it | D7 | R2 `notSet` + `ro` → `set(ro)` |
| **Meetings**: 1-60, each `end > start` on one local day, no overlap, sorted on output, each local time exists | D4 | `[{12-05 10:00-13:00}, {12-06 10:00-09:00}]` → `endNotAfterStart(1)` |
| **Move a person**: `seatDecision` on the target run of the same course, with the actor's rules; source entry excluded when source = target | D8 | visitor moves to a `closed` run → `runClosed`; admin → ok |
| **Move a run**: `validateMeetings` on the new list; people stay | D8 | — |
| **Cancel a run**: confirmed seats → `unplaced`; held unexpired seats → cancelled (`by admin`); expired entries ignored | D8 | A confirmed, B held, C expired → `toUnplace [A]`, `toCancel [B]` |

### 5.5 Week planner (D16-D18; § 23)

```ts
dayWindows(rules: AvailabilityRule[], override: DayOverride | undefined, date: LocalDate)
  : { source: "default" | "dayHours" | "dayOff"; windows: LocalWindow[] }
lastBookableDate(now: Instant, tz: TimeZone, horizonWeeks: number): LocalDate
activeEntries(raw: ContainerEntry[], span: { start: Instant; end: Instant }, now: Instant): ContainerEntry[]
                                 // raw = every entry of the RESDAY# items one AP3 query returned; no error case
planDay(input: { rules: AvailabilityRule[]; days: DayOverrides; date: LocalDate;
                 entries: ContainerEntry[] /* activeEntries(raw, that local day, now) */; tz: TimeZone; now: Instant })
  : PlannedDay
type PlannedDay =
  | { kind: "past"; date: LocalDate; entries: string[] }      // older than the kept range: overrides pruned
  | { kind: "planned"; date: LocalDate; source: "default" | "dayHours" | "dayOff"; windows: LocalWindow[];
      removed: LocalWindow[]; note?: string; entries: string[]; open: { start: Instant; end: Instant }[];
      outsideHours: string[] };
type DaySetting = DayOverride | { kind: "default" };          // "default" = remove the override of that date
type DaysEdit =
  | { kind: "set"; from: LocalDate; to: LocalDate; value: DaySetting }
  | { kind: "copyWeek"; sourceStart: LocalDate; targetStart: LocalDate; weeks: number };
editDays(current: DayOverrides, edit: DaysEdit, today: LocalDate)
  : Result<{ next: DayOverrides; changed: LocalDate[] }, DaysEditError>
type DaysEditError = { kind: "rangeInverted" } | { kind: "rangeTooLong"; maxDays: 366 }
                   | { kind: "startsInPast"; today: LocalDate } | { kind: "sourceTooOld"; oldest: LocalDate }
                   | { kind: "weekdayMismatch" } | { kind: "targetOverlapsSource" }
                   | { kind: "tooManyDays"; max: 366 };
weekMailDue(now: Instant, tz: TimeZone): { kind: "due"; weekStart: LocalDate } | { kind: "notDue" }
```

| Rule | Statement | Example (`Europe/Bucharest`) |
|---|---|---|
| **Precedence** (one rule, used by `availableSlots`, `slotDecision` and `planDay`): an override of date `d` replaces the defaults of `d` entirely — `dayOff` → no window; `dayHours` → exactly its windows; no override → the rules whose `weekday` is the ISO weekday of `d`. Overrides never merge with the defaults. Then, for visitors only, the horizon; then busy intervals | D16 | defaults Mon 09:00-17:00; override of Mon 2026-12-07 `dayHours [09:00-12:00]` → that Monday 09:00-12:00; Mon 2026-12-14 (no override) → 09:00-17:00; override `dayHours [10:00-12:00]` on Sun 2026-12-13 (no Sunday default) → Sunday open 10:00-12:00 |
| **Horizon**: `lastBookableDate = localDate(now, tz) + 7 × horizonWeeks` days; a visitor start is allowed when its local date `<= lastBookableDate` | D17 | `now` 2026-12-01T10:00Z, 8 weeks → `2027-01-26`; a slot on 2027-01-26 23:00 local → allowed; 2027-01-27 09:00 → `beyondHorizon` |
| **activeEntries** (pure; the one normalization of an interval read, used by the four display consumers: planner week, all-resource appointments read, day-edit answer, weekly mail; operator scope freeze after review-2): (1) group `raw` by `bookingId`; (2) in each group keep only the entries with the **highest `rev`**; (3) keep those whose `[s, e)` intersects `span`; (4) keep the active ones (`x` absent, or `now < x`); one entry per booking remains (copies with the same `rev` were written in one transaction, § 7.3, and are equal; the function keeps the first in key order). No reread, no retry, no `busy`, no corruption report: the read path reports nothing. **Why `rev` decides**: every write that adds or changes an entry also changes the booking and writes the booking's new `rev` into the entry in the same transaction (§ 7.3), so among the copies one query saw, the highest `rev` is the newest committed placement. A `Query` over several `RESDAY#` items has no snapshot across items (AWS transaction isolation documentation, INFERRED), so a confirm or a move that commits during the query can show an old copy and a new one; step 2 keeps the new one. **Limit** (accepted for displays): a read made during concurrent writes can show a booking in an older state — for example a booking cancelled during the read still shown (the cancel removes the entries; the query saw one before removal), or a booking moved during the read shown in its old place when the query saw no new copy. The guarantee is only: the highest `rev` the query returned; there is no bound on how old that is, and a later read (eventually consistent) can still be stale. No write decides on these reads: every writer decides on its own `ConsistentRead` of the container under the versions of § 7 | § 7.3; D16 | local 01:30-02:30 on 2026-12-07 (Bucharest) = `2026-12-06T23:30Z`-`2026-12-07T00:30Z`: in `RESDAY#<r>#2026-12-06` and `#2026-12-07`, both `rev 3`; the planner day 2026-12-07 reads both UTC dates (the local day is `2026-12-06T22:00Z`-`2026-12-07T22:00Z`) → one entry. A query that saw the held copy `{s,e,x, rev 3}` in one day and the confirmed copy `{s,e, rev 4}` in the other → the confirmed one |
| **planDay** (`entries` = `activeEntries(raw, D, now)` with the local day `D = [localStart(date), localStart(date + 1))` as instants, so a booking across local midnight belongs to both days): `kind: "past"` when `date < today − 6` (the kept range ends there, see `editDays`), with only the entry ids. Otherwise: `entries` = the ids of the given entries; `windows` = `dayWindows`; `removed` = default windows minus `windows` (the parts an edit took away; `[]` for `default`); `open` = `windows` as instants minus those entries; `outsideHours` = ids of those entries whose **part inside `D`**, `[max(s, start of D), min(e, end of D))`, is not inside one window of `date`. A window bound in a spring gap is taken at the first local minute that exists after it | D16 | defaults Mon 09:00-17:00; Mon 2026-12-07 `dayHours [09:00-12:00, 13:00-17:00]`; a confirmed entry 12:00-13:00 local → `removed [12:00-13:00]`, `outsideHours [that id]`, `open` 07:00Z-10:00Z and 11:00Z-15:00Z. An admin booking local 2026-12-07 23:30 - 2026-12-08 00:30 with 2026-12-08 set to `dayOff` → in `entries` of both days, in `outsideHours` of 2026-12-08 (its part 00:00-00:30 has no window) and of 2026-12-07 when 23:30-24:00 is outside that day's windows |
| **editDays `set`**: `from <= to` else `rangeInverted`; `to − from + 1 <= 366` else `rangeTooLong`; `from >= today` else `startsInPast`; each date of the range gets `value` (`default` removes its key) | D16 | `set 2026-12-24…2026-12-27 dayOff` with today 2026-12-01 → 4 keys `dayOff` |
| **editDays `copyWeek`**: `sourceStart` and `targetStart` have the same ISO weekday, else `weekdayMismatch`; `sourceStart >= today − 6`, else `sourceTooOld` (older dates may be pruned, so the source would read as defaults); `targetStart >= today`, else `startsInPast`; the 7 source dates and the `7 × weeks` target dates are disjoint, else `targetOverlapsSource`; for `k` in `0…weeks−1` and `i` in `0…6`, date `targetStart + 7k + i` takes the state of `sourceStart + i` (its override copied, or its key removed when the source date has none). The source is read once, before any target is written | D16 | source Mon 2026-12-07 (Mon `dayHours [09:00-12:00]`, other days default), target Mon 2026-12-14, 3 weeks → Mondays 14, 21, 28 Dec get `dayHours [09:00-12:00]`; the other 18 target dates lose any override |
| **Pruning and bound** (both edits): keys with a date `< today − 6` are removed from `next` (the kept range always holds the whole current week, so "copy this week" on a Wednesday still copies Monday's edit); then more than 366 keys → `tooManyDays`. `changed` = the dates whose state differs between `current` and `next`, pruned keys excluded | — (technical, § 4.5) | — |
| **weekMailDue**: due when the local weekday of `now` is Sunday (ISO 7) and the local time is 09:00 or later; `weekStart` = the next local date (the Monday). So it stops being due when the target Monday starts (local 00:00), which ends the retries of § 11.4 | D18 | `2026-12-06T06:59Z` (08:59 local) → `notDue`; `07:00Z` → `due 2026-12-07`; `2026-12-06T21:59Z` (Sun 23:59 local) → `due 2026-12-07`; `2026-12-06T22:00Z` (Mon 00:00 local) → `notDue`; `2026-12-05T23:00Z` (Sun 01:00 local) → `notDue` |

## 6. Storage

### 6.1 Table

One scheduling-private DynamoDB table (SCHED-TABLE = A, ratified 2026-11-21): `PAY_PER_REQUEST`, point-in-time recovery, TTL
attribute `ttl` (epoch seconds), `RemovalPolicy.RETAIN`, no GSI, keys `PK`/`SK` strings. Every item has
`PK = TENANT#<tenantId>`. The renderer's role gets no statement on it. Variable `SCHEDULING_TABLE_NAME` on the
scheduling functions only.

**TTL rule** (operator ruling, cycle 4): no item that holds customer data, or is the only path to such an item,
carries a TTL. TTL is used only on items with no plaintext customer data whose loss needs no cleanup of any other
item; § 6.2 states for each why its expiry alone is safe. No rule depends on when TTL deletes (DynamoDB deletes
expired items in the background, not at the instant).

**Item set of a booking**: `BOOKING#`, `CUST#`, its `TOKEN#` items, `INTENT#` (when a hold created it), `HELD#`
(while it was never confirmed), `UNPLACED#` (while unplaced). `BOOKING#` and `CUST#` are created in one
transaction and removed in one transaction (the expiry cleanup of § 14.1 or the erasure of § 14.2); no other
operation creates or deletes either.

### 6.2 Items

| SK pattern | Attributes | Written by | Customer data |
|---|---|---|---|
| `RESOURCE#<resourceId>` | name, feedSecretHash?, retiring? | admin (`1d`) | no |
| `SERVICE#<serviceId>` | name, durationMin, eligibility | admin (`1e`) | no |
| `AVAILABILITY#<resourceId>` | `rules` (list ≤ 50) | admin (`1e`); one Put replaces the list | no |
| `DAYS#<resourceId>` | `v` (integer ≥ 1, server-side only), `days` (map `LocalDate` → `DayOverride`, ≤ 366 keys; keys before the tenant's local today − 6 pruned on each write, § 5.5) | admin day edits (`1e`): one Put replaces the map, conditioned on the `v` the server read (one retry after a lost condition, § 10.3; no container rule: nothing counts entries in it) | no |
| `COURSE#<courseId>` | name, defaultCapacity, languages | admin (`1f`) | no |
| `RUN#<courseId>#<runId>` | meetings, timezone, capacity, trainerIds, language, groupLink?, status, firstStartIso, lastEndIso, `v`, `seats` (map bookingId → `{ x? }`) | admin; seat writes | booking ids only |
| `RUNSPAN#<lastEndIso>#<courseId>#<runId>` | `firstStartIso` only (its one copied attribute, which changes only with the meetings) | run create (put), run move (delete old + put new), run cancel (delete) — each in the same transaction as `RUN#`; no other run write changes the meetings | no |
| `RESDAY#<resourceId>#<utcDate>` | `v`, `entries` (map bookingId → `{ s, e, x?, rev }`; `s`, `e`, `x` in ms; `rev` = the booking's `rev` after the same transaction, § 7.3) | slot writes | booking ids only |
| `BOOKING#<bookingId>` | the `Booking` record (§ 4.4), including `history`; no TTL | every booking write | **yes** |
| `TOKEN#<sha256hex(token)>` | bookingId, createdAt; no TTL | every mail with a link; deleted by cancel, by the expiry cleanup and by erasure | no (a hash). A token item that outlives its booking can do nothing: the lookup finds no `BOOKING#` and answers 404 |
| `CUST#<normalizedEmail>#<bookingId>` | keys only; no TTL | created with its `BOOKING#`; removed with it (§ 14) | **yes** (email in key) |
| `HELD#<expiresAtIso>#<bookingId>` | keys only; no TTL | put by the hold transaction; deleted by confirm (same transaction) and by the expiry cleanup | no (a booking id). It exists exactly while the booking was never confirmed, and exactly while `BOOKING#.heldUntil` is present (its key is built from that value) |
| `UNPLACED#<courseId>#<bookingId>` | keys only | a booking becomes / stops being unplaced | booking id only |
| `HOLDS#<sha256hex(normalizedEmail)>` | `v`, `entries` (map bookingId → `{ x }`), `ttl` = latest `x` + 1 day | hold, confirm, cancel | no plaintext (an email hash). **TTL safe**: when it expires every entry has expired; its loss only resets an abuse count |
| `INTENT#<uuid>` | fingerprint (a hash), bookingId, `ttl` (24 h) | hold; deleted with its booking (§ 14) | no. **TTL safe**: after 24 h a replay of the same form is treated as a new request; nothing else reads it |
| `LIMIT#EMAIL#<sha256hex(normalizedEmail)>#<hourNumber>` | count, `ttl` (2 h) | hold, resend | no plaintext (an email hash, pseudonymous; eligible for TTL deletion 2 h after its hour, deleted by DynamoDB some time after). **TTL safe**: a counter of a past hour |
| `LIMIT#ADDR#<sha256hex(addressKey)>#<hourNumber>` | count, `ttl` (2 h) | hold (SCHED-ADDR-LIMIT = A, ratified) | no plaintext (an address hash). **TTL safe**: a counter of a past hour |
| `WEEKMAIL#<weekStart>` | `claimedAt` (first send attempt), `sentAt?` (written only after SES accepted the mail), `ttl` = `weekStart` + 14 days | the weekly mail (§ 11.4): claim before the first attempt, `sentAt` after acceptance | no. **TTL safe**: only the runs of the Sunday before `weekStart` read it; after that week nothing does |

`x` present = held until `x`; absent = confirmed. `v` = container version (§ 7.1). `hourNumber` =
`Math.floor(ms / 3600000)`. Item sizes (INFERRED from attribute lengths): `RUN#` ≤ 60 × ~50 B + 45 × ~50 B ≈ 6 KB;
`RESDAY#` ≤ 96 entries × ~80 B ≈ 8 KB; `DAYS#` ≤ 366 × (date ~12 B + kind ~15 B + 8 windows × ~35 B + note
≤ 200 B) ≈ 186 KB at the worst case of every bound at once, typically under 5 KB; `BOOKING#` with 50 history
entries ≈ 10 KB; all under 400 KB.

### 6.3 Access patterns (all `PK = TENANT#<tenantId>`; no scan)

Range bounds: a key with a suffix after the instant is bounded above by `<prefix><iso>#\uffff` (`\uffff` sorts
after every ASCII suffix; written `\uffff` here, it is the one code point U+FFFF in the key string, not six
characters); an open upper end is `<prefix>\uffff`.

| # | Need | Request | Projection |
|---|---|---|---|
| AP1 | Booking by id | Get `BOOKING#<id>` | whole item |
| AP2 | Booking by token | Get `TOKEN#<hash>` → AP1 | `bookingId` |
| AP3 | Intervals of one resource over UTC dates `d1..d2` | Query `SK BETWEEN RESDAY#<r>#<d1> AND RESDAY#<r>#<d2>` (exact keys) | `SK, entries` |
| AP4 | Runs of a course (admin list, proposal) | Query `begins_with(SK, RUN#<courseId>#)` | all attributes; `seats` is reduced to counts before any DTO |
| AP5 | One run for a seat write | Get `RUN#<courseId>#<runId>`, `ConsistentRead` | whole item |
| AP6 | Runs not ended by an instant `t` (feed, reminders, trainer check) | Query `SK BETWEEN RUNSPAN#<tIso> AND RUNSPAN#\uffff`, keep `firstStartIso <= windowEnd`, then BatchGet `RUN#` (§ 6.4) and filter on the run's own `status` and `trainerIds` (never on a copy) | `SK, firstStartIso`; then `RUN#`: `SK, status, trainerIds, meetings, timezone, firstStartIso, seats` |
| AP7 | Roster of a run | AP5 → BatchGet `BOOKING#<id>` for the keys of `seats` (≤ 45, one call) | `id, ref, who, state, source` |
| AP8 | Unplaced people of a course | Query `begins_with(SK, UNPLACED#<courseId>#)` → BatchGet AP1 | keys; then `id, ref, who, source, createdAt` |
| AP9 | All bookings of one person | Query `begins_with(SK, CUST#<email>#)` → AP1 | keys |
| AP10 | Config | Query `begins_with(SK, RESOURCE#)`, `SERVICE#`, `COURSE#`; Get `AVAILABILITY#<r>`, `DAYS#<r>` (for several resources: one BatchGet of both keys per resource, § 6.4 rule 2) | resources: `SK, name, feedSecretHash` (→ `hasFeed`); `retiring` never in a DTO; `AVAILABILITY#`: `rules`; `DAYS#`: `v, days` |
| AP11 | Idempotency | Get `INTENT#<uuid>` | whole item |
| AP12 | All tenants (the reminder job and the weekly mail then keep those with the switch on; the daily cleanup keeps all) | main table Query `PK = SYSTEM, begins_with(SK, TENANT#)` (pattern `backend/src/tenant/list.ts:17-20`) | `id, name, domain, Domain, schedulingEnabled, scheduling, schedulingEmailConfig, integrations.contactEmail` |
| AP13 | Holds expired more than 7 days (daily cleanup, § 14.1) | Query `SK BETWEEN HELD# AND HELD#<now − 7 days, ISO>#\uffff` | keys (`bookingId` from the key) |
| AP14 | Weekly-mail marker (§ 11.4) | `UpdateItem WEEKMAIL#<weekStart>` `SET claimedAt = if_not_exists(claimedAt, :now), ttl = :ttl`, `ReturnValues: ALL_NEW` (the update is the read); after SES acceptance `SET sentAt = :now` | `sentAt` |

Projections checked against every consumer (a consumer reads nothing that is not listed here):

| Consumer | Reads (with projection) | Fields it needs and where they come from |
|---|---|---|
| Calendar feed (§ 12) | tenant Get (`schedulingEnabled`); `RESOURCE#` (`feedSecretHash`); AP3; BatchGet `BOOKING#` (`id, ref, what, state`); AP6 → BatchGet `RUN#` (as AP6); BatchGet `COURSE#` (`name`) | slot times and `serviceName` from `BOOKING#.what`; meeting times from `RUN#.meetings` converted with **`RUN#.timezone`** (never the tenant's current zone); course name from `COURSE#`; no `who` is read |
| Reminder job (§ 11.3) | AP12 (as AP12); AP3; AP6 → BatchGet `RUN#`; BatchGet `COURSE#` (`name`); Get `BOOKING#` (whole: `who` is the recipient) | link base from `domain`/`Domain` and `id` (`bookingBase`, § 5.3); template override from `schedulingEmailConfig.templates.reminder`, else the default; `{{siteName}}` from `name`; `{{when}}` for a seat from `RUN#.meetings` in `RUN#.timezone`, for a slot from `what.start` in `scheduling.timezone`; token mint from `rev`, `tokenHashes` |
| Daily cleanup (§ 14.1) | AP12 (`id`), every tenant whatever the switch; AP13; Get `BOOKING#` (`rev, who, tokenHashes, intentId, heldUntil, state`) | `CUST#` key from `who.email`; `HELD#` key from the query; tokens and intent to delete |
| Resource removal check (§ 13) | AP3; AP6 → BatchGet `RUN#` (`trainerIds, status, meetings`) | future entries; trainer use in runs not ended |
| Proposal and runs DTOs (§ 10.2) | AP4 (all attributes) | `timezone`, `meetings`, `language`, `status`, `capacity`, `seats` counts |
| Visitor slots, hold and move of a slot (§ 10.2) | tenant Get (`schedulingEnabled`, `scheduling`); AP10 `SERVICE#<s>` and `RESOURCE#` (eligible ones); BatchGet `AVAILABILITY#<r>` (`rules`) + `DAYS#<r>` (`days`) per eligible resource; AP3 per eligible resource over the UTC dates of the range | `lastBookableDate` from `scheduling.timezone` and `scheduling.bookingHorizonWeeks` (absent → 8); windows from `rules` + `days` (§ 5.5 precedence); busy from `entries`. Writes decide on `ConsistentRead` (§ 6.4 rule 4) |
| Planner week (§ 10.3, `sched-1e`) | tenant Get (`scheduling`); Get `RESOURCE#<r>` (`name`); Get `AVAILABILITY#<r>` (`rules`), `DAYS#<r>` (`days`); AP3 for `<r>` over the UTC dates that touch the 7 local days (projection `SK, entries`), then `activeEntries` per local day (§ 5.5); BatchGet `BOOKING#` (`id, ref, what, state, who.#name`) for the entry ids | windows, `removed`, `open`, `entries`, `outsideHours` from `planDay`; entry times from `RESDAY#.entries`; ref, service name and customer name from `BOOKING#` (admin screen, private table only) |
| All-resource appointments (§ 10.3, `GET /scheduling/admin/appointments`, `sched-1e`) | tenant Get (`scheduling.timezone`); AP10 `RESOURCE#` (`SK, name`); per resource AP3 over the UTC dates that touch the local days `from`…`to`, then `activeEntries` with the span of those local days (§ 5.5); BatchGet `BOOKING#` (`id, ref, what, state, who.#name`) for the entry ids (§ 6.4 rule 2) | per resource: `resourceId` and `name` from `RESOURCE#`; per entry `bookingId`, `start`/`end` from the entry's `s`/`e`, `state` from `x` (present = held), `ref` from `BOOKING#` (equal to the id prefix), `customerName` from `who.name`, `serviceName` from `what.serviceName`; entries kept when they intersect a local day of the range; an id that BatchGet does not return is skipped (§ 14.1) |
| Day edits (§ 10.3, `sched-1e`) | tenant Get (`scheduling.timezone`); Get `DAYS#<r>` consistent (`v, days`); Get `AVAILABILITY#<r>` (`rules`); after commit, AP3 for `<r>` over the UTC dates that touch the changed local dates → `activeEntries` per changed date (§ 5.5) → `planDay` per changed date | `today` from the timezone; `editDays` on `days` (`v` stays server-side, § 10.3); `outsideHours` = the union of the days' `outsideHours`, each id once, as refs derived from entry ids (`ref` is the id prefix, § 4.4: no BatchGet) |
| Weekly mail (§ 11.4, `sched-1g`) | AP12 (as AP12, plus `integrations.contactEmail`); per tenant due, in this order: `contactEmail` check; `RESOURCE#` (`SK, name`); BatchGet `AVAILABILITY#` (`rules`; no resource with a non-empty list → no mail); AP14 (`sentAt` returned → stop); BatchGet `DAYS#` per resource; AP3 per resource over the UTC dates of the week's local days, then `activeEntries` per local day (§ 5.5) | `weekMailDue` from `scheduling.timezone`; per resource and day `planDay` (source, windows, entry count, open time); recipient `integrations.contactEmail`; template `schedulingEmailConfig.templates.weekAhead` else the default; no `BOOKING#` read: the mail carries counts, no customer data |

The base plan's `APPTDATE#` index is not needed (AP3 per resource serves the planner week and reminders). Its
time-ordered `APPTCUSTOMER#…#<startIso>#` becomes `CUST#<email>#<bookingId>`: no reader needs the order, and a
move would rewrite the key. A run is indexed by its **last** meeting (`RUNSPAN#`) and filtered by its first, so a
run that started before a window and still has meetings inside it is found.

### 6.4 Query rules (apply to every access pattern)

1. Every `Query` loops on `LastEvaluatedKey` until it is absent. No `Limit`, except on routes that page (§ 10.3
   `cursor`), which return `LastEvaluatedKey` as an opaque base64url `cursor`.
2. Every `BatchGetItem` sends ≤ 100 keys per call and repeats `UnprocessedKeys` with exponential backoff, at most 5
   attempts; still unprocessed → 503 `busy` (never a partial list presented as complete).
3. Every list read names a `ProjectionExpression` (CLAUDE.md Critical Rule 2); the column above is the list.
4. Reads that a write decides on use `ConsistentRead: true` (§ 7.1); display reads do not.

### 6.5 Main table

Written to the main table by scheduling: the `TenantConfig` fields of § 4.1 (existing settings route) and audit
entries (existing event bus, `publishAudit`) under **SCHED-AUDIT-PII = C** (ratified 2026-11-21; the four points of
§ 22):

1. **No booking event goes to the main table.** Rule (one, for the whole class): a write that changes one booking's
   `what` or `state` — hold, confirm, cancel, move, admin manual entry, a seat unplaced by a run cancel, by a visitor
   or by an admin — publishes **no** audit event; it appends a `history` entry to that `BOOKING#` in the same
   conditional write (§ 4.4). The admin sees the history on the booking screen (`BookingAdminDTO.history`, § 10.3).
2. **Main-table audit stays for writes that carry no customer data**: settings, services, resources (and feed
   secret rotation), default availability, day edits, courses, runs (create, update, move, cancel), mail templates.
   Their `target.title` is the name of the thing (service, resource, course) or, for a run, the course name and the
   run's first local date; `details` hold counts and dates only — **never** a booking id, ref, customer name, email or
   phone (a run cancel reports `{ unplaced, cancelled }`; a day edit reports the dates and the kind, not the
   `outsideHours` refs). `actor.email` is the admin's email (Critical Rule 7).
3. **Erasure** publishes `SCHEDULING_CUSTOMER_ERASED` with the two counts only (§ 14.2); `target.title` is the
   fixed text "Scheduling customer erasure" (Critical Rule 7 asks for a readable title; the email would be
   customer data).
4. **No `ip` field** on any scheduling audit event (`AuditParams.ip` is optional, `backend/src/lib/events.ts:6-19`,
   OBSERVED). New scheduling handlers never set it. One **existing** writer does: `PUT /settings` publishes
   `UPDATE_SETTINGS` with `ip: event.requestContext.http.sourceIp` on every save
   (`backend/src/tenant/settings.ts:359-368`, OBSERVED), and scheduling settings are saved through it. Change
   (allocated to `sched-1d`): when the request body has at least one scheduling key (`schedulingEnabled`,
   `scheduling`, `schedulingEmailConfig`), the event omits `ip` — for the whole event, also when the same body
   changes other settings (one event per save; it cannot be split). Everything else stays as today: a body with no
   scheduling key still sends `ip`; `details.updatedFields` (key names only, no values) and `rejectedFields`, the
   `Put`, `target.title` and the page purge are unchanged.

**No `CUSTOMER#`, no `LEAD#`, no `EMAILLIMIT#`.** A booking does not create a commerce customer.

## 7. Write-time guards and their concurrency argument

### 7.1 Two version rules

**Container rule.** A container is one item holding the active entries a rule counts: a run's seats (`RUN#`), a
resource's intervals on one UTC day (`RESDAY#`), one email's open holds (`HOLDS#`). Every write that changes a
container:

1. reads it with `ConsistentRead` (version `v`, or absent);
2. lets the kernel decide on that snapshot with the writer's `now`;
3. sends `TransactWriteItems` with `SET v = :v + 1`, condition `v = :v` (`attribute_not_exists(SK)` when absent),
   together with the other items of the operation; the same update removes every entry the kernel counted as
   expired (**a writer that treats an entry as expired removes it in the same write**);
4. on `TransactionCanceledException` with `ConditionalCheckFailed` on a container, or `TransactionConflict`:
   reads again and decides again; at most 3 attempts with jitter, then 503 `busy`. Reasons are read by item
   position, as `couponConditionFailed` does (`backend/src/orders/create.ts:22-26`).

**Booking rule.** Every change of a booking's `what`, `state` or `tokenHashes` conditions on
`attribute_exists(SK) AND rev = :rev` (the value read) and sets `rev = :rev + 1`; a change of `what` or `state`
also sets `history` to the read list plus its entry, oldest dropped above 50 (§ 4.4), in the same update. Token minting (§ 8.4), confirm,
cancel, moves, run operations and erasure therefore form one sequence per booking: two of them at once — one
commits; the other fails, reads the new item, and decides again from there (an admin route that received a `rev`
answers 409 `stale` instead; a mail sent to the customer also changes `rev`, so the admin screen re-reads). The
reminder marker (§ 11.3) is the one booking attribute outside this rule: it changes nothing the others read.

**Argument.** DynamoDB applies conditional writes to one item one at a time. With the version condition a write
succeeds only if nothing changed the item since its read, so the item passes through a sequence of states, each
produced by one kernel decision on the state just before it. The rule (capacity, no overlap, open-hold cap)
therefore holds after every write. Clock differences between Lambdas change only *which* writer wins near an
expiry, never whether two win: the loser re-reads and decides on the new state. Removals also bump `v`.

Capacity invariant precisely: **no seat write makes the active count exceed capacity**. A capacity change may
leave the count above the new capacity (§ 13); it removes nobody, and a confirm does not recount (an existing hold
keeps the seat it took).

Abstraction line: **container write** (`scheduling-db.ts`, one function taking a container kind) — users: seat,
slot and open-hold writes; axis: operations fixed, three container kinds as a closed sum with an exhaustive
`switch`; rejected: three hand-written transactions (read, condition, cleanup, retry and reason mapping three
times).

### 7.2 Idempotency and the confirm mail (booking intent, extended)

The page creates a UUID when the form renders. `fingerprint = sha256hex(canonical JSON of { what, who: { email
(normalized), name, phone ?? null, language ?? null } })` — every submitted field except `intentId`,
`recaptchaToken` and `resend`.

Order of checks in the hold route:

1. switch on (§ 10.2); body schema;
2. **intent lookup** (AP11). Found → the replay table below; reCAPTCHA is **not** verified on a replay (a replay
   creates no inventory; its only side effect, a resend, is limited by the per-email counter);
3. reCAPTCHA (§ 9.1); limits (§ 9); the hold transaction (§ 7.3 / § 7.4), which puts `INTENT#` with
   `attribute_not_exists(SK)` and the booking with `state.mail = "pending"`;
4. after commit: send the mail (its token is the one created in the transaction), then `UpdateItem BOOKING#`
   `SET state.mail = "sent"` (or `"failed"`) with condition `state.kind = held AND rev = :rev`. A failed send keeps
   the hold and answers 503 `mailFailed`.

Replay results (same intent):

| Stored | Request fingerprint | `resend` | Answer | Side effect |
|---|---|---|---|---|
| any | different | any | 409 `intentReused` | none |
| held, unexpired, `mail = pending` (crash between commit and send) or `failed` | same | any | 201 `HoldResult` | new token (§ 8.4), mail sent, `mail = sent`; counts in `LIMIT#EMAIL` |
| held, unexpired, `mail = sent` | same | false | 200 `HoldResult` | none |
| held, unexpired, `mail = sent` | same | true | 200 `HoldResult` | new token, mail sent; counts in `LIMIT#EMAIL` (429 when over) |
| confirmed | same | any | 200 `HoldResult` with `state: "confirmed"` | none |
| held and expired, or cancelled | same | any | 409 `intentClosed` (the page renders a new form with a new intent) | none |

A resend or a replay-recovery mail is one transaction: the token mint of § 8.4 and the `LIMIT#EMAIL#` counter; a
refusal sends no mail.

Interleaving (double click): both requests read "no intent", both pass reCAPTCHA (two tokens), both send the
transaction; one commits; the other fails on `INTENT#` (or on the container version), re-reads, finds the intent
with the same fingerprint, and answers by the table.

### 7.3 Slot: hold, confirm, cancel, move, expiry

**Why the base plan's lock is not enough (F7).** Lock key = resource + start. Visitor A holds 09:00-10:00 (key
`…#07:00Z`); visitor B holds 09:30-10:00 with a 30-minute service (key `…#07:30Z`). Both `attribute_not_exists`
conditions pass; the bookings overlap. Kernel detection does not help: both read before either wrote.

**Mechanism (SCHED-SLOT-GUARD = B, ratified 2026-11-21).** Container `RESDAY#<resourceId>#<utcDate>`; entry
`bookingId → { s, e, x?, rev }`; a slot touches each UTC date it covers (one, or two across UTC midnight: two
updates in one transaction). Rule on the snapshot: `overlapCheck`. **Entry `rev`**: every write that adds or
changes a booking's entry (hold, confirm, move, manual appointment) also changes that `BOOKING#` under the booking
rule (§ 7.1) and writes the booking's new `rev` into each entry it adds or changes, in the same transaction. Writes
that only remove an entry (cancel, erasure, removal of a counted-expired entry) write no `rev`. Only display reads
use it (`activeEntries`, § 5.5); `overlapCheck` ignores it.

| Operation | Container change | Other items, with conditions | Items |
|---|---|---|---|
| Hold (visitor) | add `{s,e,x}`; remove counted-expired | `slotDecision` before the write; resource guard; `HOLDS#` add; `LIMIT#…` ≤ 2; put `BOOKING#` (with `heldUntil = x`), `TOKEN#`, `CUST#`, `INTENT#`, `HELD#` (all `attribute_not_exists(SK)`) | ≤ 13 |
| Confirm | `SET entries.#b = {s,e}`; condition also `entries.#b.x = :x` | `BOOKING#` held → confirmed (booking rule, `state.kind = held`); delete `HELD#`, `REMOVE heldUntil`; `HOLDS#` remove entry | ≤ 5 |
| Cancel (customer or admin) | remove entry | `BOOKING#` → cancelled (condition `rev`); `HELD#` kept when present (the daily cleanup removes the set, § 14.1); delete every `TOKEN#` of `tokenHashes`; `HOLDS#` remove if held | ≤ 25 |
| Move (confirmed only; customer or admin) | remove from old day(s), add `{s,e}` to new day(s); one update when the same day | `slotDecision` for a customer; resource guard on the new resource; `BOOKING#` `what` updated (booking rule, `state.kind = confirmed`) | ≤ 6 |
| Manual appointment (admin) | add `{s,e}` (confirmed) | resource guard; put `BOOKING#` (confirmed, `manual`), `TOKEN#`, `CUST#` (all `attribute_not_exists(SK)`) | ≤ 6 |
| Expiry | nothing at expiry; the next writer of that container removes the entry; the item set is removed by the daily cleanup 7 days later (§ 14.1) | — | — |

Interleaving, confirm at the moment of expiry (A's hold expires at T; B wants an overlapping slot):

```
t1  A-confirm reads RESDAY v=7 (A present, x=T); A's clock: now<T → apply
t1  B-hold    reads RESDAY v=7; B's clock: now>=T → A expired → add B, remove A
t2  both TransactWrite with condition v=7; DynamoDB applies one first:
    (a) A first: v=8, A confirmed. B fails → re-reads v=8: A confirmed → overlap(A) → 409 slotTaken
    (b) B first: v=8, A removed. A fails → re-reads: A absent → 410 expired (seatLost); A stays held-expired
```

Two visitors on the same or overlapping times: one commits; the other re-reads, gets `overlap` (409 `slotTaken`),
or for "any available" tries the next free resource (base plan step 5).

### 7.4 Seat: hold, confirm, cancel, move, expiry

The draft's counter fails (F8). Mechanisms compared:

| | S1 seat item per booking + version on run | S2 counter + reclaim by next writer | S3 numbered seat items | **S4 seat map in the run item + version** |
|---|---|---|---|---|
| Items | `SEAT#<run>#<booking>` + `RUN#` | `RUN#.taken` + `SEAT#` items (to know what expired) | `SEATNO#<run>#<1..C>` | `RUN#.seats` only |
| Count read | Query `SEAT#<run>#` (consistent) + Get | Get + Query expired | Query | one Get |
| Race closed by | version on `RUN#` | `taken - k < capacity` + per-item conditions | per-number ownership | version on `RUN#` |
| Expiry | count ignores; a cleanup deletes | next writer deletes k items, decrements k | past `x` replaceable | next writer removes |
| DynamoDB limits | ≈ 8 items per write; query ≈ N × 100 B | k unbounded → may exceed 100 items: needs a cap and a loop | lowering capacity below a used number breaks `count ≤ capacity` unless the capacity write renumbers | item ≤ 400 KB (45 seats ≈ 2 KB); each write rewrites the item |
| Proposal read for a course | 1 + N queries | 1 + N | 1 + N | **1 query** |
| Drift | none | counter and items can disagree | none | none |
| Cancel a run of N in one transaction | 2 + 2N items | 2 + 2N + counter | 2 + 2N | 2 + 2N |

**Choice: S4.** It closes the same race as S1 with one item; the proposal needs one query; expired holds are
reclaimed inside the next writer's update. The run size bound of § 4.5 comes from cancelling a run in one
transaction, which every option shares; it is raised as **SCHED-SEAT-BOUND** (operator ruling: A, a recorded
technical limit). Cycle 1's claim "the options do not differ in product behaviour" is withdrawn.

| Operation (all conditioned on `RUN#.v`) | `RUN#` change | Other items | Items |
|---|---|---|---|
| Hold (visitor) | add `seats.#b = {x}`, remove counted-expired, `SET language = :L` when `languageAfter` changed; condition also `#status = :open` | `HOLDS#`; `LIMIT#…`; put `BOOKING#` (with `heldUntil = x`), `TOKEN#`, `CUST#`, `INTENT#`, `HELD#` | ≤ 10 |
| Confirm | `seats.#b = {}`; condition also `seats.#b.x = :x` | `BOOKING#` held → confirmed (booking rule, held); delete `HELD#`, `REMOVE heldUntil`; `HOLDS#` | ≤ 4 |
| Cancel (seat) | remove `seats.#b` | `BOOKING#` → cancelled, `tokenHashes = []` (booking rule); `HELD#` kept when present (§ 14.1); delete each `TOKEN#`; `HOLDS#` if held | ≤ 24 |
| Cancel (unplaced) | no container | `BOOKING#` → cancelled, `tokenHashes = []` (booking rule); delete `UNPLACED#<courseId>#<bookingId>`; delete each `TOKEN#` | ≤ 22 |
| Move seat → seat (visitor: confirmed; admin) | source `RUN#` remove, target `RUN#` add (both versioned; one update when the same run) | `BOOKING#` `what.runId` (booking rule) | ≤ 3 |
| Move unplaced → seat (visitor via link: the proposal; admin) | target `RUN#` add (versioned) | `BOOKING#` `what` → seat (booking rule); delete `UNPLACED#` | ≤ 3 |
| Move seat → unplaced (admin, `runId: null`) | source `RUN#` remove (versioned) | `BOOKING#` `what` → unplaced (booking rule); put `UNPLACED#` | ≤ 3 |
| Manual seat (admin) | target `RUN#` add (versioned), or none when unplaced | put `BOOKING#` (confirmed, `manual`), `TOKEN#`, `CUST#`; put `UNPLACED#` when unplaced | ≤ 5 |
| Capacity change | `SET capacity`, bump `v` | — | 1 |

Why confirm needs no recount: a writer that judged A expired removed A's entry (rule of § 7.1), so A's confirm
fails on `v`, re-reads, finds no entry → `seatLost`. If A's entry is still there, every writer since A's hold
counted A, so the count never exceeded capacity because of A.

Interleaving, two visitors and the last seat (capacity 8, 7 active):

```
t1  V1 reads RUN v=12 (7 active) → ok        t1  V2 reads RUN v=12 (7 active) → ok
t2  both TransactWrite with condition v=12: one commits (v=13, 8 active);
    the other fails → re-reads (8 active) → runFull(8) → 409; its BOOKING/TOKEN/CUST/INTENT puts were in the
    cancelled transaction, so nothing of it exists
```

Interleaving, confirm at the moment of expiry (A held, `x = T`; run 8/8 with A; B wants a seat):

```
(a) A-confirm commits first (A's clock < T): v→13, A confirmed. B re-reads: 8 active → runFull
(b) B-hold commits first (B's clock >= T): A removed, B added, v→13. A re-reads: A absent → 410 expired (seatLost)
(c) B reads while A is unexpired by B's clock → runFull at once (conservative); A confirms later
```

Language race: two first enrolments `ro` and `en` on a `notSet` run read the same `v`; the first sets the
language; the second re-reads, the run is `set(ro)` → `languageMismatch` → the page shows the new proposal.

### 7.5 Open holds per email (`HOLDS#`)

Same container rule; entry per held booking; a visitor hold requires `active entries < 2`. Confirm and cancel
remove the entry. The cap is exact under concurrency by § 7.1.

### 7.6 Run operations

- **Move a run**: `RUN#` meetings, `firstStartIso`, `lastEndIso` (versioned) + delete old `RUNSPAN#` + put new +,
  when the new last meeting ends after `now` (the move puts its trainers into future use), the resource guard on each
  trainer in `trainerIds` = 3 + ≤ 10 = ≤ 13 items. Refusal → 409 `resourceUnavailable`. Mails after commit (§ 11).
- **Cancel a run**: `RUN#` `status = cancelled`, `seats = {}` (versioned) + delete `RUNSPAN#` + per confirmed seat
  `BOOKING#` → unplaced (condition `rev`) and put `UNPLACED#`; per held seat `BOOKING#` → cancelled (condition
  `rev`). ≤ 2 + 2 × 45 = 92 items. The held bookings keep `tokenHashes` in this transaction (the 100-item budget has
  no room for their tokens); after commit, per held booking: delete its `TOKEN#` items, then set `tokenHashes = []`
  (booking rule). A crash in between leaves listed tokens of a cancelled booking: they answer 404 (view rule,
  § 5.3) and are still found by erasure because they are still listed. Their `HOLDS#` entries stay until their `x`
  (≤ `holdMinutes`; bounded, accepted).
- **Run create / trainer change**: the resource guard on each trainer named by the new list (≤ 10 items, § 4.5).
- Rule behind all three: **every run write after which a trainer has a meeting in the future carries the resource
  guard on that trainer** (create, trainer change, move). A write after which the run has no future meeting needs
  none: the removal check (§ 13) ignores ended runs too.

### 7.7 Not guarded at write time (recorded, accepted)

- A day turned off or shortened (day edit), or an availability rule removed, while a visitor holds or has booked
  an affected slot: the edit is allowed and the booking stands; the day-edit answer lists the refs of the active
  bookings outside the new hours (`outsideHours`, § 5.5), and the planner keeps showing them on that day until the
  admin moves or cancels them (§ 23.4). Guarding would put every config write into the containers' version chain
  for a rare case.
- `LIMIT#` counters are fixed hourly windows: up to twice the limit can pass across an hour boundary.

## 8. The emailed link

### 8.1 Token

32 bytes from `crypto.randomBytes`, base64url without padding (43 characters, 256 bits). Stored only as
`sha256hex(token)`: `TOKEN#<hash>` and an entry of `BOOKING#.tokenHashes`. A plain hash suffices at 256 bits;
precedent: service keys stored as SHA-256 (`service-account-1`). The token is never stored, logged, audited or
returned in a response. Lookup: tenant (bound by the renderer, § 10.1) + hash → `TOKEN#` → `BOOKING#`; a token of
tenant A on tenant B's page finds nothing.

### 8.2 Link

`<base>/_booking/manage#t=<token>`; `<base>` = `bookingBase(tenant, RENDERER_CLOUDFRONT_ORIGIN)` (§ 5.3). A domain
ending in `.localhost` is the placeholder of tenant creation (G7), not an address. `RENDERER_CLOUDFRONT_ORIGIN` =
`https://<distribution>.cloudfront.net` (`infra/lib/amodx-stack.ts:342`); the scheduling nested stack is created
after the renderer, so the value exists without a dependency cycle (INFERRED from `:211` vs `:342`). No browser or
renderer input chooses the link.

The token is in the **fragment**: not sent to any server, not in `Referer`, not in CloudFront or Lambda logs; a
mail scanner that fetches the link gets the page shell only. The page reads `location.hash`, removes it with
`history.replaceState`, keeps the token in memory, and sends it in POST bodies. The manage page carries no
third-party script (§ 10.1) and answers `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.

### 8.3 A GET never changes state

Opening the link (GET) shows the page; the page sends `POST view` and shows the booking with a **Confirm** button
when held. Only `POST confirm` confirms. No GET route on the renderer or the backend changes a booking.

### 8.4 One new token per mail (operator ruling R01)

Every mail that carries a link gets a **new** token, minted by the function that sends that mail:

1. Get `BOOKING#` (`rev`, `tokenHashes`, state).
2. `TransactWriteItems` (≤ 3 items): put `TOKEN#<newHash>` (`attribute_not_exists(SK)`); update `BOOKING#` `SET tokenHashes = :list, rev = :rev + 1` with condition
   `attribute_exists(SK) AND rev = :rev AND state.kind <> :cancelled` (booking rule, § 7.1), where `:list` = the
   read list + the new hash, minus the oldest when the read list has 20 entries; when one is dropped, delete its
   `TOKEN#` in the same transaction. On a failed condition: re-read; booking gone or cancelled → no mail
   (`linkNotIssued`, logged); otherwise retry ≤ 3 times.
3. Send the mail only after the commit. A failed send leaves a listed token that nobody holds; it is deleted with
   the booking or by the cap.

Why this closes the races (each pair touches the same `BOOKING#` item under one `rev`):

| Pair | Interleaving | Result |
|---|---|---|
| mint vs confirm | confirm read `[H1]`; mint commits `[H1,H2]`, `rev+1` | confirm fails on `rev`, re-reads, confirms; both tokens open the confirmed booking |
| mint vs cancel | cancel commits (`tokenHashes = []`, tokens deleted, state cancelled) | mint fails on `rev` (and on state) → no token, no mail |
| mint vs cancel, other order | mint commits `[H1,H2]` | cancel fails on `rev`, re-reads, deletes `H1` and `H2` |
| mint vs erase | erase deletes the booking | mint fails on `attribute_exists(SK)` → no token; or mint first → erase re-reads and deletes `H2` too |

| Event | Tokens |
|---|---|
| Hold | the first token, inside the hold transaction |
| Resend, replay recovery, reminder, admin manual entry, admin move, run move, run cancel (`unplaced` mail) | one new token per mail, by the steps above |
| Move | every token stays: tokens point at the booking, not at a time or seat |
| 21st mail | the oldest token is deleted; its link answers 404 |
| Cancel | every `TOKEN#` in `tokenHashes` is deleted and `tokenHashes = []` in the cancel transaction (≤ 20 token items); later links answer 404 |
| Erase | deleted with the booking (§ 14.2) |

Lifetimes (each existing token of a booking has the same rights):

| Use | Valid while |
|---|---|
| Confirm | `held` and `now < expiresAt` |
| View | `tokenView = valid` (§ 5.3) |
| Cancel / move | `changeDecision` ok |

Answers:

| Case | Status | `code` |
|---|---|---|
| Unknown, malformed, deleted, other tenant, `gone` | 404 | `linkNotValid` (one answer: no existence leak) |
| Held and expired; or the entry went to another writer after expiry (`seatLost`) | 410 | `expired` (the page offers a new booking) |
| Cancelled between the token lookup and the write | 409 | `cancelled` |
| Change outside the window | 409 | `tooLate` with `cutoff` |
| Move of a held booking | 409 | `notConfirmed` |
| Order-sourced cancel or move | 409 | `paidContactTenant` |

### 8.5 Moves keep the booking id

A move updates `BOOKING#.what` in place. The base plan's open item "reschedule = cancel + create" (lines 413-415)
is decided the other way: its reasons (clean history, simple slot accounting) are met by the booking's `history`
(a `moved` entry with the old and new placement, § 4.4; SCHED-AUDIT-PII = C) and the container write; one id keeps
every link working across moves.

### 8.6 What the mailbox proves (PD-001)

- **Proves**: whoever confirmed could read a mail sent to that address at that time.
- **Does not prove**: the name, phone, age or language typed; that the same person made another booking with the
  same address; control of the address later (a forwarded mail hands the link on — whoever holds a link manages
  that one booking, by design of § 1 item 2).
- **Identity key** stays `tenantId + normalizedEmail` (PD-001): it groups bookings for data requests (AP9) and
  limits (§ 9). It grants nothing to a visitor. `order` and `manual` bookings start confirmed without a mailbox
  check (an order form or the admin typed the address).

## 9. Abuse limits on the anonymous hold path

Only the hold creates anything without a token; every later action needs a token.

| Check (in this order, after the intent lookup of § 7.2) | Rule | Refusal |
|---|---|---|
| Switch | `schedulingEnabled === true` (missing tenant record = off) | 403 `notAvailable` |
| Body | Zod schema; email valid after `normalizeEmail()` | 400 `invalid` with issues |
| reCAPTCHA | `resolveRecaptchaConfig(tenantConfig.recaptcha)` as `backend/src/orders/create.ts:95-121`; no token → 400; `!success \|\| score < threshold` → 403 | 400 `verificationRequired` / 403 `verificationFailed` |
| Per email per hour | `LIMIT#EMAIL#<emailHash>#<hour>`: `ADD count :1`, condition `attribute_not_exists(SK) OR count < :5`, in the hold transaction (and in each resend) | 429 `tooManyForEmail`, `Retry-After` to the next hour |
| Open holds per email | `HOLDS#<emailHash>`, active entries `< 2` (§ 7.5) | 429 `tooManyForEmail` (same answer: less to learn about an address) |
| Per client address per hour (SCHED-ADDR-LIMIT = A) | `LIMIT#ADDR#<addressHash>#<hour>`, `count < :20`, in the hold transaction | 429 `tooManyFromAddress` |

Counters are per tenant (`TENANT#<id>`), unlike `EMAILLIMIT#` (F3). Worst case for one victim address: 5 mails ×
tenants with scheduling on, per hour; trigger for a platform-wide counter: an abuse report.

### 9.1 reCAPTCHA (domain, no domain, frame, tenant keys)

- **One key pair rule** (closes G8 for every page): `mapTenant` (`renderer/src/lib/dynamo.ts:120-188`) gains
  `recaptcha: { siteKey }` **only when** the stored record has both `recaptcha.siteKey` and `recaptcha.secretKey` —
  the same condition as `resolveRecaptchaConfig` branch 1 (`backend/src/lib/recaptcha.ts:32-39`). The secret is
  never mapped. The existing expression `config.recaptcha?.siteKey || process.env.RECAPTCHA_SITE_KEY`
  (`renderer/src/app/[siteId]/layout.tsx:277`, `:295`) then picks the same pair as the backend. This changes every
  form of a tenant that set its own pair, from a mismatched pair to the matching one (allocated to `sched-1g`,
  row G8).
- **Host**: Google accepts a token only from a page whose host is in the key's domain list. A no-domain tenant's
  page host is `<distribution>.cloudfront.net`; inside a frame it is still the frame's own host, not the embedding
  site (INFERRED from reCAPTCHA documentation). The deployment key's list must contain the CloudFront host: **NOT
  VERIFIED** (Google console) — staging row G9. A no-domain tenant with its own pair fails the same way; the
  settings screen says so.
- **Third-party cookies blocked** (Safari default, frames): scores may be lower (INFERRED); the tenant threshold is
  the existing control; `sched-frame-1` measures it.
- **Fail-open guard** (G4): the hold function gets `RECAPTCHA_SECRET_KEY` whenever the stack has one; infra row I3.
- `remoteip` is sent to Google only when the address is known (§ 9.2).

### 9.2 Client address (SCHED-ADDR-LIMIT)

The renderer booking proxy (§ 10.1, `sched-1g`) extracts the address and sends it to the backend as
`x-viewer-address`; the backend reads that header **only** from the `RENDERER` role (the renderer builds the backend
request; it never forwards browser headers). Until the proxy exists, no address arrives and the "missing" rule
below applies. One pure module, `packages/shared/src/client-address.ts`, holds both functions:

```ts
viewerAddress(header: string | undefined, source: "xff" | "cva", k: number): Result<string, "missing" | "invalid">
addressKey(ip: string): string            // IPv4: the address; IPv6: its /64 prefix, e.g. "2001:db8:1:2::/64"
```

**`X-Forwarded-For` (candidate 1, no infra change).** Each proxy appends to the right. Split on `,` and trim:
entries `e[0] … e[n−1]`, **0-based, left to right**. The last `k` entries were appended by CloudFront and by the hops
after it; `k` is fixed by the witness (expected `k = 1`: CloudFront appends the address it saw; `k = 2` if the
Lambda function URL also appends the address it saw, CloudFront's). The viewer address is **`e[n − k]`**. Entries
`e[0] … e[n−k−1]` came from the client and are ignored, whatever they contain. `n < k` → invalid.

| Header (`k = 1`) | Chosen |
|---|---|
| `198.51.100.4` | `e[0]` = `198.51.100.4` (no client header: a single entry is valid) |
| `203.0.113.7, 198.51.100.4` | `e[1]` = `198.51.100.4` |
| `1.1.1.1, garbage, 198.51.100.4` | `e[2]` = `198.51.100.4` |
| `203.0.113.7, 2001:db8::5` | `e[1]` = `2001:db8::5` |
| (`k = 2`) `203.0.113.7, 198.51.100.4, 130.176.0.1` | `e[1]` = `198.51.100.4` |

**`CloudFront-Viewer-Address` (candidate 2; needs an origin-policy header, so an infra change raised as its own
decision only if candidate 1 fails the witness).** One value `address:port`, set by CloudFront (INFERRED from AWS
documentation).

**Accepted forms of the chosen entry**, then normalization (both candidates):

| Form | Example | Address |
|---|---|---|
| IPv4 | `198.51.100.4` | as is |
| IPv4 with port (exactly one `:`) | `198.51.100.4:4431` | before the `:` |
| bracketed IPv6, with or without port | `[2001:db8::5]`, `[2001:db8::5]:4431` | inside the brackets |
| bare IPv6 (two or more `:`, no `[`) in `X-Forwarded-For` | `2001:db8::5` | the whole entry; never a port |
| `CloudFront-Viewer-Address` without brackets | `2001:db8::5:4431` | the text before the **last** `:` when the part after it is 1-5 digits (the value always carries a port) |
| anything else: empty, `999.1.1.1`, `[2001:db8::5`, a zone id `fe80::1%eth0`, `1.2.3.4:abc` | — | invalid |

Normalization: `net.isIP(address) ≠ 0`, else invalid; IPv4-mapped IPv6 (`::ffff:198.51.100.4`) → the IPv4 address;
IPv6 → lower case, canonical compressed form. `addressKey`: IPv4 → the address; IPv6 → the `/64` prefix (one
subscriber usually holds a /64; a per-address count is bypassed by rotating inside it). The backend recomputes
`addressKey` from the received address and treats an invalid one as missing.

**Missing or invalid** → no address limit for this request (logged `[scheduling] no viewer address`, without the
header value), no `remoteip`; reCAPTCHA and the email limits still apply.

**Witness** (staging, `sched-1g` row G13; NOT RUN here; operator ruling SCHED-ADDR-WITNESS-STAGE = B, 2026-11-21):
the booking proxy of `sched-1g` is the first renderer code on the path, so the witness runs there, with a temporary log line that records the raw `X-Forwarded-For`, the
presence of `CloudFront-Viewer-Address`, and the chosen entry (removed before the slice closes). Cases: no supplied
header; one forged entry; two forged entries, one malformed; a client on IPv4; a client on IPv6; an IPv4-mapped
address when the network gives one (recorded as not obtainable otherwise). Pass: one `k` chooses the tester's real
address in every case and never a forged value; that `k` is written into `sched-1g`'s record. No fixed `k` fits →
SCHED-ADDR-LIMIT is raised again (candidate 2 or no address limit).

**Exposure gate** (same ruling): no hosted or framed booking page is exposed to visitors — `schedulingEnabled` on for
a real tenant, or a `sched-frame-1` snippet handed out — before G13 has passed on staging. A failed witness blocks
that exposure until SCHED-ADDR-LIMIT is answered again.

Abstraction line: **`client-address.ts`** — users: the renderer proxy (`viewerAddress`) and the backend hold route
(`addressKey`); axis: none (one rule for two callers, so the key cannot differ between them); rejected: one copy in
each workspace.

## 10. API

### 10.1 Hosted page and renderer routes

Public addresses (both shapes):

| Public URL on a domain host | On a preview host (no-domain tenant) | What |
|---|---|---|
| `/_booking` (`?frame=1&lang=<tag>&course=<id>&service=<id>`) | `/_site/<tenantId>/_booking…` | book page |
| `/_booking/manage` (token in `#t=`) | `/_site/<tenantId>/_booking/manage` | manage page |
| `/_booking/api/<op>` | `/_site/<tenantId>/_booking/api/<op>` | proxy handlers, § 10.2 |
| `/_booking/feed/<resourceId>/<secret>.ics` | `/_site/<tenantId>/_booking/feed/…` | calendar feed, § 12 |

**Rewrite** (`renderer/middleware.ts`, new branch placed after the internal-path refusals A/A2/A2b and before the
test-mode, preview and production branches, `:219-299`):

```
preview host (isPreviewHost) and path = /_site/<id>/_booking[/<rest>]  → rewrite /_book/<id>[/<rest>]
other host   and path = /_booking[/<rest>]  and isWiredTenantHost(cleanHost) !== false
                                                                       → rewrite /_book/<cleanHost>[/<rest>]
any host     and path = /_book or /_book/…                             → notFoundResponse()  (internal target,
                                                                         never public: the wire must not choose
                                                                         the tenant — same rule as /_dyn)
```

The query string is kept. No `%5Fdyn` twin, no `amodx_preview_base` cookie, no dependence on the session cookie.
`isWiredTenantHost` is `renderer/src/lib/tenant-directory.ts:81-101` (null = lookup failed → serve, as the
production branch does). Target tree: `renderer/src/app/%5Fbook/[siteId]/` (G9). The `[siteId]` value is a host or
a tenant id; `getTenantConfig` resolves both (`renderer/src/lib/dynamo.ts:87-117`).

**Layout** (SCHED-PAGE-LAYOUT = A, ratified 2026-11-21): `%5Fbook/[siteId]/layout.tsx` is a **second root layout**
(`<html lang>` from the tenant locale, `<body>`, the tenant theme through `ThemeInjector`). It renders none of
`Analytics`, `PaddleLoader`, `FBPixel`, `CookieConsent`, `PopupManager`, navbar, footer, cart `Providers`. The book
page alone renders `RecaptchaProvider` with `config.recaptcha?.siteKey || process.env.RECAPTCHA_SITE_KEY`; the
manage page renders no third-party script at all. Every page and handler of the tree is `dynamic =
"force-dynamic"` and answers `Cache-Control: private, no-store`, so CloudFront stores nothing and every query
parameter reaches the page (G10). One exception: the feed handler answers `Cache-Control: private, max-age=300`
(§ 12) so a calendar app may keep it five minutes; `private` keeps it out of CloudFront (INFERRED from CloudFront's
handling of `private`; row G1 checks the `x-cache` header). `frame=1` removes the page header and sets a transparent background
(`sched-frame-1` owns the frame header and the height script).

**Tenant fields** the tree reads (through `getTenantConfig`): `id`, `name`, `logo`, `theme`, `locale` and the
locale tables, `domain`, and the new `recaptcha.siteKey` mapping (§ 9.1). Scheduling settings are **not** mapped:
the backend answers `notAvailable` when the switch is off, and the page shows that text.

**Handlers** (`%5Fbook/[siteId]/api/<op>/route.ts`, `%5Fbook/[siteId]/feed/[resourceId]/[file]/route.ts`): method
check, body ≤ 8 KB, `getTenantConfig(siteId)` (absent → 404), client address (§ 9.2), backend call with the
renderer key, `x-tenant-id = config.id` and `x-viewer-address`; the backend status and body are passed through.

Origin check: the edge guard covers three exact paths (`infra/lib/renderer-hosting.ts:48-63`); the booking POSTs
need no entry: a hold needs a reCAPTCHA token minted on the tenant's page, and every other POST needs a link token.

### 10.2 Visitor backend routes

Role: `requireRole(auth, ["RENDERER"])`. The renderer key resolves to `tenantId: "ALL"` (G11), so the tenant is the
`x-tenant-id` header the renderer sets; `GLOBAL_ADMIN` also passes `requireRole` (policy) and is treated the same
way. Not anonymous, not `CUSTOMER`. Switch off → 403 `notAvailable` on every route **except the feed**, which
answers 404 `linkNotValid` for every failure (one body for a URL holder: no state leak). Errors:
`{ error: string, code: <refusal>, ...context }`; the page maps `code` to locale strings. A stored item that fails
its Zod schema (§ 4), or a stored `bookingHorizonWeeks` outside 1-52, → 500 `storedDataInvalid` (logged with the
key, no value) on visitor and admin routes alike: it is never read as absent or replaced by a default, because
an unreadable `DAYS#` read as "no override" would open a day the admin closed. A display read of intervals never
answers `storedDataInvalid` or `busy` because copies disagree: `activeEntries` resolves that by `rev` (§ 5.5).

| Method, path | Renderer op | Request | Response | Errors |
|---|---|---|---|---|
| GET `/scheduling/visitor/offer` | `offer` | — | `OfferDTO` | 403 |
| GET `/scheduling/visitor/slots?serviceId&from&to` | `slots` | query | `SlotsDTO` | 400 `rangeInverted`/`rangeTooLong`, 403, 404 service |
| GET `/scheduling/visitor/courses/{courseId}/runs?language&all` | `runs` | query | `ProposalDTO` | 403, 404 course |
| POST `/scheduling/visitor/holds` | `hold` | `HoldRequest` | 201 / 200 `HoldResult` (§ 7.2) | 400, 403, 409 `slotTaken`/`notOnGrid`/`inPast`/`beyondHorizon`/`notEligible`/`outsideAvailability`/`resourceUnavailable`/`runFull`/`runClosed`/`runCancelled`/`runStarted`/`languageMismatch`/`intentReused`/`intentClosed`, 429, 503 `busy`/`mailFailed` |
| POST `/scheduling/visitor/bookings/view` | `view` | `{ token }` | `BookingViewDTO` | 403, 404, 410 |
| POST `/scheduling/visitor/bookings/confirm` | `confirm` | `{ token }` | `BookingViewDTO` | 403, 404, 409 `cancelled`, 410 |
| POST `/scheduling/visitor/bookings/cancel` | `cancel` | `{ token }` | `{ ref, state: "cancelled" }` | 403, 404, 409 `tooLate`/`paidContactTenant` |
| POST `/scheduling/visitor/bookings/move` | `move` | `{ token, to: { kind: "slot"; start } \| { kind: "seat"; runId } }` | `BookingViewDTO` | 403, 404, 409 (as hold) + `tooLate`/`notConfirmed`/`paidContactTenant`, 503 `busy` |
| POST `/scheduling/visitor/feed` (`sched-1g`) | feed | `{ resourceId, secret }` (POST keeps the secret out of API logs) | `text/calendar` | 404 only |

```ts
type OfferDTO = { timezone: string; services: { id: string; name: string; durationMin: number }[];
                  courses: { id: string; name: string; languages: string[] }[] };
type SlotsDTO = { timezone: string; serviceId: string; durationMin: number;
                  lastBookableDate: LocalDate;                  // § 5.5; the page stops forward navigation there
                  days: { date: LocalDate; starts: string[] /* UTC ISO */ }[] };     // no resource id or name
type RunDTO = { runId: string; courseId: string; timezone: string; language: string | null;
                meetings: { date: LocalDate; start: LocalTime; end: LocalTime }[]; seatsLeft: number };
type ProposalDTO = { kind: "proposed"; run: RunDTO; othersCount: number } | { kind: "choose"; runs: RunDTO[] }
                 | { kind: "noneOpen" };                       // all=1 → "choose" with every candidate
type HoldRequest = { intentId: string /* uuid */; recaptchaToken?: string; resend?: boolean;
                     what: { kind: "slot"; serviceId: string; start: string } | { kind: "seat"; courseId: string; runId: string };
                     who: { email: string; name: string; phone?: string; language?: string } };
type HoldResult = { ref: string; state: "held"; expiresAt: string; emailMasked: string }
                | { ref: string; state: "confirmed"; emailMasked: string };          // never a token or an id
type BookingViewDTO = { ref: string; state: "held" | "confirmed" | "expired"; expiresAt?: string;
  what: { kind: "slot"; serviceName: string; start: string; end: string; timezone: string }
      | { kind: "seat"; courseName: string; run: Omit<RunDTO, "seatsLeft">; groupLink?: string /* confirmed only */ }
      | { kind: "unplaced"; courseName: string; proposal: ProposalDTO };
  who: { name: string; emailMasked: string }; can: { confirm: boolean; cancel: boolean; move: boolean };
  changeCutoff?: string };
```

The derived availability DTOs (`OfferDTO`, `SlotsDTO`, `RunDTO`, `ProposalDTO`) carry no customer data:
`seatsLeft` is a count. The visitor does not choose a resource; the backend picks (base plan steps 1-5).

### 10.3 Admin backend routes (admin Cognito pool)

Role oracle: `requireRole(auth, roles, tenantId)` with `tenantId = x-tenant-id`; `GLOBAL_ADMIN` passes before the
list is read (`backend/src/auth/policy.ts:39`). `E+T` = `["EDITOR", "TENANT_ADMIN"]` (as
`backend/src/orders/list.ts:17`); `T` = `["TENANT_ADMIN"]`. Admin routes work whether the switch is on or off.
Audit (SCHED-AUDIT-PII = C, § 6.5): a write that changes a booking appends a `history` entry and publishes no
audit event; every other write publishes a main-table audit entry without customer data. Common errors: 400
`invalid` (zod issues), 401
(authorizer), 403 `forbidden`, 404 `notFound`, 503 `busy`; route-specific 409 codes below. Identifiers: a booking
is addressed by its id alone (`BOOKING#<id>`); a run by `courseId + runId` in the path; a person move stays inside
the booking's own course (D8), so the request carries only `runId` and the course comes from the stored booking.

Common DTOs:

```ts
type WhoInput = { email: string; name: string; phone?: string; language?: string };      // § 4.5 lengths
type ResourceDTO = { id: string; name: string; hasFeed: boolean };
type ServiceDTO = { id: string; name: string; durationMin: number; eligibility: Eligibility };
type CourseDTO = { id: string; name: string; defaultCapacity: number; languages: string[] };
type RunAdminDTO = { id: string; courseId: string; meetings: Meeting[]; timezone: string; capacity: number;
                     taken: number; overCapacityBy: number; trainerIds: string[]; language: string | null;
                     groupLink?: string; status: RunStatus; firstStart: string; lastEnd: string };
type RosterRow = { bookingId: string; ref: string; name: string; email: string; phone?: string;
                   language?: string; state: "held" | "confirmed"; expiresAt?: string;
                   source: "visitor" | "manual" | "order"; channel?: string };
type BookingAdminDTO = { id: string; ref: string; rev: number;
  what: { kind: "slot"; serviceId: string; serviceName: string; resourceId: string; resourceName: string | null;
          start: string; end: string }
      | { kind: "seat"; courseId: string; courseName: string; runId: string; firstStart: string }
      | { kind: "unplaced"; courseId: string; courseName: string };
  state: { kind: "held"; expiresAt: string; mail: "pending" | "sent" | "failed" } | { kind: "confirmed"; at: string }
       | { kind: "cancelled"; at: string; by: Actor };
  source: BookingSource; who: Person; createdAt: string; updatedAt: string;
  history: HistoryEntryDTO[] };            // § 4.4 HistoryEntry with every Instant as UTC ISO; oldest first
type DayDTO = { date: LocalDate } & (
  | { kind: "past"; entries: PlannerEntry[] }
  | { kind: "planned"; source: "default" | "dayHours" | "dayOff"; windows: LocalWindow[]; removed: LocalWindow[];
      note?: string; entries: PlannerEntry[]; open: { start: string; end: string }[];
      outsideHours: string[] /* refs */ });
type PlannerEntry = { bookingId: string; ref: string; start: string; end: string; state: "held" | "confirmed";
                      expiresAt?: string; customerName: string; serviceName: string };
type WeekPlanDTO = { timezone: string; resourceId: string; resourceName: string; lastBookableDate: LocalDate;
                     defaults: AvailabilityRule[]; days: DayDTO[] /* 7, from start */ };
type DayEditResult = { changed: LocalDate[]; outsideHours: string[] /* refs, union over the changed dates, each once */ };  // the screen re-reads the week
type EmailTemplate = { subject: string; body: string; sendToCustomer: boolean; sendToAdmin: boolean };
```

Routes of `sched-1d` (shared by both lines):

| Route | Role | Request | Response | Validation, rules | 409 codes |
|---|---|---|---|---|---|
| GET `/scheduling/admin/bookings/{bookingId}` | E+T | — | `BookingAdminDTO` (with `history`) | — | — |
| POST `/scheduling/admin/bookings/{bookingId}/cancel` | E+T | `{}` | `BookingAdminDTO` | admin `changeDecision`; mail `cancelled` | `notActive` |
| POST `/scheduling/admin/customers/lookup` | E+T | `{ email }` | `{ bookings: BookingAdminDTO[] }` | email normalized; in the body, never the URL (base plan line 259) | — |
| POST `/scheduling/admin/customers/erase` | T | `{ email }` | `{ removedBookings: number; remainingBookings: number }` | § 14.2; idempotent; the screen shows the acceptance boundary text | — |
| GET `/scheduling/admin/resources` | E+T | — | `{ resources: ResourceDTO[] }` | ≤ 200 | — |
| POST `/scheduling/admin/resources` | E+T | `{ name }` | 201 `ResourceDTO` | name 1-200 | — |
| PUT `/scheduling/admin/resources/{resourceId}` | E+T | `{ name }` | `ResourceDTO` | — | — |
| DELETE `/scheduling/admin/resources/{resourceId}` | E+T | — | 204 | § 13 three steps | `resourceInUse { activeBookings: number; runs: number }`, `resourceRemovalInProgress` |
| POST `/scheduling/admin/resources/{resourceId}/feed-secret` | T | `{}` | `{ feedUrl: string }` (shown once) | a new secret replaces the old | — |
| GET `/scheduling/admin/email-templates` | E+T | — | `{ defaults: Record<key, EmailTemplate>; overrides: Record<key, EmailTemplate> }` | the seven keys of § 11.1 | — |
| (existing) `PUT /settings` | as today | `schedulingEnabled`, `scheduling.*` (incl. `bookingHorizonWeeks`), `schedulingEmailConfig` | as today | timezone required when enabling; ranges § 4.5 | — |

Routes of `sched-1e` (appointments):

| Route | Role | Request | Response | Validation, rules | 409 codes |
|---|---|---|---|---|---|
| GET `/scheduling/admin/services` | E+T | — | `{ services: ServiceDTO[] }` | — | — |
| POST `/scheduling/admin/services` | E+T | `{ name, durationMin, eligibility }` | 201 `ServiceDTO` | § 4.5; listed resources exist | — |
| PUT `/scheduling/admin/services/{serviceId}` | E+T | same | `ServiceDTO` | bookings keep their stored end (§ 13) | — |
| DELETE `/scheduling/admin/services/{serviceId}` | E+T | — | 204 | bookings keep `serviceName` (§ 13) | — |
| GET `/scheduling/admin/resources/{resourceId}/availability` | E+T | — | `{ rules: AvailabilityRule[] }` | — | — |
| PUT `/scheduling/admin/resources/{resourceId}/availability` | E+T | `{ rules: AvailabilityRule[] }` | `{ rules }` | the defaults (D16); ≤ 50; 5-minute boundaries; `end > start`; one Put; dates with an override keep it (§ 23.2) | — |
| GET `/scheduling/admin/resources/{resourceId}/week?start` | E+T | `start`: LocalDate (the screen sends Mondays; any date is accepted) | `WeekPlanDTO` (7 days from `start`) | one read per week: § 6.3 consumer row "Planner week"; `planDay` per day; works with the switch off | — |
| PUT `/scheduling/admin/resources/{resourceId}/days` | E+T | `{ from: LocalDate; to: LocalDate; value: DaySetting }` | `DayEditResult` | one day = `from = to`; a range = `from`…`to`; `editDays` `set` (§ 5.5) with `today` = local today; windows per § 4.2; conditional Put of `DAYS#<r>` on the version the server read (`v = :v`, or `attribute_not_exists(SK)` when absent; `v` never leaves the server); on a lost condition the server re-reads, re-applies the same edit and writes once more; a second loss → 503 `busy`. Same date edited by two admins at the same instant: the later write wins (limit, § 18). 400 with the `DaysEditError` kind; the edit stands when bookings are outside the new hours (§ 23.4) | — |
| POST `/scheduling/admin/resources/{resourceId}/days/copy-week` | E+T | `{ sourceStart: LocalDate; targetStart: LocalDate; weeks: 1-52 }` | `DayEditResult` | `editDays` `copyWeek` (§ 5.5); same write, retry and errors as the PUT | — |
| GET `/scheduling/admin/appointments?from&to` | E+T | query (ISO dates) | `{ timezone; resources: { resourceId; name; entries: { bookingId; ref; start; end; state: "held" \| "confirmed"; customerName; serviceName }[] }[] }` | ≤ 31 days; AP3 + BatchGet (§ 6.4); entries per resource through `activeEntries` (§ 5.5: each booking once, at the highest `rev` the query saw, active only) and kept when they intersect a local day of `from`…`to`; the reviewed all-resource read, kept beside the per-resource planner (operator ruling, § 15) | — |
| POST `/scheduling/admin/appointments` | E+T | `{ serviceId, resourceId, start, who: WhoInput, channel }` | 201 `BookingAdminDTO` | admin rules § 5.2; confirmed, `manual`; token + mail `confirmed` | `slotTaken`, `resourceUnavailable` |
| POST `/scheduling/admin/bookings/{bookingId}/move-slot` | E+T | `{ start, resourceId, rev }` | `BookingAdminDTO` | slot booking, confirmed; condition `rev`; resource guard; mail `moved` | `slotTaken`, `notConfirmed`, `stale`, `resourceUnavailable` |

Routes of `sched-1f` (groups):

| Route | Role | Request | Response | Validation, rules | 409 codes |
|---|---|---|---|---|---|
| GET `/scheduling/admin/courses` | E+T | — | `{ courses: CourseDTO[] }` | — | — |
| POST `/scheduling/admin/courses` | E+T | `{ name, defaultCapacity, languages }` | 201 `CourseDTO` | capacity 1-45; above → 400 with the text "A group in this version holds at most 45 people." | — |
| PUT `/scheduling/admin/courses/{courseId}` | E+T | same | `CourseDTO` | removing a language a run uses → 409 | `languageInUse` |
| DELETE `/scheduling/admin/courses/{courseId}` | E+T | — | 204 | refused while any run or `UNPLACED#` exists | `courseInUse` |
| GET `/scheduling/admin/courses/{courseId}/runs` | E+T | — | `{ runs: RunAdminDTO[] }` | AP4 | — |
| POST `/scheduling/admin/courses/{courseId}/runs` | E+T | `{ meetings, capacity?, trainerIds, language?, groupLink? }` | 201 `RunAdminDTO` | `validateMeetings`; capacity default = course's, 1-45 (same text); trainers 1-10, exist, not retiring; language in the course list | `resourceUnavailable` |
| PUT `/scheduling/admin/courses/{courseId}/runs/{runId}` | E+T | `{ capacity?, trainerIds?, language?: string \| null, groupLink?: string \| null, status?: "open" \| "closed" }` | `RunAdminDTO` | versioned; `cancelled` only by the cancel route; a cancelled run refuses every change | `runCancelled`, `resourceUnavailable` |
| POST `/scheduling/admin/courses/{courseId}/runs/{runId}/move` | E+T | `{ meetings }` | `{ run: RunAdminDTO; mailed: number }` | `validateMeetings`; not cancelled; resource guard on each trainer when the new last meeting is in the future; mail `moved` per active booking | `runCancelled`, `resourceUnavailable` |
| POST `/scheduling/admin/courses/{courseId}/runs/{runId}/cancel` | E+T | `{}` | `{ unplaced: number; cancelled: number }` | § 7.6; mails `unplaced` / `cancelled` | `runCancelled` |
| GET `/scheduling/admin/courses/{courseId}/runs/{runId}/roster` | E+T | — | `{ run: RunAdminDTO; people: RosterRow[] }` | AP7 | — |
| GET `/scheduling/admin/courses/{courseId}/unplaced?cursor` | E+T | query | `{ people: RosterRow[]; cursor?: string }` | AP8, 100 per page | — |
| POST `/scheduling/admin/seats` | E+T | `{ courseId, runId?, who: WhoInput, channel }` | 201 `BookingAdminDTO` | admin seat rules; no `runId` → unplaced; token + mail `confirmed` | `runFull`, `runCancelled` |
| POST `/scheduling/admin/bookings/{bookingId}/move-seat` | E+T | `{ runId: string \| null, rev }` | `BookingAdminDTO` | course = the booking's; `null` → unplaced; condition `rev`; mail `moved` or `unplaced` | `runFull`, `runCancelled`, `notConfirmed`, `stale` |

CSV export of a roster is built in the admin page from the roster JSON: no route. The MCP server gets the admin
routes in `routes.json` (CLAUDE.md Definition of Done); visitor routes are renderer-only.

## 11. Mails and reminders

### 11.1 Mails (all seven keys are defined, defaulted and editable in `sched-1d`)

| Key | When | To | Link (new token, § 8.4) |
|---|---|---|---|
| `hold` | visitor hold, replay recovery, resend | customer | yes — the only way to confirm |
| `confirmed` | confirm; admin manual entry | customer; owner copy (`integrations.contactEmail`) | yes; group link for seats |
| `cancelled` | customer or admin cancel; held seats of a cancelled run | customer; owner copy on a customer cancel | no |
| `moved` | slot move, person move, run move | customer | yes |
| `unplaced` | run cancelled; admin moves a person out of a run | customer | yes (the page shows the new proposal) |
| `reminder` | § 11.3 (`sched-1g`) | customer | yes |
| `weekAhead` | § 11.4 (`sched-1g`): local Sunday, the next week's plan | the admin address only (`integrations.contactEmail`); `sendToCustomer` is not read for this key (no customer) and the admin screen hides it; `sendToAdmin: false` in the tenant override turns the mail off | no booking token; a link to the planner when the deployment has an admin URL (§ 11.4) |

Mechanism: the per-tenant template pattern of `order-email.ts` (F6): `{subject, body, sendTo…}` templates,
`{{variable}}` substitution (`renderTemplate`, `backend/src/lib/order-email.ts:89-97`), tenant overrides in a record
on `TenantConfig`, English defaults in the backend. Limit: English backend text, one template per key per tenant (a
two-language school writes one text; trigger: `lang-1a`). Scheduling adds `backend/src/lib/scheduling-email.ts`
(defaults, keys) and serves the defaults through GET `/scheduling/admin/email-templates`, so the admin screen holds
no second copy (`pay-1.md` F2 is not repeated). It imports `renderTemplate` from `order-email.ts` (the function is
generic; the module name is narrower than this use — recorded, no rename). Variables: `{{ref}}`,
`{{customerName}}`, `{{serviceName}}`, `{{courseName}}`, `{{when}}` (local date and time in the booking's zone,
with the zone name), `{{expiresAt}}`, `{{link}}`, `{{groupLink}}`, `{{siteName}}`; `weekAhead` only: `{{weekStart}}`,
`{{weekEnd}}` (local dates), `{{summary}}` (plain-text lines, as the order mail's `{{items}}`,
`backend/src/orders/create.ts:596-598`), `{{plannerLink}}`. Sender: `formatFromHeader`
(`backend/src/lib/email-from.ts:112`).

Mail failure: the `hold` mail → `state.mail = "failed"`, 503 `mailFailed`, recovery by replay (§ 7.2). Other
mails: logged; the change stands (as `pay-1`).

### 11.2 Wiring per function (`pay-1.md` revision-1 rule: every environment dependency is wired and asserted)

`SES_FROM_EMAIL` and one `ses:SendEmail` statement on the sending identity (the two lines of
`UpdateOrderStatusFunc`, `infra/lib/api-commerce.ts:245-258`) on each of the twelve mailing functions: visitor
hold, visitor confirm, visitor cancel, visitor move, admin booking cancel, admin manual appointment, admin move
slot, admin run move, admin run cancel, admin manual seat, admin move seat, reminder job.

Every scheduling function: `SCHEDULING_TABLE_NAME` and the grant it uses (read-only for GET routes); `TABLE_NAME`
with read on the main table. `EVENT_BUS_NAME` and `events:PutEvents` **only** on functions that publish a
main-table audit event (§ 6.5): the admin write routes for settings-side data (resources, feed secret, services,
availability, day edits, courses, runs incl. move and cancel, templates) and erasure. Not on the visitor routes, the
admin booking routes (cancel, manual appointment, move slot, manual seat, move seat) or the reminder function:
under SCHED-AUDIT-PII = C they publish nothing, so they get no permission to. `RENDERER_CLOUDFRONT_ORIGIN` on the twelve
mailing functions and the feed-secret route. `RECAPTCHA_SECRET_KEY` on the visitor hold. `ADMIN_URL` on the
reminder job only, always set, to the expression of the `AdminUrl` output (`infra/lib/amodx-stack.ts:691`,
OBSERVED): `https://admin.<rootDomain>` with a root domain, else `https://<admin distribution domain>`. The
scheduling nested stack is constructed after `AdminHosting` (`:486`) so the distribution exists in code; the value is
passed as a nested-stack property. No cycle (INFERRED): `AdminHosting` reads the parent `httpApi` URL, not the
nested stack.

### 11.3 Reminder job (`sched-1g`)

- Rule: `events.Rule` `rate(15 minutes)` → one function (pattern `infra/lib/amodx-stack.ts:388-391`), in the
  scheduling nested stack. The same function runs the daily expired-hold cleanup of § 14.1 on its first run in the
  03:00-03:14 UTC window; no second rule.
- Selection per tenant from AP12 (switch on, `reminderHours > 0`), window `[now, now + reminderHours]`: slots — AP3
  for each resource over the UTC dates of the window, confirmed entries with `s` in the window; seats — AP6 with
  `t = now`, runs with `firstStartIso` in the window and `status ≠ cancelled` on `RUN#`, confirmed entries of their
  `seats`.
- **Schedule identity** = the start instant `S` that the selection read. **Stale guard**:
  - slot: `UpdateItem BOOKING#` `SET reminderSentFor = :S`, condition `what.start = :S AND state.kind = :confirmed
    AND (attribute_not_exists(reminderSentFor) OR reminderSentFor <> :S)`;
  - seat: `TransactWriteItems` [the same update with `what.runId = :run` in place of `what.start = :S`;
    ConditionCheck `RUN#` `firstStartIso = :SIso AND #status <> :cancelled`].
  A move between selection and marking fails the condition → no reminder for the old time; the next run of the
  job selects the new start.
- Send after the mark succeeds, with a new token (§ 8.4). **Guarantee** (what one marker proves): at most one
  reminder per booking while its start stays the same. The marker holds only the last start reminded, so a booking
  moved A → B → A after reminders for A and for B gets a second reminder for A (accepted: each move was mailed, and
  the second A is a new appointment for the customer). A crash between mark and send loses that reminder (chosen
  over a duplicate every 15 minutes). A moved booking gets a new reminder without a reset step (new `S`).

### 11.4 Weekly planner mail (`sched-1g`; D18)

- **Sender**: the reminder function of § 11.3 — the scheduled job that also runs the daily cleanup. No new rule,
  no new function. Why not inside the daily cleanup pass itself: that pass runs at 03:00-03:14 UTC, which is still
  Saturday local time for a tenant west of UTC−3 (INFERRED from the offsets); "the tenant's local Sunday" needs a
  check in the tenant's zone, and the 15-minute runs of the same function provide it.
- **Selection**, on every run (operator decision, § 15): AP12 tenants with `schedulingEnabled === true` (a
  switched-off tenant gets none), `scheduling.timezone` set, `weekMailDue(now, timezone)` = `due` (local Sunday from
  09:00 until the target Monday starts, § 5.5), the effective `weekAhead` template has `sendToAdmin = true`, and
  **at least one resource with weekly hours** (an `AVAILABILITY#<r>` item with a non-empty `rules` list). A tenant
  with group runs only gets none: the mail reminds the admin to adjust the planner, and such a tenant has no planner
  content. (On a deployment line without `sched-1e` no `AVAILABILITY#` item is written — its route is in `1e` — so
  no mail is sent there, § 17.1.)
- **Recipient**: `integrations.contactEmail`. Absent → no mail and no marker; logged on each due run as
  `[scheduling] weekly mail: no contactEmail` with the tenant id (at most ~60 lines per Sunday).
- **Delivery (SCHED-WEEKMAIL-DELIVERY = B, operator decision, § 15)**, per selected tenant and run, target week
  `W = weekStart`:
  1. **Claim**: `UpdateItem WEEKMAIL#<W>` `SET claimedAt = if_not_exists(claimedAt, :now), ttl = :ttl`,
     `ReturnValues: ALL_NEW` (AP14). The result has `sentAt` → this week's mail was accepted already: stop. A
     `sentAt` that is not a number is logged and read as "not sent" (a duplicate is the harmless side, row C34).
  2. Read (§ 6.3 consumer row "Weekly mail"), build, send through SES.
  3. **SES accepted** → `UpdateItem WEEKMAIL#<W>` `SET sentAt = :now`. SES refused or the call failed → logged; no
     write; the next run tries again.
  4. The retries end by themselves: `weekMailDue` is `notDue` once the target Monday (tenant local) has started,
     so no run sends for week `W` after that.
- **Guarantee** (what the marker proves): `sentAt` present = SES accepted at least one copy for that tenant and
  week. Until then, **every due run makes one send attempt**. Duplicates are possible after an uncertain result: SES
  accepted but the `sentAt` write did not happen (a crash, a timeout), or two runs overlapped. A failure that lasts
  until Monday 00:00 local loses that week's mail (logged on each attempt). `claimedAt` records the first attempt
  only; it is not proof of a send.
- **Content** (`weekAhead` template, English default in `scheduling-email.ts`): subject "Your week from
  {{weekStart}}: hours and bookings"; body: a sentence that every week is open from the weekly defaults and can be
  changed in the planner; `{{summary}}`; `{{plannerLink}}`. `{{summary}}` = per resource with weekly hours or with an
  override in the week (by name, in name order), per day Monday-Sunday: the local date, the source (`default` /
  `edited` / `day off`), the windows (`09:00-12:00, 13:00-17:00`), the number of distinct active bookings that
  intersect the day (`planDay.entries`, § 5.5: a booking across midnight counts on both days), and `N outside hours`
  when `outsideHours` is not empty. **No customer name, email, phone or booking ref** in the mail (it goes to an
  address the tenant may share; the planner shows the details after sign-in).
- **Planner link** (R03): `{{plannerLink}}` = `<ADMIN_URL>/scheduling/planner?tenant=<tenantId>&week=<W>`.
  `ADMIN_URL` is the value `infra/lib/amodx-stack.ts:691` already resolves for the `AdminUrl` output (OBSERVED), in
  both deployment configurations: with a root domain `https://admin.<rootDomain>`; without one
  `https://` + `admin.distribution.distributionDomainName` (a value such as `https://d1abc.cloudfront.net`). What the link
  does after a click — sign-in return and tenant selection — is specified in § 23.5.

## 12. Calendar feed

- URL: `<base>/_booking/feed/<resourceId>/<secret>.ics` (`<base>` as § 8.2). The renderer handler calls POST
  `/scheduling/visitor/feed`; the backend compares `sha256hex(secret)` with `RESOURCE#.feedSecretHash` in constant
  time. Wrong secret, unknown resource, no secret set, switch off → 404, one body.
- Secret: 32 random bytes base64url, created in `sched-1d`, shown once, stored as a hash; a new secret replaces the
  old (the old URL stops at once). The secret is in the path and reaches CloudFront access logs if they are on
  (§ 18).
- Content: one `VEVENT` per confirmed appointment of the resource and per held one (`STATUS:TENTATIVE`), and one per
  meeting of each run where the resource is a trainer and the meeting intersects the window. Runs: AP6 with
  `t = windowStart` (keeps `firstStartIso <= windowEnd`), then on the `RUN#` items: the resource in `trainerIds`,
  `status ≠ cancelled`, the meetings that intersect the window.
  `SUMMARY` = service or course name + booking ref, or run size `5/8`.
- **Guarantee**: the feed contains **no customer name, email or phone**. It does expose, to whoever holds the URL,
  the resource's schedule: times, service and course names, booking refs and run sizes. Adding names is a decision
  (the URL would then carry customer data).
- Time: `DTSTART`/`DTEND` in UTC (`…Z`); no `VTIMEZONE`. Meetings converted from the run's zone (§ 5.1). `UID` =
  `<bookingId>@<tenantId>` or `<runId>-<n>@<tenantId>`; `DTSTAMP` = now. Window: 60 days back, 365 days ahead.
  `Cache-Control: private, max-age=300`.

## 13. Edits with bookings present (one rule each)

| Edit | Rule |
|---|---|
| Capacity lowered below seats taken | Allowed. Nobody is removed; existing holds keep their seats and can be confirmed (no recount, § 7.4); the roster shows `overCapacityBy`; new seats are refused until taken < capacity. |
| A meeting date changed (move a run) | Allowed unless `cancelled`; people stay; every active booking gets `moved`; reminders follow the new start (§ 11.3). |
| A service duration changed | Allowed. Existing bookings keep their stored start, end and `serviceName`; new slots use the new duration. |
| A service deleted | Allowed. Bookings keep `serviceId` and `serviceName`; the service no longer appears in `offer`; an admin move of such a booking keeps its stored duration (`end − start`). |
| A day turned off or shortened, or a default window removed (§ 23.4) | Allowed. Bookings on it stand (held ones can still be confirmed); nobody is mailed; the day-edit answer lists their refs (`outsideHours`) and the planner shows them on that day until the admin moves or cancels them. New visitor slots follow the new hours at once. |
| The defaults changed while dates have overrides | Allowed. A date with an override keeps it (the override replaces the defaults of that date, § 5.5); the planner marks such dates `dayHours` / `dayOff`, and "reset to defaults" (`value: { kind: "default" }`) removes the override. |
| A resource removed | Three steps, one attempt id `A` per request: (1) **acquire**: `UpdateItem RESOURCE#` `SET retiring = {attemptId: A, at: now}`, condition `attribute_exists(SK) AND (attribute_not_exists(retiring) OR retiring.at < :now − 10 min)` (a fence older than 10 minutes belongs to a crashed attempt and is taken over); failure → 409 `resourceRemovalInProgress` (or 404 when the resource is gone). (2) **check**, with consistent reads after the fence committed: AP3 from today on, and AP6 with `t = now` → BatchGet `RUN#` (`trainerIds`). (3a) anything active → `REMOVE retiring` with condition `retiring.attemptId = :A`, 409 `resourceInUse`; (3b) nothing → one transaction: delete `RESOURCE#` with condition `retiring.attemptId = :A`, delete `AVAILABILITY#<r>`, `DAYS#<r>`; 204. A step 3 whose condition fails (its fence was taken over) answers 409 `resourceRemovalInProgress` and changes nothing: one attempt never clears or uses another's fence. **Concurrency**: every inventory writer carries the resource guard (§ 4.2). A writer that commits before (1) is seen by (2); a writer that commits after (1) fails the guard (`retiring` present); a writer that read the resource earlier and commits after (3b) fails the guard (`attribute_exists`) → 409 `resourceUnavailable`. |

## 14. Data removal and retention

Smaller design by operator ruling (cycle 4): one daily cleanup of expired holds and one idempotent erasure pass. No
marker item, no attempt id, no takeover in customer-data removal. (The removal of a *resource*, § 13, keeps its
attempt-owned fence: it guards inventory writes, holds no customer data, and review-2 accepted it.)

### 14.1 Expired-hold cleanup (daily)

- Where: the reminder function (§ 11.3), on its first run each day in the 03:00-03:14 UTC window (the run's own
  scheduled time decides; no state is kept). A missed day is caught by the next one: the query is "expired more
  than 7 days ago", not "expired yesterday".
- Query per tenant, **every tenant whatever `schedulingEnabled`** (AP12): removing old holds is maintenance of stored
  customer data, not a visitor service, so switching scheduling off does not stop it (reminders and visitor routes do
  stop). AP13: `SK BETWEEN HELD# AND HELD#<now − 7 days, ISO>#\uffff`.
- For each hit, **one transaction** removes the item set: delete `BOOKING#` (booking rule: `attribute_exists(SK) AND
  rev = :rev`), `CUST#`, `HELD#`, `INTENT#<intentId>` if present, and every `TOKEN#` in `tokenHashes` (≤ 20).
  ≤ 24 items, under the 100-item limit (the 20-token cap bounds it). A `HELD#` exists only for a booking that was
  never confirmed, so the cleanup removes expired holds and holds cancelled before confirmation (a customer cancel
  of a held booking, a cancelled run), and never a confirmed booking.
- A failed condition → re-read the booking: absent → another pass removed it, skip; present → retry ≤ 3 times
  with the new `rev`.
- The container entry of the expired hold is not touched: it holds a booking id only, counts as free (expired),
  and the next writer of that container removes it (§ 7.1). Readers that meet such an id (planner week, feed) skip a
  booking that BatchGet does not return.

### 14.2 Erasure of one customer (`POST /scheduling/admin/customers/erase`, TENANT_ADMIN)

One idempotent pass with a read-back:

1. AP9: Query `begins_with(SK, CUST#<email>#)`, paginated to the end (§ 6.4), consistent.
2. For each booking, **one transaction** removes its item set and releases its place by the cancel rule: the
   container entry removed when present (container rule, § 7.1: `RESDAY#` or `RUN#` seats), delete `BOOKING#`
   (booking rule), `CUST#`, `HELD#<iso(heldUntil)>#<bookingId>` when `heldUntil` is present (also after a cancel: the
   booking keeps `heldUntil`), `UNPLACED#<courseId>#<bookingId>` when `what` is unplaced, `INTENT#<intentId>` when
   present, every `TOKEN#` in `tokenHashes`. Every key comes from the `BOOKING#` item read in this pass. ≤ 27 items. A failed condition → re-read: booking absent → already removed by another pass,
   skip (no-op); present → retry ≤ 3 times with the new `rev` and container version.
3. Read-back: AP9 again (consistent, to the end). Answer 200 `{ removedBookings, remainingBookings }`.
4. Audit `SCHEDULING_CUSTOMER_ERASED` with the two counts only.

**Acceptance boundary** (stated in this document and shown in the admin next to the button): "Everything that
existed when the action started is removed. A booking made during the action is reported by the read-back and
removed by running the action again."

Why it holds: a booking that existed at step 1 has its `CUST#` item, so step 1 finds it; step 2 removes it or finds
it already removed. A booking created after step 1's read may be missed by step 1; step 3 reports it. A writer on an
existing booking (token mint, move, confirm) runs under the booking rule, so it either commits before the removal
(the removal re-reads and removes the new state) or fails because the booking is gone; no token can be minted for a
removed booking. Two admins at once: both passes run the same idempotent transactions; the second finds removed
item sets and skips them. Not reached: `HOLDS#<emailHash>` and `LIMIT#EMAIL#<emailHash>#…` (hashes, no plaintext;
eligible for TTL deletion at their `ttl` — latest entry + 1 day, and 2 h — and deleted by DynamoDB some time after,
with no deadline), `LIMIT#ADDR#` items, mails already delivered, SES logs, contract
records (`contract-1`), commerce orders.

### 14.3 Retention

| Item | Kept until |
|---|---|
| Held booking never confirmed (expired, or cancelled while held) | its item set is removed by the cleanup 7 days after `expiresAt` (§ 14.1) |
| Confirmed booking, cancelled-from-confirmed booking, past booking | erasure of the customer (§ 14.2), as orders |
| `TOKEN#` | removed with its booking, by a cancel, or by the 20-token cap |
| `INTENT#` / `LIMIT#…` / `HOLDS#` | eligible for TTL deletion after 24 h / 2 h / latest entry + 1 day; DynamoDB deletes them some time after, with no deadline (each safe alone, § 6.2) |
| Container entry of a removed booking | the next write of that container |

Trigger to add a retention period for confirmed and past bookings: a tenant's or a regulator's stated period.

## 15. Decisions

### Settled by the human (recorded; consequences designed)

- SCHED-IDENTITY = emailed link, no account (2026-11-21) → § 8, § 9, § 16.
- SCHED-SHAPES = both shapes (2026-11-21); the order of the two build lines is by client date.
- Hosted page that also works in a frame; a tenant with no domain is ordinary (2026-11-21) → § 8.2, § 9.1, § 10.1.
- Scaffolding; the tenant owns its contract text (2026-11-21) → none here (`contract-1`).
- SCHED-PLANNER = B (2026-11-21): AMODX holds the calendar; a week planner on the weekly defaults, nothing
  materialized per week; a Sunday mail to the admin; a tenant setting for how far ahead visitors book → § 1 item 5,
  D16-D18, § 23. Operator decision the same day (the human gave no number): `bookingHorizonWeeks` default 8.

### Operator rulings (2026-11-21)

After review-0:

- SCHED-SEAT-BOUND = A as a recorded technical limit with a trigger (§ 4.5); kept below for the decision review.
- R01: a new token per mail, ≤ 20 live per booking (§ 8.4). R09: the paid-course path is cut out (§ 17.2). R10:
  shared support in `sched-1d`. R11: address extraction specified; the choice by a staging witness.

After review-2:

- **SCHED-ADDR-WITNESS-STAGE = B**: the client-address witness runs in `sched-1g`, the first slice in which the
  booking proxy exists (it replaces "witness in `sched-1d`" of the review-0 ruling); its success is a gate before
  any hosted or framed booking page is exposed to visitors (§ 9.2, row G13).
- **R07 scope freeze**: removal is made smaller, not more guarded — no TTL on customer data, a daily cleanup of
  expired holds, erasure as one idempotent pass with a read-back; no marker, attempt id or takeover (§ 6.1, § 14).

### Decided here (local detail or implied by a ratified rule)

Slot grid = service duration from the window start. One tenant timezone, copied onto each run. Moves keep the
booking id and every token. An expired hold is not revived. Admin writes skip the visitor's slot rules and the
`closed` / started / language seat rules, never `cancelled` or capacity. Customers move confirmed bookings only. No
`Completed` / `Done`. Seat mechanism S4.

Week planner (SCHED-1R, 2026-11-21; reasons in § 23): per-date overrides replace `ClosedTime` (one mechanism, as
the packet asks); an override replaces the defaults of its date, never merges; the horizon does not limit admin
writes (the packet's rule); day edits are allowed with bookings present and list them; the planner route is per
resource; overrides live in one `DAYS#<r>` item; the weekly mail is sent by the reminder function from local Sunday
09:00 to `integrations.contactEmail`; AP3 entries are normalized once (`activeEntries`: highest `rev` per booking,
local-day intersection, active filter, § 5.5); `CancelledBy` is renamed `Actor` (spec-only name, no code exists).

### Operator decisions after SCHED-1R review-0 (2026-11-21) — the human may override each

- **SCHED-WEEKMAIL-DELIVERY = B.** The packet's word "exactly-once" was wrong for a mail and is withdrawn. The mail
  is a reminder: a second copy is harmless, a lost one is not. Marker `claimedAt`; `sentAt` only after SES accepts;
  a run that finds a claim without `sentAt` sends again until the target Monday (tenant local) starts. Guarantee: at
  least one send attempt per job run until accepted; duplicates possible after an uncertain result (§ 11.4).
- **Weekly-mail population**: a scheduling-enabled tenant with at least one resource with weekly hours. A tenant
  with group runs only gets none: the mail reminds the admin to adjust the planner, and such a tenant has no planner
  content (§ 11.4).
- **Horizon population**: the booking horizon limits slot bookings only; a seat in a run is not limited (the admin
  sets each run's dates on purpose, and a course is sold months ahead) (§ 23.3).
- **All-resource appointments read restored** (`GET /scheduling/admin/appointments`, row E6): removing it was not
  asked (§ 10.3, § 23.5).
- **Planner link** (R03): the admin URL `infra/lib/amodx-stack.ts:691` resolves, in both deployment configurations;
  the login keeps a validated same-origin return path; the planner selects the link's tenant when the user may
  access it, else shows a "no access" state (§ 11.4, § 23.5).
- **No client version on day edits** (R06): the server writes conditionally and retries once on a lost condition;
  two admins editing the same date at the same instant → the later write wins (limit, § 18).
- **Interval reads for displays (scope freeze after review-2, R04)**: each `RESDAY#` entry carries the booking's
  `rev` (§ 7.3); `activeEntries` keeps, per booking, the copies with the highest `rev` among what one query returned,
  then intersects with the day and drops inactive entries. No reread, retry, `busy` or corruption report on this read
  path. Limit: a display read shows the highest `rev` the query returned; it has no freshness bound and a later read
  can still be stale
  (§ 5.5, § 18). The earlier transactional-reread procedure is withdrawn.

### Ratified by the human (2026-11-21) — no longer open

Ruling, in the human's words: "otherwise, ratify as recommended"
(`.agent-manager/slices/SCHED-1/human-ratification.md`). The outcome of each decision is the **Ratified** line
under its table; the tables stay as the record of what was weighed.

| Decision | Ratified |
|---|---|
| SCHED-TABLE | A |
| SCHED-PAYMENT-PATH | A |
| SCHED-CALENDAR | A |
| SCHED-PD-AMENDMENT | accept (§ 16.3, applied to PD-002 2026-11-21) |
| SCHED-SLOT-GUARD | B |
| SCHED-AUDIT-PII | C in the corrected form of § 22 (applied: § 4.4, § 4.5, § 6.5 incl. the settings writer, § 7.1, § 8.5, § 10.3, § 11.2, § 16.1, § 16.2, rows D10, D17) |
| SCHED-ADDR-LIMIT | A |
| SCHED-SEAT-BOUND | A (the human: groups are 10-12 people) |
| SCHED-PAGE-LAYOUT | A |

**SCHED-TABLE**

| Option | Reward | Risk |
|---|---|---|
| A. One scheduling-private table for both shapes | one boundary, one IAM rule, one backup, one removal path; one resource entity for practitioners and trainers | both shapes share one partition per tenant — not a limit at booking volumes (INFERRED) |
| B. A table per shape | hard separation | two tables, two grant sets, two removal paths for data of one sensitivity; resources duplicated or cross-table |

Recommended: A. **Ratified: A** (2026-11-21).

**SCHED-PAYMENT-PATH**

| Option | Reward | Risk |
|---|---|---|
| A. A course is a product sold through the checkout; the order creates the booking (`sched-1h`, its own specification, § 17.2) | coupons, vouchers, loyalty, order mails, invoices, online payment apply once | waits for `cmrc-4`; the order route is anonymous today (`/public/orders`), so its fit with the PD-002 amendment is an open question of `sched-1h`; a frame tenant reaches the checkout as a full page (`sched-frame-1.md` item 4) |
| B. Scheduling takes payments itself | no commerce dependency | a second checkout, invoices and coupon rules |

Free bookings and "pay at the practice" need neither. Recommended: A. **Ratified: A** (2026-11-21).

**SCHED-CALENDAR**

| Option | Reward | Risk |
|---|---|---|
| A. AMODX holds the schedule; staff subscribe to a read-only feed (§ 12) | one source of truth; small; no third-party token | a private busy time is typed in as a closed time |
| B. AMODX reads the practitioners' Google calendars | no double booking with private events | Google access per person, token storage, a second source of truth |

Recommended: A; ask the practitioner client whether its private calendar is full. **Ratified: A** (2026-11-21),
with the week planner (§ 1 item 5, § 23). Since § 23 the Risk cell's "closed time" is a day edit: `ClosedTime` is
removed and a private busy time is typed in the planner as a `dayHours` edit or a day off.

**SCHED-PD-AMENDMENT** — PD-002 names "appointment booking / list / cancel" by session
(`docs/platform-decisions.md:155`). Wording in § 16.3: four access classes (public derived reads, the initial hold,
token-authorized booking actions, feed-secret access), the tenant from the URL the renderer serves, no backend
route anonymous. Recommended: accept. **Ratified: accept** (2026-11-21); applied to `docs/platform-decisions.md`
PD-002 on 2026-11-21.

**SCHED-SLOT-GUARD**

| Option | Reward | Risk |
|---|---|---|
| A. One conditional lock item per 5-minute cell a booking covers | the base plan's lock idea; exclusion by item ownership | durations ≤ 240 min (≤ 48 cells + other items under 100 per transaction); up to 48 writes per booking |
| B. Resource-day container with version (§ 7.3) | one mechanism for slots, seats and open holds; durations to 480 min; one item per day | writes to one practitioner's day serialize (retries at contention; invisible at practitioner volumes, INFERRED) |

Recommended: B. **Ratified: B** (2026-11-21).

**SCHED-AUDIT-PII**

| Option | Reward | Risk |
|---|---|---|
| A. Visitor actions: actor `{ id: "booking:<ref>", email: "visitor (booking link)" }`; titles = ref + offer + local time; no customer name or email in any scheduling audit entry; admin actions keep the admin's email | no customer name, email or phone in the renderer-readable main table. Still renderer-readable there: booking refs, service and course names, local times, action names and admin emails | `actor.email` holds a label, not an address, for visitor actions (a recorded name/content mismatch); Critical Rule 7 read as "human-readable" |
| B. Customer email and name in audit entries (as `backend/src/contact/send.ts:113-120`) | the audit page shows who directly | customer data in the renderer-readable table for every booking |
| C. A scheduling audit trail in the private table | full detail, private | a second audit reader and page |

Recommended: A — **withdrawn** in the decision review (§ 22: A still writes booking refs, offer names and local
times into the renderer-readable table). **Ratified: C in the corrected form of § 22** (2026-11-21): `history` on
`BOOKING#` (§ 4.4), no booking event in the main table, main-table audit only for writes without customer data,
no `ip` (§ 6.5). The "second audit reader and page" of the Risk cell is the booking screen's history list, no new
page. Consequence accepted with the ratification: booking actions are not on the tenant-wide audit page.

**SCHED-ADDR-LIMIT** (basis corrected: no infra change rests on it)

| Option | Reward | Risk |
|---|---|---|
| A. Build the per-address limit (§ 9.2) on the header the `sched-1g` staging witness proves (`sched-1d` counts whatever address the renderer sends; until `sched-1g` none arrives) | a real per-address limit and a correct `remoteip`, most likely without infra | the witness may show neither header usable as specified; IPv6 counted per /64 can group neighbours |
| B. No per-address limit: reCAPTCHA + per-email limits + open-hold cap + short holds | nothing to verify | one machine with many addresses or emails past reCAPTCHA can hold many slots for `holdMinutes` |

Recommended: A. **Ratified: A** (2026-11-21); the staging witness G13 still gates visitor exposure (§ 9.2).

**SCHED-SEAT-BOUND** (operator recommendation A; kept for the decision review)

| Option | Reward | Risk |
|---|---|---|
| A. A run holds at most 45 people in this version (technical limit, § 4.5; the admin refuses more with a text that says so) | atomic run cancel in one transaction; small code | a client group above 45 is refused until the two-phase cancel is built |
| B. No maximum; build the resumable two-phase cancel now | no product limit from storage | more code and recovery evidence for a case no named client has |

Recommended: A (the named clients' groups are bench courses and workshops). **Ratified: A** (2026-11-21); the
human: "45 seats is fine, groups are max 10-12 people".

**SCHED-PAGE-LAYOUT** (keeping third-party scripts off the booking pages needs a structural route change)

| Option | Reward | Risk |
|---|---|---|
| A. A second root layout `app/%5Fbook/[siteId]/layout.tsx`, reached only by a middleware rewrite of `/_booking…` (§ 10.1) | no tenant script on the booking pages (no token exposure to analytics or the pixel); no site chrome inside a frame; the existing root layout and serving tree unchanged; a pattern `landing-1` and `lang-1` can reuse (a layout that knows its page through the rewrite) | a new branch in the middleware, the core of the serving contract (serving suite rows); a second root layout next to `app/not-found.tsx` (Next's not-found handling with two root layouts must be proven; INFERRED risk); navigation between the two trees is a full page load |
| B. Keep the pages under `app/[siteId]/` and its layout | no middleware or layout change | every tenant script (analytics, Facebook pixel, Paddle, popups, cookie banner) runs on the manage page, which reads the token from the address before it removes it (INFERRED exposure: such scripts read `location.href` when they load); site chrome inside frames, hidden only by CSS (as `landing-1`) |
| C. Move every existing route under `app/[siteId]/(site)/` with today's layout, and the booking pages under `app/[siteId]/(booking)/` with their own | no new rewrite target | moves every live route file of the serving tree; preview twin rewrites still need a middleware rule for the booking paths |

Recommended: A. **Ratified: A** (2026-11-21).

## 16. Amendment text (ratified 2026-11-21)

Applied 2026-11-21 by SCHED-1R: § 16.1 and § 16.2 as a dated amendment section at the top of the base plan (its
ratified text is kept below the amendment); § 16.3 to PD-002. **Not yet applied**: § 16.4 (those files are outside
the SCHED-1R allocation).

### 16.1 Base plan `docs/plan-appointments-private-table-extension.md`

> **Amendment 2026-11-21 (SCHED-1, ratified by the human on 2026-11-21).** Two booking shapes, an emailed link and
> a week planner.
> Read this section before the rest of the plan; where they differ, this section wins.
>
> **Goal** (replaces the first bullet "Authenticated booking only"): *Booking by emailed link.* A visitor books
> without an account; the booking is held, and an emailed link with a one-booking token confirms it and later
> shows, cancels or moves it. Booking calls stay renderer-proxied (PD-002 as amended, *Booking-token variant*). The
> other Goal bullets stand; the flag is `schedulingEnabled` (both shapes).
>
> **Non-Goals** (replaces "No anonymous bookings; a session is required" and "No numeric per-service pooled
> capacity"): no account and no session are required; link tokens replace them. Pooled capacity is in scope as a
> *seat in a group run* (`docs/slices/sched-1.md` § 4.3); per-service pooled capacity without runs stays out.
> Calendar sync stays out (SCHED-CALENDAR = A: AMODX holds the calendar; staff subscribe to a read-only feed).
>
> **Capacity model**: an appointment reserves one named resource (unchanged), is re-checked against the offered
> slots at write time, and is guarded by the resource-day container `RESDAY#<resourceId>#<utcDate>` with a version
> (SCHED-SLOT-GUARD = B), which replaces `SLOT#<resourceId>#<startIso>`: one lock per start does not stop overlapping
> bookings of different durations. A group seat is guarded by the seat map and version on `RUN#<courseId>#<runId>`.
> "Any available" stays discover-then-conditionally-write. The booking intent stays, with the replay rules of
> `sched-1.md` § 7.2.
>
> **Table name and keys**: the "appointments-private table" is the **scheduling-private table**;
> `SCHEDULING_TABLE_NAME`; items and access patterns as `docs/slices/sched-1.md` § 6. `APPOINTMENT#`,
> `APPTCUSTOMER#`, `APPTDATE#`, `SLOT#` are not used. Support module `backend/src/lib/scheduling-db.ts` (was
> `appointments-db.ts`).
>
> **Status values**: held, confirmed, cancelled; "expired" and "past" are derived. The admin status update
> "completed" is withdrawn (no reader).
>
> **Availability**: weekly rules per resource are the defaults; an override of one local date per resource
> (`dayOff`, or `dayHours` with its own windows) replaces the defaults of that date; nothing is materialized per
> week; a visitor books a slot at most `scheduling.bookingHorizonWeeks` ahead (default 8; seats in group runs and
> admin writes are not limited); the admin edits days, ranges and copies of a week in a week planner and gets a
> weekly mail on the tenant's local Sunday (`sched-1.md` § 5.5, § 11.4, § 23). There is no separate closed-time
> entity.
>
> **Notifications and Audit** (replaces the first bullet "Lifecycle events … call `publishAudit()`"): a lifecycle
> event of a booking (created, confirmed, cancelled, moved) appends an entry to the booking's `history` in the
> private table, in the same conditional write as the change (at most 50 entries, oldest dropped); it publishes no
> main-table audit event. Main-table audit (`publishAudit`) stays for writes with no customer data (settings,
> services, resources, availability and day edits, courses, runs, templates) and for erasure (two counts only); no
> scheduling audit event carries `ip` (SCHED-AUDIT-PII = C; `sched-1.md` § 6.5). The status update "completed" is
> withdrawn (**Status values**, above). The SES template bullet stands, with the keys of `sched-1.md` § 11.1.
>
> **Slices**: S1-S7 are replaced by `sched-1a` … `sched-1i` (`docs/slices/sched-1.md` § 17). The open items
> "reschedule semantics", "timezone source" and "slot granularity" are decided in `sched-1.md` § 15.

### 16.2 What the base plan keeps unchanged

The problem statement; tenant isolation; the private table outside renderer IAM; derived availability DTOs only;
the kernel/persistence split with injected clock and timezone; UTC instants in storage; the two-step "any
available"; the booking intent; the flag default false with route-specific enforcement; the dormant `CUSTOMER`
branch; no anonymous-bypass paths; the migration discipline for prototypes. **Changed** by SCHED-AUDIT-PII = C:
"audit on every lifecycle event" becomes "a history entry on every lifecycle event, in the private table" (§ 16.1
Notifications and Audit).

### 16.3 `docs/platform-decisions.md` PD-002

> In **Applies to**, replace "appointment booking / list / cancel in Phase 1" with:
> "scheduling (appointments and group seats): availability reads, booking, view, confirm, cancel and move, under
> the *Booking-token variant* above" (corrected 2026-11-21 from "below": the variant is added after **Trust cost**,
> which comes before **Applies to** in PD-002).
>
> Add after **Trust cost (accepted)**:
>
> ### Booking-token variant (amendment 2026-11-21, SCHED-1)
>
> For scheduling the customer has no session. The chain stays two hops: the browser talks only to the renderer; the
> renderer calls the backend with the `RENDERER` key. The tenant is derived from the URL the renderer serves — the
> host for a tenant with a domain, the `/_site/<tenantId>` path on a preview host for a tenant without one — never
> from the request body or a browser-set header. Four access classes, and nothing else:
>
> 1. **Public derived reads** (offer, free times, runs): no token; they return no customer data.
> 2. **The initial hold**: no token; verified by reCAPTCHA and limited per email (and per client address when
>    built); it creates a held booking and mails its first link.
> 3. **Token-authorized booking actions** (view, confirm, cancel, move): the renderer forwards a link token the
>    browser received by mail; the backend accepts it only as the lookup `TENANT#<tenantId>` +
>    `TOKEN#<sha256(token)>`, which reaches exactly one booking of that tenant.
> 4. **Calendar feed**: a per-resource secret in the feed URL, compared by hash; it returns the resource's schedule
>    without customer names, emails or phones.
>
> Choosing a tenant by URL grants nothing private: private data needs a token issued under that tenant. No backend
> route becomes anonymous; the `CUSTOMER` branch stays dormant (PD-003).

### 16.4 Documents updated at ratification (ripple list; not yet edited — outside the SCHED-1R allocation)

`docs/ROADMAP.md` (Track D table lines 171-183 → `sched-1a`…`1i`; line 110 "depends on C" removed; lines 325-327
`appt-*` → `sched-*`; the `sched-1` row status); `docs/documentation.md` (prefix `sched-` replaces `appt-`, line
101); `docs/plan-courses-group-sessions.md` § 3 ("a conditional seat counter on the run" → the seat map of § 7.4);
`CURRENT_SLICE.md` (Track D line).

## 17. Build slices

Common gates of every build slice: `npm run build`, `npm run typecheck`, the unit suites of the changed packages,
`git diff --check`; renderer slices also `npm --prefix renderer run test:serving`; slices with routes also
`npm --prefix tools/mcp-server test` and `routes.json`; slices with infra also `npm --prefix infra test` with named
assertions. Maturity target: PROTOTYPE until `sched-1i` passes on staging.

**Resource headroom** (F5): parent ≈ 467/500. The table adds 1 resource to the parent (in the `Database`
construct, `RETAIN`); the nested stack adds 1. Everything else lives in `infra/lib/api-scheduling.ts` (pattern of
`api-commerce.ts`: L1 `CfnRoute`/`CfnIntegration`, its own `CfnAuthorizer` on the parent's authorizer function).
Estimate (INFERRED; 4 resources per function, 3 per route): ≈ 45 functions × 4 + 44 routes × 3 + authorizer +
reminder rule and permission ≈ 315 of 500. § 23 removes 3 admin routes (the closed-time routes) and adds 3
(week, day edit, copy week): the estimate stays ≈ 315 of 500; the weekly mail adds no resource.

Abstraction line: **nested stack `api-scheduling.ts`** — users: every scheduling function and route; axis: the
CloudFormation 500-resource ceiling (demonstrated, F5); rejected: routes in the parent (≈ 467 + ≈ 315 > 500).

### 17.1 Slices

| Slice | Scope | Allocation sketch | Depends | Infra (named gain) |
|---|---|---|---|---|
| `sched-1a` | Types, Zod schemas, kernel of both shapes, `zoned-time`, `bookingBase`, `TenantConfig` fields (incl. `bookingHorizonWeeks`); week-planner kernel (§ 5.5: `dayWindows`, `lastBookableDate`, `planDay`, `editDays`, `weekMailDue`); `HistoryEntry`, `appendHistory` | `packages/shared/src/scheduling.ts`, `packages/shared/src/zoned-time.ts`, `packages/shared/src/index.ts`, `packages/shared/test/scheduling.test.ts` | — | none |
| `sched-1b` | Inert scheduling-private table | `infra/lib/database.ts`, `infra/lib/amodx-stack.ts`, `infra/test/amodx-stack.test.ts` | `1a` (order only) | the table: `1c` tests against it; customer data outside the renderer's IAM |
| `sched-1c` | `scheduling-db.ts`: container and booking rules (with the `history` append), every transaction of §§ 7, 8.4, 13, 14, refusal mapping, § 6.4 query rules; entry `rev` written by every write that adds or changes an entry (§ 7.3); `DAYS#` conditional read and write; the `WEEKMAIL#` claim and `sentAt` mark (AP14) | `backend/src/lib/scheduling-db.ts`, `backend/test/unit/scheduling-db.test.ts`, `backend/test/scheduling-db.integration.test.ts` | `1b` | none |
| `sched-1d` | Nested stack; visitor backend routes (not the feed; slots and holds read `DAYS#` and the horizon); shared admin routes (bookings with `history`, customers, resources, feed secret, mail templates); `scheduling-email.ts` with the seven keys (the `weekAhead` default is defined here, sent in `1g`); audit per § 6.5; reCAPTCHA; limits, with `client-address.ts` (the address limit counts what the renderer sends); minimal admin screen (scheduling settings, resources, mail templates) | `packages/shared/src/client-address.ts`, `backend/src/scheduling/visitor/*.ts`, `backend/src/scheduling/admin/{bookings,customers,resources,email}-*.ts`, `backend/src/lib/scheduling-email.ts`, `backend/src/tenant/settings.ts` (omit `ip` on saves with a scheduling key, § 6.5 point 4), `infra/lib/api-scheduling.ts`, `infra/lib/amodx-stack.ts`, `infra/test/amodx-stack.test.ts`, `admin/src/pages/Scheduling.tsx`, sidebar, `tools/mcp-server/routes.json` | `1c` | nested stack + routes: no route fits in the parent |
| `sched-1e` | Appointments admin: services, default availability, **week planner** (week route, day edits, copy week; § 23), manual slot, move slot; admin pages incl. the planner screen (§ 23.5) | `backend/src/scheduling/admin/appt-*.ts`, `admin/src/pages/SchedulingAppointments*.tsx`, `admin/src/pages/SchedulingPlanner.tsx`, `admin/src/App.tsx` (one route; the guard's `next` return path), `admin/src/pages/Login.tsx` (go to a safe `next` after sign-in, § 23.5), `api-scheduling.ts` (own routes), `tools/mcp-server/routes.json` | `1d` | routes inside the nested stack |
| `sched-1f` | Groups admin: courses, runs, move run, cancel run, roster, unplaced list, manual entry, move person, CSV export, group link; admin pages | `backend/src/scheduling/admin/group-*.ts`, `admin/src/pages/SchedulingCourses*.tsx`, `admin/src/pages/SchedulingRoster.tsx`, `api-scheduling.ts` (own routes) | `1d` | routes inside the nested stack |
| `sched-1g` | Hosted pages and proxies (§ 10.1) with the client-address extraction and its staging witness (§ 9.2; a gate before any visitor exposure), middleware branch, `mapTenant` reCAPTCHA mapping, locale keys EN + RO, reminder job, weekly planner mail (§ 11.4), calendar feed | `renderer/middleware.ts`, `renderer/src/app/%5Fbook/[siteId]/**`, `renderer/src/lib/dynamo.ts`, `renderer/test/serving-contract/*`, `packages/shared/src/language-packs/*`, `backend/src/scheduling/reminders.ts` (reminders, daily cleanup, weekly mail § 11.4), `backend/src/scheduling/visitor/feed.ts`, `api-scheduling.ts` (incl. `ADMIN_URL` on the reminder function) | `1d` | one schedule rule: reminders cannot run otherwise; the weekly mail adds none |
| `sched-1h` | **Needs its own specification after SCHED-PAYMENT-PATH and `cmrc-4`** (§ 17.2) | — | `1f`, `pay-1`, `cmrc-4`, its specification | — |
| `sched-1i` | Validation on staging of every guarantee | tests and a staging runbook only | all in use | none |

`sched-1e` and `sched-1f` each depend on `sched-1d` only; they touch disjoint files except `api-scheduling.ts`
(each appends its own routes) and the admin sidebar (one line each). The weekly mail of `sched-1g` links to the
planner of `sched-1e`; on a line without `1e` no `AVAILABILITY#` item is written, so no tenant has a resource with
weekly hours and the mail is never sent (§ 11.4 selection). The practitioner line: `1a`-`1e`, `1g`,
`sched-frame-1`. The school line: `1a`-`1d`, `1f`, `1g`, then `1h` and `contract-1`.

### 17.2 Boundary of the paid-course path (not designed here)

The one function a paid order will call, in `scheduling-db.ts`:

```ts
bookingItemsForOrderLine(input: { tenantId: string; orderId: string; line: number; courseId: string;
                                  runId: string | null; who: Person; now: Instant })
  : Promise<Result<{ items: TransactWriteItem[]; afterCommit: () => Promise<void> }, SeatRefusal>>
```

Guarantees: the returned items, committed inside the caller's order transaction, either take one seat in the run
(container rule; admin seat rules) or create an `unplaced` booking; the booking is `confirmed`, source `order`, and
writes the item set and the container entry together, like every booking creator (§ 6.1); the payment state is **not** copied — the
roster reads it from the order; `afterCommit` mints the token and mails `confirmed`.

Questions its own specification must answer: how the run is chosen and carried from the product page through the
cart to the checkout; quantity semantics (one line of quantity *n* = *n* people?) against the order limits of 50
lines and quantity 100 (`packages/shared/src/index.ts:1799-1813`) and the 100-item transaction limit (two lines on
one run address one item: they must merge); cart identity, today `productId` + variant
(`renderer/src/context/CartContext.tsx:68-70`), so two runs of one course would merge; participant data per seat;
the mail and environment wiring of the order function; and how a booking created through the anonymous order route
fits the PD-002 amendment (§ 16.3 classes).

### 17.3 Evidence taxonomies (rows a builder binds tests to)

**Field evidence inventory (SCHED-1R).** Every field this amendment adds, with the rows that cover absent, valid
and malformed values. A field with no malformed case states why.

| Field | Where | Absent | Valid | Malformed |
|---|---|---|---|---|
| `scheduling.bookingHorizonWeeks` | `TenantConfig` (§ 4.1) | A23, D14 (→ 8) | A23, D14, A17 | A23, D14 (request → 400; stored → `storedDataInvalid`) |
| `DayOverride` (`kind`, `windows`, `note`) and its map keys | `DAYS#.days` (§ 4.2, § 6.2) | A22, A16 (date → defaults) | A22, A16 | A22 (shape and keys), C33 (stored) |
| `RESDAY#` entry `rev` | container entry (§ 6.2, § 7.3) | C35 (4) (stored → schema refuses; no legacy entries exist: the table is new) | C35 (1)-(3), A25 | C35 (4) (`0`, `1.5`) |
| `DAYS#.v` | server-side version (§ 6.2) | C33 (no item → created with `v = 1`; item without `v` → `storedDataInvalid`) | C31 | C33 (`0`, `1.5`) |
| `Booking.history` | `BOOKING#` (§ 4.4) | A24 (absent or empty refused) | A24, A26 (after truncation, without `created`), C32, D16 | A24 |
| `schedulingEmailConfig.templates.weekAhead` | `TenantConfig` (§ 11.1) | D13 (→ default) | D13, G15 | D13 (no `subject` → 400) |
| `WEEKMAIL#` `claimedAt`, `sentAt`, `ttl` | scheduling table (§ 6.2) | C34 (no item → claim) | C34, G14 | C34 (`sentAt` not a number → "not sent"); `claimedAt` and `ttl` are written only by the claim, never read for a decision, so a malformed value changes nothing |
| `GET …/week` `start` | admin route (§ 10.3) | E22 | E22, E16 | E22 |
| `PUT …/days` `from`, `to`, `value` | admin route (§ 10.3) | E23 | E23, E9, A19 | E23, E9 |
| `POST …/copy-week` `sourceStart`, `targetStart`, `weeks` | admin route (§ 10.3) | E23 | E23, E10, A20 | E23, E10 |
| Planner page `tenant`, `week` | admin URL query (§ 23.5) | E24 | E17, E19, E24 | E20 (tenant not allowed), E24 |
| Login `next` | admin URL query (§ 23.5) | E18 (→ `/`) | E18, E21 | E21 |

**`sched-1a`** (pure, `packages/shared` vitest)

| Row | Input | Expected |
|---|---|---|
| A1 | § 5.2 slots example | `07:00Z`, `09:00Z` |
| A2 | `2027-03-29 09:00` / `2027-03-28 03:30` / `2026-10-25 03:30` Bucharest | `06:00Z` / `nonexistentLocalTime` / `00:30Z` |
| A3 | `slotDecision`: past; beyond the horizon; off grid; ineligible; outside every window; on a `dayOff` date; in the part a `dayHours` edit removed; resource fenced | `inPast`; `beyondHorizon(lastBookableDate)`; `notOnGrid`; `notEligible`; `outsideAvailability` (three rows); `resourceUnavailable` — every `SlotRefusal` variant |
| A4 | `overlapCheck` with a held entry before and after `x` | `overlap`; ok |
| A5 | seats example; admin into `closed`; admin into `cancelled` | taken 7 then `runFull(8)`; ok; `runCancelled` |
| A6 | proposal example | `proposed(R4)`, others `[R1, R2]`, R3 absent |
| A7 | `notSet` + `ro`; admin placement across languages | `set(ro)`; unchanged |
| A8 | visitor on a started run; admin | `runStarted`; ok |
| A9 | change at cutoff − 1 ms / at cutoff; order source; customer move of a held booking | ok / `tooLate`; `paidContactTenant`; `notConfirmed` |
| A10 | confirm before / at `expiresAt`; confirmed again | apply / `expired`; noop |
| A11 | meetings errors | each `MeetingError` variant |
| A12 | cancel-run effects example | `toUnplace [A]`, `toCancel [B]` |
| A13 | `bookingBase` with `x.example`, `x.localhost`, absent | `https://x.example`; preview base; preview base |
| A14 | in a temporary copy: a fourth `BookingWhat` variant; a third `DayOverride` kind; a fifth `HistoryEntry` action | compile errors at every `switch` over that union (recorded, removed) |
| A15 | Zod: email valid only after normalization; capacity 46; duration 7; `trainerIds: []` | normalized accepted; 46, 7 and `[]` refused |
| A16 | precedence (§ 5.5 table): Monday with `dayHours [09:00-12:00]`; Monday without override; Sunday `dayHours [10:00-12:00]` with no Sunday default; Monday `dayOff`; `availableSlots` over these days | `dayWindows` source and windows as the table; slots only inside the effective windows; the § 5.2 `dayHours` example → `07:00Z`, `09:00Z`; `dayOff` → none |
| A17 | `lastBookableDate`: `now` 2026-12-01T10:00Z, 8 weeks; `availableSlots` with `to` after it; `slotDecision` on 2027-01-26 23:00 local and 2027-01-27 09:00 local | `2027-01-26`; days after it present with no starts; allowed; `beyondHorizon(2027-01-26)` |
| A18 | `planDay`: the § 5.5 example; a held entry after its `x` (expired) on that day; a date `< today − 6`; a window bound inside the 2027-03-28 spring gap (`dayHours [03:30-06:00]`) | `removed [12:00-13:00]`, `outsideHours [id]`, `open` as the table; the expired entry neither cuts `open` nor appears in `outsideHours`; `kind: "past"` with entry ids only; the window starts at 04:00 local (`01:00Z`) |
| A25 | `activeEntries` (pure), the cases of the operator ruling: (a) the 01:30-02:30 local booking given twice, both copies `rev 3` (UTC-midnight case); (b) the admin booking local 2026-12-07 23:30 - 2026-12-08 00:30 with 2026-12-08 `dayOff`, through `planDay` for both dates (local-midnight case); (c) two copies of one booking, `rev 3` held and `rev 4` confirmed; (d) a move seen half-way: the old placement `rev 5` in day A and the new placement `rev 6` in day B; (e) overlapping bookings A and B, where the query saw B's copy in day D1 at `rev 2` (held) and in day D2 at `rev 3` (confirmed during the read), and A's two copies at `rev 7`; (f) one active copy and one expired copy of another booking | (a) one entry; (b) the booking in `entries` of both days and in `outsideHours` of 2026-12-08; (c) only the `rev 4` copy (confirmed); (d) only the new placement; (e) no error, A once at `rev 7`, B once at `rev 3` — A is never affected by B; (f) the expired one is dropped (after step 2, by the active filter) |
| A19 | `editDays set`: the § 5.5 example; `value: default` on a date with an override; `from > to`; 367 dates; `from` = yesterday; a result with 367 keys; keys at `today − 7` and `today − 6` in `current` | 4 `dayOff` keys, `changed` = those 4; the key removed; `rangeInverted`; `rangeTooLong(366)`; `startsInPast(today)`; `tooManyDays(366)`; the `today − 7` key pruned and not in `changed`, the `today − 6` key kept |
| A20 | `editDays copyWeek`: the § 5.5 example; a Tuesday source with a Monday target; target week = source week; `sourceStart = today − 7`; `targetStart` = yesterday | the 3 Mondays set, the other 18 target overrides removed; `weekdayMismatch`; `targetOverlapsSource`; `sourceTooOld(today − 6)`; `startsInPast` |
| A21 | `weekMailDue`: the five § 5.5 examples; a Monday 10:00 local | `notDue`; `due 2026-12-07`; `due 2026-12-07`; `notDue`; `notDue`; `notDue` |
| A22 | Zod `DayOverride` (evidence taxonomy: absent / valid / malformed): no key for a date; `dayOff`; `dayOff` with a 200-character note; `dayHours` with 1 and with 8 windows; malformed: `dayHours` with `[]`, with 9 windows, `end <= start`, two overlapping windows, `09:03`, unsorted windows, a 201-character note, `kind: "closed"` | absent → the date follows the defaults; valid ones accepted; every malformed one refused with an issue that names the field; map keys `2026-13-01`, `2026-12-7`, `2026-02-30`, `tomorrow` refused (a key must be a real `YYYY-MM-DD` date) |
| A23 | Zod `scheduling.bookingHorizonWeeks`: absent; 1; 52; malformed 0, 53, 2.5, `"8"` | absent → 8 by default; 1 and 52 accepted; the four malformed refused |
| A24 | Zod `HistoryEntry` and `appendHistory` (evidence taxonomy of `Booking.history`): absent `history`; `history: []`; each of the four actions; malformed: unknown `action`, `moved` without `from`, `cancelled` with `by: { kind: "admin" }` without `email`, `at` not a number, a list of 51; `appendHistory` on 50 entries | absent and `[]` refused (the stored list is **non-empty**: the creating Put writes one entry and no write removes the last one); each valid one accepted; each malformed one refused; the result has 50 entries, the oldest dropped, the new one last |
| A26 | history after truncation: a booking whose 50 entries start with `created`, then one more change through `appendHistory`; the resulting list validated by the stored-item schema of `Booking` (the one used on every read); a list of 50 `moved` entries with no `created` at all | 50 entries, `created` gone, the new entry last; the schema **accepts** it; the schema accepts the all-`moved` list (no rule requires `created` to stay: the booking's `createdAt` and `source` keep that fact, § 4.4) |

**`sched-1b`** (infra assertions; staging `cdk diff`)

| Row | Expected |
|---|---|
| B1 | table: `PAY_PER_REQUEST`, PITR, TTL `ttl`, `DeletionPolicy: Retain`, `PK`/`SK`, no GSI |
| B2 | no statement of the renderer server function's role names the table ARN |
| B3 | no function has `SCHEDULING_TABLE_NAME` yet |
| B4 | parent count logged and `< 500` (`(split1-5)`) |
| Staging | `cdk diff`: one table added, nothing else; the table exists and is empty |

**`sched-1c`** (unit with a mocked client for transaction shapes; integration against the staging table with
injected clocks, `cd backend && npm test`)

| Row | Input | Expected |
|---|---|---|
| C1 | 20 parallel seat holds, 1 free seat | exactly 1 success, 19 `runFull`; active count = capacity |
| C2 | parallel slot holds 60 min at 09:00 and 30 min at 09:30, one resource | exactly 1 success |
| C3 | confirm and hold at expiry, both commit orders, clocks skewed ±2 s | never over capacity or overlapping; loser `expired` (`seatLost`) or `runFull`/`slotTaken` |
| C4 | intent replay: same fingerprint; changed language; changed email | same booking; `intentReused`; `intentReused` |
| C5 | fault point after the hold commit, before the send; then replay | first call fails; replay → 201, mail sent once, `mail = sent` |
| C6 | send fails; replay | 503 `mailFailed`, hold kept; replay → 201, mail sent |
| C7 | replay of confirmed / expired / cancelled booking; replay with a spent reCAPTCHA token | 200 `confirmed` / 409 `intentClosed` / 409 `intentClosed`; 200 (not verified) |
| C8 | capacity lowered below taken; a held booking then confirms | 200; confirm succeeds; a new hold `runFull` |
| C9 | two first enrolments `ro`/`en` on `notSet` | one wins; the other `languageMismatch` |
| C10 | two moves of one booking at once | one commits; the other re-reads and decides from the new `what`, or answers `stale` when it carried a `rev` |
| C11 | resource removal against inventory writes: (a) a visitor hold, both orders; (b) a hold and an admin manual appointment that read the resource before a removal that completes before they commit; (c) a run trainer change naming the resource, both orders; (d) two removal requests at once; (e) a removal attempt crashed after acquire, then a new request at +5 min and at +11 min; (f) attempt A's release racing attempt B's takeover; (g) a move of an ended run to future dates, whose trainer is being removed, both commit orders | (a), (c): either the write commits and removal → `resourceInUse`, or the fence commits and the write → `resourceUnavailable`, never both; (b) both writes → `resourceUnavailable`, no booking names the deleted resource; (d) one 204 or `resourceInUse`, the other `resourceRemovalInProgress`; (e) +5 min → `resourceRemovalInProgress`, +11 min → takes over and completes; (f) A's conditional step fails, B's fence stays; (g) either the move commits first and the removal → `resourceInUse`, or the fence commits first and the move → `resourceUnavailable`; never a future run with a deleted trainer |
| C26 | a run's trainers change from R1 to R2 (run update route), then removal of R1 and of R2 | R1 removal is not refused by that run; R2 removal → `resourceInUse` (the check reads `RUN#.trainerIds`) |
| C25 | cancel of an unplaced booking; admin move seat → unplaced → seat | `UNPLACED#` deleted / put / deleted in the same transaction; AP8 lists exactly the unplaced ones |
| C12 | cancel a run of 45 | one transaction; 45 changed; `RUNSPAN#` gone |
| C13 | erasure while a hold for the same email is placed (the hold commits after step 1's read) | answer `remainingBookings = 1`; a second run removes it and answers 0 |
| C14 | 21 link mails for one booking | the first token → 404, the 21st → 200; `tokenHashes` length 20 |
| C15 | cancel | every token → 404 |
| C16 | item-set invariant, one row per operation: (1) create (hold, manual appointment, manual seat); (2) confirm; (3) move (slot, seat, unplaced); (4) cancel (held, confirmed, unplaced); (5) expiry cleanup; (6) erasure, including the lifecycle hold → cancel while held → `INTENT#` TTL-eligible → erase — after each, fault injected after its transaction | `BOOKING#` and `CUST#` both exist or both do not; no `HELD#`, `UNPLACED#` or listed `TOKEN#` without its `BOOKING#`; after the cancel-then-erase lifecycle the `HELD#` item built from `heldUntil` is gone |
| C27 | two erasures of one email at once | both answer 200; total removed = bookings that existed; no transaction error surfaces; read-back 0 |
| C28 | a `TOKEN#` item whose booking was removed (left by injecting a fault into a test-only path, or written directly) | the link answers 404 `linkNotValid`; view, confirm, cancel and move change nothing |
| C29 | daily cleanup: a hold expired 8 days ago, one expired 6 days ago, a confirmed booking, a hold cancelled while held 8 days after expiry; a second cleanup run the same day; a missed day; a hold made, then scheduling switched off for the tenant, 8 days later | the 8-day hold and the cancelled-while-held are removed (≤ 24 items each); the others stay; the second run changes nothing; the next day catches up; the switched-off tenant's hold is removed and no reminder was sent |
| C30 | items with `ttl` | only `INTENT#`, `LIMIT#EMAIL#`, `LIMIT#ADDR#`, `HOLDS#`, `WEEKMAIL#` carry `ttl`; no `BOOKING#`, `CUST#`, `TOKEN#`, `HELD#`, `DAYS#` does |
| C31 | `DAYS#` writes: two day edits of one resource at once on different dates; two at once on the same date with different values; three at once (the condition lost twice); the first edit of a resource (no item) | both dates stored (the loser re-reads, re-applies and writes again: no lost update); the value of the write that commits last; one 503 `busy` and nothing of it stored; the item created with `attribute_not_exists(SK)`, `v = 1` |
| C32 | `history` in the same write, one row per operation of C16 (create ×3, confirm, move ×3, cancel ×3) and a run cancel of 45, with a fault after each transaction; a booking changed 51 times | after each: exactly one new entry of the right variant (`moved` carries the old and new `Placement`), or none when the transaction did not commit; the run cancel stays ≤ 92 items; 50 entries, the oldest gone |
| C33 | stored-data evidence for `DAYS#` (absent / valid / malformed): no item; a valid item; items written directly with a `dayHours` of `[]` windows, a key `2026-13-01`, no `v`, `v = 0`, `v = 1.5` | the defaults (and the first write creates the item); the overrides; each malformed item → the read fails Zod and the caller gets `storedDataInvalid` (never "no override", which would open a day the admin closed); `v` must be an integer ≥ 1 |
| C34 | `WEEKMAIL#` marker (`claimedAt`, `sentAt`, `ttl`; absent / valid / malformed): a first claim; a second claim of the same week (no `sentAt`); a claim after `sentAt` was written; two claims at once; a claim for the next week; a stored marker with `sentAt` not a number | `claimedAt` set, `sentAt` absent → send; `claimedAt` unchanged, `sentAt` absent → send again; `sentAt` returned → stop; both return without `sentAt` (both send: the documented duplicate case); a new item; every item has `ttl = weekStart + 14 days`; the malformed marker is logged and read as "not sent" (send again: a duplicate is harmless under SCHED-WEEKMAIL-DELIVERY = B) |
| C35 | entry `rev` in persistence (staging table, injected clock): (1) after a hold, a confirm, a slot move (same day; to another day; across UTC midnight) and a manual appointment, read both `RESDAY#` copies and `BOOKING#`; (2) after a token mint and a reminder mark; (3) the list function of `scheduling-db.ts` that the four consumers call, with a mocked client whose one `Query` returns the A25 (c), (d) and (e) items; (4) field evidence of the entry `rev` (absent / valid / malformed), items written directly: an entry without `rev`; `rev` 1; `rev` 0; `rev` 1.5 | (1) every entry of the booking has `rev` = `BOOKING#.rev`; (2) the entries are unchanged (their `rev` is now one or more below `BOOKING#.rev`, and the copies stay equal); (3) the A25 results, exactly one `Query` per resource and range, no other read, no error, no `busy`; (4) the absent and malformed ones fail the `RESDAY#` item schema → `storedDataInvalid` by the stored-item rule of § 10.2 (schema validation, not a comparison of copies); `rev` 1 accepted |
| C17 | a run that started before a window, with a meeting inside it | found by AP6 |
| C18 | a query with more than one page; a BatchGet with `UnprocessedKeys` (mocked) | all pages read; retried; 503 after 5 attempts |
| C19 | a booking id or token of tenant A under tenant B | not found |
| C20 | three holds of one email | the third `tooManyForEmail`; after one confirm, a new hold passes |
| C21 | token mint and confirm at once (fault injection between read and write, both orders) | after both: the booking is confirmed, `tokenHashes` lists both tokens, both open it |
| C22 | token mint and cancel at once, both orders | after both: no `TOKEN#` of the booking exists, `tokenHashes = []`; when cancel won, no mail was sent |
| C23 | token mint and erasure at once, both orders | after both: no `TOKEN#` of the booking exists (read back by every hash either side created), or the mint failed and sent no mail |
| C24 | run cancel with a crash injected after commit, before the held bookings' token cleanup; then erase of one such email | the held booking's tokens answer 404; erasure removes them (they are listed) |

**`sched-1d`** (backend unit + infra assertions + staging)

| Row | Input | Expected |
|---|---|---|
| D1 | switch off; tenant record missing | 403 `notAvailable` on every visitor route except the feed, which answers 404 `linkNotValid` |
| D2 | visitor route called with a `TENANT_ADMIN` or `EDITOR` token; with a `GLOBAL_ADMIN` token; with no credential | 403; passes `requireRole` (policy, `backend/src/auth/policy.ts:39`) and is handled like the renderer, with the `x-tenant-id` it sent; 401 |
| D3 | no reCAPTCHA token; low score | 400; 403; nothing written |
| D4 | 6th hold of one email in an hour | 429 `tooManyForEmail` |
| D5 | hold | 201 without token or id; one mail whose link has `#t=`; booking held, `mail = sent` |
| D6 | confirm with a valid / expired / unknown / other tenant's token | 200 / 410 / 404 / 404 |
| D7 | admin cancel, invoked later than and apart from the hold call | `cancelled` mail without link; every token → 404 |
| D8 | arbitrary start submitted to the hold: off grid; outside the windows; past; after `lastBookableDate`; on a date with a `dayOff` override (written through `scheduling-db.ts`) | `notOnGrid` / `outsideAvailability` / `inPast` / `beyondHorizon` / `outsideAvailability` |
| D9 | offer, slots, runs DTOs | no resource id or name, email, phone or customer name in the JSON |
| D10 | SCHED-AUDIT-PII = C oracle, with a mocked EventBridge client that records every `PutEvents`: a visitor hold, confirm, cancel and move; an admin manual entry, cancel and move; a resource create; an erasure | (1) **no booking event in the main table**: the booking operations send no `PutEvents` at all; (2) **`history` present on `BOOKING#`**: after each booking operation the stored item has the matching `HistoryEntry` as its last entry; (3) the resource create sends one event with the admin's `actor.email` and the resource name as `target.title`; the erasure sends `SCHEDULING_CUSTOMER_ERASED` with the two counts only; (4) **no `ip`**: no recorded event has an `ip` key; and no recorded event contains a booking id, ref, customer name, email or phone anywhere in its JSON |
| D11 | `client-address.ts` unit rows: every example and every invalid form of § 9.2, with `k = 1` and `k = 2`; `addressKey` of IPv4, IPv6, mapped IPv4; the hold route with `x-viewer-address` from a RENDERER call, from another role, and absent | the § 9.2 tables exactly; another role's header ignored; absent or invalid → no address limit |
| D12 | resource delete with a future booking; without | 409 `resourceInUse`; 204, `AVAILABILITY#` and `DAYS#` items gone |
| D13 | email templates: defaults served for all seven keys; an override used; `schedulingEmailConfig.templates.weekAhead` absent / valid / malformed (no `subject`) through `PUT /settings`; feed secret answers the URL once | as stated; `weekAhead` default has `sendToAdmin: true`; absent → default, valid → stored and used, malformed → 400 |
| D14 | `scheduling.bookingHorizonWeeks` through `PUT /settings`: absent, 1, 52, 0, 53, 2.5, `"8"`; a stored 0 written directly | default 8 used; stored; stored; 400 ×4; visitor slots → 500 `storedDataInvalid` |
| D15 | `slots` with `to` after `lastBookableDate`; `slots` with `from` after it | 200, `lastBookableDate` in the DTO, the days after it with no starts; 200 with every day empty |
| D16 | `GET /scheduling/admin/bookings/{id}` after a hold, a confirm and a move | `history` = `created`, `confirmed`, `moved` in that order, instants as UTC ISO |
| D17 | `PUT /settings` audit (mocked EventBridge) with a body of: only `scheduling` keys; `scheduling` + `name` (mixed); only `name`; the mixed body again after a reload of the record | `UPDATE_SETTINGS` without an `ip` key; without an `ip` key, `updatedFields` lists both keys; **with** `ip` = the source address (preservation of today's behaviour); in all four cases the record is saved, `rejectedFields` and the page purge behave as before (the existing settings tests still pass) |
| I1 | every mailing function of § 11.2 (synth) | `SES_FROM_EMAIL` and exactly one `ses:SendEmail` on the identity (not `*`) |
| I2 | every scheduling function (synth) | `SCHEDULING_TABLE_NAME`; GET functions have no write action; `events:PutEvents` and `EVENT_BUS_NAME` exactly on the functions § 11.2 lists, on no visitor or admin booking function |
| I3 | the hold function (synth) | `RECAPTCHA_SECRET_KEY` equal to the commerce order function's |
| I4 | renderer role (synth) | no statement on the table |
| I5 | template counts (synth) | nested stack count logged; parent `< 500` |
| Staging | operator | hold → mail (a real test mailbox: the SES simulator discards the link) → confirm → cancel through the backend with the renderer key; items read back; cleanup |

**`sched-1e`** (backend unit + admin build + staging)

| Row | Input | Expected |
|---|---|---|
| E1 | eligibility `only` | limits slots to the listed resources |
| E2 | `PUT …/days` with `dayOff`, and with a shorter `dayHours`, on a date with one confirmed and one held booking; `dayOff` on 2026-12-08 with an admin booking local 2026-12-07 23:30 - 2026-12-08 00:30; a range edit over two days that both contain the same cross-midnight booking | the affected starts leave `slots` at once; 200 with both refs in `outsideHours`; both bookings unchanged (the held one can still be confirmed), no mail sent; the cross-midnight booking's ref in `outsideHours`; its ref listed once |
| E3 | service deleted | its bookings keep `serviceName`; `offer` omits it |
| E4 | duration change | an existing booking keeps its start and end |
| E5 | manual booking outside the windows; on a `dayOff` date; after `lastBookableDate` | confirmed in each case (the admin is not bound by § 5.5); mail with a working link |
| E6 | `GET /scheduling/admin/appointments?from&to` over 3 days with two resources (the reviewed day view); a booking local 01:30-02:30 on 2026-12-07 in `Europe/Bucharest` (stored in two `RESDAY#` items, § 7.3); 32 days | every resource's intervals with ref, customer name and service name; that booking listed **once**; 400 `rangeTooLong` |
| E7 | move slot | keeps id and tokens; an old link opens the moved booking |
| E8 | move slot with a stale `rev` | 409 `stale` |
| E9 | `PUT …/days`: 366 dates; 367 dates; `from` yesterday; `value: default` on an edited date; windows of A22's malformed list | 200; 400 `rangeTooLong`; 400 `startsInPast`; the date in `changed` and the week read shows it `source: default`; 400 per field |
| E10 | `POST …/days/copy-week`: A20's example and refusals; `weeks` 0 and 53 | as A20; 400, 400 |
| E11 | two `PUT …/days` at once on different dates; on the same date; a body that carries a `v` field | both applied; the later write's value stored; 400 `invalid` (unknown key: the client sends no version) |
| E12 | audit of a day edit and of a default-availability change (mocked EventBridge) | one event each, `actor.email` = the admin, `target.title` = the resource name, `details` = dates and kind; no ref, no `ip` (§ 6.5) |
| E13 | `PUT …/availability` changes Monday's defaults while one Monday has a `dayHours` override | that Monday keeps its override; the other Mondays follow the new defaults |
| E14 | removed routes: `GET/POST/DELETE …/closed…` | not in `api-scheduling.ts`, not in `routes.json` (MCP route coverage test); `GET /scheduling/admin/appointments` is present |
| E15 | planner screen (admin build; staging by the operator, English UI) | open time, bookings and unavailable time are distinct on the week grid; edit hours of a day; day off; reset a day; apply to a range; copy this week to the next 4 weeks; previous / next week, ±4 weeks, jump to a date; the horizon date is shown; entries outside hours are marked; no hard-coded colour in `SchedulingPlanner.tsx` (CSS variables only, CLAUDE.md Critical Rule 6: a search for hex and `rgb(` colour literals in the file finds none) |
| E16 | `GET …/week?start=<Monday>` for a resource with a default day, a `dayHours` day, a `dayOff` day with a booking, a held entry, and today − 8 inside the week; the same with the switch off; another tenant's resource id | 7 `DayDTO`s: `source`, `windows`, `removed`, `open`, `entries` (ref, customer name, service name, state) and `outsideHours` as `planDay`; the old day `kind: "past"` with its entries; same answer with the switch off; 404 |
| E17 | planner link, signed in, current tenant = the link's tenant | the week of `week` is shown; no reload |
| E18 | planner link, signed out | `/login?next=…` (encoded path and query); after sign-in by password, and after the new-password step, the planner opens with the same `tenant` and `week`; a sign-in without `next` goes to `/` as today |
| E19 | planner link, signed in, current tenant B, link tenant A in the user's tenant list | `selectTenant(A)` once; after the reload the week of tenant A is shown; no reload loop |
| E20 | planner link, signed in, link tenant C not in the user's tenant list | "You do not have access to this site."; the current tenant stays B; no scheduling request is sent |
| E21 | `isSafeReturnPath` unit rows: the seven examples of § 23.5, plus `/%2F%2Fevil.example` (encoded slashes stay a path inside the app), a string with a newline, 2001 characters | the first accepted; the six others rejected; `/%2F%2Fevil.example` accepted (it is a same-origin path; the router does not decode it into another origin); newline and 2001 rejected |
| E22 | `GET …/week` field `start`: absent; `2026-12-07`; `2026-12-09` (a Wednesday); malformed `2026-12-32`, `12/07/2026`, `x`; path `resourceId` unknown | 400 `invalid`; 7 days from Monday; 7 days from Wednesday; 400 ×3; 404 |
| E23 | edit request fields (absent / valid / malformed): `PUT …/days` without `from`, without `to`, without `value`; `value` of each `DaySetting` kind; `from` `2026-02-30`; `value: { kind: "closed" }`; `POST …/copy-week` without `sourceStart`, `targetStart` or `weeks`; `weeks` 1 and 52; `weeks` 0, 53, 2.5, `"3"`; an unknown extra key | 400 per missing field; 200 per kind; 400; 400; 400 per missing field; 200; 400 ×4; 400 (strict schema) |
| E24 | planner page query (absent / valid / malformed): no `tenant` and no `week`; `week=2026-12-07`; `week=2026-12-09`; `week=garbage`; `tenant=` empty | the current tenant's current week; that week; the week that contains it (Monday 2026-12-07); the current week; treated as absent (no switch) |
| E25 | the three `sched-1e` interval consumers — planner week, all-resource appointments, day-edit answer — each with the mocked client of C35 (3) | each answer shows the A25 (c), (d), (e) results: the confirmed copy, the new placement only, A and B once each; no 500 or 503; each consumer normalizes through `activeEntries` and sends no `Query` of its own on `RESDAY#` outside `scheduling-db.ts` (a unit test that counts such calls: zero) |

Staging: a practitioner configuration on a staging tenant; one week edited (a day off, a short day) and copied two
weeks ahead; one booking made and moved in the admin; the visitor page shows the edited hours and stops at the
horizon.

**`sched-1f`**: F1 run create with invalid meetings → each `MeetingError`; `trainerIds: []` → 400; capacity 46 →
400 with the 45 text; F2 roster lists exactly the active seats; F3 admin move across languages → ok, run language
unchanged; F4 move run → every active booking mailed once with a working link (sent by a later invocation than the
hold); F5 cancel run → confirmed unplaced (AP8), held cancelled, mails; placement into the cancelled run →
`runCancelled`; F6 capacity below taken → 200, `overCapacityBy`, visitor hold `runFull`; F7 manual entry without
run → unplaced; F8 group link only in the `confirmed` mail of a seat; F9 CSV contains the roster columns. Staging:
one course, two runs; a person moved and a run cancelled in the admin.

**`sched-1g`** (serving suite + staging)

| Row | Case | Expected |
|---|---|---|
| G1 | domain host `/_booking`, `/_booking/manage`, `/_booking/api/offer`; `/_booking/feed/<r>/<s>.ics` | served by `%5Fbook`, not rewritten to `%5Fdyn`; pages and API `private, no-store`; feed `private, max-age=300`; a second identical request is not answered from CloudFront (`x-cache` is not `Hit`) |
| G2 | preview host `/_site/<id>/_booking/manage` | served by `%5Fbook` for tenant `<id>`; no `amodx_preview_base` cookie |
| G3 | `/_booking?frame=1&lang=ro` | the page sees both parameters; no header; `no-store` |
| G4 | request with the session cookie | same answer as without (no twin, no cache) |
| G5 | wire request to `/_book/<other-tenant>/manage` | 404 |
| G6 | HTML of the manage page / the book page | no Analytics, Facebook pixel, Paddle, cookie banner or popup script; book page: reCAPTCHA only; `Referrer-Policy: no-referrer` on manage |
| G7 | GET of a link | the booking stays held; only POST confirm confirms; the fragment is gone from the address bar after load |
| G8 | tenant with its own key pair; tenant with one key only | page key = the tenant's and the backend verifies with the tenant secret; deployment pair on both sides |
| G9 | staging: reCAPTCHA token minted on a domain tenant and on a no-domain tenant (preview host) | both verify (proves the key's domain list) |
| G10 | reminders: one per start; a move between selection and mark → no reminder for the old time; a second job run sends nothing; the reminder's link works; a booking moved A → B → A after both reminders; a tenant with a domain and a saved `reminder` template override; a seat in a run created before the tenant changed `scheduling.timezone` | as stated; A → B → A sends a second reminder for A (the documented limit); the link is `https://<domain>/_booking/manage#t=…` and the text is the override; `{{when}}` shows the meeting in the run's own zone |
| G11 | feed: valid `text/calendar`, UTC times, a meeting of a run that started before the window, no customer field, old secret 404 after rotation; a run whose trainers change from R1 to R2; a run created in `Europe/Bucharest` after the tenant setting changes to another zone | as stated; after the change the run is in R2's feed and not in R1's; the run's meetings keep their original UTC instants |
| G12 | locale keys EN and RO complete (coverage rule of `locale-1`) | as stated |
| G13 | staging witness of § 9.2 (the six cases) through the booking proxy | one `k` chooses the tester's real address in every case, never a forged value; `k` recorded; the temporary log line removed; until it passes, no tenant's booking page is exposed to visitors |
| G14 | weekly mail population and delivery (§ 11.4), injected clock and a mocked SES client: a `Europe/Bucharest` tenant with one resource with weekly hours at Sunday 08:59 and 09:00 local, then a run at 09:15; a tenant with the switch off; a tenant with group runs only (no resource with weekly hours); a tenant with no `contactEmail`; a `weekAhead` override with `sendToAdmin: false`; an `America/Los_Angeles` tenant at the 03:00 UTC run of a Sunday (Saturday local) and at Sunday 09:00 local; SES refuses at 09:00, accepts at 09:15; a fault after SES accepts and before `sentAt`; SES refuses every run until Monday 00:00 local, then a run at Monday 00:15 | none; one mail and `sentAt`; none (`sentAt` present); none; none; none and the log line; none; none, then one mail on its own Sunday; one attempt each run, `sentAt` after 09:15, two attempts in total; a second mail at the next run (the documented duplicate); no send at 00:15 and no `sentAt` for that week (the documented loss) |
| G15 | weekly mail content: one resource with a default day, a `dayHours` day, a `dayOff` day with a booking outside hours, and a booking local 23:30-00:30 across two days; a resource with no weekly hours and no override in the week | `{{summary}}` lists every day of the first resource with its source, windows, the count of distinct active bookings (the cross-midnight booking counted on both days) and `1 outside hours` where it applies; the second resource is not listed; the body has no customer name, email, phone or booking ref; the link is `<ADMIN_URL>/scheduling/planner?tenant=<id>&week=<Monday>` |
| G16 | the reminder function (synth), with and without a root domain in the stack config | `ADMIN_URL` = `https://admin.<rootDomain>`; `ADMIN_URL` = `https://<admin distribution domain>` (the same value as the `AdminUrl` output) |
| G17 | the weekly mail with the mocked client of C35 (3) for one resource | each day's count includes each booking once, at the placement of its highest `rev` (the moved booking counted on its new day only); the mail is sent; no error |

**`sched-1i`**: tenant isolation (A's token, id and feed refused under B); the renderer role has no permission on
the table (deployed policy read back); switch off removes every visitor surface and the reminder job sends nothing for
the tenant, while the daily cleanup still removes its expired holds; last slot and last seat under 20 parallel requests on staging; expired hold freed; a token of one booking
refused for another; the frame from an unlisted origin shows nothing (`sched-frame-1`).

## 18. Risks and what is deliberately not built

| Item | Why not now | Trigger that changes the answer |
|---|---|---|
| Waitlist | not stated | a client asks |
| Recurring appointment series | not stated | a practitioner books weekly series |
| Per-meeting booking in a run | D5: the whole run | a course sold per day |
| Visitor chooses the practitioner | the named practitioner client is one person | a client with several practitioners chosen by name |
| Customer free-text notes | not stated; invites health data | a client names the field and its legal basis |
| Conflict check between a trainer's runs and appointments | not stated | one person works in both shapes at one tenant |
| External calendar read | SCHED-CALENDAR = A (ratified 2026-11-21) | the practitioner's private calendar is full |
| Public developer API, metering | `sched-frame-1.md` Non-scope | a paying client's developer needs it |
| Paid-course booking | § 17.2 | SCHED-PAYMENT-PATH decided and `cmrc-4` shipped |
| Runs above 45 people | § 4.5 | a named client with a larger group |
| Expired hold revived on confirm | simplest correct rule | many late confirms (raise `holdMinutes` first) |
| Retention period for confirmed and past bookings | none stated | a tenant or regulator states one |
| Platform-wide per-email counter | per-tenant isolation | an abuse report across tenants |
| Feed secret in CloudFront logs | calendar apps send no headers | access logs turned on |
| Mails in the person's language | one template per key per tenant | `lang-1a` ships |
| A day edit during a hold is not guarded (§ 7.7) | rare; the admin sees `outsideHours` in the answer and in the planner | a double booking reported from this path |
| Weeks materialized ahead (a Sunday fill of the next week, "fill only when empty") | SCHED-PLANNER = B: every week is open from the defaults | — (ruled) |
| Group runs and trainer meetings in the planner | the planner plans appointment hours; § 18 "conflict check between runs and appointments" stays out | one person works in both shapes at one tenant |
| Horizon on group runs | operator decision (§ 15): the admin sets each run's dates on purpose and a course is sold months ahead (§ 23.3) | a school asks to limit how early people enrol |
| Per-tenant send time or weekday of the weekly mail | fixed: local Sunday from 09:00 | a tenant asks for another time |
| A display read shows the highest `rev` the query returned, with no freshness bound; a later read can still be stale (a cancelled booking still shown; a moved one in its old place) | operator scope freeze after review-2: the displays (planner, edit answer's conflict list, weekly summary, all-resource read) decide nothing; every writer is guarded by the versions of § 7 | an admin acts on a stale display and the write is refused or does harm |
| Same date edited by two admins at the same instant | operator ruling (R06): no client version; the server re-applies an edit once after a lost condition, so the later write wins for that date (different dates both stay) | an admin reports a lost day edit |
| Duplicate weekly mail after an uncertain SES result | SCHED-WEEKMAIL-DELIVERY = B: a second copy of a reminder is harmless, a lost one is not | a tenant reports duplicates as a problem |
| Weekly mail lost when sending fails every run until Monday 00:00 local | the retries end with the week they announce | a tenant reports a missing weekly mail |
| A recurring rule for overrides ("every second Friday off") | ranges and copy-week cover the stated need | an admin enters the same pattern by hand every month |
| Reminder lost on a crash between mark and send | at-most-once chosen | reminders reported missing |
| reCAPTCHA scores in frames with third-party cookies blocked | measured in `sched-frame-1` | refusals above the tenant's tolerance |
| A no-domain tenant is served in preview mode, which renders drafts of content pages (`renderer/middleware.ts:262`) | the human ruled such a tenant ordinary; its visitors reach `/_booking` only | a no-domain tenant publishes content pages for visitors → it gets a domain |
| A tenant `domain` that is set but not pointed at AMODX gets links to that domain | the record cannot show DNS state | a tenant reports dead links → the settings screen shows the booking base |
| Held seats of a cancelled run keep counting against their email's open-hold cap until `x` | bounded by `holdMinutes` | a refusal reported from this path |

## 19. Abstractions introduced (one line each)

- `zoned-time.ts` — users: `availableSlots`, `slotDecision`, `validateMeetings`, reminders, feed; axis: none (a
  helper with five callers); rejected: a date library in `@amodx/shared` (a dependency in every workspace for about
  forty lines on `Intl`).
- Container write in `scheduling-db.ts` — § 7.1.
- `scheduling-db.ts` (support module) — users: every scheduling handler and the reminder job; axis: the persistence
  boundary of the base plan (lines 305-317); rejected: DynamoDB calls inline in handlers (the transactions of § 7
  repeated).
- `scheduling-email.ts` — users: the twelve mailing functions and the templates route; axis: a second template
  record with its own keys (seven since § 23); rejected: keys added to `getDefaultTemplates()` (the order mail page
  would list them).
- `api-scheduling.ts` nested stack — § 17.
- Second root layout `app/%5Fbook/[siteId]/` (SCHED-PAGE-LAYOUT = A) — users: the book page, the manage page, the
  proxy handlers, the feed; axis: pages that must carry no tenant script; rejected: the existing root layout (G5; it
  cannot see the page).

No interface, registry, adapter or plugin is introduced: every growth axis is a closed set of variants (shapes,
states, sources, containers), handled by sum types and exhaustive matches.

The week planner and SCHED-AUDIT-PII = C add **no** abstraction: `DayOverride`, `DaysEdit`, `PlannedDay`,
`HistoryEntry`, `Placement` and `Actor` are domain sum types (variants fixed, operations growing → exhaustive
`switch`); `dayWindows`, `planDay`, `editDays`, `lastBookableDate`, `weekMailDue`, `appendHistory` are kernel
functions in `scheduling.ts`; `DAYS#` takes the place of `CLOSED#` in `scheduling-db.ts`; the weekly mail is code
inside the existing reminder function. Rejected for the planner: a materialized `WEEK#` item per resource and week
(ruled out by SCHED-PLANNER = B) and a closed-time list beside the overrides (two mechanisms for one effect).

## 20. Exit criterion

**This specification slice** is accepted when the reviewer finds §§ 4-17 checkable against the code and every open
decision of § 15 raised. It edits no other file.

**Later work, not part of this slice's acceptance**: the human answers the decisions; then a separate ratification
change applies § 16 by dated sections, registers `sched-1a`…`1i` in `docs/ROADMAP.md` in place of `appt-1`…`7`, and
registers the prefix `sched-` in `docs/documentation.md`.

**SCHED-1R amendment (2026-11-21)** is accepted when the reviewer finds: the nine ratified outcomes recorded (§ 15,
status line); SCHED-AUDIT-PII = C applied in every section § 22 names; § 16.1-16.3 applied to the base plan (dated
amendment section, ratified text kept) and to PD-002; the week planner (§ 23 with § 4.1, § 4.2, § 4.5, § 5.5, § 6.2,
§ 6.3, § 10.3, § 11.4, § 17) checkable against the code it cites; every new field with absent / valid / malformed
rows. It edits only `docs/slices/sched-1.md`, the PD-002 text of § 16.3 in `docs/platform-decisions.md`, and the
amendment section of `docs/plan-appointments-private-table-extension.md`. Still open after it: § 16.4 (ROADMAP,
`documentation.md`, `plan-courses-group-sessions.md`, `CURRENT_SLICE.md`).

## 21. Closure of review findings (review-0, review-1, review-2; 2026-11-21)

Status column: **accepted** = the latest review that assessed it found it addressed (review number given);
**re-closed in cycle 4 / 5** = the previous review found it open, this revision claims it closed, the next review
decides.

| Finding | Class of defect | Status | Closed by | Rule applied |
|---|---|---|---|---|
| SCHED-R01 | a later actor needs a secret the first actor did not store; then a list of secrets changed outside the booking's concurrency protocol | accepted (review-2) | § 8.4, § 7.1 booking rule, § 4.4 `tokenHashes`, § 7.6; rows C14, C15, C21-C24, D7, E7, F4, G10 | every change of a booking's tokens, state or placement is one `rev`-conditioned write of the booking item |
| SCHED-R02 | a new surface placed under an existing consumer without checking what that consumer does | accepted (review-2) | § 10.1, § 5.3 `bookingBase`, § 9.1, SCHED-PAGE-LAYOUT; rows G1-G9, A13 | the booking tree is reached only by a middleware rewrite and has its own root layout |
| SCHED-R03 | an idempotency key that covers the happy path only | accepted (review-2) | § 7.2; rows C4-C7 | the fingerprint covers every submitted field; every stored state has one replay answer |
| SCHED-R04 | write rules stated for one path only; an absence test used as an existence test; a guard stated as a rule but missing from one writer | re-closed in cycle 4 | § 4.2 resource guard; § 7.3, § 7.4 tables; § 7.6 run move (≤ 13 items) and the one rule for run writes; § 13; rows A3, C11 (a)-(g), C25, C26 | every write after which a resource has future use carries the resource guard; a fence is owned by one attempt |
| SCHED-R05 | a storage limit presented as product-neutral | accepted (review-2; operator ruling) | § 4.5; SCHED-SEAT-BOUND; `trainerIds` non-empty | every bound is a domain rule with its source or a technical limit with a trigger |
| SCHED-R06 | an index keyed by one end of an interval; copies on an index some writers do not maintain; projections not checked against their consumers | re-closed in cycle 4 | `RUNSPAN#` keeps only `firstStartIso`; AP6 and AP12 projections; the consumer table of § 6.3; § 11.3 guarantee; rows C17, C18, C26, G10, G11 | every read is listed against every consumer, with the field each consumer uses |
| SCHED-R07 | removal mechanics grown beyond a stated need; customer data reachable only through items that could expire alone | re-closed in cycle 5 (operator scope freeze; review-3 points: `HELD#` key after cancel, cleanup on switched-off tenants, TTL eligibility wording) | § 6.1 TTL rule and item set; § 6.2 TTL column with the reason per item; `heldUntil` (§ 4.4) as the stored source of the `HELD#` key; § 14.1 daily cleanup over every tenant; § 14.2 one idempotent erasure pass with read-back; rows C13, C16 (incl. cancel-then-erase), C21, C23, C27-C30 | no TTL on customer data or on its only path; every key a removal deletes is read from the stored item, never rebuilt from settings; TTL times are eligibility times, not deadlines; an item set is created together and removed together; erasure is idempotent and reports what remains |
| SCHED-R08 | an API inventory in place of a contract | accepted (review-2) | § 10.2, § 10.3 | one row per route with request, response, role and refusals |
| SCHED-R09 | a dependent path designed before its decision and module exist | accepted (review-2; revised scope) | § 17.2 | design stops at the boundary of an undecided dependency |
| SCHED-R10 | shared prerequisites allocated to one of two independent consumers | accepted (review-2) | § 17.1 | what two lines need lives in their common predecessor |
| SCHED-R11 | a transport claim from a partial list; an index formula without a worked example; a witness without an observation point | parsing accepted (review-2); witness stage closed by operator ruling SCHED-ADDR-WITNESS-STAGE = B | G2; § 9.2 (worked table, accepted forms, `client-address.ts`, exposure gate); § 15 operator rulings; rows D11, G13 | a position rule ships with a worked table; a witness runs where the observed code first exists and gates exposure |
| SCHED-R12 | wording and test oracles that claim more than, or other than, the mechanism | accepted (review-2) | § 16.3; § 12; § 20; § 10.1; rows D1, D2, G1; SCHED-AUDIT-PII | each guarantee and each oracle names exactly what is exposed or answered |

Process note: in cycle 2 the progress log received one combined entry for R01-R12 (the document was rewritten in
one pass), not one entry per finding as the packet asked. Cycles 3 and 4 log one entry per finding or ruling.

## 22. Review record and decision review (operator, 2026-11-21)

- Document review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), six build cycles (0-5). Review-4
  verdict: approved. All findings SCHED-R01…R12 are closed (§ 21). The verdict accepts the document only; it
  does not authorize a build. The two roles are separate invocations, not assurance by independent providers.
- Decision review (reviewer challenges each recommendation against the source, builder answers once): nine
  decisions, nine converged. Eight recommendations stand as written in § 15: SCHED-TABLE = A,
  SCHED-PAYMENT-PATH = A, SCHED-CALENDAR = A, SCHED-PD-AMENDMENT = accept, SCHED-SLOT-GUARD = B,
  SCHED-ADDR-LIMIT = A, SCHED-SEAT-BOUND = A, SCHED-PAGE-LAYOUT = A.
- **SCHED-AUDIT-PII: the recommendation in § 15 (A) is withdrawn.** Cause: A writes the booking reference, the
  service or course name and the local time into audit entries in the main table, which the renderer can read;
  the base plan lists appointment times as private data (`docs/plan-appointments-private-table-extension.md:37-39`).
  Corrected recommendation, to ratify: **C in its smallest form** —
  1. `BOOKING#` gets a `history` list (time, action, actor, and for a move the old and new placement), written in
     the same conditional write that changes the booking; at most 50 entries, oldest dropped first (technical
     limit; trigger: a booking with more than 50 real changes).
  2. No main-table audit event for hold, confirm, cancel or move, by a visitor or by an admin.
  3. Main-table audit stays for actions with no customer data (services, resources, courses, runs, templates,
     settings); erasure publishes `SCHEDULING_CUSTOMER_ERASED` with the two counts only.
  4. No `ip` field on any scheduling audit event.
  Consequence the human must accept: booking actions are not shown on the tenant-wide audit page; the admin sees
  them on the booking screen. The base plan's rule "every lifecycle event is audited" becomes "a history entry
  on every lifecycle event, in the private table".
- Applied 2026-11-21 by SCHED-1R (one pass after ratification): § 4.4 (`history`, `HistoryEntry`, `Actor`), § 4.5
  (history bound), § 6.5 (the four points), § 8.5, § 10.3 (audit sentence, `BookingAdminDTO.history`), § 15,
  § 16.1, § 16.2 and row D10 (oracle: no booking event in the main table; `history` on `BOOKING#`; no `ip`).
- State: **ratified** by the human 2026-11-21 (§ 15). The SCHED-1R amendment (ratification applied; week planner,
  § 23) waits for review. No build slice starts before that review.

## 23. Week planner (SCHED-1R, 2026-11-21; SCHED-PLANNER = B)

Source: § 1 item 5, D16-D18. Mechanics live in their home sections (types § 4.2, bounds § 4.5, kernel § 5.5,
storage § 6.2-6.3, routes § 10.3, mail § 11.4, slices § 17); this section records the design and why it is the
smallest one that meets the ruling. Not yet reviewed.

### 23.1 What is built

| Need (the human's words) | Mechanism |
|---|---|
| "with defaults" | the existing `AvailabilityRule[]` per resource (`AVAILABILITY#<r>`), unchanged |
| "tweak individual days, disable whole days" | one `DayOverride` per resource and local date: `dayHours(windows)` or `dayOff` (§ 4.2) |
| "pre-fill ahead of time by weeks and months" | ruling B: nothing to pre-fill — every week is open from the defaults; the admin edits a range of dates or copies one week onto the next 1-52 weeks (§ 5.5 `editDays`) |
| "clear open slots and unavailable times - per week planner" | one read per resource and week (`WeekPlanDTO`): effective windows, what an edit removed, open time, bookings and holds, bookings outside hours (§ 5.5 `planDay`, § 10.3) |
| "send out an email to the admin reminding them they can manually tweak those" | the `weekAhead` mail on the tenant's local Sunday (§ 11.4) |
| "a tenant setting limits how far ahead visitors can book" (addendum) | `scheduling.bookingHorizonWeeks`, default 8, on slot bookings (seats: operator decision, § 15) (§ 4.1, § 5.5, § 23.3) |

Not built (§ 18): materialized weeks, the "fill only if empty" Sunday job (both removed by ruling B), runs in the
planner, recurring override rules.

### 23.2 One mechanism: overrides replace `ClosedTime`

The reviewed text had `ClosedTime` (an instant interval with a note, `CLOSED#<r>`). With per-date overrides the two
would do the same thing — make part of a resource's time unbookable — by two paths: two items to read on every
visitor request, two admin screens, two conflict rules, and a precedence question between them. Every closed time
is expressible as overrides, because availability exists only inside one local day: a block 12:00-13:00 inside
09:00-17:00 is `dayHours [09:00-12:00, 13:00-17:00]`; a closed span over several days is `dayOff` on the inner days
and `dayHours` on the first and last. Overrides can also do what a closed time could not: open hours on a day with
no default (a Saturday clinic).

Trade-off, accepted and shown on the screen: an override **replaces** the defaults of its date, so a later change of
the defaults does not reach a date that has an override (§ 13). The planner marks such dates (`source`), and "reset
to defaults" removes the override. A merge rule (defaults minus blocks plus extra hours) would follow default
changes, but it needs two lists per date and a rule for their overlap — more state and more rules for a case the
admin sees and fixes in one click.

The note of a closed time moves to the override (`note`, ≤ 200 characters, admin only). `SCHED-CALENDAR = A`'s risk
"a private busy time is typed in as a closed time" now reads "… as a day edit" (§ 15).

### 23.3 Booking horizon

- `lastBookableDate = local today + 7 × bookingHorizonWeeks` days; a visitor slot whose local start date is after it
  is refused (`beyondHorizon`, 409) and not offered (`SlotsDTO.lastBookableDate`; days after it are empty). It
  applies to visitor holds and visitor moves (both use `slotDecision`).
- Default 8 weeks (operator decision; the human gave no number); range 1-52 (§ 4.5).
- **Not limited**: admin writes (manual booking, admin move — the practitioner books its own entries anywhere, as
  § 5.2 already rules for windows; the packet's rule), and **seats in group runs** (operator decision after
  review-0, § 15; the human may override): a run is not "open from the defaults"; the admin sets each run's dates on
  purpose, and a course is sold months ahead. Recorded in § 18 with its trigger.
- Why "weeks" and not a date: ruling B keeps every week open, so the horizon is the only thing that stops a visitor
  from booking a far week the admin has not looked at yet; a rolling count of weeks needs no upkeep.

### 23.4 Edits with bookings present

Rule (the same as the reviewed rule for closed times, § 7.7): **the edit is allowed, the bookings stand, the answer
lists them**. A day turned off or shortened keeps its confirmed and held bookings; `DayEditResult.outsideHours`
lists their refs; the planner shows them on that day, marked, until the admin moves or cancels each one (with the
existing routes, which mail the customer). Nobody is mailed by the edit itself.

Alternatives considered: refusing the edit while bookings exist (the admin then cannot mark a sick day until every
booking is handled, the opposite of what the planner is for); cancelling the bookings automatically (an
irreversible customer-facing action hidden in a configuration change). The listed rule keeps the admin in control
and loses nothing.

### 23.5 API and screen

- One read per resource and week (`GET …/resources/{r}/week?start`), three writes: a day or a range (`PUT …/days`),
  a copy of a week (`POST …/days/copy-week`), and the existing defaults route. All E+T, all in `sched-1e`.
- The reviewed all-resource read `GET /scheduling/admin/appointments?from&to` (≤ 31 days) **stays** (operator
  ruling after review-0, § 15): it gives the day view across resources (row E6); the planner gives one resource's
  week with its hours. Both normalize entries with the same pure function (`activeEntries`, § 5.5).
- Admin screen `SchedulingPlanner.tsx` (English UI, CSS variables only): resource selector; a Monday-Sunday grid of
  the week; per day the open time, the bookings (held ones marked with their expiry), the unavailable time (outside
  the windows) with the part an edit removed shown apart from the default closed hours, and bookings outside hours
  marked; actions per day: edit hours, day off, reset to defaults; actions on a selection: apply to a range of dates;
  "copy this week to the next N weeks"; navigation: previous / next week, ±4 weeks, jump to a date; a line at the
  horizon date ("visitors can book until …"). A booking opens the booking detail view of `sched-1e` (`SchedulingAppointments*.tsx`, from
  `GET /scheduling/admin/bookings/{id}`), which lists its `history` (SCHED-AUDIT-PII = C).
- The planner works with the switch off (admin routes do, § 10.3), so a tenant prepares its weeks before it opens.
- **Opening the mail's link** (`/scheduling/planner?tenant=<id>&week=<Monday>`, § 11.4; operator ruling R03):
  - **Signed out.** Today the guard sends the user to `/login` and both successful sign-in paths go to `/`
    (`admin/src/App.tsx:69-70`; `admin/src/pages/Login.tsx:42`, `:63`, OBSERVED), so the destination is lost.
    Change (smallest): the guard redirects to `/login?next=<encodeURIComponent(pathname + search)>`; after a
    successful sign-in (both paths: password, and new password) the login goes to `next` when it passes
    `isSafeReturnPath`, else to `/` as today. Without `next` the behaviour is unchanged.
  - **`isSafeReturnPath(p)`** — one rule for the whole class "the string must not be able to name another origin":
    `p` is a path only; it starts with exactly one `/` (the second character is neither `/` nor `\`); it contains
    no `//`, no `\` anywhere (browsers read `\` as `/`, so `/\evil.example` would be `//evil.example`), no
    scheme (a path that starts with `/` has none by construction; checked by the first rule), and no control or
    whitespace character; length ≤ 2000. Navigation uses the router's in-app `navigate(p)`, never
    `window.location`. Examples: `/scheduling/planner?tenant=a&week=2026-12-07` → accepted;
    `//evil.example`, `/\evil.example`, `https://evil.example`, `javascript:alert(1)`, `/a//b`, the empty string →
    rejected, go to `/`.
  - **Signed in, other current tenant.** The planner page waits for the tenant list, then: `tenant` is in the
    user's `tenants` list (`TenantContext`, which lists what `GET /tenants` allows) and differs from the current
    tenant → `selectTenant(tenant)`, which stores it and reloads the same path once
    (`admin/src/context/TenantContext.tsx:62-84`, OBSERVED); after the reload the two are equal and the week is
    shown. `tenant` not in the list → a plain state "You do not have access to this site." with no scheduling
    request and no tenant switch. The backend still checks the role per tenant, so the parameter grants nothing.
  - **Signed in, same tenant** → the week of `week` (a malformed `week` → the current week).

### 23.6 Storage choice for overrides

| | **O1 one item per resource `DAYS#<r>`** (chosen) | O2 one item per resource and date `DAY#<r>#<date>` | O3 one item per resource and month |
|---|---|---|---|
| Visitor read (slots, hold) | one Get per eligible resource, batched with `AVAILABILITY#` | one Query per eligible resource over the range | one Query per eligible resource over ≤ 3 months |
| Range or copy write | one versioned Put: atomic for any size | one item per date: > 100 dates need several transactions, so a failure leaves part of the range applied | ≤ 13 items in one transaction |
| Pruning | on every write, inside the same Put | per date: TTL or a sweep | per month item: delete or keep |
| Resource removal (§ 13) | delete one key (as `CLOSED#` before) | Query and delete every date | Query and delete every month |
| Bound | 366 dates per item (§ 4.5); worst case ≈ 186 KB, typical < 5 KB | none | none |

O1 is the reviewed `CLOSED#` pattern with new content: one atomic write per edit, one key to remove, one read per
resource. Its cost is item size at the extreme of every bound; the trigger to move to O3 is the § 4.5 bound.

### 23.7 Reading rule for stored overrides

A `DAYS#` item that fails its Zod schema is an error (500 `storedDataInvalid`), never "no override": read as absent,
it would reopen a day the admin closed. The same rule holds for a stored `bookingHorizonWeeks` outside 1-52 (§ 10.2,
rows C33, D14).

## 24. Review record of the amendment SCHED-1R (operator, 2026-11-21)

- Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), four build cycles. Separate invocations, not
  assurance by independent providers. Findings SCHED1R-R01…R07: R01-R03 and R05-R07 closed by review-1 and
  review-2; the R04 mechanism (highest observed `rev`, no reconciliation) accepted by review-3.
- Review-3 did not give "approved": its one remaining point was the freshness wording that the operator's own
  packet prescribed ("one step old; the next read corrects it"), which claims more than the mechanism gives.
  Operator closeout: the wording is corrected in § 5.5, § 17 and § 18 to the reviewer's option A (highest `rev`
  the query returned; no freshness bound; a later read can still be stale). No mechanism changed after
  review-3. Decision SCHED-DISPLAY-FRESHNESS = A (operator; the human may override).
- Operator decisions recorded in § 15, each open to the human's override: SCHED-WEEKMAIL-DELIVERY = B (retry
  until the target Monday, duplicates possible); the Sunday mail only for tenants with a resource that has
  weekly hours; the booking horizon (default 8 weeks) limits slots only, not seats in a run.
- Not run: builds, tests, synth (documents only).

## 25. Build records

### `sched-1a` — shipped to `main` 2026-11-21 (operator closeout)

- Scope as § 17.1: `packages/shared/src/scheduling.ts`, `zoned-time.ts`, exports and three optional `TenantConfig`
  fields in `index.ts`, tests for rows A1…A26. Pure code; no handler, no table, no screen uses it yet, so there
  is nothing to deploy or to see until `sched-1b`…`1e`. Maturity: PROTOTYPE.
- Review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), three cycles, approved (separate
  invocations, not independent providers). Operator gates on the accepted tree, all exit 0: build, typecheck,
  shared, plugins, renderer unit, serving suite, admin unit, backend unit, MCP, `git diff --check`.
- Differences from the specification, as built:
  - `embedOrigins` is not in the settings schema (it belongs to `sched-frame-1`);
  - `schedulingEnabled` is optional with no default (absent = off), so a tenant saved earlier parses unchanged;
  - a resource with a `retiring` fence offers no slots in `availableSlots` (the specification stated the refusal
    in `slotDecision` only);
  - three broken caller preconditions throw (programming errors), all domain refusals are result values;
  - row A14: no `switch` over `HistoryEntry` exists yet, so that part shows no compile error until `sched-1e`
    renders history.
- Deferred: `packages/shared/ARCHITECTURE.md` gets its scheduling entry with `sched-1c`, the first consumer.

### `sched-1b` — shipped to `main` and to staging 2026-11-21 (operator closeout)

- Scope: one table `AmodxSchedulingTable<suffix>` in `infra/lib/database.ts` (on-demand, point-in-time recovery,
  TTL attribute `ttl`, Retain on delete and on replace, `PK`/`SK`, no index, no stream) and assertions
  `(sched1b-1)`…`(sched1b-4)` in `infra/test/amodx-stack.test.ts`. `infra/lib/amodx-stack.ts` needed no change.
  Inert: no function has the table's name or a grant.
- Review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), three cycles, approved (separate
  invocations). Operator gates, all exit 0: build, typecheck, infra suite, backend unit, `git diff --check`.
- Staging (operator, OBSERVED): diff read before deploy — one table added, function code bundles changed
  (they carry `sched-1a`), no IAM change; deploy succeeded; the table is ACTIVE, 0 items, PAY_PER_REQUEST,
  recovery ENABLED, TTL `ttl` ENABLED; `https://staging.amodx.net/` and `/sitemap.xml` answer 200.
- Production: arrives with the human's next `./deploy.sh prod` as one added table. Rollback: a revert after a
  deploy leaves the table in the account (Retain); a later re-apply must import or rename it (INFERRED).

### `sched-1c` — shipped to `main` 2026-11-22 (operator closeout)

- Scope: `backend/src/lib/scheduling-db.ts` (the only code that names the scheduling table: keys and item
  codecs, the reads of § 6.3, every transaction of §§ 7, 8.4, 13, 14, `DAYS#`, `WEEKMAIL#`), its unit tests (79,
  fake client that records command inputs) and an integration file (36 tests). No handler uses it yet; nothing
  is deployed by this slice. Maturity: PROTOTYPE.
- Review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), two cycles, approved (separate
  invocations). Review-0 findings closed: booking updates write only changed attributes (a mail mark survives a
  concurrent token mint); a run move removes counted-expired seats; consistent reads on two lookups; an admin
  move uses the current service duration.
- Operator gates, all exit 0: build, typecheck, shared, backend unit, infra, MCP, `git diff --check`.
- Integration (operator-run, OBSERVED): `cd backend && SCHEDULING_TABLE_NAME=AmodxSchedulingTable-staging npx
  vitest run test/scheduling-db.integration.test.ts` → 36 passed; the table holds 0 items after the run. The file
  refuses any table name that does not end with `-staging` and is not part of `npm run test:unit`.
- Differences from the specification:
  - § 17.3 names `cd backend && npm test` for the integration rows; that command runs the whole live-staging
    suite and is not used. The rows run through the dedicated command above.
  - Invalid stored data throws `StoredDataInvalidError` (an unrecoverable state), it is not a refusal value.
  - A write removes the expired entries it reads and counts; `updateRun` reads none and removes none.
  - The route parts of rows C5-C7 (HTTP codes, mail, reCAPTCHA) belong to `sched-1d`; the tenant selection of
    C29 belongs to the slice that owns the daily job.

### `sched-1d1` — shipped to `main` and to staging 2026-11-22 (operator closeout)

- Operator split of `sched-1d` along admin / visitor (content unchanged). This half: nested stack
  `infra/lib/api-scheduling.ts` with ten admin functions and routes (booking read and cancel, customer lookup and
  erasure, resources list/create/rename/delete, feed secret, mail templates); `backend/src/lib/scheduling-email.ts`
  (seven keys); audit per § 6.5; `backend/src/tenant/settings.ts` (scheduling settings validated; no `ip` on a
  save with a scheduling key); `packages/shared/src/client-address.ts` (pure); admin page `Scheduling.tsx`
  (settings, resources, mail templates); MCP route list. `sched-1d2` = every visitor route, reCAPTCHA, limits.
- Review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), three cycles, approved (separate
  invocations). Operator gates, all exit 0: build, typecheck, shared, plugins, renderer unit, serving suite,
  admin unit, backend unit, infra, MCP, `git diff --check`.
- Operator rulings (the human may override):
  - **S1D1-R02:** the bound of 200 resources (§ 4.5) is not strict: sequential creates are refused above 200;
    two simultaneous creates at 199 can both succeed. No reader breaks above 200.
  - **S1D1-R03 (amends § 10.3):** in `BookingAdminDTO`, `courseName` and `firstStart` are `string | null`;
    `null` only when the course or run item no longer exists.
- Known limit: an admin cancel reads names for the mail after the cancellation commits; a failure of that read
  answers 500 with the booking already cancelled.
- `tools/mcp-server/routes.json` marks the ten routes as local additions; refresh the snapshot after the
  production deploy.
- Staging (operator, OBSERVED): diff read first — additions only (one nested stack; table grants per function,
  read-only functions without write actions; `ses:SendEmail` on the cancel function only, on the sender
  identity; `events:PutEvents` on five functions); deployed; script of 19 checks under tenant `cm1-content`
  all pass (create/rename/delete a resource, feed secret, templates, cross-tenant 404, no `ip` in the audit
  entry, table count back to 0).
- Production: arrives with the human's next `./deploy.sh prod` (one new nested stack; admin sidebar gains
  "Scheduling", which shows "not enabled" for tenants without the switch).

### `sched-1d2` — shipped to `main` and to staging 2026-11-22 (operator closeout)

- Scope: eight visitor functions and routes in the scheduling nested stack (offer, slots, runs, hold, view,
  confirm, cancel, move); reCAPTCHA on the hold through the commerce mechanism; the limits of § 9; the mails of
  the visitor actions; shared route helpers moved to `backend/src/scheduling/common.ts`. `sched-1d` is complete
  with this half; the calendar feed stays in `sched-1g`.
- Review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), three cycles, approved (separate
  invocations). Operator gates, all exit 0 (same eleven as `1d1`). Integration file re-run on the staging table
  after the store change: 36 passed.
- Operator rulings (the human may override):
  - **S1D2-AMODX-STACK-LINE = A:** `infra/lib/amodx-stack.ts` passes the existing reCAPTCHA secret to the
    scheduling stack. The hold FAILS CLOSED when no reCAPTCHA configuration resolves (503
    `verificationUnavailable`); it never skips the check.
  - **S1D2-CONFIRM-OUTCOME = A:** `confirmBooking` in `scheduling-db.ts` returns `applied | alreadyConfirmed`;
    only `applied` sends the confirmation mail.
  - **S1D2-EXPIRED-VIEW = A:** the view of an expired hold answers 410 `expired` (§ 8.4). Consequence, recorded:
    `BookingViewDTO.state: "expired"` (§ 10.2) has no producer; remove it from the type in `sched-1g`.
  - A malformed token answers 404 `linkNotValid` on the four token routes; a switched-off tenant answers 403
    `notAvailable` before stored settings are validated.
- Limits recorded: `whenText` lives in the admin cancel handler (move to `scheduling-email.ts` later); after a
  move, the answer can show the target run's language as read before the move.
- Staging (operator, OBSERVED): diff read first — additions only (eight functions; `ses:SendEmail` on hold,
  confirm, cancel, move; one reference to the reCAPTCHA parameter); deployed; 25 checks under tenant
  `cm1-content` pass. Staging cannot pass reCAPTCHA, so: the hold route is shown to refuse a junk token (403)
  and a missing token (400) and to write nothing; a hold made through `scheduling-db.ts` is then viewed,
  confirmed, confirmed again, moved and cancelled through the deployed routes; slots follow each step; no
  answer carries the booking id, the resource or the full email; the main-table audit holds nothing about the
  booking; the table partition is back to 0 items and the tenant's switch is off again.
  NOT RUN on a deployed stage: an accepted hold through the route with its mail (first possible with the
  booking page of `sched-1g` in a real browser).

### `sched-1e1` — shipped to `main` and to staging 2026-11-22 (operator closeout)

- Operator split of `sched-1e` along backend / screens (content unchanged). This half: twelve admin functions
  and routes in the scheduling nested stack — services (list, create, update, delete), default availability
  (get, put), the week read, day edits, copy-week, the all-resource appointments read, manual appointment, move
  slot. `sched-1e2` = the admin pages, the planner screen, the login return path (rows E15, E17-E21, E24).
- Review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), three cycles, approved (separate
  invocations). Review-0 defects corrected: stored settings validated before every mutation; a consistent read
  for the service bound; a service update cannot recreate a deleted service; the configuration audit is written
  before display reads; a move answer names the resource of the booking it returns.
- Operator ruling S1E1-STORE-ALLOCATION: `scheduling-db.ts` gained `listServices(..., consistent)` and
  `replaceService` (`attribute_exists`). The bound of 200 services follows S1D1-R02 (not strict under two
  simultaneous creates).
- Operator gates, all exit 0 (the eleven of `1d1`). Integration on the staging table: 37 passed.
- Staging (operator, OBSERVED): diff read first — additions only (twelve functions; table write on the eight
  writers; `ses:SendEmail` on manual appointment and move slot; `events:PutEvents` on the six configuration
  writers); deployed; 38 checks under tenant `cm1-content` pass: default hours Mon-Fri, a day off, a short day,
  copy-week onto two weeks, and the VISITOR slots route following them (8 / 0 / 3 starts); a manual appointment,
  one on the day off, a refused double booking; the week read and the all-resource read; a move and a refused
  move with a stale `rev`; a deleted service whose booking keeps the service name; main-table audit with the
  configuration events and nothing about a booking. The partition is back to 0 items; the switch is off.

### `sched-1e2` — shipped to `main` and to staging 2026-11-22 (operator closeout)

- Scope: admin pages `SchedulingAppointments.tsx` (services, weekly hours), `SchedulingPlanner.tsx` (the week
  planner of § 23.5), `SchedulingAppointmentsBooking.tsx` (booking detail with history and move), three routes
  and the guard's return path in `App.tsx`, the safe `next` in `Login.tsx`, links from `Scheduling.tsx`.
  `sched-1e` is complete with this half. Admin app only; no backend or infra change.
- Review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), two cycles, approved (separate
  invocations). Review-0 defects corrected: an answer for an earlier selection can no longer replace the
  current one (`useSelectionData`, used by the three pages); the manual-appointment dialog offers every
  service; bookings across a clock change are placed by elapsed minutes; short bookings keep their details and
  actions outside the height-bound block; a compile-time parity check between the page's unions and the
  shared ones.
- Operator gates, all exit 0: build, typecheck, admin unit, shared, `git diff --check`.
- Staging (operator, OBSERVED, headless browser on the staging admin, tenant `cm1-content`; 10 checks pass):
  the planner link opened signed out goes to `/login?next=…` and, after sign-in, to the planner on the week of
  the link (E18); the grid shows open time, bookings (by reference), a day off and a short day as hatched
  "removed" time, closed weekend days, and a booking on the day off marked "Outside hours" (E15); the
  appointments page lists the service and the weekly hours; a link for a tenant outside the user's list shows
  "You do not have access to this site." (E20); `next=//evil.example/x` stays on the admin origin; no uncaught
  page error. Screenshots kept by the operator. Everything written was removed; the switch is off.
- Observations, not corrected here: the first planner load after a deploy took more than 4 s (function cold
  start); the admin app requests `//scheduling/admin/…` (two slashes after the API host; answered 200).

### `sched-1f1` — shipped to `main` and to staging 2026-11-22 (operator closeout)

- Operator split of `sched-1f` along backend / screens (content unchanged). This half: thirteen admin functions
  and routes — courses (list, create, update, delete), runs (list, create, update, move, cancel), roster,
  unplaced list, manual entry, move a person. CSV export is admin-page work (§ 10.3) and comes with `sched-1f2`.
- Review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), three cycles, approved (separate
  invocations). Operator gates, all exit 0 (the eleven of `1d1`). Integration on the staging table: 38 passed.
- Operator rulings (the human may override):
  - **S1F1-STORE-ALLOCATION = A:** `listCourses`/`listRuns` take `consistent`; `replaceCourse` with
    `attribute_exists`.
  - **S1F1-CANCEL-OUTCOME = A:** `cancelRun` returns the committed run snapshot; the handler order is
    audit → store-owned token cleanup → mails; a cleanup failure is reported (`tokenCleanupFailed`), it does
    not hide the cancellation.
  - **S1F1-COURSE-DELETE-GUARD = A (amends § 6.2, § 7):** `COURSE#` carries a version. Run create, an unplaced
    manual entry, a person moved out of a run and a run cancel that unplaces people increment it in their own
    transaction; `deleteCourse` is conditioned on the version it read → 409 when a dependent arrived. Largest
    transaction: run cancel, 93 items.
  - **S1F1-LANGUAGE-CONSIST (amends § 4.3; the reviewer recommended a strict guarantee):** a run's language is
    one of its course's languages at the time it is set. `409 languageInUse` on a course update is a sequential
    guard (cancelled runs count). A course update at the same moment as a language-setting write can leave a
    run whose language the course no longer lists; that is valid stored data and every reader accepts it.
  - A notification is built from the booking as saved; when the booking no longer has the placement the notice
    is about, it is not sent and the answer counts it (`notSentPlacementChanged`).
- Staging (operator, OBSERVED): diff read first — additions only (thirteen routes; table write on nine
  functions; `ses:SendEmail` on run move, run cancel, manual entry, move a person; `events:PutEvents` on the
  seven course and run writers); deployed; 32 checks under tenant `cm1-content` pass: a course of capacity 3,
  groups with meetings sent out of order (stored sorted), refusals (capacity 46, a trainer twice, an inverted
  meeting, overlapping meetings), three manual entries and the fourth refused as full, an unplaced entry, the
  roster, the visitor runs answer without a person or a trainer, a person moved and the freed seat taken, a
  stale `rev` refused, a language in use and a course with groups protected (409), a run moved (3 mailed) and
  cancelled (3 unplaced), history on a booking, main-table audit with course and run events and no person,
  email or booking id. The partition is back to 0 items; the switch is off.
