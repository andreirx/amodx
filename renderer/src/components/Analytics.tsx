"use client";

import Script from "next/script";

interface AnalyticsProps {
    config: {
        gaId?: string;
        analytics?: {
            provider: "none" | "umami" | "plausible" | "custom";
            url?: string;
            websiteId?: string;
        };
    };
}

export function Analytics({ config }: AnalyticsProps) {
    const { gaId, analytics } = config;

    return (
        <>
            {/* 1. Google Analytics 4 */}
            {gaId && (
                <>
                    <Script
                        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
                        strategy="afterInteractive"
                    />
                    <Script id="google-analytics" strategy="afterInteractive">
                        {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${gaId}');
            `}
                    </Script>
                </>
            )}

            {/* 2. Umami (Privacy Friendly) */}
            {analytics?.provider === "umami" && analytics.url && analytics.websiteId && (
                <Script
                    src={analytics.url}
                    data-website-id={analytics.websiteId}
                    strategy="afterInteractive"
                />
            )}

            {/* 3. Plausible */}
            {analytics?.provider === "plausible" && analytics.url && analytics.websiteId && (
                <Script
                    defer
                    data-domain={analytics.websiteId} // Plausible uses domain as ID usually
                    src={analytics.url}
                />
            )}
        </>
    );
}
