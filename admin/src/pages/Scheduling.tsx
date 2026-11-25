import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarClock, Loader2, Save, RotateCcw, Plus, Trash2, Link2 } from "lucide-react";
import { SchedulingSettingsSchema, SchedulingEmailKeySchema, type SchedulingEmailKey } from "@amodx/shared";

/*
 * SCHED-1D1 (docs/slices/sched-1.md § 4.1, § 10.3, § 11.1) — the minimal scheduling screen: scheduling settings,
 * resources, mail templates. English UI. PROTOTYPE.
 *
 * SCHED-MENU-1: the sidebar lists this page only for scheduling sites. A direct visit while off shows a sentence
 * and a link to Settings, which owns the switch and initial time zone. The settings and the
 * template overrides are saved through the existing PUT /settings (TENANT_ADMIN), with ONLY the scheduling attributes
 * in the body. The default mail texts come from GET /scheduling/admin/email-templates: this page keeps no copy.
 * Not on this screen: services and the week planner (`sched-1e`, own pages linked from the header: SchedulingPlanner.tsx,
 * SchedulingAppointments.tsx),
 * customer lookup and erasure (the routes exist; the screen for them is not in this slice).
 */

const EMAIL_KEYS: readonly SchedulingEmailKey[] = SchedulingEmailKeySchema.options;

/** § 4.1 defaults, shown when a site has no stored value (the schema applies the same defaults on read). */
const DEFAULTS = { holdMinutes: 30, changeCutoffHours: 24, reminderHours: 24, bookingHorizonWeeks: 8 };

export type SettingsForm = {
    timezone: string; holdMinutes: string; changeCutoffHours: string; reminderHours: string; bookingHorizonWeeks: string;
};

/** The form from the stored `scheduling` attribute (absent fields → the § 4.1 defaults). */
export function settingsFormOf(stored: unknown): SettingsForm {
    const s = (stored !== null && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
    const num = (key: keyof typeof DEFAULTS) => String(typeof s[key] === "number" ? s[key] : DEFAULTS[key]);
    return {
        timezone: typeof s.timezone === "string" ? s.timezone : "",
        holdMinutes: num("holdMinutes"),
        changeCutoffHours: num("changeCutoffHours"),
        reminderHours: num("reminderHours"),
        bookingHorizonWeeks: num("bookingHorizonWeeks"),
    };
}

/**
 * The PUT /settings body for the scheduling settings: `{ scheduling }` and nothing else (§ 6.5
 * point 4: a body with a scheduling attribute publishes its audit event without `ip`). Checked here with the same
 * shared schema the server uses. This form is available only while scheduling is on, so it requires a time zone.
 * The switch belongs to Settings; this save never changes it.
 */
export function settingsPayload(form: SettingsForm)
    : { ok: true; body: { scheduling: Record<string, unknown> } } | { ok: false; error: string } {
    const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));
    const scheduling: Record<string, unknown> = {
        ...(form.timezone.trim() !== "" ? { timezone: form.timezone.trim() } : {}),
        holdMinutes: number(form.holdMinutes),
        changeCutoffHours: number(form.changeCutoffHours),
        reminderHours: number(form.reminderHours),
        bookingHorizonWeeks: number(form.bookingHorizonWeeks),
    };
    const parsed = SchedulingSettingsSchema.strict().safeParse(scheduling);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { ok: false, error: `${["scheduling", ...issue.path.map(String)].join(".")}: ${issue.message}` };
    }
    if (scheduling.timezone === undefined) {
        return { ok: false, error: "scheduling.timezone: a time zone is required when scheduling is enabled." };
    }
    return { ok: true, body: { scheduling } };
}

export type EmailTemplate = { subject: string; body: string; sendToCustomer: boolean; sendToAdmin: boolean };
type Templates = Record<SchedulingEmailKey, EmailTemplate>;

/** What the editor shows per key: the tenant's override when there is one, else the default. */
export function editableTemplates(defaults: Templates, overrides: Partial<Templates>): Templates {
    const out = {} as Templates;
    for (const key of EMAIL_KEYS) out[key] = { ...(overrides[key] ?? defaults[key]) };
    return out;
}

const sameTemplate = (a: EmailTemplate, b: EmailTemplate) =>
    a.subject === b.subject && a.body === b.body && a.sendToCustomer === b.sendToCustomer && a.sendToAdmin === b.sendToAdmin;

/**
 * The PUT /settings body for the mail templates: `{ schedulingEmailConfig: { templates } }` with an override only for
 * a key whose text or recipients differ from the default (a key equal to its default is left out, so a later change
 * of the default text reaches the site; "Reset to default" therefore removes the override). `weekAhead` is sent
 * without `sendToCustomer`: that mail has no customer and the server never reads the flag (§ 11.1).
 */
export function templatesPayload(edited: Templates, defaults: Templates)
    : { schedulingEmailConfig: { templates: Partial<Record<SchedulingEmailKey, Partial<EmailTemplate>>> } } {
    const templates: Partial<Record<SchedulingEmailKey, Partial<EmailTemplate>>> = {};
    for (const key of EMAIL_KEYS) {
        const t = edited[key];
        const differs = key === "weekAhead"
            ? t.subject !== defaults[key].subject || t.body !== defaults[key].body || t.sendToAdmin !== defaults[key].sendToAdmin
            : !sameTemplate(t, defaults[key]);
        if (!differs) continue;
        templates[key] = key === "weekAhead"
            ? { subject: t.subject, body: t.body, sendToAdmin: t.sendToAdmin }
            : { subject: t.subject, body: t.body, sendToCustomer: t.sendToCustomer, sendToAdmin: t.sendToAdmin };
    }
    return { schedulingEmailConfig: { templates } };
}

/** The text shown for a failed scheduling call: the server's reason for the known refusal codes, else the message. */
export function schedulingErrorText(e: unknown): string {
    if (e instanceof ApiError && e.body !== null && typeof e.body === "object") {
        const body = e.body as { code?: string; error?: string; activeBookings?: number };
        switch (body.code) {
            case "resourceInUse":
                return `This resource cannot be removed: it has ${body.activeBookings ?? 0} future booking(s). Move or cancel them first.`;
            case "resourceRemovalInProgress":
                return "Another removal of this resource is in progress. Try again in a few minutes.";
            case "busy":
                return "The system is busy. Please try again.";
        }
        if (typeof body.error === "string") return body.error;
    }
    return e instanceof Error ? e.message : String(e);
}

/**
 * SCHED-1G3 — whether the page shows the contact-address warning: scheduling is on and the site has no contact address.
 * "No contact address" is the backend's own rule (`backend/src/scheduling/common.ts`: `integrations.contactEmail` counts
 * only as a non-empty string), so the warning shows exactly when the weekly planner mail (§ 11.4) and the owner copies
 * of booking mails (§ 11.1) are skipped.
 */
export function needsContactAddressWarning(schedulingEnabled: boolean, contactEmail: unknown): boolean {
    return schedulingEnabled && !(typeof contactEmail === "string" && contactEmail !== "");
}

const KEY_LABELS: Record<SchedulingEmailKey, string> = {
    hold: "Confirm request", confirmed: "Confirmed", cancelled: "Cancelled", moved: "Moved",
    reminder: "Reminder", weekAhead: "Week ahead (to you)",
};
const KEY_DESCRIPTIONS: Record<SchedulingEmailKey, string> = {
    hold: "Sent when a visitor books. Its link is the only way to confirm the booking.",
    confirmed: "Sent when a booking is confirmed, and when you add a booking by hand. A copy goes to your contact email when 'Admin' is ticked.",
    cancelled: "Sent when a booking is cancelled. The copy to your contact email is sent only when the customer cancels.",
    moved: "Sent when a booking moves to another time.",
    reminder: "Sent before the booking starts (Scheduling settings: reminder hours; 0 = no reminder).",
    weekAhead: "Sent to your contact email each Sunday with the next week's plan. Untick 'Admin' to stop it.",
};
const BOOKING_VARIABLES = ["ref", "customerName", "serviceName", "when", "expiresAt", "link", "siteName"];
const WEEK_VARIABLES = ["weekStart", "weekEnd", "summary", "plannerLink", "siteName"];

type Resource = { id: string; name: string; hasFeed: boolean };

/**
 * DELETE answers 204 with no body; `apiRequest` reads every 2xx answer as JSON, so it throws a SyntaxError for it.
 * `apiRequest` reaches that read only after `response.ok`, so a SyntaxError here means "succeeded, no JSON body".
 */
async function deleteRequest(path: string): Promise<void> {
    try {
        await apiRequest(path, { method: "DELETE" });
    } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
    }
}

const TIMEZONES: string[] = (() => {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    try { return intl.supportedValuesOf?.("timeZone") ?? []; } catch { return []; }
})();

export default function SchedulingPage() {
    const { currentTenant } = useTenant();
    const { userRole } = useAuth();
    const isAdmin = userRole === "TENANT_ADMIN" || userRole === "GLOBAL_ADMIN";

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [contactWarning, setContactWarning] = useState(false);
    const [form, setForm] = useState<SettingsForm>(settingsFormOf(undefined));
    const [savingSettings, setSavingSettings] = useState(false);
    const [resources, setResources] = useState<Resource[]>([]);
    const [newResource, setNewResource] = useState("");
    const [names, setNames] = useState<Record<string, string>>({});
    const [feedUrl, setFeedUrl] = useState<{ resourceId: string; url: string } | null>(null);
    const [defaults, setDefaults] = useState<Templates | null>(null);
    const [templates, setTemplates] = useState<Templates | null>(null);
    const [activeKey, setActiveKey] = useState<SchedulingEmailKey>("hold");
    const [savingTemplates, setSavingTemplates] = useState(false);

    useEffect(() => {
        if (currentTenant) load();
    }, [currentTenant?.id]);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const settings = await apiRequest("/settings");
            const on = settings.schedulingEnabled === true;
            setEnabled(on);
            setContactWarning(needsContactAddressWarning(on, settings.integrations?.contactEmail));
            setForm(settingsFormOf(settings.scheduling));
            if (on) {
                const [res, tpl] = await Promise.all([
                    apiRequest("/scheduling/admin/resources"),
                    apiRequest("/scheduling/admin/email-templates"),
                ]);
                setResources(res.resources);
                setNames(Object.fromEntries((res.resources as Resource[]).map((r) => [r.id, r.name])));
                setDefaults(tpl.defaults);
                setTemplates(editableTemplates(tpl.defaults, tpl.overrides));
            }
        } catch (e) {
            setError(schedulingErrorText(e));
        } finally {
            setLoading(false);
        }
    }

    async function saveSettings() {
        const payload = settingsPayload(form);
        if (!payload.ok) { setError(payload.error); return; }
        setSavingSettings(true);
        setError(null);
        try {
            await apiRequest("/settings", { method: "PUT", body: JSON.stringify(payload.body) });
            await load();
        } catch (e) {
            setError(schedulingErrorText(e));
        } finally {
            setSavingSettings(false);
        }
    }

    async function run(action: () => Promise<void>) {
        setError(null);
        try { await action(); } catch (e) { setError(schedulingErrorText(e)); }
    }

    const addResource = () => run(async () => {
        await apiRequest("/scheduling/admin/resources", { method: "POST", body: JSON.stringify({ name: newResource }) });
        setNewResource("");
        await load();
    });
    const renameResource = (r: Resource) => run(async () => {
        await apiRequest(`/scheduling/admin/resources/${encodeURIComponent(r.id)}`, { method: "PUT", body: JSON.stringify({ name: names[r.id] ?? r.name }) });
        await load();
    });
    const removeResource = (r: Resource) => run(async () => {
        if (!confirm(`Remove "${r.name}"? Its weekly hours and day edits are removed too.`)) return;
        await deleteRequest(`/scheduling/admin/resources/${encodeURIComponent(r.id)}`);
        await load();
    });
    const newFeedLink = (r: Resource) => run(async () => {
        if (r.hasFeed && !confirm(`Create a new calendar link for "${r.name}"? The old link stops working at once.`)) return;
        const res = await apiRequest(`/scheduling/admin/resources/${encodeURIComponent(r.id)}/feed-secret`, { method: "POST", body: "{}" });
        setFeedUrl({ resourceId: r.id, url: res.feedUrl });
        await load();
    });

    async function saveTemplates() {
        if (!templates || !defaults) return;
        setSavingTemplates(true);
        setError(null);
        try {
            await apiRequest("/settings", { method: "PUT", body: JSON.stringify(templatesPayload(templates, defaults)) });
            await load();
        } catch (e) {
            setError(schedulingErrorText(e));
        } finally {
            setSavingTemplates(false);
        }
    }
    const updateTemplate = (field: keyof EmailTemplate, value: string | boolean) =>
        setTemplates((prev) => (prev ? { ...prev, [activeKey]: { ...prev[activeKey], [field]: value } } : prev));

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    const errorBox = error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
    );
    // A failed settings read does not establish that scheduling is off.
    if (error !== null && !enabled) return <div className="p-8">{errorBox}</div>;
    const timezoneInput = (
        <div className="space-y-2">
            <Label htmlFor="sched-timezone">Time zone</Label>
            <Input id="sched-timezone" list="sched-timezones" value={form.timezone} placeholder="Europe/Bucharest"
                onChange={(e) => setForm({ ...form, timezone: e.target.value })} disabled={!isAdmin} />
            <datalist id="sched-timezones">{TIMEZONES.map((tz) => <option key={tz} value={tz} />)}</datalist>
            <p className="text-xs text-muted-foreground">Opening hours are in this time zone.</p>
        </div>
    );

    const header = (
        <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><CalendarClock className="h-7 w-7" /> Scheduling</h1>
            <p className="text-muted-foreground">Appointments, confirmed by an emailed link.</p>
            {/* SCHED-1E2: the appointment pages (they work with scheduling off, § 23.5). */}
            <p className="text-sm">
                <Link className="underline" to="/scheduling/planner">Week planner</Link>
                {" · "}
                <Link className="underline" to="/scheduling/appointments">Services and weekly hours</Link>
            </p>
        </div>
    );

    if (!enabled) {
        return (
            <div className="p-8 space-y-4">
                {errorBox}
                <p>Scheduling is off for this site.</p>
                <Link className="underline" to="/settings">Settings</Link>
            </div>
        );
    }

    const current = templates?.[activeKey];
    const numberField = (key: keyof Omit<SettingsForm, "timezone">, label: string, help: string) => (
        <div className="space-y-2">
            <Label htmlFor={`sched-${key}`}>{label}</Label>
            <Input id={`sched-${key}`} type="number" value={form[key]} disabled={!isAdmin}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            <p className="text-xs text-muted-foreground">{help}</p>
        </div>
    );

    return (
        <div className="p-8 space-y-6">
            {header}
            {errorBox}
            {contactWarning && (
                <p role="status" className="rounded-md border bg-muted p-3 text-sm">
                    The weekly planner mail and the owner copies of booking mails are not sent until a contact address is
                    set. <Link className="underline" to="/settings">Set the contact email in Settings (Notifications).</Link>
                </p>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Scheduling settings</CardTitle>
                    <CardDescription>{isAdmin ? "Scheduling is on for this site." : "Only a site admin can change these settings."}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {timezoneInput}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {numberField("holdMinutes", "Hold (minutes)", "How long a booking waits for its confirmation link (5-1440).")}
                        {numberField("changeCutoffHours", "Change cutoff (hours)", "Customers can cancel or move until this many hours before the start (0-168).")}
                        {numberField("reminderHours", "Reminder (hours before)", "0 = no reminder (0-168).")}
                        {numberField("bookingHorizonWeeks", "Booking horizon (weeks)", "Visitors can book appointments this many weeks ahead (1-52).")}
                    </div>
                    {isAdmin && (
                        <div className="flex gap-2">
                            <Button onClick={saveSettings} disabled={savingSettings}>
                                {savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save settings
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Resources</CardTitle>
                    <CardDescription>The people (or rooms) that customers book.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {resources.length === 0 && <p className="text-sm text-muted-foreground">No resources yet.</p>}
                    {resources.map((r) => (
                        <div key={r.id} className="flex flex-wrap items-center gap-2">
                            <Input className="max-w-xs" value={names[r.id] ?? r.name} onChange={(e) => setNames({ ...names, [r.id]: e.target.value })} />
                            <Button variant="outline" size="sm" onClick={() => renameResource(r)} disabled={(names[r.id] ?? r.name) === r.name}>Rename</Button>
                            {isAdmin && (
                                <Button variant="outline" size="sm" onClick={() => newFeedLink(r)}>
                                    <Link2 className="mr-1 h-3 w-3" /> {r.hasFeed ? "New calendar link" : "Create calendar link"}
                                </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => removeResource(r)}><Trash2 className="h-3 w-3" /></Button>
                            {feedUrl?.resourceId === r.id && (
                                <div className="w-full rounded-md border bg-muted p-2 text-xs">
                                    <p className="mb-1 font-medium">Copy this calendar link now: it is shown only once.</p>
                                    <code className="break-all">{feedUrl.url}</code>
                                </div>
                            )}
                        </div>
                    ))}
                    <div className="flex gap-2 pt-2">
                        <Input className="max-w-xs" placeholder="Name, e.g. Dr. Ionescu" value={newResource} onChange={(e) => setNewResource(e.target.value)} />
                        <Button onClick={addResource} disabled={newResource.trim() === ""}><Plus className="mr-1 h-4 w-4" /> Add resource</Button>
                    </div>
                </CardContent>
            </Card>

            {templates && defaults && current && (
                <Card>
                    <CardHeader>
                        <CardTitle>Mail templates</CardTitle>
                        <CardDescription>The seven mails of scheduling. A template equal to the default is not stored.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                            <div className="space-y-1">
                                {EMAIL_KEYS.map((k) => (
                                    <button key={k} onClick={() => setActiveKey(k)}
                                        className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeKey === k ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
                                        {KEY_LABELS[k]}
                                    </button>
                                ))}
                            </div>
                            <div className="lg:col-span-3 space-y-4">
                                <p className="text-sm text-muted-foreground">{KEY_DESCRIPTIONS[activeKey]}</p>
                                <div className="space-y-2">
                                    <Label htmlFor="sched-subject">Subject</Label>
                                    <Input id="sched-subject" value={current.subject} onChange={(e) => updateTemplate("subject", e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="sched-body">Body</Label>
                                    <Textarea id="sched-body" rows={10} className="font-mono text-sm" value={current.body} onChange={(e) => updateTemplate("body", e.target.value)} />
                                </div>
                                <div className="flex gap-4">
                                    {activeKey !== "weekAhead" && (
                                        <label className="flex items-center gap-2 text-sm">
                                            <input type="checkbox" className="rounded" checked={current.sendToCustomer} onChange={(e) => updateTemplate("sendToCustomer", e.target.checked)} /> Customer
                                        </label>
                                    )}
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" className="rounded" checked={current.sendToAdmin} onChange={(e) => updateTemplate("sendToAdmin", e.target.checked)} /> Admin (contact email)
                                    </label>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {(activeKey === "weekAhead" ? WEEK_VARIABLES : BOOKING_VARIABLES).map((v) => (
                                        <code key={v} className="text-xs bg-muted px-2 py-1 rounded font-mono">{"{{" + v + "}}"}</code>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" onClick={() => setTemplates({ ...templates, [activeKey]: { ...defaults[activeKey] } })}>
                                        <RotateCcw className="mr-2 h-3 w-3" /> Reset to default
                                    </Button>
                                    {isAdmin && (
                                        <Button size="sm" onClick={saveTemplates} disabled={savingTemplates}>
                                            {savingTemplates ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Save className="mr-2 h-3 w-3" />} Save all templates
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
