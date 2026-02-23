import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, FolderTree, Edit, Trash2, Eye, EyeOff, ChevronRight, ExternalLink } from "lucide-react";
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

interface Category {
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
    sortOrder: number;
    status: string;
    productCount: number;
    imageLink?: string;
}

function buildTree(categories: Category[]): (Category & { depth: number })[] {
    const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    const result: (Category & { depth: number })[] = [];

    function addChildren(parentId: string | null, depth: number) {
        for (const cat of sorted) {
            if (cat.parentId === parentId) {
                result.push({ ...cat, depth });
                addChildren(cat.id, depth + 1);
            }
        }
    }

    addChildren(null, 0);
    return result;
}

export default function Categories() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentTenant) loadCategories();
    }, [currentTenant?.id]);

    async function loadCategories() {
        setLoading(true);
        try {
            const res = await apiRequest("/categories");
            setCategories(res.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm("Delete this category? Products will keep their category references.")) return;
        try {
            await apiRequest(`/categories/${id}`, { method: "DELETE" });
            loadCategories();
        } catch (e: any) {
            alert(e.message);
        }
    }

    async function toggleStatus(cat: Category) {
        const newStatus = cat.status === "active" ? "hidden" : "active";
        try {
            await apiRequest(`/categories/${cat.id}`, {
                method: "PUT",
                body: JSON.stringify({ status: newStatus })
            });
            loadCategories();
        } catch (e: any) {
            alert(e.message);
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    const tree = buildTree(categories);

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
                    <p className="text-muted-foreground">Organize products into browsable categories.</p>
                </div>
                <Button onClick={() => navigate("/categories/new")}>
                    <Plus className="mr-2 h-4 w-4" /> Add Category
                </Button>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Category</TableHead>
                                <TableHead>Slug</TableHead>
                                <TableHead>Products</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {tree.map((cat) => (
                                <TableRow key={cat.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-2" style={{ paddingLeft: `${cat.depth * 24}px` }}>
                                            {cat.depth > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                                            {cat.imageLink ? (
                                                <img src={cat.imageLink} className="w-8 h-8 rounded object-cover border" alt="" />
                                            ) : (
                                                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                                                    <FolderTree className="w-4 h-4 text-muted-foreground" />
                                                </div>
                                            )}
                                            <span className="font-medium">{cat.name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">{cat.slug}</TableCell>
                                    <TableCell>
                                        <span className="text-sm">{cat.productCount}</span>
                                    </TableCell>
                                    <TableCell>
                                        <button
                                            onClick={() => toggleStatus(cat)}
                                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium cursor-pointer ${
                                                cat.status === 'active'
                                                    ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                            }`}
                                        >
                                            {cat.status === 'active' ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                                            {cat.status}
                                        </button>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    if (!currentTenant) return;
                                                    let url = getTenantUrl(currentTenant, `/category/${cat.slug}`);
                                                    // Add preview param for hidden categories
                                                    if (cat.status !== 'active') {
                                                        url += url.includes('?') ? '&preview=true' : '?preview=true';
                                                    }
                                                    window.open(url, "_blank");
                                                }}
                                                title="View category page"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => navigate(`/categories/${cat.id}`)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" onClick={() => handleDelete(cat.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {categories.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                        No categories yet. Create your first one!
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
