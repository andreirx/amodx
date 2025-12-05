import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import type { ContentItem } from "@amodx/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, ArrowLeft, Loader2 } from "lucide-react";
import { BlockEditor } from "@/components/editor/BlockEditor";


export default function ContentEditor() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [content, setContent] = useState<ContentItem | null>(null);
    const [blocks, setBlocks] = useState<any[]>([]);
    const [title, setTitle] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (id) loadContent(id);
    }, [id]);

    async function loadContent(nodeId: string) {
        try {
            const data = await apiRequest(`/content/${nodeId}`);
            setContent(data);
            setBlocks(data.blocks || []);
            setTitle(data.title);
        } catch (err) {
            console.error(err);
            alert("Failed to load content");
        } finally {
            setLoading(false);
        }
    }

    async function save() {
        if (!id) return;
        try {
            setSaving(true);
            await apiRequest(`/content/${id}`, {
                method: "PUT",
                body: JSON.stringify({
                    title: title,
                    status: content?.status,
                    blocks: blocks
                })
            });
            // Refresh local state
            const updated = { ...content, title } as ContentItem;
            setContent(updated);
        } catch (err: any) {
            alert("Failed to save: " + err.message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;
    if (!content) return <div className="p-8">Content not found</div>;

    return (
        <div className="flex flex-col h-screen bg-background text-foreground">
            {/* Header / Toolbar */}
            <header className="flex items-center justify-between px-6 py-3 border-b bg-card">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex flex-col">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
              {content.status}
            </span>
                        <span className="text-sm font-medium text-muted-foreground">
              Last saved: {new Date(content.createdAt).toLocaleDateString()}
                            {/* Note: In real app we'd use updatedAt */}
            </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={save} disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save Changes
                    </Button>
                </div>
            </header>

            {/* Main Edit Area */}
            <main className="flex-1 overflow-auto p-8 max-w-4xl mx-auto w-full space-y-8">

                {/* Title Field */}
                <div className="space-y-2">
                    <Label htmlFor="title" className="text-muted-foreground">Page Title</Label>
                    <Input
                        id="title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="text-3xl font-bold h-auto py-2 border-transparent hover:border-input focus:border-input transition-colors px-0"
                        placeholder="Untitled Page"
                    />
                </div>

                {/* Editor Area */}
                <div className="space-y-2">
                    <Label className="text-muted-foreground">Content</Label>
                    <BlockEditor
                        initialContent={blocks}
                        onChange={(newBlocks) => setBlocks(newBlocks)}
                    />
                </div>

            </main>
        </div>
    );
}
