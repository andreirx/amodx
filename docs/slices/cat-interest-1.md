# CAT-INTEREST-1 — "Mă interesează": the shortlist → lead flow (IMPL slice)

Status: **PROPOSED**, blocked on `CATALOG-MODE-1` (D-5) and `CAT-MODE-1`. Track: Glam catalog.

## 1. Purpose

The storefront's only call to action: a visitor marks products as interesting while browsing,
then sends the list with their contact details; the company receives a lead that names the items.
This replaces the cart as the catalog tenant's conversion path — it is deliberately NOT the cart.

## 2. Scope

1. **Shortlist (client-side)**: a "Mă interesează" toggle on product cards and the product page;
   a compact header widget with the count (rendered ONLY under `catalogMode`; mutually exclusive
   with `CartWidget` by the same predicate); persistence in `localStorage` keyed per tenant
   (`amodx:interest:<tenantId>`), with try/catch and honest degradation (no storage → the list
   lives for the page only, and the widget says so once). Items stored as `{productId, title,
   imageLink, addedAt}` — titles captured at add time so the list survives a product rename.
2. **The list page** (`/<interest prefix>`, a new `urlPrefixes.interest`, default `/lista-mea`):
   items (image, title, collection, remove), then the form: name, phone, email (required per
   D-5 a — `Lead.email`), message; "Trimite lista". Copy in business language; no internals.
3. **Public submit route** `POST /public/interest` — the same shape as forms (corrected
   2026-10-27): the browser calls it directly (as `DynamicForm.tsx:56` does for
   `/public/forms/{slug}/submit`), the route is `noAuth` in EngagementApi beside
   `PublicSubmitForm` (`infra/lib/api-engagement.ts:210`), and the handler checks `x-tenant-id`
   against the origin (`verifyTenantFromOrigin`) and reCAPTCHA exactly as
   `forms/public-submit.ts:14-51` does. Added here: size caps (≤ 50 items, message ≤ 2000 chars),
   item ids validated against the tenant's products (unknown ids dropped and reported, never a
   500), and the handler refuses a tenant that is not `catalogMode`. Forms have no per-IP rate
   limit and no honeypot today; adding either is new work, not a copy — only if the spec says so.
4. **The record**: per the ratified CM-D5. NOT `data.items[]` on `LEAD#<email>` as first drafted —
   that record is one per person and three handlers overwrite it with an unconditional `Put`
   (see the spec's CM-D5 evidence); a second list from the same visitor would erase the first. The existing lead-created notification email to
   the tenant (whatever path the forms/leads use today — cite it; if none exists, the email is
   a named follow-up, NOT built here).
5. **Admin leads view**: a lead with items renders them as a list with links to the admin product
   editor; MCP `leads` tools return `data.items` unchanged (they already return `data`).
6. **Post-submit**: confirmation page copy + the shortlist cleared; a "lista trimisă" state that
   does not re-send on refresh (idempotency token per submission in the payload; server dedupes
   within 10 minutes per token).

## 3. Non-scope

Email templates/branding (email-2a's territory); customer accounts; any pricing; analytics beyond
the existing `SIGNAL#` path if the tenant has it enabled (then one signal `interest_submitted`).

## 4. Architectural boundaries

Shortlist state is a thin client module (`renderer/src/lib/interest.ts`, pure functions over a
storage port, tested without a browser); the submit handler validates with a zod schema in
`packages/shared` (`InterestSubmissionSchema`) shared by renderer and backend — one shape, no
drift. CDK: one public route on the engagement/leads group (state the resource delta).

## 5. Definition of Done / evidence

- Unit: shortlist add/remove/dedupe/cap/persist with a failing storage; schema accepts the valid
  payload and refuses oversize/unknown fields.
- Integration: a submission creates exactly one Lead with the items; unknown product ids are
  dropped and reported; the honeypot refuses silently (200, no record); rate limit returns 429;
  the duplicate token within the window creates no second lead.
- Renderer hermetic E2E: browse → mark two items → list page shows them → submit → confirmation;
  a commerce (non-catalog) tenant fixture shows NO interest widget (byte-identity for that
  tenant's header).
- Staging: real submission on the glam tenant → the lead visible in the admin leads view with
  its items (screenshot); the notification email received if the path exists (operator-run).
- Copy inventory (every new string) in the build report. Typecheck + suites bare-green.

## 6. References

`docs/slices/catalog-mode-1.md` D-5; `packages/shared` `LeadSchema`; the forms submission
handler (abuse posture to mirror); `docs/platform-decisions.md` PD-002.
