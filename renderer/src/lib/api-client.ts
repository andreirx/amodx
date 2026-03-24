import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let cachedKey: string | null = null;

/**
 * Get the renderer API key from AWS Secrets Manager.
 * Phase 2.3: This is a RESTRICTED key (role: RENDERER) with limited scope:
 *   - POST /comments (create)
 *   - DELETE /comments (delete)
 *   - POST /public/customers/profile (session-gated via renderer proxy)
 *
 * It cannot access admin APIs (orders, tenants, settings, etc.) because
 * those handlers require TENANT_ADMIN or GLOBAL_ADMIN roles.
 *
 * The profile endpoint was added in Phase 7.3 remediation. Access is safe
 * because the renderer proxy validates the NextAuth session and substitutes
 * the email from the session before forwarding.
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
