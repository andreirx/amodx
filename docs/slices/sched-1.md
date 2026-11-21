# SCHED-1 — scheduling with two booking shapes: a slot with a practitioner, a seat in a group (SPECIFICATION slice)

Status: **PLANNED (draft, not ratified) — DECISIONS REQUIRED before any build**. Track: D (Scheduling), prefix
`sched-`. Written 2026-11-20 as `course-1` (seats only); rewritten 2026-11-21 after the human's directions of
that day (§ 1). Source plan: `docs/plan-courses-group-sessions.md`; base plan
`docs/plan-appointments-private-table-extension.md` (ratified; this slice amends it). This slice writes the
specification; it changes no code.

Named clients: galeriilevoicu.ro (courses and workshops in groups) and a practitioner client (individual
appointments, "like a dentist or a psychologist") named by the human on 2026-11-21.

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
- AMODX has no scheduling code. The base plan specifies the first shape only and defers pooled capacity.

## 3. Domain model (to be reviewed)

Two shapes, both closed → a sum type with exhaustive matches. Adding a third shape later breaks every match on
purpose.

```
Offer        = Appointment(service)          | Group(course)
Booking.what = Slot(resourceId, startInstant, durationMin)
             | Seat(runId)
             | Unplaced(courseId)            — paid or entered, no run yet (groups only)

Appointment side (the base plan, unchanged): Resource, Service(duration, eligible resources), AvailabilityRule
Group side:   Course(default capacity, linked productId)
              Run(courseId, meetings[], capacity, trainerIds[], language, groupLink, status)
                meeting   local date, start, end, in the run's stored timezone
                language  NotSet | Set(tag)
                status    Open | Closed | Cancelled | Done

Booking.state = Held(expiresAt) | Confirmed | Cancelled(by, at) | Completed
Booking.who   = normalized email, name, phone, preferred language
Booking.source = Visitor | Order(orderId, line) | Manual(adminEmail, channel)
```

Only stated rules are encoded. No waitlist, no per-meeting booking, no recurring appointment series.

## 4. Rules (pure kernel; clock and timezone passed in)

Common:
- **Hold, then confirm.** A booking by a visitor starts `Held` and takes its slot or seat at once. The emailed
  link confirms it. A hold not confirmed in time (tenant setting, default 30 minutes) no longer counts; the
  count rule treats an expired hold as free, so correctness does not depend on a cleanup job.
- **The link is the identity.** One random token per booking, stored as a hash. The link confirms, and later
  shows, cancels or moves that one booking inside the tenant's window. It gives no access to any other booking.
- A booking that came from a placed order (`Order`) or from the admin (`Manual`) starts `Confirmed`; its mail
  carries the same kind of link.

Appointment shape: slot generation, overlap, eligibility and the UTC time invariant exactly as the base plan.

Group shape:
- **Seats.** A run takes a booking when (confirmed + unexpired held) < capacity and the run is `Open`.
- **Proposal.** Among open runs of the course with a free seat and a compatible language (`NotSet` or the
  person's): most seats taken first, then earliest first meeting → `Proposed(run)`. No run has a seat taken →
  `Choose(runs[])`. None open → `NoneOpen` (the person stays `Unplaced`).
- **Language.** A person with language L placed in a `NotSet` run sets it to L unless the admin set it. The
  proposal never crosses languages; the admin may.
- **Seat for an order.** A seat is taken when the order is placed, paid or not; the roster shows the payment
  state; the admin frees it. (Operator recommendation; a shop rule.)
- **Move a person; move a run; cancel a run** (people become `Unplaced` and get a new proposal). Each mails the
  people it changed.

## 5. Guards at write time (persistence, not kernel)

| Shape | Guard |
|---|---|
| Slot | the base plan's lock item `SLOT#<resourceId>#<startIso>` with `attribute_not_exists`; a held lock carries `expiresAt` and may be replaced when expired |
| Seat | a conditional counter on the run, in the same transaction as the booking |

Both: the booking-intent item against double submits; customer and date adjacency items; no scans.

## 6. Decisions

### Settled by the human (recorded here, challenged only for consequences)
- SCHED-IDENTITY = emailed link, no account (2026-11-21).
- SCHED-SHAPES = both shapes (2026-11-21). The order of the two build lines is by client date.

### Open (the human's; argued here, then the decision review)

**SCHED-TABLE**

| Option | Reward | Risk |
|---|---|---|
| A. One scheduling-private table for both shapes (the base plan's table) | one boundary, one IAM rule, one backup | key prefixes of two shapes share a partition |
| B. A table per shape | hard isolation | two CDK tables and grant sets for data of the same sensitivity |

**SCHED-PAYMENT-PATH** (a paid booking)

| Option | Reward | Risk |
|---|---|---|
| A. A course is a product (`productType: "course"`, today `physical \| digital`, `packages/shared/src/index.ts:1570`); the checkout sells it; the order line creates the booking | coupons, vouchers, loyalty, order mails, invoice, online payment apply once | paid group bookings depend on the order model and on Track B; a site that is not on AMODX reaches the checkout as a full page of the tenant's AMODX address, not inside the frame |
| B. Scheduling takes payments itself | no commerce dependency | a second checkout, invoices and coupon rules |

Free bookings and "pay at the practice" need neither: the frame alone completes them.

**SCHED-CALENDAR**

| Option | Reward | Risk |
|---|---|---|
| A. AMODX holds the schedule; practitioners and trainers subscribe to a read-only calendar feed | one source of truth; small | a busy time in a private calendar must be entered in AMODX as a closed time |
| B. AMODX reads the practitioners' Google calendars for busy times | double bookings with private events are avoided without typing | Google access per person, token storage, a second source of truth. A practitioner with a full private calendar may need this; ask that client |

**SCHED-PD-AMENDMENT**
The emailed link changes PD-002's list ("appointment booking / list / cancel" by session,
`docs/platform-decisions.md:153-154`). Proposed wording: the browser still talks only to the renderer; the
renderer still calls the backend with the `RENDERER` role; the proof of the customer is a booking token in
place of a session. No backend route becomes anonymous.

## 7. Build slices after ratification

| Slice | Content | Depends |
|---|---|---|
| `sched-1a` | Shared schemas + pure kernel, both shapes, hold and token rules | — |
| `sched-1b` | Inert scheduling-private table (PAY_PER_REQUEST, PITR; no renderer IAM) + `schedulingEnabled`, default false. CDK gain: customer data out of the renderer's reach | `1a` |
| `sched-1c` | `scheduling-db.ts`: hold, confirm, cancel, move for both guards | `1b` |
| `sched-1d` | Backend, visitor side (RENDERER role): free times and runs as derived DTOs, hold, confirm by token, show / cancel / move by token; limits per email and per address (pattern `EMAILLIMIT#`, `backend/src/orders/create.ts:480`); reCAPTCHA | `1c` |
| `sched-1e` | Backend + admin, appointments: resources, services, availability, day and week view, closed times | `1d` |
| `sched-1f` | Backend + admin, groups: courses, runs, roster with payment and language, move person, move run, manual entry, CSV export, group link | `1d` |
| `sched-1g` | The hosted booking page (both shapes), mails through the per-tenant template pattern (`backend/src/lib/order-email.ts`), reminder job, calendar feed | `1d` |
| `sched-1h` | Booking from an order line of a course product (if SCHED-PAYMENT-PATH = A) | `1f`, `pay-1`, `cmrc-4` |
| `sched-1i` | Validation: tenant isolation, renderer role has no table permission, flag off removes every surface, last slot and last seat under load, expired hold, token of one booking refused for another | all |

`sched-1e` and `sched-1f` are independent; the first client decides which is built first. Infra with a named
gain: `1b` (table), `1d` (routes in a new nested stack; the parent stack is at 440 of 500 resources), `1g` (one
schedule rule for reminders; pattern `infra/lib/amodx-stack.ts:388-391`).

## 8. Non-scope

Stays in a guesthouse (`booking-embed-1`). Waitlists. Recurring series. A public developer API and metered
billing (`sched-frame-1.md` § Non-scope). Adding people to WhatsApp groups by API. Payment, invoice, contract,
vouchers (their own slices).

## 9. Exit criterion of this specification slice

The four open decisions answered; §§ 3–5 reviewed; the base plan and `docs/platform-decisions.md` amended by
dated sections; `sched-1a`…`1i` registered in `docs/ROADMAP.md` in place of `appt-1`…`7`; the prefix registered
in `docs/documentation.md`.
