# COURSE-1 — group sessions: a seat in a course run (SPECIFICATION slice)

Status: **PLANNED (draft 2026-11-20, not ratified) — DECISIONS REQUIRED before any build**. Track: D
(Scheduling), new prefix `course-`. Source plan: `docs/plan-courses-group-sessions.md`; base plan
`docs/plan-appointments-private-table-extension.md`. This slice writes the specification and amends the Track D
plan; it changes no code. Named client: galeriilevoicu.ro.

## 1. The problem

A school sells courses that a group follows together. Today the visitor buys a product, then the date is agreed
on WhatsApp, and the owner keeps the groups in a spreadsheet (name, paid or not, language). Threads get lost,
and every enrolment costs a conversation.

AMODX has no scheduling code. The Track D plan covers one appointment on one named resource and defers pooled
capacity. A course run is pooled capacity with a schedule of several days.

## 2. Domain model (to be reviewed)

```
Course          title, default capacity, default meeting pattern, linked productId
Run             courseId, meetings[], capacity, trainerIds[], language, groupLink, status
  meeting       local date, start time, end time (tenant timezone; a run stores the timezone)
  language      NotSet | Set(ro | en | …)          — a sum type, not a nullable text
  status        Open | Closed | Cancelled | Done
Enrolment       customer (normalized email, name, phone), courseId, source, preferred language, placement
  placement     Unplaced | Placed(runId)           — a sum type
  source        Order(orderId, line) | Manual(adminEmail, channel)
  payment       read from the order for Order; for Manual: PaidElsewhere | Unpaid
```

Only rules the school stated are encoded. No waitlist, no partial attendance, no per-meeting booking.

## 3. Rules (pure, in the kernel)

- **Seats.** A run takes an enrolment when `Placed` count < capacity and the run is `Open`.
- **Proposal.** Among the open runs of the course with a free seat and a compatible language (`NotSet`, or the
  person's language): the run with the most seats taken first; ties go to the earliest first meeting. No run
  with seats taken → the list of runs is shown and the person chooses. The answer is `Proposed(run)` or
  `Choose(runs[])` or `NoneOpen`.
- **Language.** Placing a person with language L into a `NotSet` run sets the run to L, unless the admin set it.
  A person never enters a run of another language through the proposal; the admin may override.
- **Seat hold.** A seat is taken when the order is placed, paid or not (bank transfer takes days). The roster
  shows the payment state. The admin frees a seat. Operator recommendation; shop rule.
- **Move a person.** Target run of the same course with a free seat; the person is mailed old and new dates.
- **Move a run.** New meetings for the whole run; every placed person is mailed; no seat changes.
- **Cancel a run.** Every placed person becomes `Unplaced` and is mailed a new proposal.
- Clock and timezone are passed in; the kernel reads no ambient time.

## 4. Decisions (the human's)

### COURSE-FIRST-SHAPE
The ratified Track D builds appointments first. No named client needs them; two named clients need other shapes.

| Option | Reward | Risk |
|---|---|---|
| A. Amend the plan: seats first; `appt-*` unscheduled until a client is named | every slice serves a paying client | a ratified plan is rewritten before code |
| B. Keep the plan; add seats after `appt-7` | no plan change | seven slices for a case nobody asked for; the school waits |

### COURSE-TABLE
| Option | Reward | Risk |
|---|---|---|
| A. One scheduling-private table for every booking shape (the plan's table, wider meaning) | one boundary, one IAM rule, one backup; a later appointment shape adds key prefixes only | key prefixes of different shapes share a partition; the table's name must not say "appointments" |
| B. A table per shape | hard isolation between shapes | a new CDK table and grants per shape, for data of the same sensitivity |

### COURSE-PAYMENT-PATH
| Option | Reward | Risk |
|---|---|---|
| A. A course is a product (`productType: "course"`); the checkout sells it; the order line creates the enrolment | coupons, vouchers, loyalty, order mails, invoice and online payment apply once | scheduling depends on the order model and on Track B |
| B. Scheduling takes payments itself | no commerce dependency | a second checkout, second invoices, second coupon rules |

`productType` is `physical | digital` today (`packages/shared/src/index.ts:1570`). A third value breaks every
exhaustive match on it; that list is the work list.

### COURSE-CALENDAR
The school asked that the application "read a calendar the trainers have access to".

| Option | Reward | Risk |
|---|---|---|
| A. AMODX holds the runs; trainers and the owner subscribe to a read-only calendar feed | one source of truth; no Google access; small | a trainer cannot block a day from their own calendar; the owner enters it |
| B. AMODX reads the trainers' Google calendars for free days | matches the wording | Google access per trainer, token storage, conflict rules, a second source of truth |

## 5. Build slices after ratification

| Slice | Content | Depends | Proof |
|---|---|---|---|
| `course-1a` | Shared schemas + pure kernel: seats, proposal, language, moves, cancel | — | unit: every rule of § 3, month ends, DST day, capacity edge |
| `course-1b` | Inert scheduling-private table (PAY_PER_REQUEST, PITR; renderer has no IAM) + `coursesEnabled`, default false. CDK gain named: customer data out of the renderer's reach | `1a` | infra assertions; one CDK deploy |
| `course-1c` | `scheduling-db.ts`: enrol = one transaction (enrolment, customer and date adjacency, intent item, conditional seat counter); move; cancel | `1b` | staging: two enrolments for the last seat → exactly one; same intent twice → one |
| `course-1d` | Backend: course and run CRUD, roster, move person, move run, manual enrolment (admin roles); enrolment from a placed order line of a course product; `productType: "course"` | `1c`, `pay-1`, `cmrc-4` | unit + staging per handler; a manual enrolment is reachable by that email's session only |
| `course-1e` | Admin: Courses group — runs by date, roster with payment and language, drag or pick to move, move run, CSV export, WhatsApp link field | `1d` | Playwright on the staging admin |
| `course-1f` | Renderer: proposal ("we propose date X" / "another date"), "My courses" on the account page; mails (enrolled, placed, moved, cancelled) through the per-tenant template pattern of `order-email.ts`; reminder job; calendar feed (secret URL per tenant and per trainer) | `1d` | staging: full path with Google sign-in; feed opens in a calendar client |
| `course-1g` | Validation: tenant isolation, renderer role has no table permission, flag off removes every surface, concurrency | `1e`, `1f` | the list of Track D slice S7, for seats |

Infra with a named gain: `1b` (table), `1d` (routes — a new nested stack, parent stack is at 440 of 500
resources), `1f` (one schedule rule for reminders; pattern `infra/lib/amodx-stack.ts:388-391`).

## 6. Non-scope

Appointments on a named resource. Stays. Waitlists. Tickets with seat numbers. Reading external calendars
(unless COURSE-CALENDAR = B). Adding people to WhatsApp groups by API (a link is stored and sent). Payment,
invoice, contract, vouchers (their own slices).

## 7. Exit criterion of this specification slice

The four decisions answered; § 2 and § 3 reviewed; `docs/plan-appointments-private-table-extension.md` amended by
a dated section; `course-1a`…`1g` registered in `docs/ROADMAP.md`; the prefix registered in
`docs/documentation.md`.
