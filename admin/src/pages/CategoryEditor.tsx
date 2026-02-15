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
import { Loader2, ArrowLeft, Save, Upload } from "lucide-react";
import { uploadFile } from "@/lib/upload";

interface CategoryOption {
    id: string;
    name: string;
    parentId: string | null;
}

export default function CategoryEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentTenant } = useTenant();
    const isNew = id === 'new';

    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [allCategories, setAllCategories] = useState<CategoryOption[]>([]);

    const [form, setForm] = useState({
        name: "",
        slug: "",
        description: "",
        parentId: null as string | null,
        sortOrder: 0,
        imageLink: "",
        seoTitle: "",
        seoDescription: "",
        status: "active",
    });

    useEffect(() => {
        if (currentTenant) {
            loadCategories();
            if (!isNew && id) loadCategory();
        }
    }, [id, currentTenant?.id]);

    async function loadCategories() {
        try {
            const res = await apiRequest("/categories");
            setAllCategories((res.items || []).map((c: any) => ({ id: c.id, name: c.name, parentId: c.parentId })));
        } catch (e) {
            console.error(e);
        }
    }

    async function loadCategory() {
        try {
            const data = await apiRequest(`/categories/${id}`);
            setForm({
                name: data.name || "",
                slug: data.slug || "",
                description: data.description || "",
                parentId: data.parentId || null,
                sortOrder: data.sortOrder || 0,
                imageLink: data.imageLink || "",
                seoTitle: data.seoTitle || "",
                seoDescription: data.seoDescription || "",
                status: data.status || "active",
            });
        } catch (e) {
            alert("Failed to load category");
            navigate("/categories");
        } finally {
            setLoading(false);
        }
    }

    function slugify(text: string) {
        return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    function handleNameChange(name: string) {
        const updates: any = { name };
        if (isNew || !form.slug) {
            updates.slug = slugify(name);
        }
        setForm({ ...form, ...updates });
    }

    async function handleSave() {
        if (!form.name) {
            alert("Name is required.");
            return;
        }

        setSaving(true);
        try {
            if (isNew) {
                await apiRequest("/categories", {
                    method: "POST",
                    body: JSON.stringify(form)
                });
            } else {
                await apiRequest(`/categories/${id}`, {
                    method: "PUT",
                    body: JSON.stringify(form)
                });
            }
            navigate("/categories");
        } catch (e: any) {
            alert("Save failed: " + e.message);
        } finally {
            setSaving(false);
        }
    }

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            try {
                const url = await uploadFile(e.target.files[0]);
                setForm({ ...form, imageLink: url });
            } catch (err) {
                alert("Upload failed");
            }
        }
    };

    // Filter out self and descendants to prevent circular parentId
    const parentOptions = allCategories.filter(c => c.id !== id);

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
            <header className="flex-none flex items-center justify-between px-6 py-3 border-b bg-card">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/categories")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold">{isNew ? "New Category" : "Edit Category"}</span>
                </div>
                <div className="flex gap-2">
                    <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                        <SelectTrigger className="w-[140px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="hidden">Hidden</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save
                    </Button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-8">
                <div className="max-w-3xl mx-auto space-y-6 pb-20">
                    <Card>
                        <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Name</Label>
                                <Input value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="e.g. Birthday Cookies" />
                            </div>
                            <div className="space-y-2">
                                <Label>Slug</Label>
                                <Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="birthday-cookies" />
                                <p className="text-xs text-muted-foreground">URL-safe identifier. Auto-generated from name.</p>
                            </div>
                            <div className="space-y-2">
                                <Label>Parent Category</Label>
                                <Select value={form.parentId || "_none"} onValueChange={v => setForm({ ...form, parentId: v === "_none" ? null : v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="_none">None (Top Level)</SelectItem>
                                        {parentOptions.map(c => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Sort Order</Label>
                                <Input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Description</Label>
                                <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} placeholder="Brief description of this category..." />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>Image</CardTitle></CardHeader>
                        <CardContent>
                            <div className="aspect-video max-w-sm bg-muted rounded-lg overflow-hidden border-2 border-dashed border-muted-foreground/25 flex items-center justify-center relative">
                                {form.imageLink ? (
                                    <img src={form.imageLink} className="w-full h-full object-cover" />
                                ) : (
                                    <Upload className="text-muted-foreground" />
                                )}
                                <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleImageUpload} />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>SEO</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>SEO Title</Label>
                                <Input value={form.seoTitle} onChange={e => setForm({ ...form, seoTitle: e.target.value })} placeholder="Category page title for search engines" />
                                <p className="text-xs text-muted-foreground">{(form.seoTitle || form.name).length}/60 characters</p>
                            </div>
                            <div className="space-y-2">
                                <Label>SEO Description</Label>
                                <Textarea value={form.seoDescription} onChange={e => setForm({ ...form, seoDescription: e.target.value })} rows={3} placeholder="Brief description for search engine results..." />
                                <p className="text-xs text-muted-foreground">{(form.seoDescription || "").length}/160 characters</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </main>
        </div>
    );
}
