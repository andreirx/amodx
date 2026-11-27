"use client";

import { useEffect, useId, useState } from "react";
import { Loader2, CheckCircle } from "lucide-react";
import type { FormField, LocaleStrings } from "@amodx/shared";

/**
 * SHOP-LOOK-1E: moved from `renderer/src/components/DynamicForm.tsx` (it had no importer there) into the `form` block,
 * so a page can place it. Changes from the renderer copy, and nothing else:
 * - reCAPTCHA: the page globals `window.AMODX_RECAPTCHA_KEY` and `window.grecaptcha` (injected by the renderer's
 *   `ThemeInjector`), read here as the `contact` and `leadMagnet` blocks read them — a plugin cannot import the
 *   renderer's `useRecaptcha` hook (split entry, `docs/plugin-architecture.md`). Same behaviour: no key or no script →
 *   no token (`null`).
 * - The slug is URL-encoded in the submit path.
 * - Each field's label is tied to its control (`htmlFor` / `id`), so every input has an accessible name. A checkbox has
 *   only its own wrapping label (SMALL-FIXES-1 C: it drew a label line above it too, so its text showed twice).
 * - The required mark and the error text use the theme's `destructive` colour (was `text-red-500`). The success icon
 *   keeps `text-green-500`: the theme has no success colour (finding F-1E-SUCCESS-COLOUR).
 *
 * STAY-1A (docs/slices/stay-1.md § 2, Build record): `FormField` is the shared schema's type (was a copy here), so a new
 * field type is a compile error in `control` below. A `date` field is a native `<input type="date">`. Its `min` is a
 * hint only (the submit handler is the authority): `min: "today"` → the visitor's local today, set in an effect after
 * hydration (never read during render: no hydration mismatch); the later field of the pair rule (`dateOrder`) → the day
 * after the earlier field's value. A form without a date field renders the same bytes as before.
 */

export type { FormField };

export type DynamicFormStrings = Pick<LocaleStrings["site"], "formSubmissionFailed" | "formErrorShort" | "formSelectPlaceholder" | "formSubmitting">;

interface DynamicFormProps {
    formSlug: string;
    formName: string;
    fields: FormField[];
    submitButtonText: string;
    successMessage: string;
    tenantId: string;
    apiUrl: string;
    /** LOCALE-1A: the site keys this component renders (docs/slices/locale-1.md § 6.1). */
    strings: DynamicFormStrings;
    /** STAY-1A: the form's pair rule, given only when it names two date fields of `fields` (the renderer resolves it). */
    dateOrder?: { earlier: string; later: string };
}

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const pad2 = (n: number) => String(n).padStart(2, "0");
const pad4 = (n: number) => String(n).padStart(4, "0");
/**
 * The calendar day after a `YYYY-MM-DD` text, computed in UTC (no local-time step can move the day); null after
 * 9999-12-31. The day is built with `setUTCFullYear`, never `Date.UTC`, which reads a year 0-99 as 1900-1999
 * (F-STAY1A-YEAR-REMAP: the rule of `packages/shared/src/form-date.ts`).
 */
function dayAfter(date: string): string | null {
    const [y, m, d] = date.split("-").map(Number);
    const t = new Date(0);
    t.setUTCFullYear(y, m - 1, d + 1);
    if (t.getUTCFullYear() > 9999) return null;
    return `${pad4(t.getUTCFullYear())}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}
/** The visitor's local calendar date. Called only in an effect, never during render. */
function localToday(): string {
    const now = new Date();
    return `${pad4(now.getFullYear())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** A reCAPTCHA v3 token for `action`, or null when the page has no key or no reCAPTCHA script (the contact block's rule). */
function recaptchaToken(action: string): Promise<string | null> {
    if (typeof window === "undefined") return Promise.resolve(null);
    const siteKey = (window as any).AMODX_RECAPTCHA_KEY;
    const grecaptcha = (window as any).grecaptcha;
    if (!siteKey || !grecaptcha) return Promise.resolve(null);
    return new Promise((resolve) => {
        grecaptcha.ready(() => {
            grecaptcha
                .execute(siteKey, { action })
                .then((token: string) => resolve(token))
                .catch(() => resolve(null));
        });
    });
}

// `formName` is accepted as before and not drawn (finding F-1E-FORM-NAME in the record).
export function DynamicForm({ formSlug, fields, submitButtonText, successMessage, tenantId, apiUrl, strings, dateOrder }: DynamicFormProps) {
    const [values, setValues] = useState<Record<string, any>>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState("");
    const idPrefix = useId();
    // STAY-1A: null on the server and in the first client render; set after hydration, only for a form with a
    // `min: "today"` field.
    const [today, setToday] = useState<string | null>(null);
    useEffect(() => {
        if (fields.some((f) => f.type === "date" && f.min === "today")) setToday(localToday());
    }, [fields]);

    function updateValue(fieldId: string, value: any) {
        setValues(prev => ({ ...prev, [fieldId]: value }));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setSubmitting(true);

        // Build data keyed by field label
        const data: Record<string, any> = {};
        for (const field of fields) {
            data[field.label] = values[field.id] ?? (field.type === "checkbox" ? false : "");
        }

        // Find email field for submitterEmail
        const emailField = fields.find(f => f.type === "email");
        const submitterEmail = emailField ? values[emailField.id] : undefined;

        // Get reCAPTCHA token (null if not configured)
        const token = await recaptchaToken("form_submit");

        try {
            const res = await fetch(`${apiUrl}/public/forms/${encodeURIComponent(formSlug)}/submit`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
                body: JSON.stringify({ data, submitterEmail, recaptchaToken: token }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || strings.formSubmissionFailed);
            }

            setSubmitted(true);
        } catch (err: any) {
            setError(err.message || strings.formErrorShort);
        } finally {
            setSubmitting(false);
        }
    }

    /** STAY-1A: the `min` hint of a date field: the latest of its own today and the day after the earlier field's value. */
    function dateMin(field: FormField): string | undefined {
        let min: string | undefined = field.min === "today" && today !== null ? today : undefined;
        const earlierValue = dateOrder && field.id === dateOrder.later ? values[dateOrder.earlier] : undefined;
        if (typeof earlierValue === "string" && DATE_TEXT.test(earlierValue)) {
            const after = dayAfter(earlierValue);
            if (after !== null && (min === undefined || after > min)) min = after;
        }
        return min;
    }

    /** The control of one field, by type. Every type is a case; a new type fails the `never` check. */
    function control(field: FormField, controlId: string) {
        switch (field.type) {
            case "textarea":
                return (
                    <textarea
                        id={controlId}
                        value={values[field.id] || ""}
                        onChange={e => updateValue(field.id, e.target.value)}
                        placeholder={field.placeholder}
                        required={field.required}
                        rows={4}
                        className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y"
                    />
                );
            case "select":
                return (
                    <select
                        id={controlId}
                        value={values[field.id] || ""}
                        onChange={e => updateValue(field.id, e.target.value)}
                        required={field.required}
                        className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    >
                        <option value="">{field.placeholder || strings.formSelectPlaceholder}</option>
                        {(field.options || []).map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                );
            case "checkbox":
                return (
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={!!values[field.id]}
                            onChange={e => updateValue(field.id, e.target.checked)}
                            required={field.required}
                            className="h-4 w-4 rounded border"
                        />
                        {/* One flex item: the mark sits after the text as in the other labels, not a flex gap away. */}
                        <span>
                            {field.placeholder || field.label}
                            {field.required && <span className="text-destructive ml-1">*</span>}
                        </span>
                    </label>
                );
            case "text":
            case "email":
            case "phone":
            case "number":
                return (
                    <input
                        id={controlId}
                        type={field.type === "phone" ? "tel" : field.type}
                        value={values[field.id] || ""}
                        onChange={e => updateValue(field.id, e.target.value)}
                        placeholder={field.placeholder}
                        required={field.required}
                        className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                );
            case "date":
                return (
                    <input
                        id={controlId}
                        type="date"
                        value={values[field.id] || ""}
                        onChange={e => updateValue(field.id, e.target.value)}
                        required={field.required}
                        min={dateMin(field)}
                        className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                );
            default: {
                const unhandled: never = field.type;
                return unhandled;
            }
        }
    }

    if (submitted) {
        return (
            <div className="text-center py-8 space-y-3">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
                <p className="text-lg font-medium">{successMessage}</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {fields.map(field => {
                const controlId = `${idPrefix}-${field.id}`;
                return (
                <div key={field.id}>
                    {/* SMALL-FIXES-1 C: no label line above a checkbox — its wrapping label below is its one text. */}
                    {field.type !== "checkbox" && (
                        <label htmlFor={controlId} className="text-sm font-medium block mb-1">
                            {field.label}
                            {field.required && <span className="text-destructive ml-1">*</span>}
                        </label>
                    )}

                    {control(field, controlId)}
                </div>
                );
            })}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-primary-foreground py-3 rounded-md font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? strings.formSubmitting : submitButtonText}
            </button>
        </form>
    );
}
