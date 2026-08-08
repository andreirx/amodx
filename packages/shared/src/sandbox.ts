/**
 * STATIC-1 — the ratified iframe sandbox contract for embedding untrusted,
 * tenant-supplied static HTML pages.
 *
 * Source of truth: docs/plan-static-html-pages.md, decision D-STATIC-1 (RATIFIED
 * 2026-08-07) — "sandboxed iframe from the asset origin", opaque-origin family
 * (variants a-opaque / a1). This module encodes ONLY the isolation contract; no
 * renderer wiring lives here. static-4 consumes STATIC_PAGE_SANDBOX_ATTR when it
 * builds the shell `<iframe>`.
 *
 * THE BARRIER, IN ONE SENTENCE
 * ----------------------------
 * A frame given `allow-scripts` but NOT `allow-same-origin` runs at a unique
 * *opaque (null) origin*. Its scripts execute, but with the ambient authority of
 * NO origin: no cookies, no localStorage/sessionStorage, and — decisively — a
 * cross-site posture toward the renderer session/attribution boundary
 * (docs/plan-static-html-pages.md § 2.3), so `SameSite=Lax` cookies are withheld
 * and CORS keeps the renderer APIs' responses opaque to it. Keeping
 * `allow-same-origin` OUT is precisely what makes the origin opaque; the moment it
 * is added the frame runs at the *real* asset origin (variant a2) and the
 * browser-enforced barrier collapses. That is the exact edit
 * STATIC_PAGE_SANDBOX_FORBIDDEN_TOKENS + its test exist to prevent.
 *
 * TOKEN SEMANTICS — HTML Standard, the `sandbox` attribute keyword set:
 *   https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox
 *
 *   GRANTED
 *     allow-scripts
 *       Lets the framed document run script (and auto-triggered features). It does
 *       NOT clear the "sandboxed origin" flag, so scripts run at the opaque origin.
 *       Required, because a Lovable/Vite export is a client-rendered bundle that is
 *       an empty shell without its JS (plan § 1, § 2.1).
 *
 *   DELIBERATELY WITHHELD — each re-opens a specific, named vector from the plan;
 *   none may be added without ratifying the corresponding cost:
 *     allow-same-origin
 *       FORBIDDEN (see below). Would run the frame at the real, shared asset origin
 *       → shared cross-tenant storage + collapse of the opaque-origin barrier
 *       (plan § 3(a2), Critical Rule 3 tenant isolation).
 *     allow-forms
 *       In-frame form submission. Cookie-less (child context, not top-level) but an
 *       unauthenticated external/same-site write — residual (i), plan § 3(a) fact 3.
 *     allow-top-navigation / allow-top-navigation-by-user-activation
 *       Navigating the parent/top window. Re-opens the top-level *safe-method*
 *       (GET/HEAD) Lax-cookie CSRF vector (plan § 3(a) fact 3).
 *     allow-popups (+ allow-popups-to-escape-sandbox), allow-modals,
 *     allow-pointer-lock, allow-downloads, allow-storage-access-by-user-activation,
 *     allow-presentation, allow-orientation-lock, …
 *       Not needed by the static-page use case; withheld by default.
 *
 * The set is intentionally the MINIMUM that renders the export. Facts 2–3 of the
 * plan's containment argument hold only while `allow-forms` and
 * `allow-top-navigation*` stay withheld; keeping this list minimal is a standing
 * obligation, not a convenience default.
 */

/**
 * The exact, ordered sandbox token set. Adding a token is a boundary change
 * (re-read D-STATIC-1); it is not a config knob.
 */
export const STATIC_PAGE_SANDBOX_TOKENS = ["allow-scripts"] as const;

/**
 * The value for the iframe `sandbox` attribute, e.g.
 * `<iframe sandbox={STATIC_PAGE_SANDBOX_ATTR} …>`.
 */
export const STATIC_PAGE_SANDBOX_ATTR: string = STATIC_PAGE_SANDBOX_TOKENS.join(" ");

/**
 * Tokens that MUST NEVER appear in STATIC_PAGE_SANDBOX_TOKENS. `allow-same-origin`
 * is the collapse token: combined with `allow-scripts` it lifts the opaque origin
 * and hands the frame the real asset origin's authority. The unit test asserts none
 * of these is present, so a future edit that silently adds one fails CI rather than
 * shipping a dead barrier.
 */
export const STATIC_PAGE_SANDBOX_FORBIDDEN_TOKENS = ["allow-same-origin"] as const;
