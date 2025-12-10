import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.AMODX_API_KEY;
const API_URL = process.env.AMODX_API_URL;

if (!API_URL || !API_KEY) {
    console.error("Error: AMODX_API_URL or AMODX_API_KEY is missing in .env");
    process.exit(1);
}

// HELPER: Standard Headers
// Injects the API Key (Real Auth) and a Dummy Bearer Token (To satisfy API Gateway checks)
const getHeaders = (tenantId?: string) => {
    const h: any = {
        'x-api-key': API_KEY,
        'Authorization': 'Bearer robot',
    };
    if (tenantId) h['x-tenant-id'] = tenantId;
    return h;
};

// Helper: Markdown to Tiptap Blocks
function textToBlocks(text: string) {
    const lines = text.split('\n').filter(line => line.trim() !== '');
    return lines.map(line => {
        if (line.startsWith('# ')) {
            return { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: line.replace('# ', '') }] };
        }
        if (line.startsWith('## ')) {
            return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: line.replace('## ', '') }] };
        }
        return { type: 'paragraph', content: [{ type: 'text', text: line }] };
    });
}

const server = new McpServer({
    name: "AMODX-Bridge",
    version: "1.2.0",
});

// --- TENANT TOOLS ---

server.tool(
    "list_tenants",
    {},
    async () => {
        try {
            const response = await axios.get(`${API_URL}/tenants`, {
                headers: getHeaders() // No tenant ID needed here
            });
            const summary = response.data.items.map((t: any) =>
                `- ${t.name} (ID: ${t.id}, Domain: ${t.domain})`
            ).join("\n");
            return { content: [{ type: "text", text: `Available Sites:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "create_tenant",
    {
        name: z.string().describe("Name of the new website/client"),
        domain: z.string().optional().describe("Custom domain (optional)"),
    },
    async ({ name, domain }) => {
        try {
            const response = await axios.post(`${API_URL}/tenants`, { name, domain }, {
                headers: getHeaders()
            });
            return { content: [{ type: "text", text: `Success! Created site "${name}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// --- CONTENT TOOLS ---

server.tool(
    "list_content",
    {
        tenant_id: z.string().describe("The Site ID to list content for"),
    },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/content`, {
                headers: getHeaders(tenant_id) // <--- FIXED: Passing tenant_id
            });
            const summary = response.data.items.map((item: any) =>
                `- [${item.status}] ${item.title} (Slug: ${item.slug}, ID: ${item.nodeId})`
            ).join("\n");
            return { content: [{ type: "text", text: `Content for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "create_page",
    {
        tenant_id: z.string(),
        title: z.string(),
        status: z.enum(["Draft", "Published"]).default("Draft"),
    },
    async ({ tenant_id, title, status }) => {
        try {
            const response = await axios.post(`${API_URL}/content`, {
                title,
                status,
                blocks: []
            }, {
                headers: getHeaders(tenant_id) // <--- FIXED
            });
            return { content: [{ type: "text", text: `Created page "${title}" (ID: ${response.data.nodeId})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "read_page",
    {
        tenant_id: z.string(),
        id: z.string().describe("The UUID of the page/content node"),
    },
    async ({ tenant_id, id }) => {
        try {
            const response = await axios.get(`${API_URL}/content/${id}`, {
                headers: getHeaders(tenant_id) // <--- FIXED
            });
            const item = response.data;
            let displayText = `Title: ${item.title}\nSlug: ${item.slug}\n\n`;
            if (item.blocks) {
                displayText += JSON.stringify(item.blocks, null, 2);
            }
            return { content: [{ type: "text", text: displayText }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "update_page",
    {
        tenant_id: z.string(),
        id: z.string(),
        title: z.string().optional(),
        content: z.string().describe("Markdown content to convert to blocks"),
        status: z.enum(["Draft", "Published"]).optional(),
    },
    async ({ tenant_id, id, title, content, status }) => {
        try {
            const blocks = textToBlocks(content);
            const payload: any = { blocks };
            if (title) payload.title = title;
            if (status) payload.status = status;

            await axios.put(`${API_URL}/content/${id}`, payload, {
                headers: getHeaders(tenant_id) // <--- FIXED
            });
            return { content: [{ type: "text", text: `Updated page ${id}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// --- CONTEXT TOOLS (Strategy) ---

server.tool(
    "list_context",
    {
        tenant_id: z.string(),
    },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/context`, {
                headers: getHeaders(tenant_id) // <--- FIXED
            });
            const summary = response.data.items.map((item: any) =>
                `- [${item.type}] ${item.name}: ${item.data.substring(0, 50)}... (ID: ${item.id})`
            ).join("\n");
            return { content: [{ type: "text", text: `Context for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "create_context",
    {
        tenant_id: z.string(),
        type: z.enum(["Strategy", "Persona", "PainPoint", "Offer", "BrandVoice"]),
        name: z.string(),
        data: z.string(),
    },
    async (args) => {
        try {
            const response = await axios.post(`${API_URL}/context`, args, {
                headers: getHeaders(args.tenant_id) // <--- FIXED (Using args.tenant_id)
            });
            return { content: [{ type: "text", text: `Created context "${args.name}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "read_context",
    {
        tenant_id: z.string(),
        id: z.string().describe("The UUID of the context item"),
    },
    async ({ tenant_id, id }) => {
        try {
            const response = await axios.get(`${API_URL}/context/${id}`, {
                headers: getHeaders(tenant_id) // <--- FIXED
            });
            return { content: [{ type: "text", text: `Context Item:\n${JSON.stringify(response.data, null, 2)}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "update_context",
    {
        tenant_id: z.string(),
        id: z.string(),
        name: z.string().optional(),
        data: z.string().optional(),
    },
    async ({ tenant_id, id, name, data }) => {
        try {
            const payload: any = {};
            if (name) payload.name = name;
            if (data) payload.data = data;

            await axios.put(`${API_URL}/context/${id}`, payload, {
                headers: getHeaders(tenant_id) // <--- FIXED
            });
            return { content: [{ type: "text", text: `Updated context ${id}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "get_schema",
    {},
    async () => {
        return {
            content: [{
                type: "text",
                text: `AMODX Schema: 
- Content: Page/Post/Folder
- Context: Strategy/Persona/PainPoint
- Tenant: Site Configuration
Use 'list_tenants' first to find the ID to work with.`
            }],
        };
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("AMODX MCP Server running on Stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
