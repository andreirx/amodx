"use client";
// SCHED-1G2 — the manage page (docs/slices/sched-1.md § 8.2, § 8.3, § 10.2): opened from the mailed link
// `<base>/_booking/manage#t=<token>`.
//
// § 8.2: at load the page reads the token from the fragment, REMOVES the fragment from the address bar
// (`takeLinkToken`: `history.replaceState`), keeps the token in memory only and sends it in POST bodies. § 8.3: opening
// the link (GET) changes nothing; the page sends `POST view` and shows the booking; only the Confirm button sends
// `POST confirm`. Cancel asks once more in the page. Move shows the free times of the booking's OWN service (the slot
// view carries its stored `serviceId`, ruling SCHED-1G2-SLOT-MOVE-ID = A; a service that no longer exists → "cannot be
// changed here, contact us"). Every refusal code has a visitor text and, where the
// visitor must act, an action of this page (`refusalRecovery`): a token-free "new booking" link (expired), or "show the
// current booking" with the token kept in memory (stale).
//
// Writes (confirm, cancel, move, refresh) follow the one lifetime rule of `operation.ts`: one at a time, every control
// (pickers included) disabled meanwhile, an answer applied only to the screen it was started for.
import { useEffect, useRef, useState } from "react";
import { bookingBaseOf } from "@/lib/booking-path";
import {
    fillText, formatInstantWithZone, newBookingHref, refusalRecovery, refusalTextKey, takeLinkToken,
    type BookingTexts, type BookingViewDTO,
} from "@/lib/booking-ui";
import { callBooking, type ApiResult } from "./api";
import { useOperation } from "./operation";
import { Alert, SlotWeek } from "./Pickers";

type Screen =
    | { kind: "loading" }
    | { kind: "noToken" }
    | { kind: "refused"; code: string | undefined }
    | { kind: "booking"; view: BookingViewDTO }
    | { kind: "cancelled"; ref: string };
type Mode =
    | { kind: "idle" }
    | { kind: "askCancel" }
    | { kind: "moveSlot"; serviceId: string; timezone: string };
/** `moving`: the refusal answered a move (a 404 then means the booking's service is gone). */
type Notice = { kind: "none" } | { kind: "done"; text: string } | { kind: "refused"; code: string | undefined; moving: boolean };

export function ManageView({ texts, locale }: { texts: BookingTexts; locale: string }) {
    const token = useRef<string | null>(null);
    const [screen, setScreen] = useState<Screen>({ kind: "loading" });
    const [mode, setMode] = useState<Mode>({ kind: "idle" });
    const [notice, setNotice] = useState<Notice>({ kind: "none" });
    const op = useOperation();
    const headingRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        let live = true;
        const t = takeLinkToken(window.location, window.history);
        token.current = t;
        if (t === null) { setScreen({ kind: "noToken" }); return; }
        callBooking<BookingViewDTO>("view", { body: { token: t } }).then((r) => {
            if (live) setScreen(r.ok ? { kind: "booking", view: r.data } : { kind: "refused", code: r.code });
        });
        return () => { live = false; };
    }, []);

    useEffect(() => { headingRef.current?.focus(); }, [screen.kind, mode.kind]);

    /** One write through the lifetime rule; `done` is the text shown when it succeeds (none for a plain refresh). */
    function write(op_: "view" | "confirm" | "move", extra: Record<string, unknown>, done: string | null) {
        const t = token.current;
        if (t === null) return;
        const moving = op_ === "move";
        setNotice({ kind: "none" });
        void op.run(() => callBooking<BookingViewDTO>(op_, { body: { token: t, ...extra } }), (r: ApiResult<BookingViewDTO>) => {
            if (r.ok) {
                setScreen({ kind: "booking", view: r.data });
                setMode({ kind: "idle" });
                setNotice(done === null ? { kind: "none" } : { kind: "done", text: done });
            } else {
                setNotice({ kind: "refused", code: r.code, moving });
            }
        });
    }

    function cancel() {
        const t = token.current;
        if (t === null) return;
        setNotice({ kind: "none" });
        void op.run(() => callBooking<{ ref: string; state: "cancelled" }>("cancel", { body: { token: t } }), (r) => {
            if (r.ok) setScreen({ kind: "cancelled", ref: r.data.ref });
            else { setMode({ kind: "idle" }); setNotice({ kind: "refused", code: r.code, moving: false }); }
        });
    }

    /** Opens the move picker for the booking's own service (no read: the view names the service). */
    function startMove(view: BookingViewDTO) {
        setNotice({ kind: "none" });
        setMode({ kind: "moveSlot", serviceId: view.what.serviceId, timezone: view.what.timezone });
    }

    /** A refusal with the action the visitor can take (S1G2-R4). A move answered 404 `notFound`: the booking's service
     *  no longer exists, so moving is not possible online (ruling SCHED-1G2-SLOT-MOVE-ID = A). */
    function refusalBlock(code: string | undefined, moving: boolean) {
        const recovery = refusalRecovery(code);
        const text = moving && code === "notFound" ? texts.moveNotOffered : texts[refusalTextKey(code)];
        return (
            <div className="space-y-2">
                <Alert text={text} />
                {recovery === "newBooking" && (
                    <a className="inline-block underline" href={newBookingHref(window.location, bookingBaseOf(window.location.pathname))}>{texts.newBooking}</a>
                )}
                {recovery === "refresh" && token.current !== null && (
                    <button type="button" disabled={op.busy} className="rounded-md border px-4 py-2 disabled:opacity-60"
                        onClick={() => write("view", {}, null)}>{texts.refreshBooking}</button>
                )}
            </div>
        );
    }

    switch (screen.kind) {
        case "loading": return <p aria-live="polite">{texts.loading}</p>;
        case "noToken": return <p>{texts.noLinkToken}</p>;
        case "refused": return refusalBlock(screen.code, false);
        case "cancelled":
            return <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold">{fillText(texts.cancelledNow, { ref: screen.ref })}</h2>;
        case "booking": break;
        default: {
            const never: never = screen;
            throw new Error(`Unhandled screen ${JSON.stringify(never)}`);
        }
    }

    const view = screen.view;
    const w = view.what;
    // The zone the booking's times are shown in: the slot's zone.
    const zone = w.timezone;
    const what = (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="font-medium">{texts.whatLabel}</dt><dd>{w.serviceName}</dd>
            <dt className="font-medium">{texts.whenLabel}</dt><dd>{formatInstantWithZone(w.start, locale, w.timezone)}</dd>
        </dl>
    );

    let action: React.ReactNode = null;
    switch (mode.kind) {
        case "idle": action = null; break;
        case "askCancel":
            action = (
                <div role="group" aria-labelledby="cancel-question" className="space-y-2 rounded-md border p-4">
                    <p id="cancel-question">{texts.cancelQuestion}</p>
                    <div className="flex gap-2">
                        <button type="button" disabled={op.busy} className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60" onClick={cancel}>{texts.cancelYes}</button>
                        <button type="button" disabled={op.busy} className="rounded-md border px-4 py-2 disabled:opacity-60" onClick={() => setMode({ kind: "idle" })}>{texts.cancelNo}</button>
                    </div>
                </div>
            );
            break;
        case "moveSlot":
            action = <SlotWeek serviceId={mode.serviceId} timezone={mode.timezone} texts={texts} locale={locale}
                disabled={op.busy} serviceGoneText={texts.moveNotOffered}
                onPick={(start) => write("move", { to: { kind: "slot", start } }, texts.movedNow)} />;
            break;
        default: {
            const never: never = mode;
            throw new Error(`Unhandled mode ${JSON.stringify(never)}`);
        }
    }

    return (
        <div className="space-y-4">
            <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold">{fillText(texts.bookingRef, { ref: view.ref })}</h2>
            <p>
                {view.state === "held"
                    ? fillText(texts.stateHeld, { time: view.expiresAt !== undefined ? formatInstantWithZone(view.expiresAt, locale, zone) : "" })
                    : texts.stateConfirmed}
            </p>
            {what}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="font-medium">{texts.nameLabel}</dt><dd>{view.who.name}</dd>
                <dt className="font-medium">{texts.emailLabel}</dt><dd>{view.who.emailMasked}</dd>
            </dl>
            {(view.can.cancel || view.can.move) && (
                <p className="text-sm text-muted-foreground">{fillText(texts.changeUntil, { time: formatInstantWithZone(view.changeCutoff, locale, zone) })}</p>
            )}
            {notice.kind === "done" && <p role="status">{notice.text}</p>}
            {notice.kind === "refused" && refusalBlock(notice.code, notice.moving)}
            <div className="flex flex-wrap gap-2">
                {view.can.confirm && (
                    <button type="button" disabled={op.busy} className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
                        onClick={() => write("confirm", {}, texts.confirmedNow)}>{texts.confirmButton}</button>
                )}
                {view.can.move && (
                    <button type="button" disabled={op.busy} className="rounded-md border px-4 py-2 disabled:opacity-60" onClick={() => startMove(view)}>
                        {texts.moveTimeButton}
                    </button>
                )}
                {view.can.cancel && (
                    <button type="button" disabled={op.busy} className="rounded-md border px-4 py-2 disabled:opacity-60" onClick={() => setMode({ kind: "askCancel" })}>{texts.cancelButton}</button>
                )}
            </div>
            {action}
        </div>
    );
}
