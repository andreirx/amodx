import { useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarClock, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { AvailabilityRuleSchema, ServiceSchema, type AvailabilityRule, type Eligibility } from "@amodx/shared";
import { plannerErrorText, selectionKey, useSelectionData, type ResourceDTO, type ServiceDTO } from "./SchedulingPlanner";

/*
 * SCHED-1E2 (docs/slices/sched-1.md § 4.2, § 10.3 routes of `sched-1e`) — the appointment setup: services
 * (`GET/POST/PUT/DELETE /scheduling/admin/services`) and the weekly hours of each resource
 * (`GET/PUT /scheduling/admin/resources/{r}/availability`, the defaults of D16). English UI. PROTOTYPE.
 * The weeks themselves are edited in the planner (SchedulingPlanner.tsx). Both routes work with the switch off.
 */

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type ServiceForm = { name: string; durationMin: string; eligibility: "all" | "only"; resourceIds: string[] };

/**
 * The POST/PUT body of a service, checked with the shared `ServiceSchema` (name 1-200, duration 5-480 on 5-minute
 * steps, eligibility "all" or a non-empty list); an error names the field as the server does.
 */
export function servicePayload(form: ServiceForm)
    : { ok: true; body: { name: string; durationMin: number; eligibility: Eligibility } } | { ok: false; error: string } {
    const durationText = form.durationMin.trim();
    const raw = {
        name: form.name.trim(),
        durationMin: durationText === "" ? Number.NaN : Number(durationText),
        eligibility: form.eligibility === "all" ? { kind: "all" } : { kind: "only", resourceIds: form.resourceIds },
    };
    if (form.eligibility === "only" && form.resourceIds.length === 0) {
        return { ok: false, error: "eligibility.resourceIds: Choose at least one resource, or allow every resource." };
    }
    const parsed = ServiceSchema.omit({ id: true }).safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { ok: false, error: `${issue.path.map(String).join(".")}: ${issue.message}` };
    }
    return { ok: true, body: parsed.data };
}

export type RuleRow = { weekday: string; start: string; end: string };

/**
 * The PUT body of the weekly hours: every row checked with the shared `AvailabilityRuleSchema`, sorted by weekday and
 * start. The server also checks the 5-minute steps and the bound of 50 rules (its answer names the field).
 */
export function rulesPayload(rows: RuleRow[]): { ok: true; body: { rules: AvailabilityRule[] } } | { ok: false; error: string } {
    const rules: AvailabilityRule[] = [];
    for (const [i, row] of rows.entries()) {
        const parsed = AvailabilityRuleSchema.safeParse({ weekday: Number(row.weekday), start: row.start.trim(), end: row.end.trim() });
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return { ok: false, error: `rules.${i}.${issue.path.map(String).join(".")}: ${issue.message}` };
        }
        rules.push(parsed.data);
    }
    rules.sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
    return { ok: true, body: { rules } };
}

/** DELETE answers 204 with no body; `apiRequest` throws a SyntaxError reading it only after `response.ok` (as Scheduling.tsx). */
async function deleteRequest(path: string): Promise<void> {
    try {
        await apiRequest(path, { method: "DELETE" });
    } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
    }
}

function rowsOf(rules: AvailabilityRule[]): RuleRow[] {
    return rules.map((x) => ({ weekday: String(x.weekday), start: x.start, end: x.end }));
}

const EMPTY_SERVICE: ServiceForm = { name: "", durationMin: "30", eligibility: "all", resourceIds: [] };

export default function SchedulingAppointments() {
    const { currentTenant } = useTenant();
    // Review-0 R1: every list, form and message belongs to the selection it was loaded for (useSelectionData).
    const tenantKey = currentTenant ? selectionKey([currentTenant.id]) : null;
    const lists = useSelectionData<{ services: ServiceDTO[]; resources: ResourceDTO[] }>(tenantKey, async () => {
        const [svc, res] = await Promise.all([apiRequest("/scheduling/admin/services"), apiRequest("/scheduling/admin/resources")]);
        return { services: svc.services, resources: res.resources };
    });
    const services = lists.data?.services ?? [];
    const resources = lists.data?.resources ?? [];
    const [editing, setEditing] = useState<{ id: string | null; form: ServiceForm } | null>(null);
    const [chosen, setHoursOf] = useState<string | null>(null);
    const hoursOf = resources.find((r) => r.id === chosen)?.id ?? resources[0]?.id ?? "";
    const hoursKey = currentTenant && hoursOf !== "" ? selectionKey([currentTenant.id, hoursOf]) : null;
    const hours = useSelectionData<{ rules: AvailabilityRule[] }>(hoursKey, () =>
        apiRequest(`/scheduling/admin/resources/${encodeURIComponent(hoursOf)}/availability`));
    // Rows being edited belong to the resource they were loaded for; another resource shows its own loaded rules.
    const [edit, setEdit] = useState<{ key: string; rows: RuleRow[] } | null>(null);
    const rows = hours.data === null ? null : edit !== null && edit.key === hoursKey ? edit.rows : rowsOf(hours.data.rules);
    const setRows = (next: RuleRow[]) => { if (hoursKey !== null) setEdit({ key: hoursKey, rows: next }); };
    const [message, setMessage] = useState<{ key: string | null; error: string | null; saved: string | null } | null>(null);
    const ownMessage = message !== null && (message.key === tenantKey || message.key === hoursKey) ? message : null;
    const error = lists.error ?? hours.error ?? ownMessage?.error ?? null;
    const saved = ownMessage?.saved ?? null;

    async function run(key: string | null, action: () => Promise<string | null>) {
        setMessage(null);
        try {
            setMessage({ key, error: null, saved: await action() });
        } catch (e) {
            setMessage({ key, error: plannerErrorText(e), saved: null });
        }
    }

    const saveService = () => run(tenantKey, async () => {
        if (!editing) return null;
        const built = servicePayload(editing.form);
        if (!built.ok) throw new Error(built.error);
        if (editing.id === null) {
            await apiRequest("/scheduling/admin/services", { method: "POST", body: JSON.stringify(built.body) });
        } else {
            await apiRequest(`/scheduling/admin/services/${encodeURIComponent(editing.id)}`, { method: "PUT", body: JSON.stringify(built.body) });
        }
        setEditing(null);
        await lists.reload();
        return null;
    });
    const removeService = (s: ServiceDTO) => run(tenantKey, async () => {
        if (!confirm(`Remove the service "${s.name}"? Existing bookings keep its name; visitors can no longer choose it.`)) return null;
        await deleteRequest(`/scheduling/admin/services/${encodeURIComponent(s.id)}`);
        await lists.reload();
        return null;
    });
    // The target is the resource whose rows are shown (review-0 R1), captured before the request.
    const saveHours = () => {
        if (rows === null || hoursKey === null) return;
        const target = { key: hoursKey, resourceId: hoursOf, rows };
        return run(target.key, async () => {
            const built = rulesPayload(target.rows);
            if (!built.ok) throw new Error(built.error);
            await apiRequest(`/scheduling/admin/resources/${encodeURIComponent(target.resourceId)}/availability`, {
                method: "PUT", body: JSON.stringify(built.body),
            });
            setEdit((prev) => (prev !== null && prev.key === target.key ? null : prev));
            await hours.reload();
            return "Weekly hours saved. Dates with a day edit keep their edit.";
        });
    };

    const nameOf = (id: string) => resources.find((r) => r.id === id)?.name ?? "(removed resource)";
    const eligibilityText = (e: Eligibility) => {
        switch (e.kind) {
            case "all": return "Every resource";
            case "only": return e.resourceIds.map(nameOf).join(", ");
            default: {
                const never: never = e;
                throw new Error(`Unhandled eligibility ${JSON.stringify(never)}`);
            }
        }
    };

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (lists.data === null) {
        return <div className="p-8">{error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : <Loader2 className="animate-spin" />}</div>;
    }

    return (
        <div className="p-8 space-y-6 max-w-4xl">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><CalendarClock className="h-7 w-7" /> Services and weekly hours</h1>
                <p className="text-muted-foreground">
                    What customers book, and the usual hours of each resource. Edit single days and weeks in the{" "}
                    <Link className="underline" to="/scheduling/planner">week planner</Link>.
                </p>
            </div>
            {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {saved && <div className="rounded-md border p-3 text-sm">{saved}</div>}

            <Card>
                <CardHeader>
                    <CardTitle>Services</CardTitle>
                    <CardDescription>A changed duration applies to new bookings; existing bookings keep their times.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {services.length === 0 && <p className="text-sm text-muted-foreground">No services yet.</p>}
                    {services.map((s) => (
                        <div key={s.id} className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="font-medium">{s.name}</span>
                            <span>{s.durationMin} min</span>
                            <span className="text-muted-foreground">{eligibilityText(s.eligibility)}</span>
                            <Button variant="outline" size="sm" onClick={() => setEditing({
                                id: s.id,
                                form: {
                                    name: s.name, durationMin: String(s.durationMin), eligibility: s.eligibility.kind,
                                    resourceIds: s.eligibility.kind === "only" ? [...s.eligibility.resourceIds] : [],
                                },
                            })}>Edit</Button>
                            <Button variant="outline" size="sm" aria-label={`Remove ${s.name}`} onClick={() => removeService(s)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                    ))}
                    {editing ? (
                        <div className="space-y-3 rounded-md border p-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label htmlFor="svc-name">Name</Label>
                                    <Input id="svc-name" value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="svc-duration">Duration (minutes, 5-480 in steps of 5)</Label>
                                    <Input id="svc-duration" type="number" step={5} value={editing.form.durationMin}
                                        onChange={(e) => setEditing({ ...editing, form: { ...editing.form, durationMin: e.target.value } })} />
                                </div>
                            </div>
                            <div className="space-y-1 text-sm">
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="svc-elig" checked={editing.form.eligibility === "all"}
                                        onChange={() => setEditing({ ...editing, form: { ...editing.form, eligibility: "all" } })} /> Every resource
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="svc-elig" checked={editing.form.eligibility === "only"}
                                        onChange={() => setEditing({ ...editing, form: { ...editing.form, eligibility: "only" } })} /> Only these resources:
                                </label>
                                {editing.form.eligibility === "only" && (
                                    <div className="flex flex-wrap gap-3 pl-6">
                                        {resources.map((r) => (
                                            <label key={r.id} className="flex items-center gap-1">
                                                <input type="checkbox" checked={editing.form.resourceIds.includes(r.id)} onChange={(e) => setEditing({
                                                    ...editing,
                                                    form: {
                                                        ...editing.form,
                                                        resourceIds: e.target.checked ? [...editing.form.resourceIds, r.id] : editing.form.resourceIds.filter((x) => x !== r.id),
                                                    },
                                                })} /> {r.name}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Button size="sm" onClick={saveService}><Save className="mr-1 h-3 w-3" /> {editing.id === null ? "Add service" : "Save service"}</Button>
                                <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                            </div>
                        </div>
                    ) : (
                        <Button size="sm" onClick={() => setEditing({ id: null, form: EMPTY_SERVICE })}><Plus className="mr-1 h-4 w-4" /> New service</Button>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Weekly hours</CardTitle>
                    <CardDescription>
                        Every week is open with these hours. A date you edited in the planner keeps its edit when you change them.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {resources.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No resources yet. Add one under <Link className="underline" to="/scheduling">Scheduling</Link>.</p>
                    ) : (
                        <>
                            <div className="space-y-1">
                                <Label htmlFor="hours-resource">Resource</Label>
                                <select id="hours-resource" className="rounded-md border bg-background px-3 py-2 text-sm" value={hoursOf} onChange={(e) => setHoursOf(e.target.value)}>
                                    {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                            </div>
                            {rows === null ? <Loader2 className="animate-spin" /> : (
                                <>
                                    {rows.length === 0 && <p className="text-sm text-muted-foreground">No weekly hours: visitors cannot book this resource.</p>}
                                    {rows.map((row, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <select aria-label={`Rule ${i + 1} weekday`} className="rounded-md border bg-background px-3 py-2 text-sm" value={row.weekday}
                                                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, weekday: e.target.value } : r)))}>
                                                {WEEKDAY_NAMES.map((n, d) => <option key={n} value={String(d + 1)}>{n}</option>)}
                                            </select>
                                            <Input aria-label={`Rule ${i + 1} start`} type="time" step="300" className="w-32" value={row.start}
                                                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, start: e.target.value } : r)))} />
                                            <span>–</span>
                                            <Input aria-label={`Rule ${i + 1} end`} type="time" step="300" className="w-32" value={row.end}
                                                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, end: e.target.value } : r)))} />
                                            <Button variant="outline" size="sm" aria-label="Remove these hours" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
                                        </div>
                                    ))}
                                    <div className="flex gap-2">
                                        <Button variant="outline" size="sm" onClick={() => setRows([...rows, { weekday: "1", start: "09:00", end: "17:00" }])}><Plus className="mr-1 h-3 w-3" /> Add hours</Button>
                                        <Button size="sm" onClick={saveHours}><Save className="mr-1 h-3 w-3" /> Save weekly hours</Button>
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
