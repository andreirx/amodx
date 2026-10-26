// SERVING-CONTRACT CHARACTERIZATION SUITE — slice test-2.
//
// This file is the executable form of the serving contract stated in
// docs/caching-architecture.md § "Serving contract". Every test below pins ONE measured row
// of that document and names the section it pins. The contract was established by slices
// cache-1/2/3 as prose plus one-off probe transcripts; this suite is what makes a silent
// regression (a dynamic-API leak, a cacheable 404, a Set-Cookie on cacheable HTML, an
// nf-loop, a swallowed read failure) fail a build instead of shipping.
//
// IF A TEST HERE FAILS, IT IS A CONTRACT CHANGE. Update docs/caching-architecture.md and
// docs/testing-strategy.md in the same slice, or fix the regression — do not relax the
// assertion (docs/testing-strategy.md § Invariants).
//
// Runner: node:test (Node 22, the pinned runtime). No test framework is installed for this
// suite — see README.md § "Why node:test".
//
// TWO SERVING TARGETS (slice opennext-1a). `SERVING_TARGET=next` (default, `npm run
// test:serving`) serves with `next start`; `SERVING_TARGET=bundle` (`npm run test:serving-bundle`)
// serves the built OpenNext Lambda artefact behind an emulated CloudFront edge, with S3 / SQS /
// DynamoDB stubs. Same rows, same helpers (harness.mjs § SERVING TARGET). Under `bundle` every
// row first resolves its VERSION-EXPLICIT expectation (§ below) and fails if the built open-next
// major has none.
import { describe, test as nodeTest, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
    buildRenderer, startRenderer, startStubs, request, rendererEnv, probeEnvLoading,
    readAudit, resetAudit, AUDIT_PATH, NO_DOTENV_PRELOAD, RENDERER_DIR,
    BUNDLE, versionedExpectation, operationInventory,
} from "./harness.mjs";
import { storedStatusOf } from "../serving-bundle/s3-stub.mjs";
import {
    FIXTURE_HOST, UNKNOWN_HOST, TENANT_ID, TABLE_NAME,
    PUBLISHED_SLUG, MISSING_SLUG, D4_SLUG,
    SCANNER_TENANT_ID, SCANNER_TENANT_HOST, SCANNER_SLUG, SCANNER_PAGE_TITLE,
} from "./fixtures.mjs";

/** The exact header a route in Next's full-route (ISR) cache mode emits. */
const S_MAXAGE = "s-maxage=31536000";

// ── VERSION-EXPLICIT EXPECTATIONS (bundle target) ─────────────────────────────────────────
// One entry per row, keyed by the open-next MAJOR versions it covers ("3", "4", or "3,4" when
// both majors share it). The built major comes from the running bundle itself
// (`globalThis.openNextVersion`, reported by the Lambda host). A row whose entry has no key for
// the built major FAILS with "no expectation for version N": an adapter upgrade cannot pass a
// row on the old adapter's expectation by silence — every row must be re-stated for it.
//
// `SAME` = the row's assertions exactly as written, identical to the `next` target. Any other
// value names a bundle restatement the row branches on; each is documented at its row and in
// docs/slices/opennext-1a.md § Row inventory. 4.x entries follow spec
// docs/slices/opennext-1-upgrade.md § 4.1 ("same" there → "3,4" here); rows that § 4.1 changes
// or that had no 4.x expectation carried a "3" key only and got their "4" key in opennext-1b
// from its 4.1.9 run (docs/slices/opennext-1b.md § Row table).
// Under the `next` target this table is not consulted (every row is SAME).
const SAME = "same";
/** The MISS-rendered not-found 307 carries its `Location` twice, comma-joined
 *  (`/x?nf=1,/x?nf=1`). Ratification finding 2026-10-15 (staging), reproduced here; the stored
 *  entry holds ONE location (row d3). Characterized on 3.x. OBSERVED 4.1.9 (opennext-1b): ONE location — the rows use SAME on "4". */
const DOUBLED_LOCATION = "doubled-location";
const BUNDLE_EXPECTATIONS = {
    iso1: { "3,4": "bundle-env" },
    iso2: { "3,4": SAME },
    iso3: { "3,4": "bundle-build-tree" },
    iso4: { "3,4": SAME },
    a1: { "3,4": SAME },
    a2: { "3,4": SAME },
    c1: { "3,4": SAME },
    // § 4.1: BROKE on 4.x (`open-next/…` no longer resolves); re-pointed in opennext-1b to
    // `@opennextjs/aws/…`. "4" only: the row's code now resolves the 4.x package, so a "3" claim
    // would be false.
    c2: { "4": SAME },
    a3: { "3,4": SAME },
    b1: { "3,4": SAME },
    b2: { "3,4": SAME },
    b3: { "3,4": SAME },
    c: { "3,4": SAME },
    d1: { "3": DOUBLED_LOCATION, "4": SAME },
    d2: { "3,4": SAME },
    d3: { "3,4": "s3-journal" },
    m1: { "3,4": SAME },
    m2: { "3,4": SAME },
    m3: { "3,4": SAME },
    p1: { "3,4": SAME },
    p2: { "3,4": SAME },
    t1: { "3,4": SAME },
    t2: { "3,4": SAME },
    h1b: { "3": DOUBLED_LOCATION, "4": SAME },
    h1c: { "3": DOUBLED_LOCATION, "4": SAME },
    h1: { "3,4": SAME },
    h2: { "3": DOUBLED_LOCATION, "4": SAME },
    e1: { "3,4": "absent-or-no-store" },
    e2: { "3,4": SAME },
    f: { "3,4": SAME },
    g1: { "3,4": SAME },
    g2: { "3,4": SAME },
    g3: { "3,4": SAME },
    // Ruling OPENNEXT1A-G4 (operator, 2026-10-15): behind the edge the renderer answers on its own;
    // the status it returns to the test's POST (no body) is PINNED. Characterized defect: an
    // empty/invalid-body POST answers 500 where 400 belongs — finding, not this slice
    // (docs/slices/opennext-1a.md § 6, F6). Same status on both majors.
    g4: { "3,4": { behindEdgeStatus: 500 } },
    journals: { "3,4": SAME },
};

/** The expectation a row asserts on the current target (see above). */
function expectation(row) {
    return BUNDLE ? versionedExpectation(BUNDLE_EXPECTATIONS, row, server.openNextVersion) : SAME;
}

/**
 * `node:test`'s `test`, resolving the row's expectation first. The row id is the parenthesised
 * prefix of the title (`(a1) …` → `a1`); the body receives the expectation as its argument.
 */
function test(title, fn) {
    const row = title.match(/^\(([\w-]+)\)/)?.[1];
    return nodeTest(title, () => fn(expectation(row)));
}

/** The `Location` a not-found handoff for `target` carries on this target/version. */
const handoffLocation = (exp, target) => (exp === DOUBLED_LOCATION ? `${target},${target}` : target);

let stubs;
let stub;
let server;
let startedAt;
let builtAt;
/** `next build`'s own stdout+stderr and PID — both read by `(iso3)`. */
let build;
/**
 * The `.env*` journal as it stood the moment the server became ready — i.e. exactly the
 * `next build` + `next start` trees and nothing else. Snapshotted here rather than read
 * inside `(iso3)` because the later `iso` probes spawn processes of their own, which would
 * otherwise be indistinguishable from the ones under examination.
 */
let bootAudit;

/** GET against the fixture tenant's host. */
const get = (reqPath, headers) => request({ port: server.port, path: reqPath, host: FIXTURE_HOST, headers });

/** Zero the stub's counters, then run `fn`, then return what the render actually read. */
async function readsDuring(fn) {
    stub.reset();
    const result = await fn();
    return { result, stats: stub.stats() };
}

/**
 * Every ISR entry the serving target has stored whose key starts with `keyPrefix` (default: the
 * fixture tenant's host), with its stored status.
 *
 * Abstraction: *stored-entries reader* — users: rows d3, e1, h1c, p1 (every row that proves what
 * was or was not stored); axis: where the adapter persists ISR entries (`next start`: the
 * filesystem; the Lambda bundle: S3); rejected alternative: duplicating those rows per target.
 * `next` reads the directory below; `bundle` reads the S3 stub (`storedS3Entries`).
 *
 * MEASURED LAYOUT (next 16.2.12): the filesystem incremental cache writes one
 * `<key>.meta` + `<key>.html` + `<key>.rsc` triple under `.next/server/app/`, keyed by the
 * middleware rewrite target — i.e. `<host>/<path>`. The `.meta` carries the stored status
 * (absent = 200) and the stored response headers. Filtering to keys under a prefix
 * excludes the build-time `_not-found` / `_global-error` artefacts, which are not
 * on-demand entries. Other prefixes are for the rows that must prove nothing was stored
 * under a key OTHER than the fixture host's: a tenant id (`(p1)`, preview) or another
 * tenant's host (`(h1c)`, reflection).
 *
 * This is how "nothing was stored" is *measured* rather than argued — the committed form of
 * the cache-1 probe's ISR-directory grep (docs/caching-architecture.md § "Probe: the
 * host-verdict transition", row "grep for a stored 404: none"; § "Probe: a read that fails
 * AFTER tenant resolution", row "grep the ISR cache for a stored 500").
 *
 * Every absence assertion below is paired with a positive control that uses this same
 * function, so a silently-broken detector fails the suite instead of passing it.
 */
async function storedIsrEntries(keyPrefix = FIXTURE_HOST) {
    if (BUNDLE) return storedS3Entries(keyPrefix);
    // Two on-disk layouts, both walked so the detector reads whichever the installed Next writes:
    //  - legacy (<= 16.3.5): .next/server/app/<host>/<slug>.meta
    //  - route-scoped (>= 16.3.8, `server/lib/route-cache-key.js`):
    //      .next/server/route-cache/<kind>/<sha256(sourceRoute)>/$/<host>/<slug>.meta
    //    The key is everything after the `$` segment — the same rewritten path as before, now
    //    scoped under its owning route. A detector reading only the legacy root silently finds
    //    nothing on the new layout (hit 2026-10-13 on the 16.3.5 -> 16.3.8 bump).
    const server = path.join(RENDERER_DIR, ".next", "server");
    const out = [];
    async function walk(dir, keyOf) {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) await walk(full, keyOf);
            else if (e.name.endsWith(".meta")) {
                const key = keyOf(full);
                if (!key || !key.startsWith(keyPrefix)) continue;
                const meta = JSON.parse(await readFile(full, "utf8"));
                out.push({ key, status: meta.status ?? 200, location: meta.headers?.location });
            }
        }
    }
    const legacyRoot = path.join(server, "app");
    await walk(legacyRoot, (full) => path.relative(legacyRoot, full).replace(/\.meta$/, ""));
    const routeRoot = path.join(server, "route-cache");
    await walk(routeRoot, (full) => {
        const segs = path.relative(routeRoot, full).split(path.sep); // [kind, hash, '$', host, ...]
        const at = segs.indexOf("$");
        return at === -1 ? null : segs.slice(at + 1).join("/").replace(/\.meta$/, "");
    });
    return out;
}

/**
 * Bundle target: the ISR entries currently in the S3 stub, by cache key.
 *
 * MEASURED LAYOUT (open-next 3.1.3 `cache/incremental/s3.js` `buildS3Key` + next 16.3.8; the
 * same key OBSERVED on @opennextjs/aws 4.1.9, opennext-1b row B-ISO):
 *   `_cache/<buildId>/route-cache/<kind>/<sha256>/$/<host>/<path>.cache`
 * — the same route-scoped key the filesystem walker above reads, under the `_cache/<buildId>/`
 * prefix (`CACHE_BUCKET_KEY_PREFIX`, `NEXT_BUILD_ID`). The pre-16.3.8 form
 * `_cache/<buildId>/<host>/<path>.cache` is read too. `__fetch/` (the data cache) is skipped.
 * Status and Location come from the stored object (`meta.status`, `meta.headers.location`).
 */
function storedS3Entries(keyPrefix) {
    const out = [];
    for (const { key: s3Key, body } of stubs.s3.objects()) {
        const m = s3Key.match(/^_cache\/(?!__fetch\/)[^/]+\/(.+)\.cache$/);
        if (!m) continue;
        const segs = m[1].split("/");
        const at = segs[0] === "route-cache" ? segs.indexOf("$") : -1;
        const key = segs[0] === "route-cache" ? (at === -1 ? null : segs.slice(at + 1).join("/")) : m[1];
        if (!key || !key.startsWith(keyPrefix)) continue;
        let value;
        try {
            value = JSON.parse(body);
        } catch {
            value = {};
        }
        out.push({ key, s3Key, status: storedStatusOf(Buffer.from(body)), location: value.meta?.headers?.location });
    }
    return out;
}

/** Bundle target: every PutObject the S3 stub journaled for an ISR key ending in `/<cacheKey>.cache`. */
const s3PutsFor = (cacheKey) =>
    stubs.s3.journal().filter((e) => e.op === "PutObject" && e.key.endsWith(`/${cacheKey}.cache`));

/**
 * The `environment` block of the RendererServer Lambda (infra/lib/renderer-hosting.ts,
 * `this.serverFunction = new lambda.Function(this, 'RendererServer', …)`), minus the optional
 * `RECAPTCHA_SITE_KEY`. `(iso1)` asserts the bundle target sets every one.
 */
const RENDERER_SERVER_ENV = [
    "NODE_ENV", "TABLE_NAME", "API_URL", "CACHE_BUCKET_NAME", "CACHE_BUCKET_KEY_PREFIX",
    "CACHE_BUCKET_REGION", "AMODX_API_KEY_SECRET", "REVALIDATION_SECRET", "NEXTAUTH_SECRET",
    "NEXTAUTH_URL", "REVALIDATION_QUEUE_URL", "REVALIDATION_QUEUE_REGION", "CACHE_DYNAMO_TABLE",
    "ORIGIN_VERIFY_SECRET",
];
/** Not in infra: the variables that keep the bundle's SDK calls on this host (harness.mjs `bundleEnv`). */
const BUNDLE_HERMETIC_ENV = [
    "AWS_ENDPOINT_URL_S3", "AWS_ENDPOINT_URL_SQS", "AWS_ENDPOINT_URL", "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE",
];

/**
 * `(iso3)` on the bundle target: the `open-next build` tree and the Lambda host child.
 *
 * The build root is `npm run build:open`; its tree is `npm` → `open-next build` (the `.bin/open-next`
 * link of `@opennextjs/aws` since opennext-1b; `npx` sat in between on 3.1.3) → `npm run build` →
 * `next build` → workers (+ the image function's `npm install … sharp@0.35.5`). OBSERVED 2026-10-15
 * (3.1.3 and 4.1.9): the `sh -c` hops
 * exec their single command, so each node process is the direct child of the previous one — but
 * that is a shell detail, so the `open-next` and `next` build processes are found by the script
 * they run (`argv1`, recorded by no-dotenv.cjs: the `.bin/` link or the package path), not by
 * walking parent PIDs. What must hold, each read from the journal:
 *   - the npm root, the `open-next build` process and the `next build` process loaded the hook;
 *   - at least one process spawned by `next build` loaded it (the worker hop, as on `next`);
 *   - the Lambda host child serving every row loaded it;
 *   - `.env*` accesses were intercepted, and only under the four @next/env candidate names;
 *   - `next build` itself reported loading no env file (first-party, preload-independent).
 */
function iso3BundleTree() {
    assert.doesNotMatch(build.log, /- Environments:/, "`next build` (inside open-next build) reported loading env files");
    const loads = bootAudit.filter((r) => r.ev === "load");
    const blocks = bootAudit.filter((r) => r.ev === "block");
    const pids = new Set(loads.map((r) => r.pid));
    const runs = (re) => loads.filter((r) => re.test(String(r.argv1 ?? "")) && r.argv2 === "build");
    assert.ok(pids.has(build.pid), `the npm root (pid ${build.pid}) did not load the hook`);
    const openNext = runs(/[\\/](?:\.bin[\\/]open-next|open-next[\\/]dist[\\/]index\.js)$/);
    assert.ok(openNext.length > 0, "no `open-next build` process loaded the hook");
    const nextBuild = runs(/[\\/](?:\.bin[\\/]next|next[\\/]dist[\\/]bin[\\/]next)$/);
    assert.ok(nextBuild.length > 0, "no `next build` process loaded the hook");
    assert.ok(
        loads.some((r) => nextBuild.some((n) => r.ppid === n.pid) && !nextBuild.some((n) => n.pid === r.pid)),
        "no process spawned by `next build` loaded the hook",
    );
    assert.ok(pids.has(server.pid), `the Lambda host child (pid ${server.pid}) did not load the hook`);
    assert.ok(blocks.length > 0, "no .env* access was intercepted — is the hook still wired?");
    assert.deepEqual(
        [...new Set(blocks.map((r) => r.file))].sort(),
        [".env", ".env.local", ".env.production", ".env.production.local"],
        "@next/env's candidate list changed; re-derive this row against the new one",
    );
    console.log(
        `  (iso3/bundle) ${pids.size} process(es) covered (npm root, open-next build pid ${openNext[0].pid}, ` +
            `next build pid ${nextBuild[0].pid}, lambda host pid ${server.pid}), ${blocks.length} .env* accesses blocked`,
    );
}

describe("renderer serving contract (docs/caching-architecture.md)", { concurrency: 1 }, () => {
    before(async () => {
        startedAt = Date.now();
        await resetAudit();
        stubs = await startStubs();
        stub = stubs.ddb;
        build = await buildRenderer(stub.url);
        builtAt = Date.now();
        server = await startRenderer(stubs);
        bootAudit = await readAudit();
    });

    after(async () => {
        const unhandled = stubs.unhandled();
        if (BUNDLE) console.log(`\n${operationInventory(stubs, "contract rows")}`);
        await server?.close();
        await stubs?.close();
        await rm(AUDIT_PATH, { force: true });
        console.log(
            `\nserving-contract suite (${BUNDLE ? "bundle" : "next"} target) wall time: ` +
                `${((Date.now() - startedAt) / 1000).toFixed(1)}s ` +
                `(build ${((builtAt - startedAt) / 1000).toFixed(1)}s, rows ${((Date.now() - builtAt) / 1000).toFixed(1)}s)`,
        );
        // A stub that invented absence would let this suite pass while the renderer read
        // nothing. Every read it could not answer is reported here.
        assert.deepEqual(unhandled, [], `a stub could not answer some calls: ${unhandled.join("; ")}`);
    });

    // ── HARNESS SELF-CHECK (iso) ────────────────────────────────────────────────────────
    // Not contract rows: these four pin the suite's own ISOLATION, which every row below
    // depends on for its meaning. A run that had reached the operator's `.env.local` would be
    // measuring the wrong TABLE_NAME with a real `AMODX_API_KEY` in scope, and a green result
    // would prove nothing. Slice test-2 hard constraint: "credential-free, no `.env*` reads".
    // Mechanisms are documented in harness.mjs (header) and no-dotenv.cjs.
    //
    // They are layered deliberately, weakest premise first:
    //   iso1  the environment we hand out is constructed        (what we control)
    //   iso2  Next's own loader, under it, loads nothing        (the hook works)
    //   iso3  the REAL build/start trees loaded nothing         (it worked where it matters)
    //   iso4  and it survives the hop that drops an argv flag   (why iso3 will keep holding)

    test("(iso1) the renderer child environment is constructed, never inherited", (exp) => {
        // Bundle target: the environment the Lambda host child was ACTUALLY spawned with.
        const env = exp === "bundle-env" ? server.env : rendererEnv(stub.url);
        // Whitelist = the four OS passthroughs + the variables harness.mjs pins itself.
        const allowed = new Set([
            "PATH", "HOME", "TMPDIR", "CI",
            "NODE_OPTIONS", "AMODX_DOTENV_AUDIT",
            "__NEXT_PROCESSED_ENV", "NEXT_TELEMETRY_DISABLED",
            "TABLE_NAME", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
            "AWS_ENDPOINT_URL_DYNAMODB", "ORIGIN_VERIFY_SECRET", "NEXT_PUBLIC_API_URL",
            "NEXTAUTH_SECRET", "RECAPTCHA_SITE_KEY",
            ...(exp === "bundle-env" ? [...RENDERER_SERVER_ENV, ...BUNDLE_HERMETIC_ENV] : []),
        ]);
        if (exp === "bundle-env") {
            // Every variable of the RendererServer Lambda is set (constructed, not blank where
            // infra sets a value)…
            for (const name of RENDERER_SERVER_ENV) {
                assert.ok(env[name], `RendererServer variable ${name} is missing or empty`);
            }
            // …the origin guard is ARMED (the next target blanks it), and every AWS endpoint —
            // the three stubs and the catch-all — is on this host.
            assert.notEqual(env.ORIGIN_VERIFY_SECRET, "", "the bundle target must exercise ORIGIN_VERIFY_SECRET");
            for (const name of ["AWS_ENDPOINT_URL_S3", "AWS_ENDPOINT_URL_SQS", "AWS_ENDPOINT_URL"]) {
                assert.match(env[name], /^http:\/\/127\.0\.0\.1:\d+$/, `${name} must stay on this host`);
            }
        }
        assert.deepEqual(
            Object.keys(env).filter((k) => !allowed.has(k)),
            [],
            "an unlisted variable reached the renderer child — a `...process.env` spread is back",
        );
        // The endpoint override is what keeps every SDK call on this host.
        assert.match(env.AWS_ENDPOINT_URL_DYNAMODB, /^http:\/\/127\.0\.0\.1:\d+$/);
        assert.equal(env.TABLE_NAME, TABLE_NAME, "the fixture table, not the operator's");
        // The `.env*` hook must travel in the ENVIRONMENT. An argv `--require` covers only the
        // process we spawn; NODE_OPTIONS is inherited by everything Next spawns beneath it.
        assert.equal(env.NODE_OPTIONS, `--require ${JSON.stringify(NO_DOTENV_PRELOAD)}`);
    });

    test("(iso2) Next's env loader, run under the suite's exact conditions, loads no .env* file", async () => {
        // Executes @next/env#loadEnvConfig — the very function `next build` and `next start`
        // call — in a process carrying the suite's environment. `loadedEnvFiles` empty proves
        // the file was never opened; `gainedKeys` empty proves nothing from it reached
        // `process.env`. MEASURED without the mechanisms (2026-07-28): the operator's
        // `renderer/.env.local` contributed 7 keys, `AMODX_API_KEY` among them.
        const { loadedEnvFiles, gainedKeys } = await probeEnvLoading(stub.url);
        assert.deepEqual(loadedEnvFiles, [], `Next opened ${loadedEnvFiles.join(", ")}`);
        assert.deepEqual(gainedKeys, [], `.env* injected ${gainedKeys.join(", ")}`);
    });

    test("(iso3) the REAL next build / next start process trees read no .env* file", async (exp) => {
        if (exp === "bundle-build-tree") return iso3BundleTree();
        // iso2 proves the mechanism works in a process the harness controls end to end. This
        // one is about the processes that actually ran: `next build` (and everything it
        // spawned) and the live `next start` serving every row below.
        //
        // Two independent readings, because neither alone is conclusive.

        // (a) FIRST-PARTY, PRELOAD-INDEPENDENT. `next build` reports the env files it loaded,
        //     itself: next/dist/build/index.js calls getEnvInfo(dir) and passes the result to
        //     logStartInfo, which prints `- Environments: <files>` — and prints the line only
        //     when the list is non-empty (next/dist/server/lib/app-info-log.js:104). Its
        //     absence is the build process's own statement that it loaded none. Nothing in
        //     this reading depends on our journal being written or even on the hook existing.
        assert.doesNotMatch(
            build.log,
            /- Environments:/,
            "`next build` reported loading env files — the .env* hook did not reach it",
        );

        // (b) THE JOURNAL. `no-dotenv.cjs` appends one `load` record per process it is
        //     preloaded into and one `block` record per `.env*` access it refused.
        const loads = bootAudit.filter((r) => r.ev === "load");
        const blocks = bootAudit.filter((r) => r.ev === "block");
        const pids = new Set(loads.map((r) => r.pid));

        // COVERAGE, measured. The build process itself…
        assert.ok(pids.has(build.pid), `next build (pid ${build.pid}) did not load the hook`);
        // …and at least one process the BUILD spawned. jest-worker forks with an explicit
        // `execArgv`, which drops the parent's argv flags but always inherits the environment
        // (next/dist/lib/worker.js:98-107) — which is why the hook is delivered in
        // NODE_OPTIONS. Stated precisely, because it would be easy to overclaim: MEASURED on
        // next@16.2.12, revision 1's argv `--require` also reached these workers, because Next
        // rebuilds each worker's NODE_OPTIONS from `[...process.execArgv, ...NODE_OPTIONS]`
        // (server/lib/utils.js#getParsedNodeOptions) and so re-exported the flag by accident.
        // This row exists so the property is checked rather than inherited from that accident.
        // If a future Next stops spawning workers it goes red and must be re-derived against
        // the new build architecture, not deleted — it is the coverage claim, not a detail.
        assert.ok(
            loads.some((r) => r.ppid === build.pid && r.pid !== build.pid),
            `no process spawned by next build (pid ${build.pid}) loaded the hook; ` +
                `journal has ${[...pids].join(", ")}`,
        );
        // …and the live server answering every contract row below.
        assert.ok(pids.has(server.pid), `next start (pid ${server.pid}) did not load the hook`);

        // THE MECHANISM DEMONSTRABLY FIRED, rather than nothing having happened: Next really
        // did try to stat `renderer/.env*` in these trees and was refused every time. (This
        // holds on a bare checkout too — @next/env stats all four candidate names whether or
        // not any exists.) Every recorded access is a refusal by construction; what this
        // measures is that the code path was exercised at all.
        assert.ok(blocks.length > 0, "no .env* access was intercepted — is the hook still wired?");
        assert.deepEqual(
            [...new Set(blocks.map((r) => r.file))].sort(),
            [".env", ".env.local", ".env.production", ".env.production.local"],
            "@next/env's candidate list changed; re-derive this row against the new one",
        );
        console.log(
            `  (iso3) ${pids.size} process(es) covered, ${blocks.length} .env* accesses blocked`,
        );
    });

    test("(iso4) the hook survives the hop that drops an argv --require", async () => {
        // WHY THIS EXISTS AS A SEPARATE ROW. iso3 measures the tree we ran. This measures the
        // PROPERTY that makes iso3 keep holding: `NODE_OPTIONS` propagates to a process
        // launched with its own argument vector, which is how Next's build workers are
        // launched (next/dist/lib/worker.js:98-107, jest-worker `forkOptions.execArgv`) and
        // exactly what an argv `--require` does not survive. Without this, a refactor back to
        // argv delivery would still pass iso1/iso2 and only fail iso3 for reasons no one
        // reading the diff would connect to the change.
        const grandchild = await probeEnvLoading(stub.url, { viaGrandchild: true });
        assert.deepEqual(grandchild.loadedEnvFiles, [], `a grandchild opened ${grandchild.loadedEnvFiles}`);
        assert.deepEqual(grandchild.gainedKeys, [], `a grandchild gained ${grandchild.gainedKeys}`);

        // POSITIVE CONTROL for the absence above, per this suite's rule that no absence
        // assertion stands unpaired. `loadedEnvFiles` could be empty because the field
        // silently stopped being populated by a Next upgrade. Point the same probe at a
        // throwaway directory holding a decoy `.env.local` — outside `renderer/`, so the
        // hook's predicate does not match it — and the field must fill.
        //
        // Note the decoy's KEYS still do not reach `process.env`: `__NEXT_PROCESSED_ENV=true`
        // makes `processEnv()` return before its merge loop. That is the second mechanism
        // being observed doing its half, on a live example.
        const decoyDir = await mkdtemp(path.join(os.tmpdir(), "amodx-dotenv-control-"));
        try {
            await writeFile(path.join(decoyDir, ".env.local"), "AMODX_DECOY_KEY=leaked\n");
            const control = await probeEnvLoading(stub.url, { dir: decoyDir, viaGrandchild: true });
            assert.deepEqual(
                control.loadedEnvFiles,
                [".env.local"],
                "loadEnvConfig did not report a file that is definitely there — the detector is broken, " +
                    "so the absence assertions above prove nothing",
            );
            assert.deepEqual(control.gainedKeys, [], "__NEXT_PROCESSED_ENV no longer blocks the merge");
        } finally {
            await rm(decoyDir, { recursive: true, force: true });
        }
    });

    // ── ROW (a) ─────────────────────────────────────────────────────────────────────────
    // § "Which render outcomes are cacheable": normal render → 200, s-maxage=31536000,
    // MISS → HIT, stored.  § "Measured: the origin behaviour this key depends on", row 1.

    test("(a1) published page: 200 text/html with s-maxage=31536000, x-nextjs-cache MISS", async () => {
        const { result: res, stats } = await readsDuring(() => get(PUBLISHED_SLUG));
        assert.equal(res.status, 200);
        assert.match(res.header("content-type"), /text\/html/);
        assert.match(res.header("cache-control"), new RegExp(S_MAXAGE));
        assert.equal(res.header("x-nextjs-cache"), "MISS");
        assert.match(res.body, /Published Fixture Page/);
        // Positive control for (a2): a MISS *does* read DynamoDB, so (a2)'s `render === 0`
        // is measuring a real signal and not a dead counter.
        assert.ok(stats.render > 0, "a MISS must reach the renderer read layer");
    });

    test("(a2) same page again: x-nextjs-cache HIT, and ZERO DynamoDB reads", async () => {
        const { result: res, stats } = await readsDuring(() => get(PUBLISHED_SLUG));
        assert.equal(res.status, 200);
        assert.equal(res.header("x-nextjs-cache"), "HIT");
        assert.match(res.header("cache-control"), new RegExp(S_MAXAGE));
        // The load-bearing half: no SSR ran, so the render read nothing.
        assert.equal(stats.render, 0, "a cache HIT must not reach the renderer read layer");
        // § "Probe: the host-verdict transition" measures 0 DynamoDB calls total on a HIT.
        // That holds only while the middleware host verdict is still inside its 60s
        // per-instance TTL (lib/tenant-directory.ts), which it is — (a1) ran milliseconds ago.
        assert.equal(stats.hostGate, 0, "host verdict should still be warm from (a1)");
    });

    // ── ROW (c1) ────────────────────────────────────────────────────────────────────────
    // § "The SWR revalidation queue and the scanner-junk flood (cache-8)" → mitigation (c).
    // The cache-8 REVISE ratified trying Next's `expireTime` to bound the edge SWR window. This
    // row is the executable proof that expireTime is a NO-OP for this renderer: an ISR page here
    // is `export const revalidate = false`, and Next only emits `stale-while-revalidate` when
    // `revalidate` is a NUMBER < expire (next getCacheControlHeader, cache-control.js:13). So the
    // page carries s-maxage but NO `stale-while-revalidate` at all — there is no SWR directive for
    // expireTime to size. The `stale-while-revalidate=2592000` seen at the CloudFront edge is an
    // adapter runtime constant (fixISRHeaders, 4.1.9 util.js:346, :355), NOT a Next-emitted value, so a
    // Next config cannot bound it.
    //
    // IF THIS GOES RED because a `stale-while-revalidate` now appears here, someone added
    // time-based ISR (`revalidate = <number>`) or an `expireTime` that took effect — a caching
    // MODEL change: reconcile docs/caching-architecture.md § cache-8 mitigation (c) in the same
    // slice, do not just update the assertion.
    test("(c1) an ISR page emits s-maxage but NO stale-while-revalidate (expireTime has no attachment point)", async () => {
        const res = await get(PUBLISHED_SLUG);
        assert.equal(res.status, 200);
        assert.match(res.header("cache-control"), new RegExp(S_MAXAGE));
        assert.doesNotMatch(
            res.header("cache-control"),
            /stale-while-revalidate/,
            "a revalidate=false page emits no SWR directive; the edge SWR window is an open-next constant, not a Next/expireTime value",
        );
    });

    // ── ROW (c2) ────────────────────────────────────────────────────────────────────────
    // § "The SWR revalidation queue and the scanner-junk flood (cache-8)" → mitigation (c),
    // as ratified by REVISE 2 (`cache8-mitigation-c-resolution = B`): a PINNED-DEPENDENCY PATCH
    // (`patches/@opennextjs+aws+4.1.9.patch` since slice opennext-1b; before it
    // `patches/open-next+3.1.3.patch`; applied by root `postinstall: patch-package`) rewrites the
    // hardcoded 30-day edge SWR window in the adapter's `fixISRHeaders()` from `2592000` to `300`
    // (4.1.9 `dist/core/routing/util.js:346` HIT recompute, `:355` STALE branch).
    //
    // THIS ROW IS LAYER 1 OF A TWO-LAYER GUARD (REVISE 3, operator `cache8-c2-guard-mechanism`).
    // LAYER 1 (here) reads the INSTALLED adapter source every unit run — fast, CI-affordable,
    // catches a skipped `postinstall` in ms. LAYER 2 is `scripts/verify-opennext-patch.mjs`, a
    // pre-deploy gate that asserts the patched constant survives `open-next build` INTO the shipped
    // server bundle (the property this row cannot prove). See docs/caching-architecture.md § "The SWR
    // revalidation queue and the scanner-junk flood (cache-8)" → GUARD, and the deploy runbook.
    //
    // WHY THIS ROW ASSERTS THE SHIPPED SOURCE ARTEFACT, NOT A LIVE EMITTED HEADER (verified, not
    // assumed). The edge window is produced by `fixISRHeaders()` — an open-next *Lambda-adapter*
    // function that only runs inside the deployed open-next bundle. This harness serves the site
    // with `next start` (harness.mjs), NOT the open-next bundle (README.md § "next start, not the
    // OpenNext Lambda bundle"), so `fixISRHeaders()` never executes here and no request through this
    // server can carry its header. (That holds for the `next` target. On the `bundle` target —
    // slice opennext-1a — `fixISRHeaders()` does run, and B-NO30D checks the headers it emitted;
    // this row stays the same installed-source check on both targets.)
    // The function also cannot be imported and called in isolation: its
    // transitive `adapters/config` → `adapters/logger` imports are extension-less and resolve only
    // inside open-next's own bundler (MEASURED — a bare `import` throws MODULE_NOT_FOUND). So the
    // faithful, low-fragility guard reads the EXACT `@opennextjs/aws/dist/core/routing/util.js` file
    // (resolved through the package `exports` `"./*" → "./dist/*"`) that
    // `open-next build` bundles into the RevalidationFunction/server Lambda and asserts the patched
    // constant is present in `fixISRHeaders()` and the 2592000 window is gone from it.
    //
    // IF THIS GOES RED: either the patch did not apply (a fresh clone whose `postinstall` was skipped
    // — run `npx patch-package`) or `@opennextjs/aws` was upgraded past 4.1.9 and the patch no longer
    // matches (re-cut the patch against the new `fixISRHeaders`, or drop it if the upstream default
    // changed). Both are exactly the "silently-unapplied patch / upgrade" cases REVISE 2 requires to
    // fail loud. The row name says "open-next" for the adapter's CLI/product name; it still asserts
    // the patched window, so it keeps its name (spec docs/slices/opennext-1-upgrade.md § 6.5).
    test("(c2) open-next fixISRHeaders emits the patched stale-while-revalidate=300 edge window, not 2592000 (cache-8 mitigation c)", async () => {
        const require = createRequire(import.meta.url);
        const utilPath = require.resolve("@opennextjs/aws/core/routing/util.js");
        const source = await readFile(utilPath, "utf8");
        const start = source.indexOf("export function fixISRHeaders");
        assert.ok(start >= 0, "fixISRHeaders not found — @opennextjs/aws layout changed; re-verify the patch target");
        const rest = source.slice(start);
        const nextExport = rest.indexOf("export function", "export function".length);
        const body = nextExport > 0 ? rest.slice(0, nextExport) : rest;
        // The STALE-serving branch — the exact header behind the prod symptom (s-maxage=2, age=194).
        assert.match(
            body,
            /s-maxage=2, stale-while-revalidate=300\b/,
            "the patched 300s STALE-path edge window is missing — patch unapplied or @opennextjs/aws upgraded",
        );
        // No 30-day window survives anywhere in fixISRHeaders (covers both the STALE and HIT branches).
        assert.doesNotMatch(
            body,
            /stale-while-revalidate=2592000/,
            "fixISRHeaders still carries the 2592000 (30-day) edge window — the cache-8 patch is not in effect",
        );
    });

    test("(a3) cacheable HTML carries no Set-Cookie (cache-3 F8)", async () => {
        // Middleware's referral capture was moved to components/ReferralCapture.tsx +
        // app/api/ref/route.ts precisely so page responses carry no Set-Cookie: a stored
        // response carrying one is replayed by CloudFront to every later viewer.
        // See renderer/middleware.ts § "REFERRAL ATTRIBUTION: deliberately NOT here".
        for (const url of [PUBLISHED_SLUG, `${PUBLISHED_SLUG}?ref=partner-a`, "/?utm_source=newsletter"]) {
            const res = await get(url);
            assert.equal(res.header("set-cookie"), undefined, `${url} must not Set-Cookie`);
        }
    });

    // ── ROW (b) ─────────────────────────────────────────────────────────────────────────
    // § "Serving contract" table, dynamic-twin column: `private, no-cache, no-store, …`.
    // § "Measured: the origin behaviour this key depends on", rows `?page=2` and the four
    // session-cookie shapes plus the two negative (decoy) rows.

    test("(b1) ?page=2 goes to the force-dynamic twin: no-store, still renders", async () => {
        const res = await get(`${PUBLISHED_SLUG}?page=2`);
        assert.equal(res.status, 200);
        assert.match(res.header("cache-control"), /no-store/);
        assert.equal(res.header("x-nextjs-cache"), undefined, "twin responses are never ISR entries");
        assert.match(res.body, /Published Fixture Page/);
    });

    test("(b2) every ratified session-cookie shape goes to the twin (H3 origin half)", async () => {
        // The prefix predicate ratified in cache-3 revision 4 — `middleware.ts`
        // SESSION_COOKIE_BASES. Pinned here so a narrowing of that predicate cannot pass CI.
        const sessionJars = [
            "next-auth.session-token=abc",
            "__Secure-next-auth.session-token=abc",
            "next-auth.session-token.0=aa; next-auth.session-token.1=bb",
            "__Secure-next-auth.session-token.0=aa; __Secure-next-auth.session-token.1=bb",
        ];
        for (const cookie of sessionJars) {
            const res = await get(PUBLISHED_SLUG, { cookie });
            assert.match(res.header("cache-control"), /no-store/, `jar "${cookie}" must reach the twin`);
        }
    });

    test("(b3) non-session cookies do NOT go to the twin (prefix, not substring)", async () => {
        // The negative half of the same predicate: a substring test would push these past
        // the edge cache for no reason. Rows "no over-match" / "prefix, not substring".
        const anonymousJars = [
            "__Host-next-auth.csrf-token=x; next-auth.callback-url=y",
            "amodx_ref=partner-a; _ga=GA1.1.1",
            "x-next-auth.session-token-decoy=x; next-auth.session-tokenX=y",
        ];
        for (const cookie of anonymousJars) {
            const res = await get(PUBLISHED_SLUG, { cookie });
            assert.match(res.header("cache-control"), new RegExp(S_MAXAGE), `jar "${cookie}" must stay cacheable`);
        }
    });

    // ── ROW (c) ─────────────────────────────────────────────────────────────────────────
    // § H2, after-table: unknown tenant / not-yet-wired host → 404 + private, no-store,
    // from middleware, NO RENDER.

    test("(c) unknown host: middleware answers 404 + no-store without rendering", async () => {
        const { result: res, stats } = await readsDuring(() =>
            request({ port: server.port, path: "/", host: UNKNOWN_HOST }),
        );
        assert.equal(res.status, 404);
        assert.match(res.header("cache-control"), /no-store/);
        assert.equal(res.header("x-nextjs-cache"), undefined);
        // "no render" is the load-bearing word: only the host gate's COUNT query happens.
        assert.equal(stats.render, 0, "the render must never run for an unwired host");
        assert.equal(stats.hostGate, 1, "the host gate should have performed exactly one COUNT query");
        // A dotted path gets the same gate (SITEID-BINDING-1: no dotted pass-through before it).
        const dotted = await request({ port: server.port, path: "/x.php", host: UNKNOWN_HOST });
        assert.equal(dotted.status, 404, "a dotted path on an unwired host must hit the unknown-host gate");
        assert.match(dotted.header("cache-control"), /no-store/);
    });

    // ── ROW (d) ─────────────────────────────────────────────────────────────────────────
    // § "How a 404 stays out of the cache", row 2, and § H2 after-table row 1:
    // 307 → `?nf=1` (cacheable) → 404 + private, no-store (not cacheable).

    test("(d1) known tenant, missing page: cacheable 307 to ?nf=1", async (exp) => {
        const res = await get(MISSING_SLUG);
        assert.equal(res.status, 307);
        // Bundle 3.x: DOUBLED_LOCATION (see its definition) — this is the MISS render.
        assert.equal(res.header("location"), handoffLocation(exp, `${MISSING_SLUG}?nf=1`));
        // The redirect itself IS stored — that is the accepted cost of never pinning a 404.
        assert.match(res.header("cache-control"), new RegExp(S_MAXAGE));
    });

    test("(d2) the ?nf=1 landing is a NON-cacheable 404 and does not loop", async () => {
        const res = await get(`${MISSING_SLUG}?nf=1`);
        // Not a 307: cache-3 F1 — `nf` is in the CloudFront query allowlist precisely
        // because a handoff that redirected again would be an infinite loop, cached.
        assert.equal(res.status, 404, "a second 307 here is the nf-loop regression");
        assert.match(res.header("cache-control"), /no-store/);
        assert.equal(res.header("x-nextjs-cache"), undefined);
    });

    test("(d3) what got stored is the 307, and no 404 was stored at all", async (exp) => {
        const entries = await storedIsrEntries();
        const redirect = entries.find((e) => e.key === `${FIXTURE_HOST}${MISSING_SLUG}`);
        // Positive control: the redirect IS the cacheable artefact. This also proves the
        // detector below is reading a live cache directory.
        assert.ok(redirect, `expected a stored entry for ${MISSING_SLUG}; got ${entries.map((e) => e.key)}`);
        assert.equal(redirect.status, 307);
        assert.equal(redirect.location, `${MISSING_SLUG}?nf=1`);
        // The row that matters: the 404 the visitor actually receives is never stored.
        assert.deepEqual(
            entries.filter((e) => e.status === 404),
            [],
            "a 404 in the ISR cache is the H2 regression",
        );
        if (exp === "s3-journal") {
            // Bundle: the S3 JOURNAL, not only the current state — a 404 written and later
            // overwritten would be gone from state but was still served from S3 meanwhile.
            assert.ok(s3PutsFor(`${FIXTURE_HOST}${MISSING_SLUG}`).some((e) => e.storedStatus === 307), "no PUT of the 307");
            assert.deepEqual(
                stubs.s3.journal().filter((e) => e.op === "PutObject" && e.storedStatus === 404).map((e) => e.key),
                [],
                "a 404 was PUT to the ISR bucket",
            );
        }
    });

    // ── ROW (m) ─────────────────────────────────────────────────────────────────────────
    // middleware A2/A2b: `_dyn` is an internal rewrite target, NEVER a public URL — but the
    // preview RSC payload hands the client router the REWRITTEN `/<siteId>/_dyn/...` path,
    // so that shape leaks into address bars and gets bookmarked/shared. Pre-16.3.5 those
    // direct requests accidentally matched the %5Fdyn twin dir (duplicate-URL serving);
    // 16.3.5 turned them into 404s (prod regression, human-reported 2026-09-16). The
    // contract now: first-segment `/_dyn/...` is refused (A2, 404 no-store); second-segment
    // `/<siteId>/_dyn/<rest>` self-heals via 308 to the canonical `/_site/<siteId>/<rest>`.

    test("(m1) /<siteId>/_dyn/<rest> permanent-redirects to the canonical /_site form", async () => {
        const res = await request({ port: server.port, path: "/leaked-site/_dyn/category/some-page", host: FIXTURE_HOST });
        assert.equal(res.status, 308, "leaked _dyn preview links must self-heal, not 404");
        assert.equal(new URL(res.header("location"), "http://x").pathname, "/_site/leaked-site/category/some-page");
    });

    test("(m2) bare /<siteId>/_dyn (no rest) redirects to /_site/<siteId>", async () => {
        const res = await request({ port: server.port, path: "/leaked-site/_dyn", host: FIXTURE_HOST });
        assert.equal(res.status, 308);
        assert.equal(new URL(res.header("location"), "http://x").pathname, "/_site/leaked-site");
    });

    test("(m3) first-segment /_dyn stays refused: 404 + no-store (A2 unchanged)", async () => {
        const res = await request({ port: server.port, path: "/_dyn/whatever", host: FIXTURE_HOST });
        assert.equal(res.status, 404);
        assert.match(res.header("cache-control"), /no-store/);
    });

    // ── ROW (p) ─────────────────────────────────────────────────────────────────────────
    // middleware B, PREVIEW MODE: `/_site/<tenantId>/…` is how a tenant with NO custom domain
    // is viewed. It addresses the tenant by id, so it is allowed only on preview hosts
    // (`isPreviewHost`: localhost / cloudfront.net / staging) and is always rendered on the
    // force-dynamic twin. Slice SITEID-BINDING-1 step 1: the permanent safety net for these
    // URLs, green on the middleware BEFORE that slice changed it. No trailing slash: Next
    // answers `/_site/<id>/` with a 308 to `/_site/<id>` before the middleware runs (slice
    // Correction 1, observed on staging).
    //
    // Gate input `Host`, evidence taxonomy: present + allowed → (p1), (t2); present + production
    // host → (p2), (t1). ABSENT has no row: `harness.request()` puts `host` in the header object
    // (`host: undefined` throws ERR_HTTP_INVALID_HEADER_VALUE in node:http), and Node's server
    // answers an HTTP/1.1 request without Host with 400 before any app code runs. Only HTTP/1.0
    // can omit it; a raw-socket probe outside the suite measured `403` for that (gate input `''`;
    // Node 22.21.1, SITEID-BINDING-1 build report). Behind CloudFront every request has a Host.

    const PREVIEW_HOST = "preview.cloudfront.net";

    test("(p1) /_site/<id> on a preview host: 200, no-store, preview cookie, nothing stored", async () => {
        const res = await request({ port: server.port, path: `/_site/${TENANT_ID}`, host: PREVIEW_HOST });
        assert.equal(res.status, 200);
        assert.match(res.header("cache-control"), /no-store/);
        assert.ok(
            [].concat(res.header("set-cookie") ?? []).some((c) => c.startsWith(`amodx_preview_base=%2F_site%2F${TENANT_ID}`)),
            `preview cookie missing; got ${res.header("set-cookie")}`,
        );
        assert.match(res.body, /Fixture Home/, "the tenant's home page must render under its id");
        // Positive control: the detector reads a live cache directory (earlier rows stored entries)…
        assert.ok((await storedIsrEntries()).length > 0, "storedIsrEntries() found nothing at all — detector broken");
        // …and the preview render stored nothing under the tenant-id key.
        assert.deepEqual(await storedIsrEntries(TENANT_ID), [], "a preview render must never enter the ISR cache");
    });

    test("(p2) /_site/<id> on a production tenant host: 403", async () => {
        const res = await get(`/_site/${TENANT_ID}`);
        assert.equal(res.status, 403);
        assert.doesNotMatch(res.body, /Fixture Home/);
    });

    // ── ROW (t) ─────────────────────────────────────────────────────────────────────────
    // middleware B, TEST MODE: `/tenant/<tenantId>/…` also addresses a tenant by id, so since
    // SITEID-BINDING-1 (D1 = A) it has the same `isPreviewHost` gate as `/_site/`. Before that it
    // had none: any production domain showed any tenant (staging finding C5). No trailing slash,
    // for the same reason as row (p).

    test("(t1) /tenant/<id> on a production tenant host: 403", async () => {
        const res = await get(`/tenant/${TENANT_ID}`);
        assert.equal(res.status, 403, "test mode must not address a tenant by id on a production host");
        assert.doesNotMatch(res.body, /Fixture Home/);
    });

    test("(t2) /tenant/<id> on a preview host: 200, no-store", async () => {
        const res = await request({ port: server.port, path: `/tenant/${TENANT_ID}`, host: PREVIEW_HOST });
        assert.equal(res.status, 200);
        assert.match(res.header("cache-control"), /no-store/);
        assert.match(res.body, /Fixture Home/);
    });

    // ── ROW (h) ─────────────────────────────────────────────────────────────────────────
    // § "cache-8": mitigation d (a middleware scanner shield) is DEFERRED, not implemented —
    // NO path-shape shield exists. These rows pin WHY (the counterexample that defeats it) and
    // the current UNMITIGATED state (scanner junk still enters the pipeline as an ordinary
    // not-found handoff). See renderer/middleware.ts § "cache-8 … DEFERRED" and
    // docs/caching-architecture.md § "The SWR revalidation queue and the scanner-junk flood".
    //
    // IF A FUTURE CHANGE RE-ADDS A `.php`/scanner SHIELD, (h1) goes red — that is the point:
    // the shield may not be re-added until this counterexample is defeated (which, under the
    // current unsanitised-slug contract, it cannot be at this layer).
    //
    // (h1b)/(h1c) pin SITEID-BINDING-1: the `[siteId]` segment is bound only by the middleware,
    // never from the wire. A dotted path naming ANOTHER tenant (by id or by host) is just a
    // path on the request host's tenant. ORDER MATTERS: (h1c) runs before (h1), because (h1)
    // legitimately stores an entry under wk's host key, and (h1c) proves no request on the
    // fixture host stored one there.

    test("(h1b) /wk/index.php on another host is NOT wk's page", async (exp) => {
        // Before SITEID-BINDING-1 this rendered wk's page on the fixture host (the old (h1)):
        // a dotted path skipped the rewrite, so `[siteId]=wk` came from the wire. Now the path
        // is `/wk/index.php` on the fixture tenant, which has no such route.
        const res = await get(`/${SCANNER_TENANT_ID}${SCANNER_SLUG}`);
        assert.equal(res.status, 307, "another tenant's id in the path must not select that tenant");
        assert.equal(res.header("location"), handoffLocation(exp, `/${SCANNER_TENANT_ID}${SCANNER_SLUG}?nf=1`));
        assert.ok(!res.body.includes(SCANNER_PAGE_TITLE), "wk's page body must not be served on the fixture host");
    });

    test("(h1c) /<wk's host>/index.php on another host is NOT wk's page, and mints nothing under wk's key", async (exp) => {
        // The host form of the same hole (staging finding C1): the copy served this way was
        // stored under the OTHER tenant's ISR key. Precondition, so a reorder fails loudly
        // instead of measuring (h1)'s legitimate entry:
        assert.deepEqual(
            await storedIsrEntries(SCANNER_TENANT_HOST),
            [],
            "an entry under wk's host already exists — (h1c) must run before (h1)",
        );
        const reqPath = `/${SCANNER_TENANT_HOST}${SCANNER_SLUG}`;
        const res = await get(reqPath);
        assert.equal(res.status, 307, "another tenant's host in the path must not select that tenant");
        assert.equal(res.header("location"), handoffLocation(exp, `${reqPath}?nf=1`));
        assert.ok(!res.body.includes(SCANNER_PAGE_TITLE), "wk's page body must not be served on the fixture host");
        // Positive control: the handoff WAS stored, under the REQUEST host's key…
        const own = (await storedIsrEntries()).find((e) => e.key === `${FIXTURE_HOST}${reqPath}`);
        assert.ok(own, `expected the 307 stored under ${FIXTURE_HOST}${reqPath}`);
        assert.equal(own.status, 307);
        // …and nothing under wk's host key.
        assert.deepEqual(await storedIsrEntries(SCANNER_TENANT_HOST), [], "the C1 copy was minted under wk's ISR key");
    });

    test("(h1) a tenant's dotted slug renders on ITS OWN host", async () => {
        // COUNTEREXAMPLE to a `.php` shield. Tenant `wk` has a persisted `.php` route
        // (`/index.php` — content/update.ts stores an unsanitised slug). On wk's own host the
        // middleware rewrites to `/<wk's host>/index.php`, the render resolves wk by domain
        // and its `/index.php` ROUTE#, and serves a real 200. A `.php` middleware shield —
        // the withdrawn mitigation d — would answer this with `404 no-store`, blocking
        // legitimate tenant content. This row is the executable proof that no `.php` shield is
        // admissible. It also proves dotted paths now reach their own host's tenant: before
        // SITEID-BINDING-1 this request passed through unrewritten (`[siteId]=index.php`).
        const { result: res, stats } = await readsDuring(() =>
            request({ port: server.port, path: SCANNER_SLUG, host: SCANNER_TENANT_HOST }),
        );
        assert.equal(res.status, 200, "the scanner-shaped-but-legitimate page must render, not be shielded");
        assert.match(res.header("content-type"), /text\/html/);
        assert.ok(res.body.includes(SCANNER_PAGE_TITLE), "the tenant's real page body must be served");
        // Load-bearing: the request reached the renderer read layer (tenant + route resolution),
        // which a door-level shield would have prevented (render === 0).
        assert.ok(stats.render > 0, "a legitimate `.php` route must reach the renderer read layer");
    });

    test("(h2) DEFERRED STATE: a scanner path with no route takes the ordinary not-found handoff (NOT shielded)", async (exp) => {
        // With mitigation d deferred there is no special-casing: a scanner-shaped path that does
        // NOT resolve to a route is handled exactly like any other unknown slug — the cacheable
        // `307 → ?nf=1` handoff (docs/caching-architecture.md § "How a 404 stays out of the
        // cache"). This is precisely the entry point of the flood the slice diagnosed: the junk
        // still mints a cacheable 307. Pinning it makes any future shield a DELIBERATE contract
        // change rather than a silent one, and documents that the flood is currently UNMITIGATED.
        //
        // The handoff happens on the REQUEST host's tenant: the middleware rewrites
        // `/wk/wp-login.php` to `/<fixture host>/wk/wp-login.php`, so the render's slugPath is
        // `/wk/wp-login.php` and the not-found handoff redirects to that slug + `?nf=1`
        // (notFoundOrHandoff uses the slug path, not the siteId-prefixed URL) — the ordinary
        // cacheable 307 that, in production, is the flood's ISR entry.
        const res = await get(`/${SCANNER_TENANT_ID}/wp-login.php`);
        assert.equal(res.status, 307, "an unshielded scanner path must take the ordinary not-found handoff");
        assert.equal(
            res.header("location"),
            handoffLocation(exp, `/${SCANNER_TENANT_ID}/wp-login.php?nf=1`),
            "the junk still mints an ordinary cacheable 307 — the flood is unmitigated (mitigation d deferred)",
        );
        // The load-bearing discriminator: the 307 is a CACHEABLE ISR entry (s-maxage=31536000),
        // exactly as row (d1) — this is the flood's entry point, NOT a no-store door-level shield.
        // A `.php` shield would instead answer `404 + no-store` here (what mitigation d was, before
        // (h1)'s counterexample deferred it).
        assert.match(res.header("cache-control"), new RegExp(S_MAXAGE), "the junk 307 is a stored, cacheable ISR entry");
        assert.doesNotMatch(res.header("cache-control"), /no-store/, "not a shield: the junk is not no-stored at the door");
    });

    // ── ROW (e) ─────────────────────────────────────────────────────────────────────────
    // § "Failed reads throw" + § "Probe: a read that fails AFTER tenant resolution":
    // 500, NO Cache-Control header at all, no ISR entry; recovery caches normally.
    // This is human decision CACHE-1-D4 — the row whose regression pins durable wrong
    // content at the edge for a year.

    // Bundle restatement ("absent-or-no-store", spec § 4.1 / § 8.1): the safety property is
    // "never stored", which the bundle proves on S3; the header itself may be absent or a
    // `no-store` value (open-next rewrites error responses, § 4.1 row e1).
    test("(e1) read failing after tenant resolution: 500 with NO Cache-Control, nothing stored", async (exp) => {
        // `D4_SLUG` is a page that genuinely EXISTS. That is the whole point: pre-D4 a
        // failed read on an existing page was indistinguishable from "missing" and produced
        // a stored 307. The tenant lookup stays healthy; only the reads after it fail.
        const key = `${FIXTURE_HOST}${D4_SLUG}`;
        stub.failContentReads(true);
        try {
            const res = await get(D4_SLUG);
            assert.equal(res.status, 500);
            if (exp === "absent-or-no-store") {
                const cc = res.header("cache-control");
                console.log(`  (e1/bundle) 500 Cache-Control: ${cc === undefined ? "(absent)" : `"${cc}"`}`);
                assert.ok(
                    cc === undefined || /\bno-store\b/.test(cc),
                    `a failed read must emit no Cache-Control or a no-store one; got "${cc}"`,
                );
                assert.deepEqual(s3PutsFor(key).map((e) => e.key), [], "a thrown render was PUT to the ISR bucket");
            } else {
                // next 16.4 answers this 500 with an explicit `private, no-cache, no-store, ...`
                // where 16.3 sent no header (OBSERVED 2026-10-26, next 16.4.3). Same rule as the
                // bundle branch above: absent or no-store, nothing storable.
                const cc = res.header("cache-control");
                assert.ok(
                    cc === undefined || /\bno-store\b/.test(cc),
                    `a failed read must emit no Cache-Control or a no-store one; got "${cc}"`,
                );
            }
            const stored = await storedIsrEntries();
            // Positive control: the detector sees the entries that DO exist…
            assert.ok(stored.length > 0, "storedIsrEntries() found nothing at all — detector broken");
            // …and none of them is the failed render.
            assert.equal(
                stored.find((e) => e.key === key),
                undefined,
                "a thrown render must never be stored",
            );
        } finally {
            stub.failContentReads(false);
        }
    });

    test("(e2) once reads recover, THE SAME path caches normally (MISS → HIT)", async () => {
        // The row that matters (§ "Failed reads throw", last row): pre-D4 the artefact
        // produced during a blip OUTLIVED it — the canonical URL kept serving a stored 307
        // (`x-nextjs-cache: HIT`) after DynamoDB was healthy again. A clean MISS here proves
        // nothing was left behind; the HIT proves normal caching resumed.
        const fresh = await get(D4_SLUG);
        assert.equal(fresh.status, 200);
        assert.equal(fresh.header("x-nextjs-cache"), "MISS");
        assert.match(fresh.body, /D4 Fixture Page/);
        const again = await get(D4_SLUG);
        assert.equal(again.header("x-nextjs-cache"), "HIT");
        assert.match(again.header("cache-control"), new RegExp(S_MAXAGE));
    });

    // ── ROW (f) ─────────────────────────────────────────────────────────────────────────
    // § "Measured: the origin behaviour this key depends on", row `?preview=true`.

    test("(f) ?preview=true: renders, no-store, never an ISR entry", async () => {
        const res = await get(`${PUBLISHED_SLUG}?preview=true`);
        assert.equal(res.status, 200);
        assert.match(res.header("cache-control"), /no-store/);
        assert.equal(res.header("x-nextjs-cache"), undefined);
        assert.match(res.body, /Published Fixture Page/);
    });

    // ── ROW (g) ─────────────────────────────────────────────────────────────────────────
    // § "/api/* Behavior" and § "Probe: a missing TABLE_NAME, and /api/posts".
    // Scope note: this pins the ORIGIN half — no `/api/*` response advertises itself as
    // storable. The edge half is the CloudFront `CachingDisabled` behavior in
    // infra/lib/renderer-hosting.ts, which is a `cdk synth` assertion (slice test-4).

    // MEASURED VALUE (2026-07-28, next 16.2.12): these routes emit NO Cache-Control header
    // at all. The assertion is "never advertises a storable lifetime" rather than "header is
    // absent" on purpose — adding an explicit `no-store` here would be a tightening, and a
    // characterization suite must not fail a change that strengthens the contract.
    const NOT_STORABLE = /s-maxage|max-age=[1-9]|public/;

    test("(g1) /api/posts (healthy) answers 200 and never advertises a storable lifetime", async () => {
        const res = await request({
            port: server.port,
            path: "/api/posts",
            host: FIXTURE_HOST,
            headers: { "x-tenant-id": TENANT_ID },
        });
        assert.equal(res.status, 200);
        assert.doesNotMatch(res.header("cache-control") ?? "", NOT_STORABLE);
        assert.ok(Array.isArray(JSON.parse(res.body).items));
    });

    test("(g2) /api/posts without x-tenant-id answers 400, not an empty 200 (CACHE-1-D4)", async () => {
        const res = await request({ port: server.port, path: "/api/posts", host: FIXTURE_HOST });
        assert.equal(res.status, 400);
        assert.doesNotMatch(res.header("cache-control") ?? "", NOT_STORABLE);
    });

    test("(g3) the referral Set-Cookie lives on an uncacheable /api response (cache-3 F8)", async () => {
        const res = await request({
            port: server.port,
            path: "/api/ref?v=partner-a",
            host: FIXTURE_HOST,
            method: "POST",
        });
        assert.equal(res.status, 204);
        assert.match(res.header("cache-control"), /no-store/);
        assert.ok(String(res.header("set-cookie")).includes("amodx_ref=partner-a"));
    });

    // ── ROW (g4) ─────────────────────────────────────────────────────────────────────────
    // STATIC-EP: the anonymous credential-free write proxies enforce the STATIC-1 isolation
    // barrier (`renderer/src/lib/origin-guard.ts` → `isFirstPartyWrite`) on the BUILT + served
    // path, not just as an imported function in the route-level unit test. The guard is exercised
    // inside the real `next start` artifact with real request headers, so a regression that removes
    // the guard call — or that admits an opaque-origin write — fails the serving contract.
    //
    // WHAT LAYER THIS IS (do not over-claim). After D-STATIC-EP-ORIGIN (human-ratified 2026-08-09)
    // the PRODUCTION barrier is the viewer-request CloudFront Function (`STATIC_EP_EDGE_ORIGIN_GUARD`
    // in `infra/lib/renderer-hosting.ts`), NOT this renderer guard: `Origin` is not forwarded to the
    // Lambda (CloudFront's 10-header ORP cap is full), so in production `origin-guard.ts` is inert
    // (belt-and-suspenders). This harness runs `next start` DIRECTLY, with no CloudFront in front of
    // it, so `Origin` DOES reach the renderer here and these cases exercise the belt-and-suspenders
    // renderer guard in the built artifact. They do NOT exercise the edge function. The edge guard's
    // in-repo proof is the infra decision-table assertion `(i)` in `amodx-stack.test.ts`; its true
    // end-to-end proof is the operator staging probe (a null-Origin POST to /api/contact through
    // CloudFront returns 403) — a NOT-RUN gate here (no AWS in this suite).
    //
    // A rejected write is a 403 with the guard's body BEFORE any tenant/backend hop. An
    // accepted (same-origin) write PASSES the guard and proceeds; in this hermetic harness
    // `API_URL` is unset, so it then fails downstream (config/parse) — the point is only that
    // it is NOT the guard's 403. Asserting `!== 403` isolates exactly the guard's own decision
    // without coupling to the proxy's downstream behaviour.
    const HARDENED_WRITE_PROXIES = ["/api/consent", "/api/contact", "/api/leads"];
    const REJECTION_BODY = "Cross-origin write rejected";

    // BUNDLE RESTATEMENT (ruling OPENNEXT1A-G4). The bundle target puts the emulated CloudFront
    // edge in front, and `Origin` / `Sec-Fetch-Site` are not on the RendererOriginPolicy
    // allowlist, so they never reach the Lambda — exactly production. With both absent the
    // renderer guard takes its allow branch (origin-guard.ts § "PRODUCTION STATUS — … INERT"),
    // and the route answers on its own: both rows pin that status (`behindEdgeStatus`, OBSERVED
    // 500 `Unexpected end of JSON input` — the test sends no body). REDUCED GUARANTEE, stated
    // plainly: the bundle suite proves the renderer behind the edge; the edge security rule (job
    // (d) of the viewer-request CloudFront Function, which the host does not emulate — spec § 8.1
    // item 5, phase 2) is proven by infra test (i), not here.
    for (const route of HARDENED_WRITE_PROXIES) {
        const rejectTitle = BUNDLE
            ? `(g4) ${route}: behind the edge the renderer guard is inert (Origin stripped); the edge 403 is proven by infra test (i), not here`
            : `(g4) ${route} REJECTS a null/cross-origin POST at the barrier (403)`;
        test(rejectTitle, async (exp) => {
            const res = await request({
                port: server.port,
                path: route,
                host: FIXTURE_HOST,
                method: "POST",
                // Opaque sandboxed-iframe shape: Origin: null, cross-site fetch metadata.
                headers: {
                    "content-type": "application/json",
                    origin: "null",
                    "sec-fetch-site": "cross-site",
                },
            });
            if (exp !== SAME) {
                assert.equal(res.status, exp.behindEdgeStatus, `${route}: pinned status behind the edge`);
                assert.doesNotMatch(res.body, new RegExp(REJECTION_BODY), `${route}: the renderer guard is inert behind the edge`);
                return;
            }
            assert.equal(res.status, 403, `${route} must reject the opaque-origin write`);
            assert.match(res.body, new RegExp(REJECTION_BODY));
        });

        test(`(g4) ${route} ACCEPTS a same-origin POST past the barrier (not 403)`, async (exp) => {
            const res = await request({
                port: server.port,
                path: route,
                host: FIXTURE_HOST,
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    origin: `https://${FIXTURE_HOST}`,
                    "sec-fetch-site": "same-origin",
                },
            });
            assert.notEqual(res.status, 403, `${route} must let the first-party write past the guard`);
            assert.doesNotMatch(res.body, new RegExp(REJECTION_BODY));
            if (exp !== SAME) assert.equal(res.status, exp.behindEdgeStatus, `${route}: pinned status behind the edge`);
        });
    }

    // ── ROW (journals) — bundle target only ─────────────────────────────────────────────
    // The adapter swallows S3, SQS and tag-table errors (a failed get is a MISS, a failed put a
    // log line), so a stub that could not answer would leave every row above green while the
    // cache was never exercised. This row turns any unmodelled call into a red row, and verifies
    // the S3 addressing assumption (path-style for the IP endpoint) on every run. Last on
    // purpose: it covers every call the rows above caused. On the `next` target the DynamoDB
    // half of this check stays in `after()`, where it has always been.
    if (BUNDLE) {
        test("(journals) every AWS call the bundle made was modelled by a stub, and S3 was addressed path-style", () => {
            assert.deepEqual(stubs.unhandled(), [], "unhandled stub operations");
            const s3 = stubs.s3.journal();
            assert.ok(s3.some((e) => e.op === "PutObject"), "no S3 PutObject at all — is the S3 cache wired?");
            assert.deepEqual(
                [...new Set(s3.map((e) => e.addressing))],
                ["path"],
                "the SDK addressed the S3 stub virtual-host style — implement the *.localhost shim (spec § 8.1 item 4)",
            );
        });
    }
});
