import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EN_LANGUAGE_PACK, RO_LANGUAGE_PACK, fillTemplate } from "@amodx/shared";

/**
 * SCHED-1G2 (docs/slices/sched-1.md § 10.1, § 8.2, § 9.1) — the pure parts of the hosted booking pages:
 *  - `bookingRoute` (the middleware branch): every spelling of the internal segment (G5), the public addresses, the
 *    near-miss paths that must stay on the old code path (rule 1);
 *  - `booking-ui.ts`: refusal texts, `fillText` = `fillTemplate`, time helpers, `takeLinkToken` (G7 browser half);
 *  - `booking-text.ts`: page language and texts (G3, G12);
 *  - `mapTenant`'s reCAPTCHA mapping (G8), through the real `getTenantConfig` with only the document client replaced;
 *  - the structural rule of the booking tree (G6 + the measured chunk rule): no site script, no runtime
 *    `@amodx/shared` import in browser code.
 */

const store = vi.hoisted(() => ({ item: null as null | Record<string, unknown> }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    return {
        ...real,
        DynamoDBDocumentClient: {
            from: () => ({ send: async (c: any) => (c.constructor.name === "QueryCommand" ? { Items: [] } : { Item: store.item ?? undefined }) }),
        },
    };
});

import { bookingBaseOf, bookingInternalPath, bookingRoute } from "@/lib/booking-path";
import {
    REFUSAL_TEXT, addDays, fillText, formatInstantWithZone, localDateIn, newBookingHref, refusalRecovery, refusalTextKey, takeLinkToken,
} from "@/lib/booking-ui";
import { bookingLanguage, bookingTexts } from "@/lib/booking-text";
import { getTenantConfig } from "@/lib/dynamo";

describe("SCHED-1G2 bookingRoute — the middleware branch (G1, G2, G5, rule 1)", () => {
    it("G5: the internal segment in every spelling is `internal` (encoded, double-encoded, mixed case, doubled slash)", () => {
        for (const p of ["/_book", "/_book/", "/_book/t1/manage", "/%5Fbook/t1", "/%5fbook/t1", "/_BOOK/t1", "/_Book", "/%255Fbook/t1",
            "//_book/t1/manage", "///_book", "/%5F%62ook/t1"]) {
            expect(bookingRoute(p, false), p).toEqual({ kind: "internal" });
            expect(bookingRoute(p, true), `${p} (preview host)`).toEqual({ kind: "internal" });
        }
    });
    it("G1: /_booking[/rest] is a domain address; rest kept as written", () => {
        expect(bookingRoute("/_booking", false)).toEqual({ kind: "domain", rest: "" });
        expect(bookingRoute("/_booking/manage", false)).toEqual({ kind: "domain", rest: "/manage" });
        expect(bookingRoute("/_booking/api/offer", true)).toEqual({ kind: "domain", rest: "/api/offer" });
        expect(bookingRoute("/_booking/feed/r1/s.ics", false)).toEqual({ kind: "domain", rest: "/feed/r1/s.ics" });
    });
    it("G2: /_site/<id>/_booking[/rest] is a preview address on a preview host only", () => {
        expect(bookingRoute("/_site/t1/_booking", true)).toEqual({ kind: "preview", tenantId: "t1", rest: "" });
        expect(bookingRoute("/_site/t1/_booking/manage", true)).toEqual({ kind: "preview", tenantId: "t1", rest: "/manage" });
        expect(bookingRoute("/_site/t1/_booking/manage", false)).toEqual({ kind: "none" });
        expect(bookingRoute("/_site//_booking", true)).toEqual({ kind: "none" });
    });
    it("rule 1: near-miss paths are `none` (the request takes the code path of HEAD)", () => {
        for (const p of ["/", "/_bookingx", "/_bookings/manage", "/_Booking", "/x/_booking", "/%5Fbooking", "/_site/t1/x/_booking",
            "/_site/t1/_bookingx", "/booking", "/_dyn/x", "/api/x", "/_bookx", "/%zz"]) {
            expect(bookingRoute(p, true), p).toEqual({ kind: "none" });
        }
    });
    it("the rewrite target and the browser's public base", () => {
        expect(bookingInternalPath("shop.example", "/manage")).toBe("/_book/shop.example/manage");
        expect(bookingInternalPath("t1", "")).toBe("/_book/t1");
        expect(bookingBaseOf("/_booking/manage")).toBe("/_booking");
        expect(bookingBaseOf("/_booking")).toBe("/_booking");
        expect(bookingBaseOf("/_site/t1/_booking/manage")).toBe("/_site/t1/_booking");
    });
});

describe("SCHED-1G2 booking-ui — texts, time, link token", () => {
    it("every refusal code of § 10.2, § 8.4 and the proxy has a visitor text (not the generic one); an unknown code → errGeneric", () => {
        const codes = ["invalid", "notAvailable", "forbidden", "notFound", "verificationRequired", "verificationFailed", "verificationUnavailable",
            "slotTaken", "notOnGrid", "inPast", "beyondHorizon", "notEligible", "outsideAvailability", "resourceUnavailable", "runFull", "runClosed",
            "runCancelled", "runStarted", "languageMismatch", "intentReused", "intentClosed", "tooManyForEmail", "tooManyFromAddress", "busy",
            "mailFailed", "linkNotValid", "expired", "cancelled", "tooLate", "notConfirmed", "paidContactTenant", "stale", "rangeInverted",
            "rangeTooLong", "storedDataInvalid", "internal", "unavailable", "tooLarge"];
        for (const code of codes) {
            expect(refusalTextKey(code), code).not.toBe("errGeneric");
            expect(EN_LANGUAGE_PACK.booking[refusalTextKey(code)], code).toBeTruthy();
        }
        expect(Object.keys(REFUSAL_TEXT).sort()).toEqual([...codes].sort());
        expect(refusalTextKey("somethingNew")).toBe("errGeneric");
        expect(refusalTextKey(undefined)).toBe("errGeneric");
        expect(refusalTextKey("toString")).toBe("errGeneric");
    });
    it("fillText gives the same text as the shared fillTemplate", () => {
        const cases: [string, Record<string, string | number>][] = [
            ["{a} and {b}", { a: 1, b: "x" }], ["{missing} stays", {}], ["no placeholders", { a: 1 }], ["{a}{a}", { a: "z" }], ["{toString}", {}],
        ];
        for (const [t, v] of cases) expect(fillText(t, v)).toBe(fillTemplate(t, v));
    });
    it("local dates in the tenant's zone and the zone named", () => {
        // 2026-12-01T23:30Z is already Dec 2 in Bucharest (UTC+2) and still Dec 1 in Los Angeles.
        const t = Date.parse("2026-12-01T23:30:00Z");
        expect(localDateIn(t, "Europe/Bucharest")).toBe("2026-12-02");
        expect(localDateIn(t, "America/Los_Angeles")).toBe("2026-12-01");
        expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
        expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
        expect(formatInstantWithZone("2026-12-01T08:00:00Z", "en-GB", "Europe/Bucharest")).toMatch(/10:00.*\(Europe\/Bucharest\)$/);
    });
    it("G7 takeLinkToken: absent fragment → null and the address bar is not touched", () => {
        const replaceState = vi.fn();
        expect(takeLinkToken({ hash: "", pathname: "/_booking/manage", search: "" }, { replaceState })).toBeNull();
        expect(replaceState).not.toHaveBeenCalled();
    });
    it("G7 takeLinkToken: valid `#t=` → the token, and the fragment is removed (path and query kept)", () => {
        const token = "A".repeat(20) + "b_-" + "9".repeat(20);
        const replaceState = vi.fn();
        expect(takeLinkToken({ hash: `#t=${token}`, pathname: "/_site/t1/_booking/manage", search: "?lang=ro" }, { replaceState })).toBe(token);
        expect(replaceState).toHaveBeenCalledWith(null, "", "/_site/t1/_booking/manage?lang=ro");
    });
    it("G7 takeLinkToken: malformed fragment → null, and the fragment is still removed", () => {
        for (const hash of ["#t=short", "#x=" + "A".repeat(43), "#t=" + "A".repeat(42) + "=", "#garbage"]) {
            const replaceState = vi.fn();
            expect(takeLinkToken({ hash, pathname: "/_booking/manage", search: "" }, { replaceState }), hash).toBeNull();
            expect(replaceState).toHaveBeenCalledWith(null, "", "/_booking/manage");
        }
    });
});

describe("SCHED-1G2 booking-text — page language (G3) and texts (G12)", () => {
    it("?lang= absent / valid / unknown / malformed", () => {
        expect(bookingLanguage(undefined, "en-US")).toEqual({ language: "en", locale: "en-US" });
        expect(bookingLanguage(undefined, "ro-RO")).toEqual({ language: "ro", locale: "ro-RO" });
        expect(bookingLanguage("ro", "en-US")).toEqual({ language: "ro", locale: "ro-RO" });
        expect(bookingLanguage("en-GB", "ro-RO")).toEqual({ language: "en", locale: "en-US" });
        expect(bookingLanguage("RO", "en-GB")).toEqual({ language: "ro", locale: "ro-RO" });
        expect(bookingLanguage("xx", "ro-RO")).toEqual({ language: "ro", locale: "ro-RO" });
        expect(bookingLanguage("<script>", "en-US")).toEqual({ language: "en", locale: "en-US" });
        expect(bookingLanguage("", undefined)).toEqual({ language: "en", locale: "en-US" });
        expect(bookingLanguage(undefined, "fr-FR")).toEqual({ language: "en", locale: "en-US" });
    });
    it("texts: the pack's own, English for a language without a pack, never an empty text", () => {
        expect(bookingTexts("ro").bookTitle).toBe("Programare");
        expect(bookingTexts("en")).toEqual(EN_LANGUAGE_PACK.booking);
        expect(bookingTexts("fr")).toEqual(EN_LANGUAGE_PACK.booking);
        for (const v of Object.values(bookingTexts("ro"))) expect(v.length).toBeGreaterThan(0);
    });
    it("G12: EN and RO booking texts are complete, with the same placeholders per key", () => {
        const en = EN_LANGUAGE_PACK.booking as Record<string, string>;
        const ro = (RO_LANGUAGE_PACK.booking ?? {}) as Record<string, string>;
        expect(Object.keys(ro).sort()).toEqual(Object.keys(en).sort());
        const holes = (t: string) => (t.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();
        for (const key of Object.keys(en)) {
            expect(en[key].trim().length, key).toBeGreaterThan(0);
            expect(ro[key].trim().length, key).toBeGreaterThan(0);
            expect(holes(ro[key]), key).toEqual(holes(en[key]));
        }
    });
});

describe("SCHED-1G2 S1G2-R4 — refusal recovery rule", () => {
    it("R4 class rule: no booking text, in any pack, asks the visitor to reload the page", () => {
        for (const pack of [EN_LANGUAGE_PACK.booking, RO_LANGUAGE_PACK.booking ?? {}] as Record<string, string>[]) {
            for (const [key, value] of Object.entries(pack)) expect(value, key).not.toMatch(/reload|refresh the page|reîncarc/i);
        }
    });
    it("R4 every code whose text asks the visitor to act has a page action: new booking (expired, intentReused, intentClosed), refresh (stale)", () => {
        expect(["expired", "intentReused", "intentClosed"].map(refusalRecovery)).toEqual(["newBooking", "newBooking", "newBooking"]);
        expect(refusalRecovery("stale")).toBe("refresh");
        expect([undefined, "slotTaken", "linkNotValid", "somethingNew"].map(refusalRecovery)).toEqual(["none", "none", "none", "none"]);
    });
    it("R4 newBookingHref: the page's base, `lang` and `frame` kept once, nothing else (never a token)", () => {
        expect(newBookingHref({ pathname: "/_booking/manage", search: "" }, "/_booking")).toBe("/_booking");
        expect(newBookingHref({ pathname: "/_booking/manage", search: "?lang=ro&frame=1&t=x&lang=en" }, "/_booking")).toBe("/_booking?frame=1");
        expect(newBookingHref({ pathname: "/_site/t1/_booking/manage", search: "?lang=ro" }, "/_site/t1/_booking")).toBe("/_site/t1/_booking?lang=ro");
    });
});

describe("SCHED-1G2 mapTenant — one reCAPTCHA key pair (§ 9.1, G8)", () => {
    beforeEach(() => { process.env.TABLE_NAME = "sched-1g-unit"; });
    const recaptchaOf = async (recaptcha: unknown) => {
        store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "T", ...(recaptcha === undefined ? {} : { recaptcha }) };
        return (await getTenantConfig("t1"))!.recaptcha;
    };
    it("both keys stored → the site key only (never the secret or the threshold)", async () => {
        expect(await recaptchaOf({ enabled: false, siteKey: "site", secretKey: "secret", threshold: 0.7 })).toEqual({ siteKey: "site" });
    });
    it("one key, an empty key, no record, or not an object → absent (the deployment key)", async () => {
        expect(await recaptchaOf({ siteKey: "site", threshold: 0.5 })).toBeUndefined();
        expect(await recaptchaOf({ secretKey: "secret" })).toBeUndefined();
        expect(await recaptchaOf({ siteKey: "site", secretKey: "" })).toBeUndefined();
        expect(await recaptchaOf({ siteKey: "", secretKey: "secret" })).toBeUndefined();
        expect(await recaptchaOf(undefined)).toBeUndefined();
        expect(await recaptchaOf("site")).toBeUndefined();
        expect(await recaptchaOf(null)).toBeUndefined();
    });
});

describe("SCHED-1G3 mapTenant — the scheduling switch (read by lib/booking-tenant.ts)", () => {
    beforeEach(() => { process.env.TABLE_NAME = "sched-1g-unit"; });
    const mapped = async (extra: Record<string, unknown>) => {
        store.item = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "T", ...extra };
        return (await getTenantConfig("t1"))!;
    };
    it("exactly `true` → `schedulingEnabled: true`", async () => {
        expect((await mapped({ schedulingEnabled: true })).schedulingEnabled).toBe(true);
    });
    it("absent, `false`, or not a boolean → the key is absent (off), so a record without scheduling maps as before", async () => {
        for (const extra of [{}, { schedulingEnabled: false }, { schedulingEnabled: "true" }, { schedulingEnabled: 1 }, { schedulingEnabled: null }]) {
            expect("schedulingEnabled" in (await mapped(extra)), JSON.stringify(extra)).toBe(false);
        }
    });
    it("the other scheduling attributes are not mapped", async () => {
        const config = await mapped({ schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" }, schedulingEmailConfig: { templates: {} } });
        expect("scheduling" in config).toBe(false);
        expect("schedulingEmailConfig" in config).toBe(false);
    });
});

describe("SCHED-1G2 the booking tree's structural rules (G6; the measured chunk rule)", () => {
    // `path.join`, not `new URL`: a URL would decode the folder name `%5Fbook` to `_book`.
    const TREE = path.join(fileURLToPath(new URL("../../src/app/", import.meta.url)), "%5Fbook");
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? files(p) : [p];
    });
    const sources = files(TREE).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => ({ f, src: readFileSync(f, "utf8") }));
    const imports = (src: string) => [...src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm)].map((m) => ({ typeOnly: !!m[1], from: m[2] }));

    it("precondition: the tree has its layout, pages, handlers and components", () => {
        expect(sources.length).toBeGreaterThanOrEqual(10);
    });
    it("no module of the tree imports a site script or site chrome (Analytics, Paddle, pixel, cookie banner, popups, referral beacon, navbar, footer, providers, ThemeInjector, RecaptchaProvider)", () => {
        const banned = /@\/components\/(Analytics|PaddleLoader|FBPixel|CookieConsent|PopupManager|ReferralCapture|Navbar|Providers|TopBar|CommerceBar|QuickContact|ThemeInjector|RecaptchaProvider)\b/;
        for (const { f, src } of sources) for (const i of imports(src)) expect(banned.test(i.from), `${f}: ${i.from}`).toBe(false);
    });
    it("browser modules of the tree (and the lib modules they use) import `@amodx/shared` for types only", () => {
        const browser = sources.filter(({ src }) => /^["']use client["'];/m.test(src));
        expect(browser.length).toBeGreaterThanOrEqual(3);
        const libs = ["booking-ui.ts", "booking-path.ts"].map((n) => {
            const f = fileURLToPath(new URL(`../../src/lib/${n}`, import.meta.url));
            return { f, src: readFileSync(f, "utf8") };
        });
        const api = sources.find(({ f }) => f.endsWith(path.join("_components", "api.ts")))!;
        for (const { f, src } of [...browser, ...libs, api]) {
            for (const i of imports(src)) {
                if (i.from === "@amodx/shared") expect(i.typeOnly, `${f}: runtime import of @amodx/shared`).toBe(true);
                expect(i.from.startsWith("@/components/"), `${f}: ${i.from}`).toBe(false);
            }
        }
    });
});

describe("SCHED-1G2 G12 — the coverage rule for the booking texts (locale-1 § 16.2 item 5)", () => {
    const REPO = fileURLToPath(new URL("../../../", import.meta.url));
    const cov = JSON.parse(readFileSync(path.join(REPO, "renderer/test/serving-contract/locale-1/sched-1g/coverage.json"), "utf8")) as {
        allocatedKeys: Record<string, string[]>; bookingKeys: string[]; checks: Record<string, { test: string; case: string }[]>;
    };
    it("the coverage file lists exactly the booking keys of the English pack", () => {
        expect([...cov.bookingKeys].sort()).toEqual(Object.keys(EN_LANGUAGE_PACK.booking).sort());
        expect(cov.allocatedKeys).toEqual({ site: [], catalog: [], commerce: [] });
    });
    it("every booking key maps to at least one check, in an existing test file that has that test", () => {
        const problems: string[] = [];
        for (const key of cov.bookingKeys) {
            const checks = cov.checks[`booking.${key}`] ?? [];
            if (checks.length === 0) problems.push(`booking.${key}: no check`);
            for (const c of checks) {
                let src: string;
                try { src = readFileSync(path.join(REPO, c.test), "utf8"); } catch { problems.push(`booking.${key}: ${c.test} does not exist`); continue; }
                if (!src.includes(c.case)) problems.push(`booking.${key}: ${c.test} has no test "${c.case}"`);
            }
        }
        expect(problems).toEqual([]);
    });
});
