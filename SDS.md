# AMODX System Architecture Specification (v2.1 - The Block Protocol)

**Project Name:** AMODX (Agency Management On Demand Extreme)

**Vision:** A Serverless, AI-Native Operating System for Agencies. One Deployment = Infinite Sites.

**Philosophy:** "Notion for Agencies." We do not paint pixels; we assemble structured **Blocks**.

![AMODX Architecture](Diagram-AMODX.jpg)

---

## 1. Module: `packages/shared` (The Contract)
**Status:** ✅ Implemented.
**Purpose:** Single source of truth for base types.

### Core Data Models
*   **`TenantConfig`**: Defines Site Settings, Theming (WP Parity), and Integrations.
*   **`ContentItem`**: Represents a Page. Contains a list of **Blocks**.
*   **`AccessPolicy`**: Defines Gating Logic.
*   **`Route`**: Maps Slugs to Content Nodes or Redirects.

---

## 2. Module: `packages/plugins` (The Block Registry)
**Status:** ✅ Implemented.
**Purpose:** Central repository for all UI Blocks. Decouples logic from Admin/Renderer.

### Structure
*   **Definition:** Each plugin exports `schema` (Zod), `editorExtension` (Tiptap), and `renderComponent` (React).
*   **Registration:** `src/index.ts` exports `PLUGINS`, `getExtensions()`, and `getRenderMap()`.
*   **Current Blocks:**
    *   `hero`: Headline, Subheadline, CTA, Style variants.
    *   *(Planned)*: `pricing`, `faq`, `features`, `lead-form`.

---

## 3. Module: `infra` (The Factory)
**Status:** ✅ Implemented.
**Purpose:** AWS CDK code.
*   **Services:** DynamoDB (Single Table), Cognito (Auth), API Gateway (HTTP), CloudFront (CDN).
*   **Auth:** Lambda Authorizer enforces `x-api-key` (Robots) or `Bearer Token` (Humans).

---

## 4. Module: `backend` (The Brain)
**Status:** ✅ Implemented.
**Purpose:** Node.js Lambda functions.
*   **Security:** All Lambdas use `AuthorizerContext` for audit trails (`createdBy`, `ownerId`).
*   **Multi-Tenancy:** Logic enforced via `x-tenant-id` header.

---

## 5. Module: `admin` (The Cockpit)
**Status:** ✅ Live.
**Purpose:** Mission control.
*   **Editor:** Tiptap editor dynamically loads extensions from `@amodx/plugins`.
*   **Tenant Switching:** Global context awareness.

---

## 6. Module: `renderer` (The Face)
**Status:** ✅ Implemented.
**Purpose:** Public site engine using **ISR**.
*   **Rendering:** Dynamically loads components from `@amodx/plugins`.
*   **Routing:** Middleware rewrites domains to internal tenant paths.

---

## 7. Roadmap (The Dogfood Protocol)
1.  **Migrate to Plugins:** (Done).
2.  **Build Core Blocks:** Hero, Image, Pricing, Contact (done), still TODO: Lead Magnet, Features, CTA.
3.  **SEO Module:** `llms.txt` generation.
4.  **Separate** admin users (can edit pages, content) and tenant users (can post comments, access some restricted resources).
5.  **Launch:** Deploy `amodx.com` on this stack.
