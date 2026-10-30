// CAT-INTEREST-1 — the hermetic browser E2E of the interest list (slice docs/slices/cat-interest-1.md § 5
// "Renderer hermetic E2E"). Run: `cd renderer && npm run test:interest-e2e`.
//
// Not the root `playwright.config.ts` (that one targets deployed staging and loads `.env.test`). This one serves
// the renderer the way the serving-contract suite does — `next build` + `next start` against the in-process
// DynamoDB stub, credential-free (`../serving-contract/harness.mjs`) — and drives it with Chromium.
//
// The fixture hosts (`*.serving-contract.test`) do not resolve; Chromium maps them to 127.0.0.1, so the browser
// sends the tenant's real Host header and middleware picks the tenant as in production.
// Output goes to the OS temp dir: Playwright writes `.last-run.json` there, and `renderer/test/` is tracked.
import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

export default defineConfig({
    testDir: ".",
    testMatch: /.*\.spec\.mjs$/,
    outputDir: path.join(os.tmpdir(), "amodx-interest-e2e-results"),
    timeout: 60_000,
    workers: 1,
    fullyParallel: false,
    retries: 0,
    reporter: "list",
    use: {
        browserName: "chromium",
        headless: true,
        launchOptions: { args: ["--host-resolver-rules=MAP *.serving-contract.test 127.0.0.1"] },
    },
});
