import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";

export function registerCommentTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// LIST COMMENTS (Admin View)
server.tool("list_comments",
    {
        tenant_id: z.string(),
        page_id: z.string().optional().describe("Optional: Filter by specific page node ID")
    },
    async ({ tenant_id, page_id }) => {
        try {
            const url = page_id
                ? `${API_URL}/comments?pageId=${page_id}`
                : `${API_URL}/comments`; // Backend now supports listing all if no pageId provided

            const response = await axios.get(url, { headers: getHeaders(tenant_id) });

            const summary = response.data.items.map((c: any) =>
                `[${c.status}] ${c.authorName} (${c.authorEmail}): "${c.content.substring(0, 50)}..." (Date: ${c.createdAt})`
            ).join("\n");

            if (!summary) return { content: [{ type: "text", text: "No comments found." }] };

            return { content: [{ type: "text", text: `Comments for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// MODERATE COMMENT
server.tool("moderate_comment",
    {
        tenant_id: z.string(),
        page_id: z.string().describe("The Page ID belonging to the comment"),
        created_at: z.string().describe("The exact ISO timestamp of the comment (acts as ID)"),
        action: z.enum(["UPDATE_STATUS", "DELETE"]),
        status: z.enum(["Approved", "Pending", "Spam", "Hidden"]).optional().describe("Required if action is UPDATE_STATUS")
    },
    async ({ tenant_id, page_id, created_at, action, status }) => {
        try {
            const payload = {
                pageId: page_id,
                createdAt: created_at,
                action,
                status
            };

            await axios.put(`${API_URL}/comments`, payload, {
                headers: getHeaders(tenant_id)
            });

            return { content: [{ type: "text", text: `✓ Comment moderated: ${action} ${status ? `-> ${status}` : ''}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);
}
