// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * SCHED-1G2 (docs/slices/sched-1.md § 10.1, § 8.2, § 8.3, § 10.2) — the browser halves of the booking pages, mounted with
 * React in jsdom with the REAL components and a recorded `fetch` that plays the deployed backend's answers (shapes of
 * backend/src/scheduling/visitor/*.ts) behind the proxy. Romanian texts from the real language pack, so each state
 * shows that its texts are read from the pack (G12 coverage, `locale-1/sched-1g/coverage.json`).
 *  - G7: the manage page removes the fragment, sends `POST view` first, and sends `POST confirm` only on the button;
 *    the token never appears in a URL.
 *  - Every refusal code has a visitor text at its reader.
 *  - Accessible forms: labels bound to inputs, errors tied to fields (`aria-describedby`, `aria-invalid`), focus on
 *    the first invalid field.
 */

import { bookingTexts } from "@/lib/booking-text";
import { REFUSAL_TEXT, fillText, type BookingTextKey } from "@/lib/booking-ui";
import { BookFlow } from "@/app/%5Fbook/[siteId]/_components/BookFlow";
import { ManageView } from "@/app/%5Fbook/[siteId]/_components/ManageView";
import { useOperation, type Operation } from "@/app/%5Fbook/[siteId]/_components/operation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RO = bookingTexts("ro");
const TOKEN = "Tk-" + "a".repeat(40);
type Call = { method: string; path: string; query: string; body: unknown };
type Handler = (c: Call) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
let calls: Call[];
let root: Root;
let host: HTMLDivElement;

function serve(handler: Handler) {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        const u = new URL(url, "http://localhost");
        const call = { method: init?.method ?? "GET", path: u.pathname, query: u.search, body: init?.body ? JSON.parse(init.body as string) : undefined };
        calls.push(call);
        const r = await handler(call);
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }));
}
async function settle() {
    for (let i = 0; i < 12; i++) await act(async () => { await Promise.resolve(); });
}
async function mount(el: React.ReactElement) {
    await act(async () => { root.render(el); });
    await settle();
}
const text = () => host.textContent ?? "";
function button(label: string): HTMLButtonElement {
    const b = [...host.querySelectorAll("button")].find((x) => x.textContent === label);
    if (!b) throw new Error(`no button "${label}" in: ${text()}`);
    return b as HTMLButtonElement;
}
async function click(el: HTMLElement) {
    await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await settle();
}
async function type(id: string, value: string) {
    const el = host.querySelector(`#${id}`) as HTMLInputElement;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

beforeEach(() => {
    calls = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-01T08:00:00Z"));
    window.history.replaceState(null, "", "/_booking");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const OFFER = {
    timezone: "Europe/Bucharest",
    services: [{ id: "svc1", name: "Consultație", durationMin: 50 }],
};

describe("SCHED-1G2 book flow (browser)", () => {
    it("book flow (ro): loading, then the offer with services", async () => {
        let release!: () => void;
        serve(() => new Promise((r) => { release = () => r({ status: 200, body: OFFER }); }));
        await mount(createElement(BookFlow, { texts: RO, locale: "ro-RO", recaptchaSiteKey: undefined }));
        expect(text()).toContain(RO.loading);
        release();
        await settle();
        expect(text()).toContain(RO.chooseOffer);
        expect(text()).toContain(RO.servicesHeading);
        expect(text()).toContain(fillText(RO.durationMinutes, { n: 50 }));
        expect(calls).toEqual([{ method: "GET", path: "/_booking/api/offer", query: "", body: undefined }]);
    });

    it("book flow (ro): nothing offered", async () => {
        serve(() => ({ status: 200, body: { timezone: "Europe/Bucharest", services: [] } }));
        await mount(createElement(BookFlow, { texts: RO, locale: "ro-RO", recaptchaSiteKey: undefined }));
        expect(text()).toContain(RO.nothingOffered);
    });

    it("book flow (ro): a service week by week up to lastBookableDate, a time, the details form with field errors, the hold and the check-your-mail screen, resend", async () => {
        let holdRelease!: () => void;
        serve((c) => {
            if (c.path.endsWith("/offer")) return { status: 200, body: OFFER };
            if (c.path.endsWith("/slots")) {
                const from = new URLSearchParams(c.query).get("from");
                const days = from === "2026-12-01"
                    ? [{ date: "2026-12-01", starts: [] }]
                    : [{ date: "2026-12-08", starts: ["2026-12-08T08:00:00.000Z", "2026-12-08T09:00:00.000Z"] }];
                return { status: 200, body: { timezone: "Europe/Bucharest", serviceId: "svc1", durationMin: 50, lastBookableDate: "2026-12-12", days } };
            }
            if (c.path.endsWith("/hold") && (c.body as { resend?: boolean }).resend) return { status: 200, body: { ref: "B-0000ABCD", state: "held", expiresAt: "2026-12-01T08:30:00.000Z", emailMasked: "a***@example.test" } };
            if (c.path.endsWith("/hold")) return new Promise((r) => { holdRelease = () => r({ status: 201, body: { ref: "B-0000ABCD", state: "held", expiresAt: "2026-12-01T08:30:00.000Z", emailMasked: "a***@example.test" } }); });
            throw new Error(`unexpected ${c.path}`);
        });
        await mount(createElement(BookFlow, { texts: RO, locale: "ro-RO", recaptchaSiteKey: undefined }));
        await click(button(`Consultație ${fillText(RO.durationMinutes, { n: 50 })}`));
        expect(text()).toContain(RO.back);
        expect(text()).toContain(RO.chooseTime);
        expect(text()).toContain(RO.noTimesThisWeek);
        expect(text()).toContain(fillText(RO.timesShownIn, { zone: "Europe/Bucharest" }));
        expect(button(RO.previousWeek).disabled).toBe(true);
        expect(calls.at(-1)).toMatchObject({ method: "GET", path: "/_booking/api/slots", query: "?serviceId=svc1&from=2026-12-01&to=2026-12-07" });
        await click(button(RO.nextWeek));
        expect(calls.at(-1)).toMatchObject({ query: "?serviceId=svc1&from=2026-12-08&to=2026-12-14" });
        expect(button(RO.nextWeek).disabled).toBe(true);           // 2026-12-15 is after lastBookableDate
        expect(text()).toContain(fillText(RO.lastBookableDate, { date: "sâmbătă, 12 decembrie 2026" }));
        await click(button("10:00"));                               // 08:00Z = 10:00 in Bucharest
        expect(text()).toContain(RO.detailsHeading);
        expect(text()).toContain(fillText(RO.selectedLabel, { what: "Consultație — " }).slice(0, 10));
        // Labels are bound to their inputs.
        for (const [id, label] of [["booking-name", RO.nameLabel], ["booking-email", RO.emailLabel], ["booking-phone", RO.phoneLabel]]) {
            expect(host.querySelector(`label[for="${id}"]`)?.textContent).toBe(label);
        }
        // Empty submit: both errors, tied to their fields; focus on the first invalid field; nothing sent.
        await click(button(RO.submitHold));
        expect(host.querySelector("#booking-name-error")?.textContent).toBe(RO.fieldRequired);
        expect(host.querySelector("#booking-name")?.getAttribute("aria-describedby")).toBe("booking-name-error");
        expect(host.querySelector("#booking-name")?.getAttribute("aria-invalid")).toBe("true");
        expect(document.activeElement?.id).toBe("booking-name");
        await type("booking-name", "Ana Pop");
        await type("booking-email", "not-an-email");
        await click(button(RO.submitHold));
        expect(host.querySelector("#booking-email-error")?.textContent).toBe(RO.emailInvalid);
        expect(document.activeElement?.id).toBe("booking-email");
        expect(calls.filter((c) => c.path.endsWith("/hold"))).toHaveLength(0);
        await type("booking-email", "ana@example.test");
        await click(button(RO.submitHold));
        expect(text()).toContain(RO.sending);
        holdRelease();
        await settle();
        const hold = calls.find((c) => c.path.endsWith("/hold"))!;
        expect(hold.method).toBe("POST");
        expect(hold.body).toMatchObject({ what: { kind: "slot", serviceId: "svc1", start: "2026-12-08T08:00:00.000Z" }, who: { email: "ana@example.test", name: "Ana Pop" } });
        expect((hold.body as { intentId: string }).intentId).toMatch(/^[0-9a-f-]{36}$/);
        expect(text()).toContain(RO.checkMailHeading);
        expect(text()).toContain("a***@example.test");
        expect(text()).toContain("B-0000ABCD");
        expect(text()).toContain("(Europe/Bucharest)");
        expect(text()).toContain(fillText(RO.checkMailHeld, { email: "a***@example.test", ref: "B-0000ABCD", time: "" }).slice(0, 20));
        await click(button(RO.resendMail));
        const resend = calls.filter((c) => c.path.endsWith("/hold"));
        expect(resend).toHaveLength(2);
        expect(resend[1].body).toMatchObject({ resend: true, intentId: (hold.body as { intentId: string }).intentId });
        expect(text()).toContain(RO.resent);
        await click(button(RO.newBooking));
        expect(text()).toContain(RO.chooseOffer);
    });

    it("book flow (ro): a hold answered 'confirmed' (the form's intent was already confirmed) shows the confirmed text", async () => {
        serve((c) => {
            if (c.path.endsWith("/offer")) return { status: 200, body: OFFER };
            if (c.path.endsWith("/slots")) return { status: 200, body: { timezone: "Europe/Bucharest", serviceId: "svc1", durationMin: 50, lastBookableDate: "2027-01-31", days: [{ date: "2026-12-01", starts: ["2026-12-01T10:00:00.000Z"] }] } };
            if (c.path.endsWith("/hold")) return { status: 200, body: { ref: "B-0000EEEE", state: "confirmed", emailMasked: "a***@example.test" } };
            throw new Error(`unexpected ${c.path}`);
        });
        await mount(createElement(BookFlow, { texts: RO, locale: "ro-RO", recaptchaSiteKey: undefined, initialServiceId: "svc1" }));
        await click(button("12:00"));
        await type("booking-name", "Ana");
        await type("booking-email", "ana@example.test");
        await click(button(RO.submitHold));
        expect(calls.at(-1)!.body).toMatchObject({ what: { kind: "slot", serviceId: "svc1", start: "2026-12-01T10:00:00.000Z" } });
        expect(text()).toContain(fillText(RO.checkMailConfirmed, { email: "a***@example.test", ref: "B-0000EEEE" }));
        expect([...host.querySelectorAll("button")].some((b) => b.textContent === RO.resendMail)).toBe(false);
    });

    it("book flow: a refusal of the hold is shown with its text, and the form stays", async () => {
        serve((c) => {
            if (c.path.endsWith("/offer")) return { status: 200, body: OFFER };
            if (c.path.endsWith("/slots")) return { status: 200, body: { timezone: "Europe/Bucharest", serviceId: "svc1", durationMin: 50, lastBookableDate: "2027-01-31", days: [{ date: "2026-12-01", starts: ["2026-12-01T10:00:00.000Z"] }] } };
            return { status: 409, body: { error: "x", code: "slotTaken" } };
        });
        await mount(createElement(BookFlow, { texts: RO, locale: "ro-RO", recaptchaSiteKey: undefined, initialServiceId: "svc1" }));
        await click(button("12:00"));
        await type("booking-name", "Ana");
        await type("booking-email", "ana@example.test");
        await click(button(RO.submitHold));
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(RO.errSlotTaken);
        expect(host.querySelector("#booking-name")).not.toBeNull();
    });
});

const VIEW_SLOT = {
    ref: "B-00001234", state: "held", expiresAt: "2026-12-01T08:30:00.000Z",
    what: { kind: "slot", serviceId: "svc1", serviceName: "Consultație", start: "2026-12-08T08:00:00.000Z", end: "2026-12-08T08:50:00.000Z", timezone: "Europe/Bucharest" },
    who: { name: "Ana Pop", emailMasked: "a***@example.test" }, can: { confirm: true, cancel: true, move: false }, changeCutoff: "2026-12-07T08:00:00.000Z",
};
const CONFIRMED = { ...VIEW_SLOT, state: "confirmed", expiresAt: undefined, can: { confirm: false, cancel: true, move: true } };

describe("SCHED-1G2 manage view (browser)", () => {
    it("manage view (ro): no fragment → the 'open the link' text and no request", async () => {
        window.history.replaceState(null, "", "/_booking/manage");
        serve(() => { throw new Error("no request expected"); });
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        expect(text()).toContain(RO.noLinkToken);
        expect(calls).toHaveLength(0);
    });

    it("manage view (ro) G7: the fragment is removed at load, POST view is the only request, confirm only on the button", async () => {
        window.history.replaceState(null, "", `/_site/t1/_booking/manage?lang=ro#t=${TOKEN}`);
        serve((c) => (c.path.endsWith("/view") ? { status: 200, body: VIEW_SLOT } : { status: 200, body: CONFIRMED }));
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        expect(window.location.hash).toBe("");
        expect(window.location.pathname + window.location.search).toBe("/_site/t1/_booking/manage?lang=ro");
        expect(calls).toEqual([{ method: "POST", path: "/_site/t1/_booking/api/view", query: "", body: { token: TOKEN } }]);
        expect(text()).toContain(fillText(RO.bookingRef, { ref: "B-00001234" }));
        expect(text()).toContain(RO.stateHeld.split("{time}")[0]);
        expect(text()).toContain(RO.whenLabel);
        expect(text()).toContain(RO.whatLabel);
        expect(text()).toContain(RO.nameLabel);
        expect(text()).toContain(RO.emailLabel);
        expect(text()).toContain(RO.changeUntil.split("{time}")[0]);
        expect(text()).toContain(RO.cancelButton);
        // Nothing confirmed until the button.
        expect(calls.filter((c) => c.path.endsWith("/confirm"))).toHaveLength(0);
        await click(button(RO.confirmButton));
        expect(calls.at(-1)).toEqual({ method: "POST", path: "/_site/t1/_booking/api/confirm", query: "", body: { token: TOKEN } });
        expect(text()).toContain(RO.confirmedNow);
        expect(text()).toContain(RO.stateConfirmed);
        for (const c of calls) expect(c.path + c.query).not.toContain(TOKEN);
    });

    it("manage view (ro): cancel asks once more, 'keep it' sends nothing, 'yes' cancels", async () => {
        window.history.replaceState(null, "", `/_booking/manage#t=${TOKEN}`);
        serve((c) => (c.path.endsWith("/view") ? { status: 200, body: CONFIRMED } : { status: 200, body: { ref: "B-00001234", state: "cancelled" } }));
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        await click(button(RO.cancelButton));
        expect(text()).toContain(RO.cancelQuestion);
        await click(button(RO.cancelNo));
        expect(calls.filter((c) => c.path.endsWith("/cancel"))).toHaveLength(0);
        await click(button(RO.cancelButton));
        await click(button(RO.cancelYes));
        expect(calls.at(-1)).toEqual({ method: "POST", path: "/_booking/api/cancel", query: "", body: { token: TOKEN } });
        expect(text()).toContain(fillText(RO.cancelledNow, { ref: "B-00001234" }));
    });

    it("manage view (ro): move a slot uses the booking's own serviceId (no offer read, no name matching)", async () => {
        window.history.replaceState(null, "", `/_booking/manage#t=${TOKEN}`);
        // A view whose service was renamed: the name no longer matches anything, the id is what the page uses.
        const renamed = { ...CONFIRMED, what: { ...CONFIRMED.what, serviceId: "svc-own", serviceName: "Old name" } };
        serve((c) => {
            if (c.path.endsWith("/view")) return { status: 200, body: renamed };
            if (c.path.endsWith("/slots")) return { status: 200, body: { timezone: "Europe/Bucharest", serviceId: "svc-own", durationMin: 50, lastBookableDate: "2027-01-31", days: [{ date: "2026-12-01", starts: ["2026-12-01T12:00:00.000Z"] }] } };
            if (c.path.endsWith("/move")) return { status: 200, body: { ...renamed, what: { ...renamed.what, start: "2026-12-01T12:00:00.000Z", end: "2026-12-01T12:50:00.000Z" } } };
            throw new Error(`unexpected ${c.path}`);
        });
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        await click(button(RO.moveTimeButton));
        expect(calls.filter((c) => c.path.endsWith("/offer"))).toHaveLength(0);
        expect(calls.at(-1)).toMatchObject({ path: "/_booking/api/slots", query: "?serviceId=svc-own&from=2026-12-01&to=2026-12-07" });
        await click(button("14:00"));
        expect(calls.at(-1)).toEqual({ method: "POST", path: "/_booking/api/move", query: "", body: { token: TOKEN, to: { kind: "slot", start: "2026-12-01T12:00:00.000Z" } } });
        expect(text()).toContain(RO.movedNow);
    });

    it("manage view (ro): the booking's service no longer exists → 'cannot be changed here, contact us' (slots 404, and a move answered 404)", async () => {
        window.history.replaceState(null, "", `/_booking/manage#t=${TOKEN}`);
        let slotsGone = true;
        serve((c) => {
            if (c.path.endsWith("/view")) return { status: 200, body: CONFIRMED };
            if (c.path.endsWith("/slots")) return slotsGone
                ? { status: 404, body: { error: "Service not found.", code: "notFound" } }
                : { status: 200, body: { timezone: "Europe/Bucharest", serviceId: "svc1", durationMin: 50, lastBookableDate: "2027-01-31", days: [{ date: "2026-12-01", starts: ["2026-12-01T12:00:00.000Z"] }] } };
            if (c.path.endsWith("/move")) return { status: 404, body: { error: "The service is no longer offered.", code: "notFound" } };
            throw new Error(`unexpected ${c.path}`);
        });
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        await click(button(RO.moveTimeButton));
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(RO.moveNotOffered);
        expect(text()).not.toContain(RO.errNotFound);
        // The service disappears between the free times and the move.
        slotsGone = false;
        await act(async () => { root.render(createElement("div")); });
        window.history.replaceState(null, "", `/_booking/manage#t=${TOKEN}`);
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        await click(button(RO.moveTimeButton));
        await click(button("14:00"));
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(RO.moveNotOffered);
    });

    it("manage view (ro) G4: a link the backend answers 404 linkNotValid (an unknown token, or an old link of a booking shape that was removed) shows only the link-not-valid text", async () => {
        // SCHED-GROUPS-REMOVE-1 row G4: the backend gives one answer for both cases, so the page cannot and does not tell
        // them apart; the screen is the refusal text alone, with no booking, no action and no further request.
        window.history.replaceState(null, "", `/_booking/manage#t=${TOKEN}`);
        serve(() => ({ status: 404, body: { error: "This link is not valid.", code: "linkNotValid" } }));
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(RO.errLinkNotValid);
        expect(text()).toBe(RO.errLinkNotValid);
        expect(host.querySelectorAll("button, a")).toHaveLength(0);
        expect(calls).toEqual([{ method: "POST", path: "/_booking/api/view", query: "", body: { token: TOKEN } }]);
    });

    // Every refusal code, at its reader: the manage view's answer to `POST view`.
    const codes = [...Object.keys(REFUSAL_TEXT), "someFutureCode"];
    it.each(codes)("manage view (ro): the visitor text of refusal %s", async (code) => {
        window.history.replaceState(null, "", `/_booking/manage#t=${TOKEN}`);
        serve(() => ({ status: 409, body: { error: "backend text", code } }));
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        const key: BookingTextKey = Object.prototype.hasOwnProperty.call(REFUSAL_TEXT, code) ? REFUSAL_TEXT[code] : "errGeneric";
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(RO[key]);
    });
});

/** A promise the test resolves by hand: a backend answer that is still on its way. */
function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}
const SLOTS = (from: string, start: string) => ({ timezone: "Europe/Bucharest", serviceId: "svc1", durationMin: 50, lastBookableDate: "2027-01-31", days: [{ date: from, starts: [start] }] });

describe("SCHED-1G2 S1G2-R1 — one lifetime rule for writes (operation.ts)", () => {
    it("R1 the rule itself: a second run while one is pending is refused; an answer after invalidate() is dropped", async () => {
        let op!: Operation;
        function Probe() { op = useOperation(); return createElement("span", null, op.busy ? "busy" : "idle"); }
        serve(() => { throw new Error("no request"); });
        await mount(createElement(Probe));
        const first = deferred<string>();
        const applied: string[] = [];
        let started = 0;
        let run1!: Promise<void>;
        await act(async () => { run1 = op.run(() => { started++; return first.promise; }, (v) => applied.push(v)); });
        expect(text()).toBe("busy");
        await act(async () => { await op.run(async () => { started++; return "second"; }, (v) => applied.push(v)); });
        expect(started).toBe(1);                       // refused while pending
        await act(async () => { op.invalidate(); first.resolve("late"); await run1; });
        expect(applied).toEqual([]);                    // the late answer belongs to an old screen
        expect(text()).toBe("idle");
        await act(async () => { await op.run(async () => "fresh", (v) => applied.push(v)); });
        expect(applied).toEqual(["fresh"]);
    });

    it("R1 book flow: while the hold is pending, Back, the form button and 'new booking' are disabled and a second submit sends nothing", async () => {
        const hold = deferred<{ status: number; body: unknown }>();
        serve((c) => {
            if (c.path.endsWith("/offer")) return { status: 200, body: OFFER };
            if (c.path.endsWith("/slots")) return { status: 200, body: SLOTS("2026-12-01", "2026-12-01T10:00:00.000Z") };
            return hold.promise;
        });
        await mount(createElement(BookFlow, { texts: RO, locale: "ro-RO", recaptchaSiteKey: undefined, initialServiceId: "svc1" }));
        await click(button("12:00"));
        await type("booking-name", "Ana");
        await type("booking-email", "ana@example.test");
        await click(button(RO.submitHold));
        expect(button(RO.back).disabled).toBe(true);
        expect(button(RO.sending).disabled).toBe(true);
        await act(async () => { (host.querySelector("form") as HTMLFormElement).requestSubmit(); });
        await click(button(RO.back));                   // a click on a disabled button does nothing
        expect(calls.filter((c) => c.path.endsWith("/hold"))).toHaveLength(1);
        expect(text()).toContain(RO.detailsHeading);
        hold.resolve({ status: 201, body: { ref: "B-0000ABCD", state: "held", expiresAt: "2026-12-01T08:30:00.000Z", emailMasked: "a***@example.test" } });
        await settle();
        expect(text()).toContain(RO.checkMailHeading);
    });

    it("R1 manage view: while a move is pending every picker button and action is disabled; a second slot sends nothing; the one answer is applied", async () => {
        window.history.replaceState(null, "", `/_booking/manage#t=${TOKEN}`);
        const move = deferred<{ status: number; body: unknown }>();
        serve((c) => {
            if (c.path.endsWith("/view")) return { status: 200, body: CONFIRMED };
            if (c.path.endsWith("/slots")) return { status: 200, body: { ...SLOTS("2026-12-01", "2026-12-01T12:00:00.000Z"), days: [{ date: "2026-12-01", starts: ["2026-12-01T12:00:00.000Z", "2026-12-01T13:00:00.000Z"] }] } };
            if (c.path.endsWith("/move")) return move.promise;
            throw new Error(`unexpected ${c.path}`);
        });
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        await click(button(RO.moveTimeButton));
        await click(button("14:00"));
        const enabled = [...host.querySelectorAll("button")].filter((b) => !(b as HTMLButtonElement).disabled).map((b) => b.textContent);
        expect(enabled).toEqual([]);                    // pickers (times, weeks) and the actions alike
        await click(button("15:00"));
        expect(calls.filter((c) => c.path.endsWith("/move"))).toHaveLength(1);
        move.resolve({ status: 200, body: { ...CONFIRMED, what: { ...CONFIRMED.what, start: "2026-12-01T12:00:00.000Z", end: "2026-12-01T12:50:00.000Z" } } });
        await settle();
        expect(text()).toContain(RO.movedNow);
        expect(button(RO.moveTimeButton).disabled).toBe(false);
    });

    it("R1 manage view: while confirm is pending, move and cancel are disabled", async () => {
        window.history.replaceState(null, "", `/_booking/manage#t=${TOKEN}`);
        const confirm = deferred<{ status: number; body: unknown }>();
        serve((c) => (c.path.endsWith("/view") ? { status: 200, body: { ...VIEW_SLOT, can: { confirm: true, cancel: true, move: true } } } : confirm.promise));
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        await click(button(RO.confirmButton));
        expect([button(RO.confirmButton).disabled, button(RO.moveTimeButton).disabled, button(RO.cancelButton).disabled]).toEqual([true, true, true]);
        confirm.resolve({ status: 200, body: CONFIRMED });
        await settle();
        expect(text()).toContain(RO.confirmedNow);
    });

    it("R1 pickers: week answers that come back in reverse order — the week on screen stays the current one", async () => {
        const answers = new Map<string, ReturnType<typeof deferred<{ status: number; body: unknown }>>>();
        serve((c) => {
            if (c.path.endsWith("/offer")) return { status: 200, body: OFFER };
            const from = new URLSearchParams(c.query).get("from")!;
            const d = deferred<{ status: number; body: unknown }>();
            answers.set(`${from}#${answers.size}`, d);
            return d.promise;
        });
        await mount(createElement(BookFlow, { texts: RO, locale: "ro-RO", recaptchaSiteKey: undefined, initialServiceId: "svc1" }));
        const [w1] = [...answers.values()];
        w1.resolve({ status: 200, body: SLOTS("2026-12-01", "2026-12-01T10:00:00.000Z") });   // 12:00 local
        await settle();
        await click(button(RO.nextWeek));                // week 2 asked …
        await click(button(RO.previousWeek));            // … then week 1 again
        const pending = [...answers.values()];
        pending[2].resolve({ status: 200, body: SLOTS("2026-12-01", "2026-12-01T11:00:00.000Z") }); // week 1 (13:00) first
        await settle();
        pending[1].resolve({ status: 200, body: SLOTS("2026-12-08", "2026-12-08T09:00:00.000Z") }); // week 2 (11:00) late
        await settle();
        expect(text()).toContain("13:00");
        expect(text()).not.toContain("11:00");
    });
});

describe("SCHED-1G2 S1G2-R3 — the ?service selector (the prop the server page passes)", () => {
    const flowWith = async (props: Record<string, string | undefined>) => {
        serve((c) => {
            if (c.path.endsWith("/offer")) return { status: 200, body: OFFER };
            if (c.path.endsWith("/slots")) return { status: 200, body: SLOTS("2026-12-01", "2026-12-01T10:00:00.000Z") };
            throw new Error(`unexpected ${c.path}`);
        });
        await mount(createElement(BookFlow, { texts: RO, locale: "ro-RO", recaptchaSiteKey: undefined, ...props }));
    };
    it("R3 absent → the offer", async () => {
        await flowWith({});
        expect(text()).toContain(RO.chooseOffer);
        expect(calls.map((c) => c.path)).toEqual(["/_booking/api/offer"]);
    });
    it("R3 valid ?service → that service's week", async () => {
        await flowWith({ initialServiceId: "svc1" });
        expect(calls.at(-1)!.path).toBe("/_booking/api/slots");
    });
    it("R3 unknown, malformed or empty ids → the offer, and no other read", async () => {
        for (const props of [{ initialServiceId: "no-such-service" }, { initialServiceId: "a#b" }, { initialServiceId: "" }, { initialServiceId: "x".repeat(500) }]) {
            calls = [];
            await act(async () => { root.render(createElement("div")); });
            await flowWith(props);
            expect(text(), JSON.stringify(props)).toContain(RO.chooseOffer);
            expect(calls.map((c) => c.path)).toEqual(["/_booking/api/offer"]);
        }
    });
});

describe("SCHED-1G2 S1G2-R4 — refusal recovery", () => {
    it("R4 manage view: an expired link offers a token-free 'new booking' link to the page's own base (domain and preview), lang and frame kept", async () => {
        for (const [path, href] of [
            ["/_booking/manage", "/_booking"],
            ["/_booking/manage?lang=ro&frame=1&x=1", "/_booking?lang=ro&frame=1"],
            ["/_site/t1/_booking/manage?lang=ro", "/_site/t1/_booking?lang=ro"],
        ]) {
            await act(async () => { root.render(createElement("div")); });
            window.history.replaceState(null, "", `${path}#t=${TOKEN}`);
            serve(() => ({ status: 410, body: { error: "x", code: "expired", expiresAt: "2026-12-01T07:00:00.000Z" } }));
            await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
            expect(host.querySelector('[role="alert"]')?.textContent).toBe(RO.errExpired);
            const link = [...host.querySelectorAll("a")].find((a) => a.textContent === RO.newBooking)!;
            expect(link.getAttribute("href"), path).toBe(href);
            expect(link.getAttribute("href")).not.toContain(TOKEN);
        }
    });
    it("R4 manage view: a stale answer keeps the token in memory and 'show the current booking' reads it again", async () => {
        window.history.replaceState(null, "", `/_booking/manage#t=${TOKEN}`);
        let views = 0;
        serve((c) => {
            if (c.path.endsWith("/view")) { views++; return { status: 200, body: views === 1 ? VIEW_SLOT : CONFIRMED }; }
            return { status: 409, body: { error: "x", code: "stale" } };
        });
        await mount(createElement(ManageView, { texts: RO, locale: "ro-RO" }));
        await click(button(RO.confirmButton));
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(RO.errStale);
        expect(window.location.hash).toBe("");          // the token is not back in the address bar
        await click(button(RO.refreshBooking));
        expect(calls.at(-1)).toEqual({ method: "POST", path: "/_booking/api/view", query: "", body: { token: TOKEN } });
        expect(text()).toContain(RO.stateConfirmed);
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });
    it("R4 book flow: a used form (intentReused) offers 'make a new booking' instead of the submit button, and it opens the offer", async () => {
        serve((c) => {
            if (c.path.endsWith("/offer")) return { status: 200, body: OFFER };
            if (c.path.endsWith("/slots")) return { status: 200, body: SLOTS("2026-12-01", "2026-12-01T10:00:00.000Z") };
            return { status: 409, body: { error: "x", code: "intentReused" } };
        });
        await mount(createElement(BookFlow, { texts: RO, locale: "ro-RO", recaptchaSiteKey: undefined, initialServiceId: "svc1" }));
        await click(button("12:00"));
        await type("booking-name", "Ana");
        await type("booking-email", "ana@example.test");
        await click(button(RO.submitHold));
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(RO.errIntentReused);
        expect([...host.querySelectorAll("button")].some((b) => b.textContent === RO.submitHold)).toBe(false);
        await click(button(RO.newBooking));
        expect(text()).toContain(RO.chooseOffer);
    });
});
