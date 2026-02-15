"use client";

import { useCart } from "@/context/CartContext";
import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useTenantUrl } from "@/lib/routing";

export function CartWidget() {
    const { itemCount, cartPrefix } = useCart();
    const { getUrl } = useTenantUrl();

    return (
        <Link href={getUrl(cartPrefix)} className="relative p-2 text-muted-foreground hover:text-foreground transition-colors">
            <ShoppingCart className="h-5 w-5" />
            {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
                    {itemCount > 99 ? "99+" : itemCount}
                </span>
            )}
        </Link>
    );
}
