# CAT-INTEREST-1 — "Mă interesează": the shortlist → interest-list submission (IMPL slice)

Status: **READY 2026-10-28** — `CATALOG-MODE-1` ratified and committed (`163c777`): CM-D5 = (b) a system-form
submission per list; § 3.5 is the contract, § 8.5 "cat-interest-1" the list of needs. Depends on `cat-mode-1` (the
variant presenter exposes the selected option; catalog mode at creation). Track: Glam catalog.

## 1. Purpose

The storefront's only call to action: a visitor marks products (and, when shown, the variant option) as interesting
while browsing, then sends the list with their contact details; the company receives one record per list, never
overwritten, and a notification. This replaces the cart as the catalog tenant's conversion path — deliberately NOT
the cart, and NOT a Lead (`LEAD#<email>` is one record per person, overwritten by three writers; a second list would
erase the first — the spec's CM-D5 evidence).

## 2. Scope (spec § 3.5)

1. **Shortlist (client-side).** A "Mă interesează" toggle on product cards and the product page; a compact header
   widget with the count (rendered ONLY under `catalogMode`; mutually exclusive with `CartWidget` by the same
   predicate); `localStorage` keyed per tenant (`amodx:interest:<tenantId>`), try/catch, honest degradation (no
   storage → the list lives for the page and the widget says so once). Items are SNAPSHOTS
   `{ productId, title, slug, imageLink, optionValue?, addedAt }` — the option chosen in the variant presenter (not in
   `ProductImageGallery`, whose selection is private). Cap 50. Identity of an item = `(productId, optionValue)`.
2. **Expired items (C8-3 = A).** On render, an id the catalogue no longer has (a re-import renews ids) is shown as
   expired and must be reselected; never rebound by slug or any locator. A submission carries only items that resolved.
3. **The list page** (`/<interest prefix>`, a new `urlPrefixes.interest`, default `/lista-mea`): items (image,
   title, option, collection, remove), then the form: name, phone, email (required — the reply channel), message;
   "Trimite lista". Copy in business language; no internals.
4. **Public submit route** `POST /public/interest` — the forms shape: the browser calls it directly (as
   `DynamicForm.tsx` does for `/public/forms/{slug}/submit`), `noAuth` in EngagementApi beside `PublicSubmitForm`
   (`infra/lib/api-engagement.ts`), `verifyTenantFromOrigin` + reCAPTCHA exactly as `forms/public-submit.ts` does.
   Added here: the tenant record read with `ConsistentRead: true` (404 if missing, 403 if not `catalogMode`); size
   caps (≤ 50 items, message ≤ 2000 chars); items deduplicated by `(productId, optionValue)` and only the FETCH keys
   by `productId`; validation by a chunked `BatchGet` (≤ 100 keys, projection `id, title, slug, status, imageLink,
   variants`, `UnprocessedKeys` retried ≤ 3, then 503 WITHOUT writing); unknown ids only after a complete read →
   dropped and reported; an item whose chosen option the product no longer has → dropped with reason
   `option-not-found`, never turned into plain product interest (C10-2); the server records title, slug, option and
   image ITSELF from the read, not from the client. Idempotency: a token in the payload, deduplicated by token hash
   (no time window). No per-IP rate limit and no honeypot (forms have none; adding either is new work — the § 5 rows
   for them are removed unless the human asks).
5. **The record (CM-D5 = b).** A submission of the reserved system form `interest-list` (fixed id, no slug, the
   item shape in § 3.5): `SK FORMSUB#interest-list#<submissionId>`, one per list, with the existing submission
   fields the submissions page and route read. Protection: `forms/update.ts` and `forms/delete.ts` refuse it (409 —
   an update would otherwise write a `FORMSLUG#undefined` pointer), `forms/list.ts` omits it, the editor cannot
   open it (it requires a slug). Created on first submission if absent.
6. **Notification.** The existing submission notification path, recipient = `integrations.contactEmail`, no
   platform fallback (if the tenant has no address, the record is stored and the report says the notification was
   not sent).
7. **Admin.** The submissions page renders the items as a list with links to the product editor; a sidebar entry
   "Liste de interes" and the back-button fix the spec names. MCP: no new tool; `glamCRM` reading these records is a
   NAMED FOLLOW-UP (`interest:read` scope — not in `SERVICE_ROUTE_SCOPES`, say so).
8. **Post-submit.** Confirmation page copy; the shortlist cleared; a "lista trimisă" state that does not re-send on
   refresh (the token).

## 3. Non-scope

Email templates/branding; customer accounts; any pricing; a follow-up status inside amodx (follow-up lives in
glamCRM); rate limit / honeypot (new work, only on request); analytics beyond the existing `SIGNAL#` path if enabled
(then one signal `interest_submitted`).

## 4. Architectural boundaries

Shortlist state is a thin client module (`renderer/src/lib/interest.ts`, pure functions over a storage port, tested
without a browser); the submit handler validates with a zod schema in `packages/shared` (`InterestSubmissionSchema`)
shared by renderer and backend — one shape, no drift. The record reuses the form-submission shape and its readers —
no new record type. CDK: one public route on the engagement group (state the resource delta).

## 5. Definition of Done / evidence

- Unit: shortlist add/remove/dedupe-by-pair/cap/persist with a failing storage; expiry rendering; schema accepts the
  valid payload and refuses oversize/unknown fields; server dedupe `(p, red), (p, blue), (p, red)` → two items, one
  fetch key; `option-not-found` dropped; unprocessed keys retried then 503 with no write; system-form protections
  (update 409, delete 409, list omits).
- Integration: a submission creates exactly one `FORMSUB#interest-list#…` record with the items (server-captured
  titles); unknown ids dropped and reported; the duplicate token creates no second record; the notification sent
  to `integrations.contactEmail`, or reported absent.
- Renderer hermetic E2E: browse → mark two items (one with an option) → list page shows them → submit →
  confirmation; a commerce tenant fixture shows NO interest widget (byte identity for that tenant's header).
- Staging: real submission on the catalog tenant → the record visible in the admin submissions view with its items
  (screenshot); the notification received (operator-run).
- Copy inventory (every new string) in the build report. Typecheck + `npm run test:unit` bare-green; synth delta stated.

## 6. References

`docs/slices/catalog-mode-1.md` § 3.5, § 4 (CM-D5), § 8.5; `backend/src/forms/{public-submit,update,delete,list,submissions}.ts`;
`admin/src/pages/FormSubmissions.tsx`; `renderer/src/components/DynamicForm.tsx`; `docs/platform-decisions.md` PD-002.
