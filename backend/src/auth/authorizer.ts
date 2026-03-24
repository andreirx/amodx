import {
    APIGatewayRequestAuthorizerEventV2,
    APIGatewaySimpleAuthorizerWithContextResult
} from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { AuthorizerContext } from "./context.js";

const userPoolId = process.env.USER_POOL_ID!;
const clientId = process.env.USER_POOL_CLIENT_ID!;
const secretName = process.env.MASTER_KEY_SECRET_NAME!;
const rendererKeySecretName = process.env.RENDERER_KEY_SECRET_NAME; // Optional, for Phase 2.1

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

    try {
        const payload = await verifier.verify(token);

        // FIX: Read custom attributes from the token payload
        // Cognito stores custom attributes as "custom:role"
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
    } catch (err) {
        console.error("Auth: Token verification failed", err);
        return response;
    }
};

