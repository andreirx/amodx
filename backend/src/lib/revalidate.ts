import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

/**
 * Phase 4: Backend revalidation helper.
 * Calls the renderer's /api/revalidate endpoint with a secure token.
 *
 * Usage:
 * - After content publish: await revalidatePath(tenantDomain, '/about')
 * - After product update: await revalidateTag('product-123')
 * - After theme change: await revalidateTag('tenant-abc123')
 */

let cachedSecret: string | null = null;
const secretName = process.env.REVALIDATION_SECRET_NAME;
const rendererUrl = process.env.RENDERER_URL;

const secretsClient = new SecretsManagerClient({});

async function getRevalidationSecret(): Promise<string | null> {
    if (!secretName) return null;
    if (cachedSecret) return cachedSecret;

    try {
        const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));
        if (res.SecretString) {
            cachedSecret = res.SecretString.trim();
            return cachedSecret;
        }
    } catch (e) {
        console.error("Failed to fetch revalidation secret:", e);
    }
    return null;
}

/**
 * Revalidate a specific path for a tenant.
 *
 * @param tenantDomain - The tenant's domain (e.g., "shop.example.com")
 * @param slug - The path to revalidate (e.g., "/about", "/products/widget")
 */
export async function revalidatePath(tenantDomain: string, slug: string): Promise<void> {
    if (!rendererUrl || !secretName) {
        console.log("[Revalidate] Skipping - RENDERER_URL or REVALIDATION_SECRET_NAME not set");
        return;
    }

    try {
        const secret = await getRevalidationSecret();
        if (!secret) {
            console.warn("[Revalidate] No secret available");
            return;
        }

        const res = await fetch(`${rendererUrl}/api/revalidate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-revalidation-token': secret,
            },
            body: JSON.stringify({ domain: tenantDomain, slug }),
        });

        if (!res.ok) {
            console.warn(`[Revalidate] Path failed: ${res.status}`, await res.text());
        } else {
            console.log(`[Revalidate] Path success: /${tenantDomain}${slug}`);
        }
    } catch (e) {
        console.error('[Revalidate] Path error:', e);
        // Don't fail the request - revalidation is best-effort
    }
}

/**
 * Revalidate all pages associated with a cache tag.
 *
 * @param tag - The cache tag (e.g., "product-123", "category-456", "tenant-abc")
 */
export async function revalidateTag(tag: string): Promise<void> {
    if (!rendererUrl || !secretName) {
        console.log("[Revalidate] Skipping - RENDERER_URL or REVALIDATION_SECRET_NAME not set");
        return;
    }

    try {
        const secret = await getRevalidationSecret();
        if (!secret) {
            console.warn("[Revalidate] No secret available");
            return;
        }

        const res = await fetch(`${rendererUrl}/api/revalidate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-revalidation-token': secret,
            },
            body: JSON.stringify({ tag }),
        });

        if (!res.ok) {
            console.warn(`[Revalidate] Tag failed: ${res.status}`, await res.text());
        } else {
            console.log(`[Revalidate] Tag success: ${tag}`);
        }
    } catch (e) {
        console.error('[Revalidate] Tag error:', e);
    }
}
