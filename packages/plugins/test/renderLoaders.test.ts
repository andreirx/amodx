import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    it("registers exactly 24 render loaders", () => {
        // 21 since SHOP-LOOK-1C (`categoryGrid`); 22 since SHOP-LOOK-1E (`form`); 23 since NEWSLETTER-1 (`newsletter`);
        // 24 since GALLERY-1 (`gallery`).
        expect(entries.length).toBe(24);
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

/**
 * GALLERY-1 (ruling GALLERY1-TEMPLATE-IMPORT = C, stop condition met) — no module the render entry can load imports a
 * RUNTIME value from `@amodx/shared`, by the barrel or by any path into the package. Observed (`npm run test:serving`):
 * a lazy render chunk that imported `fillTemplate` moved the stylesheet link and a script of EVERY page into the root
 * segment of the RSC payload — the same 11 byte-identity rows of pages without that block — both from the barrel
 * `@amodx/shared` (iteration 0, bisected in a worktree of 1ee85f3) and from an import-free module
 * `@amodx/shared/dist/template.js` (iteration 1). With only `import type`, all 176 rows pass. So a render module reads
 * shared TYPES only (`import type` / `export type`); a statement that names `@amodx/shared` or `@amodx/shared/…` without
 * `type` right after `import`/`export` is reported, even when every specifier is a `type` one (the simplest rule that
 * covers the case). No path is permitted: a new one needs its own serving proof first.
 *
 * The walk: from each `RENDER_LOADERS` target in `src/render.ts`, every relative `import`/`export … from` and `import()`
 * of `src/`, resolved to `.ts`, `.tsx` or `index.*`.
 */
describe("render entry — no runtime import of @amodx/shared, barrel or deep path (GALLERY-1)", () => {
    const SRC = fileURLToPath(new URL("../src/", import.meta.url));
    const resolve = (from: string, spec: string) => {
        const base = path.resolve(path.dirname(from), spec);
        for (const f of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
            if (existsSync(f) && !f.endsWith(path.sep) && f.match(/\.(ts|tsx)$/)) return f;
        }
        throw new Error(`unresolved ${spec} from ${from}`);
    };
    const STATEMENT = /(?:^|[\n;])\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;
    const DYNAMIC = /import\(\s*["'](\.[^"']+)["']\s*\)/g;
    function sharedValueImports(entries: string[], read: (file: string) => string = (f) => readFileSync(f, "utf8")): { files: number; offenders: string[] } {
        const seen = new Set<string>();
        const offenders: string[] = [];
        const queue = [...entries];
        while (queue.length > 0) {
            const file = queue.pop()!;
            if (seen.has(file)) continue;
            seen.add(file);
            const src = read(file);
            for (const m of src.matchAll(STATEMENT)) {
                const [, keyword, clause, spec] = m;
                const shared = spec === "@amodx/shared" || spec.startsWith("@amodx/shared/");
                if (shared && !/^type\b/.test(clause)) offenders.push(`${path.relative(SRC, file)}: ${keyword} ${clause} from "${spec}"`);
                if (spec.startsWith(".")) queue.push(resolve(file, spec));
            }
            for (const m of src.matchAll(DYNAMIC)) queue.push(resolve(file, m[1]));
        }
        return { files: seen.size, offenders };
    }
    const renderEntry = path.join(SRC, "render.ts");
    const viewer = path.join(SRC, "gallery", "GalleryViewer.tsx");
    const TYPE_ONLY = 'import type { GalleryTexts } from "@amodx/shared";';
    const readWith = (line: string) => (f: string) => {
        const src = readFileSync(f, "utf8");
        return f === viewer ? src.replace(TYPE_ONLY, line) : src;
    };

    it("every module reachable from RENDER_LOADERS imports only types from @amodx/shared", () => {
        const { files, offenders } = sharedValueImports([renderEntry]);
        expect(files).toBeGreaterThan(Object.keys(RENDER_LOADERS).length);
        expect(offenders).toEqual([]);
    });

    it("positive controls — the two measured forms are reported: the barrel, and the import-free deep module of iteration 1", () => {
        expect(readFileSync(viewer, "utf8")).toContain(TYPE_ONLY);
        expect(sharedValueImports([renderEntry], readWith('import { fillTemplate, type GalleryTexts } from "@amodx/shared";')).offenders)
            .toEqual(['gallery/GalleryViewer.tsx: import { fillTemplate, type GalleryTexts } from "@amodx/shared"']);
        expect(sharedValueImports([renderEntry], readWith('import { fillTemplate } from "@amodx/shared/dist/template.js";')).offenders)
            .toEqual(['gallery/GalleryViewer.tsx: import { fillTemplate } from "@amodx/shared/dist/template.js"']);
    });
});
