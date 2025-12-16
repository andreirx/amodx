import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const region = process.env.AWS_REGION || "eu-central-1"; // Default or Env
    const client = new STSClient({ region });

    console.log("🔍 Detecting AWS Account...");

    try {
        const data = await client.send(new GetCallerIdentityCommand({}));
        const accountId = data.Account;

        if (!accountId) throw new Error("Could not detect Account ID");

        const configPath = path.join(__dirname, "../amodx.config.json");

        // Default Config Structure
        const config = {
            stackName: "AmodxStack", // Your current stack
            account: accountId,
            region: region,
            domains: {
                root: "amodx.net", // Your agency domain
                // The Certificate ARN will be filled by the domain manager script later
                globalCertArn: "",
                tenants: [
                    // "client-a.com" - Add domains here later
                ]
            }
        };

        // Don't overwrite if exists, just log
        if (fs.existsSync(configPath)) {
            console.log("⚠️  amodx.config.json already exists. Skipping generation.");
            console.log("👉 Edit it manually to add tenant domains.");
        } else {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            console.log(`✅ Generated amodx.config.json for Account: ${accountId}`);
        }

    } catch (e: any) {
        console.error("❌ Failed to detect AWS identity. Run 'aws configure' first.");
        console.error(e.message);
        process.exit(1);
    }
}

main();
