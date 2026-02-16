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
import { Loader2, ArrowLeft, Save, Plus, X, GripVertical, Trash2 } from "lucide-react";

type FormField = {
    id: string;
    label: string;
    type: string;
    required: boolean;
    placeholder: string;
    options: string[];
};

const FIELD_TYPES = [
    { value: "text", label: "Text" },
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
    { value: "textarea", label: "Textarea" },
    { value: "select", label: "Select" },
    { value: "checkbox", label: "Checkbox" },
    { value: "number", label: "Number" },
];

function slugify(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-");
}

export default function FormEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentTenant } = useTenant();
    const isNew = id === "new";

    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [slugTouched, setSlugTouched] = useState(false);

    const [form, setForm] = useState({
        name: "",
        slug: "",
        status: "active",
        submitButtonText: "Submit",
        successMessage: "",
        notifyEmail: "",
    });

    const [fields, setFields] = useState<FormField[]>([]);

    useEffect(() => {
        if (currentTenant && !isNew && id) loadForm();
    }, [id, currentTenant?.id]);

    async function loadForm() {
        try {
            const data = await apiRequest(`/forms/${id}`);
            setForm({
                name: data.name || "",
                slug: data.slug || "",
                status: data.status || "active",
                submitButtonText: data.submitButtonText || "Submit",
                successMessage: data.successMessage || "",
                notifyEmail: data.notifyEmail || "",
            });
            setFields(
                (data.fields || []).map((f: any) => ({
                    id: f.id || crypto.randomUUID(),
                    label: f.label || "",
                    type: f.type || "text",
                    required: f.required || false,
                    placeholder: f.placeholder || "",
                    options: f.options || [],
                }))
            );
            setSlugTouched(true);
        } catch (e) {
            alert("Failed to load form");
            navigate("/forms");
        } finally {
            setLoading(false);
        }
    }

    function handleNameChange(name: string) {
        setForm(prev => ({
            ...prev,
            name,
            ...(!slugTouched ? { slug: slugify(name) } : {}),
        }));
    }

    function addField() {
        setFields(prev => [
            ...prev,
            {
                id: crypto.randomUUID(),
                label: "",
                type: "text",
                required: false,
                placeholder: "",
                options: [],
            },
        ]);
    }

    function updateField(fieldId: string, updates: Partial<FormField>) {
        setFields(prev =>
            prev.map(f => (f.id === fieldId ? { ...f, ...updates } : f))
        );
    }

    function removeField(fieldId: string) {
        setFields(prev => prev.filter(f => f.id !== fieldId));
    }

    async function handleSave() {
        if (!form.name.trim()) {
            alert("Name is required.");
            return;
        }
        if (!form.slug.trim()) {
            alert("Slug is required.");
            return;
        }

        const payload = {
            ...form,
            fields,
        };

        setSaving(true);
        try {
            if (isNew) {
                await apiRequest("/forms", { method: "POST", body: JSON.stringify(payload) });
            } else {
                await apiRequest(`/forms/${id}`, { method: "PUT", body: JSON.stringify(payload) });
            }
            navigate("/forms");
        } catch (e: any) {
            alert("Save failed: " + e.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!confirm("Are you sure you want to delete this form? This will also delete all submissions.")) return;
        try {
            await apiRequest(`/forms/${id}`, { method: "DELETE" });
            navigate("/forms");
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
                    <Button variant="ghost" size="icon" onClick={() => navigate("/forms")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold">{isNew ? "New Form" : "Edit Form"}</span>
                </div>
                <div className="flex items-center gap-2">
                    {!isNew && (
                        <Button variant="outline" className="text-red-500 hover:text-red-600" onClick={handleDelete}>
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
                <div className="max-w-3xl mx-auto space-y-6 pb-20">
                    <Button variant="link" className="px-0" onClick={() => navigate("/forms")}>
                        &larr; Back to Forms
                    </Button>

                    {/* Form Details */}
                    <Card>
                        <CardHeader><CardTitle>Form Details</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Name</Label>
                                    <Input
                                        value={form.name}
                                        onChange={e => handleNameChange(e.target.value)}
                                        placeholder="e.g. Contact Form"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Slug</Label>
                                    <Input
                                        value={form.slug}
                                        onChange={e => {
                                            setSlugTouched(true);
                                            setForm({ ...form, slug: e.target.value });
                                        }}
                                        placeholder="e.g. contact-form"
                                    />
                                    <p className="text-xs text-muted-foreground">Used to identify this form in the renderer.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
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
                                <div className="space-y-2">
                                    <Label>Submit Button Text</Label>
                                    <Input
                                        value={form.submitButtonText}
                                        onChange={e => setForm({ ...form, submitButtonText: e.target.value })}
                                        placeholder="Submit"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Success Message</Label>
                                <Textarea
                                    value={form.successMessage}
                                    onChange={e => setForm({ ...form, successMessage: e.target.value })}
                                    placeholder="Thank you for your submission!"
                                    rows={3}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Notify Email</Label>
                                <Input
                                    value={form.notifyEmail}
                                    onChange={e => setForm({ ...form, notifyEmail: e.target.value })}
                                    placeholder="admin@example.com"
                                />
                                <p className="text-xs text-muted-foreground">Receive an email notification for each new submission.</p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Field Builder */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>Fields</CardTitle>
                                <Button variant="outline" size="sm" onClick={addField}>
                                    <Plus className="mr-2 h-4 w-4" /> Add Field
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {fields.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-4">
                                    No fields yet. Click "Add Field" to get started.
                                </p>
                            )}

                            {fields.map((field, index) => (
                                <div
                                    key={field.id}
                                    className="border rounded-lg p-4 space-y-3 bg-muted/30"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                            <GripVertical className="h-4 w-4" />
                                            <span className="text-sm font-medium">Field {index + 1}</span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-red-500 hover:text-red-600"
                                            onClick={() => removeField(field.id)}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Label</Label>
                                            <Input
                                                value={field.label}
                                                onChange={e => updateField(field.id, { label: e.target.value })}
                                                placeholder="e.g. Full Name"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Type</Label>
                                            <Select
                                                value={field.type}
                                                onValueChange={v => updateField(field.id, { type: v })}
                                            >
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {FIELD_TYPES.map(ft => (
                                                        <SelectItem key={ft.value} value={ft.value}>
                                                            {ft.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Placeholder</Label>
                                            <Input
                                                value={field.placeholder}
                                                onChange={e => updateField(field.id, { placeholder: e.target.value })}
                                                placeholder="Placeholder text"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={field.required}
                                                onChange={e => updateField(field.id, { required: e.target.checked })}
                                                className="rounded border-gray-300"
                                            />
                                            Required
                                        </label>
                                    </div>

                                    {field.type === "select" && (
                                        <div className="space-y-1">
                                            <Label className="text-xs">Options (comma-separated)</Label>
                                            <Input
                                                value={field.options.join(", ")}
                                                onChange={e =>
                                                    updateField(field.id, {
                                                        options: e.target.value.split(",").map(o => o.trim()).filter(Boolean),
                                                    })
                                                }
                                                placeholder="e.g. Option A, Option B, Option C"
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </div>
            </main>
        </div>
    );
}
