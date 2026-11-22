import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { instantToLocal, type Actor, type BookingSource, type TimeZone } from "@amodx/shared";
import {
    AppointmentDialog, formatWhen, mondayOf, plannerErrorText, selectionKey, useSelectionData,
    type BookingAdminDTO, type HistoryEntryDTO, type PlacementDTO, type ResourceDTO,
} from "./SchedulingPlanner";

/*
 * SCHED-1E2 (docs/slices/sched-1.md § 10.3, § 23.5) — one booking as the admin sees it
 * (`GET /scheduling/admin/bookings/{id}`, `BookingAdminDTO`) with its `history` (SCHED-AUDIT-PII = C: booking events are
 * read here, never in the main-table audit log). Actions: cancel (`POST …/cancel`, the customer gets the "Cancelled"
 * mail) and, for a confirmed appointment, move (the planner's dialog, `POST …/move-slot`). Times in the site's zone
 * (`GET /settings` → `scheduling.timezone`). English UI. PROTOTYPE.
 */

function actorText(a: Actor): string {
    switch (a.kind) {
        case "customer": return "the customer";
        case "admin": return a.email;
        default: {
            const never: never = a;
            throw new Error(`Unhandled actor ${JSON.stringify(never)}`);
        }
    }
}

function placementText(p: PlacementDTO, tz: TimeZone, resourceName: (id: string) => string): string {
    switch (p.kind) {
        case "slot": return `${formatWhen(p.start, tz)} with ${resourceName(p.resourceId)}`;
        case "seat": return `group ${p.runId}`;
        case "unplaced": return "no group";
        default: {
            const never: never = p;
            throw new Error(`Unhandled placement ${JSON.stringify(never)}`);
        }
    }
}

/** One line per history entry, in the site's zone; exhaustive over the four actions (§ 4.4). */
export function historyLine(e: HistoryEntryDTO, tz: TimeZone, resourceName: (id: string) => string): string {
    const at = formatWhen(e.at, tz);
    switch (e.action) {
        case "created": return `${at}: created (${e.state}), ${placementText(e.placement, tz, resourceName)}`;
        case "confirmed": return `${at}: confirmed`;
        case "cancelled": return `${at}: cancelled by ${actorText(e.by)}`;
        case "moved": return `${at}: moved by ${actorText(e.by)} from ${placementText(e.from, tz, resourceName)} to ${placementText(e.to, tz, resourceName)}`;
        default: {
            const never: never = e;
            throw new Error(`Unhandled history entry ${JSON.stringify(never)}`);
        }
    }
}

function sourceText(s: BookingSource): string {
    switch (s.kind) {
        case "visitor": return "booked on the site";
        case "manual": return `added by ${s.adminEmail} (${s.channel})`;
        case "order": return `from order ${s.orderId}`;
        default: {
            const never: never = s;
            throw new Error(`Unhandled source ${JSON.stringify(never)}`);
        }
    }
}

export default function SchedulingAppointmentsBooking() {
    const { bookingId } = useParams();
    const { currentTenant } = useTenant();
    // Review-0 R1: the booking shown, and its actions, belong to the current route's booking only.
    const key = currentTenant && bookingId ? selectionKey([currentTenant.id, bookingId]) : null;
    const loaded = useSelectionData<{ booking: BookingAdminDTO; tz: string; resources: ResourceDTO[] }>(key, async () => {
        const [b, settings, res] = await Promise.all([
            apiRequest(`/scheduling/admin/bookings/${encodeURIComponent(bookingId ?? "")}`),
            apiRequest("/settings"),
            apiRequest("/scheduling/admin/resources"),
        ]);
        return { booking: b, tz: typeof settings.scheduling?.timezone === "string" ? settings.scheduling.timezone : "UTC", resources: res.resources };
    });
    const [actionError, setActionError] = useState<{ key: string; text: string } | null>(null);
    const [moving, setMoving] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function cancel(target: { key: string; booking: BookingAdminDTO }) {
        if (!confirm(`Cancel ${target.booking.ref}? The customer gets the "Cancelled" mail.`)) return;
        setBusy(true);
        setActionError(null);
        try {
            await apiRequest(`/scheduling/admin/bookings/${encodeURIComponent(target.booking.id)}/cancel`, { method: "POST", body: "{}" });
            await loaded.reload();
        } catch (e) {
            setActionError({ key: target.key, text: plannerErrorText(e) });
        } finally {
            setBusy(false);
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    const error = loaded.error ?? (actionError !== null && actionError.key === key ? actionError.text : null);
    const errorBox = error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>;
    if (loaded.data === null || key === null) return <div className="p-8">{errorBox || <Loader2 className="animate-spin" />}</div>;
    const { booking, tz, resources } = loaded.data;
    const target = { key, booking };

    const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? "(removed resource)";
    const what = booking.what;
    let whatText: string;
    let plannerLink: string | null = null;
    switch (what.kind) {
        case "slot":
            whatText = `${what.serviceName}, ${formatWhen(what.start, tz)} – ${formatWhen(what.end, tz)}, with ${what.resourceName ?? "(removed resource)"}`;
            plannerLink = `/scheduling/planner?resource=${encodeURIComponent(what.resourceId)}&week=${mondayOf(instantToLocal(Date.parse(what.start), tz).date)}`;
            break;
        case "seat": whatText = `${what.courseName ?? "(removed course)"}, group starting ${what.firstStart ? formatWhen(what.firstStart, tz) : "(removed group)"}`; break;
        case "unplaced": whatText = `${what.courseName ?? "(removed course)"}, no group yet`; break;
        default: {
            const never: never = what;
            throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
        }
    }
    let stateText: string;
    switch (booking.state.kind) {
        case "held": stateText = `Held until ${formatWhen(booking.state.expiresAt, tz)} (confirmation mail: ${booking.state.mail})`; break;
        case "confirmed": stateText = `Confirmed ${formatWhen(booking.state.at, tz)}`; break;
        case "cancelled": stateText = `Cancelled ${formatWhen(booking.state.at, tz)} by ${actorText(booking.state.by)}`; break;
        default: {
            const never: never = booking.state;
            throw new Error(`Unhandled state ${JSON.stringify(never)}`);
        }
    }

    return (
        <div className="p-8 space-y-6 max-w-3xl">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Booking {booking.ref}</h1>
                <p className="text-muted-foreground">Times in {tz}. {plannerLink && <Link className="underline" to={plannerLink}>Open the week in the planner</Link>}</p>
            </div>
            {errorBox}
            <Card>
                <CardHeader>
                    <CardTitle>{whatText}</CardTitle>
                    <CardDescription>{stateText}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <p>Customer: {booking.who.name} · {booking.who.email}{booking.who.phone ? ` · ${booking.who.phone}` : ""}</p>
                    <p>Source: {sourceText(booking.source)}</p>
                    <div className="flex gap-2 pt-2">
                        {what.kind === "slot" && booking.state.kind === "confirmed" && <Button variant="outline" onClick={() => setMoving(key)}>Move</Button>}
                        {booking.state.kind !== "cancelled" && (
                            <Button variant="outline" onClick={() => cancel(target)} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cancel booking</Button>
                        )}
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader><CardTitle>History</CardTitle><CardDescription>Oldest first; the last 50 changes are kept.</CardDescription></CardHeader>
                <CardContent>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                        {booking.history.map((h, i) => <li key={i}>{historyLine(h, tz, resourceName)}</li>)}
                    </ul>
                </CardContent>
            </Card>
            {moving === key && (
                <AppointmentDialog mode={{ kind: "move", booking, resources }} tz={tz} onClose={() => setMoving(null)}
                    onDone={() => { setMoving(null); void loaded.reload(); }} />
            )}
        </div>
    );
}
