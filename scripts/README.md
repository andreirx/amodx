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

The operational tool of Track B (CMRC-2A; record and operator runbook: `docs/slices/cmrc-2a.md`). It moves the
customer-private commerce records out of the main table into the commerce-private table: inventory, copy, content
verification with a manifest, post-cutover verification, purge of verified copies, discard under an authorization
record. `--help` prints the modes and rules. Run `npm run build` first (the tool loads `@amodx/shared`).

Files: `scripts/migrate-commerce-private-table.ts` (the entry: it only connects the real client, the clock and
`node:fs`; it holds no rule), `scripts/commerce-private-table/run.ts` (every read, write and delete of a table, and
the report), `files.ts` (every rule about a file the tool writes: the whole line on disk before a delete, never
inside the repository, never over a file), `decisions.ts` and `canonical-item.ts` (the pure decisions: one canonical
form and hash of an item, one verdict per key). Tests:
`backend/test/unit/cmrc-2a-*.test.ts`, run by `npm --prefix backend run test:unit` (in-memory tables, no AWS). Type
check: `npm run typecheck` (its last step, `typecheck:commerce-private-table-tool`).

Modes (`--mode`):
- `plan` - counts per tenant and kind; reports GSI key attributes and keys not in normalized email form; `--inventory-out` writes the key set with one SHA-256 per item. Reads only
- `migrate` - copies with conditional Puts (`attribute_not_exists(SK)`), never overwrites; writes only with `--execute`
- `verify --strict --manifest-out <file>` - every attribute of every item equal in both tables; writes the verification manifest only when nothing differs
- `verify --post-cutover --manifest <file> --manifest-sha256 <hex>` - establishes three statements: every manifest key exists in the destination; the source holds no key of a moved kind outside the manifest; every source item still hashes to its manifest value. It lists the destination keys that are not in the manifest and cannot say when they were created: the operator establishes that from the freeze record
- `purge-plan`, `purge`, `purge-verify` - delete from the SOURCE only what the manifest proves copied; `purge` deletes only with `--execute --backup-ref <text> --export-path <file>`, and writes the export of EVERY candidate before its first delete (green only when no key was refused)
- `discard-plan`, `discard`, `discard-verify` - delete from the SOURCE under the human's authorization record (`--authorization <file>`), only the listed keys with unchanged hashes; the export line of an item is written just before its delete

The moved kinds are not listed in the tool: it imports `COMMERCE_PRIVATE_PREFIXES` from `backend/src/lib/commerce-db.ts`.

Hard rules:
- explicit tenant allowlist required for every mode and selector that addresses tenant partitions. The one exception: `--selector old-mail-counters` (`PK = SYSTEM`, sort key begins with `EMAILLIMIT#`) addresses items of no tenant, takes no `--tenants` and refuses one; it is protected by the fixed predicate, the authorization record, the authorized key set with hashes, the backup reference and the export
- explicit source and destination tables required; they must differ
- Query (PK + sort-key prefix), GetItem, conditional PutItem, DeleteItem only; never a Scan
- a mode that writes or deletes does so only with `--execute`; without it, it prints the plan
- a file the tool writes must be outside the repository (its real directory, links resolved) and must not exist yet: the inventory, the manifest and the export hold keys that contain email addresses (the export holds whole items)
- of a failed AWS or file call the report prints the error's name only, never its message; after a failed Put or Delete it states the outcome only as a consistent read showed it, else UNKNOWN
- the last line is `RESULT: GREEN` (exit status 0) or `RESULT: NOT GREEN` (exit status 1)

Example:

```bash
npm run migrate-commerce-private-table -- \
  --mode plan \
  --source-table AmodxTable-staging \
  --destination-table AmodxCommerceTable-staging \
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
