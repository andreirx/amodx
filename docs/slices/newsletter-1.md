# NEWSLETTER-1 — a newsletter signup that stores the address and sends it to MailerLite

Status: **PLANNED (draft 2026-11-20, not ratified) — DECISION NEWSLETTER-SENDER**. Track: growth. Depends: none.

## The problem

- The popup type `newsletter` (`packages/shared/src/index.ts:2333`) shows a headline, text and a link button. It
  has no field and stores nothing (`renderer/src/components/PopupManager.tsx:157-172`). **The name says more
  than the popup does.**
- Addresses are collected only by the lead-magnet block: `LeadMagnetRender.tsx:49` → renderer `/api/leads` →
  `POST /leads` → item `LEAD#<email>` (`backend/src/leads/create.ts:62-74`).
- Nothing sends a campaign. No third-party push exists; `integrations.mailerlite` is an unused boolean
  (`index.ts:581`). Leads leave the system as a CSV download (`admin/src/pages/Leads.tsx:41-57`).

## Decision NEWSLETTER-SENDER (the human's)

| Option | Reward | Risk |
|---|---|---|
| A. MailerLite sends the campaigns; AMODX collects the address and the consent and pushes the subscriber | campaign editor, unsubscribe, bounce and complaint handling exist there; small slice | a third party holds the list; a monthly cost above the free level; the client makes the account |
| B. Campaigns built in AMODX on SES | one system | a campaign editor, lists, unsubscribe, bounce and complaint handling to build; `docs/plan-email-onboarding.md` found one shared sender, no bounce capture, and one reputation for every tenant — a bad list harms every tenant's order mails |

Recommendation: A. SES stays the transport for transactional mail.

## Scope (under A)

1. Popup type `newsletter` and a `newsletter` block: an email field, a consent line (text from the locale
   table), the standard public path (origin check, reCAPTCHA). Stores a lead with `source: "newsletter"`, the
   consent text version and time.
2. Tenant settings: MailerLite API token (redacted on read, `backend/src/tenant/settings.ts:182-196`) and group
   id; the unused boolean is replaced by this object, absent = off.
3. Push: after the lead is stored, the subscriber goes to MailerLite. A failed push never fails the signup; the
   lead keeps `push: Pending | Sent(at) | Failed(reason, at)` and the admin Leads page has "Send again".
4. Checkout and course enrolment: an unticked "send me news" box that uses the same path.
5. Existing popups of type `newsletter` with no field keep working as link popups (no stored popup changes).

## Evidence taxonomy

No settings → the address is stored, no call out. Valid → one subscriber in the group. Same address twice → one
lead, no error shown. MailerLite refuses or times out → signup answers success, `Failed` recorded. Consent box
absent in the request → 400. Foreign origin or failed reCAPTCHA → 403, nothing stored.

## Non-scope

Campaign sending. Double opt-in mail from AMODX (MailerLite's own setting). Other providers (a port when a
second one is named). Unsubscribe sync back to AMODX (follow-up).

## Exit criterion

A signup on staging appears in a MailerLite test group with the consent recorded on the lead.
