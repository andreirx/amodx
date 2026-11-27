import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";

export function registerReportTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// COMMERCE: REPORTS
// ==========================================

server.tool("get_reports",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/reports/summary`, { headers: getHeaders(tenant_id) });
            const d = response.data;
            const lines = [
                `=== Commerce Reports for ${tenant_id} ===`,
                ``,
                `KPIs:`,
                `  Total Revenue: ${d.kpi?.totalRevenue || 0}`,
                `  Total Orders: ${d.kpi?.totalOrders || 0}`,
                `  Avg Order Value: ${d.kpi?.avgOrderValue || 0}`,
                `  Delivered Revenue: ${d.kpi?.deliveredRevenue || 0}`,
                ``,
                `Orders by Status:`,
                ...(d.byStatus || []).map((s: any) => `  ${s.status}: ${s.count} orders (${s.revenue})`),
                ``,
                `Payment Methods:`,
                ...(d.byPayment || []).map((p: any) => `  ${p.method}: ${p.count} orders (${p.revenue})`),
                ``,
                `Revenue by Month:`,
                ...(d.revenueByMonth || []).map((m: any) => `  ${m.month}: ${m.revenue} (${m.orders} orders)`),
                ``,
                `Top Products:`,
                ...(d.topProducts || []).slice(0, 10).map((p: any) => `  ${p.title}: ${p.quantity} sold (${p.revenue})`),
            ];
            if (d.coupons && d.coupons.length > 0) {
                lines.push(``, `Coupon Usage:`);
                d.coupons.forEach((c: any) => lines.push(`  ${c.code}: ${c.count} uses (${c.discount} discount)`));
            }
            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);
}
