import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";

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

// Tool 1: List Content
server.tool(
    "list_content",
    {},
    async () => {
        try {
            const response = await axios.get(`${API_URL}/content`);
            // Format for Claude
            const summary = response.data.items.map((item: any) =>
                `- [${item.status}] ${item.title} (ID: ${item.id})`
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
                content: [{ type: "text", text: `Success! Created page "${title}" (ID: ${response.data.id})` }],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error creating page: ${error.message}` }],
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
