// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveLocaleStrings } from "@amodx/shared";
import { RENDER_LOADERS } from "@amodx/plugins/render";

/**
 * SHOP-LOOK-1E (record docs/slices/shop-look-1e.md § 3) — the `form` block in a browser (jsdom): the REAL block render of
 * the built plugin package (`RENDER_LOADERS.form`, as the renderer loads it) with the server pass's `_form`. `fetch` and
 * the page's reCAPTCHA globals are stubbed. Proves the request the browser sends (the payload the backend unit suite
 * `backend/test/unit/forms-public-submit.test.ts` posts), the success state and the failure texts.
 */

const FormBlock = (await RENDER_LOADERS["form"]()).default;
const s = resolveLocaleStrings({}).strings.site;
const STRINGS = { formSubmissionFailed: s.formSubmissionFailed, formErrorShort: s.formErrorShort, formSelectPlaceholder: s.formSelectPlaceholder, formSubmitting: s.formSubmitting };
const FIELDS = [
    { id: "f-name", label: "Name", type: "text", required: true },
    { id: "f-mail", label: "E-mail", type: "email", required: true },
    { id: "f-interest", label: "Primary interest", type: "select", required: false, options: ["Hardwood", "Carpet"] },
    { id: "f-rooms", label: "Rooms", type: "number", required: false },
    { id: "f-msg", label: "Message", type: "textarea", required: false },
    { id: "f-ok", label: "Terms", type: "checkbox", required: true },
];
const attrs = (over: Record<string, unknown> = {}) => ({
    formSlug: "contact", card: true, headline: "Not sure where to start?",
    _form: { slug: "contact", name: "Contact", fields: FIELDS, submitButtonText: "Send", successMessage: "Thanks, we will call you.", strings: STRINGS, ...over },
});

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete (window as any).AMODX_RECAPTCHA_KEY;
    delete (window as any).grecaptcha;
});
function mount(a: Record<string, unknown> = attrs()) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(createElement(FormBlock, { attrs: a, tenantId: "t1", strings: {} })); });
}
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
/** Sets a controlled control's value as a user's input does (the native setter, then the event React listens to). */
function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    act(() => { el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
const control = (fieldId: string) => host.querySelector(`[id$="-${fieldId}"]`) as HTMLInputElement;
const submit = async () => { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };
function fill() {
    type(control("f-name"), "Ana");
    type(control("f-mail"), "ana@example.com");
    type(control("f-interest"), "Carpet");
    type(control("f-rooms"), "3");
    act(() => { (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
}

describe("the request the browser sends", () => {
    it("POST <NEXT_PUBLIC_API_URL>/public/forms/<slug>/submit, x-tenant-id = the page's tenant; data keyed by LABEL, every field; submitterEmail = the first email field; recaptchaToken null without a key", async () => {
        vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test");
        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ message: "x", submissionId: "s1" }) }));
        vi.stubGlobal("fetch", fetchMock);
        mount();
        fill();
        await submit();
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://api.test/public/forms/contact/submit");
        expect(init.method).toBe("POST");
        expect(init.headers).toEqual({ "Content-Type": "application/json", "x-tenant-id": "t1" });
        expect(JSON.parse(String(init.body))).toEqual({
            data: { Name: "Ana", "E-mail": "ana@example.com", "Primary interest": "Carpet", Rooms: "3", Message: "", Terms: true },
            submitterEmail: "ana@example.com",
            recaptchaToken: null,
        });
    });

    it("with the page's reCAPTCHA key and script: the token of action form_submit is sent", async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
        vi.stubGlobal("fetch", fetchMock);
        const execute = vi.fn(async () => "tok-1");
        (window as any).AMODX_RECAPTCHA_KEY = "site-key";
        (window as any).grecaptcha = { ready: (cb: () => void) => cb(), execute };
        mount();
        fill();
        await submit();
        await flush();
        expect(execute).toHaveBeenCalledWith("site-key", { action: "form_submit" });
        expect(JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body)).recaptchaToken).toBe("tok-1");
    });

    it("the slug is URL-encoded in the path", async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
        vi.stubGlobal("fetch", fetchMock);
        mount(attrs({ slug: "a b/c" }));
        await submit();
        expect(String((fetchMock.mock.calls[0] as any)[0])).toMatch(/\/public\/forms\/a%20b%2Fc\/submit$/);
    });
});

describe("the answer", () => {
    it("a successful submit: the form's success text replaces the form (inside the card, under the headline)", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
        mount();
        fill();
        await submit();
        await flush();
        expect(host.querySelector("form")).toBeNull();
        expect(host.querySelector("p.text-lg.font-medium")!.textContent).toBe("Thanks, we will call you.");
        expect(host.querySelector("h2")!.textContent).toBe("Not sure where to start?");
        expect(host.querySelector("div.rounded-xl.border")!.textContent).toContain("Thanks, we will call you.");
    });

    it("a failed submit: the server's error text; else the locale text (formSubmissionFailed); the form stays with its values", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Missing required fields", fields: ["Name"] }) })));
        mount();
        fill();
        await submit();
        await flush();
        expect(host.querySelector("p.text-destructive")!.textContent).toBe("Missing required fields");
        expect(control("f-name").value).toBe("Ana");
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => { throw new Error("not json"); } })));
        await submit();
        await flush();
        expect(host.querySelector("p.text-destructive")!.textContent).toBe(STRINGS.formSubmissionFailed);
    });
});
