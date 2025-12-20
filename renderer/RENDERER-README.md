# AMODX Renderer (Public Engine)

The Renderer is a **Next.js 16 (OpenNext)** application responsible for serving all tenant sites from a single deployment.

## 🏗 Architecture

### 1. Multi-Tenant Routing (Middleware)
We do not use wildcard domains in Next.js config. We use **Edge Middleware** (`middleware.ts`).
1.  **Incoming Request:** `https://client.com/about`
2.  **Lookup:** Middleware extracts hostname.
3.  **Rewrite:** Rewrites request to internal path: `/_site/[tenantId]/about`.
4.  **Result:** The Page Component receives `params.siteId` = `tenantId`.

### 2. Incremental Static Regeneration (Warm Cache)
*   **Default:** Pages are cached for 1 hour (`revalidate = 3600`).
*   **On-Demand:** When Admin saves content, Backend triggers `/api/revalidate`.
*   **Result:** 0ms start time for visitors.

### 3. Authentication & Actors

The Renderer acts as the **Trusted Proxy** between the Public Internet and the Secure Backend.

| Actor | Interface | Auth Method | Headers Sent to Backend |
| :--- | :--- | :--- | :--- |
| **Tenant Visitor** | Browser | Public / NextAuth | `x-tenant-id: <ID>` (Injected) |
| **Renderer (Server)** | API Route | Master Key | `x-api-key: <SECRET>`, `Authorization: Bearer robot` |

### 4. Global Context
To avoid prop-drilling Tenant IDs into every interactive component (like Forms), we inject it globally at build time.
*   **Source:** `src/components/ThemeInjector.tsx`
*   **Variable:** `window.AMODX_TENANT_ID`

---

## 🔐 Identity (NextAuth.js)

We use a **Dynamic Provider** strategy.
*   **Route:** `src/app/api/auth/[...nextauth]/route.ts`
*   **Logic:**
    1.  User clicks "Login with Google".
    2.  Handler looks up `TenantConfig` from DynamoDB.
    3.  Initializes Google Provider with **Tenant's Specific Client ID**.
    4.  Session is scoped to that domain.

---

## 🛠 SEO Engine

*   `robots.txt`: Dynamically generated based on `TenantConfig.status`.
*   `sitemap.xml`: XML generated from `GET /content` (Published pages only).
*   `llms.txt`: Markdown summary of the site for AI Agents/Crawlers.
