import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Edit, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Coupons() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [coupons, setCoupons] = useState<any[]>([]);
    const [statusFilter, setStatusFilter] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentTenant) loadCoupons();
    }, [currentTenant?.id]);

    useEffect(() => {
        if (currentTenant) loadCoupons();
    }, [statusFilter]);

    async function loadCoupons() {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter) params.set("status", statusFilter);
            const qs = params.toString();
            const res = await apiRequest(`/coupons${qs ? `?${qs}` : ""}`);
            setCoupons(res.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm("Are you sure you want to delete this coupon?")) return;
        try {
            await apiRequest(`/coupons/${id}`, { method: "DELETE" });
            loadCoupons();
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
                    <h1 className="text-3xl font-bold tracking-tight">Coupons</h1>
                    <p className="text-muted-foreground">Create discount codes for your customers.</p>
                </div>
                <Button onClick={() => navigate("/coupons/new")}>
                    <Plus className="mr-2 h-4 w-4" /> Add Coupon
                </Button>
            </div>

            <div className="flex gap-3">
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v === "_all" ? "" : v)}>
                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All Statuses</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Code</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Value</TableHead>
                                <TableHead>Min Order</TableHead>
                                <TableHead>Usage</TableHead>
                                <TableHead>Valid Until</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {coupons.map((c) => (
                                <TableRow key={c.id}>
                                    <TableCell>
                                        <span className="font-mono font-medium">{c.code}</span>
                                    </TableCell>
                                    <TableCell>
                                        <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-blue-50 text-blue-700">
                                            {c.type === "percentage" ? "Percentage" : "Fixed Amount"}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        {c.type === "percentage" ? `${c.value}%` : `${c.value} ${currentTenant?.currency || "RON"}`}
                                    </TableCell>
                                    <TableCell>
                                        {c.minOrderAmount ? `${c.minOrderAmount} ${currentTenant?.currency || "RON"}` : "-"}
                                    </TableCell>
                                    <TableCell>
                                        {c.usageCount || 0}{c.usageLimit ? `/${c.usageLimit}` : ""}
                                    </TableCell>
                                    <TableCell>
                                        {c.validUntil || "-"}
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                                            c.status === "active"
                                                ? "bg-green-50 text-green-700"
                                                : c.status === "expired"
                                                ? "bg-gray-100 text-gray-700"
                                                : "bg-red-50 text-red-700"
                                        }`}>
                                            {c.status}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => navigate(`/coupons/${c.id}`)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" onClick={() => handleDelete(c.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {coupons.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                        No coupons yet.
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
