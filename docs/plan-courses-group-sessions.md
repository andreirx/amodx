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
- The school's scheduling is new work: `docs/slices/course-1.md`.

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
school's case. No named client needs the timed appointment today. Proposal, to be ratified through `course-1`
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
| Runs, capacity, proposal, language, moves, roster, calendar | `course-1` (spec) → `course-1a`…`1g` | nothing |
| Contract signed on the page; parent for a minor | `contract-1` | customer `birthday` field only |
| Pay by transfer or online; "paid" is a real state | `pay-1` (paid transition + event), `pay-2` (online card payment) | bank transfer as a method; nothing sets `paid` |
| SmartBill invoice | `invoice-1` | nothing |
| Promotions; voucher with QR code | `coupon-fix-1`, `voucher-1` | coupons, with three defects |
| Loyalty by amount spent | `loyalty-1` | 1 point per currency unit, shown on the account page |
| Sign in with Google or email | Google exists; email = Track C (`auth-1`…`7`) | Google only |
| People entered by hand get access | `course-1d` (enrolment keyed by email; the person signs in with that email) | — |
| Google Ads tags, analytics | `tags-1` | GA4 page views, Umami, Plausible, Facebook pixel |
| Newsletter signup and campaigns | `newsletter-1` (MailerLite) | a popup type that collects nothing |
| Landing pages for ads | `landing-1` | `hideNav` / `hideFooter` by CSS, two bars stay |
| Keep the WordPress addresses | `import-paths-1`, `redirect-1` | importers that flatten addresses |
| Two languages | `lang-1` → `lang-1a`…`1d` | one language per site |
| Reviews on course pages; popups | none | built |
| Photo galleries | `gallery-1` | nothing |
| WhatsApp group per run | an invite link stored on the run (`course-1f`) | — |

## 5. Dependencies

```
next-patch-1 ──► every staging deploy (operator)          public-harden-1 closes on that deploy

Wave 1 — no dependency, useful to every tenant
  gallery-1   redirect-1   landing-1   tags-1   coupon-fix-1   newsletter-1   import-paths-1   booking-embed-1

Wave 2 — three lines in parallel
  lang-1 (spike, spec) ─► lang-1a ─► lang-1b ─► lang-1c ─► lang-1d
  cmrc-1 ─► cmrc-2 ─► cmrc-3 ─► cmrc-4 ─► cmrc-5 ─► cmrc-6          (Track B)
  course-1 (spec) ─► course-1a kernel ─► course-1b table ─► course-1c persistence
  pay-1 ─► pay-2
       └─► invoice-1
  auth-1 … auth-7 (Track C; email sign-in)

Wave 3 — joins
  course-1d (enrolment from an order, admin routes)   needs  course-1c + pay-1 + cmrc-4
  course-1e (admin screens)                           needs  course-1d
  course-1f (customer pages, mails, feed, reminders)  needs  course-1d   (email sign-in needs Track C)
  course-1g (validation)                              needs  course-1e + course-1f
  contract-1                                          needs  course-1d
  voucher-1                                           needs  coupon-fix-1 + pay-1
  loyalty-1                                           needs  cmrc-4 (the customer record moves in Track B)

Site launches (operator work, not slices)
  satulbanului   = gallery-1 + redirect-1 + lang-1a…1d + booking-embed-1 + an import script
  galeriilevoicu = lang-1a…1c + import-paths-1 + redirect-1 + Track B + pay-1/2 + invoice-1 + course-1a…1g
                   + contract-1 + tags-1 + newsletter-1 + landing-1 ; then voucher-1, loyalty-1, Track C
```

Why `course-1d` waits for `cmrc-4`: it reads the order that paid for the seat. After `cmrc-4` orders live in
the commerce-private table behind `commerce-db.ts`; built earlier, the read path is written twice.

## 6. Decisions

For the human, each one argued in the slice that owns it and challenged in that slice's decision review:

| Decision | Owner slice | Recommendation |
|---|---|---|
| COURSE-FIRST-SHAPE — amend Track D: seats first, appointments unscheduled | `course-1` | yes |
| COURSE-TABLE — one scheduling-private table for every booking shape, or a table per shape | `course-1` | one table |
| COURSE-PAYMENT-PATH — a course is a product bought through the checkout, or scheduling takes payments itself | `course-1` | the checkout |
| COURSE-CALENDAR — trainers subscribe to a feed from AMODX, or AMODX reads the trainers' Google calendars | `course-1` | the feed |
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
