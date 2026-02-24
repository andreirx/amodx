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
import { TagInput } from "@/components/ui/tag-input";
import { Loader2, ArrowLeft, Save, Upload, Trash2, Plus } from "lucide-react";
import { uploadFile } from "@/lib/upload";

const TABS = ["Basic", "Paddle", "Media & Files", "Categories", "SEO"] as const;
type Tab = typeof TABS[number];

interface CategoryOption {
    id: string;
    name: string;
}

export default function DigitalProductEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentTenant } = useTenant();
    const isNew = id === "new";

    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>("Basic");
    const [allCategories, setAllCategories] = useState<CategoryOption[]>([]);

    const [form, setForm] = useState({
        title: "",
        slug: "",
        description: "",
        longDescription: "",
        status: "draft",
        imageLink: "",
        additionalImageLinks: [] as string[],
        paymentLinkId: "",
        resourceId: "",
        categoryIds: [] as string[],
        tags: [] as string[],
        seoTitle: "",
        seoDescription: "",
        // Informational — Paddle controls actual pricing
        price: "",
        currency: "",
        sortOrder: 0,
    });

    useEffect(() => {
        if (currentTenant) {
            loadCategories();
            if (!isNew && id) loadProduct();
        }
    }, [id, currentTenant?.id]);

    async function loadCategories() {
        try {
            const res = await apiRequest("/categories");
            setAllCategories((res.items || []).map((c: any) => ({ id: c.id, name: c.name })));
        } catch (e) {
            console.error(e);
        }
    }

    async function loadProduct() {
        try {
            const data = await apiRequest(`/products/${id}`);
            setForm(prev => ({ ...prev, ...data }));
        } catch (e) {
            alert("Failed to load product");
            navigate("/digital-products");
        } finally {
            setLoading(false);
        }
    }

    function slugify(text: string) {
        return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }

    function handleTitleChange(title: string) {
        const updates: any = { title };
        if (isNew || !form.slug) {
            updates.slug = slugify(title);
        }
        setForm({ ...form, ...updates });
    }

    async function handleSave() {
        if (!form.title) {
            alert("Title is required.");
            return;
        }

        setSaving(true);
        try {
            const payload = { ...form, productType: "digital" };
            if (isNew) {
                await apiRequest("/products", { method: "POST", body: JSON.stringify(payload) });
            } else {
                await apiRequest(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
            }
            navigate("/digital-products");
        } catch (e: any) {
            alert("Save failed: " + e.message);
        } finally {
            setSaving(false);
        }
    }

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, isMain: boolean) => {
        if (e.target.files?.[0]) {
            try {
                const url = await uploadFile(e.target.files[0]);
                if (isMain) {
                    setForm({ ...form, imageLink: url });
                } else {
                    setForm({ ...form, additionalImageLinks: [...form.additionalImageLinks, url] });
                }
            } catch (err) {
                alert("Upload failed");
            }
        }
    };

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
            {/* Header */}
            <header className="flex-none flex items-center justify-between px-6 py-3 border-b bg-card">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/digital-products")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold">{isNew ? "New Digital Product" : "Edit Digital Product"}</span>
                </div>
                <div className="flex gap-2">
                    <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                        <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save
                    </Button>
                </div>
            </header>

            {/* Tabs */}
            <div className="flex-none border-b bg-card px-6">
                <div className="flex gap-1 overflow-x-auto">
                    {TABS.map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                                activeTab === tab
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <main className="flex-1 overflow-y-auto p-8">
                <div className="max-w-4xl mx-auto pb-20">
                    {activeTab === "Basic" && <BasicTab form={form} setForm={setForm} onTitleChange={handleTitleChange} />}
                    {activeTab === "Paddle" && <PaddleTab form={form} setForm={setForm} />}
                    {activeTab === "Media & Files" && <MediaFilesTab form={form} setForm={setForm} onImageUpload={handleImageUpload} />}
                    {activeTab === "Categories" && <CategoriesTab form={form} setForm={setForm} allCategories={allCategories} />}
                    {activeTab === "SEO" && <SEOTab form={form} setForm={setForm} />}
                </div>
            </main>
        </div>
    );
}

// --- TAB COMPONENTS ---

function BasicTab({ form, setForm, onTitleChange }: any) {
    return (
        <Card>
            <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Title</Label>
                    <Input value={form.title} onChange={e => onTitleChange(e.target.value)} placeholder="e.g. Premium Template Pack" />
                </div>
                <div className="space-y-2">
                    <Label>Slug</Label>
                    <Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="premium-template-pack" />
                    <p className="text-xs text-muted-foreground">URL-safe identifier. Auto-generated from title.</p>
                </div>
                <div className="space-y-2">
                    <Label>Short Description</Label>
                    <Textarea
                        value={form.description}
                        onChange={e => setForm({ ...form, description: e.target.value })}
                        rows={4}
                        placeholder="Brief product summary for listings and AI..."
                    />
                    <p className="text-xs text-muted-foreground text-right">{(form.description || "").length}/5000</p>
                </div>
                <div className="space-y-2">
                    <Label>Long Description (Rich Text)</Label>
                    <Textarea
                        value={form.longDescription}
                        onChange={e => setForm({ ...form, longDescription: e.target.value })}
                        rows={10}
                        placeholder="Full product description with HTML support..."
                    />
                    <p className="text-xs text-muted-foreground">Supports HTML. Displayed on the product detail page.</p>
                </div>
            </CardContent>
        </Card>
    );
}

function PaddleTab({ form, setForm }: any) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Paddle Integration</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Payment Link ID</Label>
                        <Input
                            value={form.paymentLinkId || ""}
                            onChange={e => setForm({ ...form, paymentLinkId: e.target.value })}
                            placeholder="e.g. pri_01abc..."
                            className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                            The Paddle payment link ID. This enables the "Buy Now" button on the product page.
                        </p>
                    </div>
                    <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
                        <p className="text-sm text-blue-800">
                            Pricing, currency, and regional availability are managed in your{" "}
                            <a href="https://vendors.paddle.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">
                                Paddle dashboard
                            </a>. The fields below are for display purposes only.
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Display Price (Informational)</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Optional. Show a reference price on your site. Paddle handles actual checkout pricing and may adjust for customer location.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Display Price</Label>
                            <Input value={form.price || ""} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="29.00" />
                        </div>
                        <div className="space-y-2">
                            <Label>Currency</Label>
                            <Input value={form.currency || ""} onChange={e => setForm({ ...form, currency: e.target.value })} placeholder="USD" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function MediaFilesTab({ form, setForm, onImageUpload }: any) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Main Image</CardTitle></CardHeader>
                <CardContent>
                    <div className="aspect-square max-w-xs bg-muted rounded-lg overflow-hidden border-2 border-dashed border-muted-foreground/25 flex items-center justify-center relative group">
                        {form.imageLink ? (
                            <img src={form.imageLink} className="w-full h-full object-cover" />
                        ) : (
                            <Upload className="text-muted-foreground" />
                        )}
                        <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e: any) => onImageUpload(e, true)} />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Gallery</CardTitle></CardHeader>
                <CardContent>
                    <div className="grid grid-cols-4 gap-3">
                        {(form.additionalImageLinks || []).map((src: string, i: number) => (
                            <div key={i} className="aspect-square bg-muted rounded overflow-hidden relative">
                                <img src={src} className="w-full h-full object-cover" />
                                <button
                                    className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl"
                                    onClick={() => setForm({ ...form, additionalImageLinks: form.additionalImageLinks.filter((_: any, idx: number) => idx !== i) })}
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                        <div className="aspect-square bg-muted rounded border-2 border-dashed border-muted-foreground/25 flex items-center justify-center relative">
                            <Plus className="w-4 h-4 text-muted-foreground" />
                            <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e: any) => onImageUpload(e, false)} />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Downloadable File</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                    <Label>Resource ID</Label>
                    <div className="flex gap-2">
                        <Input value={form.resourceId || ""} onChange={e => setForm({ ...form, resourceId: e.target.value })} placeholder="Paste ID from Resources" />
                        <Button variant="outline" size="icon" onClick={() => window.open("/resources", "_blank")}>
                            <Upload className="h-4 w-4" />
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Link a file from the Resources page. This file will be delivered via secure download link after purchase.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

function CategoriesTab({ form, setForm, allCategories }: any) {
    const toggleCategory = (catId: string) => {
        const current = form.categoryIds || [];
        if (current.includes(catId)) {
            setForm({ ...form, categoryIds: current.filter((id: string) => id !== catId) });
        } else {
            setForm({ ...form, categoryIds: [...current, catId] });
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Categories</CardTitle></CardHeader>
                <CardContent>
                    {allCategories.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No categories created yet. Create categories first.</p>
                    ) : (
                        <div className="space-y-2">
                            {allCategories.map((cat: CategoryOption) => (
                                <label key={cat.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={(form.categoryIds || []).includes(cat.id)}
                                        onChange={() => toggleCategory(cat.id)}
                                        className="rounded"
                                    />
                                    <span className="text-sm">{cat.name}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Tags</CardTitle></CardHeader>
                <CardContent>
                    <TagInput
                        value={form.tags || []}
                        onChange={tags => setForm({ ...form, tags })}
                        placeholder="Add tags..."
                    />
                </CardContent>
            </Card>
        </div>
    );
}

function SEOTab({ form, setForm }: any) {
    return (
        <Card>
            <CardHeader><CardTitle>Search Engine Optimization</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>SEO Title</Label>
                    <Input
                        value={form.seoTitle || ""}
                        onChange={e => setForm({ ...form, seoTitle: e.target.value })}
                        placeholder={form.title || "Product page title for search engines"}
                    />
                    <p className="text-xs text-muted-foreground">{(form.seoTitle || form.title || "").length}/60 characters</p>
                </div>
                <div className="space-y-2">
                    <Label>SEO Description</Label>
                    <Textarea
                        value={form.seoDescription || ""}
                        onChange={e => setForm({ ...form, seoDescription: e.target.value })}
                        rows={3}
                        placeholder="Brief description for search engine results..."
                    />
                    <p className="text-xs text-muted-foreground">{(form.seoDescription || "").length}/160 characters</p>
                </div>

                {/* Preview */}
                <div className="mt-6 border rounded-lg p-4 bg-muted/50">
                    <p className="text-xs text-muted-foreground mb-2">Search Preview</p>
                    <p className="text-blue-600 text-lg font-medium truncate">{form.seoTitle || form.title || "Product Title"}</p>
                    <p className="text-green-700 text-sm">example.com/product/{form.slug || "product-slug"}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{form.seoDescription || form.description || "Product description..."}</p>
                </div>
            </CardContent>
        </Card>
    );
}
