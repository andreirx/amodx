import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, Save, Upload, Trash2, Plus } from "lucide-react";
import { uploadFile } from "@/lib/upload";
import { FileBox } from "lucide-react";

export default function ProductEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isNew = id === 'new';

    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);

    // Form State (matching Schema)
    const [form, setForm] = useState({
        title: "",
        description: "",
        price: "",
        currency: "USD",
        salePrice: "",
        status: "draft",
        availability: "in_stock",
        inventoryQuantity: 0,
        brand: "",
        category: "",
        condition: "new",
        imageLink: "",
        additionalImageLinks: [] as string[],
        resourceId: "",
        paymentLinkId: ""
    });

    useEffect(() => {
        if (!isNew && id) loadProduct();
    }, [id]);

    async function loadProduct() {
        try {
            const data = await apiRequest(`/products/${id}`);
            setForm(data);
        } catch (e) {
            alert("Failed to load product");
            navigate("/products");
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        if (!form.title || !form.price || !form.imageLink) {
            alert("Title, Price, and Main Image are required.");
            return;
        }

        setSaving(true);
        try {
            if (isNew) {
                await apiRequest("/products", {
                    method: "POST",
                    body: JSON.stringify(form)
                });
            } else {
                await apiRequest(`/products/${id}`, {
                    method: "PUT",
                    body: JSON.stringify(form)
                });
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
                        <SelectTrigger className="w-[140px]">
                            <SelectValue />
                        </SelectTrigger>
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

            {/* Scrollable Form */}
            <main className="flex-1 overflow-y-auto p-8">
                <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 pb-20">

                    {/* Left: Main Details */}
                    <div className="lg:col-span-2 space-y-6">
                        <Card>
                            <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Title</Label>
                                    <Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g. Premium Sneaker" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Description (Plain text for AI)</Label>
                                    <Textarea
                                        value={form.description}
                                        onChange={e => setForm({...form, description: e.target.value})}
                                        rows={6}
                                        placeholder="Detailed description of features, materials, and benefits..."
                                    />
                                    <p className="text-xs text-muted-foreground text-right">{form.description.length}/5000</p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader><CardTitle>Pricing & Inventory</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Price</Label>
                                        <Input value={form.price} onChange={e => setForm({...form, price: e.target.value})} placeholder="99.00" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Currency</Label>
                                        <Input value={form.currency} onChange={e => setForm({...form, currency: e.target.value})} />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Sale Price (Optional)</Label>
                                    <Input value={form.salePrice || ""} onChange={e => setForm({...form, salePrice: e.target.value})} placeholder="79.00" />
                                </div>
                                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
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
                                        <Input
                                            type="number"
                                            value={form.inventoryQuantity || 0}
                                            onChange={e => setForm({...form, inventoryQuantity: parseInt(e.target.value)})}
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader><CardTitle>Categorization</CardTitle></CardHeader>
                            <CardContent className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Brand</Label>
                                    <Input value={form.brand || ""} onChange={e => setForm({...form, brand: e.target.value})} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Category</Label>
                                    <Input value={form.category || ""} onChange={e => setForm({...form, category: e.target.value})} placeholder="e.g. Apparel > Shoes" />
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
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right: Media & Commerce */}
                    <div className="space-y-6">
                        <Card>
                            <CardHeader><CardTitle>Media</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Main Image</Label>
                                    <div className="aspect-square bg-muted rounded-lg overflow-hidden border-2 border-dashed border-muted-foreground/25 flex items-center justify-center relative group">
                                        {form.imageLink ? (
                                            <img src={form.imageLink} className="w-full h-full object-cover" />
                                        ) : (
                                            <Upload className="text-muted-foreground" />
                                        )}
                                        <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => handleImageUpload(e, true)} />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>Gallery</Label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {form.additionalImageLinks.map((src, i) => (
                                            <div key={i} className="aspect-square bg-muted rounded overflow-hidden relative">
                                                <img src={src} className="w-full h-full object-cover" />
                                                <button
                                                    className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl"
                                                    onClick={() => setForm({ ...form, additionalImageLinks: form.additionalImageLinks.filter((_, idx) => idx !== i) })}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ))}
                                        <div className="aspect-square bg-muted rounded border-2 border-dashed border-muted-foreground/25 flex items-center justify-center relative">
                                            <Plus className="w-4 h-4 text-muted-foreground" />
                                            <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => handleImageUpload(e, false)} />
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Digital Delivery</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Resource ID (Optional)</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            value={form.resourceId || ""}
                                            onChange={e => setForm({...form, resourceId: e.target.value})}
                                            placeholder="Paste ID from Resources"
                                        />
                                        <Button variant="outline" size="icon" onClick={() => window.open('/resources', '_blank')} title="Find Resource ID">
                                            <FileBox className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        If set, the system will email a secure download link after purchase.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader><CardTitle>Paddle / Stripe</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Price ID / Payment Link</Label>
                                    <Input
                                        value={form.paymentLinkId || ""}
                                        onChange={e => setForm({...form, paymentLinkId: e.target.value})}
                                        placeholder="pri_01h..."
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        The ID from your payment provider to trigger checkout.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                </div>
            </main>
        </div>
    );
}
