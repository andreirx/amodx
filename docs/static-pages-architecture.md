# Static-HTML Pages — Isolation Architecture (Track STATIC)

Records the **isolation model** and the **anonymous-write-endpoint hardening** delivered by
slice `static-1` (docs/slices/static-1-isolation-endpoints.md). Design rationale and the
ratified decisions live in `docs/plan-static-html-pages.md` (D-STATIC-1..5, RATIFIED
2026-08-07). This note is the *as-built* record; the plan is the *why*.

Maturity: **PROTOTYPE**. `static-1` builds only the isolation barrier's contract + its
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
(the browser sends `Origin: <site-host>` + `Sec-Fetch-Site: same-origin` on every POST);
cross-site / opaque-origin (`Origin: null`, `Sec-Fetch-Site: cross-site`) fail. Matches the
public host against **both** `x-forwarded-host` (behind CloudFront) and `host` (local
`next start`). Non-browser callers (no `Origin`, no `Sec-Fetch-Site`) are allowed — they can
forge `Origin` anyway, so blocking them buys no isolation against the browser-sandbox threat.
Full rationale in the module header. Tests: `renderer/test/unit/origin-guard.test.ts`
(both directions + edges) and `renderer/test/unit/anon-write-endpoints.test.ts` (per-endpoint
wiring: cross-site → 403 before any backend hop; same-origin → proxied).

### Per-endpoint disposition (full set — `find renderer/src/app/api -type f`, OBSERVED 2026-08-08)

The audit named consent/contact/ref/leads; the grep confirmed those four **plus** six more.
`disposition` is per credential-free **write** reachability.

| Endpoint | Method(s) | Disposition | Evidence (file:line) | Reason |
|----------|-----------|-------------|----------------------|--------|
| `/api/consent` | POST | **HARDENED** | `consent/route.ts:16` | Anonymous credential-free write (CookieConsent.tsx). Cross-site not intended → `isFirstPartyWrite` gate. |
| `/api/contact` | POST | **HARDENED** | `contact/route.ts:19` | Anonymous write (ContactRender.tsx). Backend skips Origin for RENDERER → guarded here. |
| `/api/leads` | POST | **HARDENED** | `leads/route.ts:18` | Anonymous write (LeadMagnetRender.tsx). Cross-site not intended → gate. |
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
- **No infra changed.** No endpoint fix needed a config change; the guard is pure renderer
  code. The asset-origin CORS pair (variant a1) is a `static-2`+spike concern, not `static-1`.
