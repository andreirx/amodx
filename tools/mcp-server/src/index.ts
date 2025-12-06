import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";

// --- HELPER: Markdown-ish to Tiptap JSON ---
// Claude gives us text. We wrap it in paragraph blocks.
function textToBlocks(text: string) {
    const lines = text.split('\n').filter(line => line.trim() !== '');
    return lines.map(line => {
        // Simple detection for Headings (Markdown style)
        if (line.startsWith('# ')) {
            return { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: line.replace('# ', '') }] };
        }
        if (line.startsWith('## ')) {
            return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: line.replace('## ', '') }] };
        }
        // Default to paragraph
        return { type: 'paragraph', content: [{ type: 'text', text: line }] };
    });
}

// Load environment variables from a local .env file (if running standalone)
dotenv.config();

// 1. Get Config from Environment
const API_URL = process.env.AMODX_API_URL;

if (!API_URL) {
    console.error("Error: AMODX_API_URL environment variable is missing.");
    process.exit(1);
}

// Create the server instance
const server = new McpServer({
    name: "AMODX-Bridge",
    version: "1.0.0",
});

server.tool(
    "get_schema",
    {},
    async () => {
        return {
            content: [{
                type: "text",
                text: `
CORE DATA MODEL:

1. ContentItem (Pages/Posts):
   - id (UUID), nodeId (Permanent), title, status (Draft/Published)
   - blocks: JSON Array (Tiptap format)

2. ContextItem (Strategy/Persona):
   - id, type (Strategy|Persona|PainPoint), name, data (Text)

3. WorkItem (Tasks):
   - id, type (SocialPost|Research), status (Draft/Pending/Approved)
        `
            }],
        };
    }
);

// Tool 1: List Content
server.tool(
    "list_content",
    {},
    async () => {
        try {
            const response = await axios.get(`${API_URL}/content`);
            // Format for Claude
            const summary = response.data.items.map((item: any) =>
                `- [${item.status}] ${item.title} (ID: ${item.nodeId})`
            ).join("\n");

            return {
                content: [{ type: "text", text: `Current Content:\n${summary}` }],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error: ${error.message}` }],
                isError: true,
            };
        }
    }
);

// Tool 2: Create Page
server.tool(
    "create_page",
    {
        title: z.string(),
        status: z.enum(["Draft", "Published"]).default("Draft"),
    },
    async ({ title, status }) => {
        try {
            const response = await axios.post(`${API_URL}/content`, {
                title,
                status,
                blocks: [] // Empty content for now
            });

            return {
                content: [{ type: "text", text: `Success! Created page "${title}" (ID: ${response.data.nodeId})` }],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error creating page: ${error.message}` }],
                isError: true,
            };
        }
    }
);

// Tool 3: Update Page Content
server.tool(
    "update_page",
    {
        id: z.string().describe("The UUID of the page/content to update"),
        title: z.string().optional(),
        content: z.string().describe("The content to write (Markdown style supported)"),
        status: z.enum(["Draft", "Published"]).optional(),
    },
    async ({ id, title, content, status }) => {
        try {
            // 1. Convert text to Tiptap JSON blocks
            const blocks = textToBlocks(content);

            // 2. Call the API
            // Note: We need to fetch the current title if not provided,
            // but for MVP we might just require it or send partial updates if backend supports it.
            // Our backend 'update.ts' supports partial updates!

            const payload: any = { blocks };
            if (title) payload.title = title;
            if (status) payload.status = status;

            await axios.put(`${API_URL}/content/${id}`, payload);

            return {
                content: [{ type: "text", text: `Success! Updated page ${id}.` }],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error updating page: ${error.message}` }],
                isError: true,
            };
        }
    }
);


// Start the server via Stdio (Standard Input/Output)
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("AMODX MCP Server running on Stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
