import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

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
                                <TableHead>Context</TableHead>
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
                                    <TableCell className="text-xs font-mono text-muted-foreground max-w-[200px] truncate">
                                        {/* Show resource ID if they downloaded something */}
                                        {lead.resourceId ? `Downloaded: ${lead.resourceId}` : JSON.stringify(lead.data)}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {leads.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
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
