import { db, TABLE_NAME } from "./db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Phase 3.4: Verify tenant ID against request origin.
 *
 * Problem: Public routes trust the client-provided x-tenant-id header.
 * An attacker can submit requests against any tenant.
 *
 * Solution: Verify that the origin/referer domain matches the tenant's configured domain.
 *
 * Note: This adds a DynamoDB lookup per request. For high-traffic routes,
 * consider caching tenant→domain mappings in memory or using signed cookies.
 */

// Simple in-memory cache with 5-minute TTL
const domainCache = new Map<string, { tenantId: string; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Look up tenant ID by domain (uses GSI_Domain)
 */
async function getTenantByDomain(domain: string): Promise<string | null> {
    // Check cache first
    const cached = domainCache.get(domain);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.tenantId;
    }

    try {
        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: "GSI_Domain",
            KeyConditionExpression: "#d = :domain",
            ExpressionAttributeNames: { "#d": "domain" },
            ExpressionAttributeValues: { ":domain": domain },
            ProjectionExpression: "id"
        }));

        if (result.Items && result.Items.length > 0) {
            const tenantId = result.Items[0].id;
            // Cache the result
            domainCache.set(domain, { tenantId, timestamp: Date.now() });
            return tenantId;
        }
    } catch (e) {
        console.error("getTenantByDomain error:", e);
    }
    return null;
}

/**
 * Extract hostname from origin or referer header.
 */
function extractHostname(url: string): string | null {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return null;
    }
}

/**
 * Verify that the provided tenant ID matches the origin domain.
 *
 * @param headers - Request headers (origin, referer)
 * @param tenantId - Tenant ID from x-tenant-id header
 * @returns true if tenant ID matches origin, false otherwise
 */
export async function verifyTenantFromOrigin(
    headers: Record<string, string | undefined>,
    tenantId: string
): Promise<boolean> {
    // Extract origin or referer
    const origin = headers['origin'] || headers['Origin'];
    const referer = headers['referer'] || headers['Referer'];

    const url = origin || referer;
    if (!url) {
        // No origin/referer - could be direct API call
        // For strict security, return false. For development/testing, might allow.
        console.warn("verifyTenantFromOrigin: No origin or referer header");
        return false;
    }

    const hostname = extractHostname(url);
    if (!hostname) {
        console.warn("verifyTenantFromOrigin: Invalid origin URL", url);
        return false;
    }

    // Look up tenant by domain
    const resolvedTenantId = await getTenantByDomain(hostname);
    if (!resolvedTenantId) {
        console.warn(`verifyTenantFromOrigin: No tenant found for domain ${hostname}`);
        return false;
    }

    if (resolvedTenantId !== tenantId) {
        console.warn(`verifyTenantFromOrigin: Tenant mismatch. Header: ${tenantId}, Domain: ${resolvedTenantId}`);
        return false;
    }

    return true;
}

/**
 * Derive tenant ID from origin/referer header (alternative approach).
 * Use this instead of trusting x-tenant-id for public routes.
 *
 * @param headers - Request headers
 * @returns Tenant ID if found, null otherwise
 */
export async function deriveTenantFromOrigin(
    headers: Record<string, string | undefined>
): Promise<string | null> {
    const origin = headers['origin'] || headers['Origin'];
    const referer = headers['referer'] || headers['Referer'];

    const url = origin || referer;
    if (!url) return null;

    const hostname = extractHostname(url);
    if (!hostname) return null;

    return getTenantByDomain(hostname);
}
