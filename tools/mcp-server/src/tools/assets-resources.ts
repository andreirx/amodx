import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { apiError } from "../tool-helpers.js";

export function registerAssetResourceTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// LIST ASSETS (Media)
server.tool("list_assets",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/assets`, { headers: getHeaders(tenant_id) });
            const summary = response.data.items.slice(0, 20).map((a: any) =>
                `- [${a.fileType}] ${a.fileName}: ${a.publicUrl}`
            ).join("\n");
            return { content: [{ type: "text", text: `Recent Assets (Top 20) for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// PRIVATE RESOURCES (gated downloads: leadMagnet blocks, digital products)
server.tool("list_resources",
    "List the tenant's private files (resources). Use a resource ID in a leadMagnet block or as a product's resource_id.",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/resources/list`, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((r: any) =>
                `- ${r.fileName} (ID: ${r.id}) uploaded ${r.createdAt}`
            ).join("\n");
            return { content: [{ type: "text", text: `Private resources for ${tenant_id}:\n${summary || "No resources found."}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("resource_download_url",
    "Get a presigned download URL for a private resource. The URL expires after 5 minutes.",
    {
        tenant_id: z.string(),
        resource_id: z.string().describe("Resource ID (from list_resources)"),
    },
    async ({ tenant_id, resource_id }) => {
        try {
            const response = await axios.get(`${API_URL}/resources/${resource_id}/download`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `Download URL (expires in 5 minutes):\n${response.data.downloadUrl}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("resource_upload_url",
    "Step 1 of a private-file upload: get a presigned S3 PUT URL (expires after 5 minutes) and the new resource ID. " +
    "Step 2 (outside this server): HTTP PUT the file bytes to that URL with the SAME Content-Type header. " +
    "The resource record is created now, before the upload; if step 2 never happens the record points at a missing file.",
    {
        tenant_id: z.string(),
        filename: z.string().describe("File name, e.g. 'seo-guide.pdf'"),
        content_type: z.string().describe("MIME type, e.g. 'application/pdf'. The PUT must send exactly this Content-Type."),
    },
    async ({ tenant_id, filename, content_type }) => {
        try {
            const response = await axios.post(`${API_URL}/resources/upload`,
                { filename, contentType: content_type },
                { headers: getHeaders(tenant_id) });
            return {
                content: [{
                    type: "text",
                    text: `Resource ID: ${response.data.resourceId}\nPUT the file (Content-Type: ${content_type}) within 5 minutes to:\n${response.data.uploadUrl}`
                }]
            };
        } catch (error: any) {
            return apiError(error);
        }
    }
);
}
