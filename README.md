# AMODX: The Agency Operating System

> **Turn your agency into a software company.**

AMODX is a **Serverless Command Center** that allows you to manage hundreds of client sites, generate high-fidelity content via AI, and control access gates (paywalls/logins) from **one single dashboard**.

**One Deployment = One Agency.** You manage infinite client sites ("Tenants") from a single dashboard.

---

## ⚡ The Philosophy: "The Notion for Agencies"

Most agencies are stuck in "Implementation Gunk" - managing plugins, fixing CSS, and updating PHP.
AMODX changes the game:

1.  **Don't Paint Pixels, Stack Blocks:**
    *   We don't use a drag-and-drop builder (like Elementor) that breaks.
    *   We use a **Structured Block Engine**. You assemble high-converting components (Heroes, Pricing Tables, Lead Forms).
    *   The system renders them perfectly, every time, with 100/100 Lighthouse scores.

2.  **Chat with your Business:**
    *   AMODX exposes your entire infrastructure to AI via the **Model Context Protocol (MCP)**.
    *   Use Claude Desktop to: *"Create a new site for Dr. Smith, apply the Blue Medical theme, and generate a landing page based on our Dental Implants Strategy."*

3.  **Zero Maintenance:**
    *   No Servers. No Plugins. No Security Patches.
    *   Runs on AWS Serverless (Lambda + DynamoDB). You pay only for what you use.

---

## 🚀 Getting Started

### 1. Setup Your Environment
If this is your first time using AWS tools, read the **[Installation Guide](INSTALL.md)**.

### 2. Deploy Your Infrastructure
Run one command to provision your entire agency backend.

```bash
npm install
cd infra
npx cdk deploy
```

*The terminal will output your **Admin URL**. Save this.*

### 3. Access Your Command Center
1.  Open the **Admin URL**.
2.  Log in (First user created via AWS Console).
3.  **Create your first Client Site** via the Sidebar.

### 4. Connect Your AI (Claude)
To enable the AI capabilities:
1.  Get your Master API Key from AWS Secrets Manager (created during deploy).
2.  Run the setup script:
    ```bash
    cd tools/mcp-server
    npm run build
    npm run setup <YOUR_API_GATEWAY_URL>
    ```

---

## 🤝 The Founder's Circle

AMODX is Open Source (Apache 2.0). You can clone it and run it forever for free.

However, building a business alone is hard. We offer the **Founder's Circle** membership for Agency Owners who want:
1.  **The Network:** Access to a private community of technical agency owners.
2.  **The Influence:** Direct input on the roadmap (e.g., "We need a Real Estate module").
3.  **The Assets:** Sales decks, contracts, and deployment scripts to sell this stack to your clients.

*Link coming soon.*

---

## 📜 License

Licensed under the **Apache 2.0 License**.
