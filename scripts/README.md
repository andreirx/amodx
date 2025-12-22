# AMODX Operations Scripts

These utility scripts automate the tedious parts of AWS infrastructure management: configuration, domains, and environment syncing.

## 🛠 `npm run setup-config`
**Purpose:** Bootstraps the `amodx.config.json` file.
*   Detects your AWS Account ID and Region via STS.
*   Creates the config file used by the CDK to determine stack names and domains.
*   **Run this once** when setting up a new repo or account.

## 🌐 `npm run manage-domains`
**Purpose:** Automates the SSL Certificate Dance.
*   Reads domains from `amodx.config.json` (Root + Tenants).
*   Requests a single ACM Certificate in `us-east-1` (required for CloudFront).
*   **Interactive:** It polls AWS validation status and prints the CNAME records you need to add to your DNS provider (GoDaddy/Namecheap) to verify ownership.
*   **Result:** Updates `amodx.config.json` with the validated `globalCertArn`.

## 🔄 `npm run post-deploy`
**Purpose:** Syncs Cloud infrastructure with Local Development.
*   Fetches CloudFormation Outputs (API URLs, User Pool IDs).
*   Fetches Secrets (Master API Key) from Secrets Manager.
*   **Generates:**
    *   `admin/.env.local`
    *   `renderer/.env.local`
    *   `tools/mcp-server/.env`
*   **Run this after every `cdk deploy`** to ensure your local apps can talk to the deployed backend.

---

##  Workflow Example: Adding a Client Domain

1.  Add domain to `amodx.config.json`:
    ```json
    "tenants": ["dental-clinic.com"]
    ```
2.  Request Certs:
    ```bash
    npm run manage-domains
    # Add the CNAME records it gives you to the client's DNS
    ```
3.  Deploy Infrastructure:
    ```bash
    npx cdk deploy
    ```
4.  Sync Local Env (Optional, if secrets changed):
    ```bash
    npm run post-deploy
    ```

---

## Database restore script

If you ever need to restore a dynamodb backup (dynamo will make backups), use the restore-data.ts script. Follow these steps: 

Step 1: Restore the Backup
- Go to AWS Console > DynamoDB > Backups. 
- Select the backup: AmodxStack-AmodxTable...(name of the backup)
- Click Restore. 
- New table name: Enter **Amodx-Rescue**.
- Click Restore.
  - This will take 5–10 minutes.

Step 2: Verify the "Live" Table
- Go to DynamoDB > Tables.
- You should see AmodxTable or whatever name you gave it.
- You should see Amodx-Rescue (The one being restored).

Step 3: Copy Data (Rescue -> Live)
```bash
npx tsx scripts/restore-data.ts
```
The script assumes the backup is called Amodx-Rescue.
