import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let cachedKey: string | null = null;

/**
 * Get the renderer API key from AWS Secrets Manager.
 * Phase 2.3: This is a RESTRICTED key (role: RENDERER) with limited scope:
 *   - POST /comments (create)
 *   - DELETE /comments (delete)
 *   - POST /public/customers/profile (session-gated via renderer proxy)
 *   - POST /customer/order-history, POST /customer/profile-read (CMRC-1B: the account pages' reads; the email is
 *     the validated session's, `lib/customer-api.ts`)
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

/**
 * One backend call with the renderer key (CMRC-1B: moved here from `lib/booking-proxy.ts`, where it was `forward`;
 * the contract is unchanged). Users: the booking proxy (`lib/booking-proxy.ts`) and the customer reads
 * (`lib/customer-api.ts`).
 *
 * `POST` when `body` is given, else `GET`. The request carries EXACTLY the headers written here — the renderer key
 * (`x-api-key`, which the backend resolves to the role `RENDERER`), `x-tenant-id` and, for a POST, `content-type` —
 * and never a header of the browser's request. The caller passes the id of the tenant record the renderer found for
 * the address it serves, never a value the browser chose (PD-002).
 *
 * Returns the backend's `Response` for EVERY HTTP status (the caller decides what a 4xx or 5xx means), or `null` when
 * the renderer cannot call the backend: no `API_URL`, no key, or the call itself failed. The failure is logged with
 * the route only (its query removed) and the error's name — never a body, a key or a header. There is no timeout of
 * its own: the call ends when the backend answers or the connection fails.
 */
export async function callBackend(route: string, tenantId: string, body?: Record<string, unknown>)
    : Promise<globalThis.Response | null> {
    const apiUrl = process.env.API_URL?.replace(/\/$/, "");
    if (!apiUrl) {
        console.error("[backend-call] API_URL is not set");
        return null;
    }
    const key = await getRendererKey();
    if (!key) {
        console.error("[backend-call] no renderer key");
        return null;
    }
    const headers: Record<string, string> = { "x-api-key": key, "x-tenant-id": tenantId };
    if (body !== undefined) headers["content-type"] = "application/json";
    try {
        return await fetch(`${apiUrl}${route}`, {
            method: body !== undefined ? "POST" : "GET",
            headers,
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            cache: "no-store",
        });
    } catch (e) {
        console.error(`[backend-call] backend call failed: ${route.split("?")[0]}`, e instanceof Error ? e.name : "unknown");
        return null;
    }
}
