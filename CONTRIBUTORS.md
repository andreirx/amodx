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

The Backend API is protected by a **Lambda Authorizer**. Every request must have one of these headers:

1.  **Human Access (Admin Panel):**
    *   Header: `Authorization: Bearer <Cognito_JWT>`
    *   Header: `x-api-key: web-client` (Dummy key to pass gateway check)
    *   Context: `x-tenant-id: <Tenant_ID>` (For multi-tenancy)

2.  **Robot Access (MCP / Renderer):**
    *   Header: `x-api-key: <MASTER_KEY>` (From Secrets Manager)
    *   Header: `Authorization: Bearer robot` (Dummy token)

### Global Context (Frontend)
The Renderer injects the Tenant ID into the window scope for client-side components (like Forms).
*   Access: `window.AMODX_TENANT_ID`
*   Injected by: `renderer/src/components/ThemeInjector.tsx`

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
