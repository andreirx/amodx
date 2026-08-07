import { describe, it, expect } from "vitest";
import { normalizeEmail, OrderInputSchema } from "@amodx/shared";

/**
 * slice `fnd-2` — the identity-key CONVERGENCE invariant the call-site migration delivers.
 *
 * WHAT THIS PINS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * fnd-2 routed every email-keyed site through `normalizeEmail`: the checkout WRITE path
 * (`orders/create.ts` — CUSTOMER# / CUSTORDER# / EMAILLIMIT# + the persisted attribute),
 * the admin READ/WRITE paths that were previously RAW (`customers/get.ts`,
 * `customers/update.ts`), the renderer account reads (`lib/dynamo.ts`), the order-lookup
 * AUTHORIZATION compare (`orders/public-get.ts`) and the signed-asset ENTITLEMENT check
 * (`resources/presign.ts`). The key each site builds is the literal `` `CUSTOMER#${…}` ``
 * / `` `CUSTORDER#${…}#` `` shown below.
 *
 * There is no pure, importable seam AT the call sites — the key is an inline template
 * literal inside a handler that constructs an AWS SDK client at module load, so importing
 * it here would drag in credentials and a live client. Extracting a `customerKey(email)`
 * helper purely to get a seam would be structure this slice has not earned (one trivial
 * expression, no second axis of variation). So this suite pins the CONTRACT those sites
 * now share — the properties they depend on — not the handler wiring itself. It does NOT pin
 * that any given handler still calls `normalizeEmail`: a revert of a single site back to
 * `.toLowerCase()` would not fail here. Nor is such a revert caught by an automated
 * handler-integration test — per the fnd-2 handler-coverage exception (slice § FINALIZE), the
 * staging suite has no orders-handler coverage, and a local handler-integration harness is a
 * named DEFERRED item in `docs/testing-strategy.md`, out of this slice's scope. A revert is
 * caught by review of the diff. Here we guarantee only that the primitive keeps the shape the
 * sites were migrated to rely on.
 *
 * Pure: imports only `normalizeEmail` (aliased to source by `vitest.unit.config.ts`).
 * No AWS, no DynamoDB, no environment. Runs under `npm run test:unit`.
 */

// Mirrors the exact key expressions the fnd-2 call sites now build. Kept local because the
// handlers are not purely importable (see header). If the estate ever grows a shared
// key-builder, these collapse into it.
const customerKey = (email: string) => `CUSTOMER#${normalizeEmail(email)}`;
const custOrderPrefix = (email: string) => `CUSTORDER#${normalizeEmail(email)}#`;

describe("fnd-2 identity-key convergence", () => {
    it("write path (lowercased) and admin read path (was RAW) converge on one CUSTOMER# key", () => {
        // The failure fnd-2 retires: checkout wrote `customer@x.com`; an admin opening
        // `Customer@x.com` in customers/get.ts (previously raw) missed the record.
        const checkoutWrote = customerKey("customer@x.com");
        const adminOpened = customerKey("Customer@x.com");
        const withWhitespace = customerKey("  customer@x.com  ");
        expect(adminOpened).toBe(checkoutWrote);
        expect(withWhitespace).toBe(checkoutWrote);
        expect(checkoutWrote).toBe("CUSTOMER#customer@x.com");
    });

    it("the derived key is idempotent — a key written under one form re-derives to itself", () => {
        // A key that changes when re-normalized can be written under one value and looked up
        // under another. normalizeEmail guarantees idempotence; the key inherits it.
        const once = normalizeEmail("Customer@x.com");
        expect(normalizeEmail(once)).toBe(once);
        expect(customerKey(once)).toBe(customerKey("Customer@x.com"));
    });

    it("NFKC folds a fullwidth address onto the ASCII key (EMAILLIMIT# cannot be bypassed by variant)", () => {
        // Fullwidth commercial at U+FF20. Pre-fnd-2 `.toLowerCase()` left it distinct, so the
        // per-address rate limit and the customer identity forked on an encoding variant.
        expect(customerKey("user＠example.com")).toBe(customerKey("user@example.com"));
        expect(custOrderPrefix("user＠example.com")).toBe(custOrderPrefix("user@example.com"));
    });

    it("order-lookup authorization compare (public-get) is symmetric under encoding variants", () => {
        // orders/public-get.ts now compares normalizeEmail(stored) !== normalizeEmail(supplied).
        // A caller supplying a fullwidth/whitespace variant of the owning address still matches.
        const stored = normalizeEmail("owner@shop.com");
        const supplied = normalizeEmail("  Owner＠shop.com  ");
        expect(stored).toBe(supplied);
    });

    it("documented divergence: Turkish dotted capital I does NOT fold to ASCII i (accepted)", () => {
        // Pinned in fnd-1 as an accepted consequence of locale-free case mapping. Named here so
        // fnd-2's key convergence is not misread as 'all visually-similar addresses converge'.
        expect(customerKey("İSMAIL@x.com")).not.toBe(customerKey("ismail@x.com"));
    });
});

/**
 * fnd-2 REVISE cycle (F-FND2-3 resolved) — email-format validation runs on the NORMALIZED form.
 *
 * PD-001 (amended): "Any email-format validation runs on the NORMALIZED form, never on raw
 * input." fnd-2 cycle-1 migrated the KEY builders but left the two sites that ALSO validate
 * email format validating-then-normalizing (the wrong order): checkout `orders/create.ts`
 * (schema `OrderInputSchema.safeParse` on the raw body) and `customers/public-update.ts`
 * (a local regex on the raw param). This cycle moves the normalize ahead of the validate at
 * both. The verdicts genuinely differ, so this changes acceptance behavior — a fullwidth-＠
 * address that was REJECTED is now folded to ASCII and ACCEPTED.
 *
 * These tests mirror the exact `validate ∘ normalize` composition each site now performs.
 * The schema is imported from source; the regex is copied verbatim from public-update.ts
 * (kept local because the handler is not purely importable — see the header above).
 */
describe("fnd-2 revise — format validation runs on the normalized form (PD-001)", () => {
    // U+FF20 FULLWIDTH COMMERCIAL AT — passes no ASCII-@ check raw, folds to `@` under NFKC.
    const FULLWIDTH = "cust＠example.com";

    // --- orders/create.ts composition: OrderInputSchema.safeParse(bodyWithNormalizedEmail) ---
    const order = (email: string) => ({
        items: [{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }],
        customerEmail: email,
        customerName: "Test",
        paymentMethod: "cod" as const,
    });

    it("create.ts: a fullwidth-＠ address is REJECTED validated raw (the old order)", () => {
        expect(OrderInputSchema.safeParse(order(FULLWIDTH)).success).toBe(false);
    });

    it("create.ts: the SAME address is ACCEPTED when normalized first (the new order)", () => {
        expect(OrderInputSchema.safeParse(order(normalizeEmail(FULLWIDTH))).success).toBe(true);
    });

    it("create.ts: normalization is not repair — a genuinely invalid address stays rejected", () => {
        expect(OrderInputSchema.safeParse(order(normalizeEmail("  NOT-AN-EMAIL  "))).success).toBe(false);
    });

    // --- public-update.ts composition: emailRegex.test(normalizeEmail(email)) ---
    // Verbatim copy of the handler's local regex (customers/public-update.ts).
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    it("public-update.ts: fullwidth-＠ fails the raw regex but passes once normalized", () => {
        expect(emailRegex.test(FULLWIDTH)).toBe(false);
        expect(emailRegex.test(normalizeEmail(FULLWIDTH))).toBe(true);
    });

    it("public-update.ts: a whitespace-padded valid address passes after normalize (trim)", () => {
        expect(emailRegex.test(normalizeEmail("  customer@example.com  "))).toBe(true);
    });

    it("public-update.ts: normalization does not make an at-less string valid", () => {
        expect(emailRegex.test(normalizeEmail("no-at-sign.example.com"))).toBe(false);
    });
});
