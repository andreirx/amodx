// BUNDLE ARTEFACT ROWS — slice opennext-1a (spec docs/slices/opennext-1-upgrade.md § 8.1).
//
// Rows about the built OpenNext artefact itself, not about a serving-contract row: which adapter
// version was built (B-VERSION), what the image function packages (B-SHARP), that no
// cache-directive header of any suite response carries the 30-day window (B-NO30D), what the
// handler does with a warmer event (B-WARM), and that the origin guard is armed (B-ORIGINVERIFY).
// Increment 1A-2 added the remaining B-rows of spec § 8.1 (docs/slices/opennext-1a.md
// § Increment 1A-2): B-ISO, B-REFLECT, B-TAG, B-LISTING, B-XISR, B-RSC, B-PREVIEW, B-ROUTEERR,
// B-CASE, D3-LOCATION, B-STALE, B-REVAL, B-LEAK. They run in ONE Lambda host, in file order,
// and some depend on earlier state (stated at each row): B-STALE needs `/published` rendered
// earlier in this host; B-REVAL takes B-STALE's queued message; B-LEAK and B-NO30D read every
// response of the run, so they are last.
//
// CHARACTERIZED ROWS. Where 3.1.3 has a known defect the row asserts the 3.1.3 OBSERVABLE (and
// is therefore green) under the `"3"` key, and carries the expected 4.x behaviour under `"4"`.
// Where an observable differed from the spec's prediction, the row asserts what was OBSERVED
// and its comment says so — the bundle is the oracle, not the spec.
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
import { createRequire } from "node:module";
import {
    startStubs, startRenderer, versionedExpectation, bundleResponses, request, operationInventory,
    BUNDLE, BUNDLE_FIXTURE, RENDERER_DIR, AUDIT_PATH,
} from "../serving-contract/harness.mjs";
import {
    FIXTURE_HOST, PUBLISHED_SLUG, MISSING_SLUG, TENANT_ID, ITEMS,
    ISO_HOST_A, ISO_HOST_B, ISO_TENANT_A, ABOUT_SLUG, ISO_ABOUT_TITLE_A, ISO_ABOUT_TITLE_B,
    LISTED_POST_SLUG, LISTED_POST_TITLE, REVALIDATION_MESSAGE_3_1_3,
} from "../serving-contract/fixtures.mjs";
import { toFunctionUrlEvent, runRevalidationFunction } from "./lambda-host.mjs";

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
    // ── increment 1A-2 (spec § 8.1 rows table; "record" = the row logs the value and asserts only
    //    what both majors share — opennext-1b turns it into a pinned value from its own run) ──
    "B-ISO": { "3,4": "same" },
    "B-REFLECT": { "3,4": "same" },
    // Characterized on 3.1.3 (spec § 3.D D4): no tag row is ever written for APP_PAGE.
    "B-TAG": {
        "3": { tagRowWritten: false, afterRevalidate: "HIT", showsEdit: false },
        "4": { tagRowWritten: true, afterRevalidate: "MISS", showsEdit: true },
    },
    "B-LISTING": { "3,4": "same" },
    // Characterized on 3.1.3 (spec § 3.C C1): with the header AT the origin, the tenant barrier is skipped.
    // 4.x (class rule, operator 2026-10-15): status, cache-control, x-nextjs-cache and body marker
    // identical to the no-header request, for both paths.
    "B-XISR": {
        "3": {
            bypass: true,
            published: { status: 307, location: "/?nf=1,/?nf=1", cache: "MISS", cacheControl: "s-maxage=31536000", storedKey: "published" },
            site: { status: 307, location: `/${TENANT_ID}?nf=1,/${TENANT_ID}?nf=1`, cache: "MISS", cacheControl: "s-maxage=31536000", storedKey: `_site/${TENANT_ID}` },
        },
        "4": { bypass: false },
    },
    // The navigation shape passes as the spec predicts; the bare `RSC: 1` shape is OBSERVED (not in
    // the spec): 307 to the rewritten internal path (finding F8 in the slice doc).
    "B-RSC": {
        "3": { bare: { status: 307, location: `/${FIXTURE_HOST}${PUBLISHED_SLUG}?_rsc` } },
        "4": { bare: "record" },
    },
    "B-PREVIEW": { "3": { dynCanonical: true }, "4": { dynCanonical: "record" } },
    // Two means (row comment): `invalidHost` = the packet's means (1); `headerValue` = a raw
    // invocation whose header value Headers.append rejects (deviation D13). 3.x: the observables
    // recorded on 3.1.3. 4.x (class rule): Next's built `/500` page — status 500, no-store, and
    // the `<title>` of the prerendered global-error page read from the artefact under test.
    "B-ROUTEERR": {
        "3": {
            invalidHost: { status: 500, cacheControl: null, contentType: "text/plain", body: "Internal Server Error", stored: [] },
            headerValue: { status: 307, cacheControl: "s-maxage=31536000", cache: "MISS", location: "/?nf=1,/?nf=1", stored: ["routeerr-probe"] },
        },
        // Operator ruling OPENNEXT1A-ROUTEERR-MEANS (2026-10-15, review cycle 2): the spec's `/500`
        // contract is carried by means (2) (a valid host, so the 4.x catch can build the `/500`
        // event). Means (1) is CHARACTERIZED on 4.x: the 4.1.9 source (read, not run) rebuilds
        // `new URL` on the same invalid host inside its catch and throws again — a handler failure
        // (Function URL 502), not `/500`. INFERRED until opennext-1b runs the 4.x bundle, which
        // pins the observed value here; until then the row asserts only that routing threw and
        // that nothing was stored for (1).
        "4": { invalidHost: "characterize", headerValue: "500-page" },
    },
    "B-CASE": { "3": { reachOutbound: true }, "4": { reachOutbound: false } },
    "D3-LOCATION": { "3": { location: `${MISSING_SLUG}?nf=1,${MISSING_SLUG}?nf=1` }, "4": "record" },
    // 4.x has two candidate entries; opennext-1b selects one by renaming its key to "4"
    // (decision OPENNEXT1-1250). Until then a 4.x bundle fails this row: "no expectation for version 4".
    "B-STALE": {
        "3": { cache: "STALE", cacheControl: "s-maxage=2, stale-while-revalidate=300", sqsMessages: 1 },
        "4-noseed": { cache: "STALE", cacheControl: null, sqsMessages: 1 },
        "4-seed": { cache: "HIT", cacheControl: "s-maxage=31536000", sqsMessages: 0 },
    },
    // `successStatuses`: the statuses the function counts as revalidated WHEN the host answers
    // `x-nextjs-cache: REVALIDATED` (3.1.3 `adapters/revalidate.js:35-37`: 200 only; 4.x spec § 3.G
    // G4: 200, 307, 308, 404). The row derives the expected batch-item result from that rule and
    // the host's actual answer, and asserts it (ruling: assert, not log). `pinned`: the 3.1.3 answer.
    "B-REVAL": {
        "3": { successStatuses: [200], pinned: { hostStatus: 307, cache: "MISS", failedRecords: 1 } },
        "4": { successStatuses: [200, 307, 308, 404], pinned: null },
    },
    // Characterized on 3.1.3 (spec § 3.C C3): middleware response headers reach the client.
    "B-LEAK": { "3": { leaked: ["x-middleware-rewrite", "x-middleware-set-cookie"] }, "4": { leaked: [] } },
};

const REPO_ROOT = path.resolve(RENDERER_DIR, "..");
const OPEN_NEXT_DIR = path.join(RENDERER_DIR, ".open-next");
const REVALIDATION_FUNCTION_DIR = path.join(OPEN_NEXT_DIR, "revalidation-function");

let stubs;
let server;
const expect = (row) => versionedExpectation(EXPECTATIONS, row, server.openNextVersion);
const RECORD = "record";

/** GET (or any method) through the emulated edge to the Lambda host. */
const get = (host, reqPath, headers = {}, more = {}) => request({ port: server.port, host, path: reqPath, headers, ...more });
const titleOf = (body) => body.match(/<title>([^<]*)<\/title>/)?.[1] ?? null;
const first = (headerValue) => String(headerValue ?? "").split(",")[0];

/**
 * POST `/api/revalidate` as the backend sends it (`renderer/src/app/api/revalidate/route.ts`
 * `POST`: `{ domain, slug }`, header `x-revalidation-token` = `REVALIDATION_SECRET`). Through the
 * edge: both headers are on the ORP allowlist. Returns `{ status, json }`.
 */
async function revalidate(domain, slug) {
    const res = await get(
        domain,
        "/api/revalidate",
        { "content-type": "application/json", "x-revalidation-token": BUNDLE_FIXTURE.revalidationSecret },
        { method: "POST", body: JSON.stringify({ domain, slug }) },
    );
    return { status: res.status, json: JSON.parse(res.body) };
}

/** An admin edit of a fixture content item's title (ddb-stub.mjs `putItem`). */
function editTitle(tenantId, nodeId, title) {
    const item = ITEMS.find((i) => i.PK === `TENANT#${tenantId}` && i.SK === `CONTENT#${nodeId}#LATEST`);
    stubs.ddb.putItem({ ...item, title });
}

/** The ISR cache key of an S3 object key (the part after `/$/`, or after `_cache/<buildId>/` in
 *  the pre-16.3.8 layout), without `.cache`; `null` for anything else (`__fetch/`). Same rule
 *  as contract.test.mjs `storedS3Entries`. */
function cacheKeyOf(s3Key) {
    const m = s3Key.match(/^_cache\/(?!__fetch\/)[^/]+\/(.+)\.cache$/);
    if (!m) return null;
    const at = m[1].indexOf("/$/");
    return m[1].startsWith("route-cache/") ? (at === -1 ? null : m[1].slice(at + 3)) : m[1];
}

/** Waits until `count()` reaches `atLeast` or `ms` pass — for calls the handler makes after it
 *  answered (the SQS send of a STALE response). Returns the final count. */
async function settle(count, atLeast, ms = 2000) {
    const until = Date.now() + ms;
    while (count() < atLeast && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 200)); // and nothing more arrives just after
    return count();
}

/** Message B-STALE observed on the queue; B-REVAL feeds it to the revalidation function. */
let staleMessage;

/**
 * The `<title>` of Next's prerendered global-error page (`/500`) in THIS build, read from the
 * object CDK uploads to the ISR bucket (`.open-next/cache/<buildId>/_global-error.cache`, an
 * `{ html, … }` JSON). B-ROUTEERR's 4.x marker; read, not hard-coded, so a Next change to the
 * page cannot desynchronize the row.
 */
async function globalErrorTitle() {
    const cacheDir = path.join(OPEN_NEXT_DIR, "cache");
    for (const buildId of await readdir(cacheDir)) {
        const file = path.join(cacheDir, buildId, "_global-error.cache");
        const entry = await readFile(file, "utf8").then(JSON.parse).catch(() => null);
        const title = entry && titleOf(String(entry.html ?? ""));
        if (title) return title;
    }
    throw new Error("no prerendered _global-error page with a <title> under .open-next/cache");
}

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
        if (stubs && server) {
            await server.sync();
            const count = (list, keyOf) => list.reduce((o, e) => ((o[keyOf(e)] = (o[keyOf(e)] ?? 0) + 1), o), {});
            console.log(
                `\n${operationInventory(stubs, "B-rows")}\n` +
                    `  outbound (outbound-shim.cjs, Lambda host child) ${JSON.stringify(count(server.outbound(), (e) => `${e.api} ${e.method}`))}\n` +
                    `  viewer requests by method ${JSON.stringify(count(server.requests(), (e) => e.method))}`,
            );
        }
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

    // ══ INCREMENT 1A-2 ROWS (spec § 8.1; docs/slices/opennext-1a.md § Increment 1A-2) ═════════

    // ── B-ISO ───────────────────────────────────────────────────────────────────────────
    // Spec § 8.1 (P0 runtime gate for the 4.x upgrade, § 3.B B4): two tenants publish the SAME
    // slug with different text. Each host gets its own body, each is stored under its own S3 key
    // carrying its host, and the entry is tagged with the host-scoped path tag.
    // OBSERVED differences from the packet's wording (asserted as observed): the keys are the
    // next-16.3.8 route-scoped layout `_cache/<buildId>/route-cache/APP_PAGE/<sha256>/$/<host>/about.cache`,
    // not `_cache/<buildId>/<host>/about…`; and `x-next-cache-tags` is NOT sent to the client —
    // the tag is read from the stored object's `meta.headers` (the row says which source it used).
    test("(B-ISO) two tenants, same slug: each host gets its own body, S3 key and _N_T_/<host>/about tag", async () => {
        expect("B-ISO");
        const a = await get(ISO_HOST_A, ABOUT_SLUG);
        const b = await get(ISO_HOST_B, ABOUT_SLUG);
        assert.equal(a.status, 200);
        assert.equal(b.status, 200);
        assert.match(titleOf(a.body), new RegExp(ISO_ABOUT_TITLE_A), "host A must get A's page");
        assert.match(titleOf(b.body), new RegExp(ISO_ABOUT_TITLE_B), "host B must get B's page");
        assert.ok(!a.body.includes(ISO_ABOUT_TITLE_B) && !b.body.includes(ISO_ABOUT_TITLE_A), "a body carries the other tenant's text");
        for (const [host, res] of [[ISO_HOST_A, a], [ISO_HOST_B, b]]) {
            const objects = stubs.s3.objects().filter((o) => cacheKeyOf(o.key) === `${host}${ABOUT_SLUG}`);
            assert.equal(objects.length, 1, `exactly one S3 entry for ${host}${ABOUT_SLUG}`);
            const tag = `_N_T_/${host}${ABOUT_SLUG}`;
            const fromClient = res.headers["x-next-cache-tags"];
            const tags = fromClient ?? JSON.parse(objects[0].body).meta?.headers?.["x-next-cache-tags"];
            const source = fromClient ? "response header" : "stored meta.headers (not sent to the client)";
            console.log(`  (B-ISO) ${host}: ${res.headers["x-nextjs-cache"]}, key ${objects[0].key}; tags from ${source}: ${tags}`);
            assert.ok(String(tags).split(",").includes(tag), `${tag} missing from the entry's tags (${source})`);
        }
    });

    // ── B-REFLECT ───────────────────────────────────────────────────────────────────────
    // Spec § 7.4 (cross-tenant reflection through a dotted first segment). After SITEID-BINDING-1
    // the path is A's own (unknown) slug: A answers its not-found handoff, B's content never
    // appears, and nothing new is stored under B's key — the expectation of contract row (h1c),
    // here with two real tenants. Runs after B-ISO, so B's `/about` IS in the cache: the row
    // proves A's request does not read or write it. Same on both majors (spec: "same").
    test("(B-REFLECT) host A, path /<host B>/about → A's 307 ?nf=1, no B content, nothing stored under B's key", async () => {
        expect("B-REFLECT");
        const before = stubs.s3.journal().length;
        const res = await get(ISO_HOST_A, `/${ISO_HOST_B}${ABOUT_SLUG}`);
        const puts = stubs.s3.journal().slice(before).filter((e) => e.op === "PutObject").map((e) => cacheKeyOf(e.key));
        console.log(`  (B-REFLECT) ${res.status} Location ${res.headers.location}; stored: ${puts.join(", ")}`);
        assert.equal(res.status, 307);
        assert.equal(first(res.headers.location), `/${ISO_HOST_B}${ABOUT_SLUG}?nf=1`);
        assert.ok(!res.body.includes(ISO_ABOUT_TITLE_B), "tenant B's content reached host A");
        assert.deepEqual(puts.filter((k) => k.startsWith(ISO_HOST_B)), [], "something was stored under tenant B's key");
        // Positive control: the request did store (A's 307, under A's own key).
        assert.ok(puts.includes(`${ISO_HOST_A}/${ISO_HOST_B}${ABOUT_SLUG}`), "the 307 was not stored under A's key");
    });

    // ── B-TAG ───────────────────────────────────────────────────────────────────────────
    // Spec § 8.1 / § 3.D D4. Does `revalidatePath` on its own (the adapter's tag path) make an
    // edited page fresh? The CACHE-10 purge is NEUTRALIZED for the measurement: the S3 stub
    // answers every ListObjectsV2 with no keys (`listReturnsNothing`), and only the purge lists —
    // the adapter never does (3.1.3 inventory). So freshness here can come only from tag rows.
    // 3.1.3, CHARACTERIZED: `adapters/cache.js` derives tags only for `kind === "PAGE"`; Next 16
    // stores app pages as `APP_PAGE`, so no tag row is ever written; `revalidateTag` finds no path
    // (`getByTag` → nothing) and writes nothing; the next GET is still the old HIT.
    // 4.x entry: tag row present, next GET MISS with the new text.
    // NEGATIVE CONTROL (a), part of every run: the purge switched back on → the same POST
    // deletes the entry and the next GET shows the edit. Proves the switch is what makes the
    // row characterize, not a broken edit or a broken POST.
    test("(B-TAG) revalidatePath alone (purge neutralized): tag rows and freshness per version; purge active → fresh", async () => {
        const exp = expect("B-TAG");
        const editedTitle = "Isolation Tenant A About — edited (B-TAG)";
        const tag = `_N_T_/${ISO_HOST_A}${ABOUT_SLUG}`;
        stubs.s3.listReturnsNothing(true);
        let after;
        let rv;
        let writes;
        let tagRows;
        try {
            const warm = await get(ISO_HOST_A, ABOUT_SLUG); // B-ISO stored it: a HIT
            assert.match(titleOf(warm.body), new RegExp(ISO_ABOUT_TITLE_A));
            editTitle(ISO_TENANT_A, "a-about", editedTitle);
            const ddbBefore = stubs.ddb.journal().length;
            rv = await revalidate(ISO_HOST_A, ABOUT_SLUG);
            after = await get(ISO_HOST_A, ABOUT_SLUG);
            // Read AFTER the next GET: part of the tag work runs after the POST has answered
            // (OBSERVED: two tag-table Queries per POST, one of them after the response).
            const delta = stubs.ddb.journal().slice(ddbBefore);
            writes = delta.filter((e) => e.table === "tag" && e.op === "BatchWriteItem");
            tagRows = stubs.ddb.tagItems().filter((i) => i.tag === tag);
            console.log(
                `  (B-TAG) neutralized: revalidate ${rv.status} purged=${rv.json.purged}; tag-table ops from the POST to the next GET: ` +
                    `${delta.filter((e) => e.table === "tag").map((e) => `${e.op}${e.index ? `@${e.index}` : ""}`).join(", ") || "none"}; ` +
                    `${tag} rows: ${tagRows.length}; next GET ${after.headers["x-nextjs-cache"]} "${titleOf(after.body)}"`,
            );
        } finally {
            stubs.s3.listReturnsNothing(false);
        }
        assert.equal(rv.status, 200);
        assert.equal(rv.json.purged, 0, "the purge was not neutralized (it deleted objects)");
        assert.equal(tagRows.length > 0, exp.tagRowWritten, `tag row ${tag} present`);
        if (!exp.tagRowWritten) assert.deepEqual(writes, [], "a tag-table write happened");
        assert.equal(after.headers["x-nextjs-cache"], exp.afterRevalidate);
        assert.equal(titleOf(after.body).includes(editedTitle), exp.showsEdit, "edit visible after revalidatePath alone");
        // Negative control (a): purge active.
        const rv2 = await revalidate(ISO_HOST_A, ABOUT_SLUG);
        const fresh = await get(ISO_HOST_A, ABOUT_SLUG);
        console.log(`  (B-TAG) control (a) purge active: purged=${rv2.json.purged}; next GET ${fresh.headers["x-nextjs-cache"]} "${titleOf(fresh.body)}"`);
        assert.ok(rv2.json.purged >= 1, "the active purge deleted nothing");
        assert.equal(fresh.headers["x-nextjs-cache"], "MISS");
        assert.ok(titleOf(fresh.body).includes(editedTitle), "control (a): the purge did not make the edit visible");
    });

    // ── B-LISTING ───────────────────────────────────────────────────────────────────────
    // Spec § 8.1 / § 5.3 / E3. A listing (A's home, a `postGrid` block → `getPosts`) is its own
    // cached URL showing another page's data (post P's title). Edit P, POST `/api/revalidate`
    // for P, GET the listing. Variant 2 (purge neutralized) keeps the old title on BOTH majors:
    // the executable form of "`revalidatePath('/<host>','layout')` refreshes no listing" — no tag
    // links the listing to P. Variant 1 (purge active, as deployed): the tenant-wide S3 purge is
    // what refreshes it. Variant 2 runs first so variant 1 also proves recovery.
    test("(B-LISTING) edited post on a listing: purge neutralized → old title; purge active → new title", async () => {
        expect("B-LISTING");
        const v0 = await get(ISO_HOST_A, "/");
        assert.ok(v0.body.includes(LISTED_POST_TITLE), "the listing does not show post P (postGrid fixture broken)");
        await get(ISO_HOST_A, "/"); // stored
        // Edited titles do NOT contain the original as a substring, so "the body contains the
        // original title" is a real observable and not satisfied by an edited listing too.
        const title1 = "Post P renamed once (B-LISTING)";
        const title2 = "Post P renamed twice (B-LISTING)";
        assert.ok(!title1.includes(LISTED_POST_TITLE) && !title2.includes(LISTED_POST_TITLE));
        stubs.s3.listReturnsNothing(true);
        let v2;
        try {
            editTitle(ISO_TENANT_A, "a-post", title1);
            const rv = await revalidate(ISO_HOST_A, LISTED_POST_SLUG);
            assert.equal(rv.json.purged, 0, "the purge was not neutralized");
            v2 = await get(ISO_HOST_A, "/");
        } finally {
            stubs.s3.listReturnsNothing(false);
        }
        editTitle(ISO_TENANT_A, "a-post", title2);
        const rv1 = await revalidate(ISO_HOST_A, LISTED_POST_SLUG);
        const v1 = await get(ISO_HOST_A, "/");
        console.log(
            `  (B-LISTING) v2 (neutralized): ${v2.status} ${v2.headers["x-nextjs-cache"]}, original=${v2.body.includes(LISTED_POST_TITLE)}, edit 1=${v2.body.includes(title1)}; ` +
                `v1 (purge active, purged=${rv1.json.purged}): ${v1.status} ${v1.headers["x-nextjs-cache"]}, edit 2=${v1.body.includes(title2)}, original=${v1.body.includes(LISTED_POST_TITLE)}`,
        );
        // Variant 2 guarantee: a 200 listing still showing the ORIGINAL title (and not the edit).
        assert.equal(v2.status, 200);
        assert.ok(v2.body.includes(LISTED_POST_TITLE), "variant 2: the listing does not show the original title");
        assert.ok(!v2.body.includes(title1), "variant 2: the listing refreshed without the purge");
        // Variant 1 guarantee: a 200 listing showing the new title and no longer the original.
        assert.equal(v1.status, 200);
        assert.ok(v1.body.includes(title2), "variant 1: the purge did not refresh the listing");
        assert.ok(!v1.body.includes(LISTED_POST_TITLE), "variant 1: the listing still shows the original title");
    });

    // ── B-XISR ──────────────────────────────────────────────────────────────────────────
    // Spec § 8.1 / § 3.C C1 / § 5.4. THE PRODUCTION EDGE STRIPS BOTH HEADERS (`x-isr` and
    // `x-prerender-revalidate` are not on the ORP allowlist since 2026-10-13; infra test (h)).
    // This row tests the ORIGIN SIDE of that hole: the Lambda host forwards the two headers for
    // this row only (`forwardViewerHeaders`), i.e. "what if one ever reached the function".
    // 3.1.3, CHARACTERIZED: any `x-isr` value makes `handleMiddleware` skip the middleware
    // (`core/routing/middleware.js:27-28`): no tenant rewrite, no origin check, no preview-host
    // gate. `/published` is rendered as `[siteId]=published` → a cacheable 307 stored under the
    // non-host key `published`; `/_site/<id>` skips the 403 and stores a cacheable 307 under
    // `_site/<id>`. 4.x entry: identical to no header; `/_site` → 403 (the bypass needs the
    // per-build previewModeId, N `core/routing/middleware.js:25-31`).
    // OBSERVED, not in the spec: `/_site/<id>/` WITH a trailing slash is answered by Next's own
    // trailing-slash 308 before any middleware, header or not — so the row uses `/_site/<id>`.
    // "Cold" (spec): the bypass request is the first to touch its key (`published`), whatever
    // earlier rows stored under the tenant's own key.
    test("(B-XISR) x-isr + junk x-prerender-revalidate AT THE ORIGIN (prod edge strips them): bypass per version", async () => {
        const exp = expect("B-XISR");
        const isr = { "x-isr": "1", "x-prerender-revalidate": "serving-bundle-junk-not-the-preview-mode-id" };
        const sitePath = `/_site/${TENANT_ID}`;
        // No-header requests FIRST, so that on 4.x both members of each pair see the same cache
        // state and can be compared field by field (class rule). `/published` is already stored
        // under the tenant's key (B-ORIGINVERIFY rendered it), so `plain` is a HIT.
        const plain = await get(FIXTURE_HOST, PUBLISHED_SLUG);
        const plainSite = await get(FIXTURE_HOST, sitePath);
        const before = stubs.s3.journal().length;
        await server.forwardViewerHeaders(Object.keys(isr));
        let published;
        let site;
        try {
            published = await get(FIXTURE_HOST, PUBLISHED_SLUG, isr);
            site = await get(FIXTURE_HOST, sitePath, isr);
        } finally {
            await server.forwardViewerHeaders([]);
        }
        const stored = stubs.s3.journal().slice(before).filter((e) => e.op === "PutObject").map((e) => ({ key: cacheKeyOf(e.key), status: e.storedStatus }));
        /** The fields the class rule compares. Body marker: the page `<title>`, else the body text. */
        const fields = (r) => ({
            status: r.status,
            cacheControl: r.headers["cache-control"] ?? null,
            cache: r.headers["x-nextjs-cache"] ?? null,
            marker: titleOf(r.body) ?? r.body,
        });
        console.log(
            `  (B-XISR) without: ${PUBLISHED_SLUG} ${JSON.stringify(fields(plain))}; ${sitePath} ${JSON.stringify(fields(plainSite))}. ` +
                `With headers: ${PUBLISHED_SLUG} ${JSON.stringify({ ...fields(published), marker: undefined, location: published.headers.location })}; ` +
                `${sitePath} ${JSON.stringify({ ...fields(site), marker: undefined, location: site.headers.location })}; stored ${JSON.stringify(stored)}`,
        );
        // Controls: without the headers the page renders and the by-id path is refused.
        assert.equal(plain.status, 200);
        assert.equal(plainSite.status, 403);
        if (exp.bypass) {
            for (const [name, res, e] of [[PUBLISHED_SLUG, published, exp.published], [sitePath, site, exp.site]]) {
                assert.equal(res.status, e.status, `${name}: status`);
                assert.equal(res.headers.location, e.location, `${name}: Location`);
                assert.equal(res.headers["x-nextjs-cache"], e.cache, `${name}: x-nextjs-cache`);
                assert.equal(res.headers["cache-control"], e.cacheControl, `${name}: the bypass answer is cacheable`);
                assert.ok(stored.some((x) => x.key === e.storedKey && x.status === e.status), `${name}: nothing stored under "${e.storedKey}"`);
            }
        } else {
            assert.deepEqual(fields(published), fields(plain), `${PUBLISHED_SLUG}: differs from the no-header request`);
            assert.deepEqual(fields(site), fields(plainSite), `${sitePath}: differs from the no-header request (expected the 403)`);
            assert.deepEqual(stored.filter((e) => !e.key?.startsWith(FIXTURE_HOST)), [], "something was stored outside the tenant's key");
        }
    });

    // ── B-RSC ───────────────────────────────────────────────────────────────────────────
    // Spec § 8.1. A client-side navigation is `RSC: 1` plus the router headers, with `_rsc` = the
    // hash Next 16 checks (`server/base-server.js` ~1258-1286: mismatch → 307 to the URL with the
    // right hash). The test computes the hash with Next's OWN function
    // (`next/dist/shared/lib/router/utils/cache-busting-search-param.js`), from the installed Next,
    // so a Next change to the hash cannot desynchronize the row. The state-tree value is a minimal
    // tree for `/`; Next only hashes it. That request → `text/x-component`, `Vary` has `rsc`
    // (as predicted). `?_rsc=x` WITHOUT the header → the HTML entry, HIT (as predicted).
    // OBSERVED, not predicted by the spec (finding F8): a BARE `RSC: 1` (no router headers, any or
    // no `_rsc`) gets a 307 whose Location is the REWRITTEN internal path `/<host>/published?_rsc`
    // — 3.1.3 hands Next the rewritten URL (spec § 3.B B4) and drops the query on a middleware
    // rewrite. 4.x: recorded by opennext-1b.
    test("(B-RSC) RSC navigation → text/x-component + Vary rsc; ?_rsc without RSC header → HTML HIT", async () => {
        const exp = expect("B-RSC");
        const nextRequire = createRequire(path.join(RENDERER_DIR, "package.json"));
        const { computeCacheBustingSearchParam } = nextRequire("next/dist/shared/lib/router/utils/cache-busting-search-param.js");
        await get(FIXTURE_HOST, PUBLISHED_SLUG); // stored (earlier rows rendered it; idempotent)
        const tree = encodeURIComponent(JSON.stringify(["", { children: ["__PAGE__", {}] }, null, null, true]));
        const hash = await computeCacheBustingSearchParam(undefined, undefined, tree, undefined);
        const nav = await get(FIXTURE_HOST, `${PUBLISHED_SLUG}?_rsc=${hash}`, { rsc: "1", "next-router-state-tree": tree });
        const html = await get(FIXTURE_HOST, `${PUBLISHED_SLUG}?_rsc=x`);
        const bare = await get(FIXTURE_HOST, PUBLISHED_SLUG, { rsc: "1" });
        console.log(
            `  (B-RSC) navigation: ${nav.status} ${nav.headers["content-type"]} ${nav.headers["x-nextjs-cache"]} Vary "${nav.headers.vary}"; ` +
                `?_rsc=x: ${html.status} ${html.headers["content-type"]} ${html.headers["x-nextjs-cache"]}; ` +
                `bare RSC: ${bare.status} Location ${bare.headers.location ?? "-"}`,
        );
        assert.equal(nav.status, 200);
        assert.match(String(nav.headers["content-type"]), /^text\/x-component/);
        assert.ok(String(nav.headers.vary).split(/,\s*/).includes("rsc"), "Vary does not include rsc");
        assert.equal(html.status, 200);
        assert.match(String(html.headers["content-type"]), /^text\/html/);
        assert.equal(html.headers["x-nextjs-cache"], "HIT");
        if (exp.bare !== RECORD) {
            assert.equal(bare.status, exp.bare.status);
            assert.equal(bare.headers.location, exp.bare.location);
        }
    });

    // ── B-PREVIEW ───────────────────────────────────────────────────────────────────────
    // Spec § 8.1 / § 3.B B5 / E19. `/_site/<id>` WITHOUT a trailing slash (SITEID-BINDING-1,
    // Correction 1) from a `*.cloudfront.net` host → the preview twin: 200, no-store, and the
    // `amodx_preview_base` cookie. The flight canonical URL is recorded from the RSC payload
    // inlined in the HTML (`"c":[…]`, the segments the client router writes into the address bar
    // — what E19 measures); the response's `x-middleware-rewrite` is logged as well.
    // OBSERVED on 3.1.3: the canonical is `/<id>/_dyn` (B5's 3.1.3 shape; the A2b self-heal in
    // middleware.ts exists for exactly these links). The packet's "(expect no `_dyn`)" is the 4.x
    // prediction (spec B5) — on 3.1.3 the row asserts `_dyn` IS present (contradiction recorded).
    test("(B-PREVIEW) /_site/<id> from a cloudfront.net host → 200 no-store + amodx_preview_base; flight canonical recorded", async () => {
        const exp = expect("B-PREVIEW");
        const res = await get("d111wtnnjzzsb1.cloudfront.net", `/_site/${TENANT_ID}`);
        const canonical = res.body.match(/\\"c\\":\[([^\]]*)\]/)?.[1]?.replace(/\\"/g, '"') ?? null;
        console.log(
            `  (B-PREVIEW) ${res.status} cache-control "${res.headers["cache-control"]}"; set-cookie ${JSON.stringify(res.headers["set-cookie"])}; ` +
                `flight canonical [${canonical}]; x-middleware-rewrite ${res.headers["x-middleware-rewrite"] ?? "-"}`,
        );
        assert.equal(res.status, 200);
        assert.match(String(res.headers["cache-control"]), /no-store/);
        assert.ok([].concat(res.headers["set-cookie"] ?? []).some((c) => c.startsWith("amodx_preview_base=")), "no amodx_preview_base cookie");
        assert.ok(canonical !== null, "no flight canonical URL found in the HTML");
        if (exp.dynCanonical !== RECORD) assert.equal(canonical.includes('"_dyn"'), exp.dynCanonical, "_dyn in the flight canonical URL");
    });

    // ── B-ROUTEERR ──────────────────────────────────────────────────────────────────────
    // Spec § 8.1 / § 3.B B2: what does the adapter do when routing (the middleware step) throws?
    // 3.1.3 catches it ("Routing failed.", `core/requestHandler.js:24-29`) and passes the
    // UNREWRITTEN event to Next; 4.x renders Next's `/500` page (`core/routingHandler.js:209-230`).
    // No product code is touched. Two means, both test-only:
    //
    // (1) `invalidHost` — the packet's means (1), first in its order and VERIFIED working: an
    //     `x-forwarded-host` that is not valid as a URL host (a space). open-next 3.1.3 sets `host`
    //     from XFH and `handleMiddleware` builds `new URL(path, "https://" + host)` → `Invalid
    //     URL`. OBSERVED on 3.1.3: Next then fails on the same host → 500 `Internal Server Error`
    //     (text/plain), NO Cache-Control, nothing stored — so this means cannot show B2's
    //     "unrewritten render". INFERRED from the @opennextjs/aws 4.1.9 source (npm tarball, read
    //     2026-10-15): its catch builds the `/500` event with `constructNextUrl(event.url, "/500")`,
    //     i.e. `new URL` on the same invalid host, which throws again outside any try
    //     (`core/requestHandler.js:52`) → the handler throws (a Function URL 502), not `/500`.
    //     The `"4"` entry nevertheless asserts the `/500` marker, as ruled (operator, 2026-10-15);
    //     DECISION OPENNEXT1A-ROUTEERR-MEANS in the slice doc.
    // (2) `headerValue` — deviation D13: a RAW invocation (no edge: a viewer cannot send this
    //     through CloudFront or any HTTP server) whose `accept-language` value contains a line
    //     feed. The host stays valid; the middleware sandbox's `Headers.append` rejects the value,
    //     so routing throws ("Routing failed. TypeError: Headers.append…"). OBSERVED on 3.1.3:
    //     the unrewritten path renders as `[siteId]=routeerr-probe` → a cacheable 307 `MISS`
    //     stored under the non-host key `routeerr-probe` — exactly the B2 defect. With a valid
    //     host the 4.x catch can build the `/500` event.
    //
    // `/500` marker (4.x, class rule): status 500, Cache-Control containing `no-store`, and a
    // `<title>` equal to the one in the prerendered global-error page of THIS build
    // (`.open-next/cache/<buildId>/_global-error.cache`, the object CDK uploads; today
    // "500: This page couldn’t load"). No tenant page and no plain-text 500 carries that title.
    test("(B-ROUTEERR) routing throws: (1) invalid XFH host, (2) invalid header value — answer per version, what is stored", async () => {
        const exp = expect("B-ROUTEERR");
        // (1) through the edge
        const badHost = "fixture serving-contract.test"; // a space: not a valid URL host
        let before = stubs.s3.journal().length;
        let logBefore = server.log().length;
        const r1 = await get(badHost, PUBLISHED_SLUG);
        const stored1 = stubs.s3.journal().slice(before).filter((e) => e.op === "PutObject").map((e) => cacheKeyOf(e.key));
        const log1 = server.log().slice(logBefore);
        // (2) raw invocation, valid host, the edge's secret (else the origin check answers 403)
        before = stubs.s3.journal().length;
        logBefore = server.log().length;
        const raw = await server.invoke(toFunctionUrlEvent({
            method: "GET",
            url: "/routeerr-probe",
            headers: {
                "x-forwarded-host": FIXTURE_HOST,
                "x-origin-verify": BUNDLE_FIXTURE.originVerifySecret,
                "accept-language": "en\nx-serving-bundle: 1",
            },
        }));
        const stored2 = stubs.s3.journal().slice(before).filter((e) => e.op === "PutObject").map((e) => cacheKeyOf(e.key));
        const log2 = server.log().slice(logBefore);
        const r2 = {
            status: raw.statusCode,
            headers: raw.headers ?? {},
            body: Buffer.from(raw.body ?? "", raw.isBase64Encoded ? "base64" : "utf8").toString("utf8"),
        };
        const routingFailed = (log) => (log.match(/Routing failed[^\n]*|Error in routingHandler[^\n]*/) ?? ["-"])[0];
        console.log(
            `  (B-ROUTEERR) (1) XFH "${badHost}": ${r1.status} ${r1.headers["content-type"]} cache-control ${r1.headers["cache-control"] ?? "(absent)"}, ` +
                `body "${r1.body.slice(0, 40)}"; stored ${JSON.stringify(stored1)}; log: ${routingFailed(log1)}\n` +
                `  (B-ROUTEERR) (2) raw, LF in accept-language: ${r2.status} cache-control ${r2.headers["cache-control"] ?? "(absent)"} ` +
                `${r2.headers["x-nextjs-cache"] ?? "-"} Location ${r2.headers.location ?? "-"} title "${titleOf(r2.body)}"; stored ${JSON.stringify(stored2)}; log: ${routingFailed(log2)}`,
        );
        // Both means must make ROUTING throw — else the row measures something else.
        assert.match(log1, /Routing failed|Error in routingHandler/, "(1) did not make routing throw");
        assert.match(log2, /Routing failed|Error in routingHandler/, "(2) did not make routing throw");
        if (exp.headerValue === "500-page") {
            // 4.x. (2) carries the `/500` contract; (1) is characterized (ruling OPENNEXT1A-ROUTEERR-MEANS):
            // its status is logged above and NOT asserted until opennext-1b pins the observed value —
            // only "routing threw" (asserted for both above) and "nothing stored" hold for (1).
            const marker = await globalErrorTitle();
            assert.equal(r2.status, 500, "(2) status");
            assert.match(String(r2.headers["cache-control"]), /no-store/, "(2) Cache-Control");
            assert.equal(titleOf(r2.body), marker, "(2) is not Next's /500 page");
            assert.deepEqual(stored2, [], "(2) stored something");
            assert.deepEqual(stored1, [], "(1) stored something");
            if (exp.invalidHost !== "characterize") assert.fail(`unexpected 4.x entry for (1): ${exp.invalidHost}`);
        } else {
            const e1 = exp.invalidHost;
            assert.equal(r1.status, e1.status);
            assert.equal(r1.headers["cache-control"] ?? null, e1.cacheControl);
            assert.match(String(r1.headers["content-type"]), new RegExp(`^${e1.contentType}`));
            assert.equal(r1.body, e1.body);
            assert.deepEqual(stored1, e1.stored, "(1) stored something");
            const e2 = exp.headerValue;
            assert.equal(r2.status, e2.status);
            assert.equal(r2.headers["cache-control"] ?? null, e2.cacheControl);
            assert.equal(r2.headers["x-nextjs-cache"], e2.cache);
            assert.equal(r2.headers.location, e2.location);
            assert.deepEqual(stored2, e2.stored, "(2) the unrewritten render was not stored under the non-host key");
        }
    });

    // ── B-CASE ──────────────────────────────────────────────────────────────────────────
    // Spec § 8.1 / E20. Outbound-call interceptor: outbound-shim.cjs in the Lambda host child
    // journals every outbound call (`server.outbound()`) and refuses it locally.
    // The packet's request — mixed-case XFH `Fixture.Serving-Contract.TEST` on `/tenant/<id>` —
    // is OBSERVED to answer 403 with no outbound call on 3.1.3: since SITEID-BINDING-1 `/tenant/`
    // has the preview-host gate, and the fixture host is not a preview host (the spec row
    // predates that gate). It is asserted as observed.
    // REACH VARIANT (added — deviation D6 in the slice doc): the defect E20 is about needs a host
    // that PASSES the gate and is mixed-case: `MixedCase.staging.serving-contract.test` (contains
    // `staging`, `.test` TLD). The middleware rewrites to `https://mixedcase.staging…/<id>/_dyn`
    // (URL parsing lowercases the host); 3.1.3 `isExternal` compares with a case-sensitive
    // `includes` against the mixed-case host (`core/routing/util.js:12-20`) → "external" →
    // `proxyRequest` → an outbound HTTPS request (in production: back through CloudFront, a
    // second invocation). Here it is refused; 3.1.3 `proxyRequest` attaches no `error` listener
    // (`util.js:188-223`), so the handler never answers — the row bounds the wait (3 s) and
    // asserts the journaled call. 4.x entry: no outbound call.
    test("(B-CASE) mixed-case XFH: the packet request makes no outbound call; the reach variant per version", async () => {
        const exp = expect("B-CASE");
        await server.sync();
        const before = server.outbound().length;
        const packet = await get("Fixture.Serving-Contract.TEST", `/tenant/${TENANT_ID}`);
        await server.sync();
        const packetCalls = server.outbound().slice(before);
        let reach;
        try {
            const r = await get("MixedCase.staging.serving-contract.test", `/tenant/${TENANT_ID}`, {}, { timeoutMs: 3000 });
            reach = `${r.status}`;
        } catch (e) {
            reach = e.code ?? e.message;
        }
        await server.sync();
        const reachCalls = server.outbound().slice(before + packetCalls.length);
        console.log(
            `  (B-CASE) packet request: ${packet.status}, outbound ${packetCalls.length}; reach variant: ${reach}, ` +
                `outbound ${JSON.stringify(reachCalls.map((c) => `${c.api} ${c.method} ${c.url}`))}`,
        );
        assert.equal(packet.status, 403, "the by-id host gate did not answer the packet request");
        assert.deepEqual(packetCalls, [], "the packet request made an outbound call");
        if (exp.reachOutbound) {
            assert.deepEqual(
                reachCalls.map((c) => `${c.api} ${c.url}`),
                [`https.request https://mixedcase.staging.serving-contract.test/${TENANT_ID}/_dyn`],
                "the case-sensitive isExternal did not proxy",
            );
        } else {
            assert.deepEqual(reachCalls, [], "an outbound call was attempted");
        }
    });

    // ── D3-LOCATION ─────────────────────────────────────────────────────────────────────
    // Finding F1 (doubled `Location` on a MISS-rendered 307, observed on staging and prod). Where
    // does the doubling happen? The row reads the value at two layers: the handler's own result
    // (`bundleResponses`, before any HTTP serialization) and the header LINES on the wire
    // (`rawHeaders`). OBSERVED on 3.1.3: the handler result already carries ONE string with the
    // value twice, comma-joined, and the wire has one `Location` line — so the doubling is inside
    // the adapter/Next response handling, NOT in the Function URL or CloudFront layer. The HIT
    // (from the stored entry) carries it once.
    test("(D3-LOCATION) MISS-rendered not-found 307: the Location value at the handler and on the wire", async () => {
        const exp = expect("D3-LOCATION");
        const miss = await get(FIXTURE_HOST, MISSING_SLUG);
        await server.sync();
        const handler = bundleResponses.findLast((r) => r.via === "edge" && r.url === MISSING_SLUG);
        const lines = miss.rawHeaders.filter((_, i) => i % 2 === 0).filter((n) => n.toLowerCase() === "location").length;
        const hit = await get(FIXTURE_HOST, MISSING_SLUG);
        console.log(
            `  (D3-LOCATION) MISS ${miss.status} ${miss.headers["x-nextjs-cache"]}: handler location ${JSON.stringify(handler.headers.location)}, ` +
                `${lines} Location line(s) on the wire "${miss.headers.location}"; HIT "${hit.headers.location}"`,
        );
        assert.equal(miss.status, 307);
        assert.equal(miss.headers["x-nextjs-cache"], "MISS", "not a MISS — the path was rendered earlier in this host");
        assert.equal(hit.headers.location, `${MISSING_SLUG}?nf=1`, "the HIT (stored entry) carries one Location");
        if (exp !== RECORD) {
            assert.equal(handler.headers.location, exp.location, "handler result");
            assert.equal(lines, 1, "Location lines on the wire");
            assert.equal(miss.headers.location, exp.location);
        }
    });

    // ── B-STALE ─────────────────────────────────────────────────────────────────────────
    // Spec § 8.1 / § 5.6 (#1250). A page rendered by a warm container, read by a COLD one
    // (`restart()`), is served STALE: 3.1.3 writes the patched window `s-maxage=2,
    // stale-while-revalidate=300` (cache-8 patch, `fixISRHeaders`) and enqueues ONE SQS message.
    // NEGATIVE CONTROL (b), part of every run: the same GET BEFORE the restart is a HIT — so the
    // STALE comes from the cold container, not from the entry. `/published` was rendered earlier
    // in this host (B-ORIGINVERIFY, B-XISR, B-RSC). The message is kept for B-REVAL.
    // 4.x: two entries (`4-noseed` / `4-seed`), opennext-1b selects (decision OPENNEXT1-1250).
    test("(B-STALE) cold container on a page rendered before restart: cache state, Cache-Control, SQS messages", async () => {
        const exp = expect("B-STALE");
        const warm = await get(FIXTURE_HOST, PUBLISHED_SLUG);
        assert.equal(warm.headers["x-nextjs-cache"], "HIT", "control (b): the warm container must answer HIT");
        await server.restart();
        const before = stubs.sqs.journal().length;
        const cold = await get(FIXTURE_HOST, PUBLISHED_SLUG);
        const count = (await settle(() => stubs.sqs.journal().length, before + exp.sqsMessages)) - before;
        const messages = stubs.sqs.journal().slice(before);
        console.log(
            `  (B-STALE) warm ${warm.headers["x-nextjs-cache"]}; cold ${cold.headers["x-nextjs-cache"]} ` +
                `cache-control "${cold.headers["cache-control"] ?? "(absent)"}"; SQS ${count}: ${JSON.stringify(messages)}`,
        );
        assert.equal(warm.status, 200);
        assert.equal(cold.status, 200);
        assert.equal(cold.headers["x-nextjs-cache"], exp.cache);
        assert.equal(cold.headers["cache-control"] ?? null, exp.cacheControl);
        assert.equal(count, exp.sqsMessages, "SQS SendMessage count");
        staleMessage = messages[0];
    });

    // ── B-REVAL ─────────────────────────────────────────────────────────────────────────
    // Spec § 8.1 / § 5.4 / E6. B-STALE's queued message, fed to the built REVALIDATION function
    // (lambda-host.mjs `runRevalidationFunction`) as an SQS event. The function sends
    // `HEAD https://<host><url>` with `x-prerender-revalidate: <previewModeId>` and `x-isr: 1`
    // (3.1.3 `adapters/revalidate.js:22-27`, a `node:https` request); outbound-shim.cjs delivers it
    // to the Lambda host's HTTP port, i.e. THROUGH THE EMULATED EDGE, as production sends it
    // through CloudFront — which strips both headers (not on the ORP).
    // 3.1.3 OBSERVED: the queued URL is the REWRITTEN path `/<host>/published` (TECH-DEBT
    // "background revalidation HEAD and the doubled path"); after SITEID-BINDING-1 the host's own
    // tenant answers it as an unknown slug: a cacheable 307 MISS, not `REVALIDATED`; the function
    // reports the record as failed (`batchItemFailures`). Every version entry ASSERTS its success
    // rule against the host's actual answer (3.1.3: 200 + `REVALIDATED`; 4.x, spec E6 / § 3.G G4:
    // 200/307/308/404 + `REVALIDATED` — a junk 307 counts as success only with `REVALIDATED`);
    // the 3.x entry also pins the observed answer. Message source: ruling OPENNEXT1A-SEED-REVAL
    // (in the row).
    // NEGATIVE CONTROL (c) (not part of every run — it would make a real DNS query): with the
    // redirect off, the HEAD fails to connect (EXECUTED once; slice doc § Increment 1A-2).
    test("(B-REVAL) the revalidation function's HEAD reaches the host through the edge; result per the version's rule", async () => {
        const exp = expect("B-REVAL");
        // Message source (ruling OPENNEXT1A-SEED-REVAL): B-STALE's journaled message wherever
        // B-STALE's expectation is a queued message (3.x, 4.x `4-noseed`); otherwise (4.x
        // `4-seed`, "0 messages") the 3.1.3-shaped fixture. Decided by the expectation, not by
        // whether a message happens to exist, so a missing 3.x message fails instead of silently
        // falling back. ON THE FIXTURE BRANCH this row proves the FUNCTION's contract (HEAD with
        // `x-prerender-revalidate`, batch-item result), not the queue emission.
        const fromQueue = expect("B-STALE").sqsMessages > 0;
        const message = fromQueue ? staleMessage : REVALIDATION_MESSAGE_3_1_3;
        const source = fromQueue ? "B-STALE journal" : "fixture REVALIDATION_MESSAGE_3_1_3";
        assert.ok(message, `no message from ${source} (B-STALE must run first)`);
        const { host, url } = JSON.parse(message.body);
        const event = {
            Records: [{
                messageId: "serving-bundle-reval-1",
                receiptHandle: "serving-bundle-receipt",
                body: message.body,
                attributes: { MessageGroupId: message.groupId, MessageDeduplicationId: message.deduplicationId },
                messageAttributes: {},
                eventSource: "aws:sqs",
                eventSourceARN: `arn:aws:sqs:eu-central-1:000000000000:${BUNDLE_FIXTURE.queueName}`,
                awsRegion: "eu-central-1",
            }],
        };
        const { preview } = JSON.parse(await readFile(path.join(REVALIDATION_FUNCTION_DIR, "prerender-manifest.json"), "utf8"));
        await server.sync();
        const reqBefore = server.requests().length;
        const run = await runRevalidationFunction({
            functionDir: REVALIDATION_FUNCTION_DIR,
            event,
            redirectTo: `http://127.0.0.1:${server.port}`,
        });
        await server.sync();
        const heads = server.requests().slice(reqBefore).filter((r) => r.method === "HEAD");
        const answered = bundleResponses.findLast((r) => r.via === "edge" && r.method === "HEAD" && r.url === url);
        console.log(
            `  (B-REVAL) source ${source}: ${message.body}; function outbound ${JSON.stringify(run.outbound.map((c) => `${c.method} ${c.url}`))}; ` +
                `host got ${heads.length} HEAD (viewer headers ${JSON.stringify(heads[0]?.viewerHeaders)}; forwarded ${JSON.stringify(heads[0]?.forwardedHeaders)}); ` +
                `answered ${answered?.status} ${answered?.headers["x-nextjs-cache"]} Location ${answered?.headers.location}; result ${JSON.stringify(run.result)}`,
        );
        assert.equal(heads.length, 1, "the host did not receive exactly one HEAD");
        assert.equal(heads[0].url, url);
        assert.equal(heads[0].viewerHeaders.host, host);
        assert.equal(heads[0].viewerHeaders["x-prerender-revalidate"], preview.previewModeId, "the HEAD did not carry the build's previewModeId");
        assert.equal(heads[0].viewerHeaders["x-isr"], "1");
        assert.ok(!heads[0].forwardedHeaders.includes("x-prerender-revalidate"), "the edge forwarded x-prerender-revalidate (prod does not)");
        assert.ok(answered, "no handler result for the HEAD");
        // The version's success rule, applied to the host's actual answer, decides the result.
        const revalidated = exp.successStatuses.includes(answered.status) && answered.headers["x-nextjs-cache"] === "REVALIDATED";
        assert.equal(run.result.type, "revalidate");
        assert.deepEqual(
            run.result.batchItemFailures,
            revalidated ? [] : [{ itemIdentifier: "serving-bundle-reval-1" }],
            `answer ${answered.status} ${answered.headers["x-nextjs-cache"]}: the function must report ${revalidated ? "success" : "a batch-item failure"}`,
        );
        if (exp.pinned) {
            assert.equal(answered.status, exp.pinned.hostStatus);
            assert.equal(answered.headers["x-nextjs-cache"], exp.pinned.cache);
            assert.equal(run.result.batchItemFailures.length, exp.pinned.failedRecords);
        }
    });

    // ── B-LEAK ──────────────────────────────────────────────────────────────────────────
    // Spec § 8.1 / § 3.C C3. Over EVERY handler result of the run (`bundleResponses`, as
    // B-NO30D): do the middleware's internal response headers reach the client?
    // 3.1.3 CHARACTERIZED: `handleMiddleware` copies every middleware response header except
    // `x-middleware-override-headers` (`core/routing/middleware.js:72-89`); OBSERVED offenders
    // listed by header name (counts logged). 4.x: none. Last but one: it must see every row's
    // responses.
    test("(B-LEAK) x-middleware-rewrite / -next / -set-cookie in client responses, per version", async () => {
        const exp = expect("B-LEAK");
        await server.sync();
        const LEAK = ["x-middleware-rewrite", "x-middleware-next", "x-middleware-set-cookie"];
        const byName = {};
        for (const r of bundleResponses) {
            for (const k of Object.keys(r.headers)) {
                const name = k.toLowerCase();
                if (LEAK.includes(name)) (byName[name] ??= []).push(`${r.status} ${r.host ?? ""}${r.url}`);
            }
        }
        console.log(
            `  (B-LEAK) ${bundleResponses.length} responses: ` +
                Object.entries(byName).map(([k, v]) => `${k} ×${v.length} (e.g. ${v[0]})`).join("; "),
        );
        assert.deepEqual(Object.keys(byName).sort(), [...exp.leaked].sort());
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
    // THE STALE PATH IS COVERED (increment 1A-2). `fixISRHeaders` writes the SWR window only on a
    // STALE response; B-STALE produces one (a cold container, `restart()`), and its result is in
    // the record this row scans — so the live handler's patched window is proven here, not only
    // grepped. Positive control below: the record must hold a STALE response; without it (B-STALE
    // removed or reordered after this row) this row fails instead of passing on MISS/HIT alone.
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
        // Only where B-STALE's own expectation is a STALE response (3.x; 4.x "noseed"): a 4.x
        // "seed" bundle answers HIT and has no STALE path to cover.
        if (expect("B-STALE").cache === "STALE") {
            assert.ok(
                edge.some((r) => r.headers["x-nextjs-cache"] === "STALE"),
                "no STALE response in the record — B-STALE must run before this row (the SWR window is only written on STALE)",
            );
        }
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
