import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
// Test-only framework boundary: use the installed resolver AND serializer that emit <link rel="canonical">.
// No Next runtime/server, AWS, environment file or socket is used.
import { resolveAlternates } from "next/dist/lib/metadata/resolvers/resolve-basics";
import { createMetadataElements } from "next/dist/lib/metadata/metadata-elements";

const db = vi.hoisted(() => ({ getTenantConfig: vi.fn(), getContentBySlug: vi.fn(), getTranslationSetMembers: vi.fn() }));
vi.mock("@/lib/dynamo", () => ({ ...db, isTranslationKey: () => false }));
vi.mock("@/components/RenderBlocks", () => ({ RenderBlocks: () => null }));
vi.mock("@/components/CommentsSection", () => ({ CommentsSection: () => null }));
vi.mock("@/components/ThemeInjector", () => ({ ThemeInjector: () => null }));
vi.mock("next/script", () => ({ default: ({ type, ...props }: any) => type === "application/ld+json" ? createElement("script", { type, ...props }) : null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/about" }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { SitePage, buildSitePageMetadata } from "@/components/SitePage";

let config: any;
let content: any;
beforeEach(() => {
    config = { id: "t1", domain: "tenant.test", name: "Tenant", status: "LIVE", integrations: {}, theme: {}, languages: ["ro"] };
    content = { id: "c1", title: "A & B", status: "Published", blocks: [], accessPolicy: { type: "Public" }, commentsMode: "Hidden" };
    db.getTenantConfig.mockImplementation(async () => config);
    db.getContentBySlug.mockImplementation(async () => content);
});
const page = (slug: string[] | undefined, basePath = "", siteId = "tenant.test") => SitePage({ siteId, slug, preview: false, basePath, sessionToken: null, query: {}, cacheable: basePath === "" });
const context = { trailingSlash: false, isStaticMetadataRouteFile: false };

describe("HYDRATION-1 real SitePage server HTML", () => {
    for (const [name, slug, basePath, domain, siteId, literalCanonical] of [
        ["domain root", undefined, "", "tenant.test", "tenant.test", "https://tenant.test"],
        ["domain page", ["about"], "", "tenant.test", "tenant.test", "https://tenant.test/about"],
        ["preview by tenant id", ["about"], "/_site/t1", "tenant.test", "t1", "https://tenant.test/about"],
        ["extra language", ["ro", "despre"], "", "tenant.test", "tenant.test", "https://tenant.test/ro/despre"],
        ["Unicode path", ["ro", "întrebări"], "", "tenant.test", "tenant.test", "https://tenant.test/ro/%C3%AEntreb%C4%83ri"],
        ["mixed-case hostname", ["about"], "", "Tenant.TEST", "Tenant.TEST", "https://tenant.test/about"],
    ] as const) {
        it(`H1 ${name}: share links and JSON-LD equal the canonical emitted by Next`, async () => {
            config.domain = domain;
            const path = slug ? "/" + slug.join("/") : "/";
            const metadata = await buildSitePageMetadata({ siteId, slug: slug ? [...slug] : undefined, query: {} });
            if (!(metadata.metadataBase instanceof URL)) throw new Error("SitePage metadata must supply a URL metadataBase");
            const alternates = await resolveAlternates(metadata.alternates, metadata.metadataBase, Promise.resolve(path), context);
            const head = renderToString(createMetadataElements({ alternates } as Parameters<typeof createMetadataElements>[0]));
            const canonical = /<link rel="canonical" href="([^"]+)"\/>/.exec(head)?.[1];
            expect(canonical).toBe(literalCanonical);
            // Independent old raw input through Next: prevents a shared mistaken normalization from passing.
            const fromRaw = await resolveAlternates({ canonical: `https://${domain}${path === "/" ? "" : path}` }, new URL(`https://${domain}`), Promise.resolve(path), context);
            expect(fromRaw?.canonical?.url).toBe(canonical);
            expect(metadata.alternates?.canonical).toBe(canonical);
            const html = renderToString(await page(slug ? [...slug] : undefined, basePath, siteId));
            expect(html).toContain('class="flex items-center gap-2 my-8 pt-8 border-t border-border"');
            const schema = /<script[^>]*id="json-ld-schema"[^>]*>([^<]*)<\/script>/.exec(html)?.[1];
            expect(schema).toBeDefined();
            expect(JSON.parse(schema!).url).toBe(canonical);
            const url = encodeURIComponent(canonical!);
            for (const link of [
                `https://twitter.com/intent/tweet?text=A%20%26%20B&amp;url=${url}`,
                `https://www.linkedin.com/shareArticle?mini=true&amp;url=${url}&amp;title=A%20%26%20B`,
                `https://www.facebook.com/sharer/sharer.php?u=${url}`,
                `mailto:?subject=A%20%26%20B&amp;body=Check this out: ${url}`,
            ]) expect(html).toContain(`href="${link}"`);
        });
    }
    it("normalization cannot parse a malformed host: SitePage render does not throw and keeps the raw address, not an invented origin", async () => {
        config.domain = "[";
        const raw = "https://[/about";
        expect(() => new URL(raw)).toThrow(TypeError);
        const html = renderToString(await page(["about"]));
        expect(html).toContain(`url=${encodeURIComponent(raw)}`);
        const schema = /<script[^>]*id="json-ld-schema"[^>]*>([^<]*)<\/script>/.exec(html)?.[1];
        expect(JSON.parse(schema!).url).toBe(raw);
        // This is a render-failure preservation test, NOT a claim of a valid canonical for invalid configuration.
        // The existing metadataBase URL validation is not changed by this helper.
    });
    for (const flag of ["hideSharing", "hideSocialSharing"]) {
        it(`H3 ${flag}: no share block in server HTML`, async () => {
            if (flag === "hideSharing") content.hideSharing = true;
            else config.hideSocialSharing = true;
            const html = renderToString(await page(["about"]));
            expect(html).not.toContain('class="flex items-center gap-2 my-8 pt-8 border-t border-border"');
            expect(html).not.toContain("twitter.com/intent/tweet");
        });
    }
});
