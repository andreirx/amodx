"use client";

import { useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";

interface PopupData {
    id: string;
    type: string;
    headline?: string;
    body?: string;
    imageLink?: string;
    ctaText?: string;
    ctaLink?: string;
    trigger: "page_load" | "exit_intent" | "scroll" | "time_delay";
    triggerValue: string;
    showOnPages: string[];
    showOncePerSession: boolean;
}

interface PopupManagerProps {
    tenantId: string;
    apiUrl: string;
    currentPath: string;
}

export function PopupManager({ tenantId, apiUrl, currentPath }: PopupManagerProps) {
    const [popups, setPopups] = useState<PopupData[]>([]);
    const [activePopup, setActivePopup] = useState<PopupData | null>(null);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());

    // Load popups on mount
    useEffect(() => {
        if (!apiUrl) return;
        fetch(`${apiUrl}/public/popups`, {
            headers: { "x-tenant-id": tenantId },
        })
            .then(r => r.json())
            .then(data => {
                const items = data.items || [];
                // Filter by showOnPages
                const applicable = items.filter((p: PopupData) => {
                    if (p.showOnPages.length === 0) return true;
                    return p.showOnPages.some((page: string) => currentPath.startsWith(page));
                });
                setPopups(applicable);
            })
            .catch(() => {});
    }, [tenantId, apiUrl, currentPath]);

    // Load session-dismissed popups
    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(`amodx_dismissed_popups_${tenantId}`);
            if (raw) setDismissed(new Set(JSON.parse(raw)));
        } catch {}
    }, [tenantId]);

    const dismiss = useCallback((popupId: string) => {
        setActivePopup(null);
        setDismissed(prev => {
            const next = new Set(prev);
            next.add(popupId);
            try {
                sessionStorage.setItem(`amodx_dismissed_popups_${tenantId}`, JSON.stringify([...next]));
            } catch {}
            return next;
        });
    }, [tenantId]);

    const showPopup = useCallback((popup: PopupData) => {
        if (dismissed.has(popup.id)) return;
        if (popup.showOncePerSession && dismissed.has(popup.id)) return;
        setActivePopup(popup);
    }, [dismissed]);

    // Trigger handlers
    useEffect(() => {
        if (popups.length === 0) return;

        const timers: ReturnType<typeof setTimeout>[] = [];

        for (const popup of popups) {
            if (dismissed.has(popup.id)) continue;

            if (popup.trigger === "page_load") {
                const delay = parseInt(popup.triggerValue) || 0;
                const t = setTimeout(() => showPopup(popup), delay * 1000);
                timers.push(t);
            }

            if (popup.trigger === "time_delay") {
                const delay = parseInt(popup.triggerValue) || 5;
                const t = setTimeout(() => showPopup(popup), delay * 1000);
                timers.push(t);
            }
        }

        return () => timers.forEach(clearTimeout);
    }, [popups, dismissed, showPopup]);

    // Scroll trigger
    useEffect(() => {
        const scrollPopups = popups.filter(p => p.trigger === "scroll" && !dismissed.has(p.id));
        if (scrollPopups.length === 0) return;

        function onScroll() {
            const scrollPct = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
            for (const popup of scrollPopups) {
                const threshold = parseInt(popup.triggerValue) || 50;
                if (scrollPct >= threshold) {
                    showPopup(popup);
                }
            }
        }

        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, [popups, dismissed, showPopup]);

    // Exit intent trigger
    useEffect(() => {
        const exitPopups = popups.filter(p => p.trigger === "exit_intent" && !dismissed.has(p.id));
        if (exitPopups.length === 0) return;

        function onMouseLeave(e: MouseEvent) {
            if (e.clientY <= 0) {
                showPopup(exitPopups[0]);
            }
        }

        document.addEventListener("mouseleave", onMouseLeave);
        return () => document.removeEventListener("mouseleave", onMouseLeave);
    }, [popups, dismissed, showPopup]);

    if (!activePopup) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => dismiss(activePopup.id)}>
            <div
                className="relative bg-background rounded-lg shadow-2xl max-w-lg w-full mx-4 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <button
                    onClick={() => dismiss(activePopup.id)}
                    className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-background/80 hover:bg-muted transition-colors"
                >
                    <X className="h-4 w-4" />
                </button>

                {activePopup.imageLink && (
                    <div className="w-full h-48 overflow-hidden">
                        <img src={activePopup.imageLink} alt="" className="w-full h-full object-cover" />
                    </div>
                )}

                <div className="p-6 space-y-4">
                    {activePopup.headline && (
                        <h2 className="text-xl font-bold tracking-tight">{activePopup.headline}</h2>
                    )}
                    {activePopup.body && (
                        <div className="text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: activePopup.body }} />
                    )}
                    {activePopup.ctaText && activePopup.ctaLink && (
                        <a
                            href={activePopup.ctaLink}
                            className="inline-flex items-center justify-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium text-sm hover:opacity-90 transition-opacity"
                            onClick={() => dismiss(activePopup.id)}
                        >
                            {activePopup.ctaText}
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
