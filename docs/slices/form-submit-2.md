# FORM-SUBMIT-2 — the form submit handler: findings of the second review (implementation record)

Status: **IMPLEMENTED** (2026-11-16, builder `claude-opus-5-5`), uncommitted, awaiting review. Start: `main` at
`17a710b`, tree clean. Maturity: the submit handler stays **PROTOTYPE** until the operator's staging run of
`docs/slices/shop-look-1e.md` (its Operator closeout). Task definition: the builder packet of 2026-11-16 (operator).

## 1. The review

`backend/src/forms/public-submit.ts` takes input from anonymous visitors. Before the production deploy the human asked
for a second review by another vendor's model (2026-11-16: "openai reviewer is back").

| Item | Value |
|---|---|
| Model | `gpt-6.1-sol` (OpenAI Codex v0.160.0, reasoning effort high) |
| Mode | standalone, sandbox read-only, source only (handler and test file inlined in the prompt) |
| Tests | NOT RUN by the reviewer ("Inlined source review only. Tests were NOT RUN.") |
| Verdict | DEPLOY AFTER FIXES — 3 "blocker", 3 "should-fix", plus notes on the tests |
| Checked by | the operator, each finding on the code; the packet lists the confirmed and the answered findings |

## 2. Findings → disposition → change → test

Handler lines are on the final tree (`backend/src/forms/public-submit.ts`); test lines on the final
`backend/test/unit/forms-public-submit.test.ts`.

| # | Finding (reviewer severity) | Disposition | Change (file:line) | Test (line) |
|---|---|---|---|---|
| A | A valid value equal to an internal marker (`"invalid"`, `"too-long"`) is refused (blocker) | confirmed | `CleanedValue` sum type, `:56-59`; `cleanValue` returns it, `:62-96`; `cleanSubmission` matches the refusal exhaustively, `:114-125` | `:379` A (red before: 400; now 201, stored); "wrong type still refused" = `:157` unchanged, green; "over the limit still refused" = `:180` unchanged, green |
| B | A server failure answers with the exception's message (blocker) | confirmed | `catch (e)` logs `console.error("[forms/public-submit] Error:", e)` and answers 500 `{ "error": "Internal error" }`, `:300-307`. Text reused from `backend/src/system/invalidation.ts:80` (also `:135`) | `:388` B (red before: the full AccessDenied text with the table ARN in the body) |
| C | A number field takes text of any length (should-fix, part) | confirmed | number text longer than `MAX_TEXT` (500) after trim → `TOO_LONG`, before the pattern test and `Number()`, `:80-81` | `:400` C (red before: 201, `Count` = 1) |
| D1 | The `__proto__` test sends no own `__proto__` key (object literal) | confirmed | test only: body built from JSON TEXT; asserts the own keys are in the sent body, 201, the stored keys, `Object.prototype` has no `polluted`, the stored `data` prototype is `Object.prototype` | `:102` |
| D2 | The "no-store" test does not assert the header | confirmed | test only: `call` also returns `headers`; the test asserts `{ "Cache-Control": "no-store" }` | `:290`, `:293` |
| D3 | reCAPTCHA provider refusal without a test | confirmed | test only (fetch stubbed) | `:416` → 403 "Verification failed. Please try again.", no form read, nothing written, no mail |
| D4 | score under the threshold without a test | confirmed | test only | `:425` → 403 "Verification failed due to low score.", nothing written, no mail; a score AT the threshold → 201 |
| D5 | no slug in the path without a test | confirmed | test only | `:439` → 400 "Missing form slug", no form read |
| D6 | a slug pointer whose form record is missing, without a test | confirmed | test only | `:446` → 404 "Form not found", both reads under `TENANT#t1`, nothing written |
| D7 | (A) markers stored — text field and select option | confirmed | see A | `:379` |
| D8 | (B) DynamoDB fails → fixed text, failure text not in the body, logged | confirmed | see B | `:388` (asserts no `arn:` and no `amodx-table` in the body; `console.error` called with a text holding `forms/public-submit` and the error object; no mail) |
| D9 | (C) the long number text → 400 | confirmed | see C | `:400` (`"0"` × 100 000 + `"1"` → 400 "Value too long" naming `Count`; 500 characters → 201) |
| D10 | The malformed-body test checks no FORM read, not "nothing read past the origin check" as its title says | same class as D2, closed in this slice (§ 4, R-TITLE) | test only: one assertion, `GetCommand` calls = 0 | `:119` |
| — | "The submitter email should come only from the first email field" (blocker) | answered, no change | — | — (rule: `docs/slices/shop-look-1e.md`, "Submitter email") |
| — | "An empty body is accepted as `{}`" (should-fix) | answered, no change | — | — |
| — | "Two fields with one label" (should-fix) | answered: known F-1E-DUPLICATE-LABEL, fix belongs to the form SAVE path | — | — |
| — | reCAPTCHA: a success without a score | answered: report only (§ 3) | — | — |
| — | "Input is not bounded before processing", the parts other than C: no request-size limit before `JSON.parse`; a text limit applies after trim; a select value has no own length check | NOT answered by the packet; not built | — | — (finding F-FS2-BODY-BOUND, § 5) |

Every other 2xx and 4xx answer keeps its status and body: the 31 tests of the file before this slice stay green; the
three changed tests (`:102`, `:119`, `:290`) gained assertions and lost none; the `call` helper (`:48-59`) also returns `headers`.

## 3. reCAPTCHA reading (packet § 2; report only, no change)

`verifyRecaptcha` (`backend/src/lib/recaptcha.ts:73-95`) returns `await response.json()` cast to
`RecaptchaVerifyResult`. It does not validate the answer. The type says `score: number`, but no code makes it so.

- A success answer without a score (for example the answer of a reCAPTCHA **v2** secret: `success`, `challenge_ts`,
  `hostname`, no `score`) gives `result.score === undefined` at run time. OBSERVED (code).
- The handler's refusal test is `!result.success || result.score < recaptchaConfig.threshold` (`public-submit.ts:208`).
  `undefined < 0.5` is `false` (`undefined` converts to `NaN`; every comparison with `NaN` is false). So the condition
  is `false || false` → the request **passes**. EXECUTED:
  `node -e 'const r={success:true}; console.log(r.score < 0.5, !r.success || r.score < 0.5)'` → `false false`.
- Conclusion: yes, a success answer without a score passes the check. It also logs `score=undefined`. The handler and
  the helper do not check `action` or `hostname` either. INFERRED (not checked against Google): a v3 secret always
  returns a score; the case needs a v2 key pair configured as the tenant's (or the deployment's) keys.
- The helper is shared with the other public handlers and is not in this allocation (finding F-FS2-RECAPTCHA-SCORE,
  § 5).

## 4. Design and rules

- `CleanedValue` — a sum type `{ ok: true; value } | { ok: false; reason: "invalid" | "too-long" }`, local to the file;
  one user (`cleanSubmission`); axis: variants fixed, operations (refusal handling) per variant → exhaustive `switch`
  with a `never` arm, the idiom the file already uses for `field.type`. Rejected: keep the string markers (the defect)
  or a `Symbol` marker (still one union type of value and refusal). Two constructors `accepted(value)` and the
  constants `INVALID`, `TOO_LONG` keep each `return` one short line; no other structure.
- Exhaustiveness is proven, not assumed. EXECUTED: a copy of the handler (`src/forms/FORM-SUBMIT-2-probe.ts`, deleted
  after) with a third reason `"probe-variant"` → `tsc` error TS2322 `Type '"probe-variant"' is not assignable to type
  'never'` at the `default` arm.
- C: the limit is the text limit (`MAX_TEXT`, 500), tested after trim and before the pattern test and `Number()`. A
  JSON number value has no text and no length check (unchanged).
- B: the pre-check of the packet: `grep -n throw` in `lib/recaptcha.ts`, `lib/tenant-verify.ts`, `lib/email-from.ts`,
  `lib/db.ts` → no match; the handler has no `throw`; `verifyTenantFromOrigin` catches its own failures
  (`tenant-verify.ts:51`, `:64`). Only SDK and `fetch` failures reach the outer `catch`; no text meant for the visitor
  is lost. An SES failure is caught at `:275-289` and stays "logged only, 201" (unchanged).
- **R-TITLE** (the rule that closes the class of D2 and D10): a test title states only what its assertions prove; when
  the title says "nothing read", "no-store" and similar, an assertion checks exactly that. The titles of
  `forms-public-submit.test.ts` were read against their assertions; D2 and D10 were the only gaps found (INFERRED, by
  reading).

## 5. Findings (not changed in this slice)

- **F-FS2-ERROR-LEAK** — the same `e.message` answer to an anonymous caller exists in:
  `backend/src/contact/send.ts:126`, `backend/src/interest/public.ts:369`, `backend/src/orders/create.ts:617`
  (named by the packet), and also `backend/src/consent/create.ts:92` (`POST /consent` is public:
  `backend/src/auth/authorizer.ts:236` lets the route key through before any JWT check). The same fix as B applies to
  each. OBSERVED (grep).
- **F-FS2-RECAPTCHA-SCORE** — `verifyRecaptcha` does not validate the provider answer; a success without a score
  passes `public-submit.ts:208` (§ 3). The same comparison exists in the other public handlers that use the helper
  (INFERRED, not listed here). Smallest fix: the helper (or the check) treats a non-number score as a refusal.
- **F-FS2-BODY-BOUND** — the review's "input not bounded" finding, beyond C: no request-size limit before
  `JSON.parse`; text limits apply after trim (a long run of spaces around a short value is accepted); keys that are
  not labels are parsed and dropped. A select value cannot exceed its stored option (exact match, `:90`). The outer
  bound is the platform's request size limit (INFERRED: API Gateway / Lambda payload limits; not checked in this
  slice). Needs an operator ruling.
- **Status word** — `docs/slices/shop-look-1e.md` uses "BUILT", which is not in the status taxonomy of
  `docs/documentation.md` § Status taxonomy; this record uses `IMPLEMENTED`.

## 6. Gates (each run bare; exit code by `echo $?`; EXECUTED on the final code tree after a fresh root build)

| Command | Expected | Actual |
|---|---|---|
| `npm run build` (root) | 0 | 0 |
| `npm run typecheck` (root) | 0 | 0 |
| `cd backend && npm run test:unit` | 0 | 0 — 57 files passed, 1 skipped; 1463 tests passed, 1 skipped |
| `cd packages/shared && npm test` | 0 | 0 — 385 passed |
| `cd packages/plugins && npm test` | 0 | 0 — 355 passed |
| `cd renderer && npm test` | 0 | 0 — 625 passed |
| `cd renderer && npm run test:serving` | 0, no capture or expectation changed | 0 — 124 / 124; `git status` shows no change under `renderer/` |
| `cd admin && npm run test:unit` | 0 | 0 — 296 passed |
| `cd tools/mcp-server && npm test` | 0 | 0 — 17 pass, 0 fail (no route change; `routes.json` not refreshed) |
| `git diff --check` | 0 | 0 |
| red phase: `cd backend && npx vitest run --config vitest.unit.config.ts test/unit/forms-public-submit.test.ts` on the unchanged handler | A, B, C fail | 3 failed, 35 passed (A: 400; B: the ARN text in the body; C: 201) |

The D10 assertion was added after the full gate run. Re-run on the final tree after it (EXECUTED): the test file
38 / 38 passed; `npm run typecheck` → 0; `cd backend && npm run test:unit` → 0 (1463 passed, 1 skipped);
`git diff --check` → 0. The other suites do not import the backend test file or the handler (INFERRED from the package
layout: backend is not a dependency of shared, plugins, renderer, admin or the MCP server).

Not run: `cd backend && npm test` (forbidden by the packet; uses real staging DynamoDB). No staging or production run.
No end-to-end run of the handler behind API Gateway: the unit suite runs the real handler over mocked DynamoDB, SES and
`fetch`.

## 7. Files

| File | Why |
|---|---|
| `backend/src/forms/public-submit.ts` | A, B, C |
| `backend/test/unit/forms-public-submit.test.ts` | A–C red tests; D1–D10 |
| `backend/ARCHITECTURE.md` | the handler entry states the number-text limit and the 500 behaviour (changed behaviour) |
| `docs/slices/form-submit-2.md` | this record |

## Operator closeout

2026-11-16. Source of the slice: a standalone, read-only review of the handler and its test file by `gpt-6.1-sol`
(another vendor than the builder; source only, it ran no test), verdict "deploy after fixes". The operator checked
each finding on the code before the packet. Builder `claude-opus-5-5`; relay reviewer `gpt-6.1-sol`, approved on the
first cycle. The operator ran the ten gates on the unchanged candidate: all exit 0, the allocation oracle empty.
Staging diff: the form submit function, the renderer functions, one bucket deployment, the admin config,
descriptions; deployed.

Staging (direct `POST /public/forms/{slug}/submit`, tenant `cm1-commerce`): a malformed body → 400; a body that is a
list → 400; no token → 400 "CAPTCHA verification required"; a wrong origin → 403; no answer holds internal text.
This proves the deployed function loads and keeps its early refusals. The three fixes (A, B, C) are behind the
reCAPTCHA check, which staging cannot pass: they are proven by the unit tests only.

Operator rulings on the findings:

- F-FS2-BODY-BOUND: no change. The request size is bounded by the platform before the function runs; the stored
  value is bounded after trim, which is the value that is kept. No user-visible gain names a tighter limit.
- F-FS2-RECAPTCHA-SCORE and F-FS2-ERROR-LEAK: open, for the human's ordering (shared helper and four other public
  handlers; outside this slice).

Prod deploy: the human's.
