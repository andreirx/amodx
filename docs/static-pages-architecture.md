# Static-HTML Pages — Isolation Architecture (Track STATIC)

Records the **isolation model** and the **anonymous-write-endpoint hardening** delivered by
slice `STATIC-EP` (docs/slices/static-endpoint-hardening.md) — the D-STATIC-1
endpoint-hardening rider, precondition to the plan's `static-2`. Design rationale and the
ratified decisions live in `docs/plan-static-html-pages.md` (D-STATIC-1..5, RATIFIED
2026-08-07). This note is the *as-built* record; the plan is the *why*.

Maturity: **PROTOTYPE**. `STATIC-EP` builds only the isolation barrier's contract + its
precondition (endpoint hardening). Storage/schema (`static-2`), admin upload/preview
(`static-3`), and the renderer iframe embed (`static-4`) are not built here.

---

## 1. The isolation model (D-STATIC-1)

Untrusted, tenant-supplied static HTML (e.g. a Lovable/Vite export) must run its own
scripts, but must never run them with the ambient authority of the renderer's origin — that
origin carries the NextAuth session cookie, the `amodx_ref` attribution cookie, and the
same-origin customer APIs (plan § 2.3). The ratified answer is a **sandboxed `<iframe>`
served from the cross-origin S3 asset CDN**, embedded with:

```
sandbox="allow-scripts"     ← and, decisively, NOT allow-same-origin
```

`allow-scripts` without `allow-same-origin` runs the framed document at a **unique opaque
(null) origin**: scripts execute, but with no cookies, no storage, and a *cross-site*
posture toward the renderer boundary, so `SameSite=Lax` cookies are withheld and CORS keeps
the renderer APIs' responses opaque to it. The moment `allow-same-origin` is added (variant
a2) the frame runs at the real, shared asset origin and the browser-enforced barrier
collapses.

### The contract constant (built here)

The token set is encoded once, framework-agnostic, in shared:

| Symbol | File | Purpose |
|--------|------|---------|
| `STATIC_PAGE_SANDBOX_TOKENS` | `packages/shared/src/sandbox.ts` | The exact granted token set `["allow-scripts"]`. |
| `STATIC_PAGE_SANDBOX_ATTR` | `packages/shared/src/sandbox.ts` | The `sandbox=` attribute value (`"allow-scripts"`). |
| `STATIC_PAGE_SANDBOX_FORBIDDEN_TOKENS` | `packages/shared/src/sandbox.ts` | `["allow-same-origin"]` — the collapse token the test forbids. |

**No renderer wiring exists yet** — `static-4` consumes `STATIC_PAGE_SANDBOX_ATTR` when it
builds the shell iframe. The regression fence lives in
`packages/shared/test/sandbox.test.ts`: it asserts the set is exactly `allow-scripts` and
that `allow-same-origin` never appears, so a future edit that silently re-opens the origin
fails CI instead of shipping a dead barrier. HTML spec cited inline in `sandbox.ts`.

Each withheld token (`allow-forms`, `allow-top-navigation*`, `allow-same-origin`, …) re-opens
a specific vector named in `sandbox.ts` and plan § 3(a); keeping the set minimal is a
standing obligation, not a default.

---

## 2. Anonymous-write-endpoint hardening (D-STATIC-1 rider — the precondition)

The opaque frame can still fire credential-free `fetch()`. Plan § 3(a) residual (i): a
renderer write endpoint that is neither session-gated nor SameSite-protected is reachable
credential-free cross-origin. The backend's own Origin check
(`backend/src/lib/tenant-verify.ts:86` `verifyTenantFromOrigin`) is **skipped for the
RENDERER role** (`tenant-verify.ts:92`) — so the browser's `Origin` is only checkable at the
renderer proxy hop, never at the backend. That hop is where the guard had to go.

### The guard

`renderer/src/lib/origin-guard.ts` → `isFirstPartyWrite(req)`. Same-origin form POSTs pass
(the browser sends `Origin: <site-origin>` + `Sec-Fetch-Site: same-origin` on every POST);
cross-site / opaque-origin (`Origin: null`, `Sec-Fetch-Site: cross-site`) fail. It compares the
**FULL origin — scheme + host + port**, not the host label alone (STATIC-EP reviewer's rider),
reconstructed from the request: `x-forwarded-host` ⇒ the public origin is `https://…` (CloudFront
terminates TLS + forces http→https, and `x-forwarded-proto` is *not* on the ORP allowlist so its
presence is the scheme signal); the bare `host` (local `next start` / harness, never the
production boundary) accepts either scheme. A scheme downgrade or a foreign port on the same host
is therefore rejected. Non-browser callers (no `Origin`, no `Sec-Fetch-Site`) are allowed — they
can forge `Origin` anyway, so blocking them buys no isolation against the browser-sandbox threat.
Full rationale in the module header.

**Where the barrier actually runs (D-STATIC-EP-ORIGIN, human-ratified 2026-08-09).** In production
this renderer guard is **inert belt-and-suspenders**, and the real barrier is at the edge. Reason:
the guard can only act on `Origin`, but behind CloudFront a header reaches the renderer Lambda only
if it is on the `RendererOriginPolicy` transport allowlist — and that list is at CloudFront's hard
**10-header cap**. CYCLE-1 tried to forward `Origin` as an eleventh header; it **failed deploy on
that cap** (staging caught it, rolled back; prod untouched). So `Origin` is never forwarded, the
renderer guard sees `null` on every production request, and it falls through to allow — inert, but
inert-SAFE (with `Origin`/`Sec-Fetch-Site` stripped it can only ever allow, so it never rejects a
real first-party caller).

The barrier therefore lives in the **viewer-request CloudFront Function**
(`STATIC_EP_EDGE_ORIGIN_GUARD` in `infra/lib/renderer-hosting.ts`), which sees `Origin` regardless
of the ORP cap (the cap governs only what reaches the *Lambda*, not what the edge function sees).
For a state-changing POST to `/api/consent|contact|leads` it 403s unless `Origin` exactly equals the
request's own public origin (`https://<host>` — CloudFront force-redirects http→https, so https is
the only public scheme and exact equality is a scheme+host+port match). A missing or `Origin: null`
(sandboxed opaque frame) value never matches → 403. GET and every non-hardened path pass untouched.
The renderer guard is retained as defence-in-depth and stays fully active where there is **no**
CloudFront (local `next start`, direct Lambda-URL invocation, the serving-contract harness).

Tests, and exactly what each layer covers:

- `infra/test/amodx-stack.test.ts` assertion `(i)` — **the production barrier.** Drives the shared
  guard source `STATIC_EP_EDGE_ORIGIN_GUARD` (the exact ES5 spliced into the CloudFront Function)
  over the full decision table — same-origin POST passes, null/cross-site/no-Origin/scheme-downgrade
  POST → 403, GET and non-hardened paths untouched — **and** asserts the deployed function body
  contains that same source. Together: the deployed edge function runs the verified logic.
- `infra/test/amodx-stack.test.ts` assertion `(h)` — pins that `Origin` is **NOT** on the
  `RendererOriginPolicy` allowlist (ten headers), i.e. the renderer guard is inert in production by
  construction, and the CYCLE-1 header-forward stays reverted. Scope note: `(h)` asserts the
  **synthesized** template's ORP is ten headers; it is *not* an observation that the synthesized ORP
  equals the currently-**deployed** ORP. That deployed-state equality is a separate gate — see the
  `cdk diff` pre-deploy gate below.
- `renderer/test/unit/origin-guard.test.ts` — the belt-and-suspenders renderer guard as an imported
  function: both directions, edges, the full-origin scheme/port strictness cases, **and** the
  review-1 case that on the forwarded path a `Host`-forged `Origin` (the Lambda/function-URL origin
  host) is rejected. Active in the no-CloudFront environments listed above.
- `renderer/test/unit/anon-write-endpoints.test.ts` — per-endpoint renderer wiring: cross-site → 403
  before any backend hop; same-origin → proxied.
- `renderer/test/serving-contract/contract.test.mjs` row `(g4)` — per hardened endpoint, a
  `null`/cross-origin POST rejected (403) and a same-origin POST admitted, exercised inside the
  **built + served** renderer (`next start`). This exercises the **renderer** belt-and-suspenders
  guard (the harness has no CloudFront in front, so `Origin` reaches the renderer here); it does
  **not** exercise the edge function.
- **Operator staging probe (`NOT RUN` gate).** The edge guard's true end-to-end proof is a
  null-Origin POST to `/api/contact` through CloudFront returning 403 on staging — it cannot run in
  any hermetic suite (no AWS) and is left as an operator pre-deploy check.
- **`cdk diff` ORP-unchanged pre-deploy gate (`NOT RUN`).** The rider requires
  `cd infra && npx cdk diff -c stage=staging` to confirm `RendererOriginPolicy` is **unchanged from
  the currently-deployed state** (i.e. the CYCLE-1 eleventh-header add is fully reverted and this
  slice adds no ORP delta). This reads the deployed CloudFormation stack and therefore needs AWS
  credentials, which the hermetic build/test environment does not have (and the STATIC-EP packet
  forbids staging tests at build time). It is **NOT RUN** here and remains an **unmet pre-deploy
  gate** the operator must clear before deploy — not a satisfied condition. Assertion `(h)` bounds
  the *synthesized* ORP to ten headers, which makes a non-empty ORP diff surprising, but that is
  INFERRED equivalence, not the deployed-state OBSERVATION this gate requires.

### Per-endpoint disposition (full set — `find renderer/src/app/api -type f`, OBSERVED 2026-08-08)

The audit named consent/contact/ref/leads; the grep confirmed those four **plus** six more.
`disposition` is per credential-free **write** reachability.

| Endpoint | Method(s) | Disposition | Evidence (file:line) | Reason |
|----------|-----------|-------------|----------------------|--------|
| `/api/consent` | POST | **HARDENED** | edge guard src `infra/lib/renderer-hosting.ts:50-65`, injected into the viewer-request Function at `infra/lib/renderer-hosting.ts:368`; renderer belt-and-suspenders call `renderer/src/app/api/consent/route.ts:16` | Anonymous credential-free write (CookieConsent.tsx). Cross-site not intended → 403 at the edge CloudFront Function; renderer `isFirstPartyWrite` is belt-and-suspenders (inert in prod). |
| `/api/contact` | POST | **HARDENED** | edge guard src `infra/lib/renderer-hosting.ts:50-65`, injected at `infra/lib/renderer-hosting.ts:368`; renderer belt-and-suspenders call `renderer/src/app/api/contact/route.ts:19` | Anonymous write (ContactRender.tsx). Backend skips Origin for RENDERER; edge function is the barrier (Lambda never sees `Origin` — ORP cap). |
| `/api/leads` | POST | **HARDENED** | edge guard src `infra/lib/renderer-hosting.ts:50-65`, injected at `infra/lib/renderer-hosting.ts:368`; renderer belt-and-suspenders call `renderer/src/app/api/leads/route.ts:18` | Anonymous write (LeadMagnetRender.tsx). Cross-site not intended → edge 403; renderer guard belt-and-suspenders. |
| `/api/ref` | POST | **INTENTIONALLY-OPEN** | `ref/route.ts:69`; rationale `ref/route.ts:56-59` | Standing ratified decision: attribution *tag*, not a credential; a top-level `?ref=` navigation does the same, more easily. Recorded in caching-architecture Known Gaps 14. Left open; flagged below as a residual-(i) item for the spike. |
| `/api/comments` | GET (read), POST | **N/A** | POST session-gated `comments/route.ts:72-74` (getToken → 401) | Not a credential-free write. Cross-site fetch → Lax cookie withheld → 401 (plan § 3(a) fact 2). Already contained; no change. |
| `/api/posts` | GET | **N/A** | `posts/route.ts:15` | Read-only. No write to harden. |
| `/api/profile` | GET, POST | **N/A** | session-gated `profile/route.ts:65,141` (getServerSession → 401) | Both methods require a NextAuth session; SameSite+session-gate contains the frame. |
| `/api/account/orders` | GET | **N/A** | session-gated `account/orders/route.ts:49-52` | Session-gated read. |
| `/api/revalidate` | POST | **N/A** | token-gated `revalidate/route.ts:11-13` | Requires the `x-revalidation-token` secret; not anonymous. |
| `/api/auth/[...nextauth]` | GET, POST | **INTENTIONALLY-OPEN** | `auth/[...nextauth]/route.ts:61` | NextAuth OAuth surface. MUST accept cross-site provider callbacks by design; an Origin gate would break sign-in. |

---

## 3. Residuals / notes

- **`/api/ref` (residual (i)).** Left intentionally-open per its ratified decision. The
  opaque frame can at most set the *visitor's own* attribution cookie (and only if the
  browser permits the cross-site Set-Cookie), which the plan judges harmless. The
  ratification-authorized spike (plan § 4) should confirm this is acceptable under the real
  export; if attribution-poisoning-from-frame is deemed material, hardening `/api/ref` with
  the same guard is a one-line change that does **not** break the same-origin
  `ReferralCapture` beacon.
- **In-frame phishing (residual (ii))** is a content-trust concern owned by `D-STATIC-5`,
  not a session-boundary breach — out of scope here.
- **One infra change — the edge origin-guard (D-STATIC-EP-ORIGIN, human-ratified 2026-08-09).**
  The slice's "no infra unless an endpoint fix needs config → STOP" clause fired correctly: the
  renderer guard was inert because CloudFront strips `Origin`. CYCLE-1 tried to fix that by adding
  `Origin` to the `RendererOriginPolicy` allowlist, but that **failed deploy on CloudFront's hard
  10-header cap** (staging caught it, rolled back; prod untouched). Final resolution: the origin
  barrier moved into the **existing viewer-request CloudFront Function**
  (`STATIC_EP_EDGE_ORIGIN_GUARD`), which 403s a cross-site / null-origin POST to
  `/api/consent|contact|leads` at the edge and sees `Origin` regardless of the ORP cap. The ORP is
  **reverted to its deployed ten headers** (`Origin` is not on it). This is the sole infra edit; the
  asset-origin CORS pair (variant a1) remains a `static-2`+spike concern, not part of STATIC-EP.
