import { describe, it, expect } from "vitest";
import { isFirstPartyWrite } from "@/lib/origin-guard";

/**
 * STATIC-1 — `src/lib/origin-guard.ts`: the same-origin gate on the anonymous
 * credential-free write proxies (/api/consent, /api/contact, /api/leads).
 *
 * BOTH DIRECTIONS are the point of the test: the hardening is only correct if it
 * simultaneously (a) rejects the cross-site / opaque-origin sandbox write that STATIC-1's
 * barrier exists to stop, and (b) never rejects the site's own same-origin form. A guard
 * that only did (a) would be trivially "secure" by breaking every real form.
 *
 * A standalone `new Headers()` has guard "none", so it will not strip the Forbidden
 * `sec-fetch-site` header the way a `new Request(...)` would — that is why the guard is
 * typed against `{ headers: Headers }` and driven with raw Headers here.
 */
const withHeaders = (h: Record<string, string>) => ({ headers: new Headers(h) });

describe("isFirstPartyWrite — ACCEPTED (legitimate first-party callers)", () => {
    it("accepts a same-origin form POST (Origin == host, Sec-Fetch-Site same-origin)", () => {
        expect(isFirstPartyWrite(withHeaders({
            host: "acme.test",
            origin: "https://acme.test",
            "sec-fetch-site": "same-origin",
        }))).toBe(true);
    });

    it("accepts behind CloudFront where the public host arrives as x-forwarded-host", () => {
        // Origin is the public site; `host` is the Lambda/origin host — must still pass.
        expect(isFirstPartyWrite(withHeaders({
            host: "abc123.lambda-url.eu-central-1.on.aws",
            "x-forwarded-host": "acme.test",
            origin: "https://acme.test",
            "sec-fetch-site": "same-origin",
        }))).toBe(true);
    });

    it("accepts localhost dev with a port in host/origin", () => {
        expect(isFirstPartyWrite(withHeaders({
            host: "localhost:3000",
            origin: "http://localhost:3000",
            "sec-fetch-site": "same-origin",
        }))).toBe(true);
    });

    it("accepts an old-browser same-origin POST that omits Sec-Fetch-Site (Origin only)", () => {
        expect(isFirstPartyWrite(withHeaders({
            host: "acme.test",
            origin: "https://acme.test",
        }))).toBe(true);
    });

    it("accepts a non-browser caller that sends neither Origin nor Sec-Fetch-Site", () => {
        // Not a browser cross-site write; blocking it buys no isolation vs the sandbox threat.
        expect(isFirstPartyWrite(withHeaders({ host: "acme.test" }))).toBe(true);
    });

    it("accepts Sec-Fetch-Site: none (user-initiated navigation, not a scripted write)", () => {
        expect(isFirstPartyWrite(withHeaders({
            host: "acme.test",
            "sec-fetch-site": "none",
        }))).toBe(true);
    });
});

describe("isFirstPartyWrite — REJECTED (cross-site / opaque-origin sandbox writes)", () => {
    it("rejects the STATIC-1 sandbox frame: Origin=null, Sec-Fetch-Site=cross-site", () => {
        expect(isFirstPartyWrite(withHeaders({
            host: "acme.test",
            "x-forwarded-host": "acme.test",
            origin: "null",
            "sec-fetch-site": "cross-site",
        }))).toBe(false);
    });

    it("rejects a cross-site attacker origin (Sec-Fetch-Site=cross-site)", () => {
        expect(isFirstPartyWrite(withHeaders({
            host: "acme.test",
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
        }))).toBe(false);
    });

    it("rejects a foreign Origin even when Sec-Fetch-Site is absent (Origin gate)", () => {
        expect(isFirstPartyWrite(withHeaders({
            host: "acme.test",
            origin: "https://evil.example",
        }))).toBe(false);
    });

    it("rejects Origin=null even when Sec-Fetch-Site is absent", () => {
        expect(isFirstPartyWrite(withHeaders({
            host: "acme.test",
            origin: "null",
        }))).toBe(false);
    });

    it("rejects Sec-Fetch-Site: same-site (cross-origin but same registrable site)", () => {
        expect(isFirstPartyWrite(withHeaders({
            host: "acme.test",
            origin: "https://sub.acme.test",
            "sec-fetch-site": "same-site",
        }))).toBe(false);
    });
});
