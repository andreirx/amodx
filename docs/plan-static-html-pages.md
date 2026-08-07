> **RATIFIED 2026-08-07 (human).** Decisions D-STATIC-1..4 ratified in their CONVERGED
> form (packet: `.agent-manager/slices/STATIC-1/ratification-packet.md`, all-converged).
> **D-STATIC-5 ratified AS AMENDED by the human:** tenant admins MAY publish static pages
> in phase 1 — "it's their site" — because the D1 null-origin sandbox (not publisher
> trust) is the safety mechanism; the packet itself rates tenant publishing tolerable
> under isolation (a). Two riders: (1) the admin upload/preview phase includes an
> upload-time LINT that mechanically warns about patterns that will not work in the
> sandbox (cookie access, window.parent/top, same-origin form posts, hardcoded
> cross-origin fetches, localStorage) — ADVISORY UX, explicitly not a security barrier
> (static scanning of JS intent is evadable/undecidable; the sandbox is the barrier);
> (2) tenant-publish permission is CONDITIONAL on the sandboxed-iframe isolation — any
> weakening of the isolation design (e.g. the subdomain variant) re-gates publishing to
> agency-only until proven safe. D1's endpoint-hardening inventory (origin checks on
> anonymous write endpoints) remains in scope.

# Lovable / Static-HTML Pages Plan (Track STATIC)

## Status

- **Discovery plan — doc only.** No implementation, no `infra/` changes, no AWS mutations.
- Track: `STATIC` (`docs/ROADMAP.md` § *Backlog / Discovery Tracks*). NOT an active slice.
- Source of the problem statement: human notes, 2026-07-30.
- Audit evidence: `OBSERVED` 2026-08-06 by reading the working tree (`html` block plugin,
  `infra/lib/uploads.ts`, `infra/lib/renderer-hosting.ts`, `renderer/middleware.ts`, the
  `renderer/src/app/api/*` routes, `packages/shared/src/media.ts` and `index.ts`). Every
  estate claim below carries a `file:line`. No live AWS call was made; nothing here rests on
  runtime inspection of the deployed distributions.
- **Writable surface of `static-1`:** this document plus the `docs/ROADMAP.md` STATIC row.
  Nothing else — no code, no `infra/`, no schema, no adjacent debt tracking.
- **Phase numbering** matches the ratified ROADMAP row: `static-1`..`static-4`
  (isolation model → S3 storage + page schema → admin upload/preview/publish → renderer route
  integration). This plan proposes no new phase and moves none.
- Current maturity of the raw-HTML surface: **PROTOTYPE** — one unsanitised `html` *block*
  (§ 2.1), no page-level raw-HTML concept at all.
- Target maturity of the track: MATURE isolation model + upload/preview/publish surface. AmodX
  never executes tenant-supplied script inside the renderer's own origin — see § *Non-Goals*.

**This document does not decide anything.** It records what exists, states the isolation
problem, and raises five ratification-class decisions (`D-STATIC-1`..`D-STATIC-5`), collected
in § 6. `D-STATIC-1` (the isolation model) is RATIFICATION-CLASS and gates every downstream
phase; the ROADMAP already names "sandboxed iframe from the asset origin" as the default
candidate, and this plan recommends that *family* (with variant **a1** preferred) — but two things
are argued as **conditional, not categorical**: (i) its containment of § 2.3 rests on three
`OBSERVED` facts (§ 3(a)); and (ii) *which* concrete variant renders a real Vite/React Lovable
export at all is an `INFERRED` unknown (the module-script CORS fact, § 3(a)) that only a runtime
spike can settle. Ratifying `D-STATIC-1` therefore **authorizes a bounded pre-implementation spike**
(§ 4) that picks the variant and validates the residuals — it is not blanket adoption of a design.

---

## 1. Problem

The agency wants to take a complete HTML page produced by an external generator (Lovable —
Vite/React exports: an HTML shell plus hashed JS/CSS bundles, occasionally third-party
analytics) and publish it, **scripts and all**, on a tenant website. Two facts collide:

1. **Lovable pages need their scripts to run.** The export is a client-rendered bundle; strip
   the `<script>` and you are left with an empty shell (§ 3, option b). "Publish the page as
   the tool made it" is the actual request.

2. **The renderer's own origin is a privileged security boundary that the CACHE track just
   spent four slices sealing.** Same-origin script is not sandboxed by the browser from the
   NextAuth session cookie, the `amodx_ref` attribution cookie, the same-origin customer
   self-service API, or the checkout PII in query strings (§ 2.3). Injecting attacker-shaped
   (or merely careless-generator-shaped) script *inside* that origin hands it all of the above.

So the whole track reduces to one question — **where does the untrusted script run** — and
everything else (storage, schema, upload UX, routing) is mechanical once that is answered. That
is why `D-STATIC-1` is the centerpiece and the ROADMAP gates the track on it.

The non-answer to note up front: **the existing `html` block is not a precedent that makes
this safe.** It renders raw markup, but through a path that cannot execute page script at all
(§ 2.1) — so it has never actually run tenant JS inside the renderer origin. Reusing it for
Lovable would either keep that limitation (scripts silently dead — option b in disguise) or
require making it execute script same-origin (option d — rejected). Neither is "just reuse the
block".

---

## 2. Current-state estate audit

### 2.1 The `html` block plugin — no sanitiser, and no script execution either (`OBSERVED`)

The block renders raw stored markup with **no sanitisation at any stage**:

```
packages/plugins/src/html/HtmlRender.tsx:7-20
    export function HtmlRender({ attrs }) {
        const { content } = attrs;
        if (!content) return null;
        return <div className="my-8 raw-html-embed"
                    dangerouslySetInnerHTML={{ __html: content }} />;
    }
packages/plugins/src/html/HtmlEditor.tsx:21-27   // plain <textarea>, writes content verbatim
```

Its own header comment states the omission is deliberate — "intentionally NOT sanitized … Access
is restricted to EDITOR/ADMIN roles who are trusted" (`HtmlRender.tsx:3-6`). So `<script>`,
`<style>`, `onclick`, `<iframe>`, `javascript:` URLs are all passed through verbatim.

**A repo sanitiser exists but is deliberately not wired to this block.** `sanitizeHtml()`
(`renderer/src/lib/sanitize.ts:8-43`, backed by the `sanitize-html` library) is used only by
product descriptions (`SitePage.tsx:779,841`), popups (`PopupManager.tsx:162`) and the top bar
(`TopBar.tsx:16`). Its `allowedTags` omits `script`, `style` and `iframe`; its
`allowedAttributes` omits `on*` handlers. It would strip exactly the parts a Lovable export needs.

**The security nuance that matters for § 3.** `dangerouslySetInnerHTML` assigns to
`innerHTML`, and **the HTML spec forbids `<script>` inserted via `innerHTML` from executing**
(only parser-inserted or `document.createElement('script')` scripts run). So the "unsanitised"
block has never actually run page JS — inline handlers *would* fire, and `javascript:` URLs
*would* be reachable, but a Lovable bundle's `<script src=…>` is inert. This is precisely why
the block is not a Lovable solution and why "sanitised inline" (option b) is functionally
near-zero, not merely lossy.

### 2.2 The S3 asset origin — private bucket, separate cross-origin CDN, no header policy (`OBSERVED`)

Tenant uploads live in a **private** bucket reached only through CloudFront OAC, and — this is
the load-bearing fact for `D-STATIC-1` — they are served from a **distribution that is a
different origin from the one that carries the renderer's session cookies.**

```
infra/lib/uploads.ts:22-32   AssetsBucket  "amodx-assets{suffix}"  BlockPublicAccess.BLOCK_ALL
infra/lib/uploads.ts:49-55   AssetsDistribution  → AssetsBucket via OriginAccessControl,
                              cachePolicy CACHING_OPTIMIZED,  NO domainNames / NO certificate
infra/lib/uploads.ts:59      output: distribution.distributionDomainName  → uploadsCdnUrl
infra/lib/amodx-stack.ts:211 uploadsCdnUrl wired to the backend
backend/src/assets/create.ts:60   public URL built as `${CDN_URL}/${key}`
```

Because `AssetsDistribution` has no custom domain, tenant uploads are served from a raw
`*.cloudfront.net` host — **cross-origin** to every tenant site host, and therefore cross-origin
to the host-only `next-auth.session-token` cookie (§ 2.3). That separation, not any header, is
what keeps uploaded active content off the cookie origin today.

Do **not** confuse this with the `assets/*` behaviour on the *renderer* distribution
(`infra/lib/renderer-hosting.ts:565-569`): that path serves the trusted OpenNext build bucket
(`RendererAssets`, `renderer-hosting.ts:73`), not tenant uploads, and it *is* same-origin. Any
static-page design that puts tenant HTML under the renderer distribution's `assets/*` would move
it onto the cookie origin — that is option (d), not option (a).

**No response-headers policy anywhere, and no GET-side CORS on the asset origin.** A grep for
`responseHeadersPolicy` across `infra/lib` returns nothing (`OBSERVED`). Neither distribution sets
`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, or `X-Frame-Options`. Crucially for
`D-STATIC-1`(a): the `AssetsBucket` **does** carry an S3 CORS rule, but it allows only `PUT`/`POST`
— the admin presigned *upload* — **not** `GET` (`uploads.ts:24-28`; the `GET` at `uploads.ts:38` is
on the signed-URL-only `PrivateBucket`, which has no CDN). The `AssetsDistribution` uses
`CACHING_OPTIMIZED` (`uploads.ts:53`), which does **not** forward the `Origin` header to S3, and
there is no CloudFront response-headers policy. **Net (`OBSERVED` + `INFERRED` from S3/CloudFront
CORS mechanics): an asset `GET` served through the CDN returns no `Access-Control-Allow-Origin`
header at all.** This is the fact that makes the module-script compatibility question in § 3(a)
load-bearing, not incidental. Objects are served with their **stored** `Content-Type`, which is
**whatever the uploader declared**:

```
backend/src/assets/create.ts:30,55   contentType from JSON.parse(event.body), signed into the PUT
packages/shared/src/media.ts:21,34   ALLOWED_UPLOAD_MIMES includes "image/svg+xml"
```

SVG is script-capable and is on the upload allowlist; there is no magic-byte sniffing and the
presigned PUT does not bind content-length (`create.ts:47-51`), so size is advisory. Today that
active-content exposure is contained only by the cross-origin CDN host — a fact the static-page
design must preserve, not erode.

**One shared distribution, keyed by Host.** All tenants share one renderer distribution
(`renderer-hosting.ts:635-640`), wildcard cert `*.rootDomain`
(`infra/lib/domains.ts:24-29`), wildcard Route53 A-record (`amodx-stack.ts:278-282`); tenant is
resolved from `X-Forwarded-Host` (`renderer-hosting.ts:305-310, 451-458`). **There is no
per-tenant distribution or per-tenant certificate construct** — directly relevant to the cost of
option (c).

### 2.3 The session / cookie / attribution boundary an in-origin script would sit inside (`OBSERVED`)

What same-origin script on a tenant page can reach today. Cookies are host-only (no `domain`
attribute) and HttpOnly:

```
renderer/src/app/api/auth/[...nextauth]/route.ts:36-46   next-auth.session-token  httpOnly, secure, sameSite:lax, path:/
renderer/src/app/api/ref/route.ts:66,85-91               amodx_ref  httpOnly, 30d, host-only; written from ?v= (visitor-supplied)
renderer/middleware.ts:59-67,131-133                     hasSessionCookie() → routes session/query requests to the force-dynamic twin
                                                          (must stay identical to the CloudFront x-has-session derivation)
```

HttpOnly means a script **cannot read the session token via `document.cookie`.** That is not the
threat. The threat is that a same-origin script issues **credentialed `fetch()`** and the browser
attaches the cookie automatically, so it acts *as the logged-in customer* against the same-origin
API:

| Same-origin route | What an in-origin script gets |
|---|---|
| `GET /api/profile` (`profile/route.ts:110` handler, session read `:141-153`) | customer profile PII, session-authenticated |
| `GET /api/account/orders` (`account/orders/route.ts:48-57`) | full order history |
| `POST /api/comments` (`comments/route.ts:72-75`) | post as the logged-in user (impersonation) |
| `POST /api/ref?v=` (`ref/route.ts:69-93`) | overwrite the attribution cookie → steal lead/campaign credit |
| `GET /api/posts` (`posts/route.ts:16,26-28`) | **cross-tenant** read — tenant id is the client-supplied `x-tenant-id` header, host is ignored |
| `checkout-confirm ?id&email`, `checkout-track ?email` (`SitePage.tsx:350-366`, `CheckoutPageView.tsx:343`) | order id + customer email, plaintext in the URL of a same-origin navigation |

Plus the ambient powers of any script running in the page: rewrite the DOM (inject a fake
checkout/payment form to exfiltrate card data or PII typed by the visitor), read anything the
visitor enters, and defacement. This is the boundary the CACHE track sealed
(`x-has-session` in the cache key, `amodx_ref` moved to an HttpOnly `POST /api/ref` write). An
in-origin Lovable script sits **inside** all of it.

---

## 3. `D-STATIC-1` — the isolation model (centerpiece decision)

**Problem.** A Lovable export must run its own JavaScript to function (§ 1, § 2.1). Any place we
let it run is a place its script has the ambient authority of that origin. We must choose an
execution context whose authority is *empty* with respect to the renderer session boundary (§ 2.3)
while still letting the page's own scripts run. Four candidates, RISK/REWARD each.

### (a) Sandboxed `<iframe>` served from the S3 asset origin — DEFAULT CANDIDATE, three variants

Store the export (HTML shell + its JS/CSS bundle) in the existing `amodx-assets` bucket; the
renderer page is a thin shell that embeds it in `<iframe sandbox="…" src="<asset-cdn>/…">`. The
asset CDN is already a different, unprivileged origin (§ 2.2). **How the sandbox tokens are set
decides both the isolation and whether the export's module bundle can even load — and those two
forces pull against each other.** So (a) is not one design; it is three variants, named here so
that ratification (and the pre-implementation spike, § 4) chooses between them rather than assuming
the strictest one works.

**The compatibility fact that splits (a) (`INFERRED` — must be spike-confirmed).** A Lovable export
is a Vite/React build. Vite's production HTML boots the app through a **module** script —
`<script type="module" crossorigin src="/assets/index-[hash].js">` — and the browser fetches
**module scripts in CORS mode** (classic `<script src>` is not CORS-gated for *loading*; module
scripts are). A frame given `allow-scripts` **without** `allow-same-origin` runs at an **opaque
(null) origin**, so its module-script fetch to the asset CDN is cross-origin with `Origin: null`,
and the CORS check requires the response to carry `Access-Control-Allow-Origin`. **`OBSERVED`
(§ 2.2): the asset `GET` path returns no such header.** **`INFERRED` (from browser module-script
semantics + Vite's known output shape — NOT a sampled corpus or a runtime test): an opaque-origin
frame loading a stock Vite export from the asset CDN fails the module-script CORS check, so the
primary bundle never executes and the page renders as an empty shell.** This is *not* the
"localStorage degrades" caveat the earlier draft listed — it is a threat to *rendering at all*
under the strictest variant, and it is the first thing the spike (§ 4) must settle.

- **(a-opaque) — strongest isolation, but likely does not render a stock Vite export.**
  `sandbox="allow-scripts"`, no `allow-same-origin`, asset CDN unchanged. **Isolation:** opaque
  origin → the § 2.3 containment argument below holds in full. **Compatibility:** per the fact
  above, the module bundle almost certainly does not load. **Session/tenant/infra consequence:** no
  new surface of any kind — but the feature likely does not work for the § 1 export shape. Viable
  only for a classic-script or fully-inline export, not the Vite default.
- **(a1) — opaque origin PLUS a deliberately designed asset CORS policy. PREFERRED variant.**
  Keep `allow-scripts` (opaque origin → full § 2.3 containment) and make the asset origin answer the
  module-script CORS check with a **constant** `Access-Control-Allow-Origin: *`. Two CloudFront facts
  dictate the exact construct shape (`OBSERVED`, `uploads.ts:49-55`):
  - A `ResponseHeadersPolicy` attaches to a **cache behavior**, and `AssetsDistribution` has only a
    **default behavior** — there is no prefix-scoped behavior to hang a policy on. So scoping CORS to
    the static-page prefix is **not** "one header policy": it is an **additional cache behavior**
    (path pattern `…/static-pages/*`, or the chosen prefix) **plus** a `ResponseHeadersPolicy`
    attached to *that* behavior. (Emitting the header from the *default* behavior instead would add
    `Access-Control-Allow-Origin: *` to *every* asset GET — tolerable, since the bytes are already
    world-readable, but a distribution-wide change; the added behavior is what keeps it scoped.)
  - A **constant** `*` needs **no** `Origin` forwarding and **no** cache-key variation, so
    `CACHING_OPTIMIZED` stays correct with no further work. The earlier `Vary: Origin` note was wrong
    on two counts: `Vary` does **not** control CloudFront's cache key (a **cache policy** does), and
    origin variation is only needed if the header is origin-*dependent* — which the constant `*`
    avoids. (Reflecting the request `Origin` instead would force `Origin` into the CloudFront **cache
    policy** — and an origin-request policy if S3 must see it — for strictly worse cacheability and
    no security gain over `*`, since the bytes are already public. Rejected: use the constant.)
  Module bundles then pass the CORS check and execute at the opaque origin.
  - **Session consequence: none.** The CORS grant is on the *asset* origin, not on
    `renderer/src/app/api/`; fact 1 of the containment argument (no CORS on the *renderer* APIs,
    `OBSERVED`) is untouched, so credentialed reads of the § 2.3 table stay opaque to the frame.
  - **Tenant-isolation consequence: negligible.** Asset bytes are *already* world-readable through
    the public CDN (§ 2.2), so `Access-Control-Allow-Origin: *` on `GET` exposes no data a plain
    `GET` did not; it only lets script *read* bytes it could already fetch. The opaque origin still
    has no storage/cookie of its own, so no cross-tenant state is created.
  - **Infra consequence: net-new but small — two constructs, not one.** An additional CloudFront
    cache behavior scoped to the static-page prefix, **plus** a `ResponseHeadersPolicy` (the estate
    has neither, § 2.2) emitting the constant `Access-Control-Allow-Origin: *` on that behavior, so
    image/asset GETs under the default behavior are unaffected. Neither touches the renderer
    distribution or the session origin.
- **(a2) — asset origin WITH `allow-same-origin`. Compatible without a CORS policy, but forfeits
  the opaque origin.** `sandbox="allow-scripts allow-same-origin"`: the frame runs at the **real
  asset CDN origin**, so module scripts are *same-origin* (no CORS needed) and `localStorage`/
  cookies work. The cost is the authority it regains:
  - **Session consequence:** the renderer session/attribution cookies live on the **renderer host**
    — a different origin — so `allow-same-origin` does **not** hand the frame those cookies; fact 1
    still holds. **The often-cited `allow-scripts allow-same-origin` "self-unsandboxing" escape does
    NOT apply here (`OBSERVED` host shape; per the [HTML Standard](https://html.spec.whatwg.org/multipage/iframe-embed-object.html)):** that escape — a framed script reaching into the parent to clear
    its own `sandbox` attribute and reload — requires the framed document to be **same-origin with its
    embedding parent**. Here the frame is served from the asset CDN host (`*.cloudfront.net`, § 2.2),
    which is deliberately **cross-origin** to the renderer parent host, so the frame cannot reach
    `parent.document` to strip its sandbox. So (a2)'s cost is **not** a sandbox-escape; it is the
    shared asset-origin storage authority (next bullet) — the frame runs at the *real* asset origin
    and gains that origin's storage, which the opaque-origin variants deny it.
  - **Tenant-isolation consequence: this is the real cost.** There is **one** shared
    `AssetsDistribution` for all tenants (§ 2.2), so every tenant's framed page runs at the *same*
    asset origin. A malicious/careless export can read/write that origin's `localStorage`,
    IndexedDB, and non-HttpOnly cookies — shared state another tenant's framed page relies on. That
    is net-new cross-tenant surface **on the asset origin**, absent under (a-opaque)/(a1), and must
    be weighed against Critical Rule 3 (tenant isolation) even though it never touches the renderer
    session origin.
  - **Infra consequence:** none (no CORS policy needed); the tenant-isolation analysis above becomes
    a standing obligation instead.

**Why `allow-same-origin` + `allow-scripts` are flagged as a pair (tied to the boundary, not
absolute).** They are not "never combine" in the abstract — combined they *are* variant (a2), and
the pairing is exactly what regains the frame's real asset-origin authority (the shared cross-tenant
surface just described). The rule is precise: for the **opaque-origin** variants (a-opaque / a1)
they must not appear together, because keeping them apart is what makes the origin opaque and the
§ 2.3 containment *browser-enforced*; choosing (a2) is a deliberate trade of that enforcement for
compatibility, analyzed above — not a default toggle.

- **Other sandbox tokens (all variants) — distinct tokens, distinct effects (do not conflate).**
  `allow-forms` permits form submission **inside the frame's own browsing context**; it does **not**
  grant top-level navigation. `allow-top-navigation` / `allow-top-navigation-by-user-activation`
  are what let the frame navigate the **parent/top** window. `allow-popups`
  (+ `allow-popups-to-escape-sandbox`) opens new contexts. Grant each only for the matching need
  (in-frame form → `allow-forms`; in-page link that should navigate the parent →
  `allow-top-navigation-by-user-activation`; external link in a new tab → `allow-popups`). Only the
  **top-navigation** tokens re-open the Lax-cookie CSRF vector of fact 3 (a cross-site top-level
  **safe-method** navigation — GET/HEAD — carries the Lax session cookie); `allow-forms` alone submits in the *child* context, which
  is **not** a top-level navigation and therefore carries **no** Lax renderer cookie — its risk is
  instead an unauthenticated write to an external or same-site endpoint (residual (i) below), not a
  cookie-CSRF. Each is a boundary change, not a convenience toggle; everything else stays denied.
- **What still degrades under the opaque-origin variants (a-opaque / a1), named honestly:**
  `localStorage`/`sessionStorage` throw (the opaque origin has no storage key) and cookies are
  unavailable — client-persistence and any cookie/localStorage-based analytics degrade; OAuth-popup
  flows break. **Relative URLs do NOT lose their base** — they resolve against the framed document
  URL (the asset-CDN object URL), so a relative `fetch`/`XHR` is a cross-origin request to the asset
  origin, subject to that origin's CORS. Absolute-URL analytics beacons that only *send* still work.
  Under (a1) the *render* works (module bundle loads) but these persistence/analytics degradations
  still apply; under (a2) persistence works too, at the tenant-isolation cost above. **No survival
  percentage is asserted** — the spike (§ 4) measures which degradations actually bite on a real
  export.
- **Why the § 2.3 authority is actually contained (the precise argument, not a categorical
  claim).** The frame *can* still call `fetch()`. Containment does not come from "no origin"; it
  comes from three independently-checked facts, and the recommendation is conditional on all
  three holding:
  1. **No CORS on the renderer APIs.** `grep -n "Access-Control-Allow"` across
     `renderer/src/app/api/` returns nothing (`OBSERVED`): a cross-origin `fetch` from the opaque
     frame to a renderer-origin API cannot *read* the response body. It can fire the request, but
     the answer is opaque to the script.
  2. **`SameSite=lax` cookies do not attach to cross-site sub-resource requests.** Both
     `next-auth.session-token` (`[...nextauth]/route.ts:41`) and `amodx_ref` (`ref/route.ts:90`)
     are `sameSite: 'lax'` (`OBSERVED`). A `fetch()` from the opaque-origin frame is a cross-site
     sub-resource request, so the browser withholds these cookies — the request reaches the API
     *unauthenticated*, and every session-gated route (`/api/profile`, `/api/account/orders`,
     `/api/comments`) answers `401`. `SameSite=Lax` *does* send the cookie on a **top-level
     safe-method navigation** — the [MDN `Set-Cookie` reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
     scopes Lax to top-level navigation with a *safe* HTTP method (GET/HEAD), so an unsafe-method
     top-level navigation (e.g. POST) **drops** it — which is the CSRF vector, bounded and closed by
     fact 3.
  3. **The sandbox token set withholds top-level navigation AND in-frame forms — two separate
     tokens.** With only `allow-scripts`, the frame can neither navigate the top window
     (`allow-top-navigation*` denied) nor submit a form (`allow-forms` denied). The Lax-cookie
     exception is narrow and method-sensitive: `SameSite=lax` cookies attach **only** to a
     **cross-site top-level safe-method (GET/HEAD) navigation** — **not** to a cross-site top-level
     **unsafe-method (e.g. POST)** navigation, and **not** to any child-frame (non-top) navigation.
     Three cases, kept distinct:
     - **Child-frame form submission** (`allow-forms`): navigates the frame's *own* context, which
       is not a top-level navigation, so the Lax session/attribution cookies are **withheld** —
       even a POST reaches the API unauthenticated.
     - **Top-level navigation** (`allow-top-navigation*`): navigates the top window. An **unsafe
       method** (e.g. POST) here still **drops** the Lax cookie; a **safe method** (GET/HEAD) carries it.
     - **The residual Lax risk:** a top-level **safe-method** navigation to a safe-method-reachable
       endpoint, which *does* carry the Lax cookie — concretely a top-level `GET /api/posts?x-tenant-id=…`
       cross-tenant read fired while the cookie rides along. This is the one vector a
       top-navigation token re-opens.
     **`POST /api/ref` (attribution poisoning) is NOT this Lax-cookie CSRF example** (`OBSERVED`:
     `ref/route.ts:69` is a `POST` handler): POST is an unsafe method, so neither a cross-site
     top-level POST nor a child-frame form POST carries the Lax cookie, so no sandbox token makes
     `POST /api/ref` a *cookie-carried* CSRF. Its write side-effect is instead the credential-free
     residual (i) below, reachable by `fetch()` regardless of tokens. Net: granting
     `allow-top-navigation*` re-opens the top-level safe-method Lax vector; granting `allow-forms`
     re-opens in-frame form submission (cookie-less external/same-site writes). Both are boundary
     changes, not convenience toggles.
  Residual, un-eliminated by the above and to be **validated by the pre-implementation spike that
  ratifying `D-STATIC-1` authorizes** (§ 4 — a bounded throwaway harness, *not* the `static-2`
  slice): (i) any renderer API that is *not* session-gated and *not* SameSite-
  protected — e.g. an unauthenticated `POST` with permissive/absent same-site semantics — remains
  reachable by a credential-free cross-origin request; the containment argument covers the
  cookie-carried authority of § 2.3, not "the frame can send zero bytes." (ii) DOM phishing is
  contained *to the frame* (the frame cannot repaint the parent chrome), but a full-bleed frame
  can still present a convincing fake form to the visitor — this is a content-trust concern the
  trust model (`D-STATIC-5`) must own, not a session-boundary breach.
- **SEO cost (name it):** iframe content is not part of the parent document's DOM, so it is not
  indexed as the tenant page's content. For a marketing/landing page this is a real cost and is
  the main reason someone would escalate to (c).
- **RISK (per variant):** (a-opaque) likely does not render a stock Vite export (module-script
  CORS, above) — a *compatibility* failure, not a security one. (a1) adds a scoped `infra/` pair
  (a static-page cache behavior + a constant-CORS `ResponseHeadersPolicy`, § 3(a1)); session/tenant
  risk negligible (analysis above). (a2) forfeits the
  browser-enforced opaque origin and introduces shared-asset-origin cross-tenant surface. Across
  all variants: the feature degradations above; iframe sizing/responsiveness UX; SEO; and the
  standing obligation that the token set stay minimal (facts 2–3 hold only while
  `allow-forms`/`allow-top-navigation*` are withheld). Under the opaque-origin variants none of
  these touch the session boundary **provided facts 1–3 hold and the residuals are validated**;
  (a2)'s tenant-isolation cost is the explicit exception.
- **REWARD:** for the variant the spike selects (preferred: **a1**), strongest isolation for the
  least *session-boundary* surface — the cross-origin unprivileged asset origin **already exists**
  (§ 2.2), the opaque origin is a browser-enforced boundary (not a sanitiser we must keep correct),
  and the only net-new surface is a scoped asset-origin cache-behavior + constant-CORS-header pair
  (§ 3(a1)). Under facts 1–3 the script reaches **no cookie-authenticated row** of the § 2.3 table.

### (b) Sanitised inline — REJECTED as functionally near-zero

Route the export through a sanitiser (the existing `sanitize.ts` or a stricter one) and inline it
into a normal page.

- **Survival, reasoned from the export shape — not from a measured corpus:**
  - `OBSERVED`: the repo sanitiser strips `script`/`style`/`iframe` (`sanitize.ts:8-43`), and an
    `innerHTML` assignment cannot execute even an *un*-stripped `<script src>` (§ 2.1, the HTML
    `innerHTML` rule). So inline rendering is the functional ceiling regardless of which sanitiser
    is chosen.
  - `INFERRED`: a Lovable export of the shape § 1 describes (a Vite/React client-rendered bundle
    whose visible content is produced *by* its scripts) reduces, once its scripts cannot run, to an
    empty or unhydrated shell.
  - `ASSUMPTION` — **no survival percentage is asserted.** We have **not** sampled a corpus of real
    Lovable exports, so no observed population statistic exists. The earlier "~0%" figure is
    **withdrawn** as unmeasured. The claim this plan stands behind is only the conditional above:
    *for a script-driven export, functional survival is nil.* An export that happens to be
    static-only HTML/CSS would in fact survive (b) — but that is not the request § 1 states.
  This does not solve the stated problem **for the export shape § 1 describes**; it re-labels it.
  **Rejected for that shape.**

### (c) Dedicated top-level static origin — VIABLE ESCALATION for SEO, but NOT a session/CSRF boundary by itself

Serve the export top-level from a distinct host so it is fully indexable (fixes (a)'s SEO cost).
The naive shape is a platform subdomain `<tenant>.static.<rootDomain>`
(e.g. `acme.static.bijuterie.software`). **The correction the first two iterations got wrong
(`OBSERVED` cert/host shape; `INFERRED` same-site cookie semantics):**

- **A platform subdomain is *same-site* with the renderer host, so it does NOT isolate the
  session/attribution cookies.** The wildcard cert and every tenant host sit under the registrable
  domain `<rootDomain>` (`domains.ts:24-29` issues `<rootDomain>` + `*.<rootDomain>`; tenant sites
  are `<tenant>.<rootDomain>`). `<tenant>.static.<rootDomain>` shares that same eTLD+1, so it is
  **cross-origin but same-site** with `<tenant>.<rootDomain>`. `SameSite=lax` — the property that
  saves option (a) — is decided by *site*, not origin; it is withheld only from **cross-site**
  requests. A credentialed `fetch()` **or** navigation from the static subdomain to the renderer
  host is a **same-site** request, so the browser **attaches** the host-only
  `next-auth.session-token` / `amodx_ref` cookies (they are host-only, but the request targets
  exactly the host they belong to). Absent CORS blocks the static script from *reading* the
  response, but it does **not** block the request's server-side side-effect — so a state-changing
  `POST /api/ref?v=` (attribution poisoning) or any same-site CSRF against a renderer-host endpoint
  **succeeds**. Host-only + HttpOnly stop the static document from *reading* the cookie; they do
  **not** stop it from causing the browser to *send* it. **A platform subdomain is therefore an
  SEO / top-level improvement, not a session/CSRF isolation boundary.** Option (a)'s fact 2 holds
  only because the sandboxed frame is at an **opaque origin**, which is cross-site to everything; a
  real subdomain forfeits that.

Two ways to make (c) actually isolate, each with its own cost:

- **(c1) Genuinely separate registrable site.** Serve the static origin under a *different* eTLD+1
  the platform owns (a shared apex, e.g. `*.amodx-static.app` for all tenants; or a per-tenant
  custom apex). Now the static origin is **cross-site** to the renderer host, so `SameSite=lax`
  withholds the cookies from cross-site sub-resource `fetch` → the CSRF-via-fetch vector closes.
  **Residual even here:** `SameSite=lax` still sends the cookie on a cross-site **top-level
  safe-method (GET/HEAD) navigation**, and (c) *is* top-level (no parent to impose sandbox tokens as
  in (a)), so a link/navigation from the static page to a renderer-host GET URL still carries the
  cookie; state-changing GET endpoints and responses that leak on navigation need explicit CSRF hardening.
  **Cost:** a whole new registrable domain — new hosted zone, new cert, new distribution/behaviour;
  a per-tenant apex additionally needs per-tenant DNS **and** cert, which the estate has no
  construct for (§ 2.2).
- **(c2) Keep the `<tenant>.static.<rootDomain>` subdomain for SEO/top-level ONLY, and add an
  explicit CSRF/isolation design on top** — the renderer APIs must reject the same-site request
  server-side (Origin/Referer allow-listing or CSRF tokens), which is net-new security surface the
  CACHE track did not build. **Cost:** one `*.static.<rootDomain>` wildcard cert + Route53 record
  (`OBSERVED`: the existing `*.<rootDomain>` cert does **not** cover the second level
  `<tenant>.static.<rootDomain>`; an ACM wildcard matches exactly one **leftmost** label — and
  `static.*.<rootDomain>` is not ACM-issuable because the wildcard is not leftmost) **plus** the
  CSRF design above.

- **DNS/cert cost summary (`OBSERVED` cert facts):** (c2)'s subdomain is the cheapest DNS/cert shape
  — one shared second-level wildcard cert/record for all tenants — but it buys SEO, **not**
  isolation, and is unsafe without the server-side CSRF hardening. (c1)'s genuinely-isolating shape
  costs a separate registrable domain. Either is real `infra/` surface (cert, distribution/behaviour,
  DNS) gated by the standing operator directive (`ROADMAP.md` §Standing) on a named gain.
- **RISK:** (c) is a top-level origin serving attacker-controlled script — a larger blast surface
  than a null-origin frame, and it cannot be sandbox-token-restricted the way (a)'s frame is. The
  naive subdomain (c2 without hardening) is **not** a session boundary at all; even (c1) leaves the
  top-level safe-method (GET/HEAD) navigation vector. It is also "a different URL," not "a page on the tenant's site".
- **REWARD:** top-level and fully indexable, no iframe feature degradation — the right answer **only
  when SEO/top-level is a ratified hard requirement** and the isolation design (c1 or c2) is
  actually built, not assumed.

### (d) Same-origin raw — REJECTED (precise enumeration)

Inline the export's script into a tenant page on the renderer origin (or serve it from the
renderer distribution's own `assets/*`). A hostile *or merely compromised/careless* export then
has the full § 2.3 authority. Enumerated, not asserted, it can: issue credentialed `fetch` to
`GET /api/profile` and `GET /api/account/orders` to read the logged-in customer's PII and order
history; `POST /api/comments` as that customer; overwrite the `amodx_ref` attribution cookie via
`POST /api/ref?v=`; read **another tenant's** posts via `GET /api/posts` with a chosen
`x-tenant-id`; scrape order id + email from checkout URLs; and rewrite the page DOM to phish
payment/PII. It cannot read the HttpOnly session token directly — it does not need to; it *uses*
it. This is a direct breach of the boundary the CACHE track sealed and of tenant isolation
(Critical Rule 3, PD-001). **Rejected outright.**

### Recommendation

**Adopt the (a) *family* — sandboxed iframe from the existing asset origin — as the ratified
isolation direction, with (a1) the preferred concrete variant and (c) named as the escalation
path.** The (a) family reuses the cross-origin unprivileged origin the estate already has (§ 2.2)
and makes isolation a browser-enforced boundary rather than a sanitiser we maintain. Two things
about this recommendation are deliberately *not* categorical:

1. **Which concrete variant is not yet decided by evidence.** (a-opaque) has the strongest
   isolation but, per the module-script CORS fact (§ 3(a)), likely does not render a stock Vite
   export. (a1) fixes that with a scoped asset-origin cache-behavior + constant-CORS
   `ResponseHeadersPolicy` pair (§ 3(a1)) while keeping the opaque origin — it is the **preferred**
   variant on paper. (a2) is compatible without any CORS
   policy but forfeits the opaque origin for a shared-asset-origin cross-tenant surface. The choice
   between them turns on a runtime fact (does a1's CORS grant actually let a real export boot?) that
   this doc cannot observe.

2. **Containment is conditional, not categorical.** Under the opaque-origin variants it rests on the
   three `OBSERVED` facts in § 3(a) (no CORS on the *renderer* APIs; `SameSite=lax` session/
   attribution cookies; a minimal `allow-scripts`-only token set that withholds navigation/forms)
   plus the two residuals flagged there (non-session-gated same-site-loose endpoints; in-frame
   phishing owned by `D-STATIC-5`).

**Therefore ratifying `D-STATIC-1` = authorizing a bounded, throwaway compatibility-and-containment
spike, NOT blanket adoption of a concrete variant.** The spike (§ 4, sitting *between* `static-1`
and `static-2` — not inside either) settles which variant renders a real Lovable export and
validates the two residuals; the concrete variant is *adopted on the spike's result*. This removes
the circular "ratify (a) ⇢ needs the spike ⇢ spike is in static-2 ⇢ static-2 needs (a) ratified"
loop the prior draft had: the spike's authorization *is* the ratification, and `static-2`
(schema/storage) is authored only after the spike selects a viable variant (or, if it refutes the
whole (a) family, escalates to (c)). Accepted costs: the named feature-degradation list, the SEO
limitation, the standing obligation to keep the token set minimal, and — if the spike forces (a1) —
a scoped `infra/` cache-behavior + constant-CORS `ResponseHeadersPolicy` pair (§ 3(a1)), or — if it forces (a2) — the shared-asset-origin
tenant-isolation obligation.

Reject (b) as non-functional for the script-driven export shape § 1 describes (no survival
percentage is measured — § 3(b)); reject (d) as a boundary breach. Escalate to (c) only when
top-level/SEO is ratified as a hard requirement — and note that **(c) is not a drop-in replacement
for (a)'s isolation:** a platform subdomain (`<tenant>.static.rootDomain`) is *same-site* with the
renderer host and does **not** isolate the session/attribution cookies (§ 3(c)), so (c) must either
move to a genuinely separate registrable site (c1) or add explicit server-side CSRF hardening (c2),
on top of naming its `infra/` gain. Do not build (c)'s DNS/cert machinery — or assume its isolation
— speculatively.

Full block in § 6, `D-STATIC-1`.

---

## 4. Proposed phases (`static-1`..`static-4`) and the ratification-authorized spike between them

Numbering is the ratified ROADMAP row — **still four phases, no fifth**. `static-1` is doc-only
(this plan + the isolation decision). Between `static-1` and `static-2` sits a **bounded
compatibility-and-containment spike that ratifying `D-STATIC-1` authorizes** — it is *not* a phase,
not a slice doc, and not numbered; it is a throwaway validation task whose whole purpose is to pick
the concrete (a) variant and validate the § 3(a) residuals before any schema/storage is committed.
`static-2`..`static-4` are authored only after that spike returns a viable variant (or escalates to
(c)), because the isolation model dictates storage location, schema, and route shape.

### `static-1` — Isolation model (this plan, doc-only, DELIVERED)

- **Scope:** this document and the ROADMAP STATIC row. It records the estate, states the
  isolation problem, and raises `D-STATIC-1`..`D-STATIC-5` for ratification. Per `ROADMAP.md:210`,
  `static-1 = the plan itself, doc-only, delivered` — it performs **no** spike and changes **no**
  code, consistent with the packet's no-implementation constraint.
- **Non-scope:** no schema, no admin UI, no renderer route, no `infra/`, **no spike** (a spike
  touches running software; it is the ratification-authorized task below, deliberately *not* run in
  this delivered decision-plan).
- **Risks:** none beyond stale reconciliation — the plan's phase/delivery claims must stay in sync
  with the ROADMAP row (§ 8).
- **Output surface:** this document; the ROADMAP STATIC row; the five decision records in § 6.

### Ratification-authorized spike (between `static-1` and `static-2`, not a phase)

- **What ratifying `D-STATIC-1` licenses:** a bounded, throwaway harness — no production code, no
  persisted schema, `infra/` touched only as a disposable test distribution/policy if (a1) is being
  probed. It exists to convert the two `INFERRED` unknowns this doc could not observe into decisions.
- **It must settle, in order:**
  1. **Compatibility — which (a) variant renders a real Lovable export.** Serve one real export from
     the asset origin and load it under (a-opaque). If (as § 3(a) infers) its Vite module bundle
     fails the CORS check and the page is blank, retry under (a1) (add the scoped
     `Access-Control-Allow-Origin` response header on the test distribution) and confirm the bundle
     boots; only if a1 still fails consider (a2) (`allow-same-origin`) and record that its shared-
     asset-origin tenant-isolation cost is now in play. **Output: the concrete variant to adopt.**
  2. **Containment residuals — validate the two § 3(a) items** on the selected variant: that no
     non-session-gated renderer API is reachable credential-free from the frame, and that in-frame
     phishing is the only remaining DOM-trust exposure (owned by `D-STATIC-5`).
  3. **Degradation inventory:** record which § 3(a) feature-degradations actually bite on the export.
- **Exit:** a viable variant + validated residuals → author `static-2` against it. Refuted
  containment, or a common Lovable feature degrading unacceptably under every (a) variant → escalate
  to (c) rather than proceed. This spike is implementation and is deliberately deferred out of
  `static-1`.

### `static-2` — S3 storage + page schema (opens only after the spike above returns a variant)

- **Scope:** where the HTML object lives (asset bucket, per-tenant key prefix), the
  `StaticPage`/route record that makes a slug resolve to it (see `D-STATIC-2`), size/content
  limits (`D-STATIC-3`), and versioning on re-upload (`D-STATIC-4`).
- **Non-scope:** no admin UI, no renderer route, no execution model change.
- **Risks (corrected to the actual estate, § 2.2 / D-STATIC-2):** a static page registered as a
  `ROUTE#<slug>` **does** inherit slug-vs-page uniqueness from the existing `attribute_not_exists(SK)`
  conditional write on the `ROUTE#` item (`content/create.ts:126`) — but that is the *only* thing
  reused for free. It does **not** reuse the commerce-prefix `slug-guard`
  (`backend/src/lib/slug-guard.ts:9-37` checks commerce prefixes only, not page routes — a static
  create handler must call it explicitly to avoid shadowing a commerce prefix), and it does **not**
  reuse admin listing (`content/list.ts:44` queries `begins_with(SK, "CONTENT#")` and filters
  `#LATEST`, so a `STATICPAGE#`-kinded target is invisible to it — listing needs a second query or
  a unified list). The resolver `getContentBySlug` (`dynamo.ts:178-211`) hard-codes a second
  `CONTENT#…#LATEST` GET off `routeRes.Item.TargetNode`; a static target needs a discriminator on
  the route item and a branch that skips that GET.
- **Output surface:** `packages/shared` schema; a backend storage handler; DynamoDB key shape; the
  resolver/list changes named above.

### `static-3` — Admin upload / preview / publish

- **Scope:** admin upload of the HTML (+ its asset bundle), an **isolated preview** that renders
  it through the *same* sandbox as production (a preview that is more permissive than production
  is a lie), and a publish action gated by the trust model (`D-STATIC-5`).
- **Non-scope:** no live renderer route until `static-4`.
- **Risks:** preview fidelity — if preview and production use different sandbox tokens, an export
  that "works in preview" can break or (worse) over-reach in production.
- **Output surface:** admin page(s); the upload handler from `static-2` extended for bundles.

### `static-4` — Renderer route integration

- **Scope:** the renderer resolves a static slug to the shell-with-iframe (option a) or the
  chosen origin, honouring the serving contract (§ 5) and the access policy on the record.
- **Non-scope:** no new dynamic API; static pages carry no per-request input by definition.
- **Risks:** the shell must stay cacheable (§ 5) — any dynamic API call in the shell route is a
  hard 500 under the serving contract, not a graceful downgrade.
- **Output surface:** a renderer route/component under `renderer/src/app/[siteId]/`.

---

## 5. Interaction with the serving contract

Static pages are **static by definition**, so they are the *most* cacheable content in the
system — but the contract's mechanics still apply and dictate the route shape.

- **The anonymous clean-URL shell is ISR-cacheable; but static-slug resolution must ALSO run
  through the existing dynamic twin — no NEW twin route, just the existing one (`OBSERVED`).** Under
  `docs/caching-architecture.md` § *Serving contract*, a route serves cacheable HTML iff it
  exports `generateStaticParams()` **and** no reachable code path calls a dynamic API. An
  option-(a) shell is a static `<iframe>` pointing at a fixed asset URL — it reads no
  `cookies()`/`headers()`/`searchParams`, so *for an anonymous request with no query string* it is
  naturally cacheable on `[[...slug]]/page.tsx`. **The correction the earlier draft got wrong:** the
  shell having "no per-request input" does **not** mean the twin is unused. `middleware.ts:129-133`
  rewrites **any** request that carries a session cookie **or** a non-empty query string to the
  force-dynamic twin `[siteId]/%5Fdyn/[[...slug]]` (`OBSERVED`), which renders the **same** `SitePage`
  body (`[[...slug]]/page.tsx:16-18` documents the handoff; `%5Fdyn/.../page.tsx:20,45-63` renders
  `SitePage`). A logged-in customer, or a link with `?utm=…`, requesting a static slug therefore
  resolves it **on the twin**. So static-slug resolution must live in the shared `SitePage`/resolver
  path both routes call — the requirement is that the *existing* twin can render the static shell,
  **not** that a new twin route is added. The framed content is served by `AssetsDistribution` under
  `CACHING_OPTIMIZED` (§ 2.2) regardless of which renderer route emitted the shell. The variant choice
  does not change any of this: a1's scoped cache-behavior + CORS-header pair and a2's
  `allow-same-origin` affect only the *framed* asset response, not the shell route. Under a1 the added
  header is a **constant** `Access-Control-Allow-Origin: *` on the static-page behavior, which needs no
  cache-key variation, so `CACHING_OPTIMIZED` stays correct as-is: a constant header is identical
  across origins, and (per § 3(a1)) `Vary: Origin` is neither needed nor the mechanism that controls
  CloudFront's cache key (a cache policy is).
- **Two contract obligations the shell must honour:**
  1. **Never answer not-found or a failed read from the cacheable route.** A missing/unpublished
     static slug must take the existing `?nf=1` handoff to the twin, not `notFound()` inline — a
     cached 404 pins for up to a year (§ *How a 404 stays out of the cache*). The lookup that
     resolves the slug must let read failures **throw**, per the repo-wide D4 rule.
  2. **Access-gated static pages pull to the twin.** `accessPolicy` today lives on the resolved
     CONTENT node item, defaulted to `Public` at `dynamo.ts:203` — it is not on the `ROUTE#` item,
     so a `STATICPAGE#` target record (D-STATIC-2) would need to carry its own `accessPolicy`
     field for this to apply. If a static page's policy is not `Public`, the `cookies()`-based gate
     makes it per-request → it must live on the dynamic route, exactly like gated block pages.
     `D-STATIC-2`/`D-STATIC-5` should state whether static pages may be access-gated at all in
     phase 1 (recommend Public-only first — it keeps every static page on the cheap cacheable path).
- **Publish/rollback must invalidate the cached *shell*, not merely version the asset (`OBSERVED`).**
  A versioned iframe `src` (D-STATIC-4) prevents stale *asset-object* reuse at the asset CDN, but the
  **renderer shell route is itself cached** with `revalidate = false` (`caching-architecture.md:294-296`)
  — it is retained until *explicit* invalidation, and **both** cache layers must be invalidated
  (`caching-architecture.md:24`: CloudFront invalidation alone leaves stale OpenNext S3 objects, and
  vice-versa). Because the cached shell embeds whichever versioned asset URL was current at render
  time, flipping the published pointer changes what the shell *should* embed, so publish/rollback must
  enter the existing on-demand invalidation flow: `revalidatePath()` on the shell route **and** the
  CloudFront + OpenNext S3 invalidation the CACHE track already runs for content publishes. Versioning
  the asset does **not** make this fall out for free — it removes one failure mode (stale bytes at a
  stable key) but the shell-route revalidation obligation remains.
- **A failing `renderer/test/serving-contract/` assertion is a contract change**, per
  `CLAUDE.md`; `static-4` adds its coverage in the same slice as any serving-behaviour change.

---

## 6. Collected `DECISION_REQUIRED` blocks

DECISION_REQUIRED:
- ID: D-STATIC-1
  QUESTION: Where does an untrusted Lovable export's JavaScript execute, relative to the renderer session/cookie/attribution boundary (§ 2.3)?
  OPTIONS:
  - (a) Sandboxed `<iframe>` served from the existing cross-origin asset origin — a FAMILY of three variants, because the sandbox tokens trade isolation against whether the export's module bundle can load (§ 3(a)). COMPATIBILITY FACT (INFERRED, spike-must-confirm): a stock Vite/React Lovable export boots via a `<script type="module" crossorigin>` fetched in CORS mode; an opaque-origin frame sends `Origin: null` and the asset `GET` returns no `Access-Control-Allow-Origin` (OBSERVED, § 2.2), so the bundle fails to load and the page renders blank. Variants: (a-opaque) `allow-scripts` only — strongest isolation, but likely does NOT render a stock Vite export; (a1, PREFERRED) opaque origin + a scoped CloudFront **cache behavior** carrying a `ResponseHeadersPolicy` that emits a **constant** `Access-Control-Allow-Origin: *` on the asset origin (a headers policy attaches to a behavior, and AssetsDistribution has only a *default* one — so the scoped construct is a behavior+policy **pair**, not a lone policy; a constant `*` needs no `Origin` forwarding or cache-key variation, so `CACHING_OPTIMIZED` stays correct — `Vary: Origin` does not control CloudFront's cache key) — bundle loads, § 2.3 containment intact, session/tenant risk negligible (asset bytes already public), net-new cost is one small `infra/` behavior+policy pair; (a2) `allow-scripts allow-same-origin` — compatible with no CORS policy but forfeits the opaque origin for a shared-asset-origin cross-tenant surface (one AssetsDistribution for all tenants → shared localStorage/cookies; Critical Rule 3 concern). RISK: opaque-origin variants break localStorage/cookies (relative fetches still resolve to the asset origin, cross-origin); iframe content is not SEO-indexed as the page; containment of § 2.3 is CONDITIONAL on three OBSERVED facts (no CORS on renderer APIs; `SameSite=lax` cookies attach ONLY to cross-site top-level **safe-method (GET/HEAD)** navigations — not to a top-level unsafe-method (e.g. POST) navigation, not to child-frame navigation; `allow-scripts`-only token set withholding both top-level navigation and in-frame forms, which are DISTINCT tokens) — granting `allow-top-navigation*` re-opens the top-level safe-method Lax vector (a cross-site top-level POST is unsafe and drops the Lax cookie, so `POST /api/ref` is NOT that vector — it is the credential-free residual (i)); `allow-forms` re-opens only cookie-less in-frame form writes. REWARD: browser-enforced isolation with (under a1) a scoped asset-origin behavior+CORS-header pair as the only net-new surface; under the three facts the script reaches no cookie-authenticated § 2.3 route. Two residuals (non-session-gated same-site-loose endpoints; in-frame phishing) plus the variant choice require the ratification-authorized spike (§ 4) before a concrete variant is adopted.
  - (b) Sanitised inline. RISK/REWARD: OBSERVED that sanitising strips scripts and `innerHTML` cannot execute them anyway (§ 2.1); INFERRED that a script-driven Lovable export (the § 1 shape) then renders as a non-functional shell. NO survival percentage is measured — no corpus was sampled, so the earlier "~0%" is WITHDRAWN as an unverified assumption; the standing claim is only the conditional "for a script-driven export, functional survival is nil." Does not solve the stated problem for that export shape. REJECTED for it.
  - (c) Dedicated top-level static origin. RISK: a platform subdomain `<tenant>.static.rootDomain` is cross-origin but **same-site** with the renderer host, so `SameSite=lax` still attaches the session/attribution cookies to same-site fetches/navigations — absent CORS blocks *reading* the response but NOT the state-changing CSRF side-effect (e.g. `POST /api/ref?v=`); it is therefore an SEO/top-level improvement, NOT a session/CSRF boundary. To actually isolate: (c1) a genuinely separate registrable site (cross-site → Lax withholds cookies on sub-resource fetch; residual: Lax still carries cookies on a cross-site top-level safe-method (GET/HEAD) navigation, which a top-level origin cannot sandbox away) at the cost of a whole new registrable domain/cert; or (c2) keep the subdomain for SEO only (cheapest: one `*.static.rootDomain` wildcard cert + Route53 record — existing `*.rootDomain` cert does NOT cover it, `static.*.rootDomain` not ACM-issuable) PLUS explicit server-side CSRF/Origin hardening. `infra/`-gated; larger blast surface than a null-origin frame. REWARD: top-level + indexable, no iframe degradation — only when SEO is a hard requirement and the isolation design (c1/c2) is built.
  - (d) Same-origin raw. RISK: hands the export full § 2.3 authority (credentialed reads of customer PII/orders, comment impersonation, attribution poisoning, cross-tenant `/api/posts`, DOM phishing). REWARD: none that survives the boundary. REJECTED.
  RECOMMENDED: adopt the (a) FAMILY as the ratified direction with (a1) the preferred concrete variant — but ratifying `D-STATIC-1` = AUTHORIZING a bounded, throwaway compatibility-and-containment spike (§ 4, sitting between `static-1` and `static-2` — NOT inside either, and NOT a new phase), NOT blanket adoption of a variant. The spike picks the variant that actually renders a real Lovable export (a-opaque → a1 → a2 in that preference order) and validates the two residuals; `static-2` is authored on its result. This breaks the prior draft's circular loop (ratify-(a) needed a spike that lived inside static-2 which needed (a) ratified). Escalate to (c) only when top-level/SEO becomes a hard requirement, ONLY after its isolation design (c1 genuinely-separate registrable site, or c2 subdomain + server-side CSRF hardening) is built and its `infra/` gain named; a naive `<tenant>.static.rootDomain` subdomain is same-site and does NOT isolate the session boundary. Reject (b) (non-functional for the § 1 export shape) and (d) (boundary breach).
  BLOCKING_REASON: Isolation dictates storage location, schema, preview fidelity, and route shape — `static-2`..`static-4` cannot be authored until the variant is chosen by the ratification-authorized spike. RATIFICATION-CLASS: it decides whether tenant-supplied script ever runs inside the boundary the CACHE track sealed.

DECISION_REQUIRED:
- ID: D-STATIC-2
  QUESTION: How does a static page coexist with block pages in the `ROUTE#`/content model? NOTE the existing schema↔persistence divergence this must not paper over: the Zod `RouteSchema` (`shared/index.ts:154-162`) declares camelCase `targetNodeId`/`isRedirect`/`redirectTo`, but the **persisted** route item is written and read in PascalCase — `TargetNode`, `IsRedirect`, `RedirectTo` (`content/create.ts:114-127`, consumed at `dynamo.ts:181-196`). The renderer resolves `routeRes.Item.TargetNode`; the Zod schema is not the read contract. Any static-page target field must match the *persisted* convention actually consumed, not the aspirational schema.
  OPTIONS:
  - Register a normal `ROUTE#<slug>` whose item carries a target-kind discriminator pointing at a new `STATICPAGE#<id>` record (holding the asset key, version, accessPolicy) instead of `TargetNode → CONTENT#`. Consequence: inherits slug uniqueness from the existing `attribute_not_exists(SK)` conditional write on the `ROUTE#` item (`content/create.ts:126`) — one thing for free. REQUIRES: (1) a branch in `getContentBySlug` (`dynamo.ts:178-211`) that reads the discriminator and, for a static target, skips the second `CONTENT#…#LATEST` GET; (2) an admin listing path — `content/list.ts:44` queries `CONTENT#` only, so static pages need a second query or a unified list; (3) an explicit `checkSlugCommerceConflict` call in the static create handler — `slug-guard.ts:9-37` guards commerce prefixes only, NOT page routes, so it is not inherited by writing a `ROUTE#` item.
  - Introduce a parallel `STATICROUTE#<slug>` namespace. Consequence: clean separation but the renderer must query two namespaces per request, and slug-uniqueness across block and static pages is no longer enforced by a single conditional write (a static and a block page could claim the same slug).
  RECOMMENDED: reuse `ROUTE#<slug>` with a target-kind discriminator — it keeps slug uniqueness in one place (the `ROUTE#` conditional write) — while explicitly scoping the three required changes above (resolver branch, listing query, explicit commerce-prefix guard call). Do not describe listing or the commerce guard as "free."
  BLOCKING_REASON: Determines the `static-2` schema, the resolver branch, the listing change, and whether a static slug can silently shadow a block page or commerce prefix.

DECISION_REQUIRED:
- ID: D-STATIC-3
  QUESTION: What size/content limits apply to an uploaded static page and its bundle?
  OPTIONS:
  - Reuse the media limits (`packages/shared/src/media.ts`, advisory 10 MB image / 50 MB video, allowlisted MIME) with an added `text/html` entry and a per-page total-bundle cap. Consequence: one code path; but note the presigned PUT does not bind content-length (§ 2.2), so the cap is advisory unless enforced separately.
  - Add a dedicated static-page limit (e.g. N files, total M MB, explicit MIME allowlist for the bundle) with server-side enforcement.
  RECOMMENDED: dedicated limit with an explicit bundle MIME allowlist — `text/html` + JS/CSS/media — because a page is a *set* of objects, not one asset, and the advisory PUT cap is insufficient for untrusted content.
  BLOCKING_REASON: Sets the `static-2` storage contract and the upload handler's validation.

DECISION_REQUIRED:
- ID: D-STATIC-4
  QUESTION: Update semantics — is a re-upload a new version or an in-place overwrite?
  OPTIONS:
  - Versioned: each upload writes a new keyed prefix; publish flips the pointer; rollback is repoint. Consequence: safe rollback + audit, and a versioned iframe `src` removes stale *asset-object* reuse at the asset CDN; more storage and a version pointer in the record. NOTE (`OBSERVED`): versioning does NOT make renderer-cache correctness free — the shell route is cached `revalidate = false` until explicit invalidation (`caching-architecture.md:294-296`) and both cache layers require invalidation (`:24`), so publish/rollback still must `revalidatePath()` the shell route AND run the existing CloudFront + OpenNext S3 invalidation (§ 5, publish/rollback bullet).
  - In-place overwrite of the object at a stable key. Consequence: simplest; but no rollback, and both the asset CDN object AND the renderer shell route must be invalidated on every re-upload (`CACHING_OPTIMIZED` asset + `revalidate = false` shell, § 2.2 / `caching-architecture.md:24,294-296`) or stale content is served.
  RECOMMENDED: versioned with a published-pointer — it gives rollback + audit and eliminates the stale-asset-object failure mode; the shell-route revalidation + two-layer CloudFront/OpenNext invalidation is a *standing* obligation of either option (it does NOT "fall out" of versioning) and must enter the CACHE track's existing on-demand invalidation flow. Matches the expand-before-contract posture.
  BLOCKING_REASON: Determines the `static-2` key shape, the publish action in `static-3`, and the two-part cache-invalidation story (asset-object versioning + shell-route revalidation across both cache layers).

DECISION_REQUIRED:
- ID: D-STATIC-5
  QUESTION: Trust model — who may publish raw HTML: any tenant admin, or only the agency?
  OPTIONS:
  - Agency-only (a platform/super-admin role gates publish). Consequence: raw-HTML power stays with the party that understands the isolation model; matches the `html` block's stated "trusted roles only" posture (§ 2.1). Tenants request a page; the agency publishes it.
  - Any tenant `TENANT_ADMIN`. Consequence: self-service, but every tenant admin can now publish arbitrary script. Under (a) that script is confined to the null-origin sandbox (tolerable). Under (c) it depends on the isolation design: a naive `<tenant>.static.rootDomain` subdomain is *same-site* with the renderer host (§ 3(c)), so a tenant-published script can drive same-site CSRF against the session boundary — **not** tolerable until (c1)/(c2) isolation is built and proven. Under (d) it has the full § 2.3 authority — never tolerable.
  RECOMMENDED: agency-only for phase 1 — the isolation guarantee is only as good as the operator's understanding of it, and this is the agency's product. Revisit for tenant self-service once (a) is proven and the sandbox is the enforced default. Note the coupling: this decision's safety depends entirely on `D-STATIC-1`'s isolation actually holding — tolerable under a proven (a); under (c) only after (c1)/(c2) CSRF isolation is built; under (d) never.
  BLOCKING_REASON: Gates the `static-3` publish action and the role check; and it is only meaningful once `D-STATIC-1` fixes the execution context.

---

## 7. Non-Goals

- AmodX does not execute tenant-supplied script inside the renderer's own origin. The whole
  track exists to keep it out (§ 2.3, § 3(d)).
- Not a general "embed arbitrary third-party app" platform — the unit is a self-contained static
  page/bundle, not a live integration with the renderer's APIs.
- No editing of Lovable output inside AmodX; the export is published as-is (the point of § 1).
- Phase 1 does not build option (c)'s dedicated static-origin DNS/cert or its CSRF/isolation design
  (c1 separate registrable site, or c2 subdomain + server-side CSRF hardening) — (c) is named as an
  escalation, not scoped here (standing `infra/` directive).

## 8. ROADMAP reconciliation & follow-ups

- The `docs/ROADMAP.md` STATIC row is updated in this slice to record that this plan is authored
  and that `D-STATIC-1`..`D-STATIC-5` await ratification before any `static-*` slice doc is
  authored — mirroring how the EMAIL row records `plan-email-onboarding.md`. The row also records
  that (a) is a three-variant family (preferred **a1**), that the module-script CORS fact makes the
  strictest variant likely non-rendering, and that ratifying `D-STATIC-1` **authorizes a bounded
  pre-implementation spike** (between `static-1` and `static-2`, not a new phase) rather than
  adopting a variant outright — the phrasing that replaces the earlier "gated at the static-2 entry
  gate," which was circular.
- `static-` prefix to be registered in `docs/documentation.md` § *Naming Conventions* when the
  first `static-*` slice doc is authored (not by this doc-only plan).
- No `docs/TECH-DEBT.md` entry is created by this plan; the unsanitised-`html`-block observation
  (§ 2.1) is pre-existing and out of this track's scope.

## References

- `docs/ROADMAP.md` § *Backlog / Discovery Tracks* (STATIC row)
- `docs/caching-architecture.md` § *Serving contract*, § *How a 404 stays out of the cache*,
  § *Failed reads throw* (the CACHE-track boundary this plan must not erode)
- `docs/platform-decisions.md` PD-001 (tenant isolation), PD-002 (renderer-proxy)
- `CLAUDE.md` Critical Rules 1 (plugin split), 3 (tenant isolation), 6 (theming)
- Estate: `packages/plugins/src/html/*`, `infra/lib/uploads.ts`, `infra/lib/renderer-hosting.ts`,
  `renderer/middleware.ts`, `renderer/src/app/api/*`, `packages/shared/src/media.ts`,
  `packages/shared/src/index.ts:154-162`, `renderer/src/lib/dynamo.ts:178-211`
