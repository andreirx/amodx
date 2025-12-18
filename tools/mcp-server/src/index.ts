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
const getHeaders = (tenantId?: string) => {
    const h: any = {
        'x-api-key': API_KEY,
        'Authorization': 'Bearer robot',
    };
    if (tenantId) h['x-tenant-id'] = tenantId;
    return h;
};

// --- BLOCK DEFINITIONS FOR AI ---
// We keep a lightweight definition here so the AI knows how to construct them
const BLOCK_SCHEMAS = {
    hero: {
        description: "A large banner with headline, subheadline, and call to action.",
        attrs: {
            headline: "string",
            subheadline: "string",
            ctaText: "string",
            ctaLink: "string (/contact)",
            style: "center | split | minimal",
            imageSrc: "string (url)"
        }
    },
    pricing: {
        description: "A grid of pricing plans.",
        attrs: {
            headline: "string",
            subheadline: "string",
            plans: [{
                id: "string (uuid)",
                title: "string",
                price: "string",
                interval: "mo | yr",
                features: "string (newline separated)",
                buttonText: "string",
                highlight: "boolean"
            }]
        }
    },
    image: {
        description: "A standard image with caption.",
        attrs: {
            src: "string (url)",
            alt: "string",
            caption: "string",
            width: "full | wide | centered"
        }
    },
    contact: {
        description: "A contact form that emails the tenant.",
        attrs: {
            headline: "string",
            description: "string",
            buttonText: "string",
            successMessage: "string",
            tags: "string (crm tags)"
        }
    },
    paragraph: {
        description: "Standard text.",
        content: "string (text)"
    },
    heading: {
        description: "Section title.",
        attrs: { level: "number (1-3)" },
        content: "string (text)"
    }
};

const server = new McpServer({
    name: "AMODX-Bridge",
    version: "2.0.0",
});

// ==========================================
// 1. SITE & TENANT MANAGEMENT
// ==========================================

server.tool("list_tenants", {}, async () => {
    try {
        const response = await axios.get(`${API_URL}/tenants`, { headers: getHeaders() });
        const summary = response.data.items.map((t: any) =>
            `- ${t.name} (ID: ${t.id}, Domain: ${t.domain})`
        ).join("\n");
        return { content: [{ type: "text", text: `Available Sites:\n${summary}` }] };
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
});

server.tool("create_tenant",
    {
        name: z.string().describe("Name of the new website/client"),
        domain: z.string().optional().describe("Custom domain (optional)"),
    },
    async ({ name, domain }) => {
        try {
            const response = await axios.post(`${API_URL}/tenants`, { name, domain }, { headers: getHeaders() });
            return { content: [{ type: "text", text: `Success! Created site "${name}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// 2. STRATEGY & CONTEXT (Refactored)
// ==========================================

server.tool("list_context",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/context`, { headers: getHeaders(tenant_id) });
            // FIXED: Using new Schema (title, tags, blocks)
            const summary = response.data.items.map((item: any) => {
                const tags = item.tags && item.tags.length > 0 ? `[${item.tags.join(', ')}] ` : '';
                // Try to preview block text
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
            // Simple text-to-block conversion for creation
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

// ==========================================
// 3. CONTENT & BLOCKS (The Core)
// ==========================================

server.tool("list_content",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/content`, { headers: getHeaders(tenant_id) });
            const summary = response.data.items.map((item: any) =>
                `- [${item.status}] ${item.title} (Slug: ${item.slug}, ID: ${item.nodeId})`
            ).join("\n");
            return { content: [{ type: "text", text: `Pages for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("get_block_schemas", {}, async () => {
    return {
        content: [{
            type: "text",
            text: `Available UI Blocks and their JSON structure:\n${JSON.stringify(BLOCK_SCHEMAS, null, 2)}`
        }]
    };
});

server.tool("add_block",
    {
        tenant_id: z.string(),
        page_id: z.string(),
        type: z.enum(["hero", "pricing", "contact", "image", "paragraph", "heading"]),
        attrs: z.string().describe("JSON string of attributes matching get_block_schemas"),
        content_text: z.string().optional().describe("For text blocks, the text content"),
    },
    async ({ tenant_id, page_id, type, attrs, content_text }) => {
        try {
            // 1. Fetch current page
            const getRes = await axios.get(`${API_URL}/content/${page_id}`, { headers: getHeaders(tenant_id) });
            const page = getRes.data;

            // 2. Construct new block
            let newBlock: any = { type };
            if (attrs) {
                try {
                    newBlock.attrs = JSON.parse(attrs);
                } catch (e) {
                    return { content: [{ type: "text", text: "Error: attrs must be valid JSON string" }], isError: true };
                }
            }
            if (content_text) {
                newBlock.content = [{ type: "text", text: content_text }];
            }

            // 3. Append
            const newBlocks = [...(page.blocks || []), newBlock];

            // 4. Save
            await axios.put(`${API_URL}/content/${page_id}`, { blocks: newBlocks }, {
                headers: getHeaders(tenant_id)
            });

            return { content: [{ type: "text", text: `Added ${type} block to page "${page.title}".` }] };

        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("create_page",
    {
        tenant_id: z.string(),
        title: z.string(),
        slug: z.string().optional(),
    },
    async ({ tenant_id, title, slug }) => {
        try {
            const payload: any = { title, status: "Draft", blocks: [] };
            if (slug) payload.slug = slug;

            const response = await axios.post(`${API_URL}/content`, payload, {
                headers: getHeaders(tenant_id)
            });
            return { content: [{ type: "text", text: `Created page "${title}" (ID: ${response.data.nodeId})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// Standard get_schema for context
server.tool("get_schema", {}, async () => {
    return {
        content: [{
            type: "text",
            text: `AMODX Core Entities:
- Tenant: A client website.
- Content: Pages containing Blocks (Hero, Pricing, etc).
- Context: Strategic documents with Tags.

To build a page:
1. 'list_content' to find page ID.
2. 'get_block_schemas' to see available UI components.
3. 'add_block' to append a component.`
        }],
    };
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("AMODX MCP Server running on Stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
