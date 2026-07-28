# VID-1: YouTube/Vimeo URL Parser (SUPPORT)

- **Status:** SHIPPED 2026-07-28 — deployed to production by the human, verified live (staging probe suite + prod probes: bijup.com s-maxage/Hit/age, session bypass, nf no-loop)
  § *Revision 1*, § *Revision 2*, § *Ratified amendment*, § *Lockfile*). **Both open
  decisions are now closed**; no question is outstanding against this slice. Revision 3
  changed no code and no behaviour: it records decision `VID1_LOCKFILE_SCOPE` (operator,
  2026-07-28 — the root `package-lock.json` diff is authorized as an ancillary of the
  permitted `vitest` devDependency, § *Lockfile*) and re-measured every gate against the
  current tree. Revision 1 applied decision
  `VID1-DIRECT-SCHEME-CONTRACT` (operator, 2026-07-28): the non-http(s) scheme guard is
  **RETAINED** and is now a ratified amendment to the plan's `direct` rule, not an open
  deviation. Revision 2 clears the two changes required by the revision-1 review: the
  `direct` kind's `embedUrl` is back to the plan's contract (the **raw** URL, not the
  trimmed one — that second deviation was never ratified), and `docs/TECH-DEBT.md`'s
  dependency-audit counts are reconciled against a freshly executed `npm audit`.
- **Track:** A — Video embed
- **Depends:** none (independent; plugin-local)
- **Source plan:** `docs/plan-youtube-vimeo-embed.md` (Phase 1 — Parser Module)
- **Maturity target:** MATURE (pure, fully unit-tested support module)

## Preflight

Read before implementing (plugin-internal change):

- `packages/plugins/ARCHITECTURE.md`
- `docs/plugin-architecture.md`
- `docs/block-types.md`
- `docs/plan-youtube-vimeo-embed.md`

## Purpose / risk retired

Provide one deterministic parser that classifies a video URL and produces the correct
embed URL. Retires the risk of ad-hoc, duplicated, buggy regex scattered across the two
video plugins, and the defect where an invalid or direct-media URL is treated as a valid
embed. This is the SUPPORT module the FEATURE slices (`vid-2`, `vid-3`) consume.

## Scope

New module `packages/plugins/src/common/videoSource.ts`:

- `parseVideoSource(url): ParsedVideoSource` — four-way classification:
  `youtube` | `vimeo` | `direct` | `unknown`, with `embedUrl` (null for unknown) and
  `providerId`.
- `buildEmbedUrl(kind, id, options?)` — inline embed URL.
- `buildBackgroundEmbedUrl(kind, id)` — background-mode embed URL (YouTube
  autoplay/mute/loop/playlist; Vimeo `?background=1`).
- `isDirectMediaUrl(url)` — `.mp4|.webm|.mov|.m4v|.ogg` (case-insensitive, ignoring query).
- `EmbedOptions` type (autoplay/muted/loop/controls/background).

**Ratified amendment (2026-07-28, `VID1-DIRECT-SCHEME-CONTRACT`):** `direct` additionally
requires the URL's scheme to be absent (relative / scheme-relative), `http`, or `https` — a
deviation from `docs/plan-youtube-vimeo-embed.md`'s extension-only rule, ratified by the
operator as a contract amendment. The plan doc's rule 3 now carries the same amendment.
**This is the only amendment to the plan's `direct` rule.** The rule's *output* half is
unchanged and unamended: for `kind: "direct"`, `embedUrl` is the **raw** URL — the caller's
string byte for byte, so `embedUrl === rawUrl` always holds. Whitespace is trimmed to
*classify* the input and the trim does not reach the output (revision 2; § *Revision 2*).

Unit tests covering all four kinds and the plan's testing checklist (youtube watch /
youtu.be / shorts / embed passthrough; vimeo standard / player passthrough; direct .mp4
and .webm-with-query; unknown; empty string).

Add a `test` script and a `vitest` dev dependency to `packages/plugins/package.json`: the
package currently has only `build`/`watch` and the plugins workspace has no test harness
yet — pin `vitest >= 4.1.7` (backend now uses `^4.1.8`, which clears critical advisory
GHSA-5xrq-8626-4rwp; the earlier `^4.0.16` shipped the vulnerable `@vitest/ui`). Do not add
`@vitest/ui` unless a `--ui` workflow is actually needed. Installing vitest triggers the repo
vuln-audit rule (`CLAUDE.md` Definition of Done): after installing, run `npm audit` and
document any high/critical findings.

## Non-scope

- No plugin render or editor changes (those are `vid-2` / `vid-3`).
- No schema change (`url` / `videoSrc` stay plain strings).
- No oEmbed / metadata / thumbnail fetching.
- No `youtube-nocookie` privacy mode (future consideration).

## Architectural boundaries

- Pure, deterministic, **SSR-safe** — no browser APIs, no DOM, no network.
- Lives in `packages/plugins/src/common/`. Must be importable from both the `render`
  (server) and `admin` (browser) plugin entries without violating the plugin split-entry
  rule (`CLAUDE.md` Critical Rule 1).
- No cross-imports between plugins and admin/renderer.
- Platform decisions: not applicable (plugin-local, no tenant data, no auth).

## Migration / deployment notes

None. Package-local; no data migration. Ships in the `plugins` build. Build order:
`shared → plugins`.

## Definition of Done

1. `videoSource.ts` exists with the four exported functions and `EmbedOptions`.
2. Four-way classification correct: youtube, vimeo, direct, unknown.
3. Direct-media detection ignores query params and is case-insensitive.
4. Unknown/empty → `kind: "unknown"`, `embedUrl: null`.
5. Unit tests cover every checklist case in the plan.
6. SSR-safe (no browser/DOM/network references).
7. A `test` script exists in `packages/plugins/package.json` (vitest) and runs the parser tests.

## Evidence required

- `EXECUTED`: `cd packages/plugins && npm test` green (the `test` script added in this
  slice), covering all four kinds and the checklist URLs.
- `EXECUTED`: full workspace rebuild (repo Definition of Done):

  ```bash
  cd packages/shared && npm run build
  cd ../plugins && npm run build
  cd ../../backend && npm run build
  cd ../admin && npm run build
  cd ../renderer && npm run build
  ```
- `OBSERVED`: parser output for each checklist URL matches the plan's expected table.

## Exit criterion

`vid-2` and `vid-3` can import `parseVideoSource` / `buildEmbedUrl` /
`buildBackgroundEmbedUrl` and rely on the four-way classification. No render path needs
its own URL regex after this slice.

## Build run — 2026-07-28

### Files

| File | Change |
|------|--------|
| `packages/plugins/src/common/videoSource.ts` | NEW — the parser. 4 exported functions + `EmbedOptions` / `ParsedVideoSource` / `VideoSourceKind` / `EmbedProviderKind`. **Zero imports** — nothing to make it non-SSR-safe. |
| `packages/plugins/test/videoSource.test.ts` | NEW — 68 tests (65 at revision 0; revision 1 added the discriminating scheme rows). First test file in this workspace. |
| `packages/plugins/vitest.config.ts` | NEW — `include: ["test/**/*.test.ts"]`, node environment. Explicit so the default glob can never widen onto a React/Tiptap `src/` file. |
| `packages/plugins/package.json` | `test: "vitest run"` script + `vitest@^4.1.8` devDependency. |
| `package-lock.json` | See § *Lockfile* — 8 metadata flags + 1 devDep line; **no package added to the tree**. |
| `packages/plugins/ARCHITECTURE.md` | § *Shared modules under `src/common/`* records the new module. |
| `.github/workflows/ci.yml` | New step `Plugins unit tests` in the existing credential-free `build-typecheck-unit` job. |

### Design notes worth reading before `vid-2`

- **RFC 3986 Appendix B, not `new URL()`.** The module decomposes the input with the URI
  spec's own reference regex rather than the `URL` constructor, because `URL` **throws** on
  relative input (`/uploads/clip.mp4`), which the media library legitimately produces. The
  parser's contract is *total* — every string, including `""`, `"://///"` and `"#"`, returns a
  `ParsedVideoSource` and nothing throws — so a constructor that throws cannot be on the path.
  Pinned by 11 adversarial-input tests.
- **Host matching is anchored, not substring.** `host === "youtube.com" || host.endsWith(".youtube.com")`.
  A substring test would classify `youtube.com.evil.example` as YouTube; that mutation is
  exercised below and fails exactly two named tests.
- **Provider ids are validated, not just extracted.** YouTube must be `[A-Za-z0-9_-]{11}`,
  Vimeo `[0-9]+`. A truncated id now yields `unknown` (render nothing) rather than an embed
  URL that loads a dead player. This is the concrete form of the "four-way split" the plan
  asked for: the old inline regex in `VideoRender.tsx` had no `unknown` state at all.
- **`buildBackgroundEmbedUrl` is a separate function, not `buildEmbedUrl(..., {background:true})`.**
  Earned: YouTube's background mode needs four parameters (`modestbranding`, `playsinline`,
  `rel=0`, `iv_load_policy=3`) that are deliberately **not** `EmbedOptions` flags — no caller
  would ever set them individually. Vimeo collapses the same set into its own `background=1`.
- **`EmbedOptions` flags are opt-in.** `buildEmbedUrl(kind, id)` and `buildEmbedUrl(kind, id, {})`
  both return the bare embed URL, which is exactly `parseVideoSource(...).embedUrl`. Only
  `controls` has an "on" provider default, so only `controls: false` emits anything.
- **`embedUrl` is *rebuilt* for providers and *echoed* for `direct`.** For `youtube`/`vimeo`
  it is constructed from the validated id, so nothing of the caller's string survives into the
  attribute. For `direct` the plan fixes it as the raw URL, so it is the caller's string
  verbatim — trimming happens only to classify (the extension regex is end-anchored, so a
  trailing space would otherwise force `unknown`). `vid-2` should read that asymmetry as: the
  provider path is sanitized by construction, the `direct` path is **not**, and encoding what
  goes into `<video src>` is still `vid-2`'s job (§ *Ratified amendment*, scope of guarantee).

### Evidence

| # | Claim | Label | Command / basis |
|---|-------|-------|-----------------|
| 1 | Parser suite green — **68** tests, 1 file, ≈0.14 s (revision 1) | `EXECUTED` | `cd packages/plugins && npm test` → `Test Files 1 passed (1) / Tests 68 passed (68)` |
| 2 | All 10 rows of the plan's original Testing Checklist pass, each as its own named test; the 4 rows the 2026-07-28 amendment added to that checklist pass in `describe("isDirectMediaUrl")` | `EXECUTED` | `npm test -- --reporter=verbose`; `describe("plan checklist — parseVideoSource")` |
| 3 | Parser output equals the plan's expected values for all 10 checklist URLs **and** the 4 amendment rows | `OBSERVED` | table below |
| 4 | Full workspace rebuild green (all 8 workspaces) | `EXECUTED` | `npm run build` — exit 0 |
| 5 | `tsc --noEmit` green across all 8 workspaces | `EXECUTED` | `npm run typecheck` — exit 0 |
| 6 | Suite detects regressions (not a false green) | `EXECUTED` | § *Mutation check* |
| 7 | Adding `vitest` added **zero** packages to the dependency tree | `OBSERVED` | § *Lockfile* |
| 8 | `npm audit` unchanged by this slice: **46 (3 moderate, 43 high)** — same set, no `vitest`/`vite` advisory root. Re-measured at revision 2: identical | `EXECUTED` + `OBSERVED` | `npm audit`; roots enumerated from `npm audit --json` |
| 8a | That 46 is the repo's true audit state, and `docs/TECH-DEBT.md`'s "2 high + 27 moderate" was the stale figure — not the reverse | `EXECUTED` | revision 2: `npm audit` at the repo root → `46 vulnerabilities (3 moderate, 43 high)`. Tracker reconciled, § *Revision 2* |
| 8b | A non-breaking `npm audit fix` clears **none** of the 46, including the two roots npm marks `"fixAvailable": true` | `EXECUTED` | `npm audit fix --dry-run` → 118 added / 45 changed / 1 removed, post-fix metadata still `{moderate:3, high:43, total:46}`; `git status` confirms the lockfile was not mutated by the dry run |
| 9 | The other three CI unit suites still pass | `EXECUTED` | `backend: 51 ✓`, `packages/shared: 40 ✓`, `renderer: 29 ✓` |
| 10 | Lockfile still resolves against the changed `package.json` | `EXECUTED` | `npm ci --dry-run` — exit 0 |
| 11 | CI runs the new suite | `INFERRED` | step added to `build-typecheck-unit`; not run here — no CI trigger from a relay |
| 12 | SSR-safe (no DOM/browser/network identifier) | `EXECUTED` | source-text assertion with a positive control, `total function contract > is SSR-safe` |
| 13 | **Revision 3:** every gate above re-measured green against the current tree — parser 68/68, root `npm run build` exit 0, `npm run typecheck` exit 0, `backend` 51, `packages/shared` 40, `renderer` 29, `infra` 15, `renderer test:serving` 20/20 | `EXECUTED` | commands in § *Revision 3* |
| 14 | **Revision 3:** the parser table is a property of the SHIPPED artifact, not only of the source | `OBSERVED` | table re-derived by `require`-ing `packages/plugins/dist/common/videoSource.js` after a full build; 15/15 rows byte-identical to revisions 1–2 |
| 15 | **Revision 3:** the root lockfile diff is a ratified, metadata-only scope exception | `EXECUTED` | decision `VID1_LOCKFILE_SCOPE` (operator, 2026-07-28), § *Lockfile*; `git diff package-lock.json` = 8 `"peer": true` flags + 1 devDep line, and `grep -c '^+.*"node_modules/'` → `0` |

### Parser output — `OBSERVED`, matches the plan's expected table

| input | kind | providerId | embedUrl |
|---|---|---|---|
| `https://www.youtube.com/watch?v=dQw4w9WgXcQ` | youtube | dQw4w9WgXcQ | `https://www.youtube.com/embed/dQw4w9WgXcQ` |
| `https://youtu.be/dQw4w9WgXcQ` | youtube | dQw4w9WgXcQ | `https://www.youtube.com/embed/dQw4w9WgXcQ` |
| `https://youtube.com/shorts/abc123xyz99` | youtube | abc123xyz99 | `https://www.youtube.com/embed/abc123xyz99` |
| `https://www.youtube.com/embed/dQw4w9WgXcQ` | youtube | dQw4w9WgXcQ | `https://www.youtube.com/embed/dQw4w9WgXcQ` |
| `https://vimeo.com/123456789` | vimeo | 123456789 | `https://player.vimeo.com/video/123456789` |
| `https://player.vimeo.com/video/123456789` | vimeo | 123456789 | `https://player.vimeo.com/video/123456789` |
| `https://example.com/video.mp4` | direct | — | `https://example.com/video.mp4` |
| `https://example.com/video.webm?token=abc` | direct | — | `https://example.com/video.webm?token=abc` |
| `https://example.com/random-page` | unknown | — | `null` |
| `""` | unknown | — | `null` |
| `javascript:alert(1)//clip.mp4` | unknown | — | `null` |
| `data:text/html;base64,AAAA/clip.mp4` | unknown | — | `null` |
| `file:///x.mp4` | unknown | — | `null` |
| `/uploads/clip.mp4` | direct | — | `/uploads/clip.mp4` |
| `⎵https://cdn.example.com/clip.mp4⎵` | direct | — | `⎵https://cdn.example.com/clip.mp4⎵` |

All 15 rows re-measured at revision 2 from the current source; the 14 above the last are
byte-identical to revision 1, so restoring the `direct` output contract changed no row of the
plan's checklist.

**Re-derived at revision 3 from `packages/plugins/dist/common/videoSource.js`** — the emitted
build artifact, not the TypeScript source — after a full `npm run build`. All 15 rows are
byte-identical to the table above. This closes a gap the earlier runs left open: revisions 0–2
measured a `tsc`-on-the-fly copy of the source, so they evidenced *the source*; `vid-2` will
import the **compiled** module, and this run evidences that. The same run also asserted
`embedUrl === rawUrl` per row. Kind counts over the 15 rows: `youtube` 4, `vimeo` 2, `direct` 4,
`unknown` 5. `embedUrl === rawUrl` holds for **4 of 4** `direct` rows — the plan's rule-3
contract, exhaustive over this table — and for exactly 2 of the 6 provider rows, namely the two
passthrough inputs, where the URL rebuilt from the extracted id coincides with the input. That
coincidence is the evidence for "no double-embed", not an instance of the `direct` contract.

Rows 11–14 are revision 1 — the amendment's checklist rows. The first three are the guard
firing; the fourth is the proof it did not narrow legitimate input (the media library's own
root-relative form).

Row 15 is revision 2 (`⎵` = a literal leading/trailing space, shown so the table stays
readable). It is the restored plan contract: the input classifies `direct` **because** it was
trimmed for classification, and `embedUrl` comes back with the spaces still on it **because**
the trim does not reach the output. Both halves fail if either is changed — see mutation 3.

The two provider passthrough rows are worth checking by eye: `embedUrl` is **rebuilt from the
extracted id**, not echoed, and comes out byte-identical to the input — so no double-embed.

### Mutation check

All three rounds **re-run at revision 2** against the current source (the revision-1 hash is
superseded: revision 2 edited the `direct` branch, so a mutation result measured against the
old file would not describe the code under review). Each is a single-line edit to
`src/common/videoSource.ts`, each reverted from a pristine copy and the revert proven by
`shasum -a 256` equality —
`f9e267e74f34f82a21501f0c4771cd980ff764f67e123b98c00b20417a978015` measured as the baseline
and again after each of the three reverts.

| # | Mutation | Result (revision 2) |
|---|----------|---------------------|
| 1 | Delete the non-http(s) scheme guard in `isDirectMediaUrl` | **4 failed / 64 passed** — exactly the four rows labelled discriminating: `javascript`, `vbscript`, `data`, `file` |
| 2 | `isHostOrSubdomainOf` → `host.includes(domain)` | 2 failed / 66 passed — only the prefix- and suffix-confusion rows |
| 3 | `direct` branch `embedUrl: url` → `embedUrl: trimmed` (i.e. reintroduce the deviation revision 2 removed) | **1 failed / 67 passed** — exactly `returns a direct URL verbatim in embedUrl, trimming only to classify it` |

Mutation 3 is the point of revision 2's test change. The revision-1 test asserted the
*trimmed* value, so it passed under both contracts for the checklist inputs and could not
detect which one was implemented. The revision-2 test asserts `embedUrl === rawUrl` on an
input that has whitespace, and additionally asserts `kind === "direct"` — which only holds if
the trim still happens for classification. One test, two directions, and mutation 3 shows it
goes red the moment the plan's contract is violated again.

Revision 0 measured 2 failed / 63 passed on mutation 1, with an honest caveat that the
`data:video/mp4;base64,AAAA` row survived it: that URI's *path* is `video/mp4;base64,AAAA`,
which does not END in `.mp4`, so the extension test rejects it with or without the guard —
a true assertion, but not a discriminating one. Revision 1 closes that gap rather than
merely noting it: `data:text/html;base64,AAAA/clip.mp4` and `file:///x.mp4` both have paths
ending in `.mp4`, so the guard is the only thing rejecting them. The non-discriminating row
is **kept and labelled as such in the test file**, because it is the shape an attacker
reaches for first and a future refactor that widened the extension test from the path to the
whole string would need it.

Mutation 1's failure set is now the executable definition of the ratified amendment: delete
the amendment, and precisely the amendment's own checklist rows go red.

### Lockfile

**Scope exception — RATIFIED 2026-07-28 (decision `VID1_LOCKFILE_SCOPE`).** The root
`package-lock.json` is the one file this slice touches outside `packages/plugins`, CI and the
reconciliation docs. The revision-1 review escalated it against the task packet's "ZERO changes
outside…" constraint; the operator ruled that **wording defective** — an npm-workspace
devDependency cannot be declared without the root lockfile recording it, and CI installs with
`npm ci`, which fails outright when the lockfile and a workspace manifest disagree. The diff
below is authorized **as an ancillary of the permitted `vitest` devDependency**, and nothing
wider: it must stay a metadata-only change with no package added to the tree. That property is
measured, not assumed — see the `grep -c` below.

`npm install` reported **`up to date`** — `vitest@4.1.8` was already in the tree for
`backend` and `packages/shared`, so declaring it in a third workspace resolved to the same
copy. The diff is 10 insertions / 1 deletion and contains **zero new `node_modules/…` entries**
(measured: `git diff package-lock.json | grep -c '^+.*"node_modules/'` → `0`).

The 8 non-obvious lines are `"peer": true` flags npm added to the `lightningcss-*` platform
binaries — vite carries `lightningcss` as an optional *peer*, and the new workspace edge made
npm re-record it as peer-provided. **No entry was removed or changed otherwise**, so the
hand-repaired Linux/win32 platform entries `test-1` added (`docs/TECH-DEBT.md`,
`docs/testing-strategy.md` § *Hazards*) are all still present; `os`/`cpu`/`optional` are
untouched, and `npm ci` installs peers unless `--omit=peer` is passed, which CI does not do.
`npm ci --dry-run` exits 0. **Reviewer note:** the Linux-only failure mode of that lockfile
cannot be reproduced on this macOS host — the claim that CI still installs is `INFERRED`, and
CI itself is the check.

## Ratified amendment

One deviation was raised at revision 0 and **ratified by the operator on 2026-07-28**
(decision `VID1-DIRECT-SCHEME-CONTRACT` = RETAIN). It is no longer a deviation: it is an
amendment to the source plan's `direct` rule, and `docs/plan-youtube-vimeo-embed.md`
§ *Phase 1* rule 3 was edited to carry it, so the plan and the code now agree. Nothing is
pending on it.

- **`isDirectMediaUrl` rejects non-http(s) schemes.** The plan defined `direct` purely as
  "URL ends with `.mp4|.webm|.mov|.m4v|.ogg`". Under that rule `javascript:alert(1)//clip.mp4`
  classifies as `direct` with `embedUrl` set to that string — and `vid-2`'s stated job is to
  put `embedUrl` into a `<video src>`. So the extension-only rule makes a script-scheme
  string the *documented output* of the classifier. The guard requires the scheme to be
  absent (relative / scheme-relative), `http`, or `https`.

  **Ratification rationale (operator):** defence in depth at the classification boundary — a
  script-scheme string ending in a media extension must never classify as `direct`.

  It **tightens** a region the plan left unspecified: no URL in the plan's original checklist
  changes classification, and the relative form the media library produces
  (`/uploads/clip.mp4`) still classifies `direct` (pinned by
  `still accepts the schemes a media library actually produces`).

  **Scope of the guarantee — read before `vid-2`.** This is *not* output encoding and does
  not make the render path safe by itself. It closes one specific hole: the classifier can no
  longer *hand* a non-http(s) string to a consumer as a `direct` embed URL. `vid-2` and
  `vid-3` still own encoding whatever they place in an attribute, because `kind: "unknown"`
  carries `embedUrl: null` but the raw `rawUrl` is still there for editor UI to echo. Logged
  in `docs/TECH-DEBT.md` § *vid-1 residuals*.

## Residuals (deferred, logged in `docs/TECH-DEBT.md`)

- `youtube.com/live/{id}` and the legacy `youtube.com/v/{id}` → `unknown`.
- `youtube-nocookie.com` URLs → `unknown` (privacy mode is explicitly non-scope).
- Vimeo unlisted-video privacy hashes (`vimeo.com/{id}/{hash}`) → `unknown`; the embed needs
  a `?h=` parameter the module does not model. Chosen over emitting an embed that 404s.
- `packages/plugins/tsconfig.json` has `include: ["src"]`, so `npm run typecheck` does **not**
  typecheck `test/`. Same shape as `packages/shared`. Widening `include` would emit test files
  into `dist/`; the correct fix is a separate `tsconfig.test.json`, which is unearned structure
  for one test file today.

## Revision 1 — 2026-07-28 (decision `VID1-DIRECT-SCHEME-CONTRACT` = RETAIN)

The operator ratified the revision-0 deviation as a contract amendment. **No behaviour
changed** — the guard was already in the shipped code and the ratification kept it, so the
parser's classification of every input is identical to revision 0. What changed is that the
plan, the slice doc, the module's own comment and the test file now *say* the same thing, and
the amendment is pinned by tests that can actually detect its removal.

| # | Change | Why it was required |
|---|--------|---------------------|
| 1 | `docs/plan-youtube-vimeo-embed.md` § *Phase 1* rule 3 now includes the scheme requirement, with a dated amendment note naming the decision; § *Testing Checklist* gained the 4 matching bullets | The plan was the source of the extension-only rule. Ratifying the guard without editing the plan would leave the repo's own specification contradicting the shipped code — the next reader of the plan (`vid-2`) would implement to the wrong rule |
| 2 | `docs/slices/…` § *Deviations* → § *Ratified amendment*; status line, Scope, evidence rows 1–3, § *Parser output*, § *Mutation check* all updated | The section said "flagged for ratification" and quoted a "revert cost" — a stale claim about an open question that is now closed. A doc that describes a settled decision as pending is a defect in the same way a wrong name is |
| 3 | `packages/plugins/src/common/videoSource.ts` — `isDirectMediaUrl`'s doc comment no longer calls itself "a DEVIATION … flagged for review"; it cites the decision and the amended plan rule | Same stale-claim problem, in the file a `vid-2` implementer actually opens. It also now states explicitly what the guard does **not** guarantee, so it cannot be mistaken for output encoding |
| 4 | `packages/plugins/test/videoSource.test.ts` — the scheme block became a labelled table: `javascript` / `vbscript` / `data` / `file` with paths ending `.mp4` (discriminating) + the original non-discriminating `data:video/mp4` row, kept and labelled; plus `still accepts the schemes a media library actually produces` | The decision asked for explicit `javascript:` / `data:` / `file:` rows. Revision 0 had no `file:` row at all and its only `data:` row could not detect the guard's removal (§ *Mutation check*). The positive test is the other half of the amendment's claim — "tightens an unspecified region" is only true if the legitimate inputs still pass, and nothing asserted that |
| 5 | Mutation rounds 1 and 2 re-run against the 68-test file; § *Mutation check* renumbered | The revision-0 mutation numbers (2 failed / 63 passed) no longer describe this test file. Carrying them forward would be an `EXECUTED` label on a measurement that was never taken against the code under review |
| 6 | Reconciliation ripple, four docs: `docs/ROADMAP.md` Track A row ("One flagged deviation for ratification" → RATIFIED, 65 → 68 tests); `docs/testing-strategy.md` estate row + §1 status (65 → 68, and the mutation-discipline note); `docs/TECH-DEBT.md` § *vid-1 residuals* (the guard is **not** debt — the uncovered part is); `packages/plugins/ARCHITECTURE.md` module row (the scheme requirement is part of `isDirectMediaUrl`'s contract, so a `vid-2` implementer reading only the package map still sees it) | Every one of these carried either a stale test count or the stale "pending ratification" framing. ROADMAP is where the reviewer looks for what is still open; the package map is where the next implementer looks for the contract |

Not changed, deliberately: the classification logic, the four exported functions, their
signatures, `EmbedOptions`, `vitest.config.ts`, `package.json`, the lockfile, the CI step.
Revision 1 touches two code files and four docs, and the two code files are a comment and
tests.

## Revision 2 — 2026-07-28 (revision-1 review: two required changes)

The revision-1 review confirmed the parser, the boundary compliance and the CI step, and
required two changes. Both are done; nothing else in the slice moved.

### 1. Restored the plan's `direct` output contract

**The defect:** revision 1 carried a **second** deviation from
`docs/plan-youtube-vimeo-embed.md` that nobody had ratified. Rule 3 says that for `direct`,
`embedUrl` is the raw URL; the code returned the *trimmed* string, and the interface comment
had been written to describe that different behaviour rather than the plan's. The revision-1
test pinned the deviation in place. Only the scheme guard was ratified — "everything else
stands" — so this one had no standing at all.

**Why it mattered more than the whitespace.** The whitespace itself is benign: the WHATWG URL
parser strips leading/trailing C0-control and space characters before resolving a `src`
attribute, so neither contract produces a broken element. The real problem was the *shape of
the divergence*. A hand-written comment had become the de-facto specification of a value that
the plan already specified differently, and a test had been written to the comment. That is
how a plan stops being the source of truth — not in one big contradiction, but in a small
one that reads as reasonable and is defended by a green test. `vid-2` and `vid-3` implement
from that plan.

**The change:** `parseVideoSource`'s `direct` branch returns `embedUrl: url`, so
`embedUrl === rawUrl` for every `direct` result. `isDirectMediaUrl` still trims — trimming is
a *classification* step, and it is load-bearing there, because `DIRECT_MEDIA_EXT_RE` is
end-anchored and a trailing space would otherwise force `unknown`. The interface comment now
states the plan's contract instead of describing an alternative to it, and the code comment
records *why* the trim exists and why it stops at the boundary. Test rewritten to assert both
halves; mutation 3 proves it detects a regression.

### 2. Reconciled the dependency-audit documentation

**The defect:** two live documents made incompatible claims about one measurable fact.
`docs/slices/…` and `docs/ROADMAP.md` said `npm audit` reports **46 (3 moderate, 43 high)**;
`docs/TECH-DEBT.md` said **2 high + 27 moderate**. Both cannot be true of one repository, and
a reader has no way to tell which to act on.

**Resolution — `EXECUTED` 2026-07-28, root `npm audit`: 46 vulnerabilities (3 moderate, 43
high).** The slice and ROADMAP figures were correct; the TECH-DEBT figure was stale. So the
tracker was rewritten from the audit rather than the slice claim being softened.

The delta is not drift in one direction, which is why it is worth recording:

| Advisory root | Then | Now (`OBSERVED` 2026-07-28) |
|---|---|---|
| `brace-expansion` | moderate, described as a bundled cdk dependency | **HIGH**, 4 advisories, **36 of the 46 nodes** — the eslint stack (admin + renderer), the infra jest/ts-jest stack, `open-next`, `@node-minify/core`. All dev/build tooling |
| `sharp` | absent | **HIGH** — inherited libvips CVE-2026-33327/-33328/-35590/-35591; installed `0.34.5`, fixed in `>= 0.35.0`; reached via `next` |
| `react-router` / `react-router-dom` | absent | **HIGH** — RSC-mode CSRF bypass; admin's `7.18.1`, fix is `>= 8.2.1` (semver-major) |
| `next-auth` → `uuid` | tracked item 4 | **cleared** — `sec-1`'s bump means `next-auth` declares `uuid: ^11.1.1`; the vulnerable bundled copy is gone |
| `jest` → `js-yaml` (~19 moderates) | tracked item 5 | **cleared upstream** — `@istanbuljs/load-nyc-config` now resolves a patched `js-yaml@3.15.0`. The jest tree is still in the audit, but for `brace-expansion` |

Two findings from doing this that the tracker did not previously state, both now written into
`docs/TECH-DEBT.md`:

- **`npm audit`'s `"fixAvailable": true` is not trustworthy here.** It is set for `fast-uri`
  and `react-router`, yet `npm audit fix --dry-run` — 118 added, 45 changed, 1 removed —
  leaves the count at **exactly 46 (3 moderate, 43 high)**. The tracker's existing "none
  clears with plain `npm audit fix`" is therefore still true, and now has evidence rather
  than assertion behind it. (`--dry-run` wrote nothing: `git status` shows the lockfile diff
  still at the pre-existing 10/1.)
- **`sharp` is the one remaining item with a plausible request-time path.** Everything else is
  lint/test/build/deploy tooling. Next's image optimizer runs `sharp` per request, so whether
  this is live attack surface depends on facts not established here — whether the deployed
  OpenNext bundle ships the image-optimization function, and whether any untrusted image can
  reach it. Recorded as `INFERRED` and made step 2 of the `dep-1` order, ahead of the version
  bumps, because it is what sets their urgency. **Not investigated in this slice** — out of
  scope, and it needs the deployed bundle, not the source tree.

`dep-1`'s ROADMAP scope cell was rewritten to name the current owners (it still listed
`next-auth`/`uuid` and the jest toolchain, both cleared), and both documents now carry an
explicit "re-measure before acting" warning — the underlying cause of this whole item is that
an audit count was treated as a durable fact instead of a dated measurement.

### Not changed

The classification logic other than the `direct` branch's returned value, the four exported
signatures, `EmbedOptions`, `vitest.config.ts`, `package.json`, the lockfile, the CI step, and
the ratified scheme guard. `CURRENT_SLICE.md` untouched — the active priority is unchanged.

## Revision 3 — 2026-07-28 (decision `VID1_LOCKFILE_SCOPE` = exception GRANTED)

**No code changed.** Revision 3 exists to close the slice's last open question and to
re-establish the evidence against the tree as it now stands.

### The decision

The revision-2 review confirmed the implementation and escalated one thing: the root
`package-lock.json` was the only changed file outside the task packet's permitted paths, which
listed `packages/plugins` + CI + reconciliation docs and said "ZERO changes outside" them. The
operator ruled the **wording defective**, not the change: declaring `vitest` as a devDependency
of an npm *workspace* necessarily updates the root lockfile, and CI installs with `npm ci`,
which fails outright when a workspace manifest and the lockfile disagree. Honouring the
constraint literally would have produced a repo that cannot install — so the two binding
requirements could not both be met, and the packet's path list was the one that gave.

The grant is **narrow**: the lockfile diff is authorized *as an ancillary of the permitted
devDependency*, not as general licence to touch the root. Recorded in § *Lockfile* with the
property that keeps it narrow stated as a measurement rather than a promise — 8 npm-generated
`"peer": true` flags plus 1 devDependency line, and `grep -c '^+.*"node_modules/'` → `0`, i.e.
**no package entered the dependency tree**.

### What was re-measured, and why re-measuring was not ceremony

Revisions 0–2 each edited the tree after their own measurements, so the numbers carried forward
described earlier states of the code. Everything in § *Evidence* was therefore re-run against
the current tree; all of it is green and unchanged (row 13).

One measurement was **improved**, not merely repeated. The parser output table had always been
derived from the TypeScript source. `vid-2` and `vid-3` will import the *compiled* module, so
the table was re-derived at revision 3 by `require`-ing
`packages/plugins/dist/common/videoSource.js` after a full root build — 15/15 rows byte-identical
(row 14). The gap this closes is small but real: a `tsc` configuration fault could in principle
make the shipped artifact differ from the source that the tests exercise, and nothing in the
slice had evidenced otherwise.

### Not changed

Every source file. `videoSource.ts`, `videoSource.test.ts`, `vitest.config.ts`,
`package.json`, `package-lock.json`, and the CI step are byte-identical to revision 2. Revision 3
touches documentation only: this section, the status line, § *Lockfile*, § *Parser output*,
three evidence rows, the `docs/ROADMAP.md` Track A row, and the `docs/testing-strategy.md`
estate row. `CURRENT_SLICE.md` untouched — the active priority is unchanged.

## References

- `docs/plan-youtube-vimeo-embed.md` — Phase 1 (Parser Module, incl. the 2026-07-28 scheme
  amendment to rule 3) + Testing Checklist.
- `CLAUDE.md` — Critical Rule 1 (plugin split entry), Definition of Done (rebuild order).
- `packages/plugins/ARCHITECTURE.md` — § *Shared modules under `src/common/`*.
- `docs/testing-strategy.md` §1 (unit layer), §7 (CI ordering).
