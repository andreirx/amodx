# CI-LOCKFILE-1 — the Playwright workflows install the recorded versions; the reserved-word guard under `npm test`

- **Status:** IMPLEMENTED 2026-11-28 — built, operator proof on GitHub pending (§ *Migration / deployment notes*).
  Committed as `4d485af`; its GitHub run showed one more cause (§ *CL1-RUNNER-OS*), corrected in revision 2
  (revision 3: wording of this file only); revisions 2 and 3 are not yet committed.
- **Track:** maintenance (order of work from 2026-11-27, `docs/ROADMAP.md`: after `settings-findings-1`, before
  `theme-roles-1` and Track B).
- **Depends:** `test-1` (the lockfile with the Linux entries; `ci.yml` on `npm ci`), `projection-reserved-1` (the
  reserved-word guard and the test that asserts it).
- **Source plan:** none. Ordered by the human, 2026-11-27 (verbatim: "add slices to fix the settings screen, github
  actions"). ROADMAP row `ci-lockfile-1`. This file was written by the builder (`claude-opus-5-5`) from the operator
  packet; reviewer `gpt-6.1-sol`. It surfaces no ratification-class decision.
- **Maturity:** no change (CI configuration and test configuration only).

## Purpose / risk retired

The workflow "Playwright Tests" (`.github/workflows/playwright.yml`) is the only workflow that runs the backend
staging suites (`npm test` in `backend/`; OBSERVED in the four workflow files). It is red on every push since commit
`31112cb` (2026-11-27 18:09 UTC; operator observation), and it installs library versions that nobody reviewed. A red gate that is red for a reason unrelated to the change under test teaches the operator to ignore it.
The risk retired: a gate that reports a false failure, and a gate that tests a dependency set different from the one
that is deployed. After this slice the workflow installs the versions in `package-lock.json`, its backend step
loads, for the unit files, the guard setup file that `npm run test:unit` loads, and (revision 2) it runs on a pinned
runner image that the recorded Playwright supports.

## Causes (with evidence)

**Cause 1 — the guard is missing under `npm test`.** OBSERVED (operator, GitHub run 46068752166): 1 failed, 2,497
passed, 31 skipped. The failed test is `backend/test/unit/projection-reserved-1.test.ts` › "every unit test file gets
the guard: constructing a command with a bare reserved word throws (dynamo-reserved-setup.ts)", with
`AssertionError: expected [Function] to throw an error`.

OBSERVED in the code at base `41487f3`:

- The workflow step "Run Backend Integration Tests" runs `npm test` in `backend/`. `backend/package.json` maps
  `test` to `vitest run`, which reads `backend/vitest.config.ts`.
- `backend/vitest.config.ts` has `include: ['**/*.test.ts']` and `setupFiles: ['./test/setup.ts']`. The include
  also matches every file under `test/unit/`.
- `backend/vitest.unit.config.ts` (`npm run test:unit`) has `setupFiles: ['test/unit/dynamo-reserved-setup.ts']`.
  Only that configuration loads this shared guard setup file. Four unit files do not depend on it: `debounce-flush`,
  `debounce-maxwait`, `invalidate-cdn` and `lang-1b-deferred-flush` replace `@aws-sdk/lib-dynamodb` with their own
  `vi.mock` factory, and each factory returns its module through `guardCommandClasses` (OBSERVED: `grep -l
  "guardCommandClasses(" backend/test/unit/*.ts`). Those four have the guard under either configuration.
- `test/unit/dynamo-reserved-setup.ts` replaces `@aws-sdk/lib-dynamodb` by the real module passed through
  `guardCommandClasses` (`test/unit/dynamo-expression-guard.ts:122`): each of the nine command classes
  (`GetCommand` … `TransactWriteCommand`) becomes a same-named subclass whose constructor calls
  `assertNoBareReservedWord(input)` and then `super(...)`. `DynamoDBDocumentClient` and every other export stay the
  real ones.

So `npm test` omits the shared setup file. Every unit file that depends on it runs without the guard, and the one test
that asserts the guard (`projection-reserved-1.test.ts`, which has no factory of its own) fails. The local gates and
`ci.yml` run `test:unit`, so they cannot show it.

EXECUTED (this slice, § *Build record*): a temporary copy of `vitest.unit.config.ts` without its `setupFiles` line
gives the same failed test, with the same message; the other tests: 2,453 passed, 2 skipped.

**Cause 2 — the workflows delete the lockfile.** OBSERVED at base `41487f3`: `playwright.yml:21` and
`staging-e2e.yml:40` run `rm -f package-lock.json && npm install`. That installs the newest versions the ranges
allow. On 2026-11-27 it made a test red that asserted the behaviour of one SDK version (`@aws-sdk/client-dynamodb`
3.1178 installed, 3.1009 recorded; operator observation). The reason in the workflow comment (a lockfile written on
macOS has no Linux optional packages) no longer holds: `test-1` added the Linux entries by hand
(`docs/TECH-DEBT.md` § *Lockfile Linux entries are fragile*), and `ci.yml` runs `npm ci` on `ubuntu-latest`
with Node 22 (OBSERVED in `ci.yml`) and is green on every push (operator observation, packet of 2026-11-28).

## CL1-RUNNER-OS — the runner image (operator finding after the push, 2026-11-28)

**Finding.** OBSERVED (operator): GitHub run 46076252585 of commit `4d485af` ("Playwright Tests"). `npm ci` succeeded
("added 1475 packages"). The next step, `npx playwright install --with-deps`, failed: "BEWARE: your OS is not
officially supported by Playwright; installing dependencies for ubuntu26.04-x64 as a fallback. Cannot install
dependencies for ubuntu26.04-x64 with Playwright 1.57.0! … Error: ERROR: Playwright does not support chromium on
ubuntu26.04-x64".

**Cause.** `runs-on: ubuntu-latest` gives Ubuntu 26.04 today (operator observation, from the log above). The recorded
Playwright is 1.57.0 (OBSERVED: `package-lock.json` entries `node_modules/@playwright/test`,
`node_modules/playwright` and `node_modules/playwright-core`, all 1.57.0, and no other copy). Before this slice the
deleted lockfile let `npm install` take a newer Playwright (operator statement; not checked here). With the recorded
versions, the floating runner image is the remaining unpinned part of the environment.

**Verification that 1.57.0 supports Ubuntu 24.04** (OBSERVED in the installed package, `playwright-core` 1.57.0):

- `node_modules/playwright-core/lib/server/utils/hostPlatform.js:78-80`:
  `if (major < 26) return { hostPlatform: "ubuntu24.04" + archSuffix, isOfficiallySupportedPlatform: isUbuntu &&
  version === "24.04" };` and, for 26 and later, `return { hostPlatform: "ubuntu" + distroInfo.version + archSuffix,
  isOfficiallySupportedPlatform: false };`. So 24.04 is the highest officially supported Ubuntu, and 26.04 becomes the
  platform key `ubuntu26.04-x64`.
- `node_modules/playwright-core/lib/server/registry/index.js:154`: `"ubuntu24.04-x64":
  "builds/chromium/%s/chromium-linux.zip"` (firefox line 278, webkit line 340 likewise). No key contains `ubuntu26`
  (`grep -c ubuntu26` → 0), so `_downloadExecutable` (line 1143) throws "Playwright does not support chromium on …",
  the error of the run.
- `node_modules/playwright-core/lib/server/registry/nativeDeps.js:458`: `"ubuntu24.04-x64": {` (the system packages
  `--with-deps` installs). No `ubuntu26` key (`grep -c` → 0), so `dependencies.js:108` prints "Cannot install
  dependencies for …", the warning of the run.

**Ruling (operator).** Pin the runner image of the workflows that install Playwright browsers to `ubuntu-24.04`, for
the same reason as the Node pin: a floating image rolls silently. Rejected: raising Playwright in the lockfile (a
lockfile and manifest change; the operator's staging scripts and the e2e suite use the recorded version; a separate,
tested upgrade if ever wanted).

**Which workflows.** OBSERVED (`grep -n "playwright install" .github/workflows/*.yml`): `playwright.yml`
(`npx playwright install --with-deps`; line 24 at `4d485af`, line 25 in the current file) and `staging-e2e.yml`
(`npx playwright install --with-deps chromium`; line 45 at `4d485af`, line 46 in the current file). The pin's comment
line moved each command down by one. Both are pinned. `ci.yml` and `security-audit.yml` install no browser and are not edited. INFERRED (not checked here):
GitHub still offers the `ubuntu-24.04` image; the operator's next run shows it.

## Scope

1. `backend/vitest.config.ts`: `setupFiles` becomes `['./test/setup.ts', './test/unit/dynamo-reserved-setup.ts']`,
   with a comment that says why.
2. `.github/workflows/playwright.yml` and `.github/workflows/staging-e2e.yml`: the install step runs `npm ci`; its
   comment points at the note at the install step of `ci.yml`. `node-version` changes from `lts/*` to `'22'`, for the
   reason `ci.yml` gives (a floating LTS rolls silently; 22 is the Lambda runtime).
3. A check, no edit: `package-lock.json` is in sync with every `package.json` of the workspace.
4. Docs: `docs/TECH-DEBT.md`, `TESTING.md`, `docs/ROADMAP.md`, `CURRENT_SLICE.md`, this file.
5. Revision 2 (CL1-RUNNER-OS): `runs-on: ubuntu-latest` → `ubuntu-24.04` in `playwright.yml` and `staging-e2e.yml`,
   with a one-line comment that names the cause; a `docs/TECH-DEBT.md` entry.

## Non-scope

No change to what the Playwright workflow tests, to its triggers, secrets or other steps (the backend `npm test` step
stays). The job-level `runs-on` changes only in revision 2, by operator ruling (§ *CL1-RUNNER-OS*). No change to `ci.yml`, to any `package.json` or to the lockfile. The backend staging suites stay dependent on
the live staging table (recorded debt). No lockfile guard step (TECH-DEBT residual 2 stays open; the packet does not
ask for it). No `cache: npm` on `setup-node` (residual 4 stays open).

## Is the guard safe for the staging suites? (scope item 1, checked from the code)

The guard adds one check in the constructor of the nine command classes and then calls the real constructor
(OBSERVED: `dynamo-expression-guard.ts:128`). A command that passes the check is an instance of a subclass that adds
nothing else, so it carries the real command's input and middleware; the real `DynamoDBDocumentClient` (not wrapped)
sends it. The check refuses an
expression only if it names a word of `DYNAMO_RESERVED_WORDS` (`backend/src/lib/dynamo-reserved-words.ts`, copied
from the AWS reserved-words page, 573 words) bare, and then throws a `ValidationException` with the message text that `dynamo-reserved-words.ts` records for
DynamoDB. INFERRED (from that list's source and from layer 1 of `projection-reserved-1.test.ts`, which tests the rule
against DynamoDB's documented behaviour; not measured against DynamoDB in this slice): a staging suite that the guard
stops would also fail against DynamoDB.

The files that `vitest.config.ts` runs and that are NOT under `test/unit/` (basis: `find backend/test -name
'*.test.ts' -not -path 'backend/test/unit/*'`, a deterministic file listing; no other `*.test.ts` exists in `backend/`
outside `node_modules`):

| File | Replaces `@aws-sdk/lib-dynamodb` with its own `vi.mock`? | Builds lib-dynamodb commands itself? |
|---|---|---|
| `test/auth-authorizer.test.ts` | no (it mocks `aws-jwt-verify` and `@aws-sdk/client-secrets-manager` only) | no |
| `test/auth-policy.test.ts` | no (no `vi.mock`) | no |
| `test/comments.test.ts` | no (no `vi.mock`) | no (calls handlers in `src/`) |
| `test/content.test.ts` | no (no `vi.mock`) | no (calls handlers in `src/`) |
| `test/isolation.test.ts` | no (no `vi.mock`) | yes: `PutCommand`, `QueryCommand` (`PK = :pk`), `DeleteCommand` |
| `test/leads.test.ts` | no (no `vi.mock`) | no (calls handlers in `src/`) |
| `test/products.test.ts` | no (no `vi.mock`) | no (calls handlers in `src/`) |
| `test/scheduling-db.integration.test.ts` | no (no `vi.mock`) | yes: `QueryCommand` (`PK = :pk`, `PK, SK`), `PutCommand`, `DeleteCommand` |
| `test/tenant.test.ts` | no (no `vi.mock`) | no (calls handlers in `src/`) |

The helper `test/utils.ts` (not a test file) builds `PutCommand` (`attribute_not_exists(PK)`), `ScanCommand`
(`PK = :pk`) and `BatchWriteCommand` (not guarded). Basis for the second column: the regex of the rule in
`projection-reserved-1.test.ts` (``vi\.(do)?[mM]ock\(\s*["'`]@aws-sdk\/lib-dynamodb["'`]``) run over each file gives
0 matches, and a grep for any `vi.mock` / `vi.doMock` finds only the two calls of `auth-authorizer.test.ts` (lines 25 and 39).

**The factory rule.** `projection-reserved-1.test.ts` › "each test file that replaces the module returns it through
guardCommandClasses" searches only `backend/test/unit/`. It matters for a file whose own `vi.mock` factory replaces
`@aws-sdk/lib-dynamodb`, because such a factory replaces the guard for that file. No file outside `test/unit/` has such
a factory (table above), so the rule does not apply to them and its search does not need to widen. A future staging
suite that adds such a factory would bypass the guard without a test failing; that is recorded as
F-CL1-FACTORY-RULE-SCOPE (§ *Findings*), not fixed.

**The expressions.** OBSERVED from the import lists of `backend/test/*.ts`: the staging suites import handlers and
libraries from `backend/src/`, the helper `./utils`, `@amodx/shared` (date functions only, in
`scheduling-db.integration.test.ts`) and the AWS SDK. So the expressions they send are written in `backend/src/` or in
`backend/test/*.ts` (INFERRED: this does not follow a module of `backend/src/` into its own imports outside it). Both
are inside the static scan of `projection-reserved-1.test.ts` › "no expression names a reserved word bare", which
passes (EXECUTED, `test:unit`). The scan is a lint, not a proof (F-RESERVED-SCAN-LIMITS); the run-time sites are the
ones `projection-reserved-1` audited by hand. INFERRED: the guard refuses no expression that a staging suite sends.

## Architectural boundaries

- `ci.yml` stays credential-free and is not edited.
- The staging suites keep their access to the live staging table; the change adds no AWS access and no secret.
- The guard stays test infrastructure under `backend/test/unit/`; no production code changes.
- The lockfile is not rewritten (`docs/TECH-DEBT.md` rules: never regenerate it wholesale).

## Migration / deployment notes

Nothing to deploy. No data migration. The operator's proof after commit and push: the GitHub run of "Playwright
Tests" on the commit that contains revision 2 is green, its "Install dependencies" log shows `npm ci` (and `added …
packages` with no `rm`), and its step "Install Playwright Browsers" passes with no "not officially supported"
warning.

Rollback, two cases, each against its own baseline:

- **Revert the commit of revision 2** (the runner pin). The two workflows go back to `runs-on: ubuntu-latest`; `npm ci`,
  Node `'22'` and the guard setup file in `backend/vitest.config.ts` stay (they are in `4d485af`). INFERRED (from
  § *CL1-RUNNER-OS* and run 46076252585): while `ubuntu-latest` is 26.04, "Install Playwright Browsers" fails again.
- **Revert `4d485af`** (and revision 2 first, if it is committed on top). The workflows go back to
  `rm -f package-lock.json && npm install` and Node `lts/*`, and `backend/vitest.config.ts` loses the guard setup
  file. INFERRED (from cause 1 and cause 2): the backend step goes back to red on the guard test, and the install
  floats to the newest versions the ranges allow.

If `npm ci` fails on GitHub with npm's explicit mismatch error ("`npm ci` can only install packages when your
package.json and package-lock.json … are in sync", followed by `Missing:` / `Invalid:` lines), the lockfile is out of
sync with a `package.json` of the pushed commit; § *Build record*, check 1, shows it is in sync at `41487f3`, and neither `4d485af` nor revision 2 changes a
`package.json` or the lockfile (OBSERVED: `git diff --stat 41487f3 4d485af` and `git diff --stat 4d485af` on those
paths are empty). Any other
`npm ci` failure is not evidence of a mismatch: the install can also fail in the root `postinstall` script
(`patch-package`, root `package.json`), in a package's install script, or on the registry; read the log. If a step fails with a missing `*-linux-x64-*` module, see `TESTING.md`
§ *If a Linux runner fails on a missing native binary*. The Playwright workflow runs no build step and its
`playwright.config.ts` starts no web server (the `webServer` block is commented out), so this is not expected there.

## Definition of Done

- `backend/vitest.config.ts` loads `./test/unit/dynamo-reserved-setup.ts` after `./test/setup.ts`, with a comment.
- Both workflows install with `npm ci`, pin Node `'22'` and (revision 2) run on `ubuntu-24.04`; nothing else in them
  changes (structural diff).
- At base `41487f3`, npm's own sync check passes for the lockfile and every `package.json` (dry run in a copy, with a
  negative control; the repository's lockfile not touched).
- The temporary-configuration proof: red without the setup file, green with it.
- Gates green: `npm run typecheck`, `npm --prefix backend run test:unit`, `git diff --check`, YAML parse.
- Docs updated: `docs/TECH-DEBT.md`, `TESTING.md`, `docs/ROADMAP.md`, `CURRENT_SLICE.md`.
- Operator: the GitHub "Playwright Tests" run on the commit that contains revision 2 is green, its install log shows
  `npm ci`, and its "Install Playwright Browsers" step passes on Ubuntu 24.04.

## Evidence required

EXECUTED by the builder: the items of § *Build record*. NOT RUN by the builder, by rule: `cd backend && npm test`
(it writes to the live staging table). `npm ci` on the Playwright runner is OBSERVED by the operator in run
46076252585 of `4d485af` ("added 1475 packages"). That run stopped at "Install Playwright Browsers", before the
backend step, so the `vitest.config.ts` change under that configuration and the runner pin have no proof yet: the
operator's next GitHub run is the only proof of both.

## Exit criterion

"Playwright Tests" installs the reviewed dependency set, runs on a runner image that the recorded Playwright supports,
and its backend step no longer fails for the missing guard setup file. A red run then no longer comes from these three
causes (cause 1, cause 2, CL1-RUNNER-OS); it can still come from the staging table, the
network or the deployed target, which this slice does not change. The
lockfile is the one dependency record for all four workflows (`security-audit.yml` already ran `npm ci`).

## Findings (new; not fixed by this slice)

- **F-CL1-FACTORY-RULE-SCOPE** — the factory rule of `projection-reserved-1.test.ts` searches `backend/test/unit/`
  only; since this slice the guard also applies to the staging suites under `backend/test/`. A staging suite that
  adds its own `vi.mock("@aws-sdk/lib-dynamodb", …)` factory would drop the guard for that file and no test would
  fail. None exists today. Fix when it matters: widen the search to `backend/test/` (a change to that test's file
  list and its expected list).
- **F-CL1-CI-COMMENT-COUNT** — `ci.yml` says "the 8 backend suites under backend/test/*.test.ts"; there are 9
  (`scheduling-db.integration.test.ts` is the ninth). `ci.yml` is non-scope here. `TESTING.md` § *CI/CD Integration*
  says "Three workflows exist"; there are four (`staging-e2e.yml`). Both are text only.

## References

- `docs/slices/projection-reserved-1.md` (the guard), `docs/shipped/slices/test-1-fast-gates.md` (the lockfile repair
  and `ci.yml`).
- `docs/TECH-DEBT.md` § *Lockfile Linux entries are fragile* (residual 1 closed here).
- `TESTING.md` § *CI/CD Integration*; `docs/testing-strategy.md` § *Current estate* (the CI row).
- `.github/workflows/ci.yml` (the note at the install step; the Node pin).

## Build record (builder `claude-opus-5-5`, 2026-11-28, base `41487f3`)

Items 1–8 are the first build and revision 1, against base `41487f3` (then `HEAD`); they were committed as `4d485af`.
Revision 2 and revision 3 are recorded below, against base `4d485af`.

Files changed: `backend/vitest.config.ts`, `.github/workflows/playwright.yml`, `.github/workflows/staging-e2e.yml`,
`docs/TECH-DEBT.md`, `TESTING.md`, `docs/ROADMAP.md`, `CURRENT_SLICE.md`, this file (new).

1. **Lockfile sync (scope 3)** — EXECUTED. The 9 `package.json` files and `package-lock.json` at `41487f3` copied into
   `/tmp/CI-LOCKFILE-1-lock.*` (no `node_modules`). `npm ci --dry-run --ignore-scripts` → exit 0.
   `npm install --package-lock-only --ignore-scripts` → exit 0, and `cmp` shows the lockfile byte-identical to the
   original. Negative control: with `left-pad@1.3.0` added to the copy of `backend/package.json`,
   `npm ci --dry-run` → exit 1, "`npm ci` can only install packages when your package.json and package-lock.json …
   are in sync". So the check can fail, and at `41487f3` it passes. Temporary directory deleted. The repository's
   lockfile has the entry `node_modules/@rollup/rollup-linux-x64-gnu`. Local npm 10.9.4, Node 22.21.1.
2. **The CI failure, reproduced** — EXECUTED. `backend/CI-LOCKFILE-1-nosetup.config.ts` = `vitest.unit.config.ts`
   without its `setupFiles` line: exit 1; 1 failed | 93 passed | 2 skipped files; 1 failed | 2453 passed | 2 skipped
   tests; the failed test is the guard test, with `AssertionError: expected [Function] to throw an error`.
3. **The fix string, proven** — EXECUTED. `backend/CI-LOCKFILE-1-withsetup.config.ts` = `vitest.unit.config.ts` with
   `setupFiles: ['./test/unit/dynamo-reserved-setup.ts']` (the exact string added to `vitest.config.ts`): exit 0;
   94 passed | 2 skipped files; 2454 passed | 2 skipped tests. Both temporary files deleted.
4. **`npm run typecheck`** — EXECUTED, exit 0 (against the `packages/*/dist` already on disk; no package source
   changed, so no rebuild).
5. **`npm --prefix backend run test:unit`** — EXECUTED, exit 0; 94 passed | 2 skipped files, 2454 passed | 2 skipped
   tests.
6. **YAML parse** — EXECUTED with `yaml` 2.9.1 from the root `node_modules`: both files parse with no error;
   `node-version` is the string `"22"`; the install step runs `npm ci`. A structural comparison with the `41487f3`
   versions (both parsed, those two fields masked, `assert.deepStrictEqual`) shows no other difference.
7. **`git diff --check`** — EXECUTED, exit 0, with this file included (it was new then; `git add -N`).
8. **`cd backend && npm test`** — NOT RUN (forbidden: it writes to the live staging table). The operator's GitHub run
   is the proof.

### Revision 1 (2026-11-28, review finding F-CL1-EVIDENCE-SCOPE)

The class of defect: a conclusion stated wider than its evidence. Rule applied to the whole file (and to the comment
in `backend/vitest.config.ts`): each conclusion names its basis (OBSERVED in a named file, EXECUTED, operator
observation) and is narrowed to what that basis shows; a conclusion that goes beyond it is labelled INFERRED.
Corrected under that rule: cause 1 (four unit files apply the guard through their own factories, so `npm test` omits
only the shared setup file); the diagnosis of an `npm ci` failure (only npm's explicit mismatch error shows a
lockfile mismatch; `patch-package` in the root `postinstall` and other install steps can fail too); the counts of
the reproduction; the basis of "only workflow", "red on every push" and "green on every push"; the guard-safety
paragraph (subclass behaviour, the message text, where the expressions come from); the rollback; the Definition of
Done line on the lockfile; the exit criterion (a red run can still have other causes); the `vitest.config.ts`
comment (no longer claims the guard refuses only what DynamoDB refuses). No configuration or workflow line changed.
Re-run after the revision (EXECUTED): § *Build record* items 1–7, every result and count unchanged.

### Revision 2 (2026-11-28, operator finding CL1-RUNNER-OS; base `4d485af`)

Files changed: `.github/workflows/playwright.yml`, `.github/workflows/staging-e2e.yml` (`runs-on: ubuntu-24.04` and a
one-line comment each; `git diff 4d485af --stat -- .github/` → 2 files, 4 insertions, 2 deletions),
`docs/TECH-DEBT.md` (the pin entry), `docs/ROADMAP.md`, `CURRENT_SLICE.md`, this file.

1. **Playwright 1.57.0 supports Ubuntu 24.04** — OBSERVED in `node_modules/playwright-core` 1.57.0 (the version of
   the lockfile): § *CL1-RUNNER-OS*, the quoted lines. No `DECISION_REQUIRED`: 24.04 is supported.
2. **YAML parse** — EXECUTED with `yaml` 2.9.1 from the root `node_modules`: exit 0; both files parse with no error;
   `runs-on` is `"ubuntu-24.04"`, `node-version` `"22"`, install `npm ci`. A structural comparison with `4d485af` and
   with `41487f3` (both parsed; `runs-on`, `node-version` and the install `run` masked; `assert.deepStrictEqual`)
   shows no other difference.
3. **`git diff --check`** — EXECUTED, exit 0.
4. **The fix on GitHub** — NOT RUN (operator-owned): the next "Playwright Tests" run, whose "Install Playwright
   Browsers" step must pass on Ubuntu 24.04.
5. **Correction (revision 3):** the report of revision 2 gave the browser-install commands as `playwright.yml:24` and
   `staging-e2e.yml:45`. Those are the lines at `4d485af`; in the files of revision 2 they are lines 25 and 46
   (§ *CL1-RUNNER-OS*, "Which workflows").

The gates of revision 1 (typecheck, `test:unit`, the lockfile check, the temporary-configuration proofs) were not
re-run: this round changes no code, test configuration, manifest or lockfile, and the packet names only the two gates
above for it.

### Revision 3 (2026-11-28, review finding F-CL1-R2-DOC-RIPPLES; base `4d485af`; this file only)

The class of defect: a statement written for the first build or for one commit that a later revision made false or
ambiguous (a rollback, a file:line, "`HEAD`", "the commit", "these two causes"). Rule applied to the whole file: every
file:line reference and every rollback or proof statement names the commit it refers to, or is correct for the current
files. Corrected (section → change):

- *Status*: names revision 3 and that revisions 2 and 3 are not committed.
- *Purpose / risk retired*: adds the pinned runner image to what the slice delivers.
- *CL1-RUNNER-OS*, "Which workflows": the browser-install lines for `4d485af` (24, 45) and for the current files (25, 46).
- *Non-scope*: states that the job-level `runs-on` changes in revision 2, by operator ruling.
- *Migration / deployment notes*: the proof names the commit that contains revision 2. The rollback is two cases: revert
  revision 2 (back to `ubuntu-latest`; `npm ci`, Node `'22'` and the guard setup stay) or revert `4d485af` (back to
  the deleted lockfile, `lts/*` and no guard setup). The sync statement adds that `4d485af` and revision 2 change no
  manifest or lockfile.
- *Definition of Done*: the operator line names the commit that contains revision 2.
- *Evidence required*: `npm ci` on the runner is OBSERVED in run 46076252585; the guard setup under `npm test` and the
  runner pin are still unproven, because that run stopped before the backend step.
- *Exit criterion*: three causes, not two.
- *Build record*: items 1–8 are tied to base `41487f3` ("`HEAD`" replaced by `41487f3` in items 1 and 6; item 7 says
  the file was new then); the record of revision 2 gets item 5, the line-number correction.

No change to the workflows, the configuration or any other file except `CURRENT_SLICE.md` (its proof sentence names the
commit that contains revision 2). The workflow files are byte-identical to revision 2 (`shasum` before and after this
round). Gate: `git diff --check`, exit 0.
