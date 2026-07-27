# SEC-1: Assessed dependency remediation (weekly audit failure 2026-07-27)

- **Status:** PLANNED — executes the moment TEST-1 releases the working tree
  (lockfile conflict); MUST land before the Track CACHE staging deploy
- **Track:** Maintenance (assessed, per operator directive 2026-07-27: risks, blast
  radius, and ACTUAL impact per package — not a blind `npm audit fix`)
- **Executor:** operator (dependency bumps + verification; no relay needed)
- **Constraint:** semver-compatible fixes only (`npm audit fix`, NO `--force`); no CDK.

## Per-package assessment

| Pkg (installed) | Vulnerability | ACTUAL impact here | Fix blast radius | Verification |
|---|---|---|---|---|
| `next` 16.2.9 | **Middleware/proxy bypass (App Router + Turbopack)**; Server-Actions DoS | **HIGHEST.** We build with Turbopack and ALL serving-security now lives in middleware: origin-verify, unknown-host 404 gate, session/query→dynamic-twin discrimination. A middleware bypass defeats cache-1's walls. | Renderer Lambda only; patch-level | `next build` green; staging runbook probes 1–6 re-validate the measured serving contract ON the patched Next before prod |
| `next-auth` 4.24.14 (CRITICAL) | `getToken()` uncaught throw on malformed Bearer header; email-normalizer homoglyph bypass | Real: `getToken()` runs in 4 public renderer API routes (`comments`, `profile`, `account/orders`, `[...nextauth]`) — one malformed header = unhandled exception per request. Homoglyph issue: low today (emails come from Google OAuth), HIGH for Track C credentials login → **also logged as PD-001 amendment input (normalizeEmail needs NFKC decision before fnd-1)** | Renderer only; patch | Build; exercise a comments GET with junk `Authorization: Bearer \xff` locally → 401/graceful, not 500 |
| `sharp` 0.34.5 | 4 libvips CVEs (image parsing) | Real: image-optimization Lambda parses TENANT-UPLOADED images — genuine hostile-input surface | Image Lambda; patch | Build; staging: request a `_next/image` URL post-deploy (add to runbook step 2) |
| `react-router-dom` 7.x (admin) | Open redirect + XSS (RSCErrorHandler) | Moderate: admin SPA — XSS there = tenant-admin session theft; users are semi-trusted but tenants share the panel | Admin bundle; patch | Admin build; operator smoke (login, navigate, save a setting) |
| `postcss` 8.5.14 | sourceMappingURL file disclosure; unescaped `</style>` | LOW actual: build-time tool; we do not process attacker-controlled CSS through it | Build chain | Builds green |
| `axios` 1.16.0 | formDataToJSON DoS; prototype pollution | LOW-mod: only consumer is `tools/mcp-server` (operator tooling, not deployed to tenant path) | mcp-server | `tools/mcp-server` build |
| `fast-uri`, `linkify-it`, `uuid` | host confusion / DoS / bounds | Transitive, low | lockfile | Builds green |

## Procedure

1. Preconditions: TEST-1 merged (repaired lockfile is the base), tree clean.
2. `npm audit fix` at root (workspaces). Inspect the lockfile diff: expect ONLY the
   flagged families + their transitive updates; anything else → investigate before
   committing.
3. Full root build → `backend npm run test:unit` → per-surface verification column
   above (local parts).
4. `npm audit --audit-level=high --omit=dev` green in root, backend, renderer (the
   workflow's exact flags).
5. Commit (lockfile + any manifest deltas) with this doc referenced; the security-audit
   workflow's next run is the operator's NOT RUN gate.
6. Staging-dependent verifications ride the Track CACHE runbook (which now waits for
   this commit): probes 1–6 + new `_next/image` probe.

## Rollback

Single revert of the SEC-1 commit restores the previous pinned lockfile; redeploy.
