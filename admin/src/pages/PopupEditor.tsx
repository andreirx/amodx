import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, Save, Trash2 } from "lucide-react";

export default function PopupEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentTenant } = useTenant();
    const isNew = id === "new";

    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);

    const [form, setForm] = useState({
        name: "",
        type: "announcement",
        status: "active",
        headline: "",
        body: "",
        imageUrl: "",
        ctaText: "",
        ctaLink: "",
        trigger: "page_load",
        triggerValue: "",
        showOnPages: "",
        showOncePerSession: false,
    });

    useEffect(() => {
        if (currentTenant && !isNew && id) loadPopup();
    }, [id, currentTenant?.id]);

    async function loadPopup() {
        try {
            const data = await apiRequest(`/popups/${id}`);
            setForm(prev => ({
                ...prev,
                ...data,
                showOnPages: Array.isArray(data.showOnPages)
                    ? data.showOnPages.join(", ")
                    : data.showOnPages || "",
            }));
        } catch (e) {
            alert("Failed to load popup");
            navigate("/popups");
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        if (!form.name.trim()) {
            alert("Name is required.");
            return;
        }

        setSaving(true);
        try {
            const payload = {
                ...form,
                showOnPages: form.showOnPages
                    ? form.showOnPages.split(",").map(s => s.trim()).filter(Boolean)
                    : [],
            };

            if (isNew) {
                await apiRequest("/popups", { method: "POST", body: JSON.stringify(payload) });
            } else {
                await apiRequest(`/popups/${id}`, { method: "PUT", body: JSON.stringify(payload) });
            }
            navigate("/popups");
        } catch (e: any) {
            alert("Save failed: " + e.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!confirm("Are you sure you want to delete this popup? This cannot be undone.")) return;
        try {
            await apiRequest(`/popups/${id}`, { method: "DELETE" });
            navigate("/popups");
        } catch (e: any) {
            alert("Delete failed: " + e.message);
        }
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
            {/* Header */}
            <header className="flex-none flex items-center justify-between px-6 py-3 border-b bg-card">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/popups")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold">{isNew ? "New Popup" : "Edit Popup"}</span>
                </div>
                <div className="flex items-center gap-2">
                    {!isNew && (
                        <Button variant="destructive" onClick={handleDelete}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </Button>
                    )}
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save
                    </Button>
                </div>
            </header>

            {/* Content */}
            <main className="flex-1 overflow-y-auto p-8">
                <div className="max-w-2xl mx-auto space-y-6 pb-20">
                    <Button variant="link" className="px-0" onClick={() => navigate("/popups")}>
                        &larr; Back to Popups
                    </Button>

                    {/* General */}
                    <Card>
                        <CardHeader><CardTitle>General</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Name *</Label>
                                <Input
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    placeholder="e.g. Summer Sale Banner"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Type</Label>
                                    <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="announcement">Announcement</SelectItem>
                                            <SelectItem value="newsletter">Newsletter</SelectItem>
                                            <SelectItem value="promotion">Promotion</SelectItem>
                                            <SelectItem value="custom">Custom</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Status</Label>
                                    <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="disabled">Disabled</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Content */}
                    <Card>
                        <CardHeader><CardTitle>Content</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Headline</Label>
                                <Input
                                    value={form.headline}
                                    onChange={e => setForm({ ...form, headline: e.target.value })}
                                    placeholder="e.g. Don't miss out!"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Body</Label>
                                <Textarea
                                    value={form.body}
                                    onChange={e => setForm({ ...form, body: e.target.value })}
                                    placeholder="Popup body content (supports HTML)"
                                    rows={5}
                                />
                                <p className="text-xs text-muted-foreground">You can use HTML for rich formatting.</p>
                            </div>

                            <div className="space-y-2">
                                <Label>Image URL</Label>
                                <Input
                                    value={form.imageUrl}
                                    onChange={e => setForm({ ...form, imageUrl: e.target.value })}
                                    placeholder="https://..."
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Call to Action */}
                    <Card>
                        <CardHeader><CardTitle>Call to Action</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>CTA Text</Label>
                                    <Input
                                        value={form.ctaText}
                                        onChange={e => setForm({ ...form, ctaText: e.target.value })}
                                        placeholder="e.g. Shop Now"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>CTA Link</Label>
                                    <Input
                                        value={form.ctaLink}
                                        onChange={e => setForm({ ...form, ctaLink: e.target.value })}
                                        placeholder="e.g. /products or https://..."
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Trigger & Display Rules */}
                    <Card>
                        <CardHeader><CardTitle>Trigger & Display Rules</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Trigger</Label>
                                    <Select value={form.trigger} onValueChange={v => setForm({ ...form, trigger: v })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="page_load">Page Load</SelectItem>
                                            <SelectItem value="exit_intent">Exit Intent</SelectItem>
                                            <SelectItem value="scroll">Scroll</SelectItem>
                                            <SelectItem value="time_delay">Time Delay</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Trigger Value</Label>
                                    <Input
                                        value={form.triggerValue}
                                        onChange={e => setForm({ ...form, triggerValue: e.target.value })}
                                        placeholder={
                                            form.trigger === "time_delay"
                                                ? "Delay in seconds (e.g. 5)"
                                                : form.trigger === "scroll"
                                                ? "Scroll % (e.g. 50)"
                                                : "Optional"
                                        }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {form.trigger === "time_delay" && "Seconds before the popup appears."}
                                        {form.trigger === "scroll" && "Scroll percentage to trigger the popup."}
                                        {form.trigger === "exit_intent" && "No value needed for exit intent."}
                                        {form.trigger === "page_load" && "No value needed for page load."}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Show On Pages</Label>
                                <Input
                                    value={form.showOnPages}
                                    onChange={e => setForm({ ...form, showOnPages: e.target.value })}
                                    placeholder="e.g. /, /products, /about"
                                />
                                <p className="text-xs text-muted-foreground">Comma-separated paths. Leave empty to show on all pages.</p>
                            </div>

                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="showOncePerSession"
                                    checked={form.showOncePerSession}
                                    onChange={e => setForm({ ...form, showOncePerSession: e.target.checked })}
                                    className="h-4 w-4 rounded border-input accent-primary"
                                />
                                <Label htmlFor="showOncePerSession" className="cursor-pointer">
                                    Show once per session
                                </Label>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </main>
        </div>
    );
}
