import { describe, it, expect } from "vitest";
import { formatFromHeader, DEFAULT_FROM_NAME } from "../../src/lib/email-from.js";

/**
 * EMAIL-HOTFIX-1 — `src/lib/email-from.ts`: the `From` header display-name builder
 * (ratified D-EMAIL-6 option D, `docs/plan-email-onboarding.md`).
 *
 * WHY IT IS WORTH PINNING. This is the single point that turns arbitrary
 * operator-entered tenant names into an RFC 5322 `From` header at all SIX SES send
 * sites. The failure modes it guards are not cosmetic: an unescaped quote or comma
 * makes a malformed header; a raw non-ASCII byte is rejected by SES SendEmail; a
 * CR/LF is an email-header-injection vector. Each case below is one of those.
 *
 * Pure: no AWS, no DynamoDB, no environment. Runs under `npm run test:unit`
 * (`vitest.unit.config.ts`, no setupFiles).
 */

const ADDR = "contact@bijuterie.software";

/** Decode a possibly multi-word RFC 2047 `B` sequence back to the original name. */
function decodeEncodedWords(s: string): string {
    const words = s.split(" ").map((w) => {
        const m = /^=\?UTF-8\?B\?(.*)\?=$/.exec(w);
        if (!m) throw new Error(`not an encoded-word: ${w}`);
        return Buffer.from(m[1], "base64");
    });
    return Buffer.concat(words).toString("utf8");
}

describe("formatFromHeader — fallback / absent name", () => {
    // Ratified fallback (EMAIL-HOTFIX-1 review-0): a send site with no tenant name
    // must fall back to the platform brand label, NEVER emit a bare address.
    const fallback = `"${DEFAULT_FROM_NAME}" <${ADDR}>`;

    it("exposes the platform default brand label", () => {
        expect(DEFAULT_FROM_NAME).toBe("AMODX");
    });

    it("falls back to the platform default when siteName is undefined", () => {
        expect(formatFromHeader(undefined, ADDR)).toBe(fallback);
    });

    it("falls back to the platform default when siteName is null", () => {
        expect(formatFromHeader(null, ADDR)).toBe(fallback);
    });

    it("falls back to the platform default when siteName is empty or whitespace", () => {
        expect(formatFromHeader("", ADDR)).toBe(fallback);
        expect(formatFromHeader("   ", ADDR)).toBe(fallback);
    });

    it("never returns a bare address (no display name) for any absent-name input", () => {
        for (const input of [undefined, null, "", "   ", "\t"]) {
            expect(formatFromHeader(input, ADDR)).not.toBe(ADDR);
        }
    });
});

describe("formatFromHeader — plain ASCII names (quoted-string path)", () => {
    it("quotes a simple name", () => {
        expect(formatFromHeader("Acme Shop", ADDR)).toBe(`"Acme Shop" <${ADDR}>`);
    });

    it("preserves surrounding whitespace of a non-empty name (verbatim, not trimmed)", () => {
        // Ratified: the display name IS the tenant siteName; "nothing else changes"
        // (EMAIL-HOTFIX-1 review-1). Trimming is only a fallback trigger for the
        // all-whitespace case — a non-empty name must survive verbatim.
        expect(formatFromHeader("  Acme Shop  ", ADDR)).toBe(`"  Acme Shop  " <${ADDR}>`);
    });

    it("keeps a comma inside the quoted-string (not a second address)", () => {
        // A bare comma in an unquoted phrase would split the address list.
        expect(formatFromHeader("Acme, Inc.", ADDR)).toBe(`"Acme, Inc." <${ADDR}>`);
    });

    it("escapes an embedded double-quote", () => {
        expect(formatFromHeader('The "Best" Shop', ADDR)).toBe(`"The \\"Best\\" Shop" <${ADDR}>`);
    });

    it("escapes an embedded backslash", () => {
        expect(formatFromHeader("A\\B Store", ADDR)).toBe(`"A\\\\B Store" <${ADDR}>`);
    });

    it("escapes backslash and quote together, backslash-first (no double-escape)", () => {
        // Input:  \"   → backslash then quote.
        // Output: \\\" → escaped backslash (\\) then escaped quote (\").
        expect(formatFromHeader('\\"', ADDR)).toBe(`"\\\\\\"" <${ADDR}>`);
    });

    it("keeps other RFC 5322 specials verbatim inside quotes", () => {
        expect(formatFromHeader("A (B) <C> @D; E:", ADDR)).toBe(`"A (B) <C> @D; E:" <${ADDR}>`);
    });
});

describe("formatFromHeader — non-ASCII names (RFC 2047 encoded-word path)", () => {
    it("encodes diacritics as a UTF-8 base64 encoded-word", () => {
        const out = formatFromHeader("Bijuterii Prețioase", ADDR);
        const m = /^(.*) <contact@bijuterie\.software>$/.exec(out);
        expect(m).not.toBeNull();
        expect(m![1]).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
        expect(decodeEncodedWords(m![1])).toBe("Bijuterii Prețioase");
    });

    it("encodes emoji (astral / surrogate-pair) round-trip", () => {
        const name = "Shop 💎✨";
        const out = formatFromHeader(name, ADDR);
        const display = out.slice(0, out.length - ` <${ADDR}>`.length);
        expect(decodeEncodedWords(display)).toBe(name);
    });

    it("routes a name that mixes non-ASCII and quotes through encoding (quotes not literal)", () => {
        const name = 'Café "Deluxe"';
        const out = formatFromHeader(name, ADDR);
        const display = out.slice(0, out.length - ` <${ADDR}>`.length);
        // Whole thing is base64 — the raw quotes never reach the header unescaped.
        expect(display).not.toContain('\\"');
        expect(decodeEncodedWords(display)).toBe(name);
    });

    it("neutralises CR/LF header injection by base64-encoding it", () => {
        const name = "Evil\r\nBcc: attacker@example.com";
        const out = formatFromHeader(name, ADDR);
        // No raw CR/LF survives into the header value.
        expect(out).not.toMatch(/[\r\n]/);
        const display = out.slice(0, out.length - ` <${ADDR}>`.length);
        expect(decodeEncodedWords(display)).toBe(name);
    });

    it("folds a long non-ASCII name into multiple <=75-char encoded-words, round-tripping", () => {
        const name = "Bijuterii Prețioase și Accesorii ".repeat(6).trim(); // well over one word
        const out = formatFromHeader(name, ADDR);
        const display = out.slice(0, out.length - ` <${ADDR}>`.length);
        const words = display.split(" ");
        expect(words.length).toBeGreaterThan(1);
        for (const w of words) {
            expect(w.length).toBeLessThanOrEqual(75);
            expect(w).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
        }
        expect(decodeEncodedWords(display)).toBe(name);
    });
});
