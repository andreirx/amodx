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
import { Loader2, ArrowLeft, Save, Upload, Trash2, Plus, X } from "lucide-react";
import { uploadFile } from "@/lib/upload";

const TABS = ["Basic", "Pricing", "Personalization", "Details", "Categories", "Media", "SEO"] as const;
type Tab = typeof TABS[number];

interface CategoryOption {
    id: string;
    name: string;
}

export default function ProductEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentTenant } = useTenant();
    const isNew = id === 'new';

    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>("Basic");
    const [allCategories, setAllCategories] = useState<CategoryOption[]>([]);

    const [form, setForm] = useState({
        title: "",
        slug: "",
        description: "",
        longDescription: "",
        price: "",
        currency: "RON",
        salePrice: "",
        status: "draft",
        availability: "in_stock",
        inventoryQuantity: 0,
        brand: "",
        condition: "new",
        imageLink: "",
        additionalImageLinks: [] as string[],
        resourceId: "",
        paymentLinkId: "",
        // New commerce fields
        categoryIds: [] as string[],
        tags: [] as string[],
        volumePricing: [] as { minQuantity: number; price: string }[],
        personalizations: [] as { id: string; label: string; type: string; required: boolean; maxLength?: number; options?: string[]; addedCost: string }[],
        variants: [] as { id: string; name: string; options: { value: string; priceOverride?: string; imageLink?: string; availability?: string }[] }[],
        ingredients: "",
        nutritionalValues: [] as { label: string; value: string; dailyPercent?: string }[],
        attributes: [] as { key: string; value: string }[],
        weight: 0,
        availableFrom: "",
        availableUntil: "",
        seoTitle: "",
        seoDescription: "",
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
            navigate("/products");
        } finally {
            setLoading(false);
        }
    }

    function slugify(text: string) {
        return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    function handleTitleChange(title: string) {
        const updates: any = { title };
        if (isNew || !form.slug) {
            updates.slug = slugify(title);
        }
        setForm({ ...form, ...updates });
    }

    async function handleSave() {
        if (!form.title || !form.price) {
            alert("Title and Price are required.");
            return;
        }

        setSaving(true);
        try {
            if (isNew) {
                await apiRequest("/products", { method: "POST", body: JSON.stringify(form) });
            } else {
                await apiRequest(`/products/${id}`, { method: "PUT", body: JSON.stringify(form) });
            }
            navigate("/products");
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
                    <Button variant="ghost" size="icon" onClick={() => navigate("/products")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold">{isNew ? "New Product" : "Edit Product"}</span>
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
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
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
                    {activeTab === "Pricing" && <PricingTab form={form} setForm={setForm} />}
                    {activeTab === "Personalization" && <PersonalizationTab form={form} setForm={setForm} />}
                    {activeTab === "Details" && <DetailsTab form={form} setForm={setForm} />}
                    {activeTab === "Categories" && <CategoriesTab form={form} setForm={setForm} allCategories={allCategories} />}
                    {activeTab === "Media" && <MediaTab form={form} setForm={setForm} onImageUpload={handleImageUpload} />}
                    {activeTab === "SEO" && <SEOTab form={form} setForm={setForm} />}
                </div>
            </main>
        </div>
    );
}

// --- TAB COMPONENTS ---

function BasicTab({ form, setForm, onTitleChange }: any) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Title</Label>
                        <Input value={form.title} onChange={e => onTitleChange(e.target.value)} placeholder="e.g. Birthday Cookie Box" />
                    </div>
                    <div className="space-y-2">
                        <Label>Slug</Label>
                        <Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="birthday-cookie-box" />
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

            <Card>
                <CardHeader><CardTitle>Classification</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Brand</Label>
                        <Input value={form.brand || ""} onChange={e => setForm({ ...form, brand: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label>Condition</Label>
                        <Select value={form.condition} onValueChange={v => setForm({ ...form, condition: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="new">New</SelectItem>
                                <SelectItem value="used">Used</SelectItem>
                                <SelectItem value="refurbished">Refurbished</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Sort Order</Label>
                        <Input type="number" value={form.sortOrder || 0} onChange={e => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-2">
                        <Label>Weight (grams)</Label>
                        <Input type="number" value={form.weight || 0} onChange={e => setForm({ ...form, weight: parseInt(e.target.value) || 0 })} />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function PricingTab({ form, setForm }: any) {
    const addVolumeTier = () => {
        setForm({ ...form, volumePricing: [...form.volumePricing, { minQuantity: 1, price: "" }] });
    };
    const removeVolumeTier = (index: number) => {
        setForm({ ...form, volumePricing: form.volumePricing.filter((_: any, i: number) => i !== index) });
    };
    const updateVolumeTier = (index: number, field: string, value: any) => {
        const updated = [...form.volumePricing];
        updated[index] = { ...updated[index], [field]: value };
        setForm({ ...form, volumePricing: updated });
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Pricing</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Price</Label>
                            <Input value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="99.00" />
                        </div>
                        <div className="space-y-2">
                            <Label>Currency</Label>
                            <Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Sale Price</Label>
                            <Input value={form.salePrice || ""} onChange={e => setForm({ ...form, salePrice: e.target.value })} placeholder="79.00" />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Volume Pricing</CardTitle>
                        <Button variant="outline" size="sm" onClick={addVolumeTier}>
                            <Plus className="mr-1 h-3 w-3" /> Add Tier
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {form.volumePricing.length === 0 && (
                        <p className="text-sm text-muted-foreground">No volume pricing tiers. Add one for quantity discounts.</p>
                    )}
                    {form.volumePricing.map((tier: any, i: number) => (
                        <div key={i} className="flex items-center gap-3">
                            <div className="flex-1 space-y-1">
                                <Label className="text-xs">Min Quantity</Label>
                                <Input type="number" value={tier.minQuantity} onChange={e => updateVolumeTier(i, 'minQuantity', parseInt(e.target.value) || 1)} />
                            </div>
                            <div className="flex-1 space-y-1">
                                <Label className="text-xs">Price per unit</Label>
                                <Input value={tier.price} onChange={e => updateVolumeTier(i, 'price', e.target.value)} placeholder="85.00" />
                            </div>
                            <Button variant="ghost" size="icon" className="mt-5 text-red-500" onClick={() => removeVolumeTier(i)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Inventory & Availability</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Availability</Label>
                            <Select value={form.availability} onValueChange={v => setForm({ ...form, availability: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="in_stock">In Stock</SelectItem>
                                    <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                                    <SelectItem value="preorder">Pre-order</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Quantity</Label>
                            <Input type="number" value={form.inventoryQuantity || 0} onChange={e => setForm({ ...form, inventoryQuantity: parseInt(e.target.value) })} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Available From</Label>
                            <Input type="date" value={form.availableFrom || ""} onChange={e => setForm({ ...form, availableFrom: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Available Until</Label>
                            <Input type="date" value={form.availableUntil || ""} onChange={e => setForm({ ...form, availableUntil: e.target.value })} />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function PersonalizationTab({ form, setForm }: any) {
    const addOption = () => {
        setForm({
            ...form,
            personalizations: [...form.personalizations, {
                id: crypto.randomUUID(),
                label: "",
                type: "text",
                required: false,
                maxLength: undefined,
                options: [],
                addedCost: "0"
            }]
        });
    };

    const removeOption = (index: number) => {
        setForm({ ...form, personalizations: form.personalizations.filter((_: any, i: number) => i !== index) });
    };

    const updateOption = (index: number, field: string, value: any) => {
        const updated = [...form.personalizations];
        updated[index] = { ...updated[index], [field]: value };
        setForm({ ...form, personalizations: updated });
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Personalization Options</CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">Let customers customize their order (e.g. text on cookies, flavor choice).</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={addOption}>
                        <Plus className="mr-1 h-3 w-3" /> Add Option
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {form.personalizations.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No personalization options. Add one to let customers customize products.</p>
                )}
                {form.personalizations.map((opt: any, i: number) => (
                    <div key={opt.id || i} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Option {i + 1}</span>
                            <Button variant="ghost" size="icon" className="text-red-500 h-8 w-8" onClick={() => removeOption(i)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Label</Label>
                                <Input value={opt.label} onChange={e => updateOption(i, 'label', e.target.value)} placeholder="e.g. Text on cookie" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Type</Label>
                                <Select value={opt.type} onValueChange={v => updateOption(i, 'type', v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="text">Text Input</SelectItem>
                                        <SelectItem value="select">Dropdown Select</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Added Cost</Label>
                                <Input value={opt.addedCost} onChange={e => updateOption(i, 'addedCost', e.target.value)} placeholder="0" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Max Length</Label>
                                <Input type="number" value={opt.maxLength || ""} onChange={e => updateOption(i, 'maxLength', parseInt(e.target.value) || undefined)} placeholder="50" />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={opt.required}
                                onChange={e => updateOption(i, 'required', e.target.checked)}
                                className="rounded"
                                id={`req-${i}`}
                            />
                            <label htmlFor={`req-${i}`} className="text-sm">Required</label>
                        </div>
                        {opt.type === "select" && (
                            <div className="space-y-1">
                                <Label className="text-xs">Options (comma-separated)</Label>
                                <Input
                                    value={(opt.options || []).join(", ")}
                                    onChange={e => updateOption(i, 'options', e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                                    placeholder="Chocolate, Vanilla, Strawberry"
                                />
                            </div>
                        )}
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}

function DetailsTab({ form, setForm }: any) {
    const addNutrition = () => {
        setForm({ ...form, nutritionalValues: [...form.nutritionalValues, { label: "", value: "", dailyPercent: "" }] });
    };
    const removeNutrition = (index: number) => {
        setForm({ ...form, nutritionalValues: form.nutritionalValues.filter((_: any, i: number) => i !== index) });
    };
    const updateNutrition = (index: number, field: string, value: string) => {
        const updated = [...form.nutritionalValues];
        updated[index] = { ...updated[index], [field]: value };
        setForm({ ...form, nutritionalValues: updated });
    };

    const addAttribute = () => {
        setForm({ ...form, attributes: [...form.attributes, { key: "", value: "" }] });
    };
    const removeAttribute = (index: number) => {
        setForm({ ...form, attributes: form.attributes.filter((_: any, i: number) => i !== index) });
    };
    const updateAttribute = (index: number, field: string, value: string) => {
        const updated = [...form.attributes];
        updated[index] = { ...updated[index], [field]: value };
        setForm({ ...form, attributes: updated });
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>Ingredients</CardTitle></CardHeader>
                <CardContent>
                    <Textarea
                        value={form.ingredients || ""}
                        onChange={e => setForm({ ...form, ingredients: e.target.value })}
                        rows={6}
                        placeholder="List of ingredients..."
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Nutritional Values</CardTitle>
                        <Button variant="outline" size="sm" onClick={addNutrition}>
                            <Plus className="mr-1 h-3 w-3" /> Add Row
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {form.nutritionalValues.length === 0 && (
                        <p className="text-sm text-muted-foreground">No nutritional values added.</p>
                    )}
                    {form.nutritionalValues.map((nv: any, i: number) => (
                        <div key={i} className="flex items-center gap-3">
                            <Input className="flex-1" value={nv.label} onChange={e => updateNutrition(i, 'label', e.target.value)} placeholder="Calories" />
                            <Input className="w-24" value={nv.value} onChange={e => updateNutrition(i, 'value', e.target.value)} placeholder="250kcal" />
                            <Input className="w-20" value={nv.dailyPercent || ""} onChange={e => updateNutrition(i, 'dailyPercent', e.target.value)} placeholder="12%" />
                            <Button variant="ghost" size="icon" className="text-red-500" onClick={() => removeNutrition(i)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Attributes</CardTitle>
                        <Button variant="outline" size="sm" onClick={addAttribute}>
                            <Plus className="mr-1 h-3 w-3" /> Add Attribute
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {form.attributes.length === 0 && (
                        <p className="text-sm text-muted-foreground">No attributes. Add key-value pairs like Weight, Flavor, etc.</p>
                    )}
                    {form.attributes.map((attr: any, i: number) => (
                        <div key={i} className="flex items-center gap-3">
                            <Input className="flex-1" value={attr.key} onChange={e => updateAttribute(i, 'key', e.target.value)} placeholder="Key (e.g. Flavor)" />
                            <Input className="flex-1" value={attr.value} onChange={e => updateAttribute(i, 'value', e.target.value)} placeholder="Value (e.g. Vanilla)" />
                            <Button variant="ghost" size="icon" className="text-red-500" onClick={() => removeAttribute(i)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
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

function MediaTab({ form, setForm, onImageUpload }: any) {
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
                <CardHeader><CardTitle>Digital Delivery</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                    <Label>Resource ID (Optional)</Label>
                    <div className="flex gap-2">
                        <Input value={form.resourceId || ""} onChange={e => setForm({ ...form, resourceId: e.target.value })} placeholder="Paste ID from Resources" />
                        <Button variant="outline" size="icon" onClick={() => window.open('/resources', '_blank')}>
                            <Upload className="h-4 w-4" />
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">If set, the system will email a secure download link after purchase.</p>
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
                    <p className="text-green-700 text-sm">example.com/produs/{form.slug || "product-slug"}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{form.seoDescription || form.description || "Product description..."}</p>
                </div>
            </CardContent>
        </Card>
    );
}
