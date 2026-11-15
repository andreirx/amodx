import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { resolveLocaleStrings } from "@amodx/shared";
import { DynamicForm } from "../src/form/DynamicForm";
import { DYNAMIC_FORM_BASELINE_CASES } from "./dynamicFormBaselineCases";
import BASELINE from "./dynamicForm.baseline.json";

/**
 * SMALL-FIXES-1 C (docs/slices/small-fixes-1.md; finding F-1E-CHECKBOX-LABEL of docs/slices/shop-look-1e.md) — a
 * checkbox field draws ONE text: the wrapping label beside the box (the placeholder when set, else the label), with
 * the required mark when the field is required; no label line above it. Every other field type is unchanged, byte for
 * byte: `dynamicForm.baseline.json` holds the HTML of the component at cef3b69 (before this slice) for the inputs of
 * `dynamicFormBaselineCases.ts`, in both server renderers. The submitted key (the field's `label`) is pinned by the
 * renderer's jsdom suite `renderer/test/unit/shop-look-1e-form-client.test.ts` (`Terms: true`).
 */

const s = resolveLocaleStrings({}).strings.site;
const strings = { formSubmissionFailed: s.formSubmissionFailed, formErrorShort: s.formErrorShort, formSelectPlaceholder: s.formSelectPlaceholder, formSubmitting: s.formSubmitting };
const el = (fields: unknown) => React.createElement(DynamicForm, {
    formSlug: "contact", formName: "Contact", fields: fields as any, submitButtonText: "Send", successMessage: "Thanks", tenantId: "t1", apiUrl: "https://api.test", strings,
});
const STATIC = BASELINE.html as Record<string, string>;
const SSR = BASELINE.ssr as Record<string, string>;
const count = (html: string, part: string) => html.split(part).length - 1;
/** The HTML between `<form class="space-y-4">` and the submit button: the field rows only. */
const rows = (html: string) => html.replace(/^<form class="space-y-4">/, "").replace(/<button type="submit"[\s\S]*$/, "");
const MARK = '<span class="text-destructive ml-1">*</span>';

describe("every field type but the checkbox: the HTML before this slice, byte for byte", () => {
    it("the baseline holds every case, in both renderers", () => {
        expect(Object.keys(STATIC).sort()).toEqual(Object.keys(DYNAMIC_FORM_BASELINE_CASES).sort());
        expect(Object.keys(SSR).sort()).toEqual(Object.keys(DYNAMIC_FORM_BASELINE_CASES).sort());
    });
    for (const [name, fields] of Object.entries(DYNAMIC_FORM_BASELINE_CASES)) {
        it(name, () => {
            expect(renderToStaticMarkup(el(fields))).toBe(STATIC[name]);
            expect(renderToString(el(fields))).toBe(SSR[name]);
        });
    }
});

describe("a checkbox field draws one text, beside the box", () => {
    it("no placeholder: the label once, as the text of the box's wrapping label (its accessible name); no label line above", () => {
        const html = rows(renderToStaticMarkup(el([{ id: "f", label: "Terms", type: "checkbox", required: false }])));
        expect(html).toBe('<div><label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4 rounded border"/><span>Terms</span></label></div>');
        expect(count(html, "Terms")).toBe(1);
        expect(html).not.toContain("font-medium block mb-1");
    });

    it("with a placeholder: the placeholder once, as the box's text; the label is not drawn", () => {
        const html = rows(renderToStaticMarkup(el([{ id: "f", label: "Terms", type: "checkbox", required: false, placeholder: "I agree to the terms" }])));
        expect(html).toBe('<div><label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4 rounded border"/><span>I agree to the terms</span></label></div>');
        expect(count(html, "I agree to the terms")).toBe(1);
        expect(count(html, "Terms")).toBe(0);
    });

    it("required: the required mark once, after the text, inside the wrapping label; the box is `required`", () => {
        const html = rows(renderToStaticMarkup(el([{ id: "f", label: "Terms", type: "checkbox", required: true, placeholder: "I agree" }])));
        expect(html).toBe(`<div><label class="flex items-center gap-2 text-sm"><input type="checkbox" required="" class="h-4 w-4 rounded border"/><span>I agree${MARK}</span></label></div>`);
        expect(count(html, MARK)).toBe(1);
        expect(count(html, "<label")).toBe(1);
    });

    it("in a mixed form: the other rows equal the baseline rows; the checkbox row is the only addition", () => {
        const fields = [...DYNAMIC_FORM_BASELINE_CASES["all-six-in-order"], { id: "z", label: "Terms", type: "checkbox", required: true }];
        const html = renderToStaticMarkup(el(fields));
        const checkboxRow = `<div><label class="flex items-center gap-2 text-sm"><input type="checkbox" required="" class="h-4 w-4 rounded border"/><span>Terms${MARK}</span></label></div>`;
        expect(rows(html)).toBe(rows(STATIC["all-six-in-order"]) + checkboxRow);
    });
});
