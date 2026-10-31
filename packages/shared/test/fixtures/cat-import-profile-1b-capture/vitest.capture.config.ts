// CAT-IMPORT-PROFILE-1B golden capture — vitest config used ONLY inside the base worktree (run.sh copies it to
// <worktree>/renderer/). It runs the base `test/unit/facets.test.ts` unchanged, with its import of the facet module
// routed through the recorder, plus the listing capture.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            { find: /^\.\.\/\.\.\/src\/lib\/facets$/, replacement: here("./test/capture/recorder.ts") },
            { find: "@capture/facets-real", replacement: here("./src/lib/facets.ts") },
        ],
    },
    test: {
        environment: "node",
        include: ["test/unit/facets.test.ts", "test/capture/listing.capture.ts"],
        setupFiles: ["test/capture/setup.ts"],
        fileParallelism: false,
    },
});
