"use client";
import React, { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import type { NewsletterTexts } from "@amodx/shared";

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md) — the newsletter signup form: an email field, a consent box and a button.
 * Users: the `newsletter` block (`NewsletterRender`) and the renderer's newsletter popup (`PopupManager`, through the
 * package entry `@amodx/plugins/newsletter/NewsletterForm`) — one submit, so the block and the popup cannot differ.
 *
 * Submit (docs/plugin-architecture.md, "Browser submits from a block"): the same-origin renderer proxy `/api/leads`
 * (origin check; the proxy derives the tenant from the host), with the page's reCAPTCHA key and script when present
 * (`window.AMODX_RECAPTCHA_KEY`, `window.grecaptcha`; none → no token). Body: `{ email, source: "newsletter",
 * consentText, consentLocale, recaptchaToken }`. `consentText` is exactly the consent line drawn beside the box and
 * `consentLocale` the locale it was resolved for (NL1-R3); the backend stores them only when the pair is a line the site
 * shows at that moment (the consent evidence). The box is `required`: the browser does
 * not submit without it. Every visitor text comes from `texts` (the tenant's locale table, `newsletterTexts`); a server
 * error text is never shown. SSR-safe: `window` is read only inside the submit handler.
 */
async function recaptchaToken(): Promise<string | null> {
    // @ts-ignore — injected by the renderer's ThemeInjector
    const siteKey = window.AMODX_RECAPTCHA_KEY;
    // @ts-ignore
    const grecaptcha = window.grecaptcha;
    if (!siteKey || !grecaptcha) return null;
    return new Promise((resolve) => {
        grecaptcha.ready(() => {
            grecaptcha.execute(siteKey, { action: "newsletter" }).then((t: string) => resolve(t)).catch(() => resolve(null));
        });
    });
}

export function NewsletterForm({ texts, buttonText }: { texts: NewsletterTexts; buttonText?: string }) {
    const id = useId();
    const [status, setStatus] = useState<"idle" | "loading" | "done" | "failed">("idle");

    const submit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setStatus("loading");
        const email = new FormData(e.currentTarget).get("email");
        try {
            const res = await fetch("/api/leads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, source: "newsletter", consentText: texts.consent, consentLocale: texts.locale, recaptchaToken: await recaptchaToken() }),
            });
            setStatus(res.ok ? "done" : "failed");
        } catch {
            setStatus("failed");
        }
    };

    if (status === "done") return <p role="status" className="text-center font-medium text-foreground">{texts.thanks}</p>;

    const label = buttonText && buttonText.trim() !== "" ? buttonText : texts.subscribe;
    return (
        <form onSubmit={submit} className="space-y-3">
            <div>
                <label htmlFor={`${id}-email`} className="sr-only">{texts.email}</label>
                <input
                    id={`${id}-email`}
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder={texts.emailPlaceholder}
                    className="w-full px-4 py-2.5 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary focus:border-primary outline-none placeholder:text-muted-foreground"
                />
            </div>
            <div className="flex items-start gap-2">
                <input id={`${id}-consent`} name="consent" type="checkbox" required className="mt-1 h-4 w-4 shrink-0 accent-primary" />
                <label htmlFor={`${id}-consent`} className="text-sm text-muted-foreground">{texts.consent}</label>
            </div>
            {status === "failed" && <p role="alert" className="text-sm text-destructive">{texts.failed}</p>}
            <button
                type="submit"
                disabled={status === "loading"}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity disabled:opacity-70 flex items-center justify-center gap-2"
            >
                {status === "loading" && <Loader2 className="w-4 h-4 animate-spin" />}
                {status === "loading" ? texts.subscribing : label}
            </button>
        </form>
    );
}
