import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import type { ContextItem } from "@amodx/shared";
import { Button } from "@/components/ui/button";
import { Plus, Target, User, Lightbulb, MessageSquare, Loader2, AlertCircle } from "lucide-react";
import {
    Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const TYPE_ICONS: Record<string, any> = {
    Strategy: Target,
    Persona: User,
    PainPoint: Lightbulb,
    BrandVoice: MessageSquare,
    Offer: Target,
};

export default function StrategyBoard() {
    const { currentTenant } = useTenant();
    const [items, setItems] = useState<ContextItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null); // <--- NEW
    const [isOpen, setIsOpen] = useState(false);

    // Form State
    const [newItemType, setNewItemType] = useState<string>("Strategy");
    const [newItemName, setNewItemName] = useState("");
    const [newItemData, setNewItemData] = useState("");

    useEffect(() => {
        if (currentTenant) {
            loadContext();
        }
    }, [currentTenant?.id]);

    async function loadContext() {
        setLoading(true);
        setError(null);
        try {
            const res = await apiRequest("/context");
            setItems(res.items);
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to load context");
        } finally {
            setLoading(false);
        }
    }

    async function handleCreate() {
        setError(null);
        try {
            await apiRequest("/context", {
                method: "POST",
                body: JSON.stringify({
                    type: newItemType,
                    name: newItemName,
                    data: newItemData,
                }),
            });
            setIsOpen(false);
            setNewItemName("");
            setNewItemData("");
            loadContext();
        } catch (e: any) {
            setError(e.message || "Failed to create context");
        }
    }

    // --- GUARD CLAUSE ---
    if (!currentTenant) {
        return (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] text-muted-foreground">
                <div className="p-4 bg-muted/20 rounded-full mb-4">
                    <Target className="h-8 w-8 opacity-50" />
                </div>
                <h2 className="text-xl font-semibold mb-2">No Site Selected</h2>
                <p>Select a site to manage strategy and personas.</p>
            </div>
        );
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    // Group items by type
    const grouped = items.reduce((acc, item) => {
        if (!acc[item.type]) acc[item.type] = [];
        acc[item.type].push(item);
        return acc;
    }, {} as Record<string, ContextItem[]>);

    const columns = ["Strategy", "Persona", "PainPoint", "Offer"];

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Strategy Board</h1>
                    <p className="text-muted-foreground">The context for your AI Agents.</p>
                </div>

                <Dialog open={isOpen} onOpenChange={setIsOpen}>
                    <DialogTrigger asChild>
                        <Button><Plus className="mr-2 h-4 w-4" /> Add Context</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add New Context</DialogTitle>
                        </DialogHeader>

                        {/* ERROR INSIDE DIALOG */}
                        {error && (
                            <div className="bg-red-50 text-red-600 px-3 py-2 rounded text-sm mb-2">
                                {error}
                            </div>
                        )}

                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Type</Label>
                                <Select value={newItemType} onValueChange={setNewItemType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {columns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                        <SelectItem value="BrandVoice">Brand Voice</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Name / Title</Label>
                                <Input
                                    placeholder="e.g., Angry Dad Persona"
                                    value={newItemName}
                                    onChange={e => setNewItemName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Description / Data</Label>
                                <Textarea
                                    placeholder="Describe the persona, pain points, or strategy details..."
                                    className="h-32"
                                    value={newItemData}
                                    onChange={e => setNewItemData(e.target.value)}
                                />
                            </div>
                            <Button onClick={handleCreate} className="w-full">Save Context</Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* ERROR BANNER MAIN PAGE */}
            {error && !isOpen && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {columns.map((col) => {
                    const Icon = TYPE_ICONS[col] || Target;
                    return (
                        <div key={col} className="space-y-4">
                            <div className="flex items-center gap-2 font-semibold text-lg text-muted-foreground border-b pb-2">
                                <Icon className="h-5 w-5" />
                                {col}
                            </div>

                            <div className="space-y-3">
                                {grouped[col]?.map((item) => (
                                    <Card key={item.id}>
                                        <CardHeader className="p-4 pb-2">
                                            <CardTitle className="text-base">{item.name}</CardTitle>
                                        </CardHeader>
                                        <CardContent className="p-4 pt-0 text-sm text-muted-foreground whitespace-pre-wrap">
                                            {item.data}
                                        </CardContent>
                                    </Card>
                                ))}
                                {!grouped[col] && (
                                    <div className="h-24 border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground text-sm opacity-50">
                                        No items
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
