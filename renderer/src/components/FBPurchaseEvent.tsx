"use client";

import { useEffect, useRef } from "react";
import { trackFBEvent } from "@/lib/fbpixel";

export function FBPurchaseEvent({ orderId, value, currency, items }: {
    orderId: string;
    value: number;
    currency: string;
    items: { id: string; quantity: number }[];
}) {
    const fired = useRef(false);

    useEffect(() => {
        if (fired.current) return;
        fired.current = true;
        trackFBEvent("Purchase", {
            content_ids: items.map(i => i.id),
            content_type: "product",
            num_items: items.reduce((s, i) => s + i.quantity, 0),
            value,
            currency,
            order_id: orderId,
        });
    }, []);

    return null;
}
