"use client";

import { useId, useState } from "react";
import { Loader2, CheckCircle } from "lucide-react";
import type { LocaleStrings } from "@amodx/shared";

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
 */

export interface FormField {
    id: string;
    label: string;
    type: "text" | "email" | "phone" | "textarea" | "select" | "checkbox" | "number";
    required: boolean;
    placeholder?: string;
    options?: string[];
}

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
export function DynamicForm({ formSlug, fields, submitButtonText, successMessage, tenantId, apiUrl, strings }: DynamicFormProps) {
    const [values, setValues] = useState<Record<string, any>>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState("");
    const idPrefix = useId();

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

                    {field.type === "textarea" ? (
                        <textarea
                            id={controlId}
                            value={values[field.id] || ""}
                            onChange={e => updateValue(field.id, e.target.value)}
                            placeholder={field.placeholder}
                            required={field.required}
                            rows={4}
                            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y"
                        />
                    ) : field.type === "select" ? (
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
                    ) : field.type === "checkbox" ? (
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
                    ) : (
                        <input
                            id={controlId}
                            type={field.type === "phone" ? "tel" : field.type}
                            value={values[field.id] || ""}
                            onChange={e => updateValue(field.id, e.target.value)}
                            placeholder={field.placeholder}
                            required={field.required}
                            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        />
                    )}
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
