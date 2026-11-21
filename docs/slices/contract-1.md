# CONTRACT-1 — a contract is accepted on the site before the course

Status: **PLANNED (draft 2026-11-20, not ratified)**. Track: D (Scheduling). Depends: `sched-1f`, `sched-1g`.

## Purpose

The school sends a contract that must be signed before the course; a participant under 18 needs a parent's
signature. Today this is paper or a mail thread. The school asked for a simple electronic signature on the page,
"like the terms and conditions tick".

**Legal note.** If a ticked box with a typed name is enough for this contract, and what a parent's acceptance
must contain, is a question for the school's lawyer. This slice records who accepted what and when; it does not
claim a legal effect. Verify the legal text at specification time; do not write it from memory.

## Scope

1. Course setting: contract text (rich text, per language of the site) and "contract required". Each saved
   text is a version with a content hash; an accepted contract points at the exact version.
2. Enrolment gains `contract`: `NotRequired | Pending | Accepted(record)` — a sum type. The record: version
   hash, signer full name as typed, signer role `Participant | Guardian(participant name)`, time, the session
   email, IP address and user agent.
3. Minor: the enrolment step asks the participant's date of birth (the customer record has `birthday`,
   `packages/shared/src/index.ts:1773`). Under 18 on the first meeting's date → the acceptance form asks the
   guardian's name and the guardian ticks. The age rule is a pure function with the date passed in.
4. Page: signed-in customer only (renderer-proxied, PD-002), reachable from the confirmation mail and from
   "My courses"; shows the text, the tick, the name field. After acceptance: a read-only copy with the record.
5. Mails: "please accept the contract" in the enrolment mail; a reminder N days before the first meeting while
   `Pending` (the reminder job of `sched-1g`); a copy of the accepted text to the customer and the owner.
6. Admin roster: contract state per person; the record is viewable; the admin can mark "signed on paper" with a
   note (actor recorded).
7. The record is stored in the scheduling-private table. It is never rewritten: a new acceptance is a new
   record.

## Evidence taxonomy

Contract not required → no step, no mail line. Pending → the page shows the current version. Text changed after
acceptance → the accepted record still shows the old version; state stays `Accepted`. Under 18 without a
guardian name → refused. Exactly 18 on the first meeting's date → participant signs. Another customer's
enrolment → 404. Not signed in → sign-in first.

## Non-scope

Qualified or advanced electronic signatures; a third-party signing service; drawn signatures; blocking
attendance by software (the roster shows the state; the owner decides).

## Exit criterion

On staging a signed-in participant accepts the contract for an enrolment, the owner sees the record, and a
participant marked under 18 cannot accept without a guardian.

## Amendment 2026-11-21 (human)

- **Responsibility.** AMODX provides the scaffolding: a place for the tenant's text, the acceptance step and
  the record. The contract text, and whether this form of acceptance is enough for it, are the tenant's
  responsibility. The "Legal note" above is replaced by this statement; the admin screen says it next to the
  text field. No lawyer's confirmation is a precondition of the slice.
- **Access.** Scope item 4 said "signed-in customer only". Booking is by emailed link (`sched-1.md` § 1): the
  contract page opens with the booking's token; the record stores the booking's email in place of a session
  email. A signed-in customer reaches the same page from the account page.
- **Use.** The step is available to both booking shapes (a practitioner's intake consent, a course contract).
