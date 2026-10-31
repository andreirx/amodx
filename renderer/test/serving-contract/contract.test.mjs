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
import { execFile } from "node:child_process";
import {
    CM1_BASELINE_DIR, captureCm1, compareTenant, maskBody, readCaptures, readClientModules, splitFlight, writeCaptures,
} from "./cm1-byte-identity.mjs";
import {
    CM1, CM1_STALE_SLUG, CF1, CIP1B, ITEMS, CIG1_COMMERCE_HIDDEN,
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

    // ── ROWS (cm1-*) — CM1-BYTE-IDENTITY Layer 1 + the catalog surface rows (slice cat-mode-1) ──────────
    // Spec docs/slices/catalog-mode-1.md § 3.6 (Layer 1, the gate; comparison contract amended by § 8.19 "CM1-A1")
    // and § 3.2 (the surface table). `next` target only: the identity baseline was captured with `next start`
    // (cm1-byte-identity/README.md). A failing `cm1-identity-*` row means a tenant WITHOUT catalogMode now renders
    // different bytes — read the header of cm1-byte-identity.mjs before touching the baseline.
    // `CM1_CAPTURE_DIR=<dir>` also writes this run's capture set (same layout as the baseline).
    if (!BUNDLE) {
        let cm1Candidate;
        let cm1Baseline;
        /** This run's capture set — every CM1 tenant, taken once, shared by the rows below. */
        async function cm1Set() {
            if (!cm1Candidate) {
                const buildId = (await readFile(path.join(RENDERER_DIR, ".next", "BUILD_ID"), "utf8")).trim();
                const clientModules = await readClientModules(RENDERER_DIR);
                const captures = await captureCm1(request, server.port, ["commerce", "content", "catalog"]);
                cm1Candidate = { buildId, clientModules, captures };
                if (process.env.CM1_CAPTURE_DIR) await writeCaptures(process.env.CM1_CAPTURE_DIR, cm1Candidate);
            }
            return cm1Candidate;
        }
        const cm1Base = async () => (cm1Baseline ??= await readCaptures(CM1_BASELINE_DIR));
        const cm1Body = async (tenant, p) => (await cm1Set()).captures.find((c) => c.tenant === tenant && c.path === p);

        for (const tenantKey of ["commerce", "content"]) {
            test(`(cm1-identity-${tenantKey}) a tenant without catalogMode (${tenantKey}) answers every § 3.6 URL as the de4ad52 baseline did, under the CM1-A1 canonicalisations`, async () => {
                const rows = compareTenant(await cm1Base(), await cm1Set(), tenantKey);
                // The per-URL canonicalisation counts (CM1-A1: "each with its count reported per compared URL").
                for (const r of rows) {
                    console.log(`  (cm1-identity-${tenantKey}) ${r.same ? "same" : "DIFF"} ${r.path} baseline ${JSON.stringify(r.base)} candidate ${JSON.stringify(r.cand)}`);
                }
                assert.deepEqual(rows.filter((r) => !r.same).map((r) => `${r.path}: ${r.why}`), [], `${tenantKey} tenant bytes changed`);
            });
        }

        // The bound mutation (CM1-A1 step 3, review-0 CM1-ORACLE): rewiring which component an element mounts MUST
        // change the canonical body — both by pointing the element at another client row (the reviewer's in-memory
        // edit: AddToCartButton's use → SearchBar's row) and by pointing the client row at another module.
        test("(cm1-rewire) rewiring one client reference in a captured commerce body turns the comparison red", async () => {
            const set = await cm1Set();
            const page = await cm1Body("commerce", "/product/variant-rug");
            const rows = splitFlight(page.body).flight.split("\n");
            const rowOf = (exportName) => {
                const row = rows.find((r) => new RegExp(`^[0-9a-f]+:I\\[\\d+,.*,"${exportName}"`).test(r));
                assert.ok(row, `no client row exports ${exportName}`);
                const [, id, moduleId] = /^([0-9a-f]+):I\[(\d+),/.exec(row);
                return { id, moduleId };
            };
            const cart = rowOf("AddToCartButton");
            const search = rowOf("SearchBar");
            const original = maskBody(page.body, set).masked;
            // (a) the element's use: `\"$L<cart>\"` → `\"$L<search>\"` inside the escaped flight chunk.
            const useNeedle = `\\"$L${cart.id}\\"`;
            assert.ok(page.body.includes(useNeedle), "AddToCartButton's use not found in the raw body");
            const rewiredUse = page.body.split(useNeedle).join(`\\"$L${search.id}\\"`);
            // (b) the client row's module: `<cart>:I[<cart module>,` → `<cart>:I[<search module>,`.
            const rowNeedle = `${cart.id}:I[${cart.moduleId},`;
            assert.ok(page.body.includes(rowNeedle), "AddToCartButton's client row not found in the raw body");
            const rewiredRow = page.body.replace(rowNeedle, `${cart.id}:I[${search.moduleId},`);
            for (const [name, body] of [["element use", rewiredUse], ["client row module", rewiredRow]]) {
                assert.notEqual(body, page.body, `${name}: the mutation did not change the raw body`);
                assert.notEqual(maskBody(body, set).masked, original, `${name}: the canonical body did not change`);
            }
            console.log(`  (cm1-rewire) AddToCartButton row ${cart.id} → SearchBar row ${search.id} / module ${search.moduleId}: both mutations change the canonical body (red)`);
        });

        // Positive control for the detector: the same comparison MUST see the catalog tenant change (the baseline
        // printed " USD" with no amount and an `offers` block for a priceless product).
        test("(cm1-control) the identity detector reports the catalog tenant's product page and feed as changed", async () => {
            const changed = compareTenant(await cm1Base(), await cm1Set(), "catalog").filter((r) => !r.same).map((r) => r.path);
            assert.ok(changed.includes("/product/oak-plank"), `detector saw no product change: ${changed.join("; ")}`);
            assert.ok(changed.includes("/openai-feed"), "detector saw no feed change");
        });

        /** Literal terminators of a price / availability / ordering surface (spec § 3.2 closing rule), plus the
         *  legacy product's stored amounts and Paddle id (defence-in-depth witness, cycle 2). */
        const FORBIDDEN = [
            "offers", "priceCurrency", "\"price\"", "USD", "Buy", "Add to Cart", "Pre-order", "Out of Stock", "In Stock",
            "InStock", "OutOfStock", "PreOrder", "availability", "in_stock", "out_of_stock", "preorder", "Volume Pricing",
            "99.00", "79.00", "69.00", "pri_cm1_legacy", "paddle_button",
        ];
        const hits = (body, terms) => terms.filter((t) => body.includes(t));
        /** The showcase plugin's price line element (`CategoryShowcaseRender.tsx`), as React renders it. */
        const PRICE_LINE = '<p class="text-sm text-center text-primary font-medium">';
        const productJsonLd = (body) => {
            // The JSON-LD is emitted by next/script, so it travels in the flight payload (pre-existing).
            const m = /"id":"product-schema","type":"application\/ld\+json","dangerouslySetInnerHTML":\{"__html":("(?:[^"\\]|\\.)*")\}/.exec(splitFlight(body).flight);
            assert.ok(m, "no product JSON-LD");
            return JSON.parse(JSON.parse(m[1]));
        };

        test("(cm1-catalog-product) catalog product pages: Product JSON-LD without offers, no price/currency/availability/Buy even with legacy price data, a 3-option presenter, the attributes; no presenter under commerce", async () => {
            const page = await cm1Body("catalog", "/product/oak-plank");
            assert.equal(page.status, 200);
            assert.deepEqual(hits(page.body, FORBIDDEN), []);
            const jsonLd = productJsonLd(page.body);
            assert.equal(jsonLd["@type"], "Product");
            assert.equal(jsonLd.name, "Oak Plank");
            assert.ok(!("offers" in jsonLd), "a catalog Product carries no offers");
            const radios = page.body.match(/<input type="radio" class="peer sr-only" name="catalog-option-format" value="[^"]+"\/>/g) ?? [];
            assert.deepEqual(radios.map((r) => r.match(/value="([^"]+)"/)[1]), ["120x20", "140x20", "180x20"]);
            for (const [k, v] of [["unitate", "mp"], ["împachetare", "2,2 mp/cutie"], ["comandă minimă", "10 mp"]]) {
                assert.ok(page.body.includes(`<dt class="text-muted-foreground">${k}</dt><dd class="font-medium">${v}</dd>`), `attribute ${k}`);
            }
            // Stored availability out_of_stock and no image: still no availability surface, no presenter.
            const ash = await cm1Body("catalog", "/product/ash-plank");
            assert.equal(ash.status, 200);
            assert.deepEqual(hits(ash.body, FORBIDDEN), []);
            assert.doesNotMatch(ash.body, /catalog-option-/);
            // Legacy data (price, salePrice, tiers, Paddle link, preorder stored): every price/offer row still absent.
            const legacy = await cm1Body("catalog", "/product/legacy-plank");
            assert.equal(legacy.status, 200);
            assert.deepEqual(hits(legacy.body, FORBIDDEN), []);
            assert.ok(!("offers" in productJsonLd(legacy.body)), "legacy catalog product: no offers");
            // Legacy by-ID page of the imageless Ash (spec § 3.2.6, CM-D7 guards `ProductByIdPage.tsx`): no main <img>,
            // no JSON-LD `image`, no og:image. Positive control: the Oak legacy page has all three.
            const ashLegacy = await cm1Body("catalog", "/products/e0000000-0000-4000-8000-000000000002");
            assert.equal(ashLegacy.status, 200);
            assert.ok(ashLegacy.body.includes("Ash Plank"), "the legacy page renders the product");
            assert.ok(!ashLegacy.body.includes('alt="Ash Plank"'), "imageless product: no main <img>");
            assert.ok(!("image" in productJsonLd(ashLegacy.body)), "imageless product: no JSON-LD image key");
            assert.ok(!ashLegacy.body.includes('property="og:image"'), "imageless product: no og:image");
            const oakLegacy = await cm1Body("catalog", "/products/e0000000-0000-4000-8000-000000000001");
            assert.ok(oakLegacy.body.includes('alt="Oak Plank"'), "positive control: Oak's main <img>");
            assert.deepEqual(productJsonLd(oakLegacy.body).image.slice(0, 1), ["https://img.serving-contract.test/oak-1.jpg"], "positive control: JSON-LD image");
            assert.ok(oakLegacy.body.includes('property="og:image"'), "positive control: og:image");
            // Under commerce the presenter is not rendered, although that product has a 3-option group.
            const commerceVariants = await cm1Body("commerce", "/product/variant-rug");
            assert.equal(commerceVariants.status, 200);
            assert.doesNotMatch(commerceVariants.body, /catalog-option-/);
        });

        test("(cm1-catalog-listings) catalog shop, category, search, legacy pages and showcase: no price, currency, availability or Buy, also for the legacy-priced product", async () => {
            for (const p of ["/", "/shop", "/category/floors", "/search?q=plank",
                "/products/e0000000-0000-4000-8000-000000000001", "/products/e0000000-0000-4000-8000-000000000002",
                "/products/e0000000-0000-4000-8000-000000000003"]) {
                const page = await cm1Body("catalog", p);
                assert.equal(page.status, 200, p);
                assert.deepEqual(hits(page.body, FORBIDDEN), [], p);
                assert.ok(page.body.includes("Plank"), `${p} lists a product`);
            }
            for (const p of ["/shop", "/category/floors", "/search?q=plank"]) {
                assert.ok((await cm1Body("catalog", p)).body.includes("Legacy Plank"), `${p} lists the legacy-priced product`);
            }
            // The visitor's own `?availability=in_stock` is echoed in the flight payload; nothing else may match.
            const filtered = await cm1Body("catalog", "/shop?availability=in_stock");
            assert.deepEqual(hits(filtered.body, FORBIDDEN.filter((t) => t !== "availability" && t !== "in_stock")), []);
            assert.ok(filtered.body.includes("Ash Plank"), "the availability filter is ignored on a catalog site");
            assert.doesNotMatch(filtered.body, />All Products</);
        });

        // CM1-SHOWCASE-CLOSURE, server path: the category lookup MISSES (slug unknown to the stub) and the block's
        // authored `prefetchedProducts` holds a priced, out-of-stock item. The renderer injects `_catalogMode` anyway
        // and reduces the stale entries to display fields (cycle 3), so neither the HTML nor the RSC payload carries a
        // price, currency or availability. Commerce = positive control (same block renders price line and overlay).
        test("(cm1-catalog-showcase-stale) a showcase whose lookup misses, with stale authored prefetched data: no price or stock overlay on a catalog site", async () => {
            const catalog = await cm1Body("catalog", CM1_STALE_SLUG);
            assert.equal(catalog.status, 200);
            const { html, flight } = splitFlight(catalog.body);
            assert.ok(html.includes("Stale Item"), "the stale product is rendered (the plugin got the data)");
            assert.deepEqual(hits(html, ["12.00", "USD", "Out of Stock"]), [], "catalog: price/currency/overlay in the HTML");
            assert.ok(!catalog.body.includes("Out of Stock"), "catalog: overlay text anywhere in the body");
            assert.ok(flight.includes('"_catalogMode":true'), "the renderer injected _catalogMode on a lookup miss");
            assert.ok(!html.includes(PRICE_LINE), "catalog: no showcase price line element");
            assert.deepEqual(hits(flight, ['"availability"', '"currency"', '"price"', "12.00", "out_of_stock"]), [],
                "catalog: the stale entries reach the payload as display fields only");
            const commerce = await cm1Body("commerce", CM1_STALE_SLUG);
            assert.equal(commerce.status, 200);
            const commerceHtml = splitFlight(commerce.body).html;
            assert.ok(commerceHtml.includes("12.00") && commerceHtml.includes("Out of Stock"), "positive control: commerce renders price and overlay");
            assert.ok(commerceHtml.includes(PRICE_LINE), "positive control: the price line element literal is right");
            assert.ok(!commerce.body.includes("_catalogMode"), "commerce attrs carry no _catalogMode key");
        });

        // CM1-SHOWCASE-CLOSURE, browser path: the fallback fetch runs only in a browser, so it is exercised in a
        // child process that renders the built plugin into jsdom with a mocked fetch (cm1-showcase-dom.mjs).
        test("(cm1-catalog-showcase-dom) the showcase's browser fallback and stale prefetch: no price, currency or overlay under _catalogMode; both shown without it", async () => {
            const out = await new Promise((resolve, reject) => {
                execFile(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(RENDERER_DIR, "test", "serving-contract", "cm1-showcase-dom.mjs")],
                    { env: { PATH: process.env.PATH, HOME: process.env.HOME }, timeout: 60_000 },
                    (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout)));
            });
            const r = JSON.parse(out.trim().split("\n").pop());
            console.log(`  (cm1-catalog-showcase-dom) ${JSON.stringify(r)}`);
            assert.equal(r.fallbackCatalog.fetched, 1, "the fallback fetch ran");
            for (const name of ["fallbackCatalog", "staleCatalog"]) {
                assert.deepEqual(r[name], { ...r[name], title: true, price: false, currency: false, outOfStock: false }, name);
            }
            for (const name of ["fallbackCommerce", "staleCommerce"]) {
                assert.deepEqual(r[name], { ...r[name], title: true, price: true, currency: true, outOfStock: true }, `${name} (positive control)`);
            }
        });

        test("(cm1-catalog-cart) /cart and /checkout on a catalog site: the not-found handoff, then 404", async () => {
            for (const p of ["/cart", "/checkout"]) {
                const first = await cm1Body("catalog", p);
                assert.equal(first.status, 307, p);
                const res = await request({ port: server.port, path: `${p}?nf=1`, host: CM1.catalog.host });
                assert.equal(res.status, 404, `${p}?nf=1`);
            }
        });

        // ── ROWS (cig1-*) — a hidden product's page (slice cat-image-gate-1 § 3 item 5) ───────────────────────────
        // A catalog site's non-active product answers exactly as a missing product — also with `?preview=` (that flag is
        // not authenticated); a non-catalog site is unchanged. Active products' pages and listings: rows
        // `cm1-catalog-product`, `cf1-preserve` (unchanged).
        const cigGet = (tenant, p) => request({ port: server.port, path: p, host: CM1[tenant].host });

        test("(cig1-catalog-hidden) a catalog draft product page: the cacheable handoff then 404 no-store, and 404 with ?preview=true — the answers of a missing product", async () => {
            for (const slug of ["placa-ciorna", "cig1-no-such-product"]) {
                const first = await cigGet("catalog", `/product/${slug}`);
                assert.equal(first.status, 307, slug);
                assert.equal(first.header("location"), `/product/${slug}?nf=1`, slug);
                const nf = await cigGet("catalog", `/product/${slug}?nf=1`);
                assert.equal(nf.status, 404, `${slug}?nf=1`);
                assert.match(nf.header("cache-control"), /no-store/);
                const preview = await cigGet("catalog", `/product/${slug}?preview=true`);
                assert.equal(preview.status, 404, `${slug}?preview=true`);
                assert.ok(!preview.body.includes("Placa Ciorna"), `${slug}?preview=true leaks the hidden title`);
            }
        });

        test("(cig1-commerce-hidden) a commerce draft product page is unchanged: the handoff then 404 without preview; 200 with ?preview=true", async () => {
            const p = `/product/${CIG1_COMMERCE_HIDDEN.slug}`;
            const first = await cigGet("commerce", p);
            assert.equal(first.status, 307);
            assert.equal((await cigGet("commerce", `${p}?nf=1`)).status, 404);
            const preview = await cigGet("commerce", `${p}?preview=true`);
            assert.equal(preview.status, 200);
            assert.ok(preview.body.includes(CIG1_COMMERCE_HIDDEN.title));
        });

        test("(cm1-catalog-sitemap) a catalog site is indexable: its category and products are in the sitemap", async () => {
            const map = await cm1Body("catalog", "/sitemap.xml");
            assert.equal(map.status, 200);
            for (const p of ["/category/floors", "/product/oak-plank", "/product/ash-plank", "/product/legacy-plank"]) {
                assert.ok(map.body.includes(`<loc>https://${CM1.catalog.host}${p}</loc>`), p);
            }
        });

        test("(cm1-catalog-feed) the OpenAI feed is withheld (404) for a catalog site", async () => {
            assert.equal((await cm1Body("catalog", "/openai-feed")).status, 404);
        });

        // ── ROWS (cf1-*) — storefront filters of a catalog site (slice cat-facets-1-impl) ───────────────────────
        // Spec docs/slices/cat-facets-1.md § 5.5, amended by § 13 (the facet set is data-driven: the producer, the
        // variant values, then every `attributes` key that passes the repeat rule) and by the operator rulings on
        // review-0 (docs/slices/cat-facets-1-impl.md): (1) a selected key is applied and shown whether or not it is
        // offered; (2) URL identity — `producator`, `varianta` for the fixed facets, `a.<key>` for EVERY attribute key.
        // Fixtures: `CF1` block of fixtures.mjs, on the catalog tenant. `next` target only, like the cm1 rows whose
        // tenant they share. A failing row here is a change of the filter contract — read the spec section the row
        // names before changing an assertion.
        const cf1Get = (p) => request({ port: server.port, path: p, host: CM1.catalog.host });
        const fParam = (pairs) => `?f=${encodeURIComponent(new URLSearchParams(pairs).toString())}`;
        const unescapeHtml = (t) => t.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
        /** The HTML part of a response (the flight payload repeats the same strings inside scripts). */
        const htmlOf = (body) => splitFlight(body).html;
        /** Card slugs in page order (`ProductCard` links). */
        const cardSlugs = (body) => [...htmlOf(body).matchAll(/href="\/product\/([^"]+)"/g)].map((m) => m[1]);
        const totalOf = (body) => Number(/data-facet-total="(\d+)"/.exec(htmlOf(body))?.[1]);
        /** One facet's value rows: [{ state, value, count, href }]; `null` when the facet is not in the HTML. */
        function facetRows(body, id) {
            const html = htmlOf(body);
            const at = html.indexOf(`data-facet="${id}"`);
            if (at < 0) return null;
            const section = html.slice(at, html.indexOf("</details>", at));
            return [...section.matchAll(/<(a|span)((?: [\w-]+="[^"]*")*) data-facet-value="([\w-]+)">(.*?)<\/\1>/g)].map((m) => {
                const text = unescapeHtml(m[4]).replace(/^✓ /, "");
                const [, value, count] = /^(.*) \((\d+)\)$/s.exec(text);
                const href = /href="([^"]*)"/.exec(m[2])?.[1]?.replace(/&amp;/g, "&") ?? null;
                return { state: m[3], value, count: Number(count), href };
            });
        }
        const plainRows = (rows) => rows.map(({ state, value, count }) => ({ state, value, count }));
        /** Selection chips: [{ text, href }]. */
        const chipLinks = (body) => [...htmlOf(body).matchAll(/<li><(?:a|span)((?: [\w-]+="[^"]*")*) class="inline-block rounded-full[^"]*"[^>]*>(.*?)<\/(?:a|span)><\/li>/g)]
            .map((m) => ({ text: unescapeHtml(m[2]).replace(/ ×$/, ""), href: /href="([^"]*)"/.exec(m[1])?.[1]?.replace(/&amp;/g, "&") ?? null }));
        const chipsOf = (body) => chipLinks(body).map((c) => c.text);
        const allHrefs = (body) => [...htmlOf(body).matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
        /** The filter panel's own links (every `rel="nofollow"` anchor). */
        const panelHrefs = (body) => [...htmlOf(body).matchAll(/<a href="([^"]*)" rel="nofollow"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
        /** The pager's Previous / Next hrefs (`Pagination`, existing English copy). */
        const pagerHref = (body, label) => new RegExp(`<a[^>]*href="([^"]*)"[^>]*>${label}</a>`).exec(htmlOf(body))?.[1]?.replace(/&amp;/g, "&") ?? null;
        const bytes = (t) => Buffer.byteLength(t, "utf8");
        const catalogProducts = ITEMS.filter((i) => i.PK === `TENANT#${CM1.catalog.id}` && i.SK.startsWith("PRODUCT#"));
        const today = new Date().toISOString().split("T")[0];
        /** `isProductAvailable` (lib/dynamo.ts), restated for the model of the two existing reads. */
        const available = (p) => !(p.availableFrom && today < p.availableFrom) && !(p.availableUntil && today > p.availableUntil);
        /** The shop membership and order of `getActiveProducts`: `status = active`, available, stable `sortOrder` sort
         *  over the SK order DynamoDB returns (`PRODUCT#<id>`). */
        const shopModel = (pred = () => true) => catalogProducts.filter((p) => p.status === "active" && available(p) && pred(p))
            .sort((a, b) => (a.SK < b.SK ? -1 : 1)).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((p) => p.slug);
        /** The category membership and order of `getProductsByCategory`: the category's CATPROD# cards in SK order, its
         *  status rule, `isProductAvailable` on the card, then the stable `sortOrder` sort. */
        const categoryModel = (categoryId, pred = () => true) => ITEMS.filter((i) => i.PK === `TENANT#${CM1.catalog.id}` && i.SK.startsWith(`CATPROD#${categoryId}#`))
            .sort((a, b) => (a.SK < b.SK ? -1 : 1))
            .filter((c) => (!c.status || c.status === "active") && available(c) && pred(c))
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
            .map((c) => c.slug);
        /** Every card of a listing, following the rendered Next links; returns the pages' bodies too. */
        async function allPages(path) {
            const pages = [];
            for (let next = path; next; next = pagerHref(pages[pages.length - 1].body, "Next")) {
                const res = await cf1Get(next);
                assert.equal(res.status, 200, next);
                pages.push({ path: next, body: res.body });
                assert.ok(pages.length < 10, "pager loop");
            }
            return pages;
        }
        const serie = (n) => CF1.longValues[n - 1];

        test("(cf1-filter) /shop?f=<producator=BOEN>: 200, no-store, exactly the BOEN cards, total line = their count", async () => {
            const res = await cf1Get(`/shop${fParam([["producator", "BOEN"]])}`);
            assert.equal(res.status, 200);
            assert.match(res.header("cache-control"), /no-store/);
            // Active BOEN products in id order; the status-less legacy BOEN product is not on the shop page.
            assert.deepEqual(cardSlugs(res.body), ["stejar-natur", "stejar-rustic", "frasin-alb"]);
            assert.equal(totalOf(res.body), 3);
            assert.match(htmlOf(res.body), />3 produse</);
            assert.deepEqual(chipsOf(res.body), ["Producător: BOEN"]);
        });

        test("(cf1-counts) /category/cf1-boen?f=<a.colecție=Planks 138 mm>: the disjunctive counts of § 4.1, exact", async () => {
            const res = await cf1Get(`/category/cf1-boen${fParam([["a.colecție", "Planks 138 mm"]])}`);
            assert.equal(res.status, 200);
            assert.deepEqual(cardSlugs(res.body), ["stejar-natur", "stejar-rustic"]);
            assert.equal(totalOf(res.body), 2);
            // The selected facet's counts ignore its own selection.
            assert.deepEqual(plainRows(facetRows(res.body, "a.colecție")), [
                { state: "link", value: "Castle planks 209 mm", count: 2 },
                { state: "selected", value: "Planks 138 mm", count: 2 },
            ]);
            // Every other facet is counted under colecție = Planks 138 mm; a zero count is disabled.
            assert.deepEqual(plainRows(facetRows(res.body, "a.Wood")), [
                { state: "zero", value: "Ash", count: 0 },
                { state: "link", value: "Oak", count: 2 },
                { state: "zero", value: "Walnut", count: 0 },
            ]);
            // `#1` is not a value; the `,` label is; the heading is the group name.
            assert.deepEqual(plainRows(facetRows(res.body, "varianta")), [
                { state: "link", value: "13,2x181x2200 mm", count: 1 },
                { state: "link", value: "14x138x2200 mm", count: 2 },
            ]);
            assert.match(htmlOf(res.body), /data-facet="varianta"[^>]*><summary[^>]*>Format<\/summary>/);
            assert.doesNotMatch(htmlOf(res.body), /#1 \(/);
            // § 13 on the base set: `Article no.` (rule ii) and `Nordic swan` (rule i) not offered; `Certificates`,
            // `unitate` and the producer (one value on every product) hidden. Order: variant, then keys by holders.
            for (const hidden of ["a.Article no.", "a.Nordic swan", "a.Certificates", "a.unitate", "producator"]) assert.equal(facetRows(res.body, hidden), null, hidden);
            const order = [...htmlOf(res.body).matchAll(/data-facet="([^"]+)"/g)].map((m) => m[1]);
            assert.deepEqual(order, ["varianta", "a.colecție", "a.Wood"]);
        });

        test("(cf1-not-stored) the cf1-filter URL twice: both no-store, neither an ISR entry", async () => {
            for (let i = 0; i < 2; i++) {
                const res = await cf1Get(`/shop${fParam([["producator", "BOEN"]])}`);
                assert.equal(res.status, 200);
                assert.match(res.header("cache-control"), /no-store/);
                assert.equal(res.header("x-nextjs-cache"), undefined, "a filtered view is never an ISR entry");
            }
        });

        test("(cf1-bare-intact) bare /shop after a filtered request: the stored entry is a HIT with the full count and page 1", async () => {
            await cf1Get("/shop");                                        // warm (MISS or HIT)
            await cf1Get(`/shop${fParam([["producator", "ITC"]])}`);
            const res = await cf1Get("/shop");
            assert.equal(res.status, 200);
            assert.equal(res.header("x-nextjs-cache"), "HIT");
            const expected = shopModel();
            assert.equal(expected.length, 42);
            assert.deepEqual(cardSlugs(res.body), expected.slice(0, 24));
            assert.equal(totalOf(res.body), 42);
            assert.deepEqual(chipsOf(res.body), []);
        });

        test("(cf1-empty) a selection that matches nothing, and an unknown value: 200, the empty-result copy, the selection shown", async () => {
            const none = await cf1Get(`/shop${fParam([["producator", "BOEN"], ["a.unitate", "ml"]])}`);
            assert.equal(none.status, 200);
            assert.match(htmlOf(none.body), /Niciun produs nu corespunde filtrelor alese\./);
            assert.match(htmlOf(none.body), /data-facet-empty.*Șterge filtrele/s);
            assert.deepEqual(cardSlugs(none.body), []);
            assert.deepEqual(chipsOf(none.body), ["Producător: BOEN", "unitate: ml"]);
            const unknown = await cf1Get(`/shop${fParam([["producator", "Nimeni"]])}`);
            assert.equal(unknown.status, 200);
            assert.match(htmlOf(unknown.body), /Niciun produs nu corespunde filtrelor alese\./);
            assert.deepEqual(chipsOf(unknown.body), ["Producător: Nimeni"]);
            assert.ok(facetRows(unknown.body, "producator").some((r) => r.state === "selected" && r.value === "Nimeni" && r.count === 0 && r.href === "/shop"));
        });

        test("(cf1-roundtrip) a value with , / ² and diacritics: the link the panel emits selects exactly that value", async () => {
            const bare = await cf1Get("/category/cf1-itc");
            const row = facetRows(bare.body, "a.Pile weight").find((r) => r.value === CF1.roundtripValue);
            assert.ok(row && row.state === "link" && row.count === 2, JSON.stringify(row));
            const res = await cf1Get(row.href);
            assert.equal(res.status, 200);
            assert.deepEqual(chipsOf(res.body), [`Pile weight: ${CF1.roundtripValue}`]);
            assert.deepEqual(cardSlugs(res.body), ["mocheta-arc", "mocheta-shell"]);
            assert.ok(facetRows(res.body, "a.Pile weight").some((r) => r.state === "selected" && r.value === CF1.roundtripValue));
            // § 13 rule (iii): `Color` has 41 distinct values on this base set — not offered.
            assert.equal(facetRows(res.body, "a.Color"), null);
        });

        test("(cf1-order) the catalog category page lists the CATPROD#-path membership in the CATPROD#-path order (§ 3.3 B)", async () => {
            const expected = categoryModel("cf1-boen");
            assert.deepEqual(expected, ["stejar-natur", "stejar-rustic", "frasin-alb", "nuc-vechi"]);
            const res = await cf1Get("/category/cf1-boen");
            assert.equal(res.status, 200);
            assert.deepEqual(cardSlugs(res.body), expected);
        });

        test("(cf1-preserve) both listing branches, over every rendered page: the existing reads' membership and order — draft, future-start and expired products out, nonzero sortOrder last", async () => {
            const never = ["placa-ciorna", "placa-viitoare", "placa-expirata"];
            for (const [path, expected] of [
                ["/category/cf1-many", categoryModel("cf1-many")],
                [`/shop${fParam([["producator", "KRONO"]])}`, shopModel((p) => p.brand === "KRONO")],
            ]) {
                // The models are discriminating: 30 listed, the two lowest ids (sortOrder 2 and 1) last, three never.
                assert.equal(expected.length, 30, path);
                assert.deepEqual(expected.slice(-2), ["placa-02", "placa-01"], path);
                for (const slug of never) assert.ok(!expected.includes(slug), `${path}: model lists ${slug}`);
                const pages = await allPages(path);
                assert.equal(pages.length, 2, path);
                assert.deepEqual(pages.flatMap((p) => cardSlugs(p.body)), expected, path);
                assert.equal(totalOf(pages[0].body), 30, path);
            }
        });

        test("(cf1-pager) a filtered result over 24 products, followed through the rendered pager: exact cards, totals, kept selection, page 1 on change, hrefs ≤ 6,144 bytes", async () => {
            const selected = [1, 2, 3, 4].map(serie);
            const path = `/category/cf1-many${fParam(selected.map((v) => ["a.Serie", v]))}`;
            const expected = categoryModel("cf1-many", (c) => {
                const p = catalogProducts.find((q) => q.id === c.id);
                return selected.includes(p.attributes.find((a) => a.key === "Serie").value);
            });
            assert.equal(expected.length, 28);
            const pages = await allPages(path);
            assert.equal(pages.length, 2);
            assert.deepEqual(cardSlugs(pages[0].body), expected.slice(0, 24));
            assert.deepEqual(cardSlugs(pages[1].body), expected.slice(24));
            for (const { path: p, body } of pages) {
                assert.equal(totalOf(body), 28, p);
                assert.equal(chipsOf(body).length, 4, `${p}: the selection is kept on every page`);
                for (const href of allHrefs(body)) assert.ok(bytes(href) <= 6144, `${p}: href of ${bytes(href)} bytes`);
            }
            // The pager links carry the same `f` and only change `page`.
            const next = pagerHref(pages[0].body, "Next");
            const prev = pagerHref(pages[1].body, "Previous");
            const fOf = (h) => new URL(h, "http://x").searchParams.get("f");
            assert.equal(fOf(next), fOf(path));
            assert.equal(new URL(next, "http://x").searchParams.get("page"), "2");
            assert.equal(fOf(prev), fOf(path));
            assert.ok(bytes(next) <= 6144 && bytes(prev) <= 6144);
            // From page 2 every panel link (add, remove, chips, clear) drops `page`: a filter change returns to page 1.
            const links = panelHrefs(pages[1].body);
            assert.ok(links.length > 5);
            for (const href of links) assert.ok(!new URL(href, "http://x").searchParams.has("page"), href);
            const removeFirst = chipLinks(pages[1].body)[0].href;
            const afterRemove = await cf1Get(removeFirst);
            assert.equal(totalOf(afterRemove.body), 21);
            assert.deepEqual(cardSlugs(afterRemove.body), expected.filter((slug) => {
                const p = catalogProducts.find((q) => q.slug === slug);
                return p.attributes.find((a) => a.key === "Serie").value !== serie(1);
            }).slice(0, 21));
        });

        test("(cf1-pager-guard) a pager link that would exceed 6,144 bytes is not rendered; the same selection on page 2 renders it", async () => {
            // A selection whose canonical href is 6,125 bytes (it fits: 6,125 + 16 ≤ 6,144): Serie 1–4 plus a stale value
            // padded to length. On `page=99999999999999999999` the Previous link would end `&page=100000000000000000000`
            // (6,152 bytes) — the measured guard drops it. On page 2, Previous ends `&page=1` (6,132 bytes) and renders.
            const base = "/category/cf1-many";
            const href = (pad) => `${base}?f=${encodeURIComponent(new URLSearchParams([1, 2, 3, 4].map((n) => ["a.Serie", serie(n)]).concat([["a.Serie", "Z" + "z".repeat(pad)]])).toString())}`;
            const pad = 6125 - bytes(href(0));
            assert.ok(pad > 0);
            const fitting = href(pad);
            assert.equal(bytes(fitting), 6125);
            const huge = await cf1Get(`${fitting}&page=99999999999999999999`);
            assert.equal(huge.status, 200);
            assert.equal(chipsOf(huge.body).length, 5, "the selection was applied (not rejected as too long)");
            assert.equal(pagerHref(huge.body, "Previous"), null, "the over-budget Previous link is not rendered");
            for (const h of allHrefs(huge.body)) assert.ok(bytes(h) <= 6144, `href of ${bytes(h)} bytes`);
            const page2 = await cf1Get(`${fitting}&page=2`);
            const prev = pagerHref(page2.body, "Previous");
            assert.ok(prev, "control: the Previous link renders when it fits");
            assert.equal(bytes(prev), 6132);
        });

        test("(cf1-legacy) the status-less legacy product: on the category page, not on the shop page", async () => {
            assert.ok(cardSlugs((await cf1Get("/category/cf1-boen")).body).includes("nuc-vechi"));
            const shopSlugs = (await allPages("/shop")).flatMap((p) => cardSlugs(p.body));
            assert.equal(shopSlugs.length, 42);
            assert.ok(!shopSlugs.includes("nuc-vechi"));
        });

        test("(cf1-singleton) one `unitate` value with a product lacking it → shown and narrowing; on every product → absent", async () => {
            const alpod = await cf1Get("/category/cf1-alpod");
            assert.deepEqual(plainRows(facetRows(alpod.body, "a.unitate")), [{ state: "link", value: "ml", count: 2 }]);
            const selected = await cf1Get(facetRows(alpod.body, "a.unitate")[0].href);
            assert.deepEqual(cardSlugs(selected.body), ["profil-aluminiu", "profil-inox"]);
            const boen = await cf1Get("/category/cf1-boen");
            assert.equal(facetRows(boen.body, "a.unitate"), null);
            assert.doesNotMatch(htmlOf(boen.body), /data-facet="a\.unitate"/);
        });

        test("(cf1-namespace) attributes literally named `producator` and `varianta` are facets of their own, independent of the fixed ones (ruling 2)", async () => {
            const bare = await cf1Get("/shop");
            assert.match(htmlOf(bare.body), /data-facet="producator"[^>]*><summary[^>]*>Producător<\/summary>/);
            assert.match(htmlOf(bare.body), /data-facet="a\.producator"[^>]*><summary[^>]*>producator<\/summary>/);
            assert.match(htmlOf(bare.body), /data-facet="a\.varianta"[^>]*><summary[^>]*>varianta<\/summary>/);
            // The attribute `producator` filters on the attribute; the fixed producer facet is counted under it.
            const attr = await cf1Get(`/shop${fParam([["a.producator", "Atelier Nord"]])}`);
            assert.deepEqual(cardSlugs(attr.body), ["profil-aluminiu", "profil-inox"]);
            assert.deepEqual(chipsOf(attr.body), ["producator: Atelier Nord"]);
            assert.deepEqual(plainRows(facetRows(attr.body, "producator")), [
                { state: "link", value: "ALPOD", count: 2 }, { state: "zero", value: "BOEN", count: 0 },
                { state: "zero", value: "ITC", count: 0 }, { state: "zero", value: "KRONO", count: 0 },
            ]);
            // The fixed producer filters on the brand; the attribute facet is counted under it.
            const fixed = await cf1Get(`/shop${fParam([["producator", "ALPOD"]])}`);
            assert.deepEqual(cardSlugs(fixed.body), ["profil-aluminiu", "profil-inox", "adeziv-montaj"]);
            assert.deepEqual(plainRows(facetRows(fixed.body, "a.producator")), [
                { state: "link", value: "Atelier Nord", count: 2 }, { state: "link", value: "Atelier Sud", count: 1 },
            ]);
            // The brand value `Atelier Nord` matches no brand: the two sources never mix.
            assert.deepEqual(cardSlugs((await cf1Get(`/shop${fParam([["producator", "Atelier Nord"]])}`)).body), []);
            // `varianta`: the attribute and the option values are separate facets.
            assert.deepEqual(cardSlugs((await cf1Get(`/shop${fParam([["a.varianta", "Mat"]])}`)).body), ["profil-aluminiu", "adeziv-montaj"]);
            const optionSel = await cf1Get(`/shop${fParam([["varianta", "14x138x2200 mm"]])}`);
            assert.deepEqual(cardSlugs(optionSel.body), ["stejar-natur", "stejar-rustic"]);
            assert.deepEqual(plainRows(facetRows(optionSel.body, "a.varianta")), [
                { state: "zero", value: "Lucios", count: 0 }, { state: "zero", value: "Mat", count: 0 },
            ]);
            assert.deepEqual(cardSlugs((await cf1Get(`/shop${fParam([["varianta", "Mat"]])}`)).body), []);
        });

        test("(cf1-lifetime) a selected key that is not offered — rule (i), (ii), (iii) failing, or held by no product — is applied, shown and removable (ruling 1)", async () => {
            for (const [category, key, value, slugs] of [
                ["cf1-boen", "Nordic swan", "da", ["stejar-natur"]],               // (i): one holder
                ["cf1-boen", "Article no.", "BN-002", ["stejar-rustic"]],          // (ii): a value per product
                ["cf1-itc", "Color", CF1.colors[4], ["mocheta-arc"]],             // (iii): 41 distinct values
                ["cf1-boen", "Inexistent", "x", []],                               // no product holds the key
            ]) {
                const bare = `/category/${category}`;
                assert.equal(facetRows((await cf1Get(bare)).body, `a.${key}`), null, `${key}: not offered without a selection`);
                const res = await cf1Get(`${bare}${fParam([[`a.${key}`, value]])}`);
                assert.equal(res.status, 200, key);
                assert.deepEqual(cardSlugs(res.body), slugs, `${key}: the listing is filtered`);
                assert.deepEqual(chipLinks(res.body), [{ text: `${key}: ${value}`, href: bare }], `${key}: the chip is shown and removes the selection`);
                assert.deepEqual(facetRows(res.body, `a.${key}`), [{ state: "selected", value, count: slugs.length, href: bare }], `${key}: the facet shows the selected value only`);
                if (slugs.length === 0) assert.match(htmlOf(res.body), /Niciun produs nu corespunde filtrelor alese\./);
            }
        });

        test("(cf1-malformed) malformed and unknown `f` values: 200; unknown keys ignored; a value that matches nothing stays removable", async () => {
            // The § 5.5 witnesses as written: `colectie` (no `a.`) is not a facet id under the identity rule (ruling 2),
            // so § 4.4 step 3 drops it — 200, nothing applied.
            for (const f of ["%zz", "colectie%3D%25E0%25A4%25A", "colectie%3Da%25", "%26%26", "zzz%3D1", "a.%3D1"]) {
                const res = await cf1Get(`/shop?f=${f}`);
                assert.equal(res.status, 200, f);
                assert.deepEqual(chipsOf(res.body), [], f);
                assert.equal(totalOf(res.body), 42, f);
            }
            // The same witnesses on the attribute id: the decoded value matches no product and is shown, removable.
            for (const [f, value] of [["a.colec%25C8%259Bie%3D%25E0%25A4%25A", "�%A"], ["a.colec%25C8%259Bie%3Da%25", "a%"]]) {
                const res = await cf1Get(`/shop?f=${f}`);
                assert.equal(res.status, 200, f);
                assert.deepEqual(chipsOf(res.body), [`colecție: ${value}`], f);
                assert.ok(facetRows(res.body, "a.colecție").some((r) => r.state === "selected" && r.value === value && r.count === 0 && r.href === "/shop"), f);
            }
            // The OUTER malformed escape: RECORDED. 200 if Next passes it on; a 4xx is acceptable; a 5xx fails the row.
            const outer = await cf1Get("/shop?f=%E0%A4%A");
            console.log(`  (cf1-malformed) outer f=%E0%A4%A → ${outer.status}`);
            assert.ok(outer.status < 500, `outer malformed escape answered ${outer.status}`);
        });

        test("(cf1-url-budget) every href ≤ 6,144 bytes; (a) a fitting selection whose next add-link would not fit, with the pager; (b) an over-budget incoming selection is not applied", async () => {
            // (a) four of the five ~1,300-byte values fit together; the fifth would not. 28 results: the pager renders.
            const a = await cf1Get(`/category/cf1-many${fParam([1, 2, 3, 4].map((n) => ["a.Serie", serie(n)]))}`);
            assert.equal(a.status, 200);
            for (const href of allHrefs(a.body)) assert.ok(bytes(href) <= 6144, `href of ${bytes(href)} bytes`);
            const rows = facetRows(a.body, "a.Serie");
            assert.deepEqual(rows.map((r) => [r.state, r.value.slice(0, 7)]), [
                ["selected", "Seria 1"], ["selected", "Seria 2"], ["selected", "Seria 3"], ["selected", "Seria 4"], ["too-long", "Seria 5"],
            ]);
            assert.ok(rows.filter((r) => r.state === "selected").every((r) => r.href), "every remove-link is present");
            assert.equal(chipsOf(a.body).length, 4);
            assert.ok(pagerHref(a.body, "Next"), "the pager link is present");
            assert.match(htmlOf(a.body), /data-facet-hint[^>]*>Prea multe filtre selectate — eliminați unul</);
            // (b) the review-1 witness on the attribute id: canonical href ≫ 6,144 bytes → not applied.
            const x = "/".repeat(2000);
            const b = await cf1Get(`/shop?f=a.colec%C8%9Bie=${x}A%26a.colec%C8%9Bie=${x}B`);
            assert.equal(b.status, 200);
            assert.match(htmlOf(b.body), /Filtrele din adresă sunt prea lungi și nu au fost aplicate\./);
            assert.deepEqual(chipsOf(b.body), []);
            assert.equal(totalOf(b.body), 42);
            for (const href of allHrefs(b.body)) assert.ok(bytes(href) <= 6144, `href of ${bytes(href)} bytes`);
            // The witness exactly as § 5.5 writes it (`colectie`, 4,031 bytes): not a facet id → dropped, nothing applied.
            const literal = `/shop?f=colectie=${x}A%26colectie=${x}B`;
            assert.equal(bytes(literal), 4031);
            const c = await cf1Get(literal);
            assert.equal(c.status, 200);
            assert.deepEqual(chipsOf(c.body), []);
            assert.equal(totalOf(c.body), 42);
        });

        // ── ROWS (cip1b-*) — filter modes copied onto products (slice cat-import-profile-1b) ────────────────────────
        // Design docs/slices/cat-import-profile-1.md § 2.6 under ruling CIP1-FILTER-PRECEDENCE = S-A with N2: "always"
        // overrides the repeat rule; "never" suppresses the OFFER only — matching and counts are kept. Fixtures: the
        // `CIP1B` block of fixtures.mjs, a tenant of its own (no `cm1-*` / `cf1-*` row sees it). The stub ignores
        // `ProjectionExpression`, so these rows prove the render path; the projection itself is pinned by
        // `test/unit/catalog-listing.test.ts`. Helpers are the cf1 rows' (same panel markup).
        const cipGet = (p) => request({ port: server.port, path: p, host: CIP1B.host });
        const facetOrder = (body) => [...htmlOf(body).matchAll(/data-facet="([^"]+)"/g)].map((m) => m[1]);
        const cipProducts = ITEMS.filter((i) => i.PK === `TENANT#${CIP1B.id}` && i.SK.startsWith("PRODUCT#"));

        test("(cip1b-never) BOEN marks Certificates and Esență never: neither is offered on its category, although Certificates would pass the repeat rule and narrow", async () => {
            // Premise (data): FSC on 2 of the 3 BOEN products — without the mode the facet is offered and shown.
            const holders = cipProducts.filter((p) => p.categoryIds.includes("cip1b-boen") && p.attributes.some((a) => a.key === "Certificates"));
            assert.equal(holders.length, 2);
            const res = await cipGet("/category/cip1b-boen");
            assert.equal(res.status, 200);
            assert.deepEqual(cardSlugs(res.body), ["stejar-mixt", "frasin-mixt", "nuc-fara-fisa"]);
            assert.equal(facetRows(res.body, "a.Certificates"), null);
            assert.equal(facetRows(res.body, "a.Esență"), null);
            assert.deepEqual(facetOrder(res.body), ["varianta"], "only BOEN's own variant facet (no mode) is shown");
        });

        test("(cip1b-variant-never) ITC marks variant never: no `varianta` on its category; a colour selected through the URL still matches both products", async () => {
            const bare = await cipGet("/category/cip1b-itc");
            assert.equal(bare.status, 200);
            assert.deepEqual(cardSlugs(bare.body), ["covor-arc", "covor-shell"]);
            assert.equal(facetRows(bare.body, "varianta"), null);
            const sel = await cipGet(`/category/cip1b-itc${fParam([["varianta", "34"]])}`);
            assert.equal(sel.status, 200);
            assert.deepEqual(cardSlugs(sel.body), ["covor-arc", "covor-shell"], "matching kept (N2)");
            assert.deepEqual(plainRows(facetRows(sel.body, "varianta")), [{ state: "selected", value: "34", count: 2 }], "nothing listed but the selection");
        });

        test("(cip1b-mixed) the § 2.6 mixed-producer witness on the shop: Esență offered, Oak (3) Ash (1); selecting Oak lists the BOEN product too", async () => {
            const res = await cipGet("/shop");
            assert.equal(res.status, 200);
            assert.deepEqual(plainRows(facetRows(res.body, "a.Esență")), [
                { state: "link", value: "Ash", count: 1 },
                { state: "link", value: "Oak", count: 3 },
            ]);
            const oak = await cipGet(facetRows(res.body, "a.Esență").find((r) => r.value === "Oak").href);
            assert.equal(oak.status, 200);
            assert.deepEqual(cardSlugs(oak.body), ["stejar-mixt", "lemn-x-unu", "lemn-x-doi"]);
            assert.deepEqual(chipsOf(oak.body), ["Esență: Oak"]);
            // The BOEN product's page shows the value its card was matched on.
            const page = await cipGet("/product/stejar-mixt");
            assert.equal(page.status, 200);
            assert.ok(htmlOf(page.body).includes('<dt class="text-muted-foreground">Esență</dt><dd class="font-medium">Oak</dd>'));
        });

        test("(cip1b-shop-modes) on the shop: `always` offers a one-holder key; variant never keeps ITC colours out of `varianta`; an unknown mode is automatic; Certificates (never everywhere) absent", async () => {
            const res = await cipGet("/shop");
            assert.deepEqual(plainRows(facetRows(res.body, "a.Finisaj")), [{ state: "link", value: "Mat", count: 1 }], "always: rule (i) overridden");
            assert.deepEqual(plainRows(facetRows(res.body, "varianta")), [
                { state: "link", value: "13,2x181x2200 mm", count: 1 },
                { state: "link", value: "14x138x2200 mm", count: 2 },
            ], "BOEN sizes only");
            assert.deepEqual(plainRows(facetRows(res.body, "a.Nod")), [{ state: "link", value: "da", count: 2 }], "mode 'sometimes' = automatic");
            assert.equal(facetRows(res.body, "a.Certificates"), null);
            // § 13 order: producer, variant, then keys by holders — every holder, silent ones included (Esență 4, Nod 2,
            // Finisaj 1). The discriminating order case (silent holders decide the order) is the unit in facet-modes.test.ts.
            assert.deepEqual(facetOrder(res.body), ["producator", "varianta", "a.Esență", "a.Nod", "a.Finisaj"]);
        });

        test("(cip1b-attributes-joined) a key stored twice is one row on the product page, values joined by \", \"", async () => {
            const page = await cipGet("/product/stejar-mixt");
            assert.equal(page.status, 200);
            const html = htmlOf(page.body);
            assert.ok(html.includes('<dt class="text-muted-foreground">Format</dt><dd class="font-medium">14x138x2200 mm, 13,2x181x2200 mm</dd>'));
            assert.equal(html.split('<dt class="text-muted-foreground">Format</dt>').length - 1, 1, "one Format row");
            // A marked key is still displayed: `never` hides the filter, not the attribute.
            assert.ok(html.includes('<dt class="text-muted-foreground">Certificates</dt><dd class="font-medium">FSC</dd>'));
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
