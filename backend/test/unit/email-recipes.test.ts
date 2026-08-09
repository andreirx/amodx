import { describe, it, expect } from "vitest";
import { EMAIL_PROVIDER_RECIPES, deriveEmailDnsValue } from "@amodx/shared";

/**
 * slice email-2 — the recipe DATA (docs/plan-email-onboarding.md §4.2, D-EMAIL-3).
 *
 * These pin the invariants the admin renderer and the read-only checker both depend on.
 * The record VALUES are provider-documentation snapshots, not asserted here — what IS
 * asserted is the SHAPE and the safety-critical couplings:
 *   - the destructive-advice flag (`replacesMailRouting`) is coupled to actually having MX;
 *   - reference-only rows (checkable:false) are the ONLY rows allowed to omit a value, so
 *     the checker never sends a valueless row to DNS and never emits a false verdict;
 *   - `lastVerified` is a real ISO date so the UI can show recipe staleness.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("EMAIL_PROVIDER_RECIPES — catalogue invariants", () => {
    it("has the four ratified providers with unique ids", () => {
        const ids = EMAIL_PROVIDER_RECIPES.map((r) => r.id);
        expect(ids).toEqual(["google-workspace", "microsoft-365", "zoho-mail", "keep-existing"]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("every recipe carries a valid ISO lastVerified date and a label", () => {
        for (const r of EMAIL_PROVIDER_RECIPES) {
            expect(r.label.length).toBeGreaterThan(0);
            expect(r.lastVerified).toMatch(ISO_DATE);
            expect(Number.isNaN(Date.parse(r.lastVerified))).toBe(false);
        }
    });
});

describe("EMAIL_PROVIDER_RECIPES — per-record shape", () => {
    it("every record has a non-empty host and a supported type", () => {
        for (const r of EMAIL_PROVIDER_RECIPES) {
            for (const rec of r.records) {
                expect(rec.host.length).toBeGreaterThan(0);
                expect(["MX", "TXT", "CNAME"]).toContain(rec.type);
            }
        }
    });

    it("a value may be omitted ONLY when the row is provider-generated (checkable:false) or derived", () => {
        for (const r of EMAIL_PROVIDER_RECIPES) {
            for (const rec of r.records) {
                // checkable:false = generated in the console; derive = computed from the domain.
                if (rec.checkable === false || rec.derive) continue;
                expect(rec.value.length, `${r.id} ${rec.type} ${rec.host}`).toBeGreaterThan(0);
            }
        }
    });

    it("MX rows carry a numeric priority", () => {
        for (const r of EMAIL_PROVIDER_RECIPES) {
            for (const rec of r.records) {
                if (rec.type === "MX") expect(typeof rec.priority).toBe("number");
            }
        }
    });

    it("no recipe publishes a DMARC record — DMARC health belongs to email-3 (plan §4.3)", () => {
        for (const r of EMAIL_PROVIDER_RECIPES) {
            for (const rec of r.records) {
                expect(rec.host, `${r.id}`).not.toBe("_dmarc");
                expect(rec.value.toUpperCase()).not.toContain("V=DMARC1");
            }
        }
    });
});

describe("EMAIL_PROVIDER_RECIPES — Microsoft 365 derived MX (server-authoritative, checkable)", () => {
    it("M365 MX is a `derive` row (empty static value) that yields the domain-based target", () => {
        const m365 = EMAIL_PROVIDER_RECIPES.find((r) => r.id === "microsoft-365")!;
        const mx = m365.records.find((rec) => rec.type === "MX")!;
        expect(mx.derive).toBe("m365-mx");
        expect(mx.value).toBe("");            // no static value — it is derived
        expect(mx.checkable).not.toBe(false);  // derived rows ARE checkable
        // dots → dashes + the fixed M365 mail-routing suffix.
        expect(deriveEmailDnsValue("m365-mx", "example.com")).toBe("example-com.mail.protection.outlook.com");
        expect(deriveEmailDnsValue("m365-mx", "shop.brand.co.uk")).toBe("shop-brand-co-uk.mail.protection.outlook.com");
    });
});

describe("EMAIL_PROVIDER_RECIPES — destructive-advice coupling (§4.2 guard)", () => {
    it("replacesMailRouting is true IFF the recipe publishes at least one MX record", () => {
        for (const r of EMAIL_PROVIDER_RECIPES) {
            const hasMx = r.records.some((rec) => rec.type === "MX");
            expect(r.replacesMailRouting, `${r.id}`).toBe(hasMx);
        }
    });

    it("'keep-existing' is the safe no-op recipe: no records, no destructive warning", () => {
        const keep = EMAIL_PROVIDER_RECIPES.find((r) => r.id === "keep-existing")!;
        expect(keep.records).toHaveLength(0);
        expect(keep.replacesMailRouting).toBe(false);
    });
});
