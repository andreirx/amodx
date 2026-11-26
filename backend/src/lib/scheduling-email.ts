/**
 * SCHED-1D1 (docs/slices/sched-1.md § 11.1) — the six scheduling mails: keys, English defaults, the tenant
 * override rule, rendering. PROTOTYPE.
 *
 * Pattern of `order-email.ts` (F6): `{ subject, body, sendTo… }` templates with `{{variable}}` placeholders, tenant
 * overrides in `TenantConfig.schedulingEmailConfig.templates`, defaults here in the backend. The defaults are served
 * to the admin by GET /scheduling/admin/email-templates, so the admin screen holds no second copy.
 * `renderTemplate` is imported from `order-email.ts`: the function is generic; the module name is narrower than this
 * use (recorded in § 11.1, no rename).
 *
 * Abstraction line (§ 19): users — the twelve mailing functions (this slice: the admin booking cancel) and the
 * templates route; axis — a second template record with its own six keys; rejected — keys added to
 * `getDefaultTemplates()` (the order mail page would list them).
 *
 * Limit (§ 11.1): English text, one template per key per tenant (trigger: `lang-1a`).
 */
import {
    SchedulingEmailConfigSchema, SchedulingEmailKeySchema, instantToLocal,
    type Booking, type SchedulingEmailConfig, type SchedulingEmailKey, type SchedulingEmailTemplate,
} from "@amodx/shared";
import { renderTemplate } from "./order-email.js";

/**
 * SCHED-APPT-FIXES-1 R1–R4: replies to a customer copy go to the business; replies to a booking's owner copy
 * go to that customer. A weekly planner mail has no single customer. `undefined` means omit the header.
 * Users: visitor mail, admin cancellation, reminder/weekly job. Axis: customer copy / owner copy / weekly planner;
 * rejected: the same recipient rule repeated in three send sites. Pure; addresses are already parsed by callers.
 */
export function schedulingReplyTo(
    kind: "customer" | "owner" | "weekAhead",
    tenant: { contactEmail?: string },
    customerEmail: string | undefined,
): string[] | undefined {
    switch (kind) {
        case "customer": return tenant.contactEmail === undefined ? undefined : [tenant.contactEmail];
        case "owner": return customerEmail === undefined ? undefined : [customerEmail];
        case "weekAhead": return undefined;
    }
    const unhandled: never = kind;
    throw new Error(`Unhandled mail copy ${String(unhandled)}`);
}

/** § 10.3 `EmailTemplate`: a template with both recipient flags resolved. */
export type EmailTemplate = { subject: string; body: string; sendToCustomer: boolean; sendToAdmin: boolean };

/** The six keys of § 11.1, in the order of the specification's table. */
export const SCHEDULING_EMAIL_KEYS: readonly SchedulingEmailKey[] = SchedulingEmailKeySchema.options;

/**
 * The English defaults (§ 11.1 "To" column):
 * - `hold`, `moved`, `reminder`: the customer only.
 * - `confirmed`: the customer and an owner copy (`integrations.contactEmail`).
 * - `cancelled`: the customer; the owner copy is sent on a CUSTOMER cancel only (the sender decides by the actor:
 *   an admin cancel sends no owner copy, whatever this flag says).
 * - `weekAhead`: the admin address only. `sendToCustomer` is never read for this key (there is no customer);
 *   `sendToAdmin: false` in a tenant override turns the mail off.
 * SCHED-GROUPS-REMOVE-1: the texts lost the two group variables, which always rendered as "" in an appointment mail;
 * the confirmed body keeps the blank line the second one left, so every default renders exactly as before.
 */
export function defaultSchedulingTemplates(): Record<SchedulingEmailKey, EmailTemplate> {
    return {
        hold: {
            subject: "Please confirm your booking {{ref}}",
            body: "Hello {{customerName}},\n\nWe are holding your booking {{ref}}: {{serviceName}}, {{when}}.\n\n" +
                "Please confirm it by opening this link before {{expiresAt}}:\n{{link}}\n\n" +
                "If you did not ask for this booking, ignore this email. The booking expires if it is not confirmed.\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: false,
        },
        confirmed: {
            subject: "Booking {{ref}} confirmed",
            body: "Hello {{customerName}},\n\nYour booking {{ref}} is confirmed: {{serviceName}}, {{when}}.\n\n\n" +
                "To see, move or cancel your booking, open this link:\n{{link}}\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: true,
        },
        cancelled: {
            subject: "Booking {{ref}} cancelled",
            body: "Hello {{customerName}},\n\nYour booking {{ref}} ({{serviceName}}, {{when}}) is cancelled.\n\n" +
                "If you have questions, please contact us.\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: true,
        },
        moved: {
            subject: "Booking {{ref}} moved",
            body: "Hello {{customerName}},\n\nYour booking {{ref}} has moved. It is now: {{serviceName}}, {{when}}.\n\n" +
                "To see, move or cancel your booking, open this link:\n{{link}}\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: false,
        },
        reminder: {
            subject: "Reminder: booking {{ref}}, {{when}}",
            body: "Hello {{customerName}},\n\nThis is a reminder of your booking {{ref}}: {{serviceName}}, {{when}}.\n\n" +
                "To see, move or cancel your booking, open this link:\n{{link}}\n\n{{siteName}}",
            sendToCustomer: true,
            sendToAdmin: false,
        },
        weekAhead: {
            // § 11.4 (corrected by SCHED-1G1, operator ruling SCHED-1G1-WEEKMAIL-DEFAULT = A): the subject of § 11.4; a
            // sentence that every week is open from the weekly defaults and can be changed in the planner; the summary;
            // the planner link.
            subject: "Your week from {{weekStart}}: hours and bookings",
            body: "Hello,\n\nEvery week is open for booking from your weekly hours. You can change the hours of any day, " +
                "or turn a day off, in the planner.\n\nThe week {{weekStart}} to {{weekEnd}}:\n\n{{summary}}\n\n" +
                "Open the planner:\n{{plannerLink}}\n\n{{siteName}}",
            sendToCustomer: false,
            sendToAdmin: true,
        },
    };
}

/**
 * Stored tenant data of the removed group shape (SCHED-GROUPS-REMOVE-1; code on branch
 * `archive/group-scheduling-2026-11`). A tenant may have saved it before the removal. Rule: it keeps exactly the meaning
 * it had before for every remaining mail and route, on read and on write-back:
 * - the mail key `unplaced` (the group mail): dropped wherever a stored `schedulingEmailConfig` is checked — on read
 *   (`storedOverrides`, every scheduling route) and on write-back (PUT /settings, `backend/src/tenant/settings.ts`: the
 *   General Settings page sends the loaded config back). Without this, the key fails `SchedulingEmailConfigSchema`
 *   (unknown key): every scheduling route of that tenant would answer 500 and its settings could not be saved. Any
 *   other unknown key is still refused;
 * - the variables `courseName` and `groupLink`: a stored override may name them (they were in the defaults). Before the
 *   removal every booking mail rendered them as "" and the weekly mail (`weekAhead`) did not know them (they stayed as
 *   written); `renderSchedulingMail` keeps both (`hadRetiredVariables`).
 */
const RETIRED_TEMPLATE_KEYS: readonly string[] = ["unplaced"];
const RETIRED_VARIABLES: Readonly<Record<string, string>> = { courseName: "", groupLink: "" };

/**
 * The tenant's overrides as stored on `TenantConfig.schedulingEmailConfig`. Absent → `{}`. A stored value that fails
 * the schema → `null` (the caller answers 500 `storedDataInvalid`, § 10.2: never read as "no override"). A stored
 * override of a retired key is dropped before the check (`RETIRED_TEMPLATE_KEYS`).
 */
export function storedOverrides(schedulingEmailConfig: unknown): SchedulingEmailConfig["templates"] | null {
    if (schedulingEmailConfig === undefined) return {};
    const parsed = SchedulingEmailConfigSchema.safeParse(withoutRetiredTemplateKeys(schedulingEmailConfig));
    return parsed.success ? parsed.data.templates : null;
}

/**
 * A copy of a `schedulingEmailConfig` value without the retired template keys (`RETIRED_TEMPLATE_KEYS`); any other
 * value (not an object, no `templates` object) is returned as it is, for the schema to judge. Users: `storedOverrides`
 * (read) and PUT /settings (write-back).
 */
export function withoutRetiredTemplateKeys(stored: unknown): unknown {
    if (stored === null || typeof stored !== "object") return stored;
    const templates = (stored as { templates?: unknown }).templates;
    if (templates === null || typeof templates !== "object" || Array.isArray(templates)) return stored;
    const kept = Object.fromEntries(Object.entries(templates).filter(([k]) => !RETIRED_TEMPLATE_KEYS.includes(k)));
    return { ...stored, templates: kept };
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
 * `{{when}}` (§ 11.1): local date and time of the slot's start in `tenantTimezone` (absent → UTC), with the zone name.
 * Moved here from `scheduling/admin/bookings-cancel.ts` by SCHED-1G1 (third user: the reminder job).
 */
export function whenText(b: Booking, tenantTimezone: string | undefined): string {
    const zone = tenantTimezone ?? "UTC";
    const local = instantToLocal(b.what.start, zone);
    return `${local.date} ${local.time} (${zone})`;
}

/** True for the mails whose senders passed the two retired variables (as "") before SCHED-GROUPS-REMOVE-1. */
function hadRetiredVariables(key: SchedulingEmailKey): boolean {
    switch (key) {
        case "hold":
        case "confirmed":
        case "cancelled":
        case "moved":
        case "reminder": return true;
        case "weekAhead": return false;
        default: {
            const never: never = key;
            throw new Error(`Unhandled mail ${String(never)}`);
        }
    }
}

/**
 * Subject and body of the mail `key` with every `{{variable}}` replaced; a placeholder with no value is left as
 * written. Variables (§ 11.1): `ref`, `customerName`, `serviceName`, `when`, `expiresAt`, `link`, `siteName`;
 * `weekAhead` only: `weekStart`, `weekEnd`, `summary`, `plannerLink`. A sender passes "" for a variable that does not
 * apply (`link` in a mail without a link). The retired variables (`RETIRED_VARIABLES`) render as "" in a booking mail
 * only, as before the removal.
 */
export function renderSchedulingMail(key: SchedulingEmailKey, template: EmailTemplate, vars: Record<string, string>)
    : { subject: string; body: string } {
    const all = hadRetiredVariables(key) ? { ...RETIRED_VARIABLES, ...vars } : vars;
    return { subject: renderTemplate(template.subject, all), body: renderTemplate(template.body, all) };
}
