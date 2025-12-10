# AMODX System Architecture Specification (v2.1 - The Block Protocol)

**Project Name:** AMODX (Agency Management On Demand Extreme)
**Vision:** A Serverless, AI-Native Operating System for Agencies. One Deployment = Infinite Sites.
**Philosophy:** "Notion for Agencies." We do not paint pixels; we assemble structured **Blocks**.

---

## 1. Module: `packages/shared` (The Contract)
**Status:** ✅ Implemented.
**Purpose:** Single source of truth.

### Core Data Models
*   **`TenantConfig`**: Defines Site Settings, Theming (WP Parity - Colors, Fonts, Radius), and Integrations.
*   **`ContentItem`**: Represents a Page. Contains a list of **Blocks**.
    *   **Format:** Tiptap JSON.
    *   **Standard Nodes:** Paragraph, Heading, Image.
    *   **Custom Nodes (The UI Kit):** Hero, Pricing, FeatureGrid, FAQ, CTA, LeadForm.
*   **`AccessPolicy`**: Defines Gating Logic (`LoginRequired`, `Purchase`).
*   **`ContextItem`**: Defines Strategy/Persona data for AI Context.
*   **`Route`**: Maps Slugs to Content Nodes or Redirects (Native Redirect support).

---

## 2. Module: `infra` (The Factory)
**Status:** ✅ Implemented.
**Purpose:** AWS CDK code provisioning the serverless environment.

*   **`lib/database.ts`**: DynamoDB Single-Table Design (`PK`, `SK`).
    *   **PK Schema:** `SYSTEM` (Configs), `TENANT#<ID>` (Data), `AGENCY#<ID>` (Future).
*   **`lib/auth.ts`**: Cognito User Pool (Single pool for Agency Admins).
*   **`lib/api.ts`**: API Gateway (HTTP). Protected by **Lambda Authorizer** (Cognito + Master Key).
*   **`lib/renderer-hosting.ts`**: OpenNext/SST construct for Next.js Lambda.

---

## 3. Module: `backend` (The Brain)
**Status:** ✅ Implemented.
**Purpose:** Node.js/TypeScript logic on Lambda. **Audit-Ready.**

*   **Security:** All Lambdas receive `AuthorizerContext` (User ID, Tenant ID).
*   **`src/content/`**: Transactional writes. Records `createdBy`, `updatedBy`.
*   **`src/tenant/`**: Management of Sites. Records `ownerId`.
*   **`src/context/`**: Full CRUD for Strategy.

---

## 4. Module: `admin` (The Cockpit)
**Status:** ✅ Live.
**Purpose:** Mission control.

*   **Multi-Tenant:** Global Context Switcher in Sidebar.
*   **Editor Engine:** Tiptap-based Block Editor.
    *   **Requirement:** Must support "Slash Commands" to insert complex blocks (e.g., `/hero`).
*   **Strategy Board:** Visual management of Personas.

---

## 5. Module: `renderer` (The Face)
**Status:** ✅ Implemented (ISR Architecture).
**Purpose:** Public site engine.

**Architecture:** **Incremental Static Regeneration (ISR) with Middleware Rewrites.**

*   **Routing:** Maps `client.com` -> `/client-id/home`.
*   **Theming:** Dynamic CSS Variables injected at build time.
*   **The Block Engine:**
    *   Instead of generic HTML, the Renderer maps JSON Blocks to **Shadcn/Tailwind Components**.
    *   **Hero Block:** `variants: { style: 'split' | 'center' | 'minimal' }`
    *   **Pricing Block:** Accepts JSON data for tiers/features.
    *   **SEO:** Auto-generates `llms.txt`, `robots.txt`, and `sitemap.xml`.

---

## 6. Module: `tools/mcp-server` (The Bridge)
**Status:** ✅ Implemented.
**Purpose:** AI Interface.

*   **Authentication:** Requires `AMODX_API_KEY`.
*   **Capabilities:** Full control over Tenants, Content, and Context.
*   **Workflow:** "Create a site for Client X" -> "Draft a Landing Page using the Pricing Block".

---

## 7. Roadmap (The Dogfood Protocol)
1.  **Block Implementation:** Build the 5 Core Blocks in Renderer & Admin.
2.  **SEO Module:** Implement `llms.txt` generation in Renderer.
3.  **Agency Ops:** Build the "Agency Team" management (Collaborators).
4.  **Launch:** Deploy `amodx.com` on this stack.
```
