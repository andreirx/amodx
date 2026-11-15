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
import { BlockEditor } from "@/components/editor/BlockEditor";

interface CategoryOption {
    id: string;
    name: string;
    parentId: string | null;
}

type CategoryForm = {
    name: string; slug: string; description: string; parentId: string | null; sortOrder: number; imageLink: string;
    seoTitle: string; seoDescription: string; status: string; blocks: any[];
};

/**
 * The editor's form from a stored category (`GET /categories/{id}`). CATEGORY-CONTENT-1: `blocks` = the stored page content,
 * `[]` when the category has none or holds something that is not a list (the block editor then opens empty). Save sends the
 * whole form, `blocks` included (the update route replaces the stored list with it).
 */
export function categoryFormOf(data: any): CategoryForm {
    return {
        name: data.name || "",
        slug: data.slug || "",
        description: data.description || "",
        parentId: data.parentId || null,
        sortOrder: data.sortOrder || 0,
        imageLink: data.imageLink || "",
        seoTitle: data.seoTitle || "",
        seoDescription: data.seoDescription || "",
        status: data.status || "active",
        blocks: Array.isArray(data.blocks) ? data.blocks : [],
    };
}

/**
 * CATEGORY-CONTENT-1 (review-1): the token of the last editing session started. A session starts each time the editor
 * opens a category (or a new draft) for a tenant — so two visits to "new" are two sessions. Module scope: a plain
 * counter, read and incremented only by the load effect below.
 */
let lastEditingSession = 0;

/** One editing session: its token, the category it edits ("new" for a draft), the tenant it belongs to, and the form. */
type EditingSession = { session: number; id: string; tenantId: string; form: CategoryForm };

export default function CategoryEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentTenant } = useTenant();
    const isNew = id === 'new';

    const [saving, setSaving] = useState(false);
    const [allCategories, setAllCategories] = useState<CategoryOption[]>([]);

    // CATEGORY-CONTENT-1 (review-0, review-1): the form belongs to ONE editing session (`EditingSession`). A session starts
    // in the effect below each time the route's category or the tenant changes; a new draft is a session too. The page
    // shows the form, the block editor and Save only when the session is for the route's `id` AND the current tenant
    // (`ready`); otherwise a spinner. No form exists before the tenant is known.
    const [editing, setEditing] = useState<EditingSession | null>(null);
    const ready = editing !== null && editing.id === id && currentTenant != null && editing.tenantId === currentTenant.id;

    /**
     * The one way to change the form: `change` is applied to the CURRENT form (a functional update — a handler that an
     * older render created, such as the block editor's first `onChange`, cannot write an older copy back), and only while
     * the form still belongs to `forSession`, the session the action started in (an upload that ends after the owner
     * moved to another category, another tenant or another new draft changes nothing).
     */
    function edit(forSession: number | undefined, change: (form: CategoryForm) => CategoryForm) {
        setEditing((current) => (current && current.session === forSession ? { ...current, form: change(current.form) } : current));
    }

    useEffect(() => {
        // A new session. `isCurrent` is `false` once the route's category or the tenant changes: an answer that arrives
        // later belongs to an older session and is dropped — its form, its parent list and its failure alike.
        let isCurrent = true;
        const session = ++lastEditingSession;
        setEditing(null);
        setAllCategories([]);
        if (currentTenant && id) {
            const tenantId = currentTenant.id;
            if (isNew) setEditing({ session, id, tenantId, form: categoryFormOf({}) });
            apiRequest("/categories")
                .then((res) => {
                    if (isCurrent) setAllCategories((res.items || []).map((c: any) => ({ id: c.id, name: c.name, parentId: c.parentId })));
                })
                .catch((e) => console.error(e));
            if (!isNew) {
                apiRequest(`/categories/${id}`)
                    .then((data) => {
                        if (isCurrent) setEditing({ session, id, tenantId, form: categoryFormOf(data) });
                    })
                    .catch(() => {
                        if (!isCurrent) return;
                        alert("Failed to load category");
                        navigate("/categories");
                    });
            }
        }
        return () => { isCurrent = false; };
    }, [id, currentTenant?.id]);

    function slugify(text: string) {
        return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    function handleNameChange(name: string) {
        edit(editing?.session, (form) => ({ ...form, name, ...(isNew || !form.slug ? { slug: slugify(name) } : {}) }));
    }

    /** A plain field change of the shown form. */
    function setField(patch: Partial<CategoryForm>) {
        edit(editing?.session, (form) => ({ ...form, ...patch }));
    }

    async function handleSave() {
        if (!ready) return;
        const form = editing.form;
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
            const forSession = editing?.session;
            try {
                const url = await uploadFile(e.target.files[0]);
                edit(forSession, (form) => ({ ...form, imageLink: url }));
            } catch (err) {
                alert("Upload failed");
            }
        }
    };

    // Filter out self and descendants to prevent circular parentId
    const parentOptions = allCategories.filter(c => c.id !== id);

    if (!ready) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;
    const form = editing.form;

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
                    <Select value={form.status} onValueChange={v => setField({ status: v })}>
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
                                <Input value={form.slug} onChange={e => setField({ slug: e.target.value })} placeholder="birthday-cookies" />
                                <p className="text-xs text-muted-foreground">URL-safe identifier. Auto-generated from name.</p>
                            </div>
                            <div className="space-y-2">
                                <Label>Parent Category</Label>
                                <Select value={form.parentId || "_none"} onValueChange={v => setField({ parentId: v === "_none" ? null : v })}>
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
                                <Input type="number" value={form.sortOrder} onChange={e => setField({ sortOrder: parseInt(e.target.value) || 0 })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Description</Label>
                                <Textarea value={form.description} onChange={e => setField({ description: e.target.value })} rows={4} placeholder="Brief description of this category..." />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>Page content</CardTitle></CardHeader>
                        <CardContent className="space-y-2">
                            <p className="text-xs text-muted-foreground">Shown on the category page after the title and before the product list.</p>
                            {/* The block editor reads `initialContent` once: it mounts only when the session is `ready`, and is
                                keyed by the session, so every new session (another category, tenant or draft) mounts a new
                                editor on that session's blocks. Its changes go through `edit`, bound to its session. */}
                            <BlockEditor
                                key={editing.session}
                                initialContent={form.blocks}
                                onChange={(blocks) => edit(editing.session, (current) => ({ ...current, blocks }))}
                            />
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
                                <Input value={form.seoTitle} onChange={e => setField({ seoTitle: e.target.value })} placeholder="Category page title for search engines" />
                                <p className="text-xs text-muted-foreground">{(form.seoTitle || form.name).length}/60 characters</p>
                            </div>
                            <div className="space-y-2">
                                <Label>SEO Description</Label>
                                <Textarea value={form.seoDescription} onChange={e => setField({ seoDescription: e.target.value })} rows={3} placeholder="Brief description for search engine results..." />
                                <p className="text-xs text-muted-foreground">{(form.seoDescription || "").length}/160 characters</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </main>
        </div>
    );
}
