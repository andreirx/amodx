"use client";

import { SessionProvider } from "next-auth/react";
import { CartProvider } from "@/context/CartContext";

interface ProvidersProps {
    children: React.ReactNode;
    tenantId?: string;
    cartPrefix?: string;
}

export function Providers({ children, tenantId, cartPrefix }: ProvidersProps) {
    return (
        <SessionProvider>
            {tenantId ? (
                <CartProvider tenantId={tenantId} cartPrefix={cartPrefix || "/cart"}>
                    {children}
                </CartProvider>
            ) : (
                children
            )}
        </SessionProvider>
    );
}
