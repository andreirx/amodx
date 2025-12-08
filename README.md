# AMODX: The Agency Operating System

> **Transforming agencies from "website builders" into Infrastructure Owners.**

AMODX (Agency Management On Demand Extreme) is a **Serverless Command Center** that hosts sites, generates high-fidelity content via AI, and manages access gates (paywalls/logins) in one unified, secure, multi-tenant codebase.

It replaces the "Frankenstein Stack" (WordPress + MemberPress + Zapier + ChatGPT) with a purpose-built **Growth Engine**.

---

## ⚡ The Vision

Agencies today trade time for pixel-pushing. AMODX allows them to sell reusable, high-leverage **infrastructure**.

*   **The Problem:** The "Frankenstein Stack." Maintaining fragile monoliths (WordPress) is unscalable, insecure, and labor-intensive.
*   **The Solution:** A "Newsroom" approach. While competitors (Wix, Webflow) act as the Printing Press (displaying content), AMODX acts as the **Newsroom**—managing strategy, research, drafting, and distribution automatically.
*   **The Philosophy:** "Flushing the Gunk." We eliminate the manual labor of marketing operations and the technical debt of server maintenance, allowing for pure business logic execution.

---

## 🏗 System Architecture (The Six Domains)

AMODX is not just a CMS; it is a distributed system divided into six specific domains.

### 1. The Brain (Context Engine)
*   **Location:** `backend/src/context`, DynamoDB
*   **Function:** Stores "Strategy," "Personas," "Pain Points," and "Funnels" (structured data, not just text blocks).
*   **Value:** This data is fed to LLMs so they generate content aligned with business goals, rather than generic fluff.

### 2. The Cockpit (Admin UI)
*   **Location:** `admin/` (React 19, Vite, Tailwind v4, Shadcn)
*   **Function:** The mission control for the Agency Owner.
*   **Features:**
    *   **Human-in-the-Loop (HITL):** A "Draft & Approve" workflow for AI agents.
    *   **Mobile-First:** Fully responsive design allows owners to approve work from their phone.
    *   **Strategy Board:** Visual management of personas and offers.

### 3. The Face (Public Renderer)
*   **Location:** `renderer/` (Next.js 16, OpenNext, AWS Lambda)
*   **Function:** A headless rendering engine that displays the public sites.
*   **Features:**
    *   **AI-Native SEO:** Automatically generates `/llms.txt` and Schema.org data, making the site preferred by AI crawlers (Perplexity, SearchGPT).
    *   **Dynamic Theming:** Injects CSS variables at runtime, allowing branding changes without code recompilation.
    *   **Multi-Tenancy:** Resolves content based on the domain name headers.

### 4. The Bridge (MCP Server)
*   **Location:** `tools/mcp-server/`
*   **Function:** ImmVplements the **Model Context Protocol**.
*   **Value:** Allows local LLMs (Claude Desktop, Cursor) to control the cloud infrastructure directly. You can chat with your business: *"Check inventory and write a promo tweet based on our Q1 strategy."*

### 5. The Agents (Execution Layer)
*   **Location:** `backend/src/agents` (Lambda)
*   **Function:** Autonomous workers.
*   **Capabilities:**
    *   **Researcher:** Scans Reddit/X for trends to validate ideas.
    *   **Poster:** Automates distribution to social platforms upon human approval.

### 6. The Gatekeeper (Access & Auth)
*   **Location:** `infra/lib/auth.ts`, Cognito
*   **Function:** Native "Paywalls" and "Client Portals."
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
*   AWS CLI (configured with `aws configure`)
*   An AWS Account

### 1. Installation
Install dependencies for all workspaces:
```bash
npm install
```

### 2. Infrastructure Deployment
Deploy the serverless stack (DynamoDB, Cognito, API Gateway, Lambdas) to your AWS account.
```bash
cd infra
npx cdk deploy
```
*Note the outputs (API URL, User Pool ID) after deployment.*

### 3. Running Locally

**The Admin Panel:**
```bash
cd admin
# Create .env.local with VITE_API_URL and VITE_USER_POOL_ID from step 2
npm run dev
```

**The Renderer:**
```bash
cd renderer
npm run dev
```

### 4. Connecting Claude (MCP)
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
*   **Validation:** Zod
*   **AI:** Vercel AI SDK, Model Context Protocol (MCP)

---

---

## 🤝 Community & Contributing

AMODX is Open Source. We believe in "Infrastructure as Code" owned by the creator, not the platform.

*   **GitHub:** https://github.com/andreirx/amodx

We welcome contributions! Whether it's a new MCP Tool, a React Component for the Renderer, or a documentation fix.

## 📜 License

Licensed under the **Apache 2.0 License**.
You are free to use, modify, and distribute this software for personal or commercial purposes.