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

## 7. Implementation record (builder, 2026-10-30; cycles 2–3 after review-0, the § 8 rulings and review-1)

Start: `main` at `c5e6d9b`, tree clean (OBSERVED). Nothing committed. Evidence labels: EXECUTED (run here), OBSERVED
(read in the repo), INFERRED (reasoned), NOT RUN. Allocation used: the packet's list plus, by § 8
(CAT-INTEREST-ALLOCATION), `renderer/src/app/[siteId]/layout.tsx` and `packages/shared/test/schemas.test.ts` (the
one pinned assertion).

### 7.1 What changed, per item

| § 2 item | Change (file:line) |
|---|---|
| 1 Shortlist | `packages/shared/src/index.ts:1652` `INTEREST_FORM_ID`, `:1662` `InterestSubmissionSchema` (strict at both levels; email normalised, then validated), `:79`/`:91` `urlPrefixes.interest` `/lista-mea`. `renderer/src/lib/interest.ts` (new): pair identity, cap 50, key `amodx:interest:<tenantId>`, failing storage → page-only + one-time notice, the per-list token, `markSent` `:254` (removes the item instances it was sent with). `renderer/src/components/InterestShortlist.tsx` (new): `InterestToggle` `:60` (option bound to the current product `:78,:85`), `InterestWidget` `:122`. Cards: `SitePage.tsx:698` (catalog branch of `ProductCard` only). Product page: `SitePage.tsx:957-958` (presenter and toggle keyed by product), `interestToggleProps` `:764`. Header: `Navbar.tsx:55,166,180`; `app/[siteId]/layout.tsx:193` (conditional spread, catalog only). Showcase block cards: excluded (§ 8), follow-up `CAT-INTEREST-SHOWCASE-1`. |
| 2 Expired items | Identity read `POST /public/interest/resolve` (§ 8 F3): backend `public.ts:315` (`resolve`), `:161` (`resolutionOf`); client `resolveShortlist` `lib/interest.ts:140` (parses the answer with `InterestResolveResponseSchema`, `packages/shared/src/index.ts:1712-1722`), `listRows` `:107` with `RowState` `:98` (available / expired = absent / unavailable / option-gone / unchecked), `sendableItems` `:125`. A failed or incomplete read marks nothing and sends everything for the server to validate. |
| 3 List page | `InterestListPage` `InterestShortlist.tsx:153`, rows `ListItem` `:311` (image, title, live collection `:327`, option, state note, remove); route `SitePage.tsx:228` (catalog only), metadata `:134`. |
| 4 Public route | `backend/src/interest/public.ts` (new; one function, two routes, `switch (event.routeKey)` `:344`). Submit `:200`: origin → reCAPTCHA → schema → mode → **replay** `:227-228` → shared `readProducts` `:109` (chunks ≤ 100, consistent, ≤ 3 retries) → 503 without a write `:233` → `resolvePairs` `:137`. Infra `infra/lib/api-engagement.ts:216-232`. |
| 5 Record | System form fields `public.ts:66-72` (all `FormFieldSchema` types; `items` is `textarea`, § 8 F8); conditional form + record Puts; replay and the lost-race path answer from the stored record (`storedOutcome` `:180`, `:272`); result type `InterestSubmitResult` `packages/shared/src/index.ts:1690`. `forms/update.ts:37`, `forms/delete.ts:28` → 409 before any read/write; `forms/list.ts:32` omits the id. |
| 6 Notification | `public.ts` submit: to `integrations.contactEmail` only, `Reply-To` the visitor; absent → logged warning, record kept, no fallback. |
| 7 Admin, MCP | `admin/src/pages/FormSubmissions.tsx:25` `interestItemRows(formId, fieldId, value)` (only `interest-list` + `items`), `:52` `isMissingSystemForm` (only a 404 of that form), `:42` `submissionsBackTarget`, `:78`, `:158`. `Sidebar.tsx:44,87`. `tools/mcp-server/routes.json:89-90`. No MCP tool: `SERVICE_ROUTE_SCOPES` (`backend/src/auth/policy.ts:15-20`, OBSERVED) holds `GET /products`, `GET /leads` and the two glam import routes — `interest:read` is follow-up `CAT-INTEREST-READ-1`. |
| 8 Post-submit | Confirmation `InterestShortlist.tsx:187`; the completion removes exactly the item instances the list held when sent (`:232`, `:246`); items added meanwhile stay, with the note `:270`; the token is reused by a resend and dropped by any change. |

Docs: `backend/ARCHITECTURE.md` (`interest/public.ts` entry), `docs/authentication-architecture.md` § 5b (reCAPTCHA list
gains `POST /public/interest`; the resolve route has no reCAPTCHA). `docs/caching-architecture.md`: no change (the list
page is an ordinary cacheable page with client-side content — INFERRED; `test:serving` 50/50).

### 7.2 Review findings — what closed each, as a rule

- **F1** stale pinned assertion: `packages/shared/test/schemas.test.ts:128` gains `interest: "/lista-mea"` with the § 8
  comment; the test title now says what it pins ("English, except the catalog-only interest prefix"), and (review-1)
  the describe block's INVARIANT comment states the one ratified catalog-only exception. Class: an object
  extended without its pinning test — closed by searching every test file for `URL_PREFIX_DEFAULTS` (grep over
  `packages backend renderer admin tools infra`, EXECUTED: one file, this one; `renderer/test/unit/site-page-reviews.test.ts:104`
  holds a tenant's stored prefixes as input, not a pin of the defaults).
- **F2** replay depended on the catalogue. Rule: **a token's existing record is the answer** — checked after the
  request checks and before any catalogue read; the lost-race path uses the same reader. Rows: product removed,
  option removed, read failure → 200 `already-recorded` with the stored pairs, 1 record, 1 mail; a NEW list during a
  read failure → 503, nothing written. Mutation (early check disabled) → 2 rows red, restored (EXECUTED).
- **F3/F7** expiry from a non-identity listing; collection missing. Rule: **absence is stated only from a complete
  read by id**; anything else marks nothing. The resolve route (§ 8) shares `readProducts` with the submit;
  collection = live `colecție` attribute. Rows: backend (states, no draft fields, 503, strict body, 403/404),
  renderer lookup → rows → sendable (complete answer; 503, network failure, malformed and incomplete answers → all
  unchecked and all sent), browser E2E (rows 3 and 4).
- **F4** option carried across products. Rule: **the option belongs to the current product** — re-read from the
  presenter on every product change, empty when nothing is checked; SitePage also keys presenter and toggle by
  product. Rows: `renderer/test/unit/interest-toggle.test.ts` (real component, React + jsdom). Mutation (old effect)
  → 2 rows red, restored (EXECUTED).
- **F5** a late response erased a newer list (review-0), and still erased an item removed and added again while the
  request was pending (review-1: the completion identified its items by the pair, which is the list's dedupe key, not
  the identity of an addition). Class: an async completion applied to state that changed after the request started.
  Rule: **a completion removes only the item instances it was sent with** — `markSent(outcome, listAtSend)` with
  `listAtSend = getSnapshot().items` at send; commits never copy an item object, so a later addition of the same pair
  is a different object. Rows: added while pending survives; removed while pending stays removed; removed and added
  again (no option) survives; removed and added again with the same option survives while the other sent pair is
  removed; instances are stable across commits that change no item. Mutation (pair match restored) → the 2 re-add rows
  red, restored (EXECUTED).
- **F9** (review-1) resolve entries were cast to `InterestResolution` unchecked. Class: an untrusted network answer used
  as a domain value without validation. Rule: **an answer becomes a domain value only through the contract's own
  schema** — `InterestResolutionSchema` / `InterestResolveResponseSchema` (zod, shared; the TypeScript types are now
  derived from them, so backend output type and browser check are one definition); any entry that does not parse
  makes the whole answer "no complete resolution" (all rows unchecked, server validates). Rows: unknown status, active
  without its fields, `optionValues` a string, `title` a number, `productId` missing (each with the id coverage
  otherwise complete). Mutation (the old cast) → the row red, restored (EXECUTED).
- **F6** admin hid failures and re-rendered other forms. Rules: **only a 404 of the reserved form means "no
  submissions yet"**; **the item renderer applies only to the reserved form's `items` field**. Rows: 404 → true;
  500 / network / session / other form → error; arrays in ordinary forms and other interest fields → old cell.
- **F8** shared-schema divergence: `items` is `textarea` (an existing `FormFieldSchema` type); no new field type.

### 7.3 Oracles (EXECUTED 2026-10-30, cycle 3, on the final tree after `npm run build` exit 0; last lines)

1. `npm run typecheck` → exit 0 (`> tsc --noEmit`, infra last).
2. `cd backend && npm run test:unit` → exit 0, `Test Files 41 passed (41)`, `Tests 659 passed (659)`; the 30 interest
   rows: `test/unit/interest-submit.test.ts` (18: schema limits and strictness; pair dedupe → one fetch key;
   projection; option-not-found; 503 without write; retry that clears; 404/403; invalid body first; replay before
   any read; recorded result shape; resolve states/collection/no draft fields; resolve 503; resolve strict body +
   403/404; unknown route key) and `test/unit/interest-integration.test.ts` (12: one record with server titles;
   unknown + inactive dropped; same token → 200 `already-recorded`; 3 replay rows + new-list 503; mail to
   `contactEmail`; no `contactEmail`; update/delete 409 with zero commands; list omits).
3. `cd renderer && npm test` → exit 0, `Tests 100 passed (100)` (79 before + `interest.test.ts` 18 +
   `interest-toggle.test.ts` 3). `packages/shared`: `npx vitest run` → `Tests 107 passed (107)` (F1's suite).
4. `cd renderer && npm run test:serving` → exit 0, `# tests 50 / # pass 50 / # fail 0`; `cm1-identity-commerce` 18
   URLs `same`, `cm1-identity-content` 14 `same`, 0 `DIFF`; `git diff --stat -- renderer/test/serving-contract/cm1-byte-identity`
   prints nothing (baseline not re-captured).
5. `cd renderer && npm run test:interest-e2e` → exit 0, `4 passed`: (1) shop card + product page with `140x20` →
   widget 2 → list shows both, collection "Colecția Herringbone", both `available` → submit body = the two pairs
   only, no title/slug/image → confirmation, list empty → reload sends nothing; (2) commerce tenant: no widget, no
   toggle (positive control: catalog home has the widget); (3) complete resolution: available / expired / unavailable
   / option-gone shown, resolve body = distinct ids, submit body = the available pair only, confirmation names the
   items not included; (4) resolve 503: 4 rows `unchecked`, all 4 pairs sent.
6. `cd admin && npm run test:unit` → exit 0, `Tests 65 passed (65)` (11 in `FormSubmissions.test.ts`).
7. `cd tools/mcp-server && npm test` → exit 0, `routes.json: 112 routes`, `# pass 10 / # fail 0`.
8. `cd infra && npm test` → exit 0, `Tests: 61 passed, 61 total`; `(cat-interest-1)`: both keys once in the stack
   tree, in EngagementApi, `AuthorizationType: NONE`, no authorizer, integrating `PublicInterestFunc`, SES statement
   equal to `PublicSubmitFormFunc`'s; synth `EngagementApi=89/14fn`.
9. `git status --porcelain -uall`: only allocated paths (including the two § 8 additions); `git diff --check` exit 0;
   no trailing whitespace in the untracked files (grep, EXECUTED).
10. `cdk diff -c stage=staging`: NOT RUN (operator). Expected delta below.

### 7.4 CDK delta (expected; basis stated)

EngagementApi **+10 deployed resources, 94 → 104; functions 13 → 14**: `PublicInterestFunc` (Function, ServiceRole,
DefaultPolicy, LogGroup) and, per route (`PublicSubmitInterest`, `PublicResolveInterest`), an Integration, a Route
and a Lambda::Permission. Basis: the operator's staging synth before this slice
(`infra/cdk.out/AmodxStackstagingEngagementApi04BA1282.nested.template.json`: 94, of which 13 LogGroups and 1
`CDK::Metadata` — OBSERVED) and this slice's test synth (no LogGroups, no Metadata): 80 before, **89** now (+9
EXECUTED) + 1 LogGroup deployed. Parent stack: no new resource (nested template reference only — INFERRED).
CommerceApi / CatalogApi unchanged (`221/36fn`, `45/15fn`).

### 7.5 Copy inventory (every new string)

Visitor (Romanian): "Mă interesează" · "În lista mea" · "Mă interesează (<opțiune>)" · "Lista are deja 50 de produse.
Scoateți un produs ca să adăugați altul." · "Lista mea" (widget, page title, `<title>`) · aria "Lista mea: N produse" ·
"Lista nu poate fi salvată în acest browser; o păstrăm cât timp pagina rămâne deschisă." · "Am înțeles" · "Lista
este goală. Apăsați „Mă interesează” la produsele care vă plac." · "Vedeți produsele" · "Colecția <colecție>" ·
"Produsul nu mai este în catalog. Alegeți-l din nou din produsele actuale." · "Produsul nu este disponibil momentan
și nu va fi trimis." · "Varianta aleasă nu mai este oferită. Alegeți din nou varianta dorită." · aria "Scoateți
<titlu> din listă" · "Datele dumneavoastră de contact" · "Nume" · "E-mail" · "Telefon" · "Mesaj" · "Trimite lista" ·
"Lista nu are produse disponibile. Alegeți din nou produsele dorite." · "Verificați datele: numele, o adresă de
e-mail validă, telefonul (cel mult 40 de caractere) și mesajul (cel mult 2000 de caractere)." · "Nu am putut
verifica lista acum. Încercați din nou peste câteva momente." · "Produsele din listă nu mai sunt disponibile. Alegeți
din nou produsele dorite." · "Lista nu a putut fi trimisă. Încercați din nou." · "Lista nu a putut fi trimisă.
Verificați conexiunea și încercați din nou." · "Lista a fost trimisă" · "Vă mulțumim! Am primit lista dumneavoastră
și vă vom contacta în curând." · "Aceste produse nu au fost incluse, pentru că nu mai sunt disponibile: …" · "Lista
trimisă anterior a fost primită. Produsele de mai jos nu au fost trimise încă."
Notification (to the tenant): subject "Listă de interes — <nume>"; body "Listă de interes nouă de la <nume>", "Nume:",
"E-mail:", "Telefon:", "Mesaj:" ("—" when empty), "Produse (N):", "- <titlu> — <opțiune> — <URL>", "Trimisă: <ISO>".
System form (admin-visible): name "Listă de interes"; labels "Nume", "E-mail", "Telefon", "Mesaj", "Produse".
Admin: sidebar "Liste de interes"; title fallback "Listă de interes - Submissions"; button "Back".
API errors (English, never shown verbatim to visitors): "Invalid JSON body", "Invalid submission", "Invalid request",
"Site not found", "Interest lists are not available on this site", "The product list could not be checked. Please
try again.", "None of the listed products is available", "Unknown route", "The interest list is a system form and
cannot be edited" / "… cannot be deleted".

### 7.6 Abstractions (one line each)

- `StoragePort` (`lib/interest.ts`) — users: `window.localStorage` and the Map port of `interest.test.ts`; axis:
  storage present / throwing / absent (interface + implementations); rejected: direct `localStorage` (no Node test of
  the failure path; slice § 4 names a storage port).
- `FetchPort` (`lib/interest.ts`) — users: the browser `fetch` (`InterestShortlist.tsx` `browserFetch`) and the fake
  ports of `interest.test.ts`; axis: answer kinds of the resolve call (ok / 503 / network failure / malformed) — a test
  seam for the lookup path without a browser; rejected: calling `fetch` inside the component (testable only in E2E).
- `createShortlistStore` — users: `InterestToggle`, `InterestWidget`, `InterestListPage`; shared state, not a dispatch
  point; rejected: a context in `Providers.tsx` (a new prop for every tenant's layout → byte identity) and
  per-component state (disagreement in page-only mode).
- `RowState` (sum type, `lib/interest.ts:98`) — users: `listRows`, `sendableItems`, `ListItem`; axis: variants fixed
  by the resolve contract, operations growing → exhaustive `switch` on `InterestResolution.status`; rejected: a
  boolean `expired` (it cannot express unavailable / option-gone / unchecked).
- `InterestSubmissionSchema`, `InterestResolveRequestSchema`, `InterestResolveResponseSchema` /
  `InterestResolutionSchema` (types derived), `InterestSubmitResult` (shared) — users: the handler and the list page; axis: the documented browser→API boundary, one shape (slice § 4); rejected:
  validation and types on each side (drift).
- `readProducts` (`public.ts:109`) — users: submit and resolve (§ 8: "one function, two callers"); axis: the
  projection (spec § 3.5's exact list vs `+ attributes`); rejected: two copies of the chunk/retry loop.
- `interestItemRows`, `isMissingSystemForm`, `submissionsBackTarget` (`FormSubmissions.tsx`) — users: the page;
  exported only as a Node test seam; rejected: inline JSX logic.
- Local helpers, not abstractions: `interestPrefix` (2 callers), `interestToggleProps` (1 caller), `ListItem`
  (keeps the row JSX out of the page body).

### 7.7 Decisions taken inside the contract (recorded, not asked)

- Handler renamed `backend/src/interest/public-submit.ts` → `public.ts` and the CDK id `PublicSubmitInterestFunc` →
  `PublicInterestFunc`: the function now serves two routes, so the old names misdescribed it (both new in this
  slice, never deployed — no resource replacement).
- Submit answers: 201 `recorded` (with `dropped`), 200 `already-recorded` (no `dropped`: no validation ran). The
  client derives "not included" from `recorded`, the same for both.
- Unknown `routeKey` → 404 (only the two routes are wired); the switch covers both route constants.
- Resolve uses the submit's rule for "active" (`status === "active"`, no availability-date filter) and the submit's
  option rule (any variant group).
- An `option-gone` row (active product, saved option no longer offered) is a sub-case of § 8's "active" state: the
  server would drop it (`option-not-found`), so it is shown for reselection and not sent.
- `recaptchaToken`: a required key whose value may be `null`; top-level order as the packet; retries 50/100/200 ms;
  `ConsistentRead: true` on every product and record read; back button → history back or `/`.

### 7.8 Follow-ups (named, not built)

- `CAT-INTEREST-READ-1` (`interest:read`), `CAT-INTEREST-SIGNAL-1`, `CAT-INTEREST-SHOWCASE-1` (showcase block cards),
  `CAT-INTEREST-SLUG-GUARD-1` (a catalog content page slugged `lista-mea` would collide with the list page).
- `docs/INTEGRATION_MANUAL.md:15` lacks `/public/interest`; `renderer/ARCHITECTURE.md`, `admin/ARCHITECTURE.md` have no
  entry for the new files — not allocated.
- Admin Settings "URL Prefixes" (`Settings.tsx:1370-1418`) has no `interest` field (not allocated).
- Sidebar active state (`Sidebar.tsx:204`, pre-existing prefix match) also highlights "Forms" on the interest page.
- `forms/submissions.ts` reads one Query page (spec § 3.5 names it). `products/public-list.ts` has the same limit; this
  slice no longer depends on it.
- The lost-race path of the record write (`public.ts:272`) has no dedicated row (two concurrent sends of one token);
  it uses the same reader as the replay rows.

### 7.9 Not determined

- Real SES delivery, real reCAPTCHA and the real origin check (`GSI_Domain`, mocked in the backend tests): the
  operator's staging proofs (§ 5).
- Why the commerce fixture pages never reach network idle in Chromium (seen in cycle 1; not in scope).

## 8. Operator rulings on review-0 (operator, 2026-10-30)

- **CAT-INTEREST-ALLOCATION — approved.** `renderer/src/app/[siteId]/layout.tsx` (the header widget mounts there) and
  `packages/shared/test/schemas.test.ts` join the allocation. The pinned `URL_PREFIX_DEFAULTS` assertion gains
  `interest: "/lista-mea"` with a comment: the one Romanian default, because the prefix is served only under
  `catalogMode`; it is NOT in `checkSlugCommerceConflict`'s list (`backend/src/lib/slug-guard.ts:23-29`), so no
  tenant's page slugs change. Named, not fixed: a catalog tenant's content page slugged `lista-mea` would collide with
  the list page (follow-up `CAT-INTEREST-SLUG-GUARD-1`). Packet defect: it extended an object without listing the
  test that pins it.
- **CAT-INTEREST-SHOWCASE-CARDS — excluded from this slice.** The toggle lives on the shop, category and search
  cards and on the product page; category-showcase block cards link to the product page. Wiring the plugin package
  to the renderer's shortlist needs a new seam whose only user would be this button (follow-up
  `CAT-INTEREST-SHOWCASE-1`).
- **F3 — expiry needs an identity read: `POST /public/interest/resolve`.** `GET /public/products` reads one page and
  filters (it cannot prove absence) and `GET /public/products/{slug}` keys by slug, which C8-3 forbids as identity.
  The ratified behaviour (§ 3.5: the list page resolves stored ids against the catalogue) therefore needs a read by
  id. Mechanism: a second `noAuth` route on the interest function (dispatch on `event.routeKey`, exhaustive), body
  `{ productIds: string[1..50] }` (zod `.strict()` in `packages/shared`), `verifyTenantFromOrigin`, the catalog-tenant
  check, and THE SAME chunked `BatchGet` + bounded `UnprocessedKeys` retry the submit uses (one function, two
  callers). Answer per id: `active { title, slug, imageLink, collection, optionValues[] }` | `not-available` (no
  fields — drafts leak nothing) | `absent`; keys still unprocessed → 503 `retryable`. The list page shows
  `absent` as expired (reselect), `not-available` as currently unavailable, and on 503 or network failure marks
  nothing and leaves submission to the server's own validation. No reCAPTCHA (a read of public fields). Infra: one
  route + integration + permission in EngagementApi; named gain: the ratified expiry display.
- **F7 — collection** comes from the product's `attributes["colecție"]` in the resolve answer (live; the stored
  snapshot and the submit payload stay as § 3.5 defines them).
- **F8 — no new field type.** The system form's `items` field uses the existing `FormFieldSchema` type `textarea`;
  the admin renders the item list only for `INTEREST_FORM_ID` + field id `items` (F6).
- **F2, F4, F5, F6 — fix as review-0 states** (replay recognised by token hash before catalogue validation with an
  outcome consistent with the stored record; selection bound to the current product; completion applied only to the
  submitted list; only not-found treated as "no submissions yet", item renderer restricted to the reserved field).

## 9. Operator closeout (operator, 2026-10-30)

**Review.** review-0 escalate (F1–F8, two decisions → operator rulings § 8), review-1 revise (F5 completion ownership,
F9 resolve-response parsing), review-2 **approved** (builder claude-opus-5-5, reviewer codex gpt-6.1-sol, separate
invocations).

**Gates (operator, on the approved candidate, bare exit codes, log `ALL GATES GREEN`).** typecheck 0; backend
`test:unit` 659; `packages/shared` 107; `packages/plugins` 201; renderer `npm test` 100; renderer `test:serving` 0 with
the `cm1-*` byte-identity rows green and `cm1-byte-identity/` untouched; `test:interest-e2e` 4 passed; admin 65; MCP 0;
infra 61; `git diff --check` 0; every changed path inside the allocation as extended by § 8.

**Staging CDK diff and deploy.** EngagementApi `+` 10 resources: `PublicInterestFunc` (function, role, policy, log
group), routes + integrations + invoke permissions for `POST /public/interest` and `POST /public/interest/resolve`.
40 functions change code and metadata only (they bundle `packages/shared`). Nothing removed or replaced.
`cdk deploy` → `AmodxStack-staging` ✅.

**Staging proofs (deployed routes, tenant `cm1-catalog`).**
- `POST /public/interest/resolve` with the tenant's origin, ids = two ALPOD products + `no-such-product-cim1` → 200:
  both `active` with title, slug, CDN `imageLink`, `collection` "CLASSEN - Water resistant laminate flooring" and
  their `optionValues`; the unknown id `absent`.
- A foreign origin → 403 "Invalid request origin". A submit with an invalid reCAPTCHA token → 403 "Verification
  failed"; afterwards `FORMSUB#interest-list#` count = 0 and no `FORM#interest-list` item (nothing written).
- `/_site/cm1-catalog/lista-mea` → 200; a catalog product page → 200 with the "Mă interesează" control.
- **NOT RUN on staging: a recorded submission, its admin view and the notification e-mail.** The staging catalog
  tenant's domain is `cm1-catalog.serving-contract.test` (does not resolve), so no browser page carries its origin,
  and reCAPTCHA is mandatory on the deployment, so a script cannot obtain a valid token. These paths are proven by
  the unit + in-memory integration rows (one record per list, server-captured titles, dropped items, token replay,
  notification to `integrations.contactEmail` or reported absent) and the hermetic browser E2E. The first real
  submission is the human's on prod after the deploy (check: the record under Liste de interes, the e-mail at the
  contact address).

**Follow-ups.** `CAT-INTEREST-SHOWCASE-1`, `CAT-INTEREST-SLUG-GUARD-1`, `CAT-INTEREST-READ-1` (glamCRM read scope),
`CAT-INTEREST-SIGNAL-1`; a staging catalog tenant with a real domain would let the operator prove submissions
end to end.
