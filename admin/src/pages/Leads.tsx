import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewsletterSubscriptionSchema, newsletterCanSendAgain, type NewsletterPush, type NewsletterSubscription } from "@amodx/shared";

/**
 * NEWSLETTER-1 — the push state of a lead's newsletter subscription, in words for the owner. Exhaustive over the
 * states and the failure reasons: a new one must be worded here. The 422 wording follows MailerLite's documentation
 * (invalid data; also a person who unsubscribed in MailerLite earlier — AMODX does not re-subscribe them).
 */
export function newsletterPushText(push: NewsletterPush): string {
    switch (push.state) {
        case "NoSettings": return "Not sent: MailerLite was not connected";
        case "Pending": return "Pending: no MailerLite result is stored — use Send again";
        case "Sent": return `Sent to MailerLite ${new Date(push.at).toLocaleString()}`;
        case "Failed": {
            const reason = push.reason;
            switch (reason.kind) {
                case "http":
                    return reason.status === 401 ? "Failed: MailerLite refused the API token (401)"
                        : reason.status === 422 ? "Failed: MailerLite refused the address, or the person unsubscribed there (422)"
                        : reason.status === 429 ? "Failed: too many requests to MailerLite (429)"
                        : `Failed: MailerLite answered ${reason.status}`;
                case "timeout": return "Failed: no answer from MailerLite in time";
                case "network": return "Failed: could not reach MailerLite";
                default: {
                    const unreachable: never = reason;
                    return unreachable;
                }
            }
        }
        default: {
            const unreachable: never = push;
            return unreachable;
        }
    }
}

/** The lead's subscription from GET /leads (`newsletter`), or null when it has none or it is not readable. */
export function subscriptionOf(lead: { newsletter?: unknown }): NewsletterSubscription | null {
    const parsed = NewsletterSubscriptionSchema.safeParse(lead.newsletter);
    return parsed.success ? parsed.data : null;
}

export default function Leads() {
    const { currentTenant } = useTenant();
    const [leads, setLeads] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentTenant) loadLeads();
    }, [currentTenant?.id]);

    async function loadLeads() {
        setLoading(true);
        try {
            const res = await apiRequest("/leads");
            setLeads(res.items);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    // NEWSLETTER-1 (ruling 10): "Send again" — POST /leads/{email}/push. Its answer (`resultWrite`: recorded | unconfirmed)
    // is not shown; the page reloads the list, because the STORED state is the only truth (NL1-WRITE-ACK-UNCERTAINTY = A).
    const [sending, setSending] = useState<string | null>(null);
    async function sendAgain(email: string) {
        setSending(email);
        try {
            await apiRequest(`/leads/${encodeURIComponent(email)}/push`, { method: "POST" });
            await loadLeads();
        } catch (e: any) {
            alert(e?.message || "Send again failed");
        } finally {
            setSending(null);
        }
    }

    async function deleteLead(email: string) {
        if (!confirm(`Delete lead ${email}?`)) return;
        try {
            await apiRequest(`/leads/${encodeURIComponent(email)}`, { method: "DELETE" });
            setLeads(leads.filter(l => l.email !== email));
        } catch (e) {
            console.error(e);
            alert("Failed to delete lead");
        }
    }

    const exportCsv = () => {
        const headers = ["Email", "Name", "Status", "Source", "Date", "Data"];
        const rows = leads.map(l => [
            l.email,
            l.name || "",
            l.status,
            l.source || "Website",
            new Date(l.createdAt).toLocaleDateString(),
            JSON.stringify(l.data || {}).replace(/"/g, '""') // Escape quotes
        ]);

        const csvContent = [headers.join(","), ...rows.map(r => `"${r.join('","')}"`)].join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `leads-${currentTenant?.id}.csv`;
        a.click();
    };

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Leads & Contacts</h1>
                    <p className="text-muted-foreground">People who have reached out or downloaded resources.</p>
                </div>
                <Button variant="outline" onClick={exportCsv}>
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Contact</TableHead>
                                <TableHead>Source</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Newsletter</TableHead>
                                <TableHead>Context</TableHead>
                                <TableHead className="w-[60px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {leads.map((lead) => (
                                <TableRow key={lead.id}>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{lead.email}</span>
                                            {lead.name && <span className="text-xs text-muted-foreground">{lead.name}</span>}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                            {lead.source || "Website"}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-sm capitalize">{lead.status}</span>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {new Date(lead.createdAt).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell className="text-xs max-w-[240px]">
                                        {(() => {
                                            const sub = subscriptionOf(lead);
                                            if (!sub) return <span className="text-muted-foreground">—</span>;
                                            return (
                                                <div className="flex flex-col gap-1">
                                                    <span title={sub.consent.text}>Consent {new Date(sub.consent.at).toLocaleString()} ({sub.consent.locale})</span>
                                                    <span className="text-muted-foreground">{newsletterPushText(sub.push)}</span>
                                                    {newsletterCanSendAgain(sub.push) && (
                                                        <Button variant="outline" size="sm" className="h-7 w-fit" disabled={sending === lead.email} onClick={() => sendAgain(lead.email)}>
                                                            {sending === lead.email ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send again"}
                                                        </Button>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </TableCell>
                                    <TableCell className="text-xs font-mono text-muted-foreground max-w-[200px] truncate">
                                        {/* Show resource ID if they downloaded something */}
                                        {lead.resourceId ? `Downloaded: ${lead.resourceId}` : JSON.stringify(lead.data)}
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                            onClick={() => deleteLead(lead.email)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {leads.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                        No leads yet. Check your forms!
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
