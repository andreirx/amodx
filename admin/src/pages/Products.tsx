import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, ShoppingBag, Edit, Trash2, FileBox, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Products() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [products, setProducts] = useState<any[]>([]);
    const [categories, setCategories] = useState<any[]>([]);
    const [statusFilter, setStatusFilter] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("");
    const [loading, setLoading] = useState(true);
    const [showImport, setShowImport] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<any>(null);

    useEffect(() => {
        if (currentTenant) {
            loadProducts();
            loadCategories();
        }
    }, [currentTenant?.id]);

    useEffect(() => {
        if (currentTenant) loadProducts();
    }, [statusFilter, categoryFilter]);

    async function loadProducts() {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter) params.set("status", statusFilter);
            if (categoryFilter) params.set("category", categoryFilter);
            const qs = params.toString();
            const res = await apiRequest(`/products${qs ? `?${qs}` : ""}`);
            setProducts(res.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function loadCategories() {
        try {
            const res = await apiRequest("/categories");
            setCategories(res.items || []);
        } catch (e) {
            console.error(e);
        }
    }

    const categoryMap = Object.fromEntries(categories.map((c: any) => [c.id, c.name]));

    async function handleDelete(id: string) {
        if (!confirm("Are you sure? This will break AI feeds referencing this product.")) return;
        try {
            await apiRequest(`/products/${id}`, { method: "DELETE" });
            loadProducts();
        } catch (e: any) {
            alert(e.message);
        }
    }

    async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        setImportResult(null);
        try {
            const csvContent = await file.text();
            const res = await apiRequest("/import/woocommerce", {
                method: "POST",
                body: JSON.stringify({ csvContent, currency: "RON" }),
            });
            setImportResult(res);
            loadProducts();
        } catch (err: any) {
            setImportResult({ error: err.message });
        } finally {
            setImporting(false);
            e.target.value = "";
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
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowImport(!showImport)}>
                        <Upload className="mr-2 h-4 w-4" /> Import CSV
                    </Button>
                    <Button onClick={() => navigate("/products/new")}>
                        <Plus className="mr-2 h-4 w-4" /> Add Product
                    </Button>
                </div>
            </div>

            {showImport && (
                <Card>
                    <CardContent className="p-4 space-y-3">
                        <div>
                            <h3 className="font-medium text-sm">WooCommerce CSV Import</h3>
                            <p className="text-xs text-muted-foreground">Upload a WooCommerce product export CSV. Categories will be created automatically.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Label htmlFor="csv-import" className="cursor-pointer">
                                <div className="flex items-center gap-2 border rounded-md px-4 py-2 text-sm hover:bg-muted transition-colors">
                                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                    {importing ? "Importing..." : "Choose CSV File"}
                                </div>
                            </Label>
                            <Input id="csv-import" type="file" accept=".csv" onChange={handleImport} disabled={importing} className="hidden" />
                        </div>
                        {importResult && (
                            <div className={`text-sm p-3 rounded-md ${importResult.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                                {importResult.error ? importResult.error : importResult.message}
                                {importResult.errors?.length > 0 && (
                                    <details className="mt-2">
                                        <summary className="cursor-pointer text-xs">Show errors ({importResult.errors.length})</summary>
                                        <ul className="text-xs mt-1 space-y-0.5">{importResult.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
                                    </details>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

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
                <Select value={categoryFilter} onValueChange={v => setCategoryFilter(v === "_all" ? "" : v)}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Categories" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All Categories</SelectItem>
                        {categories.map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
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
                                            <div className="flex flex-wrap gap-1 mt-0.5">
                                                {(p.categoryIds || []).length > 0 ? (
                                                    (p.categoryIds as string[]).slice(0, 2).map((cid: string) => (
                                                        <span key={cid} className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-700">
                                                            {categoryMap[cid] || cid}
                                                        </span>
                                                    ))
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">Uncategorized</span>
                                                )}
                                                {(p.categoryIds || []).length > 2 && (
                                                    <span className="text-[10px] text-muted-foreground">+{p.categoryIds.length - 2}</span>
                                                )}
                                            </div>
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
