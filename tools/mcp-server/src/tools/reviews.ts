import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";

export function registerReviewTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// COMMERCE: REVIEWS
// ==========================================

server.tool("list_reviews",
    {
        tenant_id: z.string(),
        product_id: z.string().optional().describe("Filter reviews by product ID"),
    },
    async ({ tenant_id, product_id }) => {
        try {
            const url = product_id ? `${API_URL}/reviews?productId=${product_id}` : `${API_URL}/reviews`;
            const response = await axios.get(url, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((r: any) =>
                `- [${r.status}] ${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)} ${r.authorName}: "${(r.content || "").substring(0, 80)}" (Product: ${r.productId})`
            ).join("\n");
            return { content: [{ type: "text", text: `Reviews for ${tenant_id}:\n${summary || "No reviews found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("moderate_review",
    {
        tenant_id: z.string(),
        review_id: z.string(),
        product_id: z.string().describe("Product ID the review belongs to"),
        status: z.enum(["approved", "rejected", "pending"]),
    },
    async ({ tenant_id, review_id, product_id, status }) => {
        try {
            await axios.put(`${API_URL}/reviews/${review_id}`, { productId: product_id, status }, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Review ${review_id} status updated to "${status}"` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);
}
