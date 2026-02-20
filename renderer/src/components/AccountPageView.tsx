"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { useTenantUrl } from "@/lib/routing";

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
}: {
    orders: Order[];
    customer: CustomerData | null;
    currency: string;
    checkoutPrefix: string;
    shopPrefix: string;
    contentMaxWidth?: string;
}) {
    const { data: session } = useSession();
    const { getUrl } = useTenantUrl();

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
                <h2 className="text-lg font-semibold mb-4">Profile</h2>
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                    <div>
                        <span className="text-muted-foreground">Name</span>
                        <p className="font-medium">{customer?.name || session.user?.name || "—"}</p>
                    </div>
                    <div>
                        <span className="text-muted-foreground">Email</span>
                        <p className="font-medium">{customer?.email || session.user?.email || "—"}</p>
                    </div>
                    {customer?.phone && (
                        <div>
                            <span className="text-muted-foreground">Phone</span>
                            <p className="font-medium">{customer.phone}</p>
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
