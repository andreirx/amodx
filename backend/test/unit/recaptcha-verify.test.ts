import { describe, it, expect, afterEach, vi } from "vitest";
import { verifyRecaptcha, getRecaptchaErrorMessage } from "../../src/lib/recaptcha.js";

/**
 * PUBLIC-HARDEN-1 (record docs/slices/public-harden-1.md, item A) — `verifyRecaptcha` checks the provider answer.
 *
 * The six public handlers that use reCAPTCHA refuse on `!result.success || result.score < threshold`. A success answer
 * without a numeric score (what a v2 key pair returns: `{ success: true }`) made `undefined < 0.5` false and passed.
 * The contract under test: whenever the returned `success` is truthy, `score` is a finite number. An answer that breaks
 * it, or is not an object, comes back as the refusal `{ success: false, score: 0 }` with one warning. Every other
 * answer comes back unchanged.
 *
 * The provider is stubbed at `fetch`; no network. The token and the secret are distinct marker strings so that the
 * warning can be searched for them.
 */

const TOKEN = "tok-MARKER-7f3a";
const SECRET = "secret-MARKER-91c2";

/** Stub the provider: `fetch` resolves to a response whose `json()` gives `parsed` (any parsed value, NaN included). */
const provider = (parsed: unknown) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ json: async () => parsed } as unknown as Response);

afterEach(() => vi.restoreAllMocks());

describe("verifyRecaptcha — answers with a numeric score, or without success, are returned unchanged", () => {
    const unchanged: Array<[string, Record<string, unknown>]> = [
        ["success, score 0.9", { success: true, score: 0.9, action: "form_submit", hostname: "site.test" }],
        ["success, score 0.1", { success: true, score: 0.1 }],
        ["refusal with error codes", { success: false, "error-codes": ["invalid-input-response"] }],
    ];
    for (const [name, answer] of unchanged) {
        it(name, async () => {
            provider(structuredClone(answer));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(await verifyRecaptcha(TOKEN, SECRET)).toStrictEqual(answer);
            expect(warn).not.toHaveBeenCalled();
        });
    }
});

describe("verifyRecaptcha — a success without a finite numeric score, or an answer that is not an object, is a refusal", () => {
    const refused: Array<[string, unknown]> = [
        ["{ success: true } (no score — a v2 key pair)", { success: true }],
        ["score is a string", { success: true, score: "0.9" }],
        ["score is null", { success: true, score: null }],
        ["score is NaN (as a parsed value)", { success: true, score: NaN }],
        ["answer is null", null],
        ["answer is a string", "ok"],
    ];
    for (const [name, answer] of refused) {
        it(name, async () => {
            provider(answer);
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const result = await verifyRecaptcha(TOKEN, SECRET, "203.0.113.7");
            expect(result).toStrictEqual({ success: false, score: 0 });
            expect(warn).toHaveBeenCalledTimes(1);
            const logged = JSON.stringify(warn.mock.calls);
            expect(logged).not.toContain(TOKEN);
            expect(logged).not.toContain(SECRET);
            // The handlers answer this refusal with the existing generic text.
            expect(getRecaptchaErrorMessage(result)).toBe("Verification failed. Please try again.");
        });
    }
});
