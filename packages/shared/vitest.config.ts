import { defineConfig } from "vitest/config";

/**
 * Pure unit tests for the shared Zod schemas (slice `test-3`).
 *
 * No AWS, no network, no environment, no `.env*`. `packages/shared` has no runtime
 * dependency beyond `zod`, so nothing here can reach a credential even by accident —
 * the credential-free claim of `docs/testing-strategy.md` §7 holds by construction.
 *
 * `include` is explicit rather than left to vitest's default glob so that this config
 * can never widen silently onto files added elsewhere in the package.
 *
 * Tests import `src/index.ts` directly, NOT `dist/`: the contract under test is the
 * source of truth for every workspace, and running against `dist/` would make a stale
 * build read as a passing contract.
 *
 * Run: `npm test -w packages/shared`.
 */
export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
        exclude: ["**/node_modules/**", "**/dist/**"],
    },
});
