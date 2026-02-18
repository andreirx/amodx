import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, TrendingUp, ShoppingCart, DollarSign, Package, Calendar, Percent } from "lucide-react";

interface KPI {
    totalRevenue: string;
    totalOrders: number;
    avgOrderValue: string;
    deliveredRevenue: string;
    todayRevenue: string;
    todayOrders: number;
    monthRevenue: string;
    monthOrders: number;
    currency: string;
}

interface StatusData { count: number; revenue: number }
interface MonthData { month: string; count: number; revenue: number }
interface ProductData { id: string; title: string; quantity: number; revenue: number }

interface ReportData {
    kpi: KPI;
    byStatus: Record<string, StatusData>;
    byPayment: Record<string, StatusData>;
    revenueByMonth: MonthData[];
    topProducts: ProductData[];
    coupons: { orders: number; discount: string };
}

const STATUS_LABELS: Record<string, string> = {
    placed: "Placed",
    confirmed: "Confirmed",
    prepared: "Prepared",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    annulled: "Annulled",
};

const STATUS_COLORS: Record<string, string> = {
    placed: "bg-blue-100 text-blue-800",
    confirmed: "bg-indigo-100 text-indigo-800",
    prepared: "bg-amber-100 text-amber-800",
    shipped: "bg-purple-100 text-purple-800",
    delivered: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    annulled: "bg-gray-100 text-gray-800",
};

const PAYMENT_LABELS: Record<string, string> = {
    cash_on_delivery: "Cash on Delivery",
    bank_transfer: "Bank Transfer",
};

function fmt(val: string | number, currency: string) {
    return `${Number(val).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function monthLabel(m: string) {
    const [y, mo] = m.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(mo) - 1]} ${y}`;
}

export default function Reports() {
    const { currentTenant } = useTenant();
    const [data, setData] = useState<ReportData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentTenant) loadData();
    }, [currentTenant?.id]);

    async function loadData() {
        setLoading(true);
        try {
            const res = await apiRequest("/reports/summary");
            setData(res);
        } catch (e) {
            console.error("Failed to load reports", e);
        } finally {
            setLoading(false);
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site first.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
    if (!data) return <div className="p-8 text-center text-muted-foreground">Failed to load reports.</div>;

    const { kpi, byStatus, byPayment, revenueByMonth, topProducts, coupons } = data;
    const c = kpi.currency;

    return (
        <div className="p-8 space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
                <p className="text-muted-foreground">Commerce analytics and insights.</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                                <DollarSign className="h-5 w-5 text-green-700" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Total Revenue</p>
                                <p className="text-2xl font-bold">{fmt(kpi.totalRevenue, c)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                                <ShoppingCart className="h-5 w-5 text-blue-700" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Total Orders</p>
                                <p className="text-2xl font-bold">{kpi.totalOrders}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                                <TrendingUp className="h-5 w-5 text-purple-700" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Avg Order Value</p>
                                <p className="text-2xl font-bold">{fmt(kpi.avgOrderValue, c)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                                <Package className="h-5 w-5 text-emerald-700" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Delivered Revenue</p>
                                <p className="text-2xl font-bold">{fmt(kpi.deliveredRevenue, c)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Today + This Month */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
                                <Calendar className="h-5 w-5 text-amber-700" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Today</p>
                                <p className="text-xl font-bold">{fmt(kpi.todayRevenue, c)}</p>
                                <p className="text-xs text-muted-foreground">{kpi.todayOrders} orders</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-100">
                                <Calendar className="h-5 w-5 text-cyan-700" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">This Month</p>
                                <p className="text-xl font-bold">{fmt(kpi.monthRevenue, c)}</p>
                                <p className="text-xs text-muted-foreground">{kpi.monthOrders} orders</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-100">
                                <Percent className="h-5 w-5 text-pink-700" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Coupon Orders</p>
                                <p className="text-xl font-bold">{coupons.orders}</p>
                                <p className="text-xs text-muted-foreground">{fmt(coupons.discount, c)} discounted</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                {/* Orders by Status */}
                <Card>
                    <CardHeader><CardTitle className="text-base">Orders by Status</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Orders</TableHead>
                                    <TableHead className="text-right">Revenue</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Object.entries(byStatus).map(([status, d]) => (
                                    <TableRow key={status}>
                                        <TableCell>
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-800"}`}>
                                                {STATUS_LABELS[status] || status}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right font-medium">{d.count}</TableCell>
                                        <TableCell className="text-right">{fmt(d.revenue, c)}</TableCell>
                                    </TableRow>
                                ))}
                                {Object.keys(byStatus).length === 0 && (
                                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground h-16">No orders yet.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Payment Methods */}
                <Card>
                    <CardHeader><CardTitle className="text-base">Payment Methods</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Method</TableHead>
                                    <TableHead className="text-right">Orders</TableHead>
                                    <TableHead className="text-right">Revenue</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Object.entries(byPayment).map(([method, d]) => (
                                    <TableRow key={method}>
                                        <TableCell className="font-medium">{PAYMENT_LABELS[method] || method}</TableCell>
                                        <TableCell className="text-right">{d.count}</TableCell>
                                        <TableCell className="text-right">{fmt(d.revenue, c)}</TableCell>
                                    </TableRow>
                                ))}
                                {Object.keys(byPayment).length === 0 && (
                                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground h-16">No orders yet.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                {/* Revenue by Month */}
                <Card>
                    <CardHeader><CardTitle className="text-base">Revenue by Month</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Month</TableHead>
                                    <TableHead className="text-right">Orders</TableHead>
                                    <TableHead className="text-right">Revenue</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {revenueByMonth.map(m => (
                                    <TableRow key={m.month}>
                                        <TableCell className="font-medium">{monthLabel(m.month)}</TableCell>
                                        <TableCell className="text-right">{m.count}</TableCell>
                                        <TableCell className="text-right">{fmt(m.revenue, c)}</TableCell>
                                    </TableRow>
                                ))}
                                {revenueByMonth.length === 0 && (
                                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground h-16">No data yet.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Top Products */}
                <Card>
                    <CardHeader><CardTitle className="text-base">Top Products</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product</TableHead>
                                    <TableHead className="text-right">Qty Sold</TableHead>
                                    <TableHead className="text-right">Revenue</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {topProducts.map((p, i) => (
                                    <TableRow key={p.id}>
                                        <TableCell>
                                            <span className="text-xs text-muted-foreground mr-2">#{i + 1}</span>
                                            <span className="font-medium">{p.title}</span>
                                        </TableCell>
                                        <TableCell className="text-right">{p.quantity}</TableCell>
                                        <TableCell className="text-right">{fmt(p.revenue, c)}</TableCell>
                                    </TableRow>
                                ))}
                                {topProducts.length === 0 && (
                                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground h-16">No data yet.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
