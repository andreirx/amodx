import { describe, it, expect } from "vitest";
import { normalizeEmail, OrderInputSchema } from "../src/index.js";

/**
 * slice `fnd-1` -- `normalizeEmail` is the platform identity primitive (PD-001). Its output
 * IS a DynamoDB sort key (`CUSTOMER#<email>`) and IS the pre-image of the Cognito public-pool
 * username. A behaviour change here is a key migration, not a refactor, so this suite pins
 * the CONTRACT -- the exact canonical form for each input class -- rather than sampling it.
 *
 * Imports `../src/index.js` (the `test-3` harness convention): the export surface is what
 * other workspaces consume, and the `.js` specifier is the form the package compiles with;
 * vitest resolves it to the TypeScript source. Deliberately NOT `dist/` -- a stale build must
 * not be able to read as a passing contract.
 *
 * Pure by construction: no AWS, no network, no environment, no `.env*`. `@amodx/shared`
 * has no runtime dependency but `zod` (`docs/testing-strategy.md` section 7).
 *
 * THIS FILE IS PURE ASCII BY RULE. Every non-ASCII character is a `\uXXXX` escape, never a
 * source literal: composed and decomposed "e-acute" are indistinguishable on screen, a BOM
 * is invisible, and a combining mark renders on top of its neighbour. A literal here would
 * be a test nobody can review and that any editor could silently re-normalize on save --
 * which would quietly delete the very thing under test.
 */

const E_COMPOSED = "\u00e9";                // LATIN SMALL LETTER E WITH ACUTE
const COMBINING_ACUTE = "\u0301";           // COMBINING ACUTE ACCENT
const E_DECOMPOSED = "e" + COMBINING_ACUTE;
const FULLWIDTH_AT = "\uff20";              // FULLWIDTH COMMERCIAL AT
const LIGATURE_FI = "\ufb01";               // LATIN SMALL LIGATURE FI
const SUPERSCRIPT_TWO = "\u00b2";           // SUPERSCRIPT TWO -- NFKC folds to "2"
const DIAERESIS = "\u00a8";                 // SPACING DIAERESIS -- NFKC yields U+0020 U+0308
const COMBINING_DIAERESIS = "\u0308";       // COMBINING DIAERESIS
const NBSP = "\u00a0";                      // NO-BREAK SPACE
const IDEOGRAPHIC_SPACE = "\u3000";         // IDEOGRAPHIC SPACE
const BOM = "\ufeff";                       // ZERO WIDTH NO-BREAK SPACE
const TURKISH_DOTTED_I = "\u0130";          // LATIN CAPITAL LETTER I WITH DOT ABOVE
const TURKISH_DOTLESS_I = "\u0131";         // LATIN SMALL LETTER DOTLESS I
const COMBINING_DOT_ABOVE = "\u0307";       // COMBINING DOT ABOVE

/** "CUST@example.com" written entirely in fullwidth forms (U+FF21.. / U+FF41..). */
const FULLWIDTH_ADDRESS =
    "\uff23\uff35\uff33\uff34" + FULLWIDTH_AT + "\uff45\uff58\uff41\uff4d\uff50\uff4c\uff45.\uff43\uff4f\uff4d";

// ---------------------------------------------------------------------------------------

describe("normalizeEmail -- ASCII passthrough", () => {
    /**
     * INVARIANT: the overwhelmingly common case must be the identity function. If an
     * already-canonical ASCII address changed at all, every `CUSTOMER#` record written
     * before fnd-2 would become unreachable after it.
     */
    it("leaves an already-canonical ASCII address byte-identical", () => {
        expect(normalizeEmail("customer@example.com")).toBe("customer@example.com");
    });

    it("preserves the local-part characters RFC 5322 allows and NFKC does not touch", () => {
        expect(normalizeEmail("first.last+tag_9-x@sub.example.co.uk"))
            .toBe("first.last+tag_9-x@sub.example.co.uk");
    });

    it("returns the empty string unchanged rather than throwing", () => {
        // Normalization is total: it never rejects. Format checking is the caller's schema.
        expect(normalizeEmail("")).toBe("");
        expect(normalizeEmail("   ")).toBe("");
    });
});

describe("normalizeEmail -- trim", () => {
    it("strips ASCII leading/trailing whitespace, including tab and newline", () => {
        expect(normalizeEmail("  customer@example.com\t\n")).toBe("customer@example.com");
    });

    it.each([
        ["NBSP", NBSP],
        ["ideographic space", IDEOGRAPHIC_SPACE],
        ["BOM / ZWNBSP", BOM],
    ])("strips a leading and trailing %s (JS WhiteSpace is wider than ASCII)", (_label, ws) => {
        // Pasting an address out of a rendered web page or a PDF is exactly how these arrive.
        expect(normalizeEmail(ws + "customer@example.com" + ws)).toBe("customer@example.com");
    });

    it("does NOT strip interior whitespace", () => {
        // Trimming the interior would silently *repair* a malformed address into a valid-looking
        // key. That must stay a validation failure, not a normalization outcome.
        expect(normalizeEmail(" cust omer@example.com ")).toBe("cust omer@example.com");
    });
});

describe("normalizeEmail -- case", () => {
    it("lowercases the whole address, local-part included", () => {
        expect(normalizeEmail("Customer.NAME@Example.COM")).toBe("customer.name@example.com");
    });

    it("uses the Unicode DEFAULT case mapping, never a locale mapping", () => {
        /**
         * ASCII "I" must map to ASCII "i". Under a Turkish locale mapping it would become
         * DOTLESS I (U+0131) and the same address would key differently depending on the
         * ambient locale of the Lambda / browser / build box that computed it.
         * Non-determinism in an identity key is unacceptable -- module header, step 3.
         */
        expect(normalizeEmail("IRIS@EXAMPLE.COM")).toBe("iris@example.com");
        expect(normalizeEmail("IRIS@EXAMPLE.COM")).not.toContain(TURKISH_DOTLESS_I);
    });
});

describe("normalizeEmail -- NFKC (the duplicate-identity class this slice retires)", () => {
    /**
     * INVARIANT: two byte-strings that a human reads as the same address must produce the
     * same key. Without NFKC each variant below writes its own `CUSTOMER#` record, and the
     * fork is invisible in the console -- it looks like two different customers.
     */
    it("maps composed and decomposed e-acute to ONE identical output", () => {
        const composed = normalizeEmail("ren" + E_COMPOSED + "e@example.com");
        const decomposed = normalizeEmail("ren" + E_DECOMPOSED + "e@example.com");

        expect(composed).toBe(decomposed);
        // ...and pin WHICH form is canonical: NFKC composes, so the key holds U+00E9.
        expect(composed).toBe("ren" + E_COMPOSED + "e@example.com");
        expect(composed).not.toContain(COMBINING_ACUTE);
    });

    it("folds fullwidth forms to ASCII, including the fullwidth @", () => {
        expect(normalizeEmail(FULLWIDTH_ADDRESS)).toBe("cust@example.com");
    });

    it("expands the fi ligature to two ASCII letters", () => {
        expect(normalizeEmail(LIGATURE_FI + "ona@example.com")).toBe("fiona@example.com");
    });

    it("folds a superscript digit in a domain label to its ASCII digit", () => {
        // NFKC compatibility folding is wider than accent composition; pinning a second,
        // structurally different fold keeps this suite honest about what NFKC actually is.
        expect(normalizeEmail("a@x" + SUPERSCRIPT_TWO + ".com")).toBe("a@x2.com");
    });
});

describe("normalizeEmail -- idempotence (why NFKC runs BEFORE trim)", () => {
    /**
     * INVARIANT: `normalizeEmail(normalizeEmail(x)) === normalizeEmail(x)`.
     *
     * This is a storage invariant, not an aesthetic one. A key that changes when it is
     * re-normalized can be WRITTEN under one value and LOOKED UP under another -- and the
     * lookup returns nothing, which reads as "no such customer", not as an error.
     *
     * The trap this pins: the compatibility decomposition of a spacing diacritic is
     * SPACE + combining mark, so NFKC can INTRODUCE leading whitespace. Under the intuitive
     * order `trim -> NFKC -> lowercase` a leading DIAERESIS survives the trim, becomes a
     * space, and a second pass strips it -- 50 code points behave this way. Trimming AFTER
     * NFKC is what makes the function idempotent.
     */
    it.each([
        ["ASCII", "customer@example.com"],
        ["padded ASCII", "  Customer@Example.COM  "],
        ["decomposed accent", "ren" + E_DECOMPOSED + "e@example.com"],
        ["fullwidth", FULLWIDTH_ADDRESS],
        ["ligature", LIGATURE_FI + "ona@example.com"],
        ["leading spacing diacritic", DIAERESIS + "a@example.com"],
        ["trailing spacing diacritic", "a@example.com" + DIAERESIS],
        ["Turkish dotted capital I", TURKISH_DOTTED_I + "smail@example.com"],
        ["empty", ""],
    ])("is idempotent for %s", (_label, input) => {
        const once = normalizeEmail(input);
        expect(normalizeEmail(once)).toBe(once);
    });

    it("pins the leading-diaeresis case concretely: NFKC yields SPACE + combining mark, then trim removes the space", () => {
        // Guards the ORDER directly. Under `trim -> NFKC -> lowercase` this returns
        // U+0020 U+0308 "a@example.com" (leading space) and the assertion below fails.
        expect(normalizeEmail(DIAERESIS + "a@example.com"))
            .toBe(COMBINING_DIAERESIS + "a@example.com");
    });

    it("is deterministic -- same input, same output, no hidden state", () => {
        expect(normalizeEmail("Customer@Example.com")).toBe(normalizeEmail("Customer@Example.com"));
    });
});

describe("normalizeEmail -- documented Turkish-I expectation (accepted divergence)", () => {
    /**
     * DOCUMENTED, NOT A BUG. The Unicode default lowercase of DOTTED CAPITAL I (U+0130) is
     * "i" + COMBINING DOT ABOVE, which is NOT ASCII "i". So the dotted-capital form and the
     * plain ASCII form are DIFFERENT identities under this function.
     *
     * The alternative -- `toLocaleLowerCase("tr")` -- would collapse them, at the price of
     * making the identity key depend on ambient locale. We take the deterministic option.
     * If a tenant ever reports the duplicate, the fix is a support/merge action, NOT a
     * change to this function (that would be a key migration across every tenant).
     */
    it("maps dotted capital I to i + COMBINING DOT ABOVE, not to ASCII i", () => {
        expect(normalizeEmail(TURKISH_DOTTED_I + "smail@example.com"))
            .toBe("i" + COMBINING_DOT_ABOVE + "smail@example.com");
    });

    it("therefore does NOT unify the dotted-capital form with the ASCII form", () => {
        expect(normalizeEmail(TURKISH_DOTTED_I + "SMAIL@example.com"))
            .not.toBe(normalizeEmail("ismail@example.com"));
    });
});

describe("ordering rule -- email format validation must run on the NORMALIZED form", () => {
    /**
     * PD-001 (amended): validate AFTER normalize. This is not a style preference -- the two
     * verdicts genuinely differ, so validating the raw input and persisting the normalized
     * one means the value actually stored was never validated in the form it was stored in.
     *
     * `OrderInputSchema.customerEmail` is the estate's public-checkout email validator and
     * stands in here for every `z.string().email()` field in the package.
     *
     * SCOPE: this pins the RULE. It does NOT claim the call sites obey it -- today
     * `backend/src/orders/create.ts:30` parses the RAW body and lowercases at :293, i.e.
     * validate-then-normalize, the wrong way round. Correcting that is `fnd-2`.
     */
    const order = (email: string) => ({
        items: [{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }],
        customerEmail: email,
        customerName: "Test",
        paymentMethod: "cod" as const,
    });

    it("rejects a fullwidth-@ address in its RAW form", () => {
        expect(OrderInputSchema.safeParse(order(FULLWIDTH_ADDRESS)).success).toBe(false);
    });

    it("accepts the SAME address once normalized", () => {
        expect(OrderInputSchema.safeParse(order(normalizeEmail(FULLWIDTH_ADDRESS))).success).toBe(true);
    });

    it("does not turn an invalid address into a valid one by normalization alone", () => {
        // Normalization is not repair: "no @ at all" stays invalid after normalizing.
        expect(OrderInputSchema.safeParse(order(normalizeEmail("  NOT-AN-EMAIL  "))).success).toBe(false);
    });
});
