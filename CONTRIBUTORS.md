# AMODX Developer Guide

This document is for engineers contributing to the AMODX core platform. If you are an Agency Owner looking to deploy, see [README.md](README.md).

---

## 🏗 System Architecture

AMODX is a monorepo managed by NPM Workspaces. It runs on a fully serverless AWS stack using **Incremental Static Regeneration (ISR)** for high performance.

### The Six Domains

1.  **The Brain (Context Engine):** `backend/src/context`
    *   Stores strategy and personas in DynamoDB.
    *   Single-Table Design (`PK: TENANT#...`).
2.  **The Cockpit (Admin UI):** `admin/`
    *   React 19 + Vite + Tailwind v4.
    *   Hosted on S3 + CloudFront.
3.  **The Face (ISR Renderer):** `renderer/`
    *   Next.js 16 (OpenNext) running on Lambda.
    *   **Architecture:** Middleware rewrites incoming domains (`client.com`) to internal paths (`/client-id/home`).
    *   **Warm Cache:** Content updates trigger `revalidatePath`, ensuring instant updates without full rebuilds.
4.  **The Bridge (MCP Server):** `tools/mcp-server/`
    *   Implements the Model Context Protocol.
    *   Connects local LLMs to the remote AWS API.
5.  **The Agents:** `backend/src/agents`
    *   Background workers for research and posting.
6.  **The Gatekeeper:** `infra/lib/auth.ts`
    *   Cognito User Pools + Lambda Authorizers.

---

## 🛠 Tech Stack

*   **IaC:** AWS CDK (TypeScript)
*   **Backend:** AWS Lambda (Node.js 22), DynamoDB, API Gateway (HTTP).
*   **Frontend:** React, Shadcn/UI, Lucide Icons.
*   **Rendering:** Next.js App Router, OpenNext.
*   **AI:** Vercel AI SDK, MCP.

---

## 💻 Local Development (Hybrid Mode)

We do not run the full stack locally (too complex to mock AWS services). Instead, we run the **Frontends locally** connected to the **Real AWS Backend**.

### 1. Initial Setup
```bash
npm install
```

### 2. Deploy Backend
You must deploy the infrastructure at least once to get the API endpoints.
```bash
cd infra
npx cdk deploy
```
*Keep the output values handy.*

### 3. Setup Admin Panel (Local)
Create `admin/.env.local` with your deployment outputs:
```env
VITE_API_URL=https://xyz.execute-api.us-east-1.amazonaws.com/
VITE_USER_POOL_ID=us-east-1_xxxxxx
VITE_USER_POOL_CLIENT_ID=xxxxxx
VITE_RENDERER_URL=https://d111.cloudfront.net
```

Run the dev server:
```bash
cd admin
npm run dev
```

### 4. Setup Renderer (Local Preview)
The local renderer needs access to DynamoDB. Ensure your local AWS CLI is configured (`aws configure`) with credentials that have access to the table.

Run the dev server:
```bash
cd renderer
npm run dev
```
*Note: Local renderer simulates multi-tenancy via URL rewrites. Access sites via `http://localhost:3000/_site/[TENANT_ID]/home`.*

### 5. Developing the MCP Server
To test AI tools locally without redeploying:
```bash
cd tools/mcp-server
# Build and link to Claude manually or use the setup script
npm run build
npm run setup <YOUR_API_URL>
```

---

## 🧪 Testing

*   **Unit Tests:** `npm test` (Jest)
*   **Integration:** Manually verify flows via the Admin Panel.
*   **Cache Verification:** Check `x-nextjs-cache` headers on the Renderer.

---

## 📦 Project Structure

```text
amodx/
├── admin/                 # SPA Dashboard
├── backend/               # Lambda Functions (Business Logic)
├── infra/                 # AWS CDK (Deployment Logic)
├── packages/
│   └── shared/            # Zod Schemas & Types (The Contract)
├── renderer/              # Next.js Public Site Engine
└── tools/
    └── mcp-server/        # AI Interface
```
