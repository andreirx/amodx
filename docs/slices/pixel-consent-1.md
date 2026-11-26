# PIXEL-CONSENT-1 — Facebook pixel only after marketing consent

Status: **IMPLEMENTED 2026-11-26, revision 2** (roadmap/packet label: **BUILT**); build, unit, serving and
serving-bundle gates EXECUTED green in revisions 1 and 2; staging browser proof and deployment pending.
Track: growth. Depends: existing consent hook and HYDRATION-1 contract.
Source plan: item 4 of `docs/slices/tags-1.md`, explicitly allocated by the PIXEL-CONSENT-1 packet.
Maturity target: **MATURE**; staging browser verification and deployment remain operator-run, not a production claim.

## Purpose / cause

OBSERVED in source: `[siteId]/layout.tsx` mounts `FBPixel` when a tenant has
`integrations.fbPixelId`. The old server component emitted the loader, including
`fbq('init', <id>)` and `fbq('track', 'PageView')`, without consulting consent. Its
`noscript` image requested `https://www.facebook.com/tr` independently of JavaScript.
`lib/fbpixel.ts` incorrectly claimed the component was consent-gated. Its additional
claim that the SDK was loaded was too strong: `window.fbq` can be the loader's queue
while the external SDK is still in flight.

This fix makes one existing visitor choice control that external report. It supports
`docs/VISION.md`'s trust-boundary guarantee without adding a tenant data dependency or
putting visitor state into shared cached HTML.

## Scope / fix

- `FBPixel` (`components/FBPixel.tsx`) stays a **server** component. It only does
  `await import("./FBPixelLoader")` and renders `<FBPixelLoader pixelId>`. It emits nothing itself.
- `FBPixelLoader` (`components/FBPixelLoader.tsx`, new) is the **client** component. It uses the
  existing `useConsent` hook and returns `null` unless `consent?.marketing === true`.
  Why two files and a dynamic import: see "Revision 1" below (measured chunk-set cost).
- Its script id, `afterInteractive` strategy, SDK URL, init and PageView calls stay unchanged.
- The `noscript` image is removed. It cannot ask for consent; without JavaScript the
  pixel must not send a PageView.
- `app/[siteId]/layout.tsx` is byte-unchanged. A tenant without an id mounts no pixel.
- The helper's comment now states its actual presence-check/queue contract. Its code
  and all event callers are unchanged: none has an independent transport without `fbq`.

### Under the hood / hydration

OBSERVED: `CookieConsent.tsx` `useConsent` initializes React state to `null`, reads
`window.AMODX_CONSENT` in `useEffect`, and subscribes to `amodx-consent-updated`.
`handleChoice` saves the choice and calls `setGlobalConsent`, which writes the global
and synchronously dispatches that event before the non-blocking consent POST.
Thus the existing listener changes React state on the current page; no reload or new
notification mechanism is needed. The same effect applies stored consent after mount.

The server render and first client render both return `null`, including when stored
marketing consent is already true. No browser read occurs during the first render.
Headless tests exercise current-page acceptance and subsequent stored-choice hydration.

### Non-scope / preserved limitations

No Google Ads, Consent Mode, new purchase semantics, consent categories/texts, banner
styling, infrastructure, route/schema/MCP changes or dependencies. No event is queued
by the helper before the pixel exists. `FBPurchaseEvent` still makes one attempt in its
mount effect; a purchase attempted before acceptance is not retried. An already
installed SDK is not unloaded; revocation after loading is not implemented by this
presence check. These are not claims of full third-party lifecycle or legal compliance.

## Architectural boundaries

Use the existing renderer consent/Script boundary directly. The new local imports are
`FBPixel` → `FBPixelLoader` (dynamic) and `FBPixelLoader` → the existing `CookieConsent` hook. No new
package boundary, external dependency, DB, backend, plugin entry, tenant authority or
server request read is added. PD-001/002/003,
tenant isolation and the no-Scan rule are unaffected. See `renderer/ARCHITECTURE.md`,
`docs/frontend-patterns.md` and `docs/testing-strategy.md`.

Abstraction record: `FBPixelLoader` client module — users: `FBPixel` (the one server mount);
axis: none of variation — it is the client half that a server component must import from a separate
`"use client"` module, and it is imported dynamically only because the measured chunk set of the
site layout requires it (Revision 1); rejected simpler alternatives, each MEASURED failing
`cm1-identity-*`: `FBPixel` itself `"use client"`, a second export in `Analytics.tsx`, a `fbPixelId`
prop on `Analytics`, a static import of `FBPixelLoader`.

Abstraction record: test-local hydration helper — users: null, necessary, denied,
analytics-only and accepted pixel cases; axis: SSR without browser globals versus
hydration with current/stored consent; rejected alternative: duplicate error capture,
first-commit guard and retained-node assertions in every case. The local Next Script
mock is the existing external-framework test seam, not a production adapter.
Next Script mock — users: the FBPixelLoader headless cases; axis: Next's CJS/root React versus
the renderer React used in jsdom; rejected alternative: real Next Script, which failed
with an invalid-hook-call in the first focused run. No test-runtime config was changed.

## Search / event inventory

EXECUTED deterministic text searches, then OBSERVED full helper/component bodies and
call-site branches:

```sh
rg -n --glob '*.{ts,tsx}' 'fbq|_fbq|trackFBEvent|FBPurchaseEvent|FBPixel' renderer/src
rg -n 'fbq|_fbq|trackFBEvent|FBPurchaseEvent|FBPixel|facebook\.(net|com)' --glob '*.{ts,tsx,mjs,json}' --glob '!package-lock.json' --glob '!**/captures/**' --glob '!**/snapshots/**' .
rg -n 'fbPixelId' renderer/test/serving-contract/fixtures.mjs
rg -l 'fb-pixel|connect.facebook.net|facebook.com/tr' renderer/test --glob '*.body'
```

| Source | Actual contract |
|---|---|
| `components/FBPixelLoader.tsx` | The only source-tree installer of `fbq`/`_fbq`; emits init and PageView in loader text, only with marketing consent. |
| `components/FBPixel.tsx` | Server mount: dynamic import of `FBPixelLoader`, passes the id. Sends nothing. |
| `lib/fbpixel.ts` `trackFBEvent` | Checks browser existence and `window.fbq`; otherwise no operation. Calls `fbq('track', eventName, params)` when present. |
| `components/AddToCartButton.tsx` | Calls helper with `AddToCart` after adding the cart line. |
| `components/CheckoutPageView.tsx` | Calls helper with `InitiateCheckout` before its order POST. |
| `components/FBPurchaseEvent.tsx` | Calls helper with `Purchase` in a once-per-mount effect; mounted by `SitePage.tsx`'s confirmed-order view. |
| `app/[siteId]/layout.tsx` | The pixel component's mount site, under the unchanged id condition. |
| `components/SocialShare.tsx` | Facebook share anchor, not a pixel/event transport. Unchanged. |

The broader search also found admin social-link placeholders, MCP Facebook
login/feed URLs and test/capture references; none installs a pixel or sends an event.
This inventory is based on literal source search, not a compiler/AST proof against
computed aliases or arbitrary tenant-supplied custom scripts.

## Evidence rows / definition of done

| Row | Binding / required result |
|---|---|
| P1 — no id | Serving rows `cm1-identity-commerce` / `cm1-identity-content` with the existing baselines and comparator untouched: EXECUTED revision 1 (`r1-serving-4.log`), 32 of 32 URLs `same`, i.e. equal **under the existing CM1-A1 canonicalisation** (asset paths, build id, client-module ids, flight row cuts and footer year masked), not raw-byte equal. Per URL, the canonicalisation counts are as in "Serving lines that move". Also `test/unit/landing-1.test.ts` A1 (real layout, empty integrations, frozen HTML). The layout file is byte-unchanged. |
| P2 — no choice | `test/unit/pixel-consent-1.test.ts` P2/P5: SSR with browser globals absent, then `hydrateRoot`; no loader, noscript, Facebook resource element or `window.fbq`/`_fbq`. Real helper calls and real `FBPurchaseEvent` mount still send nothing. Serving row `sched1g-g6` (EXECUTED green) checks the id-configured home has no loader/image markers (`fb-pixel`, `connect.facebook.net`, `facebook.com/tr`) and, as control, carries the `FBPixelLoader` reference with `{pixelId}`. |
| P3 — refused | Same file's two P3/P5 button cases: real Necessary only / Deny all, then stored refusal on another hydration, no pixel. Analytics-only consent is an additional negative control. |
| P4 — accepted | Same file's server-mount case (`FBPixel` returns `<FBPixelLoader pixelId>`) and P4/P5: real Accept all click renders Script on the existing page, with unchanged init/id and PageView text. Executing that text creates the expected SDK URL and queues exactly init + PageView. Calling the three event names then appends their track calls: positive control for the unloaded-event check. Stored acceptance also renders the loader after mount. |
| P5 — hydration | All same-file hydration cases use `renderToString` without window/document, then `hydrateRoot`; no recoverable or console error and retained server DOM node. A global getter additionally fails on consent reads before the first layout-effect commit, since Next Script returning null could otherwise conceal an early read. Pattern: `hydration-1-client.test.ts`. |

The tests use the real hook/banner/helper but stub the external Next Script boundary
(the installed CJS module resolves another React copy in this headless test graph).
They do not simulate Next scheduling or caching. jsdom's default remote-resource
loading is off; the external SDK is never downloaded. Absence is checked by DOM and
`fbq` state, with the accepted loader as positive control. Browser network requests
and actual Next delivery remain operator proofs; unit green does not establish them.

### Serving lines that move (MEASURED in revision 1)

Fixture search: one explicit pixel setting, `SCHED1G.studio`, id `5551234567`; it is not in
the historical byte captures, and no recorded `.body` has `fb-pixel`, `connect.facebook.net` or
`facebook.com/tr`. No historical capture, client-module map, baseline or comparison mask changed.

**Tenants without a pixel id:** no line of the canonical body moves. `cm1-identity-*` compare
equal on 32 of 32 URLs (18 commerce, 14 content) with the existing baselines, under the existing
CM1-A1 canonicalisation; this is not a raw-byte equality claim (asset paths, build id, client-module
ids and flight row cuts are masked by that comparator). Canonicalisation counts, compared per URL
with that URL's baseline (EXECUTED, computed from the per-URL lines of `r1-serving-4.log`; the identity counts re-checked equal on 32 of 32 in `r2-serving.log`):

| Count | Equal to the URL's baseline on | Baseline values seen across URLs |
|---|---|---|
| `assetPath` | 32 of 32 | 0 (4 non-HTML URLs per tenant: `/sitemap.xml`, `/openai-feed`, `/robots.txt`, `/llms.txt`), 18, 19, 24 |
| `clientRefRows` | 32 of 32 | 0, 13, 14, 15, 16, 17, 18 |
| `clientRefUses`, `clientRefExportRows`, `buildId`, `footerYear`, `bootstrapChunks` | 32 of 32 | — |
| `flightChunks` | 12 of 32 | differs on 20 URLs (e.g. commerce `/`: 1 → 4) |
| `rootSibling` | 8 of 32 | differs on 24 URLs (e.g. commerce `/`: 0 → 1) |

The `flightChunks` and `rootSibling` differences come from the existing comparator's inputs, not
from this slice. `flightChunks` counts the streamed `self.__next_f.push` pieces, which the comparator
joins before comparing; `rootSibling` counts applications of the listed SCHED-1G2-ROOT-SIBLING
allowance. EXECUTED in revision 2:
- HEAD (temporary worktree, `cm1-identity` rows, `r2-head-cm1-identity.log`) differs from the
  baselines in the same way: `flightChunks` on 20 URLs, `rootSibling` on 24 URLs.
- Candidate vs HEAD, per URL: every count is equal except `flightChunks` on 3 URLs (commerce `/shop`
  5 → 4, content `/products/d0000000-…-000000000001` 4 → 3, content `/checkout` 4 → 3).
- That count is not stable across runs of the SAME source: three candidate runs
  (`r1-serving-2/3/4.log`) give commerce `/shop` 5, 5, 4 and content `/cart` 4, 3, 3 (5 URLs vary).
  It is the streaming cut, which is timing-dependent and outside what this slice changes.

**Tenant with a pixel id** (`sched1g-studio` home). EXECUTED: the page rendered by HEAD (separate
worktree) and by the candidate, both canonicalised with `maskBody` (CM1-A1), set difference.
This is ONE URL; its counts are not claimed for other pages:

| Where | HEAD | Candidate |
|---|---|---|
| HTML | `<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=5551234567&amp;ev=PageView&amp;noscript=1" alt=""/></noscript>` | removed |
| Flight row `1e:` | the `img` element of that noscript | removed |
| Flight row `7` (site layout) | `[["$","$L…next/dist/client/script.js#",null,{"id":"fb-pixel","strategy":"afterInteractive","children":"<loader text: fbevents.js, init 5551234567, PageView>"}],["$","noscript",null,{"children":"$1e"}]]` | `"$L1d"` |
| Flight row `1d:` | — | `["$","$L…renderer/src/components/FBPixelLoader.tsx#FBPixelLoader",null,{"pixelId":"5551234567"}]` |
| Counts | flightChunks 4, clientRefRows 18, assetPath 24 | flightChunks 5, clientRefRows 19, assetPath 24 |

No other line differs. The id stays in the page only as a client prop; the loader text reaches
the browser only inside the client chunk and runs only after marketing consent.

## Revision 1 — operator finding after review-0: the serving suite failed, row P1 violated

Operator EXECUTED `npm --prefix renderer run test:serving` on the review-0 candidate: exit 1
(`cm1-identity-*`, `loc1-diff-cdl-2`, `loc1e-category-controls`, `loc1-flight-controls`,
`cq1-quote-channels`, `cq1-bars-own`). The operator reported `assetPath` 24 → 27 "on every page".
Revision 1 re-measured the review-0 design's equivalent (first revision-1 variant, `r1-serving.log`)
per URL against each URL's baseline: +3 on 22 URLs (baseline 18 or 24), +2 on 2 URLs (baseline 19:
`/cart`, `/checkout`), 0 on the 8 non-HTML URLs (baseline 0), which compared `same`. The other
identity counts were equal on all 32. So: every compared HTML page gained references; not one
uniform count.

Measured cause (EXECUTED: chunk lists of HEAD and candidate builds, module ids per chunk): the
extra file was NOT the pixel code. Turbopack's chunk optimiser moved an existing 250-byte
async-loader stub (module of `PageEffectWrapper`'s `import("@amodx/effects/render")`) out of the
shared site-layout chunk into a chunk of its own. On commerce `/about` (the URL diffed) that is
one more `<script src>` and two more flight asset rows (+3 `assetPath`). The pixel code itself was
inside the shared chunk.

Experiments, each a full `next build` + `cm1-identity` rows on a HEAD worktree (EXECUTED). The
`assetPath` column is the value on ONE URL, commerce `/about` (baseline 24), the line printed for
it; the `cm1-identity` column is the row result over the rows run:

| Variant | rows run | `assetPath`, commerce `/about` | `cm1-identity` |
|---|---|---|---|
| HEAD | commerce + content | 24 | pass |
| HEAD + 700-byte string added to `Analytics` | commerce | 24 | pass |
| HEAD without the server `FBPixel` mount | commerce | 24 | fail: only the `$undefined` slot moves (expected for this probe) |
| `FBPixel` as a 2nd export of `Analytics.tsx`, layout unchanged | commerce | 27 | fail |
| same, layout importing it (main tree, full suite) | all | 27 | fail |
| `Analytics` gains a `fbPixelId` prop; server `FBPixel` renders it | commerce + content | 27 | fail |
| Server `FBPixel` statically imports client `FBPixelLoader` | commerce + content | 27 | fail |
| Server `FBPixel` does `await import("./FBPixelLoader")` | commerce + content | 24 | **pass** (chosen) |

Size alone does not explain the split (the padded variant is larger than two failing ones). The
partition is Turbopack's decision; this record states what was measured, not a derived rule. The
packet's first suggestion (`Analytics` module) was measured and fails; preference (1) is met by
the dynamic import instead. Residual risk: a future change to any client module of the site
layout can move the partition again; `cm1-identity-*` detects it.

Also corrected in revision 1: the review-0 `sched1g-g6` assertion matched a bare `<noscript`,
which ThemeInjector's font fallback emits on every tenant with a font. Defect class: a negative
marker that is not specific to the thing it rejects. Rule applied: the markers are only strings
the pixel itself emits (`fb-pixel`, `connect.facebook.net`, `facebook.com/tr`), paired with a
positive control (the `FBPixelLoader` reference and its `{pixelId}` in the escaped flight text).

## Validation record

Revision 2 (final tree), EXECUTED by the builder against the fresh build, in this order. Revision 2
changed only documentation and one comment in `FBPixel.tsx`; all gates were run again:

| Exact command | Expected | Actual | Evidence (`.agent-manager/slices/PIXEL-CONSENT-1/`) |
|---|---|---|---|
| `npm run build` | exit 0 | exit 0 | `r2-build.log` |
| `npm run typecheck` | exit 0 | exit 0, eight workspaces | `r2-typecheck.log` |
| `npm --prefix packages/shared test` | exit 0 | 599/599 | `r2-shared.log` |
| `npm --prefix renderer test` | exit 0 | 923/923, 60 files (6 pixel cases) | `r2-renderer.log` |
| `npm --prefix backend run test:unit` | exit 0 | 2059 passed, 1 skipped | `r2-backend-unit.log` |
| `npm --prefix tools/mcp-server test` | exit 0 | 17/17 | `r2-mcp.log` |
| `npm --prefix renderer run test:serving` | exit 0 | 173/173; `cm1-identity` 32 of 32 URLs same under CM1-A1; per URL the identity counts (`assetPath`, `clientRef*`, `buildId`, `footerYear`, `bootstrapChunks`) equal that URL's baseline on 32 of 32 | `r2-serving.log` |
| `npm --prefix renderer run test:serving-bundle` | exit 0 | 60/60 | `r2-serving-bundle.log` |
| `git diff --check` | exit 0, no output | exit 0, no output | `r2-diff-check.log` |

Revision 1 ran the same sequence with the same results (`r1-*.log`).

EXECUTED negative controls (`node .agent-manager/slices/PIXEL-CONSENT-1/r1-negative-controls.cjs`)
against `FBPixelLoader.tsx`: gate removed, analytics instead of marketing, noscript image restored;
each focused run exited 1 with assertion failures; source restored with SHA-256 check.
Rule closed: the entire pixel loader subtree requires explicit marketing permission; there is no
non-JavaScript reporting path.

The tests use the real hook/banner/helper but stub the external Next Script boundary (the
installed CJS module resolves another React copy in this headless graph). Browser network
requests are not proved by them.

## Operator work / coverage boundary

Remaining operator work: staging browser proof. A tenant with a pixel id, fresh isolated browser
contexts for no choice, Necessary only and Deny all must produce zero Facebook requests and no
`fbq`; Accept all on the same page must load the `FBPixelLoader` chunk, the SDK and init/PageView
without reload; stored acceptance hydrates with no recoverable error. A tenant without an id is
unchanged. No automated real-browser network test exists for this path; one would cover the
real lazy chunk load and Next script delivery beyond the headless seam. Not built here (packet
assigns the end-to-end proof to the operator). No backend route changed: `routes.json` unchanged.

## Deployment note

**Live sites that set a pixel id will report to Facebook only after the visitor accepts
marketing cookies.** Without JavaScript they no longer report via a noscript image.
No data migration, settings change or infra change. Deploy through the normal reviewed
renderer process; operator must invalidate existing cached HTML so old unconditional
loader/image bytes are not served. Rollback restores the prior unconditional-reporting
defect; do not use rollback as a privacy-neutral operation.

Exit criterion: P1–P5 bindings and all gates are green (revisions 1 and 2, EXECUTED); the staging
browser request proof is reviewed before deployment.
The remaining TAGS-1 items are not built.

## References

`docs/VISION.md`; `docs/platform-decisions.md`; `docs/testing-strategy.md`;
`docs/frontend-patterns.md`; `renderer/ARCHITECTURE.md`; `docs/slices/hydration-1.md`;
`docs/slices/tags-1.md`; PIXEL-CONSENT-1 selection packet.

## Operator closeout (2026-11-26)

- Models: revision 0 builder `gpt-6.1-sol`; revisions 1–2 builder `claude-opus-5-5`; reviewer `gpt-6.1-terra`
  throughout; three review cycles.
- Revision 0 was approved by the review and then failed the operator's `test:serving` run (`cm1-identity-*` and five
  other rows): the pixel component had become a client module of the root layout, which added client chunk
  references to HTML pages of tenants without a pixel id (row P1). Nothing was deployed. The first builder's sandbox
  cannot run the serving suites, so the expected data had been derived by reasoning; the slice went to a builder
  that can run them. The operator's first wording of the measurement ("24 → 27 on every page") was a generalisation
  from a few URLs; the builder's record states the counts per URL.
- Operator gates on the final candidate (log read, exit codes bare): build, typecheck, shared, plugins, renderer,
  serving, serving bundle, admin unit, backend unit, infra, MCP, `git diff --check` — all 0.
- Staging diff, read before the deploy: no resource added or removed; renderer functions and assets by code only.
- Staging, real browser, tenant `cm1-content` with an invented pixel id set for the check (restored after):
  - before a choice: the cookie banner is shown; no request to a Facebook host; `window.fbq` undefined; no loader
    and no `noscript` image in the page;
  - after "Accept all", same page, no reload: requests to `connect.facebook.net/en_US/fbevents.js`, the pixel
    config and `www.facebook.com/tr/`; `window.fbq` is a function;
  - after "Deny all" and after "Necessary only": no request to a Facebook host; `window.fbq` undefined.
- Deployment note for production: a live site with a pixel id reports to Facebook only for visitors who accept.
