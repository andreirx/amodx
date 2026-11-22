"use client";
// SCHED-1G2 — the book page flow (docs/slices/sched-1.md § 10.1, § 10.2, § 7.2, § 9.1): offer → a service (its free
// times, week by week) or a course (language when the course has several, then its groups: the proposal first) →
// name, email, phone → hold → "check your email". A hold does NOT confirm: it reserves the time or the place until
// `expiresAt` and mails a link; only the Confirm button of the manage page confirms (§ 8.3). Every refusal code has a
// visitor text (`refusalTextKey`); a used or closed form offers "make a new booking" (`refusalRecovery`, S1G2-R4).
//
// Hold and resend follow the one lifetime rule of `operation.ts`: one at a time; Back, the form and "new booking" are
// disabled while one is pending; every navigation moves the epoch, so a late answer never replaces the current screen.
//
// The intent id (§ 7.2) is created once per chosen time or group and kept across retries, so a double submit or a
// retry after a lost answer is answered by the backend's replay table instead of a second booking. The reCAPTCHA v3
// token is requested at submit time (the script is loaded by the page with the tenant's key, § 9.1).
import { useEffect, useRef, useState } from "react";
import { fillText, formatInstantWithZone, refusalRecovery, refusalTextKey, type BookingTexts, type HoldResult, type OfferDTO, type RunDTO } from "@/lib/booking-ui";
import { callBooking } from "./api";
import { useOperation, type Operation } from "./operation";
import { Alert, RunCard, RunList, SlotWeek } from "./Pickers";

type Service = OfferDTO["services"][number];
type Course = OfferDTO["courses"][number];
type Choice =
    | { kind: "slot"; service: Service; start: string; timezone: string }
    | { kind: "seat"; course: Course; run: RunDTO; language: string | undefined };
type HoldBody = {
    intentId: string; recaptchaToken?: string; resend?: boolean;
    what: { kind: "slot"; serviceId: string; start: string } | { kind: "seat"; courseId: string; runId: string };
    who: { email: string; name: string; phone?: string; language?: string };
};
type Step =
    | { kind: "offer" }
    | { kind: "service"; service: Service }
    | { kind: "language"; course: Course }
    | { kind: "course"; course: Course; language: string | undefined }
    | { kind: "details"; choice: Choice; intentId: string }
    | { kind: "sent"; result: HoldResult; body: HoldBody };

type Grecaptcha = { ready(cb: () => void): void; execute(key: string, opts: { action: string }): Promise<string> };

/** A reCAPTCHA v3 token, or `undefined` when the script is not there (the backend then answers `verificationRequired`). */
async function recaptchaToken(siteKey: string | undefined): Promise<string | undefined> {
    const g = (window as unknown as { grecaptcha?: Grecaptcha }).grecaptcha;
    if (!siteKey || g === undefined) return undefined;
    try {
        return await new Promise<string>((resolve, reject) => g.ready(() => { g.execute(siteKey, { action: "booking_hold" }).then(resolve, reject); }));
    } catch {
        return undefined;
    }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function describeChoice(choice: Choice, locale: string): string {
    switch (choice.kind) {
        case "slot": return `${choice.service.name} — ${formatInstantWithZone(choice.start, locale, choice.timezone)}`;
        case "seat": return choice.course.name;
        default: {
            const never: never = choice;
            throw new Error(`Unhandled choice ${JSON.stringify(never)}`);
        }
    }
}

export function BookFlow({ texts, locale, recaptchaSiteKey, initialServiceId, initialCourseId }: {
    texts: BookingTexts; locale: string; recaptchaSiteKey: string | undefined; initialServiceId?: string; initialCourseId?: string;
}) {
    const [offer, setOffer] = useState<{ kind: "loading" } | { kind: "ready"; data: OfferDTO } | { kind: "error"; code: string | undefined }>({ kind: "loading" });
    const [step, setStep] = useState<Step>({ kind: "offer" });
    const headingRef = useRef<HTMLHeadingElement>(null);
    const op = useOperation();
    /** Every change of screen: the answer of anything still pending belongs to the old screen (rule 2 of operation.ts). */
    const go = (next: Step) => { op.invalidate(); setStep(next); };

    useEffect(() => {
        let live = true;
        callBooking<OfferDTO>("offer", {}).then((r) => {
            if (!live) return;
            if (!r.ok) { setOffer({ kind: "error", code: r.code }); return; }
            setOffer({ kind: "ready", data: r.data });
            const service = r.data.services.find((s) => s.id === initialServiceId);
            const course = r.data.courses.find((c) => c.id === initialCourseId);
            if (service) setStep({ kind: "service", service });
            else if (course) setStep(courseStep(course));
        });
        return () => { live = false; };
        // The initial parameters are read once, at load (G3).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Focus order: after each step change the step's heading takes the focus.
    useEffect(() => { headingRef.current?.focus(); }, [step.kind]);

    function courseStep(course: Course): Step {
        if (course.languages.length > 1) return { kind: "language", course };
        return { kind: "course", course, language: course.languages[0] };
    }
    const back = <button type="button" className="text-sm underline" onClick={() => go({ kind: "offer" })}>{texts.back}</button>;

    if (offer.kind === "loading") return <p aria-live="polite">{texts.loading}</p>;
    if (offer.kind === "error") return <Alert text={texts[refusalTextKey(offer.code)]} />;
    const data = offer.data;

    switch (step.kind) {
        case "offer":
            if (data.services.length === 0 && data.courses.length === 0) return <p>{texts.nothingOffered}</p>;
            return (
                <div className="space-y-6">
                    <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold">{texts.chooseOffer}</h2>
                    {data.services.length > 0 && (
                        <section aria-labelledby="services-heading" className="space-y-2">
                            <h3 id="services-heading" className="font-medium">{texts.servicesHeading}</h3>
                            <ul className="space-y-2">
                                {data.services.map((s) => (
                                    <li key={s.id}>
                                        <button type="button" className="w-full rounded-md border px-4 py-3 text-left hover:bg-muted" onClick={() => go({ kind: "service", service: s })}>
                                            <span className="font-medium">{s.name}</span>{" "}
                                            <span className="text-sm text-muted-foreground">{fillText(texts.durationMinutes, { n: s.durationMin })}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    {data.courses.length > 0 && (
                        <section aria-labelledby="courses-heading" className="space-y-2">
                            <h3 id="courses-heading" className="font-medium">{texts.coursesHeading}</h3>
                            <ul className="space-y-2">
                                {data.courses.map((c) => (
                                    <li key={c.id}>
                                        <button type="button" className="w-full rounded-md border px-4 py-3 text-left font-medium hover:bg-muted" onClick={() => go(courseStep(c))}>{c.name}</button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </div>
            );
        case "service":
            return (
                <div className="space-y-4">
                    {back}
                    <h2 ref={headingRef} tabIndex={-1} className="sr-only">{step.service.name}</h2>
                    <p className="font-medium">{step.service.name}</p>
                    <SlotWeek serviceId={step.service.id} timezone={data.timezone} texts={texts} locale={locale}
                        onPick={(start) => go({ kind: "details", intentId: crypto.randomUUID(), choice: { kind: "slot", service: step.service, start, timezone: data.timezone } })} />
                </div>
            );
        case "language":
            return (
                <div className="space-y-4">
                    {back}
                    <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold">{texts.chooseLanguage}</h2>
                    <p className="font-medium">{step.course.name}</p>
                    <ul className="flex flex-wrap gap-2">
                        {step.course.languages.map((l) => (
                            <li key={l}>
                                <button type="button" className="rounded-md border px-4 py-2 hover:bg-muted" onClick={() => go({ kind: "course", course: step.course, language: l })}>{l}</button>
                            </li>
                        ))}
                    </ul>
                </div>
            );
        case "course":
            return (
                <div className="space-y-4">
                    {back}
                    <h2 ref={headingRef} tabIndex={-1} className="sr-only">{step.course.name}</h2>
                    <p className="font-medium">{step.course.name}</p>
                    <RunList courseId={step.course.id} language={step.language} texts={texts} locale={locale}
                        onPick={(run) => go({ kind: "details", intentId: crypto.randomUUID(), choice: { kind: "seat", course: step.course, run, language: step.language } })} />
                </div>
            );
        case "details":
            return <DetailsForm key={step.intentId} step={step} op={op} texts={texts} locale={locale} recaptchaSiteKey={recaptchaSiteKey}
                headingRef={headingRef} onBack={() => go({ kind: "offer" })} onSent={(result, body) => go({ kind: "sent", result, body })} />;
        case "sent":
            return <Sent step={step} op={op} timezone={data.timezone} texts={texts} locale={locale} recaptchaSiteKey={recaptchaSiteKey} headingRef={headingRef} onNew={() => go({ kind: "offer" })} />;
        default: {
            const never: never = step;
            throw new Error(`Unhandled step ${JSON.stringify(never)}`);
        }
    }
}

function DetailsForm({ step, op, texts, locale, recaptchaSiteKey, headingRef, onBack, onSent }: {
    step: Extract<Step, { kind: "details" }>; op: Operation; texts: BookingTexts; locale: string; recaptchaSiteKey: string | undefined;
    headingRef: React.RefObject<HTMLHeadingElement | null>; onBack: () => void; onSent: (result: HoldResult, body: HoldBody) => void;
}) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({});
    const [refusal, setRefusal] = useState<{ code: string | undefined } | null>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const emailRef = useRef<HTMLInputElement>(null);
    const choice = step.choice;

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        const errors: { name?: string; email?: string } = {};
        if (name.trim() === "") errors.name = texts.fieldRequired;
        if (email.trim() === "") errors.email = texts.fieldRequired;
        else if (!EMAIL.test(email.trim())) errors.email = texts.emailInvalid;
        setFieldErrors(errors);
        setRefusal(null);
        if (errors.name) { nameRef.current?.focus(); return; }
        if (errors.email) { emailRef.current?.focus(); return; }
        const language = choice.kind === "seat" ? choice.language : undefined;
        const body: HoldBody = {
            intentId: step.intentId,
            what: choice.kind === "slot"
                ? { kind: "slot", serviceId: choice.service.id, start: choice.start }
                : { kind: "seat", courseId: choice.course.id, runId: choice.run.runId },
            who: { email: email.trim(), name: name.trim(), ...(phone.trim() !== "" ? { phone: phone.trim() } : {}), ...(language !== undefined ? { language } : {}) },
        };
        await op.run(async () => {
            const token = await recaptchaToken(recaptchaSiteKey);
            return callBooking<HoldResult>("hold", { body: { ...body, ...(token !== undefined ? { recaptchaToken: token } : {}) } });
        }, (r) => {
            if (r.ok) onSent(r.data, body);
            else setRefusal({ code: r.code });
        });
    }

    const inputClass = "w-full rounded-md border px-3 py-2";
    return (
        <form onSubmit={submit} noValidate className="space-y-4">
            <button type="button" disabled={op.busy} className="text-sm underline disabled:opacity-40" onClick={onBack}>{texts.back}</button>
            <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold">{texts.detailsHeading}</h2>
            <p>{fillText(texts.selectedLabel, { what: describeChoice(choice, locale) })}</p>
            {choice.kind === "seat" && <RunCard run={choice.run} texts={texts} locale={locale} />}
            <div className="space-y-1">
                <label htmlFor="booking-name" className="block text-sm font-medium">{texts.nameLabel}</label>
                <input id="booking-name" ref={nameRef} className={inputClass} autoComplete="name" required maxLength={200} value={name}
                    onChange={(e) => setName(e.target.value)} aria-invalid={fieldErrors.name ? true : undefined}
                    aria-describedby={fieldErrors.name ? "booking-name-error" : undefined} />
                {fieldErrors.name && <p id="booking-name-error" className="text-sm text-destructive">{fieldErrors.name}</p>}
            </div>
            <div className="space-y-1">
                <label htmlFor="booking-email" className="block text-sm font-medium">{texts.emailLabel}</label>
                <input id="booking-email" ref={emailRef} type="email" className={inputClass} autoComplete="email" required maxLength={320} value={email}
                    onChange={(e) => setEmail(e.target.value)} aria-invalid={fieldErrors.email ? true : undefined}
                    aria-describedby={fieldErrors.email ? "booking-email-error" : undefined} />
                {fieldErrors.email && <p id="booking-email-error" className="text-sm text-destructive">{fieldErrors.email}</p>}
            </div>
            <div className="space-y-1">
                <label htmlFor="booking-phone" className="block text-sm font-medium">{texts.phoneLabel}</label>
                <input id="booking-phone" type="tel" className={inputClass} autoComplete="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            {choice.kind === "seat" && choice.language !== undefined && (
                <p className="text-sm">{texts.languageLabel}: {choice.language}</p>
            )}
            {refusal !== null && <Alert text={texts[refusalTextKey(refusal.code)]} />}
            {refusal !== null && refusalRecovery(refusal.code) === "newBooking"
                ? <button type="button" className="rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={onBack}>{texts.newBooking}</button>
                : (
                    <button type="submit" disabled={op.busy} className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60">
                        {op.busy ? texts.sending : texts.submitHold}
                    </button>
                )}
        </form>
    );
}

function Sent({ step, op, timezone, texts, locale, recaptchaSiteKey, headingRef, onNew }: {
    step: Extract<Step, { kind: "sent" }>; op: Operation; timezone: string; texts: BookingTexts; locale: string; recaptchaSiteKey: string | undefined;
    headingRef: React.RefObject<HTMLHeadingElement | null>; onNew: () => void;
}) {
    const [notice, setNotice] = useState<{ kind: "none" } | { kind: "resent" } | { kind: "refused"; text: string }>({ kind: "none" });
    const r = step.result;

    async function resend() {
        setNotice({ kind: "none" });
        await op.run(async () => {
            const token = await recaptchaToken(recaptchaSiteKey);
            return callBooking<HoldResult>("hold", { body: { ...step.body, resend: true, ...(token !== undefined ? { recaptchaToken: token } : {}) } });
        }, (answer) => setNotice(answer.ok ? { kind: "resent" } : { kind: "refused", text: texts[refusalTextKey(answer.code)] }));
    }

    return (
        <div className="space-y-4">
            <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold">{texts.checkMailHeading}</h2>
            {r.state === "held"
                ? <p>{fillText(texts.checkMailHeld, { email: r.emailMasked, ref: r.ref, time: formatInstantWithZone(r.expiresAt, locale, timezone) })}</p>
                : <p>{fillText(texts.checkMailConfirmed, { email: r.emailMasked, ref: r.ref })}</p>}
            {r.state === "held" && (
                <button type="button" disabled={op.busy} className="rounded-md border px-4 py-2 disabled:opacity-60" onClick={resend}>{texts.resendMail}</button>
            )}
            {notice.kind === "resent" && <p role="status">{texts.resent}</p>}
            {notice.kind === "refused" && <Alert text={notice.text} />}
            <button type="button" disabled={op.busy} className="block text-sm underline disabled:opacity-40" onClick={onNew}>{texts.newBooking}</button>
        </div>
    );
}
