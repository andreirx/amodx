import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isProductAvailable } from "../../src/lib/availability.js";

/**
 * slice `test-3` — `src/lib/availability.ts`: the product publish WINDOW.
 *
 * WHY IT IS WORTH PINNING. This predicate is the gate between an unpublished product and
 * the public internet, and it is applied in FIVE places (`products/public-get.ts`,
 * `products/public-list.ts`, `categories/public-get.ts`, plus two read paths in the
 * renderer's `lib/dynamo.ts`, where the same logic is re-implemented inline because the
 * renderer cannot import backend code). Nothing type-checks those copies against each
 * other. If the rule here drifts, the copies do not follow — so the rule itself needs to
 * be nailed down first, in one place, with the boundary days named explicitly.
 *
 * Pure: no AWS, no DynamoDB, no environment. Runs under `npm run test:unit`
 * (`vitest.unit.config.ts`, no setupFiles), NOT under `npm test` — that one mutates live
 * staging.
 *
 * The only impurity is the clock (`new Date()`), so every test fixes it with fake timers.
 */

/** Fixed "today" for every case below: 2026-07-28, mid-day UTC. */
const TODAY = "2026-07-28";

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
});

afterEach(() => {
    vi.useRealTimers();
});

describe("isProductAvailable — no window set", () => {
    /**
     * INVARIANT: a product with neither date is ALWAYS available. This is the
     * backward-compatibility clause — every product created before the availability fields
     * existed has both undefined, and they must keep selling.
     */
    it("is available when both dates are absent", () => {
        expect(isProductAvailable({})).toBe(true);
    });

    it("is available when both dates are explicitly undefined", () => {
        expect(isProductAvailable({ availableFrom: undefined, availableUntil: undefined }))
            .toBe(true);
    });
});

describe("isProductAvailable — open-ended lower bound (availableFrom only)", () => {
    /** INVARIANT: available from that date ONWARD, and the start day itself counts. */
    it("is unavailable the day before it opens", () => {
        expect(isProductAvailable({ availableFrom: "2026-07-29" })).toBe(false);
    });

    it("is available ON the opening day (inclusive lower bound)", () => {
        expect(isProductAvailable({ availableFrom: TODAY })).toBe(true);
    });

    it("is available after the opening day", () => {
        expect(isProductAvailable({ availableFrom: "2026-01-01" })).toBe(true);
    });
});

describe("isProductAvailable — open-ended upper bound (availableUntil only)", () => {
    /** INVARIANT: available until that date, and the last day itself counts. */
    it("is available ON the closing day (inclusive upper bound)", () => {
        expect(isProductAvailable({ availableUntil: TODAY })).toBe(true);
    });

    it("is unavailable the day after it closes", () => {
        expect(isProductAvailable({ availableUntil: "2026-07-27" })).toBe(false);
    });

    it("is available well before it closes", () => {
        expect(isProductAvailable({ availableUntil: "2026-12-31" })).toBe(true);
    });
});

describe("isProductAvailable — closed window (both dates)", () => {
    /** INVARIANT: inclusive on BOTH ends — a one-day window sells for that one day. */
    it("is available inside the window", () => {
        expect(isProductAvailable({ availableFrom: "2026-07-01", availableUntil: "2026-08-31" }))
            .toBe(true);
    });

    it("is available on a single-day window that is today", () => {
        expect(isProductAvailable({ availableFrom: TODAY, availableUntil: TODAY })).toBe(true);
    });

    it("is unavailable before the window opens", () => {
        expect(isProductAvailable({ availableFrom: "2026-08-01", availableUntil: "2026-08-31" }))
            .toBe(false);
    });

    it("is unavailable after the window closes", () => {
        expect(isProductAvailable({ availableFrom: "2026-01-01", availableUntil: "2026-07-27" }))
            .toBe(false);
    });

    it("is unavailable for an inverted window (until < from)", () => {
        // A data-entry error. It fails CLOSED — the product is hidden rather than sold
        // outside any intended window. Pinned so the failure direction cannot flip.
        expect(isProductAvailable({ availableFrom: "2026-12-01", availableUntil: "2026-01-01" }))
            .toBe(false);
    });
});

describe("isProductAvailable — the comparison is a lexicographic date-string compare", () => {
    /**
     * CHARACTERIZATION of the mechanism, not just the outcome: the helper renders "now" as
     * `new Date().toISOString().split("T")[0]` and compares STRINGS. That is correct only
     * because ISO `YYYY-MM-DD` sorts lexicographically the same way it sorts
     * chronologically — and only while the stored values are zero-padded ISO dates. These
     * cases pin the two edges where a naive comparison would break.
     */
    it("orders across a month boundary", () => {
        vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
        expect(isProductAvailable({ availableUntil: "2026-07-31" })).toBe(false);
        expect(isProductAvailable({ availableFrom: "2026-07-31" })).toBe(true);
    });

    it("orders across a year boundary", () => {
        vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
        expect(isProductAvailable({ availableUntil: "2026-12-31" })).toBe(false);
        expect(isProductAvailable({ availableFrom: "2027-01-01" })).toBe(true);
    });

    /**
     * KNOWN LIMIT, recorded rather than asserted (finding F-BACKEND-2): "today" is the
     * **UTC** day, not the tenant's local day. For a tenant in Europe/Bucharest a window
     * ending 2026-07-31 keeps selling until 03:00 local on 2026-08-01. Asserting that here
     * would only re-state the implementation, and fixing it is a src change — out of scope
     * for `test-3` (ZERO src changes).
     */
});
