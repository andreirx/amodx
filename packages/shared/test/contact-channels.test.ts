import { describe, it, expect } from "vitest";
import { ContactChannelsSchema, TenantConfigSchema } from "../src/index.js";

/**
 * CAT-QUOTE-1 (docs/slices/cat-quote-1.md § 3 item 1, packet rule 2) — the tenant's visitor contact channels and the
 * interest-list address. What the schema accepts and refuses; `PUT /settings` applies the same schema
 * (backend/test/unit/cat-quote-settings.test.ts). Pure.
 */

const MINIMAL_TENANT = { id: "t", domain: "t.test", name: "T", plan: "Free", createdAt: "2026-01-01T00:00:00.000Z" } as const;

describe("ContactChannelsSchema", () => {
    it("accepts every channel absent, one channel, or all three", () => {
        expect(ContactChannelsSchema.safeParse({}).success).toBe(true);
        expect(ContactChannelsSchema.safeParse({ email: "office@glam.test" }).success).toBe(true);
        expect(ContactChannelsSchema.safeParse({ phone: "+40 721-000 111", whatsapp: "40721000111", email: "a@b.test" }).success).toBe(true);
    });

    it("a number: only digits, \"+\", spaces and dashes, at least one digit, trimmed and non-empty", () => {
        for (const bad of ["", " ", "+40 721 ", " 0721", "0721.000", "(0721)", "tel:0721", "+", "- -", "0721\n000"]) {
            expect(ContactChannelsSchema.safeParse({ phone: bad }).success, JSON.stringify(bad)).toBe(false);
            expect(ContactChannelsSchema.safeParse({ whatsapp: bad }).success, JSON.stringify(bad)).toBe(false);
        }
        expect(ContactChannelsSchema.safeParse({ phone: 721 }).success).toBe(false);
    });

    it("the e-mail must be an e-mail address; an unknown channel is refused", () => {
        expect(ContactChannelsSchema.safeParse({ email: "office" }).success).toBe(false);
        expect(ContactChannelsSchema.safeParse({ email: "" }).success).toBe(false);
        expect(ContactChannelsSchema.safeParse({ fax: "0721" }).success).toBe(false);
    });

    it("the tenant config: both attributes optional (absent on every existing tenant); interestListEmail is an e-mail", () => {
        const t = TenantConfigSchema.parse(MINIMAL_TENANT);
        expect(t.contactChannels).toBeUndefined();
        expect(t.interestListEmail).toBeUndefined();
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, interestListEmail: "lists@glam.test", contactChannels: { phone: "0721" } }).success).toBe(true);
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, interestListEmail: "lists" }).success).toBe(false);
        expect(TenantConfigSchema.safeParse({ ...MINIMAL_TENANT, contactChannels: { phone: "x" } }).success).toBe(false);
    });
});
