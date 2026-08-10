import { describe, it, expect } from "vitest";
import { RENDER_LOADERS } from "../src/render";

/**
 * slice `perf-1` — the whole-render-entry SSR-safety binding.
 *
 * ## Why this file exists
 *
 * Before perf-1, `src/render.ts` EAGERLY imported every plugin render component into a
 * single `RENDER_MAP`. A side effect of that was a free guarantee: importing the render
 * entry in a `node` environment executed all 20 render modules, so a top-level `window` /
 * `document` reference in ANY of them broke the import — the renderer's server bundle would
 * have crashed the same way. The per-plugin suites leaned on that ("importing src/render.ts
 * is the SSR-safety smoke test for the whole entry").
 *
 * perf-1 replaced the eager map with `RENDER_LOADERS`: a record of lazy `import()` thunks so
 * a page ships only the render chunks for the block types it renders. That deletes the free
 * guarantee — importing `RENDER_LOADERS` executes NONE of the component modules; each thunk
 * runs only when someone `await`s it. The per-plugin suites now `await` only THEIR loader, so
 * each covers only its own module. Nothing re-establishes the whole-entry check.
 *
 * This file re-establishes it, explicitly and for all 20 loaders.
 *
 * ## Exact guarantee (do not overclaim)
 *
 * It `await`s EVERY `RENDER_LOADERS` entry in `environment: "node"`, which forces each
 * registered render module to LOAD (execute its top level) with no DOM present. That detects
 * a **module-load SSR hazard** — a top-level `window` / `document` / browser-global reference
 * in any registered render module — for all loaders, and asserts each resolves to a
 * `{ default: <function component> }` (the shape `next/dynamic` / `React.lazy` require).
 *
 * It does NOT render the components, so it does NOT prove browser-free *render execution*
 * (a `window` touched inside a component BODY during render). The per-plugin suites
 * (`videoPlugin`, `videoHeroPlugin`, `reviewsCarousel`) do that for the components they
 * exercise, via `renderToStaticMarkup`.
 *
 * Credential-free, no DOM, no new dependency — stays in the `node` run like the rest of the
 * suite. Run: `npm test -w packages/plugins`.
 */

describe("RENDER_LOADERS — whole-entry SSR-safety binding (perf-1)", () => {
    const entries = Object.entries(RENDER_LOADERS);

    // Pins the map size. A new plugin added to RENDER_LOADERS without its own suite is still
    // covered by the resolve-every-loader test below; this guard makes the count intentional.
    it("registers exactly 20 render loaders", () => {
        expect(entries.length).toBe(20);
    });

    it.each(entries)(
        "loader %s loads under node (no module-load SSR hazard) and exports a function component",
        async (_key, loader) => {
            const mod = await loader();
            expect(mod).toBeTruthy();
            expect(typeof mod.default).toBe("function");
        },
    );
});
