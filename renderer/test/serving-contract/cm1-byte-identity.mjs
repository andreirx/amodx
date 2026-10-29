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
// four digits of the footer year, and the build-derived bytes the ratified masks already covered (asset paths, build
// id, client-module ids and chunk lists). Everything else is compared: the HTML outside the payload unsorted byte
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
    async function walk(dir) {
        for (const e of await readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) await walk(full);
            else if (e.name.endsWith("_client-reference-manifest.js")) {
                const sandbox = {};
                vm.runInNewContext(await readFile(full, "utf8"), sandbox);
                for (const manifest of Object.values(sandbox.__RSC_MANIFEST ?? {})) {
                    for (const [modulePath, entry] of Object.entries(manifest.clientModules ?? {})) {
                        const id = String(entry.id);
                        if (map[id] !== undefined && map[id] !== modulePath) {
                            throw new Error(`client module id ${id} names two modules: ${map[id]} and ${modulePath}`);
                        }
                        map[id] = modulePath;
                    }
                }
            }
        }
    }
    await walk(path.join(rendererDir, ".next", "server"));
    return map;
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
 * Plus the two ratified masks: `/_next/static/…` asset paths (`assetPath`) and the build id (`buildId`).
 * Nothing else is masked.
 *
 * @param side `{ buildId, clientModules }` of the capture set the body belongs to.
 */
export function maskBody(body, { buildId, clientModules }) {
    const counts = { flightChunks: 0, clientRefRows: 0, clientRefUses: 0, clientRefExportRows: 0, assetPath: 0, buildId: 0, footerYear: 0 };
    const { html, chunks, flight } = splitFlight(body);
    counts.flightChunks = chunks;
    const allRows = flight.split("\n");
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
