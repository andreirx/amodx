# Courses with group sessions, and what two new client sites need — DRAFT PLAN

Written 2026-11-20. Status: **draft, not ratified**. Clients named by the human: **galeriilevoicu.ro** (a
jewellery school: courses, workshops, vouchers; Romanian and English) and **satulbanului** (a guesthouse; four
languages; plan in `docs/plan-site-move-satulbanului.md`).

Evidence basis: one read-only pass over the sources on 2026-11-20 (`main` at `ba1c576`), five facts re-checked
by the operator. A builder reads each `file:line` again. Nothing was run on staging or production.

## 1. Rulings and directions of the human (2026-11-20)

- Multi-language sites are mandatory: both clients need them. LANG1-SCOPE = A (`docs/slices/lang-1.md`).
- The commerce-private table (Track B, `cmrc-1`…`6`) is mandatory: the school brings real customers and money.
- The guesthouse's room booking is done by an existing external booking service that the site integrates
  (`docs/slices/booking-embed-1.md`). `stay-1` part B (stays in the scheduling kernel) is withdrawn.
- The school's scheduling is new work: `docs/slices/sched-1.md`.

## 2. What the school's booking is

A **seat in a group**, not a timed appointment:

- A **run** is one course on a fixed list of meetings (day 1, day 2, a pause, day 4; or three days in a row; or
  one workshop of 2–3 hours). A run has a capacity and one trainer or more.
- A person enrols in the whole run. A person can also pay first and have no run yet.
- The system proposes the partly filled run first; other runs are shown only on request.
- A run's language is not known at first; then it is Romanian or English.
- The admin moves one person to another run, or moves a whole run to another day; the system mails the people.
- People come from other channels too; the admin enters them by hand.

## 3. Effect on Track D (`docs/plan-appointments-private-table-extension.md`)

The ratified plan models one appointment on one named resource and defers "numeric pooled capacity" — the
school's case. No named client needs the timed appointment today. Proposal, to be ratified through `sched-1`
(a specification slice with a decision review):

- Track D gets the **seat** shape first. `appt-1`…`appt-7` stay PLANNED and unscheduled until a client is named.
- What `course-*` takes from the plan unchanged: a private table the renderer cannot read; renderer-proxied
  customer routes (PD-002); tenant-local identity by normalized email (PD-001); a tenant switch, default off;
  the booking-intent item against double submits; customer and date adjacency items; audit on every transition.
- What differs: the guard at write time is a conditional seat counter on the run, not a lock item per instant;
  meetings are local dates and times of the tenant's timezone, stored with the timezone, converted to instants
  only for the calendar feed and reminders.
- The roadmap row "EVT" (events: capacity, attendees, waitlist) is this track; it is not a later one.

## 4. Requirement → slice

| Requirement of the school | Slice | Exists today |
|---|---|---|
| Runs, capacity, proposal, language, moves, roster, calendar | `sched-1` (spec) → `sched-1a`…`1i` | nothing |
| Contract signed on the page; parent for a minor | `contract-1` | customer `birthday` field only |
| Pay by transfer or online; "paid" is a real state | `pay-1` (paid transition + event), `pay-2` (online card payment) | bank transfer as a method; nothing sets `paid` |
| SmartBill invoice | `invoice-1` | nothing |
| Promotions; voucher with QR code | `coupon-fix-1`, `voucher-1` | coupons, with three defects |
| Loyalty by amount spent | `loyalty-1` | 1 point per currency unit, shown on the account page |
| Sign in with Google or email | Google exists; email = Track C (`auth-1`…`7`) | Google only |
| People entered by hand get access | `sched-1f` (manual entry; the person gets the booking's emailed link) | — |
| Google Ads tags, analytics | `tags-1` | GA4 page views, Umami, Plausible, Facebook pixel |
| Newsletter signup and campaigns | `newsletter-1` (MailerLite) | a popup type that collects nothing |
| Landing pages for ads | `landing-1` | `hideNav` / `hideFooter` by CSS, two bars stay |
| Keep the WordPress addresses | `import-paths-1`, `redirect-1` | importers that flatten addresses |
| Two languages | `lang-1` → `lang-1a`…`1d` | one language per site |
| Reviews on course pages; popups | none | built |
| Photo galleries | `gallery-1` | nothing |
| WhatsApp group per run | an invite link stored on the run (`sched-1f`, sent by `sched-1g`) | — |

## 5. Dependencies

```
next-patch-1 ──► every staging deploy (operator)          public-harden-1 closes on that deploy

Wave 1 — no dependency, useful to every tenant
  gallery-1   redirect-1   landing-1   tags-1   coupon-fix-1   newsletter-1   import-paths-1   booking-embed-1
  wp-export-1 (independent; not scheduled)

Wave 2 — lines in parallel
  lang-1 (spike, spec) ─► lang-1a ─► lang-1b ─► lang-1c ─► lang-1d
  cmrc-1 ─► cmrc-2 ─► cmrc-3 ─► cmrc-4 ─► cmrc-5 ─► cmrc-6          (Track B)
  sched-1 (spec) ─► sched-1a kernel ─► sched-1b table ─► sched-1c persistence ─► sched-1d visitor routes
  pay-1 ─► pay-2
       └─► invoice-1
  auth-1 … auth-7 (Track C; email sign-in — no longer needed for booking)

Wave 3 — joins
  sched-1e (appointments: admin)        needs  sched-1d
  sched-1f (groups: admin, roster)      needs  sched-1d
  sched-1g (hosted booking page, mails, reminders, feed)   needs  sched-1d
  sched-frame-1 (the page in a frame on another site)      needs  sched-1g
  contract-1                            needs  sched-1f + sched-1g
  sched-1h (booking from a paid-course order line)         needs  sched-1f + pay-1 + cmrc-4
  sched-1i (validation)                 needs  all sched slices in use
  voucher-1                             needs  coupon-fix-1 + pay-1
  loyalty-1                             needs  cmrc-4

Site launches (operator work, not slices)
  practitioner on WordPress = sched-1a…1e + 1g + sched-frame-1        (no Track B, no languages, no payment)
  satulbanului   = gallery-1 + redirect-1 + lang-1a…1d + booking-embed-1 + an import script
  galeriilevoicu = lang-1a…1c + import-paths-1 + redirect-1 + Track B + pay-1/2 + invoice-1
                   + sched-1a…1d, 1f, 1g, 1h + contract-1 + tags-1 + newsletter-1 + landing-1
                   ; then voucher-1, loyalty-1, Track C
```

Why `sched-1h` waits for `cmrc-4`: it reads the order that paid for the seat. After `cmrc-4` orders live in the
commerce-private table behind `commerce-db.ts`; built earlier, the read path is written twice. Free bookings and
bookings paid at the practice do not touch orders, so the practitioner line has no commerce dependency.

## 6. Decisions

For the human, each one argued in the slice that owns it and challenged in that slice's decision review:

| Decision | Owner slice | Recommendation |
|---|---|---|
| COURSE-FIRST-SHAPE — amend Track D: seats first, appointments unscheduled | `sched-1` | yes |
| COURSE-TABLE — one scheduling-private table for every booking shape, or a table per shape | `sched-1` | one table |
| COURSE-PAYMENT-PATH — a course is a product bought through the checkout, or scheduling takes payments itself | `sched-1` | the checkout |
| COURSE-CALENDAR — trainers subscribe to a feed from AMODX, or AMODX reads the trainers' Google calendars | `sched-1` | the feed |
| PAY-PROVIDER — which card processor | `pay-2` | Netopia (already named in `docs/TECH-DEBT.md`) |
| NEWSLETTER-SENDER — MailerLite, or campaigns built on SES | `newsletter-1` | MailerLite |
| BOOKING-SERVICE — which external booking service the guesthouse uses | `booking-embed-1` | the client names it |

Shop rules decided by the operator's recommendation and written in the slices (human directive 2026-11-15:
shop policy is decided by recommendation and documented): a seat is held from the moment the order is placed,
paid or not; an unset run language is set by the first enrolment unless the admin set it; loyalty tiers are a
discount by total spent.

## 7. Defects found in this pass (existing code; fixable now)

| Finding | Where | Slice |
|---|---|---|
| `perCustomerLimit` on a coupon is enforced nowhere | schema `packages/shared/src/index.ts:2041-2059`; no reader | `coupon-fix-1` |
| A coupon's product and category limits are checked only in the advisory pre-check, not when the order is written | `backend/src/coupons/public-validate.ts:119-140`; absent in `orders/create.ts` | `coupon-fix-1` |
| Coupon usage is counted without a condition on the limit; two orders at once can pass a limit of 1 | `orders/create.ts:462-473` | `coupon-fix-1` |
| Nothing sets an order to paid except a raw field patch that accepts any text; the admin has no control for it; no event | `orders/update.ts:30-35`; `OrderDetail.tsx:329-330` | `pay-1` |
| The popup type "newsletter" collects no email | `renderer/src/components/PopupManager.tsx:157-172` | `newsletter-1` |
| The Facebook pixel is loaded without the cookie-consent check that `Analytics.tsx:24` applies | `renderer/src/app/[siteId]/layout.tsx:289-291` | `tags-1` |
| `hideNav` leaves the top bar and the commerce bar, and hides every `<nav>` and `<footer>` inside blocks | `SitePage.tsx:704-710` | `landing-1` |
| The digital-download purchase check reads `items` from an item that has none (INFERRED) | `backend/src/resources/presign.ts:39-56`; `orders/create.ts:403-413` | not sliced; verify first |
| PD-003 describes an email sign-in the code does not have (Google only; public pool client without secret) | `docs/platform-decisions.md:168-169`; `infra/lib/auth.ts:106` | Track C (`auth-2`, `auth-3`) |

## 8. Update 2026-11-21 (human)

- A third client needs **individual appointments** (a practitioner). Both shapes are built: `course-1` is
  rewritten as `docs/slices/sched-1.md` (two shapes, one specification). § 3 above is read with that change: the
  base plan's appointment shape is kept and the seat shape is added; neither is deferred.
- **Booking is confirmed by an emailed link, no account.** Email sign-in (Track C) is no longer a precondition
  of booking.
- **Scheduling is also offered to sites that are not on AMODX** through a frame: `docs/slices/sched-frame-1.md`.
  Such a client is a tenant with no domain. A public developer API and metered billing are named follow-ups,
  not drafts.
- **Contracts**: AMODX provides the scaffolding; the text and its lawfulness are the tenant's
  (`docs/slices/contract-1.md`, amendment).
- **Export to WordPress**: `docs/slices/wp-export-1.md`, independent, not scheduled.
- § 6 is read with these changes: COURSE-FIRST-SHAPE is closed (both); the open decisions are SCHED-TABLE,
  SCHED-PAYMENT-PATH, SCHED-CALENDAR, SCHED-PD-AMENDMENT (in `sched-1.md` § 6), PAY-PROVIDER,
  NEWSLETTER-SENDER, BOOKING-SERVICE.
