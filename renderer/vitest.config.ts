import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
    // `@/*` → `src/*` mirrors renderer/tsconfig.json `paths`. Needed so a unit test can import a
    // module that itself imports via the `@/` alias (e.g. `components/SitePage.tsx`, whose rev-4
    // prefetch-branch integration test drives the real module). Resolution only; no build, no server.
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
        // Force ONE React instance. The monorepo has two copies (root 19.2.3, renderer 19.2.0);
        // the built `@amodx/plugins/render` package resolves root's copy while the renderer's
        // `react-dom/server` uses its own — a dual-instance render throws "null dispatcher" (useRef).
        // Deduping makes the SitePage integration test render the real plugin components. No effect
        // on production (Next/OpenNext bundles a single React); this is a test-graph resolution only.
        dedupe: ["react", "react-dom"],
    },
    test: {
        environment: "node",
        include: ["test/unit/**/*.test.ts"],
        exclude: ["**/node_modules/**", "**/.next/**", "**/serving-contract/**"],
    },
});
