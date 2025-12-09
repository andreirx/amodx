# AMODX System Architecture Specification (currently DEMO - one tenant and SSR renderer)

**Project Name:** AMODX (Agency Management On Demand Extreme)
**Vision:** A Serverless, AI-Native Operating System for Agencies. It replaces WordPress + Zapier with a unified platform where Strategy (Context) drives Execution (Content/Agents).

---

## 1. Module: `packages/shared` (The Contract)
**Status:** ✅ Implemented.
**Purpose:** Single source of truth for Types, Zod Schemas, and Enums.
**Structure:** Consolidated into `src/index.ts`.

### Core Data Models
*   **`TenantConfig`**: Defines Site Settings, Theming (JSON), and enabled Modules (CRM, Inventory).
*   **`UserProfile`**: Defines User Identity, Role (`GLOBAL_ADMIN`, `CLIENT_ADMIN`), and Tenant association.
*   **`ContentItem`**: Defines Pages/Posts structure. Includes `slug` (denormalized) and `blocks` (Tiptap JSON).
*   **`AccessPolicy`**: Defines Gating Logic (`LoginRequired`, `Purchase`).
*   **`ContextItem`**: Defines Strategy/Persona data for AI Context.
*   **`WorkItem`**: Defines HITL tasks (Drafts, Research Jobs).

---

## 2. Module: `infra` (The Factory)
**Status:** ✅ Implemented.
**Purpose:** AWS CDK code provisioning the serverless environment.

*   **`lib/database.ts`**: DynamoDB Single-Table Design (`PK`, `SK`). GSIs for Domain, Type, and Status.
*   **`lib/auth.ts`**: Cognito User Pool with custom attributes (`tenant_id`, `role`).
*   **`lib/api.ts`**: API Gateway (HTTP API). Routes: `/content`, `/context`, `/settings`.
*   **`lib/admin-hosting.ts`**: S3 + CloudFront hosting for the Admin SPA. Includes `ConfigGenerator` for runtime environment injection.
*   **`lib/renderer-hosting.ts`** (Planned): OpenNext/SST construct for Next.js Lambda.

---

## 3. Module: `backend` (The Brain)
**Status:** 🔄 In Progress.
**Purpose:** Node.js/TypeScript logic running on Lambda.

*   **`src/content/`**:
    *   **`create.ts`**: Transactional write (Content + Route).
    *   **`update.ts`**: Transactional update. Handles Slug changes (Delete old Route -> Create new Route + Redirect).
    *   **`get.ts`**: Fetches by Node ID.
    *   **`list.ts`**: Queries Content by Site.
*   **`src/tenant/`**:
    *   **`settings.ts`**: Get/Update Tenant Configuration (Theme, Domain).
*   **`src/context/`**:
    *   **`create.ts` / `list.ts`**: Manage Strategy items.
*   **`src/agents/` (Planned)**: `researcher.ts` (Perplexity integration).

---

## 4. Module: `admin` (The Cockpit)
**Status:** one per tenant ✅ V1 Live on AWS (S3/CloudFront).
**Purpose:** React 19 + Vite + Tailwind v4 + Shadcn.
**Features:**
*   **Responsive Layout:** Sidebar (Desktop) / Drawer (Mobile).
*   **Auth:** Cognito Integration via Amplify (New Password Flow supported).
*   **Content Editor:** Tiptap Block Editor with Title/Slug separation.
*   **Strategy Board:** Kanban-style view for Personas/Offers.
*   **Settings:** Site Name & Theme Color configuration.

---

## 5. Module: `renderer` (The Face)
**Status:** one per tenant ✅ V1 Live on AWS (S3/CloudFront).
**Purpose:** Next.js 15 (OpenNext) application for public sites.

*   **Architecture:** React Server Components (RSC) fetching directly from DynamoDB.
*   **Router:** Middleware identifies Tenant via Host Header.
*   **Data Access:** `lib/dynamo.ts` resolves `Domain -> Tenant` and `Slug -> Route -> Content`.
*   **Theming:** `ThemeInjector` writes CSS variables to `<style>` tag, overriding Tailwind defaults.

**Problem:** Uses a lambda to render each page on the fly. Cold start is SLOW.
Plan migrating to warm caching:

Architecture: Next.js Incremental Static Regeneration (ISR) with On-Demand Revalidation.

The Rules:

1. Default State: All pages are cached at the CloudFront/Next.js layer.
2. Cache Duration: 1 Year (effectively infinite).
3. The Trigger: We use revalidateTag (a Next.js feature).

Scenario A: You edit the "About" Page

1. Action: You click "Save" in Admin.
2. Backend: Updates DynamoDB.
3. Backend: Sends signal to Renderer: POST /api/revalidate { tag: "tenant-123", path: "/about" }.
4. Next.js: Marks /tenant-123/about as "Stale".
5. Cost: 0 Lambda executions so far.
6. First Visitor: Requests /about.
   * Next.js serves the Stale (Old) version instantly (so user waits 0ms).
   * In the background, Next.js spins up One Lambda to regenerate the HTML.
7. Second Visitor: Gets the New version from cache.

Scenario B: You change the Theme (Primary Color)
1. Action: You update Settings in Admin.
2. Backend: Updates DynamoDB.
3. Backend: Sends signal: POST /api/revalidate { tag: "tenant-123-layout" }.
4. Effect: All pages sharing the Root Layout for this tenant are marked Stale.
5. Lambda Triggers:
   * The Lambda runs once per page as they are visited.
   * If you have 100 pages, and 100 people visit 100 different pages, the Lambda runs 100 times.
   * Optimization: This is negligible cost. 100 executions is ~$0.0002.


---

## 6. Module: `tools/mcp-server` (The Bridge)
**Status:** ✅ Implemented.
**Purpose:** Local Node.js script connecting Claude Desktop to AWS API.

*   **Capabilities:**
    *   `list_content` / `create_page` / `update_page` / `read_page`
    *   `list_context` / `create_context`
    *   `update_settings`
    *   `get_schema`
*   **Automation:** `npm run setup <API_URL>` auto-configures Claude Desktop.

---

## 7. Integrations & Payment Strategy
*   **Payment:** Stripe Secret Keys stored in AWS Secrets Manager.
*   **Research:** Perplexity API (Sonar) via Lambda.
*   **Email:** Amazon SES (Transactional) + WorkMail (Inboxes).