import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Loader2, Activity, User, FileText, Settings, ShoppingBag, Terminal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// Action -> Icon/Color Map
const ACTION_MAP: Record<string, { icon: any, color: string, label: string }> = {
    "CREATE_PAGE": { icon: FileText, color: "text-green-600 bg-green-100", label: "Created Page" },
    "UPDATE_PAGE": { icon: FileText, color: "text-blue-600 bg-blue-100", label: "Updated Page" },
    "TENANT_SETTINGS": { icon: Settings, color: "text-slate-600 bg-slate-100", label: "Updated Settings" },
    "CREATE_PRODUCT": { icon: ShoppingBag, color: "text-purple-600 bg-purple-100", label: "Created Product" },
    "UPDATE_PRODUCT": { icon: ShoppingBag, color: "text-purple-600 bg-purple-100", label: "Updated Product" },
    "UPLOAD_ASSET": { icon: Activity, color: "text-orange-600 bg-orange-100", label: "Uploaded Asset" },
    "DEFAULT": { icon: Terminal, color: "text-gray-600 bg-gray-100", label: "System Event" }
};

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

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-indigo-50 rounded-lg">
                    <Activity className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
                    <p className="text-muted-foreground">Track changes and security events.</p>
                </div>
            </div>

            <Card>
                <CardHeader className="border-b bg-muted/20">
                    <CardTitle className="text-lg">Activity Feed</CardTitle>
                    <CardDescription>Real-time log of actions performed on {currentTenant.name}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y">
                        {logs.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">No logs found.</div>
                        ) : (
                            logs.map((log) => {
                                const meta = ACTION_MAP[log.action] || ACTION_MAP["DEFAULT"];
                                const Icon = meta.icon;
                                const date = new Date(log.createdAt); // Use createdAt, NOT timestamp

                                return (
                                    <div key={log.id} className="flex items-start gap-4 p-4 hover:bg-muted/50 transition-colors">
                                        {/* Icon */}
                                        <div className={`mt-1 p-2 rounded-full shrink-0 ${meta.color}`}>
                                            <Icon className="w-4 h-4" />
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start">
                                                <p className="text-sm font-medium text-foreground">
                                                    {meta.label}
                                                    {log.entityTitle && <span className="font-bold ml-1">"{log.entityTitle}"</span>}
                                                </p>
                                                <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                                                    {date.toLocaleDateString()} {date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                </span>
                                            </div>

                                            {/* Details */}
                                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                                <User className="w-3 h-3" />
                                                <span className="font-mono">{log.actorEmail || log.actorId}</span>
                                                <span className="text-gray-300">•</span>
                                                <span>{log.ip || "IP Hidden"}</span>
                                            </div>

                                            {/* JSON Details (Collapsible in V2, inline for now) */}
                                            {log.details && Object.keys(log.details).length > 0 && (
                                                <div className="mt-2 text-xs font-mono bg-muted/50 p-2 rounded border truncate opacity-70 hover:opacity-100 transition-opacity">
                                                    {JSON.stringify(log.details)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
