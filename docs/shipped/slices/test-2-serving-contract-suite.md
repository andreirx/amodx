# TEST-2: Serving-contract characterization suite (renderer)

- **Status:** SHIPPED 2026-07-28 — deployed to production by the human, verified live (staging probe suite + prod probes: bijup.com s-maxage/Hit/age, session bypass, nf no-loop)
- **Track:** TEST
- **Depends:** test-1 (CI exists to run it); cache-1/2/3 committed (the contract)
- **Source:** `docs/testing-strategy.md` §2; `docs/caching-architecture.md`
  §Measured serving behaviour + §Serving contract
- **Maturity target:** MATURE

## Purpose / risk retired

The serving contract exists only as prose + one-off probe transcripts. Any future
renderer change can silently regress it (dynamic-API leak, cacheable 404, Set-Cookie on
cacheable HTML, nf-loop). This slice makes the contract executable: a committed suite
that fails when the measured behavior drifts.

## Scope

`renderer/test/serving-contract/` + `npm run test:serving` (renderer workspace):

1. Harness: build once (`next build`), start `next start` on an ephemeral port with a
   LOCAL DynamoDB stub (in-process HTTP stub serving fixture tenants/pages — no real
   AWS, no credentials; the cache-1 relay byproduct harness is prior art and may be
   adapted — it is NOT committed anywhere, reimplement/import deliberately).
2. Assertions (each = one measured row; cite the doc section it pins):
   a. published page: MISS then HIT, `s-maxage`, zero stub reads on HIT, no Set-Cookie
   b. `?page=2` / session-cookie request: `private, no-cache, no-store`
   c. unknown host: 404 + no-store, no render
   d. known tenant missing page: 307→`?nf=1`→404 no-store; the `?nf=1` request never
      loops
   e. read failure AFTER tenant resolution (stub throws): 500, NO Cache-Control,
      nothing cached; next healthy request caches
   f. `?preview=true`: no-store, renders
   g. `/api/*` responses never cacheable
3. Runtime budget: suite < ~3 min (one build, one server, sequential curls).
4. CI: separate job or same workflow after unit gates (still credential-free).
5. `docs/testing-strategy.md` + `docs/caching-architecture.md` note: the suite is the
   executable form of the contract; changes to serving behavior must update both.

## Non-scope

- No CloudFront/warm-edge probes (post-deploy runbook, operator).
- No OpenNext-Lambda-bundle harness (valuable; separate slice if wanted).
- No playwright changes (stale 404 spec is test-5 scope or ride-along ONLY if the fix
  is a direct consequence of asserting the new contract — record the decision).

## Definition of Done

1. Suite exists, credential-free, green from bare checkout, < ~3 min.
2. Each assertion maps to a documented measured behavior (comment references).
3. Mutation check: reintroducing a dynamic-API call on the ISR route (temporary local
   edit, reverted) makes the suite FAIL — proven in the build report.
4. CI runs it.

## Evidence

- `EXECUTED`: suite run transcript (all assertions, timing).
- `EXECUTED`: the mutation check (fail demonstrated, revert verified).
- `NOT RUN` (operator): CI run on push.

---

## Build run — 2026-07-28

### What was built

| Path | Role |
|---|---|
| `renderer/test/serving-contract/fixtures.mjs` | DynamoDB items in the shapes `lib/dynamo.ts` reads back. Hosts use the `.test` TLD (RFC 6761 §6.2 — permanently non-resolvable) |
| `renderer/test/serving-contract/ddb-stub.mjs` | DynamoDB JSON-1.0 responder; `stats()` / `reset()` / `failContentReads()` as plain methods (stub and assertions share a process, so the cache-1 harness's HTTP `/__ctl/` plane is not re-created) |
| `renderer/test/serving-contract/harness.mjs` | `next build` / `next start` on an ephemeral port / `node:http` request helper; owns the constructed child environment (`rendererEnv()`) |
| `renderer/test/serving-contract/no-dotenv.cjs` | **rev 1**, redelivered **rev 2** — preload that hides `renderer/.env*` from every process in the child tree, and journals which processes it covered |
| `renderer/test/serving-contract/contract.test.mjs` | 16 assertions, one per contract row, + 4 harness isolation self-checks |
| `renderer/test/serving-contract/README.md` | design rationale, deliberate limits |
| `renderer/package.json` | `"test:serving"` script — **the only change outside `test/` and docs** |
| `.github/workflows/ci.yml` | new job `serving-contract`, credential-free |

No renderer/infra/backend source and no playwright spec was modified. `git diff` over
`renderer/src`, `renderer/middleware.ts`, `infra`, `backend`, `admin`, `packages` is empty.

### Runner: `node:test`, not vitest (builder decision, recorded)

Zero new dependencies, zero lockfile churn. The suite makes HTTP requests and reads
response headers — nothing to mock, no DOM, no TypeScript to transform (the files are
`.mjs`, so `tsc --noEmit` and `next build` ignore them). The repo-specific reason not to
add vitest: `test-1` had to hand-repair `package-lock.json` because npm records only the
native-binary platform variants that resolved on the authoring host, and vitest pulls in
exactly that family (`docs/TECH-DEBT.md`). A suite whose contract is "green from a bare
checkout" should not import that risk for a feature it does not use. `test-3` may still add
vitest to `renderer` for pure unit tests; the two coexist and porting this file is
mechanical. Rationale kept in `renderer/test/serving-contract/README.md`.

### DoD 1 — suite green from a clean build — `EXECUTED`

`cd renderer && npm run test:serving` — **20/20 pass, 9.8 s wall, exit 0** (budget ~3 min):
16 contract rows + 4 isolation self-checks (2 added in revision 1, 2 in revision 2).
The stub reports `unhandled: []` (every read it received was one it understood) and a run
against a real table would find no fixture tenant and go red.

### Revision 1 — harness isolation (review-0 finding 1) — `EXECUTED`

**The defect.** `rendererEnv()` returned `{ ...process.env, … }`, so both children inherited
the operator's shell; and Next loads `.env*` unconditionally, so `renderer/.env.local` was
merged on top. The slice's hard constraint is "no `.env*` reads". The overrides the harness
set did mask the *variables under test* — the original build report's claim was true as far as
it went — but that is not the same property. **MEASURED 2026-07-28** by running Next's own
`@next/env#loadEnvConfig` under the pre-fix conditions: five keys entered the child that the
harness never set, including the operator's real **`AMODX_API_KEY`** and `API_URL`.

**The fix**, two independent mechanisms, both in the child's spawn:

1. `rendererEnv()` now *constructs* the environment. Four OS variables cross over
   (`PATH`, `HOME`, `TMPDIR`, `CI`); everything else is a literal in `harness.mjs`.
   `next` is invoked as `node <resolved next bin>`, not `npx`, which is what makes a
   four-entry environment and a `--require` preload possible.
2. `no-dotenv.cjs`, preloaded with `--require`, makes `<renderer>/.env*` throw `ENOENT` from
   `fs.statSync`/`readFileSync`, so `loadEnvConfig` takes the branch it already takes on a
   checkout without the file. Nothing on disk is touched. `__NEXT_PROCESSED_ENV=true` is set
   alongside it: it stops `@next/env`'s merge loop regardless of how the file was read.
   Both mechanisms are read out of `@next/env@16.2.12`'s actual source, quoted in
   `no-dotenv.cjs`.

**Proof, and that each mechanism is load-bearing** — the probe re-run with each removed:

| fs preload | `__NEXT_PROCESSED_ENV` | `loadedEnvFiles` | keys injected |
|---|---|---|---|
| ✅ | ✅ | `[]` | 0 — *what the suite runs* |
| ❌ | ✅ | `[".env.local"]` | 0 |
| ✅ | ❌ | `[]` | 0 |
| ❌ | ❌ | `[".env.local"]` | 5, incl. `AMODX_API_KEY` |

The preload stops the *read*; the guard stops the *merge*. Assertion `(iso2)` runs the top row
on every suite execution, against `@next/env#loadEnvConfig` itself, so a future Next upgrade
that changes the loading mechanism fails the suite rather than silently re-admitting the file.
`(iso1)` asserts `rendererEnv()`'s key set against a whitelist — it goes red the moment a
`...process.env` spread returns.

**Confirmed on the real child, not a stand-in** — `EXECUTED`. `(iso2)` probes an equivalent
process, so the live `next start` child was also read directly. `ps -E` cannot see it (Next
overwrites `process.title`, which on macOS is the region `ps` reads), so a read-only observer
was added as a *second* `--require` to an otherwise byte-identical spawn and dumped
`process.env` four seconds after boot:

```
23 keys: AWS_ACCESS_KEY_ID AWS_ENDPOINT_URL_DYNAMODB AWS_REGION AWS_SECRET_ACCESS_KEY HOME
NEXTAUTH_SECRET NEXT_DEPLOYMENT_ID NEXT_PRIVATE_START_TIME NEXT_PUBLIC_API_URL NEXT_RUNTIME
NEXT_TELEMETRY_DISABLED NODE_ENV ORIGIN_VERIFY_SECRET PATH PORT RECAPTCHA_SITE_KEY
RUST_MIN_STACK TABLE_NAME TMPDIR TURBOPACK __CF_USER_TEXT_ENCODING __NEXT_PRIVATE_ORIGIN
__NEXT_PROCESSED_ENV
```

Every key is one the harness pins, one Next sets on itself (`NEXT_*`, `NODE_ENV`, `PORT`,
`RUST_MIN_STACK`, `TURBOPACK`), or one macOS libc injects (`__CF_USER_TEXT_ENCODING`).
No `AMODX_API_KEY`, no `API_URL`, no `SHELL`/`USER`/`npm_config_*`. The observer was a
throwaway outside the repo and is not committed.

`NEXT_TELEMETRY_DISABLED=1` was added in the same pass: a gate that claims to be hermetic
should not make an outbound request during its build either.

The 16 contract rows measured **identically** before and after this change, which is the
expected result — the pre-fix leak added variables the renderer's tested paths do not consult.

### Revision 1 — doc correction (review-0 finding 2) — `OBSERVED`

`docs/caching-architecture.md` claimed the suite's stub carried "the same
`/__ctl/fail-content-on` control plane" as the `cache-1` probe harness. It does not: the same
*fault injection* exists, as an in-process method (`failContentReads(true)`). The sentence was
rewritten to say that, and to explain why the HTTP plane has no caller here. The
`ddb-stub.mjs` header and this slice doc were already correct; only that one paragraph was
wrong.

### Revision 2 — isolation covers the whole process tree, and the coverage is measured (review-1 finding 1) — `EXECUTED`

**The finding.** Revision 1 delivered the `.env*` hook as an argv `--require` to the top-level
`next` process only, and `no-dotenv.cjs` itself admitted a worker spawned with an explicit
`execArgv` might not inherit it. The reviewer also correctly identified that
`__NEXT_PROCESSED_ENV=true` is not a fallback for that case: in `@next/env@16.2.12`,
`loadEnvConfig`'s `statSync`/`readFileSync` loop runs *before* `processEnv()`, so the guard
stops the merge but not the read. The hard constraint is "no `.env*` reads".

**It is a real hole.** `next build` is a process tree: `next/dist/export/index.js` and
`next/dist/server/config.js` call `loadEnvConfig` in the workers, and
`next/dist/lib/worker.js:98-107` hands jest-worker an explicit `forkOptions.execArgv`.
`fork()` inherits `process.execArgv` only when the caller supplies none, so argv flags stop
there. MEASURED 2026-07-28, outside Next, on `node v22.21.1`:

| delivery | `fork(child, {execArgv: []})` | `new Worker(child, {execArgv: []})` |
|---|---|---|
| `node --require pre.cjs parent.js` | **not preloaded** | — |
| `NODE_OPTIONS='--require "pre.cjs"'` | preloaded | preloaded |

**The fix.** `rendererEnv()` now carries `NODE_OPTIONS=--require "<no-dotenv.cjs>"`, and the
argv `--require` is *removed* rather than kept alongside — keeping it would have hidden, from
the next reader, which delivery path is the one that propagates. Quoting matters: this
checkout's path contains a space, and Next re-quotes the value as `--require="<path>"` when it
rebuilds each worker's `NODE_OPTIONS`; both forms verified against `node` directly.

**The proof — two new assertions, and the coverage is measured rather than argued.**

`no-dotenv.cjs` now appends one JSONL record per process it loads into, and one per `.env*`
access it refuses, to a journal in `$TMPDIR` (`$AMODX_DOTENV_AUDIT`, deleted in `after()`).

- **`(iso3)` the real trees.** Reads the journal as it stood the instant `next start` became
  ready — i.e. exactly the `next build` + `next start` trees. Asserts the build process, **at
  least one process the build spawned** (`ppid === build.pid`), and the live server are all
  covered; that `.env*` accesses were actually intercepted (so the path was exercised, not
  merely quiet); and that the intercepted names are `@next/env`'s four production candidates.
  It additionally asserts something that needs no cooperation from the harness at all: `next
  build` reports the env files it loaded *itself*, as `- Environments: <files>`, printed only
  when the list is non-empty (`next/dist/server/lib/app-info-log.js:104` fed by
  `next/dist/build/index.js:582`). **MEASURED: 14 processes covered, 12 accesses blocked.**
- **`(iso4)` the escape route, pinned directly.** `loadEnvConfig` run one hop deeper, in a
  process launched with its own argument vector — the shape that drops an argv `--require` —
  must still load nothing. Paired with a **positive control**: the identical probe pointed at
  a throwaway directory holding a decoy `.env.local` must report `loadedEnvFiles:
  [".env.local"]`, otherwise an empty result would prove only that the field stopped being
  populated. (The decoy's keys still do not enter `process.env` — `__NEXT_PROCESSED_ENV`
  doing its half, observed live.)

**All three signals are demonstrably live** — the same real build re-run with the delivery
varied (2026-07-28, throwaway script, deleted; `.next` rebuilt each row):

| delivery | processes covered | accesses blocked | build printed `- Environments:` |
|---|---|---|---|
| `NODE_OPTIONS` — *what the suite runs* | 13 | 8 | no |
| argv `--require` (revision 1) | 13 | 8 | no |
| no hook at all | **0** | **0** | **yes** |

**Reported straight, not spun:** the middle row means revision 1 was *not actually leaking* on
`next@16.2.12`. Next rebuilds each worker's `NODE_OPTIONS` from
`[...process.execArgv, ...NODE_OPTIONS]` (`server/lib/utils.js#getParsedNodeOptions`), which
re-exported the argv flag by accident. So the review's finding was precisely right as stated —
"the suite neither guarantees nor proves that" — and the correction is that the suite now does
neither by luck: it does not depend on that internal, and `(iso3)`/`(iso4)` fail if the
property stops holding. The contract rows measured identically before and after, as expected.

**Residual limit, stated rather than papered over:** the journal can only see a process the
hook loaded into. A Node process inheriting neither our environment nor our flags would be
invisible to `(iso3)`(b) — which is why `(iso3)`(a), Next's own `- Environments:` report, is
asserted next to it. Closing the gap absolutely would need an OS syscall trace
(`dtrace`/`strace`): privileges CI does not have, and a non-portable gate. Not built; recorded
in the suite README § *Deliberate limits*.

### DoD 2 — every assertion maps to a documented row — `OBSERVED`

Each test is named `(row)` and cites its section in a comment. Map in
`renderer/test/serving-contract/README.md` § *What it asserts*.

### DoD 3 — mutation check — `EXECUTED` (re-run on the revision-2 code)

Temporary local edit to `renderer/src/app/[siteId]/[[...slug]]/page.tsx`: `import { headers }
from "next/headers"` + `void (await headers()).get("user-agent")` in the page body — i.e.
exactly the "dynamic API on a route in ISR mode" the contract forbids.

Result: **13 pass / 7 fail, process exit code 1.** The seven reds are the seven contract rows
that depend on the ISR route rendering: `(a1)` `(a2)` `(b3)` `(d1)` `(d3)` `(e1)` `(e2)`.
`(a1)` reported `500 !== 200` — the documented ISR-mode behaviour, not a graceful bail-out.
The missing-page 307 became a 500, the anonymous-cookie row lost its `s-maxage`, and `(e1)`
failed on its *positive control*: with the route 500-ing, nothing at all reaches the ISR
cache, which is precisely what that control exists to detect.

`(iso1)`–`(iso4)` stayed green, correctly — they pin the harness, not the renderer, and a
source mutation must not perturb them.

Revert: `git checkout -- 'renderer/src/app/[siteId]/[[...slug]]/page.tsx'`, then
`git diff --stat -- renderer/src renderer/middleware.ts renderer/next.config.ts infra backend
admin packages tests tools` → **empty**, and `grep -rn "MUTATION CHECK"` over those trees →
no hits. Re-run after revert: **20/20, exit 0, 9.2 s.**

### DoD 4 — CI — `EXECUTED` (config) / `NOT RUN` (the push)

`.github/workflows/ci.yml` job `serving-contract`: checkout → Node 22 → `npm ci` → build
`packages/shared` + `effects` + `plugins` → `npm run test:serving`. It references no
`secrets.*` and sets no `env:`, matching `test-1`'s credential-free contract. The workflow
has not been pushed, so no GitHub run exists — `NOT RUN`, operator.

### Regression finding: `next` 16.2.9 → 16.2.12 introduced NO contract drift

The suite's first run doubles as the regression check `sec-1`'s bump never got. Measured
2026-07-28 on `next@16.2.12`, every row identical to the 16.2.9 table in
`docs/caching-architecture.md`:

| Request | Status | `Cache-Control` | `x-nextjs-cache` |
|---|---|---|---|
| `/published` 1st / 2nd | 200 | `s-maxage=31536000` | MISS → HIT |
| `?page=2`, `?preview=true`, session cookie | 200 | `private, no-cache, no-store, max-age=0, must-revalidate` | absent |
| `/no-such-page` | 307 → `/no-such-page?nf=1` | `s-maxage=31536000` | MISS |
| `/no-such-page?nf=1` | 404 | `private, no-cache, no-store, …` | absent |
| unknown host | 404 | `private, no-store` | absent |
| post-tenant read failure | 500 | **header absent** | absent |
| `/api/posts` (200 and 400), | — | **header absent** | absent |
| `/api/ref` POST | 204 | `no-store` (+ `Set-Cookie: amodx_ref`) | absent |
| `RSC: 1` on `/published` | 200 | `s-maxage=31536000`, `content-type: text/x-component` | HIT |

Stored artefacts on disk (`.next/server/app/<host>/<path>.meta`) confirm the storage half:
`no-such-page.meta` holds `{"status":307,"location":"/no-such-page?nf=1"}`, there is **no
404 entry at all**, and the failed render (`d4-page`) wrote **nothing**.

This is *contract preservation*, not a suite bug: the same suite is demonstrably capable of
failing (DoD 3) and its absence checks are demonstrably wired to a live detector (positive
controls).

### Not built — surfaced, not silently added

Two rows were measured during the build run but are outside the ratified assertion list
(`Scope` 2 a–g). Recommended as a one-line follow-up if the reviewer wants them:

- **`/_dyn/<path>` arriving from the wire** → measured `404` + `private, no-store`, matching
  § *Serving contract* ("no second public URL serving the same tenant content uncached").
  This is a cache-**bypass** surface, so pinning it has real value.
- **`RSC: 1` flips the body to `text/x-component`** → measured, unchanged. It is the origin
  premise the whole H1 fix rests on. Slice `Non-scope` excludes *CloudFront* probes; this
  particular row is an origin measurement, so it is arguably in scope — recorded here rather
  than assumed.
