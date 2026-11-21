# PUBLIC-HARDEN-1 — public handlers: a reCAPTCHA answer without a score is a refusal; a server failure answers a fixed text (implementation record)

Status: **IMPLEMENTED** (2026-11-17, builder `claude-opus-5-5`), uncommitted, awaiting review. Start: `main` at
`3388999`, tree clean. Maturity: the changed handlers keep their maturity; the change is proven by unit tests only
(no staging run). Task definition: the builder packet of 2026-11-17 (operator).

Revision 1 (relay review 0, verdict "revise", 2026-11-17): documentation and evidence statements only; no code or test
change. Rule applied to the whole record and to `backend/ARCHITECTURE.md`: a contract statement says what each site
does (no summary broader than the code), and a recorded command output names its tree and matches a re-run on it.

Revision 2 (relay review 1, verdict "revise", 2026-11-17): documentation only; no code or test change. Rule applied
to every authorization statement of this record and of `backend/ARCHITECTURE.md`: it names the authorizer branch and
the handler's role gate it rests on, both checked in the code.

## 1. The ruling

The operator reported the two findings of `docs/slices/form-submit-2.md` § 5 (F-FS2-RECAPTCHA-SCORE,
F-FS2-ERROR-LEAK) and recommended to fix both before the production deploy, as one small slice. The human's answer
(2026-11-17), verbatim: "Yes".

## 2. The two causes

**A — a reCAPTCHA success answer without a score passed the check.** `backend/src/lib/recaptcha.ts`,
`verifyRecaptcha`, cast the provider answer (`return result as RecaptchaVerifyResult`) and did not check it. Six
handlers refuse on `!result.success || result.score < recaptchaConfig.threshold`. `undefined < 0.5` is `false`, so the
answer `{ success: true }` (what a v2 key pair returns) passed. Red evidence (EXECUTED): the form submit handler with
the provider stubbed to `{ success: true }` answered **201** and stored the submission. An answer `null` made the
handlers read `.success` of `null` (a TypeError → 500; INFERRED from the code, not run).

Scope of the comparison (EXECUTED): `grep -rn "\.score <" backend/src` on the start tree (`3388999`, before the
change) → 6 hits, the operator's list: `interest/public.ts:226`, `contact/send.ts:66`, `forms/public-submit.ts:208`,
`leads/create.ts:50`, `coupons/public-validate.ts:50`, `orders/create.ts:99`. On the final tree the same command gives
7 hits: these 6 comparisons (same lines) and the comment that this slice adds at `lib/recaptcha.ts:95`.
`grep -rn "verifyRecaptcha" backend/src` (final tree), import lines and the definition `lib/recaptcha.ts:73` left out
→ 6 call sites, in the same six files.

**B — a server failure answered the exception's message to a caller that need not authenticate.** The outer `catch` of 14 of the 15
public handler files returned `{ error: e.message }` in the 500 body (a DynamoDB access-denied text carries the role
ARN, the table ARN and the region). The packet named four sites; the list in § 3 found ten more.

## 3. The public routes and their handlers

Source of truth (OBSERVED, read only):

- `backend/src/auth/authorizer.ts:236` — the routes the authorizer allows as `anonymous`: `POST /leads`,
  `POST /contact`, `POST /consent`. The key checks run first (`:126-148`): a master key resolves as `GLOBAL_ADMIN`,
  the renderer key as `RENDERER` (the renderer proxies call these three routes with it); a key with the service-key
  prefix authenticates as `SERVICE` or is refused, never anonymous (`:154-221`). Any other request reaches `:236` and
  is allowed with `sub: "anonymous"`. The HttpApi has a default authorizer (`infra/lib/api.ts:118`);
  `grep -rn HttpNoneAuthorizer infra/lib/*.ts` → no hit.
- `infra/lib/api-commerce.ts:122` and `infra/lib/api-engagement.ts:88` — `addRoute(…, { noAuth: true })` gives
  `authorizationType: 'NONE'`. `grep -n "noAuth: true" infra/lib/*.ts` → 13 routes.
- Route → handler file: the `entry:` of each function (`infra/lib/api.ts`, `api-commerce.ts`, `api-engagement.ts`).

Handler role gates (EXECUTED: `grep -nE "requireRole|authorizer\?\.lambda|callerRole"` over the 15 files): none of
the 15 handlers calls `requireRole`. `leads/create.ts:20-21`, `contact/send.ts:28-29`, `consent/create.ts:26-27` read
the authorizer role only to skip the origin check for `RENDERER` and `GLOBAL_ADMIN` (`verifyTenantFromOrigin`). So a
caller with no credential reaches every one of the 15 handlers.

16 routes, 15 handler files. Excluded: `POST /public/customers/profile`. It has no `noAuth`, so the authorizer runs,
and it is not one of the three anonymous routes, so a credential is needed. Its handler gate,
`backend/src/customers/public-update.ts:38`, is `requireRole(auth, ["GLOBAL_ADMIN", "RENDERER"])`: a `CUSTOMER`
public-pool token is refused (403). Customers reach it only through the renderer proxy
`renderer/src/app/api/profile/route.ts`, which checks the NextAuth session (`:65`, 401 without it), takes the email
from the session (`:77`), and calls the route with the renderer key (`:92`) — `docs/platform-decisions.md` PD-002
(renderer-proxy default for customer data actions) and PD-003 (the public pool is a login substrate, not the backend
authorization transport). Not public in the sense of this slice; not changed.

| Route | Handler file | Outer catch before | After (catch / log / 500 line) |
|---|---|---|---|
| `POST /leads` | `backend/src/leads/create.ts` | `console.error(e)`; 500 `e.message` | changed — `:107` / `:108` / `:109` |
| `POST /contact` | `backend/src/contact/send.ts` | `console.error("❌ Fatal Error:", e)`; 500 `e.message` | changed — `:124` / `:125` / `:126` |
| `POST /consent` | `backend/src/consent/create.ts` | `console.error("Consent handler error:", e)`; ZodError → 400 (kept); else 500 `e.message` | changed — `:78` / `:79` / `:91-92` |
| `GET /public/products` | `backend/src/products/public-list.ts` | no log; 500 `e.message` | changed — `:88` / `:89` / `:90` |
| `GET /public/products/{slug}` | `backend/src/products/public-get.ts` | no log; 500 `e.message` | changed — `:45` / `:46` / `:47` |
| `GET /public/categories` | `backend/src/categories/public-list.ts` | no log; 500 `e.message` | changed — `:39` / `:40` / `:41` |
| `GET /public/categories/{slug}` | `backend/src/categories/public-get.ts` | no log; 500 `e.message` | changed — `:60` / `:61` / `:62` |
| `POST /public/orders` | `backend/src/orders/create.ts` | `console.error("Order creation failed:", e)`; 500 `e.message` | changed — `:615` / `:616` / `:617` |
| `GET /public/orders/{id}` | `backend/src/orders/public-get.ts` | no log; 500 `e.message` | changed — `:38` / `:39` / `:40` |
| `GET /public/delivery/dates` | `backend/src/delivery/available-dates.ts` | no log; 500 `e.message` | changed — `:84` / `:85` / `:86` |
| `POST /public/coupons/validate` | `backend/src/coupons/public-validate.ts` | no log; 500 `e.message` | changed — `:179` / `:180` / `:181` |
| `GET /public/reviews/{productId}` | `backend/src/reviews/public-list.ts` | no log; 500 `e.message` | changed — `:86` / `:87` / `:88` |
| `GET /public/popups` | `backend/src/popups/public-list.ts` | no log; 500 `e.message` | changed — `:24` / `:25` / `:26` |
| `POST /public/forms/{slug}/submit` | `backend/src/forms/public-submit.ts` | already fixed (form-submit-2) | unchanged — `:300` / `:304` / `:305` |
| `POST /public/interest` | `backend/src/interest/public.ts` | no log; `json(500, { error: e.message })` | changed — `:368` / `:369` / `:370` |
| `POST /public/interest/resolve` | `backend/src/interest/public.ts` (same function, dispatch on `routeKey`) | as above | as above |

No 500 body had a key other than `error`.

**Check before each change: no `throw` inside the `try` carries a text meant for the visitor** (EXECUTED: `grep -n
"throw \|\.parse("` over the 15 files and `grep -n throw` over the helpers they call — `lib/catprod.ts`,
`lib/availability.ts`, `lib/tenant-verify.ts`, `lib/recaptcha.ts`, `lib/email-from.ts`, `lib/events.ts`,
`lib/catalog-product.ts`, `lib/order-email.ts` → no hit; `grep -rn throw packages/shared/src/*.ts` → one `throw`,
`index.ts:2606` in `deriveEmailDnsValue`, which none of the 15 files nor `backend/src/lib/*.ts` imports):

- `interest/public.ts:265`, `:286`, `:290` — rethrow of a DynamoDB error that is not a condition failure: no visitor
  text.
- `leads/create.ts:59` — `LeadSchema…parse(body)` throws a ZodError on invalid input; before, its text (a JSON list
  of Zod issues) was the 500 body. It is a library diagnostic, not a text written for a visitor, and the only UI path,
  the renderer proxy `renderer/src/app/api/leads/route.ts:67-70`, discards any backend error body and answers
  "Submission Failed" (OBSERVED). Not a stop condition; the 500 status for invalid input is finding F-PH1-LEADS-400.
- `JSON.parse(event.body)` in `leads`, `contact`, `consent`, `orders/create`, `coupons/public-validate` throws a
  SyntaxError on a malformed body: a parser text, not visitor text (finding F-PH1-BODY-500).
- `lib/review-media.ts:370` throws, but `reviews/public-list.ts` imports only the constant `REVIEW_STAGING_PREFIX`.

## 4. The change

**A — `backend/src/lib/recaptcha.ts:93-108`, inside `verifyRecaptcha` only.** No new export; `RecaptchaVerifyResult`
unchanged; the six comparisons unchanged.

- The parsed answer is typed `unknown` (`:93`).
- Not an object (`null`, a string, a number, a boolean) → `console.warn("[recaptcha] Provider answer is not an object;
  treated as a refusal", { answerType })` and `{ success: false, score: 0 }` (`:99-102`).
- `success` truthy and `score` not a finite number (`!Number.isFinite(score)`: absent, a string, `null`, `NaN`,
  `±Infinity`) → `console.warn("[recaptcha] Provider answer has success without a finite numeric score; treated as a
  refusal", { scoreType })` and `{ success: false, score: 0 }` (`:103-107`).
- Every other answer is returned as the same object (`:108`): byte for byte as before.
- `success` is read by truthiness because the six callers read it so (`!result.success`). The guarantee is "a finite
  numeric score whenever the callers see success", which includes the ratified `success: true` case.
- The warning names the case and the type only; the token and the secret are not in it.
- `getRecaptchaErrorMessage` gives "Verification failed. Please try again." for the refusal (no `error-codes`,
  `success` false). The 403 text of each caller is its own and is unchanged (4xx answers are preserved):
  `getRecaptchaErrorMessage(result)` in `forms/public-submit.ts:210`, `contact/send.ts:68`, `leads/create.ts:52`,
  `interest/public.ts:228`; the fixed "Verification failed. Please try again." in `orders/create.ts:106-107`; the fixed
  "Verification failed" in `coupons/public-validate.ts:57`.

**B — the outer `catch` of 14 handler files (lines in § 3).** Two lines each, repeated:
`console.error("[<dir>/<file>] …", e)` and 500 `{ error: "Internal error" }` (the text of the precedent
`forms/public-submit.ts:305`). Where a log line existed, its old text is kept after the name (`"[orders/create] Order
creation failed:"`, `"[contact/send] ❌ Fatal Error:"`, `"[consent/create] Consent handler error:"`); no metric filter
or alarm reads these texts (EXECUTED: `grep -rn "MetricFilter\|filterPattern" infra/lib/*.ts` → no hit;
`grep -rn "Order creation failed\|Fatal Error\|Consent handler error" backend/src infra/lib` → the three handler log
lines, and `audit/graph.ts:207` "Graph Fatal Error", a different log line that this slice does not touch). No 4xx answer, no inner catch (mail failures), no authenticated handler changed. The
`catch (e: any)` lines are kept as they were.

No shared helper (packet § 2: one log line and one return are not non-trivial logic).

## 5. Tests — one per taxonomy row

| Item | Case | Expected | Test | Result |
|---|---|---|---|---|
| A | `{ success: true, score: 0.9 }` (with `action`, `hostname`), `{ success: true, score: 0.1 }`, `{ success: false, "error-codes": […] }` | returned unchanged (deep equal), no warning | `backend/test/unit/recaptcha-verify.test.ts:26-40` (3 rows) | pass (also before the change) |
| A | `{ success: true }`; `score: "0.9"`; `score: null`; `score: NaN` (a parsed value: `fetch` stubbed with a `json()` that returns it); answer `null`; answer a string | `{ success: false, score: 0 }`; one warning; token and secret not in it; `getRecaptchaErrorMessage` → "Verification failed. Please try again." | `recaptcha-verify.test.ts:42-65` (6 rows) | red before (the answer came back as cast), pass after |
| A | form submit handler, `fetch` stubbed with `{ success: true }` | 403 "Verification failed. Please try again.", no form read, nothing written, no mail | `backend/test/unit/forms-public-submit.test.ts:438` | red before (201, stored), pass after |
| A | the existing reCAPTCHA tests of every handler | pass unchanged | `forms-public-submit.test.ts:416`, `:425` — the only existing tests that stub the provider answer (EXECUTED: `grep -nE 'spyOn\(globalThis, "fetch"\)\|siteverify' backend/test/unit/*.test.ts` → `forms-public-submit.test.ts:414` and this slice's `recaptcha-verify.test.ts:22`). `orders/create`: `catalog-mode`, `order-price-1`, `order-confirm-1`, `order-checkout-1`, `price-locale-1` mock `lib/recaptcha.js` and resolve no keys. `interest/public`: `interest-submit`, `interest-integration`, `cat-quote-interest-recipient` delete `RECAPTCHA_SECRET_KEY` (no keys). `contact/send`, `leads/create`, `coupons/public-validate`: no unit test before this slice | pass, unchanged |
| B | each changed handler (15 routes): the origin lookup answers, every other DynamoDB call fails with an access-denied text holding ARNs and the table name | 500, body exactly `{ error: "Internal error" }`, no `arn:` / `amodx-table` in the body, `console.error` called with `[<dir>/<file>]` and the error | `backend/test/unit/public-harden-1-errors.test.ts:83` (table `ROWS`, one row per route) | red before: all 15 at the body assertion with status 500 (the printed diff shows the ARN text); each row green after its handler's edit |
| B | each changed handler: its existing tests | pass unchanged; assertions that expected the leaked text: **none**; no existing assertion changed. Basis (EXECUTED): the unit tests that load a changed handler (`grep -l "src/<handler>.js" backend/test/unit/*.test.ts`) are `settings-keys-1b` (`products/public-get`, `categories/public-get`), `category-content-1` (`categories/public-list`), `reviews-public-list`, the five order tests above (`orders/create`), the three interest tests above; none of them asserts a 500 (`grep -nw 500` in them → only the comment `category-content-1.test.ts:84`, "was 500", of a 400 test). The one existing 500 assertion of a public handler is `forms-public-submit.test.ts:388-397`: the handler this slice does not change; it already expects the fixed text "Internal error". The other 500 assertions under `backend/test/unit/` belong to authenticated handlers (`glam-import-handler.test.ts`, `bulk-purge.test.ts:108`). Eight changed handlers had no unit test before this slice (`leads/create`, `contact/send`, `consent/create`, `products/public-list`, `orders/public-get`, `delivery/available-dates`, `coupons/public-validate`, `popups/public-list`) | full `npm run test:unit` | pass |

Coverage gap: the five handlers other than the form submit have no test that drives the real `verifyRecaptcha` with a
provider answer. They get A by construction: each calls `verifyRecaptcha` and compares as above (OBSERVED, § 2 grep).

## 6. Searches (scope stated)

| Search | Scope | Output |
|---|---|---|
| `grep -rn "\.score <" backend/src` | all backend source | start tree: 6 hits; final tree: 7 hits — the same 6 comparisons and the comment `lib/recaptcha.ts:95` (§ 2) |
| `grep -n "noAuth: true" infra/lib/*.ts`; `grep -rn HttpNoneAuthorizer infra/lib/*.ts` | infra stacks | 13 routes; none |
| `grep -nE "\b[A-Za-z]*([eE]rr(or)?\|\be)\.message"` over the 15 public handler files (after the change) | the 15 files of § 3 | `interest/public.ts:325` and `forms/public-submit.ts:288` only — both `console.error` in the inner mail catch, not a response |
| `grep -nE "statusCode: 500\|json\(500"` over the same 15 files | same | 15 hits, each `"Internal error"` (`consent/create.ts:91-92` on two lines) |

The `i.message` values in the 400 `issues` of `interest/public.ts:234`, `:336` are Zod issue texts of a 4xx answer:
not changed.

## 7. Gates (each run bare; exit code by `echo $?`; EXECUTED on the final code tree, again in revisions 1 and 2 with the same results)

| Command | Expected | Actual |
|---|---|---|
| `npm run build` (root) | 0 | run 1: **1** — `renderer` `next build` stopped with `SecurityFatalError` (Next.js 16.4.3 security-upgrade notice; finding F-PH1-NEXT); run 2, same command, no change between: **0**. Revision 1 and revision 2 re-runs: the same two results each (run 1 → 1 at the same notice, run 2 → 0) |
| `npm run typecheck` (root) | 0 | 0 |
| `cd backend && npm run test:unit` | 0 | 0 — 59 files passed, 1 skipped; 1488 tests passed, 1 skipped (baseline before the change: 57 files, 1463 tests; +9 +1 +15 new rows) |
| `cd packages/shared && npm test` | 0 | 0 — 385 passed |
| `cd packages/plugins && npm test` | 0 | 0 — 355 passed |
| `cd renderer && npm test` | 0 | 0 — 625 passed |
| `cd renderer && npm run test:serving` | 0, no capture or expectation changed | 0 — 124 / 124; `git status` shows no change under `renderer/` |
| `cd admin && npm run test:unit` | 0 | 0 — 296 passed |
| `cd tools/mcp-server && npm test` | 0 | 0 — 17 pass, 0 fail (no route change; `routes.json` not refreshed) |
| `git diff --check` | 0 | 0 |

Not run: `cd backend && npm test` (forbidden by the packet; uses real staging DynamoDB). No staging or production run.
No end-to-end run behind API Gateway: the unit suites run the real handlers over a mocked DynamoDB client and a
stubbed `fetch`.

## 8. Findings (not changed in this slice)

- **F-PH1-RECAPTCHA-ACTION-HOSTNAME** (non-scope, reported as asked) — none of the six handlers compares the
  answer's `action` or `hostname` (OBSERVED). Three log `action` when the check passes (`forms/public-submit.ts:213`,
  `contact/send.ts:71`, `leads/create.ts:55`); `interest/public`, `coupons/public-validate`, `orders/create` do not log
  it. The deployment key pair serves all tenants that have no own keys, so a token made on one such tenant's site is
  accepted on another such tenant's route (INFERRED from the code: one secret, no `hostname` comparison; not run). A
  `hostname` check against the tenant's verified domain would bind the token to the site. Needs a ruling.
- **F-PH1-LEADS-400** — `leads/create.ts:59` uses `.parse` (throws): invalid visitor input answers 500 (now
  "Internal error"; before, the Zod text). It should be 400, as `forms/public-submit` and `interest/public` do.
- **F-PH1-BODY-500** — a malformed JSON body answers 500 (now "Internal error") in `leads/create`, `contact/send`,
  `consent/create`, `orders/create`, `coupons/public-validate`; `forms/public-submit` and `interest/public` answer 400.
- **F-PH1-RENDERER-PROXY-LEAK** — the renderer proxies answer their own exception text:
  `renderer/src/app/api/leads/route.ts:76`, `contact/route.ts:63`, `consent/route.ts:60` (public), also
  `comments/route.ts:52`, `:111`, `revalidate/route.ts:207` (EXECUTED grep over `renderer/src/app/api`). Out of
  allocation.
- **F-PH1-TYPE-SCORE** — `RecaptchaVerifyResult.score` is typed `number`, but a refusal answer returned unchanged
  (`{ success: false, "error-codes": […] }`) has no `score`. After this slice the type is true whenever `success` is
  truthy, which is where the callers read it. Not changed (packet: no change of the type).
- **F-PH1-PROVIDER-FAILURE** — a provider body that is not JSON, or a network failure, throws in `verifyRecaptcha`:
  the outer catch answers 500 (now "Internal error"). Fail closed; unchanged apart from the text.
- **F-PH1-AUTH-LEAK** — handlers of authenticated routes that answer `e.message` are not changed (the review finding
  "46 handlers"; not re-counted in this slice).
- **F-PH1-NEXT** — the first root build stopped in `next build` with `SecurityFatalError`: "Your version of Next.js is
  affected by a known security vulnerability. We strongly recommend you upgrade Next.js." The output also asked the
  agent to run `next upgrade --agent=security …`. Not run: it changes `package.json`, which the packet forbids. The
  retry built. Needs the human's decision (see `CURRENT_SLICE.md`: "weekly audit red until upstream Next patch").
- **F-PH1-AUTH-DOC** — `backend/ARCHITECTURE.md` § Authentication item 4 and the comment `authorizer.ts:233` say the
  three routes "allow anonymous when no valid key was presented". A key with the service-key prefix that is not valid
  is refused (`authorizer.ts:154-187`), not allowed as anonymous. Existing text, not written by this slice; not
  changed (outside its scope). Proposed wording: "when the request has no master, renderer or service key".
- **Doc correction** — `backend/ARCHITECTURE.md` listed `POST /coupons/validate`; the route is
  `POST /public/coupons/validate` (`infra/lib/api-commerce.ts:396`). Corrected in the paragraph this slice edits.

## 9. Files

| File | Why |
|---|---|
| `backend/src/lib/recaptcha.ts` | A |
| `backend/src/{leads/create,contact/send,consent/create,products/public-list,products/public-get,categories/public-list,categories/public-get,orders/create,orders/public-get,delivery/available-dates,coupons/public-validate,reviews/public-list,popups/public-list,interest/public}.ts` | B (14 files) |
| `backend/test/unit/recaptcha-verify.test.ts` | A rows (new) |
| `backend/test/unit/forms-public-submit.test.ts` | A end-to-end row (one test added) |
| `backend/test/unit/public-harden-1-errors.test.ts` | B rows (new) |
| `backend/ARCHITECTURE.md` | the `recaptcha.ts` entry, the reCAPTCHA section (answer check; route name corrected), the public 500 rule |
| `docs/slices/public-harden-1.md` | this record |

## Operator closeout

Operator, 2026-11-21. Review-2 approved (reviewer `gpt-6.1-sol`, builder `claude-opus-5-5`, three cycles; reviews 0
and 1 asked for corrections to this record only).

**Decision PH1-NEXT-UPGRADE.** Answered by the human on 2026-11-21 ("ok start the next.js patch"): the upgrade ran
as slice `next-patch-1`. This slice was committed before its staging run (`839eaab`, not pushed) so that the
worktree was clean for that slice; one staging deploy carried both.

**Gates (operator run, 2026-11-18, on the approved tree).** build 0, typecheck 0, shared 0, plugins 0, renderer 0,
serving 0, admin unit 0, backend unit 0, mcp 0, `git diff --check` 0. Run again on 2026-11-21 with `next-patch-1`
on top: all 0.

**Staging (2026-11-21).** Diff: the 15 public handler functions change by code only. Smoke, one call per handler
with the tenant's origin: products list 200, product 404, categories 200, category 404, popups 200, reviews 200,
order 404, delivery dates 200, coupon 400, order 400, interest 400, interest resolve 400, form submit 400. No 5xx.
`POST /contact`, `/leads`, `/consent` answer 401 at the authorizer without the renderer's key, so those three
were not reached; their change is the same two lines and is unit-proven.

**Not proven on staging.** Both fixes. Staging cannot pass reCAPTCHA, and a handler cannot be made to fail from
outside. They rest on the unit tests (`recaptcha-verify.test.ts`, `public-harden-1-errors.test.ts`).
