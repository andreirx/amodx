import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Star, Check, EyeOff, Trash2, Plus, Upload } from "lucide-react";
import type { ReviewImportReport } from "@amodx/shared";
import { buildImportReportView } from "@/lib/importReportView";

export default function Reviews() {
    const { currentTenant } = useTenant();
    const [reviews, setReviews] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("");
    const [productFilter] = useState("");

    // Create review dialog state
    const [createOpen, setCreateOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newReview, setNewReview] = useState({
        productId: "",
        authorName: "",
        rating: 5,
        content: "",
        source: "internal" as "internal" | "google" | "imported",
        status: "approved" as "approved" | "pending" | "hidden",
    });

    // Bulk import dialog state (rev-2b). Attestation is REQUIRED by the backend gate (D-REV-3):
    // the tenant must assert a rights basis before any imported review/photo is written.
    const [importOpen, setImportOpen] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importReport, setImportReport] = useState<ReviewImportReport | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
    const [sourceContent, setSourceContent] = useState("");
    const [sourceName, setSourceName] = useState("");
    const [zipBase64, setZipBase64] = useState("");
    const [zipName, setZipName] = useState("");
    const [rightsBasis, setRightsBasis] = useState("");
    // The exact attestation wording shown to the operator is versioned so the ImportBatch record
    // can prove WHICH legal text they accepted. Bump this when the wording below changes.
    const LEGAL_TEXT_VERSION = "v1";
    const ATTESTATION_TEXT =
        "I confirm the tenant has the right to display these reviews and their photos on this site.";
    const [attested, setAttested] = useState(false);

    async function handleSourceFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportError(null);
        setImportReport(null);
        const text = await file.text();
        setSourceContent(text);
        setSourceName(file.name);
        setImportFormat(file.name.toLowerCase().endsWith(".json") ? "json" : "csv");
    }

    async function handleZipFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const buf = await file.arrayBuffer();
        // base64-encode the ZIP so it rides the JSON request body (matches the backend contract).
        let binary = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        setZipBase64(btoa(binary));
        setZipName(file.name);
    }

    async function doImport() {
        if (!sourceContent) {
            setImportError("Choose a CSV or JSON file to import.");
            return;
        }
        if (!rightsBasis.trim() || !attested) {
            setImportError("You must state a rights basis and accept the attestation to import.");
            return;
        }
        setImporting(true);
        setImportError(null);
        setImportReport(null);
        try {
            const body: Record<string, unknown> = {
                format: importFormat,
                attestation: { rightsBasis: rightsBasis.trim(), legalTextVersion: LEGAL_TEXT_VERSION },
            };
            if (importFormat === "json") body.jsonContent = sourceContent;
            else body.csvContent = sourceContent;
            if (zipBase64) body.zipBase64 = zipBase64;

            const res = (await apiRequest("/import/reviews", {
                method: "POST",
                body: JSON.stringify(body),
            })) as ReviewImportReport;
            setImportReport(res);
            loadReviews();
        } catch (e: any) {
            setImportError(e.message);
        } finally {
            setImporting(false);
        }
    }

    useEffect(() => {
        if (currentTenant) {
            loadReviews();
            loadProducts();
        }
    }, [currentTenant?.id]);

    async function loadProducts() {
        try {
            const res = await apiRequest("/products");
            setProducts(res.items || []);
        } catch (e) {
            console.error(e);
        }
    }

    async function createReview() {
        if (!newReview.productId || !newReview.authorName) {
            alert("Please select a product and enter an author name.");
            return;
        }
        setCreating(true);
        try {
            await apiRequest("/reviews", {
                method: "POST",
                body: JSON.stringify(newReview),
            });
            setCreateOpen(false);
            setNewReview({
                productId: "",
                authorName: "",
                rating: 5,
                content: "",
                source: "internal",
                status: "approved",
            });
            loadReviews();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setCreating(false);
        }
    }

    useEffect(() => {
        if (currentTenant) loadReviews();
    }, [statusFilter, productFilter]);

    async function loadReviews() {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter) params.set("status", statusFilter);
            if (productFilter) params.set("productId", productFilter);
            const qs = params.toString();
            const res = await apiRequest(`/reviews${qs ? `?${qs}` : ""}`);
            setReviews(res.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleStatusUpdate(id: string, productId: string, status: string) {
        try {
            await apiRequest(`/reviews/${id}`, {
                method: "PUT",
                body: JSON.stringify({ productId, status }),
            });
            loadReviews();
        } catch (e: any) {
            alert(e.message);
        }
    }

    async function handleDelete(id: string, productId?: string) {
        if (!confirm("Are you sure you want to delete this review?")) return;
        try {
            // Site-scope (business) reviews have NO productId — omit the param entirely so the
            // backend routes to the SITEREVIEW# namespace. Serializing `undefined` here would send
            // the literal string "undefined" and mis-route the delete (rev-2b finding #1).
            const qs = productId ? `?productId=${encodeURIComponent(productId)}` : "";
            await apiRequest(`/reviews/${id}${qs}`, {
                method: "DELETE",
            });
            loadReviews();
        } catch (e: any) {
            alert(e.message);
        }
    }

    function renderRating(rating: number) {
        const filled = Math.round(rating);
        return (
            <span className="text-sm" title={`${rating}/5`}>
                {Array.from({ length: 5 }, (_, i) => (
                    <Star
                        key={i}
                        className={`inline h-3.5 w-3.5 ${i < filled ? "fill-primary text-primary" : "text-muted-foreground/30"}`}
                    />
                ))}
            </span>
        );
    }

    // Theme-token badges (Critical Rule 6 — no hardcoded colors; the admin theme exposes no
    // success/warning tokens, so approved maps to the tenant `primary` accent and the neutral
    // states to `muted`/`secondary`. The label text carries the state; color only reinforces it.
    function statusBadge(status: string) {
        const colors: Record<string, string> = {
            approved: "bg-primary/10 text-primary",
            pending: "bg-muted text-muted-foreground",
            hidden: "bg-secondary text-secondary-foreground",
        };
        return (
            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${colors[status] || "bg-muted text-muted-foreground"}`}>
                {status}
            </span>
        );
    }

    // Source is a CATEGORY, not a status, and the theme has no per-category palette — one neutral
    // chip; the label distinguishes google/internal/imported.
    function sourceBadge(source: string) {
        return (
            <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-secondary text-secondary-foreground">
                {source}
            </span>
        );
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Reviews</h1>
                    <p className="text-muted-foreground">Moderate customer reviews.</p>
                </div>
                <div className="flex gap-2">
                <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) { setImportReport(null); setImportError(null); } }}>
                    <DialogTrigger asChild>
                        <Button variant="outline">
                            <Upload className="mr-2 h-4 w-4" /> Import reviews
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Bulk import reviews</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                            <p className="text-sm text-muted-foreground">
                                Import a CSV or JSON review export, with an optional ZIP of review photos.
                                Imported reviews and photos land as <strong>pending</strong> and must be
                                approved before they appear on the site.
                            </p>

                            <div className="space-y-2">
                                <Label>Review file (CSV or JSON) *</Label>
                                <Input type="file" accept=".csv,.json,text/csv,application/json" onChange={handleSourceFile} />
                                {sourceName && <p className="text-xs text-muted-foreground">Selected: {sourceName} ({importFormat.toUpperCase()})</p>}
                            </div>

                            <div className="space-y-2">
                                <Label>Media ZIP (optional)</Label>
                                <Input type="file" accept=".zip,application/zip" onChange={handleZipFile} />
                                {zipName && <p className="text-xs text-muted-foreground">Selected: {zipName}</p>}
                            </div>

                            <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3">
                                <Label>Rights basis (required) *</Label>
                                <Input
                                    value={rightsBasis}
                                    onChange={(e) => setRightsBasis(e.target.value)}
                                    placeholder="e.g. Reviews collected on the tenant's own storefront; consent on file"
                                />
                                <label className="flex items-start gap-2 text-sm">
                                    <input type="checkbox" className="mt-1" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                                    <span>{ATTESTATION_TEXT} <span className="text-muted-foreground">({LEGAL_TEXT_VERSION})</span></span>
                                </label>
                            </div>

                            {importError && <p className="text-sm text-destructive">{importError}</p>}

                            <Button onClick={doImport} disabled={importing} className="w-full">
                                {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Import
                            </Button>

                            {importReport && (() => {
                                // Render EXCLUSIVELY from the pure view-model (finding #5): the same
                                // data the headless importReportView test asserts on. The FULL
                                // disposition — accepted images (assetKey + KB) and every rejection —
                                // is derived here, so the test covers what the operator sees.
                                const view = buildImportReportView(importReport);
                                return (
                                <div className="space-y-3 rounded-md border p-3">
                                    <div className="flex gap-4 text-sm">
                                        <span><strong>{view.accepted}</strong> accepted</span>
                                        <span><strong>{view.rejected}</strong> rejected</span>
                                        <span className="text-muted-foreground">of {view.totalRows} rows</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">Batch: {view.batchId}</p>

                                    {view.rejectedRows.length > 0 && (
                                        <div>
                                            <p className="text-sm font-medium">Rejected rows</p>
                                            <ul className="text-xs text-destructive list-disc pl-5">
                                                {view.rejectedRows.map((r) => (
                                                    <li key={r.key}>{r.label}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {/* FULL per-image disposition (revise #3): accepted photos are first-class
                                        entries showing the staged (private) original key + its byte size, alongside
                                        rejections. Discriminated on `status` — the report's sum type. */}
                                    {view.acceptedImages.length > 0 && (
                                        <div>
                                            <p className="text-sm font-medium">Accepted images (staged, pending approval)</p>
                                            <ul className="text-xs text-muted-foreground list-disc pl-5">
                                                {view.acceptedImages.map((img) => (
                                                    <li key={img.key}>
                                                        {img.rowLabel} →{" "}
                                                        <span className="font-mono">{img.assetKey}</span>
                                                        {` (${img.sizeKB} KB)`}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {view.rejectedImages.length > 0 && (
                                        <div>
                                            <p className="text-sm font-medium">Rejected images</p>
                                            <ul className="text-xs text-destructive list-disc pl-5">
                                                {view.rejectedImages.map((img) => (
                                                    <li key={img.key}>{img.label}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {view.someAccepted && (
                                        <p className="text-xs text-primary">
                                            Imported reviews are pending in the list below — approve them to publish.
                                        </p>
                                    )}
                                </div>
                                );
                            })()}
                        </div>
                    </DialogContent>
                </Dialog>
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" /> Add Review
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add Review</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Product *</Label>
                                <Select value={newReview.productId} onValueChange={v => setNewReview({ ...newReview, productId: v })}>
                                    <SelectTrigger><SelectValue placeholder="Select a product" /></SelectTrigger>
                                    <SelectContent>
                                        {products.map((p: any) => (
                                            <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Author Name *</Label>
                                <Input
                                    value={newReview.authorName}
                                    onChange={e => setNewReview({ ...newReview, authorName: e.target.value })}
                                    placeholder="John Doe"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Rating</Label>
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map(r => (
                                        <button
                                            key={r}
                                            type="button"
                                            onClick={() => setNewReview({ ...newReview, rating: r })}
                                            className="p-1"
                                        >
                                            <Star className={`h-6 w-6 ${r <= newReview.rating ? 'fill-primary text-primary' : 'text-muted-foreground/30'}`} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Review Content</Label>
                                <Textarea
                                    value={newReview.content}
                                    onChange={e => setNewReview({ ...newReview, content: e.target.value })}
                                    placeholder="Write the review..."
                                    rows={4}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Source</Label>
                                    <Select value={newReview.source} onValueChange={v => setNewReview({ ...newReview, source: v as any })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="internal">Internal</SelectItem>
                                            <SelectItem value="google">Google</SelectItem>
                                            <SelectItem value="imported">Imported</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Status</Label>
                                    <Select value={newReview.status} onValueChange={v => setNewReview({ ...newReview, status: v as any })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="approved">Approved</SelectItem>
                                            <SelectItem value="pending">Pending</SelectItem>
                                            <SelectItem value="hidden">Hidden</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <Button onClick={createReview} disabled={creating} className="w-full">
                                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Create Review
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
                </div>
            </div>

            <div className="flex gap-3">
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v === "_all" ? "" : v)}>
                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All Statuses</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="hidden">Hidden</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Product ID</TableHead>
                                <TableHead>Author</TableHead>
                                <TableHead>Rating</TableHead>
                                <TableHead>Content</TableHead>
                                <TableHead>Source</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {reviews.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="text-sm font-mono text-muted-foreground">
                                        {/* Site-scope (business) reviews have no product — imported
                                            business reviews (rev-2b) land here under SITEREVIEW#. */}
                                        {r.productId || (r.scope === "site" ? "— (site)" : "—")}
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        {r.author || "Anonymous"}
                                    </TableCell>
                                    <TableCell>
                                        {renderRating(r.rating)}
                                    </TableCell>
                                    <TableCell className="max-w-[300px]">
                                        <span className="text-sm" title={r.content}>
                                            {r.content && r.content.length > 100
                                                ? r.content.slice(0, 100) + "..."
                                                : r.content}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        {sourceBadge(r.source)}
                                    </TableCell>
                                    <TableCell>
                                        {statusBadge(r.status)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            {r.status === "pending" && (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-primary hover:text-primary/80"
                                                        title="Approve"
                                                        onClick={() => handleStatusUpdate(r.id, r.productId, "approved")}
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-muted-foreground hover:text-foreground"
                                                        title="Hide"
                                                        onClick={() => handleStatusUpdate(r.id, r.productId, "hidden")}
                                                    >
                                                        <EyeOff className="h-4 w-4" />
                                                    </Button>
                                                </>
                                            )}
                                            {r.status === "approved" && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-muted-foreground hover:text-foreground"
                                                    title="Hide"
                                                    onClick={() => handleStatusUpdate(r.id, r.productId, "hidden")}
                                                >
                                                    <EyeOff className="h-4 w-4" />
                                                </Button>
                                            )}
                                            {r.status === "hidden" && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-primary hover:text-primary/80"
                                                    title="Approve"
                                                    onClick={() => handleStatusUpdate(r.id, r.productId, "approved")}
                                                >
                                                    <Check className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:text-destructive/80"
                                                title="Delete"
                                                onClick={() => handleDelete(r.id, r.productId)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {reviews.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                        No reviews yet.
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
