"use client";
// SCHED-1G2 — the manage page (docs/slices/sched-1.md § 8.2, § 8.3, § 10.2): opened from the mailed link
// `<base>/_booking/manage#t=<token>`.
//
// § 8.2: at load the page reads the token from the fragment, REMOVES the fragment from the address bar
// (`takeLinkToken`: `history.replaceState`), keeps the token in memory only and sends it in POST bodies. § 8.3: opening
// the link (GET) changes nothing; the page sends `POST view` and shows the booking; only the Confirm button sends
// `POST confirm`. Cancel asks once more in the page. Move shows the free times of the booking's OWN service (the slot
// view carries its stored `serviceId`, ruling SCHED-1G2-SLOT-MOVE-ID = A; a service that no longer exists → "cannot be
// changed here, contact us") or the groups of its course (a seat). Every refusal code has a visitor text and, where the
// visitor must act, an action of this page (`refusalRecovery`): a token-free "new booking" link (expired), or "show the
// current booking" with the token kept in memory (stale).
//
// Writes (confirm, cancel, move, refresh) follow the one lifetime rule of `operation.ts`: one at a time, every control
// (pickers included) disabled meanwhile, an answer applied only to the screen it was started for.
import { useEffect, useRef, useState } from "react";
import { bookingBaseOf } from "@/lib/booking-path";
import {
    fillText, formatInstantWithZone, newBookingHref, refusalRecovery, refusalTextKey, takeLinkToken,
    type BookingTexts, type BookingViewDTO, type RunDTO,
} from "@/lib/booking-ui";
import { callBooking, type ApiResult } from "./api";
import { useOperation } from "./operation";
import { Alert, RunCard, RunList, SlotWeek } from "./Pickers";

type Screen =
    | { kind: "loading" }
    | { kind: "noToken" }
    | { kind: "refused"; code: string | undefined }
    | { kind: "booking"; view: BookingViewDTO }
    | { kind: "cancelled"; ref: string };
type Mode =
    | { kind: "idle" }
    | { kind: "askCancel" }
    | { kind: "moveSlot"; serviceId: string; timezone: string }
    | { kind: "moveSeat"; courseId: string; language: string | undefined; currentRunId: string | undefined }
    | { kind: "moveNotOffered" };
/** `moving`: the refusal answered a move (a 404 then means the booking's service or group is gone). */
type Notice = { kind: "none" } | { kind: "done"; text: string } | { kind: "refused"; code: string | undefined; moving: boolean };

/** The zone the booking's times are shown in: the slot's zone, else the run's (an unplaced booking shows none). */
function zoneOf(view: BookingViewDTO): string | undefined {
    const w = view.what;
    switch (w.kind) {
        case "slot": return w.timezone;
        case "seat": return w.run.timezone;
        case "unplaced": return w.proposal.kind === "proposed" ? w.proposal.run.timezone : w.proposal.kind === "choose" ? w.proposal.runs[0]?.timezone : undefined;
        default: {
            const never: never = w;
            throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
        }
    }
}

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

    /** Opens the move picker for the booking's own placement (no read: the view names the service and the course). */
    function startMove(view: BookingViewDTO) {
        const w = view.what;
        setNotice({ kind: "none" });
        switch (w.kind) {
            case "slot":
                setMode({ kind: "moveSlot", serviceId: w.serviceId, timezone: w.timezone });
                break;
            case "seat":
                setMode({ kind: "moveSeat", courseId: w.run.courseId, language: w.run.language ?? undefined, currentRunId: w.run.runId });
                break;
            case "unplaced": {
                const p = w.proposal;
                const any = p.kind === "proposed" ? p.run : p.kind === "choose" ? p.runs[0] : undefined;
                setMode(any !== undefined ? { kind: "moveSeat", courseId: any.courseId, language: undefined, currentRunId: undefined } : { kind: "moveNotOffered" });
                break;
            }
            default: {
                const never: never = w;
                throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
            }
        }
    }

    /** A refusal with the action the visitor can take (S1G2-R4). A move answered 404 `notFound`: the booking's service
     *  or group no longer exists, so moving is not possible online (ruling SCHED-1G2-SLOT-MOVE-ID = A). */
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
    const zone = zoneOf(view);
    const w = view.what;
    let what: React.ReactNode;
    switch (w.kind) {
        case "slot":
            what = (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="font-medium">{texts.whatLabel}</dt><dd>{w.serviceName}</dd>
                    <dt className="font-medium">{texts.whenLabel}</dt><dd>{formatInstantWithZone(w.start, locale, w.timezone)}</dd>
                </dl>
            );
            break;
        case "seat":
            what = (
                <div className="space-y-2">
                    <p><span className="font-medium">{texts.whatLabel}:</span> {w.courseName}</p>
                    <RunCard run={w.run} texts={texts} locale={locale} />
                    {w.groupLink !== undefined && (
                        <p><a className="underline" href={w.groupLink} rel="noopener noreferrer" target="_blank">{texts.groupChatLink}</a></p>
                    )}
                </div>
            );
            break;
        case "unplaced":
            what = <p>{fillText(texts.unplacedNote, { course: w.courseName })}</p>;
            break;
        default: {
            const never: never = w;
            throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
        }
    }

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
        case "moveSeat":
            action = <RunList courseId={mode.courseId} language={mode.language} excludeRunId={mode.currentRunId} texts={texts} locale={locale}
                disabled={op.busy}
                onPick={(run: RunDTO) => write("move", { to: { kind: "seat", runId: run.runId } }, texts.movedNow)} />;
            break;
        case "moveNotOffered": action = <p>{texts.moveNotOffered}</p>; break;
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
                    ? fillText(texts.stateHeld, { time: view.expiresAt !== undefined && zone !== undefined ? formatInstantWithZone(view.expiresAt, locale, zone) : "" })
                    : texts.stateConfirmed}
            </p>
            {what}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="font-medium">{texts.nameLabel}</dt><dd>{view.who.name}</dd>
                <dt className="font-medium">{texts.emailLabel}</dt><dd>{view.who.emailMasked}</dd>
            </dl>
            {view.changeCutoff !== undefined && zone !== undefined && (view.can.cancel || view.can.move) && (
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
                        {w.kind === "slot" ? texts.moveTimeButton : texts.moveGroupButton}
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
