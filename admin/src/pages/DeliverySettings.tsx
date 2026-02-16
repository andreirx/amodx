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

function formatDateStr(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

type DayStatus = "available" | "weekly-off" | "yearly-off" | "blocked" | "unblocked";

function computeDayStatus(
    date: Date,
    deliveryDaysOfWeek: number[],
    yearlyOffDaysSet: Set<string>,
    blockedDatesSet: Set<string>,
    unblockedDatesSet: Set<string>,
): DayStatus {
    const dateStr = formatDateStr(date);
    const mmdd = dateStr.substring(5);
    if (unblockedDatesSet.has(dateStr)) return "unblocked";
    if (blockedDatesSet.has(dateStr)) return "blocked";
    if (yearlyOffDaysSet.has(mmdd)) return "yearly-off";
    if (!deliveryDaysOfWeek.includes(date.getDay())) return "weekly-off";
    return "available";
}

const STATUS_COLORS: Record<DayStatus, string> = {
    available: "bg-green-100 text-green-800 hover:bg-green-200",
    blocked: "bg-red-100 text-red-800 hover:bg-red-200 ring-1 ring-red-300",
    "weekly-off": "bg-muted text-muted-foreground hover:bg-muted/80",
    "yearly-off": "bg-amber-100 text-amber-800 hover:bg-amber-200",
    unblocked: "bg-blue-100 text-blue-800 hover:bg-blue-200 ring-1 ring-blue-300",
};

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
        yearlyOffDays: "",
        unblockedDates: [] as string[],
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
                yearlyOffDays: Array.isArray(res.yearlyOffDays)
                    ? res.yearlyOffDays.join("\n")
                    : "",
                unblockedDates: Array.isArray(res.unblockedDates)
                    ? res.unblockedDates
                    : [],
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
                .split("\n").map(d => d.trim()).filter(Boolean);
            const yearlyOffDaysArray = form.yearlyOffDays
                .split("\n").map(d => d.trim()).filter(Boolean);

            await apiRequest("/delivery/config", {
                method: "PUT",
                body: JSON.stringify({
                    freeDeliveryThreshold: form.freeDeliveryThreshold,
                    flatShippingCost: form.flatShippingCost,
                    minimumOrderAmount: form.minimumOrderAmount,
                    deliveryLeadDays: form.deliveryLeadDays,
                    deliveryDaysOfWeek: form.deliveryDaysOfWeek,
                    blockedDates: blockedDatesArray,
                    yearlyOffDays: yearlyOffDaysArray,
                    unblockedDates: form.unblockedDates,
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

    // --- Calendar helpers ---
    function getComputedSets() {
        const blockedArray = form.blockedDates.split("\n").map(d => d.trim()).filter(Boolean);
        const yearlyArray = form.yearlyOffDays.split("\n").map(d => d.trim()).filter(Boolean);
        return {
            blockedSet: new Set(blockedArray),
            yearlySet: new Set(yearlyArray),
            unblockedSet: new Set(form.unblockedDates),
        };
    }

    function handleCalendarDayClick(date: Date) {
        const dateStr = formatDateStr(date);
        const { blockedSet, yearlySet, unblockedSet } = getComputedSets();
        const status = computeDayStatus(date, form.deliveryDaysOfWeek, yearlySet, blockedSet, unblockedSet);

        if (status === "available") {
            // Add to blockedDates
            blockedSet.add(dateStr);
            setForm(prev => ({
                ...prev,
                blockedDates: [...blockedSet].sort().join("\n"),
            }));
        } else if (status === "blocked") {
            // Remove from blockedDates
            blockedSet.delete(dateStr);
            setForm(prev => ({
                ...prev,
                blockedDates: [...blockedSet].sort().join("\n"),
            }));
        } else if (status === "unblocked") {
            // Remove from unblockedDates
            unblockedSet.delete(dateStr);
            setForm(prev => ({
                ...prev,
                unblockedDates: [...unblockedSet].sort(),
            }));
        } else {
            // weekly-off or yearly-off -> add to unblockedDates
            unblockedSet.add(dateStr);
            setForm(prev => ({
                ...prev,
                unblockedDates: [...unblockedSet].sort(),
            }));
        }
    }

    function MonthCalendar({ year, month }: { year: number; month: number }) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        let startDow = firstDay.getDay();
        startDow = startDow === 0 ? 6 : startDow - 1; // Mon=0

        const { blockedSet, yearlySet, unblockedSet } = getComputedSets();
        const monthName = firstDay.toLocaleString("default", { month: "long", year: "numeric" });

        const cells: (Date | null)[] = [];
        for (let i = 0; i < startDow; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

        const todayStr = formatDateStr(new Date());

        return (
            <div>
                <h3 className="font-semibold mb-2 text-sm">{monthName}</h3>
                <div className="grid grid-cols-7 gap-1 text-center text-xs">
                    {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(d => (
                        <div key={d} className="font-medium text-muted-foreground py-1">{d}</div>
                    ))}
                    {cells.map((date, i) => {
                        if (!date) return <div key={`pad-${i}`} />;
                        const dateStr = formatDateStr(date);
                        const isPast = dateStr < todayStr;
                        const status = computeDayStatus(date, form.deliveryDaysOfWeek, yearlySet, blockedSet, unblockedSet);

                        return (
                            <button
                                key={dateStr}
                                type="button"
                                disabled={isPast}
                                onClick={() => handleCalendarDayClick(date)}
                                className={`py-1.5 rounded text-xs font-medium transition-colors ${
                                    isPast ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
                                } ${STATUS_COLORS[status]}`}
                                title={`${dateStr} — ${status}`}
                            >
                                {date.getDate()}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

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
                            Minimum number of business days between order and delivery. Off-days are skipped.
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
                            Select which days of the week deliveries can be made. Unselected days are off.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Yearly Recurring Holidays */}
            <Card>
                <CardHeader>
                    <CardTitle>Yearly Recurring Holidays</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <Label>Recurring Off Days (apply every year)</Label>
                    <Textarea
                        value={form.yearlyOffDays}
                        onChange={(e) => setForm({ ...form, yearlyOffDays: e.target.value })}
                        rows={4}
                        placeholder={"12-25\n01-01\n06-01\n12-01\n04-21\n05-01"}
                    />
                    <p className="text-xs text-muted-foreground">
                        One date per line in MM-DD format. These dates are blocked every year
                        (e.g., 12-25 for Christmas, 01-01 for New Year, 12-01 for National Day).
                    </p>
                </CardContent>
            </Card>

            {/* Blocked Dates */}
            <Card>
                <CardHeader>
                    <CardTitle>Blocked Dates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <Label>Specific Dates When No Deliveries Are Made</Label>
                    <Textarea
                        value={form.blockedDates}
                        onChange={(e) => setForm({ ...form, blockedDates: e.target.value })}
                        rows={4}
                        placeholder={"2026-12-25\n2026-12-26\n2027-01-01"}
                    />
                    <p className="text-xs text-muted-foreground">
                        One date per line in YYYY-MM-DD format. Use for one-off closures, vacations, etc.
                        You can also click dates in the calendar below.
                    </p>
                </CardContent>
            </Card>

            {/* Delivery Calendar Customizer */}
            <Card>
                <CardHeader>
                    <CardTitle>Delivery Calendar</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Click any day to toggle its availability. Changes are reflected in the fields above.
                    </p>
                    <div className="grid md:grid-cols-2 gap-6">
                        <MonthCalendar year={now.getFullYear()} month={now.getMonth()} />
                        <MonthCalendar year={nextMonth.getFullYear()} month={nextMonth.getMonth()} />
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs mt-2">
                        <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded bg-green-100 border border-green-300" /> Available
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded bg-muted border" /> Weekly Off
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300" /> Yearly Holiday
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded bg-red-100 border border-red-300" /> Manually Blocked
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded bg-blue-100 border border-blue-300" /> Manually Unblocked
                        </span>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
