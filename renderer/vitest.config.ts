import { defineConfig } from "vitest/config";

/**
 * Renderer PURE unit tests (slice `test-3`). Run: `npm test -w renderer`.
 *
 * `include` is narrowed to `test/unit/` ON PURPOSE, and this is the load-bearing line in
 * the file. Vitest's default glob would also match
 * `test/serving-contract/contract.test.mjs` — a **node:test** suite (test-2) that boots
 * `next build` + `next start` and must keep running under `npm run test:serving`. Pulling
 * it into vitest would break its `describe`/`it`-free structure and, worse, bypass the
 * harness that CONSTRUCTS the child environment; its isolation self-checks `(iso1)`–`(iso4)`
 * are what make this repo's credential-free claim measurable rather than asserted. The two
 * suites are separate runners deliberately — `test/serving-contract/README.md`
 * § "Why node:test".
 *
 * This is the DEFAULT config filename so the narrowing also applies to a bare `npx vitest`,
 * not only to the `test` script.
 *
 * No server, no `next build`, no DynamoDB, no `.env*`. The suites under `test/unit/` mock
 * the AWS SDK and `next/navigation` at the module boundary, so nothing here opens a socket;
 * vitest (unlike Next) does not read `.env*` unless a config asks it to, and this one does
 * not.
 */
export default defineConfig({
    test: {
        environment: "node",
        include: ["test/unit/**/*.test.ts"],
        exclude: ["**/node_modules/**", "**/.next/**", "**/serving-contract/**"],
    },
});
