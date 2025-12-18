import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Loader2, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function AuditLog() {
    const { currentTenant } = useTenant();
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (currentTenant) fetchLogs();
    }, [currentTenant?.id]);

    async function fetchLogs() {
        setLoading(true);
        try {
            const res = await apiRequest("/audit");
            setLogs(res.items);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    if (!currentTenant) return (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] text-muted-foreground">
            <Activity className="h-10 w-10 mb-4 opacity-20" />
            <p>Select a site to view logs.</p>
        </div>
    );

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center gap-2">
                <Activity className="h-6 w-6 text-muted-foreground" />
                <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>System Activity</CardTitle>
                    <CardDescription>Track changes made to your site.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[180px]">Timestamp</TableHead>
                                    <TableHead>Action</TableHead>
                                    <TableHead>User ID</TableHead>
                                    <TableHead>Details</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {logs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">No logs found.</TableCell>
                                    </TableRow>
                                ) : (
                                    logs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="font-mono text-xs">
                                                {new Date(log.timestamp).toLocaleString()}
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">
                                                    {log.action}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground font-mono">
                                                {log.actorId}
                                            </TableCell>
                                            <TableCell className="text-xs font-mono text-muted-foreground max-w-[300px] truncate">
                                                {JSON.stringify(log.details)}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
