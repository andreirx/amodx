import {
    APIGatewayRequestAuthorizerEventV2,
    APIGatewaySimpleAuthorizerWithContextResult
} from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { AuthorizerContext } from "./context";

const userPoolId = process.env.USER_POOL_ID!;
const clientId = process.env.USER_POOL_CLIENT_ID!;
const secretName = process.env.MASTER_KEY_SECRET_NAME!;

let cachedMasterKey: string | null = null;
const secretsClient = new SecretsManagerClient({});

async function getMasterKey() {
    if (cachedMasterKey) return cachedMasterKey;
    try {
        const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));
        if (response.SecretString) {
            const secret = JSON.parse(response.SecretString);
            cachedMasterKey = secret.apiKey || response.SecretString;
            return cachedMasterKey;
        }
    } catch (e) {
        console.error("Failed to fetch Master Key secret", e);
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

    // 1. Setup Default Response (Deny)
    // We must return a strictly typed response even on failure
    const response: APIGatewaySimpleAuthorizerWithContextResult<AuthorizerContext> = {
        isAuthorized: false,
        context: {
            sub: "", // Placeholder required by type safety
        }
    };

    const headers = event.headers || {};

    // 2. CHECK: Master API Key
    const masterKey = await getMasterKey();
    const apiKey = headers['x-api-key'];

    if (masterKey && apiKey === masterKey) {
        return {
            isAuthorized: true,
            context: {
                sub: "system-robot",
                role: "GLOBAL_ADMIN",
                tenantId: "ALL"
            }
        };
    }

    if (event.routeKey === "POST /leads") {
        return { isAuthorized: true, context: { sub: "anonymous" } };
    }

    // 3. CHECK: Cognito Token
    const authHeader = headers['authorization'] || headers['Authorization'];
    if (!authHeader) {
        return response; // Deny
    }

    const token = authHeader.replace("Bearer ", "");

    try {
        const payload = await verifier.verify(token);
        return {
            isAuthorized: true,
            context: {
                sub: payload.sub,
                email: (payload as any).email,
                role: "USER" // Placeholder until we map roles
            }
        };
    } catch (err) {
        console.error("Auth failed:", err);
        return response; // Deny
    }
};
