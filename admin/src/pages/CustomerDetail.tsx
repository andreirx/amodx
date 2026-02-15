import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, Save, Users } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700",
    confirmed: "bg-blue-50 text-blue-700",
    processing: "bg-blue-50 text-blue-700",
    shipped: "bg-purple-50 text-purple-700",
    delivered: "bg-green-50 text-green-700",
    completed: "bg-green-50 text-green-700",
    cancelled: "bg-red-50 text-red-700",
    refunded: "bg-gray-100 text-gray-700",
};

export default function CustomerDetail() {
    const { email } = useParams();
    const navigate = useNavigate();
    const { currentTenant } = useTenant();

    const [customer, setCustomer] = useState<any>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [notes, setNotes] = useState("");
    const [savingNotes, setSavingNotes] = useState(false);

    const decodedEmail = decodeURIComponent(email || "");

    useEffect(() => {
        if (currentTenant && decodedEmail) loadCustomer();
    }, [currentTenant?.id, decodedEmail]);

    async function loadCustomer() {
        setLoading(true);
        try {
            const res = await apiRequest(`/customers/${encodeURIComponent(decodedEmail)}`);
            setCustomer(res.customer);
            setOrders(res.orders || []);
            setNotes(res.customer?.notes || "");
        } catch (e) {
            console.error(e);
            alert("Failed to load customer");
            navigate("/customers");
        } finally {
            setLoading(false);
        }
    }

    async function saveNotes() {
        setSavingNotes(true);
        try {
            await apiRequest(`/customers/${encodeURIComponent(decodedEmail)}`, {
                method: "PUT",
                body: JSON.stringify({ notes }),
            });
        } catch (e: any) {
            alert("Failed to save notes: " + e.message);
        } finally {
            setSavingNotes(false);
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;
    if (!customer) return <div className="p-8">Customer not found.</div>;

    return (
        <div className="p-8 space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/customers")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{customer.name || decodedEmail}</h1>
                    <button
                        onClick={() => navigate("/customers")}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        &larr; Back to Customers
                    </button>
                </div>
            </div>

            {/* Customer Info Card */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-muted-foreground" />
                        Customer Information
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div>
                                <span className="text-sm text-muted-foreground">Name</span>
                                <p className="font-medium">{customer.name || "-"}</p>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Email</span>
                                <p className="font-medium">{customer.email}</p>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Phone</span>
                                <p className="font-medium">{customer.phone || "-"}</p>
                            </div>
                        </div>
                        <div className="space-y-4">
                            {customer.address && (
                                <div>
                                    <span className="text-sm text-muted-foreground">Default Address</span>
                                    <p className="font-medium">
                                        {[customer.address.street, customer.address.city, customer.address.county]
                                            .filter(Boolean)
                                            .join(", ") || "-"}
                                    </p>
                                </div>
                            )}
                            <div>
                                <span className="text-sm text-muted-foreground">Total Spent</span>
                                <p className="font-medium text-lg">
                                    {(customer.totalSpent || 0).toLocaleString("ro-RO", { minimumFractionDigits: 2 })} RON
                                </p>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Total Orders</span>
                                <p className="font-medium">{customer.orderCount || 0}</p>
                            </div>
                        </div>
                    </div>

                    <div className="border-t pt-4 space-y-3">
                        <Label>Admin Notes</Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={4}
                            placeholder="Internal notes about this customer..."
                        />
                        <Button onClick={saveNotes} disabled={savingNotes} size="sm">
                            {savingNotes ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Save className="mr-2 h-4 w-4" />
                            )}
                            Save Notes
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Orders Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Order History</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Order #</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Total</TableHead>
                                <TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {orders.map((o) => (
                                <TableRow
                                    key={o.id}
                                    className="cursor-pointer"
                                    onClick={() => navigate(`/orders/${o.id}`)}
                                >
                                    <TableCell className="font-medium font-mono text-sm">
                                        {o.orderNumber || o.id?.slice(0, 8)}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {o.createdAt
                                            ? new Date(o.createdAt).toLocaleDateString("ro-RO")
                                            : "-"}
                                    </TableCell>
                                    <TableCell className="text-sm font-medium">
                                        {(o.total || 0).toLocaleString("ro-RO", { minimumFractionDigits: 2 })} RON
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium capitalize ${
                                            STATUS_COLORS[o.status] || "bg-gray-100 text-gray-700"
                                        }`}>
                                            {o.status}
                                        </span>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {orders.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                        No orders found for this customer.
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
