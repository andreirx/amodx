/**
 * SCHED-1D1 (docs/slices/sched-1.md § 11.1) — the seven scheduling mails: keys, English defaults, the tenant
 * override rule, rendering. PROTOTYPE.
 *
 * Pattern of `order-email.ts` (F6): `{ subject, body, sendTo… }` templates with `{{variable}}` placeholders, tenant
 * overrides in `TenantConfig.schedulingEmailConfig.templates`, defaults here in the backend. The defaults are served
 * to the admin by GET /scheduling/admin/email-templates, so the admin screen holds no second copy.
 * `renderTemplate` is imported from `order-email.ts`: the function is generic; the module name is narrower than this
 * use (recorded in § 11.1, no rename).
 *
 * Abstraction line (§ 19): users — the twelve mailing functions (this slice: the admin booking cancel) and the
 * templates route; axis — a second template record with its own seven keys; rejected — keys added to
 * `getDefaultTemplates()` (the order mail page would list them).
 *
 * Limit (§ 11.1): English text, one template per key per tenant (trigger: `lang-1a`).
 */
import {
    SchedulingEmailConfigSchema, SchedulingEmailKeySchema,
    type SchedulingEmailConfig, type SchedulingEmailKey, type SchedulingEmailTemplate,
} from "@amodx/shared";
import { renderTemplate } from "./order-email.js";

/** § 10.3 `EmailTemplate`: a template with both recipient flags resolved. */
export type EmailTemplate = { subject: string; body: string; sendToCustomer: boolean; sendToAdmin: boolean };

/** The seven keys of § 11.1, in the order of the specification's table. */
export const SCHEDULING_EMAIL_KEYS: readonly SchedulingEmailKey[] = SchedulingEmailKeySchema.options;

/**
 * The English defaults (§ 11.1 "To" column):
 * - `hold`, `moved`, `unplaced`, `reminder`: the customer only.
 * - `confirmed`: the customer and an owner copy (`integrations.contactEmail`).
 * - `cancelled`: the customer; the owner copy is sent on a CUSTOMER cancel only (the sender decides by the actor:
 *   an admin cancel sends no owner copy, whatever this flag says).
 * - `weekAhead`: the admin address only. `sendToCustomer` is never read for this key (there is no customer);
 *   `sendToAdmin: false` in a tenant override turns the mail off.
 */
export function defaultSchedulingTemplates(): Record<SchedulingEmailKey, EmailTemplate> {
    return {
        hold: {
            subject: "Please confirm your booking {{ref}}",
            body: "Hello {{customerName}},\n\nWe are holding your booking {{ref}}: {{serviceName}}{{courseName}}, {{when}}.\n\n" +
                "Please confirm it by opening this link before {{expiresAt}}:\n{{link}}\n\n" +
                "If you did not ask for this booking, ignore this email. The booking expires if it is not confirmed.\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: false,
        },
        confirmed: {
            subject: "Booking {{ref}} confirmed",
            body: "Hello {{customerName}},\n\nYour booking {{ref}} is confirmed: {{serviceName}}{{courseName}}, {{when}}.\n{{groupLink}}\n\n" +
                "To see, move or cancel your booking, open this link:\n{{link}}\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: true,
        },
        cancelled: {
            subject: "Booking {{ref}} cancelled",
            body: "Hello {{customerName}},\n\nYour booking {{ref}} ({{serviceName}}{{courseName}}, {{when}}) is cancelled.\n\n" +
                "If you have questions, please contact us.\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: true,
        },
        moved: {
            subject: "Booking {{ref}} moved",
            body: "Hello {{customerName}},\n\nYour booking {{ref}} has moved. It is now: {{serviceName}}{{courseName}}, {{when}}.\n\n" +
                "To see, move or cancel your booking, open this link:\n{{link}}\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: false,
        },
        unplaced: {
            subject: "Booking {{ref}}: please choose a new group",
            body: "Hello {{customerName}},\n\nYour booking {{ref}} for {{courseName}} has no group at the moment.\n\n" +
                "Open this link to see the groups you can join:\n{{link}}\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: false,
        },
        reminder: {
            subject: "Reminder: booking {{ref}}, {{when}}",
            body: "Hello {{customerName}},\n\nThis is a reminder of your booking {{ref}}: {{serviceName}}{{courseName}}, {{when}}.\n\n" +
                "To see, move or cancel your booking, open this link:\n{{link}}\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: false,
        },
        weekAhead: {
            subject: "Your week ahead: {{weekStart}} to {{weekEnd}}",
            body: "Hello,\n\nThis is the plan for the week {{weekStart}} to {{weekEnd}}:\n\n{{summary}}\n\n" +
                "You can change the hours of any day, or turn a day off, in the planner:\n{{plannerLink}}\n\n{{siteName}}",
            sendToCustomer: false,
            sendToAdmin: true,
        },
    };
}

/**
 * The tenant's overrides as stored on `TenantConfig.schedulingEmailConfig`. Absent → `{}`. A stored value that fails
 * the schema → `null` (the caller answers 500 `storedDataInvalid`, § 10.2: never read as "no override").
 */
export function storedOverrides(schedulingEmailConfig: unknown): SchedulingEmailConfig["templates"] | null {
    if (schedulingEmailConfig === undefined) return {};
    const parsed = SchedulingEmailConfigSchema.safeParse(schedulingEmailConfig);
    return parsed.success ? parsed.data.templates : null;
}

/** § 11.1: the tenant override of `key` replaces subject and body; an absent `sendTo…` flag keeps the default's. */
export function resolveTemplate(key: SchedulingEmailKey, overrides: Partial<Record<SchedulingEmailKey, SchedulingEmailTemplate>>): EmailTemplate {
    const base = defaultSchedulingTemplates()[key];
    const override = overrides[key];
    if (override === undefined) return base;
    return {
        subject: override.subject,
        body: override.body,
        sendToCustomer: override.sendToCustomer ?? base.sendToCustomer,
        sendToAdmin: override.sendToAdmin ?? base.sendToAdmin,
    };
}

/**
 * Subject and body with every `{{variable}}` replaced; a placeholder with no value is left as written. Variables
 * (§ 11.1): `ref`, `customerName`, `serviceName`, `courseName`, `when`, `expiresAt`, `link`, `groupLink`, `siteName`;
 * `weekAhead` only: `weekStart`, `weekEnd`, `summary`, `plannerLink`. A sender passes "" for a variable that does not
 * apply (`serviceName` for a seat, `courseName` for a slot, `link` in a mail without a link).
 */
export function renderSchedulingMail(template: EmailTemplate, vars: Record<string, string>): { subject: string; body: string } {
    return { subject: renderTemplate(template.subject, vars), body: renderTemplate(template.body, vars) };
}
