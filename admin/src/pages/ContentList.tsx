import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type {ContentItem} from "@amodx/shared"; // Shared types!
// Shared types!
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, FileText } from "lucide-react";

export default function ContentList() {
    const [items, setItems] = useState<ContentItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        loadContent();
    }, []);

    async function loadContent() {
        try {
            // Calls GET /content via our helper
            const data = await apiRequest("/content");
            setItems(data.items);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function createPage() {
        try {
            setLoading(true);
            await apiRequest("/content", {
                method: "POST",
                body: JSON.stringify({
                    title: "New Untitled Page",
                    status: "Draft",
                    blocks: []
                })
            });
            await loadContent(); // Refresh list
        } catch (err: any) {
            alert("Failed to create: " + err.message);
            setLoading(false);
        }
    }

    if (loading && items.length === 0) return <div className="p-8">Loading...</div>;

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Content</h1>
                <Button onClick={createPage}>
                    <Plus className="mr-2 h-4 w-4" /> Create Page
                </Button>
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
                                <TableCell className="font-medium flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                    {item.title}
                                </TableCell>
                                <TableCell>{item.status}</TableCell>
                                <TableCell>Page</TableCell>
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="sm">Edit</Button>
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
