import { describe, it, expect, vi, afterEach } from "vitest";
import { COMMERCE_FROZEN_TEXT, commerceWriteFreezeRefusal, parseCommerceWriteFreeze } from "../../src/lib/commerce-freeze.js";

/**
 * CMRC-2B (docs/slices/cmrc-2b.md § Item 2) — the parsing rules of `COMMERCE_WRITE_FREEZE_TENANTS` and the refusal.
 * Pure; no handler. The handlers' use of it is proven in `cmrc-2b-write-freeze.test.ts`.
 */

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const tenantsOf = (text: string | undefined) => {
    const freeze = parseCommerceWriteFreeze(text);
    return freeze.kind === "tenants" ? [...freeze.tenantIds] : freeze.kind;
};

describe("CMRC-2B — parseCommerceWriteFreeze", () => {
    it.each([
        ["absent", undefined],
        ["empty", ""],
        ["spaces only", "   "],
        ["separators and spaces only", " , ,, "],
    ])("%s → none: no tenant frozen", (_name, text) => {
        expect(parseCommerceWriteFreeze(text)).toEqual({ kind: "none" });
    });

    it.each([
        ["one id", "cm1-commerce", ["cm1-commerce"]],
        ["two ids", "cm1-commerce,shop-2", ["cm1-commerce", "shop-2"]],
        ["spaces and tabs around entries are removed", " cm1-commerce ,\tshop-2\t", ["cm1-commerce", "shop-2"]],
        ["empty entries are dropped", ",cm1-commerce,,shop-2,", ["cm1-commerce", "shop-2"]],
        ["case is kept", "Shop-A,shop-a", ["Shop-A", "shop-a"]],
        ["a repeated id counts once", "a,a", ["a"]],
    ])("%s", (_name, text, ids) => {
        expect(tenantsOf(text)).toEqual(ids);
    });

    it.each([
        ["a space inside an entry (space used as separator)", "cm1-commerce shop-2", ["cm1-commerce shop-2"]],
        ["a semicolon separator", "cm1-commerce;shop-2", ["cm1-commerce;shop-2"]],
        ["double quotes kept by the shell", "\"cm1-commerce,shop-2\"", ["\"cm1-commerce", "shop-2\""]],
        ["single quotes kept by the shell", "'cm1-commerce'", ["'cm1-commerce'"]],
        ["a backtick", "`cm1-commerce`", ["`cm1-commerce`"]],
        ["one bad entry among good ones", "good,bad entry,also-good", ["bad entry"]],
        ["a newline inside an entry", "a\nb", ["a\nb"]],
    ])("%s → unreadable, the bad entries are named", (_name, text, entries) => {
        expect(parseCommerceWriteFreeze(text)).toEqual({ kind: "unreadable", entries });
    });
});

describe("CMRC-2B — commerceWriteFreezeRefusal", () => {
    const FROZEN = { statusCode: 503, body: JSON.stringify({ code: "commerceFrozen", error: COMMERCE_FROZEN_TEXT }) };

    it("a listed tenant → 503 commerceFrozen in the { error } envelope, no headers; one warning line", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(commerceWriteFreezeRefusal("t1", "t0, t1")).toEqual(FROZEN);
        expect(JSON.parse(FROZEN.body)).toEqual({ code: "commerceFrozen", error: "Orders are paused for a short maintenance. Try again in a few minutes." });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("an unlisted tenant, an empty list, an absent list → undefined, nothing logged", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(commerceWriteFreezeRefusal("t2", "t0,t1")).toBeUndefined();
        expect(commerceWriteFreezeRefusal("t1", "")).toBeUndefined();
        expect(commerceWriteFreezeRefusal("t1", undefined)).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });

    it("exact comparison: T1 is not t1, and a prefix is not a match", () => {
        expect(commerceWriteFreezeRefusal("t1", "T1")).toBeUndefined();
        expect(commerceWriteFreezeRefusal("t1", "t")).toBeUndefined();
        expect(commerceWriteFreezeRefusal("t", "t1")).toBeUndefined();
    });

    it("an unreadable list freezes EVERY tenant (fail closed, D3); the log names the bad entries", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(commerceWriteFreezeRefusal("any-tenant", "t1;t2")).toEqual(FROZEN);
        expect(commerceWriteFreezeRefusal("t1", "t1 t2")).toEqual(FROZEN);
        expect(JSON.stringify(warn.mock.calls[0])).toContain("t1;t2");
    });

    it("the default list is COMMERCE_WRITE_FREEZE_TENANTS, read at each call", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubEnv("COMMERCE_WRITE_FREEZE_TENANTS", "t1");
        expect(commerceWriteFreezeRefusal("t1")).toEqual(FROZEN);
        vi.stubEnv("COMMERCE_WRITE_FREEZE_TENANTS", "");
        expect(commerceWriteFreezeRefusal("t1")).toBeUndefined();
    });
});
