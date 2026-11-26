import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { resolveLocaleStrings } from "@amodx/shared";
import { SocialShare } from "@/components/SocialShare";
import { deriveHydration1ExpectedBody, expectedShareHtml, readHydration1ExpectedCaptures } from "../serving-contract/hydration-1-expected.mjs";
import { checkExpected } from "../serving-contract/locale-1/proof.mjs";
import { maskBody, readCaptures, splitFlight } from "../serving-contract/cm1-byte-identity.mjs";

const sets = ["cm1-byte-identity/baseline", "cm1-byte-identity/control-de4ad52", ...["cdl-2", "variant-gallery-1", "theme-1", "quote-1", "1e"].map((s) => `locale-1/${s}/before`), "locale-1/1e/before-404"];
const dir = (s: string) => fileURLToPath(new URL(`../serving-contract/${s}/`, import.meta.url));

describe("HYDRATION-1 derived serving expectations (no server)", () => {
    for (const locale of ["en-US", "ro-RO"]) {
        it(`frozen expected share HTML equals real server markup (${locale}, escaping, no window)`, () => {
            const props = { title: 'A & <B> "C"', url: "https://tenant.test/ro/despre", strings: resolveLocaleStrings({ locale }).strings.site };
            expect(expectedShareHtml(props)).toBe(renderToString(createElement(SocialShare, props)));
        });
    }
    for (const set of sets) {
        it(`derives only sharing pages, every captured canonical is present: ${set}`, async () => {
            const before = await readCaptures(dir(set));
            const derived = await readHydration1ExpectedCaptures(dir(set));
            for (let i = 0; i < before.captures.length; i++) {
                const b = before.captures[i];
                const a = derived.captures[i];
                expect(a.status).toBe(b.status);
                expect(a.contentType).toBe(b.contentType);
                if (a.body !== b.body) {
                    expect(a.body).toContain('class="flex items-center gap-2 my-8 pt-8 border-t border-border"');
                    expect(splitFlight(a.body).flight).toContain('"url":');
                }
            }
        });
    }
    for (const sharing of [false, true]) {
        it(`normalizes only the root JSON-LD url, using the recorded canonical; sharing=${sharing}`, () => {
            const rawUrl = "https://Tenant.TEST/ro/întrebări";
            const url = "https://tenant.test/ro/%C3%AEntreb%C4%83ri";
            const schema = { "@context": "https://schema.org", "@type": "WebPage", url: rawUrl, sameAs: rawUrl, nested: { url: rawUrl } };
            const script = ["$", "$L2", null, { id: "json-ld-schema", type: "application/ld+json", dangerouslySetInnerHTML: { __html: JSON.stringify(schema) } }];
            const share = ["$", "div", null, { className: "max-w-4xl mx-auto px-6", children: ["$", "$L1", null, { title: "Page" }] }];
            const flight = `1:I[1,[],"SocialShare"]\n0:${JSON.stringify(["$", "main", null, { children: [script, ...(sharing ? [share] : [])] }])}\n`;
            const html = `<link rel="canonical" href="${url}"/>${sharing ? '<div class="max-w-4xl mx-auto px-6"></div>' : ""}`;
            const body = `${html}<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`;
            const modules = { "1": "[project]/renderer/src/components/SocialShare.tsx" };
            const derived = deriveHydration1ExpectedBody(body, modules);
            const after = splitFlight(derived);
            const row = JSON.parse(after.flight.split("\n").find((r: string) => r.startsWith("0:"))!.slice(2));
            const afterSchema = JSON.parse(row[3].children[0][3].dangerouslySetInnerHTML.__html);
            expect(afterSchema).toEqual({ ...schema, url });
            if (!sharing) expect(after.html).toBe(html);
            else expect(after.html).toContain(expectedShareHtml({ title: "Page", url }));
            // A wrong JSON-LD URL stays visible to the candidate detector; only EXPECTED data was derived.
            const mutatedFlight = after.flight.replace(JSON.stringify(JSON.stringify(afterSchema)), JSON.stringify(JSON.stringify({ ...afterSchema, url: "https://wrong.test" })));
            expect(mutatedFlight).not.toBe(after.flight);
            const mutant = `${after.html}<script>self.__next_f.push([1,${JSON.stringify(mutatedFlight)}])</script>`;
            expect(mutant).not.toBe(derived);
            const side = { buildId: "test", clientModules: modules };
            expect(maskBody(mutant, side).masked).not.toBe(maskBody(derived, side).masked);
            expect(() => deriveHydration1ExpectedBody(body.replaceAll("Tenant.TEST/ro/întrebări", "other.test/about"), modules)).toThrow(/alternate spelling/);
        });
    }
    it("missing canonical or changed wrapper fails closed; candidate markup/prop/text mutations are NOT masked", async () => {
        const before = await readCaptures(dir("locale-1/cdl-2/before"));
        const b = before.captures.find((c: any) => c.tenant === "content" && c.path === "/about")!;
        expect(() => deriveHydration1ExpectedBody(b.body.replace(/<link rel="canonical"[^>]+>/, ""), before.clientModules)).toThrow(/canonical/);
        expect(() => deriveHydration1ExpectedBody(b.body.replace('<div class="max-w-4xl mx-auto px-6"></div>', ""), before.clientModules)).toThrow(/wrapper/);
        const a = deriveHydration1ExpectedBody(b.body, before.clientModules);
        const expected = maskBody(a, before).masked;
        expect(checkExpected(before, b.body, before, a, [
            { category: 3, before: "", after: expectedShareHtml({ title: "cm1-content about", url: "https://cm1-content.serving-contract.test/about", strings: resolveLocaleStrings({}).strings.site }) },
            { category: 2, element: "[project]/renderer/src/components/SocialShare.tsx#SocialShare", prop: "url", value: "https://cm1-content.serving-contract.test/about" },
        ])).toEqual([]);
        for (const mutant of [
            a.replace('class="flex items-center gap-2 my-8', 'class="flex items-center gap-3 my-8'),
            a.replace("https%3A%2F%2Fcm1-content.serving-contract.test%2Fabout", "https%3A%2F%2Fwrong.test"),
            a.replace('>Share:</span>', '>Wrong:</span>'),
            a.replace(/\\"url\\":\\"https:\/\/cm1-content.serving-contract.test\/about\\",/, ""),
        ]) {
            expect(mutant).not.toBe(a);
            expect(maskBody(mutant, before).masked).not.toBe(expected);
        }
    });
});
