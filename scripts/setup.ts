import prompts from 'prompts';
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminUpdateUserAttributesCommand } from "@aws-sdk/client-cognito-identity-provider";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// Helper to run shell commands
const run = (cmd: string) => {
    console.log(`> ${cmd}`);
    try {
        execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
        console.error(`Command failed: ${cmd}`);
        process.exit(1);
    }
};

async function main() {
    console.log("\n🚀 AMODX Zero-Config Installer\n");

    // 1. Verify AWS Identity
    const region = process.env.AWS_REGION || "eu-central-1";
    const sts = new STSClient({ region });
    let accountId = "";

    try {
        const id = await sts.send(new GetCallerIdentityCommand({}));
        accountId = id.Account!;
        console.log(`✅ Connected to AWS Account: ${accountId} (${region})`);
    } catch (e) {
        console.error("❌ AWS Credentials not found. Run 'aws configure' first.");
        process.exit(1);
    }

    // 2. Collect Configuration
    const response = await prompts([
        {
            type: 'text',
            name: 'stackName',
            message: 'Stack Name (e.g. AmodxStack):',
            initial: 'AmodxStack'
        },
        {
            type: 'text',
            name: 'rootDomain',
            message: 'Agency Domain (e.g. amodx.net):',
            validate: val => val ? true : 'Domain is required'
        },
        {
            type: 'text',
            name: 'sesEmail',
            message: 'SES Verified Sender Email (for notifications):',
            validate: val => val.includes('@') ? true : 'Invalid email'
        },
        {
            type: 'confirm',
            name: 'deploy',
            message: 'Ready to deploy infrastructure? (Takes ~15 mins)',
            initial: true
        }
    ]);

    if (!response.deploy) {
        console.log("Aborted.");
        process.exit(0);
    }

    // 3. Write Config
    const config = {
        stackName: response.stackName,
        account: accountId,
        region: region,
        sesEmail: response.sesEmail,
        domains: {
            root: response.rootDomain,
            tenants: []
        }
    };

    fs.writeFileSync("amodx.config.json", JSON.stringify(config, null, 2));
    console.log("✅ Created amodx.config.json");

    // 4. Bootstrap CDK (Idempotent)
    console.log("\n📦 Bootstrapping CDK...");
    run(`npx cdk bootstrap aws://${accountId}/${region}`);

    // 5. Deploy Infrastructure
    console.log("\n🏗️ Deploying Stack (Go grab a coffee)...");
    // Note: We use --require-approval never because we are in an interactive setup script
    run(`cd infra && npx cdk deploy --require-approval never`);

    // 6. Post-Deploy Configuration
    console.log("\n🔄 Syncing Environment Variables...");
    run(`npm run post-deploy ${response.stackName}`);

    // 7. Admin User Creation
    console.log("\n👤 Create Global Admin User");
    const user = await prompts([
        {
            type: 'text',
            name: 'email',
            message: 'Admin Email:',
            initial: response.sesEmail
        },
        {
            type: 'password',
            name: 'password',
            message: 'Temporary Password:',
            validate: val => val.length >= 8 ? true : 'Min 8 chars'
        }
    ]);

    if (user.email && user.password) {
        // Read env for Pool ID
        const adminEnvPath = path.join(__dirname, "../admin/.env.local");
        const adminEnv = fs.readFileSync(adminEnvPath, 'utf-8');
        const poolIdMatch = adminEnv.match(/VITE_USER_POOL_ID=(.*)/);

        if (poolIdMatch) {
            const userPoolId = poolIdMatch[1];
            const cognito = new CognitoIdentityProviderClient({ region });

            try {
                console.log("Creating user...");
                await cognito.send(new AdminCreateUserCommand({
                    UserPoolId: userPoolId,
                    Username: user.email,
                    TemporaryPassword: user.password,
                    MessageAction: "SUPPRESS"
                }));

                console.log("Promoting to Global Admin...");
                await cognito.send(new AdminUpdateUserAttributesCommand({
                    UserPoolId: userPoolId,
                    Username: user.email,
                    UserAttributes: [
                        { Name: "custom:role", Value: "GLOBAL_ADMIN" },
                        { Name: "custom:tenantId", Value: "GLOBAL" },
                        { Name: "email_verified", Value: "true" }
                    ]
                }));
                console.log("✅ User Created & Promoted!");
            } catch (e: any) {
                if (e.name === 'UsernameExistsException') {
                    console.log("⚠️ User already exists. Skipping creation.");
                } else {
                    console.error("❌ Failed to create user:", e.message);
                }
            }
        } else {
            console.error("❌ Could not find UserPoolId in .env.local");
        }
    }

    console.log("\n✨ Setup Complete!");
    console.log("---------------------------------------");
    console.log("Admin Panel URL is in the logs above.");
    console.log(`Login with: ${user.email}`);
    console.log("---------------------------------------");
}

main();
