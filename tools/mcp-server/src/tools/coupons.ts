import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";

export function registerCouponTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// COMMERCE: COUPONS
// ==========================================

server.tool("list_coupons",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/coupons`, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((c: any) =>
                `- ${c.code} (${c.type === "percent" ? c.value + "%" : c.value + " off"}) [${c.active ? "Active" : "Inactive"}] Used: ${c.usageCount || 0}/${c.usageLimit || "∞"} ID: ${c.id}`
            ).join("\n");
            return { content: [{ type: "text", text: `Coupons for ${tenant_id}:\n${summary || "No coupons found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("create_coupon",
    {
        tenant_id: z.string(),
        code: z.string().describe("Coupon code customers will enter (e.g., 'SUMMER20')"),
        type: z.enum(["percent", "fixed"]).describe("Discount type"),
        value: z.number().describe("Discount value (percentage or fixed amount)"),
        min_order: z.number().optional().describe("Minimum order value required"),
        usage_limit: z.number().optional().describe("Max total uses (omit for unlimited)"),
        expires_at: z.string().optional().describe("Expiry date in ISO format (e.g., '2025-12-31')"),
    },
    async ({ tenant_id, code, type, value, min_order, usage_limit, expires_at }) => {
        try {
            const payload: any = { code: code.toUpperCase(), type, value, active: true };
            if (min_order !== undefined) payload.minOrder = min_order;
            if (usage_limit !== undefined) payload.usageLimit = usage_limit;
            if (expires_at) payload.expiresAt = expires_at;
            const response = await axios.post(`${API_URL}/coupons`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Created coupon "${code}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);
}
