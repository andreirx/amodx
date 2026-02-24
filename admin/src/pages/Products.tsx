import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, ShoppingBag, Edit, Trash2, Upload, Percent, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";

// Helper to get the base Renderer URL (CloudFront)
const getRendererUrl = () => {
    // @ts-ignore
    const url = window.AMODX_CONFIG?.VITE_RENDERER_URL || import.meta.env.VITE_RENDERER_URL || "";
    return url.replace(/\/$/, "");
};

// Build public URL for a tenant - use real domain if wired, otherwise /_site/ fallback
const getTenantUrl = (tenant: { id: string; domain?: string }, path: string) => {
    // .localhost suffix means it's a placeholder, not a real domain
    if (tenant.domain && !tenant.domain.endsWith('.localhost')) {
        return `https://${tenant.domain}${path}`;
    }
    // Fallback to CloudFront /_site/ routing
    return `${getRendererUrl()}/_site/${tenant.id}${path}`;
};
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { detectHeaderMappings, type HeaderMapping } from "@/lib/csv-headers";

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
    const [headerMappings, setHeaderMappings] = useState<HeaderMapping[] | null>(null);
    const [pendingCsvContent, setPendingCsvContent] = useState<string>("");
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkPercent, setBulkPercent] = useState("");
    const [bulkRoundTo, setBulkRoundTo] = useState("0");
    const [bulkCategory, setBulkCategory] = useState("");
    const [bulkSalePrice, setBulkSalePrice] = useState(false);
    const [bulkPreview, setBulkPreview] = useState<any[] | null>(null);
    const [bulkLoading, setBulkLoading] = useState(false);
    const [bulkResult, setBulkResult] = useState<string | null>(null);

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
            // Filter to physical products only (exclude digital/Paddle products)
            const all = res.items || [];
            setProducts(all.filter((p: any) => p.productType !== "digital" && !p.paymentLinkId));
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
        setImportResult(null);
        try {
            const csvContent = await file.text();
            const firstLine = csvContent.split('\n')[0] || '';
            const mappings = detectHeaderMappings(firstLine);
            if (mappings) {
                // Non-English headers detected — show confirmation
                setPendingCsvContent(csvContent);
                setHeaderMappings(mappings);
            } else {
                // English headers — import directly
                await doImport(csvContent);
            }
        } catch (err: any) {
            setImportResult({ error: err.message });
        } finally {
            e.target.value = "";
        }
    }

    async function doImport(csvContent: string) {
        setImporting(true);
        setImportResult(null);
        try {
            const res = await apiRequest("/import/woocommerce", {
                method: "POST",
                body: JSON.stringify({ csvContent, currency: (currentTenant as any).currency || "RON" }),
            });
            setImportResult(res);
            loadProducts();
        } catch (err: any) {
            setImportResult({ error: err.message });
        } finally {
            setImporting(false);
        }
    }

    async function handleBulkPreview() {
        const pct = parseFloat(bulkPercent);
        if (isNaN(pct) || pct === 0) return alert("Enter a non-zero percentage.");
        setBulkLoading(true);
        setBulkResult(null);
        try {
            const res = await apiRequest("/products/bulk-price", {
                method: "POST",
                body: JSON.stringify({
                    categoryId: bulkCategory || undefined,
                    percent: pct,
                    roundTo: parseFloat(bulkRoundTo),
                    applyToSalePrice: bulkSalePrice,
                    dryRun: true,
                }),
            });
            setBulkPreview(res.preview || []);
        } catch (e: any) {
            alert("Preview failed: " + e.message);
        } finally {
            setBulkLoading(false);
        }
    }

    async function handleBulkApply() {
        if (!bulkPreview || bulkPreview.length === 0) return;
        if (!confirm(`This will update ${bulkPreview.length} product prices. Continue?`)) return;
        setBulkLoading(true);
        try {
            const res = await apiRequest("/products/bulk-price", {
                method: "POST",
                body: JSON.stringify({
                    categoryId: bulkCategory || undefined,
                    percent: parseFloat(bulkPercent),
                    roundTo: parseFloat(bulkRoundTo),
                    applyToSalePrice: bulkSalePrice,
                    dryRun: false,
                }),
            });
            setBulkResult(res.message);
            setBulkPreview(null);
            loadProducts();
        } catch (e: any) {
            alert("Bulk update failed: " + e.message);
        } finally {
            setBulkLoading(false);
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Products</h1>
                    <p className="text-muted-foreground">Manage physical products for your store.</p>
                </div>
                <div className="flex gap-2">
                    <Dialog open={bulkOpen} onOpenChange={(open) => { setBulkOpen(open); if (!open) { setBulkPreview(null); setBulkResult(null); } }}>
                        <DialogTrigger asChild>
                            <Button variant="outline">
                                <Percent className="mr-2 h-4 w-4" /> Adjust Prices
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>Bulk Price Adjustment</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-2">
                                {/* Scope */}
                                <div className="space-y-2">
                                    <Label>Scope</Label>
                                    <Select value={bulkCategory || "_all"} onValueChange={v => setBulkCategory(v === "_all" ? "" : v)}>
                                        <SelectTrigger><SelectValue placeholder="All Products" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="_all">All Products</SelectItem>
                                            {categories.map((c: any) => (
                                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Percentage */}
                                <div className="space-y-2">
                                    <Label>Percentage Change</Label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="number"
                                            value={bulkPercent}
                                            onChange={e => setBulkPercent(e.target.value)}
                                            placeholder="e.g. 10 or -5"
                                            className="w-40"
                                        />
                                        <span className="text-sm text-muted-foreground">% (positive = increase, negative = decrease)</span>
                                    </div>
                                </div>

                                {/* Rounding */}
                                <div className="space-y-2">
                                    <Label>Rounding</Label>
                                    <Select value={bulkRoundTo} onValueChange={setBulkRoundTo}>
                                        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="0">No rounding</SelectItem>
                                            <SelectItem value="5">Round up to nearest 5</SelectItem>
                                            <SelectItem value="9">Round up to ending in 9</SelectItem>
                                            <SelectItem value="0.99">Round to .99</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Sale price */}
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={bulkSalePrice}
                                        onChange={e => setBulkSalePrice(e.target.checked)}
                                        className="rounded"
                                    />
                                    Also adjust sale prices
                                </label>

                                {/* Actions */}
                                <div className="flex gap-2">
                                    <Button onClick={handleBulkPreview} disabled={bulkLoading}>
                                        {bulkLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        Preview
                                    </Button>
                                    {bulkPreview && bulkPreview.length > 0 && (
                                        <Button variant="default" onClick={handleBulkApply} disabled={bulkLoading} className="bg-green-600 hover:bg-green-700">
                                            {bulkLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                            Apply to {bulkPreview.length} products
                                        </Button>
                                    )}
                                </div>

                                {/* Result */}
                                {bulkResult && (
                                    <div className="text-sm p-3 rounded-md bg-green-50 text-green-700">{bulkResult}</div>
                                )}

                                {/* Preview Table */}
                                {bulkPreview && bulkPreview.length > 0 && (
                                    <div className="border rounded-md overflow-hidden">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Product</TableHead>
                                                    <TableHead className="text-right">Old Price</TableHead>
                                                    <TableHead className="text-right">New Price</TableHead>
                                                    {bulkSalePrice && <TableHead className="text-right">Old Sale</TableHead>}
                                                    {bulkSalePrice && <TableHead className="text-right">New Sale</TableHead>}
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {bulkPreview.map((p: any) => (
                                                    <TableRow key={p.id}>
                                                        <TableCell className="text-sm font-medium">{p.title}</TableCell>
                                                        <TableCell className="text-right text-sm text-muted-foreground">{p.oldPrice} {p.currency}</TableCell>
                                                        <TableCell className="text-right text-sm font-semibold">{p.newPrice} {p.currency}</TableCell>
                                                        {bulkSalePrice && <TableCell className="text-right text-sm text-muted-foreground">{p.oldSalePrice || "—"}</TableCell>}
                                                        {bulkSalePrice && <TableCell className="text-right text-sm font-semibold">{p.newSalePrice || "—"}</TableCell>}
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                                {bulkPreview && bulkPreview.length === 0 && (
                                    <p className="text-sm text-muted-foreground">No products to adjust.</p>
                                )}
                            </div>
                        </DialogContent>
                    </Dialog>
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
                                            <span className="font-medium">{p.title}</span>
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
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    if (!currentTenant) return;
                                                    let url = getTenantUrl(currentTenant, `/product/${p.slug}`);
                                                    // Add preview param for non-active products (like drafts)
                                                    if (p.status !== 'active') {
                                                        url += url.includes('?') ? '&preview=true' : '?preview=true';
                                                    }
                                                    window.open(url, "_blank");
                                                }}
                                                title="View product page"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                            </Button>
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

            {/* Header Mapping Confirmation Dialog */}
            <Dialog open={headerMappings !== null} onOpenChange={(open) => { if (!open) { setHeaderMappings(null); setPendingCsvContent(""); } }}>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>CSV Header Mapping</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        We detected non-English column headers in your CSV. Please confirm these mappings are correct before importing.
                    </p>
                    <div className="border rounded-md overflow-hidden mt-2">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-xs">Your CSV Header</TableHead>
                                    <TableHead className="text-xs">Mapped To</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {headerMappings?.filter(m => m.original !== m.mapped).map((m, i) => (
                                    <TableRow key={i}>
                                        <TableCell className="text-xs font-mono py-1">{m.original}</TableCell>
                                        <TableCell className="text-xs font-mono py-1 text-green-700">{m.mapped}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="flex gap-2 mt-4">
                        <Button variant="outline" onClick={() => { setHeaderMappings(null); setPendingCsvContent(""); }} className="flex-1">
                            Cancel
                        </Button>
                        <Button onClick={() => { setHeaderMappings(null); doImport(pendingCsvContent); setPendingCsvContent(""); }} className="flex-1">
                            Confirm & Import
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
