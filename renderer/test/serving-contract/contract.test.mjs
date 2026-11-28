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
import { readdir, readFile, mkdtemp, writeFile, rm, mkdir, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
    buildRenderer, startRenderer, startStubs, request, rendererEnv, probeEnvLoading,
    readAudit, resetAudit, AUDIT_PATH, NO_DOTENV_PRELOAD, RENDERER_DIR,
    BUNDLE, versionedExpectation, operationInventory, servedResponses, REVALIDATION_TEST_SECRET,
} from "./harness.mjs";
import { storedStatusOf } from "../serving-bundle/s3-stub.mjs";
import { RENDERER_TEST_KEY } from "./backend-stub.mjs";
import { execFile } from "node:child_process";
import {
    CM1_BASELINE_DIR, CM1_CONTROL_DIR, captureCm1, compareTenant, maskBody, readClientModules, splitFlight, writeCaptures,
    bootstrapChunks, bootstrapChunkProblems, bootstrapChunkProblemsOfJournal, readRootNotFoundScript,
} from "./cm1-byte-identity.mjs";
// LANDING-1: derive only EXPECTED root-class additions after HYDRATION-1; stored captures and candidates stay intact.
import { readLanding1ExpectedCaptures } from "./landing-1-expected.mjs";
import { CONFIRMATION_ADDRESS, PRE_CDL2_CONFIRMATION_ADDRESS, CQ1_REQUESTS, CT1_REQUESTS, EN_US_REQUESTS, LOC1_DIR, LOC1_REQUESTS, LOC1E_404_REQUESTS, LOC1E_PROBE_REQUESTS, cacheFields, canon, resolveFlight, captureLoc1, captureRequests, checkExpected, expectedFor, liveSiteIdReference, extractVisibleText, preCdl2Address, renderItem, textChanges, textMismatches } from "./locale-1/proof.mjs";
import { URL_PREFIX_DEFAULTS, getCountryPack, resolveLocaleStrings, newsletterTexts, galleryTexts, fillTemplate, urlPrefixesOf } from "@amodx/shared";
import {
    CM1, CM1_STALE_SLUG, CF1, CIP1B, ITEMS, CIG1_COMMERCE_HIDDEN, LOC1, LOC1E, CQ1, CQ1_CHANNELS, CT1, CT1_THEME, CT1_HERO_SLUG,
    BPF1, BPF1_FOOTER, BPF1_BACKGROUND_ONLY, CDL2, CDL2_STORED_PREFIXES, HC1, HC1_HEADER, HC1_INVALID, CC1, CC1_TWIN, CC1_PARAGRAPH, CC1_MALFORMED,
    SL1A, SL1A_HEADER, SL1A_FOOTER, SL1B, SL1B_COVER_OPTIONS, SL1B_SPLIT_OPTIONS, SL1C, SL1C_PATH, SL1C_CATEGORIES, SL1C_GRID, SL1C_BLANK_GRID,
    SL1D, SL1D_PATH, SL1D_SHOWCASE_OPTIONS, SL1D_SHOWCASE_BLANK, SL1D_POST_GRID_OPTIONS, SL1D_POST_GRID_BLANK,
    SL1E, SL1E_PATH, SL1E_NOTIFY, SL1E_FIELDS, SL1E_FORM, SL1E_BLOCK, SL1E_BLANK_BLOCK, SL1E_NONE_BLOCKS,
    NL1, NL1_PATH, NL1_TOKEN, NL1_GROUP, NL1_BLOCK,
    GL1, GL1_PATH, GL1_ITEMS, GL1_DROPPED_SRC,
    SCHED1G, SCHED1G_SITE_KEY, SCHED1G_SECRET, SCHED1G_ONLY_SITE_KEY, SCHED1G_MARKERS, SCHEDLABELS1, SCHEDLABELS1_TEXTS,
    LANG1B, LANG1B_OVERRIDES, LANG1B_PAGES, LANG1C, LANG1C_MENUS,
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
    // FINDINGS-1 Part 5: added with open-next 4 built (docs/slices/findings-1.md); never run on a 3.x bundle, so no "3".
    "findings1-preview-sitemap": { "4": SAME },
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
 * CMRC-1L: the backend address and the renderer key of the SERVING renderer, both constructed (harness.mjs
 * `rendererEnv`): the loopback backend stub (it answers `POST /customer/order-lookup` only) and a test key.
 */
const BACKEND_STUB_ENV = ["API_URL", "AMODX_API_KEY"];

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
        // CMRC-1L: what reached the backend stub, on both targets — the order lookups it answered (by status) and the
        // other backend calls it dropped (the booking proxy's forward step). Evidence that the order pages of this
        // run were read through the backend route, not from DynamoDB.
        const backendCalls = {};
        for (const e of stubs.api.journal()) backendCalls[`${e.route}→${e.outcome}`] = (backendCalls[`${e.route}→${e.outcome}`] ?? 0) + 1;
        console.log(`\nbackend stub (${BUNDLE ? "bundle" : "next"} target, contract rows): ${JSON.stringify(backendCalls)}`);
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
        const env = exp === "bundle-env" ? server.env : rendererEnv(stub.url, stubs.api.url);
        // Whitelist = the four OS passthroughs + the variables harness.mjs pins itself.
        const allowed = new Set([
            "PATH", "HOME", "TMPDIR", "CI",
            "NODE_OPTIONS", "AMODX_DOTENV_AUDIT",
            "__NEXT_PROCESSED_ENV", "NEXT_TELEMETRY_DISABLED",
            "TABLE_NAME", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
            "AWS_ENDPOINT_URL_DYNAMODB", "ORIGIN_VERIFY_SECRET", "NEXT_PUBLIC_API_URL",
            "NEXTAUTH_SECRET", "RECAPTCHA_SITE_KEY",
            // LANG-1B: a constructed test value, so row lang1b-purge can call /api/revalidate on the `next` target.
            "REVALIDATION_SECRET",
            // CMRC-1L: the backend stub's address and the constructed renderer key (the order pages' read).
            ...BACKEND_STUB_ENV,
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
        // CMRC-1L: the backend address is the stub on this host, and the key is the harness's test value — never an
        // inherited one (the operator's shell may hold a real `AMODX_API_KEY`).
        assert.equal(env.API_URL, stubs.api.url, "API_URL must be the backend stub");
        assert.match(env.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
        assert.equal(env.AMODX_API_KEY, RENDERER_TEST_KEY, "the constructed renderer key, not an inherited one");
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
        // "no render" is the load-bearing word: only the host gate's read happens (LANG-1B: a projected
        // query in place of the COUNT query; ddb-stub.mjs identifies it by that shape).
        assert.equal(stats.render, 0, "the render must never run for an unwired host");
        assert.equal(stats.hostGate, 1, "the host gate should have performed exactly one host-gate read");
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

    // FINDINGS-1 Part 5 (F-PREVIEW-SITEMAP-EDGE, docs/slices/findings-1.md): the by-id sitemap is not kept at the edge —
    // the fast-lane purge names `/sitemap.xml` only, which does not match these paths. Its bytes are the domain's; the
    // domain answer keeps its header (rows lang1c-sitemap / lang1c-sitemap-identity pin it for every fixture tenant).
    // Rule (review-0 R1): both by-id forms and the domain form, for a tenant whose id differs from its domain AND for one
    // whose id equals its domain (the segment `[siteId]` is then the same string for all three requests). A viewer-sent
    // copy of the middleware's header changes nothing on the domain.
    test("(findings1-preview-sitemap) /_site/<id>/sitemap.xml and /tenant/<id>/sitemap.xml: private, no-store, the domain's bytes; the domain keeps s-maxage=3600 — id ≠ domain and id = domain", async () => {
        const EQUAL = "findings1-equal.serving-contract.test";
        stub.putItem({ ...ITEMS.find((i) => i.PK === "SYSTEM" && i.SK === `TENANT#${TENANT_ID}`), SK: `TENANT#${EQUAL}`, id: EQUAL, Domain: EQUAL, domain: EQUAL, name: "FINDINGS-1 equal id and domain" });
        for (const [id, host] of [[TENANT_ID, FIXTURE_HOST], [EQUAL, EQUAL]]) {
            const domain = await request({ port: server.port, path: "/sitemap.xml", host });
            assert.equal(domain.status, 200, `${id}: domain 200`);
            assert.equal(domain.header("cache-control"), "public, s-maxage=3600, stale-while-revalidate=59", `${id}: domain header as before`);
            assert.match(domain.body, /<urlset/, `${id}: control, the domain answers a sitemap`);
            const forged = await request({ port: server.port, path: "/sitemap.xml", host, headers: { "x-amodx-sitemap-by-id": "1" } });
            assert.equal(forged.header("cache-control"), domain.header("cache-control"), `${id}: a viewer-sent header changes nothing on the domain`);
            assert.equal(forged.body, domain.body, `${id}: forged-header bytes`);
            for (const p of [`/_site/${id}/sitemap.xml`, `/tenant/${id}/sitemap.xml`]) {
                const res = await request({ port: server.port, path: p, host: PREVIEW_HOST });
                assert.equal(res.status, 200, `${p}: 200`);
                assert.equal(res.header("cache-control"), "private, no-store", `${p}: not kept at the edge`);
                assert.equal(res.header("content-type"), domain.header("content-type"), `${p}: content-type`);
                assert.equal(res.body, domain.body, `${p}: the domain's bytes`);
            }
        }
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
    // no backend answers these routes (since cmrc-1l `API_URL` is the backend stub, which drops
    // every request but the order lookup), so it then fails downstream (config/parse) — the point is only that
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
                // NEXT-PATCH-1 rule 3: the root-layout script category 4 checks in the after head, named by this build.
                const rootNotFoundScript = await readRootNotFoundScript(RENDERER_DIR);
                const captures = await captureCm1(request, server.port, ["commerce", "content", "catalog"]);
                cm1Candidate = { buildId, clientModules, rootNotFoundScript, captures };
                if (process.env.CM1_CAPTURE_DIR) await writeCaptures(process.env.CM1_CAPTURE_DIR, cm1Candidate);
            }
            return cm1Candidate;
        }
        const cm1Base = async () => (cm1Baseline ??= await readLanding1ExpectedCaptures(CM1_BASELINE_DIR));
        let cm1Control;
        /** The de4ad52 capture set (the pre-catalog-mode renderer), kept for `cm1-control` when locale-1a advanced `baseline/`. */
        const cm1ControlSet = async () => (cm1Control ??= await readLanding1ExpectedCaptures(CM1_CONTROL_DIR));
        const cm1Body = async (tenant, p) => (await cm1Set()).captures.find((c) => c.tenant === tenant && c.path === p);

        for (const tenantKey of ["commerce", "content"]) {
            test(`(cm1-identity-${tenantKey}) a tenant without catalogMode (${tenantKey}) answers every § 3.6 URL as the forward-derived expected baseline/ (HYDRATION-1 + LANDING-1; history in cm1-byte-identity/README.md), under the CM1-A1 canonicalisations`, async () => {
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
            const changed = compareTenant(await cm1ControlSet(), await cm1Set(), "catalog").filter((r) => !r.same).map((r) => r.path);
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
        // names before changing an assertion. LOCALE-1B: the catalog tenant is an en-US tenant, so the panel copy these
        // rows read is the English catalog text (ledger row L-EN-CAT, docs/slices/locale-1.md § 6.3); the facet ids and
        // the attribute headings (author data) are unchanged. The Romanian copy is proven on `loc1-ro-catalog`.
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
            assert.match(htmlOf(res.body), />3 products</);
            assert.deepEqual(chipsOf(res.body), ["Brand: BOEN"]);
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
            assert.match(htmlOf(none.body), /No product matches the selected filters\./);
            assert.match(htmlOf(none.body), /data-facet-empty.*Clear the filters/s);
            assert.deepEqual(cardSlugs(none.body), []);
            assert.deepEqual(chipsOf(none.body), ["Brand: BOEN", "unitate: ml"]);
            const unknown = await cf1Get(`/shop${fParam([["producator", "Nimeni"]])}`);
            assert.equal(unknown.status, 200);
            assert.match(htmlOf(unknown.body), /No product matches the selected filters\./);
            assert.deepEqual(chipsOf(unknown.body), ["Brand: Nimeni"]);
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
            assert.match(htmlOf(bare.body), /data-facet="producator"[^>]*><summary[^>]*>Brand<\/summary>/);
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
                if (slugs.length === 0) assert.match(htmlOf(res.body), /No product matches the selected filters\./);
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
            assert.match(htmlOf(a.body), /data-facet-hint[^>]*>Too many filters selected — remove one</);
            // (b) the review-1 witness on the attribute id: canonical href ≫ 6,144 bytes → not applied.
            const x = "/".repeat(2000);
            const b = await cf1Get(`/shop?f=a.colec%C8%9Bie=${x}A%26a.colec%C8%9Bie=${x}B`);
            assert.equal(b.status, 200);
            assert.match(htmlOf(b.body), /The filters in the address are too long and were not applied\./);
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
        // ── ROWS (loc1-*) — LOCALE-1 proof, current slice cdl-2 (docs/slices/locale-1.md § 8.5; rulings § 16.2 items 4-5;
        // docs/slices/cdl-2.md § 8, the procedure of docs/slices/cat-variant-gallery-1.md § 6). Helpers: locale-1/proof.mjs.
        // Inputs, all in locale-1/cdl-2/: before/ (immutable, captured from 7bd3d51 with that commit's own suite harness and
        // fixtures in a throwaway worktree — every en-US subject, every RO copy, the CQ1 and the CT1 tenants; the three
        // order-confirmation requests of the commerce subject and of its RO copy were sent at their pre-cdl-2 address and
        // are recorded under their current one with `requestedPath`, `preCdl2Address`), expected-diff.json (the reviewed
        // byte-difference list of the en-US subjects: every page of a catalog-mode subject lists row CDL2-INTEREST-PATH, the
        // commerce checkout and its three confirmation pages row CDL2-CONFIRMATION, every other URL nothing) and
        // ro-expected.json (the RO copies' text changes against their own 7bd3d51 capture: none). The previous set,
        // variant-gallery-1/ (27fa7ca), is read explicitly only by the cvg1-text-removal-* rows and, for its cq1RoNone
        // list, by cq1-quote-channels (`cvg1BeforeSet`, `cvg1Json`). Each slice has its own set (§ 8.5 rule 5); the 1a/, 1b/,
        // 1c/, 1d/ and reviews-date-1/ files stay as those slices' records and no row reads them. The 1e/ files are read
        // only by the rows that pin the locale-1e root-layout move against d9999d2 (loc1e-category-controls,
        // loc1e-404-document, loc1e-cache-headers); the quote-1/ files (29a2282) only by the cq1-* rows, which pin
        // cat-quote-1's own changes against its start commit; the theme-1/ files (0865ac6) only by the ct1-* rows, which pin
        // cat-theme-1's own changes against its start commit (`ct1BeforeSet`).
        // SUBJECTS (1a review-0 R1): every fixtures.mjs tenant without `locale` is an en-US subject (`EN_US_REQUESTS`;
        // since 1d the commerce subject's list also holds its order pages, `orderRequests`).
        // Text oracle per subject: equal to before/ except exactly the listed ledger texts and removals (cdl-2 lists none:
        // its changes are addresses, not visible text).
        // These rows run LAST in this block: the non-CM1 subjects are captured here, after every row that depends on
        // those tenants' cache state. The RO subjects are the copies `loc1-ro-*` (fixtures.mjs LOC1).
        let loc1Before, loc1Ro, loc1En;
        const LOC1_SLICE = "cdl-2";
        /** The commit before/ was captured from (the slice's start commit for render output; titles cite it). */
        const LOC1_START = "7bd3d51";
        /** CAT-QUOTE-1 (read by the cq1-* rows against quote-1/before/, 29a2282): what cat-quote-1 listed for a catalog
         *  product page — row CQ1-INTEREST-LINK, the interest toggle's link form. */
        const CQ1_LINK = [
            { category: 3, row: "CQ1-INTEREST-LINK", before: 'class="inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors h-11 px-6 text-sm bg-background text-foreground border-border hover:border-primary"', after: 'class="inline-flex items-center gap-1.5 text-sm underline underline-offset-4 transition-colors text-muted-foreground hover:text-foreground"' },
            { category: 3, row: "CQ1-INTEREST-LINK", before: 'class="lucide lucide-heart h-4 w-4"', after: 'class="lucide lucide-heart h-3.5 w-3.5"' },
            { category: 2, row: "CQ1-INTEREST-LINK", element: "[project]/renderer/src/components/InterestShortlist.tsx#InterestToggle", prop: "variant", beforeValue: "page", value: "link" },
        ];
        /** What locale-1e lists for an en-US subject: the category-4 root-layout move only, never a ledger row. */
        const LOC1_EN_MOVE = { category: 4, row: "LOC1E-ROOT-LAYOUT", lang: "en" };
        /** The start of a `__next_error__` shell (the 307 handoffs, the 404 landings): category 4's error-shell predicate. */
        const ERROR_SHELL = '<!DOCTYPE html><html id="__next_error__">';
        const loc1BeforeSet = async () => (loc1Before ??= await readLanding1ExpectedCaptures(path.join(LOC1_DIR, LOC1_SLICE, "before")));
        const loc1Json = async (file) => JSON.parse(await readFile(path.join(LOC1_DIR, LOC1_SLICE, file), "utf8"));
        let loc1eBefore, cq1Cand, cq1Before, ct1Cand, ct1Before, cvg1Before;
        /** CDL-2: the cat-variant-gallery-1 record set (27fa7ca + its lists), read explicitly by the cvg1-text-removal-*
         *  rows (they pin CVG1's listed text removal against ITS start commit) and, for `cq1RoNone`, by cq1-quote-channels. */
        const cvg1BeforeSet = async () => (cvg1Before ??= await readLanding1ExpectedCaptures(path.join(LOC1_DIR, "variant-gallery-1", "before")));
        const cvg1Json = async (file) => JSON.parse(await readFile(path.join(LOC1_DIR, "variant-gallery-1", file), "utf8"));
        /** CAT-VARIANT-GALLERY-1: the cat-theme-1 record set (0865ac6), read explicitly by the ct1-* rows (the current set
         *  is variant-gallery-1). */
        const ct1BeforeSet = async () => (ct1Before ??= await readLanding1ExpectedCaptures(path.join(LOC1_DIR, "theme-1", "before")));
        /** CAT-THEME-1: the cat-quote-1 record set (29a2282), read explicitly by the cq1-* rows (the current set is variant-gallery-1). */
        const cq1BeforeSet = async () => (cq1Before ??= await readLanding1ExpectedCaptures(path.join(LOC1_DIR, "quote-1", "before")));
        /** This run's captures of the CT1 tenants (fixtures.mjs `CT1`, requests `CT1_REQUESTS`). */
        const ct1Set = async () => (ct1Cand ??= await captureRequests(request, server.port, Object.values(CT1_REQUESTS).flat()));
        const loc1eBeforeSet = async () => (loc1eBefore ??= await readLanding1ExpectedCaptures(path.join(LOC1_DIR, "1e", "before")));
        const loc1eJson = async (file) => JSON.parse(await readFile(path.join(LOC1_DIR, "1e", file), "utf8"));
        /** This run's captures of the CQ1 tenants (fixtures.mjs `CQ1`, requests `CQ1_REQUESTS`). */
        const cq1Set = async () => (cq1Cand ??= await captureRequests(request, server.port, Object.values(CQ1_REQUESTS).flat()));
        const loc1RoSet = async () => (loc1Ro ??= await captureLoc1(request, server.port));
        const isHtml = (c) => c.contentType.startsWith("text/html");
        const CM1_KEYS = new Set(Object.keys(CM1));
        const EN_TABLE = resolveLocaleStrings({}).strings;
        const RO_TABLE = resolveLocaleStrings({ locale: "ro-RO" }).strings;
        /** This run's capture set of every en-US subject: the CM1 captures of `cm1Set()` plus every other request of
         *  `EN_US_REQUESTS` (the other subjects, and since 1d the commerce subject's order pages), now. */
        async function loc1EnSet() {
            if (!loc1En) {
                const cm1 = await cm1Set();
                const fromCm1 = cm1.captures.filter((c) => Object.hasOwn(EN_US_REQUESTS, c.tenant) && EN_US_REQUESTS[c.tenant].some((r) => r.path === c.path));
                const rest = await captureRequests(request, server.port, Object.values(EN_US_REQUESTS).flat().filter((r) => !fromCm1.some((c) => c.tenant === r.tenant && c.path === r.path)));
                loc1En = { buildId: cm1.buildId, clientModules: cm1.clientModules, rootNotFoundScript: cm1.rootNotFoundScript, captures: [...fromCm1, ...rest] };
            }
            return loc1En;
        }
        const pathsBySubject = (captures) => {
            const out = {};
            for (const c of captures) (out[c.tenant] ??= []).push(c.path);
            for (const list of Object.values(out)) list.sort();
            return out;
        };
        /** Per URL of a subject: the visible-text changes its category-3 (ledger) entries list (`textMismatches`). A
         *  category-3 entry lists `text` only when the visible text changes (CAT-QUOTE-1: CQ1-INTEREST-LINK is markup only). */
        const ledgerTexts = (doc, subject) => (urlPath) => expectedFor(doc, subject, urlPath).filter((e) => e.category === 3 && e.text !== undefined).map((e) => e.text);
        /** CAT-VARIANT-GALLERY-1 (CVG1-TEXT-REMOVAL = A): per URL, the visible-text items its category-3 entries list as
         *  removed (`textRemoved`: `{ kind, text, position }`, position = index in the before extraction). */
        const removedTexts = (doc, subject) => (urlPath) => expectedFor(doc, subject, urlPath).filter((e) => e.category === 3 && e.textRemoved !== undefined).flatMap((e) => e.textRemoved);

        /** CDL-2 — the five exact entry shapes of cdl-2/expected-diff.json (docs/slices/cdl-2.md § 8). */
        const CDL2_INTEREST_HTML = { category: 3, row: "CDL2-INTEREST-PATH", before: 'href="/lista-mea"><span class="relative">', after: 'href="/my-list"><span class="relative">' };
        const CDL2_INTEREST_FLIGHT = { category: 3, row: "CDL2-INTEREST-PATH", flightBefore: '"listPrefix":"/lista-mea"', flightAfter: '"listPrefix":"/my-list"' };
        const CDL2_CONFIRM_PROP = { category: 2, row: "CDL2-CONFIRMATION", element: "[project]/renderer/src/components/CheckoutPageView.tsx#CheckoutPageView", prop: "confirmPrefix", beforeValue: PRE_CDL2_CONFIRMATION_ADDRESS, value: CONFIRMATION_ADDRESS };
        const CDL2_SEGMENT = [
            { category: 3, row: "CDL2-CONFIRMATION", flightBefore: '"k":"checkout/confirmare"', flightAfter: '"k":"checkout/confirmation"' },
            { category: 3, row: "CDL2-CONFIRMATION", flightBefore: '"c":["","checkout","confirmare', flightAfter: '"c":["","checkout","confirmation' },
        ];

        test("(loc1-subjects) the en-US subjects are every fixture tenant without `locale`; before/ holds exactly their URLs, the RO copies', the CQ1 and the CT1 tenants' URLs, and records the pre-cdl-2 address of exactly the moved ones; expected-diff.json lists exactly the subjects' URLs, each with nothing except CDL2-INTEREST-PATH on every HTML page of a catalog-mode subject and CDL2-CONFIRMATION on the commerce checkout and confirmation pages", async () => {
            const want = Object.fromEntries(Object.entries(EN_US_REQUESTS).map(([key, list]) => [key, list.map((r) => r.path).sort()]));
            const withoutLocale = ITEMS.filter((i) => i.PK === "SYSTEM" && String(i.SK).startsWith("TENANT#") && !Object.hasOwn(i, "locale")).length;
            assert.equal(Object.keys(want).length, withoutLocale, "every tenant without `locale` is a subject");
            for (const key of CM1_KEYS) assert.ok(want[key], `CM1 ${key} is a subject`);
            for (const t of Object.values(LOC1)) assert.ok(!Object.hasOwn(want, t.id), `${t.id} (ro-RO) is not an en-US subject`);
            assert.ok(want.commerce.some((p) => p.startsWith(`${CONFIRMATION_ADDRESS}?id=`)) && want.commerce.includes("/account"), "the commerce subject's order pages are subjects (locale-1d)");
            const ro = Object.fromEntries(Object.entries(LOC1_REQUESTS).map(([key, list]) => [key, list.map((r) => r.path).sort()]));
            const cq1 = Object.fromEntries(Object.entries(CQ1_REQUESTS).map(([key, list]) => [key, list.map((r) => r.path).sort()]));
            for (const t of Object.values(CQ1)) assert.ok(!Object.hasOwn(want, t.id), `${t.id} (CQ1, has a locale) is not an en-US subject`);
            const ct1 = Object.fromEntries(Object.entries(CT1_REQUESTS).map(([key, list]) => [key, list.map((r) => r.path).sort()]));
            for (const t of Object.values(CT1)) assert.ok(!Object.hasOwn(want, t.id), `${t.id} (CT1, has a locale) is not an en-US subject`);
            assert.ok(!Object.hasOwn(want, CDL2.partial.id), `${CDL2.partial.id} (CDL2, has a locale) is not an en-US subject`);
            const before = await loc1BeforeSet();
            assert.deepEqual(pathsBySubject(before.captures), { ...want, ...ro, ...cq1, ...ct1 }, "before/ must hold exactly the subjects', the RO copies', the CQ1 and the CT1 tenants' URLs");
            // CDL-2: a capture records `requestedPath` exactly when its address moved, and then it is the pre-cdl-2 address.
            const moved = before.captures.filter((c) => preCdl2Address(c.path) !== c.path);
            assert.deepEqual(before.captures.filter((c) => Object.hasOwn(c, "requestedPath")), moved, "requestedPath on exactly the moved captures");
            for (const c of moved) assert.equal(c.requestedPath, preCdl2Address(c.path), `${c.tenant} ${c.path}: requestedPath`);
            assert.deepEqual(moved.map((c) => c.tenant).sort(), ["commerce", "commerce", "commerce", "roCommerce", "roCommerce", "roCommerce"], "the moved captures are the three confirmation requests of the commerce subject and of its RO copy");
            const doc = await loc1Json("expected-diff.json");
            assert.deepEqual(Object.fromEntries(Object.entries(doc.fixtures).map(([key, urls]) => [key, Object.keys(urls).sort()])), want, "expected-diff.json must list exactly the subjects' URLs");
            // CDL-2: a catalog-mode subject's HTML page lists the payload entry of CDL2-INTEREST-PATH and, where the header
            // widget is server-rendered, its HTML entry — nothing else; its other responses nothing. The commerce subject's
            // checkout lists the confirmPrefix change, its three moved confirmation pages the two route-segment texts. Every
            // other URL lists NOTHING.
            const catalogMode = (subject) => ITEMS.find((i) => i.PK === "SYSTEM" && i.Domain === EN_US_REQUESTS[subject][0].host)?.catalogMode === true;
            const counts = { interest: 0, checkout: 0, confirmation: 0 };
            for (const [subject, urls] of Object.entries(doc.fixtures)) {
                for (const [urlPath, list] of Object.entries(urls)) {
                    const capture = before.captures.find((c) => c.tenant === subject && c.path === urlPath);
                    if (catalogMode(subject) && isHtml(capture)) {
                        const html = list.filter((e) => Object.hasOwn(e, "after"));
                        assert.deepEqual(list.filter((e) => !Object.hasOwn(e, "after")), [CDL2_INTEREST_FLIGHT], `${subject} ${urlPath}: the CDL2-INTEREST-PATH payload entry`);
                        assert.ok(html.length === 0 || (html.length === 1 && JSON.stringify(html[0]) === JSON.stringify(CDL2_INTEREST_HTML)), `${subject} ${urlPath}: at most the CDL2-INTEREST-PATH HTML entry`);
                        counts.interest++;
                    } else if (subject === "commerce" && urlPath === URL_PREFIX_DEFAULTS.checkout) {
                        assert.deepEqual(list, [CDL2_CONFIRM_PROP], `${subject} ${urlPath}: the confirmPrefix change`);
                        counts.checkout++;
                    } else if (subject === "commerce" && preCdl2Address(urlPath) !== urlPath) {
                        assert.deepEqual(list, CDL2_SEGMENT, `${subject} ${urlPath}: the route-segment texts of the moved address`);
                        counts.confirmation++;
                    } else {
                        assert.deepEqual(list, [], `${subject} ${urlPath}: nothing (no ledger row, no prop, no text)`);
                    }
                }
            }
            assert.deepEqual(counts, { interest: 30, checkout: 1, confirmation: 3 }, "the listing URLs");
            console.log(`  (loc1-subjects) ${Object.keys(want).length} subjects, ${Object.values(want).flat().length} URLs; ${counts.interest} catalog-mode HTML pages list CDL2-INTEREST-PATH, commerce /checkout and ${counts.confirmation} moved confirmation pages CDL2-CONFIRMATION, every other URL nothing: ${Object.keys(want).join(", ")}; RO copies ${Object.values(ro).flat().length} URLs; CQ1 ${Object.values(cq1).flat().length} URLs; CT1 ${Object.values(ct1).flat().length} URLs; ${moved.length} captures at their pre-cdl-2 address`);
        });

        for (const subject of Object.keys(EN_US_REQUESTS)) {
            test(`(loc1-text-${subject}) en-US subject ${subject}: the visible text of every captured URL equals the ${LOC1_START} capture, except exactly the listed ledger texts and listed removals`, async () => {
                const before = await loc1BeforeSet();
                const doc = await loc1Json("expected-diff.json");
                assert.deepEqual(textMismatches(before, await loc1EnSet(), subject, ledgerTexts(doc, subject), removedTexts(doc, subject)), [], `${subject}: visible text`);
                const html = before.captures.filter((c) => c.tenant === subject && isHtml(c));
                const listed = html.flatMap((c) => ledgerTexts(doc, subject)(c.path).map((t) => `${c.path} ${JSON.stringify(t.from)} → ${JSON.stringify(t.to)}`));
                const gone = html.flatMap((c) => removedTexts(doc, subject)(c.path).map((t) => `${c.path} ${t.kind} ${JSON.stringify(t.text)} at ${t.position}`));
                console.log(`  (loc1-text-${subject}) ${html.length} HTML URLs, ${html.reduce((n, c) => n + extractVisibleText(c.body).length, 0)} extracted items, all equal${listed.length ? ` except the listed ledger texts: ${listed.join("; ")}` : ""}${gone.length ? `; listed removals: ${gone.join("; ")}` : ""}`);
            });
        }

        // The bound mutation of the text rows (1a review-0 R1): for EVERY subject, one visible text added to one captured
        // page must be reported under that subject's own oracle.
        test("(loc1-text-mutation) for every en-US subject, a mutated visible text on one page is reported; the content home's review date put back to Romanian, or in another format, is reported; a Romanian commerce text on an en-US order page is reported", async () => {
            const before = await loc1BeforeSet();
            const cand = await loc1EnSet();
            const doc = await loc1Json("expected-diff.json");
            for (const subject of Object.keys(EN_US_REQUESTS)) {
                const page = cand.captures.find((c) => c.tenant === subject && isHtml(c) && c.body.includes("</body>"));
                assert.ok(page, `${subject} has an HTML page`);
                const mutated = { ...cand, captures: cand.captures.map((c) => (c === page ? { ...c, body: c.body.replace("</body>", "<p>LOC1 MUTATION</p></body>") } : c)) };
                assert.deepEqual(textMismatches(before, mutated, subject, ledgerTexts(doc, subject), removedTexts(doc, subject)).length, 1, `${subject}: the mutation was not reported`);
            }
            // The content home's review date (unchanged since d9999d2, its L-ALL-2 value): put back to Romanian, or in another
            // format — each is reported.
            const home = cand.captures.find((c) => c.tenant === "content" && c.path === "/");
            assert.ok(home.body.includes(">October 31, 2026<"), "mutation precondition: the content home shows the en-US review date");
            const withHome = (body) => ({ ...cand, captures: cand.captures.map((c) => (c === home ? { ...c, body } : c)) });
            assert.deepEqual(textMismatches(before, withHome(home.body.replace(">October 31, 2026<", ">31 octombrie 2026<")), "content", ledgerTexts(doc, "content")), ["/: visible text changed"], "the review date left Romanian was not reported");
            assert.deepEqual(textMismatches(before, withHome(home.body.replace(">October 31, 2026<", ">10/31/2026<")), "content", ledgerTexts(doc, "content")), ["/: visible text changed"], "another date format was not reported");
            assert.deepEqual(textMismatches(before, cand, "content", ledgerTexts(doc, "content")), [], "precondition: the content home's text is equal to d9999d2");
            // A commerce text left in Romanian on an en-US order page is reported (locale-1d: the order pages are subjects).
            const confirm = cand.captures.find((c) => c.tenant === "commerce" && c.path.startsWith(`${CONFIRMATION_ADDRESS}?id=cm1-order-bank`));
            const reverted = { ...cand, captures: cand.captures.map((c) => (c === confirm ? { ...c, body: c.body.replace(">Bank Transfer Details<", ">Detalii pentru transfer bancar<") } : c)) };
            assert.deepEqual(textMismatches(before, reverted, "commerce"), [`${confirm.path}: visible text changed`]);
        });

        // CAT-VARIANT-GALLERY-1 (operator ruling CVG1-TEXT-REMOVAL = A): the three refusals of a listed text removal, one
        // row each, on the real catalog /product/oak-plank, whose list removes the gallery counter "1 / 3". Each row first
        // proves its precondition (the page is exact under its real list), then shows the refusal through the text rows'
        // own oracle (`textMismatches`) and the reason through `textChanges`.
        // CDL-2: these rows read cat-variant-gallery-1's own record set (27fa7ca, `cvg1BeforeSet`, `cvg1Json`) — the counter
        // removal is a change against THAT start commit; the current set (cdl-2, 7bd3d51) already holds it.
        const cvg1Oak = async () => {
            const before = await cvg1BeforeSet();
            const cand = await loc1EnSet();
            const doc = await cvg1Json("expected-diff.json");
            const P = "/product/oak-plank";
            const gone = removedTexts(doc, "catalog")(P);
            assert.deepEqual(gone, [{ kind: "text", text: "1 / 3", position: gone[0]?.position }], "precondition: oak-plank lists one removal, the counter");
            assert.deepEqual(textMismatches(before, cand, "catalog", ledgerTexts(doc, "catalog"), removedTexts(doc, "catalog")), [], "precondition: the catalog text is exact under its list");
            const b = before.captures.find((c) => c.tenant === "catalog" && c.path === P);
            const a = cand.captures.find((c) => c.tenant === "catalog" && c.path === P);
            return { before, cand, doc, P, gone, b, a, ledger: ledgerTexts(doc, "catalog") };
        };
        const only = (P, list) => (p) => (p === P ? list : []);

        test("(cvg1-text-removal-unlisted) a removed text that is not listed is reported", async () => {
            const { before, cand, P, b, a, ledger } = await cvg1Oak();
            assert.deepEqual(textMismatches(before, cand, "catalog", ledger, () => []), [`${P}: visible text changed`]);
            assert.throws(() => textChanges(extractVisibleText(b.body), extractVisibleText(a.body)), /extractions differ in length/);
            // A second, unlisted removal next to the listed one: the page's title text taken out of the after body.
            assert.ok(a.body.includes(">Oak Plank</h1>"), "mutation precondition: the product title is server-rendered once in an h1");
            const mutated = { ...cand, captures: cand.captures.map((c) => (c === a ? { ...c, body: c.body.replace(">Oak Plank</h1>", "></h1>") } : c)) };
            assert.deepEqual(textMismatches(before, mutated, "catalog", ledger, removedTexts(await cvg1Json("expected-diff.json"), "catalog")), [`${P}: visible text changed`]);
            console.log("  (cvg1-text-removal-unlisted) the counter removal without its list entry, and a second unlisted removal, are reported");
        });

        test("(cvg1-text-removal-missing) a listed removal that did not happen is reported", async () => {
            const { before, cand, doc, P, gone, b, ledger } = await cvg1Oak();
            // The after page = the 27fa7ca page itself (the counter still there), with the real list.
            const unchanged = { ...cand, captures: cand.captures.map((c) => (c.tenant === "catalog" && c.path === P ? { ...c, body: b.body } : c)) };
            assert.deepEqual(textMismatches(before, unchanged, "catalog", ledger, only(P, gone)), [`${P}: visible text changed`]);
            assert.throws(() => textChanges(extractVisibleText(b.body), extractVisibleText(b.body), gone), /extractions differ in length/);
            // A listed removal on a page whose text did not change at all (legacy-plank: its h1 title, really there).
            const legacy = "/product/legacy-plank";
            const at = extractVisibleText(before.captures.find((c) => c.tenant === "catalog" && c.path === legacy).body).findIndex((i) => i.kind === "text" && i.text === "Legacy Plank");
            assert.ok(at >= 0, "mutation precondition: legacy-plank's title is an extracted text");
            const withLegacy = (p) => (p === legacy ? [{ kind: "text", text: "Legacy Plank", position: at }] : removedTexts(doc, "catalog")(p));
            assert.deepEqual(textMismatches(before, cand, "catalog", ledger, withLegacy), [`${legacy}: visible text changed`]);
            console.log("  (cvg1-text-removal-missing) a listed removal on the unchanged page, and one on a page without removals, are reported");
        });

        test("(cvg1-text-removal-wrong-text) a listed removal with another text, kind or position is reported", async () => {
            const { before, cand, P, gone, b, a, ledger } = await cvg1Oak();
            const [r] = gone;
            for (const [label, wrong] of [["text", { ...r, text: "1 / 4" }], ["kind", { ...r, kind: "@alt" }], ["position", { ...r, position: r.position - 1 }]]) {
                assert.deepEqual(textMismatches(before, cand, "catalog", ledger, only(P, [wrong])), [`${P}: visible text changed`], `wrong ${label}`);
                assert.throws(() => textChanges(extractVisibleText(b.body), extractVisibleText(a.body), [wrong]), /listed removal does not match/, `wrong ${label}: the reason`);
            }
            assert.deepEqual(textChanges(extractVisibleText(b.body), extractVisibleText(a.body), gone), [], "control: the real list leaves no change");
            console.log(`  (cvg1-text-removal-wrong-text) "1 / 4", kind @alt and position ${r.position - 1} are refused; the real entry is accepted`);
        });

        test(`(loc1-diff-cdl-2) en-US subjects: every byte difference to the ${LOC1_START} capture is listed in ${LOC1_SLICE}/expected-diff.json, and every listed one occurs`, async () => {
            const before = await loc1BeforeSet();
            const cand = await loc1EnSet();
            const doc = await loc1Json("expected-diff.json");
            const problems = [];
            assert.ok(!Object.hasOwn(doc, "byteGateExclusions"), "expected-diff.json must not exclude any URL");
            // No URL is excluded and no diagnostic is discarded (operator ruling LOCALE1B-ROW-CUT = A): the payload is
            // compared as resolved trees (locale-1/proof.mjs resolveFlight), which ignores row labels and row cuts only.
            assert.ok(!Object.hasOwn(doc, "payloadRowCutPending"), "expected-diff.json must not waive any payload comparison");
            for (const subject of Object.keys(EN_US_REQUESTS)) {
                for (const b of before.captures.filter((c) => c.tenant === subject)) {
                    const a = cand.captures.find((c) => c.tenant === subject && c.path === b.path);
                    if (a.status !== b.status || a.contentType !== b.contentType) { problems.push(`${subject} ${b.path}: status/Content-Type changed`); continue; }
                    const expected = expectedFor(doc, subject, b.path);
                    for (const p of checkExpected(before, b.body, cand, a.body, expected)) problems.push(`${subject} ${b.path}: ${p}`);
                    console.log(`  (loc1-diff-cdl-2) ${subject} ${b.path}: ${expected.length} listed difference(s)${expected.length ? ` [${[...new Set(expected.map((e) => e.row))].join(", ")}]` : ""}`);
                }
            }
            assert.deepEqual(problems, []);
            // The checker can fail (the bound mutations of this row). On a catalog product page: a ghost entry, one of its
            // listed CDL2-INTEREST-PATH entries left out, the toggle's variant changed in the payload, one changed HTML byte, and
            // each editorial class or marker of cat-theme-1 put into the page (the HTML — a theme field leaking to a tenant
            // without it). On the content home: one
            // changed HTML byte, the review date in another format, a changed block text in the payload, a block text in
            // Romanian in the HTML. On an order page: one changed text.
            const pick = (subject, p) => [before.captures.find((c) => c.tenant === subject && c.path === p), cand.captures.find((c) => c.tenant === subject && c.path === p)];
            const [bp, ap] = pick("catalog", "/product/oak-plank");
            const link = expectedFor(doc, "catalog", "/product/oak-plank");
            assert.ok(link.length > 0 && link.every((e) => e.row === "CDL2-INTEREST-PATH"), "precondition: catalog /product/oak-plank lists only the CDL2-INTEREST-PATH change");
            assert.deepEqual(checkExpected(before, bp.body, cand, ap.body, link), [], "precondition: catalog /product/oak-plank is exact under its list");
            const ghost = { category: 2, element: "[project]/renderer/src/components/QuoteRequest.tsx#QuoteRequest", prop: "strings", value: {} };
            assert.notDeepEqual(checkExpected(before, bp.body, cand, ap.body, [...link, ghost]), [], "a listed entry that does not occur was not reported");
            for (let i = 0; i < link.length; i++) {
                assert.notDeepEqual(checkExpected(before, bp.body, cand, ap.body, link.filter((_, j) => j !== i)), [], `a CDL2-INTEREST-PATH change left out of the list (entry ${i}) was not reported`);
            }
            const variantLink = '\\"variant\\":\\"link\\"';
            assert.equal(ap.body.split(variantLink).length - 1, 1, "mutation precondition: the toggle's variant travels once in the payload");
            assert.notDeepEqual(checkExpected(before, bp.body, cand, ap.body.replace(variantLink, '\\"variant\\":\\"page\\"'), link), [], "a changed toggle variant in the payload was not reported");
            assert.notDeepEqual(checkExpected(before, bp.body, cand, ap.body.replace(">Oak Plank<", ">0ak Plank<"), link), [], "a changed HTML byte on the product page was not reported");
            const leaks = {
                "the editorial spec table": ['<dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm border-t pt-4">', '<dl class="grid grid-cols-2 gap-x-6 text-sm border-t">'],
                "the header's top border": ['<div class="sticky top-0 z-50">', '<div class="sticky top-0 z-50 border-t-[3px] border-primary">'],
                "the editorial footer": ['<footer class="border-t py-12 bg-muted/30 site-footer">', '<footer class="border-t py-12 bg-muted site-footer">'],
                "an arrow marker": ['href="/contact"', 'data-theme-arrow="" href="/contact"'],
                "the nav font": ['class="hidden md:flex items-center gap-8"', 'class="hidden md:flex items-center gap-8 font-[family-name:var(--font-nav)]"'],
            };
            for (const [name, [from, to]] of Object.entries(leaks)) {
                assert.equal(ap.body.split(from).length - 1, 1, `mutation precondition (${name}): ${from}`);
                assert.notDeepEqual(checkExpected(before, bp.body, cand, ap.body.replace(from, to), link), [], `${name} on a tenant without the field was not reported`);
            }
            const [b, a] = pick("content", "/");
            const listed = expectedFor(doc, "content", "/");
            assert.deepEqual(listed, [], "precondition: content / lists nothing");
            assert.deepEqual(checkExpected(before, b.body, cand, a.body, listed), [], "precondition: content / is byte-equal");
            assert.notDeepEqual(checkExpected(before, b.body, cand, a.body, [ghost]), [], "a listed entry that does not occur on content / was not reported");
            assert.notDeepEqual(checkExpected(before, b.body, cand, a.body.replace("CM1 Content", "CM1 C0ntent"), listed), [], "a changed HTML byte was not reported");
            assert.equal(a.body.split(">October 31, 2026<").length, 2, "mutation precondition: the review date occurs once in the HTML");
            assert.notDeepEqual(checkExpected(before, b.body, cand, a.body.replace(">October 31, 2026<", ">10/31/2026<"), listed), [], "the review date in another format was not reported");
            const label = '\\"contactName\\":\\"Name\\"';
            assert.ok(a.body.includes(label), "mutation precondition: the block texts travel in the captured payload");
            assert.notDeepEqual(checkExpected(before, b.body, cand, a.body.replace(label, '\\"contactName\\":\\"Nume\\"'), listed), [], "a changed block text in the payload was not reported");
            assert.ok(a.body.includes(">Name</label>"), "mutation precondition: the contact block's label is server-rendered");
            assert.notDeepEqual(checkExpected(before, b.body, cand, a.body.replace(">Name</label>", ">Nume</label>"), listed), [], "a block text left in Romanian was not reported");
            const [bo, ao] = pick("commerce", "/checkout/cm1-order-cod?email=buyer%40serving-contract.test");
            const orderListed = expectedFor(doc, "commerce", bo.path);
            assert.ok(ao.body.includes(">Tracking Number: <"), "mutation precondition: the tracking page shows its tracking number label");
            assert.notDeepEqual(checkExpected(before, bo.body, cand, ao.body.replace(">Tracking Number: <", ">Tracking number: <"), orderListed), [], "a changed order-page text was not reported");
            // CDL-2 controls. The interest path: the old address left in the payload, or another address in the header
            // link, is reported under the real list.
            const interestAddressNow = '\\"listPrefix\\":\\"/my-list\\"';
            assert.equal(ap.body.split(interestAddressNow).length - 1, 1, "mutation precondition: the interest address travels once in the payload");
            assert.notDeepEqual(checkExpected(before, bp.body, cand, ap.body.replace(interestAddressNow, '\\"listPrefix\\":\\"/lista-mea\\"'), link), [], "the old interest address left in the payload was not reported");
            assert.notDeepEqual(checkExpected(before, bp.body, cand, ap.body.replace('href="/my-list"><span class="relative">', 'href="/my-lists"><span class="relative">'), link), [], "another interest address in the header link was not reported");
            // The confirmation: /checkout without its listed prop, or with the old confirmPrefix, is reported; a moved
            // confirmation page without its listed route-segment texts, or with a changed text, is reported.
            const [bk, ak] = pick("commerce", URL_PREFIX_DEFAULTS.checkout);
            const confirmListed = expectedFor(doc, "commerce", URL_PREFIX_DEFAULTS.checkout);
            assert.deepEqual(checkExpected(before, bk.body, cand, ak.body, confirmListed), [], "precondition: commerce /checkout is exact under its list");
            assert.notDeepEqual(checkExpected(before, bk.body, cand, ak.body, []), [], "the confirmPrefix change unlisted was not reported");
            const confirmPrefixNow = `\\"confirmPrefix\\":\\"${CONFIRMATION_ADDRESS}\\"`;
            assert.equal(ak.body.split(confirmPrefixNow).length - 1, 1, "mutation precondition: confirmPrefix travels once in the payload");
            assert.notDeepEqual(checkExpected(before, bk.body, cand, ak.body.replace(confirmPrefixNow, `\\"confirmPrefix\\":\\"/checkout/multumim\\"`), confirmListed), [], "another confirmPrefix was not reported");
            const bankPath = `${CONFIRMATION_ADDRESS}?id=cm1-order-bank&email=buyer%40serving-contract.test`;
            const [bc, ac] = pick("commerce", bankPath);
            assert.equal(bc.requestedPath, preCdl2Address(bankPath), "precondition: the before side was served at the pre-cdl-2 address");
            const segListed = expectedFor(doc, "commerce", bankPath);
            assert.deepEqual(checkExpected(before, bc.body, cand, ac.body, segListed), [], "precondition: the moved bank confirmation is exact under its list");
            for (let i = 0; i < segListed.length; i++) assert.notDeepEqual(checkExpected(before, bc.body, cand, ac.body, segListed.filter((_, j) => j !== i)), [], `a route-segment text left out (entry ${i}) was not reported`);
            assert.notDeepEqual(checkExpected(before, bc.body, cand, ac.body.replace(">Bank Transfer Details<", ">Bank transfer details<"), segListed), [], "a changed text on the moved confirmation page was not reported");
            // The moved page compared with the TRACKING page of the old address (what a wrong mapping would pick): reported.
            const [, trackAtOld] = pick("commerce", `/checkout/cm1-order-cod?email=buyer%40serving-contract.test`);
            assert.notDeepEqual(checkExpected(before, bc.body, cand, trackAtOld.body, segListed), [], "another page in place of the confirmation was not reported");
        });

        // LOCALE-1E — the refusals of category 4 (operator rulings LOC1E-STRUCTURE-CATEGORY = A, LOC1E-404-SHELL-PRELOAD = A,
        // iteration-1 R1): each mutation of a REAL captured page must be reported although the move is listed.
        // Content home (200), after side: a text inside the new wrapper; the wrapper's `lang`; every stylesheet href; a
        // second stylesheet link; one removed script; a text inside the root 404 boundary; CHANGED URLs that CM1-A1 masks —
        // the `[siteId]` script `src`, the payload stylesheet `href`, the head stylesheet `href`, the removed root-layout
        // script's `src` in the head; an expected `lang` that differs; the head stylesheet removed. Before side: a style
        // preload removed on a 200 page. Content /cart 307 shell: a missing preload with another href; two missing preloads.
        // Positive controls: both pages exact under the listed move.
        test("(loc1e-category-controls) category 4 accepts exactly the enumerated root-layout move: every other change on a real page is reported", async () => {
            // CAT-QUOTE-1: the locale-1e record set (d9999d2 + its category-4 list), read explicitly (the current set is variant-gallery-1).
            const before = await loc1eBeforeSet();
            const cand = await loc1EnSet();
            const doc = await loc1eJson("expected-diff.json");
            const pick = (subject, p) => [before.captures.find((c) => c.tenant === subject && c.path === p), cand.captures.find((c) => c.tenant === subject && c.path === p)];
            const [b, a] = pick("content", "/");
            const move = expectedFor(doc, "content", "/");
            const check = (body, list = move, beforeBody = b.body) => checkExpected(before, beforeBody, cand, body, list);
            assert.deepEqual(check(a.body), [], "positive control: content / is exact under the listed move");
            const once = (body, from, to) => { assert.ok(body.includes(from), `mutation precondition: ${from.slice(0, 60)}`); return body.replace(from, to); };
            const esc = (v) => `\\"${v}\\"`;   // a JSON string as it appears inside the escaped flight chunks
            const flightA = splitFlight(a.body).flight, flightB = splitFlight(b.body).flight;
            const css = /"rel":"stylesheet","href":"(\/_next\/static\/[^"]+)"/.exec(flightA)?.[1];
            assert.ok(css, "mutation precondition: a payload stylesheet href");
            const link = new RegExp(`\\[\\\\"\\$\\\\",\\\\"link\\\\",\\\\"0\\\\",\\{[^\\]]*${css.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\]]*\\]`).exec(a.body)?.[0];
            assert.ok(link, "mutation precondition: the escaped stylesheet link element");
            const script = /,\[\\"\$\\",\\"script\\",\\"script-1\\",\{[^\]]*\}\]/.exec(a.body)?.[0];
            assert.ok(script, "mutation precondition: an escaped script element");
            // The `[siteId]` segment's first script: the element right after the moved stylesheet link.
            const siteScript = /"rel":"stylesheet","href":"[^"]+","precedence":"next","crossOrigin":"\$undefined","nonce":"\$undefined"\}\],\["\$","script","script-0",\{"src":"([^"]+)"/.exec(flightA)?.[1];
            assert.ok(siteScript, "mutation precondition: the [siteId] script src");
            // The removed root-layout script as the after head loads it, named by THIS build (NEXT-PATCH-1 ruling R-NP1-F1
            // rule 3: `readRootNotFoundScript`, the root 404 boundary's JS entry in the build's manifests). Before next
            // 16.4.6 it was found as "the before payload script the after head still loads" — that pinned the content hash
            // of a chunk of Next's own client code, a name that can change with a framework update (it did from 16.4.3
            // to 16.4.6).
            const srcs = (f) => [...f.matchAll(/"src":"(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]);
            assert.equal(cand.rootNotFoundScript?.kind, "script", `precondition: the build names the root-layout script (${cand.rootNotFoundScript?.problem})`);
            const rootScript = cand.rootNotFoundScript.src;
            assert.ok(!srcs(flightA).includes(rootScript) && a.body.includes(`<script src="${rootScript}" async="">`), `mutation precondition: ${rootScript} is no after payload script and the after head loads it`);
            // The tenant wrapper is the `html` element whose `body` holds a client component (`Providers`); the root 404
            // boundary's `html` holds a list (title, 404 UI). Exactly one occurrence must change.
            const WRAPPER = /(\[\\"\$\\",\\"html\\",null,\{\\"lang\\":\\")en(\\",\\"children\\":\[\\"\$\\",\\"body\\",null,\{\\"className\\":\\"[^\\]*\\",\\"children\\":\[\\"\$\\",\\"\$L)/g;
            const wrapperLang = (body) => {
                assert.equal([...body.matchAll(WRAPPER)].length, 1, "mutation precondition: exactly one tenant wrapper <html> in the payload");
                return body.replace(WRAPPER, "$1ro$2");
            };
            const OTHER_CSS = "/_next/static/chunks/loc1e-other.css";
            const refusals = {
                "a text inside the wrapper": once(a.body, '\\"contactName\\":\\"Name\\"', '\\"contactName\\":\\"Nume\\"'),
                "the wrapper lang": wrapperLang(a.body),
                "a second stylesheet link": once(a.body, link, `${link},${link}`),
                "one removed script": once(a.body, script, ""),
                "a text inside the root 404 boundary": once(a.body, "This page could not be found.", "This page could not be f0und."),
                "a changed [siteId] script src (payload only)": a.body.split(`\\"src\\":${esc(siteScript)}`).join(`\\"src\\":${esc("/_next/static/chunks/loc1e-other.js")}`),
                "a changed payload stylesheet href (the [siteId] link only)": once(a.body, `\\"href\\":${esc(css)}`, `\\"href\\":${esc(OTHER_CSS)}`),
                "a changed head stylesheet href (HTML only)": once(a.body, `<link rel="stylesheet" href="${css}" data-precedence="next"/>`, `<link rel="stylesheet" href="${OTHER_CSS}" data-precedence="next"/>`),
                "a changed root-layout script src in the head": once(a.body, `<script src="${rootScript}" async="">`, `<script src="/_next/static/chunks/loc1e-other.js" async="">`),
                "a removed head stylesheet": once(a.body, `<link rel="stylesheet" href="${css}" data-precedence="next"/>`, ""),
                // CAT-QUOTE-1 (F-CQ-3): the head must hold exactly as many stylesheets as before, each the payload's.
                "a second head stylesheet (same href)": once(a.body, `<link rel="stylesheet" href="${css}" data-precedence="next"/>`, `<link rel="stylesheet" href="${css}" data-precedence="next"/><link rel="stylesheet" href="${css}" data-precedence="next"/>`),
                "a second head stylesheet (another href)": once(a.body, `<link rel="stylesheet" href="${css}" data-precedence="next"/>`, `<link rel="stylesheet" href="${css}" data-precedence="next"/><link rel="stylesheet" href="${OTHER_CSS}" data-precedence="next"/>`),
            };
            for (const [name, body] of Object.entries(refusals)) {
                assert.notEqual(body, a.body, `${name}: the mutation did not change the body`);
                assert.notDeepEqual(check(body), [], `${name} was not reported`);
            }
            // CAT-QUOTE-1 (F-CQ-3, locale-1e.md § 18 appended 2026-11-02): a stylesheet renamed CONSISTENTLY — head, payload
            // link and 404 boundary, what a new client build does — is accepted (the former refusal "every stylesheet href
            // changed" pinned the content hash of d9999d2's stylesheet). Exactly one head stylesheet is named css.
            assert.equal(a.body.split(`<link rel="stylesheet" href="${css}" data-precedence="next"/>`).length - 1, 1, "precondition: one head stylesheet");
            assert.deepEqual(check(a.body.split(css).join(OTHER_CSS)), [], "positive control: a consistently renamed stylesheet (a new build's hash) is accepted");
            // locale-1e.md § 18 (CAT-IMPORT-GALLERY-1): the [siteId] resources are checked against the LIVE document. Each
            // control must be reported by the raw rule itself ("category 4 (raw): …"), not only by the masked comparison.
            const siteScriptEl = new RegExp(`\\[\\\\"\\$\\\\",\\\\"script\\\\",\\\\"script-0\\\\",\\{\\\\"src\\\\":\\\\"${siteScript.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\\\"[^\\]]*\\]`).exec(a.body)?.[0];
            assert.ok(siteScriptEl, "mutation precondition: the escaped [siteId] script-0 element");
            const siteLinkThenScript = `${link},${siteScriptEl}`;
            const liveControls = {
                "a [siteId] script the live head does not load (head tag renamed, HTML only)":
                    once(a.body, `<script src="${siteScript}" async="">`, `<script src="/_next/static/chunks/loc1e-other.js" async="">`),
                "a [siteId] script the live head does not load (payload src renamed)":
                    a.body.split(`\\"src\\":${esc(siteScript)}`).join(`\\"src\\":${esc("/_next/static/chunks/loc1e-other.js")}`),
                "a second stylesheet in the [siteId] resources": once(a.body, siteLinkThenScript, `${link},${siteLinkThenScript}`),
                "one [siteId] script more than before": once(a.body, siteLinkThenScript, `${siteLinkThenScript},${siteScriptEl}`),
                "one [siteId] script fewer than before": once(a.body, siteLinkThenScript, link),
            };
            for (const [name, body] of Object.entries(liveControls)) {
                assert.notEqual(body, a.body, `${name}: the mutation did not change the body`);
                const problems = check(body);
                assert.ok(problems.some((p) => p.startsWith("category 4 (raw):")), `${name} was not reported by the raw rule: ${JSON.stringify(problems)}`);
            }
            assert.notDeepEqual(check(a.body, [{ ...move[0], lang: "ro" }]), [], "an expected lang other than the rendered one was not reported");
            assert.notDeepEqual(check(a.body, [{ ...move[0], shellPreload: true }]), [], "a category-4 entry with an extra field was not reported");
            // A style preload removed on a 200 page (the before side holds one, the after side not): refused.
            // CAT-QUOTE-1 (F-CQ-3): the before side's preloads name the BEFORE stylesheet (`cssB`), not this build's.
            const cssB = /"rel":"stylesheet","href":"(\/_next\/static\/[^"]+)"/.exec(flightB)?.[1];
            assert.ok(cssB, "mutation precondition: the before payload stylesheet href");
            const preloaded = once(b.body, "</head>", `<link rel="preload" href="${cssB}" as="style"/></head>`);
            assert.notDeepEqual(check(a.body, move, preloaded), [], "a preload removal on a 200 page was not reported");
            // The 307 shell: exact as captured; a missing preload of another href, and two missing preloads, are refused.
            const [bs, as] = pick("content", "/cart");
            const shellMove = expectedFor(doc, "content", "/cart");
            const preload = `<link rel="preload" href="${cssB}" as="style"/>`;
            assert.ok(bs.body.startsWith('<!DOCTYPE html><html id="__next_error__">') && bs.body.includes(preload) && !as.body.includes(preload) && !as.body.includes(`<link rel="preload" href="${css}" as="style"/>`), "precondition: content /cart is a shell that loses the preload");
            const reference = liveSiteIdReference(cand);
            assert.equal(reference.kind, "resources", `precondition: the live 200 pages give a shell reference (${reference.problem})`);
            assert.deepEqual(checkExpected(before, bs.body, cand, as.body, shellMove, reference), [], "positive control: the 307 shell is exact under the listed move");
            assert.notDeepEqual(checkExpected(before, once(bs.body, preload, `<link rel="preload" href="${OTHER_CSS}" as="style"/>`), cand, as.body, shellMove, reference), [], "a shell missing a preload of another href was not reported");
            assert.notDeepEqual(checkExpected(before, once(bs.body, preload, `${preload}${preload}`), cand, as.body, shellMove, reference), [], "a shell missing two preloads was not reported");
            // locale-1e.md § 18 shell rule (operator ruling CIG-SERVING-SHELL = A, fail closed): each control must be
            // reported by the raw rule itself.
            const shellCheck = (body, ref = reference) => checkExpected(before, bs.body, cand, body, shellMove, ref);
            const rawReported = (name, problems) => assert.ok(problems.some((p) => p.startsWith("category 4 (raw):")), `${name} was not reported by the raw rule: ${JSON.stringify(problems)}`);
            const shellControls = {
                "a shell naming a stylesheet the reference does not": as.body.split(css).join(OTHER_CSS),
                "a shell with one [siteId] script fewer": once(as.body, siteLinkThenScript, link),
                "a shell with a foreign [siteId] script": as.body.split(`\\"src\\":${esc(siteScript)}`).join(`\\"src\\":${esc("/_next/static/chunks/loc1e-other.js")}`),
            };
            for (const [name, body] of Object.entries(shellControls)) {
                assert.notEqual(body, as.body, `${name}: the mutation did not change the body`);
                rawReported(name, shellCheck(body));
            }
            // A set whose 200 pages disagree: the content home renamed its [siteId] script in payload AND head (itself
            // self-consistent) — the reference must refuse, and the shell check must report it.
            const disagreeing = a.body.split(siteScript).join("/_next/static/chunks/loc1e-other.js");
            const split = liveSiteIdReference({ ...cand, captures: cand.captures.map((c) => (c === a ? { ...a, body: disagreeing } : c)) });
            assert.equal(split.kind, "problem", "a set whose 200 pages disagree gave a reference");
            rawReported("a set whose 200 pages disagree", shellCheck(as.body, split));
            const noPage = liveSiteIdReference({ ...cand, captures: [as] });
            assert.equal(noPage.kind, "problem", "a set without a 200 page gave a reference");
            rawReported("a set without a live 200 page", shellCheck(as.body, noPage));
            rawReported("a shell checked without a reference", checkExpected(before, bs.body, cand, as.body, shellMove));
            // NEXT-PATCH-1 rule 3, fail closed: the after root-layout script comes only from the build's own name.
            const rootControls = {
                "an after set without a build-derived root-layout script": { ...cand, rootNotFoundScript: undefined },
                "an after set whose build named no root-layout script": { ...cand, rootNotFoundScript: { kind: "problem", problem: "control" } },
                "a build-derived root-layout script the after head does not load": { ...cand, rootNotFoundScript: { kind: "script", src: "/_next/static/chunks/loc1e-other.js" } },
            };
            for (const [name, set] of Object.entries(rootControls)) rawReported(name, checkExpected(before, b.body, set, a.body, move));
            const extra = ["an expected lang ro", "an extra entry field", "a preload removal on a 200 page", "a shell missing another href", "a shell missing two preloads",
                ...Object.keys(shellControls), "a set whose 200 pages disagree", "a set without a live 200 page", "a shell checked without a reference", ...Object.keys(rootControls)];
            console.log(`  (loc1e-category-controls) 3 positive controls exact (one: a consistently renamed stylesheet, F-CQ-3); ${Object.keys(refusals).length + extra.length} refusals reported (${[...Object.keys(refusals), ...extra].join("; ")}); ${Object.keys(liveControls).length} § 18 live-document controls reported by the raw rule (${Object.keys(liveControls).join("; ")})`);
        });

        // LOCALE-1B: the facet ids are URL contract (§ 6.3): every filter href of every catalog page is the same as before
        // the slice, on the en-US catalog subjects and on the RO copy, and no href carries a heading in place of an id.
        test(`(loc1-facet-hrefs) the facet ids are unchanged in every href of the catalog pages (EN subjects and the RO copy, each against its own ${LOC1_START} capture)`, async () => {
            const before = await loc1BeforeSet();
            const cand = await loc1EnSet();
            const ro = await loc1RoSet();
            const filterHrefs = (body) => [...splitFlight(body).html.matchAll(/href="([^"]*[?&]f=[^"]*)"/g)].map((m) => decodeURIComponent(m[1].replace(/&amp;/g, "&")));
            let n = 0;
            for (const [tenant, side, source] of [["catalog", cand, "catalog"], ["cip1b-catalog", cand, "cip1b-catalog"], ["roCatalog", { captures: ro }, "roCatalog"]]) {
                for (const a of side.captures.filter((c) => c.tenant === tenant && isHtml(c))) {
                    const b = before.captures.find((c) => c.tenant === source && c.path === a.path);
                    const got = filterHrefs(a.body);
                    assert.deepEqual(got, filterHrefs(b.body), `${tenant} ${a.path}: a filter href changed`);
                    for (const h of got) assert.doesNotMatch(h, /[?&]f=.*(?:Brand|Option|Producător|Variantă)=/, `${tenant} ${a.path}: a heading in place of a facet id: ${h}`);
                    n += got.length;
                }
            }
            assert.ok(n > 0, "the captures hold filter hrefs");
            console.log(`  (loc1-facet-hrefs) ${n} filter hrefs equal to the ${LOC1_START} capture`);
        });

        // The bound controls of the ruled payload comparison (operator ruling LOCALE1B-ROW-CUT = A, 2026-11-01; it
        // replaces the 1a renumbering and keeps all of the 1a controls): row labels and row CUTS are ignored; every value,
        // key, element, typed reference, non-model row and unreferenced row is still compared; an unknown form fails closed.
        test("(loc1-flight-controls) the resolved-tree payload comparison ignores row labels and row cuts only: every mutation is reported, a renaming or a different cut is not, an unknown form fails closed", async () => {
            const side = { buildId: "", clientModules: {} };
            const body = (rows, html = "<p>page</p>") => `<html><body>${html}<script>self.__next_f.push([1,${JSON.stringify(rows.join("\n") + "\n")}])</script></body></html>`;
            const cmp = (before, after, beforeHtml, afterHtml) => checkExpected(side, body(before, beforeHtml), side, body(after, afterHtml), []);
            // The 1a base: an object KEY that looks like a reference (data), a Set reference (`$W`), a reference with a
            // path, a lazy reference, and an error row whose digest looks like a reference (literal, never scanned).
            const base = [
                '0:["$","div",null,{"children":["$1","$2"],"data":{"$1":"a key, not a reference"},"set":"$W4","deep":"$2:props:children"}]',
                '1:["$","p",null,{"children":"$L3"}]',
                '2:["$","span",null,{"children":"two"}]',
                '3:["$","b",null,{"children":"three"}]',
                '4:["s1","s2"]',
                '5:E{"digest":"$2"}',
            ];
            // positive (1a): the same graph, rows permuted, every LABEL renamed with every reference to it.
            assert.deepEqual(cmp(base, [
                'c:E{"digest":"$2"}',
                '7:["$","b",null,{"children":"three"}]',
                '6:["s1","s2"]',
                '0:["$","div",null,{"children":["$9","$8"],"data":{"$1":"a key, not a reference"},"set":"$W6","deep":"$8:props:children"}]',
                '8:["$","span",null,{"children":"two"}]',
                '9:["$","p",null,{"children":"$L7"}]',
            ]), [], "a consistent renaming must compare equal");
            // positive (1b): the same tree CUT into rows at other points — everything inline, the encoder's lazy outline
            // of an element (`$L` to a model row, deferTask), a plain outline, and a long text as a text row glued on the
            // line of the next row (a text row is length-prefixed).
            const inline = ['0:["$","main",null,{"children":[["$","p",null,{"children":"abc"}],["$","b",null,{"children":["x","y"]}]],"title":"hello"}]'];
            assert.deepEqual(cmp(inline, [
                '0:["$","main",null,{"children":["$L1","$L2"],"title":"$3"}]',
                '1:["$","p",null,{"children":"$4"}]',
                '2:["$","b",null,{"children":"$5"}]',
                '3:T5,hello4:"abc"',
                '5:["x","y"]',
            ]), [], "the same tree cut into rows at other points must compare equal");
            const mutations = {
                "rewired reference (row 0 points to 3 instead of 2)": [base[0].replace('["$1","$2"]', '["$1","$3"]'), ...base.slice(1)],
                "changed value inside one row": [base[0], base[1], base[2].replace('"two"', '"TWO"'), ...base.slice(3)],
                "changed value in a deep row (0 → 1 → lazy 3)": [base[0], base[1], base[2], base[3].replace('"three"', '"THREE"'), base[4], base[5]],
                "dropped row": [base[0], base[1], base[2], base[4], base[5]],
                "added unreferenced row": [...base, '6:["$","i",null,{"children":"extra"}]'],
                "two rows' contents swapped": [base[0], base[1], base[3].replace(/^3:/, "2:"), base[2].replace(/^2:/, "3:"), base[4], base[5]],
            };
            for (const [name, rows] of Object.entries(mutations)) assert.notDeepEqual(cmp(base, rows), [], `${name} was not reported`);
            assert.notDeepEqual(cmp(base, base, "<p>page</p>", "<p>pagE</p>"), [], "one changed HTML byte was not reported");
            // 1a review-2 R5 counterexamples — each must still be reported.
            const r5 = {
                "object key changed from $1 to $7 (with a reference that moved with it)": [['0:{"$1":"x","r":"$1"}', '1:["a"]'], ['0:{"$7":"x","r":"$7"}', '7:["a"]']],
                "error digest changed from $2 to $9": [['0:["$L1"]', '1:E{"digest":"$2"}', '2:["x"]'], ['0:["$L1"]', '1:E{"digest":"$9"}', '9:["x"]']],
                "Set reference $W1 retargeted from row A to row B": [['0:["$2","$W1"]', '1:["a"]', '2:["b"]'], ['0:["$1","$W1"]', '1:["b"]', '2:["a"]']],
            };
            for (const [name, [before, after]] of Object.entries(r5)) assert.notDeepEqual(cmp(before, after), [], `R5: ${name} was not reported`);
            // Typed references stay typed (never silently dropped): an element that became an error (lazy → error row),
            // a Map that became an array, a promise that became a value — each is reported.
            const typed = {
                "element → error (lazy reference to an error row)": [['0:["$L1"]', '1:["$","p",null,{}]'], ['0:["$L1"]', '1:E{"digest":"d"}']],
                "Map → plain array": [['0:{"m":"$Q1"}', '1:[["k","v"]]'], ['0:{"m":[["k","v"]]}']],
                "promise → plain value": [['0:{"v":"$@1"}', '1:"x"'], ['0:{"v":"x"}']],
            };
            for (const [name, [before, after]] of Object.entries(typed)) assert.notDeepEqual(cmp(before, after), [], `typed: ${name} was not reported`);
            // The second review-0's controls (R4, R5; operator rulings § 7), as the review states them: content outside a
            // referenced path, a dropped null root, a Map versus an ordinary object, raw objects that impersonate the
            // comparator's error-row and missing-reference markers, and an own `__proto__` key — each is reported; a
            // disconnected cycle fails closed.
            const review2 = {
                "R4 unreached content change (a path reference into row 1; its other key changed)": [['0:{"x":"$1:a"}', '1:{"a":"keep","b":"before"}'], ['0:{"x":"$1:a"}', '1:{"a":"keep","b":"CHANGED"}']],
                "R4 dropped null root": [['0:null'], []],
                "R5 Map vs ordinary object": [['0:{"m":"$Q1"}', '1:[["k","v"]]'], ['0:{"m":{"$ref":"Q","to":[["k","v"]]}}']],
                "R5 error-row marker impersonation": [['0:["$L1"]', '1:E{"digest":"d"}'], ['0:[{"$ref":"L","to":{"$row":["E{\\"digest\\":\\"d\\"}"]}}]']],
                "R5 missing-reference marker impersonation": [['0:["$1"]'], ['0:[{"$missing":""}]']],
                "R5 __proto__ key": [['0:{"__proto__":{"x":"changed"}}'], ['0:{}']],
                // operator clarification § 7 item 2: `$L` to a non-element row stays a typed lazy reference.
                "lazy reference to a non-element row vs a plain one ($L1 vs $1, row 1:{\"x\":1})": [['0:{"v":"$L1"}', '1:{"x":1}'], ['0:{"v":"$1"}', '1:{"x":1}']],
            };
            for (const [name, [before, after]] of Object.entries(review2)) assert.notDeepEqual(cmp(before, after), [], `${name} was not reported`);
            assert.throws(() => cmp(['0:{"ok":true}'], ['0:{"ok":true}', '1:"$2"', '2:"$1"']), /reference cycle/, "R4: a disconnected cycle must fail closed");
            // positive (§ 7 item 2): an element outlined as `$L` compares equal to the same element inline.
            assert.deepEqual(cmp(['0:["$","div",null,{"children":["$","p",null,{"children":"x"}]}]'], ['0:["$","div",null,{"children":"$L1"}]', '1:["$","p",null,{"children":"x"}]']), [], "an element outlined as $L must compare equal to the same element inline");
            // fail closed: a $-form, a row kind or a truncated text row whose meaning is unknown is refused.
            assert.throws(() => cmp(['0:["$X12"]'], ['0:["$X12"]']), /unknown RSC string form/, "an unknown $-form must fail closed");
            assert.throws(() => cmp(['0:["$1"]', '1:A0a1b'], ['0:["$1"]', '1:A0a1b']), /unsupported RSC row kind/, "an unknown row kind must fail closed");
            assert.throws(() => cmp(['0:["$1"]', '1:T9,abc'], ['0:["$1"]', '1:T9,abc']), /shorter than its length/, "a truncated text row must fail closed");
            // The reviewer's real-payload mutation (review-0 R1): one interest toggle's productId changed inside the
            // catalog /shop payload — the HTML stays equal; the payload comparison must report it.
            const before = await loc1BeforeSet();
            const cand = await loc1EnSet();
            const doc = await loc1Json("expected-diff.json");
            const b = before.captures.find((c) => c.tenant === "catalog" && c.path === "/shop");
            const a = cand.captures.find((c) => c.tenant === "catalog" && c.path === "/shop");
            const listed = expectedFor(doc, "catalog", "/shop");
            assert.deepEqual(checkExpected(before, b.body, cand, a.body, listed), [], "precondition: catalog /shop is exact");
            const needle = '\\"productId\\":\\"e0000000-0000-4000-8000-000000000001\\"';
            assert.ok(a.body.includes(needle), "mutation precondition: the toggle's productId travels in the captured payload");
            const wrong = checkExpected(before, b.body, cand, a.body.replace(needle, '\\"productId\\":\\"WRONG-PRODUCT\\"'), listed);
            assert.equal(wrong.length, 1, "the productId mutation is reported once");
            assert.match(wrong[0], /^flight payload differs beyond the listed differences at .*WRONG-PRODUCT/s);
            console.log(`  (loc1-flight-controls) 3 positive controls equal; ${Object.keys(mutations).length + 1} mutations, ${Object.keys(r5).length} 1a R5 counterexamples, ${Object.keys(typed).length} typed-reference changes, ${Object.keys(review2).length} second-review controls and the real-payload productId mutation reported; 3 unknown forms and a disconnected cycle fail closed`);
        });

        // RO copies (fixtures.mjs LOC1): per URL exactly the listed text changes against THE SAME COPY in before/ (the start
        // commit), each the EN pack value of its key → the RO pack value (since locale-1d: so every listed item is a change
        // of this slice). CAT-QUOTE-1 adds a second kind of item, `added: true` (row CQ1-QUOTE): a text that did not exist
        // at the start commit — the "Cere ofertă" button and its dialog on the RO catalog copy, which now has contact
        // channels — whose `to` is the RO pack value of its catalog key; each listed added item is removed once from the
        // after extraction, and the rest must then be exactly the listed changes. cat-theme-1 lists no changed and no added
        // text (its before/, 0865ac6, already holds cat-quote-1's quote texts). CAT-VARIANT-GALLERY-1 adds a third kind,
        // `removed: true` (row CVG1-GALLERY): the item at `position` of the before extraction, exactly `kind` and `text`,
        // taken out of the before side by `textChanges` (the RO catalog copy's gallery counter).
        const LOC1_RO_ROWS = new Set(["L-RO-1", "L-RO-2", "L-RO-3"]);
        for (const [fixture, rowId] of [["roContent", "loc1-ro-content"], ["roCommerce", "loc1-ro-commerce"], ["roCatalog", "loc1-ro-catalog"]]) {
            test(`(${rowId}) RO copy of the ${LOC1[fixture].source} fixture: per URL exactly the listed text changes (each EN pack value → RO pack value), added texts (each an RO pack value) and removed texts (row CVG1-GALLERY) against its own ${LOC1_START} capture`, async () => {
                const spec = (await loc1Json("ro-expected.json")).fixtures[fixture];
                assert.equal(spec.source, fixture);
                assert.equal(spec.against, "before");
                const ro = await loc1RoSet();
                const ref = await loc1BeforeSet();
                const sourcePaths = ref.captures.filter((c) => c.tenant === fixture).map((c) => c.path).sort();
                assert.deepEqual(Object.keys(spec.paths).sort(), sourcePaths, "ro-expected.json must list exactly the captured URLs");
                let changes = 0;
                const rows = {};
                let added = 0;
                let removedCount = 0;
                for (const [urlPath, list] of Object.entries(spec.paths)) {
                    for (const e of list.filter((x) => x.added === true)) {
                        assert.equal(e.part, "catalog", `${urlPath} ${e.key}: an added text is a catalog text`);
                        assert.equal(e.row, "CQ1-QUOTE", `${urlPath} ${e.key}: row ${e.row}`);
                        assert.ok(!Object.hasOwn(e, "from"), `${urlPath} ${e.key}: an added text has no from`);
                        assert.equal(e.to, renderItem(RO_TABLE, e), `${urlPath} ${e.key}: to is the RO pack value`);
                        rows[e.row] = (rows[e.row] ?? 0) + 1;
                    }
                    // CAT-VARIANT-GALLERY-1 (CVG1-TEXT-REMOVAL = A): a removed text — the item at `position` of the before
                    // extraction, exactly `kind` and `text` (textChanges refuses any other), row CVG1-GALLERY.
                    for (const e of list.filter((x) => x.removed === true)) {
                        assert.equal(e.row, "CVG1-GALLERY", `${urlPath}: removed text row ${e.row}`);
                        assert.ok(!Object.hasOwn(e, "from") && !Object.hasOwn(e, "to") && Number.isInteger(e.position), `${urlPath}: a removed text has kind, text and position only`);
                        rows[e.row] = (rows[e.row] ?? 0) + 1;
                    }
                    for (const e of list.filter((x) => x.added !== true && x.removed !== true)) {
                        assert.ok(e.part === "commerce" || e.part === "site", `${urlPath} ${e.key}: a site or commerce text`);
                        assert.ok(LOC1_RO_ROWS.has(e.row), `${urlPath} ${e.key}: row ${e.row}`);
                        assert.equal(e.from, renderItem(EN_TABLE, e), `${urlPath} ${e.key}: from is the EN pack value`);
                        assert.equal(e.to, renderItem(RO_TABLE, e), `${urlPath} ${e.key}: to is the RO pack value`);
                        rows[e.row] = (rows[e.row] ?? 0) + 1;
                    }
                    const r = ro.find((c) => c.tenant === fixture && c.path === urlPath);
                    const base = ref.captures.find((c) => c.tenant === fixture && c.path === urlPath);
                    assert.equal(r.status, base.status, `${urlPath} status`);
                    let after = isHtml(r) ? extractVisibleText(r.body) : [];
                    for (const e of list.filter((x) => x.added === true)) {
                        const i = after.findIndex((item) => item.kind === e.kind && item.text === e.to);
                        assert.ok(i >= 0, `${fixture} ${urlPath}: the added ${e.key} text ${JSON.stringify(e.to)} does not occur`);
                        after = [...after.slice(0, i), ...after.slice(i + 1)];
                        added++;
                    }
                    const gone = list.filter((x) => x.removed === true).map(({ kind, text, position }) => ({ kind, text, position }));
                    removedCount += gone.length;
                    const got = isHtml(r) ? textChanges(extractVisibleText(base.body), after, gone) : [];
                    assert.deepEqual(got, list.filter((x) => x.added !== true && x.removed !== true).map(({ kind, from, to }) => ({ kind, from, to })), `${fixture} ${urlPath}`);
                    changes += got.length;
                }
                console.log(`  (${rowId}) ${Object.keys(spec.paths).length} URLs, ${changes} text changes, ${added} added texts and ${removedCount} removed texts, all listed (changes and additions from the RO pack): ${JSON.stringify(rows)}`);
            });
        }

        // ── ROWS (cq1-*) — CAT-QUOTE-1 (docs/slices/cat-quote-1-impl.md; packet rule 7). Server HTML of the running build:
        // the "Cere ofertă" button and its (closed) native dialog on the RO catalog product pages, by channel set; the bar
        // fallbacks on a shop. Before side: locale-1/quote-1/before/ (29a2282, where mapTenant drops `contactChannels`),
        // read explicitly through `cq1BeforeSet` since cat-theme-1 made theme-1 the current set (now variant-gallery-1).
        const unamp = (h) => h.replace(/&amp;/g, "&");
        /** The dialog's actions as rendered: `{ kind, href, text }`, in document order. */
        const quoteActionsOf = (html) => [...html.matchAll(/<a href="([^"]*)" data-quote-action="([a-z]+)"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ kind: m[2], href: unamp(m[1]), text: m[3] }));
        const RO_CAT = resolveLocaleStrings({ locale: "ro-RO" }).strings.catalog;
        const cq1CandSet = async () => { const en = await loc1EnSet(); return { buildId: en.buildId, clientModules: en.clientModules, captures: await cq1Set() }; };

        test("(cq1-quote-ro) RO catalog copy with all three channels: the button above the presenter, the low-key link after the presenter, the dialog's Romanian texts and the three hrefs (title + URL, no variant on the server)", async () => {
            const ro = await loc1RoSet();
            const channels = ITEMS.find((i) => i.SK === `TENANT#${LOC1.roCatalog.id}`).contactChannels;
            assert.deepEqual(Object.keys(channels).sort(), ["email", "phone", "whatsapp"], "precondition: the RO catalog copy has all three channels");
            let pages = 0;
            for (const c of ro.filter((x) => x.tenant === "roCatalog" && x.path.startsWith("/product/") && x.status === 200)) {
                const html = splitFlight(c.body).html;
                const product = ITEMS.find((i) => i.PK === `TENANT#${LOC1.roCatalog.id}` && i.SK.startsWith("PRODUCT#") && `/product/${i.slug}` === c.path);
                const url = `https://${LOC1.roCatalog.host}/product/${product.slug}`;
                const msg = `Bună! Aș vrea o ofertă pentru ${product.title}: ${url}`;
                assert.equal(html.split("data-quote-request=").length - 1, 1, `${c.path}: one quote button`);
                assert.match(html, new RegExp(`data-quote-request=""[^>]*>${RO_CAT.quoteButton}</button>`), `${c.path}: the button text`);
                assert.match(html, /<dialog aria-labelledby="[^"]+" class="[^"]*">/, `${c.path}: a native dialog, closed in the server HTML`);
                assert.ok(html.includes(`>${RO_CAT.quoteTitle}</h2>`) && html.includes(`>${RO_CAT.quoteClose}</button>`), `${c.path}: dialog title and close in Romanian`);
                assert.deepEqual(quoteActionsOf(html), [
                    { kind: "call", href: "tel:+40721-000111", text: RO_CAT.quoteCall },
                    { kind: "whatsapp", href: `https://wa.me/40721000111?text=${encodeURIComponent(msg)}`, text: RO_CAT.quoteWhatsApp },
                    { kind: "email", href: `mailto:${channels.email}?subject=${encodeURIComponent(product.title)}&body=${encodeURIComponent(msg)}`, text: RO_CAT.quoteEmail },
                ], `${c.path}: the three actions`);
                const at = (needle) => { const i = html.indexOf(needle); assert.ok(i >= 0, `${c.path}: ${needle}`); return i; };
                assert.ok(at("data-quote-request=") < at("data-interest-toggle=") && at("</dialog>") < at("data-interest-toggle="), `${c.path}: the interest link under the button`);
                assert.match(html, /data-interest-toggle="[^"]*" class="inline-flex items-center gap-1.5 text-sm underline/, `${c.path}: the toggle is the link form`);
                if (html.includes('name="catalog-option-')) assert.ok(at("</dialog>") < at('name="catalog-option-') && at('name="catalog-option-') < at("data-interest-toggle="), `${c.path}: button, then the presenter, then the link`);
                // The dialog's texts travel to the client in Romanian, the message template included (the payload).
                const flight = splitFlight(c.body).flight;
                assert.ok(flight.includes(JSON.stringify({ quoteButton: RO_CAT.quoteButton, quoteTitle: RO_CAT.quoteTitle, quoteCall: RO_CAT.quoteCall, quoteWhatsApp: RO_CAT.quoteWhatsApp, quoteEmail: RO_CAT.quoteEmail, quoteMessage: RO_CAT.quoteMessage, quoteClose: RO_CAT.quoteClose })), `${c.path}: the RO quote texts in the payload`);
                assert.ok(flight.includes(`"productTitle":${JSON.stringify(product.title)},"productUrl":${JSON.stringify(url)}`), `${c.path}: title and absolute URL, nothing else of the product`);
                if ((product.variants || []).some((g) => (g.options || []).length)) assert.ok(flight.includes('"optionGroupName":"catalog-option-format"'), `${c.path}: the presenter's radio group`);
                pages++;
            }
            assert.equal(pages, 3, "the three RO catalog product pages");
            console.log(`  (cq1-quote-ro) ${pages} RO catalog product pages: button, link under it, dialog in Romanian, tel/wa.me/mailto hrefs`);
        });

        test("(cq1-quote-channels) e-mail only → one action (mailto); an empty contactChannels object → no button, no dialog, and the page byte-equal to 29a2282 but for the interest link, the CVG1-GALLERY change and the CDL2-INTEREST-PATH change", async () => {
            const cand = await cq1CandSet();
            const before = await cq1BeforeSet();
            // CAT-VARIANT-GALLERY-1: the gallery change of each roNone page, listed in that slice's set (`cq1RoNone`).
            const cvg1 = (await cvg1Json("expected-diff.json")).cq1RoNone;
            // CDL-2: the interest-path change of each roNone page (it stores no `interest`), listed in this slice's set.
            const cdl2 = (await loc1Json("expected-diff.json")).cq1RoNone;
            for (const c of cand.captures.filter((x) => x.tenant === "roEmail")) {
                const html = splitFlight(c.body).html;
                const acts = quoteActionsOf(html);
                assert.deepEqual(acts.map((a) => a.kind), ["email"], `roEmail ${c.path}: exactly one action`);
                assert.ok(acts[0].href.startsWith("mailto:doar-email@cq1.serving-contract.test?subject="), `roEmail ${c.path}: the e-mail channel`);
                assert.ok(!html.includes('href="tel:') && !html.includes("wa.me/"), `roEmail ${c.path}: no call, no WhatsApp`);
            }
            let equal = 0;
            for (const a of cand.captures.filter((x) => x.tenant === "roNone")) {
                assert.ok(!a.body.includes("data-quote-request") && !a.body.includes("<dialog"), `roNone ${a.path}: no button, no dialog`);
                const b = before.captures.find((x) => x.tenant === "roNone" && x.path === a.path);
                assert.equal(a.status, b.status);
                assert.ok(Array.isArray(cvg1[a.path]) && cvg1[a.path].every((e) => e.row === "CVG1-GALLERY"), `roNone ${a.path}: the CVG1-GALLERY list`);
                assert.deepEqual(cdl2[a.path], [CDL2_INTEREST_HTML, CDL2_INTEREST_FLIGHT], `roNone ${a.path}: the CDL2-INTEREST-PATH list`);
                assert.deepEqual(checkExpected(before, b.body, cand, a.body, [...(b.body.includes("data-interest-toggle=") ? CQ1_LINK : []), ...cvg1[a.path], ...cdl2[a.path]]), [], `roNone ${a.path}: byte-equal but for the interest link, the gallery change and the interest path`);
                assert.notDeepEqual(checkExpected(before, b.body, cand, a.body, [...(b.body.includes("data-interest-toggle=") ? CQ1_LINK : []), ...cvg1[a.path]]), [], `roNone ${a.path}: control — without the CDL2 list the interest path is reported`);
                equal++;
            }
            assert.equal(equal, 2);
            // Positive control of the detector: the same comparison on the RO copy WITH channels reports the button.
            const ro = (await loc1RoSet()).find((x) => x.tenant === "roCatalog" && x.path === "/product/oak-plank");
            const roBefore = before.captures.find((x) => x.tenant === "roCatalog" && x.path === "/product/oak-plank");
            assert.notDeepEqual(checkExpected(before, roBefore.body, { ...cand, captures: [ro] }, ro.body, CQ1_LINK), [], "the comparison must see the added button");
            console.log("  (cq1-quote-channels) e-mail only: one mailto action; empty channels: no button, byte-equal but for CQ1-INTEREST-LINK, CVG1-GALLERY and CDL2-INTEREST-PATH; the detector sees the button on the copy with channels");
        });

        test("(cq1-bars-fallback) a shop whose Top Bar, Commerce Bar and Quick contact own values are empty shows the contact channels (server HTML); 29a2282 showed none", async () => {
            const a = (await cq1Set()).find((x) => x.tenant === "shopFallback" && x.path === "/");
            const b = (await cq1BeforeSet()).captures.find((x) => x.tenant === "shopFallback" && x.path === "/");
            const html = splitFlight(a.body).html, beforeHtml = splitFlight(b.body).html;
            const { phone, whatsapp, email } = CQ1_CHANNELS;
            const want = [
                `href="tel:${phone}"`,                                   // Top Bar phone (absent own value)
                `href="mailto:${email}"`,                                // Top Bar e-mail (own value "")
                `href="tel:${phone.replace(/\s/g, "")}"`,                // Commerce Bar phone (own value "")
                `href="https://wa.me/${whatsapp.replace(/[^0-9]/g, "")}"`, // Commerce Bar WhatsApp (absent) and the Quick contact (value "")
            ];
            for (const w of want) {
                assert.ok(html.includes(w), `fallback shown: ${w}`);
                assert.ok(!beforeHtml.includes(w), `29a2282 did not show it: ${w}`);
            }
            assert.equal(html.split(want[3]).length - 1, 2, "WhatsApp: the Commerce Bar and the Quick contact");
            assert.ok(html.includes(`>${phone}</span>`) && html.includes(`>${email}</span>`), "the Top Bar shows the channel texts");
            console.log(`  (cq1-bars-fallback) Top Bar, Commerce Bar and Quick contact show the channels: ${want.join(", ")}`);
        });

        test("(cq1-bars-own) a shop whose bar fields are set keeps its own values, byte-equal to 29a2282, although it has different contact channels", async () => {
            const cand = await cq1CandSet();
            const before = await cq1BeforeSet();
            const a = cand.captures.find((x) => x.tenant === "shopOwn" && x.path === "/");
            const b = before.captures.find((x) => x.tenant === "shopOwn" && x.path === "/");
            assert.equal(a.status, 200);
            assert.deepEqual(checkExpected(before, b.body, cand, a.body, []), [], "byte-equal to the 29a2282 capture (CM1-A1 + the resolved payload)");
            const html = splitFlight(a.body).html;
            for (const own of ['href="tel:+1 555 0101"', 'href="mailto:bar@cq1.serving-contract.test"', 'href="tel:+15550102"', 'href="https://wa.me/15550103"', 'href="https://wa.me/15550104"']) assert.ok(html.includes(own), `own value: ${own}`);
            for (const v of Object.values(CQ1_CHANNELS)) assert.ok(!a.body.includes(v), `a channel value leaked: ${v}`);
            // Positive control: the fallback shop's page is NOT equal to its own capture (the detector sees the fallback).
            const af = cand.captures.find((x) => x.tenant === "shopFallback" && x.path === "/");
            const bf = before.captures.find((x) => x.tenant === "shopFallback" && x.path === "/");
            assert.notDeepEqual(checkExpected(before, bf.body, cand, af.body, []), [], "the comparison must see the fallback values");
            console.log("  (cq1-bars-own) own bar values kept, byte-equal to 29a2282; the fallback shop's change is detected");
        });

        // ── ROWS (ct1-*) — CAT-THEME-1 (docs/slices/cat-theme-1-impl.md; packet rule 5). Server HTML of the running build
        // for the CT1 tenants (fixtures.mjs `CT1`): the editorial catalog copy with EVERY new theme field set, and a site
        // with ONLY `footer.contentMaxWidth`. Before side: theme-1/before/ (0865ac6, which ignores every new field) — each
        // asserted string is also asserted ABSENT there (the positive control of the detector: the base did not render it).
        const ct1CandSet = async () => { const en = await loc1EnSet(); return { buildId: en.buildId, clientModules: en.clientModules, captures: await ct1Set() }; };
        const ct1Page = async (key, p) => {
            const a = (await ct1Set()).find((x) => x.tenant === key && x.path === p);
            const b = (await ct1BeforeSet()).captures.find((x) => x.tenant === key && x.path === p);
            assert.equal(a.status, 200, `${key} ${p}: 200`);
            assert.equal(b.status, 200, `${key} ${p}: 200 at 0865ac6`);
            return { html: splitFlight(a.body).html, before: splitFlight(b.body).html, body: a.body };
        };
        /** Each needle occurs in `html` (at least `min` times) and never in the base capture of the same URL. */
        const shows = (page, label, needles, min = 1) => {
            for (const n of needles) {
                assert.ok(page.html.split(n).length - 1 >= min, `${label}: ${n}`);
                assert.ok(!page.before.includes(n), `${label}: 0865ac6 already rendered ${n}`);
            }
        };

        test("(ct1-editorial) a tenant with every new theme field set renders each of them; the base commit rendered none", async () => {
            const T = CT1_THEME;
            assert.equal(T.shape, "editorial", "precondition: the editorial shape");
            const home = await ct1Page("editorial", "/");
            // Fonts: the nav font as a third family, 400;700 ∪ the listed weights, ascending (CT-D2 = B), on all three.
            const w = "300;400;500;700";
            // (The loader is raw HTML — dangerouslySetInnerHTML — so `&` is not escaped; OBSERVED in the 0865ac6 capture.)
            const fontUrl = `https://fonts.googleapis.com/css2?family=Prata:wght@${w}&family=Lato:wght@${w}&family=Inter:wght@${w}&display=swap`;
            shows(home, "font request", [`<link rel="stylesheet" href="${fontUrl}" media="print"`, `<link rel="preload" as="style" href="${fontUrl}" />`]);
            // :root — the nav font variable, the two colours (muted text; hairline = border and input), the section gap.
            shows(home, ":root", ["--font-nav: 'Inter', sans-serif !important;", "--muted-foreground: #6b6b6b !important;", "--border: #d4d4d4 !important;", "--input: #d4d4d4 !important;", "--section-gap: 6rem !important;"]);
            // Rules: the heading weight; no shadows (the shadow variable forced to a transparent zero shadow); the arrows.
            const style = [...home.html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).find((css) => css.includes("--font-heading")) ?? "";
            assert.match(style, /h1, h2, h3, h4, h5, h6 \{\s*font-weight: 300;\s*\}/, "heading weight rule");
            assert.match(style, /\*, ::before, ::after \{\s*--tw-shadow: 0 0 #0000 !important;\s*--tw-drop-shadow: initial !important;\s*\}/, "no-shadow rule (box and drop shadows; row ct1-no-shadows tests it against the consumers)");
            assert.match(style, /\[data-theme-arrow\]::after, \[data-quote-request\]::after \{\s*content: " \\2197";\s*\}/, "arrow rule");
            assert.ok(!home.before.includes("--tw-shadow") && !home.before.includes("font-weight: 300") && !home.before.includes("data-theme-arrow"), "0865ac6 emitted none of the rules");
            // Header: the 3 px primary top border; the 1920 width on the Navbar; the nav font and the arrows on the nav.
            shows(home, "header", ['<div class="sticky top-0 z-50 border-t-[3px] border-primary">', '<div class="hidden md:flex items-center gap-8 font-[family-name:var(--font-nav)]">']);
            // The header width class name is NOT new: `header.contentMaxWidth` was already passed through as a string at
            // 0865ac6 (it rendered the same class). What was missing there is the compiled rule — checked on the
            // stylesheet below (renderer/src/lib/widths.ts names the class for Tailwind).
            assert.ok(home.html.includes('<div class="mx-auto max-w-[1920px] px-4 sm:px-6 lg:px-8">'), "header: the 1920 width on the Navbar");
            const marked = [...home.html.matchAll(/<a data-theme-arrow="" [^>]*>([^<]*)</g)].map((m) => m[1]);
            assert.deepEqual(marked, ["Shop", "About", "Contact"], "the arrow marker on the two nav links and the contact button");
            // Footer: the surface colour, the 1440 width (its own, not the header's).
            shows(home, "footer", ['<footer class="border-t py-12 bg-muted site-footer"><div class="max-w-[1440px] mx-auto px-6">']);
            // The content-page wrapper takes the section gap.
            shows(await ct1Page("editorial", "/about"), "/about wrapper", ['<main class="py-[var(--section-gap)] relative">']);
            // Listings: the wrapper's section gap; landscape cards with the first category's name under the title.
            for (const p of ["/shop", "/category/floors"]) {
                const page = await ct1Page("editorial", p);
                shows(page, `${p} wrapper`, ['mx-auto py-[var(--section-gap)] px-6">']);
                const cards = page.html.split('<div class="h-[245px] bg-muted rounded-lg overflow-hidden mb-3">').length - 1;
                assert.ok(cards > 0, `${p}: landscape cards`);
                assert.ok(!page.html.includes('<div class="aspect-square bg-muted rounded-lg overflow-hidden mb-3">'), `${p}: no square card left`);
                assert.ok(!page.before.includes("h-[245px]"), `${p}: 0865ac6 had square cards`);
                const lines = [...page.html.matchAll(/<\/h3><p class="text-xs text-muted-foreground mt-1">([^<]*)<\/p>/g)].map((m) => m[1]);
                assert.equal(lines.length, cards, `${p}: a category line on every card (every listed product's first category exists)`);
                assert.ok(!page.before.includes('</h3><p class="text-xs text-muted-foreground mt-1">'), `${p}: 0865ac6 had no category line`);
                if (p === "/category/floors") assert.deepEqual([...new Set(lines)], ["Floors"], "the floors products' first category");
                console.log(`  (ct1-editorial) ${p}: ${cards} landscape cards, category lines ${JSON.stringify([...new Set(lines)])}`);
            }
            // Product page: the spec table's key column at 50 % between 1 px hairlines; the quote button (its arrow is the
            // injector's [data-quote-request] rule).
            const product = await ct1Page("editorial", "/product/oak-plank");
            shows(product, "spec table", ['<dl class="grid grid-cols-2 gap-x-6 text-sm border-t">', '<dt class="text-muted-foreground py-2 border-b">']);
            assert.ok(product.html.includes("data-quote-request="), "the quote button is there for the arrow rule");
            // The compiled stylesheet holds every new class (Tailwind 4 compiles only names written in the sources).
            const css = /<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/.exec(home.html)?.[1];
            assert.ok(css, "precondition: the page's stylesheet");
            const sheet = (await request({ port: server.port, path: css, host: CT1.editorial.host })).body;
            for (const rule of [".max-w-\\[1440px\\]{max-width:1440px}", ".max-w-\\[1600px\\]{max-width:1600px}", ".max-w-\\[1920px\\]{max-width:1920px}",
                ".py-\\[var\\(--section-gap\\)\\]{padding-block:var(--section-gap)}", ".font-\\[family-name\\:var\\(--font-nav\\)\\]{font-family:var(--font-nav)}",
                ".h-\\[245px\\]{height:245px}", ".grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}"]) {
                assert.ok(sheet.includes(rule), `compiled: ${rule}`);
            }
            assert.match(sheet, /\.border-t-\\\[3px\\\]\{[^}]*border-top-width:3px\}/, "compiled: the 3 px top border");
            console.log(`  (ct1-editorial) fonts ${w} + Inter; colours, section gap, heading weight, no-shadow and arrow rules; header 3 px border + 1920; footer surface + 1440; nav font; arrows ${JSON.stringify(marked)}; spec table 50 %; ${css} holds every new class`);
        });

        // Review-0 R-CT-4 — "no shadows" tested against the CONSUMERS, not against the chosen mechanism. For a served page:
        // every class on it whose compiled rule SETS a shadow variable that the same rule PAINTS (in `box-shadow` or
        // `filter`) is a shadow consumer; each such variable must be forced, with !important, by the injector's
        // `*, ::before, ::after` block to a no-shadow value (`0 0 #0000` — Tailwind's initial value — or `initial`). Rings
        // are not shadow consumers: a `ring*` rule sets `--tw-ring-shadow`, which no rule here forces, and its selector has
        // a state (`:focus`). The page is a cover hero (`drop-shadow-lg` / `-md`, the plugin consumers) plus the site chrome
        // (`shadow-sm` on the contact button). Discrimination: the same evaluator reports the round-1 rule text (only
        // `--tw-shadow`) and the default-shape control tenant. The computed style in a real browser is recorded in the
        // implementation record § 9 (EXECUTED once in Chromium; CI has no browser).
        const NO_SHADOW_VALUES = new Set(["0 0 #0000", "initial"]);
        function shadowConsumers(html, sheet) {
            const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
            const out = [];
            for (const m of sheet.matchAll(/(?<=^|[{}\s])([^{}@;]+)\{([^{}]*)\}/g)) {   // lookbehind: adjacent rules share no character
                const body = m[2];
                const painted = new Set([...body.matchAll(/(?:^|;)(?:box-shadow|filter):([^;]*)/g)].flatMap((d) => [...d[1].matchAll(/var\((--tw-[a-z-]*shadow)\b/g)].map((v) => v[1])));
                const set = [...body.matchAll(/(?:^|;)(--tw-[a-z-]*shadow):/g)].map((d) => d[1]).filter((v) => painted.has(v));
                if (set.length === 0) continue;
                for (const selector of m[1].split(",").map((x) => x.trim())) {
                    if (!/^\.(?:\\.|[A-Za-z0-9_-])+$/.test(selector)) continue;            // a plain class selector (no state, no descendant)
                    const name = selector.slice(1).replace(/\\(.)/g, "$1");
                    if (classes.has(name)) for (const v of set) out.push({ name, v });
                }
            }
            return out;
        }
        function forcedShadows(styleText) {
            const block = /\*, ::before, ::after \{([^}]*)\}/.exec(styleText)?.[1] ?? "";
            return new Map([...block.matchAll(/(--tw-[a-z-]*):\s*([^;!]+?)\s*!important/g)].map((d) => [d[1], d[2]]));
        }
        const uncovered = (consumers, forced) => consumers.filter(({ v }) => !NO_SHADOW_VALUES.has(forced.get(v))).map(({ name, v }) => `${name}:${v}`);

        test("(ct1-no-shadows) editorial: every shadow consumer on a page with the cover hero is neutralised — box shadows and the hero's drop shadows; the default shape and the round-1 rule are reported", async () => {
            const get = async (t) => (await request({ port: server.port, path: CT1_HERO_SLUG, host: t.host }));
            const [ed, control] = [await get(CT1.editorial), await get(CT1.footerOnly)];
            assert.equal(ed.status, 200, "editorial /hero");
            assert.equal(control.status, 200, "control /hero");
            const html = splitFlight(ed.body).html, controlHtml = splitFlight(control.body).html;
            const css = /<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/.exec(html)?.[1];
            const sheet = (await request({ port: server.port, path: css, host: CT1.editorial.host })).body;
            const styleOf = (h) => [...h.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).find((x) => x.includes("--font-heading")) ?? "";
            const consumers = shadowConsumers(html, sheet);
            const vars = new Set(consumers.map((c) => c.v));
            assert.ok(consumers.some((c) => c.name === "drop-shadow-lg" && c.v === "--tw-drop-shadow"), "precondition: the hero headline's drop-shadow-lg is a consumer on this page");
            assert.ok(consumers.some((c) => c.name === "drop-shadow-md"), "precondition: the hero subheadline's drop-shadow-md is a consumer");
            assert.ok(vars.has("--tw-shadow"), "precondition: a box-shadow consumer (shadow*) is on this page");
            assert.deepEqual(uncovered(consumers, forcedShadows(styleOf(html))), [], "every shadow consumer is neutralised under editorial");
            // Discrimination: the round-1 rule (box shadows only) leaves the hero's drop shadows; the default shape forces nothing.
            const round1 = forcedShadows("*, ::before, ::after { --tw-shadow: 0 0 #0000 !important; }");
            assert.deepEqual([...new Set(uncovered(consumers, round1))].sort(), ["drop-shadow-lg:--tw-drop-shadow", "drop-shadow-md:--tw-drop-shadow"], "the round-1 rule must be reported for the hero");
            const controlConsumers = shadowConsumers(controlHtml, sheet);
            assert.ok(controlConsumers.some((c) => c.name === "drop-shadow-lg"), "precondition: the control page has the same hero");
            assert.ok(!styleOf(controlHtml).includes("--tw-drop-shadow") && uncovered(controlConsumers, forcedShadows(styleOf(controlHtml))).length > 0, "the default shape keeps every shadow");
            // Rings are not touched: the focus ring rule paints --tw-ring-shadow, which the block does not force.
            assert.ok(!forcedShadows(styleOf(html)).has("--tw-ring-shadow"), "focus rings are not neutralised");
            console.log(`  (ct1-no-shadows) ${consumers.length} shadow consumers on the editorial /hero (${[...new Set(consumers.map((c) => c.name))].join(", ")}), all neutralised; round-1 rule leaves ${uncovered(consumers, round1).length}; control keeps them`);
        });

        test("(ct1-footer-width) a tenant with only footer.contentMaxWidth: the footer at that width, the header at its own; byte-equal to 0865ac6 but for the footer width", async () => {
            const page = await ct1Page("footerOnly", "/");
            shows(page, "footer", ['<footer class="border-t py-12 bg-muted/30 site-footer"><div class="max-w-[1600px] mx-auto px-6">']);
            assert.ok(page.html.includes('<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">'), "the header keeps its own (default) width");
            assert.ok(page.before.includes('<footer class="border-t py-12 bg-muted/30 site-footer"><div class="max-w-7xl mx-auto px-6">'), "precondition: 0865ac6 used the header's width");
            // The whole page, under CM1-A1 + the resolved payload: the footer width is the ONLY difference (HTML and payload).
            const cand = await ct1CandSet(), before = await ct1BeforeSet();
            const a = cand.captures.find((x) => x.tenant === "footerOnly"), b = before.captures.find((x) => x.tenant === "footerOnly");
            const width = { category: 3, row: "CT1-FOOTER-WIDTH", before: '<div class="max-w-7xl mx-auto px-6">', after: '<div class="max-w-[1600px] mx-auto px-6">', flightBefore: '"max-w-7xl mx-auto px-6"', flightAfter: '"max-w-[1600px] mx-auto px-6"' };
            assert.deepEqual(checkExpected(before, b.body, cand, a.body, [width]), [], "only the footer width changed");
            assert.notDeepEqual(checkExpected(before, b.body, cand, a.body, []), [], "positive control: the comparison sees the footer width");
            console.log("  (ct1-footer-width) footer max-w-[1600px], header max-w-7xl; the footer width is the only byte difference to 0865ac6");
        });

        // ── ROWS (bpf1-*) — BULK-PURGE-FOOTER-1 Part B (docs/slices/bulk-purge-footer-1.md; packet rule B4). Server HTML of
        // the running build for the BPF1 tenants (fixtures.mjs `BPF1`). "Absent → today's bytes" is proven elsewhere: the
        // loc1-* rows (every en-US subject byte-equal to its start capture: 0865ac6 with nothing listed when bulk-purge-footer-1
        // was built; since cat-variant-gallery-1 27fa7ca with only the CVG1-GALLERY change listed), ct1-footer-width (a footer with only the
        // width carries no `style`, byte-equal to 0865ac6 but for the width) and the cq1-*/ct1-* rows.
        /** Today's text classes of the footer (layout.tsx; they read `--color-foreground` / `--color-muted-foreground`). */
        const FOOTER_TEXT_CLASSES = [
            'class="grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-muted-foreground"',
            'class="font-semibold text-foreground"',
            'class="font-semibold text-foreground mb-2"',
            'class="block hover:text-foreground"',
            'class="mt-8 pt-4 border-t text-center text-xs text-muted-foreground"',
        ];
        const bpf1Footer = async (key) => {
            const res = await request({ port: server.port, path: "/", host: BPF1[key].host });
            assert.equal(res.status, 200, `${key} /: 200`);
            const { html, flight } = splitFlight(res.body);
            const footer = /<footer[^>]*>[\s\S]*?<\/footer>/.exec(html)?.[0];
            assert.ok(footer, `${key}: a footer`);
            return { html, flight, footer, open: footer.slice(0, footer.indexOf(">") + 1), inner: footer.slice(footer.indexOf(">") + 1) };
        };
        /** Every class of `footer` that names a text colour (a `text-` class other than a size or an alignment). */
        const textColourClasses = (footer) => [...new Set([...footer.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/))
            .filter((c) => /^(hover:)?text-/.test(c) && !/^text-(xs|sm|base|lg|xl|\d?xl|center|left|right)$/.test(c)))].sort();

        test("(bpf1-footer-colours) both footer colours set: the footer's background is the colour and both text variables are the text colour; every footer text reads one of them, hover included", async () => {
            const { backgroundColor: bg, textColor: fg } = BPF1_FOOTER;
            const page = await bpf1Footer("colours");
            assert.equal(page.open, `<footer class="border-t py-12 bg-muted/30 site-footer" style="background-color:${bg};--color-foreground:${fg};--color-muted-foreground:${fg}">`);
            for (const t of ["BPF1 Legal SRL", "1 Footer Street", "office@bpf1.serving-contract.test", "Delivery", "Terms", "Privacy", "All rights reserved."]) assert.ok(page.inner.includes(t), `in the footer: ${t}`);
            for (const c of FOOTER_TEXT_CLASSES) assert.ok(page.inner.includes(c), `today's class: ${c}`);
            // Every text colour inside the footer comes from one of the two re-declared variables.
            assert.deepEqual(textColourClasses(page.footer), ["hover:text-foreground", "text-foreground", "text-muted-foreground"]);
            // The compiled rules read exactly those variables, and `@theme` resolves them from `--foreground` on :root —
            // which is why the footer re-declares `--color-*`, not `--foreground`.
            const css = /<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/.exec(page.html)?.[1];
            assert.ok(css, "precondition: the page's stylesheet");
            const sheet = (await request({ port: server.port, path: css, host: BPF1.colours.host })).body;
            // (Tailwind groups selectors: `.text-foreground,.text-foreground\/80{color:var(--color-foreground)}`.)
            assert.match(sheet, /[},]\.text-foreground(,[^{]*)?\{color:var\(--color-foreground\)\}/, "compiled: .text-foreground reads --color-foreground");
            assert.match(sheet, /[},]\.text-muted-foreground(,[^{]*)?\{color:var\(--color-muted-foreground\)\}/, "compiled: .text-muted-foreground reads --color-muted-foreground");
            for (const decl of ["--color-foreground:var(--foreground)", "--color-muted-foreground:var(--muted-foreground)"]) assert.ok(sheet.includes(decl), `compiled: ${decl}`);
            assert.match(sheet, /\.hover\\:text-foreground:hover\{color:var\(--color-foreground\)\}/, "compiled: the hover rule reads --color-foreground");
            // The payload carries the same style (a client navigation renders the same footer).
            assert.ok(page.flight.includes(`"style":{"backgroundColor":"${bg}","--color-foreground":"${fg}","--color-muted-foreground":"${fg}"}`), "payload style");
            console.log(`  (bpf1-footer-colours) footer background ${bg}, --color-foreground = --color-muted-foreground = ${fg}; text colour classes ${JSON.stringify(textColourClasses(page.footer))}; ${css} reads both variables`);
        });

        test("(bpf1-footer-background-only) only footer.backgroundColor, editorial shape: the background on the footer, no text variable; the texts keep today's classes and markup", async () => {
            const bgOnly = await bpf1Footer("background");
            assert.equal(bgOnly.open, `<footer class="border-t py-12 bg-muted site-footer" style="background-color:${BPF1_BACKGROUND_ONLY}">`);
            assert.ok(!bgOnly.footer.includes("--color-"), "no text variable is re-declared");
            for (const c of FOOTER_TEXT_CLASSES) assert.ok(bgOnly.inner.includes(c), `today's class: ${c}`);
            assert.ok(!bgOnly.flight.includes("--color-"), "payload: no text variable");
            // Same content, both colours set on the other tenant: everything inside the <footer> element is identical — the
            // colours change the footer element's own attributes only.
            const both = await bpf1Footer("colours");
            assert.equal(bgOnly.inner, both.inner, "the footer's content is the same markup with or without the colours");
            console.log(`  (bpf1-footer-background-only) editorial footer background ${BPF1_BACKGROUND_ONLY}; texts keep today's classes; content markup identical to the both-colours tenant`);
        });

        // ── ROWS (hc1-*) — HEADER-COLOURS-1 (docs/slices/header-colours-1.md). Server HTML and payload of the running build
        // for the HC1 tenants (fixtures.mjs `HC1`: three copies of the CM1 commerce tenant with the Top Bar, the Commerce
        // Bar and the search bar). "Absent → today's bytes" for every site kind is proven by the rows that compare with a
        // capture taken before this slice (cm1-*, loc1-*, ct1-*, cq1-*), unchanged: their tenants set no header colour.
        const HC1_NAV_OPEN = '<nav class="border-b bg-background/80 backdrop-blur site-navbar">';
        /** One page of an HC1 copy, its key fields written as the plain twin's (so twins compare byte for byte). */
        const hc1Page = async (key, reqPath) => {
            const res = await request({ port: server.port, path: reqPath, host: HC1[key].host });
            assert.equal(res.status, 200, `${key} ${reqPath}: 200`);
            const asPlain = (t) => t.split(HC1[key].host).join(HC1.plain.host).split(HC1[key].id).join(HC1.plain.id);
            const { html, flight } = splitFlight(res.body);
            return { raw: html, html: asPlain(html), flight: asPlain(flight), navOpen: /<nav[^>]*>/.exec(html)?.[0] };
        };
        /** The payload as a sorted list of rows (the encoder emits rows in async order; ids are assigned in that order). */
        const rowsOf = (flight) => flight.split("\n").sort();
        /** Where two texts first differ, with 120 characters of context on each side (for a failure message). */
        const firstDiff = (a, b) => {
            let i = 0;
            while (i < a.length && a[i] === b[i]) i++;
            return i === a.length && i === b.length ? "equal" : `at ${i}: ${JSON.stringify(a.slice(Math.max(0, i - 120), i + 120))} vs ${JSON.stringify(b.slice(Math.max(0, i - 120), i + 120))}`;
        };
        const HC1_PATHS = ["/", URL_PREFIX_DEFAULTS.shop];

        test("(hc1-header-colours) both header colours set: the <nav> re-declares --color-background and the two text variables; the compiled background and text utilities read them; every other byte of the page (Top Bar, Commerce Bar, search bar, page, footer) equals the twin without colours", async () => {
            const { backgroundColor: bg, textColor: fg } = HC1_HEADER;
            const style = `--color-background:${bg};--color-foreground:${fg};--color-muted-foreground:${fg}`;
            const prop = `,"colorStyle":{"--color-background":"${bg}","--color-foreground":"${fg}","--color-muted-foreground":"${fg}"}`;
            for (const reqPath of HC1_PATHS) {
                const [page, plain] = [await hc1Page("colours", reqPath), await hc1Page("plain", reqPath)];
                assert.equal(page.navOpen, `<nav class="border-b bg-background/80 backdrop-blur site-navbar" style="${style}">`, reqPath);
                assert.equal(plain.navOpen, HC1_NAV_OPEN, `${reqPath}: the twin keeps today's <nav>`);
                assert.equal(page.html.split("--color-").length - 1, 3, `${reqPath}: the variables occur on the <nav> only`);
                for (const part of ["HC1 announcement", "+1 555 0199", "HC1 offer"]) assert.ok(page.html.includes(part), `${reqPath}: the header part ${part} is in the compared HTML`);
                if (reqPath !== "/") assert.ok(page.html.includes('<div class="bg-primary w-full">'), `${reqPath}: the search bar is in the compared HTML`);
                // HTML: the <nav> opening tag is the ONLY difference.
                assert.equal(page.html.split(page.navOpen).join(HC1_NAV_OPEN), plain.html, `${reqPath}: HTML equal to the twin but for the <nav> tag; ${firstDiff(page.html.split(page.navOpen).join(HC1_NAV_OPEN), plain.html)}`);
                // Payload: the Navbar's props carry the one extra prop; nothing else differs.
                assert.equal(page.flight.split(prop).length - 1, 1, `${reqPath}: the payload carries colorStyle once`);
                assert.ok(!plain.flight.includes("colorStyle"), `${reqPath}: the twin's payload has no colorStyle`);
                assert.deepEqual(rowsOf(page.flight.split(prop).join("")), rowsOf(plain.flight), `${reqPath}: payload equal to the twin but for colorStyle; ${firstDiff(rowsOf(page.flight.split(prop).join("")).join("\n"), rowsOf(plain.flight).join("\n"))}`);
            }
            // The compiled CSS: the three background utilities of the navbar read --color-background (translucent bar and
            // both panels), the text utilities read the two re-declared variables; hover and the contact button read Primary.
            const page = await hc1Page("colours", "/");
            const sheets = [...page.raw.matchAll(/<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
            assert.ok(sheets.length > 0, "precondition: the page's stylesheets");
            const css = (await Promise.all(sheets.map((href) => request({ port: server.port, path: href, host: HC1.colours.host })))).map((r) => r.body).join("\n");
            assert.match(css, /[},]\.bg-background(,[^{]*)?\{background-color:var\(--color-background\)\}/, "compiled: .bg-background (both panels) reads --color-background");
            assert.match(css, /[},]\.bg-background\\\/80\{background-color:var\(--color-background\)\}/, "compiled: .bg-background/80 (the bar) reads --color-background without color-mix");
            assert.ok(css.includes("@supports (color:color-mix(in lab, red, red)){.bg-background\\/80{background-color:color-mix(in oklab,var(--color-background)80%,transparent)}"), "compiled: .bg-background/80 keeps 80 % of --color-background with color-mix");
            assert.match(css, /[},]\.backdrop-blur\{/, "compiled: the bar's blur");
            assert.match(css, /[},]\.text-foreground(,[^{]*)?\{color:var\(--color-foreground\)\}/, "compiled: .text-foreground reads --color-foreground");
            assert.match(css, /[},]\.text-muted-foreground(,[^{]*)?\{color:var\(--color-muted-foreground\)\}/, "compiled: .text-muted-foreground reads --color-muted-foreground");
            for (const decl of ["--color-background:var(--background)", "--color-foreground:var(--foreground)", "--color-muted-foreground:var(--muted-foreground)"]) assert.ok(css.includes(decl), `compiled: ${decl}`);
            assert.match(css, /\.hover\\:text-primary:hover\{color:var\(--color-primary\)\}/, "compiled: link hover reads --color-primary (not re-declared)");
            assert.match(css, /[},]\.bg-primary(,[^{]*)?\{background-color:var\(--color-primary\)\}/, "compiled: the contact button's fill reads --color-primary");
            assert.match(css, /[},]\.text-primary-foreground(,[^{]*)?\{color:var\(--color-primary-foreground\)\}/, "compiled: the contact button's text reads --color-primary-foreground");
            console.log(`  (hc1-header-colours) <nav> ${style}; ${HC1_PATHS.join(", ")} equal to the twin but for the <nav> tag and colorStyle; ${sheets.length} stylesheet(s): .bg-background, .bg-background/80 (both forms) read --color-background`);
        });

        test("(hc1-header-invalid) stored header colours outside the colour rule are ignored, as absent: today's <nav>, no colorStyle, the page equal to the twin without colours", async () => {
            for (const reqPath of HC1_PATHS) {
                const [page, plain] = [await hc1Page("invalid", reqPath), await hc1Page("plain", reqPath)];
                assert.equal(page.navOpen, HC1_NAV_OPEN, reqPath);
                assert.ok(!page.html.includes("--color-") && !page.flight.includes("colorStyle"), `${reqPath}: no variable, no prop`);
                for (const v of Object.values(HC1_INVALID)) assert.ok(!page.raw.includes(v) && !page.flight.includes(v), `${reqPath}: ${v} is not rendered`);
                assert.equal(page.html, plain.html, `${reqPath}: HTML equal to the twin; ${firstDiff(page.html, plain.html)}`);
                assert.deepEqual(rowsOf(page.flight), rowsOf(plain.flight), `${reqPath}: payload equal to the twin; ${firstDiff(rowsOf(page.flight).join("\n"), rowsOf(plain.flight).join("\n"))}`);
            }
            console.log(`  (hc1-header-invalid) ${JSON.stringify(HC1_INVALID)} ignored on ${HC1_PATHS.join(", ")}: byte-equal to the twin`);
        });

        // ── ROWS (cc1-*) — CATEGORY-CONTENT-1 (docs/slices/category-content-1.md). Server HTML and payload of the running
        // build for the CC1 tenants (fixtures.mjs `CC1`: copies of the CM1 catalog and commerce tenants whose category holds
        // `blocks`, `[]`, a non-array, or nothing). "Absent → today's bytes" for every site kind is proven by the rows that
        // compare with a capture taken before this slice (cm1-*, loc1-*, ct1-*, cq1-*), unchanged: no fixture category of
        // theirs has `blocks`.
        /** One page of a CC1 copy, its key fields written as its twin's (so twins compare byte for byte). */
        const cc1Page = async (key, reqPath) => {
            const twin = CC1[CC1_TWIN[key] ?? key];
            const res = await request({ port: server.port, path: reqPath, host: CC1[key].host });
            assert.equal(res.status, 200, `${key} ${reqPath}: 200`);
            const asTwin = (t) => t.split(CC1[key].host).join(twin.host).split(CC1[key].id).join(twin.id);
            const { html, flight } = splitFlight(res.body);
            const at = html.indexOf("<main"), end = html.indexOf("</main>");
            assert.ok(at >= 0 && end > at, `${key} ${reqPath}: one <main>`);
            return { body: asTwin(res.body), html: asTwin(html), flight: asTwin(flight), main: asTwin(html.slice(at, end + "</main>".length)) };
        };
        /** The end of the title block (the product-count line closes it) in a category page's <main>. */
        const titleBlockEnd = (main) => {
            const m = /<p class="text-sm text-muted-foreground mt-1">[^<]*<\/p><\/div>/.exec(main);
            assert.ok(m, "the title block's product-count line");
            return m.index + m[0].length;
        };
        const CC1_OPEN = '<div class="mb-8" data-category-content="true">';
        /**
         * A body's payload as its resolved tree (row 0, the other unconsumed rows and the hints, each canonical): the payload
         * after the CM1-A1 masks of this build (`maskBody`: client references by module path, asset paths, build id), then
         * `resolveFlight` (LOCALE1B-ROW-CUT = A) — row ids are gone, every value is compared.
         */
        let cc1Side;
        const cc1Resolved = async (body) => {
            cc1Side ??= { buildId: (await readFile(path.join(RENDERER_DIR, ".next", "BUILD_ID"), "utf8")).trim(), clientModules: await readClientModules(RENDERER_DIR) };
            const t = resolveFlight(maskBody(body, cc1Side).masked.split("\n--- flight payload rows, sorted ---\n")[1].split("\n"));
            return { root: canon(t.root), others: t.others, hints: t.hints };
        };
        /**
         * The content section of a page with blocks, proven to be the page's ONLY difference inside <main> from its twin:
         * the twin's <main> = this <main> with the section cut out, and the section sits right after the title block.
         */
        const cc1Section = (page, plain, label) => {
            const cut = titleBlockEnd(plain.main);
            const tail = plain.main.slice(cut);
            assert.equal(page.main.slice(0, cut), plain.main.slice(0, cut), `${label}: <main> up to the title block's end equals the twin; ${firstDiff(page.main.slice(0, cut), plain.main.slice(0, cut))}`);
            assert.ok(page.main.endsWith(tail), `${label}: after the content, <main> (filters, list, pager) equals the twin's; ${firstDiff(page.main.slice(page.main.length - tail.length), tail)}`);
            const section = page.main.slice(cut, page.main.length - tail.length);
            assert.ok(section.startsWith(CC1_OPEN) && section.endsWith("</div>"), `${label}: the section is one content <div> (${section.slice(0, 80)}…)`);
            assert.equal(page.main.split("data-category-content").length - 1, 1, `${label}: one content section`);
            return section;
        };

        test("(cc1-category-content) a category's blocks render between the title block and the listing on page 1, page 2 and a filter state; the blocks get the preparation pass and the catalog-mode rule; every other byte of <main> equals the twin without blocks", async () => {
            // Catalog: `cf1-many`, 30 products. The filter state is the first filter link of the twin's own page.
            const catBase = `${URL_PREFIX_DEFAULTS.category}/cf1-many`;
            const firstFilter = /href="(\/category\/cf1-many\?f=[^"]+)"/.exec((await cc1Page("catPlain", catBase)).main)?.[1]?.replace(/&amp;/g, "&");
            assert.ok(firstFilter, "precondition: the twin's page offers a filter link");
            const catPaths = [catBase, `${catBase}?page=2`, firstFilter];
            for (const reqPath of catPaths) {
                const [page, plain] = [await cc1Page("catBlocks", reqPath), await cc1Page("catPlain", reqPath)];
                const section = cc1Section(page, plain, `catalog ${reqPath}`);
                assert.ok(section.includes(CC1_PARAGRAPH), `catalog ${reqPath}: the paragraph`);
                // The showcase was prepared on the server: it shows the `floors` products (none of them is in `cf1-many`).
                assert.ok(section.includes("Oak Plank"), `catalog ${reqPath}: the showcase's prefetched product`);
                assert.ok(!plain.main.includes("Oak Plank"), `catalog ${reqPath}: control — the twin's list does not show it`);
                // The catalog-mode rule: no price, currency or stock text in the content; the flag in the block's attrs.
                for (const forbidden of ["USD", "$", "Out of Stock", "In Stock"]) assert.ok(!section.includes(forbidden), `catalog ${reqPath}: no ${forbidden}`);
                assert.ok(page.flight.includes('"_catalogMode":true'), `catalog ${reqPath}: _catalogMode in the showcase's attrs`);
                assert.ok(page.main.includes("data-facet-panel") && plain.main.includes("data-facet-panel"), `catalog ${reqPath}: the filters render`);
                assert.ok(page.flight.includes(CC1_PARAGRAPH) && !plain.flight.includes(CC1_PARAGRAPH), `catalog ${reqPath}: the blocks travel in the payload (RenderBlocks is a client component)`);
            }
            // Page 1 and page 2 list different products (the pager works); the content is the same section on both.
            const [p1, p2] = [await cc1Page("catBlocks", catBase), await cc1Page("catBlocks", `${catBase}?page=2`)];
            const cards = (main) => new Set([...main.matchAll(/href="\/product\/(placa-\d+)"/g)].map((m) => m[1]));
            const [c1, c2] = [cards(p1.main), cards(p2.main)];
            assert.ok(c1.size === 24 && c2.size === 6 && [...c2].every((s) => !c1.has(s)), `page 1 lists 24 products, page 2 the other 6 (${c1.size}, ${c2.size})`);
            assert.equal(cc1Section(p1, await cc1Page("catPlain", catBase), "p1"), cc1Section(p2, await cc1Page("catPlain", `${catBase}?page=2`), "p2"), "the same content on page 1 and page 2");

            // Commerce: `rugs`; a post grid (the server reads the tenant's posts).
            const shopBase = `${URL_PREFIX_DEFAULTS.category}/rugs`;
            for (const reqPath of [shopBase, `${shopBase}?page=2`]) {
                const [page, plain] = [await cc1Page("shopBlocks", reqPath), await cc1Page("shopPlain", reqPath)];
                const section = cc1Section(page, plain, `commerce ${reqPath}`);
                assert.ok(section.includes(CC1_PARAGRAPH), `commerce ${reqPath}: the paragraph`);
                // The post grid was prepared on the server: it links the tenant's published content pages.
                assert.ok(section.includes(`${CM1.commerce.id} about`), `commerce ${reqPath}: the post grid lists the tenant's posts`);
            }
            console.log(`  (cc1-category-content) catalog ${catPaths.join(", ")}; commerce ${shopBase}, ?page=2: the content section after the title block, <main> otherwise equal to the twin`);
        });

        test("(cc1-category-no-content) a category whose blocks are [] or not an array: the page equals the twin without blocks, HTML and payload", async () => {
            const cases = [
                ["catEmpty", [`${URL_PREFIX_DEFAULTS.category}/cf1-many`, `${URL_PREFIX_DEFAULTS.category}/cf1-many?page=2`]],
                ["shopMalformed", [`${URL_PREFIX_DEFAULTS.category}/rugs`, `${URL_PREFIX_DEFAULTS.category}/rugs?page=2`]],
            ];
            for (const [key, paths] of cases) {
                for (const reqPath of paths) {
                    const [page, plain] = [await cc1Page(key, reqPath), await cc1Page(CC1_TWIN[key], reqPath)];
                    assert.ok(!page.html.includes("data-category-content") && !page.html.includes(CC1_MALFORMED) && !page.flight.includes("CC1 not a block list"), `${key} ${reqPath}: no content section`);
                    // HTML: byte-equal on the cacheable page 1. A `?page=2` request is a dynamic render, whose metadata tags Next
                    // STREAMS: they land inside <head> or after it by timing (EXECUTED: equal twins differed only there), so there
                    // the page body (<main>) is compared byte for byte, and the head by the payload below.
                    if (reqPath.includes("?")) assert.equal(page.main, plain.main, `${key} ${reqPath}: <main> equal to the twin; ${firstDiff(page.main, plain.main)}`);
                    else assert.equal(page.html, plain.html, `${key} ${reqPath}: HTML equal to the twin; ${firstDiff(page.html, plain.html)}`);
                    // Payload: the resolved tree (LOCALE1B-ROW-CUT = A): Next numbers the rows in the order its async work ends, so
                    // equal twins can carry different row ids (seen: the metadata icon row); every value is still compared.
                    const [a, b] = [await cc1Resolved(page.body), await cc1Resolved(plain.body)];
                    assert.deepEqual(a, b, `${key} ${reqPath}: payload equal to the twin (resolved); ${firstDiff(JSON.stringify(a), JSON.stringify(b))}`);
                }
            }
            // Control: the same comparison reports the content of a category with blocks.
            const [withBlocks, twin] = [await cc1Page("catBlocks", `${URL_PREFIX_DEFAULTS.category}/cf1-many`), await cc1Page("catPlain", `${URL_PREFIX_DEFAULTS.category}/cf1-many`)];
            assert.notDeepEqual(await cc1Resolved(withBlocks.body), await cc1Resolved(twin.body), "control: a category with blocks differs under the resolved comparison");
            console.log("  (cc1-category-no-content) blocks [] (catalog) and a non-array (commerce): page 1 HTML byte-equal to the twin, page 2 <main> byte-equal; payload equal resolved on both");
        });

        // ── ROWS (sl1a-*) — SHOP-LOOK-1A (docs/slices/shop-look-1a.md). Server HTML and payload of the running build for the
        // SL1A tenants (fixtures.mjs `SL1A`: three copies of the CM1 commerce tenant). "Absent → today's bytes" for every site
        // kind is proven by the rows that compare with a capture taken before this slice (cm1-*, loc1-*, ct1-*, cq1-*),
        // unchanged: their tenants set none of the new fields. These rows prove that the set tenant differs from its twin
        // EXACTLY by the new elements, and that blank values are drawn as absent.
        const SL1A_PATHS = ["/", URL_PREFIX_DEFAULTS.shop, `${URL_PREFIX_DEFAULTS.product}/variant-rug`];
        /** One page of an SL1A copy, its key fields written as the plain twin's (so twins compare byte for byte). */
        const sl1aPage = async (key, reqPath) => {
            const res = await request({ port: server.port, path: reqPath, host: SL1A[key].host });
            assert.equal(res.status, 200, `${key} ${reqPath}: 200`);
            const asPlain = (t) => t.split(SL1A[key].host).join(SL1A.plain.host).split(SL1A[key].id).join(SL1A.plain.id);
            const { html } = splitFlight(res.body);
            // The payload with its build-specific parts masked (client-reference rows → module identity; CM1-A1), so two
            // renders compare by content: the extra `await` of the bar read shifts the order in which row ids are given.
            sl1aSide ??= { buildId: (await readFile(path.join(RENDERER_DIR, ".next", "BUILD_ID"), "utf8")).trim(), clientModules: await readClientModules(RENDERER_DIR) };
            const flight = maskBody(res.body, sl1aSide).masked.split("\n--- flight payload rows, sorted ---\n")[1];
            return { raw: html, html: asPlain(html), flight: asPlain(flight) };
        };
        let sl1aSide;
        /** The payload as a resolved tree (row ids and row cuts ignored; locale-1/proof.mjs resolveFlight). */
        const sl1aResolved = (flight) => { const t = resolveFlight(flight.split("\n")); return { root: canon(t.root), others: t.others, hints: t.hints }; };
        const sl1aDiff = (a, b) => {
            let i = 0;
            while (i < a.length && a[i] === b[i]) i++;
            return i === a.length && i === b.length ? "equal" : `at ${i}: ${JSON.stringify(a.slice(Math.max(0, i - 120), i + 120))} vs ${JSON.stringify(b.slice(Math.max(0, i - 120), i + 120))}`;
        };
        /** The text from `start` (included) to the first `end` after it (excluded); asserted to occur. */
        const between = (text, start, end, what) => {
            const i = text.indexOf(start);
            assert.ok(i > -1, `${what}: start`);
            const j = text.indexOf(end, i);
            assert.ok(j > i, `${what}: end`);
            return text.slice(i, j);
        };
        const SL1A_TODAY_GRID = '<div class="grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-muted-foreground">';
        const SL1A_FLIGHT_TODAY_GRID = '["$","div",null,{"className":"grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-muted-foreground","children":[';
        const SL1A_FLIGHT_NEW_GRID = '["$","div",null,{"className":"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-';
        const SL1A_FLIGHT_COPYRIGHT = ',["$","div",null,{"className":"mt-8 pt-4 border-t';

        test("(sl1a-header-footer) the tagline, the category bar and the footer's brand text and named columns: the set tenant differs from its twin exactly by these elements, in the HTML and in the payload, on the home, shop and product pages", async () => {
            const tagline = `<span class="hidden sm:inline text-xs font-medium uppercase tracking-widest text-muted-foreground">${SL1A_HEADER.tagline}</span>`;
            const BAR_OPEN = '<nav aria-label="Categories" class="border-t"><ul class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center gap-6 overflow-x-auto whitespace-nowrap py-2">';
            const LINK_CLASS = "text-sm font-medium text-muted-foreground hover:text-primary transition-colors";
            const barProp = `,"categoryBar":${JSON.stringify({ label: "Categories", links: [{ label: "SL1A Tiles", href: `${URL_PREFIX_DEFAULTS.category}/sl1a-tiles` }, { label: "Rugs", href: `${URL_PREFIX_DEFAULTS.category}/rugs` }] })}`;
            const taglineProp = `,"tagline":${JSON.stringify(SL1A_HEADER.tagline)}`;
            const columnHtml = (c) => `<div class="space-y-1"><p class="font-semibold text-foreground mb-2">${c.heading}</p>${c.links.map((l) => `<a href="${l.href}" class="block hover:text-foreground">${l.label}</a>`).join("")}</div>`;
            const brand = `<div><p class="whitespace-pre-line">${SL1A_FOOTER.brandText}</p></div>`;
            for (const reqPath of SL1A_PATHS) {
                const [page, plain] = [await sl1aPage("set", reqPath), await sl1aPage("plain", reqPath)];
                // HTML, header: the tagline inside the logo link, after the title; the bar inside the header <nav>, after row 1.
                assert.equal(page.html.split(tagline).length - 1, 1, `${reqPath}: the tagline once`);
                assert.ok(page.html.includes(`>SL1A Shop</span>${tagline}</a>`), `${reqPath}: the tagline after the title, inside the logo link`);
                assert.equal(page.html.split(BAR_OPEN).length - 1, 1, `${reqPath}: the bar once`);
                const bar = between(page.html, BAR_OPEN, "</ul></nav>", `${reqPath} bar`) + "</ul></nav>";
                // The stored ids: sl1a-tiles, sl1a-hidden (skipped), rugs, sl1a-missing (skipped) — links in the stored order.
                const items = [...bar.slice(BAR_OPEN.length).matchAll(/<li><a ([^>]*)>([^<]*)<\/a><\/li>/g)];
                assert.equal(items.map((m) => m[0]).join(""), bar.slice(BAR_OPEN.length, -"</ul></nav>".length), `${reqPath}: the bar holds only <li><a> items`);
                assert.deepEqual(items.map((m) => [/href="([^"]*)"/.exec(m[1])?.[1], /class="([^"]*)"/.exec(m[1])?.[1], m[2]]),
                    [[`${URL_PREFIX_DEFAULTS.category}/sl1a-tiles`, LINK_CLASS, "SL1A Tiles"], [`${URL_PREFIX_DEFAULTS.category}/rugs`, LINK_CLASS, "Rugs"]], `${reqPath}: links in the stored order, on the category path`);
                const navStart = page.html.indexOf('<nav class="border-b bg-background/80 backdrop-blur site-navbar">');
                assert.ok(page.html.indexOf(bar) > navStart && page.html.indexOf(bar) < page.html.indexOf("</nav>", page.html.indexOf(bar) + bar.length), `${reqPath}: the bar is inside the header <nav>`);
                for (const t of ["SL1A Hidden", "sl1a-missing"]) assert.ok(!page.raw.includes(t) && !page.flight.includes(t), `${reqPath}: ${t} is not rendered`);
                // HTML, footer: the new grid replaces today's grid in its slot; brand text, named columns, then today's columns.
                const todayGrid = between(plain.html, SL1A_TODAY_GRID, '<div class="mt-8', `${reqPath} twin grid`);
                const todayInner = todayGrid.slice(SL1A_TODAY_GRID.length, -"</div>".length);
                const todayCount = todayInner.split('<div class="space-y-1">').length - 1;
                const newGridOpen = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${1 + SL1A_FOOTER.columns.length + todayCount} gap-8 text-sm text-muted-foreground">`;
                const newGrid = newGridOpen + brand + SL1A_FOOTER.columns.map(columnHtml).join("") + todayInner + "</div>";
                assert.ok(!page.html.includes(SL1A_TODAY_GRID), `${reqPath}: today's grid element is replaced`);
                assert.equal(page.html.split(newGrid).length - 1, 1, `${reqPath}: the new grid holds the brand text, the named columns, then today's ${todayCount} column(s), byte for byte`);
                // HTML: these three elements are the ONLY difference.
                const htmlBack = page.html.split(tagline).join("").split(bar).join("").split(newGrid).join(todayGrid);
                assert.equal(htmlBack, plain.html, `${reqPath}: HTML equal to the twin but for the three elements; ${sl1aDiff(htmlBack, plain.html)}`);
                // Payload: the Navbar's two extra props, and the footer grid element in its slot; nothing else differs.
                assert.equal(page.flight.split(taglineProp).length - 1, 1, `${reqPath}: the payload carries tagline once`);
                assert.equal(page.flight.split(barProp).length - 1, 1, `${reqPath}: the payload carries categoryBar once`);
                assert.ok(!plain.flight.includes('"tagline"') && !plain.flight.includes('"categoryBar"'), `${reqPath}: the twin's payload has neither prop`);
                const setGrid = between(page.flight, SL1A_FLIGHT_NEW_GRID, SL1A_FLIGHT_COPYRIGHT, `${reqPath} set flight grid`);
                const twinGrid = between(plain.flight, SL1A_FLIGHT_TODAY_GRID, SL1A_FLIGHT_COPYRIGHT, `${reqPath} twin flight grid`);
                assert.ok(!page.flight.includes(SL1A_FLIGHT_TODAY_GRID), `${reqPath}: today's payload grid element is replaced`);
                const twinChildren = twinGrid.slice(SL1A_FLIGHT_TODAY_GRID.length, -"]}]".length);
                assert.ok(setGrid.endsWith(`,${twinChildren}]}]`), `${reqPath}: the payload grid ends with today's columns`);
                for (const t of [JSON.stringify(SL1A_FOOTER.brandText), ...SL1A_FOOTER.columns.map((c) => JSON.stringify(c.heading))]) assert.ok(setGrid.includes(t), `${reqPath}: payload grid holds ${t}`);
                const flightBack = page.flight.split(taglineProp).join("").split(barProp).join("").split(setGrid).join(twinGrid);
                const [a, b] = [sl1aResolved(flightBack), sl1aResolved(plain.flight)];
                assert.deepEqual(a, b, `${reqPath}: payload equal to the twin but for the two props and the grid (resolved); ${sl1aDiff(JSON.stringify(a), JSON.stringify(b))}`);
                assert.notDeepEqual(sl1aResolved(page.flight), b, `${reqPath}: control — without the three substitutions the resolved payloads differ`);
            }
            // The compiled CSS has the new classes (literal in the sources, so Tailwind compiled them).
            const page = await sl1aPage("set", "/");
            const sheets = [...page.raw.matchAll(/<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
            assert.ok(sheets.length > 0, "precondition: the page's stylesheets");
            const css = (await Promise.all(sheets.map((href) => request({ port: server.port, path: href, host: SL1A.set.host })))).map((r) => r.body).join("\n");
            for (const cls of ["sm\\:inline", "tracking-widest", "overflow-x-auto", "whitespace-nowrap", "whitespace-pre-line", "sm\\:grid-cols-2", "lg\\:grid-cols-5", "lg\\:grid-cols-8"]) {
                assert.ok(css.includes(`.${cls}`), `compiled: .${cls}`);
            }
            console.log(`  (sl1a-header-footer) ${SL1A_PATHS.join(", ")}: tagline, bar (SL1A Tiles, Rugs; hidden and missing skipped) and footer grid are the only HTML differences; payload (resolved) differs by tagline, categoryBar and the grid element; ${sheets.length} stylesheet(s) hold the new classes`);
        });

        test("(sl1a-blank-as-absent) blank values draw as absent: a whitespace tagline, bar ids that are all hidden or missing, a whitespace brand text and an empty column list give the twin's HTML and payload", async () => {
            for (const reqPath of SL1A_PATHS) {
                const [page, plain] = [await sl1aPage("blank", reqPath), await sl1aPage("plain", reqPath)];
                assert.ok(!page.html.includes('aria-label="Categories"') && !page.flight.includes('"categoryBar"') && !page.flight.includes('"tagline"'), `${reqPath}: no bar, no prop`);
                assert.ok(page.html.includes(SL1A_TODAY_GRID), `${reqPath}: today's footer grid`);
                assert.equal(page.html, plain.html, `${reqPath}: HTML equal to the twin; ${sl1aDiff(page.html, plain.html)}`);
                const [a, b] = [sl1aResolved(page.flight), sl1aResolved(plain.flight)];
                assert.deepEqual(a, b, `${reqPath}: payload equal to the twin (resolved); ${sl1aDiff(JSON.stringify(a), JSON.stringify(b))}`);
            }
            console.log(`  (sl1a-blank-as-absent) ${SL1A_PATHS.join(", ")}: HTML byte-equal to the twin; payload equal resolved`);
        });

        // ── ROWS (sl1b-*) — SHOP-LOOK-1B (docs/slices/shop-look-1b.md). Server HTML and payload of the running build for the
        // SL1B tenants (fixtures.mjs `SL1B`: three content tenants whose home page holds a cover hero and a split hero).
        // "Absent → today's bytes" for every existing hero is proven by the rows that compare with a capture taken before
        // this slice (cm1-*, loc1-*, ct1-* — the ct1 tenants render a hero), unchanged, and by the plugin suite
        // (packages/plugins/test/hero.test.ts, every style against HTML recorded before the change). These rows prove that,
        // in the built site, the set tenant differs from its twin EXACTLY by the new elements and the § 6.5 class swaps,
        // that `null` and blank values draw as absent, and that the built stylesheet holds every new class.
        /** The home page of an SL1B copy, its key fields written as the plain twin's (so twins compare byte for byte). */
        const sl1bPage = async (key) => {
            const res = await request({ port: server.port, path: "/", host: SL1B[key].host });
            assert.equal(res.status, 200, `${key}: 200`);
            const asPlain = (t) => t.split(SL1B[key].host).join(SL1B.plain.host).split(SL1B[key].id).join(SL1B.plain.id);
            const { html } = splitFlight(res.body);
            sl1aSide ??= { buildId: (await readFile(path.join(RENDERER_DIR, ".next", "BUILD_ID"), "utf8")).trim(), clientModules: await readClientModules(RENDERER_DIR) };
            const flight = maskBody(res.body, sl1aSide).masked.split("\n--- flight payload rows, sorted ---\n")[1];
            return { raw: html, html: asPlain(html), flight: asPlain(flight) };
        };
        /** `text` with `from` replaced by `to`, asserting `from` occurs exactly once. */
        const swapOnce = (text, from, to, what) => {
            assert.equal(text.split(from).length - 1, 1, `${what}: exactly once`);
            return text.replace(from, () => to);
        };
        // The literals of HeroRender (design § 6.5 table, § 6.2), as the plugin suite pins them.
        const SL1B_BTN = "inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary";
        const SL1B_PILL = SL1B_BTN.replace("rounded-md", "rounded-full");
        const SL1B_EYEBROW = "inline-block w-fit rounded-full border px-3 py-1 mb-6 text-xs font-semibold uppercase tracking-widest";
        const SL1B_OUTLINE = "inline-flex items-center justify-center rounded-full border text-sm font-medium h-11 px-8 hover:opacity-90";
        const SL1B_PANEL = "relative z-10 order-2 lg:order-1 flex flex-col justify-center px-6 lg:px-12 py-12 lg:py-20";
        const SL1B_VALUE = "text-2xl md:text-4xl font-black tracking-tight";
        const sl1bStats = (grid, items, valueCls, labelCls) => `<div class="${grid}">${items.map((i) => `<div><p class="${valueCls}">${i.value}</p><p class="${labelCls}">${i.label}</p></div>`).join("")}</div>`;

        test("(sl1b-hero-options) a cover hero and a split inverse hero with every new option: the set tenant differs from its twin exactly by the new elements and the § 6.5 class swaps, in the HTML; by the stored attributes only, in the payload; the stylesheet holds every new class", async () => {
            const [page, plain] = [await sl1bPage("set"), await sl1bPage("plain")];
            const C = SL1B_COVER_OPTIONS, S = SL1B_SPLIT_OPTIONS;
            // Cover (reference section 2): eyebrow (ruling SL1B-COVER-EYEBROW: the cover headline's class, default white),
            // accent (the § 4.2 default text-primary), two pill buttons, three numbers.
            const coverEyebrow = `<p class="${SL1B_EYEBROW} border-current text-white">${C.eyebrow}</p>`;
            const coverAccent = `<!-- --> <span class="text-primary">${C.headlineAccent}</span>`;
            const coverToday = `<a href="/shop" class="${SL1B_BTN}">Shop floors</a>`;
            const coverRow = `<div class="flex flex-col md:flex-row gap-4 md:justify-center"><a href="/shop" class="${SL1B_PILL}">Shop floors</a><a href="${C.secondaryCtaLink}" class="${SL1B_OUTLINE} border-current text-white">${C.secondaryCtaText}</a></div>`;
            const coverStats = sl1bStats("mt-12 grid grid-cols-3 gap-6", C.stats, `${SL1B_VALUE} drop-shadow-md text-white`, "text-sm drop-shadow-md text-white/90");
            // Split (reference section 6): the inverse panel, every colour class swapped in its place; the first button keeps
            // its fill and gains an edge (ruling SL1B-INVERSE-BUTTON).
            const splitEyebrow = `<p class="${SL1B_EYEBROW} border-background/40 text-background">${S.eyebrow}</p>`;
            const splitAccent = `<!-- --> <span class="text-background/70">${S.headlineAccent}</span>`;
            const splitToday = `<div><a href="/about" class="${SL1B_BTN}">Read more</a></div>`;
            const splitRow = `<div class="flex flex-col md:flex-row gap-4"><a href="/about" class="${SL1B_PILL} border border-background/40">Read more</a><a href="${S.secondaryCtaLink}" class="${SL1B_OUTLINE} border-background text-background">${S.secondaryCtaText}</a></div>`;
            const splitStats = sl1bStats("mt-12 grid grid-cols-2 md:grid-cols-4 gap-6", S.stats, `${SL1B_VALUE} text-background`, "text-sm text-background/70");
            const swaps = [
                [coverEyebrow, ""], [coverAccent, ""], [coverRow, coverToday], [coverStats, ""],
                [splitEyebrow, ""], [splitAccent, ""], [splitRow, splitToday], [splitStats, ""],
                [`<div class="${SL1B_PANEL} bg-foreground">`, `<div class="${SL1B_PANEL}">`],
                ['<h1 class="text-4xl lg:text-5xl font-black tracking-tight text-background mb-6">', '<h1 class="text-4xl lg:text-5xl font-black tracking-tight text-foreground mb-6">'],
                ['<p class="text-lg text-background/80 mb-8">', '<p class="text-lg text-muted-foreground mb-8">'],
            ];
            // Order inside each hero: eyebrow directly above the <h1>; the accent inside it, after the headline; the numbers
            // directly after the button row.
            assert.ok(page.html.includes(`${coverEyebrow}<h1 `) && page.html.includes(`SL1B Floors${coverAccent}</h1>`) && page.html.includes(`${coverRow}${coverStats}`), "cover: element order");
            assert.ok(page.html.includes(`${splitEyebrow}<h1 `) && page.html.includes(`SL1B Heritage${splitAccent}</h1>`) && page.html.includes(`${splitRow}${splitStats}`), "split: element order");
            let back = page.html;
            for (const [from, to] of swaps) back = swapOnce(back, from, to, from.slice(0, 80));
            assert.equal(back, plain.html, `HTML equal to the twin but for the new elements and the class swaps; ${sl1aDiff(back, plain.html)}`);
            // § 6.5 case 1 on the built page: inside the inverse panel no class token is text-foreground or text-muted-foreground.
            const panelStart = page.html.indexOf(`<div class="${SL1B_PANEL} bg-foreground">`);
            const panel = page.html.slice(panelStart, page.html.indexOf("</section>", panelStart));
            const tokens = [...panel.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
            for (const t of ["text-foreground", "text-muted-foreground", "border-foreground"]) assert.ok(!tokens.includes(t), `inverse panel: no ${t}`);
            // Payload: the stored attributes travel in the blocks prop (§ 4.2); appended after today's keys, they are the only
            // difference.
            assert.ok(!plain.flight.includes('"eyebrow"') && !plain.flight.includes('"splitPanel"'), "the twin's payload carries no new attribute");
            let flightBack = page.flight;
            for (const o of [C, S]) flightBack = swapOnce(flightBack, `,${JSON.stringify(o).slice(1, -1)}}`, "}", `payload attrs ${o.eyebrow}`);
            assert.deepEqual(sl1aResolved(flightBack), sl1aResolved(plain.flight), `payload equal to the twin but for the attributes (resolved); ${sl1aDiff(flightBack, plain.flight)}`);
            // The compiled CSS has every class the new elements and the swaps can emit (literal in HeroRender.tsx, which
            // Tailwind scans through globals.css `@source`).
            const sheets = [...page.raw.matchAll(/<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
            assert.ok(sheets.length > 0, "precondition: the page's stylesheets");
            const css = (await Promise.all(sheets.map((href) => request({ port: server.port, path: href, host: SL1B.set.host })))).map((r) => r.body).join("\n");
            const SL1B_CLASSES = [
                "bg-foreground", "text-background", "text-background\\/80", "text-background\\/70", "border-background", "border-background\\/40",
                "border-primary\\/30", "border", "border-current", "border-foreground", "rounded-full", "w-fit", "inline-block", "tracking-widest", "uppercase",
                "md\\:flex-row", "md\\:justify-center", "flex-col", "gap-4", "gap-6", "mt-12", "grid-cols-1", "grid-cols-2", "grid-cols-3",
                "md\\:grid-cols-4", "text-2xl", "md\\:text-4xl", "drop-shadow-md", "text-white", "text-white\\/90", "text-primary",
                "text-foreground", "text-muted-foreground", "text-xs", "text-sm", "px-3", "py-1", "mb-6",
            ];
            const missing = SL1B_CLASSES.filter((cls) => !css.includes(`.${cls}{`) && !css.includes(`.${cls} {`) && !css.includes(`.${cls}:`) && !css.includes(`.${cls},`));
            assert.deepEqual(missing, [], `compiled: every new class has a rule (${sheets.length} stylesheet(s))`);
            console.log(`  (sl1b-hero-options) cover + split inverse: ${swaps.length} HTML substitutions give the twin byte for byte; payload differs by the two attribute sets only; ${SL1B_CLASSES.length} classes compiled in ${sheets.length} stylesheet(s)`);
        });

        test("(sl1b-blank-as-absent) every new hero attribute null (as Tiptap stores a cleared option) or blank — a whitespace eyebrow, a link without text, a number without value, splitPanel plain: the twin's HTML byte for byte", async () => {
            const [page, plain] = [await sl1bPage("blank"), await sl1bPage("plain")];
            assert.ok(page.flight.includes('"eyebrow"') && page.flight.includes('"splitPanel"'), "precondition: the blank tenant stores the attributes");
            assert.equal(page.html, plain.html, `HTML equal to the twin; ${sl1aDiff(page.html, plain.html)}`);
            console.log("  (sl1b-blank-as-absent) null and blank hero options: HTML byte-equal to the twin (the payload carries the stored nulls, § 4.2)");
        });

        // ── ROWS (sl1c-*) — SHOP-LOOK-1C (docs/slices/shop-look-1c.md). Server HTML and payload of the running build for the
        // SL1C tenants (fixtures.mjs `SL1C`: two copies of the CM1 commerce tenant whose page `/sl1c-rooms` holds one
        // `categoryGrid` block). "A page without the block → today's bytes" is proven by every existing row, unchanged (no
        // existing page holds the block). These rows prove, in the built site: the tiles in the picked order with hidden and
        // missing categories skipped, the photo and description fallbacks, the foot text, eyebrow, headline and chips; that
        // the set page differs from its blank twin EXACTLY by the block's <section> (HTML) and the block's attributes
        // (payload); that a block resolving to nothing draws nothing; and that the built stylesheet holds every new class.
        /** The page of an SL1C copy, its key fields written as the blank twin's (so twins compare byte for byte). */
        const sl1cPage = async (key) => {
            const res = await request({ port: server.port, path: SL1C_PATH, host: SL1C[key].host });
            assert.equal(res.status, 200, `${key}: 200`);
            const asBlank = (t) => t.split(SL1C[key].host).join(SL1C.blank.host).split(SL1C[key].id).join(SL1C.blank.id);
            const { html } = splitFlight(res.body);
            sl1aSide ??= { buildId: (await readFile(path.join(RENDERER_DIR, ".next", "BUILD_ID"), "utf8")).trim(), clientModules: await readClientModules(RENDERER_DIR) };
            const flight = maskBody(res.body, sl1aSide).masked.split("\n--- flight payload rows, sorted ---\n")[1];
            return { raw: html, html: asBlank(html), flight: asBlank(flight) };
        };
        // The literals of CategoryGridRender (as the plugin suite pins them).
        const SL1C_SCRIM = '<div class="absolute inset-x-0 bottom-0 flex flex-col"><div aria-hidden="true" class="h-16 bg-gradient-to-t from-foreground/75 to-transparent"></div><div class="bg-foreground/75 px-5 pb-5 text-background">';
        const SL1C_CHIP = "inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted";
        const sl1cTile = (c) => `<a href="${URL_PREFIX_DEFAULTS.category}/${c.id}" class="group relative block aspect-[3/4] overflow-hidden rounded-lg bg-muted">`
            + (c.imageLink ? `<img src="${c.imageLink}" alt="" loading="lazy" class="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"/>` : "")
            + `${SL1C_SCRIM}<h3 class="text-xl font-semibold leading-tight">${c.name}</h3>`
            + (c.description ? `<p class="mt-1 text-sm line-clamp-2">${c.description}</p>` : "")
            + `<p class="mt-3 text-xs font-semibold uppercase tracking-widest">${SL1C_GRID.ctaText}</p></div></div></a>`;
        /** The tiles the set block must draw: its ids in order, the hidden one and the id of no category skipped. */
        const SL1C_SHOWN = [SL1C_CATEGORIES.walnut, SL1C_CATEGORIES.oak, SL1C_CATEGORIES.ash];
        /** The `_categories` array of a payload (it holds flat objects only), parsed; asserted to occur exactly once. */
        const sl1cCategoriesText = (flight, what) => {
            const all = [...flight.matchAll(/"_categories":(\[[^\[\]]*\])/g)];
            assert.equal(all.length, 1, `${what}: _categories exactly once`);
            return all[0][1];
        };

        test("(sl1c-grid) the category grid: tiles in the picked order (hidden and missing skipped; photo and description fallbacks), foot text, eyebrow, headline and chips; the set page differs from its blank twin exactly by the block's section (HTML) and the block's attributes (payload); the stylesheet holds every new class", async () => {
            const [page, blank] = [await sl1cPage("set"), await sl1cPage("blank")];
            const chips = SL1C_GRID.chips.filter((c) => c.label && c.href);
            const section = '<section class="my-12"><div class="text-center mb-10">'
                + `<p class="inline-block w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">${SL1C_GRID.eyebrow}</p>`
                + `<h2 class="text-3xl md:text-4xl font-bold tracking-tight text-foreground">${SL1C_GRID.headline}</h2></div>`
                + `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">${SL1C_SHOWN.map(sl1cTile).join("")}</div>`
                + `<ul class="mt-8 flex flex-wrap justify-center gap-3">${chips.map((c) => `<li><a href="${c.href}" class="${SL1C_CHIP}">${c.label}</a></li>`).join("")}</ul></section>`;
            assert.equal(chips.length, 2, "precondition: one stored chip has no label");
            // HTML: the section, once, inside the block's wide wrapper; removing it gives the twin byte for byte.
            assert.equal(page.html.split(section).length - 1, 1, `the grid section once, byte for byte; ${sl1aDiff(page.html.slice(page.html.indexOf('<section class="my-12">')), section)}`);
            assert.ok(page.html.includes(`<div class="max-w-7xl mx-auto px-6">${section}</div>`), "inside the wide (site width) wrapper");
            assert.ok(!blank.html.includes('<section class="my-12">'), "the blank twin draws no section");
            assert.equal(page.html.replace(section, ""), blank.html, `HTML equal to the twin but for the section; ${sl1aDiff(page.html.replace(section, ""), blank.html)}`);
            for (const t of [SL1C_CATEGORIES.hidden.name, SL1C_CATEGORIES.hidden.description, "sl1c-no-label"]) assert.ok(!page.raw.includes(t), `HTML: ${t} is not rendered`);
            assert.ok(!page.flight.includes(SL1C_CATEGORIES.hidden.name), "payload: the hidden category's data is not sent");
            // Payload: the stored attributes plus `_categories` (the shown tiles: display fields and the category path);
            // swapping the set block's attributes for the twin's gives the twin's payload (resolved).
            const tilesText = sl1cCategoriesText(page.flight, "set");
            assert.deepEqual(JSON.parse(tilesText), SL1C_SHOWN.map(({ id, name, description, imageLink }) => ({
                id, name, ...(description ? { description } : {}), ...(imageLink ? { imageLink } : {}), path: `${URL_PREFIX_DEFAULTS.category}/${id}`,
            })), "payload: _categories = the shown tiles, in order");
            assert.equal(sl1cCategoriesText(blank.flight, "blank"), "[]", "payload: the twin's _categories is empty");
            const setAttrs = `${JSON.stringify(SL1C_GRID).slice(0, -1)},"_categories":${tilesText}}`;
            const blankAttrs = `${JSON.stringify(SL1C_BLANK_GRID).slice(0, -1)},"_categories":[]}`;
            const flightBack = swapOnce(page.flight, setAttrs, blankAttrs, "payload attrs");
            assert.ok(blank.flight.includes(blankAttrs), "the twin's payload carries its attributes");
            assert.deepEqual(sl1aResolved(flightBack), sl1aResolved(blank.flight), `payload equal to the twin but for the block's attributes (resolved); ${sl1aDiff(flightBack, blank.flight)}`);
            // The compiled CSS has every class the block can emit (literal in CategoryGridRender.tsx, which Tailwind scans
            // through globals.css `@source`).
            const sheets = [...page.raw.matchAll(/<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
            assert.ok(sheets.length > 0, "precondition: the page's stylesheets");
            const css = (await Promise.all(sheets.map((href) => request({ port: server.port, path: href, host: SL1C.set.host })))).map((r) => r.body).join("\n");
            const SL1C_CLASSES = [
                "aspect-\\[3\\/4\\]", "bg-foreground\\/75", "from-foreground\\/75", "to-transparent", "bg-gradient-to-t", "text-background",
                "line-clamp-2", "group-hover\\:scale-105", "object-cover", "inset-x-0", "bottom-0", "h-16", "px-5", "pb-5", "mt-3",
                "sm\\:grid-cols-2", "lg\\:grid-cols-3", "lg\\:grid-cols-4", "grid-cols-1", "bg-muted", "rounded-lg", "rounded-full",
                "border-border", "hover\\:bg-muted", "flex-wrap", "justify-center", "gap-3", "mt-8", "mb-10", "md\\:text-4xl", "text-xl",
                "border-primary\\/30", "tracking-widest", "w-fit",
            ];
            const missing = SL1C_CLASSES.filter((cls) => !css.includes(`.${cls}{`) && !css.includes(`.${cls} {`) && !css.includes(`.${cls}:`) && !css.includes(`.${cls},`));
            assert.deepEqual(missing, [], `compiled: every class of the block has a rule (${sheets.length} stylesheet(s))`);
            console.log(`  (sl1c-grid) ${SL1C_SHOWN.length} tiles (hidden and missing skipped), 2 chips; HTML = twin + the section; payload = twin but for the block's attributes; ${SL1C_CLASSES.length} classes compiled in ${sheets.length} stylesheet(s)`);
        });

        test("(sl1c-blank-draws-nothing) a grid whose ids are all hidden or missing, with a whitespace eyebrow, an empty headline and a chip without a label: no section, no tile, no chip; the block's wrapper is empty", async () => {
            const blank = await sl1cPage("blank");
            assert.ok(blank.html.includes('<div class="max-w-7xl mx-auto px-6"></div>'), "the block's wrapper, empty");
            for (const t of ['<section class="my-12">', "aspect-[3/4]", SL1C_CATEGORIES.hidden.name, "sl1c-no-label", "Shop category"]) assert.ok(!blank.raw.includes(t), `no ${t}`);
            console.log("  (sl1c-blank-draws-nothing) nothing drawn; the wide wrapper stays empty");
        });

        // ── ROWS (sl1d-*) — SHOP-LOOK-1D (docs/slices/shop-look-1d.md). Server HTML and payload of the running build for the
        // SL1D tenants (fixtures.mjs `SL1D`: copies of the CM1 commerce tenant whose page `/sl1d-section` holds a
        // `categoryShowcase` and a `postGrid`, set / plain / blank; two CM1 catalog copies, set / plain). "A page whose
        // blocks store no new attribute → today's bytes" is proven by every existing row, unchanged (the CM1 home pages
        // hold today's showcase; tenant ISO-A's home today's post grid). These rows prove, in the built site: every option
        // draws exactly its element and nothing else (set vs plain, HTML and payload); null, blank and off options draw
        // nothing and add no server key (blank vs plain); on a catalog site the card options change nothing (SL-D10).
        /** The page of an SL1D copy, its key fields written as its twin's (so twins compare byte for byte). */
        const sl1dPage = async (key, twin) => {
            const res = await request({ port: server.port, path: SL1D_PATH, host: SL1D[key].host });
            assert.equal(res.status, 200, `${key}: 200`);
            const asTwin = (t) => t.split(SL1D[key].host).join(SL1D[twin].host).split(SL1D[key].id).join(SL1D[twin].id);
            const { html } = splitFlight(res.body);
            sl1aSide ??= { buildId: (await readFile(path.join(RENDERER_DIR, ".next", "BUILD_ID"), "utf8")).trim(), clientModules: await readClientModules(RENDERER_DIR) };
            const flight = maskBody(res.body, sl1aSide).masked.split("\n--- flight payload rows, sorted ---\n")[1];
            return { raw: html, html: asTwin(html), flight: asTwin(flight) };
        };
        /** `text` without every occurrence of `part`, asserted to occur exactly `n` times. */
        const sl1dRemove = (text, part, n, what) => {
            assert.equal(text.split(part).length - 1, n, `${what}: ${n} × ${part}`);
            return text.split(part).join("");
        };
        /** The stored option keys as they follow the block's other keys in the payload's JSON (`,"k":v` …). */
        const sl1dStoredKeys = (options) => JSON.stringify(options).slice(1, -1).replace(/^/, ",");
        // The literals of CategoryShowcaseRender and PostGridRender (as the plugin suite pins them).
        const SL1D_EYEBROW = (t) => `<p class="mx-auto w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">${t}</p>`;
        const SL1D_BADGE = (t) => `<span class="absolute top-2 left-2 max-w-[90%] truncate rounded-full bg-primary px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-foreground">${t}</span>`;
        const SL1D_LABEL = (t) => `<p class="text-xs uppercase tracking-wide text-center text-muted-foreground mb-1">${t}</p>`;
        const SL1D_SHORT = (t) => `<p class="text-sm text-center text-muted-foreground line-clamp-2 mb-1">${t}</p>`;
        const SL1D_RATING = (stars, t) => `<p class="text-sm text-center text-muted-foreground mb-1"><span aria-hidden="true" class="text-primary mr-1">${stars}</span>${t}</p>`;
        const SL1D_POST_EYEBROW = (t) => `<p class="w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">${t}</p>`;
        const SL1D_ASIDE = `<div class="grid gap-10 md:grid-cols-3"><aside class="space-y-6">`
            + `<p class="text-lg leading-relaxed text-muted-foreground">${SL1D_POST_GRID_OPTIONS.asideText}</p>`
            + `<blockquote class="border-l-2 border-primary pl-4 italic text-foreground">${SL1D_POST_GRID_OPTIONS.asideQuote}</blockquote>`
            + `<a href="${SL1D_POST_GRID_OPTIONS.asideButtonLink}" class="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90">${SL1D_POST_GRID_OPTIONS.asideButtonText}</a>`
            + `</aside><div class="md:col-span-2">`;
        // What the set showcase must draw (fixtures.mjs SL1D: cards Sale, Variant, Sold Out, sl1d-first, sl1d-second).
        // Badge tags [POPULAR, wool]: Sale [wool] → wool; first [POPULAR, wool] and second [wool, POPULAR] → POPULAR.
        // Label = first category: Rugs ×3, first → hidden → none, second → SL1D Wool. Ratings: approved only.
        const SL1D_SET_ELEMENTS = [
            [SL1D_EYEBROW(SL1D_SHOWCASE_OPTIONS.eyebrow), 1, "showcase eyebrow"],
            [SL1D_BADGE("wool"), 1, "badge wool (Sale Rug)"],
            [SL1D_BADGE("POPULAR"), 2, "badge POPULAR (first, second: the block's order wins over the product's)"],
            [SL1D_LABEL("Rugs"), 3, "label Rugs"],
            [SL1D_LABEL("SL1D Wool"), 1, "label SL1D Wool (second)"],
            [SL1D_SHORT("Sale Rug description."), 1, "short text Sale"],
            [SL1D_SHORT("Variant Rug description."), 1, "short text Variant"],
            [SL1D_SHORT("Sold Out Rug description."), 1, "short text Sold Out"],
            [SL1D_SHORT("Hand-woven wool &amp; cotton. Second line."), 1, "short text first (HTML → plain text)"],
            [SL1D_SHORT("SL1D Second Rug description."), 1, "short text second"],
            [SL1D_RATING("★★★★★", "4.5/5 (2 reviews)"), 1, "rating Sale (approved 5, 4; the pending one not counted)"],
            [SL1D_RATING("★★★", "3/5 (1 review)"), 1, "rating Sold Out"],
            [SL1D_POST_EYEBROW(SL1D_POST_GRID_OPTIONS.eyebrow), 1, "post grid eyebrow"],
            [SL1D_ASIDE, 1, "post grid panel (opening)"],
        ];

        test("(sl1d-options) every showcase card option and the post grid panel: the set page differs from its plain twin EXACTLY by the new elements (HTML) and the new keys (payload); hidden category and rejected reviews not shown; the stylesheet holds every new class", async () => {
            const [page, plain] = [await sl1dPage("set", "plain"), await sl1dPage("plain", "plain")];
            // HTML: remove each new element (asserted count), and the panel's two closing </div> before the post grid's
            // </section>; the result is the plain twin byte for byte.
            let html = page.html;
            for (const [part, n, what] of SL1D_SET_ELEMENTS) html = sl1dRemove(html, part, n, what);
            const closing = "</div></div></section>";
            const at = html.indexOf(closing, page.html.indexOf(SL1D_ASIDE) - 2000);
            assert.ok(at > -1, "the panel's closing tags");
            html = html.slice(0, at) + "</section>" + html.slice(at + closing.length);
            assert.equal(html, plain.html, `HTML equal to the twin but for the new elements; ${sl1aDiff(html, plain.html)}`);
            for (const t of ["SL1D Hidden", "Fine.", "SL1D Buyer"]) assert.ok(!page.raw.includes(t), `HTML: ${t} is not rendered`);
            // Payload: the stored options and the keys the server pass added to the products; removing them gives the
            // twin's payload (resolved).
            const ADDED = [
                [`,"_categoryName":"Rugs"`, 3], [`,"_categoryName":"SL1D Wool"`, 1],
                [`,"_descriptionText":"Sale Rug description."`, 1], [`,"_descriptionText":"Variant Rug description."`, 1],
                [`,"_descriptionText":"Sold Out Rug description."`, 1], [`,"_descriptionText":"Hand-woven wool & cotton. Second line."`, 1],
                [`,"_descriptionText":"SL1D Second Rug description."`, 1],
                [`,"_rating":{"average":4.5,"count":2,"text":"4.5/5 (2 reviews)"}`, 1], [`,"_rating":{"average":3,"count":1,"text":"3/5 (1 review)"}`, 1],
                [sl1dStoredKeys(SL1D_SHOWCASE_OPTIONS), 1], [sl1dStoredKeys(SL1D_POST_GRID_OPTIONS), 1],
            ];
            let flight = page.flight;
            for (const [part, n] of ADDED) flight = sl1dRemove(flight, part, n, "payload");
            for (const k of ["_categoryName", "_descriptionText", "_rating", "SL1D Hidden"]) assert.ok(!flight.includes(k), `payload: no other ${k}`);
            assert.deepEqual(sl1aResolved(flight), sl1aResolved(plain.flight), `payload equal to the twin but for the new keys (resolved); ${sl1aDiff(flight, plain.flight)}`);
            // The compiled CSS has every class the new elements emit (literal in the two renders, which Tailwind scans
            // through globals.css `@source`).
            const sheets = [...page.raw.matchAll(/<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
            assert.ok(sheets.length > 0, "precondition: the page's stylesheets");
            const css = (await Promise.all(sheets.map((href) => request({ port: server.port, path: href, host: SL1D.set.host })))).map((r) => r.body).join("\n");
            const SL1D_CLASSES = [
                "mx-auto", "w-fit", "rounded-full", "border-primary\\/30", "tracking-widest", "top-2", "left-2", "max-w-\\[90\\%\\]", "truncate",
                "bg-primary", "text-primary-foreground", "tracking-wide", "line-clamp-2", "mr-1", "text-primary", "text-muted-foreground",
                "md\\:grid-cols-3", "md\\:col-span-2", "gap-10", "space-y-6", "border-l-2", "border-primary", "pl-4", "italic",
                "leading-relaxed", "text-lg", "px-6", "py-3", "hover\\:opacity-90", "inline-flex",
            ];
            // `.cls` followed by a character that cannot continue a class name (so `mx-auto` does not match `.mx-auto-x`).
            const hasRule = (cls) => css.split(`.${cls}`).slice(1).some((rest) => !/^[\w-]/.test(rest));
            const missing = SL1D_CLASSES.filter((cls) => !hasRule(cls));
            assert.deepEqual(missing, [], `compiled: every new class has a rule (${sheets.length} stylesheet(s))`);
            console.log(`  (sl1d-options) ${SL1D_SET_ELEMENTS.length} element kinds; HTML = twin + the elements; payload = twin + the stored options and ${ADDED.length - 2} added product keys; ${SL1D_CLASSES.length} classes compiled`);
        });

        test("(sl1d-blank-as-absent) every new attribute null, blank, empty or off, and a button link without a text: the plain twin's HTML byte for byte; the payload adds no server key (equal to the twin's but for the stored attributes)", async () => {
            const [page, plain] = [await sl1dPage("blank", "plain"), await sl1dPage("plain", "plain")];
            assert.ok(page.flight.includes('"badgeTags":[]') && page.flight.includes('"asideButtonLink":"/link-without-text"'), "precondition: the blank copy stores the attributes");
            assert.equal(page.html, plain.html, `HTML equal to the twin; ${sl1aDiff(page.html, plain.html)}`);
            let flight = page.flight;
            for (const options of [SL1D_SHOWCASE_BLANK, SL1D_POST_GRID_BLANK]) flight = sl1dRemove(flight, sl1dStoredKeys(options), 1, "stored blank options");
            assert.deepEqual(sl1aResolved(flight), sl1aResolved(plain.flight), `payload equal to the twin but for the stored attributes (resolved); ${sl1aDiff(flight, plain.flight)}`);
            console.log("  (sl1d-blank-as-absent) null and blank options: HTML byte-equal to the twin; no server key in the payload");
        });

        test("(sl1d-catalog-no-effect) a catalog site (SL-D10): badge tags, category name, short text and rating on — with the data present (tagged cards, descriptions, an approved review) — draw nothing and add no server key", async () => {
            const [page, plain] = [await sl1dPage("catalogSet", "catalogPlain"), await sl1dPage("catalogPlain", "catalogPlain")];
            assert.ok(page.flight.includes('"showRating":true'), "precondition: the set copy stores the options");
            assert.equal(page.html, plain.html, `HTML equal to the twin; ${sl1aDiff(page.html, plain.html)}`);
            const flight = sl1dRemove(page.flight, ',"badgeTags":["wool"],"showCategoryLabel":true,"showDescription":true,"showRating":true', 1, "stored options");
            assert.deepEqual(sl1aResolved(flight), sl1aResolved(plain.flight), `payload equal to the twin but for the stored attributes (resolved); ${sl1aDiff(flight, plain.flight)}`);
            for (const k of ["_categoryName", "_descriptionText", "_rating", '"tags"']) assert.ok(!page.flight.includes(k), `payload: no ${k}`);
            console.log("  (sl1d-catalog-no-effect) catalog: HTML byte-equal to the twin; no server key");
        });

        // ── ROWS (sl1e-*) — SHOP-LOOK-1E (docs/slices/shop-look-1e.md). Server HTML and payload of the running build for the
        // SL1E tenants (fixtures.mjs `SL1E`: copies of the CM1 commerce tenant storing an active and a disabled custom form;
        // page `/sl1e-form` = a paragraph and `form` block(s): set / blank (its twin: same options, blank slug) / none).
        // "A page without the block → today's bytes" is proven by every existing row, unchanged (no existing page holds
        // the block). These rows prove, in the built site: the form drawn from the stored form (fields by type in order,
        // the select of the reference, the button text, the locale placeholder) with the eyebrow, headline, text and card;
        // that the set page differs from its twin EXACTLY by the block's <section> (HTML) and the block's attributes plus
        // `_form` (payload); that the owner's notify address never reaches a page; that a disabled form, a slug of no form
        // and a blank slug draw nothing and add no `_form`.
        /** The page of an SL1E copy, its key fields written as its twin's (so twins compare byte for byte). */
        const sl1ePage = async (key, twin) => {
            const res = await request({ port: server.port, path: SL1E_PATH, host: SL1E[key].host });
            assert.equal(res.status, 200, `${key}: 200`);
            const asTwin = (t) => t.split(SL1E[key].host).join(SL1E[twin].host).split(SL1E[key].id).join(SL1E[twin].id);
            const { html } = splitFlight(res.body);
            sl1aSide ??= { buildId: (await readFile(path.join(RENDERER_DIR, ".next", "BUILD_ID"), "utf8")).trim(), clientModules: await readClientModules(RENDERER_DIR) };
            const flight = maskBody(res.body, sl1aSide).masked.split("\n--- flight payload rows, sorted ---\n")[1];
            return { raw: html, html: asTwin(html), flight: asTwin(flight), body: res.body };
        };
        const SL1E_SITE = resolveLocaleStrings({ locale: "en-US" }).strings.site;
        /** What the server pass must give the set block (`formForBlock`): display data only, the four locale texts. */
        const SL1E_PREPARED = {
            slug: SL1E_BLOCK.formSlug, name: SL1E_FORM.name, fields: SL1E_FIELDS, submitButtonText: SL1E_FORM.submitButtonText, successMessage: SL1E_FORM.successMessage,
            strings: { formSubmissionFailed: SL1E_SITE.formSubmissionFailed, formErrorShort: SL1E_SITE.formErrorShort, formSelectPlaceholder: SL1E_SITE.formSelectPlaceholder, formSubmitting: SL1E_SITE.formSubmitting },
        };

        test("(sl1e-form) a custom form placed by its slug: eyebrow, headline, text, the card, the fields by type in order, the select \"Primary interest\", the button text; the set page differs from its blank-slug twin exactly by the block's section (HTML) and its attributes + `_form` (payload); the notify address is never sent; the stylesheet holds every class", async () => {
            const [page, blank] = [await sl1ePage("set", "blank"), await sl1ePage("blank", "blank")];
            const start = page.html.indexOf('<section class="my-12">');
            assert.ok(start >= 0, "the form section is drawn");
            const section = page.html.slice(start, page.html.indexOf("</section>", start) + "</section>".length);
            const head = '<section class="my-12"><div class="text-center mb-8">'
                + `<p class="mx-auto w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">${SL1E_BLOCK.eyebrow}</p>`
                + `<h2 class="text-2xl md:text-3xl font-bold mb-2">${SL1E_BLOCK.headline}</h2><p class="text-muted-foreground">${SL1E_BLOCK.text}</p></div>`
                + '<div class="max-w-lg mx-auto rounded-xl border border-border bg-background p-6 md:p-8 shadow-sm"><form class="space-y-4">';
            assert.ok(section.startsWith(head), `the head and the card, byte for byte; ${sl1aDiff(section.slice(0, head.length), head)}`);
            assert.ok(section.endsWith(`>${SL1E_FORM.submitButtonText}</button></form></div></section>`), "the button text closes the form, inside the card");
            const labels = [...section.matchAll(/<label for="([^"]+)" class="text-sm font-medium block mb-1">([^<]+)/g)];
            assert.deepEqual(labels.map((m) => m[2]), SL1E_FIELDS.map((f) => f.label), "one label per stored field, in order");
            for (const [, id] of labels) assert.equal(section.split(`id="${id}"`).length - 1, 1, `the label's control ${id}`);
            assert.match(section, /<input id="[^"]+" type="text" placeholder="Your name" required=""/, "Name: a required text input with its placeholder");
            assert.match(section, /<input id="[^"]+" type="email" required=""/, "E-mail: a required email input");
            assert.ok(section.includes(`<option value="" selected="">${SL1E_SITE.formSelectPlaceholder}</option><option value="Hardwood">Hardwood</option><option value="Carpet">Carpet</option><option value="Tile">Tile</option></select>`), "Primary interest: the locale placeholder and the stored options");
            assert.match(section, /<textarea id="[^"]+" rows="4"/, "Message: a textarea");
            assert.equal(section.split('<span class="text-destructive ml-1">*</span>').length - 1, 2, "two required marks, theme colour");
            assert.ok(page.html.includes(`mx-auto px-6">${section}</div>`), "inside the block's width wrapper");
            assert.equal(page.html.replace(section, ""), blank.html, `HTML equal to the twin but for the section; ${sl1aDiff(page.html.replace(section, ""), blank.html)}`);
            assert.ok(!page.body.includes(SL1E_NOTIFY) && !page.body.includes("FORMSLUG#") && !page.body.includes('"notifyEmail"'), "neither the notify address nor the stored keys reach the page (HTML or payload)");
            // Payload: the stored attributes plus `_form` = SL1E_PREPARED, exactly once; swapping the set block's attributes
            // for the twin's gives the twin's payload (resolved).
            const setAttrs = JSON.stringify({ ...SL1E_BLOCK, _form: SL1E_PREPARED });
            const flightBack = swapOnce(page.flight, setAttrs, JSON.stringify(SL1E_BLANK_BLOCK), "payload attrs");
            assert.deepEqual(sl1aResolved(flightBack), sl1aResolved(blank.flight), `payload equal to the twin but for the block's attributes (resolved); ${sl1aDiff(flightBack, blank.flight)}`);
            const sheets = [...page.raw.matchAll(/<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
            assert.ok(sheets.length > 0, "precondition: the page's stylesheets");
            const css = (await Promise.all(sheets.map((href) => request({ port: server.port, path: href, host: SL1E.set.host })))).map((r) => r.body).join("\n");
            const SL1E_CLASSES = [
                "max-w-lg", "rounded-xl", "border-border", "bg-background", "p-6", "md\\:p-8", "shadow-sm", "text-destructive", "text-muted-foreground",
                "md\\:text-3xl", "border-primary\\/30", "tracking-widest", "w-fit", "space-y-4", "resize-y", "focus\\:ring-primary\\/20", "focus\\:border-primary",
                "bg-primary", "text-primary-foreground", "disabled\\:opacity-50", "text-green-500", "animate-spin",
            ];
            // `.c{`, `.c:`, `.c,` — and `.c>` for a child selector (Tailwind v4 compiles `space-y-4` as `:where(.space-y-4>…)`).
            const missing = SL1E_CLASSES.filter((cls) => ![`.${cls}{`, `.${cls} {`, `.${cls}:`, `.${cls},`, `.${cls}>`].some((form) => css.includes(form)));
            assert.deepEqual(missing, [], `compiled: every class of the block has a rule (${sheets.length} stylesheet(s))`);
            console.log(`  (sl1e-form) ${labels.length} fields in order; HTML = twin + the section; payload = twin but for the block's attributes and _form; no notify address; ${SL1E_CLASSES.length} classes compiled`);
        });

        test("(sl1e-draws-nothing) a blank slug, a disabled form and a slug of no form: no section, no form, no `_form`; each block's width wrapper stays empty", async () => {
            const [none, blank] = [await sl1ePage("none", "blank"), await sl1ePage("blank", "blank")];
            // The block's width wrapper follows the paragraph's: it is empty on the twin; on `none` there are two, both empty.
            const AFTER = "SL1E paragraph.</span></p></div>";
            assert.equal(blank.html.split(AFTER).length - 1, 1, "precondition: the paragraph once");
            const at = blank.html.indexOf(AFTER) + AFTER.length;
            const EMPTY = blank.html.slice(at).match(/^<div class="[^"]+ mx-auto px-6"><\/div>/)?.[0];
            assert.ok(EMPTY, `blank: the block's wrapper, empty; found ${blank.html.slice(at, at + 120)}`);
            const expected = blank.html.slice(0, at) + EMPTY + blank.html.slice(at);
            assert.equal(none.html, expected, `none = the twin with two empty wrappers; ${sl1aDiff(none.html, expected)}`);
            for (const page of [none, blank]) {
                for (const t of ['<section class="my-12">', "<form", SL1E_FORM.submitButtonText, SL1E_BLOCK.headline, "Primary interest", SL1E_NOTIFY]) assert.ok(!page.raw.includes(t), `HTML: no ${t}`);
                assert.ok(!page.flight.includes('"_form"') && !page.body.includes(SL1E_NOTIFY), "payload: no _form, no notify address");
            }
            const noneBlocks = SL1E_NONE_BLOCKS.map((attrs) => JSON.stringify({ type: "form", attrs })).join(",");
            const flightBack = swapOnce(none.flight, noneBlocks, JSON.stringify({ type: "form", attrs: SL1E_BLANK_BLOCK }), "payload blocks");
            assert.deepEqual(sl1aResolved(flightBack), sl1aResolved(blank.flight), `payload equal to the twin but for the stored blocks (resolved); ${sl1aDiff(flightBack, blank.flight)}`);
            console.log("  (sl1e-draws-nothing) blank slug, disabled form, slug of no form: nothing drawn, no _form");
        });

        // ── ROW (newsletter-1-page) — NEWSLETTER-1 (docs/slices/newsletter-1.md). Server HTML and payload of the running build for
        // the NL1 tenant (fixtures.mjs `NL1`: a CM1 content copy storing a MailerLite connection with a sentinel token; page
        // `/nl1-newsletter` = a paragraph and one `newsletter` block). Proves, in the built site: the form drawn from the
        // tenant's locale table (headline, text, email field, a required consent box with the consent line, the button);
        // `_newsletter` in the payload is exactly `newsletterTexts` of the tenant; the stored token, the group id and the
        // `mailerlite` key reach no page of the tenant (ruling 7). "No block → today's bytes" (ruling 11) is every other row.
        test("(newsletter-1-page) a page with a newsletter block: the form with the tenant's consent line beside a required box (HTML), `_newsletter` = the en-US newsletter texts (payload); the stored MailerLite token reaches no page of the tenant (HTML or payload)", async () => {
            const texts = newsletterTexts(resolveLocaleStrings({ locale: "en-US" }));
            const res = await request({ port: server.port, path: NL1_PATH, host: NL1.site.host });
            assert.equal(res.status, 200);
            const { html, flight } = splitFlight(res.body);
            const start = html.indexOf('<section class="my-12 max-w-md mx-auto">');
            assert.ok(start >= 0, "the block's section is drawn");
            const section = html.slice(start, html.indexOf("</section>", start) + "</section>".length);
            assert.ok(section.includes(`<h2 class="text-2xl font-bold mb-2">${NL1_BLOCK.headline}</h2><p class="text-muted-foreground">${NL1_BLOCK.description}</p>`), "headline and text");
            assert.match(section, /<input id="[^"]+-email" type="email" required="" autoComplete="email" placeholder="name@example\.com"/, "the email field");
            assert.match(section, new RegExp(`<input id="([^"]+)-consent" type="checkbox" required=""[^>]*/><label for="\\1-consent" class="text-sm text-muted-foreground">${texts.consent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</label>`), "the consent line beside a required box");
            assert.ok(section.endsWith(`>${texts.subscribe}</button></form></section>`), "the locale button text closes the form");
            assert.equal(flight.split(`"_newsletter":${JSON.stringify(texts)}`).length - 1, 1, "payload: `_newsletter` = the tenant's newsletter texts, once");
            const lines = [];
            for (const p of [NL1_PATH, "/"]) {
                const page = p === NL1_PATH ? res : await request({ port: server.port, path: p, host: NL1.site.host });
                assert.equal(page.status, 200, `${p}: 200`);
                for (const secret of [NL1_TOKEN, NL1_GROUP, "mailerlite"]) assert.ok(!page.body.includes(secret), `${p}: no ${secret} in the HTML or the payload`);
                lines.push(`${p} ${page.body.length} B`);
            }
            console.log(`  (newsletter-1-page) form drawn with the en-US consent line; _newsletter once; no token, group id or mailerlite key in ${lines.join(", ")}`);
        });

        // ── ROW (gallery-1-page) — GALLERY-1 (docs/slices/gallery-1.md, rulings 2, 4, 8, 9). Server HTML, payload, stylesheets
        // and script chunks of the running build for the GL1 tenant (fixtures.mjs `GL1`: a CM1 content copy; page
        // `/gl1-gallery` = a paragraph and one `gallery` block of 30 photos plus one item with a `javascript:` address).
        // Proves, in the built site: 30 tiles, each a plain link to its large photo holding a lazy tile photo (`thumb` where
        // stored, else `src`), named by its description or by the locale text with its position; the dropped address in no
        // attribute; the viewer a closed native <dialog> named by the locale text, holding no image (ruling 9 (a)); the tile
        // <img> of a photo WITH `thumb` holds the small file and no large file (9 (c)); the tile <img> of a photo WITHOUT
        // `thumb` IS the large file, lazy — the page-load guarantee is NOT claimed for those (9 (d), GALLERY1-TILE-FILES = A;
        // 15 of the fixture's 30 tiles); `_gallery` in the payload = `galleryTexts` of the tenant, once; every class the block draws has a
        // compiled rule; the block's code is in a client chunk that no page names (this one or one without the block) and
        // that only the lazy loader map names (ruling 4). "No block → today's bytes" (ruling 4) is every other row, unchanged.
        test("(gallery-1-page) a page with a 30-photo gallery: lazy tiles linking to the large photos, the dropped address in no attribute, a closed named <dialog> holding no image, thumb tiles small, no-thumb tiles the large file (lazy, no page-load guarantee) (HTML); `_gallery` = the en-US gallery texts (payload); the block's classes compiled; its code in a lazily loaded chunk that no page names, reached through the loader map", async () => {
            const texts = galleryTexts(resolveLocaleStrings({ locale: "en-US" }));
            const res = await request({ port: server.port, path: GL1_PATH, host: GL1.site.host });
            assert.equal(res.status, 200);
            const { html, flight } = splitFlight(res.body);
            const start = html.indexOf('<div class="my-8"><ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4">');
            assert.ok(start >= 0, "the block and its 4-column grid are drawn");
            const block = html.slice(start, html.indexOf("</dialog>", start) + "</dialog>".length);
            const tiles = [...block.matchAll(/<li><a href="([^"]+)" data-gallery-index="(\d+)"(?: aria-label="([^"]+)")? class="block aspect-\[4\/3\] overflow-hidden rounded-md bg-muted"><img src="([^"]+)" alt="([^"]*)" loading="lazy" decoding="async"(?: width="(\d+)" height="(\d+)")? class="h-full w-full object-cover"\/><\/a><\/li>/g)];
            assert.equal(tiles.length, 30, "30 tiles (the item with a javascript: address dropped)");
            for (const [i, m] of tiles.entries()) {
                const item = GL1_ITEMS[i];
                assert.deepEqual(m.slice(1, 8), [item.src, String(i), item.alt === "" ? fillTemplate(texts.photo, { n: i + 1 }) : undefined, item.thumb ?? item.src, item.alt,
                    item.width !== undefined ? String(item.width) : undefined, item.height !== undefined ? String(item.height) : undefined], `tile ${i + 1}`);
            }
            assert.ok(!/(href|src)="javascript:/i.test(html) && !html.includes(`="${GL1_DROPPED_SRC}"`), "the dropped address is in no attribute");
            const dialog = block.slice(block.indexOf("<dialog"));
            assert.ok(dialog.startsWith(`<dialog aria-label="${texts.viewer}" class="`), "the viewer: a native dialog named by the locale text");
            assert.ok(!/<dialog[^>]* open/.test(dialog) && !dialog.includes("<img"), "9 (a): the viewer is closed and holds no image");
            for (const name of [texts.close, texts.previous, texts.next]) assert.ok(dialog.includes(`aria-label="${name}" title="${name}"`), `the ${name} button`);
            assert.ok(!GL1_ITEMS.some((item) => item.thumb && html.includes(`<img src="${item.src}"`)), "9 (c): no <img> holds the large file of a photo that has a thumb");
            // 9 (d): a photo without `thumb` — its tile <img> is the large file, deferred only by `loading="lazy"`.
            const largeTiles = tiles.filter((m, i) => GL1_ITEMS[i].thumb === undefined && m[4] === GL1_ITEMS[i].src);
            assert.equal(largeTiles.length, GL1_ITEMS.filter((item) => item.thumb === undefined).length, "9 (d): every tile without a thumb shows the large file");
            assert.equal(largeTiles.length, 15, "precondition: the fixture has 15 tiles without a thumb");
            assert.equal(flight.split(`"_gallery":${JSON.stringify(texts)}`).length - 1, 1, "payload: `_gallery` = the tenant's gallery texts, once");
            // The block's classes have compiled rules (the stylesheets this page links).
            const sheets = [...html.matchAll(/<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
            assert.ok(sheets.length > 0, "precondition: the page's stylesheets");
            const css = (await Promise.all(sheets.map((href) => request({ port: server.port, path: href, host: GL1.site.host })))).map((r) => r.body).join("\n");
            const GL1_CLASSES = [
                "my-8", "grid-cols-2", "sm\\:grid-cols-3", "lg\\:grid-cols-4", "gap-2", "sm\\:gap-4", "aspect-\\[4\\/3\\]", "rounded-md", "bg-muted", "object-cover",
                "max-h-none", "max-w-none", "border-0", "bg-background", "text-foreground", "backdrop\\:bg-foreground\\/80", "min-h-0", "flex-1", "sm\\:px-16",
                "h-11", "w-11", "rounded-full", "border-border", "hover\\:bg-muted", "top-1\\/2", "-translate-y-1\\/2", "left-2", "right-2", "object-contain",
                "min-h-6", "text-muted-foreground",
            ];
            const missing = GL1_CLASSES.filter((cls) => ![`.${cls}{`, `.${cls} {`, `.${cls}:`, `.${cls},`, `.${cls}>`].some((form) => css.includes(form)));
            assert.deepEqual(missing, [], `compiled: every class of the block has a rule (${sheets.length} stylesheet(s))`);
            // Ruling 4: the block's code (the string `data-gallery-index`, in GalleryRender and GalleryViewer) is in its own
            // client chunk(s), which NO page names — not this page, not a page without the block (this tenant's home, the NL1
            // page); the chunks the pages name hold none of it. It is reached only by name, from a chunk the pages name that
            // holds the lazy loaders (`RENDER_LOADERS`, code-split by RenderBlocks): the browser fetches it when a gallery
            // block renders. (That the browser does fetch it is the operator's staging check in a real browser.)
            const STATIC = path.join(RENDERER_DIR, ".next", "static", "chunks");
            const built = (await readdir(STATIC)).filter((f) => f.endsWith(".js"));
            const holding = [];
            for (const f of built) if ((await readFile(path.join(STATIC, f), "utf8")).includes("data-gallery-index")) holding.push(f);
            assert.ok(holding.length >= 1, `precondition: a built client chunk holds the gallery code (${built.length} chunks)`);
            const namedBy = (body) => [...new Set([...body.matchAll(/static\/chunks\/([A-Za-z0-9_.-]+\.js)/g)].map((m) => m[1]))];
            const pages = [["gallery page", res.body, GL1.site.host]];
            for (const [p, host] of [["/", GL1.site.host], [NL1_PATH, NL1.site.host]]) {
                const page = await request({ port: server.port, path: p, host });
                assert.equal(page.status, 200, `${p}: 200`);
                assert.ok(!page.body.includes("data-gallery-index"), `${p}: no gallery markup`);
                pages.push([p, page.body, host]);
            }
            const loaders = [];
            for (const [name, body, host] of pages) {
                const named = namedBy(body);
                assert.deepEqual(named.filter((c) => holding.includes(c)), [], `${name}: names no chunk of the gallery code`);
                for (const c of named) {
                    const r = await request({ port: server.port, path: `/_next/static/chunks/${c}`, host });
                    assert.equal(r.status, 200, `${name} ${c}: 200`);
                    assert.ok(!r.body.includes("data-gallery-index"), `${name}: ${c} holds no gallery code`);
                    if (name === "gallery page" && holding.some((g) => r.body.includes(g))) loaders.push(c);
                }
            }
            assert.ok(loaders.length >= 1, "the gallery chunk is named by a chunk the gallery page names (the lazy loader map)");
            const own = holding;
            const others = pages.slice(1).map(([p, body]) => `${p} ${namedBy(body).length} chunks`);
            console.log(`  (gallery-1-page) 30 lazy tiles (15 thumb = small file, 15 no thumb = the large file), dropped address absent, closed named dialog holding no image; _gallery once; ${GL1_CLASSES.length} classes compiled; gallery code in ${own.join(", ")}, named only by the loader chunk ${loaders.join(", ")}; no page names it (gallery page, ${others.join(", ")})`);
        });

        // LOCALE-1D: the en-US order pages reach the states the coverage rule names (§ 16.2 item 5; positive control of the
        // text rows, which only prove "equal to 92adbba"): a bank-transfer confirmation with the bank block, a cash-on-
        // delivery confirmation, the confirmation without an order, a tracking page with a tracking number, an "Order Not
        // Found" page; the account page answers 200 (its texts render on the client: test/unit/locale-1d-client.test.ts).
        test("(loc1-order-pages) en-US commerce: the order pages render their states (confirmation bank / COD / no order, tracking, not found, account)", async () => {
            const cand = await loc1EnSet();
            const at = (p) => { const c = cand.captures.find((x) => x.tenant === "commerce" && x.path === p); assert.ok(c, p); assert.equal(c.status, 200, p); return extractVisibleText(c.body).map((i) => i.text); };
            const q = "email=buyer%40serving-contract.test";
            const bank = at(`${CONFIRMATION_ADDRESS}?id=cm1-order-bank&${q}`);   // CDL-2: the confirmation's new address
            for (const t of ["Order Confirmed!", "Bank Transfer Details", "Bank:", "IBAN:", "RO49AAAA1B31007593840000", "SWIFT:", "Reference:", "Amount:", "Qty: 2", "Free", "Shipping Address"]) assert.ok(bank.includes(t), `bank confirmation: ${t}`);
            const cod = at(`${CONFIRMATION_ADDRESS}?id=cm1-order-cod&${q}`);
            for (const t of ["Cash on Delivery", "You will pay", "when you receive your order.", "Estimated delivery:", "Discount", "Phone: +1 555 0100"]) assert.ok(cod.includes(t), `COD confirmation: ${t}`);
            assert.ok(at(CONFIRMATION_ADDRESS).includes("Thank you for your order!"));
            const track = at(`/checkout/cm1-order-cod?${q}`);
            for (const t of ["Order CM1-0002", "Placed on 10/15/2026", "pending", "completed", "Tracking Number:", "AWB-CM1-0002", "Items"]) assert.ok(track.includes(t), `tracking: ${t}`);
            assert.ok(at("/checkout/cm1-order-bank?email=not-the-buyer%40serving-contract.test").includes("Order Not Found"));
            at("/account");
            // The RO copy's bank block: the two labels whose Romanian text equals the English one (so no RO change lists them).
            const roBank = (await loc1RoSet()).find((c) => c.tenant === "roCommerce" && c.path === `${CONFIRMATION_ADDRESS}?id=cm1-order-bank&${q}`);
            const roTexts = extractVisibleText(roBank.body).map((i) => i.text);
            for (const k of ["ibanLabel", "swiftLabel", "bankLabel", "amountLabel"]) assert.ok(roTexts.includes(RO_TABLE.commerce[k]), `RO bank confirmation: ${k}`);
            console.log("  (loc1-order-pages) bank, COD and no-order confirmations, tracking, not found and account render on the en-US commerce fixture; the RO bank block shows the RO pack labels");
        });

        // ── ROWS (cdl2-*) — CDL-2 (docs/slices/cdl-2.md; design docs/slices/catalog-data-labels-1.md § 7, § 14). ───────────
        // The one address move of the fixtures (`preCdl2Address`): its rule, its record in cdl-2/before/, and the accepted
        // effect at the old address (a commerce tenant without a stored segment: `/checkout/confirmare` reads as tracking).
        test("(cdl2-moved-address) the confirmation address move: exactly CONFIRMATION_ADDRESS (± query) maps to /checkout/confirmare; before/ holds the confirmation page there; the old address now answers as an order tracking page", async () => {
            assert.equal(CONFIRMATION_ADDRESS, "/checkout/confirmation");
            assert.equal(preCdl2Address("/checkout/confirmation"), "/checkout/confirmare");
            assert.equal(preCdl2Address("/checkout/confirmation?id=o1&email=a%40b.test"), "/checkout/confirmare?id=o1&email=a%40b.test");
            // Negative controls: every other path is returned unchanged.
            for (const p of ["/checkout", "/checkout/confirmations", "/checkout/confirmation-x", "/checkout/confirmation/x", "/checkout/o1?email=a", "/x/checkout/confirmation", "/checkout/confirmare", "/my-list", "/"]) {
                assert.equal(preCdl2Address(p), p, p);
            }
            // The record: each moved before/ capture is the 7bd3d51 CONFIRMATION page (not a tracking page).
            const before = await loc1BeforeSet();
            const moved = before.captures.filter((c) => Object.hasOwn(c, "requestedPath"));
            assert.equal(moved.length, 6);
            const textOf = (c) => extractVisibleText(c.body).map((i) => i.text);
            for (const c of moved.filter((x) => x.tenant === "commerce")) {
                const t = textOf(c);
                assert.ok(c.path === CONFIRMATION_ADDRESS ? t.includes("Thank you for your order!") : t.includes("Order Confirmed!"), `${c.path}: the confirmation page at ${c.requestedPath}`);
                assert.ok(!t.includes("Order Not Found") && !t.includes("Order Tracking"), `${c.path}: not a tracking page`);
            }
            // The accepted effect (packet § 2 item 4): on the candidate the old address is an order tracking address.
            const q = "email=buyer%40serving-contract.test";
            for (const p of [`${PRE_CDL2_CONFIRMATION_ADDRESS}?id=cm1-order-bank&${q}`, PRE_CDL2_CONFIRMATION_ADDRESS]) {
                const res = await request({ port: server.port, path: p, host: CM1.commerce.host });
                const t = extractVisibleText(res.body).map((i) => i.text);
                assert.equal(res.status, 200, p);
                assert.ok(t.includes("Order Not Found") && !t.includes("Order Confirmed!") && !t.includes("Thank you for your order!"), `${p}: a tracking page for the order id "confirmare"`);
            }
            console.log(`  (cdl2-moved-address) ${CONFIRMATION_ADDRESS} (± query) ↔ ${PRE_CDL2_CONFIRMATION_ADDRESS}; 9 other paths unchanged; ${moved.length} before/ captures are 7bd3d51 confirmation pages; the old address answers "Order Not Found" (tracking)`);
        });

        // The partial-prefix tenant (fixtures.mjs CDL2; design § 8.4 "cdl-2"): its stored urlPrefixes is the one-key object
        // the Settings page saves. Under the per-key rule its product, shop and category pages route at the English
        // defaults, and its interest list is at the stored /lista-mea, which the header widget links to. On 7bd3d51 the same
        // tenant answered the not-found handoff (307) for /product/oak-plank, /shop and /category/floors (EXECUTED,
        // docs/slices/cdl-2.md § 8.3). Control: the en-US catalog subject (no stored interest) has its list at /my-list.
        test("(cdl2-partial-prefixes) a catalog tenant storing only { interest: \"/lista-mea\" }: /product/<slug>, /shop and /category/<slug> route; /lista-mea is the interest list page and the header links there; /my-list is not; the subject without a stored interest has its list at /my-list", async () => {
            const stored = ITEMS.find((i) => i.SK === `TENANT#${CDL2.partial.id}`).urlPrefixes;
            assert.deepEqual(stored, CDL2_STORED_PREFIXES, "precondition: the stored object has the interest key only");
            assert.deepEqual(urlPrefixesOf(stored), { ...URL_PREFIX_DEFAULTS, interest: "/lista-mea" });
            const get = (host, p) => request({ port: server.port, path: p, host });
            const LIST_PAGE = "InterestListPage";   // the client export the list page (and only it) references in its payload
            const lines = [];
            for (const p of ["/product/oak-plank", "/shop", "/category/floors"]) {
                const res = await get(CDL2.partial.host, p);
                assert.equal(res.status, 200, `${p} routes`);
                const html = splitFlight(res.body).html;
                assert.equal(html.split('href="/lista-mea"><span class="relative">').length - 1, 2, `${p}: the header widget (desktop and mobile) links to /lista-mea`);
                assert.ok(!html.includes('href="/my-list"'), `${p}: no link to /my-list`);
                assert.ok(splitFlight(res.body).flight.includes('"listPrefix":"/lista-mea"'), `${p}: the payload carries /lista-mea`);
                assert.ok(!res.body.includes(LIST_PAGE), `${p}: not the list page`);
                lines.push(`${p} 200`);
            }
            assert.ok(splitFlight((await get(CDL2.partial.host, "/product/oak-plank")).body).html.includes(">Oak Plank</h1>"), "the product page of the fixture product");
            const list = await get(CDL2.partial.host, "/lista-mea");
            assert.equal(list.status, 200);
            assert.ok(list.body.includes(LIST_PAGE), "/lista-mea is the interest list page");
            const other = await get(CDL2.partial.host, "/my-list");
            assert.equal(other.status, 307, "/my-list is not the list page on this tenant (no content page: the not-found handoff)");
            // Control: the en-US catalog subject stores no interest → its list is at /my-list; /lista-mea is an ordinary slug.
            const subjectList = await get(CM1.catalog.host, "/my-list");
            assert.equal(subjectList.status, 200);
            assert.ok(subjectList.body.includes(LIST_PAGE), "the subject's list page is at /my-list");
            assert.equal((await get(CM1.catalog.host, "/lista-mea")).status, 307, "the subject's /lista-mea is not the list page");
            console.log(`  (cdl2-partial-prefixes) ${CDL2.partial.id}: ${lines.join(", ")}; /lista-mea list page (header links there); /my-list 307. ${CM1.catalog.id}: /my-list list page, /lista-mea 307`);
        });

        // ── ROW (cmrc-counties-1) — docs/slices/cmrc-counties-1.md. The checkout form's region list follows the tenant's
        // real country (mapTenant copies `countryCode`): the RO commerce copy (`countryCode: "RO"`) receives the 42 counties
        // of the RO country pack; the en-US commerce tenant (`countryCode: "EN"`) receives none, so its form shows the
        // free-text county field. The form itself renders only on the client with a cart (the server HTML is "Your cart
        // is empty"), so the field's markup is proven in renderer/test/unit/cmrc-counties-1-checkout.test.ts; here, the
        // props the server sends. COUNTIES-TEXT-LAYER = off: the checkout `strings` come from the language table (locale-1d), never the country.
        test("(cmrc-counties-1) /checkout: the RO commerce copy receives the 42 RO-pack counties, the en-US commerce tenant none; checkout `strings` follow the language, not the country", async () => {
            /** The CheckoutPageView props in a captured payload: the one props object with `tenantId` and `defaultRegions`. */
            const checkoutProps = (body) => {
                const found = [];
                const walk = (v) => {
                    if (Array.isArray(v)) return v.forEach(walk);
                    if (v === null || typeof v !== "object") return;
                    if (Object.hasOwn(v, "tenantId") && Object.hasOwn(v, "defaultRegions")) found.push(v);
                    Object.values(v).forEach(walk);
                };
                for (const line of splitFlight(body).flight.split("\n")) {
                    const m = /^[0-9a-f]+:([[{].*)$/s.exec(line);
                    if (m) walk(JSON.parse(m[1]));
                }
                assert.equal(found.length, 1, "exactly one CheckoutPageView props object in the payload");
                return found[0];
            };
            const page = (captures, tenant) => captures.find((c) => c.tenant === tenant && c.path === "/checkout");
            const en = checkoutProps(page((await cm1Set()).captures, "commerce").body);
            const ro = checkoutProps(page(await loc1RoSet(), "roCommerce").body);
            const roRegions = getCountryPack("RO").address.regions.map((r) => r.name);
            assert.equal(roRegions.length, 42);
            assert.deepEqual(ro.defaultRegions, roRegions, "RO commerce copy: the 42 counties of the RO pack");
            assert.deepEqual(en.defaultRegions, [], "en-US commerce tenant: no region list → free-text county field");
            assert.deepEqual(ro.availableCounties, [], "no configured counties on either fixture (the country decides)");
            assert.deepEqual(en.availableCounties, []);
            assert.ok(ro.strings !== null && typeof ro.strings === "object", "checkout strings travel inline");
            // LOCALE-1D changed this expectation (docs/slices/locale-1d.md): the texts now follow the tenant's LANGUAGE
            // (`locale`), still never its country — the RO copy's checkout texts are exactly the RO table's (resolved
            // without any country), the en-US tenant's exactly the EN table's. (Before 1d: both equal, English.)
            const tableValue = (table, k) => (Object.hasOwn(table.commerce, k) ? table.commerce[k] : table.site[k]);
            assert.deepEqual(Object.keys(ro.strings), Object.keys(en.strings), "the same keys on both");
            assert.deepEqual(ro.strings, Object.fromEntries(Object.keys(en.strings).map((k) => [k, tableValue(RO_TABLE, k)])), "RO copy: the RO table's texts (no country layer)");
            assert.deepEqual(en.strings, Object.fromEntries(Object.keys(en.strings).map((k) => [k, tableValue(EN_TABLE, k)])), "en-US: the EN table's texts");
            console.log(`  (cmrc-counties-1) roCommerce /checkout defaultRegions ${ro.defaultRegions.length} (RO pack); commerce /checkout defaultRegions ${en.defaultRegions.length}; strings = the language's table (${Object.keys(ro.strings).length} keys)`);
        });

        // ── ROWS (loc1e-*) — LOCALE-1E, `<html lang>` per tenant (docs/slices/locale-1e.md). `<html>` is written by
        // `app/[siteId]/layout.tsx`, now the root layout; `lang` = the language subtag of the tenant's normalised locale.
        // The expected values are literals, not the helper's output (an oracle is not the code under test).
        /** The body class of d9999d2's `app/layout.tsx` (an oracle literal, not the renderer's constant). */
        const BODY_CLASS = "antialiased min-h-screen bg-white text-gray-900";
        /** The opening `<html …>` tag of a server-rendered page. */
        const htmlTag = (body) => /<html[^>]*>/.exec(body)?.[0];
        test("(loc1e-html-lang) <html lang>: ro on every page of the three RO copies, en on every en-US subject page, on the en-GB tenant and on the malformed-locale tenant", async () => {
            const counts = {};
            const expectAll = (captures, tenants, tag) => {
                for (const c of captures.filter((x) => tenants.includes(x.tenant) && isHtml(x) && x.status === 200)) {
                    assert.equal(htmlTag(c.body), tag, `${c.tenant} ${c.path}`);
                    counts[tag] = (counts[tag] ?? 0) + 1;
                }
            };
            const ro = await loc1RoSet();
            for (const key of ["roContent", "roCatalog", "roCommerce"]) assert.ok(ro.some((c) => c.tenant === key && isHtml(c) && c.status === 200), `${key} has a 200 HTML page`);
            expectAll(ro, ["roContent", "roCatalog", "roCommerce"], '<html lang="ro">');
            expectAll((await loc1EnSet()).captures, Object.keys(EN_US_REQUESTS), '<html lang="en">');
            for (const [key, t] of Object.entries(LOC1E)) {
                const res = await request({ port: server.port, path: "/", host: t.host });
                assert.equal(res.status, 200, `${key} home`);
                assert.equal(htmlTag(res.body), '<html lang="en">', `${key} (stored locale ${JSON.stringify(t.locale)})`);
                counts[`${key} <html lang="en">`] = 1;
            }
            console.log(`  (loc1e-html-lang) ${JSON.stringify(counts)}`);
        });

        // LOCALE-1E — the 404 DOCUMENT (operator ruling LOC1E-404-DOCUMENT = B; review-0 finding 1). A 404 landing is Next's
        // `__next_error__` shell: its HTML outside the payload carries NO `lang` and no body class — at d9999d2 as now
        // (EXECUTED, `1e/before-404/`) — and the browser builds the document from the payload's ROOT 404 boundary. So the
        // row proves the document where it is defined: (1) the SSR shell outside the payload equals a d9999d2 shell except
        // the one stylesheet preload of the category; (2) the whole payload equals d9999d2's moved by category 4 — the
        // tenant wrapper with the tenant's `lang` (the RO copy: `ro`), the root boundary's document `<html lang="en">` + the
        // body class + Next's 404 UI; (3) that boundary, read directly: the root layout-router's `notFound` is exactly
        // `html{lang:"en"} > body{className} > [title, 404 UI]`. For a known en-US tenant, the RO copy and a missing tenant
        // (the layout's missing-tenant branch, which renders `children`: unit test locale-1e-html-lang). The browser view is
        // recorded in docs/slices/locale-1e.md § 5 (headless Chromium, not part of this suite).
        // NOT DETERMINISTIC, and not since this slice: a known tenant's 404 shell streams its metadata either inline in
        // <head> or later in the body (a Suspense race; EXECUTED at d9999d2: 35/25 and 21/39 of 60). So `before-404/` holds
        // EVERY variant d9999d2 produced in 60 requests (`<file>.variant-<n>`), and each of 8 live responses must equal ONE
        // of them exactly under category 4 — nothing is masked for the race.
        test("(loc1e-404-document) the 404 landings of a known tenant, the RO copy and a missing tenant: a d9999d2 shell, and a payload whose root 404 boundary is the document <html lang=\"en\"><body class> + Next's 404", async () => {
            const before = await readLanding1ExpectedCaptures(path.join(LOC1_DIR, "1e", "before-404"));
            // locale-1e.md § 18: a 404 shell's [siteId] resources are anchored to the live 200 pages captured by this run
            // from the same build and server (the en-US set); the 404 probe set itself holds only the 404 response.
            const reference = liveSiteIdReference(await loc1EnSet());
            assert.equal(reference.kind, "resources", `precondition: a live 200 reference (${reference.problem})`);
            const buildId = (await readFile(path.join(RENDERER_DIR, ".next", "BUILD_ID"), "utf8")).trim();
            const { clientModules, rootNotFoundScript } = await cm1Set();
            assert.deepEqual([...new Set(before.captures.map((c) => `${c.tenant} ${c.path}`))], LOC1E_404_REQUESTS.map((r) => `${r.tenant} ${r.path}`), "before-404/ holds exactly LOC1E_404_REQUESTS");
            const lines = [];
            for (const r of LOC1E_404_REQUESTS) {
                const variants = before.captures.filter((c) => c.tenant === r.tenant && c.path === r.path);
                const matched = new Set();
                for (let i = 0; i < 8; i++) {
                    const [a] = await captureRequests(request, server.port, [r]);
                    const cand = { buildId, clientModules, rootNotFoundScript, captures: [a] };
                    assert.equal(a.status, 404, `${r.tenant} ${r.path}`);
                    assert.ok(a.body.startsWith(ERROR_SHELL), `${r.tenant}: the error shell`);
                    const move = [{ ...LOC1_EN_MOVE, lang: r.lang }];
                    const results = variants.map((b) => (b.status === a.status && b.contentType === a.contentType && b.body.startsWith(ERROR_SHELL) ? checkExpected(before, b.body, cand, a.body, move, reference) : ["status/Content-Type/shell"]));
                    const hit = results.findIndex((p) => p.length === 0);
                    assert.ok(hit >= 0, `${r.tenant} ${r.path}: response ${i + 1} equals no d9999d2 variant under category 4: ${JSON.stringify(results)}`);
                    matched.add(hit + 1);
                    if (i === 0) {
                        // Bound mutation: one changed text of the 404 UI in the live payload matches no variant.
                        const bad = { ...a, body: a.body.replace("This page could not be found.", "This page could not be f0und.") };
                        assert.notEqual(bad.body, a.body, "mutation precondition: the 404 UI text travels in the payload");
                        assert.ok(variants.every((b) => checkExpected(before, b.body, { ...cand, captures: [bad] }, bad.body, move, reference).length > 0), `${r.tenant}: a changed 404 text was not reported`);
                    }
                    const tree = resolveFlight(maskBody(a.body, cand).masked.split("\n--- flight payload rows, sorted ---\n")[1].split("\n"));
                    const [html] = tree.root.t.t.d.r[3].children[1][3].notFound;
                    assert.equal(html[1], "html");
                    assert.deepEqual(Object.keys(html[3]), ["lang", "children"]);
                    assert.equal(html[3].lang, "en", `${r.tenant}: the root 404 document says en`);
                    const body = html[3].children;
                    assert.equal(body[1], "body");
                    assert.equal(body[3].className, BODY_CLASS, `${r.tenant}: the body class`);
                    assert.deepEqual(body[3].children.map((e) => e[1]), ["title", "div"], `${r.tenant}: Next's 404 UI`);
                }
                lines.push(`${r.tenant} ${r.path}: 8 × 404, each = a d9999d2 variant moved (of ${variants.length}; matched ${[...matched].sort().join(",")}), tenant lang ${r.lang}, root 404 document <html lang="en"><body class>`);
            }
            console.log(`  (loc1e-404-document) ${lines.join("; ")}`);
        });

        // ── ROWS (np1-*) — NEXT-PATCH-1 (docs/slices/next-patch-1.md; operator ruling R-NP1-F1 = A, 2026-11-21; CM1-A3 in
        // docs/slices/catalog-mode-1.md § 8.21). Turbopack's `<script id="_R_">` bootstrap names the framework chunks by
        // content hash, WITHOUT the `/_next/` prefix the CM1-A1 asset mask matches. Such names can change with a framework
        // update; from 16.4.3 to 16.4.6 all of them changed and the byte-identity rows failed. CM1-A3 masks those names inside that element only (`maskBody`); these rows prove that the
        // mask is that narrow (np1-bootstrap-mask-controls) and check on the current build what the names gave by accident
        // — that the listed chunks exist and load (np1-bootstrap-chunks).
        test("(np1-bootstrap-mask-controls) CM1-A3 masks only the static/chunks tokens inside <script id=\"_R_\">: every token renamed there compares equal; one token more or fewer, another byte there, or a renamed token outside it is reported", async () => {
            const set = await cm1Set();
            const page = set.captures.find((c) => c.tenant === "content" && c.path === "/");
            const [el, ...more] = page.body.match(/<script id="_R_">[^<]*<\/script>/g) ?? [];
            assert.ok(el && more.length === 0, "precondition: the page has exactly one bootstrap element");
            const tokens = bootstrapChunks(page.body);
            assert.ok(tokens.length >= 2, `precondition: the bootstrap lists at least two chunks (${tokens.length})`);
            const withEl = (next) => page.body.replace(el, next);
            const masked = (body) => maskBody(body, set).masked;
            const locale = (body) => checkExpected(set, page.body, set, body, []);
            // Positive control: every token renamed — what a new framework build does — is equal under both comparators.
            let k = 0;
            const renamed = withEl(el.replace(/static\/chunks\/[A-Za-z0-9_-]+\.js/g, () => `static/chunks/np1-renamed-${k++}.js`));
            assert.notEqual(renamed, page.body, "mutation precondition: the rename changed the body");
            assert.equal(masked(renamed), masked(page.body), "positive control: renamed bootstrap chunks compare equal (CM1-A1/A3, cm1-identity)");
            assert.deepEqual(locale(renamed), [], "positive control: renamed bootstrap chunks compare equal (locale-1 checkExpected)");
            const first = JSON.stringify(tokens[0]);
            const once = (from, to) => { assert.equal(el.split(from).length - 1, 1, `mutation precondition: ${from} once in the bootstrap`); return withEl(el.replace(from, to)); };
            const outside = (token) => page.body.replace("</body>", `<script id="np1-outside">self.np1=${JSON.stringify(token)}</script></body>`);
            const refusals = {
                "(a) one bootstrap chunk more": [page.body, once(first, `${first},${first}`)],
                "(a) one bootstrap chunk fewer": [page.body, once(`${first},`, "")],
                "(b) a non-token byte inside the bootstrap (a key)": [page.body, once('"otherChunks"', '"otherChunkz"')],
                "(b) a non-token byte inside the bootstrap (the runtime module ids)": [page.body, once('"runtimeModuleIds":[', '"runtimeModuleIds":[1,')],
                "(c) a static/chunks token renamed OUTSIDE the bootstrap": [outside("static/chunks/np1-outside-a.js"), outside("static/chunks/np1-outside-b.js")],
            };
            for (const [name, [from, to]] of Object.entries(refusals)) {
                assert.notEqual(from, to, `${name}: the mutation did not change the body`);
                assert.notEqual(maskBody(from, set).masked, maskBody(to, set).masked, `${name} was not reported (CM1-A1/A3, cm1-identity)`);
                assert.notDeepEqual(checkExpected(set, from, set, to, []), [], `${name} was not reported (locale-1 checkExpected)`);
            }
            console.log(`  (np1-bootstrap-mask-controls) content /: ${tokens.length} bootstrap chunks; 1 positive control equal under both comparators; ${Object.keys(refusals).length} refusals reported by both (${Object.keys(refusals).join("; ")})`);
        });


        // Packet § 1 item 4: status, cache-control, content-type and vary of every serving fixture URL (the en-US subjects,
        // the RO copies, the LOC1E fixtures and the not-found probes) equal the d9999d2 answers in 1e/before-headers.json
        // (captured with the cm1-byte-identity/README.md worktree procedure; each URL was requested twice there and both
        // answers agreed). Runs last in this block: its requests come after every row that depends on cache state.
        // NEXT-PATCH-1 (operator ruling R-NP1-F2 = A, 2026-11-21) — the named, version-explicit allowance of this row.
        // next 16.4.6 compresses route-handler responses (PR #101280, `server/base-http/node.ts`) when Next's `compress`
        // is on, and `next start` keeps Next's default (on); the compression adds the token `Accept-Encoding` to `Vary`.
        // OBSERVED 2026-11-21 on next 16.4.6: 24 responses, the four [siteId] route handlers on six hosts (cm1-commerce,
        // cm1-content, cm1-catalog, loc1-ro-commerce, loc1-ro-content, loc1-ro-catalog), status, cache-control and
        // content-type unchanged. Allowed — on a request to one of these route handlers ONLY, and only when the installed
        // next is 16.4.6 or later: `Vary` equal to the stored value, or the stored value + exactly ", Accept-Encoding".
        // Every other field and every other `Vary` token is compared as before. The deployed Lambda is not measured here
        // (OpenNext 4.1.9 sets `compress: false`): its header is the operator's staging check.
        const ROUTE_HANDLER_VARY_16_4_6 = { since: [16, 4, 6], token: "Accept-Encoding", paths: ["/sitemap.xml", "/openai-feed", "/robots.txt", "/llms.txt"] };
        /** `version` (x.y.z…) is `min` or later. */
        const versionAtLeast = (version, min) => {
            const v = String(version).split(/[.-]/).slice(0, 3).map(Number);
            for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
            return true;
        };
        test("(loc1e-cache-headers) every fixture URL and not-found probe answers the status, cache-control, content-type and vary of d9999d2", async () => {
            const doc = JSON.parse(await readFile(path.join(LOC1_DIR, "1e", "before-headers.json"), "utf8"));
            const want = [...Object.values(EN_US_REQUESTS).flat(), ...Object.values(LOC1_REQUESTS).flat(), ...LOC1E_PROBE_REQUESTS];
            // CDL-2: the three order-confirmation requests of the commerce fixture and of its RO copy moved address; the
            // d9999d2 record holds them at the pre-cdl-2 address (`preCdl2Address`, controls in row cdl2-moved-address).
            // Each record is compared with the answer of the CURRENT address of the same request.
            assert.deepEqual(doc.requests.map((r) => `${r.host}${r.path}`), want.map((r) => `${r.host}${preCdl2Address(r.path)}`), "before-headers.json lists exactly the current request list (moved requests at their pre-cdl-2 address)");
            const fields = (r) => ({ status: r.status, cacheControl: r.cacheControl, contentType: r.contentType, vary: r.vary });
            // ROUTE_HANDLER_VARY_16_4_6 (above): the listed paths are route handlers of THIS build, so the allowance cannot
            // reach a page; it applies only on next 16.4.6 or later.
            const A = ROUTE_HANDLER_VARY_16_4_6;
            const nextVersion = createRequire(path.join(RENDERER_DIR, "package.json"))("next/package.json").version;
            const allowance = versionAtLeast(nextVersion, A.since);
            assert.ok(!versionAtLeast("16.4.5", A.since) && versionAtLeast("16.4.6", A.since) && versionAtLeast("16.5.0", A.since) && versionAtLeast("17.0.0", A.since), "versionAtLeast");
            const routes = Object.keys(JSON.parse(await readFile(path.join(RENDERER_DIR, ".next", "app-path-routes-manifest.json"), "utf8")));
            for (const p of A.paths) assert.ok(routes.includes(`/[siteId]${p}/route`), `${p} is a route handler of the build`);
            const allowedVary = (e) => (e.vary == null ? A.token : `${e.vary}, ${A.token}`);
            const varyOk = (e, g) => g.vary === e.vary || (allowance && A.paths.includes(e.path) && g.vary === allowedVary(e));
            const same = (e, g) => e.status === g.status && e.cacheControl === g.cacheControl && e.contentType === g.contentType && varyOk(e, g)
                && JSON.stringify(Object.keys(g)) === JSON.stringify(Object.keys(fields(e)));
            const mismatches = (expected, got) => expected.flatMap((e, i) => (same(e, got[i]) ? [] : [`${e.host}${e.path}: ${JSON.stringify(fields(e))} → ${JSON.stringify(got[i])}`]));
            const got = [];
            for (const r of want) got.push(cacheFields(await request({ port: server.port, path: r.path, host: r.host })));
            assert.deepEqual(mismatches(doc.requests, got), []);
            // Bound mutation: one changed field on one URL is reported.
            const mutated = doc.requests.map((r, i) => (i === 0 ? { ...r, cacheControl: "private, no-store" } : r));
            assert.equal(mismatches(mutated, got).length, 1, "a changed cache-control was not reported");
            // Controls of the allowance (ruling R-NP1-F2): another added token, and the token on a page, are reported.
            const rh = doc.requests.findIndex((r) => A.paths.includes(r.path) && r.vary != null);
            const page = doc.requests.findIndex((r) => !A.paths.includes(r.path) && r.vary != null);
            assert.ok(rh >= 0 && page >= 0, "control precondition: a route-handler record and a page record with a Vary");
            const gotWith = (i, vary) => got.map((g, j) => (j === i ? { ...g, vary } : g));
            assert.equal(mismatches(doc.requests, gotWith(rh, `${allowedVary(doc.requests[rh])}, Cookie`)).length, 1, "a token added after Accept-Encoding on a route handler was not reported");
            assert.equal(mismatches(doc.requests, gotWith(rh, `${doc.requests[rh].vary}, Cookie`)).length, 1, "another added Vary token on a route handler was not reported");
            assert.equal(mismatches(doc.requests, gotWith(page, allowedVary(doc.requests[page]))).length, 1, "Accept-Encoding added on a page (not a route handler) was not reported");
            const allowed = doc.requests.filter((e, i) => got[i].vary !== e.vary);
            const byStatus = got.reduce((n, g) => ({ ...n, [g.status]: (n[g.status] ?? 0) + 1 }), {});
            console.log(`  (loc1e-cache-headers) ${got.length} URLs equal to d9999d2 on status, cache-control, content-type, vary: ${JSON.stringify(byStatus)}; ROUTE_HANDLER_VARY_16_4_6 (next ${nextVersion}, ${allowance ? "on" : "off"}) used by ${allowed.length} responses on ${new Set(allowed.map((e) => e.host)).size} hosts (${[...new Set(allowed.map((e) => e.path))].join(", ")}); controls reported: a token after Accept-Encoding, another token, Accept-Encoding on a page`);
        });

        // ── ROWS (sched1g-*) — SCHED-1G2, the hosted booking pages (docs/slices/sched-1.md § 10.1, § 9.1, § 17.3 rows G1-G8;
        // the contract rows in docs/caching-architecture.md § Serving contract, "Booking pages"). Running build only; the
        // tenants are `SCHED1G` (fixtures.mjs). The suite has no booking backend: since cmrc-1l `API_URL` is the
        // backend stub (backend-stub.mjs), which answers the order lookup only and DROPS every other request, so the
        // forward call fails as it did when the environment had no `API_URL`. A proxy request that passes every
        // renderer check therefore answers 503 `unavailable` at the
        // forward step: that status is the proof that the request was accepted and would have been forwarded. What the
        // proxy forwards (key, tenant, body, address gate) and the feed's 200 headers are proven by
        // test/unit/sched-1g-proxy.test.ts. Staging rows G9 and G13 (and the CloudFront `x-cache` half of G1) are not
        // rows here: the build report lists them for the operator.
        const S1G = SCHED1G.studio;
        const S1G_RO = SCHED1G.oneKey;
        const at = (host, p, opts = {}) => request({ port: server.port, host, path: p, ...opts });
        const postJson = (host, p, body) => at(host, p, { method: "POST", headers: { "content-type": "application/json" }, body });
        /** A booking answer: never a storable lifetime — `private` and `no-store`, no `s-maxage`, no ISR status. */
        const assertNeverStored = (res, what) => {
            const cc = res.header("cache-control") ?? "";
            assert.match(cc, /\bprivate\b/, `${what}: cache-control ${cc}`);
            assert.match(cc, /\bno-store\b/, `${what}: cache-control ${cc}`);
            assert.doesNotMatch(cc, /s-maxage|max-age=[1-9]/, `${what}: cache-control ${cc}`);
            assert.equal(res.header("x-nextjs-cache"), undefined, `${what}: an ISR status`);
            assert.equal(res.header("set-cookie"), undefined, `${what}: a Set-Cookie`);
        };
        const FEED_SECRET = "s".repeat(43);
        /** The ISR entries stored under the booking tree's rewrite target (key `_book/<siteId>/…`, either spelling). Not
         *  the near-miss paths of sched1g-preserve (`<host>/_bookingx` …): those are site pages and are stored by design. */
        const bookingEntries = async () => (await storedIsrEntries("")).filter((e) => /^(_book|%5Fbook)(\/|$)/i.test(e.key));

        test("(sched1g-preserve) with the booking branch present, existing-tenant pages are byte-identical to the committed baseline; near-miss paths take the code path they took before", async () => {
            // 1. Byte identity (CM1-A1 comparison, the committed baseline/ captured before this slice) for both tenants,
            //    with the ONE listed difference SCHED-1G2-ROOT-SIBLING (cm1-byte-identity.mjs `rootSiblingAllowance`):
            //    every HTML page of the candidate uses it exactly once, no baseline page uses it.
            for (const tenantKey of ["content", "commerce"]) {
                const rows = compareTenant(await cm1Base(), await cm1Set(), tenantKey);
                assert.ok(rows.length > 0, `precondition: the ${tenantKey} baseline lists URLs`);
                assert.deepEqual(rows.filter((r) => !r.same).map((r) => `${r.path}: ${r.why}`), [], `${tenantKey} tenant bytes changed`);
                for (const r of rows) {
                    assert.equal(r.base.rootSibling, 0, `${tenantKey} ${r.path}: the baseline uses the allowance`);
                    assert.equal(r.cand.rootSibling, r.cand.flightChunks > 0 ? 1 : 0, `${tenantKey} ${r.path}: the allowance was not used exactly once`);
                }
            }
            // 2. Paths that are NOT booking addresses: the production branch's not-found handoff (the d1 shape), unchanged.
            for (const p of ["/_bookingx", "/_Booking", "/x/_booking", "/_bookings/manage", "/%5Fbooking"]) {
                const res = await at(CM1.content.host, p);
                assert.equal(res.status, 307, `${p}: ${res.status}`);
                assert.equal(new URL(res.header("location"), "http://x").search, "?nf=1", `${p}: not the not-found handoff`);
                assert.match(res.header("cache-control"), new RegExp(S_MAXAGE), `${p}: not the cacheable handoff`);
            }
            // 3. A preview path whose 3rd segment is not `_booking`: the preview branch (twin + preview cookie), unchanged.
            const preview = await at(PREVIEW_HOST, `/_site/${CM1.content.id}/x/_booking`);
            assert.match(preview.header("cache-control"), /no-store/);
            assert.ok([].concat(preview.header("set-cookie") ?? []).some((c) => c.startsWith("amodx_preview_base=")), "the preview branch sets its cookie");
            // 4. `/_booking` on a host with no tenant: the unknown-host 404, as every path on that host.
            const unknown = await at(UNKNOWN_HOST, "/_booking");
            assert.equal(unknown.status, 404);
            assert.match(unknown.header("cache-control"), /no-store/);
        });

        // SCHED-1G2-ROOT-SIBLING = A, requirement 2: the negative controls of the one listed difference, through BOTH
        // comparator families of the byte rows — CM1-A1 equality of `maskBody` (cm1-identity-*, sched1g-preserve) and the
        // resolved-tree comparison `checkExpected` (loc1-*, cq1-*, ct1-*, loc1e-*). Subject: the content tenant's /about,
        // committed baseline vs this run's capture. A comparison that refuses to run (throws) counts as "different".
        test("(sched1g-root-sibling-controls) the real candidate compares equal; another sibling, a removed api, another order, the list in another segment, the text outside the payload and one other byte each compare different, in both comparators", async () => {
            const base = await cm1Base();
            const cand = await cm1Set();
            const b = base.captures.find((c) => c.tenant === "content" && c.path === "/about");
            const a = cand.captures.find((c) => c.tenant === "content" && c.path === "/about");
            const count = (body, x) => body.split(x).length - 1;
            const ROOT = '\\"s\\":[\\"%5Fbook\\",\\"api\\"]';      // the escaped form inside the HTML's payload scripts
            const ROOT_BEFORE = '\\"s\\":[\\"api\\"]';
            assert.equal(count(a.body, ROOT), 1, "precondition: the candidate page holds the list once");
            assert.equal(count(b.body, ROOT), 0, "precondition: the baseline does not hold it");
            assert.equal(count(b.body, ROOT_BEFORE), 1, "precondition: the baseline holds [\"api\"] once");
            const verdict = (body) => {
                const cm1 = maskBody(b.body, base).masked === maskBody(body, cand).masked;
                let loc1;
                try { loc1 = checkExpected(base, b.body, cand, body, []).length === 0; } catch { loc1 = false; }
                return { cm1, loc1 };
            };
            assert.deepEqual(verdict(a.body), { cm1: true, loc1: true }, "the real candidate must compare equal");
            assert.equal(maskBody(a.body, cand).counts.rootSibling, 1);
            assert.equal(maskBody(b.body, base).counts.rootSibling, 0);
            const once = (body, from, to) => {
                assert.equal(count(body, from), 1, `mutation anchor occurs once: ${from}`);
                return body.replace(from, to);
            };
            const SLUG_LIST = /\\"s\\":\[\\"%5Fdyn\\"[^\]]*\]/;
            assert.equal((a.body.match(new RegExp(SLUG_LIST, "g")) ?? []).length, 1, "precondition: the nested slug descriptor's list occurs once");
            const host = CM1.content.host;
            const mutations = {
                "another added sibling": once(a.body, ROOT, '\\"s\\":[\\"%5Fbook\\",\\"x\\",\\"api\\"]'),
                "another sibling in place of %5Fbook": once(a.body, ROOT, '\\"s\\":[\\"x\\",\\"api\\"]'),
                "\"api\" removed": once(a.body, ROOT, '\\"s\\":[\\"%5Fbook\\"]'),
                "another order": once(a.body, ROOT, '\\"s\\":[\\"api\\",\\"%5Fbook\\"]'),
                "the same item at another segment (the slug descriptor), the root list as before": once(a.body, ROOT, ROOT_BEFORE).replace(SLUG_LIST, ROOT),
                "the item also added to another segment": a.body.replace(SLUG_LIST, (m) => m.replace('[\\"%5Fdyn', '[\\"%5Fbook\\",\\"%5Fdyn')),
                "another segment name in the descriptor": once(a.body, '\\"n\\":\\"siteId\\"', '\\"n\\":\\"siteIe\\"'),
                "one byte of the descriptor's key": once(a.body, `\\"k\\":\\"${host}\\"`, `\\"k\\":\\"${host.replace("content", "contenu")}\\"`),
                "one byte elsewhere in the payload": once(a.body, '\\"name\\":\\"viewport\\"', '\\"name\\":\\"viewporu\\"'),
                "the list as text outside the payload": a.body.replace("</body>", '<p>"s":["%5Fbook","api"]</p></body>'),
            };
            const failed = Object.entries(mutations).filter(([, body]) => { const v = verdict(body); return v.cm1 || v.loc1; }).map(([name, body]) => `${name}: ${JSON.stringify(verdict(body))}`);
            assert.deepEqual(failed, [], "a mutation compared equal");
            console.log(`  (sched1g-root-sibling-controls) real candidate equal in both comparators; ${Object.keys(mutations).length} mutations each different in both: ${Object.keys(mutations).join("; ")}`);
        });

        test("(sched1g-g1) domain host: the book page, the manage page, an API op and the feed are served by the booking tree, never stored", async () => {
            const book = await at(S1G.host, "/_booking");
            assert.equal(book.status, 200);
            assert.match(book.header("content-type"), /text\/html/);
            assert.match(book.body, />Book<\/h1>/, "the book page of the booking tree");
            assertNeverStored(book, "/_booking");
            const manage = await at(S1G.host, "/_booking/manage");
            assert.equal(manage.status, 200);
            assert.match(manage.body, />Your booking<\/h1>/, "the manage page of the booking tree");
            assertNeverStored(manage, "/_booking/manage");
            // Not the site twin: the booking layout writes no site chrome (control: the tenant's own home page has it).
            const home = await at(S1G.host, "/");
            assert.match(home.body, /<footer/, "control: the site layout writes a footer");
            for (const res of [book, manage]) assert.doesNotMatch(res.body, /<footer|<nav/, "site chrome on a booking page");
            const api = await at(S1G.host, "/_booking/api/offer");
            assert.equal(api.status, 503, "the offer op passed the proxy's checks and reached the forward step");
            assert.deepEqual(JSON.parse(api.body), { error: "Booking is temporarily unavailable.", code: "unavailable" });
            assertNeverStored(api, "/_booking/api/offer");
            const feed = await at(S1G.host, `/_booking/feed/r1/${FEED_SECRET}.ics`);
            assert.equal(feed.status, 503, "the feed passed its checks and reached the forward step");
            assertNeverStored(feed, "feed (no backend)");
            // A second identical request is answered by the renderer again, the same way (nothing was stored)…
            const again = await at(S1G.host, "/_booking");
            assert.equal(again.status, 200);
            assert.equal(again.header("x-nextjs-cache"), undefined);
            // …and no ISR entry exists under the booking tree; positive control: the detector reads a live cache.
            assert.ok((await storedIsrEntries("")).length > 0, "storedIsrEntries() found nothing at all — detector broken");
            assert.deepEqual((await bookingEntries()).map((e) => e.key), [], "an ISR entry under the booking tree");
        });

        test("(sched1g-g2) preview host: /_site/<id>/_booking/manage is the manage page of tenant <id>, with no preview cookie; the by-id gates are unchanged", async () => {
            const res = await at(PREVIEW_HOST, `/_site/${S1G.id}/_booking/manage`);
            assert.equal(res.status, 200);
            assert.match(res.body, />Your booking<\/h1>/);
            assert.match(res.body, new RegExp(`>${S1G.name}<`), "the header names the tenant of the path");
            assert.equal(res.header("referrer-policy"), "no-referrer");
            assertNeverStored(res, "preview manage");
            const book = await at(PREVIEW_HOST, `/_site/${S1G_RO.id}/_booking`);
            assert.equal(book.status, 200);
            assert.match(book.body, new RegExp(`>${S1G_RO.name}<`), "another id selects another tenant");
            assertNeverStored(book, "preview book");
            // Control: the preview branch for a non-booking path still sets the cookie.
            const site = await at(PREVIEW_HOST, `/_site/${S1G.id}`);
            assert.ok([].concat(site.header("set-cookie") ?? []).some((c) => c.startsWith("amodx_preview_base=")), "control: preview cookie");
            // By-id booking addresses: refused on a tenant host (the preview gate, 403); an unknown id → 404 not stored.
            const onTenantHost = await at(S1G.host, `/_site/${S1G.id}/_booking`);
            assert.equal(onTenantHost.status, 403);
            const unknownId = await at(PREVIEW_HOST, "/_site/sched1g-nobody/_booking");
            assert.equal(unknownId.status, 404);
            assert.match(unknownId.header("cache-control"), /no-store/);
        });

        test("(sched1g-g3) ?frame=1 and ?lang= reach the page: frame → no header; lang → the texts' language; absent, malformed and repeated values fall back", async () => {
            const plain = await at(S1G.host, "/_booking");
            assert.match(plain.body, /<header/, "control: the page header without frame");
            assert.match(plain.body, /<div lang="en"/);
            const both = await at(S1G.host, "/_booking?frame=1&lang=ro");
            assert.equal(both.status, 200);
            assertNeverStored(both, "frame + lang");
            assert.doesNotMatch(both.body, /<header/, "frame=1: no header");
            assert.match(both.body, /background:transparent/, "frame=1: transparent background");
            assert.match(both.body, /<div lang="ro"/);
            assert.match(both.body, />Programare<\/h1>/, "lang=ro: the Romanian title");
            // frame: malformed (0, yes) and repeated → absent (the header stays).
            for (const q of ["frame=0", "frame=yes", "frame=1&frame=1"]) {
                assert.match((await at(S1G.host, `/_booking?${q}`)).body, /<header/, `${q} must not remove the header`);
            }
            // lang: unknown, malformed, repeated → the tenant's language (en for this tenant, ro for the ro-RO tenant).
            for (const q of ["lang=xx", "lang=%3Cscript%3E", "lang=ro&lang=ro", "lang="]) {
                assert.match((await at(S1G.host, `/_booking?${q}`)).body, />Book<\/h1>/, `${q} on an en-US tenant`);
            }
            assert.match((await at(S1G_RO.host, "/_booking")).body, />Programare<\/h1>/, "ro-RO tenant without lang");
            assert.match((await at(S1G_RO.host, "/_booking/manage")).body, />Rezervarea ta<\/h1>/, "ro-RO tenant: the manage title");
            assert.match((await at(S1G_RO.host, "/_booking?lang=en")).body, />Book<\/h1>/, "lang=en on a ro-RO tenant");
            assert.match((await at(S1G_RO.host, "/_booking/manage?lang=en-GB")).body, />Your booking<\/h1>/, "a regional tag selects its language");
        });

        /** RULE (SCHED-1G3, ruling SCHED-1G3-G7-ORACLE = A): a booking page is streamed (force-dynamic), and Next places
         *  the metadata (`<title>`, robots meta) in `<head>` or behind a Suspense `<template>` by timing — measured in
         *  sched-1g2 (row g4) and sched-1g3 (row g7-server failed 2 of 10 runs on byte equality). So two answers of a
         *  booking page are compared by what they MEAN, never by bytes: status, cache-control, content-type, the visible
         *  text as a sorted multiset, the sorted script sources, the mounted booking components. Used by rows g4, g7-server. */
        const bookingPageMeaning = (res) => ({
            status: res.status,
            cacheControl: res.header("cache-control"),
            contentType: res.header("content-type"),
            // As a sorted multiset: Next streams the metadata, so the <title> item moves between requests (measured).
            text: extractVisibleText(res.body).map((item) => JSON.stringify(item)).sort(),
            scripts: [...res.body.matchAll(/<script[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]).sort(),
            components: [...res.body.matchAll(/\\"(BookFlow|ManageView)\\"\]/g)].map((m) => m[1]).sort(),
        });

        // Oracle: what the answer MEANS, not its bytes. Measured (build report, step 10): two requests WITHOUT any cookie
        // already differ in bytes — React streams the font hint row, the script tags and the <title> in a timing-dependent order — so
        // byte equality would test the stream, not the cookie. Compared: status, cache-control, content-type, the visible
        // text (locale-1 § 8.5 extraction), the set of script sources, the client components the payload mounts.
        // S1G2-R3: the server half of the ?service selector — what the book page's query reader passes to the browser flow
        // (prop `initialServiceId` in the payload). The browser half (unknown ids → the offer) is
        // test/unit/sched-1g-pages.test.ts "S1G2-R3". SCHED-GROUPS-REMOVE-1: the page no longer reads `?course` (the group
        // shape was removed); a link that still carries it is served as the book page and passes no course value.
        test("(sched1g-selectors) ?service: absent → no value; valid → passed as is; repeated → absent; empty and malformed → passed and matched by the flow; ?course is not read", async () => {
            const props = async (q) => {
                const body = (await at(S1G.host, `/_booking${q}`)).body;
                const prop = (name) => {
                    const m = new RegExp(`\\\\"${name}\\\\":\\\\"((?:[^\\\\]|\\\\.)*?)\\\\"`).exec(body);
                    return m === null ? null : m[1];
                };
                return { service: prop("initialServiceId"), course: prop("initialCourseId") };
            };
            assert.deepEqual(await props(""), { service: "$undefined", course: null }, "absent");
            assert.deepEqual(await props("?service=svc1"), { service: "svc1", course: null }, "valid service");
            assert.deepEqual(await props("?service=a&service=b"), { service: "$undefined", course: null }, "repeated → absent");
            assert.deepEqual(await props("?service="), { service: "", course: null }, "empty is passed; the flow matches it against the offer");
            assert.deepEqual(await props("?service=x%23y"), { service: "x#y", course: null }, "malformed is passed; the flow matches it against the offer");
            assert.deepEqual(await props("?course=c1"), { service: "$undefined", course: null }, "an old ?course link: the book page, no course value");
        });

        test("(sched1g-g4) the session cookie does not change the answer: same status, cache headers, visible text, scripts and components; no twin", async () => {
            const meaning = bookingPageMeaning;
            const jars = ["next-auth.session-token=abc", "next-auth.session-token.0=x; next-auth.session-token.1=y", "__Secure-next-auth.session-token=abc"];
            for (const p of ["/_booking", "/_booking/manage", "/_booking?frame=1"]) {
                const without = meaning(await at(S1G.host, p));
                assert.equal(without.status, 200, p);
                assert.ok(without.components.length > 0, `${p}: precondition — the payload mounts the booking component`);
                for (const cookie of jars) {
                    const res = await at(S1G.host, p, { headers: { cookie } });
                    assert.deepEqual(meaning(res), without, `${p} with "${cookie}"`);
                    assertNeverStored(res, `${p} with cookie`);
                }
            }
            // Control: the oracle tells two different pages apart.
            assert.notDeepEqual(meaning(await at(S1G.host, "/_booking")), meaning(await at(S1G.host, "/_booking/manage")));
        });

        test("(sched1g-g5) a wire request to the internal segment answers 404 in every spelling; a doubled slash is normalised by Next first", async () => {
            const target = `${S1G_RO.id}/manage`;
            const cases = [
                [S1G.host, `/_book/${target}`], [S1G.host, `/_book/${S1G_RO.host}/manage`], [S1G.host, `/%5Fbook/${target}`],
                [S1G.host, `/%5fbook/${target}`], [S1G.host, `/_BOOK/${target}`], [S1G.host, `/_Book/${S1G_RO.id}`],
                [S1G.host, `/%255Fbook/${target}`], [S1G.host, "/_book"], [S1G.host, `/_book/${S1G_RO.id}/api/offer`],
                [PREVIEW_HOST, `/_book/${target}`], [UNKNOWN_HOST, `/_book/${target}`],
            ];
            for (const [host, p] of cases) {
                const res = await at(host, p);
                assert.equal(res.status, 404, `${host} ${p}: ${res.status}`);
                assert.equal(res.body, "Not found", `${host} ${p}: not the middleware's refusal`);
                assert.match(res.header("cache-control"), /private, no-store/);
            }
            const post = await postJson(S1G.host, `/_book/${S1G_RO.id}/api/view`, JSON.stringify({ token: "t".repeat(43) }));
            assert.equal(post.status, 404, "a POST to the internal segment");
            // Doubled slash: Next answers 308 to the single-slash form BEFORE the middleware runs (as for every path);
            // that form is refused.
            const doubled = await at(S1G.host, `//_book/${target}`);
            assert.equal(doubled.status, 308);
            const location = new URL(doubled.header("location"), "http://x").pathname;
            assert.equal(location, `/_book/${target}`);
            assert.equal((await at(S1G.host, location)).status, 404);
            // Negative control: the public address of the same page is served.
            assert.equal((await at(S1G_RO.host, "/_booking/manage")).status, 200);
        });

        test("(sched1g-not-found) a path under /_booking that no page serves answers 404, never stored; the site not-found rows are unchanged", async () => {
            for (const p of ["/_booking/nope", "/_booking/api", "/_booking/feed/r1", "/_booking/manage/x", "/_booking/api/offer/x"]) {
                const res = await at(S1G.host, p);
                assert.equal(res.status, 404, `${p}: ${res.status}`);
                assertNeverStored(res, p);
            }
            const unknownOp = await at(S1G.host, "/_booking/api/nope");
            assert.equal(unknownOp.status, 404);
            assert.equal(JSON.parse(unknownOp.body).code, "notFound");
            assertNeverStored(unknownOp, "unknown op");
            assert.deepEqual((await bookingEntries()).map((e) => e.key), [], "an ISR entry under the booking tree");
            // The site's own not-found (d1/d2 shapes) on the same host is unchanged.
            const site = await at(S1G.host, "/no-such-page");
            assert.equal(site.status, 307);
            assert.equal((await at(S1G.host, "/no-such-page?nf=1")).status, 404);
        });

        test("(sched1g-g6) no tenant script on the booking pages: the book page loads reCAPTCHA only, the manage page no third-party script; Referrer-Policy on manage", async () => {
            const markers = {
                analytics: SCHED1G_MARKERS.ga, pixelId: SCHED1G_MARKERS.pixel,
                paddle: SCHED1G_MARKERS.paddle, cookieBanner: "We value your privacy", referralBeacon: "/api/ref?v=",
            };
            // Positive control: the tenant's site page carries each configuration/component marker.
            // PIXEL-CONSENT-1: its pixel id remains in the FBPixelLoader client props, NOT a loader in server HTML.
            // The markers are strings only the pixel emits (script id, SDK host, the image endpoint); a bare
            // `<noscript` is NOT one: ThemeInjector's font fallback uses it on every tenant with a font.
            const home = await at(S1G.host, "/");
            for (const [name, m] of Object.entries(markers)) assert.ok(home.body.includes(m), `control: the site page lacks ${name}`);
            const pixelLoader = /fb-pixel|connect\.facebook\.net|facebook\.com\/tr/;
            assert.doesNotMatch(home.body, pixelLoader, "P2: the site page must wait for marketing consent");
            // The flight payload sits in a JS string in the HTML, so its quotes arrive escaped (`\"`):
            // `22:I[<module>,[<chunks>],\"FBPixelLoader\"]` and the element `{\"pixelId\":\"<id>\"}`.
            assert.ok(home.body.includes('\\"FBPixelLoader\\"'), "control: the site page mounts the consent-gated pixel loader");
            assert.ok(home.body.includes(`{\\"pixelId\\":\\"${SCHED1G_MARKERS.pixel}\\"}`), "control: the loader receives the tenant's pixel id");
            const book = await at(S1G.host, "/_booking");
            const manage = await at(S1G.host, "/_booking/manage");
            const externalScripts = (body) => [...body.matchAll(/<script[^>]*\ssrc="(https?:\/\/[^"]*)"/g)].map((m) => m[1]);
            for (const [page, res] of [["book", book], ["manage", manage]]) {
                for (const [name, m] of Object.entries(markers)) assert.ok(!res.body.includes(m), `${page} page carries ${name}`);
                assert.doesNotMatch(res.body, pixelLoader, `${page} page carries a pixel loader`);
            }
            assert.deepEqual(externalScripts(book.body), [`https://www.google.com/recaptcha/api.js?render=${SCHED1G_SITE_KEY}`], "book page: reCAPTCHA (tenant key) is the only external script");
            assert.deepEqual(externalScripts(manage.body), [], "manage page: an external script");
            assert.ok(externalScripts(home.body).length + (home.body.match(/googletagmanager|connect\.facebook\.net|cdn\.paddle\.com/g) ?? []).length > 0, "control: the detector finds the site page's scripts");
            assert.doesNotMatch(manage.body, /recaptcha/i, "manage page: no reCAPTCHA");
            assert.equal(manage.header("referrer-policy"), "no-referrer");
            assert.equal(book.header("referrer-policy"), undefined, "the header is the manage page's only");
        });

        test("(sched1g-g7-server) two GETs of the manage page give the same page by meaning (status, cache headers, visible text, scripts, components); GET is refused on every write op", async () => {
            // What this shows: the server answers the link page with one shell that carries no per-request booking content —
            // two GETs compare equal under `bookingPageMeaning` (SCHED-1G3-G7-ORACLE = A; byte equality is not valid for a
            // streamed page). The link token is in the URL fragment, which an HTTP client does not send, so these GETs carry
            // none. It does NOT show that no backend call happened (the suite has no booking backend at all). The browser
            // half (fragment removed, POST view first, POST confirm only on the button) is test/unit/sched-1g-pages.test.ts.
            const a = bookingPageMeaning(await at(S1G.host, "/_booking/manage"));
            const b = bookingPageMeaning(await at(S1G.host, "/_booking/manage"));
            assert.equal(a.status, 200);
            assert.deepEqual(a.components, ["ManageView"], "precondition: the payload mounts the manage view");
            assert.deepEqual(b, a, "two GETs of the manage page differ in meaning");
            // Negative control: the comparison tells another page apart (the book page of the same tenant).
            assert.notDeepEqual(bookingPageMeaning(await at(S1G.host, "/_booking")), a, "control: the book page compares equal to the manage page");
            for (const op of ["hold", "view", "confirm", "cancel", "move"]) {
                const res = await at(S1G.host, `/_booking/api/${op}`);
                assert.equal(res.status, 405, `GET ${op}`);
                assert.equal(res.header("allow"), "POST");
                assertNeverStored(res, `GET ${op}`);
            }
            for (const op of ["offer", "slots"]) {
                const res = await postJson(S1G.host, `/_booking/api/${op}`, "{}");
                assert.equal(res.status, 405, `POST ${op}`);
                assert.equal(res.header("allow"), "GET");
            }
        });

        test("(sched1g-g8) reCAPTCHA key pair: a tenant with both keys gets its site key on every page and its secret nowhere; a tenant with one key gets the deployment key", async () => {
            const book = await at(S1G.host, "/_booking");
            const home = await at(S1G.host, "/");
            assert.ok(book.body.includes(`render=${SCHED1G_SITE_KEY}`), "book page: the tenant's site key");
            assert.ok(home.body.includes(`window.AMODX_RECAPTCHA_KEY = \\"${SCHED1G_SITE_KEY}\\"`) || home.body.includes(`window.AMODX_RECAPTCHA_KEY = "${SCHED1G_SITE_KEY}"`), "site page: the tenant's site key (mapTenant, § 9.1)");
            for (const res of [book, home]) assert.ok(!res.body.includes(SCHED1G_SECRET), "the secret reached a page");
            // One key only: not a pair → the deployment key (empty in this suite: no reCAPTCHA key at all).
            const oneBook = await at(S1G_RO.host, "/_booking");
            const oneHome = await at(S1G_RO.host, "/");
            for (const res of [oneBook, oneHome]) assert.ok(!res.body.includes(SCHED1G_ONLY_SITE_KEY), "a lone site key reached a page");
            assert.doesNotMatch(oneBook.body, /recaptcha\/api\.js/, "no deployment key in the suite: no reCAPTCHA script");
        });

        test("(sched1g-proxy-inputs) every proxy input, absent / valid / malformed: a valid one reaches the forward step (503 here), the others are refused before it", async () => {
            const T = "A".repeat(43);
            const intent = "3b241101-e2bb-4255-8caf-4136c566a962";
            const who = { email: "ana@example.test", name: "Ana" };
            const post = (op, body) => postJson(S1G.host, `/_booking/api/${op}`, body);
            const cases = [
                // [label, request, status, code]
                ["hold absent body", () => post("hold", ""), 400, "invalid"],
                ["hold not JSON", () => post("hold", "{"), 400, "invalid"],
                ["hold valid slot", () => post("hold", JSON.stringify({ intentId: intent, what: { kind: "slot", serviceId: "svc", start: "2026-12-01T09:00:00.000Z" }, who })), 503, "unavailable"],
                ["hold valid slot + token", () => post("hold", JSON.stringify({ intentId: intent, recaptchaToken: "r", resend: true, what: { kind: "slot", serviceId: "svc", start: "2026-12-01T09:00:00.000Z" }, who: { ...who, phone: "+40 700", language: "ro" } })), 503, "unavailable"],
                ["hold bad email", () => post("hold", JSON.stringify({ intentId: intent, what: { kind: "slot", serviceId: "svc", start: "2026-12-01T09:00:00.000Z" }, who: { email: "nope", name: "A" } })), 400, "invalid"],
                ["hold extra field", () => post("hold", JSON.stringify({ intentId: intent, what: { kind: "slot", serviceId: "svc", start: "2026-12-01T09:00:00.000Z" }, who, tenantId: "other" })), 400, "invalid"],
                ["hold too large", () => post("hold", JSON.stringify({ pad: "x".repeat(9000) })), 413, "tooLarge"],
                ["view absent token", () => post("view", "{}"), 404, "linkNotValid"],
                ["view malformed token", () => post("view", JSON.stringify({ token: "short" })), 404, "linkNotValid"],
                ["view valid token", () => post("view", JSON.stringify({ token: T })), 503, "unavailable"],
                ["view extra field", () => post("view", JSON.stringify({ token: T, tenantId: "other" })), 400, "invalid"],
                ["confirm valid", () => post("confirm", JSON.stringify({ token: T })), 503, "unavailable"],
                ["cancel malformed", () => post("cancel", JSON.stringify({ token: 5 })), 404, "linkNotValid"],
                ["move valid slot", () => post("move", JSON.stringify({ token: T, to: { kind: "slot", start: "2026-12-01T09:00:00Z" } })), 503, "unavailable"],
                ["move absent to", () => post("move", JSON.stringify({ token: T })), 400, "invalid"],
                ["move malformed to", () => post("move", JSON.stringify({ token: T, to: { kind: "slot", start: "tomorrow" } })), 400, "invalid"],
                ["slots absent query", () => at(S1G.host, "/_booking/api/slots"), 400, "invalid"],
                ["slots valid", () => at(S1G.host, "/_booking/api/slots?serviceId=svc&from=2026-12-01&to=2026-12-07"), 503, "unavailable"],
                ["slots malformed date", () => at(S1G.host, "/_booking/api/slots?serviceId=svc&from=12/01/2026&to=2026-12-07"), 400, "invalid"],
                ["offer unknown parameter", () => at(S1G.host, "/_booking/api/offer?tenant=other"), 400, "invalid"],
                ["feed malformed secret", () => at(S1G.host, "/_booking/feed/r1/short.ics"), 404, "linkNotValid"],
                ["feed malformed resource", () => at(S1G.host, `/_booking/feed/a%23b/${FEED_SECRET}.ics`), 404, "linkNotValid"],
                ["feed no .ics", () => at(S1G.host, `/_booking/feed/r1/${FEED_SECRET}`), 404, "linkNotValid"],
                ["preview unknown tenant op", () => at(PREVIEW_HOST, "/_site/sched1g-nobody/_booking/api/offer"), 403, "notAvailable"],
                ["preview unknown tenant feed", () => at(PREVIEW_HOST, `/_site/sched1g-nobody/_booking/feed/r1/${FEED_SECRET}.ics`), 404, "linkNotValid"],
            ];
            for (const [label, send, status, code] of cases) {
                const res = await send();
                assert.equal(res.status, status, `${label}: ${res.status} ${res.body}`);
                assert.equal(JSON.parse(res.body).code, code, label);
                assertNeverStored(res, label);
            }
        });

        // ── ROWS (sched1g3-*) — SCHED-1G3 (docs/slices/sched-1.md § 25 `sched-1g3`): the booking pages and the feed exist
        // only when the tenant's `schedulingEnabled` is exactly `true` (`lib/booking-tenant.ts`); the pages are not indexed.
        // Fixtures SCHED1G: `studio` and `oneKey` on, `off` (`false`) and `unset` (no attribute) off.
        const S1G_OFF = [SCHED1G.off, SCHED1G.unset];
        /** The three gated surfaces under one public base (`/_booking` on a domain host, `/_site/<id>/_booking` on preview). */
        const surfaces = (base) => ({ book: base, manage: `${base}/manage`, feed: `${base}/feed/r1/${FEED_SECRET}.ics` });

        test("(sched1g3-switch) scheduling off or no tenant record → the book page, the manage page and the feed answer 404, never stored, on a domain host and on the preview form; on → served; the API ops stay with the backend", async () => {
            /** The booking tree's not-found for a page: a 404 HTML document of the force-dynamic tree, no booking component. */
            const assertPageNotFound = (res, what) => {
                assert.equal(res.status, 404, `${what}: ${res.status}`);
                assert.match(res.header("content-type") ?? "", /text\/html/, `${what}: not the tree's HTML not-found`);
                assert.doesNotMatch(res.body, /\\"(BookFlow|ManageView)\\"\]/, `${what}: a booking component is mounted`);
                assertNeverStored(res, what);
            };
            const assertFeedNotFound = (res, what) => {
                assert.equal(res.status, 404, `${what}: ${res.status}`);
                assert.deepEqual(JSON.parse(res.body), { error: "This link is not valid.", code: "linkNotValid" }, what);
                assertNeverStored(res, what);
            };
            const forms = (t) => [[t.host, surfaces("/_booking")], [PREVIEW_HOST, surfaces(`/_site/${t.id}/_booking`)]];
            // Off: switch `false` and switch absent.
            for (const t of S1G_OFF) {
                // Control: the host is a wired site host, so the 404 below comes from the switch, not the unknown-host gate.
                assert.equal((await at(t.host, "/")).status, 200, `control: ${t.id} home`);
                for (const [host, s] of forms(t)) {
                    assertPageNotFound(await at(host, s.book), `${t.id} ${host} book`);
                    assertPageNotFound(await at(host, s.manage), `${t.id} ${host} manage`);
                    assertPageNotFound(await at(host, `${s.book}?frame=1&lang=ro`), `${t.id} ${host} book with a query`);
                    assertFeedNotFound(await at(host, s.feed), `${t.id} ${host} feed`);
                }
                // The API op is not gated by the renderer: it passes the proxy's checks and reaches the forward step (503 in
                // the suite, which has no backend); deployed, the backend answers its own 403 `notAvailable`.
                const op = await at(t.host, "/_booking/api/offer");
                assert.equal(op.status, 503, `${t.id} api/offer: ${op.status}`);
                assert.equal(JSON.parse(op.body).code, "unavailable");
            }
            // No tenant record: the preview form reaches the tree (404 from the tree); a domain host without a tenant is the
            // middleware's unknown-host 404 for every path.
            for (const [label, res] of [
                ["preview book", await at(PREVIEW_HOST, "/_site/sched1g-nobody/_booking")],
                ["preview manage", await at(PREVIEW_HOST, "/_site/sched1g-nobody/_booking/manage")],
            ]) assertPageNotFound(res, `no record ${label}`);
            assertFeedNotFound(await at(PREVIEW_HOST, `/_site/sched1g-nobody/_booking/feed/r1/${FEED_SECRET}.ics`), "no record preview feed");
            for (const p of Object.values(surfaces("/_booking"))) {
                const res = await at(UNKNOWN_HOST, p);
                assert.equal(res.status, 404, `unknown host ${p}`);
                assert.match(res.header("cache-control"), /private, no-store/, `unknown host ${p}`);
            }
            // On (positive control, both forms): book and manage 200 with their component; the feed reaches the forward step.
            for (const [host, s] of forms(S1G)) {
                const book = await at(host, s.book);
                assert.equal(book.status, 200, `${host} book`);
                assert.match(book.body, /\\"BookFlow\\"\]/, `${host} book: the flow is mounted`);
                const manage = await at(host, s.manage);
                assert.equal(manage.status, 200, `${host} manage`);
                assert.match(manage.body, /\\"ManageView\\"\]/, `${host} manage: the view is mounted`);
                const feed = await at(host, s.feed);
                assert.equal(feed.status, 503, `${host} feed: passed the switch and reached the forward step`);
            }
            assert.deepEqual((await bookingEntries()).map((e) => e.key), [], "an ISR entry under the booking tree");
        });

        test("(sched1g3-noindex) the book and manage pages send X-Robots-Tag and carry robots meta noindex, nofollow, on the domain and the preview form; no other response gets the header; no booking address is in sitemap.xml", async () => {
            const ROBOTS = /<meta name="robots" content="noindex, nofollow"\/>/;
            const pages = [
                [S1G.host, "/_booking"], [S1G.host, "/_booking/manage"], [S1G_RO.host, "/_booking?frame=1"], [S1G_RO.host, "/_booking/manage?lang=en"],
                [PREVIEW_HOST, `/_site/${S1G.id}/_booking`], [PREVIEW_HOST, `/_site/${S1G.id}/_booking/manage`],
            ];
            for (const [host, p] of pages) {
                const res = await at(host, p);
                assert.equal(res.status, 200, `${host}${p}`);
                assert.equal(res.header("x-robots-tag"), "noindex, nofollow", `${host}${p}: X-Robots-Tag`);
                assert.equal((res.body.match(new RegExp(ROBOTS, "g")) ?? []).length, 1, `${host}${p}: robots meta once`);
            }
            // The header is the two pages' only: not on an API op, not on the feed (booking responses that are not documents).
            for (const p of ["/_booking/api/offer", `/_booking/feed/r1/${FEED_SECRET}.ics`]) {
                assert.equal((await at(S1G.host, p)).header("x-robots-tag"), undefined, `${p}: X-Robots-Tag`);
            }
            // Preservation control: non-booking pages of existing tenants (domain and preview form, a near-miss path, a
            // sitemap) carry neither the header nor a noindex meta.
            for (const [host, p] of [
                [CM1.content.host, "/"], [CM1.content.host, "/about"], [S1G.host, "/"], [PREVIEW_HOST, `/_site/${CM1.content.id}`],
                [CM1.content.host, "/_bookingx"], [S1G.host, "/sitemap.xml"],
            ]) {
                const res = await at(host, p);
                assert.equal(res.header("x-robots-tag"), undefined, `${host}${p}: X-Robots-Tag on a non-booking response`);
                assert.doesNotMatch(res.body, /noindex/, `${host}${p}: a noindex meta`);
            }
            // sitemap.xml lists the tenant's pages (positive control) and no booking address, in either spelling.
            for (const t of [S1G, S1G_RO]) {
                const map = await at(t.host, "/sitemap.xml");
                assert.equal(map.status, 200, `${t.id} sitemap`);
                assert.ok(map.body.includes(`<loc>https://${t.host}/</loc>`), `control: ${t.id} sitemap lists the home page`);
                assert.doesNotMatch(map.body, /_booking|_book\b|%5Fbook/i, `${t.id} sitemap lists a booking address`);
            }
        });

        // ── ROW (schedlabels1-override) — SCHED-LABELS-1: a site's own booking texts (`bookingStrings`, edited on the admin
        // Labels page) are shown on its booking pages in its own language and NOT under `?lang=` of another language; an
        // override with HTML is shown as text (the page's rendering escapes it); a tenant without overrides is unchanged
        // (the `sched1g` tenants: their rows run as before; the ro-RO one is the control here). Never stored.
        test("(schedlabels1-override) the site's booking texts: shown on its own-language page (book and manage), escaped; not under ?lang=en; a tenant without them shows the standard texts; never stored", async () => {
            const T = SCHEDLABELS1;
            const escaped = "Programează-te &lt;b&gt;acum&lt;/b&gt;";
            const book = await at(T.host, "/_booking");
            assert.equal(book.status, 200);
            assertNeverStored(book, "override book");
            assert.match(book.body, /<div lang="ro"/);
            assert.ok(book.body.includes(`>${escaped}</h1>`), "the site's title, as text, in the page heading");
            assert.ok(book.body.includes(`<title>${escaped} | ${T.name}</title>`), "the site's title, as text, in <title>");
            assert.ok(!book.body.includes("<b>acum</b>"), "the HTML of the override is never markup");
            assert.doesNotMatch(book.body, />Programare<\/h1>/, "the standard title is replaced");
            const manage = await at(T.host, "/_booking/manage");
            assert.equal(manage.status, 200);
            assertNeverStored(manage, "override manage");
            assert.ok(manage.body.includes(`>${SCHEDLABELS1_TEXTS.manageTitle}</h1>`), "the site's manage title");
            // ?lang= of the tenant's own language: the same texts.
            assert.ok((await at(T.host, "/_booking?lang=ro")).body.includes(`>${escaped}</h1>`), "?lang=ro on a ro-RO tenant");
            // ?lang= of another language: that language's standard texts, and no text of the site anywhere in the page.
            for (const [p, title] of [["/_booking?lang=en", "Book"], ["/_booking/manage?lang=en", "Your booking"]]) {
                const other = await at(T.host, p);
                assert.equal(other.status, 200, p);
                assertNeverStored(other, p);
                assert.match(other.body, new RegExp(`>${title}</h1>`), `${p}: the English standard title`);
                assert.ok(!other.body.includes("Programează-te") && !other.body.includes(SCHEDLABELS1_TEXTS.manageTitle), `${p}: a site text on the English page`);
            }
            // A tenant without bookingStrings (sched1g ro-RO): the standard Romanian texts.
            const control = await at(S1G_RO.host, "/_booking");
            assert.match(control.body, />Programare<\/h1>/, "control: a tenant without overrides");
            assert.ok(!control.body.includes("Programează-te"), "control: another tenant's text");
        });

        // ── ROW (cmrc-counties-diff) — RETIRED by locale-1d (docs/slices/locale-1d.md): it compared the commerce and content
        // URLs with the 959f288 capture `cmrc-counties-1/before/` and ONE listed difference. locale-1d changes the bytes of
        // every commerce HTML page (the navbar's account texts, the views' strings), so that oracle cannot hold; its
        // successor is row loc1-diff-1d, which compares the same URLs (and more) with the 92adbba capture — a capture that
        // already contains the cmrc-counties-1 change. The comparisons differ: the retired row used CM1-A1 EXACTLY;
        // loc1-diff-1d uses CM1-A1 PLUS the ruled resolved-tree payload comparison of locale-1b (LOCALE1B-ROW-CUT = A:
        // payload row labels and row cuts are not compared). The CM1-A1-exact comparison of those 32 URLs continues in rows
        // cm1-identity-* (against the baseline re-captured by locale-1d). The cmrc-counties-1 change itself stays pinned by
        // row cmrc-counties-1 and test/unit/cmrc-counties-1-*.test.ts. Its capture set stays as that slice's record.
        // Since locale-1c the locale byte row was loc1-diff-1c (the 0c0dbc8 capture, the same comparison as loc1-diff-1d);
        // since locale-reviews-date-1 it was loc1-diff-reviews-date-1 (the eba5e18 capture, the same comparison); since
        // locale-1e it was loc1-diff-1e (the d9999d2 capture, the same comparison plus category 4, the root-layout move);
        // since cat-quote-1 it was loc1-diff-quote-1 (the 29a2282 capture, which already holds the move; the same comparison
        // without category 4 — the move stays pinned against d9999d2 by loc1e-category-controls and loc1e-404-document);
        // since cat-theme-1 it was loc1-diff-theme-1 (the 0865ac6 capture, the same comparison, nothing listed); since
        // cat-variant-gallery-1 it is loc1-diff-variant-gallery-1 (the 27fa7ca capture, the same comparison; the catalog
        // product pages list the CVG1-GALLERY change, the text rows its listed removals).

        // ── ROWS (lang1b-*) — LANG-1B, the language segment (docs/slices/lang-1.md § 7, § 8.1, § 8.2, § 9.2; § 11 rows; the
        // contract rows in docs/caching-architecture.md § Serving contract). Running build only; the tenants are `LANG1B`
        // (fixtures.mjs). An address under a listed language prefix is rewritten to `/<host>~<lang><path>` and stored under
        // that key; `<html lang>` and the texts follow the page language; every other address is rewritten as before.
        const L = LANG1B.multi;
        const lAt = (host, p, opts = {}) => request({ port: server.port, host, path: p, ...opts });
        /** `<html lang="…">` of a document. */
        const htmlLangOf = (body) => (/<html lang="([^"]*)"/.exec(body) ?? [])[1];
        /** The `[siteId]` value of the page's root segment descriptor in the RSC payload (`"n":"siteId","t":"d","k":"…"`). */
        const segmentOf = (body) => (/"n":"siteId","t":"d","k":"([^"]*)"/.exec(splitFlight(body).flight) ?? [])[1];
        /** The stored ISR keys under `prefix`, sorted. */
        const keysUnder = async (prefix) => (await storedIsrEntries(prefix)).map((e) => e.key).sort();
        const RO_SITE = resolveLocaleStrings({ locale: "ro-RO" }).strings.site;
        const EN_SITE = resolveLocaleStrings({ locale: "en-US" }).strings.site;
        /** The copyright sentence after the name ("All rights reserved." / "Toate drepturile rezervate."). */
        const copyrightTail = (site) => site.footerCopyright.split("{name}")[1];

        test("(lang1b-segment) a listed language prefix → segment <host>~ro, stored under that key, MISS then HIT; default and unlisted prefixes keep <host>; the decoded first segment decides", async () => {
            const seen = {};
            for (const p of ["/ro/despre", "/ro", "/about", "/xx/page", "/"]) {
                const first = await lAt(L.host, p);
                const second = await lAt(L.host, p);
                assert.equal(first.status, 200, `${p}: 200`);
                assert.match(first.header("cache-control"), new RegExp(S_MAXAGE), `${p}: cacheable`);
                assert.equal(first.header("x-nextjs-cache"), "MISS", `${p}: first MISS`);
                assert.equal(second.header("x-nextjs-cache"), "HIT", `${p}: then HIT`);
                assert.ok(first.body.includes(LANG1B_PAGES[p]), `${p}: its own page`);
                seen[p] = segmentOf(first.body);
            }
            assert.deepEqual(seen, {
                "/ro/despre": `${L.host}~ro`, "/ro": `${L.host}~ro`, "/about": L.host, "/xx/page": L.host, "/": L.host,
            }, "the segment value in the payload");
            const keys = await keysUnder(L.host);
            for (const k of [`${L.host}~ro/ro/despre`, `${L.host}~ro/ro`, `${L.host}/about`, `${L.host}/xx/page`]) {
                assert.ok(keys.includes(k), `stored under ${k}; stored: ${keys.join(", ")}`);
            }
            assert.ok(!keys.includes(`${L.host}/ro/despre`) && !keys.includes(`${L.host}/ro`), "a language page under the unsuffixed key");
            // A percent-encoded first segment: the page receives it decoded (`ro`), the middleware decides on that form, so
            // the layout (segment) and the page (its own address) name the same language.
            const encoded = await lAt(L.host, "/r%6F/despre");
            assert.equal(encoded.status, 200, "encoded: 200");
            assert.equal(segmentOf(encoded.body), `${L.host}~ro`, "encoded: the segment");
            assert.equal(htmlLangOf(encoded.body), "ro", "encoded: <html lang>");
            assert.ok(encoded.body.includes(RO_SITE.shareLabel) && !encoded.body.includes(LANG1B_OVERRIDES.shareLabel), "encoded: the page's texts are Romanian too");
            // Revision 1 (R-LANG1B-01): an encoded SLASH. Next hands the page body the segment `ro%2Fdespre` (the slash kept
            // encoded; OBSERVED), so the body renders the page stored at `/ro%2Fdespre`, in the default language — and the
            // segment, `<html lang>` and the layout texts must say the same (no `~ro`). Lower-case escape and an encoded
            // letter too. A double-encoded slash (`/ro%252Fdespre`; the body finds no page, OBSERVED) gets no `~ro` key.
            for (const p of ["/ro%2Fdespre", "/ro%2fdespre", "/r%6F%2Fdespre"]) {
                const slash = await lAt(L.host, p);
                assert.equal(slash.status, 200, `${p}: 200`);
                assert.ok(slash.body.includes(`>${LANG1B_PAGES["/ro%2Fdespre"]}</h1>`), `${p}: the page body renders the literal page`);
                assert.equal(segmentOf(slash.body), L.host, `${p}: the segment (no ~ro)`);
                assert.equal(htmlLangOf(slash.body), "en", `${p}: <html lang>`);
                assert.ok(slash.body.includes(LANG1B_OVERRIDES.shareLabel) && !slash.body.includes(RO_SITE.shareLabel), `${p}: the page body's texts are the default language`);
                assert.ok(slash.body.includes("LANG1B override ") && !slash.body.includes(copyrightTail(RO_SITE)), `${p}: the layout's texts are the default language`);
            }
            await lAt(L.host, "/ro%252Fdespre");
            assert.ok((await keysUnder(`${L.host}~`)).every((k) => !k.includes("%")), "an encoded-slash request stored under a ~ segment");
            // Revision 1 (R-LANG1B-02): content pages that end with a route-handler name follow the language rules; the
            // handlers themselves stay at the root (not HTML pages, no segment).
            for (const name of ["openai-feed", "sitemap.xml", "robots.txt", "llms.txt"]) {
                const page = await lAt(L.host, `/ro/${name}`);
                assert.equal(page.status, 200, `/ro/${name}: 200`);
                assert.ok(page.body.includes(LANG1B_PAGES[`/ro/${name}`]), `/ro/${name}: its own page`);
                assert.equal(segmentOf(page.body), `${L.host}~ro`, `/ro/${name}: the segment`);
                assert.equal(htmlLangOf(page.body), "ro", `/ro/${name}: <html lang>`);
                const handler = await lAt(L.host, `/${name}`);
                assert.ok(!String(handler.header("content-type")).startsWith("text/html") || handler.status !== 200, `/${name}: still the route handler`);
            }
            assert.ok((await keysUnder(`${L.host}~ro/ro/`)).includes(`${L.host}~ro/ro/openai-feed`), "a suffix page stored under ~ro");
            console.log(`  (lang1b-segment) segments ${JSON.stringify(seen)}; stored ${keys.length} keys under ${L.host}: ${keys.join(", ")}; /r%6F/despre → ${segmentOf(encoded.body)}`);
        });

        test("(lang1b-html-lang) <html lang>: ro on the Romanian pages and their twin, en on the default and unlisted pages and on a one-language tenant's /ro/x", async () => {
            const want = { "/": "en", "/about": "en", "/xx/page": "en", "/ro": "ro", "/ro/despre": "ro" };
            const got = {};
            for (const p of Object.keys(want)) got[p] = htmlLangOf((await lAt(L.host, p)).body);
            assert.deepEqual(got, want);
            const twin = await lAt(L.host, "/ro/despre?x=1");
            assert.match(twin.header("cache-control"), /no-store/, "twin: no-store");
            assert.equal(htmlLangOf(twin.body), "ro", "twin: ro");
            assert.equal(segmentOf(twin.body), `${L.host}~ro`, "twin: the same segment");
            const mono = await lAt(LANG1B.mono.host, "/ro/x");
            assert.equal(mono.status, 200);
            assert.equal(htmlLangOf(mono.body), "en", "one-language tenant: /ro/x is a default-language page");
            console.log(`  (lang1b-html-lang) ${JSON.stringify(got)}; twin ro; one-language /ro/x en`);
        });

        test("(lang1b-texts) a Romanian page shows the RO pack in the layout (footer, cookie texts) and in the page (share bar), without the tenant's default-language overrides; a default page shows the overrides", async () => {
            for (const p of ["/about", "/"]) {
                const res = await lAt(L.host, p);
                assert.ok(res.body.includes(LANG1B_OVERRIDES.shareLabel), `${p}: the page's override`);
                assert.ok(res.body.includes("LANG1B override "), `${p}: the layout's footer override`);
                assert.ok(splitFlight(res.body).flight.includes(EN_SITE.cookieHeadline), `${p}: the English cookie headline`);
                assert.ok(!res.body.includes(RO_SITE.shareLabel) && !res.body.includes(copyrightTail(RO_SITE)), `${p}: a Romanian text`);
            }
            for (const p of ["/ro/despre", "/ro"]) {
                const res = await lAt(L.host, p);
                assert.ok(res.body.includes(RO_SITE.shareLabel), `${p}: the RO share label (SitePage)`);
                assert.ok(res.body.includes(copyrightTail(RO_SITE)), `${p}: the RO footer (layout)`);
                assert.ok(splitFlight(res.body).flight.includes(RO_SITE.cookieHeadline), `${p}: the RO cookie headline (layout)`);
                assert.ok(!res.body.includes(LANG1B_OVERRIDES.shareLabel) && !res.body.includes("LANG1B override "), `${p}: an override (written in the default language)`);
                assert.ok(!res.body.includes(EN_SITE.shareLabel) && !res.body.includes(copyrightTail(EN_SITE)), `${p}: an English text`);
            }
            console.log(`  (lang1b-texts) /about and /: overrides + English; /ro and /ro/despre: "${RO_SITE.shareLabel}", "${copyrightTail(RO_SITE).trim()}", "${RO_SITE.cookieHeadline}"`);
        });

        test("(lang1b-segment-unlisted) by-id paths: a language-shaped first segment gets ~<first> without a tenant read; the layout keeps it only when listed (preview ~xx → default language); never stored", async () => {
            const cases = [
                [`/_site/${L.id}/ro/despre`, `${L.id}~ro`, "ro", RO_SITE.shareLabel],
                [`/_site/${L.id}/xx/page`, `${L.id}~xx`, "en", LANG1B_OVERRIDES.shareLabel],
                [`/_site/${L.id}/about`, L.id, "en", LANG1B_OVERRIDES.shareLabel],
                [`/tenant/${L.id}/ro/despre`, `${L.id}~ro`, "ro", RO_SITE.shareLabel],
                // Revision 1: an encoded slash (R-LANG1B-01: the body renders the literal `/ro%2Fdespre` page, default
                // language, so no guess) and a handler-name suffix (R-LANG1B-02), both by-id modes.
                [`/_site/${L.id}/ro%2Fdespre`, L.id, "en", LANG1B_OVERRIDES.shareLabel],
                [`/tenant/${L.id}/ro%2Fdespre`, L.id, "en", LANG1B_OVERRIDES.shareLabel],
                [`/_site/${L.id}/ro/openai-feed`, `${L.id}~ro`, "ro", RO_SITE.shareLabel],
                [`/tenant/${L.id}/ro/sitemap.xml`, `${L.id}~ro`, "ro", RO_SITE.shareLabel],
            ];
            for (const [p, segment, lang, share] of cases) {
                const res = await lAt(PREVIEW_HOST, p);
                assert.equal(res.status, 200, `${p}: 200`);
                assert.match(res.header("cache-control"), /no-store/, `${p}: the twin`);
                assert.equal(segmentOf(res.body), segment, `${p}: segment`);
                assert.equal(htmlLangOf(res.body), lang, `${p}: <html lang>`);
                assert.ok(res.body.includes(share), `${p}: texts of ${lang}`);
            }
            assert.deepEqual([...await keysUnder(`${L.id}~`), ...await keysUnder(`${L.id}/`)], [], "a by-id render was stored");
            console.log(`  (lang1b-segment-unlisted) ${cases.map(([p, s, l]) => `${p} → ${s} lang=${l}`).join("; ")}; nothing stored under the id`);
        });

        test("(lang1b-tilde-host) a host or by-id id carrying ~ (literal or percent-encoded) → 404 no-store before any gate read or render; /_booking on such a host is A3's answer (unwired → 404)", async () => {
            const refused = [
                [`a~b.serving-contract.test`, "/about", {}],
                [`${L.host}~ro`, "/about", {}],
                [`a%7Eb.serving-contract.test`, "/about", {}],
                [`a%257Eb.serving-contract.test`, "/about", {}],
                [L.host, "/about", { "x-forwarded-host": `${L.host}~ro` }],
                [PREVIEW_HOST, `/_site/${L.id}~ro/ro/despre`, {}],
                [PREVIEW_HOST, `/_site/${L.id}%7Ero/ro/despre`, {}],
                [PREVIEW_HOST, `/_site/${L.id}%257Ero/ro/despre`, {}],
                [PREVIEW_HOST, `/tenant/${L.id}~ro/ro/despre`, {}],
                [PREVIEW_HOST, `/tenant/${L.id}%7Ero/about`, {}],
                // Revision 1 (R-LANG1B-03): deeper than four rounds, and mixed with a malformed escape.
                [`a%252525257Eb.serving-contract.test`, "/about", {}],
                [L.host, "/about", { "x-forwarded-host": `a%2525257E%ZZb.serving-contract.test` }],
                [PREVIEW_HOST, `/tenant/${L.id}%2525257Ero/about`, {}],
                [PREVIEW_HOST, `/tenant/${L.id}%252525257Ero/about`, {}],
                [PREVIEW_HOST, `/_site/${L.id}%7Ero%ZZ/about`, {}],
            ];
            for (const [host, p, headers] of refused) {
                const { result: res, stats } = await readsDuring(() => lAt(host, p, { headers }));
                const what = `${host} ${p} ${JSON.stringify(headers)}`;
                assert.equal(res.status, 404, `${what}: 404`);
                assert.match(res.header("cache-control") ?? "", /no-store/, `${what}: no-store`);
                assert.equal(res.header("x-nextjs-cache"), undefined, `${what}: an ISR status`);
                assert.equal(stats.render, 0, `${what}: rendered`);
                assert.equal(stats.hostGate, 0, `${what}: a gate read (the refusal comes before the gate)`);
            }
            // Positive control: the same host and paths without the separator are served.
            assert.equal((await lAt(L.host, "/about")).status, 200, "control: the host");
            assert.equal((await lAt(PREVIEW_HOST, `/_site/${L.id}/ro/despre`)).status, 200, "control: the id");
            // A3 answers /_booking before the refusal (§ 7.1, local choice): a gate read that finds no tenant → 404.
            const { result: booking, stats: bookingStats } = await readsDuring(() => lAt(`a~b.serving-contract.test`, "/_booking"));
            assert.equal(booking.status, 404, "/_booking on a ~ host: 404");
            assert.match(booking.header("cache-control") ?? "", /no-store/);
            assert.equal(bookingStats.render, 0, "/_booking on a ~ host: rendered");
            assert.equal(bookingStats.hostGate, 1, "/_booking on a ~ host: A3's gate read");
            assert.deepEqual(await keysUnder("a~b"), [], "stored under a ~ host");
            console.log(`  (lang1b-tilde-host) ${refused.length} requests refused 404 no-store with no gate read and no render; /_booking on a ~ host → A3 gate → 404`);
        });

        test("(lang1b-dyn-leak) a leaked language twin /<id>~ro/_dyn/ro/x → 308 to /_site/<id>/ro/x (the id before the first ~)", async () => {
            const res = await lAt(PREVIEW_HOST, `/${L.id}~ro/_dyn/ro/despre`);
            assert.equal(res.status, 308);
            assert.equal(new URL(res.header("location"), "http://x").pathname, `/_site/${L.id}/ro/despre`);
            const follow = await lAt(PREVIEW_HOST, `/_site/${L.id}/ro/despre`);
            assert.equal(follow.status, 200, "the redirect target is served");
            assert.equal(htmlLangOf(follow.body), "ro", "the redirect target keeps the language");
            const plain = await lAt(PREVIEW_HOST, `/${L.id}/_dyn/about`);
            assert.equal(new URL(plain.header("location"), "http://x").pathname, `/_site/${L.id}/about`, "a segment without ~: unchanged (m1)");
        });

        test("(lang1b-gate-unknown) the gate read fails → a language-shaped path goes to the twin (no-store, <html lang=\"ro\">, nothing stored); /about keeps today's fail-open ISR answer; after recovery the language page is stored as usual", async () => {
            const G = LANG1B.gate;
            assert.deepEqual(await keysUnder(G.host), [], "precondition: nothing stored for the gate tenant");
            stub.failHostGate(true);
            let failed, about, gateReads, suffix;
            try {
                const r = await readsDuring(() => lAt(G.host, "/ro/despre"));
                failed = r.result;
                gateReads = r.stats.hostGate;
                about = await lAt(G.host, "/about");
                // Revision 1 (R-LANG1B-02): a handler-name suffix with a language prefix fails closed too.
                suffix = await lAt(G.host, "/ro/openai-feed");
            } finally {
                stub.failHostGate(false);
            }
            assert.ok(gateReads >= 1, "the gate read was attempted");
            assert.equal(failed.status, 200, "unknown: 200");
            assert.match(failed.header("cache-control"), /no-store/, "unknown: the twin");
            assert.equal(failed.header("x-nextjs-cache"), undefined, "unknown: not an ISR answer");
            assert.equal(htmlLangOf(failed.body), "ro", "unknown: the layout's own read lists ro");
            assert.equal(segmentOf(failed.body), `${G.host}~ro`, "unknown: the segment");
            assert.equal(about.status, 200, "unknown /about: 200");
            assert.match(about.header("cache-control"), new RegExp(S_MAXAGE), "unknown /about: today's fail-open ISR answer");
            assert.equal(suffix.status, 200, "unknown /ro/openai-feed: 200");
            assert.match(suffix.header("cache-control"), /no-store/, "unknown /ro/openai-feed: the twin");
            assert.equal(htmlLangOf(suffix.body), "ro", "unknown /ro/openai-feed: <html lang>");
            assert.equal(segmentOf(suffix.body), `${G.host}~ro`, "unknown /ro/openai-feed: the segment");
            assert.deepEqual(await keysUnder(G.host), [`${G.host}/about`], "only /about stored during the failure");
            const first = await lAt(G.host, "/ro/despre");
            const second = await lAt(G.host, "/ro/despre");
            assert.match(first.header("cache-control"), new RegExp(S_MAXAGE), "recovered: cacheable");
            assert.equal(first.header("x-nextjs-cache"), "MISS");
            assert.equal(second.header("x-nextjs-cache"), "HIT");
            assert.ok((await keysUnder(G.host)).includes(`${G.host}~ro/ro/despre`), "recovered: stored under ~ro");
            console.log(`  (lang1b-gate-unknown) failed gate (${gateReads} read): /ro/despre twin lang=ro, /about ${about.header("cache-control")}; recovered: MISS → HIT under ${G.host}~ro/ro/despre`);
        });

        test("(lang1b-purge) POST /api/revalidate { domain, slug: /ro/purge } revalidates the ~ro entry: the next request is a MISS; a domain with ~ is refused (400)", async () => {
            await lAt(L.host, "/ro/purge");
            const hit = await lAt(L.host, "/ro/purge");
            assert.equal(hit.header("x-nextjs-cache"), "HIT", "precondition: stored");
            const post = (body) => request({
                port: server.port, host: FIXTURE_HOST, path: "/api/revalidate", method: "POST",
                headers: { "content-type": "application/json", "x-revalidation-token": REVALIDATION_TEST_SECRET },
                body: JSON.stringify(body),
            });
            const rv = await post({ domain: L.host, slug: "/ro/purge" });
            assert.equal(rv.status, 200, `revalidate: ${rv.body}`);
            assert.equal(JSON.parse(rv.body).revalidated, true);
            const after = await lAt(L.host, "/ro/purge");
            assert.equal(after.header("x-nextjs-cache"), "MISS", "the ~ro entry was not revalidated");
            assert.equal(htmlLangOf(after.body), "ro");
            const tilde = await post({ domain: `${L.host}~ro`, slug: "/ro/purge" });
            assert.equal(tilde.status, 400, "a domain with ~");
            console.log(`  (lang1b-purge) HIT → revalidate 200 → MISS; domain with ~ → ${tilde.status}`);
        });

        test("(lang1b-one-language-identity) a tenant without languages: no ~ segment and no ~ key — /ro/x under <host>/ro/x; every stored ~ key belongs to a tenant that lists the language", async () => {
            const M = LANG1B.mono;
            for (const p of ["/ro/x", "/about"]) {
                const res = await lAt(M.host, p);
                assert.equal(res.status, 200, p);
                assert.equal(segmentOf(res.body), M.host, `${p}: segment`);
            }
            const keys = await keysUnder(M.host);
            assert.ok(keys.includes(`${M.host}/ro/x`), `stored: ${keys.join(", ")}`);
            assert.ok(keys.every((k) => !k.includes("~")), "a ~ key for a one-language tenant");
            const tildeKeys = (await keysUnder("")).filter((k) => k.includes("~"));
            assert.ok(tildeKeys.length > 0, "control: the ~ keys of the rows above are visible to this detector");
            assert.ok(tildeKeys.every((k) => k.startsWith(`${L.host}~ro/`) || k.startsWith(`${LANG1B.gate.host}~ro/`)), `a ~ key of another tenant: ${tildeKeys.join(", ")}`);
            console.log(`  (lang1b-one-language-identity) ${M.host}: ${keys.join(", ")}; ~ keys of the run: ${tildeKeys.join(", ")}`);
        });

        test("(lang1b-langs-malformed) languages stored as a string (\"ro\") is dropped by the read rule: the pages equal the one-language twin's, HTML and payload; /ro/x stored without ~", async () => {
            const A = LANG1B.malformed, B = LANG1B.mono;
            const asTwin = (t) => t.split(A.host).join(B.host).split(A.id).join(B.id);
            for (const p of ["/", "/about", "/ro/x"]) {
                const [a, b] = [await lAt(A.host, p), await lAt(B.host, p)];
                assert.equal(a.status, 200, p);
                const [fa, fb] = [splitFlight(asTwin(a.body)), splitFlight(b.body)];
                assert.equal(fa.html, fb.html, `${p}: HTML equal to the twin`);
                // The payload as its resolved tree (the ruled comparison, LOCALE1B-ROW-CUT = A): row labels and row cuts
                // depend on the streaming order of each render, so raw rows of two renders can differ with equal content
                // (OBSERVED in this row's first form: `$L1f` vs `$L23` for the same element).
                assert.deepEqual(await cc1Resolved(asTwin(a.body)), await cc1Resolved(b.body), `${p}: payload equal to the twin`);
                assert.equal(htmlLangOf(a.body), "en", `${p}: en`);
            }
            const keys = await keysUnder(A.host);
            assert.ok(keys.includes(`${A.host}/ro/x`) && keys.every((k) => !k.includes("~")), `stored: ${keys.join(", ")}`);
            console.log(`  (lang1b-langs-malformed) /, /about, /ro/x byte-equal to the one-language twin; stored ${keys.join(", ")}`);
        });

        // ── ROWS (lang1c-*) — LANG-1C (docs/slices/lang-1.md § 6.2, § 8.3–§ 8.6, § 11): `hreflang` + `x-default` in the head,
        // sitemap alternates, the menu and footer per language, the language switch. Tenants: `LANG1C` (fixtures.mjs). A
        // member of a set = a `TRANSLATION#<key>#<node>` item + a Published LATEST that holds `<key>` now (§ 6.2); members
        // whose `hreflang` value two of them hold are left out; fewer than two listed → no alternates (today's head).
        const C = LANG1C.multi;
        /** The `<link rel="alternate" hreflang=…>` elements of a document: `[hreflang, href]` in document order. */
        const hreflangLinksOf = (body) => [...body.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
            .filter((tag) => /\brel="alternate"/i.test(tag) && /\bhreflang="/i.test(tag))
            .map((tag) => [/\bhreflang="([^"]*)"/i.exec(tag)[1], /\bhref="([^"]*)"/i.exec(tag)[1]]);
        /** An alternate as the head writes it: Next writes the URL of `/` as its origin (as today's canonical of `/`). */
        const headUrl = (host, p) => (p === "/" ? `https://${host}` : `https://${host}${p}`);
        const headPairs = (host, pairs) => pairs.map(([l, p]) => [l, headUrl(host, p)]);
        /** The `<url>` element whose `<loc>` is `loc`, or undefined; and its `<xhtml:link>` lines as `[hreflang, href]`. */
        const sitemapUrl = (xml, loc) => xml.split("<url>").slice(1).map((u) => u.split("</url>")[0]).find((u) => u.includes(`<loc>${loc}</loc>`));
        const sitemapLinksOf = (urlXml) => [...urlXml.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)"\/>/g)].map((m) => [m[1], m[2]]);
        const sitemapPairs = (host, pairs) => pairs.map(([l, p]) => [l, `https://${host}${p}`]);
        /** The language-switch lists of a document (desktop and mobile copies): each a list of its `<a>` elements. */
        const switchListsOf = (body) => [...body.matchAll(/<ul data-language-switch=""[^>]*>([\s\S]*?)<\/ul>/g)].map((m) =>
            [...m[1].matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map(([, attrs, label]) => ({
                href: /\bhref="([^"]*)"/.exec(attrs)?.[1], hreflang: /\bhrefLang="([^"]*)"/i.exec(attrs)?.[1],
                lang: /\blang="([^"]*)"/.exec(attrs)?.[1], current: /\baria-current="true"/.test(attrs), label,
            })));
        /** The switch the spec describes (§ 8.6): default first, then `languages`; label = the language's own name. */
        const ownName = (l) => new Intl.DisplayNames([l], { type: "language" }).of(l);
        const SET_A = [["en", "/about"], ["ro", "/ro/despre"], ["de", "/de/uber"], ["x-default", "/about"]];

        test("(lang1c-hreflang) a set whose members are all Published: each member's head lists every member (en, ro, de, in the tenant's order) and x-default = the default-language member; stored as before (MISS then HIT)", async () => {
            for (const p of ["/about", "/ro/despre", "/de/uber"]) {
                const first = await lAt(C.host, p);
                const second = await lAt(C.host, p);
                assert.equal(first.status, 200, p);
                assert.match(first.header("cache-control"), new RegExp(S_MAXAGE), `${p}: cacheable`);
                assert.equal(second.header("x-nextjs-cache"), "HIT", `${p}: then HIT`);
                assert.deepEqual(hreflangLinksOf(first.body), headPairs(C.host, SET_A), `${p}: alternates`);
                assert.deepEqual(hreflangLinksOf(second.body), hreflangLinksOf(first.body), `${p}: the stored copy holds them`);
                assert.ok(first.body.includes(`<link rel="canonical" href="${headUrl(C.host, p)}"/>`), `${p}: the canonical stays the page's own address`);
                assert.ok(hreflangLinksOf(first.body).every(([, href]) => !href.includes("~") && !href.includes("/_site/")), `${p}: public addresses only`);
            }
            console.log(`  (lang1c-hreflang) /about, /ro/despre, /de/uber: ${JSON.stringify(hreflangLinksOf((await lAt(C.host, "/about")).body))}`);
        });

        test("(lang1c-hreflang-home) the default-language member whose slug is homePageSlug is advertised at / (head and sitemap); a member under a listed prefix named by homePageSlug (a table edit) keeps its own slug", async () => {
            const pairs = [["en", "/"], ["ro", "/ro/acasa"], ["x-default", "/"]];
            for (const p of ["/home", "/ro/acasa", "/"]) {
                const res = await lAt(C.host, p);
                assert.equal(res.status, 200, p);
                assert.deepEqual(hreflangLinksOf(res.body), headPairs(C.host, pairs), `${p}: alternates`);
            }
            const map = (await lAt(C.host, "/sitemap.xml")).body;
            const home = sitemapUrl(map, `https://${C.host}/home`);
            assert.ok(home, "the sitemap lists /home at its slug (<loc> unchanged)");
            assert.deepEqual(sitemapLinksOf(home), sitemapPairs(C.host, pairs), "sitemap: /home's alternates");
            assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}/ro/acasa`)), sitemapPairs(C.host, pairs), "sitemap: /ro/acasa's alternates");
            // Malformed half: `homePageSlug: "/ro/start"` (V6 refuses it at write; only a table edit stores it).
            const H = LANG1C.homeEdit;
            const editPairs = [["en", "/start"], ["ro", "/ro/start"], ["x-default", "/start"]];
            for (const p of ["/start", "/ro/start"]) {
                assert.deepEqual(hreflangLinksOf((await lAt(H.host, p)).body), headPairs(H.host, editPairs), `${H.host}${p}: alternates`);
            }
            const editMap = (await lAt(H.host, "/sitemap.xml")).body;
            assert.deepEqual(sitemapLinksOf(sitemapUrl(editMap, `https://${H.host}/ro/start`)), sitemapPairs(H.host, editPairs), "sitemap: the Romanian member at its own slug, never /");
            assert.ok(!editMap.includes(`href="https://${H.host}/"`), "sitemap: no alternate at /");
            console.log(`  (lang1c-hreflang-home) head ${JSON.stringify(headPairs(C.host, pairs))}; sitemap /home → ${JSON.stringify(sitemapLinksOf(home))}; homePageSlug under /ro → ${JSON.stringify(editPairs)}`);
        });

        test("(lang1c-hreflang-member-invalid) an Archived member, a Draft member, an item whose page is missing and an SK without a node id are skipped: /team lists en + ro only, in the head and the sitemap", async () => {
            const pairs = [["en", "/team"], ["ro", "/ro/echipa"], ["x-default", "/team"]];
            for (const p of ["/team", "/ro/echipa"]) assert.deepEqual(hreflangLinksOf((await lAt(C.host, p)).body), headPairs(C.host, pairs), `${p}: alternates`);
            const map = (await lAt(C.host, "/sitemap.xml")).body;
            assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}/team`)), sitemapPairs(C.host, pairs), "sitemap: /team");
            assert.ok(!sitemapUrl(map, `https://${C.host}/de/team`) && !sitemapUrl(map, `https://${C.host}/fr/equipe`), "sitemap: the Archived and Draft pages are not listed (as before)");
            assert.ok(!map.includes("/de/team\"") && !map.includes("/fr/equipe\"") && !map.includes("c-ghost"), "sitemap: no alternate to a skipped member");
            console.log(`  (lang1c-hreflang-member-invalid) /team: ${JSON.stringify(pairs)} (de Archived, fr Draft, missing page, SK without node id skipped)`);
        });

        test("(lang1c-same-language-pair) two members derive ro: no ro entry in any member's head or sitemap entry; en and de are listed with x-default", async () => {
            const pairs = [["en", "/pair"], ["de", "/de/paar"], ["x-default", "/pair"]];
            for (const p of ["/pair", "/de/paar", "/ro/pereche-1", "/ro/pereche-2"]) {
                assert.deepEqual(hreflangLinksOf((await lAt(C.host, p)).body), headPairs(C.host, pairs), `${p}: alternates (§ 8.4: the set's listed members)`);
            }
            const map = (await lAt(C.host, "/sitemap.xml")).body;
            assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}/pair`)), sitemapPairs(C.host, pairs), "sitemap: /pair");
            for (const p of ["/ro/pereche-1", "/ro/pereche-2"]) assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}${p}`)), [], `sitemap: ${p} is not a listed member`);
            console.log(`  (lang1c-same-language-pair) ${JSON.stringify(pairs)}; the two ro members carry the set's listed alternates in their head (§ 8.4) and none in the sitemap (§ 8.5)`);
        });

        test("(lang1c-set-missing-item) a page that holds the key without its membership item is listed nowhere: not in its siblings' head, not in the sitemap", async () => {
            const pairs = [["en", "/m-en"], ["ro", "/ro/m-ro"], ["x-default", "/m-en"]];
            for (const p of ["/m-en", "/ro/m-ro"]) assert.deepEqual(hreflangLinksOf((await lAt(C.host, p)).body), headPairs(C.host, pairs), `${p}: alternates without /de/m-de`);
            const map = (await lAt(C.host, "/sitemap.xml")).body;
            assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}/m-en`)), sitemapPairs(C.host, pairs), "sitemap: /m-en");
            const own = sitemapUrl(map, `https://${C.host}/de/m-de`);
            assert.ok(own, "sitemap: /de/m-de is still a page of the sitemap");
            assert.deepEqual(sitemapLinksOf(own), [], "sitemap: /de/m-de carries no alternate");
            assert.ok(!map.includes(`href="https://${C.host}/de/m-de"`), "sitemap: no alternate points to /de/m-de");
            const ownHead = hreflangLinksOf((await lAt(C.host, "/de/m-de")).body);
            console.log(`  (lang1c-set-missing-item) siblings: ${JSON.stringify(pairs)}; /de/m-de's own head (it holds the key, § 8.4): ${JSON.stringify(ownHead)}`);
        });

        test("(lang1c-member-not-owner) an item whose page now holds another key, or no key, is skipped in the head and the sitemap", async () => {
            const pairs = [["en", "/o-en"], ["ro", "/ro/o-ro"], ["x-default", "/o-en"]];
            for (const p of ["/o-en", "/ro/o-ro"]) assert.deepEqual(hreflangLinksOf((await lAt(C.host, p)).body), headPairs(C.host, pairs), `${p}: alternates`);
            const map = (await lAt(C.host, "/sitemap.xml")).body;
            assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}/o-en`)), sitemapPairs(C.host, pairs), "sitemap: /o-en");
            for (const p of ["/de/o-other", "/de/o-none"]) {
                assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}${p}`)), [], `sitemap: ${p}`);
                assert.ok(!map.includes(`href="https://${C.host}${p}"`), `sitemap: no alternate points to ${p}`);
            }
            assert.deepEqual(hreflangLinksOf((await lAt(C.host, "/de/o-other")).body), [], "/de/o-other (set-other: no item) has no alternate");
            assert.deepEqual(hreflangLinksOf((await lAt(C.host, "/de/o-none")).body), [], "/de/o-none (no key) has no alternate");
            console.log(`  (lang1c-member-not-owner) ${JSON.stringify(pairs)}`);
        });

        test("(lang1c-no-set) a page in no set, in the default or an extra language: no hreflang link, the canonical as before", async () => {
            for (const p of ["/plain", "/ro/simplu", "/fr/page"]) {
                const res = await lAt(C.host, p);
                assert.equal(res.status, 200, p);
                assert.deepEqual(hreflangLinksOf(res.body), [], `${p}: no alternate`);
                assert.ok(res.body.includes(`<link rel="canonical" href="${headUrl(C.host, p)}"/>`), `${p}: canonical`);
            }
            const map = (await lAt(C.host, "/sitemap.xml")).body;
            for (const p of ["/plain", "/ro/simplu"]) assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}${p}`)), [], `sitemap: ${p}`);
            console.log("  (lang1c-no-set) /plain, /ro/simplu, /fr/page: no alternates");
        });

        test("(lang1c-key-malformed) a stored translationKey that is \"\" or a number is treated as absent: no hreflang link; an SK with an empty key is skipped by the sitemap", async () => {
            for (const p of ["/km-empty", "/ro/km-number"]) {
                const res = await lAt(C.host, p);
                assert.equal(res.status, 200, p);
                assert.deepEqual(hreflangLinksOf(res.body), [], `${p}: no alternate`);
            }
            const map = (await lAt(C.host, "/sitemap.xml")).body;
            assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}/km-empty`)), [], "sitemap: /km-empty");
            console.log("  (lang1c-key-malformed) /km-empty (\"\"), /ro/km-number (5): no alternates");
        });

        test("(lang1c-pagination) more membership items than one query page: the head and the sitemap read every page (stub pages TRANSLATION# queries one item at a time)", async () => {
            const before = stub.stats().pagedResponses;
            stub.pageQueries("TRANSLATION#", 1);
            try {
                const head = await lAt(C.host, "/about?lang1c-pagination=1");   // the twin: a fresh render
                assert.equal(head.status, 200);
                assert.deepEqual(hreflangLinksOf(head.body), headPairs(C.host, SET_A), "head: all three members over three pages");
                const afterHead = stub.stats().pagedResponses;
                assert.ok(afterHead - before >= 2, `head: the set's query was paged (${afterHead - before} responses with LastEvaluatedKey)`);
                const map = (await lAt(C.host, "/sitemap.xml")).body;
                assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}/de/uber`)), sitemapPairs(C.host, SET_A), "sitemap: set-a over many pages");
                assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${C.host}/team`)), sitemapPairs(C.host, [["en", "/team"], ["ro", "/ro/echipa"], ["x-default", "/team"]]), "sitemap: set-invalid over many pages");
                const afterMap = stub.stats().pagedResponses;
                assert.ok(afterMap - afterHead >= 10, `sitemap: the tenant's query was paged (${afterMap - afterHead} responses)`);
                console.log(`  (lang1c-pagination) head ${afterHead - before} paged responses, sitemap ${afterMap - afterHead}; every member read`);
            } finally {
                stub.pageQueries(null);
            }
        });

        test("(lang1c-default-subtag-listed) a stored list that names the default subtag (en; V3 refuses it at write): <html lang> of root pages stays en; /x and /en/x both hold hreflang en and are both left out, no x-default; ro and de are listed", async () => {
            const E = LANG1C.enListed;
            const pairs = [["ro", "/ro/x"], ["de", "/de/x"]];
            for (const p of ["/x", "/en/x", "/ro/x", "/de/x"]) {
                const res = await lAt(E.host, p);
                assert.equal(res.status, 200, p);
                assert.deepEqual(hreflangLinksOf(res.body), headPairs(E.host, pairs), `${p}: alternates`);
            }
            assert.equal(htmlLangOf((await lAt(E.host, "/x")).body), "en", "/x: <html lang> = the default subtag");
            console.log(`  (lang1c-default-subtag-listed) ${JSON.stringify(pairs)}, no en, no x-default`);
        });

        // The language-list rows edit ONLY `LANG1C.change`'s tenant record (`putItem`, the admin's settings save); no page and
        // no membership item is written. Each renders through the twin (a query string: no-store), so every request is a
        // fresh render, and puts the record back in `finally`.
        const G = LANG1C.change;
        const changeTenant = ITEMS.find((i) => i.PK === "SYSTEM" && i.SK === `TENANT#${G.id}`);
        const CHANGE_ALL = [["en", "/about"], ["ro", "/ro/about"], ["fr", "/fr/about"], ["de", "/de/about"], ["x-default", "/about"]];
        const CHANGE_RO_REMOVED = [["fr", "/fr/about"], ["de", "/de/about"]];
        const changeTwin = async (p, n) => lAt(G.host, `${p}?lang1c-change=${n}`);

        test("(lang1c-language-removed) ro removed from the list (a settings edit; no page or item written): /ro/about derives the default language, so /about and /ro/about both hold en and neither is listed, no x-default; fr and de are listed, in the head and the sitemap", async () => {
            assert.deepEqual(hreflangLinksOf((await changeTwin("/about", 1)).body), headPairs(G.host, CHANGE_ALL), "before: every member");
            try {
                stub.putItem({ ...changeTenant, languages: ["fr", "de"] });
                for (const p of ["/about", "/ro/about", "/fr/about"]) assert.deepEqual(hreflangLinksOf((await changeTwin(p, 2)).body), headPairs(G.host, CHANGE_RO_REMOVED), `removed: ${p}`);
                assert.equal(htmlLangOf((await changeTwin("/ro/about", 3)).body), "en", "removed: /ro/about renders in the default language");
                const map = (await lAt(G.host, "/sitemap.xml")).body;
                assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${G.host}/fr/about`)), sitemapPairs(G.host, CHANGE_RO_REMOVED), "removed: sitemap /fr/about");
                for (const p of ["/about", "/ro/about"]) assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${G.host}${p}`)), [], `removed: sitemap ${p}`);
            } finally {
                stub.putItem(changeTenant);
            }
            console.log(`  (lang1c-language-removed) ${JSON.stringify(CHANGE_RO_REMOVED)}`);
        });

        test("(lang1c-language-readded) ro removed, then added again (settings edits only): the earlier alternates come back with no write, in the head and the sitemap", async () => {
            try {
                stub.putItem({ ...changeTenant, languages: ["fr", "de"] });
                assert.deepEqual(hreflangLinksOf((await changeTwin("/about", 4)).body), headPairs(G.host, CHANGE_RO_REMOVED), "precondition: removed");
                stub.putItem({ ...changeTenant, languages: ["ro", "fr", "de"] });
                for (const p of ["/about", "/ro/about", "/de/about"]) assert.deepEqual(hreflangLinksOf((await changeTwin(p, 5)).body), headPairs(G.host, CHANGE_ALL), `re-added: ${p}`);
                const map = (await lAt(G.host, "/sitemap.xml")).body;
                assert.deepEqual(sitemapLinksOf(sitemapUrl(map, `https://${G.host}/ro/about`)), sitemapPairs(G.host, CHANGE_ALL), "re-added: sitemap /ro/about");
            } finally {
                stub.putItem(changeTenant);
            }
            console.log(`  (lang1c-language-readded) ${JSON.stringify(CHANGE_ALL)}`);
        });

        test("(lang1c-sitemap) a tenant with extra languages: <urlset> declares xmlns:xhtml; each listed member's <url> carries one xhtml:link per listed member + x-default; <loc> stays the slug; a page in no set has none", async () => {
            const res = await lAt(C.host, "/sitemap.xml");
            assert.equal(res.status, 200);
            assert.match(res.body, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml">\n/, "the urlset declares the xhtml namespace");
            for (const [, p] of SET_A.slice(0, 3)) {
                const url = sitemapUrl(res.body, `https://${C.host}${p}`);
                assert.ok(url, `${p}: listed at its slug`);
                assert.deepEqual(sitemapLinksOf(url), sitemapPairs(C.host, SET_A), `${p}: alternates`);
            }
            assert.deepEqual(sitemapLinksOf(sitemapUrl(res.body, `https://${C.host}/plain`)), [], "/plain: none");
            assert.ok(!res.body.includes("~") && !res.body.includes("/_site/") && !res.body.includes("%5F"), "public addresses only");
            assert.equal(res.header("cache-control"), "public, s-maxage=3600, stale-while-revalidate=59", "the route's cache header as before");
            const url = sitemapUrl(res.body, `https://${C.host}/about`);
            console.log(`  (lang1c-sitemap) /about's <url>:${url.replace(/\n\s*/g, " ")}`);
        });

        test("(lang1c-sitemap-identity) every fixture tenant of d940fc1 (one-language tenants, and two-language tenants with no set) answers /sitemap.xml with the bytes captured before this slice", async () => {
            const before = JSON.parse(await readFile(new URL("./lang-1c-sitemap-before.json", import.meta.url), "utf8"));
            assert.ok(before.captures.length >= 50 && before.skipped.length === 0, "precondition: the capture covers the fixture tenants");
            for (const c of before.captures) {
                const res = await lAt(c.host, "/sitemap.xml");
                assert.equal(res.status, 200, c.host);
                assert.equal(res.body, c.body, `${c.host}: sitemap bytes`);
                assert.equal(res.header("content-type"), c.contentType, `${c.host}: content-type`);
                assert.equal(res.header("cache-control"), c.cacheControl, `${c.host}: cache-control`);
            }
            const multi = before.captures.find((c) => c.host === LANG1B.multi.host);
            assert.ok(multi, "control: a tenant with languages and no set is in the capture");
            console.log(`  (lang1c-sitemap-identity) ${before.captures.length} sitemaps byte-equal to the d940fc1 capture (incl. ${LANG1B.multi.host}, languages ["ro"], no set)`);
        });

        test("(lang1c-menu) a page in an extra language with its own lists: that language's menu (payload, children included) and footer links; the default language keeps navLinks / footerLinks", async () => {
            const ro = await lAt(C.host, "/ro/despre");
            assert.equal(ro.status, 200);
            const roFlight = splitFlight(ro.body).flight;
            assert.ok(roFlight.includes(JSON.stringify({ links: LANG1C_MENUS.navLinksByLang.ro }).slice(1, -1)), "ro: the Navbar's links prop is the ro list");
            assert.ok(ro.body.includes(">LANG1C Nav Despre<") && !ro.body.includes(">LANG1C Nav About<"), "ro: the ro menu in the HTML");
            assert.ok(ro.body.includes(">LANG1C Foot Contact RO<") && !ro.body.includes(">LANG1C Foot Contact<"), "ro: the ro footer links");
            const en = await lAt(C.host, "/about");
            assert.ok(splitFlight(en.body).flight.includes(JSON.stringify({ links: LANG1C_MENUS.navLinks }).slice(1, -1)), "en: navLinks");
            assert.ok(en.body.includes(">LANG1C Nav About<") && en.body.includes(">LANG1C Foot Contact<") && !en.body.includes("LANG1C Nav Despre"), "en: the default lists");
            console.log("  (lang1c-menu) /ro/despre: ro menu + ro footer; /about: navLinks + footerLinks");
        });

        test("(lang1c-menu-fallback) a page in an extra language with no stored list (fr; and de's footer): the default menu and footer", async () => {
            const fr = await lAt(C.host, "/fr/page");
            assert.equal(fr.status, 200);
            assert.equal(htmlLangOf(fr.body), "fr", "fr page");
            assert.ok(splitFlight(fr.body).flight.includes(JSON.stringify({ links: LANG1C_MENUS.navLinks }).slice(1, -1)), "fr: navLinks");
            assert.ok(fr.body.includes(">LANG1C Foot Contact<"), "fr: footerLinks");
            const de = await lAt(C.host, "/de/uber");
            assert.ok(de.body.includes(">LANG1C Foot Contact<") && !de.body.includes("LANG1C Foot Contact RO"), "de (a menu list, no footer list): footerLinks");
            console.log("  (lang1c-menu-fallback) /fr/page and /de/uber's footer: the default lists");
        });

        test("(lang1c-menu-malformed-entries) navLinksByLang.de = [null, {label: 1}, {label, href}] → one link, no error", async () => {
            const de = await lAt(C.host, "/de/uber");
            assert.equal(de.status, 200);
            assert.ok(splitFlight(de.body).flight.includes(JSON.stringify({ links: [{ label: "LANG1C Startseite", href: "/de" }] }).slice(1, -1)), "de: exactly the one valid entry");
            assert.ok(de.body.includes(">LANG1C Startseite<") && !de.body.includes(">LANG1C Nav About<"), "de: the one link in the HTML");
            console.log("  (lang1c-menu-malformed-entries) /de/uber: one menu link");
        });

        test("(lang1c-switch) a tenant with extra languages: the switch in the server HTML (desktop and mobile copies) — default first, then languages; own-language names; language homes; aria-current on the page language; the preview form on a by-id request as the menu links", async () => {
            const expected = (current) => [["en", "/"], ["ro", "/ro"], ["de", "/de"], ["fr", "/fr"]].map(([l, href]) => ({ href, hreflang: l, lang: l, current: l === current, label: ownName(l) }));
            for (const [p, current] of [["/ro/despre", "ro"], ["/about", "en"], ["/de/uber", "de"], ["/fr/page", "fr"]]) {
                const lists = switchListsOf((await lAt(C.host, p)).body);
                assert.equal(lists.length, 2, `${p}: two copies`);
                for (const list of lists) assert.deepEqual(list, expected(current), `${p}: the switch`);
            }
            // By-id (preview) form: the switch's hrefs go through the same `getUrl` as the logo link (`getUrl("/")`).
            const preview = await lAt(PREVIEW_HOST, `/_site/${C.id}/ro/despre`);
            assert.equal(preview.status, 200);
            const logoHref = /<a (?=[^>]*class="flex items-center gap-2")[^>]*href="([^"]*)"/.exec(preview.body)?.[1];
            const [list] = switchListsOf(preview.body);
            assert.ok(logoHref !== undefined && list, "preview: the logo link and the switch");
            assert.equal(list[0].href, logoHref, "preview: the default-language home has the logo link's form");
            assert.equal(list[1].href, logoHref === "/" ? "/ro" : `${logoHref}/ro`, "preview: /ro in the same form");
            assert.ok(!preview.body.includes(`href="/${C.host}`) && !(/href="[^"]*~/.test(preview.body)), "no internal segment in a link");
            console.log(`  (lang1c-switch) ${JSON.stringify(expected("ro").map((l) => `${l.label} ${l.href}`))}; preview logo ${logoHref} → switch ${list.map((l) => l.href).join(", ")}`);
        });

        test("(lang1c-switch-identity) a one-language tenant: no switch element and no languageSwitch prop; no hreflang link in the head", async () => {
            for (const [host, p] of [[LANG1B.mono.host, "/about"], [LANG1B.mono.host, "/ro/x"], [CM1.content.host, "/"], [FIXTURE_HOST, PUBLISHED_SLUG]]) {
                const res = await lAt(host, p);
                assert.equal(res.status, 200, `${host}${p}`);
                assert.ok(!res.body.includes("data-language-switch"), `${host}${p}: no switch element`);
                assert.ok(!splitFlight(res.body).flight.includes("languageSwitch"), `${host}${p}: no languageSwitch prop`);
                assert.deepEqual(hreflangLinksOf(res.body), [], `${host}${p}: no hreflang`);
            }
            console.log("  (lang1c-switch-identity) lang1b-mono /about, /ro/x; cm1-content /; fixture /published: no switch, no prop, no hreflang");
        });

        // ── ROWS (lang1d-*) — LANG-1D, the German and French packs (docs/slices/lang-1.md § 8.2, § 11, § 12; LANG1-PACK-NOOP
        // = B). The `de` and `fr` pages of `LANG1C.multi` (en-US; extra ro, de, fr; no fixture change) select the new packs
        // through the same call as `ro` (`resolveLocaleStrings(localeInputFor(config, language))`): the layout (footer,
        // cookie texts) and the page (share bar) show the pack's texts, and no English text of those keys. The expected texts
        // are the registered pack's, read through the resolver; the precondition asserts that the resolver selected the pack
        // (a missing registration would resolve English and fail it).
        for (const [row, language, path] of [["lang1d-extra-de", "de", "/de/uber"], ["lang1d-extra-fr", "fr", "/fr/page"]]) {
            test(`(${row}) a ${language} page of a multi-language tenant shows the ${language} pack's site texts in the layout (footer, cookie texts) and in the page (share bar), and <html lang="${language}">`, async () => {
                const resolved = resolveLocaleStrings({ locale: language });
                assert.equal(resolved.language, language, `precondition: a ${language} pack is registered`);
                const site = resolved.strings.site;
                for (const key of ["shareLabel", "footerCopyright", "cookieHeadline"]) assert.notEqual(site[key], EN_SITE[key], `precondition: ${key} differs from English`);
                const res = await lAt(C.host, path);
                assert.equal(res.status, 200, `${path}: 200`);
                assert.equal(htmlLangOf(res.body), language, `${path}: <html lang>`);
                assert.ok(res.body.includes(site.shareLabel), `${path}: the ${language} share label (SitePage)`);
                assert.ok(res.body.includes(copyrightTail(site)), `${path}: the ${language} footer (layout)`);
                assert.ok(splitFlight(res.body).flight.includes(site.cookieHeadline), `${path}: the ${language} cookie headline (layout)`);
                assert.ok(!res.body.includes(EN_SITE.shareLabel) && !res.body.includes(copyrightTail(EN_SITE)), `${path}: an English text`);
                assert.ok(!splitFlight(res.body).flight.includes(EN_SITE.cookieHeadline), `${path}: the English cookie headline`);
                console.log(`  (${row}) ${path}: lang=${htmlLangOf(res.body)}; "${site.shareLabel}", "${copyrightTail(site).trim()}", "${site.cookieHeadline}"`);
            });
        }

        // ── ROW (np1-bootstrap-chunks) — NEXT-PATCH-1 ruling R-NP1-F1 rule 2. The LAST row of the `next` target on purpose:
        // its population is EVERY response the suite's server sent in this run (harness.mjs `servedResponses`, the journal
        // of the suite's only HTTP client), so no row's documents stay unchecked — review-1 found that an enumerated list
        // of capture sets left the HC1, CC1, SL1*, BPF1 … rows out. Its own requests (static chunks) do not touch the ISR
        // cache. The baseline rule ("no `_R_` where the baseline has one") applies where a stored baseline exists: a plain
        // GET (no request header — how the stored sets were captured, `captureRequests`) of a URL of cdl-2/before or
        // 1e/before-404.
        test("(np1-bootstrap-chunks) every chunk the _R_ bootstrap of every document the suite served lists is in the build's static output and answers 200; a plain GET without the bootstrap where its stored baseline has one fails; a bad chunk is reported, also in a response of the HC1, CC1, SL1A and BPF1 rows", async () => {
            const hasBootstrap = (body) => /<script id="_R_">/.test(body);
            const cdl2 = await loc1BeforeSet();
            const before404 = await readLanding1ExpectedCaptures(path.join(LOC1_DIR, "1e", "before-404"));
            const baseline = new Map();
            for (const r of [...Object.values(EN_US_REQUESTS), ...Object.values(LOC1_REQUESTS), ...Object.values(CQ1_REQUESTS), ...Object.values(CT1_REQUESTS)].flat()) {
                const b = cdl2.captures.find((x) => x.tenant === r.tenant && x.path === r.path);
                assert.ok(b, `${r.tenant} ${r.path}: no cdl-2/before capture`);
                baseline.set(`${r.host} ${r.path}`, hasBootstrap(b.body));
            }
            for (const r of LOC1E_404_REQUESTS) {
                const variants = before404.captures.filter((x) => x.tenant === r.tenant && x.path === r.path);
                assert.ok(variants.length > 0, `${r.tenant} ${r.path}: no before-404 variant`);
                baseline.set(`${r.host} ${r.path}`, variants.some((v) => hasBootstrap(v.body)));
            }
            const plainGet = (r) => r.method === "GET" && r.requestHeaders.length === 0;
            const toDocument = (r, i) => ({ where: `#${i} ${r.method} ${r.host}${r.path} → ${r.status}`, body: r.body, baselineHasBootstrap: plainGet(r) && baseline.get(`${r.host} ${r.path}`) === true, host: r.host });
            const journal = () => servedResponses().filter((r) => r.port === server.port);
            const staticDir = path.join(RENDERER_DIR, ".next", "static");
            const statusOf = async (p) => (await request({ port: server.port, path: p, host: FIXTURE_HOST })).status;
            // CONTROLS FIRST (review-2): every response they cause joins the journal BEFORE the final check below reads it.
            const docsNow = journal().map(toDocument);
            const sample = docsNow.find((d) => d.baselineHasBootstrap && hasBootstrap(d.body));
            assert.ok(sample, "control precondition: a baseline-anchored document with a bootstrap");
            const sampleChunks = bootstrapChunks(sample.body);
            assert.ok(sampleChunks.length > 1, "control precondition: the sample lists more than one chunk");
            // (d) a copy of the static output without the sample's first chunk; the build the rows use is untouched.
            const copy = await mkdtemp(path.join(os.tmpdir(), "np1-bootstrap-static-"));
            try {
                await mkdir(path.join(copy, "chunks"));
                for (const t of new Set(sampleChunks.slice(1))) await copyFile(path.join(staticDir, t.slice("static/".length)), path.join(copy, t.slice("static/".length)));
                assert.deepEqual((await bootstrapChunkProblems([sample], copy, statusOf)).problems, [`${sample.where}: ${sampleChunks[0]} is not in the build's static output`], "(d) a chunk missing from the static output was not reported (exactly)");
            } finally {
                await rm(copy, { recursive: true, force: true });
            }
            // A chunk the build does not have, in a served document of each family the enumerated population of cycle 2
            // missed: reported by both halves (a missing `/_next/static` file answers 307 under `next start`, as the
            // d9999d2 probe `/_next/static/loc1e-missing.js` in 1e/before-headers.json records — any answer but 200 counts).
            const foreign = (d) => ({ ...d, body: d.body.replace(/(<script id="_R_">[^<]*?)static\/chunks\/[A-Za-z0-9_-]+\.js/, "$1static/chunks/np1-no-such-chunk.js") });
            const families = { HC1, CC1, SL1A, BPF1 };
            for (const [family, tenants] of Object.entries(families)) {
                const hosts = new Set(Object.values(tenants).map((t) => t.host));
                const d = docsNow.find((x) => hosts.has(x.host) && hasBootstrap(x.body));
                assert.ok(d, `${family}: the suite served no document with a bootstrap from its hosts — it is not in the population`);
                const p = (await bootstrapChunkProblems([foreign(d)], staticDir, statusOf)).problems;
                assert.ok(p.some((x) => x.endsWith("is not in the build's static output")) && p.some((x) => /answers (?!200$)\d+$/.test(x)), `${family}: a bad chunk in ${d.where} was not reported by both halves: ${JSON.stringify(p)}`);
            }
            const stripped = { ...sample, body: sample.body.replace(/<script id="_R_">[^<]*<\/script>/, "") };
            assert.deepEqual((await bootstrapChunkProblems([stripped], staticDir, statusOf)).problems, [`${sample.where}: no <script id="_R_"> where the baseline has one`], "a document without the bootstrap where its baseline has one was not reported");
            // A document that joins the journal AFTER the first read (review-2's reproduction): a fake journal of one good
            // document whose first status probe appends a document with a chunk the build does not have — reported.
            const fake = [{ ...sample, where: "fake #0" }];
            const late = { where: "fake late document", body: sample.body.replace(/(<script id="_R_">[^<]*?)static\/chunks\/[A-Za-z0-9_-]+\.js/, "$1static/chunks/np1-late-document.js"), baselineHasBootstrap: false };
            const fakeStatus = async (p) => { if (fake.length === 1) fake.push(late); return p.endsWith("/np1-late-document.js") ? 404 : 200; };
            const drained = await bootstrapChunkProblemsOfJournal(() => fake, (d) => d, staticDir, fakeStatus);
            assert.ok(drained.problems.includes("fake late document: static/chunks/np1-late-document.js is not in the build's static output") && drained.passes === 2, `a document added after the first read was not checked: ${JSON.stringify(drained)}`);
            const endless = [sample];
            const growing = await bootstrapChunkProblemsOfJournal(() => endless, (d) => d, staticDir, async () => { endless.push(sample); return 200; }, 3);
            assert.ok(growing.problems.some((x) => x.startsWith("the journal still grows after 3 passes")), `a journal that keeps growing did not fail closed: ${JSON.stringify(growing.problems)}`);
            // THE CHECK: every response of the run — the rows' and the controls' above — until the journal stops growing
            // (its own status probes add entries).
            const result = await bootstrapChunkProblemsOfJournal(journal, toDocument, staticDir, statusOf);
            assert.deepEqual(result.problems, []);
            assert.ok(result.withBootstrap > 0 && result.chunks.length > 0, "precondition: the served documents list bootstrap chunks");
            const all = journal().slice(0, result.entries);
            const html = all.filter((r) => r.contentType.startsWith("text/html")).length;
            const docs = all.map(toDocument);
            const hosts = new Set(docs.filter((d) => hasBootstrap(d.body)).map((d) => d.host)).size;
            console.log(`  (np1-bootstrap-chunks) ${result.entries} HTTP responses served by the suite's server, controls included, checked in ${result.passes} passes until the journal stopped growing (${html} text/html); ${result.withBootstrap} documents with a bootstrap on ${hosts} hosts; ${docs.filter((d) => d.baselineHasBootstrap).length} plain GETs anchored to a stored baseline with the element; ${result.chunks.length} distinct chunks, each in .next/static and 200 (${result.chunks.join(", ")}); controls reported: a chunk missing from a copy of the static output, a bad chunk in a served HC1, CC1, SL1A and BPF1 document (file + non-200), a missing bootstrap, a document added after the first read, a journal that keeps growing`);
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
