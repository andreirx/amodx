import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let cachedKey: string | null = null;

export async function getMasterKey() {
    if (cachedKey) return cachedKey;

    // If running locally, use .env
    if (process.env.AMODX_API_KEY) return process.env.AMODX_API_KEY;

    // If on AWS, fetch from Secrets Manager
    if (process.env.AMODX_API_KEY_SECRET) {
        const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
        const res = await client.send(new GetSecretValueCommand({ SecretId: process.env.AMODX_API_KEY_SECRET }));
        const json = JSON.parse(res.SecretString || "{}");
        cachedKey = json.apiKey;
        return cachedKey;
    }
    return "";
}
