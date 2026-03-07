import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let cachedKey: string | null = null;

/**
 * Get the renderer API key from AWS Secrets Manager.
 * Phase 2.3: This is now a RESTRICTED key that can only:
 * - POST /comments (create)
 * - DELETE /comments (delete)
 * It cannot access /orders, /customers, /tenants, or other admin APIs.
 */
export async function getRendererKey() {
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
        console.log(`[API Client] Fetching renderer key from '${secretName}'...`);
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

                if (cachedKey) console.log(`[API Client] Renderer key cached`);
                else console.warn("[API Client] Secret retrieved but key is empty.");

                return cachedKey;
            }
        } catch (e: any) {
            console.error("[API Client] CRITICAL: Failed to fetch Renderer Key", e.message);
            return "";
        }
    }

    return "";
}

// Backwards compatibility alias
export const getMasterKey = getRendererKey;
