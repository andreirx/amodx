import prompts from 'prompts';
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { SSMClient, PutParameterCommand, GetParameterCommand } from "@aws-sdk/client-ssm";
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
    console.log("\n AMODX Zero-Config Installer\n");

    // ═══════════════════════════════════════════════════
    // 1. Verify AWS Identity
    // ═══════════════════════════════════════════════════
    const region = process.env.AWS_REGION || "eu-central-1";
    const sts = new STSClient({ region });
    let accountId = "";

    try {
        const id = await sts.send(new GetCallerIdentityCommand({}));
        accountId = id.Account!;
        console.log(`Connected to AWS Account: ${accountId} (${region})`);
    } catch (e) {
        console.error("AWS Credentials not found. Run 'aws configure' first.");
        process.exit(1);
    }

    // ═══════════════════════════════════════════════════
    // 2. Collect Configuration
    // ═══════════════════════════════════════════════════
    console.log("\n--- Agency Configuration ---\n");

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
    ]);

    if (!response.rootDomain) {
        console.log("Aborted.");
        process.exit(0);
    }

    // ═══════════════════════════════════════════════════
    // 3. Bot Protection (reCAPTCHA v3) — MANDATORY
    // ═══════════════════════════════════════════════════
    console.log("\n--- Bot Protection (reCAPTCHA v3) ---\n");
    console.log("All public forms (contact, checkout, coupons) require reCAPTCHA.");
    console.log("If you haven't registered yet:");
    console.log("  1. Go to https://www.google.com/recaptcha/admin");
    console.log("  2. Create a new site with type: Score based (v3)");
    console.log(`  3. Add domains: ${response.rootDomain}, localhost`);
    console.log("  4. Copy the Site Key and Secret Key\n");

    // Check if SSM params already exist (re-running setup)
    const ssm = new SSMClient({ region });
    let existingSiteKey = "";
    let existingSecretKey = false;

    try {
        const existing = await ssm.send(new GetParameterCommand({
            Name: "/amodx/recaptcha/site-key"
        }));
        existingSiteKey = existing.Parameter?.Value || "";
    } catch (e) {
        // Parameter doesn't exist — first run
    }

    try {
        await ssm.send(new GetParameterCommand({
            Name: "/amodx/recaptcha/secret-key",
            WithDecryption: false // Just check existence, don't need value
        }));
        existingSecretKey = true;
    } catch (e) {
        // Parameter doesn't exist
    }

    let recaptchaSiteKey = "";
    let recaptchaSecretKey = "";

    if (existingSiteKey && existingSecretKey) {
        console.log(`reCAPTCHA keys already stored in SSM (site key: ${existingSiteKey.substring(0, 10)}...)`);
        const { overwrite } = await prompts({
            type: 'confirm',
            name: 'overwrite',
            message: 'Overwrite with new keys?',
            initial: false
        });

        if (overwrite) {
            const keys = await prompts([
                {
                    type: 'text',
                    name: 'siteKey',
                    message: 'reCAPTCHA Site Key (public):',
                    validate: val => val.startsWith('6L') ? true : 'Should start with 6L...'
                },
                {
                    type: 'password',
                    name: 'secretKey',
                    message: 'reCAPTCHA Secret Key (private):',
                    validate: val => val.startsWith('6L') ? true : 'Should start with 6L...'
                }
            ]);
            recaptchaSiteKey = keys.siteKey;
            recaptchaSecretKey = keys.secretKey;
        }
    } else {
        const keys = await prompts([
            {
                type: 'text',
                name: 'siteKey',
                message: 'reCAPTCHA Site Key (public):',
                validate: val => val.startsWith('6L') ? true : 'Should start with 6L...'
            },
            {
                type: 'password',
                name: 'secretKey',
                message: 'reCAPTCHA Secret Key (private):',
                validate: val => val.startsWith('6L') ? true : 'Should start with 6L...'
            }
        ]);
        recaptchaSiteKey = keys.siteKey;
        recaptchaSecretKey = keys.secretKey;

        if (!recaptchaSiteKey || !recaptchaSecretKey) {
            console.error("reCAPTCHA keys are required. Register at https://www.google.com/recaptcha/admin");
            process.exit(1);
        }
    }

    // ═══════════════════════════════════════════════════
    // 4. Confirm & Deploy
    // ═══════════════════════════════════════════════════
    console.log("\n--- Deployment Summary ---");
    console.log(`  Stack:     ${response.stackName}`);
    console.log(`  Domain:    ${response.rootDomain}`);
    console.log(`  SES Email: ${response.sesEmail}`);
    console.log(`  reCAPTCHA: ${recaptchaSiteKey ? "new keys" : "existing (SSM)"}`);
    console.log(`  Region:    ${region}\n`);

    const { deploy } = await prompts({
        type: 'confirm',
        name: 'deploy',
        message: 'Ready to deploy infrastructure? (Takes ~15 mins)',
        initial: true
    });

    if (!deploy) {
        console.log("Aborted.");
        process.exit(0);
    }

    // ═══════════════════════════════════════════════════
    // 5. Write Config File
    // ═══════════════════════════════════════════════════
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
    console.log("Created amodx.config.json");

    // ═══════════════════════════════════════════════════
    // 6. Store reCAPTCHA Keys in SSM (before CDK deploy)
    // ═══════════════════════════════════════════════════
    if (recaptchaSiteKey && recaptchaSecretKey) {
        console.log("\nStoring reCAPTCHA keys in SSM Parameter Store...");

        await ssm.send(new PutParameterCommand({
            Name: "/amodx/recaptcha/site-key",
            Type: "String",
            Value: recaptchaSiteKey,
            Overwrite: true,
            Description: "reCAPTCHA v3 site key (public — embedded in HTML for all tenants)"
        }));

        await ssm.send(new PutParameterCommand({
            Name: "/amodx/recaptcha/secret-key",
            Type: "String",
            Value: recaptchaSecretKey,
            Overwrite: true,
            Description: "reCAPTCHA v3 secret key (private — used by Lambda for server-side verification). String type because CloudFormation blocks SecureString in Lambda env vars."
        }));

        console.log("reCAPTCHA keys stored in SSM");
    }

    // ═══════════════════════════════════════════════════
    // 7. Bootstrap CDK (Idempotent)
    // ═══════════════════════════════════════════════════
    console.log("\nBootstrapping CDK...");
    run(`npx cdk bootstrap aws://${accountId}/${region}`);

    // ═══════════════════════════════════════════════════
    // 8. Deploy Infrastructure
    // ═══════════════════════════════════════════════════
    console.log("\nDeploying Stack...");
    // Note: We use --require-approval never because we are in an interactive setup script
    run(`cd infra && npx cdk deploy --require-approval never`);

    // ═══════════════════════════════════════════════════
    // 9. Post-Deploy Configuration
    // ═══════════════════════════════════════════════════
    console.log("\nSyncing Environment Variables...");
    run(`npm run post-deploy ${response.stackName}`);

    // ═══════════════════════════════════════════════════
    // 10. Admin User Creation
    // ═══════════════════════════════════════════════════
    console.log("\nCreate Global Admin User");
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
                console.log("User Created & Promoted!");
            } catch (e: any) {
                if (e.name === 'UsernameExistsException') {
                    console.log("User already exists. Skipping creation.");
                } else {
                    console.error("Failed to create user:", e.message);
                }
            }
        } else {
            console.error("Could not find UserPoolId in .env.local");
        }
    }

    console.log("\nSetup Complete!");
    console.log("---------------------------------------");
    console.log("Admin Panel URL is in the CDK output above.");
    console.log(`Login with: ${user.email}`);
    console.log("---------------------------------------");
}

main();
