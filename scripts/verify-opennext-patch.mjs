#!/usr/bin/env node
//
// cache-8 mitigation (c) — GUARD LAYER 2 of 2 (built-bundle assertion).
// Ratified by REVISE 3 (`cache8-c2-guard-mechanism`, operator, 2026-08-16).
//
// WHAT PROBLEM THIS GUARDS. Mitigation (c) ships as a pinned-dependency patch
// (`patches/open-next+3.1.3.patch`, applied by root `postinstall: patch-package`) that rewrites
// open-next's `fixISRHeaders()` edge stale-while-revalidate window from the 30-day default
// (`2592000`) to `300`. If that patch is silently lost — a fresh clone whose `postinstall` was
// skipped, an `npm ci` in an environment that ignores lifecycle scripts, or an open-next upgrade
// past 3.1.3 that no longer matches the patch — the deploy would ship the 30-day window again and
// re-pin stale copies at the CloudFront edge for a month. The intent of REVISE 2's (c2) criterion
// is: fail LOUDLY, before deploy, if what SHIPS loses the patch.
//
// TWO-LAYER GUARD (REVISE 3). This intent is satisfied by two artefacts, not one:
//   LAYER 1 (fast, every unit run): serving-contract row (c2) in
//     `renderer/test/serving-contract/contract.test.mjs` reads the INSTALLED open-next source
//     (`node_modules/open-next/dist/core/routing/util.js`) and asserts the patched constant is
//     present / the 2592000 window gone. Catches an unapplied patch in ~ms with no build.
//   LAYER 2 (this script): asserts the patched constant survives THROUGH `open-next build` into
//     the actual SERVER Lambda bundle (`.open-next/server-functions/default/`) — the exact
//     artefact the CDK deploy uploads (`infra/lib/renderer-hosting.ts:211`). This is the property
//     LAYER 1 cannot prove: that bundling did not drop/rewrite the string. A full Lambda-invoke
//     harness (reviewer option B) is deliberately NOT built — grep of the shipped bundle proves
//     the same emitted-header property with far less machinery (REVISE 3).
//
// WHY A SCRIPT, NOT A SERVING-SUITE ROW. `open-next build` takes ~60 s (it runs `next build` then
// bundles every Lambda); the serving suite is a ~9 s hermetic `next start` harness and must stay
// that way. So this is a stand-alone pre-deploy gate — see the placement decision below.
//
// PLACEMENT (recorded per REVISE 3):
//   (a) THIS SCRIPT — run manually / in the deploy runbook: `node scripts/verify-opennext-patch.mjs`.
//   (b) DEPLOY RUNBOOK — `docs/runbooks/deploy-track-cache.md` § Preconditions lists it as a
//       MANDATORY pre-deploy gate (must pass green before `cdk deploy` of the renderer stack).
//   (c) CI — NOT added. Rationale: `open-next build` is a multi-minute step and CI does not already
//       run it, so wiring it into CI would silently add minutes to every pipeline. LAYER 1 (the
//       serving row) already runs in CI-affordable time and catches the common "patch unapplied"
//       case; LAYER 2 runs at the deploy boundary where an `open-next build` happens anyway.
//
// A THIRD 30-DAY SITE EXISTS BY DESIGN (documented, not a miss). open-next's `util.js` has a
// SECOND stale-while-revalidate=2592000 site, `fixSWRCacheHeader()` (util.js:254-264), which the
// patch deliberately does NOT touch. It only fires when Next emits a BARE `stale-while-revalidate`
// (no `=value`); all renderer ISR pages are `revalidate=false`, so Next emits no bare SWR directive
// (serving row (c1)) and this site is a no-op for THIS deployment. Its residual therefore survives
// in the bundle as the exact replace-target string `,"stale-while-revalidate=2592000"` (comma-QUOTE,
// distinct from fixISRHeaders' comma-SPACE form). This script accounts for it explicitly so the
// deploy gate does not false-fail, and reports it so a future move to time-based ISR re-evaluates
// it (tracked under `opennext-1` / docs/TECH-DEBT.md § cache-8).
//
// EXIT CODES: 0 = patch present in the built bundle; 1 = patch missing / unexpected 30-day window.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const TAG = "[verify-opennext-patch]";
const log = (...a) => console.log(TAG, ...a);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rendererPath = join(repoRoot, "renderer");
const openNextPath = join(rendererPath, ".open-next");
// The exact asset CDK uploads as the ISR-serving Lambda (infra/lib/renderer-hosting.ts:211).
// fixISRHeaders() runs in this server request path; the revalidation-function only issues HEAD
// requests and carries none of these strings (verified 2026-08-16).
const serverBundleDir = join(openNextPath, "server-functions", "default");

// ── The strings that distinguish a patched from an unpatched fixISRHeaders in the bundle. ──
// PATCHED_STALE is the plain string literal from the STALE-serving branch (util.js:396) — the exact
// header behind the prod symptom `s-maxage=2, ... age=194`. esbuild preserves string-literal
// contents verbatim, so it is the strongest, least-fragile anchor.
const PATCHED_STALE = "s-maxage=2, stale-while-revalidate=300";
// Unpatched forms that must be ABSENT. Both use the comma-SPACE form that only fixISRHeaders
// produces; neither matches fixSWRCacheHeader's comma-QUOTE replace-target below.
const UNPATCHED_STALE = "s-maxage=2, stale-while-revalidate=2592000"; // STALE branch, unpatched
const UNPATCHED_HIT = ", stale-while-revalidate=2592000"; //             HIT-recompute branch, unpatched
// The one 30-day residual that is EXPECTED (fixSWRCacheHeader, no-op for this deployment).
const FIXSWR_RESIDUAL = '"stale-while-revalidate=2592000"';

// 1. Ensure the built bundle exists — run the EXACT deploy build pipeline if it does not.
if (!existsSync(serverBundleDir)) {
    log(`server bundle absent at ${serverBundleDir}`);
    log("running the deploy build pipeline: (renderer) npm run build:open …");
    // Clean first — mirrors infra/lib/renderer-hosting.ts's clean loop. macOS Spotlight can
    // recreate .DS_Store mid-delete and make open-next's own rimraf throw ENOTEMPTY.
    try { execSync(`find "${openNextPath}" -name .DS_Store -delete`, { stdio: "ignore" }); } catch { /* best effort */ }
    try { execSync(`rm -rf "${openNextPath}"`, { stdio: "inherit" }); } catch { /* best effort */ }
    execSync("npm run build:open", { cwd: rendererPath, stdio: "inherit", env: process.env });
}
if (!existsSync(serverBundleDir)) {
    log(`FAIL: server bundle still not found at ${serverBundleDir} after build`);
    process.exit(1);
}

// 2. Concatenate every JS/MJS file in the server bundle (esbuild emits index.mjs; be tolerant).
function collectSource(dir) {
    let acc = "";
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) acc += collectSource(p);
        else if (/\.(mjs|cjs|js)$/.test(name)) acc += readFileSync(p, "utf8");
    }
    return acc;
}
const src = collectSource(serverBundleDir);
const count = (s) => src.split(s).length - 1;

// 3. Assertions on the SHIPPED bundle.
const errors = [];
if (!src.includes(PATCHED_STALE)) {
    errors.push(`patched STALE window "${PATCHED_STALE}" is MISSING from the server bundle — the cache-8 patch did not survive open-next build (postinstall skipped, or open-next upgraded past 3.1.3).`);
}
if (src.includes(UNPATCHED_STALE)) {
    errors.push(`unpatched 30-day STALE window "${UNPATCHED_STALE}" is PRESENT — the cache-8 patch is not in effect.`);
}
if (src.includes(UNPATCHED_HIT)) {
    errors.push(`unpatched 30-day HIT-recompute window "${UNPATCHED_HIT}" is PRESENT — the cache-8 patch is not in effect.`);
}

// 4. Account for every 2592000 in the bundle. The ONLY legitimate one is fixSWRCacheHeader's
//    replace-target; anything else is an unpatched fixISRHeaders string (already flagged above)
//    or an unexpected new 30-day site that must be investigated before deploy.
const total2592000 = count("2592000");
const residual = count(FIXSWR_RESIDUAL);
log(`fixSWRCacheHeader residual (expected, no-op while renderer ISR pages are revalidate=false): ${residual} occurrence(s) of ${FIXSWR_RESIDUAL}`);
const unaccounted = total2592000 - residual;
if (unaccounted > 0) {
    errors.push(`${unaccounted} unaccounted "2592000" occurrence(s) in the server bundle beyond the fixSWRCacheHeader residual — inspect the bundle before deploying.`);
}

if (errors.length) {
    for (const e of errors) log("FAIL:", e);
    log("cache-8 mitigation (c) built-bundle guard: FAILED");
    process.exit(1);
}

log(`PASS: server bundle carries the patched edge window "${PATCHED_STALE}"; no unpatched fixISRHeaders 30-day window present; the sole 2592000 residual is the expected fixSWRCacheHeader no-op.`);
log("cache-8 mitigation (c) built-bundle guard: OK");
