// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

// STAY-1A (docs/slices/stay-1.md § 2, Build record; ruling 7): the `date` field. A native date input with its label and
// `required`; `min` is a hint only, set after hydration (`min: "today"` = the visitor's local today) and, for the later
// field of the pair rule, the day after the earlier value. The value is sent as the input's own text.
describe("STAY-1A — a date field", () => {
    const STAY = [
        { id: "f-arr", label: "Arrival", type: "date", required: true, min: "today" },
        { id: "f-dep", label: "Departure", type: "date", required: false },
    ];
    const stayAttrs = (over: Record<string, unknown> = {}) => attrs({ slug: "stay", fields: STAY, dateOrder: { earlier: "f-arr", later: "f-dep" }, ...over });
    afterEach(() => vi.useRealTimers());

    it("a native <input type=date>, tied to its label, required when the field is", () => {
        mount(stayAttrs());
        const arrival = control("f-arr");
        expect(arrival.tagName).toBe("INPUT");
        expect(arrival.type).toBe("date");
        expect(arrival.required).toBe(true);
        expect(host.querySelector(`label[for="${arrival.id}"]`)!.textContent).toBe("Arrival*");
        expect(control("f-dep").required).toBe(false);
    });

    it("min: today → the visitor's local date after mount; a field without min: no min", () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 10, 27, 23, 30)); // local 2026-11-27 23:30, whatever the process zone
        mount(stayAttrs({ dateOrder: undefined }));
        expect(control("f-arr").min).toBe("2026-11-27");
        expect(control("f-dep").hasAttribute("min")).toBe(false);
    });

    it("the later field's min follows the earlier value: the day after it", () => {
        mount(stayAttrs());
        type(control("f-arr"), "2026-12-31");
        expect(control("f-dep").min).toBe("2027-01-01");
        type(control("f-arr"), "");
        expect(control("f-dep").hasAttribute("min")).toBe(false);
    });

    it("F-STAY1A-YEAR-REMAP: the day after 0099-12-31 is 0100-01-01 (not 2000-01-01); after 9999-12-31 no min", () => {
        mount(stayAttrs());
        type(control("f-arr"), "0099-12-31");
        expect(control("f-dep").min).toBe("0100-01-01");
        type(control("f-arr"), "0004-02-28");
        expect(control("f-dep").min).toBe("0004-02-29");
        type(control("f-arr"), "9999-12-31");
        expect(control("f-dep").hasAttribute("min")).toBe(false);
    });

    it("server HTML has no min (no clock read during render); hydration reports no mismatch; min appears after it", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 10, 27, 12, 0));
        const element = createElement(FormBlock, { attrs: stayAttrs(), tenantId: "t1", strings: {} });
        const html = renderToString(element);
        expect(html).toContain('type="date"');
        expect(html).not.toContain("min=");
        host = document.createElement("div");
        host.innerHTML = html;
        document.body.appendChild(host);
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const recoverable: unknown[] = [];
        await act(async () => { root = hydrateRoot(host, element, { onRecoverableError: (e) => recoverable.push(e) }); });
        expect(recoverable).toEqual([]);
        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();
        expect(control("f-arr").min).toBe("2026-11-27");
    });

    it("the request: the date values as the inputs' texts, keyed by label; an empty optional date sends \"\"", async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
        vi.stubGlobal("fetch", fetchMock);
        mount(stayAttrs());
        type(control("f-arr"), "2026-12-20");
        await submit();
        await flush();
        const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(String(init.body)).data).toEqual({ Arrival: "2026-12-20", Departure: "" });
    });
});
