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

// Helper to print hex diff
function logKeyMismatch(serverKey: string, clientKey: string) {
    const lenS = serverKey.length;
    const lenC = clientKey.length;

    // Find first difference
    let i = 0;
    while (i < lenS && i < lenC && serverKey[i] === clientKey[i]) {
        i++;
    }

    console.warn("================ AUTH DEBUG ================");
    console.warn(`❌ Key Mismatch at Index: ${i}`);
    console.warn(`📏 Lengths -> Server: ${lenS}, Client: ${lenC}`);

    if (i < lenS) {
        const char = serverKey.charCodeAt(i);
        const hex = char.toString(16);
        console.warn(`🔹 Server char at ${i}: '${serverKey[i]}' (Code: ${char}, Hex: ${hex})`);
        console.warn(`🔹 Server Tail (Hex): ${Buffer.from(serverKey.substring(i)).toString('hex')}`);
    } else {
        console.warn(`🔹 Server key ended.`);
    }

    if (i < lenC) {
        const char = clientKey.charCodeAt(i);
        const hex = char.toString(16);
        console.warn(`🔸 Client char at ${i}: '${clientKey[i]}' (Code: ${char}, Hex: ${hex})`);
        console.warn(`🔸 Client Tail (Hex): ${Buffer.from(clientKey.substring(i)).toString('hex')}`);
    } else {
        console.warn(`🔸 Client key ended.`);
    }
    console.warn("============================================");
}

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

    // Public Routes
    if (event.routeKey === "POST /leads" || event.routeKey === "POST /contact" || event.routeKey === "POST /consent") {
        console.log("✅ Auth Success: Public Route Bypass");
        return { isAuthorized: true, context: { sub: "anonymous" } };
    }

    // 1. Fetch Key
    const masterKey = await getMasterKey();
    if (!masterKey) {
        console.error("CRITICAL: Failed to retrieve Master Key from Secrets Manager.");
    }

    // 2. Compare Master Key
    if (masterKey && apiKey) {
        if (apiKey === masterKey) {
            console.log("✅ Auth Success: Master Key Match");
            return {
                isAuthorized: true,
                context: { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" }
            };
        } else {
            // Log forensic details (only if not renderer key)
            const rendererKey = await getRendererKey();
            if (!rendererKey || apiKey !== rendererKey) {
                logKeyMismatch(masterKey, apiKey);
            }
        }
    }

    // 2b. Phase 2.1: Compare RENDERER Key (restricted role - can only POST/DELETE comments)
    const rendererKey = await getRendererKey();
    if (rendererKey && apiKey === rendererKey) {
        console.log("✅ Auth Success: Renderer Key Match");
        return {
            isAuthorized: true,
            context: { sub: "renderer", role: "RENDERER", tenantId: "ALL" }
        };
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

