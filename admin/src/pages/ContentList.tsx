import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { ContentItem } from "@amodx/shared";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
    Plus, FileText, Loader2, Home, Mail,
    Calendar, Eye, Lock, DollarSign
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UploadCloud } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTenant } from "@/context/TenantContext";

export default function ContentList() {
    const { currentTenant } = useTenant();
    const [items, setItems] = useState<ContentItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Create/Import States
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [importXml, setImportXml] = useState("");
    const [importing, setImporting] = useState(false);

    const navigate = useNavigate();

    // Helper to get the base Renderer URL (CloudFront)
    const getRendererUrl = () => {
        // @ts-ignore
        const url = window.AMODX_CONFIG?.VITE_RENDERER_URL || import.meta.env.VITE_RENDERER_URL || "";
        return url.replace(/\/$/, "");
    };

    useEffect(() => {
        if (currentTenant) {
            setLoading(true);
            loadContent();
        }
    }, [currentTenant?.id]);

    async function loadContent() {
        try {
            const data = await apiRequest("/content");
            // Sort: Homepage first, then by UpdatedAt DESC
            const sorted = (data.items || []).sort((a: any, b: any) => {
                if (a.slug === '/') return -1;
                if (b.slug === '/') return 1;
                return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
            });
            setItems(sorted);

            // Sync Links for Auto-linker
            window.dispatchEvent(new CustomEvent("amodx:refresh-links", { detail: data.items }));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleImport() {
        if (!importXml) return;
        setImporting(true);
        try {
            const res = await apiRequest("/import/wordpress", {
                method: "POST",
                body: JSON.stringify({ wxrContent: importXml })
            });
            alert(`Import Started! Processed ${res.processedCount} items.`);
            setIsImportOpen(false);
            setImportXml("");
            loadContent();
        } catch (e: any) {
            alert("Import failed: " + e.message);
        } finally {
            setImporting(false);
        }
    }

    async function createPage() {
        if (!newTitle.trim()) return;
        try {
            setIsCreating(true);
            await apiRequest("/content", {
                method: "POST",
                body: JSON.stringify({
                    title: newTitle,
                    status: "Draft",
                    blocks: []
                })
            });
            setNewTitle("");
            setIsDialogOpen(false);
            await loadContent();
        } catch (err: any) {
            alert("Failed to create: " + err.message);
        } finally {
            setIsCreating(false);
        }
    }

    async function updateStatus(id: string, newStatus: string) {
        setItems(prev => prev.map(item => item.id === id ? { ...item, status: newStatus as any } : item));
        try {
            await apiRequest(`/content/${id}`, {
                method: "PUT",
                body: JSON.stringify({ status: newStatus })
            });
        } catch (err: any) {
            loadContent();
        }
    }

    // Helper for Status Badge
    const StatusBadge = ({ status }: { status: string }) => {
        const styles = {
            "Published": "bg-green-100 text-green-700 border-green-200 hover:bg-green-100",
            "Draft": "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50",
            "Archived": "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100"
        };
        const style = (styles as any)[status] || styles["Draft"];

        return (
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${style}`}>
                {status}
            </span>
        );
    };

    // Helper for Page Icon
    const PageIcon = ({ slug }: { slug?: string }) => {
        if (slug === '/') return <Home className="h-4 w-4 text-blue-600" />;
        if (slug?.includes('contact')) return <Mail className="h-4 w-4 text-purple-600" />;
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    };

    // Helper for Access Badge
    const AccessBadge = ({ policy }: { policy?: any }) => {
        if (!policy || policy.type === 'Public') return null;

        if (policy.type === 'LoginRequired') {
            return (
                <span className="inline-flex items-center gap-1 text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-100 font-medium ml-2">
                    <Lock className="h-3 w-3" /> Members
                </span>
            );
        }
        if (policy.type === 'Purchase') {
            return (
                <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100 font-medium ml-2">
                    <DollarSign className="h-3 w-3" /> Paid
                </span>
            );
        }
        return null;
    };

    if (!currentTenant) return <div className="p-8 text-center text-muted-foreground">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Content</h1>
                    <p className="text-muted-foreground">Manage pages, posts, and landing pages.</p>
                </div>
                <div className="flex gap-2">
                    {/* IMPORT DIALOG */}
                    <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline"><UploadCloud className="mr-2 h-4 w-4"/> Import WP</Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                            <DialogHeader><DialogTitle>Import from WordPress</DialogTitle></DialogHeader>
                            <div className="space-y-4 py-4">
                                <p className="text-sm text-muted-foreground">
                                    Export your WordPress content and paste the XML here.
                                </p>
                                <Textarea
                                    placeholder="<?xml version='1.0' encoding='UTF-8'?>..."
                                    className="font-mono text-xs h-[300px]"
                                    value={importXml}
                                    onChange={e => setImportXml(e.target.value)}
                                />
                                <Button onClick={handleImport} disabled={importing} className="w-full">
                                    {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : "Start Import"}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogTrigger asChild>
                            <Button><Plus className="mr-2 h-4 w-4"/> Create Page</Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader><DialogTitle>Create New Page</DialogTitle></DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label>Page Title</Label>
                                    <Input
                                        placeholder="e.g. Services"
                                        value={newTitle}
                                        onChange={(e) => setNewTitle(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && createPage()}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Slug will be: <span className="font-mono">/{newTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}</span>
                                    </p>
                                </div>
                                <Button onClick={createPage} disabled={isCreating} className="w-full">
                                    {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : "Create"}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {error && <div className="text-red-500 p-4 border border-red-200 rounded">{error}</div>}

            <div className="border rounded-xl bg-card shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableHead className="w-[400px]">Page</TableHead>
                            <TableHead className="w-[150px]">Status</TableHead>
                            <TableHead>Last Updated</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => (
                            <TableRow key={item.id} className="group cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/content/${item.nodeId}`)}>
                                <TableCell>
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2 font-medium text-foreground">
                                            <PageIcon slug={item.slug} />
                                            {item.title}
                                            {item.slug === '/' && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 rounded border border-blue-200">HOME</span>}
                                            <AccessBadge policy={item.accessPolicy} />
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground ml-6">
                                            <span className="font-mono bg-muted/50 px-1 rounded">{item.slug}</span>
                                            {item.tags && item.tags.length > 0 && (
                                                <div className="flex gap-1">
                                                    {item.tags.map(tag => (
                                                        <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full font-medium">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div onClick={e => e.stopPropagation()}>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger className="focus:outline-none">
                                                <StatusBadge status={item.status} />
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent>
                                                <DropdownMenuItem onClick={() => updateStatus(item.nodeId, "Draft")}>Draft</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => updateStatus(item.nodeId, "Published")}>Published</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => updateStatus(item.nodeId, "Archived")}>Archived</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                    <div className="flex items-center gap-2">
                                        <Calendar className="h-3 w-3" />
                                        {new Date(item.updatedAt || item.createdAt).toLocaleDateString()}
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            // FIX: Use Renderer URL + /_site/ + tenant + slug
                                            onClick={() => {
                                                const rendererUrl = getRendererUrl();
                                                const url = `${rendererUrl}/_site/${currentTenant.id}${item.slug}`;
                                                window.open(url, '_blank');
                                            }}
                                            title="Preview (Internal Link)"
                                        >
                                            <Eye className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => navigate(`/content/${item.nodeId}`)}>
                                            Edit
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
