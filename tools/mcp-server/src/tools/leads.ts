import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { apiError, parseJsonInput } from "../tool-helpers.js";

export function registerLeadTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// LEADS
// ==========================================

server.tool("list_leads",
    "List captured leads (emails captured through the public lead route, e.g. leadMagnet blocks), newest first.",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/leads`, { headers: getHeaders(tenant_id) });
            const items = response.data.items || [];
            const summary = items.map((l: any) =>
                `- ${l.email}${l.name ? ` (${l.name})` : ""} [${l.status}] source: ${l.source || "-"} — ${l.createdAt}`
            ).join("\n");
            return { content: [{ type: "text", text: `Leads for ${tenant_id} (${items.length}):\n${summary || "No leads found."}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("create_lead",
    "Add a lead. The lead is stored under its normalized email (Unicode NFKC, trimmed, lowercased): an existing lead with the same address keeps every stored value (status, source, date, name, data); only fields it lacks are added. " +
    "This is the public capture route: when reCAPTCHA is configured (deployment or tenant keys) the backend requires a reCAPTCHA token, " +
    "which this server cannot produce, so the call fails with HTTP 400 'CAPTCHA verification required'.",
    {
        tenant_id: z.string(),
        email: z.string().describe("Lead email (valid email address)"),
        name: z.string().optional(),
        source: z.string().optional().describe("Where the lead came from, e.g. 'Footer Form', 'Webinar'"),
        data: z.string().optional().describe("JSON object of custom fields"),
    },
    async ({ tenant_id, email, name, source, data }) => {
        try {
            const payload: Record<string, unknown> = { email };
            if (name !== undefined) payload.name = name;
            if (source !== undefined) payload.source = source;
            if (data !== undefined) {
                const parsed = parseJsonInput(data, "object", "data");
                if (!parsed.ok) return parsed.result;
                payload.data = parsed.value;
            }
            await axios.post(`${API_URL}/leads`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Saved lead ${email}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("delete_lead",
    "Permanently delete a lead by email. No undo.",
    {
        tenant_id: z.string(),
        email: z.string().describe("Lead email (from list_leads)"),
    },
    async ({ tenant_id, email }) => {
        try {
            await axios.delete(`${API_URL}/leads/${encodeURIComponent(email)}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Deleted lead ${email}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);
}
