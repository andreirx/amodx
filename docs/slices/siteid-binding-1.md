# Slice SITEID-BINDING-1 — the `[siteId]` route segment is bound only by the middleware, never from the wire

Status: SHIPPED 2026-10-15 (eb39f58 on prod; prod probes green; see § Prod deployment). Ratified 2026-10-15 (human: OPENNEXT1-REFLECTION = C; D1 = A, D2 = A, D3 = A). Parent: `docs/slices/opennext-1-upgrade.md` § Ratification.
Builder: claude / claude-opus-5-5 (high). Reviewer: codex / gpt-6-sol. `--timeout 60`, `--max-iter 3`.
Deliverable surface: `renderer/middleware.ts`, `renderer/test/serving-contract/*`, `tests/e2e/preview-site.spec.ts`,
docs. **No CDK/infra change. No dependency change. No OpenNext change.** Runs on open-next 3.1.3 as deployed.

## The mandate (human, 2026-10-15)
Ratification packet for OPENNEXT-1 lists this as `OPENNEXT1-REFLECTION` option C: "fix it before the upgrade
as its own slice on 3.1.3". The human agreed (same day) that this slice carries, as its FIRST proof, a
permanent safety net for preview URLs of tenants with no custom domain (`/_site/<id>/…`), because historically
middleware changes broke them and nothing on staging tests them today.

## 1. Problem in plain language
Every public page is served by one Next route, `app/[siteId]/[[...slug]]`. The middleware is supposed to be
the only thing that decides what `siteId` is: it reads the request's host, checks it is a wired tenant
domain, and rewrites `host/path` to `/<host>/<path>`. Today a request can skip that step and choose the
`siteId` itself, so one tenant's domain can show another tenant's public pages, and CloudFront stores that
copy for a year. A second path (`/tenant/<id>/…`, "test mode") lets any domain show any tenant without
any host check at all (not cached). Nothing private leaks: only published pages. The damage is brand and
SEO integrity (duplicate content under the wrong domain) and deliberate misuse (linking client B's pages
under client A's domain).

## 2. Root cause (code-level, VERIFIED 2026-10-15)
**Site:** `renderer/middleware.ts:155-164`, the "skip internals" short-circuit:
```
if (path.startsWith('/_next') || path.startsWith('/api') || path.startsWith('/static') ||
    (path.includes('.') && !isSiteRouteHandler)) { return NextResponse.next(); }
```
Any path with a dot anywhere, other than the four route handlers, is passed to Next unrewritten. Next
then matches `app/[siteId]/[[...slug]]` with `siteId` = the first path segment, from the wire.
`SitePage` resolves it with `getTenantConfig()`, which falls back from the domain GSI to a bare
`TENANT#<id>` read, so both a domain and a tenant id work.

**Consequences, each verified live on staging (`D` = `https://d3kezt5niqwtgx.cloudfront.net`, the host of
tenant `cache-probe-2026`):**
| # | Request on `D` | Observed | Meaning |
|---|---|---|---|
| C1 | `/c9-probe-1788350202.localhost/c9-probe` | 200, `s-maxage=31536000`, title "C9 Probe Page \| C9 Probe" | another tenant's page under this host, cacheable 1 year (2026-10-14) |
| C2 | (fixture) `/wk/index.php` on `FIXTURE_HOST` | 200 wk's page — pinned by serving row `(h1)` | the tenant-id form of C1 is pinned as "legitimate" by a test |
| C3 | `/ab-page.html`, `/wp-login.php`, `/.well-known/probe` | 307 `/?nf=1` (resp. `/probe?nf=1`), cacheable | a dotted path on a host never reaches that host's tenant: `siteId` = `ab-page.html`. A tenant's own dotted slug is UNREACHABLE on its own domain; it is reachable only through C1/C2 |
| C4 | open-next 3.1.3 revalidation HEAD | `node_modules/open-next/dist/core/routing/util.js` `revalidateIfRequired`: URL = `internalMeta._nextRewroteUrl` = `/<host>/<path>`; `adapters/revalidate.js:22` sends `HEAD https://<host>/<host>/<path>` | the background HEAD depends on this same hole. With `x-isr` no longer forwarded (6038706) it is an ordinary request that re-renders the page under the same ISR key; after the fix it takes the not-found handoff instead. Nothing it did was load-bearing: listings are refreshed by CACHE-10's purge |
| C5 | `/tenant/c9-probe-1788350202/c9-probe` | 200, `no-store`, title "C9 Probe Page \| C9 Probe" | `middleware.ts:198-212` (`/tenant/` test mode) has NO host gate, unlike `/_site/` (:215-222). Any tenant on any domain, uncached |

**Regression or never worked:** never worked (INFERRED: the short-circuit predates cache-1; the builder
confirms with `git log -S "path.includes('.')" -- renderer/middleware.ts` and records the first commit).

**Why removal is the whole fix, not a narrower guard.** A guard "404 if the first segment is a wired host"
leaves C2 (tenant-id form) open and costs one DynamoDB lookup per dotted request on an attacker-chosen
key. Removing the dotted condition sends every dotted path through the production branch: unknown host →
404 no-store (D3 gate now applies to them too); wired host → `/<host>/<path>` → the host's own tenant
renders the slug or takes the ordinary 307 handoff. Nothing legitimate reaches Lambda with a dot and
needs the pass-through: `_next/static/*`, `assets/*`, `favicon.ico` are CloudFront→S3 behaviours
(`infra/lib/renderer-hosting.ts:613-631`); `/_next`, `/api`, `/static` keep their prefix short-circuits;
the four route handlers are already exempted and already rewritten. The only files that become unreachable
are the five create-next-app demo SVGs in `renderer/public/` (D2).

**Operator verification of the fix hypothesis (2026-10-15):** with ONLY the dotted condition removed, the
serving-contract suite ran 33 rows: 31 unchanged green; `(h1)` → 307 (was 200); `(h2)` Location
`/wk/wp-login.php?nf=1` (was `/wp-login.php?nf=1`). Both reds are the two rows that pin today's wrong
behaviour. Log: operator scratchpad `siteid-guard-suite.log`. The edit was reverted; the tree is clean.

## 3. Decisions (RATIFIED by the human 2026-10-15, all as recommended)
- ID: SITEID-D1 — RULING: A
  QUESTION: Does `/tenant/<id>/…` (test mode) get the same allowed-host gate as `/_site/<id>/…`?
  PROBLEM: Test mode is documented (TESTING.md:8,157-247; renderer/ARCHITECTURE.md:78) and used by
    Playwright on `staging.amodx.net`. It has no host gate, so on prod `https://bijup.com/tenant/<id>/home`
    shows any tenant (no-store, so not cached, but visible and linkable).
  OPTIONS:
  - A) Gate it like `/_site/`: allowed when the host contains `localhost`, `cloudfront.net` or `staging`,
    else 403. REWARD: closes C5; staging usage unchanged (`staging.amodx.net` matches); one predicate
    shared by two callers (earned). RISK: anyone using `/tenant/` on a prod domain loses it — no evidence
    of such use (grep: only docs, two e2e specs, the twin's comments).
  - B) Leave it. REWARD: nothing changes. RISK: C5 stays live on prod.
  RECOMMENDED: A.

- ID: SITEID-D2 — RULING: A
  QUESTION: Delete `renderer/public/{file,globe,next,vercel,window}.svg`?
  PROBLEM: create-next-app leftovers. Today served by Lambda via the pass-through; after the fix they take
    the not-found handoff. grep finds no reference in `renderer/src`.
  OPTIONS: A) delete in this slice (REWARD: no dead files that now 307; RISK: none found) · B) keep
    (REWARD: smaller diff; RISK: five junk 307 entries if ever requested).
  RECOMMENDED: A.

- ID: SITEID-D3 — RULING: A
  QUESTION: The doubled `Location` header on a MISS-rendered 307 handoff — record or fix here?
  PROBLEM: Live on staging (2026-10-15): a fresh not-found handoff answers
    `location: /x?nf=1,/x?nf=1`; curl follows to the literal comma URL and still lands on the 404
    (`nf` present). The STALE copy on prod (`bijup.com/wp-login.php`) carries a single `location`. So the
    first viewer of any missing path on prod gets an ugly URL, then a correct 404. Origin-side (same code on
    prod, INFERRED); the local suite cannot see it (`next start`, no OpenNext) — exactly the class the
    OPENNEXT-1 bundle harness exists for.
  OPTIONS: A) record in TECH-DEBT + a characterize row in the opennext-1a harness (REWARD: this slice
    stays one cause; RISK: ugly first-hit URL stays until the harness/upgrade) · B) chase it here
    (REWARD: sooner; RISK: a second cause in a routing slice; the fix is probably in OpenNext's response
    conversion, i.e. the upgrade's territory).
  RECOMMENDED: A.

## 4. The change (ordered round; `build-progress.md` after each step)
1. **Preview safety net FIRST** (new rows, must be green on the unchanged middleware before step 2):
   - `(p1)` `/_site/<TENANT_ID>/` with `Host: preview.cloudfront.net` → 200, `cache-control` contains
     `no-store`, `set-cookie` starts `amodx_preview_base=%2F_site%2F<TENANT_ID>`, body has the fixture home
     title; **no ISR entry stored** (reuse `storedIsrEntries()`).
   - `(p2)` same path with `Host: FIXTURE_HOST` → 403.
   - `tests/e2e/preview-site.spec.ts`: `page.goto('/_site/preview-probe/')` → 200; body contains the
     marker `PREVIEW-PROBE-HOME`; click the first in-page link to `/_site/preview-probe/…`; `expect(page).toHaveURL(/\/_site\/preview-probe\//)`.
     Tenant `preview-probe` (name "Preview Probe", placeholder domain `preview-probe.localhost`, home
     containing the marker and a link to `/contact`) is **operator-created on staging before launch**; the
     spec reads no credentials and runs in the push-triggered `playwright.yml` job.
2. **Middleware** (`renderer/middleware.ts`):
   - delete the `(path.includes('.') && !isSiteRouteHandler)` condition; keep `/_next`, `/api`, `/static`.
   - D1=A: extract `const isPreviewHost = (host) => host.includes('localhost') || host.includes('cloudfront.net') || host.includes('staging')`
     from the `/_site/` branch and apply it to the `/tenant/` branch with the same 403 text. (Abstraction
     one-liner: one predicate, two current callers, axis = "hosts allowed to address a tenant by id";
     rejected alternative: duplicate the three `includes`.)
   - rewrite the comments that describe the removed behaviour: the cache-8 note (`:69-108`) — its
     counterexample `/wk/index.php` is now correctly stated as "wk's `/index.php` on wk's own host";
     A2b note (`:174-186`: "dotted first segments … never reach here" is no longer true — they now 308
     like any other `<siteId>/_dyn` shape, and on a prod host the `/_site/` gate answers 403);
     `SITE_ROUTE_HANDLERS` comment (`:113-118`: the "static asset check" half is gone).
   - D2=A: delete the five SVGs.
3. **Serving-contract rows** (identities named here; the packet, not the builder, renames):
   - `(h1)` NEW IDENTITY: "(h1) a tenant's dotted slug renders on ITS OWN host": `GET /index.php` with
     `Host: wk-tenant.serving-contract.test` → 200, body has `SCANNER_PAGE_TITLE`, `stats.render > 0`.
     The fixture already gives `wk` that `Domain` (`fixtures.mjs:113`); the builder verifies the DynamoDB
     stub answers the `GSI_Domain` COUNT query for it (if not, extend the stub — it is the seam).
   - `(h1b)` NEW: "/wk/index.php on another host is NOT wk's page": `GET /wk/index.php` on `FIXTURE_HOST`
     → 307, `location` = `/wk/index.php?nf=1`, body does not contain `SCANNER_PAGE_TITLE`.
   - `(h1c)` NEW: host form: `GET /wk-tenant.serving-contract.test/index.php` on `FIXTURE_HOST` → 307,
     `location` = `/wk-tenant.serving-contract.test/index.php?nf=1`, body lacks `SCANNER_PAGE_TITLE`;
     **and no ISR entry whose key starts with `wk-tenant.serving-contract.test` is stored** (the C1 copy
     must not be minted under the other tenant's key).
   - `(h2)` expected `location` → `/wk/wp-login.php?nf=1`; title stays, comment says "on the REQUEST
     host's tenant".
   - `(t1)` D1=A: `GET /tenant/<TENANT_ID>/` on `FIXTURE_HOST` → 403. `(t2)` with `Host: preview.cloudfront.net`
     → 200 + `no-store`.
   - `(c)` unknown host now also covers a dotted path: add one assertion `GET /x.php` on `UNKNOWN_HOST` → 404 no-store.
   - Evidence taxonomy for the gate input `Host`: absent (→ `''` → 403, add to `(p2)` as a second request
     with no Host header if the harness permits; else state why not) / present-allowed `(p1)`,`(t2)` /
     present-prod `(p2)`,`(t1)`.
4. **Docs**: renderer/ARCHITECTURE.md:78-83, renderer/README.md:21, SDS.md:198 (test mode is host-gated);
   `docs/caching-architecture.md` serving-contract table: new rows, `(h1)`'s new meaning, the cache-8
   paragraph that cites `(h1)`; `docs/TECH-DEBT.md`: D3 record; note the 417 `e2e-render-*` leftover
   tenants on staging as a separate cleanup item (operator finding, not this slice).
5. **Gates** (all EXECUTED, exit codes checked bare):
   - `cd renderer && npm run test:serving` → `# fail 0`, `# tests` = 33 + the rows added (builder states the number).
   - `npx tsc --noEmit -p renderer` if a tsconfig exists; else `next build` is the type gate (it runs inside the suite).
   - `git diff --check` → 0. `git diff --name-only` ⊆ the allocation below.

## 5. Allocation (candidate paths; nothing else)
`renderer/middleware.ts`, `renderer/public/*.svg` (D2), `renderer/test/serving-contract/contract.test.mjs`,
`renderer/test/serving-contract/fixtures.mjs` and the stub under `renderer/test/serving-contract/` (only if
`(h1)` needs the GSI query), `tests/e2e/preview-site.spec.ts`, `renderer/ARCHITECTURE.md`, `renderer/README.md`,
`SDS.md`, `docs/caching-architecture.md`, `docs/TECH-DEBT.md`, `docs/ROADMAP.md` (ship line).

## 6. Deploy, probes, rollback (operator)
- Staging deploy (renderer only). Then, on `D`: C1 request → 307 `/c9-probe-1788350202.localhost/c9-probe?nf=1`,
  body never contains "C9 Probe"; C5 request → 200 (cloudfront host allowed); `/ab-page.html` → 307
  `/ab-page.html?nf=1`; `/_site/c9-probe-1788350202/c9-probe` → 200 + cookie (unchanged); Playwright
  `preview-site.spec.ts` green against staging; the CI `public-site.spec.ts` still 404.
- Prod: the human's word. The deploy's `/*` CloudFront invalidation also evicts any reflected copy
  stored at the edge (S3 was not polluted: a reflected render wrote the other tenant's own key).
- Rollback: redeploy the previous renderer build; no data or infra state changes.

## 7. Out of scope (surfaced, not built)
D3 doubled `Location` (record); the `/_site/` 403 carries no `cache-control` (CloudFront's error-caching
minimum TTL applies, 10 s — harmless, note only); staging `e2e-render-*` tenant cleanup; the OPENNEXT-1
harness rows B-REFLECT/B-PREVIEW (they inherit these expectations).


## Correction 1 (operator, 2026-10-15, before launch) — preview URLs have no trailing slash
Live check on staging after creating `preview-probe`: `/_site/preview-probe/` answers **308 → `/_site/preview-probe`**
(Next's trailing-slash normalisation; same for `/_site/c9-probe-1788350202/`). `/_site/preview-probe` answers 200,
`no-store`, `Set-Cookie amodx_preview_base=%2F_site%2Fpreview-probe`, body contains `PREVIEW-PROBE-HOME`, and the
hero button renders as `href="/_site/preview-probe/contact"`. Therefore, replacing the forms written in § 4:
- row `(p1)` requests `/_site/<TENANT_ID>` (no trailing slash); `(p2)` likewise;
- `tests/e2e/preview-site.spec.ts`: `page.goto('/_site/preview-probe')` → 200; body contains `PREVIEW-PROBE-HOME`;
  click the hero button `a[href="/_site/preview-probe/contact"]`; `expect(page).toHaveURL(/\/_site\/preview-probe\/contact$/)`
  and the contact page body renders (200).
The same page also carries one un-prefixed `href="/contact"` (not the hero): a preview link that would leave
`/_site/` — a separate finding for the preview-link audit, NOT in this slice's scope; the test clicks the hero.


## Correction 2 (operator, 2026-10-15, at closeout) — the un-prefixed `/contact` link is not a defect
Correction 1 flagged an un-prefixed `href="/contact"` in the server HTML of a preview page. Verified in a headless
browser (prod `/_site/povesti-pe-biscuite`: the category link landed on `/_site/povesti-pe-biscuite/category/1-8-martie`,
200; staging `/_site/preview-probe`: the nav "Contact" link landed on `/_site/preview-probe/contact`, 200): the
navigation (`renderer/src/components/Navbar.tsx`, `getUrl()`) rewrites those links client-side after hydration, so
they stay inside the preview. Only the pre-hydration instant carries the bare form. No follow-up slice.

## Closeout record (operator, 2026-10-15)
- Review: cycle 1 `escalate` (documentation allocation; operator ruled A, append-only for the two committed records),
  cycle 2 `approved` (reviewer gpt-6-sol; builder claude-opus-5-5). Reviewer could not execute the suite in its
  read-only sandbox; the operator ran the gates on the unchanged candidate: `tsc --noEmit` 0; `npm run test:serving`
  `# tests 39 # pass 39 # fail 0`; `git diff --check` 0 (operator scratchpad `siteid-binding-gates.log`).
- Durable records touched append-only: `docs/slices/opennext-1-upgrade.md` (Ratification correction),
  `docs/slices/cache-8-revalidation-flood.md` (Superseded note); 0 removed lines in either (verified).

## Staging verification (operator, 2026-10-15, after deploy of eb39f58 + CloudFront `/*` invalidation)
On `D` (cache-probe tenant host): `/c9-probe-1788350202.localhost/c9-probe` → 307 `…?nf=1`, title "Cache Probe" (C1 closed);
`/c9-probe-1788350202/c9-probe.html` → 307 (C2 closed); `/ab-page.html`, `/wp-login.php` → 307 on the host's own tenant
(C3: a dotted path now reaches the host's tenant); `/tenant/c9-probe-1788350202/c9-probe` → 200 no-store on `D` and on
`staging.amodx.net` (preview hosts keep test mode); `/_site/preview-probe` → 200 no-store + cookie; `/ab-page` → 200 (unchanged);
`/robots.txt` → 200. Playwright `preview-site` + `public-site` → 2/2 passed. D3 (doubled `Location`) still present, as recorded.

## Prod deployment (operator, 2026-10-15, on the human's word "Deploy to prod with diff first")
- `cdk diff AmodxStack -c stage=prod`: three Lambda code assets (RendererServer, Revalidation, ImageOpt), the static-assets
  zip, the admin `config.json` rewrite (timestamp physical id, same content) and three nested-stack description strings
  (mangled em-dash in the deployed template); no resource added, removed or replaced. Deploy exit 0, 208 s, no rollback.
- CloudFront `/*` invalidation `I7TNKL4XJMVR38LPPJD8MR9SCQ` on E3UU78UY1MM95M, completed.
- Pre-deploy markers (the hole, live on prod): `bijup.com/blog.bijup.com` → 200 "Home | Andrei Roman - The Foundry";
  `bijup.com/povesti-pe-biscuite.localhost` → 200 "Home | Povesti-Pe-Biscuite" with `s-maxage=31536000` (a no-domain
  tenant's site, public under another tenant's domain, cacheable one year — the reason the invalidation was mandatory).
- Post-deploy, after the invalidation: `bijup.com/blog.bijup.com` → 307 `?nf=1` title "Bijup.com" (C1 closed);
  `bijup.com/povesti-pe-biscuite.localhost` → 307 (C2 closed); `bijup.com/wp-login.php` → 307 on bijup's own tenant (C3);
  `bijup.com/` and `blog.bijup.com/` → 200, own titles; `d111wtnnjzzsb1.cloudfront.net/_site/povesti-pe-biscuite` → 200
  `no-store`; `bijup.com/_site/povesti-pe-biscuite` → 403 (preview host gate, as on staging); `robots.txt` → 200.
  Home pages answer `s-maxage=31536000` because the new build id starts with an empty `_cache/` prefix (cold render);
  before the deploy they answered `s-maxage=2, stale-while-revalidate=300` (STALE entries of the old build) — the known
  cold/stale contract, not a change. D3 (doubled `Location` on MISS 307s) is present on prod exactly as on staging.
- Health, 20 min after deploy: renderer Invocations 21 / Errors 0; CloudFront 5xx rate 0.0.
- Rollback, if ever needed: redeploy the previous bundle (646838f^ tree = 71dde6b bundle); no data or infra state changed.
