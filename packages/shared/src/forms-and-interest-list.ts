// Forms (fields, definitions, submissions) and the interest list (the system form and its public API bodies).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";
import { normalizeEmail } from "./normalizeEmail.js";
import { FormDateOrderSchema } from "./form-date.js";

// --- FORMS ---

// STAY-1A (docs/slices/stay-1.md § 2): the field types are a closed set. Every `switch` over `type` ends in a `never`
// check, so a new type is a compile error at each site that must decide what it does (Build record: the site list).
export const FormFieldSchema = z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(["text", "email", "phone", "textarea", "select", "checkbox", "number", "date"]),
    required: z.boolean().default(false),
    placeholder: z.string().optional(),
    options: z.array(z.string()).optional(), // for select type
    // STAY-1A: for date type. "today" = a date before the site's today is refused (`earliestFormDate`). Absent = no limit.
    min: z.literal("today").optional(),
});
export type FormField = z.infer<typeof FormFieldSchema>;
export type FormFieldType = FormField["type"];

/**
 * The stored form's entries that are fields (`FormFieldSchema`), one per label: labels are the submission's keys, so
 * the FIRST field of a label defines it and a later field of the same label is not part of the submission (finding
 * F-1E-DUPLICATE-LABEL). An entry that is not a field is skipped. One rule for the submit handler (which fields it
 * reads), the renderer (which fields the page shows) and the save handlers (which fields a pair rule may name).
 */
export function formFieldsOf(stored: unknown): FormField[] {
    const seen = new Set<string>();
    const out: FormField[] = [];
    for (const entry of Array.isArray(stored) ? stored : []) {
        const parsed = FormFieldSchema.safeParse(entry);
        if (!parsed.success || seen.has(parsed.data.label)) continue;
        seen.add(parsed.data.label);
        out.push(parsed.data);
    }
    return out;
}

export const FormDefinitionSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    name: z.string().min(1),
    slug: z.string().min(1),
    fields: z.array(FormFieldSchema).default([]),
    // STAY-1A: optional pair rule "the date of field `later` is later than the date of field `earlier`".
    dateOrder: FormDateOrderSchema.optional(),
    submitButtonText: z.string().default("Submit"),
    successMessage: z.string().default("Thank you! Your submission has been received."),
    notifyEmail: z.string().optional(),    // email to notify on submission
    status: z.enum(["active", "disabled"]).default("active"),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;

export const FormSubmissionSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    formId: z.string(),
    formName: z.string(),
    data: z.record(z.string(), z.any()),  // field label → value
    submitterEmail: z.string().optional(),
    status: z.enum(["new", "read", "archived"]).default("new"),
    createdAt: z.string(),
});
export type FormSubmission = z.infer<typeof FormSubmissionSchema>;

// --- INTEREST LIST (CAT-INTEREST-1; spec docs/slices/catalog-mode-1.md § 3.5) ---

/**
 * The reserved id of the per-tenant system form that holds interest-list submissions
 * (`SK FORM#interest-list`, records `FORMSUB#interest-list#<submissionId>`). User forms get a random UUID
 * (`backend/src/forms/create.ts`), so no user form can take it. The forms update/delete routes refuse it (409)
 * and the forms list omits it.
 */
export const INTEREST_FORM_ID = "interest-list";

/**
 * The `POST /public/interest` body, shared by the renderer (builds it) and the backend (validates it).
 * Strict at both levels: an unknown key — including a client `title`, `slug` or `imageLink` on an item — is
 * refused; the server records those itself from the product it reads. The email is normalized first and the
 * normalized form is validated (normalizeEmail.ts, "ORDERING RULE FOR VALIDATION"). `recaptchaToken` is
 * required as a key; its value is `null` when the page has no reCAPTCHA key (as `DynamicForm` sends it) —
 * whether a token is needed is decided by the handler's reCAPTCHA step, not by this schema.
 */
export const InterestSubmissionSchema = z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().transform(normalizeEmail).pipe(z.email().max(254)),
    phone: z.string().max(40).optional(),
    message: z.string().max(2000).optional(),
    items: z.array(z.object({
        productId: z.string().min(1).max(64),
        optionValue: z.string().max(200).optional(),
    }).strict()).min(1).max(50),
    submissionToken: z.uuidv4(),
    recaptchaToken: z.string().nullable(),
}).strict();
/** The body as the browser sends it (before the email normalization). */
export type InterestSubmissionPayload = z.input<typeof InterestSubmissionSchema>;

/** One (product, chosen option) pair of an interest list — the item identity. */
export interface InterestPair { productId: string; optionValue?: string }

/** Why the server did not record a listed item (spec § 3.5 item validation). */
export type InterestDropReason = "unknown" | "not-available" | "option-not-found";

/**
 * The `POST /public/interest` answer. `recorded` lists the pairs the stored record holds — what the visitor's list
 * became — so a client can tell what was not recorded in both cases:
 *  - "recorded" (201): this request wrote the record; `dropped` says why each other item was left out;
 *  - "already-recorded" (200): a record for this list's token already exists (a resend); nothing was written or
 *    mailed, no catalogue check ran, and `recorded` is read from the stored record.
 */
export type InterestSubmitResult =
    | { outcome: "recorded"; submissionId: string; recorded: InterestPair[]; dropped: (InterestPair & { reason: InterestDropReason })[] }
    | { outcome: "already-recorded"; submissionId: string; recorded: InterestPair[] };

/**
 * The `POST /public/interest/resolve` body (CAT-INTEREST-1 § 8, F3): the stored shortlist ids to resolve against the
 * catalogue BY ID (a slug is not identity, C8-3). Strict; at most the shortlist cap.
 */
export const InterestResolveRequestSchema = z.object({
    productIds: z.array(z.string().min(1).max(64)).min(1).max(50),
}).strict();
export type InterestResolveRequest = z.input<typeof InterestResolveRequestSchema>;

/**
 * One id resolved against the catalogue, from a complete read:
 *  - "active": the product as the visitor can mark it now (`collection` = the value of its attribute keyed by its
 *    `importLabels.collection`, or by the pre-cdl-1 word when it has no valid marker, when present;
 *    `optionValues` = its variant options, to tell whether a saved option still exists);
 *  - "not-available": the product exists but is not active — no fields, so a draft leaks nothing;
 *  - "absent": no product has this id (an expired shortlist item; reselect, never rebind by slug).
 * A schema, not only a type (review-1 F9): the answer reaches the browser over the network, so the renderer parses it
 * with THIS schema before using it — the type is derived from the same definition, so the two cannot drift.
 */
export const InterestResolutionSchema = z.discriminatedUnion("status", [
    z.object({
        productId: z.string(), status: z.literal("active"), title: z.string(), slug: z.string(),
        imageLink: z.string().optional(), collection: z.string().optional(), optionValues: z.array(z.string()),
    }),
    z.object({ productId: z.string(), status: z.literal("not-available") }),
    z.object({ productId: z.string(), status: z.literal("absent") }),
]);
export type InterestResolution = z.infer<typeof InterestResolutionSchema>;
export const InterestResolveResponseSchema = z.object({ products: z.array(InterestResolutionSchema) });
export type InterestResolveResponse = z.infer<typeof InterestResolveResponseSchema>;
