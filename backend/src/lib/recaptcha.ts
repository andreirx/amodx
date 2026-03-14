/**
 * reCAPTCHA v3 verification utility
 *
 * Verifies a reCAPTCHA token with Google's API and returns the score.
 * Score: 0.0 = likely bot, 1.0 = likely human
 *
 * Resolution hierarchy:
 *   1. Tenant-specific keys (if tenant provides own siteKey + secretKey)
 *   2. Deployment-level keys (env vars RECAPTCHA_SECRET_KEY)
 *   3. null — no verification (local dev only; should never occur in production)
 *
 * Deployment-level protection is mandatory. Tenants cannot disable it.
 * Tenants can only: (a) override with their own keys, (b) adjust score threshold.
 */

/** Effective config after resolution — what the handler actually uses */
export interface EffectiveRecaptchaConfig {
    secretKey: string;
    threshold: number;
    source: "tenant" | "deployment";
}

/**
 * Resolve the effective reCAPTCHA config for a request.
 *
 * @param tenantRecaptcha - The tenant's recaptcha config from DynamoDB (may be undefined/partial)
 * @returns Resolved config or null if no keys available (local dev)
 */
export function resolveRecaptchaConfig(
    tenantRecaptcha?: { siteKey?: string; secretKey?: string; threshold?: number }
): EffectiveRecaptchaConfig | null {
    // 1. Tenant provides own keys — use them
    if (tenantRecaptcha?.siteKey && tenantRecaptcha?.secretKey) {
        return {
            secretKey: tenantRecaptcha.secretKey,
            threshold: tenantRecaptcha.threshold ?? 0.5,
            source: "tenant",
        };
    }

    // 2. Deployment-level keys from env vars
    const deploySecret = process.env.RECAPTCHA_SECRET_KEY;
    if (deploySecret) {
        return {
            secretKey: deploySecret,
            // Tenant can still adjust threshold even when using deployment keys
            threshold: tenantRecaptcha?.threshold ?? 0.5,
            source: "deployment",
        };
    }

    // 3. No keys available (local dev without SSM)
    return null;
}

export interface RecaptchaVerifyResult {
    success: boolean;
    score: number;
    action?: string;
    challenge_ts?: string;
    hostname?: string;
    "error-codes"?: string[];
}

/**
 * Verify a reCAPTCHA v3 token with Google's API
 *
 * @param token - The reCAPTCHA token from the client
 * @param secretKey - The reCAPTCHA secret key
 * @param remoteIp - Optional client IP address for additional verification
 * @returns Verification result with success status and score
 */
export async function verifyRecaptcha(
    token: string,
    secretKey: string,
    remoteIp?: string
): Promise<RecaptchaVerifyResult> {
    const params = new URLSearchParams({
        secret: secretKey,
        response: token,
    });

    if (remoteIp) {
        params.append("remoteip", remoteIp);
    }

    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    const result = await response.json();
    return result as RecaptchaVerifyResult;
}

/**
 * Get a human-readable error message for reCAPTCHA failures
 */
export function getRecaptchaErrorMessage(result: RecaptchaVerifyResult): string {
    if (result["error-codes"]?.includes("invalid-input-secret")) {
        return "reCAPTCHA configuration error";
    }
    if (result["error-codes"]?.includes("timeout-or-duplicate")) {
        return "Verification expired. Please try again.";
    }
    if (!result.success) {
        return "Verification failed. Please try again.";
    }
    return "Verification failed due to low score.";
}
