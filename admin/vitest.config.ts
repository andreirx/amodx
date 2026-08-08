import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Headless unit config for the admin workspace (rev-2b finding #5). Node environment — no jsdom —
 * because the covered surface is a PURE view-model builder (`src/lib/importReportView.ts`), not a
 * DOM render. The `@` alias mirrors vite.config so tests import the same paths the app does. The
 * app build/typecheck stays on the vite/tsc pipeline; this config is test-only.
 */
export default defineConfig({
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
});
