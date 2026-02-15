import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, Save } from "lucide-react";

export default function CouponEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { currentTenant } = useTenant();
    const isNew = id === "new";

    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);

    const [form, setForm] = useState({
        code: "",
        type: "percentage",
        value: 0,
        minOrderAmount: 0,
        maxDiscount: 0,
        validFrom: "",
        validUntil: "",
        usageLimit: 0,
        perCustomerLimit: 0,
        status: "active",
    });

    useEffect(() => {
        if (currentTenant && !isNew && id) loadCoupon();
    }, [id, currentTenant?.id]);

    async function loadCoupon() {
        try {
            const data = await apiRequest(`/coupons/${id}`);
            setForm(prev => ({ ...prev, ...data }));
        } catch (e) {
            alert("Failed to load coupon");
            navigate("/coupons");
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        if (!form.code) {
            alert("Code is required.");
            return;
        }

        setSaving(true);
        try {
            if (isNew) {
                await apiRequest("/coupons", { method: "POST", body: JSON.stringify(form) });
            } else {
                await apiRequest(`/coupons/${id}`, { method: "PUT", body: JSON.stringify(form) });
            }
            navigate("/coupons");
        } catch (e: any) {
            alert("Save failed: " + e.message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
            {/* Header */}
            <header className="flex-none flex items-center justify-between px-6 py-3 border-b bg-card">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/coupons")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold">{isNew ? "New Coupon" : "Edit Coupon"}</span>
                </div>
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save
                </Button>
            </header>

            {/* Content */}
            <main className="flex-1 overflow-y-auto p-8">
                <div className="max-w-2xl mx-auto space-y-6 pb-20">
                    <Button variant="link" className="px-0" onClick={() => navigate("/coupons")}>
                        &larr; Back to Coupons
                    </Button>

                    <Card>
                        <CardHeader><CardTitle>Coupon Details</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Code</Label>
                                <Input
                                    value={form.code}
                                    onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                                    placeholder="e.g. SUMMER20"
                                />
                                <p className="text-xs text-muted-foreground">Automatically converted to uppercase.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Type</Label>
                                    <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="percentage">Percentage</SelectItem>
                                            <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>{form.type === "percentage" ? "Discount %" : "Discount Amount (RON)"}</Label>
                                    <Input
                                        type="number"
                                        value={form.value || ""}
                                        onChange={e => setForm({ ...form, value: parseFloat(e.target.value) || 0 })}
                                        placeholder={form.type === "percentage" ? "e.g. 20" : "e.g. 50"}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Minimum Order Amount (RON)</Label>
                                    <Input
                                        type="number"
                                        value={form.minOrderAmount || ""}
                                        onChange={e => setForm({ ...form, minOrderAmount: parseFloat(e.target.value) || 0 })}
                                        placeholder="0"
                                    />
                                </div>
                                {form.type === "percentage" && (
                                    <div className="space-y-2">
                                        <Label>Maximum Discount (RON)</Label>
                                        <Input
                                            type="number"
                                            value={form.maxDiscount || ""}
                                            onChange={e => setForm({ ...form, maxDiscount: parseFloat(e.target.value) || 0 })}
                                            placeholder="0"
                                        />
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>Validity</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Valid From</Label>
                                    <Input
                                        type="date"
                                        value={form.validFrom || ""}
                                        onChange={e => setForm({ ...form, validFrom: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Valid Until</Label>
                                    <Input
                                        type="date"
                                        value={form.validUntil || ""}
                                        onChange={e => setForm({ ...form, validUntil: e.target.value })}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>Usage Limits</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Usage Limit</Label>
                                    <Input
                                        type="number"
                                        value={form.usageLimit || ""}
                                        onChange={e => setForm({ ...form, usageLimit: parseInt(e.target.value) || 0 })}
                                        placeholder="0"
                                    />
                                    <p className="text-xs text-muted-foreground">0 = unlimited</p>
                                </div>
                                <div className="space-y-2">
                                    <Label>Per Customer Limit</Label>
                                    <Input
                                        type="number"
                                        value={form.perCustomerLimit || ""}
                                        onChange={e => setForm({ ...form, perCustomerLimit: parseInt(e.target.value) || 0 })}
                                        placeholder="0"
                                    />
                                    <p className="text-xs text-muted-foreground">0 = unlimited</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>Status</CardTitle></CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                <Label>Status</Label>
                                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="expired">Expired</SelectItem>
                                        <SelectItem value="disabled">Disabled</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </main>
        </div>
    );
}
