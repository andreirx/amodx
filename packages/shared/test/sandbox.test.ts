import { describe, it, expect } from "vitest";
import {
    STATIC_PAGE_SANDBOX_TOKENS,
    STATIC_PAGE_SANDBOX_ATTR,
    STATIC_PAGE_SANDBOX_FORBIDDEN_TOKENS,
} from "../src/sandbox.js";

/**
 * STATIC-1 — guards the ratified iframe sandbox contract (D-STATIC-1).
 *
 * This is a REGRESSION FENCE, not a behavioural test: the constant has no logic. Its
 * whole reason to exist is that a later edit which adds `allow-same-origin` (variant a2)
 * would silently collapse the opaque-origin barrier — the browser would still parse the
 * attribute and the feature would still "work" in preview, so nothing else would fail.
 * These assertions are the only thing that turns that edit into a red build.
 */
describe("STATIC_PAGE_SANDBOX contract", () => {
    it("grants exactly `allow-scripts` and nothing else (minimum-token obligation)", () => {
        expect([...STATIC_PAGE_SANDBOX_TOKENS]).toEqual(["allow-scripts"]);
    });

    it("never contains a forbidden (barrier-collapsing) token", () => {
        for (const forbidden of STATIC_PAGE_SANDBOX_FORBIDDEN_TOKENS) {
            expect(STATIC_PAGE_SANDBOX_TOKENS).not.toContain(forbidden);
        }
    });

    it("names `allow-same-origin` as forbidden — the opaque-origin collapse token", () => {
        // If this token ever leaves the forbidden list, the fence above stops fencing.
        expect([...STATIC_PAGE_SANDBOX_FORBIDDEN_TOKENS]).toContain("allow-same-origin");
    });

    it("serialises to the space-joined attribute value the shell will emit", () => {
        expect(STATIC_PAGE_SANDBOX_ATTR).toBe("allow-scripts");
        expect(STATIC_PAGE_SANDBOX_ATTR).not.toContain("allow-same-origin");
    });
});
