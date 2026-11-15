# SHOP-LOOK-1E — a block that places a custom form on a page (implementation record)

Status: **BUILT** (2026-11-16, builder), uncommitted, awaiting review. Start: `main` at `5b3c1be`, tree clean. All oracles
of the packet's § 4 pass on the final tree (§ 6): serving contract 124 / 124 (122 existing rows unchanged + 2 new
`sl1e-*` rows). Maturity: the `form` block and the corrected submit handler are **PROTOTYPE** until the operator's staging
run (Operator closeout, below). Closes finding F-SHOP-FORMS-UNPLACED (design `docs/slices/shop-look-1.md` § 13).

## 1. The requirement

Decision SHOPLOOK-FORM of `docs/slices/shop-look-1.md` § 10, ruled **B** (2026-11-15): "a new block that places a custom
form"; re-cut into this slice by § 17.3. Reference section 9 ("Not sure where to start?": a form in a card — Name,
E-mail, a select "Primary interest", a textarea). The builder packet of 2026-11-16 is the task definition (§ 0 root
cause, § 1 ratified behaviour, § 2 constraints).

What an owner and a visitor get:

- **Owner.** In the page editor, a block **Custom Form**: a picker of the tenant's forms by name (Forms page list), an
  optional label, headline and text above the form, and a box "Show the form in a card". The form itself (fields, button
  text, success text, notify address) stays on the Forms page.
- **Visitor.** The form, each field by its type; after a good submit the form's success text replaces the form; a
  refusal shows the server's error text (else the locale text). The submission appears on Forms → Submissions and in the
  notify mail with each field's label and value.

## 2. The submit path as built (guards, isolation, handler rule)

**Path.** Browser → `POST <NEXT_PUBLIC_API_URL>/public/forms/{slug}/submit` (API Gateway, route `PublicSubmitForm`,
`infra/lib/api-engagement.ts:224`, `noAuth`) → `backend/src/forms/public-submit.ts`. No new route, no proxy, no infra
change. The same mechanism as the five live callers named in packet § 0 (checkout, cart coupon, interest list, popups,
the showcase fallback). The browser needs the tenant's domain in the API's CORS list (`infra/lib/api.ts:52-71`,
`props.tenantDomains`), as the checkout does (INFERRED from the config; staging proves it).

**Where the browser gets its inputs** (packet § 1 item 6; the established way, used unchanged):

| Input | Source in the block | Precedent |
|---|---|---|
| tenant | the `tenantId` prop (RenderBlocks gives `config.id`, `SitePage.tsx:736`, `:1643`) | the showcase fallback fetch (`CategoryShowcaseRender.tsx:183-190`) |
| API address | `process.env.NEXT_PUBLIC_API_URL`, inlined by `next build` | the showcase fallback fetch (`CategoryShowcaseRender.tsx:189`). OBSERVED: in the serving build the form chunk holds `apiUrl:""` and no `process.env`. The deploy build gets the value from `renderer/.env.local`, written by `scripts/post-deploy.ts:79` (INFERRED, deploy not run) |
| reCAPTCHA token | `window.AMODX_RECAPTCHA_KEY` + `window.grecaptcha` (injected by `ThemeInjector.tsx:156`), action `form_submit`; no key or no script → `null` | `ContactRender.tsx:17-34`, `LeadMagnetRender.tsx:13-30` |

**Guards, in order (handler as built).**

1. `x-tenant-id` absent → 400, before any read.
2. `verifyTenantFromOrigin` (origin/referer host → `GSI_Domain` → tenant id must equal the header; no origin → 403 in
   strict mode) → 403 "Invalid request origin". No read of tenant data before this passes.
3. **New:** the body is parsed once; not JSON, or JSON that is not an object (`null`, array, string, number) → 400
   "Invalid request body". (Was: a 500.)
4. Tenant item `SYSTEM / TENANT#<tenant>` → reCAPTCHA config; when keys exist, a missing token → 400 "CAPTCHA
   verification required"; a token that is not a string is now treated as missing (was: sent to Google → 403).
5. `TENANT#<tenant> / FORMSLUG#<slug>` → `TENANT#<tenant> / FORM#<id>`; none → 404; `status !== "active"` → 403.
6. **New:** `cleanSubmission` (below); a refusal → 400 with `{ error, fields }`.
7. `PutCommand` `TENANT#<tenant> / FORMSUB#<formId>#<uuid>`; notify mail when the form has `notifyEmail`; 201
   `{ message, submissionId }` with `Cache-Control: no-store`. Answer, statuses, key shapes and mail subject unchanged.

**Isolation statement.** A request can READ only: the domain index entry of its origin host; the tenant item of the
header tenant AFTER the origin check proved the origin belongs to that tenant; the slug pointer and the form under
`TENANT#<that tenant>`. It can WRITE only one `FORMSUB#` item under `TENANT#<that tenant>`, for an active form of that
tenant, holding the form's own labels with cleaned values and a checked email — and cause one mail to that form's
owner address. It cannot name another tenant's form (the key prefix is the verified tenant), cannot store a key that is
not a label of the form, and cannot add a header or a line to the mail. The interest-list system form
(`FORM#interest-list`) has no `FORMSLUG#` pointer (`backend/src/interest/public.ts:261` writes only `FORM#`), so this route
cannot write into it. Proved by `backend/test/unit/forms-public-submit.test.ts` (F): "an origin of another tenant, or no
origin → 403; no form read for any tenant, nothing stored", "another tenant's slug → 404: the lookup is only under
TENANT#<verified tenant>", "the tenant requires reCAPTCHA and the request has no token → 400; no form read",
"defect 3 — keys that are not labels … dropped; nothing else of the request is stored", "CR/LF are removed from the
submitter email", "the mail lines … CR/LF in a value → a space". The page side: the server pass reads only
`TENANT#<page tenant>` keys and sends display data only — never the notify address (R "another tenant's form of the same
slug is never read", "exactly { slug, name, fields, … } — never the notify address"; S `sl1e-form`).

**Rate limiting (what exists; not changed, packet § 6).** API Gateway stage default route throttling, burst 100 and
50 requests per second for the whole API (`infra/lib/api.ts:126-133`); reCAPTCHA v3 (deployment keys mandatory in a
deployed stack, tenant keys optional, `backend/src/lib/recaptcha.ts`); the origin check. No per-IP or per-form limit.

**The handler rule (`cleanSubmission`, `public-submit.ts:95-134`).**

- **The form's fields** (`formFields`, `:40-51`): the stored entries that pass `FormFieldSchema` (shared), one per label —
  the FIRST field of a label defines it (labels are the submission's keys). A stored entry that is not a field (no label,
  unknown type) is not part of the form.
- **Data:** absent → `{}`; not a plain object → 400 "Invalid form data". Only the request's OWN keys are read (a label
  such as `constructor` never reads an inherited value); the stored `data` is built with `Object.fromEntries` (a label
  `__proto__` is an own key). Every field of the form is stored, blank ones included.
- **Per type** (`cleanValue`, `:53-87`, exhaustive `switch` with a `never` default): `text`, `email`, `phone`,
  `textarea` → absent `""`, a string trimmed (email: CR/LF removed, then trimmed), at most 500 / 5 000 (textarea)
  characters; `number` → absent or blank `""`, a finite number, or a text matching `[+-]?(digits[.digits]|.digits)
  [e±digits]` with a finite value (stored as a number); `checkbox` → absent `false`, a boolean; `select` → absent or `""`
  → `""`, else exactly one of the field's `options` (case and spaces count). Anything else (another type, `null`, an
  object, an array) → invalid.
- **Refusals, in this order, each with the labels:** "Invalid value" (wrong type, not an option), "Value too long",
  "Invalid email format" (an `email` field's non-blank value fails the existing pattern or is over 500), "Missing
  required fields" (a required field blank: `""`, or an unticked checkbox).
- **Submitter email:** `body.submitterEmail` when it is a non-blank string after CR/LF removal and trim (not a string →
  400 "Invalid email format"; invalid → 400 "Invalid email format"); else the cleaned value of the form's FIRST `email`
  field; blank → `null`.
- **Mail lines:** one per field of the form: `<label>: <value>`; a blank value (`""`) → `(empty)`; each CR and each LF
  in the value → one space. A checkbox reads `true` / `false`; `0` reads `0` (was `(empty)`).

## 3. Defects (red, then green) and the taxonomy

### 3.1 The three defects of packet § 0, reproduced

`backend/test/unit/forms-public-submit.test.ts` was written first and run against the UNCHANGED handler (EXECUTED):
**25 failed, 5 passed**. The five that passed are the "as today" guard rows (disabled 403, no form 404, another tenant's
slug 404, another tenant's origin 403, missing `x-tenant-id` 400, no `notifyEmail` → no mail): they describe the old
handler too. After the fix: **31 / 31** (one row, the own-key row, added after the gate run and re-run with the full
suite). Red outputs, verbatim:

| Defect | Test | Red on 5b3c1be |
|---|---|---|
| 1 field identity (`data[field.name]`) | "defect 1 — the component's payload for a stored form with a required text field is ACCEPTED …" | `expected 400 to be 201` (the 400 "Missing required fields") |
| 1 mail lines | "defect 1 — the mail lines carry the labels and the values …" | mail text did not contain `Name: Ana …` (every line `(empty)`) |
| 2 submitter email | "defect 2 — the top-level submitterEmail is stored and used as reply-to …" | `submitterEmail` null, no reply-to |
| 3 unbounded data | "defect 3 — keys that are not labels of the form are dropped …" | the request's `data` stored as sent |
| malformed body | "a malformed body → 400 …" | `status: 500` |

One harness correction before the final red run: the mock first answered an unknown `GetCommand` with nothing
(`undefined`), so two "as today" rows failed for a reason real DynamoDB does not have; a default answer `{}` (DynamoDB's
answer for a key it does not hold) fixed it. The 25 / 5 split above is after that correction.

### 3.2 Taxonomy → tests (all EXECUTED, pass)

F = `backend/test/unit/forms-public-submit.test.ts` (real handler, mocked DynamoDB and SES, REAL origin check);
P = `packages/plugins/test/formBlock.test.ts` (`RENDER_LOADERS.form` via `react-dom/server`); R =
`renderer/test/unit/shop-look-1e-form.test.ts` (real `SitePage` and the REAL `getFormBySlug` over a `GetCommand` store
stub); B = `renderer/test/unit/shop-look-1e-form-client.test.ts` (jsdom, the BUILT plugin block); L =
`renderer/test/unit/locale-1a-client.test.ts` (jsdom, the moved component through the block); A =
`admin/src/components/editor/formBlockPicker.test.ts` and `admin/src/pages/FormSubmissions.shop-look-1e.test.ts`
(jsdom); S = serving rows.

| Case | Expected | Test |
|---|---|---|
| handler BEFORE the fix, one required text field, the component's payload | 400 "Missing required fields" | F "defect 1 — …", red run § 3.1 |
| each field type, a valid value | stored under its label, cleaned | F "strings trimmed …; number …; checkbox boolean; select one option", "a number value given as a number; -1.5 and 1e3 …", "an absent key → blank …" |
| a key that is not a label; a nested object; an array | dropped / 400 "Invalid value" / 400; never stored as sent | F "defect 3 — …" (`injected: {deep: …}`, `__proto__`, `constructor`, top-level `extra` dropped), "a value of the wrong type (object, array, null, …)", "data that is not an object …" |
| text over its limit | 400 naming the field | F "text, email, phone at 500 and textarea at 5 000 … one more → 400 naming the field" |
| select value not in `options` | 400 | F "select: a value not in the field's options → 400; exact match …" |
| required blank; required checkbox unticked | 400 with the labels | F "required blank (empty, spaces only, absent) and required checkbox unticked → 400 with the labels" |
| `submitterEmail` top level / only a field / both / invalid / CR-LF | stored + reply-to / the field's value / top wins / 400 / cleaned | F "top level only", "only an email field", "both → the top level wins", "the FIRST email field …", "invalid → 400 …", "CR/LF are removed …" |
| malformed JSON | 400 | F "a malformed body → 400 …" (`{not json`, `null`, `[1,2]`, `"text"`, `42`) |
| form disabled; slug of no form; another tenant's slug | 403 / 404 / 404, nothing stored | F "form disabled → 403; slug of no form → 404 …", "another tenant's slug → 404 …" |
| origin of another tenant; no token when required | 403 / 400, nothing stored, no form read | F "an origin of another tenant, or no origin → 403 …", "the tenant requires reCAPTCHA … → 400 …" |
| two forms with fields of the same label; one form with two fields of the same label | **Rule: labels are the key.** Each submission is checked and stored against its own form only; within one form the FIRST field of a label defines it, a later field of that label is not drawn, stored, checked or mailed | F "two forms with fields of the same label …", "one form with two fields of the same label …"; R "fields: … the first field of each label"; finding F-1E-DUPLICATE-LABEL (§ 8) |
| mail lines | label + cleaned value per field; no "(empty)" for a filled field; CR/LF replaced | F "defect 1 — the mail lines …", "label and cleaned value per field; \"(empty)\" only for a blank value; CR/LF …" |
| answer, statuses, key shapes, subject unchanged | as before | F "201 { message, submissionId } …", "… the subject unchanged" |
| block: slug set, form active | fields by type, button text, locale texts | P "text, email, phone (tel), number …", "each label in field order, tied to its control", "required fields carry the mark …", "the button shows …", "the select placeholder is the tenant's locale text (EN, RO) …"; S `sl1e-form` |
| block: no slug; unknown slug; disabled form | nothing drawn; no error | P "no `_form` …", "a `_form` not of the server's shape"; R "no slug …", "a slug of no form …", "a disabled form …"; S `sl1e-draws-nothing` |
| block options blank / set; `card` off / on | no element / the element; the card class | P "all blank / absent …", "eyebrow, headline, text …", "card on (exactly true) …"; S `sl1e-form` (all set) |
| the server pass | one `getFormBySlug` per block (two `GetCommand`s), none without a slug; no other block's payload changes | R "one getFormBySlug for the block …", "one call PER BLOCK …", "no slug … no call, no request", "the other blocks of a page with a form block keep their payload …" |
| a successful submit in the browser | the success text replaces the form | B "a successful submit: the form's success text replaces the form …" |
| a failed submit | the server's `error` text, else the locale text | B "a failed submit: …"; L "[1a-client] EN/RO: … formSubmissionFailed", "… an error without a message → formErrorShort …" |
| the request the browser sends | `POST <API>/public/forms/<slug>/submit`, `x-tenant-id`, `data` by label, `submitterEmail`, token | B "POST <NEXT_PUBLIC_API_URL>/public/forms/<slug>/submit …", "with the page's reCAPTCHA key and script …", "the slug is URL-encoded" |
| admin picker | the forms by name, by the injected list | A "the editor calls GET /forms once and offers each form by name …", "a stored slug of a disabled form …", "the list fails to load …" |
| `FormSubmissions.tsx` shows a corrected submission | each label's value, the email | A "one column per field (the label), each cell the value stored under that label …" |
| a page without the block | every existing serving row unchanged | S: 122 existing rows pass, no capture file changed (§ 5) |

Also bound: schema defaults, Tiptap attributes = schema defaults, storage `fetchFormsFn` (P); registration in both
entries and `offeredOn: []` (P; `admin/src/components/editor/Toolbar.test.ts` "the custom form block is offered on every
site kind"); render loader count 22 (`packages/plugins/test/renderLoaders.test.ts`); no renderer or admin import, type-only
`@amodx/shared` (D3), the renderer copy gone, only `text-green-500` as a palette class (P); owner texts escaped (P);
stored texts that are not strings → `""` (R); the locale texts of an RO tenant and of a stored override (R).

**The packet's question about the end-to-end contract.** The browser's request body (B, asserted exactly) and the
payload the handler suite posts (F `payload()`) are the same shape: `{ data: { <label>: value }, submitterEmail,
recaptchaToken }`, a number field's value as the input's text (`"3"`), a checkbox as a boolean. The two suites run in
different packages; their agreement is by these two assertions (INFERRED linkage, not one test). Staging closes it.

### 3.3 Teeth check (EXECUTED)

Thirteen mutations, each restored afterwards (script `/tmp/SHOP-LOOK-1E-scratch/mutate.py`, deleted with the scratch
directory); each made its suite fail: handler — read `data[field.name]` (20 failed), no label dedupe (1), inherited key
read (1), mail CR/LF kept (1), select trimmed (1), no length limit (1), top-level email ignored (4); server pass — the
whole stored item sent (1), a read without a slug (1), no field dedupe (1); render — `card` truthy (1), eyebrow not
trimmed (1); admin — no `fetchFormsFn` injection (2). The restored files re-ran green.

## 4. What changed (file:line on the final tree)

| File | Change | Serves |
|---|---|---|
| `backend/src/forms/public-submit.ts:8`, `:13-142` | import `FormFieldSchema`; the handler rule of § 2 (`formFields`, `cleanValue`, `cleanSubmission`, `mailValue`, `badRequest`, small guards) | packet § 1 item 4 |
| `public-submit.ts:156-165`, `:176` | body parsed once after the origin check (400); reCAPTCHA token read as a string only | item 4 (malformed → 400) |
| `public-submit.ts:223-226`, `:242-243`, `:251-253` | the cleaned data and submitter email stored; the mail lines from the cleaned fields | item 4 |
| `packages/plugins/src/form/schema.ts` (new) | `FormBlockSchema`: `formSlug`, `eyebrow`, `headline`, `text`, `card`, `blockWidth` (ordinary defaults: no stored instances) | items 1-2 |
| `packages/plugins/src/form/index.ts` (new) | `FormPlugin`: key `form`, label "Custom Form", Tiptap node `form` (`app-form`), storage `fetchFormsFn`, no `offeredOn` | items 2, 7 |
| `packages/plugins/src/form/DynamicForm.tsx` (moved from `renderer/src/components/DynamicForm.tsx`) | the component, changed only as its header lists: reCAPTCHA from the page globals; slug URL-encoded; labels tied to controls (`useId`); `text-destructive` for the mark and the error | items 3, 6 |
| `packages/plugins/src/form/FormRender.tsx` (new) | the block: no `_form` → nothing; eyebrow / headline / text; `max-w-lg` form, `card === true` → the card; passes `_form` to `DynamicForm` with `tenantId` and the API address | items 1-3, 6 |
| `packages/plugins/src/form/FormEditor.tsx` (new) | the picker (forms by name, disabled marked), the three texts, the card box, the width; `formSlugNote` (exported, pure) | item 5 |
| `packages/plugins/src/admin.ts:23`, `:46-47`; `render.ts:45` | registration in both entries | item 7 |
| `renderer/src/components/SitePage.tsx:19`, `:25` | imports `getFormBySlug`; `FormFieldSchema`, `FormField` | item 1 |
| `SitePage.tsx:836-864` | `formForBlock`: the `_form` DTO field by field | item 1, § 2 constraint "the server stays the authority" |
| `SitePage.tsx:939-946` | `prepareBlocks`, `form` branch | item 1 |
| `renderer/src/components/DynamicForm.tsx` (deleted) | moved (above). Basis: `git grep -n DynamicForm 5b3c1be -- '*.ts' '*.tsx' '*.mjs' '*.js'` over the whole tree (deterministic text search; a static import names the identifier) — one importer, `renderer/test/unit/locale-1a-client.test.ts` (a test), and four comments that name it (`packages/shared/src/index.ts:1084`, `:2403`, `locale-strings.ts:202`, `InterestShortlist.tsx:12`); no source importer. After: the identifier is imported only inside `packages/plugins/src/form/` and by no file outside it (same search on the working tree) | item 6 |
| `admin/src/components/editor/BlockEditor.tsx:107-118` | `storage.form.fetchFormsFn` = `GET /forms` (the Forms page's call), failure → `[]` | item 5 |
| `tools/mcp-server/src/index.ts:663-684`, `:981`, `:2698` | `BLOCK_SCHEMAS.form`, `add_block` type `form`, one tip | item 7 |
| `renderer/test/unit/locale-1a-client.test.ts` | the moved component mounted through `RENDER_LOADERS.form`; selector `p.text-red-500` → `p.text-destructive` (3); describe text; `it` titles unchanged (the 1a `coverage.json` cites them; not edited) | item 6 |
| `packages/plugins/test/renderLoaders.test.ts:46-48` | loader count 21 → 22, test name says 22 (this slice adds a loader) | item 7 |
| `admin/src/components/editor/Toolbar.test.ts` | one row: `form` offered on every site kind | item 7 |
| new tests | `backend/test/unit/forms-public-submit.test.ts`, `packages/plugins/test/formBlock.test.ts`, `renderer/test/unit/shop-look-1e-form.test.ts`, `renderer/test/unit/shop-look-1e-form-client.test.ts`, `admin/src/components/editor/formBlockPicker.test.ts`, `admin/src/pages/FormSubmissions.shop-look-1e.test.ts` | taxonomy |
| `renderer/test/serving-contract/fixtures.mjs:1008-1054`, `:1110-1111` | `SL1E`: three copies of the CM1 commerce tenant (set / blank / none), each storing an active and a disabled form | § 5 |
| `renderer/test/serving-contract/contract.test.mjs:46`, `:3390-3475` | rows `sl1e-form`, `sl1e-draws-nothing` | § 5 |
| `docs/block-types.md`, `docs/plugin-architecture.md` | table row, § *Custom form*; storage line, `_form`, § *Browser submits from a block* | item 7 |
| `packages/plugins/ARCHITECTURE.md`, `backend/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, `admin/ARCHITECTURE.md` | the block, the handler, the server branch, the editor injection, the tests | docs |

Not changed: `packages/shared` (no type had to change: `FormFieldSchema` is used as it is; the three form texts that are
not block keys travel in `_form`, D-1E-1), `renderer/src/lib/dynamo.ts` (`getFormBySlug` used as it is),
`renderer/src/components/RenderBlocks.tsx`, `admin/src/pages/FormSubmissions.tsx`, infra, `package.json`, `routes.json`
(no route changed). No new dependency. Generated maps (`*_MAP.md`) not edited; stale for the edited files until the next
`rmap` run.

## 5. Byte identity

- **A page without the block:** no new read (R "a page without the block makes no form read") and no new key. Every
  existing serving row passed unchanged (122 rows). `git status` lists no file under `renderer/test/serving-contract/`
  but `contract.test.mjs` and `fixtures.mjs`; no capture, no `before/` set, no `coverage.json`, no expectation file
  changed.
- **The moved component** had no page user before (its only importer was a test), so no existing page changes by the
  move. Its 1a texts keep their checks (L, titles unchanged; `test/unit/locale-coverage.test.ts` passes on the
  unchanged `locale-1/1a/coverage.json`).
- **New rows.** `sl1e-form`: the set page equals its blank-slug twin after removing exactly the block's `<section>`
  (HTML, byte for byte; the twin also holds a `form` block, because a page with the block loads the block's code-split
  chunk); the payload equals the twin's after swapping the block's attributes with `_form` for the twin's attributes
  (resolved); the notify address, `FORMSLUG#` and `notifyEmail` appear nowhere in the response; the built stylesheet
  holds the 22 classes the block uses. `sl1e-draws-nothing`: a disabled form and a slug of no form → the twin's HTML with
  one more empty width wrapper; no `_form`; the payload equals the twin's after swapping the stored blocks.
- The stylesheet: `DynamicForm`'s classes were compiled before (it lived under `renderer/src`); after the move they come
  from `packages/plugins` (`globals.css` `@source`). The existing rows that compare captured HTML passed, so the
  stylesheet link of existing pages did not change in a way any row detects (INFERRED: no row asserts the CSS hash
  itself).

## 6. Gates (each run bare; exit code by `echo $?`; EXECUTED on the final tree after a fresh root build)

| Command (from the repository root unless named) | Expected | Actual |
|---|---|---|
| `npm run build; echo $?` | 0 | 0 |
| `npm run typecheck; echo $?` | 0 | 0 |
| `cd packages/plugins && npm test; echo $?` | 0 | 0 — 11 files, 332 tests (20 in `formBlock.test.ts`) |
| `cd packages/shared && npm test; echo $?` | 0 | 0 — 22 files, 385 tests |
| `cd backend && npm run test:unit; echo $?` | 0 | 0 — 56 files (1 skipped), 1445 tests (1 skipped); 31 in `forms-public-submit.test.ts` |
| `cd renderer && npm test; echo $?` | 0 | 0 — 45 files, 625 tests (12 + 5 in the two new files) |
| `cd renderer && npm run test:serving; echo $?` | 0, no existing capture or expectation changed | 0 — 124 / 124 (122 existing + `sl1e-form`, `sl1e-draws-nothing`) |
| `cd admin && npm run test:unit; echo $?` | 0 | 0 — 15 files, 296 tests |
| `cd tools/mcp-server && npm test; echo $?` | 0 | 0 — route coverage + 17 tool-shape tests |
| `git diff --check; echo $?` | 0 | 0; the untracked new files checked separately for trailing white space: none |

The backend suite was run twice: the full gate run (1444 tests), then again after the own-key row was added (1445).
Not run: `cd backend && npm test` (packet: never). The first serving run failed two NEW rows on two test-side matchers
(Tailwind v4 writes `space-y-4` as `:where(.space-y-4>…)`; a second empty wrapper elsewhere on the page) — the matchers
were corrected, no product code changed between the runs.

## 7. Decisions and abstractions (one line each)

- **D-1E-1 the four form texts travel in `_form.strings`.** Three of them (`formErrorShort`, `formSelectPlaceholder`,
  `formSubmitting`) are not in `BLOCK_SITE_KEYS` (`packages/shared/src/locale-strings.ts:205-211`), so the block's
  `strings` prop lacks them. Adding them there would change the `strings` prop — and so the RSC payload — of every page
  with any block, and `locale-strings.ts` is outside the allocation. The server pass adds them to this block only
  (precedent: the showcase's `_rating.text` from `reviewsSummary`, `shop-look-1d`). All four come from `_form`, so the
  moved component keeps its one `strings` prop.
- **D-1E-2 the stored slug is trimmed** for the read and the submit; blank or not a string → no read.
- **D-1E-3 `_form.slug` = the slug read** (not a second attribute read in the browser), URL-encoded in the submit path.
- **D-1E-4 stored texts that are not strings → `""`.** No English fallback is added in code (owner content; packet § 2).
  A stored form always has both texts (`backend/src/forms/create.ts:61-62` writes defaults); only an MCP update that sets
  `""` gives an empty button or success text.
- **D-1E-5 a `number` value arrives as the input's text** (`"42"`) and is stored as a number; the handler accepts a
  finite number or the decimal text form; blank → `""`.
- **D-1E-6 a value of the wrong type is refused, not converted** (`null` included): the component never sends one.
- **D-1E-7 the top-level submitter email** is held to the same 500-character bound as an email field (it is stored).
- **D-1E-8 layout:** eyebrow / headline / text centred above the form (the contact block's head, `text-center mb-8`);
  the form at most `max-w-lg`, centred (the contact block's width, design § 6.2); the card wraps the form only. Eyebrow
  classes = the showcase eyebrow (D-1C-6, D-1D-8).
- **D-1E-9 offered on every site kind:** a form needs no commerce or catalog data; design SL-D11 restricts only the
  product and category blocks.
- **D-1E-10 labels tied to controls** (`htmlFor` / `id` from React `useId`, SSR-stable): an input without an accessible
  name fails WCAG 1.3.1 / 4.1.2; the checkbox keeps only its wrapping label (a second label would repeat its name).
- `FormRender` + `DynamicForm` (two files) — what: the block chrome (data guard, texts, card) and the moved form; users:
  the `form` loader (FormRender), FormRender (DynamicForm); axis: none (not a dispatch); rejected: merging them — the
  move would no longer read as a move, and the component's contract (its props) is what L tests.
- `formForBlock` (`SitePage.tsx`, file-local) — what: the `_form` DTO; users: the `form` branch of `prepareBlocks` (content
  and category pages, through it); axis: none; rejected: inline code in the branch (no single place that says what may
  reach the payload).
- `cleanSubmission`, `cleanValue`, `formFields`, `mailValue`, `badRequest` (`public-submit.ts`, file-local) — what: the
  handler rule; users: the handler; dispatch: `cleanValue` is a sum-type `switch` over the field type (variants fixed —
  the shared enum — operations growing), exhaustive with a `never` default, so a new field type is a compile error here;
  rejected: inline checks in the handler body (no one place for the order of refusals).
- `CleanedSubmission` — a two-variant result type (`ok: true` with data / `ok: false` with error and labels): expected
  failure in the signature; users: the handler.
- `formSlugNote` (exported from `FormEditor.tsx`) — what: the picker's note; users: the editor and P; axis: none;
  rejected: an inline expression (no test seam without a DOM harness; precedent `storedShowcaseOption`).
- **Duplicated rule (deliberate, debt):** "the stored entries that pass `FormFieldSchema`, first of each label" is
  written twice — `public-submit.ts` `formFields` and `SitePage.tsx` `formForBlock` (eight lines each) — because a shared
  function would go into `packages/shared/src/index.ts`, which the packet allocates only for a type change. Both copies
  are tested with the same inputs (F, R) and each names the other. Proposal: move it to `@amodx/shared` beside
  `FormFieldSchema` in a later slice.
- No other abstraction.

## 8. Findings

- **F-1E-DUPLICATE-LABEL** (data model, partly pre-existing): the admin form editor and the forms handlers accept two
  fields with the same label (no check in `admin/src/pages/FormEditor.tsx`, `backend/src/forms/create.ts`,
  `update.ts`). Labels are the submission's keys (the component, `FormSubmissionSchema.data`, `FormSubmissions.tsx`), so
  two fields of one label cannot both hold a value. As built, the page draws and the handler reads only the FIRST field of
  a label: no visitor value is lost, but the owner's later field silently does not appear. Proposed: refuse a duplicate
  label (and an empty label) in the form editor and the create / update handlers. Not changed (outside the allocation).
- **F-1E-SUBMISSIONS-CHECKBOX** (pre-existing, `admin/src/pages/FormSubmissions.tsx:190-197`): a checkbox value is shown
  "Yes" / "No" only when stored under the field id; stored under its label (the only shape the component ever sent) it
  shows `true` / `false`. Also: the page reads `data[field.id]` before `data[field.label]`, so a label that equals
  another field's id (ids are UUIDs: unlikely) would show the wrong value. Not changed (outside the allocation).
- **F-1E-SUCCESS-COLOUR** (theme): the theme has no success colour token, so the success icon keeps `text-green-500`
  (packet § 2: do not invent tokens). The error text and the required mark now use `text-destructive` (a token, used by
  `InterestShortlist.tsx`).
- **F-1E-FORM-NAME** (packet item 1 vs the component): `_form.name` (the form's admin name) is in the payload as the
  packet rules, but the component does not draw it (it never did: `formName` was an unused prop). It reaches the page's
  RSC payload, not its visible text. Proposed: drop it from `_form`, or use it as the form's accessible name — a
  human choice (an admin name may be internal).
- **F-1E-SERVER-ERROR-LANGUAGE** (pre-existing behaviour, kept as ratified): a refusal shows the server's `error` text,
  which is English ("Missing required fields") on every site; the locale text is shown only when the server sends none.
  The browser's own `required` check stops most such answers before a request. Proposed: map the handler's error kinds
  to locale keys in a later slice.
- **F-1E-NOTIFY-SUBJECT** (non-scope, unchanged): the mail subject is `New submission: <form name>` (owner content
  inside a header). The SES API takes the subject as a value, not raw header text; not changed (packet § 6).
- **F-1E-500-MESSAGE** (pre-existing, unchanged): the handler's catch answers 500 with `e.message`, which can show an
  internal error text to a stranger. Not changed (not in the packet).
- **F-1E-STALE-PATH-COMMENT** (ripple, outside the allocation): `packages/shared/src/index.ts:1084` says "Forms
  (components/DynamicForm.tsx)"; the component is now `packages/plugins/src/form/DynamicForm.tsx`. A comment only;
  `packages/shared` is allocated for a type change only, so it is not edited. The generated map
  `renderer/src/components/DynamicForm_tsx_MAP.md` (do not hand-edit) describes the deleted file until the next `rmap`
  run.
- **F-SHOP-BLOCK-DOC** (pre-existing, open): the "18 custom plugins" lines of `docs/block-types.md:3` and the MCP block
  list text stay stale.

## 9. Coverage gaps and not run

- No end-to-end run against a deployed API: the browser → API Gateway → Lambda → DynamoDB path is proved in parts
  (B: the request; F: the handler with that request shape; S: the served page). Staging closes it (closeout below).
- The admin editor's `onChange` wiring (picking a form stores its slug) is read, not exercised; the picker's options
  and the injection are exercised (A).
- `docs/ROADMAP.md` and `CURRENT_SLICE.md` are outside the allocation: not updated.

## Operator closeout

(left empty for the operator: on staging, a form built in the admin (or through the API) with a select "Primary
interest", placed on a page with this block, card on; screenshots at desktop and 390 px; a submit from the page (success
text, the submission on Forms → Submissions, the notify mail lines); the direct submit checks that staging allows — a
key that is not a label, a select value not in the options, an over-long text, a malformed body, another tenant's
origin.)

**Review.** One build, one review, verdict approved. Builder `claude-opus-5-5`; reviewer `claude-sonnet-5-5`
(fallback; the Codex reviewer did not answer). Same provider family for both roles: this slice has a security side
(the public submit handler), and its review is NOT cross-vendor. A second, standalone review of
`backend/src/forms/public-submit.ts` by the Codex reviewer is offered to the human.

**Operator gates (2026-11-16, on the approved tree).** Build, typecheck, shared, plugins, renderer, serving, admin
unit, backend unit, MCP, `git diff --check`: each exit 0. Protected paths, allocation, existing captures, trailing
whitespace: no line.

**Staging (deployed 2026-11-16; diff read first: four functions — the form submit handler and three of the renderer
— two bucket deployments, the admin runtime config, one nested-stack description).** Tenant `cm1-content`: one form
made through the admin API (Name, Email, a select "Primary interest", Message, a checkbox), placed on a page inside a
card, plus a second block with a slug of no form. Chromium at 1400 px and 390 px; the operator looked at the desktop
screenshot.

| Check | Result |
|---|---|
| the block with the form: eyebrow, headline, text, the card, five fields, the select with its three options, the button text | shown |
| the block with an unknown slug | draws nothing |
| no horizontal page scroll, 1400 px and 390 px | pass |
| direct: a malformed body | 400 "Invalid request body" |
| direct: valid data, no reCAPTCHA token | 400 "CAPTCHA verification required" (stops before the form read) |
| direct: the origin of another site | 403 |
| submissions stored by the refused requests | none |

**Not checked on staging: a stored submission.** A submit from the staging page fails before an answer ("Failed to
fetch": the staging address is not a tenant domain), and a direct request cannot pass reCAPTCHA. The corrected
handler (labels, limits, select values, required fields, the submitter email, the mail lines) is proven by its 31
unit rows on the real handler, not by a live submission. The block editor's form picker was not opened in a browser.
The probes were removed.

**Finding from the screenshot (F-1E-CHECKBOX-LABEL, pre-existing in the moved component).** A checkbox field prints
its label twice: once above the box and once beside it. To the follow-up slice with the other small corrections.

Prod deploy: the human's.
