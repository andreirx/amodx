"use client";
import React, { useState, useEffect } from "react";
import { X, Shield, Cookie } from "lucide-react";

interface CookieConsentProps {
    tenantId: string;
    config?: {
        headline?: string;
        description?: string;
        position?: "bottom" | "top";
        primaryColor?: string;
    };
}

type ConsentChoice = "all" | "necessary" | "denied" | null;

export function CookieConsent({ tenantId, config }: CookieConsentProps) {
    const [consentChoice, setConsentChoice] = useState<ConsentChoice>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const storageKey = `amodx-consent-${tenantId}`;

    useEffect(() => {
        // Check localStorage for existing consent
        const stored = localStorage.getItem(storageKey);
        if (stored) {
            try {
                const { choice, timestamp } = JSON.parse(stored);
                // Consent valid for 1 year
                const oneYear = 365 * 24 * 60 * 60 * 1000;
                if (Date.now() - timestamp < oneYear) {
                    setConsentChoice(choice);
                    applyConsent(choice);
                    return;
                }
            } catch (e) {
                console.error("Failed to parse consent cookie", e);
            }
        }
        // Show banner if no valid consent
        setIsVisible(true);
    }, [tenantId]);

    const applyConsent = (choice: ConsentChoice) => {
        if (typeof window === "undefined") return;

        // Set global consent state for analytics/tracking scripts
        (window as any).AMODX_CONSENT = {
            necessary: true,
            analytics: choice === "all",
            marketing: choice === "all",
        };

        // Dispatch custom event for plugins to listen
        window.dispatchEvent(
            new CustomEvent("amodx-consent-updated", {
                detail: { choice },
            })
        );
    };

    const handleChoice = async (choice: "all" | "necessary" | "denied") => {
        setIsLoading(true);

        // 1. Store in localStorage (instant)
        const consentData = {
            choice,
            timestamp: Date.now(),
        };
        localStorage.setItem(storageKey, JSON.stringify(consentData));

        // 2. Apply consent immediately
        applyConsent(choice);
        setConsentChoice(choice);

        // 3. Send to backend for audit trail
        try {
            const visitorId = getOrCreateVisitorId();
            await fetch("/api/consent", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-tenant-id": tenantId,
                },
                body: JSON.stringify({
                    visitorId,
                    choice,
                    userAgent: navigator.userAgent,
                    timestamp: consentData.timestamp,
                }),
            });
        } catch (error) {
            console.error("Failed to log consent to backend:", error);
            // Non-blocking - localStorage is our source of truth
        }

        setIsLoading(false);
        setIsVisible(false);
    };

    const getOrCreateVisitorId = (): string => {
        const key = "amodx-visitor-id";
        let id = localStorage.getItem(key);
        if (!id) {
            id = `visitor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem(key, id);
        }
        return id;
    };

    if (!isVisible || consentChoice !== null) return null;

    const headline = config?.headline || "We value your privacy";
    const description =
        config?.description ||
        "We use cookies to enhance your browsing experience and analyze our traffic. Choose your preference below.";
    const position = config?.position || "bottom";

    const positionClasses =
        position === "top"
            ? "top-0 border-b"
            : "bottom-0 border-t";

    return (
        <div
            className={`fixed left-0 right-0 ${positionClasses} bg-white border-gray-200 shadow-lg z-50 animate-in slide-in-from-bottom duration-300`}
        >
            <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
                <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className="flex-shrink-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50">
                            <Cookie className="h-5 w-5 text-indigo-600" />
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-sm font-semibold text-gray-900 mb-1">
                                    {headline}
                                </h3>
                                <p className="text-sm text-gray-600 mb-4 max-w-2xl">
                                    {description}
                                </p>
                            </div>
                        </div>

                        {/* Buttons */}
                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => handleChoice("all")}
                                disabled={isLoading}
                                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Accept All
                            </button>
                            <button
                                onClick={() => handleChoice("necessary")}
                                disabled={isLoading}
                                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Necessary Only
                            </button>
                            <button
                                onClick={() => handleChoice("denied")}
                                disabled={isLoading}
                                className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Deny All
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Helper hook for plugins to check consent
export function useConsent() {
    const [consent, setConsent] = useState<{
        necessary: boolean;
        analytics: boolean;
        marketing: boolean;
    } | null>(null);

    useEffect(() => {
        // Get initial consent state
        const currentConsent = (window as any).AMODX_CONSENT || null;
        setConsent(currentConsent);

        // Listen for consent updates
        const handleConsentUpdate = (e: CustomEvent) => {
            const { choice } = e.detail;
            setConsent({
                necessary: true,
                analytics: choice === "all",
                marketing: choice === "all",
            });
        };

        window.addEventListener(
            "amodx-consent-updated",
            handleConsentUpdate as EventListener
        );

        return () => {
            window.removeEventListener(
                "amodx-consent-updated",
                handleConsentUpdate as EventListener
            );
        };
    }, []);

    return consent;
}
