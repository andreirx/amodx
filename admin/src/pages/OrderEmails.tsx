import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, RotateCcw, Mail } from "lucide-react";

/** The template keys: the seven order statuses, then `paid` (PAY-1: the payment change pending → paid, not a status). */
const TEMPLATE_KEYS = ["placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled", "paid"];

const TEMPLATE_LABELS: Record<string, string> = {
    placed: "Placed",
    confirmed: "Confirmed",
    prepared: "Prepared",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    annulled: "Annulled",
    paid: "Paid",
};

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
    placed: "Sent when a customer submits a new order.",
    confirmed: "Sent when you confirm/acknowledge the order.",
    prepared: "Sent when the order is packed and ready for shipping.",
    shipped: "Sent when the order is handed to the courier.",
    delivered: "Sent when the order has been delivered.",
    cancelled: "Sent when the customer cancels the order.",
    annulled: "Sent when you annul the order (fraud, out of stock, etc.).",
    paid: "Sent when you mark the order as paid (order page, Payment card). Not sent on a refund.",
};

interface EmailTemplate {
    subject: string;
    body: string;
    sendToCustomer: boolean;
    sendToAdmin: boolean;
    sendToProcessing: boolean;
}

const DEFAULT_TEMPLATES: Record<string, EmailTemplate> = {
    placed: {
        subject: "Order {{orderNumber}} – Thank You!",
        body: "Thank you for your order {{orderNumber}}!\n\nItems:\n{{items}}\n\nTotal: {{total}} {{currency}}\nPayment: {{paymentMethod}}\n\nWe'll notify you when your order status changes.\n\nBest regards,\n{{siteName}}",
        sendToCustomer: true,
        sendToAdmin: true,
        sendToProcessing: true,
    },
    confirmed: {
        subject: "Order {{orderNumber}} Confirmed",
        body: "Hi {{customerName}},\n\nYour order {{orderNumber}} has been confirmed and is being processed.\n\nBest regards,\n{{siteName}}",
        sendToCustomer: true,
        sendToAdmin: false,
        sendToProcessing: false,
    },
    prepared: {
        subject: "Order {{orderNumber}} Ready for Shipping",
        body: "Hi {{customerName}},\n\nYour order {{orderNumber}} is packed and ready for shipping.\n\nBest regards,\n{{siteName}}",
        sendToCustomer: true,
        sendToAdmin: false,
        sendToProcessing: false,
    },
    shipped: {
        subject: "Order {{orderNumber}} Shipped",
        body: "Hi {{customerName}},\n\nYour order {{orderNumber}} has been shipped.\nTracking: {{trackingNumber}}\n\nBest regards,\n{{siteName}}",
        sendToCustomer: true,
        sendToAdmin: false,
        sendToProcessing: false,
    },
    delivered: {
        subject: "Order {{orderNumber}} Delivered",
        body: "Hi {{customerName}},\n\nYour order {{orderNumber}} has been delivered. Enjoy!\n\nBest regards,\n{{siteName}}",
        sendToCustomer: true,
        sendToAdmin: false,
        sendToProcessing: false,
    },
    cancelled: {
        subject: "Order {{orderNumber}} Cancelled",
        body: "Hi {{customerName}},\n\nYour order {{orderNumber}} has been cancelled.\n\nIf you have questions, please contact us.\n\nBest regards,\n{{siteName}}",
        sendToCustomer: true,
        sendToAdmin: false,
        sendToProcessing: false,
    },
    annulled: {
        subject: "Order {{orderNumber}} Annulled",
        body: "Hi {{customerName}},\n\nYour order {{orderNumber}} has been annulled.\n{{note}}\n\nIf you have questions, please contact us.\n\nBest regards,\n{{siteName}}",
        sendToCustomer: true,
        sendToAdmin: false,
        sendToProcessing: false,
    },
    paid: {
        subject: "Order {{orderNumber}} – Payment Received",
        body: "Hi {{customerName}},\n\nWe have received the payment for your order {{orderNumber}}: {{total}} {{currency}}.\n\nThank you!\n\nBest regards,\n{{siteName}}",
        sendToCustomer: true,
        sendToAdmin: false,
        sendToProcessing: false,
    },
};

const TEMPLATE_VARS = [
    "orderNumber", "customerName", "customerEmail", "customerPhone",
    "status", "statusLabel", "trackingNumber", "items",
    "subtotal", "total", "currency", "shippingCost",
    "couponDiscount", "paymentMethod", "deliveryDate",
    "shippingAddress", "note", "siteName",
];

export default function OrderEmails() {
    const { currentTenant } = useTenant();
    const [templates, setTemplates] = useState<Record<string, EmailTemplate>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeKey, setActiveKey] = useState("placed");

    useEffect(() => {
        if (currentTenant) loadTemplates();
    }, [currentTenant?.id]);

    async function loadTemplates() {
        setLoading(true);
        try {
            const data = await apiRequest("/settings");
            const saved = data.orderEmailConfig?.templates || {};
            // Merge saved templates with defaults
            const merged: Record<string, EmailTemplate> = {};
            for (const key of TEMPLATE_KEYS) {
                merged[key] = saved[key] || DEFAULT_TEMPLATES[key];
            }
            setTemplates(merged);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        try {
            await apiRequest("/settings", {
                method: "PUT",
                body: JSON.stringify({
                    orderEmailConfig: { templates },
                }),
            });
        } catch (e: any) {
            alert("Failed to save: " + e.message);
        } finally {
            setSaving(false);
        }
    }

    function resetTemplate(key: string) {
        setTemplates(prev => ({
            ...prev,
            [key]: { ...DEFAULT_TEMPLATES[key] },
        }));
    }

    function updateTemplate(key: string, field: keyof EmailTemplate, value: any) {
        setTemplates(prev => ({
            ...prev,
            [key]: { ...prev[key], [field]: value },
        }));
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    const current = templates[activeKey];
    if (!current) return null;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Mail className="h-7 w-7" /> Order Email Templates
                    </h1>
                    <p className="text-muted-foreground">
                        Configure email notifications sent at each order status change and when an order is marked as paid.
                    </p>
                </div>
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save All
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Template key tabs (sidebar) */}
                <div className="space-y-1">
                    {TEMPLATE_KEYS.map(k => (
                        <button
                            key={k}
                            onClick={() => setActiveKey(k)}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                                activeKey === k
                                    ? "bg-primary text-primary-foreground"
                                    : "hover:bg-muted text-muted-foreground"
                            }`}
                        >
                            {TEMPLATE_LABELS[k]}
                        </button>
                    ))}
                </div>

                {/* Template editor */}
                <div className="lg:col-span-3 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>{TEMPLATE_LABELS[activeKey]} Email</CardTitle>
                            <CardDescription>{TEMPLATE_DESCRIPTIONS[activeKey]}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Subject</Label>
                                <Input
                                    value={current.subject}
                                    onChange={e => updateTemplate(activeKey, "subject", e.target.value)}
                                    placeholder="Order {{orderNumber}} — Status"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Body</Label>
                                <Textarea
                                    value={current.body}
                                    onChange={e => updateTemplate(activeKey, "body", e.target.value)}
                                    rows={12}
                                    className="font-mono text-sm"
                                    placeholder="Email body with {{variables}}..."
                                />
                            </div>

                            {/* Recipients */}
                            <div className="space-y-2">
                                <Label>Send to</Label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={current.sendToCustomer}
                                            onChange={e => updateTemplate(activeKey, "sendToCustomer", e.target.checked)}
                                            className="rounded"
                                        />
                                        Customer
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={current.sendToAdmin}
                                            onChange={e => updateTemplate(activeKey, "sendToAdmin", e.target.checked)}
                                            className="rounded"
                                        />
                                        Admin (contactEmail)
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={current.sendToProcessing}
                                            onChange={e => updateTemplate(activeKey, "sendToProcessing", e.target.checked)}
                                            className="rounded"
                                        />
                                        Processing (orderProcessingEmail)
                                    </label>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                                <Button variant="outline" size="sm" onClick={() => resetTemplate(activeKey)}>
                                    <RotateCcw className="mr-2 h-3 w-3" /> Reset to Default
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Available variables */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Available Variables</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-2">
                                {TEMPLATE_VARS.map(v => (
                                    <code key={v} className="text-xs bg-muted px-2 py-1 rounded font-mono">
                                        {"{{" + v + "}}"}
                                    </code>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
