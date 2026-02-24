"use client";
import React, { useState, useEffect } from "react";

interface ConsentState {
    necessary: boolean;
    analytics: boolean;
    marketing: boolean;
}

interface CookieConsentProps {
    tenantId: string;
    config?: {
        headline?: string;
        description?: string;
        denyAll?: string;
        necessaryOnly?: string;
        acceptAll?: string;
        position?: "bottom" | "top";
        primaryColor?: string;
    };
}

interface ConsentData {
    consent: ConsentState;
    timestamp: number;
    visitorId: string;
}

// SIMPLIFIED: Hook reads from global window object
export function useConsent(): ConsentState | null {
    const [consent, setConsent] = useState<ConsentState | null>(null);

    useEffect(() => {
        // Initial read
        setConsent((window as any).AMODX_CONSENT || null);

        // Listen for updates
        const handleUpdate = (e: CustomEvent) => setConsent(e.detail);
        window.addEventListener('amodx-consent-updated', handleUpdate as EventListener);

        return () => {
            window.removeEventListener('amodx-consent-updated', handleUpdate as EventListener);
        };
    }, []);

    return consent;
}

// Generate or retrieve visitor ID
function getVisitorId(): string {
    if (typeof window === 'undefined') return '';

    const key = 'amodx-visitor-id';
    let visitorId = localStorage.getItem(key);

    if (!visitorId) {
        visitorId = `visitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem(key, visitorId);
    }

    return visitorId;
}

// Check if consent is expired (1 year)
function isConsentExpired(timestamp: number): boolean {
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    return Date.now() - timestamp > oneYear;
}

// Get stored consent
function getStoredConsent(tenantId: string): ConsentData | null {
    if (typeof window === 'undefined') return null;

    const key = `amodx-consent-${tenantId}`;
    const stored = localStorage.getItem(key);

    if (!stored) return null;

    try {
        const data: ConsentData = JSON.parse(stored);
        if (isConsentExpired(data.timestamp)) {
            localStorage.removeItem(key);
            return null;
        }
        return data;
    } catch {
        return null;
    }
}

// Save consent to localStorage
function saveConsentToStorage(tenantId: string, consent: ConsentState, visitorId: string) {
    if (typeof window === 'undefined') return;

    const data: ConsentData = {
        consent,
        timestamp: Date.now(),
        visitorId
    };

    const key = `amodx-consent-${tenantId}`;
    localStorage.setItem(key, JSON.stringify(data));
}

// Set global consent object
function setGlobalConsent(consent: ConsentState) {
    if (typeof window === 'undefined') return;

    (window as any).AMODX_CONSENT = consent;

    // Dispatch custom event for plugins
    window.dispatchEvent(new CustomEvent('amodx-consent-updated', { detail: consent }));
}

// Send consent to backend
async function sendConsentToBackend(tenantId: string, visitorId: string, choice: string) {
    try {
        const response = await fetch('/api/consent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-tenant-id': tenantId
            },
            body: JSON.stringify({
                visitorId,
                choice,
                timestamp: Date.now(),
                userAgent: navigator.userAgent
            })
        });

        if (!response.ok) {
            console.error('Failed to save consent to backend');
        }
    } catch (error) {
        console.error('Error sending consent:', error);
        // Non-blocking - don't break UX if Lambda fails
    }
}

export function CookieConsent({ tenantId, config }: CookieConsentProps) {
    const [showBanner, setShowBanner] = useState(false);
    const [isClient, setIsClient] = useState(false);

    const headline = config?.headline || "We value your privacy";
    const description = config?.description || "We use cookies to enhance your browsing experience and analyze our traffic. Choose your preference below.";
    const denyAllLabel = config?.denyAll || "Deny All";
    const necessaryOnlyLabel = config?.necessaryOnly || "Necessary Only";
    const acceptAllLabel = config?.acceptAll || "Accept All";
    const position = config?.position || "bottom";

    useEffect(() => {
        setIsClient(true);

        // Check for existing consent
        const storedConsent = getStoredConsent(tenantId);

        if (storedConsent) {
            // Apply existing consent
            setGlobalConsent(storedConsent.consent);
            setShowBanner(false);
        } else {
            // Show banner
            setShowBanner(true);
        }
    }, [tenantId]);

    const handleChoice = async (choice: 'all' | 'necessary' | 'denied') => {
        const visitorId = getVisitorId();

        const newConsent: ConsentState = {
            necessary: true,
            analytics: choice === 'all',
            marketing: choice === 'all'
        };

        // Save to localStorage
        saveConsentToStorage(tenantId, newConsent, visitorId);

        // Set global state
        setGlobalConsent(newConsent);

        // Hide banner
        setShowBanner(false);

        // Send to backend (non-blocking)
        sendConsentToBackend(tenantId, visitorId, choice);
    };

    // Don't render until client-side or if consent already given
    if (!isClient || !showBanner) {
        return null;
    }

    const positionClasses = position === "top"
        ? "top-0"
        : "bottom-0";

    return (
        <div className={`fixed left-0 right-0 ${positionClasses} z-50 p-4 md:p-6 animate-slide-in`}>
            <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 shadow-2xl rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                            {headline}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                            {description}
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 flex-shrink-0">
                        <button
                            onClick={() => handleChoice('denied')}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            {denyAllLabel}
                        </button>
                        <button
                            onClick={() => handleChoice('necessary')}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            {necessaryOnlyLabel}
                        </button>
                        <button
                            onClick={() => handleChoice('all')}
                            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
                            style={config?.primaryColor ? { backgroundColor: config.primaryColor } : {}}
                        >
                            {acceptAllLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
