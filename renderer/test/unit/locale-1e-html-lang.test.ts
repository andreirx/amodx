import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
/**
 * LOCALE-1E — the `<html>` element of `app/[siteId]/layout.tsx`, now the root layout (docs/slices/locale-1e.md).
 * `lang` = the language subtag of the tenant's normalised locale (operator decision 2): the cases the serving fixtures
 * do not hold (de-DE, a missing locale) and the missing-tenant branch, which must still render `<html>`/`<body>` around
 * `children`. The config is passed as stored (raw `locale`), so the layout's own normalisation is under test.
 * Real: the layout, the shared helper. Mocked: the DynamoDB reads, Next's runtime-coupled modules, the client components.
 */
const dynamo = vi.hoisted(() => ({ getTenantConfig: vi.fn(), hasActivePopups: vi.fn(async () => false) }));
vi.mock("@/lib/dynamo", () => dynamo);
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }), signIn: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
for (const [path, name] of [
    ["@/components/Providers", "Providers"], ["@/components/ThemeInjector", "ThemeInjector"], ["@/components/Navbar", "Navbar"],
    ["@/components/Analytics", "Analytics"], ["@/components/PaddleLoader", "PaddleLoader"], ["@/components/CookieConsent", "CookieConsent"],
    ["@/components/QuickContact", "QuickContact"], ["@/components/TopBar", "TopBar"], ["@/components/CommerceBar", "CommerceBar"],
    ["@/components/FBPixel", "FBPixel"], ["@/components/PopupManager", "PopupManager"], ["@/components/RecaptchaProvider", "RecaptchaProvider"],
    ["@/components/PageEffectWrapper", "PageEffectWrapper"], ["@/components/ReferralCapture", "ReferralCapture"],
] as const) {
    vi.doMock(path, () => ({ [name]: name === "Providers" ? ({ children }: { children: React.ReactNode }) => children : () => null }));
}

/** React 19's static renderer inserts an empty `<head>` into a full document (Next fills it at serve time). */
const BODY = '<head></head><body class="antialiased min-h-screen bg-white text-gray-900">';

async function documentStart(config: Record<string, unknown> | null) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    const { default: SiteLayout } = await import("@/app/[siteId]/layout");
    const html = renderToStaticMarkup(await SiteLayout({ children: React.createElement("main", null, "page"), params: Promise.resolve({ siteId: "t1" }) }) as any);
    return html.slice(0, html.indexOf(">", html.indexOf("<body")) + 1);
}
const tenant = (extra: Record<string, unknown>) => ({ id: "t1", name: "Atelier", domain: "atelier.test", ...extra });

describe("[1e] <html lang> of the root layout", () => {
    const cases: [string, Record<string, unknown>, string][] = [
        ["no locale (en-US)", {}, "en"], ["en-US", { locale: "en-US" }, "en"], ["en-GB", { locale: "en-GB" }, "en"],
        ["ro-RO", { locale: "ro-RO" }, "ro"], ["ro_RO (normalised)", { locale: "ro_RO" }, "ro"],
        ["de-DE (no de pack: texts English, lang de)", { locale: "de-DE" }, "de"], ["malformed 123", { locale: "123" }, "en"],
    ];
    for (const [name, extra, lang] of cases) {
        it(`[1e] ${name} → lang="${lang}", the body class unchanged`, async () => {
            expect(await documentStart(tenant(extra))).toBe(`<html lang="${lang}">${BODY}`);
        });
    }

    it("[1e] missing tenant record: <html lang=\"en\"><body …> around children (cache-1: children rendered, no not-found here)", async () => {
        dynamo.getTenantConfig.mockResolvedValue(null);
        const { default: SiteLayout } = await import("@/app/[siteId]/layout");
        const html = renderToStaticMarkup(await SiteLayout({ children: React.createElement("main", null, "page"), params: Promise.resolve({ siteId: "gone" }) }) as any);
        expect(html).toBe(`<html lang="en">${BODY}<main>page</main></body></html>`);
    });
});

describe("[1e] the root 404 boundary app/not-found.tsx (ruling LOC1E-404-DOCUMENT = B)", () => {
    it("[1e] writes the document itself: <html lang=\"en\">, the shared body class, Next's built-in 404 UI", async () => {
        const { default: RootNotFound } = await import("@/app/not-found");
        const html = renderToStaticMarkup(React.createElement(RootNotFound));
        // React 19's static renderer hoists the 404 UI's <title> into <head>.
        const start = '<html lang="en"><head><title>404: This page could not be found.</title></head><body class="antialiased min-h-screen bg-white text-gray-900">';
        expect(html.slice(0, start.length)).toBe(start);
        expect(html).toContain("This page could not be found.");
        expect(html.endsWith("</body></html>")).toBe(true);
    });

    it("[1e] the body class has one source: the layout and the 404 boundary import the same constant", async () => {
        const { BODY_CLASS_NAME } = await import("@/lib/document-shell");
        expect(BODY_CLASS_NAME).toBe("antialiased min-h-screen bg-white text-gray-900");
        const { readFileSync } = await import("node:fs");
        for (const file of ["src/app/[siteId]/layout.tsx", "src/app/not-found.tsx"]) {
            const src = readFileSync(file, "utf8");
            expect(src, file).toContain('import { BODY_CLASS_NAME } from "@/lib/document-shell";');
            expect(src, file).not.toContain("antialiased min-h-screen");
        }
    });
});
