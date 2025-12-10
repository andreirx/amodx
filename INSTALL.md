# AMODX Environment Setup Guide

This guide covers the one-time setup required to prepare your computer and your AWS account for deploying AMODX.

---

## 1. Install System Requirements

### Node.js (Runtime)
AMODX requires **Node.js v22** or higher.
1.  Download from [nodejs.org](https://nodejs.org/).
2.  Verify installation:
    ```bash
    node -v
    # Output should be v22.x.x or higher
    ```

### AWS CLI (Command Line Interface)
This tool allows your terminal to talk to your AWS account.
1.  Download the installer for your OS:
    *   [Windows](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2-windows.html)
    *   [macOS](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2-mac.html)
    *   [Linux](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2-linux.html)
2.  Verify installation:
    ```bash
    aws --version
    ```

---

## 2. Configure AWS Security (IAM)

**Do not use your Root Account (email login) for deployment.** It is insecure. We will create a dedicated "Deployer" user.

1.  Log in to the [AWS Console](https://console.aws.amazon.com/).
2.  Search for **IAM** in the top bar.
3.  Click **Users** -> **Create user**.
4.  **User details:**
    *   User name: `amodx-deployer`
    *   Click **Next**.
5.  **Permissions:**
    *   Select **Attach policies directly**.
    *   Search for `AdministratorAccess`.
    *   Check the box next to it.
    *   *Note: This permission is required because AMODX creates Databases, API Gateways, Identity Pools, and CDN distributions.*
    *   Click **Next** -> **Create user**.
6.  **Create Access Keys:**
    *   Click on the newly created `amodx-deployer` user.
    *   Go to the **Security credentials** tab.
    *   Scroll to **Access keys** -> **Create access key**.
    *   Select **Command Line Interface (CLI)**.
    *   Click **Next** -> **Create access key**.
    *   **STOP:** Keep this tab open. You need the **Access Key** and **Secret Access Key**.

---

## 3. Connect Your Terminal

Open your terminal (Command Prompt, PowerShell, or Terminal). Run:

```bash
aws configure
```

Paste your credentials when prompted:

*   **AWS Access Key ID:** `[Paste from Step 2]`
*   **AWS Secret Access Key:** `[Paste from Step 2]`
*   **Default region name:** `us-east-1` (or `eu-central-1` based on your preference).
    *   *Important: Pick one region and stick to it.*
*   **Default output format:** `json`

---

## 4. Bootstrap CDK (One-Time Setup)

The AWS Cloud Development Kit (CDK) needs a place to store deployment files (S3 bucket) in your account. This is called "Bootstrapping".

Run this command **once** per region:

```bash
# Replace 123456789012 with your AWS Account ID (found in the top right of AWS Console)
# Replace us-east-1 with the region you chose in Step 3
npx cdk bootstrap aws://123456789012/us-east-1
```

If you see a green checkmark, your environment is ready.

---

## 5. Proceed to Deployment

You are now ready to install AMODX. Return to [README.md](README.md) and run:

```bash
cd infra
npx cdk deploy
```
