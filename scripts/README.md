# Scripts

Utility scripts for AWS infrastructure management.

## `npm run setup-config`

Bootstraps `amodx.config.json`. Detects AWS account ID and region via STS. Creates the config file used by CDK for stack names and domains. Run once per new environment.

## `npm run manage-domains`

Requests a single ACM certificate in `us-east-1` covering all domains from `amodx.config.json`. Interactive — polls validation status and prints CNAME records for DNS verification. Updates config with `globalCertArn`.

## `npm run post-deploy`

Syncs CloudFormation outputs and secrets to local `.env` files:
- `admin/.env.local` — Cognito pool IDs, API URL, renderer URL, region
- `renderer/.env.local` — table name, region, API_URL, AMODX_API_KEY (local-dev renderer key fallback), NEXT_PUBLIC_API_URL, public pool IDs
- `tools/mcp-server/.env` — API URL, master API key

Run after every `cdk deploy`.

## `npm run migrate-commerce-private-table`

One-time operational migration tool for moving customer-private commerce records out of the main table and into the dedicated commerce-private table.

Modes:
- `plan` - query counts from source and destination, no writes
- `migrate` - copy the moved record families into the destination table and verify
- `verify` - compare source and destination without writing

Moved sort-key families:
- `ORDER#`
- `CUSTORDER#`
- `CUSTOMER#`
- `COUNTER#ORDER`

Hard rules:
- explicit tenant allowlist required
- explicit source and destination tables required
- uses `QueryCommand`, never `ScanCommand`
- does not delete source records

Example:

```bash
npm run migrate-commerce-private-table -- \
  --mode plan \
  --source-table AmodxTable \
  --destination-table AmodxCommerceTable \
  --tenants tenant-a,tenant-b
```

## Adding a Tenant Domain

```bash
# 1. Add to config
vim amodx.config.json  # add domain to "tenants" array

# 2. Request SSL cert
npm run manage-domains  # add CNAME records it provides

# 3. Add domain to reCAPTCHA project
# Google reCAPTCHA console → Settings → Domains → add the new domain

# 4. Deploy
cd infra && npm run cdk deploy

# 5. Sync env (if secrets changed)
npm run post-deploy
```

## `./scripts/setup-recaptcha.sh`

Stores deployment-level reCAPTCHA v3 keys in AWS SSM Parameter Store. These provide mandatory bot protection for all tenants — tenants cannot disable it, only override with their own keys or adjust the score threshold.

**Prerequisites:**
1. Register at https://www.google.com/recaptcha/admin — choose **Score based (v3)**
2. Add ALL tenant domains + `localhost` to the reCAPTCHA project
3. Copy Site Key (public) and Secret Key (private)

**Usage:**
```bash
./scripts/setup-recaptcha.sh
# Prompts for site key and secret key interactively
```

Creates two SSM parameters:
- `/amodx/recaptcha/site-key` (String)
- `/amodx/recaptcha/secret-key` (String — CloudFormation blocks SecureString in Lambda env vars)

**Must run before first `cdk deploy`.** CDK reads these at deploy time and injects them as Lambda env vars. See `docs/INTEGRATION_MANUAL.md` for full setup guide.

**Tenant onboarding:** When adding a new tenant domain, also add it to the reCAPTCHA project's domain list in the Google console (Settings > Domains).

## Database Restore

If restoring from DynamoDB backup:

1. AWS Console → DynamoDB → Backups → select backup → Restore to new table `Amodx-Rescue`
2. Wait 5-10 minutes for restore
3. Copy data from rescue table to live table:
```bash
npx tsx scripts/restore-data.ts
```
