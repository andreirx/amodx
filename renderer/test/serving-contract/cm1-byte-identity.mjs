// CM1-BYTE-IDENTITY, Layer 1 (hermetic) — slice cat-mode-1; spec docs/slices/catalog-mode-1.md § 3.6, comparison
// contract as amended by § 8.19 "CM1-A1" (human ruling B, 2026-10-29).
//
// WHAT IT PROVES: a tenant WITHOUT `catalogMode` answers every § 3.6 URL with the same status, the same Content-Type
// and the same canonical body before and after cat-mode-1. Baseline = the renderer of commit de4ad52 (the commit
// cat-mode-1 starts from), built and served against THIS suite's stub data; candidate = the tree under test, captured
// by the `cm1-*` rows of contract.test.mjs on the renderer the suite already built. Both capture sets (bodies,
// status, Content-Type, build id, client-module map) are committed under `cm1-byte-identity/` (spec § 3.6 step 3).
//
// WHAT IT DOES NOT COMPARE (CM1-A1, stated so nobody mistakes the gate for the original wording): the ORDER of the
// rows inside the RSC flight payload (compared as a sorted set), where the stream cut that payload into chunks, the
// four digits of the footer year, the build-derived bytes the ratified masks already covered (asset paths, build
// id, client-module ids and chunk lists), and — CM1-A3, § 8.21 — the framework chunk NAMES inside Turbopack's
// `<script id="_R_">` bootstrap (their count is compared; their existence is row `np1-bootstrap-chunks`).
// Everything else is compared: the HTML outside the payload unsorted byte
// for byte, every flight row's bytes, and which client component each element mounts (module path + export).
//
// Users: contract.test.mjs (rows `cm1-*`) and this file's CLI (`node cm1-byte-identity.mjs capture <dir>`), which
// produced the baseline from a `git worktree` of de4ad52 (procedure: cm1-byte-identity/README.md).
//
// A FAILING `cm1-identity` ROW MEANS a non-catalog tenant's bytes changed. If a later slice changes them on
// purpose, it re-captures the baseline from its own start commit and records why — never relax a canonicalisation.
import path from "node:path";
import vm from "node:vm";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CM1 } from "./fixtures.mjs";

export const CM1_DIR = fileURLToPath(new URL("./cm1-byte-identity/", import.meta.url));
export const CM1_BASELINE_DIR = path.join(CM1_DIR, "baseline");
/** The de4ad52 capture set: the strict baseline until locale-1a advanced `baseline/` (README § "Baseline history");
 *  kept as the reference of row `cm1-control`, whose catalog tenant must differ from the pre-catalog-mode renderer. */
export const CM1_CONTROL_DIR = path.join(CM1_DIR, "control-de4ad52");
export const CM1_CANDIDATE_DIR = path.join(CM1_DIR, "candidate");

/** The § 3.6 step-3 request list for one tenant (paths as a visitor sends them; the host selects the tenant). */
function requestsFor(tenantKey, { productSlugs, legacyProductIds, categorySlug, searchTerm, extraPaths = [] }) {
    const paths = [
        "/", "/about", ...extraPaths, "/shop", "/shop?availability=in_stock", `/category/${categorySlug}`,
        ...productSlugs.map((slug) => `/product/${slug}`),
        ...legacyProductIds.map((id) => `/products/${id}`), `/search?q=${searchTerm}`, "/cart", "/checkout",
        "/sitemap.xml", "/openai-feed", "/robots.txt", "/llms.txt",
    ];
    return paths.map((p) => ({ tenant: tenantKey, host: CM1[tenantKey].host, path: p, file: fileNameOf(p) }));
}

/** A stable, file-system-safe name per path: `/` → `root`, `/shop?availability=in_stock` → `shop_availability_in_stock`. */
function fileNameOf(p) {
    return p === "/" ? "root" : p.replace(/^\//, "").replace(/[^A-Za-z0-9.-]+/g, "_");
}

export const CM1_REQUESTS = {
    commerce: requestsFor("commerce", {
        productSlugs: ["sale-rug", "variant-rug", "sold-out-rug", "rug-care-guide"],
        legacyProductIds: ["c0000000-0000-4000-8000-000000000001"],
        categorySlug: "rugs",
        searchTerm: "rug",
        extraPaths: ["/stale-showcase"],
    }),
    content: requestsFor("content", {
        productSlugs: ["plain-rug"],
        legacyProductIds: ["d0000000-0000-4000-8000-000000000001"],
        categorySlug: "mats",
        searchTerm: "rug",
    }),
    catalog: requestsFor("catalog", {
        productSlugs: ["oak-plank", "ash-plank", "legacy-plank"],
        // Oak (images), Ash (no image: the legacy page's image-absence guards), Legacy Plank (stored price data).
        legacyProductIds: ["e0000000-0000-4000-8000-000000000001", "e0000000-0000-4000-8000-000000000002", "e0000000-0000-4000-8000-000000000003"],
        categorySlug: "floors",
        searchTerm: "plank",
        extraPaths: ["/stale-showcase"],
    }),
};

/**
 * The build's client-module map, `{ "<module id>": "<module path>" }`, read from every
 * `*_client-reference-manifest.js` under `<rendererDir>/.next/server`. The module path (e.g.
 * `[project]/src/components/SearchBar.tsx`) is what a build does not change; the id is. One id with two paths
 * would make resolution ambiguous, so it fails loudly.
 */
export async function readClientModules(rendererDir) {
    const map = {};
    for (const manifest of await clientReferenceManifests(rendererDir)) {
        for (const [modulePath, entry] of Object.entries(manifest.clientModules ?? {})) {
            const id = String(entry.id);
            if (map[id] !== undefined && map[id] !== modulePath) {
                throw new Error(`client module id ${id} names two modules: ${map[id]} and ${modulePath}`);
            }
            map[id] = modulePath;
        }
    }
    return map;
}

/** Every manifest object of every `*_client-reference-manifest.js` under `<rendererDir>/.next/server`. */
async function clientReferenceManifests(rendererDir) {
    const out = [];
    async function walk(dir) {
        for (const e of await readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) await walk(full);
            else if (e.name.endsWith("_client-reference-manifest.js")) {
                const sandbox = {};
                vm.runInNewContext(await readFile(full, "utf8"), sandbox);
                out.push(...Object.values(sandbox.__RSC_MANIFEST ?? {}));
            }
        }
    }
    await walk(path.join(rendererDir, ".next", "server"));
    return out;
}

/** The client entry of the root 404 boundary `app/not-found.tsx`, as the manifests name it. */
const ROOT_NOT_FOUND_ENTRY = "[project]/renderer/src/app/not-found";

/**
 * NEXT-PATCH-1 (ruling R-NP1-F1 rule 3; catalog-mode-1.md § 8.21 CM1-A3; next-patch-1.md § Build record): the
 * script that the d9999d2 root layout loaded and that the
 * after document head still loads, named by THIS build — the one JS entry file of the root 404 boundary
 * (`entryJSFiles["[project]/renderer/src/app/not-found"]`) in the build's client-reference manifests. The chunk holds
 * Next's own client code, so its content-hashed name can change with a framework update (it did from 16.4.3 to 16.4.6).
 * @returns `{ kind: "script", src: "/_next/static/chunks/<name>.js" }`, or `{ kind: "problem", problem }` (fail closed)
 *          when no manifest names the entry, the manifests disagree, or the entry is not exactly one file.
 */
export async function readRootNotFoundScript(rendererDir) {
    const lists = (await clientReferenceManifests(rendererDir)).map((m) => m.entryJSFiles?.[ROOT_NOT_FOUND_ENTRY]).filter((l) => l !== undefined);
    if (lists.length === 0) return { kind: "problem", problem: `no client-reference manifest of the build names ${ROOT_NOT_FOUND_ENTRY}` };
    if (lists.some((l) => JSON.stringify(l) !== JSON.stringify(lists[0]))) return { kind: "problem", problem: `the manifests disagree on the JS entry of ${ROOT_NOT_FOUND_ENTRY}` };
    if (!Array.isArray(lists[0]) || lists[0].length !== 1 || !/^static\/chunks\/[^/]+\.js$/.test(lists[0][0])) {
        return { kind: "problem", problem: `the JS entry of ${ROOT_NOT_FOUND_ENTRY} is not exactly one static/chunks file: ${JSON.stringify(lists[0])}` };
    }
    return { kind: "script", src: `/_next/${lists[0][0]}` };
}

/**
 * GETs every request of the given tenants, sequentially, through `request` (harness.mjs).
 * @returns {Promise<{tenant:string, path:string, file:string, status:number, contentType:string, body:string}[]>}
 */
export async function captureCm1(request, port, tenantKeys) {
    const out = [];
    for (const key of tenantKeys) {
        for (const r of CM1_REQUESTS[key]) {
            const res = await request({ port, path: r.path, host: r.host });
            out.push({ ...r, status: res.status, contentType: res.header("content-type") ?? "", body: res.body });
        }
    }
    return out;
}

/**
 * Writes one capture set: `<dir>/<tenant>/<file>.body` per capture, `<dir>/index.json` (build id; per capture the
 * path, status, Content-Type) and `<dir>/client-modules.json` (the build's module-id → path map).
 */
export async function writeCaptures(dir, { buildId, clientModules, captures }) {
    const index = { buildId, captures: [] };
    for (const c of captures) {
        await mkdir(path.join(dir, c.tenant), { recursive: true });
        const rel = `${c.tenant}/${c.file}.body`;
        await writeFile(path.join(dir, rel), c.body);
        index.captures.push({ tenant: c.tenant, path: c.path, status: c.status, contentType: c.contentType, body: rel });
    }
    await writeFile(path.join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");
    await writeFile(path.join(dir, "client-modules.json"), JSON.stringify(clientModules, null, 2) + "\n");
}

/** Reads what `writeCaptures` wrote. */
export async function readCaptures(dir) {
    const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf8"));
    const clientModules = JSON.parse(await readFile(path.join(dir, "client-modules.json"), "utf8"));
    const captures = [];
    for (const c of index.captures) captures.push({ ...c, body: await readFile(path.join(dir, c.body), "utf8") });
    return { buildId: index.buildId, clientModules, captures };
}

const FLIGHT_CHUNK = /<script>self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)<\/script>/g;

/** CM1-A3: Turbopack's bootstrap element and, inside it only, one framework chunk token (rule 1 of R-NP1-F1). */
const BOOTSTRAP_SCRIPT = /<script id="_R_">([^<]*)<\/script>/g;
const BOOTSTRAP_CHUNK = /static\/chunks\/[A-Za-z0-9_-]+\.js/g;

/** The `static/chunks/<name>.js` tokens of every `<script id="_R_">` element of a body, in order (none → `[]`). */
export function bootstrapChunks(body) {
    return [...body.matchAll(BOOTSTRAP_SCRIPT)].flatMap((m) => m[1].match(BOOTSTRAP_CHUNK) ?? []);
}

/**
 * Row `np1-bootstrap-chunks` (NEXT-PATCH-1 ruling R-NP1-F1 rule 2) — what the CM1-A3 mask no longer compares, checked
 * on the CURRENT build: every chunk a document's `_R_` bootstrap lists exists in the build's static output AND answers
 * 200 at `/_next/<token>`. Fail closed: a document without an `_R_` element where its baseline has one is a problem.
 * @param documents `{ where, body, baselineHasBootstrap }[]`
 * @param staticDir the build's `.next/static` (or a copy of it — a control)
 * @param statusOf  `async (urlPath) => HTTP status` of the server under test
 * @returns {Promise<{ problems: string[], documents: number, withBootstrap: number, chunks: string[] }>}
 */
export async function bootstrapChunkProblems(documents, staticDir, statusOf) {
    const problems = [], seen = new Map();
    let withBootstrap = 0;
    for (const d of documents) {
        const has = new RegExp(BOOTSTRAP_SCRIPT.source).test(d.body);
        if (!has) {
            if (d.baselineHasBootstrap) problems.push(`${d.where}: no <script id="_R_"> where the baseline has one`);
            continue;
        }
        withBootstrap += 1;
        for (const token of bootstrapChunks(d.body)) {
            if (!seen.has(token)) {
                const file = path.join(staticDir, token.slice("static/".length));
                const exists = await readFile(file).then(() => true, () => false);
                seen.set(token, { exists, status: await statusOf(`/_next/${token}`) });
            }
            const r = seen.get(token);
            if (!r.exists) problems.push(`${d.where}: ${token} is not in the build's static output`);
            if (r.status !== 200) problems.push(`${d.where}: /_next/${token} answers ${r.status}`);
        }
    }
    return { problems, documents: documents.length, withBootstrap, chunks: [...seen.keys()] };
}

/**
 * `bootstrapChunkProblems` over a GROWING journal (NEXT-PATCH-1 review-2): checks every entry `read()` returns, then
 * every entry added since — the check's own status probes add entries (a missing chunk answers a 307 HTML document) —
 * until a pass finds no new entry. Fails closed when the journal still grows after `maxPasses` passes.
 * @param read       `() => entries`, the journal in order (entries are only appended)
 * @param toDocument `(entry, index) => { where, body, baselineHasBootstrap }`
 * @returns {Promise<{ problems: string[], entries: number, passes: number, withBootstrap: number, chunks: string[] }>}
 */
export async function bootstrapChunkProblemsOfJournal(read, toDocument, staticDir, statusOf, maxPasses = 10) {
    const problems = [], chunks = new Set();
    let checked = 0, passes = 0, withBootstrap = 0;
    for (;;) {
        const entries = read();
        if (entries.length === checked) break;
        if (passes === maxPasses) {
            problems.push(`the journal still grows after ${maxPasses} passes (${entries.length - checked} entries unchecked)`);
            break;
        }
        const batch = entries.slice(checked).map((e, i) => toDocument(e, checked + i));
        checked = entries.length;
        passes += 1;
        const r = await bootstrapChunkProblems(batch, staticDir, statusOf);
        problems.push(...r.problems);
        withBootstrap += r.withBootstrap;
        for (const c of r.chunks) chunks.add(c);
    }
    return { problems, entries: checked, passes, withBootstrap, chunks: [...chunks] };
}

/** Splits a page into its HTML without the flight chunks and the decoded, joined flight payload text. */
export function splitFlight(body) {
    const chunks = [];
    const html = body.replace(FLIGHT_CHUNK, (_m, literal) => {
        chunks.push(JSON.parse(literal));
        return "";
    });
    return { html, chunks: chunks.length, flight: chunks.join("") };
}

/**
 * SCHED-1G2-ROOT-SIBLING = A (operator ruling 2026-11-22; the class of NEXT-PATCH-1 ruling R-NP1-F1: framework routing
 * metadata inside the RSC payload, no visible content). The booking pages need a second root folder `app/%5Fbook`
 * (SCHED-PAGE-LAYOUT = A). Next lists the static siblings of the dynamic root segment `[siteId]` in the segment
 * descriptor that opens one payload row of EVERY page: `[["children",{"s":{"n":"siteId","t":"d","k":"<host>","s":[…]}`.
 * Before the slice the list is `["api"]`; with the folder it is `["%5Fbook","api"]`.
 *
 * The ONE listed difference: a payload row that STARTS with that descriptor — key order n, t, k, s; `n` = "siteId",
 * `t` = "d", `k` a JSON string, and the list EXACTLY `["%5Fbook","api"]` — and whose parsed value confirms the same
 * structure at `[0][1].s` (exactly the keys n, t, k, s) is read with the list `["api"]`. Nothing else: a list with
 * another sibling, without "api", in another order, the same list in another segment's descriptor (e.g. the nested
 * `slug` descriptor), the text anywhere outside that place, or any other byte — all stay compared (row
 * `sched1g-root-sibling-controls`). Counted per body as `rootSibling` (0 or 1). Applied to both sides: a baseline
 * (captured before the slice) never matches, so the rule can only make a candidate's `["%5Fbook","api"]` equal a
 * baseline's `["api"]`.
 */
const ROOT_SIBLING_ROW = /^([0-9a-f]+):\[\["children",\{"s":\{"n":"siteId","t":"d","k":"(?:[^"\\]|\\.)*","s":\["%5Fbook","api"\]\}/;
const ROOT_SIBLING_ALLOWED = '["%5Fbook","api"]}';
export function rootSiblingAllowance(row) {
    const m = ROOT_SIBLING_ROW.exec(row);
    if (!m) return { row, applied: false };
    let value;
    try {
        value = JSON.parse(row.slice(m[1].length + 1));
    } catch {
        return { row, applied: false };
    }
    const d = Array.isArray(value) && Array.isArray(value[0]) && value[0][0] === "children" && value[0][1] !== null && typeof value[0][1] === "object" ? value[0][1].s : undefined;
    const exact = d !== null && typeof d === "object" && Object.keys(d).join(",") === "n,t,k,s" && d.n === "siteId" && d.t === "d"
        && typeof d.k === "string" && JSON.stringify(d.s) === '["%5Fbook","api"]';
    if (!exact) return { row, applied: false };
    const at = m[0].length - ROOT_SIBLING_ALLOWED.length;
    return { row: `${row.slice(0, at)}["api"]}${row.slice(m[0].length)}`, applied: true };
}

/**
 * The canonical form of one body under CM1-A1 (spec § 8.19), applied to both sides; every step reports its count.
 *
 *  1. flight chunks joined   the `self.__next_f.push([1,"…"])` scripts are removed from the HTML, decoded (JSON
 *                            string literals) and joined into one payload text. Count: `flightChunks`.
 *  2. rows as a sorted set   the payload is split into rows and compared sorted; the HTML outside it unsorted.
 *  3. client identity kept   each `<id>:I[<module id>,[<chunks>],"<export>"…]` row is removed (module id and chunk
 *                            list change with any build) and every use `"$L<id>"` becomes
 *                            `"$L<module path>#<export>"`, the path resolved through the side's own client-module
 *                            map — so mounting a different component changes the compared bytes. An unresolved
 *                            module id fails loudly. The encoder sometimes OUTLINES the export name into its own
 *                            string row (`21:"ProductImageGallery"`, referenced as `"$21"` from the `I[` row); that
 *                            reference is resolved to the name, and the outlined row — part of the same client
 *                            reference, its id assigned in async order like the `I[` row's — is removed with it, only
 *                            when no other row references it (otherwise it fails loudly). Counts: `clientRefRows`,
 *                            `clientRefUses`, `clientRefExportRows`. (Cycle 3: before, `"$21"` was taken literally
 *                            as the export, so the token carried a timing-dependent id; EXECUTED witness:
 *                            content `/product/plain-rug`, `21:` in the baseline vs `22:` in the candidate.)
 *  4. footer year            `© <four digits>` from the clock (`app/[siteId]/layout.tsx`), HTML and decoded row.
 *                            Count: `footerYear`.
 * Plus the two ratified masks: `/_next/static/…` asset paths (`assetPath`) and the build id (`buildId`), and the
 * CM1-A3 bootstrap-chunk mask (spec § 8.21, NEXT-PATCH-1 ruling R-NP1-F1 rule 1): inside the element
 * `<script id="_R_">…</script>` ONLY — Turbopack's bootstrap, which names the framework chunks by content hash and
 * WITHOUT the `/_next/` prefix the asset mask matches — each `static/chunks/<name>.js` token becomes one fixed
 * placeholder. Every other byte of that element, and the NUMBER of tokens, stays compared; a token outside the element
 * is not touched. Count: `bootstrapChunks`. That the named chunks exist and load is row `np1-bootstrap-chunks`
 * (`bootstrapChunkProblems`), not this comparison. And the one listed difference SCHED-1G2-ROOT-SIBLING
 * (`rootSiblingAllowance`, above), applied to each payload row before step 3. Count: `rootSibling`. Nothing else is
 * masked.
 *
 * @param side `{ buildId, clientModules }` of the capture set the body belongs to.
 */
export function maskBody(body, { buildId, clientModules }) {
    const counts = { flightChunks: 0, clientRefRows: 0, clientRefUses: 0, clientRefExportRows: 0, assetPath: 0, buildId: 0, footerYear: 0, bootstrapChunks: 0, rootSibling: 0 };
    const split = splitFlight(body);
    const { chunks, flight } = split;
    const html = split.html.replace(BOOTSTRAP_SCRIPT, (_m, inner) => `<script id="_R_">${inner.replace(BOOTSTRAP_CHUNK, () => {
        counts.bootstrapChunks += 1;
        return "static/chunks/<bootstrap-chunk>";
    })}</script>`);
    counts.flightChunks = chunks;
    const allRows = flight.split("\n").map((row) => {
        const allowed = rootSiblingAllowance(row);
        if (allowed.applied) counts.rootSibling += 1;
        return allowed.row;
    });
    const rowById = new Map();
    for (const row of allRows) {
        const m = /^([0-9a-f]+):/.exec(row);
        if (m) rowById.set(m[1], row);
    }
    const identityOf = new Map();
    const outlinedExport = new Set();
    let kept = [];
    for (const row of allRows) {
        const ref = /^([0-9a-f]+):I(\[.*\])$/.exec(row);
        if (!ref) {
            kept.push(row);
            continue;
        }
        let [moduleId, , exportName] = JSON.parse(ref[2]);
        const modulePath = clientModules[String(moduleId)];
        if (modulePath === undefined) throw new Error(`client module id ${moduleId} (row ${ref[1]}) is not in the client-module map`);
        const outlined = typeof exportName === "string" ? /^\$([0-9a-f]+)$/.exec(exportName) : null;
        if (outlined) {
            const target = rowById.get(outlined[1]);
            const value = target === undefined ? undefined : JSON.parse(target.slice(outlined[1].length + 1));
            if (typeof value !== "string") throw new Error(`row ${ref[1]}: export reference ${exportName} is not a string row`);
            exportName = value;
            outlinedExport.add(outlined[1]);
        }
        identityOf.set(ref[1], `${modulePath}#${exportName}`);
        counts.clientRefRows += 1;
    }
    kept = kept.filter((row) => {
        const id = /^([0-9a-f]+):/.exec(row)?.[1];
        if (id === undefined || !outlinedExport.has(id)) return true;
        if (kept.some((other) => other !== row && other.includes(`"$${id}"`))) {
            throw new Error(`outlined export row ${id} is also referenced outside its client reference`);
        }
        counts.clientRefExportRows += 1;
        return false;
    });
    const rows = kept.map((row) => row.replace(/"\$L([0-9a-f]+)"/g, (m, id) => {
        const identity = identityOf.get(id);
        if (identity === undefined) return m;
        counts.clientRefUses += 1;
        return JSON.stringify(`$L${identity}`);
    }));
    rows.sort();
    let out = counts.flightChunks > 0 ? `${html}\n--- flight payload rows, sorted ---\n${rows.join("\n")}` : html;
    out = out.replace(/\/_next\/static\/[^"'\s)\\<>?]+/g, () => {
        counts.assetPath += 1;
        return "/_next/static/<asset>";
    });
    if (buildId) {
        counts.buildId = out.split(buildId).length - 1;
        out = out.split(buildId).join("<build-id>");
    }
    // HTML: `© <!-- -->2026<!-- -->`; decoded flight row: `["© ",2026," ",…]`.
    out = out.replace(/© <!-- -->\d{4}<!-- -->/g, () => {
        counts.footerYear += 1;
        return "© <!-- --><year><!-- -->";
    });
    out = out.replace(/"© ",\d{4},/g, () => {
        counts.footerYear += 1;
        return '"© ","<year>",';
    });
    return { masked: out, counts };
}

/**
 * Compares one tenant's candidate captures with the baseline's, URL by URL.
 * @returns {{ path:string, same:boolean, base:object, cand:object, why?:string }[]} per compared URL, with both
 *          sides' canonicalisation counts.
 */
export function compareTenant(baseline, candidate, tenantKey) {
    const base = baseline.captures.filter((c) => c.tenant === tenantKey);
    const cand = candidate.captures.filter((c) => c.tenant === tenantKey);
    if (JSON.stringify(base.map((c) => c.path)) !== JSON.stringify(cand.map((c) => c.path))) {
        throw new Error(`${tenantKey}: the request lists differ; re-capture the baseline`);
    }
    return base.map((b, i) => {
        const c = cand[i];
        const mb = maskBody(b.body, baseline);
        const mc = maskBody(c.body, candidate);
        const why = b.status !== c.status ? `status ${b.status} → ${c.status}`
            : b.contentType !== c.contentType ? `Content-Type ${b.contentType} → ${c.contentType}`
            : mb.masked !== mc.masked ? "canonical body differs" : undefined;
        return { path: b.path, same: why === undefined, why, base: mb.counts, cand: mc.counts };
    });
}

// ── CLI: produce a capture set (the baseline) from the renderer of the tree this file lives in ──────────────
// `node test/serving-contract/cm1-byte-identity.mjs capture <outDir>` — builds and serves THIS tree's renderer
// with the suite's stubs and writes the commerce + content + catalog capture set to <outDir>. Run from a worktree
// of the baseline commit after copying this suite's fixtures/stub/capture module into it (cm1-byte-identity/README.md).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const [cmd, outDir] = process.argv.slice(2);
    if (cmd !== "capture" || !outDir) {
        console.error("usage: node cm1-byte-identity.mjs capture <outDir>");
        process.exit(2);
    }
    const { buildRenderer, startRenderer, startStubs, request, RENDERER_DIR } = await import("./harness.mjs");
    const stubs = await startStubs();
    let server;
    try {
        await buildRenderer(stubs.ddb.url);
        server = await startRenderer(stubs);
        const buildId = (await readFile(path.join(RENDERER_DIR, ".next", "BUILD_ID"), "utf8")).trim();
        const clientModules = await readClientModules(RENDERER_DIR);
        const captures = await captureCm1(request, server.port, ["commerce", "content", "catalog"]);
        await writeCaptures(path.resolve(outDir), { buildId, clientModules, captures });
        const unhandled = stubs.unhandled();
        console.log(`captured ${captures.length} responses from ${RENDERER_DIR} (build ${buildId}, ${Object.keys(clientModules).length} client modules) → ${path.resolve(outDir)}`);
        if (unhandled.length > 0) {
            console.error(`stub could not answer: ${unhandled.join("; ")}`);
            process.exitCode = 1;
        }
    } finally {
        await server?.close();
        await stubs.close();
    }
}
