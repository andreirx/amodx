# STAY-1 — booking a room for a range of nights

> Copied 2026-11-18 from `satulbanului/docs/amodx-slices/stay-1.md` (draft written by the satulbanului session). This copy is the one to edit.
> Not ratified. Its `file:line` evidence comes from one read-only pass on `main` at `3388999`; a builder reads each again.

Status: **PLANNED (draft, not ratified) — two decisions required**. Track: D (Scheduling), with one small
slice outside it. Source plan: `docs/plan-appointments-private-table-extension.md`.

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
