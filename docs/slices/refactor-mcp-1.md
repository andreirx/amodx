# REFACTOR-MCP-1 — `tools/mcp-server/src/index.ts` into one module per tool group (moves only)

- **Status:** IMPLEMENTED 2026-11-27 — built, operator gates pending (oracle 1 on the commit before the slice and on
  the new tree). Revision iteration 1 (review-0 "revise") applied 2026-11-27: § *Revision iteration 1*
- **Track:** maintenance (order of work from 2026-11-27, `docs/ROADMAP.md`: the pure-move refactor slices, before
  Track B)
- **Depends:** none
- **Source plan:** none. Ratified by the human's order of work of 2026-11-27 ("add a slice for refactoring the … big
  files … before moving on to a consequential track like the private commerce table"). ROADMAP row `refactor-mcp-1`.
  No ratification-class decision.
- **Maturity:** unchanged (a move changes no module's maturity).

## Purpose / risk retired

`tools/mcp-server/src/index.ts` held 2,794 lines at the start of the slice (the ROADMAP row said 2,727): the server
start, the HTTP helpers, the block definitions for the AI client (`BLOCK_SCHEMAS`) and 80 tool registrations of every
domain. Most slices that add a route add a tool there. After this slice each tool group has its own file under
`src/tools/` and `index.ts` keeps the start. An AI client sees the same tools, in the same order, with the same
descriptions and input schemas, and each tool sends the same request. The next track (the private commerce table)
changes the order and customer tools; it finds them in `src/tools/orders-customers.ts` (93 lines).

## Scope

1. The tool registrations, the module-level constants between them, the pure helpers and `BLOCK_SCHEMAS` move, byte
   for byte and with their comments, into the files of § *File map*.
2. Each group file has ONE wrapping function `register<Group>Tools(server, deps)`; its body is the moved lines,
   not re-indented (§ *Shared state*). `index.ts` calls the functions in the original order.
3. The two text oracles follow the code (ruling 5): `scripts/route-coverage.ts` reads every `src/**/*.ts` file;
   the two source checks of `test/tool-shapes.test.ts` read the file that holds their text now.
4. Docs: `tools/mcp-server/ARCHITECTURE.md` (file map, the rule "a new tool goes in its group file; `index.ts` holds
   the start only"), the forward-looking pointers to `index.ts` in `docs/` (§ *Docs corrected*), ROADMAP row,
   `CURRENT_SLICE.md`.

## Non-scope

No rename, no changed description, schema, request, error text or order of registration; no new tool, no removed
tool; no new dependency; no edit to `package.json` or a lockfile; no move or rename of `tool-shapes.ts`. No new test
that imports a group file (the seam exists after this slice; using it is a later slice's choice). A defect or a
false name found on the way is recorded in § *Findings, not fixed*.

## Architectural boundaries

- The MCP server is a local client of the backend HTTP API. This slice changes no request, no route and no header
  (oracle 2 pins the method+path set; oracle 3 pins every moved line).
- Module graph inside `src/`: `index.ts` → `tools/*` → `tool-helpers.ts`, `tool-shapes.ts`, `block-schemas.ts`.
  `tools/content.ts` → `block-schemas.ts` → `tool-shapes.ts`. No module imports `index.ts`; no group file imports
  another group file. The graph is a DAG.
- Environment reads stay in `index.ts` (§ *Shared state*, *Environment order*). No backend, shared, admin, renderer or
  infra file changes; tenant isolation and the no-scan rule are not touched.

## Rules applied to each move

- **Byte for byte.** A moved line keeps its text and its indentation. The body of a wrapping function is NOT
  re-indented: the `get_schema` description is a template literal whose text includes its leading spaces, so a
  re-indent would change what the client receives. Unchanged lines also keep `git diff --color-moved` usable.
- **Permitted new text:** `import` lines; the keyword `export` in front of a moved declaration; per group file one
  wrapping function line (its parameter type written inline) and its closing `}`; in `index.ts` the 21
  `register…Tools(…)` calls of mechanism (b). **No other declaration is new** — no shared type, no deps variable.
  Oracle 3's whitelist holds exactly these categories and lists every line it accepts as new.
- **Contiguous groups.** A group file is one contiguous range of the original file. A split that needs two ranges in
  one file would change the registration order (ruling 3), so the sections are cut at the section comments the file
  already has.

## Shared state (ruling 2)

Mechanism chosen: **(b) `register<Group>Tools(server, deps)` functions called by `index.ts`.**

- `index.ts` keeps everything that reads the environment or the live start-up check: `STORAGE_DIR`, `dotenv.config()`,
  `API_KEY`, `API_URL`, the missing-variable exit, `let apiKeyValid`, `validateApiKey()`, `getHeaders()`, the
  `McpServer` object and `main()`. These lines do not change.
- A group function receives `server` and an object with only the names it uses, from `API_URL`, `getHeaders`,
  `STORAGE_DIR`; the type is written inline in the wrapper line (`{ API_URL: string; getHeaders: (tenantId?: string)
  => any }`; `social.ts`: `{ STORAGE_DIR: string }`); a group that uses none takes `server` only. `index.ts` passes the
  object literal at each call (`registerCouponTools(server, { API_URL, getHeaders });`). `getHeaders` is the function object from `index.ts`, so it reads
  `apiKeyValid` through its closure at call time — the live value that `main()` writes after the registrations.
- `STORAGE_DIR` stays in `index.ts` because it is computed from `import.meta.dirname`: in `dist/tools/social.js` the
  same expression would point at `dist/.storage`, not at `tools/mcp-server/.storage`.
- The pure helpers that read no state (`apiError`, `PENDING_MARKER_ATTEMPT`, `PAGE_REVALIDATION_ATTEMPT`,
  `JsonInput`, `parseJsonInput`) and `BLOCK_SCHEMAS` are ordinary imports. `JsonInput` is a type, and a type cannot
  travel in `deps`.
- Rejected: (a) a `context.ts` module that owns the names. `main()` assigns `apiKeyValid = await validateApiKey();`
  and an ES module cannot assign an imported binding, so (a) needs either a changed line (a holder object or a
  setter — not a move) or `main()` itself inside `context.ts` (then `index.ts` no longer holds the start). (a) also
  makes the registration order the order of side-effect imports, which no line states.

### Environment order

ES modules evaluate every imported module before the body of the importing module. Under (b) a group file's top
level holds only `import` lines and one `export function` declaration; `tool-helpers.ts`, `block-schemas.ts` and
`tool-shapes.ts` hold constants and functions that read no environment. The only `process.env` reads are in
`index.ts`, after `dotenv.config()` (proof in § *Proofs*, E-ENV).

## File map (ruling 1) — proposed before the first move, built as proposed

Original line ranges are those of `index.ts` at `00535d9`. Line counts are of the new file, including imports and
the wrapper.

| File | Original lines | Holds | Tools |
|------|----------------|-------|------:|
| `src/index.ts` | 1–68, 700–703, 2777–2794 | imports, `STORAGE_DIR`, dotenv, env check, `apiKeyValid`, `validateApiKey`, `getHeaders`, `server`, the register calls, `main` | 0 |
| `src/tool-helpers.ts` | 70–112 | `apiError`, the two cache-wording texts, `JsonInput`, `parseJsonInput` | 0 |
| `src/block-schemas.ts` | 114–698 | `BLOCK_SCHEMAS` (one constant, 583 lines) | 0 |
| `src/tools/tenants.ts` | 705–736 | 1. SITE & TENANT MANAGEMENT | 2 |
| `src/tools/strategy-context.ts` | 737–842 | 2. STRATEGY & CONTEXT | 5 |
| `src/tools/content.ts` | 843–1146 | 3. CONTENT & BLOCKS, with the REDIRECT-1 tools | 11 |
| `src/tools/products.ts` | 1147–1300 | products (no banner in the file) and CATALOG: GLAM PRICELIST IMPORT | 7 |
| `src/tools/categories.ts` | 1301–1347 | COMMERCE: CATEGORIES | 2 |
| `src/tools/orders-customers.ts` | 1348–1440 | COMMERCE: ORDERS, COMMERCE: CUSTOMERS | 5 |
| `src/tools/coupons.ts` | 1441–1483 | COMMERCE: COUPONS | 2 |
| `src/tools/reviews.ts` | 1484–1523 | COMMERCE: REVIEWS | 2 |
| `src/tools/delivery.ts` | 1524–1555 | COMMERCE: DELIVERY | 2 |
| `src/tools/reports.ts` | 1556–1597 | COMMERCE: REPORTS | 1 |
| `src/tools/bulk-price.ts` | 1598–1636 | COMMERCE: BULK PRICE ADJUSTMENT | 1 |
| `src/tools/forms-popups.ts` | 1637–1881 | ENGAGEMENT: POPUPS & FORMS | 11 |
| `src/tools/assets-resources.ts` | 1882–1956 | media (`list_assets`) and private resources | 4 |
| `src/tools/comments.ts` | 1957–2012 | comments | 2 |
| `src/tools/themes.ts` | 2013–2124 | 5. THEME MANAGEMENT | 4 |
| `src/tools/signals.ts` | 2125–2265 | 6. SIGNALS (with `search_web`, `scrape_url`) | 5 |
| `src/tools/leads.ts` | 2266–2331 | LEADS | 3 |
| `src/tools/service-keys.ts` | 2332–2397 | INTEGRATION (SERVICE) KEYS | 3 |
| `src/tools/system-audit-email.ts` | 2398–2517 | SYSTEM, AUDIT & EMAIL | 5 |
| `src/tools/social.ts` | 2518–2659 | 7. SOCIAL MEDIA (browser automation, `PLATFORM_URLS`) | 2 |
| `src/tools/schema-reference.ts` | 2660–2776 | 4. SCHEMA REFERENCE (`get_schema`) | 1 |

Two cuts differ from the list in ruling 1, both forced by ruling 3 (same registration order):

- **Forms and popups share one file.** `list_popups` is registered before the form tools and the other popup tools
  after them (one banner, "ENGAGEMENT: POPUPS & FORMS"). Two files would need two ranges for popups.
- **Bulk price and reports are not in `products.ts`.** They sit after delivery, so they keep their own banners.

"Settings" has no tool group in the file (no tool writes settings except `apply_theme` in `themes.ts`); "research"
is `search_web` and `scrape_url` in the SIGNALS section.

## Migration / deployment notes

None. The package is a local tool and is not deployed to AWS. `npm run build` emits `dist/index.js` (the entry
`package.json` `start` and `setup.ts` point at) plus `dist/tool-helpers.js`, `dist/block-schemas.js` and
`dist/tools/*.js`. A running Claude Desktop picks the new build up at its next server start. Rollback: revert the
commit and rebuild.

## Definition of Done

- Oracle 1: the `tools/list` answer (with server info and capabilities) of the new build is byte-identical to the
  one of the untouched tree.
- Oracle 2: the route-coverage output and its full attributed-call list are identical before and after (line
  numbers aside); `npm test` passes the same 23 rows; each source check is proved to still detect a mutation.
- Oracle 3: every non-blank, non-import line of the original `index.ts` is in exactly one new file, in order, and
  the new files hold no other line except the permitted new text.
- The registration order is the same (80 names, before and after).
- `npm run build`, `npm run typecheck`, `cd tools/mcp-server && npm test`, `git diff --check` exit 0.
- Docs of ruling 8 corrected and listed; ROADMAP row and `CURRENT_SLICE.md` updated.

## Evidence required

The oracle outputs and hashes (EXECUTED), the mutation proofs (EXECUTED), the environment-order proof (EXECUTED), the
gate exit codes (EXECUTED). At closeout the operator reruns oracle 1 on the commit before the slice and on the new
tree.

## Exit criterion

The private commerce track edits `src/tools/orders-customers.ts` (and its other commerce group files) without
touching a 2,800-line file. A later slice may test a group file by importing it with a stub server: a group module
starts nothing on import.

## References

- `docs/ROADMAP.md` row `refactor-mcp-1`; order of work of 2026-11-27.
- `tools/mcp-server/ARCHITECTURE.md` § *Internal Structure*, § *Drift oracle*.
- `docs/slices/refactor-settings-1.md`, `docs/slices/refactor-sitepage-1.md` (the same moves-only pattern).
- `docs/slices/mcp-sync-1.md` (the route-coverage oracle).

Built line counts (after iteration 1): `index.ts` 130, `tool-helpers.ts` 43, `block-schemas.ts` 587, group files 38 (`delivery.ts`) to 311
(`content.ts`); `forms-popups.ts` 252. No file above 500 lines except `block-schemas.ts` (one constant).

## Proofs

All scripts and outputs are in the slice trail `.agent-manager/slices/REFACTOR-MCP-1/` (gitignored, not in the
repository). "Before" is `00535d9` with a clean tree, built with `npx tsc --outDir REFACTOR-MCP-1-dist-before`.

| Id | What | Result | Label |
|----|------|--------|-------|
| O1 | `oracle1-tool-list.mjs`: the server started over stdio by the MCP SDK client, `AMODX_API_URL=http://127.0.0.1:9`, a dummy key, an empty temporary cwd (no `.env` read); server info, capabilities, `tools/list` written as JSON. The server advertises `tools` only, so there is no `prompts/list` or `resources/list` to call | before `f3de35b4…4e07f` (75,035 bytes, a rerun gave the same hash); after every one of the 22 move steps the same; after the gate build (`dist/index.js`) the same | EXECUTED |
| O1b | `oracle1b-local-tools.mjs`: the results of the local-only `get_schema` and `get_block_schemas` (texts that `tools/list` does not show) | before = after, `f75a0fd4…66d9` | EXECUTED |
| ORDER | `server.tool("…"` names in source order, and the `tools/list` order | 80 names; before: source order = list order; after: the list is byte-identical (O1), so the order is the same | EXECUTED |
| O2a | `npx tsx scripts/route-coverage.ts`, full output | before = after (diff empty); exit 0 both: 80 registrations, 86 calls parsed, 71 distinct routes, 2 `knownBroken`, 53 admin routes with no tool | EXECUTED |
| O2b | the attributed calls (a copy of the script that also prints every call, sorted) | 86 both; the same distinct set; the multiset differs in one phantom: 2× `GET /comments` → 2× `GET /reviews` (F-RMCP1-1) | EXECUTED |
| O2c | mutations, each restored and its hash checked: `gallery:` key in `block-schemas.ts`; `"gallery"` in the `add_block` enum in `tools/content.ts`; the `formBody(…)` argument and the `date_order` description in `tools/forms-popups.ts`; a path in `tools/orders-customers.ts`; one `server.tool(` in `tools/social.ts`; a `${API_URL}` in a comment in `tools/leads.ts` | test 19 fails (2×), test 23 fails (2×), route coverage exits 1 with `src/tools/orders-customers.ts:37: GET /orderz/{x}`, `says 80 tools; src/ registers 79`, `src/tools/leads.ts:8: ${API_URL} use not attributable` | EXECUTED |
| O3 | `oracle3-moved-text.mjs`: the non-blank, non-import lines of the original; each new file minus its permitted lines must be one contiguous run of them, in register-call order; the rest must equal `index.ts` | PASS, 2,604 = 2,604 lines. After iteration 1: 178 permitted lines removed, each printed: 109 imports, 21 wrapper lines, 21 closing `}`, 21 register calls, 6 `export` keywords. The whitelist admits no declaration: re-adding the `ToolDeps` type (M8) or a `const toolDeps` line (M9) makes it FAIL | EXECUTED |
| O3b | `oracle3b-exact-blocks.mjs`: each moved block, blank lines included, is an exact substring of the original | PASS, 23 files | EXECUTED |
| E-ENV | `proof-env-live.mjs`: no `AMODX_*` variable in the environment, a temporary cwd whose `.env` holds dummy values → the server starts; no `.env` → exit 1, "AMODX_API_URL or AMODX_API_KEY is missing in .env" | before = after | EXECUTED |
| E-LIVE | same script: a local stub answers `GET /tenants` 200, so `main()` sets `apiKeyValid` after the registrations; `list_tenants` (in `tools/tenants.ts`) reaches the stub (`x-api-key` = the dummy, `Bearer robot`). Against a closed port the same call returns "AMODX API key is invalid …" | before = after | EXECUTED |
| E-TOP | `proof-top-level.cjs` (TypeScript AST): every group file's top level is imports + one function declaration; `block-schemas.ts` one import + one constant; `tool-helpers.ts` constants and types; `process.env` only at `index.ts:33,36`, after `dotenv.config()` at `:31` | as stated | EXECUTED |
| E-UNUSED | `npx tsc --noEmit --noUnusedLocals` in `tools/mcp-server` | exit 0: no unused import | EXECUTED |

What O3 does not prove: that a moved name binds to the same thing in its new module (an import could bring a
different `z` or helper). The typecheck, O1 (schemas built from `z`), O1b, E-LIVE and the import lists (only the
original modules and the moved helpers) cover that. O1 does not cover the text a tool returns after an API call; O3
and O3b cover those lines as text. Nothing here calls a tool against the real API.

## Imports and the module graph

`index.ts` imports `McpServer`, `StdioServerTransport`, `axios` (for `validateApiKey`), `dotenv`, `path` (for
`STORAGE_DIR`) and the 21 register functions; `zod`, `cheerio`, `playwright`, `fs` and the
`tool-shapes.js` names moved with the code that uses them. Every library import keeps its original form
(`import * as fs from "fs"`, …). No module imports `index.ts`; no group file imports another group file. `dist/`:
`dist/index.js` (the `npm start` / `setup.ts` entry, unchanged path), `dist/tool-helpers.js`, `dist/block-schemas.js`,
`dist/tool-shapes.js`, `dist/tools/*.js` (21). `package.json` has no `main`, `bin` or `files` field; it is not edited.

## Abstractions introduced

- `register<Group>Tools(server, deps)` (21 functions) — users: `index.ts`, one call each, in the old order; axis: the
  tool groups that slices add to (the commerce track edits `orders-customers.ts`), functions not polymorphism (no
  interface: the registration operation is fixed and each group is called once); rejected: (a) a `context.ts` module
  with side-effect imports (§ *Shared state*).
- `tool-helpers.ts` module — users: 11 group files (`apiError` 10, `parseJsonInput` 5, `PENDING_MARKER_ATTEMPT` 3,
  `PAGE_REVALIDATION_ATTEMPT` 1); axis: none — a location for pure code that more than one group uses;
  rejected: leave them in `index.ts` (a group would import `index.ts`: a cycle, and the server would start on import).
- `block-schemas.ts` — required by ruling 1; user: `tools/content.ts` (`get_block_schemas`).

## Docs corrected (ruling 8)

Forward-looking pointers to `index.ts`, found with `git grep -n -i "mcp-server/src\|mcp.*index\.ts\|index\.ts.*mcp"`
and `git grep -n -i "server\.tool(\|BLOCK_SCHEMAS"` over the repository without `docs/shipped/` (a text search: a
pointer worded differently would not be found):

- `tools/mcp-server/ARCHITECTURE.md` — the file map, the rule "a new tool goes in its group file; `index.ts` holds
  the start only", the shared-state rules, the tool-table preamble, the drift-oracle text and its known limit.
- `docs/block-types.md:228` — where `BLOCK_SCHEMAS` and the `add_block` type list live.
- `docs/TECH-DEBT.md:254` — the tool that calls `GET /resources/{id}/download` (`resource_download_url`, by file).
- `docs/architecture-deep -dive.md:850` — the MCP box of the diagram.
- `docs/plan-self-hosted-saas.md:581` — where the tool schemas are.
- `docs/plan-youtube-vimeo-embed.md:434` (iteration 1) — the Definition-of-Done entry "synced if it exposes video
  block schemas" now names `src/block-schemas.ts` and `src/tools/content.ts`. Its dated observations (`:382`, the
  "verified `OBSERVED` 2026-07-28" row; `:388-389`) stay as records.

Not edited:
- `packages/plugins/PLUGIN-DEVELOPMENT-GUIDE.md:220-224` says "File: `tools/mcp-server/src/index.ts` — add your block
  to `BLOCK_SCHEMAS`". Forward-looking and now wrong, but outside the paths this slice may edit (ruling 9). F-RMCP1-5.
- The root `CLAUDE.md` and `AGENTS.md` name no file for adding a tool (they say "check that the MCP server reflects
  the changes"); no edit needed.
- `docs/plan-ai-admin.md:26,536` describe a planned target state of the MCP server, not where tools are added today.
- Closed slice records (`docs/slices/*.md` of shipped slices, `lang-1.md` included: `lang-1a`…`1d` shipped) keep
  their `index.ts:<line>` citations as evidence of their time.

## Findings, not fixed

- **F-RMCP1-1 (oracle, pre-existing).** `scripts/route-coverage.ts` binds an identifier argument of `axios.<m>(` to
  the nearest earlier `const <id> =` in the text, even in another tool. `scrape_url` calls `axios.get(url, …)` with its
  own input (an external page); the oracle counted it as the two `GET /comments` URLs of `list_comments` (original
  line 2156 → 1965) and now counts it as the two `GET /reviews` URLs of `list_reviews` (`signals.ts:39` →
  `reviews.ts:18`), because the joined text is sorted by path. It changes no PASS/FAIL and no printed line today, but a
  real `url` identifier in a new tool could be bound to a stale neighbour. Fix proposal (a later slice): bind only to a
  declaration inside the same `server.tool(` call, and count an unbound identifier as "not an API call". Documented
  in `ARCHITECTURE.md` § *Drift oracle*.
- **F-RMCP1-2 (pre-existing, known).** `get_delivery_config` / `update_delivery_config` call `GET /delivery` and
  `PUT /delivery`; the live routes are `/delivery/config` (`knownBroken`, commerce track).
- **F-RMCP1-3 (text, pre-existing).** `get_schema` TIPS says "Currency is set per-tenant in settings (default RON)";
  the shared schemas default `currency` to `"USD"` (`packages/shared/src/content.ts:43`, `products.ts:93`). Its
  "CURRENT PLUGINS (18 + 2 builtins)" and the comment "Synced with packages/plugins — 18 custom blocks + 2 Tiptap
  builtins" over `BLOCK_SCHEMAS` count 20, but `BLOCK_SCHEMAS` has 23 entries (`categoryGrid`, `form`, `gallery` are not
  counted). `ARCHITECTURE.md` § *Block Types Supported* says 20 as well.
- **F-RMCP1-4 (comment made stale by the move).** `index.ts:34-35`: "every call below appends "/<path>" to API_URL" —
  the calls are now in `src/tools/*.ts`, not below. A move may not change the comment; proposal: "every tool call
  appends …".
- **F-RMCP1-5 (doc, protected path).** `packages/plugins/PLUGIN-DEVELOPMENT-GUIDE.md:220-224` points a plugin author at
  `index.ts` for `BLOCK_SCHEMAS`; it is now in `tools/mcp-server/src/block-schemas.ts`. `tools/README.md` lists 28
  tools with names that do not exist (`list_pages`, `get_page`, `brave_search`, …) and SDK `^1.24.3`; pre-existing.
  Both are outside the paths of this slice.
- **F-RMCP1-7 (comments made stale by the move, protected source).** `src/tool-shapes.ts` (ruling 7: not edited):
  the header `:4-7` says the handlers are "in `index.ts`" and gives as the reason that `index.ts` cannot be loaded by
  a test — the handlers are now in `src/tools/*.ts`, which start nothing on import; `:47` (`createCategoryBody`)
  says "`parseJsonInput` in `index.ts`" — it is in `tool-helpers.ts`; `:181` says `BLOCK_SCHEMAS` is "in `index.ts`" —
  it is in `block-schemas.ts`; `:215` "Here, not in `index.ts`" names the old place of the form tools
  (`tools/forms-popups.ts`). Proposal for a later slice: point each comment at the new file.
- **F-RMCP1-6 (seam, not used).** A group file can now be imported by a test with a stub server; the comment in
  `ARCHITECTURE.md` says so. No test uses it (non-scope).

## Deviations

- **Test titles.** Ruling 5 says "change only the PATH each source check reads". The two titles said "registered in
  index.ts" and "(source check: index.ts starts the server on import)", which is false after the move; they now name the
  file they read. A local name, referenced nowhere else (`git grep` of both titles outside the test: no hit). The
  assertions are unchanged.
- **Route-coverage messages.** `lineOf()` returns `src/<file>:<line>` (the joined text has no useful line numbers), and
  the count failure says `src/ registers N` instead of `src/index.ts registers N`. Only failure messages change; the
  normal output is identical (O2a).
- **File map vs ruling 1.** Forms and popups share a file; reports and bulk price are their own files (§ *File map*,
  forced by ruling 3).

## Build record

Builder `claude-opus-5-5`, 2026-11-27, on `00535d9`, uncommitted.

1. Spec with the file map and mechanism (b), before any move.
2. Baselines on the clean tree: O1 hash, route-coverage output, attributed calls, order, `npm test` (23/23).
3. Moves by a generator that copies lines from `git show 00535d9:tools/mcp-server/src/index.ts`, step 1 (helpers and
   block schemas) then one group per step; after each step `npm run typecheck` and O1 on a throwaway build: 22 steps, all
   exit 0 and the same hash. The first run of step 1 failed the typecheck (`block-schemas.ts` imported itself); the
   generator was corrected and the step rerun. Line counts of `index.ts` by step: 2,166 → 133 (130 after iteration 1).
4. Oracles 2 and 3, the mutation proofs, E-ENV, E-LIVE, E-TOP.
5. Docs, ROADMAP row, `CURRENT_SLICE.md`.
6. Gates (EXECUTED, exit status): `npm run build` 0; `npm run typecheck` 0; `cd tools/mcp-server && npm test` 0 (route
   coverage PASS, 23/23); `git diff --check` 0, and no trailing whitespace or missing final newline in the 24 new files.

The gate `npm run build` rewrote `tools/mcp-server/dist/` (the path Claude Desktop starts, set by `setup.ts`). A running
Claude Desktop picks the new build up at its next server start; O1 on that `dist/index.js` gives the same hash.

## Revision iteration 1 (review-0, 2026-11-27)

Builder `claude-opus-5-5`. Evidence in the slice trail (`build-progress.md` § *Iteration 1*, `steps-iter1.log`,
`*-iter1.*`).

**R1 — the standalone `ToolDeps` type was outside the packet's permitted text.** Class of defect: new text that the
packet does not permit, made to pass by widening the oracle's whitelist to admit it. Rule that closes the class: *no
declaration is new except the 21 wrapper functions, and oracle 3's whitelist holds only the packet's categories* —
import, the `export` keyword on a moved line, the wrapper line (its inline parameter type may name only `API_URL`,
`getHeaders`, `STORAGE_DIR` with their `index.ts` types), the wrapper's `}`, and the register call. So both new
declarations went, not only the one named: the `ToolDeps` type and the `const toolDeps` line. Each wrapper writes its
parameter type inline; each call in `index.ts` passes an object literal with the names that group uses. The generator
was rerun from the original for steps 0–22: every step typechecks, builds and gives the O1 hash `f3de35b4…`. The oracle
refuses the class: M8 (the type re-added) and M9 (a deps line re-added) make it FAIL.

**R2 — documentation ripple.** `docs/plan-youtube-vimeo-embed.md:434` corrected (§ *Docs corrected*). The stale location
comments in the unchanged `src/tool-shapes.ts` are recorded as F-RMCP1-7. The search for this rerun: `git grep -n
"mcp-server/src/index.ts\|index\.ts" -- docs/plan-*.md` and `grep -n "index" src/tool-shapes.ts` (text searches).

**Rerun after the change (EXECUTED):** O1 before (rebuilt from the original `index.ts` and the `HEAD` `tool-shapes.ts`
in a temporary directory) = after = `f3de35b4…`; O1b `f75a0fd4…` both; O2a output identical; O2b the same 86 calls as
iteration 0, the same distinct set as before; O2c M1–M7 detect; O3 and O3b PASS; E-ENV, E-LIVE identical; E-TOP as
stated; `tsc --noUnusedLocals` 0; the gates of § *Build record* step 6 rerun, all 0.

## Closeout (operator, 2026-11-27)

- Relay: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, two cycles; review-0 `revise` (R1: an added `ToolDeps`
  type and constant beyond the permitted wrapper text; R2: one forward-looking doc line), review-1 `approved`.
- Operator's rerun of oracle 1 (the tool list an MCP client receives): the tool server of the commit before this
  slice (`00535d9`), built by the operator in a separate git worktree, and the `dist/index.js` of the new tree, each
  started over stdio with a dummy key and an API address nobody listens on. Both answers: 80 tools, SHA-256
  `f3de35b421285df0f83896fba05e3ac87f21f4e2a033db95036e7dd4f2b4e07f`, byte-identical (`cmp`). The worktree is removed.
- Operator gates on the approved tree, each exit 0: build, typecheck, shared, plugins, renderer, serving,
  serving-bundle, admin unit, backend unit, infra, mcp (route coverage + 23 tests), `git diff --check`; no change
  under `backend`, `infra`, `packages`, `admin`, `renderer`, `scripts`, `tests`, a manifest or a lockfile.
- No deployment: this package runs on the operator's machine as a local tool server. A client that is running
  keeps the old code until its server process is started again from a new build (`npm run build`).
- Reviewer's non-blocking note, not corrected (the script is slice-trail evidence, not repository code): the
  supplemental script `oracle3b-exact-blocks.mjs` omitted the last line of the helper block from its comparison; the
  reviewer compared all 43 helper lines by hand and the mandatory oracle 3 covers that line.
