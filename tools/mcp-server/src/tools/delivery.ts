import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";

export function registerDeliveryTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// COMMERCE: DELIVERY
// ==========================================

server.tool("get_delivery_config",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/delivery`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("update_delivery_config",
    {
        tenant_id: z.string(),
        config: z.string().describe("JSON string of delivery config fields to update. Fields: freeDeliveryThreshold, deliveryFee, leadDays, weekDaysOff (array of 0-6), blockedDates, yearlyOffDays, unblockedDates, minOrder"),
    },
    async ({ tenant_id, config }) => {
        try {
            const payload = JSON.parse(config);
            await axios.put(`${API_URL}/delivery`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Delivery config updated` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);
}
