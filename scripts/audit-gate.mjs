// Security-audit CI gate. MATURE (contract: exit 0 iff no unaccepted high/critical
// advisories in production deps).
//
// Replaces bare `npm audit --audit-level=high --omit=dev` in .github/workflows/
// security-audit.yml for the root and renderer jobs. A bare audit cannot express
// "these specific advisories are accepted", so the workflow was permanently red on
// findings we have deliberately accepted (see ACCEPTED below), which buries any NEW
// finding. This script fails ONLY on unaccepted high/critical advisories, and prints
// every suppressed one loudly — no silent caps.
//
// Accepted list: docs/TECH-DEBT.md § Dependency Audit Remediation (2026-08-30 entry).
// Every entry must carry a reason and a revisit trigger. Keep this list SHORT and
// exact — GHSA ids, never package names.

import { spawnSync } from "node:child_process";

const ACCEPTED = new Map([
  // postcss <=8.5.22, nested copy pinned inside next 16.2.12 (build-time CSS of our
  // own sources; the runtime copy is hoisted and already fixed). Revisit: opennext-1
  // unpark / next upgrade, or next ships an in-range fix.
  ["GHSA-qx2v-qp2m-jg93", "postcss-in-next: build-time only, pinned by next 16.2.12"],
  ["GHSA-6g55-p6wh-862q", "postcss-in-next: build-time only, pinned by next 16.2.12"],
  ["GHSA-fxqj-rqcc-2cmp", "postcss-in-next: build-time only, pinned by next 16.2.12"],
  ["GHSA-r28c-9q8g-f849", "postcss-in-next: build-time only, pinned by next 16.2.12"],
  // sharp <0.35.0 (libvips CVEs). next pins ^0.34.5; the DEPLOYED image optimizer
  // bundles open-next's own sharp 0.32.6. Risk accepted by human 2026-08-30: image
  // inputs are tenant-admin uploads + operator-run review imports, not anonymous.
  // Revisit: opennext-1 unpark, or image sources become externally supplied.
  ["GHSA-f88m-g3jw-g9cj", "sharp-via-next: accepted 2026-08-30, inputs are semi-trusted"],
]);

const res = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
// npm audit exits 1 when vulnerabilities exist — the JSON on stdout is the result
// either way. Only a missing/unparseable body is an infrastructure failure.
let report;
try {
  report = JSON.parse(res.stdout);
} catch {
  console.error("audit-gate: could not parse `npm audit --json` output");
  console.error(res.stderr?.slice(0, 2000) ?? "");
  process.exit(2);
}

const failing = [];
const suppressed = [];
for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object") continue; // string vias are chain links, not advisories
    if (via.severity !== "high" && via.severity !== "critical") continue;
    const ghsa = via.url?.split("/").pop() ?? "unknown";
    const line = `${pkg}: ${ghsa} [${via.severity}] ${via.title}`;
    if (ACCEPTED.has(ghsa)) suppressed.push(`${line}\n    accepted: ${ACCEPTED.get(ghsa)}`);
    else failing.push(line);
  }
}

if (suppressed.length) {
  console.log(`audit-gate: ${suppressed.length} ACCEPTED advisory hit(s) suppressed (docs/TECH-DEBT.md):`);
  for (const s of suppressed) console.log("  " + s);
}
if (failing.length) {
  console.error(`\naudit-gate: FAIL — ${failing.length} unaccepted high/critical advisory hit(s):`);
  for (const f of failing) console.error("  " + f);
  process.exit(1);
}
console.log(`audit-gate: PASS — no unaccepted high/critical advisories in production deps.`);
