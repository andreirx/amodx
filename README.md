# AMODX: The Agency Operating System

> **Transforming agencies from "website builders" into Infrastructure Owners.**

AMODX (Agency Management On Demand Extreme) is a **Serverless Command Center** that hosts sites, generates high-fidelity content via AI, and manages access gates (paywalls/logins) in one unified, secure, multi-tenant codebase.

It replaces the "Frankenstein Stack" (WordPress + MemberPress + Zapier + ChatGPT) with a purpose-built **Growth Engine**.

---

## ⚡ The Vision

Agencies today trade time for pixel-pushing. AMODX allows them to sell reusable, high-leverage **infrastructure**.

*   **The Problem:** The "Frankenstein Stack." Maintaining fragile monoliths (WordPress) is unscalable, insecure, and labor-intensive.
*   **The Solution:** A "Newsroom" approach. While competitors (Wix, Webflow) act as the Printing Press (displaying content), AMODX acts as the **Newsroom**—managing strategy, research, drafting, and distribution automatically.
*   **The Philosophy:** "Flushing the Gunk." We eliminate the manual labor of marketing operations and the technical debt of server maintenance.

---

## 🏗 System Architecture (The Six Domains)

### 1. The Brain (Context Engine)
*   **Backend:** `backend/src/context` (Lambda + DynamoDB)
*   **Function:** Stores "Strategy," "Personas," and "Funnels" as structured data.
*   **Value:** This context is fed to LLMs so they generate content aligned with business goals, not generic fluff.

### 2. The Cockpit (Admin UI)
*   **Frontend:** `admin/` (React 19, Vite, Tailwind v4, Shadcn)
*   **Hosting:** AWS S3 + CloudFront (Global CDN).
*   **Function:** The mission control for the Agency Owner.
*   **Features:**
    *   **Mobile-First:** Fully responsive design allows owners to approve work from their phone.
    *   **Strategy Board:** Visual management of personas and offers.
    *   **Content Editor:** Rich-text block editor with SEO-friendly slug management.

### 3. The Face (Public Renderer)
*   **Frontend:** `renderer/` (Next.js 16, OpenNext, AWS Lambda)
*   **Function:** A headless rendering engine that displays the public sites.
*   **Features:**
    *   **AI-Native SEO:** Automatically generates `/llms.txt` and Schema.org data.
    *   **Dynamic Theming:** Injects CSS variables at runtime based on Tenant Configuration.
    *   **Multi-Tenancy:** Resolves content based on the domain name headers.

### 4. The Bridge (MCP Server)
*   **Tool:** `tools/mcp-server/`
*   **Function:** Implements the **Model Context Protocol**.
*   **Value:** Allows local LLMs (Claude Desktop, Cursor) to control the cloud infrastructure directly. You can chat with your business: *"Check inventory and write a promo tweet based on our Q1 strategy."*

### 5. The Agents (Execution Layer)
*   **Backend:** `backend/src/agents` (Lambda)
*   **Capabilities:**
    *   **Researcher:** Scans internet for trends to validate ideas (via Perplexity).
    *   **Poster:** Automates distribution to social platforms upon human approval.

### 6. The Gatekeeper (Access & Auth)
*   **Infra:** Cognito User Pools + Lambda Authorizers.
*   **Value:** Access control is a first-class citizen. Content is locked at the edge/API level, not via a PHP plugin.

---

## 📂 Project Structure

This is a Monorepo managed by NPM Workspaces.

```text
amodx/
├── admin/                 # The React Admin Panel (Vite)
├── backend/               # Serverless Business Logic (Lambda/Node.js)
├── infra/                 # Infrastructure as Code (AWS CDK)
├── packages/
│   └── shared/            # Shared Types, Schemas (Zod), and Utils
├── renderer/              # The Next.js Public Site Renderer
└── tools/
    └── mcp-server/        # Bridge between Claude Desktop and AWS
```

---

## 🚀 Getting Started

### Prerequisites
*   Node.js v20+
*   AWS CLI (configured)
*   AWS Account

### 1. Installation
```bash
npm install
```

### 2. Infrastructure Deployment
Deploy the serverless stack (Database, API, Admin Hosting).
```bash
cd infra
npx cdk deploy
```
*Note the Admin URL output (e.g., `https://d123.cloudfront.net`).*

### 3. Running Locally (Hybrid Mode)

**The Admin Panel:**
```bash
cd admin
npm run dev
# Uses .env.local to connect to Real AWS Backend
```

**The Renderer:**
```bash
cd renderer
npm run dev
# Connects to Real AWS Database via AWS SDK
```

### 4. Connecting Claude (AI Bridge)
To enable the "Chat with your Business" feature:
```bash
cd tools/mcp-server
npm run build
npm run setup <YOUR_API_GATEWAY_URL>
```
Restart Claude Desktop to see the `amodx` tools available.

---

## 🛠 Tech Stack

*   **Cloud:** AWS (Lambda, DynamoDB, API Gateway, Cognito, S3, CloudFront)
*   **IaC:** AWS CDK (TypeScript)
*   **Frontend:** React 19, Tailwind CSS v4, Shadcn/UI
*   **Renderer:** Next.js 16 (App Router), OpenNext
*   **AI:** Vercel AI SDK, Model Context Protocol (MCP)

---

## 📜 License

Licensed under the **Apache 2.0 License**.
You are free to use, modify, and distribute this software for personal or commercial purposes.
