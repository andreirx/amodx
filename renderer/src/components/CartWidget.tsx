"use client";

import { useCart } from "@/context/CartContext";
import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useTenantUrl } from "@/lib/routing";

export function CartWidget({ showTotal, currency, iconSize }: { showTotal?: boolean; currency?: string; iconSize?: string }) {
    const { itemCount, subtotal, cartPrefix } = useCart();
    const { getUrl } = useTenantUrl();

    return (
        <Link href={getUrl(cartPrefix)} className="relative flex items-center gap-1 p-2 text-muted-foreground hover:text-foreground transition-colors">
            {showTotal && (
                <span className="text-sm font-medium">
                    Cart/{subtotal.toFixed(0)} {currency || "RON"}
                </span>
            )}
            <span className="relative">
                <ShoppingCart className={iconSize || "h-5 w-5"} />
                {itemCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
                        {itemCount > 99 ? "99+" : itemCount}
                    </span>
                )}
            </span>
        </Link>
    );
}
