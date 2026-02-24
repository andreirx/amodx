"use client";

import Script from "next/script";

interface RecaptchaProviderProps {
    siteKey: string;
}

/**
 * Loads the Google reCAPTCHA v3 script
 *
 * This component lazily loads the reCAPTCHA script with the provided site key.
 * The script makes `grecaptcha` available on the window object.
 */
export function RecaptchaProvider({ siteKey }: RecaptchaProviderProps) {
    if (!siteKey) return null;

    return (
        <Script
            src={`https://www.google.com/recaptcha/api.js?render=${siteKey}`}
            strategy="lazyOnload"
        />
    );
}
