import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { createTenantBody } from "../tool-shapes.js";

export function registerTenantTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// 1. SITE & TENANT MANAGEMENT
// ==========================================

server.tool("list_tenants", {}, async () => {
    try {
        const response = await axios.get(`${API_URL}/tenants`, { headers: getHeaders() });
        const summary = response.data.items.map((t: any) =>
            `- ${t.name} (ID: ${t.id}, Domain: ${t.domain})`
        ).join("\n");
        return { content: [{ type: "text", text: `Available Sites:\n${summary}` }] };
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
});

server.tool("create_tenant",
    {
        name: z.string().describe("Name of the new website/client"),
        domain: z.string().optional().describe("Custom domain (optional)"),
        catalog_mode: z.boolean().optional().describe("Create a catalog site: products are shown without prices, stock or ordering. Fixed at creation — it cannot be changed later."),
    },
    async ({ name, domain, catalog_mode }) => {
        try {
            const response = await axios.post(`${API_URL}/tenants`, createTenantBody({ name, domain, catalog_mode }), { headers: getHeaders() });
            return { content: [{ type: "text", text: `Success! Created site "${name}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);
}
