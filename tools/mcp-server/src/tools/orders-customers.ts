import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";

export function registerOrderCustomerTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// COMMERCE: ORDERS
// ==========================================

server.tool("list_orders",
    {
        tenant_id: z.string(),
        status: z.string().optional().describe("Filter by status: placed, confirmed, prepared, shipped, delivered, cancelled, annulled"),
    },
    async ({ tenant_id, status }) => {
        try {
            const url = status ? `${API_URL}/orders?status=${status}` : `${API_URL}/orders`;
            const response = await axios.get(url, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((o: any) =>
                `- ${o.orderNumber} [${o.status}] ${o.customerName} — ${o.total} ${o.currency} (${o.itemCount} items) ${o.createdAt}`
            ).join("\n");
            return { content: [{ type: "text", text: `Orders for ${tenant_id}:\n${summary || "No orders found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("get_order",
    {
        tenant_id: z.string(),
        order_id: z.string().describe("Order ID (from list_orders)"),
    },
    async ({ tenant_id, order_id }) => {
        try {
            const response = await axios.get(`${API_URL}/orders/${order_id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("update_order_status",
    {
        tenant_id: z.string(),
        order_id: z.string(),
        status: z.enum(["placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled"]),
        tracking_number: z.string().optional().describe("Courier tracking number (typically added when shipping)"),
        note: z.string().optional().describe("Internal note about the status change"),
    },
    async ({ tenant_id, order_id, status, tracking_number, note }) => {
        try {
            const payload: any = { status };
            if (tracking_number) payload.trackingNumber = tracking_number;
            if (note) payload.note = note;
            await axios.put(`${API_URL}/orders/${order_id}/status`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Order ${order_id} status updated to "${status}"` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// COMMERCE: CUSTOMERS
// ==========================================

server.tool("list_customers",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/customers`, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((c: any) =>
                `- ${c.name} (${c.email}) — ${c.orderCount || 0} orders, Total: ${c.totalSpent || 0} ${c.currency || ""}`
            ).join("\n");
            return { content: [{ type: "text", text: `Customers for ${tenant_id}:\n${summary || "No customers found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("get_customer",
    {
        tenant_id: z.string(),
        customer_id: z.string().describe("Customer ID (email-based, from list_customers)"),
    },
    async ({ tenant_id, customer_id }) => {
        try {
            const response = await axios.get(`${API_URL}/customers/${customer_id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);
}
