import { describe, it, expect } from "vitest";
import { mapDnsResult, normalizeDnsValue } from "../../src/email/dns-map.js";

/**
 * slice email-2 — the DNS-result mapper (docs/plan-email-onboarding.md §4.2, D-EMAIL-4).
 *
 * Pure: no AWS, no DNS, no clock. Runs under `npm run test:unit`.
 *
 * The two load-bearing behaviours pinned here:
 *  1. Comparison is on a CANONICAL form — case + trailing-dot for host names, collapsed
 *     whitespace for TXT — so cosmetic DNS differences are not reported as mismatches.
 *  2. PROPAGATION AMBIGUITY: a `missing` or `error` result is NEVER a permanent verdict.
 *     Its detail text must state that "not published" and "not yet propagated" cannot be
 *     told apart from a single read. If that labelling is dropped, the whole read-only
 *     checker starts lying, so it is asserted directly.
 */

describe("normalizeDnsValue", () => {
    it("lowercases and strips the trailing dot on MX/CNAME host names", () => {
        expect(normalizeDnsValue("MX", "SMTP.Google.COM.")).toBe("smtp.google.com");
        expect(normalizeDnsValue("CNAME", "Autodiscover.Outlook.com.")).toBe("autodiscover.outlook.com");
    });

    it("collapses internal whitespace but preserves case for TXT", () => {
        expect(normalizeDnsValue("TXT", "v=spf1   include:_spf.google.com   ~all"))
            .toBe("v=spf1 include:_spf.google.com ~all");
        // DMARC tag values are case-sensitive in practice — case must NOT be folded.
        expect(normalizeDnsValue("TXT", "v=DMARC1; p=none;")).toBe("v=DMARC1; p=none;");
    });
});

describe("mapDnsResult — match", () => {
    it("matches an MX exchange regardless of case and trailing dot", () => {
        const r = mapDnsResult({ type: "MX", expected: "smtp.google.com", observed: ["SMTP.GOOGLE.COM."] });
        expect(r.status).toBe("match");
    });

    it("matches one of several observed MX records", () => {
        const r = mapDnsResult({
            type: "MX",
            expected: "mx2.zoho.com",
            observed: ["mx.zoho.com.", "mx2.zoho.com.", "mx3.zoho.com."],
        });
        expect(r.status).toBe("match");
    });

    it("matches a TXT SPF record with differing whitespace", () => {
        const r = mapDnsResult({
            type: "TXT",
            expected: "v=spf1 include:_spf.google.com ~all",
            observed: ["v=spf1  include:_spf.google.com  ~all"],
        });
        expect(r.status).toBe("match");
    });
});

describe("mapDnsResult — MX priority (a wrong priority must not read as Published)", () => {
    it("matches when the exchange AND the expected priority both match", () => {
        const r = mapDnsResult({
            type: "MX",
            expected: "smtp.google.com",
            expectedPriority: 1,
            observed: ["SMTP.GOOGLE.COM."],
            observedMx: [{ exchange: "SMTP.GOOGLE.COM.", priority: 1 }],
        });
        expect(r.status).toBe("match");
        expect(r.detail).toContain("priority 1");
    });

    it("flags a mismatch when the exchange matches but the priority is wrong", () => {
        const r = mapDnsResult({
            type: "MX",
            expected: "mx.zoho.com",
            expectedPriority: 10,
            observed: ["mx.zoho.com."],
            observedMx: [{ exchange: "mx.zoho.com.", priority: 20 }],
        });
        expect(r.status).toBe("mismatch");
        expect(r.detail).toContain("priority 20");
        expect(r.detail).toContain("expected 10");
    });

    it("assesses each of several MX rows independently against the shared observed set", () => {
        const observed = ["mx.zoho.com.", "mx2.zoho.com.", "mx3.zoho.com."];
        const observedMx = [
            { exchange: "mx.zoho.com.", priority: 10 },
            { exchange: "mx2.zoho.com.", priority: 20 },
            { exchange: "mx3.zoho.com.", priority: 50 },
        ];
        const first = mapDnsResult({ type: "MX", expected: "mx.zoho.com", expectedPriority: 10, observed, observedMx });
        const second = mapDnsResult({ type: "MX", expected: "mx2.zoho.com", expectedPriority: 20, observed, observedMx });
        const third = mapDnsResult({ type: "MX", expected: "mx3.zoho.com", expectedPriority: 50, observed, observedMx });
        expect([first.status, second.status, third.status]).toEqual(["match", "match", "match"]);
    });
});

describe("mapDnsResult — mismatch", () => {
    it("flags mismatch when records exist but none match, and surfaces observed values", () => {
        const r = mapDnsResult({
            type: "MX",
            expected: "smtp.google.com",
            observed: ["mx1.spatiul.ro.", "mx2.spatiul.ro."],
        });
        expect(r.status).toBe("mismatch");
        expect(r.detail).toContain("mx1.spatiul.ro.");
    });

    it("flags a TXT mismatch when a different SPF is published", () => {
        const r = mapDnsResult({
            type: "TXT",
            expected: "v=spf1 include:_spf.google.com ~all",
            observed: ["v=spf1 include:zoho.com ~all"],
        });
        expect(r.status).toBe("mismatch");
    });
});

describe("mapDnsResult — propagation-ambiguity labelling (the core rule)", () => {
    it("labels an empty result as `missing`, never as a permanent 'not published' verdict", () => {
        const r = mapDnsResult({ type: "MX", expected: "smtp.google.com", observed: [] });
        expect(r.status).toBe("missing");
        // Must state the indistinguishability, not assert absence.
        expect(r.detail).toMatch(/not yet propagated/i);
        expect(r.detail).toMatch(/re-check/i);
    });

    it("labels a lookup error as `error`, explicitly not a verdict about the record", () => {
        const r = mapDnsResult({
            type: "TXT",
            expected: "v=DMARC1; p=none;",
            observed: [],
            lookupError: "ETIMEOUT",
        });
        expect(r.status).toBe("error");
        expect(r.detail).toContain("ETIMEOUT");
        expect(r.detail).toMatch(/not a verdict/i);
        expect(r.detail).toMatch(/not yet propagated/i);
    });

    it("prefers `error` over `missing` when the lookup itself failed", () => {
        // observed is empty AND there is a lookupError — the error path wins, because an
        // empty result under a failed lookup tells us nothing about publication.
        const r = mapDnsResult({ type: "CNAME", expected: "autodiscover.outlook.com", observed: [], lookupError: "SERVFAIL" });
        expect(r.status).toBe("error");
    });
});
