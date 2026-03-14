# AMODX Installation Guide

Complete setup for a new AMODX agency deployment. Two manual registration steps, then one automated command.

---

## Prerequisites

### System Requirements
- **Node.js v22+**: `node -v` should output v22.x.x or higher
- **AWS CLI**: [Install](https://aws.amazon.com/cli/), verify with `aws --version`

### AWS Credentials
Create an IAM User `amodx-deployer` with `AdministratorAccess`. Do not use Root.

```bash
aws configure
# AWS Access Key ID: [Your Key]
# AWS Secret Access Key: [Your Secret]
# Default region name: eu-central-1
# Default output format: json
```

---

## Step 1: Register External Services

Two registrations are required before running the installer. Both take under 5 minutes.

### 1a. Email Sender (AWS SES)

AMODX sends transactional emails (login invites, order confirmations, form notifications) via SES.

1. AWS Console > Amazon SES > Identities > Create Identity
2. Select **Email Address**, enter your sender address (e.g. `admin@youragency.com`)
3. Check inbox, click the verification link from AWS
4. Note: SES starts in sandbox mode (can only send to verified addresses). Request Production Access from AWS Support when ready to go live.

**You will need:** the verified email address (for the installer prompt).

### 1b. Bot Protection (Google reCAPTCHA v3)

AMODX uses reCAPTCHA v3 to protect all public forms (contact, checkout, coupons, lead capture). This is mandatory — deployment will fail without it.

1. Go to https://www.google.com/recaptcha/admin
2. Sign in with a Google account
3. Click **"+"** to create a new site
4. Fill in:
   - **Label**: Your agency name (e.g. `AmodX`)
   - **reCAPTCHA type**: **Score based (v3)** — do NOT select v2
   - **Domains**: Add your agency domain (e.g. `youragency.com`) AND `localhost`
   - Accept Terms of Service
5. Click Submit
6. Copy the **Site Key** and **Secret Key** displayed

**You will need:** both keys (for the installer prompt).

**Later, when adding tenant domains:** each new domain must be added to this reCAPTCHA project (Google console > Settings > Domains). See `scripts/README.md` for the full tenant onboarding checklist.

---

## Step 2: Deploy

```bash
npm install
npm run setup
```

The interactive installer will prompt for:

| Prompt | Source |
|--------|--------|
| Stack Name | Default `AmodxStack` |
| Agency Domain | Your registered domain |
| SES Email | From Step 1a |
| reCAPTCHA Site Key | From Step 1b |
| reCAPTCHA Secret Key | From Step 1b |
| Admin Email | Your login email |
| Admin Password | Temporary (must change on first login) |

**What happens automatically:**
1. `amodx.config.json` created
2. reCAPTCHA keys stored in AWS SSM Parameter Store (encrypted)
3. AWS CDK bootstrapped (if needed)
4. Full infrastructure deployed (~15 minutes): DynamoDB, Lambda, API Gateway, CloudFront, Cognito, S3, EventBridge
5. Local `.env` files synced with deployed outputs
6. Admin user created in Cognito and promoted to Global Admin

---

## Step 3: Verify

```bash
cd admin && npm run dev     # Admin panel at localhost:5173
cd renderer && npm run dev  # Renderer at localhost:3000
```

Log in to the admin panel with the email/password from Step 2.

---

## Optional: Claude Desktop (MCP)

```bash
cd tools/mcp-server
npm run build
npm run setup
```

Restart Claude Desktop after running this.

---

## Re-running Setup

The installer is idempotent. Running `npm run setup` again will:
- Detect existing SSM params and ask whether to overwrite
- Skip CDK bootstrap if already done
- Skip user creation if user already exists

To rotate reCAPTCHA keys independently: `./scripts/setup-recaptcha.sh`

---

## Detailed Reference

| Topic | Document |
|-------|----------|
| Tenant onboarding | `scripts/README.md` |
| reCAPTCHA deep dive | `docs/INTEGRATION_MANUAL.md` |
| Authentication | `docs/authentication-architecture.md` |
| Database schema | `docs/database-patterns.md` |
| Security model | `SECURITY.md` |
