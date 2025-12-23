import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let cachedKey: string | null = null;

export async function getMasterKey() {
    // FIX: Only return cache if it's a valid string. If empty, retry fetch.
    if (cachedKey && cachedKey.length > 0) return cachedKey;

    // 1. Local Development Fallback
    if (process.env.AMODX_API_KEY) {
        console.log("[API Client] Using local env key");
        return process.env.AMODX_API_KEY;
    }

    // 2. AWS Secrets Manager
    const secretName = process.env.AMODX_API_KEY_SECRET;
    const region = process.env.AWS_REGION || "eu-central-1";

    if (secretName) {
        console.log(`[API Client] Fetching secret '${secretName}'...`);
        try {
            const client = new SecretsManagerClient({ region });
            const res = await client.send(new GetSecretValueCommand({ SecretId: secretName }));

            if (res.SecretString) {
                const raw = res.SecretString;
                try {
                    const json = JSON.parse(raw);
                    cachedKey = json.apiKey || raw;
                } catch (e) {
                    cachedKey = raw;
                }

                cachedKey = cachedKey?.trim() || "";

                if (cachedKey) console.log(`[API Client] Key cached. First 4 chars: ${cachedKey.substring(0, 4)}...`);
                else console.warn("[API Client] Secret retrieved but key is empty.");

                return cachedKey;
            }
        } catch (e: any) {
            console.error("[API Client] CRITICAL: Failed to fetch Master Key", e.message);
            // Return empty but DO NOT CACHE it as null, so next request tries again
            return "";
        }
    }

    return "";
}
