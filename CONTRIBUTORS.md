# AMODX Developer Guide

This document is for engineers contributing to the AMODX core platform.

---

## 🏗 System Architecture

### The Six Domains
1.  **The Brain:** `backend/src/context` (DynamoDB Strategy)
2.  **The Cockpit:** `admin/` (React Dashboard)
3.  **The Face:** `renderer/` (Next.js ISR Engine)
4.  **The Bridge:** `tools/mcp-server/` (AI Interface)
5.  **The Gatekeeper:** `infra/lib/auth.ts` (Cognito + Lambda Authorizer)
6.  **The Plugins:** `packages/plugins` (UI Block Registry)

---

## 🔐 Authentication & Security

The Backend API is protected by a **Lambda Authorizer**. Every request must have specific headers depending on the actor.

### 1. Actor: Agency Admin (Human)
*   **Interface:** Admin Panel
*   **Auth:** Cognito User Pool (AdminPool)
*   **Headers:**
    *   `Authorization: Bearer <JWT>`
    *   `x-api-key: web-client` (Bypasses Master Key check, falls back to Cognito)
    *   `x-tenant-id: <TenantID>` (Context)

### 2. Actor: AI / Renderer (Robot)
*   **Interface:** MCP Server / Next.js Server Side
*   **Auth:** Master API Key (Secrets Manager)
*   **Headers:**
    *   `x-api-key: <MASTER_KEY>`
    *   `Authorization: Bearer robot` (Dummy token to pass Gateway validation)
    *   `x-tenant-id: <TenantID>`

### 3. Actor: Tenant Visitor (Public)
*   **Interface:** Public Website (Contact Forms)
*   **Auth:** None (Public Routes)
*   **Headers:**
    *   `x-tenant-id: <TenantID>` (Injected via Window Context)

---

## 🎨 Frontend Architecture

### The Plugin System (Blocks)
We use a split-entry architecture to prevent Next.js from crashing on Tiptap dependencies.
*   `packages/plugins/src/admin.ts`: Exports Editor components (Tiptap).
*   `packages/plugins/src/render.ts`: Exports React components (Standard DOM).

### Global Context Injection
The Renderer injects the Tenant ID into the browser scope so hydrated components (like Contact Forms) know where to send data without prop drilling.
*   **Source:** `renderer/src/components/ThemeInjector.tsx`
*   **Variable:** `window.AMODX_TENANT_ID`

---

## 🖼 Asset Pipeline (Uploads)

We do not upload files through the API Gateway (payload limits). We use **Signed URLs**.

1.  **Request:** Admin calls `POST /assets` with filename/type.
2.  **Presign:** Backend generates a secure S3 PUT URL.
3.  **Upload:** Frontend uploads binary directly to S3.
4.  **Delivery:** Files are served publicly via CloudFront (`https://assets.domain.com/...`).

---

## 💻 Local Development

### 1. Initial Setup
```bash
npm install
npm run build -w @amodx/shared
npm run build -w @amodx/plugins
```

### 2. Connect to Cloud
You must deploy the backend first to get APIs and Secrets.
```bash
cd infra
npx cdk deploy
npm run post-deploy # <--- GENERATES .env.local FILES AUTOMATICALLY
```

### 3. Run Servers
```bash
# Terminal 1: Admin
cd admin && npm run dev

# Terminal 2: Renderer (Preview Mode)
cd renderer && npm run dev
```

### 4. Watch Mode
If modifying plugins/shared types:
```bash
# Terminal 3
cd packages/plugins
npm run watch
```

---

## 🧩 Creating a Plugin (Block)

1.  **Create:** `packages/plugins/src/my-block/` (Schema, Editor, Render, Index).
2.  **Register:** Add to `src/admin.ts` AND `src/render.ts`.
3.  **Build:** `npm run build -w @amodx/plugins` (Required after every change!).
4.  **Deploy:** `cd infra && npx cdk deploy`.

See `packages/plugins/src/hero` for a reference implementation.

---

## 📦 Project Structure

```text
amodx/
├── admin/                 # React SPA (Vite)
├── backend/               # Lambda Functions
├── infra/                 # AWS CDK
├── packages/
│   ├── shared/            # Types
│   └── plugins/           # UI Block Registry
│       ├── src/
│       │   ├── admin.ts   # Entry point for Admin
│       │   ├── render.ts  # Entry point for Renderer
│       │   └── hero/      # Example Block
├── renderer/              # Next.js App Router (ISR)
└── tools/
    └── mcp-server/        # AI Interface
```
