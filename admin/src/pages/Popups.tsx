import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Edit, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

const TYPE_BADGE_COLORS: Record<string, string> = {
    announcement: "bg-blue-50 text-blue-700",
    newsletter: "bg-purple-50 text-purple-700",
    promotion: "bg-amber-50 text-amber-700",
    custom: "bg-slate-100 text-slate-700",
};

export default function Popups() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [popups, setPopups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentTenant) loadPopups();
    }, [currentTenant?.id]);

    async function loadPopups() {
        setLoading(true);
        try {
            const res = await apiRequest("/popups");
            setPopups(res.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm("Are you sure you want to delete this popup?")) return;
        try {
            await apiRequest(`/popups/${id}`, { method: "DELETE" });
            loadPopups();
        } catch (e: any) {
            alert(e.message);
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Popups</h1>
                    <p className="text-muted-foreground">Manage popups for your site visitors.</p>
                </div>
                <Button onClick={() => navigate("/popups/new")}>
                    <Plus className="mr-2 h-4 w-4" /> New Popup
                </Button>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Trigger</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {popups.map((p) => (
                                <TableRow key={p.id}>
                                    <TableCell className="font-medium">{p.name}</TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${TYPE_BADGE_COLORS[p.type] || "bg-gray-100 text-gray-700"}`}>
                                            {p.type}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {p.trigger || "-"}
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                                            p.status === "active"
                                                ? "bg-green-50 text-green-700"
                                                : "bg-gray-100 text-gray-700"
                                        }`}>
                                            {p.status}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "-"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => navigate(`/popups/${p.id}`)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" onClick={() => handleDelete(p.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {popups.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                        No popups yet. Create your first popup to engage visitors.
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
