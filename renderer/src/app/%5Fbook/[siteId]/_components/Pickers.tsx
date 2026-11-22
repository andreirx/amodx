"use client";
// SCHED-1G2 — the two pickers the book page and the manage page share (docs/slices/sched-1.md § 10.1, § 10.2):
//   - `SlotWeek`: free start times of one service, one week at a time (from today in the tenant's zone up to
//     `lastBookableDate`, § 5.5); times shown in the zone of the answer, with the zone named;
//   - `RunList`: the groups of one course — the proposal of the partly filled group first (D6), the others on request
//     (`all=1`), or "no group open".
// Abstraction line: users — the book flow (new booking) and the manage view (move); axis: none; rejected: a copy of
// each picker in both pages.
import { useEffect, useState } from "react";
import {
    addDays, fillText, formatLocalDate, formatTime, localDateIn, refusalTextKey,
    type BookingTexts, type ProposalDTO, type RunDTO, type SlotsDTO,
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

export function RunCard({ run, texts, locale, action }: { run: Omit<RunDTO, "seatsLeft"> & { seatsLeft?: number }; texts: BookingTexts; locale: string; action?: React.ReactNode }) {
    return (
        <div className="space-y-2 rounded-md border p-4">
            <p className="text-sm">{run.language !== null ? fillText(texts.groupLanguage, { language: run.language }) : texts.groupLanguageOpen}</p>
            {run.seatsLeft !== undefined && <p className="text-sm">{fillText(texts.seatsLeft, { n: run.seatsLeft })}</p>}
            <p className="text-sm font-medium">{texts.meetingsHeading}</p>
            <ul className="text-sm">
                {run.meetings.map((m, i) => (
                    <li key={i}>{fillText(texts.meetingLine, { date: formatLocalDate(m.date, locale), start: m.start, end: m.end })}</li>
                ))}
            </ul>
            <p className="text-xs text-muted-foreground">{fillText(texts.timesShownIn, { zone: run.timezone })}</p>
            {action}
        </div>
    );
}

/** `disabled` (rule of `operation.ts`): every button of the list is disabled while a write is pending. */
export function RunList({ courseId, language, excludeRunId, texts, locale, onPick, disabled = false }: {
    courseId: string; language: string | undefined; excludeRunId?: string; texts: BookingTexts; locale: string; onPick: (run: RunDTO) => void;
    disabled?: boolean;
}) {
    const [all, setAll] = useState(false);
    const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; data: ProposalDTO } | { kind: "error"; code: string | undefined }>({ kind: "loading" });

    useEffect(() => {
        let live = true;
        setState({ kind: "loading" });
        const query: Record<string, string> = { courseId };
        if (language !== undefined) query.language = language;
        if (all) query.all = "1";
        callBooking<ProposalDTO>("runs", { query }).then((r) => {
            if (!live) return;
            setState(r.ok ? { kind: "ready", data: r.data } : { kind: "error", code: r.code });
        });
        return () => { live = false; };
    }, [courseId, language, all]);

    const choose = (run: RunDTO) => (
        <button type="button" className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60" disabled={disabled} onClick={() => onPick(run)}>{texts.chooseThisGroup}</button>
    );

    let body: React.ReactNode = null;
    if (state.kind === "loading") body = <p aria-live="polite">{texts.loading}</p>;
    else if (state.kind === "error") body = <Alert text={texts[refusalTextKey(state.code)]} />;
    else {
        const p = state.data;
        switch (p.kind) {
            case "noneOpen":
                body = <p>{texts.noGroupsOpen}</p>;
                break;
            case "proposed":
                body = (
                    <div className="space-y-3">
                        <p className="font-medium">{texts.proposedGroup}</p>
                        {p.run.runId === excludeRunId ? null : <RunCard run={p.run} texts={texts} locale={locale} action={choose(p.run)} />}
                        {p.othersCount > 0 && (
                            <div className="flex items-center gap-3">
                                <span className="text-sm">{fillText(texts.otherGroups, { n: p.othersCount })}</span>
                                <button type="button" className="rounded-md border px-3 py-1 text-sm disabled:opacity-40" disabled={disabled} onClick={() => setAll(true)}>{texts.showAllGroups}</button>
                            </div>
                        )}
                    </div>
                );
                break;
            case "choose": {
                const runs = p.runs.filter((r) => r.runId !== excludeRunId);
                body = runs.length === 0
                    ? <p>{texts.noGroupsOpen}</p>
                    : <ul className="space-y-3">{runs.map((r) => <li key={r.runId}><RunCard run={r} texts={texts} locale={locale} action={choose(r)} /></li>)}</ul>;
                break;
            }
            default: {
                const never: never = p;
                throw new Error(`Unhandled proposal ${JSON.stringify(never)}`);
            }
        }
    }
    return (
        <section aria-labelledby="run-list-heading" className="space-y-4">
            <h2 id="run-list-heading" className="text-xl font-semibold">{texts.chooseGroup}</h2>
            {body}
        </section>
    );
}
