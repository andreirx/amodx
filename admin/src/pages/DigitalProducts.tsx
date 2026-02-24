import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, FileBox, Edit, Trash2, Link2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function DigitalProducts() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [products, setProducts] = useState<any[]>([]);
    const [statusFilter, setStatusFilter] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentTenant) loadProducts();
    }, [currentTenant?.id, statusFilter]);

    async function loadProducts() {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter) params.set("status", statusFilter);
            const qs = params.toString();
            const res = await apiRequest(`/products${qs ? `?${qs}` : ""}`);
            // Client-filter: digital products have productType=digital OR legacy paymentLinkId
            const all = res.items || [];
            setProducts(all.filter((p: any) => p.productType === "digital" || p.paymentLinkId));
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm("Are you sure you want to delete this digital product?")) return;
        try {
            await apiRequest(`/products/${id}`, { method: "DELETE" });
            loadProducts();
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
                    <h1 className="text-3xl font-bold tracking-tight">Digital Products</h1>
                    <p className="text-muted-foreground">Manage digital products sold via Paddle. Pricing and currency are managed in your Paddle dashboard.</p>
                </div>
                <Button onClick={() => navigate("/digital-products/new")}>
                    <Plus className="mr-2 h-4 w-4" /> Add Digital Product
                </Button>
            </div>

            <div className="flex gap-3">
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v === "_all" ? "" : v)}>
                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All Statuses</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Image</TableHead>
                                <TableHead>Product</TableHead>
                                <TableHead>Paddle Link ID</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Resource</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {products.map((p) => (
                                <TableRow key={p.id}>
                                    <TableCell>
                                        {p.imageLink ? (
                                            <img src={p.imageLink} className="w-10 h-10 rounded object-cover border" alt="" />
                                        ) : (
                                            <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                                <FileBox className="w-4 h-4 text-muted-foreground" />
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <span className="font-medium">{p.title}</span>
                                    </TableCell>
                                    <TableCell>
                                        {p.paymentLinkId ? (
                                            <span className="inline-flex items-center gap-1 text-sm font-mono text-green-700">
                                                <Link2 className="h-3 w-3" /> {p.paymentLinkId}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">Not configured</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                                            p.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-700'
                                        }`}>
                                            {p.status}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        {p.resourceId ? (
                                            <span className="inline-flex items-center gap-1 text-sm text-blue-600">
                                                <FileBox className="h-3 w-3" /> Linked
                                            </span>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">None</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => navigate(`/digital-products/${p.id}`)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" onClick={() => handleDelete(p.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {products.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                        No digital products found. Create your first one!
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
