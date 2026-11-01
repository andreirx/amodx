import { describe, it, expect } from "vitest";
import { getPluginList } from "@amodx/plugins/admin";
import { offeredPlugins } from "./Toolbar";

/**
 * CAT-ADMIN-2 (docs/slices/cat-admin-1.md § 4.7) — the block inserter's rule, over the real plugin registry. The
 * Toolbar component needs a tiptap editor to render, so its rule is the pure `offeredPlugins` and is tested here. The
 * registry's `offeredOn` values themselves are pinned in `packages/plugins/test/offeredOn.test.ts`.
 *
 * The four cases of the packet: a content site, a commerce site, a catalog site, and a catalog that also says
 * `commerceEnabled` (the backend refuses that pair, 400; the rule ignores the flag and treats the site as a catalog).
 */
const ALL = getPluginList();
const keys = (tenant: Parameters<typeof offeredPlugins>[1]) => offeredPlugins(ALL, tenant).map((p) => p.key);
const everyOther = ALL.map((p) => p.key).filter((k) => k !== "categoryShowcase" && k !== "reviewsCarousel");

describe("offeredPlugins", () => {
    it("the registry has the two kind-bound blocks and others", () => {
        expect(ALL.map((p) => p.key)).toEqual(expect.arrayContaining(["categoryShowcase", "reviewsCarousel"]));
        expect(everyOther.length).toBe(ALL.length - 2);
    });

    it("content site (no flag, or no tenant): neither the showcase nor the carousel", () => {
        expect(keys({})).toEqual(everyOther);
        expect(keys({ commerceEnabled: false, catalogMode: false })).toEqual(everyOther);
        expect(keys(null)).toEqual(everyOther);
    });

    it("commerce site: every block, in registry order", () => {
        expect(keys({ commerceEnabled: true })).toEqual(ALL.map((p) => p.key));
    });

    it("catalog site: the showcase, not the carousel", () => {
        const k = keys({ catalogMode: true });
        expect(k).toContain("categoryShowcase");
        expect(k).not.toContain("reviewsCarousel");
        expect(k).toEqual(ALL.map((p) => p.key).filter((x) => x !== "reviewsCarousel"));
    });

    it("catalog + commerceEnabled: the commerce flag is ignored (same as catalog)", () => {
        expect(keys({ catalogMode: true, commerceEnabled: true })).toEqual(keys({ catalogMode: true }));
    });
});
