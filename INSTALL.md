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

## 3. Bootstrap CDK (One-Time)

The AWS CDK needs a dedicated S3 bucket to store deployment artifacts.

```bash
# Replace <ACCOUNT_ID> and <REGION>
npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

---

## 4. Deployment & Bootstrap

### A. Deploy Infrastructure
This provisions the Database, API, Auth, and S3 Buckets.
```bash
cd infra
npx cdk deploy
```

### B. Configure Local Environment (Critical)
We use a script to pull the API URLs, Secrets, and IDs from AWS and write them to your local `.env` files.
```bash
# Run from root
npm run post-deploy
```

### C. Create the First Admin
Since public signup is disabled for Admins, you must create the first user via AWS CLI.

1.  Find your `UserPoolId` in `admin/.env.local`.
2.  Run this command:
    ```bash
    aws cognito-idp admin-create-user \
      --user-pool-id <YOUR_USER_POOL_ID> \
      --username admin@youragency.com \
      --temporary-password ChangeMe123! \
      --message-action SUPPRESS
    ```

You can now log in at the **Admin URL** (printed in the deploy output).

---

## 5. Setup AI Agent (Optional)

To use Claude Desktop with your infrastructure:
```bash
cd tools/mcp-server
npm run build
npm run setup
```
