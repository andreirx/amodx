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
            {tenantId && cartPrefix ? (
                <CartProvider tenantId={tenantId} cartPrefix={cartPrefix}>
                    {children}
                </CartProvider>
            ) : (
                children
            )}
        </SessionProvider>
    );
}
