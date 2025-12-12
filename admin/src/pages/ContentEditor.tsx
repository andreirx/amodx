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
    const [slug, setSlug] = useState("");

    useEffect(() => {
        if (id) loadContent(id);
    }, [id]);

    async function loadContent(nodeId: string) {
        try {
            const data = await apiRequest(`/content/${nodeId}`);
            setContent(data);
            setBlocks(data.blocks || []);
            setTitle(data.title);
            setSlug(data.slug || "");
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
                    slug: slug,
                    status: content?.status,
                    blocks: blocks
                })
            });
            // Refresh local state
            const updated = { ...content, title, slug } as ContentItem;
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
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden"> {/* No global scroll */}

            {/* 1. Global Header (Back, Status, Save) */}
            <header className="flex-none flex items-center justify-between px-6 py-3 border-b bg-card z-20">
                {/* ... (Existing Header Code) ... */}
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{content.status}</span>
                        <span className="text-sm font-medium text-muted-foreground">Last saved: ...</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={save} disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save Changes
                    </Button>
                </div>
            </header>

            {/* 2. Page Metadata (Title/Slug) - Scrollable or Fixed? Let's make it fixed/collapsible ideally, but for now just part of the scroll flow */}

            <main className="flex-1 flex flex-col min-h-0"> {/* min-h-0 allows flex child to scroll */}

                {/* Scrollable Container */}
                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-4xl mx-auto w-full p-8 pb-32"> {/* Added padding bottom */}

                        {/* Meta Fields */}
                        <div className="space-y-6 mb-8">
                            <div className="space-y-2">
                                <Label className="text-muted-foreground">Page Title</Label>
                                <Input
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    className="text-4xl font-black h-auto py-2 border-transparent hover:border-input focus:border-input px-0 bg-transparent shadow-none rounded-none border-b focus-visible:ring-0"
                                    placeholder="Untitled Page"
                                />
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>URL:</span>
                                <span className="font-mono bg-muted/50 px-2 py-0.5 rounded">/</span>
                                <Input
                                    value={slug.replace(/^\//, '')}
                                    onChange={(e) => setSlug(e.target.value)}
                                    className="font-mono h-auto py-0.5 px-1 w-auto min-w-[200px] border-transparent hover:border-input focus:border-input bg-transparent shadow-none"
                                    placeholder="slug"
                                />
                            </div>
                        </div>

                        {/*
                           THE EDITOR
                           We remove the internal scroll from BlockEditor and let the Page scroll.
                           BUT we make the Toolbar Sticky relative to this Main container.
                        */}
                        <BlockEditor
                            initialContent={blocks}
                            onChange={(newBlocks) => setBlocks(newBlocks)}
                        />
                    </div>
                </div>
            </main>
        </div>
    );
}
