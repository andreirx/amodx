import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ArrowLeft, Inbox } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
    new: "bg-blue-50 text-blue-700",
    read: "bg-gray-100 text-gray-700",
    archived: "bg-gray-50 text-gray-400",
};

export default function FormSubmissions() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentTenant } = useTenant();

    const [form, setForm] = useState<any>(null);
    const [submissions, setSubmissions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (currentTenant && id) loadData();
    }, [currentTenant?.id, id]);

    async function loadData() {
        setLoading(true);
        setError("");
        try {
            const [formData, submissionsData] = await Promise.all([
                apiRequest(`/forms/${id}`),
                apiRequest(`/forms/${id}/submissions`),
            ]);
            setForm(formData);
            setSubmissions(submissionsData.items || []);
        } catch (e: any) {
            setError(e.message || "Failed to load submissions.");
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;
    if (error) return (
        <div className="p-8 space-y-4">
            <p className="text-red-600">{error}</p>
            <Button variant="outline" onClick={() => navigate("/forms")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Forms
            </Button>
        </div>
    );

    const formFields: Array<{ id: string; label: string; type: string }> = form?.fields || [];

    return (
        <div className="p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate(`/forms/${id}`)}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">
                        {form?.name || "Form"} - Submissions
                    </h1>
                    <p className="text-muted-foreground">
                        {submissions.length} submission{submissions.length !== 1 ? "s" : ""}
                    </p>
                </div>
                <div className="ml-auto flex gap-2">
                    <Button variant="outline" onClick={() => navigate(`/forms/${id}`)}>
                        Back to Form
                    </Button>
                </div>
            </div>

            {/* Submissions Table */}
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Status</TableHead>
                                {formFields.map(field => (
                                    <TableHead key={field.id}>{field.label}</TableHead>
                                ))}
                                <TableHead>Email</TableHead>
                                <TableHead>Submitted At</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {submissions.map((sub) => {
                                const data = sub.data || {};
                                return (
                                    <TableRow key={sub.id}>
                                        <TableCell>
                                            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                                                STATUS_COLORS[sub.status] || "bg-gray-100 text-gray-700"
                                            }`}>
                                                {sub.status || "new"}
                                            </span>
                                        </TableCell>
                                        {formFields.map(field => (
                                            <TableCell key={field.id} className="text-sm max-w-[200px] truncate">
                                                {data[field.id] !== undefined
                                                    ? field.type === "checkbox"
                                                        ? data[field.id] ? "Yes" : "No"
                                                        : String(data[field.id])
                                                    : (data[field.label] !== undefined
                                                        ? String(data[field.label])
                                                        : "-"
                                                    )
                                                }
                                            </TableCell>
                                        ))}
                                        <TableCell className="text-sm">
                                            {sub.submitterEmail ? (
                                                <span className="text-blue-600">{sub.submitterEmail}</span>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                            {sub.createdAt
                                                ? new Date(sub.createdAt).toLocaleString()
                                                : "-"
                                            }
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                            {submissions.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={formFields.length + 3}
                                        className="h-24 text-center text-muted-foreground"
                                    >
                                        <div className="flex flex-col items-center gap-2">
                                            <Inbox className="h-8 w-8 text-muted-foreground/50" />
                                            No submissions yet.
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
