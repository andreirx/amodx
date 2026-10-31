"use client";

import { Phone, MessageCircle, Mail } from "lucide-react";
import type { LocaleStrings } from "@amodx/shared";

interface QuickContactProps {
    type: "phone" | "whatsapp" | "email";
    value: string;
    label?: string;
    /** LOCALE-1A: the fallback titles when the tenant set no `label` ("WhatsApp" is a brand name, not a key). */
    strings: Pick<LocaleStrings["site"], "quickContactCall" | "quickContactEmail">;
}

export function QuickContact({ type, value, label, strings }: QuickContactProps) {
    const href =
        type === "phone" ? `tel:${value}` :
        type === "whatsapp" ? `https://wa.me/${value.replace(/[^0-9]/g, "")}` :
        `mailto:${value}`;

    const Icon = type === "phone" ? Phone : type === "whatsapp" ? MessageCircle : Mail;
    const title = label || (type === "phone" ? strings.quickContactCall : type === "whatsapp" ? "WhatsApp" : strings.quickContactEmail);

    return (
        <a
            href={href}
            target={type === "whatsapp" ? "_blank" : undefined}
            rel={type === "whatsapp" ? "noopener noreferrer" : undefined}
            title={title}
            className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        >
            <Icon className="h-6 w-6" />
        </a>
    );
}
