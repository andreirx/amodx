import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let cachedKey: string | null = null;

export async function getMasterKey() {
    if (cachedKey) return cachedKey;

    // 1. Local Development Fallback
    if (process.env.AMODX_API_KEY) {
        console.log("[API Client] Using local env key");
        return process.env.AMODX_API_KEY;
    }

    // 2. AWS Secrets Manager
    const secretName = process.env.AMODX_API_KEY_SECRET;
    const region = process.env.AWS_REGION || "eu-central-1";

    if (secretName) {
        console.log(`[API Client] Fetching secret '${secretName}' in '${region}'...`);
        try {
            const client = new SecretsManagerClient({ region });
            const res = await client.send(new GetSecretValueCommand({ SecretId: secretName }));

            if (res.SecretString) {
                const raw = res.SecretString;
                console.log(`[API Client] Secret retrieved. Length: ${raw.length}`);

                try {
                    const json = JSON.parse(raw);
                    // Handle both { apiKey: "..." } and raw string cases inside JSON parsing
                    cachedKey = json.apiKey || raw;
                } catch (e) {
                    console.log("[API Client] Secret is not JSON. Using raw string.");
                    cachedKey = raw;
                }

                // Clean up whitespace
                cachedKey = cachedKey?.trim() || "";

                console.log(`[API Client] Key cached. First 4 chars: ${cachedKey.substring(0, 4)}...`);
                return cachedKey;
            } else {
                console.warn("[API Client] SecretString was empty.");
            }
        } catch (e: any) {
            console.error("[API Client] CRITICAL: Failed to fetch Master Key", e.message);
            // Don't cache the error, retry next time
            return "";
        }
    } else {
        console.warn("[API Client] AMODX_API_KEY_SECRET env var is missing.");
    }

    return "";
}
