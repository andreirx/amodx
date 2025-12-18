# Agency Operations Manual

This guide explains how to manage your AMODX fleet, onboard clients, and handle custom domains.

---

## 1. The Deployment Strategy (Single Stack vs. Shards)

AMODX uses a **Single Stack** architecture to host multiple clients. This maximizes efficiency and minimizes cost.

*   **Limit:** ~100 Custom Domains per Stack (AWS CloudFront Hard Limit).
*   **Isolation:** Logical isolation via Tenant ID.

### Scaling Up (The 101st Client)
When you hit the limit, you create a **Shard** (a fresh deployment).

**Shard 2 Configuration:**
1.  Create `amodx-shard2.config.json`:
    ```json
    {
      "stackName": "Amodx-Shard-02",
      "domains": {
        "root": "amodx-s2.net", // Optional: Distinct admin domain
        "tenants": ["new-client.com"]
      }
    }
    ```
    *Note: You cannot reuse `admin.amodx.net` for Shard 2. You must use a new subdomain (e.g., `admin.s2.amodx.net`) OR use the raw CloudFront URL.*

2.  Run the domain manager for Shard 2:
    ```bash
    # We will update scripts to accept config file path in future update
    # For now, swap the config file or pass flags
    ```

3.  Deploy:
    ```bash
    npx cdk deploy -c stackName=Amodx-Shard-02
    ```

---

## 2. Onboarding a Client (Custom Domain)

**Prerequisites:**
*   You must have the `amodx.config.json` file.
*   You must have valid AWS Credentials.

**Step 1: Update Configuration**
Add the client's domain to your config file.
```json
// amodx.config.json
{
  "domains": {
    "root": "amodx.net",
    "tenants": [
      "dental-clinic.com",
      "law-firm.com" // <--- Add this
    ]
  }
}
```

**Step 2: Request Certificate**
Run the manager script. It will read your config, request a single certificate covering ALL domains (Agency + Tenants), and tell you what DNS records are missing.
```bash
npm run manage-domains
```
*   **Action:** Send the CNAME records to your client.
*   **Wait:** The script waits for validation.

**Step 3: Deploy Infrastructure**
Once the certificate is green, update the cloud.
```bash
npx cdk deploy
```
*   **Action:** Tell client to update their A Record / CNAME to point to your **Renderer URL** (e.g., `amodx.net` or the CloudFront URL).

**Step 4: Configure Admin**
1.  Log in to Admin.
2.  Select Tenant.
3.  Settings -> **Production Domain**: `dental-clinic.com`.
4.  Save.

---

## 3. Managing Your Environment

### The Config File
`amodx.config.json` is the source of truth. **Back it up.** If you lose it, you lose the map of which domains belong to which stack.

---

## 4. Billing & Invoicing (The Business)

AMODX does not process payments internally (to keep the core light).
Currently implementing payments via Paddle.
