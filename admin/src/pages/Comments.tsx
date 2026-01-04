import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { MessageSquare, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Comments() {
    const { currentTenant } = useTenant();
    const [comments, setComments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [pages, setPages] = useState<Record<string, string>>({}); // Map ID -> Title

    useEffect(() => {
        if (currentTenant) loadData();
    }, [currentTenant?.id]);

    async function loadData() {
        setLoading(true);
        try {
            // Parallel fetch: Content (for titles) and Comments
            const [contentRes, commentsRes] = await Promise.all([
                apiRequest("/content"),
                apiRequest("/comments") // No pageId = fetch all
            ]);

            // Create Page Map
            const pageMap: Record<string, string> = {};
            (contentRes.items || []).forEach((p: any) => pageMap[p.nodeId] = p.title);
            setPages(pageMap);

            setComments(commentsRes.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function updateStatus(comment: any, newStatus: string) {
        // Optimistic Update
        setComments(prev => prev.map(c => c.id === comment.id ? { ...c, status: newStatus } : c));

        try {
            await apiRequest("/comments", {
                method: "PUT",
                body: JSON.stringify({
                    action: "UPDATE_STATUS",
                    pageId: comment.pageId,
                    createdAt: comment.createdAt,
                    status: newStatus
                })
            });
        } catch (e) {
            alert("Failed to update");
            loadData(); // Revert
        }
    }

    async function deleteComment(comment: any) {
        if (!confirm("Delete this comment permanently?")) return;

        // Optimistic Delete
        setComments(prev => prev.filter(c => c.id !== comment.id));

        try {
            await apiRequest("/comments", {
                method: "PUT", // Using the same handler
                body: JSON.stringify({
                    action: "DELETE",
                    pageId: comment.pageId,
                    createdAt: comment.createdAt
                })
            });
        } catch (e) {
            alert("Failed to delete");
            loadData();
        }
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center gap-2">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
                <h1 className="text-3xl font-bold tracking-tight">Discussion</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>All Comments</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Author</TableHead>
                                <TableHead className="w-[50%]">Comment</TableHead>
                                <TableHead>Page</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {comments.map((c) => (
                                <TableRow key={c.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            {c.authorImage ? (
                                                <img src={c.authorImage} className="w-6 h-6 rounded-full" />
                                            ) : (
                                                <div className="w-6 h-6 bg-muted rounded-full flex items-center justify-center text-[10px]">{c.authorName[0]}</div>
                                            )}
                                            <div className="flex flex-col">
                                                <span className="font-medium text-sm">{c.authorName}</span>
                                                <span className="text-[10px] text-muted-foreground">{c.authorEmail}</span>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <p className="text-sm">{c.content}</p>
                                        <span className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-sm font-medium text-blue-600 truncate max-w-[150px] block" title={pages[c.pageId]}>
                                            {pages[c.pageId] || "Unknown Page"}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <Select value={c.status} onValueChange={(val) => updateStatus(c, val)}>
                                            <SelectTrigger className={`h-7 text-xs w-[100px] ${
                                                c.status === 'Approved' ? 'text-green-600 bg-green-50 border-green-200' :
                                                    c.status === 'Spam' ? 'text-red-600 bg-red-50 border-red-200' : 'text-amber-600 bg-amber-50'
                                            }`}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Approved">Approved</SelectItem>
                                                <SelectItem value="Pending">Pending</SelectItem>
                                                <SelectItem value="Spam">Spam</SelectItem>
                                                <SelectItem value="Hidden">Hidden</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => deleteComment(c)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {comments.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No comments yet.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
