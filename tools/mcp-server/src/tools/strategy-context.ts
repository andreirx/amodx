import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { apiError, parseJsonInput } from "../tool-helpers.js";

export function registerStrategyContextTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// 2. STRATEGY & CONTEXT
// ==========================================

server.tool("list_context",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/context`, { headers: getHeaders(tenant_id) });
            const summary = response.data.items.map((item: any) => {
                const tags = item.tags && item.tags.length > 0 ? `[${item.tags.join(', ')}] ` : '';
                let snippet = "No content";
                if (item.blocks && item.blocks.length > 0) {
                    const firstBlock = item.blocks[0];
                    if (firstBlock.content && firstBlock.content[0]) {
                        snippet = firstBlock.content[0].text || "Complex Block";
                    } else {
                        snippet = firstBlock.type;
                    }
                }
                return `- ${tags}${item.title} (ID: ${item.id}): ${snippet}...`;
            }).join("\n");
            return { content: [{ type: "text", text: `Context Documents for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("create_context",
    {
        tenant_id: z.string(),
        title: z.string(),
        tags: z.string().describe("Comma separated tags (e.g. 'Persona, Q1')"),
        content: z.string().describe("Initial text content"),
    },
    async ({ tenant_id, title, tags, content }) => {
        try {
            const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: content }] }];
            const tagArray = tags.split(',').map(t => t.trim());

            const response = await axios.post(`${API_URL}/context`, { title, tags: tagArray, blocks }, {
                headers: getHeaders(tenant_id)
            });
            return { content: [{ type: "text", text: `Created context doc "${title}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("read_context",
    { tenant_id: z.string(), id: z.string() },
    async ({ tenant_id, id }) => {
        try {
            const response = await axios.get(`${API_URL}/context/${id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("update_context",
    "Update a context (strategy) document. Omitted fields keep their stored value. `blocks` REPLACES the whole block array — read_context first.",
    {
        tenant_id: z.string(),
        id: z.string().describe("Context document ID (from list_context)"),
        title: z.string().optional(),
        tags: z.string().optional().describe("Comma separated tags. REPLACES the stored tags."),
        blocks: z.string().optional().describe("Full JSON array of blocks. REPLACES the stored blocks. Plain text: [{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"...\"}]}]"),
    },
    async ({ tenant_id, id, title, tags, blocks }) => {
        try {
            const payload: any = {};
            if (title) payload.title = title;
            if (tags !== undefined) payload.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
            if (blocks) {
                const parsed = parseJsonInput(blocks, "array", "blocks");
                if (!parsed.ok) return parsed.result;
                payload.blocks = parsed.value;
            }
            await axios.put(`${API_URL}/context/${id}`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Updated context doc ${id}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("delete_context",
    "Permanently delete a context (strategy) document. No undo, no version history.",
    {
        tenant_id: z.string(),
        id: z.string().describe("Context document ID (from list_context)"),
    },
    async ({ tenant_id, id }) => {
        try {
            await axios.delete(`${API_URL}/context/${id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Deleted context doc ${id}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);
}
