"use client";

/**
 * Client half of the Facebook pixel (PIXEL-CONSENT-1). Mounted only by the server component FBPixel.tsx.
 * Renders the pixel loader script (fbq init + PageView) only when useConsent().marketing === true.
 * Consent not chosen (null), "Necessary only" and "Deny all" → renders nothing, so no request to a Facebook host.
 * useConsent() is null on the server and in the first client render, so both renders are identical (HYDRATION-1);
 * a choice on the current page reaches this component through the hook's 'amodx-consent-updated' listener.
 * No <noscript> image: a browser without JavaScript cannot give consent, and the image would report the visit.
 */

import Script from "next/script";
import { useConsent } from "./CookieConsent";

interface FBPixelLoaderProps {
    pixelId: string;
}

export function FBPixelLoader({ pixelId }: FBPixelLoaderProps) {
    const consent = useConsent();

    if (consent?.marketing !== true) return null;

    return (
        <>
            <Script id="fb-pixel" strategy="afterInteractive">
                {`
                    !function(f,b,e,v,n,t,s)
                    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                    n.queue=[];t=b.createElement(e);t.async=!0;
                    t.src=v;s=b.getElementsByTagName(e)[0];
                    s.parentNode.insertBefore(t,s)}(window, document,'script',
                    'https://connect.facebook.net/en_US/fbevents.js');
                    fbq('init', '${pixelId}');
                    fbq('track', 'PageView');
                `}
            </Script>
        </>
    );
}
