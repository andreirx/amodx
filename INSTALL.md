# AMODX Environment Setup Guide

This guide covers the setup required to prepare your computer and your AWS account for deploying AMODX.

---

## 1. Install System Requirements

### Node.js (Runtime)
AMODX requires **Node.js v22** or higher.
```bash
node -v
# Output should be v22.x.x or higher
```

### AWS CLI (Command Line Interface)
1.  Download and install the [AWS CLI](https://aws.amazon.com/cli/).
2.  Verify installation: `aws --version`.

---

## 2. Configure AWS Credentials

**Security Tip:** Do not use your Root Account. Create an IAM User called `amodx-deployer` with `AdministratorAccess`.

1.  Run configuration wizard:
    ```bash
    aws configure
    ```
2.  Enter your keys:
    *   **AWS Access Key ID:** `[Your Key]`
    *   **AWS Secret Access Key:** `[Your Secret]`
    *   **Default region name:** `us-east-1` (or `eu-central-1`). **Stick to one.**
    *   **Default output format:** `json`

---

## 3. Configure Email (AWS SES)

AMODX uses **AWS SES (Simple Email Service)** to send login invites, lead magnet deliveries, and notifications.

1.  Go to **AWS Console** -> **Amazon SES**.
2.  Go to **Identities** -> **Create Identity**.
3.  Select **Email Address** and enter the address you want emails to come *from* (e.g., `admin@youragency.com`).
4.  Check your inbox and click the verification link sent by AWS.
5.  *Note:* Until you request "Production Access" from AWS support, you can only send emails to *verified addresses* (i.e., your own email). This is fine for testing.

---

## 4. Zero-Config Deployment

We provide an interactive installer that handles Bootstrapping, Config Generation, Deployment, and User Creation in one go.

```bash
# Run from root
npm install
npm run setup
```

**The script will ask for:**
1.  **Stack Name:** (Default: `AmodxStack`)
2.  **Root Domain:** (e.g. `amodx.net` - leave empty if you don't have one yet).
3.  **SES Email:** The email you verified in Step 3.
4.  **Admin User:** The email/password for your super-admin account.

**What happens automatically:**
*   `amodx.config.json` is created.
*   AWS CDK is bootstrapped (if needed).
*   Infrastructure is deployed to the Cloud.
*   Local `.env` files are synced with Cloud outputs.
*   Your Admin User is created in Cognito and **promoted to Global Admin** (giving you access to the Team & Users page).

---

## 5. Setup AI Agent (Optional)

To use Claude Desktop with your infrastructure:
```bash
cd tools/mcp-server
npm run build
npm run setup
```

**Restart Claude Desktop** after running this to load the new configuration.
