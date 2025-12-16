import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import * as fs from "fs";
import * as path from "path";

const REGION = process.env.AWS_REGION || "eu-central-1"; // Or grab from aws configure
const STACK_NAME = "AmodxStack";

async function main() {
    console.log(`🔍 Fetching outputs for stack: ${STACK_NAME} in ${REGION}...`);

    const cf = new CloudFormationClient({ region: REGION });
    const sm = new SecretsManagerClient({ region: REGION });

    // 1. Get Stack Outputs
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

    // 2. Fetch Secret Value
    console.log(`🔐 Fetching Master Key from Secrets Manager: ${secretName}...`);
    const secretRes = await sm.send(new GetSecretValueCommand({ SecretId: secretName }));
    const secretJson = JSON.parse(secretRes.SecretString || "{}");
    const apiKey = secretJson.apiKey;

    // 3. Write Admin .env.local
    const adminEnv = `
VITE_API_URL=${apiUrl}
VITE_USER_POOL_ID=${adminPoolId}
VITE_USER_POOL_CLIENT_ID=${adminClientId}
VITE_RENDERER_URL=${rendererUrl}
VITE_REGION=${REGION}
`.trim();

    fs.writeFileSync(path.join(__dirname, "../admin/.env.local"), adminEnv);
    console.log("✅ Updated admin/.env.local");

    // 4. Write Renderer .env.local
    const rendererEnv = `
TABLE_NAME=${getOutput("TableName")}
AWS_REGION=${REGION}
NEXT_PUBLIC_USER_POOL_ID=${publicPoolId}
NEXT_PUBLIC_USER_POOL_CLIENT_ID=${publicClientId}
`.trim();

    fs.writeFileSync(path.join(__dirname, "../renderer/.env.local"), rendererEnv);
    console.log("✅ Updated renderer/.env.local");

    // 5. Write MCP .env
    const mcpEnv = `
AMODX_API_URL=${apiUrl}
AMODX_API_KEY=${apiKey}
`.trim();
    fs.writeFileSync(path.join(__dirname, "../tools/mcp-server/.env"), mcpEnv);
    console.log("✅ Updated tools/mcp-server/.env");

    console.log("\n🚀 Environment Configured! You can now run local dev servers.");
}

main().catch(console.error);
