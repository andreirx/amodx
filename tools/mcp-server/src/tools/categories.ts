import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { createCategoryBody } from "../tool-shapes.js";
import { parseJsonInput } from "../tool-helpers.js";

export function registerCategoryTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// COMMERCE: CATEGORIES
// ==========================================

server.tool("list_categories",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/categories`, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((c: any) =>
                `- ${c.title} (ID: ${c.id}, Slug: ${c.slug}, Products: ${c.productCount || 0})`
            ).join("\n");
            return { content: [{ type: "text", text: `Categories for ${tenant_id}:\n${summary || "No categories found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("create_category",
    {
        tenant_id: z.string(),
        title: z.string(),
        slug: z.string().optional().describe("URL-friendly slug (auto-generated if omitted)"),
        description: z.string().optional(),
        image_link: z.string().optional().describe("Category image URL"),
        parent_id: z.string().optional().describe("Parent category ID for nested categories"),
        sort_order: z.number().optional().describe("Sort order (lower = first)"),
        blocks: z.string().optional().describe("Page content: a JSON array of blocks, shown on the category page after the title and before the product list (the same blocks as a page; see get_block_schemas)"),
    },
    async ({ tenant_id, title, slug, description, image_link, parent_id, sort_order, blocks }) => {
        try {
            let parsedBlocks: unknown[] | undefined;
            if (blocks) {
                const parsed = parseJsonInput(blocks, "array", "blocks");
                if (!parsed.ok) return parsed.result;
                parsedBlocks = parsed.value;
            }
            const payload = createCategoryBody({ title, slug, description, image_link, parent_id, sort_order }, parsedBlocks);
            const response = await axios.post(`${API_URL}/categories`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Created category "${title}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);
}
