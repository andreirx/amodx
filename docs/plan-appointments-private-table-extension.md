# Appointments-Private Table & Scheduling Extension Plan

## Status

- PLANNED
- Capacity model: **multiple named resources** per tenant (a booking reserves one
  resource, or the system assigns one from an eligible set)
- Customer data transport: **renderer proxy** — `docs/platform-decisions.md` PD-002
- Customer identity: **tenant-local** — `docs/platform-decisions.md` PD-001
- Cognito role: the `CUSTOMER` authorizer branch stays **dormant** in Phase 1 —
  `docs/platform-decisions.md` PD-003
- Current maturity: no scheduling module; the Public Cognito pool's authorizer branch
  exists but is dormant (returns `role: "CUSTOMER"`), with no consumer routes
- Target maturity: production-grade boundary where appointment data (including customer
  details) lives in a dedicated appointments-private table, the renderer Lambda cannot
  read it, all access is renderer-proxied or admin, and tenants enable/disable the
  feature with one config flag

> Read `docs/platform-decisions.md` (PD-001/002/003) first. This plan applies those
> decisions to scheduling; it does not re-derive them.

## Problem

AMODX tenants need "events between a customer and the tenant" — dentist appointments,
car-repair bookings, salon slots, lawyer meetings. These businesses commonly have
**parallel capacity** (3 chairs, N staff, several bays), so a single-calendar model is
insufficient.

Today:

- There is no scheduling domain model or storage.
- The Public Cognito pool's authorizer branch verifies public-pool JWTs and returns
  `role: "CUSTOMER"`, but no consumer routes accept it. Under PD-002/PD-003 it stays
  dormant: Phase-1 customer actions are renderer-proxied, not customer-JWT-authorized.
- The main DynamoDB table is shared by many entity families, and the renderer has read
  access to it.

If appointments went into the main table with renderer read access, a renderer
compromise would expose customer-private appointment data (names, emails, phones, times,
notes) — repeating the commerce exposure (security finding 7.6).

## Goal

Introduce an EVENTS SCHEDULING extension with these properties:

- **Authenticated booking only.** A customer must have a session (Google or
  email/password — see `plan-public-pool-customer-auth.md`) before booking or managing
  appointments. Booking calls are renderer-proxied (PD-002), not direct customer-JWT
  calls to the backend.
- **Tenant isolation.** Every appointment is scoped to one tenant; cross-tenant
  reads/writes are blocked by the same role + tenant checks as existing handlers.
- **Private storage boundary.** Customer-private appointment data lives in a dedicated
  appointments-private DynamoDB table. The renderer Lambda has **no IAM access** to it;
  all access is via backend handlers.
- **Parallel capacity.** A tenant defines multiple named resources; bookings reserve a
  concrete resource (or the system assigns an eligible free one).
- **Operational control.** A per-tenant `appointmentsEnabled` flag (default `false`)
  enables/disables the whole feature.

## Non-Goals (Phase 1)

- No general workflow engine or arbitrary multi-step orchestration.
- No calendar sync (Google/Outlook).
- No shared "global booking" across tenants; everything is tenant-local.
- No anonymous bookings; a session is required.
- **No numeric per-service pooled capacity.** Phase 1 supports per-service resource
  *eligibility*, but every booking still reserves exactly one named resource. Deferred:
  service-level pooled capacity (e.g. "service A has capacity 3" without naming
  staff/chairs/bays).

## Capacity Model (Phase 1 — multiple named resources)

### Domain entities

```
Tenant
  has many AppointmentResources           (staff / chairs / bays)

AppointmentService
  has duration
  has eligibleResourceIds[]  OR  allResourcesEligible: true

Appointment
  reserves exactly one resourceId
  has start / end  (derived from service duration)
  has status, customer identity (tenant-local), optional notes
```

### Slot generation (pure function, no I/O)

```
availableSlots(
  serviceId,
  dateRange,
  resources,
  availabilityRules,
  existingAppointments,
  timezone,
  now            // injected clock — never read ambient time (DST testability)
) -> slots grouped by start time; each slot lists the eligible resourceIds that are free
```

### Time invariant (UTC instants vs local wall time)

- **Storage and locks use UTC ISO instants.** `startIso` in `SLOT#<resourceId>#<startIso>`
  and the appointment `start`/`end` are UTC instants, not local wall time.
- **Availability rules use local wall time** in an explicit tenant/resource timezone
  (e.g. "Mon–Fri 09:00–17:00 Europe/Bucharest").
- The kernel takes the timezone explicitly (never ambient) and converts local candidate
  slots to UTC instants for locks and storage. This keeps DST correct: a 09:00 local slot
  maps to different UTC instants across a DST boundary, but each lock key is one
  unambiguous instant.

### Booking concurrency enforcement (persistence, not kernel)

Double-booking is prevented at write time, not in the kernel, with a per-resource slot
lock:

```
PK = TENANT#<tenantId>
SK = SLOT#<resourceId>#<startIso>      // startIso = UTC ISO instant (Time invariant)
```

"Any available" is **two-step** — you cannot discover a free resource *inside* one
DynamoDB transaction (discovery needs queries across resources):

1. Query existing appointments/locks for the eligible resources over the range.
2. The kernel returns the eligible resourceIds free for the chosen slot.
3. The backend deterministically picks one candidate.
4. `TransactWrite` creates `SLOT#<resourceId>#<startIso>` with `attribute_not_exists`,
   plus — atomically — the appointment item, its `APPTCUSTOMER#`/`APPTDATE#` adjacency
   items, and the booking-intent item (so the access-pattern adjacencies always exist).
5. On a race (the condition fails), retry with the next candidate, or return a conflict if
   none remain.

For a specific (non-"any") resource, steps 1–3 collapse to that one resource; step 4 is
the same conditional lock.

- **Idempotency:** the client generates a booking-intent UUID at form render; the backend
  does a conditional `Put` on `BOOKINGINTENT#<uuid>`, so a double-click or retry cannot
  create two appointments. Retry semantics: same UUID + same request fingerprint →
  return the existing appointment result; same UUID + **different** fingerprint → `409`
  conflict.

### Detection vs enforcement (do not conflate)

- The **kernel** *detects* availability and overlap as pure functions of its inputs.
- **DynamoDB** *enforces* concurrency via the slot-lock conditional write / transaction.
- These are two separate slices (S1 kernel and S3 persistence). The kernel must never
  reach for a clock or a database.

## Architectural Boundary

### Main Table (unchanged)

The existing single table remains the public/content/catalog table (tenant config,
content, products, categories, forms, popups, delivery, etc.). The renderer keeps read
access to it (subject to future least-privilege phases).

### New Appointments-Private Table

A dedicated DynamoDB table holds only scheduling entities:

- `APPOINTMENT#<appointmentId>` (get by id)
- `APPTCUSTOMER#<normalizedEmail>#<startIso>#<appointmentId>` (customer→appointment
  adjacency, **time-ordered**; email normalized via the shared `normalizeEmail()` — PD-001)
- `APPTDATE#<startIso>#<appointmentId>` (tenant date adjacency for calendar/admin range
  queries)
- `RESOURCE#<resourceId>`, `SERVICE#<serviceId>`, `AVAILABILITY#<…>` (tenant scheduling
  config)
- `SLOT#<resourceId>#<startIso>` (concurrency lock item; `startIso` = UTC instant)
- optional `BOOKINGINTENT#<uuid>` (idempotency) and per-tenant counters

Keys: `PK = TENANT#<tenantId>`, `SK = <entity-specific pattern>`. Mirrors the
commerce-private pattern; renderer has **no IAM access**.

> **Decision:** resources, services, and availability rules also live in the
> appointments-private table — one consistency boundary (config and appointment records
> change together), and resource names can reveal staff/chair/bay data, so not public by
> default. The renderer never reads this table directly; it gets only public-safe
> **derived availability DTOs** through backend routes. Customer-private records
> (`APPOINTMENT#`, `APPTCUSTOMER#`) are private for the same reason.

#### Access patterns (no-scan)

All list endpoints use `QueryCommand` + `ProjectionExpression`; never `Scan`.

1. **Get appointment by id** — `SK = APPOINTMENT#<appointmentId>`.
2. **List a customer's appointments (time-ordered)** —
   `SK begins_with APPTCUSTOMER#<normalizedEmail>#`; the embedded `<startIso>` makes the
   result chronological without a post-query sort.
3. **List tenant appointments by date range (calendar/admin)** —
   `SK BETWEEN APPTDATE#<rangeStartIso> AND APPTDATE#<rangeEndIso>`.
4. **Resource locks by date range** —
   `SK BETWEEN SLOT#<resourceId>#<rangeStartIso> AND SLOT#<resourceId>#<rangeEndIso>`
   (per resource).
5. **Config lookup** — `RESOURCE#<resourceId>`, `SERVICE#<serviceId>`, `AVAILABILITY#<…>`.

Rationale: `APPOINTMENT#<id>` alone cannot serve a date-range calendar view without
scanning, and `APPTCUSTOMER#<email>#<id>` cannot return history chronologically — hence
the `APPTDATE#` adjacency and the `<startIso>` segment inside `APPTCUSTOMER#`.

### Tenant Feature Toggle

`appointmentsEnabled: boolean` (default `false`), independent of `commerceEnabled`. Place
it on `TenantConfig` or within an existing feature/config grouping in the shared schema if
one exists at implementation time — the invariant is **default false and
backend-enforced**, not the exact field location.

- Admin UI: the settings toggle is **always visible** to authorized tenant admins.
  Resource/service/availability **config** can be edited while `appointmentsEnabled` is
  `false`, so a tenant prepares first, then enables. Operational appointment
  list/detail/status views may be hidden or read-only when disabled.
- Renderer: hides booking UX and skips scheduling calls when disabled.
- Backend enforcement is **route-specific**, not a blanket reject:
  - Customer routes (booking / list / cancel) reject when `appointmentsEnabled` is `false`.
  - Admin config + toggle routes remain usable when disabled (so the tenant can configure
    and then enable).
  - Admin operational routes (list/detail/status) may be read-only when disabled.

## Security Properties

### Improved

- A renderer compromise grants no direct read of appointment records or customer
  identities (the table is outside the renderer's IAM).
- Customer booking/list/cancel is renderer-proxied (PD-002): backend routes accept the
  `RENDERER` role, tenant is host-derived, customer email is session-derived. The browser
  never asserts tenant or identity directly.
- A tenant can disable the whole feature with one flag.

### Residual

- The renderer still has read access to whatever remains in the main table.
- Appointment data is isolated, but other non-commerce/non-appointment private families
  still rely on the main-table boundary.

## Auth & API Design (renderer-proxy, PD-002/PD-003)

### Customer-facing endpoints

The customer's browser calls **renderer** routes; the renderer validates the NextAuth
session, derives tenant from `Host`, and calls the backend with the `RENDERER` key plus
the session email. No customer Cognito JWT reaches the backend in Phase 1.

Backend routes (RENDERER-key, not anonymous, not CUSTOMER):

- `POST /appointments` — create for the session customer
- `GET /appointments` — list the session customer's appointments
- `DELETE /appointments/{id}` — cancel one of the session customer's appointments

Backend handler rules:

- `requireRole(auth, ["RENDERER"])`.
- Tenant comes from the renderer (host-derived), not the request body.
- Customer email comes from the renderer (session-derived), normalized via
  `normalizeEmail()`; appointment ownership is checked against
  `APPTCUSTOMER#<normalizedEmail>`.
- No email in URL paths/query strings (it lands in logs/traces).
- All reads use `QueryCommand` + `ProjectionExpression`; no scans.

### Admin / tenant-owner endpoints

These use the existing admin Cognito pool directly (not renderer-proxied):

- `GET /appointments/admin`, `GET /appointments/admin/{id}` — list/detail with projection
- `PUT /appointments/admin/{id}` — status updates (confirmed/completed/cancelled)
- Resource/service/availability config CRUD

Rule: use the existing admin role constants accepted by `requireRole` in this codebase
(see `packages/shared` `UserRole`); `GLOBAL_ADMIN` passes through policy automatically. Do
not invent new role names.

### Dormant CUSTOMER branch (PD-003)

The authorizer's `CUSTOMER` branch stays in place but unused in Phase 1 — no appointment
route accepts `CUSTOMER`. It is retained for a possible future direct-JWT path
(high-sensitivity flows). Do not route Phase-1 appointments through it. Do not place
appointment endpoints under anonymous-bypass paths (`POST /leads|/contact|/consent`),
which resolve before JWT verification.

### Notifications and Audit

- Lifecycle events (created/rescheduled/cancelled/completed) call `publishAudit()` with
  `actor.email` + `target.title` (per repo audit rule), → EventBridge → worker → audit
  trail.
- Optional SES notifications follow the commerce order-email template pattern (per-tenant
  templates; variables like `{{appointmentDate}}`, `{{serviceName}}`, `{{resourceName}}`,
  `{{customerName}}`).

## Clean Architecture Shape

### Domain kernel (pure, no I/O) — the core, build first

A pure OOP module (the Critical Business Rules) with **no AWS, no clock, no framework**:

- entities: `AppointmentResource`, `AppointmentService`, `AvailabilityRule`,
  `Appointment`, `AppointmentStatus`
- `availableSlots(...)` (signature above) — injected `now`, injected timezone
- overlap detection, status-transition rules, reschedule rules, cancellation-window rules

Testable off-target (per the repo's off-target-testability rule) with fixtures for DST
boundaries, multi-resource eligibility, and overlap edge cases.

### Persistence / support module

`backend/src/lib/appointments-db.ts` — typed functions isolating the table detail:

- `createAppointment(...)` (one transaction: appointment + `APPTCUSTOMER#`/`APPTDATE#`
  adjacencies + slot-lock + booking-intent)
- `getAppointment`, `listAppointmentsForCustomer`, `listAppointmentsForTenant`
- `cancelAppointment(...)` (releases the slot lock)
- resource/service/availability config reads/writes
- enforces "no scans, always projection"; table via `APPOINTMENTS_TABLE_NAME`

The kernel does not import this module; this module calls the kernel for slot/overlap
decisions, then enforces concurrency at write time.

### Feature implementation

Backend handlers (customer renderer-proxied + admin) and any future reminder worker use
`appointments-db.ts`. Renderer and admin code never import it; they call API routes.

## Rollout Plan (kernel-first slices)

Production sensitivity is low: appointments is a new domain with no existing data, the
table is new, and the flag defaults off. Deploy risk is ordinary shared-fleet deploy
risk, not data migration.

### Slice S1 — Pure domain kernel (no AWS)

- Shared Zod schemas/types in `packages/shared`: resources, services (eligibility),
  availability rules, appointment, status; `appointmentsEnabled` on `TenantConfig`.
- Kernel logic: slot generation, overlap detection, status transitions — pure, injected
  clock + timezone.
- Tests: DST boundaries, multi-resource eligibility, overlap, cancellation window.
- Deploy: shared/backend build only; no runtime behavior, no migration.

### Slice S2 — Infra: empty appointments-private table + flag

- New DynamoDB table (PAY_PER_REQUEST, PITR), keys above; renderer gets **no** IAM.
- Wire `APPOINTMENTS_TABLE_NAME` into the relevant backend Lambdas.
- `appointmentsEnabled` default false.
- Deploy: one CDK deploy; inert table; no migration.
- (Table before persistence: S3 writes to it and tests concurrency against it.)

### Slice S3 — Persistence support module + concurrency enforcement

- `appointments-db.ts` create path: slot-lock item (`SLOT#<resourceId>#<startIso>`, UTC
  instant) + booking-intent idempotency + `TransactWriteCommand`; "any available" uses
  the two-step discover-then-conditionally-lock model (see Capacity section).
- Tests against the now-existing staging table: concurrent double-book attempt → exactly
  one wins; duplicate booking-intent → one appointment.
- Deploy: backend build; still gated off; no migration.

### Slice S4 — Backend handlers (customer renderer-proxied + admin)

- Customer: `POST/GET/DELETE /appointments` with `requireRole(["RENDERER"])`,
  host-derived tenant, session email.
- Admin: list/detail/status + resource/service/availability config with the existing
  admin role constants (`GLOBAL_ADMIN` passes via policy; do not invent roles).
- Customer handlers check `appointmentsEnabled` and reject when disabled. Admin
  config/toggle handlers remain usable while disabled. Admin operational handlers may be
  hidden, read-only, or reject mutations when disabled.
- Deploy: CDK routes (likely a new `api-appointments.ts` NestedStack, given the
  CloudFormation resource-count history). Enabled on one staging tenant only.

### Slice S5 — Tenant toggle, admin config UI, renderer booking UI

- Admin: "Appointments / Scheduling" section (independent of `commerceEnabled`) — define
  resources, services (+eligibility), availability rules; toggle the flag. The toggle is
  exposed independently and config can be prepared while `appointmentsEnabled` is `false`.
- Renderer: booking widget/pages (require sign-in; renderer-proxied calls); appear only
  when enabled.
- Deploy: admin + renderer build; one staging tenant.

### Slice S6 — Notifications & audit

- `publishAudit()` on lifecycle events; optional SES templates.
- Deploy: backend build.

### Slice S7 — Validation

For a staging tenant:

- Booking requires sign-in.
- A customer of tenant A cannot read/cancel tenant B's appointments.
- The renderer Lambda IAM role has no permission on the appointments-private table.
- Disabling the flag removes all scheduling UX and backend rejects calls.
- Concurrency: simultaneous bookings of the last slot for a resource → exactly one wins.

## Assumptions and Technical Debt

- Customer identity is tenant-local (PD-001); email (normalized) is the cross-system
  identifier, matching commerce.
- Phase-1 customer access is renderer-proxied (PD-002); the dormant `CUSTOMER` authorizer
  branch (PD-003) is reserved for a future direct-JWT path.
- Appointment volume is assumed small relative to commerce; table cost impact is low.
- Deferred work:
  - Calendar sync (Google/Outlook).
  - Per-service numeric pooled capacity (the "configurable per service" option).
  - Advanced workflow (multi-step approval, dependencies).
  - Hardening other non-commerce private families into their own tables.
- Any prototyping that temporarily stores appointment records in the main table must be
  documented and migrated to the appointments-private table before go-live (mirror the
  commerce-private migration discipline).

## Open Items (resolve during implementation)

- Scheduling **config** placement: RESOLVED — resources/services/availability live in the
  appointments-private table; the renderer gets only public-safe derived availability DTOs
  via backend routes (see Architectural Boundary).
- Reschedule semantics: cancel+create (new appointment + slot lock, old released) vs
  in-place mutation. Default to cancel+create for a clean status history and simpler slot
  accounting unless a reason emerges otherwise.
- Timezone source: tenant-level default vs per-resource vs per-customer display. Kernel
  takes an explicit timezone; the source of that value is a config decision.
- Slot granularity / start alignment (e.g. 15-min grid vs service-duration grid) for slot
  generation.
