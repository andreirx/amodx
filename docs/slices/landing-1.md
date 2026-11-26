# LANDING-1 — a page without the site's header and footer

Status: **PLANNED (draft 2026-11-20, not ratified)**. Track: growth. Depends: none.

## Purpose

An advertising landing page has no menu and no footer links. The page editor has the two switches
(`hideNav`, `hideFooter`: `packages/shared/src/index.ts:390-392`; `admin/src/pages/ContentEditor.tsx:212-213`),
and they are done with a style rule (`renderer/src/components/SitePage.tsx:704-710`):

```
nav, .site-navbar { display: none !important; }      footer, .site-footer { display: none !important; }
```

What is wrong with it:

- The top bar and the commerce bar are plain `<div>` elements (`TopBar.tsx:13`, `CommerceBar.tsx:122`); they
  stay on a "no navigation" page. (INFERRED from the markup; the slice shows it on staging first.)
- The rule hides every `<nav>` and `<footer>` element on the page, also inside the page's own blocks.
- The hidden header and footer are still sent in the HTML, links included.

## Scope

1. One class on the layout's own chrome wrapper per part (top bar, commerce bar, navbar, footer); the page's
   style rule names those classes only. No element selector.
2. `hideNav` hides the top bar, the commerce bar and the navbar. `hideFooter` hides the footer. Labels in the
   editor say exactly that.
3. The cookie banner, the popups and the quick-contact button stay; a third switch is not added until a client
   asks.

Not in scope: leaving the chrome out of the HTML. The layout cannot see the page (the same limit as
LANG1-HTML-LANG in `lang-1.md`); if the `lang-1` spike gives the layout a way to know the page, this follows.

## Evidence taxonomy

Both switches off → page bytes unchanged (serving suite, zero changed captures). `hideNav` → none of the three
bars visible at 1280 px and 390 px; a `<nav>` inside a block stays visible. `hideFooter` → the site footer
hidden; a `<footer>` inside a block stays visible.

## Exit criterion

A staging landing page shows only its own blocks, on desktop and on a phone.

---

## Build record — 2026-11-26 (LANDING-1 selection packet)

**Status: BUILT; maturity: PROTOTYPE, pending operator gates.** This append-only record preserves the draft above.
The selection packet authorizes implementation and replaces the draft's "zero changed captures" assertion with
A1: only four chrome-root class additions are permitted. No deployment or production-maturity claim is made.
The roadmap uses the packet's required `BUILT` status, not a new lifecycle definition.

### Implementation and preservation

- OBSERVED: before editing, deterministic `git grep` over tracked source found `site-navbar` / `site-footer` only
  in SitePage's rules (neither marked an element). JSX references to TopBar, CommerceBar and Navbar were confined
  to `renderer/src/app/[siteId]/layout.tsx`. No existing identifier was renamed.
- The existing outer elements now carry `site-top-bar`, `site-commerce-bar`, `site-navbar`, `site-footer`.
  The first three are the components' own root elements mounted by the layout; the footer is owned directly by
  the layout. No new wrapper, prop, schema, dependency, route, tenant read, API/MCP field or switch is introduced.
- `hideNav` selects `.site-top-bar, .site-commerce-bar, .site-navbar`; `hideFooter` selects `.site-footer`.
  Both keep `display: none !important`. No element selector remains in these rules. Desktop and open mobile
  Navbar content stay inside its root. The existing CommerceBar is desktop-only (`hidden md:block`); no new
  mobile commerce bar is introduced.
- Admin labels: **Hide top bar, commerce bar and navigation** / **Hide site footer**. Persistence and reset unchanged.
- Cookie banner, popup and quick-contact mounting conditions are unchanged. Hidden chrome remains in the HTML.
  No privacy, access-control or HTML-removal guarantee is implied by these presentation switches.
- VISION alignment: a bounded, reversible presentation change for independent tenant sites; no persistence,
  tenant-isolation or caching-policy change. Rollback is the code revert; no migration is needed.

### Test binding and limits

| Row | Bound test / artifact | Proof boundary |
|---|---|---|
| A1 | `renderer/test/unit/landing-1.test.ts`, three `A1` tests; `landing-1-before.json` | Real SitePage + layout + TopBar/CommerceBar/Navbar, headless SSR. Frozen before output from `d8f3d1a`; only exact class additions allowed. Content, commerce, editorial shapes. Clock fixed to 2026. |
| A1 captures | `renderer/test/unit/landing-1-expectations.test.ts`; `renderer/test/serving-contract/landing-1-capture-lines.json` | Every expected-set capture, its exact relative file, tenant, path, original source attribute line numbers and HTML/Flight addition counts. Not a fresh-build capture. |
| A2 | `A2` selector test and open-mobile/desktop-dropdown test in `landing-1.test.ts` | Exact three-class selector; block nav is not matched or under a matched ancestor. Real Navbar menu states remain under its marked root. |
| A3 | `A3` selector test in `landing-1.test.ts` | Exact footer-class selector; block footer is not matched or under a matched ancestor. |
| A4 | `A4` selector test in `landing-1.test.ts` | Both exact rules present; all four chrome roots remain in HTML. |
| A5 | Three `A5` tests in `landing-1.test.ts` | Both bars absent, only the commerce bar absent, or only TopBar absent: no error; rules unchanged. |
| Labels | `admin/src/pages/ContentEditor.test.ts`, `LANDING-1` test | Source-level binding of each English label to its existing checkbox and update field. |

The page/layout tests replace DynamoDB and Next runtime modules. Block output and cookie/popup/quick-contact slots
are sentinels; their presence and selector ancestry are tested, not their own implementation or browser appearance.
The menu-state test mounts the real Navbar in jsdom. Neither jsdom nor SSR proves responsive geometry or visibility
through the deployed CSS. The operator's staging proof at **1280 px and 390 px** remains the acceptance gate.

### A1 expected capture changes (operator-run)

Historical `.body` files are **not edited or re-captured**. `landing-1-expected.mjs` composes the existing
HYDRATION-1 expected-data derivation, then appends only the four frozen class markers to the exact recorded root
attributes. Candidates and the CM1/locale comparison masks are unchanged. The changed current tag literals in
`contract.test.mjs` and the four older unit suites now require the same root markers; no assertion is removed.

OBSERVED from the no-server expected-data derivation: **844** responses enumerated, **699** have class additions,
**145** are unchanged. Full, machine-readable enumeration (including zero-change responses):
`renderer/test/serving-contract/landing-1-capture-lines.json`. Paths there are relative to
`renderer/test/serving-contract/`; `sourceAttributeLines` gives original 1-based physical lines holding each
changed attribute. `additions` distinguishes HTML and decoded Flight. Stream chunk cuts in derived data are not
new comparison allowances: the existing CM1 comparison already joins them.

| Marker | HTML additions | Flight additions | Why |
|---|---:|---:|---|
| `site-navbar` | 647 | 0 | Navbar renders its root in client-component SSR; no prop is added. |
| `site-footer` | 647 | 699 | Server footer element is also encoded in Flight, including 52 error/handoff shells without its HTML. |
| `site-top-bar` | 8 | 8 | Present only in the eight recorded tenants/pages with TopBar; it is a server component. |
| `site-commerce-bar` | 8 | 0 | Present in eight recorded pages; client-component root, unchanged props. |

When a tenant omits a bar, that bar contributes **zero changed attributes**: no empty wrapper is added. Normal
site-layout pages still change at Navbar/footer. The inventory's 145 responses without a chrome root are byte-
identical after this derivation (non-page responses and missing-tenant shells). A missing bar does not alter the CSS
rule. Missing/changed marker and unrelated HTML/Flight mutations remain visible to both comparison families;
`landing-1-expectations.test.ts` supplies positive controls and rejects ambiguous duplicate root lookalikes.

Test-support abstraction: `landing-1-expected.mjs`; current users = serving historical comparisons and the
no-server expectation tests; concrete variation = existing capture generations' HTML/Flight chrome attributes;
rejected simpler alternatives = rewriting immutable capture evidence or widening candidate masks.

### Validation

Gate results are appended below after execution. Operational output lives only in
`.agent-manager/slices/landing-1/` (gitignored).

**Operator-run, NOT RUN by this builder by packet instruction (not failed gates):**
`npm run build`; `npm --prefix backend run test:unit`; `npm --prefix tools/mcp-server test`;
`npm --prefix renderer run test:serving`; `npm --prefix renderer run test:serving-bundle`; staging browser proof.
Expected: build succeeds, suites pass, serving comparisons allow only the listed marker additions, and A2–A4
visibility plus block nav/footer preservation holds at both widths. No socket, local server or AWS proof was run.
The existing MCP tool accepts `hide_nav` / `hide_footer` and maps them to `hideNav` / `hideFooter`; code/schema
shape is unchanged (source check recorded with the final validation). No package was installed; no dependency audit
is required for this diff.

A1 additional client-state expectations (historical file unchanged):
`renderer/test/unit/locale-1d-client-before.json` **lines 59–60** (`commerce-bar`, two states) gain only
`site-commerce-bar`; **lines 63–66** (`navbar-account`, four states: signed out/in, menu shut/open) gain only
`site-navbar` in the expected side of `locale-1d-client.test.ts`. Candidate markup is still compared in full.
A5 also covers a commerce tenant with only TopBar absent; its commerce marker and rule stay unchanged.
The three new headless before captures are `landing-1-before.json` lines 2–4 (content, commerce, editorial);
the A1 tests add respectively Navbar/footer, all four roots, and TopBar/Navbar/footer to their expected attributes.

### Executed gate results and review

All commands below were run bare in the foreground; final exit codes were read. Expected result for each is exit 0.
Logs are relative to `.agent-manager/slices/landing-1/`.

| Exact command | Final actual result | Evidence |
|---|---|---|
| `npm run typecheck` | Exit 0; all eight workspaces | EXECUTED — `typecheck-final.log` |
| `npm --prefix packages/shared test` | Exit 0; 30 files, 599 tests passed | EXECUTED — `shared-final.log` |
| `npm --prefix renderer test` | Exit 0; 59 files, 917 tests passed | EXECUTED — `renderer-final.log` |
| `npm --prefix admin run test:unit` | Exit 0; 23 files, 408 tests passed | EXECUTED — `admin-final.log` |

Earlier attempts (resolved, not hidden): the temporary before-capture writer needed a file path under jsdom;
typecheck found a missing required cart-provider input in that test fixture (now explicit, byte-equivalent empty
test prefix); the first candidate renderer run found two stale client-capture expectations (now exact expected-only
class additions). No production behaviour or acceptance criterion was weakened to pass these checks.

OBSERVED headless product output: A2 emits exactly
`.site-top-bar, .site-commerce-bar, .site-navbar { display: none !important; }`; A3 emits exactly
`.site-footer { display: none !important; }`; A4 emits both. Selector queries find only the intended chrome roots.
The block-output nav/footer and all three retained-slot sentinels are present and outside selected roots. A5 emits
the same rule with missing bars. A1 matches all frozen before bytes except the enumerated class additions.
These are source-driven headless executions, not a built Next/OpenNext server or staging visibility proof.

OBSERVED MCP source check: `tools/mcp-server/src/index.ts:901-902` accepts the two snake-case switches;
`:916-917` copies them to the existing camel-case payload fields. No MCP change is needed for this slice.

Self-review: production changes remain four root class additions, two CSS selectors and two editor labels.
The only support module is test-only and closes repeated expected-data changes across existing capture sets.
The line inventory is required A1 evidence, not a new runtime configuration. No existing functionality is removed;
no new abstraction, boundary, dependency edge or data shape is introduced in production. No isolated state root,
worktree or proof directory was created; only the required gitignored operational directory persists. No commit,
stash, reset, server, staging mutation or package installation was performed. Acceptance remains operator-owned.

- EXECUTED `git diff --check`: expected exit 0; actual exit 0, no output. Evidence:
  `.agent-manager/slices/landing-1/diff-check.log`. This check covers tracked diffs; new fixture/test files were also
  read during the self-review and are exercised by the passing renderer suite.

## Operator closeout (2026-11-26)

- Models: builder `gpt-6.1-sol`, reviewer `gpt-6.1-terra`; one review cycle, approved. The build, the full backend unit
  suite, the MCP test and both serving suites are **operator-executed** (the builder's sandbox cannot bind a port).
- Operator gates (log read, exit codes bare): build, typecheck, shared, plugins, renderer, serving, serving bundle,
  admin unit, backend unit, infra, MCP, `git diff --check` — all 0.
- Staging diff, read before the deploy: no resource added or removed; renderer functions and site assets by code only.
- Staging, in a browser at 1280 px and 390 px, tenant `cm1-commerce` with the top bar and the commerce bar switched on
  for the check (settings restored after; the two probe pages removed):
  - control, home page: the top bar, the commerce bar (1280 px; it is a desktop-only bar), the menu and the footer are shown;
  - a page with both switches: the four parts are hidden at both widths; the page answers 200 with its own title;
  - a page with "hide navigation" only: the three bars are hidden, the site footer is shown.
- The first run of the check passed without the two bars on the page (the test tenant had neither); it was repeated
  with both bars on, because those two bars are the defect this slice fixes.
- Not observed on staging: a `<nav>` or `<footer>` inside a page block staying visible (no block of the test tenant
  holds one); proven by the unit rows A2 and A3.
