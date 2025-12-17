import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save, Loader2, Trash2 } from "lucide-react";
import { BlockEditor } from "@/components/editor/BlockEditor";

export default function StrategyEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [title, setTitle] = useState("");
    const [blocks, setBlocks] = useState<any[]>([]);
    const [tags, setTags] = useState(""); // Comma separated for now
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (id) load();
    }, [id]);

    async function load() {
        try {
            const data = await apiRequest(`/context/${id}`);
            setTitle(data.title);
            setBlocks(data.blocks || []);
            setTags(data.tags?.join(", ") || "");
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function save() {
        setSaving(true);
        try {
            await apiRequest(`/context/${id}`, {
                method: "PUT",
                body: JSON.stringify({
                    title,
                    blocks,
                    tags: tags.split(",").map(t => t.trim()).filter(Boolean)
                })
            });
        } catch (e) {
            alert("Failed to save");
        } finally {
            setSaving(false);
        }
    }

    async function remove() {
        if(!confirm("Are you sure?")) return;
        await apiRequest(`/context/${id}`, { method: "DELETE" });
        navigate("/strategy");
    }

    if (loading) return <div className="p-8"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-screen bg-background text-foreground">
            <header className="flex-none flex items-center justify-between px-6 py-3 border-b bg-card">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/strategy")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold text-sm">Context Document</span>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="destructive" size="icon" onClick={remove}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button onClick={save} disabled={saving}><>
                        {saving ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                    </>
                        Save
                    </Button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-8">
                <div className="max-w-4xl mx-auto w-full space-y-6 pb-20">
                    <Input
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        className="text-4xl font-black h-auto py-2 border-transparent bg-transparent shadow-none px-0"
                        placeholder="Strategy Title"
                    />

                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">Tags:</span>
                        <Input
                            value={tags}
                            onChange={e => setTags(e.target.value)}
                            placeholder="Persona, Q1, Goals..."
                            className="h-8 w-full max-w-md"
                        />
                    </div>

                    <BlockEditor
                        initialContent={blocks}
                        onChange={setBlocks}
                    />
                </div>
            </main>
        </div>
    );
}
