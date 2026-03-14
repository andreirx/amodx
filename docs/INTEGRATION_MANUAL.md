# AMODX Integration Manual

## reCAPTCHA v3 (Bot Protection)

### What it protects

reCAPTCHA v3 runs invisibly on all public-facing form submissions. No user interaction (checkbox, puzzle) is required. Google assigns a score (0.0 = bot, 1.0 = human) and the backend rejects requests below the configured threshold.

Protected endpoints:

| Endpoint | Attack vector mitigated |
|----------|------------------------|
| `POST /contact` | Spam contact form submissions |
| `POST /leads` | Fake email harvesting, lead pollution |
| `POST /public/forms/{slug}/submit` | Dynamic form spam |
| `POST /public/orders` | Fake order creation, inventory manipulation |
| `POST /coupons/validate` | Coupon code enumeration / brute force |

Authenticated admin endpoints are NOT covered (already behind Cognito).

### Architecture

Two-tier resolution. Deployment-level keys provide mandatory baseline protection for all tenants. Individual tenants can override with their own reCAPTCHA project keys but cannot disable protection entirely.

```
Resolution order:
  1. Tenant has own siteKey + secretKey  →  use tenant keys
  2. Deployment env vars exist           →  use deployment keys
  3. Neither (local dev only)            →  skip verification
```

### Step 1: Register with Google reCAPTCHA

1. Go to https://www.google.com/recaptcha/admin
2. Sign in with a Google account
3. Click **"+"** (Create) to register a new site
4. Fill in:
   - **Label**: `AmodX` (or any descriptive name)
   - **reCAPTCHA type**: **Score based (v3)** — this is critical, do NOT select v2
   - **Domains**: Add ALL domains that will use this key:
     - Your agency root domain (e.g., `bijuterie.software`)
     - All tenant domains (e.g., `client1.com`, `client2.ro`)
     - `localhost` (for local development)
   - Accept the Terms of Service
5. Click **Submit**
6. You will receive:
   - **Site Key** (public) — starts with `6Le...`, safe to embed in HTML
   - **Secret Key** (private) — starts with `6Le...`, NEVER expose in client code

**Important**: When you onboard a new tenant with a new domain, you must add that domain to this reCAPTCHA project. Go to Settings (gear icon) in the reCAPTCHA console and add it under "Domains."

### Step 2: Store deployment-level keys

Run the setup script:

```bash
./scripts/setup-recaptcha.sh
```

It will prompt for both keys and store them in AWS SSM Parameter Store:
- `/amodx/recaptcha/site-key` — String (public)
- `/amodx/recaptcha/secret-key` — SecureString (encrypted with AWS KMS)

Alternatively, store manually:

```bash
aws ssm put-parameter \
  --region eu-central-1 \
  --name "/amodx/recaptcha/site-key" \
  --type "String" \
  --value "YOUR_SITE_KEY" \
  --overwrite

aws ssm put-parameter \
  --region eu-central-1 \
  --name "/amodx/recaptcha/secret-key" \
  --type "SecureString" \
  --value "YOUR_SECRET_KEY" \
  --overwrite
```

### Step 3: Deploy

```bash
cd infra && cdk deploy
```

CDK reads the SSM parameters at deploy time and injects them as Lambda environment variables:
- `RECAPTCHA_SECRET_KEY` on all 5 protected Lambda handlers
- `RECAPTCHA_SITE_KEY` on the renderer server Lambda

No runtime SSM calls. No latency penalty. Keys are baked into Lambda config at deploy.

### Step 4: Verify

After deployment, test by submitting a contact form on any tenant site. Check CloudWatch logs for the handler — you should see:

```
reCAPTCHA passed [deployment]: score=0.9, action=contact_form
```

The `[deployment]` tag confirms deployment-level keys are active. If a tenant provides their own keys, it will show `[tenant]`.

### Per-tenant override (optional)

Tenants who want their own reCAPTCHA project (e.g., for separate analytics or compliance):

1. Register a separate reCAPTCHA v3 project at https://www.google.com/recaptcha/admin
2. Add only their domain(s)
3. In Admin > Settings > Bot Protection:
   - Paste Site Key and Secret Key in the "Custom reCAPTCHA Keys" section
   - Adjust the Score Threshold if needed
4. Save — their keys take immediate effect

The threshold slider (0.0 - 1.0) is always per-tenant, regardless of which keys are used. Default is 0.5.

### Per-tenant threshold tuning

- **0.3** — Lenient. Allows more borderline traffic. Use for sites with unusual user behavior patterns (accessibility tools, VPNs).
- **0.5** — Default. Good balance for most sites.
- **0.7** — Strict. Blocks more aggressively. Use for e-commerce checkout or high-value form submissions.
- **0.9** — Very strict. May cause false positives for legitimate users behind corporate proxies.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Forms work but logs show no reCAPTCHA line | No keys available | Run `setup-recaptcha.sh` and redeploy |
| `reCAPTCHA configuration error` in response | Invalid secret key | Verify the key in SSM matches Google console |
| `Verification expired. Please try again.` | Token too old (>2 min) | Client-side issue — token generated too early |
| Legitimate users blocked | Threshold too high | Lower threshold in Admin > Settings |
| `score=0.1` for real users | Domain not registered in reCAPTCHA project | Add the domain in Google reCAPTCHA console |

### Key rotation

1. Generate new keys in Google reCAPTCHA console (Settings > Get new keys)
2. Run `./scripts/setup-recaptcha.sh` with the new keys
3. Redeploy with `cdk deploy`
4. Old keys are immediately invalidated — no overlap window
