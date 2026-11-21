# SCHED-FRAME-1 — the booking page inside a frame on a site that is not on AMODX

Status: **PLANNED (draft 2026-11-21, not ratified)**. Track: D (Scheduling). Depends: `sched-1g` (the hosted
booking page). Direction of the human 2026-11-21: scheduling is built in AMODX and is also offered to sites
elsewhere (WordPress or other) through a frame; access is charged.

## Purpose

A client who keeps a WordPress site can still use AMODX scheduling: the client is an AMODX tenant with no
domain, manages the schedule in the AMODX admin, and the WordPress page shows the booking page in a frame. The
browser inside the frame talks to AMODX only, so every rule of `sched-1` (renderer proxy, token, limits) holds
with no change. Booking by emailed link (`sched-1` § 1) is what makes the frame workable: no sign-in and no
session cookie are needed inside it.

## Scope

1. **Frame mode of the booking page**: a query switch that removes the site chrome and sets a transparent or
   theme background. The page is served under the tenant's AMODX address (its domain, or the platform's preview
   address when it has none).
2. **Who may frame it.** Tenant setting `scheduling.embedOrigins: string[]` (exact origins). The booking page
   answers `Content-Security-Policy: frame-ancestors 'self' <those origins>`; empty list = not frameable
   elsewhere. Fact 2026-11-21: no frame header is set anywhere today (search of `infra/lib/*.ts`, `renderer/src`,
   `renderer/next.config.*` for `frame-ancestors|X-Frame-Options`) — this slice sets the header on the booking
   route only; a header for every page is a separate finding for the human (F-FRAME-ANCESTORS).
3. **Snippet.** The admin shows a copy-paste block: one `<iframe>` and one small script from AMODX that sets the
   frame height from messages of the page (origin checked on both sides, message shape fixed).
4. **Steps that cannot run in a frame** open as a full page of the tenant's AMODX address, with a return link
   to the page that held the frame: a paid course (the checkout), an online card payment (`pay-2`).
5. **Links in mails** (confirm, show, cancel, move) open the hosted page directly, never the client's site.
6. **Language.** The frame address carries the language; the page uses that language pack.
7. **Switch.** `schedulingEnabled` per tenant is the commercial switch: off = the booking page answers "not
   available" and the admin section is read-only.

## Charging (not built in this slice; recorded so that nobody assumes it exists)

There is no billing in AMODX for tenants. The first form is a monthly fee per tenant, invoiced outside the
system, with the switch of item 7 as enforcement. Usage counters (bookings per month per tenant) are cheap to
add to the audit trail when a price by volume is wanted; a metered billing system is not proposed.

## Evidence taxonomy

| Case | Expected |
|---|---|
| page framed from a listed origin | renders; height follows the content |
| page framed from another origin | the browser refuses (the header); nothing is rendered |
| empty origin list | frameable on the tenant's own address only |
| hold and confirm entirely inside the frame, with third-party cookies blocked | works (no cookie is needed) |
| a message to the height script from another origin | ignored |
| tenant with no domain | the frame address is the preview address; mails link to it |
| switch off | "not available" inside the frame; no booking route accepts a write |

## Non-scope

- A WordPress plugin package. A shortcode that prints the snippet is a few lines; it is written when a client's
  developer asks, and it lives outside this repository's deploy units.
- A public developer API (scopes on the service keys of `service-account-1`, outgoing webhooks, versioned
  contract, documentation). Named follow-up `SCHED-API-1`, started when a paying client's developer needs it.
- Metered billing, plans, self-service signup of external tenants.

## Deployment notes

Additive: a tenant without `embedOrigins` and without scheduling sees no change. The header is on one new route.
Staging: a static test page on another origin frames the staging booking page.

## Exit criterion

A plain HTML page on another origin, with the copied snippet, completes a free booking on staging with
third-party cookies blocked, and the same snippet from an origin that is not listed shows nothing.
