import { Fragment, useEffect, useState } from "react";
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
import { Loader2, Star, Check, EyeOff, Trash2, Plus, Upload, Image as ImageIcon } from "lucide-react";
import type { ReviewImportReport } from "@amodx/shared";
import { buildImportReportView } from "@/lib/importReportView";

export default function Reviews() {
    const { currentTenant } = useTenant();
    const [reviews, setReviews] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("");
    const [productFilter] = useState("");
    // rev-3 moderation filters. All applied CLIENT-SIDE over the single list payload: the list
    // handler returns every review (both scopes) with `scope`, `source`, `importBatchId`, and the
    // per-image `images` array, so filtering needs no extra query. (Backend `list.ts` does not filter
    // by status/scope/source; it returns all — see its docstring.)
    const [scopeFilter, setScopeFilter] = useState("");
    const [sourceFilter, setSourceFilter] = useState("");
    const [batchFilter, setBatchFilter] = useState("");
    // Which reviews have their per-image moderation tiles expanded.
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

    // rev-3 PER-IMAGE APPROVE — rides the EXISTING rev-2a promotion action on PUT /reviews/{id}
    // (`action: "approve-image"`). The backend gate requires the REVIEW to be approved first and the
    // image to be pending (pending→approved), then promotes the staged original to the public bucket
    // and rewrites the entry's assetKey to the public key. We only surface the button when the UI
    // state already satisfies that gate; a lost race still surfaces the backend's 409 message.
    async function approveImage(id: string, productId: string | undefined, imageIndex: number) {
        try {
            const body: Record<string, unknown> = { action: "approve-image", imageIndex };
            // Omit productId entirely for site-scope reviews so the backend routes to SITEREVIEW#
            // (serializing `undefined` would send the string "undefined" — rev-2b finding #1).
            if (productId) body.productId = productId;
            await apiRequest(`/reviews/${id}`, { method: "PUT", body: JSON.stringify(body) });
            loadReviews();
        } catch (e: any) {
            alert(e.message);
        }
    }

    // rev-3 PER-IMAGE HIDE (REV3-IMG-HIDE-SCOPE = B) — rides `action: "hide-image"` on the same
    // handler. A pure status flip to `hidden`; no promotion, no review-status gate. Hiding an already
    // approved (public) image removes it from the site via the public-list status filter. Offered for
    // any image that is not already hidden. NOTE: hide is terminal w.r.t. approval — approve-image
    // only accepts pending→approved, so a hidden photo cannot be re-approved (backend contract).
    async function hideImage(id: string, productId: string | undefined, imageIndex: number) {
        try {
            const body: Record<string, unknown> = { action: "hide-image", imageIndex };
            if (productId) body.productId = productId;
            await apiRequest(`/reviews/${id}`, { method: "PUT", body: JSON.stringify(body) });
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

    // Scope distinguishes a business (site) review from a product review — a site review has no
    // product (rev-1 D-REV-5). Site reviews are "listed distinctly" via this badge + the scope filter.
    function scopeBadge(scope?: string) {
        const isSite = scope === "site";
        return (
            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${isSite ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {isSite ? "site" : "product"}
            </span>
        );
    }

    // Per-image disposition (rev-1 ReviewImageSchema.status): pending | approved | hidden. The schema
    // has no "rejected" state, so none is shown (a review-image is pending, approved, or hidden).
    function imageStatusBadge(status: string) {
        const colors: Record<string, string> = {
            approved: "bg-primary/10 text-primary",
            pending: "bg-muted text-muted-foreground",
            hidden: "bg-secondary text-secondary-foreground",
        };
        return (
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${colors[status] || "bg-muted text-muted-foreground"}`}>
                {status}
            </span>
        );
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    // Distinct import batches present in the current payload — populates the batch filter dropdown.
    const batchIds = Array.from(new Set(reviews.map((r) => r.importBatchId).filter(Boolean))) as string[];

    // Client-side moderation filters (status + scope + source + importBatch), all AND-combined.
    const filtered = reviews.filter((r) =>
        (!statusFilter || r.status === statusFilter) &&
        (!scopeFilter || (r.scope || "product") === scopeFilter) &&
        (!sourceFilter || r.source === sourceFilter) &&
        (!batchFilter || r.importBatchId === batchFilter),
    );

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

            <div className="flex flex-wrap gap-3">
                <Select value={statusFilter} onValueChange={v => setStatusFilter(v === "_all" ? "" : v)}>
                    <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All Statuses</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="hidden">Hidden</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={scopeFilter} onValueChange={v => setScopeFilter(v === "_all" ? "" : v)}>
                    <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Scopes" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All Scopes</SelectItem>
                        <SelectItem value="product">Product</SelectItem>
                        <SelectItem value="site">Site</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={sourceFilter} onValueChange={v => setSourceFilter(v === "_all" ? "" : v)}>
                    <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Sources" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All Sources</SelectItem>
                        <SelectItem value="internal">Internal</SelectItem>
                        <SelectItem value="google">Google</SelectItem>
                        <SelectItem value="imported">Imported</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                </Select>
                {batchIds.length > 0 && (
                    <Select value={batchFilter} onValueChange={v => setBatchFilter(v === "_all" ? "" : v)}>
                        <SelectTrigger className="w-[220px]"><SelectValue placeholder="All Import Batches" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="_all">All Import Batches</SelectItem>
                            {batchIds.map((b) => (
                                <SelectItem key={b} value={b}>{b}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Scope</TableHead>
                                <TableHead>Product ID</TableHead>
                                <TableHead>Author</TableHead>
                                <TableHead>Rating</TableHead>
                                <TableHead>Content</TableHead>
                                <TableHead>Source</TableHead>
                                <TableHead>Photos</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((r) => {
                              const images: any[] = Array.isArray(r.images) ? r.images : [];
                              const isOpen = !!expanded[r.id];
                              return (
                                <Fragment key={r.id}>
                                <TableRow>
                                    <TableCell>
                                        {scopeBadge(r.scope)}
                                    </TableCell>
                                    <TableCell className="text-sm font-mono text-muted-foreground">
                                        {/* Site-scope (business) reviews have no product — imported
                                            business reviews (rev-2b) land here under SITEREVIEW#. */}
                                        {r.productId || (r.scope === "site" ? "— (site)" : "—")}
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        {r.author || r.authorName || "Anonymous"}
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
                                        {images.length > 0 ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 px-2 text-xs"
                                                onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}
                                            >
                                                <ImageIcon className="mr-1 h-3.5 w-3.5" />
                                                {images.length} {isOpen ? "▲" : "▼"}
                                            </Button>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
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
                                {isOpen && images.length > 0 && (
                                    <TableRow>
                                        <TableCell colSpan={9} className="bg-muted/30">
                                            {/* PER-IMAGE moderation tiles. Thumbnails are fetched via the
                                                presigned-GET view endpoint (staged private original for a
                                                pending photo; public CDN URL once approved). Approve rides
                                                the rev-2a promotion action; it is only offered when the review
                                                is approved AND the image is pending — the backend gate. Hide
                                                (rev-3 hide-image) is offered for any non-hidden image; it is a
                                                pure status flip that pulls the photo from the public list. */}
                                            {r.status !== "approved" && (
                                                <p className="mb-2 text-xs text-muted-foreground">
                                                    Approve the review first to enable per-photo approval (photos
                                                    are promoted to the public bucket only after the review is approved).
                                                </p>
                                            )}
                                            <div className="flex flex-wrap gap-4 py-2">
                                                {images.map((img, i) => (
                                                    <ImageTile
                                                        key={i}
                                                        reviewId={r.id}
                                                        productId={r.productId}
                                                        imageIndex={i}
                                                        image={img}
                                                        reviewApproved={r.status === "approved"}
                                                        onApprove={() => approveImage(r.id, r.productId, i)}
                                                        onHide={() => hideImage(r.id, r.productId, i)}
                                                        imageStatusBadge={imageStatusBadge}
                                                    />
                                                ))}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                                </Fragment>
                              );
                            })}
                            {filtered.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                                        {reviews.length === 0 ? "No reviews yet." : "No reviews match the current filters."}
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

/**
 * One per-image moderation tile (rev-3). A pending review photo is a PRIVATE staged original that
 * has no public URL, so the thumbnail is fetched lazily from the presigned-GET view endpoint
 * (GET /reviews/{id}/image-view-url). Once approved the same endpoint returns the public CDN URL.
 *
 * Approve is offered ONLY when the review is approved AND this image is pending — mirroring the
 * backend gate (rev-2a): approving promotes the staged original to the public bucket and rewrites
 * the entry's assetKey. Hide (rev-3 hide-image, REV3-IMG-HIDE-SCOPE = B) is offered for any image
 * that is not already hidden — a pure status flip that removes the photo from the public list.
 */
function ImageTile(props: {
    reviewId: string;
    productId?: string;
    imageIndex: number;
    image: { status?: string; alt?: string };
    reviewApproved: boolean;
    onApprove: () => void;
    onHide: () => void;
    imageStatusBadge: (status: string) => React.ReactNode;
}) {
    const { reviewId, productId, imageIndex, image, reviewApproved, onApprove, onHide, imageStatusBadge } = props;
    const [viewUrl, setViewUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const qs = `imageIndex=${imageIndex}${productId ? `&productId=${encodeURIComponent(productId)}` : ""}`;
        apiRequest(`/reviews/${reviewId}/image-view-url?${qs}`)
            .then((res: { viewUrl?: string }) => {
                if (!cancelled) setViewUrl(res.viewUrl ?? null);
            })
            .catch((e: any) => {
                if (!cancelled) setError(e.message);
            });
        return () => { cancelled = true; };
        // Re-fetch when the image transitions (its assetKey/status changes on approval).
    }, [reviewId, productId, imageIndex, image.status]);

    const status = image.status || "pending";
    const canApprove = reviewApproved && status === "pending";
    // Hide has no review-status gate (the backend permits it for any review status); offered for any
    // image that is not already hidden.
    const canHide = status !== "hidden";

    return (
        <div className="w-32 space-y-1">
            <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
                {viewUrl ? (
                    // Raw <img>, never next/image (this is the admin SPA; opennext-1 is renderer-only).
                    <img src={viewUrl} alt={image.alt || `Review photo ${imageIndex + 1}`} className="h-full w-full object-cover" />
                ) : error ? (
                    <span className="px-1 text-center text-[10px] text-destructive" title={error}>Preview unavailable</span>
                ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
            </div>
            <div className="flex items-center justify-between">
                {imageStatusBadge(status)}
                <div className="flex items-center gap-0.5">
                    {canApprove && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-primary hover:text-primary/80"
                            title="Approve photo"
                            onClick={onApprove}
                        >
                            <Check className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    {canHide && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            title="Hide photo"
                            onClick={onHide}
                        >
                            <EyeOff className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
