# HYDRATION-1 — tenant pages hydrate without an error

- **Status:** IN_PROGRESS, 2026-11-26 — revision 2 re-ran the unchanged candidate and required gates. Build and MCP remain execution-failed on sandbox EPERM; other builder gates pass. Review-1 cannot be closed in this runner. BUILT is withheld under the operator ruling.
- **Track:** serving-layer maintenance.
- **Depends:** none. The operator's settled cause and experiment are the input, not re-investigated here.
- **Source plan:** HYDRATION-1 selection packet, 2026-11-26 (no separate plan file).
- **Maturity:** targets MATURE; not a production-validation claim.

## Purpose / risk retired

The packet records one uncaught React #418 (`HTML`) on every tenant page with sharing on. `SocialShare` returned
`null` on the server but a `div` in the browser's first render. Without an enclosing Suspense boundary, React replaced
the server document. Its guard prevented an SSR exception; it did NOT make hydration safe. The misleading
“Safety check for SSR” comment is removed.

This serves `docs/VISION.md`'s reliable multi-tenant product guarantee: keep the rendered tenant document instead of
regenerating it on load, and share that tenant's public canonical address, not the preview host.

## Scope and fix

OBSERVED in source:

- `SitePage.tsx` now uses one local `normalizePageAddressOrKeepRaw(domain, slugPath)` function in metadata and in the render
  path's JSON-LD/share data. For parseable inputs it returns the same WHATWG-normalized string that Next emits (root without a trailing slash when there is no query). The accepted JSON-LD spelling changes follow that same value. `SocialShare` requires its result as a raw
  string prop, renders immediately on the server and browser, and uses it for all four links and the copy handler.
  It no longer imports `usePathname` or reads `window` during render. Text, classes and visibility conditions stay.
- `CategoryShowcaseRender` initially uses injected prefixes or `/product` and `/category`. Its existing document-meta
  fallback is now read in an effect. Injected prefixes still win after mount.
- `useTenantUrl` initially uses the pathname only. Its existing preview-cookie fallback is now read in an effect.
  A preview pathname still wins over the cookie; its effect returns before reading or decoding the cookie, including malformed percent-encoding. Its consumers include `Navbar`, `InterestWidget` and plugin links
  reached through `RenderBlocks`; the H4 test drives the real `InterestWidget`.

Non-scope: no visibility, text, style, cookie-banner behaviour, middleware, caching-header, infrastructure,
dependency, or Suspense change. No existing production identifier was renamed across a boundary. The old SocialShare test title said “rendered in the browser only”; it now says “browser render”, and its six coverage-index references move with it. This is a local test-name correction, not a stored product identifier change.

### Canonical basis

| Case | Value and basis (OBSERVED code, headless tests EXECUTED) |
|---|---|
| Tenant domain | Normalize `https://${config.domain}` plus the public slug through WHATWG URL; emit its origin for a root path without query, otherwise its href (the installed Next rule). Hostname case, Unicode encoding and root spelling therefore match Next. `buildSitePageMetadata` puts this result in `alternates.canonical`. `getTenantConfig` maps `Domain || domain`; `TenantConfigSchema` requires `domain`; tenant creation uses `${id}.localhost` when no domain is supplied. This existing placeholder is not replaced with a preview origin. |
| Preview `/_site/<id>/about` | The dynamic route resolves config by ID, passes `basePath` separately, and passes public `slug = ["about"]`. The canonical remains `https://<tenant-domain>/about`; neither `basePath` nor the preview origin is an input. |
| Extra language `/ro/despre` | The route strips the internal `~<lang>` segment from `siteId`, not from `slug`. The canonical is `https://<tenant-domain>/ro/despre`. `hreflang` generation is unchanged. |

H1 resolves the real metadata with the installed Next 16.4.6 `resolveAlternates`, renders its
`createMetadataElements` output, and reads the resulting canonical link from that HTML. It checks six cases:
root, domain page, preview by tenant ID, extra language, Unicode path and mixed-case hostname. The same test
checks all four share hrefs and the JSON-LD URL (the test replaces Next Script with an inert script to inspect
its exact JSON string). H2 copies the encoded Unicode canonical, unchanged.

### Review-0 corrections and operator ruling

**HYDRATION1-CANONICAL-NORMALIZATION = option 1**, ratified in the revision-1 packet, 2026-11-26.
JSON-LD representation changes for mixed-case hostnames and non-ASCII paths are accepted. The old verification
boundary was defective: comparing a raw metadata DTO did not test the serializer that writes the canonical.
Correction rule: test the emitted canonical HTML, including normalizing inputs, and require the same string in
metadata, share links, copy and JSON-LD. Production code uses WHATWG URL, not a Next-internal import; only tests
use installed Next's resolver and element generator to check the delivery boundary.

| Input | Common normalized value / emitted canonical |
|---|---|
| tenant.test, /ro/despre | https://tenant.test/ro/despre |
| tenant.test, /ro/întrebări | https://tenant.test/ro/%C3%AEntreb%C4%83ri |
| Tenant.TEST, /about | https://tenant.test/about |

**Normalization failure policy (local preservation decision):** if the interpolated address cannot be parsed,
keep that exact pre-existing raw value. Do not throw from the page render and do not invent a different origin.
The helper name `normalizePageAddressOrKeepRaw` states this fallback; its old local name is not a published API.
The malformed-host test uses `https://[/about`: WHATWG parsing throws, but the real SitePage render completes and
retains that raw value in the share/JSON-LD data. This does NOT claim a valid canonical for malformed tenant
configuration or change the existing metadataBase validation (which still rejects an invalid domain when metadata
is generated). Valid domain/preview/language cases all have a canonical; no substitute canonical was guessed.

**Additional correction:** fallback work must be conditional on the absence of the authoritative input. The
`useTenantUrl` effect returns immediately for a preview pathname. H4 stores a malformed `%E0%A4%A` cookie and
uses a throwing cookie getter to prove that no read occurs, not merely that a decoding exception is caught.
The existing cookie-only fallback and pathname precedence cases remain bound.

### Abstraction record

- Local address normalization/fallback function — users: metadata builder and JSON-LD/share render path; axis: the existing domain/public-slug canonical policy for tenant, preview and language routes; rejected: duplicated formula (packet requires the SAME function). No new module or port.
- Test-local hydration helper — users: SocialShare, showcase, InterestWidget tests; axis: browser globals absent at SSR versus present at hydration, including custom meta/cookie state; rejected: repeating the error-capture and retained-node checks.
- Expected-capture derivation — users: CM1 identity and locale-1 historical comparisons; axis: recorded share props with/without locale strings across their existing capture generations; rejected: overwriting historical captures or masking candidate output. It changes EXPECTED data only.

## Item-3 audit

Search EXECUTED from repo root:

```sh
rg -n 'window|document|navigator|localStorage|Date\.now\(|Math\.random\(' renderer/src packages/plugins/src
```

Basis: deterministic text search of these two source trees, followed by reading the hit's component/helper and its
call site. This is not an AST proof that no alias, computed property access or other nondeterminism exists.
Line numbers below identify the pre-change packet/search positions.

| Read | Can change first hydration output? Verdict and basis |
|---|---|
| `SocialShare:16,18` | **Yes; fixed.** Server `null`, browser `div`; browser origin also differed from canonical on preview. Required canonical prop replaces both reads. `navigator.clipboard` stays in the click handler. |
| `InterestShortlist:47` (and `storeFor:39`) | **No; unchanged.** Store differs, but `useSyncExternalStore` uses the constant `SERVER_STATE` via `getServerSnapshot` on the server AND during hydration. Store methods are used by events/effects; rendered item/count/notice data comes from the snapshot. |
| `CategoryShowcaseRender:179,182` | **Yes when injected prefixes are absent and document meta differs from defaults; fixed.** Both hrefs could differ. Meta reads now occur after mount; H4 covers both prefixes, absent and present injected values. |
| `ContactRender:18,20,23,45` | **No; unchanged.** Token helper is called only from `handleSubmit`; tenant read is in that handler. |
| `LeadMagnetRender:14,16,19,40` | **No; unchanged.** Same submit-only token/tenant path. |
| `PostGridRender:59,60` | **No; unchanged.** In `useEffect`; initial host is the same `serverDomain || ""` prop-derived state. |
| `CommentsSection:40,66` | **No; unchanged.** Fetch effect and submit handler. Initial comment list is empty. |
| `CookieConsent:53,74,95,109` (four guards) | **No; unchanged.** `getStoredConsent`/expiry run in the mount effect; visitor ID, storage write and global dispatch run from the choice handler. Both first renders return `null` (`isClient=false`, `showBanner=false`). |
| Other cookie reads: `:37,41,44,56,59,60,69,77,84,99,104,111,114,129,130` | **No; unchanged.** Consent hook effects/listeners or helpers reached from effect/choice only. Clock, random visitor ID and user agent never enter first-render markup. |
| `lib/routing.ts:21,22`, through `useTenantUrl` consumers | **Yes with a cookie-only preview fallback; fixed.** Cookie-derived hrefs could differ from server hrefs. Cookie state now arrives after mount; H4 checks the real widget, cookie fallback and pathname precedence. |
| `Navbar:125,133,147–160`, `SearchBar:65,66`, `PopupManager:108–133`, `ProductImageGallery:62–83`, `QuoteRequest:93–102`, `InterestShortlist:98–105` | **No; unchanged.** Effects, their callbacks/cleanup or dialog-open handler; state has a deterministic initial value. |
| `PaddleLoader:14–18`, `CartContext:88–106`, `useRecaptcha:16–22`, `lib/fbpixel:13,14`, `AccountPageView:211` | **No; unchanged.** Script-load callback, effects, execute/track event helpers, reload button. |
| `DynamicForm:46–48`, `CodeBlockRender:47–56`, `EffectPreview:74` | **No; unchanged.** Submit-only token helper, copy handler, GPU-check effect. |
| `Analytics`, `FBPixel`, `ThemeInjector`, `ReferralCapture` | **No; unchanged.** Reads appear inside emitted script text, not component execution. Same script string in both renders. |
| Booking `BookFlow:36`, `_components/api.ts:9`, `ManageView:49` | **No; unchanged.** reCAPTCHA submit helper; API helper called from effects/actions; token read in effect. |
| Booking `ManageView:102` | **No in the owning page's hydration; unchanged.** `refusalBlock` reads location only after an effect/action sets a refusal; initial mode is loading, which renders no recovery link. |
| Booking `Pickers.tsx:27` (`SlotWeek`) | **No in the current server tree; unchanged.** The clock can change the displayed week if independently server-rendered, but neither caller mounts this picker during SSR/first hydration: BookFlow first waits for the offer effect, ManageView first waits for the token/view effect and a move action. It mounts only in the browser. No claim of standalone deterministic SSR for this picker. |
| `PostGridEditor:47` | **No tenant hydration path; unchanged.** Random datalist ID is in an admin-only Tiptap NodeView, not the split render entry. It is browser-mounted, not server-hydrated. |
| `TableEditor:66` | **No; unchanged.** New row ID is made inside the add-row event helper. |
| `lib/tenant-directory:122`, API `revalidate:172,238`, non-executable comment hits | **Not component render reads; unchanged.** Host-cache clock, API response timestamps, or prose. |

## Tests and expected serving data

| Row | Binding |
|---|---|
| H1 | `renderer/test/unit/hydration-1-server.test.ts`: real metadata through installed Next resolver + emitted canonical element HTML; real SitePage links and JSON-LD equal that string for root/domain/preview/language/Unicode/mixed-case cases. Also checks non-throwing page-render fallback for unparseable input. |
| H2 | `hydration-1-client.test.ts`: browser globals absent during `renderToString`, then `hydrateRoot` with recoverable and console errors captured; zero errors, same node and markup; copy writes the canonical prop. |
| H3 | `hydration-1-server.test.ts`: each visibility flag independently removes the block. Conditions in SitePage are unchanged. |
| H4 | `hydration-1-client.test.ts`: same hydration harness, two showcase cases and three real-widget routing cases (including an unread malformed cookie); post-mount fallback and injected/pathname precedence checked. |

EXECUTED negative controls: each affected source was replaced temporarily by its HEAD version, tested, then restored
in `finally` without stash/reset. H2 failed on the original null/div mismatch. H4 failed on showcase href mismatch
without injection and on cookie-derived widget href mismatch. Injected-prefix and pathname controls stayed green. Revision 1 re-ran these controls, plus raw-normalization and unused-cookie-read controls; all five negative variants failed as required, and each source was restored in `finally` with SHA-256 equality verified.
Operational logs are in `.agent-manager/slices/hydration-1/negative-*.log`.

### Derived lines that legitimately move (operator-run serving validation)

No historical `.body`, index, client-module map, or existing canonicalisation is edited. `contract.test.mjs` reads
historical EXPECTED captures through `hydration-1-expected.mjs` instead of the raw reader. Only the following derived changes are permitted:

1. Fill its existing empty wrapper with exactly `hydration-1-share.html`, substituting the recorded title and locale
   texts, and the captured canonical link address. The template freezes existing markup/classes/icons, not a runtime
   call to the implementation under test.
2. Add only `url: <canonical>` to that SocialShare element's payload props (between `title` and `strings`).
3. Normalize only the root `url` string of `json-ld-schema` to the recorded emitted canonical. Validate that the old
   value is an alternate WHATWG spelling of that canonical, not an unrelated address. This applies even with sharing
   hidden. Do not change nested `url`, `sameAs`, other fields, script IDs or other JSON-LD scripts.
4. Leave everything else compared, including texts, other HTML and all other props. No share element and no root
   JSON-LD normalization change → unchanged bytes.

The reconstruction joins payload chunks and re-emits them as one chunk; this is already immaterial under the existing
stream-cut canonicalisation. The production candidate is NEVER transformed. Missing canonical, unexpected share props,
or missing/ambiguous empty wrapper fail the derivation. `hydration-1-expectations.test.ts` checks all eight reader sets,
EN/RO template equality, missing-input failures and four mutations that must remain visible to the byte detector.
Revision 1 adds sharing-on/off synthetic captures with a mixed-case Unicode JSON-LD URL, checks root-only changes,
preserves nested URLs and sameAs, and checks that a wrong candidate JSON-LD URL remains detectable.

**JSON-LD derived-line enumeration:** the current recorded sets below use lowercase ASCII domains and paths for
`json-ld-schema`; therefore **zero recorded JSON-LD lines change** after normalization. The permitted additional
line on an affected future/operator capture is exactly `json-ld-schema.dangerouslySetInnerHTML.__html`'s root
`url` member. Example: `https://Tenant.TEST/ro/întrebări` →
`https://tenant.test/ro/%C3%AEntreb%C4%83ri`. Current captures carry this JSON-LD in the RSC Script props, not an inline
server script. The existing A–E share delta below is unchanged. No historical capture was edited.

The following table enumerates the changed tenant/path lines. Names refer to capture tenant keys, not live tenants.

| Group | Tenant → paths |
|---|---|
| A (8) | commerce → `/`, `/about`, `/stale-showcase`; content → `/`, `/about`; catalog → `/`, `/about`, `/stale-showcase` |
| B (8) | fixture-tenant → `/`, `/published`, `/d4-page`; wk → `/index.php`; iso-a → `/`, `/about`, `/listed-post`; iso-b → `/about` |
| C (8) | roContent → `/`, `/about`; roCommerce → `/`, `/about`, `/stale-showcase`; roCatalog → `/`, `/about`, `/stale-showcase` |
| D (2) | shopFallback → `/`; shopOwn → `/` |
| E (3) | editorial → `/`, `/about`; footerOnly → `/` |

Relative to `renderer/test/serving-contract/`:

| Expected reader set | Derived lines |
|---|---|
| `cm1-byte-identity/baseline` | A |
| `cm1-byte-identity/control-de4ad52` | A (old hardcoded English texts when `strings` absent) |
| `locale-1/cdl-2/before` | A + B + C + D + E |
| `locale-1/variant-gallery-1/before` | A + B + C + D + E |
| `locale-1/theme-1/before` | A + B + C + D + E |
| `locale-1/quote-1/before` | A + B + C + D |
| `locale-1/1e/before` | A + B + C |
| `locale-1/1e/before-404` | None |

## Architectural boundaries

No new production module, package edge, I/O port or schema. Local canonical string crosses the existing server/client
prop boundary as raw data. Plugin render/admin split stays intact. Tenant isolation and no-scan rules are unaffected.
See `renderer/ARCHITECTURE.md`, `packages/plugins/ARCHITECTURE.md`, `docs/frontend-patterns.md`,
`docs/testing-strategy.md`, `docs/platform-decisions.md`.

## Validation evidence — revision 1

The required bare commands were run in packet order. Expected exit for each gate: 0. All results below are
**EXECUTED**, not carried forward from revision 0. Evidence paths are relative to
`.agent-manager/slices/HYDRATION-1/`; incremental results are in `build-progress.md`.

| Command | Actual exit / result | Evidence |
|---|---|---|
| `npm run build` | 1, execution-failed at renderer CSS worker port bind | `r1-build.log`, `r1-turbopack-panic.log` |
| `npm run typecheck` | 0, all eight workspace checks passed | `r1-typecheck.log` |
| `npm --prefix packages/shared test` | 0, 599 tests passed | `r1-shared-test.log` |
| `npm --prefix packages/plugins test` | 0, 355 tests passed | `r1-plugins-test.log` |
| `npm --prefix renderer test` | 0, 904 tests passed, including 28 HYDRATION-1 tests | `r1-renderer-test.log` |
| `git diff --check` | 0, no whitespace errors | `r1-diff-check.log` |
| `npm --prefix tools/mcp-server test` | 1, execution-failed before test body: tsx IPC pipe listen EPERM | `r1-mcp-test.log` |

The build failure is Turbopack processing `swiper.css`: creating a process → binding to a port →
`Operation not permitted (os error 1)`. Shared/effects/plugins/backend/admin build steps completed; renderer failed;
MCP/infra build steps were not reached. No fresh full renderer build is claimed. No alternate bundler, permission
change or environment bypass was used. The MCP test similarly stopped before route coverage/tool-shape tests could
run. This renderer-only slice changes no backend route or MCP schema; route coverage is not claimed.

The first revision-1 typecheck found a test-only `metadataBase` union argument mismatch. The test now verifies
and narrows the real builder result to URL before calling Next's resolver; subsequent full typechecks pass.
The expected-data test's first run found an incorrectly escaped nested-JSON mutation setup; the mutation is now
applied to the decoded payload and checked to have actually changed it. Neither correction changed product policy.
No backend integration test was run (it uses live staging).

Targeted commands (also covered by the full renderer run):

- `npm --prefix renderer test -- --run test/unit/hydration-1-server.test.ts test/unit/hydration-1-client.test.ts`: 0, 15 passed, `r1-targeted.log`.
- `npm --prefix renderer test -- --run test/unit/hydration-1-expectations.test.ts`: 0, 13 passed, `r1-expectations.log`.

Negative-control logs `r1-negative-*.log` name their exact command and temporary source variant. H2's original
null/div mismatch, original showcase/router href mismatches, raw-normalization mismatch and unused-cookie read
all exit 1 as required. Sources are restored and no negative variant remains in the candidate.

`r1-derived-lines.json` enumerates changed expected bodies and independently compares every root JSON-LD object
across all eight capture sets. No historical captured file or comparison mask is changed.

## Revision 2 — review-1 environment requirement remains blocked

No product, test, expected-data, architecture or command change was made in revision 2. Review-1 requires successful
bare build and MCP executions, not a product correction. Both were tried again in the current runner. Its policy
permits workspace writes but provides no permission escalation; this task cannot grant a different execution policy
or select another runner. An execution denial is NOT a product-test failure or a successful gate.

Every required command below was **EXECUTED again**, in packet order; expected exit is 0. Logs are relative to
`.agent-manager/slices/HYDRATION-1/`.

| Exact command | Actual exit / result | Evidence |
|---|---|---|
| `npm run build` | 1, execution-failed: Turbopack CSS worker port binding denied (EPERM) | `r2-build.log`, `r2-turbopack-panic.log` |
| `npm run typecheck` | 0, passed all eight workspace checks | `r2-typecheck.log` |
| `npm --prefix packages/shared test` | 0, passed 599 tests | `r2-shared-test.log` |
| `npm --prefix packages/plugins test` | 0, passed 355 tests | `r2-plugins-test.log` |
| `npm --prefix renderer test` | 0, passed 904 tests, including all 28 HYDRATION-1 bindings | `r2-renderer-test.log` |
| `git diff --check` | 0, passed | `r2-diff-check.log` |
| `npm --prefix tools/mcp-server test` | 1, execution-failed before test body: tsx IPC pipe listen EPERM | `r2-mcp-test.log` |

A successful full fresh renderer build and MCP coverage are still unverified. The current source tests exercise
SSR share links/JSON-LD equality with Next-emitted canonicals, component hydration without errors, copying the
normalized address, visibility flags and the unread malformed cookie. These are not whole-document browser proofs.
The render-read text search was re-run (`r2-render-read-search.log`); the item-3 verdicts above are unchanged.
Prior negative-control and derived-capture results remain explicitly revision-1 records, not new revision-2 claims.

Review-1 required change 1 remains unresolved; change 2 (BUILT) remains conditional and is not applied. Correctness
rule: a command that fails before completing its gate remains execution-failed; neither test counts nor a change to
the command or candidate may substitute for the required successful execution.

DECISION_REQUIRED:
- ID: HYDRATION1-EXECUTION-ENVIRONMENT
  QUESTION: How will the unchanged build and MCP gates be run with the worker-port and local IPC permissions they require?
  OPTIONS:
  - Redispatch the builder in a permission-capable local runner. Reward: unchanged commands and builder-owned evidence. Risk: broader execution authority must remain scoped to this repository; no staging or installed-environment mutation is authorized.
  - Explicitly reallocate these gates to the operator, who runs the exact commands on the unchanged candidate and provides logs. Reward: no runner-policy change. Risk: the supervisor must accept operator-owned evidence; it must not be labelled builder-EXECUTED.
  RECOMMENDED: Redispatch in a permission-capable local runner, preserving the existing gate allocation.
  BLOCKING_REASON: Fresh build and MCP attempts again fail on EPERM. This runner cannot escalate permissions or obtain the successful executions required by review-1. BUILT would be a false completion claim.

## Operator gates / migration / rollback

NOT RUN by the builder, as allocated by the packet:

```sh
npm --prefix renderer run test:serving
npm --prefix renderer run test:serving-bundle
```

Then repeat the packet's isolated Chromium probe of fixture `cm1-content` at `/` and `/about`: zero page errors,
zero server-document head/body nodes removed during hydration; share block already in server HTML, links/copy equal
the canonical. Run the staging deployment and staging checks through the operator's deployment procedure. No browser,
local-server or staging pass is claimed here. End-to-end coverage is the operator's gate, not replaced by jsdom.

No data migration. Normal renderer deployment; no infrastructure change. Rollback restores the previous renderer
(and its known hydration defect). Do not mark SHIPPED before operator verification and production rollout.

## Definition of Done / exit criterion

Builder: H1–H4 bindings, negative controls, audit table, exact expected-data delta, required command results, and full
diff/reference re-read. Operator: both serving suites, browser retention probe and staging checks. Exit: tenant pages
retain their server document with canonical share buttons present at SSR. Pending operator work is explicit, not a
claim of production maturity. The review-0 normalization decision is resolved by the operator ruling and the correction above; builder gate failures, if any, remain explicit rather than accepted technical debt. No adjacent infrastructure was added.

## Operator closeout (2026-11-26)

- Models: builder `gpt-6.1-sol`, reviewer `gpt-6.1-terra`; three review cycles. Review-0 raised
  HYDRATION1-CANONICAL-NORMALIZATION (ruled by the operator: one address per page — the string Next emits as the
  canonical is the string in the share links, in "Copy link" and in JSON-LD) and the preview-cookie precedence in
  `routing.ts` (fixed with a regression test). Review-1 and review-2 had no code finding: they stopped because the
  builder's sandbox cannot bind a port for `npm run build` and the MCP test (`EPERM`). Those gates are
  **operator-executed** below, on the unchanged candidate.
- Operator gates (log read, exit codes bare): build, typecheck, shared, plugins, renderer, serving, serving bundle,
  admin unit, backend unit, infra, MCP, `git diff --check` — all 0.
- Local browser probe (`next start` harness, Chromium), fixture pages `/` and `/about` of `cm1-content`, the home page
  of `cm1-commerce`, and the preview address: 0 page errors (before: 1 each); nodes removed during hydration 0–1
  (before: 15–16, the whole head and the page wrapper).
- Staging diff, read before the deploy: no resource added or removed; three renderer functions and the site and admin
  asset deployments change by code only.
- Staging after the deploy, five pages (`/_site/cm1-content`, `…/about`, `/_site/cm1-commerce`, `/_site/cm1-catalog`,
  `/tenant/cm1-content/about`): no uncaught page error; the page wrapper, the title and the meta tags are never
  removed; the share block is in the server HTML and each link carries exactly the canonical address.
- Wrong oracle of the operator, corrected: the first form of the staging check failed on "any child of head or body
  removed". The removed nodes were `div#S:0`, `div#S:1` (React's streaming holders), one re-hoisted favicon link and
  a third-party hidden iframe — normal work, not a second render. The check now names the wrapper, title and meta tags.
- Behaviour change, accepted: on a preview address the share links carry the site's canonical address, not the
  preview address. JSON-LD spelling changes only for a non-ASCII path or a mixed-case host.
- Not found: why `next dev` did not raise the error in the investigation of 2026-11-22.
