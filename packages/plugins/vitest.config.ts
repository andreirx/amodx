import { defineConfig } from "vitest/config";

/**
 * Pure unit tests for `packages/plugins` (slice `vid-1`; the layer defined by
 * `docs/testing-strategy.md` §1).
 *
 * This is the plugins workspace's FIRST test harness. It deliberately covers only the
 * pure, framework-free modules under `src/common/` — the plugin components themselves are
 * React/Tiptap and would need a DOM + RTL harness, which is §4 of the testing strategy and
 * is not this slice.
 *
 * Credential-free by construction: nothing under test imports an AWS SDK, opens a socket,
 * reads `process.env`, or touches a `.env*` file, and no server is booted. The suite is
 * therefore safe in CI on a fork PR and safe for an unattended relay.
 *
 * `include` is explicit rather than left to vitest's default glob — the package holds ~20
 * plugin directories, and the default would silently widen onto any `*.test.ts(x)` added
 * inside `src/` later, pulling React into a node-environment run.
 *
 * Tests import `src/`, NOT `dist/`: running against the build would let a stale `dist/`
 * read as a passing contract.
 *
 * Run: `npm test -w packages/plugins`.
 */
export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
        exclude: ["**/node_modules/**", "**/dist/**"],
    },
});
