// CJS preload for EVERY Node process the infra synth suite spawns. Slice `test-4`.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
// `Template.fromStack(new AmodxStack(...))` is not a pure function of the CDK source. Two of
// the constructs SHELL OUT to real application builds inside their constructors:
//
//   infra/lib/renderer-hosting.ts:62   execSync('npm run build:open', { env: {...process.env} })
//   infra/lib/admin-hosting.ts:31      execSync('npm run build',      { env: {...process.env} })
//
// Both pass an INHERITED environment, and both build tools then load `.env*` from their own
// project directory on their own initiative:
//
//   renderer/  `next build` -> @next/env loadEnvConfig() walks .env.<mode>.local, .env.local,
//              .env.<mode>, .env  (statSync + readFileSync, ENOENT-tolerant)
//   admin/     `vite build`  -> vite loadEnv() reads the same family for the build mode
//
// MEASURED on this checkout 2026-07-28: `renderer/.env.local` exists and carries a real
// `AMODX_API_KEY`, a real `TABLE_NAME` and `AWS_REGION`; `admin/.env.local` exists and carries
// the (public) `VITE_*` deployment settings. Without a suppression mechanism, running
// `cd infra && npm test` would therefore hand a live API key and a live table name to a
// Next.js production build — i.e. the infra gate would silently become credential-BEARING, and
// on a machine with an AWS profile the build's data fetches would address REAL DynamoDB.
//
// docs/testing-strategy.md § Invariants: "A gate that claims to be credential-free must
// CONSTRUCT the environment of any process it spawns, not inherit it", and its corollary,
// "the unit of isolation is the process tree, not the process you spawn."
//
// ── WHAT IT DOES ───────────────────────────────────────────────────────────────────────────
// Makes exactly `<guarded-dir>/.env*` invisible at the `fs` layer, so both loaders take the
// ENOENT branch they already take on any checkout without those files — the only branch CI
// ever sees. Nothing is created, moved or deleted; the operator's files are untouched, and
// every other path on the filesystem behaves normally.
//
// ── DELIVERY: `NODE_OPTIONS`, NOT `--require` ON ARGV ──────────────────────────────────────
// The technique, the syscall analysis and the argv-vs-environment measurement are `test-2`'s;
// the full derivation lives in `renderer/test/serving-contract/no-dotenv.cjs` and is not
// repeated here. The one-line summary: `child_process.fork` drops the parent's `execArgv`
// whenever the caller supplies its own (jest-worker and Next's build workers always do), so an
// argv `--require` stops at the first fork. `NODE_OPTIONS` rides in the environment and the
// environment is inherited by every child process and worker thread, so it survives
// `npm run build:open` -> `open-next` -> `next build` -> N build workers.
//
// This file is a SECOND COPY of that mechanism, not a reuse of it, for two reasons: the
// renderer copy is hard-scoped to `renderer/` (this suite must also cover `admin/`), and
// slice `test-4`'s writable surface excludes `renderer/**`. The duplication is recorded in
// `docs/TECH-DEBT.md` with the trigger for consolidating the two.
//
// ── COVERAGE IS MEASURED, NOT ARGUED ───────────────────────────────────────────────────────
// Every process this file loads into appends a record to `$AMODX_INFRA_DOTENV_AUDIT`, and
// assertion `(iso1)` in `amodx-stack.test.ts` reads that journal back after the real builds
// and fails unless the spawned processes appear in it. `(iso2)` re-runs this same detector in
// a child pointed at a scratch directory, so the "nothing was read" claim ships with a
// positive control (testing-strategy § Invariants).

/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

/**
 * Directories whose direct `.env*` children are hidden.
 *
 * Defaults to the two workspaces the synth builds. `AMODX_INFRA_DOTENV_DIRS` (a
 * `path.delimiter`-separated list) overrides it, which is how `(iso2)` aims the identical
 * detector at a scratch directory instead of the repo — the positive control must be able to
 * put a REAL `.env` in front of it, and it must not do that inside a workspace.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUARDED_DIRS = (
    process.env.AMODX_INFRA_DOTENV_DIRS
        ? process.env.AMODX_INFRA_DOTENV_DIRS.split(path.delimiter).filter(Boolean)
        : [path.join(REPO_ROOT, "renderer"), path.join(REPO_ROOT, "admin")]
).map((d) => path.resolve(d));

// ── Audit journal ──────────────────────────────────────────────────────────────────────────
// JSONL, one line per event. References to the real `fs` functions are captured BEFORE the
// patches below and called through, so the journal cannot be affected by them. `appendFileSync`
// opens with O_APPEND and each record is far below PIPE_BUF, so concurrent build workers cannot
// interleave a partial line. If the journal is configured but unwritable the append throws: a
// silent audit is worse than a loud failure, because every isolation claim this suite makes is
// read back out of this file.
const AUDIT_PATH = process.env.AMODX_INFRA_DOTENV_AUDIT;
const realAppendFileSync = fs.appendFileSync;
const realStatSync = fs.statSync;
const realReadFileSync = fs.readFileSync;
const realExistsSync = fs.existsSync;

function audit(record) {
    if (!AUDIT_PATH) return;
    realAppendFileSync.call(
        fs,
        AUDIT_PATH,
        JSON.stringify({ pid: process.pid, ppid: process.ppid, ...record }) + "\n",
    );
}

/**
 * True only for a DIRECT child of a guarded directory whose basename starts with `.env`.
 *
 * Deliberately narrow: `next-env.d.ts` does not match (basename does not start with a dot),
 * no directory matches, nothing in a subdirectory matches, and nothing outside the guarded
 * list matches. So no other file either build reads can be affected by this hook.
 */
function isDotenv(p) {
    if (typeof p !== "string") return false; // Buffer / URL / fd: not a path these loaders use
    const resolved = path.resolve(p);
    return (
        GUARDED_DIRS.indexOf(path.dirname(resolved)) !== -1 &&
        path.basename(resolved).startsWith(".env")
    );
}

function blocked(syscall, p) {
    const resolved = path.resolve(p);
    audit({
        ev: "block",
        syscall,
        dir: path.basename(path.dirname(resolved)),
        file: path.basename(resolved),
    });
    return Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`), {
        code: "ENOENT",
        errno: -2,
        syscall,
        path: p,
    });
}

// `throwIfNoEntry: false` is the documented "tell me undefined instead of throwing" mode.
// Honour it, so the patch is indistinguishable from the file genuinely not existing. The audit
// record is written either way — `blocked()` is called for its side effect.
fs.statSync = function statSync(p, options) {
    if (isDotenv(p)) {
        const err = blocked("stat", p);
        if (options && options.throwIfNoEntry === false) return undefined;
        throw err;
    }
    return realStatSync.apply(this, arguments);
};

// No `options` handling: `readFileSync` has no "return undefined" mode, so the only faithful
// answer for a file that does not exist is to throw.
fs.readFileSync = function readFileSync(p) {
    if (isDotenv(p)) throw blocked("open", p);
    return realReadFileSync.apply(this, arguments);
};

// `existsSync` never throws; the faithful answer is `false`.
//
// MEASURED 2026-07-28, and stated plainly rather than implied: on this toolchain only `stat`
// ever fires — 10 blocks per run, all `stat`, across both `renderer` and `admin`. Both loaders
// probe with a stat first and take their ENOENT branch there, so `readFileSync` and
// `existsSync` are never reached. They are kept as DEFENCE IN DEPTH, not as claims: a Next or
// Vite upgrade that switches to a read-first or exists-first probe would otherwise silently
// walk past this hook. `(iso1)` prints the syscall histogram on every run, so if that ever
// changes the transcript says so instead of the comment going quietly stale. `(iso2)` exercises
// the `readFileSync` path directly, so neither patch is untested.
fs.existsSync = function existsSync(p) {
    if (isDotenv(p)) {
        blocked("access", p);
        return false;
    }
    return realExistsSync.apply(this, arguments);
};

// Last: announce this process as covered. Written after the patches are installed, so a record
// means "this process was protected from here on", not merely "this file began executing".
audit({ ev: "load", argv1: process.argv[1] ? path.basename(process.argv[1]) : null });
