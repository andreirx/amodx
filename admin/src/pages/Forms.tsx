import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Edit, FileText, Inbox } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Forms() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [forms, setForms] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentTenant) loadForms();
    }, [currentTenant?.id]);

    async function loadForms() {
        setLoading(true);
        try {
            const res = await apiRequest("/forms");
            setForms(res.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Forms</h1>
                    <p className="text-muted-foreground">Create and manage contact forms for your website.</p>
                </div>
                <Button onClick={() => navigate("/forms/new")}>
                    <Plus className="mr-2 h-4 w-4" /> New Form
                </Button>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Slug</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {forms.map((form) => (
                                <TableRow key={form.id}>
                                    <TableCell>
                                        <span className="font-medium">{form.name}</span>
                                    </TableCell>
                                    <TableCell>
                                        <span className="font-mono text-sm text-muted-foreground">{form.slug}</span>
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                                            form.status === "active"
                                                ? "bg-green-50 text-green-700"
                                                : "bg-gray-100 text-gray-700"
                                        }`}>
                                            {form.status}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {form.createdAt ? new Date(form.createdAt).toLocaleDateString() : "-"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => navigate(`/forms/${form.id}/submissions`)}>
                                                <Inbox className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => navigate(`/forms/${form.id}`)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {forms.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                        <div className="flex flex-col items-center gap-2">
                                            <FileText className="h-8 w-8 text-muted-foreground/50" />
                                            No forms yet. Create your first one!
                                        </div>
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
