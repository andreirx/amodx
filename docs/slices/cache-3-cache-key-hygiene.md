# CACHE-3: Cache-key hygiene — RSC header family + query-string allowlist + no Set-Cookie on cached HTML

- **Status:** IMPLEMENTED 2026-07-27, **revision 5** (iteration-3 review's three required
  changes applied, all documentation: the mandatory staging deploy command needs
  `-c stage=staging`; the CDK scope statements corrected from "a two-property edit on an
  existing construct" to the real three deltas across two constructs; two name ripples
  closed. **No behaviour change** — the only non-`.md` edit is a comment, and the
  synthesized template is proven unchanged. Revision 4 applied iteration-2's four required
  changes: cookie predicate narrowed from substring to the ratified **prefix** contract; the
  cookie-name source of truth corrected with next-auth merge evidence; the false "chunked
  authentication fixed" claim withdrawn and recorded as deferred debt; validation re-run
  against the corrected oracle. Revision 3 applied the two human decisions —
  `CACHE3-SESSION-KEY` = option B, `CACHE3-STAGING-DRIFT` = staged reconcile)
  — review pending, **not deployed**
- **Track:** CACHE — serving-layer remediation
- **Depends:** cache-1 (these defects only bite once caching is live)
- **Gates:** the whole track. `cache-1` and `cache-2` are committed but must not deploy
  before this slice (H1).
- **Source:** code audit 2026-07-26
- **Maturity target:** MATURE
- **⚠ Production-sensitive:** touches CDK (`infra/lib/renderer-hosting.ts` — the
  `RendererCachePolicy` cache key **and** the viewer-request `HostRewriteFunction` body)
  and middleware behavior for live tenants. Operator reviews the diff before deploy.

## Defects being fixed

1. **Unbounded cache fragmentation / busting**: the CloudFront cache policy used
   `queryStringBehavior: all()`. Any `?utm_*`, `?fbclid`, or attacker-chosen junk parameter
   minted a distinct cache entry — guaranteed miss — an SSR Lambda invocation. This is the
   largest remaining "Lambda fires more than intended" vector after cache-1.
2. **Set-Cookie on page responses**: `renderer/middleware.ts` set `amodx_ref` (attribution)
   whenever `?ref=`/`?utm_source=` was present. With `cookieBehavior: none()`, a stored
   response carrying a `Set-Cookie` is replayed to every subsequent viewer.
   (The `amodx_preview_base` Set-Cookie is preview-only traffic — uncached — fine.)
3. **(Added in revision 3, found in review iteration 2 — hazard H3)** **The cache key was
   blind to the session cookie.** `cookieBehavior: none()` plus no session-derived header
   meant an authenticated request and an anonymous one produced the *same* cache key. The
   middleware rule that sends session traffic to the `no-store` twin is an **origin**
   behaviour, and a warm entry is answered before the origin runs, so on an access-gated
   page a logged-in visitor would have been served the cached *"Restricted Access"* shell
   for up to a year. Not a confidentiality defect (the cacheable route never receives a
   session, so it cannot store one visitor's content for another) — a *functionality*
   defect: the gate failed closed against the person entitled to the content.

## Ratified resolutions (human, 2026-07-27)

- **CACHE3-SESSION-KEY → option B.** The existing CloudFront viewer-request Function
  derives a boolean `x-has-session` header by cookie-**prefix** match on the NextAuth
  session-cookie families (robust to chunked `.0/.1` variants; the token value never
  enters the cache key), and `x-has-session` joins the cache-key header allowlist.
  Warm-edge effect: an authenticated request always misses the anonymous entry, reaches
  middleware, and routes to the dynamic twin. Evidence must include the CF function
  source, the synthesized policy fragment, and a probe plan item for a WARM-EDGE
  session request (operator, post-deploy — origin probes cannot see this failure).
- **CACHE3-STAGING-DRIFT → staged reconcile.** The bounded-`cdk diff` gate is replaced:
  deployed staging is ~630 resources behind the repo, so the deployment plan is
  (1) deploy current `main` to STAGING absorbing the drift, (2) run the full Track
  CACHE probe suite there, (3) the production diff is then reviewed small. The slice's
  evidence gate becomes: source-isolated synth comparison (only the intended
  cache-policy + CF-function changes vs pre-slice source) + the staged-reconcile plan
  written into the deployment notes.

## Scope widening (ratified 2026-07-26, decision CACHE-1-H1)

**Add the RSC header family to the CloudFront cache key**: `RSC`,
`Next-Router-Prefetch`, `Next-Router-State-Tree`, `Next-Router-Segment-Prefetch` in the
`RendererCachePolicy` header allowlist (alongside `X-Forwarded-Host`). Without this, a
single unauthenticated request with a bare `RSC: 1` header pins a flight payload at the
edge under a page's HTML URL. **cache-1 is not deployable until this lands** — deploy
order: cache-3 → cache-1 + cache-2, or one combined deploy.

## What shipped

### 1. `infra/lib/renderer-hosting.ts` — `RendererCachePolicy`

| | Before | After |
|---|---|---|
| header allowlist | `X-Forwarded-Host` | `X-Forwarded-Host`, `RSC`, `Next-Router-Prefetch`, `Next-Router-State-Tree`, `Next-Router-Segment-Prefetch`, `x-has-session` |
| query strings | `all()` | `allowList('page','q','availability','id','email','preview','nf')` |
| viewer-request Function | `x-forwarded-host` + `x-origin-verify` | …plus `x-has-session: '0'\|'1'`, derived from the cookie jar by **prefix** match over `SESSION_COOKIE_BASES` (revision 3; predicate narrowed to prefix in revision 4 — F11) |
| cookies / TTLs | unchanged | unchanged (`CacheCookieBehavior.none()` — see F10 for why the session bit is a header, not a cookie) |

The allowlist was enumerated from the code, not guessed. Every `query.*` read in the
render body (`components/SitePage.tsx`) and both dynamic twins:

| Param | Read at | Why keyed |
|---|---|---|
| `page` | `SitePage.tsx` category / shop / search branches | `/shop?page=2` must not get the page-1 entry |
| `q` | `SitePage.tsx` search branch + `buildSitePageMetadata` | selects the result set |
| `availability` | `SitePage.tsx` shop branch | in-stock filter |
| `id` | `SitePage.tsx` checkout-confirm | order lookup |
| `email` | `SitePage.tsx` checkout-confirm + checkout-track | order lookup |
| `preview` | `%5Fdyn/[[...slug]]`, `%5Fdyn/products/[productId]` | an editor must bypass the published entry |
| `nf` | `lib/not-found-handoff.ts` `NOT_FOUND_PARAM` | **mandatory** — see finding F1 |

### 2. Attribution moved off page responses

`renderer/middleware.ts` no longer sets `amodx_ref`. Its replacement is two files (design
option **2b**, adopted in revision 1 — see F8 for why 2a was withdrawn):

- `renderer/src/components/ReferralCapture.tsx` — a constant inline `<script>` rendered
  from the public site layout. It reads `location.search`, applies `ref || utm_source`, and
  POSTs the resolved value to `/api/ref?v=<encoded>`. No parameter → no request.
- `renderer/src/app/api/ref/route.ts` — sets the cookie and answers `204` + `no-store`.

The **trigger** had to move into the browser (a warm campaign landing is answered at the
edge, so the origin never runs). The **write** stayed on the origin, which is what makes the
change migration-safe and lets the cookie keep every attribute it had.

Semantics preserved: `ref` precedence over `utm_source`, 30-day window, `Path=/`,
`SameSite=Lax`, `HttpOnly`, `Secure`, last-touch overwrite, and a percent-encoded wire value
byte-identical to what the middleware's `NextResponse.cookies.set` produced (same
serializer). One deliberate difference: `Secure` is omitted when the resolved host is
literally `localhost`/`127.0.0.1`, where the old unconditional `secure: true` silently
discarded the cookie in local development. Production is HTTPS-only and unchanged.

### 3. Docs

`docs/caching-architecture.md` (§Architecture Overview — the stale "one hazard remains open"
line replaced, §Cache Policy — rewritten with the allowlists, the per-parameter
justification, the two-halves safety argument and the measured probe table, §Distribution
Layout, §Measured serving behaviour, §Open hazards H1 → CLOSED, §Cost Analysis, §Known Gaps
10 + new 14), `renderer/ARCHITECTURE.md`, `docs/architecture-deep -dive.md`,
`docs/security-remediation-status.md`, `docs/ROADMAP.md`, `CURRENT_SLICE.md`.

Revision 2 additionally corrected the cache-safety *explanation* in
`infra/lib/renderer-hosting.ts` (comments), `docs/caching-architecture.md` § *Cache Policy*
and `renderer/ARCHITECTURE.md`, and updated the CloudFront cache-policy box in
`docs/architecture-deep -dive.md`, which revision 1 had left showing the old
`Key = X-Forwarded-Host + path + query strings`. See § *Revision 2*.

Revision 4 corrected the session-cookie *contract* everywhere it appears —
`infra/lib/renderer-hosting.ts` and `renderer/middleware.ts` (code + comments),
`docs/caching-architecture.md` (§ *`x-has-session`*, § *Open hazards* H3, the two probe
tables), `renderer/ARCHITECTURE.md` (twin-routing bullet + signal-pairing note),
`CURRENT_SLICE.md`, `docs/architecture-deep -dive.md` (CloudFront box) — and added
`docs/TECH-DEBT.md` § *Chunked NextAuth session cookies are not reassembled*. See
§ *Revision 4*.

## Findings (all EXECUTED unless labelled)

### F1 — `nf` is mandatory in the allowlist, not an optimisation

The not-found handoff redirects `/p` → `/p?nf=1`, and **that 307 is cacheable**
(measured: `307`, `s-maxage=31536000`, `x-nextjs-cache: MISS`). If `nf` were dropped from
the cache key, `/p?nf=1` would collapse onto the `/p` key, hit the stored 307, and be
redirected to itself — an **infinite client redirect loop on every 404**, on every tenant.
This was not in the slice's original expected set (which said the allowlist would be
"`page`, `q`/search, filter/sort params"). Anyone editing the allowlist must keep it in
sync with `NOT_FOUND_PARAM`.

### F2 — the STOP condition was checked and does NOT trigger

*(Corrected in revision 1. Iteration 0 gave the right allowlist with the wrong proof — see
the CORRECTION note at the end of this finding, which is kept deliberately.)*

The packet required a stop-and-report if a non-allowlisted parameter would be stripped from
the cache key yet produce differing cacheable responses. It does not happen. The argument
has two halves, and they are not symmetric:

**(a) Parameters that change the representation are IN the list.** Being in the key is what
forces an edge miss and gets the request to the origin at all. This is the direction that
would produce the failure the STOP condition is about (`/shop?page=2` answered with the
stored page 1). It is handled by listing them, not by anything downstream.

**(b) Parameters that are NOT in the list are read by no code**, so the origin would produce
the bare-path representation for them anyway. Basis for that completeness claim — a
deterministic literal-text scan (`grep -rn "query\.\|query\["` over `renderer/src`, then
each hit read in place; not an index, not a call graph):

| Read site | Parameters |
|---|---|
| `components/SitePage.tsx` | `q`, `page`, `availability`, `id`, `email` |
| `%5Fdyn/[[...slug]]/page.tsx`, `%5Fdyn/products/[productId]/page.tsx` | `preview` |
| `lib/not-found-handoff.ts` | `nf` |

That set **is** the allowlist. The strongest form of (b) applies to the cacheable route
itself: `app/[siteId]/[[...slug]]/page.tsx` passes `query={{}}` **literally** — in ISR mode
it cannot `await searchParams` at all — so the representation that ends up *stored* is a
pure function of host + path + the RSC headers, and no query parameter can vary it. `_rsc`
is the one non-listed parameter that reaches that route, and F3 measures that it does not
change the body.

> **CORRECTION (revision 1).** Iteration 0 argued this from a `cache-1` property instead:
> "middleware routes every query-string request to the `no-store` twin, so no query-string
> request produces a cacheable response at all, so no stripped parameter can mis-serve a
> stored variant." That reasoning is **unsafe** and was caught in review. It only describes
> requests that *reach the origin*. On a warm bare-path entry CloudFront answers at the edge
> and middleware never runs, so a stripped `page` would have been mis-served regardless of
> what the twin would have done. The measurement itself is real and is retained in the probe
> table; what it actually buys is narrower: a query-string request can never *populate* an
> entry (so junk cannot warm a bogus one), and a listed parameter always renders fresh.
> The allowlist was already correct; only the justification was wrong. Recorded rather than
> silently replaced, because the wrong version is the one that reads as obviously true.

### F3 — `_rsc` is safe to drop from the key, and this was measured rather than argued

`_rsc` is the one non-allowlisted parameter that reaches the *cacheable* route (Next strips
it before middleware, so `nextUrl.search` is empty and the request lands on the ISR route).
Measured on this build:

- `?_rsc=abc123` with no `RSC` header → `text/html`, body begins `<!DOCTYPE html>`
- `?_rsc=abc123` **with** `RSC: 1` → `text/x-component`
- `?_rsc=zzz999` with no `RSC` header → `text/html`

So the **header** is the discriminator and the parameter is only a cache-buster for CDNs
that do not key on the header — which is exactly what this policy now does. Dropping `_rsc`
therefore collapses the per-prefetch entry explosion instead of risking a wrong variant.

### F4 — the attribution move is required by change 1, not merely tidy

Once `ref`/`utm_source` leave the cache key, `/p?ref=x` resolves to the `/p` key. On a warm
URL CloudFront answers from the edge and the origin — hence middleware — **never runs**. A
server-side capture would have gone silently dead for exactly the campaign traffic it
exists to attribute. The two changes are not independent; shipping 1 without 2 would have
broken attribution.

The pre-existing middleware comment claimed the Set-Cookie "can never land on a cacheable
response" because both triggers are query params. That was true under `cache-1` and stays
true — but it made correctness depend on a rule enforced in a different file. F4 is the
reason the move was necessary regardless.

### F5 — sole consumer of `amodx_ref`, traced

`renderer/src/app/api/leads/route.ts:31` — `cookieStore.get("amodx_ref")?.value`, forwarded
to the backend as `data.referral`. Basis for the completeness claim: `grep -rn "amodx_ref"`
over the repo excluding `node_modules` returns exactly one reader (that line), one writer
(the middleware line now removed), and documentation references. This is a literal-string
grep over the whole tree, not an index or a call-graph query, so it is reliable for a
string this distinctive; a dynamically-constructed cookie name would evade it.

The consumer is unchanged by this slice. `httpOnly` is **retained** (revision 1 — it was
dropped in iteration 0 under design 2a; see F8).

### F6 — the allowlist does not make a junk parameter warm a cold entry

The allowlist stops fragmentation and busting: once `/p` is warm, `/p?fbclid=<anything>`
resolves to the `/p` key and is answered at the edge with no origin request. But a
junk-parameter request to a **cold** URL still reaches the origin, still routes to the twin
and still answers `no-store`, so it does not populate the entry.

**Consequence for the slice's own verification step:** the originally-written probe
(`curl -sI '.../?fbclid=junk123'` twice → second is `x-cache: Hit`) **fails for a
legitimate reason** if the bare URL is cold. It has been corrected below to warm the bare
URL first. This is a correction to this document, not a defect in the change.

### F7 — `cdk diff` against the deployed staging stack cannot isolate this slice

`npx cdk diff --app cdk.out AmodxStack-staging` reaches AWS and reports **~630 resource
changes** (629 in the revision-1 run, 630 re-measured in revision 2 — the count moves with
unrelated drift, which is itself the point), including
`[+] AWS::CloudFront::CachePolicy RendererHosting/RendererCachePolicy`
— i.e. the deployed staging stack has no custom cache policy at all and its
`DefaultCacheBehavior.CachePolicyId` is still AWS's managed **CachingDisabled**
(`4135ea2d-6df8-44a3-9df3-4b5a84be39ad`). Staging is many commits behind HEAD, and the diff
also carries the undeployed `cache-1` + `cache-2` changes (the `CACHE-2-D2`
`CreateContentFunc` DynamoDB grant is visible in it). So that diff is **not** a clean
signal for this slice. A source-isolated synth diff was produced instead — see § Build run.
**Operator note:** a staging deploy will apply far more than Track CACHE.

### F8 — a client-side `document.cookie` write is a SILENT NO-OP during migration (revision 1)

This is the defect review iteration 0 was rejected for, and it is the reason the design
moved from option 2a to option 2b.

The middleware set `amodx_ref` with `HttpOnly`. **RFC 6265 §5.3 step 11** requires a user
agent to *ignore* a set-cookie attempt from a non-HTTP API (`document.cookie`) when the
cookie it would replace has the `HttpOnly` flag. So on the day this deploys, every visitor
who landed on a campaign URL in the preceding 30 days — i.e. every returning visitor the
cookie exists for — holds an `HttpOnly` `amodx_ref`, and the iteration-0 snippet's write
over it would have been discarded. Their attribution would have stayed frozen at the stale
value for up to 30 days, and nothing would have surfaced it: the write *appears* to succeed,
and the consumer keeps reading a plausible-looking value.

Not argued from the RFC — **measured in Chromium** (browser probe check 9a): seed the legacy
`HttpOnly; Secure; Path=/` cookie, run
`document.cookie='amodx_ref=js-write; …'`, read the jar back → still `legacy-partner`.

**The fix** is that the cookie is still written by the origin, on
`POST /api/ref` — an HTTP-API write, which §5.3 does not restrict. Check 9b: same seeded
legacy cookie, visit `?ref=new-partner`, the jar holds `new-partner`, one cookie not two,
30-day window renewed, still `HttpOnly`. Check 9c reads the `cookie` header the browser then
sends on the next page request — literally what `app/api/leads/route.ts:31` receives — and
it carries the new value and not the legacy one.

Two things that were costs of 2a disappear with 2b: the cookie keeps `HttpOnly`, and the
"deliberate difference" list shrinks to just the localhost `Secure` conditional.

The residual cost of 2b, stated plainly: the beacon is fire-and-forget, so a blocked or
failed request loses attribution for that visit. That is unavoidable in any design here —
the only capture that cannot fail independently of the page load is a capture on the origin,
and after `cache-1` + this slice the origin does not run for a warm campaign landing at all.

### F9 — synth non-determinism, proven by control rather than asserted (revision 1)

Iteration 0 claimed the four asset-hash / timestamp deltas in the source-isolated diff were
synth non-determinism. Revision 1 proved it: the **same tree was synthesized twice with no
change at all**, and the resulting template diff is exactly those four deltas and nothing
else. See § Build run.

### F10 — the cache key was blind to the session cookie (revision 3, hazard H3)

Found by review iteration 2, not by the original audit and not by any probe in revisions
0–2. **All of those probes drive the origin**, and at the origin `middleware.ts` does route
session traffic to the `no-store` twin. The failure lives entirely in the gap between the
edge and the origin — the gap the cache key exists to describe:

> `RendererCachePolicy` has `cookieBehavior: none()` and, before revision 3, no
> session-derived header. So an authenticated request and an anonymous one hashed to the
> **same cache key**. Once the anonymous entry for a gated page was warm, CloudFront
> answered it and the origin never ran. The visitor got the *"Restricted Access"* shell the
> cacheable route renders for `sessionToken: null`
> (`renderer/src/components/SitePage.tsx`, ACCESS GATEKEEPER), with `s-maxage=31536000`.

**Direction of the defect, stated precisely.** It is not disclosure. The cacheable route is
*given* `sessionToken: null` literally, so it cannot render — and therefore cannot store —
private content. What broke is authenticated access itself: the gate failed **closed**
against the person entitled to the page. `renderer/ARCHITECTURE.md` and the `cache-1` slice
both assert this works, so shipping revisions 1–2 would have shipped a false doc claim
alongside a live functional regression.

**Fix (human decision `CACHE3-SESSION-KEY`, option B).** The existing viewer-request
CloudFront Function derives one bit and the cache policy keys on it:

```javascript
    var SESSION_COOKIE_BASES = ['next-auth.session-token', '__secure-next-auth.session-token'];
    var hasSession = '0';
    var jar = request.cookies || {};
    for (var name in jar) {
        var lower = name.toLowerCase();
        for (var i = 0; i < SESSION_COOKIE_BASES.length; i++) {
            var base = SESSION_COOKIE_BASES[i];
            if (lower === base || lower.indexOf(base + '.') === 0) {
                hasSession = '1';
                break;
            }
        }
        if (hasSession === '1') {
            break;
        }
    }
    request.headers['x-has-session'] = { value: hasSession };
```

Three decisions inside that, each load-bearing:

1. **A derived bit, not the cookie.** Option A (add the session cookie to the cache key)
   keys on the token *value*: a per-visitor string. Every logged-in visitor would get a
   private set of entries — unbounded fragmentation — and a credential would end up inside a
   cache key. One bit adds at most one partition, and in practice adds **zero stored
   entries**: every `x-has-session: 1` request routes to the force-dynamic twin, whose
   `no-store` response `minTtl: 0` declines to store.
2. **Written unconditionally, both values.** The header is in the cache key and headers are
   viewer-supplied. Writing it only on a match would let `x-has-session: <random>` from a
   client survive into the key and mint an entry per value — reintroducing exactly the
   fragmentation vector this slice's query allowlist removes. Overwriting on every request
   bounds the key to two values. Measured: `probe-cache3-cffunc.mjs` §B2.
3. **Prefix match over two base names** — not a substring test, not an exact-name list.
   See F11.

**ES5 only.** CloudFront Functions runtime 1.0 is ECMAScript 5.1 — `var`, no arrow
functions, no `let`/`const`. Template literals are doubly forbidden here: the source is
embedded in a CDK template literal that already interpolates `${props.originVerifySecret}`.

### F11 — the cookie-name family, and the two detectors that must agree

> **Corrected in revision 4.** Revision 3 stated that NextAuth "serves that cookie under more
> than one name: `__Secure-` prefixed when the cookie is `secure` (always, in production)".
> That was **unsupported**, and the review was right to reject it. The correction and its
> evidence are below; every ripple of the old claim in this doc, `caching-architecture.md`,
> `renderer/ARCHITECTURE.md`, `CURRENT_SLICE.md` and the two source files is updated.

**What is actually emitted.** `renderer/src/app/api/auth/[...nextauth]/route.ts:36-46`
configures `cookies.sessionToken.name = 'next-auth.session-token'` explicitly. Installed
next-auth is **4.24.14** (`node_modules/next-auth/package.json`), and its option merge is a
**top-level spread**:

```javascript
// node_modules/next-auth/core/init.js:59-61
cookies: {
  ...cookie.defaultCookies(authOptions.useSecureCookies ?? url.base.startsWith("https://")),
  ...authOptions.cookies
}
```

`authOptions.cookies.sessionToken` therefore *replaces* the default entry wholesale — the
`__Secure-` prefix that `defaultCookies(true)` would apply
(`core/lib/cookie.js:17-27`) never reaches the emitted name while this config stands. And
chunk names are derived from the configured name, not the default
(`core/lib/cookie.js:151-153`, `` const name = `${cookie.name}.${i}` ``).

| Name | Status | Basis |
|---|---|---|
| `next-auth.session-token` | **emitted today** | the explicit config above |
| `next-auth.session-token.0`, `.1`, … | **emitted today** when the JWT > 4096 B | `core/lib/cookie.js:151-153` |
| `__Secure-next-auth.session-token` (+ chunks) | **compatibility / legacy coverage** | what next-auth would emit if the explicit `cookies` block were removed; also what a cookie issued before that block existed still carries |

Matching the `__Secure-` family costs nothing and a missed session cookie is the expensive
direction, so it stays in the list — labelled for what it is, not asserted as current
behaviour.

**The predicate is PREFIX, not substring** (revision 4; revision 3 shipped a substring test
and the review rejected it). A name matches iff `name === base` or `name` starts with
`base + '.'` — `.` being NextAuth's chunk separator — compared case-insensitively. A
substring test also matched names that merely *embed* a base
(`x-next-auth.session-token-decoy`, `next-auth.session-tokenX`, `evil__secure-…`), which is
not a family member and needlessly widens the set of requests a viewer can push past the edge
cache. An exact-name list is the opposite error: it misses the chunks.

**Shared source of truth:** the NextAuth config line above. Two detectors derive from it —

| Detector | Where | Predicate |
|---|---|---|
| edge | `infra/lib/renderer-hosting.ts`, `HostRewriteFunction` | `lower === base \|\| lower.indexOf(base + '.') === 0` over `var SESSION_COOKIE_BASES` |
| origin | `renderer/middleware.ts`, `hasSessionCookie()` | the identical expression over `const SESSION_COOKIE_BASES` |

They must classify **every** cookie name identically. They cannot import a common constant:
`infra/` is a deploy-time CDK package with no dependency on the renderer, and adding that
dependency edge to share two string literals would be a new architectural boundary bought
very cheaply. **Rejected in favour of enforcing the invariant by test**, which is stronger
than a shared constant would have been anyway — a shared constant would not have caught the
*shape* of the predicate diverging (exact-match vs substring vs prefix), which is the failure
that actually occurred twice in this slice. `probe-cache3-cffunc.mjs` §C extracts both
`SESSION_COOKIE_BASES` arrays — the edge one from the **synthesized template**, not from the
`.ts` source — asserts they are equal *and* are the two ratified names, pins the middleware
predicate's source shape (including negative assertions that the withdrawn
`SESSION_COOKIE_MARKER` and `.includes(` forms are gone), and runs a 31-name corpus through
both looking for a disagreement.

Mismatch direction matters and is documented in both files: if the edge **under**-matched,
an authenticated request would key as anonymous and H3 would be open again. If it
**over**-matched, the request merely misses the cache and renders correctly. Over-match is
the safe side if this ever drifts — which is why the case-insensitive comparison and the
legacy `__secure-` entry are both kept, and why the *only* narrowing revision 4 made is the
one that removes non-family names.

### F12 — chunked session cookies: routing corrected here, authentication deferred

> **Corrected in revision 4.** Revision 3 titled this "revision 3 also fixed a pre-existing
> middleware bug" and claimed chunked-session users were fixed. **The routing was fixed; the
> authentication was not.** The review verified this and it is stated accurately below.

Before revision 3, `middleware.ts` tested `request.cookies.has(name)` against two exact
names. A **chunked** session (`next-auth.session-token.0` / `.1`) matched neither, so an
authenticated visitor whose JWT exceeded 4096 bytes was routed to the *cacheable* route.

That routing is now correct on both layers: such a request keys as `x-has-session: 1` at the
edge and is rewritten to the `no-store` twin at the origin, so it can neither hit nor
populate an anonymous cache entry. Measured: `probe-cache3.sh` §F3/§F3b (origin),
`probe-cache3-cffunc.mjs` §B (edge, against the synthesized template).

**What is still broken, and is NOT fixed by this slice.** The twin's `readSessionToken()`
(`renderer/src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:33-38`) reads two exact, unchunked
cookie names and returns `null` for anything else; it neither collects nor concatenates
chunks. So a chunked-session visitor reaches `SitePage` with `sessionToken: null` and the
ACCESS GATEKEEPER still denies gated content — it now does so after correctly bypassing the
cache instead of from a cached shell. Twin routes are explicitly out of this packet's scope
(*"Do not touch the ISR/twin routes"*), so this is **recorded as deferred debt, not silently
widened**: `docs/TECH-DEBT.md` § *Chunked NextAuth session cookies are not reassembled*, with
the fix shape. Read the §F probe rows as routing evidence only.

**Deviation declared for the reviewer**: the session-detection block of `middleware.ts`,
outside the attribution block the packet scoped, changed. Reason: the packet also requires
the two detectors to agree, and the old exact-name predicate disagrees with any edge
predicate that covers chunks. The change is a strict superset of the old predicate over real
NextAuth names (every name the old code matched, the new code matches), so the only routing
that moves is chunked sessions, from cacheable to twin. Measured: `probe-cache3.sh` §F1–F6 —
plain, legacy `__Secure-`, and both chunked shapes reach the twin;
`__Host-next-auth.csrf-token`, `…callback-url`, `amodx_ref`, `_ga` and the two embedding
decoys still reach the cacheable route, i.e. no over-match into a cache-hit-rate regression.

### F13 — `cdk diff` is replaced as the evidence gate (decision `CACHE3-STAGING-DRIFT`)

F7 established that `npx cdk diff --app cdk.out AmodxStack-staging` (the `--app` form, run
against an assembly already synthesized with `-c stage=staging`) reports ~630 resource changes because
deployed staging is many commits behind HEAD. The human ratified **staged reconcile**: the
bounded-diff gate is dropped for this slice, and the deployment plan absorbs the drift on
staging first (§ *Deployment*). The evidence gate becomes the source-isolated synth
comparison plus that written plan. Re-run in revision 3 and reproduced below; the diff is
now the **three** intended deltas — CF function body, header allowlist, query allowlist —
against the seven known non-determinism hunks, with a same-tree control establishing that
floor.

## Design (ratified approach — D3, amended in revision 1)

1. Query-string allowlist in `RendererCachePolicy`, enumerated from the code. This changes
   only the cache **key**; `RendererOriginPolicy` still forwards full query strings.
2. Attribution capture moves off page responses. **Option 2b**: a constant inline snippet
   triggers the capture in the browser, and an uncached `/api/ref` route performs the write,
   preserving `HttpOnly`.
   *Option 2a (write `document.cookie` directly, dropping `httpOnly`) was adopted in
   iteration 0 and withdrawn in revision 1 — it cannot overwrite the pre-deploy `HttpOnly`
   cookie at all (F8). The extra route and round-trip that 2a was chosen to avoid are the
   price of a correct migration, and they buy back `HttpOnly` as well.*
3. Middleware keeps the origin-verify check, the host gate and the rewrites — unchanged.
4. **(revision 3)** Session discrimination is paired across the two layers: the CloudFront
   Function derives `x-has-session` into the cache key so the request reaches the origin at
   all; middleware then routes it to the twin as before. Both use the same **prefix**
   predicate over the same two base names (F11, narrowed from substring in revision 4).
   Cookies stay out of the cache key.

## Non-scope

- No per-tenant CloudFront invalidation scoping (doc §Known Gaps 3, Workstream 3).
- No CDK changes beyond **two existing constructs in `infra/lib/renderer-hosting.ts`** —
  `RendererCachePolicy` and the viewer-request `HostRewriteFunction`. (Revision 3 widened
  this from "the one cache-policy construct": decision `CACHE3-SESSION-KEY` = option B puts
  the session derivation in the Function, so the Function body is in scope. No new
  construct, no new file, no other CDK file touched — `git diff --stat infra/` is one file.)
- No cookie-based personalization work.
- No consent gating for `amodx_ref` (it was not gated before; §Known Gaps 14).
- No middleware-side query allowlist (F6 — rejected as a second, unsynchronised copy).

## Architectural boundaries

- CDK change is **three semantic deltas across two existing constructs**, both in
  `infra/lib/renderer-hosting.ts` — this is what the source-isolated synth comparison
  measures (F9/F13), and it is the number to check the diff against:

  | # | Construct | Delta |
  |---|---|---|
  | 1 | `RendererCachePolicy` | `headerBehavior` allowlist: `X-Forwarded-Host` → + `RSC`, `Next-Router-Prefetch`, `Next-Router-State-Tree`, `Next-Router-Segment-Prefetch`, `x-has-session` (6 total) |
  | 2 | `RendererCachePolicy` | `queryStringBehavior`: `all()` → `allowList(page, q, availability, id, email, preview, nf)` |
  | 3 | `HostRewriteFunction` | function body gains the `SESSION_COOKIE_BASES` loop that writes `x-has-session: '0'\|'1'` (revision 3, decision `CACHE3-SESSION-KEY` = B) |

  Deltas 1 and 3 are **one unit** and must deploy and roll back together — see § *Rollback*.
  (Revisions 0–2 described this as "a two-property edit on an existing construct". That was
  accurate before the session bit existed and is now superseded; the phrasing is corrected
  here rather than left as a second, stale scope statement.)
- **No distribution replacement** either way: the distribution keeps its logical id and only
  its `DefaultCacheBehavior.CachePolicyId` moves, which CloudFormation applies in place. The
  Function is likewise updated in place — same logical id, same `functionName`.
  Whether the *policy* is an UPDATE or a CREATE depends on the target environment — against
  the deployed `AmodxStack-staging` it is a CREATE (`[+] AWS::CloudFront::CachePolicy`,
  measured; staging never had the custom policy deployed, F7). Against an environment
  already running `RendererCachePolicy` it is an in-place UPDATE. Confirmed by the
  source-isolated template diff plus the determinism control (F9).
- Attribution semantics (30-day window, `ref` precedence over `utm_source`, `HttpOnly`)
  preserved and measured, including across the legacy-cookie migration (F8).
- No abstraction was introduced. `ReferralCapture` is a single component with one caller and
  `api/ref` is a single route with one caller; both exist because the trigger has to run in
  the browser and the write has to happen on the origin — not to create a seam.
- **Revision 3 added no module, interface or shared package either.** The session bit is
  ~9 lines inside the CloudFront Function that already exists and one entry in the header
  allowlist. The one abstraction that was *considered* — a shared session-cookie-name
  constant in `packages/shared`, imported by both `infra/` and `renderer/` — was **rejected**:
  it would create a new dependency edge from the deploy-time CDK package to a runtime
  package in order to share a single string literal, and it would not even catch the failure
  mode that actually occurred (the two predicates differing in *shape*, F12). A test that
  reads both implementations and compares their classifications does catch that, and adds no
  structure to the shipped system.

## Definition of Done

1. ✅ Cache policy uses an explicit allowlist; the list + per-parameter justification
   documented (`docs/caching-architecture.md` § *Cache Policy (Default Behavior)*), with the
   safety argument stated as the two halves that are actually load-bearing (F2).
2. ✅ No code path sets cookies on cacheable (public, non-carve-out) HTML responses —
   measured across six request shapes, zero `Set-Cookie: amodx_ref`. The one `Set-Cookie`
   the change adds is on `POST /api/ref`, which is uncacheable three ways over (POST, the
   `CachingDisabled` `api/*` behavior, `no-store`).
3. ✅ Attribution still captured end-to-end — **23/23** browser checks pass, including the
   cookie being sent back to the origin (what the sole consumer reads) **and the migration
   from the pre-deploy `HttpOnly` cookie** (F8, checks 9a–9c).
4. ✅ `docs/caching-architecture.md` cache-policy section, §Open hazards (H1 → CLOSED, and
   the stale "one hazard remains open" line removed) and §Known Gaps 10 + 14 updated.
5. ✅ **(revision 3, re-measured in revision 4)** An authenticated request cannot match a warm
   anonymous cache entry: `x-has-session` is in the synthesized header allowlist, is derived
   at the edge from the cookie jar, and cannot be forged by a viewer. **39/39**
   `probe-cache3-cffunc.mjs` checks against the synthesized template, plus **7** origin rows
   (`probe-cache3.sh` §F) showing every session-cookie shape — including both chunked
   families — reaching the `no-store` twin, and no non-session cookie and no embedding decoy
   doing so.
6. ✅ **(revision 3, tightened in revision 4)** The edge and origin session detectors are
   pinned equal by test — both `SESSION_COOKIE_BASES` arrays and the predicate shape — and
   the shared source of truth for the cookie names, with the evidence for which names are
   actually emitted, is named in both files (F11).
7. ✅ **(revision 4)** Chunked-session **authentication** is stated as still broken and
   deferred, not claimed fixed; recorded in `docs/TECH-DEBT.md` with the fix shape (F12).
8. ⬜ **(revision 3, operator)** WARM-EDGE session probe post-deploy — the one assertion no
   local probe can make, because it requires a real CloudFront hit. § *Deployment*, probe 6.

## Revision 2 (2026-07-26) — documentation corrections only, no behaviour change

Review iteration 1 accepted the code (allowlists, synthesized policy, the `/api/ref`
migration) and blocked on three places where the *cache-safety explanation* was wrong. No
`.ts`/`.tsx` behaviour changed in this revision; the infra edit is comment-only and the
synthesized template is byte-identical apart from the known asset/timestamp deltas (F9).

| # | Was | Now |
|---|---|---|
| R1 | `renderer-hosting.ts` header comment and `caching-architecture.md` § *Cache Policy*: "anything left out of this key still reaches the render" | Stated as what it is — a cache-**MISS** property. On a warm entry CloudFront answers first and the origin, middleware and render never run. Explicitly labelled as *not* a safety argument |
| R2 | `renderer-hosting.ts`: "two halves and **only the second is about the middleware**" | "two halves and **NEITHER** is about the middleware" — (a) is *keyed → forced miss*, (b) is *code inspection*. Middleware cannot rescue the key because it runs after the edge decision |
| R3 | `renderer/ARCHITECTURE.md`: routing query requests to the twin "is precisely what makes the allowlist safe" | Replaced with the two actual reasons; the twin property is restated as what it really buys (a query-string request can never *populate* an entry) |
| R4 | `architecture-deep -dive.md` CloudFront box still read `Key = X-Forwarded-Host + path + query strings` | Ripple missed in revision 1. Box now shows the RSC header family and the 7-parameter query allowlist; the origin-policy line is marked *forwarded, NOT the cache key* |
| R5 | "21/21 browser checks" | **Miscount in revision 1.** `probe-cache3-browser.mjs` contains 23 `check()` assertions (`grep -c '^\s*check('` = 23) and prints 23 `PASS` lines. Corrected to 23/23 everywhere |

**Basis for the completeness claim on R1–R3** (the reviewer asked for the search basis):
`rg` over the repo excluding `node_modules`, `cdk.out`, `.next`, `.agent-manager` — a
deterministic literal/regex text scan, not an index or call graph — for
`"still reach|reaches the render|reaches the origin"`, `"forwarding rule"`,
`"makes the allowlist|allowlist safe|is precisely what|safe because"`, and
`"(twin|middleware).*(allowlist|cache key)|(allowlist|cache key).*(twin|middleware)"`.
After the edits the only surviving hits are the corrected passages
(`renderer/ARCHITECTURE.md:233`, `caching-architecture.md:1295`, and the slice-doc
CORRECTION note at F2, which quotes the rejected argument deliberately in order to record
it). The scan is reliable for these distinctive phrases; a paraphrase that shares no
keyword with them would evade it, which is why every file that mentions `allowlist` or
`cache key` at all was also listed and read.

## Revision 3 (2026-07-27) — the session hazard, and the evidence gate the human replaced

Review iteration 2 **escalated** rather than rejecting the code: the allowlists, the
synthesized policy and the `/api/ref` migration were all confirmed, and two decisions were
raised to the human. Both were ratified (§ *Ratified resolutions*) and both are applied here.

| # | Finding (review iteration 2) | Resolution in revision 3 |
|---|---|---|
| S1 | Cache key blind to the session cookie — a warm anonymous entry is served to a logged-in visitor on gated pages | `CACHE3-SESSION-KEY` = **option B**. `x-has-session: 0\|1` derived in the existing viewer-request Function, added to the header allowlist; cookies stay out of the key. F10 |
| S2 | Existing probes exercise the origin and structurally cannot see S1 | Two new probe surfaces: `probe-cache3-cffunc.mjs` (29 checks, runs the function body **out of the synthesized template**) and `probe-cache3.sh` §F (5 origin rows). The genuinely un-probeable half is stated as an operator gate, not claimed. F10, § *Deployment* probe 6 |
| S3 | `cdk diff` reports ~630 drifted changes, so it is not a clean deploy gate | `CACHE3-STAGING-DRIFT` = **staged reconcile**. Gate replaced by the source-isolated synth comparison + a written staged-reconcile deployment plan. F13, § *Deployment* |
| S4 | `renderer/ARCHITECTURE.md` structure tree omits `/api/ref` | Tree updated — and `account/orders` + `profile`, omitted since before this slice, added with it, plus `components/ReferralCapture.tsx`. The tree now matches `find renderer/src/app/api -name route.ts` exactly (10 routes) |
| S5 | `docs/caching-architecture.md` still claims all **eight** API routes were enumerated | Corrected to **nine** with `ref` named, and why `ref` is exempt from the D4 "never fabricate absence" rule (it is a write with no absence to fabricate) |

Two further corrections revision 3 made that the review did not ask for, both consequences
of S1 being real:

- **Middleware's chunked-cookie routing.** Exact-name session matching missed NextAuth's
  chunked cookies. Both detectors now cover them. This is a change outside the packet's
  stated renderer scope and is declared as such — F12. *(Revision 3 overstated this as
  fixing chunked authentication; see F12 and revision 4.)*
- **Two stale doc claims** that stated the access gate as working from the middleware rule
  alone (`docs/caching-architecture.md` H1's "no per-visitor state reaches a cacheable
  render (session requests go to the dynamic twin)", and
  `docs/security-remediation-status.md`'s re-verification bullet). Both are exactly the
  reasoning error revision 2 corrected elsewhere — *a middleware property described as if it
  held at the edge* — surviving in two places the revision-2 scan's phrase list did not
  reach. Both now state the edge mechanism explicitly.

## Revision 4 (2026-07-27) — the session predicate, and two evidence claims that were not earned

Review iteration 2 confirmed the code surface again (allowlists, synthesized policy,
`/api/ref`, the 29/29 function probe) and rejected the *predicate* and two *claims*. All four
required changes are applied.

| # | Finding (review iteration 2) | Resolution in revision 4 |
|---|---|---|
| R1 | Both detectors used a **substring** test, so `x-next-auth.session-token-decoy` classified as a session — and the probe deliberately accepted it. The ratified resolution says *prefix*, covering `.0`/`.1` chunks | Predicate narrowed on both layers to `name === base \|\| name.startsWith(base + '.')` over `SESSION_COOKIE_BASES = ['next-auth.session-token', '__secure-next-auth.session-token']`. Five embedding decoys added to the probe as **negative** cases, plus an origin row (`probe-cache3.sh` §F6). F11 |
| R2 | The documented cookie-name source of truth was wrong: next-auth 4.24.14 merges the repo's explicit `cookies` config **over** its secure-prefixed default, so `__Secure-next-auth.session-token` is **not** emitted today, and chunking starts from the *configured* name | F11 rewritten with the merge evidence (`core/init.js:59-61`, `core/lib/cookie.js:151-153`) and an emitted-vs-legacy table. `__Secure-` is now described as compatibility/legacy coverage everywhere: this doc, `caching-architecture.md`, `renderer/ARCHITECTURE.md`, `CURRENT_SLICE.md`, and the code comments in `renderer-hosting.ts` + `middleware.ts` |
| R3 | "Fixed a pre-existing chunked-session bug" was false. Middleware now *routes* chunked sessions to the twin, but the twin reads two exact unchunked names and never reassembles, so `sessionToken` is still `null` and gated content is still denied | F12 retitled and rewritten to separate routing (fixed, measured) from authentication (still broken). Recorded as deferred debt in `docs/TECH-DEBT.md` with the fix shape. All "pre-existing bug fixed" wording removed from this doc, `caching-architecture.md`, `renderer/ARCHITECTURE.md` and `CURRENT_SLICE.md` |
| R4 | Re-run validation after correcting the predicate and the oracle | Full re-run below: infra build, renderer typecheck + build, synth, source-isolated comparison + determinism control, 39/39 function probe, origin matrix incl. §F6, 23/23 browser suite, infra jest, backend unit |

No new module, interface, package or config layer in this revision either. The predicate is
a two-element array plus a two-condition test, duplicated on each side of a boundary that
cannot be crossed by an import, with the duplication pinned equal by test — the same trade
F11 recorded in revision 3, now with a sharper predicate.

## Revision 5 (2026-07-27) — three documentation defects; no behaviour change

Review iteration 3 **accepted the implementation** (allowlists, unconditional
`x-has-session`, matching prefix predicates, `amodx_ref` off page responses; the reviewer
independently re-ran `probe-cache3-cffunc.mjs` and got 39/39 against the synthesized
template) and blocked on three defects, all in prose. Nothing in this revision changes
runtime, deploy-time or probe behaviour: the only non-`.md` edit is a **comment** in
`infra/lib/renderer-hosting.ts`, and it sits *outside* the `FunctionCode.fromInline`
template literal, so the synthesized template is unchanged (verified — row 5 below).

| # | Finding (review iteration 3) | Resolution in revision 5 |
|---|---|---|
| D1 | The mandatory staging deploy command omitted `-c stage=staging`. `infra/bin/infra.ts:12` defaults `stage` to `prod`, and the app instantiates exactly one stack from the matching config file — so the documented command does not deploy the wrong stack, it finds **no** stack | § *Deployment* step 1 now reads `npx cdk deploy AmodxStack-staging -c stage=staging`, with the `infra/bin/infra.ts:12,19,32-42` mechanism and the `amodx.staging.json` → `"stackName"` fact spelled out. Step 3 explicitly notes that production omits the flag *because* `prod` is the default. The two `NOT RUN` rows in the historical build-run tables that quote the flagless form are called out in place rather than rewritten — nothing was measured with them |
| D2 | § *Non-scope* and § *Architectural boundaries* still said "the one cache-policy construct" / "a two-property edit on an existing construct", contradicting the three semantic deltas the combined diff and the source-isolated evidence actually show | Both statements replaced with the real scope: **three semantic deltas across two existing constructs** (`RendererCachePolicy` header allowlist, its query allowlist, `HostRewriteFunction` body), as a table, with the superseded phrasing named as superseded so it does not read as a second live scope claim. Also records that deltas 1 and 3 are one rollback unit |
| D3 | Two name ripples: `CURRENT_SLICE.md:116` still said "revision 3", and `infra/lib/renderer-hosting.ts:289` cited a nonexistent middleware function `isSessionCookieName` | `CURRENT_SLICE.md` § *Recently Completed* now says revision 5 and § *Current Priority* records what revision 5 was; the comment now cites `hasSessionCookie()`, which is the real name (`renderer/middleware.ts:62`) |

**D3 is the interesting one and is worth naming as a class**, because it is the failure this
repo's own rules warn about: a comment asserting a cross-file contract (*"middleware applies
the identical predicate"*) while naming a symbol that does not exist. The contract itself was
true — `probe-cache3-cffunc.mjs` §C pins it by extracting both arrays and comparing
classifications — but a reader following the comment would have found nothing, and a reader
who *trusted* the comment would have concluded the pairing was unverified. The pointer, not
the invariant, was broken. The probe is what makes the invariant real; the comment only has
to name the right symbol so a human can reach it.

**Completeness basis for D2/D3 ripples:** deterministic `grep -rn` literal scans (a text
scan, not an index or call graph) over `docs/`, `renderer/`, `infra/` and `CURRENT_SLICE.md`,
excluding `node_modules`/`cdk.out`/`.next`, for `isSessionCookieName`, `hasSessionCookie`,
`SESSION_COOKIE_BASES`, `two-property`, `one cache-policy construct`, `two properties`,
`cdk deploy`, `cdk diff`, `cdk synth`, and `revision 3|revision 4`. Surviving `revision 3`
hits are historically correct (H3 *was* closed in revision 3) and were read individually to
confirm each describes when something happened rather than the slice's current state.

## Build run — 2026-07-27 (revision 5; full re-run, supersedes the revision-4 run)

The revision-5 edit is prose plus one code **comment**, so the interesting evidence is
negative: proving the synthesized template did not move. Everything was re-run anyway
rather than inherited, because "a comment cannot change the output" is exactly the kind of
claim that should be measured rather than asserted — the comment sits ~14 lines above a
`FunctionCode.fromInline` template literal, and being *outside* it is a fact about the
source, not a guarantee.

| # | Exact command | Result |
|---|---|---|
| 1 | `npm run build` (root, 8 workspaces, dependency order) | **EXECUTED** — exit 0, zero `error`/`failed` lines |
| 2 | `cd infra && npm run build` | **EXECUTED** — `tsc` clean |
| 3 | `cd renderer && npx tsc --noEmit` | **EXECUTED** — exit 0 |
| 4 | `cd infra && npx cdk synth -c stage=staging --quiet -o /tmp/cdk.out.rev5` | **EXECUTED** — exit 0, 486 resources |
| 5 | `diff -u <rev-4 template> <rev-5 template>` — did the comment move the output? | **EXECUTED** — 1109 lines / 123 hunks, and **every one is noise**: filtering `S3Key` / `aws:asset:path` / `asset.<sha256>` leaves only the two `physicalResourceId` `Date.now()` stamp lines. Command: `grep -E '^[+-]' … \| grep -viE 's3key\|aws:asset:path\|"asset\.\|[0-9a-f]{64}'`. Archived `…/template-rev5-vs-rev4.diff`. **Why 123 hunks here but 7 in the 5d control:** the rev-4 template predates a full root `npm run build` (row 1) and the rev-5 one follows it. **OBSERVED:** every Lambda asset SHA-256 moves across a root rebuild. **INFERRED:** the bundler's output is not byte-reproducible across builds. Either way it is a property of the *build*, not of this slice — which is why 5c/5d re-run only `cd infra && npm run build` (`tsc` only) between synths, leaving the backend bundles on disk untouched and the asset side constant |
| 5b | Byte-identity of the two constructs this slice touches | **EXECUTED** — extracted every `AWS::CloudFront::CachePolicy` + `AWS::CloudFront::Function` resource from both templates and hashed the canonical JSON: `aeca6129133c73eaecf9301a10f15470` on **both**. This is the direct proof for row 5's claim, not an inference from it |
| 5c | **Source-isolated synth comparison** (the packet's evidence gate) — synthesize twice with only `infra/lib/renderer-hosting.ts` swapped between its `HEAD` (pre-slice, 401 lines) and this slice's (595 lines), everything else identical | **EXECUTED** — **102 lines / 9 hunks**, of which exactly **2 hunks are semantic** (per-hunk classification below) and 7 are the measured noise floor. Filtering `S3Key`/`aws:asset:path`/`asset.<sha256>`/`physicalResourceId` leaves **only** the three intended deltas: the `HostRewriteFunction` body, the header allowlist, the query allowlist. Two hunks rather than three because the two `RendererCachePolicy` property edits are adjacent and `diff` merges them. Archived `.agent-manager/slices/CACHE-3/source-isolated-synth-rev5.diff` |
| 5d | Determinism control — the **same** tree synthesized twice | **EXECUTED** — **65 lines / 7 hunks**, every one asset-hash or `Date.now()` timestamp, zero semantic lines. The floor in 5c is **measured in this run**, not carried over. Archived `…/synth-determinism-control-rev5.diff` |
| 6 | `node .agent-manager/slices/CACHE-1/probe-harness/probe-cache3-cffunc.mjs` | **EXECUTED** — **39 pass / 0 fail**, run against the freshly synthesized template (matches the reviewer's own independent 39/39) |
| 7 | `bash .agent-manager/slices/CACHE-1/probe-harness/probe-cache3.sh` | **EXECUTED** — exit 0, 24 sections, 0 `FAIL`. §D2 prints `OK: no amodx_ref Set-Cookie on any page response`; the only `Set-Cookie: amodx_ref` lines in the whole log are §E1/§E3, i.e. `POST /api/ref`. §F1–F3b → `private, no-cache, no-store`; §F4/F5/**F6 (the prefix decoys)** → `s-maxage=31536000` |
| 8 | `node .agent-manager/slices/CACHE-1/probe-harness/probe-cache3-browser.mjs` (real Chromium) | **EXECUTED** — **23 PASS / 0 FAIL**, incl. the F8 legacy-`HttpOnly` migration |
| 9 | `cd infra && npm test` | **EXECUTED** — 1/1. Honest: asserts only "SQS Queue Created"; **not** coverage for this change |
| 10 | `cd backend && npm run test:unit` | **EXECUTED** — 17/17 |
| 11 | `git diff --check` | **EXECUTED** — exit 0, no whitespace errors |
| 12 | Ripple scan (`grep -rn`, excluding `node_modules`/`cdk.out`/`.next`/`.git`/`dist`) for `isSessionCookieName`, `two-property`, `one cache-policy construct`, `two properties`, and every `npx cdk synth\|deploy\|diff` in `docs/` + `CURRENT_SLICE.md` | **EXECUTED** — every surviving hit of the three stale strings is inside the § *Revision 5* correction record, which quotes them deliberately. Every staging-targeting `cdk` command now either carries `-c stage=staging` or uses `--app cdk.out` (which reads an assembly already synthesized with it). One extra ripple found and fixed by this scan, beyond the review's list: F13 paraphrased F7's measurement as the flagless `npx cdk diff AmodxStack-staging`; corrected to the `--app cdk.out` form that was actually run |
| 13 | `cd backend && npm test` | **NOT RUN** — real staging DynamoDB, excluded by the packet |
| 14 | `npx cdk diff` (any form, reaching AWS) | **NOT RUN** — superseded as the gate by `CACHE3-STAGING-DRIFT` (F13). If you run it by hand against staging, add `-c stage=staging` |
| 15 | `cdk deploy` | **NOT RUN** — operator gate |
| 16 | Post-deploy probes incl. the **WARM-EDGE session probe** | **NOT RUN** — operator gate, § *Deployment*. Structurally un-runnable here: no origin `curl` can fail the H3 way |

Rows 6–8 need no AWS. Reproduce with the § *Probe harness* recipe below (DynamoDB stub on
8123 + `next start -p 3111`); both servers were stopped at the end of the run (verified —
`pgrep` empty, port 3111 refuses). **The harness directory is gitignored (`.gitignore:35`),
so probe files never appear in `git diff`.**

### Output surface (revision 5 — unchanged from revision 4, which is the point)

Synthesized `RendererCachePolicy` cache key:

```json
"HeadersConfig": { "HeaderBehavior": "whitelist", "Headers": [
  "X-Forwarded-Host", "RSC", "Next-Router-Prefetch",
  "Next-Router-State-Tree", "Next-Router-Segment-Prefetch", "x-has-session" ] },
"QueryStringsConfig": { "QueryStringBehavior": "whitelist", "QueryStrings": [
  "page", "q", "availability", "id", "email", "preview", "nf" ] },
"CookiesConfig": { "CookieBehavior": "none" }
```

Synthesized `HostRewriteFunction` body (the `Fn::Join` is the `x-origin-verify` secret
resolution, unchanged by this slice):

```js
function handler(event) {
    var request = event.request;
    var host = request.headers.host ? request.headers.host.value : '';
    request.headers['x-forwarded-host'] = { value: host };
    request.headers['x-origin-verify'] = { value: '{{resolve:secretsmanager:…}}' };

    var SESSION_COOKIE_BASES = ['next-auth.session-token', '__secure-next-auth.session-token'];
    var hasSession = '0';
    var jar = request.cookies || {};
    for (var name in jar) {
        var lower = name.toLowerCase();
        for (var i = 0; i < SESSION_COOKIE_BASES.length; i++) {
            var base = SESSION_COOKIE_BASES[i];
            if (lower === base || lower.indexOf(base + '.') === 0) {
                hasSession = '1';
                break;
            }
        }
        if (hasSession === '1') {
            break;
        }
    }
    request.headers['x-has-session'] = { value: hasSession };

    return request;
}
```

## Build run — 2026-07-27 (revision 4; superseded by the revision-5 run above, kept for the record)

### Evidence

| # | Command | Result |
|---|---|---|
| 1 | `cd infra && npm run build` | **EXECUTED** — `tsc` clean, no output |
| 2 | `cd renderer && npx tsc --noEmit` | **EXECUTED** — clean, exit 0 |
| 3 | `cd renderer && npx next build` | **EXECUTED** — 19 routes. `[siteId]/[[...slug]]` and `[siteId]/products/[productId]` still `●` (ISR preserved — the middleware predicate edit did not disturb the rendering modes); `/api/ref` present as `ƒ` |
| 4 | `cd infra && npx cdk synth -c stage=staging --quiet -o cdk.out.rev4` | **EXECUTED** — exit 0, 486 resources. Afterwards `cdk.out.rev4` was renamed to the default `infra/cdk.out` (and the throwaway `cdk.out.base4`/`cdk.out.ctl4` from rows 5/5b removed) so the working tree stays clean for review; the archived `.diff` files are the evidence |
| 5 | Source-isolated synth comparison vs pre-slice `infra/lib/renderer-hosting.ts` (HEAD) | **EXECUTED** — 54 lines / 10 hunks = **3 semantic + the 7-hunk noise floor**. Archived at `.agent-manager/slices/CACHE-3/source-isolated-synth-rev4.diff` |
| 5b | Determinism control: same tree synthesized twice, no source change | **EXECUTED** — exactly **28 lines / 7 hunks**, all asset-hash or `Date.now()` timestamp. Archived at `.agent-manager/slices/CACHE-3/synth-determinism-control-rev4.diff`. The floor is measured, not asserted |
| 6 | `node .agent-manager/slices/CACHE-1/probe-harness/probe-cache3-cffunc.mjs` (rewritten for the prefix contract) | **EXECUTED** — **39/39 PASS**, `ALL CHECKS PASSED`, against the synthesized template (`infra/cdk.out/`). Includes the 5 decoy negatives and the two-array equality check |
| 7 | `bash probe-cache3.sh` (origin matrix; §F extended with F3b + F6) | **EXECUTED** — exit 0, all rows reproduce. §F1–F3b: plain / legacy `__Secure-` / both chunked families → `private, no-cache, no-store, max-age=0, must-revalidate` (twin). §F4–F6: NextAuth non-session cookies, `amodx_ref`+`_ga`, and the two embedding decoys → `s-maxage=31536000` (cacheable, no over-match) |
| 8 | `node probe-cache3-browser.mjs` (real Chromium, attribution + migration) | **EXECUTED** — **23 PASS / 0 FAIL**, `ALL CHECKS PASSED` |
| 9 | `cd infra && npm test` (jest) | **EXECUTED** — 1/1 pass. Honest note unchanged: the suite asserts only "SQS Queue Created"; it is not coverage for this change. The coverage for this change is item 6 |
| 10 | `cd backend && npm run test:unit` (vitest, no network) | **EXECUTED** — 17/17 pass |
| 11 | `cd backend && npm test` | **NOT RUN** — hits real staging DynamoDB; excluded by the packet |
| 12 | `npx cdk diff AmodxStack-staging` | **NOT RUN** — superseded as the gate by decision `CACHE3-STAGING-DRIFT` (F13); the revision-2 measurement stands in F7 and nothing about staging changed since |
| 13 | `cdk deploy` | **NOT RUN** — operator gate |
| 14 | Post-deploy CloudFront probes, incl. the WARM-EDGE session probe | **NOT RUN** — operator gate, § *Deployment* |

### Synthesized artefacts (revision 4, from `infra/cdk.out/AmodxStack-staging.template.json`)

```json
"RendererHostingRendererCachePolicy294243B3": {
  "Type": "AWS::CloudFront::CachePolicy",
  "Properties": { "CachePolicyConfig": {
    "DefaultTTL": 0, "MaxTTL": 31536000, "MinTTL": 0,
    "Name": "AmodxStack-staging-RendererCache",
    "ParametersInCacheKeyAndForwardedToOrigin": {
      "CookiesConfig": { "CookieBehavior": "none" },
      "EnableAcceptEncodingBrotli": true, "EnableAcceptEncodingGzip": true,
      "HeadersConfig": { "HeaderBehavior": "whitelist", "Headers": [
        "X-Forwarded-Host", "RSC", "Next-Router-Prefetch",
        "Next-Router-State-Tree", "Next-Router-Segment-Prefetch",
        "x-has-session" ] },
      "QueryStringsConfig": { "QueryStringBehavior": "whitelist", "QueryStrings": [
        "page", "q", "availability", "id", "email", "preview", "nf" ] }
    } } }
}
```

`RendererHostingHostRewriteFunction74F77A19.Properties.FunctionCode`, with the
`{{resolve:secretsmanager:…}}` dynamic reference elided:

```javascript
function handler(event) {
    var request = event.request;
    var host = request.headers.host ? request.headers.host.value : '';
    request.headers['x-forwarded-host'] = { value: host };
    request.headers['x-origin-verify'] = { value: '<secretsmanager ref>' };

    var SESSION_COOKIE_BASES = ['next-auth.session-token', '__secure-next-auth.session-token'];
    var hasSession = '0';
    var jar = request.cookies || {};
    for (var name in jar) {
        var lower = name.toLowerCase();
        for (var i = 0; i < SESSION_COOKIE_BASES.length; i++) {
            var base = SESSION_COOKIE_BASES[i];
            if (lower === base || lower.indexOf(base + '.') === 0) {
                hasSession = '1';
                break;
            }
        }
        if (hasSession === '1') {
            break;
        }
    }
    request.headers['x-has-session'] = { value: hasSession };

    return request;
}
```

### Source-isolated synth comparison (revision 4)

Procedure unchanged from revisions 2–3 (F7/F9 — deployed staging has drifted, so `cdk diff`
cannot isolate the slice): synthesize the tree twice with **only**
`infra/lib/renderer-hosting.ts` swapped between its `HEAD` (pre-slice) content and this
slice's, everything else identical, then `diff` the two `AmodxStack-staging` templates.
`cdk synth` re-runs `npm run build:open` (`renderer-hosting.ts:62`), so both synths built the
renderer from the same working tree — the renderer half of this slice is present on *both*
sides, which is what makes the comparison isolate the infra change.

Measured: **54 lines / 10 hunks.** The three semantic deltas, in template order:

```diff
   # AWS::CloudFront::Function — FunctionCode  (line 19471)
-  ":SecretString:::}}' };\n    return request;\n}\n            "
+  ":SecretString:::}}' };\n
+    var SESSION_COOKIE_BASES = ['next-auth.session-token', '__secure-next-auth.session-token'];\n
+    var hasSession = '0';\n    var jar = request.cookies || {};\n
+    for (var name in jar) {\n        var lower = name.toLowerCase();\n
+        for (var i = 0; i < SESSION_COOKIE_BASES.length; i++) {\n
+            var base = SESSION_COOKIE_BASES[i];\n
+            if (lower === base || lower.indexOf(base + '.') === 0) {\n
+                hasSession = '1';\n                break;\n            }\n        }\n
+        if (hasSession === '1') {\n            break;\n        }\n    }\n
+    request.headers['x-has-session'] = { value: hasSession };\n
+    return request;\n}\n            "

   # AWS::CloudFront::CachePolicy — HeadersConfig.Headers  (line 19531)
-  "X-Forwarded-Host"
+  "X-Forwarded-Host", "RSC", "Next-Router-Prefetch",
+  "Next-Router-State-Tree", "Next-Router-Segment-Prefetch", "x-has-session"

   # AWS::CloudFront::CachePolicy — QueryStringsConfig  (line 19535)
-  "QueryStringBehavior": "all"
+  "QueryStringBehavior": "whitelist",
+  "QueryStrings": ["page","q","availability","id","email","preview","nf"]
```

The remaining **7 hunks / 28 lines** are the non-determinism floor: 2 asset zips with their
`aws:asset:path` twins (4 hunks), 1 bare asset hash, and 2 occurrences of the `AdminHosting`
`config.json` custom resource's `Date.now()`-derived `physicalResourceId`
(`infra/lib/config-generator.ts:26`). That floor is **measured, not asserted**: control run 5b
synthesized the identical tree twice and produced exactly 7 hunks / 28 lines at the same
positions. So the comparison is `28 lines of noise + 26 lines of intended change`, and no
unintended resource moved anywhere in ~22,000 lines of template.

### Probe results (revision 4)

`probe-cache3-cffunc.mjs` — **39 pass, 0 fail** (was 29 in revision 3; the additions are the
5 decoy negatives, the split of emitted vs legacy names, and 4 stronger §C assertions):

```
## B. x-has-session derivation (prefix contract)          (26 checks)
   3 emitted names (plain, .0, .1)                              -> 1
   3 legacy __Secure- names (plain, .0, .1)                     -> 1
   realistic chunked jar (csrf + callback-url + .0 + .1)        -> 1
   11 non-session cookies incl. __Host-next-auth.csrf-token,
      next-auth.pkce.code_verifier, "next-auth", "sessiontoken" -> 0
   5 EMBEDDING DECOYS (…-decoy, …tokenX, …token-0, evil__…,
      anext-auth.session-token)                                 -> 0   [new]
   empty jar / absent cookies key                               -> 0
## B2. viewer-supplied header cannot survive               (3 checks)
## B3. pre-existing derivations still hold                 (2 checks)
## C. edge/origin detectors agree                          (8 checks)
   both SESSION_COOKIE_BASES arrays extracted and equal;
   both equal the two ratified names; middleware prefix-predicate
   source shape pinned; SESSION_COOKIES gone; SESSION_COOKIE_MARKER
   gone; no `.includes(` substring form; 0 disagreements / 31 names
```

Origin session matrix (`probe-cache3.sh` §F):

| Cookie(s) sent | `Cache-Control` | Route |
|---|---|---|
| `next-auth.session-token` | `private, no-cache, no-store, max-age=0, must-revalidate` | twin |
| `__Secure-next-auth.session-token` (legacy name) | `private, …, no-store` | twin |
| `next-auth.session-token.0` + `.1` (emitted, chunked) | `private, …, no-store` | twin — **routing only, F12** |
| `__Secure-next-auth.session-token.0` + `.1` (legacy, chunked) | `private, …, no-store` | twin — **routing only, F12** |
| `__Host-next-auth.csrf-token` + `__Secure-next-auth.callback-url` | `s-maxage=31536000` | cacheable |
| `amodx_ref` + `_ga` | `s-maxage=31536000` | cacheable |
| `x-next-auth.session-token-decoy` + `next-auth.session-tokenX` | `s-maxage=31536000` | cacheable — **prefix, not substring** |

The last four rows matter as much as the first three: an over-matching predicate would have
sent ordinary anonymous traffic to the uncached twin and quietly destroyed the hit rate this
whole track exists to create.

## Build run — 2026-07-27 (revision 3; superseded by the revision-4 run above, kept for the record)

> **Read with the revision-4 correction.** The 29/29 result below was produced by an oracle
> that *deliberately accepted* an embedding decoy (`x-next-auth.session-token-decoy`), because
> it encoded the substring predicate revision 4 withdrew. The build/synth/comparison rows are
> unaffected; the probe rows were re-earned in revision 4.

### Evidence

| # | Command | Result |
|---|---|---|
| 1 | `cd infra && npm run build` | **EXECUTED** — `tsc` clean, no output |
| 2 | `cd renderer && npx tsc --noEmit` | **EXECUTED** — clean, no output |
| 3 | `cd renderer && npx next build` | **EXECUTED** — compiled in 4.8s, TypeScript clean. `[siteId]/[[...slug]]` and `[siteId]/products/[productId]` still `●` (ISR preserved — the middleware edit did not disturb the rendering modes); `/api/ref` present as `ƒ`; 19 routes total |
| 4 | `cd infra && npx cdk synth -c stage=staging --quiet -o cdk.out.rev3` | **EXECUTED** — exit 0, 486 resources |
| 5 | Source-isolated synth comparison vs pre-slice `infra/lib/renderer-hosting.ts` (HEAD) | **EXECUTED** — 3 semantic hunks, all intended; see below. Archived at `.agent-manager/slices/CACHE-3/source-isolated-synth-rev3.diff` |
| 5b | Determinism control: same tree synthesized twice, no source change | **EXECUTED** — 28 diff lines / 7 hunks, all asset-hash or timestamp. Archived at `.agent-manager/slices/CACHE-3/synth-determinism-control-rev3.diff`. This is the noise floor the comparison in 5 is read against |
| 6 | `node probe-cache3-cffunc.mjs` (**new**, revision 3) | **EXECUTED** — **29/29 PASS**, `ALL CHECKS PASSED`. Runs the CF function body extracted from the synthesized template |
| 7 | `./probe-cache3.sh` (origin matrix; §F **new** in revision 3) | **EXECUTED** — all rows reproduce. §F: plain / `__Secure-` / chunked session cookies → `private, …, no-store` (twin); NextAuth non-session cookies and `amodx_ref`+`_ga` → `s-maxage=31536000` (cacheable, no over-match) |
| 8 | `node probe-cache3-browser.mjs` (real Chromium, attribution + migration) | **EXECUTED** — **23/23 PASS, 0 FAIL**, `ALL CHECKS PASSED` |
| 9 | `cd infra && npm test` (jest) | **EXECUTED** — 1/1 pass. Honest note unchanged: the suite asserts only "SQS Queue Created"; it is not coverage for this change. The coverage for this change is item 6 |
| 10 | `cd backend && npm run test:unit` (vitest, no network) | **EXECUTED** — 17/17 pass |
| 11 | `cd backend && npm test` | **NOT RUN** — hits real staging DynamoDB; excluded by the packet |
| 12 | `npx cdk diff AmodxStack-staging` | **NOT RUN in revision 3** — deliberately. Superseded as the gate by decision `CACHE3-STAGING-DRIFT` (F13); the revision-2 measurement of it stands in F7 and nothing about staging changed since |
| 13 | `cdk deploy` | **NOT RUN** — operator gate |
| 14 | Post-deploy CloudFront probes, incl. the WARM-EDGE session probe | **NOT RUN** — operator gate, § *Deployment* |

### Synthesized artefacts (from `infra/cdk.out/AmodxStack-staging.template.json`)

```json
"RendererHostingRendererCachePolicy294243B3": {
  "Type": "AWS::CloudFront::CachePolicy",
  "Properties": { "CachePolicyConfig": {
    "DefaultTTL": 0, "MaxTTL": 31536000, "MinTTL": 0,
    "Name": "AmodxStack-staging-RendererCache",
    "ParametersInCacheKeyAndForwardedToOrigin": {
      "CookiesConfig": { "CookieBehavior": "none" },
      "EnableAcceptEncodingBrotli": true, "EnableAcceptEncodingGzip": true,
      "HeadersConfig": { "HeaderBehavior": "whitelist", "Headers": [
        "X-Forwarded-Host", "RSC", "Next-Router-Prefetch",
        "Next-Router-State-Tree", "Next-Router-Segment-Prefetch",
        "x-has-session" ] },
      "QueryStringsConfig": { "QueryStringBehavior": "whitelist", "QueryStrings": [
        "page", "q", "availability", "id", "email", "preview", "nf" ] }
    } } }
}
```

`RendererHostingHostRewriteFunction74F77A19.Properties.FunctionCode`, with the
`{{resolve:secretsmanager:…}}` dynamic reference elided:

```javascript
function handler(event) {
    var request = event.request;
    var host = request.headers.host ? request.headers.host.value : '';
    request.headers['x-forwarded-host'] = { value: host };
    request.headers['x-origin-verify'] = { value: '<secretsmanager ref>' };

    var hasSession = '0';
    var jar = request.cookies || {};
    for (var name in jar) {
        if (name.toLowerCase().indexOf('next-auth.session-token') !== -1) {
            hasSession = '1';
            break;
        }
    }
    request.headers['x-has-session'] = { value: hasSession };

    return request;
}
```

### Source-isolated synth comparison (revision 3)

Same procedure as revision 2 (F7/F9 — the deployed staging stack has drifted, so a `cdk
diff` cannot isolate the slice): the tree is synthesized twice with **only**
`infra/lib/renderer-hosting.ts` swapped between its `HEAD` (pre-slice) content and this
slice's, everything else identical, and the two `AmodxStack-staging` templates are compared.
Note that `cdk synth` itself re-runs `npm run build:open` (`renderer-hosting.ts:62`), so both
synths built the renderer from the same working tree — the renderer half of this slice is
present on *both* sides, which is what makes the comparison isolate the infra change.

The **only** semantic deltas, in template order:

```diff
   # AWS::CloudFront::Function — FunctionCode
-  ":SecretString:::}}' };\n    return request;\n}\n"
+  ":SecretString:::}}' };\n
+    var hasSession = '0';\n
+    var jar = request.cookies || {};\n
+    for (var name in jar) {\n
+        if (name.toLowerCase().indexOf('next-auth.session-token') !== -1) {\n
+            hasSession = '1';\n            break;\n        }\n    }\n
+    request.headers['x-has-session'] = { value: hasSession };\n
+    return request;\n}\n"

   # AWS::CloudFront::CachePolicy — HeadersConfig.Headers
-  "X-Forwarded-Host"
+  "X-Forwarded-Host", "RSC", "Next-Router-Prefetch",
+  "Next-Router-State-Tree", "Next-Router-Segment-Prefetch", "x-has-session"

   # AWS::CloudFront::CachePolicy — QueryStringsConfig
-  "QueryStringBehavior": "all"
+  "QueryStringBehavior": "whitelist",
+  "QueryStrings": ["page","q","availability","id","email","preview","nf"]
```

Everything else in the 54-line comparison is the **7-hunk non-determinism floor** — 3 asset
zips (`ImageOptFunction`, `RendererServer`, renderer assets) with their `aws:asset:path`
twins, and 2 occurrences of the `AdminHosting` `config.json` custom resource's
`Date.now()`-derived `physicalResourceId` (`infra/lib/config-generator.ts:26`). That floor is
not asserted, it is **measured**: control run 5b synthesized the identical tree twice and
produced exactly those 7 hunks (28 lines) and nothing else. So the comparison is
`28 lines of noise + 26 lines of intended change`, and no unintended resource moved anywhere
in ~22,000 lines of template.

### New probe: `probe-cache3-cffunc.mjs`

`.agent-manager/slices/CACHE-1/probe-harness/probe-cache3-cffunc.mjs` (that directory is
gitignored — `.gitignore:35` — so it is on disk, not in `git diff`). Needs no server, no
network and no AWS; it only needs a synthesized template.

```bash
cd infra && npx cdk synth -c stage=staging --quiet      # writes cdk.out/
node .agent-manager/slices/CACHE-1/probe-harness/probe-cache3-cffunc.mjs
```

It exists because the CloudFront Function is the least-covered code in the repo: inline ES5
inside a CDK template literal, invisible to `tsc`, to eslint and to `infra`'s jest suite,
and it never executes in any build. "It synthesized" says nothing about whether it
classifies cookies correctly. The probe reads the body **out of the template** rather than
the `.ts` file, so what is exercised is what would deploy.

Result — **29 pass, 0 fail**:

```
## B. x-has-session derivation                       (19 checks)
   5 NextAuth session-cookie names (plain, __Secure-, .0, .1)   -> 1
   the realistic chunked jar (csrf + callback-url + .0 + .1)    -> 1
   11 non-session cookies incl. __Host-next-auth.csrf-token,
      next-auth.pkce.code_verifier, "next-auth", "sessiontoken" -> 0
   empty jar / absent cookies key                               -> 0
## B2. viewer-supplied header cannot survive          (3 checks)
   x-has-session: 1 with no session cookie -> overwritten to 0
   junk value, with and without a session cookie -> 0 / 1
## B3. pre-existing derivations still hold            (2 checks)
   x-forwarded-host overwritten from Host; x-origin-verify set
## C. edge/origin detectors agree                     (5 checks)
   same literal on both sides; middleware predicate shape pinned;
   SESSION_COOKIES array is gone; 0 disagreements over a 24-name corpus
```

### Origin session matrix (`probe-cache3.sh` §F, new in revision 3)

| Cookie(s) sent | `Cache-Control` | Route |
|---|---|---|
| `next-auth.session-token` | `private, no-cache, no-store, max-age=0, must-revalidate` | twin |
| `__Secure-next-auth.session-token` | `private, …, no-store` | twin |
| `__Secure-next-auth.session-token.0` + `.1` | `private, …, no-store` | twin — **regression row, F12** |
| `__Host-next-auth.csrf-token` + `__Secure-next-auth.callback-url` | `s-maxage=31536000` | cacheable |
| `amodx_ref` + `_ga` | `s-maxage=31536000` | cacheable |

The last two rows matter as much as the first three: an over-matching predicate would have
sent ordinary anonymous traffic to the uncached twin and quietly destroyed the hit rate this
whole track exists to create.

## Build run — 2026-07-26 (revision 2; superseded by the revision-3 run above, kept for the record)

### Evidence

| # | Command | Result |
|---|---|---|
| 1 | `cd infra && npm run build` | **EXECUTED** — `tsc` clean, no output |
| 2 | `cd renderer && npx next build` | **EXECUTED** — compiled in 4.7s, TypeScript clean; `[siteId]/[[...slug]]` and `[siteId]/products/[productId]` still marked `●` (ISR mode preserved); new `/api/ref` marked `ƒ` |
| 3 | `cd infra && npx cdk synth -c stage=staging --quiet` | **EXECUTED** — exit 0, 486 resources |
| 4 | Source-isolated template diff (see below) | **EXECUTED** — only the cache policy changed |
| 4b | Determinism control: same tree synthesized twice, no change | **EXECUTED** — produces exactly the asset/timestamp deltas and nothing else (F9) |
| 4c | Revision-1 template vs revision-2 template, structural JSON walk | **EXECUTED (revision 2)** — the only differences are 5 asset-hash fields (renderer assets zip, ImageOpt fn, Server fn — `aws:asset:path` + `S3Key`) and 2 timestamped `physicalResourceId` fields on the admin `config.json` custom resource. `RendererCachePolicy` byte-identical, confirming the revision-2 infra edit is comment-only |
| 5 | `probe-cache3.sh` (origin behaviour matrix + the new `/api/ref` section E) | **EXECUTED (re-run revision 2 against a fresh `next build`)** — exit 0; all rows reproduce. One difference from the revision-1 table, honestly noted: row A1 read `HIT`→`HIT` instead of `MISS`→`HIT`, because the page is `●` (SSG via `generateStaticParams`) and was prerendered at build time rather than on first request. The claim the row supports — bare path is cacheable with `s-maxage=31536000` — is unaffected |
| 6 | `probe-cache3-browser.mjs` (real Chromium, attribution end-to-end + migration) | **EXECUTED (re-run revision 2)** — **23/23 PASS, 0 FAIL**, `ALL CHECKS PASSED`, including §9 migration 9a–9c |
| 7 | `cd infra && npx cdk diff --app cdk.out AmodxStack-staging` | **EXECUTED (re-run revision 2, reaches AWS, read-only) but NOT A CLEAN SIGNAL** — 630 resource lines; see F7. The two lines that are this slice: `[+] AWS::CloudFront::CachePolicy RendererHosting/RendererCachePolicy` and, under the distribution, `.DefaultCacheBehavior.CachePolicyId` moving `[-] "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"` (managed **CachingDisabled**) → `[+] {"Ref": "RendererHostingRendererCachePolicy294243B3"}` |
| 8 | `cd infra && npm test` (jest) | **EXECUTED** — 1/1 pass. Honest note: the suite asserts only "SQS Queue Created"; it is not coverage for this change |
| 9 | `cd backend && npm run test:unit` (vitest, no network) | **EXECUTED** — 17/17 pass |
| 10 | `cd backend && npm test` | **NOT RUN** — hits real staging DynamoDB; excluded by the packet |
| 11 | `cdk deploy` | **NOT RUN** — deliberately; operator gate |
| 12 | Post-deploy CloudFront probes | **NOT RUN** — operator gate, see § Deployment |

### Synthesized cache policy (from `cdk.out/AmodxStack-staging.template.json`)

```json
"RendererHostingRendererCachePolicy294243B3": {
  "Type": "AWS::CloudFront::CachePolicy",
  "Properties": { "CachePolicyConfig": {
    "DefaultTTL": 0, "MaxTTL": 31536000, "MinTTL": 0,
    "Name": "AmodxStack-staging-RendererCache",
    "ParametersInCacheKeyAndForwardedToOrigin": {
      "CookiesConfig": { "CookieBehavior": "none" },
      "EnableAcceptEncodingBrotli": true, "EnableAcceptEncodingGzip": true,
      "HeadersConfig": { "HeaderBehavior": "whitelist", "Headers": [
        "X-Forwarded-Host", "RSC", "Next-Router-Prefetch",
        "Next-Router-State-Tree", "Next-Router-Segment-Prefetch" ] },
      "QueryStringsConfig": { "QueryStringBehavior": "whitelist", "QueryStrings": [
        "page", "q", "availability", "id", "email", "preview", "nf" ] }
    } } }
}
```

### Source-isolated template diff

Because the deployed staging stack has drifted (F7), the "only the cache policy changed"
claim was established by synthesizing the **same tree twice** — once with
`infra/lib/renderer-hosting.ts` reverted to `HEAD`, once with the slice's version, renderer
changes present in both — and diffing the two `AmodxStack-staging` templates. The only
semantic delta:

```diff
       "HeadersConfig": {
        "HeaderBehavior": "whitelist",
        "Headers": [
-        "X-Forwarded-Host"
+        "X-Forwarded-Host",
+        "RSC",
+        "Next-Router-Prefetch",
+        "Next-Router-State-Tree",
+        "Next-Router-Segment-Prefetch"
        ]
       },
       "QueryStringsConfig": {
-       "QueryStringBehavior": "all"
+       "QueryStringBehavior": "whitelist",
+       "QueryStrings": [
+        "page", "q", "availability", "id", "email", "preview", "nf"
+       ]
       }
```

The diff also contains four asset-hash / timestamp deltas (`RendererServer`,
`ImageOptFunction`, the renderer assets zip, and an `AdminHosting` `physicalResourceId`).
These are **synth non-determinism, not changes**. Iteration 0 asserted that from
`infra/lib/config-generator.ts:26` (`cr.PhysicalResourceId.of(Date.now().toString())`);
revision 1 measured it (F9) — a third synth of the **unchanged** tree, diffed against the
second, produces precisely those four deltas and nothing else:

```
-  "S3Key": "95d8e0a8…zip"          +  "S3Key": "1ac2e58a…zip"    (ImageOptFunction)
-  "S3Key": "e72b82b1…zip"          +  "S3Key": "7bc41e6e…zip"    (RendererServer)
-  "463e52d3…zip"                   +  "d6e94a60…zip"             (renderer assets)
-  "physicalResourceId":{"id":"…"}  +  "physicalResourceId":{"id":"…"}  (AdminHosting config.json)
```

So in the isolated diff the cache policy is the only real delta. Nothing else in ~22,000
lines of template differs.

### Probe harness

New scripts, kept alongside the `cache-1` harness in
`.agent-manager/slices/CACHE-1/probe-harness/`. **`.agent-manager/` is gitignored**
(`.gitignore:35`), same as for `cache-1` — the scripts are on disk, not in `git diff`:

- `probe-cache3.sh` — origin behaviour matrix: which request shapes are cacheable, the
  `RSC` body flip, the `_rsc` measurements (F3), the `?nf=1` 307 (F1), greps for a leaked
  `Set-Cookie: amodx_ref`, and (§E, revision 1) the `POST /api/ref` contract: `204`,
  `cache-control: no-store`, `Set-Cookie: amodx_ref=…; Path=/; Max-Age=2592000; Secure;
  HttpOnly; SameSite=lax`, no `v` → no cookie, and percent-encoding of a value containing
  `;`/`=`/space.
- `probe-cache3-browser.mjs` — Playwright/Chromium, attribution end-to-end (DoD 3),
  including §9 (revision 1): the legacy-`HttpOnly`-cookie migration, with 9a as the control
  that demonstrates why the iteration-0 design failed.

Reproduce (both need the `cache-1` DynamoDB stub on 8123):

```bash
cd .agent-manager/slices/CACHE-1/probe-harness && node ddb-stub.mjs &
cd renderer && TABLE_NAME=probe-table AWS_REGION=eu-central-1 \
  AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
  AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8123 \
  ORIGIN_VERIFY_SECRET= NEXT_PUBLIC_API_URL= NEXTAUTH_SECRET=probe-secret \
  npx next start -p 3111 &
cd .agent-manager/slices/CACHE-1/probe-harness
./probe-cache3.sh
node probe-cache3-browser.mjs
```

All DynamoDB traffic goes to the local stub — the explicit `TABLE_NAME` /
`AWS_ENDPOINT_URL_DYNAMODB` / fake credentials are set in the environment, and Next only
fills env keys that are `undefined`, so nothing reaches staging.

Browser probe output (**23/23 PASS**): cookie set from `?ref`; survives a bare visit and
**is sent back to the origin** on it; set from `?utm_source`; `ref` beats `utm_source`;
last-touch overwrite; `Max-Age` ≈ 30 days, `Path=/`, `SameSite=Lax`, `HttpOnly` true,
`Secure` true for a production-shaped host; a value containing `;`/`=`/space round-trips to
the exact original after `decodeURIComponent`, matches the old middleware's wire bytes
(`a%20b%3Bc%3Dd`) and produces exactly one cookie (no attribute forgery); no parameter → no
beacon and no cookie.

**Migration checks (§9, the reason for revision 1):**

```
PASS  document.cookie CANNOT overwrite the legacy HttpOnly cookie (RFC 6265 5.3/11)
      got: "legacy-partner"   want: "legacy-partner"      <- the iteration-0 defect, reproduced
PASS  server-side beacon DOES overwrite the legacy HttpOnly cookie
      got: "new-partner"      want: "new-partner"
PASS  exactly one amodx_ref after migration (not two)
PASS  30-day window renewed
PASS  still HttpOnly after migration
PASS  origin receives the NEW value on the next page request
PASS  origin does NOT still receive the legacy value
```

The legacy cookie is seeded with exactly the attributes `renderer/middleware.ts` set before
this slice (`HttpOnly`, `Secure`, `Path=/`, `SameSite=Lax`, 30 days).

## Deployment — operator gate (NOT RUN)

**Order:** `cache-3` → `cache-1` + `cache-2` (combined is fine). `cache-3` must not land
*after* `cache-1`: that window is exactly hazard H1 on live tenants.

### Staged reconcile (human decision `CACHE3-STAGING-DRIFT`, 2026-07-27)

The bounded-`cdk diff` gate is **withdrawn for this slice** and replaced by this plan. It
does not exist to make the diff smaller; it exists because a ~630-resource diff cannot
isolate a production-sensitive blast radius, and the drift is not this slice's to fix
in-line. Three steps, in order:

**Step 1 — reconcile STAGING by deploying it.**

```bash
cd infra && npx cdk deploy AmodxStack-staging -c stage=staging   # absorbs the ~630-resource drift
```

**`-c stage=staging` is mandatory, not decoration.** `infra/bin/infra.ts:12` reads
`app.node.tryGetContext('stage')` and **defaults to `prod`**, then instantiates exactly
*one* stack from the matching config file (`infra/bin/infra.ts:19,32-42`). Without the flag
the app builds only `AmodxStack` (from `amodx.config.json`), so `cdk deploy
AmodxStack-staging` does not deploy the wrong stack — it fails with no matching stack. The
stack *name* is correct: `amodx.staging.json` sets `"stackName": "AmodxStack-staging"`
(OBSERVED). Every `cdk` invocation in this document that targets staging carries the flag
for the same reason; the production step below deliberately omits it because `prod` is the
default. Two rows in the superseded build-run tables above (the revision-4 run's row 12 and
the revision-3 run's row 12) quote `npx cdk diff AmodxStack-staging` without the flag — both
are recorded `NOT RUN`, so nothing was ever measured with a broken command, and they are
left as written rather than back-edited. If you run either by hand, add `-c stage=staging`.
The one form that *was* executed (F7, revision-2 run row 7) is
`npx cdk diff --app cdk.out AmodxStack-staging`, which needs no context flag because it
reads an assembly already synthesized with one.

This deploy applies **far more than Track CACHE** — every un-deployed change between the
last staging deploy and HEAD (F7). That is accepted and is the whole point of doing it on
staging first. Read the diff before confirming, but do not expect it to be small; the
signal to look for is that nothing in it is *destructive* to data (`[-]` on a table, bucket
or secret). CloudFront distribution changes take ~5–15 min to propagate; wait for
`Deployment status: Deployed` before probing.

**Step 2 — run the FULL Track CACHE probe suite against staging.** Not a subset. Every probe
below plus the `cache-1` header probes and the `cache-2` ISR purge check from their own slice
docs. Staging is the only place any of this is observable before production, and after step 1
staging is finally at HEAD, so a pass there is meaningful for the first time in this track.

**Step 3 — production.** With staging at HEAD, `npx cdk diff AmodxStack` (no `-c` flag —
`prod` is `infra/bin/infra.ts`'s default) is then a small,
reviewable, Track-CACHE-shaped diff (expected: the cache policy's two allowlists, the CF
Function body, `cache-1`'s renderer asset, `cache-2`'s renderer asset + the `CACHE-2-D2`
`CreateContentFunc` grant). **Review it by hand before deploying**, and re-run the probe
suite against a real tenant domain afterwards.

If step 1's diff contains anything destructive, or step 2 fails any probe, **stop** — do not
proceed to step 3, and do not try to cherry-pick Track CACHE out of the drift. Rollback is
below.

**Expect a cold edge cache.** Changing the cache key does not invalidate anything, but
every existing entry becomes unreachable under the new key — functionally a full Layer-1
flush on the first request per URL. Layer 2 (S3 ISR) is untouched, so the refill is mostly
`x-nextjs-cache: HIT` at the origin rather than fresh SSR. Do not deploy into a traffic
peak.

### Verification probes (post-deploy, run against a real tenant domain)

1. **RSC header probe (H1 — the reason this slice exists).** Warm the URL first.
   ```bash
   U=https://<tenant-domain>/<published-page>
   curl -sI      "$U" | grep -i 'content-type\|x-cache'   # text/html
   curl -sI -H 'RSC: 1' "$U" | grep -i 'content-type\|x-cache'   # text/x-component
   curl -sI      "$U" | grep -i 'content-type\|x-cache'   # text/html AGAIN + Hit
   ```
   The third line is the assertion: pre-fix, the flight payload displaced the HTML entry.

2. **Junk-parameter probe (fragmentation).** Warm the bare URL first — see F6, the
   originally-written form of this probe fails for a legitimate reason on a cold URL.
   ```bash
   curl -sI "$U" >/dev/null; curl -sI "$U" | grep -i x-cache          # expect Hit
   curl -sI "$U?fbclid=junk123" | grep -i 'x-cache'                    # expect Hit
   curl -sI "$U?fbclid=totallydifferent" | grep -i 'x-cache'           # expect Hit
   ```

3. **Attribution probe (no cross-visitor replay + still works + migrates).**
   ```bash
   # 3a. no page response carries the cookie any more
   curl -sI "$U?ref=test" | grep -i set-cookie   # expect NO amodx_ref
   curl -sI "$U"          | grep -i set-cookie   # expect NO amodx_ref

   # 3b. the beacon route does, and is uncacheable
   curl -sI -X POST "$U-host/api/ref?v=test" | grep -iE 'HTTP/|cache-control|set-cookie'
   #   expect: 204 ; cache-control: no-store ;
   #           set-cookie: amodx_ref=test; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=lax
   ```
   Then in a browser, **using a profile that already visited a campaign URL before this
   deploy** (this is the F8 migration case, and it is the one that cannot be checked from
   `curl`): visit `$U?ref=test`, confirm in DevTools → Application → Cookies that
   `amodx_ref` is now `test` with `HttpOnly` ticked, submit a lead form, and confirm the
   lead record carries `data.referral = "test"`. `document.cookie` will NOT show the cookie
   — it is `HttpOnly`; that is expected, not a failure.

   The `HttpOnly` flag also means the migration is the only end-to-end path worth checking
   manually: everything else is covered by the local browser probe.

4. **404 loop probe (F1 — `nf` in the key).** `curl -sIL "$U-does-not-exist"` must
   terminate in a `404` + `private, no-store`, **not** loop. `curl -L` aborts after 50
   redirects, so a loop is unmistakable.

5. **Pagination probe (allowlist actually discriminates).**
   `curl -s "$U/../<shop-prefix>?page=2"` must not return page 1.

6. **WARM-EDGE session probe (H3 — the reason revision 3 exists). MANDATORY.**
   This is the one assertion no local probe can make, and the reason review iteration 2
   escalated: **a `curl` against the origin cannot fail this way**, because at the origin
   middleware runs and routes correctly. It has to be a real CloudFront hit.

   Requires a page whose `accessPolicy.type` is **not** `Public`, and a real signed-in
   session for that tenant.

   ```bash
   G=https://<tenant-domain>/<GATED-page>

   # 6a. Warm the ANONYMOUS entry first. This is what makes the probe meaningful — the
   #     failure only exists once an anonymous entry is warm.
   curl -sI "$G" >/dev/null
   curl -sI "$G" | grep -i 'x-cache'          # expect: Hit from cloudfront
   curl -s  "$G" | grep -c 'Restricted'       # expect: >0 — the anonymous entry IS the shell

   # 6b. Same URL, carrying a real session cookie. Copy the cookie from a signed-in
   #     browser (DevTools -> Application -> Cookies). Under this repo's explicit NextAuth
   #     cookies config the name is `next-auth.session-token` (NOT the __Secure- default —
   #     F11). If the browser shows `.0`/`.1` chunks instead, send them ALL, and see the
   #     note under 6b-caveat below.
   curl -sI -H "cookie: next-auth.session-token=<REAL-TOKEN>" "$G" \
     | grep -iE 'x-cache|cache-control'
   #   PASS: x-cache: Miss from cloudfront   +   cache-control: private, ... no-store
   #   FAIL: x-cache: Hit from cloudfront    <- H3 is open; the visitor is being served
   #         the cached anonymous entry and will see "Restricted Access" while signed in.

   curl -s -H "cookie: next-auth.session-token=<REAL-TOKEN>" "$G" \
     | grep -c 'Restricted'                   # expect: 0 — the real, gated content

   # 6c. The anonymous entry must be UNDISTURBED afterwards (the authenticated render is
   #     no-store, so it must not have replaced anything).
   curl -sI "$G" | grep -i 'x-cache'          # expect: Hit from cloudfront, still
   ```

   **6b-caveat — a CHUNKED session will pass the `x-cache: Miss` assertion and FAIL the
   `Restricted` one, and that is known, expected and NOT a cache defect.** The twin does not
   reassemble chunked JWTs (F12, `docs/TECH-DEBT.md`), so it renders with
   `sessionToken: null`. If the browser's cookie jar shows `.0`/`.1` chunks, treat the
   `x-cache: Miss` + `no-store` line as the H3 assertion (that is what probe 6 exists to
   check) and re-run the `Restricted` assertion with an **unchunked** session — a small
   Google profile, or a tenant whose session callbacks add few claims. Do **not** record a
   chunked `Restricted` failure as an H3 regression.

   Then the negative half, which protects the hit rate rather than correctness — an
   over-matching edge predicate would send ordinary traffic to the uncached twin:

   ```bash
   curl -sI -H 'cookie: amodx_ref=partner-a; _ga=GA1.1.1' "$U" | grep -i 'x-cache'
   #   expect: Hit from cloudfront  (non-session cookies must NOT bust the cache)
   ```

   And the forgery half, which protects against a viewer minting cache partitions:

   ```bash
   for v in 1 aaa bbb ccc; do
     curl -sI -H "x-has-session: $v" "$U" | grep -i 'x-cache'
   done
   #   expect: Hit from cloudfront on every line. The CF Function overwrites the header,
   #   so all four collapse onto the same anonymous entry. A Miss on any line means the
   #   viewer-supplied value is reaching the cache key.
   ```

### Rollback

Revert `infra/lib/renderer-hosting.ts` and redeploy: `queryStringBehavior` back to `all()`,
the header allowlist back to `X-Forwarded-Host` only, and the CloudFront Function back to
its two-header body. This is an in-place cache-policy + function update, no distribution
replacement, ~5 min propagation. Note that rolling back the CDK **re-opens H1 and H3**, so
if `cache-1` is already deployed the correct rollback is to revert the renderer to the
pre-`cache-1` build as well.

**Do not roll back only the `x-has-session` half.** With `cache-1` live and the header gone,
every authenticated request collapses onto the anonymous entry — that is H3 at full strength
on live tenants, and it is worse than either end state. The cache policy and the CF Function
are a single unit: `x-has-session` in the key with a Function that does not set it would key
every request under an absent/viewer-supplied value; the Function setting it with the key not
including it is merely inert. So if they must be split, roll back the **key** last and
restore it first. Reverting only the renderer half (restoring
the middleware `Set-Cookie`) is **not** a valid partial rollback — with `ref` out of the
cache key it would fire only on cold URLs, which is worse than either end state.

Rolling the renderer back **after** the beacon has run for a while is safe for attribution:
the cookie the beacon writes is byte-identical in name, value encoding and attributes to
the one the middleware wrote, so a restored middleware simply resumes overwriting it. The
reverse direction is the asymmetric one, and it is exactly F8 — which is why the write is
server-side.

## Exit criterion

Cache hit ratio is insensitive to junk query params, no visitor can receive another
visitor's attribution cookie from the CDN, no client can pin a flight payload under a page's
HTML URL, and **no signed-in visitor is served a warm anonymous entry on an access-gated
page**.

## References

- `infra/lib/renderer-hosting.ts` — cache policy **and** the viewer-request CloudFront
  Function that derives `x-has-session` (and the `api/*` `CachingDisabled` behavior the
  beacon route relies on).
- `renderer/middleware.ts` — attribution block removed; `SESSION_COOKIE_BASES` +
  `hasSessionCookie()` (must stay identical to the CF Function's array and predicate — F11).
- `renderer/src/app/api/auth/[...nextauth]/route.ts:36-46` — `cookies.sessionToken.name`, the
  shared source of truth for the session-cookie name family. Read together with
  `node_modules/next-auth/core/init.js:59-61` (top-level option merge) and
  `core/lib/cookie.js:151-153` (chunk naming) — those are what establish which names are
  actually emitted (F11).
- `renderer/src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:33-38` — `readSessionToken()`, the
  chunk-reassembly gap this slice does NOT fix (F12, `docs/TECH-DEBT.md`). Out of packet
  scope; not modified.
- `renderer/src/components/ReferralCapture.tsx` — the trigger (inline script).
- `renderer/src/app/api/ref/route.ts` — the writer (server-side `Set-Cookie`).
- `renderer/src/app/[siteId]/layout.tsx` — mounts `ReferralCapture`.
- `renderer/src/app/api/leads/route.ts:31` — sole consumer of `amodx_ref`, unchanged.
- `renderer/src/app/[siteId]/[[...slug]]/page.tsx` — `query={{}}`, the basis for F2(b).
- `renderer/src/lib/not-found-handoff.ts` — `NOT_FOUND_PARAM`, must stay in sync with `nf`.
- `docs/caching-architecture.md` — §Cache Policy (incl. §*`x-has-session`*), §Open hazards
  (H1, H3), §Known Gaps.
- `.agent-manager/slices/CACHE-1/probe-harness/probe-cache3-cffunc.mjs` — the only coverage
  the CloudFront Function has (gitignored; on disk, not in `git diff`).
- `.agent-manager/slices/CACHE-3/source-isolated-synth-rev4.diff` and
  `…/synth-determinism-control-rev4.diff` — the **current** evidence gate, archived. The
  `…-rev3.diff` pair is kept beside them for the record.
- `docs/TECH-DEBT.md` § *Chunked NextAuth session cookies are not reassembled* — the deferred
  half of F12.
