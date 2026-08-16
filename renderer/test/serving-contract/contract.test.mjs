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
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { startDdbStub } from "./ddb-stub.mjs";
import {
    buildRenderer, startRenderer, request, rendererEnv, probeEnvLoading,
    readAudit, resetAudit, AUDIT_PATH, NO_DOTENV_PRELOAD, RENDERER_DIR,
} from "./harness.mjs";
import {
    FIXTURE_HOST, UNKNOWN_HOST, TENANT_ID, TABLE_NAME,
    PUBLISHED_SLUG, MISSING_SLUG, D4_SLUG,
    SCANNER_TENANT_ID, SCANNER_SLUG, SCANNER_PAGE_TITLE,
} from "./fixtures.mjs";

/** The exact header a route in Next's full-route (ISR) cache mode emits. */
const S_MAXAGE = "s-maxage=31536000";

let stub;
let server;
let startedAt;
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
 * Every ISR entry `next start` has stored for the fixture tenant, with its stored status.
 *
 * MEASURED LAYOUT (next 16.2.12): the filesystem incremental cache writes one
 * `<key>.meta` + `<key>.html` + `<key>.rsc` triple under `.next/server/app/`, keyed by the
 * middleware rewrite target — i.e. `<host>/<path>`. The `.meta` carries the stored status
 * (absent = 200) and the stored response headers. Filtering to keys under the fixture host
 * excludes the build-time `_not-found` / `_global-error` artefacts, which are not
 * on-demand entries.
 *
 * This is how "nothing was stored" is *measured* rather than argued — the committed form of
 * the cache-1 probe's ISR-directory grep (docs/caching-architecture.md § "Probe: the
 * host-verdict transition", row "grep for a stored 404: none"; § "Probe: a read that fails
 * AFTER tenant resolution", row "grep the ISR cache for a stored 500").
 *
 * Every absence assertion below is paired with a positive control that uses this same
 * function, so a silently-broken detector fails the suite instead of passing it.
 */
async function storedIsrEntries() {
    const root = path.join(RENDERER_DIR, ".next", "server", "app");
    const out = [];
    async function walk(dir) {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) await walk(full);
            else if (e.name.endsWith(".meta")) {
                const key = path.relative(root, full).replace(/\.meta$/, "");
                if (!key.startsWith(FIXTURE_HOST)) continue;
                const meta = JSON.parse(await readFile(full, "utf8"));
                out.push({ key, status: meta.status ?? 200, location: meta.headers?.location });
            }
        }
    }
    await walk(root);
    return out;
}

describe("renderer serving contract (docs/caching-architecture.md)", { concurrency: 1 }, () => {
    before(async () => {
        startedAt = Date.now();
        await resetAudit();
        stub = await startDdbStub();
        build = await buildRenderer(stub.url);
        server = await startRenderer(stub.url);
        bootAudit = await readAudit();
    });

    after(async () => {
        const { unhandled } = stub.stats();
        await server?.close();
        await stub?.close();
        await rm(AUDIT_PATH, { force: true });
        console.log(`\nserving-contract suite wall time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
        // A stub that invented absence would let this suite pass while the renderer read
        // nothing. Every read it could not answer is reported here.
        assert.deepEqual(unhandled, [], `ddb-stub could not answer some reads: ${unhandled.join("; ")}`);
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

    test("(iso1) the renderer child environment is constructed, never inherited", () => {
        const env = rendererEnv(stub.url);
        // Whitelist = the four OS passthroughs + the variables harness.mjs pins itself.
        const allowed = new Set([
            "PATH", "HOME", "TMPDIR", "CI",
            "NODE_OPTIONS", "AMODX_DOTENV_AUDIT",
            "__NEXT_PROCESSED_ENV", "NEXT_TELEMETRY_DISABLED",
            "TABLE_NAME", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
            "AWS_ENDPOINT_URL_DYNAMODB", "ORIGIN_VERIFY_SECRET", "NEXT_PUBLIC_API_URL",
            "NEXTAUTH_SECRET", "RECAPTCHA_SITE_KEY",
        ]);
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

    test("(iso3) the REAL next build / next start process trees read no .env* file", async () => {
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
    // open-next runtime constant (fixISRHeaders, util.js:388-396), NOT a Next-emitted value, so a
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
    // (`patches/open-next+3.1.3.patch`, applied by root `postinstall: patch-package`) rewrites the
    // hardcoded 30-day edge SWR window in open-next's `fixISRHeaders()` from `2592000` to `300`.
    //
    // THIS ROW IS LAYER 1 OF A TWO-LAYER GUARD (REVISE 3, operator `cache8-c2-guard-mechanism`).
    // LAYER 1 (here) reads the INSTALLED open-next source every unit run — fast, CI-affordable,
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
    // server can carry its header. The function also cannot be imported and called in isolation: its
    // transitive `adapters/config` → `adapters/logger` imports are extension-less and resolve only
    // inside open-next's own bundler (MEASURED — a bare `import` throws MODULE_NOT_FOUND). So the
    // faithful, low-fragility guard reads the EXACT `dist/core/routing/util.js` file that
    // `open-next build` bundles into the RevalidationFunction/server Lambda and asserts the patched
    // constant is present in `fixISRHeaders()` and the 2592000 window is gone from it.
    //
    // IF THIS GOES RED: either the patch did not apply (a fresh clone whose `postinstall` was skipped
    // — run `npx patch-package`) or open-next was upgraded past 3.1.3 and the patch no longer matches
    // (re-cut the patch against the new `fixISRHeaders`, or drop it if the upstream default changed).
    // Both are exactly the "silently-unapplied patch / upgrade" cases REVISE 2 requires to fail loud.
    // Un-parking `opennext-1` (docs/TECH-DEBT.md) must re-evaluate this patch.
    test("(c2) open-next fixISRHeaders emits the patched stale-while-revalidate=300 edge window, not 2592000 (cache-8 mitigation c)", async () => {
        const require = createRequire(import.meta.url);
        const utilPath = require.resolve("open-next/core/routing/util.js");
        const source = await readFile(utilPath, "utf8");
        const start = source.indexOf("export function fixISRHeaders");
        assert.ok(start >= 0, "fixISRHeaders not found — open-next layout changed; re-verify the patch target");
        const rest = source.slice(start);
        const nextExport = rest.indexOf("export function", "export function".length);
        const body = nextExport > 0 ? rest.slice(0, nextExport) : rest;
        // The STALE-serving branch — the exact header behind the prod symptom (s-maxage=2, age=194).
        assert.match(
            body,
            /s-maxage=2, stale-while-revalidate=300\b/,
            "the patched 300s STALE-path edge window is missing — patch unapplied or open-next upgraded",
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
    });

    // ── ROW (d) ─────────────────────────────────────────────────────────────────────────
    // § "How a 404 stays out of the cache", row 2, and § H2 after-table row 1:
    // 307 → `?nf=1` (cacheable) → 404 + private, no-store (not cacheable).

    test("(d1) known tenant, missing page: cacheable 307 to ?nf=1", async () => {
        const res = await get(MISSING_SLUG);
        assert.equal(res.status, 307);
        assert.equal(res.header("location"), `${MISSING_SLUG}?nf=1`);
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

    test("(d3) what got stored is the 307, and no 404 was stored at all", async () => {
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
    // current arbitrary-tenant-ID + unsanitised-slug contracts, it cannot be at this layer).

    test("(h1) COUNTEREXAMPLE: /wk/index.php is LEGITIMATE content and renders 200, not a shield 404", async () => {
        // A tenant whose ID is the bare string `wk` (arbitrary tenant IDs — tenant/create.ts,
        // @amodx/shared) with a persisted `.php` route (`/index.php` — content/update.ts stores
        // an unsanitised slug). The probe path `/wk/index.php` therefore binds the catch-all
        // `[siteId]=wk`, resolves the tenant via the SYSTEM/TENANT#wk fallback in getTenantConfig,
        // resolves the `/index.php` ROUTE#, and renders a real 200. A `.php` middleware shield —
        // the withdrawn mitigation d — would answer this with `404 no-store`, blocking legitimate
        // tenant content. This row is the executable proof that no `.php` shield is admissible.
        const { result: res, stats } = await readsDuring(() =>
            get(`/${SCANNER_TENANT_ID}${SCANNER_SLUG}`),
        );
        assert.equal(res.status, 200, "the scanner-shaped-but-legitimate page must render, not be shielded");
        assert.match(res.header("content-type"), /text\/html/);
        assert.ok(res.body.includes(SCANNER_PAGE_TITLE), "the tenant's real page body must be served");
        // Load-bearing: the request reached the renderer read layer (tenant + route resolution),
        // which a door-level shield would have prevented (render === 0).
        assert.ok(stats.render > 0, "a legitimate `.php` route must reach the renderer read layer");
    });

    test("(h2) DEFERRED STATE: a scanner path with no route takes the ordinary not-found handoff (NOT shielded)", async () => {
        // With mitigation d deferred there is no special-casing: a scanner-shaped path that does
        // NOT resolve to a route is handled exactly like any other unknown slug — the cacheable
        // `307 → ?nf=1` handoff (docs/caching-architecture.md § "How a 404 stays out of the
        // cache"). This is precisely the entry point of the flood the slice diagnosed: the junk
        // still mints a cacheable 307. Pinning it makes any future shield a DELIBERATE contract
        // change rather than a silent one, and documents that the flood is currently UNMITIGATED.
        //
        // `/wk/<missing>.php` uses the real tenant `wk` but a `.php` slug it has no route for.
        // The catch-all binds `[siteId]=wk`, `[[...slug]]=["wp-login.php"]`, so the render's
        // slugPath is `/wp-login.php` and the not-found handoff redirects to that slug + `?nf=1`
        // (notFoundOrHandoff uses the slug path, not the siteId-prefixed URL) — the ordinary
        // cacheable 307 that, in production, is the flood's ISR entry.
        const res = await get(`/${SCANNER_TENANT_ID}/wp-login.php`);
        assert.equal(res.status, 307, "an unshielded scanner path must take the ordinary not-found handoff");
        assert.equal(
            res.header("location"),
            "/wp-login.php?nf=1",
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

    test("(e1) read failing after tenant resolution: 500 with NO Cache-Control, nothing stored", async () => {
        // `D4_SLUG` is a page that genuinely EXISTS. That is the whole point: pre-D4 a
        // failed read on an existing page was indistinguishable from "missing" and produced
        // a stored 307. The tenant lookup stays healthy; only the reads after it fail.
        const key = `${FIXTURE_HOST}${D4_SLUG}`;
        stub.failContentReads(true);
        try {
            const res = await get(D4_SLUG);
            assert.equal(res.status, 500);
            assert.equal(
                res.header("cache-control"),
                undefined,
                "a failed read must emit NO Cache-Control — any value here is storable",
            );
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

    for (const route of HARDENED_WRITE_PROXIES) {
        test(`(g4) ${route} REJECTS a null/cross-origin POST at the barrier (403)`, async () => {
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
            assert.equal(res.status, 403, `${route} must reject the opaque-origin write`);
            assert.match(res.body, new RegExp(REJECTION_BODY));
        });

        test(`(g4) ${route} ACCEPTS a same-origin POST past the barrier (not 403)`, async () => {
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
        });
    }
});
