"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";
import { useTenantUrl } from "@/lib/routing";
import { CommerceStrings, COMMERCE_STRINGS_DEFAULTS } from "@amodx/shared";

interface Order {
    orderNumber: string;
    total: string;
    status: string;
    createdAt: string;
    orderId: string;
}

interface CustomerData {
    email: string;
    name: string;
    phone: string;
    birthday?: string;
    loyaltyPoints?: number;
    defaultAddress?: {
        street: string;
        city: string;
        county: string;
        postalCode: string;
        country: string;
    };
}

const STATUS_LABELS: Record<string, string> = {
    placed: "Placed",
    confirmed: "Confirmed",
    prepared: "Prepared",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    annulled: "Annulled",
};

const STATUS_COLORS: Record<string, string> = {
    placed: "bg-blue-100 text-blue-700",
    confirmed: "bg-indigo-100 text-indigo-700",
    prepared: "bg-amber-100 text-amber-700",
    shipped: "bg-purple-100 text-purple-700",
    delivered: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
    annulled: "bg-gray-100 text-gray-700",
};

export function AccountPageView({
    orders,
    customer,
    currency,
    checkoutPrefix,
    shopPrefix,
    contentMaxWidth = "max-w-4xl",
    askBirthday = true,
    strings = COMMERCE_STRINGS_DEFAULTS,
    apiUrl,
    tenantId,
}: {
    orders: Order[];
    customer: CustomerData | null;
    currency: string;
    checkoutPrefix: string;
    shopPrefix: string;
    contentMaxWidth?: string;
    askBirthday?: boolean;
    strings?: CommerceStrings;
    apiUrl: string;
    tenantId: string;
}) {
    const { data: session } = useSession();
    const { getUrl } = useTenantUrl();

    // Edit mode state
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editForm, setEditForm] = useState({
        phone: customer?.phone || "",
        birthday: customer?.birthday || "",
    });

    if (!session) {
        return (
            <div className="max-w-lg mx-auto py-20 px-4 text-center">
                <h1 className="text-3xl font-bold mb-4">My Account</h1>
                <p className="text-muted-foreground mb-8">Sign in to view your orders and manage your account.</p>
                <a
                    href="/api/auth/signin"
                    className="inline-block bg-primary text-primary-foreground px-8 py-3 rounded-full text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                    Sign In with Google
                </a>
            </div>
        );
    }

    return (
        <div className={`${contentMaxWidth} mx-auto py-12 px-4 space-y-8`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">My Account</h1>
                    <p className="text-muted-foreground">{session.user?.email}</p>
                </div>
                <button
                    onClick={() => signOut({ callbackUrl: "/" })}
                    className="text-sm text-muted-foreground hover:text-foreground border border-border px-4 py-2 rounded-md transition-colors"
                >
                    Sign Out
                </button>
            </div>

            {/* Profile */}
            <div className="border border-border rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Profile</h2>
                    {!isEditing && (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="text-sm text-primary hover:underline"
                        >
                            Edit
                        </button>
                    )}
                </div>

                {isEditing ? (
                    <form
                        onSubmit={async (e) => {
                            e.preventDefault();
                            setSaving(true);
                            try {
                                // Use secure server-side proxy that validates session
                                const res = await fetch(`/api/profile`, {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                        // Note: email is taken from session server-side for security
                                        phone: editForm.phone,
                                        birthday: editForm.birthday || null,
                                    }),
                                });
                                if (res.ok) {
                                    setIsEditing(false);
                                    // Refresh the page to show updated data
                                    window.location.reload();
                                }
                            } catch (err) {
                                console.error("Failed to update profile", err);
                            } finally {
                                setSaving(false);
                            }
                        }}
                        className="space-y-4"
                    >
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-muted-foreground mb-1">Name</label>
                                <p className="font-medium text-sm">{customer?.name || session?.user?.name || "—"}</p>
                            </div>
                            <div>
                                <label className="block text-sm text-muted-foreground mb-1">Email</label>
                                <p className="font-medium text-sm">{customer?.email || session?.user?.email || "—"}</p>
                            </div>
                            <div>
                                <label className="block text-sm text-muted-foreground mb-1">{strings.phone || "Phone"}</label>
                                <input
                                    type="tel"
                                    value={editForm.phone}
                                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                    className="w-full border rounded-md px-3 py-2 text-sm"
                                    placeholder={strings.phonePlaceholder || ""}
                                />
                            </div>
                            {askBirthday && (
                                <div>
                                    <label className="block text-sm text-muted-foreground mb-1">{strings.birthday || "Birthday"}</label>
                                    <input
                                        type="date"
                                        value={editForm.birthday}
                                        onChange={(e) => setEditForm({ ...editForm, birthday: e.target.value })}
                                        className="w-full border rounded-md px-3 py-2 text-sm"
                                    />
                                    {strings.birthdayHint && (
                                        <p className="text-xs text-muted-foreground mt-1">{strings.birthdayHint}</p>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="submit"
                                disabled={saving}
                                className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
                            >
                                {saving ? "Saving..." : "Save"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsEditing(false)}
                                className="border px-4 py-2 rounded-md text-sm hover:bg-muted"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                ) : (
                    <div className="grid sm:grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-muted-foreground">Name</span>
                            <p className="font-medium">{customer?.name || session?.user?.name || "—"}</p>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Email</span>
                            <p className="font-medium">{customer?.email || session?.user?.email || "—"}</p>
                        </div>
                        <div>
                            <span className="text-muted-foreground">{strings.phone || "Phone"}</span>
                            <p className="font-medium">{customer?.phone || "—"}</p>
                        </div>
                        {askBirthday && (
                            <div>
                                <span className="text-muted-foreground">{strings.birthday || "Birthday"}</span>
                                <p className="font-medium">
                                    {customer?.birthday
                                        ? new Date(customer.birthday + "T00:00:00").toLocaleDateString()
                                        : "—"}
                                </p>
                                {!customer?.birthday && strings.birthdayHint && (
                                    <p className="text-xs text-primary mt-1 cursor-pointer hover:underline" onClick={() => setIsEditing(true)}>
                                        {strings.birthdayHint}
                                    </p>
                                )}
                            </div>
                        )}
                        {customer?.loyaltyPoints !== undefined && customer.loyaltyPoints > 0 && (
                            <div>
                                <span className="text-muted-foreground">Loyalty Points</span>
                                <p className="font-medium">{customer.loyaltyPoints.toLocaleString()}</p>
                            </div>
                        )}
                        {customer?.defaultAddress && (
                            <div className="sm:col-span-2">
                                <span className="text-muted-foreground">Default Address</span>
                                <p className="font-medium">
                                    {customer.defaultAddress.street}, {customer.defaultAddress.city}, {customer.defaultAddress.county}
                                    {customer.defaultAddress.postalCode ? ` ${customer.defaultAddress.postalCode}` : ""}
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Orders */}
            <div className="border border-border rounded-lg overflow-hidden">
                <div className="p-6 border-b border-border">
                    <h2 className="text-lg font-semibold">Order History</h2>
                </div>
                {orders.length > 0 ? (
                    <div className="divide-y divide-border">
                        {orders.map((order) => (
                            <Link
                                key={order.orderId}
                                href={getUrl(`${checkoutPrefix}/${order.orderId}?email=${encodeURIComponent(customer?.email || session.user?.email || "")}`)}
                                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                            >
                                <div className="flex items-center gap-4">
                                    <div>
                                        <p className="font-medium">{order.orderNumber}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {new Date(order.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className={`text-xs font-medium px-2 py-1 rounded ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>
                                        {STATUS_LABELS[order.status] || order.status}
                                    </span>
                                    <span className="font-semibold">{order.total} {currency}</span>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="p-12 text-center text-muted-foreground">
                        <p className="mb-4">No orders yet.</p>
                        <Link
                            href={getUrl(shopPrefix)}
                            className="inline-block bg-primary text-primary-foreground px-6 py-2 rounded-full text-sm font-medium hover:opacity-90"
                        >
                            Start Shopping
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
