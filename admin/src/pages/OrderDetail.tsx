import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ArrowLeft, Package, User, MapPin, CreditCard, Truck, Clock, Save } from "lucide-react";

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
    pending: "Placed", // backward compat
    confirmed: "Confirmed",
    prepared: "Prepared",
    processing: "Prepared", // backward compat
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    annulled: "Annulled",
};

const PAYMENT_STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700",
    paid: "bg-green-50 text-green-700",
    refunded: "bg-orange-50 text-orange-700",
};

const PAYMENT_LABELS: Record<string, string> = {
    cash_on_delivery: "COD",
    bank_transfer: "Bank",
};

const ALL_STATUSES = ["placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled"];

export default function OrderDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentTenant } = useTenant();

    const [order, setOrder] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Status management
    const [newStatus, setNewStatus] = useState("");
    const [statusNote, setStatusNote] = useState("");
    const [updatingStatus, setUpdatingStatus] = useState(false);

    // Tracking management
    const [trackingNumber, setTrackingNumber] = useState("");
    const [savingTracking, setSavingTracking] = useState(false);

    useEffect(() => {
        if (currentTenant && id) loadOrder();
    }, [currentTenant?.id, id]);

    async function loadOrder() {
        setLoading(true);
        setError("");
        try {
            const data = await apiRequest(`/orders/${id}`);
            setOrder(data);
            setNewStatus(data.status || "pending");
            setTrackingNumber(data.trackingNumber || "");
        } catch (e: any) {
            setError(e.message || "Failed to load order.");
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleUpdateStatus() {
        setUpdatingStatus(true);
        try {
            await apiRequest(`/orders/${id}/status`, {
                method: "PUT",
                body: JSON.stringify({ status: newStatus, note: statusNote }),
            });
            setStatusNote("");
            await loadOrder();
        } catch (e: any) {
            alert("Failed to update status: " + e.message);
        } finally {
            setUpdatingStatus(false);
        }
    }

    async function handleSaveTracking() {
        setSavingTracking(true);
        try {
            await apiRequest(`/orders/${id}`, {
                method: "PUT",
                body: JSON.stringify({ trackingNumber }),
            });
            await loadOrder();
        } catch (e: any) {
            alert("Failed to save tracking: " + e.message);
        } finally {
            setSavingTracking(false);
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;
    if (error) return (
        <div className="p-8 space-y-4">
            <p className="text-red-600">{error}</p>
            <Button variant="outline" onClick={() => navigate("/orders")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Orders
            </Button>
        </div>
    );
    if (!order) return null;

    const customer = order.customer || {};
    const shipping = order.shippingAddress || {};
    const items = order.items || [];
    const statusHistory = order.statusHistory || [];

    const subtotal = items.reduce((sum: number, item: any) => {
        const price = parseFloat(item.unitPrice || item.price || 0);
        const qty = item.quantity || item.qty || 1;
        return sum + price * qty;
    }, 0);

    return (
        <div className="p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/orders")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Package className="h-7 w-7" />
                        Order {order.orderNumber || order.id?.slice(0, 8)}
                    </h1>
                    <p className="text-muted-foreground">
                        Placed on {order.createdAt ? new Date(order.createdAt).toLocaleDateString(currentTenant?.locale || "en-US") : "-"}
                    </p>
                </div>
                <span className={`ml-auto inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>
                    {STATUS_LABELS[order.status] || order.status}
                </span>
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Items + Totals (2/3) */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Items Table */}
                    <Card>
                        <CardHeader><CardTitle>Order Items</CardTitle></CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Image</TableHead>
                                        <TableHead>Product</TableHead>
                                        <TableHead className="text-center">Qty</TableHead>
                                        <TableHead className="text-right">Unit Price</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.map((item: any, i: number) => {
                                        const price = parseFloat(item.unitPrice || item.price || 0);
                                        const qty = item.quantity || item.qty || 1;
                                        const lineTotal = price * qty;
                                        return (
                                            <TableRow key={item.id || i}>
                                                <TableCell>
                                                    {item.imageLink || item.image ? (
                                                        <img src={item.imageLink || item.image} className="w-10 h-10 rounded object-cover border" alt="" />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                                            <Package className="w-4 h-4 text-muted-foreground" />
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{item.title || item.name || "-"}</span>
                                                        {item.personalizations && item.personalizations.length > 0 && (
                                                            <div className="mt-1 space-y-0.5">
                                                                {item.personalizations.map((p: any, pi: number) => (
                                                                    <p key={pi} className="text-xs text-muted-foreground">
                                                                        {p.label}: {p.value}
                                                                    </p>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">{qty}</TableCell>
                                                <TableCell className="text-right">{price.toFixed(2)} {order.currency || "USD"}</TableCell>
                                                <TableCell className="text-right font-medium">{lineTotal.toFixed(2)} {order.currency || "USD"}</TableCell>
                                            </TableRow>
                                        );
                                    })}
                                    {items.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-16 text-center text-muted-foreground">
                                                No items in this order.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    {/* Order Totals */}
                    <Card>
                        <CardHeader><CardTitle>Order Totals</CardTitle></CardHeader>
                        <CardContent>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Subtotal</span>
                                    <span>{subtotal.toFixed(2)} {order.currency || "USD"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Shipping</span>
                                    <span>{parseFloat(order.shippingCost || 0).toFixed(2)} {order.currency || "USD"}</span>
                                </div>
                                {(order.discount || order.discountAmount) && (
                                    <div className="flex justify-between text-red-600">
                                        <span>Discount</span>
                                        <span>-{parseFloat(order.discount || order.discountAmount || 0).toFixed(2)} {order.currency || "USD"}</span>
                                    </div>
                                )}
                                <div className="border-t pt-2 flex justify-between font-bold text-base">
                                    <span>Total</span>
                                    <span>{parseFloat(order.total || order.totalAmount || 0).toFixed(2)} {order.currency || "USD"}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Sidebar Cards (1/3) */}
                <div className="space-y-6">
                    {/* Customer Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <User className="h-4 w-4" /> Customer
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <p className="font-medium">{customer.name || order.customerName || "-"}</p>
                            {(customer.email || order.customerEmail) && (
                                <p>
                                    <a
                                        href={`/customers/${encodeURIComponent(customer.email || order.customerEmail)}`}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            navigate(`/customers/${encodeURIComponent(customer.email || order.customerEmail)}`);
                                        }}
                                        className="text-blue-600 hover:underline"
                                    >
                                        {customer.email || order.customerEmail}
                                    </a>
                                </p>
                            )}
                            {(customer.phone || order.customerPhone) && (
                                <p className="text-muted-foreground">{customer.phone || order.customerPhone}</p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Shipping Address Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <MapPin className="h-4 w-4" /> Shipping Address
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1 text-sm">
                            {shipping.street && <p>{shipping.street}</p>}
                            {(shipping.city || shipping.county) && (
                                <p>{[shipping.city, shipping.county].filter(Boolean).join(", ")}</p>
                            )}
                            {shipping.postalCode && <p>{shipping.postalCode}</p>}
                            {shipping.deliveryNotes && (
                                <div className="mt-3 pt-2 border-t">
                                    <p className="text-xs text-muted-foreground mb-1">Delivery Notes</p>
                                    <p className="text-sm">{shipping.deliveryNotes}</p>
                                </div>
                            )}
                            {!shipping.street && !shipping.city && (
                                <p className="text-muted-foreground">No shipping address provided.</p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Payment Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <CreditCard className="h-4 w-4" /> Payment
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Method</span>
                                <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700">
                                    {PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod || "-"}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Payment Status</span>
                                <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${PAYMENT_STATUS_COLORS[order.paymentStatus] || "bg-gray-100 text-gray-700"}`}>
                                    {order.paymentStatus || "pending"}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Order #</span>
                                <span className="font-mono text-xs">{order.orderNumber || order.id?.slice(0, 8)}</span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Status Management Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Clock className="h-4 w-4" /> Status Management
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Current:</span>
                                <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>
                                    {STATUS_LABELS[order.status] || order.status}
                                </span>
                            </div>
                            <Select value={newStatus} onValueChange={setNewStatus}>
                                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                                <SelectContent>
                                    {ALL_STATUSES.map(s => (
                                        <SelectItem key={s} value={s}>{STATUS_LABELS[s] || s}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Textarea
                                placeholder="Status note (optional)..."
                                value={statusNote}
                                onChange={e => setStatusNote(e.target.value)}
                                rows={3}
                            />
                            <Button
                                className="w-full"
                                onClick={handleUpdateStatus}
                                disabled={updatingStatus || newStatus === order.status}
                            >
                                {updatingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Update Status
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Tracking Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Truck className="h-4 w-4" /> Tracking
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <Input
                                placeholder="Tracking number..."
                                value={trackingNumber}
                                onChange={e => setTrackingNumber(e.target.value)}
                            />
                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={handleSaveTracking}
                                disabled={savingTracking}
                            >
                                {savingTracking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Save Tracking
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Status History Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Clock className="h-4 w-4" /> Status History
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {statusHistory.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No status history yet.</p>
                            ) : (
                                <div className="space-y-4">
                                    {[...statusHistory].reverse().map((entry: any, i: number) => (
                                        <div key={i} className="relative pl-6 pb-4 last:pb-0">
                                            {/* Timeline line */}
                                            {i < statusHistory.length - 1 && (
                                                <div className="absolute left-[9px] top-3 bottom-0 w-px bg-border" />
                                            )}
                                            {/* Timeline dot */}
                                            <div className={`absolute left-0 top-1 w-[18px] h-[18px] rounded-full border-2 border-background ${STATUS_COLORS[entry.status]?.split(" ")[0] || "bg-gray-200"}`} />
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status] || "bg-gray-100 text-gray-700"}`}>
                                                        {STATUS_LABELS[entry.status] || entry.status}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {entry.timestamp ? new Date(entry.timestamp).toLocaleDateString(currentTenant?.locale || "en-US", {
                                                            day: "2-digit",
                                                            month: "2-digit",
                                                            year: "numeric",
                                                            hour: "2-digit",
                                                            minute: "2-digit",
                                                        }) : "-"}
                                                    </span>
                                                </div>
                                                {entry.note && (
                                                    <p className="text-sm text-muted-foreground mt-1">{entry.note}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
