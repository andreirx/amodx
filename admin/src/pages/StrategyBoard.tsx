import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import type { ContextItem } from "@amodx/shared";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";

export default function StrategyBoard() {
    const { currentTenant } = useTenant();
    const navigate = useNavigate();
    const [items, setItems] = useState<ContextItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (currentTenant) loadContext();
    }, [currentTenant?.id]);

    async function loadContext() {
        setLoading(true);
        try {
            const res = await apiRequest("/context");
            setItems(res.items);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    // Quick Create Handler
    async function createNew() {
        const title = prompt("Name your strategy doc:");
        if (!title) return;

        try {
            const res = await apiRequest("/context", {
                method: "POST",
                body: JSON.stringify({
                    title: title,
                    blocks: [],
                    tags: []
                })
            });
            navigate(`/strategy/${res.id}`);
        } catch (e) {
            alert("Failed to create");
        }
    }

    if (!currentTenant) return <div className="p-8 text-muted-foreground">Select a site.</div>;
    if (loading) return <div className="p-8"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Strategy & Context</h1>
                    <p className="text-muted-foreground">The brain of your agency.</p>
                </div>
                <Button onClick={createNew}><Plus className="mr-2 h-4 w-4" /> New Doc</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {items.map((item) => (
                    <Card
                        key={item.id}
                        className="cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => navigate(`/strategy/${item.id}`)}
                    >
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg">{item.title}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-2">
                                {item.tags.map(tag => (
                                    <span key={tag} className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
                                        {tag}
                                    </span>
                                ))}
                                {item.tags.length === 0 && <span className="text-xs text-muted-foreground italic">No tags</span>}
                            </div>
                            <p className="text-xs text-muted-foreground mt-4">
                                Updated: {new Date(item.updatedAt || item.createdAt).toLocaleDateString()}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
