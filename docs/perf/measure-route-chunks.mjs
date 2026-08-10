// PERF-1 measurement tool — per-route EAGER client-JS + the route's on-demand
// dynamic-import graph + heavy-library location, for the built site route
// (Next 16 / turbopack production output).
//
// Reproduce:
//   cd renderer && npm run build
//   node ../docs/perf/measure-route-chunks.mjs            # measures renderer/.next
//   node ../docs/perf/measure-route-chunks.mjs <path/.next>
//
// THREE INDEPENDENT, DETERMINISTIC METHODS — each measures exactly what it can prove from
// the emitted artifact, and nothing more. No source maps (turbopack strips them + the
// node_modules paths in prod), no heuristics.
//
// Revision history of the METHOD used for on-demand attribution (why it is what it is):
//   r0-r2: read an eager/async split from the manifest `clientModule.async` flag — WRONG:
//          for this route that flag is ALWAYS false (turbopack does not mark dynamically-
//          imported plugin renders as async client boundaries in the RSC manifest).
//   r3:    labelled a chunk "on-demand" merely because it was ABSENT from the eager set —
//          WRONG: that also labels chunks belonging to OTHER routes as on-demand for THIS
//          route; it proves nothing about reachability from this route's dynamic imports.
//   r4 (this file): parse the route's runtime chunk, which contains turbopack's own
//          deterministic dynamic-import table (parent module id -> the chunk list it lazily
//          loads). A chunk is "on-demand for this route" IFF it appears in that table, whose
//          containing chunk is itself in this route's EAGER set (so the table is reachable).
//          This is the emitted-artifact ground truth, not an absence heuristic.
//
// METHOD 1 — EAGER SET (from the RSC client-reference-manifest; deterministic):
//   The route's page_client-reference-manifest.js assigns
//   globalThis.__RSC_MANIFEST["/[siteId]/[[...slug]]/page"]. The EAGER client chunk set is
//   the union of `chunks[]` over every clientModule (all are async:false here → all eager).
//   These are the chunks the browser downloads in the route's initial client boundary —
//   i.e. the always-shipped ("unused-JS") weight this slice reduces. Bytes = real file size
//   in <.next>/static/chunks/. EAGER_TOTAL is the headline before/after number.
//
// METHOD 2 — ROUTE-RUNTIME DYNAMIC-IMPORT TABLE (parse the runtime chunk; deterministic):
//   Turbopack emits, into one of the route's EAGER chunks (the route "runtime" chunk), a
//   registration array of the form
//       (globalThis.TURBOPACK||=[]).push([script,
//         <parentId>, s=>{s.v(t=>Promise.all(["static/chunks/A.js",...].map(t=>s.l(t)))
//                           .then(()=>t(<targetId>)))},
//         <parentId>, s=>{...}, ...])
//   Each entry is a dynamic-import boundary: when parent module <parentId> is needed, the
//   runtime first loads the listed chunks, then evaluates <targetId>. Because the chunk
//   holding this table is in the EAGER set (method 1), every chunk it lists is provably
//   reachable-on-demand from THIS route — loaded only when a next/dynamic boundary fires
//   (i.e. only when a block of that type is actually rendered). The union of these `.js`
//   chunks is the route's ON-DEMAND set. The script asserts they are disjoint from the eager
//   set (a chunk cannot be both always-shipped and deferred).
//
// METHOD 3 — HEAVY-LIBRARY LOCATION (grep every emitted chunk; deterministic):
//   For each heavy dependency we scan ALL <.next>/static/chunks/*.js for a
//   minification-surviving literal signature. For every chunk that matches we report its
//   byte size and its PLACEMENT, decided ONLY from the two proofs above:
//     EAGER        — chunk is in the method-1 eager set (ships on every page of this route)
//     ON-DEMAND    — chunk is in the method-2 route-runtime table (deferred, reachable here);
//                    the parent dynamic-import module id(s) that load it are printed as proof
//     OTHER-ROUTE  — chunk contains the signature but is NEITHER eager NOR in this route's
//                    dynamic table; NOT claimed as on-demand for this route (this is the r3
//                    defect this method refuses to repeat)
//   This proves library PRESENCE in a chunk and PLACEMENT via the two artifacts; it does not
//   attribute every byte of a shared chunk to one library.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEXT = process.argv[2] || path.resolve(__dirname, "../../renderer/.next");
const ROUTE_KEY = "/[siteId]/[[...slug]]/page";
const manifestPath = path.join(
  NEXT,
  "server/app/[siteId]/[[...slug]]/page_client-reference-manifest.js",
);
const CHUNK_DIR = path.join(NEXT, "static/chunks");

// Heavy deps this slice pulls out of the always-loaded bundle. Signature = a literal that
// survives minification and is distinctive to the library (verified present in the built
// chunks, not guessed): swiper's DOM class names, highlight.js' `hljs` namespace, marked's
// internal token/option identifiers, lucide's icon-registry marker.
const LIB_SIGNATURES = {
  swiper: /swiper-slide|swiper-wrapper/,
  "highlight.js": /hljs/,
  marked: /smartypants|blockTokens/,
  lucide: /lucide/,
};

const relChunk = (webpackName) => webpackName.replace(/^\/_next\//, ""); // "static/chunks/x.js"
const baseName = (webpackName) => path.basename(webpackName);
const chunkBytes = (rel) => {
  try {
    return fs.statSync(path.join(NEXT, rel)).size;
  } catch {
    return null;
  }
};
const fileBytes = (base) => chunkBytes(path.join("static/chunks", base));
const sum = (m) => [...m.values()].reduce((a, b) => a + (b || 0), 0);
const fmt = (n) => `${n.toLocaleString("en-US")} B (${Math.round(n / 1024)} KiB)`;

// ── METHOD 1: eager set from the manifest ────────────────────────────────────────────
const code = fs.readFileSync(manifestPath, "utf8");
globalThis.__RSC_MANIFEST = {};
// eslint-disable-next-line no-eval
(0, eval)(code);
const manifest = globalThis.__RSC_MANIFEST[ROUTE_KEY];

const eagerChunks = new Map(); // basename -> size
let asyncFlagCount = 0;
for (const [key, mod] of Object.entries(manifest.clientModules)) {
  if (key.includes("<module evaluation>")) continue; // dedupe: same id emitted twice
  if (mod.async) asyncFlagCount++;
  for (const c of mod.chunks) {
    if (!c.endsWith(".js")) continue;
    const b = baseName(c);
    if (!eagerChunks.has(b)) eagerChunks.set(b, chunkBytes(relChunk(c)));
  }
}
const eagerSet = new Set(eagerChunks.keys());

console.log(`# Route ${ROUTE_KEY}   (.next = ${NEXT})`);
console.log(
  `# manifest clientModules with async:true = ${asyncFlagCount}  ` +
    `(this route marks none async; eager set below is authoritative, on-demand split is method 2)`,
);
console.log(`\n## METHOD 1 — EAGER client chunks (always shipped on this route)`);
console.log(`chunk\tbytes`);
for (const [c, s] of [...eagerChunks].sort((a, b) => (b[1] || 0) - (a[1] || 0))) {
  console.log(`${c}\t${s === null ? "?" : s}`);
}
console.log(`EAGER_TOTAL\t${sum(eagerChunks)}  => ${fmt(sum(eagerChunks))}`);

// ── METHOD 2: route-runtime dynamic-import table ─────────────────────────────────────
// Match one turbopack registration entry:  <parentId>,s=>{s.v(t=>Promise.all([<list>]
//   .map(t=>s.l(t))).then(()=>t(<targetId>)))}
// The list holds "static/chunks/<name>" (js and css); we keep the .js chunks.
const ENTRY_RE =
  /(\d+),s=>\{s\.v\(t=>Promise\.all\(\[([^\]]*)\]\.map\(t=>s\.l\(t\)\)\)\.then\(\(\)=>t\((\d+)\)\)\)\}/g;
const CHUNK_IN_LIST_RE = /"static\/chunks\/([^"]+\.js)"/g;

// Scan the EAGER chunks (the table lives in one of them — the route runtime chunk).
const dynEntries = []; // { runtimeChunk, parentId, targetId, chunks: [basename] }
for (const eagerFile of eagerSet) {
  const p = path.join(CHUNK_DIR, eagerFile);
  if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, "utf8");
  ENTRY_RE.lastIndex = 0;
  let m;
  while ((m = ENTRY_RE.exec(txt))) {
    const parentId = m[1];
    const targetId = m[3];
    const chunks = [...m[2].matchAll(CHUNK_IN_LIST_RE)].map((x) => x[1]);
    if (chunks.length === 0) continue;
    dynEntries.push({ runtimeChunk: eagerFile, parentId, targetId, chunks });
  }
}
// On-demand set = union of chunks named in the table. parent(s) that load each chunk = proof.
const onDemand = new Map(); // basename -> { size, parents:Set }
for (const e of dynEntries) {
  for (const c of e.chunks) {
    if (!onDemand.has(c)) onDemand.set(c, { size: fileBytes(c), parents: new Set() });
    onDemand.get(c).parents.add(e.parentId);
  }
}
const onDemandSet = new Set(onDemand.keys());
// Invariant: a chunk cannot be both always-shipped (eager) and deferred (on-demand).
const overlap = [...onDemandSet].filter((c) => eagerSet.has(c));

console.log(
  `\n## METHOD 2 — route-runtime dynamic-import table ` +
    `(${dynEntries.length} boundaries in ${new Set(dynEntries.map((e) => e.runtimeChunk)).size} runtime chunk(s))`,
);
if (dynEntries.length === 0) {
  console.log(
    `(no dynamic-import boundaries reachable from this route's eager chunks — ` +
      `every render module is EAGER; this is the BEFORE state)`,
  );
} else {
  console.log(`parentModuleId\ttargetModuleId\tchunks(bytes)\truntimeChunk`);
  for (const e of dynEntries.sort((a, b) => Number(a.parentId) - Number(b.parentId))) {
    const withBytes = e.chunks.map((c) => `${c}(${fileBytes(c)})`).join(",");
    console.log(`${e.parentId}\t${e.targetId}\t${withBytes}\t${e.runtimeChunk}`);
  }
  console.log(
    `ONDEMAND_TOTAL\t${sum(new Map([...onDemand].map(([k, v]) => [k, v.size])))}  ` +
      `=> ${fmt(sum(new Map([...onDemand].map(([k, v]) => [k, v.size]))))}` +
      `  (${onDemand.size} distinct chunks; only fetched when a block of that type renders)`,
  );
}
console.log(
  `# eager∩on-demand overlap = ${overlap.length}  ` +
    `(MUST be 0 — a chunk is either always-shipped or deferred, never both)`,
);

// ── METHOD 3: heavy-library location across ALL emitted chunks ───────────────────────
const allChunks = fs.existsSync(CHUNK_DIR)
  ? fs.readdirSync(CHUNK_DIR).filter((f) => f.endsWith(".js"))
  : [];
const placementOf = (f) =>
  eagerSet.has(f) ? "EAGER" : onDemandSet.has(f) ? "ON-DEMAND" : "OTHER-ROUTE";
const parentsOf = (f) => (onDemand.has(f) ? [...onDemand.get(f).parents].join("+") : "-");

console.log(
  `\n## METHOD 3 — heavy-library location (grep of all ${allChunks.length} emitted chunks)`,
);
console.log(`library\tchunk\tplacement\tbytes\thits\tloadedByParentId`);
const libPlacement = {};
for (const [lib, re] of Object.entries(LIB_SIGNATURES)) {
  const g = new RegExp(re, "g");
  const hits = [];
  for (const f of allChunks) {
    const txt = fs.readFileSync(path.join(CHUNK_DIR, f), "utf8");
    const n = (txt.match(g) || []).length;
    if (n > 0) hits.push({ f, n, size: fs.statSync(path.join(CHUNK_DIR, f)).size });
  }
  hits.sort((a, b) => b.size - a.size);
  libPlacement[lib] = hits.some((h) => eagerSet.has(h.f)) ? "EAGER" : "not-eager";
  for (const h of hits) {
    console.log(
      `${lib}\t${h.f}\t${placementOf(h.f)}\t${h.size}\t${h.n}\t${parentsOf(h.f)}`,
    );
  }
  if (hits.length === 0) console.log(`${lib}\t(none)\t-\t0\t0\t-`);
}
console.log(`\n## Heavy libs present in the EAGER set (0 = fully code-split off the always-shipped bundle)`);
for (const [lib, place] of Object.entries(libPlacement)) {
  console.log(`${lib}\t${place === "EAGER" ? "EAGER (ships on every page)" : "on-demand only"}`);
}
