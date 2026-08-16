// Build/serve harness for the serving-contract suite (slice test-2).
//
// Reproduces, as committed code, the recipe documented in
// docs/caching-architecture.md § "Measured serving behaviour": `next build` + `next start`
// with `AWS_ENDPOINT_URL_DYNAMODB` pointed at a local stub.
//
// ── HERMETIC BY CONSTRUCTION (revision 1) ───────────────────────────────────────────────
// The child processes get a CONSTRUCTED environment, not an inherited one. `rendererEnv()`
// below is the complete list of variables `next build` / `next start` will see; nothing
// leaks in from the operator's shell, and nothing is read from a `.env*` file.
//
//   1. No `...process.env`. Only the four OS variables in `OS_PASSTHROUGH` cross over.
//      An ambient `AWS_PROFILE`, `AWS_SESSION_TOKEN`, `AMODX_API_KEY`, `NEXTAUTH_SECRET`
//      or CI secret cannot reach the renderer, so the suite cannot accidentally exercise a
//      credentialed path and pass for the wrong reason.
//   2. `.env*` is invisible at the `fs` layer to EVERY process in the tree — `no-dotenv.cjs`
//      is delivered through `NODE_OPTIONS`, which is inherited by spawned processes and
//      worker threads alike (revision 2; an argv `--require` is not — see `no-dotenv.cjs`
//      § DELIVERY). `__NEXT_PROCESSED_ENV=true` independently stops `@next/env` from merging
//      anything it might still find. Both are documented in `no-dotenv.cjs` and proven live
//      by `(iso1)`–`(iso4)` in contract.test.mjs — `(iso3)` reads the preload's own journal
//      back out of the REAL `next build` / `next start` trees. MEASURED 2026-07-28: without
//      them, `renderer/.env.local`'s seven keys — including the real `AMODX_API_KEY` and a
//      real `TABLE_NAME` — entered the child.
//   3. `AWS_ENDPOINT_URL_DYNAMODB` addresses 127.0.0.1, so no SDK call can leave the host.
//      `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are fixed literals: the SDK needs *some*
//      credentials to sign (middleware's edge runtime has no provider chain — measured, see
//      lib/tenant-directory.ts) and the stub ignores signatures.
//   4. `NEXT_TELEMETRY_DISABLED=1`: the build makes no outbound request either.
//
// The suite is also self-evidencing on the point: a renderer talking to a real table would
// find no fixture tenant and every assertion would go red.
//
// `next` is invoked as `node <resolved next bin>` rather than through `npx`, so the child is
// a plain Node process we fully control — that is what makes the four-entry
// PATH/HOME/TMPDIR/CI environment sufficient. `npx` needs a much larger ambient environment
// and would resolve the binary over the network on a cache miss.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import http from "node:http";
import { rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { TABLE_NAME } from "./fixtures.mjs";

const require = createRequire(import.meta.url);

export const RENDERER_DIR = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const NO_DOTENV_PRELOAD = fileURLToPath(new URL("./no-dotenv.cjs", import.meta.url));

/** The `next` CLI entry point. `bin: { next: "./dist/bin/next" }` in next/package.json. */
const NEXT_BIN = require.resolve("next/dist/bin/next");

/**
 * `@next/env`, resolved from `next`'s own location rather than from here.
 *
 * It is a dependency of `next`, not of `renderer`, so resolving it from this file would rely
 * on npm having hoisted it to the workspace root — true today, not guaranteed. Resolving it
 * through `next` is guaranteed by `next`'s own package.json, and guarantees `(iso2)` probes
 * the same copy the renderer children load.
 */
const NEXT_ENV = createRequire(NEXT_BIN).resolve("@next/env");

/**
 * The ONLY variables inherited from the operator's shell.
 *
 * `PATH` and `HOME`: the SWC/Turbopack native toolchain resolves its cache under `$HOME`.
 * `TMPDIR`: Next writes build scratch there. `CI`: Next suppresses interactive output.
 * Everything else is constructed. Adding an entry here widens what a test run can see —
 * justify it in the review, and never add a name that could carry a credential.
 */
const OS_PASSTHROUGH = ["PATH", "HOME", "TMPDIR", "CI"];

/**
 * Where `no-dotenv.cjs` records, from inside every process it loads in, that the process is
 * covered and what `.env*` accesses it blocked. Read back by `(iso3)`.
 *
 * Outside the repo (a fixture file inside `renderer/` would be swept into the build's file
 * tracing) and named after the test-runner PID so two concurrent runs cannot share one.
 */
export const AUDIT_PATH = path.join(os.tmpdir(), `amodx-serving-contract-dotenv-${process.pid}.jsonl`);

/** Truncate the journal. Called once, before the first spawn. */
export const resetAudit = () => writeFile(AUDIT_PATH, "");

/** The journal as records, oldest first. Missing file → `[]` (i.e. nothing was covered). */
export async function readAudit() {
    let raw;
    try {
        raw = await readFile(AUDIT_PATH, "utf8");
    } catch {
        return [];
    }
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/**
 * The complete environment of both child processes. Exported so `(iso1)` can assert its
 * shape and `(iso2)`/`(iso4)` can re-run Next's own env loader under exactly these
 * conditions.
 *
 * `NODE_OPTIONS` is how the `.env*` hook reaches the WHOLE process tree rather than only the
 * process we spawn: the environment is inherited by every child and every worker thread,
 * while an argv `--require` is dropped by any `fork()` that passes its own `execArgv` — which
 * is exactly what Next's build workers do. Quoted because this repo's checkout path contains
 * a space. Rationale and the measurements behind it: `no-dotenv.cjs` § DELIVERY.
 */
export function rendererEnv(stubUrl) {
    const env = {};
    for (const key of OS_PASSTHROUGH) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return {
        ...env,
        NODE_OPTIONS: `--require ${JSON.stringify(NO_DOTENV_PRELOAD)}`,
        AMODX_DOTENV_AUDIT: AUDIT_PATH,
        // See the header, mechanism 2. `no-dotenv.cjs` explains what this guard does.
        __NEXT_PROCESSED_ENV: "true",
        NEXT_TELEMETRY_DISABLED: "1",
        TABLE_NAME,
        AWS_REGION: "eu-central-1",
        AWS_ACCESS_KEY_ID: "serving-contract-fake",
        AWS_SECRET_ACCESS_KEY: "serving-contract-fake",
        AWS_ENDPOINT_URL_DYNAMODB: stubUrl,
        // Disables middleware's origin check (there is no CloudFront in front of us).
        ORIGIN_VERIFY_SECRET: "",
        // Empty, not unset: keeps layout.tsx from calling hasActivePopups(). NEXT_PUBLIC_*
        // is inlined at BUILD time, so this must be identical in both phases.
        NEXT_PUBLIC_API_URL: "",
        // Present so the twin's session-token decode path is exercisable; the suite never
        // mints a valid JWT, so an unverifiable cookie stays unauthenticated.
        NEXTAUTH_SECRET: "serving-contract-test-secret",
        RECAPTCHA_SITE_KEY: "",
    };
}

/**
 * `next build` / `next start`, as a plain Node child with `.env*` hidden from it.
 *
 * No `--require` on argv: the preload travels in `NODE_OPTIONS` (see `rendererEnv`) so that
 * it covers the processes Next itself spawns, not just this one. Passing it here as well
 * would work for this process but would hide, from anyone reading the code, that argv is the
 * delivery path that does NOT propagate.
 */
function spawnNext(args, stubUrl) {
    return spawn(process.execPath, [NEXT_BIN, ...args], {
        cwd: RENDERER_DIR,
        env: rendererEnv(stubUrl),
        stdio: ["ignore", "pipe", "pipe"],
    });
}

/**
 * Rebuilds the renderer from scratch.
 *
 * `.next` is removed first, not merely overwritten: `next start` persists on-demand ISR
 * entries under it, and a leftover entry from a previous run would answer the suite's very
 * first request with `x-nextjs-cache: HIT` — silently voiding the MISS→HIT row.
 *
 * Returns the build's own log and PID: `(iso3)` asserts against both — the log because
 * `next build` reports the env files it loaded itself (`- Environments: …`, from
 * `next/dist/build/index.js` via `server/lib/app-info-log.js`), which is a first-party
 * statement independent of our preload; the PID because the audit journal identifies the
 * processes the build spawned by their parent.
 */
export async function buildRenderer(stubUrl) {
    // maxRetries: fs.rm can throw ENOTEMPTY on the deep symlinked trees open-next
    // build emits into .next/standalone (hit 2026-08-16 when verify-opennext-patch
    // ran before this suite); Node's documented remedy is built-in retry.
    await rm(path.join(RENDERER_DIR, ".next"), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return new Promise((resolve, reject) => {
        const child = spawnNext(["build"], stubUrl);
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        child.on("close", (code) =>
            code === 0 ? resolve({ log: out, pid: child.pid }) : reject(new Error(`next build exited ${code}\n${out}`)),
        );
    });
}

/** Reserves an ephemeral port and releases it. `next start` has no `--port 0` mode. */
async function freePort() {
    const s = createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    return port;
}

/** Starts `next start` on an ephemeral port and waits until it answers. */
export async function startRenderer(stubUrl) {
    const port = await freePort();
    const child = spawnNext(["start", "-p", String(port)], stubUrl);
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));

    const deadline = Date.now() + 60_000;
    for (;;) {
        if (child.exitCode !== null) throw new Error(`next start exited ${child.exitCode}\n${log}`);
        try {
            await request({ port, path: "/__ready", host: "127.0.0.1" });
            break;
        } catch {
            if (Date.now() > deadline) throw new Error(`next start did not become ready\n${log}`);
            await new Promise((r) => setTimeout(r, 250));
        }
    }

    return {
        port,
        pid: child.pid,
        close: () =>
            new Promise((resolve) => {
                child.once("close", resolve);
                child.kill("SIGTERM");
            }),
    };
}

/**
 * Runs Next's own env loader in a throwaway process under the suite's exact conditions and
 * reports what it managed to load. The executable proof behind `(iso2)` and `(iso4)`.
 *
 * It calls the same `@next/env#loadEnvConfig` that `next build` and `next start` call, so a
 * future Next upgrade that changes the loading mechanism fails the suite instead of silently
 * re-admitting the operator's `.env.local`.
 *
 * @param stubUrl        the DynamoDB stub URL, so the child gets the suite's real environment
 * @param options.dir    project dir to load from. Defaults to `renderer/`; `(iso4)`'s positive
 *                       control points it at a throwaway directory holding a decoy
 *                       `.env.local`, to prove `loadedEnvFiles` is a live signal and not a
 *                       field that quietly stopped being populated.
 * @param options.viaGrandchild
 *                       when true, `loadEnvConfig` runs one hop deeper, in a process the
 *                       probe child launches itself with an explicit argument vector and an
 *                       inherited environment. That is the shape of a Next build worker
 *                       (`next/dist/lib/worker.js:98-107` forks jest-worker with
 *                       `execArgv: []`), and it is the shape that DROPS an argv `--require` —
 *                       so this exercises the delivery mechanism transitively, not just the
 *                       `fs` hook. `execArgv` is not a `spawn` option at all, which makes
 *                       this if anything a stricter case than `fork(..., {execArgv: []})`:
 *                       there is no path by which the parent's flags could reach it.
 * @returns {Promise<{loadedEnvFiles: string[], gainedKeys: string[]}>}
 */
export function probeEnvLoading(stubUrl, { dir = RENDERER_DIR, viaGrandchild = false } = {}) {
    const report = `
        const { loadEnvConfig } = require(${JSON.stringify(NEXT_ENV)});
        const before = new Set(Object.keys(process.env));
        const silent = { error() {}, warn() {}, info() {} };
        const r = loadEnvConfig(${JSON.stringify(dir)}, false, silent);
        process.stdout.write(JSON.stringify({
            loadedEnvFiles: r.loadedEnvFiles.map((f) => f.path),
            gainedKeys: Object.keys(process.env).filter((k) => !before.has(k)),
        }));
    `;
    // `stdio: "inherit"` hands the grandchild the same pipe, so its report arrives on the
    // stdout this promise already reads; its exit code becomes the child's.
    const script = viaGrandchild
        ? `require("node:child_process")
               .spawn(process.execPath, ["-e", ${JSON.stringify(report)}],
                      { env: process.env, stdio: "inherit" })
               .on("close", (c) => process.exit(c));`
        : report;

    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["-e", script], {
            cwd: RENDERER_DIR,
            env: rendererEnv(stubUrl),
            stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("close", (code) =>
            code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`env probe exited ${code}\n${err}`)),
        );
    });
}

/**
 * One HTTP request against the renderer.
 *
 * `node:http` rather than `fetch`: undici treats `Host` as a forbidden header, and the
 * whole production-mode branch of middleware.ts keys off `Host`/`x-forwarded-host`.
 * Redirects are never followed — the 307→404 handoff is itself a contract row.
 */
export function request({ port, path: reqPath, host, headers = {}, method = "GET" }) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host: "127.0.0.1", port, path: reqPath, method, headers: { host, ...headers } },
            (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () =>
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString("utf8"),
                        header: (n) => res.headers[n.toLowerCase()],
                    }),
                );
            },
        );
        req.on("error", reject);
        req.end();
    });
}
