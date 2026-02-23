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
import { Loader2, Star, Check, EyeOff, Trash2, Plus } from "lucide-react";

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

    async function handleDelete(id: string, productId: string) {
        if (!confirm("Are you sure you want to delete this review?")) return;
        try {
            await apiRequest(`/reviews/${id}?productId=${encodeURIComponent(productId)}`, {
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
                        className={`inline h-3.5 w-3.5 ${i < filled ? "fill-amber-400 text-amber-400" : "text-gray-300"}`}
                    />
                ))}
            </span>
        );
    }

    function statusBadge(status: string) {
        const colors: Record<string, string> = {
            approved: "bg-green-50 text-green-700",
            pending: "bg-yellow-50 text-yellow-700",
            hidden: "bg-gray-100 text-gray-500",
        };
        return (
            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>
                {status}
            </span>
        );
    }

    function sourceBadge(source: string) {
        const colors: Record<string, string> = {
            google: "bg-blue-50 text-blue-700",
            internal: "bg-purple-50 text-purple-700",
            imported: "bg-gray-100 text-gray-500",
        };
        return (
            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${colors[source] || "bg-gray-100 text-gray-700"}`}>
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
                                            <Star className={`h-6 w-6 ${r <= newReview.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
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
                                        {r.productId}
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
                                                        className="text-green-600 hover:text-green-700"
                                                        title="Approve"
                                                        onClick={() => handleStatusUpdate(r.id, r.productId, "approved")}
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-gray-500 hover:text-gray-600"
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
                                                    className="text-gray-500 hover:text-gray-600"
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
                                                    className="text-green-600 hover:text-green-700"
                                                    title="Approve"
                                                    onClick={() => handleStatusUpdate(r.id, r.productId, "approved")}
                                                >
                                                    <Check className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-red-500 hover:text-red-600"
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
