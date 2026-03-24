import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import * as fs from "fs";
import * as path from "path";

// 1. Parse Arguments
// Args: [node, script, StackName]
const STACK_NAME = process.argv[2] || "AmodxStack-staging";
const REGION = process.env.AWS_REGION || "eu-central-1";

async function main() {
    console.log(`🔍 Fetching outputs for stack: ${STACK_NAME} in ${REGION}...`);

    const cf = new CloudFormationClient({ region: REGION });
    const sm = new SecretsManagerClient({ region: REGION });

    // 2. Get Stack Outputs
    try {
        const stackRes = await cf.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
        const outputs = stackRes.Stacks?.[0].Outputs || [];

        const getOutput = (keyPart: string) => outputs.find(o => o.OutputKey?.includes(keyPart))?.OutputValue;

        const apiUrl = getOutput("ApiApiUrl");
        const adminPoolId = getOutput("AdminPoolId");
        const adminClientId = getOutput("AdminClientId");
        const publicPoolId = getOutput("PublicPoolId");
        const publicClientId = getOutput("PublicClientId");
        const rendererUrl = getOutput("RendererHostingRendererUrl");
        const secretName = getOutput("MasterKeySecretName");

        if (!apiUrl || !secretName) {
            console.error("❌ Critical outputs missing. Did deployment succeed?");
            process.exit(1);
        }

        // 3. Fetch Secret Value
        console.log(`🔐 Fetching Master Key from Secrets Manager: ${secretName}...`);
        const secretRes = await sm.send(new GetSecretValueCommand({ SecretId: secretName }));
        const secretString = secretRes.SecretString || "";

        let apiKey = "";

        try {
            const secretJson = JSON.parse(secretString);
            apiKey = secretJson.apiKey || secretString;
        } catch (e) {
            apiKey = secretString;
        }

        if (!apiKey) {
            console.error("❌ Failed to retrieve API Key from secret.");
            process.exit(1);
        }

        // 4. Write Admin .env.local
        const adminEnv = `
VITE_API_URL=${apiUrl}
VITE_USER_POOL_ID=${adminPoolId}
VITE_USER_POOL_CLIENT_ID=${adminClientId}
VITE_RENDERER_URL=${rendererUrl}
VITE_REGION=${REGION}
`.trim();

        fs.writeFileSync(path.join(__dirname, "../admin/.env.local"), adminEnv);
        console.log("✅ Updated admin/.env.local");

        // 5. Write Renderer .env.local
        // API_URL is required by renderer proxy routes (contact, leads, consent, profile POST).
        // AMODX_API_KEY is the local-dev fallback for the renderer key.
        const rendererEnv = `
TABLE_NAME=${getOutput("TableName")}
AWS_REGION=${REGION}
API_URL=${apiUrl}
AMODX_API_KEY=${apiKey}
NEXT_PUBLIC_API_URL=${apiUrl}
NEXT_PUBLIC_USER_POOL_ID=${publicPoolId}
NEXT_PUBLIC_USER_POOL_CLIENT_ID=${publicClientId}
`.trim();

        fs.writeFileSync(path.join(__dirname, "../renderer/.env.local"), rendererEnv);
        console.log("✅ Updated renderer/.env.local");

        // 6. Write MCP .env
        const mcpEnv = `
AMODX_API_URL=${apiUrl}
AMODX_API_KEY="${apiKey}"
`.trim();
        fs.writeFileSync(path.join(__dirname, "../tools/mcp-server/.env"), mcpEnv);
        console.log("✅ Updated tools/mcp-server/.env");

        // 7. Write Testing .env (For Playwright/Vitest)
        const testEnv = `
TABLE_NAME=${getOutput("TableName")}
ADMIN_API_URL=${apiUrl}
TENANT_API_URL=${apiUrl} 
TEST_ADMIN_USER=admin@staging.amodx.net
TEST_ADMIN_PASSWORD=ChangeMe123!
AMODX_API_KEY="${apiKey}"
`.trim();
        fs.writeFileSync(path.join(__dirname, "../.env.test"), testEnv);
        console.log("✅ Updated .env.test (Root)");

        console.log(`\n🚀 Environment Configured for ${STACK_NAME}!`);

    } catch (e: any) {
        console.error(`❌ Failed to fetch stack ${STACK_NAME}: ${e.message}`);
        process.exit(1);
    }
}

main().catch(console.error);
