import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { ContentItem } from "@amodx/shared";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, FileText, Loader2, LayoutDashboard } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenant } from "@/context/TenantContext";
import { UploadCloud } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export default function ContentList() {
    const { currentTenant } = useTenant();
    const [items, setItems] = useState<ContentItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const navigate = useNavigate();

    const [isImportOpen, setIsImportOpen] = useState(false);
    const [importXml, setImportXml] = useState("");
    const [importing, setImporting] = useState(false);

    useEffect(() => {
        if (currentTenant) {
            setLoading(true);
            loadContent();
        }
    }, [currentTenant?.id]);

    async function loadContent() {
        try {
            const data = await apiRequest("/content");
            // Sort by CreatedAt desc
            const sorted = (data.items || []).sort((a: any, b: any) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
            setItems(sorted);
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
            alert(`Import Started! Processed ${res.processedCount} items. Check logs for details.`);
            setIsImportOpen(false);
            setImportXml("");
            loadContent();
        } catch (e: any) {
            alert("Import failed: " + e.message);
        } finally {
            setImporting(false);
        }
    }

    async function updateStatus(id: string, newStatus: string) {
        // Optimistic Update
        setItems(prev => prev.map(item => item.id === id ? { ...item, status: newStatus as any } : item));

        try {
            await apiRequest(`/content/${id}`, {
                method: "PUT",
                body: JSON.stringify({ status: newStatus })
            });
        } catch (err: any) {
            alert("Failed to update status");
            loadContent(); // Revert
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

    if (!currentTenant) {
        return (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] text-muted-foreground">
                <div className="p-4 bg-muted/20 rounded-full mb-4">
                    <LayoutDashboard className="h-8 w-8 opacity-50" />
                </div>
                <h2 className="text-xl font-semibold mb-2">No Site Selected</h2>
                <p>Please select or create a site in the sidebar.</p>
            </div>
        );
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Content</h1>
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
                                    Slug will be: <span
                                    className="font-mono">/{newTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}</span>
                                </p>
                            </div>
                            <Button onClick={createPage} disabled={isCreating} className="w-full">
                                <>
                                    {isCreating ? (<Loader2 className="mr-2 h-4 w-4 animate-spin"/>) : ("Create")}
                                </>
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
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
                                    Export your WordPress content (Tools &rarr; Export &rarr; All content) and paste the
                                    XML content below.
                                    Images will be downloaded and re-uploaded to AMODX automatically.
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
                        {/* ... existing Create Page Button ... */}
                    </Dialog>
                </div>
            </div>

            {error && <div className="text-red-500 p-4 border border-red-200 rounded">{error}</div>}

            <div className="border rounded-md bg-white">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[400px]">Title</TableHead>
                            <TableHead className="w-[150px]">Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => (
                            <TableRow key={item.id}>
                                <TableCell className="font-medium">
                                    <div className="flex flex-col cursor-pointer"
                                         onClick={() => navigate(`/content/${item.nodeId}`)}>
                                        <span className="flex items-center gap-2 text-base">
                                            <FileText className="h-4 w-4 text-muted-foreground"/>
                                            {item.title}
                                        </span>
                                        <span className="text-xs text-muted-foreground ml-6 font-mono opacity-70">
                                            {item.slug || "/"}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Select
                                        defaultValue={item.status}
                                        onValueChange={(val) => updateStatus(item.nodeId, val)}
                                    >
                                        <SelectTrigger className="h-8 w-[130px]">
                                            <SelectValue/>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Draft">Draft</SelectItem>
                                            <SelectItem value="Published">Published</SelectItem>
                                            <SelectItem value="Archived">Archived</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="sm"
                                            onClick={() => navigate(`/content/${item.nodeId}`)}>
                                        Edit
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {items.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                                    No content found. Create your first page!
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
