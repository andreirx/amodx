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
import { resolveFormDateOrder, type FormDateOrder, type FormFieldType } from "@amodx/shared";

type FormField = {
    id: string;
    label: string;
    type: FormFieldType;
    required: boolean;
    placeholder: string;
    options: string[];
    /** STAY-1A: date fields only. "today" = the visitor may not choose a date before today. */
    min?: "today";
};

/**
 * The field picker, in this order. STAY-1A: keyed by the shared type, so a field type added to `FormFieldSchema`
 * without a label here is a compile error.
 */
const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
    text: "Text",
    email: "Email",
    phone: "Phone",
    textarea: "Textarea",
    select: "Select",
    checkbox: "Checkbox",
    number: "Number",
    date: "Date",
};
export const FIELD_TYPES = Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => ({ value: value as FormFieldType, label }));

/** STAY-1A: the pair-rule pickers' state: the two picked ids, and whether the loaded form had a rule. */
type DateOrderState = { draft: { earlier: string | null; later: string | null }; had: boolean };
const NO_DATE_ORDER: DateOrderState = { draft: { earlier: null, later: null }, had: false };

/**
 * STAY-1A (finding F-STAY1A-EDITOR-RULE-LEAK): the pickers' state from a loaded form's stored `dateOrder` — the rule's
 * two ids, or none. Applied to EVERY loaded form, so a form without a rule never shows or saves another form's. Pure.
 */
export function dateOrderStateOf(stored: unknown): DateOrderState {
    if (typeof stored !== "object" || stored === null) return NO_DATE_ORDER;
    const { earlier, later } = stored as Record<string, unknown>;
    return typeof earlier === "string" && typeof later === "string" ? { draft: { earlier, later }, had: true } : NO_DATE_ORDER;
}

/** STAY-1A: the pair-rule pickers' value for "no field" (a Radix select item cannot have the value ""). */
const NO_FIELD = "__none__";

/**
 * STAY-1A (docs/slices/stay-1.md § 2, ruling 5): the pair rule the editor saves, from the two pickers. Fewer than two
 * date fields → no rule (`null`): the pickers are not shown, so nothing hidden can stop the save. A picked id that is
 * no longer a date field of `fields` counts as not picked (the picker shows "None" for it). Neither picked → no rule;
 * one picked → an error; both → the shared rule check (two different date fields). Pure.
 */
export function dateOrderToSave(
    fields: FormField[], draft: { earlier: string | null; later: string | null },
): { ok: true; value: FormDateOrder | null } | { ok: false; error: string } {
    if (fields.filter((f) => f.type === "date").length < 2) return { ok: true, value: null };
    const isDate = (id: string | null) => id !== null && fields.some((f) => f.id === id && f.type === "date");
    const earlier = isDate(draft.earlier) ? draft.earlier : null;
    const later = isDate(draft.later) ? draft.later : null;
    if (earlier === null && later === null) return { ok: true, value: null };
    if (earlier === null || later === null) return { ok: false, error: "Date order: choose both dates, or None for both." };
    const resolved = resolveFormDateOrder(fields, { earlier, later });
    if (!resolved.ok) return { ok: false, error: "Date order: choose two different date fields." };
    return { ok: true, value: { earlier, later } };
}

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
    // STAY-1A: the pair rule's two pickers, and whether the loaded form had a rule (then a save without one sends null).
    const [dateOrder, setDateOrder] = useState(NO_DATE_ORDER.draft);
    const [hadDateOrder, setHadDateOrder] = useState(NO_DATE_ORDER.had);
    const dateFields = fields.filter((f) => f.type === "date");

    // STAY-1A (F-STAY1A-EDITOR-RULE-LEAK): one editor stays mounted across `/forms/:id` changes. The rule state resets at
    // each change of the form, and a load's answer is applied only while it is still the current form's (`current()`).
    useEffect(() => {
        let current = true;
        setDateOrder(NO_DATE_ORDER.draft);
        setHadDateOrder(NO_DATE_ORDER.had);
        if (currentTenant && !isNew && id) loadForm(() => current);
        return () => { current = false; };
    }, [id, currentTenant?.id]);

    async function loadForm(current: () => boolean) {
        try {
            const data = await apiRequest(`/forms/${id}`);
            if (!current()) return;
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
                    ...(f.min === "today" ? { min: "today" as const } : {}),
                }))
            );
            const loaded = dateOrderStateOf(data.dateOrder);
            setDateOrder(loaded.draft);
            setHadDateOrder(loaded.had);
            setSlugTouched(true);
        } catch (e) {
            if (!current()) return;
            alert("Failed to load form");
            navigate("/forms");
        } finally {
            if (current()) setLoading(false);
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

        const order = dateOrderToSave(fields, dateOrder);
        if (!order.ok) {
            alert(order.error);
            return;
        }

        const payload = {
            ...form,
            fields,
            // STAY-1A: the rule when set; null removes a rule the form had; nothing sent for a form that never had one.
            ...(order.value !== null ? { dateOrder: order.value } : hadDateOrder ? { dateOrder: null } : {}),
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
                                                onValueChange={v => updateField(field.id, { type: v as FormFieldType, ...(v !== "date" ? { min: undefined } : {}) })}
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
                                        {field.type === "date" && (
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={field.min === "today"}
                                                    onChange={e => updateField(field.id, { min: e.target.checked ? "today" : undefined })}
                                                    className="rounded border-border"
                                                />
                                                Not before today
                                            </label>
                                        )}
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

                    {/* STAY-1A: the pair rule, offered only when the form has two or more date fields. */}
                    {dateFields.length >= 2 && (
                        <Card>
                            <CardHeader><CardTitle>Date Order</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <p className="text-sm text-muted-foreground">
                                    The later date must be after the earlier date (for example, departure after arrival). Checked when both are filled in.
                                </p>
                                <div className="grid grid-cols-2 gap-4">
                                    {(["earlier", "later"] as const).map(side => (
                                        <div key={side} className="space-y-2">
                                            <Label>{side === "earlier" ? "Earlier date" : "Later date"}</Label>
                                            <Select
                                                value={dateFields.some(f => f.id === dateOrder[side]) ? dateOrder[side]! : NO_FIELD}
                                                onValueChange={v => setDateOrder(prev => ({ ...prev, [side]: v === NO_FIELD ? null : v }))}
                                            >
                                                <SelectTrigger aria-label={side === "earlier" ? "Earlier date" : "Later date"}><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value={NO_FIELD}>None</SelectItem>
                                                    {dateFields.map(f => (
                                                        <SelectItem key={f.id} value={f.id}>{f.label || "(no label)"}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </main>
        </div>
    );
}
