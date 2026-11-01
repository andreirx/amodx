import { describe, it, expect } from "vitest";
import { getPluginList } from "../src/admin";

/**
 * slice `cat-admin-2` (design `docs/slices/cat-admin-1.md` § 4.7) — where each block is offered.
 *
 * `PluginDefinition.offeredOn` lists the site kinds whose block inserter offers a block; absent or empty = every
 * site. The admin toolbar reads it through the projection `getPluginList()`, so this test reads the projection too:
 * it is the value the toolbar receives. The projection gives every plugin an array (an absent field becomes `[]`).
 *
 * Exact guarantee: the registry's `offeredOn` per key — the two declared blocks carry their lists, every other
 * registered block carries `[]`. A plugin added later without the field is covered by the "every other" assertion.
 * The toolbar's use of the value is tested in `admin/src/components/editor/Toolbar.test.ts`.
 */
const DECLARED: Record<string, readonly string[]> = {
    categoryShowcase: ["commerce", "catalog"],
    reviewsCarousel: ["commerce"],
};

describe("getPluginList().offeredOn", () => {
    const list = getPluginList();

    it("the two declared blocks carry their site kinds", () => {
        for (const [key, kinds] of Object.entries(DECLARED)) {
            const p = list.find((x) => x.key === key);
            expect(p, key).toBeDefined();
            expect(p!.offeredOn, key).toEqual(kinds);
        }
    });

    it("every other registered block is offered on every site (empty list)", () => {
        const others = list.filter((p) => !(p.key in DECLARED));
        expect(others.length).toBe(list.length - Object.keys(DECLARED).length);
        for (const p of others) expect(p.offeredOn, p.key).toEqual([]);
    });

    it("the projection no longer carries the boolean `commerce`", () => {
        for (const p of list) expect(Object.keys(p).sort(), p.key).toEqual(["icon", "key", "label", "offeredOn"]);
    });
});
