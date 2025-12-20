# AMODX Backend (The Brain)

A collection of **Node.js 22 Lambdas** running behind an HTTP API Gateway.

## 🔐 Security: The Gatekeeper

All requests pass through the **Authorizer Lambda** (`src/auth/authorizer.ts`).

1.  **Robots (MCP/Renderer):** Checks `x-api-key` against Secrets Manager.
2.  **Humans (Admin):** Checks `Authorization` JWT against Cognito.
3.  **Public:** Whitelists specific routes (`POST /leads`, `POST /contact`).

## ⚡ Event-Driven Architecture

We do not block the user for heavy tasks (Audit logging, Webhooks).
1.  **API Lambda:** Writes to DB -> Calls `publishAudit`.
2.  **EventBridge:** Receives event -> Routes to `AuditWorker`.
3.  **Worker:** Writes `AUDIT#` record to DynamoDB.

## 💾 Database (Single Table Design)

**Partition Key:** `PK` | **Sort Key:** `SK`

| Entity | PK | SK | Notes |
| :--- | :--- | :--- | :--- |
| **Tenant Config** | `SYSTEM` | `TENANT#<id>` | Settings, Theme |
| **Content** | `TENANT#<id>` | `CONTENT#<uuid>#LATEST` | Pages, Blocks |
| **Route** | `TENANT#<id>` | `ROUTE#<slug>` | Mapping for Renderer |
| **Asset** | `TENANT#<id>` | `ASSET#<uuid>` | Public Images |
| **Resource** | `TENANT#<id>` | `RESOURCE#<uuid>` | Private Files |
| **Lead** | `TENANT#<id>` | `LEAD#<email>` | Form submissions |
