// CJS preload for EVERY Node process the serving-contract suite's renderer children spawn.
// Delivered through `NODE_OPTIONS`, not through argv — see DELIVERY below. Slice test-2.
//
// WHY THIS EXISTS
// The slice's hard constraint is that the suite reads no `.env*` file. Next.js loads them
// unconditionally: `@next/env`'s `loadEnvConfig(dir, dev)` walks `.env.<mode>.local`,
// `.env.local`, `.env.<mode>`, `.env` under the project dir and merges anything it finds
// into `process.env`. `renderer/.env.local` exists on the operator's machine and carries a
// real secret (`AMODX_API_KEY`) plus a real `TABLE_NAME` — MEASURED 2026-07-28: without a
// suppression mechanism, `loadEnvConfig` injected all seven of its keys into the child.
//
// WHAT IT DOES
// Makes exactly `<renderer>/.env*` invisible at the `fs` layer, so `loadEnvConfig` takes its
// `ENOENT` branch — the branch it already takes on any checkout without those files, and the
// only branch CI ever sees. Nothing is created, moved or deleted; the operator's file is
// untouched and every other path on the filesystem behaves normally.
//
// WHY `statSync`/`readFileSync` SPECIFICALLY (verified against @next/env 16.2.12,
// node_modules/@next/env/dist/index.js, and the copy bundled into
// next/dist/compiled/next-server/server.runtime.prod.js):
//
//     for (const envFile of dotenvFiles) {
//       const p = path.join(dir, envFile)
//       try {
//         const st = fs.statSync(p)                    // <- patched: throws ENOENT
//         if (!st.isFile() && !st.isFIFO()) continue
//         const contents = fs.readFileSync(p, 'utf8')  // <- patched, defence in depth
//         loadedEnvFiles.push({ path: envFile, contents, env: {} })
//       } catch (e) { if (e.code !== 'ENOENT') log.error(...) }   // <- silent on ENOENT
//     }
//
// Those are synchronous calls resolved as properties of the `fs` module object at call time
// (the bundle calls `e.statSync(p)` where `e = require('fs')`), so replacing the properties
// is sufficient. `fs.promises` is deliberately NOT patched: no async read path exists in this
// loader, and patching what is not called would be an unverified claim.
//
// ── DELIVERY: `NODE_OPTIONS`, NOT `--require` ON ARGV (revision 2) ─────────────────────────
// Revision 1 passed `--require <this file>` as an argv flag to the top-level `next` process
// only. MEASURED 2026-07-28, that does not reach the processes `next build` spawns:
//
//     next/dist/lib/worker.js:98-107   new jest-worker Worker(..., forkOptions: {
//                                        execArgv: [...execArgv, ...],   // <- REPLACED
//                                        env: workerEnv })               // <- inherited
//
// `child_process.fork` inherits the parent's `process.execArgv` ONLY when `execArgv` is not
// given; jest-worker is always given one, so the parent's `--require` is dropped. Confirmed
// directly, outside Next:
//
//     node --require pre.cjs parent.cjs   -> fork(child, {execArgv: []})  : NOT preloaded
//     NODE_OPTIONS='--require "pre.cjs"'  -> fork(child, {execArgv: []})  : preloaded
//     NODE_OPTIONS='--require "pre.cjs"'  -> new Worker(child, {execArgv: []}) : preloaded
//
// `NODE_OPTIONS` rides in the environment, and the environment is inherited by every child
// process and every worker thread. Next rewrites the variable for its workers
// (`worker.js:84`, `NODE_OPTIONS: formattedNodeOptions`) but derives the new value from
// `[...process.execArgv, ...tokenize(process.env.NODE_OPTIONS)]` (`server/lib/utils.js`
// `getParsedNodeOptions`), so `--require` round-trips — re-quoted as `--require="<path>"`
// when the path contains a space, which Node accepts (MEASURED; this repo's checkout path
// does contain one).
//
// Coverage is therefore MEASURED, not argued: this file appends one record per process to
// the journal at `$AMODX_DOTENV_AUDIT`, and assertion `(iso3)` reads that journal back after
// the real `next build` / `next start` and fails unless the spawned processes appear in it.
//
// SECOND, INDEPENDENT MECHANISM: `harness.mjs` also sets `__NEXT_PROCESSED_ENV=true`, which
// makes `@next/env`'s own `processEnv()` return before its merge loop. Keep both: they stop
// different halves. This hook stops the *read*; the guard stops the *merge* however the file
// was read. Note the guard alone is NOT sufficient for the slice constraint — the
// `statSync`/`readFileSync` loop above runs BEFORE `processEnv()` is called, so with only the
// guard the file is still opened and its contents still land in `loadedEnvFiles`.
//
// `node --require` / `NODE_OPTIONS=--require` only accept CommonJS, so `require()` here is not
// a style choice — the ESLint rule below is categorically inapplicable to this file.
/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

/** `renderer/` — this file lives at `renderer/test/serving-contract/`. */
const RENDERER_DIR = path.resolve(__dirname, "..", "..");

// ── Audit journal ───────────────────────────────────────────────────────────────────────
// JSONL, one line per event, appended by every process that loads this file. `appendFileSync`
// opens with O_APPEND and each line is far below PIPE_BUF, so concurrent workers cannot
// interleave a partial record.
//
// It is captured BEFORE the patches below and called through the saved reference, so the
// journal cannot be affected by them. If the journal is configured but unwritable the append
// throws: a silent audit is worse than a loud harness failure, because every isolation claim
// this suite makes is read back out of this file.
const AUDIT_PATH = process.env.AMODX_DOTENV_AUDIT;
const realAppendFileSync = fs.appendFileSync;
const realStatSync = fs.statSync;
const realReadFileSync = fs.readFileSync;

function audit(record) {
    if (!AUDIT_PATH) return;
    realAppendFileSync.call(
        fs,
        AUDIT_PATH,
        JSON.stringify({ pid: process.pid, ppid: process.ppid, ...record }) + "\n",
    );
}

/**
 * True only for a direct child of `renderer/` whose name starts with `.env`.
 *
 * Deliberately narrow. `next-env.d.ts` does not match (its basename does not start with a
 * dot), no directory matches, and nothing outside `renderer/` matches — so no other file
 * Next reads during a build or a boot can be affected by this hook.
 */
function isDotenv(p) {
    if (typeof p !== "string") return false; // Buffer / URL / fd: not a path @next/env uses
    const resolved = path.resolve(p);
    return path.dirname(resolved) === RENDERER_DIR && path.basename(resolved).startsWith(".env");
}

function enoent(syscall, p) {
    audit({ ev: "block", syscall, file: path.basename(path.resolve(p)) });
    return Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`), {
        code: "ENOENT",
        errno: -2,
        syscall,
        path: p,
    });
}

fs.statSync = function statSync(p, options) {
    // `throwIfNoEntry: false` is the documented "tell me undefined instead of throwing" mode.
    // Honour it, so the patch is indistinguishable from the file genuinely not existing.
    // The audit record is written either way — `enoent()` is called for its side effect.
    if (isDotenv(p)) {
        const err = enoent("stat", p);
        if (options && options.throwIfNoEntry === false) return undefined;
        throw err;
    }
    return realStatSync.apply(this, arguments);
};

// No `options` handling needed here: `readFileSync` has no "return undefined" mode, so the
// only faithful answer for a file that does not exist is to throw. `arguments` forwards the
// caller's options untouched on the pass-through path.
fs.readFileSync = function readFileSync(p) {
    if (isDotenv(p)) throw enoent("open", p);
    return realReadFileSync.apply(this, arguments);
};

// Last: announce this process as covered. Written after the patches are installed so a record
// in the journal means "this process was protected from here on", not merely "this file began
// executing".
audit({ ev: "load", argv2: process.argv[2] });
