/**
 * SCHED-1G1 — the scheduled scheduling job (docs/slices/sched-1.md § 11.3, § 11.4, § 14.1). PROTOTYPE.
 *
 * One function, invoked by one EventBridge rule `rate(15 minutes)` (§ 11.3). Each run does, per tenant:
 * 1. the daily expired-hold cleanup (§ 14.1) — only on the run whose SCHEDULED time (the event's `time`) is in
 *    03:00-03:14 UTC, for EVERY tenant whatever `schedulingEnabled` (removing old holds is maintenance of stored
 *    customer data; row C29, tenant part);
 * 2. reminders (§ 11.3) — tenants with `schedulingEnabled === true` and `reminderHours > 0`;
 * 3. the Sunday planner mail (§ 11.4) — tenants with `schedulingEnabled === true` for which `weekMailDue` is `due`.
 * A switched-off tenant gets no reminder and no weekly mail; its cleanup still runs.
 *
 * Cadence (§ 11.3): the scheduled times are 15 minutes apart, so exactly one of them falls in any 15-minute window —
 * the cleanup window 03:00-03:14 UTC gets one run a day (a missed day is caught the next day: the query is "expired
 * more than 7 days ago"). The weekly mail is due from local Sunday 09:00 until local Monday 00:00 (at least 14 hours,
 * also on a clock-change Sunday), so every zone gets at least 56 due runs. A booking enters the reminder window at
 * `S − reminderHours`; the first run after that (within 15 minutes) selects it.
 *
 * How tenants are found (§ 6.3 AP12): one main-table Query `PK = SYSTEM, begins_with(SK, TENANT#)` — the read of the
 * GLOBAL_ADMIN tenant list (`backend/src/tenant/list.ts:14-21`) — with a projection, pages looped. No scan of either
 * table. The tenant id is the key suffix.
 *
 * Isolation: each job of each tenant runs in its own try/catch; a failure is logged with the tenant id and the error
 * NAME (never a message, an address or a name) and counted; the run goes on. A failure of the tenant Query fails the
 * run (nothing can run without it; the next run starts over). One line per run: `[scheduling] job summary {…}`,
 * counts only.
 *
 * Reminders (§ 11.3), per tenant, window `[now, now + reminderHours]`:
 * - per resource (AP10) `readIntervals` over the window (AP3 + `activeEntries`), confirmed entries (`x` absent) with
 *   `s` in the window → target `{ slot, start: s }`. Only slot bookings have `RESDAY#` entries, so a stored booking of
 *   the removed group shape (SCHED-GROUPS-REMOVE-1) is never selected;
 * - per target: `markReminder` (the stale guard: it commits only while the booking still starts at `S` — the slot's
 *   `what.start` — is confirmed and was not reminded for `S`) → `stale` = no mail; `mintToken` (a new token per mail,
 *   § 8.4; it returns the booking as saved) → no token = no mail; the mail is built FROM THAT BOOKING. One check after
 *   the mint (`samePlacement`): sent only when the saved booking still starts at `S`.
 *   Nothing is checked after that, and the send is not atomic with any later change.
 * - Limits (recorded):
 *   - a committed mark stays when a later step fails, so a mint or SES failure after the mark loses that reminder
 *     (§ 11.3: chosen over a duplicate every 15 minutes);
 *   - a token minted for a mail that is then not sent stays valid until the 20-token cap drops it (§ 8.4); no one
 *     holds it;
 * *   - a slot moved after the post-mint check and before SES accepts gets a reminder for the earlier start; its `moved`
 *     mail carries the new time.
 * - Two runs at once (an EventBridge retry, or a run longer than 15 minutes; nothing prevents it): reminders — the
 *   conditional mark lets exactly one of them commit per booking and start, so ONE mail (test "two runs at once" in
 *   scheduling-reminders.test.ts; the condition itself: scheduling-db.test.ts C35 (2)); cleanup — idempotent: the
 *   booking-rule transaction removes an item set once, the other finds it gone and skips (scheduling-db.test.ts C29
 *   "second run changes nothing"); weekly mail — NOT idempotent: both claims can return without `sentAt` and both send
 *   (the documented duplicate, row C34 "two at once"; test "two runs at once" here).
 * - The reminder is a customer mail: with the template's `sendToCustomer` off, nothing is marked or sent for the
 *   tenant. With `sendToAdmin` on, an owner copy WITHOUT the link goes to `integrations.contactEmail` (the rule of
 *   `visitor/mail.ts`: a link gives control of the booking).
 * - `{{when}}` = `whenText`: the slot's start in `scheduling.timezone`.
 *
 * Weekly planner mail (§ 11.4; SCHED-WEEKMAIL-DELIVERY = B), per due tenant, target week `W` = `weekStart`: the
 * `weekAhead` template with `sendToAdmin` off → none; no `contactEmail` → none and the log line
 * `[scheduling] weekly mail: no contactEmail <tenantId>`; resources (AP10) and one BatchGet of `AVAILABILITY#` +
 * `DAYS#` (`getResourcePlans`; § 6.3 reads `DAYS#` after the claim — the same items, read before it); no resource
 * with a non-empty `rules` list → none; `claimWeekMail` (AP14) → `sentAt` present → stop; per listed resource
 * `readIntervals` over the 7 local days, `planDay` per day; send; SES accepted → `markWeekMailSent`. SES refused or
 * failed → logged, no write; the next due run tries again. Guarantee: `sentAt` present = SES accepted at least one
 * copy. A duplicate is possible after an uncertain result (SES accepted, then the `sentAt` write did not happen); a
 * failure that lasts until local Monday 00:00 loses that week's mail. The mail carries counts only — no customer
 * name, email, phone or booking ref; no `BOOKING#` is read. `{{plannerLink}}` =
 * `<ADMIN_URL>/scheduling/planner?tenant=<id>&week=<W>` (§ 11.4, R03); `ADMIN_URL` unset → "" and one log line.
 *
 * Environment: `TABLE_NAME` (main table, read), `SCHEDULING_TABLE_NAME` (read-write), `SES_FROM_EMAIL`,
 * `RENDERER_CLOUDFRONT_ORIGIN` (the link base of a tenant without a domain, § 8.2), `ADMIN_URL` (§ 11.2).
 *
 * Abstraction lines:
 * - `runSchedulingJobs({ scheduledAt, now })` — users: `handler` and the tests; axis: the clock (injected; the
 *   handler passes the event's scheduled time and `Date.now()`); rejected: `Date.now()` read inside (the cleanup
 *   window and `weekMailDue` could not be tested at a chosen instant).
 * - `weekSummary` (pure) — users: the weekly mail and its tests; axis: none (the one `{{summary}}` text); rejected:
 *   the text built inside the sender.
 */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import {
    activeEntries, bookingBase, localDaySpan, planDay, weekMailDue,
    type Booking, type Instant, type LocalDate, type PlannedDay, type TimeZone,
} from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { formatFromHeader } from "../lib/email-from.js";
import {
    claimWeekMail, cleanupExpiredHolds, getResourcePlans, listResources, markReminder, markWeekMailSent,
    mintToken, readIntervals, schedulingStoreFromEnv,
    type ReminderTarget, type SchedulingStore,
} from "../lib/scheduling-db.js";
import { renderSchedulingMail, resolveTemplate, schedulingReplyTo, whenText } from "../lib/scheduling-email.js";
import { parseSchedulingTenant, type SchedulingTenant } from "./common.js";

const ses = new SESClient({});
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The counts of one run (the summary line). */
export type JobSummary = {
    scheduledAt: string; tenants: number; cleanupRun: boolean;
    cleanup: { tenants: number; removed: number; skipped: number; busy: number; failed: number };
    reminders: { tenants: number; sent: number; stale: number; notIssued: number; placementChanged: number; mailFailed: number; failed: number };
    weekMail: { due: number; sent: number; alreadySent: number; noContactEmail: number; off: number; noWeeklyHours: number; mailFailed: number; failed: number };
    settingsInvalid: number;
};

/** § 14.1: the run whose scheduled time is in 03:00-03:14 UTC is the day's cleanup run. */
export function isCleanupRun(scheduledAt: Instant): boolean {
    const d = new Date(scheduledAt);
    return d.getUTCHours() === 3 && d.getUTCMinutes() < 15;
}

/** `date` + `days` (calendar arithmetic on the date string; no time zone involved). */
function plusDays(date: LocalDate, days: number): LocalDate {
    return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function weekdayName(date: LocalDate): string {
    return WEEKDAYS[(new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * § 11.4 `{{summary}}` (pure): per resource (given in name order) one heading line, then per day
 * `Mon 2026-12-07: default, 09:00-12:00, 13:00-17:00, 2 bookings[, 1 outside hours]`. Source names: `default`,
 * `edited` (dayHours), `day off`; no window → `no hours`. Counts only: no booking id, ref or name.
 */
export function weekSummary(resources: { name: string; days: PlannedDay[] }[]): string {
    const lines: string[] = [];
    for (const r of resources) {
        if (lines.length > 0) lines.push("");
        lines.push(r.name);
        for (const day of r.days) {
            const parts: string[] = [];
            switch (day.kind) {
                case "past": break;
                case "planned": {
                    switch (day.source) {
                        case "default": parts.push("default"); break;
                        case "dayHours": parts.push("edited"); break;
                        case "dayOff": parts.push("day off"); break;
                        default: {
                            const never: never = day.source;
                            throw new Error(`Unhandled source ${String(never)}`);
                        }
                    }
                    parts.push(day.windows.length === 0 ? "no hours" : day.windows.map((w) => `${w.start}-${w.end}`).join(", "));
                    break;
                }
                default: {
                    const never: never = day;
                    throw new Error(`Unhandled day ${JSON.stringify(never)}`);
                }
            }
            parts.push(plural(day.entries.length, "booking", "bookings"));
            if (day.kind === "planned" && day.outsideHours.length > 0) parts.push(`${day.outsideHours.length} outside hours`);
            lines.push(`  ${weekdayName(day.date)} ${day.date}: ${parts.join(", ")}`);
        }
    }
    return lines.join("\n");
}

/** AP12: every tenant record (main table), all pages, with the projection the jobs read. */
async function listTenantRecords(): Promise<{ tenantId: string; record: Record<string, any> }[]> {
    const out: { tenantId: string; record: Record<string, any> }[] = [];
    let start: Record<string, any> | undefined;
    do {
        const page = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
            ExpressionAttributeValues: { ":pk": "SYSTEM", ":p": "TENANT#" },
            // `name` and `domain` are DynamoDB reserved words: every name is aliased.
            ProjectionExpression: "#sk, #name, #domain, #enabled, #scheduling, #mail, #integrations.#contact",
            ExpressionAttributeNames: {
                "#sk": "SK", "#name": "name", "#domain": "domain", "#enabled": "schedulingEnabled", "#scheduling": "scheduling",
                "#mail": "schedulingEmailConfig", "#integrations": "integrations", "#contact": "contactEmail",
            },
            ExclusiveStartKey: start,
        }));
        for (const item of page.Items ?? []) out.push({ tenantId: String(item.SK).slice("TENANT#".length), record: item });
        start = page.LastEvaluatedKey;
    } while (start !== undefined);
    return out;
}

function errorName(e: unknown): string {
    return e instanceof Error ? e.name : "unknown error";
}

async function send(tenant: SchedulingTenant, to: string, mail: { subject: string; body: string }, from: string,
    replyTo: string[] | undefined): Promise<void> {
    await ses.send(new SendEmailCommand({
        Source: formatFromHeader(tenant.name, from),
        ...(replyTo === undefined ? {} : { ReplyToAddresses: replyTo }),
        Destination: { ToAddresses: [to] },
        Message: { Subject: { Data: mail.subject }, Body: { Text: { Data: mail.body } } },
    }));
}

/** A reminder target: one booking and the start it is reminded for. */
type Target = { bookingId: string; target: ReminderTarget };

/**
 * The saved booking still matches the target (the rule of SCHED-1F1: a notice is about one placement): the slot still
 * starts at `S` and is confirmed.
 */
function samePlacement(b: Booking, t: ReminderTarget): boolean {
    switch (t.kind) {
        case "slot": return b.what.start === t.start && b.state.kind === "confirmed";
        default: {
            const never: never = t.kind;
            throw new Error(`Unhandled target ${JSON.stringify(never)}`);
        }
    }
}

async function reminderTargets(store: SchedulingStore, tenantId: string, window: { start: Instant; end: Instant }, now: Instant)
    : Promise<Target[] | "busy"> {
    const targets: Target[] = [];
    const inWindow = (s: Instant) => window.start <= s && s <= window.end;
    for (const resource of await listResources(store, tenantId, false)) {
        // `end + 1`: `activeEntries` intersects half-open spans, and a start exactly at the window end is in the window.
        const entries = await readIntervals(store, tenantId, resource.id, { start: window.start, end: window.end + 1 }, now);
        for (const e of entries) {
            if (e.x === undefined && inWindow(e.s)) {
                targets.push({ bookingId: e.bookingId, target: { kind: "slot", start: e.s } });
            }
        }
    }
    return targets;
}

async function reminders(store: SchedulingStore, tenantId: string, tenant: SchedulingTenant, tz: TimeZone, hours: number,
    now: Instant, summary: JobSummary): Promise<void> {
    const template = resolveTemplate("reminder", tenant.templates);
    if (!template.sendToCustomer) return;
    const from = process.env.SES_FROM_EMAIL ?? "";
    const origin = process.env.RENDERER_CLOUDFRONT_ORIGIN ?? "";
    if (!from || !origin) {
        // Checked before any mark: a reminder that cannot be sent is not consumed.
        console.error("[scheduling] reminders not run: sender or link base not configured", tenantId);
        summary.reminders.failed++;
        return;
    }
    summary.reminders.tenants++;
    const targets = await reminderTargets(store, tenantId, { start: now, end: now + hours * HOUR_MS }, now);
    if (targets === "busy") {
        console.error("[scheduling] reminders busy", tenantId);
        summary.reminders.failed++;
        return;
    }
    for (const t of targets) {
        const mark = await markReminder(store, tenantId, t.bookingId, t.target);
        if (mark.kind === "stale") {
            summary.reminders.stale++;
            continue;
        }
        const minted = await mintToken(store, tenantId, t.bookingId, now, { countForEmail: false });
        if (!minted.ok) {
            console.log("[scheduling] reminder: no token", tenantId, t.bookingId, minted.error.kind);
            summary.reminders.notIssued++;
            continue;
        }
        const { booking: b, token } = minted.value;
        if (!samePlacement(b, t.target)) {
            summary.reminders.placementChanged++;
            continue;
        }
        const vars = (link: string) => ({
            ref: b.ref, customerName: b.who.name,
            serviceName: b.what.serviceName,
            when: whenText(b, tz),
            expiresAt: "", link, siteName: tenant.name ?? "",
        });
        const link = `${bookingBase({ id: tenantId, domain: tenant.domain }, origin)}/_booking/manage#t=${token}`;
        try {
            await send(tenant, b.who.email, renderSchedulingMail("reminder", template, vars(link)), from,
                schedulingReplyTo("customer", tenant, b.who.email));
            summary.reminders.sent++;
        } catch (e) {
            console.error("[scheduling] reminder mail failed", tenantId, b.id, errorName(e));
            summary.reminders.mailFailed++;
            continue;
        }
        if (template.sendToAdmin && tenant.contactEmail !== undefined) {
            try {
                await send(tenant, tenant.contactEmail, renderSchedulingMail("reminder", template, vars("")), from,
                    schedulingReplyTo("owner", tenant, b.who.email));
            } catch (e) {
                console.error("[scheduling] reminder owner copy failed", tenantId, b.id, errorName(e));
            }
        }
    }
}

async function weekMail(store: SchedulingStore, tenantId: string, tenant: SchedulingTenant, tz: TimeZone, now: Instant,
    summary: JobSummary): Promise<void> {
    const due = weekMailDue(now, tz);
    if (due.kind === "notDue") return;
    summary.weekMail.due++;
    const template = resolveTemplate("weekAhead", tenant.templates);
    if (!template.sendToAdmin) {
        summary.weekMail.off++;
        return;
    }
    if (tenant.contactEmail === undefined) {
        console.log("[scheduling] weekly mail: no contactEmail", tenantId);
        summary.weekMail.noContactEmail++;
        return;
    }
    const resources = await listResources(store, tenantId, false);
    const plans = await getResourcePlans(store, tenantId, resources.map((r) => r.id));
    if (!plans.ok) {
        console.error("[scheduling] weekly mail busy", tenantId);
        summary.weekMail.failed++;
        return;
    }
    if (!resources.some((r) => plans.value[r.id].rules.length > 0)) {
        summary.weekMail.noWeeklyHours++;
        return;
    }
    const week = due.weekStart;
    const claim = await claimWeekMail(store, tenantId, week, now);
    if (claim.alreadySent) {
        summary.weekMail.alreadySent++;
        return;
    }
    const dates = Array.from({ length: 7 }, (_, i) => plusDays(week, i));
    const span = { start: localDaySpan(dates[0], tz).start, end: localDaySpan(dates[6], tz).end };
    const listed = resources
        .filter((r) => plans.value[r.id].rules.length > 0 || dates.some((d) => plans.value[r.id].days[d] !== undefined))
        .sort((a, b) => a.name.localeCompare(b.name, "en") || (a.id < b.id ? -1 : 1));
    const planned: { name: string; days: PlannedDay[] }[] = [];
    for (const r of listed) {
        const { rules, days } = plans.value[r.id];
        const entries = await readIntervals(store, tenantId, r.id, span, now);
        planned.push({
            name: r.name,
            days: dates.map((date) => planDay({ rules, days, date, entries: activeEntries(entries, localDaySpan(date, tz), now), tz, now })),
        });
    }
    const adminUrl = process.env.ADMIN_URL ?? "";
    if (!adminUrl) console.error("[scheduling] weekly mail: ADMIN_URL not set", tenantId);
    const mail = renderSchedulingMail("weekAhead", template, {
        weekStart: week, weekEnd: dates[6], summary: weekSummary(planned),
        plannerLink: adminUrl ? `${adminUrl}/scheduling/planner?tenant=${encodeURIComponent(tenantId)}&week=${week}` : "",
        siteName: tenant.name ?? "",
    });
    const from = process.env.SES_FROM_EMAIL ?? "";
    try {
        if (!from) throw Object.assign(new Error("SES_FROM_EMAIL is not set"), { name: "SenderNotConfigured" });
        await send(tenant, tenant.contactEmail, mail, from, schedulingReplyTo("weekAhead", tenant, undefined));
    } catch (e) {
        console.error("[scheduling] weekly mail failed", tenantId, week, errorName(e));
        summary.weekMail.mailFailed++;
        return;
    }
    summary.weekMail.sent++;
    // A failure here is caught by the caller (logged, counted): the next due run sends again (the documented duplicate).
    await markWeekMailSent(store, tenantId, week, now);
}

/** One run of the job. `scheduledAt` decides the cleanup run; `now` is the clock of everything else. */
export async function runSchedulingJobs(input: { scheduledAt: Instant; now: Instant }): Promise<JobSummary> {
    const { scheduledAt, now } = input;
    const store = schedulingStoreFromEnv();
    const cleanupRun = isCleanupRun(scheduledAt);
    const summary: JobSummary = {
        scheduledAt: new Date(scheduledAt).toISOString(), tenants: 0, cleanupRun,
        cleanup: { tenants: 0, removed: 0, skipped: 0, busy: 0, failed: 0 },
        reminders: { tenants: 0, sent: 0, stale: 0, notIssued: 0, placementChanged: 0, mailFailed: 0, failed: 0 },
        weekMail: { due: 0, sent: 0, alreadySent: 0, noContactEmail: 0, off: 0, noWeeklyHours: 0, mailFailed: 0, failed: 0 },
        settingsInvalid: 0,
    };
    const tenants = await listTenantRecords();
    summary.tenants = tenants.length;
    for (const { tenantId, record } of tenants) {
        if (cleanupRun) {
            try {
                const out = await cleanupExpiredHolds(store, tenantId, now);
                summary.cleanup.tenants++;
                summary.cleanup.removed += out.removed;
                summary.cleanup.skipped += out.skipped;
                summary.cleanup.busy += out.busy;
            } catch (e) {
                console.error("[scheduling] cleanup failed", tenantId, errorName(e));
                summary.cleanup.failed++;
            }
        }
        if (record.schedulingEnabled !== true) continue;
        let tenant: SchedulingTenant;
        try {
            tenant = parseSchedulingTenant(tenantId, record);
        } catch (e) {
            console.error("[scheduling] tenant settings not valid", tenantId, errorName(e));
            summary.settingsInvalid++;
            continue;
        }
        const tz = tenant.scheduling?.timezone;
        if (tenant.scheduling === undefined || tz === undefined) {
            // An enabled tenant without a zone cannot be saved (PUT /settings → 400): stored data that fails its rule.
            console.error("[scheduling] tenant settings not valid", tenantId, "no timezone");
            summary.settingsInvalid++;
            continue;
        }
        const hours = tenant.scheduling.reminderHours;
        if (hours > 0) {
            try {
                await reminders(store, tenantId, tenant, tz, hours, now, summary);
            } catch (e) {
                console.error("[scheduling] reminders failed", tenantId, errorName(e));
                summary.reminders.failed++;
            }
        }
        try {
            await weekMail(store, tenantId, tenant, tz, now, summary);
        } catch (e) {
            console.error("[scheduling] weekly mail failed", tenantId, errorName(e));
            summary.weekMail.failed++;
        }
    }
    console.log("[scheduling] job summary", JSON.stringify(summary));
    return summary;
}

/**
 * EventBridge scheduled event: `time` is the rule's scheduled time (ISO-8601). A manual invoke without a valid
 * `time` uses the current time for both clocks (a staging invoke may pass `{ "time": "…T03:05:00Z" }` to run the
 * cleanup).
 */
export const handler = async (event: { time?: unknown } | undefined): Promise<JobSummary> => {
    const now = Date.now();
    const at = typeof event?.time === "string" ? Date.parse(event.time) : Number.NaN;
    return runSchedulingJobs({ scheduledAt: Number.isFinite(at) ? at : now, now });
};
