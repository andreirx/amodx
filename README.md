# AMODX: The Agency Operating System

> **Turn your agency into a software company.**

AMODX (Agency Management On Demand Extreme) is a **Serverless Command Center** that allows you to manage hundreds of client sites, generate high-fidelity content via AI, and control access gates (paywalls/logins) from **one single dashboard**.

It replaces the "Frankenstein Stack" (WordPress + MemberPress + Zapier + ChatGPT) with a purpose-built **Growth Engine**.

**One Deployment = One Agency.** You manage infinite client sites ("Tenants") from a single dashboard.

---

## ⚡ Why AMODX?

### 1. Chat with your Business (The AI Bridge)
This is the killer feature. Because AMODX runs on an open protocol (MCP), you can connect **Claude Desktop** directly to your agency's infrastructure.

*   **Don't click buttons.** Just type: *"Create a new site for Dr. Smith, apply the 'Blue Medical' theme, and write a landing page based on our Dental Implants Strategy."*
*   **Context-Aware.** The AI knows your strategy, personas, and brand voice. It doesn't write generic fluff; it writes *your* content.

### 2. Infinite Scale, Zero Gunk
*   **No Servers:** We use AWS Serverless. You pay only for what you use. No idle costs.
*   **No Maintenance:** No plugins to update. No PHP versions to manage. No security patches for 50 different WordPress installs.
*   **Instant Publishing:** Changes go live instantly globally via our warm-cache architecture.

### 3. SEO Native
*   **Performance:** Sites score 100/100 on Core Web Vitals because they are pre-rendered static HTML.
*   **AI Ready:** Automatically generates `/llms.txt` so AI Search Engines (Perplexity, SearchGPT) rank your clients higher.

---

## 🚀 Getting Started

**Prerequisites:** An AWS Account.

### 1. Deploy Your Infrastructure
You don't need to be a cloud architect. Run one command to provision your entire agency backend (Database, API, Hosting).

```bash
cd amodx/infra
npx cdk deploy
```

*The terminal will output your **Admin URL**. Save this.*

### 2. Access Your Command Center
1.  Open the **Admin URL**.
2.  Log in with the credentials created in AWS Cognito.
3.  **Create your first Client Site** via the Sidebar or the AI Assistant.

### 3. Connect Your AI (Claude)
To enable the "Chat with your Business" feature:

1.  Ensure you have [Claude Desktop](https://claude.ai/download) installed.
2.  Run the setup script:
    ```bash
    cd amodx/tools/mcp-server
    npm run build
    npm run setup <YOUR_API_GATEWAY_URL>
    ```
3.  Restart Claude. You will see the `amodx` tools enabled.

### 4. Go Live
To launch a client site:
1.  Go to **Settings** in your Admin Panel.
2.  Copy the **Production Domain** (CloudFront URL).
3.  Add a `CNAME` record in your client's DNS (e.g., `www.client.com` -> `d123.cloudfront.net`).

---

## 📜 License

Licensed under the **Apache 2.0 License**.
You are free to use, modify, and distribute this software for personal or commercial purposes.
