# TEST-1: Fast gates — typecheck scripts + CI build/typecheck/unit

- **Status:** SHIPPED 2026-07-28 — deployed to production by the human, verified live (staging probe suite + prod probes: bijup.com s-maxage/Hit/age, session bypass, nf no-loop)
  is repaired **surgically**, `npm ci` retained) — review pending. Authoritative build run is
  § Build run 2026-07-27 revision 3. The earlier sections are retained for history only:
  revision 1 rows 7 and 9 are **superseded** by revision 3 rows S5/S7/S8; revision 2's
  clean-room regeneration was **rejected** and is fully superseded by revision 3, which also
  withdraws `DECISION_REQUIRED: TEST1-LOCKFILE-DRIFT` (there is no longer any drift to decide on).
- **Track:** TEST
- **Depends:** none
- **Source:** `docs/testing-strategy.md` §7; estate audit 2026-07-27
- **Maturity target:** MATURE

## Purpose / risk retired

No workspace has a `typecheck` script; CI has no build job — a type regression ships
silently, and every verification loop pays the full build chain. This slice creates the
fast gate: `tsc --noEmit` per workspace, a root aggregate, and a CI workflow running
build + typecheck + the existing AWS-free unit tests on every push.

## Scope

1. `typecheck` script (`tsc --noEmit`, using each workspace's own tsconfig) in: shared,
   effects, plugins, backend, admin, renderer, infra, tools/mcp-server. Root
   `typecheck` runs them in dependency order (same order as root `build`).
   Note: admin/renderer builds embed extra steps (vite/next); `tsc --noEmit` must use
   the tsconfig that covers their sources without emitting.
2. `.github/workflows/ci.yml`: on push/PR — npm ci, root build, root typecheck,
   `backend npm run test:unit`. NO AWS credentials in this workflow; it must be green
   from a bare checkout.
3. Do NOT touch `playwright.yml` or `security-audit.yml`.
4. `docs/testing-strategy.md` estate table updated (CI row).

## Non-scope

- No new tests (test-2/3). No local-DDB work. No changes to any src/ code — if
  typecheck FINDS existing errors, fix only if trivial (<5 lines total); otherwise
  record them in the build report + TECH-DEBT entry and scope the script to pass via
  documented, minimal excludes ONLY with the finding recorded. Do not silently relax
  compiler options.

## Definition of Done

1. `npm run typecheck` green at root, running all 8 workspaces.
2. CI workflow present; steps mirror what a bare machine can run (no secrets).
3. Any discovered type errors: fixed (if trivial) or recorded honestly.

## Evidence

- `EXECUTED`: root `npm run typecheck` output (all workspaces listed, green).
- `EXECUTED`: `act`-style local verification is NOT required; instead paste the
  workflow file and the exact local command sequence it encodes, each run green.
- `NOT RUN` (operator): first real CI run on push.

## Build run 2026-07-27

### What was built

| File | Change |
|---|---|
| `package.json` | root `typecheck` — the 8 workspaces chained with `&&` in the same order as root `build` |
| `packages/shared`, `packages/effects`, `packages/plugins`, `backend`, `renderer`, `tools/mcp-server`, `infra` `/package.json` | `"typecheck": "tsc --noEmit"` |
| `admin/package.json` | `"typecheck": "tsc -b --noEmit --force"` — admin is a composite project (`tsconfig.json` has `files: []` + references to `tsconfig.app.json`/`tsconfig.node.json`), so plain `tsc` checks nothing. `--force` because build mode otherwise skips an up-to-date project via `node_modules/.tmp/*.tsbuildinfo` and reports a stale green |
| `.github/workflows/ci.yml` | new — checkout → node 22 → install → `npm run build` → `npm run typecheck` → `backend npm run test:unit` |
| `docs/testing-strategy.md` | estate table CI row + §7 status note |
| `TESTING.md` | §CI/CD was `(Future)` boilerplate prescribing `npm ci` + AWS secrets; replaced with the real 3-workflow inventory and the two editing rules |
| `docs/TECH-DEBT.md` | new entry: macOS-only lockfile blocks `npm ci` |

**Zero `src/` changes.** The trivial-fix budget (<5 lines) was not used: all 8 workspaces were
already type-clean. Compiler options were not touched and no excludes were added.

### Why build must precede typecheck

`tsc --noEmit` emits nothing, so it cannot satisfy its own prerequisites. `@amodx/shared`,
`@amodx/effects` and `@amodx/plugins` publish types from `dist/*.d.ts` (their `package.json`
`types`/`exports` fields), and `renderer/tsconfig.json` includes `.next/types/**`, which only
`next build` writes. Verified by removing `packages/shared/dist` and re-running the backend
typecheck — 100+ `TS2307 Cannot find module '@amodx/shared'`. `npm run typecheck` is therefore a
gate that assumes a prior `npm run build`, which is the order `ci.yml` uses.

### Why `npm ci` — and how the lockfile was repaired (revision 2)

Revision 1 shipped `rm -f package-lock.json && npm install`, copying `playwright.yml`. That was
**rejected**: it unpins CI. Decision `TEST1-LOCKFILE-POLICY` = repair the lockfile, keep `npm ci`.
Revision 2 does that. See § Build run 2026-07-27 revision 2 for the evidence.

### Anti-false-green control

`docs/testing-strategy.md` forbids a suite that asserts nothing. Each of the 8 `typecheck` scripts
was proved to *detect* a real error: a one-line file `export const __negctl: number = "…"` was
written into the workspace's include root, the script run, the file removed. All 8 exited **2** with
`TS2322`. The root aggregate was proved to propagate: with the error in `admin/src/`, `npm run
typecheck` exited **2** and short-circuited at admin.

### Evidence

| # | Claim | Label | Result |
|---|---|---|---|
| 1 | root `npm run typecheck`, dev tree | `EXECUTED` | exit 0; all 8 workspace banners present |
| 2 | 8 × per-workspace negative control | `EXECUTED` | 8/8 exit 2 with `TS2322` |
| 3 | root aggregate negative control (admin) | `EXECUTED` | exit 2, short-circuits at admin |
| 4 | build-before-typecheck dependency | `EXECUTED` | `packages/shared/dist` moved → backend typecheck exit 2, `TS2307`; restored |
| 5 | `ci.yml` parses | `EXECUTED` | `npx js-yaml .github/workflows/ci.yml` → OK |
| 6 | `ci.yml` is credential-free | `OBSERVED` | zero `secrets.*` outside one prose comment; zero `env:` blocks; zero `AWS_*` |
| 7 | Full CI step sequence in an isolated bare checkout (`git ls-files` → `/tmp`, no `node_modules`, no `.env*`, AWS vars unset) | `EXECUTED` | install 0 → build 0 → typecheck 0 → `test:unit` 0 (17/17). **SUPERSEDED** by R7 — this ran the `npm install` step revision 2 removed |
| 8 | `next build` needs no AWS | `OBSERVED` | 11/11 static pages generated with credentials unset; `generateStaticParams()` returns `[]`, so nothing prerenders from DynamoDB |
| 9 | Linux runner behaviour | `INFERRED` | **SUPERSEDED** by R5 — revision 2 reproduced it in `linux/amd64 node:22` and found the failure lands in `npm run build`, not in `npm ci` as this row's rationale assumed |
| 10 | First real CI run on push | `NOT RUN` | operator, post-merge |

### Known gaps (not closed by this slice)

- `backend/tsconfig.json` has `"exclude": ["**/*.test.ts"]`, so `backend/test/**` — including the
  only unit suite — is **not** typechecked. `test:unit` transpiles it via vitest/esbuild, which does
  not type-check. Closing this needs a second tsconfig; deferred to `test-3`, which owns the unit layer.
- `admin` `typecheck` covers `tsconfig.app.json` (`src`) and `tsconfig.node.json` (`vite.config.ts`)
  only — no admin test files exist yet (`test-4`/RTL work).
- The gate is type-only. It cannot catch a runtime or serving-contract regression; that is `test-2`.

## Build run 2026-07-27 revision 2 — REJECTED (retained for history)

> **This revision was rejected by the operator.** It repaired the lockfile by regenerating it in a
> clean room, which fixed the platform coverage but simultaneously re-resolved 344 package versions.
> Read § Build run 2026-07-27 revision 3 for what is actually in the working tree. The root-cause
> analysis below (npm will not backfill optional platform variants) survives and is the reason
> revision 3 edits the lockfile directly; the *remedy* it proposes does not.


Decision `TEST1-LOCKFILE-POLICY` = **repair the lockfile, keep `npm ci`**. Revision 1's
`rm -f package-lock.json && npm install` is removed.

### What changed vs revision 1

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | install step → `npm ci`; comment rewritten to the real root cause |
| `package-lock.json` | regenerated in a clean room — platform entries 55 → 169, linux 22 → 82 |
| `TESTING.md` | the "**Do not use `npm ci`**" rule was wrong and is replaced by "use `npm ci`", plus the clean-room regeneration recipe |
| `docs/TECH-DEBT.md` | entry retitled and rewritten: the lockfile is fixed; the residue is `playwright.yml` + the fragility of the linux entries |

Everything from revision 1 stands: the 8 `typecheck` scripts, the root aggregate, the workflow
step order, and no `playwright.yml` / `security-audit.yml` edits.

### The "fails on Linux" claim is now EXECUTED, not INFERRED

Revision 1 rated it `INFERRED` (row 9). It was reproduced directly in
`docker run --platform linux/amd64 node:22` (Debian 12, x86_64, node 22.23.1, npm 10.9.8) from a
bare checkout (`git ls-files` → 560 files, no `node_modules`, no `.env*`, no `AWS_*`):

- `npm ci` from the **old** lockfile → **exit 0**. The revision-1 doc implied `npm ci` itself
  would fail; it does not. The entries are `optional`, so npm skips them without complaint.
  `node_modules/@rollup/` and `lightningcss-*` were simply absent afterwards.
- `npm run build` → **exit 1**, in admin's `vite build`:
  `Error: Cannot find module @rollup/rollup-linux-x64-gnu. npm has a bug related to optional
  dependencies (https://github.com/npm/cli/issues/4828).`

So the failure is real but lands one step later than revision 1 described. Corrected above.

### Why the repair needs a clean room

`npm install` at the repo root — the literal instruction in the revise packet — is a **no-op**
(`up to date`, lockfile byte-identical, md5 unchanged). Three further in-place variants were tried
and all were exact no-ops: `npm install --package-lock-only`; the same with
`--os=linux --cpu=x64 --libc=glibc`; and `--force`. Hand-deleting the darwin child entries did not
trigger re-resolution either — npm left them deleted.

**npm will not backfill optional platform variants into an existing lockfile.** It seeds resolution
from the reified `node_modules`. Only a clean room works: a scratch dir with the 9 `package.json`
files, no `node_modules`, no lockfile, then `npm install --package-lock-only`.

### Cited linux entries in the regenerated lockfile

All were absent before (`os`/`cpu` read from the lockfile itself):

```
node_modules/@rollup/rollup-linux-x64-gnu        4.62.3   os=["linux"] cpu=["x64"]
node_modules/@rollup/rollup-linux-x64-musl       4.62.3   os=["linux"] cpu=["x64"]
node_modules/lightningcss-linux-x64-gnu          1.32.0   os=["linux"] cpu=["x64"]
node_modules/@tailwindcss/oxide-linux-x64-gnu    4.3.3    os=["linux"] cpu=["x64"]
node_modules/@unrs/resolver-binding-linux-x64-gnu 1.12.2  os=["linux"] cpu=["x64"]
node_modules/@img/sharp-linux-x64                0.34.5   os=["linux"] cpu=["x64"]
node_modules/@img/sharp-libvips-linux-x64        1.2.4    os=["linux"] cpu=["x64"]
node_modules/@esbuild/linux-x64                  0.27.7   os=["linux"] cpu=["x64"]
node_modules/@next/swc-linux-x64-gnu             16.2.12  os=["linux"] cpu=["x64"]
```

### The lockfile delta is large — operator decision `TEST1-LOCKFILE-DRIFT` (WITHDRAWN)

> **WITHDRAWN — do not action.** This decision existed only because revision 2 regenerated the
> lockfile. Revision 3 reverted that: the working tree changes 0 versions, so there is no drift.
> Retained because the analysis below is the evidence for *why* regeneration was rejected.

A clean-room regeneration re-resolves every range, so the delta is **not** confined to platform
binaries: 344 version changes, 418 entries removed, 212 added (1552 → 1346).

Most of that is **hoisting rearrangement, not upgrades.** Example checked in full: `node_modules/react
19.2.3 → 19.2.0` looks like a downgrade but is not — `renderer/package.json` pins react at exactly
`19.2.0`, so the old tree hoisted 19.2.3 for admin and kept a second nested copy at
`renderer/node_modules/react@19.2.0`. The new tree hoists 19.2.0, which satisfies admin's `^19.2.0`
too, and the duplicate disappears. One React instance instead of two. The same pattern explains
`react-is 18.3.1 → 16.13.1`, `globals 16.5.0 → 14.0.0`, `jose 6.1.3 → 4.15.9` and the other
apparent downgrades: the *hoisted winner* at that path changed, not any consumer's resolved version.

Genuine upgrades also occur, all legal under the declared `^` ranges — `@tiptap/* 3.13.0 → 3.29.1`,
`tailwindcss 4.1.17 → 4.3.3`, `next 16.2.9 → 16.2.12`, `@playwright/test 1.57.0 → 1.62.0`,
`typescript-eslint 8.48.1 → 8.65.0`, `@aws-sdk/* 3.1004 → 3.1095`.

**These versions are not new to CI.** `playwright.yml` has been running
`rm -f package-lock.json && npm install` all along, so CI has *already* been floating to exactly
this resolution on every run. Adopting the lockfile **pins** what CI already builds and makes it
reviewable in-repo. The drift is relative to the operator's local `node_modules`, not to CI.

Build + typecheck + unit are green on both platforms (below), but that does **not** clear
`@tiptap/* 3.13 → 3.29` — 16 minor versions of the admin editor — at runtime. That unverifiable
runtime risk is precisely why revision 3 does not take the regeneration; the decision it was
flagged under is withdrawn (see the banner above).

### Evidence (revision 2)

Every row EXECUTED in this run unless stated.

| # | Claim | Label | Result |
|---|---|---|---|
| R1 | `npm install` at repo root repairs the lockfile | `EXECUTED` | **no-op** — `up to date`, md5 `f235bd47…` unchanged. Claim is false |
| R2 | 3 further in-place repair variants (`--package-lock-only`; `+ --os/--cpu/--libc`; `--force`) | `EXECUTED` | all exact no-ops: 0 version changes, 0 added, 0 removed |
| R3 | Hand-deleting darwin child entries forces re-resolution | `EXECUTED` | no — entries stayed deleted, 0 added |
| R4 | Clean-room `npm install --package-lock-only` yields linux entries | `EXECUTED` | platform entries 55 → 169; linux 22 → 82. The old 22 were all `@esbuild/*` + `@next/swc-*`; the gap was the 5 packages below |
| R5 | Old lockfile fails on Linux | `EXECUTED` | `linux/amd64 node:22`: `npm ci` **0**, `npm run build` **1**, `Cannot find module @rollup/rollup-linux-x64-gnu` |
| R6 | New lockfile installs linux natives | `EXECUTED` | `rollup-linux-x64-{gnu,musl}`, `lightningcss-linux-x64-*`, `sharp-linux-x64` all present |
| R7 | Full CI sequence, Linux x64, new lockfile | `EXECUTED` | `npm ci` 0 → `npm run build` 0 → `npm run typecheck` 0 (8/8 workspaces) → `test:unit` 0 (17/17) |
| R8 | New lockfile still works on the operator's macOS/arm64 | `EXECUTED` | isolated `/tmp` checkout: `npm ci` 0, darwin binaries present, `npm run build` 0, `npm run typecheck` 0 |
| R9 | `ci.yml` remains credential-free | `OBSERVED` | no `secrets.*`, no `env:`, no `AWS_*`; container had no AWS env |
| R10 | `playwright.yml` / `security-audit.yml` untouched | `OBSERVED` | not in the diff |
| R11 | Runtime safety of the 344-package drift | `NOT RUN` | build/typecheck/unit only. No e2e — needs deployed staging. See `TEST1-LOCKFILE-DRIFT` |
| R12 | First real CI run on push | `NOT RUN` | operator, post-merge |

### Operator action required before this is useful

The repo's `node_modules` was **deliberately left untouched** — it still matches the *old* lockfile.
Nothing was installed over the operator's working environment. After approving, run `npm ci` at the
root to sync. Until then the local tree and `package-lock.json` disagree.

---

## Build run 2026-07-27 revision 3 — surgical lockfile repair (AUTHORITATIVE)

Decision `TEST1-LOCKFILE` = **add only the missing foreign-platform optional-binary entries, at the
versions already pinned; no re-resolution.** Revision 2's clean-room regeneration is reverted.

### What changed vs revision 2

| File | Change |
|---|---|
| `package-lock.json` | reset to `HEAD`, then **63 entries added** — the linux/win32 siblings of the 5 native families that lacked them. **0 existing entries modified, 0 removed.** No dependency drift |
| `.github/workflows/ci.yml` | unchanged step order (`npm ci` retained); the install-step comment no longer prescribes clean-room regeneration |
| `TESTING.md` | the clean-room recipe is replaced by the surgical-repair recipe + the `git diff` mis-anchoring caveat |
| `docs/TECH-DEBT.md` | entry rewritten: describes the hand repair, why regeneration was rejected, and the 3 residual risks |
| `docs/testing-strategy.md`, `docs/ROADMAP.md` | stale "regenerated in a clean room" / "344 versions" references corrected |

Everything from revision 1 stands: the 8 `typecheck` scripts, the root aggregate, the workflow step
order, and no `playwright.yml` / `security-audit.yml` edits.

`DECISION_REQUIRED: TEST1-LOCKFILE-DRIFT` is **withdrawn** — revision 3 introduces zero version
changes, so there is nothing to clear at runtime. (`@tiptap/*`, `tailwindcss`, `next` and
`@aws-sdk/*` remain at their HEAD-pinned versions.)

### What was added, and how the set was derived

The five families whose foreign-platform siblings were missing — and *only* these five. `@esbuild/*`
and `@next/swc-*` were already complete in the lockfile, which is why the Linux failure was
package-specific rather than total.

| Family | Parent entry consulted | Pinned version | Siblings added |
|---|---|---|---|
| rollup | `node_modules/rollup` | 4.59.0 | 17 (13 linux, 4 win32) |
| tailwind oxide | `node_modules/@tailwindcss/oxide` | 4.1.17 | 7 (5 linux, 2 win32) |
| unrs resolver | `node_modules/unrs-resolver` | 1.11.1 | 13 (10 linux, 3 win32) |
| lightningcss | `node_modules/lightningcss` | 1.30.2 | 7 (5 linux, 2 win32) |
| sharp (+ libvips) | `node_modules/sharp` | 0.34.5 / 1.2.4 | 19 (16 linux/linuxmusl, 3 win32) |

Each parent's own `optionalDependencies` map is the authoritative sibling list **and** the exact
version to use — no version was chosen, only copied. `resolved` / `integrity` / `cpu` / `os` /
`engines` / `license` come from `https://registry.npmjs.org/<name>/<version>`; the `dev` flag was
copied from the already-present darwin sibling of the same family, since dev-ness is a property of
how the node is reached in this tree.

A guard in the edit script refused to write if any added entry depended on a package absent from the
lockfile. That is why the `wasm32-wasi` siblings of oxide, unrs-resolver and sharp are **excluded**:
they pull `@emnapi/*`, `@napi-rs/wasm-runtime` and `@tybys/wasm-util`, which would have made this
more than a platform-entry addition. android/freebsd/openbsd siblings were not added either. No
runner this repo uses is on those platforms.

### Reading the diff — `git diff` alone will mislead you

`git diff package-lock.json` with the **default myers** algorithm reports `1140 insertions(+),
93 deletions(-)`. Those 93 deletions are an artifact: myers mis-anchors a large run of insertions
into a uniform JSON structure and re-emits unchanged neighbouring blocks (`@radix-ui/*`) as
delete+add. Use either of these instead:

```bash
git diff --diff-algorithm=histogram --stat -- package-lock.json   # 1047 insertions(+), 0 deletions
git diff --diff-algorithm=histogram -U0 -- package-lock.json | grep -c '^-[^-]'   # 0
```

The authoritative check is semantic, not textual:

```bash
git show HEAD:package-lock.json > /tmp/lock.head.json
node -e '
const a=JSON.parse(require("fs").readFileSync("/tmp/lock.head.json","utf8")).packages;
const b=JSON.parse(require("fs").readFileSync("package-lock.json","utf8")).packages;
const eq=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
const removed=Object.keys(a).filter(k=>!(k in b));
const modified=Object.keys(a).filter(k=>k in b && !eq(a[k],b[k]));
const added=Object.keys(b).filter(k=>!(k in a));
console.log({removed:removed.length, modified:modified.length, added:added.length});'
# -> { removed: 0, modified: 0, added: 63 }
```

The re-serialization is safe because `JSON.parse` → `JSON.stringify(obj,null,2)+"\n"` on the HEAD
lockfile is **byte-identical** to the HEAD file (verified), and npm orders `packages` by plain
lexicographic key sort (verified against the HEAD key order).

### Evidence (revision 3)

Every row EXECUTED in this run unless stated. Container:
`docker run --platform linux/amd64 node:22` — Debian, x86_64, node 22.23.1, npm 10.9.8, no AWS env.
Host: macOS/arm64, node 22.21.1, npm 10.9.4.

| # | Claim | Label | Result |
|---|---|---|---|
| S1 | Lockfile reset to HEAD before editing | `EXECUTED` | `git checkout HEAD -- package-lock.json`, md5 `f235bd47532673eff2f700add43be110` |
| S2 | Repair is surgical | `EXECUTED` | semantic compare HEAD vs working: **removed 0, modified 0, added 63**; all top-level lockfile fields unchanged |
| S3 | Every added entry is a non-darwin optional platform binary | `EXECUTED` | 63/63 have `optional: true` and an `os` array excluding `darwin` |
| S4 | Every added version equals the version its parent already pinned at HEAD | `EXECUTED` | 63/63 match; **0 version mismatches** |
| S5 | HEAD lockfile is what breaks Linux (counterfactual, re-run in this cycle) | `EXECUTED` | `npm ci` **0** but rollup/lightningcss/oxide/sharp linux natives ABSENT; `npm run build` **1** — `MODULE_NOT_FOUND ... rollup/dist/native.js` in admin `vite build` |
| S6 | Repaired lockfile installs the linux natives | `EXECUTED` | all 8 checked natives PRESENT at the pinned versions; darwin siblings correctly skipped |
| S7 | Full CI sequence, Linux x64, repaired lockfile, bare checkout | `EXECUTED` | `npm ci` **0** → `npm run build` **0** (11/11 static pages) → `npm run typecheck` **0** (8/8 workspaces) → `backend test:unit` **0** (17/17) |
| S8 | Repaired lockfile still works on macOS/arm64 | `EXECUTED` | isolated `/tmp/amodx-mac`: `npm ci` **0**, 8/8 darwin natives present, linux skipped, `npm run build` **0**, `npm run typecheck` **0**, `test:unit` **0** (17/17) |
| S9 | Isolation — operator's environment untouched | `OBSERVED` | all installs ran in `/tmp/amodx-mac` and in throwaway containers; repo `node_modules` never written |
| S10 | Bare checkout really is bare | `EXECUTED` | 562 files from `git ls-files` + `ci.yml`; no `node_modules`, no `.env*`, no `dist`; container env has no `AWS_*`/`DYNAMO*` |
| S11 | `ci.yml` is credential-free | `OBSERVED` | zero `secrets.*` outside prose comments, zero `env:` blocks, zero `AWS_*` |
| S12 | `playwright.yml` / `security-audit.yml` untouched | `OBSERVED` | not in `git status` / `git diff` |
| S13 | Registry integrity hashes pinned for all 63 additions | `EXECUTED` | all 63 carry `resolved` + `integrity` read from `registry.npmjs.org/<name>/<version>`. **Only the linux subset was hash-verified by an actual install** (the Linux container downloaded them; `npm ci` fails closed on a bad hash). The 14 win32 entries were downloaded by neither platform, so their hashes are registry-sourced but install-unverified — they will be checked the first time a Windows runner uses this lockfile, which is never for this repo |
| S14 | First real CI run on push | `NOT RUN` | operator, post-merge — the only gate this build cannot close |
| S15 | Runtime/e2e verification of the app | `NOT RUN` | out of slice: no dependency versions changed, and e2e needs deployed staging (`playwright.yml`) |

### Operator action after approval

The repo's `node_modules` is **still untouched** and still matches HEAD's lockfile. Because the 63
additions are all foreign-platform optional entries, a macOS `npm ci` resolves to the identical
darwin tree the operator already has — the sync is a formality, not a re-install of anything real.
Run `npm ci` at the root after merging.
