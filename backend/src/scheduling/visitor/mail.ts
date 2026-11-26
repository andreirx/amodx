/**
 * SCHED-1D2 — the mails of the visitor actions (docs/slices/sched-1.md § 11.1): `hold` (hold, replay recovery, resend),
 * `confirmed` (confirm), `cancelled` (customer cancel), `moved` (customer move). Templates, defaults and rendering are
 * `lib/scheduling-email.ts` (`sched-1d1`); `{{when}}` is the admin cancel's `whenText` (one rule for every mail).
 *
 * Recipients:
 * - the customer: when the template's `sendToCustomer` is on — except `hold`, which is always sent: it carries the
 *   only way to confirm (§ 11.1), so a switch could only make every hold of the tenant unconfirmable;
 * - an owner copy to `integrations.contactEmail` when the template's `sendToAdmin` is on (defaults: `confirmed` and
 *   `cancelled`, § 11.1). The owner copy NEVER carries the link: a link token gives control of the booking (§ 8.1);
 *   the owner manages bookings in the admin.
 * Link: `<bookingBase>/_booking/manage#t=<token>` (§ 8.2), only when the caller minted a token for this mail (§ 8.4).
 * Logs carry the booking id and the error name only.
 *
 * Abstraction line: `sendVisitorMail` — users: hold, confirm, cancel, move; axis: none (one recipient and variable
 * rule for the four visitor mails); rejected: four copies of the render-and-send block.
 */
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { bookingBase, instantToLocal, type Booking, type Instant } from "@amodx/shared";
import { formatFromHeader } from "../../lib/email-from.js";
import { renderSchedulingMail, resolveTemplate, schedulingReplyTo } from "../../lib/scheduling-email.js";
import { whenText } from "../admin/bookings-cancel.js";
import type { SchedulingTenant } from "../common.js";
import type { VisitorSettings } from "./common.js";

const ses = new SESClient({});

export type VisitorMailKey = "hold" | "confirmed" | "cancelled" | "moved";

/** "YYYY-MM-DD HH:MM (zone)": the local time in `zone`, as `{{when}}` writes it. */
function localText(at: Instant, zone: string): string {
    const local = instantToLocal(at, zone);
    return `${local.date} ${local.time} (${zone})`;
}

function customerCopy(key: VisitorMailKey, sendToCustomer: boolean): boolean {
    switch (key) {
        case "hold": return true;
        case "confirmed":
        case "cancelled":
        case "moved": return sendToCustomer;
        default: {
            const never: never = key;
            throw new Error(`Unhandled mail ${String(never)}`);
        }
    }
}

/**
 * Render and send one visitor mail. Returns the CUSTOMER copy's outcome: `sent`, `failed` (no sender configured, no
 * link base for a link, or SES refused), or `off` (the template turned the customer copy off). An owner-copy failure is
 * logged and does not change the outcome. Never throws for a send failure.
 */
export async function sendVisitorMail(input: {
    key: VisitorMailKey; tenantId: string; tenant: SchedulingTenant; settings: VisitorSettings;
    booking: Booking; token: string | null;
}): Promise<"sent" | "failed" | "off"> {
    const { key, tenantId, tenant, settings, booking: b, token } = input;
    const template = resolveTemplate(key, tenant.templates);
    const from = process.env.SES_FROM_EMAIL ?? "";
    const origin = process.env.RENDERER_CLOUDFRONT_ORIGIN ?? "";
    const vars = (link: string) => ({
        ref: b.ref,
        customerName: b.who.name,
        serviceName: b.what.serviceName,
        when: whenText(b, settings.timezone),
        expiresAt: b.state.kind === "held" ? localText(b.state.expiresAt, settings.timezone) : "",
        link,
        siteName: tenant.name ?? "",
    });
    const send = async (kind: "customer" | "owner", to: string, link: string) => {
        const mail = renderSchedulingMail(key, template, vars(link));
        const replyTo = schedulingReplyTo(kind, tenant, b.who.email);
        await ses.send(new SendEmailCommand({
            Source: formatFromHeader(tenant.name, from),
            ...(replyTo === undefined ? {} : { ReplyToAddresses: replyTo }),
            Destination: { ToAddresses: [to] },
            Message: { Subject: { Data: mail.subject }, Body: { Text: { Data: mail.body } } },
        }));
    };

    let outcome: "sent" | "failed" | "off" = "off";
    if (customerCopy(key, template.sendToCustomer)) {
        if (!from || (token !== null && !origin)) {
            console.error(`[scheduling] ${key} mail not sent: sender or link base not configured`, b.id);
            outcome = "failed";
        } else {
            const link = token === null ? "" : `${bookingBase({ id: tenantId, domain: tenant.domain }, origin)}/_booking/manage#t=${token}`;
            try {
                await send("customer", b.who.email, link);
                outcome = "sent";
            } catch (e) {
                console.error(`[scheduling] ${key} mail failed`, b.id, e instanceof Error ? e.name : "unknown");
                outcome = "failed";
            }
        }
    }
    if (template.sendToAdmin && tenant.contactEmail !== undefined && from) {
        try {
            await send("owner", tenant.contactEmail, "");
        } catch (e) {
            console.error(`[scheduling] ${key} owner copy failed`, b.id, e instanceof Error ? e.name : "unknown");
        }
    }
    return outcome;
}
