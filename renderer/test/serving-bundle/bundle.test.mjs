// BUNDLE ARTEFACT ROWS — slice opennext-1a (spec docs/slices/opennext-1-upgrade.md § 8.1).
//
// Rows about the built OpenNext artefact itself, not about a serving-contract row: which adapter
// version was built (B-VERSION), what the image function packages (B-SHARP), that no
// cache-directive header of any suite response carries the 30-day window (B-NO30D), what the
// handler does with a warmer event (B-WARM), and that the origin guard is armed (B-ORIGINVERIFY). Increment 1A-2 adds the
// remaining B-rows here (docs/slices/opennext-1a.md § Increment 1A-2).
//
// HOW IT RUNS — THIS FILE IS THE ENTRY OF `npm run test:serving-bundle`. Only under
// `SERVING_TARGET=bundle`. Its first import is the contract suite, so ONE process runs, in this
// order: contract.test.mjs (build once, the 39 rows + `(journals)` on the bundle), then the rows
// below. Why one entry file rather than both files on the command line: `node --test` SORTS its
// file list (OBSERVED on Node 22.21.1, 2026-10-15: `a/a.test.mjs` ran before `z.test.mjs` given
// first), and `serving-bundle/` sorts before `serving-contract/` — the B-rows would run first,
// in another process, against a stale `.open-next`, with no contract responses for B-NO30D.
//
// This file does NOT rebuild: it serves the `.open-next` the contract describe built, in a
// fresh Lambda host (a cold container) with fresh stubs. B-NO30D reads every handler result of
// the process (harness.mjs `bundleResponses`) — edge HTTP and raw invocations, the contract
// rows' and this file's.
import "../serving-contract/contract.test.mjs";
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
    startStubs, startRenderer, versionedExpectation, bundleResponses,
    BUNDLE, BUNDLE_FIXTURE, RENDERER_DIR, AUDIT_PATH,
} from "../serving-contract/harness.mjs";
import { FIXTURE_HOST, PUBLISHED_SLUG } from "../serving-contract/fixtures.mjs";
import { toFunctionUrlEvent } from "./lambda-host.mjs";

if (!BUNDLE) throw new Error("bundle.test.mjs runs only under SERVING_TARGET=bundle (npm run test:serving-bundle)");

/**
 * Version-explicit expectations of the B-rows (same mechanism as contract.test.mjs; lookup in
 * harness.mjs `versionedExpectation`). B-VERSION names the adapter package each major is
 * declared as; the 4.x entry is the ratified exact pin (spec § Ratification, OPENNEXT1-PIN = B:
 * `@opennextjs/aws` 4.1.9). The other rows assert the same on both majors.
 */
const EXPECTATIONS = {
    "B-VERSION": { "3": { adapterPackage: "open-next" }, "4": { adapterPackage: "@opennextjs/aws" } },
    "B-SHARP": { "3,4": { sharp: "0.35.5", binary: "@img/sharp-linux-arm64" } },
    "B-NO30D": { "3,4": "same" },
    "B-WARM": { "3,4": "same" },
    "B-ORIGINVERIFY": { "3,4": "same" },
};

const REPO_ROOT = path.resolve(RENDERER_DIR, "..");
const OPEN_NEXT_DIR = path.join(RENDERER_DIR, ".open-next");

let stubs;
let server;
const expect = (row) => versionedExpectation(EXPECTATIONS, row, server.openNextVersion);

/** Lengths of the three stub journals — a call made between two snapshots changes one. */
const journalSizes = () => ({
    dynamodb: stubs.ddb.journal().length,
    s3: stubs.s3.journal().length,
    sqs: stubs.sqs.journal().length,
});

describe("bundle artefact rows (docs/slices/opennext-1a.md)", { concurrency: 1 }, () => {
    before(async () => {
        await stat(path.join(OPEN_NEXT_DIR, "server-functions", "default", "index.mjs")); // built?
        stubs = await startStubs();
        server = await startRenderer(stubs);
    });

    after(async () => {
        const unhandled = stubs?.unhandled() ?? [];
        await server?.close();
        await stubs?.close();
        // This file's Lambda host child loads no-dotenv.cjs too (NODE_OPTIONS) and appends to the
        // journal the contract describe already removed; remove it again.
        await rm(AUDIT_PATH, { force: true });
        assert.deepEqual(unhandled, [], `a stub could not answer some calls: ${unhandled.join("; ")}`);
    });

    // ── B-WARM ──────────────────────────────────────────────────────────────────────────
    // The warmer event never reaches Next: the `aws-lambda` wrapper (the one the bundle uses —
    // `open-next.output.json` `origins.default.wrapper: "aws-lambda"`) answers any event that has
    // a `type` field itself, at node_modules/open-next/dist/wrappers/aws-lambda.js:11-13, with
    // `formatWarmerResponse` (:2-8): `resolve({ serverId, type: "warmer" })` at :5. `serverId` is
    // the per-container id `createMainHandler` sets. The warmer FUNCTION was removed from infra
    // in opennext-1c; this row pins what the server handler still does with the event.
    test("(B-WARM) a warmer event returns { serverId, type: 'warmer' } and makes no DynamoDB/S3/SQS call", async () => {
        expect("B-WARM");
        const before = journalSizes();
        const res = await server.invoke({ type: "warmer" });
        assert.equal(res.type, "warmer");
        assert.ok(typeof res.serverId === "string" && res.serverId.length > 0, `serverId missing: ${JSON.stringify(res)}`);
        assert.deepEqual(journalSizes(), before, "the warmer event caused an AWS call");
    });

    // ── B-ORIGINVERIFY ──────────────────────────────────────────────────────────────────
    // middleware.ts § 0 "ORIGIN VERIFICATION (Phase 6.1)": with ORIGIN_VERIFY_SECRET set, a
    // request without the matching `x-origin-verify` is a DIRECT Function URL call (it did not
    // come through CloudFront) and gets 403. The `next` target blanks the secret; the bundle
    // target arms it and the emulated edge sends it on every row. This row sends events straight
    // to the handler — no edge — with the wrong value, with none, and (control) with the right one.
    test("(B-ORIGINVERIFY) a direct Function URL call without the right x-origin-verify gets 403; with it, 200", async () => {
        expect("B-ORIGINVERIFY");
        const direct = (headers) =>
            server.invoke(toFunctionUrlEvent({ method: "GET", url: PUBLISHED_SLUG, headers: { "x-forwarded-host": FIXTURE_HOST, ...headers } }));
        const wrong = await direct({ "x-origin-verify": "not-the-secret" });
        assert.equal(wrong.statusCode, 403, "a wrong x-origin-verify must be refused");
        assert.match(wrong.body, /Direct access forbidden/);
        const none = await direct({});
        assert.equal(none.statusCode, 403, "a missing x-origin-verify must be refused");
        // Positive control: the same request with the edge's secret is served.
        const right = await direct({ "x-origin-verify": BUNDLE_FIXTURE.originVerifySecret });
        assert.equal(right.statusCode, 200, "the guard must let the CloudFront-signed request through");
    });

    // ── B-VERSION ───────────────────────────────────────────────────────────────────────
    // Spec § 6.3: "assert openNextVersion in server-functions/default/renderer/index.mjs equals
    // the pinned version (catches a stale .open-next)". Read from the RUNNING bundle
    // (`globalThis.openNextVersion`, set by the banner open-next `build/helper.js` writes into the
    // function), compared with BOTH the version renderer/package.json declares (its base: today
    // `^3.1.3`, a caret range — the exact pin is the lockfile) and the lockfile's resolved version.
    test("(B-VERSION) the bundle's open-next version equals the declared and the locked adapter version", async () => {
        const { adapterPackage } = expect("B-VERSION");
        const pkg = JSON.parse(await readFile(path.join(RENDERER_DIR, "package.json"), "utf8"));
        const declared = pkg.devDependencies?.[adapterPackage] ?? pkg.dependencies?.[adapterPackage];
        assert.ok(declared, `renderer/package.json does not declare ${adapterPackage}`);
        const lock = JSON.parse(await readFile(path.join(REPO_ROOT, "package-lock.json"), "utf8"));
        const locked = lock.packages?.[`node_modules/${adapterPackage}`]?.version;
        console.log(`  (B-VERSION) bundle ${server.openNextVersion}, declared ${declared}, locked ${locked}`);
        assert.equal(server.openNextVersion, declared.replace(/^[\^~]/, ""), "bundle ≠ declared version (stale .open-next?)");
        assert.equal(server.openNextVersion, locked, "bundle ≠ locked version");
    });

    // ── B-SHARP ─────────────────────────────────────────────────────────────────────────
    // Spec § 6.3 artefact checks. On 3.1.3 the build pins sharp through `SHARP_VERSION=0.35.5
    // npm_config_os=linux npm_config_cpu=arm64` in renderer/package.json `build:open`; open-next
    // runs `npm install … sharp@$SHARP_VERSION` into the image function (build.js:287-301). The
    // same two checks hold for the 4.x config `install` block (§ 6.3), so one entry covers both.
    test("(B-SHARP) the image function packages sharp 0.35.5 with the linux-arm64 binary", async () => {
        const { sharp, binary } = expect("B-SHARP");
        const modules = path.join(OPEN_NEXT_DIR, "image-optimization-function", "node_modules");
        const version = JSON.parse(await readFile(path.join(modules, "sharp", "package.json"), "utf8")).version;
        const img = await readdir(path.join(modules, "@img"));
        console.log(`  (B-SHARP) sharp ${version}; @img: ${img.join(", ")}`);
        assert.equal(version, sharp);
        assert.ok(img.includes(binary.split("/")[1]), `${binary} is not in the image function`);
    });

    // ── B-NO30D ─────────────────────────────────────────────────────────────────────────
    // Claim (ruling OPENNEXT1A-NO30D): no cache-directive header of any suite response carries
    // 2592000; Set-Cookie excluded. Mechanically: EVERY header except `set-cookie` is scanned
    // (a superset of the cache-directive headers), over EVERY handler result of the run: the edge
    // (HTTP) responses of the contract rows and of this file, and the raw IPC invocations of
    // B-WARM and B-ORIGINVERIFY. Coverage is structural, not a list: lambda-host.mjs `callHandler`
    // is the handler's only call site and records every result (review-0 rule), so a raw
    // invocation added later is covered without editing this row.
    //
    // The executable form of scripts/verify-opennext-patch.mjs LAYER 2 (which greps the bundle
    // for the string); the script stays — it is the deploy gate's fast form — and this row
    // overlaps it on purpose. The cache-8 patch makes `fixISRHeaders` emit
    // `stale-while-revalidate=300`; a lost patch would emit 2592000 on the STALE path.
    //
    // LIMIT OF THIS PROOF. Increment 1A-1 exercises NO STALE response (every row reaches MISS or
    // HIT with `s-maxage=31536000`, which `fixISRHeaders` leaves alone), so the live-handler SWR
    // patch window is NOT yet proven by this row; B-STALE (1A-2) proves it. The builder's
    // `restart()` probe already observed `s-maxage=2, stale-while-revalidate=300` on a cold
    // container (evidence recorded in docs/slices/opennext-1a.md).
    test("(B-NO30D) no cache-directive header of any suite response carries 2592000; Set-Cookie excluded", async () => {
        expect("B-NO30D");
        const responses = bundleResponses;
        const edge = responses.filter((r) => r.via === "edge");
        const invoked = responses.filter((r) => r.via === "invoke");
        // Positive controls: the record holds the contract rows' edge responses, cacheable ones
        // included, AND this file's raw invocations (the warmer, and a direct call B-ORIGINVERIFY
        // answered 403) — so an empty, header-less or edge-only record cannot pass this row.
        assert.ok(edge.length >= 30, `only ${edge.length} edge responses recorded — run via npm run test:serving-bundle`);
        assert.ok(
            edge.some((r) => /s-maxage=31536000/.test(String(r.headers["cache-control"] ?? ""))),
            "no cacheable response in the record — headers are not being recorded",
        );
        assert.ok(invoked.some((r) => r.url === "(event type=warmer)"), "the B-WARM invocation is not in the record");
        assert.ok(invoked.some((r) => r.status === 403), "the B-ORIGINVERIFY direct calls are not in the record");
        // `set-cookie` is the ONE header not checked: a cookie lifetime is not a cache lifetime
        // (CloudFront and browsers cache by Cache-Control/Expires, never by a Set-Cookie
        // attribute), and the product legitimately sets one of 30 days — `amodx_ref`,
        // `Max-Age=2592000` (src/app/api/ref/route.ts:88, `maxAge: WINDOW_SECONDS`; row (g3)).
        // OBSERVED on the first run: the unnarrowed rule failed on exactly that cookie
        // (docs/slices/opennext-1a.md, D2).
        const carries = (r, pred) => Object.entries(r.headers).some(([k, v]) => pred(k) && String(v).includes("2592000"));
        const offenders = responses.filter((r) => carries(r, (k) => k !== "set-cookie"));
        const cookieOnly = responses.filter((r) => carries(r, (k) => k === "set-cookie"));
        console.log(
            `  (B-NO30D) ${responses.length} handler results checked (${edge.length} edge, ${invoked.length} invoke, ` +
                `${responses.length - edge.length - invoked.length} other); ${cookieOnly.length} carry 2592000 only in Set-Cookie (excluded)`,
        );
        assert.deepEqual(
            offenders.map((r) => `${r.via} ${r.status ?? "-"} ${r.host ?? ""}${r.url}`),
            [],
            "a response carried 2592000 outside Set-Cookie",
        );
    });
});
