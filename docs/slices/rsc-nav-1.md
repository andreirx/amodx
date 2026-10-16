# RSC-NAV-1 — client-side navigation 307s on every tenant: forward `Next-Url` to the origin

Status: **BUILT (operator-executed) 2026-10-16 — staging deploy pending; prod on the human's word.**
Found 2026-10-15 by the first e2e spec that clicks a link (`tests/e2e/preview-site.spec.ts`, SITEID-BINDING-1).

## 1. The problem, in plain language

On every tenant site, clicking an in-site link (a Next `<Link>`) does not simply open the page. The Next client router
fetches the page's React Server Component payload; the renderer answers **307** to the same URL with a different
`_rsc=` token; the browser follows; the router disagrees again; and so on. On prod (open-next 3.1.3) the 307's
`Location` also carries the renderer's *internal rewritten path* (`/bijup.com/contact?_rsc=…`), which — since
SITEID-BINDING-1 closed the dotted pass-through on 2026-10-15 — is a 404. **Reproduced on prod, read-only:** on
`bijup.com`, click "Contact" → the visitor lands on `https://bijup.com/_site/bijup.com/bijup.com/contact?nf=1`,
a not-found shell (headless Chromium, 3 × 307, frames logged). On staging (4.1.9) the `Location` is right and the
chase converges after ~40 307/200 pairs (~5 s per click; 169 responses captured for one click).

## 2. Root cause (code-level, verified on the live system)

- **Emitter:** Next 16.3.8 `node_modules/next/dist/server/base-server.js:1250-1290`. With
  `experimental.validateRSCRequestHeaders` (default **true**, `config-shared.js:259`; not set in `renderer/next.config`)
  every RSC request's `_rsc` query value is compared with a hash recomputed from four request headers —
  `Next-Router-Prefetch`, `Next-Router-Segment-Prefetch`, `Next-Router-State-Tree`, **`Next-Url`**
  (`computeCacheBustingSearchParam`, `shared/lib/router/utils/cache-busting-search-param.js`). On mismatch:
  `307` + `location: <path>?_rsc=<expected>`; the check exists against cache poisoning on CDNs that ignore `Vary`.
- **Why it mismatches here:** CloudFront forwards the first three (they are in the renderer **cache-policy** key,
  `infra/lib/renderer-hosting.ts` "(a)") and strips `Next-Url` — it is in neither the cache policy nor the
  origin-request policy (prod `AmodxStack-RendererOriginPolicy` and staging read 2026-10-15: eight headers, no
  `Next-Url`). The Next client sends `Next-Url` on every navigation, so its hash never matches the origin's.
- **Proof** (Next's own hash function, through staging CloudFront, `RSC: 1` + a state tree + `Next-Url: /`):
  `_rsc=<hash WITH Next-Url>` (`BmXNob5UYY_wrP00`) → **307** to `?_rsc=OxBCQ2sR9P8GlKR3`;
  `_rsc=<hash WITHOUT>` (`OxBCQ2sR9P8GlKR3`) → **200** `text/x-component`. A bare `curl -H 'RSC: 1'` 307s on
  prod (`bijup.com` → `location: /bijup.com?_rsc`, the leaked rewritten path) and on staging (`/?_rsc`).
- **Not the cause:** the `staging.amodx.net` alias rewire (both hosts identical), 4.1.9 (the failure predates its
  deploy: CI run 38796134278 at 19:42Z on build `9xdxt2…`), the preview `Set-Cookie` (present).
- **Since when:** the 307 exists wherever Next's check is on (Next 16 line); it became a **404** on prod with
  SITEID-BINDING-1 (before it, the leaked `/<host>/<slug>` URL still rendered through the dotted pass-through —
  ugly URL, working page). The 19:01Z CI pass on the same build was timing luck (the chase sometimes converges in
  the spec's 5 s); Firefox passed locally, Chromium/WebKit failed.

## 3. The fix — one header, transport only

`infra/lib/renderer-hosting.ts`: add `'Next-Url'` to `RendererOriginPolicy`'s `allowList` (ninth of ten; the list
has had two free slots since the 2026-10-13 `x-isr` removal). Forwarded, **not** a cache-key dimension: the
renderer has no interception routes (`find renderer/src/app -name '(.)*'…` → none), so no response varies on it and
the origin's own `Vary` does not list it; the edge cache stays whole. The origin then reproduces the client's hash
and answers 200 on the first request — no 307, so the 3.1.3 `Location` leak never triggers either.

Named concrete gain (CDK rule): every in-site link click on every tenant site opens the page; on prod today it
opens a 404.

Rejected alternatives: `experimental.validateRSCRequestHeaders: false` (removes a cache-poisoning guard, needs a
renderer deploy anyway, treats the symptom); `Next-Url` in the cache-policy key (fragments the RSC cache per
referring page for no gain); a CLI edit of the live policy (drift from the template; the human had no CLI access).

`infra/test/amodx-stack.test.ts` (h): the exact list now ends `'x-revalidation-token', 'Next-Url'`; a
`length ≤ 10` guard pins CloudFront's hard cap. Suite 58/58 (2026-10-16, operator).

## 4. Gates and evidence

| Gate | Result |
|---|---|
| infra `npm test` | 58/58 |
| `git diff --check` | 0 |
| `cdk diff -c stage=staging AmodxStack-staging` | ORP `+ "Next-Url"`; Lambda assets rebuilt (code hash only); custom-resource timestamps; nested-stack description mojibake `?`→`—`. No stateful replacement. Log: operator scratchpad `rscnav-diff-staging.log` |
| staging deploy | **PENDING** (the operator's deploy command was refused by the session's permission classifier) |
| proof after deploy | `npx playwright test tests/e2e/preview-site.spec.ts` green on all three browsers; a bare `curl -H 'RSC: 1' https://<staging host>/?_rsc=<hash>` → 200; operator probe `pp-nav.mjs` on a staging tenant: one RSC response per click, no 307 |
| prod | on the human's word: `cdk diff` (expect the same one-line ORP change plus whatever else `main` carries — from HEAD that is OPENNEXT-1B), deploy, re-run the prod probe on `bijup.com` (read-only): click "Contact" → `/contact`, 0 × 307 |

## 5. Scope and boundaries

Infra only (one allowlist entry + its test pin). No renderer, backend or middleware change. The dependency rule is
untouched. No new abstraction. Operator-executed (one token + a test); the human may route it through review
before prod.

## 6. Follow-ups (not this slice)

- `tests/e2e/preview-site.spec.ts` stays the regression gate for this class (it is the only spec that clicks).
- A spec that clicks on a *production-shaped* host on staging (a tenant with a domain) would have caught the
  3.1.3 `Location` leak as a 404 one deploy earlier; candidate for the e2e workstream.
