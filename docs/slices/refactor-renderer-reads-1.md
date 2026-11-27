# REFACTOR-RENDERER-READS-1 — the order and customer reads of `renderer/src/lib/dynamo.ts` into their own module (moves only)

- **Status:** IMPLEMENTED 2026-11-27 — built, operator gates pending (staging diff, staging deploy, the three test
  sites rendered against the real tables). The spec with the file map was written before the first move.
- **Track:** maintenance (order of work from 2026-11-27, `docs/ROADMAP.md`: the fifth pure-move refactor slice, after
  `refactor-mcp-1`, before `settings-findings-1`, `ci-lockfile-1` and Track B)
- **Depends:** none
- **Source plan:** none. Ratified by the human's order of work of 2026-11-27 ("add a slice for refactoring the … big
  files … before moving on to a consequential track like the private commerce table", then "Ok dynamo too"). ROADMAP
  row `refactor-renderer-reads-1`. No ratification-class decision.
- **Maturity:** unchanged (a move changes no module's maturity).

## Purpose / risk retired

`renderer/src/lib/dynamo.ts` (1,082 lines at the start of the slice, base `bd64341`) holds every read of the public
site. Three of them read one customer's commerce data: `getOrderForCustomer`, `getCustomerOrders`,
`getCustomerProfile`. Track B (`cmrc-1`, the commerce private table) changes or deletes exactly these three. The risk
retired: a `cmrc-1` change and its review must search a 1,082-line file for the code that reads personal data, and
can miss a part of it. After this slice the three reads are in one small file; `cmrc-1` edits that file. A visitor
receives the same bytes. Live tenants are served by this code, so the change is production-impacting even though it
changes no logic.

## Scope

1. Create `renderer/src/lib/dynamo-client.ts`: the DynamoDB client, the document client and `requireTableName`,
   moved byte for byte with their comments.
2. Create `renderer/src/lib/dynamo-customer-reads.ts`: the three functions, moved byte for byte with their comments.
3. `renderer/src/lib/dynamo.ts`: imports `docClient` and `requireTableName` from `dynamo-client.ts`; re-exports the
   three functions from `dynamo-customer-reads.ts`; drops the import names it no longer uses.
4. Proof scripts in the slice trail (cycle check, moved-text check, importer list, client count).
5. Docs: `renderer/ARCHITECTURE.md` (three-file map and rule), `docs/slices/cmrc-1.md` (its `dynamo.ts:<line>`
   citations of the three functions), `docs/ROADMAP.md` row, `CURRENT_SLICE.md`.

## Non-scope

- No other function of `dynamo.ts` moves. The rest of the file is not split.
- No rename, no changed expression, key, projection or return shape, no new dependency, no new comment text.
- No defect is fixed; each one found is recorded in § *Findings, not fixed*.
- No edit under `backend/src`, `infra/`, `packages/`, `admin/`, `tools/`, `renderer/middleware.ts`,
  `renderer/src/components/`, `renderer/src/app/`, no `package.json` or lockfile, no test file.
- No closed slice record is edited (`docs/slices/projection-reserved-1.md` audit rows, `docs/slices/order-email-1.md`,
  shipped records).

## Architectural boundaries

- Tenant isolation and the no-scan rule: unchanged, because no expression, key or command changes (the moved text is
  byte-identical; § *Proofs*).
- The rule "failed reads throw" (`dynamo.ts` header, CACHE-1-D4) keeps covering the three reads: the code does not
  change, and every moved function still resolves the table through `requireTableName()`. The header's text says "this
  file"; § *Findings, not fixed* F-RRR1-HEADER-SCOPE records that its text does not reach the new files, and
  `renderer/ARCHITECTURE.md` states the rule for all three files.
- The import graph stays a DAG: `dynamo.ts` → `dynamo-customer-reads.ts` → `dynamo-client.ts`, and `dynamo.ts` →
  `dynamo-client.ts`. No file imports `dynamo.ts` back.
- One `DynamoDBClient` instance for the read layer, created at import of `dynamo-client.ts` (before: at import of
  `dynamo.ts`). ES module evaluation runs each module once per module graph, so `dynamo.ts` and
  `dynamo-customer-reads.ts` share the same `docClient` object.
- Server-only: § *Server-only (ruling 5)*.

## File map (ruling 1)

Line numbers are of the untouched `dynamo.ts` (base `bd64341`, sha256 `cebbac4e…`).

| Untouched lines | Text | Goes to |
|---|---|---|
| 47 | `import { DynamoDBClient } from "@aws-sdk/client-dynamodb";` | `dynamo-client.ts` (the import); removed from `dynamo.ts` (no other use there) |
| 49 | `import { DynamoDBDocumentClient, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";` | `dynamo-client.ts` imports `DynamoDBDocumentClient`; `dynamo-customer-reads.ts` imports `QueryCommand, GetCommand`; `dynamo.ts` keeps `QueryCommand, GetCommand` |
| 50 | the `@amodx/shared` import | `dynamo-customer-reads.ts` imports `normalizeEmail`; `dynamo.ts` keeps every other name (`normalizeEmail` has no other use there) |
| 52–53 | `const client = …`, `const docClient = …` | `dynamo-client.ts`; `docClient` gets `export`, `client` stays module-private (no other user) |
| 55–72 | JSDoc + `function requireTableName()` | `dynamo-client.ts`, with `export` |
| 560–574 | `// 10. …` + `getOrderForCustomer` | `dynamo-customer-reads.ts` |
| 656–690 | `// 12. …` + `getCustomerOrders` | `dynamo-customer-reads.ts` |
| 692–703 | `// 13. …` + `getCustomerProfile` | `dynamo-customer-reads.ts` |
| everything else | | stays in `dynamo.ts` |

Module-level names each moved function reads (from the code, untouched file):

| Function | Module-level names read |
|---|---|
| `getOrderForCustomer` | `requireTableName`, `docClient`, `GetCommand`, `normalizeEmail` |
| `getCustomerOrders` | `requireTableName`, `docClient`, `QueryCommand`, `normalizeEmail` |
| `getCustomerProfile` | `requireTableName`, `docClient`, `GetCommand`, `normalizeEmail` |

No fourth module-private name of `dynamo.ts` is read, so no other declaration moves to break a cycle.

Module names, one line each:

- `dynamo-client.ts` — the renderer read layer's one DynamoDB document client and the table-name check every read
  calls first.
- `dynamo-customer-reads.ts` — the DynamoDB reads of one customer's own commerce data: an order checked against the
  customer's email, the customer's order list, the customer's profile.

Abstraction record: `dynamo-client.ts` — users: `dynamo.ts` and `dynamo-customer-reads.ts` (two concrete callers);
axis: none, it is a cycle break, not a variation point; rejected simpler alternative: importing `docClient` and
`requireTableName` from `dynamo.ts` (a cycle, because `dynamo.ts` re-exports the customer reads).
`dynamo-customer-reads.ts` is not an abstraction: a file of three moved functions; users: `dynamo.ts` (re-export),
through it `SitePage.tsx`, `app/api/account/orders/route.ts`, `app/api/profile/route.ts`; its reason is the named
next change (`cmrc-1`), not a variation point. Rejected simpler alternative: leave the functions in `dynamo.ts` (the
order of work rejects it).

Result (EXECUTED, `wc -l`): `dynamo.ts` 996 lines, `dynamo-client.ts` 24, `dynamo-customer-reads.ts` 68.
1,082 − 88 removed lines (47; 52–73; 560–575; 656–704, each block with its trailing blank line) + 2 added lines
(`import { docClient, requireTableName } from "./dynamo-client";` and
`export { getOrderForCustomer, getCustomerOrders, getCustomerProfile } from "./dynamo-customer-reads";`) = 996.

Local decisions, one line each:

- `client` (the `DynamoDBClient`) is not exported: no file other than `dynamo-client.ts` reads it.
- The relative specifiers `./dynamo-client`, `./dynamo-customer-reads` follow the packet's ruling-1 wording; they
  resolve the same in Next, Vitest and `tsc` (all gates EXECUTED).
- `dynamo.ts` drops the import names it no longer reads (`DynamoDBClient`, `DynamoDBDocumentClient`,
  `normalizeEmail`); the unused `ScanCommand` import stays (it was unused before; F-RRR1-SCANCOMMAND-IMPORT).
- Import evaluation order: before, the client was built in the body of `dynamo.ts`; now it is built when
  `dynamo-client.ts` is evaluated, which is before the body of `dynamo.ts`. Its only input is
  `process.env.AWS_REGION`, read at import time before and after. No module in between reads or writes it.

## Importers (ruling 4)

Search (EXECUTED): `importers.mjs` in the slice trail. It is a regex over the module specifiers (`from "…"`,
`import(…)`, `vi.mock(…)`, `vi.doMock`, `vi.importActual`) of every `.ts/.tsx/.mjs/.js/.cjs` file under `renderer`,
`backend`, `admin`, `packages`, `tools`, `infra`, `scripts`, `tests`. Build output and dependencies are excluded, and
`@/` and relative paths are resolved to `renderer/src/lib/dynamo`. Cross-check: a plain
`grep -rlE "lib/dynamo[\"']" renderer` gives the same set of files. Basis for completeness: two independent text
searches that agree; no file outside `renderer/` names the module.

- Before: 59 references in 55 files, all to `renderer/src/lib/dynamo` (20 under `renderer/src`, 35 under
  `renderer/test/unit`).
- After: the same 59 lines, unchanged, plus the three new internal edges (`dynamo.ts` → `dynamo-client`,
  `dynamo.ts` → `dynamo-customer-reads`, `dynamo-customer-reads.ts` → `dynamo-client`). No importer was edited.
- Tests that replace the module (`vi.mock("@/lib/dynamo", …)`) do not load the new files. Tests that replace the AWS
  SDK (`vi.mock("@aws-sdk/lib-dynamodb", …)`, for example `order-email-1.test.ts`) replace it for every importer,
  so they now replace it for `dynamo-client.ts`. Both kinds pass unchanged (`cd renderer && npm test`: 66 files,
  964 tests before and after).
- Text readers (ruling 4, the bounded exception): none pins `dynamo.ts` for a moved function. The
  `projection-reserved-1` lint (`backend/test/unit/projection-reserved-1.test.ts`) scans `renderer/src` as a tree.
  It pins per-file counts only for six backend files (`AUDITED_RUNTIME_SITES`) and a minimum total (≥ 290).
  `newsletter-1-boundaries.test.ts` asserts that `src/lib/dynamo.ts` exists and that no renderer file names
  `NEWSLETTER#` (the new files do not). `renderer/test/serving-contract/fixtures.mjs:502` names `lib/dynamo.ts` in a
  comment only (F-RRR1-FIXTURE-COMMENT). So no check needed a path change, and none was edited.
- Lint totals (`lint-totals.ts`, the same scanner and file set as the test): before 337 files, 301 sites,
  12 unresolved, 0 bare reserved words; after 339 files, 301 sites, 12 unresolved, 0 bare reserved words.
  `dynamo.ts` 43 sites before; 40 + 3 (`dynamo-customer-reads.ts`) after.

## Server-only (ruling 5)

EXECUTED (`server-only.mjs`):

- Marker: `dynamo.ts` has no `import "server-only"`, and no file under `renderer/src` has one. So the new files have
  none either (F-RRR1-NO-SERVER-ONLY).
- Callers of the three functions (all import from `@/lib/dynamo`):

| Function | Caller | Kind |
|---|---|---|
| `getOrderForCustomer` | `renderer/src/components/SitePage.tsx` (two calls) | server component, no directive; imported only by `app/[siteId]/[[...slug]]/page.tsx` and `app/[siteId]/%5Fdyn/[[...slug]]/page.tsx` (server pages, no directive) |
| `getCustomerOrders` | `renderer/src/app/api/account/orders/route.ts` | route handler |
| `getCustomerProfile` | `renderer/src/app/api/profile/route.ts` | route handler |

- Reachability: of 33 modules with a `"use client"` directive, 0 reach `lib/dynamo*.ts` through their imports
  (transitive walk over the same edges as `graph.mjs`).
- Literal search (EXECUTED, `grep -rn "ORDER#\|CUSTOMER#\|CUSTORDER#" renderer/src`): the key prefixes occur only in
  `dynamo-customer-reads.ts`.

## Proofs

Scripts and outputs: `.agent-manager/slices/REFACTOR-RENDERER-READS-1/` (git-ignored). All EXECUTED.

1. **Moved text (ruling 7)** — `verify-moves.mjs`, by syntax tree (TypeScript compiler API). It is independent of
   the generator's line numbers and matches declarations by name. (a) Every top-level statement of the two new files
   is an import, an `export … from`, or a declaration whose full text (leading comments included, the one added
   `export ` removed) is byte-identical to the same-named statement of the untouched file. (b) The moved set is
   exactly `client`, `docClient`, `requireTableName` → `dynamo-client.ts` and the three functions →
   `dynamo-customer-reads.ts`. (c) The 38 remaining statements of `dynamo.ts` are byte-identical and in the same
   order; the file header and the end of the file are byte-identical. (d) `dynamo.ts` exports the same 34 names
   before and after. **MOVES ONLY: PASS.** Negative controls on a temporary copy: one byte in `getCustomerOrders`'
   projection → FAIL (1); an extra statement in the new file → FAIL (2); one byte in `getDeliveryConfig` (stays in
   `dynamo.ts`) → FAIL (1).
2. **DAG (ruling 3)** — `graph.mjs`: every specifier that `ts.preProcessFile` finds in `renderer/src/**` and
   `renderer/middleware.ts`, resolved, then Tarjan's strongly-connected components. Before: 95 files, 168 edges,
   0 cycles. After: 97 files, 171 edges, 0 cycles. The only edges at the three files are `dynamo.ts` →
   `dynamo-client.ts`, `dynamo.ts` → `dynamo-customer-reads.ts`, `dynamo-customer-reads.ts` → `dynamo-client.ts`.
   **DAG: PASS.** Negative control (temporary copy): `dynamo-client.ts` imports `./dynamo` → 1 cycle, exit 1.
3. **One client (ruling 2)** — `grep -rn "new DynamoDBClient(" renderer/src`: 3 before (`lib/dynamo.ts:52`,
   `app/api/posts/route.ts:12`, `lib/tenant-directory.ts:91`), 3 after (`lib/dynamo-client.ts:4` and the same two).
   Run-time check `one-client.cts` (loads `dynamo.ts`, `dynamo-customer-reads.ts`, `dynamo-client.ts` in one module
   graph and counts `DynamoDBDocumentClient.from` calls): `documentClientsBuilt: 1`.
4. **Served bytes (ruling 6)** — `npm run test:serving` 176/176 and `npm run test:serving-bundle` 61/61 on the
   untouched tree. On the moved tree they give the same counts, twice (after the move, and again in the gates).
   `git status` shows no change under `renderer/test/`, and nothing was re-captured. The order-tracking page of
   fixture tenant CM1 (`checkout_cm1-order-cod_…` captures, tracking number `AWB-CM1-0002`) is read through the
   moved `getOrderForCustomer`, so that function runs end-to-end through the built server in the byte comparison.
5. **Unit suite (ruling 4)** — `cd renderer && npm test`: 66 files, 964 tests before and after. No test file was
   edited, skipped or added (`git status`).

## Coverage

- `getOrderForCustomer`: unit test `order-email-1.test.ts` (through the real function, SDK replaced) and the serving
  captures of the order pages.
- `getCustomerOrders`, `getCustomerProfile`: no renderer test and no serving row reaches them (EXECUTED:
  `grep -rn -E "getCustomerOrders|getCustomerProfile" renderer/test` → no hit; `locale-1d-client.test.ts` stubs the
  HTTP answers of `/api/account/orders` and `/api/profile` and does not reach the reads; `docs/TECH-DEBT.md`,
  `projection-reserved-1` entry, says the same for `getCustomerOrders`). Both routes take the email from the
  NextAuth session (OBSERVED: `app/api/account/orders/route.ts`, `app/api/profile/route.ts`). For this slice their safety rests on the
  moved-text proof (byte-identical declarations), the type check, the run-time load (`one-client.cts`: both are
  functions exported through `dynamo.ts`), and the `projection-reserved-1` lint over their expressions. An
  end-to-end check is the operator's staging gate (a signed-in account page). This slice adds no new test: it
  changes no behaviour, and the packet forbids added tests.

## Migration / deployment notes

- **Data migration:** none. No stored attribute, key, projection, query or default changes.
- **Deployment scope:** the renderer only (the OpenNext server function), rebuilt from the moved sources. No Lambda
  handler, route, permission, table, admin or infra change. A stack deploy rebuilds the other bundles from unchanged
  sources.
- **Rollback:** revert the slice's commit, rebuild (`npm run build`) and deploy again. No data to restore. Cached
  pages stay valid: the bytes are the same.
- **Operator gates (NOT RUN by the builder):** at closeout, check that the staging diff shows rebuilt code only;
  deploy to staging; render the three test sites against the real tables, with an order confirmation or tracking page
  and, if a signed-in account is available, the account page (order history and profile: the two reads no automated
  check reaches).

## Definition of Done

- The six declarations are in the files of § *File map*; `dynamo.ts` holds the rest and exports every name it
  exported before.
- `verify-moves.mjs` PASS, `graph.mjs` DAG PASS, client count unchanged, importers unchanged, server-only recorded.
- Both serving suites pass with no capture changed; the unit suite passes the same 964 tests unedited.
- The seven packet gates exit 0; docs updated (§ *Scope* item 5); the operator gates above pass.

## Evidence required

- EXECUTED by the builder: the baselines on the untouched tree; the proofs and their negative controls; the seven
  gates (§ *Build record*).
- OBSERVED by the operator before SHIPPED: the staging diff and the three test sites on staging.

## Exit criterion

`cmrc-1` changes the renderer's reads of orders and customers in one file of 68 lines
(`renderer/src/lib/dynamo-customer-reads.ts`) and the one re-export line of `dynamo.ts`. Its review reads that file.

## References

- `docs/ROADMAP.md`, order of work from 2026-11-27, row `refactor-renderer-reads-1`.
- `docs/slices/refactor-sitepage-1.md`, `docs/slices/refactor-mcp-1.md` (the earlier pure-move slices).
- `docs/slices/cmrc-1.md` (the next change to these reads); `docs/platform-decisions.md` PD-001, PD-002.
- `renderer/ARCHITECTURE.md` § *Direct DynamoDB Access* (three-file map, rule, direction).
- `docs/caching-architecture.md` § *Serving contract*; `renderer/test/serving-contract/README.md`.

## Docs (ruling 8)

- `renderer/ARCHITECTURE.md`: the tree lists the two new files; § *Direct DynamoDB Access* has the three-file map,
  the rule "reads of orders and customers go in `lib/dynamo-customer-reads.ts`; `cmrc-1` changes that file", the
  import direction, the one-client rule, and the statement that the error rule covers all three files; § *Order read
  by email* names the new file.
- `docs/slices/cmrc-1.md` (open spec): its 13 citations `dynamo.ts:<line>` of the three functions (on 12 lines; S16–S18,
  P4, the code sketches, D1–D3, the D-decision text, D5) now name the function and
  `renderer/src/lib/dynamo-customer-reads.ts` (`cmrc1-citations.mjs`, each replacement matched exactly once; after it
  `grep -E "dynamo\.ts:[0-9]"` finds none).
- `docs/ROADMAP.md` row and `CURRENT_SLICE.md`.

**Location rule (iteration 1, review-0 finding RRR1-DOC-RIPPLES).** The defect class: a document states where a
moved declaration lives, and names the old file. The rule that closes it: *in every open document, a statement of
where one of the six moved declarations (`getOrderForCustomer`, `getCustomerOrders`, `getCustomerProfile`, the
client and `docClient`, `requireTableName`) or their key literals live, or of which file a rule covers, names the
declaring file (`dynamo-customer-reads.ts` or `dynamo-client.ts`). It names `dynamo.ts` only for what is still
there: the re-export line and the import surface `@/lib/dynamo`.* Open documents are the `ARCHITECTURE.md` files,
the reference docs under `docs/`, and slice specs that are not closed (PLANNED, draft, RATIFIED but not built).
Closed slice records, shipped records, change logs and dated source plans keep their text. A source plan's claims
are reconciled in the spec that re-verifies it (`cmrc-1` § 3).

Check that closes the class (EXECUTED): `ripple-scan.mjs` in the slice trail. It reads every tracked `.md` file as
paragraphs and table rows, not single lines, because the subject and the file name can be on different lines (the
part-L text of `cmrc-1`). It flags each unit that names `dynamo.ts` or `lib/dynamo`, names a moved subject (the
three reads, S16–S18, their key prefixes, `requireTableName`, `docClient`, the client, "read helper"), and names
neither new file. Detection control: on the iteration-0 copies of the four documents edited in iteration 1
(`cmrc-1.iter0.md`, `pay-2.orig.md`, `caching-architecture.orig.md`, `renderer-ARCHITECTURE.iter0.md`) it flags 14
units, the multi-line part-L paragraph of `cmrc-1` included; on the current files, 4 (`cmrc-1` T8 and three false
positives in `renderer/ARCHITECTURE.md`). The other 10 are the reconciled ones. Over the whole tree after iteration 1:
44 units in 19 files (`ripple-scan.final.out`), each one closed, a false positive or true as written:

| Kind | Files (units) |
|---|---|
| Closed records (build records, shipped records, change log) | `docs/shipped/slices/cache-1-…` (6), `fnd-1-…` (2), `fnd-2-…` (2), `digital-file-guard-1` (5), `order-checkout-1` (2), `order-email-1` (3), `projection-reserved-1` (3), `opennext-1-upgrade` (1), `refactor-sitepage-1` (1), `shop-look-1a` (1), `docs/security-remediation-status.md` (3) |
| Dated source plan, reconciled by `cmrc-1` P7 / P17 | `docs/plan-commerce-private-table.md` (1) |
| False positive: an unmoved function, or "client" in another sense | `lang-1` (2: the membership rule), `locale-1` (1: `mapTenant`), `sched-1` (1: "client-address"), `docs/commerce.md` (1: "Client POST" in the diagram), `renderer/ARCHITECTURE.md` (3: `mapTenant`, the membership rule, and line 251 "like every other helper in `lib/dynamo.ts`", which is about a call still in that file) |
| True as written | `cmrc-1` T8 (1: the tests mock `@/lib/dynamo`, which still exists); this spec (5: the untouched state, the coverage, and this section: the scan description and this table) |

Reconciled in iteration 1 (`ripples-iter1.mjs`, `pay-2` replacement; each replacement matched exactly once):

- `docs/slices/cmrc-1.md`: the part-L text (S16 stays in `dynamo-customer-reads.ts`, re-exported by `dynamo.ts`);
  C1 (the counted `ORDER#` exception is in `dynamo-customer-reads.ts`); C4 (deleted from `dynamo-customer-reads.ts`
  and from the re-export; **[L]** removes the file, which is empty then, and the re-export line); the file plan (one
  row became two: `dynamo-customer-reads.ts` and the re-export line of `dynamo.ts`); T3 (the exception's file); G8
  (part K: `getOrderForCustomer` in `dynamo-customer-reads.ts` (declaration), `dynamo.ts` (re-export) and
  `SitePage.tsx`); P17 (the plan's "from `renderer/src/lib/dynamo.ts`" now means both files). Part K/L contents,
  the order of work and every decision of `cmrc-1` are unchanged.
- `docs/slices/pay-2.md` (open spec) C10: `renderer/src/lib/dynamo.ts:536-549` → `getOrderForCustomer` in
  `renderer/src/lib/dynamo-customer-reads.ts`.
- `docs/caching-architecture.md` § *Failed reads throw*: the rule covers every read helper in `dynamo.ts` and in
  `dynamo-customer-reads.ts`.
- `renderer/ARCHITECTURE.md` (tenant directory): its client is separate from the read layer's client
  (`lib/dynamo-client.ts`).

## Findings, not fixed

- **F-RRR1-HEADER-SCOPE.** The header of `dynamo.ts` says "Not one function in this file may catch an AWS/SDK
  error" and "Every function here is reachable from a render". The JSDoc of `requireTableName` (now in
  `dynamo-client.ts`) says "The DynamoDB table every helper in this file reads" and "See the file header". After the
  move these words are false in their new place: `dynamo-client.ts` has no helper that reads a table and no such
  header, and the rule's text does not reach `dynamo-customer-reads.ts`. The behaviour is unchanged (every moved read
  still calls `requireTableName()` and catches nothing). Interim: `renderer/ARCHITECTURE.md` states the rule for all
  three files. Proposed fix (a later slice; new comment text is outside "moves only"): "every helper of the renderer
  read layer (`dynamo.ts`, `dynamo-customer-reads.ts`)" in the JSDoc, and a one-line pointer to the `dynamo.ts`
  header at the top of `dynamo-customer-reads.ts`.
- **F-RRR1-NO-SERVER-ONLY.** No file of the read layer has `import "server-only"`. Today no `"use client"` module
  reaches them (checked), but nothing stops one at build time. The three customer reads return personal data.
  Proposed: add the `server-only` package and marker to the three files in a slice that may add a dependency (this
  packet forbids one).
- **F-RRR1-SCANCOMMAND-IMPORT.** `dynamo.ts` imports `ScanCommand` and never uses it (unused before the slice too;
  `tsc --noUnusedLocals`). The name suggests a scan in the read layer, which `CLAUDE.md` rule 2 forbids; there is
  none. Proposed: delete the import.
- **F-RRR1-COMMENT-NUMBERING.** The numbered comments of `dynamo.ts` now go `// 9.`, `// 11.`, `// 11b.`; `// 10.`,
  `// 12.`, `// 13.` are in `dynamo-customer-reads.ts`. Cosmetic.
- **F-RRR1-FIXTURE-COMMENT.** `renderer/test/serving-contract/fixtures.mjs:502` says the `ORDER#<id>` items are read
  by "`lib/dynamo.ts` getOrderForCustomer". True through the re-export; the function is now defined in
  `lib/dynamo-customer-reads.ts`. A test file; not edited (ruling 4).
- **F-RRR1-CMRC1-PATHS — resolved in iteration 1** (review-0 RRR1-DOC-RIPPLES). The six location statements of
  `cmrc-1` (part-L text, C1, C4, file plan, T3, G8) were deferred in iteration 0; they now follow the location rule of
  § *Docs (ruling 8)*. Not a fix of a defect in code; the documents only.
- **F-RRR1-PAY2-ALLOCATION.** `docs/slices/pay-2.md` allocates `renderer/src/lib/dynamo.ts` to two of its own future
  changes (link B, and `pay-2e` "attempts read for the order page"). Under the new rule of `renderer/ARCHITECTURE.md`
  ("reads of orders and customers go in `lib/dynamo-customer-reads.ts`"), a new read of order data belongs in that
  file. Which of pay-2's reads are order reads is pay-2's design, so its allocation is not edited here. Proposed: the
  next revision of `pay-2` checks its renderer allocation against the rule.
- **F-RRR1-LINE-CITATIONS.** About 170 `dynamo.ts:<n>` line citations of functions that did not move remain in 35
  documents. Almost all are build records tied to the commit they cite, and many were already off before this slice
  (`pay-2` gave 536–549 for a function that was at 561). This slice shifts the lines of the unmoved code: by −21
  after untouched line 73, −37 after line 575, −86 after line 704. Not updated: a line citation is evidence of the
  commit it was taken at, not a location statement of a moved declaration.
- **F-RRR1-NAME-CUSTOMER-READS (name check, no defect).** `getOrderForCustomer` reads an order by id and returns it
  when the stored email equals the email given in the page address. It does not check a session (`cmrc-1`,
  decision CMRC-ORDER-LOOKUP-AUTHORITY). So "for customer" means "for whoever holds the order id and the email", not
  "for the signed-in customer". The module name `dynamo-customer-reads` ("reads of one customer's own commerce data")
  is true for the data read. It does not claim an authorization check.

## Deviations

Ruling 8 names `renderer/ARCHITECTURE.md` and `docs/slices/cmrc-1.md`. In iteration 1, under `CLAUDE.md` "chase
ripples" and review-0, the location rule also reached `docs/slices/pay-2.md` (one citation) and
`docs/caching-architecture.md` (one sentence). Both are open documents and not protected paths; neither edit changes
a decision. Otherwise none from the packet's rulings. One process note: the first baseline run of `npm --prefix backend run test:unit`
did not start (a relative log path was wrong after `cd ..`; the shell refused the redirect, exit 1). It was run again
with an absolute path: exit 0.

## Build record

Builder `claude-opus-5-5`, 2026-11-27, base `bd64341`, tree clean at the start (`git status --short` empty).
Detailed log and every script: `.agent-manager/slices/REFACTOR-RENDERER-READS-1/` (git-ignored): `build-progress.md`,
`dynamo.orig.ts` (the untouched file, sha256 `cebbac4e…`), `split.mjs` (the generator), `verify-moves.mjs`,
`graph.mjs`, `importers.mjs`, `server-only.mjs`, `lint-totals.ts`, `one-client.cts`, `cmrc1-citations.mjs`, their
`.out` files, the baseline and gate logs.

1. **Spec (EXECUTED).** This file with § *File map*, before the first move; the ranges were checked with `sed`
   against the untouched file.
2. **Baseline (EXECUTED, untouched tree).** `npm run build` exit 0; `cd renderer && npm test` exit 0 (66 files,
   964 tests); `npm run test:serving` exit 0 (176/176); `npm run test:serving-bundle` exit 0 (61/61);
   `npm --prefix backend run test:unit` exit 0 (93 files passed, 2 skipped; 2,451 tests passed, 2 skipped); client
   count 3; importers 59/55; lint totals 301/12/0; graph 0 cycles.
3. **Move (EXECUTED).** `node split.mjs`; renderer `tsc --noEmit` exit 0.
4. **Proofs (EXECUTED).** § *Proofs* 1–3, § *Importers*, § *Server-only*, with their negative controls.
5. **Serving after the move (EXECUTED).** `npm run test:serving` exit 0 (176/176); `npm run test:serving-bundle`
   exit 0 (61/61); no capture changed.
6. **Docs (EXECUTED).** § *Docs (ruling 8)*.
7. **Gates (EXECUTED, exit status):** `npm run build` 0; `npm run typecheck` 0; `cd renderer && npm test` 0 (66 files,
   964 tests); `npm run test:serving` 0 (176/176); `npm run test:serving-bundle` 0 (61/61);
   `npm --prefix backend run test:unit` 0 (93 + 2 skipped files; 2,451 + 2 skipped tests); `git diff --check` 0;
   `git diff --no-index --check /dev/null <file>` for each of the three new files: exit 1 with no report, which
   means "differs from /dev/null, no whitespace error" (control: a file with a trailing space gives exit 3 and a
   report). After the gates, `verify-moves.mjs` again: PASS; sha256 of the three source files concatenated
   (`dynamo.ts`, `dynamo-client.ts`, `dynamo-customer-reads.ts`): `e6505f93…` (`moved-tree.sha256`). Also
   (not a packet gate) `cd tools/mcp-server && npm test` 0: no backend route changed, `routes.json` not refreshed.
8. **NOT RUN:** the operator's staging gates (§ *Migration / deployment notes*); `cd backend && npm test` (forbidden
   by the packet); `npm run lint` (not a gate of this packet).

### Iteration 1 (review-0, EXECUTED)

Review-0 asked for one change, RRR1-DOC-RIPPLES (documents only; it did not ask for a code change). Done as the
location rule of § *Docs (ruling 8)*, closed by `ripple-scan.mjs`, not by patching the six reported lines alone.
Production code unchanged since review-0: the sha256 of the three source files concatenated equals
`moved-tree.sha256`; `verify-moves.mjs` PASS. Gates of this round: § *Iteration 1 gates*.

### Iteration 1 gates (EXECUTED, exit status)

`npm run build` 0; `npm run typecheck` 0; `cd renderer && npm test` 0 (66 files, 964 tests); `npm run test:serving` 0
(176/176); `npm run test:serving-bundle` 0 (61/61); `npm --prefix backend run test:unit` 0 (93 files passed + 2 skipped;
2,451 tests passed + 2 skipped); `git diff --check` 0; `git diff --no-index --check /dev/null <file>` for the three new
files: exit 1 with no report (clean; the iteration-0 control with a trailing space gave exit 3 and a report). No file
under `renderer/test/` changed. Logs: `.agent-manager/slices/REFACTOR-RENDERER-READS-1/iter1-*.log`,
`gates-iter1-exits.txt`.

## Closeout (operator, 2026-11-27)

- Relay: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, two cycles; review-0 `revise` (RRR1-DOC-RIPPLES: six
  citations in the open spec `docs/slices/cmrc-1.md`), review-1 `approved`.
- Operator gates on the approved tree, each exit 0: build, typecheck, shared, plugins, renderer, serving,
  serving-bundle, admin unit, backend unit, infra, mcp, `git diff --check`; no change under `backend`, `infra`,
  `packages`, `admin`, `tools`, `renderer/middleware.ts`, `renderer/src/components`, `renderer/src/app`,
  `renderer/test`, a manifest or a lockfile.
- One client: `new DynamoDBClient(` in `renderer/src/lib/dynamo-client.ts` replaces the one of `dynamo.ts`; the two
  other creations in `renderer/src` (`app/api/posts/route.ts`, `lib/tenant-directory.ts`) are not touched.
- Staging diff (read before the deploy): 0 resources added, 0 removed, no IAM change; the renderer functions and
  site assets rebuilt. Deploy: `AmodxStack-staging` succeeded.
- Staging proof (read-only, real tables): the page render check (shop, category, product, search, cart, checkout on
  `cm1-commerce`; shop, category, product, search on `cm1-catalog`: 10 of 10) and the general smoke pass.
- NOT proven on staging: the three moved reads with real data (an order opened by its customer, the account order
  list, the account profile). They need an order with its e-mail or a signed-in customer; staging refuses a
  scripted sign-in. Basis for these: each moved declaration is byte-identical (the moved-text proof, reproduced by
  the reviewer), the serving suites and the unit suite.
- Finding, not fixed (wording moved byte for byte): the comment above `requireTableName` in `dynamo-client.ts` says
  "every helper in this file reads"; the helpers are in `dynamo.ts` and `dynamo-customer-reads.ts` now.
