/**
 * reCAPTCHA v3 verification utility
 *
 * Verifies a reCAPTCHA token with Google's API and returns the score.
 * Score: 0.0 = likely bot, 1.0 = likely human
 */

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
