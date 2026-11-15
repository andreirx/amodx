"use client";
import React from "react";
import { DynamicForm, type DynamicFormStrings, type FormField } from "./DynamicForm";

/**
 * SHOP-LOOK-1E (record docs/slices/shop-look-1e.md) — the `form` block: one custom form of the tenant, chosen by its
 * slug (`formSlug`).
 *
 * Data. The renderer's server pass (`prepareBlocks` in `renderer/src/components/SitePage.tsx`) reads the form with
 * `getFormBySlug` (active forms only) and gives `attrs._form`, built field by field: `{ slug, name, fields,
 * submitButtonText, successMessage, strings }` — `fields` are the stored fields that are fields, one per label (the
 * submit handler's rule); `strings` are the four form texts of the tenant's locale table. No `_form` (no slug, a slug of
 * no form, a disabled form, or no server pass: the admin preview) → the block draws nothing.
 *
 * Submit. The browser posts to the API (`NEXT_PUBLIC_API_URL`, as the showcase's fallback fetch reads it) at
 * `/public/forms/<slug>/submit` with `x-tenant-id` = the page's tenant (`tenantId`, given by RenderBlocks); the handler
 * checks the origin and reCAPTCHA (`DynamicForm` reads the page's reCAPTCHA key as the contact block does).
 *
 * Options. `eyebrow`, `headline`, `text` above the form, each only when not blank; `card` (exactly `true`) puts the form
 * in a bordered card (reference section 9). Theme classes only.
 */

interface PreparedForm {
    slug: string;
    name: string;
    fields: FormField[];
    submitButtonText: string;
    successMessage: string;
    strings: DynamicFormStrings;
}

/** A non-blank string, trimmed; anything else → null (blank = absent). */
function textOf(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The server pass's `_form`, or null when it is absent or not of that shape. */
function preparedForm(value: unknown): PreparedForm | null {
    if (typeof value !== "object" || value === null) return null;
    const f = value as Record<string, unknown>;
    if (typeof f.slug !== "string" || !Array.isArray(f.fields) || typeof f.strings !== "object" || f.strings === null) return null;
    return f as unknown as PreparedForm;
}

export function FormRender({ attrs, tenantId }: { attrs: any; tenantId?: string }) {
    const form = preparedForm(attrs._form);
    if (!form) return null;

    const eyebrow = textOf(attrs.eyebrow);
    const headline = textOf(attrs.headline);
    const text = textOf(attrs.text);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

    const formElement = (
        <DynamicForm
            formSlug={form.slug}
            formName={form.name}
            fields={form.fields}
            submitButtonText={form.submitButtonText}
            successMessage={form.successMessage}
            tenantId={tenantId ?? ""}
            apiUrl={apiUrl}
            strings={form.strings}
        />
    );

    return (
        <section className="my-12">
            {(eyebrow !== null || headline !== null || text !== null) && (
                <div className="text-center mb-8">
                    {eyebrow !== null && (
                        <p className="mx-auto w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">{eyebrow}</p>
                    )}
                    {headline !== null && <h2 className="text-2xl md:text-3xl font-bold mb-2">{headline}</h2>}
                    {text !== null && <p className="text-muted-foreground">{text}</p>}
                </div>
            )}
            <div className={attrs.card === true ? "max-w-lg mx-auto rounded-xl border border-border bg-background p-6 md:p-8 shadow-sm" : "max-w-lg mx-auto"}>
                {formElement}
            </div>
        </section>
    );
}
