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
  // 2026-09-16 reset: the five next-16.2.12-pinned entries (postcss ×4, sharp libvips)
  // RETIRED — the recorded revisit trigger fired (next shipped an in-range fix) and the
  // next 16.3.5 bump cleared them all. If any reappears, that is a regression to an old
  // next and MUST go red.
  //
  // @tiptap/core ReDoS (>=3.7.0 <3.30.5): a VERSION-RANGE false positive — installed
  // @tiptap/core is 2.27.1, below the affected range; npm audit flags the package because
  // its union range covers a separate sub-gate moderate. Revisit: any tiptap major
  // migration (2.x -> 3.x), which is its own decision (editor behavior surface).
  ["GHSA-j95f-988m-3j2f", "tiptap-ReDoS: installed 2.27.1, affected range starts 3.7.0"],
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
// A parseable ERROR reply (e.g. registry unreachable: {"error":{...}}) is not an audit result.
// Without this check it read as "no vulnerabilities" and the gate passed without an audit.
const v = report.vulnerabilities;
// Every `via` entry is a chain link (string) or an advisory with a severity (object).
const SEVERITIES = new Set(["info", "low", "moderate", "high", "critical"]);
const viaOk = (x) => typeof x === "string" || (x !== null && typeof x === "object" && SEVERITIES.has(x.severity));
const wellFormed = v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((e) => Array.isArray(e?.via) && e.via.every(viaOk));
if (report.error || !wellFormed) {
  console.error("audit-gate: `npm audit --json` returned no audit result");
  console.error(JSON.stringify(report.error ?? report).slice(0, 2000));
  process.exit(2);
}

const failing = [];
const suppressed = [];
for (const [pkg, vuln] of Object.entries(report.vulnerabilities)) {
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
