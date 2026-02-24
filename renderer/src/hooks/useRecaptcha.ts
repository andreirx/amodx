"use client";

/**
 * Hook for executing reCAPTCHA v3 verification
 *
 * @param action - The action name for this verification (e.g., "contact_form", "lead_magnet")
 * @returns Object with execute function that returns a token
 */
export function useRecaptcha(action: string = "submit") {
    /**
     * Execute reCAPTCHA and get a token
     *
     * @returns The reCAPTCHA token, or null if reCAPTCHA is not available
     */
    const execute = async (): Promise<string | null> => {
        if (typeof window === "undefined") return null;

        // Get site key from window (injected by ThemeInjector)
        const siteKey = (window as any).AMODX_RECAPTCHA_KEY;
        if (!siteKey) return null;

        const grecaptcha = (window as any).grecaptcha;
        if (!grecaptcha) return null;

        return new Promise((resolve) => {
            grecaptcha.ready(() => {
                grecaptcha
                    .execute(siteKey, { action })
                    .then((token: string) => resolve(token))
                    .catch(() => resolve(null));
            });
        });
    };

    return { execute };
}
