import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { apiError } from "../tool-helpers.js";

export function registerServiceKeyTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// INTEGRATION (SERVICE) KEYS — SERVICE-ACCOUNT-1
// ==========================================
// Tenant-bound `amx_sk_` keys for external systems. The scope list mirrors `ServiceKeyScope` in
// packages/shared (this server does not depend on @amodx/shared); the backend validates it again.
const SERVICE_KEY_SCOPES = ["catalog:read", "leads:read", "catalog:write"] as const;

const describeServiceKey = (k: any) =>
    `- ${k.name} [${(k.scopes || []).join(", ")}] id: ${k.id} — created ${k.createdAt} by ${k.createdBy}; ` +
    `last used ${k.lastUsedAt || "never"}${k.revokedAt ? `; REVOKED ${k.revokedAt}` : ""}`;

server.tool("service_key_list",
    "List a site's integration (service) keys, newest first, revoked ones included. Shows name, scopes and dates; never the secret.",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/service-keys`, { headers: getHeaders(tenant_id) });
            const items = response.data.items || [];
            const summary = items.map(describeServiceKey).join("\n");
            return { content: [{ type: "text", text: `Service keys for ${tenant_id} (${items.length}):\n${summary || "No service keys."}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("service_key_create",
    "Create an integration (service) key bound to ONE site. Scopes: catalog:read = GET /products, leads:read = GET /leads, " +
    "catalog:write = POST /import/glam-pricelist (replaces a pricelist sheet's products). " +
    "The result carries the secret ONCE — it is not stored and cannot be shown again. The caller then sends " +
    "`x-api-key: <secret>`, `Authorization: Bearer service` and `x-tenant-id: <this site>`.",
    {
        tenant_id: z.string(),
        name: z.string().describe("Human-readable key name, 1-80 characters, e.g. 'glamCRM sync'"),
        scopes: z.array(z.enum(SERVICE_KEY_SCOPES)).describe("One or more scopes, no repeats"),
    },
    async ({ tenant_id, name, scopes }) => {
        try {
            const response = await axios.post(`${API_URL}/service-keys`, { name, scopes }, { headers: getHeaders(tenant_id) });
            const { key, secret } = response.data;
            return { content: [{ type: "text", text:
                `✓ Created service key "${key.name}" (id ${key.id}) for ${tenant_id}, scopes: ${key.scopes.join(", ")}\n\n` +
                `Copy it now — it will not be shown again.\n${secret}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("service_key_revoke",
    "Revoke an integration (service) key. The key stops working on the next request; its record stays listed as revoked. No undo.",
    {
        tenant_id: z.string(),
        key_id: z.string().describe("Key id (from service_key_list)"),
    },
    async ({ tenant_id, key_id }) => {
        try {
            const response = await axios.post(`${API_URL}/service-keys/${encodeURIComponent(key_id)}/revoke`, {}, { headers: getHeaders(tenant_id) });
            const key = response.data.key;
            return { content: [{ type: "text", text: `✓ Revoked service key "${key.name}" (id ${key.id}) at ${key.revokedAt}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);
}
