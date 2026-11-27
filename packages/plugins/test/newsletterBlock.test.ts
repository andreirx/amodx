import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LANGUAGE_PACKS, newsletterTexts, resolveLocaleStrings } from "@amodx/shared";
import { RENDER_LOADERS } from "../src/render";
import { getPluginList } from "../src/admin";
import { NewsletterBlockSchema } from "../src/newsletter/schema";
import { NewsletterPlugin } from "../src/newsletter";

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md, scope item 1) — the `newsletter` block: schema, registration, and the
 * server HTML (`react-dom/server`, through `RENDER_LOADERS.newsletter` as the renderer loads it). The browser behaviour
 * (the submit body, thanks, failure) is exercised in the renderer's jsdom suite `test/unit/newsletter-1-client.test.ts`.
 */

const Newsletter = (await RENDER_LOADERS["newsletter"]()).default;
const texts = (locale: string) => newsletterTexts(resolveLocaleStrings({ locale }));
const render = (attrs: Record<string, unknown>) => renderToStaticMarkup(React.createElement(Newsletter, { attrs, tenantId: "t1", strings: {} }));
const BASE = NewsletterBlockSchema.parse({});

describe("registration", () => {
    it("the block is registered for the editor (every site kind) and has a lazy render loader", () => {
        const listed = getPluginList().find((p) => p.key === "newsletter");
        expect(listed).toMatchObject({ key: "newsletter", label: "Newsletter Signup", offeredOn: [] });
        expect(NewsletterPlugin.editorExtension.name).toBe("newsletter");
        expect(BASE).toEqual({ headline: "", description: "", buttonText: "", blockWidth: "content" });
    });
});

describe("the block draws nothing without the server's texts (no consent line, no form)", () => {
    it("no `_newsletter` (the admin preview) or one not of the server's shape → empty", () => {
        expect(render({ ...BASE, headline: "H" })).toBe("");
        for (const bad of [null, "x", {}, { ...texts("en-US"), consent: "" }, { ...texts("en-US"), thanks: 3 }]) {
            expect(render({ ...BASE, _newsletter: bad }), JSON.stringify(bad)).toBe("");
        }
    });
});

describe("the form: the tenant's locale texts, a required consent box, the button label", () => {
    it("German tenant: the German consent line beside a required box, the email field, the German button", () => {
        const html = render({ ...BASE, headline: "Neuigkeiten", description: "Einmal im Monat.", _newsletter: texts("de-DE") });
        const de = LANGUAGE_PACKS.de.site;
        expect(html).toContain('<h2 class="text-2xl font-bold mb-2">Neuigkeiten</h2>');
        expect(html).toContain("Einmal im Monat.");
        expect(html).toMatch(/<label for="([^"]+)-email" class="sr-only">E-Mail<\/label><input id="\1-email" type="email" required="" autoComplete="email" placeholder="name@example.com"[^>]* name="email"\/>/);
        expect(html).toMatch(new RegExp(`<input id="([^"]+)-consent" type="checkbox" required=""[^>]* name="consent"/><label for="\\1-consent" class="text-sm text-muted-foreground">${de.newsletterConsent}</label>`));
        expect(html).toContain(`>${de.newsletterSubscribe}</button>`);
        expect(html).not.toContain(de.newsletterThanks!);
    });

    it("the owner's button label wins over the locale text; a blank one does not; blank headline and text draw nothing", () => {
        expect(render({ ...BASE, buttonText: "Join", _newsletter: texts("fr-FR") })).toContain(">Join</button>");
        const html = render({ ...BASE, buttonText: "  ", _newsletter: texts("fr-FR") });
        expect(html).toContain(`>${LANGUAGE_PACKS.fr.site.newsletterSubscribe}</button>`);
        expect(html).not.toContain("<h2");
        expect(html.startsWith('<section class="my-12 max-w-md mx-auto"><form')).toBe(true);
    });
});
