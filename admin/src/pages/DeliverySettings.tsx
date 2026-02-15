import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, Truck } from "lucide-react";

const DAYS_OF_WEEK = [
    { value: 1, label: "Mon" },
    { value: 2, label: "Tue" },
    { value: 3, label: "Wed" },
    { value: 4, label: "Thu" },
    { value: 5, label: "Fri" },
    { value: 6, label: "Sat" },
    { value: 0, label: "Sun" },
];

export default function DeliverySettings() {
    const { currentTenant } = useTenant();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");

    const [form, setForm] = useState({
        freeDeliveryThreshold: 0,
        flatShippingCost: 0,
        minimumOrderAmount: 0,
        deliveryLeadDays: 1,
        deliveryDaysOfWeek: [1, 2, 3, 4, 5] as number[],
        blockedDates: "",
    });

    useEffect(() => {
        if (currentTenant) loadConfig();
    }, [currentTenant?.id]);

    async function loadConfig() {
        setLoading(true);
        try {
            const res = await apiRequest("/delivery/config");
            setForm({
                freeDeliveryThreshold: res.freeDeliveryThreshold || 0,
                flatShippingCost: res.flatShippingCost || 0,
                minimumOrderAmount: res.minimumOrderAmount || 0,
                deliveryLeadDays: res.deliveryLeadDays || 1,
                deliveryDaysOfWeek: res.deliveryDaysOfWeek || [1, 2, 3, 4, 5],
                blockedDates: Array.isArray(res.blockedDates)
                    ? res.blockedDates.join("\n")
                    : res.blockedDates || "",
            });
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        setSuccessMessage("");
        try {
            const blockedDatesArray = form.blockedDates
                .split("\n")
                .map((d) => d.trim())
                .filter(Boolean);

            await apiRequest("/delivery/config", {
                method: "PUT",
                body: JSON.stringify({
                    freeDeliveryThreshold: form.freeDeliveryThreshold,
                    flatShippingCost: form.flatShippingCost,
                    minimumOrderAmount: form.minimumOrderAmount,
                    deliveryLeadDays: form.deliveryLeadDays,
                    deliveryDaysOfWeek: form.deliveryDaysOfWeek,
                    blockedDates: blockedDatesArray,
                }),
            });
            setSuccessMessage("Delivery settings saved successfully.");
            setTimeout(() => setSuccessMessage(""), 3000);
        } catch (e: any) {
            alert("Failed to save: " + e.message);
        } finally {
            setSaving(false);
        }
    }

    function toggleDay(day: number) {
        setForm((prev) => {
            const current = prev.deliveryDaysOfWeek;
            if (current.includes(day)) {
                return { ...prev, deliveryDaysOfWeek: current.filter((d) => d !== day) };
            } else {
                return { ...prev, deliveryDaysOfWeek: [...current, day].sort() };
            }
        });
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6 max-w-3xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Delivery Settings</h1>
                    <p className="text-muted-foreground">Configure shipping and delivery options.</p>
                </div>
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <Save className="mr-2 h-4 w-4" />
                    )}
                    Save Settings
                </Button>
            </div>

            {successMessage && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md text-sm font-medium">
                    {successMessage}
                </div>
            )}

            {/* Shipping Costs */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Truck className="h-5 w-5 text-muted-foreground" />
                        Shipping Costs
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Free Delivery Threshold (RON)</Label>
                            <Input
                                type="number"
                                min={0}
                                value={form.freeDeliveryThreshold}
                                onChange={(e) =>
                                    setForm({ ...form, freeDeliveryThreshold: parseFloat(e.target.value) || 0 })
                                }
                                placeholder="e.g. 200"
                            />
                            <p className="text-xs text-muted-foreground">
                                Orders above this amount get free delivery. Set to 0 to disable.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Flat Shipping Cost (RON)</Label>
                            <Input
                                type="number"
                                min={0}
                                value={form.flatShippingCost}
                                onChange={(e) =>
                                    setForm({ ...form, flatShippingCost: parseFloat(e.target.value) || 0 })
                                }
                                placeholder="e.g. 15"
                            />
                            <p className="text-xs text-muted-foreground">
                                Standard shipping cost when order is below the free threshold.
                            </p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Minimum Order Amount (RON)</Label>
                        <Input
                            type="number"
                            min={0}
                            value={form.minimumOrderAmount}
                            onChange={(e) =>
                                setForm({ ...form, minimumOrderAmount: parseFloat(e.target.value) || 0 })
                            }
                            placeholder="e.g. 50"
                        />
                        <p className="text-xs text-muted-foreground">
                            Customers cannot place orders below this amount. Set to 0 to disable.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Delivery Schedule */}
            <Card>
                <CardHeader>
                    <CardTitle>Delivery Schedule</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Delivery Lead Days</Label>
                        <Input
                            type="number"
                            min={0}
                            value={form.deliveryLeadDays}
                            onChange={(e) =>
                                setForm({ ...form, deliveryLeadDays: parseInt(e.target.value) || 0 })
                            }
                            placeholder="e.g. 2"
                            className="max-w-[200px]"
                        />
                        <p className="text-xs text-muted-foreground">
                            Minimum number of days between order and delivery.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>Delivery Days of Week</Label>
                        <div className="flex flex-wrap gap-2">
                            {DAYS_OF_WEEK.map((day) => (
                                <button
                                    key={day.value}
                                    type="button"
                                    onClick={() => toggleDay(day.value)}
                                    className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                                        form.deliveryDaysOfWeek.includes(day.value)
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-background text-muted-foreground border-input hover:bg-muted"
                                    }`}
                                >
                                    {day.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Select which days of the week deliveries can be made.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Blocked Dates */}
            <Card>
                <CardHeader>
                    <CardTitle>Blocked Dates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <Label>Dates When No Deliveries Are Made</Label>
                    <Textarea
                        value={form.blockedDates}
                        onChange={(e) => setForm({ ...form, blockedDates: e.target.value })}
                        rows={6}
                        placeholder={"2025-12-25\n2025-12-26\n2026-01-01"}
                    />
                    <p className="text-xs text-muted-foreground">
                        One date per line in YYYY-MM-DD format. These dates will be excluded from delivery scheduling.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
