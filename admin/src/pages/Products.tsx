import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, ShoppingBag, Edit, Trash2, FileBox } from "lucide-react"; // Import FileBox
import { useNavigate } from "react-router-dom";

export default function Products() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentTenant) loadProducts();
    }, [currentTenant?.id]);

    async function loadProducts() {
        setLoading(true);
        try {
            const res = await apiRequest("/products");
            setProducts(res.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm("Are you sure? This will break AI feeds referencing this product.")) return;
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
                    <h1 className="text-3xl font-bold tracking-tight">Products</h1>
                    <p className="text-muted-foreground">Manage your AI-ready inventory.</p>
                </div>
                <Button onClick={() => navigate("/products/new")}>
                    <Plus className="mr-2 h-4 w-4" /> Add Product
                </Button>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Image</TableHead>
                                <TableHead>Product</TableHead>
                                <TableHead>Price</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Inventory</TableHead>
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
                                                <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{p.title}</span>
                                                {/* NEW: Digital Product Indicator */}
                                                {p.resourceId && (
                                                    <span className="inline-flex items-center rounded-md bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10">
                                                        <FileBox className="mr-1 h-3 w-3" /> Digital
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                                                {p.category || "Uncategorized"}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {p.salePrice ? (
                                            <div className="flex flex-col text-sm">
                                                <span className="text-red-600 font-bold">{p.salePrice} {p.currency}</span>
                                                <span className="line-through text-muted-foreground text-xs">{p.price}</span>
                                            </div>
                                        ) : (
                                            <span>{p.price} {p.currency}</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                                            p.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-700'
                                        }`}>
                                            {p.status}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {p.availability === 'in_stock' ? (
                                            <span className="text-green-600">In Stock ({p.inventoryQuantity || '-'})</span>
                                        ) : (
                                            <span className="text-amber-600 capitalize">{p.availability.replace('_', ' ')}</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => navigate(`/products/${p.id}`)}>
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
                                        No products found. Create your first one!
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
