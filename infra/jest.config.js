// Jest config for the infra synth suite (slice `test-4`).
//
// `amodx-stack.test.ts` synthesizes the real `AmodxStack`, which runs the renderer OpenNext
// build, the admin vite build and ~65 esbuild bundles inside the CDK constructors (see that
// file's header). Two settings follow from that and are not style choices:
//
//   testTimeout   the whole synth happens in one `beforeAll`; 52-58 s MEASURED on the
//                 operator's machine 2026-07-28, and a cold CI runner has no build caches.
//                 15 minutes is a hang backstop, not an expectation.
//   maxWorkers    one worker. There is one test file, and the suite mutates its own
//                 `process.env` to construct the environment the builds inherit; a second
//                 worker would race that setup and would double the build cost for nothing.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },

  // `.ts` BEFORE `.js` — this is jest's equivalent of the `--prefer-ts-exts` flag that
  // `cdk.json` already passes to ts-node, and it is load-bearing, not tidiness.
  //
  // `infra/lib/` and `infra/bin/` contain untracked, gitignored compiled `*.js` / `*.d.ts`
  // siblings left over from before `infra/tsconfig.json` gained `noEmit: true`. On this
  // checkout they are dated 2026-01-27 and predate the whole CACHE track. Jest's DEFAULT
  // `moduleFileExtensions` puts `js` first, so `import { AmodxStack } from '../lib/amodx-stack'`
  // resolved to that seven-month-old snapshot — MEASURED 2026-07-28: the suite synthesized a
  // stack with no `RendererCachePolicy`, no `api/*` behavior and no debounce/nightly flush
  // Lambdas, and reported those absences as ordinary assertion failures.
  //
  // That is the deleted stub's failure mode wearing a different costume: a suite that appears
  // to test the source while testing something else entirely. Assertion `(src1)` in
  // `amodx-stack.test.ts` fails if this ordering is ever removed, so the guarantee does not
  // depend on anyone reading this comment.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json', 'node'],

  testTimeout: 900000,
  maxWorkers: 1,
};
