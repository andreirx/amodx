import { describe, it, expect } from "vitest";
import React from "react";
import { readFileSync, existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveLocaleStrings } from "@amodx/shared";
import { RENDER_LOADERS } from "../src/render";
import { getExtensions, getPluginList } from "../src/admin";
import { FormBlockSchema } from "../src/form/schema";
import { FormPlugin } from "../src/form";
import { FormEditor, formSlugNote } from "../src/form/FormEditor";

/**
 * SHOP-LOOK-1E (record docs/slices/shop-look-1e.md § 3) — the `form` block: schema, Tiptap node, registration, the
 * render (server HTML via `react-dom/server`, through `RENDER_LOADERS.form` as the renderer loads it), the editor's
 * markup and its pure picker note. The browser behaviour (submit, success, error) is exercised in the renderer's jsdom
 * suite `renderer/test/unit/locale-1a-client.test.ts` and `shop-look-1e-form.test.ts`.
 */

const Form = (await RENDER_LOADERS["form"]()).default;
const site = (locale?: string) => resolveLocaleStrings(locale ? { locale } : {}).strings.site;
const formStrings = (s: ReturnType<typeof site>) => ({
    formSubmissionFailed: s.formSubmissionFailed, formErrorShort: s.formErrorShort, formSelectPlaceholder: s.formSelectPlaceholder, formSubmitting: s.formSubmitting,
});
const EN = formStrings(site());
const RO = formStrings(site("ro-RO"));

const FIELDS = [
    { id: "f-name", label: "Name", type: "text", required: true, placeholder: "Your name" },
    { id: "f-mail", label: "E-mail", type: "email", required: true },
    { id: "f-phone", label: "Phone", type: "phone", required: false },
    { id: "f-count", label: "Rooms", type: "number", required: false },
    { id: "f-interest", label: "Primary interest", type: "select", required: false, options: ["Hardwood", "Carpet"] },
    { id: "f-msg", label: "Message", type: "textarea", required: false },
    { id: "f-ok", label: "Terms", type: "checkbox", required: true, placeholder: "I agree" },
];
const prepared = (over: Record<string, unknown> = {}) => ({
    slug: "contact", name: "Contact", fields: FIELDS, submitButtonText: "Send it", successMessage: "Thanks!", strings: EN, ...over,
});
const render = (attrs: Record<string, unknown>, tenantId = "t1") => renderToStaticMarkup(React.createElement(Form, { attrs, tenantId, strings: {} }));
const BASE = { formSlug: "contact", eyebrow: "", headline: "", text: "", card: false, blockWidth: "content" };

describe("the block draws nothing without the server's form", () => {
    it("no `_form` (no slug, unknown slug, disabled form — the server pass adds nothing; or the admin preview): empty", () => {
        expect(render({ ...BASE })).toBe("");
        expect(render({ ...BASE, formSlug: "" })).toBe("");
        expect(render({ ...BASE, eyebrow: "E", headline: "H", text: "T", card: true })).toBe("");
    });

    it("a `_form` not of the server's shape: empty", () => {
        for (const bad of [null, "x", 3, [], {}, { slug: "s" }, { slug: "s", fields: "x", strings: EN }, { slug: 1, fields: [], strings: EN }, { slug: "s", fields: [], strings: null }]) {
            expect(render({ ...BASE, _form: bad }), JSON.stringify(bad)).toBe("");
        }
    });
});

describe("the form: each stored field by its type, the button text, the locale texts", () => {
    const html = render({ ...BASE, _form: prepared() });

    it("text, email, phone (tel), number as inputs; textarea; select with the locale placeholder and the options; checkbox with its text", () => {
        expect(html).toMatch(/<input id="[^"]+-f-name" type="text" placeholder="Your name" required=""/);
        expect(html).toMatch(/<input id="[^"]+-f-mail" type="email" required=""/);
        expect(html).toMatch(/<input id="[^"]+-f-phone" type="tel"/);
        expect(html).toMatch(/<input id="[^"]+-f-count" type="number"/);
        expect(html).toMatch(/<textarea id="[^"]+-f-msg" rows="4"/);
        expect(html).toMatch(/<select id="[^"]+-f-interest"[^>]*><option value="" selected="">Select\.\.\.<\/option><option value="Hardwood">Hardwood<\/option><option value="Carpet">Carpet<\/option><\/select>/);
        expect(html).toContain('<label class="flex items-center gap-2 text-sm"><input type="checkbox" required="" class="h-4 w-4 rounded border"/>I agree</label>');
    });

    it("each label in field order, tied to its control (htmlFor = id); the checkbox keeps its wrapping label only", () => {
        const labels = [...html.matchAll(/<label for="([^"]+)" class="text-sm font-medium block mb-1">([^<]+)/g)].map((m) => [m[1].replace(/^.*-(f-[a-z]+)$/, "$1"), m[2]]);
        expect(labels).toEqual([["f-name", "Name"], ["f-mail", "E-mail"], ["f-phone", "Phone"], ["f-count", "Rooms"], ["f-interest", "Primary interest"], ["f-msg", "Message"]]);
        expect(html).toContain('<label class="text-sm font-medium block mb-1">Terms<span class="text-destructive ml-1">*</span></label>');
        for (const [, id] of html.matchAll(/<label for="([^"]+)"/g)) expect(html).toContain(`id="${id}"`);
    });

    it("required fields carry the mark (theme destructive colour) and `required`; optional ones neither", () => {
        expect((html.match(/<span class="text-destructive ml-1">\*<\/span>/g) ?? []).length).toBe(3);
        expect((html.match(/ required=""/g) ?? []).length).toBe(3);
    });

    it("the button shows the form's button text; nothing of the success text before a submit", () => {
        expect(html).toContain('<button type="submit" class="w-full bg-primary text-primary-foreground');
        expect(html).toContain(">Send it</button>");
        expect(html).not.toContain("Thanks!");
    });

    it("the select placeholder is the tenant's locale text (EN, RO); a field placeholder wins", () => {
        expect(render({ ...BASE, _form: prepared({ strings: RO }) })).toContain(`<option value="" selected="">${RO.formSelectPlaceholder}</option>`);
        expect(RO.formSelectPlaceholder).not.toBe(EN.formSelectPlaceholder);
        const own = render({ ...BASE, _form: prepared({ fields: [{ ...FIELDS[4], placeholder: "Choose one" }] }) });
        expect(own).toContain('<option value="" selected="">Choose one</option>');
    });

    it("a form with no field: the button only", () => {
        const empty = render({ ...BASE, _form: prepared({ fields: [] }) });
        expect(empty).not.toContain("<label");
        expect(empty).toContain(">Send it</button>");
    });
});

describe("the block options", () => {
    const formOnly = render({ ...BASE, _form: prepared() });
    const formEl = formOnly.replace(/^<section class="my-12"><div class="max-w-lg mx-auto">/, "").replace(/<\/div><\/section>$/, "");

    it("all blank / absent: the section and the form only", () => {
        expect(formOnly).toBe(`<section class="my-12"><div class="max-w-lg mx-auto">${formEl}</div></section>`);
        for (const blank of [{ eyebrow: " ", headline: "\n", text: "\t" }, { eyebrow: undefined, headline: null, text: 3 }]) {
            expect(render({ ...BASE, ...blank, _form: prepared() })).toBe(formOnly);
        }
    });

    it("eyebrow, headline, text above the form, trimmed, each alone and together", () => {
        const EYEBROW = (t: string) => `<p class="mx-auto w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">${t}</p>`;
        const HEADLINE = (t: string) => `<h2 class="text-2xl md:text-3xl font-bold mb-2">${t}</h2>`;
        const TEXT = (t: string) => `<p class="text-muted-foreground">${t}</p>`;
        const head = (inner: string) => `<section class="my-12"><div class="text-center mb-8">${inner}</div><div class="max-w-lg mx-auto">${formEl}</div></section>`;
        expect(render({ ...BASE, eyebrow: " Contact ", _form: prepared() })).toBe(head(EYEBROW("Contact")));
        expect(render({ ...BASE, headline: "Not sure where to start?", _form: prepared() })).toBe(head(HEADLINE("Not sure where to start?")));
        expect(render({ ...BASE, text: "Tell us.", _form: prepared() })).toBe(head(TEXT("Tell us.")));
        expect(render({ ...BASE, eyebrow: "Contact", headline: "H", text: "T", _form: prepared() })).toBe(head(EYEBROW("Contact") + HEADLINE("H") + TEXT("T")));
    });

    it("card on (exactly true): the bordered card class around the form; off, absent or not true: none", () => {
        const CARD = "max-w-lg mx-auto rounded-xl border border-border bg-background p-6 md:p-8 shadow-sm";
        expect(render({ ...BASE, card: true, _form: prepared() })).toBe(`<section class="my-12"><div class="${CARD}">${formEl}</div></section>`);
        for (const card of [false, undefined, "true", 1]) expect(render({ ...BASE, card, _form: prepared() })).toBe(formOnly);
    });

    it("owner texts are drawn as text, never as HTML", () => {
        const html = render({ ...BASE, headline: "<b>x</b>", _form: prepared({ fields: [{ ...FIELDS[0], label: "<i>L</i>" }] }) });
        expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
        expect(html).toContain("&lt;i&gt;L&lt;/i&gt;");
        expect(html).not.toContain("<b>x</b>");
    });
});

describe("schema, Tiptap node, registration", () => {
    it("schema defaults (a new block: ordinary defaults) and types", () => {
        expect(FormBlockSchema.parse({})).toEqual({ formSlug: "", eyebrow: "", headline: "", text: "", card: false, blockWidth: "content" });
        expect(FormBlockSchema.safeParse({ card: "yes" }).success).toBe(false);
        expect(FormBlockSchema.safeParse({ blockWidth: "huge" }).success).toBe(false);
    });

    it("the Tiptap attributes equal the schema's keys and defaults; storage holds the injected form list function", () => {
        const ext = FormPlugin.editorExtension as any;
        const attrs = ext.config.addAttributes();
        expect(Object.fromEntries(Object.entries(attrs).map(([k, v]: any) => [k, v.default]))).toEqual(FormBlockSchema.parse({}));
        expect(ext.config.addStorage()).toEqual({ fetchFormsFn: null });
        expect(ext.config.name).toBe("form");
    });

    it("registered in both entries: the admin registry (offered on every site kind) and the render loaders", () => {
        expect(getPluginList().find((p) => p.key === "form")).toMatchObject({ key: "form", label: "Custom Form", offeredOn: [] });
        expect(getExtensions()).toContain(FormPlugin.editorExtension);
        expect(typeof RENDER_LOADERS.form).toBe("function");
    });
});

describe("the editor", () => {
    const FORMS = [{ id: "1", name: "Contact", slug: "contact", status: "active" }, { id: "2", name: "Old", slug: "old", status: "disabled" }];

    it("offers the form picker, the three texts, the card box and the width, with the stored values", () => {
        const html = renderToStaticMarkup(React.createElement(FormEditor, {
            node: { attrs: { ...BASE, eyebrow: "Contact", headline: "H", text: "T", card: true } }, updateAttributes: () => {}, editor: { storage: { form: {} } },
        }));
        for (const t of ["Form:", "Label above:", "Headline:", "Text:", "Show the form in a card", 'value="Contact"', 'value="H"', 'value="T"', 'checked=""']) expect(html, t).toContain(t);
        // Before the list arrives, the stored slug is kept as an option so the select still shows it.
        expect(html).toContain('<option value="contact" selected="">contact</option>');
    });

    it("the picker note: none for an active listed form; why the site shows nothing otherwise", () => {
        expect(formSlugNote("contact", FORMS)).toBe("");
        expect(formSlugNote("old", FORMS)).toBe("Form disabled — the site shows nothing.");
        expect(formSlugNote("gone", FORMS)).toBe("Form not found — the site shows nothing.");
        expect(formSlugNote("", FORMS)).toBe("No form picked: the site shows nothing.");
        expect(formSlugNote("contact", [])).toBe("");
    });
});

describe("split entry, the moved component, theme tokens", () => {
    const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
    const renderFiles = ["../src/form/FormRender.tsx", "../src/form/DynamicForm.tsx"].map(read);

    it("no import from the renderer or the admin; @amodx/shared as a type import only (D3)", () => {
        for (const src of renderFiles) {
            const imports = src.split("\n").filter((l) => l.startsWith("import "));
            for (const line of imports) expect(line).not.toMatch(/from ["'](@\/|\.\.\/\.\.\/|renderer|admin)/);
            for (const line of imports.filter((l) => l.includes("@amodx/shared"))) expect(line).toMatch(/^import type /);
        }
    });

    it("the renderer copy is gone (moved, not duplicated)", () => {
        expect(existsSync(new URL("../../../renderer/src/components/DynamicForm.tsx", import.meta.url))).toBe(false);
    });

    it("theme classes only, except the success icon's text-green-500 (no success token; finding F-1E-SUCCESS-COLOUR)", () => {
        const palette = /\b(?:text|bg|border|ring|from|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d+)?\b/g;
        // The class strings only (`className="…"` and the quoted class texts of a `className={…}` expression), not comments.
        const classTexts = renderFiles.flatMap((src) => [...src.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)].map((m) => m[1] ?? m[2]));
        expect(classTexts.length).toBeGreaterThan(10);
        const found = classTexts.flatMap((c) => c.match(palette) ?? []);
        expect(found).toEqual(["text-green-500"]);
    });
});
