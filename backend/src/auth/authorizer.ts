import {
    APIGatewayRequestAuthorizerEventV2,
    APIGatewaySimpleAuthorizerWithContextResult
} from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { AuthorizerContext } from "./context.js";
import {
    SERVICE_KEY_PREFIX,
    hashServiceKeySecret,
    findServiceKeyByHash,
    touchServiceKey,
} from "../lib/service-keys.js";
import { publishAudit } from "../lib/events.js";
import { SERVICE_ROUTE_SCOPES } from "./policy.js";

const userPoolId = process.env.USER_POOL_ID!;
const clientId = process.env.USER_POOL_CLIENT_ID!;
const secretName = process.env.MASTER_KEY_SECRET_NAME!;
const rendererKeySecretName = process.env.RENDERER_KEY_SECRET_NAME; // Optional, for Phase 2.1

// Public Cognito pool for customer auth — both must be set or neither.
const publicPoolId = process.env.PUBLIC_POOL_ID;
const publicPoolClientId = process.env.PUBLIC_POOL_CLIENT_ID;

// GUARD: Fail closed on misconfigured public pool env vars.
// One set without the other is a deployment error, not a graceful degradation case.
const publicPoolMisconfigured =
    (publicPoolId && !publicPoolClientId) || (!publicPoolId && publicPoolClientId);
if (publicPoolMisconfigured) {
    console.error(
        "CRITICAL: PUBLIC_POOL_ID and PUBLIC_POOL_CLIENT_ID must both be set or both be unset. " +
        `Got PUBLIC_POOL_ID=${publicPoolId ? "SET" : "UNSET"}, PUBLIC_POOL_CLIENT_ID=${publicPoolClientId ? "SET" : "UNSET"}. ` +
        "Public pool verification is DISABLED."
    );
}
const publicPoolEnabled = !!(publicPoolId && publicPoolClientId && !publicPoolMisconfigured);

let cachedMasterKey: string | null = null;
let cachedRendererKey: string | null = null;
const secretsClient = new SecretsManagerClient({});

async function getMasterKey() {
    if (cachedMasterKey) return cachedMasterKey;
    try {
        const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));
        if (response.SecretString) {
            try {
                const secret = JSON.parse(response.SecretString);
                cachedMasterKey = secret.apiKey;
            } catch (e) {
                // FALLBACK: The secret is just a raw string
                cachedMasterKey = response.SecretString;
            }
            // CRITICAL: Trim whitespace/newlines
            cachedMasterKey = cachedMasterKey?.trim() || null;
            return cachedMasterKey;
        }
    } catch (e) {
        console.error("Failed to fetch Master Key secret", e);
    }
    return null;
}

// Phase 2.1: Fetch restricted RENDERER key for renderer Lambda
async function getRendererKey() {
    if (!rendererKeySecretName) return null;
    if (cachedRendererKey) return cachedRendererKey;
    try {
        const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: rendererKeySecretName }));
        if (response.SecretString) {
            try {
                const secret = JSON.parse(response.SecretString);
                cachedRendererKey = secret.apiKey || response.SecretString;
            } catch (e) {
                cachedRendererKey = response.SecretString;
            }
            cachedRendererKey = cachedRendererKey?.trim() || null;
            return cachedRendererKey;
        }
    } catch (e) {
        console.error("Failed to fetch Renderer Key secret", e);
    }
    return null;
}

const verifier = CognitoJwtVerifier.create({
    userPoolId: userPoolId,
    tokenUse: "id",
    clientId: clientId,
});

// Public pool verifier — only created when both env vars are present and valid.
// Uses "id" token (same as admin) because custom attributes live on the id token.
const publicVerifier = publicPoolEnabled
    ? CognitoJwtVerifier.create({
        userPoolId: publicPoolId!,
        tokenUse: "id",
        clientId: publicPoolClientId!,
    })
    : null;


export const handler = async (
    event: APIGatewayRequestAuthorizerEventV2
): Promise<APIGatewaySimpleAuthorizerWithContextResult<AuthorizerContext>> => {

    const response: APIGatewaySimpleAuthorizerWithContextResult<AuthorizerContext> = {
        isAuthorized: false,
        context: { sub: "" }
    };

    const headers = event.headers || {};
    const apiKey = headers['x-api-key'] || headers['X-Api-Key'];
    const authHeader = headers['authorization'] || headers['Authorization'];


    // DEBUG LOGGING
    console.log("Auth Incoming:", {
        route: event.routeKey,
        hasApiKey: !!apiKey,
        apiKeyLen: apiKey?.length,
        hasAuthHeader: !!authHeader
    });

    // 1. API key checks run FIRST, before any route-based bypass.
    // This allows renderer proxies to authenticate on public routes
    // instead of falling through to anonymous.
    const masterKey = await getMasterKey();
    if (!masterKey) {
        console.error("CRITICAL: Failed to retrieve Master Key from Secrets Manager.");
    }

    if (masterKey && apiKey && apiKey === masterKey) {
        console.log("Auth Success: Master Key Match");
        return {
            isAuthorized: true,
            context: { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" }
        };
    }

    const rendererKey = await getRendererKey();
    if (rendererKey && apiKey === rendererKey) {
        console.log("Auth Success: Renderer Key Match");
        return {
            isAuthorized: true,
            context: { sub: "renderer", role: "RENDERER", tenantId: "ALL" }
        };
    }

    // 1b. Service key (SERVICE-ACCOUNT-1): a tenant-bound `amx_sk_` key. One point read by sha256(secret);
    // absent = unknown or revoked → deny. Never falls through to the anonymous public routes or the
    // token branch: a presented service key either authenticates as itself or the request is refused.
    if (apiKey?.startsWith(SERVICE_KEY_PREFIX)) {
        const keyHash = hashServiceKeySecret(apiKey);
        let record;
        try {
            record = await findServiceKeyByHash(keyHash);
        } catch (e) {
            // Fail closed: a lookup that cannot complete is a deny, not an unhandled authorizer error.
            console.error("Auth: service key lookup failed", {
                route: event.routeKey,
                error: e instanceof Error ? e.message : String(e),
            });
            return response;
        }
        if (!record) {
            console.warn("Auth: service key unknown or revoked", { route: event.routeKey });
            return response;
        }

        // Route allowlist (ruling D-SA-E): a key reaches ONLY the routes in SERVICE_ROUTE_SCOPES, holding that
        // route's scope, for its own tenant. Decided here because the authorizer sees every request; handlers
        // that never call requireRole cannot be reached by a key. A denied request runs no Lambda and is not metered.
        const neededScope = SERVICE_ROUTE_SCOPES[event.routeKey];
        if (!neededScope) {
            console.warn("Auth: service key on a route not open to service keys", { route: event.routeKey, keyId: record.keyId });
            return response;
        }
        if (!record.scopes.includes(neededScope)) {
            console.warn("Auth: service key lacks scope", { route: event.routeKey, keyId: record.keyId, needed: neededScope });
            return response;
        }
        const headerTenantId = headers['x-tenant-id'] || headers['X-Tenant-Id'];
        if (!headerTenantId || headerTenantId !== record.tenantId) {
            console.warn("Auth: service key bound to another tenant", { route: event.routeKey, keyId: record.keyId });
            return response;
        }

        // Once-a-day use mark + audit entry. A metering failure must not take the integration down.
        const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
        if (record.lastUsedDay !== today) {
            try {
                await touchServiceKey(record.tenantId, record.keyId, keyHash, today);
                await publishAudit({
                    tenantId: record.tenantId,
                    actor: { id: `service:${record.keyId}` },
                    action: "SERVICE_KEY_USED",
                    target: { id: record.keyId, title: record.name },
                });
            } catch (e) {
                console.error("Auth: service key use mark failed (request still authorised)", {
                    keyId: record.keyId,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        console.log("Auth Success: Service Key", { keyId: record.keyId, tenantId: record.tenantId });
        // HARD GUARD: role is a string literal; tenantId and scopes come from the stored record, never a header.
        return {
            isAuthorized: true,
            context: {
                sub: `service:${record.keyId}`,
                role: "SERVICE",
                tenantId: record.tenantId,
                scopes: record.scopes.join(","),
                keyId: record.keyId,
            },
        };
    }

    // Log mismatch if a key was provided but matched neither master nor renderer
    if (apiKey && masterKey) {
        console.warn("Auth: API key mismatch", {
            route: event.routeKey,
            clientKeyLength: apiKey?.length,
            serverKeyLength: masterKey.length,
            ip: event.requestContext?.http?.sourceIp,
        });
    }

    // 2. Public routes — allow anonymous when no valid key was presented.
    // Renderer proxies send the renderer key and resolve above as RENDERER.
    // Direct browser callers (if any) reach here and get anonymous.
    if (event.routeKey === "POST /leads" || event.routeKey === "POST /contact" || event.routeKey === "POST /consent") {
        console.log("Auth Success: Public Route (anonymous)");
        return { isAuthorized: true, context: { sub: "anonymous" } };
    }

    // 3. Cognito Token Check
    if (!authHeader) {
        console.log("Auth: API key failed, and no credentials provided");
        // If we have an API key but it was wrong, we fail here
        if (apiKey) console.warn("Auth: Invalid API Key");
        return response;
    }

    const token = authHeader.replace("Bearer ", "");

    // Skip verification for dummy robot token if key check failed
    if (token === "robot") {
        console.warn("Auth: Dummy robot token used but API Key failed (See mismatch logs above).");
        return response;
    }

    // 3a. Try Admin pool JWT first
    try {
        const payload = await verifier.verify(token);

        // Read custom attributes from the token payload.
        // Cognito stores custom attributes as "custom:role".
        const role = (payload as any)["custom:role"] || "EDITOR";
        const tenantId = (payload as any)["custom:tenantId"] || "";

        return {
            isAuthorized: true,
            context: {
                sub: payload.sub,
                email: (payload as any).email,
                role: role,
                tenantId: tenantId
            }
        };
    } catch (adminErr) {
        // Admin pool rejected the token. Fall through to public pool if enabled.
    }

    // 3b. Try Public pool JWT — fail-closed branch.
    // SECURITY INVARIANTS:
    //   - role is ALWAYS the literal "CUSTOMER", never derived from token claims
    //   - tenantId is ALWAYS extracted from custom:tenant_id and must be non-empty
    //   - if either is missing, the token is rejected
    // WARNING: Do NOT add customer routes under anonymous-bypass paths (POST /leads,
    //   POST /contact, POST /consent) — those resolve before JWT verification and
    //   would ignore the bearer token entirely.
    if (publicVerifier) {
        try {
            const payload = await publicVerifier.verify(token);

            const tenantId = (payload as any)["custom:tenant_id"];
            if (!tenantId || typeof tenantId !== "string" || tenantId.trim() === "") {
                console.error("Auth: Public pool token missing or empty custom:tenant_id", {
                    sub: payload.sub,
                    route: event.routeKey,
                });
                return response;
            }

            console.log("Auth Success: Public Pool Customer", {
                sub: payload.sub,
                tenantId: tenantId,
            });

            // HARD GUARD: role is a string literal. Not from token. Not defaultable.
            // If policy.ts line 15 ever sees this context, role will be "CUSTOMER",
            // and requireRole() will only pass if "CUSTOMER" is in the allowedRoles array.
            return {
                isAuthorized: true,
                context: {
                    sub: payload.sub,
                    email: (payload as any).email,
                    role: "CUSTOMER",
                    tenantId: tenantId.trim(),
                }
            };
        } catch (publicErr) {
            console.error("Auth: Both admin and public pool token verification failed", {
                route: event.routeKey,
            });
            return response;
        }
    }

    console.error("Auth: Admin pool token verification failed, public pool not enabled", {
        route: event.routeKey,
    });
    return response;
};

