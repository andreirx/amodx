# Serving-contract characterization suite

Slice `test-2`. The **executable form** of `docs/caching-architecture.md` § *Serving
contract*. It pins the behaviour that slices `cache-1`/`cache-2`/`cache-3` measured with
one-off probes, so a later renderer change that regresses it fails a build instead of
shipping.

```bash
cd renderer && npm run test:serving
```

Requires only a built `packages/shared`, `packages/effects` and `packages/plugins` (the
renderer imports their `dist/`). It builds the renderer itself.

## What it asserts

Each test is named `(row)` after the contract row it pins and cites the document section in
a comment. Failing test = **contract change**, not a flaky test.

| Test | Pins |
|---|---|
| `a1` `a2` `a3` | published page: `s-maxage=31536000`, MISS → HIT, **zero** DynamoDB reads on HIT, no `Set-Cookie` on cacheable HTML |
| `b1` `b2` `b3` | query string **or** any ratified session-cookie shape → the `force-dynamic` twin (`no-store`); non-session cookies stay on the cacheable route (prefix match, not substring) |
| `c` | unknown host → middleware `404` + `private, no-store`, **no render** |
| `d1` `d2` `d3` | missing page → cacheable `307` → `?nf=1` → non-cacheable `404`; the `?nf=1` request never loops; the stored artefact is the 307 and **no 404 is ever stored** |
| `e1` `e2` | read failing *after* tenant resolution → `500` with **no** `Cache-Control` and no ISR entry; the same path caches normally once reads recover (human decision `CACHE-1-D4`) |
| `f` | `?preview=true` → renders, `no-store` |
| `g1` `g2` `g3` | `/api/*` never advertises a storable lifetime; `/api/posts` answers `400`/`500` rather than an empty `200`; the referral `Set-Cookie` lives on an uncacheable `/api` response |
| `iso1`…`iso4` | **not contract rows** — the suite's own isolation, which every row above depends on for its meaning. See *Credential-free* below |

Every *absence* assertion (`no 404 stored`, `no entry for the failed render`) is paired with
a **positive control** using the same detector, so a silently-broken detector fails the suite
instead of passing it. Same reason the `ddb-stub` reports `unhandled` reads and the suite
asserts that list is empty: a stub that invented absence would be the very defect
`CACHE-1-D4` removed from `lib/dynamo.ts`.

## How it runs

`next build` → `next start` on an ephemeral port → sequential HTTP requests, with
`AWS_ENDPOINT_URL_DYNAMODB` pointed at an in-process stub. This is the recipe documented in
`docs/caching-architecture.md` § *Measured serving behaviour*, committed.

- **`fixtures.mjs`** — the DynamoDB items, in the shapes `lib/dynamo.ts` reads back. Hosts
  use the `.test` TLD (RFC 6761 §6.2: permanently non-resolvable).
- **`ddb-stub.mjs`** — DynamoDB JSON-1.0 responder. Not an emulator: it implements exactly
  the read shapes the renderer emits and answers anything else with a loud error. Control is
  by plain methods on the returned handle — `stats()`, `reset()`, `failContentReads(bool)` —
  because the stub and the assertions share one process. (The `cache-1` probe harness used an
  HTTP `/__ctl/…` plane only because its probes were separate shell scripts.)
- **`harness.mjs`** — build/serve/HTTP helpers, and the constructed child environment.
- **`no-dotenv.cjs`** — the preload that hides `renderer/.env*` from the children, plus the
  journal the isolation assertions read back.
- **`contract.test.mjs`** — the assertions.

`.next` is deleted before the build. `next start` persists on-demand ISR entries under
`.next/server/app/<host>/<path>.{html,meta,rsc}`, and a leftover entry would answer the
suite's first request `HIT` — silently voiding the MISS→HIT row.

### Credential-free

The child processes get a **constructed** environment, not an inherited one. `rendererEnv()`
in `harness.mjs` is the complete list of what `next build` / `next start` can see.

1. **No `...process.env`.** Exactly four OS variables cross over — `PATH`, `HOME`, `TMPDIR`,
   `CI`. An ambient `AWS_PROFILE`, `AMODX_API_KEY` or CI secret cannot reach the renderer, so
   the suite cannot exercise a credentialed path and pass for the wrong reason. Assertion
   `iso1` fails if an unlisted name appears — i.e. if the spread ever comes back.
2. **`renderer/.env*` is invisible to the children**, two independent ways:
   - `no-dotenv.cjs` makes those paths throw `ENOENT` from `fs.statSync`/`readFileSync`.
     `@next/env`'s loader then takes the branch it already takes on a checkout without the
     file — the only branch CI ever sees. Nothing on disk is touched. The predicate is
     narrow: direct children of `renderer/` whose basename starts with `.env`, nothing else.
   - `__NEXT_PROCESSED_ENV=true` makes `@next/env`'s own `processEnv()` return before its
     merge loop, independently of how the file was read. On its own this is **not** enough
     for the slice's constraint: `loadEnvConfig`'s `statSync`/`readFileSync` loop runs
     *before* `processEnv()`, so the guard stops the merge but not the read.
3. `AWS_ENDPOINT_URL_DYNAMODB` addresses `127.0.0.1`, so no SDK call can leave the host.
   `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are fixed literals: the SDK needs *some*
   credentials to sign, and the stub ignores signatures.
4. `NEXT_TELEMETRY_DISABLED=1` — the build makes no outbound request either.
5. `next` is run as `node <resolved next bin>`, not through `npx`: a plain Node child is what
   makes a four-entry environment sufficient, and `npx` would reach the network on a cache
   miss.

#### How the hook reaches the whole process tree

`next build` is not one process. It forks build/export workers, and those workers call
`loadEnvConfig` themselves (`next/dist/export/index.js`, `next/dist/server/config.js`). So the
hook has to be delivered by a channel every one of them inherits.

It is delivered in **`NODE_OPTIONS`**, not as an argv `--require`. `fork()` inherits the
parent's `process.execArgv` only when the caller does not supply its own — and jest-worker
always does (`next/dist/lib/worker.js:98-107`), so argv flags are dropped at that hop while
the environment is always inherited. MEASURED outside Next:

| delivery | `fork(child, {execArgv: []})` | `new Worker(child, {execArgv: []})` |
|---|---|---|
| `node --require pre.cjs parent.js` | **not** preloaded | — |
| `NODE_OPTIONS='--require "pre.cjs"'` | preloaded | preloaded |

`iso3` turns that from an argument into a measurement. `no-dotenv.cjs` appends one record per
process it loads into, and one per `.env*` access it refuses, to a journal in `$TMPDIR`;
`iso3` reads the journal back after the real build and boot and asserts the build process,
**at least one process the build spawned**, and the live server are all in it. MEASURED
2026-07-28 on this repo: **14 processes covered, 12 accesses blocked.**

`iso3` also asserts something that does not depend on our journal or our hook at all: `next
build` reports the env files it loaded, itself, as `- Environments: <files>` — printed only
when the list is non-empty (`next/dist/server/lib/app-info-log.js:104`, fed by
`next/dist/build/index.js`). Its absence is the build's own first-party statement.

Both signals are demonstrably live. Re-running the same real build with the hook removed
entirely (2026-07-28, throwaway script, not committed):

| delivery | processes covered | accesses blocked | build printed `- Environments:` |
|---|---|---|---|
| `NODE_OPTIONS` — *what the suite runs* | 13 | 8 | no |
| argv `--require` (revision 1) | 13 | 8 | no |
| no hook | **0** | **0** | **yes** |

The middle row is worth stating plainly rather than quietly dropping: on `next@16.2.12`
revision 1's argv delivery *did* in fact reach the workers, because Next rebuilds each
worker's `NODE_OPTIONS` from `[...process.execArgv, ...NODE_OPTIONS]`
(`server/lib/utils.js#getParsedNodeOptions`). It was correct by accident, through an
undocumented internal of a dependency that `sec-1` has already bumped once. Revision 2 does
not rely on it, and `iso3`/`iso4` fail if the property stops holding.

`iso4` pins the transitive half directly: `@next/env#loadEnvConfig` run one hop deeper, in a
process launched with its own argument vector, must still load nothing. Its **positive
control** points the identical probe at a throwaway directory holding a decoy `.env.local`
and requires `loadedEnvFiles` to fill — otherwise an empty result could just mean the field
stopped being populated. (The decoy's keys still do not reach `process.env`: that is
`__NEXT_PROCESSED_ENV` doing its half, observed live.)

`iso2` remains the narrow version of the same check — `loadEnvConfig` under the suite's exact
environment, one hop. **MEASURED 2026-07-28**, each mechanism removed in turn against the
operator's real `.env.local`:

| `fs` hook | guard | `loadedEnvFiles` | keys injected |
|---|---|---|---|
| ✅ | ✅ | `[]` | 0 — *what the suite runs* |
| ❌ | ✅ | `[".env.local"]` | 0 |
| ✅ | ❌ | `[]` | 0 |
| ❌ | ❌ | `[".env.local"]` | 5, incl. `AMODX_API_KEY` |

Both are load-bearing and they fail differently: the hook stops the *read*, the guard stops
the *merge*. The last row is what this suite did before revision 1.

The suite is additionally self-evidencing: a renderer talking to a real table would find no
fixture tenant and every assertion would go red.

## Why `node:test`

No test framework is installed for this suite, and none is needed: it makes HTTP requests
and reads response headers. There is no module to mock, no DOM, and no TypeScript to
transform (the files are `.mjs`, so `npm run typecheck` and `next build` ignore them).

The reason it is not vitest is the repo's own history. `test-1` had to hand-repair
`package-lock.json` because npm records only the platform variants of native binaries that
resolved on the authoring host, and CI's `npm ci` then failed on Linux
(`docs/TECH-DEBT.md`). Vitest pulls in exactly that family (rollup, esbuild). A suite whose
job is to be green from a bare checkout should not add that risk for a feature it does not
use. `test-3` may still add vitest to `renderer` for pure unit tests — that is orthogonal;
the two can coexist, and porting this file if it ever becomes worthwhile is mechanical.

## Deliberate limits

- **Origin only.** No CloudFront, no warm-edge probes — slice non-scope. The cache-key half
  of `H1` (`RSC` header) and `H3` (`x-has-session`) lives in
  `infra/lib/renderer-hosting.ts` and belongs to `cdk synth` assertions (slice `test-4`) and
  to the operator's post-deploy runbook.
- **`next start`, not the OpenNext Lambda bundle.** `cache-1` re-measured every row through
  the built bundle and found them identical; a committed OpenNext harness is a separate
  slice (slice doc § Non-scope).
- **`ProjectionExpression` is ignored by the stub.** Returning extra attributes cannot change
  an assertion here, and honouring it would add a parser with no caller.
- **POSIX only.** `OS_PASSTHROUGH` carries no `SystemRoot`/`ComSpec`, so a Windows host would
  need one line added. macOS (operator) and `ubuntu-latest` (CI) are the demonstrated hosts;
  the entry was not added speculatively.
- **The journal sees a process only if the hook loaded in it.** A Node process that inherited
  neither our environment nor our flags would be invisible to `iso3`(b) — which is why
  `iso3`(a), the `- Environments:` reading, is asserted alongside it: that one comes from the
  build itself and needs no cooperation from us. Closing the gap completely would take an OS
  syscall trace (`dtrace`/`strace`), which needs privileges CI does not have and would make
  the gate non-portable. Not built.
- One build, one server, sequential requests. Measured wall time ≈ 9–10 s.
