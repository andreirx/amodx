"use client";

import { useState } from "react";
import { Loader2, CheckCircle } from "lucide-react";

interface FormField {
    id: string;
    label: string;
    type: "text" | "email" | "phone" | "textarea" | "select" | "checkbox" | "number";
    required: boolean;
    placeholder?: string;
    options?: string[];
}

interface DynamicFormProps {
    formSlug: string;
    formName: string;
    fields: FormField[];
    submitButtonText: string;
    successMessage: string;
    tenantId: string;
    apiUrl: string;
}

export function DynamicForm({ formSlug, formName, fields, submitButtonText, successMessage, tenantId, apiUrl }: DynamicFormProps) {
    const [values, setValues] = useState<Record<string, any>>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState("");

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

        try {
            const res = await fetch(`${apiUrl}/public/forms/${formSlug}/submit`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
                body: JSON.stringify({ data, submitterEmail }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || "Submission failed");
            }

            setSubmitted(true);
        } catch (err: any) {
            setError(err.message || "Something went wrong");
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
            {fields.map(field => (
                <div key={field.id}>
                    <label className="text-sm font-medium block mb-1">
                        {field.label}
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                    </label>

                    {field.type === "textarea" ? (
                        <textarea
                            value={values[field.id] || ""}
                            onChange={e => updateValue(field.id, e.target.value)}
                            placeholder={field.placeholder}
                            required={field.required}
                            rows={4}
                            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y"
                        />
                    ) : field.type === "select" ? (
                        <select
                            value={values[field.id] || ""}
                            onChange={e => updateValue(field.id, e.target.value)}
                            required={field.required}
                            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        >
                            <option value="">{field.placeholder || "Select..."}</option>
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
                            {field.placeholder || field.label}
                        </label>
                    ) : (
                        <input
                            type={field.type === "phone" ? "tel" : field.type}
                            value={values[field.id] || ""}
                            onChange={e => updateValue(field.id, e.target.value)}
                            placeholder={field.placeholder}
                            required={field.required}
                            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        />
                    )}
                </div>
            ))}

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-primary-foreground py-3 rounded-md font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? "Submitting..." : submitButtonText}
            </button>
        </form>
    );
}
