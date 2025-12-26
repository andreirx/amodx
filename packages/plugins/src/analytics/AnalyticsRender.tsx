"use client";
import React, { useEffect, useState } from "react";
import Script from "next/script";

interface AnalyticsRenderProps {
    attrs: {
        provider: "google-analytics" | "plausible" | "custom";
        trackingId: string;
        domain?: string;
        customScript?: string;
    };
}

export function AnalyticsRender({ attrs }: AnalyticsRenderProps) {
    const [hasConsent, setHasConsent] = useState(false);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        // Check initial consent state
        const checkConsent = () => {
            const consent = (window as any).AMODX_CONSENT;
            if (consent?.analytics) {
                setHasConsent(true);
            }
            setIsReady(true);
        };

        // Initial check
        checkConsent();

        // Listen for consent updates
        const handleConsentUpdate = (e: CustomEvent) => {
            const { choice } = e.detail;
            setHasConsent(choice === "all");
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

    // Don't render anything until we've checked consent
    if (!isReady || !hasConsent) {
        return null;
    }

    // Render based on provider
    if (attrs.provider === "google-analytics" && attrs.trackingId) {
        return (
            <>
                <Script
                    src={`https://www.googletagmanager.com/gtag/js?id=${attrs.trackingId}`}
                    strategy="afterInteractive"
                />
                <Script id="google-analytics" strategy="afterInteractive">
                    {`
                        window.dataLayer = window.dataLayer || [];
                        function gtag(){dataLayer.push(arguments);}
                        gtag('js', new Date());
                        gtag('config', '${attrs.trackingId}', {
                            page_path: window.location.pathname,
                        });
                    `}
                </Script>
            </>
        );
    }

    if (attrs.provider === "plausible" && attrs.trackingId && attrs.domain) {
        return (
            <Script
                defer
                data-domain={attrs.domain}
                src={`https://plausible.io/js/script.js`}
                strategy="afterInteractive"
            />
        );
    }

    if (attrs.provider === "custom" && attrs.customScript) {
        return (
            <Script id="custom-analytics" strategy="afterInteractive">
                {attrs.customScript}
            </Script>
        );
    }

    return null;
}
