# SCHED-1 — scheduling with two booking shapes: a slot with a practitioner, a seat in a group (SPECIFICATION slice)

Status: **PLANNED (specification, reviewed and approved as a document 2026-11-21, not ratified; § 22) — DECISIONS REQUIRED before any build**
(§ 15). Track: D (Scheduling), prefix `sched-`. Written 2026-11-20 as `course-1` (seats only); rewritten 2026-11-21
after the human's directions of that day (§ 1); expanded the same day into a buildable specification (operator
packet 2026-11-21); revised after review-0 (findings SCHED-R01…R12, closure table § 21). Source plan:
`docs/plan-courses-group-sessions.md`; base plan `docs/plan-appointments-private-table-extension.md` (ratified;
this slice proposes amendments, § 16). This slice writes the specification; it changes no code.

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
| G3 | Audit entries are written to the main table, which the renderer reads | `backend/src/audit/worker.ts:22-41`; `infra/lib/renderer-hosting.ts:272`; precedent with a visitor's email: `backend/src/contact/send.ts:113-120` (OBSERVED) | decision SCHED-AUDIT-PII |
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
DynamoDB `ttl` = epoch **seconds** (`Math.floor(ms / 1000)`), used only on the four item kinds § 6.2 marks. `LocalDate` = `"YYYY-MM-DD"`, `LocalTime` =
`"HH:MM"`, `TimeZone` = an IANA name accepted by `Intl.DateTimeFormat(undefined, { timeZone })`.

### 4.1 Tenant settings (main table, `TenantConfig`; not customer data)

| Field | Type | Default | Use | Source |
|---|---|---|---|---|
| `schedulingEnabled` | boolean | `false` | visitor routes, reminder job and feed answer only when `true` | base plan lines 203-219 (renamed from `appointmentsEnabled`: both shapes; name as `sched-frame-1.md` item 7) |
| `scheduling.timezone` | TimeZone, optional | none | wall time of availability rules and new runs; enabling without it → 400 | D3. No default: a default zone would shift every time of a tenant elsewhere |
| `scheduling.holdMinutes` | integer | 30 | life of a hold | D12; draft § 4 |
| `scheduling.changeCutoffHours` | integer | 24 | cancel or move allowed until this many hours before the start | D12 ("inside the tenant's window") |
| `scheduling.reminderHours` | integer | 24 | reminder this many hours before the start; 0 = none | draft § 7 |
| `scheduling.embedOrigins` | string[] | `[]` | owned by `sched-frame-1` | `sched-frame-1.md` item 2 |
| `schedulingEmailConfig.templates` | record key → template | `{}` | tenant overrides of the six mails (§ 11) | F6 pattern |

### 4.2 Appointment side (scheduling-private table)

```ts
type Resource = { id: string; name: string; feedSecretHash?: string;                    // D1, D14
                 retiring?: { attemptId: string; at: Instant } };                        // § 13
type Eligibility = { kind: "all" } | { kind: "only"; resourceIds: [string, ...string[]] };   // D2
type Service = { id: string; name: string; durationMin: number; eligibility: Eligibility };  // D1, D2
type AvailabilityRule = { weekday: 1|2|3|4|5|6|7; start: LocalTime; end: LocalTime };        // D3 (ISO weekday)
type ClosedTime = { id: string; start: Instant; end: Instant; note?: string };               // SCHED-CALENDAR A
```

- `Eligibility`: "all" and "this list" exclude each other; the base plan's `eligibleResourceIds[] OR
  allResourcesEligible: true` (lines 79-82) is the boolean-plus-list shape. The list is non-empty by type.
- Slots start on a grid of the service duration from the start of each availability window (base plan open item
  lines 418-419, decided here).
- `retiring`: the fence of one removal attempt (§ 13), with its id and start. Every inventory writer that names a
  resource carries the **resource guard**: ConditionCheck `RESOURCE#<r>` `attribute_exists(SK) AND
  attribute_not_exists(retiring)` — the resource exists and no removal is under way.
- `feedSecretHash`: § 12. `note`: shown to the admin only.
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
  | { kind: "cancelled"; at: Instant; by: CancelledBy };
type CancelledBy = { kind: "customer" } | { kind: "admin"; email: string };

type BookingSource =
  | { kind: "visitor" }                                                                               // D12
  | { kind: "order"; orderId: string; line: number }       // D11; constructed only by sched-1h (§ 17.2)
  | { kind: "manual"; adminEmail: string; channel: string };                                          // D9

type Person = { email: string /* normalizeEmail() form */; name: string; phone?: string; language?: string };

type Booking = { id: string; ref: string; rev: number; what: BookingWhat; state: BookingState;
                 source: BookingSource; who: Person; tokenHashes: string[];
                 intentId?: string; heldUntil?: Instant; reminderSentFor?: Instant; createdAt: Instant;
                 updatedAt: Instant };
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
| `ref` | first 8 hex characters of `id`, upper case (`B-1A2B3C4D`): display only | audit titles, mails (SCHED-AUDIT-PII) |
| `rev` | optimistic version of the booking: every change of `what`, `state` or `tokenHashes` is conditioned on it and increments it (§ 7.1) | — (concurrency, technical) |
| `tokenHashes` | hashes of every `TOKEN#` item of this booking that may still exist, oldest first, 0-20. A hash leaves the list only in the transaction that deletes its item, or after that item was deleted; so the list is never missing an existing token. Empty after a cancel (§ 8.4) | D12; operator ruling R01 |
| `intentId` | the booking intent that created it (§ 7.2) | base plan lines 139-143 |
| `heldUntil` | the `expiresAt` the hold had; set by the hold, removed by confirm, **kept by a cancel** (the held state is gone then, but the `HELD#` key still needs it). Present exactly while `HELD#<iso(heldUntil)>#<id>` exists; cleanup and erasure build that key from it (§ 14) | — (storage key, technical) |
| `reminderSentFor` | the last start for which a reminder went out (§ 11.3) | draft § 7 |

### 4.5 Bounds (every bound this specification introduces)

| Bound | Value | Kind | Reason | Trigger to change | How it is lifted |
|---|---|---|---|---|---|
| Run capacity | 1-45 | **technical limit of this version** (SCHED-SEAT-BOUND) | cancelling a run is one transaction of `2 + 2 × capacity` items under DynamoDB's 100-item limit (§ 7.6) | a named client with a group above 45 | resumable two-phase cancel: status `cancelled` first, then batches of ≤ 45 bookings, idempotent, retried until the seat map is empty |
| Meetings per run | 1-60 | technical | item size and admin screen | a course with more than 60 meetings | raise: the run item holds hundreds |
| Trainers per run | 1-10 | lower bound domain (D4), upper technical | one condition check per trainer in run writes (§ 7.6) | a run with more than 10 trainers | raise to the transaction budget |
| `durationMin` | 5-480, multiple of 5 | technical | 5-minute admin grid; one working day | a service longer than 8 h or off the grid | raise; the container (§ 7.3) has no grid |
| Availability rules per resource | ≤ 50 | technical | one item (§ 6.2) | more than 50 windows a week | split by weekday |
| Future closed times per resource | ≤ 200 | technical | one item; ended ones are pruned on each write | more than 200 future closed times | one item per year |
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
| Text lengths | name ≤ 200, phone ≤ 40, note ≤ 500, channel ≤ 40, URL ≤ 500 | technical | item size and logs | — | raise |
| Request body | ≤ 8 KB (renderer) | technical | abuse | — | raise |

## 5. Kernel rules (pure functions; clock and timezone passed in)

Location: `packages/shared/src/scheduling.ts` (types, rules) and `packages/shared/src/zoned-time.ts` (wall time ↔
instant), beside `payment-transition.ts` and `coupon.ts`. No I/O, no `Date.now()`, no ambient zone. `Result<T,
E>` = `{ ok: true; value: T } | { ok: false; error: E }`. Notation: `bookingId` and `resourceId` = string;
`SeatEntry` = `{ x?: Instant }`; `ContainerEntry` = `{ bookingId; s: Instant; e: Instant; x?: Instant }` (§ 6.2).

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

**Changed** (amendment § 16.1): closed times are an input; existing bookings are busy intervals (held unexpired +
confirmed); a submitted start is re-checked at write time (`slotDecision`); the guard is the resource-day
container (§ 7.3), not a lock per start; the customer is identified by a link token, not a session; a move keeps
the booking id (§ 8.5).

```ts
availableSlots(input: {
  service: Service; resources: Resource[]; rules: Record<resourceId, AvailabilityRule[]>;
  closed: Record<resourceId, ClosedTime[]>; busy: { resourceId: string; start: Instant; end: Instant }[];
  from: LocalDate; to: LocalDate; tz: TimeZone; now: Instant;
}): Result<{ day: LocalDate; starts: { start: Instant; freeResourceIds: string[] }[] }[],
           { kind: "rangeInverted" } | { kind: "rangeTooLong"; maxDays: 62 }>

slotDecision(input: { service: Service; resource: Resource; rules: AvailabilityRule[]; closed: ClosedTime[];
                      start: Instant; tz: TimeZone; now: Instant }): Result<{ end: Instant }, SlotRefusal>
type SlotRefusal = { kind: "inPast" } | { kind: "notEligible" } | { kind: "resourceUnavailable" }
                 | { kind: "notOnGrid" } | { kind: "outsideAvailability" } | { kind: "closedTime"; closedId: string }

overlapCheck(candidate: { start: Instant; end: Instant }, entries: ContainerEntry[], now: Instant,
             self?: string): Result<void, { kind: "overlap"; bookingId: string }>
pickResource(freeResourceIds: string[]): string        // lowest id in string order; the caller retries the next
```

- **Slots**: for each eligible resource and each local day, each window of that weekday gives starts at
  `windowStart + k × duration` while `start + duration <= windowEnd`; kept when after `now`, not overlapping a
  closed time or a busy interval of that resource, and the local time exists. Intervals are half-open
  `[start, end)`. Example: 60 min, Monday 09:00-12:00, day 2026-12-07, busy `08:00Z-09:00Z`, `now` 2026-12-01 →
  `07:00Z`, `09:00Z`.
- **slotDecision** (visitor holds and visitor moves): the submitted start must be exactly a start that
  `availableSlots` would offer for that resource, busy intervals aside (they are the container's job). Examples:
  the same service and window, start `07:30Z` → `notOnGrid`; start `2026-11-30T07:00Z` with `now` 2026-12-01 →
  `inPast`; a resource outside `only` → `notEligible`.
- **Admin writes** (manual booking, admin move) skip `slotDecision`: the admin may book outside the windows, off
  the grid, in a closed time or for any resource. They are bound by: a known service (its duration), a known,
  resource that passes the resource guard (§ 4.2), and `overlapCheck`. Decided here: the practitioner's own entries must not be blocked by
  the visitor rules.
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

## 6. Storage

### 6.1 Table

One scheduling-private DynamoDB table (if SCHED-TABLE = A): `PAY_PER_REQUEST`, point-in-time recovery, TTL
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
| `CLOSED#<resourceId>` | `v`, `items` (list ≤ 200 of `{id, start, end, note?}`; ended ones pruned on write) | admin (`1e`) | no |
| `COURSE#<courseId>` | name, defaultCapacity, languages | admin (`1f`) | no |
| `RUN#<courseId>#<runId>` | meetings, timezone, capacity, trainerIds, language, groupLink?, status, firstStartIso, lastEndIso, `v`, `seats` (map bookingId → `{ x? }`) | admin; seat writes | booking ids only |
| `RUNSPAN#<lastEndIso>#<courseId>#<runId>` | `firstStartIso` only (its one copied attribute, which changes only with the meetings) | run create (put), run move (delete old + put new), run cancel (delete) — each in the same transaction as `RUN#`; no other run write changes the meetings | no |
| `RESDAY#<resourceId>#<utcDate>` | `v`, `entries` (map bookingId → `{ s, e, x? }`, ms) | slot writes | booking ids only |
| `BOOKING#<bookingId>` | the `Booking` record (§ 4.4); no TTL | every booking write | **yes** |
| `TOKEN#<sha256hex(token)>` | bookingId, createdAt; no TTL | every mail with a link; deleted by cancel, by the expiry cleanup and by erasure | no (a hash). A token item that outlives its booking can do nothing: the lookup finds no `BOOKING#` and answers 404 |
| `CUST#<normalizedEmail>#<bookingId>` | keys only; no TTL | created with its `BOOKING#`; removed with it (§ 14) | **yes** (email in key) |
| `HELD#<expiresAtIso>#<bookingId>` | keys only; no TTL | put by the hold transaction; deleted by confirm (same transaction) and by the expiry cleanup | no (a booking id). It exists exactly while the booking was never confirmed, and exactly while `BOOKING#.heldUntil` is present (its key is built from that value) |
| `UNPLACED#<courseId>#<bookingId>` | keys only | a booking becomes / stops being unplaced | booking id only |
| `HOLDS#<sha256hex(normalizedEmail)>` | `v`, `entries` (map bookingId → `{ x }`), `ttl` = latest `x` + 1 day | hold, confirm, cancel | no plaintext (an email hash). **TTL safe**: when it expires every entry has expired; its loss only resets an abuse count |
| `INTENT#<uuid>` | fingerprint (a hash), bookingId, `ttl` (24 h) | hold; deleted with its booking (§ 14) | no. **TTL safe**: after 24 h a replay of the same form is treated as a new request; nothing else reads it |
| `LIMIT#EMAIL#<sha256hex(normalizedEmail)>#<hourNumber>` | count, `ttl` (2 h) | hold, resend | no plaintext (an email hash, pseudonymous; eligible for TTL deletion 2 h after its hour, deleted by DynamoDB some time after). **TTL safe**: a counter of a past hour |
| `LIMIT#ADDR#<sha256hex(addressKey)>#<hourNumber>` | count, `ttl` (2 h) | hold (only if SCHED-ADDR-LIMIT = A) | no plaintext (an address hash). **TTL safe**: a counter of a past hour |

`x` present = held until `x`; absent = confirmed. `v` = container version (§ 7.1). `hourNumber` =
`Math.floor(ms / 3600000)`. Item sizes (INFERRED from attribute lengths): `RUN#` ≤ 60 × ~50 B + 45 × ~50 B ≈ 6 KB;
`RESDAY#` ≤ 96 entries × ~70 B ≈ 7 KB; `CLOSED#` ≤ 200 × ~120 B ≈ 24 KB; all far under 400 KB.

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
| AP10 | Config | Query `begins_with(SK, RESOURCE#)`, `SERVICE#`, `COURSE#`; Get `AVAILABILITY#<r>`, `CLOSED#<r>` | resources: `SK, name, feedSecretHash` (→ `hasFeed`); `retiring` never in a DTO |
| AP11 | Idempotency | Get `INTENT#<uuid>` | whole item |
| AP12 | All tenants (the reminder job then keeps those with the switch on; the daily cleanup keeps all) | main table Query `PK = SYSTEM, begins_with(SK, TENANT#)` (pattern `backend/src/tenant/list.ts:17-20`) | `id, name, domain, Domain, schedulingEnabled, scheduling, schedulingEmailConfig` |
| AP13 | Holds expired more than 7 days (daily cleanup, § 14.1) | Query `SK BETWEEN HELD# AND HELD#<now − 7 days, ISO>#\uffff` | keys (`bookingId` from the key) |

Projections checked against every consumer (a consumer reads nothing that is not listed here):

| Consumer | Reads (with projection) | Fields it needs and where they come from |
|---|---|---|
| Calendar feed (§ 12) | tenant Get (`schedulingEnabled`); `RESOURCE#` (`feedSecretHash`); AP3; BatchGet `BOOKING#` (`id, ref, what, state`); AP6 → BatchGet `RUN#` (as AP6); BatchGet `COURSE#` (`name`) | slot times and `serviceName` from `BOOKING#.what`; meeting times from `RUN#.meetings` converted with **`RUN#.timezone`** (never the tenant's current zone); course name from `COURSE#`; no `who` is read |
| Reminder job (§ 11.3) | AP12 (as AP12); AP3; AP6 → BatchGet `RUN#`; BatchGet `COURSE#` (`name`); Get `BOOKING#` (whole: `who` is the recipient) | link base from `domain`/`Domain` and `id` (`bookingBase`, § 5.3); template override from `schedulingEmailConfig.templates.reminder`, else the default; `{{siteName}}` from `name`; `{{when}}` for a seat from `RUN#.meetings` in `RUN#.timezone`, for a slot from `what.start` in `scheduling.timezone`; token mint from `rev`, `tokenHashes` |
| Daily cleanup (§ 14.1) | AP12 (`id`), every tenant whatever the switch; AP13; Get `BOOKING#` (`rev, who, tokenHashes, intentId, heldUntil, state`) | `CUST#` key from `who.email`; `HELD#` key from the query; tokens and intent to delete |
| Resource removal check (§ 13) | AP3; AP6 → BatchGet `RUN#` (`trainerIds, status, meetings`) | future entries; trainer use in runs not ended |
| Proposal and runs DTOs (§ 10.2) | AP4 (all attributes) | `timezone`, `meetings`, `language`, `status`, `capacity`, `seats` counts |

The base plan's `APPTDATE#` index is not needed (AP3 per resource serves the day view and reminders). Its
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
entries (existing event bus; content per SCHED-AUDIT-PII). **No `CUSTOMER#`, no `LEAD#`, no `EMAILLIMIT#`.** A
booking does not create a commerce customer.

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
`attribute_exists(SK) AND rev = :rev` (the value read) and sets `rev = :rev + 1`. Token minting (§ 8.4), confirm,
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

**Mechanism (SCHED-SLOT-GUARD = B, recommended).** Container `RESDAY#<resourceId>#<utcDate>`; entry
`bookingId → { s, e, x? }`; a slot touches each UTC date it covers (one, or two across UTC midnight: two updates
in one transaction). Rule on the snapshot: `overlapCheck`.

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

- A closed time added, or an availability rule removed, while a visitor holds an affected slot: the hold stands;
  the closed-time answer lists the conflicting refs (§ 10.3). Guarding would put every config write into the
  containers' version chain for a rare case.
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
is decided the other way: its reasons (clean history, simple slot accounting) are met by the audit entries and the
container write; one id keeps every link working across moves.

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

**Layout** (decision SCHED-PAGE-LAYOUT, recommended A): `%5Fbook/[siteId]/layout.tsx` is a **second root layout**
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
`{ error: string, code: <refusal>, ...context }`; the page maps `code` to locale strings.

| Method, path | Renderer op | Request | Response | Errors |
|---|---|---|---|---|
| GET `/scheduling/visitor/offer` | `offer` | — | `OfferDTO` | 403 |
| GET `/scheduling/visitor/slots?serviceId&from&to` | `slots` | query | `SlotsDTO` | 400 `rangeInverted`/`rangeTooLong`, 403, 404 service |
| GET `/scheduling/visitor/courses/{courseId}/runs?language&all` | `runs` | query | `ProposalDTO` | 403, 404 course |
| POST `/scheduling/visitor/holds` | `hold` | `HoldRequest` | 201 / 200 `HoldResult` (§ 7.2) | 400, 403, 409 `slotTaken`/`notOnGrid`/`inPast`/`notEligible`/`outsideAvailability`/`closedTime`/`resourceUnavailable`/`runFull`/`runClosed`/`runCancelled`/`runStarted`/`languageMismatch`/`intentReused`/`intentClosed`, 429, 503 `busy`/`mailFailed` |
| POST `/scheduling/visitor/bookings/view` | `view` | `{ token }` | `BookingViewDTO` | 403, 404, 410 |
| POST `/scheduling/visitor/bookings/confirm` | `confirm` | `{ token }` | `BookingViewDTO` | 403, 404, 409 `cancelled`, 410 |
| POST `/scheduling/visitor/bookings/cancel` | `cancel` | `{ token }` | `{ ref, state: "cancelled" }` | 403, 404, 409 `tooLate`/`paidContactTenant` |
| POST `/scheduling/visitor/bookings/move` | `move` | `{ token, to: { kind: "slot"; start } \| { kind: "seat"; runId } }` | `BookingViewDTO` | 403, 404, 409 (as hold) + `tooLate`/`notConfirmed`/`paidContactTenant`, 503 `busy` |
| POST `/scheduling/visitor/feed` (`sched-1g`) | feed | `{ resourceId, secret }` (POST keeps the secret out of API logs) | `text/calendar` | 404 only |

```ts
type OfferDTO = { timezone: string; services: { id: string; name: string; durationMin: number }[];
                  courses: { id: string; name: string; languages: string[] }[] };
type SlotsDTO = { timezone: string; serviceId: string; durationMin: number;
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
Every write publishes an audit entry (SCHED-AUDIT-PII). Common errors: 400 `invalid` (zod issues), 401
(authorizer), 403 `forbidden`, 404 `notFound`, 503 `busy`; route-specific 409 codes below. Identifiers: a booking
is addressed by its id alone (`BOOKING#<id>`); a run by `courseId + runId` in the path; a person move stays inside
the booking's own course (D8), so the request carries only `runId` and the course comes from the stored booking.

Common DTOs:

```ts
type WhoInput = { email: string; name: string; phone?: string; language?: string };      // § 4.5 lengths
type ResourceDTO = { id: string; name: string; hasFeed: boolean };
type ServiceDTO = { id: string; name: string; durationMin: number; eligibility: Eligibility };
type ClosedDTO = { id: string; start: string; end: string; note?: string };
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
       | { kind: "cancelled"; at: string; by: "customer" | string /* admin email */ };
  source: BookingSource; who: Person; createdAt: string; updatedAt: string };
type EmailTemplate = { subject: string; body: string; sendToCustomer: boolean; sendToAdmin: boolean };
```

Routes of `sched-1d` (shared by both lines):

| Route | Role | Request | Response | Validation, rules | 409 codes |
|---|---|---|---|---|---|
| GET `/scheduling/admin/bookings/{bookingId}` | E+T | — | `BookingAdminDTO` | — | — |
| POST `/scheduling/admin/bookings/{bookingId}/cancel` | E+T | `{}` | `BookingAdminDTO` | admin `changeDecision`; mail `cancelled` | `notActive` |
| POST `/scheduling/admin/customers/lookup` | E+T | `{ email }` | `{ bookings: BookingAdminDTO[] }` | email normalized; in the body, never the URL (base plan line 259) | — |
| POST `/scheduling/admin/customers/erase` | T | `{ email }` | `{ removedBookings: number; remainingBookings: number }` | § 14.2; idempotent; the screen shows the acceptance boundary text | — |
| GET `/scheduling/admin/resources` | E+T | — | `{ resources: ResourceDTO[] }` | ≤ 200 | — |
| POST `/scheduling/admin/resources` | E+T | `{ name }` | 201 `ResourceDTO` | name 1-200 | — |
| PUT `/scheduling/admin/resources/{resourceId}` | E+T | `{ name }` | `ResourceDTO` | — | — |
| DELETE `/scheduling/admin/resources/{resourceId}` | E+T | — | 204 | § 13 three steps | `resourceInUse { activeBookings: number; runs: number }`, `resourceRemovalInProgress` |
| POST `/scheduling/admin/resources/{resourceId}/feed-secret` | T | `{}` | `{ feedUrl: string }` (shown once) | a new secret replaces the old | — |
| GET `/scheduling/admin/email-templates` | E+T | — | `{ defaults: Record<key, EmailTemplate>; overrides: Record<key, EmailTemplate> }` | keys § 11.1 | — |
| (existing) `PUT /settings` | as today | `schedulingEnabled`, `scheduling.*`, `schedulingEmailConfig` | as today | timezone required when enabling; ranges § 4.5 | — |

Routes of `sched-1e` (appointments):

| Route | Role | Request | Response | Validation, rules | 409 codes |
|---|---|---|---|---|---|
| GET `/scheduling/admin/services` | E+T | — | `{ services: ServiceDTO[] }` | — | — |
| POST `/scheduling/admin/services` | E+T | `{ name, durationMin, eligibility }` | 201 `ServiceDTO` | § 4.5; listed resources exist | — |
| PUT `/scheduling/admin/services/{serviceId}` | E+T | same | `ServiceDTO` | bookings keep their stored end (§ 13) | — |
| DELETE `/scheduling/admin/services/{serviceId}` | E+T | — | 204 | bookings keep `serviceName` (§ 13) | — |
| GET `/scheduling/admin/resources/{resourceId}/availability` | E+T | — | `{ rules: AvailabilityRule[] }` | — | — |
| PUT `/scheduling/admin/resources/{resourceId}/availability` | E+T | `{ rules: AvailabilityRule[] }` | `{ rules }` | ≤ 50; 5-minute boundaries; `end > start`; one Put | — |
| GET `/scheduling/admin/resources/{resourceId}/closed` | E+T | — | `{ closed: ClosedDTO[] }` (future only) | — | — |
| POST `/scheduling/admin/resources/{resourceId}/closed` | E+T | `{ start, end, note? }` | 201 `{ closed: ClosedDTO; conflicts: string[] /* refs */ }` | `end > start`; ≤ 200 future; versioned item | — |
| DELETE `/scheduling/admin/resources/{resourceId}/closed/{closedId}` | E+T | — | 204 | versioned item | — |
| GET `/scheduling/admin/appointments?from&to` | E+T | query (ISO dates) | `{ timezone; resources: { resourceId; name; entries: { bookingId; ref; start; end; state: "held" \| "confirmed"; customerName; serviceName }[] }[] }` | ≤ 31 days; AP3 + BatchGet (§ 6.4) | — |
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

### 11.1 Mails (all six keys are defined, defaulted and editable in `sched-1d`)

| Key | When | To | Link (new token, § 8.4) |
|---|---|---|---|
| `hold` | visitor hold, replay recovery, resend | customer | yes — the only way to confirm |
| `confirmed` | confirm; admin manual entry | customer; owner copy (`integrations.contactEmail`) | yes; group link for seats |
| `cancelled` | customer or admin cancel; held seats of a cancelled run | customer; owner copy on a customer cancel | no |
| `moved` | slot move, person move, run move | customer | yes |
| `unplaced` | run cancelled; admin moves a person out of a run | customer | yes (the page shows the new proposal) |
| `reminder` | § 11.3 (`sched-1g`) | customer | yes |

Mechanism: the per-tenant template pattern of `order-email.ts` (F6): `{subject, body, sendTo…}` templates,
`{{variable}}` substitution (`renderTemplate`, `backend/src/lib/order-email.ts:89-97`), tenant overrides in a record
on `TenantConfig`, English defaults in the backend. Limit: English backend text, one template per key per tenant (a
two-language school writes one text; trigger: `lang-1a`). Scheduling adds `backend/src/lib/scheduling-email.ts`
(defaults, keys) and serves the defaults through GET `/scheduling/admin/email-templates`, so the admin screen holds
no second copy (`pay-1.md` F2 is not repeated). It imports `renderTemplate` from `order-email.ts` (the function is
generic; the module name is narrower than this use — recorded, no rename). Variables: `{{ref}}`,
`{{customerName}}`, `{{serviceName}}`, `{{courseName}}`, `{{when}}` (local date and time in the booking's zone,
with the zone name), `{{expiresAt}}`, `{{link}}`, `{{groupLink}}`, `{{siteName}}`. Sender: `formatFromHeader`
(`backend/src/lib/email-from.ts:112`).

Mail failure: the `hold` mail → `state.mail = "failed"`, 503 `mailFailed`, recovery by replay (§ 7.2). Other
mails: logged; the change stands (as `pay-1`).

### 11.2 Wiring per function (`pay-1.md` revision-1 rule: every environment dependency is wired and asserted)

`SES_FROM_EMAIL` and one `ses:SendEmail` statement on the sending identity (the two lines of
`UpdateOrderStatusFunc`, `infra/lib/api-commerce.ts:245-258`) on each of the twelve mailing functions: visitor
hold, visitor confirm, visitor cancel, visitor move, admin booking cancel, admin manual appointment, admin move
slot, admin run move, admin run cancel, admin manual seat, admin move seat, reminder job.

Every scheduling function: `SCHEDULING_TABLE_NAME` and the grant it uses (read-only for GET routes); `TABLE_NAME`
with read on the main table; `EVENT_BUS_NAME` and `events:PutEvents`. `RENDERER_CLOUDFRONT_ORIGIN` on the twelve
mailing functions and the feed-secret route. `RECAPTCHA_SECRET_KEY` on the visitor hold.

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
| A resource removed | Three steps, one attempt id `A` per request: (1) **acquire**: `UpdateItem RESOURCE#` `SET retiring = {attemptId: A, at: now}`, condition `attribute_exists(SK) AND (attribute_not_exists(retiring) OR retiring.at < :now − 10 min)` (a fence older than 10 minutes belongs to a crashed attempt and is taken over); failure → 409 `resourceRemovalInProgress` (or 404 when the resource is gone). (2) **check**, with consistent reads after the fence committed: AP3 from today on, and AP6 with `t = now` → BatchGet `RUN#` (`trainerIds`). (3a) anything active → `REMOVE retiring` with condition `retiring.attemptId = :A`, 409 `resourceInUse`; (3b) nothing → one transaction: delete `RESOURCE#` with condition `retiring.attemptId = :A`, delete `AVAILABILITY#<r>`, `CLOSED#<r>`; 204. A step 3 whose condition fails (its fence was taken over) answers 409 `resourceRemovalInProgress` and changes nothing: one attempt never clears or uses another's fence. **Concurrency**: every inventory writer carries the resource guard (§ 4.2). A writer that commits before (1) is seen by (2); a writer that commits after (1) fails the guard (`retiring` present); a writer that read the resource earlier and commits after (3b) fails the guard (`attribute_exists`) → 409 `resourceUnavailable`. |

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
  and the next writer of that container removes it (§ 7.1). Readers that meet such an id (day view, feed) skip a
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

### Open (the human's) — each repeated as a `DECISION_REQUIRED` block in the build report

**SCHED-TABLE**

| Option | Reward | Risk |
|---|---|---|
| A. One scheduling-private table for both shapes | one boundary, one IAM rule, one backup, one removal path; one resource entity for practitioners and trainers | both shapes share one partition per tenant — not a limit at booking volumes (INFERRED) |
| B. A table per shape | hard separation | two tables, two grant sets, two removal paths for data of one sensitivity; resources duplicated or cross-table |

Recommended: A.

**SCHED-PAYMENT-PATH**

| Option | Reward | Risk |
|---|---|---|
| A. A course is a product sold through the checkout; the order creates the booking (`sched-1h`, its own specification, § 17.2) | coupons, vouchers, loyalty, order mails, invoices, online payment apply once | waits for `cmrc-4`; the order route is anonymous today (`/public/orders`), so its fit with the PD-002 amendment is an open question of `sched-1h`; a frame tenant reaches the checkout as a full page (`sched-frame-1.md` item 4) |
| B. Scheduling takes payments itself | no commerce dependency | a second checkout, invoices and coupon rules |

Free bookings and "pay at the practice" need neither. Recommended: A.

**SCHED-CALENDAR**

| Option | Reward | Risk |
|---|---|---|
| A. AMODX holds the schedule; staff subscribe to a read-only feed (§ 12) | one source of truth; small; no third-party token | a private busy time is typed in as a closed time |
| B. AMODX reads the practitioners' Google calendars | no double booking with private events | Google access per person, token storage, a second source of truth |

Recommended: A; ask the practitioner client whether its private calendar is full.

**SCHED-PD-AMENDMENT** — PD-002 names "appointment booking / list / cancel" by session
(`docs/platform-decisions.md:155`). Wording in § 16.3: four access classes (public derived reads, the initial hold,
token-authorized booking actions, feed-secret access), the tenant from the URL the renderer serves, no backend
route anonymous. Recommended: accept.

**SCHED-SLOT-GUARD**

| Option | Reward | Risk |
|---|---|---|
| A. One conditional lock item per 5-minute cell a booking covers | the base plan's lock idea; exclusion by item ownership | durations ≤ 240 min (≤ 48 cells + other items under 100 per transaction); up to 48 writes per booking |
| B. Resource-day container with version (§ 7.3) | one mechanism for slots, seats and open holds; durations to 480 min; one item per day | writes to one practitioner's day serialize (retries at contention; invisible at practitioner volumes, INFERRED) |

Recommended: B.

**SCHED-AUDIT-PII**

| Option | Reward | Risk |
|---|---|---|
| A. Visitor actions: actor `{ id: "booking:<ref>", email: "visitor (booking link)" }`; titles = ref + offer + local time; no customer name or email in any scheduling audit entry; admin actions keep the admin's email | no customer name, email or phone in the renderer-readable main table. Still renderer-readable there: booking refs, service and course names, local times, action names and admin emails | `actor.email` holds a label, not an address, for visitor actions (a recorded name/content mismatch); Critical Rule 7 read as "human-readable" |
| B. Customer email and name in audit entries (as `backend/src/contact/send.ts:113-120`) | the audit page shows who directly | customer data in the renderer-readable table for every booking |
| C. A scheduling audit trail in the private table | full detail, private | a second audit reader and page |

Recommended: A.

**SCHED-ADDR-LIMIT** (basis corrected: no infra change rests on it)

| Option | Reward | Risk |
|---|---|---|
| A. Build the per-address limit (§ 9.2) on the header the `sched-1g` staging witness proves (`sched-1d` counts whatever address the renderer sends; until `sched-1g` none arrives) | a real per-address limit and a correct `remoteip`, most likely without infra | the witness may show neither header usable as specified; IPv6 counted per /64 can group neighbours |
| B. No per-address limit: reCAPTCHA + per-email limits + open-hold cap + short holds | nothing to verify | one machine with many addresses or emails past reCAPTCHA can hold many slots for `holdMinutes` |

Recommended: A.

**SCHED-SEAT-BOUND** (operator recommendation A; kept for the decision review)

| Option | Reward | Risk |
|---|---|---|
| A. A run holds at most 45 people in this version (technical limit, § 4.5; the admin refuses more with a text that says so) | atomic run cancel in one transaction; small code | a client group above 45 is refused until the two-phase cancel is built |
| B. No maximum; build the resumable two-phase cancel now | no product limit from storage | more code and recovery evidence for a case no named client has |

Recommended: A (the named clients' groups are bench courses and workshops).

**SCHED-PAGE-LAYOUT** (keeping third-party scripts off the booking pages needs a structural route change)

| Option | Reward | Risk |
|---|---|---|
| A. A second root layout `app/%5Fbook/[siteId]/layout.tsx`, reached only by a middleware rewrite of `/_booking…` (§ 10.1) | no tenant script on the booking pages (no token exposure to analytics or the pixel); no site chrome inside a frame; the existing root layout and serving tree unchanged; a pattern `landing-1` and `lang-1` can reuse (a layout that knows its page through the rewrite) | a new branch in the middleware, the core of the serving contract (serving suite rows); a second root layout next to `app/not-found.tsx` (Next's not-found handling with two root layouts must be proven; INFERRED risk); navigation between the two trees is a full page load |
| B. Keep the pages under `app/[siteId]/` and its layout | no middleware or layout change | every tenant script (analytics, Facebook pixel, Paddle, popups, cookie banner) runs on the manage page, which reads the token from the address before it removes it (INFERRED exposure: such scripts read `location.href` when they load); site chrome inside frames, hidden only by CSS (as `landing-1`) |
| C. Move every existing route under `app/[siteId]/(site)/` with today's layout, and the booking pages under `app/[siteId]/(booking)/` with their own | no new rewrite target | moves every live route file of the serving tree; preview twin rewrites still need a middleware rule for the booking paths |

Recommended: A.

## 16. Proposed amendment text (applied only after the human ratifies; not edited here)

### 16.1 Base plan `docs/plan-appointments-private-table-extension.md`

> **Amendment 2026-11-xx (SCHED-1, ratified by the human on <date>).** Two booking shapes and an emailed link.
> Read this section before the rest of the plan; where they differ, this section wins.
>
> **Goal** (replaces the first bullet "Authenticated booking only"): *Booking by emailed link.* A visitor books
> without an account; the booking is held, and an emailed link with a one-booking token confirms it and later
> shows, cancels or moves it. Booking calls stay renderer-proxied (PD-002 as amended). The other Goal bullets
> stand; the flag is `schedulingEnabled` (both shapes).
>
> **Non-Goals** (replaces "No anonymous bookings; a session is required" and "No numeric per-service pooled
> capacity"): no account and no session are required; link tokens replace them. Pooled capacity is in scope as a
> *seat in a group run* (`docs/slices/sched-1.md` § 4.3); per-service pooled capacity without runs stays out.
> Calendar sync stays out (SCHED-CALENDAR).
>
> **Capacity model**: an appointment reserves one named resource (unchanged), is re-checked against the offered
> slots at write time, and is guarded by the resource-day container `RESDAY#<resourceId>#<utcDate>` with a version
> (SCHED-SLOT-GUARD), which replaces `SLOT#<resourceId>#<startIso>`: one lock per start does not stop overlapping
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
> **Slices**: S1-S7 are replaced by `sched-1a` … `sched-1i` (`docs/slices/sched-1.md` § 17). The open items
> "reschedule semantics", "timezone source" and "slot granularity" are decided in `sched-1.md` § 15.

### 16.2 What the base plan keeps unchanged

The problem statement; tenant isolation; the private table outside renderer IAM; derived availability DTOs only;
the kernel/persistence split with injected clock and timezone; UTC instants in storage; the two-step "any
available"; the booking intent; the flag default false with route-specific enforcement; the dormant `CUSTOMER`
branch; no anonymous-bypass paths; audit on every lifecycle event; the migration discipline for prototypes.

### 16.3 `docs/platform-decisions.md` PD-002

> In **Applies to**, replace "appointment booking / list / cancel in Phase 1" with:
> "scheduling (appointments and group seats): availability reads, booking, view, confirm, cancel and move, under
> the *Booking-token variant* below".
>
> Add after **Trust cost (accepted)**:
>
> ### Booking-token variant (amendment 2026-11-xx, SCHED-1)
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

### 16.4 Documents updated at ratification (ripple list; not edited in this slice)

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
reminder rule and permission ≈ 315 of 500.

Abstraction line: **nested stack `api-scheduling.ts`** — users: every scheduling function and route; axis: the
CloudFormation 500-resource ceiling (demonstrated, F5); rejected: routes in the parent (≈ 467 + ≈ 315 > 500).

### 17.1 Slices

| Slice | Scope | Allocation sketch | Depends | Infra (named gain) |
|---|---|---|---|---|
| `sched-1a` | Types, Zod schemas, kernel of both shapes, `zoned-time`, `bookingBase`, `TenantConfig` fields | `packages/shared/src/scheduling.ts`, `packages/shared/src/zoned-time.ts`, `packages/shared/src/index.ts`, `packages/shared/test/scheduling.test.ts` | — | none |
| `sched-1b` | Inert scheduling-private table | `infra/lib/database.ts`, `infra/lib/amodx-stack.ts`, `infra/test/amodx-stack.test.ts` | `1a` (order only) | the table: `1c` tests against it; customer data outside the renderer's IAM |
| `sched-1c` | `scheduling-db.ts`: container and booking rules, every transaction of §§ 7, 8.4, 13, 14, refusal mapping, § 6.4 query rules | `backend/src/lib/scheduling-db.ts`, `backend/test/unit/scheduling-db.test.ts`, `backend/test/scheduling-db.integration.test.ts` | `1b` | none |
| `sched-1d` | Nested stack; visitor backend routes (not the feed); shared admin routes (bookings, customers, resources, feed secret, mail templates); `scheduling-email.ts` with the six keys; reCAPTCHA; limits, with `client-address.ts` (the address limit counts what the renderer sends); minimal admin screen (scheduling settings, resources, mail templates) | `packages/shared/src/client-address.ts`, `backend/src/scheduling/visitor/*.ts`, `backend/src/scheduling/admin/{bookings,customers,resources,email}-*.ts`, `backend/src/lib/scheduling-email.ts`, `infra/lib/api-scheduling.ts`, `infra/lib/amodx-stack.ts`, `infra/test/amodx-stack.test.ts`, `admin/src/pages/Scheduling.tsx`, sidebar, `tools/mcp-server/routes.json` | `1c` | nested stack + routes: no route fits in the parent |
| `sched-1e` | Appointments admin: services, availability, closed times, day/week view, manual slot, move slot; admin pages | `backend/src/scheduling/admin/appt-*.ts`, `admin/src/pages/SchedulingAppointments*.tsx`, `api-scheduling.ts` (own routes) | `1d` | routes inside the nested stack |
| `sched-1f` | Groups admin: courses, runs, move run, cancel run, roster, unplaced list, manual entry, move person, CSV export, group link; admin pages | `backend/src/scheduling/admin/group-*.ts`, `admin/src/pages/SchedulingCourses*.tsx`, `admin/src/pages/SchedulingRoster.tsx`, `api-scheduling.ts` (own routes) | `1d` | routes inside the nested stack |
| `sched-1g` | Hosted pages and proxies (§ 10.1) with the client-address extraction and its staging witness (§ 9.2; a gate before any visitor exposure), middleware branch, `mapTenant` reCAPTCHA mapping, locale keys EN + RO, reminder job, calendar feed | `renderer/middleware.ts`, `renderer/src/app/%5Fbook/[siteId]/**`, `renderer/src/lib/dynamo.ts`, `renderer/test/serving-contract/*`, `packages/shared/src/language-packs/*`, `backend/src/scheduling/reminders.ts`, `backend/src/scheduling/visitor/feed.ts`, `api-scheduling.ts` | `1d` | one schedule rule: reminders cannot run otherwise |
| `sched-1h` | **Needs its own specification after SCHED-PAYMENT-PATH and `cmrc-4`** (§ 17.2) | — | `1f`, `pay-1`, `cmrc-4`, its specification | — |
| `sched-1i` | Validation on staging of every guarantee | tests and a staging runbook only | all in use | none |

`sched-1e` and `sched-1f` each depend on `sched-1d` only; they touch disjoint files except `api-scheduling.ts`
(each appends its own routes) and the admin sidebar (one line each). The practitioner line: `1a`-`1e`, `1g`,
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

**`sched-1a`** (pure, `packages/shared` vitest)

| Row | Input | Expected |
|---|---|---|
| A1 | § 5.2 slots example | `07:00Z`, `09:00Z` |
| A2 | `2027-03-29 09:00` / `2027-03-28 03:30` / `2026-10-25 03:30` Bucharest | `06:00Z` / `nonexistentLocalTime` / `00:30Z` |
| A3 | `slotDecision`: past, off grid, ineligible, outside window, closed, resource fenced | each `SlotRefusal` variant |
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
| A14 | a fourth `BookingWhat` variant in a temporary copy | compile errors at every `switch` (recorded, removed) |
| A15 | Zod: email valid only after normalization; capacity 46; duration 7; `trainerIds: []` | normalized accepted; 46, 7 and `[]` refused |

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
| C30 | items with `ttl` | only `INTENT#`, `LIMIT#EMAIL#`, `LIMIT#ADDR#`, `HOLDS#` carry `ttl`; no `BOOKING#`, `CUST#`, `TOKEN#`, `HELD#` does |
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
| D8 | arbitrary start submitted to the hold | `notOnGrid` / `outsideAvailability` / `inPast` |
| D9 | offer, slots, runs DTOs | no resource id or name, email, phone or customer name in the JSON |
| D10 | audit entries of hold, confirm, cancel | no customer email or name in `actorEmail`, `entityTitle`, `details` (if SCHED-AUDIT-PII = A) |
| D11 | `client-address.ts` unit rows: every example and every invalid form of § 9.2, with `k = 1` and `k = 2`; `addressKey` of IPv4, IPv6, mapped IPv4; the hold route with `x-viewer-address` from a RENDERER call, from another role, and absent | the § 9.2 tables exactly; another role's header ignored; absent or invalid → no address limit |
| D12 | resource delete with a future booking; without | 409 `resourceInUse`; 204, availability and closed items gone |
| D13 | email templates: defaults served; an override used; feed secret answers the URL once | as stated |
| I1 | every mailing function of § 11.2 (synth) | `SES_FROM_EMAIL` and exactly one `ses:SendEmail` on the identity (not `*`) |
| I2 | every scheduling function (synth) | `SCHEDULING_TABLE_NAME`; GET functions have no write action |
| I3 | the hold function (synth) | `RECAPTCHA_SECRET_KEY` equal to the commerce order function's |
| I4 | renderer role (synth) | no statement on the table |
| I5 | template counts (synth) | nested stack count logged; parent `< 500` |
| Staging | operator | hold → mail (a real test mailbox: the SES simulator discards the link) → confirm → cancel through the backend with the renderer key; items read back; cleanup |

**`sched-1e`**: E1 eligibility `only` limits slots; E2 a closed time removes overlapping starts and the POST answer
lists conflicting refs; E3 service deleted → its bookings keep `serviceName`, offer omits it; E4 duration change
keeps an existing booking; E5 manual booking outside the windows → confirmed, mail with a working link; E6 day view
returns every resource's intervals with summaries; E7 move slot keeps id and tokens, an old link opens the moved
booking; E8 move slot with a stale `rev` → 409 `stale`. Staging: a practitioner configuration on a staging tenant,
one booking made and moved in the admin.

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
| External calendar read | SCHED-CALENDAR = A recommended | the practitioner's private calendar is full |
| Public developer API, metering | `sched-frame-1.md` Non-scope | a paying client's developer needs it |
| Paid-course booking | § 17.2 | SCHED-PAYMENT-PATH decided and `cmrc-4` shipped |
| Runs above 45 people | § 4.5 | a named client with a larger group |
| Expired hold revived on confirm | simplest correct rule | many late confirms (raise `holdMinutes` first) |
| Retention period for confirmed and past bookings | none stated | a tenant or regulator states one |
| Platform-wide per-email counter | per-tenant isolation | an abuse report across tenants |
| Feed secret in CloudFront logs | calendar apps send no headers | access logs turned on |
| Mails in the person's language | one template per key per tenant | `lang-1a` ships |
| A closed time added during a hold is not guarded | rare; the admin sees the conflict list | a double booking reported from this path |
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
  record with its own keys; rejected: keys added to `getDefaultTemplates()` (the order mail page would list them).
- `api-scheduling.ts` nested stack — § 17.
- Second root layout `app/%5Fbook/[siteId]/` (if SCHED-PAGE-LAYOUT = A) — users: the book page, the manage page, the
  proxy handlers, the feed; axis: pages that must carry no tenant script; rejected: the existing root layout (G5; it
  cannot see the page).

No interface, registry, adapter or plugin is introduced: every growth axis is a closed set of variants (shapes,
states, sources, containers), handled by sum types and exhaustive matches.

## 20. Exit criterion

**This specification slice** is accepted when the reviewer finds §§ 4-17 checkable against the code and every open
decision of § 15 raised. It edits no other file.

**Later work, not part of this slice's acceptance**: the human answers the decisions; then a separate ratification
change applies § 16 by dated sections, registers `sched-1a`…`1i` in `docs/ROADMAP.md` in place of `appt-1`…`7`, and
registers the prefix `sched-` in `docs/documentation.md`.

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
- Not yet applied to the text above (applied in one pass after ratification): § 4.4, § 4.5, § 6.5, § 8.5, § 10.3,
  § 15, § 16.1, § 16.2 and row D10.
- State: waits for the human's ratification of the nine decisions. No build slice starts before it.
