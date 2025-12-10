import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { ContentItem } from "@amodx/shared";
import { useNavigate } from "react-router-dom";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {Plus, FileText, Loader2, LayoutDashboard} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useTenant } from "@/context/TenantContext";

export default function ContentList() {
    const { currentTenant } = useTenant();
    const [items, setItems] = useState<ContentItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // New State for Dialog
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    const navigate = useNavigate();

    useEffect(() => {
        if (currentTenant) {
            setLoading(true);
            loadContent();
        }
    }, [currentTenant?.id]); // Only trigger if tenant exists

    async function loadContent() {
        try {
            const data = await apiRequest("/content");
            setItems(data.items);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
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
            await loadContent(); // Refresh list
        } catch (err: any) {
            alert("Failed to create: " + err.message);
        } finally {
            setIsCreating(false);
        }
    }

    // 1. Guard Clause
    if (!currentTenant) {
        return (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] text-muted-foreground">
                <div className="p-4 bg-muted/20 rounded-full mb-4">
                    <LayoutDashboard className="h-8 w-8 opacity-50" />
                </div>
                <h2 className="text-xl font-semibold mb-2">No Site Selected</h2>
                <p>Please select or create a site in the sidebar to manage content.</p>
            </div>
        );
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Content</h1>

                {/* CREATE DIALOG */}
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button><Plus className="mr-2 h-4 w-4" /> Create Page</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create New Page</DialogTitle>
                        </DialogHeader>
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
                                    Slug will be generated automatically:
                                    <span className="font-mono ml-1">
                    /{newTitle.toLowerCase().replace(/ /g, "-").replace(/[^\w-]/g, "")}
                  </span>
                                </p>
                            </div>
                            <Button onClick={createPage} disabled={isCreating} className="w-full">
                                {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Create"}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {error && <div className="text-red-500 p-4 border border-red-200 rounded">{error}</div>}

            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Title</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => (
                            <TableRow key={item.id}>
                                <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                        <span className="flex items-center gap-2">
                                          <FileText className="h-4 w-4 text-muted-foreground" />
                                            {item.title}
                                        </span>
                                        {/* Show the Slug */}
                                        <span className="text-xs text-muted-foreground ml-6 font-mono">
                                            {item.slug || ". . . . . ."}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>{item.status}</TableCell>
                                <TableCell>Page</TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => navigate(`/content/${item.nodeId}`)}
                                    >
                                        Edit
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {items.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center">
                                    No content found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
