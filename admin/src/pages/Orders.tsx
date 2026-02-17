import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Package, Eye, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

const STATUS_COLORS: Record<string, string> = {
    placed: "bg-yellow-50 text-yellow-700",
    pending: "bg-yellow-50 text-yellow-700", // backward compat
    confirmed: "bg-blue-50 text-blue-700",
    prepared: "bg-indigo-50 text-indigo-700",
    processing: "bg-indigo-50 text-indigo-700", // backward compat
    shipped: "bg-purple-50 text-purple-700",
    delivered: "bg-green-50 text-green-700",
    cancelled: "bg-red-50 text-red-700",
    annulled: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<string, string> = {
    placed: "Placed",
    pending: "Placed",
    confirmed: "Confirmed",
    prepared: "Prepared",
    processing: "Prepared",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    annulled: "Annulled",
};

const PAYMENT_LABELS: Record<string, string> = {
    cash_on_delivery: "COD",
    bank_transfer: "Bank",
};

export default function Orders() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("");
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        if (currentTenant) loadOrders();
    }, [currentTenant?.id]);

    useEffect(() => {
        if (currentTenant) loadOrders();
    }, [statusFilter, searchQuery]);

    async function loadOrders() {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter) params.set("status", statusFilter);
            if (searchQuery) params.set("search", searchQuery);
            const qs = params.toString();
            const res = await apiRequest(`/orders${qs ? `?${qs}` : ""}`);
            setOrders(res.items || []);
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
                    <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
                    <p className="text-muted-foreground">Manage customer orders.</p>
                </div>
            </div>

            <div className="flex gap-3">
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v === "_all" ? "" : v)}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All Statuses</SelectItem>
                        <SelectItem value="placed">Placed</SelectItem>
                        <SelectItem value="confirmed">Confirmed</SelectItem>
                        <SelectItem value="prepared">Prepared</SelectItem>
                        <SelectItem value="shipped">Shipped</SelectItem>
                        <SelectItem value="delivered">Delivered</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                        <SelectItem value="annulled">Annulled</SelectItem>
                    </SelectContent>
                </Select>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        className="pl-9 w-[280px]"
                        placeholder="Search by customer name or email..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Order #</TableHead>
                                <TableHead>Customer</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Items</TableHead>
                                <TableHead>Total</TableHead>
                                <TableHead>Payment</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {orders.map((o) => (
                                <TableRow
                                    key={o.id}
                                    className="cursor-pointer"
                                    onClick={() => navigate(`/orders/${o.id}`)}
                                >
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            <Package className="h-4 w-4 text-muted-foreground" />
                                            {o.orderNumber || o.id?.slice(0, 8)}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{o.customer?.name || o.customerName || "-"}</span>
                                            <span className="text-xs text-muted-foreground">{o.customer?.email || o.customerEmail || ""}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {o.createdAt ? new Date(o.createdAt).toLocaleDateString("ro-RO") : "-"}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {o.items?.length || 0}
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        {o.total || o.totalAmount || "-"} {o.currency || "RON"}
                                    </TableCell>
                                    <TableCell>
                                        <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700">
                                            {PAYMENT_LABELS[o.paymentMethod] || o.paymentMethod || "-"}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${STATUS_COLORS[o.status] || "bg-gray-100 text-gray-700"}`}>
                                            {STATUS_LABELS[o.status] || o.status}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                navigate(`/orders/${o.id}`);
                                            }}
                                        >
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {orders.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                        No orders yet.
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
