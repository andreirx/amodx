import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";

export function registerBulkPriceTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// COMMERCE: BULK PRICE ADJUSTMENT
// ==========================================

server.tool("bulk_price_adjust",
    {
        tenant_id: z.string(),
        percent: z.number().describe("Percentage change (e.g., 10 for +10%, -5 for -5%)"),
        category_id: z.string().optional().describe("Category ID to scope adjustment (omit for all products)"),
        round_to: z.number().optional().describe("Rounding: 0=none, 5=nearest 5, 9=ending in 9, 0.99=ending in .99"),
        apply_to_sale_price: z.boolean().optional().describe("Also adjust sale prices (default false)"),
        dry_run: z.boolean().optional().describe("Preview changes without applying (default true)"),
    },
    async ({ tenant_id, percent, category_id, round_to, apply_to_sale_price, dry_run }) => {
        try {
            const payload: any = { percent, dryRun: dry_run !== false };
            if (category_id) payload.categoryId = category_id;
            if (round_to !== undefined) payload.roundTo = round_to;
            if (apply_to_sale_price !== undefined) payload.applyToSalePrice = apply_to_sale_price;
            const response = await axios.post(`${API_URL}/products/bulk-price`, payload, { headers: getHeaders(tenant_id) });
            const d = response.data;
            if (d.preview) {
                const lines = [`Price Preview (${d.count} products):\n`];
                d.preview.slice(0, 20).forEach((p: any) => {
                    let line = `  ${p.title}: ${p.oldPrice} → ${p.newPrice} ${p.currency}`;
                    if (p.oldSalePrice) line += ` (sale: ${p.oldSalePrice} → ${p.newSalePrice})`;
                    lines.push(line);
                });
                if (d.count > 20) lines.push(`  ... and ${d.count - 20} more`);
                lines.push(`\nTo apply, call again with dry_run=false`);
                return { content: [{ type: "text", text: lines.join("\n") }] };
            }
            return { content: [{ type: "text", text: `✓ ${d.message}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);
}
