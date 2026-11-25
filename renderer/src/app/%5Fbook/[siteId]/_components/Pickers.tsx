"use client";
// SCHED-1G2 — the picker the book page and the manage page share (docs/slices/sched-1.md § 10.1, § 10.2):
//   - `SlotWeek`: free start times of one service, one week at a time (from today in the tenant's zone up to
//     `lastBookableDate`, § 5.5); times shown in the zone of the answer, with the zone named.
// Abstraction line: users — the book flow (new booking) and the manage view (move); axis: none; rejected: a copy of
// the picker in both pages.
import { useEffect, useState } from "react";
import {
    addDays, fillText, formatLocalDate, formatTime, localDateIn, refusalTextKey,
    type BookingTexts, type SlotsDTO,
} from "@/lib/booking-ui";
import { callBooking } from "./api";

export function Alert({ text }: { text: string }) {
    return <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{text}</p>;
}

/**
 * `disabled` (rule of `operation.ts`): every button of the picker is disabled while a write is pending.
 * `serviceGoneText`: shown instead of the generic text when the service no longer exists (404 `notFound`); the manage
 * page passes "cannot be changed here, contact us" (ruling SCHED-1G2-SLOT-MOVE-ID = A).
 */
export function SlotWeek({ serviceId, timezone, texts, locale, onPick, disabled = false, serviceGoneText }: {
    serviceId: string; timezone: string; texts: BookingTexts; locale: string; onPick: (startIso: string) => void;
    disabled?: boolean; serviceGoneText?: string;
}) {
    const today = localDateIn(Date.now(), timezone);
    const [from, setFrom] = useState(today);
    const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; data: SlotsDTO } | { kind: "error"; code: string | undefined }>({ kind: "loading" });

    useEffect(() => {
        let live = true;
        setState({ kind: "loading" });
        callBooking<SlotsDTO>("slots", { query: { serviceId, from, to: addDays(from, 6) } }).then((r) => {
            if (!live) return;
            setState(r.ok ? { kind: "ready", data: r.data } : { kind: "error", code: r.code });
        });
        return () => { live = false; };
    }, [serviceId, from]);

    const data = state.kind === "ready" ? state.data : null;
    const nextFrom = addDays(from, 7);
    const canNext = data !== null && nextFrom <= data.lastBookableDate;
    const canPrevious = from > today;
    const days = data?.days.filter((d) => d.starts.length > 0) ?? [];

    return (
        <section aria-labelledby="slot-week-heading" className="space-y-4">
            <h2 id="slot-week-heading" className="text-xl font-semibold">{texts.chooseTime}</h2>
            <div className="flex items-center justify-between gap-2">
                <button type="button" className="rounded-md border px-3 py-1 text-sm disabled:opacity-40" disabled={disabled || !canPrevious}
                    onClick={() => setFrom(addDays(from, -7) < today ? today : addDays(from, -7))}>{texts.previousWeek}</button>
                <span className="text-sm" aria-live="polite">{formatLocalDate(from, locale)} – {formatLocalDate(addDays(from, 6), locale)}</span>
                <button type="button" className="rounded-md border px-3 py-1 text-sm disabled:opacity-40" disabled={disabled || !canNext}
                    onClick={() => setFrom(nextFrom)}>{texts.nextWeek}</button>
            </div>
            {state.kind === "loading" && <p aria-live="polite">{texts.loading}</p>}
            {state.kind === "error" && <Alert text={state.code === "notFound" && serviceGoneText !== undefined ? serviceGoneText : texts[refusalTextKey(state.code)]} />}
            {data !== null && (
                <>
                    <p className="text-sm text-muted-foreground">{fillText(texts.timesShownIn, { zone: data.timezone })}</p>
                    {days.length === 0 && <p>{texts.noTimesThisWeek}</p>}
                    {days.map((day) => (
                        <div key={day.date} className="space-y-2">
                            <h3 className="font-medium">{formatLocalDate(day.date, locale)}</h3>
                            <ul className="flex flex-wrap gap-2">
                                {day.starts.map((start) => (
                                    <li key={start}>
                                        <button type="button" className="rounded-md border px-3 py-1 hover:bg-muted disabled:opacity-40" disabled={disabled} onClick={() => onPick(start)}>
                                            {formatTime(start, locale, data.timezone)}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                    {!canNext && <p className="text-sm text-muted-foreground">{fillText(texts.lastBookableDate, { date: formatLocalDate(data.lastBookableDate, locale) })}</p>}
                </>
            )}
        </section>
    );
}
