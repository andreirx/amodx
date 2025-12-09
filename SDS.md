# AMODX System Architecture Specification (v2.0 - Multi-Tenant ISR)

**Project Name:** AMODX (Agency Management On Demand Extreme)
**Vision:** A Serverless, AI-Native Operating System for Agencies. It manages multiple client sites from a single deployment, where Strategy (Context) drives Execution (Content/Agents).

---

## 1. Module: `packages/shared` (The Contract)
**Status:** ✅ Implemented.
**Purpose:** Single source of truth for Types, Zod Schemas, and Enums.
**Structure:** Consolidated into `src/index.ts`.

### Core Data Models
*   **`TenantConfig`**: Defines Site Settings, Theming (WP Parity - Colors, Fonts, Radius), and Integrations (GA, Stripe).
*   **`ContentItem`**: Defines Pages/Posts structure. Includes `slug` and `blocks` (Tiptap JSON).
*   **`AccessPolicy`**: Defines Gating Logic (`LoginRequired`, `Purchase`).
*   **`ContextItem`**: Defines Strategy/Persona data for AI Context.
*   **`Route`**: Maps Slugs to Content Nodes or Redirects.

---

## 2. Module: `infra` (The Factory)
**Status:** ✅ Implemented.
**Purpose:** AWS CDK code provisioning the serverless environment.

*   **`lib/database.ts`**: DynamoDB Single-Table Design (`PK`, `SK`).
    *   **PK Schema:** `SYSTEM` (for Tenant configs), `TENANT#<ID>` (for Content/Context).
*   **`lib/auth.ts`**: Cognito User Pool (Single pool for Agency Admins).
*   **`lib/api.ts`**: API Gateway (HTTP API). Exposes Content, Context, Settings, and Tenant Management endpoints.
*   **`lib/admin-hosting.ts`**: S3 + CloudFront hosting for the Admin SPA.
*   **`lib/renderer-hosting.ts`**: OpenNext/SST construct for Next.js Lambda.

---

## 3. Module: `backend` (The Brain)
**Status:** ✅ Implemented.
**Purpose:** Node.js/TypeScript logic running on Lambda.

*   **`src/tenant/`**:
    *   **`create.ts`**: Provisions new sites (`TENANT#id`).
    *   **`list.ts`**: Lists available sites for the Admin Switcher.
    *   **`settings.ts`**: Get/Update Tenant Configuration.
*   **`src/content/`**:
    *   **`create.ts`**: Transactional write (Content + Route). Uses `x-tenant-id` header.
    *   **`update.ts`**: Transactional update. Handles Slug changes & Redirects.
    *   **`get.ts` / `list.ts`**: Fetches content for specific tenant.
*   **`src/context/`**:
    *   **`create` / `list` / `get` / `update` / `delete`**: Full CRUD for Strategy items (Personas, Offers).

---

## 4. Module: `admin` (The Cockpit)
**Status:** ✅ Live on AWS (S3/CloudFront).
**Purpose:** React 19 + Vite + Tailwind v4 + Shadcn.
**Features:**
*   **Multi-Tenant:** Site Switcher in Sidebar (Global Context).
*   **Auth:** Cognito Integration via Amplify.
*   **Content Editor:** Tiptap Block Editor.
*   **Strategy Board:** Kanban-style view for Personas/Offers.
*   **Settings:** Theme customization (Colors, Radius) per tenant.

---

## 5. Module: `renderer` (The Face)
**Status:** ✅ Implemented (ISR Architecture).
**Purpose:** Next.js 15 (OpenNext) application for public sites.

**Architecture:** **Incremental Static Regeneration (ISR) with Middleware Rewrites.**

*   **Routing (Middleware):**
    *   Intercepts request: `client-a.com/about`.
    *   Rewrites to internal path: `/client-a/about`.
*   **Caching Strategy (Warm Cache):**
    *   **Default:** Pages cached at CloudFront/Next.js layer (1 Year).
    *   **Revalidation:** Backend triggers `POST /api/revalidate` on content save.
    *   **Runtime:**
        *   **Hit:** Served instantly (Static).
        *   **Miss/Stale:** Background Lambda regeneration (User sees stale version briefly, next user sees new).
*   **Theming:** `ThemeInjector` bakes CSS variables into the HTML at generation time. No client-side flicker.

---

## 6. Module: `tools/mcp-server` (The Bridge)
**Status:** ✅ Implemented.
**Purpose:** Local Node.js script connecting Claude Desktop to AWS API.

*   **Capabilities:**
    *   `create_tenant` / `list_tenants`: Manage Sites.
    *   `list_content` / `create_page` / `read_page` / `update_page`: Manage CMS.
    *   `list_context` / `create_context` / `read_context` / `update_context`: Manage Strategy.
*   **Security:** Enforces `tenant_id` on all operations.

---

## 7. Integrations & Payment Strategy
*   **Payment:** Stripe keys stored in Tenant Config.
*   **SEO:** Auto-generated metadata in Renderer based on Content Attributes.
*   **Redirects:** Native support via `IsRedirect` flag in DynamoDB Routes.
