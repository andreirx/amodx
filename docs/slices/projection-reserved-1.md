# PROJECTION-RESERVED-1 — DynamoDB expressions that name a reserved word (hotfix)

> Operator-opened hotfix, 2026-11-27, ahead of the order of work in `docs/ROADMAP.md` (a served admin route was
> broken). No draft existed; this file was written by the builder (`claude-opus-5-5`) from the operator packet.
> Reviewer: `gpt-6.1-sol`. It surfaces no new ratification-class decision.

Status: **IMPLEMENTED 2026-11-27 — built, operator gates pending** (staging deploy and the staging check are the
operator's). Track: hotfix (outside the tracks). Depends: none. Maturity target: no change (the touched handlers keep
their maturity; the guard is test infrastructure).

## Purpose / risk retired

DynamoDB refuses a whole request when an expression names a reserved word as a bare attribute name. The refusal is a
`ValidationException`, so the handler answers 500. The risk this slice reduces is the CLASS: a bare reserved word that
no gate sees before staging. It retires it for every expression a backend unit test reaches (the run-time guard);
for the rest, the static lint is a lint, not a proof (§ "Operator ruling PR1-STATIC-SCOPE"). The unit suites ran handlers against test doubles that do not validate expressions, so
the refusal was invisible until a real table answered.

## Cause (operator-verified on staging, 2026-11-27, commit `81789e0`)

- `GET /orders` → 500 `{"error":"Invalid ProjectionExpression: Attribute name is a reserved keyword; reserved
  keyword: total"}` — `backend/src/orders/list.ts`, `total` bare in the projection.
- `GET /reviews` → 500, the same error with `source` — `backend/src/reviews/list.ts`, `PROJECTION`.
- The same projection sent to the staging table with the AWS CLI is refused by DynamoDB with the same text, so the
  cause is the expression. Both files are old (orders 2026-02-15, reviews 2026-08-08).

The audit (§ "Audit") found three more sites of the same class. What each broke for a person:

| Site | Route | Who saw it | Before | After |
|---|---|---|---|---|
| `backend/src/orders/list.ts` | `GET /orders` | owner: the admin Orders list | 500 | 200, the list |
| `backend/src/reviews/list.ts` | `GET /reviews` | owner: the review moderation list | 500 | 200, the list |
| `backend/src/reports/summary.ts` | `GET /reports/summary` | owner: the admin Reports page | 500 | 200, the report |
| `backend/src/resources/presign.ts` | `GET /resources/{id}/download-url` | a signed-in non-admin (today only the MCP tool calls this route) | 500 | 403 "Purchase required" — F-CMRC1-PRESIGN-ENTITLEMENT, see below |
| `renderer/src/lib/dynamo.ts` `getCustomerOrders` | `/api/account/orders` (renderer) | a signed-in customer: the order history of the account page | 500 "Failed to fetch orders" | 200, the orders |

Evidence labels: the orders and reviews rows are OBSERVED on staging by the operator. The other three are INFERRED
from the code (same expression form, same reserved words, same `catch` → 500) and EXECUTED against the unit guard
(§ "Build record"); they are NOT RUN against real DynamoDB.

The presign row: `hasUserPurchasedProduct` reads `items` from `CUSTORDER#` items, and `orders/create.ts` stores those
items without `items` (`orderNumber, total, status, createdAt, Type`). So after the fix the answer is the 403 that
`docs/TECH-DEBT.md` § F-CMRC1-PRESIGN-ENTITLEMENT already describes. That entry said the route answered 403 before; it
answered 500. The entry is corrected; the delivery-path gap itself stays open (a product decision, not this slice).

## Scope

1. Fix: every bare reserved attribute name in an expression gets an `ExpressionAttributeNames` alias, merged with the
   aliases already there. Five sites, § "The fix". The returned item shape does not change: an alias changes the
   request only.
2. Audit: every DynamoDB expression in the code that reaches DynamoDB, § "Audit" and § "Appendix — audit table".
3. Guard: the reserved-word list in one file; every unit-test double refuses a bare reserved word with DynamoDB's text;
   a static lint of the expression sites (a lint, not a proof); § "The guard".
4. The renderer read is in the audit and fixed; the serving suites run (§ "Build record").

## Non-scope

- Any change to what a route returns beyond the fix itself (the presign 403 is the existing logic, now reached).
- Pagination or performance of the lists. `infra/`. No IAM change: an alias needs no permission.
- F-CMRC1-PRESIGN-ENTITLEMENT (the digital-product delivery path).
- Other DynamoDB expression rules (unused aliases or values, syntax, size limits). The guard checks reserved words
  only.

## Architectural boundaries

- Tenant isolation, the no-Scan rule and the key shapes are unchanged: every fixed request is the same `QueryCommand`
  on `PK` + `begins_with(SK)` with the same values.
- The reserved-word list is in `backend/src/lib/` (the packet's location) but no handler imports it, so it is in no
  Lambda bundle. The renderer cannot import backend code; the static scan reads renderer source files as text.
- No new runtime dependency. `typescript` (already a backend devDependency, 5.9.3 hoisted) is used by the scan.

## The fix

| File | Before | After |
|---|---|---|
| `backend/src/orders/list.ts` | `…, paymentStatus, total, currency, createdAt`; names `{ "#s": "status" }` | `#total`; names `{ "#s": "status", "#total": "total" }` |
| `backend/src/reviews/list.ts` | `PROJECTION` `…, content, source, #s, …`; `NAMES` `{ "#s", "#sc" }` | `#source`; `NAMES` adds `"#source": "source"` |
| `backend/src/reports/summary.ts` | `id, #s, total, …, items, …`; names `{ "#s": "status" }` | `#total`, `#items`; names add both |
| `backend/src/resources/presign.ts` | `ProjectionExpression: "items"`; no names | `"#items"`; names `{ "#items": "items" }` |
| `renderer/src/lib/dynamo.ts` (`getCustomerOrders`) | `orderNumber, total, #s, createdAt, SK`; names `{ "#s": "status" }` | `#total`; names add `"#total": "total"` |

Every new alias is used by its expression (DynamoDB refuses an unused alias), and each is added in the same object as
the expression, so no branch sends one without the other.

## The guard

Three parts. Under the hood:

1. **`backend/src/lib/dynamo-reserved-words.ts`** — `DYNAMO_RESERVED_WORDS`, the 573 words of the official page
   (<https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html>, copied 2026-11-27 with
   `curl`, upper case, source order). DynamoDB compares without regard to case, so the check upper-cases the name.
2. **`backend/test/unit/dynamo-expression-guard.ts`**:
   - `bareNames(expression, kind)` tokenizes with `/[#:]?[A-Za-z_][A-Za-z0-9_]*/`. It drops `#alias` and `:value`
     tokens, a function name followed by `(` (`attribute_exists`, `attribute_not_exists`, `attribute_type`,
     `begins_with`, `contains`, `size`, `if_not_exists`, `list_append`), and the keywords of the kind: `AND OR NOT
     BETWEEN IN` for Filter / KeyCondition / Condition, `SET REMOVE ADD DELETE` for Update, none for Projection. Each
     path segment counts (`who.name` → `who`, `name`). `bareReservedWords` keeps the reserved ones.
   - `assertNoBareReservedWord(input)` walks one command input (top level, `RequestItems[table]`,
     `TransactItems[i].Put/Update/Delete/ConditionCheck/Get`), skips item data (`Item`, `Key`, `Keys`,
     `ExpressionAttributeValues`, `ExclusiveStartKey`) and throws `ValidationException` with DynamoDB's text:
     `Invalid <Kind>: Attribute name is a reserved keyword; reserved keyword: <name>`.
   - `scanExpressionSites(file)` — the static scan, below.
3. **`guardCommandClasses(module)`** (in `dynamo-expression-guard.ts`) returns the module with `GetCommand`,
   `PutCommand`, `UpdateCommand`, `DeleteCommand`, `QueryCommand`, `ScanCommand`, `BatchGetCommand`,
   `TransactGetCommand` and `TransactWriteCommand` (those it exports) replaced by same-named subclasses whose
   constructor first calls `assertNoBareReservedWord`. **`backend/test/unit/dynamo-reserved-setup.ts`** — a
   `setupFiles` entry of `backend/vitest.unit.config.ts` — `vi.mock`s `@aws-sdk/lib-dynamodb` for every unit test file
   as the real module passed through it. A test file that replaces the module with its own `vi.mock` factory replaces
   that mock for the file; the rule is that such a factory returns its module through `guardCommandClasses` too. Four
   files do (`debounce-flush`, `debounce-maxwait`, `invalidate-cdn`, `lang-1b-deferred-flush`), each with one
   rejection-control row, and a structural row of `projection-reserved-1.test.ts` fails on any replacement that does
   not call it (review finding PR1-GUARD-BYPASS). A handler that builds a bad command throws inside its own `try`, so
   it answers 500 with DynamoDB's message, whatever double receives the command.

**Why the constructor and not each double's `send`.** The doubles are not one module: `MemoryTable`
(`memory-table.ts`), `LangTable` (`lang-1a-table.ts`; `ImportTable` extends it), a test-local `MemTable`, about 40
ad-hoc `vi.fn` mocks of `lib/db.js` and 13 `aws-sdk-client-mock` files. The packet's fallback — one exported assertion called
by each double — needs an edit in every one of them and stays open to the next ad-hoc mock. The command constructor is
the one point all of them share. The subclass keeps `constructor.name` (several doubles dispatch on it) and
`instanceof` (the code under test and the test import the same mocked module). One difference from DynamoDB: the
refusal happens when the command is built, not when it is sent. The handlers build each command inside or just
before its `db.send(…)`, so the observable answer is the same (INFERRED from the audited sites, not proven for every
handler).

**The static scan** (`scanExpressionSites`, TypeScript compiler API, syntax only) is a **lint for the construction
forms the repository uses today, not a proof** (§ "Operator ruling PR1-STATIC-SCOPE"). It finds the sites written in
these forms that write
`ProjectionExpression`, `FilterExpression`, `KeyConditionExpression`, `ConditionExpression` or `UpdateExpression`:
an object property with a plain or quoted key or a computed key the scan resolves (such as a `const`), a shorthand
property, and `x.<Kind>` or `x["<Kind>"]` assigned with `=` / `+=`; a site whose key comes from a value it cannot
resolve is not found. It resolves the value to the texts it
can derive from the forms it models: string literals and templates, `+`, `?:`, `??`/`||`, `const`s in the file or imported by a relative (or the
renderer's `@/`) specifier, `[…].join()`, `.filter()`, `.map(arrow)` (the arrow's body), property reads of object
literals, return values of same-file functions, and parameters of a non-exported named function (the arguments of
each same-file direct call `name(…)`; calls through an alias, `.call` / `.apply` or a callback are not seen).

How it treats change (review finding PR1-STATIC-FALSE-CLEAN, revisions 1 and 2). This paragraph describes the syntax
the scan recognizes and what it reports, not what the program does. It reports a change it recognizes as unmodelled as
a hole; a change made through a form it does not recognize **can pass as clean** — the known forms are in
`docs/TECH-DEBT.md` § F-RESERVED-SCAN-LIMITS. A `let` or an object property is a slot: its derived texts are the
initial value, the value of each recognized `=` of the file, and each recognized `+=` tail **only when every text of
the tail starts with a separator** (such a tail cannot join a token of the text before it; `"tot" += "al"` is
reported as a hole). A write made through another name (an alias, `this`, a callback parameter) is not recognized as a
write to the slot. An array is resolved only when it is a `const` changed by recognized dot `.push()` / `.unshift()`
calls alone; its `.join()` treats each element as a whole token group and ignores order, which is wrong for name
fragments joined with an empty separator (`p.unshift("tot"); p.join("")`). Any other recognized write (another
operator, destructuring, `x[<computed>] = …`, a reassigned `let` array or object) makes the read a hole, and so does a
use of the binding that the classifier (`hasUnmodelledUse`) recognizes as outside its **allow-list**:

- a member read that is not called, as the classifier sees it (`p.x`, `p["x"]`, `p[i]`);
- a DOT call with the name `push` / `unshift` (collected) or the name of a read-only array method — `join`, `map`,
  `filter`, `flatMap`, `some`, `every`, `find`, `findIndex`, `forEach`, `includes`, `indexOf`, `slice` — where a
  callback, if the method takes one, is an arrow with at most two declared parameters (this rejects a named third
  `array` parameter, not a rest parameter `(...a) =>`); the method name is not proof that the receiver is a native
  array;
- the target of a write (judged as above), a spread, a template span, the declaration itself, an import, and the input
  of `new <Name>Command(…)` (assumed: an SDK command keeps its input as given).

The classifier reads the syntax right around each use, so some unmodelled forms read as allowed (for example a
parenthesised or cast-wrapped call `(p.push)("total")`; see F-RESERVED-SCAN-LIMITS). Uses it recognizes as outside the
allow-list: another call name on the binding (`splice`, `p.change()`), a call through a bracket (`p["push"](…)`), a
callback that is not such an arrow, passing the binding to a call, an alias `const q = p`, `return p`, `{ p }`, and an
export it sees — an `export` modifier on the declaration (here or in the module it is imported from), or
`export { p }` / `export default p` in the file being scanned. A separate `export { p }` in the module a binding is
imported from is not seen. An object literal with behaviour written in the literal — a method, a getter / setter, or a
function or arrow initializer — is reported as a hole when one of its members is read; a function given through an
identifier (`{ join: change }`) is not recognized. A part it cannot resolve becomes a hole. A hole right after `#`, `:`
or `[` is treated as part of that alias, value placeholder or list index and reported as no bare name — that holds only
if the run-time value holds no separator, which the scan does not check; any other hole is reported "unresolved".
Same-named declarations in different scopes are all taken, so shadowing makes the scan report more texts, not fewer;
this says nothing about the forms above that it does not recognize.

The test (`backend/test/unit/projection-reserved-1.test.ts`) scans `backend/src`, `renderer/src`, `scripts`,
`tools/mcp-server/src`, `tools/mcp-server/scripts`, `tests` and `backend/test/*.ts` (the staging integration suites)
and asserts: (a) at least 290 sites (the audit counted 301 — a much lower number means the scan broke); (b) no
resolved text holds a bare reserved word; (c) the unresolved sites are exactly the hand-audited ones, counted by
`file kind` (`AUDITED_RUNTIME_SITES`). A new unresolved site fails (c) until someone audits it and adds it; a site the
lint wrongly resolves as clean does not (F-RESERVED-SCAN-LIMITS). Further rows scan small sources from text: each
LISTED case (the five probes of review 0, a call, an alias,
an export, `splice`, a computed-key write, and the seven cases of review 1 — `p["push"]`, `p["splice"]`, a method
writing through `this`, a callback with an `array` parameter, `export { p }`, `export default p`, a getter) must end
"reserved word found" or "unresolved", never clean; controls (`+=` with a
separator, `const` array with `push`, `params.FilterExpression += …` before `new QueryCommand(params)`) stay resolved
and clean, and a bare word inside them is still found.

Abstraction record (one line each):

- `DYNAMO_RESERVED_WORDS` — the word list; users: the double guard and the static scan; axis: none (data, one copy);
  rejected: a copy in each test (two copies drift).
- `dynamo-expression-guard.ts` — tokenizer + command assertion + static scan; users: `dynamo-reserved-setup.ts` and
  `projection-reserved-1.test.ts`; axis: none (one rule, two entry points); rejected: the rule inline in the test file
  (the setup file needs it too).
- `dynamo-reserved-setup.ts` — one interception point for all doubles; users: every unit test file; axis: the doubles
  grow by ad-hoc mocks (demonstrated: about 55 doubles today); rejected: an `assertNoBareReservedWord` call in each double (≈55
  edits, open to the next mock).
- `guardCommandClasses` — the one way to supply `@aws-sdk/lib-dynamodb` in a unit test; users: the setup file and the
  four files with their own factory (5); axis: test files that replace the module (demonstrated: 4); rejected: a
  separate guard call written into each fake class (four different fake shapes, and nothing would stop a fifth file
  from omitting it).
- The scan's parameter / `let` / return-value resolution — rejected the smaller literal-and-`const`-only scan: it left
  37 sites to the hand audit, and a hand-audited "parameter" site (for example `interest/public.ts` `readProducts`,
  whose callers pass `SUBMIT_PROJECTION`) would not fail when its constant later gains a bare reserved word. With the
  resolution, 12 sites remain by hand, and none of them takes a projection constant from a caller.

## Audit

**Basis.** The scan above, run over the directories listed in § "The guard" (305 files). Reconciled with a plain text
search (EXECUTED):

```
grep -rnE '\b(Projection|Filter|KeyCondition|Condition|Update)Expression\b' \
  backend/src renderer/src scripts tools/mcp-server/src tests backend/test/*.ts \
  --include='*.ts' --include='*.tsx' --include='*.mjs' | grep -vE '^[^:]+:[0-9]+:\s*(//|\*|/\*)'
```

305 lines. Every line is a scan site except four that are not expressions: `content/restore.ts:72` and
`import/wordpress.ts:353` (type annotations), `lib/scheduling-db.ts:251` (a return type), and
`backend/test/scheduling-db.integration.test.ts:158` (a test comparing an expression it received). Legacy parameters
that have no expression (`AttributesToGet`, `KeyConditions`, `QueryFilter`, `ScanFilter`, `AttributeUpdates`) and
PartiQL (`ExecuteStatement`) have no hits; neither do the paginators (`paginateQuery`, `paginateScan`). `admin/`,
`packages/` and `infra/` hold no DynamoDB expression (`infra/` was searched, not changed).

Completeness claim and its limit: the text search finds every expression written with one of the five property
names. An expression that reaches a command under another name (an object built elsewhere and spread in) still has
its property named somewhere, so the search finds its source. A static search cannot prove what a run-time value holds;
§ "Run-time sites" lists those sites and why each is safe.

**Result** (lint results, not proof — § "Operator ruling PR1-STATIC-SCOPE"). 301 sites: 5 FIXED, 275 clean (resolved by the lint, no bare reserved word reported), 9 clean with run-time parts only in
alias / value / index position, 12 run-time sites clean by hand audit. Per area: `backend/src` 242, `renderer/src` 49,
`scripts/migrate-commerce-private-table.ts` 1, `tests/e2e` 3, `backend/test/*.ts` 6. The full table is the appendix.

### Run-time sites (12) — hand audit

| Site | Kind | Run-time part | Why it is safe |
|---|---|---|---|
| `backend/src/content/create.ts:121` | Condition | `plan.selfCondition.expression` | `selfCondition` comes from `keyAsRead` (`content/update.ts:48-51`): `attribute_not_exists(translationKey)` or `translationKey = :tkRead`. Bare name `translationKey`, not reserved |
| `backend/src/content/update.ts:408`, `:414` | Condition | the same | the same |
| `backend/src/import/glam-images.ts:424` | Update | `set.join(", ")` (a second `const set` of the file, line 152, is passed to `collectSources(set, …)`; same-named bindings are taken together, so the scan reports it unresolved) | the `set` of `writeProduct` holds `#updatedAt = :now`, `#variants = :variants`, `#additional = :additional`, `#imageLink = :imageLink`, `#status = :active`; `remove` is `""` or ` REMOVE #imageLink` — aliases only |
| `backend/src/lib/scheduling-db.ts:254`, `:297` | Projection | `e.path(...a.split("."))` | `Expr.path` (`scheduling-db.ts:227-234`) returns `#n<i>` for every segment and records the name — every name is aliased by construction |
| `backend/src/lib/scheduling-db.ts:476`, `:563`, `:1438` | Update | `sets.join(", ")`, `e.path(…)`, `e.value(…)` | every element is `${e.path(…)} = ${e.value(…)}` or `REMOVE ${e.path(…)}`; `Expr.value` returns `:v<i>` |
| `backend/src/lib/scheduling-db.ts:477`, `:564`, `:1439` | Condition | the same | the clauses are `attribute_exists(SK)`, `attribute_not_exists(${e.path(…)})` and `${e.path(…)} = / <> ${e.value(…)}` — bare `SK` only |

### Sites with run-time parts in alias / value / index position only (9) — clean by construction

Each run-time value below is one field key, one generated index or one number, so it holds no separator (checked in
the code of each site):
`import/glam-pricelist.ts:516` (`#f${i}` aliases of `DRY_RUN_FIELDS`, or `EXECUTION_PROJECTION`), `lib/lead-write.ts:36`
(`#${a} = if_not_exists(#${a}, :${a})`), `orders/update.ts:83`, `reviews/update.ts:169`, `signals/update.ts:59`
(`#${inputKey} = :${inputKey}`), `reviews/update.ts:333`, `:341`, `:451`, `:462` (`#images[${imageIndex}]`).

## Migration / deployment notes

No data migration. Deploy: the backend Lambdas of `orders/list`, `reviews/list`, `reports/summary`,
`resources/presign` and the renderer (for `/api/account/orders`). No CDK resource or IAM change. Rollback: revert the
five source hunks; the guard files are test-only.

## Definition of Done

- [x] Five sites aliased; returned shapes unchanged (handler rows assert the full answers).
- [x] Audit table of every expression site the scan found (reconciled with the text search), with the basis and the
      run-time sites.
- [x] Word list in one file; every unit-test double refuses a bare reserved word with DynamoDB's text; static lint
      (not a proof).
- [x] Red on the unfixed tree, green after (§ "Build record").
- [x] Docs: this file, `backend/ARCHITECTURE.md`, `CLAUDE.md` rule 2, `docs/TECH-DEBT.md`, `docs/ROADMAP.md`,
      `CURRENT_SLICE.md`.
- [ ] Operator: staging deploy; every admin list route of the three test sites answers 200 against the real DynamoDB.

## Evidence required (operator)

On staging, for each of the three test sites: `GET /orders`, `GET /reviews` and the other admin list routes → 200;
the Reports page loads. Suggested in addition: the account page order history of a signed-in customer on a shop with
an order (renderer `/api/account/orders`).

## Exit criterion

The owner sees the Orders list, the review moderation list and the Reports page. A bare reserved word in a new or
changed expression fails `npm --prefix backend run test:unit` before it reaches staging when a backend unit test
reaches the expression (run-time guard), or when the static lint resolves it. An expression that no test reaches and
that is built through a form the lint does not model can still reach staging; the operator's staging smoke of the list
routes is the third layer (§ "Operator ruling PR1-STATIC-SCOPE").

## Operator ruling PR1-STATIC-SCOPE (2026-11-27, after review 2)

Quoted from the operator packet:

> 1. The contract of the scan is: a LINT for the construction forms the repository uses today, NOT a proof.
>    - It reads the forms it models (the list already in the guard's header) and reports the rest as unresolved
>      where it can tell.
>    - Code that changes a value through a form the scan does not model CAN be reported clean. That is a known,
>      recorded limit, not a defect of this slice.
>    - The protection against the class is, in this order: (a) the run-time guard in the command constructors (every
>      backend unit test that reaches an expression; review finding PR1-GUARD-BYPASS, closed); (b) the lint, for
>      code no test reaches and for the renderer; (c) the operator's staging smoke of the list routes.
> 2. NO further change to the resolver logic of `dynamo-expression-guard.ts` in this slice. Do not add the review-2
>    cases. Do not remove what revisions 1 and 2 added.

Applied in revision 3 as wording only (this file, the guard's header comment and its `join` comment,
`backend/ARCHITECTURE.md`, `docs/TECH-DEBT.md` with entry F-RESERVED-SCAN-LIMITS, and the two summary lines in
`docs/ROADMAP.md` and `CURRENT_SLICE.md` that said "every expression"). Two test names still read stronger than the
contract — `describe("the scan fails closed (sources scanned from text)")` and `describe("the static scan of every
DynamoDB expression in the repository")`; their rows assert only the listed cases. They are left as they are because
point 4 of the ruling freezes the tests in this cycle; renaming them is noted in F-RESERVED-SCAN-LIMITS.

## Residuals

Recorded in `docs/TECH-DEBT.md` § "PROJECTION-RESERVED-1 residuals".

## References

`docs/TECH-DEBT.md` § F-CMRC1-PRESIGN-ENTITLEMENT; `docs/slices/digital-file-guard-1.md`; `backend/ARCHITECTURE.md`
§ "Testing"; the DynamoDB pages "Reserved words in DynamoDB" and "Expression attribute names".

## Build record (2026-11-27, builder `claude-opus-5-5`)

Order of the round as the packet sets it; progress notes in `.agent-manager/slices/PROJECTION-RESERVED-1/build-progress.md`.

| Step | Command | Result | Label |
|---|---|---|---|
| Word list | `curl -sS https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html` | 573 words, unique, sorted (ABORT … ZONE) | EXECUTED |
| Audit | the scan (§ "Audit") + the `grep` above | 301 sites; 305 grep lines, 4 non-expressions | EXECUTED |
| Guard, unfixed tree | `npm --prefix backend run test:unit` before any source fix (guard only) | 3 failed: `reviews-site-scope` ×2 (500 ≠ 200), `digital-file-guard-1` download row (500 ≠ 403) — existing tests, unedited | EXECUTED |
| Red proof, final tests | fixes reverted in the working tree with `git apply -R` of the saved source diff (no stash), suite run, `git apply` back | 9 failed / 2422 passed: the 5 handler rows of `projection-reserved-1.test.ts` + the scan row + the 3 rows above; bodies `{"error":"Invalid ProjectionExpression: Attribute name is a reserved keyword; reserved keyword: total"}` (also `source`, `items`) | EXECUTED |
| Green | `npm --prefix backend run test:unit` | 93 files passed, 2 skipped; 2431 tests passed, 2 skipped; exit 0 | EXECUTED |
| Build | `npm run build` | exit 0 | EXECUTED |
| Typecheck | `npm run typecheck` (8 workspaces; backend's excludes tests) | exit 0 | EXECUTED |
| New test files typed | `cd backend && npx tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck --esModuleInterop test/unit/dynamo-expression-guard.ts test/unit/dynamo-reserved-setup.ts test/unit/projection-reserved-1.test.ts` | exit 0 | EXECUTED |
| Renderer unit | `cd renderer && npm test` | 66 files, 964 tests passed; exit 0 | EXECUTED |
| Serving contract | `cd renderer && npm run test:serving` | 176 / 176 pass; exit 0 (no capture moved) | EXECUTED |
| Serving bundle | `cd renderer && npm run test:serving-bundle` | 61 / 61 pass; exit 0 | EXECUTED |
| MCP | `cd tools/mcp-server && npm test` | 23 / 23 pass; exit 0 (no route change, `routes.json` unchanged) | EXECUTED |
| Whitespace | `git diff --check` (new files included with `git add -N`, then `git restore --staged`) | exit 0 | EXECUTED |
| Staging | the operator's check | — | NOT RUN |

### Revision 1 (review-0: PR1-GUARD-BYPASS, PR1-STATIC-FALSE-CLEAN), 2026-11-27

| Step | Command | Result | Label |
|---|---|---|---|
| Guard on the four replacing files | `cd backend && npx vitest run --config vitest.unit.config.ts test/unit/invalidate-cdn.test.ts test/unit/debounce-flush.test.ts test/unit/debounce-maxwait.test.ts test/unit/lang-1b-deferred-flush.test.ts` | green; with `guardCommandClasses` made a no-op (temporary mutant, removed): the 4 rejection-control rows fail (4 failed / 38 passed) | EXECUTED |
| Scan fail-closed rows | `… test/unit/projection-reserved-1.test.ts` | 22 / 22 green; with the three fail-closed rules off (temporary mutant, removed): 5 failed / 17 passed | EXECUTED |
| Re-scan of the repository | the scan, dumped by a temporary test file (removed) | unchanged: 301 sites, 0 bare reserved, 12 unresolved (same `file kind` keys), 9 alias / value / index-only | EXECUTED |
| Red proof | fixes reverted with `git apply -R`, suite run, `git apply` back | 9 failed / 2434 passed, the same 9 rows and error texts as before | EXECUTED |
| Green | `npm --prefix backend run test:unit` | 93 files passed, 2 skipped; 2443 tests passed, 2 skipped; exit 0 | EXECUTED |
| Gates | `npm run build`; `npm run typecheck`; `cd renderer && npm test` (964 tests, 66 files); `cd renderer && npm run test:serving` (176/176); `cd renderer && npm run test:serving-bundle` (61/61); `cd tools/mcp-server && npm test` (23/23); `git diff --check` with the new files (`git add -N`, then `git restore --staged`); strict `tsc` of the new and edited test files (as in the first round, plus `invalidate-cdn`, `debounce-flush`, `debounce-maxwait`) | every exit 0 | EXECUTED |
| Before-state of the five scan probes | — | the reviewer's in-memory probes of the revision-0 scanner (OBSERVED by the reviewer); not reproduced here — the revision-0 file is no longer in the tree | NOT RUN |

### Revision 2 (review-1: PR1-STATIC-FALSE-CLEAN retained), 2026-11-27

`hasUnmodelledUse` was a deny-list in revision 1 (every member access allowed, export specifiers ignored); it is now the
allow-list above, and member reads of an object with behaviour (method, accessor, function-valued property) are holes.

| Step | Command | Result | Label |
|---|---|---|---|
| New rows | `cd backend && npx vitest run --config vitest.unit.config.ts test/unit/projection-reserved-1.test.ts` | 30 / 30 green (7 `it.each` review-1 cases + 1 control row added) | EXECUTED |
| Rows discriminate | the same, with the revision-1 behaviour restored by a temporary mutant (removed) | 8 failed / 22 passed: each of the 7 review-1 cases fails on its own, plus the revision-1 export row | EXECUTED |
| Re-scan of the repository | the scan, dumped by a temporary test file (removed) | unchanged: 305 files, 301 sites, 0 bare reserved, the same 12 unresolved sites, 9 alias / value / index-only — no audit classification changes | EXECUTED |
| Red proof | fixes reverted with `git apply -R`, suite run, `git apply` back | 9 failed / 2442 passed, the same 9 rows and error texts as before | EXECUTED |
| Green | `npm --prefix backend run test:unit` | 93 files passed, 2 skipped; 2451 tests passed, 2 skipped; exit 0 | EXECUTED |
| Gates | `npm run build`; `npm run typecheck`; `cd renderer && npm test` (66 files, 964 tests); `cd renderer && npm run test:serving` (176/176); `cd renderer && npm run test:serving-bundle` (61/61); `cd tools/mcp-server && npm test` (23/23); `git diff --check` with the new files; strict `tsc` of the new and edited test files | every exit 0 | EXECUTED |

### Revision 3 (operator ruling PR1-STATIC-SCOPE), 2026-11-27

Wording only: the claims about the static scan now say "a lint, not a proof", name the modelled forms and state that
an unmodelled form can pass as clean. No change to the five production fixes, the run-time guard, the resolver logic
or the tests.

| Step | Command | Result | Label |
|---|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 | EXECUTED |
| Backend units | `npm --prefix backend run test:unit` | exit 0; 93 files passed, 2 skipped; 2451 tests passed, 2 skipped (the same count as revision 2: no test changed) | EXECUTED |
| Whitespace | `git diff --check` with the new files (`git add -N`, then `git restore --staged`) | exit 0 | EXECUTED |
| Full gate set | build, renderer, serving, serving-bundle, MCP | the operator's, by the ruling | NOT RUN |

### Revision 4 (operator ruling after review 3: PR1-STATIC-WORDING), 2026-11-27

Wording only. The comments of the resolver part of `backend/test/unit/dynamo-expression-guard.ts` and this file's scan
paragraphs now describe the syntax the scan recognizes and what it reports, not complete program behaviour (the
changed comment lines are listed in the report of revision 4). Comment-only proof: a snapshot of the guard file taken
at the start of the round, `diff` against it (every changed line is a comment line, or a code line whose code part is
identical and whose trailing comment changed), and both versions transpiled with `removeComments` give byte-identical
JavaScript.

| Step | Command | Result | Label |
|---|---|---|---|
| Comment-only proof | `diff <start snapshot> backend/test/unit/dynamo-expression-guard.ts` filtered to non-comment lines; `ts.transpileModule(…, { removeComments: true })` of both, compared | one changed line with code (`continue; // …`, code part identical); transpiled output identical (25102 bytes each) | EXECUTED |
| Typecheck | `npm run typecheck` | exit 0 | EXECUTED |
| Backend units | `npm --prefix backend run test:unit` | exit 0; 93 files passed, 2 skipped; 2451 tests passed, 2 skipped (same as revisions 2 and 3) | EXECUTED |
| Whitespace | `git diff --check` with the new files (`git add -N`, then `git restore --staged`) | exit 0 | EXECUTED |

## Appendix — audit table

Generated from the scan after the fix (line numbers of the fixed tree). Kind is the expression name without
`Expression`. "Bare names" are the attribute names outside `#alias` / `:value`, after functions and keywords are
removed. "Reserved" is the bare reserved names that remain (none).

| # | Site | Kind | Bare names | Reserved | Result |
|---|---|---|---|---|---|
| 1 | `backend/src/assets/list.ts:26` | KeyCondition | `PK` `SK` | — | clean |
| 2 | `backend/src/audit/graph.ts:28` | KeyCondition | `PK` `SK` | — | clean |
| 3 | `backend/src/audit/graph.ts:30` | Projection | `SK` `nodeId` `title` `slug` `blocks` `tags` `createdAt` | — | clean |
| 4 | `backend/src/audit/graph.ts:61` | Projection | `navLinks` `footerLinks` | — | clean |
| 5 | `backend/src/audit/list.ts:26` | KeyCondition | `PK` `SK` | — | clean |
| 6 | `backend/src/categories/delete.ts:29` | Projection | `slug` | — | clean |
| 7 | `backend/src/categories/delete.ts:35` | KeyCondition | `PK` `SK` | — | clean |
| 8 | `backend/src/categories/delete.ts:36` | Filter | `parentId` | — | clean |
| 9 | `backend/src/categories/delete.ts:42` | Projection | `id` | — | clean |
| 10 | `backend/src/categories/list.ts:26` | KeyCondition | `PK` `SK` | — | clean |
| 11 | `backend/src/categories/list.ts:31` | Projection | `id` `slug` `parentId` `sortOrder` `productCount` `imageLink` `seoTitle` `seoDescription` | — | clean |
| 12 | `backend/src/categories/public-get.ts:18` | KeyCondition | `TenantSlug` | — | clean |
| 13 | `backend/src/categories/public-get.ts:19` | Filter | — | — | clean |
| 14 | `backend/src/categories/public-list.ts:19` | KeyCondition | `PK` `SK` | — | clean |
| 15 | `backend/src/categories/public-list.ts:20` | Filter | — | — | clean |
| 16 | `backend/src/categories/public-list.ts:27` | Projection | `id` `slug` `parentId` `sortOrder` `productCount` `imageLink` `seoTitle` `seoDescription` | — | clean |
| 17 | `backend/src/comments/list.ts:29` | KeyCondition | `PK` `SK` | — | clean |
| 18 | `backend/src/comments/moderate.ts:42` | Update | — | — | clean |
| 19 | `backend/src/content/create.ts:121` | Condition | — | — | run-time part — clean by hand audit (§ Run-time sites) |
| 20 | `backend/src/content/create.ts:139` | Condition | `SK` | — | clean |
| 21 | `backend/src/content/history.ts:22` | KeyCondition | `PK` `SK` | — | clean |
| 22 | `backend/src/content/list.ts:34` | KeyCondition | `PK` `SK` | — | clean |
| 23 | `backend/src/content/list.ts:36` | Projection | `SK` | — | clean |
| 24 | `backend/src/content/list.ts:43` | Projection | `homePageSlug` | — | clean |
| 25 | `backend/src/content/list.ts:59` | KeyCondition | `PK` `SK` | — | clean |
| 26 | `backend/src/content/list.ts:65` | Projection | `SK` `nodeId` `id` `title` `slug` `commentsMode` `accessPolicy` `tags` `featuredImage` `createdAt` `updatedAt` `author` `authorEmail` `seoDescription` `translationKey` | — | clean |
| 27 | `backend/src/content/list.ts:97` | KeyCondition | `PK` `SK` | — | clean |
| 28 | `backend/src/content/list.ts:99` | Projection | `SK` | — | clean |
| 29 | `backend/src/content/restore.ts:78` | Condition | `slug` `translationKey` | — | clean |
| 30 | `backend/src/content/restore.ts:79` | Condition | `slug` `translationKey` | — | clean |
| 31 | `backend/src/content/restore.ts:81` | Condition | `translationKey` | — | clean |
| 32 | `backend/src/content/update.ts:71` | KeyCondition | `PK` `SK` | — | clean |
| 33 | `backend/src/content/update.ts:73` | Projection | `SK` | — | clean |
| 34 | `backend/src/content/update.ts:86` | Projection | `slug` `translationKey` | — | clean |
| 35 | `backend/src/content/update.ts:158` | Projection | — | — | clean |
| 36 | `backend/src/content/update.ts:165` | Projection | `slug` `translationKey` | — | clean |
| 37 | `backend/src/content/update.ts:192` | Condition | `translationKey` | — | clean |
| 38 | `backend/src/content/update.ts:195` | Update | `translationKey` | — | clean |
| 39 | `backend/src/content/update.ts:196` | Condition | `translationKey` | — | clean |
| 40 | `backend/src/content/update.ts:247` | Projection | `homePageSlug` | — | clean |
| 41 | `backend/src/content/update.ts:404` | Update | `title` `blocks` `commentsMode` `accessPolicy` `seoTitle` `seoDescription` `seoKeywords` `featuredImage` `tags` `hideNav` `hideFooter` `hideSharing` `themeOverride` `schemaType` `updatedAt` `updatedBy` `version` `slug` | — | clean |
| 42 | `backend/src/content/update.ts:407` | Update | `title` `blocks` `commentsMode` `accessPolicy` `seoTitle` `seoDescription` `seoKeywords` `featuredImage` `tags` `hideNav` `hideFooter` `hideSharing` `themeOverride` `schemaType` `updatedAt` `updatedBy` `version` `slug` `translationKey` | — | clean |
| 43 | `backend/src/content/update.ts:408` | Condition | — | — | run-time part — clean by hand audit (§ Run-time sites) |
| 44 | `backend/src/content/update.ts:413` | Update | `title` `blocks` `commentsMode` `accessPolicy` `seoTitle` `seoDescription` `seoKeywords` `featuredImage` `tags` `hideNav` `hideFooter` `hideSharing` `themeOverride` `schemaType` `updatedAt` `updatedBy` `version` `slug` `translationKey` | — | clean |
| 45 | `backend/src/content/update.ts:414` | Condition | — | — | run-time part — clean by hand audit (§ Run-time sites) |
| 46 | `backend/src/content/update.ts:450` | Condition | `SK` | — | clean |
| 47 | `backend/src/context/list.ts:24` | KeyCondition | `PK` `SK` | — | clean |
| 48 | `backend/src/context/update.ts:37` | Update | `blocks` `tags` `updatedBy` `updatedAt` | — | clean |
| 49 | `backend/src/coupons/list.ts:19` | KeyCondition | `PK` `SK` | — | clean |
| 50 | `backend/src/coupons/list.ts:24` | Projection | `id` `code` `usageCount` `usageLimit` `validFrom` `validUntil` `minimumOrderAmount` `createdAt` | — | clean |
| 51 | `backend/src/coupons/public-validate.ts:25` | Projection | `SK` `categoryIds` | — | clean |
| 52 | `backend/src/customers/get.ts:38` | KeyCondition | `PK` `SK` | — | clean |
| 53 | `backend/src/customers/list.ts:19` | KeyCondition | `PK` `SK` | — | clean |
| 54 | `backend/src/customers/list.ts:24` | Projection | `email` `phone` `orderCount` `totalSpent` `lastOrderDate` `createdAt` | — | clean |
| 55 | `backend/src/customers/public-update.ts:76` | Projection | `email` | — | clean |
| 56 | `backend/src/customers/public-update.ts:110` | Update | `updatedAt` `phone` `birthday` `defaultAddress` `defaultBillingDetails` | — | clean |
| 57 | `backend/src/customers/update.ts:37` | Update | `notes` `updatedAt` | — | clean |
| 58 | `backend/src/customers/update.ts:42` | Condition | `PK` | — | clean |
| 59 | `backend/src/forms/list.ts:20` | KeyCondition | `PK` `SK` | — | clean |
| 60 | `backend/src/forms/list.ts:25` | Projection | `id` `slug` `createdAt` | — | clean |
| 61 | `backend/src/forms/submissions.ts:22` | KeyCondition | `PK` `SK` | — | clean |
| 62 | `backend/src/forms/submissions.ts:27` | Projection | `id` `formId` `formName` `submitterEmail` `createdAt` | — | clean |
| 63 | `backend/src/import/glam-images.ts:330` | Projection | `newUrl` | — | clean |
| 64 | `backend/src/import/glam-images.ts:343` | Projection | `id` `slug` `title` `imageLink` `categoryIds` `importSource` `variants` | — | clean |
| 65 | `backend/src/import/glam-images.ts:359` | KeyCondition | `PK` `SK` | — | clean |
| 66 | `backend/src/import/glam-images.ts:361` | Projection | `id` `slug` `title` `imageLink` `categoryIds` `importSource` `variants` | — | clean |
| 67 | `backend/src/import/glam-images.ts:424` | Update | — | — | run-time part — clean by hand audit (§ Run-time sites) |
| 68 | `backend/src/import/glam-images.ts:425` | Condition | `PK` | — | clean |
| 69 | `backend/src/import/glam-pricelist.ts:206` | Projection | `catalogStrings` | — | clean |
| 70 | `backend/src/import/glam-pricelist.ts:460` | Condition | `SK` | — | clean |
| 71 | `backend/src/import/glam-pricelist.ts:472` | Condition | `expiresAt` | — | clean |
| 72 | `backend/src/import/glam-pricelist.ts:488` | Condition | — | — | clean |
| 73 | `backend/src/import/glam-pricelist.ts:514` | KeyCondition | `PK` `SK` | — | clean |
| 74 | `backend/src/import/glam-pricelist.ts:516` | Projection | `id` `title` `categoryIds` `importSource` `importProfileRevision` `slug` | — | clean — run-time parts only in `#`/`:`/`[ ]` position |
| 75 | `backend/src/import/glam-pricelist.ts:547` | Projection | `id` `slug` | — | clean |
| 76 | `backend/src/import/glam-pricelist.ts:559` | KeyCondition | `TenantSlug` | — | clean |
| 77 | `backend/src/import/glam-pricelist.ts:561` | Projection | `SK` `id` `slug` | — | clean |
| 78 | `backend/src/import/glam-pricelist.ts:637` | Condition | `SK` | — | clean |
| 79 | `backend/src/import/glam-pricelist.ts:754` | Projection | `id` `title` `slug` `sku` `price` `currency` `salePrice` `imageLink` `availability` `sortOrder` `tags` `volumePricing` `categoryIds` `availableFrom` `availableUntil` | — | clean |
| 80 | `backend/src/import/glam-pricelist.ts:850` | Condition | `SK` | — | clean |
| 81 | `backend/src/import/glam-pricelist.ts:852` | Condition | — | — | clean |
| 82 | `backend/src/import/product-slug.ts:21` | KeyCondition | `TenantSlug` | — | clean |
| 83 | `backend/src/import/reviews.ts:248` | Condition | `PK` `SK` | — | clean |
| 84 | `backend/src/import/woocommerce.ts:369` | Condition | `SK` | — | clean |
| 85 | `backend/src/import/wordpress.ts:29` | KeyCondition | `PK` `SK` | — | clean |
| 86 | `backend/src/import/wordpress.ts:56` | KeyCondition | `PK` `SK` | — | clean |
| 87 | `backend/src/import/wordpress.ts:356` | Condition | `translationKey` | — | clean |
| 88 | `backend/src/import/wordpress.ts:357` | Condition | `translationKey` | — | clean |
| 89 | `backend/src/import/wordpress.ts:401` | Condition | `SK` | — | clean |
| 90 | `backend/src/import/wordpress.ts:403` | Condition | `wordpressSourceItem` `translationKey` | — | clean |
| 91 | `backend/src/import/wordpress.ts:407` | Condition | `SK` | — | clean |
| 92 | `backend/src/import/wordpress.ts:408` | Condition | `TargetNode` `IsRedirect` | — | clean |
| 93 | `backend/src/import/wordpress.ts:580` | KeyCondition | `PK` `SK` | — | clean |
| 94 | `backend/src/import/wordpress.ts:582` | Projection | `SK` | — | clean |
| 95 | `backend/src/import/wordpress.ts:626` | Condition | `SK` | — | clean |
| 96 | `backend/src/interest/public.ts:129` | Projection | `id` `title` `slug` `imageLink` `variants` `attributes` `importLabels` | — | clean |
| 97 | `backend/src/interest/public.ts:201` | Projection | — | — | clean |
| 98 | `backend/src/interest/public.ts:262` | Condition | `SK` | — | clean |
| 99 | `backend/src/interest/public.ts:283` | Condition | `SK` | — | clean |
| 100 | `backend/src/leads/list.ts:28` | KeyCondition | `PK` `SK` | — | clean |
| 101 | `backend/src/leads/list.ts:29` | Projection | `tenantId` `createdAt` `resourceId` | — | clean |
| 102 | `backend/src/leads/list.ts:45` | KeyCondition | `PK` `SK` | — | clean |
| 103 | `backend/src/leads/list.ts:46` | Projection | — | — | clean |
| 104 | `backend/src/leads/newsletter.ts:99` | Condition | `SK` | — | clean |
| 105 | `backend/src/leads/newsletter.ts:107` | Condition | `SK` | — | clean |
| 106 | `backend/src/leads/newsletter.ts:135` | Projection | `SK` | — | clean |
| 107 | `backend/src/leads/newsletter.ts:146` | Condition | `SK` | — | clean |
| 108 | `backend/src/leads/newsletter.ts:148` | Condition | `consent` | — | clean |
| 109 | `backend/src/leads/newsletter.ts:149` | Condition | `SK` `consent` | — | clean |
| 110 | `backend/src/leads/newsletter.ts:230` | Update | — | — | clean |
| 111 | `backend/src/leads/newsletter.ts:231` | Condition | `consent` | — | clean |
| 112 | `backend/src/leads/push.ts:65` | Update | — | — | clean |
| 113 | `backend/src/leads/push.ts:66` | Condition | `consent` | — | clean |
| 114 | `backend/src/lib/catalog-product.ts:25` | Projection | `SK` `catalogMode` | — | clean |
| 115 | `backend/src/lib/catprod.ts:108` | KeyCondition | `PK` `SK` | — | clean |
| 116 | `backend/src/lib/catprod.ts:142` | KeyCondition | `PK` `SK` | — | clean |
| 117 | `backend/src/lib/catprod.ts:144` | Projection | `id` | — | clean |
| 118 | `backend/src/lib/invalidate-cdn.ts:137` | Update | `updatedAt` `firstPendingAt` | — | clean |
| 119 | `backend/src/lib/invalidate-cdn.ts:216` | Update | `updatedAt` | — | clean |
| 120 | `backend/src/lib/lead-write.ts:36` | Update | — | — | clean — run-time parts only in `#`/`:`/`[ ]` position |
| 121 | `backend/src/lib/media-map.ts:41` | KeyCondition | `PK` `SK` | — | clean |
| 122 | `backend/src/lib/media-map.ts:46` | Projection | `oldUrl` `newUrl` | — | clean |
| 123 | `backend/src/lib/resource-products.ts:30` | KeyCondition | `PK` `SK` | — | clean |
| 124 | `backend/src/lib/resource-products.ts:31` | Filter | `resourceId` | — | clean |
| 125 | `backend/src/lib/resource-products.ts:37` | Projection | `id` | — | clean |
| 126 | `backend/src/lib/revalidate.ts:172` | Projection | `urlPrefixes` | — | clean |
| 127 | `backend/src/lib/scheduling-db.ts:254` | Projection | — | — | run-time part — clean by hand audit (§ Run-time sites) |
| 128 | `backend/src/lib/scheduling-db.ts:295` | KeyCondition | `PK` `SK` | — | clean |
| 129 | `backend/src/lib/scheduling-db.ts:297` | Projection | — | — | run-time part — clean by hand audit (§ Run-time sites) |
| 130 | `backend/src/lib/scheduling-db.ts:401` | Condition | `SK` | — | clean |
| 131 | `backend/src/lib/scheduling-db.ts:416` | Condition | `SK` | — | clean |
| 132 | `backend/src/lib/scheduling-db.ts:476` | Update | — | — | run-time part — clean by hand audit (§ Run-time sites) |
| 133 | `backend/src/lib/scheduling-db.ts:477` | Condition | `SK` | — | run-time part — clean by hand audit (§ Run-time sites) |
| 134 | `backend/src/lib/scheduling-db.ts:563` | Update | — | — | run-time part — clean by hand audit (§ Run-time sites) |
| 135 | `backend/src/lib/scheduling-db.ts:564` | Condition | `SK` | — | run-time part — clean by hand audit (§ Run-time sites) |
| 136 | `backend/src/lib/scheduling-db.ts:604` | Update | — | — | clean |
| 137 | `backend/src/lib/scheduling-db.ts:605` | Condition | `SK` | — | clean |
| 138 | `backend/src/lib/scheduling-db.ts:828` | Condition | `SK` | — | clean |
| 139 | `backend/src/lib/scheduling-db.ts:849` | Update | — | — | clean |
| 140 | `backend/src/lib/scheduling-db.ts:850` | Condition | `SK` | — | clean |
| 141 | `backend/src/lib/scheduling-db.ts:882` | Condition | `SK` | — | clean |
| 142 | `backend/src/lib/scheduling-db.ts:980` | Update | — | — | clean |
| 143 | `backend/src/lib/scheduling-db.ts:981` | Condition | `SK` | — | clean |
| 144 | `backend/src/lib/scheduling-db.ts:1438` | Update | — | — | run-time part — clean by hand audit (§ Run-time sites) |
| 145 | `backend/src/lib/scheduling-db.ts:1439` | Condition | `SK` | — | run-time part — clean by hand audit (§ Run-time sites) |
| 146 | `backend/src/lib/scheduling-db.ts:1473` | Update | — | — | clean |
| 147 | `backend/src/lib/scheduling-db.ts:1474` | Condition | `SK` | — | clean |
| 148 | `backend/src/lib/scheduling-db.ts:1500` | Condition | — | — | clean |
| 149 | `backend/src/lib/scheduling-db.ts:1521` | Update | — | — | clean |
| 150 | `backend/src/lib/scheduling-db.ts:1522` | Condition | — | — | clean |
| 151 | `backend/src/lib/scheduling-db.ts:1546` | Condition | `SK` | — | clean |
| 152 | `backend/src/lib/scheduling-db.ts:1656` | Condition | `SK` | — | clean |
| 153 | `backend/src/lib/scheduling-db.ts:1657` | Condition | — | — | clean |
| 154 | `backend/src/lib/scheduling-db.ts:1676` | Update | — | — | clean |
| 155 | `backend/src/lib/scheduling-db.ts:1694` | Update | — | — | clean |
| 156 | `backend/src/lib/service-keys.ts:78` | Condition | `PK` | — | clean |
| 157 | `backend/src/lib/service-keys.ts:85` | Condition | `PK` | — | clean |
| 158 | `backend/src/lib/service-keys.ts:102` | KeyCondition | `PK` `SK` | — | clean |
| 159 | `backend/src/lib/service-keys.ts:106` | Projection | `id` `tenantId` `scopes` `createdBy` `createdAt` `lastUsedAt` `revokedAt` | — | clean |
| 160 | `backend/src/lib/service-keys.ts:137` | Update | `revokedAt` | — | clean |
| 161 | `backend/src/lib/service-keys.ts:140` | Condition | `PK` `revokedAt` | — | clean |
| 162 | `backend/src/lib/service-keys.ts:187` | Update | `lastUsedAt` | — | clean |
| 163 | `backend/src/lib/service-keys.ts:188` | Condition | `PK` | — | clean |
| 164 | `backend/src/lib/service-keys.ts:194` | Update | `lastUsedDay` | — | clean |
| 165 | `backend/src/lib/service-keys.ts:195` | Condition | `PK` | — | clean |
| 166 | `backend/src/lib/slug-guard.ts:62` | Projection | `urlPrefixes` `catalogMode` | — | clean |
| 167 | `backend/src/lib/tenant-verify.ts:39` | KeyCondition | — | — | clean |
| 168 | `backend/src/lib/tenant-verify.ts:42` | Projection | `id` | — | clean |
| 169 | `backend/src/orders/create.ts:388` | Update | `currentValue` | — | clean |
| 170 | `backend/src/orders/create.ts:459` | Update | `phone` `defaultAddress` `orderCount` `totalSpent` `loyaltyPoints` `lastOrderDate` `birthday` `defaultBillingDetails` | — | clean |
| 171 | `backend/src/orders/create.ts:505` | Update | `usageCount` | — | clean |
| 172 | `backend/src/orders/create.ts:506` | Condition | `usageLimit` `usageCount` | — | clean |
| 173 | `backend/src/orders/create.ts:515` | Update | — | — | clean |
| 174 | `backend/src/orders/create.ts:516` | Condition | — | — | clean |
| 175 | `backend/src/orders/create.ts:567` | Update | — | — | clean |
| 176 | `backend/src/orders/list.ts:52` | KeyCondition | `PK` `SK` | — | clean |
| 177 | `backend/src/orders/list.ts:53` | Filter | `createdAt` | — | clean |
| 178 | `backend/src/orders/list.ts:56` | Projection | `id` `orderNumber` `customerEmail` `customerName` `paymentMethod` `paymentStatus` `currency` `createdAt` | — | **FIXED** (was bare `total`) |
| 179 | `backend/src/orders/update-status.ts:76` | Update | `statusHistory` `updatedAt` `trackingNumber` | — | clean |
| 180 | `backend/src/orders/update.ts:83` | Update | — | — | clean — run-time parts only in `#`/`:`/`[ ]` position |
| 181 | `backend/src/orders/update.ts:86` | Condition | `SK` | — | clean |
| 182 | `backend/src/orders/update.ts:157` | Update | — | — | clean |
| 183 | `backend/src/orders/update.ts:158` | Condition | `SK` | — | clean |
| 184 | `backend/src/popups/list.ts:19` | KeyCondition | `PK` `SK` | — | clean |
| 185 | `backend/src/popups/list.ts:24` | Projection | `id` `createdAt` | — | clean |
| 186 | `backend/src/popups/public-list.ts:13` | KeyCondition | `PK` `SK` | — | clean |
| 187 | `backend/src/popups/public-list.ts:19` | Filter | — | — | clean |
| 188 | `backend/src/popups/public-list.ts:20` | Projection | `id` `headline` `body` `imageLink` `ctaText` `ctaLink` `triggerValue` `showOnPages` `showOncePerSession` `collectEmail` | — | clean |
| 189 | `backend/src/popups/public-list.ts:33` | Projection | — | — | clean |
| 190 | `backend/src/products/bulk-price.ts:62` | KeyCondition | `PK` `SK` | — | clean |
| 191 | `backend/src/products/bulk-price.ts:67` | Projection | `SK` | — | clean |
| 192 | `backend/src/products/bulk-price.ts:99` | KeyCondition | `PK` `SK` | — | clean |
| 193 | `backend/src/products/list.ts:52` | KeyCondition | `PK` `SK` | — | clean |
| 194 | `backend/src/products/list.ts:53` | Filter | — | — | clean |
| 195 | `backend/src/products/list.ts:56` | Projection | `id` `title` `slug` `price` `currency` `salePrice` `availability` `inventoryQuantity` `imageLink` `categoryIds` `tags` `brand` `sortOrder` `productType` `paymentLinkId` `resourceId` `createdAt` `updatedAt` | — | clean |
| 196 | `backend/src/products/public-get.ts:30` | KeyCondition | `TenantSlug` | — | clean |
| 197 | `backend/src/products/public-get.ts:31` | Filter | — | — | clean |
| 198 | `backend/src/products/public-list.ts:44` | KeyCondition | `PK` `SK` | — | clean |
| 199 | `backend/src/products/public-list.ts:45` | Filter | `tags` | — | clean |
| 200 | `backend/src/products/public-list.ts:48` | Projection | `id` `title` `slug` `price` `currency` `salePrice` `availability` `imageLink` `tags` `categoryIds` `sortOrder` `volumePricing` `availableFrom` `availableUntil` `description` `sku` | — | clean |
| 201 | `backend/src/products/update.ts:78` | Condition | `PK` | — | clean |
| 202 | `backend/src/redirects/create.ts:52` | Projection | `homePageSlug` | — | clean |
| 203 | `backend/src/redirects/create.ts:72` | Condition | `SK` | — | clean |
| 204 | `backend/src/redirects/create.ts:75` | Condition | `IsRedirect` | — | clean |
| 205 | `backend/src/redirects/delete.ts:50` | Condition | `IsRedirect` `RedirectTo` | — | clean |
| 206 | `backend/src/reports/summary.ts:25` | KeyCondition | `PK` `SK` | — | clean |
| 207 | `backend/src/reports/summary.ts:32` | Projection | `id` `currency` `paymentMethod` `paymentStatus` `createdAt` `couponCode` `couponDiscount` | — | **FIXED** (was bare `total`, `items`) |
| 208 | `backend/src/resources/list.ts:24` | KeyCondition | `PK` `SK` | — | clean |
| 209 | `backend/src/resources/presign.ts:42` | KeyCondition | `PK` `SK` | — | clean |
| 210 | `backend/src/resources/presign.ts:48` | Projection | — | — | **FIXED** (was bare `items`) |
| 211 | `backend/src/reviews/list.ts:39` | KeyCondition | `PK` `SK` | — | clean |
| 212 | `backend/src/reviews/list.ts:41` | Projection | `id` `productId` `authorName` `rating` `content` `createdAt` `images` `importBatchId` | — | **FIXED** (was bare `source`) |
| 213 | `backend/src/reviews/public-list.ts:36` | KeyCondition | `PK` `SK` | — | clean |
| 214 | `backend/src/reviews/public-list.ts:37` | Filter | — | — | clean |
| 215 | `backend/src/reviews/public-list.ts:44` | Projection | `id` `authorName` `rating` `content` `createdAt` `images` | — | clean |
| 216 | `backend/src/reviews/update.ts:169` | Update | — | — | clean — run-time parts only in `#`/`:`/`[ ]` position |
| 217 | `backend/src/reviews/update.ts:172` | Condition | `SK` | — | clean |
| 218 | `backend/src/reviews/update.ts:333` | Update | — | — | clean — run-time parts only in `#`/`:`/`[ ]` position |
| 219 | `backend/src/reviews/update.ts:341` | Condition | `SK` | — | clean — run-time parts only in `#`/`:`/`[ ]` position |
| 220 | `backend/src/reviews/update.ts:451` | Update | — | — | clean — run-time parts only in `#`/`:`/`[ ]` position |
| 221 | `backend/src/reviews/update.ts:462` | Condition | `SK` | — | clean — run-time parts only in `#`/`:`/`[ ]` position |
| 222 | `backend/src/scheduled/debounce-flush.ts:226` | Update | — | — | clean |
| 223 | `backend/src/scheduled/debounce-flush.ts:227` | Condition | — | — | clean |
| 224 | `backend/src/scheduled/debounce-flush.ts:331` | Condition | `updatedAt` | — | clean |
| 225 | `backend/src/scheduled/debounce-flush.ts:394` | Condition | `dueAt` | — | clean |
| 226 | `backend/src/scheduled/debounce-flush.ts:395` | Condition | `SK` `dueAt` | — | clean |
| 227 | `backend/src/scheduled/nightly-cache-flush.ts:55` | Projection | `updatedAt` | — | clean |
| 228 | `backend/src/scheduled/nightly-cache-flush.ts:60` | Projection | `flushedAt` | — | clean |
| 229 | `backend/src/scheduling/reminders.ts:170` | KeyCondition | `PK` `SK` | — | clean |
| 230 | `backend/src/scheduling/reminders.ts:173` | Projection | — | — | clean |
| 231 | `backend/src/signals/list.ts:24` | KeyCondition | `PK` `SK` | — | clean |
| 232 | `backend/src/signals/list.ts:29` | Projection | `id` `tenantId` `title` `author` `painScore` `walletSignal` `analysis` `createdAt` `updatedAt` | — | clean |
| 233 | `backend/src/signals/update.ts:59` | Update | — | — | clean — run-time parts only in `#`/`:`/`[ ]` position |
| 234 | `backend/src/signals/update.ts:62` | Condition | `SK` | — | clean |
| 235 | `backend/src/tenant/create.ts:156` | Condition | `SK` | — | clean |
| 236 | `backend/src/tenant/list.ts:17` | KeyCondition | `PK` `SK` | — | clean |
| 237 | `backend/src/tenant/list.ts:18` | Projection | `id` `commerceEnabled` `schedulingEnabled` `catalogMode` `currency` `locale` `countryCode` | — | clean |
| 238 | `backend/src/tenant/settings.ts:378` | Update | `dueAt` | — | clean |
| 239 | `backend/src/tenant/settings.ts:379` | Condition | `dueAt` | — | clean |
| 240 | `backend/src/tenant/settings.ts:529` | KeyCondition | — | — | clean |
| 241 | `backend/src/tenant/settings.ts:530` | Filter | `SK` | — | clean |
| 242 | `backend/src/themes/manage.ts:47` | KeyCondition | `PK` `SK` | — | clean |
| 243 | `renderer/src/app/api/posts/route.ts:40` | KeyCondition | `PK` `SK` | — | clean |
| 244 | `renderer/src/app/api/posts/route.ts:47` | Filter | — | — | clean |
| 245 | `renderer/src/app/api/posts/route.ts:53` | Filter | `tags` | — | clean |
| 246 | `renderer/src/lib/dynamo.ts:96` | KeyCondition | — | — | clean |
| 247 | `renderer/src/lib/dynamo.ts:97` | Filter | `SK` | — | clean |
| 248 | `renderer/src/lib/dynamo.ts:294` | KeyCondition | `TenantSlug` | — | clean |
| 249 | `renderer/src/lib/dynamo.ts:313` | KeyCondition | `TenantSlug` | — | clean |
| 250 | `renderer/src/lib/dynamo.ts:333` | KeyCondition | `PK` `SK` | — | clean |
| 251 | `renderer/src/lib/dynamo.ts:366` | KeyCondition | `PK` `SK` | — | clean |
| 252 | `renderer/src/lib/dynamo.ts:367` | Filter | — | — | clean |
| 253 | `renderer/src/lib/dynamo.ts:374` | Projection | `id` `slug` `parentId` `sortOrder` `productCount` `imageLink` `seoTitle` `seoDescription` | — | clean |
| 254 | `renderer/src/lib/dynamo.ts:401` | Projection | `id` `slug` `description` `imageLink` | — | clean |
| 255 | `renderer/src/lib/dynamo.ts:422` | KeyCondition | `PK` `SK` | — | clean |
| 256 | `renderer/src/lib/dynamo.ts:423` | Filter | — | — | clean |
| 257 | `renderer/src/lib/dynamo.ts:430` | Projection | `id` `title` `slug` `price` `currency` `salePrice` `availability` `imageLink` `tags` `categoryIds` `sortOrder` `volumePricing` `availableFrom` `availableUntil` | — | clean |
| 258 | `renderer/src/lib/dynamo.ts:484` | KeyCondition | `PK` `SK` | — | clean |
| 259 | `renderer/src/lib/dynamo.ts:490` | Projection | `id` `title` `slug` `price` `currency` `salePrice` `availability` `imageLink` `tags` `categoryIds` `sortOrder` `volumePricing` `availableFrom` `availableUntil` `facetModes` | — | clean |
| 260 | `renderer/src/lib/dynamo.ts:515` | KeyCondition | `PK` `SK` | — | clean |
| 261 | `renderer/src/lib/dynamo.ts:516` | Filter | — | — | clean |
| 262 | `renderer/src/lib/dynamo.ts:523` | Projection | `id` `title` `slug` `price` `currency` `salePrice` `availability` `imageLink` `tags` `categoryIds` `sortOrder` `volumePricing` `availableFrom` `availableUntil` `description` `sku` | — | clean |
| 263 | `renderer/src/lib/dynamo.ts:587` | KeyCondition | `PK` `SK` | — | clean |
| 264 | `renderer/src/lib/dynamo.ts:588` | Filter | — | — | clean |
| 265 | `renderer/src/lib/dynamo.ts:600` | Projection | `id` `authorName` `rating` `content` `createdAt` `images` | — | clean |
| 266 | `renderer/src/lib/dynamo.ts:633` | KeyCondition | `PK` `SK` | — | clean |
| 267 | `renderer/src/lib/dynamo.ts:634` | Filter | — | — | clean |
| 268 | `renderer/src/lib/dynamo.ts:642` | Projection | `id` `authorName` `rating` `content` `createdAt` `images` | — | clean |
| 269 | `renderer/src/lib/dynamo.ts:667` | KeyCondition | `PK` `SK` | — | clean |
| 270 | `renderer/src/lib/dynamo.ts:673` | Projection | `orderNumber` `createdAt` `SK` | — | **FIXED** (was bare `total`) |
| 271 | `renderer/src/lib/dynamo.ts:699` | Projection | `email` `phone` `birthday` `defaultAddress` | — | clean |
| 272 | `renderer/src/lib/dynamo.ts:714` | KeyCondition | `PK` `SK` | — | clean |
| 273 | `renderer/src/lib/dynamo.ts:720` | Filter | — | — | clean |
| 274 | `renderer/src/lib/dynamo.ts:725` | Filter | `tags` | — | clean |
| 275 | `renderer/src/lib/dynamo.ts:775` | KeyCondition | `PK` `SK` | — | clean |
| 276 | `renderer/src/lib/dynamo.ts:781` | Filter | — | — | clean |
| 277 | `renderer/src/lib/dynamo.ts:784` | Projection | `SK` `id` `title` `slug` `seoDescription` `createdAt` `updatedAt` `translationKey` | — | clean |
| 278 | `renderer/src/lib/dynamo.ts:916` | KeyCondition | `PK` `SK` | — | clean |
| 279 | `renderer/src/lib/dynamo.ts:918` | Projection | `SK` | — | clean |
| 280 | `renderer/src/lib/dynamo.ts:930` | Projection | `slug` `translationKey` | — | clean |
| 281 | `renderer/src/lib/dynamo.ts:950` | KeyCondition | `PK` `SK` | — | clean |
| 282 | `renderer/src/lib/dynamo.ts:952` | Projection | `SK` | — | clean |
| 283 | `renderer/src/lib/dynamo.ts:1004` | KeyCondition | `PK` `SK` | — | clean |
| 284 | `renderer/src/lib/dynamo.ts:1005` | Filter | — | — | clean |
| 285 | `renderer/src/lib/dynamo.ts:1013` | Projection | `id` `title` `description` `slug` `price` `currency` `salePrice` `availability` `imageLink` `additionalImageLinks` `brand` `availableFrom` `availableUntil` | — | clean |
| 286 | `renderer/src/lib/dynamo.ts:1070` | KeyCondition | `PK` `SK` | — | clean |
| 287 | `renderer/src/lib/dynamo.ts:1071` | Filter | — | — | clean |
| 288 | `renderer/src/lib/dynamo.ts:1079` | Projection | `id` | — | clean |
| 289 | `renderer/src/lib/tenant-directory.ts:133` | KeyCondition | — | — | clean |
| 290 | `renderer/src/lib/tenant-directory.ts:134` | Filter | `SK` | — | clean |
| 291 | `renderer/src/lib/tenant-directory.ts:137` | Projection | `SK` | — | clean |
| 292 | `scripts/migrate-commerce-private-table.ts:159` | KeyCondition | `PK` `SK` | — | clean |
| 293 | `tests/e2e/review-flow.spec.ts:144` | KeyCondition | `PK` | — | clean |
| 294 | `tests/e2e/review-flow.spec.ts:146` | Projection | `PK` `SK` | — | clean |
| 295 | `tests/e2e/review-flow.spec.ts:163` | KeyCondition | `PK` | — | clean |
| 296 | `backend/test/isolation.test.ts:34` | KeyCondition | `PK` | — | clean |
| 297 | `backend/test/scheduling-db.integration.test.ts:91` | KeyCondition | `PK` | — | clean |
| 298 | `backend/test/scheduling-db.integration.test.ts:92` | Projection | `PK` `SK` | — | clean |
| 299 | `backend/test/scheduling-db.integration.test.ts:148` | KeyCondition | `PK` | — | clean |
| 300 | `backend/test/utils.ts:52` | Condition | `PK` | — | clean |
| 301 | `backend/test/utils.ts:65` | Filter | `PK` | — | clean |

## Closeout (operator, 2026-11-27)

- Relay: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, five cycles; review-4 `approved`. Findings
  PR1-GUARD-BYPASS and PR1-STATIC-WORDING closed. PR1-STATIC-FALSE-CLEAN retired as blocking by the operator
  ruling PR1-STATIC-SCOPE (the static scan is a lint, not a proof; its known false-clean forms are
  `F-RESERVED-SCAN-LIMITS` in `docs/TECH-DEBT.md`).
- Operator check of the last (wording-only) cycle: a diff of `backend/test/unit/dynamo-expression-guard.ts`
  against a copy taken at the start of that cycle shows comment text only.
- Operator gates on the approved tree, each exit 0: build, typecheck, shared, plugins, renderer, serving,
  serving-bundle, admin unit, backend unit, infra, mcp, `git diff --check`; no manifest, lockfile, `infra/` or
  `renderer/middleware.ts` change; no trailing whitespace in new files.
- Staging diff (read before the deploy): 0 resources added, 0 removed, no IAM change; 8 Lambda functions and the
  site assets rebuilt. Deploy: `AmodxStack-staging` succeeded.
- Staging proof (read-only smoke, real DynamoDB): for each of `cm1-content`, `cm1-commerce`, `cm1-catalog`, the 11
  admin routes answer 200, among them `GET /orders`, `GET /reviews` and `GET /reports/summary` (500 for `/orders`
  before the deploy); home pages, sitemap addresses and the admin screens open.
- NOT proven on staging: the download check of `resources/presign.ts` and the account order history of
  `renderer/src/lib/dynamo.ts` (`getCustomerOrders`). Both need a signed-in customer; the public sign-in on staging
  refuses scripted requests. Basis for these two: the unit tests with the guard, and the same alias form as the
  three routes proven above.
- Production: not verified (the operator does not read production). The five sites carry old code, so the same
  failures are expected there until the human's production deploy.
- Finding, not fixed (recorded in `docs/TECH-DEBT.md` by the build): the stored `CUSTORDER#` row holds no `items`,
  so the download check cannot find a purchase even with the corrected query. It needs its own slice.

