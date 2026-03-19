# AMODX Self-Hosted SaaS Platform — Implementation Plan

**Date:** 2026-03-19
**Status:** Planning (architectural decisions locked)

## 1. Executive Summary

Turn AMODX into a SaaS product where paying customers get a dedicated AWS stack on our account. Paddle handles billing. A Control Plane stack handles provisioning, metering, and lifecycle management. Customers get the admin panel plus optional Claude AI integration via their own Anthropic API key. Start with a limited-seats launch to prove demand before scaling.

---

## 2. Locked Architectural Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Dedicated CloudFront distributions per customer** — 2 per stack (down from 3) by making the Assets CDN shared across all stacks | True isolation is the product's value proposition. Shared assets CDN is safe because uploads are prefix-isolated in a shared S3 bucket. |
| 2 | **Per-stack DynamoDB table** | Physical isolation. Clean teardown (delete table). DynamoDB 2,500-table limit is not the binding constraint. No risk of cross-stack data leakage. |
| 3 | **Per-stack renderer build** (no pre-built artifact) | `npx cdk deploy` rebuilds the renderer anyway. Savings are marginal. Avoids the complexity of artifact management. Accept 10-15 min provisioning time. |
| 4 | **Self-hosted MCP** + admin app AI integration via customer's own Anthropic API key | Customer downloads MCP config for CLI use. Additionally, embed a Claude assistant in the admin SPA that proxies through a streaming Lambda using the customer's Anthropic key. Future: deeper AI tool integration in admin UI. |
| 5 | **Single AWS account for now** | Not expecting volume. Limited-seats offer to prove demand, build community. Multi-account via AWS Organizations deferred until 50+ customers or when limits bite. |

---

## 3. CloudFront Consolidation: 3 to 2 Distributions Per Stack

### Current (3 per stack)

| Distribution | Origin | Domain | Purpose |
|---|---|---|---|
| Renderer | Lambda Function URL + S3 (static assets) | `{tenant-domains}` | Public websites (Next.js SSR) |
| Admin SPA | S3 (Vite build) | `admin.{root}` | Admin panel |
| Assets CDN | S3 (uploads bucket) | CloudFront domain only | Tenant-uploaded images/files |

### SaaS (2 per stack + 1 shared)

| Distribution | Scope | Origin | Domain |
|---|---|---|---|
| Renderer | Per-stack | Lambda Function URL + S3 | `{stackId}.amodx.net` + custom domains |
| Admin SPA | Per-stack | S3 (Vite build via OAC) | `{stackId}-admin.amodx.net` |
| **Assets CDN** | **Shared (all stacks)** | Shared S3 bucket with per-stack prefixes | `cdn.amodx.net` |

**How the shared Assets CDN works:**
- One S3 bucket: `amodx-saas-assets` with prefix structure `{stackId}/{tenantId}/`
- One CloudFront distribution: `cdn.amodx.net`
- CloudFront Function rewrites request paths: incoming `/{stackId}/{tenantId}/image.jpg` maps to S3 key `{stackId}/{tenantId}/image.jpg`
- Each stack's upload Lambda writes to its own prefix (IAM conditions enforce this)
- Each stack's `ASSETS_CDN_URL` env var includes the stack prefix: `https://cdn.amodx.net/{stackId}`

**Limit math:** 2 distributions per stack + 1 shared. Default limit 200 = first wall at **~99 stacks**. With standard limit increase to 500 = **~249 stacks**. Sufficient for single-account phase.

**Future optimization (not now):** Merge admin SPA into the renderer distribution as a `/admin/*` behavior. Drops to 1 per stack. First wall at ~199 stacks with default limit, ~499 with increase.

---

## 4. AWS Account Limits — Binding Constraints

At single-account scale, with the 2-per-stack CloudFront approach and shared S3 buckets:

| Resource | Per Stack | Shared | Default Limit | First Wall | After Increase |
|---|---|---|---|---|---|
| CloudFront Distributions | 2 | +1 | 200 | 99 stacks | ~249 (at 500) |
| S3 Buckets | 1 (renderer assets) | +3 (assets, private, admin artifacts) | 100 | 96 stacks | ~997 (at 1,000) |
| Cognito User Pools | 2 | 0 | 1,000 | 500 stacks | 5,000 (at 10K) |
| HTTP API Gateways | 1 | +1 (control plane) | 300 | 299 stacks | Not a constraint |
| DynamoDB Tables | 2 | +1 (control plane) | 2,500 | 1,248 stacks | Not a constraint |
| EventBridge Event Buses | 1 | +1 | 100 | 98 stacks | ~498 (at 500) |
| Lambda Concurrency | ~109 functions | — | 1,000 concurrent | ~50 active stacks | 10,000 (request increase early) |
| CloudFormation Stacks | 3 (parent + 2 nested) | +1 | 2,000 | 665 stacks | Not a constraint |
| Secrets Manager Secrets | 5 | ~3 | 500,000 | Not a constraint | — |

**Binding constraint: CloudFront at 99 stacks with default limits.** Request limit increases to 500 on day one. This gives runway to ~249 stacks before needing multi-account.

**Action item:** Submit limit increase requests for CloudFront (500), Lambda concurrency (5,000), EventBridge buses (500) before first customer stack deployment.

---

## 5. Cost Model

### 5.1 Per-Stack Idle Cost (Zero Traffic)

| Resource | Monthly |
|---|---|
| Secrets Manager (5 secrets x $0.40) | $2.00 |
| Scheduled Lambdas (warmer 5min + debounce 1min + nightly) | $0.60 |
| S3 storage (~100 MB renderer assets) | $0.02 |
| DynamoDB (on-demand, idle) | $0.00 |
| Lambda functions (109, no invocations) | $0.00 |
| CloudFront (2 distributions, no requests) | $0.00 |
| Cognito (2 pools, <50K MAU) | $0.00 |
| **Total idle cost** | **~$2.62/mo** |

Note: CloudWatch Dashboard omitted for small tier (saves $3/mo). Can add for medium/large.

### 5.2 Variable Costs by Traffic Level

| Traffic Level | Pages/day | Est. Monthly AWS Cost |
|---|---|---|
| Small site (1K pages/day) | ~30K/mo | $1-3/mo variable |
| Medium site (10K/day) | ~300K/mo | $5-15/mo variable |
| Large site (100K/day) | ~3M/mo | $50-150/mo variable |

Primary variable drivers: Lambda invocations + DynamoDB reads + CloudFront data transfer.

### 5.3 Tier Pricing

| Tier | Annual | Monthly Equiv. | AWS Cost (idle + avg traffic) | Margin | Includes |
|---|---|---|---|---|---|
| **Starter** | $149/yr | $12.42/mo | $3-8/mo | 35-75% | 1 site, 50K pages/mo, 1GB storage |
| **Business** | $349/yr | $29.08/mo | $8-20/mo | 30-70% | 5 sites, 200K pages/mo, 10GB, commerce |
| **Agency** | $999/yr | $83.25/mo | $15-60/mo | 30-80% | 20 sites, 1M pages/mo, 50GB, commerce, AI, priority support |

**Note:** Starter tier was originally planned at $99/yr ($8.25/mo). At $2.62 idle cost, margin is only $5.63 before any traffic — dangerously thin. Recommend $149/yr ($12.42/mo) for sustainable margin. If positioned as loss leader for upsell, $99/yr is acceptable but must be tracked.

### 5.4 Overage Billing

Via Paddle Usage Reporting API. Control Plane usage collector Lambda runs on the 1st of each month:
1. Queries CloudWatch for each stack: page views, storage bytes, bandwidth
2. Compares against tier limits
3. Reports overage quantity to Paddle
4. Paddle bills on next cycle

| Overage Type | Rate |
|---|---|
| Page views beyond tier | $0.50 per 10K |
| Storage beyond tier | $0.10 per GB/month |
| Bandwidth beyond tier | $0.08 per GB |

### 5.5 Control Plane Cost (Fixed, Shared)

| Resource | Monthly |
|---|---|
| DynamoDB (control plane table) | ~$1 |
| Step Functions (provisioning executions) | ~$0.50 (at low volume) |
| CodeBuild (CDK deployments) | ~$0.50 per provisioning (3 min build) |
| Shared Assets CDN (1 CloudFront distribution) | ~$0 (pay per request) |
| Shared S3 buckets (3) | ~$0.07 |
| Lambda (control plane API, ~10 functions) | ~$0.50 |
| **Total control plane** | **~$3-5/mo fixed** |

---

## 6. Stack Parameterization (Phase 0)

The current `AmodxStack` must become deployable N times from parameterized config.

### 6.1 New Config Shape

Current `amodx.config.json`:
```json
{
  "stackName": "AmodxStack",
  "account": "324037297014",
  "region": "eu-central-1",
  "sesEmail": "contact@bijuterie.software",
  "domains": {
    "root": "amodx.net",
    "globalCertArn": "arn:aws:acm:us-east-1:...",
    "tenants": ["blog.bijup.com", "bijup.com"]
  }
}
```

SaaS config (generated per stack by Control Plane):
```json
{
  "stackName": "amodx-abc123",
  "stackId": "abc123",
  "account": "324037297014",
  "region": "eu-central-1",
  "tier": "starter",
  "ownerEmail": "customer@example.com",
  "sesEmail": "noreply@amodx.net",
  "maxTenants": 1,
  "domains": {
    "subdomain": "abc123.amodx.net",
    "adminSubdomain": "abc123-admin.amodx.net",
    "globalCertArn": "arn:aws:acm:us-east-1:...",
    "tenants": []
  },
  "shared": {
    "assetsBucketName": "amodx-saas-assets",
    "assetsCdnUrl": "https://cdn.amodx.net",
    "privateBucketName": "amodx-saas-private"
  },
  "limits": {
    "lambdaMemory": 512,
    "apiRateLimit": 10,
    "storageLimitMb": 1024,
    "monthlyPageViews": 50000
  }
}
```

### 6.2 CDK Changes Required

| File | Change | Effort |
|---|---|---|
| `infra/bin/infra.ts` | Load config from S3 or local file based on `--context` flag. Support `stage=saas-{stackId}` | Small |
| `infra/lib/amodx-stack.ts` | Accept `tier`, `stackId`, `shared` bucket refs, `limits` in props. Pass `lambdaMemory` to all Lambda constructs. | Medium |
| `infra/lib/uploads.ts` | New mode: accept existing shared bucket ARN + prefix instead of creating new buckets. CloudFront distribution creation gated by `isShared` flag. | Medium |
| `infra/lib/admin-hosting.ts` | Accept `stackId` for resource naming. Config generator writes stack-specific `config.json`. | Small |
| `infra/lib/renderer-hosting.ts` | Accept `stackId` for resource naming. Renderer assets bucket remains per-stack. Lambda memory from `limits.lambdaMemory`. | Small |
| `infra/lib/api.ts` | Rate limiting via API Gateway throttling settings from `limits.apiRateLimit`. Resource naming includes `stackId`. | Medium |
| `infra/lib/database.ts` | Table name includes `stackId`. Tag with `StackId` for cost allocation. | Small |
| `infra/lib/auth.ts` | Pool names include `stackId`. Initial admin user creation via custom resource. | Small |
| `infra/lib/domains.ts` | Support subdomain mode (`{stackId}.amodx.net`) using shared wildcard cert instead of per-stack cert. | Medium |

### 6.3 Shared Infrastructure (Created Once)

Before any tenant stack, a one-time "SaaS Foundation" CDK stack creates:

```
SaasFoundationStack:
  - S3: amodx-saas-assets (shared uploads)
  - S3: amodx-saas-private (shared private files)
  - S3: amodx-saas-admin-artifacts (shared admin SPA builds)
  - S3: amodx-saas-cdk-configs (stack config JSONs)
  - CloudFront: cdn.amodx.net (shared assets CDN)
  - ACM: *.amodx.net wildcard cert (us-east-1, covers all subdomains)
  - Route53: *.amodx.net wildcard A record → to be updated per stack
```

### 6.4 Validation Test

Deploy a second stack alongside the existing production stack:
```bash
npx cdk deploy -c stage=test-tenant -c config=amodx.test.json
```

Success criteria:
- Second stack is fully functional
- Production stack unaffected
- Both stacks have isolated DynamoDB tables, Cognito pools, API Gateways
- Both share the assets CDN bucket

---

## 7. Control Plane Architecture (Phase 1)

### 7.1 Control Plane Stack

A separate CDK stack (`ControlPlaneStack`) deployed once:

```
ControlPlaneStack:
  - DynamoDB: ControlPlaneTable
  - API Gateway (HTTP API v2): control-plane-api
  - Lambda: PaddleWebhookHandler
  - Lambda: StackManager (CRUD)
  - Lambda: UsageCollector (scheduled monthly)
  - Lambda: HealthChecker (scheduled hourly)
  - Step Functions: ProvisioningStateMachine
  - Step Functions: TeardownStateMachine
  - CodeBuild: CdkDeployProject
  - SQS: ProvisioningQueue (dead letter for failed provisions)
  - SNS: AlertsTopic (ops notifications)
  - Cognito: ControlPlaneAdminPool (our operators only)
  - S3: amodx-saas-cdk-configs (stack configs)
```

### 7.2 DynamoDB Schema (Control Plane Table)

```
PK: STACK#{stackId}          SK: META
  status: provisioning | active | suspended | destroying | destroyed
  tier: starter | business | agency
  ownerEmail: string
  paddleSubscriptionId: string
  paddleCustomerId: string
  stackName: string
  subdomain: string
  customDomains: string[]
  endpoints: { api, admin, renderer }
  createdAt, updatedAt: ISO string
  destroyAt: ISO string (set when suspended, 30-day grace)

PK: STACK#{stackId}          SK: USAGE#{yyyy-mm}
  pageViews: number
  storageBytes: number
  bandwidthBytes: number
  apiCalls: number
  reportedToPaddle: boolean

PK: STACK#{stackId}          SK: EVENT#{timestamp}
  type: provisioned | updated | suspended | destroyed | error
  detail: string

PK: PADDLE#{subscriptionId}  SK: META
  stackId: string (reverse lookup)

PK: CUSTOMER#{paddleCustomerId} SK: META
  email: string
  stacks: string[] (customer may have multiple subscriptions)
```

### 7.3 API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/webhook/paddle` | Paddle signature | Subscription lifecycle |
| GET | `/stacks` | Control Plane JWT | List all stacks (ops dashboard) |
| POST | `/stacks` | Control Plane JWT | Manual stack provisioning |
| GET | `/stacks/{id}` | Control Plane JWT | Stack details + endpoints |
| PUT | `/stacks/{id}` | Control Plane JWT | Update config (domain, tier) |
| DELETE | `/stacks/{id}` | Control Plane JWT | Initiate teardown |
| GET | `/stacks/{id}/status` | Control Plane JWT | Provisioning progress |
| GET | `/stacks/{id}/usage` | Control Plane JWT | Usage metrics |
| POST | `/stacks/{id}/custom-domain` | Control Plane JWT | Add custom domain |
| GET | `/health` | None | Control plane health check |

### 7.4 Provisioning State Machine (Step Functions)

```
                    [Start]
                       |
                       v
              +------------------+
              | GenerateConfig   |  Lambda: creates config JSON,
              | (Lambda)         |  uploads to S3, writes DB record
              +--------+---------+
                       |
                       v
              +------------------+
              | DeployStack      |  CodeBuild: npm ci && npx cdk deploy
              | (CodeBuild)      |  -c stage=saas-{stackId}
              |                  |  -c config=s3://configs/{stackId}.json
              |                  |  --require-approval never
              +--------+---------+  (10-15 min)
                       |
                       v
              +------------------+
              | ReadOutputs      |  Lambda: reads CloudFormation outputs
              | (Lambda)         |  (API URL, CloudFront domains, pool IDs)
              +--------+---------+
                       |
                       v
              +------------------+
              | CreateAdminUser  |  Lambda: creates initial admin user
              | (Lambda)         |  in the stack's Cognito pool
              +--------+---------+
                       |
                       v
              +------------------+
              | ConfigureDNS     |  Lambda: creates Route53 records
              | (Lambda)         |  {stackId}.amodx.net → CloudFront
              |                  |  {stackId}-admin.amodx.net → CloudFront
              +--------+---------+
                       |
                       v
              +------------------+
              | SendWelcomeEmail |  Lambda: SES email with credentials,
              | (Lambda)         |  admin URL, getting started links
              +--------+---------+
                       |
                       v
              +------------------+
              | UpdateRecord     |  Lambda: status → "active",
              | (Lambda)         |  store endpoints in DB
              +--------+---------+
                       |
                       v
                    [Success]

              [Error Handler]
                       |
                       v
              +------------------+
              | MarkFailed       |  Lambda: status → "failed",
              | (Lambda)         |  SNS alert, write error event
              +--------+---------+
                       |
                       v
              +------------------+
              | EnqueueManual    |  SQS: dead letter for
              | Review           |  manual ops intervention
              +------------------+
```

### 7.5 Teardown State Machine

Triggered by: `subscription.canceled` after 30-day grace period, or manual DELETE.

```
[Start] → ExportData (DDB export to S3 archive)
        → DestroyStack (CodeBuild: npx cdk destroy --force)
        → CleanupS3 (Lambda: delete stack prefix from shared buckets)
        → CleanupDNS (Lambda: remove Route53 records)
        → UpdateRecord (Lambda: status → "destroyed")
        → [Success]
```

### 7.6 Paddle Webhook Handling

Events to handle:

| Paddle Event | Action |
|---|---|
| `subscription.created` | Start provisioning state machine |
| `subscription.activated` | (Usually same as created. Idempotent — check if already provisioning.) |
| `subscription.updated` | If tier changed: update Lambda memory + rate limits via CDK redeploy |
| `subscription.paused` | Set status → "suspended". Schedule teardown after grace. |
| `subscription.canceled` | Set status → "suspended". Schedule teardown after 30 days. |
| `subscription.past_due` | Send warning email. Do NOT suspend immediately. |
| `subscription.resumed` | Clear teardown schedule. Set status → "active". |

**Paddle signature verification:**
```typescript
import crypto from "crypto";

function verifyPaddleWebhook(rawBody: string, signature: string, secret: string): boolean {
    const ts = signature.split(";")[0].split("=")[1];
    const h1 = signature.split(";")[1].split("=")[1];
    const payload = `${ts}:${rawBody}`;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(h1), Buffer.from(expected));
}
```

Current Paddle handler (`backend/src/webhooks/paddle.ts`) has no signature verification. This is a **known tech debt** that must be fixed before SaaS launch.

### 7.7 CodeBuild Project Configuration

```typescript
new codebuild.Project(this, "CdkDeployProject", {
    source: codebuild.Source.s3({
        bucket: sourceArtifactBucket,
        path: "amodx-source.zip",  // Full repo snapshot, uploaded per release
    }),
    environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,  // 7 GB RAM for renderer build
        privileged: false,
    },
    buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
            install: { commands: ["npm ci"] },
            build: {
                commands: [
                    "cd infra",
                    "npx cdk deploy -c stage=$STACK_ID -c config=s3://$CONFIG_BUCKET/$STACK_ID.json --require-approval never",
                ],
            },
        },
    }),
    timeout: cdk.Duration.minutes(30),
});
```

Environment variables `STACK_ID` and `CONFIG_BUCKET` passed from Step Functions at invocation time.

---

## 8. Customer Self-Service Portal (Phase 2)

### 8.1 Portal Architecture

Lightweight SPA at `manage.amodx.net`:
- **Auth:** Paddle customer portal login (Paddle provides customer authentication) OR email magic link verified against Control Plane DB
- **Framework:** Same as admin (React + Vite) but separate deployment
- **API:** Control Plane API with customer-scoped JWT

### 8.2 Portal Pages

| Page | Content |
|---|---|
| **Dashboard** | Stack status (active/provisioning/suspended), quick links to admin + renderer |
| **Stack Details** | Endpoints, CloudFront domains, Cognito pool IDs, API key (masked, copyable) |
| **Usage** | Current month: page views, storage, bandwidth. Chart of last 6 months. Tier limit indicators. |
| **Domains** | List custom domains. Add new domain → shows DNS CNAME instructions → verifies propagation → provisions ACM cert → adds to CloudFront |
| **Billing** | Link to Paddle customer portal (manage payment method, invoices, upgrade/downgrade) |
| **MCP Setup** | Download MCP config file (pre-filled with API URL + key). Link to video tutorial. |
| **AI Setup** | Enter Anthropic API key (stored encrypted). Test connection. Link to admin AI assistant. |
| **Support** | FAQ, documentation links, email support |

### 8.3 Custom Domain Flow

1. Customer enters `www.example.com` in portal
2. Portal shows DNS instructions: `CNAME www.example.com → {stackId}.amodx.net`
3. Customer configures DNS at their registrar
4. Portal polls DNS (or customer clicks "Verify")
5. On verification: Lambda provisions ACM certificate with DNS validation
6. ACM auto-validates via Route53 (if using Route53) or customer adds CNAME for `_acme-challenge`
7. On cert issuance: Lambda adds alternate domain to CloudFront distribution
8. Lambda adds domain to API Gateway CORS allowlist
9. Lambda adds domain to stack's tenant config

**Timeline:** 5-30 minutes depending on DNS propagation and ACM validation.

---

## 9. AI Integration in Admin App (Phase 3)

### 9.1 Architecture

The customer stores their own Anthropic API key. The admin SPA communicates with a streaming Lambda that proxies to the Anthropic Messages API with tool definitions derived from the existing MCP server.

```
Admin SPA                    Lambda (streaming)              Anthropic API
    |                              |                              |
    |--- POST /ai/chat ---------->|                              |
    |    (auth token + message)    |                              |
    |                              |--- Load customer's API key   |
    |                              |    from DynamoDB              |
    |                              |                              |
    |                              |--- POST /v1/messages ------->|
    |                              |    (system prompt + tools +   |
    |                              |     customer message)         |
    |                              |                              |
    |                              |<-- SSE stream (text + tool   |
    |                              |    use deltas)                |
    |<--- SSE stream --------------|                              |
    |     (progressive text)       |                              |
    |                              |                              |
    |                              |--- [tool_use: create_page]   |
    |                              |    Execute against AMODX API  |
    |                              |    using stack's own API key  |
    |                              |                              |
    |                              |--- POST /v1/messages ------->|
    |                              |    (tool result)              |
    |                              |<-- SSE stream continues ------|
    |<--- SSE stream continues ----|                              |
```

### 9.2 Why Lambda Proxy (Not Direct Browser Calls)

The Anthropic SDK supports `dangerouslyAllowBrowser: true` for direct browser API calls. However:

1. **API key exposure:** The customer's Anthropic key would be in browser memory and network requests. Anyone with devtools can steal it.
2. **Tool execution:** When Claude calls tools (create page, edit product), those calls need server-side execution with the stack's master API key — which must never be in the browser.
3. **System prompt protection:** The system prompt contains internal context about AMODX's architecture. Keeping it server-side prevents prompt extraction.
4. **Rate limiting:** Server-side proxy can enforce rate limits per customer.

### 9.3 Streaming Lambda Implementation

AWS Lambda response streaming (supported since late 2025 for both REST API and Lambda Function URLs) enables SSE:

```typescript
// backend/src/ai/chat.ts
import Anthropic from "@anthropic-ai/sdk";

export const handler = awslambda.streamifyResponse(
    async (event, responseStream, context) => {
        // 1. Verify auth token
        // 2. Load customer's Anthropic API key from DynamoDB
        // 3. Load site context (tenant name, recent pages, products)
        // 4. Build system prompt + tool definitions

        const client = new Anthropic({ apiKey: customerApiKey });
        const stream = client.messages.stream({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: systemPrompt,
            tools: AMODX_TOOLS,  // Derived from MCP server tool definitions
            messages: conversationHistory,
        });

        responseStream.setContentType("text/event-stream");

        for await (const event of stream) {
            responseStream.write(`data: ${JSON.stringify(event)}\n\n`);

            // If tool_use: execute tool, feed result back
            if (event.type === "content_block_stop" && event.content_block?.type === "tool_use") {
                const result = await executeAmodxTool(event.content_block, stackApiKey);
                // Continue conversation with tool result...
            }
        }

        responseStream.end();
    }
);
```

**Access method:** Lambda Function URL with IAM auth (admin SPA signs requests with Cognito credentials). Not routed through the main HTTP API — keeps AI traffic isolated.

### 9.4 Tool Definitions

Reuse the existing MCP server tool schemas (`tools/mcp-server/src/index.ts`). Extract them into a shared module:

| Tool | Description | Maps to MCP tool |
|---|---|---|
| `list_pages` | List all pages/posts | `list_content` |
| `create_page` | Create a new page with blocks | `create_context` + `add_block` |
| `edit_page` | Modify page content | `update_page` |
| `list_products` | List products | `list_products` (new) |
| `create_product` | Create a product | `create_product` |
| `site_settings` | Read/update site settings | `get_tenant` / `update_tenant` |
| `write_blog_post` | High-level: create page + add markdown block | Composite tool |

### 9.5 Admin UI Components

| Component | Location | Purpose |
|---|---|---|
| `AiAssistant.tsx` | Slide-over panel (right side) | Chat interface. Message input, streaming response display, tool execution indicators. |
| `AiSetup.tsx` | Settings page section | API key input (masked), test connection button, usage stats from Anthropic dashboard link. |
| `useAiChat.ts` | Hook | Manages conversation state, SSE connection, tool execution UI updates. |

### 9.6 What the Customer Sees

1. **Settings > AI Assistant**: Enter Anthropic API key. Click "Test Connection" (makes a trivial API call to verify key validity).
2. **Floating button** (bottom-right corner of admin): Opens the AI Assistant panel.
3. **Chat interface**: Type messages like "Create a landing page for our summer sale with a hero section, pricing table, and FAQ."
4. **Tool execution**: When Claude creates a page, the UI shows a "Creating page..." indicator. On completion, a link to the new page appears inline.
5. **Context awareness**: Claude knows the site name, existing pages, products, and theme. System prompt is refreshed per conversation.

### 9.7 Customer's Anthropic Account

The customer creates their own account at `console.anthropic.com`:
1. Sign up
2. Add payment method
3. Create an API key
4. Paste into AMODX admin Settings > AI Assistant

Their Anthropic usage is billed directly by Anthropic. AMODX does not mark up or resell Anthropic API access. This is the same model as Cursor, Windsurf, and other tools that accept "bring your own key."

---

## 10. Security Hardening

### 10.1 Stack Isolation

| Layer | Mechanism |
|---|---|
| DynamoDB | Per-stack table. IAM policy scoped to table ARN. |
| S3 (shared buckets) | IAM conditions: `s3:prefix` must match `{stackId}/*`. Lambda roles only granted their stack's prefix. |
| Cognito | Per-stack pools. No cross-pool access. |
| API Gateway | Per-stack HTTP API with per-stack authorizer Lambda. |
| CloudFront | Per-stack distributions (renderer + admin). No shared origins. |
| Secrets Manager | Per-stack secrets. Resource policy denies cross-stack access. |

### 10.2 IAM Permission Boundary

Applied to ALL IAM roles created in tenant stacks:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyAccountLevelActions",
      "Effect": "Deny",
      "Action": ["iam:*", "organizations:*", "account:*", "sts:AssumeRole"],
      "Resource": "*"
    },
    {
      "Sid": "DenyOtherStacksS3",
      "Effect": "Deny",
      "Action": "s3:*",
      "Resource": "arn:aws:s3:::amodx-saas-*",
      "Condition": {
        "StringNotLike": { "s3:prefix": "${stackId}/*" }
      }
    },
    {
      "Sid": "DenyOtherStacksDDB",
      "Effect": "Deny",
      "Action": "dynamodb:*",
      "NotResource": [
        "arn:aws:dynamodb:*:*:table/amodx-${stackId}-*"
      ]
    }
  ]
}
```

### 10.3 Customer MCP Access Scoping

- Customer receives their stack's master API key (auto-generated, stored in Secrets Manager)
- MCP server `.env` config pre-generated and downloadable from customer portal:
  ```
  AMODX_API_URL=https://{stackId}-api.amodx.net
  AMODX_API_KEY=sk-{stackMasterKey}
  AMODX_TENANT_ID={defaultTenantId}
  ```
- The stack's authorizer Lambda validates the API key against its own Secrets Manager secret
- No cross-stack API key acceptance is possible (each stack has its own authorizer)

### 10.4 New Authorizer Role: SAAS_CUSTOMER

Current roles: `ADMIN`, `RENDERER`, `MCP`.

New role for SaaS customers (applies to both MCP and AI assistant):
- Can manage tenants up to tier limit (`maxTenants`)
- Cannot access `/system/*` endpoints (cache invalidation, etc.)
- Cannot create additional API keys
- Cannot modify stack-level settings (SES identity, domain config)
- Full access to content, products, orders, forms, etc. within their tenants

### 10.5 Paddle Signature Verification

**Current state:** No verification (tech debt from V1).

**Required before SaaS launch:**
```typescript
function verifyPaddleSignature(rawBody: string, signatureHeader: string, webhookSecret: string): boolean {
    const [tsPart, h1Part] = signatureHeader.split(";");
    const ts = tsPart.split("=")[1];
    const h1 = h1Part.split("=")[1];
    const payload = `${ts}:${rawBody}`;
    const expected = crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex");

    // Timing-safe comparison
    if (h1.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(h1, "hex"), Buffer.from(expected, "hex"));
}
```

Webhook secret stored in SSM Parameter Store (SecureString), loaded once per Lambda cold start.

---

## 11. Implementation Phases

### Phase 0: Parameterize Stack (2-3 weeks)

**Goal:** Deploy a second AMODX stack alongside production without changing production behavior.

| Task | Files | Effort | Notes |
|---|---|---|---|
| Add `stackId` and `tier` to `AmodxStackProps` | `amodx-stack.ts` | 1d | All resource names include `stackId` |
| Parameterize Lambda memory from tier config | `amodx-stack.ts`, `api.ts` | 1d | Default to current values for existing stack |
| Shared S3 bucket mode in uploads construct | `uploads.ts` | 2d | New prop `sharedBucketArn`. If set, skip bucket creation, use prefix. |
| Subdomain mode in domains construct | `domains.ts` | 2d | Use wildcard cert. Route53 records for `{stackId}.amodx.net` |
| Dynamic config loading in CDK app entry | `infra.ts` | 0.5d | Support S3 config path via `--context` |
| Admin config includes `stackId` | `config-generator.ts` | 0.5d | |
| API Gateway CORS accepts subdomain | `api.ts` | 0.5d | Pattern-based: `*.amodx.net` |
| Tag all resources with `StackId` | All constructs | 1d | For cost allocation |
| Create SaaS Foundation Stack | New: `saas-foundation-stack.ts` | 2d | Shared buckets + CDN + wildcard cert |
| Validation: deploy test stack | — | 1d | Full end-to-end test |

**Subtotal: ~11 days**

### Phase 1: Control Plane MVP (3-4 weeks)

**Goal:** Automated provisioning triggered by Paddle. Ops dashboard for our team.

| Task | Files | Effort | Notes |
|---|---|---|---|
| Control Plane DynamoDB table + schema | New: `control-plane-stack.ts` | 1d | |
| Paddle webhook handler with sig verification | New: `control-plane/webhook.ts` | 2d | All subscription lifecycle events |
| Provisioning Step Functions state machine | New: `control-plane/provision-sfn.ts` | 3d | 6 states + error handler |
| CodeBuild project for CDK deploy | `control-plane-stack.ts` | 1d | Source from S3 artifact |
| Teardown Step Functions state machine | New: `control-plane/teardown-sfn.ts` | 2d | Export → destroy → cleanup |
| Stack Manager API (CRUD endpoints) | New: `control-plane/api/` | 2d | 8 endpoints |
| Welcome email template (SES) | New: `control-plane/email.ts` | 0.5d | |
| Ops dashboard SPA (minimal) | New: `control-plane-admin/` | 3d | Stack list, status, logs, manual provisioning |
| Source artifact pipeline (zip repo → S3) | GitHub Actions workflow | 1d | Trigger on release tag |
| Integration test: Paddle → provision → active | — | 2d | End-to-end with Paddle sandbox |

**Subtotal: ~17.5 days**

### Phase 2: Customer Portal (2-3 weeks)

**Goal:** Customers can manage their stack, add domains, view usage.

| Task | Files | Effort | Notes |
|---|---|---|---|
| Customer auth (Paddle portal login or magic link) | New: `manage-app/` | 2d | |
| Dashboard page (stack status, quick links) | `manage-app/pages/` | 1d | |
| Usage page (CloudWatch metrics → charts) | `manage-app/pages/` | 2d | |
| Custom domain flow (add → verify → cert → CF) | `control-plane/api/custom-domain.ts` | 3d | ACM + CloudFront + Route53 |
| MCP config download page | `manage-app/pages/` | 0.5d | Pre-filled .env file |
| AI setup page (API key entry + test) | `manage-app/pages/` | 1d | |
| Billing link to Paddle customer portal | `manage-app/pages/` | 0.5d | |
| Usage collector Lambda (monthly) | `control-plane/usage-collector.ts` | 2d | CloudWatch queries + Paddle reporting |

**Subtotal: ~12 days**

### Phase 3: Admin AI Integration (2-3 weeks)

**Goal:** Claude assistant in the admin app using customer's Anthropic key.

| Task | Files | Effort | Notes |
|---|---|---|---|
| Streaming Lambda for AI proxy | New: `backend/src/ai/chat.ts` | 3d | Lambda response streaming + Anthropic SDK |
| Tool definitions (extracted from MCP server) | New: `packages/shared/src/ai-tools.ts` | 2d | Shared between MCP server and AI proxy |
| Tool executor (calls AMODX API server-side) | New: `backend/src/ai/tool-executor.ts` | 2d | Reuses existing handler logic |
| API key storage (encrypted in DDB) | `backend/src/settings/` | 1d | New field in TenantConfig |
| Admin UI: AiAssistant panel | New: `admin/src/components/AiAssistant.tsx` | 3d | Chat UI, SSE consumer, tool indicators |
| Admin UI: AiSetup in Settings | `admin/src/pages/Settings.tsx` | 1d | Key input, test, toggle |
| Admin UI: useAiChat hook | New: `admin/src/hooks/useAiChat.ts` | 1d | Conversation state, SSE management |
| CDK: Lambda Function URL for AI endpoint | `amodx-stack.ts` | 0.5d | Streaming enabled, IAM auth |
| System prompt engineering | Config file | 1d | Site-aware, tool-aware, safety guardrails |

**Subtotal: ~14.5 days**

### Phase 4: Operational Hardening (2-3 weeks)

**Goal:** Production-ready operations for paying customers.

| Task | Files | Effort | Notes |
|---|---|---|---|
| Rolling update pipeline (push AMODX updates to all stacks) | `control-plane/update-all.ts` | 3d | Canary: 1 stack → wait 1hr → batch of 5 → all |
| Per-stack health check Lambda (hourly) | `control-plane/health-check.ts` | 1d | Hits renderer + API + admin, alerts on failure |
| Per-stack cost allocation tags + monthly report | `control-plane/cost-report.ts` | 1d | AWS Cost Explorer API |
| Auto-suspension on `subscription.past_due` (after 7 days) | `control-plane/webhook.ts` | 1d | Disable API Gateway, show suspension page |
| Data export for offboarding (DDB export → S3 → signed URL) | `control-plane/export.ts` | 2d | |
| Rate limiting enforcement per tier | `api.ts` (API Gateway throttling) | 1d | |
| Monitoring dashboard (all stacks overview) | CloudWatch | 1d | Aggregate metrics |
| Runbook documentation | `docs/saas-runbook.md` | 2d | |

**Subtotal: ~12 days**

### Phase 5: Multi-Account (Deferred)

Triggered when approaching 100 stacks or when operational risk of single-account becomes unacceptable.

| Task | Effort |
|---|---|
| AWS Organizations setup + SCPs | 2d |
| Workload account creation | 1d |
| Cross-account IAM roles for CDK deploy | 2d |
| CodeBuild cross-account deployment | 2d |
| Centralized CloudWatch logs forwarding | 1d |
| Account assignment logic in provisioning state machine | 1d |
| Consolidated billing setup | 0.5d |
| Testing + migration of existing stacks | 3d |
| **Subtotal** | **~12.5 days** |

### Total Timeline

| Phase | Duration | Cumulative |
|---|---|---|
| Phase 0: Parameterize | 2-3 weeks | 2-3 weeks |
| Phase 1: Control Plane | 3-4 weeks | 5-7 weeks |
| Phase 2: Customer Portal | 2-3 weeks | 7-10 weeks |
| Phase 3: AI Integration | 2-3 weeks | 9-13 weeks |
| Phase 4: Ops Hardening | 2-3 weeks | 11-16 weeks |
| Phase 5: Multi-Account | Deferred | — |

**MVP launch (Phases 0+1):** ~5-7 weeks. Enough for limited-seats offer.
**Full launch (Phases 0-4):** ~11-16 weeks.

---

## 12. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | CDK deploy fails mid-provisioning | Medium | Customer stuck in "provisioning" | Step Function retry (2 attempts). Dead letter queue. Ops alert via SNS. Manual intervention runbook. |
| R2 | Lambda concurrency contention across stacks | Medium | Degraded p99 latency for all customers | Request 5,000 concurrency limit on day one. Provisioned concurrency for Agency tier. Warmer Lambda per stack. |
| R3 | Stack costs exceed tier revenue | Medium | Negative margin | Monthly cost report per stack. Auto-alert at 80% of tier revenue. Overage billing via Paddle. Hard rate limits. |
| R4 | AWS limit increase request denied | Low | Cannot onboard new customers | Pre-request all increases before first customer. Multi-account as fallback. |
| R5 | Renderer version mismatch after failed rolling update | Medium | Inconsistent behavior across stacks | Canary deployment (1 stack, wait, batch). Rollback state in Step Functions. Version pinning in stack record. |
| R6 | Paddle webhook delivery failure | Low | Stack not provisioned despite payment | Paddle retries automatically. Dead letter queue. Daily reconciliation job checks Paddle API vs control DB. |
| R7 | Cross-stack data leak via shared S3 | Low | Critical security incident | IAM permission boundary. S3 bucket policy with explicit prefix deny. Quarterly security audit. |
| R8 | Customer's Anthropic API key compromised via our backend | Low | Customer's Anthropic account drained | Key encrypted at rest (DDB encryption). Key never logged. Lambda memory cleared on cold start. Key masked in UI (show last 4 chars). |
| R9 | Single-account blast radius (bad IAM change affects all stacks) | Medium | All customers impacted | Infrastructure-as-code (CDK). No manual console changes. PR review for all infra changes. Phase 5 (multi-account) reduces blast radius. |
| R10 | Slow provisioning (15 min) causes customer drop-off | Medium | Lost conversions | Set expectations in UI ("Your stack is being created, ~15 minutes"). Send email when ready. Consider pre-provisioned warm pool (Phase 4+). |

---

## 13. Go-to-Market: Limited Seats Launch

### Strategy

Do not build for scale before proving demand. Launch with 10-20 seats at a discounted "founding member" price to validate:
- Is there demand for self-hosted AMODX?
- What tier do people actually want?
- What features are missing?
- What support burden does each customer create?

### Launch Plan

1. **Landing page** on amodx.com: "Get Your Own AMODX Stack" — explain the value (dedicated infrastructure, full control, AI-powered, no shared hosting).
2. **Founding member pricing:** 50% off first year ($75 Starter, $175 Business, $500 Agency).
3. **Limited to 20 seats** — creates urgency, limits blast radius.
4. **Manual onboarding call** for each customer — learn what they need, build relationship, identify missing features.
5. **Private Discord/community** for founding members — direct feedback channel.

### Success Criteria (before scaling)

| Metric | Target |
|---|---|
| Seats sold (within 30 days of launch) | 5+ |
| Customer activation rate (actually using the stack) | 80%+ |
| Support tickets per customer per month | <3 |
| Churn after first month | <20% |
| At least 1 customer on Business or Agency tier | Yes |

If these are met after 60 days, proceed to Phase 2+3+4. If not, reassess product-market fit.

---

## 14. Video Content Plan

### Pre-Launch Videos (Marketing)

| # | Title | Duration | Purpose |
|---|---|---|---|
| V0 | "Why Self-Hosted? AMODX vs Shared Hosting" | 3 min | Marketing. Explain dedicated infrastructure, performance, security. Compare to WordPress on Bluehost. |
| V1 | "AMODX SaaS Demo: From Signup to Live Site in 20 Minutes" | 5 min | Product demo. Show the full flow: Paddle checkout → provisioning → first page → live site. |

### Post-Signup Videos (Onboarding)

| # | Title | Duration | Content |
|---|---|---|---|
| V2 | "Welcome to Your AMODX Stack" | 3 min | Tour of welcome email. First admin login. Password change. Dashboard overview. Stack endpoints explained. |
| V3 | "Creating Your First Website" | 5 min | Create a tenant (site). Configure identity (name, logo, favicon). Set up a custom domain (DNS instructions walkthrough). |
| V4 | "Building Pages with the Block Editor" | 5 min | Create a page. Use Tiptap editor. Add blocks: hero, features, pricing, FAQ, testimonials. Publish and preview. GPU effects demo. |
| V5 | "Setting Up Your Online Store" | 5 min | Enable commerce. Add products with variants. Set up categories. Configure delivery. Payment methods. Process first order. (Business/Agency only) |
| V6 | "Connecting Claude AI to Your Stack" | 4 min | Option A: MCP server setup (download config, Claude Desktop). Option B: Built-in AI assistant (enter API key, demo conversation). (Agency tier or BYO key) |
| V7 | "Managing Your Subscription and Domains" | 3 min | Customer portal tour. Usage dashboard. Add custom domain. Upgrade tier. Billing management via Paddle. |

### Production Notes

- Screen recordings with voiceover (no face camera needed for V1)
- Use a real stack (staging environment) for demos
- Keep each video focused on ONE workflow
- End each video with "Next: [link to next video]"
- Host on YouTube (SEO) + embed on amodx.com docs page

---

## 15. Technical Debt Created by This Plan

| Item | Description | Priority | When to Address |
|---|---|---|---|
| TD-SAAS-1 | Paddle webhook has no signature verification (existing) | **Critical** | Must fix in Phase 1, before any customer payment flows |
| TD-SAAS-2 | Per-stack renderer build is slow (10-15 min provisioning) | Medium | Phase 4+: warm pool of pre-provisioned stacks, or pre-built artifact |
| TD-SAAS-3 | No automated rollback for failed stack updates | Medium | Phase 4: add rollback state to update Step Function |
| TD-SAAS-4 | AI tool definitions duplicated between MCP server and AI proxy | Medium | Phase 3: extract shared tool schema module |
| TD-SAAS-5 | Customer portal auth is basic (magic link or Paddle portal redirect) | Low | Future: proper OAuth with Paddle as identity provider |
| TD-SAAS-6 | No pre-provisioned warm pool for instant onboarding | Low | Only needed at scale (50+ customers) |
| TD-SAAS-7 | Single-account blast radius | Low | Phase 5: multi-account via AWS Organizations |
| TD-SAAS-8 | CORS allowlist is explicit (not pattern-based) for HTTP API v2 | Low | Minor: subdomains need wildcard CORS or dynamic list |

---

## 16. File Map (New Files to Create)

```
infra/
  lib/
    saas-foundation-stack.ts     Shared buckets, CDN, wildcard cert
    control-plane-stack.ts       Control Plane: API, DDB, Step Functions, CodeBuild
    control-plane/
      webhook.ts                 Paddle webhook handler
      provision-sfn.ts           Provisioning state machine definition
      teardown-sfn.ts            Teardown state machine definition
      generate-config.ts         Step Function task: create stack config JSON
      read-outputs.ts            Step Function task: read CloudFormation outputs
      create-admin-user.ts       Step Function task: Cognito user creation
      configure-dns.ts           Step Function task: Route53 records
      send-welcome-email.ts      Step Function task: SES welcome email
      health-check.ts            Scheduled: per-stack health checks
      usage-collector.ts         Scheduled: monthly CloudWatch → Paddle
      cost-report.ts             Scheduled: AWS Cost Explorer → report
      update-all.ts              Rolling update across all stacks
      export.ts                  DDB export for offboarding

backend/
  src/
    ai/
      chat.ts                    Streaming Lambda: Claude proxy
      tool-executor.ts           Execute AMODX tools from Claude tool_use
      tools.ts                   Shared tool definitions (extracted from MCP)

admin/
  src/
    components/
      AiAssistant.tsx            Chat panel UI
    hooks/
      useAiChat.ts               SSE consumer + conversation state
    pages/
      Settings.tsx               (Modified: add AI Setup section)

manage-app/                      Customer self-service portal (new SPA)
  src/
    pages/
      Dashboard.tsx
      Usage.tsx
      Domains.tsx
      McpSetup.tsx
      AiSetup.tsx
      Billing.tsx
      Support.tsx

packages/shared/
  src/
    ai-tools.ts                  Shared tool schemas (MCP + AI proxy)

docs/
  saas-runbook.md                Operational procedures
```
